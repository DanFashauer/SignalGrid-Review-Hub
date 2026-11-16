/**
 * One place where a verdict — in any of the three vocabularies this deck
 * renders — becomes a colour.
 *
 * Four sections each carried their own verdict→class map (OperatorConsole,
 * WorkerSelfService, SignalGridSimulator, ConnectorEmulatorDashboard). Each was
 * a total `Record`, so none could drop an arm silently — but four copies of one
 * decision is how the desktop's three ternaries drifted apart before its
 * `lib/outcome-tone.ts` existed, and the simulator section's copy was a
 * `Partial<Record>` looked up with a NEUTRAL fallback (`?? "text-stone-300 …"`),
 * so an outcome it did not name rendered as the quietest thing on the screen.
 * The doctrine (desktop `outcome-tone.ts`): an unrecognised verdict resolves to
 * the RESTRICTIVE tone, never to a neutral one. `check-verdict-tone-source.mjs`
 * names this file as the deck's tone module and asserts, structurally, that no
 * other file in the tree carries a verdict→class map and that every `??`
 * fallback here is restrictive.
 *
 * Three vocabularies, three total maps:
 *  - the core's four verdicts (`@workspace/signalgrid-core` DecisionOutcome),
 *  - the simulator's ten outcomes (four verdicts + six routed actions),
 *  - the connector emulator's five decisions.
 */
import type { DecisionOutcome as CoreOutcome } from "@workspace/signalgrid-core";
import type { DecisionOutcome as SimulatorOutcome } from "@/lib/simulator/types";
import type { ConnectorDecision } from "@/data/connectorEmulatorData";

/** Badge (background) tone for a core verdict. Total. */
export const VERDICT_BADGE_TONE: Record<CoreOutcome, string> = {
  allow: "bg-status-allow",
  step_up: "bg-status-step-up",
  restrict: "bg-status-restrict",
  deny: "bg-status-deny",
};

/** Text tone for a core verdict. Total. */
export const VERDICT_TEXT_TONE: Record<CoreOutcome, string> = {
  allow: "text-status-allow",
  step_up: "text-status-step-up",
  restrict: "text-status-restrict",
  deny: "text-status-deny",
};

/** Badge tone for every simulator outcome: the four verdicts plus the six routed actions. Total. */
export const SIMULATOR_OUTCOME_TONE: Record<SimulatorOutcome, string> = {
  ...VERDICT_BADGE_TONE,
  alert_operator: "text-sky-300 bg-sky-950/40 border-sky-700/50",
  create_ticket: "text-violet-300 bg-violet-950/40 border-violet-700/50",
  route_to_owner: "text-stone-200 bg-stone-800/60 border-stone-700",
  request_remediation: "text-amber-200 bg-amber-950/30 border-amber-700/50",
  verify_remediation: "text-teal-200 bg-teal-950/30 border-teal-700/50",
  record_audit: "text-stone-300 bg-stone-900 border-stone-700",
};

/** Pill tone for a connector-emulator decision. Total. */
export const CONNECTOR_DECISION_TONE: Record<ConnectorDecision, string> = {
  allowCandidate: "border-teal-500/50 bg-teal-950/30 text-teal-200",
  deny: "bg-status-deny",
  restrict: "bg-status-restrict",
  stepUp: "border-sky-500/50 bg-sky-950/30 text-sky-200",
  approvalRequired: "border-violet-500/50 bg-violet-950/30 text-violet-200",
};

// Every helper falls back to the RESTRICTIVE tone: an unknown must tighten the
// answer, and on a rendered surface that means visible and not benign.
export function verdictBadgeTone(outcome: string): string {
  return VERDICT_BADGE_TONE[outcome as CoreOutcome] ?? "bg-status-restrict";
}
export function verdictTextTone(outcome: string): string {
  return VERDICT_TEXT_TONE[outcome as CoreOutcome] ?? "text-status-restrict";
}
export function simulatorOutcomeTone(outcome: string): string {
  return SIMULATOR_OUTCOME_TONE[outcome as SimulatorOutcome] ?? "bg-status-restrict";
}
export function connectorDecisionTone(decision: string): string {
  return CONNECTOR_DECISION_TONE[decision as ConnectorDecision] ?? "bg-status-restrict";
}
