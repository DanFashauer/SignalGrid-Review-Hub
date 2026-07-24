#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install it on macOS with: brew install xcodegen" >&2
  exit 1
fi

xcodegen generate
printf '\nGenerated SignalGridMobile.xcodeproj\n'
printf 'Open with: open SignalGridMobile.xcodeproj\n'
