#!/usr/bin/env bash
# 02 — Create the four tier branches (all == dev), push them to the home repo,
# and set `dev` as the default branch. Requires MONO from step 01.
. "$(dirname "$0")/_env.sh"
require_git; require_gh

banner "Phase 6 · 02 — Create & push tier branches"

MONO="${MONO:-}"
[ -n "$MONO" ] && [ -d "$MONO/.git" ] || die "Set MONO to the repo from step 01, e.g. export MONO=/tmp/…/mono"
cd "$MONO" || die "cannot enter $MONO"

git rev-parse --verify dev >/dev/null 2>&1 || die "Local 'dev' branch not found — run 01 first."

# Point the 'home' remote at the push target.
if git remote get-url home >/dev/null 2>&1; then
  run "Set home remote → $HOME_REPO" git remote set-url home "https://github.com/$HOME_REPO"
else
  run "Add home remote → $HOME_REPO" git remote add home "https://github.com/$HOME_REPO"
fi

for tier in "${TIERS[@]}"; do
  run "Create branch $tier (= dev)" git branch -f "$tier" dev
done

# Push dev first so it can become default, then the rest.
run "Push dev"                 git push home dev
run "Push alpha beta prod"     git push home alpha beta prod
run "Set default branch → dev" gh repo edit "$HOME_REPO" --default-branch dev

echo ""
if [ "$DRY_RUN" != "1" ]; then
  ok "Tier branches on $HOME_REPO:"
  git ls-remote --heads home | awk '{print "   " $2}' | sed 's#refs/heads/##'
fi
