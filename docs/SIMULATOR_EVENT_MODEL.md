# Simulator Event Model

The simulator uses deterministic events with normalized fields. Events are public-safe fixtures, not source-system payloads.

## Event shape

Each simulator event contains:

- id
- type
- layer
- source
- subject
- observedAt
- severity
- summary
- attributes

## Event types

- identity.authenticated
- identity.risk_detected
- apple.ddm_declared_state
- apple.platform_sso_status
- apple.audit_event_recorded
- device.configuration_observed
- device.enrollment_observed
- device.posture_observed
- device.non_compliant
- device.stale_checkin
- device.low_battery
- device.health_degraded
- dock.device_docked
- dock.device_undocked
- dock.wrong_slot_return
- dock.device_missing
- rtls.location_observed
- rtls.wrong_zone
- rts.staff_safety_alert
- workflow.assignment_changed
- api.integration_failed
- ticket.created
- ticket.updated
- remediation.requested
- remediation.verified
- audit.recorded

## Layer mapping

- Identity events map to the Identity Trust Layer.
- Apple DDM, Platform SSO, configuration, enrollment, and management audit events map to the Device State & Compliance Layer and Audit Evidence Layer.
- Device posture and device health events map to Device Trust and Operational Health / DEX.
- RTLS events map to location context.
- Dock events map to DockBridge/shared-device context.
- Workflow and ticket events map to ownership and ITSM context.
- Integration failures map to degraded routing and queue simulation.
- Remediation and audit events map to evidence and verification workflows.

## Fixture guarantees

- Events are deterministic.
- Timestamps are stable for repeatable tests.
- No event includes customer, patient, tenant, or credential data.
- Source systems are represented as fixture labels only.
