#!/usr/bin/env bash
# =============================================================================
# SignalGrid — resume the Mac lane after a reboot, suspend, or long gap.
# ONE command brings the local lane current and says exactly what is owed:
#
#   ./scripts/mac/resume-lane.sh            # sync + health + what's owed
#   ./scripts/mac/resume-lane.sh --full     # …then run the full proof harness
#   ./scripts/mac/resume-lane.sh --run      # …then run any pending sim requests
#
# Built for the post-patch reboot case (owner request, 2026-08-21): after
# macOS updates, run this from the repo root — or tell the local Claude
# session "run the resume script" — and everything picks up where it left
# off. Every step reports what it did; nothing fails silently, and a step
# that cannot run says WHY (the bash-3.2 lesson: the one mode meant to run
# everything must never be the one mode that cannot).
#
# Runs under stock macOS bash 3.2 — guarded array expansion only, no
# mapfile, no ${var,,}.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || { echo "cannot enter $REPO_ROOT" >&2; exit 1; }

FULL=0; RUN_REQUESTS=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --run) RUN_REQUESTS=1 ;;
    *) echo "unknown flag: $arg (known: --full, --run)" >&2; exit 2 ;;
  esac
done

PROBLEMS=0
say()  { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok()   { printf '   ok  %s\n' "$1"; }
warn() { printf '   \033[33mWARN\033[0m %s\n' "$1"; PROBLEMS=$((PROBLEMS+1)); }

# ── 1. git: come current without clobbering anything ─────────────────────────
say "git — sync with origin"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ -n "$(git status --porcelain)" ]; then
  warn "uncommitted local changes exist — NOT pulling over them. Commit or stash, then re-run."
  git status --short | head -10
else
  git fetch origin --prune
  if git merge-base --is-ancestor "origin/$BRANCH" HEAD 2>/dev/null; then
    ok "branch $BRANCH already current"
  elif git pull --ff-only origin "$BRANCH"; then
    ok "fast-forwarded $BRANCH to origin"
  else
    warn "could not fast-forward $BRANCH — local and remote diverged; resolve per docs/LANE_COORDINATION.md before running anything"
  fi
fi

# ── 2. dependencies: only when the lockfile moved ────────────────────────────
say "dependencies"
if command -v pnpm >/dev/null 2>&1; then
  if git diff --quiet "HEAD@{1}" HEAD -- pnpm-lock.yaml 2>/dev/null; then
    ok "lockfile unchanged since last position — skipping install"
  else
    echo "   lockfile changed (or first run after clone) — installing…"
    if pnpm install --frozen-lockfile; then ok "pnpm install clean"; else warn "pnpm install failed — nothing below can be trusted until it passes"; fi
  fi
else
  warn "pnpm not on PATH — install Node+pnpm before anything else"
fi

# ── 3. container engine (the fleet/wazuh live lanes need it) ─────────────────
say "container engine"
if command -v podman >/dev/null 2>&1; then
  if podman machine list 2>/dev/null | grep -q "Currently running"; then
    ok "podman machine running"
  elif podman machine list 2>/dev/null | grep -q .; then
    echo "   starting podman machine…"
    if podman machine start >/dev/null 2>&1; then ok "podman machine started"; else warn "podman machine failed to start — the live fleet/EDR lanes will SKIP (they say so themselves)"; fi
  else
    warn "no podman machine exists — 'podman machine init && podman machine start' before the live lanes"
  fi
elif command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then ok "docker daemon reachable"; else warn "docker installed but daemon not running — start Docker Desktop for the live lanes"; fi
else
  warn "no container engine — live fleet/wazuh lanes unavailable (proofs and sim are unaffected)"
fi

# ── 4. gh auth (the one blocker that has bitten this lane before) ────────────
say "GitHub auth"
if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    ok "gh authenticated — pushes will deliver"
  else
    warn "gh NOT authenticated. Run:  gh auth login   (this blocked local commits from delivering once already)"
  fi
else
  warn "gh CLI not installed — 'brew install gh' then 'gh auth login' so lane mail and results can push"
fi

# ── 5. what the other lane needs you to know ─────────────────────────────────
say "lane mail (cloud ↔ mac)"
pnpm run --silent lane:inbox || warn "lane:inbox failed to run"

say "sim requests owed"
node scripts/check-sim-requests.mjs || warn "check-sim-requests reported pending or failed — see above"

# ── 6. optional heavy phases ─────────────────────────────────────────────────
if [ "$RUN_REQUESTS" = "1" ]; then
  say "running pending sim requests"
  pnpm run sim:run-requests || warn "sim:run-requests reported failures — results (and refusals) are committed either way"
fi
if [ "$FULL" = "1" ]; then
  say "full proof harness"
  ./validate-sim-macos.sh || warn "validate-sim-macos reported failures — read its SUMMARY line"
fi

# ── verdict ──────────────────────────────────────────────────────────────────
printf '\n\033[1m== RESUME SUMMARY ==\033[0m\n'
if [ "$PROBLEMS" = "0" ]; then
  echo "Lane is current. Next moves, if any, are listed under 'lane mail' and 'sim requests' above."
  echo "Deeper check when wanted:  ./scripts/mac/resume-lane.sh --full"
else
  echo "$PROBLEMS item(s) need attention — each is marked WARN above with its exact remedy."
  exit 1
fi
