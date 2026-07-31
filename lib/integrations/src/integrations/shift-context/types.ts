// Types for the read-only SHIFT-CONTEXT dimension — is this the right TIME and the
// right SITE for this worker to be operating a device?
//
// Origin: the fabric's premise is shift workers on shared, badge-checked-out
// devices, yet nothing consumed the LABOR plane. The custody dimensions know which
// badge holds the device; access-governance knows the account is alive; PACS knows
// the door opened inside its own permitted hours. None of them can say the thing a
// workforce-management system (UKG, Dayforce, ADP and their peers) already records:
// whether this worker is SCHEDULED to be working right now, whether they are ON THE
// CLOCK, and where the shift places them. A worker operating a controlled workflow
// while clocked out is either working off the clock — a labor-law exposure the
// employer is liable for — or is not the person the badge says. Both deserve a
// step-up, and until this dimension neither was representable.
//
// Three questions, each answered fail-closed:
//
//   1. SCHEDULE. Is the reference instant inside the worker's reported shift
//      window? DERIVED from two instants the WFM reports and a reference instant
//      the CALLER supplies — never a believed `on_shift: true` boolean, and no
//      clock ever ticks inside the decision path.
//   2. PUNCH. Clocked in, on break, or clocked out — the WFM's own punch record,
//      read as an allowlisted enum. The WFM is the source of truth for punches;
//      this is the one axis that is trusted rather than derived, and an unlisted
//      spelling is malformed, never coerced.
//   3. SITE. Does the shift's scheduled site match the site the device is at?
//      Two strings compared by case/whitespace fold — no geo inference, no
//      "Building 7A probably means Site 7". The caller poses the question by
//      supplying the device's site; a question nobody posed is `unassessed`
//      (carried, visible), while a POSED question the WFM cannot answer is
//      `unknown` and raises. Same shape as benchmark-selection's recency axis.
//
// The headline derivation is the COHERENCE of schedule x punch: on-shift but
// clocked out is off-the-clock work; clocked in but off-shift is a schedule
// deviation (real overtime happens — visible, not blocking); neither scheduled nor
// punched-in is off-duty operation. The grant requires on-shift AND clocked in.
//
// WHAT THIS DIMENSION DOES NOT DO. It never grades role fit (that is
// access-governance and core RBAC), never touches pay, hours totals, or anything
// payroll adjacent, and never lowers what another dimension raised. Field naming
// follows the HR Open Standards vocabulary (worker, shift, punch, site) so a
// future canonical-schema mapping is a rename, not a redesign.

/** Where the worker stands against their reported shift window, at the caller's
 *  reference instant. DERIVED, never believed. */
export type ScheduleStanding =
  | "on_shift" // the reference instant is inside the reported window
  | "off_shift" // outside the reported window
  | "unknown"; // window or reference instant absent/unreadable

/** The WFM's punch record — the one trusted (allowlisted) axis. */
export type PunchStatus = "clocked_in" | "on_break" | "clocked_out" | "unknown";

/**
 * Does the shift's scheduled site match the device's site?
 *
 * `unassessed` = the CALLER supplied no device site — nobody posed the question,
 * and that fact is carried rather than defaulted to a match. `unknown` = the
 * question WAS posed and the WFM reported no scheduled site — and unknown raises.
 */
export type SiteMatch = "matched" | "mismatched" | "unassessed" | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ShiftReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — WFM systems are EXTERNAL and may emit anything
 *  in any slot; the normalizer, not the compiler, makes values safe). */
export interface ShiftContextReportRaw {
  worker_ref?: unknown; // evidence: the WFM's own worker identifier
  punch_status?: unknown; // clocked_in | on_break | clocked_out
  shift_start?: unknown; // ISO-8601 UTC instant — the reported shift window
  shift_end?: unknown; // ISO-8601 UTC instant
  scheduled_site?: unknown; // where the shift places the worker
  scheduled_role?: unknown; // evidence: carried, never graded (role fit is access-governance)
  last_punch_time?: unknown; // evidence: ISO-8601 UTC instant of the latest punch
  source_system?: unknown; // evidence: which WFM produced this record
  [k: string]: unknown;
}

export const SHIFT_CONTEXT_REPORT_KEYS = [
  "worker_ref",
  "punch_status",
  "shift_start",
  "shift_end",
  "scheduled_site",
  "scheduled_role",
  "last_punch_time",
  "source_system",
] as const;

export interface NormalizedShiftContext {
  sourceSystem: "shift-context";
  workerRef: string;
  scheduleStanding: ScheduleStanding;
  punchStatus: PunchStatus;
  siteMatch: SiteMatch;
  /** The versioned-evidence record. Absent fields are null, never a placeholder. */
  wfmWorkerRef: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  scheduledSite: string | null;
  /** The caller-supplied device site the comparison ran against. Null when the
   *  question was not posed. */
  deviceSite: string | null;
  scheduledRole: string | null;
  lastPunchTime: string | null;
  wfmSource: string | null;
  reportIntegrity: ShiftReportIntegrity;
  source: string;
}

export type ShiftContextPosture =
  | "on_shift_clocked_in" // the grant: scheduled now, on the clock, site coherent
  | "on_break" // scheduled and punched, currently on break
  | "off_clock_on_shift" // scheduled NOW and clocked out — off-the-clock work
  | "schedule_deviation" // clocked in (or on break) outside any reported window
  | "off_duty" // neither scheduled nor punched in, yet operating a device
  | "site_mismatch" // the shift places the worker at a different site
  | "labor_unverified"; // any axis unknown / malformed / uncovered

export type ShiftContextAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type ShiftContextReasonCode =
  | "ON_SHIFT_AND_ON_CLOCK"
  | "ON_BREAK"
  | "OFF_CLOCK_ON_SHIFT"
  | "UNSCHEDULED_CLOCK_IN"
  | "OFF_DUTY_OPERATION"
  | "SITE_MISMATCH"
  | "SITE_UNKNOWN"
  | "SCHEDULE_UNKNOWN"
  | "PUNCH_UNKNOWN"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface ShiftContextVerdict {
  workerRef: string;
  posture: ShiftContextPosture;
  reasonCode: ShiftContextReasonCode;
  recommendedAction: ShiftContextAction;
  /** Affirmative labor-context concerns — states the WFM positively reported. */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when the worker is scheduled now, on the clock, and the site
   *  question (if posed) answered `matched`. It says nothing about identity,
   *  custody, or device posture — those stay with their own dimensions. */
  laborContextConfirmed: boolean;
}

export class ShiftContextConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ShiftContextConnectorError";
  }
}
