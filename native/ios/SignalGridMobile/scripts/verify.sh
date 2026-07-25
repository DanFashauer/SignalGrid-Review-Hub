#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

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
  printf '\nXcode build skipped: xcodegen/xcodebuild are available only in the macOS build environment.\n'
fi
