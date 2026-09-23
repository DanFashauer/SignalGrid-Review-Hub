import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  listSimulatorScenarios,
  runScenario,
  type DecisionOutcome,
  type SignalGridSignal,
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
  // The custody-removal pair is asserted TOGETHER on purpose: the same lift, differing
  // only in whether a session claims it. Without the second row a removal rule that
  // fired on every legitimate checkout would still look green here.
  "custody-removal-without-session": ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
  "custody-removal-with-session": ["allow", "record_audit"],
  "puck-session-lifecycle": ["step_up", "alert_operator", "create_ticket", "route_to_owner", "request_remediation", "record_audit"],
  "smart-charging-checkout-to-checkin": ["allow", "record_audit"],
  "low-battery-workflow-impact": ["alert_operator", "route_to_owner", "record_audit"],
  "operational-health-degradation": ["create_ticket", "route_to_owner", "record_audit"],
  "edr-security-risk": ["restrict", "alert_operator", "route_to_owner", "record_audit"],
  "api-integration-outage": ["alert_operator", "route_to_owner", "record_audit"],
  "remediation-verified": ["verify_remediation", "allow", "record_audit"],
  // The smart-charging custody journey (DR-054). Held here as well as in
  // `proof:custody-journey` deliberately: this map asserts the EXACT outcome set
  // for every scenario the engine declares, so a journey stage added without an
  // entry fails on the `expected !== undefined` check rather than being skipped.
  "custody-journey-01-badge-tap": ["allow", "record_audit"],
  "custody-journey-02-dock-release": ["allow", "record_audit"],
  "custody-journey-03-provision": ["allow", "record_audit"],
  "custody-journey-04-in-use": ["allow", "record_audit"],
  "custody-journey-05-check-in": ["allow", "record_audit"],
  "custody-journey-branch-unpaired": ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
  "custody-journey-branch-network-down": ["step_up", "request_remediation", "record_audit"],
  "custody-journey-branch-cap-hit": ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
  "custody-journey-branch-dock-fault": ["alert_operator", "create_ticket", "route_to_owner", "record_audit"],
};

const scenarios = listSimulatorScenarios();
const results = scenarios.map(runScenario);
const assertions: Assertion[] = [];

for (const result of results) {
  const expected = expectedOutcomeSets[result.scenario.id];
  assertions.push(assertion(`${result.scenario.id}: exact outcome set`, expected !== undefined && sameOutcomeSet(result.decision.outcomes, expected)));
  // `createAuditEvidence` returns an unconditional two-element array, so
  // `auditEvidence.length > 0` could never fail (eighth verdict-core round). What
  // CAN fail: the decision trace must reference the decision AND every starting
  // signal, the routing trace must reference every routed action, and the two
  // records must carry distinct ids.
  const trace = result.auditEvidence.find((r) => r.evidenceType === "decision_trace");
  const routing = result.auditEvidence.find((r) => r.evidenceType === "routing_trace");
  assertions.push(assertion(
    `${result.scenario.id}: decision trace references the decision and every starting signal`,
    trace !== undefined &&
      trace.references.includes(result.decision.id) &&
      result.scenario.startingSignals.every((sig) => trace.references.includes(sig.id)),
  ));
  assertions.push(assertion(
    `${result.scenario.id}: routing trace references every routed action, and only those`,
    routing !== undefined &&
      routing.references.length === result.routedActions.length &&
      result.routedActions.every((a) => routing.references.includes(a.id)),
  ));
  assertions.push(assertion(
    `${result.scenario.id}: audit record ids are distinct`,
    new Set(result.auditEvidence.map((r) => r.id)).size === result.auditEvidence.length,
  ));

  const needsOwner = result.routedActions.some((action) => action.kind !== "record_audit");
  if (needsOwner) {
    assertions.push(assertion(`${result.scenario.id}: routed owner exists`, result.routedActions.every((action) => Boolean(action.ownerTeam))));
  }
}

const byId = Object.fromEntries(results.map((result) => [result.scenario.id, result]));

assertions.push(assertion("non-compliant cannot allow", !hasOutcome(byId["non-compliant-clinical-device"], "allow")));
assertions.push(assertion("Apple declared state supports allow with audit", hasOutcome(byId["apple-ddm-platform-sso-state"], "allow") && hasOutcome(byId["apple-ddm-platform-sso-state"], "record_audit") && byId["apple-ddm-platform-sso-state"]?.decision.reasonCodes.includes("APPLE_DECLARED_STATE_TRUSTED") === true));
assertions.push(assertion("stale posture cannot fully trust", hasOutcome(byId["stale-checkin-shared-device"], "step_up") && !hasOutcome(byId["stale-checkin-shared-device"], "allow")));
assertions.push(assertion("security risk escalates", hasOwner(byId["edr-security-risk"], "Security operations")));
assertions.push(assertion("missing dock event routes action", hasOutcome(byId["dock-missing-overdue-device"], "route_to_owner")));
assertions.push(assertion("edr-security-risk never allows", !hasOutcome(byId["edr-security-risk"], "allow")));
assertions.push(assertion("wrong-zone-rtls-event never allows", !hasOutcome(byId["wrong-zone-rtls-event"], "allow")));
assertions.push(assertion("dock-missing-overdue-device never allows", !hasOutcome(byId["dock-missing-overdue-device"], "allow")));
assertions.push(assertion("integration outage does not crash", byId["api-integration-outage"]?.status === "PASS"));
assertions.push(assertion("remediation verified records audit", hasOutcome(byId["remediation-verified"], "verify_remediation") && hasOutcome(byId["remediation-verified"], "record_audit")));
assertions.push(assertion("every scenario's decision trace names its own decision id (no cross-scenario reference)", results.every((result) => result.auditEvidence.some((r) => r.evidenceType === "decision_trace" && r.references[0] === `decision:${result.scenario.id}`))));

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

// ── THE SMART-CHARGING WORKFLOW'S FOUR FAILURE BRANCHES ──────────────────────
//
// The scenario above is the happy path, and a happy path alone is the abstraction the
// custody ground-truth document complained about. The four branches that actually
// happen in a charging cabinet are derived FROM that fixture — same device, same bay,
// same shift — so each one differs from the green run by exactly the fact it names.
// A branch built from scratch could differ in ten ways and prove nothing about which.
const charging = listSimulatorScenarios().find((s) => s.id === "smart-charging-checkout-to-checkin");
function chargingBranch(id: string, expected: DecisionOutcome[], mutate: (signals: SignalGridSignal[]) => SignalGridSignal[]): SimulatorRunResult | undefined {
  if (!charging) return undefined;
  return runScenario({ ...charging, id, expectedOutcomes: expected, startingSignals: mutate([...charging.startingSignals]) });
}
const withAttrs = (signal: SignalGridSignal, attributes: Record<string, string | number | boolean | null>): SignalGridSignal =>
  ({ ...signal, attributes: { ...signal.attributes, ...attributes } });

// UNPAIRED — the device leaves the cabinet and no assignment claims it. Fail-closed on
// ABSENCE: the lack of an owning session is not permission for the lift.
const unpaired = chargingBranch("smart-charging-unpaired", ["create_ticket", "alert_operator", "route_to_owner", "record_audit"], (sigs) =>
  sigs.map((sig) => (sig.type === "workflow.assignment_changed" ? withAttrs(sig, { active: false }) : sig)));
assertions.push(assertion("smart charging / unpaired: an unclaimed checkout raises a custody exception",
  unpaired !== undefined && sameOutcomeSet(unpaired.decision.outcomes, ["create_ticket", "alert_operator", "route_to_owner", "record_audit"])));
assertions.push(assertion("smart charging / unpaired: never allows", !hasOutcome(unpaired, "allow")));

// NETWORK-DOWN — the cabinet's controller is unreachable. The route degrades and is
// reported; it does not silently succeed, and it does not abort the shift either.
const networkDown = chargingBranch("smart-charging-network-down", ["alert_operator", "route_to_owner", "record_audit"], (sigs) => [
  ...sigs,
  { id: "api.integration_failed:integration-charging-controller", type: "api.integration_failed", layer: "integration", source: "Integration health fixture", subject: "integration:charging-controller", observedAt: sigs[0].observedAt, severity: "high", summary: "The cabinet controller is unreachable; provisioning events are queued", attributes: { target: "charging-controller", state: "unavailable" } },
]);
assertions.push(assertion("smart charging / network-down: an unreachable controller degrades the route and is reported",
  networkDown !== undefined && networkDown.decision.reasonCodes.includes("INTEGRATION_ROUTE_DEGRADED")));
assertions.push(assertion("smart charging / network-down: never allows on an unreachable downstream", !hasOutcome(networkDown, "allow")));

// CAP-HIT — the charge cap held the battery where policy asked, and the shift is
// starting on what is left. A workflow risk to route, not a security event.
const capHit = chargingBranch("smart-charging-cap-hit", ["route_to_owner", "alert_operator", "record_audit"], (sigs) => [
  ...sigs,
  { id: "device.low_battery:device-ios-shared-700", type: "device.low_battery", layer: "device", source: "Device telemetry fixture", subject: "device:ios-shared-700", observedAt: sigs[0].observedAt, severity: "high", summary: "Charge cap reached at 22% — the device goes out under-charged for a full round", attributes: { batteryPct: 22, chargeCapPct: 80, capHit: true } },
]);
assertions.push(assertion("smart charging / cap-hit: an under-charged checkout routes to the owner",
  capHit !== undefined && capHit.decision.reasonCodes.includes("BATTERY_WORKFLOW_RISK")));
assertions.push(assertion("smart charging / cap-hit: never allows while the workflow risk is open", !hasOutcome(capHit, "allow")));

// DOCK-FAULT — the device came back to the wrong bay. The return is not a return until
// the bay agrees, and a dock exception is a ticket rather than a shrug.
const dockFault = chargingBranch("smart-charging-dock-fault", ["create_ticket", "alert_operator", "route_to_owner", "record_audit"], (sigs) => [
  ...sigs,
  { id: "dock.wrong_slot_return:device-ios-shared-700", type: "dock.wrong_slot_return", layer: "dockbridge", source: "DockBridge fixture", subject: "device:ios-shared-700", observedAt: sigs[0].observedAt, severity: "high", summary: "Device returned to a bay the assignment does not name", attributes: { dockId: "CAB-01", slot: "04", returnBay: "wrong" } },
]);
assertions.push(assertion("smart charging / dock-fault: a wrong-bay return raises a dock exception",
  dockFault !== undefined && dockFault.decision.reasonCodes.includes("DOCK_EXCEPTION")));
assertions.push(assertion("smart charging / dock-fault: never allows", !hasOutcome(dockFault, "allow")));

// THE LOAD-BEARING NEGATIVE. All four branches would look identical on a tree where the
// happy path also failed — so the happy path's allow is asserted HERE, beside them, as
// the thing each branch is a departure from.
assertions.push(assertion("smart charging: the happy path is the only one of the five that allows",
  hasOutcome(byId["smart-charging-checkout-to-checkin"], "allow") &&
    [unpaired, networkDown, capHit, dockFault].every((r) => r !== undefined && !r.decision.outcomes.includes("allow"))));

// ── THE PUCK LIFECYCLE'S ONE LOAD-BEARING CLAIM ──────────────────────────────
// A re-dock inside the window must not resume anything on its own. The scenario carries
// the re-dock AND the removal; if a future engine change let a fresh `dock.device_docked`
// cancel the removal, this goes red while the outcome-set row above would not notice a
// step_up becoming an allow only if the set were also edited.
assertions.push(assertion("puck lifecycle: a re-dock within N seconds does not resume — no allow",
  !hasOutcome(byId["puck-session-lifecycle"], "allow")));
assertions.push(assertion("puck lifecycle: the removal is still a custody exception after the re-dock",
  byId["puck-session-lifecycle"]?.decision.reasonCodes.includes("CUSTODY_EXCEPTION") === true));

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
