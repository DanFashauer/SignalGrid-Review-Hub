import type { Decision, DecisionOutcome, MetricsSummary } from "./types";

/** Aggregate operator metrics over a tenant's decisions (deterministic). `bound` is
 *  REQUIRED: only the caller knows whether this list is the whole history or its tail. */
export function computeMetrics(
  decisions: Decision[],
  bound: { capped: boolean; maxPerTenant: number },
): MetricsSummary {
  const byOutcome: Record<DecisionOutcome, number> = {
    allow: 0,
    step_up: 0,
    restrict: 0,
    deny: 0,
  };
  // GUARDED: `byOutcome[outcome] += 1` on an out-of-union outcome is `undefined + 1`
  // = NaN AND mints the key — a fifth bucket JSON.stringify emits as `null`. Durable
  // snapshot rows are cast in with an unchecked `as`, so it is reachable from outside
  // this process. Object.hasOwn (not `in`) also keeps "toString" off the prototype.
  let unrecognizedOutcomes = 0;
  for (const decision of decisions) {
    if (Object.hasOwn(byOutcome, decision.outcome)) {
      byOutcome[decision.outcome] += 1;
    } else {
      unrecognizedOutcomes += 1;
    }
  }
  const total = decisions.length;
  const latencies = decisions
    .map((d) => d.latencyMs)
    .sort((a, b) => a - b);
  const avgLatencyMs =
    total === 0
      ? 0
      : Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / total);

  return {
    totalDecisions: total,
    byOutcome,
    allowRate: rate(byOutcome.allow, total),
    // Fail-closed direction: an outcome we cannot classify counts on the
    // restrictive side, never toward the grant rate.
    restrictDenyRate: rate(byOutcome.restrict + byOutcome.deny + unrecognizedOutcomes, total),
    avgLatencyMs,
    p95LatencyMs: percentile(latencies, 95),
    decisionsWithPolicyVersion: decisions.filter((d) => d.policyVersionId).length,
    decisionsWithEvidence: decisions.filter((d) => d.evidenceSnapshotId).length,
    pendingReview: decisions.filter((d) => d.reviewStatus === "pending_review")
      .length,
    window: {
      // Derived from the array this function actually looped over, so the field
      // cannot drift away from the computation it describes.
      decisionsConsidered: decisions.length,
      capped: bound.capped,
      maxPerTenant: bound.maxPerTenant,
      unrecognizedOutcomes,
    },
  };
}

function rate(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 1000) / 1000;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const index = Math.ceil((p / 100) * sortedAsc.length) - 1;
  const clamped = Math.min(sortedAsc.length - 1, Math.max(0, index));
  return sortedAsc[clamped];
}
