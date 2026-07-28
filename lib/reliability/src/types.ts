// @workspace/reliability — SLOs and error budgets for the DECISION plane.
//
// The SRE discipline, applied to SignalGrid itself: measure what matters, set
// realistic objectives, and spend an error budget deliberately. "The goal is not
// zero failures; the goal is fast recovery and continuous improvement." This module
// turns a window of decision outcomes into service-level indicators (SLIs), compares
// them to objectives (SLOs), and reports the remaining error budget in plain terms.
//
// THE SIGNALGRID TWIST — a fail-closed violation has NO budget. You may spend a
// LATENCY budget (some slow decisions are acceptable); you may spend an AVAILABILITY
// budget (some evaluation errors are acceptable). But an evaluation that GRANTED on an
// unknown/unreachable signal — a fail-closed breach — is never "within budget": it is
// the one thing the fabric exists to prevent, and a single occurrence exhausts a
// zero-tolerance SLO regardless of window size. Reliability that let you buy your way
// out of fail-closed would be no reliability at all.
//
// Pure and deterministic: SLIs are computed from a supplied window of records, never
// from a clock; identical input → byte-identical report; everything deep-frozen.

/** A single decision outcome, reduced to the fields reliability cares about. Opaque
 *  refs only — never the decision body. */
export interface DecisionRecord {
  /** Did the evaluation produce a valid verdict at all (vs. an internal error/timeout)? */
  produced: boolean;
  /** End-to-end decision latency in milliseconds (for the latency SLO). */
  latencyMs: number;
  /** TRUE iff this decision GRANTED (allow) while a required signal was unknown or
   *  unreachable — i.e. it did NOT fail closed. This must always be false in a correct
   *  fabric; the reliability layer measures it so a regression is impossible to hide. */
  failedOpen: boolean;
}

/** How an SLI is measured from the window. */
export type SliKind = "availability" | "latency" | "fail_closed_integrity";

/** A service-level objective for the decision plane. */
export interface Slo {
  /** Stable id (kebab). */
  id: string;
  /** What this objective is about, in plain language. */
  description: string;
  kind: SliKind;
  /** The target ratio in [0,1] — e.g. 0.999 for "99.9% of decisions produce a verdict".
   *  For a latency SLO, the fraction under `latencyTargetMs`. */
  objective: number;
  /** For a latency SLO: the millisecond threshold a decision must beat to count as good. */
  latencyTargetMs?: number;
  /** A zero-tolerance SLO has NO error budget: any breach exhausts it. Reserved for
   *  fail-closed integrity — the fabric's core promise, which cannot be spent down. */
  zeroTolerance?: boolean;
}

/** The status of an error budget. `exhausted` outranks `at_risk` outranks `healthy`;
 *  `unknown` (too little data to judge) is treated as worse than `at_risk` — not
 *  knowing your reliability is not "fine", the same fail-closed instinct the fabric
 *  uses everywhere. */
export type BudgetStatus = "healthy" | "at_risk" | "unknown" | "exhausted";

export const BUDGET_STATUS_RANK: Readonly<Record<BudgetStatus, number>> = Object.freeze({
  healthy: 0,
  at_risk: 1,
  unknown: 2,
  exhausted: 3,
});

/** The computed error budget for one SLO over the window. */
export interface ErrorBudgetResult {
  slo: Slo;
  /** Number of records in the window the SLI was computed over. */
  sampleCount: number;
  /** The measured indicator in [0,1] (e.g. fraction of decisions that produced a verdict). */
  sli: number;
  /** The allowed number of "bad" events for this objective over this window
   *  (`(1 - objective) * sampleCount`), rounded down. Zero for a zero-tolerance SLO. */
  budgetEvents: number;
  /** How many bad events actually occurred in the window. */
  consumedEvents: number;
  /** budgetEvents - consumedEvents, floored at a signed value so overspend is visible. */
  remainingEvents: number;
  /** consumedEvents / budgetEvents, or Infinity when the budget is zero and any event
   *  occurred. A burn rate >= 1 means the budget is spent. */
  burnRate: number;
  status: BudgetStatus;
}

/** The whole reliability picture. */
export interface ReliabilityReport {
  budgets: ErrorBudgetResult[];
  /** Worst-status-wins across every SLO. */
  overall: BudgetStatus;
}

/** Recursively freeze — reliability results are immutable. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
