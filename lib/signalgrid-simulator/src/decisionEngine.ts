import { createAuditEvidence } from "./audit";
import { routeDecision } from "./routing";
import { simulatorScenarios } from "./scenarios";
import type {
  DecisionOutcome,
  SignalGridDecision,
  SignalGridSignal,
  SimulatorRunResult,
  SimulatorScenario,
} from "./types";

const evaluationTime = "2026-06-09T14:05:00.000Z";

export function listSimulatorScenarios(): SimulatorScenario[] {
  return simulatorScenarios;
}

export function getSimulatorScenario(
  id: string,
): SimulatorScenario | undefined {
  return simulatorScenarios.find((scenario) => scenario.id === id);
}

export function runSimulatorScenario(scenarioId: string): SimulatorRunResult {
  const scenario = getSimulatorScenario(scenarioId);
  if (!scenario) {
    throw new Error(`Unknown simulator scenario: ${scenarioId}`);
  }

  return runScenario(scenario);
}

export function runScenario(scenario: SimulatorScenario): SimulatorRunResult {
  const normalizedSignals = normalizeSignals(scenario.startingSignals);
  const decision = evaluateScenario(scenario, normalizedSignals);
  const routedActions = routeDecision(scenario, decision.outcomes);
  const auditEvidence = createAuditEvidence(scenario, decision, routedActions);
  const status =
    scenario.expectedOutcomes.every((outcome) =>
      decision.outcomes.includes(outcome),
    ) && auditEvidence.length > 0
      ? "PASS"
      : "FAIL";

  return {
    scenario,
    normalizedSignals,
    decision,
    routedActions,
    auditEvidence,
    status,
  };
}

export function normalizeSignals(
  signals: SignalGridSignal[],
): SignalGridSignal[] {
  return signals.map((signal) => ({
    ...signal,
    attributes: {
      ...signal.attributes,
      normalized: true,
      simulatorOnly: true,
    },
  }));
}

function evaluateScenario(
  scenario: SimulatorScenario,
  signals: SignalGridSignal[],
): SignalGridDecision {
  const hasType = (type: SignalGridSignal["type"]) =>
    signals.some((signal) => signal.type === type);
  const hasCriticalOrHighSecurityRisk = signals.some(
    (signal) =>
      signal.type === "identity.risk_detected" ||
      signal.attributes["securityRisk"] === "high" ||
      signal.attributes["edr"] === "disabled" ||
      signal.attributes["edrRisk"] === "high",
  );
  const hasIdentityIntegrityFailure = signals.some(
    (signal) =>
      signal.layer === "identity" &&
      (signal.attributes["identityState"] === "invalid" ||
        signal.attributes["identityState"] === "disabled" ||
        signal.attributes["risk"] === "high"),
  );
  const hasDeviceTrustFailure = signals.some(
    (signal) =>
      signal.attributes["compliance"] === "non_compliant" ||
      signal.attributes["managementState"] === "unmanaged" ||
      signal.attributes["deviceCompromised"] === true ||
      signal.attributes["sourceIntegrity"] === "failed",
  );
  const hasStateFreshnessFailure = signals.some(
    (signal) =>
      signal.attributes["declaredState"] === "stale" ||
      signal.attributes["ssoStatus"] === "missing" ||
      signal.attributes["freshness"] === "stale" ||
      signal.attributes["criticalInput"] === "malformed",
  );
  const hasCustodyFailure = signals.some(
    (signal) =>
      signal.attributes["zone"] === "wrong" ||
      signal.attributes["location"] === "unknown" ||
      signal.attributes["missingReturn"] === true ||
      signal.attributes["overdue"] === true ||
      signal.attributes["returnBay"] === "wrong",
  );
  const hasWorkflowRoutingFailure = signals.some(
    (signal) =>
      signal.attributes["workflowOwner"] === "missing" ||
      signal.attributes["requiredApproval"] === "missing" ||
      signal.attributes["escalationDestination"] === "unavailable",
  );
  const hasActiveCustodyIntegrityFailure =
    hasCustodyFailure ||
    hasType("dock.device_missing") ||
    hasType("dock.wrong_slot_return") ||
    hasType("rtls.wrong_zone") ||
    hasType("rts.staff_safety_alert");
  const outcomes = new Set<DecisionOutcome>();
  const reasonCodes: string[] = [];

  if (hasIdentityIntegrityFailure) {
    outcomes.add("restrict");
    outcomes.add("alert_operator");
    outcomes.add("route_to_owner");
    reasonCodes.push("IDENTITY_INTEGRITY_FAILURE");
  }

  if (hasDeviceTrustFailure) {
    outcomes.add("restrict");
    outcomes.add("create_ticket");
    outcomes.add("alert_operator");
    reasonCodes.push("DEVICE_TRUST_FAILURE");
  }

  if (hasStateFreshnessFailure) {
    outcomes.add("step_up");
    outcomes.add("request_remediation");
    reasonCodes.push("STATE_FRESHNESS_FAILURE");
  }

  if (hasCustodyFailure) {
    outcomes.add("create_ticket");
    outcomes.add("alert_operator");
    outcomes.add("route_to_owner");
    reasonCodes.push("CUSTODY_EXCEPTION");
  }

  if (hasWorkflowRoutingFailure) {
    outcomes.add("step_up");
    outcomes.add("alert_operator");
    outcomes.add("route_to_owner");
    reasonCodes.push("WORKFLOW_ROUTE_UNAVAILABLE");
  }

  if (hasType("device.non_compliant")) {
    outcomes.add("restrict");
    outcomes.add("create_ticket");
    outcomes.add("alert_operator");
    reasonCodes.push("DEVICE_NON_COMPLIANT");
  }

  if (hasType("device.stale_checkin")) {
    outcomes.add("step_up");
    outcomes.add("request_remediation");
    reasonCodes.push("POSTURE_STALE");
  }

  if (hasType("dock.device_missing") || hasType("dock.wrong_slot_return")) {
    outcomes.add("create_ticket");
    outcomes.add("alert_operator");
    outcomes.add("route_to_owner");
    reasonCodes.push("DOCK_EXCEPTION");
  }

  if (hasType("rtls.wrong_zone") || hasType("rts.staff_safety_alert")) {
    outcomes.add("alert_operator");
    outcomes.add("route_to_owner");
    reasonCodes.push("LOCATION_EXCEPTION");
  }

  if (hasType("device.low_battery")) {
    outcomes.add("route_to_owner");
    outcomes.add("alert_operator");
    reasonCodes.push("BATTERY_WORKFLOW_RISK");
  }

  if (hasType("device.health_degraded")) {
    outcomes.add("route_to_owner");
    outcomes.add("create_ticket");
    reasonCodes.push("OPERATIONAL_HEALTH_DEGRADED");
  }

  if (hasCriticalOrHighSecurityRisk) {
    outcomes.add("restrict");
    outcomes.add("alert_operator");
    outcomes.add("route_to_owner");
    reasonCodes.push("SECURITY_RISK_ESCALATION");
  }

  if (hasType("api.integration_failed")) {
    outcomes.add("alert_operator");
    outcomes.add("route_to_owner");
    reasonCodes.push("INTEGRATION_ROUTE_DEGRADED");
  }

  if (hasType("remediation.verified")) {
    outcomes.add("verify_remediation");
    outcomes.add("allow");
    reasonCodes.push("REMEDIATION_VERIFIED");
  }

  if (
    outcomes.size === 0 &&
    hasType("identity.authenticated") &&
    (hasType("device.posture_observed") ||
      hasType("apple.ddm_declared_state")) &&
    !hasType("device.non_compliant")
  ) {
    outcomes.add("allow");
    reasonCodes.push(
      hasType("apple.ddm_declared_state")
        ? "APPLE_DECLARED_STATE_TRUSTED"
        : "IDENTITY_AND_POSTURE_TRUSTED",
    );
  }

  outcomes.add("record_audit");

  if (
    outcomes.has("allow") &&
    (outcomes.has("restrict") ||
      outcomes.has("deny") ||
      outcomes.has("step_up"))
  ) {
    outcomes.delete("allow");
    reasonCodes.push("ALLOW_REMOVED_DUE_TO_HIGHER_RISK");
  }

  if (outcomes.has("allow") && hasActiveCustodyIntegrityFailure) {
    outcomes.delete("allow");
    reasonCodes.push("ALLOW_REMOVED_DUE_TO_CUSTODY_FAILURE");
  }

  const ordered = orderOutcomes([...outcomes]);

  return {
    id: `decision:${scenario.id}`,
    scenarioId: scenario.id,
    evaluatedAt: evaluationTime,
    outcomes: ordered,
    primaryOutcome: ordered[0] ?? "record_audit",
    confidence: reasonCodes.includes("INTEGRATION_ROUTE_DEGRADED")
      ? "medium"
      : "high",
    reasonCodes,
    explanation: explainDecision(ordered, reasonCodes),
  };
}

function orderOutcomes(outcomes: DecisionOutcome[]): DecisionOutcome[] {
  const order: DecisionOutcome[] = [
    "deny",
    "restrict",
    "step_up",
    "alert_operator",
    "create_ticket",
    "route_to_owner",
    "request_remediation",
    "verify_remediation",
    "allow",
    "record_audit",
  ];
  return order.filter((outcome) => outcomes.includes(outcome));
}

function explainDecision(
  outcomes: DecisionOutcome[],
  reasonCodes: string[],
): string {
  if (outcomes.includes("restrict")) {
    return "Risk exceeded the simulator trust threshold, so the workflow is restricted and routed for review.";
  }
  if (outcomes.includes("step_up")) {
    return "Trust is incomplete because posture freshness is stale, so the simulator requests review or refresh before treating the device as fully trusted.";
  }
  if (
    outcomes.includes("alert_operator") ||
    outcomes.includes("create_ticket")
  ) {
    return `Operational exception routed with reason codes: ${reasonCodes.join(", ")}.`;
  }
  if (outcomes.includes("verify_remediation")) {
    return "Remediation evidence is verified in the fixture, so the device becomes an allow candidate with audit evidence.";
  }
  return "Identity, posture, location, dock, and workflow signals are aligned in the fixture, so the simulator allows the candidate workflow and records audit evidence.";
}
