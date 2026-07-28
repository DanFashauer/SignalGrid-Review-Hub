// Compute SLIs and error budgets from a window of decision records, and say the
// result in plain language.

import {
  deepFreeze,
  BUDGET_STATUS_RANK,
  type BudgetStatus,
  type DecisionRecord,
  type ErrorBudgetResult,
  type ReliabilityReport,
  type Slo,
} from "./types";

/** The default SLOs for the decision plane. Latency and availability carry error
 *  budgets; fail-closed integrity is zero-tolerance — the fabric's core promise. */
export const DEFAULT_SLOS: readonly Slo[] = Object.freeze([
  {
    id: "decision-availability",
    description: "Nearly every evaluation returns a valid verdict rather than erroring out.",
    kind: "availability",
    objective: 0.999,
  },
  {
    id: "decision-latency",
    description: "Decisions are fast: the large majority return under the latency target.",
    kind: "latency",
    objective: 0.99,
    latencyTargetMs: 50,
  },
  {
    id: "fail-closed-integrity",
    description: "No decision ever grants access on an unknown or unreachable signal.",
    kind: "fail_closed_integrity",
    objective: 1,
    zeroTolerance: true,
  },
]);

/** How many records in the window count as "bad" for a given SLO. */
function countBad(slo: Slo, records: readonly DecisionRecord[]): number {
  switch (slo.kind) {
    case "availability":
      return records.filter((r) => !r.produced).length;
    case "latency": {
      const target = slo.latencyTargetMs ?? Infinity;
      // Only decisions that produced a verdict can be judged on latency.
      return records.filter((r) => r.produced && r.latencyMs > target).length;
    }
    case "fail_closed_integrity":
      return records.filter((r) => r.failedOpen).length;
  }
}

/** For latency, the denominator is the produced decisions (you cannot time a decision
 *  that never returned); for the others it is the whole window. */
function sampleSize(slo: Slo, records: readonly DecisionRecord[]): number {
  if (slo.kind === "latency") return records.filter((r) => r.produced).length;
  return records.length;
}

function statusOf(slo: Slo, sampleCount: number, budgetEvents: number, consumedEvents: number): BudgetStatus {
  // Zero-tolerance: any breach exhausts, no matter the window. A fail-closed
  // violation can never be "within budget".
  if (slo.zeroTolerance) return consumedEvents > 0 ? "exhausted" : "healthy";
  // Too little data to judge → unknown (fail-safe: not "healthy").
  if (sampleCount === 0) return "unknown";
  if (consumedEvents > budgetEvents) return "exhausted";
  // "At risk" once most of the budget is spent (>= 80%). With a zero budget and no
  // breach, that is still healthy (nothing spent).
  if (budgetEvents > 0 && consumedEvents / budgetEvents >= 0.8) return "at_risk";
  return "healthy";
}

/** Compute the error budget for one SLO over a window. Pure and deterministic. */
export function computeBudget(slo: Slo, records: readonly DecisionRecord[]): ErrorBudgetResult {
  const sampleCount = sampleSize(slo, records);
  const consumedEvents = countBad(slo, records);
  // Zero-tolerance SLOs get a zero budget by construction.
  const budgetEvents = slo.zeroTolerance ? 0 : Math.floor((1 - slo.objective) * sampleCount);
  const remainingEvents = budgetEvents - consumedEvents;
  const burnRate = budgetEvents === 0 ? (consumedEvents > 0 ? Infinity : 0) : consumedEvents / budgetEvents;
  const sli = sampleCount === 0 ? 1 : 1 - consumedEvents / sampleCount;
  return deepFreeze({
    slo,
    sampleCount,
    sli,
    budgetEvents,
    consumedEvents,
    remainingEvents,
    burnRate,
    status: statusOf(slo, sampleCount, budgetEvents, consumedEvents),
  });
}

function worst(a: BudgetStatus, b: BudgetStatus): BudgetStatus {
  return BUDGET_STATUS_RANK[b] > BUDGET_STATUS_RANK[a] ? b : a;
}

/** Compute the whole reliability report over a window. Worst-status-wins. */
export function computeReliability(
  records: readonly DecisionRecord[],
  slos: readonly Slo[] = DEFAULT_SLOS,
): ReliabilityReport {
  const budgets = slos.map((slo) => computeBudget(slo, records));
  let overall: BudgetStatus = "healthy";
  for (const b of budgets) overall = worst(overall, b.status);
  return deepFreeze({ budgets, overall });
}
