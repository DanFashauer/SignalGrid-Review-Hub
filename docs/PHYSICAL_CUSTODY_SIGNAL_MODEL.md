# Physical Custody Signal Model

This document defines a vendor-neutral, public-safe schema for future Physical Custody and DockBridge review scenarios. It is intended for deterministic fixtures, documentation, and design-partner discovery only. It does not implement hardware logic, vendor integrations, live API calls, or production workflows.

## Vendor-neutral custody event schema

| Field | Type | Description |
| --- | --- | --- |
| `hardwareVendor` | string | Public-safe vendor or ecosystem label, such as a candidate case, dock, locker, cradle, PACS, or RTLS provider. |
| `hardwareModel` | string | Public-safe model family or fixture model label; avoid private serial ranges or customer-specific naming. |
| `caseSerial` | string | Sanitized case identifier or deterministic fixture value. |
| `dockId` | string | Sanitized dock, locker, cradle, kiosk, or station identifier. |
| `bayId` | string | Sanitized bay, slot, compartment, or mount position identifier. |
| `deviceId` | string | Sanitized managed-device identifier correlated to MDM/UEM posture fixtures. |
| `batteryId` | string | Sanitized battery or power-module identifier when available. |
| `chargeState` | enum | Candidate values: `unknown`, `charging`, `charged`, `low`, `critical`, `not_present`. |
| `dockState` | enum | Candidate values: `unknown`, `occupied`, `empty`, `reserved`, `faulted`, `offline`. |
| `custodyState` | enum | Candidate values: `unknown`, `checked_in`, `checked_out`, `overdue`, `exception`, `maintenance`. |
| `tamperState` | enum | Candidate values: `unknown`, `none`, `suspected`, `confirmed`, `sensor_unavailable`. |
| `lastSeenAt` | string | ISO-8601 timestamp from a deterministic fixture or approved non-production source. |
| `evidenceSource` | string | Source label, such as `fixture`, `manual-review`, `mdm-export`, `dock-export`, or `locker-export`. |
| `confidence` | number | Normalized confidence from `0.0` to `1.0`; unknown or ambiguous evidence should reduce confidence. |
| `correlationId` | string | Public-safe event correlation identifier used to connect identity, posture, custody, route, and audit records. |
| `fixtureVersion` | string | Version of the deterministic fixture set used for reproducible proof runs. |

## Example fixture event

```json
{
  "hardwareVendor": "CandidateHealthcareDockVendor",
  "hardwareModel": "FixtureDock-SharedApple-01",
  "caseSerial": "case-fixture-0001",
  "dockId": "dock-fixture-east-01",
  "bayId": "bay-03",
  "deviceId": "device-fixture-ipad-0001",
  "batteryId": "battery-fixture-0001",
  "chargeState": "charged",
  "dockState": "occupied",
  "custodyState": "checked_in",
  "tamperState": "none",
  "lastSeenAt": "2026-06-16T00:00:00Z",
  "evidenceSource": "fixture",
  "confidence": 0.96,
  "correlationId": "custody-fixture-correlation-0001",
  "fixtureVersion": "physical-custody-fixture-v0"
}
```

## Decision examples

| Scenario | Custody interpretation | Candidate SignalGrid response |
| --- | --- | --- |
| Compliant device + valid identity + dock checkout | Known device leaves expected bay during a valid identity-bound session. | Allow candidate with custody evidence attached to the audit event. |
| Valid identity + device not returned by SLA | Session is valid, but custody state becomes `overdue`. | Route owner or alert queue; preserve review context and audit evidence. |
| Device removed without valid session | Dock state changes to `empty` without a matching checkout session. | Custody exception; route to approved owner or local operations review. |
| Wrong bay return | Device returns to an unexpected bay or dock. | Audit exception; request inventory validation or supervisor review. |
| Low battery + critical workflow | `chargeState` is `low` or `critical` for a high-risk workflow. | Operational risk; route swap-battery or alternate-device action for approval-aware handling. |
| Unknown dock state + high-risk workflow | `dockState` is `unknown`, `faulted`, or `offline` during a sensitive workflow. | Degraded confidence; require step-up, alternate evidence, or owner review. |

## Public-safety boundaries

- Keep all examples deterministic and fixture-backed.
- Do not add real hardware calls, vendor API calls, customer locations, PHI, PII, tenant identifiers, or credentials.
- Do not treat malformed, missing, or ambiguous high-risk custody input as safe by default.
- Keep approval gates explicit for any routed action.
- Treat hardware, PACS, MDM/UEM, IAM, RTLS, locker, and EHR platforms as independent systems of record.
