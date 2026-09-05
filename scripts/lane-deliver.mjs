// lane-deliver.mjs — write a lane artifact and DELIVER it in one step, on a path
// that never touches the caller's checkout and never rides a code branch.
//
//   pnpm run lane:deliver send "subject" "body…"
//   pnpm run lane:deliver ack <message-id> "what I did"
//   pnpm run lane:deliver heartbeat <routine-id> "quiet | acted: what"
//   pnpm run lane:deliver batch ops.json        # [{op:"ack",id,note},{op:"send",subject,body},{op:"heartbeat",routine,result}]
//
//   The commit carries the mail directories and, when a message file was added,
//   the regenerated docs/agent/SURFACE_REVIEW_COVERAGE.md (its file count moved).
//   flags: --dry-run        build and gate the commit, push nothing, keep nothing
//          --via-pr         push a lane/<lane>-mail-<stamp> branch even on the Mac
//          --trailer "K: v" append a commit trailer (repeatable)
//          --no-wake        skip the mailbox-PR comment
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
//   Mac lane   → the worktree commit is pushed STRAIGHT to SignalGrid_Alpha, the
//                same thing the Mac lane's own mail commits have always done.
//   Cloud lane → the worktree commit is pushed to lane/cloud-mail-<stamp>; the
//                cloud session then opens the PR and enables auto-merge (it has
//                the GitHub tools; this script has none). A direct push from the
//                cloud lane's credentials is refused by policy, so the branch is
//                not a preference, it is the only path.
//
// The caller's checkout is never modified: no branch switch, no stash, no
// commit on the branch the caller is working on. After the push the caller's
// own SignalGrid_Alpha (if that is what they have checked out) is one commit
// behind origin — `git pull --ff-only` when convenient.
//
// FAIL CLOSED. Every artifact is gated inside the worktree by the same checks CI
// runs (`check-lane-messages.mjs`; `check-scheduled-routines.mjs` for a
// heartbeat) BEFORE the commit exists. A rejected push is reported with the
// branch it tried, never retried into a different ref. Nothing here reads the
// clock except to stamp the artifact instant and name the branch.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentLane } from "./lib/lane-identity.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAINLINE = "SignalGrid_Alpha";
const MAIL_DIRS = ["artifacts/lane-messages", "artifacts/agent-heartbeats"];
const COVERAGE_SCRIPT = "scripts/check-surface-review-coverage.mjs";
const COVERAGE_PAGE = "docs/agent/SURFACE_REVIEW_COVERAGE.md";
const MAILBOX_FILE = "docs/agent/lane-mailbox.json";
const ROUTINES_FILE = "docs/agent/scheduled-routines.json";

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
function mustGit(args, cwd, what) {
  const r = git(args, cwd);
  if (r.code !== 0) die(`${what}: git ${args.join(" ")} failed\n${r.err || r.out}`, 1);
  return r.out.trim();
}

// ── argument parsing ──────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = { dryRun: false, viaPr: false, noWake: false, trailers: [] };
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === "--dry-run") flags.dryRun = true;
  else if (a === "--via-pr") flags.viaPr = true;
  else if (a === "--no-wake") flags.noWake = true;
  else if (a === "--trailer") {
    const v = argv[i + 1];
    if (!v) die("--trailer needs a value");
    flags.trailers.push(v);
    i += 1;
  } else positional.push(a);
}
const [cmd, ...rest] = positional;

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
      if (!o || typeof o !== "object" || !["send", "ack", "heartbeat"].includes(o.op)) {
        die(`unknown op in ${file}: ${JSON.stringify(o)} (send | ack | heartbeat)`);
      }
    }
    return ops;
  }
  die(`unknown command "${cmd ?? ""}". Try: send | ack | heartbeat | batch`);
}

const ops = parseOps();
const lane = currentLane();
const now = new Date();
const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z").replace("T", "-");

// ── remote identity, for URLs in the output ───────────────────────────────────
const remoteUrl = mustGit(["remote", "get-url", "origin"], repo, "reading origin");
const slugMatch = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/.exec(remoteUrl);
const repoSlug = slugMatch ? `${slugMatch[1]}/${slugMatch[2]}` : null;

// ── 1. a throwaway worktree at the CURRENT mainline ───────────────────────────
console.log(`lane-deliver — this machine is the ${lane.toUpperCase()} lane`);
const fetched = git(["fetch", "--quiet", "origin", MAINLINE]);
if (fetched.code !== 0) die(`cannot fetch origin/${MAINLINE}: ${fetched.err.trim()} — a delivery needs the remote`, 1);
const base = mustGit(["rev-parse", `origin/${MAINLINE}`], repo, "resolving mainline");
let wt = mkdtempSync(join(tmpdir(), "sg-lane-deliver-"));
// The worktree is removed on EVERY exit — a refusal (`die` → process.exit), a
// dry run, a crash — not only on the happy path. `finally` does not run past
// process.exit; an exit handler does, and spawnSync is synchronous inside it.
// Left-behind worktrees were the first defect this script shipped with.
function cleanup() {
  if (!wt) return;
  git(["worktree", "remove", "--force", wt], repo);
  rmSync(wt, { recursive: true, force: true });
  git(["worktree", "prune"], repo);
  wt = null;
}
process.on("exit", cleanup);
mustGit(["worktree", "add", "--quiet", "--detach", wt, base], repo, "creating the worktree");
console.log(`  worktree    ${wt} @ ${base.slice(0, 7)} (origin/${MAINLINE})`);

let pushedRef = null;
let pushedSha = null;
{
  // ── 2. the operations, written INTO the worktree by the caller's own CLI ────
  // SIGNALGRID_LANE_REPO points lane-message.mjs at the worktree, so the file
  // lands where the commit is built and the caller's checkout stays untouched.
  const summary = [];
  const env = { ...process.env, SIGNALGRID_LANE_REPO: wt, SIGNALGRID_LANE: lane };
  let touchesHeartbeat = false;
  for (const o of ops) {
    if (o.op === "send") {
      const r = run("node", [join(repo, "scripts/lane-message.mjs"), "send", o.subject, o.body], { cwd: wt, env });
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
    }
  }

  // ── 3. gate INSIDE the worktree, with mainline's own copies of the gates ────
  const gates = [["scripts/check-lane-messages.mjs", "lane messages"]];
  if (touchesHeartbeat) gates.push(["scripts/check-scheduled-routines.mjs", "scheduled routines"]);
  for (const [script, label] of gates) {
    if (!existsSync(join(wt, script))) continue; // an older mainline without the gate has nothing to fail
    const r = run("node", [script], { cwd: wt, env });
    if (r.code !== 0) die(`the ${label} gate refused this delivery:\n${r.out}${r.err}`, 1);
    console.log(`  gate        ${label}: passed`);
  }

  // ── 4. the commit ───────────────────────────────────────────────────────────
  mustGit(["add", "--", ...MAIL_DIRS.filter((d) => existsSync(join(wt, d)))], wt, "staging");
  // The surface-review coverage page counts files per surface, and a NEW message
  // file changes artifacts/lane-messages' count — so a delivery that adds one
  // stales docs/agent/SURFACE_REVIEW_COVERAGE.md and the coverage gate fails the
  // mail PR (#445 did exactly that). Regenerate it here, AFTER the mail is staged
  // (the derivation reads the tracked set), with mainline's own generator, and let
  // that one file ride along. A generator that refuses (a ledger the gate rejects)
  // refuses the delivery: mail must never ship a page the gate will not accept.
  const stagedMail = mustGit(["diff", "--cached", "--name-only"], wt, "listing the stage").split("\n").filter(Boolean);
  const allowed = [...MAIL_DIRS];
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
    `Delivered by scripts/lane-deliver.mjs from a worktree at origin/${MAINLINE} ${base.slice(0, 7)}.`,
    ...staged.map((f) => `  ${f}`),
  ];
  if (flags.trailers.length > 0) bodyLines.push("", ...flags.trailers);
  mustGit(["commit", "--quiet", "-m", title, "-m", bodyLines.join("\n")], wt, "committing");
  const sha = mustGit(["rev-parse", "HEAD"], wt, "reading the commit");
  console.log(`  commit      ${sha.slice(0, 7)} — ${title}`);
  for (const f of staged) console.log(`              ${f}`);

  if (flags.dryRun) {
    console.log("  dry-run     pushed nothing; the worktree is removed and the commit discarded.");
    process.exit(0);
  }

  // ── 5. the push: direct on the Mac, a mail branch on the cloud ──────────────
  const direct = lane === "mac" && !flags.viaPr;
  const mailBranch = `lane/${lane}-mail-${stamp}`;
  const target = direct ? MAINLINE : mailBranch;
  const delays = [0, 2000, 4000, 8000, 16000];
  let pushed = null;
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt] > 0) {
      console.log(`  push        retrying in ${delays[attempt] / 1000}s`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delays[attempt]);
    }
    const r = git(["push", "origin", `HEAD:refs/heads/${target}`], wt);
    if (r.code === 0) { pushed = r; break; }
    const text = `${r.err}${r.out}`;
    if (/non-fast-forward|fetch first|rejected/.test(text) && direct) {
      // Mainline moved between the fetch and the push. The commit is rebuilt on
      // the new tip rather than force-pushed over somebody else's delivery.
      console.log("  push        mainline moved; rebasing the delivery onto the new tip");
      const f = git(["fetch", "--quiet", "origin", MAINLINE], wt);
      const rb = f.code === 0 ? git(["rebase", "--quiet", `origin/${MAINLINE}`], wt) : f;
      if (rb.code !== 0) die(`could not rebase onto the moved mainline:\n${rb.err}${rb.out}`, 1);
      continue;
    }
    if (/denied|protected|GH006|policy|rule/i.test(text)) {
      die(`the push to ${target} was REFUSED by the remote's rules — no other ref was tried:\n${text.trim()}\n(the cloud lane must deliver via a lane/cloud-mail-* branch: rerun with --via-pr)`, 1);
    }
    console.log(`  push        attempt ${attempt + 1} failed: ${text.trim().split("\n").pop()}`);
  }
  if (!pushed) die(`push to ${target} failed after ${delays.length} attempts`, 1);
  pushedRef = target;
  pushedSha = mustGit(["rev-parse", "HEAD"], wt, "reading the pushed commit");

  // ── 6. confirm on the remote — local-only is not delivered ──────────────────
  const remoteSha = mustGit(["ls-remote", "origin", `refs/heads/${target}`], wt, "confirming").split(/\s+/)[0] ?? "";
  if (remoteSha !== pushedSha) die(`origin/${target} is ${remoteSha.slice(0, 7)}, not the pushed ${pushedSha.slice(0, 7)} — NOT delivered`, 1);
  console.log(`  delivered   origin/${target} @ ${pushedSha.slice(0, 7)} (confirmed with git ls-remote)`);

  if (!direct) {
    const compare = repoSlug ? `https://github.com/${repoSlug}/compare/${MAINLINE}...${encodeURIComponent(target)}?expand=1` : `(compare ${MAINLINE}...${target})`;
    console.log(`  next        open the PR for ${target} → ${MAINLINE} and enable auto-merge:`);
    console.log(`              ${compare}`);
    const gh = run("gh", ["--version"]);
    if (gh.code === 0 && repoSlug) {
      const pr = run("gh", ["pr", "create", "--repo", repoSlug, "--base", MAINLINE, "--head", target, "--title", title, "--body", bodyLines.join("\n")], { cwd: wt });
      if (pr.code === 0) {
        console.log(`  pr          ${pr.out.trim().split("\n").pop()}`);
        const am = run("gh", ["pr", "merge", "--repo", repoSlug, "--auto", "--merge", target], { cwd: wt });
        console.log(am.code === 0 ? "  auto-merge  enabled" : `  auto-merge  not enabled (${(am.err || am.out).trim().split("\n").pop()}) — merge it when the gating check is green`);
      } else {
        console.log(`  pr          gh could not open it (${(pr.err || pr.out).trim().split("\n").pop()}) — use the compare link`);
      }
    }
  } else {
    const me = git(["branch", "--show-current"], repo).out.trim();
    if (me === MAINLINE) console.log(`  note        your checkout of ${MAINLINE} is now behind origin by this commit — git pull --ff-only`);
  }

  // ── 7. wake the other lane: a comment on the standing mailbox PR ────────────
  if (!flags.noWake) {
    const mailboxPath = join(repo, MAILBOX_FILE);
    const mailbox = existsSync(mailboxPath) ? JSON.parse(readFileSync(mailboxPath, "utf8")) : null;
    const prNumber = mailbox && Number.isInteger(mailbox.pr) && mailbox.pr > 0 ? mailbox.pr : null;
    const url = prNumber && repoSlug ? `https://github.com/${repoSlug}/pull/${prNumber}` : null;
    if (!url) {
      console.log(`  wake        no mailbox PR declared in ${MAILBOX_FILE} — the other lane learns of this on its next fetch`);
    } else {
      const line = `${lane} lane delivered: ${summary.join(", ")} — origin/${target} @ ${pushedSha.slice(0, 7)}`;
      const gh = run("gh", ["--version"]);
      const posted = gh.code === 0 ? run("gh", ["pr", "comment", String(prNumber), "--repo", repoSlug, "--body", line]) : null;
      if (posted && posted.code === 0) console.log(`  wake        commented on the mailbox PR #${prNumber} — the other lane wakes on it`);
      else console.log(`  wake        ${gh.code === 0 ? "gh could not comment" : "no gh on PATH"}; to wake the other lane NOW, comment on ${url}\n              (otherwise it sees this on its next hourly cycle)`);
    }
  }
}

cleanup();
if (pushedRef) console.log(`lane-deliver: done — ${pushedRef} @ ${pushedSha.slice(0, 7)}`);
