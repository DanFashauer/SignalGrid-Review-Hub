#!/bin/bash
# PreToolUse hook on Bash — the deny list, enforced before execution
# (2026-08-28 handoff, installed under DR-021). Matches whole commands, so a
# doc edit MENTIONING a forbidden pattern is untouched; only Bash tool calls
# pass through here.
#
#   bash .claude/hooks/block-dangerous.sh --self-test   # prove it can fail
#
# THREE HOLES CLOSED 2026-09-05 (sixth audit round, each reproduced against
# the previous version of this file):
#   1. Quoted spans were stripped before matching so a commit message naming
#      a forbidden command would not trip the guard — correct — but a WRAPPED
#      command lives in a quoted span too: `bash -c 'rm -rf /tmp/x'` was
#      allowed, and so was every other pattern behind `sh -c`. The `-c`
#      payload of sh/bash/zsh/dash is now unwrapped (to a fixpoint, so a
#      wrapper inside a wrapper is unwrapped too) BEFORE quotes are stripped.
#   2. Whitespace was matched literally, so `git push  --force` (two spaces)
#      or a tab was allowed. Whitespace is collapsed first.
#   3. Unreadable stdin (not JSON) made `cmd` empty and the loop matched
#      nothing — the hook ALLOWED whatever it could not read. Unreadable input
#      is now a deny, with the reason. Unknown must never loosen the answer.
# Still NOT caught, said plainly: a pattern assembled from a variable
# (`F=--force; git push $F`) or split across a here-doc. This is a nudge
# layer, not a security boundary; the permission classifier is the boundary.

deny() {
  jq -nc --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse", permissionDecision:"deny", permissionDecisionReason:$r}}'
}

# Print the first forbidden pattern found in $1, or nothing (exit 1) if none.
judge() {
  cmd=$1
  norm=$(printf '%s' "$cmd" | tr '\n\t' '  ' | sed -E 's/ +/ /g')
  unwrapped=$norm
  i=0
  while [ "$i" -lt 4 ]; do
    # `-c`, `-lc`, `-ec`, `-x -c` … any flag cluster ending in c introduces the payload.
    next=$(printf '%s' "$unwrapped" | sed -E "s/(^| )(sh|bash|zsh|dash) (-[A-Za-z]+ )*-[A-Za-z]*c '([^']*)'/\1\2 -c \4/g; s/(^| )(sh|bash|zsh|dash) (-[A-Za-z]+ )*-[A-Za-z]*c \"([^\"]*)\"/\1\2 -c \4/g")
    [ "$next" = "$unwrapped" ] && break
    unwrapped=$next
    i=$((i + 1))
  done
  # Match INVOCATIONS, not mentions: strip the remaining quoted spans, so a
  # commit message or doc text that NAMES a forbidden command does not trip the
  # guard. (The first version blocked its own installing commit — the message
  # quoted the pattern it denies.)
  stripped=$(printf '%s' "$unwrapped" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
  # Whole-token matches: `git stash` must not fire on `git stash-list-helper`,
  # so each pattern is bounded by non-word characters (or the ends of the line).
  for p in "rm -rf" "git push --force" "git push -f" "--no-verify" "git stash" "git reset --hard"; do
    if printf '%s' "$stripped" | grep -qiE -- "(^|[^A-Za-z0-9_-])${p}([^A-Za-z0-9_-]|$)"; then
      printf '%s' "$p"
      return 0
    fi
  done
  return 1
}

if [ "${1:-}" = "--self-test" ]; then
  pass=0
  fail=0
  expect_deny() {
    if judge "$1" >/dev/null; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ should DENY:  $1"; fi
  }
  expect_allow() {
    if judge "$1" >/dev/null; then fail=$((fail + 1)); echo "  ✗ should ALLOW: $1"; else pass=$((pass + 1)); fi
  }
  expect_deny "rm -rf /tmp/x"
  expect_deny "bash -c 'rm -rf /tmp/x'"
  expect_deny "sh -c \"git push --force origin HEAD\""
  expect_deny "bash -lc 'git stash'"
  expect_deny "bash -c 'sh -c \"git reset --hard\"'"
  expect_deny "git push  --force origin HEAD"
  expect_deny "git push -f origin HEAD"
  expect_deny "git commit --no-verify -m x"
  expect_allow "git commit -m 'never run rm -rf here'"
  expect_allow "echo \"git push --force is banned\""
  expect_allow "git push -u origin HEAD"
  expect_allow "rm -r build"
  expect_allow "git stash-list-helper"
  # The input path: unreadable stdin must DENY, and a well-formed harmless call must ALLOW.
  if printf 'not json' | bash "$0" | grep -q '"deny"'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ unreadable stdin should DENY"; fi
  if [ -z "$(printf '{"tool_input":{"command":"ls -la"}}' | bash "$0")" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ a harmless command should ALLOW"; fi
  if printf '{"tool_input":{"command":"bash -c '"'"'rm -rf /tmp/x'"'"'"}}' | bash "$0" | grep -q '"deny"'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ a wrapped rm -rf through stdin should DENY"; fi
  echo "block-dangerous self-test: ${pass} passed, ${fail} failed"
  [ "$fail" -eq 0 ] || exit 1
  exit 0
fi

input=$(cat)
if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  deny "Blocked: the hook could not read its input as JSON, so it cannot judge the command. Unreadable is not allowed; report the problem."
  exit 0
fi
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && exit 0
if p=$(judge "$cmd"); then
  deny "Blocked: matches forbidden pattern ${p}. Report the problem instead of working around it."
  exit 0
fi
exit 0
