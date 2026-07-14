# Provider Configuration Guide

This document explains how to configure the EnterpriseShell kiosk app to work with different badge readers and identity providers.

## Overview

The app now supports flexible configuration of:
1. **Badge Readers** - Any badge reader system (USB, Bluetooth, NFC, Serial, MDM, etc.)
2. **Identity Providers** - Any identity provider (OIDC, SAML, MDM, MFA, etc.)

This allows you to integrate with your existing infrastructure without code changes.

## Badge Reader Types

### Available Badge Reader Types

| Type | Description | Configuration |
|------|-------------|---------------|
| `usb_accessory` | USB-C/Lightning badge readers via ExternalAccessory framework | Protocol string |
| `bluetooth_le` | Bluetooth Low Energy badge readers | Service UUID, Characteristic UUID |
| `nfc` | NFC tag reading | - |
| `serial` | Serial/RS-232 badge readers | Port, Baud rate |
| `keyboard_wedge` | Keyboard emulation mode (most common) | - |
| `http_webhook` | HTTP-based badge events | Webhook URL, Secret |
| `mdm_enrollment` | MDM-based device/user linking | MDM provider config |

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

# For Serial:
BADGE_SERIAL_PORT=/dev/ttyUSB0
BADGE_BAUD_RATE=9600
```

## Identity Provider Types

### Available Identity Providers

| Type | Description | Configuration |
|------|-------------|---------------|
| `oidc` | OpenID Connect (Microsoft Entra ID, Okta, Auth0, etc.) | Client ID, Tenant ID, Endpoints |
| `saml` | SAML 2.0 | Entry point, Logout URL, Certificate |
| `mdm` | MDM-based authentication | MDM provider, Enrollment endpoint |
| `mfa` | MFA-only provider (Duo, RSA, etc.) | MFA provider, API key, Host |
| `hybrid` | Combination (e.g., Badge + MFA) | Multiple provider config |
| `custom` | Custom authentication | Custom endpoint, API key |

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

#### MDM Authentication

```bash
IDENTITY_PROVIDER_TYPE=mdm
MDM_PROVIDER=microsoft_intune
MDM_ENROLLMENT_ENDPOINT=https://api.example.com/mdm/enroll
```

#### MFA (e.g., Duo Security)

```bash
IDENTITY_PROVIDER_TYPE=mfa
MFA_PROVIDER=duo
MFA_API_KEY=your-duo-api-key
MFA_HOST=api-xxxx.duosecurity.com
```

#### SAML

```bash
IDENTITY_PROVIDER_TYPE=saml
SAML_ENTRY_POINT=https://idp.example.com/saml/sso
SAML_LOGOUT_URL=https://idp.example.com/saml/slo
SAML_CERTIFICATE=-----BEGIN CERTIFICATE-----...
```

## MDM Providers Supported

The app supports multiple MDM solutions for device-based authentication:

- **Jamf** - `jamf`
- **Microsoft Intune** - `microsoft_intune`
- **VMware Workspace ONE** - `vmware_workspace_one`
- **BlackBerry UEM** - `blackberry_uem`
- **Mosyle** - `mosyle`
- **Addigy** - `addigy`
- **Kandji** - `kandji`
- **Custom** - `custom`

## MFA Providers Supported

The app supports multiple MFA solutions:

- **Duo Security** - `duo`
- **RSA SecurID** - `rsa_securid`
- **CyberArk** - `cyber_ark`
- **Ping Identity** - `ping`
- **Okta Verify** - `okta_verify`
- **Google Authenticator** - `google_authenticator`
- **Custom** - `custom`

## Common Deployment Scenarios

### Scenario 1: Standard Keyboard Wedge Reader + Microsoft Entra ID

Most common for physical badge readers that emulate keyboard input.

```bash
BADGE_READER_TYPE=keyboard_wedge
IDENTITY_PROVIDER_TYPE=oidc
OIDC_CLIENT_ID=your-azure-client-id
OIDC_TENANT_ID=your-azure-tenant-id
```

### Scenario 2: USB Badge Reader + Okta

For facilities using Okta as their identity provider.

```bash
BADGE_READER_TYPE=usb_accessory
BADGE_READER_PROTOCOL=com.yourbadge.badgereader
IDENTITY_PROVIDER_TYPE=oidc
OIDC_CLIENT_ID=your-okta-client-id
OIDC_TENANT_ID=your-org.okta.com
```

### Scenario 3: MDM-Only Authentication

For devices enrolled in MDM where user identity comes from the MDM provider.

```bash
BADGE_READER_TYPE=mdm_enrollment
MDM_PROVIDER=microsoft_intune
IDENTITY_PROVIDER_TYPE=mdm
MDM_PROVIDER=microsoft_intune
```

### Scenario 4: Badge + MFA

For high-security environments requiring two-factor authentication.

```bash
BADGE_READER_TYPE=keyboard_wedge
IDENTITY_PROVIDER_TYPE=hybrid
# OIDC settings for primary auth
OIDC_CLIENT_ID=your-client-id
OIDC_TENANT_ID=your-tenant-id
# MFA settings for second factor
MFA_PROVIDER=duo
MFA_API_KEY=your-duo-key
MFA_HOST=api-xxxx.duosecurity.com
```

### Scenario 5: HTTP Webhook + Custom IdP

For cloud-based badge systems that send badge events via HTTP.

```bash
BADGE_READER_TYPE=http_webhook
BADGE_WEBHOOK_URL=https://cloudbadges.example.com/api/badge
BADGE_WEBHOOK_SECRET=your-webhook-secret
IDENTITY_PROVIDER_TYPE=custom
CUSTOM_AUTH_ENDPOINT=https://auth.example.com/api/auth
CUSTOM_AUTH_API_KEY=your-api-key
```

## Security Configuration

### Environment Variables for Security

```bash
# Rate limiting
SEC_RATE_LIMITING=true
SEC_RATE_LIMIT_ATTEMPTS=5
SEC_RATE_LIMIT_WINDOW=60
SEC_LOCKOUT_DURATION=300

# Badge validation
SEC_BADGE_VALIDATION=true
SEC_MAX_BADGE_LENGTH=50

# Request security
SEC_REQUEST_SIGNING=true
SEC_DEVICE_BINDING=true
```

## Backend Configuration

```bash
# Backend URL (required)
BACKEND_BASE_URL=https://api.enterprise.example.com

# Certificate pinning (optional)
CERT_PINNING_ENABLED=true
CERT_HASHES=sha256/AAAAAAAAAAA=,sha256/BBBBBBBBBBB=

# Timeout
BACKEND_TIMEOUT=30
```

## Preset Configurations

The app includes preset configurations for common scenarios:

```swift
// In code, you can use:
ProviderConfigurationService.standardMicrosoftEntraID
ProviderConfigurationService.usbMicrosoftEntraID
ProviderConfigurationService.mdmIntune
ProviderConfigurationService.badgeOkta
ProviderConfigurationService.badgeWithMFA
ProviderConfigurationService.hybridBadgeMFA
```

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

### Custom Identity Provider

To add a custom identity provider, implement the `IdentityProvider` protocol:

```swift
class CustomIdentityProvider: IdentityProvider {
    var providerId: String { "custom_\(UUID().uuidString.prefix(8))" }
    var displayName: String { "Custom IdP" }
    var providerType: IdentityProviderType { .custom }
    var isAuthenticated: Bool { /* Check auth state */ }
    var currentAccessToken: String? { /* Return token */ }
    
    func configure(with config: IdentityProviderConfig) { /* Setup */ }
    
    func authenticate(credentials: AuthenticationCredentials, persona: Persona) async throws 
        -> AuthenticationResult {
        // Implement authentication
    }
    
    func refreshToken() async throws { /* Refresh if needed */ }
    func revokeAuthentication(token: String) async throws { /* Logout */ }
    func getAccessToken() -> String? { /* Return current token */ }
}

// Register it:
IdentityProviderFactory.shared.registerProvider(
    type: .custom,
    factory: { CustomIdentityProvider() }
)
```

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

### MDM Not Working

1. Verify MDM provider type is correct
2. Check device is enrolled in MDM
3. Ensure MDM API endpoints are accessible
4. Verify API keys/credentials are valid
