// The database role split — the runtime is NOT the owner.
//
// Owner-ordered shift 2: the credential the API server runs with must not be
// able to rewrite history. Concretely:
//
//   · `signalgrid_runtime` is a plain LOGIN role that OWNS NOTHING. It gets
//     exactly the statements the stores execute and not one more:
//       - audit_ledger:          SELECT + INSERT (+ sequence USAGE). The ledger
//         is append-only BY PRIVILEGE, not just by convention — the hash chain
//         detects tampering after the fact; the missing UPDATE/DELETE grant
//         prevents the runtime credential from doing it at all.
//       - decisions/evidence:    SELECT + INSERT + UPDATE (the stores upsert
//         via INSERT … ON CONFLICT DO UPDATE).
//       - sessions:              SELECT + INSERT + UPDATE (status/heartbeat
//         transitions are UPDATEs).
//     No DELETE anywhere, no TRUNCATE, no REFERENCES, no TRIGGER, no DDL.
//   · Schema and admin operations stay with the migration credential
//     (`db:migrate`, backup/restore) — a different login entirely.
//   · NO PASSWORD IS SET HERE, by design. A canonical file with a literal
//     password becomes a deployed literal password. The role is created
//     without one (it cannot log in until a password is set), and the deploy
//     sets it out of band:  ALTER ROLE signalgrid_runtime PASSWORD '…';
//
// This block is deliberately IDEMPOTENT AND RE-RUNNABLE: `pg_restore
// --no-owner --no-privileges` (the shape restoreBackup uses) recreates the
// tables owned by whoever ran the restore and with every grant STRIPPED — a
// restore silently un-splits the roles unless the split is re-applied. So the
// same SQL is both migration v2 and the post-restore re-provisioning step, and
// restoreBackup applies it automatically. The REVOKE-then-GRANT shape means
// re-running it always converges to the same posture.

export const RUNTIME_ROLE = "signalgrid_runtime";

export const ROLE_SPLIT_SQL = `
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'signalgrid_runtime') THEN
      -- LOGIN but no password yet: unusable until the deploy sets one.
      CREATE ROLE signalgrid_runtime LOGIN;
    END IF;
  END $$;

  -- Nobody gets to create objects in public by default (PostgreSQL 15+ already
  -- ships this; stated explicitly so older servers converge to the same posture).
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO signalgrid_runtime;

  -- Per table, RESET then GRANT exactly what the stores execute — a re-run
  -- converges instead of accumulating. Each table is guarded with to_regclass
  -- because the re-provisioning caller (restoreBackup) may be pointing at an
  -- archive that predates one of them; granting on a missing table would turn
  -- the whole restore into a failure over a table that never existed.
  DO $$
  BEGIN
    IF to_regclass('public.audit_ledger') IS NOT NULL THEN
      -- The ledger is append-only BY PRIVILEGE: no UPDATE, no DELETE, no TRUNCATE.
      EXECUTE 'REVOKE ALL ON audit_ledger FROM signalgrid_runtime';
      EXECUTE 'GRANT SELECT, INSERT ON audit_ledger TO signalgrid_runtime';
      -- BIGSERIAL owns a sequence whose name is derived; resolve it instead of
      -- hardcoding, so a rename never silently drops the grant.
      EXECUTE format(
        'GRANT USAGE ON SEQUENCE %s TO signalgrid_runtime',
        pg_get_serial_sequence('audit_ledger', 'seq')
      );
    END IF;
    IF to_regclass('public.decisions') IS NOT NULL THEN
      -- Upserting store: UPDATE is required by INSERT … ON CONFLICT DO UPDATE.
      EXECUTE 'REVOKE ALL ON decisions FROM signalgrid_runtime';
      EXECUTE 'GRANT SELECT, INSERT, UPDATE ON decisions TO signalgrid_runtime';
    END IF;
    IF to_regclass('public.evidence_snapshots') IS NOT NULL THEN
      EXECUTE 'REVOKE ALL ON evidence_snapshots FROM signalgrid_runtime';
      EXECUTE 'GRANT SELECT, INSERT, UPDATE ON evidence_snapshots TO signalgrid_runtime';
    END IF;
    IF to_regclass('public.sessions') IS NOT NULL THEN
      -- Session lifecycle transitions are UPDATEs.
      EXECUTE 'REVOKE ALL ON sessions FROM signalgrid_runtime';
      EXECUTE 'GRANT SELECT, INSERT, UPDATE ON sessions TO signalgrid_runtime';
    END IF;
  END $$;
`;

/**
 * Apply (or re-apply) the role split. Requires an ADMIN connection — the same
 * credential that runs migrations and restores; the whole point is that the
 * runtime credential could never do this itself.
 */
export async function applyRoleSplit(connectionString: string): Promise<void> {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query(ROLE_SPLIT_SQL);
  } finally {
    await pool.end();
  }
}
