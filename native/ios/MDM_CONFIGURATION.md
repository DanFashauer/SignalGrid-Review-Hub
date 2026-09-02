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
| `BackendBaseURL` | String | — | Control-plane base URL, first in `BackendService.resolveBaseURL()`'s order. `https://` only (http only for loopback). Unset on a managed device ⇒ no session can start (fail closed); unset on an unmanaged device ⇒ local/offline mode. |
| `BackendBearerToken` | String | — | Tenant bearer for the served `/v1` surface (`Authorization: Bearer`). Last in `BackendService.tenantBearerToken`'s order. |
| `BackendWorkflowKey` | String | `clinical-session` | The `workflowKey` sent at `POST /api/v1/sessions/start`. The default is the key the fixture tenant seeds. |
| `badge_reader_type` | String | `keyboard_wedge` | Which badge-reader provider the shell builds (`BadgeReaderType` raw value; `nfc` / `serial` are declared, not implemented). Read by `ProviderConfigurationService.configured(env:managed:)`: a present managed dictionary answers only from itself; `BADGE_READER_TYPE` in the environment is consulted on the simulator or with no managed dictionary, never over an MDM value on a device. |
| `identity_provider_type` | String | — | `IdentityProviderType` raw value; same precedence as `badge_reader_type` (an MDM value is never outranked by `IDENTITY_PROVIDER_TYPE` on a device). Unset ⇒ `ControlPlaneSessionIdentityProvider`; set only to choose another provider explicitly. |

`AllowManualOverride` defaults to `false` **everywhere**. The absence of a managed
app-config dictionary proves nothing: app-config (this section) and ASAM
authorisation (§2) are different payloads, and a supervised, kiosk-locked device may
carry no app-config at all, so nothing in the shell loosens on that absence. The
unmanaged path is a positive assertion by the holder — the Settings-bundle switch
`local_session_allowed` ("Allow local sign-in on this unmanaged device", default
OFF) — and it is refused unless the OS has explicitly refused the kiosk request
(`KioskController.asamProbe == .unavailable`); a managed dictionary, an engaged lock,
or an unanswered probe all refuse. See `native/ios/README.md`, "Settings bundle keys".

When a managed dictionary is delivered it answers only from itself: a key it lacks is
an absent value, and the launch-argument fallback the simulator uses does not apply.

Example (MDM app-config payload for `com.enterprise.shell`):

```xml
<dict>
  <key>SingleAppModeEnabled</key><true/>
  <key>AllowManualOverride</key><true/>
  <key>RecoveryCode</key><string>REPLACE-WITH-ADMIN-ISSUED-CODE</string>
  <key>BackendBaseURL</key><string>https://REPLACE-WITH-YOUR-CONTROL-PLANE</string>
  <key>BackendBearerToken</key><string>REPLACE-WITH-TENANT-TOKEN</string>
  <key>BackendWorkflowKey</key><string>clinical-session</string>
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
