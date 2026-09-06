// Fabric decision-evals — fully OFFLINE and deterministic.
//
// Per-connector proofs each check ONE dimension's logic. This is the layer above:
// a curated golden set of end-to-end, MULTI-signal scenarios scored against the
// FUSED outcome — the composed risk verdict AND the routed incident. It catches
// cross-fabric "decision drift" that no single-connector proof can: a change that
// quietly lets one dimension dilute another, mis-orders worst-concern-wins, or
// mis-routes the top driver would pass every connector proof yet fail here.
//
// Beyond matching each scenario's expected outcome, the harness enforces two
// fabric-wide INVARIANTS computed independently of the fixtures:
//   1. Fail-safe: if ANY signal warrants more than monitoring, the fused verdict is
//      NEVER the healthy 'ok' tier (a clean device cannot bury one bad signal).
//   2. Worst-concern-wins: the fused action is exactly the most-severe signal's
//      action on the unified ladder — no averaging, no dilution.
// A regression in the fusion or incident-mapping contract shows up as a nonzero
// violation count, not a silently-wrong verdict. No network.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACTION_RANK,
  composeDeviceRisk,
  type ComposableSignal,
  type UnifiedAction,
} from "@workspace/posture-composition";
import { mapPostureToIncident, type Impact } from "@workspace/incident-playbook";

interface Expected {
  riskTier: string;
  strongestAction: string;
  opensIncident: boolean;
  incidentAssignmentGroup?: string;
  incidentPriority?: string;
}
interface Scenario {
  id: string;
  description: string;
  signals: ComposableSignal[];
  expected: Expected;
}
interface Suite {
  impactForIncident: Impact;
  scenarios: Scenario[];
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/fabric-evals/scenarios.json");
const suite = JSON.parse(await readFile(fixturePath, "utf8")) as Suite;

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Fabric decision-evals");
console.log(`scenarios=${suite.scenarios.length} impact=${suite.impactForIncident}`);

// The worst action a set of signals warrants, by rank on the unified ladder.
const worstAction = (signals: ComposableSignal[]): UnifiedAction =>
  signals.reduce<UnifiedAction>((max, s) => (ACTION_RANK[s.action] > ACTION_RANK[max] ? s.action : max), "none");

const MONITOR_RANK = ACTION_RANK["monitor"];

let scored = 0;
let matched = 0;
let failSafeViolations = 0;
let worstWinsViolations = 0;

for (const sc of suite.scenarios) {
  scored += 1;
  const posture = composeDeviceRisk(sc.signals);
  const incident = mapPostureToIncident(posture, { impact: suite.impactForIncident, correlationId: `eval-${sc.id}` });

  // ── fabric-wide invariants (computed here, NOT read from the fixture) ──────────
  // 1. Fail-safe: anything beyond monitoring ⟹ never the 'ok' tier.
  const hasActionableSignal = sc.signals.some((s) => ACTION_RANK[s.action] > MONITOR_RANK);
  if (hasActionableSignal && posture.riskTier === "ok") failSafeViolations += 1;
  // 2. Worst-concern-wins: fused action === the most-severe signal's action.
  if (posture.strongestAction !== worstAction(sc.signals)) worstWinsViolations += 1;

  // ── per-scenario expected outcome ─────────────────────────────────────────────
  const tierOk = posture.riskTier === sc.expected.riskTier;
  const actionOk = posture.strongestAction === sc.expected.strongestAction;
  const opensOk = (incident !== null) === sc.expected.opensIncident;
  const routeOk =
    !sc.expected.opensIncident ||
    (incident !== null &&
      incident.assignmentGroup === sc.expected.incidentAssignmentGroup &&
      incident.priority === sc.expected.incidentPriority);
  const ok = tierOk && actionOk && opensOk && routeOk;
  if (ok) matched += 1;
  check(`${sc.id} → ${sc.expected.riskTier}/${sc.expected.strongestAction}${sc.expected.opensIncident ? ` → ${sc.expected.incidentAssignmentGroup} ${sc.expected.incidentPriority}` : " (no incident)"}`, ok);
}

// ── fabric-wide invariant assertions ──────────────────────────────────────────
check(`fail-safe holds across ALL scenarios (violations=${failSafeViolations})`, failSafeViolations === 0);
check(`worst-concern-wins holds across ALL scenarios (violations=${worstWinsViolations})`, worstWinsViolations === 0);

// A calm scenario (none/monitor only) must NEVER open an incident — no ticket noise.
// THE GOLDEN SET MUST CONTAIN ONE, and that is now asserted. This block used to be a
// bare `if (calm) { check(...) }`: edit the committed fixture so every scenario carries an
// actionable signal and the no-noise rule — one of the two properties this file's header
// leads with — is asserted by NOTHING, while the suite prints the same pass with one
// fewer check and says nothing about it.
const calm = suite.scenarios.find((s) => s.signals.every((x) => ACTION_RANK[x.action] <= MONITOR_RANK));
if (calm) {
  const inc = mapPostureToIncident(composeDeviceRisk(calm.signals), { impact: suite.impactForIncident, correlationId: "eval-calm" });
  check(`a calm (none/monitor) scenario opens NO incident (${calm.id})`, inc === null);
} else {
  check("the golden set contains a calm (none/monitor) scenario to test the no-noise rule against — without one the rule is asserted by nothing", false);
}

// Determinism: the whole suite composes identically on a re-run.
const once = suite.scenarios.map((s) => JSON.stringify(composeDeviceRisk(s.signals)));
const twice = suite.scenarios.map((s) => JSON.stringify(composeDeviceRisk(s.signals)));
check("the fabric is deterministic across the whole suite", JSON.stringify(once) === JSON.stringify(twice));

// Coverage: at least one scenario exercises each risk tier the ladder can reach.
const tiers = new Set(suite.scenarios.map((s) => composeDeviceRisk(s.signals).riskTier));
check("the golden set covers every risk tier (ok / watch / at_risk / blocked)", ["ok", "watch", "at_risk", "blocked"].every((t) => tiers.has(t as never)));

const accuracy = scored === 0 ? 0 : Math.round((matched / scored) * 100);
console.log(`eval: scenarios=${scored} matched=${matched} accuracy=${accuracy}% fail_safe_violations=${failSafeViolations} worst_wins_violations=${worstWinsViolations}`);
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
