# SignalGrid canonical event contract

> *"You do not need a single monolithic vendor; you need a good event contract and
> deterministic playbooks."*

This is the integration keystone. Every plane — **physical custody** (badge / dock
/ PACS), **device posture** (MDM / Graph), and **connectivity** (carrier) — emits
events in one normalized shape. Because they share a single event fabric, the
system can run **cross-domain detections** that no standalone MDM, SIEM, or access
system could see on its own.

The contract is implemented in `@workspace/event-contract` (pure, dependency-free,
determinism-enforced by CI) and proven by `pnpm run proof:event-contract`.

## The event

Required anchors (every event): `eventType`, `eventId`, `occurredAt` (ISO-8601),
`correlationId` (ties one custody/device timeline together), `tenantId`.

| Group | Fields |
| --- | --- |
| Subjects | `userId`, `badgeId`, `mobileCredentialId`, `deviceId`, `iccid` |
| Physical custody | `dockId`, `bayId`, `pacsSite`, `doorOrElevator` |
| Observed states | `mdmDeviceState`, `carrierConnectivityState`, `tamperState`, `batteryPercent` (0–100), `chargeState`, `lastSeenNetwork` |
| Governance | `policyVersion`, `incidentKey` |

**Event types:** `checkout_requested`, `checkout_granted`, `checkout_denied`,
`device_removed`, `device_returned`, `dock_unlocked`, `dock_relocked`,
`dock_timeout`, `tamper_detected`, `posture_changed`, `reachability_changed`,
`badge_access`, `non_return`, `custody_expired`.

**State domains:** `mdmDeviceState` ∈ {compliant, noncompliant, unmanaged,
unknown}; `carrierConnectivityState` ∈ {online, idle, offline, unknown};
`tamperState` ∈ {none, suspected, confirmed}; `chargeState` ∈ {charging,
discharging, full, unknown}.

## Validation (fail-closed)

`validateEvent(input)` admits an event only if it conforms; otherwise it returns
`{ ok: false, errors }` and never throws on hostile input. It enforces required
anchors, enum domains, `batteryPercent ∈ [0,100]`, ISO timestamps, and safe id
strings, **drops unknown fields**, and is hardened against prototype pollution. In
a zero-margin-for-error environment, a malformed event must never reach the fabric.

## Cross-domain detections

`detectCrossDomain(events)` runs deterministic, set-based reasoning over one
correlation timeline and returns named detections — the detections that only exist
because the planes share a fabric:

| Detection | Severity | Fires when |
| --- | --- | --- |
| `CHECKOUT_WITHOUT_COMPLIANCE` | high | a device was checked out but never observed compliant |
| `REMOVED_WITHOUT_BADGE_ACCESS` | high | a device left its bay with no badge into an authorized zone |
| `LEFT_PREMISES_WITHOUT_RETURN` | high | the device went offline / custody lapsed and was never returned |
| `DOCK_TAMPER_WITH_NETWORK_LOSS` | critical | tamper detected while connectivity was also lost |
| `INACTIVE_MDM_BUT_ACTIVE_ELSEWHERE` | high | unmanaged/unknown in MDM yet still on cellular or badging in |

A clean, well-behaved custody timeline yields **zero** detections. Same timeline in
⇒ same detections out (evidence-grade).

## How it fits

The gated read-only connectors (`@workspace/integrations/graph`,
`@workspace/integrations/carrier`) and the custody/dock signals all normalize into
this one shape, so a decision or a playbook consumes a single event vocabulary
regardless of which vendor produced the underlying signal.
