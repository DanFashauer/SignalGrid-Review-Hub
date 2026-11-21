/**
 * The parallel-collapse judge for `throughput-bench.ts`, kept free of timing so
 * it can be proved against fixtures on every run.
 *
 * WHY PAIRS (BUILD_BACKLOG, "Decision-throughput saturation gate fails about
 * one in five hosted macOS slice-4 jobs", 2026-11-21). The gate used to compare
 * ONE parallel window with ONE single-core window measured before it. On the
 * hosted Intel macOS runners the ten decoded failures had saturated p99 of
 * 41–140 ms and max stalls of 137–543 ms, against p99 near 4 ms and max under
 * 20 ms on the 4-vCPU Linux runners, which scaled 1.91–2.60x in every one of
 * 14 runs. Those numbers fit a VM starved for part of one window; they do not
 * prove it, and nothing in this module can.
 *
 * The schedule is now S0 P1 S1 P2 S2 … Pk Sk: every parallel window is
 * bracketed by single-core windows taken on either side of it. Pair i judges
 * P_i against the HIGHER of its two brackets, so a slow single-core window can
 * never make a parallel window look better than it is.
 *
 * THE POOLED-THROUGHPUT CONTRACT. The gate FAILS when the pooled ratio
 * — Σ parallel / Σ bracket, over all pairs — is ≤ 1: the parallel windows taken
 * together did not beat one core measured on either side of them. It is a
 * contract on aggregate throughput over the run, and that is ALL it is.
 *
 * What it does NOT establish: why a single pair collapsed. A run in which some
 * pairs collapse and the pooled ratio still passes is reported as MIXED
 * WINDOWS, by name, with its numbers, and with its cause left undetermined.
 * This module sees only rates, and outside load on the host, intermittent
 * in-code serialisation, a periodic allocation or GC burst, or a lock taken in
 * one window only can all produce the same rates. The recorded fixtures below
 * include both kinds (`host-stall` and `intermittent-lock`), with the same
 * expected verdict, for exactly that reason. Contention present in every
 * window drags every pair down and fails the contract; contention present in
 * only part of the run is, by this contract, outvoted. That is a stated limit
 * of the contract, not a claim about the cause.
 *
 * Why pooled and not "fail only when every pair collapses": workers serialised
 * on one barging mutex sit at ≈1.0x, right on the old threshold, so per-pair
 * noise lets one pair "gain" by a few percent (measured: 0.87x / 1.04x /
 * 0.91x). An every-pair rule passed that run; the pooled rule fails it
 * (0.94x). The old single-window rule passed it too. The comparison is still
 * "parallel must beat one core" (≤ fails), against the HIGHER of two
 * single-core measurements instead of one.
 */

export interface PairJudgement {
  /** 1-based pair index. */
  pair: number;
  singleBefore: number;
  singleAfter: number;
  /** max(singleBefore, singleAfter): the single-core rate this pair is judged against. */
  reference: number;
  parallel: number;
  /** parallel / reference. */
  ratio: number;
  collapsed: boolean;
}

export interface CollapseVerdict {
  pairs: PairJudgement[];
  collapsedPairs: number;
  /** Σ parallel / Σ reference over every pair. */
  pooledRatio: number;
  /** pooledRatio ≤ 1: the parallel windows together did not beat one core. The gate fails. */
  fail: boolean;
  /** The run passes the pooled contract but at least one pair collapsed: reported as MIXED WINDOWS, cause undetermined. */
  mixed: boolean;
  /** What the pre-2026-11-21 rule (P1 against S0 alone) would have said. */
  firstPairOnlyRuleFails: boolean;
}

/**
 * `singles` holds k+1 single-core rates (S0..Sk), `parallels` k aggregate rates
 * (P1..Pk). Fail-closed on malformed input: a missing, non-finite or negative
 * rate is a broken measurement, and a broken measurement must not pass.
 */
export function judgePairs(singles: readonly number[], parallels: readonly number[]): CollapseVerdict {
  if (parallels.length < 1) throw new Error("judgePairs: at least one parallel window is required");
  if (singles.length !== parallels.length + 1) {
    throw new Error(`judgePairs: ${parallels.length} parallel windows need ${parallels.length + 1} bracketing single-core windows, got ${singles.length}`);
  }
  for (const r of [...singles, ...parallels]) {
    if (!Number.isFinite(r) || r < 0) throw new Error(`judgePairs: rate ${r} is not a finite non-negative number`);
  }
  const pairs = parallels.map((parallel, i): PairJudgement => {
    const singleBefore = singles[i];
    const singleAfter = singles[i + 1];
    const reference = Math.max(singleBefore, singleAfter);
    return {
      pair: i + 1,
      singleBefore,
      singleAfter,
      reference,
      parallel,
      ratio: reference > 0 ? parallel / reference : 0,
      // Same comparison as the old gate (`aggregate <= single`), per pair.
      collapsed: parallel <= reference,
    };
  });
  const collapsedPairs = pairs.filter((p) => p.collapsed).length;
  const sumParallel = pairs.reduce((a, p) => a + p.parallel, 0);
  const sumReference = pairs.reduce((a, p) => a + p.reference, 0);
  const pooledRatio = sumReference > 0 ? sumParallel / sumReference : 0;
  const fail = sumParallel <= sumReference;
  return {
    pairs,
    collapsedPairs,
    pooledRatio,
    fail,
    mixed: !fail && collapsedPairs > 0,
    firstPairOnlyRuleFails: parallels[0] <= singles[0],
  };
}

interface Fixture {
  name: string;
  singles: number[];
  parallels: number[];
  expectFail: boolean;
  expectMixed: boolean;
  expectFirstPairOnlyRuleFails: boolean;
}

/**
 * Fixtures the judge must classify correctly before any measurement is
 * trusted. The "recorded" fixtures are rates printed by this bench in the
 * cloud-lane container on 2026-11-21 (4 cores, --seconds=2; the barging-mutex
 * run predates moving the single-core windows into a worker, so its S rates
 * were taken on the main thread); the rest are constructed edges.
 */
export const JUDGE_FIXTURES: readonly Fixture[] = [
  {
    name: "recorded: workers serialised on one fair ticket lock (--inject=lock) — contention drags every pair",
    singles: [1404, 1620, 1143, 1765],
    parallels: [1017, 954, 947],
    expectFail: true,
    expectMixed: false,
    expectFirstPairOnlyRuleFails: true,
  },
  {
    name: "recorded: workers serialised on a barging mutex (≈1.0x) — one pair 'gains' by noise, pooled still fails",
    singles: [1205, 1390, 1073, 1474],
    parallels: [1208, 1440, 1342],
    expectFail: true,
    expectMixed: false,
    expectFirstPairOnlyRuleFails: false,
  },
  {
    name: "recorded: 16 CPU-hog threads over P1's window only (--inject=host-stall:1) — mixed, cause not determined",
    singles: [1717, 1322, 1262, 1231],
    parallels: [947, 4633, 5366],
    expectFail: false,
    expectMixed: true,
    expectFirstPairOnlyRuleFails: true,
  },
  {
    name: "recorded: one shared lock in P2's window only (--inject=intermittent-lock:2) — in-code cause, SAME mixed verdict as host-stall",
    singles: [1752, 1949, 2011, 1933],
    parallels: [5946, 1239, 6341],
    expectFail: false,
    expectMixed: true,
    expectFirstPairOnlyRuleFails: false,
  },
  {
    name: "edge: parallel EQUAL to its bracket is collapse (≤, as the old gate)",
    singles: [1000, 1000, 1000],
    parallels: [1000, 1000],
    expectFail: true,
    expectMixed: false,
    expectFirstPairOnlyRuleFails: true,
  },
  {
    name: "edge: a stalled single-core window cannot rescue a collapsed pair (judged against the higher bracket)",
    singles: [1500, 300, 1500, 1500],
    parallels: [1400, 1400, 1400],
    expectFail: true,
    expectMixed: false,
    expectFirstPairOnlyRuleFails: true,
  },
  {
    name: "edge: every pair gains",
    singles: [1500, 1480, 1510, 1490],
    parallels: [2900, 3000, 2950],
    expectFail: false,
    expectMixed: false,
    expectFirstPairOnlyRuleFails: false,
  },
];

/** Returns failure messages; empty means the judge classified every fixture correctly. */
export function judgeSelfTest(): string[] {
  const failures: string[] = [];
  for (const f of JUDGE_FIXTURES) {
    const v = judgePairs(f.singles, f.parallels);
    if (v.fail !== f.expectFail) failures.push(`${f.name}: fail=${v.fail}, expected ${f.expectFail}`);
    if (v.mixed !== f.expectMixed) failures.push(`${f.name}: mixed=${v.mixed}, expected ${f.expectMixed}`);
    if (v.firstPairOnlyRuleFails !== f.expectFirstPairOnlyRuleFails) {
      failures.push(`${f.name}: firstPairOnlyRuleFails=${v.firstPairOnlyRuleFails}, expected ${f.expectFirstPairOnlyRuleFails}`);
    }
  }
  const malformed: Array<[number[], number[]]> = [
    [[1000], [2000]], // too few brackets
    [[1000, Number.NaN], [2000]],
    [[1000, 1000], [Number.POSITIVE_INFINITY]],
    [[1000, -1], [2000]],
    [[1000], []],
  ];
  for (const [s, p] of malformed) {
    let threw = false;
    try {
      judgePairs(s, p);
    } catch {
      threw = true;
    }
    if (!threw) failures.push(`malformed input singles=${JSON.stringify(s)} parallels=${JSON.stringify(p)} was judged instead of refused`);
  }
  return failures;
}
