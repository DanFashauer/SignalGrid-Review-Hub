#!/usr/bin/env bash
# delete-zero-loss-verified.sh -- NOT EXECUTED by the planner.
# Generated for ESTATE_PLAN_20261023.md (measuredAt 2026-10-23T23:05:00Z). Replaces delete-zero-loss.sh,
# which still lists claude/land-mac-1248: the verifier REFUTED that one, so it is NOT here.
# Each branch is re-checked at run time and SKIPPED (fail closed) on any doubt:
#   tip moved since measuredAt | an open PR uses it as head | a PR lookup errored |
#   not an ancestor of mainline AND git cherry shows a '+' | a merge commit in its unique
#   range carries a hunk neither parent has | the archive tag cannot be created or read back |
#   the remote tip moved between the read and the delete (the delete carries a lease on the measured tip).
# Idempotent: a branch already gone prints DONE. Bash 3.2 safe. Commands in the loop read /dev/null so they cannot eat the list.
#   bash delete-zero-loss-verified.sh           # dry run, deletes nothing
#   bash delete-zero-loss-verified.sh --apply   # archive tag archive/<branch>, read it back, then delete under lease
set -u
REPO="DanFashauer/SignalGrid-Review-Hub"
MAIN="origin/SignalGrid_Alpha"
APPLY=0; [ "${1:-}" = "--apply" ] && APPLY=1
git fetch --prune origin >/dev/null 2>&1 || { echo "REFUSE: git fetch failed; nothing done"; exit 2; }
# Every zero-loss check below compares against mainline. In a single-branch clone the fetch succeeds
# but $MAIN never exists; git cherry / rev-list then FAIL, and a failed check must never read as a pass.
git rev-parse --verify --quiet "$MAIN^{commit}" >/dev/null 2>&1 || { echo "REFUSE: $MAIN does not resolve in this checkout (single-branch clone?); the zero-loss checks need mainline. Nothing done"; exit 2; }
[ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ] && echo "WARN: shallow clone; a refusal here may be conservative, a pass is reliable"
remote_sha() { # exact ref match; peeled sha for an annotated tag, else the direct sha; exit 2 when the read FAILED
  out=$(git ls-remote origin "$1" </dev/null 2>/dev/null) || return 2
  printf '%s\n' "$out" | awk -v r="$1" '$2==r"^{}"{p=$1} $2==r{d=$1} END{if(p!="")print p; else if(d!="")print d}'
}
DONE=0; DELETED=0; SKIPPED=0; WOULD=0
while read -r b tip; do
  [ -z "$b" ] && continue
  live=$(remote_sha "refs/heads/$b") || { echo "SKIP    $b ls-remote failed (a failed read is not absence)"; SKIPPED=$((SKIPPED+1)); continue; }
  if [ -z "$live" ]; then echo "DONE    $b (already absent)"; DONE=$((DONE+1)); continue; fi
  if [ "$live" != "$tip" ]; then echo "SKIP    $b tip moved: $live != measured $tip"; SKIPPED=$((SKIPPED+1)); continue; fi
  n=$(gh api "repos/$REPO/pulls?state=open&head=DanFashauer:$b&per_page=100" --jq 'length' </dev/null 2>/dev/null) || n="ERR"
  if [ "$n" != "0" ]; then echo "SKIP    $b open-PR check: $n (an error is not an empty result)"; SKIPPED=$((SKIPPED+1)); continue; fi
  # Each history command's exit status is checked on its own: a command that FAILS (unknown ref,
  # missing object, bad clone) is a SKIP, never an empty answer that counts as "nothing unique".
  if git merge-base --is-ancestor "$tip" "$MAIN" 2>/dev/null; then :; else
    rc=$?
    if [ "$rc" != "1" ]; then echo "SKIP    $b merge-base failed (exit $rc); a failed check is not a pass"; SKIPPED=$((SKIPPED+1)); continue; fi
    cherry=$(git cherry "$MAIN" "$tip" 2>/dev/null) || { echo "SKIP    $b git cherry failed; a failed check is not a pass"; SKIPPED=$((SKIPPED+1)); continue; }
    plus=$(printf '%s\n' "$cherry" | grep -c '^+')
    if [ "$plus" != "0" ]; then echo "SKIP    $b has $plus unapplied patch(es)"; SKIPPED=$((SKIPPED+1)); continue; fi
    merges=$(git rev-list --merges "$MAIN..$tip" 2>/dev/null) || { echo "SKIP    $b git rev-list failed; a failed check is not a pass"; SKIPPED=$((SKIPPED+1)); continue; }
    bad=0
    for m in $merges; do
      hunk=$(git diff-tree --cc --no-commit-id "$m" 2>/dev/null) || { bad=2; break; }
      [ -n "$hunk" ] && bad=1
    done
    if [ "$bad" = "2" ]; then echo "SKIP    $b git diff-tree failed; a failed check is not a pass"; SKIPPED=$((SKIPPED+1)); continue; fi
    if [ "$bad" = "1" ]; then echo "SKIP    $b a merge commit carries its own hunk"; SKIPPED=$((SKIPPED+1)); continue; fi
  fi
  if [ "$APPLY" != "1" ]; then echo "WOULD   $b (tag archive/$b at $tip, then delete)"; WOULD=$((WOULD+1)); continue; fi
  tag="archive/$b"
  have=$(remote_sha "refs/tags/$tag") || have="ERR"
  if [ -z "$have" ]; then git push origin "$tip:refs/tags/$tag" </dev/null >/dev/null 2>&1; have=$(remote_sha "refs/tags/$tag") || have="ERR"; fi
  if [ "$have" != "$tip" ]; then echo "SKIP    $b archive tag missing or wrong ($have)"; SKIPPED=$((SKIPPED+1)); continue; fi
  # The delete carries a LEASE on the measured tip: if any lane pushed to the branch between the
  # read above and this push, the remote refuses it ("stale info") and nothing is deleted.
  if ! git push --force-with-lease="refs/heads/$b:$tip" origin ":refs/heads/$b" </dev/null >/dev/null 2>&1; then
    echo "SKIP    $b delete refused: the remote tip moved after the read, or the push failed (lease on $tip); nothing deleted"; SKIPPED=$((SKIPPED+1)); continue
  fi
  still=$(remote_sha "refs/heads/$b") || still="ERR"
  if [ -n "$still" ]; then echo "FAIL    $b still present after delete"; SKIPPED=$((SKIPPED+1)); continue; fi
  # The restore command must resolve in ANY clone: fetch the archive tag (the tip's object) first, then
  # push the saved tip sha as the source. A remote-only tag name is not a valid local push source.
  echo "DELETED $b (restore: git fetch origin refs/tags/$tag:refs/tags/$tag && git push origin $tip:refs/heads/$b)"; DELETED=$((DELETED+1))
done <<'LIST'
claude/build-carrier-topology-finding d68b4916cbc59905c9113fb4ccd6b14c170a3012
claude/build-gate-survivors-liveness-scratch-git 531e141fdc7a4a1ce9b5154baa43c6f1e4254a49
claude/land-mac-tier1-downgrade 72165d7de8950458e96ef4e23aa551fd1c0384ce
claude/loop-state-20260914-1700Z a7349016b3e0641db511d82a6a919ffbec4c3f2d
land/1052 4a987e82b98eafc410f27bfbed03ff0f63102a19
land/1061 3fcf7da52679af169b9e509f1a085dc1cd7eabf5
land/1067 5a45a79112daf87c7b5ba5d538944ab5e052c799
lane/cloud-puck1-attach-domain-20260912-1040Z 8edaa68ed857f1d5f91f516e4c13b2237b289abc
lane/cloud-puck4-smart-charging-20260912-1040Z 8edaa68ed857f1d5f91f516e4c13b2237b289abc
mac/pr-1216-fix-backup 5a2701745129494ca3ad59d1841a9153748d6e2b
LIST
echo "== zero-loss: deleted=$DELETED done-already=$DONE would-delete=$WOULD skipped=$SKIPPED (of 10)"
[ "$SKIPPED" = "0" ] || exit 1
