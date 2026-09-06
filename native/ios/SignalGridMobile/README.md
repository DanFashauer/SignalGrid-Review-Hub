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

The core's test file holds 14 deterministic `func test` cases (count them with
`grep -c "func test" SignalGridMobileCore/Tests/SignalGridMobileCoreTests/SignalGridMobileCoreTests.swift`;
this line said "six" while the file held fourteen) covering:

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
GET  /api/v1/keys
GET  /api/v1/context
GET  /api/v1/metrics
GET  /api/v1/decisions
GET  /api/v1/decisions/:id
GET  /api/v1/decisions/:id/evidence
POST /api/v1/decisions/evaluate
POST /api/v1/sessions/start
GET  /api/v1/sessions/:id
POST /api/v1/sessions/:id/refresh
POST /api/v1/sessions/:id/end
GET  /api/v1/connectors
GET  /api/v1/connectors/:id/sync-runs
POST /api/v1/connectors/:id/sync
GET  /api/v1/policies
GET  /api/v1/policies/:id/versions
GET  /api/v1/audit
GET  /api/v1/app-workflows/integrations
POST /api/v1/app-workflows/evaluate
GET  /api/cp/v1/fleet-mdm
```

The last one is OUTSIDE `/v1`: a control-plane route the api-server mounts only
under the `review-demo` profile, carrying no principal and scoped by a
client-supplied `?tenant=`. It exists for the Fleet posture card and returns
404 on any other profile; the app treats that as "no Fleet posture", not as an
error. (Derived from `SignalGridMobileCore/Sources/SignalGridMobileCore/SignalGridAPI.swift`;
this list held fifteen paths while the client called twenty.)

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

See [`docs/REPO_ALIGNMENT.md`](docs/REPO_ALIGNMENT.md) for the detailed mapping between this app and the source repository.
