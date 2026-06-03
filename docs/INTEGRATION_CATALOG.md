# Integration Catalog

SignalGrid acts as a runtime decision layer that consumes signals from source systems, evaluates context, emits decisions or workflow requests, and records audit evidence. Source systems remain authoritative for their own domains.

## Integration categories

| Category | Candidate systems | What SignalGrid consumes | What SignalGrid emits | Source system still owns | MVP/public-preprod priority | Private-core priority |
| --- | --- | --- | --- | --- | --- | --- |
| Identity / IAM | Entra ID, Okta | Identity, group, role, session, conditional-access context where available. | Decision outcome, review request, audit event, optional step-up/restrict recommendation. | Identity lifecycle, authentication, SSO, MFA, directory policy. | High: required for first proof framing. | High: core dependency for decision context. |
| Healthcare access management | Imprivata Enterprise Access Management, Mobile Access Management, Mobile Device Access, Medical Devices Access Management, Patient Access, Privileged Access Security | Shared-device, clinical access, badge, workstation, privileged-access, and workflow context if a future integration is pursued. | Review/audit context, decision recommendations, escalation signals. | Healthcare access workflows, product-specific controls, customer deployments, certifications. | Low: future candidate only. | Medium later if healthcare design partners validate need. |
| UEM/MDM posture | Intune, Jamf, Workspace ONE, Fleet | Device ID, compliance state, ownership, OS/version, encryption, jailbreak/root, policy state, last check-in. | Normalized posture signal, decision/audit record, remediation recommendation. | Device enrollment, compliance policy, profile deployment, device actions. | High: Intune/Entra posture proof is first. | High: first protected integration proof. |
| ITSM | ServiceNow, Jira Service Management | Incident/change context, ticket status, assignment, maintenance windows. | Ticket creation/update, evidence, approval request, remediation task. | Service workflow, change management, ticket lifecycle. | Medium: document after first proof. | Medium after audit/remediation flow stabilizes. |
| SIEM/SOAR | Microsoft Sentinel, Splunk | Security alerts, risk signals, correlated events, incident context. | Audit events, decision events, enrichment, SOAR handoff. | Detection engineering, alert correlation, retention, incident response. | Medium: important for audit story, not first connector. | Medium after identity/posture proof. |
| NAC/network | Cisco ISE, Aruba/ClearPass | Network session, VLAN, device network posture, location hints. | Restrict/deny/review recommendation, audit event, policy context. | Network admission, segmentation, enforcement. | Low/medium: future shared-device context. | Medium later for deeper enforcement paths. |
| Endpoint telemetry | Defender, CrowdStrike, FleetDM | Device risk, sensor state, vulnerability/exposure, process or endpoint alerts where appropriate. | Decision/audit event, review request, remediation recommendation. | Endpoint detection/response, host telemetry, agent management. | Medium: useful signal category after MDM proof. | Medium after posture normalization exists. |
| Physical/shared-device context | Badge, QR/NFC, location/RTLS | Badge tap, QR/NFC scan, asset/location signal, proximity or shared-device workflow context. | Session context, review/evidence note, access decision input. | Physical access system, RTLS infrastructure, device inventory. | Low/medium: important for frontline story, not first proof. | Medium if design partners need location/shared-device validation. |
| Dock/edge shared-device events | Docks, charging stations, smart cabinets, kiosks, return stations, optional edge gateways | Dock/undock events, slot state, wrong-slot return, return overdue, charging fault, dock online/offline, location and device identifiers. | Runtime decision event, operator/admin alert, ticket/audit event, remediation recommendation. | Dock firmware, hardware state, charging behavior, accessory certification, local safety controls. | Low/medium: start with simulated DockBridge event API after posture/mobile proof. | Medium later if one dock/vendor adapter is validated. |

## First proof: Microsoft Intune / Entra posture

The first integration proof should be constrained and auditable:

`Device ID → compliance lookup → normalized posture signal → SignalGrid decision → audit record`

The goal is to prove that SignalGrid can consume an authoritative posture signal, normalize it into the decision model, produce a clear allow/review/restrict/deny-style outcome, and record why the decision happened. This is a proof path, not a Microsoft certification claim and not a production MDM replacement.

## Imprivata candidate path

Imprivata is documented as a future candidate healthcare access-management integration and partner path only. Review Hub does not claim a current Imprivata partnership, certification, alliance, or validated integration. Before any public claim changes, SignalGrid would need an approved product one-pager, working demo, validated integration proof, concise customer benefit statement, and careful review for production/compliance overclaims.

## DockBridge candidate integration

SignalGrid DockBridge is a future dock/edge integration strategy for shared-device physical events. The first proof should be software-only: a simulated `POST /api/dock/events` contract and demo flow that turns dock state into SignalGrid runtime decisions and audit records. Real dock hardware, MFi work, or vendor-specific adapters should come later only if the simulated workflow validates customer value.

DockBridge should reduce workstation-centered orchestration where possible, but it should not be claimed as a replacement for Apple Configurator, MDM/UEM, Imprivata GroundControl, or platform-managed device operations.
