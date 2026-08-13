# SignalGrid Mobile — Native iOS comparison build

A native SwiftUI interpretation of the current `DanFashauer/SignalGrid-Review-Hub` product model.

This package deliberately ships **two iOS application targets** because the repository defines two different human experiences:

1. **SignalGridOperator** — the branded operator/admin/support surface.
2. **WardlinkDemo** — a generic clinical host app that demonstrates SignalGrid working invisibly beneath the frontline workflow.

The two apps share a pure Swift package, **SignalGridMobileCore**, containing the API client, deterministic fixture API, product models, session lifecycle, policy/evidence structures, and tests.

## What you can compare

### SignalGridOperator

- Overview metrics and decision mix
- Deterministic trust scenario runner
- `allow`, `step-up`, `restrict`, and `deny` outcomes
- Versioned policy and reason-code display
- Evidence snapshot and normalized signal inspection
- Session start, refresh, and end lifecycle
- Embedded host-app action planning
- Microsoft-shaped and custody connector health
- Read-only connector sync replay
- Policy version inspection
- Tamper-evident audit timeline
- Offline deterministic demo mode
- Optional connection to the repo’s live `/api/v1` surface
- Keychain-backed storage for a development bearer token

### WardlinkDemo

- A synthetic clinical chart that intentionally does **not** show SignalGrid branding in the worker flow
- Host-app-owned action messages
- Native `LocalAuthentication` prompt for step-up
- Host-app-owned confirmation for sensitive actions
- Fail-closed blocked actions
- Reviewer-only “behind the glass” instrumentation sheet
- Scenario switching across healthy, stale, non-compliant, unmanaged, disabled, badge, baseline, and custody fixtures

## Requirements

- macOS with Xcode 16 or newer
- iOS 17 deployment target
- [XcodeGen](https://github.com/yonaskolb/XcodeGen)

Install XcodeGen:

```bash
brew install xcodegen
```

Generate the Xcode project:

```bash
./scripts/generate.sh
open SignalGridMobile.xcodeproj
```

Choose either scheme:

- `SignalGridOperator`
- `WardlinkDemo`

## Verification

```bash
./scripts/verify.sh
```

The verification script:

1. runs all pure-Swift core tests;
2. parses every SwiftUI source file for syntax errors;
3. when running on macOS with XcodeGen and Xcode available, generates the project and builds both app targets for the iOS Simulator.

The core currently includes six deterministic tests covering:

- all trust scenario outcomes;
- session lifecycle;
- evidence/decision linkage;
- step-up action gating;
- sensitive actions never auto-running;
- public-safe fixture markers.

## Offline demo mode

Both targets run without a database, network, tenant account, or vendor credentials.

`SignalGridOperator` defaults to `MockSignalGridAPI`, which mirrors the current public-safe SignalGrid core:

- Northwind Health demo tenant
- synthetic shared iPads and identities
- fixture Microsoft Entra/Intune posture
- fixture DockBridge/SmartDock custody context
- deterministic versioned policy decisions
- evidence snapshots and audit events

## Connect to the repo API

Start the SignalGrid Review Hub API, then open **Settings** in `SignalGridOperator`.

Default development base URL:

```text
http://127.0.0.1:5174/api
```

Public demo token used by the repository fixture core:

```text
sgk_demo_northwind_owner
```

The token is obviously synthetic. The native app stores any entered token in the iOS Keychain and never prints it in its UI.

When connected, the app calls the current product-shaped endpoints:

```text
GET  /api/v1/context
GET  /api/v1/metrics
GET  /api/v1/decisions
GET  /api/v1/decisions/:id/evidence
POST /api/v1/decisions/evaluate
POST /api/v1/sessions/start
POST /api/v1/sessions/:id/refresh
POST /api/v1/sessions/:id/end
GET  /api/v1/connectors
POST /api/v1/connectors/:id/sync
GET  /api/v1/policies
GET  /api/v1/policies/:id/versions
GET  /api/v1/audit
GET  /api/v1/app-workflows/integrations
POST /api/v1/app-workflows/evaluate
```

## Product boundary

This is a **native comparison build**, not a production client.

- Synthetic fixtures only by default
- No live Microsoft Graph calls
- No real tenant/customer data
- No PHI/PII
- No device-management writes
- No vendor partnership claim
- No compliance or production-readiness claim
- No autonomous remediation
- Systems of record remain external

See [`docs/REPO_LAYOUT.md`](../../../docs/REPO_LAYOUT.md) for the detailed mapping between this app and the source repository. (This previously pointed at `REPO_ALIGNMENT.md`, which does not exist — and pointed at it relatively, so the link resolved under this directory rather than the repo root.)
