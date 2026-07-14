# Enterprise Shell - iOS Enterprise Login Shell

A secure iOS/iPadOS enterprise application that functions as a "login shell" for shared mobile devices in supervised, MDM-managed environments.

## Overview

Enterprise Shell provides a secure kiosk-style interface for shared devices in enterprise environments. Users authenticate using hardware badge readers, and the app enforces strict session lifecycle management with automatic data cleanup.

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
- Android (mobile companion app - future)
- macOS (desktop companion - future)
- Supervised devices only
- MDM-managed environments

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
ios/
├── project.yml              # XcodeGen configuration
├── setup.sh                 # Setup script
├── README.md               # This file
└── EnterpriseShell/
    ├── AppDelegate.swift   # App lifecycle
    ├── SceneDelegate.swift  # Scene management
    ├── Info.plist          # App configuration
    ├── EnterpriseShell.entitlements  # Entitlements
    ├── Models/
    │   ├── SessionState.swift    # State machine definition
    │   └── SessionData.swift     # Data models
    ├── Services/
    │   ├── SessionStateManager.swift  # State machine logic
    │   ├── BadgeReaderManager.swift   # Badge reader integration
    │   ├── KeychainService.swift      # Secure storage
    │   ├── OIDCAuthService.swift      # OIDC authentication
    │   ├── BackendService.swift       # API communication
    │   ├── AppLauncher.swift          # App launching
    │   └── AuditLogger.swift         # Audit logging
    ├── Utilities/
    │   └── DeviceInfo.swift          # Device information
    ├── Views/
    │   ├── LockedIdleViewController.swift
    │   ├── BadgeCapturedViewController.swift
    │   ├── AuthenticatingViewController.swift
    │   ├── ProvisioningViewController.swift
    │   ├── ActiveSessionViewController.swift
    │   └── TerminatingViewController.swift
    └── Resources/
        └── Assets.xcassets/
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
   ```bash
   cd ios
   chmod +x setup.sh
   ./setup.sh
   ```

3. **Open in Xcode**
   ```bash
   open ios/EnterpriseShell.xcodeproj
   ```

4. **Configure Signing**
   - Select your Development Team in Xcode
   - Update bundle identifier as needed

5. **Configure Constants**
   - OIDC client ID and tenant
   - Backend URL
   - Badge reader protocol

6. **Build and Run**
   ```bash
   xcodebuild -project ios/EnterpriseShell.xcodeproj \
     -scheme EnterpriseShell \
     -sdk ipados \
     -configuration Debug \
     build
   ```

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

## Backend API Endpoints

### Required Endpoints
- `POST /api/sessions/start` - Validate badge, return session token
- `POST /api/sessions/{id}/end` - Notify session end
- `POST /api/audit/logs` - Send audit events
- `GET /health` - Health check

### Request/Response Formats
See `Models/SessionData.swift` for detailed API models.

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

## Production Deployment Checklist

The MVP is secure-by-default but requires proper configuration before production use.

### Required Configuration

- [ ] **Secret Management**: Use a secret manager (GitHub Actions secrets, AWS Secrets Manager, HashiCorp Vault) for all secrets. Never commit secrets to version control.
- [ ] **OIDC Configuration**: Register an application with your OIDC provider (Microsoft Entra ID, Okta, Auth0) and configure:
  - `OIDC_ISSUER_URL`: Your OIDC provider's issuer URL
  - `OIDC_CLIENT_ID`: Application client ID
  - `OIDC_AUDIENCE`: Expected audience claim
- [ ] **Redis Provisioning**: Deploy Redis with TLS support for:
  - Nonce cache (prevents replay attacks)
  - Device registry (device enrollment/allowlist)
  - Set `REDIS_URL` environment variable
- [ ] **Admin API Key**: Generate a secure random key (`openssl rand -hex 32`) and store securely. Set `ADMIN_API_KEY` environment variable.
- [ ] **Backend Signing Secret**: Generate a secure HMAC key (`openssl rand -base64 32`) and store securely. Set `BACKEND_SIGNING_SECRET`.

### Recommended Enhancements

- [ ] **Rate Limiting**: Add rate limiting to `/api/session/start` and admin routes (e.g., `upstash/ratelimit` or API gateway-level)
- [ ] **Device Allowlist**: Enable `DEVICE_ALLOWLIST_MODE=true` for restricted rollouts
- [ ] **Monitoring**: Integrate with monitoring/observability platform (Datadog, New Relic, Grafana Cloud)
- [ ] **TLS**: Ensure all Redis connections use `rediss://` protocol

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BACKEND_SIGNING_SECRET` | HMAC signing key | Yes |
| `ADMIN_API_KEY` | Admin API key | Yes |
| `OIDC_ISSUER_URL` | OIDC provider URL | Yes |
| `OIDC_CLIENT_ID` | OIDC client ID | Yes |
| `REDIS_URL` | Redis connection URL | Yes (production) |
| `OIDC_AUDIENCE` | JWT audience | No |
| `DEVICE_ALLOWLIST_MODE` | Enable device allowlist | No |

## Limitations (MVP)

### iOS App
- No NFC badge reading
- No offline authentication
- No biometric fallback
- No Apple ID integration
- No OS-level user switching

### Backend / API
- **Replay attack nonce cache**: In-memory only in dev. Production uses Redis (configure via `REDIS_URL`).
- **Admin auth**: Supports JWT and API key fallback. Set `ADMIN_API_KEY` in production.
- **Device enrollment**: Uses Redis for persistence. Ensure Redis is provisioned for production.

## Dependencies

No external dependencies required. Uses:
- iOS 15+ SDK
- Security framework
- External Accessory framework
- AuthenticationServices framework

## License

Proprietary - Enterprise Use Only

## Support

For enterprise support and customization, contact your IT department.

## Location Signals (Asset Presence / Auditing)

This platform supports **Location Signals** as vendor-neutral events that can be fed from:
- MDM/UEM (device attributes, compliance/location hints)
- NAC (Cisco ISE / Aruba ClearPass) network+AP context
- RTLS systems (optional, enterprise-controlled)
- Device-side (BLE/Wi-Fi/GPS signals, depending on policy)

### Configuration

Set these environment variables in your backend:

| Variable | Description | Default |
|----------|-------------|----------|
| `LOCATION_MODE` | Location granularity: `presence` (recommended), `coarse`, `precise` | `presence` |
| `LOCATION_MAX_AGE_SECONDS` | Max age of location signals | `120` |
| `LOCATION_USE_REDIS` | Use Redis for storage (production) | `true` |
| `INTEGRATION_SIGNING_SECRET` | HMAC secret for signing outgoing webhooks | (empty) |

### Privacy Posture

- Default `LOCATION_MODE=presence` (zone-level). Avoids continuous tracking for pilots.
- Asset accountability: "Last seen in ER-TRIAGE at 10:41" (presence mode)
- Audit-grade evidence: location signal becomes a tamper-evident audit ledger event
- Safe for healthcare pilots: no always-on consumer tracking vibe

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/location/report` | POST | Ingest location signal → audit + optional webhook dispatch |
| `/api/admin/location?deviceId=...` | GET | Admin-only last known location |

### Webhook Events

When location signals are received, the system dispatches `asset.location.observed` events to configured webhook targets. Each event includes:
- `type`: `asset.location.observed`
- `deviceId`: The device identifier
- `occurredAt`: Timestamp (epoch ms)
- `payload`: Full location signal data

Webhooks are signed with HMAC-SHA256 using the `INTEGRATION_SIGNING_SECRET`.

## Integrations (Webhooks v1)

The platform includes a production-grade **webhook integrations system** that enables MDM/UEM-agnostic event-driven workflows. This replaces the basic integration dispatcher with a complete solution for external system automation.

### Features

- **Admin CRUD**: Create, read, update, delete webhook endpoints via API
- **Per-Endpoint Signing**: Each webhook has its own HMAC-SHA256 signing secret
- **Secret Rotation**: Rotate secrets without downtime
- **Retry with Backoff**: Exponential backoff + jitter, max 6 attempts
- **Dead Letter Queue (DLQ)**: Failed deliveries after max retries
- **Delivery Receipts**: Track delivery status per event
- **Security**: HTTPS-only in production, blocks localhost

### Supported Events

| Event | Description |
|-------|-------------|
| `session.start` | User started a session via badge tap |
| `session.end` | Session terminated |
| `badge.enroll` | Badge enrolled to user mapping |
| `badge.delete` | Badge mapping removed |
| `auth.failure` | Authentication failed |
| `asset.location.observed` | Location signal received |
| `policy.matched` | Policy evaluation matched |
| `policy.action.executed` | Policy action dispatched |
| `itsm.ticket.created` | ITSM ticket created |
| `itsm.ticket.failed` | ITSM ticket creation failed |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/integrations/webhooks` | POST | Create webhook |
| `/api/admin/integrations/webhooks` | GET | List webhooks |
| `/api/admin/integrations/webhooks/:id` | PATCH | Update webhook |
| `/api/admin/integrations/webhooks/:id` | DELETE | Delete webhook |

### Example: Create Webhook

```bash
curl -X POST https://api.example.com/api/admin/integrations/webhooks \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "ServiceNow Incidents",
    "url": "https://your-instance.service-now.com/api/now/table/incident",
    "events": ["auth.failure", "badge.delete"],
    "secret": "your-32-char-minimum-secret-here"
  }'
```

### Webhook Payload

```json
{
  "id": "uuid",
  "type": "session.start",
  "timestamp": "2026-03-05T10:00:00.000Z",
  "source": { "service": "tap-to-login", "version": "1.0.0" },
  "data": { "sessionId": "...", "userId": "...", "deviceId": "..." },
  "deliveryId": "uuid"
}
```

### Integration Targets (What Buyers Will Recognize)

- **Cisco ISE / Aruba ClearPass (NAC)**: Consume session events → drive NAC policies or SIEM correlation
- **SIEM (Splunk / Microsoft Sentinel)**: Ingest webhook stream for security analytics
- **ServiceNow / Jira / Zendesk / Freshservice / BMC Helix / Ivanti / ManageEngine (ITSM)**: Open tickets on policy events
- **MDM/UEM (Workspace ONE / Intune / Jamf)**: They become consumers of your events, not your dependency

### Security

- HTTPS required in production
- Localhost blocked in production
- Per-endpoint secrets (not shared)
- Idempotency via `deliveryId` + `eventId`
- Request ID + delivery ID in logs (secrets redacted)
