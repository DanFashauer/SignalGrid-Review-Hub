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

Session **expiry** exists and is not retention: `sessions.status` flips to
`expired` when `expires_at` lapses (`lib/persistence/src/session-store.ts`), but
the row itself persists indefinitely — expiry ends a session's validity, it deletes
nothing.

## Per-store inventory

SignalGrid's **own** fields are pseudonymous by design: stores carry references
(`identity_ref`, `device_ref`), never names, and the mapping from a ref to a person
lives in the customer's IdP/MDM, not here. Under GDPR-style definitions a
pseudonymous ref is still personal data, so the fields are named honestly below.

**One field breaks the pseudonymity-by-design claim and must be stated:**
`requestContext` on `/v1/decisions/evaluate` is caller-supplied free text — up
to 32 string entries with pattern-valid keys survive `sanitizeContext`
(`artifacts/api-server/src/routes/v1.ts:894-909`) and are serialized whole into
`decisions.data`. A host app that sends `{userEmail: "person@example.com"}`
has put a name-equivalent into a durable store with no deletion path.
SignalGrid cannot prevent this by design today; integration guidance must tell
host apps to send references, not identifiers, and constraining or redacting
the field is open hardening work.

| Store | Defined at | What it holds | Personal-data-capable fields | Purpose | Retention state |
| --- | --- | --- | --- | --- | --- |
| `decisions` | `lib/persistence/migrations/001_decisions.sql:6-13` | One row per Assist decision; `data` JSONB is the full serialized Decision (`lib/persistence/src/decision-store.ts:165-169`) | `data.context.identityRef`, `data.context.deviceRef`; reason codes and rule ids | Decision audit and reconciliation | **Unwritten** — no lifecycle column, no purge path, runtime role denied DELETE |
| `evidence_snapshots` | `lib/persistence/migrations/001_decisions.sql:15-21` | The evidence a decision was computed from; `data` JSONB is the full snapshot (`decision-store.ts:171-174`) | Signal payloads may embed device identifiers and posture detail; `identityRef`/`deviceRef` echoes | Prove what the gate saw | **Unwritten** — same posture as `decisions`, and the largest rows in the stack |
| `sessions` | `lib/persistence/migrations/002_sessions.sql:5-18` | One row per gated session | `identity_ref`, `device_ref` (columns, not JSONB) | Session continuity and step-up | **Decided-not-implemented for expiry-then-delete**: expiry is implemented (`expires_at`, status flip), deletion is not — expired rows persist |
| `audit_ledger` | `lib/audit/migrations/001_audit_ledger.sql:10-21` | Hash-chained audit events | `actor` JSONB (`{type, id}` — id can be an identity ref), `target` JSONB, `meta` JSONB | Tamper-evident record of actions | **Unwritten, and structurally append-only**: no expiry column, no partitioning, runtime role denied DELETE; any future retention design must preserve chain verifiability (deletion breaks `prev_hash` continuity — the design must be truncate-and-anchor, not row deletion) |

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
