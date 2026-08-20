import type {
  CredentialPosture,
  CredentialReasonCode,
  CredentialRecommendedAction,
  CredentialExposureVerdict,
  NormalizedCredentialExposure,
  SecretSeverity,
} from "./types";

/**
 * Pure, deterministic credential-exposure posture evaluator. Aggregates a
 * device's secret findings + scanner state into ONE posture + the action it
 * warrants — fail-safe, so the WORST still-exposed secret drives the verdict and a
 * finding we can't confirm was remediated or revoked is treated as still exposed.
 * No clock, no randomness.
 *
 * `covered=false` means "no secrets scanner coverage for this device at all" →
 * posture unknown (a blind spot), different from a covered device with no findings
 * → clean.
 */

// Local action-severity ordering, consistent with the unified ladder
// (none < monitor < step_up < alert < restrict < escalate). Used to pick the
// STRONGEST concern across a device's findings + scanner state, so a live
// high-value key is never diluted by a calmer finding (order-proof).
const ACTION_SEVERITY: Record<CredentialRecommendedAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

const SEVERITY_RANK: Record<SecretSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  unknown: 0,
};

export interface EvaluateCredentialOptions {
  /** False when the device has no secrets-scanner coverage at all. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: CredentialPosture;
  action: CredentialRecommendedAction;
  reason: CredentialReasonCode;
}

export function evaluateCredentialExposure(
  posture: NormalizedCredentialExposure,
  options: EvaluateCredentialOptions = {},
): CredentialExposureVerdict {
  const covered = options.covered ?? true;
  // `null` = the source never reported the secret-scan result set; `[]` = it reported none.
  // Both count as zero, which is why the distinction must travel separately.
  const findingsObserved = posture.findings !== null;
  const findings = posture.findings ?? [];
  const findingCount = findings.length;
  const exposed = findings.filter((f) => f.exposed);
  const exposedCount = exposed.length;
  const highestSeverity = findings.reduce<SecretSeverity>(
    (max, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
    "unknown",
  );

  const base = {
    findingCount,
    exposedCount,
    highestSeverity,
    scannerEnrolled: posture.scannerEnrolled,
  };

  // No scanner coverage → unknown (a blind spot), NOT clean. Mirrors the
  // not-covered / unscanned fail-safe in the other dimensions.
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "monitor" };
  }

  // Collect every applicable concern as a candidate, then let the STRONGEST win
  // (order-proof).
  const candidates: Candidate[] = [];
  if (!findingsObserved) {
    // Never read the feed, so "nothing found" is not a reading we are entitled to.
    // `monitor` — a blind spot to investigate, not an alarm. Beats the `none`
    // default and loses to any genuinely observed problem, which is the right
    // precedence: a real finding outranks "we could not see".
    candidates.push({ posture: "unknown", action: "monitor", reason: "SECRET_SCAN_UNOBSERVED" });
  }

  const highValueExposed = exposed.some((f) => f.highValue);
  if (exposedCount > 0 && highValueExposed) {
    // A still-live, high-value credential (cloud key, private key, db cred, oauth)
    // or a critical/high-severity secret is exposed on the endpoint — the device
    // must be treated as compromised.
    candidates.push({ posture: "active_credential_exposed", action: "escalate", reason: "HIGH_VALUE_SECRET_EXPOSED" });
  } else if (exposedCount > 0) {
    // A secret is still exposed, lower value — a credential-exposure event.
    candidates.push({ posture: "secrets_exposed", action: "alert", reason: "SECRETS_EXPOSED" });
  }

  if (findingCount > 0 && exposedCount === 0) {
    // Findings exist but all were provably remediated or revoked.
    candidates.push({ posture: "remediated", action: "monitor", reason: "FINDINGS_REMEDIATED" });
  }

  // Scanner explicitly not enrolled → secrets can pile up unseen.
  if (posture.scannerEnrolled === false) {
    candidates.push({ posture: "scanner_unenrolled", action: "step_up", reason: "SCANNER_UNENROLLED" });
  } else if (posture.scannerEnrolled === null) {
    // Enrollment UNREPORTED (wedge #6, caught by the shift-1 sweep): "nothing
    // found" from a scanner we cannot confirm was even running is not a clean
    // reading. `=== false` alone let null fall through to a full clean/none
    // grant. Graded `monitor` — a blind spot to investigate, same level as the
    // unobserved feed; a confirmed-unenrolled scanner (above) stays the stronger
    // step_up because it is a REPORTED bad state, not an unreported one.
    candidates.push({ posture: "unknown", action: "monitor", reason: "SCANNER_ENROLLMENT_UNVERIFIED" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "clean", action: "none", reason: "NO_FINDINGS" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
