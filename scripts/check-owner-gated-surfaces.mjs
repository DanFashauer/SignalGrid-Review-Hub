// check-owner-gated-surfaces.mjs — the mechanical line between what the autonomous
// merge loop MAY land and what it must hand to the owner. This is L4 of the
// steward's merge decision (see docs/DEFINITION_OF_DONE.md and DR-019): a diff that
// touches an owner-gated surface is escalated regardless of how correct the code is
// or how the backlog row was phrased.
//
//   node scripts/check-owner-gated-surfaces.mjs            # validate the manifest
//   node scripts/check-owner-gated-surfaces.mjs --self-test # prove classify() works
//
// WHY MECHANICAL, NOT REVIEWER JUDGMENT. An adversarial verification of the
// autonomous-merge design found two ways owner-gated work slips through if the
// escalate rule is prose bound to nobody: (1) a diff that quietly weakens a gate
// stays green because the full mutation sweep is post-merge, and "classify as
// GREEN" is itself a judgment call a reviewer can get wrong; (2) an owner-reserved
// edit (LICENSE, pricing, launch scope) that is correctly implemented passes every
// review layer. So the routing is a path+pattern manifest checked in code, copying
// the shape of check-launch-claims.mjs, not a sentence the steward is trusted to
// apply.
//
// TWO CATEGORIES, both owner-gated, kept distinct for the escalation message:
//   SAFETY_MACHINERY — the gates/CI/proofs themselves. "Green" proves nothing about
//     a weakened gate (the sweep that would catch it runs post-merge), so a robot
//     can never merge a change to its own safety net. This is the confirmed-unsafe
//     class; it stays with the owner until per-PR falsification of every gate exists.
//   OWNER_RESERVED — legal, pricing, launch scope, decision records, buyer-facing
//     copy. Correct code is not the question; these are the owner's to commit.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A changed path matching ANY of these is SAFETY_MACHINERY. Green never suffices.
export const SAFETY_MACHINERY = [
  { rule: "scripts/**", re: /^scripts\// },
  { rule: ".github/workflows/**", re: /^\.github\/workflows\// },
  { rule: "any proof harness", re: /(^|\/)[\w.-]*proof[\w.-]*\.(ts|mjs|js)$/i },
  { rule: "any fixtures dir", re: /(^|\/)fixtures?\// },
  { rule: "the gate/guard registries", re: /^scripts\/(mutation-guard|check-guard-registries|check-mutation-sharding)\.mjs$/ },
  { rule: "workspace/lockfile", re: /^(pnpm-workspace\.yaml|pnpm-lock\.yaml)$/ },
  { rule: "the decision records", re: /^docs\/DECISION_RECORDS\.md$/ },
];

// A changed path matching ANY of these is OWNER_RESERVED. Correct code is not the point.
export const OWNER_RESERVED = [
  { rule: "license / notice", re: /^(LICENSE|NOTICE)(\.\w+)?$/ },
  { rule: "compliance & threat-model docs", re: /^docs\/(SECURITY_QUESTIONNAIRE_PACK|SECURITY_CONTROLS_MATRIX|[A-Z_]*THREAT_MODEL[A-Z_]*|COMPLIANCE[A-Z_]*)\.md$/ },
  { rule: "the launch profile", re: /^docs\/LAUNCH_PROFILE\.md$/ },
  { rule: "the cost model (owner billing)", re: /^docs\/COST_MODEL\.md$/ },
  { rule: "pricing & positioning", re: /(Pricing\.tsx$|^docs\/POSITIONING\.md$)/ },
  { rule: "buyer-facing site & outreach", re: /^(artifacts\/signalgrid-(web|review)\/|README\.md$|docs\/outreach\/)/ },
];

/**
 * Classify a set of changed file paths (repo-relative, forward slashes). Returns
 * the merge tier and the exact rules that matched. "autonomous" only when NO file
 * hits either owner-gated list — fail-closed: an unrecognised owner-gated shape is
 * safer to escalate, so the lists err toward matching.
 */
export function classifyDiff(files) {
  const matched = [];
  for (const f of files) {
    for (const p of SAFETY_MACHINERY) if (p.re.test(f)) matched.push({ file: f, category: "SAFETY_MACHINERY", rule: p.rule });
    for (const p of OWNER_RESERVED) if (p.re.test(f)) matched.push({ file: f, category: "OWNER_RESERVED", rule: p.rule });
  }
  return { tier: matched.length ? "owner-gated" : "autonomous", matched };
}

function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, ok]);
  const cls = (files) => classifyDiff(files);

  // Each owner-gated category must route to owner-gated.
  t("scripts/ change is SAFETY_MACHINERY", cls(["scripts/mutation-guard.mjs"]).tier === "owner-gated");
  t("a CI workflow change is SAFETY_MACHINERY", cls([".github/workflows/review-hub-ci.yml"]).tier === "owner-gated");
  t("a proof harness is SAFETY_MACHINERY", cls(["scripts/src/webauthn-verify-proof.ts"]).tier === "owner-gated");
  t("a fixtures dir is SAFETY_MACHINERY", cls(["lib/foo/fixtures/case.json"]).tier === "owner-gated");
  t("the lockfile is SAFETY_MACHINERY", cls(["pnpm-lock.yaml"]).tier === "owner-gated");
  t("the decision records are owner-gated", cls(["docs/DECISION_RECORDS.md"]).tier === "owner-gated");
  t("LICENSE is OWNER_RESERVED", cls(["LICENSE"]).tier === "owner-gated");
  t("NOTICE is OWNER_RESERVED", cls(["NOTICE"]).tier === "owner-gated");
  t("the launch profile is OWNER_RESERVED", cls(["docs/LAUNCH_PROFILE.md"]).tier === "owner-gated");
  t("pricing is OWNER_RESERVED", cls(["artifacts/signalgrid-web/src/pages/Pricing.tsx"]).tier === "owner-gated");
  t("buyer-facing site is OWNER_RESERVED", cls(["artifacts/signalgrid-web/src/pages/About.tsx"]).tier === "owner-gated");
  t("the cost model is OWNER_RESERVED", cls(["docs/COST_MODEL.md"]).tier === "owner-gated");

  // The other direction: ordinary product/connector code IS autonomous, or the gate
  // refuses everything and means nothing.
  t("a connector evaluator is autonomous", cls(["lib/integrations/src/integrations/task-exception/evaluate.ts"]).tier === "autonomous");
  t("core decision logic is autonomous", cls(["lib/signalgrid-core/src/decision.ts"]).tier === "autonomous");
  t("a roster-scoped doc is autonomous", cls(["docs/GLOSSARY.md"]).tier === "autonomous");

  // A mixed diff with even one owner-gated file is owner-gated (the unsafe half wins).
  t("one owner-gated file taints an otherwise-autonomous diff",
    cls(["lib/signalgrid-core/src/decision.ts", "scripts/mutation-guard.mjs"]).tier === "owner-gated");

  // Non-vacuity: both lists carry rules, so the gate has a subject.
  t("both manifests are non-empty", SAFETY_MACHINERY.length > 0 && OWNER_RESERVED.length > 0);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function validate() {
  // At rest there is no diff to classify; the gate proves the manifest is well-formed
  // and non-vacuous so a later empty manifest cannot silently classify everything
  // autonomous. The behaviour is proven by --self-test, which preflight also runs.
  if (SAFETY_MACHINERY.length === 0 || OWNER_RESERVED.length === 0) {
    console.error("owner-gated manifest is empty — every diff would classify autonomous. Refusing.");
    process.exit(1);
  }
  for (const p of [...SAFETY_MACHINERY, ...OWNER_RESERVED]) {
    if (!(p.re instanceof RegExp) || typeof p.rule !== "string" || !p.rule) {
      console.error(`malformed manifest entry: ${JSON.stringify(p)}`);
      process.exit(1);
    }
  }
  console.log(`Owner-gated surfaces manifest ok — ${SAFETY_MACHINERY.length} safety-machinery rules, ${OWNER_RESERVED.length} owner-reserved rules.`);
  console.log("Run with --self-test to exercise classifyDiff (preflight + CI do).");
}

if (process.argv.includes("--self-test")) selfTest();
else validate();
