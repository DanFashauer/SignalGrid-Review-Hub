-- NON-AUTHORITATIVE. This file is NOT executed by anything: the schema
-- authority is lib/persistence/src/migrations.ts (run via `pnpm run
-- db:migrate`), which also applies migration v2 — the signalgrid_runtime
-- role split — that this file does not contain. Kept as a readable
-- reference only; a deployment provisioned from this file alone would be
-- missing the role split entirely.
-- Audit ledger — durable, tamper-evident decision record.
-- Applied automatically by PostgresAuditBackend on first connect (CREATE TABLE
-- IF NOT EXISTS); kept here as the canonical schema for real deployments and
-- for migration tooling.
--
-- The hash chain is enforced in application code (each row's prev_hash equals
-- the prior row's hash, serialized by a transaction-scoped advisory lock). `seq`
-- gives a total insertion order for chain verification and pagination.

CREATE TABLE IF NOT EXISTS audit_ledger (
    seq        BIGSERIAL PRIMARY KEY,
    id         TEXT        NOT NULL,
    ts         TIMESTAMPTZ NOT NULL,
    request_id TEXT,
    actor      JSONB       NOT NULL,
    event_type TEXT        NOT NULL,
    target     JSONB,
    meta       JSONB,
    prev_hash  TEXT        NOT NULL,
    hash       TEXT        NOT NULL
);

-- Fast lookup of the chain head and by event type / time for investigations.
CREATE INDEX IF NOT EXISTS audit_ledger_seq_desc_idx ON audit_ledger (seq DESC);
CREATE INDEX IF NOT EXISTS audit_ledger_event_type_idx ON audit_ledger (event_type);
CREATE INDEX IF NOT EXISTS audit_ledger_ts_idx ON audit_ledger (ts);
