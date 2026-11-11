// Refresh the Mac tick's OWN behind heartbeat PR (PR #1698 HIGH finding).
//
//   node scripts/lane-heartbeat-refresh.mjs <original-submission-receipt>
//
// The SignalGrid_Alpha ruleset is strict (a PR must be up to date), so every
// mainline merge puts the tick's `lane/mac-mail-*` heartbeat PR BEHIND, and the
// next heartbeat is only sent after the previous one merged: without a refresh a
// running Mac looks silent. This is the one mutation the tick may make on that
// PR: GitHub's update-branch API, pinned to the head the tick last knew.
//
// It touches a PR only when ALL of these are proven by a fresh GET; anything
// else (read error, unknown state, a PR that is not provably the tick's own) is
// reported as NOT TOUCHED and the PR is left exactly as it was:
//   - the receipt is an owned, private, regular file naming a mac-mail topic;
//   - exactly one OPEN PR has that topic as head, in this repository, base
//     SignalGrid_Alpha, opened by the authenticated gh user;
//   - its head sha equals the head the tick recorded (the receipt's head, or the
//     head this script itself verified after an earlier refresh);
//   - mergeable_state is exactly "behind" and auto-merge is still requested.
//   - every check run on that head has completed (a running check is left to finish:
//     exit 20, no update); an unreadable or partial check list is NOT TOUCHED.
// After the PUT it GETs again and claims a refresh only if the head moved.
//
// Exit: 0 refreshed and verified | 20 nothing to do (open and not behind, or
// closed/merged) | 21 NOT TOUCHED (fail closed; reason printed) | 22 update was
// requested but the head did not move (reported, never claimed).
import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";

const MAINLINE = "SignalGrid_Alpha";
const MAX_REFRESHES = 6; // every refresh reruns CI; bounded, never a loop
const GH_TIMEOUT_MS = 30000;
const SETTLE_MS = Number.isInteger(+process.env.SG_REFRESH_SETTLE_MS) ? +process.env.SG_REFRESH_SETTLE_MS : 3000;
const SETTLE_TRIES = 5;

function out(code, msg) { console.log(`heartbeat-refresh: ${msg}`); process.exit(code); }
const notTouched = why => out(21, `NOT TOUCHED - ${why}`);

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", timeout: GH_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  return { code: r.status ?? -1, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function getJson(args, what) {
  const r = gh(args);
  if (r.code !== 0) notTouched(`${what} unavailable (gh exit ${r.code})`);
  try { return JSON.parse(r.out); } catch { return notTouched(`${what} is not JSON`); }
}
function ownedJson(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > 1024 * 1024 || (st.mode & 0o077) ||
        (typeof process.getuid === "function" && st.uid !== process.getuid())) throw Error("owned private regular file required");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
}
function exists(path) { try { lstatSync(path); return true; } catch (e) { if (e.code === "ENOENT") return false; throw e; } }
function settle() { if (SETTLE_MS > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, SETTLE_MS); }

const receiptPath = process.argv[2];
if (!receiptPath || process.argv.length !== 3) out(21, "NOT TOUCHED - usage: lane-heartbeat-refresh.mjs <original-submission-receipt>");

let r;
try { r = ownedJson(receiptPath); } catch (e) { notTouched(`receipt unreadable (${e.message})`); }
if (r.version !== 1 || typeof r.target !== "string" || !/^lane\/mac-mail-\d{8}-\d{6}Z-[a-f0-9]{12}$/.test(r.target) ||
    !/^[a-f0-9]{40}$/.test(r.head ?? "") || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.repository ?? "")) {
  notTouched("receipt does not name a mac-mail heartbeat topic, head and repository");
}
const slug = r.repository, owner = slug.split("/")[0];

// The head the tick last knew: the receipt's, then each refresh this script verified.
let pinned = r.head, count = 0;
try {
  for (;;) {
    const rec = `${receiptPath}.refresh-${count + 1}.json`;
    if (!exists(rec)) break;
    const v = ownedJson(rec);
    if (v.from !== pinned || !/^[a-f0-9]{40}$/.test(v.after ?? "")) throw Error(`refresh record ${count + 1} does not continue the recorded head`);
    pinned = v.after; count += 1;
  }
  if (exists(`${receiptPath}.refresh-${count + 1}.intent.json`)) throw Error("an earlier refresh was requested and never verified");
} catch (e) { notTouched(`refresh history unusable (${e.message})`); }
if (count >= MAX_REFRESHES) notTouched(`already refreshed ${count} times; leaving it for a person`);

const me = getJson(["api", "user"], "authenticated user");
if (typeof me.login !== "string" || !me.login) notTouched("authenticated user unknown");
const listed = getJson(["api", `repos/${slug}/pulls?state=open&head=${owner}:${r.target}`], "PR list");
if (!Array.isArray(listed)) notTouched("PR list is not an array");
if (listed.length === 0) out(20, `no open PR for ${r.target}; nothing to refresh`);
if (listed.length !== 1) notTouched(`${listed.length} open PRs name ${r.target}`);
const number = listed[0]?.number;
if (!Number.isInteger(number) || number <= 0) notTouched("PR number unknown");

const pr = getJson(["api", `repos/${slug}/pulls/${number}`], `PR ${number}`);
const own = pr.head?.ref === r.target && pr.head?.repo?.full_name === slug && pr.base?.ref === MAINLINE &&
  pr.base?.repo?.full_name === slug && pr.user?.login === me.login && pr.number === number;
if (!own) notTouched(`PR ${number} is not provably the tick's own (head ref, repository, base or author differ)`);
if (pr.state !== "open") out(20, `PR ${number} is ${pr.state}; nothing to refresh`);
if (pr.head.sha !== pinned) notTouched(`PR ${number} head ${String(pr.head.sha).slice(0, 12)} is not the head the tick recorded (${pinned.slice(0, 12)})`);
if (pr.mergeable_state !== "behind") {
  if (["clean", "blocked", "unstable", "has_hooks"].includes(pr.mergeable_state)) out(20, `PR ${number} is ${pr.mergeable_state}; not behind`);
  notTouched(`PR ${number} mergeable_state is ${JSON.stringify(pr.mergeable_state)}, not "behind"`);
}
if (!pr.auto_merge) notTouched(`PR ${number} no longer has auto-merge requested; not the tick's delivery path`);

// Wait while checks run on the head: an update replaces the head, and the CI workflow
// cancels the run on the head it replaces. With mainline moving, refreshing every tick
// would cancel validation over and over and spend all MAX_REFRESHES before one run
// finished. An unread or partial check list is not "nothing is running": not touched.
const runs = getJson(["api", `repos/${slug}/commits/${pinned}/check-runs?per_page=100`], `checks on ${pinned.slice(0, 12)}`);
if (!Array.isArray(runs.check_runs) || !Number.isSafeInteger(runs.total_count) || runs.total_count > runs.check_runs.length) {
  notTouched(`check list for ${pinned.slice(0, 12)} is incomplete (${Array.isArray(runs.check_runs) ? runs.check_runs.length : "no"} of ${JSON.stringify(runs.total_count)} runs read)`);
}
const running = runs.check_runs.filter(c => c?.status !== "completed").map(c => String(c?.name ?? "unnamed"));
if (running.length) out(20, `PR ${number} is behind, but ${running.length} check(s) still run on ${pinned.slice(0, 12)} (${running.slice(0, 3).join(", ")}${running.length > 3 ? ", ..." : ""}); waiting, no update`);

// Record the intent BEFORE the mutation: a crash between PUT and verification
// leaves it, and every later run then refuses rather than guess.
const n = count + 1;
try { writeFileSync(`${receiptPath}.refresh-${n}.intent.json`, JSON.stringify({ version: 1, pr: number, from: pinned }) + "\n", { flag: "wx", mode: 0o600, flush: true }); }
catch (e) { notTouched(`could not record the refresh intent (${e.message})`); }

const put = gh(["api", "-X", "PUT", `repos/${slug}/pulls/${number}/update-branch`, "-f", `expected_head_sha=${pinned}`]);
if (put.code !== 0) notTouched(`update-branch refused or failed (gh exit ${put.code}): ${(put.err || put.out).trim().slice(0, 200)}`);

for (let i = 0; i < SETTLE_TRIES; i += 1) {
  settle();
  const g = gh(["api", `repos/${slug}/pulls/${number}`]);
  let after = null;
  try { after = g.code === 0 ? JSON.parse(g.out) : null; } catch { after = null; }
  const sha = after?.head?.sha;
  if (/^[a-f0-9]{40}$/.test(sha ?? "") && sha !== pinned) {
    try { writeFileSync(`${receiptPath}.refresh-${n}.json`, JSON.stringify({ version: 1, pr: number, from: pinned, after: sha }) + "\n", { flag: "wx", mode: 0o600, flush: true }); }
    catch (e) { notTouched(`PR ${number} head moved to ${sha.slice(0, 12)} but the record failed (${e.message})`); }
    out(0, `refreshed PR ${number}: head ${pinned.slice(0, 12)} -> ${sha.slice(0, 12)} (verified by a fresh GET)`);
  }
}
out(22, `update-branch for PR ${number} was accepted but the head is still ${pinned.slice(0, 12)} after ${SETTLE_TRIES} reads; refresh NOT claimed`);
