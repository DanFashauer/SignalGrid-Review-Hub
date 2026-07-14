# Credential Reader Signal Model

## Purpose

This phase adds a public-safe, fixture-backed model for credential-reader events as a SignalGrid signal source. It treats badge, card, mobile credential, kiosk login, and passkey-adjacent reader observations as context that can be normalized, correlated, routed, audited, and verified without adding live integrations or source-system writes.

> **Now a core decision dimension.** The one-bit "who is bound to this shared
> device right now" read from the reader case is normalized into the core as the
> `badge_binding` signal category and the `badgeBinding` evidence field
> (`present` / `removed` / `forced` / `absent` / `unknown`). A badge pulled from
> the case restricts the live session; a forced/torn removal denies. This is the
> deterministic, evaluated-today slice of the richer reader model below — see
> [What SignalGrid Does Today](WHAT_SIGNALGRID_DOES_TODAY.md). The wider set of
> reader classes, credential types, and workflow contexts described in the rest of
> this document remain candidate signal-source patterns, not live integrations.

## Intake classification and merge lane

- Classification: `Credential/custody signal` and `Proof/scenario expansion` under the Intake Classification Guide.
- Risk lane: `YELLOW`, because this phase expands fixtures, deterministic connector-emulator scenarios, and proof guardrails.
- Merge policy: Yellow-lane work requires explicit human approval before merge. This PR should not be self-merged.

## Public-safe source patterns

- rf IDEAS-style badge and credential readers are candidate signal-source patterns only, not current integrations, partnerships, certifications, endorsements, or production-support claims.
- LocknCharge/FUYL-shaped locker, kiosk, identity, and custody workflows are candidate smart-locker/custody patterns only, not current integrations, partnerships, certifications, endorsements, or production-support claims.
- Apple Wallet employee badge and other mobile credential presentations are future credential-event patterns only, not current Apple integrations, certifications, partnerships, or production-support claims.

Existing IAM, PACS, MDM/UEM, locker, dock, kiosk, credential, and workflow platforms remain systems of record. SignalGrid normalizes public-safe signals, evaluates context, routes approved outcomes, audits evidence, and verifies expected results.

## Reader and credential classes

Credential-reader signals may come from public-safe examples of these pattern families:

- Prox card reader.
- RFID reader.
- NFC reader.
- Smart-card reader.
- BLE/mobile credential reader.
- Barcode or login-ID reader.
- Passkey/FIDO-adjacent presence or possession assertion.

These are modeled as normalized event patterns, not live hardware claims.

## Workflow contexts

The fixture-backed model covers shared and frontline contexts where possession, identity, custody, and device posture must be correlated:

- Shared workstation.
- Printer or release station.
- Kiosk.
- Smart locker or dock bay.
- Medication/cart workflow.
- Warehouse handheld workflow.
- Clinical or frontline shared-device workflow.

## Normalized fields

The connector-emulator credential-reader fixture uses these normalized fields:

| Field                      | Meaning                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `credentialReaderVendor`   | Synthetic vendor-pattern label; no real vendor identifier in fixtures.                                  |
| `credentialReaderModel`    | Synthetic reader model label.                                                                           |
| `credentialReaderClass`    | Reader class such as badge, kiosk, locker, or mobile credential pattern.                                |
| `credentialTechnology`     | Prox, RFID, NFC, smart card, BLE/mobile credential, barcode/login ID, or passkey/FIDO-adjacent pattern. |
| `credentialType`           | Synthetic credential category.                                                                          |
| `readerConnectionType`     | USB, network, serial, embedded, kiosk, or other pattern label.                                          |
| `readerLocation`           | Synthetic location placeholder.                                                                         |
| `readerPurpose`            | Shared-device, locker release, print release, kiosk, custody, or workflow purpose.                      |
| `credentialReadState`      | Valid, stale, failed, override requested, or unknown.                                                   |
| `credentialConfidence`     | High, medium, low, degraded, or unknown confidence.                                                     |
| `badgeEventObservedAt`     | Synthetic timestamp for deterministic proof behavior.                                                   |
| `actorResolved`            | Whether the credential event maps to a synthetic actor.                                                 |
| `identityCorrelationState` | Resolved, unresolved, or unknown identity correlation.                                                  |
| `custodyCorrelationState`  | Matched, mismatch, workflow mismatch, override requested, or unknown custody correlation.               |
| `workflowContext`          | Existing scenario workflow context used by shared proof logic.                                          |
| `deviceContext`            | Synthetic device/workstation/kiosk context.                                                             |
| `lockerOrDockState`        | Expected, wrong bay, unavailable, override requested, or unknown locker/dock state.                     |
| `apiHealth`                | Healthy, degraded, or unknown connector/API health.                                                     |
| `routeOwner`               | Synthetic owner category for routing.                                                                   |
| `severity`                 | Route severity.                                                                                         |
| `approvalRequired`         | Whether the outcome requires explicit approval.                                                         |
| `verificationExpectation`  | Expected verification step after routing or approval.                                                   |

## Decision examples

- Valid badge read + resolved identity + compliant shared device + expected locker bay = `allowCandidate` with audit evidence only.
- Badge read succeeds but identity cannot be resolved = `stepUp` and route identity owner.
- Valid identity + wrong locker bay or custody zone = `restrict` and route custody alert.
- Stale reader event + active session = `stepUp` and route operations owner.
- Mobile credential presented + reader/API health degraded = degraded confidence and route integration owner.
- Badge event mismatch with workflow assignment = `restrict` and route workflow owner.
- High-risk device release or custody override = `approvalRequired` with `simulatedFirst=true`.

## Proof guardrails

The connector-emulator proof validates that unresolved identity, degraded reader/API health, custody mismatch, and high-risk custody override scenarios cannot produce plain allow outcomes. It also verifies every route includes owner category, severity, destination placeholder, and verification expectation, then emits a deterministic result hash.
