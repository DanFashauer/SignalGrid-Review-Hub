#!/usr/bin/env bash
# =============================================================================
# ios-shell-repair.sh — the Mac-lane proof for the 2026-09-02 iOS shell repair.
#
# Allowlisted as sim operation `ios-shell-repair` (scripts/lib/sim-operations.mjs);
# run by `pnpm run sim:run-requests`, or by hand from the repo root. Every step
# prints one PASS/FAIL line; the exit code is non-zero if ANY step failed. A step
# that cannot run is a FAIL, never a skip that reads as green.
#
#   ./scripts/mac/ios-shell-repair.sh --self-check
#       No Xcode: opens every path the real run writes, under a `mktemp -d`
#       directory that is removed on exit (the bug this guards: a redirect inside a
#       `(cd native/ios && …)` subshell once resolved RELATIVE to native/ios and every
#       run died at step 1). It never touches artifacts/sim-results/: ten zero-byte
#       files with the real evidence names would read as evidence AND stamp every
#       later Mac result workingTreeClean:false (the native/ios/build/ defect).
#
# AFTER THE FIRST REAL RUN, on the Mac: `pgrep -f "log stream"` must return
# nothing. The EXIT/INT/TERM trap kills the capture, but whether that kill
# propagates through `xcrun simctl spawn` to the in-simulator `log stream` is
# unverified from here — if a process survives, that is a finding.
#
# WHAT IS ASSERTED, NOT JUST "STILL RUNNING". The lock screen writes one row per
# appearance to the unified log (os_log, subsystem com.enterprise.shell):
#   lock_screen_presented trigger=… manual_login_available=<bool> managed=<bool>
#                         kiosk_active=<bool> asam_probe=<…> local_session_allowed=<bool>
# Step 5a requires NO row with manual_login_available=true; step 5b requires one.
# NOT YET VALIDATED AGAINST ITS OWN NEGATIVE: the cloud lane wrote this without a
# Mac. On the first run, ALSO run step 5a's grep once with the toggle ON (or
# temporarily flip the default) and confirm it FAILS — a checker that has never
# failed proves nothing. Record that in the result notes.
#
# bash 3.2 (stock macOS): no arrays, no `${var,,}`.
#
#   API_PORT=8080   an api-server on 127.0.0.1:$API_PORT for step 6 — probed for
#                   the api-server's OWN shape (GET /api/v1/context → 401 + JSON),
#                   any other listener FAILS. The server REQUIRES PORT
#                   (artifacts/api-server/src/index.ts); run-everything.sh uses 8080.
#   SIM_NAME        simulator name (default "iPhone 17")
#   SHELL_BUNDLE_ID bundle id to launch (default com.enterprise.shell)
# =============================================================================
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

SIM_NAME="${SIM_NAME:-iPhone 17}"
BID="${SHELL_BUNDLE_ID:-com.enterprise.shell}"
API_PORT="${API_PORT:-8080}"
STAMP="$(date +%Y-%m-%d)"

PASSED=0
FAILED=0
pass() { PASSED=$((PASSED + 1)); echo "PASS  $1"; }
fail() { FAILED=$((FAILED + 1)); echo "FAIL  $1"; }
summary_exit() { echo "== SUMMARY: $PASSED passed, $FAILED failed =="; [ "$FAILED" -eq 0 ]; }

LOG_TARGETS="01-xcodegen.log 02-build.log 03-install.log 04-demo-lifecycle.log 05a-noflags-toggle-off.log 05b-noflags-toggle-on.log 06-loopback-backend.log 06-probe.headers 06-probe.body 07-a11y-extra-large.log"

if [ "${1:-}" = "--self-check" ]; then
  # Scratch only. The real evidence directory is never created or touched here.
  SC_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ios-shell-repair-selfcheck.XXXXXX")"
  trap 'rm -r "$SC_DIR" 2>/dev/null || true' EXIT INT TERM
  for f in $LOG_TARGETS; do
    if : >"$SC_DIR/$f"; then pass "self-check: can write <tmp>/$f"; else fail "self-check: cannot write <tmp>/$f"; fi
  done
  # The subshell form the real run uses, with an absolute path — must succeed.
  if (cd native/ios && : >"$SC_DIR/01-xcodegen.log"); then
    pass "self-check: redirect from inside (cd native/ios && …) resolves to an absolute <tmp>/01-xcodegen.log"
  else
    fail "self-check: redirect from inside the native/ios subshell does not resolve"
  fi
  if [ -e "$ROOT/artifacts/sim-results/ios-shell-repair-$STAMP" ]; then
    pass "self-check: a real-run directory for $STAMP exists and was left untouched"
  else
    pass "self-check: no real-run directory created under artifacts/sim-results/"
  fi
  summary_exit; exit $?
fi

OUT="artifacts/sim-results/ios-shell-repair-$STAMP"
# EVERY redirect uses the absolute form: the build steps run inside a
# `(cd native/ios && …)` subshell, where a relative $OUT points nowhere.
OUT_ABS="$ROOT/$OUT"
mkdir -p "$OUT_ABS"

# --- 1. generate ---------------------------------------------------------------
if (cd native/ios && xcodegen generate >"$OUT_ABS/01-xcodegen.log" 2>&1); then
  pass "1 xcodegen generate (log: $OUT/01-xcodegen.log)"
else
  fail "1 xcodegen generate — see $OUT/01-xcodegen.log"
  summary_exit; exit 1
fi

# --- 2. build ------------------------------------------------------------------
DD="native/ios/build"
if (cd native/ios && xcodebuild -scheme EnterpriseShell -sdk iphonesimulator \
      -destination "platform=iOS Simulator,name=$SIM_NAME" \
      -derivedDataPath build build >"$OUT_ABS/02-build.log" 2>&1); then
  pass "2 xcodebuild EnterpriseShell for '$SIM_NAME' (log: $OUT/02-build.log)"
else
  fail "2 xcodebuild — see $OUT/02-build.log (tail follows)"
  tail -30 "$OUT_ABS/02-build.log" || true
  summary_exit; exit 1
fi
APP="$DD/Build/Products/Debug-iphonesimulator/EnterpriseShell.app"
[ -d "$APP" ] || { fail "2b built .app not found at $APP"; summary_exit; exit 1; }

# --- 3. boot + install ---------------------------------------------------------
UDID="$(xcrun simctl list devices available | grep -F "$SIM_NAME (" | head -1 | grep -oE '[0-9A-Fa-f-]{36}' || true)"
if [ -z "$UDID" ]; then
  fail "3 simulator '$SIM_NAME' not available"; summary_exit; exit 1
fi
xcrun simctl boot "$UDID" >/dev/null 2>&1 || true
open -a Simulator >/dev/null 2>&1 || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" content_size medium >/dev/null 2>&1 || true
# Known state: the local toggle OFF and no persisted AllowManualOverride from a
# manual experiment (either could satisfy 5b for the wrong reason). Both deletes
# tolerate absence.
xcrun simctl spawn "$UDID" defaults delete "$BID" local_session_allowed >/dev/null 2>&1 || true
xcrun simctl spawn "$UDID" defaults delete "$BID" AllowManualOverride >/dev/null 2>&1 || true
if xcrun simctl install "$UDID" "$APP" >"$OUT_ABS/03-install.log" 2>&1; then
  pass "3 booted '$SIM_NAME' ($UDID) and installed $BID"
else
  fail "3 install — see $OUT/03-install.log"; summary_exit; exit 1
fi

# Unified-log capture around one launch. The predicate takes the shell's own
# subsystem PLUS any fatal/crash line from its process.
LOG_PREDICATE='(subsystem == "com.enterprise.shell") OR (process == "EnterpriseShell" AND (eventMessage CONTAINS[c] "fatal" OR eventMessage CONTAINS[c] "crash"))'
LOGPID=""
logcap_start() {
  xcrun simctl spawn "$UDID" log stream --style compact --predicate "$LOG_PREDICATE" >"$OUT_ABS/$1.log" 2>&1 &
  LOGPID=$!
  sleep 2
}
logcap_stop() {
  if [ -n "$LOGPID" ]; then kill "$LOGPID" >/dev/null 2>&1 || true; wait "$LOGPID" 2>/dev/null || true; LOGPID=""; fi
}
# An interrupted run must not leave the in-simulator `log stream` behind.
trap 'logcap_stop 2>/dev/null || true' EXIT INT TERM

# launch <name> <seconds> [flags…] → sets PID, captures $OUT/<name>.log, screenshot $OUT/<name>.png
PID=""
launch() {
  name="$1"; wait_s="$2"; shift 2
  xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
  sleep 1
  logcap_start "$name"
  # `simctl launch` prints "<bundle>: <pid>". ${1+"$@"} is the bash-3.2-safe
  # "all remaining args, or nothing" under set -u.
  if line="$(xcrun simctl launch "$UDID" "$BID" ${1+"$@"} 2>&1)"; then
    PID="$(echo "$line" | sed -nE 's/^.*: ([0-9]+)$/\1/p')"
  else
    echo "   launch failed: $line"; PID=""; logcap_stop; return 1
  fi
  sleep "$wait_s"
  xcrun simctl io "$UDID" screenshot "$OUT_ABS/$name.png" >/dev/null 2>&1 || true
  logcap_stop
  return 0
}
alive() { [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; }
saw_row() { grep -q 'lock_screen_presented' "$OUT_ABS/$1.log" 2>/dev/null; }
saw_available() { grep -q 'manual_login_available=true' "$OUT_ABS/$1.log" 2>/dev/null; }
# The SAME row must carry the OS's explicit refusal — the only path that makes
# Manual login legitimately available on the simulator.
saw_available_via_probe() { grep 'manual_login_available=true' "$OUT_ABS/$1.log" 2>/dev/null | grep -q 'asam_probe=unavailable'; }
saw_fatal() { grep -Eiq 'fatal error|fatalError|crash' "$OUT_ABS/$1.log" 2>/dev/null; }

# --- 4. demo path --------------------------------------------------------------
if launch 04-demo-lifecycle 8 -DemoMode YES -SimulateBadge 04A3F291 && alive; then
  pass "4 launched demo path (-DemoMode YES -SimulateBadge 04A3F291), alive after 8 s (visual check owed: $OUT/04-demo-lifecycle.png should show ActiveSession)"
else
  fail "4 demo launch died or did not start"
fi

# --- 5a. no flags, toggle OFF: Manual login must be ABSENT --------------------
if launch 05a-noflags-toggle-off 6 && alive; then
  if saw_row 05a-noflags-toggle-off && ! saw_available 05a-noflags-toggle-off; then
    pass "5a no-flag launch: lock_screen_presented rows seen, none with manual_login_available=true — $OUT/05a-noflags-toggle-off.png"
  elif ! saw_row 05a-noflags-toggle-off; then
    fail "5a no lock_screen_presented row captured (log capture or os_log broken) — see $OUT/05a-noflags-toggle-off.log"
  else
    fail "5a manual_login_available=true with the local toggle OFF — the blocked defect is back; rows: $(grep -c 'lock_screen_presented' "$OUT_ABS/05a-noflags-toggle-off.log")"
  fi
else
  fail "5a no-flag launch died"
fi

# --- 5b. no flags, toggle ON: Manual login must be PRESENT --------------------
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
xcrun simctl spawn "$UDID" defaults write "$BID" local_session_allowed -bool true
if launch 05b-noflags-toggle-on 6 && alive; then
  if saw_available_via_probe 05b-noflags-toggle-on; then
    pass "5b toggle ON: a row with manual_login_available=true AND asam_probe=unavailable — $OUT/05b-noflags-toggle-on.png"
  elif saw_available 05b-noflags-toggle-on; then
    fail "5b manual_login_available=true WITHOUT asam_probe=unavailable on the same row — availability came from something other than the OS refusal (a stray AllowManualOverride?): $(grep 'manual_login_available=true' "$OUT_ABS/05b-noflags-toggle-on.log" | tail -1)"
  else
    fail "5b toggle ON but no row with manual_login_available=true — rows: $(grep 'lock_screen_presented' "$OUT_ABS/05b-noflags-toggle-on.log" | tail -3)"
  fi
else
  fail "5b no-flag launch (toggle on) died"
fi
xcrun simctl spawn "$UDID" defaults delete "$BID" local_session_allowed >/dev/null 2>&1 || true

# --- 6. loopback backend soak: the old fatalError fired ~30 s after launch -----
probe_code="$(curl -s -o "$OUT_ABS/06-probe.body" -D "$OUT_ABS/06-probe.headers" -H 'Accept: application/json' -w '%{http_code}' "http://127.0.0.1:$API_PORT/api/v1/context" 2>/dev/null || echo 000)"
if [ "$probe_code" = "401" ] && grep -qi '^content-type: application/json' "$OUT_ABS/06-probe.headers" && grep -q '{' "$OUT_ABS/06-probe.body"; then
  if launch 06-loopback-backend 40 -DemoBackendURL "http://127.0.0.1:$API_PORT" && alive && ! saw_fatal 06-loopback-backend; then
    pass "6 -DemoBackendURL http://127.0.0.1:$API_PORT alive after 40 s, no fatal/crash line — $OUT/06-loopback-backend.png; EXPECT footer 'Backend: 127.0.0.1:$API_PORT — launch argument -DemoBackendURL'"
  else
    fail "6 process died or logged a fatal line within 40 s with a loopback http backend — the crash the repair was meant to remove (see $OUT/06-loopback-backend.log)"
  fi
else
  fail "6 no api-server on 127.0.0.1:$API_PORT (GET /api/v1/context must answer 401 + JSON; got HTTP $probe_code) — start one: PORT=$API_PORT pnpm --filter @workspace/api-server run start"
fi

# --- 7. accessibility-extra-large ---------------------------------------------
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true
if xcrun simctl ui "$UDID" content_size accessibility-extra-large >/dev/null 2>&1 \
   && launch 07-a11y-extra-large 6 && alive; then
  pass "7 launched at accessibility-extra-large (visual check owed: $OUT/07-a11y-extra-large.png — report overlap/truncation by element)"
else
  fail "7 accessibility-extra-large launch"
fi
xcrun simctl ui "$UDID" content_size medium >/dev/null 2>&1 || true
xcrun simctl terminate "$UDID" "$BID" >/dev/null 2>&1 || true

echo
echo "Screenshots + logs: $OUT/  (evidence — COMMIT them with the result JSON; an"
echo "uncommitted directory stamps every later result as minted from a dirty tree)"
summary_exit
