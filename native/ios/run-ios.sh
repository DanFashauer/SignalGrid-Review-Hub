#!/usr/bin/env bash
# =============================================================================
# EnterpriseShell — build, boot a simulator, install & launch, screenshot.
# One command to see the app running in the iOS Simulator.
#
#   ./run-ios.sh                       # default: iPhone 17, demo mode + injected badge
#   SIM="iPad Pro 13-inch (M5)" ./run-ios.sh   # pick another simulator
#   LAUNCH_ARGS="" ./run-ios.sh        # launch with NO flags: the non-demo path
#                                      # (expect: unmanaged footer + Manual login)
#   LAUNCH_ARGS="-DemoBackendURL http://127.0.0.1:8080 -DemoBackendToken <tok>" ./run-ios.sh
#
# Requires: full Xcode + iOS platform, xcodegen (brew). Simulator builds need
# no code signing: the tracked Signing.xcconfig carries the simulator defaults and
# `#include?`s an optional, gitignored Signing.local.xcconfig for device builds.
# =============================================================================
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"

SIM="${SIM:-iPhone 17}"
# Same flags scripts/mac/run-everything.sh passes: the simulator has no reader
# hardware, so the badge scan is injected and the canned demo backend answers.
# `LAUNCH_ARGS=""` (set but empty) launches with no flags at all.
LAUNCH_ARGS="${LAUNCH_ARGS--DemoMode YES -SimulateBadge 04A3F291}"
SCHEME="EnterpriseShell"
PROJ="EnterpriseShell.xcodeproj"
DD="$PWD/.build-dd"

echo "== 1/6  regenerate Xcode project (idempotent) =="
xcodegen generate >/dev/null && echo "   $PROJ ready"

echo "== 2/6  resolve + boot simulator: $SIM =="
UDID=$(xcrun simctl list devices available | grep -F "$SIM (" | head -1 | grep -oE '[0-9A-Fa-f-]{36}' || true)
if [ -z "$UDID" ]; then
  echo "   simulator '$SIM' not found. Available devices:"; xcrun simctl list devices available | grep -iE 'iphone|ipad'
  exit 1
fi
echo "   udid: $UDID"
xcrun simctl boot "$UDID" 2>/dev/null || echo "   (already booted)"
open -a Simulator 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null

echo "== 3/6  build for the simulator (no signing) =="
xcodebuild -project "$PROJ" -scheme "$SCHEME" \
  -destination "id=$UDID" -derivedDataPath "$DD" -configuration Debug \
  CODE_SIGNING_ALLOWED=NO build 2>&1 | tail -4
echo "   build: OK"

echo "== 4/6  locate built .app + bundle id =="
APP=$(find "$DD/Build/Products" -maxdepth 2 -name '*.app' -type d | head -1)
[ -n "$APP" ] || { echo "   built .app not found under $DD"; exit 1; }
BID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Info.plist")
echo "   app: ${APP##*/Products/}"
echo "   bundle id: $BID"

echo "== 5/6  install + launch =="
xcrun simctl install "$UDID" "$APP"
# Word-split LAUNCH_ARGS on purpose (it is a flag list); bash 3.2-safe — no arrays.
if [ -n "$LAUNCH_ARGS" ]; then
  echo "   launching $BID with: $LAUNCH_ARGS"
  # shellcheck disable=SC2086
  xcrun simctl launch "$UDID" "$BID" $LAUNCH_ARGS >/dev/null
else
  echo "   launching $BID with NO flags (non-demo path: expect the unmanaged footer and Manual login)"
  xcrun simctl launch "$UDID" "$BID" >/dev/null
fi
echo "   launched $BID"

echo "== 6/6  screenshot =="
SHOT="$PWD/enterpriseshell-launch.png"
sleep 3
xcrun simctl io "$UDID" screenshot "$SHOT" >/dev/null 2>&1 && echo "   saved: $SHOT"

echo
echo "✅ EnterpriseShell is running on '$SIM'."
echo "   Drive its state machine (LockedIdle → BadgeCaptured → …) against BLE_MVP_ACCEPTANCE_TESTS.md."
