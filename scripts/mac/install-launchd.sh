#!/usr/bin/env bash
# =============================================================================
# SignalGrid — install (or remove) the Mac lane's automatic tick as a launchd
# user agent. ONE command, once, on the Mac that holds this clone:
#
#   bash scripts/mac/install-launchd.sh                          # install / update (default: every 5 min)
#   SIGNALGRID_TICK_INTERVAL=120 bash scripts/mac/install-launchd.sh   # override the interval (seconds)
#   bash scripts/mac/install-launchd.sh --uninstall
#   bash scripts/mac/install-launchd.sh --status
#
# After this, scripts/mac/lane-tick.sh runs on that interval whether or not a
# Claude session is open, and writes a heartbeat the cloud steward reads. Running
# often makes queued sim requests picked up fast; the tick THROTTLES its quiet
# heartbeat (lane-tick.sh) so a short interval does NOT flood SignalGrid_Alpha
# with heartbeat commits. The log is ~/Library/Logs/signalgrid-lane-tick.log.
#
# Stock macOS bash 3.2. Nothing here needs sudo: a LaunchAgent lives in the
# user's own ~/Library/LaunchAgents and runs as the user.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="com.signalgrid.lane-tick"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/signalgrid-lane-tick.log"
# Default 5 min (down from 30) so queued sim requests are picked up fast; the tick
# throttles its quiet heartbeat (lane-tick.sh) so this does not flood Alpha. Override
# with SIGNALGRID_TICK_INTERVAL=<seconds>; floor 60 (launchd ignores sub-minute).
INTERVAL_SECONDS="${SIGNALGRID_TICK_INTERVAL:-300}"
case "$INTERVAL_SECONDS" in
  ''|*[!0-9]*) echo "install-launchd.sh: SIGNALGRID_TICK_INTERVAL must be a whole number of seconds (got '$INTERVAL_SECONDS')" >&2; exit 2 ;;
esac
[ "$INTERVAL_SECONDS" -lt 60 ] && INTERVAL_SECONDS=60
UID_NUM="$(id -u)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install-launchd.sh: launchd is macOS-only; on this host the cloud lane and CI carry the work." >&2
  exit 2
fi

case "${1:-}" in
  --uninstall)
    launchctl bootout "gui/$UID_NUM" "$PLIST" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    echo "removed $LABEL ($PLIST)"
    exit 0
    ;;
  --status)
    if launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
      echo "$LABEL is loaded (every $INTERVAL_SECONDS s); log: $LOG"
      [ -f "$LOG" ] && tail -n 5 "$LOG"
    else
      echo "$LABEL is NOT loaded — run: bash scripts/mac/install-launchd.sh"
      exit 1
    fi
    exit 0
    ;;
  "") ;;
  *) echo "unknown flag: $1 (known: --uninstall, --status)" >&2; exit 2 ;;
esac

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
    <string>$REPO_ROOT/scripts/mac/lane-tick.sh</string>
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
  echo "installed $LABEL: scripts/mac/lane-tick.sh every $INTERVAL_SECONDS s (first run now); log: $LOG"
  echo "check later with: bash scripts/mac/install-launchd.sh --status"
else
  echo "launchctl bootstrap failed — see $PLIST" >&2
  exit 1
fi
