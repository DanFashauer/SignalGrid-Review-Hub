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
  FALLBACK_EVENT_TYPES,
  MANUAL_FALLBACK_FIXTURES,
  evaluateBreakGlass,
  evaluateBreakGlassFixture,
  evaluateManualFallback,
  evaluateManualFallbackFixture,
  normalizeBreakGlassRecord,
  normalizeManualFallbackSequence,
  resolveBreakGlassConnector,
} from "@workspace/integrations/break-glass";
import type {
  AssignmentAtInvocation,
  BadgeAttempt,
  ExpiryState,
  FallbackSequenceIntegrity,
  InvocationScope,
  JustificationState,
  ManualCredentialCheck,
  NormalizedBreakGlass,
  NormalizedManualFallback,
  ReviewState,
} from "@workspace/integrations/break-glass";
import { EVENT_TYPES, validateEvent } from "@workspace/event-contract";

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

// ── 6. THE BADGE→MANUAL FALLBACK SEQUENCE ────────────────────────────────────
//
// A DISTINCT surface from everything above. The accountability grader tops out at
// `alert` because it stands on the EHR plane where care must never be impeded. THIS
// grades a device check-out at a charging dock — badge tap fails, the clinician falls
// back to an audited manual credential — and denying a shared device is not a clinical
// harm, so it CAN deny and step up. Fail-closed is the whole game: ignorance tightens.
console.log("\n  ── the badge→manual fallback sequence ──\n");
{
  // 6a. VOCABULARY IS BOUND TO THE REAL EVENT CONTRACT. The normalizer keys on event
  // type strings; if any drifts from @workspace/event-contract this fails, so the
  // sequence is expressed in the contract's terms, not a private copy of them.
  check(
    "every fallback event type is a real member of the canonical event contract",
    Object.values(FALLBACK_EVENT_TYPES).every((t) => (EVENT_TYPES as readonly string[]).includes(t)),
  );
  check(
    "NON-VACUITY: the contract does NOT contain a made-up type, so the binding above can fail",
    !(EVENT_TYPES as readonly string[]).includes("checkout_teleported"),
  );

  // 6b. THE NAMED OUTCOMES — allow, deny and step_up all reachable, each by name.
  const F = (n: string) => evaluateManualFallbackFixture(n)!;
  const cases: Array<[string, string, string]> = [
    ["badge-succeeded-no-fallback", "allow", "FALLBACK_BADGE_CHECKOUT_OK"],
    ["badge-failed-manual-verified-accountable", "allow", "FALLBACK_GRANTED_ACCOUNTABLE"],
    ["badge-failed-manual-verified-underdocumented", "step_up", "FALLBACK_GRANTED_NEEDS_AUDIT"],
    ["badge-failed-credential-rejected", "deny", "FALLBACK_CREDENTIAL_REJECTED"],
    ["badge-failed-credential-unknown", "deny", "FALLBACK_CREDENTIAL_UNVERIFIED"],
    ["badge-state-unknown", "step_up", "FALLBACK_BADGE_STATE_UNKNOWN"],
    ["badge-succeeded-manual-used", "step_up", "FALLBACK_NOT_NEEDED_BADGE_OK"],
    ["sequence-malformed", "deny", "FALLBACK_SEQUENCE_MALFORMED"],
    ["audit-malformed", "deny", "FALLBACK_AUDIT_MALFORMED"],
  ];
  for (const [name, decision, reason] of cases) {
    const v = F(name);
    check(
      `fixture \`${name}\` → ${decision} / ${reason} (${v.decision} / ${v.reasonCode})`,
      v.decision === decision && v.reasonCode === reason,
    );
  }
  const decisions = new Set(cases.map(([n]) => F(n).decision));
  check(
    `NON-VACUITY: all three decisions are reachable across the fixtures (${[...decisions].sort().join(", ")})`,
    decisions.has("allow") && decisions.has("deny") && decisions.has("step_up"),
  );

  // 6c. FAIL-CLOSED CONTROLS — a mutated input that MUST flip the verdict. Each takes
  // the sole allow state and corrupts ONE signal; every one must fall away from allow.
  const base = MANUAL_FALLBACK_FIXTURES["badge-failed-manual-verified-accountable"];
  check(
    "CONTROL baseline: the untouched allow state does allow — so the mutations below fail for their own reason",
    evaluateManualFallback(base).decision === "allow",
  );
  const flipCredUnknown = evaluateManualFallback({ ...base, manualCredential: "unknown" });
  check(
    `FAIL-CLOSED: credential verified→unknown flips allow→deny (${flipCredUnknown.decision}) — an unverifiable person gets no device`,
    flipCredUnknown.decision === "deny" && flipCredUnknown.reasonCode === "FALLBACK_CREDENTIAL_UNVERIFIED",
  );
  const flipBadgeUnknown = evaluateManualFallback({ ...base, badgeAttempt: "unknown" });
  check(
    `FAIL-CLOSED: badge failed→unknown flips allow→step_up (${flipBadgeUnknown.decision}) — an unconfirmed precondition is not granted silently`,
    flipBadgeUnknown.decision === "step_up" && flipBadgeUnknown.reasonCode === "FALLBACK_BADGE_STATE_UNKNOWN",
  );
  const flipAudit = evaluateManualFallback({ ...base, override: normalizeBreakGlassRecord({}) });
  check(
    `FAIL-CLOSED: an unauditable manual check-out flips allow→deny (${flipAudit.decision}) — not even friction, a refusal`,
    flipAudit.decision === "deny" && flipAudit.reasonCode === "FALLBACK_AUDIT_MALFORMED",
  );
  const flipMalformed = evaluateManualFallback({ ...base, sequenceIntegrity: "malformed" });
  check(
    `FAIL-CLOSED: a malformed event stream flips allow→deny (${flipMalformed.decision})`,
    flipMalformed.decision === "deny" && flipMalformed.reasonCode === "FALLBACK_SEQUENCE_MALFORMED",
  );

  // 6d. THE ALLOW SET, PINNED BY EQUALITY over the whole sequence state space. The
  // negatives-only lesson from section 3: only an equality pin excludes the states
  // nobody named. Sweep every combination and assert allow is EXACTLY the enumerated set.
  //
  // THE ALLOW SET GREW FROM ONE SHAPE TO TWO REASONS, and the pin is updated to match:
  //   - FALLBACK_BADGE_CHECKOUT_OK — a NORMAL successful badge check-out where no manual
  //     fallback was attempted. The override record is irrelevant (the manual path was
  //     never used), so this reason allows across all three override shapes.
  //   - FALLBACK_GRANTED_ACCOUNTABLE — the genuine fallback grant: badge FAILED, credential
  //     verified, stream and record intact, override accountable.
  // Both require an intact stream; neither is reachable on any unknown/rejected credential
  // or an unconfirmed badge. Four signatures total, enumerated below.
  const RECORDS: Record<string, Record<string, unknown>> = {
    accountable: { invocationRef: "r", justification: "recorded", scope: "single_encounter", expiry: "bounded", review: "reviewed", assignmentAtInvocation: "not_assigned" },
    under_documented: { invocationRef: "r", justification: "recorded", scope: "single_encounter", expiry: "bounded", review: "pending", assignmentAtInvocation: "not_assigned" },
    malformed: {},
  };
  const BADGE: BadgeAttempt[] = ["failed", "succeeded", "unknown"];
  const CRED: ManualCredentialCheck[] = ["verified", "rejected", "unknown", "not_attempted"];
  const INTEG: FallbackSequenceIntegrity[] = ["intact", "malformed"];
  const seqSpace: NormalizedManualFallback[] = [];
  for (const badgeAttempt of BADGE)
    for (const manualCredential of CRED)
      for (const rec of Object.keys(RECORDS))
        for (const sequenceIntegrity of INTEG)
          seqSpace.push({ correlationId: "c", badgeAttempt, manualCredential, override: normalizeBreakGlassRecord(RECORDS[rec]), sequenceIntegrity });
  check(
    `the sequence state space is the full cross-product (${seqSpace.length})`,
    seqSpace.length === BADGE.length * CRED.length * Object.keys(RECORDS).length * INTEG.length,
  );
  const seqVerdicts = seqSpace.map((s) => ({ state: s, verdict: evaluateManualFallback(s) }));
  const allowStates = seqVerdicts.filter(({ verdict }) => verdict.decision === "allow");
  const allowShapes = new Set(
    allowStates.map(({ state }) => `${state.badgeAttempt}|${state.manualCredential}|${state.override.reportIntegrity}|${state.sequenceIntegrity}|${evaluateBreakGlass(state.override).posture}`),
  );
  const EXPECTED_ALLOW = new Set([
    // FALLBACK_BADGE_CHECKOUT_OK — normal badge success, no fallback, override irrelevant.
    "succeeded|not_attempted|intact|intact|accountable",
    "succeeded|not_attempted|intact|intact|under_documented",
    "succeeded|not_attempted|malformed|intact|unassessed",
    // FALLBACK_GRANTED_ACCOUNTABLE — the genuine fallback grant.
    "failed|verified|intact|intact|accountable",
  ]);
  check(
    `allow is EXACTLY the enumerated set, pinned by equality (${allowShapes.size} distinct)`,
    allowShapes.size === EXPECTED_ALLOW.size && [...allowShapes].every((s) => EXPECTED_ALLOW.has(s)),
  );
  check(
    "no allow state has an unknown/rejected credential, an unconfirmed badge, or a malformed stream — ignorance never reaches allow",
    allowStates.every(({ state }) =>
      (state.manualCredential === "verified" || state.manualCredential === "not_attempted") &&
      state.badgeAttempt !== "unknown" &&
      state.sequenceIntegrity === "intact"),
  );
  check(
    "…and the genuine FALLBACK grant (a manual credential was used) still requires an INTACT accountable record",
    allowStates.every(({ state, verdict }) =>
      verdict.reasonCode !== "FALLBACK_GRANTED_ACCOUNTABLE" ||
      (state.badgeAttempt === "failed" && state.manualCredential === "verified" &&
        state.override.reportIntegrity === "intact" && evaluateBreakGlass(state.override).posture === "accountable")),
  );
  check(
    `NON-VACUITY: BOTH allow reasons are reachable, so neither pin describes nothing`,
    allowStates.some(({ verdict }) => verdict.reasonCode === "FALLBACK_BADGE_CHECKOUT_OK") &&
      allowStates.some(({ verdict }) => verdict.reasonCode === "FALLBACK_GRANTED_ACCOUNTABLE"),
  );
  // Every unknown-bearing state tightens away from allow — the golden-rule-2 sweep.
  const withUnknown = seqVerdicts.filter(({ state }) =>
    state.badgeAttempt === "unknown" || state.manualCredential === "unknown");
  check(
    `every state with ANY unknown signal is tightened, never allowed (${withUnknown.length} states)`,
    withUnknown.length > 0 && withUnknown.every(({ verdict }) => verdict.decision !== "allow"),
  );

  // 6e. THE NORMALIZER READS THE SEQUENCE OUT OF REAL EVENTS, and fails closed on
  // structure. Deterministic over array order; no timestamp is read. Every well-formed
  // stream carries the two required contract anchors — correlationId AND tenantId.
  const CID = "cust-live";
  const T = "tenant-a";
  const MC = "mc-1";
  // The accountability record must be BOUND to the sequence it accounts for (round-3 fix):
  // it carries the sequence's tenant, correlationId and presented credential. An unbound or
  // cross-bound record is malformed and denies, so every manual-fallback stream below feeds
  // a correctly-bound record — the binding is exercised, then falsified by the controls in 6h.
  const ACCOUNTABLE_RAW = { invocationRef: "bg-live", justification: "recorded", scope: "single_encounter", expiry: "bounded", review: "reviewed", assignmentAtInvocation: "not_assigned", tenantId: T, correlationId: CID, mobileCredentialId: MC };
  const realFallback = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" }, // badge auth FAILED
      { eventType: "checkout_denied", correlationId: CID, tenantId: T }, // badge check-out denied
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" }, // manual fallback
      { eventType: "checkout_granted", correlationId: CID, tenantId: T }, // credential verified
    ],
    ACCOUNTABLE_RAW,
  );
  check(
    `a real badge-fail→manual-verify event stream normalizes to failed/verified/intact (${realFallback.badgeAttempt}/${realFallback.manualCredential}/${realFallback.sequenceIntegrity})`,
    realFallback.badgeAttempt === "failed" && realFallback.manualCredential === "verified" && realFallback.sequenceIntegrity === "intact",
  );
  check(
    "…and that normalized stream then ALLOWS end to end — the sequence is exercised, not just asserted",
    evaluateManualFallback(realFallback).decision === "allow",
  );
  const badgeOkStream = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "success" }, // badge worked
      { eventType: "checkout_granted", correlationId: CID, tenantId: T },
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
      { eventType: "checkout_granted", correlationId: CID, tenantId: T },
    ],
    ACCOUNTABLE_RAW, // manual path used → the record must be bound to the sequence
  );
  check(
    `a stream where the badge SUCCEEDED reads badgeAttempt=succeeded (${badgeOkStream.badgeAttempt})`,
    badgeOkStream.badgeAttempt === "succeeded",
  );
  const noManualResolution = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" },
      { eventType: "checkout_denied", correlationId: CID, tenantId: T },
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
    ],
    ACCOUNTABLE_RAW, // manual path used → the record must be bound to the sequence
  );
  check(
    `FAIL-CLOSED: a manual request that never resolves reads credential=unknown, not verified (${noManualResolution.manualCredential})`,
    noManualResolution.manualCredential === "unknown",
  );
  check("FAIL-CLOSED: an EMPTY event stream is malformed", normalizeManualFallbackSequence([], {}).sequenceIntegrity === "malformed");
  check(
    "FAIL-CLOSED: a MIXED-correlation stream is malformed",
    normalizeManualFallbackSequence(
      [
        { eventType: "badge_access", correlationId: "a", tenantId: T },
        { eventType: "checkout_denied", correlationId: "b", tenantId: T },
      ],
      {},
    ).sequenceIntegrity === "malformed",
  );
  check(
    "FAIL-CLOSED: a manual request BEFORE the badge attempt resolves is out of order → malformed",
    normalizeManualFallbackSequence(
      [
        { eventType: "badge_access", correlationId: CID, tenantId: T },
        { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" }, // manual before badge resolved
        { eventType: "checkout_denied", correlationId: CID, tenantId: T },
      ],
      {},
    ).sequenceIntegrity === "malformed",
  );
  check(
    "FAIL-CLOSED: an orphan resolution (grant/deny with nothing before it) → malformed",
    normalizeManualFallbackSequence([{ eventType: "checkout_granted", correlationId: CID, tenantId: T }], {}).sequenceIntegrity === "malformed",
  );
  check(
    "NON-VACUITY: the well-formed live stream above is `intact`, so the malformed checks fail for their own reason",
    realFallback.sequenceIntegrity === "intact",
  );

  // 6f. REGRESSION CONTROLS — one per Codex finding. Each reproduces an input that
  // reached (or falsely blocked) `allow` before the root-cause fix and must not now.
  //
  // #1 CONFLICTING MANUAL RESOLUTIONS: one manual fallback emitting both a grant and a
  // deny is ambiguous high-risk evidence. Before the fix the normalizer kept the first
  // and stayed intact → an accountable override yielded allow. Ambiguity must tighten.
  const conflictingManual = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" },
      { eventType: "checkout_denied", correlationId: CID, tenantId: T },
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
      { eventType: "checkout_granted", correlationId: CID, tenantId: T }, // grant …
      { eventType: "checkout_denied", correlationId: CID, tenantId: T }, // … then deny — contradiction
    ],
    ACCOUNTABLE_RAW,
  );
  check(
    `#1 CONFLICTING MANUAL RESOLUTIONS → malformed, never allow (${conflictingManual.sequenceIntegrity} / ${evaluateManualFallback(conflictingManual).decision})`,
    conflictingManual.sequenceIntegrity === "malformed" && evaluateManualFallback(conflictingManual).decision === "deny",
  );

  // #2 CROSS-TENANT CORRELATION: two tenants sharing a correlationId must not fuse into
  // one intact sequence (badge-deny from A + manual-grant from B → allow before the fix).
  const crossTenant = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: "tenant-a", badgeAuthOutcome: "failure" },
      { eventType: "checkout_denied", correlationId: CID, tenantId: "tenant-a" },
      { eventType: "checkout_requested", correlationId: CID, tenantId: "tenant-b", mobileCredentialId: "mc-1" }, // DIFFERENT tenant
      { eventType: "checkout_granted", correlationId: CID, tenantId: "tenant-b" },
    ],
    ACCOUNTABLE_RAW,
  );
  check(
    `#2 CROSS-TENANT under one correlationId → malformed, never allow (${crossTenant.sequenceIntegrity} / ${evaluateManualFallback(crossTenant).decision})`,
    crossTenant.sequenceIntegrity === "malformed" && evaluateManualFallback(crossTenant).decision === "deny",
  );
  check(
    "#2 a MISSING tenantId is also malformed — correlation alone cannot fuse a sequence",
    normalizeManualFallbackSequence(
      [
        { eventType: "badge_access", correlationId: CID, badgeAuthOutcome: "failure" },
        { eventType: "checkout_denied", correlationId: CID },
        { eventType: "checkout_requested", correlationId: CID, mobileCredentialId: "mc-1" },
        { eventType: "checkout_granted", correlationId: CID },
      ],
      ACCOUNTABLE_RAW,
    ).sequenceIntegrity === "malformed",
  );

  // #3 BADGE-CAUSATION: a checkout_denied caused by posture/policy (NO failed badge_access)
  // must not read as badge `failed`. Before the fix a later manual grant produced allow,
  // bypassing the original denial. Now it needs positive badge-auth-failure evidence.
  const postureDenied = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T }, // NO failure outcome
      { eventType: "checkout_denied", correlationId: CID, tenantId: T }, // denied for posture/policy, not the badge
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
      { eventType: "checkout_granted", correlationId: CID, tenantId: T },
    ],
    ACCOUNTABLE_RAW,
  );
  check(
    `#3 a non-badge-caused denial reads badge=unknown, not failed (${postureDenied.badgeAttempt})`,
    postureDenied.badgeAttempt === "unknown",
  );
  check(
    `#3 …so a manual grant on top of it does NOT allow (${evaluateManualFallback(postureDenied).decision}) — it tightens to step_up`,
    evaluateManualFallback(postureDenied).decision !== "allow",
  );
  check(
    "#3 NON-VACUITY: add positive badge-auth-failure evidence and the SAME stream becomes allow — the gate is the evidence, not the shape",
    (() => {
      const withEvidence = normalizeManualFallbackSequence(
        [
          { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" }, // the only change
          { eventType: "checkout_denied", correlationId: CID, tenantId: T },
          { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
          { eventType: "checkout_granted", correlationId: CID, tenantId: T },
        ],
        ACCOUNTABLE_RAW,
      );
      return withEvidence.badgeAttempt === "failed" && evaluateManualFallback(withEvidence).decision === "allow";
    })(),
  );

  // #4 NOT_ATTEMPTED vs UNKNOWN: a normal successful badge checkout with no manual fallback
  // must NOT be falsely denied by the PUBLIC normalizer+evaluator. Before the fix it read
  // credential=unknown and denied before ever considering the successful badge.
  const normalCheckout = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "success" },
      { eventType: "checkout_granted", correlationId: CID, tenantId: T },
    ],
    ACCOUNTABLE_RAW,
  );
  check(
    `#4 a normal successful badge checkout reads credential=not_attempted, not unknown (${normalCheckout.manualCredential})`,
    normalCheckout.manualCredential === "not_attempted",
  );
  check(
    `#4 …and is NOT falsely denied — it allows as FALLBACK_BADGE_CHECKOUT_OK (${evaluateManualFallback(normalCheckout).decision} / ${evaluateManualFallback(normalCheckout).reasonCode})`,
    evaluateManualFallback(normalCheckout).decision === "allow" && evaluateManualFallback(normalCheckout).reasonCode === "FALLBACK_BADGE_CHECKOUT_OK",
  );
  check(
    "#4 NO LOOSENING: an ATTEMPTED-but-unknown credential still denies, even when the badge succeeded",
    (() => {
      const attemptedUnknown = normalizeManualFallbackSequence(
        [
          { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "success" },
          { eventType: "checkout_granted", correlationId: CID, tenantId: T },
          { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" }, // attempted…
          // …but never resolved → unknown
        ],
        ACCOUNTABLE_RAW,
      );
      return attemptedUnknown.manualCredential === "unknown" && evaluateManualFallback(attemptedUnknown).decision === "deny";
    })(),
  );

  // 6g. ROUND-2 REGRESSION CONTROLS — one per Codex re-review finding.
  //
  // #1 THE CANONICAL PATH. The badge-causation fix reads `badgeAuthOutcome`; if that field
  // does not survive validateEvent's allowlist the whole feature is dead through the real
  // contract. Build the stream as RAW events, run each through validateEvent, and feed the
  // VALIDATED events (rebuilt from allowlisted fields only) to the normalizer.
  const iso = "2026-01-01T00:00:00.000Z";
  const asCanonical = (raw: Record<string, unknown>[]) =>
    raw.map((r) => {
      const v = validateEvent(r);
      if (!v.ok) throw new Error(`fixture event failed canonical validation: ${v.errors.join("; ")}`);
      return v.event;
    });
  const canonicalFail = asCanonical([
    { eventType: "badge_access", eventId: "e1", occurredAt: iso, correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" },
    { eventType: "checkout_denied", eventId: "e2", occurredAt: iso, correlationId: CID, tenantId: T },
    { eventType: "checkout_requested", eventId: "e3", occurredAt: iso, correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
    { eventType: "checkout_granted", eventId: "e4", occurredAt: iso, correlationId: CID, tenantId: T },
  ]);
  check(
    "#1 the canonical contract PRESERVES badgeAuthOutcome through validateEvent (not stripped by the allowlist)",
    canonicalFail[0].badgeAuthOutcome === "failure",
  );
  const canonSeq = normalizeManualFallbackSequence(canonicalFail, ACCOUNTABLE_RAW);
  check(
    `#1 a CANONICAL failed-badge→manual-grant stream reaches the accountable allow (${canonSeq.badgeAttempt} / ${evaluateManualFallback(canonSeq).decision})`,
    canonSeq.badgeAttempt === "failed" &&
      evaluateManualFallback(canonSeq).decision === "allow" &&
      evaluateManualFallback(canonSeq).reasonCode === "FALLBACK_GRANTED_ACCOUNTABLE",
  );
  const canonNoOutcome = asCanonical([
    { eventType: "badge_access", eventId: "e1", occurredAt: iso, correlationId: CID, tenantId: T }, // no outcome
    { eventType: "checkout_denied", eventId: "e2", occurredAt: iso, correlationId: CID, tenantId: T },
    { eventType: "checkout_requested", eventId: "e3", occurredAt: iso, correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
    { eventType: "checkout_granted", eventId: "e4", occurredAt: iso, correlationId: CID, tenantId: T },
  ]);
  const canonNoOutcomeSeq = normalizeManualFallbackSequence(canonNoOutcome, ACCOUNTABLE_RAW);
  check(
    `#1 …and the SAME canonical stream WITHOUT the outcome stays step_up — the validated field is the gate (${evaluateManualFallback(canonNoOutcomeSeq).decision})`,
    canonNoOutcomeSeq.badgeAttempt === "unknown" && evaluateManualFallback(canonNoOutcomeSeq).decision === "step_up",
  );

  // #2 MANUAL REQUEST BEFORE BADGE. A credential-bearing request + grant BEFORE any
  // resolved badge attempt must not verify a fallback the badge never justified.
  const manualFirst = normalizeManualFallbackSequence(
    [
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" }, // before any badge
      { eventType: "checkout_granted", correlationId: CID, tenantId: T },
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" }, // badge fails only later
    ],
    ACCOUNTABLE_RAW,
  );
  check(
    `#2 a manual request BEFORE any resolved badge attempt → malformed, never allow (${manualFirst.sequenceIntegrity} / ${evaluateManualFallback(manualFirst).decision})`,
    manualFirst.sequenceIntegrity === "malformed" && evaluateManualFallback(manualFirst).decision === "deny",
  );

  // #3 MULTIPLE MANUAL REQUESTS. Two credential-bearing requests, then one grant: which
  // credential did the grant resolve? Unknowable — so it is ambiguous and fails closed.
  const twoCreds = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" },
      { eventType: "checkout_denied", correlationId: CID, tenantId: T },
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-1" },
      { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: "mc-2" }, // different credential
      { eventType: "checkout_granted", correlationId: CID, tenantId: T },
    ],
    ACCOUNTABLE_RAW,
  );
  check(
    `#3 two manual requests (different credentials) → malformed, never allow (${twoCreds.sequenceIntegrity} / ${evaluateManualFallback(twoCreds).decision})`,
    twoCreds.sequenceIntegrity === "malformed" && evaluateManualFallback(twoCreds).decision === "deny",
  );

  // #4 BADGE SUCCESS ≠ CHECKOUT GRANTED. A success outcome with no completed check-out is
  // not `succeeded`, and a success followed by a denial is contradictory.
  const successNoGrant = normalizeManualFallbackSequence(
    [{ eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "success" }], // no checkout_granted
    ACCOUNTABLE_RAW,
  );
  check(
    `#4 a badge success with NO checkout_granted is not succeeded and does NOT allow (${successNoGrant.badgeAttempt} / ${evaluateManualFallback(successNoGrant).decision})`,
    successNoGrant.badgeAttempt !== "succeeded" && evaluateManualFallback(successNoGrant).decision !== "allow",
  );
  check(
    "#4 a badge success FOLLOWED BY a checkout_denial is contradictory → malformed",
    normalizeManualFallbackSequence(
      [
        { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "success" },
        { eventType: "checkout_denied", correlationId: CID, tenantId: T },
      ],
      ACCOUNTABLE_RAW,
    ).sequenceIntegrity === "malformed",
  );
  check(
    "#4 NON-VACUITY: a badge success WITH an actual checkout_granted IS succeeded and allows — the gate is the grant, not the outcome word",
    (() => {
      const ok = normalizeManualFallbackSequence(
        [
          { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "success" },
          { eventType: "checkout_granted", correlationId: CID, tenantId: T },
        ],
        ACCOUNTABLE_RAW,
      );
      return ok.badgeAttempt === "succeeded" && evaluateManualFallback(ok).decision === "allow";
    })(),
  );

  // #5 AUDIT INTEGRITY ORDERING. Credential verified, badge unknown, override malformed:
  // the unauditable check-out must DENY, not step_up on the badge-unknown branch first.
  const auditVsBadgeUnknown = evaluateManualFallback({
    correlationId: "c",
    badgeAttempt: "unknown",
    manualCredential: "verified",
    override: normalizeBreakGlassRecord({}), // malformed audit record
    sequenceIntegrity: "intact",
  });
  check(
    `#5 malformed audit + badge unknown → deny/FALLBACK_AUDIT_MALFORMED, not step_up (${auditVsBadgeUnknown.decision} / ${auditVsBadgeUnknown.reasonCode})`,
    auditVsBadgeUnknown.decision === "deny" && auditVsBadgeUnknown.reasonCode === "FALLBACK_AUDIT_MALFORMED",
  );

  // 6h. ROUND-3 REGRESSION CONTROL — AUDIT EVIDENCE MUST BE BOUND TO THE SEQUENCE.
  //
  // The accountability record is supplied out-of-band. Before the fix it was normalized
  // in isolation and never compared to the sequence, so an accountable record from ANOTHER
  // tenant/session/credential carried a valid badge-fail→manual-verify stream straight to
  // FALLBACK_GRANTED_ACCOUNTABLE — an audit trail accounting for a different event. The fix
  // requires the record to carry tenantId/correlationId/mobileCredentialId that MATCH the
  // sequence; any mismatch or missing binding is malformed and denies.
  const boundStream = [
    { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "failure" },
    { eventType: "checkout_denied", correlationId: CID, tenantId: T },
    { eventType: "checkout_requested", correlationId: CID, tenantId: T, mobileCredentialId: MC },
    { eventType: "checkout_granted", correlationId: CID, tenantId: T },
  ] as const;
  const wrongTenantAudit = normalizeManualFallbackSequence(boundStream, { ...ACCOUNTABLE_RAW, tenantId: "tenant-OTHER" });
  check(
    `#6 an accountable record BOUND TO ANOTHER TENANT → malformed, never allow (${wrongTenantAudit.sequenceIntegrity} / ${evaluateManualFallback(wrongTenantAudit).decision})`,
    wrongTenantAudit.sequenceIntegrity === "malformed" && evaluateManualFallback(wrongTenantAudit).decision === "deny",
  );
  const wrongCredAudit = normalizeManualFallbackSequence(boundStream, { ...ACCOUNTABLE_RAW, mobileCredentialId: "mc-OTHER" });
  check(
    `#6 an accountable record bound to ANOTHER CREDENTIAL → malformed, never allow (${wrongCredAudit.sequenceIntegrity} / ${evaluateManualFallback(wrongCredAudit).decision})`,
    wrongCredAudit.sequenceIntegrity === "malformed" && evaluateManualFallback(wrongCredAudit).decision === "deny",
  );
  const wrongCorrAudit = normalizeManualFallbackSequence(boundStream, { ...ACCOUNTABLE_RAW, correlationId: "cust-OTHER" });
  check(
    `#6 an accountable record bound to ANOTHER SESSION (correlationId) → malformed, never allow (${wrongCorrAudit.sequenceIntegrity} / ${evaluateManualFallback(wrongCorrAudit).decision})`,
    wrongCorrAudit.sequenceIntegrity === "malformed" && evaluateManualFallback(wrongCorrAudit).decision === "deny",
  );
  const unboundAudit = normalizeManualFallbackSequence(boundStream, { invocationRef: "bg-live", justification: "recorded", scope: "single_encounter", expiry: "bounded", review: "reviewed", assignmentAtInvocation: "not_assigned" });
  check(
    `#6 an accountable record with NO binding ids at all → malformed, never allow (${unboundAudit.sequenceIntegrity} / ${evaluateManualFallback(unboundAudit).decision})`,
    unboundAudit.sequenceIntegrity === "malformed" && evaluateManualFallback(unboundAudit).decision === "deny",
  );
  // The fusion guards themselves (daily sweep 2026-09-11: `corr === ""` and `tenant === ""`
  // survived mutation — real behaviour with no test). The case has to be one where fusion is
  // the ONLY thing that can fail: a BADGE-SUCCESS stream (no manual fallback, so no
  // accountable record and no audit binding in play) whose events carry NO correlation id,
  // or NO tenant id. With the guard, the stream is malformed and denies; with the guard
  // deleted it is intact and decides on the badge success — which is exactly the mutant.
  // (A first cut used the manual-fallback stream: there the accountable record's binding
  // failed first and masked the guard, and the two mutants survived that sweep too.)
  const badgeOkNoCorr = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", tenantId: T, badgeAuthOutcome: "success" },
      { eventType: "checkout_granted", tenantId: T },
    ],
    {},
  );
  check(
    `a badge-success stream whose events carry NO correlation id → malformed, never allow — correlation fusion is the only guard in play (${badgeOkNoCorr.sequenceIntegrity} / ${evaluateManualFallback(badgeOkNoCorr).decision})`,
    badgeOkNoCorr.sequenceIntegrity === "malformed" && evaluateManualFallback(badgeOkNoCorr).decision === "deny",
  );
  const badgeOkNoTenant = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, badgeAuthOutcome: "success" },
      { eventType: "checkout_granted", correlationId: CID },
    ],
    {},
  );
  check(
    `a badge-success stream whose events carry NO tenant id → malformed, never allow — tenant fusion is the only guard in play (${badgeOkNoTenant.sequenceIntegrity} / ${evaluateManualFallback(badgeOkNoTenant).decision})`,
    badgeOkNoTenant.sequenceIntegrity === "malformed" && evaluateManualFallback(badgeOkNoTenant).decision === "deny",
  );
  const badgeOkBound = normalizeManualFallbackSequence(
    [
      { eventType: "badge_access", correlationId: CID, tenantId: T, badgeAuthOutcome: "success" },
      { eventType: "checkout_granted", correlationId: CID, tenantId: T },
    ],
    {},
  );
  check(
    `NON-VACUITY for the two above: the same badge-success stream WITH its ids is intact and allows (${badgeOkBound.sequenceIntegrity} / ${evaluateManualFallback(badgeOkBound).decision})`,
    badgeOkBound.sequenceIntegrity === "intact" && evaluateManualFallback(badgeOkBound).decision === "allow",
  );
  const emptySeq = normalizeManualFallbackSequence([], {});
  check(
    `an EMPTY stream → malformed, never allow (${emptySeq.sequenceIntegrity} / ${evaluateManualFallback(emptySeq).decision})`,
    emptySeq.sequenceIntegrity === "malformed" && evaluateManualFallback(emptySeq).decision === "deny",
  );
  check(
    "#6 NON-VACUITY: the SAME stream with a CORRECTLY-bound accountable record allows — the gate is the binding, not the shape",
    (() => {
      const bound = normalizeManualFallbackSequence(boundStream, ACCOUNTABLE_RAW);
      return bound.sequenceIntegrity === "intact" &&
        evaluateManualFallback(bound).decision === "allow" &&
        evaluateManualFallback(bound).reasonCode === "FALLBACK_GRANTED_ACCOUNTABLE";
    })(),
  );
}

console.log("");
console.log(`figures=states=${SPACE},clean=${clean.length},cleanShapes=${cleanShapes.size},fixtures=${Object.keys(BREAK_GLASS_FIXTURES).length}`);
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) { console.error("FAILED:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
