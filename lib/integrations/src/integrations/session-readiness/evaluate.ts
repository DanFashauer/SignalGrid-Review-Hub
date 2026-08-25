import type {
  NormalizedSessionReadiness,
  SessionReadinessAction,
  SessionReadinessPosture,
  SessionReadinessReasonCode,
  SessionReadinessVerdict,
} from "./types";
import { posedBound } from "../../utils/posed-bound";

/** The unified ladder, minus the two rungs this family has no standing to reach. */
const ACTION_RANK: Record<SessionReadinessAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
};

interface Candidate {
  readonly action: SessionReadinessAction;
  readonly reason: SessionReadinessReasonCode;
}

/**
 * PRECEDENCE, numbered by SPECIFICITY rather than by severity.
 *
 * That distinction is not cosmetic — it is the lesson `service-lifecycle` paid for.
 * Numbering a precedence table monotonically with the action ladder makes the
 * tie-break unreachable, because the strongest candidate is always also the
 * highest-precedence one, and a guard that can never be reached is a guard no test
 * can falsify. Ordering by specificity creates real collisions between equal-ranked
 * candidates, which is what makes the tie-break observable.
 */
const SPECIFICITY: Record<SessionReadinessReasonCode, number> = {
  REPORT_MALFORMED: 0,
  READINESS_PLANE_UNREACHABLE: 1,
  READINESS_UNMEASURED_NOT_INSTRUMENTED: 2,
  APP_NOT_USABLE: 3,
  SESSION_RECONNECTED_UNVERIFIED: 4,
  READINESS_BUDGET_EXCEEDED: 5,
  APP_DEGRADED: 6,
  READINESS_UNKNOWN: 7,
  READINESS_BUDGET_UNREADABLE: 8,
  READINESS_BUDGET_UNPOSED: 9,
  SESSION_READY: 10,
};

/**
 * Grade one normalized readiness record.
 *
 * Pure and deterministic. No clock is read — `elapsedToUsableSeconds` arrives as a
 * duration the caller measured, and the budget arrives posed.
 *
 * THE RULE THAT MATTERS MOST, stated once here because every branch below serves it:
 * an ABSENCE of readiness evidence never grades as readiness. `not_instrumented`, a
 * plane we could not reach, and an `unknown` reading are three different ways of
 * knowing nothing, and none of them is a pass.
 */
export function evaluateSessionReadiness(state: NormalizedSessionReadiness): SessionReadinessVerdict {
  const candidates: Candidate[] = [];

  // An unreadable record is ignorance, not a finding — and emphatically not health.
  if (state.reportIntegrity === "malformed") {
    candidates.push({ action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── The absence branches, which are the whole point of the dimension ──────────
  //
  // A DEX plane that cannot be read produces the same silence as an app that came up
  // instantly. It is an operator-scale defect (the monitoring is broken, for everyone
  // on that plane), so it ALERTS rather than merely stepping up one worker.
  if (state.measurement === "plane_unreachable") {
    candidates.push({ action: "alert", reason: "READINESS_PLANE_UNREACHABLE" });
  }
  // An endpoint nobody instrumented is also operator-scale: the fix is to deploy the
  // agent to the fleet, not to challenge the clinician standing at the workstation.
  if (state.measurement === "not_instrumented") {
    candidates.push({ action: "alert", reason: "READINESS_UNMEASURED_NOT_INSTRUMENTED" });
  }

  // ── The budget ────────────────────────────────────────────────────────────────
  //
  // Exceeding a posed budget is a finding whose severity is set by the posed workflow
  // risk — this is the "allow chart view, hold the medication order" case, and it is
  // the reason `workflowRisk` is an axis rather than a caller-side filter.
  //
  // PUSHED BEFORE the readiness branches ON PURPOSE, and the ordering is load-bearing.
  // A budget breach and an app that never came up can both fire on one record, at the
  // same action rank, for a non-critical workflow. If the MORE specific candidate were
  // also pushed first, the tie-break below would agree with push order in every
  // reachable case and could never be falsified — which is exactly how
  // `service-lifecycle`'s equality guard went unfalsifiable. Pushing the LESS specific
  // candidate first makes the collision real, and the mutation guard caught this on
  // this family's very first sweep.
  // A budget whose threshold cannot be READ is a third state, and it is the one
  // that used to vanish. `elapsed > NaN` and `elapsed > undefined` are both false,
  // so no EXCEEDED candidate fired — AND because `budget !== null`, the honest
  // UNPOSED arm below was skipped too. Both the finding and its fallback switched
  // off at once, and a garbled budget graded STRICTLY BETTER than no budget: `ready
  // / none` against the `degraded / monitor` an absent one produces. A misspelled
  // key in a deployment's config satisfies `ReadinessBudget` structurally and does
  // exactly this.
  //
  // Kept DISTINCT from UNPOSED on purpose. "You did not pose a budget" and "the
  // budget you posed is unreadable" have different owners and different fixes, and
  // collapsing them would lose the difference the rest of this family works to keep.
  // NOTE the asymmetry with `posedBound`'s own contract, and it is deliberate.
  // There, `undefined` means "not posed" and yields the fallback. HERE a budget
  // OBJECT exists, so `thresholdSeconds` is not optional — a budget carrying no
  // readable threshold is a garbled pose, not an absent one. That case is the
  // realistic one: a config with a misspelled key (`thresholdSecs`) satisfies
  // `ReadinessBudget` structurally and arrives as `undefined`.
  const budgetThreshold =
    state.budget === null
      ? null
      : posedBound(
          state.budget.thresholdSeconds === undefined
            ? Number.NaN
            : state.budget.thresholdSeconds,
          Number.NaN,
        );
  if (state.budget !== null && budgetThreshold === null) {
    candidates.push({ action: "monitor", reason: "READINESS_BUDGET_UNREADABLE" });
  }
  if (
    // A `state.budget !== null` term stood here and was REMOVED on 2026-08-25,
    // not exempted. `budgetThreshold` is computed directly above as
    // `state.budget === null ? null : posedBound(...)`, so a null budget forces a
    // null threshold and the test below already implied it — which is exactly why
    // the daily mutation sweep could not kill it.
    //
    // The obvious disposition was to keep it for intent and add an ALLOWED entry,
    // the way the `elapsedToUsableSeconds` term below is handled. That would have
    // been WRONG here: the guard matches an exemption by substring against the
    // trimmed source line, and `state.budget !== null &&` also appears in the
    // READINESS_BUDGET_UNREADABLE branch nine lines up — which is real, load-bearing
    // behaviour. One exemption would have silently covered both, putting a
    // fail-open inside the control that exists to catch fail-opens.
    budgetThreshold !== null &&
    // `elapsedToUsableSeconds !== null` is INERT and kept deliberately: JS coerces
    // `null > 30` to false, so removing it changes no outcome. It states the intent —
    // this branch compares two numbers — and becomes load-bearing the moment the
    // comparison changes shape. Registered as an ALLOWED inert term in the guard.
    state.elapsedToUsableSeconds !== null &&
    state.elapsedToUsableSeconds > budgetThreshold
  ) {
    candidates.push({
      action: state.workflowRisk === "critical" ? "restrict" : "alert",
      reason: "READINESS_BUDGET_EXCEEDED",
    });
  }
  // A deployment that measured an elapsed time but posed no budget has a number nobody
  // can grade. It is a `monitor` — a gap in the deployment's own policy, not a finding
  // about this worker — and it must NOT be suppressible by omitting the budget, which
  // is exactly what a `?? DEFAULT_THRESHOLD` here would allow.
  if (state.budget === null && state.elapsedToUsableSeconds !== null) {
    candidates.push({ action: "monitor", reason: "READINESS_BUDGET_UNPOSED" });
  }

  // ── The measured branches ─────────────────────────────────────────────────────
  if (state.appReadiness === "not_usable") {
    // A confirmed failure. Restrict only bites where the workflow is posed critical —
    // holding a chart view because a co-resident app is down would be theatre.
    //
    // MORE SPECIFIC than a budget breach, and pushed AFTER it: "the app never came up"
    // tells an operator something "it was slow" does not, so at equal action rank this
    // must win on specificity rather than on arrival order.
    candidates.push({
      action: state.workflowRisk === "critical" ? "restrict" : "alert",
      reason: "APP_NOT_USABLE",
    });
  }
  if (state.appReadiness === "degraded") {
    candidates.push({
      action: state.workflowRisk === "critical" ? "step_up" : "monitor",
      reason: "APP_DEGRADED",
    });
  }
  if (state.appReadiness === "unknown" && state.measurement === "measured") {
    // The plane reported and still could not say. Not the same as not asking.
    candidates.push({ action: "step_up", reason: "READINESS_UNKNOWN" });
  }

  // ── Session provenance ────────────────────────────────────────────────────────
  //
  // A RECONNECTED session on a shared workstation may still hold the previous
  // clinician's context, and its tap-to-app journey looks FAST precisely because
  // nothing was torn down. Speed is not reassurance here. Stepping up is the honest
  // response: confirm who owns this session before a critical action proceeds.
  // `sso-session` owns the identity-provider side of this question; the two planes can
  // disagree, and that disagreement is a finding rather than noise.
  if (state.sessionOrigin === "reconnected" && state.workflowRisk === "critical") {
    candidates.push({ action: "step_up", reason: "SESSION_RECONNECTED_UNVERIFIED" });
  }

  const winner = candidates.reduce<Candidate>(
    (best, c) => {
      if (ACTION_RANK[c.action] > ACTION_RANK[best.action]) return c;
      // Equal action rank — the MORE SPECIFIC reason wins, so an operator is told the
      // narrowest true thing rather than whichever branch happened to run first.
      if (ACTION_RANK[c.action] === ACTION_RANK[best.action]) {
        return SPECIFICITY[c.reason] < SPECIFICITY[best.reason] ? c : best;
      }
      return best;
    },
    { action: "none", reason: "SESSION_READY" },
  );

  return {
    posture: postureFor(winner),
    recommendedAction: winner.action,
    reasonCode: winner.reason,
    reportIntegrity: state.reportIntegrity,
  };
}

/**
 * Map a winning candidate onto a posture.
 *
 * Pinned as a SHAPE by the proof rather than branch by branch — the `uem` registry gap
 * showed that a posture map asserted only on the grant path is a map nobody verified,
 * and it is the part an operator actually reads to decide what to do.
 */
function postureFor(winner: Candidate): SessionReadinessPosture {
  if (winner.action === "none") return "ready";
  // Knowing NOTHING is `unassessed`, and is deliberately not `not_ready`: reporting a
  // readiness failure for an endpoint nobody measured would assert a fact not in
  // evidence, and would send someone to debug an app that may be perfectly fine.
  if (
    winner.reason === "READINESS_PLANE_UNREACHABLE" ||
    winner.reason === "READINESS_UNMEASURED_NOT_INSTRUMENTED" ||
    winner.reason === "READINESS_UNKNOWN" ||
    winner.reason === "REPORT_MALFORMED" ||
    winner.reason === "READINESS_BUDGET_UNREADABLE"
  ) {
    return "unassessed";
  }
  // A confirmed failure, or a confirmed breach of a posed budget.
  if (winner.reason === "APP_NOT_USABLE" || winner.reason === "READINESS_BUDGET_EXCEEDED") {
    return "not_ready";
  }
  return "degraded";
}
