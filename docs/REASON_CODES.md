# Reason codes — the Assist gate's verdict vocabulary

Generated from source by `node scripts/gen-reason-codes.mjs` — do not
hand-edit rows; `scripts/check-reason-codes.mjs` fails on drift in either
direction (a code the engine emits with no row here, or a row naming a code
no source emits). Under the embedded-UX law the verdict plus its reason
codes ARE the product surface: the host app renders the worker's message
from them, so this catalog is the contract a host-app developer builds
against.

**38 codes** the launch decision core can emit: 33
reachable through the launch surface, 5 only through
deferred routes. Worker/operator language comes from the engine's own
resolution descriptors (`lib/signalgrid-core/src/resolution.ts`); a code
without a descriptor is marked, because that gap is real behavior — the
resolution planner silently drops descriptor-less codes from its plan today
(role-lens review, engineering.2; tracked work).

Tenant-authored policy rules may carry **custom reason codes** — the set is
open by construction (`policy.ts` pushes `rule.reasonCode` verbatim), which
is why the published API contract types `reasonCodes` as strings with this
catalog as the engine-emitted vocabulary, NOT a closed enum: an enum would
falsify the contract for every tenant with a custom rule.

## Launch-surface codes (reachable via `POST /v1/decisions/evaluate`)

| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |
|---|---|---|---|---|---|
| `ALLOW_SUPPRESSED_DEGRADED_EVIDENCE` | — | *(none)* | *(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)* | — | — |
| `BADGE_FORCED_REMOVAL` | deny | manual_only | This device is locked out — the badge was forcibly removed. Use a different device and report it. | Out of service: forced badge removal / reader-case tamper — route to security operations; do not clear automatically. | `badge forced removal → deny` |
| `BADGE_REMOVED` | restrict | auto_proposed | Re-insert your badge into the reader case to re-bind it to this device, then retry. | Confirm the worker's badge is re-seated in the reader case, then re-evaluate. | `badge removed → restrict` |
| `BASELINE_DRIFTED` | step_up | auto_proposed | This device has drifted from its security baseline — return it to its dock or reconnect so the hardening profile re-applies, then retry. | Request a baseline (CIS/hardening) re-scan and profile re-apply from the endpoint-management source, then re-evaluate. | `baseline drift → step-up` |
| `BASELINE_DRIFTED_STRICT` | restrict | requires_approval | This device drifted from its security baseline and needs review before this workflow — an operator will re-apply the hardening profile. | Approve a baseline re-apply (CIS/hardening profile) for this device, then re-evaluate. | — |
| `BATTERY_CRITICAL` | step_up | auto_proposed | Battery is critically low — swap to a charged shared device, or dock this one before starting. | Direct the worker to a charged device; the low-battery device can keep charging in its bay. | — |
| `BATTERY_FAILING` | restrict | manual_only | This device's battery can no longer hold a shift — charging will not fix it. Use a different device and hand this one in. | Pull the device for battery replacement; it will keep failing on charge. Do not clear this by re-docking. | — |
| `BENCHMARK_SELECTION_MISFIT` | step_up | requires_approval | This device's hardening result was measured against the wrong benchmark. It needs a security owner — nothing you can do on the device changes it. | Assign the benchmark that matches this device's platform and this workflow's requirement, re-run the assessment, then re-evaluate. | `benchmark misfit → step-up (an 'aligned' answer from the wro` |
| `BENCHMARK_SELECTION_UNESTABLISHED_STRICT` | — | requires_approval | This device's benchmark selection has not been established, and this workflow requires it. A security owner has to confirm which benchmark applies. | Establish the applicable benchmark for this platform (the strict policy will not accept an unverified selection), then re-evaluate. | — |
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
| `IDENTITY_STATE_UNKNOWN_STRICT` | deny | auto_proposed | Re-verify your identity (re-badge at the reader or re-authenticate), then retry. | Ask the worker to re-authenticate; confirm the identity source is reachable. | — |
| `LOCAL_AUTHORITY_WITHHELD` | restrict | requires_approval | This device's permission to act on its own was withdrawn by the control plane. Nothing on the device changes that — an operator has to re-verify its authority. | Re-issue the device's local-authority lease (verify its clock source and revocation state first), then re-evaluate. | `local authority withheld → restrict (the control plane revok` |
| `MANAGEMENT_HEALTH_BROKEN` | restrict | requires_approval | This device's management system has failed — its safety answers can't be trusted right now. Swap to a healthy device; an operator has to repair this one's enrollment. | Re-enroll the device in the management plane (or complete the failed enrollment), confirm a fresh check-in, then re-evaluate. | `management plane broken → restrict (a failed management plan` |
| `NO_RULE_MATCHED_DEFAULT_STEP_UP` | — | *(none)* | *(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)* | — | — |
| `POSTURE_MISSING` | restrict | auto_proposed | Bring the device online and let it check in (dock or reconnect), then retry. | Request a posture check-in; if the device never reports, escalate to device operations. | `missing posture → restrict` |
| `POSTURE_STALE` | step_up | auto_proposed | Reconnect the device (or return it to its dock) to refresh its compliance check, then retry. | Request a posture re-sync from the device-management source, then re-evaluate. | `stale posture → step-up` |
| `POSTURE_STALE_STRICT` | restrict | auto_proposed | Reconnect the device (or return it to its dock) to refresh its compliance check, then retry. | Request a posture re-sync from the device-management source, then re-evaluate. | — |
| `SHIFT_CONTEXT_MISFIT` | step_up | requires_approval | The labor system does not show you on shift for this. Ask your supervisor to confirm your shift record — do not clock in to get past this. | Have the supervisor or workforce-management owner verify this worker's shift, punch state and site, correct the record if it is wrong, then re-evaluate. | `shift-context misfit → step-up (the labor plane disagrees wi` |
| `SHIFT_CONTEXT_UNESTABLISHED_STRICT` | — | requires_approval | Your shift could not be confirmed, and this workflow requires it. Ask your supervisor to confirm your shift record. | Establish the labor-plane answer for this worker (the strict policy will not accept an unverified shift), then re-evaluate. | — |
| `TAMPER_CONFIRMED` | deny | manual_only | This device is out of service (tamper confirmed) — use a different device and report it. | Remove the device from service and route to security operations; do not clear automatically. | — |
| `TAMPER_SENSOR_UNAVAILABLE` | step_up | requires_approval | This device's tamper sensor isn't reporting — an operator will confirm the device is intact before it can be used. | Physically confirm the device is intact (or move it to a dock with a working tamper sensor), then approve to clear. | `tamper sensor unavailable → step-up (no fail-open)` |
| `TAMPER_SUSPECTED` | restrict | requires_approval | This device is flagged for a physical check — an operator will inspect it before it can be used. | Inspect the device for tamper; approve to clear only after physical inspection. | — |
| `TRUST_ESTABLISHED` | allow | *(none)* | *(an allow carries no resolution step)* | — | `healthy → allow` |

## Deferred-path codes (emitted only by deferred routes)

These are minted by `POST /v1/decisions/reconcile` (continuity) and the
resolution planner's battery assessment (`/v1/decisions/{id}/resolution`,
`/resolve`) — all outside the launch profile's GA allowlist. They are real
engine vocabulary, catalogued so a host app that later adopts those routes
has the contract, and partitioned so nobody reads them as launch surface.

| Code | Verdicts | Resolution class | Worker-facing action | Operator-facing action | Fixture |
|---|---|---|---|---|---|
| `NEWER_PROVENANCE_RELAXED_STALE_DECISION` | — | *(none)* | *(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)* | — | — |
| `OFFLINE_AUTHORITY_CANNOT_RELAX` | — | *(none)* | *(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)* | — | — |
| `PROVENANCE_CONTESTED_FAIL_CLOSED` | — | *(none)* | *(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)* | — | — |
| `PROVENANCE_UNIFORM_ACROSS_RECORDS` | — | *(none)* | *(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)* | — | — |
| `SUPERSEDED_POLICY_AUTHORITY_CANNOT_RELAX` | — | *(none)* | *(no resolution descriptor — this code silently drops out of the resolution plan today; see the note below)* | — | — |

## The descriptor gap, stated

8 of 38 codes have no resolution descriptor. For
those, `buildResolutionPlan` silently omits the code from the plan — a
DENY carrying only descriptor-less codes reports itself self-service and
auto-resolvable (executed counterexample in the role-lens review,
engineering.2). Until that is fixed, host apps must render the VERDICT as
the primary signal and treat the resolution plan as advisory.

## History

The previous mapping (`docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md` §2.1/§2.2,
now corrected) named four codes the engine has never emitted —
DEVICE_POSTURE_STALE, IDENTITY_UNVERIFIED, WRONG_BAY_OR_CUSTODY,
CRITICAL_ON_UNTRUSTED_DEVICE — absence corroborated four ways per code via
`pnpm run check:absence` (the real counterparts are `POSTURE_STALE` and
`CRITICAL_WORKFLOW_UNTRUSTED_DEVICE`). A design partner implementing that
table would have shipped messages that never fire.
