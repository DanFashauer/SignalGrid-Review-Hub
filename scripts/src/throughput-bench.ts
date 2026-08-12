/**
 * Decision-throughput / saturation benchmark.
 *
 * The companion to `latency-bench.ts`. That one answers "how long does ONE
 * decision take when nothing else is running?"; this one answers the two
 * questions a capacity conversation actually turns on:
 *
 *   1. How many decisions per second does ONE core sustain, back to back?
 *   2. What happens when every core is busy at once — does the core scale, and
 *      does it still return the SAME verdicts under saturation?
 *
 * Method. Stage 1 runs the shared bench workload in the main thread for a fixed
 * duration and counts completions. Stage 2 starts one worker thread per
 * available core, waits for all of them to finish loading and warming up, then
 * releases them together so the measured window is saturation and not thread
 * startup. Each worker reports its own completions, elapsed time and per-op
 * service times; the aggregate is summed over the mean worker window.
 *
 * WHAT THIS MEASURES, stated plainly so a number from it is never quoted as
 * more than it is: the in-memory decision core only — `SignalGridCore.demo()`
 * with synthetic data. There is no HTTP, no connector, no database and no
 * network in this path. It is a CPU ceiling for the decision loop, NOT an
 * end-to-end `/v1` request rate, and the two will differ by a lot.
 *
 * WHY THE ABSOLUTE NUMBERS ARE REPORT-ONLY. A throughput figure is a property
 * of the hardware it ran on. This repo has no documented decisions-per-second
 * requirement to gate against, and inventing one would be exactly the kind of
 * unearned figure `check-fabricated-status.mjs` exists to stop. So the ops/sec
 * lines are reported, not asserted.
 *
 * WHAT IS GATED — three things that hold on any hardware:
 *
 *   • A floor derived from the ONE published figure: the launch plan's pilot
 *     gate is p95 < 750 ms per decision, which is 1.33 decisions/sec on a
 *     single core. Sustained single-core throughput below that would mean the
 *     decision loop no longer meets the latency gate it already claims to.
 *     Measured headroom today is several thousand times this floor — the gate
 *     is a collapse detector (a sync network call, an O(n²) blowup), not a
 *     performance target, and it is set where it cannot flake on a busy runner.
 *   • No parallel collapse: N saturated cores must beat one core. Gaining
 *     literally nothing from N cores means contention on shared state, which is
 *     a defect regardless of the machine.
 *   • Determinism under concurrency: every worker must produce byte-identical
 *     verdicts to the single-threaded pass. Same input, same output, no matter
 *     how many threads are evaluating at once. This is the assertion worth
 *     having here — it is the fail-closed/deterministic rule of this repo tested
 *     under the one condition the proof suite never applies to it.
 *
 * Usage:
 *   pnpm run bench:decision-throughput
 *   pnpm run bench:decision-throughput -- --seconds=5 --workers=4
 *
 * Wired into preflight and into both the per-PR and scheduled workflows at
 * `--seconds=2`, alongside the latency gate. Worker count follows
 * `availableParallelism()`, so a 2-core runner saturates two cores — measured
 * there at 1.94x, well clear of the 1.0x collapse threshold.
 */
import { availableParallelism } from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";

// NOTE — nothing but node builtins may be imported at the top of this file.
// A worker thread does NOT inherit tsx's module resolver from its parent, so a
// static import of a workspace package would fail to resolve inside the worker
// before it ever gets a chance to register one. Both branches therefore load
// the core dynamically, and the worker registers tsx first. See runWorker().

const DEFAULT_SECONDS = 3;
const WARMUP_ITERATIONS = 200;
/** Per-thread cap on retained service-time samples; counting continues past it. */
const MAX_SAMPLES = 250_000;

/** docs: the pilot gate is p95 < 750 ms, i.e. 1.333… decisions/sec on one core. */
const PILOT_GATE_P95_MS = 750;
const FLOOR_OPS_PER_SEC = 1000 / PILOT_GATE_P95_MS;

interface Run {
  ops: number;
  elapsedMs: number;
  samples: Float64Array;
  /** Verdict fingerprint of the scenario set — must not vary with thread count. */
  signature: string;
}

type WorkerToMain =
  | { type: "ready" }
  | { type: "done"; ops: number; elapsedMs: number; samples: Float64Array; signature: string };

async function loadWorkload() {
  const [core, workload] = await Promise.all([
    import("@workspace/signalgrid-core"),
    import("./bench-workload.js"),
  ]);
  return { SignalGridCore: core.SignalGridCore, ...workload };
}

type Workload = Awaited<ReturnType<typeof loadWorkload>>;
// Via `demo()` rather than `InstanceType<…>`: the core's constructor is private,
// and the factory is how every caller obtains one anyway.
type Core = ReturnType<Workload["SignalGridCore"]["demo"]>;

/**
 * The fingerprint deliberately excludes `decisionId` and `latencyMs`: the first
 * is a per-decision identity and the second is a measured duration, so neither
 * is expected to repeat. Everything a caller would ACT on is included.
 */
function verdictSignature(core: Core, w: Workload): string {
  return w.BENCH_SCENARIOS.map((scenario) => {
    const r = core.evaluate(w.BENCH_OPERATOR, scenario);
    return [
      r.outcome,
      r.reasonCodes.join("|"),
      r.policyId,
      r.policyVersion,
      r.policyVersionId,
      r.evidenceSnapshotId,
      r.matchedRules.map((m) => m.ruleId).join("|"),
      r.reviewable,
      r.coreNormalizationVersion ?? "unstamped",
    ].join(" ");
  }).join("\n");
}

/** Run the workload flat out for `durationMs`, timing every completion. */
function measure(core: Core, w: Workload, durationMs: number): Run {
  const signature = verdictSignature(core, w);

  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[i % w.BENCH_SCENARIOS.length]);
  }

  const buffer = new Float64Array(MAX_SAMPLES);
  const start = process.hrtime.bigint();
  const deadline = start + BigInt(Math.round(durationMs * 1e6));
  let previous = start;
  let kept = 0;
  let ops = 0;
  let now = start;

  // One hrtime read per iteration serves as both the service-time sample and
  // the deadline check, so the measurement overhead is charged honestly to the
  // op it belongs to rather than being hidden between iterations.
  while (true) {
    core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[ops % w.BENCH_SCENARIOS.length]);
    now = process.hrtime.bigint();
    if (kept < MAX_SAMPLES) buffer[kept++] = Number(now - previous) / 1e6;
    previous = now;
    ops++;
    if (now >= deadline) break;
  }

  return { ops, elapsedMs: Number(now - start) / 1e6, samples: buffer.subarray(0, kept), signature };
}

function opsPerSec(run: { ops: number; elapsedMs: number }): number {
  return run.ops / (run.elapsedMs / 1000);
}

/** Start `count` workers, hold them at a barrier, then release them together. */
function saturate(count: number, durationMs: number): Promise<Run[]> {
  const workers: Worker[] = [];
  const runs: Run[] = [];
  let ready = 0;

  return new Promise<Run[]>((resolve, reject) => {
    const failAll = (error: unknown) => {
      for (const worker of workers) void worker.terminate();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL(import.meta.url), { workerData: { durationMs } });
      workers.push(worker);
      worker.on("message", (message: WorkerToMain) => {
        if (message.type === "ready") {
          // Release only once every worker is loaded and warm, so the measured
          // window is N threads running at once — not a staggered ramp.
          if (++ready === count) for (const w of workers) w.postMessage("go");
          return;
        }
        runs.push(message);
        // A worker still listening on its port keeps the process alive, so the
        // last result is also the signal to tear the pool down.
        if (runs.length === count) {
          void Promise.all(workers.map((w) => w.terminate())).then(() => resolve(runs));
        }
      });
      worker.on("error", failAll);
      worker.on("exit", (code) => {
        if (code !== 0 && runs.length < count) failAll(new Error(`worker exited with code ${code}`));
      });
    }
  });
}

async function runWorker(durationMs: number): Promise<void> {
  // A worker thread starts without tsx's resolver, so register it before any
  // TypeScript module is imported — otherwise the core's own extensionless
  // relative imports fail to resolve here even though they resolve in the parent.
  const { register } = await import("tsx/esm/api");
  register();

  const workload = await loadWorkload();
  const core = workload.SignalGridCore.demo();
  const port = parentPort;
  if (!port) throw new Error("worker started without a parent port");

  port.on("message", (message: string) => {
    if (message !== "go") return;
    const run = measure(core, workload, durationMs);
    // Copy out of the subarray so the transferred buffer holds only the samples.
    const samples = Float64Array.from(run.samples);
    port.postMessage(
      { type: "done", ops: run.ops, elapsedMs: run.elapsedMs, samples, signature: run.signature },
      [samples.buffer],
    );
  });

  port.postMessage({ type: "ready" });
}

function numberFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Invalid --${name}=${raw}: expected a positive number.`);
    process.exit(1);
  }
  return value;
}

async function main(): Promise<void> {
  const seconds = numberFlag("seconds", DEFAULT_SECONDS);
  const cores = availableParallelism();
  const workerCount = Math.max(1, Math.round(numberFlag("workers", cores)));
  const durationMs = seconds * 1000;

  const workload = await loadWorkload();
  const core = workload.SignalGridCore.demo();

  console.log("Decision-throughput benchmark (public-safe, in-memory core, no I/O)");
  console.log(`Cores available: ${cores} | workers: ${workerCount} | window: ${seconds}s per stage`);
  console.log("");

  console.log("Stage 1 — one core, sustained");
  const single = measure(core, workload, durationMs);
  const singleRate = opsPerSec(single);
  console.log(`  decisions      ${single.ops.toLocaleString("en-US")} in ${(single.elapsedMs / 1000).toFixed(2)}s`);
  console.log(`  throughput     ${Math.round(singleRate).toLocaleString("en-US")} decisions/sec`);
  console.log("");

  console.log(`Stage 2 — ${workerCount} worker${workerCount === 1 ? "" : "s"}, saturated`);
  const runs = await saturate(workerCount, durationMs);
  const totalOps = runs.reduce((sum, r) => sum + r.ops, 0);
  const meanWindowMs = runs.reduce((sum, r) => sum + r.elapsedMs, 0) / runs.length;
  const aggregateRate = totalOps / (meanWindowMs / 1000);
  // Perfect scaling is workerCount×; anything less is contention, asymmetric
  // cores (an Apple-silicon P/E split costs most of it here), SMT, thermal
  // headroom or other work on the machine. Reported, never asserted.
  const efficiency = (aggregateRate / (singleRate * workerCount)) * 100;

  const merged: number[] = [];
  for (const run of runs) for (const sample of run.samples) merged.push(sample);
  merged.sort((a, b) => a - b);

  console.log(`  decisions      ${totalOps.toLocaleString("en-US")} in ${(meanWindowMs / 1000).toFixed(2)}s (mean window)`);
  console.log(`  throughput     ${Math.round(aggregateRate).toLocaleString("en-US")} decisions/sec aggregate`);
  console.log(`  per worker     ${Math.round(aggregateRate / workerCount).toLocaleString("en-US")} decisions/sec`);
  console.log(`  scaling        ${(aggregateRate / singleRate).toFixed(2)}x on ${workerCount} workers (${efficiency.toFixed(0)}% of linear)`);
  console.log("  service time under saturation:");
  console.log(`    p50  ${workload.percentile(merged, 50).toFixed(4)} ms`);
  console.log(`    p95  ${workload.percentile(merged, 95).toFixed(4)} ms`);
  console.log(`    p99  ${workload.percentile(merged, 99).toFixed(4)} ms`);
  console.log(`    max  ${(merged[merged.length - 1] ?? 0).toFixed(4)} ms`);
  console.log("");

  const failures: string[] = [];

  if (singleRate < FLOOR_OPS_PER_SEC) {
    failures.push(
      `single-core throughput ${singleRate.toFixed(2)}/sec is below the ${FLOOR_OPS_PER_SEC.toFixed(2)}/sec implied by the ${PILOT_GATE_P95_MS} ms p95 pilot gate`,
    );
  }
  if (workerCount > 1 && aggregateRate <= singleRate) {
    failures.push(
      `no parallel gain: ${workerCount} workers sustained ${Math.round(aggregateRate)}/sec against ${Math.round(singleRate)}/sec on one core`,
    );
  }
  const divergent = runs.filter((run) => run.signature !== single.signature).length;
  if (divergent > 0) {
    failures.push(
      `${divergent}/${runs.length} workers returned verdicts that differ from the single-threaded pass`,
    );
  }

  console.log("Gates: throughput floor (from the 750 ms p95 pilot gate), no parallel collapse, determinism under concurrency.");
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASS: ${Math.round(singleRate).toLocaleString("en-US")}/sec on one core (floor ${FLOOR_OPS_PER_SEC.toFixed(2)}/sec), ` +
      `${(aggregateRate / singleRate).toFixed(2)}x under saturation, identical verdicts on all ${runs.length} workers.`,
  );
  console.log("Absolute rates are hardware-specific and report-only; the decision core alone, no HTTP/connector/database.");
}

if (isMainThread) {
  await main();
} else {
  await runWorker((workerData as { durationMs: number }).durationMs);
}
