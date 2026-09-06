# Reason codes — the Assist gate's verdict vocabulary

Generated from the ENGINE by `node scripts/gen-reason-codes.mjs` (rule
tables, seeded active policy versions and resolution descriptors are read at
runtime via `scripts/src/dump-reason-truth.ts`; only the descriptor prose is
read from source text). Do not edit ANY cell by hand:
`scripts/check-reason-codes.mjs` requires byte equality with a fresh
generation, so every column is protected, not just the code names.

Under the embedded-UX law the verdict plus its reason codes ARE the product
surface: the host app renders the worker's message from them, so this catalog
is the contract a host-app developer builds against.

**40 codes** the decision core can emit: 28 reachable
through the launch evaluate surface, 5 only via the draft-policy
test route, 7 only through deferred routes. Worker/operator
language comes from the engine's own resolution descriptors; a code without a
descriptor is marked, because that gap is real behavior — the resolution
planner has no step to offer for such a code, and since 2026-09-02 it says so
instead of staying quiet (see the note below).

Tenant-authored policy rules may carry **custom reason codes** — the set is
open by construction (`policy.ts` pushes `rule.reasonCode` verbatim), which
is why the published API contract types `reasonCodes` as strings with this
catalog as the engine-emitted vocabulary, NOT a closed enum: an enum would
falsify the contract for every tenant with a custom rule.

## Launch-surface codes (an ACTIVE seeded policy or an engine-level push — reachable via `POST /v1/decisions/evaluate`)

| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |
|---|---|---|---|---|---|
| `ALLOW_SUPPRESSED_DEGRADED_EVIDENCE` | step_up | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `BADGE_FORCED_REMOVAL` | deny | manual_only | This device is locked out — the badge was forcibly removed. Use a different device and report it. | Out of service: forced badge removal / reader-case tamper — route to security operations; do not clear automatically. | `badge forced removal → deny` |
| `BADGE_REMOVED` | restrict | auto_proposed | Re-insert your badge into the reader case to re-bind it to this device, then retry. | Confirm the worker's badge is re-seated in the reader case, then re-evaluate. | `badge removed → restrict` |
| `BASELINE_DRIFTED` | step_up | auto_proposed | This device has drifted from its security baseline — return it to its dock or reconnect so the hardening profile re-applies, then retry. | Request a baseline (CIS/hardening) re-scan and profile re-apply from the endpoint-management source, then re-evaluate. | `baseline drift → step-up` |
| `BATTERY_CRITICAL` | step_up | auto_proposed | Battery is critically low — swap to a charged shared device, or dock this one before starting. | Direct the worker to a charged device; the low-battery device can keep charging in its bay. | — |
| `BATTERY_FAILING` | restrict | manual_only | This device's battery can no longer hold a shift — charging will not fix it. Use a different device and hand this one in. | Pull the device for battery replacement; it will keep failing on charge. Do not clear this by re-docking. | — |
| `BENCHMARK_SELECTION_MISFIT` | step_up | requires_approval | This device's hardening result was measured against the wrong benchmark. It needs a security owner — nothing you can do on the device changes it. | Assign the benchmark that matches this device's platform and this workflow's requirement, re-run the assessment, then re-evaluate. | `benchmark misfit → step-up (an 'aligned' answer from the wro` |
| `CRITICAL_WORKFLOW_UNTRUSTED_DEVICE` | deny | manual_only | This high-risk workflow requires a managed, trusted device — switch to one to continue. | Advise the worker to use a managed shared device; do not grant this workflow on an untrusted device. | — |
| `CUSTODY_EXCEPTION` | restrict | requires_approval | A custody issue was flagged — an operator is reviewing the device's dock/bay status. | Review the custody exception (removed without a session?) and clear or route it. | — |
| `CUSTODY_MAINTENANCE` | restrict | requires_approval | This device is in maintenance — use a different device; an operator can release it from maintenance. | Confirm the device has completed maintenance and release it (check it back in), then re-evaluate. | `custody maintenance → restrict` |
| `CUSTODY_OVERDUE` | restrict | auto_proposed | Return the device to its dock or bay to check it back in, then retry. | Confirm the device is returned/checked in at its bay, then re-evaluate. | — |
| `DEVICE_NONCOMPLIANT` | restrict | requires_approval | Follow the on-device compliance prompt, or hand the device to IT to bring it back into compliance. | Approve a compliance remediation request to the device-management owner, then re-evaluate. | `non-compliant → restrict` |
| `DEVICE_UNMANAGED` | restrict | requires_approval | Use a managed shared device for this task, or enrol this device via the company portal. | Approve an enrolment request, or direct the worker to a managed device. | — |
| `DOCK_FAULTED` | restrict | requires_approval | The dock holding this device is faulted — an operator will move it to a healthy dock/bay before it can be used. | Move the device to a healthy SmartDock/bay to re-establish custody (and service the faulted dock), then re-evaluate. | `SmartDock faulted → restrict` |
| `DOCK_OFFLINE` | step_up | auto_proposed | This dock is offline — return the device to an online dock/bay to refresh its custody state, then retry. | Confirm the device is on an online SmartDock/bay (or reconnect the dock), then re-evaluate. | `SmartDock offline → step-up` |
| `ENCRYPTION_REQUIRED_FOR_WORKFLOW` | step_up | requires_approval | Wait for device encryption to be enforced before starting this workflow. | Approve an encryption-enforcement request for this device. | — |
| `IDENTITY_DISABLED` | deny | manual_only | Your account is disabled — contact your manager or IT to have it reviewed. | Route to the identity/access owner: the account is disabled and needs human review. | `disabled identity → deny` |
| `IDENTITY_STATE_UNKNOWN` | step_up | auto_proposed | Re-verify your identity (re-badge at the reader or re-authenticate), then retry. | Ask the worker to re-authenticate; confirm the identity source is reachable. | — |
| `LOCAL_AUTHORITY_WITHHELD` | restrict | requires_approval | This device's permission to act on its own was withdrawn by the control plane. Nothing on the device changes that — an operator has to re-verify its authority. | Re-issue the device's local-authority lease (verify its clock source and revocation state first), then re-evaluate. | `local authority withheld → restrict (the control plane revok` |
| `MANAGEMENT_HEALTH_BROKEN` | restrict | requires_approval | This device's management system has failed — its safety answers can't be trusted right now. Swap to a healthy device; an operator has to repair this one's enrollment. | Re-enroll the device in the management plane (or complete the failed enrollment), confirm a fresh check-in, then re-evaluate. | `management plane broken → restrict (a failed management plan` |
| `NO_RULE_MATCHED_DEFAULT_STEP_UP` | step_up | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `POSTURE_MISSING` | restrict | auto_proposed | Bring the device online and let it check in (dock or reconnect), then retry. | Request a posture check-in; if the device never reports, escalate to device operations. | `missing posture → restrict` |
| `POSTURE_STALE` | step_up | auto_proposed | Reconnect the device (or return it to its dock) to refresh its compliance check, then retry. | Request a posture re-sync from the device-management source, then re-evaluate. | `stale posture → step-up` |
| `SHIFT_CONTEXT_MISFIT` | step_up | requires_approval | The labor system does not show you on shift for this. Ask your supervisor to confirm your shift record — do not clock in to get past this. | Have the supervisor or workforce-management owner verify this worker's shift, punch state and site, correct the record if it is wrong, then re-evaluate. | `shift-context misfit → step-up (the labor plane disagrees wi` |
| `TAMPER_CONFIRMED` | deny | manual_only | This device is out of service (tamper confirmed) — use a different device and report it. | Remove the device from service and route to security operations; do not clear automatically. | — |
| `TAMPER_SENSOR_UNAVAILABLE` | step_up | requires_approval | This device's tamper sensor isn't reporting — an operator will confirm the device is intact before it can be used. | Physically confirm the device is intact (or move it to a dock with a working tamper sensor), then approve to clear. | `tamper sensor unavailable → step-up (no fail-open)` |
| `TAMPER_SUSPECTED` | restrict | requires_approval | This device is flagged for a physical check — an operator will inspect it before it can be used. | Inspect the device for tamper; approve to clear only after physical inspection. | — |
| `TRUST_ESTABLISHED` | allow | *(none)* | *(an allow carries no resolution step)* | — | `healthy → allow` |

## Draft-policy codes (v2 strict rules — reachable ONLY via `GET /v1/policies/{id}/tests?versionId=…`, a launch route; `evaluate` resolves the active version and cannot emit these)

The v2 strict rule set is seeded as a **draft** in every tenant, and both
routes that could activate it are deferred under the launch profile — so
these codes surface exclusively through the policy-test route, never on a
live decision.

| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |
|---|---|---|---|---|---|
| `BASELINE_DRIFTED_STRICT` | restrict (v2 draft) | requires_approval | This device drifted from its security baseline and needs review before this workflow — an operator will re-apply the hardening profile. | Approve a baseline re-apply (CIS/hardening profile) for this device, then re-evaluate. | — |
| `BENCHMARK_SELECTION_UNESTABLISHED_STRICT` | step_up (v2 draft) | requires_approval | This device's benchmark selection has not been established, and this workflow requires it. A security owner has to confirm which benchmark applies. | Establish the applicable benchmark for this platform (the strict policy will not accept an unverified selection), then re-evaluate. | — |
| `IDENTITY_STATE_UNKNOWN_STRICT` | deny (v2 draft) | auto_proposed | Re-verify your identity (re-badge at the reader or re-authenticate), then retry. | Ask the worker to re-authenticate; confirm the identity source is reachable. | — |
| `POSTURE_STALE_STRICT` | restrict (v2 draft) | auto_proposed | Reconnect the device (or return it to its dock) to refresh its compliance check, then retry. | Request a posture re-sync from the device-management source, then re-evaluate. | — |
| `SHIFT_CONTEXT_UNESTABLISHED_STRICT` | step_up (v2 draft) | requires_approval | Your shift could not be confirmed, and this workflow requires it. Ask your supervisor to confirm your shift record. | Establish the labor-plane answer for this worker (the strict policy will not accept an unverified shift), then re-evaluate. | — |

## Deferred-path codes (emitted only by deferred routes)

Minted by `POST /v1/decisions/reconcile` (continuity) and the resolution
planner's battery assessment (`/v1/decisions/{id}/resolution`, `/resolve`) —
all outside the launch profile's GA allowlist. Catalogued so a host app that
later adopts those routes has the contract, and partitioned so nobody reads
them as launch surface.

| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |
|---|---|---|---|---|---|
| `NEWER_PROVENANCE_RELAXED_STALE_DECISION` | — | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `OFFLINE_AUTHORITY_CANNOT_RELAX` | — | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `OFFLINE_STANDING_AGE_UNSTATED` | step_up | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `OFFLINE_STANDING_BOUND_EXCEEDED` | step_up | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `PROVENANCE_CONTESTED_FAIL_CLOSED` | — | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `PROVENANCE_UNIFORM_ACROSS_RECORDS` | — | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |
| `SUPERSEDED_POLICY_AUTHORITY_CANNOT_RELAX` | — | *(none)* | *(no resolution descriptor — no step; the plan carries it in `unresolvedCodes` and escalates, see the note below)* | — | — |

## The descriptor gap, stated

10 of 40 codes have no resolution descriptor, so
`buildResolutionPlan` has no STEP to offer for them. What changed on
2026-09-02 (verdict-core finding V9) is that it no longer stays quiet about it.

Before: a descriptor-less code was skipped and left no trace, so a DENY carrying
only such codes came back with `path: "self_service"` — the wrong word for a
block nobody can clear. (`autoResolvable` was already false in that case, because
it requires at least one step; the role-lens review's phrasing that it reported
"self-service AND auto-resolvable" was half right, and the half that was wrong is
corrected here rather than repeated.)

Now: the plan carries `unresolvedCodes: string[]` — the codes on a non-allow
decision that have no descriptor — and while that list is non-empty the plan is
`path: "escalation"`, `autoResolvable: false`, and `summaryForOperator` names
the codes. A code contributed by a rule whose own outcome was `allow`
(`TRUST_ESTABLISHED` rides along on most restrict/step-up decisions) is an
affirmative finding, not an unanswered block, and is excluded — derived from the
decision's own `matchedRules`, not from a list anyone maintains. The exclusion is
keyed on the CONTRIBUTING RULE, not on the code's spelling: reason codes are not
unique to a rule, so one allow rule sharing a code with a deny rule would otherwise
have disappeared the deny's own unanswerable block. Both pinned by
`pnpm run proof:signalgrid-core`.

Host apps should still render the VERDICT as the primary signal: a plan with
unresolved codes tells the worker a person is needed, not what to do.

## Published fields with no in-repo reader (REPORTED, measured 2026-09-02)

Four fields are serialized onto `/v1` responses and read by nothing in this
repository. That is not a defect — a published contract may legitimately have no
in-repo consumer — but it means NO in-repo test constrains their content, so a
change to any of them breaks only the host app that depends on it. Stated so a
host-app developer knows which fields are unexercised here.

Measured, not assumed, with (results quoted after each field):

```
grep -rn "\b<field>\b" --include=*.ts --include=*.tsx --include=*.mjs --include=*.swift \
  lib scripts artifacts native tests tools site | grep -v node_modules
```

| Field | Declared | Minted | In-repo reader |
|---|---|---|---|
| `SignalGridDecision.confidence` (simulator) | `lib/signalgrid-simulator/src/types.ts:150` | `lib/signalgrid-simulator/src/decisionEngine.ts:292` | none — `scripts/src/signalgrid-grid-proof.ts:988` COPIES it into an output object and asserts nothing about it |
| `ResolutionPlan.summaryForOperator` | `lib/signalgrid-core/src/types.ts` | `lib/signalgrid-core/src/resolution.ts` | one, added 2026-09-02: `scripts/src/signalgrid-core-proof.ts` asserts it NAMES an unresolved reason code. Nothing reads the rest of the sentence |
| `ResolutionSimulation.projectedReasonCodes` | `lib/signalgrid-core/src/types.ts` | `lib/signalgrid-core/src/resolution.ts` | none — declaration and mint site only |
| `ResolutionStep.clears` | `lib/signalgrid-core/src/types.ts` | `lib/signalgrid-core/src/resolution.ts` | none — every other `clears` match in the tree is unrelated prose |

REPORTED, not gated: this is a measurement with a date on it, not an invariant. A
reader added tomorrow does not fail anything; re-run the command above rather than
trusting this table's age.

## Simulator vocabulary — a DIFFERENT engine's codes, catalogued so nobody reads them as the core's

The tables above are the **launch decision core** (`lib/signalgrid-core`). The
**fixture simulator** surface — the engine `lib/signalgrid-simulator/src/decisionEngine.ts` plus the
remediation-allow wrapper `lib/signalgrid-simulator/src/remediation-allow.ts` and the posture-allow
wrapper `lib/signalgrid-simulator/src/posture-allow.ts` — is a second, separate
decision path. Together they emit 31 reason codes. 2 of them the core also emits
(`CUSTODY_EXCEPTION`, `POSTURE_STALE`); the other 29
appear nowhere above. The lists are parsed from those files by this generator —
the engine's emit sites and each wrapper's declared reason array
(`REMEDIATION_ALLOW_REASONS`, `POSTURE_ALLOW_REASONS`) — not maintained by hand. Several of them name **deferred** families
(custody, dock, location) — the simulator is a fixture harness, so it models
families the launch profile does not serve.

**GATED:** that this list is complete, that it parses, and that no simulator code
collides with a core code by punctuation/case/underscore alone
(`scripts/check-reason-codes.mjs`). **REPORTED, not gated:** everything about what
these codes MEAN. No `/v1` route emits them — they are not part of the published
API vocabulary, and a host app must not build against them as if they were.

They are also not renameable at will: `native/ios/EnterpriseShell/Services/DecisionEngine.swift`
is a byte-faithful port of the simulator engine (CLAUDE.md golden rule 1), so the
iOS app's reason codes ARE these spellings. Aligning them with the core's would
break the parity the port exists to prove. The wrapper's eight codes have the same
constraint by a different mechanism: `native/ios/EnterpriseShell/Services/RemediationAllow.swift`
is held to the wrapper by the shared vector table and `scripts/check-remediation-allow-conformance.mjs`,
so the spellings are a contract there too.

The 29 the core never emits — none of them a launch
surface, and the custody/dock/location ones name **deferred** families:
- `ALLOW_REMOVED_DUE_TO_CUSTODY_FAILURE` — simulator/iOS only
- `ALLOW_REMOVED_DUE_TO_HIGHER_RISK` — simulator/iOS only
- `ALLOW_WITHHELD_CONCURRENT_FAILURE` — simulator/iOS only
- `ALLOW_WITHHELD_POSTURE_ILLEGIBLE` — simulator/iOS only
- `ALLOW_WITHHELD_POSTURE_UNAFFIRMED` — simulator/iOS only
- `APPLE_DECLARED_STATE_TRUSTED` — simulator/iOS only
- `BATTERY_WORKFLOW_RISK` — simulator/iOS only
- `DEVICE_NON_COMPLIANT` — simulator/iOS only
- `DEVICE_TRUST_FAILURE` — simulator/iOS only
- `DOCK_EXCEPTION` — simulator/iOS only
- `IDENTITY_AND_POSTURE_TRUSTED` — simulator/iOS only
- `IDENTITY_INTEGRITY_FAILURE` — simulator/iOS only
- `INTEGRATION_ROUTE_DEGRADED` — simulator/iOS only
- `LOCATION_EXCEPTION` — simulator/iOS only
- `OPERATIONAL_HEALTH_DEGRADED` — simulator/iOS only
- `POSTURE_ABSENT` — simulator/iOS only
- `POSTURE_AFFIRMED` — simulator/iOS only
- `POSTURE_ILLEGIBLE` — simulator/iOS only
- `POSTURE_UNAFFIRMED` — simulator/iOS only
- `REMEDIATION_ABSENT_WHERE_REQUIRED` — simulator/iOS only
- `REMEDIATION_EVIDENCE_STALE` — simulator/iOS only
- `REMEDIATION_NOT_REQUIRED` — simulator/iOS only
- `REMEDIATION_RECORDED_NOT_VERIFIED` — simulator/iOS only
- `REMEDIATION_STATE_ILLEGIBLE` — simulator/iOS only
- `REMEDIATION_VERIFICATION_FAILED` — simulator/iOS only
- `REMEDIATION_VERIFIED` — simulator/iOS only
- `SECURITY_RISK_ESCALATION` — simulator/iOS only
- `STATE_FRESHNESS_FAILURE` — simulator/iOS only
- `WORKFLOW_ROUTE_UNAVAILABLE` — simulator/iOS only

**Near-collisions found (1) — one concept, two spellings, two engines:**

- `DEVICE_NON_COMPLIANT` (simulator/iOS) vs `DEVICE_NONCOMPLIANT` (core) — the gate carries a NAMED exemption for this pair or fails on it; see `scripts/check-reason-codes.mjs`.

## History

The previous mapping (`docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md` §2.1/§2.2,
now corrected) named four codes the engine has never emitted —
DEVICE_POSTURE_STALE, IDENTITY_UNVERIFIED, WRONG_BAY_OR_CUSTODY,
CRITICAL_ON_UNTRUSTED_DEVICE — absence corroborated four ways per code via
`pnpm run check:absence` (the real counterparts are `POSTURE_STALE` and
`CRITICAL_WORKFLOW_UNTRUSTED_DEVICE`). A design partner implementing that
table would have shipped messages that never fire. The first generated
version of THIS catalog then under-counted by two (a ternary emit shape the
parser missed — OFFLINE_STANDING_AGE_UNSTATED and
OFFLINE_STANDING_BOUND_EXCEEDED) and mis-partitioned the five `*_STRICT`
draft codes as evaluate-reachable; the org's assurance review caught both,
and the generator now reads the engine instead of regexing near it.
