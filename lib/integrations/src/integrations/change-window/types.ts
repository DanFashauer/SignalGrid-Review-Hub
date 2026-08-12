// Types for the read-only CHANGE-WINDOW dimension — is this change-class operation
// happening under a change record the organization actually approved, inside the
// window that record authorizes, by the implementer it names, on a record current
// enough to believe?
//
// Origin: `change_window` existed in this fabric only as a declared flow signal id
// carrying a HEALTH status (`lib/flows/src/factory.ts`) — "is the ITSM reachable",
// not "are we inside the approved window right now". `pim-activation` grades ticket
// validity and change class but never answers the temporal question. So the change
// plane could report perfectly healthy while a device performed a change nobody
// approved, at a time nobody authorized.
//
// THE TRAP THIS DIMENSION DELIBERATELY DOES NOT WALK INTO. Change-management
// integrations in other products typically RELAX controls during a window: "we are
// in the maintenance window, so permit the privileged action." That is a grant
// manufactured out of an ITSM row, and it inverts this fabric's law — an unknown or
// unreachable signal must raise assurance, never lower it. So:
//
//   * This dimension NEVER lowers what another dimension raised. Its only non-raising
//     verdict is `none`, which is exactly the state of not consulting the change
//     plane at all. A change record that is stale, forged, or simply wrong can
//     therefore produce NO grant that was not already available without it.
//   * `change_class` (standard / normal / emergency) is carried as evidence and
//     NEVER graded. An `emergency` class legitimately explains work outside a
//     window — and that is precisely why it must not excuse it here. "The record
//     says it was an emergency" is a source-reported string; letting it suppress a
//     step-up would let anyone who can write that field write themselves a pass.
//     A human reviewing the step-up sees the class and can act on it; the gate does
//     not.
//
// Four axes, mirroring the shift-context template (derived / trusted / posed) plus
// the recency shape proven on benchmark-selection and access-governance:
//
//   1. WINDOW STANDING. Is the caller's reference instant inside the record's
//      authorized window? DERIVED from two instants the ITSM reports and a
//      reference instant the CALLER supplies — never a believed `in_window: true`,
//      and no clock ticks inside the decision path.
//   2. CHANGE STATE. The ITSM's own approval/lifecycle state, read as an
//      allowlisted enum. The ITSM is the system of record for whether a change was
//      approved; this is the one axis that is trusted rather than derived, and an
//      unlisted spelling is malformed, never coerced. Mapping a vendor's native
//      states (ServiceNow's numeric `state` + `approval`, Jira SM's transitions)
//      onto this neutral set is the caller's job, so a future canonical mapping is
//      a rename rather than a redesign.
//   3. ACTOR AUTHORIZATION. Does the record's named implementer match the actor
//      operating the device? The CALLER poses the question by supplying the
//      operating actor; unposed is `unassessed` (carried, visible), while a POSED
//      question the ITSM cannot answer is `unknown` and raises.
//   4. RECORD FRESHNESS. Caller-posed recency: the ITSM reports when the record was
//      read, the caller supplies a maximum age and its own reference instant. No
//      max age posed = `unassessed`, so a caller who has no opinion forecloses
//      nothing.
//
// WHAT THIS DIMENSION DOES NOT DO. It does not decide whether a change SHOULD have
// been approved (that is the CAB's judgment, in the ITSM), does not create, update,
// approve or close a change record — every operation here is a read — and does not
// grade the device's posture, the worker's identity, or their custody of the device.
// Those stay with their own dimensions.

/** Where the operation stands against the record's authorized window, at the
 *  caller's reference instant. DERIVED, never believed. */
export type ChangeWindowStanding =
  | "inside" // the reference instant is within the authorized window
  | "outside" // before it opens or after it closes
  | "unknown"; // window bounds or reference instant absent/unreadable

/**
 * The ITSM's own state for the change record — the one trusted (allowlisted) axis.
 *
 * `closed` covers implemented/reviewed/completed: the record is finished, so work
 * still running under it is unattributable rather than approved.
 */
export type ChangeApprovalState =
  | "approved"
  | "pending_approval"
  | "rejected"
  | "cancelled"
  | "closed"
  | "unknown";

/**
 * Does the record's named implementer match the actor operating the device?
 *
 * `unassessed` = the CALLER supplied no operating actor — nobody posed the
 * question, and that fact is carried rather than defaulted to a match. `unknown` =
 * the question WAS posed and the record names no implementer — and unknown raises.
 */
export type ChangeActorAuthorization = "authorized" | "unauthorized" | "unassessed" | "unknown";

/**
 * How current the change record read is, against a maximum age the CALLER supplies.
 *
 * `unassessed` = no maximum age posed. Affirmative-only by construction: a caller
 * with no recency opinion forecloses nothing, and every other value is derived from
 * two instants rather than believed.
 */
export type ChangeRecordFreshness = "fresh" | "stale" | "unknown" | "unassessed";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ChangeReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — ITSM platforms are EXTERNAL and may emit
 *  anything in any slot; the normalizer, not the compiler, makes values safe). */
export interface ChangeWindowReportRaw {
  change_ref?: unknown; // evidence: the ITSM's own change identifier
  change_state?: unknown; // approved | pending_approval | rejected | cancelled | closed
  window_start?: unknown; // ISO-8601 UTC instant — the authorized window
  window_end?: unknown; // ISO-8601 UTC instant
  authorized_actor_ref?: unknown; // the implementer the record names
  change_class?: unknown; // evidence ONLY: standard | normal | emergency, never graded
  record_observed_at?: unknown; // ISO-8601 UTC instant the record was read
  source_system?: unknown; // evidence: which ITSM produced this record
  [k: string]: unknown;
}

export const CHANGE_WINDOW_REPORT_KEYS = [
  "change_ref",
  "change_state",
  "window_start",
  "window_end",
  "authorized_actor_ref",
  "change_class",
  "record_observed_at",
  "source_system",
] as const;

export interface NormalizedChangeWindow {
  sourceSystem: "change-window";
  changeRef: string;
  windowStanding: ChangeWindowStanding;
  approvalState: ChangeApprovalState;
  actorAuthorization: ChangeActorAuthorization;
  recordFreshness: ChangeRecordFreshness;
  /** The versioned-evidence record. Absent fields are null, never a placeholder. */
  itsmChangeRef: string | null;
  windowStart: string | null;
  windowEnd: string | null;
  authorizedActorRef: string | null;
  /** The caller-supplied operating actor the comparison ran against. Null when the
   *  question was not posed. */
  operatingActorRef: string | null;
  /** Carried for the human reading the step-up. NEVER graded — see the header. */
  changeClass: string | null;
  recordObservedAt: string | null;
  itsmSource: string | null;
  reportIntegrity: ChangeReportIntegrity;
  source: string;
}

export type ChangeWindowPosture =
  | "change_authorized" // the grant: approved, inside the window, right actor, current record
  | "outside_change_window" // approved, but not now
  | "change_unapproved" // the record exists and has not been approved yet
  | "change_refused" // rejected or cancelled — the organization affirmatively said no
  | "change_record_closed" // the record is finished; work under it is unattributable
  | "actor_unauthorized" // the record names a different implementer
  | "change_record_stale" // the read is older than the caller's maximum age
  | "change_unverified"; // any axis unknown / malformed / uncovered

export type ChangeWindowAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type ChangeWindowReasonCode =
  | "CHANGE_AUTHORIZED"
  | "OUTSIDE_CHANGE_WINDOW"
  | "CHANGE_NOT_APPROVED"
  | "CHANGE_REFUSED"
  | "CHANGE_RECORD_CLOSED"
  | "ACTOR_NOT_AUTHORIZED"
  | "CHANGE_RECORD_STALE"
  | "CHANGE_RECORD_TIME_UNKNOWN"
  | "WINDOW_UNKNOWN"
  | "APPROVAL_UNKNOWN"
  | "ACTOR_UNKNOWN"
  | "REPORT_MALFORMED"
  | "GRANT_BACKSTOP"
  | "NOT_COVERED";

export interface ChangeWindowVerdict {
  changeRef: string;
  posture: ChangeWindowPosture;
  reasonCode: ChangeWindowReasonCode;
  recommendedAction: ChangeWindowAction;
  /** Affirmative change-governance concerns — states the ITSM positively reported. */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when the record is approved, the reference instant is inside its
   *  window, the actor question (if posed) answered `authorized`, and the recency
   *  question (if posed) answered `fresh`. It says nothing about whether the change
   *  was WISE, nor about device posture, identity or custody. */
  changeAuthorized: boolean;
}

export class ChangeWindowConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ChangeWindowConnectorError";
  }
}
