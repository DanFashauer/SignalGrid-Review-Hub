#!/usr/bin/env bash
# 01 — Build a local `dev` branch whose TREE is the validated consolidation and
# whose ANCESTRY includes the SignalGrid (old home) and DEV histories, via an
# `-s ours` merge (keeps the tree byte-for-byte identical). Local only — pushes
# happen in 02.
. "$(dirname "$0")/_env.sh"
require_git; require_gh

banner "Phase 6 · 01 — Build consolidated history"

WORK="${WORK:-$(mktemp -d)}"
MONO="$WORK/mono"
log "Work dir: $MONO"

run "Clone consolidation source ($REVIEWHUB_REPO)" \
  git clone "https://github.com/$REVIEWHUB_REPO" "$MONO"

if [ "$DRY_RUN" = "1" ]; then
  cat <<EOF
[dry-run] would then, inside $MONO:
  git checkout $CONSOLIDATION_REF
  git remote add home       https://github.com/$HOME_REPO
  git remote add dev-source https://github.com/$DEV_REPO
  git fetch home dev-source
  git merge -s ours --allow-unrelated-histories --no-edit \\
      home/$OLD_SIGNALGRID_MAIN dev-source/$DEV_MAIN -m "<consolidation msg>"
  git branch -f dev
  # GATE: assert dev^{tree} == $CONSOLIDATION_REF^{tree}
EOF
  exit 0
fi

cd "$MONO" || die "cannot enter $MONO"
git checkout "$CONSOLIDATION_REF"
CONSOLIDATION_TREE="$(git rev-parse "$CONSOLIDATION_REF^{tree}")"

git remote add home       "https://github.com/$HOME_REPO"
git remote add dev-source "https://github.com/$DEV_REPO"
git fetch home dev-source

git merge -s ours --allow-unrelated-histories --no-edit \
  "home/$OLD_SIGNALGRID_MAIN" "dev-source/$DEV_MAIN" \
  -m "Consolidate SignalGrid + DEV history into the monorepo

Tree is the validated Review-Hub consolidation, unchanged. The -s ours merge
attaches the SignalGrid (old home) and DEV histories as ancestry so git log
retains every source commit and author."

git branch -f dev
DEV_TREE="$(git rev-parse "dev^{tree}")"

echo ""
git log --oneline --graph -4 dev || true
echo ""

# GATE — tree must be unchanged.
if [ "$DEV_TREE" = "$CONSOLIDATION_TREE" ]; then
  ok "Tree unchanged ($DEV_TREE). History attached."
  # Confirm ancestry actually reaches all three sources.
  for src in "home/$OLD_SIGNALGRID_MAIN" "dev-source/$DEV_MAIN" "$CONSOLIDATION_REF"; do
    if git merge-base --is-ancestor "$src" dev; then ok "ancestry includes $src"; else warn "ancestry MISSING $src"; fi
  done
  echo ""
  ok "Local dev ready in: $MONO"
  echo "   Export it for step 02:  export MONO=$MONO"
else
  die "STOP: dev tree ($DEV_TREE) != consolidation tree ($CONSOLIDATION_TREE). The -s ours merge changed content."
fi
