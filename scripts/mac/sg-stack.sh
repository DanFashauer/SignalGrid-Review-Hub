#!/usr/bin/env bash
# =============================================================================
# sg-stack — one idempotent manager for the Mac local brain's lab containers.
#
# The live-vendor connectors (Fleet, GLPI, Headwind MDM, Keycloak, Traccar,
# Wazuh, osquery) run in containers so their proofs read REAL software, not
# fixtures. They were brought up ad-hoc across many `run-live-lanes.sh` and
# manual `docker run` invocations, which is why the Mac accumulated 23 containers,
# half of them dead orphans, with nothing owning their lifecycle — and why "some
# don't start automatically" (nothing was told to) and "won't run the image"
# (Docker Desktop's credential helper hangs a headless pull).
#
# This gives that a single front door:
#
#   sg-stack up [--only fleet,glpi]   bring the connectors up, reliably & idempotently
#   sg-stack status                   health of every sg-* service, one line each
#   sg-stack down [--only fleet]      stop and remove them (data volumes survive)
#   sg-stack restart-policy           (re)apply restart=unless-stopped to running sg-*
#   sg-stack install-autostart        launchd: start Docker Desktop on login so the
#                                     restart=unless-stopped containers come back
#   sg-stack uninstall-autostart      remove that launchd agent
#
# It does NOT reimplement the bring-up — `up` delegates to run-live-lanes.sh, the
# one place that knows each connector's auth archaeology — it adds the three things
# that were missing: the credential-helper fix, a reboot-survival restart policy,
# and an honest status/teardown. On-demand by design: `up` starts only what you ask
# for (or all), so the box does not silently re-bloat to 49 GB of idle connectors.
# =============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO" || { echo "sg-stack: cannot enter repo root" >&2; exit 1; }

# The credential-helper fix, before any docker call. See the guard's header.
. scripts/lib/docker-credhang-guard.sh
sg_guard_docker_credhang

. scripts/lib/container-engine.sh

# Pick the engine that actually HOLDS the sg-* containers.
#
# Docker Desktop and a podman machine can both be running at once (they are on this
# Mac), and the lab's containers live in whichever engine brought them up — here,
# docker. The shared lib prefers podman ("the chosen runtime"), so a blind
# sg_resolve_engine would manage the empty podman and report the docker containers
# as missing. So: honour CONTAINER_ENGINE if the caller set it; else pick whichever
# of docker/podman actually contains sg-* containers; else fall back to the lib's
# default (podman-first) for a fresh `up`. `up` then forces run-live-lanes onto the
# same engine, so the two can never split-brain.
sg_pick_engine() {
  if [ -n "${CONTAINER_ENGINE:-}" ]; then SG_ENGINE="$CONTAINER_ENGINE"; export SG_ENGINE; return 0; fi
  local e
  for e in docker podman; do
    command -v "$e" >/dev/null 2>&1 || continue
    if "$e" ps -a --filter name=sg- --format '{{.Names}}' 2>/dev/null | grep -q .; then
      SG_ENGINE="$e"; export SG_ENGINE; return 0
    fi
  done
  sg_resolve_engine
}
sg_pick_engine || true

LAUNCHD_LABEL="com.signalgrid.docker-ready"
LAUNCHD_PLIST="${HOME}/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"

c_green=$'\033[32m'; c_red=$'\033[31m'; c_yel=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'

die() { echo "sg-stack: $*" >&2; exit 1; }

# The containers run-live-lanes.sh creates, by name. Kept here only so `status` and
# `down` can enumerate them without parsing the 40 KB runner; the authority on WHICH
# come up for a given lane stays in run-live-lanes.sh.
SG_CONTAINERS="sg-fleet sg-fleet-mysql sg-fleet-redis sg-osquery sg-glpi sg-glpi-db sg-hmdm sg-hmdm-pg sg-keycloak sg-traccar sg-wazuh sg-otelcol sg-prometheus"

have_engine() { [ -n "${SG_ENGINE:-}" ]; }

# On macOS with Docker Desktop, the engine is unreachable until the app is running.
# `up` needs it; ensure it, then wait (bounded) for the daemon to answer.
ensure_engine_running() {
  if have_engine; then return 0; fi
  if [ "$(uname)" = "Darwin" ] && [ -d "/Applications/Docker.app" ]; then
    echo "sg-stack: engine not answering — starting Docker Desktop…" >&2
    open -a Docker >/dev/null 2>&1 || true
    local i=0
    while [ "$i" -lt 90 ]; do
      sg_pick_engine && have_engine && return 0
      i=$((i+1)); sleep 2
    done
  fi
  sg_pick_engine
}

apply_restart_policy() {
  have_engine || return 0
  local applied=0 name
  for name in $SG_CONTAINERS; do
    if "$SG_ENGINE" inspect "$name" >/dev/null 2>&1; then
      "$SG_ENGINE" update --restart=unless-stopped "$name" >/dev/null 2>&1 && applied=$((applied+1))
    fi
  done
  echo "sg-stack: restart=unless-stopped applied to ${applied} sg-* container(s)"
}

cmd_up() {
  local only="$1"
  ensure_engine_running || die "no container engine (Docker Desktop or podman) is available"
  echo "sg-stack: bringing connectors up via run-live-lanes.sh (engine: ${SG_ENGINE})…"
  # Force run-live-lanes onto the SAME engine we manage, so a running podman machine
  # can't send the connectors to a different engine than the one status/down read.
  export CONTAINER_ENGINE="$SG_ENGINE"
  # --keep leaves them running after the proofs; that is the point of a managed stack.
  if [ -n "$only" ]; then
    bash scripts/run-live-lanes.sh --keep --only "$only" || true
  else
    bash scripts/run-live-lanes.sh --keep || true
  fi
  # Whatever came up should survive a reboot.
  apply_restart_policy
  echo
  cmd_status ""
}

cmd_status() {
  local only="$1"
  have_engine || { echo "sg-stack: no container engine reachable (Docker Desktop not running?)"; return 0; }
  printf "%-16s %-10s %-24s %s\n" "SERVICE" "STATE" "RESTART" "PORTS"
  local name state restart ports shown=0
  for name in $SG_CONTAINERS; do
    if [ -n "$only" ]; then case ",$only," in *",${name#sg-},"*|*",$name,"*) : ;; *) continue ;; esac; fi
    "$SG_ENGINE" inspect "$name" >/dev/null 2>&1 || continue
    shown=$((shown+1))
    state="$("$SG_ENGINE" inspect -f '{{.State.Status}}' "$name" 2>/dev/null)"
    restart="$("$SG_ENGINE" inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$name" 2>/dev/null)"
    ports="$("$SG_ENGINE" port "$name" 2>/dev/null | tr '\n' ' ')"
    local color="$c_yel"; [ "$state" = "running" ] && color="$c_green"; [ "$state" = "exited" ] && color="$c_red"
    printf "%-16s ${color}%-10s${c_off} %-24s %s\n" "$name" "$state" "${restart:-none}" "${ports:-—}"
  done
  [ "$shown" -eq 0 ] && echo "${c_dim}(no sg-* connectors exist yet — 'sg-stack up' to start them)${c_off}"
}

cmd_down() {
  local only="$1"
  have_engine || { echo "sg-stack: no engine reachable; nothing to stop."; return 0; }
  local name removed=0
  for name in $SG_CONTAINERS; do
    if [ -n "$only" ]; then case ",$only," in *",${name#sg-},"*|*",$name,"*) : ;; *) continue ;; esac; fi
    if "$SG_ENGINE" inspect "$name" >/dev/null 2>&1; then
      "$SG_ENGINE" rm -f "$name" >/dev/null 2>&1 && removed=$((removed+1))
    fi
  done
  echo "sg-stack: removed ${removed} sg-* container(s). Named data volumes are left intact."
}

cmd_install_autostart() {
  [ "$(uname)" = "Darwin" ] || die "install-autostart is macOS-only"
  mkdir -p "${HOME}/Library/LaunchAgents"
  cat > "$LAUNCHD_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO}/scripts/mac/sg-stack.sh</string>
    <string>_boot</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${HOME}/Library/Logs/sg-stack-autostart.log</string>
  <key>StandardErrorPath</key><string>${HOME}/Library/Logs/sg-stack-autostart.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$LAUNCHD_PLIST" >/dev/null 2>&1 || true
  launchctl load "$LAUNCHD_PLIST" 2>&1 || die "launchctl load failed"
  echo "sg-stack: autostart installed and loaded (${LAUNCHD_LABEL})."
  echo "  On each login it starts Docker Desktop; restart=unless-stopped brings your"
  echo "  connectors back. It does NOT force-start connectors you had stopped."
}

cmd_uninstall_autostart() {
  if [ -f "$LAUNCHD_PLIST" ]; then
    launchctl unload "$LAUNCHD_PLIST" >/dev/null 2>&1 || true
    rm -f "$LAUNCHD_PLIST"
    echo "sg-stack: autostart removed."
  else
    echo "sg-stack: autostart was not installed."
  fi
}

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

# ── arg parse ────────────────────────────────────────────────────────────────
[ $# -ge 1 ] || usage 1
SUB="$1"; shift
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --only) ONLY="${2:-}"; shift ;;
    -h|--help) usage 0 ;;
    *) die "unknown flag: $1 (try: up | status | down | restart-policy | install-autostart)" ;;
  esac
  shift
done

case "$SUB" in
  up) cmd_up "$ONLY" ;;
  _boot)
    # Login entry point (launchd). Start Docker Desktop, wait for the engine, then
    # re-apply the restart policy so whatever was up before the reboot comes back.
    # restart=unless-stopped does the actual restarting once the engine answers.
    echo "sg-stack _boot: $(date)"
    ensure_engine_running >/dev/null 2>&1 || true
    apply_restart_policy
    ;;
  status) cmd_status "$ONLY" ;;
  down) cmd_down "$ONLY" ;;
  restart-policy) ensure_engine_running >/dev/null 2>&1 || true; apply_restart_policy ;;
  install-autostart) cmd_install_autostart ;;
  uninstall-autostart) cmd_uninstall_autostart ;;
  -h|--help|help) usage 0 ;;
  *) die "unknown command: $SUB (try: up | status | down | restart-policy | install-autostart)" ;;
esac
