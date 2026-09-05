# Enterprise Shell - iOS Enterprise Login Shell

A secure iOS/iPadOS enterprise application that functions as a "login shell" for shared mobile devices in supervised, MDM-managed environments.

## Overview

Enterprise Shell provides a kiosk-style interface for shared devices in enterprise
environments. Users authenticate using hardware badge readers; the app drives the
session lifecycle and wipes session data on teardown.

**What the app does versus what the OS does.** The app cannot make itself
non-removable, force full screen, or relaunch itself — those are OS capabilities.
`Services/KioskController.swift` *requests* Autonomous Single App Mode, which the OS
grants only on an **MDM-supervised** device whose management profile authorizes this
bundle ID. Enforcement is the MDM's and the OS's; on an unsupervised device or the
simulator the request is refused and the shell stays windowed and removable. The
device-side half is documented in `native/ios/mdm/README.md`.

## Features

### Core Functionality
- **Badge Reader Integration**: USB-C/Lightning hardware badge reader support via External Accessory Framework
- **Session State Machine**: Explicit state transitions (LockedIdle → BadgeCaptured → Authenticating → Provisioning → ActiveSession → Terminating → LockedIdle)
- **OIDC Authentication**: Microsoft Entra ID integration with token exchange flow
- **Secure Token Storage**: iOS Keychain for authentication tokens
- **Backend API Integration**: Session start/end, audit logging
- **Persona-Based UI**: Role-based workspace configuration
- **App Launching**: Launch enterprise apps based on user role
- **Session Teardown**: Complete data wipe on session end
- **Audit Logging**: Comprehensive event logging

### Platform Support
- iPadOS 15.0+ (primary target)
- iOS 15.0+ (secondary)
- Kiosk lock (ASAM) requires a supervised, MDM-managed device; without that the
  app runs but does not lock down
- Sibling shells that already exist, are built in CI, and are NOT "future":
  - **Android** — `native/android` (Assist core + a reference host activity),
    43 `@Test` cases, built by `.github/workflows/android.yml`
  - **Desktop** — `native/desktop` (Tauri shell over a Rust Assist core), built on
    **Windows and Linux** by `.github/workflows/desktop.yml`. There is no macOS
    desktop target.

### Security & Authentication
- **WebAuthn/FIDO2 Support**: Admin step-up authentication for high-risk operations
- **YubiKey Support**: Hardware security keys for sensitive admin actions
- **Step-Up Authentication**: Time-limited 2FA for operations like:
  - Webhook secret rotation
  - Integration credential changes
  - Policy editing/enabling
  - Device quarantine
  - Allowlist toggling
  - Admin deletion
- Windows/OneSign-style PC SSO: Future optional feature

## Project Structure

```
native/ios/
├── project.yml                  # XcodeGen configuration
├── Package.swift                # SwiftPM manifest
├── run-ios.sh                   # Build + boot a simulator
├── README.md                    # This file
├── MDM_CONFIGURATION.md         # Management-profile keys
├── FLEET_MDM.md                 # Fleet-specific enrollment notes
├── PROVIDER_CONFIGURATION.md    # Badge / identity provider config
├── BLE_MVP_ACCEPTANCE_TESTS.md
├── mdm/                         # Kiosk .mobileconfig + its README
├── scripts/pick-simulator.py
├── SignalGridMobile/            # Separate SwiftUI package (Operator + Wardlink)
├── EnterpriseShellTests/        # XCTest: AppWorkflows, DecisionEngine, DecisionService,
│                                #   ScreenCapturePolicy, SessionState, SignalContext
└── EnterpriseShell/
    ├── AppDelegate.swift
    ├── SceneDelegate.swift
    ├── SessionWindow.swift
    ├── Info.plist
    ├── EnterpriseShell.entitlements
    ├── Models/
    │   ├── SessionData.swift
    │   └── SessionState.swift
    ├── Services/
    │   ├── AppLauncher.swift
    │   ├── AppWorkflows.swift          # byte-faithful port — see CLAUDE.md rule 1
    │   ├── AuditLogger.swift
    │   ├── BLEBadgeReaderProvider.swift
    │   ├── BackendService.swift
    │   ├── BadgeReaderManager.swift
    │   ├── BadgeReaderProvider.swift
    │   ├── DecisionEngine.swift        # byte-faithful port — see CLAUDE.md rule 1
    │   ├── DecisionService.swift
    │   ├── DemoMode.swift              # simulator-only launch flags
    │   ├── DesignSystem.swift
    │   ├── IdentityProvider.swift
    │   ├── KeychainService.swift
    │   ├── KioskController.swift
    │   ├── OIDCAuthService.swift
    │   ├── ProviderConfigurationService.swift
    │   ├── ScreenCaptureGuard.swift
    │   ├── ScreenCapturePolicy.swift
    │   ├── SecurityManager.swift
    │   ├── SessionStateManager.swift
    │   ├── SignalContext.swift
    │   └── USBCBadgeReaderProvider.swift
    ├── Utilities/
    │   ├── DeviceInfo.swift
    │   └── UIColor+Hex.swift
    ├── Views/
    │   ├── ActiveSessionView.swift
    │   ├── AuthenticatingView.swift
    │   ├── BadgeCapturedView.swift
    │   ├── EnrollingView.swift
    │   ├── HostAppViewController.swift
    │   ├── LockedIdleView.swift
    │   ├── ManagedAppViewController.swift
    │   ├── ProvisioningView.swift
    │   └── TerminatingView.swift
    └── Resources/
        ├── Assets.xcassets/
        ├── EnterpriseShell-Kiosk.mobileconfig
        └── README.md
```

## Configuration Required

### 1. Backend base URL — resolution order

`Services/BackendService.swift` (`resolveBaseURL()`) resolves the control-plane
base URL in this order and **no further**:

1. Managed App Config key `BackendBaseURL` (MDM-delivered; the device path)
2. `-DemoBackendURL <url>` launch argument (simulator only; loopback only)
3. `BACKEND_BASE_URL` in the process environment (Xcode scheme / CI)
4. **nil — there is no placeholder host.** With nil the app runs in
   **local/offline mode**: no network call is made anywhere, the lock screen's
   footer says `No backend configured — running locally; audit stays on this
   device`, and a badge or Manual login opens a local, app-less workspace **only
   when `KioskConfig.localSessionAllowed` holds** (§4). Otherwise no session can
   start at all — a kiosk whose control plane is unreachable must not open on any
   badge (fail closed).

`BackendService.configuration` is a tri-state — `.configured(url)`,
`.refused(error)`, `.absent` — and every consumer (session start/refresh/end,
health check, the host app's decision service, the OIDC and MDM providers)
tightens on `.refused`: a backend that exists and cannot be used is never treated
as "offline by design". A control-plane session whose backend is refused or absent
at end time **throws** rather than recording a clean end (`terminateSession` wipes
local data first and records the failure).

The URL must be `https://`. `http://` is accepted **only for loopback**
(`127.0.0.1`, `localhost`, `::1`) so a developer can point at a local api-server;
anything else is refused with `BackendError.insecureBaseURL`, which the lock
screen prints in its footer. This used to be a `fatalError` that took the app down
about 30 s after launch (from the audit timer) whenever a local `http://` backend
was configured, even in demo mode.

The bearer every request carries (`Authorization: Bearer <tenant token>`, the
only credential `artifacts/api-server/src/middlewares/context.ts` accepts) resolves
as: the configured identity provider's token → `-DemoBackendToken` (simulator) →
`BACKEND_BEARER_TOKEN` → Managed App Config `BackendBearerToken`.

### 2. Identity provider

Unless `IDENTITY_PROVIDER_TYPE` is set, the identity provider is
`ControlPlaneSessionIdentityProvider` (`Services/IdentityProvider.swift`): the
session the control plane mints at `POST /api/v1/sessions/start` **is** the
authenticated session — its id is the token, its `expiresAt` the expiry, and
refresh is `POST /api/v1/sessions/{id}/refresh`. The OIDC / MDM / MFA / hybrid
providers remain selectable, but they call `/api/auth/*` routes this repository's
api-server does not serve, and the template OIDC config in
`Services/OIDCAuthService.swift` / `IdentityProvider.swift` still holds
`<YOUR_CLIENT_ID>` / `<YOUR_TENANT_ID>` placeholders, which are now **refused with a
named error** (`placeholderConfiguration`) instead of crashing on a nil URL.

### 3. Badge reader — the keyboard-wedge path

The default reader is `keyboard_wedge`. Most USB / Bluetooth badge readers are HID
keyboards: they type the badge id and press Return. `LockedIdleViewController`
holds an invisible, keyboard-less `UITextField` as first responder while the lock
screen is showing; every keystroke is forwarded to
`KeyboardWedgeBadgeReaderProvider` as a `.badgeReaderKeyboardInput` notification
and discarded (the provider owns the buffer; Return completes the read). Before
2026-09-02 nothing posted that notification, so a real reader's keystrokes went
nowhere and the lock screen was dead on every physical phone. The field is
re-armed on appear, on app activation, and after every alert the screen presents.

The status line reads the **configured** provider's readiness
(`ProviderConfigurationService.badgeReaderStatus()`), not the legacy
`BadgeReaderManager`, which nothing configures. A reader type that is declared but
not implemented (`nfc`, `serial`) is audited and printed in the footer.

For the legacy External Accessory path the protocol string is in
`Services/BadgeReaderManager.swift` (`com.enterprise.badgereader`).

### 4. Unmanaged devices — local sign-in

`KioskConfig.isManaged` is true only when an MDM has delivered a
`com.apple.configuration.managed` dictionary. **That proves nothing about
supervision**: Managed App Config and the `com.apple.applicationaccess` ASAM
authorisation are different payloads, and a supervised, kiosk-locked device may
carry no app-config dictionary at all. So nothing loosens on its absence —
`AllowManualOverride` defaults to `false` everywhere.

The unmanaged path is a **positive assertion by the holder**: the Settings-bundle
switch **Allow local sign-in on this unmanaged device** (iOS Settings → Enterprise
Shell; key `local_session_allowed`, default OFF). `KioskConfig.localSessionAllowed`
requires ALL of: no managed dictionary, the switch ON, and the OS having
**explicitly refused** the kiosk request (`KioskController.asamProbe ==
.unavailable`). The probe is a tri-state maintained on the main thread —
`notAttempted` (no answer yet, or the org opted out of the kiosk model),
`unavailable` (the OS refused ASAM: unsupervised or not permitted), `engaged`
(ASAM or manual Guided Access was granted at least once this process; sticky) —
and only `unavailable` counts: "not answered yet" is not "unsupervised", and an
engaged lock proves supervision whatever the dictionary says. The guard is read on
the main thread only; `BackendService.startSession` hops to it. Then the lock
screen shows Manual login, confirms without a code, and opens a local, app-less
session. The footer says which case applies: switch off (and where to turn it on),
switch on, probe not yet answered, or "the kiosk lock has engaged — this device is
supervised; Manual login is unavailable". Under managed configuration the
`AllowManualOverride` / `RecoveryCode` keys govern exactly as before, admin code
required.

In a local session the host app's Assist gate still runs the on-device engine, but
with no control plane at all a local `allow` is **clamped to `step_up`** with reason
`NO_CONTROL_PLANE` (`HostAppViewController.ClampedLocalDecisionService`) — the same
posture as a refused or unreachable authority; restrict/deny stand. The simulator
demo (`-DemoMode YES`) is the one exception, because `DemoMode` is the stand-in
control plane everywhere else in the shell.

Each lock-screen appearance writes one deterministic row — audit event
`lockScreenPresented` and an `os_log` line under subsystem `com.enterprise.shell`:
`lock_screen_presented trigger=… manual_login_available=… managed=… kiosk_active=…
asam_probe=… local_session_allowed=…` — which `scripts/mac/ios-shell-repair.sh`
asserts on.

### 5. Signing (device builds)

`project.yml` sets **no** signing value and no bundle id (project-level build
settings would override an xcconfig; `bundleIdPrefix` was removed for the same
reason). Its `configFiles` point at the **tracked** `native/ios/Signing.xcconfig`,
which holds the simulator defaults — no team, ad-hoc identity, signing not
required, `com.enterprise.shell` — and ends with `#include? "Signing.local.xcconfig"`,
Xcode's optional include: a later assignment overrides an earlier one and a
missing file is not an error. So `xcodegen generate && xcodebuild -sdk
iphonesimulator` builds on a fresh clone with nothing set up. For a device:
`cp Signing.local.xcconfig.example Signing.local.xcconfig`, fill in the team,
identity, `CODE_SIGNING_REQUIRED = YES` and a bundle id your team can sign; the
real file is gitignored. `EnterpriseShell.entitlements`
is now an empty dictionary: the associated-domains, app-group, time-sensitive
notification and keychain-access-group entitlements it demanded were used by no
code (verified by grep, 2026-09-02) and each was one more capability a device
profile had to grant before the app would install.

## Setup Instructions

### Prerequisites
- macOS with Xcode
- XcodeGen (install via `brew install xcodegen`)
- Apple Developer account (for code signing)

### Build Steps

1. **Install XcodeGen**
   ```bash
   brew install xcodegen
   ```

2. **Generate Xcode Project**

   All paths below are repo-relative — run them from the root of the checked-out
   revision, never from a stray copy of the iOS tree.
   ```bash
   cd native/ios && xcodegen generate
   ```
   (The former `setup.sh` wrapper and `run-code-analysis.sh` are gone: the first
   only wrapped this command with stale hints, the second re-implemented the seven
   `custom_rules` already in `.swiftlint.yml` — run
   `swiftlint --config native/ios/.swiftlint.yml` instead.)

3. **Open in Xcode**
   ```bash
   open native/ios/EnterpriseShell.xcodeproj
   ```

4. **Configure Signing** (device builds only)
   - `cp native/ios/Signing.local.xcconfig.example native/ios/Signing.local.xcconfig`
     and fill in your team, identity and bundle id; it is gitignored and pulled in
     by the tracked `Signing.xcconfig` via `#include?`. Re-run `xcodegen generate`.

5. **Configure the backend**
   - See "Configuration Required" above: `BackendBaseURL` via Managed App Config on
     a device, `-DemoBackendURL` in the simulator, or `BACKEND_BASE_URL`; plus a
     tenant bearer.

6. **Build and Run**

   `ipados` is not an SDK name; the simulator SDK is `iphonesimulator`. This is the
   block in `CLAUDE.md`, and it is the one that is run:
   ```bash
   cd native/ios && xcodegen generate && \
     xcodebuild -scheme EnterpriseShell -sdk iphonesimulator \
       -destination 'platform=iOS Simulator,name=iPhone 17' build
   ```

## Simulator demo flags

`Services/DemoMode.swift` is compiled out of device builds (`#if
targetEnvironment(simulator)`), so everything below exists only in the simulator.
Pass flags at launch:

```bash
xcrun simctl launch booted com.enterprise.shell -SimulateBadge 04A3F291 -DemoMode YES
```

A flag with an explicit value wins (`-DemoMode NO` really does disable it); a bare
`-Flag` is an opt-in. This table is GATED by
`scripts/check-demo-flags-documented.mjs`, which derives the flag set from the Swift
that reads it — a new flag fails CI until it appears here, and a row here for a flag
nothing reads fails too.

| Flag | What it does |
|------|--------------|
| `-DemoMode YES` | Master switch: run the whole LockedIdle → Authenticating → Provisioning → ActiveSession lifecycle against canned responses, with no backend or identity provider. |
| `-DemoUnenrolled` | Treat the scanned badge as not enrolled, so the enrollment flow can be demonstrated. |
| `-DemoAutoEnd` | ActiveSession auto-ends after a short delay, demonstrating terminate → teardown → lockedIdle. |
| `-DemoIdleLock` | Persona uses an 8-second idle timeout instead of 300, so inactivity auto-lock shows in seconds. |
| `-DemoOpenApp` | Auto-open the first workspace app in the in-app managed browser (app access stays native/contained). |
| `-DemoAssist` | Auto-open the embedded Assist host-app demo: the invisible-gate flow allow → step-up → confirm → applied. |
| `-DemoAssistAuto` | The Assist demo self-walks the full gate flow, so each state can be captured without taps. |
| `-DemoAssistDecline` | The auto-walk declines the confirmation, capturing the fail-closed "nothing fires" state. |
| `-DemoBackendURL <url>` | Control-plane base URL. **Loopback only** — `localhost`, `127.0.0.1`, `::1`; any other host resolves nil and the app stays on-device (fail closed). |
| `-DemoBackendToken <tok>` | Bearer token for that control plane. |
| `-DemoBackendIdentity <ref>` | Tenant-seeded identity ref to send, e.g. `nurse.compliant`, so a real verdict comes back rather than a fail-closed fallback. |
| `-DemoBackendDevice <ref>` | Tenant-seeded device ref, e.g. `ipad-ward-01`. |
| `-DemoLocation warehouse\|clinic\|office` | Building/area the device is deployed in; drives which role and app workspace the user is provisioned with. Defaults to `office`. |
| `-DemoZone <zone>` | The zone the device is *sensed* in. iOS cannot sense this here, so it is injected; unset means it matches `-DemoLocation`. Use a mismatch to force a deny. |
| `-DemoSignal a,b,c` | Comma-separated conditions iOS cannot detect natively (`stale`, `non_compliant`, `security_risk`, `remediated`), driving allow → step_up → restrict. |
| `-DemoScreenCaptureAfter <s>` | Seconds after the host app opens before simulating screen recording starting (`UIScreen.isCaptured` cannot be toggled from simctl). Unset/0 means off. |
| `-DemoStaleAfter <s>` | Seconds before simulating the session going stale, driving the live re-evaluation path deterministically. Unset/0 means off. |
| `-DemoLockoutAfter <s>` | Seconds before simulating a security lockout engaging. Unset/0 means off. |
| `-SimulateBadge <id>` | Inject a badge scan once, since the simulator has no reader hardware. Documented in `DemoMode.swift`, **implemented in `native/ios/EnterpriseShell/Views/LockedIdleViewController.swift:142`**. |
| `-SimulateManualLogin YES` | Exercise the manual-override login path (no code entry); honored only when `KioskConfig.manualLoginAvailable` holds — `-AllowManualOverride YES`, or the local sign-in switch (`xcrun simctl spawn booted defaults write com.enterprise.shell local_session_allowed -bool true`). |

`native/ios/run-ios.sh` launches on **iPhone 17** with `-DemoMode YES -SimulateBadge
04A3F291` by default (the same flags `scripts/mac/run-everything.sh` passes) and
prints what it launched with. `LAUNCH_ARGS="" ./run-ios.sh` launches with no flags:
the non-demo path, where the expected lock screen shows the unmanaged footer with
local sign-in OFF and **no** Manual login until the Settings switch is on.

## MDM Configuration

### Required Restrictions
When configuring MDM, apply these restrictions for kiosk mode:
- `SingleAppMode` or `Autolock` enabled
- `AllowCamera` = false (unless needed)
- `AllowScreenShot` = false
- `AllowUSBFileTransfer` = false
- `AllowOpenFrom unmanaged to managed` = false
- `AllowOpenFrom managed to unmanaged` = false

### App Configuration Payload
```xml
<key>PayloadContent</key>
<array>
    <dict>
        <key>PayloadType</key>
        <string>com.apple.app.lock</string>
        <key>Mandatory</key>
        <true/>
        <key>PayloadIdentifier</key>
        <string>com.enterprise.shell.appLock</string>
        <key>PayloadUUID</key>
        <string>...</string>
        <key>PayloadVersion</key>
        <integer>1</integer>
        <key>LockApplication</key>
        <true/>
    </dict>
</array>
```

### Managed App Config keys

`KioskConfig` (`EnterpriseShell/Services/KioskController.swift`) reads six keys, and
`ProviderConfigurationService` reads two more (`badge_reader_type`,
`identity_provider_type`) from the same dictionary through its
`configured(env:managed:)` accessor, with the SAME precedence as `KioskConfig`.
For each one it looks **first** in the Managed App Configuration dictionary the MDM
delivers, which UserDefaults publishes under `com.apple.configuration.managed`, and
**only when no managed dictionary exists at all** does it fall back to a plain
`UserDefaults.standard` lookup of the bare key name
(`managedBool` / `managedString` in `KioskController.swift`). A present managed
dictionary answers only from itself: a key it lacks is an absent value, never a
launch argument — so on a managed device a `-BackendBaseURL` launch argument can
set nothing. The fallback is what makes these keys settable at launch —
`xcrun simctl launch booted com.enterprise.shell -AllowManualOverride YES` — on a
build with **no** managed configuration, which is the simulator, a dev build, or an
unenrolled device. Unlike the demo flags above, this file is compiled into device
builds too. `ProviderConfigurationService.configured(env:managed:)` differs from
`KioskConfig` in one respect only: its no-dictionary fallback is a process
**environment** variable (`BADGE_READER_TYPE` / `IDENTITY_PROVIDER_TYPE`) rather than
a bare-key `UserDefaults` read, and that environment arm is compiled into the
simulator only (`#if targetEnvironment(simulator)`) whenever a managed dictionary is
present — on a managed device the environment can never outrank the MDM.

This table is GATED by `scripts/check-demo-flags-documented.mjs` as a second derived
set, on the same rule as the flag table: the keys come from the `managedBool(` /
`managedString(` call sites and from `configured(env:managed:)` call sites whose
key is a same-file `ConfigKeys` constant, a new key fails CI until it appears here,
and a row here that nothing reads fails too.

| Key | What it controls |
|-----|------------------|
| `SingleAppModeEnabled` | Bool, **default `true`**. Whether the shell runs the kiosk-until-auth model — held captive to the badge/login screen while idle, released once a worker authenticates, re-locked when the session ends. Set `false` to opt a fleet out. Engaging the lock at all still requires MDM supervision; on an unsupervised device it is a no-op and the shell runs as a normal app. |
| `AllowManualOverride` | Bool, **default `false` everywhere**, and not recommended. Opts in to the disaster-recovery manual override, letting an admin code release the kiosk without a badge. The absence of a managed dictionary never changes this default (see "Settings bundle keys" for the unmanaged path). |
| `RecoveryCode` | String, no default. The code `validateRecoveryCode` compares a typed entry against, in constant time. Never hardcoded; unset or empty means every code is denied, and it is only consulted when `AllowManualOverride` is `true`. |
| `BackendBaseURL` | String, no default. Control-plane base URL; first in `BackendService.resolveBaseURL()`'s order. `https://` only (http only for loopback). Unset on a managed device ⇒ no session can start; unset on an unmanaged device ⇒ local/offline mode. |
| `BackendBearerToken` | String, no default. Tenant bearer for the served `/v1` surface; last in `BackendService.tenantBearerToken`'s order (after `-DemoBackendToken` and `BACKEND_BEARER_TOKEN`). |
| `BackendWorkflowKey` | String, default `clinical-session` (the key the fixture tenant seeds). The `workflowKey` sent at `POST /api/v1/sessions/start`. |
| `badge_reader_type` | String, default `keyboard_wedge`. Which badge-reader provider `ProviderConfigurationService` builds — a `BadgeReaderType` raw value: `keyboard_wedge`, `usbc`, `usb_accessory`, `bluetooth_le`, `http_webhook`, `mdm_enrollment` (`nfc` / `serial` are declared, not implemented — the lock screen says so; see `PROVIDER_CONFIGURATION.md`). Read by `ProviderConfigurationService.configured(env:managed:)`: a present managed dictionary answers only from itself; the `BADGE_READER_TYPE` environment variable is consulted on the simulator, or on a device with no managed dictionary at all. |
| `identity_provider_type` | String, no default. An `IdentityProviderType` raw value (`oidc`, `saml`, `mdm`, `mfa`, `hybrid`, `custom`). Same precedence as `badge_reader_type` (managed dictionary first; `IDENTITY_PROVIDER_TYPE` only on the simulator or with no dictionary). Unset — and the environment not consulted or unset — the shell uses `ControlPlaneSessionIdentityProvider` (the served `/v1` surface needs no token exchange); set it only to choose a different provider explicitly, which also requires that provider's own configuration to hold no template placeholders. |

### Settings bundle keys

`EnterpriseShell/Settings.bundle/Root.plist` declares the switches a holder can
flip in **iOS Settings → Enterprise Shell**. Read through `UserDefaults.standard`;
an absent key reads as OFF. GATED by the same script as a third derived set: every
key the bundle declares must be read by the shell and documented here, and a row
here for a key the bundle does not declare fails.

| Key | What it controls |
|-----|------------------|
| `local_session_allowed` | Bool, **default OFF**. "Allow local sign-in on this unmanaged device." The one positive assertion an unmanaged phone can make: with it ON, no managed dictionary, and no kiosk lock engaged, `KioskConfig.localSessionAllowed` lets Manual login start a local, app-less session without a badge or code. Ignored whenever a managed dictionary or an active kiosk lock is present. |

## Session Lifecycle

### State Machine
```
LockedIdle → BadgeCaptured → Authenticating → Provisioning → ActiveSession → Terminating → LockedIdle
```

### State Descriptions
1. **LockedIdle**: Full-screen login prompt, waiting for badge scan
2. **BadgeCaptured**: Badge ID received, preparing authentication
3. **Authenticating**: Validating badge with backend, OIDC flow
4. **Provisioning**: Loading persona, launching apps
5. **ActiveSession**: User workspace, role-based UI
6. **Terminating**: Revoking tokens, clearing data, logging

### Session End Triggers
- User taps "End Session" button
- Idle timeout (configurable per persona)
- Security violation detected
- App goes to background (if not allowed)
- MDM-initiated lock

## Badge Reader Integration

### Supported Hardware
The default and most common path is the **keyboard wedge** (HID readers; see
"Configuration Required" §3). The External Accessory path is for MFi readers
connected via:
- USB-C
- Lightning

### Protocol Requirements
Your badge reader must:
1. Support the External Accessory Protocol
2. Send badge data via serial communication
3. Format: `[HEADER][BADGE_ID][FOOTER]`

Example data format:
- Header: `0x02`
- Footer: `0x03`
- Example: `0x02 31 32 33 34 35 36 0x03` → Badge ID: "123456"

## Security Features

### Token Storage
- All tokens stored in iOS Keychain
- `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` protection
- No keychain access group (the entitlement was unused and has been removed);
  `DeviceInfo.identifier` is also cached in memory so it never changes per call
  even when the Keychain save fails (an unsigned simulator build).

### Session Isolation
- No data persistence between sessions
- Automatic token revocation on end
- Audit logging for all operations

### Data Wipe
On session end:
- Keychain cleared
- URL cache purged
- User defaults reset
- In-memory data cleared

## Backend API

This app is a CLIENT of the SignalGrid control plane. The served surface is
specified once, in `lib/api-spec/v1-openapi.yaml` (mounted under `/api`, so the
session-start route is **`POST /api/v1/sessions/start`** — see
`artifacts/api-server/src/routes/v1.ts`). Read the spec; do not read a second copy
of it here.

What the shell uses, and what the server does and does not serve (checked
2026-09-02):

| Shell call | Route | Served? |
|---|---|---|
| `BackendService.startSession` | `POST /api/v1/sessions/start` — body `{identityRef, deviceRef, workflowKey}`, returns `{session, decision}`; only a decision of `allow` starts a shell session | yes |
| `BackendService.refreshSession` | `POST /api/v1/sessions/{id}/refresh` | yes |
| `BackendService.endSession` | `POST /api/v1/sessions/{id}/end` | yes |
| `BackendService.healthCheck` | `GET /api/v1/context` (there is no unauthenticated `/health`) | yes |
| Assist gate (`RemoteDecisionService`) | `POST /api/v1/app-workflows/evaluate` | yes |
| Audit upload | none — `/v1/audit` is a GET. `AuditLogger` keeps a bounded on-device queue (500 in memory, drop-oldest and counted; 1000 on disk) and never re-queues for the network | **no** |
| Badge enrollment | none — no `/badges` route. `EnrollingViewController` says so and returns to the lock screen | **no** |
| OIDC token exchange / logout / MDM session (`/api/auth/*`) | none | **no** |
| Request-signing headers `SecurityManager.signRequest` adds to every call (`X-Request-Signature`, `X-Request-Timestamp`, `X-Request-Nonce`, `X-Device-Binding`) | none READS them — no source under `artifacts/api-server` names any of the four (checked 2026-09-02). Additive until a server-side verifier exists; that verifier is the cloud lane's wire contract. `X-Device-Binding` carries SHA-256 of the device-binding key, never the key (it carried the key itself until 2026-09-02) | **not read** |

The served contract carries no persona or app catalog; a control-plane session
opens an honest, app-less workspace naming the decision, not invented apps.

Everything this README previously listed under this heading — `/api/audit/logs`,
`/api/admin/integrations/webhooks`, `/api/admin/location`, and the
`BACKEND_SIGNING_SECRET` / `ADMIN_API_KEY` / `OIDC_ISSUER_URL` environment
variables — was checked against `artifacts/api-server/src`, `lib/` and `scripts/`
on 2026-09-02 and appears in none of them. It described a different service.

The Swift request models live in `Models/SessionData.swift`.

### Location signals, webhooks, integrations

Not this app's surface. These are control-plane concerns; the served contract is
`lib/api-spec/v1-openapi.yaml`, and the location and webhook libraries are
`lib/location/` and `lib/integrations/`. The ~120 lines that used to sit here
described endpoints (`/api/location/report`, `/api/admin/location`,
`/api/admin/integrations/webhooks`) that do not exist in
`artifacts/api-server/src`, alongside environment variables that do exist in
`lib/` — a mixture no reader could tell apart, in a README about an iOS client.

## Testing

### Badge Reader Testing
1. Use Xcode to run on device
2. Connect badge reader via USB-C/Lightning
3. Tap badge - should progress through states
4. Check Xcode console for debug output

### Session Flow Testing
1. Start app → LockedIdle state
2. Simulate badge scan → BadgeCaptured → Authenticating
3. Backend mock → Provisioning → ActiveSession
4. Tap End Session → Terminating → LockedIdle

## Deployment

### App Store / VPP
1. Archive in Xcode
2. Upload to App Store Connect
3. Distribute via Volume Purchase Program (VPP)

### Custom Enterprise Distribution
1. Create Enterprise Certificate
2. Export as .ipa
3. Distribute via MDM

## Limitations (MVP)

### iOS App
- No NFC badge reading
- No offline authentication
- No biometric fallback
- No Apple ID integration
- No OS-level user switching

## Dependencies

No external dependencies required. Uses:
- iOS 15+ SDK
- Security framework
- External Accessory framework
- AuthenticationServices framework

## License

MIT — see `LICENSE` at the repository root, and `NOTICE` for what that grant does
and does not cover.

## Support

For enterprise support and customization, contact your IT department.
