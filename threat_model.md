# Threat Model

> **Rewritten 2026-08-15.** The previous revision of this file described the repository
> at scaffold time — "the API currently exposes only a health endpoint and holds no
> persistent data store" — and was never updated as the API grew to a fenced `/v1`
> decision surface with Postgres-backed stores and a hash-chained audit ledger. A
> threat model that understates the attack surface is not conservative; it tells a
> reviewer the boundaries they need not look at. This revision describes what exists,
> and for each guarantee names the gate that enforces it — because in this repository
> a requirement without a gate is a hope. Depth on the decision core itself lives in
> [PRODUCT_CORE_THREAT_MODEL](docs/PRODUCT_CORE_THREAT_MODEL.md).

## Project Overview

A pnpm/TypeScript monorepo. The production-shaped surface is an Express 5 API
(`artifacts/api-server`) serving a **GA-fenced `/v1` decision surface** (evaluate /
decisions / evidence / context / audit / metrics / connectors / policies reads), plus
several static React/Vite sites of which `artifacts/signalgrid-app` is the launch
console. Persistence is **gated, not assumed**: with no `DATABASE_URL` everything runs
on deterministic in-memory stores seeded from fixtures (the public default); with
`DATABASE_URL` set, decisions, sessions and the audit hash chain persist to Postgres
(`lib/persistence`, `lib/audit`). There are no live vendor calls in this repository;
every connector is fixture-backed behind a tier gate. `artifacts/mockup-sandbox` is
dev-only preview tooling and is not deployed.

## Assets

- **The decision and its evidence** — verdicts and the WHY behind them. Wrong,
  forged, or silently altered evidence is the product failing at the one thing it
  claims.
- **The audit chains** — two, named honestly: the durable SHA-256 hash chain
  (`lib/audit`, Postgres-backed, verified end to end by `pnpm run db:verify-ledger`)
  and the core's in-process per-tenant digest chain served at `/v1/audit`, which does
  not survive a restart. See "Two ledgers, honestly" in
  [BACKUP_AND_RESTORE](docs/BACKUP_AND_RESTORE.md).
- **Tenant isolation** — no tenant may read another's rows, ever.
- **API keys and future credentials** — server-side only, never logged, never bundled.
- **Trustworthy client bundles** — the static frontends must not embed secrets or
  treat client-side checks as authority.

## Trust Boundaries

- **Client → `/v1`** — every request is untrusted: bearer auth, per-tenant scoping
  derived from the credential (never from client input), zod/spec validation, and
  rate limiting (`artifacts/api-server/src/middlewares/rateLimit.ts`; deliberately low
  shipped defaults, tunable per deployment).
- **API → Postgres** — parameterized queries throughout (`lib/persistence`,
  `lib/audit/src/backend.ts`); every single-object read keyed on `(id, tenant_id)`.
- **Build tooling → artifacts** — clients and schemas are generated from
  `lib/api-spec/v1-openapi.yaml`; the spec↔route drift is gated in both directions
  (`proof:api-contract`).
- **Prod vs dev artifacts** — `mockup-sandbox` and preview tooling stay out of the
  runtime; the launch profile classifies every app surface and fails CI on an
  unclassified one.

## Enforced guarantees (each names its gate)

- **Authorization on every durable read path** — `scripts/check-durable-path-authorization.mjs`
  exists because three GA routes once authorized on the in-memory path and only
  authenticated on Postgres. One documented exemption remains (`/v1/sessions`, a
  `session:*` permission is planned work) and the gate prints it on every run rather
  than hiding it.
- **Cross-tenant isolation** — `proof:isolation-scope` sweeps every reader × tenant
  pair with non-vacuity controls; `test:load` fires 40 concurrent cross-tenant probes
  that must all 404 (`artifacts/api-server/test/load.test.mjs`).
- **Tamper-evidence** — `proof:audit-ledger` and `proof:audit-ledger-pg` plant
  corruption (including beyond the verifier's first read batch and at batch
  boundaries) and require detection at the exact record index.
- **Secret redaction** — audit metadata is depth-recursively redacted before persist
  (proven in `proof:audit-ledger`); request logs redact authentication material.
- **Abuse limits** — per-key and per-address rate limits answer 429 with back-off
  headers and never 5xx; a malformed limit env falls back to the shipped ceiling
  rather than opening the door (asserted by `test:load`).
- **Availability posture** — SLOs with a zero-tolerance fail-closed-integrity
  objective ([RELIABILITY_SLO](docs/RELIABILITY_SLO.md), `proof:reliability`);
  `/healthz` is pure liveness by contract.

## Known gaps, stated rather than smoothed

These are tracked work, not discoveries a scanner should have to make:

- No JSON 404 catch-all yet (unknown paths return the framework default), the
  GA-fence 404 uses a non-canonical envelope shape, and a global-limit 429 currently
  carries no request id — all queued as `/v1` contract work.
- No `/readyz` readiness probe and no runtime database-loss test yet; the code path
  fails closed by construction but nothing pins it.
- The reviewer-facing `/v1/audit` chain is in-memory at launch (see Assets).
- Credential lifecycle (user store, rotation, revocation) is future work and is
  booked as such — the current bearer keys are fixture-grade by design.

## Scan Anchors

- **Entry points**: `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`,
  `artifacts/api-server/src/routes/v1.ts`, `artifacts/api-server/src/routes/index.ts`
- **Authorization and tenancy**: `artifacts/api-server/src/middlewares/context.ts`
  (bearer auth + request context), `lib/persistence/src/decision-store.ts`,
  `scripts/check-durable-path-authorization.mjs`
- **Integrity**: `lib/audit/src/index.ts`, `lib/audit/src/backend.ts`
- **Shared client code**: `lib/api-client-react/src/custom-fetch.ts`, `lib/api-spec/v1-openapi.yaml`
- **Dev-only, out of scope unless made reachable**: `artifacts/mockup-sandbox/**`
