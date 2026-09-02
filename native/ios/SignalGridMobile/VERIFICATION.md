# Verification record

Date: 2026-07-24

## Completed in this environment

- Swift toolchain: 6.2.1
- `swift test --package-path SignalGridMobileCore`
- Result: 6 tests passed, 0 failed — **as of the date above; run `./scripts/verify.sh` for the current count** (the suite has grown since, and this file is a dated record, not a live figure)
- Parsed every Swift source file in `SignalGridOperator` and `WardlinkDemo` with `swiftc -frontend -parse`
- Validated `project.yml` as YAML
- Validated both property lists
- Validated all asset catalog JSON files

## Not available in this environment

The current runtime is Linux and does not include Xcode, an iOS SDK, iOS Simulator, `xcodebuild`, or XcodeGen. Therefore the two SwiftUI application targets were not type-checked or launched against the Apple SDK here.

On macOS, run:

```bash
brew install xcodegen
./scripts/verify.sh
```

That script generates `SignalGridMobile.xcodeproj` and builds both schemes for the generic iOS Simulator destination.
