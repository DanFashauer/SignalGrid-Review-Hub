// Proof: the Trusted-Entry scenario runner (@workspace/room-sim), end to end.
//
// Runs BOTH scenario sets — smart-hospital (Northwind) and warehouse (Atlas) —
// through the REAL decision core and the orchestration layer, exactly as the
// hosted `/api/sim/*` route and the fully client-side console do. Asserts:
//   1. Each scenario evaluates under its OWN tenant's token (cross-tenant
//      evaluation is refused by design) and yields the expected outcome.
//   2. The warehouse pack spans the full spectrum: allow / step_up / restrict / deny.
//   3. Warehouse plans use the warehouse action catalog + supervisor language,
//      and the Assist safety invariant holds (no sensitive action ever auto).
//   4. Determinism: same scenario → identical result.
//
// Run: pnpm --filter @workspace/scripts run proof:room-sim

import { SignalGridCore } from "@workspace/signalgrid-core";
import { listScenarios, runRoomEntry, tenantForScenario, WAREHOUSE_SCENARIOS } from "@workspace/room-sim";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const core = SignalGridCore.demo();
const keys = core.demoApiKeys();
function tokenFor(tenantId: string): string {
  const preferred = keys.find((k) => k.tenantId === tenantId && (k.role === "operator" || k.role === "owner"));
  return (preferred ?? keys.find((k) => k.tenantId === tenantId))?.token ?? "";
}
const run = (id: string) => runRoomEntry(core, tokenFor(tenantForScenario(id)), id);

// Expected outcomes per warehouse scenario (the point of the pack).
const EXPECTED: Record<string, string> = {
  "wh-compliant-pick": "allow",
  "wh-compliant-cage": "allow",
  "wh-noncompliant-pick": "restrict",
  "wh-baseline-cage": "step_up",
  "wh-disabled-pick": "deny",
};

// 1. The combined listing exposes both verticals.
const listed = listScenarios();
check("scenario listing spans both verticals", listed.some((s) => s.domain === "clinical") && listed.some((s) => s.domain === "warehouse"));
check("warehouse pack has 5 scenarios", WAREHOUSE_SCENARIOS.length === 5);

// 2. Every warehouse scenario evaluates under the Atlas tenant and hits its outcome.
const outcomes = new Set<string>();
for (const s of WAREHOUSE_SCENARIOS) {
  check(`${s.id} routes to the atlas tenant`, tenantForScenario(s.id) === "tenant_atlas");
  const r = run(s.id);
  outcomes.add(r.decision.outcome);
  check(`${s.id} → ${EXPECTED[s.id]}`, r.decision.outcome === EXPECTED[s.id]);
}
check("warehouse pack spans allow + step_up + restrict + deny",
  ["allow", "step_up", "restrict", "deny"].every((o) => outcomes.has(o)));

// 3. Warehouse plans use the warehouse catalog + supervisor language + Assist safety.
const cage = run("wh-compliant-cage");
const cageKinds = cage.plan.actions.map((a) => a.kind);
check("controlled cage plan includes gate + cage + supervisor witness",
  cageKinds.includes("gate.unlock") && cageKinds.includes("cage.unlock") && cageKinds.includes("witness.require"));
check("controlled cage plan carries no clinical action kinds",
  !cageKinds.includes("door.unlock") && !cageKinds.includes("medication.cabinet.unlock"));
check("SAFETY: no sensitive warehouse action is ever auto on an allow",
  cage.plan.actions.every((a) => !(a.sensitive && a.disposition === "auto")));
check("warehouse plan speaks of a supervisor, not a clinician",
  cage.plan.summary.includes("supervisor") && !cage.plan.summary.includes("clinician"));

// A denied pick blocks everything; a restricted pick permits ambient prep only.
const denied = run("wh-disabled-pick");
check("disabled picker: every action blocked", denied.plan.actions.every((a) => a.disposition === "blocked"));
const restricted = run("wh-noncompliant-pick");
check("non-compliant picker: gate blocked, lighting still auto",
  restricted.plan.actions.find((a) => a.kind === "gate.unlock")?.disposition === "blocked" &&
  restricted.plan.actions.find((a) => a.kind === "environment.lighting")?.disposition === "auto");

// 4. Cross-tenant refusal — the hospital token cannot evaluate a warehouse subject.
let refused = false;
try { runRoomEntry(core, tokenFor("tenant_northwind"), "wh-compliant-pick"); } catch { refused = true; }
check("cross-tenant: hospital token cannot run a warehouse scenario", refused);

// 5. Determinism of the decision + plan (decisionId / latencyMs are per-call).
const stable = (id: string) => {
  const r = run(id);
  return JSON.stringify({ outcome: r.decision.outcome, reasonCodes: r.decision.reasonCodes, plan: r.plan, signals: r.signals });
};
check("warehouse decision + plan are deterministic", stable("wh-compliant-cage") === stable("wh-compliant-cage"));

// Sanity: the hospital pack still runs unchanged.
const hospital = run("compliant-medroom");
check("hospital scenario still allows + names the clinician",
  hospital.decision.outcome === "allow" && hospital.plan.summary.includes("clinician"));

const total = passed + failures.length;
console.log(`Room-sim proof: ${passed}/${total} assertions passed`);
if (failures.length) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("Trusted-Entry runner verified across verticals (hospital + warehouse), fail-closed + deterministic.");
