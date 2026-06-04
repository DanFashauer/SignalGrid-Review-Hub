# Ecosystem Positioning

SignalGrid is a runtime decision layer and Zero Trust orchestration platform for shared-device and mobile frontline environments. It is not another IAM, UEM/MDM, ITSM, SIEM/SOAR, NAC, healthcare access-management, or hardware platform. Those systems remain the systems of record for their own domains.

SignalGrid consumes signals from those systems, evaluates runtime context, determines an access outcome, and emits decision evidence or action requests back to connected workflows.

![Where SignalGrid fits in the access decision stack](assets/signalgrid-ecosystem-positioning.svg)

## Main takeaway

- **IAM authenticates.**
- **UEM reports posture.**
- **ITSM/SIEM record and investigate.**
- **Dock systems observe physical device state.**
- **SignalGrid decides what should happen at runtime.**

SignalGrid fits in the decision gap between systems that authenticate users, manage devices, record operations, investigate security events, and observe shared-device movement. It evaluates identity, device posture, session context, physical/device context, and operational signals before the workflow breaks.

## Ecosystem positioning matrix

| Category                          | Examples                                 | What the category owns                                                                                                                                     | What SignalGrid consumes                                                                                                                                                                     | What SignalGrid emits                                                                                               | Replacement boundary                                                                                                                            |
| --------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| IAM / IdP                         | Entra ID, Okta, Ping                     | User authentication, identity directory, SSO, MFA, identity claims, identity/session policy.                                                               | User identity, group/role context, session state, risk/context signals where available.                                                                                                      | Decision outcome, audit context, review request, step-up/restrict/deny recommendation where supported.              | SignalGrid does not replace the IdP, directory, SSO, MFA, or identity lifecycle system.                                                         |
| IGA                               | SailPoint, Saviynt                       | Access governance, identity lifecycle governance, access certifications, entitlement review, separation-of-duty processes.                                 | Governance status, entitlement context, certification status, lifecycle/risk signals where available.                                                                                        | Decision evidence, access-review context, remediation or recertification request.                                   | SignalGrid does not replace IGA governance, certification, lifecycle, or entitlement-management programs.                                       |
| UEM / MDM                         | Intune, Jamf, Workspace ONE, Fleet       | Device enrollment, compliance policy, configuration profiles, software inventory, device actions, managed-device lifecycle.                                | Device ID, ownership, compliance, posture, OS/version, encryption, jailbreak/root, check-in freshness, profile state.                                                                        | Normalized posture decision, audit record, remediation request, operator/admin review recommendation.               | SignalGrid does not replace UEM/MDM enrollment, profile deployment, compliance policy, or device-management actions.                            |
| Healthcare access management      | Imprivata                                | Clinical access workflows, strong authentication, badge and shared-workstation context, mobile/medical-device access workflows where validated.            | Future candidate workflow, identity/session, badge, clinical context, and shared-device signals if an approved integration exists.                                                           | Future candidate decision evidence, escalation, review, or workflow request.                                        | SignalGrid does not claim a current Imprivata partnership, certification, validated integration, or replacement relationship.                   |
| ITSM                              | ServiceNow, Jira Service Management      | Incidents, requests, changes, approvals, assignments, service workflows, work records.                                                                     | Ticket status, change windows, approval state, incident context, assignment/ownership context.                                                                                               | Ticket creation/update request, remediation task, review request, evidence packet, audit note.                      | SignalGrid does not replace ITSM workflows, ticket lifecycle, approvals, or service operations.                                                 |
| SIEM / SOAR                       | Microsoft Sentinel, Splunk               | Security analytics, detection engineering, event correlation, investigation, response playbooks, retention.                                                | Security alerts, correlated risk, incident context, investigation state, severity, enrichment.                                                                                               | Enriched decision event, audit trail, security event, SOAR handoff or response request.                             | SignalGrid does not replace detection, investigation, SOAR automation, retention, or security analytics platforms.                              |
| NAC / Network                     | Cisco ISE, Aruba/ClearPass               | Network admission, segmentation, VLAN/session enforcement, network posture, network access policy.                                                         | Network session, device network posture, location hints, admission state, segmentation context.                                                                                              | Restrict/quarantine/review recommendation, decision evidence, audit event, policy context.                          | SignalGrid does not replace NAC enforcement, switching/wireless control, segmentation, or network policy systems.                               |
| Endpoint telemetry                | Defender, CrowdStrike, FleetDM           | Endpoint detection, sensor telemetry, host risk, vulnerability/exposure data, fleet inventory, endpoint response.                                          | Endpoint risk, alert state, sensor health, vulnerability/exposure, host posture, fleet freshness signals.                                                                                    | Decision/audit event, review request, remediation recommendation, enrichment for investigation.                     | SignalGrid does not replace EDR, endpoint telemetry collection, response tooling, or fleet inventory systems.                                   |
| Dock / Edge shared-device systems | Docks, smart cabinets, return stations   | Physical device state, slot occupancy, charging state, device return/release events, local hardware behavior.                                              | Dock/undock events, wrong-slot return, missing device, charging fault, dock online/offline, device/location identifiers.                                                                     | Runtime decision event, operator/admin alert, ticket/audit event, remediation or review request.                    | SignalGrid does not replace dock hardware, accessory certification, firmware, local safety controls, or hardware systems of record.             |
| Agentic control surfaces          | Cisco Cloud Control, MCP-style platforms | Unified operations workspaces, governed agent workflows, normalized APIs/tool surfaces, marketplace or studio extensions, source-platform policy controls. | Future connector or orchestration context such as read-only signals, scoped tool/action requests, simulation results, approval state, and action metadata where approved integrations exist. | Decision evidence, policy evaluation, signed action request, approval requirement, simulation result, audit record. | SignalGrid does not compete with broad infrastructure control planes or claim current Cisco, MCP, marketplace, or agentic-platform integration. |
| SignalGrid                        | Runtime decision orchestration           | Runtime access decision orchestration across identity, posture, session, operational, and physical/shared-device signals.                                  | Identity context, device posture, session context, operational context, security context, dock/edge events.                                                                                  | Allow, step-up, deny, remediate, record, review request, audit evidence, action request.                            | SignalGrid preserves connected systems as systems of record and does not position itself as their replacement.                                  |

## Objection handling

### “Why not just extend our existing IAM/UEM/ITSM stack?”

Use those systems. SignalGrid is not trying to replace them.

Those systems authenticate users, manage devices, record work, investigate events, or enforce policy. SignalGrid sits in the decision gap between them. It evaluates identity, device posture, session context, physical/device context, and operational signals at runtime, then determines the correct access outcome before the workflow breaks.

In practical terms, SignalGrid can consume identity/session context from IAM, posture and freshness from UEM/MDM, governance context from IGA, operational state from ITSM, security context from SIEM/SOAR and endpoint telemetry, network context from NAC, and physical shared-device state from dock/edge systems. It can then emit decisions, audit context, and action requests back to the connected systems that already own execution and records.

## Claim boundaries

This public positioning artifact intentionally avoids unsafe claims:

- No production-ready claims.
- No compliance certification claims.
- No replacement claims for IAM, IGA, UEM/MDM, ITSM, SIEM/SOAR, NAC, healthcare access-management, endpoint telemetry, or dock/hardware systems.
- No Imprivata partnership, certification, validated-integration, marketplace, or alliance claims.
- No MFi certification claims.
- No autonomous production-remediation claims.
- No current Cisco Cloud Control, Jamf, MCP, marketplace, or agentic-control-plane integration claims.

## First proof alignment

The strongest next proof remains the Intune / Entra posture path:

`Device ID → compliance lookup → normalized posture signal → SignalGrid decision → audit record`

That proof keeps the public story anchored in a conservative runtime decision flow: source systems remain authoritative, SignalGrid evaluates cross-system context, and every decision is recorded for review.

## Visual artifact discipline

Public diagrams and ecosystem visuals should be maintained as source-controlled visual code where practical. See [Visual-code asset strategy](VISUAL_CODE_ASSET_STRATEGY.md) for the repository process for SVG, React/HTML/CSS, Mermaid, Lottie JSON, and other structured visual artifacts.
