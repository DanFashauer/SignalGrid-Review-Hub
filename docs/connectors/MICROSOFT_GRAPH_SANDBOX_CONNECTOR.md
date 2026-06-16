# Microsoft Graph Sandbox Connector Design

## Purpose

The Microsoft Graph sandbox connector is a read-only, fixture-backed design for reading Microsoft Graph, Entra, and Intune-style posture signals, normalizing them into SignalGrid trust inputs, and feeding existing decision, routed-action, audit-evidence, and verification flows.

Microsoft remains the system of record. SignalGrid normalizes signals, decides outcomes, routes approved actions, audits evidence, and verifies expected results.

## Non-goals

This scaffold does not include:

- Production authentication.
- Write actions.
- Intune imports.
- Intune policy modification.
- Conditional Access modification.
- Device lock, wipe, quarantine, or other production device action.
- Account disablement.
- Autonomous remediation.
- Secrets, tenant IDs, customer data, PHI, PII, tokens, or environment-specific values in the repository.
- Live Microsoft Graph endpoints or production-ready claims.

## Read-only first signal categories

The connector design starts with these read-only categories:

- Entra user identity state.
- Entra device registration state.
- Intune managed device state.
- Intune compliance state.
- Device last-seen and posture freshness.
- Configuration profile assignment state.
- Managed app inventory or status where safe.
- Access review or IGA context where available.
- Graph API health and permission health.

## Signal flow

```text
Microsoft Graph / Entra / Intune-style fixture signals
  -> SignalGrid normalized trust inputs
  -> existing simulator/grid proof model
  -> decision + routed action + audit evidence
```

The MVP connector path is fixture-only. Later live sandbox testing is gated behind a PC-only smoke test with local `.env` values that must never be committed.

## Decision examples

| Fixture condition                               | SignalGrid decision example                      |
| ----------------------------------------------- | ------------------------------------------------ |
| Identity valid and device compliant             | Allow candidate                                  |
| Identity disabled with an active device/session | Deny or route owner                              |
| Device non-compliant                            | Restrict, step-up, or ticket                     |
| Stale device on a high-risk workflow            | Step-up or ticket                                |
| Configuration drift on a clinical workflow      | Restrict with approval-required remediation      |
| Access review overdue on a privileged workflow  | Approval required                                |
| Graph API unavailable                           | Degraded confidence and integration-health event |

## Future write/action gates

Future write-capable actions are not implemented here. Candidate actions include device quarantine, policy push, session revoke, account disablement, remediation action, Conditional Access change, Intune template import, and app or configuration deployment.

Every future write action must be approval-required, simulated first, audited, reversible where possible, and must not perform autonomous production remediation.

## PC test gate

Live Microsoft Graph smoke testing is a later PC-only gate. That gate may use local `.env` files and real sandbox authentication, but secrets must never be committed.
