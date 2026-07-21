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
  fidelityOf,
  gridDoesLifting,
  isWireable,
  sourcingToSignalStates,
  summarizeSourcing,
  type Flow,
  type GridSituation,
  type SignalSource,
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

// ── signal sourcing: HOW a signal reaches the grid dictates the outcome ───────
// api/native → high fidelity; grid-collected (the grid does the lifting) → medium
// (low if degraded); unavailable → none. Only `unavailable` cannot be wired.
const src = (id: string, method: SignalSource["method"], degraded?: boolean): SignalSource => ({ id, name: id, system: "sys", method, degraded });
check("api & native signals are high fidelity", fidelityOf(src("a", "api")) === "high" && fidelityOf(src("b", "native")) === "high");
check("a grid-collected signal is medium fidelity (low if degraded)", fidelityOf(src("c", "grid_collected")) === "medium" && fidelityOf(src("d", "grid_collected", true)) === "low");
check("an unavailable signal has no fidelity", fidelityOf(src("e", "unavailable")) === "none");
check("only an unavailable signal is un-wireable", isWireable("api") && isWireable("native") && isWireable("grid_collected") && !isWireable("unavailable"));
check("only a grid-collected signal means the grid does the lifting", gridDoesLifting("grid_collected") && !gridDoesLifting("api") && !gridDoesLifting("native") && !gridDoesLifting("unavailable"));

// Fail-closed at the untyped boundary: an unknown/undefined method (from JSON)
// must be treated as ungettable — no wired state, not wireable, no fidelity —
// never wired as a present signal of unknown provenance.
const unknownSources = [src("custody", "collector" as never), src("id2", undefined as never)];
check("an unknown/undefined method yields no wired signal (fail-safe)", sourcingToSignalStates(unknownSources).length === 0);
check("an unknown/undefined method is not wireable", !isWireable("collector" as never) && !isWireable(undefined as never));
check("an unknown method has no fidelity (never undefined)", fidelityOf(src("z", "collector" as never)) === "none");
// Strongest single oracle: the wired count must equal the summary's wireable
// count for the SAME sources — catches any allowlist/denylist drift between them.
const agreeMix = [src("a", "api"), src("b", "unavailable"), src("c", "collector" as never), src("d", "grid_collected")];
check("wired signal count === summary.wireable (functions agree on the same input)", sourcingToSignalStates(agreeMix).length === summarizeSourcing(agreeMix).wireable);

// An unavailable source yields NO signal state (fail-safe — never pretend to have it).
const someUnavail = [src("identity", "api"), src("custody", "unavailable"), src("baseline", "grid_collected")];
const derivedStates = sourcingToSignalStates(someUnavail);
check("an unavailable source produces no wired signal (fail-safe)", !derivedStates.some((s) => s.id === "custody"));
check("api and grid-collected sources are wired healthy", derivedStates.find((s) => s.id === "identity")?.status === "healthy" && derivedStates.find((s) => s.id === "baseline")?.status === "healthy");

// Sourcing summary rolls up vendor-integrated vs grid-lifted vs gaps.
const summ = summarizeSourcing([src("a", "api"), src("b", "native"), src("c", "grid_collected"), src("d", "unavailable")]);
check("sourcing summary counts each path", summ.api === 1 && summ.native === 1 && summ.gridCollected === 1 && summ.unavailable === 1);
check("wireable = api+native+grid-collected; vendorIntegrated = api+native", summ.wireable === 3 && summ.vendorIntegrated === 2 && summ.total === 4);

// End-to-end: how the systems are configured dictates coverage.
// (a) Every required signal available via API → the grid handles everything.
const allApi: SignalSource[] = ALL_SIGNAL_IDS.map((id) => src(id, "api"));
const covApi = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, sourcingToSignalStates(allApi));
check("all signals API-sourced → full coverage", covApi.coveragePct === 100);
// (b) The grid does the lifting for one required signal → still wired → still handled.
const withLift: SignalSource[] = ALL_SIGNAL_IDS.map((id) => src(id, id === "custody" ? "grid_collected" : "api"));
const covLift = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, sourcingToSignalStates(withLift));
check("a grid-collected required signal still yields full coverage (grid does the lifting)", covLift.coveragePct === 100 && summarizeSourcing(withLift).gridCollected === 1);
// (c) A required signal is unavailable → its situation drops (a real gap, fail-safe).
const withGap: SignalSource[] = ALL_SIGNAL_IDS.map((id) => src(id, id === "custody" ? "unavailable" : "api"));
const covGap = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, sourcingToSignalStates(withGap));
const gapSit = covGap.situations.find((s) => s.workflowId === "flow_controlled_area")!;
check("an unavailable required signal drops its situation (never a false green)", gapSit.status === "partial" && gapSit.missingSignals.includes("custody") && covGap.coveragePct < 100);

// ── determinism ──────────────────────────────────────────────────────────────
const a = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, missingCustody);
const b = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, missingCustody);
check("evaluation is deterministic", JSON.stringify(a) === JSON.stringify(b));

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
