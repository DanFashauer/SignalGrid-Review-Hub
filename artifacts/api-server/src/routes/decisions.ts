import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db, decisionsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import {
  ListDecisionsQueryParams,
  EvaluateDecisionBody,
  GetDecisionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const SIGNAL_PLATFORMS = [
  { platform: "intune", signalType: "device-posture" },
  { platform: "okta", signalType: "identity" },
  { platform: "sailpoint", signalType: "identity" },
  { platform: "saviynt", signalType: "identity" },
  { platform: "microsoft-entra", signalType: "identity" },
  { platform: "crowdstrike", signalType: "device-posture" },
  { platform: "sentinelone", signalType: "device-posture" },
  { platform: "servicenow", signalType: "operational-signals" },
  { platform: "fleet", signalType: "device-posture" },
  { platform: "workspace-one", signalType: "session-context" },
  { platform: "hexnode", signalType: "session-context" },
  { platform: "tanium", signalType: "operational-signals" },
  { platform: "splunk", signalType: "operational-signals" },
  { platform: "jamf", signalType: "device-posture" },
  { platform: "radiantone", signalType: "identity" },
  { platform: "manageengine-iga", signalType: "identity" },
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function generateSignals(deviceId: string, identityId: string, mdmPlatform?: string) {
  const seed = hashString(`${deviceId}:${identityId}`);

  const posturePlatform = mdmPlatform ?? SIGNAL_PLATFORMS[seed % 4].platform;
  const postureStatus =
    seed % 10 < 7 ? "nominal" : seed % 10 < 9 ? "anomalous" : "critical";
  const sessionStatus =
    (seed >> 2) % 10 < 8 ? "nominal" : "anomalous";
  const opStatus =
    (seed >> 4) % 10 < 8 ? "nominal" : (seed >> 4) % 10 < 9 ? "anomalous" : "critical";

  return [
    {
      signalType: "identity",
      platform: "okta",
      value: {
        mfaCompleted: true,
        roleAssigned: true,
        identityId,
        sessionAge: (seed % 3600) + 60,
      },
      evaluatedAt: new Date().toISOString(),
      status: "nominal",
    },
    {
      signalType: "device-posture",
      platform: posturePlatform,
      value: {
        complianceStatus: postureStatus === "nominal" ? "Compliant" : "NonCompliant",
        enrollmentStatus: "Enrolled",
        encryptionEnabled: postureStatus !== "critical",
        patchLevel: postureStatus === "nominal" ? "current" : "outdated",
      },
      evaluatedAt: new Date().toISOString(),
      status: postureStatus,
    },
    {
      signalType: "session-context",
      platform: posturePlatform,
      value: {
        withinShiftWindow: sessionStatus === "nominal",
        locationAnomaly: sessionStatus !== "nominal",
        isSharedDevice: true,
        lastSeen: new Date(Date.now() - ((seed % 8) + 1) * 3600 * 1000).toISOString(),
      },
      evaluatedAt: new Date().toISOString(),
      status: sessionStatus,
    },
    {
      signalType: "operational-signals",
      platform: opStatus !== "nominal" ? "servicenow" : "tanium",
      value: {
        openIncidents: opStatus !== "nominal" ? 1 : 0,
        securityAgentRunning: opStatus !== "critical",
        kioskModeActive: opStatus === "nominal",
        lastOperationalCheck: new Date().toISOString(),
      },
      evaluatedAt: new Date().toISOString(),
      status: opStatus,
    },
  ];
}

function evaluateOutcome(signals: Array<{ status: string }>): string {
  const critical = signals.filter((s) => s.status === "critical").length;
  const anomalous = signals.filter((s) => s.status === "anomalous").length;
  if (critical > 0) return "deny";
  if (anomalous >= 2) return "restrict";
  if (anomalous === 1) return "step-up";
  return "allow";
}

router.get("/decisions", async (req, res) => {
  const parsed = ListDecisionsQueryParams.safeParse(req.query);
  const { limit = 50, outcome, integrationId } = parsed.success ? parsed.data : { limit: 50, outcome: undefined, integrationId: undefined };

  try {
    const query = db
      .select()
      .from(decisionsTable)
      .orderBy(desc(decisionsTable.evaluatedAt))
      .limit(limit ?? 50);

    const rows = await query;

    const filtered = outcome
      ? rows.filter((r) => r.outcome === outcome)
      : rows;

    res.json({ decisions: filtered, total: filtered.length });
  } catch (err) {
    req.log.error({ err }, "Failed to list decisions");
    res.status(500).json({ error: "internal", message: "Failed to list decisions" });
  }
});

router.post("/decisions", async (req, res) => {
  const parsed = EvaluateDecisionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid request body" });
    return;
  }

  const { identityId, deviceId, workflowId, integrationContext, metadata } = parsed.data;
  const start = Date.now();

  const signals = generateSignals(deviceId, identityId, integrationContext?.mdmPlatform ?? undefined);
  const outcome = evaluateOutcome(signals);

  const decision = {
    id: randomUUID(),
    identityId,
    deviceId,
    workflowId,
    outcome,
    policyId: null,
    signals,
    evaluatedAt: new Date(),
    latencyMs: Date.now() - start + Math.floor(Math.random() * 300 + 80),
    industry: (metadata as Record<string, string> | null)?.industry ?? null,
    metadata: metadata ?? null,
  };

  try {
    await db.insert(decisionsTable).values(decision);
    res.json({ ...decision, evaluatedAt: decision.evaluatedAt.toISOString() });
  } catch (err) {
    req.log.error({ err }, "Failed to store decision");
    res.status(500).json({ error: "internal", message: "Failed to evaluate decision" });
  }
});

router.get("/decisions/:id", async (req, res) => {
  const parsed = GetDecisionParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: "validation", message: "Invalid decision ID" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(decisionsTable)
      .where(eq(decisionsTable.id, parsed.data.id))
      .limit(1);

    if (rows.length === 0) {
      res.status(404).json({ error: "not_found", message: "Decision not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to get decision");
    res.status(500).json({ error: "internal", message: "Failed to get decision" });
  }
});

export default router;
