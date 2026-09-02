# SignalGrid Assist — Android

A reference host-app shell for the Assist gate. It renders a decision the server
made — `allow`, `step_up`, `restrict` or `deny` — and says what the host app may
do next. SignalGrid is invisible to the worker; this screen stands in for the
app they actually use.

## What it shows

One labelled **fixture**: a `step_up` with reasons, shaped like the served
`/api/v1/authorize` response (`{assist, decisionId, reasons}` — the spec at
`lib/api-spec/v1-openapi.yaml` declares no `obligations` field, so the screen
says "step up required; the gate did not state an obligation"). The word
FIXTURE is on screen. **There is no transport**: the app makes no HTTP request
and no gate URL is configured anywhere in it; the Gate line reports that refusal
rather than leaving it blank.

## Layout

| Module | What | Needs |
| --- | --- | --- |
| `core/` | plain Kotlin: the four-outcome vocabulary, fail-closed parsing of a `/v1` response, endpoint validation, the shared conformance vectors | a JDK, nothing else |
| `app/` | the Compose shell: one Activity, one screen, the emulator check | the Android SDK |

`core/` is a **separate Gradle build** pulled in as a composite
(`app/settings.gradle.kts` `includeBuild("../core")`), so `gradle -p
native/android/core test` runs on a machine with no SDK — which is the machine
that maintains this repository. The tests there are the gate that matters; the
app module decides nothing.

## Toolchain

- **Gradle 8.14.3**, installed on the machine (CI: `gradle/actions/setup-gradle`
  with the version pinned in `.github/workflows/android.yml`).
- **No Gradle wrapper, by design.** A wrapper is a binary `.jar` in the tree that
  no reviewer reads and no gate inspects; this public repository pins the version
  in plain text instead. `gradle`, not `./gradlew`.
- **JDK 17 or newer.** Both modules target 17 bytecode with `jvmTarget` /
  `-release`, not `jvmToolchain(17)`, so a machine with only JDK 21 builds them
  without provisioning a second JDK. CI uses Temurin 21.
- **Android SDK with licences accepted** (`sdkmanager --licenses`) for `app/`
  only: `compileSdk 35`, `minSdk 26` (the rugged Zebra/Honeywell fleet still in
  service), AGP 8.7.3, Kotlin 2.1.0, Compose BOM 2024.12.01.

```bash
gradle -p native/android/core test --console=plain      # no SDK needed
node scripts/check-android-core-tests.mjs                # every @Test in the source actually ran
gradle -p native/android/app assembleDebug --console=plain       # needs the SDK
gradle -p native/android/app testDebugUnitTest --console=plain   # DeviceGateTest; needs the SDK to configure
```

## Rules the code carries

- **Plaintext is refused off loopback, at two layers.** The validator layer:
  `GateEndpoint` accepts `http://` only to `localhost`, `127.0.0.1`, `::1`;
  anything else must be `https://`; credentials in the authority are refused,
  not stripped. The platform layer: the main manifest sets
  `android:usesCleartextTraffic="false"` explicitly (the platform default only
  became `false` on API 28 and `minSdk` is 26), so a **release APK cannot send
  plaintext to anything** — including the loopback names the validator would
  accept — whatever the code does.
- **Emulator loopback, debug builds only.** `10.0.2.2` is the emulator's alias
  for the host machine and is loopback *only there*; on a device it is a
  routable address, and the Rust desktop client refuses it. Both layers make
  the same single exception and only in a debug build. Validator:
  the loopback set is a constructor parameter of `GateEndpoint`, strict by
  default; `app/…/DeviceGate.kt` passes `GateEndpoint.EMULATOR_LOOPBACK` only
  when `BuildConfig.DEBUG` is true AND `Build.PRODUCT` starts with `sdk`,
  `google_sdk` or `emulator` (prefix match, pinned by `DeviceGateTest`; a
  release build never widens, whatever the product string says). Platform:
  `native/android/app/src/debug/AndroidManifest.xml` overlays a network security config
  (`native/android/app/src/debug/res/xml/network_security_config.xml`) that excepts exactly that
  one domain from the cleartext ban; release has no overlay. The product-string
  check is a heuristic, stated as one: a spoof can make a *debug* build on a
  real device accept plaintext to that one address, and nothing more.
- **The base URL is the `/api` mount.** The client appends `/v1/authorize`, so
  the only base that reaches a decision is `https://host/api`. A bare host yields
  a 404, and a 404 is a deny.
- **Unknown never lowers assurance.** A status outside 2xx, an empty or non-JSON
  body, a missing or unrecognised `assist` value — all parse to `DENY` with a
  reason naming the failure. `native/shared/assist-wire-conformance.json` holds
  the cases every client must agree on; `SharedConformanceTest` runs them here.
- **Follows the device.** The window theme has a day and a night half
  (`res/values`, `res/values-night`, platform themes, no Material Components
  dependency) and the Compose scheme follows `isSystemInDarkTheme()`.

## What CI proves, exactly

`.github/workflows/android.yml`: the core tests run and every declared `@Test`
produced a result; `assembleDebug` produces an **unsigned debug APK**, uploaded
as an artifact; the app module's JVM unit tests (`DeviceGateTest`) run and their
XML is asserted to exist. Not release-signed, not on Play, never run on an
emulator in CI.
