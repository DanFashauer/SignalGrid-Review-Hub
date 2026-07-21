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
