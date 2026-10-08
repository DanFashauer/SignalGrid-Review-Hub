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
import { dirname, resolve, isAbsolute } from "node:path";
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

// Every call through gitIn reads the REAL object graph: `--no-replace-objects` is prepended, so a
// refs/replace/* entry (`git replace --graft`) cannot rewrite the ancestry any of these answers
// rest on. Nothing in this file relies on a replace ref. It does NOT cover a legacy
// .git/info/grafts file, which git still honours with replace objects off; graftsFileIn below
// is the guard for that, and the same-name verdict calls it.
const gitIn = (cwd) => (...a) => {
  try {
    return execFileSync("git", ["--no-replace-objects", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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
const SCRATCH_FILE = "docs/agent/local-scratch-branches.json";
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
//
// The tip is refs/heads/<branch>, never the bare name: a tag called X outranks the branch X in a bare
// resolution (git's "ambiguous refname" warning goes to the stderr this file swallows), and `hubSha..X`
// then compares the TAG's commit, so a tag at the Hub's own sha read an ahead branch as "same".
// Replace objects are off (gitIn), and a present grafts file makes the count untrustworthy in the same
// way, so it reads UNKNOWN with the reason (graftsBlock) rather than a number a graft could have set.
function aheadOfHub(branch, hubSha, cwd = repo) {
  const git = gitIn(cwd);
  if (!hubSha) return { state: "unknown" };
  if (git("cat-file", "-t", hubSha) !== "commit") return { state: "unknown" };
  const reason = graftsBlock(cwd);
  if (reason) return { state: "unknown", reason };
  const n = git("rev-list", "--count", `${hubSha}..refs/heads/${branch}`);
  if (n === "") return { state: "unknown" };
  return { state: Number(n) > 0 ? "ahead" : "same", ahead: Number(n) };
}

// A legacy .git/info/grafts file rewrites parentage exactly as a refs/replace entry does, and
// `--no-replace-objects` (or GIT_NO_REPLACE_OBJECTS) does NOT switch it off; only GIT_GRAFT_FILE=/dev/null
// does. While one exists no ancestry answer from this checkout is trusted. Returns "" when there is none,
// else the reason, which names the file. git's own answer to "where would you look" is used (a linked
// worktree names the shared one), GIT_GRAFT_FILE is honoured the way git honours it, and when git cannot
// say the answer is still a reason, never "": unreadable tightens.
function graftsBlock(cwd = repo) {
  const p = process.env.GIT_GRAFT_FILE || gitIn(cwd)("rev-parse", "--git-path", "info/grafts");
  const tail = "ancestry cannot be trusted, confirmation disabled";
  if (!p) return `grafts path unreadable (git did not name info/grafts); ${tail}`;
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  return existsSync(abs) ? `graft file present: ${abs}; ${tail}` : "";
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
function isOnHubBySha(branch, cwd = repo) {
  const git = gitIn(cwd);
  const sha = git("rev-parse", "--verify", `refs/heads/${branch}^{commit}`); // never the bare name: a same-named tag would win
  if (!sha) return false;
  const containing = git("branch", "-r", "--contains", sha);
  if (!containing) return false;
  return containing.split("\n").map((l) => l.trim()).filter(Boolean).length > 0;
}

// THE SAME-NAME ALIAS HOLE (2026-10-08), the alias hole's twin on the other seam. The seam
// "Local tip ahead of its same-named Hub branch" counted `hubSha..branch` and nothing else, so
// it never asked the question the sibling seam above already answers: is this tip on the Hub
// under ANOTHER ref? Measured today: claude/signalgrid-launch-plan-emxm01 sits at 369913e57,
// an ancestor of origin/SignalGrid_Alpha (`git merge-base --is-ancestor` exits 0), while a stale
// same-named Hub branch from 2026-09-15 (5eb1ead40, a closed PR #531) has DIVERGED from it:
// `gh api repos/DanFashauer/SignalGrid-Review-Hub/compare/5eb1ead40...369913e57` reads
// ahead_by 2611, behind_by 35, merge base 9ee581eb (2026-09-15T00:19:37Z). The "+50" the seam
// printed is the shallow clone's depth (rev-list counts only back to the shallow boundary), not
// the divergence. The seam reported "+50" and BOTH remedies it offers were wrong: the push is a
// non-fast-forward (refused without force, and force is forbidden here) and "confirm the remote"
// was already true, just unread. A session cannot clear that, so it learns to narrate past it.
//
// The rule is the one stated above isOnHubBySha, with ONE difference that matters: that sibling
// reads the LOCAL refs/remotes snapshot, and a snapshot is not the Hub. A first version of this
// function trusted `git branch -r --contains` and an Opus refuter overturned it with four
// fixtures, each reading "confirmed" for a tip that is on the Hub nowhere: (F1) the Hub rewound
// the same-named branch while local origin/X still sat at the old tip; (F2) a tracking ref for a
// branch the Hub has since deleted (no fetch.prune); (F3) a second remote (fork/X); (F4) a
// hand-written refs/remotes/pr/999.
//
// So the confirmation is ANCHORED TO THE LS-REMOTE the seam already took: a ref counts only if it
// is origin/<name> for a name that is not this branch and not HEAD, AND its local sha EQUALS the
// Hub's current sha for <name> (hubShaMap). A stale origin/X (F1), a pruned-late origin/Z the Hub
// no longer lists (F2), any other remote (F3) and a hand-made ref outside origin or at a sha the
// Hub does not list for that name (F4) all fail that test.
//
// That test is necessary and NOT sufficient. It proves a local ref sits where the Hub's does; it
// does not prove the LOCAL graph answers "does that commit descend from my tip" the way the Hub's
// would, because three pieces of hand-made local state rewrite the graph or the name it is asked
// about. A second Opus refute (round 2) read each of them "confirmed" for work the Hub's object
// store does not hold:
//   G1  `git replace --graft <Hub sha of other> <T>` (refs/replace/*) gives origin/other, whose
//       local sha equals the Hub's, a parent of T, so --contains lists it;
//   G2  a legacy .git/info/grafts line does the same, and replace-objects-off does not disable it;
//   G3  a local TAG named like the branch shadows it: a bare `X^{commit}` resolves refs/tags/X, so
//       the verdict is computed on the tag's commit, not the branch's tip (real unpushed work on
//       refs/heads/X read confirmed, +1 instead of +2).
//
// What holds now: confirmation is anchored to the Hub's sha AND reads ancestry with replace objects
// off (gitIn prepends --no-replace-objects); a grafts file, which replace-objects-off does not
// cover, disables confirmation outright (graftsBlock), and the verdict then reads AHEAD with the
// count unreadable and the reason naming the file; and the branch tip is always
// refs/heads/<branch>, never the bare name (here, in aheadOfHub and in isOnHubBySha). What is still
// trusted: that an object in the local store is the object its sha says (content addressing), and
// that the Hub holds the whole history of a commit it lists. The seam REPORTS a confirmed branch by
// name so the exclusion is visible, never silent. Fail-closed exactly like the alias check: a git
// error, an unreadable ref, an empty answer, a missing map or a grafts file leaves the branch
// AHEAD; an unknown Hub sha stays UNKNOWN (containment is only asked of a branch already proven
// ahead, never used to clear an unreadable comparison); and a branch with a commit no Hub ref
// holds is contained in none, so renaming cannot clear real local work.
function hubNamesHoldingTip(branch, hubShaMap, cwd = repo) {
  if (!(hubShaMap instanceof Map)) return [];
  if (graftsBlock(cwd)) return []; // a grafts file can fake the very containment asked below
  const git = gitIn(cwd);
  const tip = git("rev-parse", "--verify", `refs/heads/${branch}^{commit}`); // the BRANCH, never a same-named tag
  if (!tip) return [];
  const rows = git("for-each-ref", "--contains", tip, "--format=%(refname:lstrip=3) %(objectname)", "refs/remotes/origin");
  if (!rows) return [];
  const names = [];
  for (const line of rows.split("\n")) {
    const i = line.lastIndexOf(" ");
    if (i < 1) continue;
    const name = line.slice(0, i), sha = line.slice(i + 1);
    if (name === branch || name === "HEAD") continue;
    if (sha && hubShaMap.get(name) === sha) names.push(name);
  }
  return names;
}
function sameNameVerdict(branch, hubSha, hubShaMap, cwd = repo) {
  const r = aheadOfHub(branch, hubSha, cwd);
  // A grafts file: aheadOfHub cannot read the count, and "same" or "confirmed" would both be answers a
  // graft could have set. It stays a gated AHEAD (count unreadable) naming the file, never the
  // non-gated "unknown" warning: planting a file must not turn a failing row into a quiet one.
  if (r.reason) return { state: "ahead", ahead: null, reason: r.reason };
  if (r.state !== "ahead") return r;
  return hubNamesHoldingTip(branch, hubShaMap, cwd).length > 0 ? { state: "confirmed", ahead: r.ahead } : r;
}

// The row the seam prints for the same-named comparison, pure so the self-test can call it: a
// confirmed branch is named in the detail (never swallowed), and the ok row's title says what it
// now covers. verdicts: [{ branch, state, ahead }] as sameNameVerdict returns, plus the name.
function sameNameRows(verdicts) {
  const ahead = verdicts.filter((v) => v.state === "ahead").map((v) => `${v.branch} (${Number.isFinite(v.ahead) ? `+${v.ahead}` : "count unreadable"})`);
  const why = [...new Set(verdicts.filter((v) => v.reason).map((v) => v.reason))].map((r) => ` (${r})`).join("");
  const confirmed = verdicts.filter((v) => v.state === "confirmed").map((v) => v.branch);
  const unknown = verdicts.filter((v) => v.state === "unknown").length;
  const note = confirmed.length
    ? ` (${confirmed.length} same-named branch(es) ahead of the Hub's same name but confirmed on the Hub under another branch: ${confirmed.join(", ")})`
    : "";
  if (ahead.length) {
    return { level: "fail", title: "Local tip ahead of its same-named Hub branch", detail: `${ahead.join(", ")} — push, or confirm the remote; a name on the Hub is not the tip on the Hub${note}${why}` };
  }
  return {
    level: "ok",
    title: "Same-named branches at or behind their Hub tip, or confirmed on the Hub under another branch",
    detail: `${verdicts.length - unknown} branch(es) compared by sha${note}`,
  };
}

// ── Declared scratch branches ───────────────────────────────────────────────

// Pure parse + validate. Every entry needs name/reason/origin/declaredAt/declaredBy; names are
// exact (no wildcard, regex or glob characters); declaredAt must parse. Anything else invalidates
// the WHOLE file — an invalid allowlist never widens.
function validateScratchDeclaration(text) {
  let arr;
  try { arr = JSON.parse(text); } catch (e) { return { ok: false, error: "not valid JSON" }; }
  if (!Array.isArray(arr)) return { ok: false, error: "top level is not an array" };
  const seen = new Set();
  for (const [i, e] of arr.entries()) {
    if (!e || typeof e !== "object") return { ok: false, error: `entry ${i} is not an object` };
    for (const k of ["name", "reason", "origin", "declaredAt", "declaredBy", "tip"]) {
      if (typeof e[k] !== "string" || !e[k].trim()) return { ok: false, error: `entry ${i} (${e.name ?? "?"}) is missing ${k}` };
    }
    if (!/^[A-Za-z0-9._\/-]+$/.test(e.name)) return { ok: false, error: `entry ${i} name "${e.name}" is not a plain branch name (wildcards/regex refused)` };
    if (!/^[0-9a-f]{40}$/.test(e.tip)) return { ok: false, error: `entry ${i} (${e.name}) tip is not a full 40-char commit sha` };
    if (!Number.isFinite(Date.parse(e.declaredAt))) return { ok: false, error: `entry ${i} (${e.name}) declaredAt does not parse` };
    if (seen.has(e.name)) return { ok: false, error: `duplicate name ${e.name}` };
    seen.add(e.name);
  }
  return { ok: true, entries: arr };
}

// The declaration is read from MAINLINE, never the working tree: a branch cannot declare itself
// scratch by editing the file it is checked out with. null = absent or unreadable on mainline,
// which means nothing is declared (git cannot tell the two apart, and both tighten the answer).
function readMainlineDeclaration(mainline, cwd) {
  try {
    return execFileSync("git", ["show", `${mainline}:${SCRATCH_FILE}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch { return null; }
}

// The local tip of exactly refs/heads/<name>; null when git cannot resolve it.
function localTip(name, cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--verify", "-q", `refs/heads/${name}^{commit}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch { return null; }
}

// Commits on `branch` not on mainline whose committer time is after declaredAt. null = git could
// not answer, which the caller treats as "new work" (fail-closed). Committer time comes from git,
// declaredAt from the file: no clock is read.
function newerCommitCount(branch, declaredAt, mainline, cwd) {
  try {
    const out = execFileSync("git", ["log", "--format=%ct", `${mainline}..${branch}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const at = Date.parse(declaredAt) / 1000;
    if (!Number.isFinite(at)) return null;
    // An unparseable commit time counts as newer: unknown tightens the answer.
    return out.split("\n").filter(Boolean).filter((t) => !(Number.isFinite(Number(t)) && Number(t) <= at)).length;
  } catch { return null; }
}

// Pure: which declared names are excluded, which are reopened, which are stale. A branch is
// excluded only while its local tip IS the declared tip and no commit on it postdates declaredAt;
// a name alone excludes nothing.
function classifyScratch(entries, localBranches, tipOf, newerFn) {
  const excluded = [], reopened = [], stale = [];
  for (const e of entries) {
    if (!localBranches.includes(e.name)) { stale.push(e.name); continue; }
    if (tipOf(e.name) !== e.tip) { reopened.push(e.name); continue; }
    if (newerFn(e.name, e.declaredAt) === 0) excluded.push(e.name); else reopened.push(e.name);
  }
  return { excluded, reopened, stale };
}

// The whole evaluation from git: mainline text -> validation -> classification.
function evaluateScratch(mainline, cwd, localBranches) {
  const none = { exists: false, ok: true, excluded: [], reopened: [], stale: [] };
  const text = readMainlineDeclaration(mainline, cwd);
  if (text === null) return none;
  const v = validateScratchDeclaration(text);
  if (!v.ok) return { ...none, exists: true, ok: false, error: v.error };
  return {
    ...none, exists: true,
    ...classifyScratch(v.entries, localBranches, (b) => localTip(b, cwd), (b, at) => newerCommitCount(b, at, mainline, cwd)),
  };
}

// Pure: the branches still to be reported as unpushed after every exclusion.
function unpushedCandidates(localBranches, hubBranches, ephemeral, scratchExcluded) {
  return localBranches.filter((b) => !hubBranches.includes(b) && b !== "HEAD" && !ephemeral.includes(b) && !scratchExcluded.includes(b));
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
  // DECLARED SCRATCH (owner-directed 2026-10-02): exact names in docs/agent/local-scratch-branches.json,
  // each with a reason. Fail-closed: an invalid file excludes nothing and fails the seam; a declared
  // branch with a commit newer than its declaredAt is work again. Reported on its own line, never silent.
  const scratch = evaluateScratch(MAINLINE, repo, localBranches);
  const noRemote = unpushedCandidates(localBranches, hubBranches, ephemeral, scratch.excluded);
  if (scratch.exists) {
    if (!scratch.ok) {
      add("fail", "Declared scratch branches", `${SCRATCH_FILE} on mainline is INVALID (${scratch.error}) — nothing excluded; fix the file`);
    } else {
      const bits = [`declared scratch (${scratch.excluded.length}): ${scratch.excluded.join(", ") || "none"} — not counted`];
      if (scratch.reopened.length) bits.push(`${scratch.reopened.length} declared but tip moved or carries commits newer than declaredAt, counted as work: ${scratch.reopened.join(", ")}`);
      if (scratch.stale.length) bits.push(`${scratch.stale.length} stale declaration(s), no such local branch: ${scratch.stale.join(", ")}`);
      add(scratch.reopened.length ? "warn" : "ok", "Declared scratch branches", bits.join("; "), false);
    }
  }
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
  const verdicts = sameNamed.map((b) => ({ branch: b, ...sameNameVerdict(b, hubSha.get(b), hubSha) }));
  const unknownRows = verdicts.filter((v) => v.state === "unknown").map((v) => v.branch);
  const sameRow = sameNameRows(verdicts);
  add(sameRow.level, sameRow.title, sameRow.detail);
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

// ── 5b. Is the LOOP.md STATE block keeping pace with mainline? ───────────────
// Two git dates, no wall clock (a session's clock is not the repo's): the STATE
// block's LAST TOUCHED date vs the newest commit date on origin/SignalGrid_Alpha.
// More than a week apart and the STATE block is trailing what the repo actually did
// (docs/agent/LOOP.md once carried a two-day STATE↔body contradiction). gated:false —
// a warn, not a seam. A missing line, an unparseable date, or an unfetched remote each
// produce the warn row itself; fail-closed, never a silent skip.
{
  const loopPath = resolve(repo, "docs/agent/LOOP.md");
  const touched = existsSync(loopPath)
    ? (readFileSync(loopPath, "utf8").match(/LAST TOUCHED:\s*(\d{4}-\d{2}-\d{2})/) || [])[1]
    : undefined;
  let newest = "";
  try {
    newest = execFileSync("git", ["log", "-1", "--format=%cI", "origin/SignalGrid_Alpha"], { cwd: repo, encoding: "utf8" }).trim();
  } catch { /* unfetched remote → stateFreshness returns no-remote */ }
  const f = stateFreshness(touched, newest);
  if (f.kind === "no-date") {
    add("warn", "LOOP STATE date", 'no "LAST TOUCHED: YYYY-MM-DD" line in docs/agent/LOOP.md — cannot tell if STATE trails mainline', false);
  } else if (f.kind === "no-remote") {
    add("warn", "LOOP STATE date", "origin/SignalGrid_Alpha not fetched — cannot compare STATE date to mainline's newest commit", false);
  } else if (f.kind === "stale") {
    add("warn", "LOOP STATE date", `STATE (${touched}) trails mainline's newest commit by ${f.days} days — update the STATE block`, false);
  } else {
    add("ok", "LOOP STATE date", `STATE (${touched}) within ${Math.max(0, f.days)} day(s) of mainline's newest commit`, false);
  }
}

// STATE freshness, pure and clock-free so the self-test is deterministic: two ISO
// date strings in, a verdict out. Past 7 days apart is stale; a non-finite touched
// or newest date is its own reported kind, never silently treated as fresh.
function stateFreshness(lastTouchedISO, newestCommitISO) {
  const touched = Date.parse(lastTouchedISO ?? "");
  const newest = Date.parse(newestCommitISO ?? "");
  if (!Number.isFinite(touched)) return { kind: "no-date" };
  if (!Number.isFinite(newest)) return { kind: "no-remote" };
  const days = Math.floor((newest - touched) / 86400000);
  return { kind: days > 7 ? "stale" : "fresh", days };
}

// ── 5c. Raised hands (DR-054) — is any blocker sitting unaddressed? ──────────
// The other half of the raise-your-hand reflex: a raised hand must be SEEN. This folds
// the monitor's count in so an open blocker is surfaced every session, never lost. gated:
// false — a blocker to address, not a code defect that should block a push.
{
  try {
    const out = execFileSync("node", [resolve(repo, "scripts/check-raised-hands.mjs"), "--json"], { cwd: repo, encoding: "utf8" });
    const s = JSON.parse(out);
    if (s.open === 0) {
      add("ok", "Raised hands", "none open — every blocker resolved (DR-054)", false);
    } else {
      const bits = [`${s.open} open`];
      if (s.gaps) bits.push(`${s.gaps} with NO owner (capability GAP)`);
      if (s.stale) bits.push(`${s.stale} overdue (>3d)`);
      add("warn", "Raised hands", `${bits.join(", ")} — dispatch them (node scripts/check-raised-hands.mjs; the blocker-dispatcher agent addresses each)`, false);
    }
  } catch (e) {
    // DR-054: the monitor failing to run is itself surfaced, never swallowed.
    add("warn", "Raised hands", `monitor could not run: ${e.message}`, false);
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
  // The Hub as the seam sees it: name -> sha from `ls-remote --heads`, never from a local ref. `hb` moves the bare remote
  // behind the work clone's back (a rewind, a deletion) WITHOUT refetching, which is how a local snapshot goes stale.
  const hubMap = () => new Map(execFileSync("git", ["ls-remote", "--heads", hub], { encoding: "utf8" }).split("\n").filter(Boolean)
    .map((l) => l.split(/\s+/)).filter((p) => p[1] && p[1].startsWith("refs/heads/")).map(([sha, ref]) => [ref.slice("refs/heads/".length), sha]));
  const hb = (...a) => execFileSync("git", ["-C", hub, ...a], { stdio: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const cm = (f, text) => { put(f, text); sh("add", "-A"); sh("commit", "-q", "-m", f); return g("rev-parse", "HEAD"); };
  const verdictOf = (b, map = hubMap()) => sameNameVerdict(b, map.get(b), map, work);
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
    // (d-alias) the same one-ahead tip, now ALSO on the Hub under another name → confirmed, not ahead
    check("with no other remote ref holding the tip, sameNameVerdict still reads ahead (d-alias-pre)", sameNameVerdict("same", hubTip, hubMap(), work).state === "ahead");
    sh("push", "-q", "origin", "same:refs/heads/elsewhere"); sh("fetch", "-q", "origin");
    const vAlias = sameNameVerdict("same", hubTip, hubMap(), work);
    check("a same-named branch ahead of its Hub name whose tip is on the Hub under another ref reads confirmed (d-alias)", vAlias.state === "confirmed" && vAlias.ahead === 1);
    // (d-alias-nomap) no Hub map at all, while the tip IS on origin/elsewhere: containment has nothing to be anchored to, so it can never confirm
    check("with no Hub sha map the branch stays ahead, never confirmed (d-alias-nomap)", sameNameVerdict("same", hubTip, undefined, work).state === "ahead" && sameNameVerdict("same", hubTip, {}, work).state === "ahead");
    // (d-alias-map) the anchored positive case again, through the map: origin/<other> equals the Hub's own sha for <other>
    check("the tip held by origin/elsewhere at the Hub's own sha for elsewhere is the one thing that confirms (d-alias-map)",
      hubNamesHoldingTip("same", hubMap(), work).join() === "elsewhere" && g("rev-parse", "origin/elsewhere") === hubMap().get("elsewhere"));
    // (d-alias-unknown) asked while the tip IS contained elsewhere: containment must never clear an unreadable comparison
    check("an unknown Hub sha still reads unknown even when the tip is on the Hub under another ref (d-alias-unknown)", sameNameVerdict("same", "0123456789abcdef0123456789abcdef01234567", hubMap(), work).state === "unknown");
    // (d-alias-fail-closed) one MORE local commit that no remote ref has → back to ahead, count 2
    put("d.txt", "unpushed\n"); sh("add", "-A"); sh("commit", "-q", "-m", "ahead again, pushed nowhere");
    const vFail = sameNameVerdict("same", hubTip, hubMap(), work);
    check("one more local commit that no remote ref holds is back to ahead with the count 2 (d-alias-fail-closed)", vFail.state === "ahead" && vFail.ahead === 2);
    check("a branch that does not resolve is never confirmed (d-alias-fail-closed2)", isOnHubBySha("no-such-branch", work) === false);
    // (d-same) a branch AT its Hub tip stays "same" even when that tip is also held by another Hub name (origin/main): containment
    // is asked only of a branch already proven ahead, so the verdict is never renamed "confirmed" (M4)
    sh("checkout", "-q", "-b", "mtip", "main"); sh("push", "-q", "origin", "mtip");
    const vSame = verdictOf("mtip");
    check("a branch at its Hub tip stays same although origin/main also holds that tip (d-same)", vSame.state === "same" && vSame.ahead === 0 && hubMap().get("main") === hubMap().get("mtip"));
    // The four ways a LOCAL snapshot lies about the Hub (the refuter's F1-F4). Each tip below is real work that no Hub
    // ref holds, and a version that trusted `git branch -r --contains` read every one of them "confirmed".
    // (d-F1) the Hub rewinds the same-named branch while local origin/X still sits at the old tip
    sh("checkout", "-q", "-b", "rw", "main"); const rw1 = cm("rw1.txt", "1\n"); sh("push", "-q", "origin", "rw"); cm("rw2.txt", "2\n"); sh("push", "-q", "origin", "rw");
    hb("update-ref", "refs/heads/rw", rw1);
    check("the Hub rewound the same name while origin/rw is stale at the old tip: ahead, not confirmed (d-F1)",
      g("rev-parse", "origin/rw") !== hubMap().get("rw") && verdictOf("rw").state === "ahead");
    // (d-F1b) same, but the stale ref is a DIFFERENT Hub name that the Hub still lists, at a sha that no longer matches
    sh("checkout", "-q", "-b", "stale", "main"); const st1 = cm("st1.txt", "1\n"); sh("push", "-q", "origin", "stale"); cm("st2.txt", "2\n");
    sh("push", "-q", "origin", "stale:refs/heads/stale-alias"); hb("update-ref", "refs/heads/stale-alias", st1);
    check("another Hub name listed at a different sha than the local ref holds does not confirm (d-F1b)",
      hubMap().has("stale-alias") && g("rev-parse", "origin/stale-alias") !== hubMap().get("stale-alias") && verdictOf("stale").state === "ahead");
    // (d-F2) a tracking ref for a branch the Hub has since deleted (no fetch.prune) still contains the tip
    sh("checkout", "-q", "-b", "zdel", "main"); cm("z1.txt", "1\n"); sh("push", "-q", "origin", "zdel"); cm("z2.txt", "2\n");
    sh("push", "-q", "origin", "zdel:refs/heads/zgone"); hb("update-ref", "-d", "refs/heads/zgone"); sh("fetch", "-q", "origin");
    check("a tracking ref the Hub no longer lists (deleted, not pruned) does not confirm (d-F2)",
      g("branch", "-r", "--contains", g("rev-parse", "zdel")).includes("origin/zgone") && !hubMap().has("zgone") && verdictOf("zdel").state === "ahead");
    // (d-F3) the tip is held only by a second remote, never by the Hub
    const fork = join(root, "fork.git"); execFileSync("git", ["init", "-q", "--bare", fork]); sh("remote", "add", "fork", fork);
    sh("checkout", "-q", "-b", "forked", "main"); cm("f1.txt", "1\n"); sh("push", "-q", "origin", "forked"); cm("f2.txt", "2\n"); sh("push", "-q", "fork", "forked"); sh("fetch", "-q", "fork");
    check("a ref on a second remote does not confirm (d-F3)",
      g("branch", "-r", "--contains", g("rev-parse", "forked")).includes("fork/forked") && verdictOf("forked").state === "ahead");
    // (d-F4) a hand-written refs/remotes ref that no remote owns
    sh("checkout", "-q", "-b", "handmade", "main"); cm("h1.txt", "1\n"); sh("push", "-q", "origin", "handmade"); const h2 = cm("h2.txt", "2\n");
    sh("update-ref", "refs/remotes/pr/999", h2);
    check("a hand-made refs/remotes ref does not confirm (d-F4)",
      g("branch", "-r", "--contains", h2).includes("pr/999") && verdictOf("handmade").state === "ahead");
    // The three pieces of hand-made LOCAL state that rewrite the graph or the name it is asked about (the round-2 refuter's
    // G1-G3). `raw` is git WITHOUT the guards, so each precondition proves the lie is really on offer before the guarded
    // answer is checked: without it a passing case could mean the fixture never reproduced the hole.
    const raw = (...a) => execFileSync("git", a, { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const graftsFile = join(work, ".git", "info", "grafts");
    // (d-G1) `git replace --graft`: origin/g1o (local sha == the Hub's) is made a parent of the never-pushed g1t
    sh("checkout", "-q", "-b", "g1o", "main"); const g1o = cm("g1o.txt", "1\n"); sh("push", "-q", "origin", "g1o");
    sh("checkout", "-q", "-b", "g1x", "main"); const g1b = cm("g1b.txt", "1\n"); sh("push", "-q", "origin", "g1x"); const g1t = cm("g1t.txt", "2\n");
    sh("replace", "--graft", g1o, g1t);
    const g1v = verdictOf("g1x");
    check("a replace-ref graft that makes origin/g1o a parent of the unpushed tip does not confirm it (d-G1)",
      raw("for-each-ref", "--contains", g1t, "--format=%(refname:lstrip=3)", "refs/remotes/origin").split("\n").includes("g1o") &&
      g("rev-parse", "origin/g1o") === hubMap().get("g1o") && g1v.state === "ahead" && g1v.ahead === 1);
    sh("replace", "-d", g1o);
    // (d-G1b) the same trick on the count: replacing the Hub's own g1x tip with a child of g1t makes g1t reachable from it
    sh("replace", "--graft", g1b, g1t);
    const g1c = aheadOfHub("g1x", hubMap().get("g1x"), work);
    check("a replace-ref graft on the Hub's tip does not turn an ahead branch into same (d-G1b)",
      raw("rev-list", "--count", `${g1b}..refs/heads/g1x`) === "0" && g1c.state === "ahead" && g1c.ahead === 1);
    sh("replace", "-d", g1b);
    check("with the replace refs gone the plain branch still reads ahead by one (d-G1c)", verdictOf("g1x").state === "ahead" && verdictOf("g1x").ahead === 1 && !verdictOf("g1x").reason);
    // (d-G2) a legacy info/grafts file: replace-objects-off does not disable it, so the file itself must block confirmation
    writeFileSync(graftsFile, `${g1o} ${g1t}\n${g1b} ${g1t}\n`);
    const g2v = verdictOf("g1x"), g2a = aheadOfHub("g1x", hubMap().get("g1x"), work);
    const g2raw = raw("for-each-ref", "--contains", g1t, "--format=%(refname:lstrip=3)", "refs/remotes/origin").split("\n").includes("g1o");
    unlinkSync(graftsFile);
    check("a grafts file that makes origin/g1o a parent of the unpushed tip is not confirmed, and the row reason names the file (d-G2)",
      g2raw && g2v.state === "ahead" && g2v.ahead === null && String(g2v.reason).includes(graftsFile) && /graft file present/.test(g2v.reason));
    check("aheadOfHub under a grafts file reads unknown with the file named, never same (d-G2b)",
      g2a.state === "unknown" && String(g2a.reason).includes(graftsFile));
    const g2r = sameNameRows([{ branch: "g1x", ...g2v }]);
    check("the fail row carries the reason and prints no invented count (d-G2c)", g2r.level === "fail" && g2r.detail.startsWith("g1x (count unreadable)") && g2r.detail.includes(graftsFile));
    check("with the grafts file removed the same branch reads ahead by one and carries no reason (d-G2d)", !existsSync(graftsFile) && verdictOf("g1x").ahead === 1 && !verdictOf("g1x").reason);
    // (d-G2e) GIT_GRAFT_FILE points git at a grafts file anywhere: the guard must read what git would read
    const envGrafts = join(root, "env-grafts"); writeFileSync(envGrafts, `${g1o} ${g1t}\n`); process.env.GIT_GRAFT_FILE = envGrafts;
    let g2e; try { g2e = verdictOf("g1x"); } finally { delete process.env.GIT_GRAFT_FILE; }
    check("a grafts file named by GIT_GRAFT_FILE blocks confirmation and is named (d-G2e)", g2e.state === "ahead" && String(g2e.reason).includes(envGrafts));
    // (d-G3) a local TAG named like the branch: tag tg at a commit the Hub holds under another name, branch tg two ahead of its Hub tip
    sh("checkout", "-q", "-b", "tg", "main"); sh("push", "-q", "origin", "tg"); const tgA = cm("tgA.txt", "1\n"); sh("push", "-q", "origin", "tg:refs/heads/tg-other");
    sh("tag", "tg", tgA); cm("tgU.txt", "2\n");
    const tgv = verdictOf("tg");
    check("a tag named like the branch does not hide its real tip: ahead by two, not confirmed (d-G3)",
      raw("rev-parse", "tg^{commit}") === tgA && tgv.state === "ahead" && tgv.ahead === 2);
    sh("tag", "-d", "tg");
    // (d-G3b) aheadOfHub: a tag at the Hub's own sha for the branch used to read an ahead branch as same
    sh("checkout", "-q", "-b", "tb", "main"); sh("push", "-q", "origin", "tb"); sh("tag", "tb"); cm("tbU.txt", "1\n");
    const tbv = aheadOfHub("tb", hubMap().get("tb"), work);
    check("a tag at the Hub's own sha does not make an ahead branch read same (d-G3b)", raw("rev-list", "--count", `${hubMap().get("tb")}..tb`) === "0" && tbv.state === "ahead" && tbv.ahead === 1);
    sh("tag", "-d", "tb");
    // (d-G3c) isOnHubBySha: a tag on a Hub-held commit named like a local-only branch must not clear that branch
    sh("checkout", "-q", "-b", "tc", "main"); cm("tcU.txt", "1\n"); sh("tag", "tc", "main");
    check("a tag named like a local-only branch does not make its unpushed tip look like it is on the Hub (d-G3c)",
      raw("branch", "-r", "--contains", raw("rev-parse", "tc^{commit}")).includes("origin/main") && isOnHubBySha("tc", work) === false);
    sh("tag", "-d", "tc");
    // (d-rows) the row text names a confirmed branch, and the title says what the ok row covers (M5)
    const rowsOk = sameNameRows([{ branch: "b-same", state: "same", ahead: 0 }, { branch: "claude/conf-branch", state: "confirmed", ahead: 3 }, { branch: "b-unk", state: "unknown" }]);
    check("the ok row names the confirmed branch and counts the compared ones (d-rows)",
      rowsOk.level === "ok" && rowsOk.detail.includes("claude/conf-branch") && rowsOk.detail.startsWith("2 branch(es) compared by sha") && /confirmed on the Hub under another branch/.test(rowsOk.title));
    const rowsFail = sameNameRows([{ branch: "claude/conf-branch", state: "confirmed", ahead: 3 }, { branch: "x-ahead", state: "ahead", ahead: 2 }]);
    check("the fail row names the ahead branch with its count and still names the confirmed one (d-rows-fail)",
      rowsFail.level === "fail" && rowsFail.detail.startsWith("x-ahead (+2)") && rowsFail.detail.includes("claude/conf-branch"));
    check("with nothing confirmed the row carries no confirmed note (d-rows-none)", !/confirmed/.test(sameNameRows([{ branch: "b", state: "same", ahead: 0 }]).detail));
    // fail-closed: a branch identical to mainline proves nothing
    check("a branch with no diff against mainline is not cleared", landedByPatchId("main", M, work) === false);
    // STATE freshness (pure, clock-free): a fixture date older than a fixture commit
    check("STATE trailing mainline by >7 days is stale", stateFreshness("2026-09-01", "2026-09-22T10:00:00-04:00").kind === "stale");
    check("STATE within a week reads fresh", stateFreshness("2026-09-20", "2026-09-22T10:00:00-04:00").kind === "fresh");
    check("an unparseable STATE date reads no-date, never fresh", stateFreshness("not-a-date", "2026-09-22T10:00:00-04:00").kind === "no-date");
    check("an unfetched remote reads no-remote, never fresh", stateFreshness("2026-09-20", "").kind === "no-remote");
    // DECLARED SCRATCH. The declaration is read from a MAINLINE ref, never the working tree; a branch is
    // excluded only while its tip equals the declared tip. Each case below fails when its guard is removed.
    const SF = SCRATCH_FILE;
    const decl = (name, at, tip) => ({ name, tip, reason: "r", origin: "DR-050 gate-falsification reproduction", declaredBy: "t", declaredAt: at });
    const rawNow = Number(g("log", "-1", "--format=%ct", "same"));
    const futureAt = new Date((rawNow + 3600) * 1000).toISOString(), pastAt = new Date((rawNow - 3600) * 1000).toISOString();
    const mkMainline = (name, text) => { // a throwaway "mainline" ref whose tree carries (or lacks) the declaration
      sh("checkout", "-q", "-b", name, "main");
      if (text !== null) { execFileSync("mkdir", ["-p", join(work, "docs/agent")]); put(SF, text); sh("add", "-A"); sh("commit", "-q", "-m", name); }
    };
    sh("checkout", "-q", "-b", "scratch-ok", "main"); put("s.txt", "x\n"); sh("add", "-A"); sh("commit", "-q", "-m", "scratch work");
    const tipOk = g("rev-parse", "scratch-ok");
    sh("checkout", "-q", "-b", "undeclared", "main"); put("u.txt", "x\n"); sh("add", "-A"); sh("commit", "-q", "-m", "undeclared work");
    const local = ["scratch-ok", "undeclared", "main"];
    const tipOf = (b) => localTip(b, work);
    const newer = (b, at) => newerCommitCount(b, at, M, work);
    const cA = classifyScratch([decl("scratch-ok", futureAt, tipOk), decl("ghost", futureAt, tipOk)], local, tipOf, newer);
    check("a declared branch at its declared tip is excluded (a)", cA.excluded.includes("scratch-ok") && !cA.excluded.includes("undeclared"));
    check("a declared name with no local branch is reported stale, not fatal (a-stale)", cA.stale.join() === "ghost");
    check("an undeclared branch is never excluded (b)", !classifyScratch([decl("scratch-ok", futureAt, tipOk)], local, tipOf, newer).excluded.includes("undeclared"));
    const cT = classifyScratch([decl("scratch-ok", futureAt, "0".repeat(40))], local, tipOf, newer);
    check("a declared name whose local tip is NOT the declared tip is counted as work (tip)", cT.reopened.join() === "scratch-ok" && cT.excluded.length === 0);
    const cD = classifyScratch([decl("scratch-ok", pastAt, tipOk)], local, tipOf, newer);
    check("a declared branch at its tip with a commit newer than declaredAt is counted again (d)", cD.reopened.join() === "scratch-ok" && cD.excluded.length === 0);
    check("a git failure reads as new work, never as clean (d-fail)", newerCommitCount("no-such-branch", futureAt, M, work) === null && classifyScratch([decl("scratch-ok", futureAt, tipOk)], local, tipOf, () => null).excluded.length === 0);
    check("an unresolvable local tip never equals a declared tip", localTip("no-such-branch", work) === null && classifyScratch([decl("scratch-ok", futureAt, tipOk)], local, () => null, () => 0).excluded.length === 0);
    // validation (c): every shape the file must refuse
    const good = [decl("scratch-ok", futureAt, tipOk)];
    const bad = (mut) => validateScratchDeclaration(JSON.stringify([{ ...good[0], ...mut }])).ok === false;
    check("a complete declaration validates", validateScratchDeclaration(JSON.stringify(good)).ok === true);
    check("an entry missing reason is INVALID (c)", bad({ reason: "" }));
    check("an entry missing origin is INVALID (c2)", bad({ origin: undefined }));
    check("an entry missing tip is INVALID (c-tip)", bad({ tip: undefined }));
    check("a tip that is not a full 40-char sha is INVALID (c-tip2)", bad({ tip: "abc123" }));
    check("a wildcard name is refused (c3)", bad({ name: "attack-*" }));
    check("a regex-shaped name is refused (c4)", bad({ name: "^scratch.*$" }));
    check("a duplicate name is INVALID (c-dup)", validateScratchDeclaration(JSON.stringify([good[0], good[0]])).ok === false);
    check("a non-JSON declaration is INVALID (c5)", validateScratchDeclaration("{nope").ok === false);
    // the file is read from MAINLINE: present, absent, invalid, and a working-tree plant that must be ignored
    mkMainline("decl-ok", JSON.stringify(good));
    mkMainline("decl-bad", JSON.stringify([{ ...good[0], reason: "" }]));
    mkMainline("decl-none", null);
    execFileSync("mkdir", ["-p", join(work, "docs/agent")]); put(SF, JSON.stringify(good)); // untracked plant on decl-none's working tree
    const eOk = evaluateScratch("decl-ok", work, local), eBad = evaluateScratch("decl-bad", work, local), eNone = evaluateScratch("decl-none", work, local);
    check("a declaration on mainline excludes the declared branch end to end (m-ok)", eOk.ok && eOk.excluded.join() === "scratch-ok");
    check("an invalid declaration on mainline is INVALID and excludes nothing (m-bad)", eBad.exists && !eBad.ok && eBad.excluded.length === 0);
    check("a declaration present only in the WORKING TREE is ignored (m-wt)", !eNone.exists && eNone.excluded.length === 0);
    check("a mainline ref git cannot resolve declares nothing (m-absent)", evaluateScratch("no-such-ref", work, local).exists === false);
    // wiring: the exclusion must actually remove the branch from the unpushed list
    check("an excluded branch drops out of the unpushed list; an undeclared one stays (w)", unpushedCandidates(["scratch-ok", "undeclared"], [], [], ["scratch-ok"]).join() === "undeclared");
    check("with nothing excluded both stay on the unpushed list (w2)", unpushedCandidates(["scratch-ok", "undeclared"], [], [], []).join() === "scratch-ok,undeclared");
  } catch (e) {
    check(`self-test harness ran without throwing (${e && e.message ? e.message.split("\n")[0] : e})`, false);
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* temp dir */ }
  }
  const failed = checks.filter(([, ok]) => !ok).length;
  console.log(failed ? `self-test FAILED (${checks.length - failed}/${checks.length})` : `self-test passed (${checks.length}/${checks.length})`);
  return failed ? 1 : 0;
}
