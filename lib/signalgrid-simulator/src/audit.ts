import type { AuditEvidence, RoutedAction, SignalGridDecision, SimulatorScenario } from "./types";

export function createAuditEvidence(
  scenario: SimulatorScenario,
  decision: SignalGridDecision,
  routedActions: RoutedAction[],
): AuditEvidence[] {
  const recordedAt = decision.evaluatedAt;
  return [
    {
      id: `audit:${scenario.id}:decision`,
      recordedAt,
      actor: "SignalGrid simulator",
      summary: `Decision ${decision.primaryOutcome} recorded for ${scenario.title}.`,
      evidenceType: "decision_trace",
      references: [decision.id, ...scenario.startingSignals.map((signal) => signal.id)],
    },
    {
      id: `audit:${scenario.id}:routing`,
      recordedAt,
      actor: "SignalGrid simulator",
      summary: `${routedActions.length} routed action records produced for ${scenario.expectedOwnerTeam}.`,
      evidenceType: "routing_trace",
      references: routedActions.map((action) => action.id),
    },
  ];
}
