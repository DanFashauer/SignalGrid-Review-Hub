// Proof: grid coverage (@workspace/flows) — the model behind "build the grid".
//
// Verifies the honest, fail-safe core the interactive demo visualizes: a
// situation is `auto_handled` ONLY when its workflow is active AND every signal
// it needs is wired + healthy; otherwise it is `partial` (active but under-fed)
// or a `blind_spot` (no active workflow). Adding a signal or a workflow can only
// ever RAISE coverage — never lower it — and a situation is never reported
// handled unless the Grid can actually run its response.
//
// Run: pnpm --filter @workspace/scripts run proof:grid-coverage

import {
  DEMO_FLOWS,
  GRID_SITUATIONS,
  evaluateGridCoverage,
  type Flow,
  type GridSituation,
  type SignalState,
} from "@workspace/flows";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Grid coverage proof");
console.log(`workflows=${DEMO_FLOWS.length} situations=${GRID_SITUATIONS.length}`);

// Every signal the demo flows depend on, wired healthy = fully built grid.
const ALL_SIGNAL_IDS = [...new Set(DEMO_FLOWS.flatMap((f) => f.requiredSignals))];
const healthy = (ids: readonly string[]): SignalState[] => ids.map((id) => ({ id, status: "healthy" as const }));
const ALL_HEALTHY = healthy(ALL_SIGNAL_IDS);

// ── fully built: every situation auto-handled ────────────────────────────────
const full = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, ALL_HEALTHY);
check("a fully built grid handles every situation itself", full.handled === GRID_SITUATIONS.length && full.coveragePct === 100);
check("fully built → zero partial, zero blind spots", full.partial === 0 && full.blindSpots === 0);
check("every situation resolves to auto_handled", full.situations.every((s) => s.status === "auto_handled"));
check("handled + partial + blindSpots always equals total", full.handled + full.partial + full.blindSpots === full.total);

// ── blind spot: a workflow is not active ─────────────────────────────────────
// Deactivate flow_controlled_area → its situation is a blind spot, never handled.
const withoutControlled = DEMO_FLOWS.filter((f) => f.id !== "flow_controlled_area");
const noWf = evaluateGridCoverage(withoutControlled, GRID_SITUATIONS, ALL_HEALTHY);
const controlledSit = noWf.situations.find((s) => s.workflowId === "flow_controlled_area")!;
check("a situation with no active workflow is a blind_spot", controlledSit.status === "blind_spot");
check("a blind_spot is never counted as handled", noWf.handled === GRID_SITUATIONS.length - 1 && noWf.blindSpots === 1);
check("removing a workflow lowers coverage (adding is the only way up)", noWf.coveragePct < full.coveragePct);

// ── partial: workflow active but a required signal is missing ─────────────────
// Drop "custody" (needed by flow_controlled_area) → its situation goes partial.
const missingCustody = ALL_HEALTHY.filter((s) => s.id !== "custody");
const partial = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, missingCustody);
const partialSit = partial.situations.find((s) => s.workflowId === "flow_controlled_area")!;
check("workflow active but a signal missing → partial (not handled)", partialSit.status === "partial");
check("a partial situation names the missing signal", partialSit.missingSignals.includes("custody"));
check("a missing-signal situation is never auto_handled", partialSit.status !== "auto_handled");

// ── fail-safe: a merely STALE signal still blocks auto-handling ───────────────
const staleCustody: SignalState[] = ALL_HEALTHY.map((s) => (s.id === "custody" ? { id: "custody", status: "stale" } : s));
const stale = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, staleCustody);
const staleSit = stale.situations.find((s) => s.workflowId === "flow_controlled_area")!;
check("a stale required signal blocks auto-handling (fail-safe)", staleSit.status === "partial" && staleSit.missingSignals.includes("custody"));

// ── global fail-safe invariant across many states ────────────────────────────
// No situation is EVER auto_handled unless its workflow declares AT LEAST ONE
// required signal AND every one of them is present-and-healthy. The length>0
// clause is deliberate: it is an INDEPENDENT oracle, not a restatement of the
// code — `[].every(...)` is vacuously true, so an oracle without it would rubber-
// stamp an empty-requirement fail-open (see the dedicated case below).
const wfById = new Map<string, Flow>(DEMO_FLOWS.map((f) => [f.id, f] as const));
const healthyIds = (states: SignalState[]) => new Set(states.filter((s) => s.status === "healthy").map((s) => s.id));
const invariantHolds = (states: SignalState[]): boolean => {
  const ok = healthyIds(states);
  const cov = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, states);
  return cov.situations.every((s) => {
    if (s.status !== "auto_handled") return true;
    const wf = wfById.get(s.workflowId);
    return !!wf && wf.requiredSignals.length > 0 && wf.requiredSignals.every((sig) => ok.has(sig));
  });
};
const trials: SignalState[][] = [
  ALL_HEALTHY,
  missingCustody,
  staleCustody,
  [],
  ALL_HEALTHY.map((s) => ({ id: s.id, status: "broken" as const })),
  ALL_HEALTHY.filter((s) => s.id !== "identity"),
];
check("auto_handled ⇒ all required signals healthy (across states)", trials.every(invariantHolds));

// ── monotonic: adding a signal only ever raises coverage ─────────────────────
// Start empty, wire signals one at a time; coverage never decreases.
let prev = -1;
let monotonic = true;
for (let i = 0; i <= ALL_SIGNAL_IDS.length; i += 1) {
  const cov = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, healthy(ALL_SIGNAL_IDS.slice(0, i)));
  if (cov.coveragePct < prev) monotonic = false;
  prev = cov.coveragePct;
}
check("wiring signals one at a time never lowers coverage (monotonic)", monotonic);

// ── monotonic: adding a workflow only ever raises coverage ───────────────────
const cov0 = evaluateGridCoverage([], GRID_SITUATIONS, ALL_HEALTHY);
const cov1 = evaluateGridCoverage(DEMO_FLOWS.slice(0, 1), GRID_SITUATIONS, ALL_HEALTHY);
const cov2 = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, ALL_HEALTHY);
check("no active workflows → everything is a blind spot, 0% coverage", cov0.handled === 0 && cov0.blindSpots === GRID_SITUATIONS.length && cov0.coveragePct === 0);
check("activating workflows raises coverage step by step", cov0.coveragePct <= cov1.coveragePct && cov1.coveragePct <= cov2.coveragePct && cov2.coveragePct === 100);

// ── unknown workflow reference is a blind spot, never handled ─────────────────
const orphan = evaluateGridCoverage(DEMO_FLOWS, [{ id: "sit_x", label: "Unknown", workflowId: "flow_does_not_exist" }], ALL_HEALTHY);
check("a situation pointing at a non-active workflow is a blind_spot", orphan.situations[0].status === "blind_spot" && orphan.handled === 0);

// ── fail-safe: a workflow that requires NO signals is never auto_handled ──────
// A workflow with no inputs cannot detect or respond to anything — reporting it
// "handled" with nothing wired would be a false green over an unsensed threat.
const zeroSignalFlow: Flow = { id: "flow_empty", name: "Empty workflow", description: "", requiredSignals: [], actions: [], supportTeam: "", itsm: "", severityOnBreak: "sev3" };
const zeroSit: GridSituation = { id: "sit_empty", label: "Situation with a no-signal workflow", workflowId: "flow_empty" };
const zeroCov = evaluateGridCoverage([zeroSignalFlow], [zeroSit], []);
check("a workflow requiring no signals is NOT auto_handled (partial, fail-safe)", zeroCov.situations[0].status === "partial" && zeroCov.handled === 0 && zeroCov.coveragePct === 0);
// Even with signals wired, an empty-requirement workflow stays partial (no inputs).
const zeroCovFed = evaluateGridCoverage([zeroSignalFlow], [zeroSit], healthy(["identity", "custody"]));
check("an empty-requirement workflow stays partial even with signals wired", zeroCovFed.situations[0].status === "partial" && zeroCovFed.handled === 0);

// ── fail-closed: a duplicate SignalState (healthy + broken) resolves broken ────
const conflicting: SignalState[] = [...ALL_HEALTHY, { id: "custody", status: "broken" }];
const conflictCov = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, conflicting);
const conflictSit = conflictCov.situations.find((s) => s.workflowId === "flow_controlled_area")!;
check("a signal seen both healthy and broken resolves broken (most-severe wins)", conflictSit.status === "partial" && conflictSit.missingSignals.includes("custody"));

// ── fail-closed: a duplicate workflow id, one broken, is not masked ────────────
// Two active workflows share an id; the broken one must not be hidden by a
// healthy twin — the situation stays partial (most-restrictive wins).
const twinHealthy: Flow = { id: "flow_twin", name: "Twin", description: "", requiredSignals: ["identity"], actions: [], supportTeam: "", itsm: "", severityOnBreak: "sev3" };
const twinBroken: Flow = { ...twinHealthy, requiredSignals: ["identity", "custody"] };
const twinSit: GridSituation = { id: "sit_twin", label: "Twin situation", workflowId: "flow_twin" };
const twinCov = evaluateGridCoverage([twinHealthy, twinBroken], [twinSit], healthy(["identity"])); // custody NOT wired
check("a healthy duplicate workflow id cannot mask a broken twin", twinCov.situations[0].status === "partial" && twinCov.situations[0].missingSignals.includes("custody"));

// ── counting holds across a MIXED state (handled + partial + blind spot) ──────
const mixed = evaluateGridCoverage(withoutControlled, GRID_SITUATIONS, missingCustody);
check("handled+partial+blindSpots===total across a mixed state", mixed.handled + mixed.partial + mixed.blindSpots === mixed.total && mixed.total === GRID_SITUATIONS.length);

// ── determinism ──────────────────────────────────────────────────────────────
const a = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, missingCustody);
const b = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, missingCustody);
check("evaluation is deterministic", JSON.stringify(a) === JSON.stringify(b));

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
