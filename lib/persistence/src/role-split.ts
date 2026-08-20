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
  DECLARE
    attrs RECORD;
  BEGIN
    SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
      INTO attrs FROM pg_roles WHERE rolname = 'signalgrid_runtime';
    IF NOT FOUND THEN
      -- LOGIN but no password yet: unusable until the deploy sets one.
      CREATE ROLE signalgrid_runtime LOGIN;
      RETURN;
    END IF;
    -- The role already exists: FAIL CLOSED unless it is the plain LOGIN role
    -- this split defines. The REVOKEs below cannot demote SUPERUSER or
    -- BYPASSRLS, cannot take ownership away, and cannot strip privileges that
    -- arrive through role memberships — adopting such a role would leave the
    -- ledger rewritable while this file claims append-only. Each refusal names
    -- the one remedy that makes re-running converge.
    IF attrs.rolsuper OR attrs.rolcreaterole OR attrs.rolcreatedb
       OR attrs.rolreplication OR attrs.rolbypassrls THEN
      RAISE EXCEPTION 'signalgrid_runtime already exists with elevated attributes '
        '(superuser=% createrole=% createdb=% replication=% bypassrls=%) — the grants below '
        'cannot demote these, so the append-only claim would be false. ALTER the role down to '
        'a plain LOGIN role (or drop it) first.',
        attrs.rolsuper, attrs.rolcreaterole, attrs.rolcreatedb, attrs.rolreplication, attrs.rolbypassrls;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles o ON o.oid = c.relowner
               WHERE o.rolname = 'signalgrid_runtime') THEN
      RAISE EXCEPTION 'signalgrid_runtime already OWNS database objects — an owner can always '
        'rewrite its own tables regardless of grants. REASSIGN OWNED BY signalgrid_runtime first.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members m
               WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'signalgrid_runtime')) THEN
      RAISE EXCEPTION 'signalgrid_runtime is a MEMBER of other roles — privileges inherited '
        'through membership cannot be revoked here. REVOKE those memberships first.';
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
 * Refuse BEFORE any work when this credential cannot provision the role split.
 *
 * `CREATE ROLE` needs cluster-wide CREATEROLE (or SUPERUSER) — a common
 * least-privilege deployment gives the migration credential ownership of the
 * database and schema but NOT of the cluster, and without this check that
 * deployment fails midway: the migration dies inside v2, or worse, a restore
 * dies in post-restore re-provisioning AFTER pg_restore has already replaced
 * the database. Failing up front with the named remedy is the only shape that
 * leaves nothing half-done.
 *
 * Reading the caller's own pg_roles row is exact here: role ATTRIBUTES
 * (SUPERUSER, CREATEROLE) are never inherited through memberships, so there is
 * no inherited-CREATEROLE case this check would miss.
 */
export async function assertRoleSplitProvisionable(
  query: (sql: string) => Promise<{ rows: any[] }>,
): Promise<void> {
  const { rows } = await query(`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RUNTIME_ROLE}') AS role_exists,
           (SELECT rolsuper OR rolcreaterole FROM pg_roles WHERE rolname = current_user) AS can_create_role
  `);
  const r = rows[0] ?? {};
  if (!r.role_exists && !r.can_create_role) {
    throw new Error(
      `the '${RUNTIME_ROLE}' role does not exist and this credential lacks CREATEROLE, so the role ` +
        `split cannot be provisioned — refusing BEFORE any schema change or restore so nothing is left ` +
        `half-applied. Have a cluster administrator run: CREATE ROLE ${RUNTIME_ROLE} LOGIN;  then re-run.`,
    );
  }
}

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
