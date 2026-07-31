import type {
  DlpPosture,
  DlpReasonCode,
  DlpRecommendedAction,
  DlpSeverity,
  DlpVerdict,
  NormalizedDataProtection,
} from "./types";

/**
 * Pure, deterministic data-protection / DLP posture evaluator. Aggregates a
 * device's DLP violations + policy state into ONE posture + the action it
 * warrants — fail-safe, so the WORST egress drives the verdict and a violation we
 * can't confirm was blocked is treated as data that may have left. No clock, no
 * randomness.
 *
 * `covered=false` means "no DLP coverage for this device" → posture unknown (a
 * blind spot), different from a covered device with no violations → protected.
 */

// Local action-severity ordering, consistent with the unified ladder
// (none < monitor < step_up < alert < restrict < escalate). Used to pick the
// STRONGEST concern across a device's violations + policy state, so a severe
// egress is never diluted by a calmer one (order-proof).
const ACTION_SEVERITY: Record<DlpRecommendedAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

const SEVERITY_RANK: Record<DlpSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export interface EvaluateDlpOptions {
  /** False when the device has no DLP coverage at all. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: DlpPosture;
  action: DlpRecommendedAction;
  reason: DlpReasonCode;
}

export function evaluateDlpPosture(
  posture: NormalizedDataProtection,
  options: EvaluateDlpOptions = {},
): DlpVerdict {
  const covered = options.covered ?? true;
  // `null` = the source never reported the DLP violation feed; `[]` = it reported none.
  // Both count as zero, which is why the distinction must travel separately.
  const violationsObserved = posture.violations !== null;
  const violations = posture.violations ?? [];
  const violationCount = violations.length;
  const egressed = violations.filter((v) => v.egressed);
  const egressCount = egressed.length;
  const highestSeverity = violations.reduce<DlpSeverity>(
    (max, v) => (SEVERITY_RANK[v.severity] > SEVERITY_RANK[max] ? v.severity : max),
    "unknown",
  );

  const base = {
    violationCount,
    egressCount,
    highestSeverity,
    dlpPolicyEnforced: posture.dlpPolicyEnforced,
  };

  // No DLP coverage → unknown (a blind spot), NOT protected. Mirrors the
  // not-covered / unscanned fail-safe in the other dimensions.
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "monitor" };
  }

  // Collect every applicable concern as a candidate, then let the STRONGEST win
  // (order-proof).
  const candidates: Candidate[] = [];
  if (!violationsObserved) {
    // Never read the feed, so "nothing found" is not a reading we are entitled to.
    // `monitor` — a blind spot to investigate, not an alarm. Beats the `none`
    // default and loses to any genuinely observed problem, which is the right
    // precedence: a real finding outranks "we could not see".
    candidates.push({ posture: "unknown", action: "monitor", reason: "DLP_FEED_UNOBSERVED" });
  }

  const regulatedEgress = egressed.some((v) => v.regulated || v.severity === "critical" || v.severity === "high");
  if (egressCount > 0 && regulatedEgress) {
    // Data actually left AND it was regulated (PHI/PII/PCI) or high-severity — a
    // confirmed data-loss event.
    candidates.push({ posture: "confirmed_exfiltration", action: "escalate", reason: "REGULATED_DATA_EGRESS" });
  } else if (egressCount > 0) {
    // Data left, lower classification — still a data-egress event.
    candidates.push({ posture: "data_egress", action: "alert", reason: "DATA_EGRESS" });
  }

  if (violationCount > 0 && egressCount === 0) {
    // Violations exist but all were provably contained (blocked/audited).
    candidates.push({ posture: "monitored", action: "monitor", reason: "VIOLATIONS_CONTAINED" });
  }

  // DLP policy explicitly not enforced → data can leave unchecked.
  if (posture.dlpPolicyEnforced === false) {
    candidates.push({ posture: "policy_unenforced", action: "step_up", reason: "POLICY_UNENFORCED" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "protected", action: "none", reason: "NO_VIOLATIONS" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
