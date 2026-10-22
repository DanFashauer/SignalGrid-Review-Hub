#!/usr/bin/env bash
# =============================================================================
# SignalGrid — install (or remove) the Mac lane's BUILD tick as a launchd user
# agent (owner-directed 2026-09-29; reaffirmed 2026-10-21, DR-050 / DR-060). ONE command, once, on the Mac that
# holds this clone:
#
#   bash scripts/mac/install-build-tick.sh            # install / update (retry every 5 min)
#   bash scripts/mac/install-build-tick.sh --uninstall
#   bash scripts/mac/install-build-tick.sh --status
#
# After this, scripts/mac/build-tick.sh retries every 5 minutes with no Claude session
# open: an admitted run builds the objective loop's top unclaimed buildable task and
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

# The MAIN checkout, never a linked worktree this installer happens to run from (a
# .claude/worktrees/* copy is temporary). git lists the main worktree first.
REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" worktree list --porcelain | sed -n '1s/^worktree //p')"
[ -n "$REPO_ROOT" ] || { echo "install-build-tick.sh: could not find the main checkout" >&2; exit 1; }
CACHE="$HOME/Library/Caches/signalgrid/build-tick"
LABEL="com.signalgrid.build-tick"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/signalgrid-build-tick.log"
# MUST be a bare integer of seconds: check-scheduled-routines.mjs holds it equal to
# the mac-build-tick row's cron ("*/5 * * * *"). Edit BOTH together. A run can outlast
# its slot (2 h session + preflight + breadth); launchd never overlaps its own label and
# build-tick.sh holds a lock, so a late slot is skipped, never doubled.
INTERVAL_SECONDS=300
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
    if STATUS_OUTPUT="$(launchctl print "gui/$UID_NUM/$LABEL" 2>/dev/null)"; then
      LOADED_INTERVAL="$(printf '%s\n' "$STATUS_OUTPUT" | awk '$1 == "run" && $2 == "interval" && $3 == "=" && $4 ~ /^[0-9]+$/ && $5 == "seconds" { print $4; exit }')"
      INSTALLED_INTERVAL="$(/usr/libexec/PlistBuddy -c 'Print :StartInterval' "$PLIST" 2>/dev/null || true)"
      echo "$LABEL is loaded; configured interval: $INTERVAL_SECONDS s; installed interval: ${INSTALLED_INTERVAL:-unknown} s; loaded interval: ${LOADED_INTERVAL:-unknown} s; log: $LOG"
      [ -f "$LOG" ] && tail -n 5 "$LOG"
      if [ "$LOADED_INTERVAL" != "$INTERVAL_SECONDS" ] || [ "$INSTALLED_INTERVAL" != "$INTERVAL_SECONDS" ]; then
        echo "interval update or verification needed — configured cadence is not confirmed loaded; run: bash scripts/mac/install-build-tick.sh"
        exit 1
      fi
    else
      echo "$LABEL is NOT loaded — run: bash scripts/mac/install-build-tick.sh"
      exit 1
    fi
    exit 0
    ;;
  "") ;;
  *) echo "unknown flag: $1 (known: --uninstall, --status)" >&2; exit 2 ;;
esac

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$CACHE"
# The job never runs the checkout's file: the launcher extracts origin/SignalGrid_Alpha's
# copy into a fresh cache file each run, so a checkout on another branch (or behind)
# cannot change what runs, or stop it with "No such file".
LAUNCHER="cd '$REPO_ROOT' || exit 1; git fetch -q origin; f=\$(mktemp '$CACHE/mainline.XXXXXX') || exit 1; git show origin/SignalGrid_Alpha:scripts/mac/build-tick.sh > \"\$f\" || { rm -f \"\$f\"; echo 'build-tick: mainline has no scripts/mac/build-tick.sh'; exit 0; }; SG_BUILD_TICK_MAINLINE=1 SG_REPO_ROOT='$REPO_ROOT' exec /bin/bash \"\$f\""
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>$LAUNCHER</string>
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
