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
├── setup.sh                     # Generates the Xcode project
├── run-ios.sh                   # Build + boot a simulator
├── run-code-analysis.sh
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
    │   └── DeviceInfo.swift
    ├── Views/
    │   ├── ActiveSessionViewController.swift
    │   ├── AuthenticatingViewController.swift
    │   ├── BadgeCapturedViewController.swift
    │   ├── EnrollingViewController.swift
    │   ├── HostAppViewController.swift
    │   ├── LockedIdleViewController.swift
    │   ├── ManagedAppViewController.swift
    │   ├── ProvisioningViewController.swift
    │   └── TerminatingViewController.swift
    └── Resources/
        ├── Assets.xcassets/
        ├── EnterpriseShell-Kiosk.mobileconfig
        └── README.md
```

## Configuration Required

### 1. OIDC Configuration
Edit `Services/OIDCAuthService.swift`:
```swift
struct OIDCConfig {
    let clientId: "<YOUR_CLIENT_ID>"
    let tenantId: "<YOUR_TENANT_ID>"
    let redirectUri: "com.enterprise.shell://auth/callback"
    let scopes: [...]
}
```

### 2. Backend Configuration
Set environment variable or edit `Services/BackendService.swift`:
```swift
static var baseUrl: String {
    ProcessInfo.processInfo.environment["BACKEND_BASE_URL"] ?? "https://api.enterprise.example.com"
}
```

### 3. Badge Reader Protocol
Edit `Services/BadgeReaderManager.swift`:
```swift
private let accessoryProtocol = "com.enterprise.badgereader" // Protocol string for your badge reader
```

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
   cd native/ios
   chmod +x setup.sh
   ./setup.sh
   ```

3. **Open in Xcode**
   ```bash
   open native/ios/EnterpriseShell.xcodeproj
   ```

4. **Configure Signing**
   - Select your Development Team in Xcode
   - Update bundle identifier as needed

5. **Configure Constants**
   - OIDC client ID and tenant
   - Backend URL
   - Badge reader protocol

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
| `-SimulateManualLogin YES` | Exercise the manual-override login path (no code entry); honored only when `KioskConfig.allowManualOverride` is set. |

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

`KioskConfig` (`EnterpriseShell/Services/KioskController.swift`) reads three keys.
For each one it looks **first** in the Managed App Configuration dictionary the MDM
delivers, which UserDefaults publishes under `com.apple.configuration.managed`, and
**only if the key is absent there** does it fall back to a plain
`UserDefaults.standard` lookup of the bare key name
(`KioskController.swift:171-183`). So Managed App Config from the MDM is the
intended source and wins wherever the MDM sets the key; the fallback is what makes
these keys settable at launch — `xcrun simctl launch booted com.enterprise.shell
-AllowManualOverride YES` — on a build with **no** managed configuration for that
key, which is the simulator, a dev build, or an unenrolled device. Unlike the demo
flags above, this file is compiled into device builds too.

This table is GATED by `scripts/check-demo-flags-documented.mjs` as a second derived
set, on the same rule as the flag table: the keys come from the `managedBool(` /
`managedString(` call sites, a new key fails CI until it appears here, and a row
here that nothing reads fails too.

| Key | What it controls |
|-----|------------------|
| `SingleAppModeEnabled` | Bool, **default `true`**. Whether the shell runs the kiosk-until-auth model — held captive to the badge/login screen while idle, released once a worker authenticates, re-locked when the session ends. Set `false` to opt a fleet out. Engaging the lock at all still requires MDM supervision; on an unsupervised device it is a no-op and the shell runs as a normal app. |
| `AllowManualOverride` | Bool, **default `false`**, and not recommended. Opts in to the disaster-recovery manual override, letting an admin code release the kiosk without a badge. |
| `RecoveryCode` | String, no default. The code `validateRecoveryCode` compares a typed entry against, in constant time. Never hardcoded; unset or empty means every code is denied, and it is only consulted when `AllowManualOverride` is `true`. |

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
The app uses the External Accessory Framework to communicate with badge readers connected via:
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
- Access group isolation

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
