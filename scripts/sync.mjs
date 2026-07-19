#!/usr/bin/env node
// sync — the safe local <-> cloud git dance, so you never think about it.
//
// Run `pnpm run sync` in either environment (your Mac or a cloud session). It:
//   1. refuses to do anything if you have uncommitted work (never clobbers);
//   2. fetches the remote;
//   3. fast-forward pulls if you're behind, pushes if you're ahead;
//   4. STOPS and explains if the branch has diverged (never auto-merges or
//      force-pushes — that stays your decision);
//   5. tells you if the base branch has moved so you know a rebase is coming.
//
// Safe by construction: no force, no merge-conflict resolution, no push over a
// dirty tree. It only ever fast-forwards or pushes a clean, non-diverged branch.

import { execFileSync } from "node:child_process";

const BASE = "SignalGrid_Alpha"; // the default branch feature work rebases onto

// Run git with an explicit argv array — never a shell string. A branch name can
// legitimately contain shell metacharacters (backticks, $()), so interpolating
// one into a `sh -c` command line would be a command-injection surface; execFileSync
// passes each element straight to git with no shell in between.
function git(args, { capture = true } = {}) {
  try {
    const out = execFileSync("git", args, { stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit" });
    return capture ? out.toString().trim() : "";
  } catch (e) {
    return { error: (e.stderr?.toString() || e.stdout?.toString() || e.message || "").trim() };
  }
}

const say = (s) => console.log(s);
const die = (s) => { console.error(s); process.exit(1); };

// ── where are we ──────────────────────────────────────────────────────────────
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
if (typeof branch !== "string" || !branch) die("Not in a git repo.");
say(`Branch: ${branch}`);

// ── never touch uncommitted work ──────────────────────────────────────────────
const dirty = git(["status", "--porcelain"]);
if (dirty) {
  say("\nYou have uncommitted changes:");
  say(dirty.split("\n").map((l) => "  " + l).join("\n"));
  die("\n→ Commit or stash them first, then re-run `pnpm run sync`. (Nothing was changed.)");
}

// ── fetch (fatal on failure — never compare against stale refs) ───────────────
say("Fetching origin…");
const fetched = git(["fetch", "origin", branch, BASE]);
if (fetched && fetched.error) {
  die(`Fetch failed — refusing to act on stale remote state: ${fetched.error.split("\n")[0]}\n→ Fix connectivity/auth and re-run \`pnpm run sync\`. (Nothing was changed.)`);
}

// ── compare local vs origin/branch ────────────────────────────────────────────
const counts = git(["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]);
if (counts && counts.error) {
  // No remote tracking branch yet — this branch has never been pushed.
  say(`\nThis branch isn't on origin yet.`);
  say(`→ Push it with:  git push -u origin ${branch}`);
  process.exit(0);
}
const [ahead, behind] = counts.split(/\s+/).map(Number);

// ── base drift (informational) ────────────────────────────────────────────────
const baseAhead = git(["rev-list", "--count", `HEAD..origin/${BASE}`]);
const baseNote = !baseAhead?.error && Number(baseAhead) > 0
  ? `\nℹ️  ${BASE} has ${baseAhead} new commit(s) since you branched — a rebase onto it may be due before merge.`
  : "";

// ── act ───────────────────────────────────────────────────────────────────────
if (ahead === 0 && behind === 0) {
  say(`\n✓ Up to date with origin/${branch}. Nothing to do.${baseNote}`);
} else if (behind > 0 && ahead === 0) {
  say(`\nBehind by ${behind} — fast-forwarding…`);
  const r = git(["pull", "--ff-only", "origin", branch], { capture: false });
  if (r && r.error) die(`Pull failed: ${r.error}`);
  say(`✓ Pulled. Local now matches origin/${branch}.${baseNote}`);
} else if (ahead > 0 && behind === 0) {
  say(`\nAhead by ${ahead} — pushing…`);
  const r = git(["push", "origin", branch], { capture: false });
  if (r && r.error) die(`Push failed: ${r.error}`);
  say(`✓ Pushed. origin/${branch} now matches local.${baseNote}`);
} else {
  // diverged — do NOT auto-resolve
  say(`\n⚠️  Diverged: ${ahead} local commit(s) and ${behind} remote commit(s) differ.`);
  say(`This means the same branch was advanced in two places. Reconcile deliberately:`);
  say(`  git pull --rebase origin ${branch}    # replay your commits on top of remote`);
  say(`  # …resolve any conflicts, then:  git push`);
  say(`(sync won't merge or force-push for you — that's your call.)${baseNote}`);
  process.exit(2);
}
