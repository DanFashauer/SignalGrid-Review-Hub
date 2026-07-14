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
  // Identity
  { platform: "okta", signalType: "identity" },
  { platform: "sailpoint", signalType: "identity" },
  { platform: "saviynt", signalType: "identity" },
  { platform: "microsoft-entra", signalType: "identity" },
  { platform: "auth0", signalType: "identity" },
  { platform: "keycloak", signalType: "identity" },
  { platform: "teleport", signalType: "identity" },
  { platform: "radiantone", signalType: "identity" },
  { platform: "manageengine-iga", signalType: "identity" },
  { platform: "imprivata", signalType: "identity" },
  // Device posture
  { platform: "intune", signalType: "device-posture" },
  { platform: "crowdstrike", signalType: "device-posture" },
  { platform: "sentinelone", signalType: "device-posture" },
  { platform: "fleet", signalType: "device-posture" },
  { platform: "kolide", signalType: "device-posture" },
  { platform: "santa", signalType: "device-posture" },
  { platform: "jamf", signalType: "device-posture" },
  { platform: "kandji", signalType: "device-posture" },
  { platform: "osquery", signalType: "device-posture" },
  { platform: "wazuh", signalType: "device-posture" },
  // Session context
  { platform: "workspace-one", signalType: "session-context" },
  { platform: "hexnode", signalType: "session-context" },
  { platform: "teleport", signalType: "session-context" },
  // Operational signals
  { platform: "servicenow", signalType: "operational-signals" },
  { platform: "tanium", signalType: "operational-signals" },
  { platform: "splunk", signalType: "operational-signals" },
  { platform: "velociraptor", signalType: "operational-signals" },
  // Network posture
  { platform: "cisco-meraki", signalType: "network-posture" },
  { platform: "cisco-ise", signalType: "network-posture" },
  { platform: "palo-alto-panos", signalType: "network-posture" },
  { platform: "fortinet", signalType: "network-posture" },
  // Physical access
  { platform: "hid-global", signalType: "physical-access" },
  { platform: "lenel-s2", signalType: "physical-access" },
  { platform: "genetec", signalType: "physical-access" },
  { platform: "imprivata", signalType: "physical-access" },
  { platform: "rfideas", signalType: "physical-access" },
  { platform: "apple-wallet", signalType: "physical-access" },
  { platform: "google-wallet", signalType: "physical-access" },
  { platform: "hid-crescendo", signalType: "physical-access" },
  // Security keys / FIDO2
  { platform: "yubico", signalType: "identity" },
  { platform: "hid-crescendo", signalType: "identity" },
  { platform: "authentik", signalType: "identity" },
  { platform: "privacyidea", signalType: "identity" },
  // Cellular / eSIM (post-exit reachability)
  { platform: "twilio-super-sim", signalType: "network-posture" },
  { platform: "soracom", signalType: "network-posture" },
  { platform: "hologram", signalType: "network-posture" },
  // Infrastructure monitoring
  { platform: "datadog", signalType: "operational-signals" },
  { platform: "grafana", signalType: "operational-signals" },
  { platform: "prometheus", signalType: "operational-signals" },
  // SOAR
  { platform: "tines", signalType: "operational-signals" },
  // ITSM
  { platform: "pagerduty", signalType: "operational-signals" },
  // Disaster Recovery / BC
  { platform: "veeam", signalType: "operational-signals" },
  { platform: "zerto", signalType: "operational-signals" },
  { platform: "rubrik", signalType: "operational-signals" },
  // GRC / Compliance
  { platform: "qualys-vmdr", signalType: "operational-signals" },
  { platform: "servicenow-grc", signalType: "operational-signals" },
  { platform: "tenable", signalType: "operational-signals" },
  { platform: "disa-scap", signalType: "operational-signals" },
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

  const idPlatforms = SIGNAL_PLATFORMS.filter((p) => p.signalType === "identity");
  const identityPlatform = idPlatforms[seed % idPlatforms.length].platform;

  const devicePlatforms = SIGNAL_PLATFORMS.filter((p) => p.signalType === "device-posture");
  const posturePlatform = mdmPlatform ?? devicePlatforms[(seed >> 3) % devicePlatforms.length].platform;

  const sessionPlatforms = SIGNAL_PLATFORMS.filter((p) => p.signalType === "session-context");
  const sessionPlatform = sessionPlatforms[(seed >> 1) % sessionPlatforms.length].platform;

  const opPlatforms = SIGNAL_PLATFORMS.filter((p) => p.signalType === "operational-signals");
  const opPlatform = opPlatforms[(seed >> 4) % opPlatforms.length].platform;

  const postureStatus =
    seed % 10 < 7 ? "nominal" : seed % 10 < 9 ? "anomalous" : "critical";
  const sessionStatus = (seed >> 2) % 10 < 8 ? "nominal" : "anomalous";
  const opStatus =
    (seed >> 4) % 10 < 8 ? "nominal" : (seed >> 4) % 10 < 9 ? "anomalous" : "critical";
  const networkStatus = (seed >> 6) % 10 < 9 ? "nominal" : "anomalous";
  const physicalStatus = (seed >> 8) % 10 < 9 ? "nominal" : "anomalous";

  const signals: Array<{
    signalType: string;
    platform: string;
    value: Record<string, unknown>;
    evaluatedAt: string;
    status: string;
  }> = [
    {
      signalType: "identity",
      platform: identityPlatform,
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
      platform: sessionPlatform,
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
      platform: opPlatform,
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

  // Network posture: 60% of decisions include a network policy check
  if (seed % 10 < 6) {
    const netPlatforms = SIGNAL_PLATFORMS.filter((p) => p.signalType === "network-posture");
    const netPlatform = netPlatforms[(seed >> 1) % netPlatforms.length].platform;
    signals.push({
      signalType: "network-posture",
      platform: netPlatform,
      value: {
        vlanCompliant: networkStatus === "nominal",
        firewallPolicyMatched: true,
        allowedSubnet: networkStatus === "nominal",
        trafficAnomalyScore: networkStatus === "nominal" ? 0.02 : 0.78,
        naacProfile: networkStatus === "nominal" ? "trusted-endpoint" : "quarantine",
      },
      evaluatedAt: new Date().toISOString(),
      status: networkStatus,
    });
  }

  // Physical access: 40% of decisions include a badge/PACS check (frontline workflows)
  if (seed % 10 < 4) {
    const pacsPlatforms = SIGNAL_PLATFORMS.filter((p) => p.signalType === "physical-access");
    const pacsPlatform = pacsPlatforms[(seed >> 5) % pacsPlatforms.length].platform;
    signals.push({
      signalType: "physical-access",
      platform: pacsPlatform,
      value: {
        badgedIntoBuilding: physicalStatus === "nominal",
        accessZone: physicalStatus === "nominal" ? "authorized" : "restricted",
        badgeEventTime: new Date(Date.now() - ((seed % 4) + 1) * 1800 * 1000).toISOString(),
        tailgatingDetected: physicalStatus !== "nominal",
        credentialType: seed % 3 === 0 ? "mobile" : "smart-card",
      },
      evaluatedAt: new Date().toISOString(),
      status: physicalStatus,
    });
  }

  return signals;
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
  const { limit = 50, outcome } = parsed.success ? parsed.data : { limit: 50, outcome: undefined };

  // Clamp the client-supplied limit so a crafted value cannot dump the whole
  // table into memory or produce an invalid SQL LIMIT.
  const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 50)), 200);
  // Filter in SQL BEFORE limiting, so the page contains the right rows. Filtering
  // after LIMIT would silently drop matching rows that sit just past the window
  // (e.g. `?outcome=deny&limit=50` could return zero denies while thousands
  // exist). `total` is a separate COUNT over the same predicate, not the page size.
  const where = outcome ? eq(decisionsTable.outcome, outcome) : undefined;

  try {
    const decisions = await db
      .select()
      .from(decisionsTable)
      .where(where)
      .orderBy(desc(decisionsTable.evaluatedAt))
      .limit(safeLimit);

    const [counted] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(decisionsTable)
      .where(where);

    res.json({ decisions, total: counted?.total ?? decisions.length });
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
