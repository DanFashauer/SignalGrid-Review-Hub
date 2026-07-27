import {
  type NormalizedTaskException,
  type TaskExceptionAction,
  type TaskExceptionPosture,
  type TaskExceptionReasonCode,
  type TaskExceptionVerdict,
} from "./types";

/**
 * Pure, deterministic task-exception evaluator. Folds "did the execution system raise
 * an exception about this device's work, and is anyone on it?" into ONE posture + the
 * action it warrants, fail-safe.
 *
 * The custody, session and badge dimensions bind a person to a device. This dimension
 * starts where they stop and asks whether the binding HELD where the work happened —
 * the execution system is the one witness that watches every confirm. The two do not
 * overlap on purpose: who is logged in stays with `sso-session`, who holds the device
 * stays with `rtls-custody`; this reads only what the execution system already
 * concluded about the task.
 *
 *  - an ASSIGNMENT MISMATCH (the executing worker or device differs from the assigned
 *    one — the identity-binding violation this fabric exists to catch) or a BYPASSED
 *    required verification → RESTRICT. Both are confirmed facts that the controls
 *    around the work were not in force;
 *  - a FAILED verification (the control ran and caught the wrong object) or an open
 *    INVENTORY exception (short pick, wrong/empty location, damaged) → ALERT.
 *    Confirmed facts about the work, not gaps in what we know;
 *  - a failed RF/device TRANSACTION, a self-contradictory report, an unreachable
 *    execution system, or anything unreadable → STEP_UP (never trust silence);
 *  - a bridge-DERIVED stall, or a real exception whose lifecycle is RESOLVED →
 *    MONITOR. Watched, never granted;
 *  - the grant requires ALL FIVE positively confirmed AND COHERENT: no exception
 *    raised, no exception lifecycle open (`not_applicable` beside `none` is the only
 *    coherent pairing), the task in an affirmative lifecycle state, the execution
 *    system confirmed reachable, and the report fully understood.
 *    Worst-concern-wins.
 *
 * The severity inversion is deliberate: `procedure_bypassed` (restrict) outranks
 * `verification_failed` (alert). A verification that failed is a control DOING ITS
 * JOB — the wrong item was caught at the scan, and the exception record proves the
 * control was in force. A verification that never ran is a control silently absent:
 * nothing was caught because nothing was looking, and every confirmation downstream of
 * it is a number standing in for a fact it does not cover. Grading the missing control
 * above the failed one is this dimension's version of the quiet-failure inversion that
 * `link-usability` grades between "associated but carrying nothing" and "offline".
 *
 * `acknowledged` and `resolution_task_created` do NOT reduce severity. A ticket is not
 * a fix: the Oracle short-pick chain this state models CREATES a cycle-count task, and
 * until that count runs the discrepancy is exactly as real as it was the moment the
 * pick came up short. `resolved` is different — the lifecycle is CLOSED — and even
 * then the verdict is `monitor`, never a grant: a resolved short pick that sailed to
 * `none` would let the grant count silently include kinds other than `none`.
 *
 * `covered=false` = no task-exception result was returned for this device → unknown
 * (a gap), step_up.
 */

const ACTION_SEVERITY: Record<TaskExceptionAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateTaskExceptionOptions {
  /** False when no task-exception result was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: TaskExceptionPosture;
  action: TaskExceptionAction;
  reason: TaskExceptionReasonCode;
}

export function evaluateTaskException(
  task: NormalizedTaskException,
  options: EvaluateTaskExceptionOptions = {},
): TaskExceptionVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: task.deviceId };

  if (!covered) {
    return {
      ...base,
      posture: "unknown",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      taskStreamHealthy: false,
    };
  }

  const candidates: Candidate[] = [];

  // A report we could not fully parse is never a grant, independently of what its
  // fields normalized to. Defence in depth: the allow path must not rest on a value we
  // only think we understood.
  if (task.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // A report that contradicts itself is judged before anything derived from it, and —
  // as in `device-management-health` and `link-usability`, where this lesson was paid
  // for — the disbelieved half is then NOT JUDGED AT ALL. A dimension does not get to
  // disbelieve a claim and cite it in the same breath.
  //
  // FOUR relations live in these three fields. Each is the bridge's error rather than
  // the worker's, each pushes its own named gap, and each headlines the same reason:
  // the operator's next action is to fix the bridge mapping, not the task.

  // (C1) An exception LIFECYCLE asserted for NO exception. `exceptionState` positions
  // an exception in its lifecycle; with `exceptionKind: "none"` there is no exception
  // to position. This relation is also the only thing standing between
  // "kind none + state active" and the grant — `none` is otherwise exactly the kind
  // that grants — so it is load-bearing against the enumeration, not just taxonomy.
  const lifecycleInconsistent =
    task.exceptionKind === "none" &&
    (task.exceptionState === "active" ||
      task.exceptionState === "acknowledged" ||
      task.exceptionState === "resolution_task_created" ||
      task.exceptionState === "resolved");
  if (lifecycleInconsistent) {
    unknownSignals.push("exception_lifecycle_consistency");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_REPORT_INCONSISTENT" });
  }

  // (C2) The mirror: a REAL exception with `exceptionState: "not_applicable"`.
  // `not_applicable` is a positive assertion that no exception lifecycle exists, and
  // it is exactly the value a bridge hardcodes for "we don't model this" — so it must
  // never be a free pass past the lifecycle question. This precise shape (a hardcoded
  // `not_applicable` sailing through the only check its field has) shipped broken in
  // `link-usability`'s first draft and let three of its six granting shapes through
  // incoherent. It is modelled here from the start instead of after review.
  const isRealException = task.exceptionKind !== "none" && task.exceptionKind !== "unknown";
  const applicabilityInconsistent = isRealException && task.exceptionState === "not_applicable";
  if (applicabilityInconsistent) {
    unknownSignals.push("exception_applicability_consistency");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_REPORT_INCONSISTENT" });
  }

  // (C3) An EXECUTION-TIME exception on a task that never started. Verified SAP
  // semantics: pick-denial and RF-transaction exceptions are raised at CONFIRM time,
  // so a task still `ready` or `held` has had no confirm to fail. `assignment_mismatch`
  // is deliberately OUTSIDE this relation — an Oracle HELD task is assigned, and a
  // wrong-executor detection at claim time is a real mismatch, not a bridge error.
  // `inventory_exception` is outside it too: a damaged-bin/discrepancy flag can
  // legitimately precede execution.
  const phaseInconsistent =
    (task.taskState === "ready" || task.taskState === "held") &&
    (task.exceptionKind === "verification_failed" ||
      task.exceptionKind === "procedure_bypassed" ||
      task.exceptionKind === "transaction_error");
  if (phaseInconsistent) {
    unknownSignals.push("task_phase_consistency");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_REPORT_INCONSISTENT" });
  }

  // (C4) A task that is FINISHED cannot be CURRENTLY stalled. `task_flow_stalled` is a
  // bridge-derived inference to begin with (no execution system exposes stall as a
  // first-class state), and a bridge still deriving "stalled, active" from a task the
  // system reports completed or cancelled is reading a stale snapshot. Only the
  // CLOSED lifecycle states are outside the relation: a stall RESOLVED (or voided)
  // before the task finished is an ordinary history.
  //
  // `resolution_task_created` is inside the relation, and adversarial review is why
  // that has to be said: the first draft listed only active|acknowledged, so the SAME
  // open stall got the calmer verdict one lifecycle step LATER — a spawned follow-up
  // ticket was letting a finished-yet-stalled report through as a live "degraded flow"
  // reading. This dimension's own severity model says a ticket is not a fix; the
  // contradiction relation has to say it too, or the two disagree about which states
  // are open.
  const stallInconsistent =
    (task.taskState === "completed" || task.taskState === "cancelled") &&
    task.exceptionKind === "task_flow_stalled" &&
    (task.exceptionState === "active" ||
      task.exceptionState === "acknowledged" ||
      task.exceptionState === "resolution_task_created");
  if (stallInconsistent) {
    unknownSignals.push("stall_lifecycle_consistency");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_REPORT_INCONSISTENT" });
  }

  // An explicit `false` is the execution system saying it did NOT answer for this
  // device — a known-bad fact, not a gap, and it makes every other field a value the
  // bridge is repeating rather than one the system just confirmed. Hoisted here, near
  // the top, for the reason `device-management-health` measured rather than guessed:
  // an asserted negative must not lose a step_up tie to a generic unknown from one
  // unreadable field. The `null` case stays at the bottom — a field the bridge never
  // mentioned is a gap like any other.
  //
  // It does NOT contribute a `criticalFindings` entry. That field is documented as
  // confirmed known-bad facts about THIS DEVICE'S WORK, and "the system did not
  // answer" is a fact about the read, not about the task.
  if (task.taskSystemReachable === false) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_SYSTEM_UNREACHABLE" });
  }

  // ── the exception itself, judged only where the report coheres ────────────────
  //
  // `resolved` closes the exception: the active-exception candidate is NOT raised, and
  // the verdict is a `monitor` watch instead — a recently-resolved exception is worth
  // watching and must never grant. The carve-out carries NO contradiction guard, and
  // that is derived rather than hoped: C2 and C4 each require a state other than
  // `resolved`, so they cannot co-occur with it; C1 requires kind `none`, which
  // `isRealException` excludes; and under C3 (the one relation that CAN co-occur) this
  // candidate is `monitor`, strictly below the contradiction's `step_up`, so it can
  // never headline and pushes no finding. If TASK_EXCEPTION_RESOLVED is ever raised
  // above `monitor`, a `!phaseInconsistent` guard becomes necessary here.
  const exceptionClosed = isRealException && task.exceptionState === "resolved";
  if (exceptionClosed) {
    candidates.push({ posture: "exception_resolved", action: "monitor", reason: "TASK_EXCEPTION_RESOLVED" });
  } else if (task.exceptionKind === "assignment_mismatch") {
    // THE identity-binding violation — the fabric's core question, answered by the one
    // witness that watches every confirm. `restrict` because the binding every other
    // dimension certifies (badge → session → custody) demonstrably did not hold where
    // the work happened. Guarded by `!applicabilityInconsistent`: when the report also
    // claims no exception lifecycle exists, the mismatch claim is not evidence of
    // anything and is not judged — LOAD-BEARING, since restrict would otherwise
    // outrank the contradiction's step_up and cite a disbelieved claim as a finding.
    if (!applicabilityInconsistent) {
      criticalFindings.push("task_assignment_mismatch");
      candidates.push({ posture: "task_integrity_violation", action: "restrict", reason: "TASK_ASSIGNMENT_MISMATCH" });
    }
  } else if (task.exceptionKind === "procedure_bypassed") {
    // The no-scan workaround: the required verification never ran. Graded ABOVE the
    // failed verification below — see the header. Both guards are LOAD-BEARING at
    // `restrict`: either contradiction outranked would otherwise be buried under a
    // candidate built from the half of the report it disbelieves.
    if (!applicabilityInconsistent && !phaseInconsistent) {
      criticalFindings.push("procedure_bypassed");
      candidates.push({ posture: "task_integrity_violation", action: "restrict", reason: "PROCEDURE_BYPASSED" });
    }
  } else if (task.exceptionKind === "verification_failed") {
    // The control RAN and caught the wrong object (wrong-item scan; BCMA wrong-med
    // analog). A confirmed fact about the work → alert; not restrict, because the
    // record itself proves the control was in force. Both guards LOAD-BEARING at
    // `alert` for the same arithmetic as above.
    if (!applicabilityInconsistent && !phaseInconsistent) {
      criticalFindings.push("verification_failed");
      candidates.push({ posture: "task_integrity_violation", action: "alert", reason: "VERIFICATION_FAILED" });
    }
  } else if (task.exceptionKind === "inventory_exception") {
    // Short pick / wrong or empty location / discrepancy / damaged (SAP DIFF class,
    // Oracle short-pick trigger). A confirmed fact about the work and the stock →
    // alert. Not gated on `phaseInconsistent` — a discrepancy flag can legitimately
    // precede execution. The C2 guard is LOAD-BEARING at `alert`.
    if (!applicabilityInconsistent) {
      criticalFindings.push("inventory_exception_active");
      candidates.push({ posture: "inventory_exception", action: "alert", reason: "INVENTORY_EXCEPTION_ACTIVE" });
    }
  } else if (task.exceptionKind === "transaction_error") {
    // The RF/device transaction failed during a confirm — a broken delivery channel
    // for the confirmation, not a known defect in the work (the same grading
    // `device-management-health` gives a remediation script that could not run).
    // Both guard clauses are INERT at current severities, established by the same
    // arithmetic as `link-usability`'s labelled-inert guards: this candidate is
    // `step_up`, each contradiction candidate is `step_up` and was pushed first, so
    // the contradiction wins the tie regardless, and this branch pushes no finding.
    // Kept because they encode the rule ("never judge a disbelieved claim") and become
    // load-bearing the moment this severity is raised.
    if (!applicabilityInconsistent && !phaseInconsistent) {
      candidates.push({ posture: "task_flow_degraded", action: "step_up", reason: "TASK_TRANSACTION_ERROR" });
    }
  } else if (task.exceptionKind === "task_flow_stalled") {
    // Bridge-DERIVED (no execution system exposes stall first-class), which is why it
    // is the one kind graded `monitor`: an inference from thresholds the bridge owns
    // is watched, not acted on. Both guard clauses are INERT at current severities —
    // `monitor` is strictly below the contradictions' `step_up`, so they can never
    // change a verdict — and are kept for the same reason as the pair above.
    if (!applicabilityInconsistent && !stallInconsistent) {
      candidates.push({ posture: "task_flow_degraded", action: "monitor", reason: "TASK_FLOW_STALLED" });
    }
  } else if (task.exceptionKind === "unknown") {
    unknownSignals.push("exception_kind");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_STATE_UNKNOWN" });
  }

  // The remaining gaps, judged AFTER every named diagnosis so that a named step_up
  // (TASK_TRANSACTION_ERROR, TASK_SYSTEM_UNREACHABLE) wins the tie over a generic
  // unknown — the ordering mistake `device-management-health` measured and fixed.
  if (task.exceptionState === "unknown") {
    unknownSignals.push("exception_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_STATE_UNKNOWN" });
  }

  if (task.taskState === "unknown") {
    unknownSignals.push("task_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE confirmation the execution system answered for THIS
  // device. The explicit `false` was already judged near the top as a known-bad fact;
  // this is the UNREPORTED case — a gap, so it is raised last, after every named
  // diagnosis.
  if (task.taskSystemReachable === null) {
    unknownSignals.push("task_system_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "TASK_SYSTEM_UNREACHABLE" });
  }

  // Worst-concern-wins. Strict `>` so the FIRST candidate pushed wins ties — the push
  // order above is the tie order. The seed survives only if NO candidate was raised,
  // which is exactly the five-way positive confirmation.
  const seed: Candidate = {
    posture: "task_stream_healthy",
    action: "none",
    reason: "TASK_STREAM_HEALTHY",
  };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    taskStreamHealthy: winner.action === "none",
  };
}
