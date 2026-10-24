#!/bin/bash
# Stop hook — the "done means pushed and green" rule, enforced rather than
# remembered (2026-08-28 handoff, installed under DR-021).
#
# One nudge, never a wall: if the gate fails, the tree is dirty, or HEAD is
# not on origin, the stop is blocked ONCE with the reason; the stop_hook_active
# guard lets the retry through, so a session can always end after
# acknowledging the state.
#
# THREE HOLES CLOSED 2026-09-05 (sixth audit round, each reproduced):
#   1. The gate arm could never fire. `pnpm run loop:state` exited 0 on every
#      outcome — it printed "3 thing(s) need you." and returned success — so
#      CLAUDE.md's "enforced by hooks" was enforced by nothing here.
#      loop-state.mjs now sets a non-zero exit code when a REPO SEAM fails
#      (the checks it exists for); the reason quotes the failing rows.
#   2. Uncommitted work satisfied "done": the hook compared HEAD to origin and
#      never looked at the working tree, so an edit that was never committed
#      passed as pushed. `git status --porcelain` is consulted first.
#   3. `cd "${CLAUDE_PROJECT_DIR}"` with the variable unset is `cd ""`, which
#      SUCCEEDS and evaluates whatever directory the hook started in. The
#      fallback is explicit now.
input=$(cat)
if [ "$(printf '%s' "$input" | jq -r '.stop_hook_active' 2>/dev/null)" = "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

GATE_CMD="pnpm run loop:state"
if ! $GATE_CMD >/tmp/sg_gate.log 2>&1; then
  FAILING=$(grep -E '✗|FAIL' /tmp/sg_gate.log | sed 's/\x1b\[[0-9;]*m//g' | head -3 | tr -s ' ' | tr '\n' ';')
  jq -nc --arg r "loop:state reports a failing seam: ${FAILING} Read /tmp/sg_gate.log, fix the cause, re-run. Never bypass a check; report the failure instead." '{decision:"block", reason:$r}'
  exit 0
fi

DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
if [ "$DIRTY" != "0" ]; then
  jq -nc --arg n "$DIRTY" '{decision:"block", reason:("\($n) uncommitted file(s) in the working tree. Done means committed AND confirmed on origin; commit and push, or say plainly what is left uncommitted and why.")}'
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git ls-remote origin "refs/heads/$BRANCH" | awk '{print $1}')

# on_remote_default <sha>: succeeds ONLY when origin names a default branch, that branch is
# fetched NOW, and the tip just fetched contains <sha>. Every other outcome is a failure —
# including a fetch that fails (Codex on PR #1648, reproduced: with the remote default REWOUND
# past the local tip and the fetch failing, the stale remote-tracking ref still held the tip,
# so an unchecked fetch followed by a test against refs/remotes/origin/<default> passed a
# session whose commits were on NO remote branch). The test therefore reads FETCH_HEAD, the
# object the remote served in this very call, never a remote-tracking ref that may be stale or
# that a restricted fetch refspec never updates. UNKNOWN STAYS FATAL (golden rule 2).
# Return codes: 0 on origin's default branch; 1 provably not; 2 could not be checked (no
# default branch named, or the fetch failed) — the block message must not state an unknown
# as a negative fact. The fetch names the ref as "refs/heads/<name>" after "--", so a default
# branch whose name begins with "-" (a remote HEAD pointing at "--upload-pack=…") is a ref,
# never an option.
on_remote_default() {
  DEFAULT=$(git ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/ {sub("refs/heads/","",$2); print $2}')
  [ -n "$DEFAULT" ] || return 2
  git fetch -q origin -- "refs/heads/$DEFAULT" 2>/dev/null || return 2
  git merge-base --is-ancestor "$1" FETCH_HEAD 2>/dev/null; rc=$?
  [ "$rc" = "0" ] && return 0
  # rc 1 is "provably not" only in a full clone: a shallow clone's graft can cut the ancestry
  # between the tip and the fetched default, so there rc 1 means "cannot see", and any rc other
  # than 0 or 1 is an error. Both are "could not be checked" (round-2 refute of PR #1648, N1).
  if [ "$rc" != "1" ] || [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then return 2; fi
  return 1
}
default_branch_clause() { # $1 = on_remote_default's return code
  if [ "$1" = "2" ]; then echo "and origin's default branch could not be checked (not named, its fetch failed, or this clone is shallow)"; else echo "and HEAD is not on origin's default branch either"; fi
}

if [ -z "$REMOTE" ]; then
  # The branch ref being gone from origin is NOT always an unpushed branch:
  # GitHub deletes the head branch when its PR merges, and this hook then
  # fired on the first fully-landed session it ever watched. If HEAD is
  # already an ancestor of the remote default branch, the work is on origin
  # and this is the success case, not the failure case.
  on_remote_default "$LOCAL"; RC=$?
  if [ "$RC" = "0" ]; then
    exit 0
  fi
  jq -nc --arg b "$BRANCH" --arg c "$(default_branch_clause "$RC")" '{decision:"block", reason:("Branch \($b) is not on origin, \($c). Push it, then re-verify with git ls-remote before declaring done.")}'
  exit 0
fi
if [ "$LOCAL" != "$REMOTE" ]; then
  # DIRECTION MATTERS (fixed 2026-09-09, fired twice in one session). This compared the
  # two hashes and called ANY difference "not pushed", so a checkout merely BEHIND origin
  # was reported as unpushed work — and the instruction it gave, `git push origin HEAD`,
  # had nothing to push. That is the normal state on the Mac: the launchd tick commits a
  # heartbeat and pushes it every 5 minutes, so origin moves under an idle checkout and
  # every session-end tripped a hook about a commit that did not exist. Only commits the
  # remote does NOT carry are a violation. UNKNOWN STAYS FATAL: if the remote commit
  # cannot be resolved locally the direction is undeterminable, and an undeterminable
  # answer must never pass as clean (golden rule 2).
  git fetch -q origin "$BRANCH" 2>/dev/null
  UNPUSHED=$(git rev-list --count "$REMOTE..$LOCAL" 2>/dev/null)
  if [ -z "$UNPUSHED" ]; then
    jq -nc --arg b "$BRANCH" '{decision:"block", reason:("Cannot determine whether HEAD is ahead of origin/\($b) — the remote commit did not resolve locally after a fetch. Run git fetch origin, then git rev-list --count origin/\($b)..HEAD and act on what it says. An undeterminable state is not a clean one.")}'
    exit 0
  fi
  if [ "$UNPUSHED" != "0" ]; then
    # ON ORIGIN UNDER ANOTHER NAME (fixed 2026-10-24, fired on every stop of a session for
    # days). A same-named remote branch can be STALE RESIDUE that the local branch no longer
    # descends from: the cloud container's checkout sat at a mainline snapshot while
    # origin/<branch> was a closed PR's September head with 35 commits of its own, so the
    # count read "50 unpushed" and then, after a fast-forward to mainline, "4813" — while
    # every one of those commits was on origin under the default branch. The remedy the
    # message names, `git push origin HEAD`, is a non-fast-forward there, and a force is
    # forbidden. The missing-branch arm above already treats "HEAD is an ancestor of the
    # remote default branch" as the success case (the work IS on origin); the same test
    # (on_remote_default, one definition for both arms) decides here. UNKNOWN STAYS FATAL: a
    # default branch git cannot name or fetch, or an ancestry git cannot prove, falls through
    # to the block below. A branch carrying a commit no remote ref holds is an ancestor of
    # nothing on origin and still blocks.
    on_remote_default "$LOCAL"; RC=$?
    if [ "$RC" = "0" ]; then
      exit 0
    fi
    # The count is REMOTE..LOCAL against the same-named branch, so against a diverged twin it
    # can exceed the commits missing from every remote ref; it is the count the push would move.
    jq -nc --arg b "$BRANCH" --arg n "$UNPUSHED" --arg c "$(default_branch_clause "$RC")" '{decision:"block", reason:("\($n) local commit(s) on \($b) are not on origin/\($b), \($c). Run git push origin HEAD, re-verify with git ls-remote.")}'
    exit 0
  fi
  # Behind only: nothing of this session's is unpushed, so this is not a done violation.
fi
exit 0
