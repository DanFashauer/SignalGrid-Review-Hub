#!/usr/bin/env node
// check-pr-gate-falsification.mjs — the per-PR precondition DR-050 named before the
// brain-cycle GREEN auto-merge switch may flip. It answers ONE question about a PR:
//
//     for the lines THIS diff actually changed, can any gate still go red?
//
// A PR that passes every gate proves nothing if no gate can FAIL on the code it touched.
// That is a false green, and it is the specific hole between "the suite is green" and
// "this change is safe to merge without a human". The full mutation sweep
// (mutation-guard.mjs) answers this repo-wide and POST-merge; this answers it per-PR and
// PRE-merge, over the diff's own changed lines only.
//
//   node scripts/check-pr-gate-falsification.mjs --base <ref> --head <ref>   # judge a PR
//   node scripts/check-pr-gate-falsification.mjs --self-test                 # prove the arms
//   node scripts/check-pr-gate-falsification.mjs                             # at-rest validate
//
// FAIL-CLOSED BY CONSTRUCTION. Every arm below resolves to NOT-GREEN, because this gate
// authorizes an unattended merge and the cost of a wrong "green" is a regression on
// mainline that nobody reviewed:
//   · baseline red (the covering proof already fails unmutated)  -> NOT GREEN
//   · a changed file with NO covering gate                       -> FINDING, escalate
//   · zero applicable mutations on the changed lines             -> NOT GREEN
//   · every mutation on a changed line SURVIVED                  -> NOT GREEN
//   · a proof that hung / timed out / hit a cap                  -> INCONCLUSIVE, NOT GREEN
//   · an empty diff                                              -> NOT GREEN (nothing proven)
//
// THE HUNG POLARITY IS DELIBERATELY INVERTED from mutation-guard's. There, a hung proof
// counts as "killed" — defensible for a survey whose job is to find survivors. Here a hang
// means the gate never answered, and an unanswered gate may never authorize a merge.
//
// MODEL-FREE. Golden rule 2: the merge authorizer is deterministic. No model output is an
// input to this decision; a model may triage a survivor for a human, never dismiss one.
//
// ISOLATION. A real run happens in a THROWAWAY git worktree of the head, never the shared
// checkout — a crashed run must not leave a mutated file behind and poison
// provenance.workingTreeClean for every later sim result.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TARGETS, mutationsFor, runProof } from "./mutation-guard.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Source files this gate can mutate. Anything else is a class it cannot falsify by
// mutation and must not silently pass.
const EXECUTABLE = /\.(ts|tsx|mjs|js)$/;

/** Normalize a diff path so an owner-gated or covered file cannot be missed on a path
 *  shape: a leading ./, a git a//b/ prefix, or a backslash separator. */
export function normalizePath(f) {
  let x = String(f).replace(/\\/g, "/");
  x = x.replace(/^\.\//, "");
  return x;
}

/** Both readings of a path: as given, and with a git a//b/ diff prefix removed. Callers
 *  match against BOTH — fail-closed. A blind strip would mangle a legitimate top-level
 *  directory literally named `a` or `b` (self-test caught exactly that), while matching
 *  only the raw form would let a diff-prefixed path hide from the registry. */
export function pathForms(f) {
  const n = normalizePath(f);
  const stripped = n.replace(/^[ab]\//, "");
  return stripped === n ? [n] : [n, stripped];
}

/** Every registered proof that covers this file, from mutation-guard's own TARGETS —
 *  one registry, not a second copy that could drift. */
export function coveringProofs(file, targets = TARGETS) {
  const forms = pathForms(file);
  const out = [];
  for (const t of targets) {
    const reg = (t.files ?? []).map(normalizePath);
    if (forms.some((f) => reg.includes(f))) out.push(t.proof);
  }
  return [...new Set(out)];
}

/**
 * THE PURE DECISION. Takes one report per changed file and returns the merge-authorizing
 * verdict. Pure so --self-test can prove every fail-closed arm in both directions without
 * running a proof. A report is:
 *   { file, executable, coveringProofs[], baseline: "pass"|"fail"|"inconclusive"|null,
 *     mutationsTried, killed, inconclusive }
 */
export function decideFalsification(reports) {
  const findings = [];
  if (!Array.isArray(reports) || reports.length === 0) {
    return { green: false, escalate: false, reason: "empty diff — a merge authorizer proves nothing about no change", findings };
  }
  for (const r of reports) {
    if (!r.coveringProofs || r.coveringProofs.length === 0) {
      findings.push(`${r.file}: NO COVERING GATE — nothing in the mutation registry can fail on this file`);
      continue;
    }
    if (r.baseline !== "pass") {
      findings.push(`${r.file}: baseline ${r.baseline ?? "unknown"} — the covering proof does not pass unmutated, so a kill proves nothing`);
      continue;
    }
    if (r.inconclusive) {
      findings.push(`${r.file}: INCONCLUSIVE — a covering proof hung, timed out or hit a cap; an unanswered gate never authorizes a merge`);
      continue;
    }
    if (!r.mutationsTried) {
      findings.push(`${r.file}: zero applicable mutations on the changed lines — this gate cannot falsify this change`);
      continue;
    }
    if (!r.killed) {
      findings.push(`${r.file}: every mutation on the changed lines SURVIVED — no gate goes red on this code`);
      continue;
    }
  }
  const escalate = findings.some((f) => f.includes("NO COVERING GATE"));
  return {
    green: findings.length === 0,
    escalate,
    reason: findings.length === 0
      ? `falsified — every changed file has a covering gate that goes red on its own changed lines (${reports.length} file(s))`
      : `NOT GREEN — ${findings.length} of ${reports.length} changed file(s) could not be falsified`,
    findings,
  };
}

// ── real run (impure) ────────────────────────────────────────────────────────
const git = (args, cwd = repo) => spawnSync("git", args, { cwd, encoding: "utf8" });

export function changedFiles(base, head, cwd = repo) {
  const mb = git(["merge-base", base, head], cwd).stdout?.trim();
  if (!mb) return null; // fail-closed: cannot establish a base
  const out = git(["diff", "--name-only", "--no-renames", `${mb}..${head}`], cwd).stdout ?? "";
  return { mergeBase: mb, files: out.split("\n").map((s) => s.trim()).filter(Boolean).map(normalizePath) };
}

/** The new-side line numbers this diff touched, from --unified=0 hunk headers. */
export function changedLines(base, head, file, cwd = repo) {
  const out = git(["diff", "--unified=0", "--no-renames", `${base}..${head}`, "--", file], cwd).stdout ?? "";
  const lines = new Set();
  for (const m of out.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(m[1]);
    const count = m[2] === undefined ? 1 : Number(m[2]);
    for (let i = 0; i < count; i += 1) lines.add(start + i);
  }
  return lines;
}

function reportForFile(file, touched, worktree) {
  const proofs = coveringProofs(file);
  const base = { file, executable: EXECUTABLE.test(file), coveringProofs: proofs, baseline: null, mutationsTried: 0, killed: 0, inconclusive: false };
  if (proofs.length === 0) return base;
  if (!base.executable) return { ...base, baseline: "pass", mutationsTried: 0 }; // non-executable: no mutation primitive → not green, named as such

  const proof = proofs[0];
  const baselineVerdict = runProof(proof);
  if (baselineVerdict === "hung") return { ...base, baseline: "inconclusive", inconclusive: true };
  if (baselineVerdict !== "survivor") return { ...base, baseline: "fail" };

  const abs = join(worktree, file);
  // NO existsSync-then-write. Two problems with the pair this replaces, and CodeQL
  // flagged the smaller one:
  //   · TOCTOU — the check and the use were separate calls, so the answer could be
  //     stale by the time it was acted on.
  //   · The semantics were worse than the race. A file this run could not find was
  //     answered with `baseline: "pass"` — the word for "the proof passes on the
  //     unmutated tree" — when the truth is that nothing was established at all.
  // Attempt the operation and let its failure BE the answer: unreadable or unwritable
  // is INCONCLUSIVE, which escalates, and never a pass. (`mutationsTried: 0` already
  // escalated downstream, so this tightens a name that was wrong rather than a hole
  // that was open — but a checker that reports the wrong reason is how the next hole
  // gets argued as fine.)
  let restore;
  try {
    restore = readFileSync(abs, "utf8");
  } catch {
    return { ...base, baseline: "inconclusive", inconclusive: true };
  }
  const all = mutationsFor(file).filter((m) => touched.has(m.lineNo));
  let killed = 0;
  let inconclusive = false;
  for (const mut of all) {
    let v;
    try {
      writeFileSync(abs, mut.content);
      v = runProof(proof);
    } catch {
      inconclusive = true;
    } finally {
      // The original goes back even when the run threw, so one failed mutation cannot
      // leave a mutated file behind for the next one to measure against.
      try { writeFileSync(abs, mut.original ?? restore); } catch { inconclusive = true; }
    }
    if (inconclusive) break;
    if (v === "hung") { inconclusive = true; break; }
    if (v === "killed") { killed += 1; break; } // one kill per file is the bar
  }
  return { ...base, baseline: "pass", mutationsTried: all.length, killed, inconclusive };
}

function realRun(baseRef, headRef) {
  const cf = changedFiles(baseRef, headRef);
  if (!cf) { console.error("falsification: cannot resolve a merge-base — fail-closed, NOT GREEN."); process.exit(1); }
  // Isolation: a throwaway worktree of the head, never the shared checkout.
  const wt = mkdtempSync(join(tmpdir(), "sg-falsify-"));
  const add = git(["worktree", "add", "--detach", wt, headRef]);
  if (add.status !== 0) { console.error(`falsification: could not create an isolated worktree — fail-closed.\n${add.stderr}`); process.exit(1); }
  try {
    const reports = cf.files.map((f) => reportForFile(f, changedLines(cf.mergeBase, headRef, f), wt));
    const v = decideFalsification(reports);
    for (const f of v.findings) console.log(`  ✗ ${f}`);
    console.log(`\npr-gate-falsification: ${v.green ? "GREEN" : "NOT GREEN"} — ${v.reason}`);
    if (v.escalate) console.log("  ESCALATE — a changed file has no gate that can fail on it; a human must review this diff.");
    process.exit(v.green ? 0 : 1);
  } finally {
    rmSync(wt, { recursive: true, force: true });
    git(["worktree", "prune"]);
  }
}

// ── self-test: every fail-closed arm, both directions ────────────────────────
function selfTest() {
  const checks = [];
  const t = (name, ok) => checks.push([name, ok]);
  const ok = (over = {}) => ({ file: "lib/x/src/a.ts", executable: true, coveringProofs: ["proof:x"], baseline: "pass", mutationsTried: 3, killed: 1, inconclusive: false, ...over });

  t("a falsified diff is GREEN", decideFalsification([ok()]).green === true);
  t("an empty diff is NOT green", decideFalsification([]).green === false);
  t("a non-array is NOT green", decideFalsification(null).green === false);
  t("no covering gate is NOT green", decideFalsification([ok({ coveringProofs: [] })]).green === false);
  t("no covering gate ESCALATES", decideFalsification([ok({ coveringProofs: [] })]).escalate === true);
  t("baseline fail is NOT green", decideFalsification([ok({ baseline: "fail" })]).green === false);
  t("baseline unknown is NOT green", decideFalsification([ok({ baseline: null })]).green === false);
  t("a hung/inconclusive proof is NOT green", decideFalsification([ok({ inconclusive: true })]).green === false);
  t("zero applicable mutations is NOT green", decideFalsification([ok({ mutationsTried: 0 })]).green === false);
  t("all mutations surviving is NOT green", decideFalsification([ok({ killed: 0 })]).green === false);
  t("one bad file taints an otherwise-falsified diff", decideFalsification([ok(), ok({ file: "lib/y.ts", killed: 0 })]).green === false);
  t("a green verdict names no findings", decideFalsification([ok()]).findings.length === 0);
  t("a not-green verdict names its findings", decideFalsification([ok({ killed: 0 })]).findings.length === 1);

  // the registry lookup is real, not a stub
  t("coveringProofs finds a registered file", coveringProofs(TARGETS[0].files[0]).length > 0);
  t("coveringProofs is empty for an unregistered file", coveringProofs("docs/GLOSSARY.md").length === 0);
  t("coveringProofs normalizes a git a/ prefix", coveringProofs(`a/${TARGETS[0].files[0]}`).length > 0);
  t("normalizePath strips ./ and backslashes without eating a real dir", normalizePath("./a\\b.ts") === "a/b.ts");
  t("pathForms offers both readings of a git-prefixed path", pathForms("a/scripts/x.mjs").includes("scripts/x.mjs") && pathForms("a/scripts/x.mjs").includes("a/scripts/x.mjs"));
  t("pathForms leaves an unprefixed path alone", pathForms("lib/x.ts").length === 1);

  const failed = checks.filter(([, o]) => !o);
  for (const [name, o] of checks) console.log(`  ${o ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  process.exit(failed.length === 0 ? 0 : 1);
}

function validate() {
  // At rest there is no PR to judge. Prove the gate is wired to a real registry and that
  // its decision cannot vacuously pass.
  if (!Array.isArray(TARGETS) || TARGETS.length === 0) {
    console.error("falsification: the mutation registry is empty — every PR would be unfalsifiable. Refusing.");
    process.exit(1);
  }
  if (decideFalsification([]).green !== false) {
    console.error("falsification: an empty diff must never be green. Refusing.");
    process.exit(1);
  }
  console.log(`PR gate-falsification ok — ${TARGETS.length} registered proof targets available to falsify a diff.`);
  console.log("Run with --base <ref> --head <ref> to judge a PR; --self-test to exercise the fail-closed arms (preflight + CI do).");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--self-test")) selfTest();
  else if (val("--base") && val("--head")) realRun(val("--base"), val("--head"));
  else validate();
}
