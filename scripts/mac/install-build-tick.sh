#!/usr/bin/env bash
# =============================================================================
# SignalGrid — install (or remove) the Mac lane's BUILD tick as a launchd user
# agent (owner-directed 2026-09-29; reaffirmed 2026-10-21, DR-050 / DR-060). ONE command, once, on the Mac that
# holds this clone:
#
#   bash scripts/mac/install-build-tick.sh            # install / update (retry every 5 min)
#   bash scripts/mac/install-build-tick.sh --uninstall
#   bash scripts/mac/install-build-tick.sh --status
#   bash scripts/mac/install-build-tick.sh --force    # replace a loaded job's wiring this install would drop
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

FORCE=0
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
      INSTALLED_INTERVAL="$(plutil -extract StartInterval raw -o - "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c 'Print :StartInterval' "$PLIST" 2>/dev/null || true)"
      echo "$LABEL is loaded; configured interval: $INTERVAL_SECONDS s; installed interval: ${INSTALLED_INTERVAL:-unknown} s; loaded interval: ${LOADED_INTERVAL:-unknown} s; log: $LOG"
      [ -f "$LOG" ] && tail -n 5 "$LOG"
      if [ "$LOADED_INTERVAL" != "$INTERVAL_SECONDS" ] || [ "$INSTALLED_INTERVAL" != "$INTERVAL_SECONDS" ]; then
        echo "UPDATE NEEDED: loaded ${LOADED_INTERVAL:-unknown} s, source says $INTERVAL_SECONDS s (installed plist: ${INSTALLED_INTERVAL:-unknown} s) — run: bash scripts/mac/install-build-tick.sh (it refuses to drop wiring the installed job carries; --force replaces it)"
        exit 1
      fi
    else
      echo "$LABEL is NOT loaded — run: bash scripts/mac/install-build-tick.sh"
      exit 1
    fi
    exit 0
    ;;
  --force) FORCE=1 ;;
  "") ;;
  *) echo "unknown flag: $1 (known: --uninstall, --status, --force)" >&2; exit 2 ;;
esac

# ── host wiring (M5): host-local, never in this tree ─────────────────────────
# Admission is host-local. Two settings may differ per Mac and go into the job's EnvironmentVariables:
#   SG_STAGE_RUNNER            the absolute host executable that serves the stages (build-tick-stages.mjs pins it)
#   SG_BUILD_TICK_PATH_PREFIX  absolute directories put FIRST on the job's PATH (the pinned pnpm, L3)
# Each comes from this shell's environment, else from ENV_FILE (KEY=VALUE lines, # comments; read, never sourced). Any
# other key, a relative or missing path, a path inside this checkout or its build clone, or a value holding a quote, <, >
# or & is refused: an installer that guessed would write a job nobody asked for.
ENV_FILE="$HOME/.config/signalgrid/build-tick.env"
refuse_wiring() { echo "install-build-tick.sh: $1" >&2; exit 2; }
# 0 when $1 holds a character that must not go into the plist's XML (or a control character, e.g. the CR of a CRLF file).
bad_chars() {
  case "$1" in
    *\"*|*\'*|*\<*|*\>*|*\&*|*[[:cntrl:]]*) return 0 ;;
  esac
  return 1
}
FILE_RUNNER=""
FILE_PREFIX=""
# A path that exists but is not a readable regular file (a directory, a dangling link, a device, a read error) is a refusal: an installer that
# ignored it would write a job without the wiring the person thought they had given it. The text is read once, then parsed.
if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
  [ -f "$ENV_FILE" ] || refuse_wiring "$ENV_FILE exists but is not a regular file (a directory, a dangling link or a device): refusing to guess"
  _env_text="$(cat "$ENV_FILE" 2>/dev/null)" || refuse_wiring "$ENV_FILE could not be read: refusing to guess"
  _ln=0
  while IFS= read -r _line || [ -n "$_line" ]; do
    _ln=$((_ln + 1))
    case "$_line" in *[![:space:]]*) ;; *) continue ;; esac   # a blank (or all-space) line
    _trim="${_line#"${_line%%[![:space:]]*}"}"
    case "$_trim" in '#'*) continue ;; esac                   # a comment
    _key="${_line%%=*}"
    case "$_line" in *=*) _val="${_line#*=}" ;; *) _val="" ;; esac
    case "$_key" in
      SG_STAGE_RUNNER) FILE_RUNNER="$_val" ;;
      SG_BUILD_TICK_PATH_PREFIX) FILE_PREFIX="$_val" ;;
      *) refuse_wiring "$ENV_FILE:$_ln: key \"$_key\" is not one this installer carries (SG_STAGE_RUNNER, SG_BUILD_TICK_PATH_PREFIX); refusing to guess" ;;
    esac
  done <<< "$_env_text"
fi
RUNNER="${SG_STAGE_RUNNER:-$FILE_RUNNER}"
PATH_PREFIX="${SG_BUILD_TICK_PATH_PREFIX:-$FILE_PREFIX}"
REPO_REAL="$(cd "$REPO_ROOT" && pwd -P)" || { echo "install-build-tick.sh: cannot enter $REPO_ROOT" >&2; exit 1; }
# The physical path of $1 with every symlink in the chain followed (plain `readlink`, no -f: stock macOS bash 3.2 and BSD readlink). Prints
# nothing and fails on a loop or an unreadable link. `cd && pwd -P` alone resolves the DIRECTORY of a path, never a link in its last component.
# The directory is entered with `cd -P`: the kernel (launchd, execvp) resolves `..` PHYSICALLY, so behind a symlinked directory it names the
# target's parent. A logical `cd` collapses it textually first, and a path that climbs out of the build clone through a link then reads as one
# that never went in (R2-1).
resolve_path() {
  _rp="$1"; _hops=0
  while [ -L "$_rp" ]; do
    _hops=$((_hops + 1)); [ "$_hops" -le 40 ] || return 1
    _lt="$(readlink "$_rp")" || return 1
    case "$_lt" in /*) _rp="$_lt" ;; *) _rp="$(dirname "$_rp")/$_lt" ;; esac
  done
  _rd="$(cd -P -- "$(dirname "$_rp")" && pwd -P)" || return 1
  printf '%s/%s\n' "$_rd" "$(basename "$_rp")"
}
# Inside the checkout or the build clone (<repo>.build) a model session could rewrite it: a physical path, compared by prefix.
under_checkout() {
  case "$1" in
    "$REPO_REAL"|"$REPO_REAL"/*|"$REPO_REAL.build"|"$REPO_REAL.build"/*) return 0 ;;
  esac
  return 1
}
if [ -n "$RUNNER" ]; then
  if bad_chars "$RUNNER"; then refuse_wiring "SG_STAGE_RUNNER holds a quote, <, >, & or a control character, which this installer will not write into a plist"; fi
  case "$RUNNER" in /*) ;; *) refuse_wiring "SG_STAGE_RUNNER must be an absolute path: $RUNNER" ;; esac
  { [ -f "$RUNNER" ] && [ -x "$RUNNER" ]; } || refuse_wiring "SG_STAGE_RUNNER is not an executable file: $RUNNER"
  _rreal="$(resolve_path "$RUNNER")" || refuse_wiring "SG_STAGE_RUNNER cannot be resolved to a physical path (a symlink loop, an unreadable link or a directory that cannot be entered): $RUNNER"
  if under_checkout "$_rreal"; then refuse_wiring "SG_STAGE_RUNNER must live outside this checkout and its build clone (it resolves to $_rreal): $RUNNER"; fi
fi
if [ -n "$PATH_PREFIX" ]; then
  if bad_chars "$PATH_PREFIX"; then refuse_wiring "SG_BUILD_TICK_PATH_PREFIX holds a quote, <, >, & or a control character, which this installer will not write into a plist"; fi
  case "$PATH_PREFIX" in
    :*|*:|*::*) refuse_wiring "SG_BUILD_TICK_PATH_PREFIX has an empty entry (a leading, trailing or doubled ':' would put the current directory on the job's PATH): $PATH_PREFIX" ;;
  esac
  _old_ifs="$IFS"; set -f; IFS=:
  for _entry in $PATH_PREFIX; do
    case "$_entry" in /*) ;; *) refuse_wiring "SG_BUILD_TICK_PATH_PREFIX entry is not an absolute path: $_entry" ;; esac
    _edir="$(cd -P -- "$_entry" 2>/dev/null && pwd -P)" || _edir=""   # physical, like resolve_path: `dirlink/..` is the link target's parent
    [ -n "$_edir" ] || refuse_wiring "SG_BUILD_TICK_PATH_PREFIX entry is not an existing directory: $_entry"
    if under_checkout "$_edir"; then refuse_wiring "SG_BUILD_TICK_PATH_PREFIX entry is inside this checkout or its build clone: $_entry"; fi
  done
  IFS="$_old_ifs"; set +f
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs" "$CACHE"
# The job never runs the checkout's file: the launcher extracts origin/SignalGrid_Alpha's
# copy into a fresh cache file each run, so a checkout on another branch (or behind)
# cannot change what runs, or stop it with "No such file".
LAUNCHER="cd '$REPO_ROOT' || exit 1; git fetch -q origin; f=\$(mktemp '$CACHE/mainline.XXXXXX') || exit 1; git show origin/SignalGrid_Alpha:scripts/mac/build-tick.sh > \"\$f\" || { rm -f \"\$f\"; echo 'build-tick: mainline has no scripts/mac/build-tick.sh'; exit 0; }; SG_BUILD_TICK_MAINLINE=1 SG_REPO_ROOT='$REPO_ROOT' exec /bin/bash \"\$f\""
PLIST_PATH="${PATH_PREFIX:+$PATH_PREFIX:}$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
ENV_EXTRA=""
if [ -n "$RUNNER" ]; then
  ENV_EXTRA="
    <key>SG_STAGE_RUNNER</key><string>$RUNNER</string>"
fi
# Written beside the installed plist, never over it: the comparison below needs both.
NEW_PLIST="$(mktemp "$CACHE/build-tick.plist.XXXXXX")" || { echo "install-build-tick.sh: could not stage the new plist in $CACHE" >&2; exit 1; }
cat > "$NEW_PLIST" <<PLIST_EOF
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
    <key>PATH</key><string>$PLIST_PATH</string>
    <key>HOME</key><string>$HOME</string>$ENV_EXTRA
  </dict>
</dict>
</plist>
PLIST_EOF

# ── refuse to destroy wiring (M5) ────────────────────────────────────────────
# What the loaded job carries is host-local, and nothing in this tree can show it. What this installer CAN read is the plist it
# wrote last time (or a person edited since): EVERY top-level key the installed plist has must survive with the same value
# (ProgramArguments, WorkingDirectory, the log paths, KeepAlive, Nice, UserName, StartCalendarInterval, ...), and so must every
# EnvironmentVariables key. An ADDED key, and a changed StartInterval (that is an update), are allowed. A job that is
# loaded while no plist exists where this installer writes was loaded from a file it cannot read; a plist it cannot compare is not
# "the same". Each refusal says what to carry in ENV_FILE, or to rerun with --force, which replaces the installed wiring.
refuse_replace() { rm -f "$NEW_PLIST"; echo "install-build-tick.sh: refusing to replace the installed job's wiring: $1" >&2; echo "  carry it in $ENV_FILE, or rerun with --force to replace it" >&2; exit 1; }
if [ "$FORCE" != "1" ]; then
  if [ -f "$PLIST" ]; then
    _old_json="$(plutil -convert json -o - "$PLIST" 2>/dev/null)" || _old_json=""
    _new_json="$(plutil -convert json -o - "$NEW_PLIST" 2>/dev/null)" || _new_json=""
    if [ -z "$_old_json" ] || [ -z "$_new_json" ]; then
      refuse_replace "could not compare it with the installed plist (plutil could not read one of them): $PLIST"
    fi
    _drop="$(node -e '// argv: <installed plist as JSON> <new plist as JSON>; prints what the new plist would DROP or CHANGE; exit 1 if anything, 0 if nothing, 3 if unreadable.
      try {
        const [o, n] = process.argv.slice(1).map((t) => JSON.parse(t));
        if (!o || typeof o !== "object" || Array.isArray(o) || !n || typeof n !== "object" || Array.isArray(n)) process.exit(3);
        const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
        const out = [];
        for (const k of Object.keys(o).sort()) {
          if (k === "StartInterval") continue;   // a changed interval is the update path
          if (!(k in n)) { out.push(`${k}: dropped (loaded ${canon(o[k])})`); continue; }
          if (k === "EnvironmentVariables") {
            const oe = o[k], ne = n[k];
            if (!oe || typeof oe !== "object" || Array.isArray(oe) || !ne || typeof ne !== "object" || Array.isArray(ne)) process.exit(3);
            for (const e of Object.keys(oe).sort()) {
              if (!(e in ne)) out.push(`EnvironmentVariables.${e}: dropped (loaded ${JSON.stringify(oe[e])})`);
              else if (canon(ne[e]) !== canon(oe[e])) out.push(`EnvironmentVariables.${e}: ${JSON.stringify(oe[e])} -> ${JSON.stringify(ne[e])}`);
            }
          } else if (canon(o[k]) !== canon(n[k])) out.push(`${k}: loaded ${canon(o[k])} -> new ${canon(n[k])}`);
        }
        if (out.length) { console.log(out.join("\n")); process.exit(1); }
      } catch { process.exit(3); }' "$_old_json" "$_new_json" 2>/dev/null)"
    _cmp=$?
    case "$_cmp" in
      0) ;;
      1) refuse_replace "it would drop or change: $(printf '%s' "$_drop" | tr '\n' ';')" ;;
      *) refuse_replace "could not compare it with the installed plist (exit $_cmp): $PLIST" ;;
    esac
  elif launchctl print "gui/$UID_NUM/$LABEL" >/dev/null 2>&1; then
    refuse_replace "$LABEL is loaded, but no plist exists at $PLIST: it was loaded from a file this installer cannot read"
  fi
fi
mv -f "$NEW_PLIST" "$PLIST"

launchctl bootout "gui/$UID_NUM" "$PLIST" >/dev/null 2>&1 || true
if launchctl bootstrap "gui/$UID_NUM" "$PLIST"; then
  echo "installed $LABEL: scripts/mac/build-tick.sh every $INTERVAL_SECONDS s (first run now); log: $LOG"
  echo "check later with: bash scripts/mac/install-build-tick.sh --status"
else
  echo "launchctl bootstrap failed — see $PLIST" >&2
  exit 1
fi
