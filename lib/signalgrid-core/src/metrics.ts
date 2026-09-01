import type { Decision, DecisionOutcome, MetricsSummary } from "./types";

/** Aggregate operator metrics over a tenant's decisions (deterministic). */
export function computeMetrics(decisions: Decision[]): MetricsSummary {
  const byOutcome: Record<DecisionOutcome, number> = {
    allow: 0,
    step_up: 0,
    restrict: 0,
    deny: 0,
  };
  for (const decision of decisions) {
    byOutcome[decision.outcome] += 1;
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
    restrictDenyRate: rate(byOutcome.restrict + byOutcome.deny, total),
    avgLatencyMs,
    p95LatencyMs: percentile(latencies, 95),
    decisionsWithPolicyVersion: decisions.filter((d) => d.policyVersionId).length,
    decisionsWithEvidence: decisions.filter((d) => d.evidenceSnapshotId).length,
    pendingReview: decisions.filter((d) => d.reviewStatus === "pending_review")
      .length,
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
