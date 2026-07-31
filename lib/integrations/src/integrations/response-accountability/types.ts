// Types for the READ-ONLY response-accountability dimension.
//
// THE QUESTION: once this fabric has raised a concern, did a named human actually
// take it, in time, and did the concern actually go away — or was it merely CLOSED?
//
// ── THE WATERMELON ───────────────────────────────────────────────────────────
//
// Named after the ITSM failure mode: green outside, red inside. The support desk
// creates a ticket for a critical crash, responds in five minutes, clears the cache,
// closes the ticket, and the SLA dashboard goes green. Then the software crashes
// again. Every metric was met and nothing was fixed.
//
// The dashboard was measuring OUTPUT — did we respond, did we close — while the user
// experienced the OUTCOME, which was unchanged. A metric that cannot tell those apart
// will report success for as long as anyone keeps closing tickets.
//
// This repository has produced its own watermelons, which is why this dimension is
// worth the code. A proof printed "no network I/O in any source" over two files that
// open Redis. A NAC verdict said `on_trusted_segment` without ever comparing the
// segment. A review harness reported "0 survivors" while nineteen findings had been
// reproduced. In every case the green came from measuring the act rather than the
// result. The same discipline the code is held to should apply to the response.
//
// So the load-bearing signal here is not "how fast did we alert". It is:
//   **the concern was reported RESOLVED while the underlying state still shows it.**
// Everything else in this file is context for that comparison.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
//
// It does not DELIVER anything. Deciding who should be told, and by when, is a pure
// deterministic routing decision and belongs here. Actually sending the page, the
// ticket or the webhook is the outbound-emitter question that `itsm`, `siem`,
// `syslog`, `telemetry` and `webhooks` represent — still ungated, and explicitly an
// owner decision. Routing is a verdict; delivery is an action. This file emits
// verdicts.
//
// It also never touches the worker. See the ceiling note on ResponseAction.

/** Whether a named, accountable owner exists for this concern.
 *
 *  `unassigned` is the process equivalent of an ownerless group in
 *  `entitlement-binding`: the work can still be done, but nobody can be asked why it
 *  was not. A queue is not an owner. */
export type ResponseOwnerState = "assigned" | "unassigned" | "unknown";

/** Whether a human acknowledged the concern inside the operator's target window.
 *
 *  `unacknowledged` means nobody has picked it up at all — distinct from
 *  `acknowledged_late`, where somebody did, just outside the window. Collapsing
 *  those two would hide the difference between a slow team and an unstaffed one. */
export type ResponseAcknowledgement =
  | "acknowledged_within_target"
  | "acknowledged_late"
  /**
   * Acknowledged, and the operator supplied NO target to judge it against.
   *
   * Distinct from `acknowledged_within_target`, which is a CLAIM OF COMPLIANCE. Saying
   * "within target" when no target exists asserts something nobody established — the
   * same unearned affirmative as the verdict seed that reported `resolved_verified` for
   * a record nobody had checked. The honest answer is that the response happened and
   * its timeliness was not graded.
   *
   * Distinct from `unknown` too: we know exactly when it was acknowledged. What is
   * missing is the policy, not the fact. Collapsing the two would repeat the
   * malformed-vs-absent mistake this file's own `deriveAcknowledgement` comment warns
   * about.
   */
  | "acknowledged_ungraded"
  | "unacknowledged"
  | "unknown";

/** What the response system CLAIMS happened.
 *
 *  Deliberately called a claim. `resolved` here is an assertion by whoever closed the
 *  record, and this dimension exists because that assertion is sometimes false. */
export type ResponseResolutionClaim =
  /** Closed, and asserted fixed. */
  | "resolved"
  /** Closed without asserting a fix — a duplicate, a won't-fix, an expiry. Honest,
   *  and NOT a watermelon: nobody claimed the problem went away. */
  | "closed_unresolved"
  /** Still open. Not a failure by itself; open work is work. */
  | "open"
  | "unknown";

/**
 * What kind of evidence stands behind a closure.
 *
 * ORDERED BY STRENGTH, and kept apart because collapsing them is the whole failure:
 * only a fresh read of the raising signal can retire the concern the fabric itself
 * raised. Everything else is somebody's account of it.
 */
export type ResolutionEvidence =
  /** A fresh read of the same signal that raised the concern, showing its current
   *  state. The only evidence that can earn RESPONSE_VERIFIED_RESOLVED. */
  | "signal_recheck"
  /** A human — usually the reporting user — said it is fixed. Genuine evidence, and
   *  weaker: it attests the symptom, not the cause. */
  | "user_confirmation"
  /** Closed with neither. Common on paths that bypass confirmation entirely, such as
   *  the external-vendor branch of a typical support flow. */
  | "none"
  /** The report did not say. Distinct from `none`: not knowing how a closure was
   *  evidenced is not the same as knowing it was evidenced by nothing. */
  | "unknown";

/** Whether the report itself parsed. Tracked separately for the same reason as in the
 *  other dimensions: a malformed record normalizes to a pile of `unknown` and would
 *  otherwise read as a confident set of separate findings. */
export type ResponseReportIntegrity = "intact" | "malformed";

/** The vendor-neutral response record this dimension grades. */
export interface NormalizedResponseRecord {
  /** The concern this response is answering — echoed into the verdict so a reader can
   *  tie the accountability finding back to the decision that raised it. */
  readonly concernRef: string;
  /** Which team the routing policy says owns this class of concern. `null` when the
   *  policy expressed no owner — see OWNER_UNROUTED. */
  readonly owningTeam: string | null;
  readonly owner: ResponseOwnerState;
  readonly acknowledgement: ResponseAcknowledgement;
  readonly resolution: ResponseResolutionClaim;
  /**
   * THE WATERMELON INPUT: does the underlying state STILL show the concern?
   *
   * `true` + `resolution: "resolved"` is the whole point of this dimension.
   *
   * `null` means nobody re-checked. That is NOT the same as "the concern is gone",
   * and it must never be read as such — an unverified closure is exactly how a
   * watermelon survives. Supplied by the caller from a fresh read of the same signal
   * that raised the concern; this dimension performs no I/O and re-reads nothing.
   */
  readonly underlyingConcernStillPresent: boolean | null;
  /**
   * WHERE THE LINE ABOVE CAME FROM.
   *
   * `underlyingConcernStillPresent` documented itself as "supplied by the caller from a
   * fresh read of the same signal that raised the concern" — and documented it is all it
   * was. Nothing stopped a caller writing `false` because the reporting user said it
   * seemed fine now, and the fabric would then issue RESPONSE_VERIFIED_RESOLVED: its
   * strongest claim, on its weakest evidence.
   *
   * A service desk closing on user confirmation is a normal, reasonable process — it is
   * the gate on the L1 and L2 paths of every support flow chart ever drawn. It is also
   * the classic way a watermelon survives: a user confirms the SYMPTOM stopped, while
   * the cause that raised the concern is still there to raise it again.
   *
   * So the provenance is now a field rather than a comment. This dimension still
   * performs no I/O and re-reads nothing; it only refuses to treat one kind of evidence
   * as another.
   */
  readonly resolutionEvidence: ResolutionEvidence;
  /**
   * How long acknowledgement took, in whole seconds, or null when not reported.
   *
   * A DURATION SUPPLIED BY THE CALLER, never computed here — the same rule as
   * `lastCheckInAgeSeconds` in the uem dimension. A clock read inside a decision path
   * makes the decision unreplayable.
   */
  readonly acknowledgedAfterSeconds: number | null;
  /** The operator's acknowledgement target for this severity, in whole seconds.
   *  CALLER-SUPPLIED POLICY: a target hardcoded here would be a number nobody chose,
   *  applied to every tenant and every severity alike. `null` = no target expressed,
   *  in which case timeliness is not graded rather than graded against a guess. */
  readonly acknowledgementTargetSeconds: number | null;
  /**
   * Elapsed time since the concern was RAISED, in whole seconds, or null when not
   * reported. Caller-supplied, like every other duration here.
   *
   * ONE FIELD, TWO READINGS, decided by `resolution` — and that is the point rather
   * than an economy. Closed, it is time-to-close: the ITSM "SLA achievement" and
   * "mean time to restore" measures. Open, it is the concern's current age: the
   * "backlog aging" measure. Those are the same clock read at different moments, so
   * modelling them as two fields would invite a record that disagrees with itself.
   */
  readonly elapsedSinceRaisedSeconds: number | null;
  /** The operator's committed target for reaching a resolution, in whole seconds.
   *  CALLER-SUPPLIED POLICY, for exactly the reason the acknowledgement target is:
   *  a built-in would be a number nobody chose. `null` = no commitment expressed, and
   *  the elapsed time is then reported unGRADED rather than graded against a guess. */
  readonly resolutionTargetSeconds: number | null;
  readonly reportIntegrity: ResponseReportIntegrity;
}

/**
 * How an elapsed duration compares to the target it was committed against.
 *
 * FIVE STATES, NOT THREE, and the three absences are kept apart on the same principle
 * that separates `acknowledged_ungraded` from `unknown`: a missing policy, a missing
 * measurement and a broken number are different facts about the world, and collapsing
 * them lets the worst of them wear the face of the mildest.
 */
export type ResponseTimeliness =
  /** Measured, graded, and inside the commitment. */
  | "within_target"
  /** Measured, graded, and past it. */
  | "breached"
  /** Measured, but the operator committed to no target — nothing to grade against. */
  | "ungraded"
  /** No elapsed time reported. The clock is missing, not the policy. */
  | "unmeasured"
  /** A duration or target that is negative, fractional, or otherwise unreadable. */
  | "unknown";

export type ResponsePosture =
  /** Owned, acknowledged in time, and the concern is confirmed gone. */
  | "resolved_verified"
  /** Claimed resolved while the underlying concern is still present. The watermelon. */
  | "falsely_resolved"
  /** Claimed resolved, but nobody re-checked. Not proven false — unverified. */
  | "resolved_unverified"
  /** Still open and being worked, within the process the operator defined. */
  | "in_progress"
  /** The process itself failed: nobody owns it, or nobody picked it up. */
  | "unowned"
  /** Something needed to answer the question could not be read. */
  | "indeterminate";

/** Actions this dimension can recommend — a subset of the unified ladder
 *  (`none < monitor < step_up < alert < restrict < escalate`).
 *
 *  THE CEILING IS `alert`, and the reason matters. Every finding here is a failure of
 *  PROCESS — an unowned queue, a missed window, a ticket closed over a live problem.
 *  The correct response to a process failure is to tell an accountable human, which
 *  is what `alert` means. It is NOT to step up or restrict the worker on the device:
 *  they did not close the ticket, and interrupting their shift because someone else's
 *  queue is unstaffed punishes exactly the wrong person. This dimension raises its
 *  voice; it never raises the bar on a worker. */
export type ResponseAction = "none" | "monitor" | "step_up" | "alert";

export type ResponseReasonCode =
  /**
   * Owned, ACKNOWLEDGED within the operator's target, and the concern positively
   * confirmed gone.
   *
   * "Timely" here means the ACKNOWLEDGEMENT window specifically, and the wording is
   * narrowed deliberately now that a second timing axis exists: a record may reach this
   * verdict with its resolution time unGRADED, because the operator committed to no
   * resolution target. That is honest — the verdict claims what was checked, no more.
   * The looser earlier wording would have quietly extended the claim to cover a duration
   * nobody measured, which is the mistake this whole file has been correcting.
   */
  | "RESPONSE_VERIFIED_RESOLVED"
  // ── The watermelon and its neighbours ──
  /** Reported resolved; the underlying concern is STILL PRESENT. */
  | "WATERMELON_CLOSED_BUT_UNRESOLVED"
  /** Reported resolved; nobody re-checked. Unverified, not disproven. */
  | "RESOLUTION_UNVERIFIED"
  /**
   * Closed on a human's confirmation, with no fresh read of the raising signal.
   *
   * Graded at `monitor` — the same rung as RESOLUTION_UNVERIFIED, and deliberately no
   * worse. A user confirming is strictly MORE evidence than nobody looking, and a
   * service desk that closes on confirmation is running a normal process, not a
   * negligent one. What it must not do is earn the word "verified": the user attests
   * the symptom stopped, and the concern was raised by a signal that nobody re-read.
   */
  | "RESOLVED_ON_USER_CONFIRMATION_ONLY"
  /**
   * The record claims a signal re-check but carries no result from it, or claims no
   * re-check while reporting one. A report that contradicts itself is graded on the
   * contradiction rather than on whichever half reads better.
   */
  | "RESOLUTION_EVIDENCE_INCOHERENT"
  /**
   * Closed WITHOUT a fix claim (`closed_unresolved`) while the concern is confirmed
   * present, or was never re-checked.
   *
   * NOT a watermelon, and graded `monitor` rather than `alert` for that reason:
   * nobody lied. A duplicate, a won't-fix or an expiry over a live concern is a
   * legitimate accepted-risk decision — it is just not a resolution, and the fabric
   * must not report it as one.
   */
  | "CLOSED_CONCERN_NOT_RESOLVED"
  // ── Process failures ──
  /** No accountable owner. A queue is not an owner. */
  | "RESPONSE_UNOWNED"
  /** The routing policy named no team for this class of concern. */
  | "OWNER_UNROUTED"
  /** Nobody has picked it up at all. */
  | "RESPONSE_UNACKNOWLEDGED"
  /** Picked up, but outside the operator's target window. */
  | "ACKNOWLEDGED_LATE"
  /** Picked up, and the operator supplied no window to judge it against. A policy gap,
   *  not a response failure — but it forecloses the clean verdict's claim of timeliness. */
  | "ACKNOWLEDGEMENT_TARGET_UNSTATED"
  // ── Resolution timing (ITSM "SLA achievement", "time to restore", "backlog aging") ──
  /** CLOSED past the operator's committed resolution target. A slow fix, not a false
   *  one — so `monitor`, and emphatically not the watermelon's `alert`. */
  | "RESOLUTION_TARGET_MISSED"
  /** STILL OPEN past the operator's committed target: the concern is aging in a queue.
   *  The same field and the same target as above, read while the work is unfinished. */
  | "BACKLOG_AGED_BEYOND_LIMIT"
  /** A duration or target that could not be read — negative, fractional, junk. Reported
   *  rather than silently skipped, because an unreadable clock is not a met target. */
  | "RESOLUTION_TIMING_UNREADABLE"
  /** Open and inside the process. Reported, not faulted. */
  | "RESPONSE_IN_PROGRESS"
  // ── Unconfirmed inputs ──
  | "OWNER_STATE_UNKNOWN"
  | "ACKNOWLEDGEMENT_STATE_UNKNOWN"
  | "RESOLUTION_STATE_UNKNOWN"
  | "RESPONSE_REPORT_MALFORMED";

export interface ResponseVerdict {
  readonly posture: ResponsePosture;
  readonly recommendedAction: ResponseAction;
  readonly reasonCode: ResponseReasonCode;
  /** Who should hear about this, when the record names an owner. Carried so a routing
   *  decision is legible without a second lookup — and null when there is nobody,
   *  which is itself the finding. */
  readonly notifyTeam: string | null;
  readonly reportIntegrity: ResponseReportIntegrity;
  readonly concernRef: string;
}
