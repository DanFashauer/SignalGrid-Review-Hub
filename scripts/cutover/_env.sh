#!/usr/bin/env bash
# Shared config + helpers for the Phase 6 cutover scripts.
# Source this at the top of each script: . "$(dirname "$0")/_env.sh"
set -euo pipefail

# ---- Targets (override via environment) -------------------------------------
HOME_REPO="${HOME_REPO:-DanFashauer/SignalGrid}"
REVIEWHUB_REPO="${REVIEWHUB_REPO:-DanFashauer/SignalGrid-Review-Hub}"
DEV_REPO="${DEV_REPO:-DanFashauer/DEV}"
CONSOLIDATION_REF="${CONSOLIDATION_REF:-claude/signalgrid-launch-plan-emxm01}"
OLD_SIGNALGRID_MAIN="${OLD_SIGNALGRID_MAIN:-main}"
DEV_MAIN="${DEV_MAIN:-main}"

# Required CI status-check context = the job name in review-hub-ci.yml.
CI_CHECK_CONTEXT="${CI_CHECK_CONTEXT:-SignalGrid CI}"

# shellcheck disable=SC2034  # read by 02-create-tiers.sh, 03-protect-and-environments.sh
# and 04-archive-sources.sh, which source this file; shellcheck cannot see across that.
TIERS=(dev alpha beta prod)
DRY_RUN="${DRY_RUN:-0}"

# ---- Helpers ----------------------------------------------------------------
c_reset='\033[0m'; c_dim='\033[2m'; c_grn='\033[32m'; c_ylw='\033[33m'; c_red='\033[31m'
log()  { printf "${c_dim}» %s${c_reset}\n" "$*"; }
ok()   { printf "${c_grn}✓ %s${c_reset}\n" "$*"; }
warn() { printf "${c_ylw}! %s${c_reset}\n" "$*"; }
die()  { printf "${c_red}✗ %s${c_reset}\n" "$*" >&2; exit 1; }

# run "<description>" cmd args...  — honors DRY_RUN
run() {
  local desc="$1"; shift
  if [ "$DRY_RUN" = "1" ]; then
    printf "${c_ylw}[dry-run]${c_reset} %s\n         ${c_dim}%s${c_reset}\n" "$desc" "$*"
  else
    log "$desc"
    "$@"
  fi
}

require_gh() {
  command -v gh >/dev/null 2>&1 || die "gh CLI not found. Install: https://cli.github.com/"
  gh auth status >/dev/null 2>&1 || die "gh not authenticated. Run: gh auth login"
}

require_git() { command -v git >/dev/null 2>&1 || die "git not found."; }

banner() {
  echo ""
  printf "${c_grn}══ %s ══${c_reset}\n" "$*"
  [ "$DRY_RUN" = "1" ] && warn "DRY_RUN=1 — no side effects will run."
  echo ""
}
