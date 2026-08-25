// session-readiness proof — OFFLINE and deterministic.
//
// Asserted, in order of how much each matters:
//   1. SILENCE IS NEVER READINESS. No state where the plane was not measured can
//      reach the clean grant, asserted over the whole state space rather than by
//      example, with the clean set pinned to exact SHAPES rather than a count.
//   2. THE SAME MEASUREMENT MUST NOT PRODUCE THE SAME ANSWER for a routine and a
//      critical workflow. This is the "allow chart view, hold the medication order"
//      law, and it is what makes the dimension a decision rather than a dashboard.
//   3. AN OMITTED BUDGET CANNOT SUPPRESS. Posing no threshold must not buy silence.
//   4. THE CEILING HOLDS: never escalate, never deny, over the entire space.
//   5. THE POSTURE MAP IS PINNED AS A SHAPE — the lesson from the uem registry gap,
//      where a map asserted only on the grant path was a map nobody verified.
//   6. THE NORMALIZER never invents a fact: an absent field is ignorance, and ONE
//      unreadable field makes the whole record malformed.
//   7. THE LIVE-CALL GATE refuses unless every condition holds, each ISOLATED.
//   8. NO NETWORK I/O in the family, and NO CLOCK READ anywhere.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeDeviceRisk, fromSessionReadiness } from "@workspace/posture-composition";
import {
  evaluateSessionReadiness,
  evaluateSessionReadinessFixture,
  normalizeControlUpReadiness,
  resolveSessionReadinessConnector,
  SESSION_READINESS_FIXTURES,
  SESSION_READINESS_READ_CONTRACT,
} from "@workspace/integrations/session-readiness";
import type {
  AppReadiness,
  NormalizedSessionReadiness,
  ReadinessMeasurement,
  SessionOrigin,
  WorkflowRisk,
} from "@workspace/integrations/session-readiness";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

console.log("Session-readiness proof — is the app this worker needs actually usable?\n");

// ── 7. The live-call gate, each condition ISOLATED ───────────────────────────
const T = { readSessionReadiness: async () => ({}) };
const FULL = {
  SIGNALGRID_TIER: "prod",
  SIGNALGRID_LIVE_INTEGRATIONS: "true",
  SESSION_READINESS_DEX_PLANE: "controlup",
  SESSION_READINESS_ACCESS_TOKEN: "t",
};
check("default env (dev tier) refuses live", resolveSessionReadinessConnector({}, T).mode === "fixture");
check(
  "ISOLATED: tier alone blocks live",
  resolveSessionReadinessConnector({ ...FULL, SIGNALGRID_TIER: "dev" }, T).mode === "fixture",
);
check(
  "ISOLATED: the LIVE_INTEGRATIONS flag alone blocks live",
  resolveSessionReadinessConnector({ ...FULL, SIGNALGRID_LIVE_INTEGRATIONS: "false" }, T).mode === "fixture",
);
check(
  "ISOLATED: an unrecognised DEX plane alone blocks live",
  resolveSessionReadinessConnector({ ...FULL, SESSION_READINESS_DEX_PLANE: "nope" }, T).mode === "fixture",
);
check(
  "ISOLATED: a missing credential alone blocks live",
  resolveSessionReadinessConnector({ ...FULL, SESSION_READINESS_ACCESS_TOKEN: "" }, T).mode === "fixture",
);
check(
  "no transport refuses even with every gate satisfied — this repo ships none",
  resolveSessionReadinessConnector(FULL).mode === "fixture",
);
check(
  "NON-VACUITY: with every gate satisfied AND a transport injected, the gate does open",
  resolveSessionReadinessConnector(FULL, T).mode === "live",
);
check(
  "the read contract exposes NO actuators, though the vendor API offers reboot/wake/shadow",
  SESSION_READINESS_READ_CONTRACT.actuatorsExposed === false,
);
check(
  "…and it names ControlUp as the system of record this family reads and never replaces",
  SESSION_READINESS_READ_CONTRACT.systemOfRecord === "controlup",
);

// ── The exhaustive normalized state space ────────────────────────────────────
const READINESS: AppReadiness[] = ["usable", "degraded", "not_usable", "unknown"];
const MEASUREMENT: ReadinessMeasurement[] = ["measured", "not_instrumented", "plane_unreachable"];
const ORIGIN: SessionOrigin[] = ["fresh", "reconnected", "unknown"];
const RISK: WorkflowRisk[] = ["routine", "elevated", "critical", "unstated"];
const ELAPSED: (number | null)[] = [null, 5, 42];
const BUDGET: ({ thresholdSeconds: number } | null)[] = [null, { thresholdSeconds: 30 }];
const INTEGRITY = ["intact", "malformed"] as const;

const space: NormalizedSessionReadiness[] = [];
for (const appReadiness of READINESS)
  for (const measurement of MEASUREMENT)
    for (const sessionOrigin of ORIGIN)
      for (const workflowRisk of RISK)
        for (const elapsedToUsableSeconds of ELAPSED)
          for (const budget of BUDGET)
            for (const reportIntegrity of INTEGRITY)
              space.push({
                sessionRef: "s",
                appReadiness,
                measurement,
                sessionOrigin,
                workflowRisk,
                elapsedToUsableSeconds,
                budget,
                reportIntegrity,
              });

const SPACE = space.length;
console.log(`\n  normalized state space: ${SPACE} states\n`);
check(
  `the swept space is the full cross-product (${SPACE})`,
  SPACE ===
    READINESS.length *
      MEASUREMENT.length *
      ORIGIN.length *
      RISK.length *
      ELAPSED.length *
      BUDGET.length *
      INTEGRITY.length,
);

const verdicts = space.map((s) => ({ state: s, verdict: evaluateSessionReadiness(s) }));

// ── 4. The ceiling ───────────────────────────────────────────────────────────
const LEGAL = new Set(["none", "monitor", "step_up", "alert", "restrict"]);
check(
  "the ceiling holds across the whole space: never escalate, never deny",
  verdicts.every(({ verdict }) => LEGAL.has(verdict.recommendedAction)),
);
check(
  "NON-VACUITY: `restrict` IS reachable, so the ceiling is a ceiling and not a description of nothing",
  verdicts.some(({ verdict }) => verdict.recommendedAction === "restrict"),
);

// ── 1. SILENCE IS NEVER READINESS ────────────────────────────────────────────
//
// The headline law. Every clean grant is enumerated and pinned as a SHAPE — not a
// count, because a count silently accepts a wrong set of the same size, which is how
// the service-lifecycle clean-shape list was found to be missing six legitimate states.
const clean = verdicts.filter(({ verdict }) => verdict.recommendedAction === "none");
check(
  "NOT ONE unmeasured state reaches the clean grant — no instrumentation gap and no unreachable plane grants",
  clean.every(({ state }) => state.measurement === "measured"),
);
check(
  "…and no clean grant carries a non-usable or unknown readiness reading",
  clean.every(({ state }) => state.appReadiness === "usable"),
);
check(
  "…and no malformed record reaches the clean grant",
  clean.every(({ state }) => state.reportIntegrity === "intact"),
);
const cleanShapes = new Set(
  clean.map(
    ({ state }) =>
      `${state.sessionOrigin}|${state.workflowRisk}|${state.elapsedToUsableSeconds}|${state.budget ? state.budget.thresholdSeconds : "none"}`,
  ),
);
check(
  `the clean set is pinned to EXACT shapes (${cleanShapes.size} distinct), not a count`,
  [...cleanShapes].every((shape) => {
    const [origin, risk, elapsed, budget] = shape.split("|");
    // A reconnected session may grant ONLY when the workflow is not critical — speed
    // is not reassurance when nothing was torn down.
    //
    // The first draft of this conjunct read `origin === "fresh" || origin === "unknown"
    // || origin === "reconnected"`, which accepts every possible value and therefore
    // constrains nothing. It looked like a check and was not one. That is the exact
    // shape of defect the mutation guard exists to find, sitting inside an assertion
    // written to prevent defects.
    const originOk = origin !== "reconnected" || risk !== "critical";
    // An elapsed time may grant only inside a posed budget, or with no elapsed time
    // at all. A measured time with NO posed budget is a `monitor`, never a grant.
    const budgetOk =
      elapsed === "null" || (budget !== "none" && Number(elapsed) <= Number(budget));
    return originOk && budgetOk;
  }),
);
check(
  "a reconnected session never grants under a CRITICAL workflow — speed is not reassurance when nothing was torn down",
  !clean.some(({ state }) => state.sessionOrigin === "reconnected" && state.workflowRisk === "critical"),
);

// ── 2. THE SAME MEASUREMENT, DIFFERENT WORKFLOW RISK ─────────────────────────
//
// The law that makes this a decision rather than a dashboard tile. 42 seconds against
// a 30-second budget: a shrug for a chart view, a hold for a medication order.
{
  const over = evaluateSessionReadinessFixture("tap-to-app-over-budget-critical")!;
  const overRoutine = evaluateSessionReadinessFixture("tap-to-app-over-budget-routine")!;
  check(
    `the SAME 42s over a 30s budget restricts a critical workflow (${over.recommendedAction})`,
    over.recommendedAction === "restrict" && over.reasonCode === "READINESS_BUDGET_EXCEEDED",
  );
  check(
    `…and does NOT restrict a routine one (${overRoutine.recommendedAction}) — same measurement, different answer`,
    overRoutine.recommendedAction === "alert",
  );
  check(
    "NON-VACUITY: the two differ, so workflowRisk is load-bearing rather than decorative",
    over.recommendedAction !== overRoutine.recommendedAction,
  );

  // Measured, MECHANICALLY, across the whole space rather than on one pair: swapping
  // ONLY workflowRisk must change SOME verdict, or the axis is carried and never graded.
  let differing = 0;
  for (const s of space) {
    const base = JSON.stringify(evaluateSessionReadiness(s));
    for (const r of RISK) {
      if (r === s.workflowRisk) continue;
      if (JSON.stringify(evaluateSessionReadiness({ ...s, workflowRisk: r })) !== base) differing += 1;
    }
  }
  check(
    `workflowRisk is GRADED, not carried: ${differing} verdict changes across single-field swaps`,
    differing > 0,
  );
}

// ── The tie-break is OBSERVABLE, not decorative ──────────────────────────────
//
// Found by the mutation guard on this family's first sweep: replacing the equal-rank
// tie-break with `false` changed nothing, because the more specific candidate also
// happened to be pushed first. That is the same defect `service-lifecycle` carried,
// and it makes the guard unfalsifiable rather than wrong.
//
// The fix was to push the LESS specific candidate first, which needs a state where two
// candidates collide at equal rank: an app that never came up AND a posed budget
// breached, on a routine workflow, so both land on `alert`.
{
  const collision = evaluateSessionReadiness({
    sessionRef: "s",
    appReadiness: "not_usable",
    measurement: "measured",
    sessionOrigin: "fresh",
    workflowRisk: "routine",
    elapsedToUsableSeconds: 42,
    budget: { thresholdSeconds: 30 },
    reportIntegrity: "intact",
  });
  check(
    `two equal-rank candidates collide and the MORE SPECIFIC one wins (${collision.reasonCode})`,
    collision.recommendedAction === "alert" && collision.reasonCode === "APP_NOT_USABLE",
  );
  check(
    "…and the loser is a real candidate, not a hypothetical — the budget breach fires alone when the app IS usable",
    evaluateSessionReadiness({
      sessionRef: "s",
      appReadiness: "usable",
      measurement: "measured",
      sessionOrigin: "fresh",
      workflowRisk: "routine",
      elapsedToUsableSeconds: 42,
      budget: { thresholdSeconds: 30 },
      reportIntegrity: "intact",
    }).reasonCode === "READINESS_BUDGET_EXCEEDED",
  );
}

// ── 3. AN OMITTED BUDGET CANNOT SUPPRESS ─────────────────────────────────────
{
  const unposed = evaluateSessionReadinessFixture("measured-with-no-posed-budget")!;
  check(
    `a measured elapsed time with NO posed budget still says something (${unposed.reasonCode})`,
    unposed.recommendedAction !== "none" && unposed.reasonCode === "READINESS_BUDGET_UNPOSED",
  );
  // The attack this forecloses: pose a budget, then escape the finding by removing it.
  const posedAndBreached = evaluateSessionReadiness({
    ...SESSION_READINESS_FIXTURES["tap-to-app-over-budget-critical"]!,
  });
  const budgetRemoved = evaluateSessionReadiness({
    ...SESSION_READINESS_FIXTURES["tap-to-app-over-budget-critical"]!,
    budget: null,
  });
  check(
    "removing the budget does NOT return the state to a clean grant — omission buys nothing",
    posedAndBreached.recommendedAction !== "none" && budgetRemoved.recommendedAction !== "none",
  );
}

// ── The absence branches, by name ────────────────────────────────────────────
{
  const dark = evaluateSessionReadinessFixture("endpoint-not-instrumented")!;
  const blind = evaluateSessionReadinessFixture("dex-plane-unreachable")!;
  check(
    `an uninstrumented endpoint ALERTS at operator scale (${dark.reasonCode})`,
    dark.reasonCode === "READINESS_UNMEASURED_NOT_INSTRUMENTED" && dark.recommendedAction === "alert",
  );
  check(
    `an unreachable DEX plane ALERTS too, and says so by name (${blind.reasonCode})`,
    blind.reasonCode === "READINESS_PLANE_UNREACHABLE" && blind.recommendedAction === "alert",
  );
  check(
    "both are `unassessed`, NOT `not_ready` — reporting a readiness failure for an endpoint nobody measured would assert a fact not in evidence",
    dark.posture === "unassessed" && blind.posture === "unassessed",
  );
  // The two must stay DISTINGUISHABLE: one is a fleet-instrumentation gap, the other is
  // broken monitoring, and they go to different fixes.
  check(
    "…and the two remain distinguishable by reason code, because they have different fixes",
    dark.reasonCode !== blind.reasonCode,
  );
}

// ── 5. THE POSTURE MAP, pinned as a SHAPE ────────────────────────────────────
{
  const EXPECTED: Record<string, string> = {
    SESSION_READY: "ready",
    READINESS_PLANE_UNREACHABLE: "unassessed",
    READINESS_UNMEASURED_NOT_INSTRUMENTED: "unassessed",
    READINESS_UNKNOWN: "unassessed",
    REPORT_MALFORMED: "unassessed",
    APP_NOT_USABLE: "not_ready",
    READINESS_BUDGET_EXCEEDED: "not_ready",
    APP_DEGRADED: "degraded",
    READINESS_BUDGET_UNPOSED: "degraded",
    SESSION_RECONNECTED_UNVERIFIED: "degraded",
  };
  const observed = new Map<string, Set<string>>();
  for (const { verdict } of verdicts) {
    if (!observed.has(verdict.reasonCode)) observed.set(verdict.reasonCode, new Set());
    observed.get(verdict.reasonCode)!.add(verdict.posture);
  }
  check(
    `every reachable reason maps to exactly ONE posture (${observed.size} reachable)`,
    [...observed.values()].every((set) => set.size === 1),
  );
  const mismatched = [...observed]
    .filter(([reason, set]) => EXPECTED[reason] !== [...set][0])
    .map(([reason, set]) => `${reason}→${[...set][0]} (expected ${EXPECTED[reason] ?? "UNLISTED"})`);
  check(
    `the reason→posture map matches what the source claims${mismatched.length ? `: ${mismatched.join(", ")}` : ""}`,
    mismatched.length === 0,
  );
  const postures = new Set([...observed.values()].flatMap((set) => [...set]));
  check(
    `NON-VACUITY: the space reaches ${postures.size} distinct postures, so the map is not collapsed`,
    postures.size >= 3,
  );
}

// ── 6. The normalizer invents nothing ────────────────────────────────────────
{
  const empty = normalizeControlUpReadiness({ sessionRef: "s1" });
  check(
    "a record with NO readiness field reads `unknown`, never `usable` — nothing observed is not nothing wrong",
    empty.appReadiness === "unknown",
  );
  check(
    "…and a record with NO measurement field reads `plane_unreachable`, the conservative member",
    empty.measurement === "plane_unreachable",
  );
  check(
    "…and a record with NO elapsed time is null, never 0 — absent is not fast",
    empty.elapsedToUsableSeconds === null,
  );
  // EACH of the three enum fields must trigger the malformed path ON ITS OWN. The first
  // draft tested only `appReadiness`, and the mutation guard proved the consequence:
  // the `measurement` disjunct could be deleted with no test noticing. A guard covering
  // three fields needs three controls, not one.
  for (const [field, payload] of [
    ["appReadiness", { sessionRef: "g1", appReadiness: "totally-fine" }],
    ["measurement", { sessionRef: "g2", measurement: "sort-of-watched" }],
    ["sessionOrigin", { sessionRef: "g3", sessionOrigin: "warm-ish" }],
  ] as const) {
    const g = normalizeControlUpReadiness(payload as never);
    check(
      `ONE unrecognised \`${field}\` makes the WHOLE record malformed — a garbled feed cannot grade on its readable half`,
      g.reportIntegrity === "malformed",
    );
  }
  const garbled = normalizeControlUpReadiness({ sessionRef: "s2", appReadiness: "totally-fine", measurement: "measured" });
  check(
    "…and the unreadable field itself falls to ignorance rather than being guessed",
    garbled.appReadiness === "unknown",
  );
  const unnamed = normalizeControlUpReadiness({ appReadiness: "usable", measurement: "measured" });
  check(
    "a record with no session ref is malformed with every axis unknown, never a partially-trusted read",
    unnamed.reportIntegrity === "malformed" && unnamed.appReadiness === "unknown",
  );
  const wellFormed = normalizeControlUpReadiness(
    { sessionRef: "s3", appReadiness: "usable", measurement: "measured", sessionOrigin: "fresh", elapsedToUsableSeconds: 8 },
    { budget: { thresholdSeconds: 30 }, workflowRisk: "critical" },
  );
  check(
    "NON-VACUITY: a well-formed record reads `intact` and grades clean, so `malformed` is not unconditional",
    wellFormed.reportIntegrity === "intact" && evaluateSessionReadiness(wellFormed).recommendedAction === "none",
  );
  // A fractional or negative duration is not a duration we can grade.
  check(
    "a negative or fractional elapsed time reads as ABSENT rather than being coerced",
    normalizeControlUpReadiness({ sessionRef: "s4", elapsedToUsableSeconds: -3 }).elapsedToUsableSeconds === null &&
      normalizeControlUpReadiness({ sessionRef: "s5", elapsedToUsableSeconds: 2.7 }).elapsedToUsableSeconds === null,
  );
}

// ── The composition adapter carries the distinction ──────────────────────────
{
  const sig = (fixture: string) => fromSessionReadiness(evaluateSessionReadinessFixture(fixture)!);
  check(
    "the adapter maps onto the unified ladder without inventing a rung",
    (["clinician-ready", "app-never-came-up", "dex-plane-unreachable"] as const).every(
      (f) => sig(f).action === evaluateSessionReadinessFixture(f)!.recommendedAction,
    ),
  );
  const composed = composeDeviceRisk([sig("tap-to-app-over-budget-critical")]);
  check(
    `a critical workflow over its readiness budget drives the composed action to restrict (${composed.strongestAction})`,
    composed.strongestAction === "restrict",
  );
  check(
    "…and the driver names this dimension, so an operator can see where it came from",
    JSON.stringify(composed).includes("session_readiness"),
  );
  check(
    "NON-VACUITY: a ready clinician composes to no action at all",
    composeDeviceRisk([sig("clinician-ready")]).strongestAction === "none",
  );
  // `ready` and `unassessed` both look calm from the action alone; the posture is what
  // keeps them apart, which is the green-dashboard failure this dimension prevents.
  check(
    "`ready` and `unassessed` stay DISTINCT through the adapter — the whole point of carrying the posture",
    sig("clinician-ready").posture !== sig("endpoint-not-instrumented").posture,
  );
}

// ── 8. No network I/O, and no clock read, anywhere in the family ─────────────
{
  const here = dirname(fileURLToPath(import.meta.url));
  const familyDir = resolve(here, "../../lib/integrations/src/integrations/session-readiness");
  const sources = readdirSync(familyDir).filter((f) => f.endsWith(".ts"));
  // COMMENTS ARE STRIPPED BEFORE SCANNING, and that is not a convenience.
  //
  // This family's own source discusses `Date.now()` by name — it explains why a
  // wall-clock read in a decision path is forbidden. A scanner that cannot tell code
  // from prose flags that explanation and calls the family non-compliant, which is
  // exactly the false positive the docs↔proof figure guard hit with historical
  // markers. Worse, it creates pressure to stop WRITING the explanation in order to
  // keep a gate green, which trades real documentation for a passing check.
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
  const bodies = sources.map((f) => stripComments(readFileSync(join(familyDir, f), "utf8")));
  const NET = /\bfetch\s*\(|require\(['"]https?['"]\)|from ['"]node:https?['"]|new XMLHttpRequest/;
  const CLOCK = /Date\.now\s*\(|new Date\s*\(\s*\)|performance\.now\s*\(/;
  check(
    `no network primitive in any of the ${sources.length} family sources`,
    bodies.every((b) => !NET.test(b)),
  );
  check(
    "no clock read in any family source — a wall-clock read in a decision path breaks replay",
    bodies.every((b) => !CLOCK.test(b)),
  );
  // NON-VACUITY: the scanners must actually fire on a positive control, or these two
  // assertions prove only that the regexes compile.
  check(
    "NON-VACUITY: both scanners fire on a positive control",
    NET.test("await fetch('https://x')") && CLOCK.test("const t = Date.now()"),
  );
  // And the stripping is tested BOTH WAYS, or it could silently blind the scanner:
  // a clock read hidden in a comment must pass, a real one must still be caught.
  check(
    "comment-stripping is two-way: a clock read in prose passes, a real one is still caught",
    !CLOCK.test(stripComments("// never write Date.now() here\nconst x = 1;")) &&
      CLOCK.test(stripComments("const t = Date.now(); // fine")) &&
      !NET.test(stripComments("/* do not fetch('https://x') */")) &&
      NET.test(stripComments("await fetch('https://x');")),
  );
  // A URL in code must not be mistaken for a comment by the stripper.
  check(
    "…and a protocol-relative URL in code does not eat the rest of the line",
    stripComments('const u = "https://x/y"; const t = Date.now();').includes("Date.now"),
  );
}

console.log("");
console.log(
  `figures=states=${SPACE},clean=${clean.length},cleanShapes=${cleanShapes.size},fixtures=${Object.keys(SESSION_READINESS_FIXTURES).length}`,
);
// ── A garbled budget may not outscore an unasked one ──────────────────────────
//
// `elapsed > NaN` and `elapsed > undefined` are both false, so no EXCEEDED
// candidate fired — AND because `budget !== null`, the honest UNPOSED arm was
// skipped too. Both the finding and its fallback switched off at once, and a
// garbled budget graded STRICTLY BETTER than no budget: `ready / none` against the
// `degraded / monitor` an absent one produces. A malformed question outscored an
// unasked one.
//
// The `{}` case is the realistic one: a config with a misspelled key satisfies
// `ReadinessBudget` structurally and arrives as `undefined`. It was ALSO the case a
// first pass at this fix left open — `posedBound` treats `undefined` as "not posed"
// by contract, which is right at its own boundary and wrong inside a budget object
// where the threshold is not optional. The probe caught it; these cases pin it.
{
  const readyBase = {
    subjectRef: "dev-b1",
    appRef: "emr",
    appReadiness: "usable" as const,
    measurement: "measured" as const,
    sessionOrigin: "fresh" as const,
    workflowRisk: "critical" as const,
    elapsedToUsableSeconds: 42,
    covered: true,
    source: "probe",
    observedAt: "2026-07-13T12:00:00.000Z",
  };

  const honest = evaluateSessionReadiness({ ...readyBase, budget: { thresholdSeconds: 30 } } as never);
  check(
    "budget control: a readable 30s budget over 42s elapsed still restricts",
    honest.reasonCode === "READINESS_BUDGET_EXCEEDED",
  );

  const unposed = evaluateSessionReadiness({ ...readyBase, budget: null } as never);
  check(
    "budget control: an ABSENT budget is the unposed finding, and still raises",
    unposed.reasonCode === "READINESS_BUDGET_UNPOSED" && unposed.recommendedAction !== "none",
  );

  for (const [label, budget] of [
    ["NaN", { thresholdSeconds: Number.NaN }],
    ["Infinity", { thresholdSeconds: Number.POSITIVE_INFINITY }],
    ["zero", { thresholdSeconds: 0 }],
    ["a missing threshold (the misspelled-key case)", {}],
  ] as ReadonlyArray<readonly [string, unknown]>) {
    const v = evaluateSessionReadiness({ ...readyBase, budget } as never);
    check(
      `a budget of ${label} does NOT grant`,
      v.recommendedAction !== "none",
    );
    check(
      `...and is reported as UNREADABLE, kept distinct from UNPOSED`,
      v.reasonCode === "READINESS_BUDGET_UNREADABLE",
    );
  }
}


console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
