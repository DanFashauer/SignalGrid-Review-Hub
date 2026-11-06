#!/usr/bin/env node
// brain-proposal-pr.mjs — publish ONE finished local-brain build as a GitHub PR (owner order,
// Dan, 2026-11-02: "Build the Mac route").
//
//   node scripts/mac/brain-proposal-pr.mjs --job <id> [--db <sqlite>]           # dry run (default)
//   node scripts/mac/brain-proposal-pr.mjs --job <id> --publish                  # push brain/job-<id> + open PR
//   node scripts/mac/brain-proposal-pr.mjs --list-review [--db <sqlite>]         # ids of publishable review builds
//   node scripts/mac/brain-proposal-pr.mjs --self-test
//
// The local brain (~/SignalGrid-Local-AI, not a git repo) runs build jobs in isolated worktrees
// and leaves its edits UNCOMMITTED there, on an old base. This route reads the job from the
// brain's SQLite DB READ-ONLY, takes the worktree's diff against its own HEAD (untracked files
// via a TEMP index — the brain worktree is never mutated), refuses anything governance- or
// decision-shaped, replays the patch onto a fresh origin/SignalGrid_Alpha in a scratch worktree
// with `git apply --3way --index`, and — only with --publish — pushes brain/job-<id> and opens a
// PR. Codex and Claude review on the PR; the lane lands it under DR-037. No auto-merge.
//
// REFUSES (exit 1): a job that is not kind=build, status=review, repo=SignalGrid-Review-Hub with
// a worktree; an empty diff; a changed path that classifyDiff calls OWNER_RESERVED or
// DECISION_PATH; a path in DENY (governance text classifyDiff calls autonomous — AGENTS.md was
// checked on 2026-11-02 and is); a path outside the repo or under artifacts/agent-heartbeats/; a
// patch that does not apply cleanly; a title/result naming a private path (it goes in a public
// PR body); and SAFETY_MACHINERY (scripts/**, workflows, fixtures) too — a local-brain build
// never changes the gates that judge it through this route.
//
// CONTENT SCAN (owner condition for unattended publishing, Dan 2026-11-06): the exact patch is
// scanned before ANY push — every added line, every new file's full content, the commit message
// and the title/result that go into the public PR body — for private notes/vault markers, personal
// paths, secrets and non-allowlisted e-mail addresses. Binary files are refused outright. Any hit,
// any scanner error, an unreadable file, or a job with no recorded change set is a REFUSAL (exit 1,
// nothing pushed). Only the files the job's record names are ever added (see changeSetOf).
//
// NOT a gate. --publish needs network and an authenticated gh (run sandbox-off).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";
import { classifyDiff } from "../check-owner-gated-surfaces.mjs";
import { scratchGitOk, scrubProcessGitEnv } from "../lib/scratch-git.mjs";
import { isMainModule } from "../lib/is-main.mjs";
import { CONTENT_RULES } from "../publication-boundary.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "SignalGrid_Alpha";
const DEFAULT_DB = join(homedir(), "SignalGrid-Local-AI", "brain-state", "autonomy.sqlite3");
const DENY = [/^AGENTS\.md$/, /^CLAUDE\.md$/, /^docs\/DECISION_RECORDS\.md$/, /^\.github\//, /^docs\/PURPOSE\.md$/, /^artifacts\/agent-heartbeats\//];
const PRIVATE = /\/Users\/|~\/|SignalGrid-Local-AI|brain-state|brain-worktrees|\/private\/|\/var\/folders\//;
const TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";

class Refusal extends Error {}
const refuse = (m) => { throw new Refusal(m); };

/** Every git call goes through here; the self-test injects -c overrides via GIT_EXTRA. */
let GIT_EXTRA = [];
function git(dir, args, env) {
  const r = spawnSync("git", ["-C", dir, ...GIT_EXTRA, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 120000, maxBuffer: 64 << 20 });
  return { ok: !r.error && r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "") + (r.error ? r.error.message : "") };
}
function gitOk(dir, args, env) {
  const r = git(dir, args, env);
  if (!r.ok) throw new Error(`git ${args.join(" ")} failed: ${r.err.trim()}`);
  return r.out;
}

// The brain's job record has no documented structured change-set column (this repo only ever reads
// id/kind/status/repo/worktree/title/result/updated_at). If a later brain adds one under one of these
// names it is honoured; otherwise changeSetOf() falls back to the paths the result text names.
const CHANGE_SET_COLUMNS = ["changed_files", "files_changed", "change_set", "changeset"];

async function readJob(db, id) {
  if (!existsSync(db)) refuse(`brain DB not found: ${db}`);
  const base = "SELECT id, kind, status, repo, worktree, title, result, updated_at";
  const tail = " FROM autonomy_jobs WHERE id = ?";
  if (isBuiltin("node:sqlite")) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(db, { readOnly: true });
    try {
      const col = d.prepare("PRAGMA table_info(autonomy_jobs)").all().map((r) => String(r.name)).find((n) => CHANGE_SET_COLUMNS.includes(n));
      return d.prepare(`${base}${col ? `, ${col} AS change_set` : ""}${tail}`).get(id) ?? null;
    } finally { d.close(); }
  }
  // ponytail: CLI fallback only for a Node without node:sqlite; id is already [A-Za-z0-9_-].
  const cli = (sql) => spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", `file:${db}?mode=ro`, sql], { encoding: "utf8" });
  const info = cli("PRAGMA table_info(autonomy_jobs)");
  if (info.status !== 0) refuse(`sqlite3 could not read ${db}: ${info.stderr.trim()}`);
  const col = JSON.parse(info.stdout || "[]").map((r) => String(r.name)).find((n) => CHANGE_SET_COLUMNS.includes(n));
  const r = cli(`${base}${col ? `, ${col} AS change_set` : ""}${tail.replace("?", `'${id}'`)}`);
  if (r.status !== 0) refuse(`sqlite3 could not read ${db}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout || "[]")[0] ?? null;
}

/** Ids the Mac tick may publish: the publishable shape run() checks first, read-only, oldest first.
 *  (2026-11-06: #1885 sat at status=review until a person ran this script; lane-tick.sh step d3.) */
export async function listReview(db = DEFAULT_DB) {
  if (!existsSync(db)) refuse(`brain DB not found: ${db}`);
  const sql = "SELECT id FROM autonomy_jobs WHERE kind = 'build' AND status = 'review' AND repo = 'SignalGrid-Review-Hub' AND worktree IS NOT NULL ORDER BY updated_at, id";
  if (isBuiltin("node:sqlite")) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(db, { readOnly: true });
    try { return d.prepare(sql).all().map((r) => String(r.id)); } finally { d.close(); }
  }
  const r = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", `file:${db}?mode=ro`, sql], { encoding: "utf8" });
  if (r.status !== 0) refuse(`sqlite3 could not read ${db}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout || "[]").map((row) => String(row.id));
}

const decode = (s) => { try { const v = JSON.parse(s); return typeof v === "string" ? v : s; } catch { return s ?? ""; } };

/** Repo-relative, no traversal, no option-looking names, no control characters. */
const safeRel = (f) => typeof f === "string" && f.length > 0 && f.length < 512 && !f.startsWith("/") && !f.startsWith("-") && !f.split("/").includes("..") && !/[\0-\x1f]/.test(f);

/** The files this job's record says it changed. A structured column wins; otherwise the repo-relative
 *  paths the result text names in backticks. Empty means the record lacks a list: the caller refuses. */
export function changeSetOf(job, result) {
  const out = new Set();
  const raw = job.change_set;
  if (raw !== undefined && raw !== null && String(raw).trim()) {
    let list;
    try { const v = JSON.parse(String(raw)); list = Array.isArray(v) ? v : String(raw).split(/[\n,]/); } catch { list = String(raw).split(/[\n,]/); }
    for (const f of list) { const t = String(f).trim(); if (safeRel(t)) out.add(t); }
    return out;
  }
  for (const m of String(result).matchAll(/`([A-Za-z0-9_@.][A-Za-z0-9_@./-]*)`/g)) if (safeRel(m[1])) out.add(m[1]);
  return out;
}

/** The worktree's uncommitted change for the NAMED files only, without touching its index. Untracked
 *  files are discovered by name (content unread) and added only if named; everything else is counted
 *  and left out. */
function worktreePatch(wt, named) {
  const tmp = mkdtempSync(join(tmpdir(), "brain-idx-"));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    gitOk(wt, ["read-tree", "HEAD"], env);
    const tracked = gitOk(wt, ["diff", "--no-renames", "--name-only", "-z", "HEAD"], env).split("\0").filter(Boolean);
    const untracked = gitOk(wt, ["ls-files", "--others", "--exclude-standard", "-z"], env).split("\0").filter(Boolean);
    const everything = [...new Set([...tracked, ...untracked])];
    const keep = everything.filter((f) => named.has(f));
    const leftOut = everything.length - keep.length;
    if (keep.length === 0) return { patch: "", files: [], leftOut };
    const spec = keep.map((f) => `:(literal)${f}`);
    const addable = untracked.filter((f) => named.has(f)).map((f) => `:(literal)${f}`);
    if (addable.length) gitOk(wt, ["add", "-N", "--", ...addable], env);
    const patch = gitOk(wt, ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-renames", "HEAD", "--", ...spec], env);
    const files = gitOk(wt, ["diff", "--no-renames", "--name-only", "-z", "HEAD", "--", ...spec], env).split("\0").filter(Boolean);
    return { patch, files, leftOut };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ── content scan ────────────────────────────────────────────────────────────────────────────────
// Reuses the repo's own shapes: PRIVATE above, publication-boundary.mjs CONTENT_RULES (credential in
// URL, authenticated git remote, scraped page), and the gitleaks default families .gitleaks.toml
// extends. Findings carry rule + location only, NEVER the matched text (a log line is itself a leak).
// /home/runner/ and /home/user/ are the repo's documented CI/sandbox paths and are the only /home exceptions.
const SCAN_RULES = [
  { id: "private-path", re: PRIVATE },
  { id: "personal-path-users", re: /\/Users\/[^\s/"'`]+\// },
  { id: "personal-path-home", re: /\/home\/(?!(?:runner|user)\/)[^\s/"'`]+\// },
  { id: "personal-path-library", re: /~\/Library|\/Library\/(?:Mobile Documents|Application Support|Containers|Group Containers)/ },
  { id: "icloud", re: /iCloud|Mobile Documents|com~apple~CloudDocs/i },
  { id: "obsidian-vault", re: /\.obsidian\b|\bobsidian\b|knowledge-mirror|reference\/knowledge/i },
  { id: "obsidian-wikilink", re: /\[\[[A-Za-z0-9][^\]\n]*\]\]/, mdOnly: true },
  { id: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { id: "api-key-sk", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { id: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: "aws-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { id: "secret-assignment", re: /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)\b["']?\s*[:=]\s*["']?(?![$<{%*]|process\.env|env\.)[^\s"'`,;)]{16,}/i },
  { id: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, allow: /^(?:noreply@anthropic\.com|noreply@github\.com|git@github\.com|[0-9]+\+?[A-Za-z0-9-]*@users\.noreply\.github\.com|[^@]+@(?:example\.(?:com|org|net)|[A-Za-z0-9.-]*\.(?:example|test|invalid|localhost)))$/i },
  ...CONTENT_RULES.map((r) => ({ id: `boundary-${r.id}`, re: r.pattern })),
];

/** Scan one line. Returns the rule ids that hit; never the text. */
export function scanLine(line, path = "") {
  const hits = [];
  for (const r of SCAN_RULES) {
    if (r.mdOnly && !/\.(?:md|markdown|mdx)$/i.test(path)) continue;
    if (r.allow) {
      let bad = false;
      for (const m of line.matchAll(r.re)) if (!r.allow.test(m[0])) { bad = true; break; }
      if (bad) hits.push(r.id);
    } else if (r.re.test(line)) hits.push(r.id);
  }
  return hits;
}

/** Scan prose that goes into the public PR/commit (title, result, commit message). */
export function scanProse(label, text) {
  const out = [];
  String(text).split("\n").forEach((l, i) => { for (const id of scanLine(l, "x.md")) out.push(`${label}:${i + 1} ${id}`); });
  return out;
}

/** Scan a unified diff (git diff --binary output). Added lines and file names only; binaries refused. */
export function scanPatch(patch) {
  const out = [];
  if (patch.includes("\0")) out.push("patch: NUL byte (binary content)");
  let file = "", inHunk = false, lineNo = 0;
  for (const l of patch.split("\n")) {
    if (l.startsWith("diff --git ")) {
      inHunk = false; file = l.slice(l.lastIndexOf(" b/") + 3);
      for (const id of scanLine(l, file)) out.push(`${file}: path ${id}`);
      continue;
    }
    if (!inHunk) {
      if (l.startsWith("@@")) { inHunk = true; lineNo = Number((/\+(\d+)/.exec(l) ?? [0, 0])[1]) - 1; continue; }
      if (l === "GIT binary patch" || l.startsWith("Binary files ")) out.push(`${file}: binary file refused`);
      if (l.startsWith("new file mode 120000") || l.startsWith("new mode 120000")) out.push(`${file}: symlink refused`);
      continue;
    }
    if (l.startsWith("+")) {
      lineNo++;
      for (const id of scanLine(l.slice(1), file)) out.push(`${file}:${lineNo} ${id}`);
    } else if (l.startsWith(" ")) lineNo++;
  }
  return out;
}

/** gitleaks, when installed, over ONLY the changed files' content copied to a temp dir, with the repo's
 *  own config. Absent: skipped (the built-in rules above are the floor). Present but erroring: refuse. */
function gitleaksScan(wt, files, log) {
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  if (probe.error && probe.error.code === "ENOENT") { log("gitleaks not installed: built-in content scan only"); return []; }
  const dir = mkdtempSync(join(tmpdir(), "brain-gl-"));
  try {
    for (const f of files) {
      const src = join(wt, f);
      if (!existsSync(src)) continue;
      const dst = join(dir, f);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, readFileSync(src));
    }
    const cfg = join(REPO, ".gitleaks.toml");
    const r = spawnSync("gitleaks", ["detect", "--no-git", "--no-banner", "--redact", "--exit-code", "1", "--source", dir, ...(existsSync(cfg) ? ["--config", cfg] : [])], { encoding: "utf8", timeout: 120000 });
    if (r.error) return [`gitleaks could not run: ${r.error.message}`];
    if (r.status === 0) return [];
    if (r.status === 1) return ["gitleaks: leak finding(s) in the changed files"];
    return [`gitleaks exited ${r.status} (scanner error)`];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Fail-closed scan of exactly what is about to go out: the commit just made in the scratch worktree
 *  (HEAD^..HEAD) and its message. Throws Refusal on any hit or any error. `scanner` is injectable for
 *  the self-test. */
function scanOutgoing(wt, log, scanner = scanPatch) {
  let hits;
  try {
    const patch = gitOk(wt, ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-renames", "HEAD^", "HEAD"]);
    const nums = gitOk(wt, ["diff", "--numstat", "--no-renames", "HEAD^", "HEAD"]);
    if (!patch.trim()) throw new Error("outgoing patch is empty");
    hits = [...scanner(patch), ...scanProse("commit-message", gitOk(wt, ["log", "-1", "--format=%B"]))];
    for (const row of nums.split("\n")) if (/^-\t-\t/.test(row)) hits.push(`${row.split("\t")[2]}: binary file refused`);
    const names = gitOk(wt, ["diff", "--name-only", "-z", "--no-renames", "HEAD^", "HEAD"]).split("\0").filter(Boolean);
    hits.push(...gitleaksScan(wt, names, log));
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse(`content scan could not complete (${e.message.split("\n")[0]}); nothing is published unscanned`);
  }
  if (hits.length) refuse(`content scan blocked publication (${hits.length} finding(s); text withheld on purpose):\n${hits.slice(0, 20).map((h) => `  ${h}`).join("\n")}`);
}

export async function run({ job, db = DEFAULT_DB, repo = REPO, publish = false, log = console.log, scanner }) {
  if (!/^[A-Za-z0-9_-]+$/.test(job ?? "")) refuse("--job <id> is required (letters, digits, - and _ only); there is no auto-selection");
  const j = await readJob(db, job);
  if (!j) refuse(`job ${job} not found in the brain DB`);
  const want = { kind: "build", status: "review", repo: "SignalGrid-Review-Hub" };
  for (const [k, v] of Object.entries(want)) if (j[k] !== v) refuse(`job ${job} has ${k}=${j[k]}; only ${k}=${v} is publishable`);
  if (!j.worktree || !existsSync(j.worktree)) refuse(`job ${job} has no worktree on disk`);
  const title = String(j.title ?? "").trim();
  const result = decode(j.result).trim();
  const proseHits = [...scanProse("title", title), ...scanProse("result", result)];
  if (proseHits.length) refuse(`job ${job} title/result carries private or secret-shaped content; it would land in a public PR body (text withheld):\n${proseHits.slice(0, 20).map((h) => `  ${h}`).join("\n")}`);

  // Only files the job's own record names are ever read into a patch; with no list, nothing is published.
  const named = changeSetOf(j, result);
  if (named.size === 0) refuse(`job ${job}: the job record names no changed files (no change-set column, no backticked repo paths in the result); refusing rather than adding the whole worktree`);
  let patch, files, leftOut;
  try { ({ patch, files, leftOut } = worktreePatch(j.worktree, named)); }
  catch (e) { refuse(`job ${job}: could not read the worktree change (${String(e.message).split("\n")[0]}); nothing is published unscanned`); }
  if (leftOut) log(`${leftOut} changed file(s) in the worktree are not in the job's recorded change set and were left out`);
  if (!patch.trim() || files.length === 0) refuse(`job ${job}: the recorded change set matches an empty worktree diff`);
  const early = scanPatch(patch);
  if (early.length) refuse(`job ${job}: content scan blocked publication (${early.length} finding(s); text withheld on purpose):\n${early.slice(0, 20).map((h) => `  ${h}`).join("\n")}`);
  const bad = [];
  for (const f of files) {
    if (f.startsWith("/") || f.split("/").includes("..")) bad.push(`${f} (outside the repo)`);
    if (DENY.some((re) => re.test(f))) bad.push(`${f} (governance/heartbeat deny list)`);
  }
  const cls = classifyDiff(files);
  for (const m of cls.matched) bad.push(`${m.file} (${m.category}: ${m.rule})`);
  log(`job ${job}: ${title}`);
  log(`files (${files.length}):\n${files.map((f) => `  ${f}`).join("\n")}`);
  log(`classification: ${cls.tier}${cls.matched.map((m) => `\n  ${m.category} ${m.file} — ${m.rule}`).join("")}`);
  if (bad.length) refuse(`job ${job} touches paths this route never publishes:\n${bad.map((b) => `  ${b}`).join("\n")}`);

  const branch = `brain/job-${job}`;
  if (publish) {
    const remote = gitOk(repo, ["ls-remote", "origin", `refs/heads/${branch}`]).trim();
    if (remote) { log(`${branch} already exists on origin — nothing pushed (idempotent)`); return { branch, files, pushed: false }; }
  }

  gitOk(repo, ["fetch", "-q", "origin", BASE]);
  const scratch = mkdtempSync(join(tmpdir(), "brain-pr-"));
  const wt = join(scratch, "wt");
  gitOk(repo, ["worktree", "add", "-q", "--detach", wt, "FETCH_HEAD"]);
  try {
    const pf = join(scratch, "job.patch");
    writeFileSync(pf, patch);
    const ap = git(wt, ["apply", "--3way", "--index", pf]);
    const unmerged = git(wt, ["diff", "--name-only", "--diff-filter=U"]).out.trim();
    if (!ap.ok || unmerged) refuse(`job ${job}: the patch does not apply cleanly to origin/${BASE}\n${ap.err.trim()}${unmerged ? `\nunmerged: ${unmerged}` : ""}`);
    const prTitle = `brain: ${title.slice(0, 80)} (job ${job})`;
    gitOk(wt, ["commit", "-q", "-m", `${prTitle}\n\nLocal-brain build job ${job}, published by the Mac lane on the owner's order.\n\n${TRAILER}`]);
    // The last gate before the network: scan the commit itself. Nothing below this line runs on a hit or an error.
    scanOutgoing(wt, log, scanner);
    if (!publish) { log(`dry run: would push ${branch} and open "${prTitle}" against ${BASE}`); return { branch, files, pushed: false }; }

    gitOk(wt, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`]);
    const body = [
      "## Summary", "",
      `Local-brain build job \`${job}\` — "${title}". Published by the Mac lane on the owner's order (2026-11-02). It skips Codex's contained-checkpoint acceptance step: review on this PR is the acceptance.`, "",
      "## What changed", "", ...files.map((f) => `- \`${f}\``), "",
      "## Validation", "", "The job's own result, verbatim:", "", ...result.split("\n").map((l) => `> ${l}`), "",
      "Codex and Claude review on this PR; the lane lands it under DR-037.", "",
      "## Public-safety note", "", "The diff was refused if any file classified OWNER_RESERVED, DECISION_PATH or SAFETY_MACHINERY, or touched governance text (AGENTS.md, CLAUDE.md, decision records, PURPOSE, .github). No private path or brain state is included here beyond the job id and title.", "",
      "## Remaining risks", "", "The brain built on an older base; the patch was 3-way replayed onto the current base and has not run preflight here. CI on this PR is the first full run.", "",
      "🤖 Generated with [Claude Code](https://claude.com/claude-code)", "",
    ].join("\n");
    const bf = join(scratch, "body.md");
    writeFileSync(bf, body);
    const gh = spawnSync("gh", ["pr", "create", "--base", BASE, "--head", branch, "--title", prTitle, "--body-file", bf], { cwd: repo, encoding: "utf8" });
    if (gh.status !== 0) throw new Error(`pushed ${branch}, but gh pr create failed: ${(gh.stderr || gh.error?.message || "").trim()}`);
    log(gh.stdout.trim());
    return { branch, files, pushed: true };
  } finally {
    git(repo, ["worktree", "remove", "--force", wt]);
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function selfTest() {
  scrubProcessGitEnv();
  const root = mkdtempSync(join(tmpdir(), "brain-pr-st-"));
  const emptyCfg = join(root, "gitconfig");
  writeFileSync(emptyCfg, "");
  process.env.GIT_CONFIG_GLOBAL = emptyCfg;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  GIT_EXTRA = ["-c", "commit.gpgsign=false", "-c", "user.name=scratch", "-c", "user.email=scratch@invalid", "-c", "core.hooksPath=/dev/null"];
  let pass = 0, total = 0;
  const check = (name, ok) => { total++; if (ok) pass++; else console.error(`FAIL: ${name}`); };
  const quiet = () => {};
  const refused = async (name, args, needle) => {
    try { await run({ ...args, log: quiet }); check(`${name} (not refused)`, false); }
    catch (e) { check(`${name}: ${e.message.split("\n")[0]}`, e instanceof Refusal && e.message.includes(needle)); }
  };
  try {
    const origin = join(root, "origin.git"), repo = join(root, "repo"), seed = join(root, "seed");
    scratchGitOk(root, ["init", "-q", "--bare", origin]);
    scratchGitOk(root, ["init", "-q", "-b", BASE, seed]);
    mkdirSync(join(seed, "docs"));
    writeFileSync(join(seed, "docs/x.md"), "one\ntwo\nthree\n");
    writeFileSync(join(seed, "AGENTS.md"), "agents\n");
    scratchGitOk(seed, ["add", "."]);
    scratchGitOk(seed, ["commit", "-q", "-m", "base"]);
    scratchGitOk(seed, ["push", "-q", origin, BASE]);
    scratchGitOk(root, ["clone", "-q", "-b", BASE, origin, repo]);
    // A brain worktree: a clone of origin with an uncommitted edit.
    const brain = (name, edit) => {
      const w = join(root, name);
      scratchGitOk(root, ["clone", "-q", "-b", BASE, origin, w]);
      edit(w);
      return w;
    };
    const wDocs = brain("w-docs", (w) => { writeFileSync(join(w, "docs/x.md"), "one\nTWO\nthree\n"); writeFileSync(join(w, "docs/new.md"), "new\n"); });
    const wAgents = brain("w-agents", (w) => writeFileSync(join(w, "AGENTS.md"), "changed\n"));
    const wGate = brain("w-gate", (w) => { mkdirSync(join(w, "scripts"), { recursive: true }); writeFileSync(join(w, "scripts/check-x.mjs"), "gate\n"); });
    const wEmpty = brain("w-empty", () => {});
    const wConflict = brain("w-conflict", (w) => writeFileSync(join(w, "docs/x.md"), "one\nBRAIN\nthree\n"));

    // Content-scan fixtures. Every secret-shaped literal is ASSEMBLED at run time so this file never
    // contains one (the repo's own scanners read this file too). Each case adds ONE untracked file the
    // job's result names; the scan must refuse it with the named rule id.
    const J = (...p) => p.join("");
    const scanCases = [
      ["private-path", "docs/c1.md", J("see brain-", "state/autonomy\n")],
      ["personal-path-users", "docs/c2.md", J("path /Us", "ers/alice/notes\n")],
      ["personal-path-home", "docs/c3.md", J("path /ho", "me/alice/notes\n")],
      ["personal-path-library", "docs/c4.md", J("cp ~/Lib", "rary/Caches x\n")],
      ["icloud", "docs/c5.md", J("in Mobile Doc", "uments\n")],
      ["obsidian-vault", "docs/c6.md", J("open the .obs", "idian/ folder\n")],
      ["obsidian-wikilink", "docs/c7.md", J("see [[Private ", "Note]]\n")],
      ["private-key", "docs/c8.md", J("-----BEGIN RSA ", "PRIVATE KEY-----\nabc\n")],
      ["github-token", "docs/c9.md", J("t = ghp_", "A1b2".repeat(9), "\n")],
      ["github-token", "docs/c10.md", J("t = github_pat_", "A1b2C3d4E5".repeat(3), "\n")],
      ["api-key-sk", "docs/c11.md", J("k = sk-", "ab12".repeat(8), "\n")],
      ["slack-token", "docs/c12.md", J("x = xoxb-", "1234567890-abcdef\n")],
      ["aws-key", "docs/c13.md", J("AKIA", "IOSFODNN7EXAMPLE\n")],
      ["secret-assignment", "docs/c14.md", J("pass", "word = \"", "hunter2hunter2hunter2", "\"\n")],
      ["jwt", "docs/c15.md", J("eyJhbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "abcdefghijklmnop\n")],
      ["email", "docs/c16.md", J("contact dan", "@", "gmail.com\n")],
      ["boundary-credential_in_url", "docs/c17.md", J("https://u:p", "@", "prod.contoso.com/x\n")],
    ];
    const scanRows = [];
    for (const [rule, path, content] of scanCases) {
      const id = `jscan-${path.replace(/[^a-z0-9]/gi, "")}`;
      const w = brain(`w-${id}`, (d) => writeFileSync(join(d, path), content));
      scanRows.push([id, "build", "review", w, `Added \`${path}\`.`, rule, path]);
    }
    const wBin = brain("w-bin", (w) => writeFileSync(join(w, "docs/blob.bin"), Buffer.from([0, 1, 2, 255, 254])));
    const wClean = brain("w-clean", (w) => writeFileSync(join(w, "docs/clean.md"), J("Paths /home/", "user/x and /home/", "runner/work are CI paths.\nCo-Authored-By: Claude <noreply", "@", "anthropic.com>\nuser", "@", "example.com\n")));
    const wStray = brain("w-stray", (w) => {
      writeFileSync(join(w, "docs/ok.md"), "fine\n");
      writeFileSync(join(w, ".env"), J("KEY=AKIA", "IOSFODNN7EXAMPLE\n"));       // untracked, NOT in the change set
      writeFileSync(join(w, "docs/stray.md"), "stray\n");                         // untracked, NOT in the change set
      writeFileSync(join(w, "docs/x.md"), "one\nSTRAY\nthree\n");                 // tracked edit, NOT in the change set
    });
    const wNoSet = brain("w-noset", (w) => writeFileSync(join(w, "docs/ok2.md"), "fine\n"));
    const wNotGit = join(root, "w-notgit");
    mkdirSync(wNotGit);
    const wResult = brain("w-result", (w) => writeFileSync(join(w, "docs/r.md"), "fine\n"));

    const db = join(root, "autonomy.sqlite3");
    const rows = [
      ["jdocs", "build", "review", wDocs, "Edited `docs/x.md`, added `docs/new.md`."], ["jagents", "build", "review", wAgents, "Changed `AGENTS.md`."],
      ["jgate", "build", "review", wGate, "Added `scripts/check-x.mjs`."],
      ["jqueued", "build", "queued", wDocs, "Edited `docs/x.md`."], ["jempty", "build", "review", wEmpty, "Edited `docs/x.md`."],
      ["jconflict", "build", "review", wConflict, "Edited `docs/x.md`."],
      ...scanRows.map((r) => r.slice(0, 5)),
      ["jbin", "build", "review", wBin, "Added `docs/blob.bin`."],
      ["jclean", "build", "review", wClean, "Added `docs/clean.md`."],
      ["jstray", "build", "review", wStray, "Added `docs/ok.md`."],
      ["jnoset", "build", "review", wNoSet, "Added a doc, no list of files here."],
      ["jnotgit", "build", "review", wNotGit, "Added `docs/a.md`."],
      ["jresult", "build", "review", wResult, J("Added `docs/r.md`. Used key AKIA", "IOSFODNN7EXAMPLE.")],
    ];
    if (isBuiltin("node:sqlite")) {
      const { DatabaseSync } = await import("node:sqlite");
      const d = new DatabaseSync(db);
      d.exec("CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT)");
      const ins = d.prepare("INSERT INTO autonomy_jobs VALUES (?, ?, ?, 'SignalGrid-Review-Hub', ?, ?, ?, '2026-11-02')");
      for (const [id, k, s, w, res] of rows) ins.run(id, k, s, w, `title ${id}`, JSON.stringify(res));
      d.close();
    } else {
      const sql = ["CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT);",
        ...rows.map(([id, k, s, w, res]) => `INSERT INTO autonomy_jobs VALUES ('${id}','${k}','${s}','SignalGrid-Review-Hub','${w}','title ${id}','${res}','2026-11-02');`)].join("\n");
      const r = spawnSync("/usr/bin/sqlite3", [db], { input: sql, encoding: "utf8" });
      if (r.status !== 0) throw new Error(`sqlite3 fixture failed: ${r.stderr}`);
    }
    // Move origin past the conflicting job's base so its patch cannot apply.
    writeFileSync(join(seed, "docs/x.md"), "one\nORIGIN\nthree\n");
    scratchGitOk(seed, ["commit", "-q", "-am", "origin moves"]);
    scratchGitOk(seed, ["push", "-q", origin, BASE]);
    // Restore docs job fixture: it edits line 2 too — rebuild it on the moved base.
    rmSync(wDocs, { recursive: true, force: true });
    scratchGitOk(root, ["clone", "-q", "-b", BASE, origin, wDocs]);
    writeFileSync(join(wDocs, "docs/x.md"), "one\nORIGIN\nTHREE\n");
    writeFileSync(join(wDocs, "docs/new.md"), "new\n");

    // (1) dry run of a clean docs job
    const r1 = await run({ job: "jdocs", db, repo, log: quiet });
    check("(1) dry run names brain/job-jdocs with docs/x.md", r1.branch === "brain/job-jdocs" && r1.files.includes("docs/x.md") && r1.files.includes("docs/new.md") && !r1.pushed);
    check("(1) brain worktree untouched (edits still uncommitted, nothing staged)", scratchGitOk(wDocs, ["status", "--porcelain"]).split("\n").map((l) => l.trim()).sort().join("|") === "?? docs/new.md|M docs/x.md" && scratchGitOk(wDocs, ["diff", "--cached", "--name-only"]) === "");
    check("(1) dry run left no remote branch", scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jdocs"]) === "");
    // (2)-(5) refusals
    await refused("(2) AGENTS.md refused", { job: "jagents", db, repo }, "AGENTS.md");
    await refused("(2b) a gate change (SAFETY_MACHINERY) refused", { job: "jgate", db, repo }, "SAFETY_MACHINERY");
    await refused("(3) non-review job refused", { job: "jqueued", db, repo }, "status=queued");
    await refused("(4) empty diff refused", { job: "jempty", db, repo }, "empty");
    await refused("(5) non-applying patch refused", { job: "jconflict", db, repo }, "does not apply");
    await refused("(*) unknown job refused", { job: "nope", db, repo }, "not found");
    const listed = await listReview(db);
    check("(*) --list-review names every review build with a worktree and no queued job", listed.includes("jdocs") && listed.includes("jagents") && listed.includes("jempty") && !listed.includes("jqueued"));
    // (6) publish with a stubbed gh
    const bin = join(root, "bin"), ghLog = join(root, "gh.log");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\necho https://example.invalid/pr/1\n`);
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const r6 = await run({ job: "jdocs", db, repo, publish: true, log: quiet });
    const calls = ghCalls();
    check("(6) fresh publish pushed brain/job-jdocs", r6.pushed && scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jdocs"]) !== "");
    check("(6) gh called once with --base SignalGrid_Alpha", calls.length === 1 && calls[0].includes(`--base ${BASE}`) && calls[0].includes("--head brain/job-jdocs"));
    const r6b = await run({ job: "jdocs", db, repo, publish: true, log: quiet });
    check("(6) existing remote branch: exit clean, nothing pushed, gh not called again", !r6b.pushed && ghCalls().length === 1);
    // (7) content scan: every pattern class refused, and NOTHING reached origin or gh.
    const remoteBranches = () => scratchGitOk(repo, ["ls-remote", "--heads", "origin", "refs/heads/brain/*"]).split("\n").filter(Boolean).length;
    const before = remoteBranches(), ghBefore = ghCalls().length;
    for (const [rule, path] of scanCases.map(([r, p]) => [r, p])) {
      const id = `jscan-${path.replace(/[^a-z0-9]/gi, "")}`;
      await refused(`(7) scan refuses ${rule} (${path}) on --publish`, { job: id, db, repo, publish: true }, `content scan blocked publication`);
      await refused(`(7) scan names rule ${rule} (${path})`, { job: id, db, repo }, rule);
    }
    await refused("(7) binary file refused outright", { job: "jbin", db, repo, publish: true }, "binary file refused");
    await refused("(7) secret in the job's result refused (it lands in the public PR body)", { job: "jresult", db, repo, publish: true }, "aws-key");
    check("(7) no refused job pushed a branch or called gh", remoteBranches() === before && ghCalls().length === ghBefore);
    // (8) fail closed
    await refused("(8) a job record with no change set is refused, not 'git add -N .'", { job: "jnoset", db, repo, publish: true }, "names no changed files");
    await refused("(8) an unreadable worktree is refused", { job: "jnotgit", db, repo, publish: true }, "could not read the worktree");
    await refused("(8) a scanner that throws refuses (dry run)", { job: "jclean", db, repo, scanner: () => { throw new Error("boom"); } }, "could not complete");
    await refused("(8) a scanner that throws refuses (publish)", { job: "jclean", db, repo, publish: true, scanner: () => { throw new Error("boom"); } }, "could not complete");
    check("(8) scanner failures pushed nothing", remoteBranches() === before && ghCalls().length === ghBefore);
    // (9) a clean patch passes; the allowlisted CI paths and noreply addresses are not findings
    const r9 = await run({ job: "jclean", db, repo, log: quiet });
    check("(9) clean patch passes the scan (dry run)", r9.files.join() === "docs/clean.md" && !r9.pushed);
    check("(9) scanLine: noreply/example addresses and CI paths clean, a real address and a /Users path hit",
      scanLine(J("Co-Authored-By: Claude <noreply", "@", "anthropic.com>")).length === 0 && scanLine(J("/home/", "runner/work/x")).length === 0 &&
      scanLine(J("me", "@", "gmail.com")).join() === "email" && scanLine(J("/Us", "ers/bob/x")).includes("personal-path-users"));
    // (10) optional gitleaks: present and erroring or finding => refuse; present and clean => pass
    const glRc = join(root, "gl.rc");
    writeFileSync(join(bin, "gitleaks"), `#!/bin/sh\n[ "$1" = version ] && exit 0\nexit "$(cat '${glRc}')"\n`);
    chmodSync(join(bin, "gitleaks"), 0o755);
    writeFileSync(glRc, "2");
    await refused("(10) gitleaks scanner error refuses", { job: "jclean", db, repo }, "scanner error");
    writeFileSync(glRc, "1");
    await refused("(10) gitleaks finding refuses", { job: "jclean", db, repo }, "leak finding");
    writeFileSync(glRc, "0");
    check("(10) gitleaks clean passes", (await run({ job: "jclean", db, repo, log: quiet })).files.join() === "docs/clean.md");
    rmSync(join(bin, "gitleaks"));
    // (11) only the recorded change set is published: stray untracked files and an unlisted edit stay behind
    const r11 = await run({ job: "jstray", db, repo, publish: true, log: quiet });
    scratchGitOk(repo, ["fetch", "-q", "origin", "brain/job-jstray"]);
    const pushedFiles = scratchGitOk(repo, ["diff", "--name-only", "FETCH_HEAD~1", "FETCH_HEAD"]).trim();
    check("(11) untracked .env and unlisted edits outside the change set are not published", r11.pushed && pushedFiles === "docs/ok.md" && !scratchGitOk(repo, ["ls-tree", "-r", "--name-only", "FETCH_HEAD"]).includes(".env"));
    check("(11) the brain worktree still holds its unlisted files, untouched", existsSync(join(wStray, ".env")) && existsSync(join(wStray, "docs/stray.md")));
    check("(*) no scratch worktrees left registered", scratchGitOk(repo, ["worktree", "list"]).split("\n").length === 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
  if (pass !== total) { console.error(`self-test FAILED (${pass}/${total})`); process.exit(1); }
  console.log(`self-test passed (${pass}/${total})`);
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  try {
    if (a.includes("--self-test")) await selfTest();
    else if (a.includes("--list-review")) { for (const id of await listReview(opt("--db") ?? DEFAULT_DB)) console.log(id); }
    else await run({ job: opt("--job"), db: opt("--db") ?? DEFAULT_DB, publish: a.includes("--publish") });
  } catch (e) {
    console.error(e instanceof Refusal ? `REFUSED: ${e.message}` : `ERROR: ${e.message}`);
    process.exit(1);
  }
}
