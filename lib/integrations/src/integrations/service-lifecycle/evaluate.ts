// Pure, deterministic evaluator for the service-lifecycle dimension.
//
// No clock, no randomness, no I/O. The two instants this dimension cares about
// are compared to EACH OTHER upstream (see `assignmentOrder` in types.ts), so
// even the usual caller-posed reference instant is unnecessary here — the
// question "was this assigned after they left?" is answered entirely by the two
// source-reported facts.
//
// THE RULE THIS ENCODES, same as its siblings: the clean verdict requires
// POSITIVE CONFIRMATION. The seed is the clean verdict, so adding a member to
// any union without handling it here surfaces in the exhaustive proof sweep as
// an unjustified clean verdict rather than passing silently.
//
// ORDER-PROOF BY CONSTRUCTION, and more strongly than the sibling evaluators.
// They pick the winner with a `reduce` and strict `>`, which resolves ties by
// SOURCE ORDER — correct today, and silently dependent on where a future
// candidate gets pushed. This one ranks by (action, then a fixed reason
// precedence), so the winner cannot depend on push order at all. The proof
// asserts it by permuting the candidate list.

import type {
  NormalizedServiceLifecycle,
  ServiceLifecycleAction,
  ServiceLifecyclePosture,
  ServiceLifecycleReasonCode,
  ServiceLifecycleVerdict,
} from "./types";

const ACTION_RANK: Record<ServiceLifecycleAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  restrict: 3,
};

/** Tie-break precedence WITHIN one action level — lower wins.
 *
 *  SPECIFICITY, NOT SEVERITY, and the distinction is load-bearing rather than
 *  stylistic. Severity is what `ACTION_RANK` is for. This table answers a
 *  different question: given two findings the ladder rates equally, which one
 *  tells an operator more? `ASSIGNMENT_ORDER_MALFORMED` names the exact field
 *  that failed to parse, so it outranks the vaguer `LIFECYCLE_CLOSURE_STATE_
 *  UNKNOWN` here — even though it sits a rung LOWER on the action ladder, and
 *  therefore must still lose to it in the final verdict.
 *
 *  THAT INVERSION IS DELIBERATE and it is what makes `strongest()` falsifiable.
 *  The first version numbered this table monotonically with the action ladder,
 *  which made the action-equality guard in `strongest()` unable to matter: no
 *  monitor-level code could ever undercut a step_up-level one, so removing the
 *  guard changed nothing and the mutation sweep said so. A guard that cannot
 *  fail is not a guard. Numbering by specificity gives the two orderings real
 *  disagreements, and the proof pins the one state where they collide. */
const REASON_PRECEDENCE: Record<ServiceLifecycleReasonCode, number> = {
  SERVICE_REASSIGNED_AFTER_CLOSURE: 0,
  SERVICE_ENTITLEMENT_OUTLIVED_CLOSURE: 1,
  SERVICE_STRIPPED_WITHOUT_RECORDED_CLOSURE: 2,
  // Names the exact unreadable field — more specific than either blind-spot code
  // below it, and a rung lower on the ladder. The collision is the point.
  ASSIGNMENT_ORDER_MALFORMED: 3,
  REASSIGNMENT_CHECK_BLINDED: 4,
  SERVICE_REASSIGNED_CLOSURE_SUPERSESSION_UNKNOWN: 5,
  SERVICE_STRIPPED_CLOSURE_UNKNOWN: 6,
  SERVICE_ASSIGNMENT_STATE_UNKNOWN: 7,
  LIFECYCLE_CLOSURE_STATE_UNKNOWN: 8,
  // Short-circuit outcomes; never compete in the candidate list, but listed so
  // the record stays exhaustive and a new code cannot be added without a
  // deliberate placement.
  SERVICE_REPORT_MALFORMED: 90,
  SERVICE_REPORT_INCOHERENT: 91,
  SERVICE_PLANE_NOT_REPORTED: 92,
  SERVICE_PLANE_REPORTING_UNKNOWN: 93,
  ACCOUNT_PLANE_ALREADY_AUTHORITATIVE: 94,
  SERVICE_PLANE_CONSISTENT: 99,
};

interface Candidate {
  readonly action: ServiceLifecycleAction;
  readonly reason: ServiceLifecycleReasonCode;
}

/**
 * Grade a normalized service-lifecycle state.
 *
 * Every condition that applies contributes a candidate; the strongest wins, ties
 * broken by fixed reason precedence.
 */
export function evaluateServiceLifecycle(
  state: NormalizedServiceLifecycle,
): ServiceLifecycleVerdict {
  const finish = (c: Candidate): ServiceLifecycleVerdict => ({
    posture: postureFor(c.reason),
    recommendedAction: c.action,
    reasonCode: c.reason,
    reportIntegrity: state.reportIntegrity,
    principalId: state.principalId,
  });

  // ── 1. INTEGRITY, and it short-circuits ─────────────────────────────────────
  // A malformed report would otherwise read as a confident inventory of separate
  // blind spots rather than as one unusable input.
  if (state.reportIntegrity === "malformed") {
    return finish({ action: "step_up", reason: "SERVICE_REPORT_MALFORMED" });
  }

  // ── 2. COVERAGE, and it short-circuits ──────────────────────────────────────
  // No licensing bridge means no evidence, and no evidence is not a finding.
  // Deliberately BEFORE the dominance check below: "we never looked" is a truer
  // description of this verdict than "someone else has it covered", and the two
  // are distinguishable so a coverage audit can find the first.
  //
  // `unknown` lands here too. Claiming `step_up` because we cannot tell whether
  // we HAVE a bridge would punish every deployment that has not wired one — the
  // defect the uem family had to be repaired for. It gets its own reason code so
  // it is visible as a gap rather than silently identical to `not_reported`.
  if (state.planeReporting === "not_reported") {
    return finish({ action: "none", reason: "SERVICE_PLANE_NOT_REPORTED" });
  }
  if (state.planeReporting === "unknown") {
    return finish({ action: "none", reason: "SERVICE_PLANE_REPORTING_UNKNOWN" });
  }

  // ── 3. DOMINANCE (row 47), and it short-circuits ────────────────────────────
  // `access-governance` owns lifecycle authority and already escalates a leaver.
  // Where it has spoken, a second, weaker, relayed verdict on the same fact is
  // noise.
  //
  // ONLY on a POSITIVE statement. `unposed` does not suppress — see the note on
  // `AccountPlaneStanding`: the suppression is the permissive move, so the
  // suppression is what has to be earned.
  if (state.accountPlane === "lifecycle_concern") {
    return finish({ action: "none", reason: "ACCOUNT_PLANE_ALREADY_AUTHORITATIVE" });
  }

  // ── 4. COHERENCE, and it short-circuits ─────────────────────────────────────
  if (!coherent(state)) {
    return finish({ action: "step_up", reason: "SERVICE_REPORT_INCOHERENT" });
  }

  const candidates: Candidate[] = [];
  const closureRecorded = state.closure === "recorded";
  const closureLive = closureRecorded && state.closureSuperseded !== true;

  // ── Affirmative contradictions ──────────────────────────────────────────────

  if (state.assignment === "assigned" && closureRecorded) {
    if (state.assignmentOrder === "after_closure") {
      // A service entitlement dated AFTER a recorded departure. Somebody ACTED:
      // the classic shape is the shortcut for "the manager needs the leaver's
      // mailbox" — re-licence the departed account and hand over the
      // credentials, instead of converting to a shared mailbox. The owner's own
      // correction, arriving as a runtime fact instead of a runbook step:
      // shared and inactive mailboxes are not interchangeable.
      //
      // A REHIRE PRODUCES THE SAME ORDERING and is ordinary life, so the
      // supersession answer decides the severity, and only a POSITIVE `false`
      // reaches restrict.
      if (state.closureSuperseded === false) {
        candidates.push({ action: "restrict", reason: "SERVICE_REASSIGNED_AFTER_CLOSURE" });
      } else if (state.closureSuperseded === null) {
        candidates.push({
          action: "step_up",
          reason: "SERVICE_REASSIGNED_CLOSURE_SUPERSESSION_UNKNOWN",
        });
      }
      // `true` — a rehire explains it. No candidate.
    } else if (state.assignmentOrder === "before_closure" && closureLive) {
      // The passive failure: entitlements minted before the departure and never
      // reclaimed. This is scenario 4 of the reference — "a terminated
      // employee's account is still active" — seen from the SERVICE plane
      // rather than the account plane, and it fires precisely in the gap where
      // the account plane has not caught up. Step_up, not restrict: nobody
      // acted, the work simply was not finished.
      candidates.push({ action: "step_up", reason: "SERVICE_ENTITLEMENT_OUTLIVED_CLOSURE" });
    } else if (closureLive) {
      // A closure IS recorded, entitlements ARE live, and the one comparison
      // that would say whether those entitlements post-date the departure
      // cannot be made — because an instant was unreadable (`malformed`) or one
      // of the two was never reported (`not_comparable`).
      //
      // Graded at the level of the check it blinds, not at the level of the
      // missing field. The restrict-grade rule above is the one that goes dark.
      candidates.push({ action: "step_up", reason: "REASSIGNMENT_CHECK_BLINDED" });
    }
  }

  if (state.assignment === "none_assigned") {
    if (state.closure === "none_recorded") {
      // THE CONTRADICTION this dimension was built for. Every service plan
      // stripped, and no closure recorded anywhere. Either the offboarding is
      // half-finished, or a licence-reclamation sweep took the entitlements off
      // a perfectly current employee.
      //
      // Step_up, not restrict, and the calibration matters: automated
      // "reclaim licences unused for 30 days" runs are common and benign, and
      // restricting a worker mid-shift for a finance automation would punish
      // the wrong person for the wrong thing — the same reasoning that caps
      // `entitlement-binding`. Raise assurance, name the finding, route it.
      candidates.push({
        action: "step_up",
        reason: "SERVICE_STRIPPED_WITHOUT_RECORDED_CLOSURE",
      });
    } else if (state.closure === "unknown") {
      // Stripped, and we cannot read whether that stripping is explained. The
      // FACT is confirmed; its SIGNIFICANCE is not.
      //
      // MONITOR, deliberately one rung below the confirmed contradiction above.
      // An unconfirmed finding grading EQUAL to a confirmed one is the same
      // defect as an unconfirmed one grading higher: it erases the distinction
      // the evidence was supposed to buy.
      candidates.push({ action: "monitor", reason: "SERVICE_STRIPPED_CLOSURE_UNKNOWN" });
    }
    // `recorded` — stripped entitlements plus a recorded departure is a
    // COMPLETED offboarding. No candidate: this dimension reports what is
    // wrong, and this is what right looks like.
  }

  // ── Blind spots ─────────────────────────────────────────────────────────────

  if (state.assignment === "unknown") {
    candidates.push({ action: "step_up", reason: "SERVICE_ASSIGNMENT_STATE_UNKNOWN" });
  }

  // Only where it actually blinds something. With `none_assigned` the unknown
  // closure is already reported at its calibrated rung above, and adding a
  // step_up here would quietly overwrite that calibration.
  if (state.closure === "unknown" && state.assignment !== "none_assigned") {
    candidates.push({ action: "step_up", reason: "LIFECYCLE_CLOSURE_STATE_UNKNOWN" });
  }

  // An instant was ASSERTED and could not be read. Named at monitor whatever the
  // surrounding configuration, because the unreadable assertion is a defect in
  // the feed in its own right — and named SEPARATELY from
  // `REASSIGNMENT_CHECK_BLINDED`, which is about the consequence rather than the
  // cause. Where both apply the consequence wins on action rank; where only
  // this one applies (no closure recorded, so nothing to blind) it still gets
  // said. An honest over-budget report must never be louder than a broken one
  // is quiet.
  if (state.assignmentOrder === "malformed") {
    candidates.push({ action: "monitor", reason: "ASSIGNMENT_ORDER_MALFORMED" });
  }

  return finish(strongest(candidates));
}

/** Rank by action, then by fixed reason precedence. Independent of the order
 *  candidates were appended in — asserted by the proof, which permutes them. */
function strongest(candidates: readonly Candidate[]): Candidate {
  let best: Candidate = { action: "none", reason: "SERVICE_PLANE_CONSISTENT" };
  for (const c of candidates) {
    if (ACTION_RANK[c.action] > ACTION_RANK[best.action]) {
      best = c;
    } else if (
      ACTION_RANK[c.action] === ACTION_RANK[best.action] &&
      REASON_PRECEDENCE[c.reason] < REASON_PRECEDENCE[best.reason]
    ) {
      best = c;
    }
  }
  return best;
}

/**
 * Is the report internally consistent?
 *
 * Two rules, and both describe a report every field of which parsed cleanly and
 * which still cannot be true:
 *
 *  1. An assignment ORDERED against a closure that was not recorded. The
 *     ordering axis is defined relative to a closure instant; if no closure
 *     exists, there is nothing to be before or after.
 *  2. A closure SUPERSEDED when no closure was recorded. Supersession of
 *     nothing.
 *
 * Note what is deliberately NOT incoherent: `none_assigned` with a real ordering.
 * `assignmentOrder` describes where the LATEST assignment instant sat, and a
 * principal can have had an assignment that was subsequently removed. That
 * combination is a re-arming that was later undone — meaningful, and correctly
 * graded as a completed offboarding when a closure is recorded.
 */
function coherent(s: NormalizedServiceLifecycle): boolean {
  const ordered = s.assignmentOrder === "before_closure" || s.assignmentOrder === "after_closure";
  if (s.closure !== "recorded" && ordered) return false;
  if (s.closure === "none_recorded" && s.closureSuperseded !== null) return false;
  return true;
}

/** No `default` branch on purpose: adding a reason code without placing it here
 *  fails `tsc` with "function lacks ending return statement", which is the
 *  compiler doing work a default case would hide. */
function postureFor(reason: ServiceLifecycleReasonCode): ServiceLifecyclePosture {
  switch (reason) {
    case "SERVICE_PLANE_CONSISTENT":
      return "consistent";
    // A COVERAGE state, and structurally distinct from `consistent` so that no
    // composition layer can read "we never looked" as "we looked and it was
    // fine". Both carry action `none`; only one of them is corroboration.
    case "SERVICE_PLANE_NOT_REPORTED":
    case "SERVICE_PLANE_REPORTING_UNKNOWN":
      return "unassessed";
    case "ACCOUNT_PLANE_ALREADY_AUTHORITATIVE":
      return "deferred";
    case "SERVICE_REASSIGNED_AFTER_CLOSURE":
      return "re_armed";
    case "SERVICE_ENTITLEMENT_OUTLIVED_CLOSURE":
      return "outlived";
    case "SERVICE_STRIPPED_WITHOUT_RECORDED_CLOSURE":
    case "SERVICE_STRIPPED_CLOSURE_UNKNOWN":
      return "stripped";
    // Driven by something we could not read. Deliberately NOT one of the
    // affirmative postures: we do not know a contradiction exists, only that we
    // cannot establish that one does not. Reporting otherwise asserts a fact
    // not in evidence.
    case "REASSIGNMENT_CHECK_BLINDED":
    case "SERVICE_REASSIGNED_CLOSURE_SUPERSESSION_UNKNOWN":
    case "SERVICE_ASSIGNMENT_STATE_UNKNOWN":
    case "LIFECYCLE_CLOSURE_STATE_UNKNOWN":
    case "ASSIGNMENT_ORDER_MALFORMED":
    case "SERVICE_REPORT_MALFORMED":
    case "SERVICE_REPORT_INCOHERENT":
      return "indeterminate";
  }
}
