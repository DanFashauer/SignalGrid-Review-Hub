// Proof: @workspace/reliability — SLOs and error budgets for the decision plane.
//
// Load-bearing invariants:
//   1. ERROR BUDGET MATH — budgetEvents = floor((1-objective)*n); consumed/remaining/
//      burnRate correct; status healthy < at_risk (>=80% spent) < exhausted (overspent).
//   2. FAIL-CLOSED HAS NO BUDGET — the zero-tolerance integrity SLO exhausts on ONE
//      fail-open, at any window size; it can never read healthy/at_risk with a breach,
//      and never be "bought down".
//   3. FAIL-SAFE ON NO DATA — an empty window is `unknown` (not healthy); unknown
//      outranks at_risk in worst-status-wins.
//   4. PLAIN LANGUAGE — the summary counts objectives needing attention, words a
//      fail-open breach as critical, and leaks no internal status enum.
//   5. DETERMINISM + IMMUTABILITY.
//
// Run: pnpm --filter @workspace/scripts run proof:reliability

import {
  DEFAULT_SLOS,
  computeBudget,
  computeReliability,
  summarizeReliability,
  BUDGET_STATUS_RANK,
  type DecisionRecord,
  type Slo,
} from "@workspace/reliability";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const ok = (n: number, extra: Partial<DecisionRecord> = {}): DecisionRecord[] =>
  Array.from({ length: n }, () => ({ produced: true, latencyMs: 10, failedOpen: false, ...extra }));

const availabilitySlo = DEFAULT_SLOS.find((s) => s.id === "decision-availability")!;
const latencySlo = DEFAULT_SLOS.find((s) => s.id === "decision-latency")!;
const integritySlo = DEFAULT_SLOS.find((s) => s.id === "fail-closed-integrity")!;

// ── (1) error budget math — availability 99.9% over 1000 decisions → budget 1 ──────
const avail1000 = computeBudget(availabilitySlo, ok(1000));
check("availability: budget = floor(0.001*1000) = 1", avail1000.budgetEvents === 1);
check("availability: no failures → consumed 0, remaining 1, healthy",
  avail1000.consumedEvents === 0 && avail1000.remainingEvents === 1 && avail1000.status === "healthy");
check("availability: sli is 1.0 when nothing failed", avail1000.sli === 1);

// one erroring decision consumes the whole budget (1) → burn 1.0 → exhausted? 1 == budget, not > budget
const avail1err = computeBudget(availabilitySlo, [...ok(999), { produced: false, latencyMs: 0, failedOpen: false }]);
check("availability: 1 error consumes the budget exactly (burn 1.0), status at_risk-or-worse",
  avail1err.consumedEvents === 1 && avail1err.burnRate === 1 && avail1err.status !== "healthy");
// two errors overspend → exhausted
const avail2err = computeBudget(availabilitySlo, [...ok(998), { produced: false, latencyMs: 0, failedOpen: false }, { produced: false, latencyMs: 0, failedOpen: false }]);
check("availability: overspend (2 > budget 1) → exhausted, remaining negative",
  avail2err.status === "exhausted" && avail2err.remainingEvents === -1 && avail2err.burnRate === 2);

// ── latency: only produced decisions count; slow ones are the bad events ───────────
const latMix = computeBudget(latencySlo, [...ok(100, { latencyMs: 10 }), ...ok(5, { latencyMs: 200 })]);
check("latency: denominator is produced decisions (105)", latMix.sampleCount === 105);
check("latency: budget = floor(0.01*105) = 1, 5 slow → exhausted",
  latMix.budgetEvents === 1 && latMix.consumedEvents === 5 && latMix.status === "exhausted");
// a decision that never produced a verdict is not judged on latency
const latNoProduce = computeBudget(latencySlo, [{ produced: false, latencyMs: 9999, failedOpen: false }]);
check("latency: a non-produced decision is not counted as a slow one", latNoProduce.consumedEvents === 0 && latNoProduce.sampleCount === 0);

// at-risk threshold: 80% of budget spent (budget 10 over 10000, 8 slow → at_risk)
const latAtRisk = computeBudget({ ...latencySlo, objective: 0.999 } as Slo, [...ok(9992, { latencyMs: 10 }), ...ok(8, { latencyMs: 200 })]);
check("latency: budget 10, 8 slow (80%) → at_risk", latAtRisk.budgetEvents === 10 && latAtRisk.consumedEvents === 8 && latAtRisk.status === "at_risk");

// ── (2) FAIL-CLOSED HAS NO BUDGET — the core invariant ─────────────────────────────
const integrityClean = computeBudget(integritySlo, ok(1_000_000));
check("integrity: a million clean decisions → healthy, zero budget",
  integrityClean.status === "healthy" && integrityClean.budgetEvents === 0);
const integrityOneBreach = computeBudget(integritySlo, [...ok(999_999), { produced: true, latencyMs: 10, failedOpen: true }]);
check("integrity: ONE fail-open in a million → exhausted (no budget, ever)",
  integrityOneBreach.status === "exhausted" && integrityOneBreach.consumedEvents === 1 && integrityOneBreach.budgetEvents === 0);
check("integrity: burn rate is Infinity when a zero-budget SLO is breached", integrityOneBreach.burnRate === Infinity);
// SWEEP: at NO window size does a fail-open breach read as healthy or at_risk.
let integrityEverForgiven = false;
for (const n of [1, 10, 100, 1000, 100000]) {
  const r = computeBudget(integritySlo, [...ok(n - 1), { produced: true, latencyMs: 10, failedOpen: true }]);
  if (r.status === "healthy" || r.status === "at_risk") integrityEverForgiven = true;
}
check("integrity: a fail-open breach is NEVER healthy/at_risk at any window size", integrityEverForgiven === false);
check("integrity: a fail-open decision does not spend the AVAILABILITY budget (it produced a verdict)",
  computeBudget(availabilitySlo, [{ produced: true, latencyMs: 10, failedOpen: true }]).status === "healthy");

// ── (3) FAIL-SAFE ON NO DATA ───────────────────────────────────────────────────────
check("empty window → availability unknown (not healthy)", computeBudget(availabilitySlo, []).status === "unknown");
check("empty window → latency unknown (not healthy)", computeBudget(latencySlo, []).status === "unknown");
// but a zero-tolerance SLO with no data is healthy (nothing has breached) — absence of
// a breach is a true statement, unlike absence of latency data.
check("empty window → integrity healthy (no breach has occurred)", computeBudget(integritySlo, []).status === "healthy");
check("BUDGET_STATUS_RANK: exhausted > unknown > at_risk > healthy",
  BUDGET_STATUS_RANK.exhausted > BUDGET_STATUS_RANK.unknown &&
  BUDGET_STATUS_RANK.unknown > BUDGET_STATUS_RANK.at_risk &&
  BUDGET_STATUS_RANK.at_risk > BUDGET_STATUS_RANK.healthy);

// ── worst-status-wins over the whole report ────────────────────────────────────────
const mixedReport = computeReliability([...ok(500), { produced: true, latencyMs: 10, failedOpen: true }]);
check("report: one fail-open makes OVERALL exhausted", mixedReport.overall === "exhausted");
const cleanReport = computeReliability(ok(10_000));
check("report: all-clean, ample window → overall healthy", cleanReport.overall === "healthy");
check("report: an empty window is overall unknown, never healthy", computeReliability([]).overall === "unknown");

// ── (4) PLAIN LANGUAGE ─────────────────────────────────────────────────────────────
const plainClean = summarizeReliability(cleanReport);
check("plain: all-on-track headline", plainClean.headline === "Reliability is on track." && plainClean.allOnTrack);
const plainBreach = summarizeReliability(mixedReport);
check("plain: a breach yields a needs-attention headline, worst-first",
  !plainBreach.allOnTrack && /need(s)? attention\.$/.test(plainBreach.headline) && plainBreach.lines[0].needsAttention);
check("plain: a fail-open breach is worded as critical", plainBreach.lines.some((l) => /critical/i.test(l.sentence)));
// The user-facing STATUS words and headline must not be the raw enum. (Sentences use
// ordinary domain language — "an unknown or unreachable signal" is correct English,
// not an enum leak — so the check is scoped to the status label + headline.)
check("plain: the status labels never expose the raw status enum",
  !/\b(healthy|at_risk|unknown|exhausted)\b/.test(plainBreach.headline + " " + plainBreach.lines.map((l) => l.state).join(" ")));

// ── (5) DETERMINISM + IMMUTABILITY ─────────────────────────────────────────────────
check("computeReliability is deterministic",
  JSON.stringify(computeReliability(ok(100))) === JSON.stringify(computeReliability(ok(100))));
check("summarizeReliability is deterministic",
  JSON.stringify(summarizeReliability(mixedReport)) === JSON.stringify(summarizeReliability(mixedReport)));
check("report and budgets are deep-frozen",
  Object.isFrozen(cleanReport) && Object.isFrozen(cleanReport.budgets) && cleanReport.budgets.every((b) => Object.isFrozen(b) && Object.isFrozen(b.slo)));

// ── figures (guarded against the docs) ─────────────────────────────────────────────
const slos = DEFAULT_SLOS.length;
const zeroTolerance = DEFAULT_SLOS.filter((s) => s.zeroTolerance).length;
console.log(`figures=slos=${slos},zeroToleranceSlos=${zeroTolerance},statuses=${Object.keys(BUDGET_STATUS_RANK).length}`);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
