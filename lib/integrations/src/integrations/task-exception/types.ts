// Types for the read-only task-exception dimension — "the task completed" is not
// "the task completed correctly".
//
// The fabric already asks WHO holds the device (`rtls-custody`, `sso-session`,
// `pacs-access`), whether the device is governed (`device-management-health`) and
// whether its link works (`link-usability`). None of those ask the question that
// decides whether the WORK flowing through that session can be believed: **did the
// task-execution system behind this device raise an exception about the work, and if
// so, where is that exception in its lifecycle?**
//
// The failure it exists to catch is the one every execution system documents and no
// trust fabric reads: a worker scans the wrong item and the verify step catches it; a
// worker skips the scan entirely and nothing catches it; a pick comes up short and the
// system opens a discrepancy; and — the fabric's core question — the worker or device
// EXECUTING a task is not the one it was ASSIGNED to. Every one of these is a fact the
// execution system already evaluated. This connector normalizes that evaluated view.
// It assigns no task, confirms no pick, closes no exception and adjusts no inventory —
// those stay with the execution system.
//
// The vocabulary is vendor-neutral but grounded in what execution systems actually
// model, not invented here:
//   - the task lifecycle mirrors the Oracle WMS Cloud task states (Ready / HELD /
//     Processing Started / Completed / Cancelled); SAP EWM's Open/Waiting statuses
//     fold into ready/held;
//   - the exception kinds are the classes behind SAP EWM's exception codes (BIDF/BIDP
//     pick denial, DIFF difference, CHBD bin damaged), which are exposed per warehouse
//     task through its warehouse-order/task OData model, and behind Oracle's
//     short-pick handling; the clinical analog is BCMA's wrong-medication scan and the
//     FHIR Task lifecycle;
//   - the resolution chain mirrors Oracle's documented short-pick behaviour, where the
//     discrepancy spawns a cycle-count task rather than silently closing.
// The vendor CODES themselves are deliberately not modelled as an enum — see
// `sourceExceptionCode`.

/** What class of exception the execution system raised about this device's task.
 *
 *  `none` is a POSITIVE assertion that no exception is raised — not silence. Silence
 *  is `unknown`, and unknown denies like everywhere else.
 *
 *  `verification_failed` — a scan/verify step RAN and matched the wrong object: the
 *  wrong-item scan, the BCMA wrong-med analog. The control worked; the work was wrong.
 *
 *  `procedure_bypassed` — a REQUIRED verification was skipped entirely: the no-scan
 *  workaround. Graded ABOVE `verification_failed` on purpose: a verification that
 *  failed is a control doing its job; a verification that never ran is a control
 *  silently absent, and nothing downstream of it can be believed.
 *
 *  `assignment_mismatch` — the worker or device EXECUTING the task differs from the
 *  one it was ASSIGNED to. THE identity-binding violation, and this fabric's core
 *  question: every custody, session and badge signal binds a person to a device, and
 *  this is the execution system reporting that the binding did not hold where the work
 *  happened.
 *
 *  `inventory_exception` — short pick, empty or wrong location, inventory
 *  discrepancy, damaged stock (the SAP DIFF / bin-damaged class; Oracle's short-pick
 *  trigger). The "bin in the wrong aisle, item not in inventory" case: a fact about
 *  the WORK and the stock, not about the worker.
 *
 *  `task_flow_stalled` — the task is stalled, overdue or blocked. DERIVED BY BRIDGES:
 *  research across the systems this vocabulary is grounded in found NO execution
 *  system that exposes "stalled" as a first-class task state — a bridge infers it from
 *  timestamps and thresholds it owns. It is carried because operators need it, and it
 *  is graded lowest because it is the one kind on this list that is an inference
 *  rather than a report.
 *
 *  `transaction_error` — the RF/device transaction failed during a confirm or create
 *  (the SAP RF-transaction-failure analog). A broken delivery channel for the
 *  confirmation, not a known defect in the work. */
export type TaskExceptionKind =
  | "none"
  | "verification_failed"
  | "procedure_bypassed"
  | "assignment_mismatch"
  | "inventory_exception"
  | "task_flow_stalled"
  | "transaction_error"
  | "unknown";

/** Where the raised exception is in ITS OWN lifecycle, as distinct from the task's.
 *
 *  `not_applicable` is a POSITIVE assertion that no exception lifecycle exists at all,
 *  and it is coherent ONLY beside `exceptionKind: "none"`. It is precisely the value a
 *  bridge hardcodes for "we don't model exception lifecycles", and the evaluator
 *  refuses to let it stand beside a real exception — see the applicability
 *  contradiction. That exact shape (a hardcoded `not_applicable` acting as a free
 *  pass) shipped broken in `link-usability`'s first draft, and it is not repeated
 *  here.
 *
 *  `resolution_task_created` mirrors the documented Oracle short-pick chain: the
 *  discrepancy spawned a follow-up task (a cycle count). A CREATED task is not a
 *  COMPLETED one — neither `acknowledged` nor `resolution_task_created` reduces
 *  severity, because a ticket is not a fix.
 *
 *  `resolved` closes the exception. A recently-resolved exception is worth watching
 *  and still never grants — see the evaluator. */
export type TaskExceptionState =
  | "not_applicable"
  | "active"
  | "acknowledged"
  | "resolution_task_created"
  | "resolved"
  | "unknown";

/** The task's own lifecycle state, normalized over the verified Oracle WMS Cloud
 *  lifecycle (Ready / HELD / Processing Started / Completed / Cancelled). SAP EWM's
 *  Open and Waiting statuses fold into `ready`/`held`.
 *
 *  Every affirmative state is a HEALTHY answer when no exception is raised —
 *  `cancelled` included: a cancel is an orderly, authorized lifecycle outcome, not an
 *  exception, and the exception channel is separate on every system this is grounded
 *  in. What the task state buys the evaluator is COHERENCE: execution-time exceptions
 *  are raised at confirm time (verified SAP semantics), so they cannot coexist with a
 *  task that never started — see the phase contradiction. */
export type NormalizedTaskState =
  | "ready"
  | "held"
  | "in_process"
  | "completed"
  | "cancelled"
  | "unknown";

/** Raw task-exception report about one device (loosely typed).
 *
 *  EVERY field is `unknown`, including the boolean and the passthrough string. A
 *  bridge is an external system: it can and does emit `"TRUE"`, `1`, `[]`,
 *  `"ERR: wms timeout"`, or a throwing accessor in any of these slots, and the
 *  normalizer — not the compiler — is what makes that safe. */
export interface TaskExceptionReportRaw {
  exceptionKind?: unknown; // none | verification_failed | procedure_bypassed | assignment_mismatch | inventory_exception | task_flow_stalled | transaction_error | unknown
  exceptionState?: unknown; // not_applicable | active | acknowledged | resolution_task_created | resolved | unknown
  taskState?: unknown; // ready | held | in_process | completed | cancelled | unknown
  taskSystemReachable?: unknown; // boolean
  sourceExceptionCode?: unknown; // vendor code string (e.g. "BIDF", "DIFF"), or null
  [k: string]: unknown;
}

/** The exact set of keys this connector understands. Anything else means the report
 *  was not fully understood — see `reportIntegrity`. */
export const TASK_EXCEPTION_REPORT_KEYS = [
  "exceptionKind",
  "exceptionState",
  "taskState",
  "taskSystemReachable",
  "sourceExceptionCode",
] as const;

/** Did the raw report parse cleanly?
 *
 *  `malformed` = at least one known field was PRESENT but unparseable, or the report
 *  carried an unrecognized key, or a field could not be read at all. The normalized
 *  enums cannot express this on their own: the allowlist folds every unrecognized
 *  value into `"unknown"`, collapsing "the report said nothing" and "the report said
 *  something we could not read" into one sentinel. The distinction is tracked
 *  separately and independently denied on, so the allow path never rests on a value we
 *  only *think* we understood. */
export type ReportIntegrity = "clean" | "malformed";

/** The normalized, vendor-neutral task-exception posture. */
export interface NormalizedTaskException {
  sourceSystem: "task-exception";
  deviceId: string;
  exceptionKind: TaskExceptionKind;
  exceptionState: TaskExceptionState;
  taskState: NormalizedTaskState;
  /** true = the execution system answered for this device; false = it did not; null =
   *  not reported. Only an explicit true can back a grant. */
  taskSystemReachable: boolean | null;
  /** The vendor's own exception code (SAP "BIDF"/"DIFF"-class), carried VERBATIM for
   *  audit and NEVER judged. The judged fact is the normalized `exceptionKind`; the
   *  code is what an operator pastes into the vendor console to find the record.
   *  Judging it would mean maintaining a shadow copy of every customer's exception-code
   *  table here, which would be wrong the day it was written; canonicalizing it (trim/
   *  case) would falsify the audit trail it exists to serve. A non-string, non-null
   *  value in this slot is still `malformed` — present but unreadable is not a code. */
  sourceExceptionCode: string | null;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type TaskExceptionPosture =
  | "task_stream_healthy"
  /** A confirmed integrity violation in how the work was executed: the wrong
   *  executor, a skipped verification, or a verification that caught the wrong
   *  object. The class this dimension exists to name. */
  | "task_integrity_violation"
  | "inventory_exception"
  | "task_flow_degraded"
  /** A real exception whose lifecycle is CLOSED. Watched, never granted. */
  | "exception_resolved"
  | "unverified"
  | "unknown";

export type TaskExceptionReasonCode =
  | "TASK_STREAM_HEALTHY"
  | "TASK_ASSIGNMENT_MISMATCH"
  | "PROCEDURE_BYPASSED"
  | "VERIFICATION_FAILED"
  | "INVENTORY_EXCEPTION_ACTIVE"
  | "TASK_TRANSACTION_ERROR"
  | "TASK_FLOW_STALLED"
  | "TASK_EXCEPTION_RESOLVED"
  /** The report's fields contradict each other (kind vs state, kind vs task phase). */
  | "TASK_REPORT_INCONSISTENT"
  | "TASK_STATE_UNKNOWN"
  | "TASK_SYSTEM_UNREACHABLE"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type TaskExceptionAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface TaskExceptionVerdict {
  posture: TaskExceptionPosture;
  reasonCode: TaskExceptionReasonCode;
  recommendedAction: TaskExceptionAction;
  /** Confirmed known-bad FACTS about this device's task stream, as opposed to gaps in
   *  what we know — an exception the execution system affirmatively raised and has not
   *  resolved. */
  criticalFindings: string[];
  /** Task facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True only when the task stream is positively confirmed healthy: no exception
   *  raised, no exception lifecycle open, the task in an affirmative lifecycle state,
   *  the execution system confirmed reachable, and the report fully understood. */
  taskStreamHealthy: boolean;
  deviceId: string;
}

export type TaskExceptionConnectorErrorCode =
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

export class TaskExceptionConnectorError extends Error {
  readonly code: TaskExceptionConnectorErrorCode;
  readonly status: number;
  constructor(code: TaskExceptionConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "TaskExceptionConnectorError";
    this.code = code;
    this.status = status;
  }
}
