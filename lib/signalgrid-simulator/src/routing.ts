import type { DecisionOutcome, RoutedAction, SimulatorScenario } from "./types";

export function routeDecision(scenario: SimulatorScenario, outcomes: DecisionOutcome[]): RoutedAction[] {
  const actions: RoutedAction[] = [];
  const baseRefs = scenario.startingSignals.map((signal) => signal.id);

  if (outcomes.includes("alert_operator")) {
    actions.push(action("alert", "alert_operator", "Alert operator", scenario.expectedOwnerTeam, "P1", "requires_review", "operator-alerts", baseRefs));
  }

  if (outcomes.includes("create_ticket")) {
    actions.push(action("ticket", "create_ticket", "Create simulated ticket", scenario.expectedOwnerTeam, "P2", "queued", "itsm-simulator", baseRefs));
  }

  if (outcomes.includes("route_to_owner")) {
    actions.push(action("owner", "route_to_owner", "Route to responsible owner", scenario.expectedOwnerTeam, "P2", "simulated", "ownership-rules", baseRefs));
  }

  if (outcomes.includes("request_remediation")) {
    actions.push(action("remediation", "request_remediation", "Request posture refresh or remediation review", scenario.expectedOwnerTeam, "P2", "requires_review", "remediation-assistant", baseRefs));
  }

  if (outcomes.includes("verify_remediation")) {
    actions.push(action("verify", "verify_remediation", "Verify remediation evidence", scenario.expectedOwnerTeam, "P3", "verified", "remediation-assistant", baseRefs));
  }

  if (scenario.startingSignals.some((signal) => signal.type === "api.integration_failed")) {
    actions.push(action("retry", "queue_retry", "Queue retry for degraded integration route", "SignalGrid platform owner", "P2", "queued", "integration-retry-queue", baseRefs));
  }

  actions.push(action("audit", "record_audit", "Record audit evidence", "Audit evidence layer", "P3", "simulated", "audit-ledger", baseRefs));

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
): RoutedAction {
  return {
    id: `route:${suffix}`,
    kind,
    title,
    ownerTeam,
    priority,
    status,
    route,
    evidenceRefs,
  };
}
