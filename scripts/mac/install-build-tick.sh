#!/usr/bin/env bash
# =============================================================================
# SignalGrid — install (or remove) the Mac lane's BUILD tick as a launchd user
# agent (DR-061, owner-directed 2026-09-29). ONE command, once, on the Mac that
# holds this clone:
#
#   bash scripts/mac/install-build-tick.sh            # install / update (every 3 h)
#   bash scripts/mac/install-build-tick.sh --uninstall
#   bash scripts/mac/install-build-tick.sh --status
#
# After this, scripts/mac/build-tick.sh runs every 3 hours with no Claude session
# open: one headless session builds the objective loop's top buildable task and
# opens a PR (never merges). The lane tick (install-launchd.sh) is separate and
# unchanged. A second installer, not a second label in install-launchd.sh, because
# check-scheduled-routines.mjs holds ONE LABEL= and ONE INTERVAL_SECONDS= per
# installer against the registry row (docs/agent/scheduled-routines.json,
# mac-build-tick). The log is ~/Library/Logs/signalgrid-build-tick.log; each run
# also writes ~/Library/Logs/signalgrid/build-tick-<stamp>.log.
#
# Stock macOS bash 3.2. No sudo: a LaunchAgent runs as the user.
# =============================================================================
set -u

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="com.signalgrid.build-tick"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/signalgrid-build-tick.log"
# MUST be a bare integer of seconds: check-scheduled-routines.mjs holds it equal to
# the mac-build-tick row's cron ("0 */3 * * *"). Edit BOTH together. build-tick.sh
# caps each session at the same 3 h, so a session never outlives its own slot.
INTERVAL_SECONDS=10800
UID_NUM="$(id -u)"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "install-build-tick.sh: launchd is macOS-only; on this host the cloud lane builds." >&2
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
      echo "$LABEL is NOT loaded — run: bash scripts/mac/install-build-tick.sh"
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
    <string>$REPO_ROOT/scripts/mac/build-tick.sh</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO_ROOT</string>
  <key>StartInterval</key><integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$UID_NUM" "$PLIST" >/dev/null 2>&1 || true
if launchctl bootstrap "gui/$UID_NUM" "$PLIST"; then
  echo "installed $LABEL: scripts/mac/build-tick.sh every $INTERVAL_SECONDS s (first run now); log: $LOG"
  echo "check later with: bash scripts/mac/install-build-tick.sh --status"
else
  echo "launchctl bootstrap failed — see $PLIST" >&2
  exit 1
fi
