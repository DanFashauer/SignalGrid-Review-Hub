// @workspace/reliability — SLOs and error budgets for the decision plane.
//
// Measure what matters (availability, latency, fail-closed integrity), compare to
// objectives, and report the remaining error budget in plain language. Fail-closed
// integrity is zero-tolerance: a single fail-open exhausts it, because the fabric's
// core promise cannot be bought down. Pure, deterministic, deep-frozen.

export * from "./types";
export { DEFAULT_SLOS, computeBudget, computeReliability } from "./slo";
export {
  summarizeReliability,
  type ReliabilityPlain,
  type ReliabilityPlainLine,
} from "./summarize";
