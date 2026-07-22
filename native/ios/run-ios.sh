#!/usr/bin/env bash
# =============================================================================
# EnterpriseShell — build, boot a simulator, install & launch, screenshot.
# One command to see the app running in the iOS Simulator.
#
#   ./run-ios.sh                       # default: iPad Pro 13-inch (M5)
#   SIM="iPhone 17 Pro" ./run-ios.sh   # pick another simulator
#
# Requires: full Xcode + iOS platform, xcodegen (brew). Simulator builds need
# no code signing.
# =============================================================================
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")"

SIM="${SIM:-iPad Pro 13-inch (M5)}"
SCHEME="EnterpriseShell"
PROJ="EnterpriseShell.xcodeproj"
DD="$PWD/.build-dd"

echo "== 1/6  regenerate Xcode project (idempotent) =="
xcodegen generate >/dev/null && echo "   $PROJ ready"

echo "== 2/6  resolve + boot simulator: $SIM =="
UDID=$(xcrun simctl list devices available | grep -F "$SIM (" | head -1 | grep -oE '[0-9A-Fa-f-]{36}' || true)
if [ -z "$UDID" ]; then
  echo "   simulator '$SIM' not found. Available iPads:"; xcrun simctl list devices available | grep -i ipad
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
xcrun simctl launch "$UDID" "$BID" >/dev/null
echo "   launched $BID"

echo "== 6/6  screenshot =="
SHOT="$PWD/enterpriseshell-launch.png"
sleep 3
xcrun simctl io "$UDID" screenshot "$SHOT" >/dev/null 2>&1 && echo "   saved: $SHOT"

echo
echo "✅ EnterpriseShell is running on '$SIM'."
echo "   Drive its state machine (LockedIdle → BadgeCaptured → …) against BLE_MVP_ACCEPTANCE_TESTS.md."
