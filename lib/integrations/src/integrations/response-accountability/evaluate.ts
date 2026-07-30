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
    case "RESPONSE_IN_PROGRESS":
      return "in_progress";
    case "RESPONSE_UNOWNED":
    case "OWNER_UNROUTED":
    case "RESPONSE_UNACKNOWLEDGED":
    case "ACKNOWLEDGED_LATE":
      return "unowned";
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
  // against. Inventing one would apply a number nobody chose to every severity.
  if (targetSeconds === null) return "acknowledged_within_target";
  if (!Number.isInteger(targetSeconds) || targetSeconds < 0) return "unknown";
  return acknowledgedAfterSeconds <= targetSeconds ? "acknowledged_within_target" : "acknowledged_late";
}
