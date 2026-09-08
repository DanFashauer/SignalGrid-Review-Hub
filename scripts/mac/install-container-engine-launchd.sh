#!/usr/bin/env bash
# =============================================================================
# SignalGrid — install (or remove) a launchd user agent that starts the Mac's
# container engine at login and keeps it up. ONE command, once, on the Mac:
#
#   bash scripts/mac/install-container-engine-launchd.sh                  # engine up at login (+ every 10 min self-heal)
#   bash scripts/mac/install-container-engine-launchd.sh --compose FILE   # …and `up -d` that compose file too
#   bash scripts/mac/install-container-engine-launchd.sh --uninstall
#   bash scripts/mac/install-container-engine-launchd.sh --status
#
# This is the piece `restart: unless-stopped` cannot be: a boot/login trigger.
# The restart policy resumes containers when the daemon restarts, but nothing
# launches the engine (Docker Desktop / OrbStack / Colima / podman machine) on
# a Mac unless a login agent does — this is that agent. The worker is
# scripts/mac/ensure-container-engine.sh, which detects the installed engine
# rather than assuming Docker Desktop.
#
# Log: ~/Library/Logs/signalgrid-container-engine.log
# Stock macOS bash 3.2. No sudo: a LaunchAgent lives in the user's own
# ~/Library/LaunchAgents and runs as the user.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="com.signalgrid.container-engine"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/signalgrid-container-engine.log"
INTERVAL_SECONDS=600
UID_NUM="$(id -u)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install-container-engine-launchd.sh: launchd is macOS-only; on Linux/CI the engine is native." >&2
  exit 2
fi

COMPOSE_FILE=""
case "${1:-}" in
  --uninstall)
    launchctl bootout "gui/$UID_NUM" "$PLIST" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    echo "removed $LABEL ($PLIST)"
    exit 0
    ;;
  --status)
    if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
      echo "$LABEL is loaded (at login + every $INTERVAL_SECONDS s); log: $LOG"
      [ -f "$LOG" ] && tail -n 5 "$LOG"
    else
      echo "$LABEL is NOT loaded — run: bash scripts/mac/install-container-engine-launchd.sh"
      exit 1
    fi
    exit 0
    ;;
  --compose)
    COMPOSE_FILE="${2:-}"
    [ -n "$COMPOSE_FILE" ] || { echo "--compose needs a file path" >&2; exit 2; }
    ;;
  "") ;;
  *) echo "unknown flag: $1 (known: --compose FILE, --uninstall, --status)" >&2; exit 2 ;;
esac

# Build the ProgramArguments body — optionally threading through --compose FILE.
EXTRA_ARGS=""
if [ -n "$COMPOSE_FILE" ]; then
  EXTRA_ARGS="    <string>--compose</string>
    <string>$COMPOSE_FILE</string>"
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_ROOT/scripts/mac/ensure-container-engine.sh</string>
$EXTRA_ARGS
  </array>
  <key>WorkingDirectory</key><string>$REPO_ROOT</string>
  <key>StartInterval</key><integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict>
</plist>
PLIST_EOF

# Re-load cleanly whether or not an older copy was loaded.
launchctl bootout "gui/$UID_NUM" "$PLIST" >/dev/null 2>&1 || true
if launchctl bootstrap "gui/$UID_NUM" "$PLIST"; then
  echo "installed $LABEL: starts the container engine at login + every $INTERVAL_SECONDS s (first run now); log: $LOG"
  [ -n "$COMPOSE_FILE" ] && echo "  will also bring up: $COMPOSE_FILE"
  echo "check later with: bash scripts/mac/install-container-engine-launchd.sh --status"
else
  echo "launchctl bootstrap failed — see $PLIST" >&2
  exit 1
fi
