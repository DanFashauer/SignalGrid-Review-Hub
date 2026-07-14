/**
 * Decision-latency benchmark (pilot gate).
 *
 * Measures the real wall-clock latency of the decision loop over many
 * evaluations and checks it against the launch plan's pilot gate — p95 cached
 * decision latency below 750 ms. The core's internal `latencyMs` is a
 * fixed-clock artifact, so this measures actual CPU time with a monotonic timer
 * instead. Public-safe: in-memory core, synthetic data, no I/O.
 */
import { SignalGridCore } from "@workspace/signalgrid-core";

const OPERATOR = "sgk_demo_northwind_operator";
const PILOT_GATE_P95_MS = 750;

const scenarios = [
  { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  { identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session" },
  { identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session" },
  { identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "med-admin" },
  { identityRef: "nurse.nosync", deviceRef: "ipad-ward-05", workflowKey: "clinical-session" },
];

function percentile(sortedAsc: number[], p: number): number {
  const index = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, index))];
}

function main(): void {
  const core = SignalGridCore.demo();
  const warmup = 200;
  const iterations = 5000;

  for (let i = 0; i < warmup; i++) {
    core.evaluate(OPERATOR, scenarios[i % scenarios.length]);
  }

  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const scenario = scenarios[i % scenarios.length];
    const start = process.hrtime.bigint();
    core.evaluate(OPERATOR, scenario);
    const end = process.hrtime.bigint();
    samples.push(Number(end - start) / 1_000_000); // ns → ms
  }

  samples.sort((a, b) => a - b);
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const p99 = percentile(samples, 99);
  const max = samples[samples.length - 1];
  const mean = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;

  console.log("Decision-latency benchmark (public-safe, in-memory core)");
  console.log(`Iterations: ${iterations} (after ${warmup} warmup)`);
  console.log(`mean ${mean.toFixed(4)} ms`);
  console.log(`p50  ${p50.toFixed(4)} ms`);
  console.log(`p95  ${p95.toFixed(4)} ms`);
  console.log(`p99  ${p99.toFixed(4)} ms`);
  console.log(`max  ${max.toFixed(4)} ms`);
  console.log(`Pilot gate: p95 < ${PILOT_GATE_P95_MS} ms`);

  if (p95 >= PILOT_GATE_P95_MS) {
    console.error(
      `FAIL: p95 ${p95.toFixed(4)} ms exceeds the ${PILOT_GATE_P95_MS} ms pilot gate.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS: p95 ${p95.toFixed(4)} ms is well within the ${PILOT_GATE_P95_MS} ms gate.`,
  );
}

main();
