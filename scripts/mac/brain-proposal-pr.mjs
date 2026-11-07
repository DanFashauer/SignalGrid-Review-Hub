#!/usr/bin/env node
// brain-proposal-pr.mjs — publish ONE finished local-brain build as a GitHub PR (owner order,
// Dan, 2026-11-02: "Build the Mac route").
//
//   node scripts/mac/brain-proposal-pr.mjs --job <id> [--db <sqlite>]           # dry run (default)
//   node scripts/mac/brain-proposal-pr.mjs --job <id> --publish                  # push brain/job-<id> + open PR
//   node scripts/mac/brain-proposal-pr.mjs --list-review [--not-before <ISO>] [--db <sqlite>]
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
// Publication screening is separate from full final-head validation and landing.
// --publish uses ordinary Git hooks/network and the existing authenticated gh.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync, mkdirSync, lstatSync, readdirSync, openSync, closeSync, fstatSync, constants } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { dirname, join, resolve, isAbsolute, sep } from "node:path";
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
const SCANNER_MANIFEST = join(homedir(), "SignalGrid-Local-AI", "brain-state", "auto-publish-review", "scanner.json");
const SCANNER_SHA = "af9afd0ae3a0ff6d7f08c4ec4e28686b7e4de6962fe1eadecc497d15cdf731e2";
const CONFIG_SHA = "d28d9f4a0bf821edce9fe2668502b7f1286ae236cf905f0427dbe64a350abf83";
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
  const sql = "SELECT id, kind, status, repo, worktree, title, result, created_at, updated_at, cancel_requested FROM autonomy_jobs WHERE id = ?";
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
  return rows.filter((row) => {
    if (!/^[A-Za-z0-9_-]+$/.test(row.id ?? "") || row.cancel_requested !== 0) return false;
    try { const created = timestamp(row.created_at), updated = timestamp(row.updated_at); return created >= cutoff && updated >= created; }
    catch (e) { if (e instanceof Refusal) return false; throw e; }
  }).map((row) => String(row.id));
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
    const files = gitPaths(wt, ["diff", "--no-renames", "--name-only", "-z", "HEAD"], env);
    return { patch, files };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

const digest = (data) => createHash("sha256").update(data).digest("hex");
const full40 = (value) => /^[0-9a-f]{40}$/.test(value);
const sameFields = (a, b) => ["path", "sha256", "mode", "uid"].every((key) => a?.[key] === b?.[key]);

function privateBytes(path, wantedMode) {
  if (!isAbsolute(path ?? "") || resolve(path) !== path || path === REPO || path.startsWith(REPO + sep)) refuse("scanner custody path is not private and absolute");
  let part = sep;
  for (const component of path.split(sep).filter(Boolean)) {
    part = join(part, component);
    if (lstatSync(part).isSymbolicLink()) refuse("scanner custody contains a symlink");
  }
  const first = lstatSync(path);
  if (!first.isFile() || first.nlink !== 1 || first.uid !== process.getuid() || (first.mode & 0o777) !== wantedMode) refuse("scanner custody is not a frozen owner file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const shape = (st) => [st.dev, st.ino, st.size, st.mtimeMs, st.ctimeMs, st.mode, st.uid, st.nlink].join(":");
  try {
    const opened = fstatSync(fd), data = readFileSync(fd), final = fstatSync(fd), last = lstatSync(path);
    if (![opened, final, last].every((st) => shape(st) === shape(first))) refuse("scanner custody changed while reading");
    return data;
  } finally { closeSync(fd); }
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
  if (qualified.format !== "signalgrid-gitleaks-qualification-result/v2" || qualified.qualified !== true || qualified.version !== "8.24.3" || qualified.opaque_export_naming !== "entry-[0-9]{6}" || qualified.source_extension_skip_and_opaque_detection_verified !== true || !sameFields(qualified.private_executable_ref, binary) || !sameFields(qualified.strict_config_ref, config) || !Array.isArray(qualified.interruptions) || qualified.interruptions.length) refuse("publication scanner was not qualified for these bytes and opaque exports");
  const requiredCases = { clean: 0, credential: 2, "credential-with-demo": 2, "credential-with-inline-allow": 2, "raw-svg-default-path-exclusion": 0, "opaque-svg-credential": 2, "model-local-overrides-not-imported": 2, "malformed-fixed-config": 1 };
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
  return typeof file === "string" && file.length > 0 && !file.startsWith("/") && !/[\x00-\x1f\x7f\\]/.test(file) && !file.split("/").some((p) => p === ".." || p === "." || SCAN_CONTROL.test(p)) && !PRIVATE.test(file);
}

function checkPublicText(data) {
  if (data.includes(0)) refuse("publication export contains binary data");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(data); }
  catch { refuse("publication export is not complete UTF-8 text"); }
  if (PRIVATE.test(text) || AWS_KEY.test(text) || /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(text)) refuse("publication export contains private material or credential-shaped text");
  return text;
}

function gitBytes(dir, args, env) {
  const result = spawnSync("git", ["--no-replace-objects", "-C", dir, ...GIT_EXTRA, ...args], { env: { ...process.env, ...env }, maxBuffer: MAX_SCAN_TOTAL + (1 << 20), timeout: 120000 });
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
  const root = mkdtempSync(join(tmpdir(), "brain-publication-scan-"));
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
            found.push([relative, digest(readFileSync(path))]);
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
    const options = { cwd: root, env: { LANG: "C", LC_ALL: "C", TZ: "UTC" }, encoding: "utf8", maxBuffer: 1 << 20 };
    const result = SELF_TEST_SCANNER ? SELF_TEST_SCANNER.invoke(scanner.binary.path, argv, options) : spawnSync(scanner.binary.path, argv, options);
    if (result.error || result.status !== 0 || result.signal || /partial scan completed/i.test((result.stdout ?? "") + (result.stderr ?? ""))) refuse("publication credential screening refused or did not complete");
    let empty = false;
    try {
      const st = lstatSync(report);
      if (st.isFile() && st.nlink === 1 && st.uid === process.getuid()) {
        chmodSync(report, 0o400);
        const value = JSON.parse(readFileSync(report, "utf8"));
        empty = value === null || (Array.isArray(value) && value.length === 0);
      }
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
  if (PRIVATE.test(title) || PRIVATE.test(result)) refuse(`job ${job} title/result names a private path; it would land in a public PR body`);

  const { patch, files } = worktreePatch(j.worktree);
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
    const pf = join(scratch, "job.patch");
    writeFileSync(pf, patch);
    const ap = git(wt, ["apply", "--3way", "--index", pf]);
    const unmerged = git(wt, ["diff", "--name-only", "--diff-filter=U"]).out.trim();
    if (!ap.ok || unmerged) refuse(`job ${job}: the patch does not apply cleanly to origin/${BASE}\n${ap.err.trim()}${unmerged ? `\nunmerged: ${unmerged}` : ""}`);
    const prTitle = `brain: ${title.slice(0, 80)} (job ${job})`;
    gitOk(wt, ["commit", "-q", "-m", `${prTitle}\n\nLocal-brain build job ${job}, published by the Mac lane on the owner's order.`]);
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
      "## Public-safety note", "", "The route refused any file classified OWNER_RESERVED, DECISION_PATH or SAFETY_MACHINERY, and governance/heartbeat deny-list paths. Those path guards and credential screening do not replace source and privacy review of the artifact and public metadata.", "",
      "## Remaining risks", "", "Successful replay and publication do not establish task completeness, passing gates, review acceptance or landing clearance. Findings and final-head validation remain to be resolved.", "",
    ].join("\n");
    const artifact = committedExport(wt, replayBase, files, prTitle, body);
    if (artifact.head !== publishedHead || artifact.tree !== publishedTree) refuse("committed publication identity changed before screening");
    scanPublication(artifact);
    if (gitOk(wt, ["rev-parse", "HEAD"]).trim() !== artifact.head || gitOk(wt, ["rev-parse", "HEAD^{tree}"]).trim() !== artifact.tree) refuse("committed publication identity changed after screening");
    if (JSON.stringify(await readJob(db, job)) !== originalJobProjection) refuse(`job ${job} changed before publication; original attempt is readback-only`);
    if (!publish) { log(`dry run: would push ${branch} and open "${prTitle}" against ${BASE}`); return { branch, files, pushed: false, replayBase, publishedHead, publishedTree }; }

    gitOk(wt, ["push", "-q", "origin", `${publishedHead}:refs/heads/${branch}`]);
    const actualRemote = gitOk(repo, ["ls-remote", "origin", `refs/heads/${branch}`]).trim().split(/\s+/);
    if (actualRemote.length !== 2 || actualRemote[0] !== publishedHead || actualRemote[1] !== `refs/heads/${branch}`) refuse("pushed branch identity is unknown; exact readback required, no replay");
    const bf = join(scratch, "body.md");
    writeFileSync(bf, body);
    const gh = spawnSync("gh", ["pr", "create", "--base", BASE, "--head", branch, "--title", prTitle, "--body-file", bf], { cwd: repo, encoding: "utf8" });
    if (gh.status !== 0) throw new Error(`pushed ${branch}, but gh pr create failed: ${(gh.stderr || gh.error?.message || "").trim()}`);
    const prUrl = gh.stdout.trim();
    if (!/^https:\/\/[^\s]+$/.test(prUrl) || PRIVATE.test(prUrl)) refuse("created PR URL is unknown; exact readback required, no replay");
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
    // Portable boundary fixture only: it runs a separate synthetic executable,
    // with the real export/argv/config transport. Upstream compatibility has its
    // own actual pinned-binary qualification; this never claims that proof.
    const scannerBin = join(root, "synthetic-scanner"), scannerCfg = join(root, "strict.toml"), scannerIgnore = join(root, "empty.ignore");
    const strictConfig = "# Fixed local unattended-screening source; no repository line allowlists.\n[extend]\nuseDefault = true\n";
    writeFileSync(scannerCfg, strictConfig, { mode: 0o400 });
    writeFileSync(scannerIgnore, "", { mode: 0o400 });
    writeFileSync(scannerBin, `#!${process.execPath}\n` + String.raw`
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const a = process.argv.slice(2), expected = ["dir", "--redact=100", "--exit-code=2", "--no-banner", "--no-color", "--ignore-gitleaks-allow", "--config", null, "--gitleaks-ignore-path", null, "--report-format=json", "--report-path", null, null];
const fail = (reason = "fixture contract") => { console.error("SYNTHETIC_SCANNER_REFUSAL: " + reason); process.exit(1); };
if (a.length !== expected.length || expected.some((v,i) => v !== null && a[i] !== v)) fail();
if (crypto.createHash("sha256").update(fs.readFileSync(a[7])).digest("hex") !== "d28d9f4a0bf821edce9fe2668502b7f1286ae236cf905f0427dbe64a350abf83" || fs.readFileSync(a[9]).length || fs.realpathSync(a[13]) !== fs.realpathSync(path.join(process.cwd(), "export"))) fail("config, ignore or physical export path");
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
    const wSecret = brain("w-secret", (w) => writeFileSync(join(w, "notes.md"), "synthetic access key " + ["AKIA", "IOSFODNN7EXAMPLE"].join("") + "\n"));
    const wPrivate = brain("w-private", (w) => writeFileSync(join(w, "notes.md"), "private input /Users/fixture/private-vault/note.md\n"));
    const syntheticGithub = ["ghp", ["9X4vM2kQ7sD5fJ8wR1", "bY6nA3eL0tC9pH4uZ2"].join("")].join("_");
    const wMixed = brain("w-mixed", (w) => writeFileSync(join(w, "notes.md"), `sgk_demo_safe synthetic credential ${syntheticGithub}\n`));
    const wSvg = brain("w-svg", (w) => writeFileSync(join(w, "drawing.svg"), `<svg xmlns="http://www.w3.org/2000/svg"><!-- synthetic ${syntheticGithub} --></svg>\n`));
    const wHistory = brain("w-history", (w) => writeFileSync(join(w, "docs/history.md"), "Public final history fixture.\n"));
    const wHeader = brain("w-header", (w) => writeFileSync(join(w, "docs/header.md"), "Public header fixture.\n"));
    const wEmpty = brain("w-empty", () => {});
    const wConflict = brain("w-conflict", (w) => writeFileSync(join(w, "docs/x.md"), "one\nBRAIN\nthree\n"));

    const unverifiedFinish = "SYNTHETIC_UNVERIFIED_TEST_GATE_LINK_FINISH: all checks and reviews passed; link was added.";
    const fixtureResult = (id) => JSON.stringify(id === "jdocs" ? unverifiedFinish : `result ${id}`);
    const createdAt = (id) => id === "jreverse" ? "2026-11-06T17:10:00Z" : ["jdocs", "jcancel", "bad/id"].includes(id) ? "2026-11-06T16:41:00Z" : "2026-11-05T01:00:00Z";
    const db = join(root, "autonomy.sqlite3");
    const rows = [
      ["jdocs", "build", "review", wDocs], ["jagents", "build", "review", wAgents], ["jgate", "build", "review", wGate],
      ["jqueued", "build", "queued", wDocs], ["jempty", "build", "review", wEmpty],
      ["jconflict", "build", "review", wConflict],
      ["jsecret", "build", "review", wSecret], ["jprivate", "build", "review", wPrivate],
      ["jmixed", "build", "review", wMixed],
      ["jsvg", "build", "review", wSvg], ["jhistory", "build", "review", wHistory],
      ["jheader", "build", "review", wHeader],
      ["jlate", "build", "review", wDocs],
      ["jreverse", "build", "review", wDocs],
      ["jcancel", "build", "review", wDocs], ["bad/id", "build", "review", wDocs],
    ];
    if (isBuiltin("node:sqlite")) {
      const { DatabaseSync } = await import("node:sqlite");
      const d = new DatabaseSync(db);
      d.exec("CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT, created_at TEXT, cancel_requested INTEGER DEFAULT 0)");
      const ins = d.prepare("INSERT INTO autonomy_jobs VALUES (?, ?, ?, 'SignalGrid-Review-Hub', ?, ?, ?, '2026-11-06T17:00:00Z', ?, ?)");
      for (const [id, k, s, w] of rows) ins.run(id, k, s, w, `title ${id}`, fixtureResult(id), createdAt(id), id === "jcancel" ? 1 : 0);
      d.close();
    } else {
      const sql = ["CREATE TABLE autonomy_jobs (id TEXT, kind TEXT, status TEXT, repo TEXT, worktree TEXT, title TEXT, result TEXT, updated_at TEXT, created_at TEXT, cancel_requested INTEGER DEFAULT 0);",
        ...rows.map(([id, k, s, w]) => `INSERT INTO autonomy_jobs VALUES ('${id}','${k}','${s}','SignalGrid-Review-Hub','${w}','title ${id}','${fixtureResult(id)}','2026-11-06T17:00:00Z','${createdAt(id)}',${id === 'jcancel' ? 1 : 0});`)].join("\n");
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
    const bin = join(root, "bin"), ghLog = join(root, "gh.log"), ghBody = join(root, "actual-gh-body.md");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghLog)}, args.join(" ") + "\\n");
const at = args.indexOf("--body-file");
if (at < 0 || !args[at + 1]) process.exit(2);
fs.copyFileSync(args[at + 1], ${JSON.stringify(ghBody)});
console.log("https://example.invalid/pr/1");
`);
    chmodSync(join(bin, "gh"), 0o755);
    process.env.PATH = `${bin}:${process.env.PATH}`;
    const ghCalls = () => (existsSync(ghLog) ? readFileSync(ghLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const r6 = await run({ job: "jdocs", db, repo, publish: true, log: quiet });
    const calls = ghCalls();
    check("(6) fresh publish pushed brain/job-jdocs", r6.pushed && scratchGitOk(repo, ["ls-remote", "origin", "refs/heads/brain/job-jdocs"]).split(/\s+/)[0] === r6.publishedHead);
    check("(6) gh called once with --base SignalGrid_Alpha", calls.length === 1 && calls[0].includes(`--base ${BASE}`) && calls[0].includes("--head brain/job-jdocs"));
    const publishedBody = readFileSync(ghBody, "utf8");
    const publishedCommit = scratchGitOk(origin, ["show", "-s", "--format=%B", "refs/heads/brain/job-jdocs"]);
    check("(auto) raw unverified finish is not public evidence", !publishedBody.includes(unverifiedFinish) && !publishedCommit.includes(unverifiedFinish));
    check("(auto) no invented Claude attribution", !/Generated with.*Claude Code|claude[.]com[/]claude-code/i.test(publishedBody) && !/^Co-Authored-By: Claude /mi.test(publishedCommit));
    const r6b = await run({ job: "jdocs", db, repo, publish: true, log: quiet });
    check("(6) existing remote branch: exit clean, nothing pushed, gh not called again", !r6b.pushed && ghCalls().length === 1);
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
    if (a.includes("--self-test")) await selfTest();
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
