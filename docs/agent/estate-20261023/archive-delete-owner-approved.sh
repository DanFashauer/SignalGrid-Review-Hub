#!/usr/bin/env bash
# archive-delete-owner-approved.sh -- NOT EXECUTED by the planner. measuredAt: 2026-10-23T23:05:00Z
# For ESTATE_PLAN_20261023.md section 6 step 9. Deletes ONLY branches the owner recorded as abandoned,
# i.e. the uncommented "<branch> <tip>" lines of the file given as $1 (owner-abandon-candidates.txt).
# Each: tip must equal the measured tip; no open PR may use it; never SignalGrid_Alpha, lane/mailbox,
# mac/build-row-*, dependabot/*. The tip is tagged archive/<branch> and READ BACK before the delete
# (docs/BRANCH_HYGIENE.md); a tag that fails leaves the branch alone. The delete itself carries a lease
# on the approved tip, so a branch that moved after the read is refused, never deleted. Idempotent. Bash 3.2 safe.
#   bash archive-delete-owner-approved.sh owner-abandon-candidates.txt "owner said X at <UTC>"           # dry run
#   bash archive-delete-owner-approved.sh owner-abandon-candidates.txt "owner said X at <UTC>" --apply
set -u
REPO="DanFashauer/SignalGrid-Review-Hub"
F="${1:-}"; WHO="${2:-}"; APPLY=0; [ "${3:-}" = "--apply" ] && APPLY=1
[ -f "$F" ] || { echo "REFUSE: no approval file"; exit 2; }
[ -n "$WHO" ] || { echo "REFUSE: name the owner's recorded decision (who, what, when) as \$2"; exit 2; }
git fetch --prune origin >/dev/null 2>&1 || { echo "REFUSE: git fetch failed"; exit 2; }
remote_sha() { # exact ref match; peeled sha for an annotated tag, else the direct sha; exit 2 when the read FAILED
  out=$(git ls-remote origin "$1" </dev/null 2>/dev/null) || return 2
  printf '%s\n' "$out" | awk -v r="$1" '$2==r"^{}"{p=$1} $2==r{d=$1} END{if(p!="")print p; else if(d!="")print d}'
}
DELETED=0; DONE=0; SKIPPED=0; WOULD=0
while read -r b tip rest; do
  case "$b" in ''|'#'*) continue;; esac
  case "$b" in SignalGrid_Alpha|lane/mailbox|mac/build-row-*|dependabot/*) echo "SKIP    $b is never deleted"; SKIPPED=$((SKIPPED+1)); continue;; esac
  live=$(remote_sha "refs/heads/$b") || { echo "SKIP    $b ls-remote failed (a failed read is not absence)"; SKIPPED=$((SKIPPED+1)); continue; }
  if [ -z "$live" ]; then echo "DONE    $b (already absent)"; DONE=$((DONE+1)); continue; fi
  if [ "$live" != "$tip" ]; then echo "SKIP    $b tip moved: $live != $tip (owner approved a different state)"; SKIPPED=$((SKIPPED+1)); continue; fi
  n=$(gh api "repos/$REPO/pulls?state=open&head=DanFashauer:$b&per_page=100" --jq 'length' </dev/null 2>/dev/null) || n="ERR"
  if [ "$n" != "0" ]; then echo "SKIP    $b open-PR check: $n"; SKIPPED=$((SKIPPED+1)); continue; fi
  if [ "$APPLY" != "1" ]; then echo "WOULD   $b"; WOULD=$((WOULD+1)); continue; fi
  tag="archive/$b"
  have=$(remote_sha "refs/tags/$tag") || have="ERR"
  if [ -z "$have" ]; then git push origin "$tip:refs/tags/$tag" </dev/null >/dev/null 2>&1; have=$(remote_sha "refs/tags/$tag") || have="ERR"; fi
  if [ "$have" != "$tip" ]; then echo "SKIP    $b archive tag missing or wrong"; SKIPPED=$((SKIPPED+1)); continue; fi
  # The delete carries a LEASE on the approved tip: if any lane pushed to the branch between the
  # read above and this push, the remote refuses it ("stale info") and nothing is deleted.
  if ! git push --force-with-lease="refs/heads/$b:$tip" origin ":refs/heads/$b" </dev/null >/dev/null 2>&1; then
    echo "SKIP    $b delete refused: the remote tip moved after the read, or the push failed (lease on $tip); nothing deleted"; SKIPPED=$((SKIPPED+1)); continue
  fi
  still=$(remote_sha "refs/heads/$b") || still="ERR"
  if [ -n "$still" ]; then echo "FAIL    $b still present"; SKIPPED=$((SKIPPED+1)); continue; fi
  # The restore command must resolve in ANY clone: fetch the archive tag (the tip's object) first, then
  # push the saved tip sha as the source. A remote-only tag name is not a valid local push source.
  echo "DELETED $b (restore: git fetch origin refs/tags/$tag:refs/tags/$tag && git push origin $tip:refs/heads/$b)"; DELETED=$((DELETED+1))
done < "$F"
echo "== abandoned ($WHO): deleted=$DELETED done-already=$DONE would-delete=$WOULD skipped=$SKIPPED"
[ "$SKIPPED" = "0" ] || exit 1
