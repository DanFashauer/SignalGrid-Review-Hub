import {
  type DeviceManagementHealthAction,
  type DeviceManagementHealthPosture,
  type DeviceManagementHealthReasonCode,
  type DeviceManagementHealthVerdict,
  type NormalizedDeviceManagementHealth,
} from "./types";

/**
 * Pure, deterministic management-health / config-drift evaluator. Folds "is this
 * shared device still under EFFECTIVE management, and is it on the baseline it was
 * assigned?" into ONE posture + the action it warrants, fail-safe.
 *
 * The distinction that matters is between a device that is COMPLIANT and one that is
 * merely LAST KNOWN to be compliant. A ward iPad that stopped checking in three weeks
 * ago reports its final posture forever; a device whose enrollment failed, or that was
 * retired in the MDM but never physically collected, looks fine in a posture snapshot
 * and is in fact ungoverned. This dimension is what makes the other device signals
 * mean something — without it, `macos-posture` and `intune-entra-posture` are reading
 * a cached answer with no expiry.
 *
 *  - a RETIRED or FAILED enrollment, or a device no compliance policy even covers,
 *    means the management plane is not actually governing it → RESTRICT (contain);
 *  - CONFIG DRIFT (applied config no longer matches the assigned baseline), or a
 *    device that has NEVER checked in, or one whose check-in has gone STALE →
 *    STEP_UP;
 *  - anything unreadable, the management plane unreachable, or a report we could not
 *    parse → STEP_UP (never trust silence);
 *  - the grant requires ALL FIVE positively confirmed: freshly checked in, on
 *    baseline, covered by a policy, enrolled, and the plane confirmed reachable.
 *    Worst-concern-wins.
 *
 * `covered=false` = no management result was returned for this device → unknown (a
 * gap), step_up.
 */

const ACTION_SEVERITY: Record<DeviceManagementHealthAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateDeviceManagementHealthOptions {
  /** False when no management result was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: DeviceManagementHealthPosture;
  action: DeviceManagementHealthAction;
  reason: DeviceManagementHealthReasonCode;
}

export function evaluateDeviceManagementHealth(
  health: NormalizedDeviceManagementHealth,
  options: EvaluateDeviceManagementHealthOptions = {},
): DeviceManagementHealthVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: health.deviceId };

  if (!covered) {
    return {
      ...base,
      posture: "unknown",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      managementEffective: false,
    };
  }

  const candidates: Candidate[] = [];

  // A report we could not fully parse is never a grant, independently of what its
  // fields normalized to. Defence in depth: the allow path must not rest on a value we
  // only think we understood.
  if (health.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // Check-in freshness is judged FIRST. Severity ordering is unaffected — the reduce
  // below picks by action rank, so the restricts still outrank everything here. What
  // this buys is the TIE: several conditions emit step_up, worst-concern-wins keeps the
  // first candidate on a tie, and a device that has gone silent is the root cause of
  // every softer reading downstream of it. "This device stopped reporting" is the more
  // useful headline than "its config drifted" — the drift reading is stale anyway.
  if (health.checkInFreshness === "never") {
    candidates.push({ posture: "stale_management", action: "step_up", reason: "CHECKIN_NEVER" });
  } else if (health.checkInFreshness === "stale") {
    candidates.push({ posture: "stale_management", action: "step_up", reason: "CHECKIN_STALE" });
  } else if (health.checkInFreshness === "unknown") {
    unknownSignals.push("check_in_freshness");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  // ── restrict: the management plane is not actually governing this device ───────
  if (health.enrollmentState === "retired") {
    criticalFindings.push("enrollment_retired");
    candidates.push({ posture: "unenrolled_device", action: "restrict", reason: "ENROLLMENT_RETIRED" });
  } else if (health.enrollmentState === "failed") {
    criticalFindings.push("enrollment_failed");
    candidates.push({ posture: "unenrolled_device", action: "restrict", reason: "ENROLLMENT_FAILED" });
  } else if (health.enrollmentState === "unknown") {
    unknownSignals.push("enrollment_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  if (health.complianceCoverage === "uncovered") {
    criticalFindings.push("compliance_uncovered");
    candidates.push({ posture: "unmanaged_device", action: "restrict", reason: "COMPLIANCE_UNCOVERED" });
  } else if (health.complianceCoverage === "unknown") {
    unknownSignals.push("compliance_coverage");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  // ── step_up: governed, but the configuration is drifting ──────────────────────
  if (health.policyDrift === "drifted") {
    candidates.push({ posture: "drifted_config", action: "step_up", reason: "POLICY_DRIFTED" });
  } else if (health.policyDrift === "unknown") {
    unknownSignals.push("policy_drift");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE confirmation that the management plane answered for
  // this device. Without an explicit true the read may be stale or cached.
  if (health.managementReachable !== true) {
    if (health.managementReachable === null) unknownSignals.push("management_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_UNREACHABLE" });
  }

  // Worst-concern-wins. The seed survives only if NO candidate was raised — which is
  // exactly the five-way positive confirmation.
  const seed: Candidate = { posture: "managed_healthy", action: "none", reason: "MANAGEMENT_HEALTHY" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    managementEffective: winner.action === "none",
  };
}
