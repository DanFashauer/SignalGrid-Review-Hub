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
// same SQL is migration v2, the post-restore re-provisioning step, AND the
// repair `db:migrate` runs on an already-current database. The
// RESET-then-GRANT shape means re-running always converges to the same
// posture.

export const RUNTIME_ROLE = "signalgrid_runtime";

/**
 * Validation half, runnable on its own: REFUSES (raises) when a preexisting
 * `signalgrid_runtime` cannot be safely adopted, and does nothing when the
 * role does not exist (creation is the apply step's job). Split out so a
 * restore can run it BEFORE `pg_restore` replaces the database — validating
 * only afterwards would reach exactly the half-applied state the precheck
 * exists to prevent.
 *
 * FAIL CLOSED on anything more than a plain LOGIN role. The grants below
 * cannot demote SUPERUSER or BYPASSRLS, cannot take ownership away (of
 * relations, schemas, or databases — an owner can always rewrite or drop what
 * it owns), cannot strip privileges that arrive through role memberships, and
 * a NOLOGIN role would take every grant and still leave the API unable to
 * connect (and someone may have set NOLOGIN deliberately, to lock the
 * credential out — silently re-enabling it would undo that). Each refusal
 * names the one remedy that makes re-running converge.
 */
export const ROLE_SPLIT_VALIDATE_SQL = `
  DO $$
  DECLARE
    attrs RECORD;
  BEGIN
    SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin
      INTO attrs FROM pg_roles WHERE rolname = 'signalgrid_runtime';
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF attrs.rolsuper OR attrs.rolcreaterole OR attrs.rolcreatedb
       OR attrs.rolreplication OR attrs.rolbypassrls THEN
      RAISE EXCEPTION 'signalgrid_runtime already exists with elevated attributes '
        '(superuser=% createrole=% createdb=% replication=% bypassrls=%) — grants '
        'cannot demote these, so the append-only claim would be false. ALTER the role down to '
        'a plain LOGIN role (or drop it) first.',
        attrs.rolsuper, attrs.rolcreaterole, attrs.rolcreatedb, attrs.rolreplication, attrs.rolbypassrls;
    END IF;
    IF NOT attrs.rolcanlogin THEN
      RAISE EXCEPTION 'signalgrid_runtime already exists but is NOLOGIN — every grant would apply '
        'and the API still could not connect; and if the login was disabled deliberately, silently '
        're-enabling it here would undo a lockout. ALTER ROLE signalgrid_runtime LOGIN (or drop it) first.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles o ON o.oid = c.relowner
               WHERE o.rolname = 'signalgrid_runtime') THEN
      RAISE EXCEPTION 'signalgrid_runtime already OWNS database objects — an owner can always '
        'rewrite its own tables regardless of grants. REASSIGN OWNED BY signalgrid_runtime first.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles o ON o.oid = n.nspowner
               WHERE o.rolname = 'signalgrid_runtime') THEN
      RAISE EXCEPTION 'signalgrid_runtime already OWNS a schema — a schema owner can drop it '
        'CASCADE, tables and all, regardless of grants. ALTER SCHEMA … OWNER TO a different role first.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles o ON o.oid = d.datdba
               WHERE o.rolname = 'signalgrid_runtime') THEN
      RAISE EXCEPTION 'signalgrid_runtime already OWNS a database — a database owner holds '
        'owner-level rights no grant here can take back. ALTER DATABASE … OWNER TO a different role first.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members m
               WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'signalgrid_runtime')) THEN
      RAISE EXCEPTION 'signalgrid_runtime is a MEMBER of other roles — privileges inherited '
        'through membership cannot be revoked here. REVOKE those memberships first.';
    END IF;
  END $$;
`;

export const ROLE_SPLIT_SQL = `
  ${ROLE_SPLIT_VALIDATE_SQL}

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

  -- CONNECT is granted DIRECTLY, not inherited from PUBLIC: a hardened
  -- database that has revoked PUBLIC's ambient CONNECT would otherwise leave a
  -- fully-granted runtime role that still cannot open a connection.
  DO $$
  BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO signalgrid_runtime', current_database());
  END $$;

  -- Per table: RESET then GRANT exactly what the stores execute, so a re-run
  -- converges instead of accumulating. The reset is deliberately WIDER than
  -- the role itself, because a grant can arrive from three places the plain
  -- role-level REVOKE never touches:
  --   · PUBLIC — every login inherits a PUBLIC grant, so an upgraded database
  --     that ever granted PUBLIC UPDATE would leave the ledger rewritable no
  --     matter what the runtime role's own ACL says;
  --   · column-level ACLs — a table-level REVOKE does not remove a
  --     column-level grant such as UPDATE (hash), which is precisely the
  --     column a ledger forger would want;
  --   · the ledger SEQUENCE — a direct UPDATE grant on it would let the
  --     runtime setval() the counter backwards onto an existing key and wedge
  --     all future appends.
  -- Every relation is schema-qualified (public.…): an attacker-controlled or
  -- merely unlucky search_path must not be able to point the REVOKE/GRANT at
  -- a shadowing table in another schema while to_regclass checked public.
  -- Each table is guarded with to_regclass because the re-provisioning caller
  -- (restoreBackup) may be pointing at an archive that predates one of them.
  DO $$
  DECLARE
    spec RECORD;
    att  RECORD;
    seqname TEXT;
  BEGIN
    FOR spec IN
      SELECT * FROM (VALUES
        -- The ledger is append-only BY PRIVILEGE: no UPDATE, no DELETE, no TRUNCATE.
        ('audit_ledger',       'SELECT, INSERT'),
        -- Upserting stores: UPDATE is required by INSERT … ON CONFLICT DO UPDATE.
        ('decisions',          'SELECT, INSERT, UPDATE'),
        ('evidence_snapshots', 'SELECT, INSERT, UPDATE'),
        -- Session lifecycle transitions are UPDATEs.
        ('sessions',           'SELECT, INSERT, UPDATE')
      ) AS t(tbl, grants)
    LOOP
      IF to_regclass('public.' || spec.tbl) IS NULL THEN
        CONTINUE;
      END IF;
      EXECUTE format('REVOKE ALL ON public.%I FROM signalgrid_runtime, PUBLIC', spec.tbl);
      FOR att IN
        SELECT attname FROM pg_attribute
        WHERE attrelid = ('public.' || quote_ident(spec.tbl))::regclass
          AND attnum > 0 AND NOT attisdropped AND attacl IS NOT NULL
      LOOP
        EXECUTE format('REVOKE ALL (%I) ON public.%I FROM signalgrid_runtime, PUBLIC',
                       att.attname, spec.tbl);
      END LOOP;
      EXECUTE format('GRANT %s ON public.%I TO signalgrid_runtime', spec.grants, spec.tbl);
    END LOOP;

    -- BIGSERIAL owns a sequence whose name is derived; resolve it instead of
    -- hardcoding, so a rename never silently drops the grant.
    seqname := pg_get_serial_sequence('public.audit_ledger', 'seq');
    IF seqname IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM signalgrid_runtime, PUBLIC', seqname);
      EXECUTE format('GRANT USAGE ON SEQUENCE %s TO signalgrid_runtime', seqname);
    END IF;
  END $$;
`;

/**
 * Refuse BEFORE any work when this credential cannot provision the role split.
 *
 * Two refusal classes, both checked up front because failing later is how a
 * half-migrated schema or a restored-but-unsplit database happens:
 *   · The role is MISSING and this credential lacks cluster-wide CREATEROLE
 *     (or SUPERUSER) — a common least-privilege deployment gives the
 *     migration credential the database and schema but not the cluster.
 *     Reading the caller's own pg_roles row is exact here: role ATTRIBUTES
 *     are never inherited through memberships.
 *   · The role EXISTS but cannot be safely adopted (elevated attributes,
 *     NOLOGIN, ownership, memberships) — the same validation the apply step
 *     enforces, run early so `restoreBackup` refuses before `pg_restore`
 *     replaces the database rather than after.
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
  if (r.role_exists) {
    await query(ROLE_SPLIT_VALIDATE_SQL);
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
