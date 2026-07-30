// Pure, deterministic evaluator for response accountability.
//
// No clock, no randomness, no I/O. Durations and targets arrive from the caller, so
// the same record always produces the same verdict and a decision can be replayed.
//
// ORDER MATTERS HERE MORE THAN IN THE OTHER EVALUATORS, and it is deliberate rather
// than incidental: the watermelon must be able to win. A record that is claimed
// resolved while the concern is still present is the finding — and such a record is
// usually also owned, promptly acknowledged and closed, i.e. green on every other
// axis. Worst-concern-wins on rank alone would let the calm signals sit alongside it;
// they do, and it still wins, because nothing else in this file reaches `alert`.

import type {
  NormalizedResponseRecord,
  ResponseAction,
  ResponsePosture,
  ResponseReasonCode,
  ResponseTimeliness,
  ResponseVerdict,
} from "./types";

const ACTION_RANK: Record<ResponseAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
};

interface Candidate {
  readonly action: ResponseAction;
  readonly reason: ResponseReasonCode;
}

export function evaluateResponse(record: NormalizedResponseRecord): ResponseVerdict {
  const notifyTeam = record.owningTeam;

  if (record.reportIntegrity === "malformed") {
    return v("indeterminate", "step_up", "RESPONSE_REPORT_MALFORMED", notifyTeam, "malformed", record.concernRef);
  }

  const candidates: Candidate[] = [];

  // ── THE WATERMELON ──────────────────────────────────────────────────────────
  //
  // Claimed resolved, concern still present. Green dashboard, red reality.
  //
  // `alert` rather than step_up: the failure is that a human closed something that
  // was not fixed, so the fix is to put it back in front of a human. Note what this
  // does NOT do — it does not restrict the worker on the device. They did not close
  // the ticket.
  if (record.resolution === "resolved" && record.underlyingConcernStillPresent === true) {
    candidates.push({ action: "alert", reason: "WATERMELON_CLOSED_BUT_UNRESOLVED" });
  }

  // Claimed resolved and NOBODY RE-CHECKED. Not the watermelon — we have not caught
  // anyone out — but it is the state in which a watermelon survives undetected, and a
  // closure nobody verified is not evidence that anything was fixed. `monitor`: this
  // is the common case in a healthy process and screaming about it would make the
  // dimension noise. It is surfaced so the ratio is visible, not so it interrupts.
  if (record.resolution === "resolved" && record.underlyingConcernStillPresent === null) {
    candidates.push({ action: "monitor", reason: "RESOLUTION_UNVERIFIED" });
  }

  // ── Process failures ────────────────────────────────────────────────────────
  if (record.owner === "unassigned") {
    // Nobody accountable. Same shape as an ownerless group in entitlement-binding:
    // the work may still happen, but nobody can be asked why it did not.
    candidates.push({ action: "step_up", reason: "RESPONSE_UNOWNED" });
  }
  if (record.owner === "assigned" && record.owningTeam === null) {
    // Someone is assigned but the routing policy names no team — so the fabric cannot
    // say who to tell. Reported separately from `unassigned` because the remedy is
    // different: this is a gap in the routing table, not an unstaffed queue.
    candidates.push({ action: "step_up", reason: "OWNER_UNROUTED" });
  }
  if (record.acknowledgement === "unacknowledged") {
    candidates.push({ action: "step_up", reason: "RESPONSE_UNACKNOWLEDGED" });
  }
  if (record.acknowledgement === "acknowledged_late") {
    // Somebody took it, just not in time. A slower team is a different problem from
    // an absent one, and grading them the same would hide which you have.
    candidates.push({ action: "monitor", reason: "ACKNOWLEDGED_LATE" });
  }
  if (record.acknowledgement === "acknowledged_ungraded") {
    // Acknowledged, no target supplied. Reported rather than waved through BECAUSE THE
    // CLEAN VERDICT CLAIMS TIMELINESS — RESPONSE_VERIFIED_RESOLVED is documented as
    // "Owned, TIMELY, and verified gone". Letting an ungraded acknowledgement reach it
    // would put that word on a record whose timeliness nobody measured.
    //
    // `monitor`, matching ACKNOWLEDGED_LATE and RESOLUTION_UNVERIFIED: the remedy is a
    // policy the operator has not written, not a response failure, so it belongs in the
    // ratio a reader can see rather than in anyone's inbox.
    candidates.push({ action: "monitor", reason: "ACKNOWLEDGEMENT_TARGET_UNSTATED" });
  }

  // ── Resolution timing ───────────────────────────────────────────────────────
  //
  // The ITSM measures this dimension can honestly carry: "SLA achievement" and "time to
  // restore" when the record is closed, "backlog aging" when it is open. Same elapsed
  // field, same caller-supplied target, read at different moments in the record's life.
  //
  // NO RATE, NO MEAN, NO WINDOW. Those are aggregate statistics over a corpus of
  // tickets this fabric does not hold, and computing them would need a clock it must
  // not read. This grades ONE record against ONE commitment the operator made.
  const timeliness = deriveResolutionTimeliness(
    record.elapsedSinceRaisedSeconds,
    record.resolutionTargetSeconds,
  );
  if (timeliness === "breached") {
    // Which finding it is depends on whether the work is finished. Closed-and-late is a
    // slow team; open-and-late is a queue nobody is draining. Same number, different
    // remedy, so they are never collapsed into one code.
    candidates.push(
      record.resolution === "open"
        ? { action: "monitor", reason: "BACKLOG_AGED_BEYOND_LIMIT" }
        : { action: "monitor", reason: "RESOLUTION_TARGET_MISSED" },
    );
  }
  if (timeliness === "unknown") {
    // An unreadable clock is not a met target. Same lesson as the negative
    // acknowledgement duration: a broken value must never grade cleaner than an honest
    // one that happens to be bad.
    candidates.push({ action: "monitor", reason: "RESOLUTION_TIMING_UNREADABLE" });
  }
  // `ungraded` and `unmeasured` push NOTHING, and that asymmetry with
  // ACKNOWLEDGEMENT_TARGET_UNSTATED above is deliberate rather than an oversight. The
  // clean verdict makes an explicit claim about the ACKNOWLEDGEMENT window and none at
  // all about resolution speed, so an ungraded resolution leaves no claim overstated.
  // Reporting it anyway would put every record without a resolution SLA into `monitor`
  // forever — the "a control that fires constantly is a control nobody reads" failure
  // this repository has already had to fix once, in the BYOD-unsupervised axis.

  // ── Unconfirmed inputs ──────────────────────────────────────────────────────
  if (record.owner === "unknown") {
    candidates.push({ action: "step_up", reason: "OWNER_STATE_UNKNOWN" });
  }
  if (record.acknowledgement === "unknown") {
    candidates.push({ action: "step_up", reason: "ACKNOWLEDGEMENT_STATE_UNKNOWN" });
  }
  if (record.resolution === "unknown") {
    candidates.push({ action: "step_up", reason: "RESOLUTION_STATE_UNKNOWN" });
  }

  // Open and being worked. Reported at `none` — open work inside the operator's own
  // process is not a finding, and treating it as one would make every live incident a
  // concern the moment it was raised.
  if (candidates.length === 0 && record.resolution === "open") {
    return v("in_progress", "none", "RESPONSE_IN_PROGRESS", notifyTeam, "intact", record.concernRef);
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_RANK[c.action] > ACTION_RANK[max.action] ? c : max),
    { action: "none", reason: "RESPONSE_VERIFIED_RESOLVED" },
  );

  // ── THE AFFIRMATIVE VERDICT MUST BE EARNED, NOT SEEDED ──────────────────────
  //
  // FOUND BY ADVERSARIAL REVIEW, IN THIS FILE, AFTER IT SHIPPED. The fold above is
  // seeded with RESPONSE_VERIFIED_RESOLVED — documented as "Owned, timely, and verified
  // gone". So "no candidate fired" silently became "the concern is confirmed gone".
  //
  // That is not hypothetical. `closed_unresolved` was added to ResponseResolutionClaim
  // and NO candidate covered it, so the seed spoke on its behalf: a record closed
  // without any fix claim, with `underlyingConcernStillPresent: true` — the concern
  // CONFIRMED still there — returned posture `resolved_verified`, action `none`,
  // reason RESPONSE_VERIFIED_RESOLVED. A watermelon inside the watermelon detector,
  // and it sat in the sweep's "clean" bucket the whole time because the sweep counted
  // clean verdicts without ever asking whether a clean verdict was WARRANTED.
  //
  // It is the same defect this repository has now found three times: an unearned
  // affirmative. Jamf's hardcoded `compliant: true`; ISE's hardcoded
  // `status: "registered"`; and this. I fixed the first two and shipped the third.
  //
  // GUARDED STRUCTURALLY RATHER THAN BY ADDING A CASE. A new `if` for
  // `closed_unresolved` would fix today's symptom and leave the seed free to speak for
  // the NEXT union member somebody adds — which is exactly how this arrived. This
  // makes the affirmative claim unrepresentable without positive confirmation: the
  // only way to be reported "verified gone" is for the caller to have looked and found
  // it gone. Absence of a concern is not evidence of a fix.
  if (winner.reason === "RESPONSE_VERIFIED_RESOLVED" && record.underlyingConcernStillPresent !== false) {
    return v("resolved_unverified", "monitor", "CLOSED_CONCERN_NOT_RESOLVED", notifyTeam, "intact", record.concernRef);
  }

  return v(postureFor(winner.reason), winner.action, winner.reason, notifyTeam, "intact", record.concernRef);
}

function v(
  posture: ResponsePosture,
  recommendedAction: ResponseAction,
  reasonCode: ResponseReasonCode,
  notifyTeam: string | null,
  reportIntegrity: "intact" | "malformed",
  concernRef: string,
): ResponseVerdict {
  return { posture, recommendedAction, reasonCode, notifyTeam, reportIntegrity, concernRef };
}

function postureFor(reason: ResponseReasonCode): ResponsePosture {
  switch (reason) {
    case "RESPONSE_VERIFIED_RESOLVED":
      return "resolved_verified";
    case "WATERMELON_CLOSED_BUT_UNRESOLVED":
      return "falsely_resolved";
    case "RESOLUTION_UNVERIFIED":
      return "resolved_unverified";
    // Shares `resolved_unverified` with RESOLUTION_UNVERIFIED because the posture answers
    // the same question — the closure is not backed by a check — while the REASON keeps
    // the two apart: one claimed a fix and nobody looked, the other claimed no fix at all.
    // A separate posture would assert a distinction the consumer cannot act on differently.
    case "CLOSED_CONCERN_NOT_RESOLVED":
      return "resolved_unverified";
    case "RESPONSE_IN_PROGRESS":
      return "in_progress";
    case "RESPONSE_UNOWNED":
    case "OWNER_UNROUTED":
    case "RESPONSE_UNACKNOWLEDGED":
    case "ACKNOWLEDGED_LATE":
    // Late, or aging in a queue: the process did not keep its own commitment. Same
    // family as a missed acknowledgement window — the work may still be perfectly
    // correct, and nobody has claimed otherwise; it simply took longer than promised.
    case "RESOLUTION_TARGET_MISSED":
    case "BACKLOG_AGED_BEYOND_LIMIT":
      return "unowned";
    // The response happened; what could not be established is whether it was timely,
    // because the policy that would decide it was never supplied. That is an epistemic
    // gap, not a process failure — `unowned` would libel a team that answered promptly.
    case "ACKNOWLEDGEMENT_TARGET_UNSTATED":
    // An unreadable duration: the timing could not be established either way. Not a
    // process failure — we do not know that anyone was late, only that we cannot say
    // they were not.
    case "RESOLUTION_TIMING_UNREADABLE":
      return "indeterminate";
    // Driven by something we could not read. Deliberately not one of the affirmative
    // postures: we do not know the response failed, only that we cannot establish it
    // succeeded. There is no `default` here on purpose — adding a reason code without
    // a posture must fail the build, which is how the last dimension caught itself.
    case "OWNER_STATE_UNKNOWN":
    case "ACKNOWLEDGEMENT_STATE_UNKNOWN":
    case "RESOLUTION_STATE_UNKNOWN":
    case "RESPONSE_REPORT_MALFORMED":
      return "indeterminate";
  }
}

/**
 * Derive the acknowledgement state from caller-supplied durations.
 *
 * Separate from the evaluator so the comparison is testable on its own, and so the
 * evaluator never has to know what a second is.
 *
 * A NEGATIVE OR FRACTIONAL duration is not a fast acknowledgement — it is a broken
 * report, and it must not compare as prompt. Same lesson as the malformed nesting
 * depth in `entitlement-binding`, where collapsing broken into absent let a junk
 * value grade cleaner than an honest one.
 */
export function deriveAcknowledgement(
  acknowledgedAfterSeconds: number | null,
  targetSeconds: number | null,
): NormalizedResponseRecord["acknowledgement"] {
  if (acknowledgedAfterSeconds === null) return "unacknowledged";
  if (!Number.isInteger(acknowledgedAfterSeconds) || acknowledgedAfterSeconds < 0) return "unknown";
  // No target expressed: it was acknowledged, and there is no window to judge it
  // against. Inventing one would apply a number nobody chose to every severity — that
  // part was right and is unchanged.
  //
  // WHAT WAS WRONG was the ANSWER, not the refusal. This returned
  // `acknowledged_within_target` — a claim of COMPLIANCE WITH A TARGET THAT DOES NOT
  // EXIST. An acknowledgement 27 hours late graded identically to one inside a
  // five-minute window, because the absence of a policy was reported as a pass.
  //
  // Same unearned affirmative as the verdict seed in this file, found in the same
  // review: declining to invent a threshold is correct, but the state you fall back to
  // must not assert the thing you declined to measure.
  if (targetSeconds === null) return "acknowledged_ungraded";
  if (!Number.isInteger(targetSeconds) || targetSeconds < 0) return "unknown";
  return acknowledgedAfterSeconds <= targetSeconds ? "acknowledged_within_target" : "acknowledged_late";
}

/**
 * Grade elapsed-since-raised against the operator's committed resolution target.
 *
 * Serves three ITSM measures with one comparison — SLA achievement and time-to-restore
 * when the record is closed, backlog aging when it is open — because they are the same
 * clock read at different moments. Which finding a breach produces is the evaluator's
 * business; this function only says whether the commitment was kept.
 *
 * SAME DISCIPLINE AS `deriveAcknowledgement`, INCLUDING THE BUG IT HAD. A missing
 * target returns `ungraded`, never a value that reads as a pass — that defect
 * (`acknowledged_within_target` for a target that did not exist) was fixed here one
 * commit ago, and the whole reason this axis waited for that fix was to avoid inheriting
 * it. A missing measurement is `unmeasured`, distinct again: the clock is absent, not
 * the policy.
 *
 * The boundary is INCLUSIVE — elapsed exactly equal to the target is kept, not missed.
 * Matching the acknowledgement comparison, because two timing axes on one record that
 * disagreed about `<=` versus `<` would be a coin-flip nobody could predict.
 */
export function deriveResolutionTimeliness(
  elapsedSinceRaisedSeconds: number | null,
  resolutionTargetSeconds: number | null,
): ResponseTimeliness {
  if (elapsedSinceRaisedSeconds === null) return "unmeasured";
  if (!Number.isInteger(elapsedSinceRaisedSeconds) || elapsedSinceRaisedSeconds < 0) return "unknown";
  if (resolutionTargetSeconds === null) return "ungraded";
  if (!Number.isInteger(resolutionTargetSeconds) || resolutionTargetSeconds < 0) return "unknown";
  return elapsedSinceRaisedSeconds <= resolutionTargetSeconds ? "within_target" : "breached";
}
