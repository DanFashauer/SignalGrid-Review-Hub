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
 * 4-vCPU Linux runners) read as collapse. Those numbers fit a starved VM but do
 * not prove one; the cause of the hosted failures is NOT established here.
 * `throughput-judge.ts` holds the rule
 * and the fixtures that prove it, and runs them before every measurement.
 *
 * Demonstration modes, never on by default: `--inject=lock` (every thread
 * serialised on one fair ticket lock in every window: must FAIL),
 * `--inject=intermittent-lock:<pair>` (the same lock in one P window only) and
 * `--inject=host-stall:<pair>` (busy threads over one P window). The last two
 * give the same kind of mixed result — one pair collapses, the others gain —
 * from causes inside and outside the process, which is why a mixed result is
 * reported as MIXED WINDOWS with its cause NOT determined. `--self-test` runs
 * the self-tests only.
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
 *     under the one condition the proof suite never applies to it. Checked
 *     twice: each window's pre-release fingerprint against the main thread's,
 *     and EVERY timed verdict against its scenario's line, inside the timed
 *     loop (#2484 — before 2026-11-21 the timed verdicts were discarded, so a
 *     thread that diverged only under saturation passed). `--inject=
 *     diverge-after-release` must FAIL; a fixture through the real measure/gate
 *     boundary runs before every measurement.
 *
 * Every run ends with one `BENCH-RECORD {json}` line of public-safe figures,
 * which scripts/preflight.mjs echoes into its log so passing runs keep them.
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
  /** Verdict fingerprint of the scenario set, taken before the release — must not vary with thread count. */
  signature: string;
  /** Timed operations whose OWN verdict differed from the fingerprint line for its scenario. */
  divergentOps: number;
  /** The first such operation, for the failure message. */
  firstDivergence: string | null;
  /** 1-based pool worker that produced the window (0 for the main thread). */
  worker?: number;
  /** process.hrtime.bigint() at the first timed operation, as a decimal string (comparable across threads). */
  startNs: string;
}

type WorkerToMain =
  | { type: "ready" }
  | ({ type: "done" } & Run);

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

type Decision = ReturnType<Core["evaluate"]>;

/**
 * The stable projection of one decision: every field of the public `EvaluateResult` a caller would act on, compared
 * for EVERY timed verdict, serialised as JSON so no two different results can produce the same string. Matched rules
 * are compared whole — `ruleId`, `reasonCode`, `outcome` and `severity` (`MatchedRule`, signalgrid-core types.ts) —
 * and `explanation` is included. Excluded, as per-decision identity or timing that is not expected to repeat from one
 * call to the next on the same core: `decisionId` and `evidenceSnapshotId` (both derived from a per-evaluation
 * sequence number, decision.ts and evidence.ts) and `latencyMs` (a measured duration). Any OTHER field fails the
 * startup check (`unclassifiedFields`), so a field added to the result later cannot go unchecked silently.
 */
const PROJECTED_FIELDS = [
  "outcome",
  "reasonCodes",
  "policyId",
  "policyVersion",
  "policyVersionId",
  "matchedRules",
  "reviewable",
  "explanation",
  "coreNormalizationVersion",
] as const;
const EXCLUDED_FIELDS = ["decisionId", "evidenceSnapshotId", "latencyMs"] as const;

function decisionLine(r: Decision): string {
  return JSON.stringify([
    r.outcome,
    r.reasonCodes,
    r.policyId,
    r.policyVersion,
    r.policyVersionId,
    r.matchedRules.map((m) => [m.ruleId, m.reasonCode, m.outcome, m.severity]),
    r.reviewable,
    r.explanation,
    r.coreNormalizationVersion ?? "unstamped",
  ]);
}

/** Fields of a result (or of one of its matched rules) that are neither projected nor excluded. Fail-closed. */
function unclassifiedFields(r: Decision): string[] {
  const known = new Set<string>([...PROJECTED_FIELDS, ...EXCLUDED_FIELDS]);
  const rule = new Set(["ruleId", "reasonCode", "outcome", "severity"]);
  return [
    ...Object.keys(r).filter((k) => !known.has(k)),
    ...r.matchedRules.flatMap((m) => Object.keys(m).filter((k) => !rule.has(k)).map((k) => `matchedRules[].${k}`)),
  ];
}

/**
 * The pre-release fingerprint of a FRESH core: each scenario's decision line plus its `evidenceSnapshotId`. The id is
 * kept here because two fresh cores producing their first decisions must agree on it (cross-core determinism of
 * ids); it is dropped from the per-call comparison above because the sequence number moves it on every call.
 */
interface Fingerprint {
  signature: string;
  /** decisionLine per scenario index: what every timed verdict is checked against. */
  expected: readonly string[];
}

function fingerprint(core: Core, w: Workload): Fingerprint {
  const lines = w.BENCH_SCENARIOS.map((scenario) => core.evaluate(w.BENCH_OPERATOR, scenario));
  const unknown = [...new Set(lines.flatMap(unclassifiedFields))];
  if (unknown.length > 0) {
    throw new Error(`decision result carries field(s) neither compared nor excluded: ${unknown.join(", ")} — classify them in throughput-bench.ts`);
  }
  return {
    signature: lines.map((r) => `${decisionLine(r)} ${r.evidenceSnapshotId}`).join("\n"),
    expected: lines.map(decisionLine),
  };
}

/**
 * Fingerprint the verdicts, then warm the loop up. Untimed, and done BEFORE a worker reports ready, so the
 * barrier below releases warmed workers and each timed window starts following the release, with its skew measured
 * and reported (the header's contract;
 * before 2026-11-19 the warm-up ran after the release, so each worker's window started whenever its own
 * warm-up ended — #2387).
 */
function prepare(core: Core, w: Workload): Fingerprint {
  const print = fingerprint(core, w);
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[i % w.BENCH_SCENARIOS.length]);
  }
  return print;
}

/**
 * Run the prepared workload flat out for `durationMs`, timing every completion AND checking every timed verdict
 * against the pre-release fingerprint line for its scenario (#2484: before 2026-11-21 the timed verdicts were
 * discarded and only the fingerprint taken before the release was compared, so a thread whose verdicts diverged
 * only under saturation passed). The check is inside the timed loop, so its cost is charged to the op it belongs
 * to — and it is charged EQUALLY in single-core and parallel windows, because both are this same function running
 * in a pool worker (S windows release worker 1 alone, P windows release every worker).
 */
function measure(core: Core, w: Workload, durationMs: number, print: Fingerprint, lock: Lock = null): Run {
  const { signature, expected } = print;
  const n = w.BENCH_SCENARIOS.length;
  const buffer = new Float64Array(MAX_SAMPLES);
  const start = process.hrtime.bigint();
  const deadline = start + BigInt(Math.round(durationMs * 1e6));
  let previous = start;
  let kept = 0;
  let ops = 0;
  let divergentOps = 0;
  let firstDivergence: string | null = null;
  let now = start;

  // One hrtime read per iteration serves as both the service-time sample and
  // the deadline check, so the measurement overhead is charged honestly to the
  // op it belongs to rather than being hidden between iterations.
  while (true) {
    const index = ops % n;
    let r: Decision;
    if (lock) {
      acquire(lock);
      try {
        r = core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[index]);
      } finally {
        release(lock);
      }
    } else {
      r = core.evaluate(w.BENCH_OPERATOR, w.BENCH_SCENARIOS[index]);
    }
    const line = decisionLine(r);
    if (line !== expected[index]) {
      divergentOps++;
      firstDivergence ??= `op ${ops} (scenario ${index}): got "${line}", expected "${expected[index]}"`;
    }
    now = process.hrtime.bigint();
    if (kept < MAX_SAMPLES) buffer[kept++] = Number(now - previous) / 1e6;
    previous = now;
    ops++;
    if (now >= deadline) break;
  }

  return {
    ops,
    elapsedMs: Number(now - start) / 1e6,
    samples: buffer.subarray(0, kept),
    signature,
    divergentOps,
    firstDivergence,
    startNs: String(start),
  };
}

/**
 * The determinism gate: every window's pre-release fingerprint must equal the main thread's, and no timed verdict
 * in any window may differ from it. Returns failure messages; empty passes.
 */
function determinismFailures(reference: string, windows: ReadonlyArray<{ label: string; run: Run }>): string[] {
  const failures: string[] = [];
  const startup = windows.filter((x) => x.run.signature !== reference);
  if (startup.length > 0) {
    failures.push(`${startup.length}/${windows.length} windows started from verdicts that differ from the single-threaded pass (${startup.map((x) => x.label).join(", ")})`);
  }
  const timed = windows.filter((x) => x.run.divergentOps > 0);
  if (timed.length > 0) {
    const total = timed.reduce((a, x) => a + x.run.divergentOps, 0);
    failures.push(
      `${total} timed verdict${total === 1 ? "" : "s"} in ${timed.length}/${windows.length} windows differed from the single-threaded pass ` +
        `(first: ${timed[0].label} ${timed[0].run.firstDivergence})`,
    );
  }
  return failures;
}

type Mutation = (r: Decision) => Decision;

/** Flip the verdict outcome. */
const flipOutcome: Mutation = (r) => ({ ...r, outcome: r.outcome === "deny" ? "allow" : "deny" });

/**
 * One mutation per stable field the projection covers beyond `outcome`, each altering ONLY that field, so every one
 * is a separate negative: the determinism gate must catch each on its own.
 */
const FIELD_MUTATIONS: ReadonlyArray<{ field: string; mutate: Mutation }> = [
  { field: "outcome", mutate: flipOutcome },
  { field: "reasonCodes", mutate: (r) => ({ ...r, reasonCodes: [...r.reasonCodes, "INJECTED"] }) },
  { field: "policyVersion", mutate: (r) => ({ ...r, policyVersion: r.policyVersion + 1 }) },
  { field: "reviewable", mutate: (r) => ({ ...r, reviewable: !r.reviewable }) },
  { field: "explanation", mutate: (r) => ({ ...r, explanation: `${r.explanation} ` }) },
  { field: "coreNormalizationVersion", mutate: (r) => ({ ...r, coreNormalizationVersion: (r.coreNormalizationVersion ?? 0) + 1 }) },
  { field: "matchedRules[].ruleId", mutate: (r) => ({ ...r, matchedRules: r.matchedRules.map((m, i) => (i === 0 ? { ...m, ruleId: `${m.ruleId}-x` } : m)) }) },
  { field: "matchedRules[].reasonCode", mutate: (r) => ({ ...r, matchedRules: r.matchedRules.map((m, i) => (i === 0 ? { ...m, reasonCode: `${m.reasonCode}_X` } : m)) }) },
  { field: "matchedRules[].outcome", mutate: (r) => ({ ...r, matchedRules: r.matchedRules.map((m, i) => (i === 0 ? { ...m, outcome: m.outcome === "deny" ? "allow" : "deny" } : m)) }) },
  { field: "matchedRules[].severity", mutate: (r) => ({ ...r, matchedRules: r.matchedRules.map((m, i) => (i === 0 ? { ...m, severity: m.severity === "critical" ? "low" : "critical" } : m)) }) },
];

/** A core whose results are mutated after `after` calls — divergence that begins inside a timed window. Fixture only. */
function divergingAfter(core: Core, after: number, mutate: Mutation = flipOutcome): Core {
  let calls = 0;
  const evaluate = core.evaluate.bind(core);
  return new Proxy(core, {
    get(target, key, receiver) {
      if (key !== "evaluate") return Reflect.get(target, key, receiver);
      return (...args: Parameters<Core["evaluate"]>) => {
        const r = evaluate(...args);
        return ++calls > after ? mutate(r) : r;
      };
    },
  });
}

/**
 * The determinism gate proves itself through the REAL measure/gate boundary before any run is trusted: for each
 * stable field, a core whose fingerprint matches at startup but which alters ONLY that field inside the timed window
 * must fail; the unchanged core must pass; and a result carrying an unclassified field must be refused at startup.
 * Main thread, ~(1 + fields) × 30 ms.
 */
function determinismSelfTest(core: Core, w: Workload): string[] {
  const print = fingerprint(core, w);
  const problems: string[] = [];
  // The fingerprint above came from the real core — exactly what the startup check of a diverging worker sees —
  // and each diverging core alters its field from its first timed call.
  for (const { field, mutate } of FIELD_MUTATIONS) {
    const negative = determinismFailures(print.signature, [{ label: field, run: measure(divergingAfter(core, 0, mutate), w, 30, print) }]);
    if (negative.length === 0) problems.push(`a core that alters only \`${field}\` inside the timed window passed the determinism gate`);
  }
  const control = determinismFailures(print.signature, [{ label: "control", run: measure(core, w, 60, print) }]);
  if (control.length > 0) problems.push(`the unchanged core failed the determinism gate: ${control.join("; ")}`);
  let refused = false;
  try {
    fingerprint(divergingAfter(core, 0, (r) => ({ ...r, unexpectedField: 1 }) as Decision), w);
  } catch {
    refused = true;
  }
  if (!refused) problems.push("a result carrying an unclassified field was fingerprinted instead of refused");
  return problems;
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
  private closing = false;
  private failure: Error | null = null;
  /** The window in flight: its result collector and its rejection, so a worker failure settles it. */
  private active: { collect: (m: Run) => void; reject: (e: Error) => void } | null = null;

  private constructor(private readonly workers: Worker[]) {}

  /**
   * `divergeWorker`: the 0-based worker whose timed verdicts flip (`--inject=diverge-after-release`), or -1.
   * `failWorker`: the 0-based worker that throws on its first release (the pool self-test), or -1.
   */
  static start(count: number, durationMs: number, lockBuffer: SharedArrayBuffer | null, divergeWorker = -1, failWorker = -1): Promise<Pool> {
    const workers: Worker[] = [];
    const pool = new Pool(workers);
    return new Promise<Pool>((resolve, reject) => {
      let ready = 0;
      // A worker failure BEFORE readiness rejects start; AFTER readiness it rejects the window in flight (start has
      // already settled, so rejecting it there would be lost and the awaited window would hang). Either way every
      // worker is told to terminate; the caller's finally still awaits close() for the owned teardown.
      const failAll = (error: unknown) => {
        if (pool.closing) return;
        pool.failure ??= error instanceof Error ? error : new Error(String(error));
        for (const worker of workers) void worker.terminate();
        reject(pool.failure);
        const active = pool.active;
        pool.active = null;
        active?.reject(pool.failure);
      };
      for (let i = 0; i < count; i++) {
        const worker = new Worker(new URL(import.meta.url), {
          workerData: { durationMs, lockBuffer, divergeAfterRelease: i === divergeWorker, failOnGo: i === failWorker, worker: i + 1 },
        });
        workers.push(worker);
        worker.on("message", (message: WorkerToMain) => {
          if (message.type === "ready") {
            if (++ready === count) resolve(pool);
            return;
          }
          pool.active?.collect(message);
        });
        worker.on("error", failAll);
        // Any exit we did not ask for is a failure, code 0 included: a worker gone mid-window never reports.
        worker.on("exit", (code) => failAll(new Error(`worker ${i + 1} exited with code ${code}`)));
      }
    });
  }

  /**
   * Release the first `count` workers together for one timed window (all of them by default). `run(1)` is the
   * single-core window: the same kind of thread, isolate and JIT state as the parallel windows, so the two sides
   * of the comparison differ only in how many threads run. `locked` serialises every evaluate in this window on
   * the shared lock (`--inject=lock` / `--inject=intermittent-lock:<pair>`).
   */
  run(count = this.workers.length, locked = false): Promise<{ runs: Run[]; releaseNs: bigint }> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.active) return Promise.reject(new Error("Pool.run: a window is already in flight"));
    const released = this.workers.slice(0, count);
    return new Promise((resolve, reject) => {
      const runs: Run[] = [];
      const releaseNs = process.hrtime.bigint();
      this.active = {
        collect: (message) => {
          runs.push(message);
          if (runs.length === released.length) {
            this.active = null;
            resolve({ runs, releaseNs });
          }
        },
        reject,
      };
      // Release only once every worker is loaded and warm, so the measured
      // window is N threads running at once — not a staggered ramp.
      for (const w of released) w.postMessage(locked ? "go+lock" : "go");
    });
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

/** Reject `promise` if it has not settled after `ms` — a self-test must report a hang, not become one. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The pool proves its failure path before any run is trusted: a worker that throws AFTER readiness must reject the
 * window in flight and the pool must still close; a normal one-worker window must resolve and close. ~1-2 s (two
 * one-worker pools load the core).
 */
async function poolSelfTest(): Promise<string[]> {
  const problems: string[] = [];
  const failing = await within(Pool.start(1, 30, null, -1, 0), 30_000, "failing pool start");
  try {
    await within(failing.run(), 10_000, "a window whose worker failed after readiness");
    problems.push("a worker that threw after readiness did not reject the window in flight");
  } catch (error) {
    if (String(error).includes("did not settle")) problems.push(String(error));
  } finally {
    await within(failing.close(), 10_000, "failing pool teardown").catch((e) => problems.push(String(e)));
  }
  const normal = await within(Pool.start(1, 30, null), 30_000, "control pool start");
  try {
    const { runs } = await within(normal.run(), 10_000, "control window");
    if (runs.length !== 1 || runs[0].ops < 1) problems.push(`control window returned ${runs.length} run(s)`);
  } catch (error) {
    problems.push(`control window failed: ${String(error)}`);
  } finally {
    await within(normal.close(), 10_000, "control pool teardown").catch((e) => problems.push(String(e)));
  }
  return problems;
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

async function runWorker(
  durationMs: number,
  lockBuffer: SharedArrayBuffer | null,
  divergeAfterRelease: boolean,
  failOnGo: boolean,
  worker: number,
): Promise<void> {
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
  const print = prepare(core, workload);
  // `--inject=diverge-after-release`: this worker's fingerprint above was taken from the real core, so the startup
  // check matches; its verdicts flip only from the 100th call inside the released windows.
  const timedCore = divergeAfterRelease ? divergingAfter(core, 100) : core;

  port.on("message", (message: string) => {
    if (message !== "go" && message !== "go+lock") return;
    if (failOnGo) throw new Error(`injected failure in worker ${worker} after readiness`);
    const run = measure(timedCore, workload, durationMs, print, message === "go+lock" ? lock : null);
    // Copy out of the subarray so the transferred buffer holds only the samples.
    const samples = Float64Array.from(run.samples);
    port.postMessage({ type: "done", ...run, samples, worker }, [samples.buffer]);
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
  const workload = await loadWorkload();
  // The gates prove themselves before any measurement is trusted: the collapse judge against recorded runs (pure,
  // microseconds), the determinism gate against a core that diverges only inside a timed window (real measure/gate
  // boundary, ~120 ms), and the pool's failure path (a worker failing after readiness must reject the window in
  // flight and still tear down; ~1-2 s). A gate that cannot fail cannot gate anything.
  const selfTestFailures = [
    ...judge.judgeSelfTest().map((f) => `collapse judge: ${f}`),
    // Its own core: the fixture's decisions advance the per-evaluation sequence, and the measured run's
    // fingerprint must come from a FRESH core to match the workers'.
    ...determinismSelfTest(workload.SignalGridCore.demo(), workload).map((f) => `determinism gate: ${f}`),
    ...(await poolSelfTest()).map((f) => `worker pool: ${f}`),
  ];
  if (process.argv.includes("--self-test")) {
    for (const f of selfTestFailures) console.error(`FAIL: ${f}`);
    console.log(
      selfTestFailures.length === 0
        ? `Throughput-bench self-test: collapse judge (${judge.JUDGE_FIXTURES.length} fixtures, 5 malformed inputs) and determinism gate (${FIELD_MUTATIONS.length} single-field timed-window divergences fail, control passes, unclassified field refused) and worker pool (failure after readiness rejects the window and tears down, control resolves) classified correctly.`
        : `Throughput-bench self-test FAILED: ${selfTestFailures.length} problem(s).`,
    );
    process.exitCode = selfTestFailures.length === 0 ? 0 : 1;
    return;
  }
  if (selfTestFailures.length > 0) {
    for (const f of selfTestFailures) console.error(`FAIL: self-test: ${f}`);
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
  let lockEveryWindow = false;
  let lockPair = 0;
  let hogPair = 0;
  let divergeWorker = -1;
  if (inject !== undefined) {
    const hog = /^host-stall:(\d+)$/.exec(inject);
    const intermittent = /^intermittent-lock:(\d+)$/.exec(inject);
    if (inject === "lock") {
      lockBuffer = new SharedArrayBuffer(8);
      lockEveryWindow = true;
    }
    // In-code serialisation exercised in ONE parallel window only: a cause inside the process that produces the same
    // mixed rates a starved host does. The control that keeps the mixed result neutral.
    else if (intermittent && Number(intermittent[1]) >= 1 && Number(intermittent[1]) <= pairCount) {
      lockBuffer = new SharedArrayBuffer(8);
      lockPair = Number(intermittent[1]);
    }
    // The LAST worker: single-core windows release worker 1 alone, so with more than one worker the divergence is
    // confined to the parallel windows, the condition #2484 says went unchecked.
    else if (inject === "diverge-after-release") divergeWorker = workerCount - 1;
    else if (hog && Number(hog[1]) >= 1 && Number(hog[1]) <= pairCount) hogPair = Number(hog[1]);
    else {
      console.error(`Invalid --inject=${inject}: expected "lock", "diverge-after-release", "intermittent-lock:<pair 1..${pairCount}>" or "host-stall:<pair 1..${pairCount}>".`);
      process.exit(1);
    }
  }

  console.log("Decision-throughput benchmark (public-safe, in-memory core, no I/O)");
  console.log(
    `Cores available: ${cores} | workers: ${workerCount} | window: ${seconds}s | schedule: S0` +
      Array.from({ length: pairCount }, (_, i) => ` P${i + 1} S${i + 1}`).join("") +
      ` (${pairCount} pair${pairCount === 1 ? "" : "s"}, each parallel window bracketed by single-core windows)`,
  );
  if (inject) {
    console.log(
      `INJECTED: ${
        lockEveryWindow
          ? "every thread serialised on one shared lock in every window (genuine contention)"
          : lockPair > 0
            ? `every thread serialised on one shared lock in P${lockPair} only (intermittent in-code contention)`
          : divergeWorker >= 0
            ? `worker ${divergeWorker + 1}'s verdicts flip from its 100th timed call; its pre-release fingerprint is unchanged`
            : `${HOG_THREADS_PER_CORE * cores} CPU-hog threads over P${hogPair} only (outside load on the host)`
      }` +
        " — a demonstration run, not a measurement of the core.",
    );
  }
  console.log("");

  const core = workload.SignalGridCore.demo();
  const { signature } = prepare(core, workload);
  const pool = await Pool.start(workerCount, durationMs, lockBuffer, divergeWorker);

  const singles: Run[] = [];
  const parallels: Array<{ runs: Run[]; releaseNs: bigint; aggregateRate: number; meanWindowMs: number; totalOps: number }> = [];
  const single = async () => (await pool.run(1, lockEveryWindow)).runs[0];
  try {
    singles.push(await single());
    for (let pair = 1; pair <= pairCount; pair++) {
      const hogs = pair === hogPair ? startHogs(HOG_THREADS_PER_CORE * cores, durationMs + 250) : [];
      const { runs, releaseNs } = await pool.run(undefined, lockEveryWindow || pair === lockPair);
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

  const parallelStats: Array<{ p99Ms: number; maxMs: number; stalledPct: number }> = [];
  console.log(`Parallel windows — ${workerCount} worker${workerCount === 1 ? "" : "s"}, saturated`);
  parallels.forEach((p, i) => {
    const j = verdict.pairs[i];
    const starts = p.runs.map((r) => BigInt(r.startNs));
    const firstStart = starts.reduce((a, b) => (b < a ? b : a));
    const lastStart = starts.reduce((a, b) => (b > a ? b : a));
    const merged = sortedCopy(p.runs.flatMap((r) => Array.from(r.samples)));
    const stallPerWorker = p.runs.reduce((sum, r) => sum + stalledMs(r.samples, stallThresholdMs), 0) / p.runs.length;
    parallelStats.push({
      p99Ms: workload.percentile(merged, 99),
      maxMs: merged[merged.length - 1] ?? 0,
      stalledPct: (stallPerWorker / p.meanWindowMs) * 100,
    });
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
  if (parallelCollapseExercised && verdict.mixed) {
    const lost = verdict.pairs.filter((p) => p.collapsed).map((p) => `P${p.pair} (${p.ratio.toFixed(2)}x)`);
    const gained = verdict.pairs.filter((p) => !p.collapsed).map((p) => `P${p.pair} (${p.ratio.toFixed(2)}x)`);
    console.log(
      `MIXED WINDOWS (reported, not hidden): ${lost.join(", ")} collapsed while ${gained.join(", ")} gained; pooled ${verdict.pooledRatio.toFixed(2)}x passes the pooled-throughput contract. ` +
        "Cause not determined: rates alone cannot tell outside load on the host from intermittent contention, allocation or GC in the code.",
    );
  }
  if (parallelCollapseExercised) {
    console.log(
      `First-pair-only rule (the gate before 2026-11-21, P1 against S0): ${verdict.firstPairOnlyRuleFails ? "would FAIL" : "would pass"}.`,
    );
  }
  const windows = [
    ...singles.map((run, i) => ({ label: `S${i}`, run })),
    ...parallels.flatMap((p, i) => p.runs.map((run) => ({ label: `P${i + 1}/worker ${run.worker}`, run }))),
  ];
  const timedVerdicts = windows.reduce((a, x) => a + x.run.ops, 0);
  failures.push(...determinismFailures(signature, windows));

  console.log(
    "Gates: throughput floor (from the 750 ms p95 pilot gate) on every single-core window, " +
      (parallelCollapseExercised
        ? `no parallel collapse (exercised at ${workerCount} workers over ${pairCount} bracketed pair${pairCount === 1 ? "" : "s"}; fails when the pooled ratio is ≤ 1x)`
        : "no parallel collapse: NOT EXERCISED — 1 worker on this machine, so the property was not tested") +
      ", determinism under concurrency.",
  );
  // One public-safe line of numbers, printed pass or fail. scripts/preflight.mjs echoes `BENCH-RECORD ` lines into
  // its own log after the step's verdict, so the per-window figures survive in the CI artifacts that keep that log
  // (a passing step's output was otherwise dropped, which is why passing hosted-macOS rates could not be tabulated).
  // No file is written: nothing lands in the tree, so sim-result provenance is untouched.
  const round = (x: number, d = 2) => Number(x.toFixed(d));
  console.log(
    "BENCH-RECORD " +
      JSON.stringify({
        bench: "decision-throughput",
        v: 1,
        cores,
        workers: workerCount,
        windowSec: seconds,
        pairs: pairCount,
        inject: inject ?? null,
        singlePerSec: singleRates.map((r) => Math.round(r)),
        singleStalledPct: singles.map((x) => round((stalledMs(x.samples, stallThresholdMs) / x.elapsedMs) * 100, 1)),
        singleP50Ms: round(singleMedianMs, 4),
        parallelPerSec: parallels.map((p) => Math.round(p.aggregateRate)),
        ratios: verdict.pairs.map((p) => round(p.ratio)),
        pooled: round(verdict.pooledRatio),
        p99Ms: parallelStats.map((x) => round(x.p99Ms, 1)),
        maxMs: parallelStats.map((x) => round(x.maxMs, 1)),
        parallelStalledPct: parallelStats.map((x) => round(x.stalledPct, 1)),
        firstPairOnlyRuleFails: verdict.firstPairOnlyRuleFails,
        divergentTimedVerdicts: windows.reduce((a, x) => a + x.run.divergentOps, 0),
        verdict: failures.length > 0 ? "fail" : "pass",
      }),
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
      `, identical verdicts in all ${windows.length} windows (${timedVerdicts.toLocaleString("en-US")} timed verdicts each checked).`,
  );
  console.log("Absolute rates are hardware-specific and report-only; the decision core alone, no HTTP/connector/database.");
}

if (isMainThread) {
  await main();
} else {
  const data = workerData as {
    durationMs: number;
    lockBuffer: SharedArrayBuffer | null;
    divergeAfterRelease: boolean;
    failOnGo: boolean;
    worker: number;
  };
  await runWorker(data.durationMs, data.lockBuffer, data.divergeAfterRelease, data.failOnGo, data.worker);
}
