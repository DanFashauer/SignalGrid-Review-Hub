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

async function readJob(db, id) {
  if (!existsSync(db)) refuse(`brain DB not found: ${db}`);
  const sql = "SELECT id, kind, status, repo, worktree, title, result, updated_at FROM autonomy_jobs WHERE id = ?";
  if (isBuiltin("node:sqlite")) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(db, { readOnly: true });
    try { return d.prepare(sql).get(id) ?? null; } finally { d.close(); }
  }
  // ponytail: CLI fallback only for a Node without node:sqlite; id is already [A-Za-z0-9_-].
  const r = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", `file:${db}?mode=ro`, sql.replace("?", `'${id}'`)], { encoding: "utf8" });
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

/** The worktree's uncommitted change, untracked files included, without touching its index. */
function worktreePatch(wt) {
  const tmp = mkdtempSync(join(tmpdir(), "brain-idx-"));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  try {
    gitOk(wt, ["read-tree", "HEAD"], env);
    gitOk(wt, ["add", "-N", "--", "."], env);
    const patch = gitOk(wt, ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-renames", "HEAD"], env);
    const files = gitOk(wt, ["diff", "--no-renames", "--name-only", "-z", "HEAD"], env).split("\0").filter(Boolean);
    return { patch, files };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

export async function run({ job, db = DEFAULT_DB, repo = REPO, publish = false, log = console.log }) {
  if (!/^[A-Za-z0-9_-]+$/.test(job ?? "")) refuse("--job <id> is required (letters, digits, - and _ only); there is no auto-selection");
  const j = await readJob(db, job);
  if (!j) refuse(`job ${job} not found in the brain DB`);
  const want = { kind: "build", status: "review", repo: "SignalGrid-Review-Hub" };
  for (const [k, v] of Object.entries(want)) if (j[k] !== v) refuse(`job ${job} has ${k}=${j[k]}; only ${k}=${v} is publishable`);
  if (!j.worktree || !existsSync(j.worktree)) refuse(`job ${job} has no worktree on disk`);
  const title = String(j.title ?? "").trim();
  const result = decode(j.result).trim();
  if (PRIVATE.test(title) || PRIVATE.test(result)) refuse(`job ${job} title/result names a private path; it would land in a public PR body`);

  const { patch, files } = worktreePatch(j.worktree);
  if (!patch.trim() || files.length === 0) refuse(`job ${job}: the worktree diff is empty`);
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

    const db = join(root, "autonomy.sqlite3");
    const rows = [
      ["jdocs", "build", "review", wDocs], ["jagents", "build", "review", wAgents], ["jgate", "build", "review", wGate],
      ["jqueued", "build", "queued", wDocs], ["jempty", "build", "review", wEmpty],
      ["jconflict", "build", "review", wConflict],
    ];
    if (isBuiltin("node:sqlite")) {
      const { DatabaseSync } = await import("node:sqlite");
      const d = new DatabaseSync(db);
      d.exec("CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT)");
      const ins = d.prepare("INSERT INTO autonomy_jobs VALUES (?, ?, ?, 'SignalGrid-Review-Hub', ?, ?, ?, '2026-11-02')");
      for (const [id, k, s, w] of rows) ins.run(id, k, s, w, `title ${id}`, JSON.stringify(`result ${id}`));
      d.close();
    } else {
      const sql = ["CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT);",
        ...rows.map(([id, k, s, w]) => `INSERT INTO autonomy_jobs VALUES ('${id}','${k}','${s}','SignalGrid-Review-Hub','${w}','title ${id}','result ${id}','2026-11-02');`)].join("\n");
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
