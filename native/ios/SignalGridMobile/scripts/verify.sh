#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# --require-xcode: an absent Xcode is a FAILURE, not a skip. Without it this
# script exited 0 after building neither app target, with an exit status
# identical to a full green run; ios-ci.yml uses it as the gate and passes the
# flag (2026-09-05).
REQUIRE_XCODE=0
for arg in "$@"; do
  [ "$arg" = "--require-xcode" ] && REQUIRE_XCODE=1
done

printf '\n== Swift core tests ==\n'
swift test --package-path SignalGridMobileCore

printf '\n== Swift syntax parse ==\n'
while IFS= read -r file; do
  swiftc -frontend -parse "$file"
done < <(find SignalGridOperator WardlinkDemo -name '*.swift' -type f | sort)
printf 'Parsed all SwiftUI source files.\n'

if command -v xcodegen >/dev/null 2>&1 && command -v xcodebuild >/dev/null 2>&1; then
  printf '\n== Generate Xcode project ==\n'
  xcodegen generate

  printf '\n== Build SignalGridOperator for iOS Simulator ==\n'
  xcodebuild \
    -project SignalGridMobile.xcodeproj \
    -scheme SignalGridOperator \
    -destination 'generic/platform=iOS Simulator' \
    CODE_SIGNING_ALLOWED=NO \
    build

  printf '\n== Build WardlinkDemo for iOS Simulator ==\n'
  xcodebuild \
    -project SignalGridMobile.xcodeproj \
    -scheme WardlinkDemo \
    -destination 'generic/platform=iOS Simulator' \
    CODE_SIGNING_ALLOWED=NO \
    build
else
  if [ "$REQUIRE_XCODE" = "1" ]; then
    printf '\nFAIL: --require-xcode was given but xcodegen/xcodebuild are not available. Neither app target was built; this run must not read as green.\n' >&2
    exit 1
  fi
  printf '\nXcode build SKIPPED (NOT verified by this run): xcodegen/xcodebuild are available only in the macOS build environment. Both app targets are unbuilt; pass --require-xcode where a build is required.\n'
fi
