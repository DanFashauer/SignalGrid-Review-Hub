#!/usr/bin/env node
// brain-publish-reviewer.mjs — the REVIEWER side of a local-brain publication privacy clearance.
//
//   node scripts/mac/brain-publish-reviewer.mjs --check  (--prepared <file|-> | --request <file|-> --metadata <file|->) [--repo <path>]
//   node scripts/mac/brain-publish-reviewer.mjs --show   (--prepared <file|-> | --request … --metadata …) --repo <path>
//   node scripts/mac/brain-publish-reviewer.mjs --write  (--prepared <file|-> | --request … --metadata …) --clearances <dir>
//        (--review-input <file> | --source-system S --source-decision D --source-summary T
//                                 --artifact-system S --artifact-decision D --artifact-summary T)
//        [--repo <path>] [--ttl-minutes N]
//   node scripts/mac/brain-publish-reviewer.mjs --self-test
//
// Run by a SEPARATE reviewer OS account: neither the publisher account nor the owner of the worker
// checkout. The publisher (scripts/mac/brain-proposal-pr.mjs, without --publish) prints a privacy
// request after `SIGNALGRID_PUBLICATION_PRIVACY_REQUEST ` and the exact screened title/body after
// `SIGNALGRID_PUBLICATION_PREPARED_METADATA `. This helper:
//
//   --check  binds the two together: the metadata's request_sha256 is the publisher's own digest
//            of the request, and the title/body UTF-8 bytes match the request's metadata/title.txt
//            and metadata/body.md hashes and byte lengths. With --repo it also confirms the prepared
//            head and tree objects exist and that head^{tree} is the request's tree.
//   --show   prints the exact title, body, prepared commit and patch so a person can READ them.
//   --write  writes the two structured review evidence files and the v2 clearance into the
//            reviewer-owned clearances/ directory, in the layout the publisher's reader reads.
//
// It NEVER decides. Each review's system, decision and non-empty summary must be supplied by the
// reviewer; there is no default decision and no auto-approve path. A decision other than the one
// that clears (source_review: public_only, artifact_review: public_safe) writes nothing.
//
// Authority stays with the publisher. Before writing anything this calls the publisher's exported
// validatePrivacyClearanceContent on the exact bytes, with an explicit clock, and refuses if it
// throws; the publisher's own reader later re-checks the accounts, custody, ACLs and the actual job
// independently. A clearance written here authorizes nothing by itself.
//
// Interface notes. The publisher exports validatePrivacyClearanceContent, and nothing else this
// helper needs. Its request digest (valueDigest) and TTL ceiling (MAX_PRIVACY_TTL_MS) are NOT
// exported, and this file does not copy them: the digest binding is confirmed by asking the
// exported validator (see publisherConfirmsDigest), and the TTL ceiling is enforced by the same
// validator on the exact clearance bytes. Setup: docs/PUBLICATION_REVIEWER_SETUP.md.

import { spawnSync } from "node:child_process";
import { chmodSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir, userInfo } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePrivacyClearanceContent } from "./brain-proposal-pr.mjs";
import { scratchGit, scratchGitOk, scrubProcessGitEnv } from "../lib/scratch-git.mjs";
import { isMainModule } from "../lib/is-main.mjs";

const PUBLISHER_PATH = fileURLToPath(new URL("./brain-proposal-pr.mjs", import.meta.url));
const GIT_BINARY = process.platform === "darwin" ? "/Applications/Xcode.app/Contents/Developer/usr/bin/git" : "/usr/bin/git";
const TOOL_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const REQUEST_MARKER = "SIGNALGRID_PUBLICATION_PRIVACY_REQUEST ";
const METADATA_MARKER = "SIGNALGRID_PUBLICATION_PREPARED_METADATA ";
const REQUEST_FORMAT = "signalgrid-publication-privacy-request/v1";
const METADATA_FORMAT = "signalgrid-publication-prepared-metadata/v1";
const REVIEW_FORMAT = "signalgrid-publication-privacy-review/v1";
const CLEARANCE_FORMAT = "signalgrid-publication-privacy-clearance/v2";
const REVIEW_INPUT_FORMAT = "signalgrid-publication-review-input/v1";
// The only directory the publisher's reader reads, relative to the publisher account's home.
// walker-floor: not needed — these are the components of ONE directory path, never walk roots;
// the self-test's readdirSync calls list one fixture directory and compare it with an exact set.
const CLEARANCE_CHAIN = ["SignalGrid-Local-AI", "brain-state", "auto-publish-review", "clearances"];
// The one decision per review kind that clears publication. Anything else writes nothing.
const CLEARING = [["source_review", "public_only"], ["artifact_review", "public_safe"]];
const FILE_MODE = 0o444, DIRECTORY_MODE = 0o711, MAX_INPUT = 8 << 20, MAX_SUMMARY = 16000;
const JOB = /^[A-Za-z0-9_-]+$/;

class ReviewRefusal extends Error {}
const refuse = (message) => { throw new ReviewRefusal(message); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const full40 = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const octal = (mode) => "0" + (mode & 0o777).toString(8);

function requireClock(now) {
  if (!Number.isSafeInteger(now) || now < 0) refuse("the clock must be a nonnegative integer number of milliseconds");
}
function isoAt(ms, label) {
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8.64e15) refuse(`${label} is outside the representable time range`);
  return new Date(ms).toISOString();
}

/** sha256 of the publisher module this helper validates with; must equal request.publisher_sha256. */
function publisherSha() {
  return sha256(readFileSync(PUBLISHER_PATH));
}

// ---------------------------------------------------------------------------------------------
// Input: the publisher's dry-run lines, or the bare JSON objects.

export function extractMarked(text, marker, label, { required = false } = {}) {
  const lines = text.split(/\r?\n/).filter((line) => line.startsWith(marker));
  if (lines.length > 1) refuse(`${label}: ${lines.length} lines start with "${marker.trim()}"; refusing to choose one`);
  if (lines.length === 0 && required) refuse(`${label}: no line starts with "${marker.trim()}" (pass the publisher's dry-run output)`);
  const raw = lines.length === 1 ? lines[0].slice(marker.length) : text.trim();
  try { return JSON.parse(raw); }
  catch { return refuse(`${label} is not JSON and has no "${marker.trim()}" line`); }
}

function readSource(spec, label, readStdin) {
  if (typeof spec !== "string" || spec === "") refuse(`${label} needs a file path or - for stdin`);
  let bytes;
  try { bytes = spec === "-" ? readStdin() : readFileSync(spec); }
  catch (e) { refuse(`${label}: cannot read ${spec === "-" ? "stdin" : spec} (${e.code ?? e.message})`); }
  if (bytes.length > MAX_INPUT) refuse(`${label} exceeds ${MAX_INPUT} bytes`);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return refuse(`${label} is not complete UTF-8`); }
}

// ---------------------------------------------------------------------------------------------
// Binding checks.

/** Ask the publisher's exported validator whether `claimed` is ITS digest of `request`.
 * valueDigest is not exported. The validator compares each review record's request_sha256 with
 * valueDigest(request), so an in-memory probe whose records carry `claimed` passes only when the
 * two are equal. The probe is never written, never returned and never treated as a review: it
 * exists only to obtain the publisher's yes/no on the digest. Returns true, or the refusal text. */
function publisherConfirmsDigest(request, claimed, now) {
  const at = isoAt(now, "clock");
  const record = (kind, decision) => Buffer.from(JSON.stringify({ format: REVIEW_FORMAT, job: request.job, review_kind: kind,
    request_sha256: claimed, system: "owner", decision, reviewed_at: at,
    summary: "in-memory digest probe only; never written; not a review" }));
  const records = { source_review: record("source_review", "public_only"), artifact_review: record("artifact_review", "public_safe") };
  const probe = { format: CLEARANCE_FORMAT, job: request.job, request, issued_at: at, expires_at: isoAt(now + 1, "clock"),
    source_review: { decision: "public_only", system: "owner", evidence_ref: { path: "digest-probe/source", sha256: sha256(records.source_review) } },
    artifact_review: { decision: "public_safe", system: "owner", evidence_ref: { path: "digest-probe/artifact", sha256: sha256(records.artifact_review) } } };
  try { return validatePrivacyClearanceContent(probe, records, request, now) === true ? true : "validator did not return true"; }
  catch (e) { return e.message; }
}

/** The prepared request and metadata belong together, and to this publisher version. */
export function checkPrepared(request, metadata, { now, publisher = publisherSha() } = {}) {
  requireClock(now);
  if (request?.format !== REQUEST_FORMAT || typeof request.job !== "string" || !JOB.test(request.job)) refuse(`the prepared request is not a ${REQUEST_FORMAT} with a valid job id`);
  if (!full40(request.head) || !full40(request.tree) || !full40(request.replay_base)) refuse("the prepared request's head, tree and replay_base must be full 40-hex object ids");
  if (!Number.isSafeInteger(request.worker_uid) || request.worker_uid < 0) refuse("the prepared request's worker_uid is invalid");
  if (!Array.isArray(request.exports)) refuse("the prepared request has no exports list");
  if (metadata?.format !== METADATA_FORMAT || typeof metadata.title !== "string" || typeof metadata.body !== "string" ||
      typeof metadata.request_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(metadata.request_sha256)) refuse(`the prepared metadata is not a ${METADATA_FORMAT}`);
  if (request.publisher_sha256 !== publisher) refuse("publisher version mismatch: this checkout's scripts/mac/brain-proposal-pr.mjs is not the publisher that prepared the request; review from a checkout at that exact publisher version");
  for (const [source, text] of [["metadata/title.txt", metadata.title], ["metadata/body.md", metadata.body]]) {
    const entries = request.exports.filter((entry) => entry?.source === source);
    if (entries.length !== 1) refuse(`the prepared request must name ${source} exactly once`);
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length !== entries[0].bytes) refuse(`${source}: byte length ${bytes.length} does not match the request's ${entries[0].bytes}`);
    if (sha256(bytes) !== entries[0].sha256) refuse(`${source}: sha256 does not match the request`);
  }
  const confirmed = publisherConfirmsDigest(request, metadata.request_sha256, now);
  if (confirmed !== true) refuse(`metadata.request_sha256 is not the publisher's digest of this request (validator: ${confirmed})`);
  return { job: request.job, head: request.head, tree: request.tree, replay_base: request.replay_base, request_sha256: metadata.request_sha256 };
}

// ---------------------------------------------------------------------------------------------
// The prepared commit, read through an isolated Git directory. The publisher's repository config,
// hooks and attributes are never read: a throwaway bare repo of our own points at its object
// store with GIT_OBJECT_DIRECTORY, under the same hardened environment discipline the publisher
// uses for worker data (no global/system config, no protocols, no replace refs, no lazy fetch).

function objectStore(repo) {
  if (typeof repo !== "string" || !isAbsolute(repo) || resolve(repo) !== repo) refuse("--repo must be an absolute, normalized path");
  let dotGit = null;
  try { dotGit = lstatSync(join(repo, ".git")); } catch { /* bare repository, checked below */ }
  if (dotGit && !dotGit.isDirectory()) refuse("--repo/.git is not a directory (a linked worktree?); pass the main checkout or the bare repository");
  const objects = dotGit ? join(repo, ".git", "objects") : join(repo, "objects");
  let st;
  try { st = lstatSync(objects); } catch { refuse(`--repo has no readable Git object store at ${objects}`); }
  if (!st.isDirectory()) refuse(`--repo object store ${objects} is not a directory`);
  return objects;
}

function withIsolatedGit(repo, use) {
  const objects = objectStore(repo);
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), "sg-review-git-")));
  try {
    const env = { PATH: TOOL_PATH, HOME: scratch, XDG_CONFIG_HOME: join(scratch, ".config"), LANG: "C", LC_ALL: "C",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "", GIT_TERMINAL_PROMPT: "0",
      GIT_NO_LAZY_FETCH: "1", GIT_PAGER: "cat", PAGER: "cat" };
    const gitDir = join(scratch, "isolated.git");
    const spawn = (args, extra = {}) => spawnSync(GIT_BINARY, ["--no-replace-objects", "-c", "protocol.allow=never", "-c", "core.fsmonitor=false",
      "-c", "core.attributesFile=/dev/null", "-c", "core.hooksPath=/dev/null", "-c", "core.pager=cat", ...args],
      { env: { ...env, ...extra }, timeout: 120000, killSignal: "SIGKILL", maxBuffer: 64 << 20 });
    const init = spawn(["init", "--bare", "-q", "--template=", gitDir]);
    if (init.error || init.status !== 0 || init.signal) refuse("cannot create the isolated Git directory for reading the prepared objects");
    return use((args) => spawn(args, { GIT_DIR: gitDir, GIT_OBJECT_DIRECTORY: objects }));
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}

function verifyObjects(git, request) {
  const commit = git(["cat-file", "commit", request.head]);
  if (commit.error || commit.status !== 0 || commit.signal) refuse(`prepared commit ${request.head} is not readable in --repo's object store (pruned, never prepared there, or no read access)`);
  const raw = commit.stdout;
  const oid = createHash("sha1").update(Buffer.from(`commit ${raw.length}\0`)).update(raw).digest("hex");
  if (oid !== request.head) refuse("prepared commit bytes do not hash to the request's head");
  const headers = raw.toString("utf8").split("\n\n", 1)[0].split("\n");
  const trees = headers.filter((line) => line.startsWith("tree ")), parents = headers.filter((line) => line.startsWith("parent "));
  if (trees.length !== 1 || trees[0] !== `tree ${request.tree}`) refuse(`prepared head^{tree} is ${trees.join(",").replace(/tree /g, "") || "absent"}, not the request's tree ${request.tree}`);
  if (parents.length !== 1 || parents[0] !== `parent ${request.replay_base}`) refuse("prepared commit's sole parent is not the request's replay_base");
  const type = git(["cat-file", "-t", request.tree]);
  if (type.error || type.status !== 0 || type.stdout.toString("utf8").trim() !== "tree") refuse(`request tree ${request.tree} is not a readable tree object`);
  const exported = request.exports.filter((entry) => entry?.source === "metadata/commit.txt");
  if (exported.length !== 1 || exported[0].bytes !== raw.length || exported[0].sha256 !== sha256(raw)) refuse("the request's metadata/commit.txt does not match the prepared commit bytes");
  return raw;
}

export function checkObjects(repo, request) {
  withIsolatedGit(repo, (git) => verifyObjects(git, request));
  return true;
}

/** Make text safe to print to a reviewer's terminal: escape controls, CR and bidi/zero-width marks. */
export function terminalSafe(text) {
  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,
    (c) => "\\u{" + c.codePointAt(0).toString(16) + "}");
}

export function showPrepared(repo, request, metadata) {
  return withIsolatedGit(repo, (git) => {
    verifyObjects(git, request);
    const shown = git(["show", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--format=fuller", "--stat", "--patch", "--end-of-options", request.head]);
    if (shown.error || shown.status !== 0 || shown.signal) refuse("git show of the prepared commit failed");
    return [
      `== prepared publication: job ${request.job} ==`,
      `head ${request.head}`, `tree ${request.tree}`, `replay_base ${request.replay_base}`, `request_sha256 ${metadata.request_sha256}`,
      "== PR title (exact screened string; controls escaped) ==", terminalSafe(metadata.title),
      "== PR body (exact screened string; controls escaped) ==", terminalSafe(metadata.body),
      "== prepared commit and patch (git show; controls escaped) ==", terminalSafe(shown.stdout.toString("utf8")),
    ].join("\n");
  });
}

// ---------------------------------------------------------------------------------------------
// Reviewer decisions. Supplied, never defaulted.

export function requireReviews(review) {
  if (review === null || typeof review !== "object" || Array.isArray(review)) refuse("review input is required: each review's system, decision and summary come from the reviewer");
  const out = {};
  for (const [kind, clears] of CLEARING) {
    const given = review[kind];
    if (given === null || typeof given !== "object" || Array.isArray(given)) refuse(`${kind}: no review supplied`);
    const extra = Object.keys(given).filter((key) => !["system", "decision", "summary"].includes(key));
    if (extra.length) refuse(`${kind}: unknown review field(s) ${extra.join(", ")}`);
    if (typeof given.system !== "string" || !given.system.trim()) refuse(`${kind}: system must be stated explicitly (who reviewed)`);
    if (typeof given.summary !== "string" || !given.summary.trim() || given.summary.length > MAX_SUMMARY) refuse(`${kind}: summary is missing or blank (or over ${MAX_SUMMARY} characters); a review states what was read and found`);
    if (given.decision === undefined) refuse(`${kind}: decision is missing; there is no default decision`);
    if (given.decision !== clears) refuse(`${kind}: decision ${JSON.stringify(given.decision)} does not clear publication (only ${clears} does); no clearance written`);
    out[kind] = { system: given.system, decision: given.decision, summary: given.summary };
  }
  return out;
}

export function reviewFromInput(value) {
  if (value?.format !== REVIEW_INPUT_FORMAT) refuse(`--review-input must be a ${REVIEW_INPUT_FORMAT} JSON object`);
  const extra = Object.keys(value).filter((key) => !["format", "source_review", "artifact_review"].includes(key));
  if (extra.length) refuse(`--review-input has unknown field(s) ${extra.join(", ")}`);
  return { source_review: value.source_review, artifact_review: value.artifact_review };
}

// ---------------------------------------------------------------------------------------------
// Custody of the reviewer-owned clearances/ directory.

function darwinLs(path) {
  return spawnSync("/bin/ls", ["-lde", path], { env: { PATH: TOOL_PATH, LANG: "C", LC_ALL: "C" }, encoding: "utf8", timeout: 5000, maxBuffer: 65536 });
}

/** On Darwin, refuse any ACL, and refuse when the ACL state cannot be read. `ls -lde` prints one
 * line for an ACL-free path; an ACL adds a `+` to the mode and one line per entry (and Darwin may
 * show `@` instead of `+` when extended attributes coexist, so both the mode and the line count
 * are checked). The same idea as the publisher's reader, implemented here, not imported. */
function aclFree(path, label, { platform, runLs }) {
  if (platform !== "darwin") return;
  const listed = runLs(path);
  const lines = (listed?.stdout ?? "").trimEnd().split("\n");
  const mode = lines[0]?.split(/\s+/, 1)[0] ?? "";
  if (listed?.error || listed?.signal || listed?.status !== 0 || (listed?.stderr ?? "").trim() || lines.length !== 1 || !/^[d-][rwxstST-]{9}@?$/.test(mode)) refuse(`${label} has an ACL, or its ACL state could not be read with ls -lde; remove it with chmod -N and verify with ls -led`);
}

function clearanceCustody(directory, identity, host) {
  if (typeof directory !== "string" || !isAbsolute(directory) || resolve(directory) !== directory) refuse("--clearances must be an absolute, normalized path");
  if (directory.split(sep).slice(-CLEARANCE_CHAIN.length).join("/") !== CLEARANCE_CHAIN.join("/")) refuse(`--clearances must end in ${CLEARANCE_CHAIN.join("/")}: the only directory the publisher reads`);
  let st;
  try { st = lstatSync(directory); } catch { refuse("the clearances directory does not exist; an administrator creates it (docs/PUBLICATION_REVIEWER_SETUP.md)"); }
  if (st.isSymbolicLink() || !st.isDirectory()) refuse("the clearances path is a symlink or not a real directory");
  if (realpathSync(directory) !== directory) refuse("the clearances path passes through a symlink; the publisher requires its real path");
  if (st.uid !== identity.uid) refuse(`the clearances directory is not owned by the reviewer (owner uid ${st.uid}, reviewer uid ${identity.uid})`);
  if ((st.mode & 0o777) !== DIRECTORY_MODE) refuse(`the clearances directory must be mode 0711 (only the reviewer writes; no group/other write); found ${octal(st.mode)}`);
  aclFree(directory, "the clearances directory", host);
  return st;
}

function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
}

/** Create `target` with exactly `bytes`, mode 0444, or refuse. Never replaces an existing name:
 * the bytes go to a private temporary name first, then link() publishes them, and link() fails
 * when the target exists. A reader therefore never sees a partial file. */
function exclusiveCreate(directory, target, bytes) {
  const temporary = join(directory, `.${basename(target)}.${process.pid}.tmp`);
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  let st;
  try { writeAll(fd, bytes); fsyncSync(fd); fchmodSync(fd, FILE_MODE); st = fstatSync(fd); }
  catch (e) { closeSync(fd); unlinkSync(temporary); throw e; }
  closeSync(fd);
  try { linkSync(temporary, target); }
  catch (e) {
    unlinkSync(temporary);
    if (e.code === "EEXIST") refuse(`refusing to overwrite ${target}: a clearance is never replaced; a new review is a new request`);
    throw e;
  }
  unlinkSync(temporary);
  return { path: target, dev: st.dev, ino: st.ino, bytes };
}

function removeOwn(created) {
  for (const file of created) {
    try { const st = lstatSync(file.path); if (st.dev === file.dev && st.ino === file.ino) unlinkSync(file.path); }
    catch { /* already gone */ }
  }
}

function readBack(file, identity) {
  const fd = openSync(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.uid !== identity.uid || (st.mode & 0o777) !== FILE_MODE || st.dev !== file.dev || st.ino !== file.ino) refuse(`written file ${file.path} is not the reviewer-owned 0444 file just created`);
    const bytes = readFileSync(fd);
    if (!bytes.equals(file.bytes)) refuse(`written file ${file.path} does not hold the validated bytes`);
    return bytes;
  } finally { closeSync(fd); }
}

/** Write the two review evidence files and the v2 clearance. Every check, including the
 * publisher's validator on the exact bytes, runs before the first file is created. A refusal
 * after that (an existing name, or the post-write readback) removes only the files this call
 * created, matched by device and inode.
 * `afterCreate` exists for the self-test only (the CLI never passes it): it is called with the
 * created paths after the files exist and BEFORE every post-write check, so a test can plant an
 * ACL there and prove those checks refuse. It cannot skip or relax any check. */
export function writeClearance({ request, metadata, review, clearances, now, ttlMinutes = 30, identity, repo = null,
  platform = process.platform, runLs = darwinLs, afterCreate = null }) {
  if (identity === null || typeof identity !== "object" || !Number.isSafeInteger(identity.uid) || identity.uid < 0 || typeof identity.isRoot !== "boolean") refuse("reviewer identity is unknown");
  if (identity.isRoot) refuse("refusing to run as root: a clearance is written by the separate, unprivileged reviewer account");
  checkPrepared(request, metadata, { now });
  const reviews = requireReviews(review);
  if (identity.uid === request.worker_uid) refuse(`reviewer uid ${identity.uid} is the worker checkout owner; the reviewer must be a separate account`);
  if (repo !== null) checkObjects(repo, request);
  const host = { platform, runLs };
  const custody = clearanceCustody(clearances, identity, host);
  if (!Number.isSafeInteger(ttlMinutes)) refuse("--ttl-minutes must be an integer");

  const job = request.job, at = isoAt(now, "clock"), expires = isoAt(now + ttlMinutes * 60000, "expiry");
  const paths = { source_review: join(clearances, `${job}.source_review.json`), artifact_review: join(clearances, `${job}.artifact_review.json`), clearance: join(clearances, `${job}.json`) };
  const evidence = {}, references = {};
  for (const [kind] of CLEARING) {
    const given = reviews[kind];
    evidence[kind] = Buffer.from(JSON.stringify({ format: REVIEW_FORMAT, job, review_kind: kind, request_sha256: metadata.request_sha256,
      system: given.system, decision: given.decision, reviewed_at: at, summary: given.summary }) + "\n");
    references[kind] = { path: paths[kind], sha256: sha256(evidence[kind]), mode: FILE_MODE, uid: identity.uid };
  }
  const clearanceBytes = Buffer.from(JSON.stringify({ format: CLEARANCE_FORMAT, job, request,
    source_review: { decision: reviews.source_review.decision, system: reviews.source_review.system, evidence_ref: references.source_review },
    artifact_review: { decision: reviews.artifact_review.decision, system: reviews.artifact_review.system, evidence_ref: references.artifact_review },
    issued_at: at, expires_at: expires }));
  const validate = (clearance, records, outcome) => {
    let ok;
    try { ok = validatePrivacyClearanceContent(JSON.parse(clearance.toString("utf8")), records, request, now); }
    catch (e) { refuse(`the publisher's validator refused this clearance; ${outcome}: ${e.message}`); }
    if (ok !== true) refuse(`the publisher's validator did not accept this clearance; ${outcome}`);
  };
  validate(clearanceBytes, evidence, "nothing written");

  const created = [];
  try {
    created.push(exclusiveCreate(clearances, paths.source_review, evidence.source_review));
    created.push(exclusiveCreate(clearances, paths.artifact_review, evidence.artifact_review));
    created.push(exclusiveCreate(clearances, paths.clearance, clearanceBytes));
    const directory = openSync(clearances, constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
    if (afterCreate !== null) afterCreate(created.map((file) => file.path));
    const [sourceBytes, artifactBytes, finalClearance] = created.map((file) => readBack(file, identity));
    for (const file of created) aclFree(file.path, `written file ${file.path}`, host);
    const end = lstatSync(clearances);
    if (["dev", "ino", "uid", "mode"].some((key) => end[key] !== custody[key])) refuse("the clearances directory changed while writing");
    aclFree(clearances, "the clearances directory", host);
    validate(finalClearance, { source_review: sourceBytes, artifact_review: artifactBytes }, "the files this run created were removed");
  } catch (e) { removeOwn(created); throw e; }
  return { job, clearance: paths.clearance, clearance_sha256: sha256(clearanceBytes), source_review: references.source_review,
    artifact_review: references.artifact_review, issued_at: at, expires_at: expires };
}

// ---------------------------------------------------------------------------------------------
// CLI.

const VALUE_FLAGS = ["--prepared", "--request", "--metadata", "--repo", "--review-input", "--clearances", "--ttl-minutes",
  "--source-system", "--source-decision", "--source-summary", "--artifact-system", "--artifact-decision", "--artifact-summary"];
const MODE_FLAGS = ["--check", "--show", "--write"];

export function parseArgs(argv) {
  const options = {}, modes = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (MODE_FLAGS.includes(arg)) { if (modes.includes(arg)) refuse(`${arg} given twice`); modes.push(arg); continue; }
    if (!VALUE_FLAGS.includes(arg)) refuse(`unknown argument ${JSON.stringify(arg)}`);
    if (Object.hasOwn(options, arg)) refuse(`${arg} given twice`);
    if (i + 1 >= argv.length || (argv[i + 1].startsWith("--") && argv[i + 1] !== "-")) refuse(`${arg} needs a value`);
    options[arg] = argv[++i];
  }
  if (modes.length !== 1) refuse("choose exactly one of --check, --show, --write");
  const prepared = Object.hasOwn(options, "--prepared"), split = ["--request", "--metadata"].filter((flag) => Object.hasOwn(options, flag));
  if (prepared ? split.length : split.length !== 2) refuse("pass --prepared, or both --request and --metadata (not both forms)");
  if (Object.values(options).filter((value) => value === "-").length > 1) refuse("only one input may come from stdin");
  const mode = modes[0];
  const reviewFlags = VALUE_FLAGS.filter((flag) => /^--(?:source|artifact)-/.test(flag) && Object.hasOwn(options, flag));
  if (mode !== "--write") {
    const writeOnly = ["--review-input", "--clearances", "--ttl-minutes", ...reviewFlags].filter((flag) => Object.hasOwn(options, flag));
    if (writeOnly.length) refuse(`${writeOnly.join(", ")} only apply to --write`);
  } else {
    if (!Object.hasOwn(options, "--clearances")) refuse("--write needs --clearances <dir>");
    if (Object.hasOwn(options, "--review-input") && reviewFlags.length) refuse("pass the reviews either as --review-input or as flags, not both");
    if (!Object.hasOwn(options, "--review-input") && reviewFlags.length === 0) refuse("review input is required: --review-input <file>, or the six --source-*/--artifact-* flags; there is no default decision");
    if (Object.hasOwn(options, "--ttl-minutes") && !/^[0-9]+$/.test(options["--ttl-minutes"])) refuse("--ttl-minutes must be a whole number of minutes");
  }
  if (mode === "--show" && !Object.hasOwn(options, "--repo")) refuse("--show needs --repo <publisher repository> to read the prepared commit");
  return { mode, options };
}

export function main(argv, { now, readStdin = () => readFileSync(0), log = console.log }) {
  const { mode, options } = parseArgs(argv);
  let request, metadata;
  if (Object.hasOwn(options, "--prepared")) {
    const text = readSource(options["--prepared"], "--prepared", readStdin);
    request = extractMarked(text, REQUEST_MARKER, "--prepared", { required: true });
    metadata = extractMarked(text, METADATA_MARKER, "--prepared", { required: true });
  } else {
    request = extractMarked(readSource(options["--request"], "--request", readStdin), REQUEST_MARKER, "--request");
    metadata = extractMarked(readSource(options["--metadata"], "--metadata", readStdin), METADATA_MARKER, "--metadata");
  }
  const repo = options["--repo"] ?? null;
  if (mode === "--check") {
    const bound = checkPrepared(request, metadata, { now });
    if (repo !== null) checkObjects(repo, request);
    log(`binding verified: ${JSON.stringify({ ...bound, objects: repo === null ? "not checked (no --repo)" : "present; head^{tree} matches" })}`);
    return;
  }
  if (mode === "--show") { checkPrepared(request, metadata, { now }); log(showPrepared(repo, request, metadata)); return; }
  let review;
  if (Object.hasOwn(options, "--review-input")) {
    let parsed;
    try { parsed = JSON.parse(readSource(options["--review-input"], "--review-input", readStdin)); }
    catch (e) { if (e instanceof ReviewRefusal) throw e; refuse("--review-input is not JSON"); }
    review = reviewFromInput(parsed);
  } else {
    review = {};
    for (const [kind, prefix] of [["source_review", "--source-"], ["artifact_review", "--artifact-"]]) {
      review[kind] = {};
      for (const field of ["system", "decision", "summary"]) if (Object.hasOwn(options, prefix + field)) review[kind][field] = options[prefix + field];
    }
  }
  const uid = process.geteuid();
  const written = writeClearance({ request, metadata, review, clearances: options["--clearances"], now, repo,
    ttlMinutes: Object.hasOwn(options, "--ttl-minutes") ? Number(options["--ttl-minutes"]) : undefined,
    identity: { uid, isRoot: uid === 0 || process.getuid() === 0 } });
  log(`clearance written (it authorizes nothing by itself; the publisher's reader re-checks accounts, custody and the actual job): ${JSON.stringify(written)}`);
}

// ---------------------------------------------------------------------------------------------
// Self-test. Synthetic fixtures in a temp dir; no accounts, no network, no real review.

function selfTest() {
  scrubProcessGitEnv();
  let pass = 0, total = 0;
  const check = (name, ok) => { total++; if (ok) pass++; else console.error(`FAIL: ${name}`); };
  const refusedWith = (fn, needle) => {
    try { fn(); return false; }
    catch (e) { if (!(e instanceof ReviewRefusal)) { console.error(`  unexpected ${e.stack}`); return false; } return e.message.includes(needle) || (console.error(`  refused, but with: ${e.message}`), false); }
  };
  const root = realpathSync(mkdtempSync(join(tmpdir(), "brain-review-st-")));
  const NOW = Date.parse("2026-11-08T12:00:00.000Z"), uid = process.geteuid();
  const identity = { uid, isRoot: false };
  // TEST FIXTURE ONLY: the documented digest convention (docs/PUBLICATION_REVIEWER_INTERFACE.md:
  // SHA-256 over UTF-8 JSON, object keys sorted recursively, array order kept), used to build
  // synthetic metadata. Production never uses it; the first check below proves the publisher's
  // validator agrees with it, so a drift fails here instead of hiding.
  const ordered = (v) => Array.isArray(v) ? v.map(ordered) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered(v[k])])) : v;
  const fixtureDigest = (v) => sha256(Buffer.from(JSON.stringify(ordered(v))));
  try {
    // A real scratch repository holds the prepared commit, so the object checks read real objects.
    const repo = join(root, "publisher-repo");
    mkdirSync(join(repo, "docs"), { recursive: true });
    scratchGitOk(repo, ["init", "-q"]);
    writeFileSync(join(repo, "docs", "base.md"), "base\n");
    scratchGitOk(repo, ["add", "-A"]); scratchGitOk(repo, ["commit", "-q", "-m", "base"]);
    const replayBase = scratchGitOk(repo, ["rev-parse", "HEAD"]), baseTree = scratchGitOk(repo, ["rev-parse", "HEAD^{tree}"]);
    writeFileSync(join(repo, "docs", "new.md"), "Synthetic public fixture.\n");
    scratchGitOk(repo, ["add", "-A"]); scratchGitOk(repo, ["commit", "-q", "-m", "brain: synthetic (job jfix)"]);
    const head = scratchGitOk(repo, ["rev-parse", "HEAD"]), tree = scratchGitOk(repo, ["rev-parse", "HEAD^{tree}"]);
    const rawCommit = scratchGit(repo, ["cat-file", "commit", head]);
    if (rawCommit.status !== 0) throw new Error("fixture commit unreadable");
    const commitBytes = Buffer.from(rawCommit.stdout, "utf8");
    const PUBLISHER = publisherSha();
    const entry = (source, bytes) => ({ source, sha256: sha256(bytes), bytes: bytes.length });
    const fixture = ({ job = "jfix", title = "brain: synthetic (job jfix)", body = "## Summary\n\nSynthetic fixture body.\n", workerUid = uid + 1000, change = null } = {}) => {
      const request = { format: REQUEST_FORMAT, job, job_sha256: "1".repeat(64), publisher_sha256: PUBLISHER, worker_head: "7".repeat(40),
        worker_uid: workerUid, patch_sha256: "8".repeat(64), replay_base: replayBase, head, tree,
        exports: [entry("files/docs/new.md", Buffer.from("Synthetic public fixture.\n")), entry("metadata/body.md", Buffer.from(body)),
          entry("metadata/commit.txt", commitBytes), entry("metadata/paths.json", Buffer.from('["docs/new.md"]')), entry("metadata/title.txt", Buffer.from(title))] };
      if (change) change(request);
      return { request, metadata: { format: METADATA_FORMAT, request_sha256: fixtureDigest(request), title, body } };
    };
    const review = (changes = {}) => ({
      source_review: { system: "claude", decision: "public_only", summary: "Synthetic: read the source list; nothing private.", ...changes.source_review },
      artifact_review: { system: "codex", decision: "public_safe", summary: "Synthetic: read the exact title, body and patch.", ...changes.artifact_review } });
    let n = 0;
    const clearanceDir = (mode = 0o711) => {
      const dir = join(root, `home-${++n}`, ...CLEARANCE_CHAIN);
      mkdirSync(dir, { recursive: true });
      chmodSync(dirname(dir), 0o700); chmodSync(dir, mode);
      return dir;
    };
    const linux = { platform: "linux", runLs: () => { throw new Error("ls must not run off Darwin"); } };
    const write = (opts = {}) => {
      const { request, metadata } = opts.fixture ?? fixture();
      return writeClearance({ request, metadata, review: Object.hasOwn(opts, "review") ? opts.review : review(), clearances: opts.dir ?? clearanceDir(), now: opts.now ?? NOW,
        ttlMinutes: opts.ttl ?? 30, identity: opts.identity ?? identity, repo: opts.repo ?? null, ...(opts.host ?? linux) });
    };
    // A refusal case passes only when (a) the named guard refused and (b) nothing was left behind.
    const refusedClean = (name, needle, opts = {}) => {
      const dir = opts.dir ?? clearanceDir(opts.mode);
      check(name, refusedWith(() => write({ ...opts, dir }), needle) && readdirSync(dir).length === 0);
    };

    // --- the shared interface, and the fixture's agreement with it
    check("(interface) the publisher exports validatePrivacyClearanceContent", typeof validatePrivacyClearanceContent === "function");
    const good = fixture();
    check("(interface) the publisher's validator confirms the fixture digest of a request", publisherConfirmsDigest(good.request, good.metadata.request_sha256, NOW) === true);
    check("(interface) the publisher's validator refuses a different digest", publisherConfirmsDigest(good.request, "0".repeat(64), NOW) !== true);

    // --- valid
    check("(check) a bound request and metadata are accepted", checkPrepared(good.request, good.metadata, { now: NOW }).job === "jfix");
    check("(check) --repo: head and tree exist and head^{tree} is the request's tree", checkObjects(repo, good.request) === true);
    const dir = clearanceDir();
    const written = write({ dir, repo });
    const listing = readdirSync(dir).sort();
    check("(write) exactly the reader's three names, no temporaries", JSON.stringify(listing) === JSON.stringify(["jfix.artifact_review.json", "jfix.json", "jfix.source_review.json"]));
    const files = listing.map((name) => ({ name, path: join(dir, name), st: lstatSync(join(dir, name)) }));
    check("(write) every file is a single-link, reviewer-owned 0444 regular file", files.every(({ st }) => st.isFile() && st.nlink === 1 && st.uid === uid && (st.mode & 0o777) === 0o444));
    const onDisk = JSON.parse(readFileSync(join(dir, "jfix.json"), "utf8"));
    const evidenceOnDisk = Object.fromEntries(CLEARING.map(([kind]) => [kind, readFileSync(onDisk[kind].evidence_ref.path)]));
    check("(write) evidence_ref {path, sha256, uid, mode} matches what is on disk, under clearances/", CLEARING.every(([kind]) => {
      const ref = onDisk[kind].evidence_ref, st = lstatSync(ref.path);
      return JSON.stringify(Object.keys(ref).sort()) === JSON.stringify(["mode", "path", "sha256", "uid"]) && ref.path.startsWith(dir + sep) &&
        ref.path !== join(dir, "jfix.json") && ref.sha256 === sha256(evidenceOnDisk[kind]) && ref.uid === st.uid && ref.mode === (st.mode & 0o777);
    }) && onDisk.source_review.evidence_ref.path !== onDisk.artifact_review.evidence_ref.path && written.clearance === join(dir, "jfix.json"));
    check("(write) the publisher's validator accepts the on-disk bytes at an explicit later clock",
      validatePrivacyClearanceContent(onDisk, evidenceOnDisk, good.request, NOW + 60000) === true);
    check("(write) the same bytes are refused by the publisher's validator at their expiry",
      (() => { try { validatePrivacyClearanceContent(onDisk, evidenceOnDisk, good.request, Date.parse(onDisk.expires_at)); return false; } catch { return true; } })());
    check("(write) the reviewer's own words are in the evidence; the decisions are the supplied ones",
      JSON.parse(evidenceOnDisk.source_review).summary === review().source_review.summary && JSON.parse(evidenceOnDisk.artifact_review).system === "codex");
    console.log("NOT VERIFIED here: the publisher's real reader (readPrivacyClearance) accepting these files. It is unexported, reads only " +
      "the publisher account's own clearances/ path and refuses a directory owned by its own uid, so it needs a second OS account; single-uid CI cannot run it.");

    // --- refusals: reviewer input
    refusedClean("(refuse) no review input at all", "review input is required", { review: null });
    refusedClean("(refuse) missing source summary", "summary is missing or blank", { review: review({ source_review: { summary: undefined } }) });
    refusedClean("(refuse) whitespace artifact summary", "summary is missing or blank", { review: review({ artifact_review: { summary: " \n\t " } }) });
    refusedClean("(refuse) missing decision: there is no default", "no default decision", { review: review({ source_review: { decision: undefined } }) });
    refusedClean("(refuse) a non-clearing decision writes nothing", "does not clear publication", { review: review({ artifact_review: { decision: "reject" } }) });
    refusedClean("(refuse) missing system", "system must be stated", { review: review({ artifact_review: { system: "" } }) });

    // --- refusals: accounts
    refusedClean("(refuse) reviewer uid equal to the request's worker_uid", "worker checkout owner", { fixture: fixture({ workerUid: uid }) });
    refusedClean("(refuse) a run as root", "refusing to run as root", { identity: { uid, isRoot: true } });

    // --- refusals: clearances/ custody
    refusedClean("(refuse) clearances/ not owned by the current uid", "not owned by the reviewer", { identity: { uid: uid + 1, isRoot: false } });
    refusedClean("(refuse) clearances/ with group write", "must be mode 0711", { mode: 0o731 });
    refusedClean("(refuse) clearances/ with other write", "must be mode 0711", { mode: 0o713 });
    const aclListing = (stdout, status = 0, stderr = "") => ({ platform: "darwin", runLs: () => ({ status, stdout, stderr }) });
    refusedClean("(refuse) Darwin: an ACL on clearances/ (+ and an entry line)", "has an ACL",
      { host: aclListing("drwx--x--x+ 2 reviewer staff 64 Nov  8 12:00 /x\n 0: user:publisher allow add_file,writesecurity\n") });
    refusedClean("(refuse) Darwin: an ACL shown as @ with an entry line", "has an ACL",
      { host: aclListing("drwx--x--x@ 2 reviewer staff 64 Nov  8 12:00 /x\n 0: group:everyone allow writesecurity\n") });
    refusedClean("(refuse) Darwin: unreadable ACL state", "has an ACL", { host: aclListing("", 1, "ls: permission denied\n") });
    const darwinClean = clearanceDir();
    write({ dir: darwinClean, host: { platform: "darwin", runLs: (p) => ({ status: 0, stderr: "", stdout: `${p === darwinClean ? "drwx--x--x" : "-r--r--r--"} 1 reviewer staff 64 Nov  8 12:00 ${p}\n` }) } });
    check("(control) Darwin: an ACL-free ls -lde listing is accepted, so the ACL cases are not refusing everything", readdirSync(darwinClean).length === 3);
    const elsewhere = join(root, "elsewhere", "clearances");
    mkdirSync(elsewhere, { recursive: true, mode: 0o711 }); chmodSync(elsewhere, 0o711);
    refusedClean("(refuse) a clearances/ the publisher never reads", "must end in", { dir: elsewhere });
    const realTarget = clearanceDir(), linked = join(root, "linked-home", ...CLEARANCE_CHAIN);
    mkdirSync(dirname(linked), { recursive: true }); symlinkSync(realTarget, linked);
    check("(refuse) a symlinked clearances/ path", refusedWith(() => write({ dir: linked }), "is a symlink or not a real directory") && readdirSync(realTarget).length === 0);
    const ancestorTarget = clearanceDir(), viaAncestor = join(root, "linked-ancestor", ...CLEARANCE_CHAIN);
    symlinkSync(join(root, `home-${n}`), join(root, "linked-ancestor"));
    check("(refuse) a clearances/ path through a symlinked ancestor", refusedWith(() => write({ dir: viaAncestor }), "passes through a symlink") && readdirSync(ancestorTarget).length === 0);

    // --- refusals: binding
    const badDigest = fixture(); badDigest.metadata.request_sha256 = "0".repeat(64);
    check("(refuse/check) metadata.request_sha256 is not the request's digest", refusedWith(() => checkPrepared(badDigest.request, badDigest.metadata, { now: NOW }), "not the publisher's digest"));
    refusedClean("(refuse/write) metadata.request_sha256 is not the request's digest", "not the publisher's digest", { fixture: badDigest });
    const longTitle = fixture({ change: (r) => { r.exports.find((e) => e.source === "metadata/title.txt").bytes += 1; } });
    check("(refuse/check) title byte length differs from the request", refusedWith(() => checkPrepared(longTitle.request, longTitle.metadata, { now: NOW }), "byte length"));
    refusedClean("(refuse/write) title byte length differs from the request", "byte length", { fixture: longTitle });
    const swappedTitle = fixture(); swappedTitle.metadata.title = swappedTitle.metadata.title.replace("synthetic", "SYNTHETIC");
    check("(refuse/check) title bytes differ at the same length", refusedWith(() => checkPrepared(swappedTitle.request, swappedTitle.metadata, { now: NOW }), "metadata/title.txt: sha256"));
    const swappedBody = fixture(); swappedBody.metadata.body = swappedBody.metadata.body.replace("Synthetic", "Different");
    check("(refuse/check) body bytes differ at the same length", refusedWith(() => checkPrepared(swappedBody.request, swappedBody.metadata, { now: NOW }), "metadata/body.md: sha256"));
    const otherPublisher = fixture({ change: (r) => { r.publisher_sha256 = "9".repeat(64); } });
    check("(refuse/check) a request prepared by a different publisher version", refusedWith(() => checkPrepared(otherPublisher.request, otherPublisher.metadata, { now: NOW }), "publisher version mismatch"));

    // --- refusals: TTL, judged by the publisher's validator on the exact bytes
    refusedClean("(refuse) an expired TTL (0 minutes), before anything is written", "nothing written: artifact-specific privacy clearance is invalid or expired", { ttl: 0 });
    refusedClean("(refuse) an overlong TTL (61 minutes), before anything is written", "nothing written: artifact-specific privacy clearance is invalid or expired", { ttl: 61 });
    refusedClean("(refuse) a negative TTL, before anything is written", "nothing written: artifact-specific privacy clearance is invalid or expired", { ttl: -5 });

    // --- refusals: overwrite
    const before = Object.fromEntries(readdirSync(dir).map((name) => [name, sha256(readFileSync(join(dir, name)))]));
    const again = fixture();
    check("(refuse) an attempted overwrite of an existing clearance",
      refusedWith(() => writeClearance({ ...again, review: review({ artifact_review: { summary: "A second, different review." } }), clearances: dir, now: NOW + 1000, ttlMinutes: 30, identity, ...linux }), "refusing to overwrite") &&
      JSON.stringify(Object.fromEntries(readdirSync(dir).map((name) => [name, sha256(readFileSync(join(dir, name)))]))) === JSON.stringify(before));

    // --- refusals: prepared objects
    const missingHead = fixture({ change: (r) => { r.head = "a".repeat(40); } });
    check("(refuse/--repo) the prepared head is not in the object store", refusedWith(() => checkObjects(repo, missingHead.request), "not readable"));
    const wrongTree = fixture({ change: (r) => { r.tree = baseTree; } });
    check("(refuse/--repo) head^{tree} is not the request's tree", refusedWith(() => checkObjects(repo, wrongTree.request), "head^{tree}"));
    const wrongBase = fixture({ change: (r) => { r.replay_base = head; } });
    check("(refuse/--repo) the prepared commit's parent is not replay_base", refusedWith(() => checkObjects(repo, wrongBase.request), "replay_base"));
    refusedClean("(refuse/write --repo) a missing prepared head writes nothing", "not readable", { fixture: missingHead, repo });

    // --- --show reads objects, never the publisher repository's own config or attributes
    const marker = join(root, "hostile-config-ran");
    const hostile = join(root, "hostile.sh");
    writeFileSync(hostile, `#!/bin/sh\ntouch '${marker}'\ncat "$1" 2>/dev/null\n`, { mode: 0o755 });
    scratchGitOk(repo, ["config", "core.fsmonitor", hostile]);
    scratchGitOk(repo, ["config", "diff.hostile.textconv", hostile]);
    scratchGitOk(repo, ["config", "core.pager", hostile]);
    mkdirSync(join(repo, ".git", "info"), { recursive: true });
    writeFileSync(join(repo, ".git", "info", "attributes"), "* diff=hostile\n");
    const shown = showPrepared(repo, good.request, good.metadata);
    check("(show) prints the exact title, body and patch", shown.includes("brain: synthetic (job jfix)") && shown.includes("+Synthetic public fixture.") && shown.includes(head));
    check("(show) the publisher repository's config, hooks and attributes never run", !readdirSync(root).includes(basename(marker)));
    check("(show) terminal controls and bidi marks are escaped", terminalSafe("a\u001b[2Jb\rc\u202ed") === "a\\u{1b}[2Jb\\u{d}c\\u{202e}d");

    // --- CLI
    const prepared = join(root, "prepared.log");
    writeFileSync(prepared, ["job jfix: synthetic", "dry run: privacy review is still required", REQUEST_MARKER + JSON.stringify(good.request), METADATA_MARKER + JSON.stringify(good.metadata), ""].join("\n"));
    const cli = (args, input) => spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: "utf8", input, timeout: 60000 });
    const ok = cli(["--check", "--prepared", prepared, "--repo", repo]);
    check("(cli) --check on the publisher's dry-run output verifies the binding and objects", ok.status === 0 && ok.stdout.includes("binding verified") && ok.stdout.includes("head^{tree} matches"));
    const viaStdin = cli(["--check", "--request", "-", "--metadata", prepared], readFileSync(prepared, "utf8"));
    check("(cli) one input may come from stdin", viaStdin.status === 0 && viaStdin.stdout.includes("binding verified"));
    const twoStdin = cli(["--check", "--request", "-", "--metadata", "-"], "");
    check("(cli) two inputs from stdin are refused", twoStdin.status === 1 && twoStdin.stderr.includes("only one input may come from stdin"));
    const noReview = cli(["--write", "--prepared", prepared, "--clearances", clearanceDir()]);
    check("(cli) --write without review input is refused before anything is read or written", noReview.status === 1 && noReview.stderr.includes("there is no default decision"));
    const mixed = cli(["--write", "--prepared", prepared, "--clearances", clearanceDir(), "--review-input", prepared, "--source-summary", "x"]);
    check("(cli) review flags mixed with --review-input are refused", mixed.status === 1 && mixed.stderr.includes("not both"));
    writeFileSync(join(root, "doubled.log"), readFileSync(prepared, "utf8") + REQUEST_MARKER + JSON.stringify(good.request) + "\n");
    const twice = cli(["--check", "--prepared", join(root, "doubled.log")]);
    check("(cli) two request lines are refused rather than one chosen", twice.status === 1 && twice.stderr.includes("refusing to choose"));

    // --- collision at the final clearance name: platform-neutral, so it runs everywhere.
    // Only this attempt's two evidence files are removed; the existing file and an unrelated
    // file are left byte-for-byte as they were.
    const collision = (label, host) => {
      const cdir = clearanceDir(), existing = Buffer.from("pre-existing clearance bytes\n"), unrelated = Buffer.from("unrelated\n");
      writeFileSync(join(cdir, "jfix.json"), existing, { flag: "wx", mode: 0o444 });
      writeFileSync(join(cdir, "other.json"), unrelated, { flag: "wx", mode: 0o444 });
      check(label, refusedWith(() => writeClearance({ ...fixture(), review: review(), clearances: cdir, now: NOW, ttlMinutes: 30, identity, ...host }), "refusing to overwrite") &&
        JSON.stringify(readdirSync(cdir).sort()) === JSON.stringify(["jfix.json", "other.json"]) &&
        readFileSync(join(cdir, "jfix.json")).equals(existing) && readFileSync(join(cdir, "other.json")).equals(unrelated));
    };
    collision("(refuse) a collision at the final <job>.json removes only this attempt's two evidence files", linux);

    // --- real Darwin ACLs, read by the DEFAULT ls -lde reader (no injected runLs), on synthetic
    // temporary fixtures only. ACLs are applied and removed with chmod +a / chmod -N exactly as the
    // publisher's own Darwin self-test does.
    if (process.platform === "darwin") {
      const aclEnv = { PATH: TOOL_PATH, LANG: "C", LC_ALL: "C" };
      const plant = (target) => {
        const grant = spawnSync("/bin/chmod", ["+a", "user:" + userInfo().username + " allow writesecurity", target], { encoding: "utf8", env: aclEnv });
        if (grant.status !== 0) throw new Error("Darwin writesecurity fixture could not be created: " + grant.stderr);
        const listed = spawnSync("/bin/ls", ["-lde", target], { encoding: "utf8", env: aclEnv });
        const lines = listed.stdout.trimEnd().split("\n"), mode = listed.stdout.split(/\s+/, 1)[0];
        if (!(listed.status === 0 && listed.stdout.includes("writesecurity") && (mode.includes("+") || lines.length > 1))) throw new Error("Darwin ACL fixture was not observed on " + target);
      };
      const unplant = (target) => {
        try { lstatSync(target); } catch { return; }
        const removed = spawnSync("/bin/chmod", ["-N", target], { encoding: "utf8", env: aclEnv });
        if (removed.status !== 0) throw new Error("own Darwin ACL fixture was not removed: " + removed.stderr);
      };
      const writeDefault = (cdir, afterCreate = null) => writeClearance({ ...fixture(), review: review(), clearances: cdir, now: NOW, ttlMinutes: 30, identity, afterCreate });
      const withUnrelated = (cdir) => { writeFileSync(join(cdir, "other.json"), "unrelated\n", { flag: "wx", mode: 0o444 }); return cdir; };
      const onlyUnrelated = (cdir) => JSON.stringify(readdirSync(cdir)) === JSON.stringify(["other.json"]);

      const positive = clearanceDir();
      const listedDir = darwinLs(positive);
      if (listedDir.status !== 0 || listedDir.stdout.trimEnd().split("\n").length !== 1) throw new Error("Darwin positive fixture did not start ACL-free");
      writeDefault(positive);
      check("(Darwin, default ls -lde) a write to a real ACL-free reviewer-owned 0711 clearances/ succeeds; all three files are 0444, single-link, owned by the uid",
        JSON.stringify(readdirSync(positive).sort()) === JSON.stringify(["jfix.artifact_review.json", "jfix.json", "jfix.source_review.json"]) &&
        readdirSync(positive).every((name) => { const st = lstatSync(join(positive, name)); return st.isFile() && st.nlink === 1 && st.uid === uid && (st.mode & 0o777) === 0o444; }));

      const fileAcl = withUnrelated(clearanceDir());
      let planted = null;
      try {
        check("(refuse/Darwin, default ls -lde) an ACL on a written file is refused after writing, and only this run's files are removed",
          refusedWith(() => writeDefault(fileAcl, (paths) => { planted = paths[2]; plant(planted); }), "has an ACL") && planted !== null && onlyUnrelated(fileAcl));
      } finally { if (planted !== null) unplant(planted); }

      const dirAcl = withUnrelated(clearanceDir());
      let dirPlanted = false;
      try {
        check("(refuse/Darwin, default ls -lde) an ACL appearing on clearances/ during readback is refused, and only this run's files are removed",
          refusedWith(() => writeDefault(dirAcl, () => { plant(dirAcl); dirPlanted = true; }), "the clearances directory has an ACL") && dirPlanted && onlyUnrelated(dirAcl));
      } finally { unplant(dirAcl); }

      collision("(refuse/Darwin, default ls -lde) a collision at the final <job>.json removes only this attempt's two evidence files", {});

      const aclDir = clearanceDir();
      plant(aclDir);
      try { check("(refuse/Darwin, default ls -lde) a real writesecurity ACL on clearances/ before writing", refusedWith(() => writeDefault(aclDir), "has an ACL") && readdirSync(aclDir).length === 0); }
      finally { unplant(aclDir); }
    } else {
      console.log(`SKIPPED on ${process.platform} (not run, not counted as passed): the five real-ACL Darwin cases need macOS's chmod +a and ls -lde ` +
        "(positive write with the default reader; post-write file ACL; directory ACL during readback; final-name collision under the default reader; " +
        "pre-write directory ACL). Here the ACL guard runs only against injected ls -lde listings.");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
  if (pass !== total) { console.error(`self-test FAILED (${pass}/${total})`); process.exit(1); }
  console.log(`self-test passed (${pass}/${total})`);
}

if (isMainModule(process.argv[1], import.meta.url)) {
  const argv = process.argv.slice(2);
  try {
    if (argv.length === 1 && argv[0] === "--self-test") selfTest();
    else main(argv, { now: Date.now() });
  } catch (e) {
    console.error(e instanceof ReviewRefusal ? `REFUSED: ${e.message}` : `ERROR: ${e.message}`);
    process.exit(1);
  }
}
