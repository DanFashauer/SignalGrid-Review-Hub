import {
  type ChangeWindowAction,
  type ChangeWindowPosture,
  type ChangeWindowReasonCode,
  type ChangeWindowVerdict,
  type NormalizedChangeWindow,
} from "./types";

/**
 * Pure, deterministic CHANGE-WINDOW evaluator. Grades ONE change record — approved,
 * in its window, by its named implementer, on a current read — fail-closed, on the
 * fabric's unified ladder.
 *
 * Doctrine ("an approval is a claim about a specific time, actor and record"):
 *  - **change refused** → `restrict`. Rejected or cancelled: the organization
 *    affirmatively said no, and the operation is proceeding anyway. The only rung
 *    above step-up here, and it earns it — this is the same class as
 *    access-governance's decertified entitlement, a state where the system of record
 *    holds an explicit denial rather than an absence.
 *  - **outside the window** → `step_up`. Approved, but not now. Windows slip and
 *    emergency work overruns; a challenge resolves an honest overrun without
 *    stranding the operator mid-change, which a block would do at the worst
 *    possible moment.
 *  - **not approved** → `step_up`. The record exists and nobody has approved it
 *    yet. Common and often legitimate (emergency changes are raised and worked
 *    before the CAB catches up) — visible and answerable, not blocked.
 *  - **record closed** → `step_up`. The change is finished; work continuing under
 *    it is unattributable rather than unauthorized.
 *  - **actor not authorized** → `step_up`. The record names a different
 *    implementer. Hand-offs are real; so are borrowed credentials.
 *  - **stale record** → `step_up`. A read older than the caller's own maximum age
 *    is not evidence about now.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *  - **not covered** → `step_up`. An operation with no change record at all is an
 *    honest hole, not a pass.
 *
 * THE ONE THING THIS EVALUATOR NEVER DOES is emit an action below `none`. There is
 * no rung for "in the window, so relax" — a change window cannot buy down another
 * dimension's concern, because posture composition is worst-concern-wins and this
 * family contributes only `none` or a raise. A change record that is stale, forged
 * or simply wrong therefore manufactures no grant. `changeClass` is carried into
 * the verdict's evidence for the human reading the step-up and is deliberately not
 * read here: letting an `emergency` string suppress the window check would let
 * anyone who can write that field write themselves a pass.
 *
 * The grant (`none`) requires FIVE affirmative clauses: clean parse + covered +
 * `approved` + `inside` + an actor answer of `authorized`/`unassessed` + a recency
 * answer of `fresh`/`unassessed`. Not one clause has the form `!== bad`, so a value
 * this design has never heard of satisfies none of them.
 */

const ACTION_SEVERITY: Record<ChangeWindowAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateChangeWindowOptions {
  /** False when the ITSM returned no record for this change reference. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: ChangeWindowPosture;
  action: ChangeWindowAction;
  reason: ChangeWindowReasonCode;
}

export function evaluateChangeWindow(
  report: NormalizedChangeWindow,
  opts: EvaluateChangeWindowOptions = {},
): ChangeWindowVerdict {
  const covered = opts.covered ?? true;
  const base = { changeRef: report.changeRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "change_unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["change_record"],
      changeAuthorized: false,
    };
  }

  const candidates: Candidate[] = [];

  // Track the unknown axes for evidence (they also foreclose the grant below).
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.windowStanding === "unknown") unknownSignals.push("window_standing");
  if (report.approvalState === "unknown") unknownSignals.push("approval_state");
  if (report.actorAuthorization === "unknown") unknownSignals.push("actor_authorization");
  if (report.recordFreshness === "unknown") unknownSignals.push("record_freshness");

  // Defence in depth: a report we could not fully parse is never a grant.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "change_unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── the ITSM's own state: was this change approved at all? ──────────────────────
  if (report.approvalState === "rejected") {
    criticalFindings.push("change_rejected");
    candidates.push({ posture: "change_refused", action: "restrict", reason: "CHANGE_REFUSED" });
  } else if (report.approvalState === "cancelled") {
    criticalFindings.push("change_cancelled");
    candidates.push({ posture: "change_refused", action: "restrict", reason: "CHANGE_REFUSED" });
  } else if (report.approvalState === "pending_approval") {
    criticalFindings.push("change_awaiting_approval");
    candidates.push({ posture: "change_unapproved", action: "step_up", reason: "CHANGE_NOT_APPROVED" });
  } else if (report.approvalState === "closed") {
    criticalFindings.push("change_record_closed");
    candidates.push({ posture: "change_record_closed", action: "step_up", reason: "CHANGE_RECORD_CLOSED" });
  } else if (report.approvalState === "unknown") {
    candidates.push({ posture: "change_unverified", action: "step_up", reason: "APPROVAL_UNKNOWN" });
  }

  // ── the temporal axis: is the approval about NOW? ───────────────────────────────
  if (report.windowStanding === "outside") {
    criticalFindings.push("operating_outside_change_window");
    candidates.push({ posture: "outside_change_window", action: "step_up", reason: "OUTSIDE_CHANGE_WINDOW" });
  } else if (report.windowStanding === "unknown") {
    candidates.push({ posture: "change_unverified", action: "step_up", reason: "WINDOW_UNKNOWN" });
  }

  // ── is this the implementer the record authorizes? ──────────────────────────────
  if (report.actorAuthorization === "unauthorized") {
    criticalFindings.push("actor_not_named_on_change");
    candidates.push({ posture: "actor_unauthorized", action: "step_up", reason: "ACTOR_NOT_AUTHORIZED" });
  } else if (report.actorAuthorization === "unknown") {
    candidates.push({ posture: "change_unverified", action: "step_up", reason: "ACTOR_UNKNOWN" });
  }

  // ── is the record current enough to be evidence about now? ──────────────────────
  if (report.recordFreshness === "stale") {
    criticalFindings.push("change_record_stale");
    candidates.push({ posture: "change_record_stale", action: "step_up", reason: "CHANGE_RECORD_STALE" });
  } else if (report.recordFreshness === "unknown") {
    candidates.push({ posture: "change_unverified", action: "step_up", reason: "CHANGE_RECORD_TIME_UNKNOWN" });
  }

  // Defence in depth: the grant is affirmative on all four axes plus the parse.
  //
  // INERT TODAY, deliberately kept, and registered as such in
  // `scripts/mutation-guard.mjs`. Every non-confirmed state already pushes a raising
  // candidate above, so the candidate list is never empty when this is false —
  // verified by diffing all 1,656 shapes the proof enumerates (576 normalized states
  // x covered/uncovered, plus 504 raw wire records) with the whole block removed:
  // ZERO outputs changed. It is kept as the last thing standing between a weakened
  // branch and a surviving seed grant, and it pushes its OWN reason code so a firing
  // would be visible in the record rather than disguised as a normal branch.
  const positivelyAuthorizedChange =
    report.reportIntegrity === "clean" &&
    report.approvalState === "approved" &&
    report.windowStanding === "inside" &&
    (report.actorAuthorization === "authorized" || report.actorAuthorization === "unassessed") &&
    (report.recordFreshness === "fresh" || report.recordFreshness === "unassessed");
  if (!positivelyAuthorizedChange && candidates.length === 0) {
    candidates.push({ posture: "change_unverified", action: "step_up", reason: "GRANT_BACKSTOP" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired.
  const seed: Candidate = {
    posture: "change_authorized",
    action: "none",
    reason: "CHANGE_AUTHORIZED",
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
    criticalFindings,
    unknownSignals,
    changeAuthorized: winner.action === "none",
  };
}
