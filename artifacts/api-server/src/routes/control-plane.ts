import { Router, type IRouter } from "express";
import { ControlPlane, type TelemetryBatch } from "@workspace/control-plane";

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

export default router;
