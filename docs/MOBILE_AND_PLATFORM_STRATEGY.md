# Mobile and Platform Strategy

SignalGrid should support frontline and shared-device environments through a responsive web/PWA-first strategy, with native mobile or desktop companions added only when the workflow requires them.

## Operator mobile app

The operator mobile app is intended for frontline review and response workflows, including:

- Alert inbox.
- Workflow orchestration.
- Decision review.
- Step-up/review queue.
- Guided remediation.
- Push notifications.
- QR, NFC, or device scan.
- Evidence and audit notes.
- Escalation workflows.

The operator app should make SignalGrid's decisions understandable and actionable without turning the phone into a replacement for IAM, MDM, ITSM, SIEM, or NAC tooling.

## Admin mobile companion

The admin mobile companion should focus on time-sensitive oversight:

- Approval queue.
- Critical alerts.
- Active sessions.
- Integration health.
- Emergency restrict, deny, or review actions.

Emergency actions must remain constrained, logged, and reversible where possible. They should not bypass existing enterprise controls.

## Platform plan

| Surface                       | Recommended approach                 | Rationale                                                                                                               |
| ----------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Web console                   | Responsive web/PWA first             | Fastest path to shared admin/operator review, public demos, and cross-platform validation.                              |
| iOS/Android                   | React Native/Expo                    | Suitable once mobile-specific workflows such as push notifications, QR/NFC scanning, and operator queues are validated. |
| macOS/Windows admin           | PWA, Tauri, or Electron if needed    | Useful only if desktop packaging materially improves admin workflows.                                                   |
| macOS/Windows endpoint agents | Only if deeper telemetry is required | Endpoint agents increase security, support, and deployment burden; prefer existing telemetry sources first.             |

## Jamf / Apple-specific posture path

For Apple-heavy frontline environments, Jamf is the high-value follow-on posture connector after the Microsoft Intune / Entra first proof. Jamf is especially relevant where Apple-native management depth matters: iOS/iPadOS shared devices, macOS frontline/admin workstations, Apple Business Manager / Automated Device Enrollment context, Declarative Device Management, Managed Device Attestation or hardware attestation where available, Platform SSO context where available, APNs communication health, configuration profile status, Apple OS/update readiness, and Jamf Self Service remediation state.

SignalGrid would not replace Jamf. Jamf remains responsible for Apple device lifecycle management, app/profile deployment, inventory collection, Apple-specific management frameworks, Self Service workflows, and device security enforcement. SignalGrid would consume and normalize Jamf posture/context, combine it with identity, session, location, workflow, and operational signals, determine allow / step-up / deny / review / remediation-routing candidates, record audit evidence, and hand action requests back to Jamf or other systems where appropriate.

The positioning line is: Intune / Entra proves the Microsoft posture path. Jamf becomes the Apple-depth path. SignalGrid connects those posture signals to runtime access outcomes.

## DockBridge / edge dock connector strategy

SignalGrid DockBridge is a future edge/dock integration layer for shared-device docks, charging stations, smart cabinets, kiosks, and return stations. It would let dock vendors or simulated dock services report physical events such as device docked, device undocked, wrong-slot return, return overdue, charging fault, or dock offline into SignalGrid's runtime decision layer.

DockBridge should extend the operator mobile and admin companion workflows rather than replace existing management systems. A dock event could trigger identity/session review, posture lookup, SignalGrid decisioning, operator/admin alerting, and audit capture. The first proof should be a simulated dock event API and demo flow before any real dock hardware or hardware certification work.

DockBridge remains a future platform expansion path. It should not be framed as replacing MDM/UEM, Apple Configurator, Imprivata GroundControl, IAM, ITSM, SIEM, or hardware-platform controls. See [DockBridge Strategy](DOCKBRIDGE_STRATEGY.md).

## Posture source boundaries

SignalGrid consumes MDM/UEM posture signals. SignalGrid does not replace MDM/UEM. The sequence is Microsoft Intune / Entra first, Jamf Apple-specific posture second, then Fleet / Workspace ONE / broader UEM paths. iOS and Android posture will usually come through systems such as Microsoft Intune, Jamf, Workspace ONE, Fleet, or similar tools.

## Review questions

- Which mobile workflow is compelling enough to justify native implementation?
- Can the first operator workflow be validated as a PWA?
- Which posture signals are essential for the first proof?
- What actions must require admin approval, test-ring validation, or rollback planning?
