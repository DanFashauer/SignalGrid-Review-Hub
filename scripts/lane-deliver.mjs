// lane-deliver.mjs — write a lane artifact and DELIVER it in one step, on a path
// that never touches the caller's checkout and never rides a code branch.
//
//   pnpm run lane:deliver send "subject" "body…"
//   pnpm run lane:deliver ack <message-id> "what I did"
//   pnpm run lane:deliver heartbeat <routine-id> "quiet | acted: what"
//   pnpm run lane:deliver batch ops.json        # [{op:"ack",id,note},{op:"send",subject,body},{op:"heartbeat",routine,result}]
//                                               # + {op:"raise",doing,blocked,need,who,domain?,where?,covers?[]} / {op:"take",id} / {op:"clear",id,resolution}
//                                               #   (a raised hand — artifacts/raised-hands/, scripts/raise-hand.mjs, DR-054)
//
//   The commit carries the mail directories and, when a message file was added,
//   the regenerated docs/agent/SURFACE_REVIEW_COVERAGE.md (its file count moved).
//   flags: --dry-run        build and gate the commit, push nothing, keep nothing
//          --via-pr         compatibility flag; both lanes already use a mail PR
//          --trailer "K: v" append a commit trailer (repeatable)
//          --allow-ungated  deliver even when mainline lacks a gate script (named
//                           in the output; never the default — see step 3)
//          --no-wake        skip the mailbox-PR comment
//          --receipt <file> required for Mac mutation entry; persist exact
//                           submission binding before the push
//   lane:deliver readback <receipt> verifies canonical landing without mutations
//   add --resolved-hand <id> to require that exact hand is now resolved in canonical
//   --pending-cadence <tick-token> <Bash-PID> is only for the actual owned tick:
//   fixed 120-minute read cadence, exit 6 means deferred and never canonical success.
//
// WHY THIS EXISTS (2026-09-05, owner: "this is not working and causing delay").
// The channel's law was "the push is the delivery", and three things made the
// push late. The cloud lane's acks and heartbeats rode its CODE branch, so they
// were held whenever that branch carried an open pull request — mail queued
// behind a ten-minute CI run it had nothing to do with. Both lanes had to run
// three commands after writing (add, commit, push) and the third was the one
// that got skipped. And a message written into a checkout mid-task sat there
// until the task finished. So this script does the whole delivery itself, from a
// throwaway worktree at origin/SignalGrid_Alpha:
//
//   Both lanes → push lane/<lane>-mail-<stamp>, open a PR and request auto-merge
//                when gh is available. Canonical branch rules apply equally to
//                Mac and cloud credentials. A published branch is still pending
//                until its PR passes the required checks and actually merges.
//
// The caller's checkout is never modified: no branch switch, no stash, no
// commit on the branch the caller is working on.
//
// Exit 0 means the PR and its auto-merge request were accepted, still pending
// canonical merge. Exit 3 requires readback of an unconfirmed mutation. A cloud
// session without gh can publish the topic and receives exit 4 for its PR-tool
// handoff. An unattended Mac requires gh before it pushes anything.
//
// FAIL CLOSED. Every artifact is gated inside the worktree by the same checks CI
// runs (`check-lane-messages.mjs`; `check-scheduled-routines.mjs` for a
// heartbeat) BEFORE the commit exists. A rejected push is reported with the
// branch it tried, never retried into a different ref. The clock stamps artifact
// instants, branch names and readback observations; it never authorizes replay.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentLane } from "./lib/lane-identity.mjs";
import { checkTickOwner } from "./lib/lane-attempt-store.mjs";
import { ReadbackEvidence } from "./lib/lane-readback.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAINLINE = "SignalGrid_Alpha";
const MAIL_DIRS = ["artifacts/lane-messages", "artifacts/agent-heartbeats", "artifacts/raised-hands"];
const COVERAGE_SCRIPT = "scripts/check-surface-review-coverage.mjs";
const COVERAGE_PAGE = "docs/agent/SURFACE_REVIEW_COVERAGE.md";
const MAILBOX_FILE = "docs/agent/lane-mailbox.json";
const ROUTINES_FILE = "docs/agent/scheduled-routines.json";

let publicationAttempted = false;
process.on("uncaughtException", (error) => {
  const code = publicationAttempted ? 3 : 1;
  console.error(`lane-deliver: unexpected error: ${error.message}; ${publicationAttempted ? "READBACK ONLY, no resend" : "no publication attempted"}`);
  process.exit(code);
});

function die(msg, code = 2) {
  console.error(`lane-deliver: ${msg}`);
  process.exit(code);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...opts });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}`, err: `${r.stderr ?? ""}` };
}
function git(args, cwd = repo) {
  return run("git", args, { cwd });
}
function gitCapture(args, cwd = repo) {
  const r = spawnSync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return { status: r.status ?? null, signal: r.signal ?? null, error: r.error ? (r.error.code ?? r.error.name ?? "unknown") : null,
    stdout: Buffer.from(r.stdout ?? ""), stderr: Buffer.from(r.stderr ?? "") };
}
const digest = raw => createHash("sha256").update(raw).digest("hex");
function exactText(raw) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
  if (!Buffer.from(text).equals(raw)) throw Error("Git output is not exact UTF-8");
  return text;
}
function mustGit(args, cwd, what) {
  const r = git(args, cwd);
  if (r.code !== 0) die(`${what}: git ${args.join(" ")} failed\n${r.err || r.out}`, 1);
  return r.out.trim();
}

// ── argument parsing ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = { dryRun: false, noWake: false, allowUngated: false, trailers: [] };
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--dry-run") flags.dryRun = true;
  else if (a === "--via-pr") continue;
  else if (a === "--no-wake") flags.noWake = true;
  else if (a === "--pending-cadence") {
    flags.pendingCadence = { token: argv[++i], shellPid: argv[++i] };
  }
  else if (a === "--allow-ungated") flags.allowUngated = true;
  else if (a === "--resolved-hand") {
    const id = argv[++i];
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(id ?? "")) die("--resolved-hand requires an exact safe hand id");
    flags.resolvedHand = id;
  }
  else if (a === "--receipt") {
    const v = argv[++i];
    if (!v || v.startsWith("--")) die("--receipt needs an unused local file");
    flags.receipt = resolve(v);
  } else if (a === "--trailer") {
    const v = argv[i + 1];
    if (!v) die("--trailer needs a value");
    flags.trailers.push(v);
    i += 1;
  } else positional.push(a);
}
const [cmd, ...rest] = positional;
if (flags.resolvedHand && cmd !== "readback") die("--resolved-hand is readback-only");
if (flags.pendingCadence && cmd !== "readback") die("--pending-cadence is readback-only");
const ALLOW_UNGATED = flags.allowUngated;

/** @returns {Array<{op:string,[k:string]:string}>} */
function parseOps() {
  if (cmd === "send") {
    const [subject, ...body] = rest;
    if (!subject || body.length === 0) die('usage: lane:deliver send "subject" "body…"');
    return [{ op: "send", subject, body: body.join(" ") }];
  }
  if (cmd === "ack") {
    const [id, ...note] = rest;
    if (!id) die('usage: lane:deliver ack <message-id> ["what I did"]');
    return [{ op: "ack", id, note: note.join(" ") }];
  }
  if (cmd === "heartbeat") {
    const [routine, ...result] = rest;
    if (!routine || result.length === 0) die('usage: lane:deliver heartbeat <routine-id> "quiet | acted: what"');
    return [{ op: "heartbeat", routine, result: result.join(" ") }];
  }
  if (cmd === "batch") {
    const [file] = rest;
    if (!file || !existsSync(file)) die("usage: lane:deliver batch <ops.json> (a JSON array of {op, …})");
    let ops;
    try {
      ops = JSON.parse(readFileSync(file, "utf8"));
    } catch (e) {
      die(`${file} is not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!Array.isArray(ops) || ops.length === 0) die(`${file} must be a non-empty JSON array of operations`);
    for (const o of ops) {
      if (!o || typeof o !== "object" || !["send", "ack", "heartbeat", "raise", "take", "clear"].includes(o.op)) {
        die(`unknown op in ${file}: ${JSON.stringify(o)} (send | ack | heartbeat | raise | take | clear)`);
      }
    }
    return ops;
  }
  die(`unknown command "${cmd ?? ""}". Try: send | ack | heartbeat | batch`);
}


// Old loaded Bash can acquire new JS through its canonical checkout. Require its
// new caller ABI before even inspecting Git, rather than letting it publish
// without an independent parent attempt. A filename is not an execution grant;
// the caller still owns its durable one-attempt intent and exact finalization.
const mutationLane = ["send", "ack", "heartbeat", "batch"].includes(cmd) ? currentLane() : null;
if (mutationLane === "mac") {
  if (!flags.receipt) die("Mac mutation requires --receipt before repository access; legacy caller held", 1);
  try {
    for (const path of [flags.receipt, ...[".push.json", ".push.raw.json", ".push-ref.json", ".push-ref.raw.json"].map(suffix => flags.receipt + suffix)]) {
      try { lstatSync(path); throw Error("receipt or original push evidence was already used"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const parent = dirname(flags.receipt);
    const fd = openSync(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const actual = fstatSync(fd), named = lstatSync(parent);
      if (!actual.isDirectory() || !named.isDirectory() || actual.dev !== named.dev || actual.ino !== named.ino
          || (typeof process.getuid === "function" && actual.uid !== process.getuid()) || (actual.mode & 0o022)) {
        throw Error("receipt parent is not an owned private directory");
      }
    } finally { closeSync(fd); }
  } catch {
    die("Mac mutation receipt destination is unavailable or already used; READBACK ONLY, no repository access", 1);
  }
}

// Resolve repository identity once; unknown identity never grants a fallback.
const remoteUrl = git(["remote", "get-url", "origin"]);
const slugMatch = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(remoteUrl.out.trim());
const repoSlug = remoteUrl.code === 0 && slugMatch ? `${slugMatch[1]}/${slugMatch[2]}` : null;

// Immutable private receipts bind a caller's one attempt to its exact Git data.
// Readback uses GET/fetch only; it never repeats a publication mutation.
function receiptWrite(path, value) {
  writeFileSync(path, JSON.stringify(value) + "\n", { flag: "wx", mode: 0o600, flush: true });
}
function receiptRead(path, canonical = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > 1024 * 1024) throw Error("owned regular receipt required");
    const raw = readFileSync(fd);
    const after = fstatSync(fd);
    if (["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => st[key] !== after[key]) || raw.length !== st.size) throw Error("receipt changed during read");
    const value = JSON.parse(exactText(raw));
    if (canonical && !Buffer.from(JSON.stringify(value) + "\n").equals(raw)) throw Error("captured Git record is not its exact representation");
    return { value, sha256: digest(raw) };
  } finally { closeSync(fd); }
}
// Raw buffers are committed before UTF-8 decoding or refusal/GET interpretation.
// A partial capture is evidence, never permission to publish with another ID.
function captureWrite(prefix, binding, command, result) {
  const raw = { ...binding, kind: binding.kind + "-raw", command,
    status: result.status, signal: result.signal, error: result.error,
    stdout_base64: result.stdout.toString("base64"), stderr_base64: result.stderr.toString("base64"),
    stdout_sha256: digest(result.stdout), stderr_sha256: digest(result.stderr) };
  receiptWrite(prefix + ".raw.json", raw);
  let stdout = null, stderr = null, valid = false;
  try { stdout = exactText(result.stdout); stderr = exactText(result.stderr); valid = true; } catch { /* raw evidence remains exact */ }
  const terminal = { ...binding, command, status: result.status, signal: result.signal, error: result.error,
    stdout, stderr, stdout_sha256: raw.stdout_sha256, stderr_sha256: raw.stderr_sha256,
    raw_capture_sha256: digest(Buffer.from(JSON.stringify(raw) + "\n")), utf8_valid: valid };
  receiptWrite(prefix + ".json", terminal);
  return terminal;
}
function captureRead(prefix) {
  const terminal = receiptRead(prefix + ".json", true), raw = receiptRead(prefix + ".raw.json", true);
  const p = terminal.value, b = raw.value;
  if (p.raw_capture_sha256 !== raw.sha256 || b.kind !== p.kind + "-raw") throw Error("original raw Git capture differs");
  for (const key of ["version", "receipt_sha256", "repository", "base", "head", "target", "producer_head", "producer_source_sha256", "push_result_sha256", "command", "status", "signal", "error", "stdout_sha256", "stderr_sha256"]) {
    if (JSON.stringify(p[key]) !== JSON.stringify(b[key])) throw Error("raw Git capture binding differs");
  }
  for (const name of ["stdout", "stderr"]) {
    const encoded = b[name + "_base64"];
    if (typeof encoded !== "string") throw Error("raw Git bytes missing");
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.toString("base64") !== encoded || digest(bytes) !== b[name + "_sha256"] || p.utf8_valid !== true || exactText(bytes) !== p[name]) throw Error("raw Git output or UTF-8 differs");
  }
  return terminal;
}
function present(path) {
  try { lstatSync(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
function originalPushRefusal(path, receipt) {
  if (!present(path + ".push.json")) {
    if (present(path + ".push.raw.json")) throw Error("original push capture is incomplete");
    return null; // Older receipt: only ordinary GET/canonical readback can resolve it.
  }
  const r = receipt.value, push = captureRead(path + ".push"), p = push.value;
  if (p.version !== 1 || p.kind !== "original-lane-push-terminal" || p.receipt_sha256 !== receipt.sha256 || !/^[a-f0-9]{40}$/.test(r.base ?? "") ||
      ["repository", "base", "head", "target", "producer_head", "producer_source_sha256"].some(key => p[key] !== r[key]) ||
      !/^[a-f0-9]{40}$/.test(p.producer_head ?? "") || !/^[a-f0-9]{64}$/.test(p.producer_source_sha256 ?? "") ||
      JSON.stringify(p.command) !== JSON.stringify(["git", "push", "origin", `HEAD:refs/heads/${r.target}`])) throw Error("original push terminal belongs to different source/receipt/ref");
  const source = gitCapture(["--no-replace-objects", "-c", "core.fsmonitor=false", "show", `${p.producer_head}:scripts/lane-deliver.mjs`]);
  if (source.status !== 0 || source.signal || source.error || digest(source.stdout) !== p.producer_source_sha256) throw Error("original producing source unavailable or changed");
  if (!Number.isInteger(p.status) || p.status <= 0 || p.status > 255 || p.signal !== null || p.error !== null ||
      !/GH006|GH013|remote rejected|protected branch|permission .+ denied/i.test(p.stderr + p.stdout)) return null;
  const prefix = path + ".push-ref";
  let observed;
  if (present(prefix + ".json")) observed = captureRead(prefix);
  else {
    if (present(prefix + ".raw.json")) throw Error("exact original ref capture is incomplete");
    const args = ["ls-remote", "origin", `refs/heads/${r.target}`], result = gitCapture(args);
    const binding = { version: 1, kind: "original-lane-push-ref-readback", receipt_sha256: receipt.sha256,
      push_result_sha256: push.sha256, repository: r.repository, head: r.head, target: r.target,
      producer_head: p.producer_head, producer_source_sha256: p.producer_source_sha256 };
    captureWrite(prefix, binding, ["git", ...args], result);
    observed = captureRead(prefix);
  }
  const q = observed.value;
  if (q.version !== 1 || q.kind !== "original-lane-push-ref-readback" || q.receipt_sha256 !== receipt.sha256 || q.push_result_sha256 !== push.sha256 ||
      ["repository", "head", "target", "producer_head", "producer_source_sha256"].some(key => q[key] !== p[key]) ||
      JSON.stringify(q.command) !== JSON.stringify(["git", "ls-remote", "origin", `refs/heads/${r.target}`]) ||
      q.status !== 0 || q.signal !== null || q.error !== null || q.stdout !== "") throw Error("exact original ref absence remains UNKNOWN");
  return { version: 1, kind: "original-push-refused", repository: r.repository, target: r.target,
    original_head: r.head, base: r.base, receipt_sha256: receipt.sha256, push_result_sha256: push.sha256,
    ref_readback_sha256: observed.sha256, remote_ref_state: "ABSENT", remote_oid: null,
    producer_head: p.producer_head, producer_source_sha256: p.producer_source_sha256,
    original_push_exit: p.status, publication_state: "KNOWN_REFUSED", no_replay: true, repair_only: true };
}
function readback(path) {
  try {
    const receipt = receiptRead(path), r = receipt.value;
    if (r.version !== 1 || !/^lane\/(mac|cloud)-mail-\d{8}-\d{6}Z-[a-f0-9]{12}$/.test(r.target)
      || !/^[a-f0-9]{40}$/.test(r.head)
      || !Array.isArray(r.blobs) || !r.blobs.length
      || r.blobs.some(b => typeof b.path !== "string" || b.path.includes("..") || !/^[a-f0-9]{40}$/.test(b.oid)
        || ![...MAIL_DIRS, COVERAGE_PAGE].some(p => b.path === p || b.path.startsWith(p + "/")))) throw Error("invalid submission binding");
    if (!repoSlug || repoSlug !== r.repository) throw Error("receipt repository differs");
    const evidence = new ReadbackEvidence(path, receipt.sha256, {
      pendingCadence: Boolean(flags.pendingCadence), resolvedHand: flags.resolvedHand ?? null,
      checkOwner: flags.pendingCadence ? () => checkTickOwner(repo, flags.pendingCadence.token, flags.pendingCadence.shellPid) : null,
    });
    const deferred = evidence.deferred();
    if (deferred) { console.log(deferred); return 6; }
    const refusal = originalPushRefusal(path, receipt);
    if (refusal) {
      console.log("original Git push was refused and its exact topic was observed absent; no resend or remote-quiet claim");
      console.log("refused delivery observation " + JSON.stringify(refusal));
      return 5;
    }
    const query = evidence.capture(["gh", "pr", "view", r.target, "--repo", r.repository, "--json", "number,state,baseRefName,headRefName,headRefOid,mergeCommit,autoMergeRequest,createdAt,mergeStateStatus,statusCheckRollup"], repo);
    const observation = query.prefix;
    if (query.status !== 0 || query.signal !== null || query.error !== null) throw Error("PR readback unavailable; original attempt stays held");
    const pr = JSON.parse(exactText(query.stdout)); // exact raw and actual terminal are durable before interpretation
    if (pr.baseRefName !== MAINLINE || !Number.isInteger(pr.number) || pr.number <= 0) throw Error("PR binding differs");
    if (pr.headRefName !== undefined && pr.headRefName !== null && pr.headRefName !== r.target) throw Error("PR topic binding differs");
    if (pr.state === "OPEN" && pr.autoMergeRequest) {
      const observed = new Date(), createdMs = typeof pr.createdAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(pr.createdAt) ? Date.parse(pr.createdAt) : NaN;
      const knownTime = Number.isFinite(createdMs) && createdMs <= observed.getTime();
      const states = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup.map(check => {
        if (check?.__typename === "CheckRun") {
          if (check.status !== "COMPLETED") return ["QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED", "PENDING"].includes(check.status) ? "pending" : "unknown";
          if (["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(check.conclusion)) return "failed";
          return check.conclusion === "SUCCESS" ? "success" : "unknown";
        }
        if (check?.__typename === "StatusContext") return ({ SUCCESS: "success", PENDING: "pending", FAILURE: "failed", ERROR: "failed" })[check.state] ?? "unknown";
        return "unknown";
      }) : [];
      const checkState = states.includes("failed") ? "failed" : states.includes("unknown") || !states.length ? "unknown" : states.includes("pending") ? "pending" : "success";
      const mergeState = ["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"].includes(pr.mergeStateStatus) ? pr.mergeStateStatus : "UNKNOWN";
      const bound = pr.headRefName === r.target && typeof pr.headRefOid === "string" && /^[a-f0-9]{40}$/.test(pr.headRefOid);
      console.log(`original PR ${pr.number} is still pending protected merge; no new submission`);
      console.log("pending delivery observation " + JSON.stringify({ version: 1, repository: r.repository,
        target: bound ? r.target : null, original_head: r.head, receipt_sha256: receipt.sha256,
        pr_number: pr.number, base: MAINLINE, pr_head: bound ? pr.headRefOid : null,
        created_at: knownTime ? pr.createdAt : null, observed_at: observed.toISOString(),
        age_seconds: knownTime ? Math.floor((observed.getTime() - createdMs) / 1000) : null,
        merge_state: mergeState, check_state: checkState,
        auto_merge_requested: typeof pr.autoMergeRequest === "object" && !Array.isArray(pr.autoMergeRequest) ? true : null }));
      return 4;
    }
    if (pr.state !== "MERGED" || !/^[a-f0-9]{40}$/.test(pr.mergeCommit?.oid ?? "")) throw Error(`PR ${pr.number} is ${pr.state}; canonical delivery remains unverified`);
    const named = git(["ls-remote", "origin", `refs/heads/${MAINLINE}`]);
    receiptWrite(`${observation}.canonical.json`, { exit: named.code, stdout: named.out, stderr: named.err });
    const row = named.out.trim().split(/\s+/);
    if (named.code || row.length !== 2 || !/^[a-f0-9]{40}$/.test(row[0]) || row[1] !== `refs/heads/${MAINLINE}`) throw Error("exact current canonical OID unavailable");
    const canonical = row[0]; // immutable; another fetch may change FETCH_HEAD
    const truthGit = (args) => run("git", ["--no-replace-objects", "-c", "core.fsmonitor=false", ...args],
      { cwd: repo, env: { ...process.env, GIT_GRAFT_FILE: "/dev/null" } });
    const fetched = git(["fetch", "--no-tags", "origin", canonical]);
    receiptWrite(`${observation}.fetch.json`, { exit: fetched.code, stdout: fetched.out, stderr: fetched.err });
    if (fetched.code || truthGit(["merge-base", "--is-ancestor", pr.mergeCommit.oid, canonical]).code || truthGit(["merge-base", "--is-ancestor", r.head, pr.mergeCommit.oid]).code) throw Error("merge is not verified in freshly fetched canonical ancestry");
    for (const b of r.blobs) {
      const actual = truthGit(["rev-parse", `${pr.mergeCommit.oid}:${b.path}`]);
      if (actual.code || actual.out.trim() !== b.oid) throw Error(`canonical blob differs: ${b.path}`);
    }
    if (flags.resolvedHand) {
      const path = `artifacts/raised-hands/${flags.resolvedHand}.json`;
      const hands = r.blobs.filter(b => b.path.startsWith("artifacts/raised-hands/"));
      if (hands.length !== 1 || hands[0].path !== path) throw Error("original hand identity differs");
      const object = truthGit(["rev-parse", `${canonical}:${path}`]);
      receiptWrite(`${observation}.resolved-oid.json`, { canonical, path, exit: object.code, stdout: object.out, stderr: object.err });
      const oid = object.out.trim();
      if (object.code || !/^[a-f0-9]{40}$/.test(oid)) throw Error("current hand object unavailable");
      const body = truthGit(["cat-file", "blob", oid]);
      receiptWrite(`${observation}.resolved-hand.json`, { canonical, path, oid, exit: body.code, stdout: body.out, stderr: body.err });
      if (body.code) throw Error("current hand body unavailable");
      const hand = JSON.parse(body.out);
      if (hand.id !== flags.resolvedHand || hand.status !== "resolved" || typeof hand.resolution !== "string" || !hand.resolution.trim() || typeof hand.resolvedAt !== "string" || !Number.isFinite(Date.parse(hand.resolvedAt))) throw Error("current canonical hand is not resolved with evidence");
      console.log(`resolved hand ${oid}`);
    }
    console.log(`canonical merge verified: PR ${pr.number} @ ${pr.mergeCommit.oid}; original topic ${r.target} @ ${r.head}`);
    return 0;
  } catch (e) { console.error(`RAISED HAND: ${e.message}; READBACK ONLY, no mutation`); return 3; }
}
if (cmd === "readback") {
  if (rest.length !== 1) die("usage: lane:deliver readback <original-submission-receipt>");
  process.exit(readback(resolve(rest[0])));
}

const ops = parseOps();
const lane = mutationLane ?? currentLane();
const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");

// ── 1. a throwaway worktree at the CURRENT mainline ───────────────────────────
console.log(`lane-deliver — this machine is the ${lane.toUpperCase()} lane`);
const fetched = git(["fetch", "--quiet", "origin", MAINLINE]);
if (fetched.code !== 0) die(`cannot fetch origin/${MAINLINE}: ${fetched.err.trim()} — a delivery needs the remote`, 1);
const base = mustGit(["rev-parse", `origin/${MAINLINE}`], repo, "resolving mainline");
const wt = mkdtempSync(join(tmpdir(), "sg-lane-deliver-"));
// The exit hook covers success, refusals and dry runs. A cleanup failure after
// publication keeps the original attempt readback-only; an abrupt kill may leave it.
process.on("exit", () => {
  try {
    git(["worktree", "remove", "--force", wt], repo);
    rmSync(wt, { recursive: true, force: true });
    git(["worktree", "prune"], repo);
  }
  catch (error) {
    process.exitCode = publicationAttempted ? 3 : 1;
    console.error(`lane-deliver: owned worktree cleanup failed: ${error.message}; ${publicationAttempted ? "READBACK ONLY, no resend" : "no publication attempted"}`);
  }
});
mustGit(["worktree", "add", "--quiet", "--detach", wt, base], repo, "creating the worktree");
console.log(`  worktree    ${wt} @ ${base} (origin/${MAINLINE})`);

{
  // ── 2. the operations, written INTO the worktree by the caller's own CLI ────
  // SIGNALGRID_LANE_REPO points lane-message.mjs at the worktree, so the file
  // lands where the commit is built and the caller's checkout stays untouched.
  const summary = [];
  const env = { ...process.env, SIGNALGRID_LANE_REPO: wt, SIGNALGRID_LANE: lane };
  let touchesHeartbeat = false;
  let touchesHands = false;
  for (const o of ops) {
    if (o.op === "send") {
      // `supersedes` (one id or a list) withdraws earlier messages by reference —
      // the writer refuses an id that does not exist in the worktree's mailbox.
      const sup = o.supersedes === undefined ? [] : Array.isArray(o.supersedes) ? o.supersedes : [o.supersedes];
      const args = [join(repo, "scripts/lane-message.mjs"), "send", o.subject, o.body];
      for (const s of sup) args.push("--supersedes", String(s));
      const r = run("node", args, { cwd: wt, env });
      if (r.code !== 0) die(`send refused:\n${r.err || r.out}`, r.code);
      const id = /wrote .*[\\/]([^\\/]+)\.json/.exec(r.out)?.[1] ?? "(id?)";
      summary.push(`send ${id}`);
    } else if (o.op === "ack") {
      const args = [join(repo, "scripts/lane-message.mjs"), "ack", o.id];
      if (o.note) args.push(o.note);
      const r = run("node", args, { cwd: wt, env });
      if (r.code !== 0) die(`ack refused:\n${r.err || r.out}`, r.code);
      summary.push(`ack ${o.id}`);
    } else if (o.op === "heartbeat") {
      // A heartbeat for a routine the registry does not declare is exactly the
      // "undeclared always-on lane" the routines gate calls fatal. Refuse here,
      // before a commit exists, rather than let the gate fail after.
      const registryPath = join(wt, ROUTINES_FILE);
      const registry = existsSync(registryPath) ? JSON.parse(readFileSync(registryPath, "utf8")) : null;
      const row = registry?.routines?.find((r) => r.id === o.routine);
      if (!row) die(`heartbeat: "${o.routine}" is not a routine declared in ${ROUTINES_FILE}`);
      if (!row.heartbeatPath) die(`heartbeat: "${o.routine}" declares no heartbeat path (${row.heartbeatPathReason ?? "no reason given"})`);
      if (!o.result || !String(o.result).trim()) die("heartbeat: an empty result is not evidence — say 'quiet' or what was done");
      const target = join(wt, row.heartbeatPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify({ firedAt: now.toISOString(), result: String(o.result) }, null, 2)}\n`, "utf8");
      touchesHeartbeat = true;
      summary.push(`heartbeat ${o.routine}`);
    } else if (o.op === "raise" || o.op === "take" || o.op === "clear") {
      // A raised hand rides the same delivery as mail: a stuck lane must be able to
      // say so without a code branch, a PR of its own, or a person to relay it.
      const args = [join(repo, "scripts/raise-hand.mjs")];
      if (o.op === "raise") {
        for (const [flag, v] of [["--doing", o.doing], ["--blocked", o.blocked], ["--need", o.need], ["--who", o.who], ["--domain", o.domain], ["--where", o.where], ["--id", o.id], ["--origin", lane]]) if (v !== undefined) args.push(flag, String(v));
        for (const c of o.covers ?? []) args.push("--covers", String(c));
      } else if (o.op === "take") {
        args.push("--take", String(o.id), "--by", String(o.by ?? lane));
      } else {
        args.push("--resolve", String(o.id), "--resolution", String(o.resolution ?? ""), "--by", lane);
      }
      const r = run("node", args, { cwd: wt, env });
      if (r.code !== 0) die(`${o.op} refused:\n${r.err || r.out}`, r.code);
      touchesHands = true;
      summary.push(`${o.op} ${o.op === "raise" ? (/raised-hands\/(\S+)\.json/.exec(r.out)?.[1] ?? "(id?)") : o.id}`);
    }
  }

  // ── 3. gate INSIDE the worktree, with mainline's own copies of the gates ────
  const gates = [["scripts/check-lane-messages.mjs", "lane messages"]];
  if (touchesHeartbeat) gates.push(["scripts/check-scheduled-routines.mjs", "scheduled routines"]);
  if (touchesHands) gates.push(["scripts/raised-hands.mjs", "raised hands", ["--coherence"]]);
  // The schema gate preflight and CI run: a hand it would reject must not reach mainline from here.
  if (touchesHands) gates.push(["scripts/check-raised-hands.mjs", "raised-hands schema"]);
  for (const [script, label, extra = []] of gates) {
    if (!existsSync(join(wt, script))) {
      // A check that did not run is not a check that passed. This used to
      // `continue` silently — "an older mainline without the gate has nothing to
      // fail" — and the run still ended "done" with no gate line at all, under a
      // header that promises FAIL CLOSED (artifacts/lane-messages read,
      // 2026-09-06). Now the skip is named and refused unless asked for.
      if (!ALLOW_UNGATED) die(`the ${label} gate is absent at origin/${MAINLINE}:${script} — refusing to deliver ungated (pass --allow-ungated to override, and say why in the message)`, 1);
      console.log(`  gate        ${label}: SKIPPED — script absent at ${script} (--allow-ungated)`);
      continue;
    }
    const r = run("node", [script, ...extra], { cwd: wt, env });
    if (r.code !== 0) die(`the ${label} gate refused this delivery:\n${r.out}${r.err}`, 1);
    console.log(`  gate        ${label}: passed`);
  }

  // ── 4. the commit ───────────────────────────────────────────────────────────
  mustGit(["add", "--", ...MAIL_DIRS.filter((d) => existsSync(join(wt, d)))], wt, "staging");
  // The surface-review coverage page used to print files-per-surface for the mailbox
  // trees, so a NEW message file changed artifacts/lane-messages' count, staled
  // docs/agent/SURFACE_REVIEW_COVERAGE.md and failed the mail PR (#445 did exactly
  // that) — and, worse, every regenerated page then conflicted every open product PR
  // (2026-09-12). Since then the generator declares the mailbox trees (MAILBOX_TREES)
  // and withholds their counts, so a delivery normally leaves the page byte-identical.
  // The regeneration STAYS: it is idempotent when nothing moved, and it still catches a
  // page that is stale for any other reason. Run it AFTER the mail is staged (the
  // derivation reads the tracked set), with mainline's own generator, and let that one
  // file ride along when it did change. A generator that refuses (a ledger the gate rejects)
  // refuses the delivery: mail must never ship a page the gate will not accept.
  const stagedMail = mustGit(["diff", "--cached", "--name-only"], wt, "listing the stage").split("\n").filter(Boolean);
  const allowed = [...MAIL_DIRS];
  if (stagedMail.length > 0 && !existsSync(join(wt, COVERAGE_SCRIPT))) {
    // Same rule as the gates above: a generator that is not there is not a page
    // that is current. Named, and refused unless asked for.
    if (!ALLOW_UNGATED) die(`the coverage generator is absent at origin/${MAINLINE}:${COVERAGE_SCRIPT} — refusing to deliver a page it cannot regenerate (pass --allow-ungated to override)`, 1);
    console.log(`  coverage    SKIPPED — generator absent at ${COVERAGE_SCRIPT} (--allow-ungated)`);
  }
  if (stagedMail.length > 0 && existsSync(join(wt, COVERAGE_SCRIPT))) {
    const r = run("node", [COVERAGE_SCRIPT, "--write"], { cwd: wt, env });
    if (r.code !== 0) die(`the surface-review coverage page could not be regenerated for this delivery:\n${r.out}${r.err}`, 1);
    mustGit(["add", "--", COVERAGE_PAGE], wt, "staging the coverage page");
    allowed.push(COVERAGE_PAGE);
    const pageChanged = mustGit(["diff", "--cached", "--name-only", "--", COVERAGE_PAGE], wt, "checking the coverage page").trim() !== "";
    console.log(`  coverage    ${COVERAGE_PAGE} ${pageChanged ? "regenerated (the file count moved)" : "unchanged"}`);
  }
  const staged = mustGit(["diff", "--cached", "--name-only"], wt, "listing the stage").split("\n").filter(Boolean);
  if (staged.length === 0) die("nothing to deliver — the operations produced no change against mainline", 1);
  const outside = staged.filter((f) => !allowed.some((d) => f === d || f.startsWith(`${d}/`)));
  if (outside.length > 0) die(`refusing to deliver files outside the lane directories: ${outside.join(", ")}`, 1);
  const title = `Lane mail (${lane}): ${summary.join(", ")}`.slice(0, 120);
  const bodyLines = [
    `Submitted by scripts/lane-deliver.mjs from a worktree at origin/${MAINLINE} ${base}.`,
    ...staged.map((f) => `  ${f}`),
  ];
  if (flags.trailers.length > 0) bodyLines.push("", ...flags.trailers);
  mustGit(["commit", "--quiet", "-m", title, "-m", bodyLines.join("\n")], wt, "committing");
  const sha = mustGit(["rev-parse", "HEAD"], wt, "reading the commit");
  console.log(`  commit      ${sha} — ${title}`);
  for (const f of staged) console.log(`              ${f}`);

  if (flags.dryRun) {
    console.log("  dry-run     pushed nothing; the worktree is removed and the commit discarded.");
    process.exit(0);
  }

  // ── 5. one topic push; canonical changes go through the protected PR ────────
  const ghAuthenticated = run("gh", ["auth", "status", "--hostname", "github.com"]).code === 0;
  if (lane === "mac" && (!ghAuthenticated || !repoSlug)) die("unattended Mac delivery requires authenticated gh and a GitHub origin; no push was attempted", 1);
  const target = `lane/${lane}-mail-${stamp}-${randomBytes(6).toString("hex")}`;
  let producer = {};
  if (flags.receipt) {
    const head = mustGit(["--no-replace-objects", "-c", "core.fsmonitor=false", "rev-parse", "HEAD"], repo, "binding producing source");
    const source = readFileSync(fileURLToPath(import.meta.url)), blob = gitCapture(["--no-replace-objects", "-c", "core.fsmonitor=false", "show", `${head}:scripts/lane-deliver.mjs`]);
    if (!/^[a-f0-9]{40}$/.test(head) || blob.status !== 0 || blob.signal || blob.error || !blob.stdout.equals(source)) die("exact committed producing source unavailable; no push attempted", 1);
    producer = { producer_head: head, producer_source_sha256: digest(source) };
  }
  if (flags.receipt) receiptWrite(flags.receipt, { version: 1, at: now.toISOString(), repository: repoSlug,
    base, head: sha, target, ...producer, blobs: staged.map(path => ({ path, oid: mustGit(["rev-parse", `${sha}:${path}`], wt, "binding the submission blob") })) });
  const receiptSha = flags.receipt ? receiptRead(flags.receipt).sha256 : null;
  publicationAttempted = true;
  const args = ["push", "origin", `HEAD:refs/heads/${target}`], actualPush = gitCapture(args, wt);
  if (flags.receipt) captureWrite(flags.receipt + ".push", { version: 1, kind: "original-lane-push-terminal",
    receipt_sha256: receiptSha, repository: repoSlug, base, head: sha, target, ...producer }, ["git", ...args], actualPush);
  let pushed;
  try { pushed = { code: actualPush.status ?? -1, out: exactText(actualPush.stdout), err: exactText(actualPush.stderr) }; }
  catch { die(`original push output encoding is UNKNOWN; ${flags.receipt ? "raw bytes retained" : "no durable raw receipt was requested"}; READBACK ONLY, no retry`, 3); }
  const pushResponse = `${pushed.err}${pushed.out}`.trim();
  if (actualPush.signal || actualPush.error || actualPush.status === null) die(`original push parent terminal is UNKNOWN; ${flags.receipt ? "raw evidence retained" : "no durable raw receipt was requested"}; READBACK ONLY, no retry`, 3);
  if (pushed.code !== 0 && /GH006|GH013|remote rejected|protected branch|permission .+ denied/i.test(pushResponse)) {
    die(`Git reported REFUSED for ${target}; publication remains unverified pending exact GET readback — no retry or other ref was tried:\n${pushResponse}`, 1);
  }

  // ── 6. confirm on the remote — local-only is not delivered ──────────────────
  const remoteRef = git(["ls-remote", "origin", `refs/heads/${target}`], wt);
  const remoteSha = remoteRef.code === 0 ? remoteRef.out.trim().split(/\s+/)[0] : null;
  if (remoteSha !== sha) die(`push outcome for ${target} @ ${sha} is unconfirmed; preserve it for readback, never resend:\n${pushResponse}\n${remoteRef.err.trim()}`, 3);
  if (pushed.code !== 0) console.log(`  push        response failed; exact remote ${sha} confirms the original push`);
  console.log(`  published   origin/${target} @ ${sha} (confirmed with git ls-remote; pending protected PR merge)`);

  const compare = repoSlug ? `https://github.com/${repoSlug}/compare/${MAINLINE}...${encodeURIComponent(target)}?expand=1` : `(compare ${MAINLINE}...${target})`;
  console.log(`  next        PR ${target} → ${MAINLINE}: ${compare}`);
  if (!ghAuthenticated || !repoSlug) die(`published cloud topic ${target} @ ${sha}; explicit PR-tool handoff required — do not push it again`, 4);
  const pr = run("gh", ["pr", "create", "--repo", repoSlug, "--base", MAINLINE, "--head", target, "--title", title, "--body", bodyLines.join("\n")], { cwd: wt });
  if (pr.code !== 0) die(`PR creation for ${target} @ ${sha} is unconfirmed; readback only, never repost:\n${pr.err || pr.out}`, 3);
  console.log(`  pr          ${pr.out.trim().split("\n").pop()}`);
  const am = run("gh", ["pr", "merge", "--repo", repoSlug, "--auto", "--merge", "--match-head-commit", sha, target], { cwd: wt });
  if (am.code !== 0) die(`auto-merge request for ${target} @ ${sha} is unconfirmed; readback only, never repeat:\n${am.err || am.out}`, 3);
  console.log("  auto-merge  enabled; canonical delivery remains pending");

  // ── 7. wake the other lane: a comment on the standing mailbox PR ────────────
  if (!flags.noWake) {
    try {
      const prNumber = JSON.parse(readFileSync(join(repo, MAILBOX_FILE), "utf8"))?.pr;
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        console.log(`  wake        no usable mailbox PR found in ${MAILBOX_FILE} — the other lane learns of this on its next fetch`);
      } else {
        const line = `${lane} lane published, pending protected merge: ${summary.join(", ")} — origin/${target} @ ${sha}`;
        const posted = run("gh", ["pr", "comment", String(prNumber), "--repo", repoSlug, "--body", line]);
        if (posted.code === 0) console.log(`  wake        commented on the mailbox PR #${prNumber} — the other lane wakes on it`);
        else console.log(`  wake        gh could not comment; to wake the other lane NOW, comment on https://github.com/${repoSlug}/pull/${prNumber}\n              (otherwise it sees this on its next hourly cycle)`);
      }
    } catch {
      console.log("  wake        optional wake unavailable; protected PR submission remains pending; the other lane sees it on its next fetch");
    }
  }
  console.log(`lane-deliver: submitted — ${target} @ ${sha}; canonical merge pending`);
}
