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
# TWO MORE CLOSED 2026-09-05 (eighth round, both reproduced):
#   4. Valid JSON whose command field was ABSENT or renamed (`{"tool_input":
#      {"cmd":…}}`, `{"toolInput":{"command":…}}`) read as an empty command and
#      was allowed — hole 3 covered invalid JSON only. Absent is now a deny.
#   5. `deny()` was itself jq, so with jq off PATH the deny could not be
#      emitted and the hook exited 0 = allow. jq's absence is now a deny
#      printed WITHOUT jq, and stdin is read with a builtin so the check runs
#      even when no external command can be found.
# And the pattern list now matches .claude/settings.json's Bash deny list
# exactly (`sudo` and `git branch -D` were in settings and not here) —
# `scripts/check-hook-denylist.mjs` holds the two lists to each other.
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
  # Case-SENSITIVE: `git branch -d` (safe, merged-only) is not `git branch -D`.
  for p in "rm -rf" "git push --force" "git push -f" "--no-verify" "git stash" "git reset --hard" "git branch -D" "sudo"; do
    if printf '%s' "$stripped" | grep -qE -- "(^|[^A-Za-z0-9_-])${p}([^A-Za-z0-9_-]|$)"; then
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
  expect_deny "sudo rm /etc/passwd"
  expect_deny "git branch -D main"
  expect_allow "git branch -d merged-topic"
  expect_allow "echo 'sudo is not available here'"
  # The input path: unreadable stdin must DENY, and a well-formed harmless call must ALLOW.
  if printf 'not json' | bash "$0" | grep -q '"deny"'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ unreadable stdin should DENY"; fi
  if [ -z "$(printf '{"tool_input":{"command":"ls -la"}}' | bash "$0")" ]; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ a harmless command should ALLOW"; fi
  if printf '{"tool_input":{"command":"bash -c '"'"'rm -rf /tmp/x'"'"'"}}' | bash "$0" | grep -q '"deny"'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ a wrapped rm -rf through stdin should DENY"; fi
  # Hole 4: valid JSON with the command field absent or renamed must DENY.
  if printf '{"tool_input":{"cmd":"rm -rf /"}}' | bash "$0" | grep -q '"deny"'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ valid JSON with NO command field should DENY"; fi
  if printf '{"toolInput":{"command":"rm -rf /"}}' | bash "$0" | grep -q '"deny"'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ valid JSON with a renamed wrapper should DENY"; fi
  # Hole 5: with jq unreachable the hook must still DENY, and say why.
  if printf '{"tool_input":{"command":"ls"}}' | PATH=/nonexistent /bin/bash "$0" | grep -q 'jq'; then pass=$((pass + 1)); else fail=$((fail + 1)); echo "  ✗ jq missing from PATH should DENY with a reason naming jq"; fi
  echo "block-dangerous self-test: ${pass} passed, ${fail} failed"
  [ "$fail" -eq 0 ] || exit 1
  exit 0
fi

# Read stdin with a BUILTIN so this runs even when no external command resolves.
input=""
while IFS= read -r line || [ -n "$line" ]; do
  input="${input}${line}
"
done
if ! command -v jq >/dev/null 2>&1; then
  # Emitted without jq on purpose — jq being absent is the case being handled.
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: jq is not on PATH, so the deny list cannot read its input. Install jq; an unreadable input is never allowed."}}'
  exit 0
fi
if ! printf '%s' "$input" | jq -e . >/dev/null 2>&1; then
  deny "Blocked: the hook could not read its input as JSON, so it cannot judge the command. Unreadable is not allowed; report the problem."
  exit 0
fi
# The command field must EXIST as a string. Absent or renamed is not "empty command"
# — it is input this hook cannot judge, and unknown never loosens the answer.
present=$(printf '%s' "$input" | jq -r 'if (.tool_input|type)=="object" and (.tool_input|has("command")) and (.tool_input.command|type)=="string" then "yes" else "no" end')
if [ "$present" != "yes" ]; then
  deny "Blocked: the hook input carries no tool_input.command string, so it cannot judge the command. Report the problem."
  exit 0
fi
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command')
[ -z "$cmd" ] && exit 0
if p=$(judge "$cmd"); then
  deny "Blocked: matches forbidden pattern ${p}. Report the problem instead of working around it."
  exit 0
fi
exit 0
