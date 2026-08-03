// Proof: decision continuity — which decision wins across a network partition.
//
// WHAT IS BEING PROVEN. `reconcileDecisions` (lib/signalgrid-core/src/continuity.ts)
// reduces the set of answers that exist for one subject+action after a device has been
// deciding offline. The claims it makes are strong enough to be worth measuring rather
// than asserting:
//
//   L1 ORDER-INDEPENDENCE   the outcome depends on the SET, never the arrival order.
//   L2 IDEMPOTENCE          re-delivering a record changes nothing.
//   L3 MONOTONICITY         a record that does not dominate the frontier can never
//                           RELAX the outcome. This is the property that says a stale
//                           sync payload cannot manufacture a grant.
//   L4 OFFLINE CANNOT RELAX an offline (or knowingly-superseded) authority may raise
//                           the outcome on its own but never lower it below the
//                           fail-closed join of every record.
//   L5 NOT FAIL-STUCK       a fully-connected authority under strictly newer
//                           provenance CAN relax a stale restriction. Without this the
//                           lattice would be safe and useless.
//
// L1+L2 are the CRDT properties the offline-sync literature asks for. L3+L4 are the
// ones it does not: a pure join gets L1-L3 for free and fails L5, and last-write-wins
// gets L5 and fails all of L1-L4 (see the file header for why a clock is the wrong
// tiebreak on a shared device specifically).
//
// NEGATIVE CONTROLS. Each mutation below was applied to `continuity.ts`, measured, and
// reverted. The counts are what was OBSERVED, not what was expected — the first draft
// of this comment predicted the absent-stamp mutation would break L4 and it did not,
// which is why the proof now also states that choice as an OUTCOME (a stamped record
// relaxing a legacy record's deny) rather than only as an ordering:
//
//   60/60 baseline
//   56/60  `failClosedOutcome` -> `authorityOutcome` in the veto branch (kills L4)
//   56/60  `contested` forced false (kills L3 and the contested scenarios)
//   57/60  absent coreNormalizationVersion read as 0 rather than unknown
//   58/60  an unstated elapsed treated as fresh (kills the standing bound)
//   59/60  the veto scanned over the whole set instead of the frontier (kills L5)
//
// FIGURES. Printed as a `figures=` line for `scripts/check-proof-figures.mjs`.
//
// Run: pnpm --filter @workspace/scripts run proof:decision-continuity

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CoreError,
  compareProvenance,
  mostRestrictiveOutcome,
  reconcileDecisions,
  type DecisionOutcome,
  type DecisionProvenance,
  type ReconcilableDecision,
} from "@workspace/signalgrid-core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) passed += 1;
  else failures.push(name);
};

const OUTCOMES: DecisionOutcome[] = ["allow", "step_up", "restrict", "deny"];
const RANK: Record<DecisionOutcome, number> = { allow: 1, step_up: 2, restrict: 3, deny: 4 };

const prov = (over: Partial<DecisionProvenance> = {}): DecisionProvenance => ({
  policyVersion: over.policyVersion ?? 1,
  ...(over.coreNormalizationVersion === undefined ? {} : { coreNormalizationVersion: over.coreNormalizationVersion }),
  evaluatedOffline: over.evaluatedOffline ?? false,
  policyKnownSuperseded: over.policyKnownSuperseded ?? false,
});

const rec = (id: string, outcome: DecisionOutcome, p: Partial<DecisionProvenance> = {}): ReconcilableDecision => ({
  id,
  outcome,
  provenance: prov(p),
});

console.log("Decision-continuity proof\n");

// ── 0. the duplicated rank table has not drifted from policy.ts ──────────────
//
// `continuity.ts` keeps its own OUTCOME_RANK deliberately (policy.ts is inside the
// core normalization closure and this file is not). Duplication without a pin is how
// two tables quietly disagree, so the pin is here: both literals are read as text and
// compared. A rename on either side fails this rather than passing silently.
{
  const readRank = (relPath: string): string | null => {
    const text = readFileSync(join(repoRoot, relPath), "utf8");
    const m = /const OUTCOME_RANK: Record<DecisionOutcome, number> = \{([^}]*)\}/.exec(text);
    if (!m || m[1] === undefined) return null;
    return m[1].replace(/\s+/g, "");
  };
  const fromPolicy = readRank("lib/signalgrid-core/src/policy.ts");
  const fromContinuity = readRank("lib/signalgrid-core/src/continuity.ts");
  check("policy.ts still declares an OUTCOME_RANK table", fromPolicy !== null);
  check("continuity.ts still declares an OUTCOME_RANK table", fromContinuity !== null);
  check("the two OUTCOME_RANK tables are byte-identical", fromPolicy !== null && fromPolicy === fromContinuity);
}

// ── 1. the partial order ─────────────────────────────────────────────────────
check("equal provenance compares equal", compareProvenance(prov({ policyVersion: 3, coreNormalizationVersion: 2 }), prov({ policyVersion: 3, coreNormalizationVersion: 2 })) === "equal");
check("higher policy version dominates", compareProvenance(prov({ policyVersion: 4, coreNormalizationVersion: 2 }), prov({ policyVersion: 3, coreNormalizationVersion: 2 })) === "left_dominates");
check("higher core version dominates", compareProvenance(prov({ policyVersion: 3, coreNormalizationVersion: 3 }), prov({ policyVersion: 3, coreNormalizationVersion: 2 })) === "left_dominates");
check("lower on both is dominated", compareProvenance(prov({ policyVersion: 2, coreNormalizationVersion: 1 }), prov({ policyVersion: 3, coreNormalizationVersion: 2 })) === "right_dominates");
check("one axis up and one down is incomparable (staged rollout)", compareProvenance(prov({ policyVersion: 4, coreNormalizationVersion: 1 }), prov({ policyVersion: 3, coreNormalizationVersion: 2 })) === "incomparable");
// Absence is UNKNOWN, not zero. A stamped record must not win an axis on which
// nothing at all is known about its opponent.
check("absent core stamp is incomparable with a present one", compareProvenance(prov({ policyVersion: 3 }), prov({ policyVersion: 3, coreNormalizationVersion: 1 })) === "incomparable");
check("absent core stamp is incomparable even against a LOWER policy version", compareProvenance(prov({ policyVersion: 9 }), prov({ policyVersion: 1, coreNormalizationVersion: 1 })) === "incomparable");
check("two absent core stamps order by policy version alone", compareProvenance(prov({ policyVersion: 4 }), prov({ policyVersion: 3 })) === "left_dominates");
check("the order is antisymmetric on a sample", compareProvenance(prov({ policyVersion: 4, coreNormalizationVersion: 2 }), prov({ policyVersion: 3, coreNormalizationVersion: 2 })) === "left_dominates" && compareProvenance(prov({ policyVersion: 3, coreNormalizationVersion: 2 }), prov({ policyVersion: 4, coreNormalizationVersion: 2 })) === "right_dominates");

// ── 2. the headline scenarios ────────────────────────────────────────────────

// The unearned affirmative this file exists to refuse: the device was offline, holds
// the newer policy, and says allow. The cloud, fully connected, said deny.
{
  const r = reconcileDecisions([
    rec("cloud", "deny", { policyVersion: 7, coreNormalizationVersion: 2 }),
    rec("device", "allow", { policyVersion: 8, coreNormalizationVersion: 2, evaluatedOffline: true }),
  ]);
  check("offline authority with a newer policy cannot relax a connected deny", r.outcome === "deny");
  check("...and says so in a reason code", r.reasonCodes.includes("OFFLINE_AUTHORITY_CANNOT_RELAX"));
  check("...while still naming the device as the provenance authority", r.authorityIds.join(",") === "device");
}

// The un-stick path — the same shape with the authority CONNECTED.
{
  const r = reconcileDecisions([
    rec("stale-device", "deny", { policyVersion: 7, coreNormalizationVersion: 2 }),
    rec("cloud", "allow", { policyVersion: 8, coreNormalizationVersion: 2 }),
  ]);
  check("a connected authority under a newer policy DOES relax a stale deny", r.outcome === "allow");
  check("...and the relaxation is named, not silent", r.reasonCodes.includes("NEWER_PROVENANCE_RELAXED_STALE_DECISION"));
}

// Offline may still RAISE on its own — the veto is one-directional.
{
  const r = reconcileDecisions([
    rec("cloud", "allow", { policyVersion: 7, coreNormalizationVersion: 2 }),
    rec("device", "restrict", { policyVersion: 8, coreNormalizationVersion: 2, evaluatedOffline: true }),
  ]);
  check("an offline authority may raise the outcome on its own", r.outcome === "restrict");
  check("...without firing the cannot-relax veto", !r.reasonCodes.includes("OFFLINE_AUTHORITY_CANNOT_RELAX"));
}

// A node that knew a newer bundle was waiting and decided anyway is not an authority
// for a relaxation, even though it was fully online.
{
  const r = reconcileDecisions([
    rec("cloud", "restrict", { policyVersion: 7, coreNormalizationVersion: 2 }),
    rec("edge", "allow", { policyVersion: 8, coreNormalizationVersion: 2, policyKnownSuperseded: true }),
  ]);
  check("a knowingly-superseded authority cannot relax", r.outcome === "restrict");
  check("...and the reason distinguishes it from being offline", r.reasonCodes.includes("SUPERSEDED_POLICY_AUTHORITY_CANNOT_RELAX") && !r.reasonCodes.includes("OFFLINE_AUTHORITY_CANNOT_RELAX"));
}

// Incomparable maxima — a staged rollout where neither side is newer.
{
  const r = reconcileDecisions([
    rec("a", "allow", { policyVersion: 8, coreNormalizationVersion: 1 }),
    rec("b", "restrict", { policyVersion: 7, coreNormalizationVersion: 2 }),
  ]);
  check("incomparable maxima are contested", r.contested);
  check("...and a contested frontier resolves fail-closed", r.outcome === "restrict");
  check("...and says so", r.reasonCodes.includes("PROVENANCE_CONTESTED_FAIL_CLOSED"));
}

// Why an absent core stamp must be UNKNOWN rather than zero, stated as an outcome
// rather than as an ordering. Reading absence as 0 makes a stamped record dominate a
// legacy one on an axis where nothing is known about the legacy record — and a clean
// online authority that dominates is allowed to relax. So the shortcut converts a
// legacy `deny` into an `allow`. Under "unknown is incomparable" the pair is contested
// and the deny stands.
{
  const r = reconcileDecisions([
    rec("legacy", "deny", { policyVersion: 1 }),
    rec("stamped", "allow", { policyVersion: 1, coreNormalizationVersion: 1 }),
  ]);
  check("a stamped record cannot relax an UNSTAMPED record's deny", r.outcome === "deny");
  check("...because the pair is contested, not ordered", r.contested && r.reasonCodes.includes("PROVENANCE_CONTESTED_FAIL_CLOSED"));
}

// Uniform provenance: nothing superseded anything, so the join is the whole answer.
{
  const r = reconcileDecisions([
    rec("a", "allow", { policyVersion: 7, coreNormalizationVersion: 2 }),
    rec("b", "step_up", { policyVersion: 7, coreNormalizationVersion: 2 }),
  ]);
  check("uniform provenance joins fail-closed", r.outcome === "step_up");
  check("...and is reported as uniform rather than contested", r.reasonCodes.includes("PROVENANCE_UNIFORM_ACROSS_RECORDS") && !r.contested);
}

// A single record reconciles to itself.
{
  const r = reconcileDecisions([rec("only", "allow", { policyVersion: 1, coreNormalizationVersion: 1 })]);
  check("a lone record reconciles to itself", r.outcome === "allow" && r.considered === 1 && r.authorityIds.join(",") === "only");
}

// ── 3. the standing bound ────────────────────────────────────────────────────

{
  const records = [rec("device", "allow", { policyVersion: 8, coreNormalizationVersion: 2, evaluatedOffline: true })];
  const within = reconcileDecisions(records, { standingBound: { maxStandingSeconds: 3600, elapsedSecondsById: { device: 600 } } });
  check("an offline decision inside its bound still stands", within.outcome === "allow" && within.expiredIds.length === 0);

  const beyond = reconcileDecisions(records, { standingBound: { maxStandingSeconds: 3600, elapsedSecondsById: { device: 7200 } } });
  check("an offline decision past its bound is raised to the floor", beyond.outcome === "step_up");
  check("...and the expiry is reported", beyond.expiredIds.join(",") === "device" && beyond.reasonCodes.includes("OFFLINE_STANDING_BOUND_EXCEEDED"));

  // The row-45 move: an UNSTATED age must not buy unbounded standing.
  const unstated = reconcileDecisions(records, { standingBound: { maxStandingSeconds: 3600, elapsedSecondsById: {} } });
  check("an offline decision with an UNSTATED age expires (silence buys nothing)", unstated.outcome === "step_up");
  check("...and is reported as unstated rather than exceeded", unstated.reasonCodes.includes("OFFLINE_STANDING_AGE_UNSTATED") && !unstated.reasonCodes.includes("OFFLINE_STANDING_BOUND_EXCEEDED"));

  // Expiry RAISES; it never drops the record out of the set.
  const expiredDeny = reconcileDecisions([rec("device", "deny", { policyVersion: 8, coreNormalizationVersion: 2, evaluatedOffline: true })], { standingBound: { maxStandingSeconds: 60, elapsedSecondsById: { device: 999 } } });
  check("expiry never LOWERS an outcome (a deny stays a deny)", expiredDeny.outcome === "deny");

  // The bound is scoped to offline decisions — an online one is refreshed by the next
  // online evaluation, so expiring it would restrict for no reachable reason.
  const online = reconcileDecisions([rec("cloud", "allow", { policyVersion: 8, coreNormalizationVersion: 2 })], { standingBound: { maxStandingSeconds: 1, elapsedSecondsById: {} } });
  check("the standing bound does not touch an online decision", online.outcome === "allow" && online.expiredIds.length === 0);

  // A caller-chosen floor is honoured.
  const denyFloor = reconcileDecisions(records, { standingBound: { maxStandingSeconds: 1, elapsedSecondsById: { device: 2 }, floor: "deny" } });
  check("a caller-posed floor is honoured", denyFloor.outcome === "deny");
}

// ── 4. refusals — the reconciler never guesses ───────────────────────────────

const refuses = (name: string, fn: () => unknown): void => {
  try {
    fn();
    check(name, false);
  } catch (err) {
    check(name, err instanceof CoreError && err.code === "validation");
  }
};

refuses("reconciling zero decisions is refused, not defaulted", () => reconcileDecisions([]));
refuses("an omitted evaluatedOffline is refused (omission is not 'online')", () =>
  reconcileDecisions([{ id: "x", outcome: "allow", provenance: { policyVersion: 1, policyKnownSuperseded: false } as DecisionProvenance }]));
refuses("an omitted policyKnownSuperseded is refused (omission is not 'current')", () =>
  reconcileDecisions([{ id: "x", outcome: "allow", provenance: { policyVersion: 1, evaluatedOffline: false } as DecisionProvenance }]));
refuses("an unknown outcome is refused", () =>
  reconcileDecisions([{ id: "x", outcome: "permit" as DecisionOutcome, provenance: prov() }]));
refuses("a non-integer policyVersion is refused", () =>
  reconcileDecisions([rec("x", "allow", { policyVersion: 1.5 })]));
refuses("a zero policyVersion is refused", () => reconcileDecisions([rec("x", "allow", { policyVersion: 0 })]));
refuses("an empty id is refused", () => reconcileDecisions([rec("   ", "allow")]));
refuses("two different answers under one id is refused, not reconciled", () =>
  reconcileDecisions([rec("dup", "allow"), rec("dup", "deny")]));
refuses("a negative elapsed is refused (the clock attack in another coat)", () =>
  reconcileDecisions([rec("x", "allow", { evaluatedOffline: true })], { standingBound: { maxStandingSeconds: 10, elapsedSecondsById: { x: -1 } } }));
refuses("a non-finite elapsed is refused", () =>
  reconcileDecisions([rec("x", "allow", { evaluatedOffline: true })], { standingBound: { maxStandingSeconds: 10, elapsedSecondsById: { x: Number.NaN } } }));
refuses("a zero maxStandingSeconds is refused", () =>
  reconcileDecisions([rec("x", "allow", { evaluatedOffline: true })], { standingBound: { maxStandingSeconds: 0, elapsedSecondsById: {} } }));
refuses("an unknown floor is refused", () =>
  reconcileDecisions([rec("x", "allow", { evaluatedOffline: true })], { standingBound: { maxStandingSeconds: 10, elapsedSecondsById: {}, floor: "maybe" as DecisionOutcome } }));
refuses("mostRestrictiveOutcome refuses an empty set", () => mostRestrictiveOutcome([]));

// A duplicate id carrying an IDENTICAL record is de-duplicated, not refused — that is
// an at-least-once delivery, which is the normal case for any real sync transport.
{
  const same = rec("dup", "allow", { policyVersion: 3, coreNormalizationVersion: 1 });
  const r = reconcileDecisions([same, { ...same }]);
  check("an identical re-delivery is de-duplicated rather than refused", r.considered === 1 && r.outcome === "allow");
}

// ── 5. exhaustive laws ───────────────────────────────────────────────────────
//
// The alphabet: every shape a record can take over two policy versions, two core
// versions plus absence, both flags, and all four outcomes.

const PROVENANCES: DecisionProvenance[] = [];
for (const policyVersion of [1, 2]) {
  for (const core of [undefined, 1, 2]) {
    for (const evaluatedOffline of [false, true]) {
      for (const policyKnownSuperseded of [false, true]) {
        PROVENANCES.push(prov({ policyVersion, coreNormalizationVersion: core, evaluatedOffline, policyKnownSuperseded }));
      }
    }
  }
}
const ALPHABET: ReconcilableDecision[] = [];
for (const p of PROVENANCES) {
  for (const outcome of OUTCOMES) ALPHABET.push({ id: "", outcome, provenance: p });
}
const withId = (r: ReconcilableDecision, id: string): ReconcilableDecision => ({ ...r, id });

// L1/L2 at n=2, exhaustive.
let pairSets = 0;
let orderMismatches = 0;
let idempotenceMismatches = 0;
for (const a of ALPHABET) {
  for (const b of ALPHABET) {
    pairSets += 1;
    const ra = withId(a, "a");
    const rb = withId(b, "b");
    const forward = reconcileDecisions([ra, rb]);
    const reverse = reconcileDecisions([rb, ra]);
    if (forward.outcome !== reverse.outcome || forward.reasonCodes.join("|") !== reverse.reasonCodes.join("|")) orderMismatches += 1;
    // Re-delivering `a` under a fresh id must not move the answer: same content, so
    // the set of provenances and the set of outcomes are both unchanged.
    const dupd = reconcileDecisions([ra, rb, withId(a, "a2")]);
    if (dupd.outcome !== forward.outcome) idempotenceMismatches += 1;
  }
}
check(`L1: order-independent over all ${pairSets.toLocaleString("en-US")} ordered pairs`, orderMismatches === 0);
check("L2: re-delivering a record never moves the outcome (pairs)", idempotenceMismatches === 0);

// L1 at n=3, exhaustive over the sub-alphabet that varies both version axes and the
// offline flag (the three inputs the order could plausibly interact with).
const SUB: ReconcilableDecision[] = ALPHABET.filter(
  (r) => !r.provenance.policyKnownSuperseded && (r.outcome === "allow" || r.outcome === "deny"),
);
const PERMS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
];
let tripleSets = 0;
let tripleMismatches = 0;
for (const a of SUB) {
  for (const b of SUB) {
    for (const c of SUB) {
      tripleSets += 1;
      const set = [withId(a, "a"), withId(b, "b"), withId(c, "c")];
      const base = reconcileDecisions(set);
      for (const perm of PERMS) {
        const permuted = reconcileDecisions(perm.map((i) => set[i] as ReconcilableDecision));
        if (permuted.outcome !== base.outcome || permuted.reasonCodes.join("|") !== base.reasonCodes.join("|")) {
          tripleMismatches += 1;
        }
      }
    }
  }
}
check(`L1: order-independent over all ${tripleSets.toLocaleString("en-US")} three-record sets`, tripleMismatches === 0);

// L3: a record that does NOT dominate the existing frontier can never relax the
// outcome. This is the sync-payload safety property stated as a measurement.
let monotonicityChecks = 0;
let relaxations = 0;
let dominatingRelaxations = 0;
for (const a of SUB) {
  for (const b of SUB) {
    const ra = withId(a, "a");
    const rb = withId(b, "b");
    const base = reconcileDecisions([ra, rb]);
    for (const c of ALPHABET) {
      monotonicityChecks += 1;
      const rc = withId(c, "c");
      const next = reconcileDecisions([ra, rb, rc]);
      if (RANK[next.outcome] >= RANK[base.outcome]) continue;
      // The outcome relaxed. That is only legitimate if `c` dominates every id that
      // was on the frontier before it arrived.
      const dominatesFrontier = base.authorityIds.every((id) => {
        const prior = id === "a" ? ra : rb;
        return compareProvenance(rc.provenance, prior.provenance) === "left_dominates";
      });
      relaxations += 1;
      if (!dominatesFrontier) dominatingRelaxations += 1;
    }
  }
}
check(`L3: over ${monotonicityChecks.toLocaleString("en-US")} additions, no non-dominating record ever relaxed the outcome`, dominatingRelaxations === 0);
check("L3: and the sweep did observe relaxations, so the check is not vacuous", relaxations > 0);

// L4/L5 as a sweep: whenever the frontier is uncontested and any member decided
// offline or knowingly-superseded, the outcome must equal the fail-closed join of the
// whole set.
let vetoOpportunities = 0;
let vetoFailures = 0;
let unstickOpportunities = 0;
let unstickFailures = 0;
for (const a of ALPHABET) {
  for (const b of ALPHABET) {
    const ra = withId(a, "a");
    const rb = withId(b, "b");
    const r = reconcileDecisions([ra, rb]);
    if (r.contested) continue;
    const frontier = [ra, rb].filter((x) => r.authorityIds.includes(x.id));
    const compromised = frontier.some((x) => x.provenance.evaluatedOffline || x.provenance.policyKnownSuperseded);
    const failClosed = mostRestrictiveOutcome([a.outcome, b.outcome]);
    if (compromised) {
      vetoOpportunities += 1;
      if (r.outcome !== failClosed) vetoFailures += 1;
    } else if (frontier.length === 1 && RANK[failClosed] > RANK[(frontier[0] as ReconcilableDecision).outcome]) {
      unstickOpportunities += 1;
      if (r.outcome !== (frontier[0] as ReconcilableDecision).outcome) unstickFailures += 1;
    }
  }
}
check(`L4: over ${vetoOpportunities.toLocaleString("en-US")} compromised-frontier pairs, the outcome was always the fail-closed join`, vetoFailures === 0);
check(`L5: over ${unstickOpportunities.toLocaleString("en-US")} clean-authority pairs, the newer provenance always carried`, unstickFailures === 0);
check("L4/L5: both sweeps found opportunities (neither is vacuous)", vetoOpportunities > 0 && unstickOpportunities > 0);

// The headline safety statement, measured rather than asserted: across the whole
// pair space, how many combinations reconcile to `allow` while at least one record
// says something stricter? Must be zero — that is the only way a reconciliation can
// manufacture a grant.
let manufacturedGrants = 0;
for (const a of ALPHABET) {
  for (const b of ALPHABET) {
    const r = reconcileDecisions([withId(a, "a"), withId(b, "b")]);
    if (r.outcome !== "allow") continue;
    const strictest = mostRestrictiveOutcome([a.outcome, b.outcome]);
    if (strictest === "allow") continue;
    // A relaxation to `allow` is legitimate only from a clean, strictly-newer authority.
    const winner = r.authorityIds.length === 1 ? (r.authorityIds[0] === "a" ? a : b) : null;
    const clean = winner !== null && !winner.provenance.evaluatedOffline && !winner.provenance.policyKnownSuperseded && winner.outcome === "allow";
    if (!clean) manufacturedGrants += 1;
  }
}
check("no pair reconciles to allow without a clean, strictly-newer authority saying allow", manufacturedGrants === 0);

// ── report ──────────────────────────────────────────────────────────────────

const total = passed + failures.length;
console.log(`\nDecision-continuity proof: ${passed}/${total} assertions passed`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
console.log(
  `figures=pairs=${pairSets},triples=${tripleSets},monotonicity=${monotonicityChecks},veto=${vetoOpportunities},unstick=${unstickOpportunities}`,
);
if (failures.length > 0) {
  console.error("Failed assertions:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  "Which decision wins is order-independent, idempotent, un-relaxable by a stale or offline record, and still able to un-stick on a connected newer policy.",
);
