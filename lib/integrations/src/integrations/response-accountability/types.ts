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
  readonly reportIntegrity: ResponseReportIntegrity;
}

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
  /** Owned, timely, and verified gone. */
  | "RESPONSE_VERIFIED_RESOLVED"
  // ── The watermelon and its neighbours ──
  /** Reported resolved; the underlying concern is STILL PRESENT. */
  | "WATERMELON_CLOSED_BUT_UNRESOLVED"
  /** Reported resolved; nobody re-checked. Unverified, not disproven. */
  | "RESOLUTION_UNVERIFIED"
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
