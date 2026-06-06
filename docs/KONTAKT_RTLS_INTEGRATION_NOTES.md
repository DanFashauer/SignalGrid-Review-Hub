# Kontakt.io / RTLS Integration Notes

Kontakt.io and similar RTLS platforms are future candidate signal sources for SignalGrid's healthcare and frontline roadmap. This document is documentation-only and public-safe: it does not describe a live connector, partnership, customer deployment, or production-ready capability.

## Why it matters

Healthcare shared-device workflows often depend on physical and operational context that identity and posture systems do not own. A future Kontakt.io / RTLS proof could help SignalGrid evaluate location and staff-safety signals such as:

- Hospital RTLS and location context.
- Asset tracking for shared devices, pumps, carts, badges, or clinical equipment.
- Patient journey or patient-location workflow context where appropriate and approved.
- Staff safety and duress events from badges, wearables, or mobile workflows.
- Equipment movement, missing-device, wrong-zone, and proximity events.
- Operational workflow context such as room, unit, zone, dock, return station, escalation state, or event freshness.

## Candidate signal model

SignalGrid could consume future RTLS/location inputs such as:

- Asset or device location.
- Room or zone presence.
- Staff safety alert or duress event.
- Patient, device, or equipment movement context.
- Location freshness and confidence.
- Dock or return-station context when paired with DockBridge.
- Workflow event context such as assigned unit, expected zone, escalation owner, or active incident state.

SignalGrid could emit:

- Runtime decision records.
- Operator mobile alerts.
- ITSM ticket requests.
- SIEM or security events.
- Audit evidence bundles.
- Review, remediation, or escalation routes.

## Source-system ownership

Kontakt.io or another RTLS source would remain authoritative for its own domain, including:

- RTLS hardware.
- Tags, badges, wearables, beacons, and sensors.
- Location engine behavior.
- Patient, asset, staff-location, or occupancy telemetry.
- RTLS infrastructure, calibration, deployment, and device health.
- Native platform workflows, dashboards, APIs, SDKs, and operational processes.

SignalGrid's role would be to normalize RTLS, location, and staff-safety context; combine it with identity, posture, session, dock, and operational signals; determine allow / review / deny / alert / audit outcomes; preserve audit context; and route events to operator or administrator workflows. SignalGrid would not replace the RTLS platform.

## First proof boundary

The first Kontakt.io / RTLS proof should be deterministic and fixture-based. It should not call Kontakt.io APIs, use customer data, or depend on live hospital infrastructure.

Future fixture scenarios could include:

- Staff duress alert in an assigned unit.
- Wrong-zone shared device event.
- Missing shared device or overdue return.
- Stale or low-confidence location signal.
- Asset, patient, or device proximity event.

Each fixture should map to a SignalGrid decision candidate such as allow, review, deny/restrict, operator alert, ITSM handoff, SIEM event, or audit-only record.

## Roadmap sequence

1. Microsoft Intune / Entra posture proof remains first.
2. Jamf Apple-specific posture proof follows for Apple-heavy shared-device and frontline environments.
3. Fleet / Workspace ONE / broader UEM proofs follow after the Microsoft and Jamf paths.
4. Kontakt.io / RTLS fixture proof becomes a follow-on location and staff-safety signal proof.
5. DockBridge can pair dock/return-station events with RTLS location context after posture is grounded.
6. Real Kontakt.io integration should be evaluated only after API/SDK access, data boundaries, privacy review, and partner-claim boundaries are validated.

## Guardrails

- No current Kontakt.io partnership, certification, marketplace listing, or validated integration is claimed.
- No production-ready claim is made.
- No replacement claim is made for Kontakt.io, RTLS platforms, MDM/UEM, IAM, ITSM, SIEM, nurse call, staff safety, EHR, or dock/hardware systems.
- No patient-care outcome guarantee or compliance certification is claimed.
- No customer data, protected health information, tenant secrets, proprietary hospital slide content, or vendor logos belong in public fixtures or diagrams.
- Keep initial artifacts conceptual, deterministic, and review-safe.
