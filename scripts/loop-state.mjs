// The loop check — does reality match what LOOP.md says?
//
//   pnpm run loop:state
//
// WHY THIS EXISTS
// ---------------
// Work on this project happens in at least three places: chat (strategy and
// doctrine), Claude Code (patches and gates), and a browser (the public Review
// Hub). Nothing watches the seams between them.
//
// On 2026-08-27 that cost a week: Phase 0 was applied and verified green
// locally, pushed — and never arrived on the Review Hub. The public README kept
// showing the exact phrase Phase 0 existed to retire, and nobody noticed,
// because every individual tool reported success.
//
// This script is the thing that notices. It reads the world, not the notes, and
// reports where they disagree. It is deliberately read-only: it changes nothing,
// so it is safe to run half-awake on a Sunday.

import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HUB = "https://github.com/DanFashauer/SignalGrid-Review-Hub.git";

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", B = "\x1b[1m", D = "\x1b[2m", X = "\x1b[0m";
const rows = [];
// `gated` is whether a `fail` in this row moves the EXIT CODE. Every seam row
// is gated. The discovery rows are reported — as a warning, never red/fatal
// since DR-033 (past Customer Discovery: discovery is an input, not the gate) —
// but do not set the exit code, because the Stop hook (.claude/hooks/verify-done.sh)
// runs this script as its gate and a hook that blocks every session over a number
// no session can change teaches bypass. Until 2026-09-05 the script exited 0
// on EVERY outcome, so the hook's gate arm could never fire at all.
const add = (state, what, detail, gated = true) => rows.push({ state, what, detail, gated });

const gitIn = (cwd) => (...a) => {
  try {
    return execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
const git = gitIn(repo);
// Untrimmed output (a diff's trailing newline is part of the patch) and a stdin feed.
const gitRaw = (cwd, args) => {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }); } catch { return ""; }
};
const gitFeed = (cwd, args, input, env) => {
  try { return execFileSync("git", args, { cwd, encoding: "utf8", input, env, stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim(); } catch { return ""; }
};
const MAINLINE = "origin/SignalGrid_Alpha";
// Bounded walk of mainline history for the landed checks: an unbounded walk is a check
// nobody waits for, and a check nobody waits for gets switched off. Exhausting the bound
// without a match returns FALSE — reported, never cleared.
const MAX_HISTORY = 400;

if (process.argv.includes("--self-test")) process.exit(selfTest());

console.log(`\n${B}Loop check${X} ${D}— reality, not notes${X}\n`);

// ── 1. Does local work exist that the Review Hub has never seen? ────────────
// This is the check that would have caught the lost week.
const localBranches = git("branch", "--format=%(refname:short)").split("\n").filter(Boolean);
let hubBranches = [];
const hubSha = new Map();
let hubListed = false;
try {
  const heads = execFileSync("git", ["ls-remote", "--heads", HUB], { encoding: "utf8", timeout: 60000 })
    .split("\n").filter(Boolean).map((l) => l.split(/\s+/)).filter((p) => p[1] && p[1].startsWith("refs/heads/"));
  for (const [sha, ref] of heads) hubSha.set(ref.slice("refs/heads/".length), sha);
  hubBranches = [...hubSha.keys()];
  hubListed = true;
} catch {
  // FAIL, not warn. An unreachable Hub means the unpushed-work check below did
  // not run, and "the check that would have caught the lost week did not run"
  // is a failing state, not a shrug. The old `warn` plus the `if
  // (hubBranches.length)` guard turned an empty ls-remote into a clean report —
  // an empty collection concluding no objection, exactly when the network was
  // the unverifiable input.
  add("fail", "Review Hub reachable", "could not list the Hub's branches — the unpushed-work check did NOT run; unknown is not clean");
}

// ...and the half of that fix which did NOT land. The comment above says the `if
// (hubBranches.length)` guard "turned an empty ls-remote into a clean report", and
// the guard was still here: a command that SUCCEEDS and returns nothing throws no
// exception, so `hubBranches` was empty, no fail row was added, and the unpushed-work
// check plus the origin check were both skipped in silence. That is the same empty
// collection concluding no objection, one layer down — and it is the realistic
// failure (an HTTP proxy answering 200 with an empty body, a misspelled remote that
// resolves, a repo genuinely carrying no heads), not the clean throw.
//
// Success and emptiness are now different answers. A Hub that lists ZERO branches is
// a broken read, never a clean one.
if (hubListed && hubBranches.length === 0) {
  add(
    "fail",
    "Review Hub branch list",
    "git ls-remote --heads succeeded but returned ZERO branches — the unpushed-work check did NOT run. " +
      "An empty answer is not a clean answer.",
  );
}

/**
 * Every branch checked out in an agent's isolated worktree, derived from
 * `git worktree list` rather than from the branch's NAME.
 *
 * WHY THE NAME WAS THE WRONG KEY. The rule below used to be
 * `b.startsWith("worktree-agent-")`, which catches only the branches the Agent
 * tool names itself. It missed two shapes that occur constantly:
 *
 *   - a sub-agent that creates its OWN branch inside its worktree, because the
 *     branch it was told to use is already checked out elsewhere (`wt-...`);
 *   - a deliberate ATTACK reproduction (`attack-b1`), built to prove a gate
 *     wrongly approves a weakening — on 2026-09-14 one such branch carried a
 *     neutered prototype-depth bound.
 *
 * Both failed this seam on every session, and neither could be cleared: the
 * message offers "push, or confirm the remote", and pushing is WRONG for both —
 * it puts scratch names on the shared remote for the Mac lane to prune, and in
 * the attack case it publishes a disabled safety guard indistinguishable at a
 * glance from real work. The only other move is deleting a branch out from under
 * a running agent. A seam whose every remedy is wrong is one a session learns to
 * narrate past, which is how a real unpushed branch would eventually slip by.
 *
 * So membership is derived from WHERE a branch lives. An agent can rename its
 * branch; it cannot escape its worktree.
 */
/**
 * Has this branch's content already landed on mainline?
 *
 * TRUE only when every file the branch changes relative to its merge base is
 * byte-identical to mainline's copy. That is what survives a SQUASH merge, which
 * rewrites the commit and defeats `merge-base --is-ancestor`.
 *
 * Fail-closed in every direction: an unreadable diff, a file mainline does not have, a
 * file whose bytes differ, or any git error returns false and the branch stays reported
 * as unpushed. The only way to pass is for mainline to already carry every byte the
 * branch would add — which is precisely what "already on the Review Hub" means.
 */
function hasLandedByContent(branch, mainline = MAINLINE, cwd = repo) {
  const git = gitIn(cwd);
  const names = git("diff", "--name-only", `${mainline}...${branch}`);
  if (!names) return false;
  const files = names.split("\n").map((f) => f.trim()).filter(Boolean);
  // A branch that touches nothing is not evidence of landing — it is an unreadable
  // diff, or a branch identical to its base. Say nothing rather than clear it.
  if (files.length === 0) return false;
  for (const file of files) {
    const mine = git("show", `${branch}:${file}`);
    const theirs = git("show", `${mainline}:${file}`);
    if (mine === null || theirs === null || mine === undefined || theirs === undefined) return false;
    if (mine !== theirs && !fileEverMatchedMainline(branch, file, mainline, cwd)) return false;
  }
  return true;
}

// THE MOVED-ON HOLE, and it is the FOURTH of this exact shape in this one check.
// The comparison above asks whether the branch's copy of a file matches mainline's
// copy RIGHT NOW. So a branch that landed cleanly and was then overtaken — mainline
// changed the same file again afterwards — stops matching and reverts to being
// reported as unpushed work. Its work is on mainline; mainline has simply moved past
// it.
//
// That is the common case, not an edge one: a squash-merged branch touching a shared
// file (a registry, a figure, a generated page) is overtaken by the very next merge
// that touches it. Measured 2026-09-17: SEVEN branches, every one of them a MERGED
// pull request (#787, #790, #791, #741, #803), all reported as local work the Review
// Hub had never seen. And the remedies the message offers are wrong for the fourth
// time — pushing re-creates a dead branch, deleting is refused by this repo's own
// dangerous-command hook.
//
// So the question becomes "was this content EVER on mainline", not "is it there
// this instant". A blob that appeared in mainline's history for that path is content
// that landed, whatever happened to the file since.
//
// Fail-closed, like its three siblings. Bounded to the most recent MAX_HISTORY
// commits touching the path: an unbounded walk on a long history is a check nobody
// waits for, and a check nobody waits for gets switched off. Exhausting the bound
// without a match returns FALSE — reported, never cleared — so the failure mode of
// looking too little is a branch that stays named, never one that vanishes quietly.
function fileEverMatchedMainline(branch, file, mainline = MAINLINE, cwd = repo) {
  const git = gitIn(cwd);
  const mine = git("rev-parse", `${branch}:${file}`);
  if (!mine) return false;
  const hist = git("log", `--max-count=${MAX_HISTORY}`, "--format=%H", mainline, "--", file);
  if (!hist) return false;
  for (const commit of hist.split("\n").map((c) => c.trim()).filter(Boolean)) {
    if (git("rev-parse", `${commit}:${file}`) === mine) return true;
  }
  return false;
}

// THE SQUASH-OF-A-MERGE-TREE HOLE (2026-09-20), the fifth shape in this one check. The
// byte check above needs every changed file to match SOME mainline blob. A squash merge
// lands the pull request's MERGE tree, not the branch tip's tree, so a shared file that
// mainline also moved between the branch's base and the squash (docs/BUILD_BACKLOG.md, on
// both #860 and #900) lands as a three-way merge result that never equals the branch's
// blob — and the branch is reported as unpushed on every turn, forever. Measured: one file
// per branch, history depth 111, every other file matching.
//
// So the second question is about HUNKS, not blobs: does the branch's whole diff against
// its merge-base carry the same patch-id as some single-parent commit's own diff on
// mainline? A squash of a clean merge carries exactly the branch's hunks whatever mainline
// did elsewhere in the same file. Two rules keep it honest, both learned on PR #911:
//   · `--verbatim`, never `--stable`: --stable strips whitespace, so two different
//     whitespace-only edits collide and a never-landed tip would read LANDED;
//   · a patch-id match is a CANDIDATE, not a verdict: the branch's hunks re-applied to the
//     squash's parent must reproduce the squash's tree exactly, or the branch stays reported.
// Bound to the CURRENT tip by construction — a branch extended after its merge has a
// different whole-diff patch-id. Purely local: no network, no GitHub call from a hook
// (AGENTS.md: no live API calls); confirming a landing against GitHub by hand is an
// operator step outside this path. Fail-closed like its siblings: no diff, no merge-base,
// no history, a git error, a matched id that does not re-apply — all FALSE, all reported.
function landedByPatchId(branch, mainline = MAINLINE, cwd = repo) {
  const git = gitIn(cwd);
  const base = git("merge-base", mainline, branch);
  const tip = git("rev-parse", "--verify", `${branch}^{commit}`);
  if (!base || !tip || base === tip) return false;
  const patch = gitRaw(cwd, ["diff", base, tip]);
  if (!patch) return false;
  const want = patchIdOf(cwd, patch);
  if (!want) return false;
  const hist = git("log", `--max-count=${MAX_HISTORY}`, "--format=%H %P", mainline);
  if (!hist) return false;
  for (const line of hist.split("\n")) {
    const [commit, ...parents] = line.trim().split(" ");
    if (!commit || parents.length !== 1) continue; // a squash has exactly one parent
    const own = gitRaw(cwd, ["diff", parents[0], commit]);
    if (!own || patchIdOf(cwd, own) !== want) continue;
    return reappliesExactly(cwd, parents[0], patch, commit);
  }
  return false;
}
function patchIdOf(cwd, patch) {
  const out = gitFeed(cwd, ["patch-id", "--verbatim"], patch);
  return out ? out.split(" ")[0] : "";
}
// The exact follow-up: read the squash's parent tree into a throwaway index, apply the
// branch's patch to that index, and compare the written tree with the squash's own tree.
function reappliesExactly(cwd, parent, patch, commit) {
  const idx = join(tmpdir(), `loop-state-idx-${process.pid}-${Date.now()}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    if (gitFeed(cwd, ["read-tree", parent], "", env) === "" && !existsSync(idx)) return false;
    const applied = execFileSync("git", ["apply", "--cached", "-"], { cwd, env, input: patch, stdio: ["pipe", "ignore", "ignore"] });
    void applied;
    const tree = gitFeed(cwd, ["write-tree"], "", env);
    const want = gitIn(cwd)("rev-parse", `${commit}^{tree}`);
    return Boolean(tree) && tree === want;
  } catch {
    return false;
  } finally {
    try { unlinkSync(idx); } catch { /* never existed */ }
  }
}

// THE SAME-NAME HOLE (2026-09-20), the sixth. `noRemote` below drops any branch whose NAME
// exists on the Hub before the seam looks at it, and the "carrying commits" warning covers
// only agent-worktree branches with no Hub name — so a local tip one commit AHEAD of its
// same-named remote was named by nothing. Measured on the branch that carried this very
// finding (claude/landing-record-2026-09-20 at d29bf79f, one ahead of origin). The Hub's
// tip sha comes from the same ls-remote; when that object is not in the local store the
// answer is UNKNOWN and is reported as such, never counted clean and never counted as work.
function aheadOfHub(branch, hubSha, cwd = repo) {
  const git = gitIn(cwd);
  if (!hubSha) return { state: "unknown" };
  if (git("cat-file", "-t", hubSha) !== "commit") return { state: "unknown" };
  const n = git("rev-list", "--count", `${hubSha}..${branch}`);
  if (n === "") return { state: "unknown" };
  return { state: Number(n) > 0 ? "ahead" : "same", ahead: Number(n) };
}

// THE ALIAS HOLE, and it is the third of exactly this shape. Membership was derived
// from the branch NAME appearing on the hub, so a local branch pointing at a commit
// that IS on the hub under a DIFFERENT name read as unpushed work. Subagents doing
// merge-conflict triage produce precisely that: `pr782` checked out from
// `origin/claude/build-itsm-dispatch-seam` is the same commit wearing a local name.
// Measured 2026-09-17: EIGHT branches failed this seam at once while every one of
// their commits sat on origin. And both remedies the message offers were wrong again —
// pushing would litter the shared remote with duplicate names for branches already on
// it, and deletion is refused by this repo's own dangerous-command hook.
//
// The tip being contained in ANY remote ref IS "confirm the remote", which is the
// message's own second option. Fail-closed like its two siblings: a git error, an
// unreadable ref or an empty answer leaves the branch REPORTED, never cleared. This
// cannot clear real local work — a branch carrying a commit no remote has is contained
// in no remote ref, and no amount of renaming changes that.
function isOnHubBySha(branch) {
  const sha = git("rev-parse", "--verify", `${branch}^{commit}`);
  if (!sha) return false;
  const containing = git("branch", "-r", "--contains", sha);
  if (!containing) return false;
  return containing.split("\n").map((l) => l.trim()).filter(Boolean).length > 0;
}

function branchesInAgentWorktrees() {
  const out = git("worktree", "list", "--porcelain");
  if (!out) return [];
  const found = new Set();
  const agentPaths = [];
  let path = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
      // The Agent tool's isolated checkouts live under `.claude/worktrees/`.
      if (path.includes("/.claude/worktrees/")) agentPaths.push(path);
    } else if (line.startsWith("branch refs/heads/") && path.includes("/.claude/worktrees/")) {
      found.add(line.slice("branch refs/heads/".length));
    }
  }

  // The checked-out branch is only the one an agent is on RIGHT NOW. An agent that
  // builds several branches — three successive attack reproductions, say — leaves
  // the others behind as refs, and those escaped a location-only rule and failed
  // the seam anyway. Git keeps a PER-WORKTREE HEAD reflog, so every branch a given
  // worktree ever checked out is recoverable from it. That is the full set an agent
  // created, not just its current one.
  for (const p of agentPaths) {
    const log = git("-C", p, "reflog", "show", "--format=%gs", "HEAD");
    if (!log) continue;
    for (const line of log.split("\n")) {
      const m = /^checkout: moving from (\S+) to (\S+)$/.exec(line.trim());
      if (m) { found.add(m[1]); found.add(m[2]); }
    }
  }
  return [...found];
}

if (hubBranches.length) {
  // Ephemeral by NAME (the Agent tool's own) or by LOCATION (anything checked out
  // in an agent worktree). Named in the output either way: the exclusion is
  // visible, never silent.
  const inWorktrees = branchesInAgentWorktrees();
  const ephemeral = localBranches.filter(
    (b) => b.startsWith("worktree-agent-") || inWorktrees.includes(b),
  );
  const noRemote = localBranches.filter((b) => !hubBranches.includes(b) && b !== "HEAD" && !ephemeral.includes(b));
  // THE SQUASH-MERGE HOLE, and it is the same shape as the one above. A branch merged
  // with squash has no remote afterwards (GitHub deletes it) and is NOT an ancestor of
  // mainline, because the squash makes a new commit. So this seam reported "local work
  // not on the Review Hub" about content sitting in mainline — and both remedies it
  // offers are wrong again: pushing recreates a dead branch on the shared remote after
  // every single merge, and deletion is refused twice over, once by this repo's own
  // dangerous-command hook (which denies the force form) and once by git itself (the
  // safe form declines a branch that is not an ancestor, which a squash guarantees).
  // Measured on 2026-09-14: three merges, three false failures, each cleared only by
  // re-pushing the corpse.
  //
  // So membership is derived from CONTENT here too, not from reachability. Fail-closed
  // by construction: one differing file, one file mainline lacks, an unreadable diff or
  // any git error and the branch is still reported unpushed. Real work is a difference,
  // and a difference can never pass this.
  // Three independent ways a branch is already safe, each REPORTED by name so the
  // exclusion is visible rather than silent: its commit is on the hub under another
  // name, or its content is in mainline (squash), or neither — and then it is work.
  const onHub = noRemote.filter((b) => isOnHubBySha(b));
  const offHub = noRemote.filter((b) => !onHub.includes(b));
  const landedByBytes = offHub.filter((b) => hasLandedByContent(b));
  const landedByHunks = offHub.filter((b) => !landedByBytes.includes(b) && landedByPatchId(b));
  const landed = [...landedByBytes, ...landedByHunks];
  const unpushed = offHub.filter((b) => !landed.includes(b));
  const ephemeralNote = ephemeral.length ? ` (${ephemeral.length} ephemeral agent-worktree branch(es) not counted)` : "";
  const onHubNote = onHub.length ? ` (${onHub.length} on the hub under another name: ${onHub.join(", ")})` : "";
  const landedNote =
    (landedByBytes.length ? ` (${landedByBytes.length} squash-landed, every file byte-identical to a mainline blob: ${landedByBytes.join(", ")})` : "") +
    (landedByHunks.length ? ` (${landedByHunks.length} squash-landed, exact hunks found in a mainline squash: ${landedByHunks.join(", ")})` : "");
  if (unpushed.length) {
    add("fail", "Local work not on the Review Hub", `${unpushed.join(", ")} — push, or confirm the remote${ephemeralNote}${onHubNote}${landedNote}`);
  } else {
    add("ok", "Local branches all present on the Review Hub", `${localBranches.length - ephemeral.length} branch(es)${ephemeralNote}${onHubNote}${landedNote}`);
  }

  // REPORTED, never fatal — the lane-message rule, for the same reason. The work
  // is not lost (the worktree belongs to a live agent, and anything real is pushed
  // A branch whose NAME is on the Hub is not thereby ON the Hub: the local tip may be ahead.
  const sameNamed = localBranches.filter((b) => hubBranches.includes(b) && b !== "HEAD" && !ephemeral.includes(b));
  const aheadRows = [], unknownRows = [];
  for (const b of sameNamed) {
    const r = aheadOfHub(b, hubSha.get(b));
    if (r.state === "ahead") aheadRows.push(`${b} (+${r.ahead})`);
    else if (r.state === "unknown") unknownRows.push(b);
  }
  if (aheadRows.length) {
    add("fail", "Local tip ahead of its same-named Hub branch", `${aheadRows.join(", ")} — push, or confirm the remote; a name on the Hub is not the tip on the Hub`);
  } else {
    add("ok", "Same-named branches at or behind their Hub tip", `${sameNamed.length - unknownRows.length} branch(es) compared by sha`);
  }
  if (unknownRows.length) {
    add("warn", "Same-named branches whose Hub tip is not fetched locally", `${unknownRows.join(", ")} — cannot tell ahead from behind; reported, not counted clean`, false);
  }
  // from it), but an agent branch carrying commits beyond mainline is still worth
  // a session's eyes, so it is named rather than swallowed by the exclusion above.
  const carrying = ephemeral
    .filter((b) => !hubBranches.includes(b))
    // Commits reachable from the branch and from NO origin ref at all — a truer
    // reading of "carrying work the remote does not have" than a diff against one
    // named branch, which would miscount a branch cut from a different base.
    .map((b) => ({ b, ahead: git("rev-list", "--count", b, "--not", "--remotes=origin") }))
    .filter((x) => x.ahead && x.ahead !== "0");
  if (carrying.length) {
    add(
      "warn",
      "Agent-worktree branches carrying commits",
      `${carrying.map((x) => `${x.b} (+${x.ahead})`).join(", ")} — reported, never fatal: they belong to a live agent's ` +
        `isolated checkout and are not the session's to push or delete. An attack reproduction MUST NOT be pushed.`,
      false,
    );
  }
}

// OUTSIDE the branch-list block, deliberately. This is a purely LOCAL check — it
// reads `git remote get-url` — and it sat inside `if (hubBranches.length)`, so the
// one condition under which a push is most likely to have gone to the wrong repo
// (the Hub listing nothing) was the condition under which nobody asked which repo
// origin points at. A push can "succeed" into the wrong repository.
{
  const origin = git("remote", "get-url", "origin");
  const pointsAtHub = /DanFashauer\/SignalGrid-Review-Hub/i.test(origin);
  add(pointsAtHub ? "ok" : "fail", "origin points at the Review Hub", origin || "(no origin)");
}

// ── 2. Uncommitted work — the other way things get lost ─────────────────────
const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
add(dirty.length ? "warn" : "ok", "Working tree", dirty.length ? `${dirty.length} uncommitted file(s)` : "clean");

// ── 3. Is the doctrine actually live where people can see it? ───────────────
const readme = existsSync(resolve(repo, "README.md")) ? readFileSync(resolve(repo, "README.md"), "utf8") : "";
const retired = /Shared-Device Trust Gateway|trust fabric/i.test(readme.split("\n").slice(0, 40).join("\n"));
add(retired ? "fail" : "ok", "Public README uses current framing",
  retired ? "still opens with retired wording — Phase 0 has not landed here" : "no retired framing in the opening");
add(existsSync(resolve(repo, "docs/PURPOSE.md")) ? "ok" : "fail", "docs/PURPOSE.md present",
  existsSync(resolve(repo, "docs/PURPOSE.md")) ? "canonical doctrine on this branch" : "missing — apply Phase 0A");

// ── 4. THE NUMBER THAT MATTERS ──────────────────────────────────────────────
// Everything above is hygiene. This is the experiment.
const logPath = resolve(repo, "docs/agent/DISCOVERY_LOG.md");
if (existsSync(logPath)) {
  const log = readFileSync(logPath, "utf8");
  const m = log.match(/Conversations logged:\s*(\d+)\s*of\s*(\d+)/i);
  const c = log.match(/Commitments:\s*(\d+)/i);
  const logged = m ? Number(m[1]) : 0;
  const target = m ? Number(m[2]) : 15;
  const commits = c ? Number(c[1]) : 0;
  const startMatch = log.match(/Experiment started:\s*(\d{4}-\d{2}-\d{2})/);
  let daysMsg = "";
  if (startMatch) {
    const startMs = Date.parse(startMatch[1]);
    if (Number.isFinite(startMs)) {
      const days = Math.floor((Date.now() - startMs) / 86400000);
      daysMsg = ` · day ${days}`;
      if (days >= 7 && logged === 0) {
        add("warn", "Discovery", `day ${days}, still 0 conversations logged — an input now, not the gate (DR-033, past Customer Discovery).`, false);
      }
    } else {
      // Fail closed: an unparseable start date must surface, never silently skip
      // the discovery alarm (NaN >= 7 is false).
      add("fail", "Discovery start date", `unparseable "Experiment started" date in docs/agent/DISCOVERY_LOG.md`);
    }
  } else {
    // The line being ABSENT was the one shape with no row at all. An unparseable
    // date failed; a MISSING date produced silence — no day count, and the
    // "N days and 0 conversations" alarm structurally unable to fire, because the
    // alarm lives inside this `if`. That is the loudest row in the script switched
    // off by deleting one line of markdown, with nothing anywhere saying so. GATED,
    // like its unparseable sibling: the missing input is a repository defect a
    // session can fix, not a number a session cannot change.
    add(
      "fail",
      "Discovery start date",
      'no "Experiment started: YYYY-MM-DD" line in docs/agent/DISCOVERY_LOG.md — the days-since alarm CANNOT fire without it',
    );
  }
  add(logged >= target ? "ok" : "warn", "Discovery",
    `${logged}/${target} conversations · ${commits} commitment(s)${daysMsg} — input, not the gate (DR-033)`, false);
} else {
  add("warn", "Discovery log", "docs/agent/DISCOVERY_LOG.md not in the repo yet");
}

// ── 5. READINESS — the number that gates outreach (DR-036), derived, never typed ────────
// Three dimensions, headline = the lowest; floor 80 / target 92–95 / goal 100. REPORTED,
// not a seam: a low number closes outreach, it does not block a session from ending.
{
  const r = spawnSync(process.execPath, [resolve(repo, "scripts/check-readiness-figure.mjs"), "--json"], { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) {
    add("fail", "Readiness figure", "derivation BROKEN — run node scripts/check-readiness-figure.mjs", false);
  } else {
    const j = JSON.parse(r.stdout.trim().split("\n").pop());
    add(j.headline >= j.floor ? "ok" : "warn", "Readiness (gates outreach)",
      `${j.headline}% = lowest of runbook ${j.a}% · launch-evidence ${j.b}% · end-to-end ${j.c}% — floor ${j.floor}, target ${j.target[0]}–${j.target[1]} (DR-036)`, false);
  }
}

// ── 4b. How much of the repo has actually been READ? ────────────────────────
// Whole-repo validation is not whole-repo reading. Derived live from the tree by
// the gate itself rather than restated here, so this row cannot fossilise.
// REPORTED, never a failure — an unread surface is a place to spend an hour, not
// a broken seam, and the gate that owns the number is the one that fails.
try {
  const { deriveSurfaces, auditSurfaceCoverage, coverTracked, listTracked } = await import("./check-surface-review-coverage.mjs");
  const ledger = JSON.parse(readFileSync(resolve(repo, "docs/agent/SURFACE_REVIEW_COVERAGE.json"), "utf8"));
  const tracked = listTracked(repo);
  const surfaces = deriveSurfaces(repo, tracked);
  const a = auditSurfaceCoverage(surfaces, ledger, { cover: coverTracked(surfaces, tracked) });
  add("ok", "Review coverage", `${a.readCount} of ${a.total} surfaces read, ${a.partial.length} partial, ${a.notRead.length} not read`);
} catch (e) {
  // Fail LOUD rather than skip: a silently absent row would read as "nothing to
  // report", which is the one thing this number must never be able to say.
  add("warn", "Review coverage", `could not be derived — ${e.message}`);
}

// ── 5. Are the doctrine gates still holding? ────────────────────────────────
for (const [label, script] of [
  ["Decision vocabulary", "scripts/check-decision-vocabulary.mjs"],
  ["Product framing", "scripts/check-product-framing.mjs"],
]) {
  if (!existsSync(resolve(repo, script))) { add("warn", label, "gate not on this branch"); continue; }
  try {
    execFileSync("node", [script], { cwd: repo, stdio: "ignore" });
    add("ok", label, "green");
  } catch {
    add("fail", label, `run: node ${script}`);
  }
}

// ── report ──────────────────────────────────────────────────────────────────
const icon = { ok: `${G}✓${X}`, warn: `${Y}!${X}`, fail: `${R}✗${X}` };
for (const r of rows) console.log(`  ${icon[r.state]} ${r.what.padEnd(42)} ${D}${r.detail}${X}`);

const fails = rows.filter((r) => r.state === "fail");
const gatedFails = fails.filter((r) => r.gated);
console.log("");
if (fails.length) {
  console.log(`${R}${B}${fails.length} thing(s) need you.${X} Start at the top of that list.\n`);
} else {
  console.log(`${G}${B}Nothing is silently broken.${X}\n`);
}
console.log(`${D}This checks the seams between tools. It cannot tell you whether the work`);
console.log(`was worth doing — only that nothing fell through a crack.${X}`);
console.log(
  `${D}exit code: ${gatedFails.length ? 1 : 0} — ${gatedFails.length} failing seam(s) gate it; ` +
    `the discovery rows are reported here and do not.${X}\n`,
);
process.exitCode = gatedFails.length ? 1 : 0;


// ── Self-test: the landed and ahead checks can actually fail ────────────────
// Builds a throwaway repository under the system temp dir (never inside this checkout —
// an untracked file here flips provenance.workingTreeClean on every later sim result),
// with a bare "hub" remote, and proves each shape the seam must catch or clear.
function selfTest() {
  const root = mkdtempSync(join(tmpdir(), "loop-state-selftest-"));
  const work = join(root, "work"), hub = join(root, "hub.git");
  const g = gitIn(work);
  const sh = (...a) => execFileSync("git", a, { cwd: work, stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const put = (f, s) => writeFileSync(join(work, f), s);
  const checks = [];
  const check = (name, ok) => { checks.push([name, ok]); console.log(`  ${ok ? "ok  " : "FAIL"} — self-test: ${name}`); };
  try {
    execFileSync("git", ["init", "-q", "--bare", hub]);
    execFileSync("git", ["init", "-q", "-b", "main", work]);
    sh("remote", "add", "origin", hub);
    put("a.txt", "one\ntwo\nthree\n"); put("shared.md", "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "base");
    sh("push", "-q", "origin", "main");
    // feat: changes a.txt and appends to shared.md
    sh("checkout", "-q", "-b", "feat");
    put("a.txt", "one\nTWO\nthree\n"); put("shared.md", "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n- row 7 (feat)\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "feat");
    // mainline moves the SAME shared file elsewhere, then squash-merges feat
    sh("checkout", "-q", "main");
    put("shared.md", "- row 1\n- row 2 (main moved)\n- row 3\n- row 4\n- row 5\n- row 6\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "main moves shared");
    sh("merge", "-q", "--squash", "feat"); sh("commit", "-q", "-m", "squash feat");
    sh("push", "-q", "origin", "main");
    const M = "origin/main";
    // (a) the byte check cannot clear it (shared.md never byte-matches); the hunk check can
    check("byte check does NOT clear a squash whose shared file mainline also moved (the gap)", hasLandedByContent("feat", M, work) === false);
    check("exact-hunk check clears the same branch (a)", landedByPatchId("feat", M, work) === true);
    // (b) one more local commit after the merge → stays reported
    sh("checkout", "-q", "feat"); put("b.txt", "new\n"); sh("add", "-A"); sh("commit", "-q", "-m", "feat extended");
    check("the same branch with one more local commit stays reported (b)", landedByPatchId("feat", M, work) === false);
    // (c) whitespace-only twin of a landed change → stays reported
    sh("checkout", "-q", "-b", "feat-ws", "main~2");
    put("a.txt", "one\nTWO \nthree\n"); put("shared.md", "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n- row 7 (feat)\n");
    sh("add", "-A"); sh("commit", "-q", "-m", "feat but whitespace differs");
    check("a whitespace-only twin of a landed change stays reported (c)", landedByPatchId("feat-ws", M, work) === false);
    // (d) same-named remote, local tip one ahead → ahead=1; at the tip → same; unknown sha → unknown
    sh("checkout", "-q", "-b", "same", "main"); sh("push", "-q", "origin", "same");
    const hubTip = g("rev-parse", "origin/same");
    check("a same-named branch at its Hub tip reads same (d0)", aheadOfHub("same", hubTip, work).state === "same");
    put("c.txt", "ahead\n"); sh("add", "-A"); sh("commit", "-q", "-m", "ahead of hub");
    const r = aheadOfHub("same", hubTip, work);
    check("a same-named branch one commit ahead of its Hub tip is reported with the count (d)", r.state === "ahead" && r.ahead === 1);
    check("a Hub tip not in the local store reads unknown, never clean (d-unknown)", aheadOfHub("same", "0123456789abcdef0123456789abcdef01234567", work).state === "unknown");
    // fail-closed: a branch identical to mainline proves nothing
    check("a branch with no diff against mainline is not cleared", landedByPatchId("main", M, work) === false);
  } catch (e) {
    check(`self-test harness ran without throwing (${e && e.message ? e.message.split("\n")[0] : e})`, false);
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed ? `self-test FAILED (${checks.length - failed}/${checks.length})` : `self-test passed (${checks.length}/${checks.length})`);
  return failed ? 1 : 0;
}
