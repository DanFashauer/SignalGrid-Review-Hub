# Data retention and personal data — the position, per store

Status: **ratified position document** (compliance lens, role-lens review 2026-08-21,
finding compliance.1). This is the single surface every retention or personal-data
claim must resolve to. `scripts/check-retention-claims.mjs` holds the buyer- and
assessor-facing surfaces against it.

## The one-paragraph truth

**No retention, deletion, or purge mechanism is implemented in any durable store
today.** The absence was probed four ways (`pnpm run check:absence retention` →
INCONCLUSIVE with three matches, each read: the former Pricing.tsx claim itself, an
unrelated location-services catalogue field, and a comment in
`lib/persistence/src/decision-store.ts:6`) and confirmed structurally: no table
carries a lifecycle column, no code path issues DELETE against a durable store, and
the runtime credential is **denied DELETE** on `decisions` and `audit_ledger` by the
role split (`scripts/src/db-role-split-proof.ts` proves the denial live). Honouring
any retention promise therefore requires an admin-credential job that has not been
designed. DR-003's 90-day figure is the **intended** default, not an implemented
one. No data-subject-request (DSAR) procedure exists.

Session **expiry** exists, is enforced LAZILY, and is not retention: the API
answers with `expired` for a lapsed session, but the stored `status` is only
rewritten when that session is next read (`withExpiry` inside
`PostgresSessionStore.get()`, `lib/persistence/src/session-store.ts`) — no
timer or database job touches an unread row, so a direct database report can
show `status = 'active'` indefinitely after `expires_at`. Either way the row
persists — expiry ends a session's validity, it deletes nothing.

## Per-store inventory

SignalGrid's **own** fields are pseudonymous by design: stores carry references
(`identity_ref`, `device_ref`), never names, and the mapping from a ref to a person
lives in the customer's IdP/MDM, not here. Under GDPR-style definitions a
pseudonymous ref is still personal data, so the fields are named honestly below.

**One field breaks the pseudonymity-by-design claim and must be stated:**
`requestContext` on `/v1/decisions/evaluate` (and `/v1/authorize`) is caller-supplied
free text — up to 32 string entries with pattern-valid keys, each at most 256
characters (an over-long value is dropped, not truncated — a truncated identifier is
still an identifier), survive `sanitizeContext` in
`artifacts/api-server/src/routes/v1.ts` and are serialized whole into
`decisions.data`. The cap keeps a pasted record out; it does not make a reference
erasable. A host app that sends `{userEmail: "person@example.com"}`
has put a name-equivalent into a durable store with no deletion path.
SignalGrid cannot prevent this by design today; integration guidance must tell
host apps to send references, not identifiers, and constraining or redacting
the field is open hardening work.

| Store | Defined at | What it holds | Personal-data-capable fields | Purpose | Retention state |
| --- | --- | --- | --- | --- | --- |
| `decisions` | `lib/persistence/migrations/001_decisions.sql:6-13` | One row per Assist decision; `data` JSONB is the full serialized Decision (`lib/persistence/src/decision-store.ts:165-169`) | top-level `data.identityId` and `data.deviceId` in the serialized Decision (`Decision.requestContext` in `lib/signalgrid-core/src/types.ts`), plus caller-supplied `data.requestContext.*`; reason codes and rule ids | Decision audit and reconciliation | **Unwritten** — no lifecycle column, no purge path, runtime role denied DELETE |
| `evidence_snapshots` | `lib/persistence/migrations/001_decisions.sql:15-21` | The evidence a decision was computed from; `data` JSONB is the full snapshot (`decision-store.ts:171-174`) | Signal payloads may embed device identifiers and posture detail; `identityRef`/`deviceRef` echoes | Prove what the gate saw | **Unwritten** — same posture as `decisions`, and the largest rows in the stack |
| `sessions` | `lib/persistence/migrations/002_sessions.sql:5-18` | One row per gated session | `identity_ref`, `device_ref` (columns, not JSONB) | Session continuity and step-up | **Decided-not-implemented for expiry-then-delete**: expiry is implemented (`expires_at`, status flip), deletion is not — expired rows persist |
| `audit_ledger` | `lib/audit/migrations/001_audit_ledger.sql:10-21` | Hash-chained audit events | `actor` JSONB (`{type, id}` — id can be an identity ref), `target` JSONB, `meta` JSONB | Tamper-evident record of actions | **Unwritten, and structurally append-only**: no expiry column, no partitioning, runtime role denied DELETE; any future retention design must preserve chain verifiability — with the known limitation stated: deleting a PREFIX or interior rows breaks `prev_hash` continuity and is detectable, but deleting a SUFFIX leaves every surviving link valid and still verifies as intact (`proof:audit-ledger-pg` pins this; `docs/LEDGER_TRUNCATION_FINDING.md`), so the design needs an external anchor or minimum-record-count check, not chain verification alone |

## Data that LEAVES the system — the outbound field sets

Everything above is about data SignalGrid **stores**. This section is the other
direction: the fields that cross to a third-party vendor when one of the
six emitter families sends. It was undocumented until 2026-09-02, and the reason it needed writing is
that the boundary answered only half the question. `lib/integrations/src/integrations/adapters/emit-gate.ts`
and each family's `resolve.ts` decide **whether** anything may be sent — tier, the
`SIGNALGRID_LIVE_INTEGRATIONS` flag, a credential. Nothing decided **what**. The
gate's own header says so: it "decides WHETHER anything may leave, not what it
looks like."

**No production caller exists today.** Only the proof harnesses under
`scripts/src/` construct these adapters; no host app, no `/v1` route and no
decision path wires one. Every field set below therefore describes what *would*
cross when a deployment injects a transport, not traffic that happens now. That is
also why the fix landed now — closing it before the first caller exists costs one
declaration file.

The canonical, machine-checked declaration is
`lib/integrations/src/integrations/adapters/payload-fields.ts`. It is read by two
independent readers, so the prose here cannot drift away from the code without
something going red: `scripts/check-emit-payload-discipline.mjs` (lexical, in
preflight and CI) and section 13 of `scripts/src/emit-gate-proof.ts`, which drives
one vector per vendor with a key planted at every level and asserts what came back
off the wire.

### Per family

Column and key names below are the vendor field names the adapters emit today. A location or `Zone` column carries whatever the host app supplied in the request; it is not a claim that zone, badge-presence or any other deferred signal ships.
| Family | What crosses (closed set) | The one declared open slot | Where |
| --- | --- | --- | --- |
| `siem` (Splunk HEC) | `time, host, index, source, sourcetype, event`; inside `event`: `type, severity, timestamp, caseId, requestId, correlationId, actor, device, session, location, evidence, customFields` | `customFields`, plus `evidence[].data` nested in a closed element shape | `lib/integrations/src/integrations/siem/splunk.ts` |
| `siem` (Microsoft Sentinel) | `TimeGenerated, EventType, Severity, CaseId, RequestId, CorrelationId, ActorUserId, ActorBadgeUid, ActorEmail, ActorName, DeviceId, DevicePlatform, DeviceIp, DeviceMac, DeviceTags, SessionId, SessionStartedAt, SessionEndedAt, SessionDuration, LocationZone, LocationBuilding, LocationFloor, LocationLat, LocationLng, Evidence` — written AFTER the open slot, so a caller key named `ActorEmail` or `TimeGenerated` cannot occupy a sanctioned column | `customFields`, **flattened into the row's top level** — the only flattened slot in the whole surface, because Sentinel's Custom Log format has no nesting. It is merged FIRST and every sanctioned column is written after it, so a sanctioned field always wins; the opposite order let a caller key overwrite a column SignalGrid derived | `lib/integrations/src/integrations/siem/sentinel.ts` |
| `siem` (signed webhook) | `type, severity, timestamp, caseId, requestId, correlationId, actor, device, session, location, evidence, customFields` | `customFields`, plus `evidence[].data` | `lib/integrations/src/integrations/siem/webhook.ts` |
| `syslog` | `timestamp, type, severity, actor, device, session, location, correlationId, requestId, caseId, customFields` (JSON format; CEF and LEEF emit a narrower, already field-by-field extension set, and neither emits evidence) | `customFields` | `lib/integrations/src/integrations/syslog/transport.ts` |
| `itsm` (seven vendors) | Per-vendor ticket/incident fields only — subject/summary, description, priority or impact+urgency, category, source, correlation id, requester email/name/id, device or CI reference | none for the seven typed vendors; the generic-webhook adapter's `rawEvent` template context is the family's one open slot, and even there the emitted body is the **operator's** own template, so only variables that template names are substituted | `lib/integrations/src/integrations/itsm/` |
| `telemetry` | An OAuth client-credentials token request (`client_id, client_secret, scope, tenant_id`) and a bounded live query (`query, selected`) | none — no caller-supplied map reaches either path | `lib/integrations/src/integrations/telemetry/` |
| `webhooks` | `id, type, timestamp, source, data, deliveryId` | `data` — the event body the caller composes | `lib/integrations/src/integrations/webhooks/dispatch.ts` |
| `caep-events` | `iss, aud, jti, iat, sub_id, events` (an UNSIGNED claims set; this family has no transport at all, and the subject is a pseudonym — an email-shaped subject refuses) | none | `lib/integrations/src/integrations/caep-events/format.ts` |

### The name-equivalents, stated rather than left to be noticed

The paragraph above about `requestContext` warns that a host app can put a
name-equivalent into a durable store. The outbound direction is not the same
situation and must not be read as one: here the name-equivalents are **declared
fields of the adapter types**, deliberately carried, not accidents of a free-text
map.

- `userEmail`, `userName`, `userId` on `ITSMTicketRequest`
- `actor.email`, `actor.name`, `actor.userId`, `actor.badgeUid` on `SIEMEventRequest`
- `device.ip`, `device.mac`, and `location.coordinates` — a device address and a
  physical position, which are personal data in combination with the actor fields
  above

They exist because a service-desk ticket nobody can route and a SIEM event nobody
can attribute are not useful. The honest statement for an assessor is: SignalGrid's
own **stores** are pseudonymous by design; its outbound **adapters** are not, they
carry the identifiers the receiving system needs, and the closed sets above are the
complete list of what they carry. The typed sub-objects (`actor`, `device`,
`session`, `location`) are copied field by field at every builder precisely so this
list stays complete — a field added to one of those types upstream does not begin
crossing until somebody edits a builder.

### What is GATED and what is REPORTED

**GATED.** The key sets above. `scripts/check-emit-payload-discipline.mjs` fails on
a whole-object copy, a spread of a caller's object into a payload, an untyped map
read outside a declared open slot, and an entries-merge — with the scope derived
from the tree (a family is a directory whose `resolve.ts` imports
`createEmitterResolver`) rather than listed. `emit-gate-proof` asserts the same
sets against the bodies real adapters hand to `fetch`, and names the offending key
when one is unexpected.

**REPORTED, not gated.** The **content** a caller places in a declared open slot.
`customFields`, `evidence[].data`, the webhook `data` slot and the generic-webhook
template context are `Record<string, unknown>` by design; SignalGrid cannot see what
a host app puts in them, and a gate claiming otherwise would be asserting something
it does not hold. Integration guidance must tell host apps the same thing it already
tells them about `requestContext`: send references, not identifiers.

## What this means for claims

- No surface may state a retention **duration** as shipped. The honest
  present-tense claims are narrow: session **expiry** exists, and ledger
  **export** exists as the operator-side `db:export-ledger` CLI only — no
  `/v1` export route exists in the published contract
  (`lib/api-spec/v1-openapi.yaml` defines no export operation), and the CLI
  has **no tenant filter**, so per-tenant customer self-serve export is not
  available today. Any surface implying a customer can export their own data
  overclaims.
- "Configurable retention" is doubly false today: there is nothing to configure and
  no mechanism to apply a configuration to.
- The DSAR position for assessors: SignalGrid holds pseudonymous refs; identity
  resolution and erasure requests route to the customer's IdP of record. Erasure
  *within* SignalGrid stores is not implementable today (see table) — state this
  plainly when asked; do not improvise a procedure.
- When a retention decision is ratified, it must arrive as: a decision record, a
  migration adding the lifecycle mechanism, an admin-credential job (the runtime
  role must stay denied DELETE), a chain-preserving design for `audit_ledger`, and
  only THEN updated claims. This document's table rows move from "Unwritten" to
  "Implemented" with the citation — never ahead of it.

## Surfaces corrected to this position (2026-08-21)

- `artifacts/signalgrid-web/src/pages/Pricing.tsx` — "90-day default retention,
  configurable" removed from both tiers, and the "exportable at any time"
  clause removed too (export is an operator CLI without a tenant filter, not
  a buyer feature).
- `docs/DECISION_RECORDS.md` DR-003 — status line added: 90 days is the intended
  default, not implemented as of August 21, 2026. The decision stands; the tense
  was corrected.
- `docs/SECURITY_QUESTIONNAIRE_PACK.md` retention row — now cites this document.
