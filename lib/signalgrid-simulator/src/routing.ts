import type { DecisionOutcome, RoutedAction, SimulatorScenario } from "./types";

export function routeDecision(
  scenario: SimulatorScenario,
  outcomes: DecisionOutcome[],
): RoutedAction[] {
  const actions: RoutedAction[] = [];
  const baseRefs = scenario.startingSignals.map((signal) => signal.id);

  if (outcomes.includes("alert_operator")) {
    actions.push(
      action(
        "alert",
        "alert_operator",
        "Alert operator",
        scenario.expectedOwnerTeam,
        "P1",
        "requires_review",
        "operator-alerts",
        baseRefs,
        true,
      ),
    );
  }

  if (outcomes.includes("create_ticket")) {
    actions.push(
      action(
        "ticket",
        "create_ticket",
        "Create simulated ticket",
        scenario.expectedOwnerTeam,
        "P2",
        "queued",
        "itsm-simulator",
        baseRefs,
        false,
      ),
    );
  }

  if (outcomes.includes("route_to_owner")) {
    actions.push(
      action(
        "owner",
        "route_to_owner",
        "Route to responsible owner",
        scenario.expectedOwnerTeam,
        "P2",
        "simulated",
        "ownership-rules",
        baseRefs,
        false,
      ),
    );
  }

  if (outcomes.includes("request_remediation")) {
    actions.push(
      action(
        "remediation",
        "request_remediation",
        "Request posture refresh or remediation review",
        scenario.expectedOwnerTeam,
        "P2",
        "requires_review",
        "remediation-assistant",
        baseRefs,
        true,
      ),
    );
  }

  if (outcomes.includes("verify_remediation")) {
    actions.push(
      action(
        "verify",
        "verify_remediation",
        "Verify remediation evidence",
        scenario.expectedOwnerTeam,
        "P3",
        "verified",
        "remediation-assistant",
        baseRefs,
        false,
      ),
    );
  }

  if (
    scenario.startingSignals.some(
      (signal) => signal.type === "api.integration_failed",
    )
  ) {
    actions.push(
      action(
        "retry",
        "queue_retry",
        "Queue retry for degraded integration route",
        "SignalGrid platform owner",
        "P2",
        "queued",
        "integration-retry-queue",
        baseRefs,
        false,
      ),
    );
  }

  actions.push(
    action(
      "audit",
      "record_audit",
      "Record audit evidence",
      "Audit evidence layer",
      "P3",
      "simulated",
      "audit-ledger",
      baseRefs,
      false,
    ),
  );

  return actions;
}

function action(
  suffix: string,
  kind: RoutedAction["kind"],
  title: string,
  ownerTeam: string,
  priority: RoutedAction["priority"],
  status: RoutedAction["status"],
  route: string,
  evidenceRefs: string[],
  approvalRequired: boolean,
): RoutedAction {
  return {
    id: `route:${suffix}`,
    kind,
    title,
    ownerTeam,
    ownerCategory: ownerCategoryFor(ownerTeam),
    priority,
    severity: severityFor(priority),
    status,
    route,
    destinationSystem: route,
    approvalRequired,
    simulatedOnly: true,
    verificationExpectation: verificationExpectationFor(kind),
    evidenceRefs,
  };
}

function ownerCategoryFor(ownerTeam: string): RoutedAction["ownerCategory"] {
  const normalizedOwner = ownerTeam.toLowerCase();

  if (normalizedOwner.includes("security")) {
    return "security";
  }

  if (normalizedOwner.includes("audit")) {
    return "audit";
  }

  if (
    normalizedOwner.includes("platform") ||
    normalizedOwner.includes("endpoint") ||
    normalizedOwner.includes("mobility") ||
    normalizedOwner.includes("euc")
  ) {
    return "operations";
  }

  if (
    normalizedOwner.includes("pool") ||
    normalizedOwner.includes("clinical")
  ) {
    return "workflow";
  }

  return "platform";
}

function severityFor(
  priority: RoutedAction["priority"],
): RoutedAction["severity"] {
  if (priority === "P1") {
    return "critical";
  }

  if (priority === "P2") {
    return "high";
  }

  return "medium";
}

function verificationExpectationFor(kind: RoutedAction["kind"]): string {
  switch (kind) {
    case "verify_remediation":
      return "Confirm fixture remediation evidence before closure.";
    case "record_audit":
      return "Persist deterministic audit evidence for review.";
    case "queue_retry":
      return "Confirm retry remains simulated until route health recovers.";
    default:
      return "Review simulated action evidence before any live operator decision.";
  }
}
