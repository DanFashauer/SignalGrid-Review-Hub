#!/usr/bin/env node
// brain-proposal-pr.mjs — publish ONE finished local-brain build as a GitHub PR (owner order,
// Dan, 2026-11-02: "Build the Mac route").
//
//   node scripts/mac/brain-proposal-pr.mjs --job <id> [--db <sqlite>]           # dry run (default)
//   node scripts/mac/brain-proposal-pr.mjs --job <id> --publish                  # push brain/job-<id> + open PR
//   node scripts/mac/brain-proposal-pr.mjs --list-review [--not-before <ISO>] [--db <sqlite>]
//   node scripts/mac/brain-proposal-pr.mjs --self-test
//   node scripts/mac/brain-proposal-pr.mjs --qualify-scanner --binary <private-binary> --output <new-private-dir> --host-fd <inherited-fd> --parent-pid <parent>
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
// Publication screening is separate from full final-head validation and landing.
// --publish uses ordinary Git hooks/network and the existing authenticated gh.

import { spawnSync } from "node:child_process";
import { accessSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, fchmodSync, mkdirSync, lstatSync, readdirSync, openSync, closeSync, fstatSync, fsyncSync, constants, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, userInfo } from "node:os";
import { dirname, join, resolve, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";
import { classifyDiff } from "../check-owner-gated-surfaces.mjs";
import { scratchGitOk, scrubProcessGitEnv } from "../lib/scratch-git.mjs";
import { isMainModule } from "../lib/is-main.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BASE = "SignalGrid_Alpha";
// Control authority follows the OS account, never a worker-supplied HOME.
const ACCOUNT_HOME = userInfo().homedir;
const GIT_BINARY = process.platform === "darwin" ? "/Applications/Xcode.app/Contents/Developer/usr/bin/git" : "/usr/bin/git";
const TOOL_PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const DEFAULT_DB = join(ACCOUNT_HOME, "SignalGrid-Local-AI", "brain-state", "autonomy.sqlite3");
const DENY = [/^AGENTS\.md$/, /^CLAUDE\.md$/, /^docs\/DECISION_RECORDS\.md$/, /^\.github\//, /^docs\/PURPOSE\.md$/, /^artifacts\/agent-heartbeats\//];
const PRIVATE = /[/\\](?:users|home)[/\\]|[a-z]:[/\\]users[/\\]|(?:\$\{?home\}?|%userprofile%|~)[/\\]|library[/\\]mobile\s+documents|icloud~md~obsidian|SignalGrid-Local-AI|brain-state|brain-worktrees|[/\\]private[/\\]|[/\\]var[/\\]folders[/\\]/i;
const PRIVATE_MARKUP = /\.obsidian(?:[/\\]|$)|\[\[[^\]\[\r\n]{1,240}\]\]|%%/i;
const PRIVATE_DIRECTORY = /^(?:\.obsidian|\.trash|vaults?|private-notes)$/i;
const EXECUTION_CONTROL = /^(?:\.git(?:attributes|modules|config)?|\.npmrc|\.pnpmfile\.(?:cjs|mjs|js)|package\.(?:json5?|ya?ml)|pnpm-workspace\.ya?ml|pnpm-lock\.yaml|package-lock\.json|npm-shrinkwrap\.json|\.yarnrc(?:\.yml)?|yarn\.lock|\.pnp\.(?:cjs|loader\.mjs))$/i;
const NEW_PUBLIC_DIRECTORY = /^(?:docs|src|web|apps|packages|tests?|public|assets)\//;
const ORDINARY_PRE_PUSH_SHA = "ab88ceee48a25a9eb79f072e9315093336ab3ccc810e0fbbe2e49690fa5d8b59";
const SCANNER_MANIFEST = join(ACCOUNT_HOME, "SignalGrid-Local-AI", "brain-state", "auto-publish-review", "scanner.json");
const PRIVACY_CLEARANCES = join(dirname(SCANNER_MANIFEST), "clearances");
const MAX_PRIVACY_TTL_MS = 60 * 60 * 1000;
const SCANNER_SHA = "af9afd0ae3a0ff6d7f08c4ec4e28686b7e4de6962fe1eadecc497d15cdf731e2";
const CONFIG_SHA = "7d0c4be43036be1e9834c920c415afabaa9998c18e12b8a7bf5c35a6f7532e85";
const SCAN_CONTROL = /^(?:\.git|\.gitleaksignore|\.gitleaks\.(?:toml|ya?ml|json))$/i;
const AWS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/;
const MAX_SCAN_FILE = 1 << 20, MAX_SCAN_TOTAL = 16 << 20;
const FACTS_MARKER = "SIGNALGRID_PUBLICATION_FACTS ";
// Set only inside the unexported synthetic self-test, never by run(), CLI or env.
let SELF_TEST_SCANNER = null;

class Refusal extends Error {}
const refuse = (m) => { throw new Refusal(m); };

/** Every git call goes through here; the self-test injects -c overrides via GIT_EXTRA. */
let GIT_EXTRA = [];
function gitEnv(extra = {}) {
  // Pass data and ordinary account credentials, not the caller's executable
  // startup/configuration channels (shell functions, Bash/Node preloads, package
  // manager overrides, dynamic-loader controls, Git helpers or proxy routing).
  // The existing account SSH agent/key and GitHub credentials remain available;
  // this changes only these child processes, never global configuration.
  const env = {};
  for (const key of ["SSH_AUTH_SOCK", "SSH_AGENT_PID", "GH_TOKEN", "GITHUB_TOKEN", "LANG", "LC_ALL", "LC_CTYPE", "LC_MESSAGES", "TZ", "TMPDIR", "TMP", "TEMP", "__CF_USER_TEXT_ENCODING", "SYSTEMROOT", "WINDIR"]) {
    const value = process.env[key];
    if (typeof value === "string" && !/^\(\)\s*\{/.test(value)) env[key] = value;
  }
  if (SELF_TEST_SCANNER && process.env.SYNTHETIC_CONFIG_MARKER) env.SYNTHETIC_CONFIG_MARKER = process.env.SYNTHETIC_CONFIG_MARKER;
  const home = SELF_TEST_SCANNER?.gitHome ?? ACCOUNT_HOME;
  return { ...env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"),
    PATH: SELF_TEST_SCANNER?.toolPath ?? TOOL_PATH, ...extra,
    SSH_ASKPASS_REQUIRE: "never", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" };
}
function ghEnv() {
  const env = gitEnv();
  for (const key of Object.keys(env)) if (key.startsWith("GH_") && key !== "GH_TOKEN") delete env[key];
  return { ...env, GH_HOST: "github.com", GH_REPO: "github.com/DanFashauer/SignalGrid-Review-Hub",
    GH_CONFIG_DIR: join(env.HOME, ".config", "gh"), GH_PROMPT_DISABLED: "1" };
}
function requireHookDependencies() {
  // The approved hook exits zero when pnpm is missing. Presence of the hook
  // therefore proves nothing unless its required tool is actually resolvable
  // in the same trusted PATH that Git and the hook will receive.
  for (const directory of gitEnv().PATH.split(":")) {
    if (!isAbsolute(directory)) refuse("publication tool path is not absolute");
    const candidate = join(directory, "pnpm");
    if (!existsSync(candidate)) continue;
    const path = realpathSync(candidate), st = lstatSync(path);
    if (!st.isFile() || ![0, process.getuid()].includes(st.uid) || st.nlink !== 1 || !(st.mode & 0o111) || (st.mode & 0o022)) refuse("mandatory pnpm hook dependency is not a trusted executable");
    return;
  }
  refuse("mandatory pnpm hook dependency is unavailable in the trusted PATH; publication refused");
}
function git(dir, args, env) {
  const r = spawnSync(GIT_BINARY, ["-C", dir, ...GIT_EXTRA, "-c", "core.fsmonitor=false", ...args], { encoding: "utf8", env: gitEnv(env), timeout: 120000, killSignal: "SIGKILL", maxBuffer: 64 << 20 });
  return { ok: !r.error && r.status === 0, out: r.stdout ?? "", err: (r.stderr ?? "") + (r.error ? r.error.message : "") };
}
function gitOk(dir, args, env) {
  const r = git(dir, args, env);
  if (!r.ok) throw new Error(`git ${args.join(" ")} failed: ${r.err.trim()}`);
  return r.out;
}

async function readJob(db, id) {
  if (!existsSync(db)) refuse(`brain DB not found: ${db}`);
  const sql = "SELECT * FROM autonomy_jobs WHERE id = ?";
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
function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) refuse("invalid timezone-bearing timestamp");
  const [year, month, day, hour, minute, second] = value.match(/\d+/g).slice(0, 6).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59 || !Number.isFinite(Date.parse(value))) refuse("invalid timezone-bearing timestamp");
  return Date.parse(value);
}

export async function listReview(db = DEFAULT_DB, { notBefore } = {}) {
  const cutoff = notBefore === undefined ? null : timestamp(notBefore);
  if (!existsSync(db)) refuse(`brain DB not found: ${db}`);
  const sql = "SELECT id, created_at, updated_at, cancel_requested FROM autonomy_jobs WHERE kind = 'build' AND status = 'review' AND repo = 'SignalGrid-Review-Hub' AND worktree IS NOT NULL ORDER BY updated_at, id";
  let rows;
  if (isBuiltin("node:sqlite")) {
    const { DatabaseSync } = await import("node:sqlite");
    const d = new DatabaseSync(db, { readOnly: true });
    try { rows = d.prepare(sql).all(); } finally { d.close(); }
  } else {
    const r = spawnSync("/usr/bin/sqlite3", ["-readonly", "-json", `file:${db}?mode=ro`, sql], { encoding: "utf8" });
    if (r.status !== 0) refuse(`sqlite3 could not read ${db}: ${r.stderr.trim()}`);
    rows = JSON.parse(r.stdout || "[]");
  }
  // Manual listing is read-only and retains its unbounded historical view.
  if (cutoff === null) return rows.map((row) => String(row.id));
  const eligible = [];
  for (const row of rows) {
    if (!/^[A-Za-z0-9_-]+$/.test(row.id ?? "") || row.cancel_requested !== 0) continue;
    try {
      const created = timestamp(row.created_at), updated = timestamp(row.updated_at);
      if (created < cutoff || updated < created) continue;
      const job = await readJob(db, row.id), clearance = readPrivacyClearance(row.id);
      if (!job || clearance.value.request?.job_sha256 !== valueDigest(job) || clearance.value.request?.publisher_sha256 !== publisherDigest()) continue;
      if (!job.worktree || !existsSync(job.worktree)) continue;
      if (clearance.value.request.worker_uid !== worktreeOwner(job.worktree)) continue;
      const { patch } = worktreePatch(job.worktree);
      const head = sourceGitBytes(job.worktree, ["rev-parse", "HEAD"]).toString("utf8").trim();
      if (!full40(head) || clearance.value.request.worker_head !== head || clearance.value.request.patch_sha256 !== digest(Buffer.from(patch))) continue;
      requireHookDependencies();
      eligible.push(String(row.id));
    } catch (e) { if (!(e instanceof Refusal)) throw e; }
  }
  return eligible;
}

const decode = (s) => { try { const v = JSON.parse(s); return typeof v === "string" ? v : s; } catch { return s ?? ""; } };

/** The worktree's uncommitted change, untracked files included, without touching its index. */
function worktreePatch(wt) {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "brain-idx-")));
  const env = { GIT_INDEX_FILE: join(tmp, "index") };
  const text = (bytes) => {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { refuse("worker Git data is not complete UTF-8"); }
  };
  try {
    rejectExecutableLocalConfig(wt);
    const head = text(sourceGitBytes(wt, ["rev-parse", "--verify", "HEAD"])).trim();
    const common = text(sourceGitBytes(wt, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    if (!full40(head) || !isAbsolute(common) || /[\r\n\0]/.test(common)) refuse("worker Git object location is invalid");
    const objects = realpathSync(join(common, "objects"));
    if (/[\r\n\0]/.test(objects)) refuse("worker Git object location is invalid");
    // Only objects are shared. Every command that reads worktree contents uses
    // our private HEAD/config/index, so later worker filter/include changes
    // cannot become executable configuration in an add or diff.
    const gitDirectory = join(tmp, "git");
    mkdirSync(join(gitDirectory, "objects", "info"), { recursive: true, mode: 0o700 });
    mkdirSync(join(gitDirectory, "refs"), { mode: 0o700 });
    writeFileSync(join(gitDirectory, "config"), "[core]\nrepositoryformatversion = 0\nbare = false\n", { flag: "wx", mode: 0o400 });
    writeFileSync(join(gitDirectory, "HEAD"), head + "\n", { flag: "wx", mode: 0o400 });
    writeFileSync(join(gitDirectory, "objects/info/alternates"), objects + "\n", { flag: "wx", mode: 0o400 });
    const readWorker = (args) => sourceGitBytes(wt, args, env, gitDirectory);
    readWorker(["read-tree", "HEAD"]);
    const rawUntracked = text(readWorker(["ls-files", "--others", "--exclude-standard", "-z"]));
    if (rawUntracked && !rawUntracked.endsWith("\0")) refuse("worker path inventory is incomplete");
    const untracked = rawUntracked.split("\0").filter(Boolean);
    if (untracked.some((file) => !safePath(file))) refuse("unsafe publication path in new files");
    const governed = classifyDiff(untracked);
    if (governed.matched.length) refuse("new publication path is owner-gated: " + governed.matched.map((m) => m.category).join(", "));
    if (untracked.some((file) => !NEW_PUBLIC_DIRECTORY.test(file))) refuse("unsafe publication path in new files");
    readWorker(["add", "-N", "--", "."]);
    const patch = text(readWorker(["diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv", "--no-renames", "HEAD"]));
    const names = readWorker(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z", "HEAD"]);
    const nameText = text(names);
    if (nameText && !nameText.endsWith("\0")) refuse("worker path inventory is incomplete");
    const files = nameText.split("\0").filter(Boolean);
    return { patch, files };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// A worker checkout is data. Read operations must never run its fsmonitor,
// filters, text conversion or hooks, or import its included configuration.
function sourceGitBytes(dir, args, extra = {}, gitDirectory = null) {
  const env = gitEnv({ ...extra, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "" });
  const location = ["-C", dir, ...(gitDirectory ? ["--git-dir", gitDirectory, "--work-tree", dir] : [])];
  const r = spawnSync(GIT_BINARY, ["--no-replace-objects", ...location, ...GIT_EXTRA, "-c", "protocol.allow=never", "-c", "core.fsmonitor=false", "-c", "core.attributesFile=/dev/null", "-c", "core.hooksPath=/dev/null", ...args],
    { env, timeout: 120000, killSignal: "SIGKILL", maxBuffer: 64 << 20 });
  if (r.error || r.status !== 0 || r.signal) refuse("cannot safely read complete worker Git data");
  return r.stdout;
}

function rejectExecutableLocalConfig(dir) {
  const raw = sourceGitBytes(dir, ["config", "--local", "--no-includes", "--null", "--list"]);
  const rows = raw.toString("utf8").split("\0").filter(Boolean);
  for (const row of rows) {
    const key = row.split("\n", 1)[0];
    if (/^(?:filter\.|diff\..*\.(?:command|textconv)$|include(?:if)?\.|credential\.|protocol\.|url\..*\.(?:insteadof|pushinsteadof)$|remote\..*\.(?:promisor|partialclonefilter|uploadpack|receivepack|vcs)$|core\.(?:fsmonitor|sshcommand|gitproxy|askpass|alternaterefscommand)$|extensions\.(?:worktreeconfig|partialclone)$)/i.test(key)) refuse("worker Git execution configuration is refused");
  }
}

function privacyText(text) {
  let value = text.normalize("NFKC").replace(/[\u200b-\u200f\u2060\ufeff]/g, "");
  const point = (value) => {
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) refuse("publication text has an invalid encoded code point");
    return String.fromCodePoint(value);
  };
  for (let i = 0; i < 4; i++) {
    const next = value.replace(/%([0-9a-f]{2})/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
      .replace(/\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2}))/gi, (_, a, b, c) => point(parseInt(a ?? b ?? c, 16)))
      .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => point(parseInt(hex ?? dec, hex ? 16 : 10)))
      .replace(/&amp;/gi, "&")
      .replace(/&(?:sol|bsol);/gi, (s) => s.toLowerCase() === "&sol;" ? "/" : "\\")
      .normalize("NFKC").replace(/[\u200b-\u200f\u2060\ufeff]/g, "");
    if (next === value) break;
    value = next;
  }
  if (/%(?:[0-9a-f]{2}|u[0-9a-f]{4})|\\(?:u(?:[0-9a-f]{4}|\{[0-9a-f]{1,6}\})|x[0-9a-f]{2})|&(?:amp|sol|bsol|#(?:x[0-9a-f]+|\d+));/i.test(value)) refuse("publication text exceeds supported encoding bounds");
  return value;
}

const digest = (data) => createHash("sha256").update(data).digest("hex");
const ordered = (value) => {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  if (value === null || ["string", "boolean"].includes(typeof value) || typeof value === "number" && Number.isFinite(value)) return value;
  refuse("publication privacy identity is not complete JSON data");
};
const valueDigest = (value) => digest(Buffer.from(JSON.stringify(ordered(value))));
const publisherDigest = () => digest(readFileSync(fileURLToPath(import.meta.url)));
const full40 = (value) => /^[0-9a-f]{40}$/.test(value);
const sameFields = (a, b) => ["path", "sha256", "mode", "uid"].every((key) => a?.[key] === b?.[key]);
const PRIVATE_SCANNER_CASES = {
  "private-mobile-documents": "Library/Mobile Documents/com~apple~CloudDocs/note.md",
  "private-icloud": "iCloud~md~obsidian/vault/note.md",
  "private-home-variable": "$HOME/vault/note.md", "private-braced-home": "${HOME}/vault/note.md",
  "private-users": "/users/fixture/vault/note.md", "private-home": "/home/fixture/vault/note.md",
  "private-windows": "C:\\Users\\fixture\\vault\\note.md",
  "private-percent": "%2FUsers%2Ffixture%2Fvault%2Fnote.md",
  "private-double-percent": "%252FUsers%252Ffixture%252Fvault%252Fnote.md",
  "private-json": String.raw`\u002fUsers\u002ffixture\u002fvault\u002fnote.md`,
  "private-html": "&#47;Users&#47;fixture&#47;vault&#47;note.md",
  "private-obsidian": ".obsidian/workspace.json", "private-wikilink": "[[Private meeting note]]",
  "private-comment": "%% private meeting note %%",
};
const REQUIRED_SCANNER_CASES = { clean: 0, credential: 2, "credential-with-demo": 2, "credential-with-inline-allow": 2, "raw-svg-default-path-exclusion": 0, "opaque-svg-credential": 2, "model-local-overrides-not-imported": 2, "malformed-fixed-config": 1,
  ...Object.fromEntries(Object.keys(PRIVATE_SCANNER_CASES).map((name) => [name, 2])) };

/** Offline setup, under an already admitted parent. No job, publication,
 * manifest installation or retry. Failed/unknown output stays consumed. */
function qualifyScanner(a) {
  const keys = ["--binary", "--output", "--host-fd", "--parent-pid"];
  if (a.length !== 9 || a[0] !== "--qualify-scanner" || keys.some((k, i) => a[1 + i * 2] !== k)) refuse("invalid scanner qualification arguments");
  const source = a[2], output = a[4], fd = Number(a[6]);
  if (!Number.isInteger(fd) || fd < 3 || Number(a[8]) !== process.ppid) refuse("qualification requires its original parent descriptor");
  const host = join(ACCOUNT_HOME, "Library/Caches/signalgrid/host-verification.lock");
  const inherited = fstatSync(fd), named = lstatSync(host);
  if (!inherited.isFile() || named.isSymbolicLink() || inherited.dev !== named.dev || inherited.ino !== named.ino || inherited.uid !== process.getuid() || inherited.nlink !== 1 || (inherited.mode & 0o777) !== 0o644) refuse("qualification host descriptor identity changed");
  closeSync(fd);
  let closed = false; try { fstatSync(fd); } catch (e) { closed = e.code === "EBADF"; }
  if (!closed) refuse("qualification inherited descriptor did not close");
  if (!isAbsolute(output) || resolve(output) !== output || output === REPO || output.startsWith(REPO + sep) || realpathSync(dirname(output)) !== dirname(output)) refuse("qualification output must be a new private physical path");
  const binaryBytes = privateBytes(source, 0o500), configBytes = readFileSync(join(REPO, "scripts/mac/publication-gitleaks.toml"));
  if (digest(binaryBytes) !== SCANNER_SHA || digest(configBytes) !== CONFIG_SHA) refuse("qualification binary or fixed policy source changed");
  mkdirSync(output, { mode: 0o700 }); // Exclusive: never reuse an old attempt.
  const refs = [];
  const save = (path, value, mode = 0o400) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const handle = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try { writeFileSync(handle, bytes); fsyncSync(handle); } finally { closeSync(handle); }
    const st = lstatSync(path), ref = { path, sha256: digest(bytes), bytes: bytes.length, mode: st.mode & 0o777, uid: st.uid };
    scannerRef(ref, null, mode); refs.push(ref); return ref;
  };
  const json = (path, value) => save(path, JSON.stringify(value, null, 2) + "\n");
  for (const name of ["results", "exports", "reports", "raws", "model-cwd"]) mkdirSync(join(output, name), { mode: 0o700 });
  const binary = save(join(output, "gitleaks"), binaryBytes, 0o500), config = save(join(output, "publication.toml"), configBytes), ignore = save(join(output, "empty.ignore"), "");
  const badConfig = save(join(output, "malformed.toml"), "[extend\nuseDefault = true\n"), cwd = join(output, "model-cwd");
  const token = "ghp_" + "1234567890abcdefghijklmnopqrstuvwxyz";
  const original = (name, args) => {
    const r = spawnSync(binary.path, args, { cwd, env: { LANG: "C", LC_ALL: "C", TZ: "UTC" }, timeout: 30000, killSignal: "SIGKILL", maxBuffer: 1 << 20 });
    const out = r.stdout ?? Buffer.alloc(0), err = r.stderr ?? Buffer.alloc(0);
    const stdout = save(join(output, "raws", name + ".stdout"), out), stderr = save(join(output, "raws", name + ".stderr"), err);
    if (r.error || r.signal || r.status === null || /partial scan completed/i.test(out.toString() + err.toString()) || Buffer.concat([out, err]).includes(Buffer.from(token))) refuse("qualification child did not finish normally with redacted output");
    return { name, returncode: r.status, normal_exit: true, original_wait_completed: true, interruptions: [], raw_secret_redaction_verified: true, stdout_ref: stdout, stderr_ref: stderr };
  };
  const version = original("version", ["--version"]);
  if (version.returncode !== 0 || scannerRef(version.stdout_ref, null, 0o400).toString().trim() !== "gitleaks version 8.24.3" || scannerRef(version.stderr_ref, null, 0o400).length) refuse("qualification actual version differs");
  const versionRef = json(join(output, "results/version.json"), version), cases = [];
  const scan = (name, contents, filename = "entry-000000", policy = config) => {
    const root = join(output, "exports", name); mkdirSync(root, { mode: 0o700 });
    const input = save(join(root, filename), contents), report = join(output, "reports", name + ".json");
    const result = original(name, ["dir", "--redact=100", "--exit-code=2", "--no-banner", "--no-color", "--ignore-gitleaks-allow", "--config", policy.path, "--gitleaks-ignore-path", ignore.path, "--report-format=json", "--report-path", report, root]);
    if (result.returncode !== REQUIRED_SCANNER_CASES[name]) refuse("scanner qualification case failed: " + name);
    let findings = [];
    let handle;
    try { handle = openSync(report, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    catch (e) { if (e.code !== "ENOENT" || result.returncode !== 1) refuse("qualification report is unavailable"); }
    if (handle !== undefined) {
      try {
        const st = fstatSync(handle);
        if (!st.isFile() || st.uid !== process.getuid() || st.nlink !== 1) refuse("qualification report is not regular owned bytes");
        fchmodSync(handle, 0o400); fsyncSync(handle);
        const before = fstatSync(handle), data = readFileSync(handle), after = fstatSync(handle), named = lstatSync(report);
        if ([after, named].some((s) => ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode", "uid", "nlink"].some((k) => s[k] !== before[k]))) refuse("qualification report changed while reading");
        if (data.includes(Buffer.from(token))) refuse("qualification report exposed its synthetic token");
        findings = JSON.parse(data.toString()) ?? [];
      } finally { closeSync(handle); }
    }
    if (!Array.isArray(findings) || (result.returncode === 2 ? !findings.length : findings.length)) refuse("qualification findings disagree with exit status");
    result.credential_finding_count = findings.length;
    cases.push({ name, returncode: result.returncode, result_ref: json(join(output, "results", name + ".json"), result) });
    return input;
  };
  scan("clean", "Public fixture documentation only.\n");
  scan("credential", "synthetic credential " + token + "\n");
  scan("credential-with-demo", "sgk_demo_safe synthetic credential " + token + "\n");
  scan("credential-with-inline-allow", "synthetic credential " + token + " # gitleaks:allow\n");
  const svg = '<svg data-synthetic-credential="' + token + '"></svg>\n';
  const rawSvg = scan("raw-svg-default-path-exclusion", svg, "drawing.svg"), opaqueSvg = scan("opaque-svg-credential", svg);
  const mapping = json(join(output, "mapping.json"), [{ name: "entry-000000", source: "files/drawing.svg", sha256: opaqueSvg.sha256 }]);
  save(join(cwd, ".gitleaks.toml"), '[extend]\nuseDefault = false\n[[rules]]\nid="never-match"\ndescription="Synthetic local override must not load"\nregex="a^"\n[allowlist]\nregexes=[".*"]\n');
  save(join(cwd, ".gitleaksignore"), "*\n");
  scan("model-local-overrides-not-imported", "synthetic credential " + token + "\n");
  scan("malformed-fixed-config", "Public fixture.\n", "entry-000000", badConfig);
  for (const [name, contents] of Object.entries(PRIVATE_SCANNER_CASES)) scan(name, contents + "\n");
  for (const ref of refs) scannerRef(ref, null, ref.mode);
  if (!privateBytes(source, 0o500).equals(binaryBytes) || !readFileSync(join(REPO, "scripts/mac/publication-gitleaks.toml")).equals(configBytes)) refuse("qualification inputs changed");
  json(join(output, "qualification.json"), { format: "signalgrid-gitleaks-qualification-result/v3", qualified: true, version: "8.24.3", at: new Date().toISOString(),
    private_executable_ref: binary, strict_config_ref: config, empty_ignore_ref: ignore, version_result_ref: versionRef,
    opaque_export_naming: "entry-[0-9]{6}", source_extension_skip_and_opaque_detection_verified: rawSvg.sha256 === opaqueSvg.sha256,
    source_extension_control: { raw_named_case: "raw-svg-default-path-exclusion", opaque_case: "opaque-svg-credential", identical_bytes: true, raw_source_ref: rawSvg, opaque_export_ref: opaqueSvg, private_mapping_ref: mapping },
    cases, original_waits_complete: true, raws_fsynced: true, interruptions: [] });
  json(join(output, "child-closure.json"), { selected_child_completed: true, exit_code: 0, preservation_verified: true, own_inherited_descriptor_positive_closed: closed, interruptions: [] });
  const dir = openSync(output, constants.O_RDONLY); try { fsyncSync(dir); } finally { closeSync(dir); }
  console.log(JSON.stringify({ qualified: true, cases: cases.length, version: "8.24.3" }));
}

function privateBytes(path, wantedMode, maxBytes = Infinity, ownerUid = process.getuid()) {
  if (!isAbsolute(path ?? "") || resolve(path) !== path || path === REPO || path.startsWith(REPO + sep)) refuse("scanner custody path is not private and absolute");
  let part = sep;
  for (const component of dirname(path).split(sep).filter(Boolean)) {
    part = join(part, component);
    if (lstatSync(part).isSymbolicLink()) refuse("scanner custody contains a symlink");
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const shape = (st) => [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs, st.mode, st.uid, st.nlink].join(":");
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.uid !== ownerUid || (opened.mode & 0o777) !== wantedMode || opened.size > maxBytes) refuse("private custody is not a frozen owner file");
    const data = readFileSync(fd), final = fstatSync(fd), last = lstatSync(path);
    if (![final, last].every((st) => shape(st) === shape(opened))) refuse("scanner custody changed while reading");
    return data;
  } finally { closeSync(fd); }
}

// This is privileged controller state, not a knowledge note or a worker claim.
// Only a source/privacy reviewer with existing owner/role authority may issue a
// frozen receipt after reviewing the exact inputs and artifact. Neither this
// publisher nor the tick creates, repairs or upgrades a clearance.
// Deployment requires a separate reviewer principal: the controller parent is
// publisher-owned 0700; the reviewer owns clearances/ (0711) and its read-only
// files (0444). The private parent keeps evidence inaccessible to other users.
// Account/ACL provisioning and actual reviewer qualification are separate work.
// On Darwin, remove ACLs with chmod -N on clearances/ and every receipt/evidence
// file, then verify ls -led. The private parent's reviewer search ACL is separate.
function requireReviewerReadOnly(path, fixture = false) {
  if (process.platform === "darwin") {
    // W_OK misses writesecurity: an ACL may allow a later write grant. Darwin
    // can display @ instead of + when extended attributes and an ACL coexist,
    // so inspect both the mode and the complete -e ACL output.
    const acl = spawnSync("/bin/ls", ["-lde", path], {
      env: { PATH: TOOL_PATH, LANG: "C", LC_ALL: "C" },
      encoding: "utf8", timeout: 5000, maxBuffer: 65536,
    });
    const lines = (acl.stdout ?? "").trimEnd().split("\n");
    const mode = lines[0]?.split(/\s+/, 1)[0] ?? "";
    if (acl.error || acl.signal || acl.status !== 0 || (acl.stderr ?? "").trim() ||
        lines.length !== 1 || !/^[d-][rwxstST-]{9}@?$/.test(mode)) {
      refuse("reviewer custody ACL is present or unavailable");
    }
  }
  // Only the existing internal synthetic principal fixture skips W_OK. Real
  // Darwin ACL checks still run in that fixture; production never relaxes it.
  if (fixture) return;
  try { accessSync(path, constants.W_OK); }
  catch (e) {
    if (e.code === "EACCES" || e.code === "EPERM") return;
    refuse("reviewer custody is unavailable");
  }
  refuse("reviewer custody is writable by the publisher account");
}

function worktreeOwner(path) {
  const entry = lstatSync(realpathSync(path));
  if (!entry.isDirectory()) refuse("worker checkout is not a directory");
  return entry.uid;
}

function validatePrivacyClearanceEnvelope(value, job, now) {
  if (typeof job !== "string" || !/^[A-Za-z0-9_-]+$/.test(job) ||
      value?.format !== "signalgrid-publication-privacy-clearance/v2" || value.job !== job ||
      value.request?.format !== "signalgrid-publication-privacy-request/v1" || value.request.job !== job ||
      !/^[0-9a-f]{64}$/.test(value.request.job_sha256 ?? "") || !/^[0-9a-f]{64}$/.test(value.request.publisher_sha256 ?? "") ||
      !full40(value.request.head) || !full40(value.request.tree) || !full40(value.request.replay_base) ||
      !Number.isSafeInteger(value.request.worker_uid) || value.request.worker_uid < 0 || value.request.worker_uid > 0xffffffff) refuse("artifact-specific privacy clearance is invalid");
  const issued = timestamp(value.issued_at), expires = timestamp(value.expires_at);
  if (!Number.isSafeInteger(now) || now < 0 || issued > now || expires <= now || expires <= issued || expires - issued > MAX_PRIVACY_TTL_MS) refuse("artifact-specific privacy clearance is invalid or expired");
  const sourceRef = value.source_review?.evidence_ref, artifactRef = value.artifact_review?.evidence_ref;
  if (!sourceRef || !artifactRef || sourceRef.path === artifactRef.path || sourceRef.sha256 === artifactRef.sha256) refuse("source and artifact privacy reviews need distinct evidence");
  return issued;
}

/** Validate content only, using exact evidence Buffers and an explicit clock.
 * This performs no I/O and grants no publication authority. The production
 * reader separately enforces the real reviewer principal and all custody. */
export function validatePrivacyClearanceContent(value, evidence, request, now) {
  const issued = validatePrivacyClearanceEnvelope(value, request?.job, now);
  if (valueDigest(value.request) !== valueDigest(request)) refuse("privacy clearance does not match the exact job, sources, publisher and artifact");
  for (const [name, decision] of [["source_review", "public_only"], ["artifact_review", "public_safe"]]) {
    const review = value[name], ref = review?.evidence_ref, bytes = evidence?.[name];
    if (review?.decision !== decision || !["codex", "claude", "owner"].includes(review.system) || !ref ||
        typeof ref.path !== "string" || !/^[0-9a-f]{64}$/.test(ref.sha256 ?? "")) refuse("source and artifact privacy reviews are required");
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > (1 << 20) || digest(bytes) !== ref.sha256) refuse("privacy review evidence changed");
    let reviewed;
    try { reviewed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { refuse("privacy review evidence is not a bound structured review"); }
    if (reviewed?.format !== "signalgrid-publication-privacy-review/v1" || reviewed.job !== request.job || reviewed.review_kind !== name ||
        reviewed.request_sha256 !== valueDigest(request) || reviewed.system !== review.system || reviewed.decision !== decision ||
        typeof reviewed.summary !== "string" || !reviewed.summary.trim() || reviewed.summary.length > 16000) refuse("privacy review evidence is not a bound structured review");
    const reviewedAt = timestamp(reviewed.reviewed_at);
    if (reviewedAt > issued || reviewedAt < issued - MAX_PRIVACY_TTL_MS) refuse("privacy review evidence is outside its review window");
  }
  return true;
}

function readPrivacyClearance(job) {
  if (!/^[A-Za-z0-9_-]+$/.test(job ?? "")) refuse("privacy clearance job identity is invalid");
  const root = SELF_TEST_SCANNER?.privacyRoot ?? PRIVACY_CLEARANCES;
  try {
    const directory = lstatSync(root);
    if (!isAbsolute(root) || resolve(root) !== root || root === REPO || root.startsWith(REPO + sep) || realpathSync(root) !== root ||
        !directory.isDirectory()) refuse("privacy clearance directory is not private controller state");
    const fixture = SELF_TEST_SCANNER?.privacyReviewerFixture === true;
    if (!fixture && directory.uid === process.getuid()) refuse("privacy clearance requires an independent reviewer account");
    const parent = lstatSync(dirname(root)), mode = fixture ? 0o400 : 0o444;
    if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o777) !== 0o700 ||
        (directory.mode & 0o777) !== (fixture ? 0o700 : 0o711)) refuse("privacy clearance directory custody is invalid");
    requireReviewerReadOnly(root, fixture);
    const path = join(root, job + ".json");
    requireReviewerReadOnly(path, fixture);
    const bytes = privateBytes(path, mode, 1 << 20, directory.uid);
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    validatePrivacyClearanceEnvelope(value, job, Date.now());
    if (!fixture && directory.uid === value.request.worker_uid) refuse("privacy reviewer must differ from the worker checkout owner");
    const records = {};
    for (const [name, decision] of [["source_review", "public_only"], ["artifact_review", "public_safe"]]) {
      const review = value[name], ref = review?.evidence_ref;
      if (review?.decision !== decision || !["codex", "claude", "owner"].includes(review.system) || !ref ||
          typeof ref.path !== "string" || !ref.path.startsWith(root + sep) || ref.path === path ||
          ref.mode !== mode || ref.uid !== directory.uid || !/^[0-9a-f]{64}$/.test(ref.sha256 ?? "")) refuse("source and artifact privacy reviews are required");
      requireReviewerReadOnly(ref.path, fixture);
      records[name] = privateBytes(ref.path, mode, 1 << 20, directory.uid);
    }
    validatePrivacyClearanceContent(value, records, value.request, Date.now());
    const end = lstatSync(root);
    if (["dev", "ino", "uid", "mode"].some((key) => end[key] !== directory[key])) refuse("privacy clearance directory changed");
    requireReviewerReadOnly(root, fixture);
    return { value, path, sha256: digest(bytes) };
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse("artifact-specific source/privacy clearance is unavailable");
  }
}

function makePrivacyRequest(job, workerHead, patch, replayBase, artifact) {
  if (!full40(workerHead)) refuse("privacy request requires the original full worker head");
  // Include complete public metadata, author headers and the PR body as well as
  // files. Publication reuses this prepared commit; it never substitutes newly
  // generated metadata after privacy review.
  const exports = artifact.exports.map(({ source, sha256, bytes }) => ({ source, sha256, bytes: bytes.length }))
    .sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0);
  return { format: "signalgrid-publication-privacy-request/v1", job: job.id,
    job_sha256: valueDigest(job), publisher_sha256: publisherDigest(), worker_head: workerHead, worker_uid: worktreeOwner(job.worktree),
    patch_sha256: digest(Buffer.from(patch)), replay_base: replayBase, head: artifact.head, tree: artifact.tree, exports };
}

function requirePrivacyClearance(request) {
  const clearance = readPrivacyClearance(request.job);
  if (valueDigest(clearance.value.request) !== valueDigest(request)) refuse("privacy clearance does not match the exact job, sources, publisher and artifact");
  return clearance;
}

function scannerRef(ref, expectedSha, mode) {
  if (!ref || ref.mode !== mode || ref.uid !== process.getuid() || !/^[0-9a-f]{64}$/.test(ref.sha256 ?? "")) refuse("scanner full reference is invalid");
  const data = privateBytes(ref.path, mode);
  if (digest(data) !== ref.sha256 || (expectedSha && ref.sha256 !== expectedSha) || (ref.bytes !== undefined && ref.bytes !== data.length)) refuse("scanner full reference changed");
  return data;
}

function scannerConfiguration() {
  let manifest;
  try { manifest = JSON.parse(privateBytes(SCANNER_MANIFEST, 0o400).toString("utf8")); }
  catch (e) { if (e instanceof Refusal) throw e; refuse("qualified private publication scanner is unavailable"); }
  if (manifest.format !== "signalgrid-publication-scanner/v1") refuse("publication scanner manifest format is invalid");
  const { binary, config, qualification, closure } = manifest;
  scannerRef(binary, SCANNER_SHA, 0o500);
  scannerRef(config, CONFIG_SHA, 0o400);
  let qualified, closed;
  try {
    qualified = JSON.parse(scannerRef(qualification, null, 0o400));
    closed = JSON.parse(scannerRef(closure, null, 0o400));
  } catch (e) { if (e instanceof Refusal) throw e; refuse("publication scanner qualification is invalid"); }
  if (qualified.format !== "signalgrid-gitleaks-qualification-result/v3" || qualified.qualified !== true || qualified.version !== "8.24.3" || qualified.opaque_export_naming !== "entry-[0-9]{6}" || qualified.source_extension_skip_and_opaque_detection_verified !== true || !sameFields(qualified.private_executable_ref, binary) || !sameFields(qualified.strict_config_ref, config) || !Array.isArray(qualified.interruptions) || qualified.interruptions.length) refuse("publication scanner was not qualified for these bytes and opaque exports");
  const requiredCases = REQUIRED_SCANNER_CASES;
  if (!Array.isArray(qualified.cases) || qualified.cases.length !== Object.keys(requiredCases).length || qualified.original_waits_complete !== true || qualified.raws_fsynced !== true) refuse("publication scanner qualification controls are incomplete");
  for (const [name, code] of Object.entries(requiredCases)) {
    const records = qualified.cases.filter((item) => item.name === name);
    if (records.length !== 1 || records[0].returncode !== code || records[0].result_ref?.path !== join(dirname(qualification.path), "results", name + ".json")) refuse("publication scanner qualification case is missing");
    let result;
    try { result = JSON.parse(scannerRef(records[0].result_ref, null, 0o400)); }
    catch (e) { if (e instanceof Refusal) throw e; refuse("publication scanner case receipt is invalid"); }
    if (result.name !== name || result.returncode !== code || result.normal_exit !== true || result.original_wait_completed !== true || !Array.isArray(result.interruptions) || result.interruptions.length || result.raw_secret_redaction_verified !== true || (code === 2 && !(result.credential_finding_count > 0))) refuse("publication scanner case lacks actual normal evidence");
  }
  if (qualified.version_result_ref?.path !== join(dirname(qualification.path), "results", "version.json")) refuse("publication scanner actual version receipt is missing");
  let versionResult;
  try { versionResult = JSON.parse(scannerRef(qualified.version_result_ref, null, 0o400)); }
  catch (e) { if (e instanceof Refusal) throw e; refuse("publication scanner version receipt is invalid"); }
  if (versionResult.name !== "version" || versionResult.returncode !== 0 || versionResult.normal_exit !== true || versionResult.original_wait_completed !== true || !Array.isArray(versionResult.interruptions) || versionResult.interruptions.length) refuse("publication scanner version did not complete normally");
  const extension = qualified.source_extension_control;
  if (!extension || extension.raw_named_case !== "raw-svg-default-path-exclusion" || extension.opaque_case !== "opaque-svg-credential" || extension.identical_bytes !== true) refuse("publication scanner extension control is unverified");
  const rawSvg = scannerRef(extension.raw_source_ref, null, 0o400), opaqueSvg = scannerRef(extension.opaque_export_ref, null, 0o400);
  if (!rawSvg.equals(opaqueSvg)) refuse("publication scanner SVG controls used different source bytes");
  scannerRef(extension.private_mapping_ref, null, 0o400);
  if (dirname(qualification.path) !== dirname(closure.path) || closure.path !== join(dirname(qualification.path), "child-closure.json") || closed.selected_child_completed !== true || closed.exit_code !== 0 || closed.preservation_verified !== true || closed.own_inherited_descriptor_positive_closed !== true || !Array.isArray(closed.interruptions) || closed.interruptions.length) refuse("publication scanner original closure is unverified");
  const ignore = qualified.empty_ignore_ref;
  if (scannerRef(ignore, digest(Buffer.alloc(0)), 0o400).length) refuse("publication scanner ignore file is not empty");
  return { binary, config, ignore, qualification, closure };
}

function safePath(file) {
  if (typeof file !== "string" || !file.length) return false;
  return [file, privacyText(file)].every((name) => !name.startsWith("/") && !/[\x00-\x1f\x7f\\]/.test(name) && !name.split("/").some((p) => p === "" || p === ".." || p === "." || SCAN_CONTROL.test(p) || PRIVATE_DIRECTORY.test(p) || EXECUTION_CONTROL.test(p)) && !PRIVATE.test(name) && !PRIVATE_MARKUP.test(name));
}

function ordinaryHooks(wt, repo) {
  requireHookDependencies();
  if (SELF_TEST_SCANNER && !SELF_TEST_SCANNER.enforceOrdinaryHookChecks) return []; // Only the unexported synthetic fixture sets this.
  rejectExecutableLocalConfig(repo);
  // --all includes inherited pushurls and the fallback URL list. Requiring one
  // exact destination also avoids publishing the same attempt multiple times.
  for (const args of [["remote", "get-url", "--all", "origin"], ["remote", "get-url", "--push", "--all", "origin"]]) {
    if (gitOk(repo, args).trim() !== "git@github.com:DanFashauer/SignalGrid-Review-Hub.git") refuse("publication remote is not the existing canonical SSH repository");
  }
  const hook = gitOk(wt, ["config", "--get", "core.hooksPath"]).trim();
  const common = gitOk(repo, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  const path = isAbsolute(hook) ? resolve(hook) : resolve(wt, hook);
  const allowed = [resolve(wt, ".githooks"), resolve(repo, ".githooks"), resolve(dirname(common), ".githooks")];
  if (!allowed.includes(path) || realpathSync(path) !== path || JSON.stringify(readdirSync(path).sort()) !== '["pre-push"]') refuse("ordinary publication hooks are not the approved source");
  const fd = openSync(join(path, "pre-push"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd), bytes = readFileSync(fd), after = fstatSync(fd), named = lstatSync(join(path, "pre-push"));
    if (!before.isFile() || before.uid !== process.getuid() || before.nlink !== 1 || !(before.mode & 0o111) || (before.mode & 0o022) || digest(bytes) !== ORDINARY_PRE_PUSH_SHA ||
        [after, named].some((st) => ["dev", "ino", "size", "mtimeMs", "ctimeMs", "mode", "uid", "nlink"].some((k) => st[k] !== before[k]))) refuse("ordinary pre-push hook source changed");
  } finally { closeSync(fd); }
  // Select the approved ordinary hook explicitly; worker Git config cannot
  // redirect the commit or push. This hook still runs, including its lock gate.
  return ["-c", `core.hooksPath=${path}`];
}

function refuseActiveFilters(wt, files) {
  for (const file of files) {
    const value = gitBytes(wt, ["check-attr", "-z", "filter", "--", file]).toString("utf8").split("\0");
    if (value.length !== 4 || value[0] !== file || value[1] !== "filter" || !["unspecified", "unset"].includes(value[2])) refuse("publication cannot execute a file filter");
  }
}

function checkPublicText(data) {
  if (data.includes(0)) refuse("publication export contains binary data");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { refuse("publication export is not complete UTF-8 text"); }
  const normalized = privacyText(text);
  if (PRIVATE.test(normalized) || PRIVATE_MARKUP.test(normalized) || AWS_KEY.test(normalized) || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(normalized)) refuse("publication export contains private material or credential-shaped text");
  return text;
}

function gitBytes(dir, args, env) {
  const result = spawnSync(GIT_BINARY, ["--no-replace-objects", "-C", dir, ...GIT_EXTRA, "-c", "core.fsmonitor=false", ...args], { env: gitEnv(env), maxBuffer: MAX_SCAN_TOTAL + (1 << 20), timeout: 120000, killSignal: "SIGKILL" });
  if (result.error || result.status !== 0) refuse("cannot read complete committed publication bytes");
  return result.stdout;
}

function gitPaths(dir, args, env) {
  const bytes = gitBytes(dir, args, env);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { refuse("publication path names are not complete UTF-8"); }
  if (text && !text.endsWith("\0")) refuse("publication path inventory is incomplete");
  return text ? text.slice(0, -1).split("\0") : [];
}

function committedExport(wt, replayBase, wantedFiles, title, body) {
  const head = gitOk(wt, ["rev-parse", "HEAD"]).trim(), tree = gitOk(wt, ["rev-parse", "HEAD^{tree}"]).trim();
  if (!full40(head) || !full40(tree) || !full40(replayBase)) refuse("publication identity is not full40");
  // Inspect the actual object, without replacement refs or a net-diff shortcut.
  // A post-commit hook may otherwise hide intermediate history in a clean tip.
  const commit = gitBytes(wt, ["cat-file", "commit", head]);
  const objectId = createHash("sha1").update(Buffer.from(`commit ${commit.length}\0`)).update(commit).digest("hex");
  const headers = commit.toString("utf8").split("\n\n", 1)[0].split("\n");
  const parents = headers.filter((line) => line.startsWith("parent "));
  if (objectId !== head || parents.length !== 1 || parents[0] !== `parent ${replayBase}` || headers.filter((line) => line.startsWith("tree ")).join("") !== `tree ${tree}`) refuse("publication must contain a single new commit with sole parent replayBase");
  const files = gitPaths(wt, ["diff", "--no-renames", "--name-only", "-z", replayBase, head]);
  if (!files.length || JSON.stringify([...files].sort()) !== JSON.stringify([...wantedFiles].sort())) refuse("committed publication paths changed during normal hooks");
  const cls = classifyDiff(files);
  if (cls.matched.length || files.some((file) => !safePath(file) || DENY.some((rule) => rule.test(file)))) refuse("committed publication contains a refused path");
  const exports = [];
  let total = 0;
  const add = (name, bytes) => {
    if (bytes.length > MAX_SCAN_FILE || (total += bytes.length) > MAX_SCAN_TOTAL) refuse("publication export exceeds complete screening bounds");
    checkPublicText(bytes);
    exports.push({ name: `entry-${String(exports.length).padStart(6, "0")}`, source: name, bytes, sha256: digest(bytes) });
  };
  for (const file of files) {
    const record = gitBytes(wt, ["ls-tree", "-z", head, "--", file]).toString("utf8");
    if (!record) { add(`deleted/${file}.txt`, Buffer.from(`Deleted public path: ${file}\n`)); continue; }
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t([^\0]+)\0$/.exec(record);
    if (!match || match[3] !== file) refuse("publication export is a symlink, gitlink or unknown object");
    const size = Number(gitOk(wt, ["cat-file", "-s", match[2]]).trim());
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SCAN_FILE) refuse("publication blob cannot be screened completely");
    const bytes = gitBytes(wt, ["cat-file", "blob", match[2]]);
    if (bytes.length !== size) refuse("publication blob read was incomplete");
    add(`files/${file}`, bytes);
  }
  add("metadata/title.txt", Buffer.from(title));
  add("metadata/body.md", Buffer.from(body));
  add("metadata/commit.txt", commit);
  add("metadata/paths.json", Buffer.from(JSON.stringify(files)));
  return { head, tree, files, exports };
}

function scanPublication(artifact) {
  const scanner = SELF_TEST_SCANNER ? SELF_TEST_SCANNER.configuration() : scannerConfiguration();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "brain-publication-scan-")));
  chmodSync(root, 0o700);
  const source = join(root, "export");
  mkdirSync(source, { mode: 0o700 });
  try {
    // Default scanner path allowlists can skip otherwise valid text such as
    // SVG. Only opaque extension-neutral names enter the scanner's input tree.
    const mapping = Buffer.from(JSON.stringify(artifact.exports.map(({ name, source: original, sha256 }) => ({ name, source: original, sha256 }))));
    const mappingPath = join(root, "mapping.json");
    writeFileSync(mappingPath, mapping, { flag: "wx", mode: 0o400 });
    for (const item of artifact.exports) {
      if (!/^entry-[0-9]{6}$/.test(item.name)) refuse("publication export name is not opaque");
      const target = join(source, item.name);
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      writeFileSync(target, item.bytes, { flag: "wx", mode: 0o400 });
      if (digest(readFileSync(target)) !== item.sha256) refuse("publication export changed while writing");
    }
    const inventory = () => {
      if (digest(readFileSync(mappingPath)) !== digest(mapping)) refuse("private publication source mapping changed");
      const found = [];
      const walk = (dir, prefix = "") => {
        for (const name of readdirSync(dir)) {
          const path = join(dir, name), relative = prefix + name, st = lstatSync(path);
          if (st.isSymbolicLink() || st.uid !== process.getuid() || SCAN_CONTROL.test(name)) refuse("publication scan export contains an unsafe object");
          if (st.isDirectory()) { if ((st.mode & 0o777) !== 0o700) refuse("publication scan directory is not private"); walk(path, relative + "/"); }
          else {
            if (!st.isFile() || st.nlink !== 1 || (st.mode & 0o777) !== 0o400) refuse("publication scan export is not immutable regular bytes");
            found.push([relative, digest(privateBytes(path, 0o400))]);
          }
        }
      };
      walk(source);
      const expected = artifact.exports.map((item) => [item.name, item.sha256]);
      if (JSON.stringify(found.sort()) !== JSON.stringify(expected.sort())) refuse("publication scan export inventory changed");
    };
    inventory();
    const report = join(root, "report.json");
    const argv = ["dir", "--redact=100", "--exit-code=2", "--no-banner", "--no-color", "--ignore-gitleaks-allow", "--config", scanner.config.path, "--gitleaks-ignore-path", scanner.ignore.path, "--report-format=json", "--report-path", report, source];
    const options = { cwd: root, env: { LANG: "C", LC_ALL: "C", TZ: "UTC" }, encoding: "utf8", maxBuffer: 1 << 20, timeout: 30000, killSignal: "SIGKILL" };
    const result = SELF_TEST_SCANNER ? SELF_TEST_SCANNER.invoke(scanner.binary.path, argv, options) : spawnSync(scanner.binary.path, argv, options);
    if (result.error || result.status !== 0 || result.signal || /partial scan completed/i.test((result.stdout ?? "") + (result.stderr ?? ""))) refuse("publication credential screening refused or did not complete");
    let empty = false;
    try {
      const fd = openSync(report, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const st = fstatSync(fd);
        if (!st.isFile() || st.nlink !== 1 || st.uid !== process.getuid()) refuse("scanner report is not owned regular bytes");
        fchmodSync(fd, 0o400);
        const value = JSON.parse(readFileSync(fd, "utf8"));
        empty = value === null || (Array.isArray(value) && value.length === 0);
      } finally { closeSync(fd); }
    } catch { /* absent, malformed and unsafe reports fail closed */ }
    if (!empty) refuse("publication credential screening report is missing or nonempty");
    inventory();
    if (!SELF_TEST_SCANNER) scannerConfiguration();
  } finally { rmSync(root, { recursive: true, force: true }); }
}

export async function run({ job, db = DEFAULT_DB, repo = REPO, publish = false, log = console.log }) {
  if (!/^[A-Za-z0-9_-]+$/.test(job ?? "")) refuse("--job <id> is required (letters, digits, - and _ only); there is no auto-selection");
  const j = await readJob(db, job);
  if (!j) refuse(`job ${job} not found in the brain DB`);
  const originalJobProjection = JSON.stringify(j);
  const want = { kind: "build", status: "review", repo: "SignalGrid-Review-Hub" };
  for (const [k, v] of Object.entries(want)) if (j[k] !== v) refuse(`job ${job} has ${k}=${j[k]}; only ${k}=${v} is publishable`);
  if (j.cancel_requested !== 0) refuse(`job ${job} cancellation state is not publishable`);
  if (!j.worktree || !existsSync(j.worktree)) refuse(`job ${job} has no worktree on disk`);
  const title = String(j.title ?? "").trim();
  const result = decode(j.result).trim();
  checkPublicText(Buffer.from(job));
  checkPublicText(Buffer.from(title));
  if (PRIVATE.test(privacyText(result))) refuse("job result names a private path");

  const { patch, files } = worktreePatch(j.worktree);
  const workerHead = sourceGitBytes(j.worktree, ["rev-parse", "HEAD"]).toString("utf8").trim();
  if (!patch.trim() || files.length === 0) refuse(`job ${job}: the worktree diff is empty`);
  const bad = [];
  for (const f of files) {
    if (!safePath(f)) bad.push(`${f} (unsafe publication path)`);
    if (DENY.some((re) => re.test(f))) bad.push(`${f} (governance/heartbeat deny list)`);
  }
  const cls = classifyDiff(files);
  for (const m of cls.matched) bad.push(`${m.file} (${m.category}: ${m.rule})`);
  log(`job ${job}: ${title}`);
  log(`files (${files.length}):\n${files.map((f) => `  ${f}`).join("\n")}`);
  log(`classification: ${cls.tier}${cls.matched.map((m) => `\n  ${m.category} ${m.file} — ${m.rule}`).join("")}`);
  if (bad.length) refuse(`job ${job} touches paths this route never publishes:\n${bad.map((b) => `  ${b}`).join("\n")}`);

  const branch = `brain/job-${job}`;
  // A refused job must not even start remote inspection. All local reads above
  // use the non-fetching worker boundary and trusted Git execution context.
  const selectedPrivacy = publish ? readPrivacyClearance(job) : null;
  if (selectedPrivacy) {
    const wanted = selectedPrivacy.value.request;
    if (wanted.job_sha256 !== valueDigest(j) || wanted.publisher_sha256 !== publisherDigest() ||
        wanted.worker_head !== workerHead || wanted.worker_uid !== worktreeOwner(j.worktree) || wanted.patch_sha256 !== digest(Buffer.from(patch))) refuse("privacy clearance does not match the current job and source patch");
  }
  ordinaryHooks(repo, repo);
  if (publish) {
    const remote = gitOk(repo, ["ls-remote", "origin", `refs/heads/${branch}`]).trim();
    if (remote) { log(`${branch} already exists on origin — nothing pushed (idempotent)`); return { branch, files, pushed: false }; }
  }

  gitOk(repo, ["fetch", "-q", "origin", BASE]);
  const scratch = mkdtempSync(join(tmpdir(), "brain-pr-"));
  const wt = join(scratch, "wt");
  gitOk(repo, ["worktree", "add", "-q", "--detach", wt, "FETCH_HEAD"]);
  try {
    const replayBase = gitOk(wt, ["rev-parse", "HEAD"]).trim();
    refuseActiveFilters(wt, files);
    const pf = join(scratch, "job.patch");
    writeFileSync(pf, patch);
    const ap = git(wt, ["apply", "--3way", "--index", pf]);
    const unmerged = git(wt, ["diff", "--name-only", "--diff-filter=U"]).out.trim();
    if (!ap.ok || unmerged) refuse(`job ${job}: the patch does not apply cleanly to origin/${BASE}\n${ap.err.trim()}${unmerged ? `\nunmerged: ${unmerged}` : ""}`);
    const prTitle = `brain: ${title.slice(0, 80)} (job ${job})`;
    if (selectedPrivacy) {
      const approved = selectedPrivacy.value.request, proposedTree = gitOk(wt, ["write-tree"]).trim();
      if (approved.replay_base !== replayBase || approved.tree !== proposedTree) refuse("privacy clearance does not match the current replay base and tree");
      const raw = gitBytes(wt, ["cat-file", "commit", approved.head]);
      const oid = createHash("sha1").update(Buffer.from(`commit ${raw.length}\0`)).update(raw).digest("hex");
      const headers = raw.toString("utf8").split("\n\n", 1)[0].split("\n");
      if (oid !== approved.head || headers.filter((s) => s.startsWith("parent ")).join("") !== `parent ${replayBase}` ||
          headers.filter((s) => s.startsWith("tree ")).join("") !== `tree ${proposedTree}`) refuse("prepared privacy-reviewed commit is unavailable or has changed");
      // This is only the owned disposable replay worktree. Reuse the exact
      // reviewed object so author/time/body bytes cannot change after approval.
      gitOk(wt, ["reset", "--hard", approved.head]);
    } else {
      gitOk(wt, [...ordinaryHooks(wt, repo), "commit", "-q", "-m", `${prTitle}\n\nLocal-brain build job ${job}, published by the Mac lane on the owner's order.`]);
    }
    const publishedHead = gitOk(wt, ["rev-parse", "HEAD"]).trim();
    const publishedTree = gitOk(wt, ["rev-parse", "HEAD^{tree}"]).trim();
    const body = [
      "## Summary", "",
      `Local-brain build job \`${job}\` — "${title}".`, "",
      `The patch was replayed with \`git apply --3way --index\` onto \`${replayBase}\` from \`origin/${BASE}\`.`,
      `Published branch: \`${branch}\` at \`${publishedHead}\` (tree \`${publishedTree}\`).`, "",
      "## What changed", "", ...files.map((f) => `- \`${f}\``), "",
      "## Validation", "",
      "This publisher did not run full validation or independently verify worker completion claims. Worker-result text is not exported as evidence.", "",
      "Full applicable local validation, current-head required CI and independent Codex and Claude reviews remain required. Cloud lane: inspect this exact head and land only under the current owner requirements and DR-037, or return findings on this PR.", "",
      "## Public-safety note", "", "The route refused any file classified OWNER_RESERVED, DECISION_PATH or SAFETY_MACHINERY, and governance/heartbeat deny-list paths. A separate frozen source/privacy clearance bound to this exact job, publisher and artifact is required before push. Credential screening is not that clearance; private review evidence is not exported.", "",
      "## Remaining risks", "", "Successful replay and publication do not establish task completeness, passing gates, review acceptance or landing clearance. Findings and final-head validation remain to be resolved.", "",
    ].join("\n");
    const artifact = committedExport(wt, replayBase, files, prTitle, body);
    if (artifact.head !== publishedHead || artifact.tree !== publishedTree) refuse("committed publication identity changed before screening");
    scanPublication(artifact);
    const privacyRequest = makePrivacyRequest(j, workerHead, patch, replayBase, artifact);
    const privacy = publish ? requirePrivacyClearance(privacyRequest) : null;
    if (privacy && privacy.sha256 !== selectedPrivacy.sha256) refuse("privacy clearance changed during replay");
    if (gitOk(wt, ["rev-parse", "HEAD"]).trim() !== artifact.head || gitOk(wt, ["rev-parse", "HEAD^{tree}"]).trim() !== artifact.tree) refuse("committed publication identity changed after screening");
    if (JSON.stringify(await readJob(db, job)) !== originalJobProjection) refuse(`job ${job} changed before publication; original attempt is readback-only`);
    if (!publish) {
      const publicationMetadata = { format: "signalgrid-publication-prepared-metadata/v1",
        request_sha256: valueDigest(privacyRequest), title: prTitle, body };
      log(`dry run: privacy review is still required before pushing ${branch}`);
      log("SIGNALGRID_PUBLICATION_PRIVACY_REQUEST " + JSON.stringify(privacyRequest));
      log("SIGNALGRID_PUBLICATION_PREPARED_METADATA " + JSON.stringify(publicationMetadata));
      return { branch, files, pushed: false, replayBase, publishedHead, publishedTree, privacyRequest, publicationMetadata };
    }

    if (requirePrivacyClearance(privacyRequest).sha256 !== privacy.sha256) refuse("privacy clearance changed before push");
    gitOk(wt, [...ordinaryHooks(wt, repo), "push", "-q", "origin", `${publishedHead}:refs/heads/${branch}`]);
    const actualRemote = gitOk(repo, ["ls-remote", "origin", `refs/heads/${branch}`]).trim().split(/\s+/);
    if (actualRemote.length !== 2 || actualRemote[0] !== publishedHead || actualRemote[1] !== `refs/heads/${branch}`) refuse("pushed branch identity is unknown; exact readback required, no replay");
    const bf = join(scratch, "body.md");
    writeFileSync(bf, body);
    const gh = spawnSync("gh", ["pr", "create", "--repo", "github.com/DanFashauer/SignalGrid-Review-Hub", "--base", BASE, "--head", branch, "--title", prTitle, "--body-file", bf], { cwd: repo, encoding: "utf8", env: ghEnv(), timeout: 120000, killSignal: "SIGKILL", maxBuffer: 1 << 20 });
    if (gh.status !== 0) throw new Error(`pushed ${branch}, but gh pr create failed: ${(gh.stderr || gh.error?.message || "").trim()}`);
    const prUrl = gh.stdout.trim();
    if (!/^https:\/\/github\.com\/DanFashauer\/SignalGrid-Review-Hub\/pull\/[1-9][0-9]*$/.test(prUrl)) refuse("created PR URL is outside the canonical repository; exact readback required, no replay");
    const facts = { format: "signalgrid-publication-facts/v1", job, branch, base: BASE, replayBase, publishedHead, publishedTree, files: artifact.files, pushed: true, prUrl };
    log(prUrl);
    log(FACTS_MARKER + JSON.stringify(facts));
    return facts;
  } finally {
    git(repo, ["worktree", "remove", "--force", wt]);
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function selfTest() {
  scrubProcessGitEnv();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "brain-pr-st-")));
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
    // Portable boundary fixture only: it runs a separate synthetic executable,
    // with the real export/argv/config transport. Upstream compatibility has its
    // own actual pinned-binary qualification; this never claims that proof.
    const scannerBin = join(root, "synthetic-scanner"), scannerCfg = join(root, "strict.toml"), scannerIgnore = join(root, "empty.ignore");
    const strictConfig = readFileSync(join(REPO, "scripts/mac/publication-gitleaks.toml"), "utf8");
    if (digest(Buffer.from(strictConfig)) !== CONFIG_SHA) refuse("fixed publication scanner policy source changed");
    writeFileSync(scannerCfg, strictConfig, { mode: 0o400 });
    writeFileSync(scannerIgnore, "", { mode: 0o400 });
    writeFileSync(scannerBin, `#!${process.execPath}\n` + String.raw`
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const a = process.argv.slice(2), expected = ["dir", "--redact=100", "--exit-code=2", "--no-banner", "--no-color", "--ignore-gitleaks-allow", "--config", null, "--gitleaks-ignore-path", null, "--report-format=json", "--report-path", null, null];
const fail = (reason = "fixture contract") => { console.error("SYNTHETIC_SCANNER_REFUSAL: " + reason); process.exit(1); };
if (a.length !== expected.length || expected.some((v,i) => v !== null && a[i] !== v)) fail();
if (crypto.createHash("sha256").update(fs.readFileSync(a[7])).digest("hex") !== "7d0c4be43036be1e9834c920c415afabaa9998c18e12b8a7bf5c35a6f7532e85" || fs.readFileSync(a[9]).length || fs.realpathSync(a[13]) !== fs.realpathSync(path.join(process.cwd(), "export"))) fail("config, ignore or physical export path");
if (Object.keys(process.env).some(k => !["LANG", "LC_ALL", "TZ"].includes(k) && !(process.platform === "darwin" && k === "__CF_USER_TEXT_ENCODING"))) fail("environment keys: " + Object.keys(process.env).sort().join(","));
let finding = false, seen = [];
function walk(dir, prefix = "") {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir,name), st = fs.lstatSync(p), rel = prefix + name;
    if (st.isSymbolicLink() || /^(?:[.]git|[.]gitleaksignore|[.]gitleaks[.](?:toml|ya?ml|json))$/i.test(name)) fail();
    if (st.isDirectory()) walk(p, rel + "/");
    else {
      if (!st.isFile() || st.nlink !== 1 || (st.mode & 511) !== 256) fail();
      const bytes = fs.readFileSync(p); if (bytes.includes(0)) fail();
      let text; try { text = new TextDecoder("utf-8", {fatal:true}).decode(bytes); } catch { fail(); }
      if (/\bghp_[A-Za-z0-9]{36}\b/.test(text)) finding = true;
      seen.push(rel);
    }
  }
}
walk(a[13]);
const mapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), "mapping.json"), "utf8"));
if (!Array.isArray(mapping) || mapping.length !== seen.length || !mapping.every(m => /^entry-[0-9]{6}$/.test(m.name) && seen.includes(m.name)) || !["metadata/title.txt", "metadata/body.md", "metadata/commit.txt", "metadata/paths.json"].every(p => mapping.some(m => m.source === p)) || !mapping.some(m => m.source.startsWith("files/"))) fail();
fs.writeFileSync(a[12], JSON.stringify(finding ? [{RuleID:"github-pat", Fingerprint:"synthetic:notes.md:1"}] : []), {flag:"wx",mode:384});
process.exit(finding ? 2 : 0);
`);
    chmodSync(scannerBin, 0o500);
    const scannerFixture = { calls: 0, forceError: false, forceMissing: false, afterInvoke: null,
      configuration: () => ({ binary: { path: scannerBin }, config: { path: scannerCfg }, ignore: { path: scannerIgnore } }),
      invoke: (binary, argv, options) => {
        scannerFixture.calls++;
        if (binary !== scannerBin || argv[7] !== scannerCfg || argv[9] !== scannerIgnore || options.env.GITLEAKS_CONFIG || options.env.GITLEAKS_CONFIG_TOML) return { status: 1 };
        if (scannerFixture.forceError) return { status: 1, stdout: "", stderr: "synthetic scanner error" };
        if (scannerFixture.forceMissing) return { status: null, error: new Error("synthetic missing executable") };
        if (JSON.stringify(Object.keys(options.env).sort()) !== JSON.stringify(["LANG", "LC_ALL", "TZ"])) return { status: 1, stderr: "Synthetic boundary received an unclean caller environment" };
        const result = spawnSync(binary, argv, options);
        if (result.error || (result.status !== 0 && result.status !== 2)) console.error("Synthetic scanner boundary: " + (result.error?.message ?? result.stderr ?? "unknown exit"));
        if (scannerFixture.afterInvoke) scannerFixture.afterInvoke();
        return result;
      },
    };
    SELF_TEST_SCANNER = scannerFixture;
    const trustedGitHome = join(realpathSync(root), "trusted-git-home");
    mkdirSync(trustedGitHome, { mode: 0o700 });
    writeFileSync(join(trustedGitHome, ".gitconfig"), "", { mode: 0o400 });
    scannerFixture.gitHome = trustedGitHome;
    const trustedHookBin = join(realpathSync(root), "trusted-hook-bin");
    mkdirSync(trustedHookBin, { mode: 0o700 });
    writeFileSync(join(trustedHookBin, "pnpm"), `#!${process.execPath}\nprocess.exit(0);\n`, { mode: 0o500 });
    scannerFixture.toolPath = trustedHookBin + ":" + TOOL_PATH;
    const privacyRoot = join(realpathSync(root), "privacy-clearances");
    mkdirSync(privacyRoot, { mode: 0o700 });
    scannerFixture.privacyRoot = privacyRoot;
    const grantFixturePrivacy = (id, request, changes = {}, directory = privacyRoot) => {
      if (!request) return; // The pre-fix run must fail assertions, not fixture setup.
      const issued = Date.now();
      const evidenceRef = (kind, decision) => {
        const evidencePath = join(directory, id + "." + kind + ".json");
        const evidence = Buffer.from(JSON.stringify({ format: "signalgrid-publication-privacy-review/v1", job: id,
          review_kind: kind, request_sha256: valueDigest(request), system: "codex", decision,
          reviewed_at: new Date(issued).toISOString(), summary: "Synthetic reviewer fixture only; no real privacy approval." }) + "\n");
        writeFileSync(evidencePath, evidence, { flag: "wx", mode: 0o400 });
        return { path: evidencePath, sha256: digest(evidence), mode: 0o400, uid: process.getuid() };
      };
      writeFileSync(join(directory, id + ".json"), JSON.stringify({
        format: "signalgrid-publication-privacy-clearance/v2", job: id, request,
        source_review: { decision: "public_only", system: "codex", evidence_ref: evidenceRef("source_review", "public_only") },
        artifact_review: { decision: "public_safe", system: "codex", evidence_ref: evidenceRef("artifact_review", "public_safe") },
        issued_at: new Date(issued).toISOString(), expires_at: new Date(issued + MAX_PRIVACY_TTL_MS).toISOString(), ...changes,
      }), { flag: "wx", mode: 0o400 });
    };

    // Cloud HIGH-A: a mode-only, same-account receipt cannot grade its own job.
    // Synthetic reviewer simulation is confined to this unexported self-test.
    scannerFixture.privacyReviewerFixture = true;
    const privacyProbeRoot = join(realpathSync(root), "privacy-guard-probes");
    mkdirSync(privacyProbeRoot, { mode: 0o700 });
    const savedPrivacyRoot = scannerFixture.privacyRoot;
    scannerFixture.privacyRoot = privacyProbeRoot;
    const probeRequest = (id) => ({
      format: "signalgrid-publication-privacy-request/v1", job: id,
      job_sha256: "1".repeat(64), publisher_sha256: "2".repeat(64),
      worker_uid: process.getuid(), head: "3".repeat(40), tree: "4".repeat(40), replay_base: "5".repeat(40),
    });
    const mutateProbe = (id, change) => {
      const path = join(privacyProbeRoot, id + ".json"), value = JSON.parse(readFileSync(path, "utf8"));
      change(value); chmodSync(path, 0o600); writeFileSync(path, JSON.stringify(value)); chmodSync(path, 0o400);
    };
    const probeRefused = (id, needle = null) => {
      try { readPrivacyClearance(id); return false; }
      catch (e) { if (!(e instanceof Refusal)) throw e; return needle === null || e.message.includes(needle); }
    };
    try {
      grantFixturePrivacy("self-written", probeRequest("self-written"), {}, privacyProbeRoot);
      scannerFixture.privacyReviewerFixture = false;
      check("(privacy) publisher-account receipt is refused by the actual principal guard", probeRefused("self-written", "independent reviewer"));
      scannerFixture.privacyReviewerFixture = true;
      grantFixturePrivacy("overlong", probeRequest("overlong"), { expires_at: new Date(Date.now() + 7200000).toISOString() }, privacyProbeRoot);
      check("(privacy) a clearance cannot outlive the one-hour review window", probeRefused("overlong"));
      grantFixturePrivacy("shared-evidence", probeRequest("shared-evidence"), {}, privacyProbeRoot);
      mutateProbe("shared-evidence", (value) => { value.artifact_review.evidence_ref = value.source_review.evidence_ref; });
      check("(privacy) source and artifact reviews need distinct evidence files", probeRefused("shared-evidence"));
      grantFixturePrivacy("unreviewed-text", probeRequest("unreviewed-text"), {}, privacyProbeRoot);
      const unreviewed = join(privacyProbeRoot, "self-written-text.txt"), unreviewedBytes = Buffer.from("self-written; nobody reviewed anything\n");
      writeFileSync(unreviewed, unreviewedBytes, { flag: "wx", mode: 0o400 });
      mutateProbe("unreviewed-text", (value) => {
        value.artifact_review.evidence_ref = { path: unreviewed, sha256: digest(unreviewedBytes), uid: process.getuid(), mode: 0o400 };
      });
      check("(privacy) hashed text alone is not a structured artifact review", probeRefused("unreviewed-text"));
      // Import from a separate consumer process: awaiting this module's own
      // import while its top-level self-test is evaluating would deadlock.
      const consumer = spawnSync(process.execPath, ["--input-type=module", "-e",
        `const api = await import(${JSON.stringify(import.meta.url)}); process.stdout.write(typeof api.validatePrivacyClearanceContent);`],
        { encoding: "utf8", env: gitEnv(), timeout: 30000 });
      const publicAPI = { validatePrivacyClearanceContent: typeof validatePrivacyClearanceContent === "function" ? validatePrivacyClearanceContent : undefined };
      check("(privacy interface) the shared content validator is exported", consumer.status === 0 && consumer.stdout === "function");
      if (typeof publicAPI.validatePrivacyClearanceContent === "function") {
        const receipt = JSON.parse(readFileSync(join(privacyProbeRoot, "self-written.json"), "utf8"));
        const evidence = Object.fromEntries(["source_review", "artifact_review"].map((name) =>
          [name, readFileSync(receipt[name].evidence_ref.path)]));
        const now = timestamp(receipt.issued_at) + 1;
        check("(privacy interface) exact structured content passes without authorizing custody", publicAPI.validatePrivacyClearanceContent(receipt, evidence, receipt.request, now) === true);
        const rejects = (value, records = evidence, request = receipt.request, at = now) => {
          try { publicAPI.validatePrivacyClearanceContent(value, records, request, at); return false; }
          catch (e) { if (!(e instanceof Refusal)) throw e; return true; }
        };
        const copy = () => JSON.parse(JSON.stringify(receipt));
        const different = { ...receipt.request, tree: "6".repeat(40) };
        check("(privacy interface) a different prepared request is refused", rejects(receipt, evidence, different));
        check("(privacy interface) expiry is enforced at the supplied clock", rejects(receipt, evidence, receipt.request, timestamp(receipt.expires_at)));
        check("(privacy interface) an invalid clock cannot suppress expiry", rejects(receipt, evidence, receipt.request, NaN));
        const shared = copy(); shared.artifact_review.evidence_ref = shared.source_review.evidence_ref;
        check("(privacy interface) repeated source/artifact evidence is refused", rejects(shared));
        check("(privacy interface) modified evidence bytes are refused", rejects(receipt, { ...evidence, artifact_review: Buffer.from("{}\n") }));
        for (const [label, change] of [
          ["wrong review kind", (r) => { r.review_kind = "source_review"; }],
          ["wrong request digest", (r) => { r.request_sha256 = "0".repeat(64); }],
          ["wrong system", (r) => { r.system = "unknown"; }],
          ["wrong decision", (r) => { r.decision = "public_only"; }],
          ["empty summary", (r) => { r.summary = " "; }],
          ["future review", (r) => { r.reviewed_at = new Date(timestamp(receipt.issued_at) + 1).toISOString(); }],
        ]) {
          const value = copy(), record = JSON.parse(evidence.artifact_review.toString("utf8"));
          change(record); const bytes = Buffer.from(JSON.stringify(record) + "\n");
          value.artifact_review.evidence_ref.sha256 = digest(bytes);
          check("(privacy interface) " + label + " is refused after a matching byte hash", rejects(value, { ...evidence, artifact_review: bytes }));
        }
      }
      // Real Darwin ACLs on disposable synthetic custody. An ACL that grants
      // writesecurity must not survive as a valid privacy-review boundary.
      if (process.platform === "darwin") {
        const aclEnv = { PATH: TOOL_PATH, LANG: "C", LC_ALL: "C" };
        for (const kind of ["directory", "receipt", "source_review", "artifact_review"]) {
          const id = "acl-" + kind;
          grantFixturePrivacy(id, probeRequest(id), {}, privacyProbeRoot);
          const receiptPath = join(privacyProbeRoot, id + ".json");
          const value = JSON.parse(readFileSync(receiptPath, "utf8"));
          const target = kind === "directory" ? privacyProbeRoot : kind === "receipt" ? receiptPath : value[kind].evidence_ref.path;
          const before = spawnSync("/bin/ls", ["-lde", target], { encoding: "utf8", env: aclEnv });
          if (before.status !== 0 || before.stdout.trimEnd().split("\n").length !== 1 || before.stdout.split(/\s+/, 1)[0].includes("+")) throw new Error("Darwin ACL fixture did not start without ACLs");
          const grant = spawnSync("/bin/chmod", ["+a", "user:" + userInfo().username + " allow writesecurity", target], { encoding: "utf8", env: aclEnv });
          if (grant.status !== 0) throw new Error("Darwin writesecurity fixture could not be created");
          try {
            const listed = spawnSync("/bin/ls", ["-lde", target], { encoding: "utf8", env: aclEnv });
            const aclLines = listed.stdout.trimEnd().split("\n"), aclMode = listed.stdout.split(/\s+/, 1)[0];
            const actualACL = listed.status === 0 && listed.stdout.includes("writesecurity") &&
              (aclMode.includes("+") || aclLines.length > 1);
            if (!actualACL) throw new Error("Darwin ACL fixture was not observed: " +
              JSON.stringify({ status: listed.status, mode: aclMode, lines: aclLines.length, writesecurity: listed.stdout.includes("writesecurity") }));
            console.error("ACL_FIXTURE_OBSERVED " + JSON.stringify({ kind, mode: aclMode, lines: aclLines.length, writesecurity: true }));
            check("(privacy/Darwin) " + kind + " writesecurity ACL is refused", probeRefused(id));
          } finally {
            const remove = spawnSync("/bin/chmod", ["-N", target], { encoding: "utf8", env: aclEnv });
            if (remove.status !== 0) throw new Error("Own Darwin ACL fixture was not removed normally");
          }
        }
      } else {
        console.log("SKIP: four real Darwin custody ACL probes require macOS; not verified on this platform.");
      }
    } finally { scannerFixture.privacyRoot = savedPrivacyRoot; scannerFixture.privacyReviewerFixture = true; }

    // Cloud findings: every private representation crosses the production text
    // boundary, and package/Git control files never enter this publishing route.
    const privateForms = [
      "Library/Mobile Documents/iCloud~md~obsidian/fixture.md",
      "$HOME/Library/fixture.md", "${HOME}/Library/fixture.md",
      "/users/fixture/note.md", "/home/fixture/note.md", "C:\\Users\\fixture\\note.md",
      "%2FUsers%2Ffixture%2Fnote.md", "%252fUsers%252ffixture",
      String.raw`\u002fUsers\u002ffixture`, "&#x2f;Users&#x2f;fixture",
      ".obsidian/workspace.json", "---\ntags: [private]\n---\n[[Private note]]",
      "Public prose %% retained vault comment %%", "~/Library/fixture.md",
    ];
    let deeplyEncodedHome = "/Users/fixture/vault/note.md";
    for (let i = 0; i < 5; i++) deeplyEncodedHome = [...Buffer.from(deeplyEncodedHome)].map((b) => "%" + b.toString(16).padStart(2, "0")).join("");
    privateForms.push(deeplyEncodedHome, "&amp;sol;Users&amp;sol;fixture&amp;sol;note.md", "%u002fUsers%u002ffixture%u002fnote.md");
    privateForms.push(String.raw`/Us\u200bers/fixture/note.md`, String.raw`\u002f\uff35sers\u002ffixture`);
    for (let i = 0; i < privateForms.length; i++) {
      let blocked = false;
      try { checkPublicText(Buffer.from(privateForms[i])); }
      catch (e) { blocked = e instanceof Refusal; }
      check(`(security) private content class ${i} refused`, blocked);
    }
    for (const file of [".obsidian/workspace.json", "docs/.trash/note.md", "docs/vault/Daily.md",
      ".pnpmfile.cjs", ".npmrc", "packages/a/package.json", ".gitattributes", ".gitmodules",
      "pnpm-workspace.yaml", "pnpm-lock.yaml", "docs/.npmrc", "packages/a/package.yaml",
      "packages/a/package.yml", "packages/a/package.json5"]) {
      check(`(security) worker control/private path refused: ${file}`, !safePath(file));
    }
    check("(security) ordinary public text remains accepted", checkPublicText(Buffer.from("A public API returns a scalar value.\n")) === "A public API returns a scalar value.\n");
    check("(security) shallow public encoding remains accepted", checkPublicText(Buffer.from("Public spacing%2520and &amp; operators.\n")) === "Public spacing%2520and &amp; operators.\n");
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

    // LOW-C: the diff must use a private Git directory, never worker config
    // installed after the earlier configuration check.
    const configRace = brain("late-worker-filter", () => {});
    writeFileSync(join(configRace, ".gitattributes"), "docs/*.md filter=late\n");
    scratchGitOk(configRace, ["add", ".gitattributes"]);
    scratchGitOk(configRace, ["commit", "-q", "-m", "synthetic attribute fixture"]);
    const configRaceHead = scratchGitOk(configRace, ["rev-parse", "HEAD"]).trim();
    const configMarkerPath = join(root, "late-filter-ran"), filterProgram = join(root, "late-filter.cjs");
    writeFileSync(filterProgram, 'const fs=require("node:fs");fs.writeFileSync(' + JSON.stringify(configMarkerPath) + ',"ran");process.stdout.write(fs.readFileSync(0));\n', { flag: "wx", mode: 0o400 });
    const safeGit = join(root, "isolated-worker-git");
    scratchGitOk(root, ["init", "-q", "--bare", safeGit]);
    scratchGitOk(root, ["--git-dir", safeGit, "config", "core.bare", "false"]);
    writeFileSync(join(safeGit, "HEAD"), configRaceHead + "\n");
    writeFileSync(join(safeGit, "objects/info/alternates"), realpathSync(join(configRace, ".git/objects")) + "\n");
    scratchGitOk(root, ["--git-dir", safeGit, "--work-tree", configRace, "read-tree", "HEAD"]);
    rejectExecutableLocalConfig(configRace); // The initial inspection is clean.
    const commandQuote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
    scratchGitOk(configRace, ["config", "filter.late.clean", commandQuote(process.execPath) + " " + commandQuote(filterProgram)]);
    writeFileSync(join(configRace, "docs/x.md"), "one\nISOLATED CONFIG\nthree\n");
    const isolatedPatch = sourceGitBytes(configRace, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "HEAD"], {}, safeGit).toString("utf8");
    check("(security) late worker Git filters cannot execute during an isolated patch read", !existsSync(configMarkerPath) && isolatedPatch.includes("ISOLATED CONFIG"));

    const wDocs = brain("w-docs", (w) => { writeFileSync(join(w, "docs/x.md"), "one\nTWO\nthree\n"); writeFileSync(join(w, "docs/new.md"), "new\n"); });
    const wAgents = brain("w-agents", (w) => writeFileSync(join(w, "AGENTS.md"), "changed\n"));
    const wGate = brain("w-gate", (w) => { mkdirSync(join(w, "scripts"), { recursive: true }); writeFileSync(join(w, "scripts/check-x.mjs"), "gate\n"); });
    const wSecret = brain("w-secret", (w) => writeFileSync(join(w, "docs/notes.md"), "synthetic access key " + ["AKIA", "IOSFODNN7EXAMPLE"].join("") + "\n"));
    const wPrivate = brain("w-private", (w) => writeFileSync(join(w, "docs/notes.md"), "private input /Users/fixture/private-vault/note.md\n"));
    const syntheticGithub = ["ghp", ["9X4vM2kQ7sD5fJ8wR1", "bY6nA3eL0tC9pH4uZ2"].join("")].join("_");
    const wMixed = brain("w-mixed", (w) => writeFileSync(join(w, "docs/notes.md"), `sgk_demo_safe synthetic credential ${syntheticGithub}\n`));
    const wSvg = brain("w-svg", (w) => writeFileSync(join(w, "docs/drawing.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><!-- synthetic ${syntheticGithub} --></svg>\n`));
    const wHistory = brain("w-history", (w) => writeFileSync(join(w, "docs/history.md"), "Public final history fixture.\n"));
    const wHeader = brain("w-header", (w) => writeFileSync(join(w, "docs/header.md"), "Public header fixture.\n"));
    const wEmpty = brain("w-empty", () => {});
    const wConflict = brain("w-conflict", (w) => writeFileSync(join(w, "docs/x.md"), "one\nBRAIN\nthree\n"));
    const wConfig = brain("w-package-control", (w) => writeFileSync(join(w, ".pnpmfile.cjs"),
      'require("node:fs").writeFileSync(process.env.SYNTHETIC_CONFIG_MARKER,"executed");\n'));
    const wUnreviewed = brain("w-unreviewed", (w) => writeFileSync(join(w, "docs/notes.md"), "Synthetic unreviewed narrative, with no credential or private path.\n"));
    const wPrivateSource = brain("w-private-source", (w) => writeFileSync(join(w, "docs/notes.md"), "Synthetic private-source narrative, with no credential or private path.\n"));
    const wStalePrivacy = brain("w-stale-privacy", (w) => writeFileSync(join(w, "docs/notes.md"), "Public fixture before review.\n"));

    for (const key of ["core.fsmonitor", "diff.probe.textconv", "filter.probe.clean"]) {
      const marker = join(root, "config-marker-" + key.replaceAll(".", "-"));
      const executable = marker + ".cjs";
      writeFileSync(executable, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");\n`);
      chmodSync(executable, 0o500);
      const dirty = brain("w-config-" + key, (w) => {
        writeFileSync(join(w, "docs/x.md"), "changed public content\n");
        writeFileSync(join(w, ".gitattributes"), "docs/x.md diff=probe filter=probe\n");
        scratchGitOk(w, ["config", "--local", key, executable]);
      });
      let blocked = false;
      try { worktreePatch(dirty); } catch (e) { blocked = e instanceof Refusal; }
      check(`(security) ${key} refused before worker executable runs`, blocked && !existsSync(marker));
    }

    // A missing promisor object must never turn a worker read into a fetch.
    const fetchMarker = join(root, "lazy-fetch-marker"), uploadPack = join(root, "worker-upload-pack.cjs");
    writeFileSync(uploadPack, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(fetchMarker)}, "executed"); process.exit(1);\n`, { mode: 0o500 });
    const wPromisor = brain("w-promisor", (w) => writeFileSync(join(w, "docs/x.md"), "public worker edit\n"));
    const missingTree = scratchGitOk(wPromisor, ["rev-parse", "HEAD^{tree}"]);
    scratchGitOk(wPromisor, ["config", "remote.origin.url", "file://" + origin]);
    scratchGitOk(wPromisor, ["config", "remote.origin.promisor", "true"]);
    scratchGitOk(wPromisor, ["config", "remote.origin.uploadpack", uploadPack]);
    rmSync(join(wPromisor, ".git", "objects", missingTree.slice(0, 2), missingTree.slice(2)));
    let promisorRefused = false;
    try { worktreePatch(wPromisor); } catch (e) { promisorRefused = e instanceof Refusal; }
    check("(security) worker promisor configuration refuses before upload-pack executes", promisorRefused && !existsSync(fetchMarker));
    rmSync(fetchMarker, { force: true });
    const priorLazy = process.env.GIT_NO_LAZY_FETCH;
    process.env.GIT_NO_LAZY_FETCH = "0";
    let missingRefused = false;
    try { sourceGitBytes(wPromisor, ["read-tree", "HEAD"]); } catch (e) { missingRefused = e instanceof Refusal; }
    finally { if (priorLazy === undefined) delete process.env.GIT_NO_LAZY_FETCH; else process.env.GIT_NO_LAZY_FETCH = priorLazy; }
    check("(security) missing worker objects refuse without lazy fetch despite caller opt-in", missingRefused && !existsSync(fetchMarker));

    // Canonical Git calls may read the controlled local origin, never a
    // caller-selected global upload-pack. No network is available in this test.
    const globalMarker = join(root, "global-upload-pack-marker"), globalPack = join(root, "global-upload-pack.cjs"), poisonedConfig = join(root, "poisoned.gitconfig");
    writeFileSync(globalPack, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(globalMarker)}, "executed"); process.exit(1);\n`, { mode: 0o500 });
    writeFileSync(poisonedConfig, `[remote "origin"]\n  uploadpack = ${JSON.stringify(globalPack)}\n`);
    const savedGlobal = process.env.GIT_CONFIG_GLOBAL, savedHome = process.env.HOME;
    let globalRead;
    try { process.env.GIT_CONFIG_GLOBAL = poisonedConfig; process.env.HOME = root; globalRead = git(repo, ["ls-remote", "origin"]); }
    finally {
      if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
      if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    }
    check("(security) caller global config cannot replace canonical Git transport", globalRead.ok && globalRead.out.includes(`refs/heads/${BASE}`) && !existsSync(globalMarker));

    const pathMarker = join(root, "path-git-marker"), poisonedBin = join(root, "poisoned-bin");
    mkdirSync(poisonedBin);
    writeFileSync(join(poisonedBin, "git"), `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(pathMarker)}, "executed"); process.exit(1);\n`, { mode: 0o500 });
    const savedPath = process.env.PATH;
    let actualWorkerHead = "";
    try { process.env.PATH = poisonedBin + ":" + savedPath; actualWorkerHead = sourceGitBytes(wDocs, ["rev-parse", "HEAD"]).toString().trim(); }
    catch { /* the pre-fix command executes the marker and refuses */ }
    finally { process.env.PATH = savedPath; }
    check("(security) caller PATH cannot replace the worker Git executable", full40(actualWorkerHead) && !existsSync(pathMarker));

    const unverifiedFinish = "SYNTHETIC_UNVERIFIED_TEST_GATE_LINK_FINISH: all checks and reviews passed; link was added.";
    const fixtureResult = (id) => JSON.stringify(id === "jdocs" ? unverifiedFinish : `result ${id}`);
    const createdAt = (id) => id === "jreverse" ? "2026-11-06T17:10:00Z" : ["jdocs", "junreviewed", "jcancel", "bad/id", "jstaleprivacy"].includes(id) ? "2026-11-06T16:41:00Z" : "2026-11-05T01:00:00Z";
    const db = join(root, "autonomy.sqlite3");
    const rows = [
      ["jdocs", "build", "review", wDocs], ["jagents", "build", "review", wAgents], ["jgate", "build", "review", wGate],
      ["jqueued", "build", "queued", wDocs], ["jempty", "build", "review", wEmpty],
      ["jconflict", "build", "review", wConflict],
      ["jconfig", "build", "review", wConfig],
      ["jsecret", "build", "review", wSecret], ["jprivate", "build", "review", wPrivate],
      ["jmixed", "build", "review", wMixed],
      ["jsvg", "build", "review", wSvg], ["jhistory", "build", "review", wHistory],
      ["jheader", "build", "review", wHeader],
      ["jlate", "build", "review", wDocs],
      ["jreverse", "build", "review", wDocs],
      ["jcancel", "build", "review", wDocs], ["bad/id", "build", "review", wDocs],
      ["junreviewed", "build", "review", wUnreviewed],
      ["jprivateorigin", "build", "review", wPrivateSource],
      ["jstaleprivacy", "build", "review", wStalePrivacy],
      ["jmetadata", "build", "review", wDocs],
      ["jcallerhome", "build", "review", wDocs],
      ["jforeignurl", "build", "review", wDocs],
    ];
    if (isBuiltin("node:sqlite")) {
      const { DatabaseSync } = await import("node:sqlite");
      const d = new DatabaseSync(db);
      d.exec("CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT, created_at TEXT, cancel_requested INTEGER DEFAULT 0)");
      const ins = d.prepare("INSERT INTO autonomy_jobs VALUES (?, ?, ?, 'SignalGrid-Review-Hub', ?, ?, ?, '2026-11-06T17:00:00Z', ?, ?)");
      for (const [id, k, s, w] of rows) ins.run(id, k, s, w, `title ${id}`, fixtureResult(id), createdAt(id), id === "jcancel" ? 1 : 0);
      d.exec("ALTER TABLE autonomy_jobs ADD COLUMN source_ids TEXT DEFAULT '[]'; ALTER TABLE autonomy_jobs ADD COLUMN cloud_allowed INTEGER DEFAULT 0; ALTER TABLE autonomy_jobs ADD COLUMN evidence TEXT DEFAULT '{}';");
      d.prepare("UPDATE autonomy_jobs SET evidence=? WHERE id='jdocs'").run(JSON.stringify({ private_context: true, sources: [] }));
      d.prepare("UPDATE autonomy_jobs SET evidence=? WHERE id='jprivateorigin'").run(JSON.stringify({ private_context: true, sources: ["synthetic-private-vault-source"], privacy_clearance: { approved: true } }));
      d.close();
    } else {
      const sql = ["CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT, created_at TEXT, cancel_requested INTEGER DEFAULT 0);",
        ...rows.map(([id, k, s, w]) => `INSERT INTO autonomy_jobs VALUES ('${id}','${k}','${s}','SignalGrid-Review-Hub','${w}','title ${id}','${fixtureResult(id)}','2026-11-06T17:00:00Z','${createdAt(id)}',${id === 'jcancel' ? 1 : 0});`),
        "ALTER TABLE autonomy_jobs ADD COLUMN source_ids TEXT DEFAULT '[]'; ALTER TABLE autonomy_jobs ADD COLUMN cloud_allowed INTEGER DEFAULT 0; ALTER TABLE autonomy_jobs ADD COLUMN evidence TEXT DEFAULT '{}';",
        `UPDATE autonomy_jobs SET evidence='${JSON.stringify({ private_context: true, sources: [] })}' WHERE id='jdocs';`,
        `UPDATE autonomy_jobs SET evidence='${JSON.stringify({ private_context: true, sources: ["synthetic-private-vault-source"], privacy_clearance: { approved: true } })}' WHERE id='jprivateorigin';`].join("\n");
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

    // Exercise the production run() in a fresh process, with real ordinary-hook
    // verification and canonical SSH metadata. The poisoned SSH command only
    // writes a synthetic marker and fails, so the pre-fix test cannot network.
    const canonical = brain("canonical-ssh-fixture", () => {}), sshHome = join(root, "caller-ssh-home"), sshMarker = join(root, "caller-ssh-marker"), sshProgram = join(root, "caller-ssh.cjs");
    mkdirSync(join(canonical, ".githooks"));
    writeFileSync(join(canonical, ".githooks/pre-push"), readFileSync(join(REPO, ".githooks/pre-push")), { mode: 0o700 });
    scratchGitOk(canonical, ["config", "core.hooksPath", join(canonical, ".githooks")]);
    scratchGitOk(canonical, ["remote", "set-url", "origin", "git@github.com:DanFashauer/SignalGrid-Review-Hub.git"]);
    mkdirSync(sshHome, { mode: 0o700 });
    writeFileSync(sshProgram, `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(sshMarker)}, "executed"); process.exit(1);\n`, { mode: 0o500 });
    writeFileSync(join(sshHome, ".gitconfig"), `[core]\n  sshCommand = ${JSON.stringify(sshProgram)}\n`);
    const sshEnv = { ...process.env, HOME: sshHome, USERPROFILE: sshHome, XDG_CONFIG_HOME: join(sshHome, ".config") };
    for (const key of ["GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_SSH_COMMAND", "GIT_SSH", "SSH_ASKPASS"]) delete sshEnv[key];
    const sshProbe = spawnSync(process.execPath, ["--input-type=module", "-e",
      'import {pathToFileURL} from "node:url"; const {run}=await import(pathToFileURL(process.argv[2])); try { await run({job:"jcallerhome",db:process.argv[3],repo:process.argv[4],publish:true,log:()=>{}}); process.exitCode=98; } catch(e) { if(e.constructor.name!=="Refusal") { console.error(e.message); process.exitCode=97; } else console.log("BOUNDARY_REFUSED"); }',
      "synthetic-import-probe-not-a-module", fileURLToPath(import.meta.url), db, canonical], { env: sshEnv, encoding: "utf8", timeout: 30000 });
    if (sshProbe.status !== 0 || existsSync(sshMarker)) console.error("Synthetic SSH boundary: " + JSON.stringify({ status: sshProbe.status, marker_executed: existsSync(sshMarker), import_refused: sshProbe.stdout.trim() === "BOUNDARY_REFUSED", timed_out: !!sshProbe.error }));
    check("(security) production publish refuses before caller HOME can execute SSH", sshProbe.status === 0 && sshProbe.stdout.trim() === "BOUNDARY_REFUSED" && !existsSync(sshMarker));

    const missingTools = join(root, "missing-hook-tools");
    mkdirSync(missingTools);
    const normalTools = scannerFixture.toolPath;
    let missingHookRefused = false;
    try { scannerFixture.toolPath = missingTools; ordinaryHooks(repo, repo); }
    catch (e) { missingHookRefused = e instanceof Refusal; }
    finally { scannerFixture.toolPath = normalTools; }
    check("(security) missing mandatory pnpm refuses instead of accepting a skipped hook", missingHookRefused);

    // Actual Bash command resolution using the approved hook's logic. Only its
    // output sink is redirected into this fresh private fixture directory.
    const bashBin = join(root, "bash-hook-tools"), bashMarker = join(root, "bash-startup-ran"), pnpmMarker = join(root, "mandatory-pnpm-ran");
    mkdirSync(bashBin);
    writeFileSync(join(bashBin, "pnpm"), `#!${process.execPath}\nrequire("node:fs").writeFileSync(${JSON.stringify(pnpmMarker)}, "checked"); process.exit(7);\n`, { mode: 0o500 });
    const startup = join(root, "bash-startup.sh"), quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'";
    writeFileSync(startup, `printf executed > ${quote(bashMarker)}\npnpm() { return 0; }\n`, { mode: 0o400 });
    const hookLog = join(root, "approved-hook.log"), probeHook = join(root, "approved-hook-private-log");
    const hookBytes = readFileSync(join(REPO, ".githooks/pre-push")), hookText = hookBytes.toString("utf8");
    if (digest(hookBytes) !== ORDINARY_PRE_PUSH_SHA || (hookText.match(/\/tmp\/sg-prepush[.]log/g) ?? []).length !== 2) throw new Error("Approved-hook fixture source differs");
    writeFileSync(probeHook, hookText.replaceAll("/tmp/sg-prepush.log", quote(hookLog)), { flag: "wx", mode: 0o500 });
    const shellKeys = ["BASH_ENV", "ENV", "BASH_FUNC_pnpm%%"], priorShell = Object.fromEntries(shellKeys.map(k => [k, process.env[k]]));
    const hookProbe = () => spawnSync("/bin/bash", [probeHook], { cwd: canonical, env: gitEnv(), encoding: "utf8", timeout: 30000 });
    try {
      for (const k of shellKeys) delete process.env[k];
      scannerFixture.toolPath = bashBin + ":" + TOOL_PATH;
      requireHookDependencies();
      const control = hookProbe();
      if (control.status !== 1 || !existsSync(pnpmMarker)) throw new Error("Approved-hook positive fixture did not run mandatory pnpm");
      rmSync(pnpmMarker);
      process.env.BASH_ENV = startup;
      const poisoned = hookProbe();
      check("(security) approved Bash hook ignores caller startup and runs mandatory pnpm", poisoned.status === 1 && !existsSync(bashMarker) && existsSync(pnpmMarker));
      delete process.env.BASH_ENV;
      rmSync(pnpmMarker, { force: true });
      process.env["BASH_FUNC_pnpm%%"] = "() { return 0; }";
      process.env.ENV = startup;
      const imported = hookProbe(), sent = gitEnv();
      check("(security) imported shell functions cannot replace the approved hook tool", imported.status === 1 && existsSync(pnpmMarker) && !Object.keys(sent).some(k => k.startsWith("BASH_FUNC_")) && !sent.ENV);
    } finally {
      scannerFixture.toolPath = normalTools;
      for (const k of shellKeys) if (priorShell[k] === undefined) delete process.env[k]; else process.env[k] = priorShell[k];
    }

    // Exercise the production hook/remote validation, including effective
    // inherited URL values; no transport or global configuration is changed.
    const savedExtra = GIT_EXTRA, priorHookChecks = scannerFixture.enforceOrdinaryHookChecks;
    try {
      scannerFixture.enforceOrdinaryHookChecks = true;
      scannerFixture.toolPath = trustedHookBin; // No ambient pnpm installation.
      GIT_EXTRA = [];
      ordinaryHooks(canonical, canonical); // Valid canonical positive control.
      const refusedOrigin = () => {
        try { ordinaryHooks(canonical, canonical); return false; }
        catch (e) { if (!(e instanceof Refusal)) throw e; return true; }
      };
      scratchGitOk(canonical, ["config", "--add", "remote.origin.pushurl", "git@github.com:DanFashauer/SignalGrid-Review-Hub.git"]);
      scratchGitOk(canonical, ["config", "--add", "remote.origin.pushurl", "ssh://synthetic.invalid/other/project.git"]);
      check("(security) every configured push URL must be canonical", refusedOrigin());
      scratchGitOk(canonical, ["config", "--unset-all", "remote.origin.pushurl"]);
      scratchGitOk(canonical, ["config", "--add", "remote.origin.url", "ssh://synthetic.invalid/other/project.git"]);
      check("(security) fallback push URL inventory cannot hide a second destination", refusedOrigin());
      scratchGitOk(canonical, ["config", "--unset-all", "remote.origin.url"]);
      scratchGitOk(canonical, ["config", "remote.origin.url", "git@github.com:DanFashauer/SignalGrid-Review-Hub.git"]);
      GIT_EXTRA = ["-c", "remote.origin.pushurl=git@github.com:DanFashauer/SignalGrid-Review-Hub.git", "-c", "remote.origin.pushurl=ssh://synthetic.invalid/other/project.git"];
      check("(security) inherited effective push URLs cannot add a foreign destination", refusedOrigin());
      GIT_EXTRA = [];
      const altered = brain("altered-approved-hook-fixture", () => {});
      mkdirSync(join(altered, ".githooks"));
      writeFileSync(join(altered, ".githooks/pre-push"), Buffer.concat([hookBytes, Buffer.from("\n# Synthetic altered hook.\n")]), { flag: "wx", mode: 0o700 });
      scratchGitOk(altered, ["config", "core.hooksPath", join(altered, ".githooks")]);
      scratchGitOk(altered, ["remote", "set-url", "origin", "git@github.com:DanFashauer/SignalGrid-Review-Hub.git"]);
      let alteredRefused = false;
      try { ordinaryHooks(altered, altered); }
      catch (e) { if (!(e instanceof Refusal)) throw e; alteredRefused = e.message === "ordinary pre-push hook source changed"; }
      check("(security) private mandatory-tool fixture still validates approved hook bytes", alteredRefused);
    } finally {
      scannerFixture.toolPath = normalTools;
      if (priorHookChecks === undefined) delete scannerFixture.enforceOrdinaryHookChecks; else scannerFixture.enforceOrdinaryHookChecks = priorHookChecks;
      GIT_EXTRA = savedExtra;
    }

    // (1) dry run of a clean docs job
    const preparedMessages = [];
    const r1 = await run({ job: "jdocs", db, repo, log: (message) => preparedMessages.push(message) });
    check("(privacy) dry run returns a nonauthorizing request bound to actual public bytes", r1.privacyRequest?.format === "signalgrid-publication-privacy-request/v1" &&
      r1.privacyRequest.tree === r1.publishedTree && r1.privacyRequest.exports?.some((e) => e.source === "files/docs/new.md" && e.sha256 === digest(Buffer.from("new\n"))) &&
      !Object.hasOwn(r1.privacyRequest, "approved"));
    check("(privacy) review includes the exact commit, author headers and complete PR body", r1.privacyRequest?.head === r1.publishedHead &&
      ["metadata/title.txt", "metadata/body.md", "metadata/commit.txt", "metadata/paths.json"].every((name) => r1.privacyRequest?.exports?.some((item) => item.source === name && /^[0-9a-f]{64}$/.test(item.sha256))));
    const prepared = r1.publicationMetadata;
    check("(privacy interface) prepare returns the exact screened title/body bytes", prepared?.format === "signalgrid-publication-prepared-metadata/v1" &&
      prepared.request_sha256 === valueDigest(r1.privacyRequest) && ["title", "body"].every((name) => {
        const exported = r1.privacyRequest.exports.find((item) => item.source === (name === "title" ? "metadata/title.txt" : "metadata/body.md"));
        return typeof prepared[name] === "string" && exported?.sha256 === digest(Buffer.from(prepared[name])) && exported.bytes === Buffer.byteLength(prepared[name]);
      }));
    check("(privacy interface) CLI prepare emits the same nonauthorizing metadata", prepared !== undefined &&
      preparedMessages.includes("SIGNALGRID_PUBLICATION_PREPARED_METADATA " + JSON.stringify(prepared)) && !Object.hasOwn(prepared, "approved"));
    grantFixturePrivacy("jdocs", r1.privacyRequest);
    const forgedHome = join(realpathSync(root), "forged-home"), forgedClearances = join(forgedHome, "SignalGrid-Local-AI", "brain-state", "auto-publish-review", "clearances");
    mkdirSync(forgedClearances, { recursive: true, mode: 0o700 });
    grantFixturePrivacy("jdocs", r1.privacyRequest, {}, forgedClearances);
    const forged = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--list-review", "--not-before", "2026-11-06T16:40:00Z", "--db", db],
      { encoding: "utf8", env: { ...process.env, HOME: forgedHome, USERPROFILE: forgedHome }, timeout: 30000 });
    check("(privacy) a caller-controlled HOME cannot install trusted clearances", forged.status === 0 && forged.stdout.trim() === "");
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
    const refusedContent = async (id) => {
      try { await run({ job: id, db, repo, log: quiet }); check(`(auto) ${id} private artifact refused before public mutation`, false); }
      catch (e) { check(`(auto) ${id} private artifact refused before public mutation`, e instanceof Refusal); }
    };
    await refusedContent("jsecret");
    await refusedContent("jprivate");
    await refusedContent("jmixed");
    await refusedContent("jsvg");
    const hookDir = join(root, "history-hooks");
    mkdirSync(hookDir);
    // A normal post-commit hook creates secret-bearing intermediate history,
    // then a clean final tree/message. Net diff plus final %B cannot see it.
    writeFileSync(join(hookDir, "post-commit"), `#!${process.execPath}\n` + String.raw`
const fs = require("node:fs"), cp = require("node:child_process");
const git = (...a) => { const r = cp.spawnSync("git", ["-c","core.hooksPath=/dev/null","-c","commit.gpgsign=false","-c","user.name=synthetic","-c","user.email=synthetic@invalid",...a], {encoding:"utf8"}); if (r.status !== 0) process.exit(1); return r.stdout; };
const subject = git("show","-s","--format=%s","HEAD");
if (subject.includes("job jheader")) {
  const token = ["ghp", ["9X4vM2kQ7sD5fJ8wR1", "bY6nA3eL0tC9pH4uZ2"].join("")].join("_");
  git("commit","-q","--amend","--no-edit","--author",token + " <synthetic@invalid>");
  process.exit(0);
}
if (!subject.includes("job jhistory")) process.exit(0);
fs.writeFileSync("synthetic-history-secret.txt", ["ghp", ["9X4vM2kQ7sD5fJ8wR1", "bY6nA3eL0tC9pH4uZ2"].join("")].join("_") + "\n");
git("add","--","synthetic-history-secret.txt"); git("commit","-q","-m","Synthetic intermediate history");
fs.unlinkSync("synthetic-history-secret.txt"); git("add","-u","--","synthetic-history-secret.txt"); git("commit","-q","-m","Synthetic clean final message");
`);
    chmodSync(join(hookDir, "post-commit"), 0o500);
    const normalFixtureGit = GIT_EXTRA;
    GIT_EXTRA = [...GIT_EXTRA, "-c", `core.hooksPath=${hookDir}`];
    try {
      await refused("(auto) intermediate hook history refused", { job: "jhistory", db, repo }, "single new commit");
      await refused("(auto) hook credential in commit header refused", { job: "jheader", db, repo }, "screening refused");
    }
    finally { GIT_EXTRA = normalFixtureGit; }
    scannerFixture.forceError = true;
    await refused("(auto) scanner error fails closed", { job: "jdocs", db, repo }, "screening refused");
    scannerFixture.forceError = false;
    scannerFixture.forceMissing = true;
    await refused("(auto) missing scanner fails closed", { job: "jdocs", db, repo }, "screening refused");
    scannerFixture.forceMissing = false;
    if (isBuiltin("node:sqlite")) {
      const { DatabaseSync } = await import("node:sqlite");
      scannerFixture.afterInvoke = () => { const d = new DatabaseSync(db); try { d.prepare("UPDATE autonomy_jobs SET cancel_requested=1 WHERE id='jlate'").run(); } finally { d.close(); } };
    } else {
      scannerFixture.afterInvoke = () => { const r = spawnSync("/usr/bin/sqlite3", [db, "UPDATE autonomy_jobs SET cancel_requested=1 WHERE id='jlate'"], { encoding: "utf8" }); if (r.status !== 0) throw new Error("synthetic cancellation fixture failed"); };
    }
    try { await refused("(auto) cancellation during scanner refuses before push", { job: "jlate", db, repo }, "changed before publication"); }
    finally { scannerFixture.afterInvoke = null; }
    check("(auto) content refusal left synthetic secret/private branches absent", scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jsecret", "refs/heads/brain/job-jprivate", "refs/heads/brain/job-jmixed"]) === "");
    const freshListed = await listReview(db, { notBefore: "2026-11-06T16:40:00Z" });
    check("(auto) explicit fresh cutover excludes retained rows, cancelled rows and unsafe ids", JSON.stringify(freshListed) === JSON.stringify(["jdocs"]));
    check("(auto) reversed created/updated timestamps refused", !freshListed.includes("jreverse"));
    for (const value of ["not-a-time", "2026-11-06", "2026-11-06T16:40:00"]) {
      try { await listReview(db, { notBefore: value }); check(`(auto) invalid timezone-bearing cutover refused: ${value}`, false); }
      catch (e) { check(`(auto) invalid timezone-bearing cutover refused: ${value}`, e instanceof Refusal); }
    }
    const listed = await listReview(db);
    check("(*) --list-review names every review build with a worktree and no queued job", listed.includes("jdocs") && listed.includes("jagents") && listed.includes("jempty") && !listed.includes("jqueued"));
    // (6) publish with a stubbed gh
    const bin = join(root, "bin"), ghLog = join(root, "gh.log"), ghBody = join(root, "actual-gh-body.md"), ghContext = join(root, "gh-context.json"), ghReply = join(root, "gh-reply.txt");
    mkdirSync(bin);
    writeFileSync(ghReply, "https://github.com/DanFashauer/SignalGrid-Review-Hub/pull/999999\n");
    writeFileSync(join(bin, "gh"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");
fs.writeFileSync(${JSON.stringify(ghContext)}, JSON.stringify(Object.fromEntries(["GH_HOST","GH_REPO","GH_CONFIG_DIR"].map(k=>[k,process.env[k]??null]))));
const at = args.indexOf("--body-file");
if (at < 0 || !args[at + 1]) process.exit(2);
fs.copyFileSync(args[at + 1], ${JSON.stringify(ghBody)});
console.log(fs.readFileSync(${JSON.stringify(ghReply)},"utf8").trim());
`);
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    scannerFixture.toolPath = bin + ":" + trustedHookBin + ":" + TOOL_PATH; // Fixture only; production has no override.
    const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n").filter(Boolean) : []);
    // Exercise an ordinary pre-push hook against the bare fixture remote. Like
    // the repository's pnpm hook, it can load a root package-manager control.
    const publishHooks = join(root, "ordinary-publish-hooks");
    const hookMarker = join(root, "ordinary-hook-ran"), configMarker = join(root, "worker-config-ran");
    mkdirSync(publishHooks);
    writeFileSync(join(publishHooks, "pre-push"), `#!${process.execPath}\n` +
      `const fs=require("node:fs"); fs.appendFileSync(${JSON.stringify(hookMarker)},"hook\\n"); if(fs.existsSync(".pnpmfile.cjs")) require(process.cwd()+"/.pnpmfile.cjs");\n`);
    chmodSync(join(publishHooks, "pre-push"), 0o500);
    const fixtureHookGit = GIT_EXTRA;
    GIT_EXTRA = [...GIT_EXTRA, "-c", `core.hooksPath=${publishHooks}`];
    process.env.SYNTHETIC_CONFIG_MARKER = configMarker;
    await refused("(security) worker package configuration refused before ordinary hook", { job: "jconfig", db, repo, publish: true }, "unsafe publication path");
    check("(security) worker configuration never executed", !existsSync(configMarker));
    check("(security) refused package configuration has no remote branch", scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jconfig"]) === "");
    const routedKeys = ["GH_HOST", "GH_REPO", "GH_CONFIG_DIR"], priorRouting = Object.fromEntries(routedKeys.map(k=>[k,process.env[k]]));
    let r6;
    try {
      process.env.GH_HOST = "synthetic-enterprise.invalid";
      process.env.GH_REPO = "synthetic-enterprise.invalid/other/project";
      process.env.GH_CONFIG_DIR = join(root, "caller-gh-config");
      r6 = await run({ job: "jdocs", db, repo, publish: true, log: quiet });
    } finally { for (const key of routedKeys) if (priorRouting[key] === undefined) delete process.env[key]; else process.env[key] = priorRouting[key]; }
    const routed = JSON.parse(readFileSync(ghContext, "utf8"));
    check("(security) gh create is bound to the canonical repository and trusted configuration", ghCalls()[0]?.includes("--repo github.com/DanFashauer/SignalGrid-Review-Hub") && routed.GH_HOST === "github.com" && routed.GH_REPO === "github.com/DanFashauer/SignalGrid-Review-Hub" && routed.GH_CONFIG_DIR === join(trustedGitHome, ".config", "gh"));
    check("(security) legitimate public publish retained ordinary pre-push hook", existsSync(hookMarker));
    GIT_EXTRA = fixtureHookGit;
    delete process.env.SYNTHETIC_CONFIG_MARKER;
    const calls = ghCalls();
    check("(6) fresh publish pushed brain/job-jdocs", r6.pushed && scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jdocs"]).split(/\s+/)[0] === r6.publishedHead);
    check("(privacy) reviewed local-only public fixture publishes the exact reviewed object", r6.pushed && r6.publishedHead === r1.publishedHead);
    check("(6) gh called once with --base SignalGrid_Alpha", calls.length === 1 && calls[0].includes(`--base ${BASE}`) && calls[0].includes("--head brain/job-jdocs"));
    const publishedBody = readFileSync(ghBody, "utf8");
    const publishedCommit = scratchGitOk(origin, ["show", "-s", "--format=%B", "refs/heads/brain/job-jdocs"]);
    check("(auto) raw unverified finish is not public evidence", !publishedBody.includes(unverifiedFinish) && !publishedCommit.includes(unverifiedFinish));
    check("(auto) no invented Claude attribution", !/Generated with.*Claude Code|claude[.]com[/]claude-code/i.test(publishedBody) && !/^Co-Authored-By: Claude /mi.test(publishedCommit));
    const r6b = await run({ job: "jdocs", db, repo, publish: true, log: quiet });
    check("(6) existing remote branch: exit clean, nothing pushed, gh not called again", !r6b.pushed && ghCalls().length === 1);
    for (const id of ["junreviewed", "jprivateorigin"]) {
      let blocked = false;
      try { await run({ job: id, db, repo, publish: true, log: quiet }); }
      catch (e) { blocked = e instanceof Refusal; }
      check(`(privacy) ${id} cannot publish without an external exact-artifact clearance`, blocked && scratchGitOk(repo, ["ls-remote", "origin", `refs/heads/brain/job-${id}`]) === "");
    }
    const stale = await run({ job: "jstaleprivacy", db, repo, log: quiet });
    grantFixturePrivacy("jstaleprivacy", stale.privacyRequest);
    writeFileSync(join(wStalePrivacy, "docs/notes.md"), "Different synthetic narrative after privacy review.\n");
    let staleBlocked = false;
    try { await run({ job: "jstaleprivacy", db, repo, publish: true, log: quiet }); }
    catch (e) { staleBlocked = e instanceof Refusal; }
    check("(privacy) changed artifact invalidates prior privacy clearance before push", staleBlocked && scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jstaleprivacy"]) === "");
    check("(privacy) automatic selection checks current worker patch before remote preflight", !(await listReview(db, { notBefore: "2026-11-06T16:40:00Z" })).includes("jstaleprivacy"));
    const metadata = await run({ job: "jmetadata", db, repo, log: quiet });
    const wrongBody = metadata.privacyRequest ? JSON.parse(JSON.stringify(metadata.privacyRequest)) : undefined;
    if (wrongBody) wrongBody.exports = wrongBody.exports.map((item) => item.source === "metadata/body.md" ? { ...item, sha256: "0".repeat(64) } : item);
    grantFixturePrivacy("jmetadata", wrongBody);
    let metadataBlocked = false;
    try { await run({ job: "jmetadata", db, repo, publish: true, log: quiet }); }
    catch (e) { metadataBlocked = e instanceof Refusal; }
    check("(privacy) mismatched public metadata clearance refuses before push", metadataBlocked && scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jmetadata"]) === "");
    const foreign = await run({ job: "jforeignurl", db, repo, log: quiet });
    grantFixturePrivacy("jforeignurl", foreign.privacyRequest);
    writeFileSync(ghReply, "https://synthetic-enterprise.invalid/other/project/pull/1\n");
    let foreignRefused = false;
    try { await run({ job: "jforeignurl", db, repo, publish: true, log: quiet }); }
    catch (e) { foreignRefused = e instanceof Refusal; }
    check("(security) a returned PR URL outside the canonical repository is refused", foreignRefused);
    check("(*) no scratch worktrees left registered", scratchGitOk(repo, ["worktree", "list"]).split("\n").length === 1);
    check("(auto) real export crossed synthetic external scanner boundary", scannerFixture.calls >= 4);
  } finally { SELF_TEST_SCANNER = null; rmSync(root, { recursive: true, force: true }); }
  if (pass !== total) { console.error(`self-test FAILED (${pass}/${total})`); process.exit(1); }
  console.log(`self-test passed (${pass}/${total})`);
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : undefined; };
  try {
    if (a.includes("--qualify-scanner")) qualifyScanner(a);
    else if (a.includes("--self-test")) await selfTest();
    else if (a.includes("--list-review")) {
      if (a.includes("--not-before") && !opt("--not-before")) refuse("--not-before requires a timezone-bearing timestamp");
      for (const id of await listReview(opt("--db") ?? DEFAULT_DB, { notBefore: opt("--not-before") })) console.log(id);
    }
    else if (a.includes("--not-before")) refuse("--not-before applies only to the read-only --list-review action");
    else await run({ job: opt("--job"), db: opt("--db") ?? DEFAULT_DB, publish: a.includes("--publish") });
  } catch (e) {
    console.error(e instanceof Refusal ? `REFUSED: ${e.message}` : `ERROR: ${e.message}`);
    process.exit(1);
  }
}
