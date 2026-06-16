# Microsoft Graph Fixture Strategy

## Deterministic fake data only

Fixtures must be deterministic and public-safe. They must not contain real emails, phone numbers, tenant IDs, customer data, PHI, PII, tokens, client IDs, app IDs, secrets, or live Graph URLs containing tenant-specific values.

## Required fixture cases

The fixture set covers:

- Healthy user plus compliant device.
- Disabled user plus active device.
- Non-compliant device.
- Stale device.
- Unmanaged device.
- Missing compliance state.
- Access review overdue.
- Graph permission failure.
- Graph API unavailable.

## Proof strategy

The fixture-only proof script loads fake Graph fixtures, validates required fields, normalizes them to SignalGrid fields, maps example decisions, and emits deterministic summary output. It does not call Microsoft Graph or any live endpoint.
