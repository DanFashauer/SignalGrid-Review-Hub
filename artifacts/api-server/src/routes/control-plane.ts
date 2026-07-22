import { Router, type IRouter } from "express";
import { ControlPlane, type TelemetryBatch } from "@workspace/control-plane";
import {
  listFlows, evaluateFlowHealth, resolveFlowBreak, gridIntelligence, type SignalState,
  DEMO_FLOWS, GRID_SITUATIONS, evaluateGridCoverage,
  lintGridConfig, gridConfigValid, summarizeGridConfig, type GridConfig,
  sourcingToSignalStates, summarizeSourcing, fidelityOf, isWireable, gridDoesLifting, type SignalSource,
  planZeroTouchSetup, lintSetupRecording, setupRecordingValid, type DeviceSetupRecording,
  fleetResilience, type AppService,
} from "@workspace/flows";
import { recommend, DEMO_USAGE } from "@workspace/recommendations";
import { discover, planOnboarding, discoverySummary, DEMO_SOURCES, DEMO_OBSERVED } from "@workspace/signal-discovery";
import { normalizeDdmReports, ddmSummary, DEMO_DDM_REPORTS, DDM_OBSERVED_AT } from "@workspace/ddm-connector";

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

// Learned-habit recommendations: from the observed usage history, advisory
// proposals to improve flows/signals (automate/tighten an action, add a signal,
// merge flows). Advisory only — nothing is changed here.
router.get("/cp/v1/recommendations", (_req, res) => {
  res.json({ note: "Advisory only — an admin reviews and applies. Nothing is changed by this endpoint.", recommendations: recommend(DEMO_USAGE, listFlows()) });
});

// Signal discovery: what the Grid detected across connected sources, and what it
// would onboard automatically (source has an API) vs. flag for an admin. The
// onboarding here is a plan/record — no real source is called.
router.get("/cp/v1/signal-discovery", (_req, res) => {
  const discovered = discover(DEMO_OBSERVED, DEMO_SOURCES);
  res.json({
    note: "Auto-onboarding is simulated — it produces the record the Grid would create; no source is called.",
    sources: DEMO_SOURCES,
    summary: discoverySummary(discovered, DEMO_SOURCES),
    discovered,
    onboarding: planOnboarding(discovered),
  });
});

// DDM / device-health signals (macOS 27): normalize Declarative Device Management
// health reporting + binary-control + declarative-privacy posture into the
// decision dimensions the core understands. Complementary to OS binary control;
// a weak posture only RAISES the assurance a sensitive action demands. Fixture —
// no live MDM call. See docs/MACOS_27_DDM_SIGNAL_OPPORTUNITY.md.
router.get("/cp/v1/ddm", (_req, res) => {
  const signals = normalizeDdmReports(DEMO_DDM_REPORTS, DDM_OBSERVED_AT);
  res.json({
    note: "Fixture DDM reports normalized to decision dimensions; no live MDM is called. A weak posture only raises assurance (auto → step-up), never lowers it.",
    observedAt: DDM_OBSERVED_AT,
    summary: ddmSummary(signals, DEMO_DDM_REPORTS),
    signals,
  });
});

// ── Build the grid: coverage, config, provisioning, resilience ──────────────────
// The decision-fabric layer, live and queryable. Public-safe fixtures: the same
// demo workflows/situations the proofs use, sourced by illustrative paths. Read-
// only and deterministic; nothing is enforced, no device or vendor is contacted.
// See docs/OPEN_ORCHESTRATION_VISION.md, SIGNAL_SOURCING.md, APP_RESILIENCE.md,
// ZERO_TOUCH_PROVISIONING.md.

// How each signal the demo workflows need reaches the Grid (API/native/grid-lifted).
const GRID_SIGNAL_SOURCES: SignalSource[] = [
  { id: "identity", name: "Identity / SSO", system: "Entra ID", method: "api" },
  { id: "device_compliance", name: "Device compliance", system: "Intune", method: "api" },
  { id: "badge_binding", name: "Badge binding", system: "RFID reader", method: "native" },
  { id: "baseline", name: "Security baseline (CIS)", system: "baseline scanner", method: "grid_collected" },
  { id: "change_window", name: "Approved change window", system: "ITSM", method: "native" },
  { id: "custody", name: "Physical custody", system: "RTLS", method: "grid_collected", degraded: true },
  // A real gap: a legacy nurse-call system with no API and no way for the Grid to
  // collect it. It is surfaced as unavailable (a gap, never a false "we have it"),
  // and — because no workflow requires it yet — it is a lint WARNING, not an error.
  { id: "nurse_call", name: "Nurse-call events", system: "legacy nurse-call", method: "unavailable" },
];
const GRID_CONFIG: GridConfig = { signals: GRID_SIGNAL_SOURCES, workflows: [...DEMO_FLOWS], situations: [...GRID_SITUATIONS] };

router.get("/cp/v1/grid/coverage", (_req, res) => {
  const wired = sourcingToSignalStates(GRID_SIGNAL_SOURCES);
  res.json({
    note: "Which situations the Grid handles on its own, given the active workflows + the signals it can source. Fixture data — read-only.",
    sourcing: summarizeSourcing(GRID_SIGNAL_SOURCES),
    coverage: evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, wired),
  });
});

router.get("/cp/v1/grid/sourcing", (_req, res) => {
  // How each signal reaches the Grid dictates the outcome — api/native (the vendor
  // integrates), grid_collected (the Grid does the lifting, lower fidelity), or
  // unavailable (a real gap). Read-only.
  const signals = GRID_SIGNAL_SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    system: s.system,
    method: s.method,
    fidelity: fidelityOf(s),
    wireable: isWireable(s.method),
    gridLifted: gridDoesLifting(s.method),
  }));
  res.json({
    note: "How each signal is obtained — vendor-integrated (api/native), grid-collected (the Grid does the lifting), or a gap (unavailable). Read-only.",
    summary: summarizeSourcing(GRID_SIGNAL_SOURCES),
    signals,
  });
});

router.get("/cp/v1/grid/config", (_req, res) => {
  // A lean projection of the declarative grid — the versionable artifact an org
  // commits to Git — so the operator view can render what the pipeline validates.
  const config = {
    signals: GRID_CONFIG.signals.map((s) => ({ id: s.id, name: s.name, system: s.system, method: s.method })),
    workflows: GRID_CONFIG.workflows.map((w) => ({
      id: w.id,
      name: w.name,
      requiredSignals: w.requiredSignals,
      actions: w.actions.map((a) => ({ key: a.key, label: a.label, approval: a.approval })),
      supportTeam: w.supportTeam,
      severityOnBreak: w.severityOnBreak,
    })),
    situations: GRID_CONFIG.situations.map((s) => ({ id: s.id, label: s.label, workflowId: s.workflowId })),
  };
  res.json({
    note: "Workflows as code — the CI/CD validation the Grid runs on the declarative config before it runs the Grid. Read-only.",
    valid: gridConfigValid(GRID_CONFIG),
    summary: summarizeGridConfig(GRID_CONFIG),
    issues: lintGridConfig(GRID_CONFIG),
    config,
  });
});

const PROVISIONING_RECORDING: DeviceSetupRecording = {
  id: "rec_clinical_tablet",
  name: "Clinical tablet first-boot",
  match: { serialPrefix: "CLIN-", model: "MediPad-X" },
  triggers: ["first_boot", "network_join"],
  steps: [
    { key: "wifi", label: "Join clinical Wi-Fi", kind: "wifi" },
    { key: "profile", label: "Install MDM profile", kind: "profile" },
    { key: "emr", label: "Deploy EMR app", kind: "app_install" },
    { key: "lockdown", label: "Apply kiosk restriction", kind: "restriction", sensitive: true },
  ],
};
// Preset devices the Designer preview can plan against — one that matches the
// recording and one that deliberately does NOT, so the fail-safe ("a non-matching
// device is never touched") is visible in the mobile app, not just claimed.
const PROVISIONING_DEVICES: Record<string, { serial: string; model?: string; onNetwork?: boolean }> = {
  "CLIN-00042": { serial: "CLIN-00042", model: "MediPad-X", onNetwork: true },
  "WARE-88120": { serial: "WARE-88120", model: "ScanPad-2", onNetwork: true },
};
const DEFAULT_PROVISIONING_SERIAL = "CLIN-00042";

router.get("/cp/v1/grid/provisioning", (req, res) => {
  // Simulated by default — enforcement stays off until an owner enables it.
  // Optional ?serial=/?model= previews the plan against a chosen device; a
  // serial not in the preset set is planned as an ad-hoc device (which will
  // simply not match unless it fits the recording's selector — fail-safe).
  const serialRaw = req.query.serial;
  const modelRaw = req.query.model;
  const serial = typeof serialRaw === "string" && serialRaw.length > 0 ? serialRaw : DEFAULT_PROVISIONING_SERIAL;
  // hasOwnProperty-guarded lookup — a plain-object index walks the prototype
  // chain, so `?serial=constructor`/`__proto__` would otherwise resolve to an
  // inherited member and produce a garbage device. Own keys only.
  const preset = Object.prototype.hasOwnProperty.call(PROVISIONING_DEVICES, serial) ? PROVISIONING_DEVICES[serial] : undefined;
  const device = preset ?? {
    serial,
    model: typeof modelRaw === "string" && modelRaw.length > 0 ? modelRaw : undefined,
    onNetwork: true,
  };
  const plan = planZeroTouchSetup(PROVISIONING_RECORDING, device);
  const issues = lintSetupRecording(PROVISIONING_RECORDING);
  res.json({
    note: "Zero-touch device setup, simulated — enforcement is off, so steps are described, not executed. A sensitive step requires approval; a non-matching device is never touched.",
    recording: PROVISIONING_RECORDING,
    recordingValid: setupRecordingValid(PROVISIONING_RECORDING),
    issues,
    device,
    devices: Object.values(PROVISIONING_DEVICES),
    plan,
  });
});

// The clinical app suite (categories, not vendor claims) — EHR, BCMA, patient
// portal, HIS, clinical comms, drug reference, billing. Availability is an INPUT
// (sourced like any signal). States are chosen to exercise every resilience mode,
// including the loud fail-safe: a PHI app in outage with a fallback but NO safety
// nets is BLOCKED, never dressed up as a workaround.
const APP_SUITE: AppService[] = [
  { id: "ehr", name: "EHR", availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: ["DR checkpoint", "post-hoc reconciliation", "witness"] },
  { id: "bcma", name: "BCMA (barcode med admin)", availability: "available", hasFallback: true, handlesPhi: true },
  { id: "portal", name: "Patient portal", availability: "degraded", hasFallback: false, handlesPhi: true },
  { id: "his", name: "HIS", availability: "planned_maintenance", hasFallback: true, handlesPhi: true, safetyNets: ["read-only cache", "downtime forms"] },
  { id: "comms", name: "Clinical comms", availability: "available", hasFallback: true, handlesPhi: false },
  { id: "drugref", name: "Drug reference", availability: "unknown", hasFallback: false, handlesPhi: false },
  { id: "billing", name: "Billing", availability: "unplanned_outage", hasFallback: true, handlesPhi: true, safetyNets: [] },
];
router.get("/cp/v1/apps/resilience", (_req, res) => {
  res.json({
    note: "Turning each app's availability into a PHI-safe resilience decision so staff keep working through downtime. Fixture data; fallbacks described, not executed.",
    fleet: fleetResilience(APP_SUITE),
  });
});

export default router;
