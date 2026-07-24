# Validation guide

## Portable checks

```bash
swift test --package-path SignalGridMobileCore
find SignalGridOperator WardlinkDemo -name '*.swift' -type f -print0 \
  | xargs -0 -n1 swiftc -frontend -parse
```

## Full macOS check

```bash
brew install xcodegen
./scripts/verify.sh
```

## Manual acceptance run

### SignalGridOperator

1. Launch in offline demo mode.
2. Confirm Overview loads Northwind Health metrics.
3. Open Trust Lab.
4. Run all ten scenarios and compare result to expected outcome.
5. Open the generated decision and evidence snapshot.
6. Start, refresh, and end a session.
7. Evaluate the EMR/chart embedded app workflow.
8. Review connectors, policies, and audit chain.
9. In Settings, optionally connect to a development `/api/v1` instance.

### WardlinkDemo

1. Launch the app and confirm no SignalGrid branding appears in the worker flow.
2. Open a low-risk action under the healthy scenario.
3. Confirm a sensitive action requires Wardlink confirmation.
4. Open demo instrumentation and select the stale posture scenario.
5. Trigger a held action and complete native authentication or the explicitly labeled simulator fallback.
6. Select a restricted or denied scenario and confirm the host app keeps the action unavailable.
7. Confirm the instrumentation sheet displays decision, reason, policy version, and plan without changing the worker-facing language.
