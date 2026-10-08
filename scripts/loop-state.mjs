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
import { existsSync, readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmSync, mkdirSync, statSync, symlinkSync } from "node:fs";
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
// .git/info/grafts file, which git still honours with replace objects off; graftsBlock below
// is the guard for that, and the same-name verdict calls it.
//
// maxBuffer is 64 MiB, like gitRaw/gitFeed/listLocalBranches. Node's default is 1 MiB, and a command whose output
// passes it throws ENOBUFS, which the catch below turns into "": the same answer as a real empty one. Round 5's
// landed-by-content check compared `git show` text through this function, so two files over 1 MiB (the live
// docs/CLAIM_INVENTORY.md is 1,128,935 bytes) both read "" and "" === "" cleared REAL work as squash-landed.
// That check no longer reads file text at all (see hasLandedByContent), and this limit is the second lock.
const gitIn = (cwd) => (...a) => {
  try {
    return execFileSync("git", ["--no-replace-objects", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).trim();
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
// The EXIT STATUS of a git command (replace objects off): 0 yes, 1 no for a yes/no command such as `merge-base --is-ancestor`,
// anything else (or null: git could not run) is an error. gitIn cannot answer a yes/no command: its "" is the output of
// BOTH "no" and "yes" for a command that prints nothing, and of every failure besides.
function gitStatus(cwd, args) {
  const r = spawnSync("git", ["--no-replace-objects", ...args], { cwd, stdio: "ignore" });
  return r.error ? null : r.status;
}
// What a path IS in a tree: { entry: "<mode> <type> <object id>" } | { missing: true } | { error: true }.
// `git ls-tree` exits 0 with NO output for a path the tree does not have and non-zero for a ref it cannot read, so a missing path
// and a git failure are different answers here; gitIn gave both as "" and the landed check read "" === "" as "identical".
// The entry carries the MODE as well as the blob id (a chmod, or a symlink whose target text equals a file's bytes, has the same
// blob id and is a different change). -z keeps the path unquoted and exact; the tab splits the entry from the path.
function entryAt(cwd, ref, file) {
  const r = spawnSync("git", ["--no-replace-objects", "--literal-pathspecs", "ls-tree", "-z", "--full-tree", ref, "--", file], {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return { error: true };
  const recs = String(r.stdout || "").split("\0").filter(Boolean);
  if (recs.length === 0) return { missing: true };
  if (recs.length > 1) return { error: true }; // a path names exactly one entry; anything else is not understood
  const m = /^(\d{6} (?:blob|commit|tree) [0-9a-f]{40,64})\t/.exec(recs[0]);
  return m ? { entry: m[1] } : { error: true };
}
// A FULL refname, never `origin/SignalGrid_Alpha`: a tag called origin/SignalGrid_Alpha outranks the
// remote-tracking ref in a bare resolution, and every landed check below would then compare a local
// branch against the tag's commit, not against mainline.
const MAINLINE = "refs/remotes/origin/SignalGrid_Alpha";
// Every git argument that names a LOCAL branch is headRef(name), never the bare name (see listLocalBranches).
const HEADS = "refs/heads/";
const headRef = (name) => `${HEADS}${name}`;
// The two warnings `git for-each-ref` prints when it SKIPS a ref it cannot read (see listLocalBranches); anchored on the wording.
const REF_SKIP_WARNING = /^warning: ignoring (broken ref|ref with broken name)\b/;
const SCRATCH_FILE = "docs/agent/local-scratch-branches.json";
// Bounded walk of mainline history for the landed checks: an unbounded walk is a check
// nobody waits for, and a check nobody waits for gets switched off. Exhausting the bound
// without a match returns FALSE — reported, never cleared.
const MAX_HISTORY = 400;

if (process.argv.includes("--self-test")) process.exit(selfTest());

console.log(`\n${B}Loop check${X} ${D}— reality, not notes${X}\n`);

// ── 1. Does local work exist that the Review Hub has never seen? ────────────
// This is the check that would have caught the lost week.
// The list is built from FULL refnames (see listLocalBranches); a failed listing is a reported failure
// (branchListRow), never an empty clean list.
const listing = listLocalBranches(repo);
const localBranches = listing.names;
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
{
  const r = branchListRow(listing);
  if (r) add(r.state, r.what, r.detail, r.gated);
}

// ── Local branches, as FULL refnames ─────────────────────────────────────────
// `git branch --format=%(refname:short)` is not a list of branch names. When a TAG shares a branch's
// name, git shortens the BRANCH to `heads/<name>` (the shortest form that is not ambiguous), and
// `heads/<name>` is a name no refs/heads/ entry carries: round 3 then asked about `refs/heads/heads/<name>`,
// which never exists, so a branch sitting exactly at its Hub tip with a same-named tag FAILED the unpushed
// seam and could not be cleared, and (contrived) real unpushed work on refs/heads/X next to a Hub branch
// literally called heads/X was demoted from a gated AHEAD to a non-gated "not fetched locally" warning.
// `%(refname:lstrip=2)` is no fix on its own: the bare name X it returns resolves the TAG in every git
// argument that is not qualified, and a tag on a commit whose bytes are in mainline then cleared real
// unpushed work as "squash-landed".
//
// So the listing asks for %(refname), the display/short name is the string after "refs/heads/" (it never
// changes under a tag, and it is the same key the Hub map uses: ls-remote names are stripped the same way),
// and EVERY git argument that names a local branch is headRef(name), never the bare name.
//
// The listing is fail-closed too: a git error, a spawn error, a non-zero exit, an `error:`/`fatal:` line, or
// one of the two warnings for-each-ref prints WHEN IT SKIPS A REF is `ok:false`. for-each-ref SKIPS a broken
// ref with only a warning ("ignoring broken ref" / "ignoring ref with broken name") and exits 0, so the exit
// code alone would read a branch git could not read as a branch that does not exist.
//
// Any OTHER `warning:` is not about the refs and is not a reason to withhold the verdict. Round 4 failed the
// listing on ANY `warning:` line, and a deprecated config key in a dotfile (`core.fsyncObjectFiles=true`
// prints "warning: core.fsyncObjectFiles is deprecated; use core.fsync instead" on every git command, exit 0)
// then turned every session red with a false "checks did NOT run". Measured on git 2.43 (LC_ALL=C): the only
// warnings for-each-ref prints about the refs it lists are the two ref-skip ones below; a dangling symref and
// a *.lock file are dropped silently; `hint:` and GIT_TRACE lines never start with `warning:`. So the ref-skip
// warnings are anchored on their WORDING, and every other warning is carried on `warnings` and printed in the
// detail of the row built from this listing (branchSeamRows), named, never swallowed and never failing it.
function listLocalBranches(cwd = repo) {
  const r = spawnSync("git", ["--no-replace-objects", "for-each-ref", "--format=%(refname)", HEADS], {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C", LANGUAGE: "C" }, // the warning prefixes below are matched in English
  });
  const fail = (error) => ({ ok: false, refs: [], names: [], error });
  if (r.error) return fail(String(r.error.message || r.error).split("\n")[0]);
  const lines = String(r.stderr || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const hard = lines.find((l) => /^(error|fatal):/.test(l) || REF_SKIP_WARNING.test(l));
  if (r.status !== 0) return fail(hard || `git exited ${r.status}`);
  if (hard) return fail(hard);
  const refs = String(r.stdout || "").split("\n").filter(Boolean);
  const stray = refs.find((x) => !x.startsWith(HEADS) || x.length === HEADS.length);
  if (stray !== undefined) return fail(`unexpected refname in a refs/heads listing: ${stray}`);
  return { ok: true, refs, names: refs.map((x) => x.slice(HEADS.length)), warnings: [...new Set(lines.filter((l) => l.startsWith("warning:")))] };
}
function branchListRow(l) {
  if (l.ok) return null;
  return {
    state: "fail",
    what: "Local branch list unreadable",
    detail: `git for-each-ref refs/heads failed (${l.error}) — the unpushed-work and same-name checks did NOT run; an unreadable list is not an empty one`,
    gated: true,
  };
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
 * TRUE only when every path the branch changes relative to its merge base has the very same tree entry
 * (mode and object id) on mainline, or had it in a mainline commit made AFTER the branch forked
 * (fileEverMatchedMainline). That is what survives a SQUASH merge, which rewrites the commit and defeats
 * `merge-base --is-ancestor`.
 *
 * It compares OBJECT IDS, never file text. Round 5 compared the trimmed text of `git show` through gitIn, which had
 * no maxBuffer: a file over 1 MiB threw ENOBUFS on both sides, both read "", and "" === "" cleared real work (the
 * live docs/CLAIM_INVENTORY.md is 1,128,935 bytes); a trim-only difference (indentation, trailing blank lines in
 * YAML) read byte-identical too. A path the tree does not have is a distinct answer (entryAt), not an empty file:
 *   · missing on BOTH sides is the same state (the branch deleted a file mainline also deleted: cleared);
 *   · missing on the branch only is a difference (the branch deletes what mainline still has: reported);
 *   · missing on mainline only falls through to the history check (mainline may have landed the content and removed it).
 * The diff is `-z --no-renames`: -z because git QUOTES a path like "\303\244.txt" in plain output and a quoted name is
 * missing on both sides; --no-renames because a rename is listed under its NEW name only, so the half that deletes the
 * old path was never compared.
 *
 * Fail-closed in every direction: an unreadable diff, an unreadable entry on either side (any git error), an entry
 * that differs and never appeared on mainline since the fork all return false, and the branch stays reported as
 * unpushed. What this does NOT say is that the work reached the Hub: it reads the local refs/remotes mainline ref.
 */
function hasLandedByContent(branch, mainline = MAINLINE, cwd = repo) {
  const tip = headRef(branch);
  const raw = gitRaw(cwd, ["--no-replace-objects", "diff", "--name-only", "--no-renames", "-z", `${mainline}...${tip}`]);
  const files = raw.split("\0").filter(Boolean);
  // A branch that touches nothing is not evidence of landing — it is an unreadable
  // diff, or a branch identical to its base. Say nothing rather than clear it.
  if (files.length === 0) return false;
  for (const file of files) {
    const mine = entryAt(cwd, tip, file), theirs = entryAt(cwd, mainline, file);
    if (mine.error || theirs.error) return false;
    if (mine.missing && theirs.missing) continue; // deleted on both sides: the same state
    if (mine.missing) return false; // the branch removes what mainline still has: a difference (fileEverMatchedMainline answers the same; said here so the rule reads in one place)
    if (mine.entry !== theirs.entry && !fileEverMatchedMainline(branch, file, mainline, cwd)) return false;
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
// this instant". An entry that appeared in mainline's history for that path is content
// that landed, whatever happened to the file since.
//
// ...SINCE THE BRANCH FORKED, and only since. Round 5 walked mainline from its first commit, so a local-only REVERT
// (or revert of a revert) matched a blob from BEFORE the branch existed: mainline had gone v1 -> v2 -> v1, the branch
// re-applied v2, and v2's old commit "matched", clearing real work the Hub has never seen. A squash of THIS branch can
// only land after the branch forked, so the walk is `<merge-base>..mainline`. No merge base (unrelated histories) is
// no answer: false.
//
// Fail-closed, like its three siblings. Bounded to the most recent MAX_HISTORY
// commits touching the path: an unbounded walk on a long history is a check nobody
// waits for, and a check nobody waits for gets switched off. Exhausting the bound
// without a match returns FALSE — reported, never cleared — so the failure mode of
// looking too little is a branch that stays named, never one that vanishes quietly.
function fileEverMatchedMainline(branch, file, mainline = MAINLINE, cwd = repo) {
  const git = gitIn(cwd);
  const mine = entryAt(cwd, headRef(branch), file);
  if (!mine.entry) return false;
  const base = git("merge-base", mainline, headRef(branch));
  if (!base) return false;
  const hist = git("log", `--max-count=${MAX_HISTORY}`, "--format=%H", `${base}..${mainline}`, "--", file);
  if (!hist) return false;
  for (const commit of hist.split("\n").map((c) => c.trim()).filter(Boolean)) {
    if (entryAt(cwd, commit, file).entry === mine.entry) return true;
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
// different whole-diff patch-id. And bound to the FORK: the history walked is `<merge-base>..mainline` (see
// fileEverMatchedMainline for the round-5 revert that matched a commit from before the branch existed).
// Purely local: no network, no GitHub call from a hook
// (AGENTS.md: no live API calls); confirming a landing against GitHub by hand is an
// operator step outside this path. Fail-closed like its siblings: no diff, no merge-base,
// no history, a git error, a matched id that does not re-apply — all FALSE, all reported.
function landedByPatchId(branch, mainline = MAINLINE, cwd = repo) {
  const git = gitIn(cwd);
  const base = git("merge-base", mainline, headRef(branch));
  const tip = git("rev-parse", "--verify", `${headRef(branch)}^{commit}`);
  if (!base || !tip || base === tip) return false;
  const patch = gitRaw(cwd, ["diff", base, tip]);
  if (!patch) return false;
  const want = patchIdOf(cwd, patch);
  if (!want) return false;
  const hist = git("log", `--max-count=${MAX_HISTORY}`, "--format=%H %P", `${base}..${mainline}`);
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
// does. While one is in force no ancestry answer from this checkout is trusted.
//
// WHERE git looks is git's own answer, and nobody else's: `git rev-parse --git-path info/grafts` already
// honours GIT_GRAFT_FILE (relative values included: it prints the path relative to the CALLER's directory,
// while git itself reads a relative GIT_GRAFT_FILE from the top of the worktree), and a linked worktree
// names the shared file. The script used to read process.env.GIT_GRAFT_FILE first, which is the raw value
// and wrong for a relative one asked from a subdirectory (it resolved the name against the wrong directory
// and read "no grafts" while git applied them).
//
// WHETHER git applies anything is measured against git 2.43, not assumed. Each row names the self-test case that
// builds the shape and compares graftsState with git ITSELF (rawApplied: does `git for-each-ref --contains`
// list origin/g1o as holding the unpushed tip, i.e. does git apply the graft); a row with no case id has NONE,
// and says so:
//   absent file ...................................................... (d-G2m baseline) git applies none  -> no block
//   dangling symlink ................................................. (d-G2m)  git applies none  -> no block
//   nonexistent GIT_GRAFT_FILE ....................................... (d-G2j)  git applies none  -> no block
//   0-byte file ...................................................... (d-G2f)  git applies none  -> no block ("empty")
//   a directory at the path .......................................... (d-G2g)  git applies none  -> no block
//   GIT_GRAFT_FILE='' (git-path prints "./", the cwd) ................ (d-G2i)  git applies none, even with a
//                                                                      real .git/info/grafts -> no block
//   GIT_GRAFT_FILE=/dev/null (git's documented off switch) ........... (d-G2j)  git applies none  -> no block
//   symlink to a non-empty file ...................................... (d-G2n)  git APPLIES it    -> BLOCK (stat follows the link)
//   plain graft line, ordinary file .................................. (d-G2)   git APPLIES it    -> BLOCK
//   CRLF line ending ................................................. (d-G2p)  git APPLIES it    -> BLOCK
//   comment line followed by a graft line ............................ (d-G2q)  git APPLIES it    -> BLOCK
//   GIT_GRAFT_FILE naming a file, own or another repository's ........ (d-G2e, d-G2r) git APPLIES it -> BLOCK
//   relative GIT_GRAFT_FILE asked from a subdirectory ................ (d-G2k)  git APPLIES it    -> BLOCK
//   comment-only file ................................................ (d-G2h)  git applies none from it; we do not
//   whitespace-only file ............................................. (d-G2o)  reimplement its parser, so ANY
//                                                                      non-empty regular file BLOCKS (conservative)
// Shapes with NO case: a path we cannot stat for any reason but "does not exist" (BLOCK, unreadable tightens);
// a device, fifo or socket other than /dev/null (BLOCK, cannot tell what it holds); git failing to name the
// path at all (BLOCK). They are fail-closed by construction and are not measured against git.
// Only a BLOCK has a `reason`; the no-block states carry a `note` saying what they are.
function graftsState(cwd = repo) {
  const tail = "ancestry cannot be trusted, confirmation disabled";
  const p = gitIn(cwd)("rev-parse", "--git-path", "info/grafts");
  if (!p) return { block: true, state: "unreadable", reason: `grafts path unreadable (git did not name info/grafts); ${tail}` };
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    if (e && (e.code === "ENOENT" || e.code === "ENOTDIR")) return { block: false, state: "absent", path: abs, note: `no grafts file at ${abs}` };
    return { block: true, state: "unreadable", path: abs, reason: `graft file unreadable (${e && e.code ? e.code : e}): ${abs}; ${tail}` };
  }
  if (st.isDirectory()) {
    return process.env.GIT_GRAFT_FILE === ""
      ? { block: false, state: "disabled", path: abs, note: "grafts disabled by GIT_GRAFT_FILE='' (git applies none)" }
      : { block: false, state: "directory", path: abs, note: `the grafts path is a directory (git applies none): ${abs}` };
  }
  if (st.isFile()) {
    return st.size === 0
      ? { block: false, state: "empty", path: abs, note: `the grafts file is empty (git applies none): ${abs}` }
      : { block: true, state: "present", path: abs, reason: `graft file present: ${abs}; ${tail}` };
  }
  if (abs === "/dev/null") return { block: false, state: "disabled", path: abs, note: "grafts disabled by GIT_GRAFT_FILE=/dev/null" };
  return { block: true, state: "present", path: abs, reason: `graft path is not a regular file: ${abs}; ${tail}` };
}
// "" when no grafts file is in force, else the reason, which names the file.
function graftsBlock(cwd = repo) {
  const g = graftsState(cwd);
  return g.block ? g.reason : "";
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
// The tip being held by a Hub branch under another name IS "confirm the remote", which is the
// message's own second option. Fail-closed like its two siblings: a git error, an unreadable ref
// or an empty answer leaves the branch REPORTED, never cleared.
//
// WHAT "HELD BY THE HUB" MEANS here is the one thing hubNamesHoldingTip (below) answers, and this
// function is only its yes/no. Until round 5 this function read `git branch -r --contains` instead: the
// LOCAL refs/remotes snapshot, which is not the Hub. A grafts file, a hand-made refs/remotes/pr/999 (the
// shared checkout carries a set of refs/remotes/pr/* refs; count them with `git for-each-ref refs/remotes/pr/`,
// the number moves) or a stale tracking ref cleared REAL unpushed work in this gated row ("1 on the hub under
// another name") with exit 0, and the sentence that stood here, "this cannot clear real local work", was false
// on exactly those inputs. Round 5 fixed that by trusting a tracking ref only where its sha EQUALED the Hub's, and
// round 6's refuter found the price: when the Hub moved <name> FORWARD after the last fetch the holder was merely
// BEHIND, no longer equal, and a branch that IS on the Hub read "push, or confirm the remote" until a `git fetch`;
// a tip that EQUALLED a Hub-listed sha pushed by URL (so no tracking ref was ever written) never cleared at all.
//
// So the rule is ANCESTRY AGAINST THE HUB'S OWN LISTING, not a tracking ref: a branch is on the Hub under another
// name when its tip is an ancestor of (or equal to) the commit the Hub's ls-remote lists for <name>, that commit
// is in the local object store, replace objects are off and no grafts file is in force (hubTipState). A snapshot
// ref, a second remote, a replace ref, a graft and a same-named tag each fail it, and with a grafts file in force
// the row says the exemption is off and names the file. When NO listed commit is local but a tracking ref that
// holds the tip lags the Hub's sha for its name, the answer is "fetch" (hubFetchCauses), still a gated failure.
function isOnHubBySha(branch, hubShaMap, cwd = repo) {
  return hubTipState(branch, hubShaMap, cwd).holds;
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
// The rule is the one stated above isOnHubBySha, and since round 5 BOTH seams call the same function
// (hubTipState) for it. For two rounds they did not: this seam was Hub-anchored and the sibling
// read the LOCAL refs/remotes snapshot, and a snapshot is not the Hub. A first version of this
// function trusted `git branch -r --contains` and an Opus refuter overturned it with four
// fixtures, each reading "confirmed" for a tip that is on the Hub nowhere: (F1) the Hub rewound
// the same-named branch while local origin/X still sat at the old tip; (F2) a tracking ref for a
// branch the Hub has since deleted (no fetch.prune); (F3) a second remote (fork/X); (F4) a
// hand-written refs/remotes/pr/999. Round 4's refuter then found the same four holes, unchanged, in the
// sibling (isOnHubBySha), whose row is gated.
//
// So the confirmation is ANCHORED TO THE LS-REMOTE the seam already took: the only commits asked about
// are the shas the Hub's own listing gives (hubShaMap), under a name that is not this branch. A stale origin/X
// (F1), a pruned-late origin/Z the Hub no longer lists (F2), any other remote (F3) and a hand-made ref outside
// origin or at a sha the Hub does not list (F4) are never asked about at all. (Rounds 3-5 asked about the LOCAL
// origin/<name> refs and required each to sit AT the Hub's sha; round 6 asks about the Hub's shas themselves, by
// ancestry, so a holder the Hub has since moved forward still counts: see isOnHubBySha.)
//
// Anchoring is necessary and NOT sufficient. It proves the sha is the Hub's; it does not prove the LOCAL graph
// answers "does that commit descend from my tip" the way the Hub's would, because three pieces of hand-made
// local state rewrite the graph or the name it is asked about. A second Opus refute (round 2) read each of
// them "confirmed" for work the Hub's object store does not hold:
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
// refs/heads/<branch>, never the bare name (here, in aheadOfHub, and in every other git
// argument that names a local branch: hasLandedByContent, fileEverMatchedMainline, landedByPatchId,
// newerCommitCount and the carrying count; the list itself is full refnames, see listLocalBranches). What is still
// trusted: that an object in the local store is the object its sha says (content addressing), and
// that the Hub holds the whole history of a commit it lists. The seam REPORTS a confirmed branch by
// name so the exclusion is visible, never silent. Fail-closed exactly like the alias check: a git
// error, an unreadable ref, an empty answer, a missing map or a grafts file leaves the branch
// AHEAD; an unknown Hub sha stays UNKNOWN (containment is only asked of a branch already proven
// ahead, never used to clear an unreadable comparison); and a branch with a commit no Hub ref
// holds is contained in none, so renaming cannot clear real local work.
function hubNamesHoldingTip(branch, hubShaMap, cwd = repo) {
  return hubTipState(branch, hubShaMap, cwd, { names: true }).holders;
}
// The remedy for a branch the Hub may well hold but this checkout cannot see yet: a gated failure all the same,
// worded so the next step is the right one. hubFetchCauses answers WHICH tracking ref lags; the strings are shared
// by every row that says it, so one cause reads one way everywhere.
function hubFetchCauses(branch, hubShaMap, cwd = repo) {
  return hubTipState(branch, hubShaMap, cwd).behind;
}
// (function declarations, not consts: the self-test runs before this module body reaches a const)
function fetchHint(name) { return `origin/${name} is behind the Hub: run git fetch origin, then re-run`; }
function unfetchedHint(name) { return `the Hub's ${name} is not fetched here: run git fetch origin, then re-run`; }

// The shas among `shas` that are COMMITS in this checkout's object store (replace objects off): one process, `cat-file --batch-check`.
// An unreadable answer is the empty set, which can only withhold a confirmation, never grant one.
function localCommits(cwd, shas) {
  if (!shas.length) return new Set();
  const out = gitFeed(cwd, ["--no-replace-objects", "cat-file", "--batch-check=%(objectname) %(objecttype)"], `${shas.join("\n")}\n`);
  return new Set(out.split("\n").map((l) => l.split(" ")).filter(([, type]) => type === "commit").map(([sha]) => sha));
}

// Is the tip an ancestor of (or equal to) AT LEAST ONE of these commits? ONE process: `rev-list <tip> --not <every sha>` prints
// the tip exactly when none of them reaches it, so empty output is "yes". true | false | null (git could not answer: a listed
// commit with a broken history, say; the caller then asks each commit alone, and an unanswered question never grants). Asked of
// each listed commit in turn this cost ~35 ms a sha on the shared checkout (211 Hub branches: 4-7 s for ONE unpushed branch,
// measured 2026-10-08, which doubled the whole check); asked once it is ~30 ms. Replace objects are off; the grafts guard is the caller's.
function tipReachableFromAny(cwd, tip, shas) {
  if (!shas.length) return false;
  const r = spawnSync("git", ["--no-replace-objects", "rev-list", "--stdin", "--max-count=1"], {
    cwd, encoding: "utf8", input: `${tip}\n${shas.map((s) => `^${s}`).join("\n")}\n`, stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout || "").trim() === "";
}

// What the Hub's own listing says about a local tip (the ancestry rule above isOnHubBySha):
//   holds    whether any Hub-listed commit (never this branch's own name) that is in the local store has the tip as an
//            ancestor, or IS the tip (`merge-base --is-ancestor T T` is true): tipReachableFromAny, one process.
//   holders  the NAMES behind that yes, one `merge-base --is-ancestor` per local commit; only when asked for (names: true),
//            because the seams need the yes/no and the names cost a process each (hubNamesHoldingTip, the self-test).
//   behind   only when there is NO holder: [{ name, local, hub }] for each tracking ref origin/<name> that holds the
//            tip while the Hub lists <name> at a DIFFERENT sha whose object this checkout does not have. The holder is
//            behind the Hub (or the Hub moved it sideways), the tip may be on the Hub, and only a fetch tells which.
//            A Hub sha that IS local and does not have the tip is no such cause: that is a rewind, and fetching changes nothing.
// `name === branch` is skipped because "under ANOTHER name" is what the callers ask. Neither caller can reach it with
// a holder (the unpushed seam only asks about names the Hub lacks; the same-name seam only after hubSha..tip > 0, which
// means the tip is not an ancestor of the Hub's own sha for that name), so it is a defensive equivalent and no case
// claims to test it. A Hub branch literally named HEAD is a real branch here (the map comes from ls-remote --heads).
function hubTipState(branch, hubShaMap, cwd = repo, { names = false } = {}) {
  const none = { holds: false, holders: [], behind: [] };
  if (!(hubShaMap instanceof Map)) return none;
  if (graftsBlock(cwd)) return none; // a grafts file can fake the very ancestry asked below
  const git = gitIn(cwd);
  const tip = git("rev-parse", "--verify", `refs/heads/${branch}^{commit}`); // the BRANCH, never a same-named tag
  if (!tip) return none;
  const listed = [...hubShaMap].filter(([name, sha]) => name !== branch && typeof sha === "string" && sha);
  const local = localCommits(cwd, listed.map(([, sha]) => sha));
  const present = listed.filter(([, sha]) => local.has(sha));
  const reach = tipReachableFromAny(cwd, tip, present.map(([, sha]) => sha));
  const holders = [];
  // names wanted, or the one-process answer unavailable (null): ask each local commit alone
  if (names || reach === null) {
    for (const [name, sha] of present) {
      if (gitStatus(cwd, ["merge-base", "--is-ancestor", tip, sha]) === 0) {
        holders.push(name);
        if (!names) break; // only the unknown yes/no is being settled: one holder answers it
      }
    }
  }
  const holds = reach === null ? holders.length > 0 : reach;
  if (holds) return { holds: true, holders, behind: [] };
  const behind = [];
  const rows = git("for-each-ref", "--contains", tip, "--format=%(refname:lstrip=3) %(objectname)", "refs/remotes/origin");
  for (const line of rows ? rows.split("\n") : []) {
    const i = line.lastIndexOf(" ");
    if (i < 1) continue;
    const name = line.slice(0, i), have = line.slice(i + 1), hub = hubShaMap.get(name);
    if (name === branch || name === "HEAD") continue; // origin/HEAD is a symref to a branch, not a Hub branch of its own
    if (!hub || hub === have || local.has(hub)) continue;
    behind.push({ name, local: have, hub });
  }
  return { holds: false, holders: [], behind };
}
function sameNameVerdict(branch, hubSha, hubShaMap, cwd = repo) {
  const r = aheadOfHub(branch, hubSha, cwd);
  // A grafts file: aheadOfHub cannot read the count, and "same" or "confirmed" would both be answers a
  // graft could have set. It stays a gated AHEAD (count unreadable) naming the file, never the
  // non-gated "unknown" warning: planting a file must not turn a failing row into a quiet one.
  if (r.reason) return { state: "ahead", ahead: null, reason: r.reason };
  // The Hub's own tip for this name is not in the local store: the cure is a fetch, and which wording depends on whether
  // origin/<name> exists at all. (A Hub sha that IS local and still unreadable is no fetch cause, and gets no hint.)
  if (r.state === "unknown") {
    if (!hubSha || gitIn(cwd)("cat-file", "-t", hubSha) === "commit") return r;
    const tracked = gitIn(cwd)("rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}^{commit}`);
    return { ...r, fetch: tracked ? fetchHint(branch) : unfetchedHint(branch) };
  }
  if (r.state !== "ahead") return r;
  const s = hubTipState(branch, hubShaMap, cwd);
  if (s.holds) return { state: "confirmed", ahead: r.ahead };
  return s.behind.length ? { ...r, fetch: fetchHint(s.behind[0].name) } : r;
}
// "a, b — <remedy>; c — <remedy>": the branches grouped by the remedy each needs, so one cause reads one way everywhere.
// pairs: [[branch, remedy or ""]]; the ones with no remedy of their own go first under `plainRemedy`.
function remedyGroups(pairs, plainRemedy) {
  const by = new Map(), plain = [];
  for (const [b, remedy] of pairs) {
    if (!remedy) { plain.push(b); continue; }
    if (!by.has(remedy)) by.set(remedy, []);
    by.get(remedy).push(b);
  }
  return [...(plain.length ? [`${plain.join(", ")} — ${plainRemedy}`] : []), ...[...by].map(([remedy, bs]) => `${bs.join(", ")} — ${remedy}`)].join("; ");
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
  // An ahead branch whose tip may be held by a tracking ref the Hub has moved on from: a fetch comes BEFORE any push.
  const fetchFirst = verdicts.filter((v) => v.state === "ahead" && v.fetch).map((v) => `${v.branch}: ${v.fetch}`);
  const fetchNote = fetchFirst.length ? ` (${fetchFirst.join("; ")})` : "";
  if (ahead.length) {
    return { level: "fail", title: "Local tip ahead of its same-named Hub branch", detail: `${ahead.join(", ")} — push, or confirm the remote; a name on the Hub is not the tip on the Hub${note}${why}${fetchNote}` };
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
    // refs/heads/<branch>, never the bare name (a same-named tag would win), and replace objects off like gitIn.
    const out = execFileSync("git", ["--no-replace-objects", "log", "--format=%ct", `${mainline}..${headRef(branch)}`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
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

// Pure: the branches still to be reported as unpushed after every exclusion. There is no `b !== "HEAD"`
// here: `for-each-ref refs/heads/` never yields a pseudo entry (HEAD is not under refs/heads/), so a name
// "HEAD" in this list is a REAL branch, refs/heads/HEAD, made by `git update-ref`. Round 4 filtered it out
// (a leftover from `git branch`'s `(HEAD detached at ...)` line, which no listing here reads), and real
// unpushed work on it read "all present on the Review Hub", exit 0.
function unpushedCandidates(localBranches, hubBranches, ephemeral, scratchExcluded) {
  return localBranches.filter((b) => !hubBranches.includes(b) && !ephemeral.includes(b) && !scratchExcluded.includes(b));
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

// The seam rows for the local branches, from a listing, the Hub's branch map and the exclusions already decided.
// A FUNCTION, not inline, so the self-test runs the very code the live script runs, on the listing the live
// script produces (listLocalBranches), with tags, same-named refs and broken refs in the fixture. Every
// branch is a SHORT name here (the string after refs/heads/, the same key the Hub map uses) and is
// qualified with headRef() at each git call below and in the functions it calls.
function branchSeamRows({ listing, hubBranches, hubShaMap, ephemeral, scratchExcluded, mainline = MAINLINE, cwd = repo }) {
  if (!listing.ok) return [branchListRow(listing)];
  const localBranches = listing.names;
  const git = gitIn(cwd);
  const rows = [];
  const row = (state, what, detail, gated = true) => rows.push({ state, what, detail, gated });
  const noRemote = unpushedCandidates(localBranches, hubBranches, ephemeral, scratchExcluded);
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
  // in every direction: one path whose tree entry (mode and object id) never appeared on mainline
  // since the branch forked, a path the branch removes that mainline still has, an unreadable diff
  // or entry, or any git error and the branch is still reported unpushed. "Real work is a difference,
  // and a difference can never pass this" was this comment's claim through round 5 and it was false:
  // the compare read trimmed TEXT through a reader that returned "" on any failure (two files over
  // 1 MiB, or two paths git could not name, both read "" and "" === "" cleared real work), and the
  // history walk began at mainline's first commit, so a local revert matched a blob from before the
  // branch existed. What is claimed now is narrower and checked: the branch's change counts as
  // landed only where a mainline commit made AFTER it forked carries the very same entry (or, in
  // landedByPatchId, the very same hunks). Content mainline carried and later removed still
  // counts as landed (that is the squash that was overtaken); a chmod-only change is a difference.
  // Three independent ways a branch is already safe, each REPORTED by name so the
  // exclusion is visible rather than silent: its commit is on the hub under another
  // name, or its content is in mainline (squash), or neither — and then it is work.
  const onHub = noRemote.filter((b) => isOnHubBySha(b, hubShaMap, cwd));
  const offHub = noRemote.filter((b) => !onHub.includes(b));
  const landedByBytes = offHub.filter((b) => hasLandedByContent(b, mainline, cwd));
  const landedByHunks = offHub.filter((b) => !landedByBytes.includes(b) && landedByPatchId(b, mainline, cwd));
  const landed = [...landedByBytes, ...landedByHunks];
  const unpushed = offHub.filter((b) => !landed.includes(b));
  const ephemeralNote = ephemeral.length ? ` (${ephemeral.length} ephemeral agent-worktree branch(es) not counted)` : "";
  const onHubNote = onHub.length ? ` (${onHub.length} on the hub under another name: ${onHub.join(", ")})` : "";
  // A grafts file switches the alias exemption OFF (hubNamesHoldingTip names no holder under one), and a row that
  // silently stopped clearing aliases would look like the branches themselves had changed. So it says why.
  const graftsReason = noRemote.length ? graftsBlock(cwd) : "";
  const graftsNote = graftsReason ? ` (alias exemption OFF: ${graftsReason})` : "";
  // A warning git printed while listing the refs that is NOT a ref-skip one (see listLocalBranches) did not change the
  // verdict, and it is named here so nothing git said is thrown away: the first three, then a count.
  const warns = listing.warnings || [];
  const warnNote = warns.length ? ` (git warned while listing branches, verdict unaffected: ${warns.slice(0, 3).join(" | ")}${warns.length > 3 ? ` | +${warns.length - 3} more` : ""})` : "";
  const landedNote =
    (landedByBytes.length ? ` (${landedByBytes.length} squash-landed, every file byte-identical to a mainline blob: ${landedByBytes.join(", ")})` : "") +
    (landedByHunks.length ? ` (${landedByHunks.length} squash-landed, exact hunks found in a mainline squash: ${landedByHunks.join(", ")})` : "");
  if (unpushed.length) {
    // A branch the Hub may hold under a name this checkout has not caught up with is still a gated failure, and its
    // remedy is a fetch, not a push (hubFetchCauses). Grouped by remedy so one cause reads one way.
    const remedyOf = (b) => { const c = hubFetchCauses(b, hubShaMap, cwd); return c.length ? fetchHint(c[0].name) : ""; };
    const groups = remedyGroups(unpushed.map((b) => [b, remedyOf(b)]), "push, or confirm the remote");
    row("fail", "Local work not on the Review Hub", `${groups}${ephemeralNote}${onHubNote}${landedNote}${graftsNote}${warnNote}`);
  } else {
    row("ok", "Local branches all present on the Review Hub", `${localBranches.length - ephemeral.length} branch(es)${ephemeralNote}${onHubNote}${landedNote}${graftsNote}${warnNote}`);
  }

  // A branch whose NAME is on the Hub is not thereby ON the Hub: the local tip may be ahead.
  // (No `b !== "HEAD"`: see unpushedCandidates. A real refs/heads/HEAD with a Hub branch of that name is compared like any other.)
  const sameNamed = localBranches.filter((b) => hubBranches.includes(b) && !ephemeral.includes(b));
  // No Hub sha map is no Hub: every same-named branch is then an unanswerable comparison, reported as the gated AHEAD it must be
  // (count unreadable, the cause named) rather than a TypeError on `.get` that takes the whole check down with it.
  const mapOk = hubShaMap instanceof Map;
  const verdicts = sameNamed.map((b) => mapOk
    ? { branch: b, ...sameNameVerdict(b, hubShaMap.get(b), hubShaMap, cwd) }
    : { branch: b, state: "ahead", ahead: null, reason: "no Hub sha map was passed — the same-name comparison did not run" });
  const unknownV = verdicts.filter((v) => v.state === "unknown");
  const sameRow = sameNameRows(verdicts);
  row(sameRow.level, sameRow.title, sameRow.detail);
  if (unknownV.length) {
    // The same cause as the unpushed row's (a tracking ref behind the Hub) reads the same way: fetchHint / unfetchedHint.
    row("warn", "Same-named branches whose Hub tip is not fetched locally",
      remedyGroups(unknownV.map((v) => [v.branch, v.fetch || ""]), "cannot tell ahead from behind; reported, not counted clean"), false);
  }
  // REPORTED, never fatal — the lane-message rule, for the same reason. The work is not lost (the worktree
  // belongs to a live agent, and anything real is pushed from it), but an agent branch carrying commits
  // beyond mainline is still worth a session's eyes, so it is named rather than swallowed by the exclusion above.
  const carrying = ephemeral
    .filter((b) => !hubBranches.includes(b))
    // Commits reachable from the branch and from NO origin ref at all — a truer
    // reading of "carrying work the remote does not have" than a diff against one
    // named branch, which would miscount a branch cut from a different base.
    .map((b) => ({ b, ahead: git("rev-list", "--count", headRef(b), "--not", "--remotes=origin") }))
    .filter((x) => x.ahead && x.ahead !== "0");
  if (carrying.length) {
    row(
      "warn",
      "Agent-worktree branches carrying commits",
      `${carrying.map((x) => `${x.b} (+${x.ahead})`).join(", ")} — reported, never fatal: they belong to a live agent's ` +
        `isolated checkout and are not the session's to push or delete. An attack reproduction MUST NOT be pushed.`,
      false,
    );
  }
  return rows;
}

if (hubBranches.length && listing.ok) {
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
  for (const r of branchSeamRows({ listing, hubBranches, hubShaMap: hubSha, ephemeral, scratchExcluded: scratch.excluded })) {
    add(r.state, r.what, r.detail, r.gated);
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
    newest = execFileSync("git", ["log", "-1", "--format=%cI", MAINLINE], { cwd: repo, encoding: "utf8" }).trim();
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
  const hubMapOf = (h) => new Map(execFileSync("git", ["ls-remote", "--heads", h], { encoding: "utf8" }).split("\n").filter(Boolean)
    .map((l) => l.split(/\s+/)).filter((p) => p[1] && p[1].startsWith("refs/heads/")).map(([sha, ref]) => [ref.slice("refs/heads/".length), sha]));
  const hubMap = () => hubMapOf(hub);
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
    check("a branch that does not resolve is never confirmed (d-alias-fail-closed2)", isOnHubBySha("no-such-branch", hubMap(), work) === false);
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
    const g2n = hubNamesHoldingTip("g1x", hubMap(), work); // called directly, under the grafts file
    unlinkSync(graftsFile);
    check("a grafts file that makes origin/g1o a parent of the unpushed tip is not confirmed, and the row reason names the file (d-G2)",
      g2raw && g2v.state === "ahead" && g2v.ahead === null && String(g2v.reason).includes(graftsFile) && /graft file present/.test(g2v.reason));
    check("aheadOfHub under a grafts file reads unknown with the file named, never same (d-G2b)",
      g2a.state === "unknown" && String(g2a.reason).includes(graftsFile));
    check("hubNamesHoldingTip itself names no holder while a grafts file is in force, not only the verdict above it (d-G2l)", g2raw && g2n.length === 0);
    const g2r = sameNameRows([{ branch: "g1x", ...g2v }]);
    check("the fail row carries the reason and prints no invented count (d-G2c)", g2r.level === "fail" && g2r.detail.startsWith("g1x (count unreadable)") && g2r.detail.includes(graftsFile));
    check("with the grafts file removed the same branch reads ahead by one and carries no reason (d-G2d)", !existsSync(graftsFile) && verdictOf("g1x").ahead === 1 && !verdictOf("g1x").reason);
    // (d-G2e) GIT_GRAFT_FILE points git at a grafts file anywhere: the guard must read what git would read
    const envGrafts = join(root, "env-grafts"); writeFileSync(envGrafts, `${g1o} ${g1t}\n`); process.env.GIT_GRAFT_FILE = envGrafts;
    let g2e; try { g2e = verdictOf("g1x"); } finally { delete process.env.GIT_GRAFT_FILE; }
    check("a grafts file named by GIT_GRAFT_FILE blocks confirmation and is named (d-G2e)", g2e.state === "ahead" && String(g2e.reason).includes(envGrafts));
    // (d-G2f..k) every other shape of "is a grafts file in force", each beside what git ITSELF does: rawApplied() is true only while
    // `git for-each-ref --contains` lists origin/g1o as holding the unpushed g1t, i.e. while git applies the graft. Measured on git 2.43.
    const rawApplied = (cwd = work) => execFileSync("git", ["for-each-ref", "--contains", g1t, "--format=%(refname:lstrip=3)", "refs/remotes/origin"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").includes("g1o");
    const withEnv = (v, fn) => { process.env.GIT_GRAFT_FILE = v; try { return fn(); } finally { delete process.env.GIT_GRAFT_FILE; } };
    // (d-G2f) a 0-byte grafts file: git opens it and applies nothing, so it is no block (it used to read "graft file present" and fail the row)
    writeFileSync(graftsFile, "");
    const g2f = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a 0-byte grafts file applies no graft in git and is no block: the verdict reads ahead by one with no reason (d-G2f)",
      g2f.raw === false && g2f.st.state === "empty" && g2f.st.block === false && graftsBlock(work) === "" && g2f.v.state === "ahead" && g2f.v.ahead === 1 && !g2f.v.reason);
    // (d-G2g) the path is a directory: git warns and applies nothing
    mkdirSync(graftsFile);
    const g2g = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; rmSync(graftsFile, { recursive: true });
    check("a directory at the grafts path applies no graft in git and is no block (d-G2g)",
      g2g.raw === false && g2g.st.state === "directory" && g2g.st.block === false && g2g.v.state === "ahead" && g2g.v.ahead === 1 && !g2g.v.reason);
    // (d-G2h) a comment-only file: git applies nothing from it either, but a file with content is not parsed here, so it BLOCKS (documented, conservative)
    writeFileSync(graftsFile, "# nothing to see\n");
    const g2h = { raw: rawApplied(), st: graftsState(work) }; unlinkSync(graftsFile);
    check("a comment-only grafts file applies no graft in git yet blocks here: a file with content is not reimplemented-parsed, unknown tightens (d-G2h)",
      g2h.raw === false && g2h.st.state === "present" && g2h.st.block === true && String(g2h.st.reason).includes(graftsFile));
    // (d-G2i) GIT_GRAFT_FILE='' switches grafts off in git EVEN over a real info/grafts: no block, and the state says so (it used to name the worktree directory)
    writeFileSync(graftsFile, `${g1o} ${g1t}\n`);
    const g2iBefore = rawApplied();
    const g2i = withEnv("", () => ({ raw: rawApplied(), st: graftsState(work), blk: graftsBlock(work), v: verdictOf("g1x") })); unlinkSync(graftsFile);
    check("GIT_GRAFT_FILE='' disables grafts in git over a real info/grafts file; here it is no block and says grafts are disabled (d-G2i)",
      g2iBefore === true && g2i.raw === false && g2i.st.state === "disabled" && g2i.blk === "" && /GIT_GRAFT_FILE=''/.test(g2i.st.note) && g2i.v.state === "ahead" && g2i.v.ahead === 1 && !g2i.v.reason);
    // (d-G2j) git's own off switches: /dev/null, and a path that does not exist (while a real info/grafts sits at the default place)
    writeFileSync(graftsFile, `${g1o} ${g1t}\n`);
    const g2j = ["/dev/null", join(root, "no-such-grafts")].map((v) => withEnv(v, () => ({ raw: rawApplied(), blk: graftsBlock(work) }))); unlinkSync(graftsFile);
    check("GIT_GRAFT_FILE=/dev/null and GIT_GRAFT_FILE=<nonexistent> switch grafts off in git, and are no block here (d-G2j)", g2j.every((o) => o.raw === false && o.blk === ""));
    // (d-G2k) a RELATIVE GIT_GRAFT_FILE asked from a subdirectory: git reads it from the top of the worktree and `--git-path` prints it
    // relative to the caller, so only git's own answer finds the file (the raw env value resolved against the subdirectory and read "none")
    const relGrafts = join(work, "rel-grafts"), subDir = join(work, "sub"); mkdirSync(subDir); writeFileSync(relGrafts, `${g1o} ${g1t}\n`);
    const g2k = withEnv("rel-grafts", () => ({ raw: rawApplied(subDir), fromSub: graftsBlock(subDir), fromTop: graftsBlock(work) })); unlinkSync(relGrafts); rmSync(subDir, { recursive: true });
    check("a relative GIT_GRAFT_FILE asked from a subdirectory finds the file git applies, and names it (d-G2k)",
      g2k.raw === true && g2k.fromSub.includes(relGrafts) && g2k.fromTop.includes(relGrafts));
    // (d-G2m..r) the remaining shapes graftsState's comment lists, each compared with git ITSELF through rawApplied(). A mutant that
    // treats a symlinked grafts file as absent (lstat instead of stat) passes every case above and fails d-G2n.
    const gs_m0 = rawApplied(); // the absent baseline: no file at the default place, git applies none
    // (d-G2m) a DANGLING symlink: git cannot open it and applies nothing
    symlinkSync(join(root, "no-such-target"), graftsFile);
    const gs_m = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("an absent grafts file and a dangling symlink at its place both apply no graft in git and are no block (d-G2m)",
      gs_m0 === false && gs_m.raw === false && gs_m.st.block === false && gs_m.st.state === "absent" && gs_m.v.state === "ahead" && gs_m.v.ahead === 1 && !gs_m.v.reason);
    // (d-G2n) a SYMLINK to a real grafts file: git follows it and APPLIES the graft, so it must block
    const linkTarget = join(root, "grafts-link-target"); writeFileSync(linkTarget, `${g1o} ${g1t}\n`); symlinkSync(linkTarget, graftsFile);
    const gs_n = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a symlink to a grafts file is followed by git and blocks here, with the file named (d-G2n)",
      gs_n.raw === true && gs_n.st.block === true && gs_n.st.state === "present" && gs_n.v.state === "ahead" && gs_n.v.ahead === null && String(gs_n.v.reason).includes(graftsFile));
    // (d-G2o) a whitespace-only file: git applies none, and here a file with content blocks (documented, conservative)
    writeFileSync(graftsFile, "  \n\t\n\n");
    const gs_o = { raw: rawApplied(), st: graftsState(work) }; unlinkSync(graftsFile);
    check("a whitespace-only grafts file applies no graft in git yet blocks here, like a comment-only one (d-G2o)", gs_o.raw === false && gs_o.st.state === "present" && gs_o.st.block === true);
    // (d-G2p) CRLF line endings: git still reads the line, so it must block
    writeFileSync(graftsFile, `${g1o} ${g1t}\r\n`);
    const gs_p = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a CRLF grafts file is applied by git and blocks here (d-G2p)", gs_p.raw === true && gs_p.st.block === true && gs_p.v.state === "ahead" && gs_p.v.ahead === null);
    // (d-G2q) a comment line followed by a real graft line: git applies the graft, so it must block
    writeFileSync(graftsFile, `# a comment\n${g1o} ${g1t}\n`);
    const gs_q = { raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }; unlinkSync(graftsFile);
    check("a comment line followed by a graft line is applied by git and blocks here (d-G2q)", gs_q.raw === true && gs_q.st.block === true && gs_q.v.state === "ahead" && gs_q.v.ahead === null);
    // (d-G2r) GIT_GRAFT_FILE naming ANOTHER repository's grafts file, while this repository has none of its own
    const otherRepo = join(root, "other-repo"); execFileSync("git", ["init", "-q", otherRepo]);
    const otherGrafts = join(otherRepo, ".git", "info", "grafts"); mkdirSync(join(otherRepo, ".git", "info"), { recursive: true }); writeFileSync(otherGrafts, `${g1o} ${g1t}\n`);
    const gs_r = withEnv(otherGrafts, () => ({ raw: rawApplied(), st: graftsState(work), v: verdictOf("g1x") }));
    check("a GIT_GRAFT_FILE naming another repository's grafts is applied by git and blocks here, with that file named (d-G2r)",
      !existsSync(graftsFile) && gs_r.raw === true && gs_r.st.block === true && String(gs_r.v.reason).includes(otherGrafts));
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
      raw("branch", "-r", "--contains", raw("rev-parse", "tc^{commit}")).includes("origin/main") && isOnHubBySha("tc", hubMap(), work) === false);
    sh("tag", "-d", "tc");
    // (d-rows) the row text names a confirmed branch, and the title says what the ok row covers (M5)
    const rowsOk = sameNameRows([{ branch: "b-same", state: "same", ahead: 0 }, { branch: "claude/conf-branch", state: "confirmed", ahead: 3 }, { branch: "b-unk", state: "unknown" }]);
    check("the ok row names the confirmed branch and counts the compared ones (d-rows)",
      rowsOk.level === "ok" && rowsOk.detail.includes("claude/conf-branch") && rowsOk.detail.startsWith("2 branch(es) compared by sha") && /confirmed on the Hub under another branch/.test(rowsOk.title));
    const rowsFail = sameNameRows([{ branch: "claude/conf-branch", state: "confirmed", ahead: 3 }, { branch: "x-ahead", state: "ahead", ahead: 2 }]);
    check("the fail row names the ahead branch with its count and still names the confirmed one (d-rows-fail)",
      rowsFail.level === "fail" && rowsFail.detail.startsWith("x-ahead (+2)") && rowsFail.detail.includes("claude/conf-branch"));
    check("with nothing confirmed the row carries no confirmed note (d-rows-none)", !/confirmed/.test(sameNameRows([{ branch: "b", state: "same", ahead: 0 }]).detail));
    // ── The inputs the CALLER produces. Every case below builds its own repository and Hub, lists the branches with
    // listLocalBranches and builds the rows with branchSeamRows: the very code the live script runs, so a tag, a same-named
    // ref or a broken ref changes the listing exactly as it would live. (Round 3's cases handed the guards inputs the live
    // caller never produced, which is how a listing that shortened a branch to `heads/<name>` went unnoticed.)
    const FX_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    const mkFx = (name) => {
      const dir = join(root, name), w = join(dir, "work"), h = join(dir, "hub.git");
      mkdirSync(dir);
      execFileSync("git", ["init", "-q", "--bare", h]);
      execFileSync("git", ["init", "-q", "-b", "main", w]);
      const f = (...a) => execFileSync("git", a, { cwd: w, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: FX_ENV }).trim();
      const c = (file, text, msg = file) => { writeFileSync(join(w, file), text); f("add", "-A"); f("commit", "-q", "-m", msg); return f("rev-parse", "HEAD"); };
      f("remote", "add", "origin", h);
      c("base.txt", "base\n"); f("push", "-q", "origin", "main");
      const rows = (extra = {}) => { const m = hubMapOf(h); return branchSeamRows({ listing: listLocalBranches(w), hubBranches: [...m.keys()], hubShaMap: m, ephemeral: [], scratchExcluded: [], mainline: "refs/remotes/origin/main", cwd: w, ...extra }); };
      return { w, h, f, c, rows };
    };
    const rowOf = (rs, what) => rs.find((x) => x.what === what);
    const T_UNPUSHED = "Local work not on the Review Hub", T_CLEAN = "Local branches all present on the Review Hub", T_AHEAD = "Local tip ahead of its same-named Hub branch";
    const shortNames = (fx) => fx.f("branch", "--format=%(refname:short)").split("\n"); // what round 3 listed
    // (E1) a branch exactly at its Hub tip, and a tag with its name: git shortens the branch to heads/v1
    const e1 = mkFx("e1");
    e1.f("checkout", "-q", "-b", "v1"); e1.c("rel.txt", "1\n"); e1.f("push", "-q", "origin", "v1"); e1.f("tag", "v1");
    const e1l = listLocalBranches(e1.w), e1r = e1.rows();
    check("a branch at its Hub tip with a same-named tag is listed by its real name, and both rows stay clean (E1)",
      shortNames(e1).includes("heads/v1") && e1l.ok && e1l.names.includes("v1") && !e1l.names.includes("heads/v1") &&
      e1r.length === 2 && e1r.every((x) => x.state === "ok") && /^2 branch\(es\) compared by sha/.test(e1r[1].detail));
    // (E2a) real unpushed work on refs/heads/X, a tag X, and a Hub branch literally named heads/X
    const e2a = mkFx("e2a");
    e2a.f("push", "-q", "origin", "main:refs/heads/heads/X"); e2a.f("fetch", "-q", "origin");
    e2a.f("checkout", "-q", "-b", "X"); e2a.c("work.txt", "real unpushed work\n"); e2a.f("tag", "X", "main");
    const e2aU = rowOf(e2a.rows(), T_UNPUSHED);
    check("real unpushed work on refs/heads/X beside a Hub branch named heads/X and a tag X is a gated failure naming X (E2a)",
      shortNames(e2a).includes("heads/X") && listLocalBranches(e2a.w).names.includes("X") && !!e2aU && e2aU.state === "fail" && e2aU.gated === true && e2aU.detail.split(" — ")[0] === "X");
    // (E2b) the same, with a LOCAL branch heads/X too (it is at the Hub's heads/X): X is still the only unpushed name
    const e2b = mkFx("e2b");
    e2b.f("push", "-q", "origin", "main:refs/heads/heads/X"); e2b.f("fetch", "-q", "origin"); e2b.f("branch", "heads/X", "main");
    e2b.f("checkout", "-q", "-b", "X"); e2b.c("work.txt", "real unpushed work\n"); e2b.f("tag", "X", "main");
    const e2bR = e2b.rows(), e2bU = rowOf(e2bR, T_UNPUSHED);
    check("with a local branch heads/X as well, X alone is reported unpushed and heads/X compares clean (E2b)",
      !!e2bU && e2bU.state === "fail" && e2bU.detail.split(" — ")[0] === "X" && rowOf(e2bR, "Same-named branches at or behind their Hub tip, or confirmed on the Hub under another branch").state === "ok");
    // (G3-live) tag tg on a commit the Hub holds under another name; branch tg two ahead of the Hub's tg
    const g3l = mkFx("g3live");
    g3l.f("checkout", "-q", "-b", "tg"); g3l.f("push", "-q", "origin", "tg"); const g3lA = g3l.c("A.txt", "1\n"); g3l.f("push", "-q", "origin", "tg:refs/heads/tg-other");
    g3l.f("tag", "tg", g3lA); g3l.c("U.txt", "2\n");
    const g3lR = g3l.rows(), g3lA2 = rowOf(g3lR, T_AHEAD);
    check("a tag on a Hub-held commit named like a branch two ahead: the same-name row fails with +2, never confirmed, never landed (G3-live)",
      shortNames(g3l).includes("heads/tg") && !!g3lA2 && g3lA2.state === "fail" && g3lA2.detail.startsWith("tg (+2)") &&
      !/but confirmed on the Hub under another branch/.test(g3lA2.detail) && !/squash-landed/.test(JSON.stringify(g3lR)));
    // (caution-bytes) a local-only branch with real work; a tag with its name on the ORIGINAL commit of a squash-merged change whose bytes are in mainline.
    const cauA = mkFx("cautionA");
    cauA.f("checkout", "-q", "--detach"); const cauAz = cauA.c("f.txt", "landed\n"); cauA.f("tag", "X", cauAz);
    cauA.f("checkout", "-q", "main"); cauA.c("f.txt", "landed\n", "squash of f"); cauA.f("push", "-q", "origin", "main");
    cauA.f("branch", "probe", cauAz); const cauAprobe = hasLandedByContent("probe", "refs/remotes/origin/main", cauA.w); cauA.f("branch", "-q", "-D", "probe");
    cauA.f("checkout", "-q", "-b", "X", cauAz); cauA.c("g.txt", "real work, not in mainline\n");
    const cauAu = rowOf(cauA.rows(), T_UNPUSHED);
    check("a tag named like a local-only branch, on a commit whose bytes are in mainline, does not clear the branch's real work as squash-landed (caution-bytes)",
      cauAprobe === true && cauA.f("diff", "--name-only", "refs/remotes/origin/main...X") === "f.txt" && !!cauAu && cauAu.state === "fail" && cauAu.detail.split(" — ")[0] === "X" && !/squash-landed/.test(cauAu.detail));
    // (caution-hunks) the same for the exact-hunk check: the tag sits on the original commit of a squash whose shared file mainline also moved
    const cauB = mkFx("cautionB");
    const shared0 = "- row 1\n- row 2\n- row 3\n- row 4\n- row 5\n- row 6\n", sharedMain = "- row 1\n- row 2 (main moved)\n- row 3\n- row 4\n- row 5\n- row 6\n";
    cauB.c("shared.md", shared0); cauB.f("push", "-q", "origin", "main");
    cauB.f("checkout", "-q", "--detach"); const cauBz = cauB.c("shared.md", `${shared0}- row 7 (feat)\n`); cauB.f("tag", "X", cauBz);
    cauB.f("checkout", "-q", "main"); cauB.c("shared.md", sharedMain); cauB.c("shared.md", `${sharedMain}- row 7 (feat)\n`, "squash of feat"); cauB.f("push", "-q", "origin", "main");
    cauB.f("branch", "probe", cauBz); const cauBprobe = landedByPatchId("probe", "refs/remotes/origin/main", cauB.w); cauB.f("branch", "-q", "-D", "probe");
    cauB.f("checkout", "-q", "-b", "X", cauBz); cauB.c("g.txt", "real work, not in mainline\n");
    const cauBu = rowOf(cauB.rows(), T_UNPUSHED);
    check("a tag named like a local-only branch, on a commit whose hunks are a mainline squash, does not clear the branch's real work (caution-hunks)",
      cauBprobe === true && !!cauBu && cauBu.state === "fail" && cauBu.detail.split(" — ")[0] === "X" && !/squash-landed/.test(cauBu.detail));
    // (m-tag) MAINLINE is a full refname: a local tag named origin/main outranks the remote-tracking ref in a bare resolution
    const mt = mkFx("mltag");
    mt.f("checkout", "-q", "--detach"); mt.c("q.txt", "same bytes\n", "tag side"); mt.f("tag", "origin/main");
    mt.f("checkout", "-q", "-b", "X", "main"); mt.c("q.txt", "same bytes\n", "branch side");
    check("a tag named like the remote-tracking mainline cannot stand in for it: the bare name is shown to lie, the full refname is not fooled, and MAINLINE is a full refname (m-tag)",
      hasLandedByContent("X", "origin/main", mt.w) === true && hasLandedByContent("X", "refs/remotes/origin/main", mt.w) === false && MAINLINE.startsWith("refs/remotes/origin/"));
    // (E-broken) for-each-ref SKIPS a broken ref with only a warning on stderr and exits 0
    const eb = mkFx("ebroken");
    eb.f("branch", "brk"); writeFileSync(join(eb.w, ".git", "refs", "heads", "brk"), "garbage\n");
    const ebL = listLocalBranches(eb.w), ebR = eb.rows();
    check("a branch ref git cannot read is an unreadable listing (a gated failing row), not a branch that is not there (E-broken)",
      ebL.ok === false && /broken ref/.test(String(ebL.error)) && ebR.length === 1 && ebR[0].state === "fail" && ebR[0].gated === true && ebR[0].what === "Local branch list unreadable");
    // (E-listfail) git failing outright
    process.env.GIT_DIR = join(root, "no-such-git-dir");
    let lf; try { lf = listLocalBranches(eb.w); } finally { delete process.env.GIT_DIR; }
    const lfRows = branchSeamRows({ listing: lf, hubBranches: ["main"], hubShaMap: new Map(), ephemeral: [], scratchExcluded: [] });
    check("a failed branch listing is a gated failing row 'Local branch list unreadable', never an empty clean list (E-listfail)",
      lf.ok === false && lf.names.length === 0 && lfRows.length === 1 && lfRows[0].state === "fail" && lfRows[0].gated === true && lfRows[0].what === "Local branch list unreadable" &&
      branchListRow(lf).gated === true && branchListRow(listLocalBranches(eb.w.replace("ebroken", "e1"))) === null);
    // (E-carry) an ephemeral agent-worktree branch with a commit no origin ref holds, and a tag named like it on a Hub-held commit:
    // the bare name would count the tag's history (zero) and the warning would never name the branch
    const ecar = mkFx("ecarry");
    ecar.f("checkout", "-q", "-b", "eph"); ecar.c("eph.txt", "agent work\n"); ecar.f("tag", "eph", "main"); ecar.f("checkout", "-q", "main");
    const ecarRow = rowOf(ecar.rows({ ephemeral: ["eph"] }), "Agent-worktree branches carrying commits");
    check("an agent-worktree branch carrying a commit no origin ref holds is named with its count although a tag shares its name (E-carry)",
      !!ecarRow && ecarRow.state === "warn" && ecarRow.gated === false && ecarRow.detail.startsWith("eph (+1)"));
    // (R1-HEAD) a REAL branch refs/heads/HEAD (git update-ref makes one; for-each-ref refs/heads/ yields it as the bare name HEAD)
    // with unpushed work. Round 4 filtered the name out of the unpushed list, so this read "all present on the Review Hub", exit 0.
    const hh = mkFx("headhead");
    hh.f("checkout", "-q", "-b", "side"); const hhTip = hh.c("hh.txt", "real unpushed work\n"); hh.f("update-ref", "refs/heads/HEAD", hhTip);
    hh.f("checkout", "-q", "main"); hh.f("branch", "-q", "-D", "side");
    const hhL = listLocalBranches(hh.w), hhU = rowOf(hh.rows(), T_UNPUSHED);
    check("unpushed work on a branch literally named HEAD (refs/heads/HEAD) is a gated failure naming HEAD (R1-HEAD)",
      hhL.ok && hhL.names.includes("HEAD") && !!hhU && hhU.state === "fail" && hhU.gated === true && hhU.detail.split(" — ")[0] === "HEAD");
    // (R1-HEAD2) the same name on BOTH sides: the Hub has a branch HEAD and the local one is a commit ahead of it
    const hh2 = mkFx("headhead2");
    hh2.f("push", "-q", "origin", "main:refs/heads/HEAD");
    hh2.f("checkout", "-q", "-b", "side"); const hh2Tip = hh2.c("hh2.txt", "ahead of the Hub's HEAD\n"); hh2.f("update-ref", "refs/heads/HEAD", hh2Tip);
    hh2.f("checkout", "-q", "main"); hh2.f("branch", "-q", "-D", "side");
    const hh2A = rowOf(hh2.rows(), T_AHEAD);
    check("a local branch HEAD one commit ahead of a Hub branch HEAD is a gated same-name failure, +1 (R1-HEAD2)",
      hubMapOf(hh2.h).has("HEAD") && !!hh2A && hh2A.state === "fail" && hh2A.gated === true && hh2A.detail.startsWith("HEAD (+1)"));
    // (R2-warn) a deprecated config key prints a warning on EVERY git command and exits 0: it must not fail the listing, and must be named
    const wn = mkFx("warnbenign");
    wn.f("branch", "-q", "side-ok"); wn.f("push", "-q", "origin", "side-ok");
    // Runs fn with git config pairs set through GIT_CONFIG_COUNT/KEY_n/VALUE_n, then puts back what those variables held BEFORE
    // (the harness this runs under exports its own GIT_CONFIG_*), never deletes them.
    const withGitConfig = (pairs, fn) => {
      const keys = ["GIT_CONFIG_COUNT", ...pairs.flatMap((_, i) => [`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`])], prior = keys.map((k) => process.env[k]);
      process.env.GIT_CONFIG_COUNT = String(pairs.length);
      pairs.forEach(([k, v], i) => { process.env[`GIT_CONFIG_KEY_${i}`] = k; process.env[`GIT_CONFIG_VALUE_${i}`] = v; });
      try { return fn(); } finally { keys.forEach((k, i) => { if (prior[i] === undefined) delete process.env[k]; else process.env[k] = prior[i]; }); }
    };
    const withFsync = (fn) => withGitConfig([["core.fsyncObjectFiles", "true"]], fn);
    const wnPlain = listLocalBranches(wn.w);
    const wnL = withFsync(() => listLocalBranches(wn.w)), wnC = withFsync(() => rowOf(wn.rows(), T_CLEAN));
    check("a benign git warning (deprecated core.fsyncObjectFiles) leaves the listing ok and the verdict clean, and the row names the warning (R2-warn)",
      wnPlain.ok && wnPlain.warnings.length === 0 && wnL.ok && wnL.names.includes("side-ok") && wnL.warnings.some((w) => /core\.fsyncObjectFiles is deprecated/.test(w)) &&
      !!wnC && wnC.state === "ok" && /git warned while listing branches, verdict unaffected: warning: core\.fsyncObjectFiles is deprecated/.test(wnC.detail));
    // (R2-warn2) ...and the same warning does NOT mask a broken ref: the ref-skip warning still fails the listing
    const wb = mkFx("warnbroken");
    wb.f("branch", "brk"); writeFileSync(join(wb.w, ".git", "refs", "heads", "brk"), "garbage\n");
    const wbL = withFsync(() => listLocalBranches(wb.w));
    check("with a benign warning ALSO printed, a broken ref is still an unreadable listing (R2-warn2)", wbL.ok === false && /ignoring broken ref/.test(String(wbL.error)));
    // (R3-graft) real unpushed work Y; the Hub's `other` is made to "contain" Y by a grafts file; `git branch -r --contains` then says Y is on origin/other
    const gu = mkFx("graftunpushed");
    gu.f("checkout", "-q", "-b", "other"); const guO = gu.c("o.txt", "o\n"); gu.f("push", "-q", "origin", "other");
    gu.f("checkout", "-q", "-b", "Y", "main"); const guT = gu.c("y.txt", "real unpushed work\n");
    const guGrafts = join(gu.w, ".git", "info", "grafts"); writeFileSync(guGrafts, `${guO} ${guT}\n`);
    const guLie = gu.f("branch", "-r", "--contains", guT).split("\n").map((l) => l.trim()).includes("origin/other");
    const guRows = gu.rows(), guU = rowOf(guRows, T_UNPUSHED); unlinkSync(guGrafts);
    check("a grafts file that makes origin/other contain unpushed work does not clear it as 'on the hub under another name': a gated failure naming Y, with the grafts file as the reason (R3-graft)",
      guLie && !!guU && guU.state === "fail" && guU.gated === true && guU.detail.split(" — ")[0] === "Y" && !/on the hub under another name/.test(guU.detail) &&
      /alias exemption OFF: graft file present/.test(guU.detail) && guU.detail.includes(guGrafts));
    // (R3-pr999) a hand-made refs/remotes/pr/999 at the unpushed tip: the shared checkout carries refs/remotes/pr/* refs (count them: git for-each-ref refs/remotes/pr/)
    const pr = mkFx("pr999");
    pr.f("checkout", "-q", "-b", "Y"); const prT = pr.c("y.txt", "real unpushed work\n"); pr.f("update-ref", "refs/remotes/pr/999", prT);
    const prLie = pr.f("branch", "-r", "--contains", prT).includes("pr/999"), prU = rowOf(pr.rows(), T_UNPUSHED);
    check("a hand-made refs/remotes/pr/999 holding the tip does not clear unpushed work: a gated failure naming Y (R3-pr999)",
      prLie && !!prU && prU.state === "fail" && prU.gated === true && prU.detail.split(" — ")[0] === "Y" && !/on the hub under another name/.test(prU.detail));
    // (R3-alias) the LEGITIMATE alias still clears and is named: pr782 at the tip of Hub branch `other` (local origin/other fetched, at the Hub's sha)
    const al = mkFx("aliasok");
    al.f("checkout", "-q", "-b", "other"); al.c("o.txt", "o\n"); al.f("push", "-q", "origin", "other"); al.f("fetch", "-q", "origin");
    al.f("checkout", "-q", "-b", "pr782", "other");
    const alR = al.rows(), alC = rowOf(alR, T_CLEAN);
    check("a branch whose tip is on the Hub under another name, at the Hub's own sha, is still cleared and named (R3-alias)",
      !!alC && alC.state === "ok" && /\(1 on the hub under another name: pr782\)/.test(alC.detail) && !rowOf(alR, T_UNPUSHED));
    // (R3-alias-stale) the same branch after the Hub REWOUND `other` below the tip while local origin/other kept the old sha: no longer cleared
    const as = mkFx("aliasstale");
    as.f("checkout", "-q", "-b", "other"); const asO1 = as.c("o1.txt", "1\n"); as.c("o2.txt", "2\n"); as.f("push", "-q", "origin", "other"); as.f("fetch", "-q", "origin");
    as.f("checkout", "-q", "-b", "pr782", "other");
    execFileSync("git", ["-C", as.h, "update-ref", "refs/heads/other", asO1], { stdio: "ignore" });
    const asU = rowOf(as.rows(), T_UNPUSHED);
    check("a branch whose only holder is a local origin/other the Hub has since rewound is a gated failure naming it (R3-alias-stale)",
      as.f("rev-parse", "refs/remotes/origin/other") !== hubMapOf(as.h).get("other") && !!asU && asU.state === "fail" && asU.gated === true && asU.detail.split(" — ")[0] === "pr782" &&
      // the Hub's rewound sha IS local and does not hold the tip: a fetch changes nothing, so the remedy stays the push/confirm one
      /push, or confirm the remote/.test(asU.detail) && !asU.detail.includes("git fetch origin"));
    // (R4-M1) a local-only branch whose name contains a slash and begins `tags/`: the bare name `tags/rel` resolves refs/tags/rel (the DWIM rule
    // refs/<name>), the tag, so a headRef that qualifies only names WITHOUT a slash lets the tag's squash-landed commit clear the branch's real work
    const m1 = mkFx("m1slash");
    m1.f("checkout", "-q", "--detach"); const m1z = m1.c("f.txt", "landed\n"); m1.f("tag", "rel", m1z);
    m1.f("checkout", "-q", "main"); m1.c("f.txt", "landed\n", "squash of f"); m1.f("push", "-q", "origin", "main");
    m1.f("checkout", "-q", "-b", "tags/rel", m1z); m1.c("g.txt", "real work, not in mainline\n");
    const m1Rows = m1.rows(), m1U = rowOf(m1Rows, T_UNPUSHED);
    check("a local-only branch tags/rel with real work beside a tag rel on a squash-landed commit is not cleared as squash-landed: headRef qualifies names with a slash too (R4-M1)",
      m1.f("rev-parse", "tags/rel^{commit}") === m1z && headRef("tags/rel") === "refs/heads/tags/rel" && !!m1U && m1U.state === "fail" && m1U.gated === true &&
      m1U.detail.split(" — ")[0] === "tags/rel" && !/squash-landed/.test(JSON.stringify(m1Rows)));
    // ══ ROUND 6 ══ The refuter's p1a-p1g fixtures, rebuilt here beside the rows they must change. Each case states its own
    // precondition (the lie really is on offer in the fixture) before the guarded answer is checked.
    const R6M = "refs/remotes/origin/main", T_UNKNOWN = "Same-named branches whose Hub tip is not fetched locally";
    const FETCH = (n) => `origin/${n} is behind the Hub: run git fetch origin, then re-run`;
    // The Hub moves <name> forward by one commit WITHOUT the work clone fetching it: plumbing in the bare repo, no clone, no network.
    const hubAdvance = (fx, name) => {
      const hg = (...a) => execFileSync("git", ["-C", fx.h, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: FX_ENV }).trim();
      const parent = hg("rev-parse", `refs/heads/${name}`);
      const next = hg("commit-tree", `${parent}^{tree}`, "-p", parent, "-m", `hub moves ${name} forward`);
      hg("update-ref", `refs/heads/${name}`, next);
      return next;
    };
    const hasObject = (fx, sha) => { try { execFileSync("git", ["-C", fx.w, "cat-file", "-e", `${sha}^{commit}`], { stdio: "ignore" }); return true; } catch { return false; } };
    // (C) the walks end at the fork. p1a: mainline went v1 -> v2 -> v1 (a revert); the branch forked at the revert and re-applies v2.
    const pa = mkFx("r6a");
    pa.c("f.txt", "v1\n"); const paA = pa.c("f.txt", "v2 FEATURE\n", "A: feature"); pa.c("f.txt", "v1\n", "B: revert A"); pa.f("push", "-q", "origin", "main");
    pa.f("checkout", "-q", "-b", "rr"); pa.c("f.txt", "v2 FEATURE\n", "revert B (re-apply the feature)");
    const paRows = pa.rows(), paU = rowOf(paRows, T_UNPUSHED);
    check("a local re-apply of a change mainline already reverted matches a blob from BEFORE the fork and is still reported: both landed checks false (R6-p1a, revert of a revert)",
      pa.f("rev-parse", `${paA}:f.txt`) === pa.f("rev-parse", "refs/heads/rr:f.txt") && pa.f("merge-base", R6M, "refs/heads/rr") === pa.f("rev-parse", R6M) &&
      hasLandedByContent("rr", R6M, pa.w) === false && landedByPatchId("rr", R6M, pa.w) === false &&
      !!paU && paU.state === "fail" && paU.gated === true && paU.detail.split(" — ")[0] === "rr" && !/squash-landed/.test(JSON.stringify(paRows)));
    // p1a2: the plain revert: mainline went v1 -> v2, the branch forked at v2 and restores v1
    const pb = mkFx("r6b");
    const pbV1 = pb.c("f.txt", "v1 old\n"); pb.c("f.txt", "v2 current\n", "A"); pb.f("push", "-q", "origin", "main");
    pb.f("checkout", "-q", "-b", "rv"); pb.c("f.txt", "v1 old\n", "revert A");
    const pbRows = pb.rows(), pbU = rowOf(pbRows, T_UNPUSHED);
    check("a local plain revert of mainline's last change to a file is still reported, not cleared by the file's pre-fork blob (R6-p1a2)",
      pb.f("rev-parse", `${pbV1}:f.txt`) === pb.f("rev-parse", "refs/heads/rv:f.txt") && hasLandedByContent("rv", R6M, pb.w) === false && landedByPatchId("rv", R6M, pb.w) === false &&
      !!pbU && pbU.state === "fail" && pbU.gated === true && pbU.detail.split(" — ")[0] === "rv" && !/squash-landed/.test(JSON.stringify(pbRows)));
    // the bound must not over-restrict: content that landed AFTER the fork and was then overtaken (the moved-on hole) is still cleared
    const mo = mkFx("r6mo");
    mo.c("f.txt", "base\n"); mo.f("push", "-q", "origin", "main"); mo.f("checkout", "-q", "-b", "feat"); mo.c("f.txt", "landed\n", "feat");
    mo.f("checkout", "-q", "main"); mo.c("f.txt", "landed\n", "squash of feat"); mo.c("f.txt", "landed\nmoved on\n", "next merge"); mo.f("push", "-q", "origin", "main");
    check("content that landed after the fork and was then overtaken by a later change to the same file is still cleared by bytes (R6-moved-on)",
      mo.f("rev-parse", "refs/heads/feat:f.txt") !== mo.f("rev-parse", `${R6M}:f.txt`) && hasLandedByContent("feat", R6M, mo.w) === true);
    // (B) object ids, never text. p1c: a file over Node's 1 MiB default maxBuffer, edited on the branch only.
    const pc = mkFx("r6c");
    const big = `${"x".repeat(1100000)}\n`;
    pc.c("big.md", big); pc.f("push", "-q", "origin", "main");
    pc.f("checkout", "-q", "-b", "bigwork"); pc.c("big.md", big.replace(/^x/, "REAL UNPUSHED EDIT "), "real work in the big file");
    let enobufs = false;
    try { execFileSync("git", ["show", "refs/heads/bigwork:big.md"], { cwd: pc.w, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch (e) { enobufs = Boolean(e && e.code === "ENOBUFS"); }
    const pcRows = pc.rows(), pcU = rowOf(pcRows, T_UNPUSHED);
    check("a file over 1 MiB with a real unpushed edit is reported, not cleared because both sides failed to read as \"\" (R6-p1c)",
      enobufs && pc.f("rev-parse", "refs/heads/bigwork:big.md") !== pc.f("rev-parse", `${R6M}:big.md`) && hasLandedByContent("bigwork", R6M, pc.w) === false &&
      !!pcU && pcU.state === "fail" && pcU.gated === true && pcU.detail.split(" — ")[0] === "bigwork" && !/squash-landed/.test(JSON.stringify(pcRows)));
    check("gitIn reads output past 1 MiB (a 64 MiB maxBuffer) instead of swallowing the overflow as an empty answer (R6-maxbuffer)", gitIn(pc.w)("show", "refs/heads/bigwork:big.md").length > 1000000);
    // ...and the same big file, when mainline really carries the branch's blob, is still cleared (no false positive from the change)
    pc.f("checkout", "-q", "main"); pc.c("big.md", big.replace(/^x/, "LANDED "), "squash of the big edit"); pc.f("push", "-q", "origin", "main");
    pc.f("checkout", "-q", "-b", "biglanded", "main~1"); pc.c("big.md", big.replace(/^x/, "LANDED "), "the big edit, original commit");
    check("a file over 1 MiB whose bytes ARE mainline's blob is still cleared as squash-landed (R6-p1c-pos)", hasLandedByContent("biglanded", R6M, pc.w) === true);
    // p1g: a difference that trim() erases (indentation, trailing blank lines in YAML)
    const pg = mkFx("r6g");
    pg.c("conf.yml", "key: value\n"); pg.f("push", "-q", "origin", "main"); pg.f("checkout", "-q", "-b", "indent"); pg.c("conf.yml", "  key: value\n\n\n");
    const pgRows = pg.rows(), pgU = rowOf(pgRows, T_UNPUSHED);
    check("a trim-only difference (indentation and trailing blank lines) is a difference: the texts trim equal, the blob ids do not, the branch is reported (R6-p1g)",
      pg.f("show", "refs/heads/indent:conf.yml") === pg.f("show", `${R6M}:conf.yml`) && pg.f("rev-parse", "refs/heads/indent:conf.yml") !== pg.f("rev-parse", `${R6M}:conf.yml`) &&
      hasLandedByContent("indent", R6M, pg.w) === false && !!pgU && pgU.state === "fail" && pgU.detail.split(" — ")[0] === "indent");
    // a mode-only change has the same blob id and is still a change
    const pm = mkFx("r6m");
    pm.c("run.sh", "echo hi\n"); pm.f("push", "-q", "origin", "main"); pm.f("checkout", "-q", "-b", "chmod"); pm.f("update-index", "--chmod=+x", "run.sh"); pm.f("commit", "-q", "-m", "chmod +x");
    check("a chmod-only change (same blob id, different mode) is reported, not cleared as byte-identical (R6-chmod)",
      pm.f("rev-parse", "refs/heads/chmod:run.sh") === pm.f("rev-parse", `${R6M}:run.sh`) && pm.f("diff", "--name-only", `${R6M}...refs/heads/chmod`) === "run.sh" && hasLandedByContent("chmod", R6M, pm.w) === false);
    // a path git QUOTES in plain diff output: "\303\244.txt" names no path, so BOTH sides were missing and "" === ""
    const pq = mkFx("r6q");
    pq.c("ä.txt", "original\n"); pq.f("push", "-q", "origin", "main"); pq.f("checkout", "-q", "-b", "qb"); pq.c("ä.txt", "real unpushed change\n");
    const pqU = rowOf(pq.rows(), T_UNPUSHED);
    check("a real change to a file with a non-ASCII name (git quotes it in plain diff output) is reported, not read as missing on both sides (R6-quote)",
      pq.f("diff", "--name-only", `${R6M}...refs/heads/qb`).startsWith("\"") && hasLandedByContent("qb", R6M, pq.w) === false && !!pqU && pqU.state === "fail" && pqU.detail.split(" — ")[0] === "qb");
    // a RENAME is listed under its new name only by default: the old path's deletion was never compared
    const pr6 = mkFx("r6rn");
    const rnBody = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n";
    pr6.c("old.txt", rnBody); pr6.f("push", "-q", "origin", "main"); pr6.f("checkout", "-q", "-b", "mv"); pr6.f("mv", "old.txt", "new.txt"); pr6.f("commit", "-q", "-m", "rename old to new");
    pr6.f("checkout", "-q", "main"); pr6.c("new.txt", rnBody, "main gains a copy and keeps old.txt"); pr6.f("push", "-q", "origin", "main");
    check("a rename whose new name mainline already carries, while mainline still has the OLD path, is reported: the deleted old path counts (R6-rename)",
      pr6.f("diff", "--name-only", `${R6M}...refs/heads/mv`) === "new.txt" && hasLandedByContent("mv", R6M, pr6.w) === false);
    // a path missing on BOTH sides is the same state (the INFO case), and one removed by the branch but kept by mainline is not
    const pb2 = mkFx("r6db");
    pb2.c("g.txt", "g\n"); pb2.f("push", "-q", "origin", "main"); pb2.f("checkout", "-q", "-b", "del"); pb2.f("rm", "-q", "g.txt"); pb2.f("commit", "-q", "-m", "del g");
    pb2.f("checkout", "-q", "main"); pb2.f("rm", "-q", "g.txt"); pb2.f("commit", "-q", "-m", "main del g"); pb2.c("h.txt", "h\n"); pb2.f("push", "-q", "origin", "main");
    check("a branch that only deletes a file mainline also deleted is still cleared: missing on both sides is the same state (R6-del-both)",
      pb2.f("ls-tree", "--name-only", R6M, "g.txt") === "" && hasLandedByContent("del", R6M, pb2.w) === true);
    const pk = mkFx("r6dk");
    pk.c("g.txt", "g\n"); pk.f("push", "-q", "origin", "main"); pk.f("checkout", "-q", "-b", "rmkeep"); pk.f("rm", "-q", "g.txt"); pk.f("commit", "-q", "-m", "branch deletes g");
    pk.f("checkout", "-q", "main"); pk.c("h.txt", "h\n"); pk.f("push", "-q", "origin", "main");
    check("a branch that deletes a file mainline still has is a difference, not cleared (R6-del-kept)",
      pk.f("ls-tree", "--name-only", R6M, "g.txt") === "g.txt" && hasLandedByContent("rmkeep", R6M, pk.w) === false);
    // (A) ancestry against the Hub's own listing. p1d: the tip IS the sha the Hub lists for another name, pushed by URL (no tracking ref written)
    const pd = mkFx("r6d");
    pd.f("checkout", "-q", "-b", "mine"); const pdT = pd.c("m.txt", "work\n"); pd.f("push", "-q", pd.h, "mine:refs/heads/other");
    const pdMap = hubMapOf(pd.h), pdRows = pd.rows(), pdC = rowOf(pdRows, T_CLEAN);
    check("a tip equal to a sha the Hub lists for another name is on the Hub even with no tracking ref for it: cleared and named (R6-p1d)",
      pd.f("for-each-ref", "refs/remotes/origin/other") === "" && pdMap.get("other") === pdT && hubNamesHoldingTip("mine", pdMap, pd.w).join() === "other" &&
      !!pdC && pdC.state === "ok" && /\(1 on the hub under another name: mine\)/.test(pdC.detail) && !rowOf(pdRows, T_UNPUSHED));
    // p1e: the holder is BEHIND the Hub (the Hub moved `other` forward after the last fetch), and the Hub's new sha IS in the local store
    const mkBehind = (name) => {
      const x = mkFx(name);
      x.f("checkout", "-q", "-b", "other"); const o = x.c("o.txt", "o\n"); x.f("push", "-q", "origin", "other");
      x.f("checkout", "-q", "-b", "pr782", "other"); x.f("branch", "-q", "-D", "other");
      return { x, o, o2: hubAdvance(x, "other") };
    };
    const pe = mkBehind("r6e");
    pe.x.f("fetch", "-q", pe.x.h, "refs/heads/other:refs/remotes/stash/other"); // by URL: the object arrives, origin/other does not move
    const peRows = pe.x.rows(), peC = rowOf(peRows, T_CLEAN);
    check("a holder BEHIND the Hub, with the Hub's newer sha in the local store, still clears the branch by ancestry and names it (R6-p1e)",
      pe.x.f("rev-parse", "refs/remotes/origin/other") === pe.o && hubMapOf(pe.x.h).get("other") === pe.o2 && hasObject(pe.x, pe.o2) &&
      hubNamesHoldingTip("pr782", hubMapOf(pe.x.h), pe.x.w).join() === "other" && !!peC && peC.state === "ok" && /\(1 on the hub under another name: pr782\)/.test(peC.detail) && !rowOf(peRows, T_UNPUSHED));
    // p1e2: the same, with the Hub's newer sha NOT in the local store: only a fetch can say, so a gated failure whose remedy is the fetch
    const pe2 = mkBehind("r6e2");
    const pe2Rows = pe2.x.rows(), pe2U = rowOf(pe2Rows, T_UNPUSHED);
    check("a holder behind the Hub with the Hub's newer sha NOT local is a gated failure whose remedy is 'run git fetch origin', not 'push' (R6-p1e2)",
      !hasObject(pe2.x, pe2.o2) && !!pe2U && pe2U.state === "fail" && pe2U.gated === true && pe2U.detail.split(" — ")[0] === "pr782" &&
      pe2U.detail.includes(FETCH("other")) && !/push, or confirm the remote/.test(pe2U.detail));
    pe2.x.f("fetch", "-q", "origin");
    check("...and after the fetch the same branch is cleared and named (R6-p1e2-after)", (() => { const r = pe2.x.rows(), c = rowOf(r, T_CLEAN); return !!c && c.state === "ok" && /on the hub under another name: pr782/.test(c.detail) && !rowOf(r, T_UNPUSHED); })());
    // p1f: the only holder is mainline, and the Hub's mainline moves on (the ordinary state of the shared checkout). The same-name warn agrees with the failure row.
    const pf = mkFx("r6f");
    pf.c("m1.txt", "m1\n"); pf.f("push", "-q", "origin", "main"); pf.f("branch", "pinned", "main"); hubAdvance(pf, "main");
    const pfRows = pf.rows(), pfU = rowOf(pfRows, T_UNPUSHED), pfW = rowOf(pfRows, T_UNKNOWN);
    check("a branch pinned at a mainline the Hub has moved on from is a gated failure saying fetch, and the same-name warn for main says it in the same words (R6-p1f)",
      !!pfU && pfU.state === "fail" && pfU.gated === true && pfU.detail.split(" — ")[0] === "pinned" && pfU.detail.includes(FETCH("main")) && !/push, or confirm the remote/.test(pfU.detail) &&
      !!pfW && pfW.state === "warn" && pfW.gated === false && pfW.detail.includes(FETCH("main")));
    pf.f("fetch", "-q", "origin");
    check("...and after the fetch the pinned branch is cleared and the warn is gone (R6-p1f-after)", (() => { const r = pf.rows(); return rowOf(r, T_CLEAN)?.state === "ok" && !rowOf(r, T_UNPUSHED) && !rowOf(r, T_UNKNOWN); })());
    // a same-named branch whose Hub tip is not fetched and which has NO tracking ref at all: still the fetch remedy, honestly worded (nothing "is behind")
    const pu = mkFx("r6u");
    const puNext = hubAdvance(pu, "main"); execFileSync("git", ["-C", pu.h, "update-ref", "refs/heads/hubonly", puNext]); pu.f("branch", "hubonly", "main");
    const puW = rowOf(pu.rows(), T_UNKNOWN);
    check("a same-named branch whose Hub tip is not fetched and has no origin/<name> says fetch, not 'behind' (R6-unfetched)",
      pu.f("for-each-ref", "refs/remotes/origin/hubonly") === "" && !!puW && puW.detail.includes("hubonly — the Hub's hubonly is not fetched here: run git fetch origin, then re-run"));
    // the one-process yes/no (rev-list) cannot read a corrupt listed commit: it answers "unknown", and the answer is then asked of each commit alone,
    // so ONE bad object among the Hub's listed shas neither disables the exemption for the rest nor grants anything
    const pn = mkFx("r6null");
    pn.f("checkout", "-q", "-b", "pr1"); const pnTip = pn.c("p.txt", "p\n"); pn.f("push", "-q", "origin", "pr1:refs/heads/holder");
    const pnBad = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin", "--literally"], { cwd: pn.w, input: "garbage, not a commit", encoding: "utf8", env: FX_ENV }).trim();
    const pnMap = new Map([...hubMapOf(pn.h), ["corrupt", pnBad]]), pnOnly = new Map([["corrupt", pnBad]]);
    const pnBoth = hubTipState("pr1", pnMap, pn.w), pnNone = hubTipState("pr1", pnOnly, pn.w);
    check("a corrupt Hub-listed commit makes the one-process answer unknown, and the per-commit fallback still finds the real holder; with only the corrupt one nothing is granted (R6-reach-unknown)",
      localCommits(pn.w, [pnBad]).has(pnBad) && tipReachableFromAny(pn.w, pnTip, [pnBad, pnTip]) === null && pnBoth.holds === true && !pnNone.holds && pnNone.holders.length === 0);
    // the same-name row, ahead of its Hub name AND held by a tracking ref the Hub has moved on from: a fetch before any push
    const ps = mkFx("r6s");
    ps.f("checkout", "-q", "-b", "X"); ps.c("x1.txt", "1\n"); ps.f("push", "-q", "origin", "X"); ps.c("x2.txt", "2\n");
    ps.f("push", "-q", "origin", "X:refs/heads/main"); hubAdvance(ps, "main");
    const psA = rowOf(ps.rows(), T_AHEAD);
    check("a branch one ahead of its Hub name whose tip a lagging origin/main holds is a gated failure that says to fetch first (R6-same-ahead)",
      !!psA && psA.state === "fail" && psA.gated === true && psA.detail.startsWith("X (+1)") && psA.detail.includes(`X: ${FETCH("main")}`));
    ps.f("fetch", "-q", "origin");
    check("...and after the fetch the same-name row is clean, naming X as confirmed (R6-same-ahead-after)", (() => { const a = rowOf(ps.rows(), "Same-named branches at or behind their Hub tip, or confirmed on the Hub under another branch"); return !!a && a.state === "ok" && /confirmed on the Hub under another branch: X/.test(a.detail); })());
    // (D) every benign warning is carried, not only the first (a .slice(0, 1) survived); past three, a count. Also the missing-map guard.
    const tw = mkFx("r6tw");
    tw.f("branch", "-q", "side-ok"); tw.f("push", "-q", "origin", "side-ok");
    // two DIFFERENT warnings from git itself: an unknown core.fsync component, and the deprecated core.fsyncObjectFiles
    const twRun = withGitConfig([["core.fsync", "foo"], ["core.fsyncObjectFiles", "true"]], () => ({ l: listLocalBranches(tw.w), d: rowOf(tw.rows(), T_CLEAN) }));
    check("two benign warnings printed by git are BOTH named in the row, in git's order, verdict unaffected (R6-two-warnings)",
      twRun.l.ok && twRun.l.warnings.length === 2 && !!twRun.d && twRun.d.state === "ok" &&
      twRun.d.detail.includes("ignoring unknown core.fsync component 'foo'") && twRun.d.detail.includes("core.fsyncObjectFiles is deprecated") &&
      twRun.d.detail.indexOf("core.fsync component") < twRun.d.detail.indexOf("core.fsyncObjectFiles") && !/more\)/.test(twRun.d.detail));
    // more than three: the first three, then a count (handcrafted: git has no cheap fifth warning to print)
    const twFive = rowOf(tw.rows({ listing: { ...twRun.l, warnings: ["warning: w1", "warning: w2", "warning: w3", "warning: w4", "warning: w5"] } }), T_CLEAN).detail;
    check("five benign warnings name the first three and count the rest (R6-five-warnings)", /warning: w1 \| warning: w2 \| warning: w3 \| \+2 more\)/.test(twFive) && !twFive.includes("warning: w4"));
    // (the harness may export these three itself, so the case plants known values, runs withFsync, and puts the originals back)
    const envKeys = ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"], envOrig = envKeys.map((k) => process.env[k]);
    let envKept;
    try {
      process.env.GIT_CONFIG_COUNT = "0"; process.env.GIT_CONFIG_KEY_0 = "x.planted"; process.env.GIT_CONFIG_VALUE_0 = "planted";
      withFsync(() => 0);
      envKept = process.env.GIT_CONFIG_COUNT === "0" && process.env.GIT_CONFIG_KEY_0 === "x.planted" && process.env.GIT_CONFIG_VALUE_0 === "planted";
    } finally { envKeys.forEach((k, i) => { if (envOrig[i] === undefined) delete process.env[k]; else process.env[k] = envOrig[i]; }); }
    check("withFsync puts the three GIT_CONFIG_* variables back to what they held instead of deleting them (R6-env)", envKept === true);
    const um = mkFx("r6um");
    const umRun = (map) => { try { return { rows: branchSeamRows({ listing: listLocalBranches(um.w), hubBranches: ["main"], hubShaMap: map, ephemeral: [], scratchExcluded: [], mainline: R6M, cwd: um.w }) }; } catch (e) { return { threw: String(e && e.message) }; } };
    const umU = umRun(undefined), umN = umRun(null), umA = umU.rows && rowOf(umU.rows, T_AHEAD);
    check("no Hub sha map does not throw: every same-named branch is a gated failure naming the cause (R6-undefined-map)",
      !umU.threw && !umN.threw && !!umA && umA.state === "fail" && umA.gated === true && umA.detail.startsWith("main (count unreadable)") && /no Hub sha map was passed/.test(umA.detail) && rowOf(umN.rows, T_AHEAD).state === "fail");
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
    // (n-tag) a TAG named like the declared branch, on an older commit: the bare name would count the tag's history and read zero newer commits
    sh("checkout", "-q", "-b", "scratch-tag", "main"); cm("st-tag.txt", "x\n"); sh("tag", "scratch-tag", "main");
    check("a tag named like a declared scratch branch does not hide the branch's own commit newer than declaredAt (n-tag)",
      raw("rev-list", "--count", `${M}..scratch-tag`) === "0" && newerCommitCount("scratch-tag", pastAt, M, work) === 1);
    sh("tag", "-d", "scratch-tag");
    // (n-replace) a replace graft on the branch tip would shrink the count to one: the log runs with replace objects off, like gitIn
    sh("checkout", "-q", "-b", "rp", "main"); cm("rp1.txt", "1\n"); const rp2 = cm("rp2.txt", "2\n");
    sh("replace", "--graft", rp2, g("rev-parse", "main"));
    const rpCount = newerCommitCount("rp", pastAt, M, work), rpRaw = raw("log", "--format=%ct", `${M}..refs/heads/rp`).split("\n").filter(Boolean).length;
    sh("replace", "-d", rp2);
    check("newerCommitCount reads the real graph: a replace graft on the branch tip does not shrink the count (n-replace)", rpRaw === 1 && rpCount === 2);
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
