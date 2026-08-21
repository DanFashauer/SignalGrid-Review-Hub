-- NON-AUTHORITATIVE. This file is NOT executed by anything: the schema
-- authority is lib/persistence/src/migrations.ts (run via `pnpm run
-- db:migrate`), which also applies migration v2 — the signalgrid_runtime
-- role split — that this file does not contain. Kept as a readable
-- reference only; a deployment provisioned from this file alone would be
-- missing the role split entirely.
-- Durable decision + evidence store for production deployments.
-- Auto-created by the store on first connect when the credential may DDL. Every row is tenant-scoped and single
-- reads are keyed on (id, tenant_id) so cross-tenant access is structurally denied.

CREATE TABLE IF NOT EXISTS decisions (
    id         TEXT PRIMARY KEY,
    tenant_id  TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    outcome    TEXT        NOT NULL,
    data       JSONB       NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_tenant_created_idx ON decisions (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS evidence_snapshots (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT  NOT NULL,
    decision_id TEXT  NOT NULL,
    data        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_snapshots_tenant_idx ON evidence_snapshots (tenant_id);
