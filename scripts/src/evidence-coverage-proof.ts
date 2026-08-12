// Evidence-coverage proof — OFFLINE and deterministic.
//
// The artifact this guards is a DESIGN-PARTNER CONVERSATION INSTRUMENT: given the
// source planes a prospect actually has, which of the decision engine's evidence
// axes can they answer, and which are dark?
//
// It replaced a proposed "replay your history" backtest that two adversarial critics
// independently rejected. The reason is the thing this proof most needs to protect:
// the active v1 rule set is deliberately DAY-ONE QUIET on several axes, so an
// unanswerable axis produces a clean grant rather than a finding. In a live tenant
// that is correct (do not block a fleet because a connector is pending). Behind a
// customer-facing artifact it is a trap, because the artifact would report health it
// never had the data to establish.
//
// Asserted, in order of how much each matters:
//   1. THE DAY-ONE-QUIET FLAGS MATCH THE ACTUAL RULE SET. Every axis this model
//      claims is ungraded-on-ignorance is verified against the REAL engine by
//      evaluating it — not against a comment, and not against seed.ts by name.
//   2. AN UNDECLARED PLANE CAN NEVER MAKE AN AXIS ANSWERABLE, swept over the whole
//      power set of planes rather than by example.
//   3. THE REPORT IS MONOTONIC: adding a plane can only improve coverage, never
//      worsen it. A non-monotonic report is one a prospect can catch us on.
//   4. THE EMPTY ESTATE IS THE WORST CASE and the full estate is the best, with the
//      counts always summing to the axis total — a denominator a reviewer can check.
//   5. NON-VACUITY throughout: silent holes must be reachable AND avoidable.

import { evaluatePolicy, fixedClock, seedDemoStore } from "@workspace/signalgrid-core";
import type { DecisionEvidence, PolicyVersion } from "@workspace/signalgrid-core";
import {
  buildCoverageReport,
  EVIDENCE_AXES,
  KNOWN_SOURCE_PLANES,
  SOURCE_PLANE_PROMPTS,
  isKnownPlane,
  type SourcePlane,
} from "@workspace/flows";

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

console.log("Evidence-coverage proof — what can this estate actually answer?\n");

// DERIVED, not hand-listed. A hand-written copy silently halves the sweep the moment
// an axis names a new plane: the power set below would enumerate 2^7 estates while the
// model had eight planes, and every "across all N estates" line in this file would name
// a space that excludes the newest one — while still printing `ok`.
const ALL_PLANES: readonly SourcePlane[] = KNOWN_SOURCE_PLANES;

// ── 1. THE DAY-ONE-QUIET FLAGS ARE MEASURED, NOT ASSERTED ────────────────────
//
// The single most important check. This model claims certain axes still grant when
// they are ignorant. If that claim drifts from the real rule set, the report either
// understates the danger (an axis silently started granting and we do not flag it)
// or cries wolf. So it is verified by RUNNING THE ENGINE, axis by axis, against the
// active policy version — the same discipline the uem posture map got after the
// registry gap: derive the truth, compare to the claim, fail loudly on drift.
{
  // Seed the demo store and take the ACTIVE policy version out of it — the same
  // version a real decision would run against. Deriving it rather than hardcoding a
  // rule list is the point: if the shipped rules change, this proof changes with
  // them instead of quietly guarding a policy nobody uses any more.
  const seeded = seedDemoStore(fixedClock("2026-01-01T00:00:00.000Z"));
  const tenantId = seeded.tenants.northwind;
  const policies = seeded.store.listPolicies(tenantId);
  const versions = policies
    .flatMap((p) => seeded.store.listPolicyVersions(tenantId, p.id))
    .filter((v: PolicyVersion) => v.status === "active");
  const active = versions[0]!;

  // A fully-clean evidence record — every axis affirmatively good. Each probe below
  // then degrades EXACTLY ONE axis to its ignorance member, so any change in outcome
  // is attributable to that axis alone.
  const base: DecisionEvidence = {
    identityEnabled: true,
    deviceManaged: true,
    deviceCompliance: "compliant",
    deviceEncrypted: true,
    osSupported: true,
    ownerType: "shared",
    postureFreshness: "fresh",
    workflowRiskTier: "elevated",
    custodyState: "checked_out",
    dockChargeState: "charged",
    batteryHealth: "healthy",
    tamperState: "none",
    dockState: "occupied",
    baselineCompliance: "aligned",
    benchmarkSelection: "confirmed",
    shiftContext: "confirmed",
    badgeBinding: "present",
    managementHealthState: "healthy",
    localAuthorityState: "verified",
    criticalSignalsPresent: true,
  };
  check(
    "the seeded store yields exactly one ACTIVE policy version to test against",
    versions.length === 1,
  );
  check(
    "NON-VACUITY: the fully-clean baseline itself grants, so every probe below starts from allow",
    evaluatePolicy(active, base).outcome === "allow",
  );

  // The ignorance member of EVERY axis that has one — not just the ones already
  // claimed quiet.
  //
  // THE FIRST DRAFT LISTED ONLY THE SEVEN `dayOneQuiet: true` AXES, and that made this
  // check one-directional in the dangerous direction. Axes marked `false` had no entry,
  // so the `continue` below skipped them, so the loop could only ever detect "model says
  // quiet, engine grades it" — the cry-wolf direction. It structurally could not detect
  // "model says graded, engine is QUIET", which is the direction that UNDERCOUNTS holes
  // in a report whose headline is a hole count.
  //
  // An adversarial review ran the engine over all eighteen and found four live
  // mismatches: deviceEncrypted, ownerType, custodyState and tamperState all return
  // `allow` on their ignorance member while the table claimed they were graded. The
  // report was telling a prospect 7 silent holes on an empty estate when the truth was
  // 11, and 4 on the Entra+Intune wedge when the truth was 6 — understating the exact
  // danger it exists to name, which is the defect that killed the replay backtest.
  const IGNORANCE: Record<string, unknown> = {
    identityEnabled: false,
    deviceManaged: false,
    deviceCompliance: "unknown",
    deviceEncrypted: "unknown",
    osSupported: "unknown",
    ownerType: "unknown",
    postureFreshness: "unknown",
    custodyState: "unknown",
    tamperState: "unknown",
    dockChargeState: "unknown",
    batteryHealth: "unknown",
    dockState: "unknown",
    baselineCompliance: "unknown",
    benchmarkSelection: "unverified",
    shiftContext: "unverified",
    badgeBinding: "unknown",
    criticalSignalsPresent: false,
  };

  // Every axis except the POSED one must have a modelled ignorance member. Without
  // this, dropping an entry silently re-opens the one-directional hole above.
  const POSED_BY_CALLER = new Set(["workflowRiskTier"]);
  const unmodelled = EVIDENCE_AXES
    .filter((a) => IGNORANCE[a.id] === undefined && !POSED_BY_CALLER.has(a.id))
    .map((a) => a.id);
  check(
    `every axis has a modelled ignorance member, or is posed by the caller${unmodelled.length ? `: missing ${unmodelled.join(", ")}` : ""}`,
    unmodelled.length === 0,
  );

  const claimed = EVIDENCE_AXES.filter((a) => a.dayOneQuiet).map((a) => a.id).sort();
  const mismatches: string[] = [];
  for (const axis of EVIDENCE_AXES) {
    const ignorance = IGNORANCE[axis.id];
    if (ignorance === undefined) continue; // posed by the caller — pinned by the check above
    const result = evaluatePolicy(active, { ...base, [axis.id]: ignorance } as typeof base);
    const actuallyQuiet = result.outcome === "allow";
    if (actuallyQuiet !== axis.dayOneQuiet) {
      mismatches.push(`${axis.id}: model says quiet=${axis.dayOneQuiet}, engine says ${result.outcome}`);
    }
  }
  check(
    `every day-one-quiet flag matches the LIVE engine, in BOTH directions (${EVIDENCE_AXES.length - POSED_BY_CALLER.size} axes probed)${mismatches.length ? `: ${mismatches.join("; ")}` : ""}`,
    mismatches.length === 0,
  );
  check(
    `NON-VACUITY: the model does claim some axes are quiet (${claimed.length}), so the check above is not empty`,
    claimed.length > 0,
  );
  // And the inverse: a graded axis must actually be graded, or "quiet" means nothing.
  const gradedProbe = evaluatePolicy(active, { ...base, deviceCompliance: "non_compliant" } as typeof base);
  check(
    `NON-VACUITY: a KNOWN-BAD axis is genuinely graded (${gradedProbe.outcome}), so allow is not the engine's only answer`,
    gradedProbe.outcome !== "allow",
  );
}

// ── 2. AN UNDECLARED PLANE NEVER MAKES AN AXIS ANSWERABLE ────────────────────
//
// Swept over the FULL power set of planes (2^ALL_PLANES.length estates — the count is
// printed by the check itself rather than quoted here) rather than spot-
// checked, because this is the property the whole artifact's honesty rests on: the
// report must never credit a deployment with a capability it did not declare.
{
  let estates = 0;
  let violations = 0;
  for (let mask = 0; mask < 1 << ALL_PLANES.length; mask += 1) {
    const declared = ALL_PLANES.filter((_, i) => (mask & (1 << i)) !== 0);
    const declaredSet = new Set(declared);
    const report = buildCoverageReport(declared);
    estates += 1;
    for (const f of report.findings) {
      if (f.coverage !== "answerable") continue;
      // Answerable REQUIRES at least one declared plane from the allowlist.
      if (!f.axis.answerableBy.some((p) => declaredSet.has(p))) violations += 1;
    }
  }
  check(
    `across all ${estates} possible estates, no axis is answerable without a declared plane (${violations} violations)`,
    violations === 0 && estates === 1 << ALL_PLANES.length,
  );
}

// ── 3. MONOTONICITY ──────────────────────────────────────────────────────────
//
// Adding a plane must never reduce answerable coverage or increase the hole count.
// A report that got WORSE when a prospect told us they had more would be caught in
// the first meeting, and rightly.
{
  let regressions = 0;
  let comparisons = 0;
  for (let mask = 0; mask < 1 << ALL_PLANES.length; mask += 1) {
    const declared = ALL_PLANES.filter((_, i) => (mask & (1 << i)) !== 0);
    const before = buildCoverageReport(declared);
    for (let bit = 0; bit < ALL_PLANES.length; bit += 1) {
      if ((mask & (1 << bit)) !== 0) continue;
      const after = buildCoverageReport(ALL_PLANES.filter((_, i) => (mask & (1 << i)) !== 0 || i === bit));
      comparisons += 1;
      if (after.answerable < before.answerable) regressions += 1;
      if (after.silentHoles > before.silentHoles) regressions += 1;
    }
  }
  check(
    `adding a plane never worsens the report: ${comparisons} comparisons, ${regressions} regressions`,
    regressions === 0 && comparisons > 0,
  );
}

// ── 4. THE DENOMINATOR IS CHECKABLE ──────────────────────────────────────────
{
  const empty = buildCoverageReport([]);
  const full = buildCoverageReport(ALL_PLANES);
  check(
    `the three coverage buckets always sum to the axis total (${empty.totalAxes})`,
    empty.answerable + empty.needsInstrumentation + empty.notSourced === empty.totalAxes &&
      full.answerable + full.needsInstrumentation + full.notSourced === full.totalAxes,
  );
  check(
    "an EMPTY estate answers nothing that requires a plane",
    empty.answerable === 0,
  );
  check(
    `a FULL estate still cannot answer the caller-posed and derived axes (${full.notSourced} not_sourced)`,
    full.notSourced > 0 && full.needsInstrumentation === 0,
  );
  check(
    "…and a full estate has NO silent holes — every gap it has is one the engine grades",
    full.silentHoles === 0,
  );
  check(
    `NON-VACUITY: an empty estate DOES have silent holes (${empty.silentHoles}), so the headline figure is reachable`,
    empty.silentHoles > 0,
  );
}

// ── 5. THE REALISTIC CASE, which is the one a prospect will actually see ─────
//
// The wedge stated in the positioning docs: Entra + Intune, nothing else yet.
{
  const wedge = buildCoverageReport(["identity", "device_management"]);
  const dark = wedge.findings.filter((f) => f.coverage === "needs_instrumentation");
  // PINNED BY EQUALITY, not by `> 0`. The inequalities these replace were satisfied by
  // any non-degenerate table: dropping `device_management` from `batteryHealth` moves
  // the wedge to 9 answerable / 7 silent holes and the old assertions stayed green — on
  // the two numbers this artifact leads with in a meeting, and which two other surfaces
  // (the api suite and the console E2E) already state as measurements. A figure quoted
  // in three places and gated in two is a fossil waiting to happen.
  check(
    `the Entra + Intune wedge answers EXACTLY 10 of ${wedge.totalAxes} axes and leaves ${dark.length} needing instrumentation`,
    wedge.answerable === 10 && dark.length === 6,
  );
  check(
    `…of which EXACTLY 6 are SILENT holes — dark AND ungraded, where a naive backtest would read health`,
    wedge.silentHoles === 6 && wedge.silentHoles <= dark.length,
  );
  check(
    "every dark axis names the planes that would answer it, so the gap is actionable rather than a complaint",
    dark.every((f) => f.missingPlanes.length > 0),
  );
  check(
    "no axis is reported dark without a question a non-engineer can act on",
    dark.every((f) => f.axis.question.trim().length > 10),
  );
}

console.log("");
{
  const wedge = buildCoverageReport(["identity", "device_management"]);
  const empty = buildCoverageReport([]);
  // ── KNOWN_SOURCE_PLANES IS DERIVED, AND THAT IS THE POINT ────────────────────
//
// The control-plane arm refuses an unrecognised plane and names the recognised ones.
// That list must come from the axis table, not a second hand-written copy — a copy
// drifts silently the moment an axis names a new plane, and the failure is invisible:
// the 400 would omit a plane that IS valid, so a caller would stop asking for it.
{
  check(
    `KNOWN_SOURCE_PLANES agrees with isKnownPlane on every member (${KNOWN_SOURCE_PLANES.length})`,
    KNOWN_SOURCE_PLANES.every((p) => isKnownPlane(p)),
  );
  const fromAxes = [...new Set(EVIDENCE_AXES.flatMap((a) => a.answerableBy))].sort();
  check(
    "…and contains exactly the planes the axis table names — derived, not a copy",
    KNOWN_SOURCE_PLANES.length === fromAxes.length &&
      KNOWN_SOURCE_PLANES.every((p, i) => p === fromAxes[i]),
  );
  check(
    "NON-VACUITY: an invented plane is NOT known, so the agreement above is not trivially true of everything",
    !isKnownPlane("not-a-real-plane") &&
      !(KNOWN_SOURCE_PLANES as readonly string[]).includes("not-a-real-plane"),
  );
  // ── THE PROMPT MAP IS THE GATE ON THE DEFECT THIS FILE ALREADY SHIPPED ───────
  //
  // `dex` and `access_governance` were members of `SourcePlane` that no axis could be
  // answered by. The compiler was happy — a union member costs nothing — so the type
  // claimed two planes the whole system treated as unrecognised, and the proof's
  // power-set sweep reported 512 estates where only 128 were distinct.
  //
  // `SOURCE_PLANE_PROMPTS` is a `Record` over the union, so the COMPILER now refuses a
  // plane with no prompt. This comparison closes the other direction, which no compiler
  // can see: a prompt whose plane answers NOTHING. Both directions are needed — a union
  // member is only real if it is both askable and load-bearing.
  const promptKeys = Object.keys(SOURCE_PLANE_PROMPTS).sort();
  check(
    `every declared SourcePlane answers at least one axis (${promptKeys.length} prompts, ${KNOWN_SOURCE_PLANES.length} load-bearing)`,
    promptKeys.length === KNOWN_SOURCE_PLANES.length &&
      promptKeys.every((p, i) => p === KNOWN_SOURCE_PLANES[i]),
  );
  check(
    "…and every prompt is SHAPED like a question, not a snake_case key prettied up",
    Object.values(SOURCE_PLANE_PROMPTS).every(
      (prompt) => prompt.trim().endsWith("?") && prompt.length > 20 && !prompt.includes("_"),
    ),
  );
  // Shape alone is worth almost nothing, which an adversarial pass demonstrated: it
  // stayed green when every prompt was replaced by the key prettied up ("Do you have
  // device management?"), when all seven were set to one identical string, and — worst —
  // when two prompts were SWAPPED, which puts "are the devices returned to instrumented
  // cradles?" under the Identity heading on a customer-facing page.
  //
  // So the pairing is pinned here, independently, by naming for each plane a term the
  // question must contain. Restating the expectation in a second place is the point: a
  // check derived from the thing it checks can only ever confirm that the thing equals
  // itself. Distinctness kills the identical-string case; the terms kill the swap.
  const PROMPT_MUST_MENTION: Record<SourcePlane, string> = {
    identity: "identity provider",
    device_management: "MDM/UEM",
    endpoint_security: "EDR/EPP",
    badge_custody: "badge reader",
    physical_access: "access-control system",
    workforce_management: "time-and-attendance",
    dock_hardware: "cradles",
  };
  const misworded = (Object.keys(PROMPT_MUST_MENTION) as SourcePlane[]).filter(
    (p) => !SOURCE_PLANE_PROMPTS[p].includes(PROMPT_MUST_MENTION[p]),
  );
  check(
    `…and each prompt asks about ITS OWN plane — a swapped pair is a mislabelled question on a customer-facing page${misworded.length ? `: ${misworded.join(", ")}` : ""}`,
    misworded.length === 0,
  );
  check(
    "…and no two planes share a prompt, so the surface cannot ask the same content-free question seven times",
    new Set(Object.values(SOURCE_PLANE_PROMPTS)).size === promptKeys.length,
  );

  // Fail-closed direction that matters: an unknown plane can never ADD coverage.
  const declared = buildCoverageReport(["identity"]);
  const withJunk = buildCoverageReport(["identity", "not-a-real-plane"] as never);
  check(
    "an unrecognised plane cannot raise answerable coverage — the report is not improvable by invention",
    withJunk.answerable === declared.answerable && withJunk.silentHoles === declared.silentHoles,
  );
}

console.log(
    `figures=axes=${EVIDENCE_AXES.length},estates=${1 << ALL_PLANES.length},wedgeAnswerable=${wedge.answerable},wedgeSilentHoles=${wedge.silentHoles},emptySilentHoles=${empty.silentHoles}`,
  );
}
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${passed + failures.length})`);
if (failures.length > 0) {
  console.error("FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
