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
// OWNER-RIGHTS PATHS the runtime must not be able to reach, refused rather
// than silently reset (a PUBLIC grant serves OTHER roles too — revoking it
// here would turn a migration into an outage for unrelated callers; the
// administrator revokes or regrants deliberately, then re-runs):
//   · SECURITY DEFINER routines run with their OWNER's privileges, and
//     PostgreSQL grants PUBLIC EXECUTE on every new routine by default — an
//     admin-owned definer function that writes the ledger is a write path no
//     table grant closes.
//   · Views execute with their OWNER's rights by default — a writable
//     admin-owned view over the ledger lets the runtime rewrite the base
//     table with no table-level UPDATE of its own.
// Interpolated into the validation (existing-role precheck) AND run after
// create-if-missing in the apply, so a fresh provisioning on a database that
// already contains such a path refuses too.
const OWNER_RIGHTS_CHECKS = `
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg\\_%'
        AND has_function_privilege('signalgrid_runtime', p.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'signalgrid_runtime can EXECUTE a SECURITY DEFINER routine outside the system '
        'schemas — definer routines run with their owner''s privileges, a write path no table grant '
        'closes. REVOKE EXECUTE on it FROM PUBLIC (granting the roles that need it explicitly), '
        'then re-run.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'v'
        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
        AND n.nspname NOT LIKE 'pg\\_%'
        AND (has_table_privilege('signalgrid_runtime', c.oid, 'INSERT')
          OR has_table_privilege('signalgrid_runtime', c.oid, 'UPDATE')
          OR has_table_privilege('signalgrid_runtime', c.oid, 'DELETE'))
    ) THEN
      RAISE EXCEPTION 'signalgrid_runtime can WRITE through a view outside the system schemas — views '
        'run with their owner''s rights, so a writable admin-owned view over the ledger defeats the '
        'append-only grants. REVOKE the write privilege on it FROM PUBLIC (and from '
        'signalgrid_runtime), then re-run.';
    END IF;`;

export const ROLE_SPLIT_VALIDATE_SQL = `
  DO $$
  DECLARE
    attrs RECORD;
  BEGIN
    SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolcanlogin,
           rolconnlimit, rolvaliduntil
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
    -- LOGIN alone does not mean the role can OPEN a connection: CONNECTION
    -- LIMIT 0 and an expired VALID UNTIL are both lockouts the documented
    -- out-of-band ALTER ROLE … PASSWORD never repairs — and both may be
    -- deliberate, so refuse rather than silently normalize.
    -- 0 is a full lockout; 1..29 is a partial one — the runtime opens THREE
    -- pools (decisions, sessions, ledger) of up to 10 connections each, so a
    -- role capped below that budget initializes, then starves under load and
    -- /readyz flaps. Either way the cap may be deliberate, so refuse.
    IF attrs.rolconnlimit >= 0 AND attrs.rolconnlimit < 30 THEN
      RAISE EXCEPTION 'signalgrid_runtime already exists with CONNECTION LIMIT % — below the runtime''s '
        'pool budget (three stores x 10 pooled connections = 30; 0 is a full lockout). The API could not '
        'reliably connect, and a deliberate cap must not be silently raised. ALTER ROLE '
        'signalgrid_runtime CONNECTION LIMIT -1 (or >= 30, or drop the role) first.', attrs.rolconnlimit;
    END IF;
    IF attrs.rolvaliduntil IS NOT NULL AND attrs.rolvaliduntil < now() THEN
      RAISE EXCEPTION 'signalgrid_runtime already exists with an EXPIRED password validity (VALID UNTIL %) '
        '— the API could not authenticate; if the expiry is a deliberate lockout, this role must not be '
        'adopted. ALTER ROLE signalgrid_runtime VALID UNTIL ''infinity'' (or drop it) first.', attrs.rolvaliduntil;
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
    -- Ownership beyond relations IN THIS DATABASE: pg_class covers tables,
    -- views and sequences, but a function, procedure, type, or any other
    -- owned object carries owner-only DDL too. pg_shdepend records every
    -- ownership dependency regardless of catalog class.
    IF EXISTS (
      SELECT 1 FROM pg_shdepend d
      WHERE d.refclassid = 'pg_authid'::regclass
        AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'signalgrid_runtime')
        AND d.deptype = 'o'
        AND d.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    ) THEN
      RAISE EXCEPTION 'signalgrid_runtime OWNS non-relation objects in this database (a function, '
        'procedure, type, …) — owner-only DDL survives every grant. REASSIGN OWNED BY '
        'signalgrid_runtime (or DROP OWNED) first.';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_auth_members m
               WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = 'signalgrid_runtime')) THEN
      RAISE EXCEPTION 'signalgrid_runtime is a MEMBER of other roles — privileges inherited '
        'through membership cannot be revoked here. REVOKE those memberships first.';
    END IF;
    -- pg_class/pg_namespace above are DATABASE-LOCAL; on a shared cluster the
    -- role could own objects (or hold grants) in ANOTHER database this
    -- connection can neither see in those catalogs nor revoke. pg_shdepend is
    -- the cluster-wide shared catalog that records exactly those dependencies
    -- ('o' = owner, 'a' = appears in an ACL). Rows for THIS database are
    -- excluded (its ownership is checked above; its grants are the ones this
    -- very block manages), as is the CONNECT grant on this database itself
    -- (a shared-catalog row this block issues).
    IF EXISTS (
      SELECT 1 FROM pg_shdepend d
      WHERE d.refclassid = 'pg_authid'::regclass
        AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'signalgrid_runtime')
        AND d.deptype IN ('o', 'a')
        AND d.dbid <> (SELECT oid FROM pg_database WHERE datname = current_database())
        AND NOT (d.dbid = 0 AND d.classid = 'pg_database'::regclass
                 AND d.objid = (SELECT oid FROM pg_database WHERE datname = current_database()))
    ) THEN
      RAISE EXCEPTION 'signalgrid_runtime owns objects or holds privileges in ANOTHER database on this '
        'cluster — owner-level powers and grants this connection cannot see or revoke. Clean those up in '
        'the databases that hold them (REASSIGN OWNED / REVOKE there), or use a dedicated cluster.';
    END IF;
    -- Grants INSIDE this database are checked against an exact allowlist: the
    -- four managed tables, the ledger sequence, and USAGE on public are the
    -- canonical set the apply step resets; a grant on ANY other object here
    -- (another schema, someone else's table, a function) would survive that
    -- reset untouched — the role would hold more than the documented posture
    -- while the migration reported a converged split.
    IF EXISTS (
      SELECT 1 FROM pg_shdepend d
      WHERE d.refclassid = 'pg_authid'::regclass
        AND d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'signalgrid_runtime')
        AND d.deptype = 'a'
        AND d.dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND NOT (d.classid = 'pg_class'::regclass AND d.objid IN (
          SELECT c FROM unnest(ARRAY[
            to_regclass('public.audit_ledger'), to_regclass('public.decisions'),
            to_regclass('public.evidence_snapshots'), to_regclass('public.sessions'),
            CASE WHEN to_regclass('public.audit_ledger') IS NOT NULL
                 THEN to_regclass(pg_get_serial_sequence('public.audit_ledger', 'seq')) END
          ]::oid[]) AS t(c) WHERE c IS NOT NULL))
        AND NOT (d.classid = 'pg_namespace'::regclass
                 AND d.objid = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
    ) THEN
      RAISE EXCEPTION 'signalgrid_runtime holds grants on objects in this database OUTSIDE the canonical '
        'set (the four managed tables, the ledger sequence, schema public) — the split''s reset would '
        'leave them standing, so the role would hold more than the documented posture. REVOKE those '
        'grants first, then re-run.';
    END IF;
${OWNER_RIGHTS_CHECKS}
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
  -- The runtime role's own schema ACL is RESET, not merely added to: a direct
  -- CREATE grant to signalgrid_runtime on an upgraded database would survive
  -- the PUBLIC-only revoke, and GRANT USAGE never narrows — the no-DDL claim
  -- must not depend on nobody ever having granted CREATE directly.
  REVOKE CREATE ON SCHEMA public FROM PUBLIC;
  REVOKE ALL ON SCHEMA public FROM signalgrid_runtime;
  GRANT USAGE ON SCHEMA public TO signalgrid_runtime;

  -- CONNECT is granted DIRECTLY, not inherited from PUBLIC: a hardened
  -- database that has revoked PUBLIC's ambient CONNECT would otherwise leave a
  -- fully-granted runtime role that still cannot open a connection. Database-
  -- level CREATE is RESET first: it permits creating SCHEMAS, and with the
  -- default '"$user", public' search_path a schema named signalgrid_runtime
  -- would shadow the protected tables for unqualified queries. (The stores
  -- also schema-qualify every statement, so shadowing of any kind — including
  -- TEMP tables, which no ACL prevents — cannot redirect their queries.)
  DO $$
  BEGIN
    EXECUTE format('REVOKE CREATE ON DATABASE %I FROM signalgrid_runtime, PUBLIC', current_database());
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

  -- Owner-rights paths (SECURITY DEFINER routines, writable views) are
  -- REFUSED, not reset — see OWNER_RIGHTS_CHECKS above. Run here as well as
  -- in the validation because a FRESH provisioning creates the role two
  -- statements ago: a database that already contains such a path must refuse
  -- even when no role existed to validate.
  DO $$
  BEGIN
${OWNER_RIGHTS_CHECKS}
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
  // The caller must also hold the AUTHORITY to issue the grants themselves:
  // GRANT CONNECT ON DATABASE needs the database owner (or a superuser), and
  // the schema-ACL statements need the schema owner. A restore credential that
  // owns the tables but not the database would sail through pg_restore and
  // die in post-restore re-provisioning — with the database already replaced
  // and every privilege stripped. Refuse before any of that.
  const auth = await query(`
    SELECT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super,
           pg_has_role(current_user,
             (SELECT datdba FROM pg_database WHERE datname = current_database()), 'USAGE') AS owns_db,
           COALESCE(pg_has_role(current_user,
             (SELECT nspowner FROM pg_namespace WHERE nspname = 'public'), 'USAGE'), TRUE) AS owns_schema
  `);
  const a = auth.rows[0] ?? {};
  if (!a.is_super && !(a.owns_db && a.owns_schema)) {
    throw new Error(
      `this credential cannot issue the role split's grants — GRANT CONNECT ON DATABASE needs the ` +
        `database owner (or a superuser), and the schema statements need the schema owner. Refusing ` +
        `BEFORE any schema change or restore so nothing is left half-applied. Run as the database ` +
        `owner or a superuser, or transfer ownership first (ALTER DATABASE … OWNER TO …).`,
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
