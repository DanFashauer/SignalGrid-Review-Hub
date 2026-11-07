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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync, readdirSync, realpathSync, symlinkSync, openSync, fstatSync, closeSync, constants } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
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
// Files that make `pnpm install` or git execute worker-authored code: never published by this route.
const EXEC_SURFACE = /(?:^|\/)(?:\.pnpmfile\.c?js|\.pnpmfile\.mjs|\.npmrc|\.yarnrc(?:\.yml)?|package\.json|pnpm-workspace\.yaml|\.gitattributes|\.gitmodules)$|^\.(?:githooks|husky)\//;
const TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";

class Refusal extends Error {}
const refuse = (m) => { throw new Refusal(m); };

/** Every git call goes through here; the self-test injects -c overrides via GIT_EXTRA. */
let GIT_EXTRA = [];
// Worker-controlled config and hooks must never run code around the scan: no fsmonitor program, no
// hooks (the repo's .githooks/pre-push runs `pnpm install`, which would load a worker-authored
// .pnpmfile.cjs / .npmrc from the scratch worktree AFTER the scan), no pager. -c outranks every config file.
const HARDEN = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat"];
/** Timeout for every external scanner / network helper; a timeout is a refusal, never a pass. */
const toMs = () => Number(process.env.SIGNALGRID_SCAN_TIMEOUT_MS) || 120000;
function git(dir, args, env) {
  const r = spawnSync("git", ["-C", dir, ...HARDEN, ...GIT_EXTRA, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 120000, maxBuffer: 64 << 20 });
  return { ok: !r.error && r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "") + (r.error ? r.error.message : "") };
}
function gitOk(dir, args, env) {
  const r = git(dir, args, env);
  // git's stderr routinely carries absolute paths (a worktree's `.git` file names its parent
  // repo): it is never put in a message that can reach a heartbeat or a PR. Subcommand name only.
  if (!r.ok) throw new Error(`git ${args[0]} failed`);
  return r.out;
}

/** Last line of defence for anything printed: absolute paths and home-relative paths become <path>. */
export function redact(s) {
  return String(s).replace(/(^|[\s(:'"=])(~|\/)[^\s:'")]*/g, (_m, pre) => `${pre}<path>`);
}

// The brain's job record has no documented structured change-set column (this repo only ever reads
// id/kind/status/repo/worktree/title/result/updated_at). If a later brain adds one under one of these
// names it is honoured; otherwise changeSetOf() falls back to the paths the result text names.
const CHANGE_SET_COLUMNS = ["changed_files", "files_changed", "change_set", "changeset"];

async function readJob(db, id) {
  if (!existsSync(db)) refuse("brain DB not found");
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
  const cli = (sql) => spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", `file:${db}?mode=ro`, sql], { encoding: "utf8", timeout: 30000 });
  const info = cli("PRAGMA table_info(autonomy_jobs)");
  if (info.status !== 0) refuse("sqlite3 could not read the brain DB");
  const col = JSON.parse(info.stdout || "[]").map((r) => String(r.name)).find((n) => CHANGE_SET_COLUMNS.includes(n));
  const r = cli(`${base}${col ? `, ${col} AS change_set` : ""}${tail.replace("?", `'${id}'`)}`);
  if (r.status !== 0) refuse("sqlite3 could not read the brain DB");
  return JSON.parse(r.stdout || "[]")[0] ?? null;
}

/** Ids the Mac tick may publish: the publishable shape run() checks first, read-only, oldest first.
 *  (2026-11-06: #1885 sat at status=review until a person ran this script; lane-tick.sh step d3.) */
export async function listReview(db = DEFAULT_DB) {
  if (!existsSync(db)) refuse("brain DB not found");
  const sql = "SELECT id FROM autonomy_jobs WHERE kind = 'build' AND status = 'review' AND repo = 'SignalGrid-Review-Hub' AND worktree IS NOT NULL ORDER BY updated_at, id";
  if (isBuiltin("node:sqlite")) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(db, { readOnly: true });
    try { return d.prepare(sql).all().map((r) => String(r.id)); } finally { d.close(); }
  }
  const r = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", `file:${db}?mode=ro`, sql], { encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) refuse("sqlite3 could not read the brain DB");
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

/** Local (repo/worktree-scope) git settings that make git run a program or change what it reads.
 *  `-c core.fsmonitor=false`, `--no-textconv` and `--no-ext-diff` already neutralise three of them;
 *  filters, includes, urls and the rest cannot all be neutralised by flags, so a worktree that carries
 *  any is refused outright. System and global config are the owner's own and are not inspected. */
const RISKY_CONFIG = /^(?:core\.(?:fsmonitor|hookspath|sshcommand|pager|editor|askpass|gitproxy|attributesfile)|diff\.external|diff\..+\.(?:textconv|command)|filter\..+|merge\..+\.driver|include\..+|includeif\..+|alias\..+|url\..+|credential\..+|gpg\..+|sequence\.editor|protocol\..+|http\..+|submodule\..+\.(?:update|url)|diff\.tool|merge\.tool|difftool\..+|mergetool\..+)$/;
function refuseExecutableConfig(wt) {
  const out = gitOk(wt, ["config", "--show-scope", "--list", "-z"]);
  const risky = [];
  // `-z --show-scope` prints scope NUL key NL value NUL, repeated.
  const tok = out.split("\0");
  for (let i = 0; i + 1 < tok.length; i += 2) {
    const scope = tok[i], rec = tok[i + 1], nl = rec.indexOf("\n");
    const key = (nl < 0 ? rec : rec.slice(0, nl)).toLowerCase(), value = nl < 0 ? "" : rec.slice(nl + 1);
    if (scope !== "local" && scope !== "worktree") continue;
    if (key === "core.fsmonitor" && (value === "false" || value === "")) continue;
    if (RISKY_CONFIG.test(key)) risky.push(key);
  }
  if (risky.length) refuse(`the brain worktree's local git config carries ${risky.length} executable setting(s) (${[...new Set(risky)].slice(0, 5).join(", ")}); refusing rather than running git against it`);
}

/** The worktree's uncommitted change for the NAMED files only, without touching its index. Untracked
 *  files are discovered by name (content unread) and added only if named; everything else is counted
 *  and left out. A NAMED untracked file is still refused when it is a dotfile (or under a dot
 *  directory), sits at the top level, or sits in a directory that holds no tracked file today: a new
 *  file in an existing directory is what a build does, a new top-level or hidden file is what a stray
 *  `.env` or a note dump looks like. Names are withheld from the message on purpose. */
function worktreePatch(wt, named) {
  refuseExecutableConfig(wt);
  const tmp = mkdtempSync(join(tmpdir(), "brain-idx-"));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  const NOFILTER = ["--no-ext-diff", "--no-textconv"];
  try {
    gitOk(wt, ["read-tree", "HEAD"], env);
    const tracked = gitOk(wt, ["diff", ...NOFILTER, "--no-renames", "--name-only", "-z", "HEAD"], env).split("\0").filter(Boolean);
    const untracked = gitOk(wt, ["ls-files", "--others", "--exclude-standard", "-z"], env).split("\0").filter(Boolean);
    const everything = [...new Set([...tracked, ...untracked])];
    const keep = everything.filter((f) => named.has(f));
    const leftOut = everything.length - keep.length;
    if (keep.length === 0) return { patch: "", files: [], leftOut };
    const namedUntracked = untracked.filter((f) => named.has(f));
    if (namedUntracked.length) {
      const dirsWithTracked = new Set(gitOk(wt, ["ls-files", "-z"], env).split("\0").filter(Boolean).map((f) => (f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "")));
      const stray = namedUntracked.filter((f) => !f.includes("/") || f.split("/").some((s) => s.startsWith(".")) || !dirsWithTracked.has(f.slice(0, f.lastIndexOf("/"))));
      if (stray.length) refuse(`${stray.length} named untracked file(s) are dotfiles, top-level, or in a directory with no tracked files; refusing (names withheld)`);
    }
    const spec = keep.map((f) => `:(literal)${f}`);
    const addable = namedUntracked.map((f) => `:(literal)${f}`);
    if (addable.length) gitOk(wt, ["add", "-N", "--", ...addable], env);
    const patch = gitOk(wt, ["diff", ...NOFILTER, "--binary", "--no-color", "--no-renames", "HEAD", "--", ...spec], env);
    const files = gitOk(wt, ["diff", ...NOFILTER, "--no-renames", "--name-only", "-z", "HEAD", "--", ...spec], env).split("\0").filter(Boolean);
    return { patch, files, leftOut };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ── content scan ────────────────────────────────────────────────────────────────────────────────
// Reuses the repo's own shapes: PRIVATE above, publication-boundary.mjs CONTENT_RULES (credential in
// URL, authenticated git remote, scraped page), and the gitleaks default families .gitleaks.toml
// extends. Findings carry rule + location only, NEVER the matched text (a log line is itself a leak).
// /home/runner and /home/user (exact segments) are the repo's documented CI/sandbox paths and are the
// only /home exceptions. `\b` is NOT used before key names: `_` is a word character, so `\b` cannot
// match inside AWS_SECRET_ACCESS_KEY; the lookbehind below is the anchor.
const NA = "(?<![A-Za-z0-9])";
const KEYWORD = "(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential)";
const ASSIGN = new RegExp(`${NA}[A-Za-z0-9_.-]*${KEYWORD}[A-Za-z0-9_]*["']?\\s*(?::=|=>|[:=])\\s*(["'\`]?)`, "gi");
const PLACEHOLDER = /^(?:[$<{%*(]|process\.|env\.|import\b|require\b|changeme|change[-_]me|x{3,}|\*{3,}|\.{3}|your[-_ ]|<|example|placeholder|redacted|dummy|sample|fake|todo|none$|null$|undefined$|true$|false$|string$|number$|secret$|password$|token$)/i;

/** secret-assignment: KEY-ish name, `:`/`=`, then a literal of 8+ chars. A quoted literal is judged by
 *  length; an unquoted one must also look like data (a digit or a symbol, no call/index syntax), so
 *  `token: string` and `password: z.string().min(8)` pass and DB_PASSWORD=Sup3rS3cretValue12345 does not. */
function secretAssignment(line) {
  for (const m of line.matchAll(ASSIGN)) {
    const q = m[1];
    const rest = line.slice(m.index + m[0].length);
    const value = q ? rest.split(q)[0] : (/^[^\s"'`,;]*/.exec(rest) ?? [""])[0];
    if (value.length < 8 || PLACEHOLDER.test(value)) continue;
    if (q) { if (!/\s/.test(value)) return true; continue; }
    if (!/[()[\]{}]/.test(value) && /[0-9/+!@#%^&]/.test(value)) return true;
  }
  return false;
}

const SCAN_RULES = [
  { id: "private-path", re: PRIVATE },
  { id: "personal-path-users", re: /(?<![A-Za-z0-9_.-])\/users\/(?![:{<$[])[^\s/"'`]+/i },
  { id: "personal-path-windows", re: /[A-Za-z]:[\\/]+users[\\/]|%USERPROFILE%|%HOMEPATH%|\$env:USERPROFILE/i },
  { id: "personal-path-home-var", re: /\$HOME(?![A-Za-z0-9_])|\$\{HOME\}|\$\{USERPROFILE\}/ },
  { id: "personal-path-home", re: /(?<![A-Za-z0-9_.-])\/home\/(?!(?:runner|user)(?![A-Za-z0-9._-]))[^\s/"'`]+/ },
  { id: "personal-path-root", re: /(?<![A-Za-z0-9_.-])\/root(?![A-Za-z0-9_.-])/ },
  { id: "personal-path-volumes", re: /(?<![A-Za-z0-9_.-])\/Volumes\//i },
  { id: "personal-path-library", re: /~\/Library|\/Library\/(?:Mobile Documents|Application Support|Containers|Group Containers)/ },
  { id: "ssh-path", re: /\.ssh\/(?:id_|authorized_keys|known_hosts)/ },
  { id: "icloud", re: /iCloud|Mobile Documents|com~apple~CloudDocs/i },
  { id: "obsidian-vault", re: /\.obsidian\b|\bobsidian\b|knowledge-mirror|reference\/knowledge/i },
  { id: "obsidian-trash", re: /(?:^|[^A-Za-z0-9_.-])\.trash(?:[\\/]|$)/ },
  { id: "obsidian-wikilink", re: /\[\[[^[\]\n]+\]\]/u },
  { id: "obsidian-comment", re: /%%[^%\n]+%%/ },
  { id: "obsidian-frontmatter", re: /^\s*(?:tags|aliases|cssclasses?)\s*:\s*\S/i, textOnly: true },
  { id: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/ },
  { id: "github-token", re: new RegExp(`${NA}gh[pousr]_[A-Za-z0-9]{20,}|${NA}github_pat_[A-Za-z0-9_]{20,}`) },
  { id: "api-key-sk", re: new RegExp(`${NA}sk-[A-Za-z0-9_-]{20,}`) },
  { id: "slack-token", re: new RegExp(`${NA}xox[abprs]-[A-Za-z0-9-]{10,}|hooks\\.slack\\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]+`) },
  { id: "aws-key", re: new RegExp(`${NA}(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])`) },
  { id: "jwt", re: new RegExp(`${NA}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`) },
  {
    // Common provider prefixes (the gitleaks default families, as one rule).
    id: "provider-token",
    re: new RegExp([
      `${NA}[spr]k_(?:live|test)_[A-Za-z0-9]{10,}`, `${NA}AIza[0-9A-Za-z_-]{30,}`, `${NA}ya29\\.[0-9A-Za-z_-]{20,}`, `${NA}glpat-[0-9A-Za-z_-]{16,}`,
      `${NA}npm_[A-Za-z0-9]{30,}`, `${NA}SG\\.[A-Za-z0-9_-]{16,}\\.[A-Za-z0-9_-]{16,}`, `${NA}shp(?:at|ca|pa|ss)_[a-f0-9]{32}`, `${NA}hf_[A-Za-z0-9]{30,}`,
      `${NA}do[por]_v1_[a-f0-9]{40,}`, `${NA}SK[0-9a-f]{32}(?![A-Za-z0-9])`, `AGE-SECRET-KEY-1[A-Z0-9]{20,}`, `${NA}pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}`,
      `AccountKey=[A-Za-z0-9+/=]{40,}`, `${NA}xapp-[0-9]-[A-Za-z0-9-]{20,}`,
    ].join("|")),
  },
  { id: "secret-assignment", fn: secretAssignment },
  { id: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, allow: /^(?:noreply@anthropic\.com|noreply@github\.com|git@github\.com|[0-9]+\+?[A-Za-z0-9-]*@users\.noreply\.github\.com|[^@]+@(?:(?:[A-Za-z0-9-]+\.)*example\.(?:com|org|net)|[A-Za-z0-9-]+\.(?:example|test|invalid|localhost)))$/i },
  ...CONTENT_RULES.map((r) => ({ id: `boundary-${r.id}`, re: r.pattern })),
];

/** Normal form scanned IN ADDITION to the raw line: NFKC, format characters (zero-width etc.) removed,
 *  percent-escapes decoded. Defeats a zero-width character inside a path and `%2F`-encoded paths; it does not defeat homoglyphs or base64. */
function normalForm(line) {
  let s = String(line).normalize("NFKC").replace(/\p{Cf}/gu, "");
  if (/%[0-9a-fA-F]{2}/.test(s)) { try { s = decodeURIComponent(s); } catch { /* keep the partly-decoded text out; raw is scanned anyway */ } }
  return s;
}

/** Scan one line. Returns the rule ids that hit; never the text. */
export function scanLine(line, path = "") {
  const hits = new Set();
  const forms = [...new Set([String(line), normalForm(line)])];
  for (const r of SCAN_RULES) {
    if (r.textOnly && !/\.(?:md|markdown|mdx|txt)$/i.test(path)) continue;
    for (const s of forms) {
      if (r.fn) { if (r.fn(s)) hits.add(r.id); continue; }
      if (r.allow) {
        for (const m of s.matchAll(r.re)) if (!r.allow.test(m[0])) { hits.add(r.id); break; }
      } else if (r.re.test(s)) hits.add(r.id);
    }
  }
  return [...hits];
}

/** Scan prose that goes into the public PR/commit (title, result, commit message). */
export function scanProse(label, text) {
  const out = [];
  String(text).split("\n").forEach((l, i) => { for (const id of scanLine(l, "x.md")) out.push(`${label}:${i + 1} ${id}`); });
  return out;
}

/** Walk a unified diff and yield every ADDED line with its file and new-side line number, plus
 *  header-level findings (binary, symlink). A line in a hunk that starts with "+" is added, whatever
 *  it says ("+++ x" inside a hunk is an added "++ x"). */
function* diffAdded(patch, headerHits) {
  let file = "", inHunk = false, lineNo = 0;
  for (const l of patch.split("\n")) {
    if (l.startsWith("diff --git ")) { inHunk = false; file = l.slice(l.lastIndexOf(" b/") + 3); yield { file, header: l }; continue; }
    if (!inHunk) {
      if (l.startsWith("@@")) { inHunk = true; lineNo = Number((/\+(\d+)/.exec(l) ?? [0, 0])[1]) - 1; continue; }
      if (l === "GIT binary patch" || l.startsWith("Binary files ")) headerHits.push(`${file}: binary file refused`);
      if (l.startsWith("new file mode 120000") || l.startsWith("new mode 120000")) headerHits.push(`${file}: symlink refused`);
      continue;
    }
    if (l.startsWith("+")) { lineNo++; yield { file, lineNo, text: l.slice(1) }; } else if (l.startsWith(" ")) lineNo++;
  }
}

/** Scan a unified diff (git diff --binary output). Added lines and file names only; binaries refused. */
export function scanPatch(patch) {
  const out = [];
  if (patch.includes("\0")) out.push("patch: NUL byte (binary content)");
  const fm = new Map(); // new markdown file -> front-matter state
  for (const e of diffAdded(patch, out)) {
    if (e.header !== undefined) { for (const id of scanLine(e.header, e.file)) out.push(`${e.file}: path ${id}`); continue; }
    for (const id of scanLine(e.text, e.file)) out.push(`${e.file}:${e.lineNo} ${id}`);
    // Obsidian front matter: a markdown file that OPENS with a --- block holding key: lines.
    if (/\.(?:md|markdown|mdx)$/i.test(e.file)) {
      const st = fm.get(e.file);
      if (e.lineNo === 1) fm.set(e.file, e.text.trim() === "---" ? "open" : "none");
      else if (st === "open") {
        if (e.text.trim() === "---") fm.set(e.file, "closed");
        else if (/^[A-Za-z_-]+\s*:/.test(e.text)) { out.push(`${e.file}:${e.lineNo} obsidian-frontmatter`); fm.set(e.file, "closed"); }
      }
    }
  }
  return out;
}

// ── provenance: does added text come FROM the owner's vault / knowledge corpus? ────────────────────
// Markers cannot recognise a private note (nothing in "felt anxious about the board" is a pattern).
// What can be recognised is that the text already exists in the owner's own notes. This runs on the
// Mac only (that is where the vault is). The vault is located from the Mac's own configuration, never
// from a path written in this repo: SIGNALGRID_VAULT_DIRS (path-delimited; when set it is the ONLY
// source), else Obsidian's own vault registry, else the sg-brain-link knowledge corpus under $HOME.
// For --publish, no resolvable directory, or any unreadable entry, is a refusal. Output is rule id +
// file:line only: never the matched text and never the vault path.
const VAULT_EXT = /\.(?:md|markdown|txt|org|canvas|json|csv|tsv|html?|ya?ml|rtf|xml|tex|log)$/i;
const SHINGLE_WORDS = 8, MIN_LINE_CHARS = 40, MIN_SHINGLE_CHARS = 30, MAX_VAULT_BYTES = 512 * 1024 * 1024;
const norm = (s) => s.toLowerCase().normalize("NFKC");
const wordsOf = (s) => norm(s).match(/[\p{L}\p{N}]+/gu) ?? [];
const normLine = (s) => norm(s).replace(/\s+/g, " ").trim();
/** cyrb53: fast 53-bit string hash (collisions only cause a false refusal, never a miss). */
function h53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const MISSING = (e) => e && (e.code === "ENOENT" || e.code === "ENOTDIR");

/** Read once, act on the bytes read: null when the file is absent, throw on anything else. No
 *  exists-then-read window (CodeQL js/file-system-race); the same shape as readIfPresent in loop-state.mjs. */
function readIfPresent(path) {
  try { return readFileSync(path, "utf8"); } catch (e) { if (MISSING(e)) return null; throw e; }
}

/** The vault/knowledge directories configured on this machine, as {path, explicit}. Existence is NOT
 *  checked here (a check followed by a separate use is a race); buildIndex opens each and treats a
 *  missing OPTIONAL one as absent and a missing EXPLICIT one as a refusal. Throws Refusal on a
 *  configured-but-broken registry. */
export function vaultDirs(env = process.env, home = homedir()) {
  const explicit = String(env.SIGNALGRID_VAULT_DIRS ?? "").split(delimiter).map((s) => s.trim()).filter(Boolean);
  if (explicit.length) return explicit.map((path) => ({ path, explicit: true }));
  const found = [];
  for (const reg of [join(home, "Library", "Application Support", "obsidian", "obsidian.json"), join(home, ".config", "obsidian", "obsidian.json")]) {
    let raw;
    try { raw = readIfPresent(reg); } catch { refuse("the Obsidian vault registry exists but cannot be read; refusing rather than guessing"); }
    if (raw === null) continue;
    let doc;
    try { doc = JSON.parse(raw); } catch { refuse("the Obsidian vault registry exists but cannot be read; refusing rather than guessing"); }
    for (const v of Object.values(doc?.vaults ?? {})) if (v && typeof v.path === "string") found.push(v.path);
  }
  found.push(join(home, "Library", "Mobile Documents", "com~apple~CloudDocs", "Documents", "SignalGrid"));
  return [...new Set(found)].map((path) => ({ path, explicit: false }));
}

/** Index the text files under the directories. Every file is opened ONCE and fstat/read go through that
 *  descriptor, so what is classified is what is read. O_NONBLOCK keeps a FIFO from hanging the open. */
function buildIndex(entries) {
  const lines = new Set(), shingles = new Set(), seen = new Set();
  let bytes = 0, walked = 0;
  const walk = (dir, top) => {
    const real = realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    for (const ent of top ?? readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === ".git" || ent.name === "node_modules") continue;
      const p = join(dir, ent.name);
      const fd = openSync(p, constants.O_RDONLY | constants.O_NONBLOCK); // follows symlinks; a dangling link throws and the caller refuses
      let text = null;
      try {
        const st = fstatSync(fd);
        if (st.isFile() && VAULT_EXT.test(ent.name)) {
          bytes += st.size;
          if (bytes > MAX_VAULT_BYTES) throw new Error("vault too large to index");
          text = readFileSync(fd, "utf8");
        } else if (!st.isDirectory()) continue;
      } finally { closeSync(fd); }
      if (text === null) { walk(p, undefined); continue; }
      for (const l of text.split("\n")) { const n = normLine(l); if (n.length >= MIN_LINE_CHARS) lines.add(h53(n)); }
      const w = wordsOf(text);
      for (let i = 0; i + SHINGLE_WORDS <= w.length; i++) { const s = w.slice(i, i + SHINGLE_WORDS).join(" "); if (s.length >= MIN_SHINGLE_CHARS) shingles.add(h53(s)); }
    }
  };
  for (const { path, explicit } of entries) {
    let top;
    try { top = readdirSync(path, { withFileTypes: true }); } catch (e) {
      if (!MISSING(e)) throw e;
      if (explicit) refuse("a directory named in SIGNALGRID_VAULT_DIRS does not exist");
      continue; // an optional source (registry entry, brain-link corpus) that is not on this machine
    }
    walk(path, top);
    walked++;
  }
  return { lines, shingles, walked };
}

/** Build the provenance checker once. `required` (publish): an unresolvable vault is a refusal; a dry
 *  run logs and skips. An unreadable entry refuses in both modes. Returns patch => findings. */
export function provenanceChecker({ required, log, env = process.env }) {
  let idx;
  try {
    idx = buildIndex(vaultDirs(env));
    if (idx.walked === 0) {
      if (required) refuse("provenance check cannot run: no vault or knowledge directory could be resolved on this machine (set SIGNALGRID_VAULT_DIRS); nothing is published unchecked");
      log("provenance check skipped (dry run): no vault directory resolved");
      return () => [];
    }
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse("provenance check could not read the vault or knowledge directory; nothing is published unchecked");
  }
  return (patch) => {
    const out = [], perFile = new Map();
    for (const e of diffAdded(patch, [])) {
      if (e.header !== undefined) continue;
      const n = normLine(e.text);
      if (n.length >= MIN_LINE_CHARS && idx.lines.has(h53(n))) out.push(`${e.file}:${e.lineNo} provenance-line`);
      const arr = perFile.get(e.file) ?? [];
      for (const w of wordsOf(e.text)) arr.push([w, e.lineNo]);
      perFile.set(e.file, arr);
    }
    for (const [file, arr] of perFile) {
      const done = new Set();
      for (let i = 0; i + SHINGLE_WORDS <= arr.length; i++) {
        const s = arr.slice(i, i + SHINGLE_WORDS).map((x) => x[0]).join(" ");
        if (s.length >= MIN_SHINGLE_CHARS && idx.shingles.has(h53(s)) && !done.has(arr[i][1])) { done.add(arr[i][1]); out.push(`${file}:${arr[i][1]} provenance-shingle`); }
      }
    }
    return out;
  };
}

/** gitleaks over ONLY the changed files' content copied to a temp dir, with the repo's own config.
 *  Installed but erroring or finding: refuse. Not installed: refuse when `required` (unattended
 *  publish: the built-in rules are the floor, not the whole check), else log and continue. */
const gitleaksBin = () => process.env.SIGNALGRID_GITLEAKS_BIN || "gitleaks"; // override: self-test stubs, or a pinned install
function gitleaksScan(wt, files, log, required) {
  const probe = spawnSync(gitleaksBin(), ["version"], { encoding: "utf8", timeout: toMs() });
  if (probe.error && probe.error.code === "ETIMEDOUT") return ["gitleaks timed out (scanner error)"];
  if (probe.error && probe.error.code !== "ENOENT") return ["gitleaks could not run (scanner error)"];
  if (probe.error && probe.error.code === "ENOENT") {
    if (required) return ["gitleaks is not installed (required for unattended publish; dry run may continue without it)"];
    log("gitleaks not installed: built-in content scan only (dry run)");
    return [];
  }
  const dir = mkdtempSync(join(tmpdir(), "brain-gl-"));
  try {
    for (const f of files) {
      let bytes;
      try { bytes = readFileSync(join(wt, f)); } catch (e) { if (MISSING(e)) continue; throw e; } // deleted file: nothing to scan
      const dst = join(dir, f);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, bytes);
    }
    const cfg = join(REPO, ".gitleaks.toml");
    const r = spawnSync(gitleaksBin(), ["detect", "--no-git", "--no-banner", "--redact", "--exit-code", "1", "--source", dir, ...(existsSync(cfg) ? ["--config", cfg] : [])], { encoding: "utf8", timeout: toMs() });
    if (r.error) return [r.error.code === "ETIMEDOUT" ? "gitleaks timed out (scanner error)" : "gitleaks could not run (scanner error)"];
    if (r.status === 0) return [];
    if (r.status === 1) return ["gitleaks: leak finding(s) in the changed files"];
    return [`gitleaks exited ${r.status} (scanner error)`];
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Fail-closed scan of exactly what is about to go out: the commit just made in the scratch worktree
 *  (HEAD^..HEAD) and its message. Throws Refusal on any hit or any error. `scanner` and `extra` (the
 *  provenance checker) are injectable for the self-test. */
function scanOutgoing(wt, log, { scanner = scanPatch, extra = () => [], publish = false } = {}) {
  let hits;
  const NOFILTER = ["--no-ext-diff", "--no-textconv"];
  try {
    const patch = gitOk(wt, ["diff", ...NOFILTER, "--binary", "--no-color", "--no-renames", "HEAD^", "HEAD"]);
    const nums = gitOk(wt, ["diff", ...NOFILTER, "--numstat", "--no-renames", "HEAD^", "HEAD"]);
    if (!patch.trim()) throw new Error("outgoing patch is empty");
    hits = [...scanner(patch), ...extra(patch), ...scanProse("commit-message", gitOk(wt, ["log", "-1", "--format=%B"]))];
    for (const row of nums.split("\n")) if (/^-\t-\t/.test(row)) hits.push(`${row.split("\t")[2]}: binary file refused`);
    const names = gitOk(wt, ["diff", ...NOFILTER, "--name-only", "-z", "--no-renames", "HEAD^", "HEAD"]).split("\0").filter(Boolean);
    hits.push(...gitleaksScan(wt, names, log, publish));
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse(`content scan could not complete (${redact(String(e.message).split("\n")[0])}); nothing is published unscanned`);
  }
  if (hits.length) refuse(`content scan blocked publication (${hits.length} finding(s); text withheld on purpose):\n${hits.slice(0, 20).map((h) => `  ${h}`).join("\n")}`);
}

export async function run({ job, db = DEFAULT_DB, repo = REPO, publish = false, log = console.log, scanner, hooks = {} }) {
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

  // Provenance index first: a vault that cannot be resolved or read refuses before anything else is read.
  const provenance = provenanceChecker({ required: publish, log });

  // Only files the job's own record names are ever read into a patch; with no list, nothing is published.
  const named = changeSetOf(j, result);
  if (named.size === 0) refuse(`job ${job}: the job record names no changed files (no change-set column, no backticked repo paths in the result); refusing rather than adding the whole worktree`);
  let patch, files, leftOut;
  try { ({ patch, files, leftOut } = worktreePatch(j.worktree, named)); }
  catch (e) {
    if (e instanceof Refusal) throw e;
    refuse(`job ${job}: could not read the worktree change (${redact(String(e.message).split("\n")[0])}); nothing is published unscanned`);
  }
  if (leftOut) log(`${leftOut} changed file(s) in the worktree are not in the job's recorded change set and were left out`);
  if (!patch.trim() || files.length === 0) refuse(`job ${job}: the recorded change set matches an empty worktree diff`);
  const early = [...scanPatch(patch), ...provenance(patch)];
  if (early.length) refuse(`job ${job}: content scan blocked publication (${early.length} finding(s); text withheld on purpose):\n${early.slice(0, 20).map((h) => `  ${h}`).join("\n")}`);
  const bad = [];
  for (const f of files) {
    if (EXEC_SURFACE.test(f)) bad.push(`${f} (install/hook/attribute surface: runs code on the next install or git operation)`);
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
  const base = gitOk(repo, ["rev-parse", "--verify", "FETCH_HEAD^{commit}"]).trim();
  const scratch = mkdtempSync(join(tmpdir(), "brain-pr-"));
  const wt = join(scratch, "wt");
  gitOk(repo, ["worktree", "add", "-q", "--detach", wt, base]);
  try {
    const pf = join(scratch, "job.patch");
    writeFileSync(pf, patch);
    const ap = git(wt, ["apply", "--3way", "--index", pf]);
    const unmerged = git(wt, ["diff", "--name-only", "--diff-filter=U"]).out.trim();
    if (!ap.ok || unmerged) refuse(`job ${job}: the patch does not apply cleanly to origin/${BASE}${unmerged ? `\nunmerged file(s): ${unmerged.split("\n").length}` : ""}`);
    const prTitle = `brain: ${title.slice(0, 80)} (job ${job})`;
    gitOk(wt, ["commit", "-q", "-m", `${prTitle}\n\nLocal-brain build job ${job}, published by the Mac lane on the owner's order.\n\n${TRAILER}`]);
    if (hooks.afterCommit) hooks.afterCommit(wt); // self-test only: lets a test add a second commit
    // What is pushed must be EXACTLY one commit on the base this run fetched, nothing else on the branch.
    if (gitOk(wt, ["rev-list", "--count", `${base}..HEAD`]).trim() !== "1" || gitOk(wt, ["rev-parse", "HEAD^"]).trim() !== base) refuse(`job ${job}: the branch to push is not exactly one commit on the fetched base; refusing`);
    // The last gate before the network: scan the commit itself. Nothing below this line runs on a hit or an error.
    scanOutgoing(wt, log, { scanner, extra: provenance, publish });
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
    const gh = spawnSync("gh", ["pr", "create", "--base", BASE, "--head", branch, "--title", prTitle, "--body-file", bf], { cwd: repo, encoding: "utf8", timeout: toMs() });
    if (gh.error?.code === "ETIMEDOUT") throw new Error(`pushed ${branch}, but gh pr create timed out`);
    if (gh.status !== 0) throw new Error(`pushed ${branch}, but gh pr create failed (exit ${gh.status ?? "none"})`);
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
    mkdirSync(join(seed, "scripts"));
    writeFileSync(join(seed, "scripts/keep.mjs"), "keep\n");
    writeFileSync(join(seed, "package.json"), "{}\n");
    writeFileSync(join(seed, ".gitattributes"), "# none\n");
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

    // The owner's "vault" for the provenance check, and a gitleaks stub (publish REQUIRES gitleaks).
    const vault = join(root, "vault");
    mkdirSync(vault);
    writeFileSync(join(vault, "note.md"), "# private\nDan's private reflections on the board meeting and the hiring decision last quarter.\nthe quick brown fox jumps over the lazy dog near the riverbank at dawn every single day\nshort line\n");
    process.env.SIGNALGRID_VAULT_DIRS = vault;
    const bin = join(root, "bin"), ghLog = join(root, "gh.log"), glRc = join(root, "gl.rc");
    mkdirSync(bin);
    writeFileSync(glRc, "0");
    const glStub = join(bin, "gitleaks-stub");
    writeFileSync(glStub, `#!/bin/sh\n[ "$1" = version ] && exit 0\nexit "$(cat '${glRc}')"\n`);
    chmodSync(glStub, 0o755);
    process.env.SIGNALGRID_GITLEAKS_BIN = glStub;

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
      ["secret-assignment", "docs/c18.md", J("AWS_SECRET_", "ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\n")],
      ["obsidian-wikilink", "docs/c19.txt", J("see [[ Health ", "Journal]]\n")],
      ["personal-path-users", "docs/c20.md", J("see /us", "ers/dan/Documents/Vault/Journal.md\n")],
      ["obsidian-frontmatter", "docs/c21.md", J("---\ntags: [pri", "vate]\n---\nbody\n")],
      ["provider-token", "docs/c22.md", J("k = sk_", "live_51H8abcdefghijklmnopqrstuv\n")],
      ["provenance-line", "docs/c23.md", "  DAN'S PRIVATE reflections on the board meeting   and the hiring decision last quarter.\n"],
      ["provenance-shingle", "docs/c24.md", "Intro text. Watch how it jumps over the lazy dog near the riverbank at midday.\n"],
      ["personal-path-home", "docs/c25.md", J("cd /ho", "me/dan\n")],
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
    const wDot = brain("w-dot", (w) => writeFileSync(join(w, ".env"), "A=b\n"));
    const wTop = brain("w-top", (w) => writeFileSync(join(w, "notes.md"), "fine\n"));
    const wNewdir = brain("w-newdir", (w) => { mkdirSync(join(w, "docs/newdir")); writeFileSync(join(w, "docs/newdir/a.md"), "fine\n"); });
    // A worktree whose .git FILE names a personal path (git's stderr would echo it into a message).
    const wGitdir = join(root, "w-gitdir");
    mkdirSync(wGitdir);
    writeFileSync(join(wGitdir, ".git"), J("gitdir: /Us", "ers/dan/SignalGrid-Local-AI/repos/hub/.git/worktrees/job-9\n"));
    // A worktree with a textconv diff driver that would run code on `git diff`.
    const textconvMarker = join(root, "textconv.ran"), textconvScript = join(root, "textconv.sh");
    writeFileSync(textconvScript, `#!/bin/sh\ntouch '${textconvMarker}'\ncat "$1"\n`);
    chmodSync(textconvScript, 0o755);
    const wTextconv = brain("w-textconv", (w) => {
      scratchGitOk(w, ["config", "diff.evil.textconv", textconvScript]);
      writeFileSync(join(w, ".gitattributes"), "*.md diff=evil\n");
      writeFileSync(join(w, "docs/tc.md"), "fine\n");
    });
    const wFsmon = brain("w-fsmon", (w) => { scratchGitOk(w, ["config", "core.fsmonitor", textconvScript]); writeFileSync(join(w, "docs/fs.md"), "fine\n"); });
    const wFilter = brain("w-filter", (w) => { scratchGitOk(w, ["config", "filter.evil.clean", textconvScript]); writeFileSync(join(w, "docs/fl.md"), "fine\n"); });
    const wPkg = brain("w-pkg", (w) => writeFileSync(join(w, "package.json"), '{"scripts":{"preinstall":"x"}}\n'));
    const wAttr = brain("w-attr", (w) => writeFileSync(join(w, ".gitattributes"), "*.md diff=evil\n"));
    const wHook = brain("w-hook", (w) => writeFileSync(join(w, "docs/hook.md"), "fine\n"));
    const wGh = brain("w-gh", (w) => writeFileSync(join(w, "docs/gh.md"), "fine\n"));
    const wTrash = brain("w-trash", (w) => writeFileSync(join(w, "docs/trash.md"), J("see .tra", "sh/old.md\n")));

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
      ["jdot", "build", "review", wDot, "Added `.env`."], ["jtop", "build", "review", wTop, "Added `notes.md`."],
      ["jnewdir", "build", "review", wNewdir, "Added `docs/newdir/a.md`."], ["jgitdir", "build", "review", wGitdir, "Added `docs/a.md`."],
      ["jtextconv", "build", "review", wTextconv, "Added `docs/tc.md`."],
      ["jfsmon", "build", "review", wFsmon, "Added `docs/fs.md`."], ["jfilter", "build", "review", wFilter, "Added `docs/fl.md`."],
      ["jpkg", "build", "review", wPkg, "Edited `package.json`."], ["jattr", "build", "review", wAttr, "Edited `.gitattributes`."],
      ["jhook", "build", "review", wHook, "Added `docs/hook.md`."], ["jgh", "build", "review", wGh, "Added `docs/gh.md`."],
      ["jtrash", "build", "review", wTrash, "Added `docs/trash.md`."],
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
    writeFileSync(join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${ghLog}'\n[ -e '${join(root, "gh.slow")}' ] && sleep 5\necho https://example.invalid/pr/1\n`);
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
    // (10) gitleaks: present and erroring or finding => refuse; clean => pass; ABSENT => publish refuses, dry run continues
    writeFileSync(glRc, "2");
    await refused("(10) gitleaks scanner error refuses", { job: "jclean", db, repo }, "scanner error");
    writeFileSync(glRc, "1");
    await refused("(10) gitleaks finding refuses", { job: "jclean", db, repo }, "leak finding");
    writeFileSync(glRc, "0");
    check("(10) gitleaks clean passes", (await run({ job: "jclean", db, repo, log: quiet })).files.join() === "docs/clean.md");
    process.env.SIGNALGRID_GITLEAKS_BIN = join(root, "no-such-dir", "gitleaks");
    await refused("(10) gitleaks absent: --publish refuses (H1)", { job: "jclean", db, repo, publish: true }, "gitleaks is not installed");
    check("(10) gitleaks absent: dry run may continue", (await run({ job: "jclean", db, repo, log: quiet })).files.join() === "docs/clean.md");
    process.env.SIGNALGRID_GITLEAKS_BIN = glStub;
    // (11) only the recorded change set is published: stray untracked files and an unlisted edit stay behind
    const r11 = await run({ job: "jstray", db, repo, publish: true, log: quiet });
    scratchGitOk(repo, ["fetch", "-q", "origin", "brain/job-jstray"]);
    const pushedFiles = scratchGitOk(repo, ["diff", "--name-only", "FETCH_HEAD~1", "FETCH_HEAD"]).trim();
    check("(11) untracked .env and unlisted edits outside the change set are not published", r11.pushed && pushedFiles === "docs/ok.md" && !scratchGitOk(repo, ["ls-tree", "-r", "--name-only", "FETCH_HEAD"]).includes(".env"));
    check("(11) the brain worktree still holds its unlisted files, untouched", existsSync(join(wStray, ".env")) && existsSync(join(wStray, "docs/stray.md")));
    // (12) H1 secrets: the keyword anchor must work after "_" (AWS_SECRET_ACCESS_KEY, DB_PASSWORD, ...)
    const hit = (line, rule, path = "x.ts") => scanLine(line, path).includes(rule);
    const clean = (line, path = "x.ts") => scanLine(line, path).length === 0;
    const AWSV = J("wJalrXUtnFEMI/K7MDENG/bP", "xRfiCYEXAMPLEKEY");
    check("(12) AWS_SECRET_ACCESS_KEY=... refused", hit(J("AWS_SECRET_", "ACCESS_KEY=", AWSV), "secret-assignment", "x.env"));
    check("(12) DB_PASSWORD=... refused", hit(J("DB_PASS", "WORD=Sup3rS3cretValue12345"), "secret-assignment"));
    check("(12) OPENAI_API_KEY=<32 hex> refused", hit(J("OPENAI_API", "_KEY=", "0123456789abcdef".repeat(2)), "secret-assignment"));
    check("(12) client_secret: \"...\" refused", hit(J("client_", "secret: \"abcd1234efgh\""), "secret-assignment"));
    check("(12) JSON \"aws_secret_access_key\": \"...\" refused", hit(J("\"aws_secret_", "access_key\": \"", AWSV, "\""), "secret-assignment", "x.json"));
    check("(12) short quoted password (11 chars) refused", hit(J("pass", "word = \"Tr0ub4dor&3\""), "secret-assignment"));
    check("(12) sk_live_ refused", hit(J("const k = 'sk_", "live_51H8abcdefghijklmnopqrstuv'"), "provider-token"));
    check("(12) AIza... refused", hit(J("key: AIza", "SyA1234567890abcdefghijklmnopqrstu"), "provider-token"));
    check("(12) glpat- and npm_ refused", hit(J("t=glpat-", "abcdefghij1234567890"), "provider-token") && hit(J("t=npm_", "A1b2C3d4E5".repeat(4)), "provider-token"));
    check("(12) ghp_ right after an underscore refused (\\b would miss it)", hit(J("TOKEN_ghp_", "A1b2".repeat(9)), "github-token"));
    check("(12) negative controls stay clean (types, calls, placeholders, labels, env reads, noreply, CI paths)",
      [ "token: string", J("password: z.string().min(", "8)"), "const k = process.env.OPENAI_API_KEY", "API_KEY=changeme-please", J("token = \"<your-", "token>\""), "password: \"Enter your password\"",
        "GET /v1/users/:id", "GET /api/users/{id}", J("/home/", "user/work"), J("/home/", "runner/work/x"), J("Co-Authored-By: Claude Opus 5.5 <noreply", "@", "anthropic.com>"), J("agent", "@", "acme.test") ].every((l) => clean(l, "x.md")));
    // (13) H2 markers
    check("(13) wikilinks in ANY file type and with any first char", [["x.ts", J("// [[Health ", "Journal]]")], ["notes.txt", J("see [[Health ", "Journal]]")], ["x.md", J("see [[ Health ", "Journal]]")], ["x.md", J("see [[_in", "box/diary]]")], ["x.md", J("see [[\u00c9t\u00e9 ", "journal]]")]].every(([p, l]) => hit(l, "obsidian-wikilink", p)));
    check("(13) /users/<name> case-insensitive; Windows, $HOME, ${HOME}, %USERPROFILE%, /Volumes, /home/<name> with or without slash",
      hit(J("/us", "ers/dan/Documents/notes.md"), "personal-path-users") && hit(J("C:\\Us", "ers\\dan\\Documents"), "personal-path-windows") && hit("$HOME/Documents/Vault", "personal-path-home-var") &&
      hit("${HOME}/x", "personal-path-home-var") && hit("%USERPROFILE%\\x", "personal-path-windows") && hit("/Volumes/Private/Vault", "personal-path-volumes") &&
      hit(J("cd /ho", "me/dan"), "personal-path-home") && hit(J("cd /ho", "me/dan/x"), "personal-path-home") && hit("/root/.ccr/ca-bundle.crt", "personal-path-root"));
    check("(13) /home/user and /home/runner stay allowed only as EXACT segments", clean(J("/home/", "user/x")) && clean(J("/home/", "runner")) && hit(J("/home/", "username/x"), "personal-path-home") && hit(J("/home/", "runner2/x"), "personal-path-home"));
    check("(13) Obsidian front matter and %%comments%%", hit("tags: [private, journal]", "obsidian-frontmatter", "x.md") && hit("%% private: call the lawyer %%", "obsidian-comment", "x.md"));
    check("(13) zero-width and percent-encoded evasions of a path are caught", hit(J("/Us\u200b", "ers/dan/notes"), "private-path", "x.md") && hit(J("%2FUs", "ers%2Fdan%2Fnotes"), "private-path", "x.md"));
    check("(13) e-mail with an allowlisted-looking suffix is still refused", hit(J("dan", "@", "gmail.com.test"), "email", "x.md"));
    // (14) H2 provenance (vault resolution is fail-closed for --publish)
    process.env.SIGNALGRID_VAULT_DIRS = join(root, "no-such-vault");
    await refused("(14) a configured vault directory that does not exist refuses", { job: "jclean", db, repo }, "does not exist");
    delete process.env.SIGNALGRID_VAULT_DIRS;
    const homeSaved = process.env.HOME, emptyHome = join(root, "empty-home");
    mkdirSync(emptyHome);
    process.env.HOME = emptyHome;
    await refused("(14) --publish with NO resolvable vault refuses", { job: "jclean", db, repo, publish: true }, "no vault or knowledge directory");
    check("(14) the dry run with no resolvable vault logs and continues", (await run({ job: "jclean", db, repo, log: quiet })).files.join() === "docs/clean.md");
    // ... and the vault is found from Obsidian's own registry, with no path written in this script
    const regDir = join(emptyHome, "Library", "Application Support", "obsidian");
    mkdirSync(regDir, { recursive: true });
    writeFileSync(join(regDir, "obsidian.json"), JSON.stringify({ vaults: { v1: { path: vault, ts: 1 } } }));
    await refused("(14) a vault found via Obsidian's registry is used (copied note text refused, --publish)", { job: "jscan-docsc23md", db, repo, publish: true }, "provenance-line");
    check("(14) ... and a clean job still passes with it", (await run({ job: "jclean", db, repo, publish: false, log: quiet })).files.join() === "docs/clean.md");
    process.env.HOME = homeSaved;
    const badVault = join(root, "bad-vault");
    mkdirSync(badVault);
    writeFileSync(join(badVault, "real.md"), "ok\n");
    symlinkSync(join(root, "gone.md"), join(badVault, "dangling.md"));
    process.env.SIGNALGRID_VAULT_DIRS = badVault;
    await refused("(14) an unreadable (dangling) vault entry refuses, even on a dry run", { job: "jclean", db, repo }, "could not read the vault");
    // read-once indexing (CodeQL js/file-system-race): a FIFO named like a note is classified from the opened descriptor and skipped, not read
    const fifoVault = join(root, "fifo-vault");
    mkdirSync(fifoVault);
    writeFileSync(join(fifoVault, "n.md"), "x\n");
    spawnSync("mkfifo", [join(fifoVault, "pipe.md")]);
    process.env.SIGNALGRID_VAULT_DIRS = fifoVault;
    const tFifo = Date.now();
    check("(14) a FIFO in the vault is skipped, not read and not hung on", (await run({ job: "jclean", db, repo, log: quiet })).files.join() === "docs/clean.md" && Date.now() - tFifo < 10000);
    process.env.SIGNALGRID_VAULT_DIRS = vault;
    // (15) M1: no stderr / absolute path in any refusal
    for (const [name, args] of [["unreadable worktree", { job: "jnotgit", publish: true }], ["worktree whose .git file names a personal path", { job: "jgitdir", publish: true }]]) {
      try { await run({ ...args, db, repo, log: quiet }); check(`(15) ${name} (not refused)`, false); }
      catch (e) { check(`(15) ${name}: message carries no path or personal marker`, e instanceof Refusal && !/SignalGrid-Local-AI|\/Users|\/home\/|\/tmp\/|\/var\//.test(e.message) && !/dan/.test(e.message)); }
    }
    check("(15) redact() turns absolute and home paths into <path>", redact(J("failed at /Us", "ers/dan/x: boom (~/Library/y) ok docs/a.md:3 rule")) === "failed at <path>: boom (<path>) ok docs/a.md:3 rule");
    // (16) M2: named untracked files must be non-hidden, non-top-level, in a directory that already holds tracked files
    await refused("(16) a named untracked dotfile is refused", { job: "jdot", db, repo, publish: true }, "dotfiles, top-level");
    await refused("(16) a named untracked top-level file is refused", { job: "jtop", db, repo, publish: true }, "dotfiles, top-level");
    await refused("(16) a named untracked file in a brand-new directory is refused", { job: "jnewdir", db, repo, publish: true }, "dotfiles, top-level");
    // (17) L2: exactly one commit on the fetched base
    await refused("(17) a second commit on the branch is refused before any push", { job: "jclean", db, repo, publish: true, hooks: { afterCommit: (w) => { writeFileSync(join(w, "extra.txt"), "x\n"); scratchGitOk(w, ["add", "extra.txt"]); scratchGitOk(w, ["commit", "-q", "-m", "extra"]); } } }, "exactly one commit");
    check("(17) nothing was pushed or opened by (12)-(17)", remoteBranches() === before + 1 && ghCalls().length === ghBefore + 1);
    // (18) L3 + #1911 (5): worker git config that would run a program during the diff is refused, and never runs
    for (const [id, what] of [["jtextconv", "diff textconv driver"], ["jfsmon", "core.fsmonitor program"], ["jfilter", "clean filter"]]) {
      await refused(`(18) a worktree with a ${what} in its local git config is refused`, { job: id, db, repo }, "executable setting");
    }
    check("(18) ... and none of those programs ran", !existsSync(textconvMarker));
    // (19) #1911 (4): hooks never run in the scratch worktree; install/hook/attribute files are never published
    const hookDir = join(root, "hooks"), hookMarker = join(root, "hook.ran");
    mkdirSync(hookDir);
    for (const h of ["pre-commit", "pre-push", "post-commit"]) { writeFileSync(join(hookDir, h), `#!/bin/sh\ntouch '${hookMarker}'\n`); chmodSync(join(hookDir, h), 0o755); }
    scratchGitOk(repo, ["config", "core.hooksPath", hookDir]);
    const extraSaved = GIT_EXTRA;
    GIT_EXTRA = GIT_EXTRA.filter((v, i, a2) => v !== "core.hooksPath=/dev/null" && a2[i + 1] !== "core.hooksPath=/dev/null");
    const r19 = await run({ job: "jhook", db, repo, publish: true, log: quiet });
    GIT_EXTRA = extraSaved;
    scratchGitOk(repo, ["config", "--unset", "core.hooksPath"]);
    check("(19) publish succeeded and no git hook ran (pre-commit / pre-push / post-commit)", r19.pushed && !existsSync(hookMarker));
    await refused("(19) editing package.json is refused (pnpm lifecycle / pnpmfile surface)", { job: "jpkg", db, repo, publish: true }, "install/hook/attribute surface");
    await refused("(19) editing .gitattributes is refused", { job: "jattr", db, repo, publish: true }, "install/hook/attribute surface");
    check("(19) EXEC_SURFACE names every install/hook surface", [".pnpmfile.cjs", "a/.npmrc", "packages/x/package.json", ".gitattributes", ".gitmodules", ".githooks/pre-push", "pnpm-workspace.yaml"].every((f) => EXEC_SURFACE.test(f)) && !EXEC_SURFACE.test("docs/package.json.md"));
    // (20) #1911 (6): a hung scanner or gh is a refusal / an error, never a hang or a pass
    process.env.SIGNALGRID_SCAN_TIMEOUT_MS = "700";
    const glSlow = join(bin, "gitleaks-slow");
    writeFileSync(glSlow, '#!/bin/sh\n[ "$1" = version ] && exit 0\nsleep 5\n');
    chmodSync(glSlow, 0o755);
    process.env.SIGNALGRID_GITLEAKS_BIN = glSlow;
    await refused("(20) a gitleaks that hangs is a refusal (timed out)", { job: "jclean", db, repo, publish: true }, "timed out");
    process.env.SIGNALGRID_GITLEAKS_BIN = glStub;
    writeFileSync(join(root, "gh.slow"), "");
    const t0 = Date.now();
    let ghErr = "";
    try { await run({ job: "jgh", db, repo, publish: true, log: quiet }); } catch (e) { ghErr = e.message; }
    check("(20) a gh that hangs fails fast with 'timed out' instead of hanging", ghErr.includes("timed out") && Date.now() - t0 < 4500);
    rmSync(join(root, "gh.slow"));
    delete process.env.SIGNALGRID_SCAN_TIMEOUT_MS;
    // (21) #1911 (1)(2): path and Obsidian shapes without ~/ ; .trash/ components
    check("(21) Library/Mobile Documents/iCloud~md~obsidian, $HOME/Library, %2fusers%2f, C:/Users/x, file:///Users/x all refused",
      [J("Library/Mobile Doc", "uments/iCloud~md~obsid", "ian/Documents/Vault/a.md"), "$HOME/Library/Caches/x", J("%2fus", "ers%2fx%2f"), J("C:/Us", "ers/x"), J("file:///Us", "ers/x/a.md"), J("obsid", "ian://open?vault=Private")].every((l) => scanLine(l, "x.md").length > 0));
    check("(21) a .trash/ path component is refused in text and in a file path", scanLine(J("see .tra", "sh/old.md"), "x.md").includes("obsidian-trash") && scanPatch(`diff --git a/.trash/a.md b/.trash/a.md\nnew file mode 100644\n--- /dev/null\n+++ b/.trash/a.md\n@@ -0,0 +1 @@\n+fine\n`).length > 0);
    await refused("(21) end to end: a note that mentions a .trash/ path is refused", { job: "jtrash", db, repo, publish: true }, "obsidian-trash");
    check("(21) nothing leaked: only jstray and jhook were pushed",  remoteBranches() === before + 3 && /jstray|jhook/.test(scratchGitOk(repo, ["ls-remote", "--heads", "origin", "refs/heads/brain/*"])));
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
    console.error(redact(e instanceof Refusal ? `REFUSED: ${e.message}` : `ERROR: ${e.message}`));
    process.exit(1);
  }
}
