# DockBridge Product Connector (public-safe)

This documents the **DockBridge custody connector** as implemented in the
product-shaped core (`lib/signalgrid-core`), where physical-custody hardware
signals now feed the runtime decision loop alongside identity and posture. It is
deterministic, fixture-backed, and public-safe: no dock, cradle, locker, case,
or vendor API is actually contacted, and no dock action is ever performed. It
realises the [DockBridge Strategy](DOCKBRIDGE_STRATEGY.md) and the
[Physical Custody Signal Model](PHYSICAL_CUSTODY_SIGNAL_MODEL.md) in code.

## Ingestion modes (all fixture-backed here)

A dock/custody connector can bring events in three ways; each is modeled as a
fixture ingestion path in the public core, and each keeps existing systems as
systems of record:

| `ingestionMode` | Meaning |
| --------------- | ------- |
| `app_in_dock` | A generic SignalGrid agent embedded in a third-party dock/cradle firmware reports events. |
| `vendor_api` | SignalGrid polls a dock/locker vendor's existing event API (read-only). |
| `edge_gateway` | An on-site gateway relays dock events. |
| `embedded_smartdock` | The dedicated SignalGrid **SmartDock** — SignalGrid firmware on SignalGrid-designed smart-charging hardware, emitting the full signal set natively. Optional layer; see [SignalGrid SmartDock](SIGNALGRID_SMARTDOCK.md). |

The demo seeds a hospital DockBridge connector using `app_in_dock`, a warehouse
connector using `vendor_api`, and a dedicated SmartDock connector using
`embedded_smartdock`, so all paths are represented end to end (connector → sync
run → normalized signals → decision → audit). Every connector is read-only; its
`credentialRef` is a non-secret placeholder showing where a real credential
reference would live in the private core.

## Normalized custody signals

Each fixture dock event (vendor-neutral, matching the repo's custody schema —
`dockId`, `bayId`, `caseSerial`, charge/dock/custody/tamper state) is normalized
into device signals and marked with freshness:

| Signal category | Values |
| --------------- | ------ |
| `custody_state` | `checked_in`, `checked_out`, `overdue`, `exception`, `maintenance`, `unknown` |
| `charge_state` | `charging`, `charged`, `low`, `critical`, `not_present`, `unknown` |
| `tamper_state` | `none`, `suspected`, `confirmed`, `sensor_unavailable`, `unknown` |
| `dock_state` | `occupied`, `empty`, `reserved`, `faulted`, `offline`, `unknown` |
| `badge_binding` | `present`, `removed`, `forced`, `absent`, `unknown` — the reader case's person→device binding |

These become part of the decision evidence (`custodyState`, `dockChargeState`,
`tamperState`, `dockState`, `badgeBinding`). Absence of a dock signal is
`unknown` and never fabricates a healthy state; it simply adds no custody-based
conclusion.

## Custody policy rules

The shared-device baseline policy now includes custody rules (present in both
the active v1 and the stricter v2 draft):

| Rule | Condition | Outcome | Reason code |
| ---- | --------- | ------- | ----------- |
| Confirmed tamper | `tamperState = confirmed` | `deny` | `TAMPER_CONFIRMED` |
| Suspected tamper | `tamperState = suspected` | `restrict` | `TAMPER_SUSPECTED` |
| Tamper sensor blinded | `tamperState = sensor_unavailable` | `step_up` | `TAMPER_SENSOR_UNAVAILABLE` |
| Overdue return | `custodyState = overdue` | `restrict` | `CUSTODY_OVERDUE` |
| Custody exception | `custodyState = exception` | `restrict` | `CUSTODY_EXCEPTION` |
| Critical battery | `chargeState = critical` | `step_up` | `BATTERY_CRITICAL` |
| Faulted dock | `dockState = faulted` | `restrict` | `DOCK_FAULTED` |
| Offline dock | `dockState = offline` | `step_up` | `DOCK_OFFLINE` |

The tamper-sensor, faulted-dock, and offline-dock rules close a fail-open gap:
an unwitnessed device (blinded tamper sensor) or a dock that can't vouch for
custody (faulted/offline) no longer rests on a silent `allow`.

Because the engine takes the most-restrictive firing outcome, a healthy device
that is overdue is restricted, and a healthy device with a critically low
battery is stepped up — the physical state changes the runtime decision.

## Smart-charging and check-in / check-out workflows

- **Check-in / check-out**: `custodyState` distinguishes a device that is
  checked out for a valid session from one that is `overdue` (past its return
  SLA) or an `exception` (removed without a session). Overdue returns are
  restricted and routed for a check-in.
- **Smart charging**: `chargeState = critical` steps up a shared-device session
  (operational risk that the device could die mid-workflow), and the Resolution
  Assistant's self-service step is to swap to a charged device or dock the low
  one — routed to the organization's hardware channel (badge reader in the
  hospital, smart locker in the warehouse).
- **Case design**: each event carries a `caseSerial`, tying the managed case /
  dock hardware to the device, so custody evidence is attached to the audit
  record.

## Resolution and safety

Custody blocks flow through the [Resolution Assistant](ECOSYSTEM_FLOW_AND_RESOLUTION.md):
overdue return and low battery are **self-service** (return/swap at the org
hardware channel and re-evaluate); a custody exception or suspected tamper is
**approval-gated** (operator review); a confirmed tamper is **manual-only**
(out of service, routed to security). Every proposed action is approval-gated
and simulated — SignalGrid records and simulates, and there is no autonomous
production remediation and no dock action performed.

## Where to see it

- Proof: `pnpm run proof:signalgrid-core` includes overdue → restrict, suspected
  tamper → restrict, critical battery → step-up, confirmed tamper → deny, and
  the self-service/approval resolution paths.
- Operator Console: custody, battery, and tamper appear in the decision evidence
  for the DockBridge scenarios.
- Worker Self-Service: the "return the device to its dock/bay" and "swap to a
  charged device" self-service steps.
- API: the DockBridge connector appears in `GET /api/v1/connectors`, its runs in
  `GET /api/v1/connectors/{id}/sync-runs`, and a fixture re-sync via
  `POST /api/v1/connectors/{id}/sync`.
