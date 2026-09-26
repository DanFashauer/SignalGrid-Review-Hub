// check-owner-gated-surfaces.mjs — the mechanical line between what the autonomous
// merge loop MAY land and what it must hand to the owner. This is L4 of the
// steward's merge decision (see docs/DEFINITION_OF_DONE.md and DR-019): a diff that
// touches an owner-gated surface is escalated regardless of how correct the code is
// or how the backlog row was phrased.
//
//   node scripts/check-owner-gated-surfaces.mjs            # validate the manifest
//   node scripts/check-owner-gated-surfaces.mjs --self-test # prove classify() works
//   node scripts/check-owner-gated-surfaces.mjs --classify-branch <base-ref>
//     # print `KLASS <klass> files=<n> matched=<m>` for this branch's diff against
//     # the merge-base of <base-ref> and HEAD — the single line
//     # scripts/lib/land-branch-gate.mjs's resolveKlass() parses so the saved
//     # land-branch workflow derives its owner-decision class from the DIFF instead
//     # of trusting a caller-supplied klass string (Codex summary finding 7 on
//     # #1126/#1127, docs/BUILD_BACKLOG.md). Exit 0 with the KLASS line on a clean
//     # classification; exit 2 with `KLASS ERROR <reason>` on a git failure or an
//     # empty diff — an empty diff is not "other", it is unknown, and unknown fails
//     # closed. mostRestrictive() picks the single most restrictive category present,
//     # in order OWNER_RESERVED > DECISION_PATH > SAFETY_MACHINERY > other. `matched`
//     # counts RULE HITS, not files — one path can match more than one rule (e.g.
//     # scripts/mutation-guard.mjs matches both the blanket scripts/** rule and the
//     # gate/guard-registries rule), so matched can exceed files.
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
// THREE CATEGORIES, all owner-gated, kept distinct for the escalation message:
//   DECISION_PATH — golden rule 2's core: the deterministic verdict logic and its
//     connectors/flows (lib/*), the /v1 decision API, and the byte-faithful native
//     ports (golden rule 1). A model-judged auto-merge may NEVER land a change to how
//     SignalGrid DECIDES, regardless of how green the gauntlet is — this is the line
//     the auto-merge switch exists to protect. lib/* IS the decision core, so the
//     rule is blanket and fail-closed.
//   SAFETY_MACHINERY — the gates/CI/proofs themselves. "Green" proves nothing about
//     a weakened gate (the sweep that would catch it runs post-merge), so a robot
//     can never merge a change to its own safety net. This is the confirmed-unsafe
//     class; it stays with the owner until per-PR falsification of every gate exists.
//   OWNER_RESERVED — legal, pricing, launch scope, decision records, buyer-facing
//     copy. Correct code is not the question; these are the owner's to commit.

import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

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
  { rule: "the brain-cycle veto config (its own safety net)", re: /^docs\/agent\/brain-cycle-config\.json$/ },
  // DR-056: the declared objective — its criteria and the owner attestation pointer
  // (attestedIn). The token and criterion ids live in scripts/objective-loop.mjs, so the
  // json alone cannot reach goal_met; this is the second belt — a moved pointer is reviewed
  // as safety machinery, never as a doc.
  { rule: "the declared objective (DR-056 attestation pointer)", re: /^docs\/agent\/objective\.json$/ },
  // Finding 4 (Codex #1133 P1, 2026-09-26): a change touching ONLY .claude/workflows/
  // used to classify 'other' — the landing workflow itself (this file's own mirror of
  // canPush/resolveKlass/ownerDecisionText, the Chain/PR stages, the push worker's
  // one-liner) is exactly the kind of safety net a model-judged auto-merge must never
  // wave through on green alone. `.claude/hooks/` and `.claude/settings.json` are the
  // Bash deny-list hook and the deny list itself (CLAUDE.md "Never bypass a check"):
  // both are the same class of self-net as scripts/** already is.
  { rule: "the landing workflow (.claude/workflows/**)", re: /^\.claude\/workflows\// },
  { rule: "the Bash deny-list hook (.claude/hooks/**)", re: /^\.claude\/hooks\// },
  { rule: "the deny list itself (.claude/settings.json)", re: /^\.claude\/settings\.json$/ },
];

// A changed path matching ANY of these is OWNER_RESERVED. Correct code is not the point.
export const OWNER_RESERVED = [
  { rule: "license / notice", re: /^(LICENSE|NOTICE)(\.\w+)?$/ },
  { rule: "compliance & threat-model docs", re: /^docs\/(SECURITY_QUESTIONNAIRE_PACK|SECURITY_CONTROLS_MATRIX|[A-Z_]*THREAT_MODEL[A-Z_]*|COMPLIANCE[A-Z_]*)\.md$/ },
  { rule: "the launch profile", re: /^docs\/LAUNCH_PROFILE\.md$/ },
  { rule: "the cost model (owner billing)", re: /^docs\/COST_MODEL\.md$/ },
  { rule: "pricing & positioning", re: /(Pricing\.tsx$|^docs\/POSITIONING\.md$)/ },
  { rule: "buyer-facing site & outreach", re: /^(artifacts\/signalgrid-(web|review)\/|README\.md$|docs\/outreach\/)/ },
  // DR-037 names these three surfaces explicitly as ones the lane never merges
  // (land-branch-gate.mjs's OWNER_RESERVED text and README.md both name them) — without
  // a manifest rule, mostRestrictive() cannot resolve to OWNER_RESERVED for them, and
  // since the derived class now always overrides a caller's guess (Codex finding 7), a
  // caller that correctly said OWNER_RESERVED would be downgraded to whatever weaker
  // class the diff otherwise matched (usually SAFETY_MACHINERY, since these all live
  // under scripts/ or docs/).
  { rule: "the launch-claims gate", re: /^scripts\/check-launch-claims\.mjs$/ },
  { rule: "the publication boundary", re: /^(scripts\/(check-)?publication-boundary\.mjs|docs\/PUBLICATION_BOUNDARY\.md)$/ },
  { rule: "the launch-profile machinery", re: /^scripts\/(check-)?launch-profile\.(mjs|d\.mts)$/ },
  // Finding 3 (Codex #1133 P1, 2026-09-26): scripts/check-launch-claims.mjs's own
  // ceiling/baseline files (RETIRED_CEILING_FILE, DOCS_CEILING_FILE — the only two
  // constants it reads through readRatchetFile()) live under docs/agent/, not
  // scripts/, so raising either was an 'other' change: an autonomous merge could widen
  // what the launch-claims gate tolerates without ever touching the gate's own code.
  { rule: "the launch-claims ceilings (scripts/check-launch-claims.mjs's own RETIRED_CEILING_FILE / DOCS_CEILING_FILE — raising either weakens the gate through an 'other' change)", re: /^docs\/agent\/launch-claims-(retired-labels|docs)-ceiling\.json$/ },
];

// A changed path matching ANY of these is DECISION_PATH — golden rule 2's core. A
// model-judged auto-merge may NEVER merge these; they escalate to the owner however
// green the gauntlet is. lib/* IS the decision core (CLAUDE.md), so the rule is
// blanket and fail-closed: an unrecognised lib/ shape escalates rather than merges.
export const DECISION_PATH = [
  { rule: "the decision core / connectors / flows (lib/*)", re: /^lib\// },
  { rule: "the /v1 decision API server", re: /^artifacts\/api-server\// },
  { rule: "the byte-faithful native decision ports", re: /^native\/ios\/EnterpriseShell\/Services\/(DecisionEngine|AppWorkflows)\.swift$/ },
];

// Normalize a diff path before classifying, so an owner-gated file cannot be laundered
// past the manifest on a path-shape technicality — a leading ./, a git a//b/ diff
// prefix, or a backslash separator. Fail-closed toward the canonical repo-relative form.
function normalizePath(f) {
  let x = String(f).replace(/\\/g, "/"); // backslash -> forward slash
  x = x.replace(/^\.\//, "");             // strip leading ./
  return x;
}

/** Both readings of a path: as given, and with a git a//b/ diff prefix removed. classifyDiff
 *  tests BOTH and takes any match — fail-closed in both directions. A blind prefix strip
 *  would mangle a legitimate top-level directory literally named `a` or `b`; matching only
 *  the raw form would let `a/scripts/x.mjs` hide from the manifest. */
function pathForms(f) {
  const n = normalizePath(f);
  const stripped = n.replace(/^[ab]\//, "");
  return stripped === n ? [n] : [n, stripped];
}

/**
 * Classify a set of changed file paths (repo-relative, forward slashes). Returns
 * the merge tier and the exact rules that matched. "autonomous" only when NO file
 * hits either owner-gated list — fail-closed: an unrecognised owner-gated shape is
 * safer to escalate, so the lists err toward matching.
 */
export function classifyDiff(files) {
  const matched = [];
  for (const raw of files) {
    const forms = pathForms(raw);
    const hit = (p) => forms.some((f) => p.re.test(f));
    const f = forms[0];
    for (const p of DECISION_PATH) if (hit(p)) matched.push({ file: f, category: "DECISION_PATH", rule: p.rule });
    for (const p of SAFETY_MACHINERY) if (hit(p)) matched.push({ file: f, category: "SAFETY_MACHINERY", rule: p.rule });
    for (const p of OWNER_RESERVED) if (hit(p)) matched.push({ file: f, category: "OWNER_RESERVED", rule: p.rule });
  }
  return { tier: matched.length ? "owner-gated" : "autonomous", matched };
}

// The single most restrictive category present in a classifyDiff() result, in order
// OWNER_RESERVED > DECISION_PATH > SAFETY_MACHINERY > other ("other" = tier
// "autonomous", i.e. no rule matched). Pure, so both the CLI and its self-test can
// exercise the ordering directly.
export function mostRestrictive({ matched } = {}) {
  const present = new Set((matched || []).map((m) => m.category));
  for (const cat of ["OWNER_RESERVED", "DECISION_PATH", "SAFETY_MACHINERY"]) {
    if (present.has(cat)) return cat;
  }
  return "other";
}

function firstLine(s) {
  return String(s ?? "").split("\n")[0].trim();
}

// stdio explicitly piped (never inherited) so a git failure's own stderr never reaches
// the terminal alongside ours — the CLI's contract is EXACTLY one printed line, and the
// caller (the Merge stage worker) is told to return that line verbatim.
const GIT_OPTS = { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };

function classifyBranch(baseRef) {
  let mergeBase;
  try {
    mergeBase = execFileSync("git", ["merge-base", baseRef, "HEAD"], GIT_OPTS).trim();
  } catch (err) {
    console.log(`KLASS ERROR git merge-base ${baseRef} HEAD failed: ${firstLine(err.stderr || err.message)}`);
    process.exit(2);
  }
  let files;
  try {
    // Codex finding 1 (2026-09-26): git's default rename detection collapses a
    // rename/move diff down to just the NEW path, so `--no-renames` is required or an
    // owner-gated file moved OUT of its gated location (or a decision-path file moved
    // out of lib/) is invisible to the manifest — fail-open. `-c core.quotePath=false`
    // stops git C-quoting a non-ASCII path (`lib/décision.ts` -> `"lib/d\303\251cision.ts"`,
    // which matches no manifest rule — also fail-open). `-z` + split on NUL keeps a path
    // containing a literal newline from being read as two paths.
    files = execFileSync(
      "git",
      ["-c", "core.quotePath=false", "diff", "--no-renames", "--name-only", "-z", `${mergeBase}..HEAD`],
      GIT_OPTS,
    )
      .split("\0")
      .filter((l) => l.length > 0);
  } catch (err) {
    console.log(`KLASS ERROR git diff --name-only ${mergeBase}..HEAD failed: ${firstLine(err.stderr || err.message)}`);
    process.exit(2);
  }
  if (files.length === 0) {
    // Fail-closed (CLAUDE.md golden rule 2): an empty diff against the base is an
    // unknown, not evidence of "nothing owner-gated" — never classify it "other".
    console.log(`KLASS ERROR empty diff against merge-base ${mergeBase} of ${baseRef} and HEAD`);
    process.exit(2);
  }
  const classification = classifyDiff(files);
  const klass = mostRestrictive(classification);
  console.log(`KLASS ${klass} files=${files.length} matched=${classification.matched.length}`);
  process.exit(0);
}

// Finding 1 (blocking, 2026-09-26): the CLI's own git-diff path had NO self-test —
// only classifyDiff()/mostRestrictive() were exercised, both of which take a plain
// array of path strings and never see git's rename-collapsing or path-quoting. These
// build a throwaway repo under os.tmpdir() (never inside this tree) and shell out to
// a FRESH node process running this same file, so the fix under test is the real CLI
// path (parsing, exit code, and all), not classifyDiff() called directly.
function withTempRepo(fn) {
  const dir = mkdtempSync(join(tmpdir(), "check-owner-gated-surfaces-selftest-"));
  try {
    execFileSync("git", ["init", "-q", "-b", "main", dir]);
    execFileSync("git", ["-C", dir, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", dir, "config", "user.name", "test"]);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runClassifyBranchCli(cwd, baseRef) {
  try {
    const stdout = execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--classify-branch", baseRef],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, stdout: stdout.trim() };
  } catch (err) {
    return { code: typeof err.status === "number" ? err.status : 1, stdout: String(err.stdout || "").trim() };
  }
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
  t("the brain-cycle veto config is SAFETY_MACHINERY", cls(["docs/agent/brain-cycle-config.json"]).tier === "owner-gated");
  t("the declared objective (DR-056) is SAFETY_MACHINERY", cls(["docs/agent/objective.json"]).tier === "owner-gated");
  t("…but the loop's derived STATE is not (the Mac tick rewrites it unattended)", cls(["docs/agent/objective-state.json"]).tier !== "owner-gated");
  t("LICENSE is OWNER_RESERVED", cls(["LICENSE"]).tier === "owner-gated");
  t("NOTICE is OWNER_RESERVED", cls(["NOTICE"]).tier === "owner-gated");
  t("the launch profile is OWNER_RESERVED", cls(["docs/LAUNCH_PROFILE.md"]).tier === "owner-gated");
  t("pricing is OWNER_RESERVED", cls(["artifacts/signalgrid-web/src/pages/Pricing.tsx"]).tier === "owner-gated");
  t("buyer-facing site is OWNER_RESERVED", cls(["artifacts/signalgrid-web/src/pages/About.tsx"]).tier === "owner-gated");
  t("the cost model is OWNER_RESERVED", cls(["docs/COST_MODEL.md"]).tier === "owner-gated");
  // Finding 2 (blocking, 2026-09-26): DR-037 names these three surfaces as ones the
  // lane never merges; without a manifest rule mostRestrictive() cannot resolve to
  // OWNER_RESERVED for them, so a caller who correctly says OWNER_RESERVED was
  // downgraded once the derived class started always winning (Codex finding 7).
  t("the launch-claims gate is OWNER_RESERVED", mostRestrictive(cls(["scripts/check-launch-claims.mjs"])) === "OWNER_RESERVED");
  t("the publication-boundary checker is OWNER_RESERVED", mostRestrictive(cls(["scripts/check-publication-boundary.mjs"])) === "OWNER_RESERVED");
  t("the publication-boundary module is OWNER_RESERVED", mostRestrictive(cls(["scripts/publication-boundary.mjs"])) === "OWNER_RESERVED");
  t("the publication-boundary doc is OWNER_RESERVED", mostRestrictive(cls(["docs/PUBLICATION_BOUNDARY.md"])) === "OWNER_RESERVED");
  t("launch-profile.mjs is OWNER_RESERVED", mostRestrictive(cls(["scripts/launch-profile.mjs"])) === "OWNER_RESERVED");
  t("check-launch-profile.mjs is OWNER_RESERVED", mostRestrictive(cls(["scripts/check-launch-profile.mjs"])) === "OWNER_RESERVED");
  t("launch-profile.d.mts is OWNER_RESERVED", mostRestrictive(cls(["scripts/launch-profile.d.mts"])) === "OWNER_RESERVED");
  // Finding 3 (Codex #1133 P1): the launch-claims gate's own ceiling/baseline files
  // (scripts/check-launch-claims.mjs's RETIRED_CEILING_FILE / DOCS_CEILING_FILE) live
  // under docs/agent/, not scripts/ — without a manifest rule, raising either ceiling
  // was an 'other' change that weakened the gate without ever touching its code.
  t("the launch-claims retired-labels ceiling is OWNER_RESERVED", mostRestrictive(cls(["docs/agent/launch-claims-retired-labels-ceiling.json"])) === "OWNER_RESERVED");
  t("the launch-claims docs ceiling is OWNER_RESERVED", mostRestrictive(cls(["docs/agent/launch-claims-docs-ceiling.json"])) === "OWNER_RESERVED");

  // The other direction: ordinary product/connector code IS autonomous, or the gate
  // refuses everything and means nothing.
  t("a connector evaluator is DECISION_PATH owner-gated", cls(["lib/integrations/src/integrations/task-exception/evaluate.ts"]).tier === "owner-gated");
  t("core decision logic is DECISION_PATH owner-gated", cls(["lib/signalgrid-core/src/decision.ts"]).tier === "owner-gated");
  // DECISION_PATH positives — the golden-rule-2 core must never classify autonomous.
  t("the engine is DECISION_PATH", cls(["lib/signalgrid-core/src/engine.ts"]).matched.some((m) => m.category === "DECISION_PATH"));
  t("the /v1 API server is DECISION_PATH", cls(["artifacts/api-server/src/routes/v1.ts"]).matched.some((m) => m.category === "DECISION_PATH"));
  t("the native DecisionEngine port is DECISION_PATH", cls(["native/ios/EnterpriseShell/Services/DecisionEngine.swift"]).matched.some((m) => m.category === "DECISION_PATH"));
  t("AppWorkflows port is DECISION_PATH", cls(["native/ios/EnterpriseShell/Services/AppWorkflows.swift"]).tier === "owner-gated");
  // A non-decision doc under lib is not caught by DECISION_PATH's blanket only if it is NOT under lib/ — lib/* is blanket, so this stays autonomous because it is a docs path.
  // Path-normalization bypasses must NOT launder an owner-gated file to autonomous.
  t("a leading ./ does not launder scripts/ to autonomous", cls(["./scripts/mutation-guard.mjs"]).tier === "owner-gated");
  t("a git a/ diff prefix does not launder scripts/ to autonomous", cls(["a/scripts/mutation-guard.mjs"]).tier === "owner-gated");
  t("a backslash separator does not launder scripts/ to autonomous", cls(["scripts\\mutation-guard.mjs"]).tier === "owner-gated");
  t("a normalized lib/ path is DECISION_PATH", cls(["b/lib/signalgrid-core/src/decision.ts"]).tier === "owner-gated");
  t("a roster-scoped doc is autonomous", cls(["docs/GLOSSARY.md"]).tier === "autonomous");

  // Finding 4 (Codex #1133 P1): .claude/workflows|hooks|settings.json are the landing
  // workflow, the Bash deny-list hook, and the deny list itself — a change touching
  // ONLY one of these used to classify 'other' and slip an autonomous merge past
  // exactly the surfaces meant to stop it.
  t(".claude/workflows/ change is SAFETY_MACHINERY", cls([".claude/workflows/land-branch.js"]).tier === "owner-gated");
  t(".claude/hooks/ change is SAFETY_MACHINERY", cls([".claude/hooks/deny-bash.mjs"]).tier === "owner-gated");
  t(".claude/settings.json change is SAFETY_MACHINERY", cls([".claude/settings.json"]).tier === "owner-gated");
  t(".claude/settings.local.json (not the deny list itself) is autonomous", cls([".claude/settings.local.json"]).tier === "autonomous");

  // A mixed diff with even one owner-gated file is owner-gated (the unsafe half wins).
  t("one owner-gated file taints an otherwise-autonomous diff",
    cls(["lib/signalgrid-core/src/decision.ts", "scripts/mutation-guard.mjs"]).tier === "owner-gated");

  // Non-vacuity: both lists carry rules, so the gate has a subject.
  t("all three manifests are non-empty", DECISION_PATH.length > 0 && SAFETY_MACHINERY.length > 0 && OWNER_RESERVED.length > 0);

  // mostRestrictive() ordering (Codex finding 7 follow-up, docs/BUILD_BACKLOG.md
  // "land-branch.js's Owner decision needed text should be derived from the changed
  // paths"): the CLI's --classify-branch prints exactly this function's verdict.
  t("scripts/ + lib/signalgrid-core → DECISION_PATH beats SAFETY_MACHINERY",
    mostRestrictive(cls(["scripts/mutation-guard.mjs", "lib/signalgrid-core/src/decision.ts"])) === "DECISION_PATH");
  t("…plus the launch profile → OWNER_RESERVED beats both",
    mostRestrictive(cls(["scripts/mutation-guard.mjs", "lib/signalgrid-core/src/decision.ts", "docs/LAUNCH_PROFILE.md"])) === "OWNER_RESERVED");
  t("docs-only diff → other", mostRestrictive(cls(["docs/GLOSSARY.md"])) === "other");
  t("scripts/-only diff → SAFETY_MACHINERY beats other", mostRestrictive(cls(["scripts/mutation-guard.mjs"])) === "SAFETY_MACHINERY");

  // --classify-branch itself, over a real git diff (finding 1): renaming an
  // owner-gated file out of its gated location, a non-ASCII lib/ path, an up-to-date
  // branch, and a bad ref.
  withTempRepo((dir) => {
    mkdirSync(join(dir, "docs"), { recursive: true });
    writeFileSync(join(dir, "docs", "LAUNCH_PROFILE.md"), "profile\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "feature"]);
    execFileSync("git", ["-C", dir, "mv", "docs/LAUNCH_PROFILE.md", "docs/OLD_PROFILE.md"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "rename the launch profile away"]);
    const res = runClassifyBranchCli(dir, "main");
    t("--classify-branch: renaming an owner-reserved file away is not laundered to other by git's default rename detection", res.code === 0 && res.stdout.startsWith("KLASS OWNER_RESERVED"));
  });

  withTempRepo((dir) => {
    mkdirSync(join(dir, "lib"), { recursive: true });
    writeFileSync(join(dir, "lib", "placeholder.ts"), "export {};\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    execFileSync("git", ["-C", dir, "checkout", "-q", "-b", "feature"]);
    writeFileSync(join(dir, "lib", "décision.ts"), "export const x = 1;\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "add a non-ascii decision-path file"]);
    const res = runClassifyBranchCli(dir, "main");
    t("--classify-branch: a non-ASCII lib/ path is not C-quoted past the manifest", res.code === 0 && res.stdout.startsWith("KLASS DECISION_PATH"));
  });

  withTempRepo((dir) => {
    writeFileSync(join(dir, "f.txt"), "x\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    const res = runClassifyBranchCli(dir, "main"); // HEAD already at main: empty diff
    t("--classify-branch: an up-to-date branch (empty diff) is KLASS ERROR at exit 2", res.code === 2 && res.stdout.startsWith("KLASS ERROR"));
  });

  withTempRepo((dir) => {
    writeFileSync(join(dir, "f.txt"), "x\n");
    execFileSync("git", ["-C", dir, "add", "-A"]);
    execFileSync("git", ["-C", dir, "commit", "-q", "-m", "initial"]);
    const res = runClassifyBranchCli(dir, "does-not-exist-ref");
    t("--classify-branch: a bad base ref is KLASS ERROR at exit 2", res.code === 2 && res.stdout.startsWith("KLASS ERROR"));
  });

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function validate() {
  // At rest there is no diff to classify; the gate proves the manifest is well-formed
  // and non-vacuous so a later empty manifest cannot silently classify everything
  // autonomous. The behaviour is proven by --self-test, which preflight also runs.
  if (DECISION_PATH.length === 0 || SAFETY_MACHINERY.length === 0 || OWNER_RESERVED.length === 0) {
    console.error("owner-gated manifest is empty — every diff would classify autonomous. Refusing.");
    process.exit(1);
  }
  for (const p of [...DECISION_PATH, ...SAFETY_MACHINERY, ...OWNER_RESERVED]) {
    if (!(p.re instanceof RegExp) || typeof p.rule !== "string" || !p.rule) {
      console.error(`malformed manifest entry: ${JSON.stringify(p)}`);
      process.exit(1);
    }
  }
  console.log(`Owner-gated surfaces manifest ok — ${DECISION_PATH.length} decision-path rules, ${SAFETY_MACHINERY.length} safety-machinery rules, ${OWNER_RESERVED.length} owner-reserved rules.`);
  console.log("Run with --self-test to exercise classifyDiff (preflight + CI do).");
}

// Guarded so this module can be IMPORTED for classifyDiff (e.g. by the brain cycle)
// without running its CLI as a side effect. Direct invocation is unchanged.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const classifyIdx = process.argv.indexOf("--classify-branch");
  if (classifyIdx !== -1) {
    const baseRef = process.argv[classifyIdx + 1];
    if (!baseRef) {
      console.log("KLASS ERROR --classify-branch requires a <base-ref> argument");
      process.exit(2);
    }
    classifyBranch(baseRef);
  } else if (process.argv.includes("--self-test")) selfTest();
  else validate();
}
