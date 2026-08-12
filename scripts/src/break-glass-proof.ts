// Break-glass proof — OFFLINE and deterministic.
//
// Asserted, in order of how much each matters:
//   1. THE CEILING NEVER IMPEDES CARE. Over the ENTIRE state space, including the
//      worst state the model can express, this dimension never returns step_up,
//      restrict, deny or escalate. It is the only family here that cannot step up,
//      and the reason is clinical: the override already happened, and inserting
//      friction between a clinician and a patient is a safety harm no governance
//      value justifies.
//   2. A MISSING JUSTIFICATION IS NEVER SILENCE. The axis whose absence IS an
//      answer — asserted at the normalizer and again at the evaluator.
//   3. NO ACCOUNTABILITY GAP REACHES THE CLEAN VERDICT, with the clean set pinned
//      to exact SHAPES rather than a count.
//   4. THE POSTURE MAP IS PINNED AS A SHAPE (the uem registry-gap lesson).
//   5. NON-VACUITY throughout.

import {
  BREAK_GLASS_CONTRACT,
  BREAK_GLASS_FIXTURES,
  evaluateBreakGlass,
  evaluateBreakGlassFixture,
  normalizeBreakGlassRecord,
  resolveBreakGlassConnector,
} from "@workspace/integrations/break-glass";
import type {
  AssignmentAtInvocation,
  ExpiryState,
  InvocationScope,
  JustificationState,
  NormalizedBreakGlass,
  ReviewState,
} from "@workspace/integrations/break-glass";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Break-glass proof — was this emergency override accountable?\n");

// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// The first draft of this family shipped NO gate, reasoning that it reads the host
// application rather than a vendor. The connector-discipline check refused it and was
// right: a break-glass record lives in the EHR's audit surface, and reading it is a
// vendor call. The gate exists because a check insisted on an explicit answer.
{
  const T = { readBreakGlassInvocation: async () => ({}) };
  const FULL = {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    BREAK_GLASS_EHR_PLANE: "epic",
    BREAK_GLASS_ACCESS_TOKEN: "t",
  };
  check("default env (dev tier) refuses live", resolveBreakGlassConnector({}, T).mode === "fixture");
  check("ISOLATED: tier alone blocks live", resolveBreakGlassConnector({ ...FULL, SIGNALGRID_TIER: "dev" }, T).mode === "fixture");
  check("ISOLATED: the LIVE_INTEGRATIONS flag alone blocks live", resolveBreakGlassConnector({ ...FULL, SIGNALGRID_LIVE_INTEGRATIONS: "false" }, T).mode === "fixture");
  check("ISOLATED: an unrecognised EHR plane alone blocks live", resolveBreakGlassConnector({ ...FULL, BREAK_GLASS_EHR_PLANE: "nope" }, T).mode === "fixture");
  check("ISOLATED: a missing credential alone blocks live", resolveBreakGlassConnector({ ...FULL, BREAK_GLASS_ACCESS_TOKEN: "" }, T).mode === "fixture");
  check("no transport refuses even with every gate satisfied — this repo ships none", resolveBreakGlassConnector(FULL).mode === "fixture");
  check("NON-VACUITY: with every gate satisfied AND a transport injected, the gate does open", resolveBreakGlassConnector(FULL, T).mode === "live");
}

const JUSTIFICATION: JustificationState[] = ["recorded", "absent", "unreadable"];
const SCOPE: InvocationScope[] = ["single_encounter", "broad", "unknown"];
const EXPIRY: ExpiryState[] = ["bounded", "unbounded", "unknown"];
const REVIEW: ReviewState[] = ["reviewed", "pending", "never_reviewed", "unknown"];
const ASSIGNMENT: AssignmentAtInvocation[] = ["not_assigned", "assigned", "unknown"];
const INTEGRITY = ["intact", "malformed"] as const;

const space: NormalizedBreakGlass[] = [];
for (const justification of JUSTIFICATION)
  for (const scope of SCOPE)
    for (const expiry of EXPIRY)
      for (const review of REVIEW)
        for (const assignmentAtInvocation of ASSIGNMENT)
          for (const reportIntegrity of INTEGRITY)
            space.push({ invocationRef: "i", justification, scope, expiry, review, assignmentAtInvocation, reportIntegrity });

const SPACE = space.length;
console.log(`\n  normalized state space: ${SPACE} states\n`);
check(
  `the swept space is the full cross-product (${SPACE})`,
  SPACE === JUSTIFICATION.length * SCOPE.length * EXPIRY.length * REVIEW.length * ASSIGNMENT.length * INTEGRITY.length,
);

const verdicts = space.map((s) => ({ state: s, verdict: evaluateBreakGlass(s) }));

// ── 1. THE CEILING — the headline law ────────────────────────────────────────
const LEGAL = new Set(["none", "monitor", "alert"]);
check(
  "the ceiling holds over the WHOLE space: never step_up, never restrict, never deny, never escalate",
  verdicts.every(({ verdict }) => LEGAL.has(verdict.recommendedAction)),
);
check(
  "…including the worst expressible state — the model cannot construct a blocking verdict",
  LEGAL.has(
    evaluateBreakGlass({
      invocationRef: "worst", justification: "absent", scope: "broad", expiry: "unbounded",
      review: "never_reviewed", assignmentAtInvocation: "assigned", reportIntegrity: "malformed",
    }).recommendedAction,
  ),
);
check(
  "the contract states the ceiling and the promise, and both match the measured behaviour",
  BREAK_GLASS_CONTRACT.ceiling === "alert" &&
    BREAK_GLASS_CONTRACT.neverImpedesCare === true &&
    BREAK_GLASS_CONTRACT.actuatorsExposed === false &&
    // Compared as a STRING on purpose. TypeScript rejects `recommendedAction !==
    // "step_up"` outright — "these types have no overlap" — which is the type system
    // stating the ceiling more strongly than any assertion could. The runtime check is
    // kept anyway, widened through String(), so if someone ever adds `step_up` to
    // `BreakGlassAction` the compile error vanishes and THIS fails instead of the
    // guarantee silently evaporating.
    verdicts.every(({ verdict }) => String(verdict.recommendedAction) !== "step_up"),
);
check(
  "NON-VACUITY: `alert` IS reachable, so the ceiling is a ceiling and not a description of nothing",
  verdicts.some(({ verdict }) => verdict.recommendedAction === "alert"),
);

// ── 2. A MISSING JUSTIFICATION IS NEVER SILENCE ──────────────────────────────
{
  const missing = normalizeBreakGlassRecord({ invocationRef: "x" });
  check(
    "a record with NO justification field normalizes to `absent`, not `unknown` — its silence IS the answer",
    missing.justification === "absent",
  );
  check(
    "…while every OTHER absent axis falls to its ignorance member, so the asymmetry is deliberate and visible",
    missing.scope === "unknown" && missing.expiry === "unknown" && missing.review === "unknown" &&
      missing.assignmentAtInvocation === "unknown",
  );
  const silent = evaluateBreakGlassFixture("no-justification-captured")!;
  check(
    `an override with no captured reason ALERTS and says so by name (${silent.reasonCode})`,
    silent.reasonCode === "BREAK_GLASS_UNJUSTIFIED" && silent.recommendedAction === "alert",
  );
  check(
    "…and its posture is `unaccountable`, which is the honest word for it",
    silent.posture === "unaccountable",
  );
}

// ── 2b. THE MALFORMED GUARD, ONE FIELD AT A TIME ─────────────────────────────
//
// EACH enum field must trigger the malformed path ON ITS OWN. A first draft that
// tests one field and calls the guard covered is exactly what the mutation guard
// punishes: delete any single disjunct and no assertion notices, because some OTHER
// field's disjunct is still carrying the case. A guard over five fields needs five
// controls plus a clean control, not one blanket assertion.
{
  const GOOD = {
    invocationRef: "ctl",
    justification: "recorded",
    scope: "single_encounter",
    expiry: "bounded",
    review: "reviewed",
    assignmentAtInvocation: "not_assigned",
  } as const;

  check(
    "CONTROL: the all-valid record is `intact` — so the per-field cases below fail for their own reason",
    normalizeBreakGlassRecord({ ...GOOD }).reportIntegrity === "intact",
  );

  for (const field of [
    "justification",
    "scope",
    "expiry",
    "review",
    "assignmentAtInvocation",
  ] as const) {
    const one = normalizeBreakGlassRecord({ ...GOOD, [field]: "not-a-real-value" });
    check(
      `an unrecognised \`${field}\` ALONE makes the record malformed — this axis's guard is falsifiable by itself`,
      one.reportIntegrity === "malformed",
    );
  }
}

// ── 2c. A RECORD THAT CANNOT BE IDENTIFIED IS NOT A RECORD ───────────────────
//
// Without a reference there is nothing for a compliance owner to pull up, so the
// whole record is malformed rather than merely sparse. Asserted on BOTH observable
// consequences: an unidentifiable record must not carry a null through the typed
// surface, and it must not read `intact` just because no field was unrecognised.
{
  const anon = normalizeBreakGlassRecord({ justification: "recorded" });
  check(
    "a record with no reference at all is malformed — an override nobody can look up is not accounted for",
    anon.reportIntegrity === "malformed",
  );
  check(
    "…and its reference is the empty string, never a null leaking through the typed surface",
    anon.invocationRef === "",
  );
  check(
    "…and it does NOT keep the justification it claimed — an unidentifiable record grades on nothing",
    anon.justification === "absent",
  );
  check(
    "NON-VACUITY: `id` is accepted as the reference alias, so the null branch is not just always taken",
    normalizeBreakGlassRecord({ id: "alias" }).invocationRef === "alias",
  );
}

// ── 3. NO ACCOUNTABILITY GAP REACHES THE CLEAN VERDICT ───────────────────────
const clean = verdicts.filter(({ verdict }) => verdict.recommendedAction === "none");
check(
  "NOT ONE state with a missing or unreadable justification is clean",
  clean.every(({ state }) => state.justification === "recorded"),
);
check(
  "…nor any broad scope, unbounded expiry, or never-reviewed override",
  clean.every(({ state }) => state.scope !== "broad" && state.expiry !== "unbounded" && state.review !== "never_reviewed"),
);
check(
  "…nor any override by someone who was ALREADY assigned — a bypass that bypassed nothing",
  clean.every(({ state }) => state.assignmentAtInvocation !== "assigned"),
);
check(
  "…nor any malformed record",
  clean.every(({ state }) => state.reportIntegrity === "intact"),
);
// The clean set is pinned by EQUALITY to one enumerated shape, not by a list of
// negative conditions.
//
// The first draft used negatives — `scope !== "broad"`, `expiry !== "unbounded"` — and
// the mutation guard showed exactly what that misses: delete the `scope === "unknown"`
// disjunct from the UNASSESSED branch and unknown-scope records go clean, while every
// negative condition still holds, because `unknown` is not `broad`. Ignorance reading
// as health, passing a proof written to forbid it. Negatives can only exclude the bad
// states someone remembered to name; an equality pin excludes everything else by
// construction, including the states nobody thought of.
const cleanShapes = new Set(clean.map(({ state }) => `${state.scope}|${state.expiry}|${state.review}|${state.assignmentAtInvocation}`));
check(
  `the clean set is EXACTLY one shape, pinned by equality (${cleanShapes.size} distinct)`,
  cleanShapes.size === 1 && cleanShapes.has("single_encounter|bounded|reviewed|not_assigned"),
);
check(
  "NOT ONE clean state has an unknown governance axis — silence about scope, expiry, review or assignment is never health",
  clean.every(({ state }) =>
    state.scope !== "unknown" &&
    state.expiry !== "unknown" &&
    state.review !== "unknown" &&
    state.assignmentAtInvocation !== "unknown"),
);
{
  // …and each of those four axes is independently load-bearing: a record clean on
  // every OTHER axis, ignorant on just this one, must still be held back.
  const AXES = ["scope", "expiry", "review", "assignmentAtInvocation"] as const;
  for (const axis of AXES) {
    const solo = verdicts.filter(({ state }) =>
      state.reportIntegrity === "intact" &&
      state.justification === "recorded" &&
      AXES.every((a) => (a === axis ? state[a] === "unknown" : state[a] !== "unknown")) &&
      state.scope !== "broad" && state.expiry !== "unbounded" &&
      state.review !== "never_reviewed" && state.review !== "pending" &&
      state.assignmentAtInvocation !== "assigned");
    check(
      `an override clean everywhere but \`${axis}\`, where it says nothing, reads UNASSESSED — not accountable (${solo.length} states)`,
      solo.length > 0 && solo.every(({ verdict }) =>
        verdict.reasonCode === "BREAK_GLASS_UNASSESSED" && verdict.posture === "unassessed"),
    );
  }
}
check(
  `NON-VACUITY: the clean verdict IS reachable (${clean.length} states), so the checks above are not vacuous`,
  clean.length > 0,
);

// ── 3b. SPECIFICITY BEATS ARRIVAL ORDER ──────────────────────────────────────
//
// When two findings tie on action rank, the MORE SPECIFIC one is what a compliance
// owner needs to read first — "this person was already assigned to the patient" is a
// sharper statement than "the scope was broad", and it names a different failure.
//
// `BREAK_GLASS_NOT_NEEDED` is the most specific alert and it is pushed LAST, so this
// is only true if the equal-rank tie-break actually runs. Disable that tie-break and
// the reduce silently falls back to arrival order — the `service-lifecycle` defect.
// Nothing else in this proof would notice, because the ACTION is `alert` either way
// and only the reason code changes.
{
  const assigned = verdicts.filter(({ state }) =>
    state.assignmentAtInvocation === "assigned" && state.reportIntegrity === "intact");
  check(
    `every intact override by an ALREADY-assigned invoker reports BREAK_GLASS_NOT_NEEDED (${assigned.length} states) — the most specific alert wins, though it arrives last`,
    assigned.length > 0 && assigned.every(({ verdict }) => verdict.reasonCode === "BREAK_GLASS_NOT_NEEDED"),
  );
  // Non-vacuity for the tie-break specifically: arrival order and specificity have to
  // DISAGREE somewhere, or the check above would hold for the wrong reason.
  const contested = assigned.filter(({ state }) =>
    state.justification !== "recorded" || state.scope === "broad" ||
    state.expiry === "unbounded" || state.review === "never_reviewed");
  check(
    `NON-VACUITY: in ${contested.length} of those an EARLIER alert also fired, so arrival order genuinely loses`,
    contested.length > 0,
  );
  // And the ordering is not merely "last wins" either — a malformed record is more
  // specific still, and it beats NOT_NEEDED despite arriving first.
  const malformedAssigned = verdicts.filter(({ state }) =>
    state.assignmentAtInvocation === "assigned" && state.reportIntegrity === "malformed");
  check(
    `…while a malformed record still reports REPORT_MALFORMED (${malformedAssigned.length} states) — specificity, not arrival, is the rule in both directions`,
    malformedAssigned.length > 0 && malformedAssigned.every(({ verdict }) => verdict.reasonCode === "REPORT_MALFORMED"),
  );
}

// ── 4. THE POSTURE MAP, pinned as a SHAPE ────────────────────────────────────
{
  const EXPECTED: Record<string, string> = {
    BREAK_GLASS_ACCOUNTABLE: "accountable",
    BREAK_GLASS_UNASSESSED: "unassessed",
    REPORT_MALFORMED: "unassessed",
    BREAK_GLASS_NOT_NEEDED: "unaccountable",
    BREAK_GLASS_UNJUSTIFIED: "unaccountable",
    BREAK_GLASS_JUSTIFICATION_UNREADABLE: "under_documented",
    BREAK_GLASS_SCOPE_BROAD: "under_documented",
    BREAK_GLASS_UNBOUNDED: "under_documented",
    BREAK_GLASS_NEVER_REVIEWED: "under_documented",
    BREAK_GLASS_REVIEW_PENDING: "under_documented",
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
  const bad = [...observed].filter(([r, s]) => EXPECTED[r] !== [...s][0]).map(([r, s]) => `${r}→${[...s][0]} (expected ${EXPECTED[r] ?? "UNLISTED"})`);
  check(`the reason→posture map matches what the source claims${bad.length ? `: ${bad.join(", ")}` : ""}`, bad.length === 0);
  const postures = new Set([...observed.values()].flatMap((s) => [...s]));
  check(`NON-VACUITY: the space reaches ${postures.size} distinct postures, so the map is not collapsed`, postures.size >= 3);
}

// ── 5. A working review queue is not noise ───────────────────────────────────
{
  const pending = evaluateBreakGlassFixture("review-queue-working")!;
  const never = evaluateBreakGlassFixture("standing-bypass")!;
  check(
    `a review queue with this item IN it monitors rather than alerts (${pending.recommendedAction}) — a functioning backlog is not a finding`,
    pending.recommendedAction === "monitor",
  );
  check(
    `…while NO review queue at all alerts (${never.recommendedAction}) — the two are different failures with different owners`,
    never.recommendedAction === "alert" && pending.recommendedAction !== never.recommendedAction,
  );
  const dark = evaluateBreakGlassFixture("no-programme-evidence")!;
  check(
    "no programme evidence reads `unassessed`, never `accountable` — silence about governance is not governance",
    dark.posture === "unassessed" && dark.recommendedAction !== "none",
  );
}

console.log("");
console.log(`figures=states=${SPACE},clean=${clean.length},cleanShapes=${cleanShapes.size},fixtures=${Object.keys(BREAK_GLASS_FIXTURES).length}`);
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { console.error("FAILED:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
