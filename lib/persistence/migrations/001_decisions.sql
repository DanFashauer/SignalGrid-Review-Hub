-- Durable decision + evidence store for production deployments.
-- Auto-created by PostgresDecisionStore on first connect; kept here as the
-- canonical schema for migration tooling. Every row is tenant-scoped and single
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
