#!/usr/bin/env node
// brain-cycle-merge-decide.mjs — the merge authorizer for the brain cycle's GREEN switch.
// PURE and DETERMINISTIC: it takes the gauntlet's observed results and returns whether an
// unattended merge is authorized. It runs nothing and merges nothing; the caller performs
// the merge only if this says yes. Factored out exactly like brain-cycle-decide.mjs so the
// decision can be self-tested in both directions without a live cycle.
//
//   node scripts/brain-cycle-merge-decide.mjs --self-test
//
// THE RULE: AN AFFIRMATIVE-GREEN ALLOWLIST, NEVER A NOT-FAILED DENYLIST.
// Every conjunct must be a POSITIVE green. Anything red, skipped, unavailable,
// inconclusive, timed-out, unknown or ABSENT means NO MERGE. The difference is not
// pedantic: a denylist ("nothing said fail") merges on a gate that never ran, and the
// two ways that happens here are real —
//   · preflight.mjs sets its failure flag only on a NONZERO EXIT, so "unavailable"
//     (native-build steps excluded on cloud) and "skipped-db" steps let it exit 0 WITH
//     GATES THAT NEVER RAN. So exit 0 is necessary and NOT sufficient: every step must
//     also report status "ok".
//   · a lens that did not run is not a lens that approved.
//
// THE DECISION PATH MAY NEVER AUTO-MERGE (golden rule 2 / DR-029). The tier is taken from
// classifyDiff over the REAL head diff — never a cached tier from decision.json, which was
// computed on the winner's CLAIMED files and can drift from what was implemented, and never
// model-authored path strings. DECISION_PATH is refused outright even if it somehow arrived
// marked autonomous: two independent reasons to refuse, because one of them is the product.
//
// NO MODEL OUTPUT IS AN AUTHORIZER. Every conjunct is a deterministic gate result or a veto.
// A model may BLOCK or ESCALATE; it can never approve into a merge.

import { pathToFileURL } from "node:url";

/** A conjunct is satisfied only by this exact token. Everything else — including
 *  "skipped", "unavailable", "inconclusive", undefined — fails it. */
const GREEN = "green";

/**
 * @param {object} ctx
 * @param {boolean} ctx.switchOn            autoMergeGreenSwitch, the owner's explicit GREEN switch
 * @param {{tier:string, matched:Array<{category:string}>}} ctx.headClassification
 *        classifyDiff() over the REAL head diff (git diff --name-only --no-renames, normalized)
 * @param {{exit:number, steps:Array<{name:string,status:string}>}} ctx.preflight
 * @param {string} ctx.breadth              "green" or anything else
 * @param {string} ctx.parity               "green" or anything else
 * @param {object} ctx.panel                { unanimous, expectedLensesRan, confirmedCritical, failOpen, vetoBlock }
 * @param {string} ctx.bugHunt
 * @param {string} ctx.falsification        check-pr-gate-falsification.mjs verdict
 * @param {string} ctx.publication
 * @param {string} ctx.launchClaims
 */
export function decideMerge(ctx) {
  const blockers = [];
  const c = ctx ?? {};

  // 0. The owner's switch. Off (or absent) is the default and the stop button.
  if (c.switchOn !== true) blockers.push("autoMergeGreenSwitch is not true — the owner's GREEN switch is the precondition and the stop button");

  // 1. The decision path may never auto-merge, and the tier must be provably autonomous.
  const cls = c.headClassification;
  if (!cls || typeof cls.tier !== "string") {
    blockers.push("no classification of the real head diff — an unclassified diff can never be proven autonomous");
  } else {
    const cats = (cls.matched ?? []).map((m) => m.category);
    if (cats.includes("DECISION_PATH")) blockers.push("the diff touches the DECISION PATH (lib/*, /v1, connectors, native ports) — golden rule 2: never auto-merged, escalate to the owner");
    if (cls.tier !== "autonomous") blockers.push(`head diff classifies "${cls.tier}", not autonomous — owner-gated surfaces escalate`);
  }

  // 2. Mechanical stage. Exit 0 is necessary and NOT sufficient — every step must be ok.
  const pf = c.preflight;
  if (!pf || pf.exit !== 0) {
    blockers.push("preflight did not exit 0");
  } else if (!Array.isArray(pf.steps) || pf.steps.length === 0) {
    blockers.push("preflight reported no steps — an empty run is not a green run");
  } else {
    const notOk = pf.steps.filter((s) => s?.status !== "ok");
    if (notOk.length) blockers.push(`preflight exited 0 but ${notOk.length} step(s) did not run green (${notOk.slice(0, 3).map((s) => `${s?.name ?? "?"}=${s?.status ?? "absent"}`).join(", ")}) — a gate that never ran never passed`);
  }
  if (c.breadth !== GREEN) blockers.push("verify:breadth is not green");
  if (c.parity !== GREEN) blockers.push("preflight↔CI parity is not green");

  // 3. Adversarial panel. Vetoes are absolute; a lens that did not run is a NO.
  const p = c.panel;
  if (!p) blockers.push("no adversarial panel result — an unreviewed diff never auto-merges");
  else {
    if (p.expectedLensesRan !== true) blockers.push("an expected lens did not run — a reviewer that did not run is a NO");
    if (p.unanimous !== true) blockers.push("the adversarial panel is not unanimous");
    if (p.confirmedCritical) blockers.push("a CONFIRMED critical finding stands");
    if (p.failOpen) blockers.push("a fail-open finding stands — the one class this fabric exists to prevent");
    if (p.vetoBlock) blockers.push("a veto lens (security-reviewer / fail-closed-auditor) returned BLOCK");
  }

  // 4. The remaining affirmative greens.
  if (c.bugHunt !== GREEN) blockers.push("bugHunt is not green");
  if (c.falsification !== GREEN) blockers.push("per-PR gate falsification is not green — a suite that cannot fail on these lines has not earned a merge (DR-050)");
  if (c.publication !== GREEN) blockers.push("publication-boundary is not green");
  if (c.launchClaims !== GREEN) blockers.push("launch-claims is not green");

  const decisionPath = blockers.some((b) => b.includes("DECISION PATH"));
  return {
    merge: blockers.length === 0,
    escalate: blockers.length > 0,
    reason: blockers.length === 0
      ? "authorized — every merge conjunct is affirmatively green and the diff is autonomous-tier"
      : `NOT authorized — ${blockers.length} blocker(s)`,
    decisionPath,
    blockers,
  };
}

// ── self-test: the happy path once, then each conjunct falsified ─────────────
function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, ok]);
  const okCtx = (over = {}) => ({
    switchOn: true,
    headClassification: { tier: "autonomous", matched: [] },
    preflight: { exit: 0, steps: [{ name: "a", status: "ok" }, { name: "b", status: "ok" }] },
    breadth: "green", parity: "green",
    panel: { unanimous: true, expectedLensesRan: true, confirmedCritical: false, failOpen: false, vetoBlock: false },
    bugHunt: "green", falsification: "green", publication: "green", launchClaims: "green",
    ...over,
  });

  t("the happy path authorizes a merge", decideMerge(okCtx()).merge === true);
  t("an empty context never authorizes", decideMerge(undefined).merge === false);

  // every conjunct, falsified one at a time
  t("switch off blocks", decideMerge(okCtx({ switchOn: false })).merge === false);
  t("switch absent blocks", decideMerge(okCtx({ switchOn: undefined })).merge === false);
  t("owner-gated tier blocks", decideMerge(okCtx({ headClassification: { tier: "owner-gated", matched: [] } })).merge === false);
  t("missing classification blocks", decideMerge(okCtx({ headClassification: null })).merge === false);
  t("DECISION_PATH blocks even when marked autonomous",
    decideMerge(okCtx({ headClassification: { tier: "autonomous", matched: [{ category: "DECISION_PATH" }] } })).merge === false);
  t("DECISION_PATH is named as such", decideMerge(okCtx({ headClassification: { tier: "autonomous", matched: [{ category: "DECISION_PATH" }] } })).decisionPath === true);
  t("preflight nonzero exit blocks", decideMerge(okCtx({ preflight: { exit: 1, steps: [{ name: "a", status: "ok" }] } })).merge === false);
  t("preflight exit 0 with a skipped step blocks (the false-green)",
    decideMerge(okCtx({ preflight: { exit: 0, steps: [{ name: "a", status: "ok" }, { name: "b", status: "skipped" }] } })).merge === false);
  t("preflight exit 0 with an unavailable step blocks",
    decideMerge(okCtx({ preflight: { exit: 0, steps: [{ name: "a", status: "unavailable" }] } })).merge === false);
  t("preflight with no steps blocks", decideMerge(okCtx({ preflight: { exit: 0, steps: [] } })).merge === false);
  t("breadth not green blocks", decideMerge(okCtx({ breadth: "red" })).merge === false);
  t("parity not green blocks", decideMerge(okCtx({ parity: "skipped" })).merge === false);
  t("a lens that did not run blocks", decideMerge(okCtx({ panel: { ...okCtx().panel, expectedLensesRan: false } })).merge === false);
  t("a non-unanimous panel blocks", decideMerge(okCtx({ panel: { ...okCtx().panel, unanimous: false } })).merge === false);
  t("a confirmed critical blocks", decideMerge(okCtx({ panel: { ...okCtx().panel, confirmedCritical: true } })).merge === false);
  t("a fail-open finding blocks", decideMerge(okCtx({ panel: { ...okCtx().panel, failOpen: true } })).merge === false);
  t("a veto BLOCK blocks", decideMerge(okCtx({ panel: { ...okCtx().panel, vetoBlock: true } })).merge === false);
  t("a missing panel blocks", decideMerge(okCtx({ panel: null })).merge === false);
  t("bugHunt not green blocks", decideMerge(okCtx({ bugHunt: "inconclusive" })).merge === false);
  t("falsification not green blocks", decideMerge(okCtx({ falsification: "not-green" })).merge === false);
  t("falsification absent blocks", decideMerge(okCtx({ falsification: undefined })).merge === false);
  t("publication not green blocks", decideMerge(okCtx({ publication: "red" })).merge === false);
  t("launch-claims not green blocks", decideMerge(okCtx({ launchClaims: "red" })).merge === false);

  // affirmative-green semantics: no token other than "green" may satisfy a conjunct
  t('"ok" does not satisfy a green conjunct', decideMerge(okCtx({ breadth: "ok" })).merge === false);
  t('"passed" does not satisfy a green conjunct', decideMerge(okCtx({ bugHunt: "passed" })).merge === false);
  t("every blocker is named", decideMerge(okCtx({ switchOn: false, breadth: "red" })).blockers.length === 2);

  const failed = checks.filter(([, o]) => !o);
  for (const [name, o] of checks) console.log(`  ${o ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function validate() {
  // Non-vacuity: the authorizer must refuse an empty context, or it means nothing.
  if (decideMerge(undefined).merge !== false || decideMerge({}).merge !== false) {
    console.error("merge authorizer would approve an empty context — refusing.");
    process.exit(1);
  }
  console.log("Brain-cycle merge authorizer ok — affirmative-green allowlist; an empty or partial context is refused.");
  console.log("Run with --self-test to exercise every conjunct in both directions (preflight + CI do).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest();
  else validate();
}
