# EnterpriseShell — MDM configuration (kiosk-until-auth + conditional device access)

This document describes what the SignalGrid backend / MDM must push so the shell
behaves as specified:

> The device is **locked in kiosk mode until authentication** (badge, or a manual
> override login if the org allows). Once authenticated it **unlocks for normal
> iPhone use**, but **restricted to only the apps/policy the admins configured**.
> It **re-locks** when the session ends.

## The hard boundary: app layer vs. MDM layer

An iOS app **cannot** grant device-wide access, cannot decide which *other* apps
the OS may run, and cannot force itself to stay open. Those are **OS + MDM**
capabilities. So the behavior is split:

| Concern | Enforced by | Where |
| --- | --- | --- |
| Lock the idle device to the shell (ASAM) | The app *requests* it; the OS enforces it **only** on a supervised, ASAM-authorized device | `KioskController` + MDM supervision |
| Release on auth / re-lock on session end | The app (`SessionStateManager` lifecycle) | app code |
| Manual override login (if org allows) | The app, gated by managed config | `KioskConfig.allowManualOverride` + `beginManualOverrideLogin()` |
| **Which apps a released device may run** | **MDM restrictions** the backend pushes | management profile — NOT app code |
| Device compliance / conditional access | Backend decision → MDM | control plane + MDM API |

The app is the **trust trigger + signal**; MDM is the **enforcer**.

## 1. Managed App Configuration (read by the shell)

Delivered under the `com.apple.configuration.managed` key (Apple Managed App
Config). Read by `KioskConfig` (`Services/KioskController.swift`):

| Key | Type | Default | Effect |
| --- | --- | --- | --- |
| `SingleAppModeEnabled` | Bool | `true` | Run the kiosk-until-auth model. `false` ⇒ shell never self-locks (normal app). |
| `AllowManualOverride` | Bool | `false` | Show the **Manual login** affordance on the lock screen and allow `beginManualOverrideLogin()`. |
| `RecoveryCode` | String | — | The admin-issued manual-login code (constant-time compared; empty ⇒ manual login always denied). |

Example (MDM app-config payload for `com.enterprise.shell`):

```xml
<dict>
  <key>SingleAppModeEnabled</key><true/>
  <key>AllowManualOverride</key><true/>
  <key>RecoveryCode</key><string>REPLACE-WITH-ADMIN-ISSUED-CODE</string>
</dict>
```

## 2. Supervision + ASAM authorization (required for the lock to actually engage)

The device must be **supervised** and the shell authorized for **Autonomous
Single App Mode**, via the `com.apple.applicationaccess` payload:

```xml
<dict>
  <key>autonomousSingleAppModePermittedAppIDs</key>
  <array>
    <string>com.enterprise.shell</string>
  </array>
</dict>
```

Without this, `UIAccessibility.requestGuidedAccessSession(enabled:)` returns
`false` and the shell runs as a normal app (dev/personal devices are unaffected).

## 3. The released-device allowlist (the "restricted to admin-configured apps" part)

This is the piece **only MDM can enforce**. After auth the shell releases the
lock; to keep the now-usable device restricted to the admin-approved set, the
management profile applies an **allowed-apps restriction** (supervised-only):

```xml
<dict>
  <key>allowListedAppBundleIDs</key>
  <array>
    <string>com.enterprise.shell</string>
    <string>com.apple.Preferences</string>   <!-- if allowed -->
    <string>com.acme.emr</string>             <!-- admin-configured host app -->
    <string>com.acme.wms</string>
  </array>
</dict>
```

The set mirrors the persona's `appLaunchConfig` (required/optional apps) that the
backend provisions per worker + location — the same catalog the in-shell
workspace already renders and opens (`AppLauncher`). The workspace is the
**soft/curated** launcher; this restriction is the **hard/OS-enforced** allowlist.

## 4. Trust → conditional-access loop (via the systems we integrate with, over API)

1. Worker badges in (or manual-login override) → shell runs the decision flow
   (`DecisionEngine` / `AppWorkflows`, or the control plane via `DecisionService`).
2. On `allow`, the shell releases the kiosk and reports the trust signal to the
   backend.
3. The backend applies/relaxes the device's MDM restrictions (allowlist,
   per-app config, conditional access) through the MDM provider's API
   (e.g. Intune / Jamf).
4. On session end / non-compliance, the backend re-tightens restrictions and the
   shell re-locks.

Net: a shared device is captive between users, a normal-but-governed iPhone
during an authenticated session, and never depends on the app to do what only
the OS/MDM can.
