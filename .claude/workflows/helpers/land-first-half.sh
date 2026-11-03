#!/usr/bin/env bash
# land-first-half.sh <PR> <branch> <expected-head>  — DR-037 landing chain, first half (merge mainline, regenerate, gates, push).
# Second half (merge via the GitHub tool + record comment) is done by the brain after the gating check passes on the pushed head.
# How it fails (round 34): `set -euo pipefail`, so a generator behind a pipe cannot fail unseen; the landing worktree must be CLEAN before anything is checked out or `git add -A` runs, so a change that is not the
# generators' cannot ride a regeneration commit; the push is decided by the captured exit codes of preflight and breadth, never by what their logs say. Bash 3.2-safe (no arrays; ${ARGS+"${ARGS[@]}"} if one is added).
# Exit codes: 2 fetch failed, 3 head moved, 4 worktree/checkout, 5 merge conflict, 6 install failed, 7 gates red, 8 push failed, 9 worktree dirty, 10 a generator failed, 64 usage.
set -euo pipefail
[ "$#" -eq 3 ] || { echo "usage: land-first-half.sh <PR> <branch> <expected-head>" >&2; exit 64; }
PR=$1; BR=$2; EXP=$3
S=${SIGNALGRID_SCRATCH:?set SIGNALGRID_SCRATCH to the session scratchpad (absolute path)}
REPO=${SIGNALGRID_REPO:-$(git rev-parse --show-toplevel)}
WT=$S/wt-$PR
LOG=$S/land-$PR.log
exec > >(tee -a "$LOG") 2>&1
echo "== land #$PR $BR expected $EXP  $(date -u +%FT%TZ)"
git -C "$REPO" fetch -q origin SignalGrid_Alpha "+refs/heads/$BR:refs/remotes/origin/$BR" || { echo "FETCH FAILED"; exit 2; }
H=$(git -C "$REPO" rev-parse "origin/$BR"); [ "$H" = "$EXP" ] || { echo "HEAD MOVED: origin/$BR=$H expected $EXP — stop"; exit 3; }
if [ ! -d "$WT" ]; then git -C "$REPO" worktree add --detach "$WT" "origin/$BR" || exit 4; fi
cd "$WT" || exit 4
DIRTY=$(git status --porcelain) || { echo "STATUS FAILED in $WT"; exit 4; }
[ -z "$DIRTY" ] || { echo "WORKTREE DIRTY: $WT holds changes that are not this landing's; commit or move them (never git add -A over them) — stop"; echo "$DIRTY" | head -20 || true; exit 9; }
git checkout -q --detach "origin/$BR" || { echo "CHECKOUT FAILED"; exit 4; }
git merge --no-edit origin/SignalGrid_Alpha || { echo "MERGE CONFLICT — stop, resolve by hand keeping both sides"; git status --short | head -20 || true; exit 5; }
pnpm install --frozen-lockfile --offline >/dev/null 2>&1 || pnpm install --frozen-lockfile >/dev/null 2>&1 || { echo "INSTALL FAILED"; exit 6; }
node scripts/generate-sync-manifest.mjs | tail -2 || { echo "MANIFEST GENERATOR FAILED (exit ${PIPESTATUS[0]})"; exit 10; }
if [ -n "$(git status --porcelain)" ]; then git add -A; git commit -q -m "chore: regenerate the live-sync manifest on the merged tree (#$PR landing)"; echo "committed manifest regen"; fi
node scripts/check-surface-review-coverage.mjs --write | tail -2 || { echo "COVERAGE GENERATOR FAILED (exit ${PIPESTATUS[0]})"; exit 10; }
if [ -n "$(git status --porcelain)" ]; then git add -A; git commit -q -m "chore: regenerate the surface-review coverage page on the merged tree (#$PR landing)"; echo "committed coverage regen"; fi
PF=0; BD=0
echo "== preflight $(date -u +%TZ)"; node scripts/preflight.mjs > "$S/land-$PR-preflight.log" 2>&1 || PF=$?; tail -3 "$S/land-$PR-preflight.log"
echo "== breadth $(date -u +%TZ)"; pnpm run verify:breadth > "$S/land-$PR-breadth.log" 2>&1 || BD=$?; tail -3 "$S/land-$PR-breadth.log"
{ [ "$PF" -eq 0 ] && [ "$BD" -eq 0 ]; } || { echo "GATES RED (preflight exit $PF, breadth exit $BD) — not pushing"; exit 7; }
NEW=$(git rev-parse HEAD)
git push origin "HEAD:refs/heads/$BR" || { echo "PUSH FAILED"; exit 8; }
echo "== pushed $NEW to $BR $(date -u +%TZ) — wait for the gating check, then merge with expectedHeadSha=$NEW"
echo "PREFLIGHT: exit $PF; $(grep -m1 'Preflight PASSED' "$S/land-$PR-preflight.log" || echo 'no PASSED line in the log')"; echo "BREADTH: exit $BD; $(grep -m1 'Breadth lane PASSED' "$S/land-$PR-breadth.log" || echo 'no PASSED line in the log')"
