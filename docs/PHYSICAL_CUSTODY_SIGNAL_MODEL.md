# Physical Custody Signal Model

This document defines a vendor-neutral, public-safe schema for future Physical Custody and DockBridge review scenarios. It is intended for deterministic fixtures, documentation, and design-partner discovery only. It does not implement hardware logic, vendor integrations, live API calls, or production workflows.

The owner's session-puck concept — a worker-carried token whose attach and removal events would land in this schema's `dockState` and, via the separate reader-case schema in [Credential reader signal model](CREDENTIAL_READER_SIGNAL_MODEL.md), the `badge_binding` dimension — is recorded as a deferred hardware hypothesis, not a product, in [Session puck hardware hypothesis](SESSION_PUCK_HARDWARE_HYPOTHESIS.md) (DR-043).

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
| `batteryHealth` | enum | Candidate values: `unknown`, `healthy`, `degraded`, `failing`. Battery CAPACITY, not fill level — the state charging does not change. |
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
  "batteryHealth": "healthy",
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
| Failing battery | `batteryHealth` is `failing`, at any charge level. | Distinct from low charge: charging cannot clear it, so the device is routed for battery replacement rather than back to a bay. |
| Unknown dock state + high-risk workflow | `dockState` is `unknown`, `faulted`, or `offline` during a sensitive workflow. | Degraded confidence; require step-up, alternate evidence, or owner review. |

## The ledger-versus-bay reconciliation (built)

The schema above is a design surface. One piece of it is now **built and proven**: the
reconciliation of what the checkout **ledger** says against what the dock **bay** sees,
plus the requester's per-user cap — the two runbook rows in
[`docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md`](research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md)
("custody integrity" and "per-user checkout cap") that no surface modeled. It lives in
[`lib/integrations/src/integrations/rtls-custody/custody-ledger.ts`](../lib/integrations/src/integrations/rtls-custody/custody-ledger.ts)
beside the physical-custody evaluator, and is a different question from it: not *where is
the device*, but *does the ledger agree with the bay, and may this requester take it*.
Read-only and fixture-gated like the rest of the family; nothing here clears a record,
releases a bay, or changes a cap — the fabric surfaces the contradiction with a legible
reason, a person reconciles it. The `rtls-custody` family stays **deferred** in the launch
profile (DR-001): this is built and proven, not claimed to ship.

| Ledger vs bay vs cap (a deferred family: built, not claimed) | Verdict | Why |
| --- | --- | --- |
| ledger clear, no holder, seated, paired, requester under cap, clean parse | `none` — ready for check-out | the one grant; every axis positively confirmed |
| ledger still assigns the device to a **prior holder** while it sits in a bay | `step_up` (`CUSTODY_STALE_RETURN_OTHER`) | the runbooks' phantom: a return that never cleared, named as a contradiction |
| ledger still assigns it to the **requester** while it sits in a bay | `step_up` (`CUSTODY_STALE_RETURN_OWN`) | the requester's own stale return |
| **unpaired** device in a bay; unpaired and out with its holder | `restrict` | not a device to hand out — "unpaired but occupying a slot" is named separately; an unpaired device that is also unaccounted (clear ledger, empty bay) takes the higher rung below |
| out with **another** holder (bay empty, ledger consistent) | `restrict` (`CUSTODY_HELD_BY_OTHER`) | not this device; no contradiction |
| out with the **requester** (bay empty, ledger consistent) | `monitor` — **not** ready | the one advisory: already in their custody, nothing in the bay to hand out |
| ledger **clear** and the bay **empty** | `escalate` (`CUSTODY_DEVICE_UNACCOUNTED`) | nobody has it and it is not in its bay — a custody breach, the same rung the physical evaluator uses for a device that left the area |
| cap hit **only** because prior returns never cleared | `step_up` (`CUSTODY_CAP_BLOCKED_BY_STALE_RETURN`) | the mystery beep, named — a person clears the stale records |
| cap genuinely reached | `restrict` (`CUSTODY_CAP_REACHED`) | a hard limit, legibly stated |
| ledger contradicts itself (clear yet a holder named; checked out to nobody) | `step_up` (`CUSTODY_LEDGER_INCONSISTENT`) | a self-contradicting record grades nothing |
| the observation is older than the bound the caller posed (default 300 s) | `step_up` (`CUSTODY_EVIDENCE_STALE`) | a replayed snapshot confirms nothing current — the bay's "seated" is a live observation or it is nothing; a garbled bound (NaN, zero, negative) makes the axis unknown rather than switching the check off |
| no device or requester reference to bind the verdict to | `step_up` (`CUSTODY_IDENTITY_UNBOUND`) | a checkout grant is per device and per requester; one that names nobody is not a grant anyone can act on |
| any axis unknown (including an unreported observation age) | `step_up` | unknown raises, never grants |
| malformed report | `step_up` | an assertion we could not read is never a grant |

The **cap axis is computed, never asserted**: the normalizer derives under-cap /
stale-blocked / reached from the requester's open-checkout count, the tenant cap and the
count of those checkouts physically docked (non-negative safe integers, strict parse — a
string, a float, a negative, a zero cap, or more stale returns than open checkouts is a
malformed report; a missing count is unknown and raises). `returned` and `no record` both
normalize to a *clear* ledger; any other wire value defaults to unknown. Every axis is read
once, up front — an accessor that answers the branches with one value and the domain
guard with another cannot reach the grant on the second answer — and a read that throws
holds. Unlike the device-prep surface, the one advisory here does not mean ready:
`readyForCheckout` is true for the grant alone.

Proven by `proof:rtls-custody` (214 checks): named outcomes, single-axis flips of the one
grant, a grant-safety sweep over all 4,320 combos of the module's exported domains plus the
observation-age axis that pins that grant by equality (exactly one state grants; `monitor`
reachable only as "already held and not in the bay"; `escalate` only as "clear and the bay
empty"; `alert` unreachable), a raw-space sweep of 230,400 hostile wire reports through the
real normalizer (exactly two grant — the two spellings of a clear ledger), every count shape
on the computed cap axis, the posed freshness bound on every garbled shape, the exact
prototype-walk bound, own-name-only fixture lookup, the one-time axis snapshot, a revoked
Proxy, and the hostile-report shapes the sibling surfaces
learned from review (inherited fields, a polluted `Object.prototype`, throwing accessors
and Proxy traps, unrecognized and symbol keys, a bounded prototype walk); deterministic,
offline. Registered with the mutation guard. Building is not claiming: the family is
deferred in the launch profile.

## Public-safety boundaries

- Keep all examples deterministic and fixture-backed.
- Do not add real hardware calls, vendor API calls, customer locations, PHI, PII, tenant identifiers, or credentials.
- Do not treat malformed, missing, or ambiguous high-risk custody input as safe by default.
- Keep approval gates explicit for any routed action.
- Treat hardware, PACS, MDM/UEM, IAM, RTLS, locker, and EHR platforms as independent systems of record.
