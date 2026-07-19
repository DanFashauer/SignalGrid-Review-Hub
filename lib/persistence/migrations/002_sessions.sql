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
