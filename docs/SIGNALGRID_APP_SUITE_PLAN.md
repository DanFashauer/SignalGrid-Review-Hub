# SignalGrid App Suite Plan

The SignalGrid Apps Suite is represented in this repository as thin simulator shells. The shells show personas, signal surfaces, likely actions, and future production roles without implementing live integrations or private-core behavior.

## Operator App

- Persona: frontline operator, mobility analyst, or unit owner.
- Purpose: alert inbox and assigned-action cockpit for exceptions that affect shared-device or mobile workflows.
- MVP simulator screens: alert inbox, assigned actions, acknowledge/escalate/verify states.
- Future production role: triage operational exceptions and verify outcomes after private-core validation.
- Signals consumed: device state and compliance, device health, RTLS/location, DockBridge, workflow ownership, integration health.
- Actions requested: acknowledge, escalate, create review action, verify remediation evidence.
- Boundary: simulator shell only; no production action execution.

## Admin App

- Persona: platform administrator, mobility admin, security admin, or app owner.
- Purpose: review policy decisions, integrations, ownership rules, and audit evidence.
- MVP simulator screens: policy decisions, integrations, ownership rules, audit view.
- Future production role: governed administration for routing rules and policy visibility.
- Signals consumed: all normalized simulator signal categories, including Apple DDM/Platform SSO style state and audit evidence.
- Actions requested: adjust simulated policy, inspect route, review audit evidence.
- Boundary: no live policy enforcement or tenant configuration.

## DockBridge App

- Persona: shared-device pool owner, dock operator, or local inventory owner.
- Purpose: simulate dock events, slot state, missing or overdue devices, and wrong-slot returns.
- MVP simulator screens: dock events, slot status, missing/overdue devices, wrong-slot return.
- Future production role: edge or dock adapter only after software workflow value is validated.
- Signals consumed: dock.device_docked, dock.device_undocked, dock.wrong_slot_return, dock.device_missing.
- Actions requested: flag missing, route to owner, reconcile return, record evidence.
- Boundary: no hardware requirement, no hardware certification claim.

## Shared Device Assistant

- Persona: frontline worker checking out or returning a shared device.
- Purpose: software-first checkout/check-in flow using QR, badge, or NFC placeholders.
- MVP simulator screens: checkout/check-in, QR/badge/NFC placeholder, current device/session status.
- Future production role: first mobile/PWA workflow before custom hardware investment.
- Signals consumed: identity.authenticated, apple.platform_sso_status, device.posture_observed, workflow.assignment_changed.
- Actions requested: start session, end session, request review if posture or ownership is incomplete.
- Boundary: no real badge reader, NFC, or identity-provider action.

## Remediation Assistant

- Persona: endpoint, mobility, DEX, or security owner.
- Purpose: recommend a bounded action, capture approval, validate evidence, and update the simulated ticket.
- MVP simulator screens: recommended action, approval gate, validation evidence, ticket update.
- Future production role: human-approved remediation workflow with source-system ownership preserved.
- Signals consumed: device.non_compliant, device.stale_checkin, remediation.requested, remediation.verified.
- Actions requested: request posture refresh, collect evidence, verify remediation, record audit.
- Boundary: no autonomous production remediation; source systems own execution.
