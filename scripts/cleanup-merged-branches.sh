#!/usr/bin/env bash
# Delete remote branches that are FULLY CONTAINED in the base branch.
#
#   ./scripts/cleanup-merged-branches.sh            # show what would be deleted
#   ./scripts/cleanup-merged-branches.sh --apply    # actually delete them
#
# WHY THIS IS A SCRIPT AND NOT A LIST. A hand-written list of branches to delete
# is a fossil the moment someone opens a new PR — the same defect class the
# registry-drift guard exists to prevent elsewhere in this repo. So the deletion
# set is DERIVED, from two independent signals:
#
#   1. `git branch -r --merged` — every commit on the branch is already in the
#      base. Unconditionally safe: there is nothing to lose.
#   2. The branch's pull request is MERGED, per GitHub. This repo SQUASH-merges,
#      which rewrites the branch's commits into one new commit — so a
#      squash-merged branch NEVER satisfies (1), and a git-containment-only
#      script would quietly never clean up anything this workflow produces.
#      Signal (2) is the one that matches how the work actually lands.
#
# Signal (2) needs the `gh` CLI. Without it the script degrades to (1) alone and
# says so, rather than reporting a tidy-looking empty result.
#
# PROTECTED names are excluded on top of both, because "already merged" is true
# of the long-lived environment branches too and they must survive anyway.

set -euo pipefail

BASE="${BASE:-SignalGrid_Alpha}"
REMOTE="${REMOTE:-origin}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# Long-lived branches that are merged by construction and must never be deleted.
# Dependabot branches are excluded too: Dependabot owns their lifecycle, and
# deleting one out from under it makes it re-open the same PR.
PROTECTED='^(SignalGrid_Alpha|alpha|beta|dev|prod|main|master)$'
BOT_PREFIX='^dependabot/'

git fetch --prune "$REMOTE" >/dev/null 2>&1

mapfile -t MERGED < <(
  git branch -r --merged "$REMOTE/$BASE" \
    | sed "s|^ *$REMOTE/||" \
    | grep -v '^HEAD' \
    | grep -Ev "$PROTECTED" \
    | grep -Ev "$BOT_PREFIX" \
    | sort
)

OPEN_HEADS=()
SQUASHED=()
if command -v gh >/dev/null 2>&1; then
  # Never delete a branch that still has an OPEN pull request, even if its commits
  # are all in the base — deleting the head branch closes the PR.
  mapfile -t OPEN_HEADS < <(gh pr list --state open --json headRefName -q '.[].headRefName' 2>/dev/null || true)
  # Signal (2): branches whose PR GitHub reports as merged. Squash merges land here
  # and nowhere else.
  mapfile -t SQUASHED < <(
    gh pr list --state merged --limit 200 --json headRefName,headRepositoryOwner \
      -q '.[] | select(.headRepositoryOwner.login != null) | .headRefName' 2>/dev/null || true
  )
else
  echo "note: gh CLI not found. Falling back to git-containment only — because this" >&2
  echo "      repo SQUASH-merges, that will MISS every branch merged through a PR." >&2
  echo "      Install gh for a complete cleanup." >&2
fi

CANDIDATES=("${MERGED[@]}")
for b in ${SQUASHED+"${SQUASHED[@]}"}; do
  [[ -z "$b" ]] && continue
  # Only branches that still exist on the remote, and never a protected one.
  git show-ref --verify --quiet "refs/remotes/$REMOTE/$b" || continue
  [[ "$b" =~ $PROTECTED || "$b" =~ $BOT_PREFIX ]] && continue
  CANDIDATES+=("$b")
done
mapfile -t CANDIDATES < <(printf '%s\n' ${CANDIDATES+"${CANDIDATES[@]}"} | sort -u)

TO_DELETE=()
for b in ${CANDIDATES+"${CANDIDATES[@]}"}; do
  skip=0
  for open in ${OPEN_HEADS+"${OPEN_HEADS[@]}"}; do
    [[ "$b" == "$open" ]] && skip=1 && break
  done
  (( skip )) || TO_DELETE+=("$b")
done

if (( ${#TO_DELETE[@]} == 0 )); then
  echo "Nothing to clean up: no fully-merged, unprotected branches remain."
  exit 0
fi

echo "Safe to delete (${#TO_DELETE[@]}) — all commits already in $BASE, or the PR is merged:"
printf '  %s\n' "${TO_DELETE[@]}"

# Report what is being LEFT BEHIND and why. A cleanup that silently skips
# branches reads as "everything is tidy" when it is not.
echo
echo "Left alone (unique commits not in $BASE — deleting these would lose work):"
git for-each-ref --format='%(refname:short)' "refs/remotes/$REMOTE" \
  | grep -v HEAD | sed "s|^$REMOTE/||" \
  | while read -r b; do
      n=$(git rev-list --count "$REMOTE/$BASE..$REMOTE/$b" 2>/dev/null || echo 0)
      [[ "$n" != "0" ]] && echo "  $b (ahead $n)"
    done || true

if (( ! APPLY )); then
  echo
  echo "Dry run. Re-run with --apply to delete the ${#TO_DELETE[@]} merged branches above."
  exit 0
fi

echo
for b in "${TO_DELETE[@]}"; do
  git push "$REMOTE" --delete "$b" && echo "deleted $b"
done
