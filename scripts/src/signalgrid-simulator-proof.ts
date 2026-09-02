import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listSimulatorScenarios,
  runScenario,
  type DecisionOutcome,
  type SimulatorRunResult,
} from "@workspace/signalgrid-simulator";

interface Assertion {
  name: string;
  passed: boolean;
}

// Independent, hardcoded expectation of the FULL decision outcome set for each
// scenario. Using an exact set (not the product's own subset-based status flag)
// means a spurious extra outcome — e.g. a stray "allow" on a high-risk case — is
// caught instead of silently passing a subset check against product-derived data.
const expectedOutcomeSets: Record<string, DecisionOutcome[]> = {
  "apple-ddm-platform-sso-state": ["allow", "record_audit"],
  "healthy-shared-device-checkout": ["allow", "record_audit"],
  "non-compliant-clinical-device": ["restrict", "alert_operator", "create_ticket", "record_audit"],
  "stale-checkin-shared-device": ["step_up", "request_remediation", "record_audit"],
  "wrong-zone-rtls-event": ["alert_operator", "route_to_owner", "record_audit"],
  "dock-missing-overdue-device": ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
  "low-battery-workflow-impact": ["alert_operator", "route_to_owner", "record_audit"],
  "operational-health-degradation": ["create_ticket", "route_to_owner", "record_audit"],
  "edr-security-risk": ["restrict", "alert_operator", "route_to_owner", "record_audit"],
  "api-integration-outage": ["alert_operator", "route_to_owner", "record_audit"],
  "remediation-verified": ["verify_remediation", "allow", "record_audit"],
};

const scenarios = listSimulatorScenarios();
const results = scenarios.map(runScenario);
const assertions: Assertion[] = [];

for (const result of results) {
  const expected = expectedOutcomeSets[result.scenario.id];
  assertions.push(assertion(`${result.scenario.id}: exact outcome set`, expected !== undefined && sameOutcomeSet(result.decision.outcomes, expected)));
  assertions.push(assertion(`${result.scenario.id}: audit evidence exists`, result.auditEvidence.length > 0));

  const needsOwner = result.routedActions.some((action) => action.kind !== "record_audit");
  if (needsOwner) {
    assertions.push(assertion(`${result.scenario.id}: routed owner exists`, result.routedActions.every((action) => Boolean(action.ownerTeam))));
  }
}

const byId = Object.fromEntries(results.map((result) => [result.scenario.id, result]));

assertions.push(assertion("non-compliant cannot allow", !hasOutcome(byId["non-compliant-clinical-device"], "allow")));
assertions.push(assertion("Apple declared state supports allow with audit", hasOutcome(byId["apple-ddm-platform-sso-state"], "allow") && (byId["apple-ddm-platform-sso-state"]?.auditEvidence.length ?? 0) > 0));
assertions.push(assertion("stale posture cannot fully trust", hasOutcome(byId["stale-checkin-shared-device"], "step_up") && !hasOutcome(byId["stale-checkin-shared-device"], "allow")));
assertions.push(assertion("security risk escalates", hasOwner(byId["edr-security-risk"], "Security operations")));
assertions.push(assertion("missing dock event routes action", hasOutcome(byId["dock-missing-overdue-device"], "route_to_owner")));
assertions.push(assertion("edr-security-risk never allows", !hasOutcome(byId["edr-security-risk"], "allow")));
assertions.push(assertion("wrong-zone-rtls-event never allows", !hasOutcome(byId["wrong-zone-rtls-event"], "allow")));
assertions.push(assertion("dock-missing-overdue-device never allows", !hasOutcome(byId["dock-missing-overdue-device"], "allow")));
assertions.push(assertion("integration outage does not crash", byId["api-integration-outage"]?.status === "PASS"));
assertions.push(assertion("remediation verified records audit", hasOutcome(byId["remediation-verified"], "verify_remediation") && (byId["remediation-verified"]?.auditEvidence.length ?? 0) > 0));
assertions.push(assertion("all scenarios produce audit evidence", results.every((result) => result.auditEvidence.length > 0)));

// NEGATIVE CONTROL (review finding): remediation evidence WITHOUT base trust must
// never allow. The shipping remediation scenario now carries an authenticated
// identity, so on its own it can no longer catch the unconditional-allow regression
// this pins — derive the unsafe input from it by stripping the identity signal and
// prove the engine refuses. If the engine's old `outcomes.add("allow")` returns,
// THIS assertion goes red even while every scenario expectation stays green.
const remScenario = listSimulatorScenarios().find((s) => s.id === "remediation-verified");
const remWithoutBaseTrust = remScenario
  ? runScenario({
      ...remScenario,
      id: "remediation-without-base-trust",
      expectedOutcomes: ["verify_remediation", "record_audit"] as DecisionOutcome[],
      startingSignals: remScenario.startingSignals.filter((s) => s.type !== "identity.authenticated"),
    })
  : undefined;
assertions.push(assertion(
  "remediation WITHOUT base trust never allows (fail-closed)",
  remWithoutBaseTrust !== undefined &&
    !remWithoutBaseTrust.decision.outcomes.includes("allow") &&
    remWithoutBaseTrust.decision.outcomes.includes("verify_remediation"),
));

// ── ORDER LIST ≡ DecisionOutcome UNION (verdict-core finding V1, 2026-09-02) ──
//
// `orderOutcomes` in lib/signalgrid-simulator/src/decisionEngine.ts filters a
// HARDCODED list of outcomes and returns only the members it names. A
// DecisionOutcome that exists in the union but is missing from that list is
// therefore dropped from `decision.outcomes` entirely — and because
// `primaryOutcome` is `ordered[0]`, dropping a restrictive member moves the
// primary outcome in the PERMISSIVE direction, silently. The engine itself is a
// byte-faithful twin of the Swift port (CLAUDE.md golden rule 1), so this is
// checked from OUTSIDE it: both lists are parsed lexically from source and
// compared as sets. Nothing here edits or imports the engine's internals.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const enginePath = `${repoRoot}/lib/signalgrid-simulator/src/decisionEngine.ts`;
const typesPath = `${repoRoot}/lib/signalgrid-simulator/src/types.ts`;

/** The literal members of the ORDER array inside `orderOutcomes`. */
function parseOrderList(engineSource: string): string[] {
  const m = /function orderOutcomes\([\s\S]*?const order: DecisionOutcome\[\] = \[([\s\S]*?)\];/.exec(engineSource);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}

/** The literal members of the exported `DecisionOutcome` union. */
function parseOutcomeUnion(typesSource: string): string[] {
  const m = /export type DecisionOutcome =([\s\S]*?);/.exec(typesSource);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
}

/** Members of the union that ORDER does not name — i.e. silently droppable. */
function droppedByOrder(union: string[], order: string[]): string[] {
  return union.filter((member) => !order.includes(member));
}

const engineSource = readFileSync(enginePath, "utf8");
const typesSource = readFileSync(typesPath, "utf8");
const orderList = parseOrderList(engineSource);
const outcomeUnion = parseOutcomeUnion(typesSource);

// Vacuity floors FIRST: a parse that found nothing must never read as agreement.
assertions.push(assertion(
  `order-list parse floor: orderOutcomes names >= 10 outcomes (found ${orderList.length})`,
  orderList.length >= 10,
));
assertions.push(assertion(
  `DecisionOutcome union parse floor: >= 10 members (found ${outcomeUnion.length})`,
  outcomeUnion.length >= 10,
));
const droppedToday = droppedByOrder(outcomeUnion, orderList);
assertions.push(assertion(
  `every DecisionOutcome is named in orderOutcomes' ORDER list (dropped: ${droppedToday.join(", ") || "none"})`,
  droppedToday.length === 0,
));
const strangers = orderList.filter((o) => !outcomeUnion.includes(o));
assertions.push(assertion(
  `ORDER names no outcome the union does not declare (extra: ${strangers.join(", ") || "none"})`,
  strangers.length === 0,
));
assertions.push(assertion(
  "ORDER lists each outcome exactly once",
  new Set(orderList).size === orderList.length,
));
assertions.push(assertion(
  "ORDER is fail-closed at the head: deny/restrict/step_up precede allow",
  ["deny", "restrict", "step_up"].every(
    (o) => orderList.indexOf(o) !== -1 && orderList.indexOf(o) < orderList.indexOf("allow"),
  ),
));

// SYNTHETIC VIOLATION — the check must be able to fail. An 11th union member is
// planted in a COPY of the types source (the tree is never touched) and the same
// comparison must flag it; and a member removed from a COPY of the ORDER list
// must be flagged too. If either stays silent, the check above proves nothing.
const plantedUnion = parseOutcomeUnion(
  typesSource.replace('export type DecisionOutcome =\n  | "allow"', 'export type DecisionOutcome =\n  | "quarantine"\n  | "allow"'),
);
assertions.push(assertion(
  "self-test: a planted 11th DecisionOutcome member is reported as dropped by ORDER",
  plantedUnion.length === outcomeUnion.length + 1 &&
    droppedByOrder(plantedUnion, orderList).includes("quarantine"),
));
const shortenedOrder = parseOrderList(engineSource.replace('    "deny",\n', ""));
assertions.push(assertion(
  "self-test: an outcome deleted from a copy of the ORDER list is reported as dropped",
  shortenedOrder.length === orderList.length - 1 &&
    droppedByOrder(outcomeUnion, shortenedOrder).includes("deny"),
));

const failed = assertions.filter((item) => !item.passed);

console.log(`SignalGrid simulator proof: ${assertions.length - failed.length}/${assertions.length} assertions passed`);
for (const result of results) {
  console.log(`- ${result.status} ${result.scenario.id}: ${result.decision.primaryOutcome} -> ${result.routedActions.map((action) => action.ownerTeam).join(", ")}`);
}

if (failed.length > 0) {
  console.error("Failed assertions:");
  for (const item of failed) {
    console.error(`- ${item.name}`);
  }
  process.exit(1);
}

function assertion(name: string, passed: boolean): Assertion {
  return { name, passed };
}

function sameOutcomeSet(actual: DecisionOutcome[], expected: DecisionOutcome[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }
  const actualSet = new Set(actual);
  return actualSet.size === actual.length && expected.every((outcome) => actualSet.has(outcome));
}

function hasOutcome(result: SimulatorRunResult | undefined, outcome: DecisionOutcome): boolean {
  return Boolean(result?.decision.outcomes.includes(outcome));
}

function hasOwner(result: SimulatorRunResult | undefined, ownerTeam: string): boolean {
  return Boolean(result?.routedActions.some((action) => action.ownerTeam === ownerTeam));
}
