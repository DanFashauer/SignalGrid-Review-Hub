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

1. Intune/Entra posture proof.
2. Operator mobile workflow MVP.
3. Jamf/UEM connector proof.
4. DockBridge simulated dock event API.
5. MCP/agentic connector strategy proof after source-system proofs are grounded.
6. One dock/vendor adapter if the simulated workflow validates value.
7. MFi or hardware certification path only if Apple-connected hardware integration is required.
8. Imprivata/healthcare alliance path only if validated and mutually approved.

## Intune / Entra posture proof gate

The first production-path proof is the [Intune / Entra posture proof](INTUNE_ENTRA_POSTURE_PROOF.md). It should establish that SignalGrid can consume Microsoft device/compliance context, normalize it, use it as a runtime decision input, and record audit evidence without claiming production readiness.

| Gate | Evidence needed | Claim boundary |
| --- | --- | --- |
| Public-safe proof plan | Documentation of objective, scope, target flow, inputs, normalized posture model, decision mapping, audit record, future extensions, and validation checklist. | Documentation-first; no production rollout or compliance guarantee. |
| Deterministic fixture path | Fake or sandbox payloads for compliant, non-compliant, stale, missing-device, and lookup-failure cases. | No customer data, no production secrets, no real tenant dependency in the public repo. |
| Normalized posture model | Stable fields for device ID, source system, management state, compliance state, freshness, risk indicators, observed time, raw reference, confidence, and decision impact. | Microsoft Intune / Entra remains the source of record. |
| Decision and audit trace | Candidate outcome, reason code, source system, lookup time, normalized posture, policy version, and optional operator/admin note. | Proof evidence only; not a production enforcement or certification claim. |
| Failure-mode review | Missing device, stale posture, unknown posture, malformed payload, denied lookup, and source outage paths are deterministic. | Unknown posture must not be treated as compliant. |

This gate should be completed before broader Jamf/UEM, DockBridge pairing, operator mobile alerts, Imprivata candidate workflow correlation, or agentic connector claims are advanced.

## Agentic connector production path

Agentic operations and MCP-style connector concepts should remain future-facing until grounded by working proofs. SignalGrid should not claim autonomous production remediation, current MCP implementation, Cisco Cloud Control integration, Jamf partnership, connector marketplace listing, or customer deployment.

| Stage | Goal | Evidence needed | Claim boundary |
| --- | --- | --- | --- |
| Read-only connector proof | Consume posture, inventory, ticket, security, or dock/edge signals without executing actions. | Connector schema, auth model, normalized signal, decision trace, audit record. | Discovery-only; source systems remain authoritative. |
| Simulation proof | Show what a proposed action would do before execution. | Simulation output, affected assets, policy evaluation, operator review state. | No production state change. |
| Signed action request proof | Hand an approved action request to the system that owns execution. | Signed request, scope, timestamp/nonce, approval record, idempotency, failure handling. | SignalGrid requests; existing systems execute. |
| Human approval gates | Require operator or policy approval for higher-impact actions. | Role checks, approval workflow, escalation path, audit evidence. | No autonomous production remediation. |
| Rollback metadata | Capture enough context to support reversal or follow-up. | Previous state, expected rollback path, owner, timeout, ticket/audit link. | Rollback execution remains owned by the source system unless separately validated. |

The safe operating principle is: agents may suggest, SignalGrid evaluates, operators approve, existing systems execute, and SignalGrid records.

## DockBridge production path

DockBridge should progress through conservative stages:

| Stage | Goal | Evidence needed | Claim boundary |
| --- | --- | --- | --- |
| Simulated dock API | Prove that dock events can drive SignalGrid decisions. | Event schema, simulator, decision trace, operator/admin alert, audit record. | Software-only demo; no hardware or platform certification claim. |
| Event integrity | Prove events are authentic and replay-resistant enough for a controlled proof. | Signed webhook design, idempotency, timestamps, replay handling, logging. | Not production security certification. |
| Posture pairing | Connect dock event context to MDM/UEM posture and identity/session context. | Device ID mapping, compliance lookup, normalized posture signal, decision result. | MDM/UEM remains system of record. |
| Operator workflow | Validate review, exception, deny, ticket, and audit actions. | Operator mobile/admin flow, role checks, evidence capture, rollback notes. | No autonomous production remediation. |
| Vendor adapter | Integrate one real dock/smart-cabinet/return-station vendor if warranted. | Vendor event mapping, test harness, failure handling, operational runbook. | No broad hardware certification or partner claim unless approved. |
| Hardware/certification review | Evaluate MFi or other hardware/platform requirements if Apple-connected accessories are built. | Qualified partner, hardware design, certification path, legal/platform review. | Future-facing only until certified. |

## Systems of record

SignalGrid should coordinate runtime decisions while preserving ownership boundaries:

- IAM/access-management systems own identity and authentication controls.
- MDM/UEM systems own device enrollment, compliance policy, device actions, and profile deployment.
- ITSM systems own ticket/change lifecycle and approval workflows.
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
