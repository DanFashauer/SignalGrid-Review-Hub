import { Router, type IRouter } from "express";
import { ControlPlane, type TelemetryBatch } from "@workspace/control-plane";
import { listFlows, evaluateFlowHealth, resolveFlowBreak, gridIntelligence, type SignalState } from "@workspace/flows";

/**
 * `/cp/v1/*` — the SaaS **control-plane** surface (management, not decisions).
 *
 * This is the cloud half of the hybrid architecture (docs/DEPLOYMENT_MODELS.md):
 * tenants, sites, edge nodes (local decision planes), fleet devices, policy
 * bundles pushed DOWN, and telemetry reported UP. The decision itself is made by
 * the edge/on-prem decision core (the `/v1` surface), never here.
 *
 * Deterministic, fixture-backed, public-safe: seeded across three verticals —
 * a hospital, a warehouse, and a global mobile fleet — so one plane demonstrably
 * manages very different frontlines. No database, no live calls.
 */
const router: IRouter = Router();
const cp = ControlPlane.demo();

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

router.get("/cp/v1/tenants", (_req, res) => {
  res.json({ tenants: cp.listTenants() });
});

router.get("/cp/v1/sites", (req, res) => {
  res.json({ sites: cp.listSites(str(req.query.tenant)) });
});

router.get("/cp/v1/edge-nodes", (req, res) => {
  res.json({ edgeNodes: cp.listEdgeNodes(str(req.query.tenant)) });
});

router.get("/cp/v1/fleet", (req, res) => {
  const devices = cp.listFleet(str(req.query.site));
  res.json({ total: devices.length, devices: devices.slice(0, 200) });
});

// Config DOWN: the policy bundle an edge node should run.
router.get("/cp/v1/policy-bundle", (req, res) => {
  const tenant = str(req.query.tenant);
  if (!tenant) {
    res.status(400).json({ error: "validation", message: "tenant query parameter is required" });
    return;
  }
  const bundle = cp.getPolicyBundle(tenant);
  if (!bundle) {
    res.status(404).json({ error: "not_found", message: "No policy bundle for tenant (fixture)" });
    return;
  }
  res.json(bundle);
});

// What an edge node should pull.
router.get("/cp/v1/sync/:nodeId", (req, res) => {
  const plan = cp.syncPlan(req.params.nodeId);
  if (!plan) {
    res.status(404).json({ error: "not_found", message: "Edge node not found (fixture)" });
    return;
  }
  res.json(plan);
});

// Telemetry UP: an edge node reports its decision counts for a window.
router.post("/cp/v1/telemetry", (req, res) => {
  const b = req.body as Partial<TelemetryBatch> | undefined;
  if (!b || typeof b.nodeId !== "string") {
    res.status(400).json({ error: "validation", message: "nodeId is required" });
    return;
  }
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  const stored = cp.ingestTelemetry({
    nodeId: b.nodeId,
    windowMins: num(b.windowMins) || 1440,
    decisions: num(b.decisions),
    allow: num(b.allow),
    stepUp: num(b.stepUp),
    restrict: num(b.restrict),
    deny: num(b.deny),
  });
  res.json({ ingested: stored });
});

// Fleet-wide health rollup, with a per-vertical breakdown.
router.get("/cp/v1/health", (req, res) => {
  res.json(cp.fleetHealth(str(req.query.tenant)));
});

// Operational-intelligence rollup: friction hotspots, posture/config drift, and
// custody gaps across sites, derived from ingested telemetry + node state.
router.get("/cp/v1/ops-intelligence", (req, res) => {
  res.json(cp.operationalIntelligence(str(req.query.tenant)));
});

// ── Admin flows: what admins configure (signals → actions + approvals) and how
// the Grid watches them. A public-safe fixture signal snapshot drives the health
// so the self-heal-vs-incident behaviour is visible. Deterministic. ────────────
const FLOW_SIGNAL_SNAPSHOT: SignalState[] = [
  { id: "identity", status: "healthy" },
  { id: "device_compliance", status: "healthy" },
  { id: "badge_binding", status: "healthy" },
  { id: "baseline", status: "broken" }, // breaks med-admin (incident) + network-change (self-heal)
  { id: "custody", status: "healthy" },
  { id: "change_window", status: "healthy" },
];
const FLOW_SNAPSHOT_AT = "2026-07-16T14:00:00.000Z";

router.get("/cp/v1/flows", (_req, res) => {
  res.json({ flows: listFlows() });
});

router.get("/cp/v1/flows/health", (_req, res) => {
  const flows = listFlows().map((flow) => ({
    flow: { id: flow.id, name: flow.name, supportTeam: flow.supportTeam, itsm: flow.itsm, severityOnBreak: flow.severityOnBreak, autoHeal: flow.autoHeal ?? null },
    health: evaluateFlowHealth(flow, FLOW_SIGNAL_SNAPSHOT),
    resolution: resolveFlowBreak(flow, FLOW_SIGNAL_SNAPSHOT, FLOW_SNAPSHOT_AT),
  }));
  res.json({
    observedAt: FLOW_SNAPSHOT_AT,
    signals: FLOW_SIGNAL_SNAPSHOT,
    flows,
    grid: gridIntelligence(listFlows(), FLOW_SIGNAL_SNAPSHOT),
  });
});

export default router;
