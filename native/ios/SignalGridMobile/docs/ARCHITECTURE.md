# Native iOS architecture

```text
SignalGridOperator ─┐
                    ├── SignalGridMobileCore ── MockSignalGridAPI
WardlinkDemo ───────┘                         └─ LiveSignalGridAPI ── /api/v1
```

## SignalGridMobileCore

A pure Swift package with no SwiftUI dependency. It contains:

- Codable product types
- API protocol
- `LiveSignalGridAPI` actor
- deterministic `MockSignalGridAPI` actor
- Northwind Health fixture scenarios
- session, connector, policy, audit, evidence, and app-workflow models
- unit tests

Keeping this package pure makes the decision/client behavior testable outside the UI and makes it reusable in later iOS, macOS, or embedded SDK work.

## State ownership

Each target owns one root `@Observable` model in `@State`:

- `AppModel` for the operator app
- `WardlinkModel` for the host-app demonstration

Views use explicit model properties or the SwiftUI environment. Feature state remains local with `@State` when it does not need to be shared.

## Networking

`LiveSignalGridAPI`:

- uses async/await;
- applies bearer authentication;
- sends request IDs;
- decodes the repo’s product envelopes;
- has explicit transport, HTTP, URL, and decoding errors;
- never logs the bearer token.

## Authentication demonstration

`WardlinkDemo` uses `LocalAuthentication` with `.deviceOwnerAuthentication`, allowing the operating system to choose Face ID, Touch ID, or device passcode. The framework returns only success or failure; biometric data remains managed by the system.

## Public-safe default

The default is always the deterministic offline API. Connecting to a live development API is an explicit operator action in Settings.
