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
3. DockBridge simulated dock event API.
4. One dock/vendor adapter if the simulated workflow validates value.
5. MFi or hardware certification path only if Apple-connected hardware integration is required.
6. Imprivata/healthcare alliance path only if validated and mutually approved.

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
