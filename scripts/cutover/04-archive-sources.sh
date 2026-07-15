#!/usr/bin/env bash
# 04 — Archive the two source repos (read-only). RUN ONLY AFTER the §8
# verification checklist in the runbook passes. Reversible via `gh repo unarchive`.
. "$(dirname "$0")/_env.sh"
require_gh

banner "Phase 6 · 04 — Archive source repos"

warn "This makes $REVIEWHUB_REPO and $DEV_REPO READ-ONLY."
warn "Confirm the §8 checklist passed (dev healthy, history preserved, CI green)."

# Guard: require an explicit opt-in unless dry-running.
if [ "$DRY_RUN" != "1" ] && [ "${I_VERIFIED_SECTION_8:-}" != "yes" ]; then
  die "Refusing to archive. Re-run with:  I_VERIFIED_SECTION_8=yes ./04-archive-sources.sh"
fi

# Safety: the home repo must actually have the tiers before we archive sources.
if [ "$DRY_RUN" != "1" ]; then
  heads=$(gh api "repos/$HOME_REPO/branches" --jq '.[].name' 2>/dev/null | tr '\n' ' ')
  for t in "${TIERS[@]}"; do
    echo " $heads " | grep -q " $t " || die "Home repo $HOME_REPO missing '$t' branch — aborting archive (run 02 first)."
  done
  ok "Home repo has all tier branches: $heads"
fi

run "Archive $REVIEWHUB_REPO" gh repo archive "$REVIEWHUB_REPO" --yes
run "Archive $DEV_REPO"       gh repo archive "$DEV_REPO" --yes

echo ""
ok "Sources archived. To undo:  gh repo unarchive <repo>"
warn "Update $HOME_REPO README to link the archived sources for provenance."
