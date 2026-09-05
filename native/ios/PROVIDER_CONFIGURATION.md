# Provider Configuration Guide

This document explains how to configure the EnterpriseShell kiosk app to work with different badge readers and identity providers.

## Overview

The app now supports flexible configuration of:
1. **Badge Readers** - Any badge reader system (USB, Bluetooth, NFC, Serial, MDM, etc.)
2. **Identity Providers** - the control-plane session (default) or OIDC via the backend token exchange

This allows you to integrate with your existing infrastructure without code changes.

## Badge Reader Types

### Available Badge Reader Types

**Status column, verified 2026-09-02.** "Implemented" means
`BadgeReaderProviderRegistry.registerBuiltInProviders()`
(`EnterpriseShell/Services/BadgeReaderProvider.swift:180`) registers a factory for
the type. "Declared, not implemented" means the case exists in the `BadgeReaderType`
enum and can be selected by `BADGE_READER_TYPE`, but no class implements it — no
`class NFC…` / `class Serial…` exists anywhere under `native/ios` — so
`createProvider(config:)` finds no factory and returns `nil`. That `nil` used to be
returned in SILENCE; since 2026-09-02 the factory writes a
`badgeReaderProviderUnavailable` audit record naming the unresolved type
("declared, not implemented"), `ProviderConfigurationService.badgeReaderUnavailableReason`
records it, and the lock screen prints it in its footer and status line instead of
waiting for a reader that cannot exist. Selecting one still leaves the app with no
badge reader.

| Type | Description | Configuration | Status |
|------|-------------|---------------|--------|
| `usb_accessory` | Legacy shim (`ExternalAccessoryBadgeReaderProvider`) delegating to the `BadgeReaderManager` singleton | - | Implemented |
| `usbc` | USB-C/Lightning badge readers via ExternalAccessory (`USBCBadgeReaderProvider`, the BLE-parity provider). Was registered under a bare string no enum case matched, so nothing could select it until 2026-09-02. | Protocol string | Implemented |
| `bluetooth_le` | Bluetooth Low Energy badge readers | Service UUID, Characteristic UUID | Implemented |
| `nfc` | NFC tag reading | - | **Declared, not implemented — `createProvider` returns `nil`, audited, shown on the lock screen** |
| `serial` | Serial/RS-232 badge readers | Port, Baud rate | **Declared, not implemented — `createProvider` returns `nil`, audited, shown on the lock screen** |
| `keyboard_wedge` | Keyboard emulation mode (most common) | - | Implemented |
| `http_webhook` | HTTP-based badge events. **Starts no listener** — badges arrive only when the host calls `processIncomingBadge(_:metadata:)`. `BADGE_WEBHOOK_URL` / `BADGE_WEBHOOK_SECRET` are parsed and consumed by nothing. | Webhook URL, Secret | Registered; no listener |
| `mdm_enrollment` | MDM-based device/user linking | MDM provider config | Implemented |

### Environment Variables for Badge Readers

```bash
# Badge Reader Type (required)
BADGE_READER_TYPE=keyboard_wedge

# For USB accessory readers:
BADGE_READER_PROTOCOL=com.enterprise.badgereader

# For Bluetooth LE:
BADGE_READER_SERVICE_UUID=12345678-1234-1234-1234-123456789ABC
BADGE_READER_CHAR_UUID=12345678-1234-1234-1234-123456789ABD

# For HTTP webhook:
BADGE_WEBHOOK_URL=https://badges.example.com/webhook
BADGE_WEBHOOK_SECRET=your_webhook_secret

# For Serial (parsed, but consumed by nothing — see below):
BADGE_SERIAL_PORT=/dev/ttyUSB0
BADGE_BAUD_RATE=9600
```

> **`BADGE_SERIAL_PORT` and `BADGE_BAUD_RATE` do nothing today.**
> `ProviderConfigurationService.swift:108-109` reads both from the environment into
> `BadgeReaderConfig.serialPort` / `.baudRate`, and no code anywhere reads those
> fields back — there is no serial provider to consume them. Setting them is
> silently inert, not a configuration.

## Identity Provider Types

### Available Identity Providers

**Verified 2026-09-05.** Two providers exist and both are constructed directly by
`ProviderConfigurationService.initializeProviders()` through the exhaustive switch
`IdentityProviders.make(for:)` in `EnterpriseShell/Services/IdentityProvider.swift`.
There is no registry any more: a type this build cannot construct is a compile
error, not a `nil` at runtime.

| Type | Description | Configuration | Status |
|------|-------------|---------------|--------|
| `control_plane_session` | The session the control plane minted at `POST /api/v1/sessions/start` IS the authenticated session (`ControlPlaneSessionIdentityProvider`). **The default** when `IDENTITY_PROVIDER_TYPE` is unset; may also be selected explicitly. | none | Implemented |
| `oidc` | OpenID Connect (Microsoft Entra ID, Okta, Auth0, …) via the backend token exchange (`OIDCIdentityProvider`) | Client ID, Tenant ID, Endpoints | Implemented — template placeholders are refused at authenticate time |

**Retired 2026-09-05: `mdm`, `mfa`, `hybrid`, `saml`, `custom`** (Ponytail audit
2026-09-01, ECC-confirmed). The MDM provider's identity lookup was a `return nil`
placeholder — and an app cannot read MDM identity at all (CLAUDE.md rule 4) — the
MFA provider's verification always threw, Hybrid composed those two stubs, and
`saml` / `custom` never had a class. Setting `IDENTITY_PROVIDER_TYPE` (or the
managed `identity_provider_type` key) to any of them is now REFUSED, not mapped to
the default: no identity provider is constructed, authentication fails closed ("No
identity provider configured"), and the `providerConfigurationLoaded` audit record
carries `identityProviderUnavailable` naming the value. `MDM_PROVIDER`,
`MDM_ENROLLMENT_ENDPOINT`, `MFA_*`, `SAML_*` and `CUSTOM_AUTH_*` are no longer read.

### Environment Variables for Identity Providers

#### OIDC (e.g., Microsoft Entra ID)

```bash
IDENTITY_PROVIDER_TYPE=oidc
OIDC_CLIENT_ID=your-client-id
OIDC_TENANT_ID=your-tenant-id
OIDC_REDIRECT_URI=com.enterprise.shell://auth/callback
OIDC_SCOPES=openid,profile,email,User.Read
OIDC_AUTH_ENDPOINT=https://login.microsoftonline.com/<TENANT>/oauth2/v2.0/authorize
OIDC_TOKEN_ENDPOINT=https://login.microsoftonline.com/<TENANT>/oauth2/v2.0/token
OIDC_ISSUER=https://login.microsoftonline.com/<TENANT>/v2.0
```

#### Control-plane session (the default)

```bash
# Nothing to set. The explicit form, equivalent to leaving it unset:
IDENTITY_PROVIDER_TYPE=control_plane_session
```

The MDM-provider and MFA-provider vendor lists that used to follow here described
enums nothing consumed beyond `rawValue`-stringifying them into an audit field; they
went with the retired providers. The MDM vendor enum that remains
(`MDMProviderType` in `BadgeReaderProvider.swift`) belongs to the `mdm_enrollment`
BADGE READER, not to identity.

## Common Deployment Scenarios

### Scenario 1: Keyboard Wedge Reader + control-plane session (the default)

Most common for physical badge readers that emulate keyboard input; the session
the control plane mints is the authenticated session.

```bash
BADGE_READER_TYPE=keyboard_wedge
```

### Scenario 2: Keyboard Wedge Reader + Microsoft Entra ID (OIDC)

```bash
BADGE_READER_TYPE=keyboard_wedge
IDENTITY_PROVIDER_TYPE=oidc
OIDC_CLIENT_ID=your-azure-client-id
OIDC_TENANT_ID=your-azure-tenant-id
```

### Scenario 3: USB Badge Reader + Okta (OIDC)

```bash
BADGE_READER_TYPE=usb_accessory
BADGE_READER_PROTOCOL=com.yourbadge.badgereader
IDENTITY_PROVIDER_TYPE=oidc
OIDC_CLIENT_ID=your-okta-client-id
OIDC_TENANT_ID=your-org.okta.com
```

### Scenario 4: HTTP Webhook badge events

For cloud-based badge systems that send badge events via HTTP; identity stays on
the default control-plane session.

```bash
BADGE_READER_TYPE=http_webhook
BADGE_WEBHOOK_URL=https://cloudbadges.example.com/api/badge
BADGE_WEBHOOK_SECRET=your-webhook-secret
```

The former MDM-only and Badge + MFA scenarios selected the retired `mdm` and
`hybrid` providers; either value is now refused (see above).

## Security and backend configuration

`ProviderConfigurationService` no longer mirrors either. `SecurityManager` reads its
own configuration; the backend base URL is resolved by
`BackendService.resolveBaseURL()` (managed `BackendBaseURL` → launch argument →
`BACKEND_BASE_URL` → nil), and `BackendService` reads `CERT_PINNING_ENABLED` /
`CERT_HASHES` itself. The former `SEC_*` and `BACKEND_TIMEOUT` reads in this
service fed nothing but an uncalled description string and were removed 2026-09-05
together with the six preset configurations (`standardMicrosoftEntraID`,
`usbMicrosoftEntraID`, `mdmIntune`, `badgeOkta`, `badgeWithMFA`, `hybridBadgeMFA`),
which had zero callers.

## Adding Custom Providers

### Custom Badge Reader

To add a custom badge reader, implement the `BadgeReaderProvider` protocol:

```swift
class CustomBadgeReaderProvider: BadgeReaderProvider {
    var providerId: String { "custom_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "Custom Badge Reader" }
    var isConnected: Bool { true }
    weak var delegate: BadgeReaderProviderDelegate?
    
    func setup() { /* Initialize your reader */ }
    func teardown() { /* Cleanup */ }
    func resetReaderState() { /* Reset for next user */ }
    func sendCommand(_ command: Data) throws { /* Optional */ }
}

// Register it:
BadgeReaderProviderFactory.shared.registerProvider(
    type: .custom,
    factory: { CustomBadgeReaderProvider() }
)
```

### Adding an identity provider

Implement the `IdentityProvider` protocol, add a case to `IdentityProviderType`
(its raw value is the `IDENTITY_PROVIDER_TYPE` / `identity_provider_type`
contract) and an arm to `IdentityProviders.make(for:)`. That switch has no default
arm, so the build fails until the new case names its class — which is the point.
It replaces the former `IdentityProviderFactory.registerProvider`, a registry that
let a type be selectable by configuration with nothing behind it.

## Troubleshooting

### Badge Not Being Read

1. Check `BADGE_READER_TYPE` is set correctly
2. For keyboard wedge: ensure the reader is in HID mode
3. Check console logs for badge reader events

### Authentication Failures

1. Verify identity provider configuration
2. Check network connectivity to IdP
3. Review audit logs for specific error messages
4. Ensure backend is configured to work with your IdP

### MDM badge enrollment (`mdm_enrollment`) not working

1. Verify the badge-reader MDM provider type is correct (identity has no MDM provider since 2026-09-05)
2. Check device is enrolled in MDM
3. Ensure MDM API endpoints are accessible
4. Verify API keys/credentials are valid
