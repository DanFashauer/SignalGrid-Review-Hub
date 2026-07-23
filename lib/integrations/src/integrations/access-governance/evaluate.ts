import {
  type AccessGovernancePosture,
  type AccessGovernanceReasonCode,
  type AccessGovernanceRecommendedAction,
  type AccessGovernanceVerdict,
  type NormalizedAccessGovernancePosture,
} from "./types";

/**
 * Pure, deterministic IAM / access-governance evaluator. Folds a principal's
 * governance state — account-lifecycle standing, entitlement scope, certification
 * + segregation-of-duties, and privileged-access state — into ONE posture + the
 * action it warrants, fail-safe: the STRONGEST concern wins and anything
 * unreadable RAISES the assurance bar.
 *
 * The shared-frontline-session stakes shape the ladder:
 *  - a LEAVER/DISABLED account still transacting on the shared device → ESCALATE
 *    (that identity should no longer be able to act at all);
 *  - an ORPHANED account, an OUT-OF-SCOPE or DECERTIFIED entitlement, a
 *    segregation-of-duties CONFLICT, an EXPIRED JIT window still in use, or an
 *    UNMONITORED privileged session → RESTRICT (the grant is ungoverned — contain);
 *  - an OVER-PRIVILEGED (not least-privilege) role, a STALE / never-attested
 *    certification, or STANDING (not JIT) privilege → STEP_UP (governance drift);
 *  - anything unreadable → STEP_UP (never trust silence).
 *
 * `covered=false` = no IGA/entitlement source observes this principal at all →
 * unknown (a blind spot), never authorized.
 */

const ACTION_SEVERITY: Record<AccessGovernanceRecommendedAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateAccessGovernanceOptions {
  /** False when no IGA/entitlement source observes this principal. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: AccessGovernancePosture;
  action: AccessGovernanceRecommendedAction;
  reason: AccessGovernanceReasonCode;
}

/** Privilege states that represent an active elevation (session monitoring is only
 *  meaningful — and its absence only a concern — when the session is elevated). */
function isElevated(privilege: NormalizedAccessGovernancePosture["privilege"]): boolean {
  return privilege === "standing" || privilege === "jit_active" || privilege === "jit_expired";
}

export function evaluateAccessGovernancePosture(
  posture: NormalizedAccessGovernancePosture,
  options: EvaluateAccessGovernanceOptions = {},
): AccessGovernanceVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  // Fail-safe unknown collection (raise the bar, never assume authorized).
  if (posture.accountStatus === "unknown") unknownSignals.push("account_status");
  if (posture.entitlementScope === "unknown") unknownSignals.push("entitlement_scope");
  if (posture.certification === "unknown") unknownSignals.push("certification");
  if (posture.sodConflict === null) unknownSignals.push("sod");
  if (posture.privilege === "unknown") unknownSignals.push("privilege");
  // Session-monitoring is only assessed (and only unknown-counted) for an elevated
  // session — a non-privileged session has nothing to monitor.
  if (isElevated(posture.privilege) && posture.privilegedSessionMonitored === null) {
    unknownSignals.push("session_monitoring");
  }

  const base = { criticalFindings, unknownSignals, principalId: posture.principalId };

  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up" };
  }

  const candidates: Candidate[] = [];

  // ── escalate: an account that should no longer be able to act at all ──────────
  if (posture.accountStatus === "leaver_pending") {
    criticalFindings.push("leaver_active");
    candidates.push({ posture: "leaver_active", action: "escalate", reason: "LEAVER_STILL_ACTIVE" });
  } else if (posture.accountStatus === "disabled") {
    criticalFindings.push("disabled_active");
    candidates.push({ posture: "disabled_active", action: "escalate", reason: "ACCOUNT_DISABLED_ACTIVE" });
  } else if (posture.accountStatus === "orphaned") {
    // ── restrict: account has no valid owner/manager binding ──
    criticalFindings.push("orphaned");
    candidates.push({ posture: "orphaned", action: "restrict", reason: "ACCOUNT_ORPHANED" });
  }

  // ── restrict: an ungoverned grant — contain it ───────────────────────────────
  if (posture.entitlementScope === "out_of_scope") {
    criticalFindings.push("out_of_scope");
    candidates.push({ posture: "unscoped", action: "restrict", reason: "ENTITLEMENT_OUT_OF_SCOPE" });
  }
  if (posture.certification === "decertified") {
    criticalFindings.push("decertified");
    candidates.push({ posture: "uncertified", action: "restrict", reason: "ENTITLEMENT_DECERTIFIED" });
  }
  if (posture.sodConflict === true) {
    criticalFindings.push("sod_conflict");
    candidates.push({ posture: "sod_conflict", action: "restrict", reason: "SOD_CONFLICT" });
  }
  if (posture.privilege === "jit_expired") {
    criticalFindings.push("stale_privilege");
    candidates.push({ posture: "stale_privilege", action: "restrict", reason: "PRIVILEGE_WINDOW_EXPIRED" });
  }
  // An elevated session that is not being monitored/recorded.
  if (isElevated(posture.privilege) && posture.privilegedSessionMonitored === false) {
    criticalFindings.push("unmonitored_privilege");
    candidates.push({ posture: "unmonitored_privilege", action: "restrict", reason: "UNMONITORED_PRIVILEGED_SESSION" });
  }

  // ── step_up: governance drift — raise the bar ────────────────────────────────
  if (posture.entitlementScope === "over_privileged") {
    candidates.push({ posture: "over_privileged", action: "step_up", reason: "OVER_PRIVILEGED" });
  }
  if (posture.certification === "recert_due" || posture.certification === "never_certified") {
    candidates.push({ posture: "uncertified", action: "step_up", reason: "CERT_STALE" });
  }
  // Standing (permanent) privilege rather than JIT/time-boxed — ungoverned even if
  // monitored.
  if (posture.privilege === "standing") {
    candidates.push({ posture: "standing_privilege", action: "step_up", reason: "STANDING_PRIVILEGE" });
  }
  // Anything unreadable raises the bar (silent-failure guard).
  if (unknownSignals.length > 0) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "GOVERNANCE_STATE_UNKNOWN" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "authorized", action: "none", reason: "FULLY_AUTHORIZED" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
