# Intune / Entra Posture Proof

This document defines the first concrete proof plan for SignalGrid consuming Microsoft Intune / Entra device posture context and turning it into a normalized runtime decision input. It is documentation-first and proof-of-concept only.

## 1. Objective

Prove SignalGrid can consume Microsoft device and compliance context from a sandbox or fake-data Intune / Entra path, normalize that context into a SignalGrid posture signal, and use it as a runtime decision input for access outcomes.

The proof should show the full evidence chain:

```text
Device ID
  -> Intune / Entra compliance lookup
  -> normalized posture signal
  -> SignalGrid decision input
  -> allow / step-up / deny / unknown
  -> audit record
```

## 2. Scope

This proof is intentionally narrow.

### In scope

- A proof-of-concept posture lookup design.
- Sandbox, fake, or deterministic sample payloads only.
- Normalization from Microsoft device/compliance context into a SignalGrid posture model.
- Decision mapping from normalized posture into candidate outcomes.
- Audit evidence design for the lookup, normalized posture, outcome, and reason code.
- Failure-mode documentation for missing, stale, denied, malformed, or unknown posture.

### Out of scope

- No production rollout.
- No customer data.
- No real tenant secrets committed to the repository.
- No compliance, security certification, or regulatory claim.
- No claim that SignalGrid replaces Microsoft Intune, Microsoft Entra, Conditional Access, IAM, UEM, MDM, SIEM, ITSM, NAC, or endpoint tooling.
- No autonomous remediation.
- No production device actions, policy changes, wipe, lock, retire, or profile deployment.

## 3. Target flow

| Step | Owner | Proof behavior | Boundary |
| --- | --- | --- | --- |
| Device ID received | SignalGrid proof harness | Accept a placeholder device identifier from a request, fixture, or simulator. | Device identity mapping is a proof assumption until private-core implementation validates it. |
| Intune / Entra compliance lookup | Microsoft source system or deterministic fixture | Retrieve or simulate compliance state, management state, last check-in, platform, and assignment context. | Microsoft remains the system of record for device enrollment, compliance policy, identity, and directory context. |
| Normalize posture | SignalGrid | Convert the source response into a stable SignalGrid posture model. | Normalization does not override the source record. |
| Add decision input | SignalGrid | Attach normalized posture to the decision request context. | Posture is one input, not the whole policy engine. |
| Determine candidate outcome | SignalGrid | Map posture to allow, step-up, deny/restrict/review, or unknown candidate outcomes. | The proof documents decision logic but does not claim production enforcement. |
| Record audit evidence | SignalGrid | Store source, lookup time, normalized posture, outcome, reason code, and note context. | Audit record is proof evidence, not a compliance guarantee. |

## 4. Required inputs

The proof should run from a tenant/environment placeholder and deterministic inputs. Real credentials, customer identifiers, and customer device records must not be stored in the repo.

| Input | Description | Example placeholder | Required for proof |
| --- | --- | --- | --- |
| `environmentId` | Tenant, lab, or fixture namespace used to keep proof data scoped. | `sandbox-intune-tenant` | Yes |
| `deviceId` | Device identifier used for the lookup or fixture key. | `device-lab-001` | Yes |
| `complianceState` | Source compliance state. | `compliant`, `nonCompliant`, `unknown` | Yes |
| `managedState` | Whether the device is managed, unmanaged, retired, inactive, or unknown. | `managed` | Yes |
| `lastCheckInAt` | Last observed check-in from the source system. | `2026-06-03T12:00:00Z` | Yes |
| `platform` | OS/platform. | `iOS`, `Android`, `Windows`, `macOS` | Yes |
| `ownershipContext` | Ownership, assignment, group, shared-device, or user/device context if available. | `corporate-shared`, `assigned-frontline-pool` | Optional |
| `rawReference` | Non-secret pointer to the fixture, request ID, or source object reference. | `fixture:intune-device-lab-001` | Yes |

## 5. Normalized SignalGrid posture model

The normalized model should be small, deterministic, and source-system-neutral so later UEM/MDM proofs can reuse it.

| Field | Type | Purpose |
| --- | --- | --- |
| `deviceId` | string | Stable device identifier used by the proof flow. |
| `sourceSystem` | string | Source that supplied posture, such as `microsoft-intune-entra-fixture` or a future approved Microsoft connector name. |
| `managedState` | enum/string | Normalized management state such as `managed`, `unmanaged`, `retired`, `inactive`, or `unknown`. |
| `complianceState` | enum/string | Normalized compliance state such as `compliant`, `non_compliant`, `unknown`, or `not_applicable`. |
| `postureFreshness` | object/string | Freshness classification derived from `lastCheckInAt`, such as `fresh`, `stale`, `expired`, or `unknown`. |
| `riskIndicators` | array | Normalized risk hints, such as `non_compliant`, `stale_check_in`, `unmanaged_device`, `missing_device`, or `source_lookup_failed`. |
| `observedAt` | timestamp | Time the source posture was observed or simulated. |
| `rawReference` | string | Non-secret pointer to the raw fixture, source request, or source object reference. |
| `confidence` | enum/string | Signal confidence such as `high`, `medium`, `low`, or `unknown` based on source quality and freshness. |
| `decisionImpact` | enum/string | Intended policy effect such as `allow_candidate`, `step_up_or_review_candidate`, `deny_or_restrict_candidate`, or `unknown_posture`. |

### Example normalized posture fixture

```json
{
  "deviceId": "device-lab-001",
  "sourceSystem": "microsoft-intune-entra-fixture",
  "managedState": "managed",
  "complianceState": "compliant",
  "postureFreshness": "fresh",
  "riskIndicators": [],
  "observedAt": "2026-06-03T12:00:00Z",
  "rawReference": "fixture:intune-device-lab-001",
  "confidence": "high",
  "decisionImpact": "allow_candidate"
}
```

## 6. Decision mapping

The proof should keep decision logic explicit and conservative.

| Normalized posture condition | Candidate outcome | Reason code | Notes |
| --- | --- | --- | --- |
| Device is managed, compliant, and fresh. | `allow_candidate` | `POSTURE_COMPLIANT_FRESH` | SignalGrid may treat the posture signal as eligible for allow, subject to identity, session, policy, and workflow context. |
| Device is non-compliant. | `deny_or_restrict_candidate` or `review_candidate` | `POSTURE_NON_COMPLIANT` | Use deny/restrict for high-risk workflows; use review where policy requires operator/admin judgment. |
| Device posture is stale, expired, or source freshness is unknown. | `step_up_or_review_candidate` or fail-closed | `POSTURE_STALE_OR_UNKNOWN` | Policy should define freshness windows and whether to fail closed for sensitive workflows. |
| Device is missing from the source lookup. | `unknown_posture` | `POSTURE_DEVICE_NOT_FOUND` | Unknown posture must not be represented as compliant. |
| Source lookup fails or returns malformed data. | `unknown_posture` or fail-closed | `POSTURE_SOURCE_LOOKUP_FAILED` | Record the failure mode and avoid overclaiming source visibility. |
| Device is unmanaged, retired, inactive, or not applicable. | `deny_or_restrict_candidate`, `review_candidate`, or `unknown_posture` | `POSTURE_NOT_MANAGED_OR_INACTIVE` | Exact outcome depends on workflow risk and source semantics. |

## 7. Audit record

The proof should record enough evidence for a reviewer to reconstruct the decision without storing secrets or customer data.

| Audit field | Description |
| --- | --- |
| `sourceSystem` | Microsoft fixture or future approved Microsoft source connector used for the lookup. |
| `lookupStartedAt` / `lookupCompletedAt` | Time range for the posture lookup or fixture read. |
| `deviceId` | Proof device identifier. |
| `normalizedPosture` | The normalized posture payload used as decision input. |
| `decisionOutcome` | Candidate outcome: allow, step-up, deny/restrict, review, or unknown. |
| `reasonCode` | Deterministic reason code from the mapping table. |
| `policyVersion` | Proof policy version or fixture mapping version. |
| `rawReference` | Non-secret pointer to source response, fixture, or request correlation ID. |
| `operatorOrAdminNote` | Optional note when review, exception, or admin interpretation is involved. |
| `failureMode` | Optional explicit error classification for lookup failure, stale data, malformed payload, or missing device. |

## 8. Future extensions

After the Microsoft posture proof is reviewed and grounded, the same normalized posture pattern can support:

- Jamf or broader UEM connector proof for Apple/shared-device posture.
- DockBridge event correlation, pairing dock state with device posture and identity/session context.
- Operator mobile alert when posture is stale, non-compliant, missing, or requires review.
- Configuration/profile remediation recommendation with approval, test ring, validation, and rollback guardrails.
- Imprivata candidate access workflow correlation if healthcare design partners validate the need and any integration path is mutually approved.
- SIEM/ITSM audit handoff for review tickets, evidence bundles, and exception tracking.

## 9. Validation checklist

Before presenting this proof as evidence, verify:

- [ ] Fake or sandbox data path is used.
- [ ] No production secrets are committed to the repository.
- [ ] No customer data is committed to the repository.
- [ ] Deterministic sample payloads cover compliant, non-compliant, stale, missing, and lookup-failure cases.
- [ ] Schema validation exists for source fixture payloads and normalized posture payloads.
- [ ] Failure modes are documented and deterministic.
- [ ] Unknown posture is never treated as compliant.
- [ ] Audit record includes source system, lookup time, normalized posture, decision outcome, reason code, and optional operator/admin note.
- [ ] No production-ready, compliance, customer deployment, replacement, partner, or certification claims are made.
- [ ] The proof preserves Microsoft Intune / Entra as the source of record for device/compliance context.

## Remaining proof gaps

- Select the exact sandbox or fake-data harness location in the private core or a future public-safe demo folder.
- Define the schema files and fixture names once implementation begins.
- Confirm authentication and least-privilege lookup design outside the public repo before any real Microsoft tenant is used.
- Decide the policy freshness window for each workflow class.
- Decide whether high-risk workflows fail closed or route to step-up/review when posture is stale or unknown.
