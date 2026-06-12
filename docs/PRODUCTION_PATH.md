# Production Path

SignalGrid Review Hub is a public pre-production and post-launch review surface. This document describes the conservative path from public strategy to private-core proof and eventual production readiness. It is not a claim that SignalGrid is production-ready today.

## Current status

- Public Review Hub documentation is for validation, review, and design-partner conversations.
- Protected implementation belongs in the private `DanFashauer/SignalGrid` core repository.
- Runtime/product code should not be treated as production-ready based on these docs alone.
- No compliance certification, partner certification, customer deployment, or hardware certification is claimed.

## Production-readiness gates

Before any production claim, SignalGrid would need evidence for:

1. Clear problem, buyer, user, and workflow validation.
2. Private-core implementation with reproducible build and test coverage.
3. Security review, secrets handling, tenant isolation, audit behavior, and failure-mode review.
4. Validated integration proof with source systems of record.
5. Operational runbooks, support model, observability, backup/restore, and incident response.
6. Legal, compliance, privacy, and claims review.
7. Controlled pilot or design-partner validation where appropriate.

## Sequencing

The recommended sequence remains:

1. Local real-life simulator foundation using deterministic public fixtures across identity, device state/compliance, posture, health, RTLS/location, DockBridge, workflow ownership, routing, and audit evidence.
2. Entra ID + Intune identity/posture proof using Microsoft Graph / Graph SDK design and deterministic public fixtures first.
3. Identity Trust Layer documentation for IAM/IdP/IGA signal boundaries and runtime trust framing.
4. Apple DDM / Platform SSO / audit-event fixture proof to consume Apple state and evidence without replacing Apple management systems.
5. Jamf Apple-specific posture proof for Apple-heavy shared-device and frontline environments.
6. Fleet / Workspace ONE / broader UEM connector paths.
7. Operational Health / DEX layer documentation and deterministic fixtures for endpoint health, API/service health, alerting, ITSM routing, and user-experience signals.
8. Okta / Ping / Duo follow-on identity and MFA context after the Microsoft proof is stable.
9. Kontakt.io / RTLS deterministic fixture proof as the first location and staff-safety signal path.
10. DockBridge simulated dock event API.
11. Operator mobile workflow MVP.
12. SailPoint / IGA governance context after identity/posture proof and policy explainability stabilize.
13. AWS IAM / Google Cloud IAM later after enterprise identity, UEM, and operational-health proofs are grounded.
14. Network / Cloud Trust Layer expansion after identity, posture, and Operational Health / DEX foundations.
15. MCP / agentic connector strategy later, after deterministic source-system proofs and approval-gated action patterns are grounded.
16. One dock/vendor adapter if the simulated workflow validates value.
17. MFi or hardware certification path only if Apple-connected hardware integration is required.
18. Imprivata/healthcare alliance path only if validated and mutually approved.

## Entra ID + Intune identity/posture proof gate

The first production-path proof is the [Intune / Entra posture proof](INTUNE_ENTRA_POSTURE_PROOF.md), with Microsoft Graph / Graph SDK sequencing documented in [Microsoft Graph and MCP strategy](MICROSOFT_GRAPH_AND_MCP_STRATEGY.md) and the broader identity framing documented in [Identity Trust Layer strategy](IDENTITY_TRUST_LAYER_STRATEGY.md). It should establish that SignalGrid can consume Microsoft identity plus device/compliance context, normalize it, use it as a runtime trust input, and record audit evidence without claiming production readiness.

| Gate                              | Evidence needed                                                                                                                                                                                                                                      | Claim boundary                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Public-safe proof plan            | Documentation of objective, scope, target flow, inputs, normalized posture model, decision mapping, audit record, future extensions, and validation checklist.                                                                                       | Documentation-first; no production rollout or compliance guarantee.                    |
| Deterministic fixture path        | Fake or sandbox payloads for compliant, non-compliant, stale, missing-device, and lookup-failure cases.                                                                                                                                              | No customer data, no production secrets, no real tenant dependency in the public repo. |
| Normalized identity/posture model | Stable fields for user/device identity, source system, group/role, MFA or Conditional Access context where available, management state, compliance state, freshness, risk indicators, observed time, raw reference, confidence, and decision impact. | Microsoft Entra ID / Intune remains the source of record.                              |
| Decision and audit trace          | Candidate outcome, reason code, source system, lookup time, normalized posture, policy version, and optional operator/admin note.                                                                                                                    | Proof evidence only; not a production enforcement or certification claim.              |
| Failure-mode review               | Missing device, stale posture, unknown posture, malformed payload, denied lookup, and source outage paths are deterministic.                                                                                                                         | Unknown posture must not be treated as compliant.                                      |

This gate should be completed before Jamf Apple-specific posture, broader Fleet / Workspace ONE UEM, Okta/Ping/Duo follow-on identity, SailPoint/IGA governance, cloud IAM, RTLS/location, DockBridge pairing, operator mobile alerts, Imprivata candidate workflow correlation, or agentic connector claims are advanced. See [Frontline context signals roadmap](FRONTLINE_CONTEXT_SIGNALS.md) for later context categories.

## Jamf / Apple-specific posture connector path

Jamf is the high-value follow-on posture proof after the Microsoft Intune / Entra proof. Intune / Entra proves the Microsoft posture path; Jamf becomes the Apple-depth path. SignalGrid connects those posture signals to runtime access outcomes.

Jamf is especially relevant for Apple-first environments where Apple-native management depth matters for iOS/iPadOS shared devices, macOS frontline/admin workstations, Apple Business Manager / Automated Device Enrollment workflows, Platform SSO, Managed Device Attestation, Declarative Device Management, APNs communication health, configuration profiles, OS update readiness, and Jamf Self Service remediation state.

For this path, Jamf remains the system that owns Apple device lifecycle management, app/profile deployment, inventory collection, Apple-specific management frameworks, Self Service workflows, and device security enforcement. SignalGrid would normalize Jamf posture/context into runtime decision inputs, combine Apple posture with identity, session, location, workflow, and operational signals, determine allow / step-up / deny / review / remediation-routing candidates, record audit evidence, and hand action requests back to Jamf or another source system where appropriate.

Review Hub does not claim a current Jamf partnership, validated Jamf integration, Jamf certification, production readiness, or replacement of Jamf.

## Kontakt.io / RTLS production path

Kontakt.io and similar RTLS platforms should be documented as future location, staff-safety, asset-tracking, patient/device movement, and operational workflow signal sources. They should not become the next live connector before the Microsoft Intune / Entra posture proof and Review Hub CI are stable.

| Stage                       | Goal                                                                                                      | Evidence needed                                                                           | Claim boundary                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Candidate documentation     | Describe the RTLS/location/staff-safety signal category and source-system boundaries.                     | Public-safe docs, integration notes, roadmap placement, and guardrails.                   | No partnership, live integration, production-ready, patient-care outcome, or compliance claim. |
| Deterministic fixture proof | Simulate staff duress, wrong-zone device, missing shared device, stale location, and proximity scenarios. | Fixture payloads, normalized signal model, decision mapping, operator alert/audit output. | No live Kontakt.io API calls, customer data, hospital identifiers, or PHI.                     |
| Source access review        | Evaluate real API/SDK access, auth, event freshness, privacy, and partner boundaries.                     | API/SDK notes, data-minimization review, failure-mode plan, approval path.                | Evaluation only until approved and validated.                                                  |
| Connector proof             | Read approved RTLS/location events and map them into SignalGrid decisions.                                | Test tenant/sandbox or approved non-customer data, replay-safe events, audit trace.       | RTLS source remains authoritative for hardware, telemetry, calibration, and native workflows.  |

SignalGrid's safe role is to normalize RTLS/location/staff-safety context, combine it with identity, posture, session, DockBridge, and operational signals, determine allow / review / deny / alert / audit outcomes, and route evidence to operator or administrator workflows.

## Agentic connector production path

Agentic operations and MCP-style connector concepts should remain future-facing until grounded by working proofs. SignalGrid should not claim autonomous production remediation, current MCP implementation, Cisco Cloud Control integration, Jamf partnership, connector marketplace listing, or customer deployment.

| Stage                       | Goal                                                                                          | Evidence needed                                                                         | Claim boundary                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Read-only connector proof   | Consume posture, inventory, ticket, security, or dock/edge signals without executing actions. | Connector schema, auth model, normalized signal, decision trace, audit record.          | Discovery-only; source systems remain authoritative.                               |
| Simulation proof            | Show what a proposed action would do before execution.                                        | Simulation output, affected assets, policy evaluation, operator review state.           | No production state change.                                                        |
| Signed action request proof | Hand an approved action request to the system that owns execution.                            | Signed request, scope, timestamp/nonce, approval record, idempotency, failure handling. | SignalGrid requests; existing systems execute.                                     |
| Human approval gates        | Require operator or policy approval for higher-impact actions.                                | Role checks, approval workflow, escalation path, audit evidence.                        | No autonomous production remediation.                                              |
| Rollback metadata           | Capture enough context to support reversal or follow-up.                                      | Previous state, expected rollback path, owner, timeout, ticket/audit link.              | Rollback execution remains owned by the source system unless separately validated. |

The safe operating principle is: agents may suggest, SignalGrid evaluates, operators approve, existing systems execute, and SignalGrid records.

## DockBridge production path

DockBridge should progress through conservative stages:

| Stage                         | Goal                                                                                           | Evidence needed                                                                   | Claim boundary                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Simulated dock API            | Prove that dock events can drive SignalGrid decisions.                                         | Event schema, simulator, decision trace, operator/admin alert, audit record.      | Software-only demo; no hardware or platform certification claim.  |
| Event integrity               | Prove events are authentic and replay-resistant enough for a controlled proof.                 | Signed webhook design, idempotency, timestamps, replay handling, logging.         | Not production security certification.                            |
| Posture pairing               | Connect dock event context to MDM/UEM posture and identity/session context.                    | Device ID mapping, compliance lookup, normalized posture signal, decision result. | MDM/UEM remains system of record.                                 |
| Operator workflow             | Validate review, exception, deny, ticket, and audit actions.                                   | Operator mobile/admin flow, role checks, evidence capture, rollback notes.        | No autonomous production remediation.                             |
| Vendor adapter                | Integrate one real dock/smart-cabinet/return-station vendor if warranted.                      | Vendor event mapping, test harness, failure handling, operational runbook.        | No broad hardware certification or partner claim unless approved. |
| Hardware/certification review | Evaluate MFi or other hardware/platform requirements if Apple-connected accessories are built. | Qualified partner, hardware design, certification path, legal/platform review.    | Future-facing only until certified.                               |

## Systems of record

SignalGrid should coordinate runtime decisions while preserving ownership boundaries:

- IAM/access-management systems own identity, authentication, SSO, MFA, Conditional Access, and identity session controls.
- IGA systems own access reviews, certifications, entitlement lifecycle, and governance policy.
- MDM/UEM systems own device enrollment, compliance policy, device actions, and profile deployment.
- ITSM systems own ticket/change lifecycle and approval workflows.
- DEX, RMM, monitoring, observability, and endpoint platforms own health telemetry, alert state, endpoint-experience data, API/service metrics, and native remediation controls.
- SIEM/SOAR systems own detection, correlation, retention, and response automation.
- Dock/accessory vendors own hardware state, firmware behavior, safety controls, and hardware certifications.
- Apple, Android, and platform vendors own platform-controlled device-management operations.

## Exit criteria for public claims

Public claims should remain conservative unless there is evidence that is safe to publish. A claim can move forward only when it is:

- Supported by a working proof or deployment evidence.
- Free of customer data, secrets, and protected implementation details.
- Reviewed for compliance, security, partner, and platform implications.
- Clear about what SignalGrid consumes, emits, and does not replace.
- Approved for public release.

## Operational Health / DEX follow-on gate

The [Operational Health / DEX Layer Strategy](OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md) should follow the Entra ID + Intune first proof, the Identity Trust Layer, and Jamf / broader UEM posture paths. It should come before Network / Cloud Trust Layer expansion, autonomous remediation, and agentic/MCP action execution because endpoint health, API health, alerting, ITSM routing, and user-experience signals are lower-risk context inputs when treated as routed requests rather than autonomous production actions.

| Gate                             | Evidence needed                                                                                                                                                                                                                                                                         | Claim boundary                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Public-safe health signal model  | Deterministic endpoint-health and API/service-health fixtures for online/offline state, check-in freshness, CPU/memory/disk pressure, app/service crash rate, network health, EDR/AV state, patch posture, latency/error rates, webhook failures, stale sync, and API auth failures.    | No live DEX, monitoring, ITSM, EDR, SIEM, observability, or customer data dependency in the public repo. |
| Routing and ownership model      | Examples that map source system, workflow, owner, severity, impacted service, and session context to the correct team, ticket, email, mobile alert, Slack/Teams/PagerDuty/Opsgenie notification, posture refresh request, MDM sync request, EDR investigation request, or audit record. | Existing tools remain systems of record and execute their own controls.                                  |
| Decision examples                | Explicit examples for compliant-device health degradation, non-compliant stale shared-device sessions, webhook retry exhaustion, EDR disabled for privileged users, shared-device app crash pools, and poor Teams/VDI quality.                                                          | Decision examples are proof patterns, not production-ready remediation claims.                           |
| Approval-gated actions           | High-risk actions such as endpoint isolation, security escalation, or remediation execution are modeled as requests with approval gates, scoped permissions, and audit evidence.                                                                                                        | No autonomous production remediation claims.                                                             |
| Private-core implementation plan | A note that real connectors belong in private/core/local Codex because they may require credentials, API keys, tenant data, webhook secrets, monitoring access, tool permissions, and private test data.                                                                                | Public Review Hub stays documentation-first and deterministic.                                           |
