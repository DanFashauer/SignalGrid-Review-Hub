#!/bin/bash
# Stop hook — the "done means pushed and green" rule, enforced rather than
# remembered (2026-08-28 handoff, installed under DR-021).
#
# One nudge, never a wall: if the gate fails or HEAD is not on origin, the
# stop is blocked ONCE with the reason; the stop_hook_active guard lets the
# retry through, so a session can always end after acknowledging the state.
input=$(cat)
if [ "$(echo "$input" | jq -r '.stop_hook_active')" = "true" ]; then exit 0; fi
cd "${CLAUDE_PROJECT_DIR}" || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

GATE_CMD="pnpm run loop:state"
if ! $GATE_CMD >/tmp/sg_gate.log 2>&1; then
  jq -nc --arg r "Gate failed. Read /tmp/sg_gate.log, fix the cause, re-run. Never bypass a check; report the failure instead." '{decision:"block", reason:$r}'
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git ls-remote origin "refs/heads/$BRANCH" | awk '{print $1}')
if [ -z "$REMOTE" ]; then
  jq -nc --arg b "$BRANCH" '{decision:"block", reason:("Branch \($b) is not on origin. Push it, then re-verify with git ls-remote before declaring done.")}'
  exit 0
fi
if [ "$LOCAL" != "$REMOTE" ]; then
  jq -nc --arg b "$BRANCH" '{decision:"block", reason:("Local HEAD is not on origin/\($b). The commit was not actually pushed. Run git push origin HEAD, re-verify with git ls-remote.")}'
  exit 0
fi
exit 0
