import { ageMs } from "../../utils/freshness";
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
 *  - a governance read RELAYED FROM A SYNC older than the caller's posed age
 *    bound → STEP_UP (the answer may be right, but it is old — a challenge,
 *    never a lockout; stale BAD news keeps outranking via worst-concern-wins);
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
  /** The governance-read recency question (intake ledger row 42), POSED BY THE
   *  CALLER: how old may the relayed governance state be and still stand as
   *  evidence of the principal's CURRENT standing? The IGA plane is
   *  cadence-based ("quarterly / on change"), so a bridge whose upstream
   *  HR/SCIM sync silently broke keeps truthfully relaying its last evaluation
   *  — affirmative, and aged. Graded against `referenceTime` — no clock in any
   *  decision path. Unposed = the axis is not graded and never forecloses
   *  (every caller and bridge deployed before the axis keeps its behavior). */
  maxGovernanceReadAgeSeconds?: number;
  /** The caller's "now", a strict ISO-8601 UTC (Zulu) instant — required for
   *  the recency axis to answer; a posed age bound without a readable
   *  reference is posed-but-unanswerable (unknown raises). */
  referenceTime?: string;
}

/** Freshness of the relayed governance read against the caller-posed bound.
 *  Derived, never trusted; `unassessed` when no bound was posed. */
export type GovernanceReadFreshness = "fresh" | "stale" | "unassessed" | "unknown";

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function instantMs(v: string | undefined | null): number | null {
  if (typeof v !== "string" || !INSTANT_RE.test(v.trim())) return null;
  const ms = Date.parse(v.trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Derive the governance read's freshness. Deterministic on three supplied
 *  inputs. Boundary: a read exactly at the bound is fresh (inclusive); a
 *  future-dated read relative to the reference is a contradiction → unknown,
 *  never fresh. */
export function deriveGovernanceReadFreshness(
  observedAt: string | null,
  maxGovernanceReadAgeSeconds: number | undefined,
  referenceTime: string | undefined,
): GovernanceReadFreshness {
  if (maxGovernanceReadAgeSeconds === undefined) return "unassessed";
  // Number.isFinite coerces nothing, so it alone rejects every non-number a
  // loosely-typed caller can pose (strings, NaN, ±Infinity, objects).
  if (!Number.isFinite(maxGovernanceReadAgeSeconds) || maxGovernanceReadAgeSeconds <= 0) {
    return "unknown"; // a garbled pose is a question we cannot read — never answered optimistically
  }
  const observedMs = instantMs(observedAt);
  const referenceMs = instantMs(referenceTime);
  if (observedMs === null || referenceMs === null) return "unknown";
  // Tolerance 0, NOT the shared FUTURE_SKEW_TOLERANCE_MS: this family's reference
  // instant is POSED BY THE CALLER, not read from a clock, so there is no second
  // clock to skew against — and widening to 60s would turn a future-dated read from
  // `unknown` (which RAISES here) into `fresh`. A fold must never lower a verdict.
  const age = ageMs(observedMs, referenceMs, 0);
  if (age === null) return "unknown"; // future-dated evidence is a contradiction
  return age <= maxGovernanceReadAgeSeconds * 1000 ? "fresh" : "stale";
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

  // ── the J and M of JML (intake ledger row 27) — lifecycle CONTEXT is the WHY ──
  // behind an entitlement symptom. AFFIRMATIVE-ONLY: the bridge must assert the
  // stage; `unknown` forecloses nothing (most bridges predate the axis).
  //  - a RECENT TRANSFER whose entitlements are over-privileged or recert-due is
  //    the classic mover defect — pre-transfer grants that were never revoked.
  //    The symptom alone already steps up above; symptom + mover context is an
  //    operator-scale finding with its OWN reason, so the queue reads "stale
  //    transfer entitlements", not generic drift → ALERT.
  //  - a NEW HIRE already holding STANDING privilege is over-provisioned at
  //    birth (the birthright-access defect) → ALERT.
  //  - either stage with everything else clean is a visible MONITOR — a
  //    transition is normal life, not suspicion, and nagging every transfer
  //    would teach operators to ignore the axis.
  if (
    posture.lifecycleStage === "recent_transfer" &&
    (posture.entitlementScope === "over_privileged" || posture.certification === "recert_due")
  ) {
    criticalFindings.push("mover_stale_entitlement");
    candidates.push({ posture: "mover_stale_entitlement", action: "alert", reason: "MOVER_STALE_ENTITLEMENT" });
  }
  if (posture.lifecycleStage === "new_hire" && posture.privilege === "standing") {
    criticalFindings.push("new_hire_standing_privilege");
    candidates.push({ posture: "joiner_over_provisioned", action: "alert", reason: "NEW_HIRE_OVER_PROVISIONED" });
  }
  if (posture.lifecycleStage === "new_hire" || posture.lifecycleStage === "recent_transfer") {
    candidates.push({ posture: "lifecycle_transition", action: "monitor", reason: "LIFECYCLE_TRANSITION" });
  }

  // ── the governance-read recency axis (intake ledger row 42) — graded ONLY when
  // the caller posed an age bound. The IGA plane is cadence-based, so a bridge
  // whose upstream HR/SCIM sync silently broke keeps truthfully relaying its
  // last evaluation: affirmative values, aged. A relayed "authorized" older
  // than the posed bound is not evidence of CURRENT standing → step_up, a
  // challenge and never a lockout (capped by design: the fact is "the answer
  // is old", not "the answer is bad"). Because this is one CANDIDATE on the
  // worst-concern-wins ladder, stale bad news keeps outranking — a
  // leaver_pending relayed from a stale sync still escalates; staleness never
  // launders a known concern down to a challenge.
  const readFreshness = deriveGovernanceReadFreshness(
    posture.observedAt ?? null,
    options.maxGovernanceReadAgeSeconds,
    options.referenceTime,
  );
  if (readFreshness === "stale") {
    candidates.push({ posture: "stale_governance_read", action: "step_up", reason: "GOVERNANCE_READ_STALE" });
  } else if (readFreshness === "unknown") {
    // Posed-but-unanswerable: the caller asked the currency question and the
    // bridge/reference could not answer it — unknown raises, never grants.
    unknownSignals.push("governance_read_time");
    candidates.push({ posture: "unverified", action: "step_up", reason: "GOVERNANCE_READ_TIME_UNKNOWN" });
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
