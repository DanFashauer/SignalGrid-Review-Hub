// Types for the read-only IAM / access-governance runtime decision dimension.
//
// IAM is not a single control — it is five pillars (identity lifecycle,
// authentication, authorization, governance, privileged access). Three of those
// are already owned by other SignalGrid dimensions: authentication/sign-in risk by
// `identity-risk`, endpoint secrets by `credential-exposure`, physical badge
// custody by `rtls-custody`. This dimension answers the one runtime question none
// of them do for the identity now bound to a badge-checked-out shared session:
// **is THIS principal actually ALLOWED to do THIS, and is that grant still
// governed?** It folds the uncovered slices — account-lifecycle standing
// (Leaver/orphaned/disabled), entitlement scope (least-privilege), access
// certification + segregation-of-duties, and privileged-access state
// (standing-vs-JIT + session monitoring) — into ONE fail-safe verdict.
//
// Fail-safe by construction: a Leaver/disabled account still transacting
// ESCALATES; an orphaned account, an out-of-scope or decertified entitlement, a
// segregation-of-duties conflict, an expired JIT window still in use, or an
// unmonitored privileged session all RESTRICT; standing (not JIT) privilege, a
// stale/never-certified entitlement, or an over-broad role STEP UP; anything
// unreadable steps up; a principal no governance source observes is a blind spot
// (unknown), never "authorized". Nothing unknown ever reads as authorized.
//
// SignalGrid changes no entitlement — every signal is read-only. It consumes the
// evaluated governance state (it does NOT re-pull raw directory group membership,
// which graph/uem own) and gates the action.

/** Identity-lifecycle account standing (the runtime slice of JML). */
export type AccessAccountStatus = "active" | "disabled" | "orphaned" | "leaver_pending" | "unknown";
/** Where the principal sits in the identity lifecycle — the J and M the leaver
 *  slice above never carried (intake ledger row 27: an audit of the owner's
 *  canonical endpoint signal set found "joiner/mover context" modeled nowhere).
 *  Reported by the IGA bridge. AFFIRMATIVE-ONLY: an explicit `new_hire` or
 *  `recent_transfer` grades; `unknown` (unreported) forecloses nothing, because
 *  most bridges predate the axis and a transition is normal life, not
 *  suspicion. What the stages buy is the WHY behind an entitlement symptom: a
 *  recent transfer whose grants are over-privileged is the classic
 *  pre-transfer-entitlements-never-revoked defect, and a new hire already
 *  holding standing privilege is over-provisioned at birth. */
export type AccessLifecycleStage = "new_hire" | "established" | "recent_transfer" | "unknown";
/** Least-privilege appropriateness of the entitlement for the attempted action. */
export type AccessEntitlementScope = "in_scope" | "over_privileged" | "out_of_scope" | "unknown";
/** Access-certification freshness of the entitlement. */
export type AccessCertificationState = "certified" | "recert_due" | "decertified" | "never_certified" | "unknown";
/** Privileged-access state. `standing` = permanent (worst); `jit_active` = a
 *  time-boxed grant in an active window; `jit_expired` = the window closed but the
 *  elevation persists (ungoverned). */
export type AccessPrivilegeState = "none" | "jit_active" | "jit_expired" | "standing" | "unknown";

/** Raw IGA/PAM-bridge report about one principal's governance state (loosely
 *  typed — any field may degrade to null / an error string / be absent). */
export interface AccessGovernanceReportRaw {
  account?: { status?: unknown; [k: string]: unknown };
  lifecycle?: { stage?: unknown; [k: string]: unknown };
  entitlement?: { scope?: unknown; [k: string]: unknown };
  certification?: { state?: unknown; [k: string]: unknown };
  sod?: { conflict?: boolean | null; [k: string]: unknown };
  privilege?: { mode?: unknown; sessionMonitored?: boolean | null; [k: string]: unknown };
  [k: string]: unknown;
}

/** The normalized, vendor-neutral access-governance posture — one shape the fabric
 *  reads. */
export interface NormalizedAccessGovernancePosture {
  sourceSystem: "access-governance";
  /** The IGA/directory principal bound to the session (the fetch key). */
  principalId: string;
  accountStatus: AccessAccountStatus;
  lifecycleStage: AccessLifecycleStage;
  entitlementScope: AccessEntitlementScope;
  certification: AccessCertificationState;
  /** true = a segregation-of-duties conflict is present. null = unknown (fail-safe:
   *  raises the bar, never read as "no conflict"). */
  sodConflict: boolean | null;
  privilege: AccessPrivilegeState;
  /** Whether an elevated session is monitored/recorded. Only meaningful when
   *  privilege is elevated. false on an elevated session is a hard restrict.
   *  null = unknown. */
  privilegedSessionMonitored: boolean | null;
  source: string;
}

export type AccessGovernancePosture =
  | "authorized"
  | "over_privileged"
  | "unscoped"
  | "uncertified"
  | "sod_conflict"
  | "standing_privilege"
  | "stale_privilege"
  | "unmonitored_privilege"
  | "leaver_active"
  | "disabled_active"
  | "orphaned"
  | "mover_stale_entitlement"
  | "joiner_over_provisioned"
  | "lifecycle_transition"
  | "unverified"
  | "unknown";

export type AccessGovernanceReasonCode =
  | "FULLY_AUTHORIZED"
  | "LEAVER_STILL_ACTIVE"
  | "ACCOUNT_DISABLED_ACTIVE"
  | "ACCOUNT_ORPHANED"
  | "ENTITLEMENT_OUT_OF_SCOPE"
  | "ENTITLEMENT_DECERTIFIED"
  | "SOD_CONFLICT"
  | "PRIVILEGE_WINDOW_EXPIRED"
  | "UNMONITORED_PRIVILEGED_SESSION"
  | "OVER_PRIVILEGED"
  | "CERT_STALE"
  | "STANDING_PRIVILEGE"
  | "MOVER_STALE_ENTITLEMENT"
  | "NEW_HIRE_OVER_PROVISIONED"
  | "LIFECYCLE_TRANSITION"
  | "GOVERNANCE_STATE_UNKNOWN"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type AccessGovernanceRecommendedAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface AccessGovernanceVerdict {
  posture: AccessGovernancePosture;
  reasonCode: AccessGovernanceReasonCode;
  recommendedAction: AccessGovernanceRecommendedAction;
  /** Concerns at restrict level or higher (leaver/disabled/orphaned account,
   *  out-of-scope/decertified entitlement, SoD conflict, expired/unmonitored
   *  privilege). */
  criticalFindings: string[];
  /** Governance signals whose state could NOT be determined (raise assurance,
   *  fail-safe). */
  unknownSignals: string[];
  /** Echoes the evaluated principal so downstream drivers carry the subject id. */
  principalId: string;
}

export type AccessGovernanceConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class AccessGovernanceConnectorError extends Error {
  readonly code: AccessGovernanceConnectorErrorCode;
  readonly status: number;
  constructor(code: AccessGovernanceConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "AccessGovernanceConnectorError";
    this.code = code;
    this.status = status;
  }
}
