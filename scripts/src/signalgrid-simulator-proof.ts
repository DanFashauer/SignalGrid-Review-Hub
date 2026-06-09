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

const scenarios = listSimulatorScenarios();
const results = scenarios.map(runScenario);
const assertions: Assertion[] = [];

for (const result of results) {
  assertions.push(assertion(`${result.scenario.id}: expected outcomes`, result.status === "PASS"));
  assertions.push(assertion(`${result.scenario.id}: audit evidence exists`, result.auditEvidence.length > 0));

  const needsOwner = result.routedActions.some((action) => action.kind !== "record_audit");
  if (needsOwner) {
    assertions.push(assertion(`${result.scenario.id}: routed owner exists`, result.routedActions.every((action) => Boolean(action.ownerTeam))));
  }
}

const byId = Object.fromEntries(results.map((result) => [result.scenario.id, result]));

assertions.push(assertion("non-compliant cannot allow", !hasOutcome(byId["non-compliant-clinical-device"], "allow")));
assertions.push(assertion("stale posture cannot fully trust", hasOutcome(byId["stale-checkin-shared-device"], "step_up") && !hasOutcome(byId["stale-checkin-shared-device"], "allow")));
assertions.push(assertion("security risk escalates", hasOwner(byId["edr-security-risk"], "Security operations")));
assertions.push(assertion("missing dock event routes action", hasOutcome(byId["dock-missing-overdue-device"], "route_to_owner")));
assertions.push(assertion("integration outage does not crash", byId["api-integration-outage"]?.status === "PASS"));
assertions.push(assertion("remediation verified records audit", hasOutcome(byId["remediation-verified"], "verify_remediation") && (byId["remediation-verified"]?.auditEvidence.length ?? 0) > 0));
assertions.push(assertion("all scenarios produce audit evidence", results.every((result) => result.auditEvidence.length > 0)));

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

function hasOutcome(result: SimulatorRunResult | undefined, outcome: DecisionOutcome): boolean {
  return Boolean(result?.decision.outcomes.includes(outcome));
}

function hasOwner(result: SimulatorRunResult | undefined, ownerTeam: string): boolean {
  return Boolean(result?.routedActions.some((action) => action.ownerTeam === ownerTeam));
}
