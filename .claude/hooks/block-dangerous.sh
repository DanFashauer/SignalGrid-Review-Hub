#!/bin/bash
# PreToolUse hook on Bash — the deny list, enforced before execution
# (2026-08-28 handoff, installed under DR-021). Matches whole commands, so a
# doc edit MENTIONING a forbidden pattern is untouched; only Bash tool calls
# pass through here.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')
# Match INVOCATIONS, not mentions: strip quoted spans first, so a commit
# message or doc text that NAMES a forbidden command does not trip the
# guard. (It blocked its own installing commit on first contact — the
# message quoted the pattern it denies. Same defect class as the gate
# census matching skip-line mentions.) A forbidden string in an unquoted
# position — where the shell would execute it — still blocks.
stripped=$(printf '%s' "$cmd" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
for p in "rm -rf" "git push --force" "git push -f" "--no-verify" "git stash" "git reset --hard"; do
  if printf '%s' "$stripped" | grep -qi -- "$p"; then
    jq -nc --arg p "$p" '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:("Blocked: matches forbidden pattern \($p). Report the problem instead of working around it.")}}'
    exit 0
  fi
done
exit 0
