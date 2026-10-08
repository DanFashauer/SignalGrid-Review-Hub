#!/usr/bin/env node
// Scratch-repo hygiene gate — every script that builds a throwaway git repo spawns git through
// scripts/lib/scratch-git.mjs, or is on a visible PENDING debt list that must shrink.
//
//   node scripts/check-scratch-git-hygiene.mjs              # the gate
//   node scripts/check-scratch-git-hygiene.mjs --self-test  # prove it can fail
//   node scripts/check-scratch-git-hygiene.mjs --root <dir> [--floor N]  # scan a tree on disk
//
// WHY. A self-test that does `mkdtemp` + `git init` and then runs plain `git` inherits the
// caller's environment: GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE (set by hooks and worktree
// helpers) aim git at the REAL repository, and a global commit.gpgsign=true with an absent signer
// fails every scratch commit. 11 of 11 scratch-repo creators did neither guard against it
// (PR #1454 review, 2026-10-08). The shared helper fixes the spawn; this gate keeps a NEW creator
// from reintroducing the hole.
//
// DERIVED, NOT LISTED. A creator is a tracked scripts/**/*.mjs whose CODE lines (comments
// stripped) both call mkdtemp and run `git` with an `init` or `clone` argument. The count is
// re-derived on every run and printed.
//
// WHAT IT DOES NOT PROVE. That a migrated script's own self-test passes under every git
// configuration; only that it spawns scratch git through the one hermetic helper. Nor does it
// scrub GIT_CONFIG_GLOBAL / GIT_CONFIG_NOSYSTEM (the helper leaves those on purpose; see the
// helper header). Trailing `//` comments on a code line are not stripped (a false creator needs
// a migration or a PENDING row, which is the safe direction). This file is not scanned: its own
// fixtures contain the tokens it looks for.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SELF = "scripts/check-scratch-git-hygiene.mjs";
const HELPER = "scripts/lib/scratch-git.mjs";
const DEFAULT_FLOOR = 8; // the census is 11; fail under 8 (check-walker-floors idiom)

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

/**
 * Remove comments (`//` to end of line, `/* ... *\/` blocks), leaving string and template
 * literals alone so a glob such as "scripts/*\/*.mjs" is not read as a comment opener. Line count
 * is preserved. A regex literal holding a quote can desynchronise it; that errs toward seeing
 * MORE code (a false creator needs a migration or a PENDING row), never less.
 */
export function stripComments(text) {
  let out = "";
  let i = 0;
  let q = null;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (q) {
      out += c;
      if (c === "\\") { out += n ?? ""; i += 2; continue; }
      if (c === q || (c === "\n" && q !== "`")) q = null;
      i++;
    } else if (c === "/" && n === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += text.slice(i, stop).replace(/[^\n]/g, "");
      i = stop;
    } else {
      if (c === '"' || c === "'" || c === "`") q = c;
      out += c;
      i++;
    }
  }
  return out;
}

const RE_MKDTEMP = /mkdtemp/;
const RE_GIT = /["'`]git["'`]|\bgit\s/;
const RE_INITCLONE = /["'`](?:git\s+)?(?:init|clone)\b/;
const RE_IMPORT = /\bimport\b[^;]*?\bfrom\s*["'][^"']*scratch-git\.mjs["']/;

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

const importsHelper = (f) => RE_IMPORT.test(stripComments(f.text));

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
    ? execFileSync("git", ["ls-files", "--", "scripts"], { cwd: root, encoding: "utf8", timeout: 60000 }).split("\n").filter((p) => p.endsWith(".mjs"))
    : walkMjs(root);
  return paths.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") }));
}

function selfTest() {
  const results = [];
  const check = (name, ok) => { results.push([name, ok]); console.log(`  ${ok ? "✓" : "✗"} ${name}`); };
  const tmp = mkdtempSync(join(tmpdir(), "sg-scratch-hygiene-"));
  const T = (name) => { const d = join(tmp, name); mkdirSync(join(d, "scripts/lib"), { recursive: true }); writeFileSync(join(d, "scripts/lib/scratch-git.mjs"), "export {};\n"); return d; };
  const put = (d, rel, text) => { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), text); };
  const BARE = 'import { mkdtempSync } from "node:fs";\nconst d = mkdtempSync("x");\nspawnSync("git", ["init", "-q"], { cwd: d });\n';
  const WITH = 'import { scratchGit } from "./lib/scratch-git.mjs";\n' + BARE;
  const COMMENT = '// git init lives in a comment: spawnSync("git", ["init"]) and mkdtemp\nexport const x = 1;\n';
  const run = (d, pending, opts = {}) => audit(loadFiles(d, false), pending, { floor: 1, ...opts });
  const exitOf = (r) => (r.problems.length ? 1 : 0);

  // The six plants. Each returns whether the gate behaved as declared.
  const plants = {
    "an unmigrated creator not in PENDING fails (exit 1)": () => { const d = T("a"); put(d, "scripts/x.mjs", BARE); return exitOf(run(d, {})) === 1; },
    "the same file importing the helper passes (exit 0)": () => { const d = T("b"); put(d, "scripts/x.mjs", WITH); return exitOf(run(d, {})) === 0; },
    "a PENDING entry for a file that imports the helper is stale (exit 1)": () => { const d = T("c"); put(d, "scripts/x.mjs", WITH); return exitOf(run(d, { "scripts/x.mjs": { pr: "#1", reason: "r" } })) === 1; },
    "a PENDING entry for a file that no longer exists fails (exit 1)": () => { const d = T("d"); put(d, "scripts/y.mjs", COMMENT); return exitOf(run(d, { "scripts/gone.mjs": { pr: "#1", reason: "r" } }, { floor: 0 })) === 1; },
    "a file whose only `git init` sits in a comment is not a creator (exit 0)": () => { const d = T("e"); put(d, "scripts/x.mjs", COMMENT); const r = run(d, {}, { floor: 0 }); return exitOf(r) === 0 && r.creators.length === 0; },
    "a tree with zero creators trips the floor (exit 1)": () => { const d = T("f"); put(d, "scripts/x.mjs", "export const x = 1;\n"); return exitOf(run(d, {}, { floor: 1 })) === 1; },
    "a PENDING entry for a live unmigrated creator passes (the debt list works, exit 0)": () => { const d = T("g"); put(d, "scripts/x.mjs", BARE); return exitOf(run(d, { "scripts/x.mjs": { pr: "#1", reason: "r" } })) === 0; },
  };
  for (const [n, fn] of Object.entries(plants)) check(n, fn());

  // Mutants: re-run the plants with one rule deliberately broken; at least one plant must go red.
  const withMutant = (mutant) => {
    const mrun = (d, pending, opts = {}) => audit(loadFiles(d, false), pending, { floor: 1, ...opts, mutant });
    const mplants = [
      () => { const d = T("m1"); put(d, "scripts/x.mjs", BARE); return exitOf(mrun(d, {})) === 1; },
      () => { const d = T("m2"); put(d, "scripts/x.mjs", COMMENT); const r = mrun(d, {}, { floor: 0 }); return exitOf(r) === 0 && r.creators.length === 0; },
      () => { const d = T("m3"); put(d, "scripts/x.mjs", WITH); return exitOf(mrun(d, { "scripts/x.mjs": { pr: "#1", reason: "r" } })) === 1; },
      () => { const d = T("m4"); put(d, "scripts/y.mjs", COMMENT); return exitOf(mrun(d, { "scripts/gone.mjs": { pr: "#1", reason: "r" } }, { floor: 0 })) === 1; },
    ];
    return mplants.filter((p) => !p()).length;
  };
  for (const m of ["skip-import-check", "count-comments", "drop-stale"]) check(`mutant "${m}" turns the plants red`, withMutant(m) > 0);
  check("with no mutant the same plants are green (the mutants are what turn them red)", withMutant(null) === 0);

  rmSync(tmp, { recursive: true, force: true });
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(`self-test: ${results.length - failed}/${results.length} passed`);
  return failed ? 1 : 0;
}

function main(argv) {
  if (argv.includes("--self-test")) return selfTest();
  const rootI = argv.indexOf("--root");
  const floorI = argv.indexOf("--floor");
  const root = rootI >= 0 ? resolve(argv[rootI + 1]) : REPO;
  const floor = floorI >= 0 ? Number(argv[floorI + 1]) : DEFAULT_FLOOR;
  const r = audit(loadFiles(root, rootI < 0), PENDING, { floor });
  console.log(`scratch-git hygiene: creators=${r.creators.length} migrated=${r.migrated.length} pending=${r.pending.length}`);
  for (const p of r.pending) console.log(`  pending  ${p}  (${PENDING[p].pr})`);
  if (r.problems.length) {
    for (const p of r.problems) console.error(`✗ ${p}`);
    return 1;
  }
  console.log(`✓ every scratch-repo creator spawns git through ${HELPER}, or is a named PENDING debt.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
