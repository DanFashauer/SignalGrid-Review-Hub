// Observability-integrity proof — OFFLINE and deterministic.
//
// The dimension this guards answers a question no neighbouring family can: when a
// decision is about to rest on the ABSENCE of a reported problem, is that absence
// an observation or a gap? `session-readiness` already covers a telemetry plane
// that goes SILENT. Nothing covered a plane that is reachable, current and
// healthy-looking while carrying one record in a hundred.
//
// Asserted, in order of how much each matters:
//   1. A SAMPLED STREAM IS NEVER CLEAN. This is the whole reason the family
//      exists. Up + current + sampled is the shape that looks green and cannot
//      support "that did not happen".
//   2. THE GRANTING SET IS PINNED BY EQUALITY over the whole input space, not by
//      negatives — `!== bad` would let a value nobody enumerated through.
//   3. RELIANCE ONLY ESCALATES. `load_bearing` never grades cleaner than
//      `advisory`, and `unstated` grades EXACTLY as `advisory` — so a caller who
//      declares nothing buys no discount, which is the direction that would turn
//      a missing field into an unearned affirmative.
//   4. NO CLOCK IN THE DECISION PATH. The reference instant is supplied; the same
//      inputs grade the same way forever.
//   5. A FUTURE DATAPOINT IS UNKNOWN, NOT FRESH. A skewed clock is the most
//      "recent" value a naive age check can see.
//   6. THE NORMALIZER IS ASYMMETRIC. never_received, no_interval_declared and
//      unknown are three different facts and must not collapse.

import {
  evaluateObservabilityIntegrity,
  normalizeObservabilityIntegrity,
  STALE_AFTER_INTERVALS,
  type CollectionState,
  type EvidenceReliance,
  type NormalizedObservabilityIntegrity,
  type ObservabilityIntegrityAction,
  type SignalFreshness,
  type StreamFidelity,
  resolveObservabilityIntegrityConnector,
  makeDefaultObservabilityIntegrityTransport,
  ObservabilityIntegrityConnectorError,
} from "@workspace/integrations/observability-integrity";

import { checkDefaultTransport, checkLiveGateIsolated } from "./lib/live-gate.js";
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

console.log("Observability-integrity proof — is that silence an observation or a gap?\n");

const COLLECTION: CollectionState[] = [
  "reporting", "not_reporting", "never_instrumented", "unknown",
];
const FIDELITY: StreamFidelity[] = ["full", "sampled", "partial_drop", "cost_capped", "unknown"];
const FRESHNESS: SignalFreshness[] = [
  "current", "stale", "never_received", "no_interval_declared", "unknown",
];
const RELIANCE: EvidenceReliance[] = ["load_bearing", "advisory", "unstated"];

const norm = (
  collection: CollectionState,
  fidelity: StreamFidelity,
  freshness: SignalFreshness,
  reliance: EvidenceReliance,
  covered = true,
): NormalizedObservabilityIntegrity => ({
  streamRef: "svc.test",
  collection, fidelity, freshness, reliance, covered,
  ageSeconds: null, expectedIntervalSeconds: null, keptFraction: null,
  source: "proof", observedAt: "2026-01-01T00:00:00.000Z",
});

// ── 1. THE FULL INPUT SPACE, SWEPT ──────────────────────────────────────────
const RANK: Record<ObservabilityIntegrityAction, number> = {
  none: 0, monitor: 1, alert: 2, step_up: 3, restrict: 4,
};
const space: {
  n: NormalizedObservabilityIntegrity;
  action: ObservabilityIntegrityAction;
  silence: boolean;
}[] = [];
for (const collection of COLLECTION) {
  for (const fidelity of FIDELITY) {
    for (const freshness of FRESHNESS) {
      for (const reliance of RELIANCE) {
        for (const covered of [true, false]) {
          const n = norm(collection, fidelity, freshness, reliance, covered);
          const v = evaluateObservabilityIntegrity(n);
          space.push({ n, action: v.action, silence: v.silenceIsEvidence });
        }
      }
    }
  }
}
check(
  `the whole input space is enumerated (${space.length} = 4 collection x 5 fidelity x 5 freshness x 3 reliance x covered/not)`,
  space.length ===
    COLLECTION.length * FIDELITY.length * FRESHNESS.length * RELIANCE.length * 2 &&
    space.length === 600,
);

// ── 2. THE GRANTING SET, PINNED BY EQUALITY ─────────────────────────────────
//
// `action === "none"` is the only outcome that adds nothing to a decision. Every
// member is enumerated by SHAPE, so a new enum value cannot join the set by
// accident — the failure mode a `!== bad` test would have.
const key = (s: (typeof space)[number]): string =>
  `${s.n.collection}|${s.n.fidelity}|${s.n.freshness}|${s.n.reliance}|${s.n.covered}`;
const grantShapes = new Set(space.filter((s) => s.action === "none").map(key));
const EXPECTED_GRANTS = new Set(
  // Reporting, full fidelity, current, covered — the ONLY state in which silence
  // carries information. Reliance is irrelevant here BECAUSE the evidence is sound
  // however heavily the decision leans on it.
  RELIANCE.map((r) => `reporting|full|current|${r}|true`),
);
check(
  `exactly ${EXPECTED_GRANTS.size} input shapes contribute nothing, pinned by equality`,
  grantShapes.size === EXPECTED_GRANTS.size && [...grantShapes].every((s) => EXPECTED_GRANTS.has(s)),
);
check(
  "…and `silenceIsEvidence` is true on exactly those shapes and no others",
  space.every((s) => s.silence === (s.action === "none")),
);

// ── 3. THE REASON THE FAMILY EXISTS: SAMPLED IS NEVER CLEAN ─────────────────
check(
  "a SAMPLED stream never grades clean, however up and current it is",
  space.filter((s) => s.n.fidelity === "sampled").every((s) => s.action !== "none" && !s.silence),
);
check(
  "…nor does a dropping or cost-capped one",
  space
    .filter((s) => s.n.fidelity === "partial_drop" || s.n.fidelity === "cost_capped")
    .every((s) => s.action !== "none" && !s.silence),
);
check(
  "NON-VACUITY: an otherwise identical FULL stream IS clean, so the checks above are not trivially true",
  evaluateObservabilityIntegrity(norm("reporting", "full", "current", "advisory")).action === "none" &&
    evaluateObservabilityIntegrity(norm("reporting", "sampled", "current", "advisory")).action === "monitor",
);

// ── 4. NOT COVERED IS NEVER A PASS ──────────────────────────────────────────
check(
  "an uncovered stream always steps up — no record is a hole, not a grant",
  space.filter((s) => !s.n.covered).every((s) => s.action === "step_up" && !s.silence),
);

// ── 5. RELIANCE ONLY ESCALATES, AND SILENCE BUYS NOTHING ────────────────────
//
// The load-bearing arm may only ever be WORSE than the baseline, and `unstated`
// must grade EXACTLY as `advisory`. If `unstated` were ever softer, omitting the
// field would be a discount — a missing declaration manufacturing a better verdict,
// which is the precise failure this fabric is built against.
let escalationRegressions = 0;
let unstatedDiscounts = 0;
for (const collection of COLLECTION) {
  for (const fidelity of FIDELITY) {
    for (const freshness of FRESHNESS) {
      for (const covered of [true, false]) {
        const lb = RANK[evaluateObservabilityIntegrity(norm(collection, fidelity, freshness, "load_bearing", covered)).action];
        const ad = RANK[evaluateObservabilityIntegrity(norm(collection, fidelity, freshness, "advisory", covered)).action];
        const un = RANK[evaluateObservabilityIntegrity(norm(collection, fidelity, freshness, "unstated", covered)).action];
        if (lb < ad) escalationRegressions += 1;
        if (un !== ad) unstatedDiscounts += 1;
      }
    }
  }
}
check(
  `declaring evidence load-bearing never IMPROVES the verdict (${escalationRegressions} regressions)`,
  escalationRegressions === 0,
);
check(
  `an UNSTATED reliance grades exactly as \`advisory\` — omitting it is never a discount (${unstatedDiscounts} divergences)`,
  unstatedDiscounts === 0,
);
check(
  "NON-VACUITY: the escalation is real somewhere — load_bearing on a dead stream restricts where advisory steps up",
  evaluateObservabilityIntegrity(norm("not_reporting", "full", "current", "load_bearing")).action === "restrict" &&
    evaluateObservabilityIntegrity(norm("not_reporting", "full", "current", "advisory")).action === "step_up",
);

// ── 6. THE CEILING, AND THE FLOOR IT NEVER CROSSES ──────────────────────────
check(
  "the dimension NEVER denies — a dead exporter is not grounds to end a session",
  space.every((s) => (s.action as string) !== "deny"),
);
check(
  "`restrict` is reachable ONLY with a declared load-bearing reliance",
  space.filter((s) => s.action === "restrict").every((s) => s.n.reliance === "load_bearing"),
);

// ── 7. THE NORMALIZER IS ASYMMETRIC ─────────────────────────────────────────
const REF = "2026-01-01T00:02:00.000Z";
const base = { streamRef: "svc.test", collectionState: "reporting", fidelity: "full" } as const;

check(
  "a null record is UNCOVERED, not clean",
  normalizeObservabilityIntegrity(null, REF).covered === false,
);
check(
  "a record with no datapoint at all → never_received, NOT unknown",
  normalizeObservabilityIntegrity({ ...base, expectedIntervalSeconds: 60 }, REF).freshness ===
    "never_received",
);
check(
  "a datapoint with no declared interval → no_interval_declared, NOT current",
  normalizeObservabilityIntegrity(
    { ...base, lastDatapointAt: "2026-01-01T00:01:30.000Z" }, REF,
  ).freshness === "no_interval_declared",
);
check(
  "an unreadable reference instant → unknown; no arithmetic on a bad clock",
  normalizeObservabilityIntegrity(
    { ...base, lastDatapointAt: "2026-01-01T00:01:30.000Z", expectedIntervalSeconds: 60 },
    "not-a-date",
  ).freshness === "unknown",
);
// A bad clock AND no datapoint must stay `unknown` — NOT `never_received`.
//
// This pair is the one that separates the two guards. With a readable clock,
// "no datapoint" is a fact worth reporting. With an unreadable one it is not a
// fact at all: we cannot tell whether nothing arrived or whether we simply
// cannot place what did. Reporting `never_received` there would state something
// nobody established. Added because a mutation SURVIVED here — the earlier
// unreadable-reference check passed either way, since the negative-age guard
// downstream also lands on `unknown`.
check(
  "an unreadable reference with NO datapoint stays unknown, never `never_received`",
  normalizeObservabilityIntegrity({ ...base, expectedIntervalSeconds: 60 }, "not-a-date")
    .freshness === "unknown",
);

// THE TRAP: a datapoint dated AFTER the reference is the most "recent" value a
// naive age check can see, so a skewed clock would present as maximally fresh.
const future = normalizeObservabilityIntegrity(
  { ...base, lastDatapointAt: "2026-01-01T00:05:00.000Z", expectedIntervalSeconds: 60 }, REF,
);
check(
  "a FUTURE datapoint is unknown, never current — and reports no age it cannot vouch for",
  future.freshness === "unknown" && future.ageSeconds === null,
);

// ── 8. THE STALENESS BOUNDARY, PINNED ON BOTH SIDES ─────────────────────────
const atBoundary = normalizeObservabilityIntegrity(
  { ...base, lastDatapointAt: "2026-01-01T00:00:00.000Z", expectedIntervalSeconds: 60 }, REF,
);
const pastBoundary = normalizeObservabilityIntegrity(
  { ...base, lastDatapointAt: "2025-12-31T23:59:59.000Z", expectedIntervalSeconds: 60 }, REF,
);
check(
  `exactly ${STALE_AFTER_INTERVALS} intervals old is still current (age ${atBoundary.ageSeconds}s vs 60s interval)`,
  atBoundary.freshness === "current" && atBoundary.ageSeconds === 60 * STALE_AFTER_INTERVALS,
);
check(
  `one second past ${STALE_AFTER_INTERVALS} intervals is stale (age ${pastBoundary.ageSeconds}s)`,
  pastBoundary.freshness === "stale" && pastBoundary.ageSeconds === 60 * STALE_AFTER_INTERVALS + 1,
);

// ── 9. UNLISTED SPELLINGS FALL TO THE RAISING SIDE ──────────────────────────
const junk = normalizeObservabilityIntegrity(
  { streamRef: "x", collectionState: "green", fidelity: "lossless", reliance: "critical" }, REF,
);
check(
  "unlisted collection/fidelity spellings normalize to unknown, never toward the clean end",
  junk.collection === "unknown" && junk.fidelity === "unknown",
);
check(
  "an unlisted RELIANCE spelling becomes `unstated` — never `load_bearing`, never a discount",
  junk.reliance === "unstated",
);
check(
  "a kept fraction outside (0,1] is reported as absent rather than clamped into a number nobody sent",
  normalizeObservabilityIntegrity({ ...base, keptFraction: 0 }, REF).keptFraction === null &&
    normalizeObservabilityIntegrity({ ...base, keptFraction: 1.5 }, REF).keptFraction === null &&
    normalizeObservabilityIntegrity({ ...base, keptFraction: 0.01 }, REF).keptFraction === 0.01,
);

// ── 10. DETERMINISM ─────────────────────────────────────────────────────────
check(
  "the same inputs grade identically across repeated evaluation (no clock, no randomness)",
  space.every((s) => evaluateObservabilityIntegrity(s.n).action === s.action),
);

console.log(
  `\nfigures=inputs=${space.length},granting=${grantShapes.size},collection=${COLLECTION.length},fidelity=${FIDELITY.length},freshness=${FRESHNESS.length},staleAfterIntervals=${STALE_AFTER_INTERVALS}`,
);

// LIVE GATE and DEFAULT TRANSPORT — five branches here survived mutation until
// 2026-08-25: the tier test, the live-integrations flag, the missing-token refusal,
// the non-OK response, and the "a JSON body must be a record" check. Each is a place
// where a MISCONFIGURED or FAILING call could be mistaken for a real reading.
// The `full` env deliberately omits the BASE_URL key: it has a default, so it is not
// a gate, and asserting that removing it blocks the live call would assert something
// false.
checkLiveGateIsolated({
  check,
  family: "observability-integrity",
  resolve: (env) => resolveObservabilityIntegrityConnector(env),
  full: { SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", OBSERVABILITY_INTEGRITY_TOKEN: "t" },
});
await checkDefaultTransport({
  check,
  family: "observability-integrity",
  transport: makeDefaultObservabilityIntegrityTransport("https://vendor.invalid/observability-integrity") as (a: never) => Promise<unknown>,
  arg: { streamRef: "ref-1", token: "t" },
  codeOf: (err) => (err instanceof ObservabilityIntegrityConnectorError ? err.code : undefined),
});


console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
