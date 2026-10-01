#!/usr/bin/env node
// pr-refresh.mjs — a no-model chore bot: re-merge mainline into a dirty Mac PR and
// regenerate its derived files, so a person stops doing it by hand.
//
//   node scripts/mac/pr-refresh.mjs [--max N] [--pr N]   # real run, Mac only (--max default 1)
//   node scripts/mac/pr-refresh.mjs --dry-run [--pr N]    # read-only: candidates + conflict classification
//   node scripts/mac/pr-refresh.mjs --self-test           # temp repos, no network, runs on Linux too
//
// An unknown flag exits 2. A real run off Darwin exits 2 with a one-line reason.
//
// WHY. Every Mac PR that lands a derived file (docs/STATUS.md, the surface-coverage page,
// the live-sync manifest) goes CONFLICTING whenever mainline moves, and a person re-merges
// it by hand (`--dry-run` prints how many are dirty right now). The fix is mechanical, so it
// is a script, not a model session. NO MODEL IS CALLED ANYWHERE IN THIS FILE.
//
// ONE PR, IN ORDER (each git call runs in the refresh worktree, never the person's checkout)
//   1. preview the merge with `git merge-tree --write-tree` — a path outside the allowlist
//      refuses NOW, before any checkout;
//   2. check the PR head out onto pr-refresh/<N> and pin mainline's sha (the lane tick moves
//      origin/SignalGrid_Alpha every 5 minutes);
//   3. merge it; resolve ONLY the allowlist below, anything else aborts the merge and refuses;
//   4. run the repo's own writers (sync manifest, role-coverage ratchet, surface coverage —
//      that one LAST) and require the regeneration commit to touch only the allowlisted files;
//   5. deps, then the quick figure gates (quoted on failure, never parsed), then
//      `node scripts/preflight.mjs` and — only on 0 — `pnpm run verify:breadth`, each log ending
//      in its sentinel line;
//   6. the REAL scripts/lib/land-branch-gate.mjs verify() decides whether to push; the push is
//      a plain `git push` (the pre-push hook runs; never --force, never --no-verify);
//   7. comment on the PR with what was merged, what was resolved and the two sentinel lines —
//      the head moved, so any earlier review (including a DR-061 Opus review of a DECISION_PATH
//      PR) was of the OLD head and needs re-doing.
//   A refusal or a red gate pushes NOTHING, comments, raises ONE hand through lane-deliver (the
//   way the build tick in PR #1248, branch mac/auto-build-tick, does) and is remembered in
//   ~/Library/Caches/signalgrid/pr-refresh/state.json: that head is skipped until it moves, so
//   one stuck PR can never starve --max. A push that loses a race ("raced") is retried next run.
//
// THE ALLOWLIST (nothing else is ever resolved without a person)
//   A1 docs/agent/SURFACE_REVIEW_COVERAGE.md   take mainline's copy; its writer regenerates it
//   A2 artifacts/sync/live-sync-manifest.json  take mainline's copy; its writer regenerates it
//   A3 docs/STATUS.md                          take mainline's copy; NO writer exists
//   A4 docs/agent/role-coverage-ratchet.json   take mainline's copy; its writer regenerates it
//   A5 docs/COMPANY_BUILD_PLAN.md              only when every conflict hunk differs by a
//                                              `path (N)` figure: mainline's side, N re-measured
//   Out on purpose: generated files that need deps (postman, html bundles, sbom, claim
//   inventory, the lockfile), the fall-only ratchets, source ledgers, artifacts/live-evidence/**,
//   artifacts/sim-results/**, docs/agent/objective-state.json and every owner-held file.
//   mac/tick-* PRs are excluded by design: their conflicts are Mac-minted results that are never
//   allowlisted, so refreshing them would only raise hands. So are STACKED PRs (base is not
//   SignalGrid_Alpha): GitHub's "dirty" is measured against the parent branch, so merging mainline
//   into one would fill its diff with unrelated files and answer a conflict that is not mainline's.
//
// KNOWN GAPS (stated, not hidden)
//   - NOT in preflight or CI in this pass. Editing scripts/preflight.mjs moves its own
//     `scripts/preflight.mjs (N)` figure in docs/COMPANY_BUILD_PLAN.md — the very conflict this
//     bot removes — and needs CI parity. The self-test is therefore run by hand. It is a .mjs,
//     so neither check-shell.mjs nor check-sim-scripts-selfcheck.mjs covers it.
//   - The figure gates (check-status-figures, check-derived-doc-figures, check-doc-line-counts)
//     have no writer. A docs/STATUS.md proof-count drift therefore refuses at the quick-gate
//     step and raises a hand; the bot does not parse gate output to repair it.
//   - A branch protection rule would add the mergeable_state "behind"; none exists today
//     (the protection API answers 404), so only "dirty" occurs. Both are accepted.
//   - spawnSync's timeout signals the direct child only (see runLogged).
//
// HARD CONSTRAINT: this file's STATIC imports are node: builtins only. The mainline re-exec
// runs a copy where relative imports cannot be relied on, and a later PR checkout rewrites
// the sibling files on disk. The one repo module it needs, land-branch-gate.mjs, is loaded
// once with a dynamic import BEFORE the first PR checkout. --self-test asserts this (T9).
//
// MAINLINE RE-EXEC. A real run never runs a branch copy: it fetches, and if origin/SignalGrid_Alpha
// has no copy of this file it says so and exits 0; otherwise it resets a detached worktree
// beside the repo (<repo>.refresh) to mainline and runs mainline's copy there. The lock is taken
// BEFORE that reset so a second run cannot wipe the first one's checkout.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ── the allowlist: the ONLY paths this bot ever resolves without a person ────────────
export const MAIN = "SignalGrid_Alpha";
const SELF_REL = "scripts/mac/pr-refresh.mjs";
export const A1 = "docs/agent/SURFACE_REVIEW_COVERAGE.md"; // mainline's copy; its writer regenerates it
export const A2 = "artifacts/sync/live-sync-manifest.json"; // mainline's copy (a PR's older manifestVersion would roll back); writer regenerates
export const A3 = "docs/STATUS.md"; // mainline's copy; NO writer — figure drift is caught by the quick gates and refuses
export const A4 = "docs/agent/role-coverage-ratchet.json"; // mainline's copy; its writer refuses to lower the ratchet
export const A5 = "docs/COMPANY_BUILD_PLAN.md"; // only when every conflict hunk differs by a `path (N)` figure
const ALLOW = [A1, A2, A3, A4, A5];
const REGEN = [A1, A2, A4]; // the regeneration commit may touch these and nothing else

// Copied from scripts/check-doc-line-counts.mjs (FIGURE; that file exports nothing and runs
// on import). The gate re-verifies every figure afterwards, so a drift between the copies
// refuses at the quick-gate step rather than pushing a wrong number. GLOBAL regex: only ever
// use it through String#replace/matchAll — never .test/.exec (lastIndex is shared state).
const FIGURE =
  /`?((?:lib|artifacts|scripts|native|tools|docs|fixtures|config|docker|fleet|site)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mts|mjs|js|swift|kt|md|yml|yaml|sh))`? \((\d+)\)/g;

const REPO = process.env.SG_REPO_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REFRESH_WT = `${dirname(REPO)}/${basename(REPO)}.refresh`;
const CACHE = join(homedir(), "Library/Caches/signalgrid/pr-refresh");

const tail = (text, n = 20) => String(text).split("\n").filter((l) => l !== "").slice(-n).join("\n");
const label = (argv) => (argv[1] === "-e" ? "stub" : argv.slice(1).join(" "));
function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 256 << 20, ...o });
  return { code: r.status ?? (r.signal ? 142 : 127), out: r.stdout ?? "", err: `${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
}
const gitIn = (dir, args, o) => run("git", ["-C", dir, ...args], o);

// The env PR code runs under (writers, installs, gates, preflight): API tokens stay out. This is an
// environment scrub only — gh's keychain login and git's credential helper are still reachable.
const PR_SECRETS = ["ANTHROPIC_API_KEY", "GH_TOKEN", "GITHUB_TOKEN"];
export const prEnv = (env) => { const e = { ...env }; for (const k of PR_SECRETS) delete e[k]; return e; };

// Every `checkout -f` / `clean` below trusts that `dir` is its own worktree, not a folder inside an enclosing checkout.
const isOwnWorktree = (dir) => {
  const r = gitIn(dir, ["rev-parse", "--show-toplevel"]);
  try { return r.code === 0 && realpathSync(r.out.trim()) === realpathSync(dir); } catch { return false; }
};

// ── pure pieces (each has a self-test case) ─────────────────────────────────────────
export function parseArgs(argv) {
  const a = { max: 1, pr: null, dryRun: false, selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const f = argv[i];
    if (f === "--dry-run") a.dryRun = true;
    else if (f === "--self-test") a.selfTest = true;
    else if (f === "--max" || f === "--pr") {
      const v = argv[(i += 1)];
      if (!/^[1-9]\d*$/.test(v ?? "")) return { error: `${f} needs a positive integer (got ${JSON.stringify(v)})` };
      a[f === "--max" ? "max" : "pr"] = Number(v);
    } else return { error: `unknown flag: ${f}` };
  }
  return a;
}

/** mac/* branches of this repo aimed at mainline, ready for review, oldest PR first. mac/tick-* (lane-tick evidence PRs) and stacked PRs (base is another branch) never. */
export function filterCandidates(prs, onlyPr = null) {
  return prs
    .filter((p) => /^mac\//.test(p.ref) && !/^mac\/tick-/.test(p.ref) && p.baseRef === MAIN && p.headRepo && p.headRepo === p.baseRepo && p.draft === false)
    .filter((p) => onlyPr === null || p.number === onlyPr)
    .sort((a, b) => a.number - b.number);
}

/** A head that was refused or went red is skipped until the head moves — one stuck PR cannot starve --max. */
export function memoryVerdict(state, number, head) {
  const e = state?.[String(number)];
  if (e && e.head === head && (e.outcome === "refused" || e.outcome === "red")) {
    return { skip: true, reason: `${e.outcome} at ${String(head).slice(0, 8)} on ${e.at}; waits until the PR head moves` };
  }
  return { skip: false };
}

function worktreeBlocks(dir) {
  const r = gitIn(dir, ["worktree", "list", "--porcelain"]);
  if (r.code !== 0) return null;
  return r.out.split("\n\n").map((blk) => {
    const m = {};
    for (const l of blk.split("\n")) { const i = l.indexOf(" "); m[i < 0 ? l : l.slice(0, i)] = i < 0 ? true : l.slice(i + 1); }
    return m;
  }).filter((m) => m.worktree);
}

/** Busy = a worktree holds the branch with uncommitted or unpushed work. A clean, not-ahead checkout is not busy. Fails closed. */
export function busyVerdict(dir, ref, remote = "origin") {
  const blocks = worktreeBlocks(dir);
  if (blocks === null) return { busy: true, worktree: null, reason: "busy: could not list worktrees" };
  for (const b of blocks) {
    if (b.branch !== `refs/heads/${ref}` || b.prunable) continue;
    const st = gitIn(b.worktree, ["--no-optional-locks", "status", "--porcelain"]);
    const count = gitIn(dir, ["rev-list", "--count", `${remote}/${ref}..refs/heads/${ref}`]);
    const ahead = count.code === 0 ? Number(count.out.trim()) : NaN; // a failed count is unknown, and unknown is busy
    if (st.code !== 0 || st.out.trim() !== "" || ahead !== 0) {
      return { busy: true, worktree: b.worktree, reason: `busy: ${b.worktree} has uncommitted or unpushed work` };
    }
  }
  return { busy: false };
}

/** Preview the merge without touching any worktree. `paths` are the conflicted files. */
export function classify(dir, theirs, ours) {
  const r = gitIn(dir, ["merge-tree", "--write-tree", "--name-only", "--no-messages", theirs, ours]);
  if (r.code === 0) return { kind: "clean", paths: [], outside: [] };
  if (r.code !== 1) return { kind: "error", paths: [], outside: [], detail: tail(r.err || r.out, 3) };
  const paths = r.out.split("\n").slice(1).map((s) => s.trim()).filter(Boolean);
  const outside = paths.filter((p) => !ALLOW.includes(p));
  return { kind: outside.length ? "refuse" : "resolve", paths, outside };
}

const figureNormal = (line) => line.replace(FIGURE, "$1 (#)");
const rewriteFigures = (line, countOf) => line.replace(FIGURE, (m, p) => {
  const n = countOf(p);
  if (n === null) throw new Error(`a cited path (${p}) is itself conflicted or missing`);
  return m.replace(/\(\d+\)$/, `(${n})`); // keeps the backticks the writer used
});

/**
 * `merged` is `git merge-file -p -L OURS -L BASE -L THEIRS` output. Every conflict hunk must
 * differ between the sides ONLY in a `path (N)` figure; the resolution is mainline's (theirs)
 * side with each figure re-measured. Anything else is not mine to decide.
 */
export function resolveFigureHunks(merged, countOf) {
  const lines = merged.split("\n");
  const out = [];
  let hunks = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] !== "<<<<<<< OURS") { out.push(lines[i]); continue; }
    const ours = [];
    const theirs = [];
    i += 1;
    while (i < lines.length && lines[i] !== "=======") ours.push(lines[i++]);
    i += 1;
    while (i < lines.length && lines[i] !== ">>>>>>> THEIRS") theirs.push(lines[i++]);
    if (i >= lines.length) return { ok: false, why: "unparseable conflict markers" };
    hunks += 1;
    if (ours.length !== theirs.length || ours.some((l, k) => figureNormal(l) !== figureNormal(theirs[k]))) {
      return { ok: false, why: "a hunk differs by more than a `path (N)` figure" };
    }
    try { out.push(...theirs.map((l) => rewriteFigures(l, countOf))); } catch (e) { return { ok: false, why: e.message }; }
  }
  if (hunks === 0) return { ok: false, why: "git merge-file found no conflict hunk where git merge did" };
  return { ok: true, text: out.join("\n"), hunks };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** mkdir is the atomic part. A dead holder's lock is stale; a lock with no pid yet and under 60 s old is live. */
export function takeLock(cache) {
  const dir = join(cache, "lock");
  mkdirSync(cache, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "pid"), String(process.pid));
      return { ok: true, release: () => rmSync(dir, { recursive: true, force: true }) };
    } catch (e) { if (e.code !== "EEXIST") throw e; }
    let holder = 0;
    try { holder = Number(readFileSync(join(dir, "pid"), "utf8").trim()); } catch { holder = 0; }
    let young = false;
    try { young = new Date().getTime() - statSync(dir).mtimeMs < 60_000; } catch { /* vanished between calls: retake */ }
    if ((holder > 0 && alive(holder)) || (!(holder > 0) && young)) return { ok: false, holder: holder > 0 ? holder : null };
    rmSync(dir, { recursive: true, force: true }); // ponytail: two takers clearing one stale lock can race; a lane tick is every 5 min, not every ms
  }
  return { ok: false, holder: null };
}

/** The re-exec'd child does the work, so the lock must name the child: if only the parent is killed, a pid of the dead parent would let the next run clean the worktree under a live child. */
export function adoptLock(cache) {
  try { mkdirSync(join(cache, "lock"), { recursive: true }); writeFileSync(join(cache, "lock", "pid"), String(process.pid)); } catch { /* the parent's lock still stands */ }
  return { ok: true, release() {} };
}

const loadState = (cache) => { try { return JSON.parse(readFileSync(join(cache, "state.json"), "utf8")); } catch { return {}; } };
const saveState = (cache, st) => { mkdirSync(cache, { recursive: true }); writeFileSync(join(cache, "state.json"), `${JSON.stringify(st, null, 2)}\n`); };

// The sentinel gate. Loaded ONCE, before the first PR checkout: a later checkout rewrites
// this file's siblings on disk, and a re-import would then read some PR's copy of the gate.
let gateMod = null;
const loadGate = async () => (gateMod ??= await import(new URL("../lib/land-branch-gate.mjs", import.meta.url)));

// ── one PR, end to end (every side effect is injected; the CLI wires real ones) ──────────
const REQUIRED = ["repo", "worktree", "ref", "prNumber", "remote", "mainRef", "writers", "quickGates", "preflight", "breadth",
  "deps", "comment", "hand", "state", "saveState", "now", "runDir", "preflightTimeoutMs", "breadthTimeoutMs"];

function runCapture(argv, cwd, env, logPath, timeoutMs = 600_000) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, env, encoding: "utf8", maxBuffer: 256 << 20, timeout: timeoutMs, killSignal: "SIGTERM" });
  const text = `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`;
  appendFileSync(logPath, `\n$ ${argv.join(" ")}\n${text}\n`);
  return { code: r.status ?? (r.signal ? 142 : 127), tail: tail(text) };
}

function runLogged(argv, cwd, env, timeoutMs, logPath) {
  const fd = openSync(logPath, "a");
  let r;
  // ponytail: spawnSync's timeout signals the direct child only (build-tick's perl alarm has the same ceiling); add a process group if a grandchild ever lingers.
  try { r = spawnSync(argv[0], argv.slice(1), { cwd, env, stdio: ["ignore", fd, fd], timeout: timeoutMs, killSignal: "SIGTERM" }); } finally { closeSync(fd); }
  if (r.error && !r.signal) appendFileSync(logPath, `\n${r.error.message}\n`);
  return r.status ?? (r.signal ? 142 : 127);
}

const lastLineOf = (p) => { try { return readFileSync(p, "utf8").split("\n").filter(Boolean).pop() ?? ""; } catch { return ""; } };
const newlineCount = (buf) => { let n = 0; for (const b of buf) if (b === 10) n += 1; return n; };

export async function refreshOne(o) {
  for (const k of REQUIRED) if (o[k] === undefined || o[k] === null) throw new Error(`refreshOne: missing option "${k}"`);
  const gate = await loadGate();
  const { repo, worktree: wt, ref, prNumber: n, remote, mainRef, runDir } = o;
  const mainBranch = mainRef.slice(remote.length + 1);
  const tag = `pr-${n}`;
  mkdirSync(runDir, { recursive: true });
  const logPath = join(runDir, `${tag}.log`);
  const note = (s) => appendFileSync(logPath, `${s}\n`);
  const git = (args) => { const r = gitIn(wt, args); note(`$ git ${args.join(" ")} -> ${r.code}\n${r.out}${r.err}`); return r; };
  const env = prEnv(process.env);
  let OLD = null;
  let MAIN_SHA = null;
  let touched = false; // the worktree has been checked out onto this PR
  let reached = false; // got past classification: counts toward --max

  const result = (outcome, reason) => ({ outcome, reason, reached });
  const neutral = () => { // never leave the shared refresh worktree on a PR or mid-merge
    if (!touched) return;
    if (git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).code === 0) git(["merge", "--abort"]);
    git(["checkout", "-q", "-f", "--detach", MAIN_SHA ?? mainRef]);
    git(["clean", "-fdq"]);
  };
  const stop = (outcome, reason, quoted) => {
    neutral();
    if (OLD) { o.state[n] = { head: OLD, outcome, at: o.now().toISOString() }; o.saveState(); }
    const body = [
      `pr-refresh could not refresh this branch automatically (${outcome}); nothing pushed.`, "",
      `Reason: ${reason}`,
      ...(quoted ? ["", "```", String(quoted).replace(/```/g, "'''"), "```"] : []), "",
      `A person merges ${mainRef} into \`${ref}\` by hand; the bot will not retry until this PR's head moves (it is at ${String(OLD).slice(0, 8)}).`,
    ].join("\n");
    try { o.comment(n, body); } catch (e) { note(`comment failed: ${e.message}`); }
    const short = reason.length > 140 ? `${reason.slice(0, 137)}...` : reason;
    try {
      o.hand({ pr: n, ref, blocked: `PR #${n} refresh ${outcome}: ${short}`, where: logPath,
        need: `a person merges ${mainRef} into ${ref} by hand; the bot will not retry until the PR head moves` });
    } catch (e) { note(`hand failed: ${e.message}`); }
    return result(outcome, reason);
  };

  if (!isOwnWorktree(wt)) return result("skipped", `${wt} is not its own git worktree; nothing was checked out or cleaned there`);

  // Fresh refs first, so the memory check, the busy guard and the preview all see the same heads.
  const f = git(["fetch", "-q", remote, `+refs/heads/${ref}:refs/remotes/${remote}/${ref}`, `+refs/heads/${mainBranch}:refs/remotes/${remote}/${mainBranch}`]);
  if (f.code !== 0) return result("skipped", `git fetch failed: ${tail(f.err, 2)}`);
  OLD = git(["rev-parse", `${remote}/${ref}`]).out.trim();
  MAIN_SHA = git(["rev-parse", mainRef]).out.trim(); // pinned: the lane tick moves this ref every 5 minutes
  if (!OLD || !MAIN_SHA) return result("skipped", "could not resolve the PR head or mainline");
  const mem = memoryVerdict(o.state, n, OLD);
  if (mem.skip) return result("skipped", mem.reason);
  const busy = busyVerdict(repo, ref, remote);
  if (busy.busy) return result("skipped", busy.reason);

  // 1. classify first, no worktree touched
  const cl = classify(repo, OLD, MAIN_SHA);
  if (cl.kind === "error") return result("skipped", `git merge-tree failed: ${cl.detail}`);
  if (cl.kind === "refuse") return stop("refused", `conflicts outside the allowlist: ${cl.outside.join(", ")}`);

  // 2. the PR head in the refresh worktree
  touched = true;
  reached = true;
  const co = git(["checkout", "-q", "-f", "-B", `pr-refresh/${n}`, OLD]);
  if (co.code !== 0) return stop("red", `could not check out the PR head: ${tail(co.err, 2)}`);
  git(["clean", "-fdq"]);

  // 3. merge the pinned mainline
  const MAIN8 = MAIN_SHA.slice(0, 8);
  const byMainline = [];
  const byFigure = [];
  const m = git(["merge", "--no-ff", "--no-edit", "-m", `Merge ${mainRef} @ ${MAIN8} into ${ref} (pr-refresh: derived files resolved by their writers)`, MAIN_SHA]);
  if (m.code !== 0) {
    const unmerged = git(["diff", "--name-only", "--diff-filter=U"]).out.split("\n").filter(Boolean);
    if (unmerged.length === 0) return stop("refused", `git merge failed: ${tail(m.err + m.out, 3)}`);
    const outside = unmerged.filter((p) => !ALLOW.includes(p));
    if (outside.length) return stop("refused", `conflicts outside the allowlist: ${outside.join(", ")}`);
    const stages = new Map();
    for (const l of git(["ls-files", "-u"]).out.split("\n").filter(Boolean)) {
      const [meta, p] = l.split("\t");
      stages.set(p, (stages.get(p) ?? new Set()).add(Number(meta.split(" ")[2])));
    }
    const lopsided = unmerged.filter((p) => !(stages.get(p)?.has(2) && stages.get(p)?.has(3)));
    if (lopsided.length) return stop("refused", `a side deleted an allowlisted file (modify/delete): ${lopsided.join(", ")}`);
    for (const p of unmerged.filter((x) => x !== A5)) {
      const r = git(["checkout", "--theirs", "--", p]);
      if (r.code !== 0 || git(["add", "--", p]).code !== 0) return stop("refused", `could not take mainline's copy of ${p}: ${tail(r.err, 2)}`);
      byMainline.push(p);
    }
    if (unmerged.includes(A5)) {
      const tmp = mkdtempSync(join(tmpdir(), "pr-refresh-hunk-"));
      try {
        const stage = (k) => {
          const r = gitIn(wt, ["show", `:${k}:${A5}`], { encoding: "buffer" });
          const p = join(tmp, `s${k}`);
          writeFileSync(p, r.code === 0 ? r.out : "");
          return p;
        };
        const [ours, base, theirs] = [stage(2), stage(1), stage(3)];
        const mf = spawnSync("git", ["-C", wt, "-c", "merge.conflictStyle=merge", "merge-file", "-p", "-L", "OURS", "-L", "BASE", "-L", "THEIRS", ours, base, theirs], { encoding: "utf8", maxBuffer: 256 << 20 });
        if (mf.status === null || mf.status > 127) return stop("refused", `${A5}: git merge-file failed: ${tail(mf.stderr, 2)}`);
        const stillUnmerged = new Set(git(["ls-files", "-u"]).out.split("\n").filter(Boolean).map((l) => l.split("\t")[1]));
        const countOf = (p) => (stillUnmerged.has(p) || !existsSync(join(wt, p)) ? null : newlineCount(readFileSync(join(wt, p))));
        const res = resolveFigureHunks(mf.stdout, countOf);
        if (!res.ok) return stop("refused", `${A5}: ${res.why}`);
        writeFileSync(join(wt, A5), res.text);
        if (git(["add", "--", A5]).code !== 0) return stop("refused", `${A5}: could not stage the resolved file`);
        byFigure.push(A5);
      } finally { rmSync(tmp, { recursive: true, force: true }); }
    }
    if (git(["ls-files", "-u"]).out.trim()) return stop("refused", "unmerged paths remain after resolution");
    const c = git(["commit", "--no-edit"]);
    if (c.code !== 0) return stop("refused", `could not commit the merge: ${tail(c.err + c.out, 3)}`);
  }

  // 4. writers, in order; the surface-coverage writer LAST (it reads the tracked set)
  for (let i = 0; i < o.writers.length; i += 1) {
    if (i === o.writers.length - 1) git(["add", "-A"]);
    const r = runCapture(o.writers[i], wt, env, logPath);
    if (r.code !== 0) return stop("refused", `writer ${label(o.writers[i])} exited ${r.code}`, r.tail);
  }
  git(["add", "-A"]);
  const staged = git(["diff", "--cached", "--name-only"]).out.split("\n").filter(Boolean);
  const stray = staged.filter((p) => !REGEN.includes(p));
  if (stray.length) return stop("refused", `a writer wrote outside its file: ${stray.join(", ")}`);
  if (staged.length) {
    const c = git(["commit", "-q", "-m", `Regenerate derived files on top of ${mainRef} @ ${MAIN8} (pr-refresh)`]);
    if (c.code !== 0) return stop("refused", `could not commit the regeneration: ${tail(c.err + c.out, 3)}`);
  }
  const HEAD = git(["rev-parse", "HEAD"]).out.trim();
  if (HEAD === OLD) {
    neutral();
    reached = false; // nothing was refreshed: this PR must not use up a --max slot
    return result("skipped", `the branch already contains ${mainRef} @ ${MAIN8} and its derived files are current`);
  }

  // 5. deps (a failure here is infrastructure, not a verdict on the PR: red)
  const d = o.deps(wt, logPath, env);
  if (!d.ok) return stop("red", d.reason ?? "dependency install failed");
  Object.assign(env, d.env ?? {});

  // 6. quick gates before the long ones — quoted, never parsed
  for (const argv of o.quickGates) {
    const r = runCapture(argv, wt, env, logPath);
    if (r.code !== 0) return stop("refused", `quick gate ${label(argv)} failed (exit ${r.code})`, r.tail);
  }

  // 7. preflight, then breadth only on 0 — each log ends with its sentinel line
  const pfLog = join(runDir, `${tag}-pf.log`);
  const brLog = join(runDir, `${tag}-br.log`);
  rmSync(pfLog, { force: true });
  rmSync(brLog, { force: true });
  const pf = runLogged(o.preflight, wt, env, o.preflightTimeoutMs, pfLog);
  appendFileSync(pfLog, `\nPREFLIGHT_EXIT ${pf} ${HEAD}\n`);
  let br = 1;
  if (pf === 0) {
    br = runLogged(o.breadth, wt, env, o.breadthTimeoutMs, brLog);
    appendFileSync(brLog, `\nBREADTH_EXIT ${br} ${HEAD}\n`);
  } else writeFileSync(brLog, `not run\nBREADTH_EXIT 1 ${HEAD}\n`);

  // 8. the sentinel gate: the same verify() the land-branch chain pushes on
  const v = gate.verify({ scratch: runDir, tag, worktree: wt, branch: `pr-refresh/${n}`, head: HEAD });
  if (!v.ok) {
    const why = pf !== 0 ? `preflight exited ${pf}` : br !== 0 ? `breadth exited ${br}` : `land-branch-gate refused: ${v.reasons.join("; ")}`;
    return stop("red", why, tail(readFileSync(pf !== 0 ? pfLog : brLog, "utf8"), 20));
  }

  // 9. push — never --force, never --no-verify. The branch must still be at OLD: a plain push would recreate
  // one that was merged or deleted during the gates (the repo deletes merged branches), and a moved head
  // means someone pushed meanwhile. Pushing the sha verify() approved, not the symbolic HEAD.
  // ponytail: ls-remote then push leaves a window of milliseconds; --force-with-lease would close it, but force flags are banned here.
  const lr = git(["ls-remote", "--exit-code", remote, `refs/heads/${ref}`]);
  if (lr.code !== 0 || lr.out.split("\t")[0].trim() !== OLD) {
    neutral();
    return result("raced", lr.code === 2 ? "the PR branch was deleted while the gates ran; nothing recreated" : lr.code !== 0 ? `could not read ${remote}/${ref} before pushing: ${tail(lr.err, 2)}` : "the PR head moved while the gates ran; the next run retries");
  }
  const p = git(["push", remote, `${HEAD}:refs/heads/${ref}`]);
  if (p.code !== 0) {
    const text = `${p.err}${p.out}`;
    if (/non-fast-forward|\[rejected\]|fetch first/i.test(text)) {
      neutral();
      return result("raced", "the PR head moved while the gates ran; the next run retries");
    }
    return stop("red", `push refused: ${tail(text, 3)}`, tail(text));
  }

  // 10. say what happened (best effort — the push already landed)
  delete o.state[n];
  o.saveState();
  const body = [
    `pr-refresh merged \`${mainRef}\` @ ${MAIN_SHA} into this branch and regenerated its derived files.`, "",
    `Resolved by taking mainline's copy: ${[...byMainline, ...byFigure.map((x) => `${x} (figure-only hunks, \`path (N)\` re-measured)`)].join(", ") || "none (the merge was clean)"}`,
    `Writers run: ${o.writers.map(label).join("; ")}`,
    `Head moved ${OLD.slice(0, 8)} → ${HEAD.slice(0, 8)}; any earlier review (including a DR-061 Opus review of a DECISION_PATH PR) was of ${OLD.slice(0, 8)} and needs re-doing.`, "",
    "```", lastLineOf(pfLog), lastLineOf(brLog), "```",
  ].join("\n");
  neutral();
  try { o.comment(n, body); } catch (e) { note(`comment failed: ${e.message}`); }
  return result("refreshed", `merged ${mainRef} @ ${MAIN8}; head ${OLD.slice(0, 8)} → ${HEAD.slice(0, 8)}`);
}

// ── the CLI's real side effects ────────────────────────────────────────────────────
function ghText(args, cwd) {
  const r = run("gh", args, { cwd });
  if (r.code !== 0) throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${tail(r.err || r.out, 3)}`);
  return r.out;
}

/** Eligible PRs plus each one's mergeable_state. Per-PR GET because the list endpoint omits it. */
function candidateRows(cwd, onlyPr) {
  const listed = ghText(["api", "--paginate", "repos/{owner}/{repo}/pulls?state=open&per_page=100", "--jq",
    ".[] | {number, ref: .head.ref, baseRef: .base.ref, headRepo: .head.repo.full_name, baseRepo: .base.repo.full_name, draft}"], cwd)
    .split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const eligible = filterCandidates(listed, onlyPr);
  const detail = (number) => JSON.parse(ghText(["api", `repos/{owner}/{repo}/pulls/${number}`, "--jq", "{state: .mergeable_state, mergeable}"], cwd));
  const isUnknown = (d) => d.mergeable === null || d.state === "unknown";
  let got = eligible.map((p) => ({ p, d: detail(p.number) }));
  if (got.some((x) => isUnknown(x.d))) {
    // GitHub computes mergeability lazily after mainline moves (the lane tick moves it every 5 minutes):
    // the first GET only starts the computation. One re-poll of the unknown ones, then they are skipped this run.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    got = got.map((x) => (isUnknown(x.d) ? { p: x.p, d: detail(x.p.number) } : x));
  }
  const rows = got
    .filter((x) => isUnknown(x.d) || x.d.state === "dirty" || x.d.state === "behind")
    .map((x) => ({ ...x.p, state: x.d.state, unknown: isUnknown(x.d) }));
  return { open: listed.length, eligible: eligible.length, rows };
}

const ghComment = (cwd) => (num, body) => {
  const f = join(CACHE, `comment-${num}-${process.pid}.md`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(f, body);
  try { ghText(["api", "-X", "POST", `repos/{owner}/{repo}/issues/${num}/comments`, "-F", `body=@${f}`], cwd); } finally { rmSync(f, { force: true }); }
};

// A hand through lane-deliver, exactly as the build tick raises one: a failure (e.g. "already exists today") is logged, never fatal.
const laneHand = () => (h) => {
  const f = join(CACHE, `hand-${process.pid}-${h.pr}.json`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(f, JSON.stringify([{ op: "raise", who: "mac lane", domain: "lane", where: h.where,
    doing: "the PR refresh bot (scripts/mac/pr-refresh.mjs)", blocked: h.blocked, need: h.need }]));
  try {
    const r = run(process.execPath, [join(REPO, "scripts/lane-deliver.mjs"), "batch", f]);
    if (r.code !== 0) throw new Error(tail(r.err || r.out, 3));
  } catch (e) {
    appendFileSync(join(CACHE, "undelivered-hands.log"), `${new Date().toISOString()}  ${h.blocked}  (${e.message})\n`);
  } finally { rmSync(f, { force: true }); }
};

// Same recipe as the build tick: pnpm install when the lockfile moved, and tsx's darwin esbuild from a cache outside the repo.
function ensureDeps(wt, logPath, env) {
  const say = (s) => appendFileSync(logPath, `${s}\n`);
  const lock = join(wt, "pnpm-lock.yaml");
  const sha = existsSync(lock) ? createHash("sha256").update(readFileSync(lock)).digest("hex") : "";
  const stamp = join(wt, "node_modules/.sg-installed-lock-sha");
  const have = existsSync(stamp) ? readFileSync(stamp, "utf8") : null;
  if (!sha || have !== sha) {
    const r = runCapture(["pnpm", "install", "--frozen-lockfile"], wt, env, logPath, 1_800_000);
    if (r.code !== 0) return { ok: false, reason: "pnpm install --frozen-lockfile failed" };
    mkdirSync(join(wt, "node_modules"), { recursive: true });
    writeFileSync(stamp, sha);
    say("pnpm install --frozen-lockfile (lockfile moved)");
  }
  let ver;
  try { ver = createRequire(realpathSync(join(wt, "scripts/node_modules/tsx/package.json")))("esbuild/package.json").version; } catch { ver = ""; }
  if (!ver) return { ok: false, reason: "could not resolve the esbuild version tsx uses" };
  const pkg = `@esbuild/darwin-${process.arch}`;
  const dir = join(homedir(), "Library/Caches/signalgrid", `esbuild-${ver}`);
  const bin = join(dir, "node_modules", pkg, "bin/esbuild");
  if (!existsSync(bin)) {
    runCapture(["npm", "install", "-q", "--prefix", dir, "--no-save", "--no-package-lock", `${pkg}@${ver}`], wt, env, logPath, 600_000);
    if (!existsSync(bin)) return { ok: false, reason: `could not fetch ${pkg}@${ver} into ${dir}` };
  }
  return { ok: true, env: { ESBUILD_BINARY_PATH: bin } };
}

const stampNow = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
const say = (stamp, num, ref, outcome, reason) => console.log(`pr-refresh ${stamp} #${num} ${ref}: ${outcome} — ${reason}`);

async function dryRun(a) {
  const fetched = run("git", ["-C", REPO, "fetch", "-q", "origin", "--prune"]);
  if (fetched.code !== 0) { console.error(`pr-refresh: git fetch failed: ${tail(fetched.err, 3)}`); return 1; }
  let c;
  try { c = candidateRows(REPO, a.pr); } catch (e) { console.error(`pr-refresh: ${e.message}`); return 1; }
  const state = loadState(CACHE);
  const mainSha = gitIn(REPO, ["rev-parse", `origin/${MAIN}`]).out.trim();
  console.log(`pr-refresh dry-run: ${c.open} open PRs, ${c.eligible} eligible (mac/*, not mac/tick-*, based on ${MAIN}, same repo, not draft), mainline ${mainSha.slice(0, 8)}`);
  for (const p of c.rows) {
    if (p.unknown) { console.log(`#${p.number} ${p.ref}  mergeable_state unknown — skipped this run`); continue; }
    const head = gitIn(REPO, ["rev-parse", `origin/${p.ref}`]).out.trim();
    const mem = memoryVerdict(state, p.number, head);
    const busy = busyVerdict(REPO, p.ref);
    const cl = classify(REPO, `origin/${p.ref}`, `origin/${MAIN}`);
    const verdict = cl.kind === "error" ? `merge-tree failed: ${cl.detail}`
      : cl.kind === "refuse" ? `would refuse: ${cl.outside.join(", ")}`
      : cl.paths.includes(A5) ? `needs the hunk rule: ${A5}${cl.paths.length > 1 ? ` (+ would resolve: ${cl.paths.filter((x) => x !== A5).join(", ")})` : ""}`
      : cl.kind === "clean" ? "would merge cleanly, then regenerate" : `would resolve: ${cl.paths.join(", ")}`;
    console.log(`#${p.number} ${p.ref}  ${p.state}  ${busy.busy ? busy.reason : "busy: no"}  ${mem.skip ? `memory: skip (${mem.reason})` : "memory: none"}  ${verdict}`);
  }
  console.log(`pr-refresh dry-run: ${c.rows.length} candidate(s) (dirty, behind, or mergeable_state not computed yet); nothing was changed`);
  return 0;
}

async function childRun(a) {
  await loadGate(); // before the first PR checkout rewrites anything under scripts/
  const stamp = stampNow();
  const runDir = join(CACHE, "runs", stamp);
  mkdirSync(runDir, { recursive: true });
  let c;
  try { c = candidateRows(REPO, a.pr); } catch (e) { console.error(`pr-refresh: ${e.message}`); return 1; }
  const state = loadState(CACHE);
  const node = process.execPath;
  const common = {
    repo: REPO, worktree: REFRESH_WT, remote: "origin", mainRef: `origin/${MAIN}`, runDir,
    writers: [[node, "scripts/generate-sync-manifest.mjs"], [node, "scripts/check-role-coverage.mjs", "--write"], [node, "scripts/check-surface-review-coverage.mjs", "--write"]],
    quickGates: ["check-doc-line-counts", "check-derived-doc-figures", "check-status-figures", "check-live-sync", "check-role-coverage", "check-surface-review-coverage"].map((g) => [node, `scripts/${g}.mjs`]),
    preflight: [node, "scripts/preflight.mjs"], breadth: ["pnpm", "run", "verify:breadth"],
    preflightTimeoutMs: 5400e3, breadthTimeoutMs: 3600e3,
    deps: ensureDeps, comment: ghComment(REPO), hand: laneHand(),
    state, saveState: () => saveState(CACHE, state), now: () => new Date(),
  };
  let reached = 0;
  for (const p of c.rows) {
    if (reached >= a.max) break;
    if (p.unknown) { say(stamp, p.number, p.ref, "skipped", "mergeable_state not computed yet; looked again next run"); continue; }
    const res = await refreshOne({ ...common, ref: p.ref, prNumber: p.number });
    say(stamp, p.number, p.ref, res.outcome, res.reason);
    if (res.reached) reached += 1;
  }
  if (c.rows.length === 0) console.log(`pr-refresh ${stamp}: no dirty mac/* PRs (${c.open} open, ${c.eligible} eligible)`);
  return 0;
}

// A real run never executes a branch copy: it fetches and re-execs mainline's, from a detached
// worktree next to the repo. The lock is taken BEFORE that worktree is reset, so a second run
// can never wipe the first one's checkout; the child inherits the lock instead of retaking it.
async function realRun(a) {
  if (process.platform !== "darwin") {
    console.error("pr-refresh: the refresh bot is the Mac lane's (it needs the Mac's gh login, pnpm and a preflight that mirrors CI); on this host nothing runs.");
    return 2;
  }
  const home = homedir();
  process.env.PATH = [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/Library/pnpm`].filter(Boolean).join(":");
  const inherited = process.env.SG_PR_REFRESH_LOCKED === "1";
  const lock = inherited ? adoptLock(CACHE) : takeLock(CACHE);
  if (!lock.ok) { console.log(`pr-refresh: skipped: another refresh (pid ${lock.holder ?? "?"}) holds the lock`); return 0; }
  try {
    if (process.env.SG_PR_REFRESH_MAINLINE === "1") return await childRun(a);
    const fetched = run("git", ["-C", REPO, "fetch", "-q", "origin", "--prune"]);
    if (fetched.code !== 0) { console.error(`pr-refresh: git fetch failed: ${tail(fetched.err, 3)}`); return 1; }
    if (gitIn(REPO, ["cat-file", "-e", `origin/${MAIN}:${SELF_REL}`]).code !== 0) {
      console.log("pr-refresh: not on mainline yet — nothing to run");
      return 0;
    }
    gitIn(REPO, ["worktree", "prune"]);
    if (!existsSync(REFRESH_WT)) {
      const add = gitIn(REPO, ["worktree", "add", "-q", "--detach", REFRESH_WT, `origin/${MAIN}`]);
      if (add.code !== 0) { console.error(`pr-refresh: could not create ${REFRESH_WT}: ${tail(add.err, 3)}`); return 1; }
    }
    if (!isOwnWorktree(REFRESH_WT)) { console.error(`pr-refresh: ${REFRESH_WT} is not its own git worktree; refusing to check out or clean it`); return 1; }
    const reset = gitIn(REFRESH_WT, ["checkout", "-q", "-f", "--detach", `origin/${MAIN}`]);
    if (reset.code !== 0 || gitIn(REFRESH_WT, ["clean", "-fdq"]).code !== 0) { console.error(`pr-refresh: could not reset ${REFRESH_WT}: ${tail(reset.err, 3)}`); return 1; }
    const child = spawnSync(process.execPath, [join(REFRESH_WT, SELF_REL), ...process.argv.slice(2)], {
      stdio: "inherit", env: { ...process.env, SG_PR_REFRESH_MAINLINE: "1", SG_PR_REFRESH_LOCKED: "1", SG_REPO_ROOT: REPO },
    });
    return child.status ?? 1;
  } finally { lock.release(); }
}

// ───────────────────────────────── self-test ─────────────────────────────────
// Temp repos only: a bare origin, a work clone, a sibling refresh worktree. Writers,
// gates, preflight, breadth, deps, comment and hand are all stubs; only git, the figure
// rule and the REAL land-branch-gate verify() are live. No gh, no network, no launchd.
async function selfTest() {
  const results = [];
  const check = async (name, fn) => {
    try { await fn(); results.push([name, true, ""]); } catch (e) { results.push([name, false, String(e.message).split("\n")[0]]); }
  };
  const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
  const yes = (c, m) => { if (!c) throw new Error(m); };

  // Hermetic: no global/system git config (pre-push hook path, gpgsign, conflictStyle).
  const savedEnv = { ...process.env };
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pr-refresh-st-")));
  writeFileSync(join(root, "gitconfig"), "");
  process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: "utf8" });
  const g = (dir, args) => {
    const r = sh("git", ["-C", dir, ...args]);
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} (${dir}): ${r.stderr}`);
    return r.stdout.trim();
  };
  const gcode = (dir, args) => sh("git", ["-C", dir, ...args]).status;
  const put = (dir, rel, text) => { mkdirSync(dirname(join(dir, rel)), { recursive: true }); writeFileSync(join(dir, rel), text); };
  const commit = (dir, msg) => { g(dir, ["add", "-A"]); g(dir, ["commit", "-q", "-m", msg]); };
  const nl = (s) => [...s].filter((c) => c === "\n").length;
  const NODE = process.execPath;
  const stub = (code) => [NODE, "-e", code];
  const exit = (n) => stub(`process.exit(${n})`);

  const X10 = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const PLAN = (n, tail = " — the thing") => `# Plan\n- scripts/x.mjs (${n})${tail}\nfiller 1\nfiller 2\nfiller 3\n`;
  let seq = 0;
  const fixture = () => {
    const dir = join(root, `f${++seq}`);
    const fx = { dir, bare: join(dir, "origin.git"), work: join(dir, "work"), wt: join(dir, "work.refresh"), runDir: join(dir, "runs") };
    mkdirSync(dir, { recursive: true });
    g(dir, ["init", "-q", "--bare", "-b", MAIN, fx.bare]);
    g(dir, ["init", "-q", "-b", MAIN, fx.work]);
    g(fx.work, ["config", "user.name", "t"]);
    g(fx.work, ["config", "user.email", "t@example.com"]);
    g(fx.work, ["remote", "add", "origin", fx.bare]);
    put(fx.work, A1, "coverage base\n");
    put(fx.work, A2, '{"v":"base"}\n');
    put(fx.work, A5, PLAN(10));
    put(fx.work, "scripts/x.mjs", X10);
    put(fx.work, "src/a.txt", "a\n");
    commit(fx.work, "base");
    g(fx.work, ["push", "-q", "-u", "origin", MAIN]);
    g(fx.work, ["worktree", "add", "-q", "--detach", fx.wt, `origin/${MAIN}`]);
    fx.base = g(fx.work, ["rev-parse", "HEAD"]);
    return fx;
  };
  // A PR branch cut from the base commit, then back to mainline in the work clone.
  const pr = (fx, ref, files, msg = `edit ${ref}`) => {
    g(fx.work, ["checkout", "-q", "-b", ref, fx.base]);
    for (const [rel, text] of Object.entries(files)) put(fx.work, rel, text);
    commit(fx.work, msg);
    g(fx.work, ["push", "-q", "origin", ref]);
    g(fx.work, ["checkout", "-q", MAIN]);
  };
  const mainline = (fx, files, msg = "mainline moves") => {
    for (const [rel, text] of Object.entries(files)) put(fx.work, rel, text);
    commit(fx.work, msg);
    g(fx.work, ["push", "-q", "origin", MAIN]);
    return g(fx.work, ["rev-parse", "HEAD"]);
  };
  const remoteHead = (fx, ref) => g(fx.bare, ["rev-parse", `refs/heads/${ref}`]);
  const isAnc = (fx, a, b) => gcode(fx.bare, ["merge-base", "--is-ancestor", a, b]) === 0;

  const WRITE_MANIFEST = stub(`const fs=require("fs");const f="${A2}";fs.writeFileSync(f,JSON.stringify({regenOf:fs.readFileSync(f,"utf8").trim()})+"\\n")`);
  const WRITE_NOTHING = exit(0);
  const WRITE_COVERAGE = stub(`require("fs").appendFileSync("${A1}","regenerated\\n")`);
  const optsFor = (fx, ref, n, over = {}) => {
    const calls = { comments: [], hands: [] };
    const opts = {
      repo: fx.work, worktree: fx.wt, ref, prNumber: n, remote: "origin", mainRef: `origin/${MAIN}`,
      writers: [WRITE_MANIFEST, WRITE_NOTHING, WRITE_COVERAGE],
      quickGates: [exit(0)], preflight: exit(0), breadth: exit(0),
      deps: () => ({ ok: true, env: {} }),
      comment: (num, body) => { calls.comments.push({ num, body }); },
      hand: (h) => { calls.hands.push(h); },
      state: {}, saveState: () => {}, now: () => new Date("2026-10-01T00:00:00Z"),
      runDir: fx.runDir, preflightTimeoutMs: 60_000, breadthTimeoutMs: 60_000, ...over,
    };
    return { opts, calls };
  };
  const wtClean = (fx) => {
    yes(gcode(fx.wt, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]) !== 0, "worktree left mid-merge (MERGE_HEAD exists)");
    eq(g(fx.wt, ["status", "--porcelain"]), "", "worktree has leftover changes");
  };
  const lastLine = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).pop();

  try {
    await check("T1 allowlisted-only conflict: mainline's copy, writers ran, regen touches only A1/A2/A4, fast-forward push, sentinels in the comment", async () => {
      const fx = fixture();
      pr(fx, "mac/a", { [A1]: "coverage pr\n", [A2]: '{"v":"pr"}\n' });
      const MAIN_SHA = mainline(fx, { [A1]: "coverage main\n", [A2]: '{"v":"main"}\n' });
      const old = remoteHead(fx, "mac/a");
      const { opts, calls } = optsFor(fx, "mac/a", 1);
      const r = await refreshOne(opts);
      eq(r.outcome, "refreshed", `outcome (${r.reason})`);
      const head = remoteHead(fx, "mac/a");
      yes(head !== old && isAnc(fx, old, head), "remote mac/a did not advance by fast-forward");
      yes(isAnc(fx, MAIN_SHA, head), "the new head does not contain mainline");
      const cov = g(fx.bare, ["show", `${head}:${A1}`]);
      yes(cov.startsWith("coverage main") && cov.endsWith("regenerated"), `A1 should be mainline's copy then regenerated, got ${JSON.stringify(cov)}`);
      yes(g(fx.bare, ["show", `${head}:${A2}`]).includes("main"), "A2 should be derived from mainline's copy");
      const touched = g(fx.bare, ["diff", "--name-only", `${head}~1`, head]).split("\n").filter(Boolean);
      yes(touched.length > 0 && touched.every((p) => [A1, A2, "docs/agent/role-coverage-ratchet.json"].includes(p)), `regeneration commit touched ${touched}`);
      eq(calls.comments.length, 1, "comments");
      yes(calls.comments[0].body.includes(`PREFLIGHT_EXIT 0 ${head}\nBREADTH_EXIT 0 ${head}`), "comment lacks both sentinel lines verbatim");
      eq(calls.hands.length, 0, "hands");
      eq(opts.state["1"], undefined, "state entry kept after success");
      wtClean(fx);
    });

    await check("T2 conflict in src/a.txt: refused naming it, nothing pushed, worktree untouched", async () => {
      const fx = fixture();
      pr(fx, "mac/b", { "src/a.txt": "pr\n" });
      mainline(fx, { "src/a.txt": "main\n" });
      const old = remoteHead(fx, "mac/b");
      const { opts, calls } = optsFor(fx, "mac/b", 2);
      const r = await refreshOne(opts);
      eq(r.outcome, "refused", "outcome");
      yes(r.reason.includes("src/a.txt"), `reason does not name src/a.txt: ${r.reason}`);
      yes(calls.hands.length === 1 && calls.hands[0].blocked.includes("src/a.txt") && calls.hands[0].blocked.slice(0, 48).includes("PR #2"), "hand must name src/a.txt with PR #2 in its first 48 chars");
      yes(calls.comments[0].body.includes("src/a.txt") && calls.comments[0].body.includes("nothing pushed"), "comment must name the file and say nothing pushed");
      eq(remoteHead(fx, "mac/b"), old, "remote moved");
      eq(g(fx.wt, ["rev-parse", "HEAD"]), fx.base, "classification refusal must not touch the worktree");
      eq(opts.state["2"].outcome, "refused", "state");
      wtClean(fx);
    });

    await check("T3 allowlisted conflict, red preflight: red, nothing pushed, log ends PREFLIGHT_EXIT 1 <sha>", async () => {
      const fx = fixture();
      pr(fx, "mac/c", { [A1]: "coverage pr\n" });
      const MAIN_SHA = mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/c");
      const { opts, calls } = optsFor(fx, "mac/c", 3, { preflight: exit(1) });
      const r = await refreshOne(opts);
      eq(r.outcome, "red", `outcome (${r.reason})`);
      eq(remoteHead(fx, "mac/c"), old, "remote moved");
      const m = /^PREFLIGHT_EXIT 1 ([0-9a-f]{40})$/.exec(lastLine(join(fx.runDir, "pr-3-pf.log")) ?? "");
      yes(m, "pf log must end with PREFLIGHT_EXIT 1 <40-hex sha>");
      yes(gcode(fx.work, ["merge-base", "--is-ancestor", MAIN_SHA, m[1]]) === 0, "the sentinel sha is not the merged head (it was never pushed, so ask the work clone)");
      eq(calls.hands.length, 1, "hands");
      eq(opts.state["3"].outcome, "red", "state");
      wtClean(fx);
    });

    await check("T4 COMPANY_BUILD_PLAN figure-only conflict: resolved, N recomputed from the merged file", async () => {
      const fx = fixture();
      pr(fx, "mac/d", { "scripts/x.mjs": "// pr header\n" + X10, [A5]: PLAN(11) });
      mainline(fx, { "scripts/x.mjs": X10 + "tail 1\ntail 2\n", [A5]: PLAN(12) });
      const { opts } = optsFor(fx, "mac/d", 4);
      const r = await refreshOne(opts);
      eq(r.outcome, "refreshed", `outcome (${r.reason})`);
      const head = remoteHead(fx, "mac/d");
      const n = nl(g(fx.bare, ["show", `${head}:scripts/x.mjs`]) + "\n");
      eq(n, 13, "merged x.mjs newline count");
      eq(g(fx.bare, ["show", `${head}:${A5}`]).split("\n")[1], `- scripts/x.mjs (${n}) — the thing`, "plan line");
      wtClean(fx);
    });

    await check("T5 COMPANY_BUILD_PLAN conflict with a prose difference: refused naming the file", async () => {
      const fx = fixture();
      pr(fx, "mac/e", { [A5]: PLAN(11, " — the thing, now much bigger") });
      mainline(fx, { [A5]: PLAN(12) });
      const old = remoteHead(fx, "mac/e");
      const { opts, calls } = optsFor(fx, "mac/e", 5);
      const r = await refreshOne(opts);
      eq(r.outcome, "refused", "outcome");
      yes(r.reason.includes(A5) && r.reason.includes("differs by more than a `path (N)` figure"), `reason: ${r.reason}`);
      eq(remoteHead(fx, "mac/e"), old, "remote moved");
      eq(calls.hands.length, 1, "hands");
      wtClean(fx);
    });

    await check("T6 skip memory: a refused head waits until the head moves", async () => {
      const fx = fixture();
      pr(fx, "mac/f", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/f");
      const state = { 6: { head: old, outcome: "refused", at: "2026-09-30T00:00:00Z" } };
      const first = optsFor(fx, "mac/f", 6, { state });
      const r1 = await refreshOne(first.opts);
      eq(r1.outcome, "skipped", "outcome while the head is unchanged");
      eq(remoteHead(fx, "mac/f"), old, "remote moved");
      eq(gcode(fx.work, ["rev-parse", "-q", "--verify", "refs/heads/pr-refresh/6"]) !== 0, true, "a merge branch was created for a remembered head");
      eq(first.calls.hands.length + first.calls.comments.length, 0, "a skip must not comment or raise a hand");
      g(fx.work, ["checkout", "-q", "mac/f"]);
      put(fx.work, "src/b.txt", "new work\n");
      commit(fx.work, "head moves");
      g(fx.work, ["push", "-q", "origin", "mac/f"]);
      g(fx.work, ["checkout", "-q", MAIN]);
      const r2 = await refreshOne(optsFor(fx, "mac/f", 6, { state }).opts);
      eq(r2.outcome, "refreshed", `outcome after the head moved (${r2.reason})`);
      eq(state["6"], undefined, "state entry kept after a successful push");
    });

    await check("T7 busy guard: dirty or ahead worktree on the branch is busy; clean and not ahead is not", async () => {
      const fx = fixture();
      pr(fx, "mac/g", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const busyWt = join(fx.dir, "parked");
      g(fx.work, ["worktree", "add", "-q", busyWt, "mac/g"]);
      eq(busyVerdict(fx.work, "mac/g").busy, false, "a clean, not-ahead checkout is not busy");
      put(busyWt, "wip.txt", "uncommitted\n");
      const v = busyVerdict(fx.work, "mac/g");
      yes(v.busy && v.reason.includes(busyWt), `dirty worktree should be busy and named: ${JSON.stringify(v)}`);
      const old = remoteHead(fx, "mac/g");
      const r = await refreshOne(optsFor(fx, "mac/g", 7).opts);
      yes(r.outcome === "skipped" && r.reason.startsWith("busy:"), `refreshOne on a busy branch: ${r.outcome} ${r.reason}`);
      eq(remoteHead(fx, "mac/g"), old, "remote moved");
      rmSync(join(busyWt, "wip.txt"));
      eq(busyVerdict(fx.work, "mac/g").busy, false, "clean again");
      put(busyWt, "local.txt", "committed, not pushed\n");
      commit(busyWt, "unpushed");
      eq(busyVerdict(fx.work, "mac/g").busy, true, "a worktree ahead of origin is busy");
      eq(busyVerdict(fx.work, "mac/not-checked-out").busy, false, "a branch no worktree holds is not busy");
    });

    await check("T8 the sentinel gate is the real verify(): a stale pf sentinel refuses and nothing is pushed", async () => {
      const fx = fixture();
      pr(fx, "mac/h", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/h");
      const pf = join(fx.runDir, "pr-8-pf.log");
      const tamper = stub(`require("fs").appendFileSync(${JSON.stringify(pf)},"PREFLIGHT_EXIT 0 "+"0".repeat(40)+"\\n")`);
      const { opts, calls } = optsFor(fx, "mac/h", 8, { breadth: tamper });
      const r = await refreshOne(opts);
      eq(r.outcome, "red", `outcome (${r.reason})`);
      yes(r.reason.includes("land-branch-gate") && r.reason.includes("sentinel names head"), `reason should carry verify()'s own refusal: ${r.reason}`);
      eq(remoteHead(fx, "mac/h"), old, "remote moved");
      eq(calls.hands.length, 1, "hands");
    });

    await check("T9 static-import constraint: every import/export-from specifier starts with node:", async () => {
      const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
      const specs = [
        ...src.matchAll(/^import\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/gm),
        ...src.matchAll(/^export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/gm),
      ].map((m) => m[1]);
      yes(specs.length >= 5, `found only ${specs.length} static imports; the matcher stopped matching`);
      const bad = specs.filter((s) => !s.startsWith("node:"));
      yes(bad.length === 0, `non-node: static imports: ${bad.join(", ")}`);
    });

    await check("T10 lock: a live holder blocks, a dead holder is cleared, release frees it", async () => {
      const cache = join(root, "lockcache");
      const a = takeLock(cache);
      yes(a.ok, "first take");
      const b = takeLock(cache);
      yes(!b.ok && b.holder === process.pid, "a live holder must block a second taker");
      a.release();
      const c = takeLock(cache);
      yes(c.ok, "take after release");
      c.release();
      const dead = spawnSync(NODE, ["-e", ""]).pid;
      mkdirSync(join(cache, "lock"), { recursive: true });
      writeFileSync(join(cache, "lock", "pid"), String(dead));
      const d = takeLock(cache);
      yes(d.ok, "a lock whose pid is dead is stale and must be retaken");
      d.release();
    });

    await check("T11 a failing quick gate refuses, quotes the gate output, nothing pushed", async () => {
      const fx = fixture();
      pr(fx, "mac/i", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/i");
      const { opts, calls } = optsFor(fx, "mac/i", 11, { quickGates: [stub('console.log("gate says no");process.exit(1)')] });
      const r = await refreshOne(opts);
      eq(r.outcome, "refused", "outcome");
      yes(r.reason.includes("quick gate"), `reason: ${r.reason}`);
      yes(calls.comments[0].body.includes("gate says no"), "comment must quote the gate output");
      eq(remoteHead(fx, "mac/i"), old, "remote moved");
      wtClean(fx);
    });

    await check("T12 a writer that writes outside A1/A2/A4 is refused naming the stray file, nothing pushed", async () => {
      const fx = fixture();
      pr(fx, "mac/j", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/j");
      const stray = stub('require("fs").writeFileSync("src/stray.txt","x\\n")');
      const { opts } = optsFor(fx, "mac/j", 14, { writers: [WRITE_MANIFEST, stray, WRITE_COVERAGE] });
      const r = await refreshOne(opts);
      eq(r.outcome, "refused", "outcome");
      yes(r.reason.includes("src/stray.txt"), `reason: ${r.reason}`);
      eq(remoteHead(fx, "mac/j"), old, "remote moved");
      wtClean(fx);
    });

    await check("T13 candidate filter: mac/* only, never mac/tick-*, same-repo, non-draft, based on mainline, --pr narrows", async () => {
      const mk = (number, ref, over = {}) => ({ number, ref, baseRef: MAIN, headRepo: "o/r", baseRepo: "o/r", draft: false, ...over });
      const list = [mk(1, "mac/a"), mk(2, "mac/tick-20260930"), mk(3, "cloud/x"), mk(4, "mac/fork", { headRepo: "f/r" }), mk(5, "mac/draft", { draft: true }), mk(6, "mac/b"), mk(7, "mac/c", { baseRef: "mac/a" })];
      eq(filterCandidates(list).map((p) => p.number).join(","), "1,6", "kept (7 is stacked on mac/a)");
      eq(filterCandidates(list, 6).map((p) => p.number).join(","), "6", "--pr 6");
      eq(filterCandidates(list, 2).length, 0, "--pr cannot resurrect a tick PR");
      eq(filterCandidates(list, 7).length, 0, "--pr cannot resurrect a stacked PR");
    });

    await check("T14 flags: unknown flag and bad values are errors; the known ones parse", async () => {
      yes(parseArgs(["--bogus"]).error, "unknown flag");
      yes(parseArgs(["--max"]).error && parseArgs(["--max", "0"]).error && parseArgs(["--max", "x"]).error, "bad --max");
      yes(parseArgs(["--pr", "-3"]).error, "bad --pr");
      const p = parseArgs(["--max", "2", "--pr", "7", "--dry-run"]);
      yes(!p.error && p.max === 2 && p.pr === 7 && p.dryRun === true, "good flags");
      eq(parseArgs([]).max, 1, "--max default");
    });

    await check("T15 push race: someone pushes while the gates run -> raced, nothing of ours on the remote, no hand, no state", async () => {
      const fx = fixture();
      pr(fx, "mac/k", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/k");
      const racer = stub(`const {execFileSync:x}=require("child_process"),fs=require("fs"),os=require("os"),path=require("path");
        const d=fs.mkdtempSync(path.join(os.tmpdir(),"racer-"));
        const git=(...a)=>x("git",["-c","user.name=r","-c","user.email=r@example.com",...a],{cwd:d,stdio:"ignore"});
        x("git",["clone","-q","-b","mac/k",${JSON.stringify(fx.bare)},d],{stdio:"ignore"});
        fs.writeFileSync(path.join(d,"raced.txt"),"someone else\\n");git("add","-A");git("commit","-q","-m","racer");git("push","-q","origin","mac/k");
        fs.rmSync(d,{recursive:true,force:true})`);
      const { opts, calls } = optsFor(fx, "mac/k", 15, { breadth: racer });
      const r = await refreshOne(opts);
      eq(r.outcome, "raced", `outcome (${r.reason})`);
      const now = remoteHead(fx, "mac/k");
      eq(g(fx.bare, ["rev-list", "--count", `${old}..${now}`]), "1", "the remote should hold only the racer's commit");
      eq(calls.hands.length + calls.comments.length, 0, "a lost race must not comment or raise a hand");
      eq(opts.state["15"], undefined, "a lost race must not be remembered");
      wtClean(fx);
    });

    await check("T16 a dependency-install failure is red (comment + hand), nothing pushed", async () => {
      const fx = fixture();
      pr(fx, "mac/l", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/l");
      const { opts, calls } = optsFor(fx, "mac/l", 16, { deps: () => ({ ok: false, reason: "pnpm install --frozen-lockfile failed" }) });
      const r = await refreshOne(opts);
      eq(r.outcome, "red", "outcome");
      eq(calls.hands.length, 1, "hands");
      eq(remoteHead(fx, "mac/l"), old, "remote moved");
      wtClean(fx);
    });

    await check("T17 the PR branch is deleted while the gates run: raced, the branch is NOT recreated, no comment, no hand, no state", async () => {
      const fx = fixture();
      pr(fx, "mac/z", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const deleter = stub(`require("child_process").execFileSync("git",["--git-dir",${JSON.stringify(fx.bare)},"update-ref","-d","refs/heads/mac/z"])`);
      const { opts, calls } = optsFor(fx, "mac/z", 17, { breadth: deleter });
      const r = await refreshOne(opts);
      eq(r.outcome, "raced", `outcome (${r.reason})`);
      yes(r.reason.includes("deleted"), `reason should say the branch was deleted: ${r.reason}`);
      yes(gcode(fx.bare, ["rev-parse", "-q", "--verify", "refs/heads/mac/z"]) !== 0, "the deleted PR branch was recreated on the remote");
      eq(calls.hands.length + calls.comments.length, 0, "a deleted branch must not comment or raise a hand");
      eq(opts.state["17"], undefined, "a deleted branch must not be remembered");
      wtClean(fx);
    });

    await check("T18 a branch that already holds mainline and current derived files is skipped and does NOT use a --max slot", async () => {
      const fx = fixture();
      pr(fx, "mac/m", { "src/b.txt": "pr work\n" });
      mainline(fx, { "src/c.txt": "main work\n" });
      g(fx.work, ["checkout", "-q", "mac/m"]);
      g(fx.work, ["merge", "-q", "--no-edit", "-m", "mainline in", `origin/${MAIN}`]);
      g(fx.work, ["push", "-q", "origin", "mac/m"]);
      g(fx.work, ["checkout", "-q", MAIN]);
      const old = remoteHead(fx, "mac/m");
      const { opts, calls } = optsFor(fx, "mac/m", 18, { writers: [WRITE_NOTHING, WRITE_NOTHING, WRITE_NOTHING] });
      const r = await refreshOne(opts);
      eq(r.outcome, "skipped", `outcome (${r.reason})`);
      eq(r.reached, false, "an up-to-date branch must not count toward --max");
      eq(remoteHead(fx, "mac/m"), old, "remote moved");
      eq(calls.hands.length + calls.comments.length, 0, "a skip must not comment or raise a hand");
      wtClean(fx);
    });

    await check("T19 hygiene: tokens never reach PR code; a folder inside another checkout is not a refresh worktree; the lock is adopted by the child's pid", async () => {
      const e = prEnv({ GH_TOKEN: "x", GITHUB_TOKEN: "y", ANTHROPIC_API_KEY: "z", PATH: "/bin" });
      eq(JSON.stringify(e), '{"PATH":"/bin"}', "prEnv kept only the non-secret");
      const fx = fixture();
      pr(fx, "mac/n", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const old = remoteHead(fx, "mac/n");
      const inside = join(fx.work, "not-a-worktree");
      mkdirSync(inside);
      const r = await refreshOne(optsFor(fx, "mac/n", 19, { worktree: inside }).opts);
      eq(r.outcome, "skipped", `outcome (${r.reason})`);
      yes(r.reason.includes("not its own git worktree"), `reason: ${r.reason}`);
      eq(remoteHead(fx, "mac/n"), old, "remote moved");
      eq(g(fx.work, ["rev-parse", "--abbrev-ref", "HEAD"]), MAIN, "the enclosing checkout was switched");
      const cache = join(root, "adoptcache");
      mkdirSync(join(cache, "lock"), { recursive: true });
      writeFileSync(join(cache, "lock", "pid"), "999999");
      adoptLock(cache);
      eq(readFileSync(join(cache, "lock", "pid"), "utf8"), String(process.pid), "the lock should name the process doing the work");
    });

    await check("T20 tokens are scrubbed from every env PR code runs under: writers, quick gates, preflight, breadth and the dependency install", async () => {
      const fx = fixture();
      pr(fx, "mac/o", { [A1]: "coverage pr\n" });
      mainline(fx, { [A1]: "coverage main\n" });
      const had = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
      process.env.GH_TOKEN = "secret";
      process.env.GITHUB_TOKEN = "secret";
      try {
        const noToken = stub("process.exit(process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? 1 : 0)");
        let depsEnv = null;
        const { opts } = optsFor(fx, "mac/o", 20, {
          writers: [WRITE_MANIFEST, noToken, WRITE_COVERAGE], quickGates: [noToken], preflight: noToken, breadth: noToken,
          deps: (_wt, _log, env) => { depsEnv = env; return { ok: true, env: {} }; },
        });
        const r = await refreshOne(opts);
        eq(r.outcome, "refreshed", `a stage still saw a token (${r.reason})`);
        yes(depsEnv && !("GH_TOKEN" in depsEnv) && !("GITHUB_TOKEN" in depsEnv), "deps was handed an env that still holds a token");
      } finally {
        for (const [k, v] of Object.entries(had)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      }
    });
  } finally {
    Object.keys(process.env).forEach((k) => { if (!(k in savedEnv)) delete process.env[k]; });
    Object.assign(process.env, savedEnv);
    rmSync(root, { recursive: true, force: true });
  }

  for (const [name, ok, why] of results) console.log(`  ${ok ? "ok" : "FAIL"} — ${name}${ok ? "" : `\n         ${why}`}`);
  const passed = results.filter((r) => r[1]).length;
  console.log(`\nself-test ${passed === results.length ? "passed" : "FAILED"} (${passed}/${results.length})`);
  return passed === results.length ? 0 : 1;
}

async function main() {
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[k]; // every git call here names its own directory
  const a = parseArgs(process.argv.slice(2));
  if (a.error) { console.error(`pr-refresh: ${a.error}\nusage: pr-refresh.mjs [--max N] [--pr N] | --dry-run [--pr N] | --self-test`); return 2; }
  if (a.selfTest) return selfTest();
  if (a.dryRun) return dryRun(a);
  return realRun(a);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
