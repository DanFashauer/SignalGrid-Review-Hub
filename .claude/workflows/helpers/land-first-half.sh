#!/usr/bin/env bash
# land-first-half.sh <PR> <branch> <expected-head>  — DR-037 landing chain, first half (merge mainline, regenerate, gates, push).
# Second half (merge via the GitHub tool + record comment) is done by the brain after the gating check passes on the pushed head.
set -u
PR=$1; BR=$2; EXP=$3
S=${SIGNALGRID_SCRATCH:?set SIGNALGRID_SCRATCH to the session scratchpad (absolute path)}
REPO=${SIGNALGRID_REPO:-$(git rev-parse --show-toplevel)}
WT=$S/wt-$PR
LOG=$S/land-$PR.log
exec > >(tee -a "$LOG") 2>&1
echo "== land #$PR $BR expected $EXP  $(date -u +%FT%TZ)"
git -C $REPO fetch -q origin SignalGrid_Alpha "+refs/heads/$BR:refs/remotes/origin/$BR" || { echo "FETCH FAILED"; exit 2; }
H=$(git -C $REPO rev-parse "origin/$BR"); [ "$H" = "$EXP" ] || { echo "HEAD MOVED: origin/$BR=$H expected $EXP — stop"; exit 3; }
if [ ! -d "$WT" ]; then git -C $REPO worktree add --detach "$WT" "origin/$BR" || exit 4; fi
cd "$WT" || exit 4
git checkout -q --detach "origin/$BR"
git merge --no-edit origin/SignalGrid_Alpha || { echo "MERGE CONFLICT — stop, resolve by hand keeping both sides"; git status --short | head -20; exit 5; }
pnpm install --frozen-lockfile --offline >/dev/null 2>&1 || pnpm install --frozen-lockfile >/dev/null 2>&1 || { echo "INSTALL FAILED"; exit 6; }
node scripts/generate-sync-manifest.mjs | tail -2
[ -z "$(git status --porcelain)" ] || { git add -A && git commit -q -m "chore: regenerate the live-sync manifest on the merged tree (#$PR landing)" && echo "committed manifest regen"; }
node scripts/check-surface-review-coverage.mjs --write | tail -2
[ -z "$(git status --porcelain)" ] || { git add -A && git commit -q -m "chore: regenerate the surface-review coverage page on the merged tree (#$PR landing)" && echo "committed coverage regen"; }
echo "== preflight $(date -u +%TZ)"; node scripts/preflight.mjs > $S/land-$PR-preflight.log 2>&1; PF=$?; tail -3 $S/land-$PR-preflight.log
echo "== breadth $(date -u +%TZ)"; pnpm run verify:breadth > $S/land-$PR-breadth.log 2>&1; BD=$?; tail -3 $S/land-$PR-breadth.log
grep -q "Preflight PASSED" $S/land-$PR-preflight.log && grep -q "Breadth lane PASSED" $S/land-$PR-breadth.log || { echo "GATES RED (preflight exit $PF, breadth exit $BD) — not pushing"; exit 7; }
NEW=$(git rev-parse HEAD)
git push origin "HEAD:refs/heads/$BR" || { echo "PUSH FAILED"; exit 8; }
echo "== pushed $NEW to $BR $(date -u +%TZ) — wait for the gating check, then merge with expectedHeadSha=$NEW"
echo "PREFLIGHT: $(grep -m1 'Preflight PASSED' $S/land-$PR-preflight.log)"; echo "BREADTH: $(grep -m1 'Breadth lane PASSED' $S/land-$PR-breadth.log)"
