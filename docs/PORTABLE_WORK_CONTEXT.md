# Portable Work Context Schema

> **Canonical source:** [Issue #136 — Define portable work context and adaptive
> Grid Intelligence vision](https://github.com/DanFashauer/SignalGrid-Review-Hub/issues/136),
> the owner-authored governing artifact. This document is the repo-side schema for
> its first acceptance criterion: *a documented portable work-context schema
> exists.* Where the two disagree, #136 states the destination and this file
> states the present.

This document defines the vendor-neutral, public-safe schema for the context that
follows a verified person between authorized shared devices. It is implemented as
`@workspace/work-context` (`lib/work-context/src/`) with deterministic fixtures and
a machine-checked proof. It does not implement identity verification, device
enrollment, live API calls, or production workflows.

The one-sentence semantic, from #136: the same verified person receives a
consistent, role-appropriate experience across authorized devices **without
copying access everywhere** — continuity carries the WORK, and trust is
re-evaluated per device through the fabric's real signal composition
(`composeDeviceRisk` in `@workspace/posture-composition`).

## Descriptive, never permissive

Every reference in this schema is an **opaque string** — a handle a system of
record can dereference, never a value that *is* the thing. Presenting a portable
work context to any endpoint grants nothing: it tells the next device what work to
surface and what trust floor to re-prove, and the device's own signals do the
rest. No credential, token, session cookie, or grant material of any kind may
appear anywhere in the schema, and that discipline is machine-checked rather than
commented: `assembleWorkContext` sweeps every input string against a credential
denylist (JWT prefixes, `Bearer ` strings, `sk_` secret-key prefixes, PEM block
headers, AWS access key ids, credentials embedded in URLs) and REFUSES the whole
assembly with a typed error naming the field path and the smell family. The
refusal never echoes the offending value — an error that repeats a secret is a
second leak. The denylist's limits are stated rather than hidden: nothing
syntactic can catch an arbitrary opaque secret; the structural guarantee stays
with the schema (no field whose *meaning* is a credential), and the sweep is
defence in depth against the field-misuse path.

## Schema, field by field

### `subject` — who the context follows

| Field | Type | Description |
| --- | --- | --- |
| `personRef` | string | Opaque handle for the verified physical person. Badge/face/finger happened at a reader; the PACS performed the match; this names the resulting identity. Never a biometric, never an assertion. |
| `tenantId` | string | Tenant the context belongs to; a context is never valid across tenants. |
| `role` | string | Role label driving the role-appropriate experience (which app catalog, which workflow templates) — a description of what to show, never of what to allow. |
| `shiftRef` | string \| null | Opaque shift handle, when a scheduling system contributed one. |
| `assignmentRef` | string \| null | Opaque assignment handle (the WMS wave, the unit assignment), when known. |

### `work` — where the work stands (the part continuity carries)

| Field | Type | Description |
| --- | --- | --- |
| `workflowKey` | string | The `app-workflows` catalog key of the workflow the person is inside. |
| `activeTaskRefs` | string[] | Opaque handles for tasks in flight — what the next device surfaces first. The execution system stays system of record. |
| `heldTaskRefs` | string[] | Tasks HELD in the execution system. A hold is an operator action on the task, not an exception about the work — but it must not vanish in a handoff, or the hold silently becomes a loss. |
| `unresolvedExceptionRefs` | string[] | Open task-exception records travelling with the work, each entry `<TaskExceptionReasonCode>:<opaque exception ref>` (e.g. `INVENTORY_EXCEPTION_ACTIVE:exc-0007`). The class comes from the task-exception dimension's reason-code vocabulary; the ref names the record in the execution system without copying it. These TRAVEL — no movement between devices may drop one. |
| `appCatalogKeys` | string[] | Which apps compose the role-appropriate experience. Catalog keys — what to render, never what to authorize. |

### `situation` — where the person and their equipment last were

| Field | Type | Description |
| --- | --- | --- |
| `lastKnownZoneRef` | string \| null | Opaque zone handle from the location dimension, when contributed. |
| `custodyRefs` | string[] | Opaque custody-record handles (which case, which dock bay, which cart) from the physical-custody dimension. |

### `trust` — the carried floor, never a grant

| Field | Type | Description |
| --- | --- | --- |
| `requiredStepUpLevel` | enum | `none` \| `step_up` \| `restrict` — an ordinal on the fabric's unified action ladder: the MINIMUM that must be re-proven on ANY device before this context's work resumes. A deliberate subset of the eight-rung ladder: the other rungs describe what to do about a device right now, not levels a person can re-prove. Full-ladder actions project fail-safe (`alert` → `step_up`, `escalate` → `restrict`). It is a ceiling on permissiveness: a device may always be judged worse by its own signals, never better. |
| `activeRestrictions` | string[] | Reason codes of confirmed restrict-grade findings travelling with the work (e.g. `TASK_ASSIGNMENT_MISMATCH`). Confirmed facts, not gaps — the fabric grades unknowns `step_up`, so a gap raises the ceiling instead of landing here. Removed only by `clearRestriction` with a resolution ref. |
| `policyVersionRef` | string | Opaque handle naming the policy version the conclusions were drawn under, so a consumer can tell a stale-policy context from a fresh one without the schema carrying policy. |
| `lastVerdictRef` | string | Opaque handle to the most recent sealed verdict that fed this context. The verdict-attestation layer owns the verdict; this only names it. |

### `provenance` — how this context came to be

| Field | Type | Description |
| --- | --- | --- |
| `assembledAtRef` | string | Opaque MONOTONIC assembly ref (a sequence handle such as `asm-000123`), deliberately NOT a wall-clock: two assemblies from identical inputs must be byte-identical, and a timestamp would make determinism unprovable. Ordering questions belong to the system that mints the refs. |
| `sourceVerdictRefs` | string[] | Every verdict the context was assembled from, oldest first. A context assembled from zero verdicts is refused — an assertion with no provenance is not a context. |
| `contextVersion` | number | Monotone counter, +1 on every reevaluation or resolution, so any consumer can reject a stale copy without comparing bodies. |

## Example fixture context

```json
{
  "subject": { "personRef": "person-0001", "tenantId": "tenant-alpha", "role": "picker", "shiftRef": "shift-0400", "assignmentRef": "wave-0092" },
  "work": {
    "workflowKey": "warehouse-inbound-putaway",
    "activeTaskRefs": ["task-0107", "task-0108"],
    "heldTaskRefs": ["task-held-0031"],
    "unresolvedExceptionRefs": ["INVENTORY_EXCEPTION_ACTIVE:exc-0007"],
    "appCatalogKeys": ["wms-client", "scan-verify"]
  },
  "situation": { "lastKnownZoneRef": "zone-inbound-03", "custodyRefs": ["custody-case-0044"] },
  "trust": {
    "requiredStepUpLevel": "step_up",
    "activeRestrictions": [],
    "policyVersionRef": "policy-v14",
    "lastVerdictRef": "vrd-0002"
  },
  "provenance": { "assembledAtRef": "asm-000123", "sourceVerdictRefs": ["vrd-0001", "vrd-0002"], "contextVersion": 1 }
}
```

## The three monotone invariants

Proved by `pnpm run proof:work-context` (50 checks), which enumerates them over a
deterministic matrix — every context ceiling {`none`, `step_up`, `restrict`}, with
and without carried exceptions/restrictions, against device compositions spanning
every rung of the unified ladder (the empty grid included), composed through the
real `composeDeviceRisk`. The proof prints its live figures
(`figures=matrix=54,monotonePairs=222,widenings=0,floorViolations=0,ceilingDrops=0,carryDrops=0`)
so a stale quote of them is catchable.

1. **Continuity never widens.** For a fixed context, a device composition with a
   worse tier never yields a more permissive final decision:
   `finalRequiredAction = worst(device-composed action, carried ceiling)`, checked
   pairwise across the full matrix (222 ordered device pairs, zero widenings).
   Carrying the context saved the person's work; it saved them nothing on trust.
2. **The ceiling never lowers by movement.** Across every reevaluation,
   `nextContext.trust.requiredStepUpLevel >= context.trust.requiredStepUpLevel`.
   Movement can raise the floor the next device must re-prove; only the explicit
   `lowerTrustCeiling` call lowers it, and that call demands a non-empty
   `resolutionRef` (and refuses to raise — an escalation cannot be laundered
   through the audit trail of a resolution).
3. **Exceptions travel.** `unresolvedExceptionRefs` and `activeRestrictions` in
   every next context are supersets of the input's, across the whole matrix.
   `resolveException` / `clearRestriction` remove exactly the named entry, against
   a non-empty `resolutionRef`, and refuse an entry the context does not carry —
   a silent no-op is how a retried call "resolves" the wrong exception.

The same proof pins the handoff semantic with two fixtures — a warehouse shared
handheld → shared workstation, and a healthcare shared iPad → a different iPad:
same person and work on both devices, work sections byte-identical, decision
strictly stricter on the worse device, and a held task plus an open inventory
exception visibly present in both contexts. Contexts are immutable (deep-frozen;
structurally compared before/after reevaluation) and every operation is
deterministic.

## API contract (documented, deliberately not implemented here)

**Contract documented here; the serving endpoint belongs to the private-core
wedge (Issue #136 sequence step 3) and is deliberately NOT implemented in this
public repo.** No route in this repository serves it, and nothing here should be
read as implying a live surface.

A candidate read-only shape, for design-partner discussion:

```
GET /v1/work-context/{personRef}
Authorization: caller-scoped, read-only; tenant derived from the caller, never from the path
```

Response `200`:

```json
{
  "context": { "...": "a PortableWorkContext exactly as specified above" },
  "attestationRef": "vrd-attest-0021"
}
```

- The response body is the schema above, unchanged — the contract IS the schema.
- Read-only: no POST/PUT/PATCH/DELETE is part of this contract. Resolution calls
  (`resolveException`, `clearRestriction`, `lowerTrustCeiling`) are library
  operations invoked by the decision plane against referenced resolutions, not a
  public write surface.
- `404` for an unknown `personRef` within the caller's tenant; a cross-tenant
  `personRef` is `404`, never `403` — the existence of another tenant's context
  is itself information.
- The response must never carry credentials, tokens, or grant material. The
  guarantee is the schema discipline itself — references and requirements only —
  with the assembly-time denylist as a defence-in-depth tripwire behind it. The
  denylist is deliberately NOT claimed as prevention: as the schema section
  above states, no syntactic check can recognize an arbitrary opaque secret, and
  adversarial review confirmed straightforward bypasses (homoglyphs, re-encoded
  tokens, unpatterned secrets). It catches the common accident, not the
  determined mistake.

## Public-safety boundaries

- Keep all examples deterministic and fixture-backed.
- Do not add real hardware calls, vendor API calls, customer locations, PHI, PII,
  live tenant identifiers, or credentials.
- Every ref in this schema is an opaque, sanitized handle; credential-smelling
  values are refused at assembly with a typed error, never carried or sanitized
  silently.
- Do not treat a carried context as authorization anywhere: it is descriptive,
  never permissive, and each device's trust is re-evaluated from that device's
  own signals through the fabric's composition.
- Keep approval gates explicit for any routed action; resolution calls require a
  resolution ref naming what closed the finding in its system of record.
- Treat identity, PACS, MDM/UEM, WMS/EMR execution systems, RTLS, and locker/dock
  platforms as independent systems of record; this schema names their records and
  never replaces them.
