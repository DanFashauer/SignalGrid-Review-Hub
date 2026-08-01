// Pure, deterministic challenge-capability evaluator.
//
// One question, graded only when the caller poses it: could this device+worker
// pair actually ANSWER the step-up this workflow would issue?
//
// The ladder, most-specific first (a single-axis family — no worst-wins fold
// is needed because exactly one outcome can be true at a time):
//
//   not covered            → unknown / NOT_COVERED / monitor
//   pose unreadable        → unknown / ACCEPTED_METHOD_UNRECOGNIZED / monitor
//   unposed (or [] posed)  → unassessed / CHALLENGE_UNPOSED / none — day-one
//                            quiet; a deployment that has not asked is never
//                            nagged, and the flag stays false so nothing is
//                            silently affirmed
//   report malformed       → unverified / REPORT_MALFORMED / monitor
//   bridge not affirmed    → unverified / BRIDGE_UNREACHABLE / monitor
//   ≥1 accepted method positively enrolled + present + healthy
//                          → challenge_ready / none — the ONLY path to
//                            challengeAnswerable=true
//   EVERY accepted method positively broken (≥1 axis explicitly false each)
//                          → challenge_unanswerable / ALERT — an operator-scale
//                            provisioning defect: the workflow's step_up is a
//                            deny in disguise; fix enrollment or swap the
//                            device BEFORE the doomed challenge
//   anything else          → unverified / CHALLENGE_STANDING_UNKNOWN / monitor
//                            — a blind spot is not a dead end and not a
//                            capability; absence of a method entry lands here
//                            (absence is never capability, and it is also
//                            never a positively-confirmed break)
//
// The alert deliberately requires EVERY accepted method to be POSITIVELY
// broken: declaring a workflow's remedy path dead is itself an affirmative
// claim, and this dimension does not make it on silence.

import {
  CHALLENGE_METHODS,
  type ChallengeCapabilityAction,
  type ChallengeCapabilityPosture,
  type ChallengeCapabilityReasonCode,
  type ChallengeCapabilityVerdict,
  type ChallengeMethod,
  type NormalizedChallengeCapability,
} from "./types";

export interface EvaluateChallengeCapabilityOptions {
  /** False when no capability record was returned for this pair. Default true. */
  covered?: boolean;
  /** The methods this workflow's step-up would accept — POSED BY THE CALLER,
   *  never defaulted. Omitted or empty = unposed (unassessed, forecloses
   *  nothing). A string outside the method allowlist refuses the whole pose:
   *  a question we cannot read is not answered optimistically. */
  acceptedMethods?: readonly string[];
}

export function evaluateChallengeCapability(
  cap: NormalizedChallengeCapability,
  options: EvaluateChallengeCapabilityOptions = {},
): ChallengeCapabilityVerdict {
  const covered = options.covered ?? true;
  const posedRaw = options.acceptedMethods;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const answerableMethods: ChallengeMethod[] = [];
  const base = { criticalFindings, unknownSignals, answerableMethods, deviceRef: cap.deviceRef };
  const verdict = (
    posture: ChallengeCapabilityPosture,
    reasonCode: ChallengeCapabilityReasonCode,
    recommendedAction: ChallengeCapabilityAction,
    challengeAnswerable: boolean,
  ): ChallengeCapabilityVerdict => ({ ...base, posture, reasonCode, recommendedAction, challengeAnswerable });

  if (!covered) {
    return verdict("unknown", "NOT_COVERED", "monitor", false);
  }

  if (posedRaw !== undefined && posedRaw.some((m) => !(CHALLENGE_METHODS as readonly string[]).includes(m))) {
    return verdict("unknown", "ACCEPTED_METHOD_UNRECOGNIZED", "monitor", false);
  }
  const posed = (posedRaw ?? []).filter((m): m is ChallengeMethod => (CHALLENGE_METHODS as readonly string[]).includes(m));
  if (posed.length === 0) {
    return verdict("unassessed", "CHALLENGE_UNPOSED", "none", false);
  }

  if (cap.reportIntegrity === "malformed") {
    return verdict("unverified", "REPORT_MALFORMED", "monitor", false);
  }
  if (cap.bridgeReachable !== true) {
    return verdict("unverified", "BRIDGE_UNREACHABLE", "monitor", false);
  }

  let positivelyBroken = 0;
  for (const method of posed) {
    const standing = cap.methods.find((m) => m.method === method);
    if (standing === undefined) {
      unknownSignals.push(`${method}: not reported`);
      continue;
    }
    if (standing.enrolled === true && standing.authenticatorPresent === true && standing.clientHealthy === true) {
      answerableMethods.push(method);
      continue;
    }
    const brokenAxes: string[] = [];
    if (standing.enrolled === false) brokenAxes.push("enrolled=false");
    if (standing.authenticatorPresent === false) brokenAxes.push("authenticator_present=false");
    if (standing.clientHealthy === false) brokenAxes.push("client_healthy=false");
    if (brokenAxes.length > 0) {
      positivelyBroken += 1;
      criticalFindings.push(`${method}: ${brokenAxes.join(", ")}`);
    } else {
      unknownSignals.push(`${method}: standing not fully reported`);
    }
  }

  if (answerableMethods.length > 0) {
    return verdict("challenge_ready", "CHALLENGE_READY", "none", true);
  }
  if (positivelyBroken === posed.length) {
    return verdict("challenge_unanswerable", "CHALLENGE_UNANSWERABLE", "alert", false);
  }
  return verdict("unverified", "CHALLENGE_STANDING_UNKNOWN", "monitor", false);
}
