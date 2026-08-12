/**
 * The shared bench workload — one definition, two benches.
 *
 * `latency-bench.ts` asks how long ONE decision takes; `throughput-bench.ts`
 * asks how many per second this machine sustains. Those two numbers are only
 * comparable if they evaluate the same thing, so the scenario set, the operator
 * and the percentile function live here rather than being copied into each
 * bench and drifting apart.
 *
 * Public-safe: demo operator, synthetic identity/device refs, no I/O.
 */

export const BENCH_OPERATOR = "sgk_demo_northwind_operator";

export interface BenchScenario {
  identityRef: string;
  deviceRef: string;
  workflowKey: string;
}

/** Five scenarios spanning allow / step-up / restrict outcomes. */
export const BENCH_SCENARIOS: readonly BenchScenario[] = [
  { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  { identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session" },
  { identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session" },
  { identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "med-admin" },
  { identityRef: "nurse.nosync", deviceRef: "ipad-ward-05", workflowKey: "clinical-session" },
];

export function percentile(sortedAsc: number[], p: number): number {
  const index = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, index))];
}
