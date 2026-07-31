import {
  type NormalizedShiftContext,
  type ShiftContextAction,
  type ShiftContextPosture,
  type ShiftContextReasonCode,
  type ShiftContextVerdict,
} from "./types";

/**
 * Pure, deterministic SHIFT-CONTEXT evaluator. Grades ONE worker's labor context —
 * scheduled now, on the clock, at the right site — fail-closed, on the fabric's
 * unified ladder.
 *
 * Doctrine ("right person, wrong time is still the wrong decision context"):
 *  - **off-clock on shift** → `step_up`. Scheduled to work NOW and clocked out —
 *    either off-the-clock work (a labor exposure the employer is liable for) or
 *    the badge is not being held by the person the schedule names. A step-up
 *    resolves both without stranding a genuine worker.
 *  - **off-duty operation** → `step_up`. Neither scheduled nor punched in, yet
 *    operating a device. The strongest wrong-time signal the labor plane can give;
 *    still a step_up, not a restrict — an emergency call-in is legitimate and a
 *    challenge resolves it, where a block would strand them mid-crisis.
 *  - **schedule deviation** → `monitor`. Clocked in (or on break) outside any
 *    reported window. Real overtime and early starts happen; the deviation is
 *    made visible, not blocked.
 *  - **on break** → `monitor`. Punched but paused — carried and visible so a
 *    controlled workflow performed on break is attributable.
 *  - **site mismatch** → `step_up`. The shift places the worker at a different
 *    site than the device. Floating staff are real; so are borrowed badges.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *  - **not covered** → `step_up`. A worker the WFM has no record of (agency,
 *    contractor, missing sync) is an honest hole, not a pass.
 *
 * The grant (`none`) requires FIVE affirmative clauses: clean parse + covered +
 * on_shift + clocked_in + a site answer of `matched` or `unassessed` (the caller
 * did not pose the site question — a visible fact, not a defaulted match). Not one
 * clause has the form `!== bad`, so a value this design has never heard of
 * satisfies none of them.
 *
 * This dimension never says WHO is holding the badge (custody), whether the
 * account is alive (access-governance), or whether the device is healthy (posture)
 * — it says whether the LABOR PLANE agrees this is the right time and place.
 */

const ACTION_SEVERITY: Record<ShiftContextAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateShiftContextOptions {
  /** False when the WFM returned no record for this worker. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: ShiftContextPosture;
  action: ShiftContextAction;
  reason: ShiftContextReasonCode;
}

export function evaluateShiftContext(
  report: NormalizedShiftContext,
  opts: EvaluateShiftContextOptions = {},
): ShiftContextVerdict {
  const covered = opts.covered ?? true;
  const base = { workerRef: report.workerRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "labor_unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["wfm_record"],
      laborContextConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];

  // Track the unknown axes for evidence (they also foreclose the grant below).
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.scheduleStanding === "unknown") unknownSignals.push("schedule_standing");
  if (report.punchStatus === "unknown") unknownSignals.push("punch_status");
  if (report.siteMatch === "unknown") unknownSignals.push("site_match");

  // Defence in depth: a report we could not fully parse is never a grant.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "labor_unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── schedule x punch: the coherence of the labor plane ──────────────────────────
  const standing = report.scheduleStanding;
  const punch = report.punchStatus;
  if (standing === "on_shift" && punch === "clocked_out") {
    criticalFindings.push("working_off_the_clock");
    candidates.push({ posture: "off_clock_on_shift", action: "step_up", reason: "OFF_CLOCK_ON_SHIFT" });
  } else if (standing === "off_shift" && (punch === "clocked_in" || punch === "on_break")) {
    criticalFindings.push("unscheduled_clock_in");
    candidates.push({ posture: "schedule_deviation", action: "monitor", reason: "UNSCHEDULED_CLOCK_IN" });
  } else if (standing === "off_shift" && punch === "clocked_out") {
    criticalFindings.push("operating_while_off_duty");
    candidates.push({ posture: "off_duty", action: "step_up", reason: "OFF_DUTY_OPERATION" });
  } else if (standing === "on_shift" && punch === "on_break") {
    candidates.push({ posture: "on_break", action: "monitor", reason: "ON_BREAK" });
  } else if (standing === "unknown") {
    candidates.push({ posture: "labor_unverified", action: "step_up", reason: "SCHEDULE_UNKNOWN" });
  }
  // A punch we could not read raises even when the schedule answered.
  if (punch === "unknown") {
    candidates.push({ posture: "labor_unverified", action: "step_up", reason: "PUNCH_UNKNOWN" });
  }

  // ── is this the site the shift places them at? ──────────────────────────────────
  if (report.siteMatch === "mismatched") {
    criticalFindings.push("site_mismatch");
    candidates.push({ posture: "site_mismatch", action: "step_up", reason: "SITE_MISMATCH" });
  } else if (report.siteMatch === "unknown") {
    candidates.push({ posture: "labor_unverified", action: "step_up", reason: "SITE_UNKNOWN" });
  }

  // Defence in depth: the grant is affirmative on all three axes plus the parse.
  // The branches above already push a raising candidate for every non-confirmed
  // state, so today this never fires — but if any branch were later weakened so a
  // non-confirmed state produced an empty candidate list, this backstop forces a
  // step_up rather than letting the seed grant survive.
  const positivelyOnDuty =
    report.reportIntegrity === "clean" &&
    report.scheduleStanding === "on_shift" &&
    report.punchStatus === "clocked_in" &&
    (report.siteMatch === "matched" || report.siteMatch === "unassessed");
  if (!positivelyOnDuty && candidates.length === 0) {
    candidates.push({ posture: "labor_unverified", action: "step_up", reason: "SCHEDULE_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired.
  const seed: Candidate = {
    posture: "on_shift_clocked_in",
    action: "none",
    reason: "ON_SHIFT_AND_ON_CLOCK",
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
    laborContextConfirmed: winner.action === "none",
  };
}
