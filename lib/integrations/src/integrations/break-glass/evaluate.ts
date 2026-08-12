import type {
  BreakGlassAction,
  BreakGlassPosture,
  BreakGlassReasonCode,
  BreakGlassVerdict,
  NormalizedBreakGlass,
} from "./types";

/** Three rungs. The ladder simply stops before the rungs that would impede care. */
const ACTION_RANK: Record<BreakGlassAction, number> = { none: 0, monitor: 1, alert: 2 };

interface Candidate {
  readonly action: BreakGlassAction;
  readonly reason: BreakGlassReasonCode;
}

/**
 * Precedence by SPECIFICITY, not severity — the `service-lifecycle` lesson. Numbering
 * a table monotonically with the action ladder makes the equal-rank tie-break
 * unreachable, and an unreachable guard is one no test can falsify.
 */
const SPECIFICITY: Record<BreakGlassReasonCode, number> = {
  REPORT_MALFORMED: 0,
  BREAK_GLASS_NOT_NEEDED: 1,
  BREAK_GLASS_UNJUSTIFIED: 2,
  BREAK_GLASS_JUSTIFICATION_UNREADABLE: 3,
  BREAK_GLASS_SCOPE_BROAD: 4,
  BREAK_GLASS_UNBOUNDED: 5,
  BREAK_GLASS_NEVER_REVIEWED: 6,
  BREAK_GLASS_REVIEW_PENDING: 7,
  BREAK_GLASS_UNASSESSED: 8,
  BREAK_GLASS_ACCOUNTABLE: 9,
};

/**
 * Grade the accountability of one emergency override.
 *
 * Pure and deterministic. No clock — whether a bound has elapsed is the caller's to
 * supply as a state, never computed here.
 *
 * READ THE CEILING BEFORE READING ANYTHING ELSE. Every branch below tops out at
 * `alert`. That is not an oversight and it is not conservatism about false positives:
 * a dimension that could step up or restrict here would be inserting itself between a
 * clinician and a patient during an emergency, and no amount of governance value
 * justifies that. The override already happened. This grades the RECORD of it.
 */
export function evaluateBreakGlass(state: NormalizedBreakGlass): BreakGlassVerdict {
  const candidates: Candidate[] = [];

  if (state.reportIntegrity === "malformed") {
    candidates.push({ action: "alert", reason: "REPORT_MALFORMED" });
  }

  // ── The justification ────────────────────────────────────────────────────────
  //
  // An absent justification is the defect that turns an emergency mechanism into an
  // unauditable one. It ALERTS at operator scale rather than merely monitoring,
  // because a break-glass workflow that never asks is a policy gap across the whole
  // deployment, not an incident about one clinician.
  if (state.justification === "absent") {
    candidates.push({ action: "alert", reason: "BREAK_GLASS_UNJUSTIFIED" });
  }
  // Asked and lost is a plumbing defect with a different owner than never asked.
  if (state.justification === "unreadable") {
    candidates.push({ action: "alert", reason: "BREAK_GLASS_JUSTIFICATION_UNREADABLE" });
  }

  // ── Scope and expiry: is this an emergency measure or a standing bypass? ─────
  if (state.scope === "broad") {
    candidates.push({ action: "alert", reason: "BREAK_GLASS_SCOPE_BROAD" });
  }
  if (state.expiry === "unbounded") {
    candidates.push({ action: "alert", reason: "BREAK_GLASS_UNBOUNDED" });
  }

  // ── The review loop, which is the half most deployments never build ─────────
  //
  // `never_reviewed` means there is no queue at all — an operator-scale finding.
  // `pending` means there IS a queue and this item is in it, which is the system
  // working; it monitors rather than alerts, so a functioning review backlog does
  // not generate noise that trains people to ignore the channel.
  if (state.review === "never_reviewed") {
    candidates.push({ action: "alert", reason: "BREAK_GLASS_NEVER_REVIEWED" });
  }
  if (state.review === "pending") {
    candidates.push({ action: "monitor", reason: "BREAK_GLASS_REVIEW_PENDING" });
  }

  // ── Ignorance ────────────────────────────────────────────────────────────────
  //
  // ANY unknown governance axis blocks `accountable`. Not all of them — ANY.
  //
  // The first draft required ALL FOUR to be unknown before it would say so, and the
  // mutation guard exposed what that actually meant: a record stating that a
  // justification was captured and the invoker was genuinely unassigned, while saying
  // NOTHING about scope, expiry or review, graded as fully accountable. Every other
  // branch stayed silent, the conjunction did not fire, and the verdict came out
  // clean. That is silence reading as health — the precise failure this codebase
  // exists to prevent — sitting inside the dimension written to catch it.
  //
  // As a disjunction each condition is also independently falsifiable: delete any one
  // and the states where only THAT axis is unknown wrongly go clean.
  if (
    state.scope === "unknown" ||
    state.expiry === "unknown" ||
    state.review === "unknown" ||
    state.assignmentAtInvocation === "unknown"
  ) {
    candidates.push({ action: "monitor", reason: "BREAK_GLASS_UNASSESSED" });
  }

  // ── The override that did not need to happen ─────────────────────────────────
  //
  // Break-glass by someone ALREADY assigned to the patient bypassed nothing. It is
  // muscle memory, a broken assignment feed, or an audit dodge — and all three are
  // worth a compliance owner's attention, because the third is indistinguishable
  // from the first two without asking.
  //
  // PUSHED LAST among the alert-producers ON PURPOSE, and it is the MOST specific of
  // them. If the most specific candidate were also pushed first, the tie-break below
  // would agree with arrival order in every reachable state and could never be
  // falsified — the `service-lifecycle` defect, which the guard caught here too.
  if (state.assignmentAtInvocation === "assigned") {
    candidates.push({ action: "alert", reason: "BREAK_GLASS_NOT_NEEDED" });
  }

  const winner = candidates.reduce<Candidate>(
    (best, c) => {
      if (ACTION_RANK[c.action] > ACTION_RANK[best.action]) return c;
      if (ACTION_RANK[c.action] === ACTION_RANK[best.action]) {
        return SPECIFICITY[c.reason] < SPECIFICITY[best.reason] ? c : best;
      }
      return best;
    },
    { action: "none", reason: "BREAK_GLASS_ACCOUNTABLE" },
  );

  return {
    posture: postureFor(winner),
    recommendedAction: winner.action,
    reasonCode: winner.reason,
    reportIntegrity: state.reportIntegrity,
  };
}

/** Reason → posture, pinned as a SHAPE by the proof rather than branch by branch. */
function postureFor(winner: Candidate): BreakGlassPosture {
  if (winner.action === "none") return "accountable";
  // Knowing nothing is `unassessed` — never `unaccountable`. Calling a deployment's
  // override programme unaccountable because it did not report to us would assert a
  // fact not in evidence about someone else's compliance posture.
  if (winner.reason === "BREAK_GLASS_UNASSESSED" || winner.reason === "REPORT_MALFORMED") {
    return "unassessed";
  }
  // The override should not have happened, or cannot be accounted for at all.
  if (winner.reason === "BREAK_GLASS_NOT_NEEDED" || winner.reason === "BREAK_GLASS_UNJUSTIFIED") {
    return "unaccountable";
  }
  return "under_documented";
}
