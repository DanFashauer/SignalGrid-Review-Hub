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
 * Method. One pool of worker threads is started, loaded and warmed, then held
 * at a barrier. The schedule is S0 P1 S1 P2 S2 P3 S3 (`--pairs`, default 3):
 * each S window releases ONE worker alone, each P window releases every
 * worker together, so the measured window is saturation and not thread
 * startup, and both sides of the comparison run in the same kind of thread.
 * Each worker reports its completions, elapsed time and per-op service times;
 * a P window's aggregate is summed over the mean worker window. Every window
 * is printed, with the time it lost to stalls (ops slower than 10x the
 * single-core median).
 *
 * Why bracketed pairs (2026-11-21, BUILD_BACKLOG "Decision-throughput
 * saturation gate fails ~1 in 7 hosted macOS slice-4 jobs"): the gate used to
 * judge one P window against one S window taken before it, and a hosted Intel
 * macOS VM starved for part of that one window (saturated p99 41–140 ms, max
 * stalls up to 543 ms in the ten decoded failures, against p99 ≈ 4 ms on the
 * 4-vCPU Linux runners) read as collapse. `throughput-judge.ts` holds the rule
 * and the fixtures that prove it, and runs them before every measurement.
 *
 * `--inject=lock` (every thread serialised on one fair ticket lock: genuine
 * contention, must FAIL) and `--inject=host-stall:<pair>` (busy threads over
 * one P window: transient host noise, must be attributed, not failed) are
 * demonstration modes and are never on by default. `--self-test` runs the
 * judge's fixtures only.
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
 *   • A floor derived from the ONE published figure (applied to every S window): the launch plan's pilot
 *     gate is p95 < 750 ms per decision, which is 1.33 decisions/sec on a
 *     single core. Sustained single-core throughput below that would mean the
 *     decision loop no longer meets the latency gate it already claims to.
 *     Measured headroom today is several thousand times this floor — the gate
 *     is a collapse detector (a sync network call, an O(n²) blowup), not a
 *     performance target, and it is set where it cannot flake on a busy runner.
 *   • No parallel collapse: N saturated cores must beat one core — pooled over
 *     the bracketed pairs, each P judged against the higher of the S windows on
 *     either side of it. Gaining literally nothing from N cores means
 *     contention on shared state, which is a defect regardless of the machine.
 *   • Determinism under concurrency: every worker must produce byte-identical
 *     verdicts to the single-threaded pass. Same input, same output, no matter
 *     how many threads are evaluating at once. This is the assertion worth
 *     having here — it is the fail-closed/deterministic rule of this repo tested
 *     under the one condition the proof suite never applies to it.
 *
 * Usage:
 *   pnpm run bench:decision-throughput
 *   pnpm run bench:decision-throughput -- --seconds=5 --workers=4 --pairs=3
 *   pnpm run bench:decision-throughput -- --seconds=2 --inject=lock   # must FAIL
 *   pnpm run bench:decision-throughput -- --self-test
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
/** Parallel windows per run, each bracketed by single-core windows: S0 P1 S1 P2 S2 P3 S3. */
const DEFAULT_PAIRS = 3;
/** `--inject=host-stall:<pair>` busy threads per core: enough to take most of the CPU from the measured workers. */
const HOG_THREADS_PER_CORE = 4;
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
  /** process.hrtime.bigint() at the first timed operation, as a decimal string (comparable across threads). */
  startNs: string;
}

type WorkerToMain =
  | { type: "ready" }
  | { type: "done"; ops: number; elapsedMs: number; samples: Float64Array; signature: string; startNs: string };

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

/**
 * Fingerprint the verdicts, then warm the loop up. Untimed, and done BEFORE a worker reports ready, so the
 * barrier below releases warmed workers and each timed window starts following the release, with its skew measured
 * and reported (the header's contract;
 * before 2026-11-19 the warm-up ran after the release, so each worker's window started whenever its own
 * warm-up ended — #2387).
 */
function prepare(core: Core, w: Workload): string {
  const signature = verdictSignature(core, w);
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[i % w.BENCH_SCENARIOS.length]);
  }
  return signature;
}

/** Run the prepared workload flat out for `durationMs`, timing every completion. */
function measure(core: Core, w: Workload, durationMs: number, signature: string, lock: Lock = null): Run {
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
    if (lock) {
      acquire(lock);
      try {
        core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[ops % w.BENCH_SCENARIOS.length]);
      } finally {
        release(lock);
      }
    } else {
      core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[ops % w.BENCH_SCENARIOS.length]);
    }
    now = process.hrtime.bigint();
    if (kept < MAX_SAMPLES) buffer[kept++] = Number(now - previous) / 1e6;
    previous = now;
    ops++;
    if (now >= deadline) break;
  }

  return { ops, elapsedMs: Number(now - start) / 1e6, samples: buffer.subarray(0, kept), signature, startNs: String(start) };
}

function opsPerSec(run: { ops: number; elapsedMs: number }): number {
  return run.ops / (run.elapsedMs / 1000);
}

/**
 * Optional FAIR (ticket) lock shared by every thread: `--inject=lock` serialises each evaluate on it, handing the
 * lock to the next ticket on every release — the shape real shared-state contention takes. Slot 0 is the next
 * ticket to issue, slot 1 the ticket now served. A barging mutex was tried first and measured at ≈1.0x (the
 * releasing thread re-takes it), which sits ON the gate's threshold; see BUILD_BACKLOG for the runs.
 */
type Lock = Int32Array | null;

function acquire(lock: Int32Array): void {
  const ticket = Atomics.add(lock, 0, 1);
  for (;;) {
    const serving = Atomics.load(lock, 1);
    if (serving === ticket) return;
    Atomics.wait(lock, 1, serving);
  }
}

function release(lock: Int32Array): void {
  Atomics.add(lock, 1, 1);
  Atomics.notify(lock, 1);
}

/**
 * A pool of `count` workers, each loaded AND warmed before the first release, reused for every parallel window so
 * pair 2 and pair 3 measure saturation, not thread startup.
 */
class Pool {
  private constructor(
    private readonly workers: Worker[],
    private pending: ((m: WorkerToMain & { type: "done" }) => void) | null,
    private failure: Error | null,
  ) {}

  static start(count: number, durationMs: number, lockBuffer: SharedArrayBuffer | null): Promise<Pool> {
    const workers: Worker[] = [];
    const pool = new Pool(workers, null, null);
    return new Promise<Pool>((resolve, reject) => {
      let ready = 0;
      const failAll = (error: unknown) => {
        pool.failure = error instanceof Error ? error : new Error(String(error));
        for (const worker of workers) void worker.terminate();
        reject(pool.failure);
      };
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL(import.meta.url), { workerData: { durationMs, lockBuffer } });
        workers.push(worker);
        worker.on("message", (message: WorkerToMain) => {
          if (message.type === "ready") {
            if (++ready === count) resolve(pool);
            return;
          }
          pool.pending?.(message);
        });
        worker.on("error", failAll);
        worker.on("exit", (code) => {
          if (code !== 0 && !pool.closing) failAll(new Error(`worker exited with code ${code}`));
        });
      }
    });
  }

  private closing = false;

  /**
   * Release the first `count` workers together for one timed window (all of them by default). `run(1)` is the
   * single-core window: the same kind of thread, isolate and JIT state as the parallel windows, so the two sides
   * of the comparison differ only in how many threads run.
   */
  run(count = this.workers.length): Promise<{ runs: Run[]; releaseNs: bigint }> {
    if (this.failure) return Promise.reject(this.failure);
    const released = this.workers.slice(0, count);
    return new Promise((resolve) => {
      const runs: Run[] = [];
      this.pending = (message) => {
        runs.push(message);
        if (runs.length === released.length) {
          this.pending = null;
          resolve({ runs, releaseNs });
        }
      };
      // Release only once every worker is loaded and warm, so the measured
      // window is N threads running at once — not a staggered ramp.
      const releaseNs = process.hrtime.bigint();
      for (const w of released) w.postMessage("go");
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

/**
 * `--inject=host-stall:<pair>`: hold `count` busy-looping threads for the whole of that pair's parallel window — a
 * noisy neighbour on demand. The hogs evaluate nothing; they only take CPU from the measured workers, the way a
 * starved hosted VM does. Demonstration only, never on by default.
 */
function startHogs(count: number, ms: number): Worker[] {
  const code =
    "const { workerData } = require('node:worker_threads');" +
    "const end = process.hrtime.bigint() + BigInt(workerData.ms) * 1000000n;" +
    "let x = 0; while (process.hrtime.bigint() < end) { x = (x + 1) | 0; }";
  return Array.from({ length: count }, () => new Worker(code, { eval: true, workerData: { ms } }));
}

async function runWorker(durationMs: number, lockBuffer: SharedArrayBuffer | null): Promise<void> {
  // A worker thread starts without tsx's resolver, so register it before any
  // TypeScript module is imported — otherwise the core's own extensionless
  // relative imports fail to resolve here even though they resolve in the parent.
  const { register } = await import("tsx/esm/api");
  register();

  const workload = await loadWorkload();
  const core = workload.SignalGridCore.demo();
  const port = parentPort;
  if (!port) throw new Error("worker started without a parent port");
  const lock: Lock = lockBuffer ? new Int32Array(lockBuffer) : null;
  // Warm before reporting ready, so each timed window starts following the release (skew measured), not after a
  // staggered warm-up.
  const signature = prepare(core, workload);

  port.on("message", (message: string) => {
    if (message !== "go") return;
    const run = measure(core, workload, durationMs, signature, lock);
    // Copy out of the subarray so the transferred buffer holds only the samples.
    const samples = Float64Array.from(run.samples);
    port.postMessage(
      { type: "done", ops: run.ops, elapsedMs: run.elapsedMs, samples, signature: run.signature, startNs: run.startNs },
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

function stringFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** Time a window spent in operations slower than `thresholdMs` — a stall, not a decision. */
function stalledMs(samples: ArrayLike<number>, thresholdMs: number): number {
  let total = 0;
  for (let i = 0; i < samples.length; i++) if (samples[i] > thresholdMs) total += samples[i];
  return total;
}

function sortedCopy(samples: ArrayLike<number>): number[] {
  return Array.from(samples).sort((a, b) => a - b);
}

async function main(): Promise<void> {
  const judge = await import("./throughput-judge.js");
  // The judge proves itself before any measurement is trusted: if it cannot fail on recorded contention it
  // cannot gate anything. Pure, no timing — microseconds.
  const judgeFailures = judge.judgeSelfTest();
  if (process.argv.includes("--self-test")) {
    for (const f of judgeFailures) console.error(`FAIL: ${f}`);
    console.log(
      judgeFailures.length === 0
        ? `Collapse-judge self-test: ${judge.JUDGE_FIXTURES.length} fixtures and 5 malformed inputs classified correctly.`
        : `Collapse-judge self-test FAILED: ${judgeFailures.length} problem(s).`,
    );
    process.exitCode = judgeFailures.length === 0 ? 0 : 1;
    return;
  }
  if (judgeFailures.length > 0) {
    for (const f of judgeFailures) console.error(`FAIL: collapse judge self-test: ${f}`);
    process.exitCode = 1;
    return;
  }

  const seconds = numberFlag("seconds", DEFAULT_SECONDS);
  const pairCount = Math.max(1, Math.round(numberFlag("pairs", DEFAULT_PAIRS)));
  const cores = availableParallelism();
  const workerCount = Math.max(1, Math.round(numberFlag("workers", cores)));
  const durationMs = seconds * 1000;

  const inject = stringFlag("inject");
  let lockBuffer: SharedArrayBuffer | null = null;
  let hogPair = 0;
  if (inject !== undefined) {
    const hog = /^host-stall:(\d+)$/.exec(inject);
    if (inject === "lock") lockBuffer = new SharedArrayBuffer(8);
    else if (hog && Number(hog[1]) >= 1 && Number(hog[1]) <= pairCount) hogPair = Number(hog[1]);
    else {
      console.error(`Invalid --inject=${inject}: expected "lock" or "host-stall:<pair 1..${pairCount}>".`);
      process.exit(1);
    }
  }

  const workload = await loadWorkload();
  const core = workload.SignalGridCore.demo();

  console.log("Decision-throughput benchmark (public-safe, in-memory core, no I/O)");
  console.log(
    `Cores available: ${cores} | workers: ${workerCount} | window: ${seconds}s | schedule: S0` +
      Array.from({ length: pairCount }, (_, i) => ` P${i + 1} S${i + 1}`).join("") +
      ` (${pairCount} pair${pairCount === 1 ? "" : "s"}, each parallel window bracketed by single-core windows)`,
  );
  if (inject) {
    console.log(
      `INJECTED: ${lockBuffer ? "every thread serialised on one shared lock (genuine contention)" : `${HOG_THREADS_PER_CORE * cores} CPU-hog threads over P${hogPair} only (transient host noise)`}` +
        " — a demonstration run, not a measurement of the core.",
    );
  }
  console.log("");

  const signature = prepare(core, workload);
  const pool = await Pool.start(workerCount, durationMs, lockBuffer);

  const singles: Run[] = [];
  const parallels: Array<{ runs: Run[]; releaseNs: bigint; aggregateRate: number; meanWindowMs: number; totalOps: number }> = [];
  const single = async () => (await pool.run(1)).runs[0];
  try {
    singles.push(await single());
    for (let pair = 1; pair <= pairCount; pair++) {
      const hogs = pair === hogPair ? startHogs(HOG_THREADS_PER_CORE * cores, durationMs + 250) : [];
      const { runs, releaseNs } = await pool.run();
      await Promise.all(hogs.map((h) => h.terminate()));
      const totalOps = runs.reduce((sum, r) => sum + r.ops, 0);
      const meanWindowMs = runs.reduce((sum, r) => sum + r.elapsedMs, 0) / runs.length;
      parallels.push({ runs, releaseNs, totalOps, meanWindowMs, aggregateRate: totalOps / (meanWindowMs / 1000) });
      singles.push(await single());
    }
  } finally {
    await pool.close();
  }

  const singleRates = singles.map(opsPerSec);
  const verdict = judge.judgePairs(singleRates, parallels.map((p) => p.aggregateRate));

  // A stall is an operation slower than 10x the median single-core service time. Reported, never asserted: it
  // is how a reader tells a starved host (median near single-core, time lost in long gaps) from contention (every
  // operation slower). It is NOT used to excuse a pair — the judge alone decides.
  const singleMedianMs = workload.percentile(sortedCopy(singles.flatMap((s) => Array.from(s.samples))), 50);
  const stallThresholdMs = 10 * singleMedianMs;

  console.log("Single-core windows (worker 1 alone; the other workers idle at the barrier)");
  singles.forEach((s, i) => {
    const stall = stalledMs(s.samples, stallThresholdMs);
    console.log(
      `  S${i}  ${s.ops.toLocaleString("en-US").padStart(9)} in ${(s.elapsedMs / 1000).toFixed(2)}s  ${Math.round(singleRates[i]).toLocaleString("en-US").padStart(7)}/sec` +
        `  stalled ${stall.toFixed(0)} ms (${((stall / s.elapsedMs) * 100).toFixed(1)}%)`,
    );
  });
  console.log("");

  console.log(`Parallel windows — ${workerCount} worker${workerCount === 1 ? "" : "s"}, saturated`);
  parallels.forEach((p, i) => {
    const j = verdict.pairs[i];
    const starts = p.runs.map((r) => BigInt(r.startNs));
    const firstStart = starts.reduce((a, b) => (b < a ? b : a));
    const lastStart = starts.reduce((a, b) => (b > a ? b : a));
    const merged = sortedCopy(p.runs.flatMap((r) => Array.from(r.samples)));
    const stallPerWorker = p.runs.reduce((sum, r) => sum + stalledMs(r.samples, stallThresholdMs), 0) / p.runs.length;
    console.log(
      `  P${j.pair}  ${p.totalOps.toLocaleString("en-US").padStart(9)} in ${(p.meanWindowMs / 1000).toFixed(2)}s  ${Math.round(p.aggregateRate).toLocaleString("en-US").padStart(7)}/sec aggregate` +
        `  vs max(S${i}, S${i + 1}) = ${Math.round(j.reference).toLocaleString("en-US")}/sec  →  ${j.ratio.toFixed(2)}x  ${j.collapsed ? "COLLAPSED" : "gain"}`,
    );
    console.log(
      `      per worker ${Math.round(p.aggregateRate / workerCount).toLocaleString("en-US")}/sec (${((p.aggregateRate / (j.reference * workerCount)) * 100).toFixed(0)}% of linear)` +
        `  p50 ${workload.percentile(merged, 50).toFixed(4)} ms (single-core p50 ${singleMedianMs.toFixed(4)} ms)` +
        `  p95 ${workload.percentile(merged, 95).toFixed(4)}  p99 ${workload.percentile(merged, 99).toFixed(4)}  max ${(merged[merged.length - 1] ?? 0).toFixed(4)} ms`,
    );
    console.log(
      `      stalled ${stallPerWorker.toFixed(0)} ms per worker (${((stallPerWorker / p.meanWindowMs) * 100).toFixed(1)}% of the window, ops > ${stallThresholdMs.toFixed(2)} ms)` +
        `  window starts ${(Number(lastStart - firstStart) / 1e6).toFixed(3)} ms apart; last began ${(Number(lastStart - p.releaseNs) / 1e6).toFixed(3)} ms after the release`,
    );
  });
  console.log("");

  const failures: string[] = [];
  const minSingle = Math.min(...singleRates);
  if (minSingle < FLOOR_OPS_PER_SEC) {
    failures.push(
      `single-core throughput ${minSingle.toFixed(2)}/sec (lowest of ${singleRates.length} windows) is below the ${FLOOR_OPS_PER_SEC.toFixed(2)}/sec implied by the ${PILOT_GATE_P95_MS} ms p95 pilot gate`,
    );
  }
  // The parallel-collapse gate is genuinely VACUOUS at one worker — there is no
  // parallelism to collapse. That is fine; what was not fine is that the summary line
  // below announced it as one of the gates unconditionally, so a single-core runner
  // printed "no parallel collapse" for a property that had not been exercised. A check
  // that did not run must never be reported as a check that passed.
  const parallelCollapseExercised = workerCount > 1;
  if (parallelCollapseExercised && verdict.fail) {
    failures.push(
      `no parallel gain: pooled over ${pairCount} bracketed pair${pairCount === 1 ? "" : "s"} the ${workerCount} workers sustained ${verdict.pooledRatio.toFixed(2)}x one core (` +
        verdict.pairs.map((p) => `P${p.pair} ${Math.round(p.parallel)}/sec vs ${Math.round(p.reference)}/sec`).join(", ") +
        `; ${verdict.collapsedPairs}/${pairCount} pairs collapsed)`,
    );
  }
  if (parallelCollapseExercised && verdict.transient) {
    const lost = verdict.pairs.filter((p) => p.collapsed).map((p) => `P${p.pair} (${p.ratio.toFixed(2)}x)`);
    const gained = verdict.pairs.filter((p) => !p.collapsed).map((p) => `P${p.pair} (${p.ratio.toFixed(2)}x)`);
    console.log(
      `HOST INTERFERENCE (reported, not hidden): ${lost.join(", ")} collapsed while ${gained.join(", ")} gained on the same code in the same process; pooled ${verdict.pooledRatio.toFixed(2)}x. ` +
        "Contention drags every pair; a pair outvoted by the others is a property of the host at that moment.",
    );
  }
  if (parallelCollapseExercised) {
    console.log(
      `First-pair-only rule (the gate before 2026-11-21, P1 against S0): ${verdict.firstPairOnlyRuleFails ? "would FAIL" : "would pass"}.`,
    );
  }
  let divergent = 0;
  let workerRuns = 0;
  for (const p of parallels) {
    for (const run of p.runs) {
      workerRuns++;
      if (run.signature !== signature) divergent++;
    }
  }
  if (divergent > 0) {
    failures.push(`${divergent}/${workerRuns} worker windows returned verdicts that differ from the single-threaded pass`);
  }

  console.log(
    "Gates: throughput floor (from the 750 ms p95 pilot gate) on every single-core window, " +
      (parallelCollapseExercised
        ? `no parallel collapse (exercised at ${workerCount} workers over ${pairCount} bracketed pair${pairCount === 1 ? "" : "s"}; fails when the pooled ratio is ≤ 1x)`
        : "no parallel collapse: NOT EXERCISED — 1 worker on this machine, so the property was not tested") +
      ", determinism under concurrency.",
  );
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}.`);
    process.exitCode = 1;
    return;
  }
  const best = verdict.pairs.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  console.log(
    `PASS: ${Math.round(minSingle).toLocaleString("en-US")}–${Math.round(Math.max(...singleRates)).toLocaleString("en-US")}/sec on one core (floor ${FLOOR_OPS_PER_SEC.toFixed(2)}/sec), ` +
      `${verdict.pooledRatio.toFixed(2)}x pooled under saturation (${verdict.pairs.map((p) => `P${p.pair} ${p.ratio.toFixed(2)}x`).join(", ")}; best P${best.pair})` +
      (parallelCollapseExercised ? "" : " (1 worker — scaling not exercised)") +
      `, identical verdicts in all ${workerRuns} worker windows.`,
  );
  console.log("Absolute rates are hardware-specific and report-only; the decision core alone, no HTTP/connector/database.");
}

if (isMainThread) {
  await main();
} else {
  const data = workerData as { durationMs: number; lockBuffer: SharedArrayBuffer | null };
  await runWorker(data.durationMs, data.lockBuffer);
}
