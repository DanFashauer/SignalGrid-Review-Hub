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
if [ -z "$REMOTE" ]; then
  # The branch ref being gone from origin is NOT always an unpushed branch:
  # GitHub deletes the head branch when its PR merges, and this hook then
  # fired on the first fully-landed session it ever watched. If HEAD is
  # already an ancestor of the remote default branch, the work is on origin
  # and this is the success case, not the failure case.
  DEFAULT=$(git ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/ {sub("refs/heads/","",$2); print $2}')
  if [ -n "$DEFAULT" ]; then
    git fetch -q origin "$DEFAULT" 2>/dev/null
    if git merge-base --is-ancestor "$LOCAL" "refs/remotes/origin/$DEFAULT" 2>/dev/null; then
      exit 0
    fi
  fi
  jq -nc --arg b "$BRANCH" '{decision:"block", reason:("Branch \($b) is not on origin and HEAD is not on the default branch either. Push it, then re-verify with git ls-remote before declaring done.")}'
  exit 0
fi
if [ "$LOCAL" != "$REMOTE" ]; then
  jq -nc --arg b "$BRANCH" '{decision:"block", reason:("Local HEAD is not on origin/\($b). The commit was not actually pushed. Run git push origin HEAD, re-verify with git ls-remote.")}'
  exit 0
fi
exit 0
