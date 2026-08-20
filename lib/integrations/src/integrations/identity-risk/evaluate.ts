import type {
  IdentityAction,
  IdentityPosture,
  IdentityReasonCode,
  IdentityRiskVerdict,
  NormalizedPrincipalRisk,
  DetectionGrade,
} from "./types";

/**
 * Pure, deterministic identity / SSO sign-in-risk evaluator. Aggregates a
 * principal's IdP risk state + detections into ONE sign-in-risk posture + the
 * action it warrants — fail-safe, so the WORST concern drives the verdict and a
 * principal with no IdP risk coverage is never mistaken for a trusted one. No
 * clock, no randomness.
 *
 * `covered=false` means "the IdP has no risk record for this principal" →
 * posture unknown (a blind spot to investigate), different from a covered
 * principal the IdP reports as clean → trusted.
 */

// Local action-severity ordering, consistent with the unified ladder
// (none < monitor < step_up < alert < restrict < escalate). Used to pick the
// STRONGEST concern among a principal's independent risk factors, so a severe
// signal is never diluted by a calmer one checked later (order-proof).
const ACTION_SEVERITY: Record<IdentityAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

const GRADE_RANK: Record<DetectionGrade, number> = { compromise: 3, high: 2, medium: 1 };

export interface EvaluateIdentityOptions {
  /** False when the IdP has no risk record for this principal at all. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: IdentityPosture;
  action: IdentityAction;
  reason: IdentityReasonCode;
}

export function evaluateIdentityRisk(
  principal: NormalizedPrincipalRisk,
  options: EvaluateIdentityOptions = {},
): IdentityRiskVerdict {
  const covered = options.covered ?? true;
  // `null` = the source never reported the risk-detection feed; `[]` = it reported none.
  // Both count as zero, which is why the distinction must travel separately.
  const detectionsObserved = principal.detections !== null;
  const detections = principal.detections ?? [];
  const detectionCount = detections.length;
  const highestDetectionGrade = detections.reduce<DetectionGrade | null>(
    (max, d) => (max === null || GRADE_RANK[d.grade] > GRADE_RANK[max] ? d.grade : max),
    null,
  );
  const hasCompromiseGrade = detections.some((d) => d.grade === "compromise");
  const hasHighGrade = detections.some((d) => d.grade === "high");
  const hasMediumGrade = detections.some((d) => d.grade === "medium");

  const base = {
    riskLevel: principal.riskLevel,
    riskState: principal.riskState,
    detectionCount,
    highestDetectionGrade,
    mfaSatisfied: principal.mfaSatisfied,
  };

  // No IdP risk record → unknown (a blind spot), NOT trusted. Mirrors the
  // not-reporting / unscanned fail-safe in the other dimensions.
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "monitor" };
  }

  // The IdP's own terminal verdicts short-circuit the ladder.
  if (principal.riskState === "confirmed_compromised") {
    return { ...base, posture: "compromised", reasonCode: "CONFIRMED_COMPROMISED", recommendedAction: "escalate" };
  }
  if (principal.riskState === "remediated" || principal.riskState === "dismissed" || principal.riskState === "confirmed_safe") {
    // The risk was handled/accepted by the IdP or an admin; a new detection
    // would flip the state back to at_risk, so this is genuinely contained.
    return detectionCount > 0
      ? { ...base, posture: "low_risk", reasonCode: "RISK_REMEDIATED", recommendedAction: "monitor" }
      : { ...base, posture: "trusted", reasonCode: "NO_RISK", recommendedAction: "none" };
  }

  // at_risk, none, or unknown state: collect every applicable risk factor as a
  // candidate, then let the STRONGEST win (order-proof). riskState "none" adds no
  // candidate — the IdP affirmatively said no risk, so trusted is EARNED if
  // nothing else fires — while "unknown" adds a monitor floor below.
  const candidates: Candidate[] = [];
  // The state was never read, or the vendor sent something unmappable. Executed
  // counterexample before this existed: riskState "unknown" + riskLevel "unknown"
  // + zero detections graded trusted / NO_RISK / none — so a vendor renaming one
  // enum value silently converted parse failure into trust. A blind spot is
  // monitor, never trusted; a genuinely observed problem still outranks it.
  if (principal.riskState === "unknown") {
    candidates.push({ posture: "unknown", action: "monitor", reason: "RISK_STATE_UNVERIFIED" });
  }
  if (!detectionsObserved) {
    // Never read the feed, so "nothing found" is not a reading we are entitled to.
    // `monitor` — a blind spot to investigate, not an alarm. Beats the `none`
    // default and loses to any genuinely observed problem, which is the right
    // precedence: a real finding outranks "we could not see".
    candidates.push({ posture: "unknown", action: "monitor", reason: "RISK_FEED_UNOBSERVED" });
  }
  // FAIL-SAFE floor: the IdP explicitly flags this principal at_risk but gives us
  // no usable level (e.g. Entra reports riskLevel "hidden" without a P2 license)
  // and no detections — an unquantified-but-active risk must still warrant a
  // step-up, never resolve to "trusted". Quantified levels/detections below
  // override this upward via strongest-wins.
  if (principal.riskState === "at_risk" && principal.riskLevel === "unknown") {
    candidates.push({ posture: "at_risk", action: "step_up", reason: "RISK_STATE_AT_RISK" });
  }
  if (hasCompromiseGrade) {
    candidates.push({ posture: "compromised", action: "escalate", reason: "LEAKED_OR_MALICIOUS" });
  }
  if (principal.riskLevel === "high") {
    candidates.push({ posture: "high_risk", action: "restrict", reason: "HIGH_RISK_SIGNIN" });
  }
  // A risky sign-in that was NOT MFA-protected can't be fixed by a step-up (the
  // factor was already bypassed) — treat it as a restrict, not a step_up.
  if (principal.mfaSatisfied === false && (principal.riskLevel === "high" || principal.riskLevel === "medium")) {
    candidates.push({ posture: "high_risk", action: "restrict", reason: "HIGH_RISK_NO_MFA" });
  }
  if (hasHighGrade) {
    candidates.push({ posture: "high_risk", action: "alert", reason: "RISKY_DETECTION" });
  }
  if (principal.riskLevel === "medium") {
    candidates.push({ posture: "at_risk", action: "step_up", reason: "MEDIUM_RISK_SIGNIN" });
  }
  if (hasMediumGrade) {
    candidates.push({ posture: "at_risk", action: "step_up", reason: "RISKY_DETECTION" });
  }
  if (principal.riskLevel === "low") {
    candidates.push({ posture: "low_risk", action: "monitor", reason: "LOW_RISK_SIGNIN" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "trusted", action: "none", reason: "NO_RISK" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
