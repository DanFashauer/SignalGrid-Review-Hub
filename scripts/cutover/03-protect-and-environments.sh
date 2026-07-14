#!/usr/bin/env bash
# 03 — Apply branch protection to all tiers and create per-tier deployment
# environments + tier/gate variables. beta/prod are the only tiers that carry
# the live-integrations flag; dev/alpha stay fixture-safe.
. "$(dirname "$0")/_env.sh"
require_gh

banner "Phase 6 · 03 — Branch protection & environments"

# --- Branch protection -------------------------------------------------------
# reviews: required approving reviews (0 = none); admins: enforce on admins.
protect() {
  local branch="$1" reviews="$2" admins="$3"
  local pr_block='null'
  if [ "$reviews" -gt 0 ]; then
    pr_block="{\"required_approving_review_count\":$reviews,\"dismiss_stale_reviews\":true}"
  fi
  local body
  body=$(cat <<JSON
{
  "required_status_checks": { "strict": true, "contexts": ["$CI_CHECK_CONTEXT"] },
  "enforce_admins": $admins,
  "required_pull_request_reviews": $pr_block,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
)
  if [ "$DRY_RUN" = "1" ]; then
    printf "[dry-run] protect %-6s reviews=%s admins=%s\n%s\n" "$branch" "$reviews" "$admins" "$body"
  else
    log "Protect $branch (reviews=$reviews, enforce_admins=$admins)"
    printf '%s' "$body" | gh api -X PUT "repos/$HOME_REPO/branches/$branch/protection" \
      -H "Accept: application/vnd.github+json" --input - >/dev/null
    ok "Protected $branch"
  fi
}

protect prod  1 true
protect beta  1 true
protect alpha 0 false
protect dev   0 false

# --- Environments + variables ------------------------------------------------
for env in "${TIERS[@]}"; do
  run "Create environment $env" gh api -X PUT "repos/$HOME_REPO/environments/$env"
done

# Tier identity variable on every environment.
run "var SIGNALGRID_TIER=dev @dev"     gh variable set SIGNALGRID_TIER --env dev   --repo "$HOME_REPO" --body dev
run "var SIGNALGRID_TIER=alpha @alpha" gh variable set SIGNALGRID_TIER --env alpha --repo "$HOME_REPO" --body alpha
run "var SIGNALGRID_TIER=beta @beta"   gh variable set SIGNALGRID_TIER --env beta  --repo "$HOME_REPO" --body beta
run "var SIGNALGRID_TIER=prod @prod"   gh variable set SIGNALGRID_TIER --env prod  --repo "$HOME_REPO" --body prod

# Live-integrations gate ONLY on beta/prod. dev/alpha never get it (fixture-safe).
run "var SIGNALGRID_LIVE_INTEGRATIONS=true @beta" gh variable set SIGNALGRID_LIVE_INTEGRATIONS --env beta --repo "$HOME_REPO" --body true
run "var SIGNALGRID_LIVE_INTEGRATIONS=true @prod" gh variable set SIGNALGRID_LIVE_INTEGRATIONS --env prod --repo "$HOME_REPO" --body true

echo ""
warn "Real vendor CREDENTIALS are NOT set here. Add them by hand as environment"
warn "SECRETS on beta/prod only, when you run a live deploy:"
echo  "   gh secret set OKTA_API_TOKEN --env prod --repo $HOME_REPO"
echo  "   (names: see config/tiers/<tier>.env.example — never commit real values)"
echo ""
warn "Optional: require a manual approver on prod deploys —"
warn "Settings → Environments → prod → Required reviewers → add yourself."
