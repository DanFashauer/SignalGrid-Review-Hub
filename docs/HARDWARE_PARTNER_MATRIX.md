# Hardware Partner Matrix

This matrix is a public-safe planning artifact for SignalGrid's future Physical Custody, DockBridge, and shared-device trust layer. It lists candidate hardware categories that could provide fixture-backed signals for review, design-partner discovery, and later reference-architecture evaluation.

No entry in this document is a partnership claim, endorsement claim, procurement recommendation, certification claim, or integration announcement. SignalGrid remains the vendor-neutral layer that could normalize custody signals, evaluate trust decisions, route approved actions, audit events, and verify expected results while existing enterprise and hardware systems remain systems of record.

## Candidate matrix

| Category | Candidate vendors or ecosystems | Candidate SignalGrid signal surface | Public-safe discovery posture |
| --- | --- | --- | --- |
| Healthcare shared iPhone/iPad case, battery, charging, and dock workflows | Beam Mobile | Case identity, battery identity, charging state, dock/bay state, checkout/return context, cleaning-ready handling notes | Example discovery candidate for healthcare shared Apple-device custody strategy; no current partnership, endorsement, or integration is claimed. |
| Healthcare rugged cases and battery systems | Beam Mobile and other healthcare accessory vendors | Case serial, battery serial, charge state, device survivability context, cleaning workflow context | Evaluate only with public docs, sanitized fixtures, or explicitly approved non-production technical materials. |
| Charging docks | Beam Mobile, LocknCharge, Zebra cradles, Honeywell cradles, Datalogic cradles | Dock ID, bay ID, occupied/empty state, charge state, device return evidence | Start with fixture-backed state models; do not add live hardware calls in Review Hub. |
| Smart lockers | Traka, Vecos | Locker ID, compartment state, checkout/return event, overdue asset signal | Treat lockers as physical custody source systems, not systems SignalGrid controls directly. |
| Device-dispensing kiosks and checkout stations | ARC, and other multi-bay dispensing-kiosk vendors | Kiosk ID, bay ID, dispense/return event, per-bay occupancy and charge state, bay-fault indication, unreturned-device signal | Treat the kiosk as the custody system of record and consume it as a **read-only signal source**; no dispensing, release, or bay action is performed from Review Hub. See [Where dispensing-kiosk claims land](#where-dispensing-kiosk-claims-land-in-the-custody-schema). |
| Rugged handheld ecosystems | Zebra, Honeywell, Datalogic | Device identity, cradle state, battery/charging telemetry, shared-device fleet context | Model as candidate source systems for frontline workflows, especially outside Apple fleets. |
| Kiosk and tablet mounts | Compulocks, Heckler | Mounted/unmounted context, station identity, device-to-location evidence | Use for station or kiosk posture context; do not imply physical security guarantees. |
| PACS, badge, and access-control systems | HID, LenelS2, Genetec, Gallagher, Brivo, Verkada | Badge event, door/area context, access-control event correlation | Treat PACS as a source of custody-adjacent evidence; SignalGrid does not replace PACS or emergency egress controls. |
| RTLS and location systems | Kontakt.io and other RTLS providers | Asset location, zone state, proximity, staff-safety context | Keep location examples deterministic and public-safe; avoid customer locations, patient data, or PHI/PII. |

## Why case and dock signals both matter

- **Case signals** can improve survivability context, battery continuity, cleaning durability assumptions, and device usability for shared healthcare iPhone/iPad workflows.
- **Dock signals** can provide checkout, return, charging, custody, and audit-evidence context when a device is removed from or returned to a known bay.
- **SignalGrid signals** can combine identity, device posture, workflow risk, dock state, custody state, routed action history, and verification evidence into an explicit trust decision without becoming the hardware system of record.

## Candidate decision examples

| Scenario | Example normalized inputs | Candidate outcome |
| --- | --- | --- |
| Compliant device + valid identity + dock checkout | Valid user session, compliant managed device, known dock ID, expected bay checkout | Allow candidate for the requested workflow, with custody evidence attached to the audit record. |
| Valid identity + device not returned by SLA | Valid user session, known checked-out device, overdue return timer exceeded | Route owner or alert queue; preserve audit evidence and avoid autonomous remediation. |
| Device removed without valid session | Bay changes to empty with no matching identity-bound checkout session | Custody exception requiring review, escalation, or local process validation. |
| Wrong bay return | Known device or case returns to a bay that does not match expected route | Audit exception and routing candidate for inventory or operations review. |
| Low battery + critical workflow | Known device has low charge state before a critical workflow | Operational risk; route swap-battery or alternate-device guidance for approval-aware operations. |
| Unknown dock state + high-risk workflow | Identity and device signals are valid, but dock state is missing or ambiguous | Degraded confidence; step-up, supervisor review, or alternate verification before high-risk workflow access. |

## Where dispensing-kiosk claims land in the custody schema

Multi-bay dispensing kiosks are the closest adjacent category to SignalGrid's
custody plane, so it is worth being precise about which of their capabilities
already have a home in the custody model and which do not.

Two reading notes, because both directions of this table are easy to get wrong:

- **The left column is vendor-stated and unverified.** It paraphrases capability
  claims from public vendor marketing in this category. Nothing in it has been
  tested, benchmarked, or confirmed against a product, and it should not be cited
  as a description of what any kiosk actually does.
- **The right column is code-level, not schema-level.** Where a row says a rule
  exists, the rule is implemented in the shared-device baseline policy and
  documented in [DockBridge Product Connector](DOCKBRIDGE_PRODUCT_CONNECTOR.md).
  The vendor-neutral [Physical Custody Signal Model](PHYSICAL_CUSTODY_SIGNAL_MODEL.md)
  is the *candidate schema* and deliberately contains no rules or outcomes, so it
  cannot be used to verify these claims.

| Vendor-stated kiosk capability | Where it lands | Verdict |
| --- | --- | --- |
| Confirms a device was returned and is charging | `custodyState = checked_in` + `chargeState = charging` | **Already modeled.** No new signal needed. |
| Flags a device not returned / returned late | `custodyState = overdue` | **Already modeled**, and already a `restrict` rule (`CUSTODY_OVERDUE`). |
| Flags a device removed without a session | `custodyState = exception` | **Already modeled**, and already a `restrict` rule (`CUSTODY_EXCEPTION`). |
| Flags a device as missing / unaccounted for | RTLS custody vocabulary — `NOT_TRACKED`, `ABANDONED`, `LEFT_AREA` | **Already modeled**, in the [RTLS custody dimension](../lib/integrations/src/integrations/rtls-custody/) rather than the dock enums. "Missing" is a location question, not a bay-state question. |
| Flags a broken bay or port | `dockState = faulted` | **Already modeled**, and already a `restrict` rule (`DOCK_FAULTED`). |
| Reports current charge level | `chargeState = low` / `critical` | **Already modeled.** `critical` is a `step_up` rule (`BATTERY_CRITICAL`); `low` is a modeled value with **no rule attached** — it is evidence, not a trigger. |
| Predicts a failing battery (health/degradation, not level) | `batteryHealth = failing` | **Now modeled**, and a `restrict` rule (`BATTERY_FAILING`). This entry previously recorded it as a stated capability with no implementation; that gap was the reason it got built. The distinction that earns it a field: charging clears a low battery and cannot clear a failing one, so without it a worker is routed to a charging bay forever for a device that needs a new battery. `degraded` is carried as evidence with **no rule**, the same treatment `chargeState: low` gets. |
| Automatically releases the most-charged device | Dispensing actuation | **Not performed here, and not a strategy commitment either way.** Review Hub performs no dock action at all. SmartDock's own physical enforcement (badge latch, charge management, out-of-service hold) is designed but **simulated and approval-gated**, so "SignalGrid never actuates hardware" would be the wrong lesson to draw — the accurate statement is that no actuation is executed in this repo, and any that ships is approval-gated. |
| Usage analytics, peak-hour demand, user trends | — | **Out of scope.** Fleet-utilization analytics and procurement sizing are a different product. |
| Device shrink / loss reduction | Downstream of `custodyState` | **Not a signal.** It is an outcome a custody system may claim; SignalGrid should not restate a vendor's shrink figure as a fact. |

The honest read: most of what a dispensing kiosk advertises is already a value in
the custody enums, because both are describing the same physical event stream. That
makes this category a **signal source and integration candidate** — the kiosk stays
the custody system of record, and SignalGrid consumes its events. Whether any vendor
here is also a competitor is a positioning question that belongs in a
`COMPETITIVE_*.md` document, not in this matrix.

Two cautions when reading vendor material in this category:

- **Attribute, do not adopt, quantified loss claims.** Figures such as an annual
  device-shrink percentage are typically vendor-stated without a cited methodology
  or source. Record them as *vendor-stated* if recorded at all, and never carry
  them into SignalGrid's own materials as established fact.
- **"Over-the-air software updates" from a charging kiosk is a management-plane
  claim, and it is currently unmodelled.** If a custody device can push software to
  the devices it holds, it is an update channel, and a signal source that can also
  change the device is not a read-only signal source. The
  [Product Core Threat Model](PRODUCT_CORE_THREAT_MODEL.md) now analyses this
  directly, under *The custody device as an update channel* — including the case
  where one compromised dock corrupts both the device and the custody evidence
  SignalGrid uses to judge it. That section states what is owed and confirms that
  **nothing is implemented against it yet**; the analysis is not the mitigation.

## Non-goals

- No hardware integration is implemented in Review Hub.
- No live vendor API calls, hardware calls, webhook listeners, USB listeners, or production integrations are added.
- No Beam Mobile partnership, endorsement, reseller, certification, or alliance status is claimed. The same applies to every other vendor named in this document, including any dispensing-kiosk vendor.
- No procurement recommendation or vendor ranking is made.
- SignalGrid does not replace Beam Mobile, MDM, IAM, PACS, smart lockers, docks, EHR systems, RTLS, or any hardware vendor.
- SignalGrid does not control emergency egress.
- SignalGrid does not execute live remediation without governance, approval, and separate validation.

## Future discovery questions

- Does the dock expose bay occupied/empty state?
- Can the dock identify the device, case, or battery in each bay?
- For a dispensing kiosk: is the dispense/return event exportable per device, or only aggregated into a utilization report? An aggregate is not a custody signal.
- Does the kiosk record *which person* took the device, and by what credential (badge, PIN, employee ID)? Without that binding, a dispense event is inventory movement, not custody.
- Can a bay fault be read as a discrete state, or is it only surfaced in an operator alert email?
- Does the custody hardware also act as a software-update or configuration channel to the device? If so, it is a management-plane component and must be threat-modeled as one, not treated as a read-only sensor.
- Is there an API, export, webhook, USB event, MDM workflow, or other public-safe event path?
- Can the case support QR, NFC, BLE, barcode, or other asset identity?
- Can battery state be read in a deterministic and supportable way?
- What audit logs are available, and who owns them as the system of record?
- Can the hardware be sanitized for healthcare workflows and cleaning protocols?
- Are evaluation units or partner technical documents available for non-production discovery?
