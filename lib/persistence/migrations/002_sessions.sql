-- NON-AUTHORITATIVE. This file is NOT executed by anything: the schema
-- authority is lib/persistence/src/migrations.ts (run via `pnpm run
-- db:migrate`), which also applies migration v2 — the signalgrid_runtime
-- role split — that this file does not contain. Kept as a readable
-- reference only; a deployment provisioned from this file alone would be
-- missing the role split entirely.
-- Session lifecycle: durable start/refresh/expire for worker device sessions.
-- Auto-created by PostgresSessionStore on first connect; canonical schema here
-- for migration tooling. Tenant-scoped; single reads keyed on (id, tenant_id).

CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    tenant_id    TEXT NOT NULL,
    identity_ref TEXT NOT NULL,
    device_ref   TEXT NOT NULL,
    workflow_key TEXT NOT NULL,
    status       TEXT NOT NULL,          -- active | expired | ended
    outcome      TEXT NOT NULL,          -- the decision that gated the start
    decision_id  TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_tenant_idx ON sessions (tenant_id);
