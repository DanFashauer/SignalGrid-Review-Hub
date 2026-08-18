// Schema migrations — versioned, append-only, recorded in the database itself.
//
// Until this existed, "the schema" was whatever the three stores' idempotent
// CREATE IF NOT EXISTS blocks happened to produce, and no running database
// could answer "which schema revision am I?". That is fine right up until the
// first ALTER, at which point an unversioned schema is a guess. The runner is
// gated in CI's durable-persistence job so the migration path is exercised on
// every change, not discovered at the first real upgrade.
//
// RULES, enforced here rather than remembered:
//   · Append-only. A shipped migration is never edited; fixing one means
//     shipping the next. (The gate cannot see history, but the version check
//     below catches the observable symptom: a database recording a version
//     this code has never heard of.)
//   · Fail-closed on a FUTURE database: if schema_version records a version
//     greater than this code knows, the runner throws instead of "helpfully"
//     continuing — old code driving a newer schema is how data quietly rots.
//   · One advisory lock, same discipline as the audit backend: two instances
//     migrating concurrently serialize instead of interleaving DDL.
//
// v1 is the BASELINE: the exact tables the stores already create idempotently
// (audit_ledger, decisions, evidence_snapshots, sessions). Running v1 against
// a database those stores initialized records the baseline without touching
// data — CREATE IF NOT EXISTS meets existing tables and moves on. The stores
// keep their inline DDL for the no-migration fixture path; this is the
// authority an operator runs BEFORE pointing a new revision at a database.

const MIGRATION_LOCK_KEY = 0x5194_a11d;

export interface Migration {
  version: number;
  name: string;
  statements: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "baseline-2026-08-16",
    statements: `
      CREATE TABLE IF NOT EXISTS audit_ledger (
        seq        BIGSERIAL PRIMARY KEY,
        id         TEXT NOT NULL,
        ts         TIMESTAMPTZ NOT NULL,
        request_id TEXT,
        actor      JSONB NOT NULL,
        event_type TEXT NOT NULL,
        target     JSONB,
        meta       JSONB,
        prev_hash  TEXT NOT NULL,
        hash       TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS decisions (
        id         TEXT PRIMARY KEY,
        tenant_id  TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        outcome    TEXT NOT NULL,
        data       JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS decisions_tenant_created_idx
        ON decisions (tenant_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS evidence_snapshots (
        id          TEXT PRIMARY KEY,
        tenant_id   TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        data        JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        tenant_id    TEXT NOT NULL,
        identity_ref TEXT NOT NULL,
        device_ref   TEXT NOT NULL,
        workflow_key TEXT NOT NULL,
        status       TEXT NOT NULL,
        outcome      TEXT NOT NULL,
        decision_id  TEXT NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL,
        expires_at   TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_tenant_idx ON sessions (tenant_id);
    `,
  },
];

export interface MigrationResult {
  /** Versions applied by THIS run (empty when already current). */
  applied: number[];
  /** The database's schema version after the run. */
  current: number;
}

export async function runMigrations(connectionString: string): Promise<MigrationResult> {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const pool = new Pool({ connectionString, max: 2 });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version    INTEGER PRIMARY KEY,
          name       TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
      `);
      const res = await client.query("SELECT COALESCE(MAX(version), 0) AS v FROM schema_version");
      const recorded: number = Number(res.rows[0].v);
      const known = Math.max(...MIGRATIONS.map((m) => m.version));
      if (recorded > known) {
        throw new Error(
          `schema_version says ${recorded} but this code only knows through ${known}. ` +
            "A database AHEAD of its code is refused, not driven — run newer code instead.",
        );
      }
      const applied: number[] = [];
      for (const m of MIGRATIONS) {
        if (m.version <= recorded) continue;
        await client.query(m.statements);
        await client.query("INSERT INTO schema_version (version, name) VALUES ($1, $2)", [m.version, m.name]);
        applied.push(m.version);
      }
      await client.query("COMMIT");
      return { applied, current: Math.max(recorded, known) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
