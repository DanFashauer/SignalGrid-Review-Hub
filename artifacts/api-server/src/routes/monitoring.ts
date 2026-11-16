import { Router, type IRouter } from "express";
import type {
  DashboardMetrics,
  Decision,
  DecisionSeriesPoint,
  Policy,
  Signal,
} from "@workspace/api-zod";

/**
 * Monitoring surface (`/api/*`) that backs the operator console + mobile
 * dashboards. These are read-only, deterministic **fixtures** — the admin apps
 * consume the generated `@workspace/api-client-react` client, which targets this
 * shape. No database and no live vendor calls: every value below is synthetic,
 * fixed at process start (mirroring the `/api/integrations` catalog), so the
 * console populates identically on every run and stays public-safe.
 *
 * This is intentionally separate from the `/v1` product surface (the
 * deterministic decision core). `/v1` is the source of truth for real
 * evaluations; this surface is the demo telemetry the dashboards render.
 */
const router: IRouter = Router();

// Fixed at process start so timestamps are stable within a run (same pattern as
// the integrations catalog). Not derived from the decision core.
const START = Date.now();
const iso = (minsAgo: number): string => new Date(START - minsAgo * 60_000).toISOString();

const OUTCOMES: Decision["outcome"][] = [
  "allow", "allow", "allow", "step-up", "allow",
  "restrict", "allow", "step-up", "deny", "allow",
];
const PLATFORMS = [
  "iPad (Shared)", "Zebra TC52", "Windows Kiosk",
  "iPhone (BYOD)", "macOS", "Android (Frontline)",
];
const WORKFLOWS = ["med-admin", "chart-access", "controlled-substance", "shift-handoff", "pos-refund"];
const INDUSTRIES = ["healthcare", "retail", "logistics"];

const DECISIONS: Decision[] = Array.from({ length: 24 }, (_, i) => ({
  id: `dec-${1000 + i}`,
  identityId: `USR${1000 + (i % 7)}`,
  deviceId: `SG-${String(100 + i).padStart(4, "0")}`,
  workflowId: WORKFLOWS[i % WORKFLOWS.length],
  outcome: OUTCOMES[i % OUTCOMES.length],
  signals: [],
  evaluatedAt: iso(i * 7 + 1) as unknown as Date,
  latencyMs: 8 + (i % 5) * 3,
  industry: INDUSTRIES[i % INDUSTRIES.length],
}));

const SIGNAL_TYPES: Signal["signalType"][] = [
  "identity", "device-posture", "physical-access", "operational-signals", "network-posture",
];
const SIGNAL_STATUSES: Signal["status"][] = [
  "nominal", "nominal", "nominal", "anomalous", "nominal", "critical",
];
const SIGNALS: Signal[] = Array.from({ length: 12 }, (_, i) => ({
  id: `sig-${500 + i}`,
  signalType: SIGNAL_TYPES[i % SIGNAL_TYPES.length],
  platform: PLATFORMS[i % PLATFORMS.length],
  deviceId: `SG-${String(100 + i).padStart(4, "0")}`,
  value: { compliant: i % 4 !== 0, posture: SIGNAL_STATUSES[i % SIGNAL_STATUSES.length] },
  status: SIGNAL_STATUSES[i % SIGNAL_STATUSES.length],
  receivedAt: iso(i * 4 + 1) as unknown as Date,
}));

const METRICS: DashboardMetrics = {
  window: "24h",
  totalDecisions: 18432,
  allowCount: 15120,
  stepUpCount: 1890,
  restrictCount: 980,
  denyCount: 442,
  allowRate: 0.8203,
  restrictDenyRate: 0.0771,
  avgLatencyMs: 11.4,
  activeIntegrations: 34,
  totalIntegrations: 40,
  topPlatforms: [
    { platform: "iPad (Shared)", count: 6120 },
    { platform: "Zebra TC52", count: 4310 },
    { platform: "Windows Kiosk", count: 3880 },
  ],
};

// 24 hourly points — a deterministic shift-shaped load curve.
const HOURLY_LOAD = [3, 2, 2, 1, 1, 2, 4, 7, 9, 11, 12, 12, 11, 12, 13, 12, 10, 9, 8, 7, 6, 5, 4, 3];
const SERIES: DecisionSeriesPoint[] = HOURLY_LOAD.map((load, h) => ({
  timestamp: new Date(START - (23 - h) * 3_600_000).toISOString() as unknown as Date,
  allow: load * 60,
  stepUp: Math.round(load * 7),
  restrict: Math.round(load * 3),
  deny: Math.round(load * 1.5),
}));

const POLICIES: Policy[] = [
  {
    id: "pol-med-admin",
    name: "Medication administration",
    description: "Require a compliant, badge-bound device in custody for controlled workflows.", // deferred family — fixture catalog data, not Limited GA capability
    workflowPattern: "med-admin*",
    rules: [
      { signal: "identity", condition: "identity.verified == true", outcome: "allow", severity: "high" },
      { signal: "device-posture", condition: "device.compliant == false", outcome: "restrict", severity: "high" },
      { signal: "physical-access", condition: "badge.bound == false", outcome: "step-up", severity: "medium" },
    ],
    failMode: "fail-closed",
    active: true,
    createdAt: iso(60 * 24 * 30) as unknown as Date,
    updatedAt: iso(60 * 6) as unknown as Date,
  },
  {
    id: "pol-shift-handoff",
    name: "Shift handoff custody",
    description: "Deny access on a device that missed dock checkout at shift end.",
    workflowPattern: "shift-handoff*",
    rules: [
      { signal: "physical-access", condition: "custody.docked == false", outcome: "deny", severity: "critical" },
    ],
    failMode: "fail-closed",
    active: true,
    createdAt: iso(60 * 24 * 21) as unknown as Date,
    updatedAt: iso(60 * 24 * 2) as unknown as Date,
  },
  {
    id: "pol-pos-refund",
    name: "POS refund step-up",
    description: "Step up to a passkey challenge for high-value refunds on shared retail devices.",
    workflowPattern: "pos-refund*",
    rules: [
      { signal: "operational-signals", condition: "refund.amount > 200", outcome: "step-up", severity: "medium" },
    ],
    failMode: "fail-open",
    active: false,
    createdAt: iso(60 * 24 * 14) as unknown as Date,
    updatedAt: iso(60 * 24 * 5) as unknown as Date,
  },
];

const clampLimit = (raw: unknown, fallback: number): number => {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 200);
};

router.get("/decisions", (req, res) => {
  const limit = clampLimit(req.query.limit, 20);
  const outcome = typeof req.query.outcome === "string" ? req.query.outcome : undefined;
  let list = DECISIONS;
  if (outcome) list = list.filter((d) => d.outcome === outcome);
  res.json({ decisions: list.slice(0, limit), total: list.length });
});

router.get("/decisions/:id", (req, res) => {
  const decision = DECISIONS.find((d) => d.id === req.params.id);
  if (!decision) {
    res.status(404).json({ error: "not_found", message: "Decision not found (fixture)" });
    return;
  }
  res.json(decision);
});

router.get("/signals/latest", (req, res) => {
  const limit = clampLimit(req.query.limit, 50);
  const signalType = typeof req.query.signalType === "string" ? req.query.signalType : undefined;
  let list = SIGNALS;
  if (signalType) list = list.filter((s) => s.signalType === signalType);
  res.json({ signals: list.slice(0, limit) });
});

router.get("/metrics/dashboard", (_req, res) => {
  res.json(METRICS);
});

router.get("/metrics/decisions/series", (_req, res) => {
  res.json({ series: SERIES });
});

router.get("/policies", (_req, res) => {
  res.json({ policies: POLICIES });
});

export default router;
