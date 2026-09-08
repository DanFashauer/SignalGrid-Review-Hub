#!/usr/bin/env bash
# =============================================================================
# SignalGrid — ensure a container engine is up on the Mac.
#
# `restart: unless-stopped` in the compose files is the RIGHT tool for crash
# recovery and for resuming containers when the daemon restarts — but it is the
# WRONG tool for start-on-boot: it only resumes containers that were already
# running, and it does nothing at all while the engine itself is not launched.
# On a Mac the engine is a user-space VM (Docker Desktop / OrbStack / Colima /
# podman machine) that does not come up on boot unless something starts it.
# This script IS that something.
#
#   bash scripts/mac/ensure-container-engine.sh                 # start the engine, wait until reachable
#   bash scripts/mac/ensure-container-engine.sh --compose FILE  # …then `up -d` that compose file
#
# It detects the installed engine rather than assuming Docker Desktop
# (resume-lane.sh checks podman first, so this Mac may well be on podman).
# Idempotent: if the engine is already reachable it is a fast no-op, which is
# why the launchd agent can also poll it on an interval for self-heal.
#
# Runs under stock macOS bash 3.2 — guarded array expansion only.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

COMPOSE_FILE=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --compose) shift; COMPOSE_FILE="${1:-}"
      [ -n "$COMPOSE_FILE" ] || { echo "--compose needs a file path" >&2; exit 2; } ;;
    *) echo "unknown flag: $1 (known: --compose FILE)" >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "ensure-container-engine.sh: macOS-only; on Linux/CI the engine is native and this is a no-op." >&2
  exit 2
fi

log() { printf '%s ensure-container-engine: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1"; }

# Poll a readiness command until it succeeds or the budget runs out.
# $1 = human name, $2… = the command that must eventually exit 0.
wait_ready() {
  name="$1"; shift
  tries=40   # 40 × 3s ≈ 120s — Docker Desktop / a cold VM can take that long
  while [ "$tries" -gt 0 ]; do
    if "$@" >/dev/null 2>&1; then log "$name reachable"; return 0; fi
    sleep 3
    tries=$((tries - 1))
  done
  log "$name did NOT become reachable within budget"
  return 1
}

ENGINE=""       # the CLI used for `compose` below

# Detection order: explicit lightweight VM managers first, Docker Desktop last.
# podman before docker mirrors resume-lane.sh.
if command -v orb >/dev/null 2>&1 || command -v orbctl >/dev/null 2>&1; then
  log "engine: OrbStack"
  orb start >/dev/null 2>&1 || true
  wait_ready "OrbStack (docker)" docker info || exit 1
  ENGINE="docker"
elif command -v colima >/dev/null 2>&1; then
  log "engine: Colima"
  if ! colima status >/dev/null 2>&1; then
    log "starting colima…"
    colima start >/dev/null 2>&1 || true
  fi
  wait_ready "Colima (docker)" docker info || exit 1
  ENGINE="docker"
elif command -v podman >/dev/null 2>&1; then
  log "engine: podman"
  if ! podman machine list --noheading 2>/dev/null | grep -qi running; then
    if podman machine list --noheading 2>/dev/null | grep -q .; then
      log "starting podman machine…"
      podman machine start >/dev/null 2>&1 || true
    else
      log "no podman machine exists — run 'podman machine init && podman machine start' once, then this can start it"
      exit 1
    fi
  fi
  wait_ready "podman" podman info || exit 1
  ENGINE="podman"
elif command -v docker >/dev/null 2>&1; then
  log "engine: Docker Desktop"
  if ! docker info >/dev/null 2>&1; then
    log "launching Docker Desktop…"
    open -a Docker >/dev/null 2>&1 || open -a "Docker Desktop" >/dev/null 2>&1 || true
  fi
  wait_ready "Docker Desktop" docker info || exit 1
  ENGINE="docker"
else
  log "no container engine found (docker / orbstack / colima / podman) — install one first"
  exit 1
fi

if [ -n "$COMPOSE_FILE" ]; then
  case "$COMPOSE_FILE" in
    /*) : ;;                       # absolute — leave as-is
    *) COMPOSE_FILE="$REPO_ROOT/$COMPOSE_FILE" ;;
  esac
  [ -f "$COMPOSE_FILE" ] || { log "compose file not found: $COMPOSE_FILE"; exit 1; }
  log "bringing up: $ENGINE compose -f $COMPOSE_FILE up -d"
  if "$ENGINE" compose -f "$COMPOSE_FILE" up -d; then
    log "stack up"
  else
    log "compose up failed (engine is reachable; see output above)"
    exit 1
  fi
fi

log "done"
