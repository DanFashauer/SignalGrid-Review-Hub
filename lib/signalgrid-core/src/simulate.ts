import { evaluatePolicy } from "./policy";
import type {
  Decision,
  EvidenceSnapshot,
  PolicyVersion,
  SimulationResult,
} from "./types";

/**
 * Replay a stored decision against a chosen policy version.
 *
 * The replay evaluates the decision's IMMUTABLE evidence snapshot — the exact
 * evidence captured at decision time — against a different policy version,
 * without mutating any stored state or the audit ledger. This is how an
 * operator answers "what would this decision have been under policy vN?" and is
 * the basis of the plan's "explainable and replayable decision" exit gate.
 */
export function simulateDecision(
  decision: Decision,
  snapshot: EvidenceSnapshot,
  version: PolicyVersion,
): SimulationResult {
  const evaluation = evaluatePolicy(version, snapshot.evidence);
  return {
    decisionId: decision.id,
    storedOutcome: decision.outcome,
    simulatedPolicyVersionId: version.id,
    simulatedPolicyVersion: version.version,
    simulatedOutcome: evaluation.outcome,
    simulatedReasonCodes: evaluation.reasonCodes,
    simulatedMatchedRules: evaluation.matchedRules,
    changed: evaluation.outcome !== decision.outcome,
    evidence: snapshot.evidence,
  };
}
