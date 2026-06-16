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

## Non-goals

- No hardware integration is implemented in Review Hub.
- No live vendor API calls, hardware calls, webhook listeners, USB listeners, or production integrations are added.
- No Beam Mobile partnership, endorsement, reseller, certification, or alliance status is claimed.
- No procurement recommendation or vendor ranking is made.
- SignalGrid does not replace Beam Mobile, MDM, IAM, PACS, smart lockers, docks, EHR systems, RTLS, or any hardware vendor.
- SignalGrid does not control emergency egress.
- SignalGrid does not execute live remediation without governance, approval, and separate validation.

## Future discovery questions

- Does the dock expose bay occupied/empty state?
- Can the dock identify the device, case, or battery in each bay?
- Is there an API, export, webhook, USB event, MDM workflow, or other public-safe event path?
- Can the case support QR, NFC, BLE, barcode, or other asset identity?
- Can battery state be read in a deterministic and supportable way?
- What audit logs are available, and who owns them as the system of record?
- Can the hardware be sanitized for healthcare workflows and cleaning protocols?
- Are evaluation units or partner technical documents available for non-production discovery?
