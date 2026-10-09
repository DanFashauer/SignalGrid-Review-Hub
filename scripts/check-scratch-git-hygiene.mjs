#!/usr/bin/env node
// Scratch-repo hygiene gate — every script that builds a throwaway git repo spawns git through
// scripts/lib/scratch-git.mjs, or is on a visible PENDING debt list that must shrink. It also
// holds the helper itself to account: its --self-test drives the helper against a victim repo.
//
//   node scripts/check-scratch-git-hygiene.mjs              # the gate
//   node scripts/check-scratch-git-hygiene.mjs --self-test  # prove it can fail
//   node scripts/check-scratch-git-hygiene.mjs --root <dir> [--floor N] [--pending-file <json>]
//
// WHY. A self-test that does `mkdtemp` + `git init` and then runs plain `git` inherits the
// caller's environment: GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE (set by hooks and worktree
// helpers) aim git at the REAL repository, and a global commit.gpgsign=true with an absent signer
// fails every scratch commit. At db962ad1, 0 of 11 scratch-repo creators scrubbed a repo-location
// variable and 10 of 11 did not disable signing (PR #1454 review, 2026-10-08). The shared helper
// fixes the spawn; this gate keeps a NEW creator from reintroducing the hole.
//
// DERIVED, NOT LISTED. A creator is a tracked scripts/**/*.mjs whose CODE lines (comment-only
// lines removed) call mkdtemp and run `git` with an `init` or `clone` argument. The count is
// re-derived on every run and printed. "Migrated" means the file imports the helper (the specifier
// is RESOLVED, so a look-alike path does not count) AND calls scratchGit()/scratchGitOk().
//
// COMMENTS are removed line-wise: a line that starts with `//`, or sits inside a block comment
// that starts a line with `/*`. Nothing is tokenised, so a regex literal or a backtick cannot
// desynchronise it and hide real code (an earlier tokenising version did, in 3 tracked files). The
// cost is the safe direction: a trailing `// ...` or a block comment opened mid-line still counts
// as code, so it can yield a false creator (a migration or a PENDING row), never a missed one.
// Limit: a template literal whose own line starts with `//` or `/*` is read as a comment.
//
// WHAT IT DOES NOT PROVE. That a migrated script's own self-test passes under every git
// configuration; nor does the helper scrub GIT_CONFIG_GLOBAL / GIT_CONFIG_NOSYSTEM on purpose (see
// its header). SCOPE: scripts/**/*.mjs that use mkdtemp. A creator built with mkdirSync, or a shell
// script (scripts/mac/statusline.sh runs `git init -q` twice), is NOT seen. This file is not
// scanned: its own fixtures contain the tokens it looks for.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF_FILE = fileURLToPath(import.meta.url);
const HERE = dirname(SELF_FILE);
const REPO = resolve(HERE, "..");
const SELF = "scripts/check-scratch-git-hygiene.mjs";
const HELPER = "scripts/lib/scratch-git.mjs";
const DEFAULT_FLOOR = 8; // the census is 12 (11 at db962ad1); fail under 8 (check-walker-floors idiom)

/** Git's own list of repo-location variables (`git rev-parse --local-env-vars`); the helper must scrub all. */
const REQUIRED_SCRUB = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE", "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX", "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];

/**
 * file -> { pr, reason }. A visible debt list: each entry's file must migrate to the helper in
 * the next PR that touches it, and then drop its entry (a stale entry FAILS).
 */
export const PENDING = {
  "scripts/agent/absence-check.mjs": { pr: "#1464", reason: "open PR rewrites this file; migrate when it lands" },
  "scripts/check-cited-paths.mjs": { pr: "#1356", reason: "open PR touches this file; migrate when it lands" },
  "scripts/check-launch-proof-bindings.mjs": { pr: "#1337", reason: "open PR touches this file; its :738 helper already passes commit.gpgsign=false" },
  "scripts/check-sim-scripts-selfcheck.mjs": { pr: "#1225", reason: "open PR touches this file; migrate when it lands" },
  "scripts/lib/land-branch-gate.mjs": { pr: "#1133", reason: ".claude/workflows/land-branch.js's verifier; #1133 rewrites it" },
  "scripts/loop-state.mjs": { pr: "branch claude/loop-state-20261008-gap (cloud lane)", reason: "branch claude/loop-state-20261008-gap (cloud lane), landing under review" },
};

/** The text with comment-only lines blanked (line count preserved). See the header for the rule. */
export function stripComments(text) {
  let inBlock = false;
  const lines = text.split("\n");
  // A `/*` that is never closed anywhere below is not a comment (it is a template literal or a
  // regex); reading it as one would hide the rest of the file. It stays code.
  const closesBelow = (from) => lines.slice(from).some((l) => l.includes("*/"));
  return lines.map((raw, i) => {
    let l = raw;
    if (inBlock) {
      const end = l.indexOf("*/");
      if (end < 0) return "";
      inBlock = false;
      l = l.slice(end + 2);
    }
    const t = l.trimStart();
    if (t.startsWith("//")) return "";
    if (t.startsWith("/*")) {
      const end = t.indexOf("*/", 2);
      if (end < 0) {
        if (!closesBelow(i + 1)) return l;
        inBlock = true;
        return "";
      }
      return t.slice(end + 2);
    }
    return l;
  }).join("\n");
}

const RE_MKDTEMP = /mkdtemp/;
const RE_GIT = /["'`]git["'`]|\bgit\s/;
const RE_INITCLONE = /["'`](?:git\s+(?:-[cC]\s+\S+\s+)*)?(?:init|clone)\b|\bgit\s+(?:-[cC]\s+\S+\s+)*(?:init|clone)\b/;
const RE_IMPORT = /(?:^|\n)[ \t]*import\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;
const HELPER_CALLS = ["scratchGit", "scratchGitOk"];

/** @param {{path:string,text:string}[]} files @returns {string[]} paths that create scratch repos */
export function scratchRepoCreators(files, { countComments = false } = {}) {
  const out = [];
  for (const f of files) {
    if (f.path === SELF) continue;
    const code = countComments ? f.text : stripComments(f.text);
    if (RE_MKDTEMP.test(code) && RE_GIT.test(code) && RE_INITCLONE.test(code)) out.push(f.path);
  }
  return out.sort();
}

/**
 * True when the file imports scratchGit/scratchGitOk from the helper (specifier RESOLVED against
 * the file; the import must sit outside any template literal, judged by backtick parity, which can
 * only err toward "not migrated"), does not define a local function of that name, and calls it.
 */
export function importsHelper(f) {
  const code = stripComments(f.text);
  const names = new Set();
  for (const m of code.matchAll(RE_IMPORT)) {
    if (posix.normalize(posix.join(posix.dirname(f.path), m[2])) !== HELPER) continue;
    const ticks = (code.slice(0, m.index).match(/`/g) ?? []).length;
    if (ticks % 2 === 1) continue; // inside a template literal
    for (const n of HELPER_CALLS) if (new RegExp(`\\b${n}\\b`).test(m[1])) names.add(n);
  }
  for (const n of names) {
    if (new RegExp(`(?:function\\s+|(?:const|let|var)\\s+)${n}\\b`).test(code.replace(RE_IMPORT, ""))) names.delete(n); // local shadow
  }
  return [...names].some((n) => new RegExp(`\\b${n}\\s*\\(`).test(code.replace(RE_IMPORT, "")));
}

/**
 * @returns {{problems:string[], creators:string[], migrated:string[], pending:string[]}}
 * `mutant` deliberately breaks one rule so the self-test can show it going red.
 */
export function audit(files, pending, { floor = DEFAULT_FLOOR, mutant = null } = {}) {
  const problems = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const creators = scratchRepoCreators(files, { countComments: mutant === "count-comments" });
  if (creators.length < floor) {
    problems.push(`only ${creators.length} scratch-repo creator(s) found (floor ${floor}) — the detector or the file list has gone blind, not the tree clean`);
  }
  const migrated = [];
  const owed = [];
  for (const p of creators) {
    const imports = mutant === "skip-import-check" ? true : importsHelper(byPath.get(p));
    if (imports) migrated.push(p);
    else if (pending[p]) owed.push(p);
    else problems.push(`${p} creates a scratch git repo without ${HELPER} and is not in PENDING — spawn git through scratchGit() (scrubs GIT_DIR/GIT_WORK_TREE/GIT_INDEX_FILE, disables signing), or add a PENDING row naming the PR that blocks the migration`);
  }
  if (mutant !== "drop-stale") {
    for (const [p, row] of Object.entries(pending)) {
      const f = byPath.get(p);
      if (!row || !row.pr || !row.reason) problems.push(`PENDING entry ${p} lacks a pr or a reason`);
      if (!f) problems.push(`stale PENDING entry ${p}: the file no longer exists — drop the entry`);
      else if (importsHelper(f)) problems.push(`stale PENDING entry ${p}: it imports ${HELPER} now — drop the entry`);
      else if (!creators.includes(p)) problems.push(`stale PENDING entry ${p}: it no longer matches the scratch-repo detector — drop the entry`);
    }
  }
  return { problems, creators, migrated, pending: owed };
}

function walkMjs(root, dir = join(root, "scripts"), acc = []) {
  let names;
  try { names = readdirSync(dir); } catch { return acc; }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walkMjs(root, p, acc);
    else if (n.endsWith(".mjs")) acc.push(relative(root, p).split("\\").join("/"));
  }
  return acc.sort();
}

function loadFiles(root, useGit) {
  const paths = useGit
    ? execFileSync("git", ["ls-files", "-z", "--", "scripts"], { cwd: root, encoding: "utf8", timeout: 60000 }).split("\0").filter((p) => p.endsWith(".mjs"))
    : walkMjs(root);
  return paths.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
}

// ───────────────────────── the helper's behavioural battery ─────────────────────────

const HOSTILE_CONFIG = "[commit]\n\tgpgsign = true\n[gpg]\n\tformat = openpgp\n\tprogram = /bin/false\n";

/** Plain git for building/inspecting the victim: no helper, clean env, explicit identity. */
function plain(dir, args) {
  const env = { ...process.env };
  for (const k of REQUIRED_SCRUB) delete env[k];
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=v", "-c", "user.email=v@v", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { encoding: "utf8", env, timeout: 60000 });
  return (r.stdout ?? "").trim();
}

function victimRepo(root) {
  const v = mkdtempSync(join(root, "victim-"));
  plain(v, ["init", "-q"]);
  writeFileSync(join(v, "a.txt"), "a\n");
  plain(v, ["add", "a.txt"]);
  plain(v, ["commit", "-qm", "victim"]);
  return v;
}
const snap = (v) => [plain(v, ["ls-files", "--stage"]), plain(v, ["log", "--format=%H"]), plain(v, ["status", "--porcelain"])].join("|");

/**
 * Drive a (possibly mutated) helper module. Returns the list of failed expectations; [] = healthy.
 * Each repo-location variable is exported ALONE and then all together at a victim repo; the
 * victim must not change and the scratch commit must succeed. Then hostile signing and hooks.
 */
export function helperBattery(mod, root) {
  const failures = [];
  const saved = {};
  const set = (env) => { for (const [k, val] of Object.entries(env)) { saved[k] = process.env[k]; process.env[k] = val; } };
  const restore = () => { for (const [k, val] of Object.entries(saved)) { if (val === undefined) delete process.env[k]; else process.env[k] = val; } };
  try {
    const exercise = (label, envOf, opts) => {
      const v = victimRepo(root);
      const s = mkdtempSync(join(root, "scratch-"));
      const before = snap(v);
      set(envOf(v));
      let ok = true;
      try {
        mod.scratchGitOk(s, ["init", "-q"], opts);
        writeFileSync(join(s, "f.txt"), "f\n");
        mod.scratchGitOk(s, ["add", "-A"], opts);
        mod.scratchGitOk(s, ["commit", "-qm", "scratch"], opts);
        if (mod.scratchGitOk(s, ["rev-list", "--count", "HEAD"], opts) !== "1") ok = false;
      } catch { ok = false; } finally { restore(); }
      if (!ok) failures.push(`${label}: the scratch repo could not be built and committed`);
      if (snap(v) !== before) failures.push(`${label}: the victim repository CHANGED`);
    };
    exercise("GIT_DIR alone", (v) => ({ GIT_DIR: join(v, ".git") }));
    exercise("GIT_WORK_TREE alone", (v) => ({ GIT_WORK_TREE: v }));
    exercise("GIT_INDEX_FILE alone", (v) => ({ GIT_INDEX_FILE: join(v, ".git", "index") }));
    exercise("GIT_DIR+GIT_WORK_TREE+GIT_INDEX_FILE", (v) => ({ GIT_DIR: join(v, ".git"), GIT_WORK_TREE: v, GIT_INDEX_FILE: join(v, ".git", "index") }));
    const cfg = join(root, "hostile.gitconfig");
    writeFileSync(cfg, HOSTILE_CONFIG);
    exercise("hostile signing config", () => ({ GIT_CONFIG_GLOBAL: cfg }));
    const hooks = join(root, "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    const hcfg = join(root, "hooks.gitconfig");
    writeFileSync(hcfg, `[core]\n\thooksPath = ${hooks}\n`);
    exercise("global failing hook", () => ({ GIT_CONFIG_GLOBAL: hcfg }));
    exercise("empty identity env", () => ({ GIT_AUTHOR_NAME: "", GIT_COMMITTER_NAME: "" }));
    // The throwing variant must throw, or a failed fixture step is silent.
    let threw = false;
    try { mod.scratchGitOk(root, ["rev-parse", "--verify", "no-such-ref^{commit}"]); } catch { threw = true; }
    if (!threw) failures.push("scratchGitOk did not throw on a failing git call");
    // opts.env must reach git (check-gitignore-producers relies on it) and opts.input must reach stdin.
    const gcfg = join(root, "pass.gitconfig");
    writeFileSync(gcfg, "[core]\n\texcludesFile = /pass/through\n");
    const tryOr = (fn) => { try { return fn(); } catch { return null; } };
    if (tryOr(() => mod.scratchGitOk(root, ["config", "--get", "core.excludesFile"], { env: { GIT_CONFIG_GLOBAL: gcfg } })) !== "/pass/through") failures.push("opts.env did not reach git");
    if (tryOr(() => mod.scratchGitOk(root, ["hash-object", "--stdin"], { input: "x\n" })) !== "587be6b4c3f93f93c489c0111bba5596147a26cb") failures.push("opts.input did not reach git");
    // scrubProcessGitEnv must clear process.env in place (the migrated self-tests rely on it).
    const probe = Object.fromEntries(REQUIRED_SCRUB.map((k) => [k, "x"]));
    mod.scrubProcessGitEnv(probe);
    if (REQUIRED_SCRUB.some((k) => k in probe)) failures.push("scrubProcessGitEnv left a repo-location variable in the object it was given");
    set({ GIT_INDEX_FILE: "/nonexistent" });
    mod.scrubProcessGitEnv();
    if ("GIT_INDEX_FILE" in process.env) failures.push("scrubProcessGitEnv() did not clear process.env");
    restore();
    // The pure env must drop every variable git names as repo-local.
    const env = mod.scratchGitEnv(Object.fromEntries(REQUIRED_SCRUB.map((k) => [k, "x"])), {});
    const left = REQUIRED_SCRUB.filter((k) => k in env);
    if (left.length) failures.push(`scratchGitEnv kept ${left.join(", ")}`);
  } finally { restore(); }
  return failures;
}

// ───────────────────────── self-test ─────────────────────────

async function selfTest({ inner = false } = {}) {
  // The self-test runs mutated, scrub-less helper copies; an ambient GIT_* must not reach them.
  for (const k of REQUIRED_SCRUB) delete process.env[k];
  const results = [];
  const check = (name, ok) => { results.push([name, ok]); console.log(`  ${ok ? "✓" : "✗"} ${name}`); };
  const tmp = mkdtempSync(join(tmpdir(), "sg-scratch-hygiene-"));
  // Run from inside tmp: a helper that loses its `-C dir` must hit a scratch directory, not the caller's repo.
  const cwd0 = process.cwd();
  process.chdir(tmp);
  const T = (name) => { const d = join(tmp, name); mkdirSync(join(d, "scripts/lib"), { recursive: true }); writeFileSync(join(d, "scripts/lib/scratch-git.mjs"), "export {};\n"); return d; };
  const put = (d, rel, text) => { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), text); };
  const BARE = 'import { mkdtempSync } from "node:fs";\nconst d = mkdtempSync("x");\nspawnSync("git", ["init", "-q"], { cwd: d });\n';
  const WITH = 'import { scratchGit } from "./lib/scratch-git.mjs";\n' + BARE + 'scratchGit(d, ["add", "-A"]);\n';
  const COMMENT = '// git init lives in a comment: spawnSync("git", ["init"]) and mkdtemp\nexport const x = 1;\n';
  const cli = (d, args, pending) => {
    const pf = join(d, "pending.json");
    writeFileSync(pf, JSON.stringify(pending ?? {}));
    const r = spawnSync(process.execPath, [SELF_FILE, "--root", d, "--pending-file", pf, ...args], { encoding: "utf8", timeout: 60000 });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const row = { pr: "#1", reason: "r" };

  // Plants driven through the REAL CLI (spawned), so main()'s exit path is under test.
  check("an unmigrated creator not in PENDING fails (exit 1)", (() => { const d = T("a"); put(d, "scripts/x.mjs", BARE); return cli(d, ["--floor", "1"]).status === 1; })());
  check("the same file importing and using the helper passes (exit 0)", (() => { const d = T("b"); put(d, "scripts/x.mjs", WITH); return cli(d, ["--floor", "1"]).status === 0; })());
  check("a PENDING entry for a file that imports the helper is stale (exit 1)", (() => { const d = T("c"); put(d, "scripts/x.mjs", WITH); return cli(d, ["--floor", "1"], { "scripts/x.mjs": row }).status === 1; })());
  check("a PENDING entry for a file that no longer exists fails (exit 1)", (() => { const d = T("d"); put(d, "scripts/y.mjs", COMMENT); return cli(d, ["--floor", "0"], { "scripts/gone.mjs": row }).status === 1; })());
  check("a file whose only `git init` sits in a comment is not a creator (exit 0)", (() => { const d = T("e"); put(d, "scripts/x.mjs", COMMENT); const r = cli(d, ["--floor", "0"]); return r.status === 0 && /creators=0/.test(r.out); })());
  check("a tree with zero creators trips the DEFAULT floor (exit 1)", (() => { const d = T("f"); put(d, "scripts/x.mjs", "export const x = 1;\n"); return cli(d, []).status === 1; })());
  check("a PENDING entry for a live unmigrated creator passes (exit 0)", (() => { const d = T("g"); put(d, "scripts/x.mjs", BARE); return cli(d, ["--floor", "1"], { "scripts/x.mjs": row }).status === 0; })());
  check("a malformed --floor is refused (exit 2), never read as no floor", cli(T("h"), ["--floor", "abc"]).status === 2);

  // Evasion shapes the review found; each must still be SEEN (creators=1).
  const seen = (name, text, extra = {}) => { const d = T(name); put(d, "scripts/x.mjs", text); const r = cli(d, ["--floor", "0"]); return /creators=1/.test(r.out) && r.status === 1 && !extra.skip; };
  check("a regex holding `/*` before a creator does not hide it", seen("e8", 'const trim = (s) => s.replace(/^\\.?\\/*/, "");\n' + BARE));
  check("a regex holding `//` earlier on the line does not hide it", seen("e7", 'const u = /^https?:\\/\\//; ' + BARE.replace(/\n/g, " ") + "\n"));
  check("a backtick inside a regex does not hide a later creator", seen("e10", 'const R = /(?:^|[\\s`(])x/g;\nconst s = "covers `lib/**`";\n' + BARE));
  check("a trailing `// ...` comment is NOT stripped (false creator, never a miss)", seen("e11", 'import { mkdtempSync } from "node:fs";\nconst d = mkdtempSync("x");\nspawnSync("git", ["status"]); // later: "init" it\n'));
  check("a template-literal `git -C ${d} init` is seen", seen("e2", 'const d = mkdtempSync("x");\nexecSync(`git -C ${d} init -q`);\n'));
  check("an unused helper import does not count as migrated (exit 1)", (() => { const d = T("e1"); put(d, "scripts/x.mjs", 'import { SCRATCH_GIT_SCRUB } from "./lib/scratch-git.mjs";\n' + BARE); return cli(d, ["--floor", "1"]).status === 1; })());
  check("an import written inside a string does not count as migrated (exit 1)", (() => { const d = T("e3"); put(d, "scripts/x.mjs", "const s = 'import { scratchGit } from \"./lib/scratch-git.mjs\"'; scratchGit(1);\n" + BARE); return cli(d, ["--floor", "1"]).status === 1; })());
  check("a look-alike helper path does not count as migrated (exit 1)", (() => { const d = T("e5"); put(d, "scripts/x.mjs", 'import { scratchGit } from "./fake/scratch-git.mjs";\nscratchGit(1);\n' + BARE); return cli(d, ["--floor", "1"]).status === 1; })());

  check("an unterminated `/*` line does not hide the rest of the file", seen("e12", "const t = `\n/* not closed\n`;\n" + BARE));
  check("a PENDING row without a reason fails (exit 1)", (() => { const d = T("p1"); put(d, "scripts/x.mjs", BARE); return cli(d, ["--floor", "1"], { "scripts/x.mjs": { pr: "#1" } }).status === 1; })());
  check("a PENDING entry for a file that stopped matching the detector fails (exit 1)", (() => { const d = T("p2"); put(d, "scripts/x.mjs", "export const x = 1;\n"); return cli(d, ["--floor", "0"], { "scripts/x.mjs": row }).status === 1; })());

  check("a `clone` creator is seen", seen("c1", 'const d = mkdtempSync("x");\nspawnSync("git", ["clone", "-q", "a", "b"], { cwd: d });\n'));
  check("`git -c k=v -C ${d} init` in a template is seen", seen("e4", 'const d = mkdtempSync("x");\nexecSync(`git -c core.x=1 -C ${d} init -q`);\n'));
  check("a doc block comment before a creator does not hide it (inBlock resets)", seen("b1", "/**\n * a doc block\n */\n" + BARE));
  check("a non-ASCII path is read (git ls-files -z)", (() => { const d = mkdtempSync(join(tmp, "na-")); mkdirSync(join(d, "scripts"), { recursive: true }); plain(d, ["init", "-q"]); writeFileSync(join(d, "scripts", "créateur.mjs"), BARE); plain(d, ["add", "-A"]); const r = spawnSync("git", ["ls-files", "-z", "--", "scripts"], { cwd: d, encoding: "utf8" }); return r.stdout.split("\0").includes("scripts/créateur.mjs") && loadFiles(d, true).some((f) => f.path === "scripts/créateur.mjs"); })());
  check("a PENDING row with a reason but no pr fails (exit 1)", (() => { const d = T("p3"); put(d, "scripts/x.mjs", BARE); return cli(d, ["--floor", "1"], { "scripts/x.mjs": { reason: "r" } }).status === 1; })());
  check("a local scratchGit shadow does not count as migrated (exit 1)", (() => { const d = T("sh"); put(d, "scripts/x.mjs", 'import { SCRATCH_GIT_SCRUB } from "./lib/scratch-git.mjs";\nconst scratchGit = () => 0;\nscratchGit(1);\n' + BARE); return cli(d, ["--floor", "1"]).status === 1; })());
  check("an import and call inside a multi-line template literal do not count as migrated (exit 1)", (() => { const d = T("tl"); put(d, "scripts/x.mjs", 'const fixture = `\nimport { scratchGit } from "./lib/scratch-git.mjs";\nscratchGit(d, ["status"]);\n`;\n' + BARE); return cli(d, ["--floor", "1"]).status === 1; })());

  // Rule mutants (in-process): break one rule; the plants for that rule must go red.
  const run = (d, pending, opts = {}) => audit(loadFiles(d, false), pending, { floor: 1, ...opts });
  const exitOf = (r) => (r.problems.length ? 1 : 0);
  const withMutant = (mutant) => {
    const mrun = (d, pending, opts = {}) => run(d, pending, { ...opts, mutant });
    const mplants = [
      () => { const d = T("m1"); put(d, "scripts/x.mjs", BARE); return exitOf(mrun(d, {})) === 1; },
      () => { const d = T("m2"); put(d, "scripts/x.mjs", COMMENT); const r = mrun(d, {}, { floor: 0 }); return exitOf(r) === 0 && r.creators.length === 0; },
      () => { const d = T("m3"); put(d, "scripts/x.mjs", WITH); return exitOf(mrun(d, { "scripts/x.mjs": row })) === 1; },
      () => { const d = T("m4"); put(d, "scripts/y.mjs", COMMENT); return exitOf(mrun(d, { "scripts/gone.mjs": row }, { floor: 0 })) === 1; },
    ];
    return mplants.filter((p) => !p()).length;
  };
  for (const m of ["skip-import-check", "count-comments", "drop-stale"]) check(`rule mutant "${m}" turns the plants red`, withMutant(m) > 0);
  check("with no rule mutant the same plants are green", withMutant(null) === 0);

  // The helper itself: healthy copy is green; each mutant of its source is red.
  const helperSrc = readFileSync(join(REPO, HELPER), "utf8");
  const load = async (name, src) => { const f = join(tmp, `${name}.mjs`); writeFileSync(f, src); return import(`${pathToFileURL(f).href}?v=${name}`); };
  const bt = (name) => { const r = join(tmp, `bt-${name}`); mkdirSync(r); return r; };
  check("the helper passes its behavioural battery (victim untouched, hostile signing/hooks/identity survived)", helperBattery(await load("healthy", helperSrc), bt("healthy")).length === 0);
  const helperMutants = [
    ["scrub loop removed", (s) => s.replace("for (const k of SCRATCH_GIT_SCRUB) delete env[k];", "")],
    ["GIT_INDEX_FILE dropped from the scrub list", (s) => s.replace('  "GIT_INDEX_FILE",\n', "")],
    ["GIT_DIR dropped from the scrub list", (s) => s.replace('  "GIT_DIR",\n', "")],
    ["commit.gpgsign override deleted", (s) => s.replace('"-c", "commit.gpgsign=false",', "")],
    ["hooks override deleted", (s) => s.replace('"-c", "core.hooksPath=/dev/null",', "")],
    ["identity pin deleted", (s) => s.replace("...SCRATCH_IDENTITY, ", "")],
    ["-C dir dropped (git acts on the caller's cwd)", (s) => s.replace('["-C", dir, ...scratchGitArgs(args)]', "[...scratchGitArgs(args)]")],
    ["opts.env ignored", (s) => s.replace("...SCRATCH_IDENTITY, ...extra }", "...SCRATCH_IDENTITY }")],
    ["opts.input ignored", (s) => s.replace("...(opts?.input === undefined ? {} : { input: opts.input }),", "")],
    ["scrubProcessGitEnv made a no-op", (s) => s.replace("export function scrubProcessGitEnv(env = process.env) {\n  for (const k of SCRATCH_GIT_SCRUB) delete env[k];", "export function scrubProcessGitEnv(env = process.env) {\n  void env;")],
    ["scratchGitOk made non-throwing", (s) => s.replace("if (r.error || r.status !== 0) {", "if (false) {")],
  ];
  for (const [name, mutate] of helperMutants) {
    const src = mutate(helperSrc);
    const applied = src !== helperSrc;
    const failures = applied ? helperBattery(await load(name.replace(/\W+/g, "_"), src), bt(name.replace(/\W+/g, "_"))) : [];
    check(`helper mutant "${name}" is applied and turns the battery red`, applied && failures.length > 0);
  }

  // The self-test itself must be hermetic: run it (once, nested) with the three variables exported at a decoy.
  if (!inner) {
    const decoy = victimRepo(tmp);
    const before = snap(decoy);
    const r = spawnSync(process.execPath, [SELF_FILE, "--self-test", "--inner"], {
      encoding: "utf8", timeout: 600000,
      env: { ...process.env, GIT_DIR: join(decoy, ".git"), GIT_WORK_TREE: decoy, GIT_INDEX_FILE: join(decoy, ".git", "index") },
    });
    check("the self-test under GIT_DIR+GIT_WORK_TREE+GIT_INDEX_FILE passes and leaves the decoy repo untouched", r.status === 0 && snap(decoy) === before);
  }

  process.chdir(cwd0);
  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`self-test: ${results.length - failed}/${results.length} passed`);
  return failed ? 1 : 0;
}

async function main(argv) {
  if (argv.includes("--self-test")) return selfTest({ inner: argv.includes("--inner") });
  const arg = (name) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
  const has = (name) => argv.includes(name);
  if ((has("--root") && !arg("--root")) || (has("--pending-file") && !arg("--pending-file"))) { console.error("✗ --root / --pending-file need a value"); return 2; }
  let floor = DEFAULT_FLOOR;
  if (has("--floor")) {
    if (!/^\d+$/.test(arg("--floor") ?? "")) { console.error(`✗ --floor needs a non-negative integer, got ${JSON.stringify(arg("--floor"))}`); return 2; }
    floor = Number(arg("--floor"));
  }
  const root = has("--root") ? resolve(arg("--root")) : REPO;
  const pending = has("--pending-file") ? JSON.parse(readFileSync(resolve(arg("--pending-file")), "utf8")) : PENDING;
  const r = audit(loadFiles(root, !has("--root")), pending, { floor });
  console.log(`scratch-git hygiene: creators=${r.creators.length} migrated=${r.migrated.length} pending=${r.pending.length}`);
  for (const p of r.pending) console.log(`  pending  ${p}  (${pending[p].pr})`);
  if (r.problems.length) {
    for (const p of r.problems) console.error(`✗ ${p}`);
    return 1;
  }
  console.log(`✓ every scratch-repo creator spawns git through ${HELPER}, or is a named PENDING debt.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === SELF_FILE) process.exit(await main(process.argv.slice(2)));
