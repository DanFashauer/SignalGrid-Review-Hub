// Proof: the DATABASE ROLE SPLIT on real Postgres — the runtime is not the owner,
// and both directions are demonstrated, not asserted.
//
// Owner-ordered shift 2. The claim under test: the credential the API server runs
// with can do its legitimate work (append to the ledger, upsert decisions and
// evidence, walk sessions through their lifecycle) and CANNOT rewrite history or
// touch the schema — the ledger is append-only BY PRIVILEGE, not just by hash
// chain. A hash chain detects tampering after the fact; the missing UPDATE grant
// prevents the runtime credential from tampering at all.
//
// SELF-SKIPS when DATABASE_URL is unset, like every real-Postgres proof here.
//
// What it proves:
//   1. POSITIVE   — as `signalgrid_runtime`, every legitimate write works:
//      ledger appends chain and verify, decision/evidence upserts (twice, so the
//      UPDATE grant is really exercised), session create/transition.
//   2. NEGATIVE   — as `signalgrid_runtime`, every destructive statement fails
//      with insufficient_privilege (42501): UPDATE/DELETE/TRUNCATE on the
//      ledger, DELETE on decisions, DROP/ALTER on the table, CREATE TABLE.
//   3. NON-VACUOUS — the ADMIN credential CAN update the ledger (inside a
//      rolled-back transaction), so the denials above are the ROLE, not the
//      table, and the proof cannot pass against a database that denies everyone.
//   4. RESTORE    — after backup → posture destroyed → restore, the SAME
//      privilege posture is back (restoreBackup re-applies the split because
//      pg_restore --no-owner --no-privileges strips every grant): the runtime
//      writes again, still cannot update, and does NOT own the table.
//   0. PROVISIONING GUARDS (run first, from a bare cluster) — migrations REFUSE
//      up front when the role is missing and the credential lacks CREATEROLE
//      (nothing half-applied); the split REFUSES to adopt a preexisting role
//      that is SUPERUSER, owns objects, or holds memberships; a store facing
//      missing grants refuses readiness instead of reporting healthy; and a
//      restore that could not re-provision refuses BEFORE pg_restore replaces
//      anything.

import {
  appendAuditRecord,
  verifyLedger,
  setAuditBackend,
  PostgresAuditBackend,
} from "@workspace/audit";
import {
  PostgresDecisionStore,
  PostgresSessionStore,
  applyRoleSplit,
  runMigrations,
  RUNTIME_ROLE,
} from "@workspace/persistence";
import { SignalGridCore } from "@workspace/signalgrid-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup, restoreBackup } from "./lib/backup";
import { requireDisposableCluster } from "./lib/db-guard";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DB role-split proof: SKIPPED (DATABASE_URL unset — this proof needs a real Postgres).");
  process.exit(0);
}
requireDisposableCluster("DB role-split proof");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

// Ephemeral, in-container only: this password exists for the lifetime of a
// throwaway CI/test database and is set here precisely because the canonical
// role-split SQL refuses to carry one. Not a credential. gitleaks:allow
const RUNTIME_PASSWORD = "sg-runtime-proof"; // gitleaks:allow

/** Swap the credential in a postgres:// URL, keeping host/port/db. */
function withLogin(base: string, user: string, password: string): string {
  const u = new URL(base);
  u.username = user;
  u.password = password;
  return u.toString();
}

/**
 * Remove the runtime role entirely (grants first — a role holding privileges
 * cannot be dropped). Used to reach a bare cluster and to stage the
 * role-loss/restore-refusal scenarios.
 */
function dropRoleSql(role: string): string {
  return `
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
        EXECUTE 'DROP OWNED BY ${role}';
        EXECUTE 'DROP ROLE ${role}';
      END IF;
    END $$;
  `;
}
const dropRuntimeRoleSql = (): string => dropRoleSql(RUNTIME_ROLE);

/** The error message a call fails with — "" when it (wrongly) succeeds. */
async function failureOf(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return ""; } catch (e) { return (e as Error).message; }
}

/** Run a statement expecting insufficient_privilege; returns the SQLSTATE seen. */
async function deniedCode(pool: any, sql: string): Promise<string | null> {
  try {
    await pool.query(sql);
    return null; // it worked — that IS the failure
  } catch (err) {
    return (err as { code?: string }).code ?? "unknown";
  }
}

async function main() {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const admin = new Pool({ connectionString: url });
  const workdir = await mkdtemp(join(tmpdir(), "sg-role-split-"));

  try {
    // ── 0. BARE CLUSTER: tables and the runtime role itself both gone ────────
    await admin.query("DROP TABLE IF EXISTS audit_ledger, decisions, evidence_snapshots, sessions, schema_version CASCADE");
    await admin.query(dropRuntimeRoleSql());

    // 0a. A migration credential that owns the schema but lacks CREATEROLE —
    // the common least-privilege deployment — must be refused UP FRONT with the
    // remedy named, not fail raw inside migration v2.
    await admin.query(dropRoleSql("sg_limited_admin"));
    // Ephemeral throwaway-cluster credential, same standing as RUNTIME_PASSWORD
    // above. Not a credential. gitleaks:allow
    await admin.query("CREATE ROLE sg_limited_admin LOGIN PASSWORD 'sg-limited-proof'"); // gitleaks:allow
    // USAGE as well as CREATE: a prior run's pg_restore --no-privileges leaves
    // schema public without its default PUBLIC grants, and without USAGE the
    // schema is skipped as a creation target ("no schema has been selected")
    // before the precheck this test exists to reach.
    await admin.query("GRANT USAGE, CREATE ON SCHEMA public TO sg_limited_admin");
    // CONNECT explicitly: a prior run leaves PUBLIC's ambient CONNECT revoked
    // (see the direct-CONNECT check in section 5), so like any real hardened
    // deployment this credential needs its own grant.
    const dbname = new URL(url!).pathname.slice(1);
    await admin.query(`GRANT CONNECT ON DATABASE "${dbname}" TO sg_limited_admin`);
    const limitedUrl = withLogin(url!, "sg_limited_admin", "sg-limited-proof");
    let refusedMigrate = "";
    try { await runMigrations(limitedUrl); } catch (e) { refusedMigrate = (e as Error).message; }
    check("migrations REFUSE up front when the role is missing and the credential lacks CREATEROLE",
      refusedMigrate.includes("CREATEROLE"));
    const untouched = await admin.query(
      "SELECT to_regclass('public.audit_ledger') IS NULL AND to_regclass('public.schema_version') IS NULL AS clean",
    );
    check("…and refused BEFORE any DDL survived (no tables exist afterwards)", untouched.rows[0]?.clean === true);

    // 0b. A preexisting `signalgrid_runtime` that is anything more than a plain
    // LOGIN role is REFUSED, not adopted — REVOKE cannot demote SUPERUSER,
    // cannot strip ownership, cannot undo memberships. One counterexample per
    // refusal path.
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN SUPERUSER`);
    check("role split REFUSES a preexisting SUPERUSER role (elevated attributes cannot be demoted by grants)",
      /elevated attributes/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query(dropRuntimeRoleSql());

    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN`);
    await admin.query("CREATE TABLE sg_owned_probe (x INT)");
    await admin.query(`ALTER TABLE sg_owned_probe OWNER TO ${RUNTIME_ROLE}`);
    check("role split REFUSES a preexisting role that OWNS objects (an owner can always rewrite its tables)",
      /OWNS database objects/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query("DROP TABLE sg_owned_probe");
    await admin.query(dropRuntimeRoleSql());

    await admin.query("DROP ROLE IF EXISTS sg_probe_group");
    await admin.query("CREATE ROLE sg_probe_group");
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN`);
    await admin.query(`GRANT sg_probe_group TO ${RUNTIME_ROLE}`);
    check("role split REFUSES a preexisting role with MEMBERSHIPS (inherited privileges cannot be revoked here)",
      /MEMBER of other roles/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query(dropRuntimeRoleSql());
    await admin.query("DROP ROLE sg_probe_group");

    // NOLOGIN is CREATE ROLE's default, so an administrator who pre-created
    // the role by hand very plausibly made one the API can never connect as —
    // and one that may have been locked out DELIBERATELY. Refuse, never
    // silently re-enable.
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE}`);
    check("role split REFUSES a preexisting NOLOGIN role (grants would apply; the API still could not connect)",
      /NOLOGIN/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query(dropRuntimeRoleSql());

    // LOGIN alone is not the ability to connect: CONNECTION LIMIT 0 and an
    // expired VALID UNTIL are lockouts the out-of-band password never repairs.
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN CONNECTION LIMIT 0`);
    check("role split REFUSES a preexisting role with CONNECTION LIMIT 0 (a lockout the password cannot repair)",
      /CONNECTION LIMIT 0/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query(dropRuntimeRoleSql());
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN VALID UNTIL '2020-01-01'`);
    check("role split REFUSES a preexisting role whose password validity has EXPIRED",
      /EXPIRED/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query(dropRuntimeRoleSql());

    // Cluster-wide ownership: pg_class/pg_namespace see only THIS database,
    // but the role is cluster-wide — pg_shdepend is the shared catalog that
    // sees what it owns everywhere else.
    await admin.query("DROP DATABASE IF EXISTS sg_other_db WITH (FORCE)");
    await admin.query("CREATE DATABASE sg_other_db");
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN`);
    const otherUrl = new URL(url!); otherUrl.pathname = "/sg_other_db";
    const other = new Pool({ connectionString: otherUrl.toString(), max: 1 });
    await other.query("CREATE TABLE elsewhere_probe (x INT)");
    await other.query(`ALTER TABLE elsewhere_probe OWNER TO ${RUNTIME_ROLE}`);
    await other.end();
    check("role split REFUSES a role that owns objects in ANOTHER database on the cluster (pg_shdepend sees it)",
      /ANOTHER database/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query("DROP DATABASE sg_other_db WITH (FORCE)");
    await admin.query(dropRuntimeRoleSql());

    // Ownership beyond relations: pg_class covers tables, but a SCHEMA or
    // DATABASE owner keeps owner-level DDL (drop public CASCADE, for one)
    // that no grant below can take back.
    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN`);
    await admin.query(`ALTER SCHEMA public OWNER TO ${RUNTIME_ROLE}`);
    check("role split REFUSES a preexisting role that OWNS a schema (schema owners can DROP … CASCADE)",
      /OWNS a schema/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query("ALTER SCHEMA public OWNER TO CURRENT_USER");
    await admin.query(dropRuntimeRoleSql());

    await admin.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN`);
    await admin.query(`ALTER DATABASE "${dbname}" OWNER TO ${RUNTIME_ROLE}`);
    check("role split REFUSES a preexisting role that OWNS the database (owner-level rights survive any grant)",
      /OWNS a database/.test(await failureOf(() => applyRoleSplit(url!))));
    await admin.query(`ALTER DATABASE "${dbname}" OWNER TO CURRENT_USER`);
    await admin.query(dropRuntimeRoleSql());

    // ── Then the REAL provisioning path: migrations v1 + v2 from nothing ─────
    const migrated = await runMigrations(url!);
    check(`migrations run to current (v${migrated.current}, role split included)`, migrated.current >= 2);
    // The role exists and can now be given its deploy-time password.
    await admin.query(`ALTER ROLE ${RUNTIME_ROLE} PASSWORD '${RUNTIME_PASSWORD}'`);

    const runtimeUrl = withLogin(url!, RUNTIME_ROLE, RUNTIME_PASSWORD);
    const runtime = new Pool({ connectionString: runtimeUrl });

    // ── 1. POSITIVE: every legitimate runtime write works ────────────────────
    setAuditBackend(new PostgresAuditBackend(runtimeUrl));
    for (let i = 0; i < 3; i += 1) {
      await appendAuditRecord("decision.allow", { type: "system" }, { meta: { i } });
    }
    const chain = await verifyLedger();
    check("runtime ledger appends work and the chain verifies (3 records)", chain.ok === true && chain.count === 3);

    // A GENUINE decision + snapshot from the real core, saved twice so the
    // upsert path (INSERT … ON CONFLICT DO UPDATE) really exercises the UPDATE
    // grant — same minting approach as decision-store-pg-proof.
    const core = SignalGridCore.demo();
    const token = core.demoApiKeys().find((k) => k.tenantId === "tenant_northwind" && k.role === "operator")!.token;
    const evalResult = core.evaluate(token, { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" });
    const decision = core.getDecision(token, evalResult.decisionId);
    const snapshot = core.getSnapshot(token, decision.evidenceSnapshotId);
    const decisions = new PostgresDecisionStore(runtimeUrl);
    await decisions.saveDecision(decision, snapshot);
    await decisions.saveDecision(decision, snapshot); // upsert → UPDATE grant exercised
    const readBack = await decisions.getDecision("tenant_northwind", decision.id);
    check("runtime decision upsert works (INSERT … ON CONFLICT DO UPDATE exercised twice)",
      readBack !== null && readBack.id === decision.id);

    const sessions = new PostgresSessionStore(runtimeUrl);
    const now = "2026-08-20T18:00:00Z";
    await sessions.start({
      id: "ses-1", tenantId: "tenant_northwind", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01",
      workflowKey: "clinical-session", status: "active", outcome: decision.outcome, decisionId: decision.id,
      createdAt: now, lastSeenAt: now, expiresAt: "2026-08-20T20:00:00Z",
    });
    const ended = await sessions.end("tenant_northwind", "ses-1");
    check("runtime session start + lifecycle transition (UPDATE) works", ended !== null && ended.status === "ended");

    // ── 2. NEGATIVE: destruction is a privilege the runtime does not hold ────
    check("runtime UPDATE on the ledger is DENIED (42501) — append-only by privilege",
      (await deniedCode(runtime, "UPDATE audit_ledger SET hash = 'forged' WHERE seq = 1")) === "42501");
    check("runtime DELETE on the ledger is DENIED (42501)",
      (await deniedCode(runtime, "DELETE FROM audit_ledger WHERE seq = 1")) === "42501");
    check("runtime TRUNCATE on the ledger is DENIED (42501)",
      (await deniedCode(runtime, "TRUNCATE audit_ledger")) === "42501");
    check("runtime DELETE on decisions is DENIED (42501) — upsert needs UPDATE, never DELETE",
      (await deniedCode(runtime, "DELETE FROM decisions WHERE id = 'dec-1'")) === "42501");
    check("runtime DROP TABLE is DENIED (not the owner)",
      (await deniedCode(runtime, "DROP TABLE audit_ledger")) === "42501");
    check("runtime ALTER TABLE is DENIED (not the owner)",
      (await deniedCode(runtime, "ALTER TABLE audit_ledger ADD COLUMN sneaky TEXT")) === "42501");
    check("runtime CREATE TABLE is DENIED (no CREATE on the schema)",
      (await deniedCode(runtime, "CREATE TABLE runtime_probe (x INT)")) === "42501");

    // ── 2b. POISONED GRANTS CONVERGE: the reset is wider than the role ───────
    // Three ways an UPDATE can reach the runtime that a plain role-level
    // REVOKE never touches: a PUBLIC grant (inherited by every login), a
    // column-level ACL (survives table-level REVOKE ALL), and a direct grant
    // on the ledger's sequence (setval could wedge all future appends). Stage
    // all three, verify each is really effective, re-apply, verify each gone.
    const seqRow = await admin.query("SELECT pg_get_serial_sequence('public.audit_ledger', 'seq') AS s");
    const ledgerSeq: string = seqRow.rows[0].s;
    await admin.query("GRANT UPDATE ON public.audit_ledger TO PUBLIC");
    await admin.query(`GRANT UPDATE (hash) ON public.audit_ledger TO ${RUNTIME_ROLE}`);
    await admin.query(`GRANT UPDATE ON SEQUENCE ${ledgerSeq} TO ${RUNTIME_ROLE}`);
    await admin.query(`GRANT CREATE ON SCHEMA public TO ${RUNTIME_ROLE}`);
    await admin.query(`GRANT CREATE ON DATABASE "${dbname}" TO ${RUNTIME_ROLE}`);
    const WEDGES = `
      SELECT has_table_privilege('${RUNTIME_ROLE}', 'public.audit_ledger', 'UPDATE') AS via_public,
             has_column_privilege('${RUNTIME_ROLE}', 'public.audit_ledger', 'hash', 'UPDATE') AS via_column,
             has_sequence_privilege('${RUNTIME_ROLE}', '${ledgerSeq}', 'UPDATE') AS via_sequence,
             has_schema_privilege('${RUNTIME_ROLE}', 'public', 'CREATE') AS via_schema,
             has_database_privilege('${RUNTIME_ROLE}', '${dbname}', 'CREATE') AS via_database
    `;
    const staged = (await admin.query(WEDGES)).rows[0] ?? {};
    check("wedges staged: PUBLIC-, column-, sequence-, schema-, and database-level grants all reach the runtime",
      staged.via_public === true && staged.via_column === true && staged.via_sequence === true &&
        staged.via_schema === true && staged.via_database === true);
    await applyRoleSplit(url!);
    const converged = (await admin.query(WEDGES)).rows[0] ?? {};
    check("re-apply CONVERGES: all five back-door paths are revoked (PUBLIC, column ACL, sequence, schema CREATE, database CREATE)",
      converged.via_public === false && converged.via_column === false && converged.via_sequence === false &&
        converged.via_schema === false && converged.via_database === false);
    check("…and the runtime's setval() on the ledger sequence is DENIED (42501) — the counter cannot be wedged",
      (await deniedCode(runtime, `SELECT setval('${ledgerSeq}', 1000)`)) === "42501");
    check("…and the runtime's CREATE TABLE is STILL denied after the staged direct schema grant (no-DDL holds)",
      (await deniedCode(runtime, "CREATE TABLE runtime_probe_2 (x INT)")) === "42501");

    // ── 3. NON-VACUITY: the ADMIN can do what the runtime cannot ─────────────
    // Inside a rolled-back transaction so the genuine chain is untouched: the
    // point is that the denial above is the ROLE, not the table.
    const adminClient = await admin.connect();
    let adminCanUpdate = false;
    try {
      await adminClient.query("BEGIN");
      const r = await adminClient.query("UPDATE audit_ledger SET request_id = 'admin-touch' WHERE seq = 1");
      adminCanUpdate = r.rowCount === 1;
    } finally {
      await adminClient.query("ROLLBACK");
      adminClient.release();
    }
    check("NON-VACUITY: the admin credential CAN update the ledger (rolled back) — the denial is the role", adminCanUpdate);

    // The runtime owns nothing.
    const owner = await admin.query(
      "SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_ledger'",
    );
    check("the ledger's owner is the admin credential, not the runtime role", owner.rows[0]?.tableowner !== RUNTIME_ROLE);

    // ── 4. RESTORE recreates the POSTURE, not just the rows ──────────────────
    const archive = join(workdir, "role-split.dump");
    await createBackup(url!, archive, "2026-08-20T18:30:00Z");

    // Destroy the posture deliberately, and PROVE it is destroyed — without
    // this, "restore recreated the posture" could be a no-op assertion.
    await admin.query(`REVOKE ALL ON audit_ledger, decisions, evidence_snapshots, sessions FROM ${RUNTIME_ROLE}`);
    check("posture destroyed: the runtime's ledger INSERT is now DENIED (the re-application below is not a no-op)",
      (await deniedCode(runtime, "INSERT INTO audit_ledger (id, ts, actor, event_type, prev_hash, hash) VALUES ('x', now(), '{}', 'probe', '', 'h')")) === "42501");

    // A store built over missing grants must refuse READINESS, not initialize
    // "healthy" and let /readyz send traffic at writes that will 42501. The
    // tables all exist here — only the privileges are gone — which is exactly
    // the case an existence-only probe gets wrong.
    const degraded = new PostgresDecisionStore(runtimeUrl);
    check("a store facing missing grants REFUSES readiness (ping fails naming privileges — /readyz cannot lie)",
      /privilege/i.test(await failureOf(() => degraded.ping())));
    await degraded.close();
    // ALL durable components refuse, not just the decision store — a probe
    // covering two of the four runtime tables would let session or ledger
    // grant regressions ride under a green readyz.
    const degradedSessions = new PostgresSessionStore(runtimeUrl);
    check("the SESSION store's ping refuses too (grant regressions on sessions cannot hide behind decisions)",
      /privilege/i.test(await failureOf(() => degradedSessions.ping())));
    await degradedSessions.close();
    const degradedLedger = new PostgresAuditBackend(runtimeUrl);
    check("the AUDIT backend's ping refuses too (a ledger that cannot append is not ready)",
      /privilege/i.test(await failureOf(() => degradedLedger.ping())));
    await degradedLedger.close();

    // REPAIR: the remedy every error message names — `pnpm run db:migrate` —
    // must actually work on a database already recorded at v2, where no
    // migration is pending to carry the grants in. applied=[] AND the posture
    // is back is exactly the claim.
    const repaired = await runMigrations(url!);
    check("repair path: db:migrate on an already-current database re-applies the posture (applied=[], grants back)",
      repaired.applied.length === 0 &&
        (await deniedCode(runtime, "INSERT INTO audit_ledger (id, ts, actor, event_type, prev_hash, hash) VALUES ('repair-probe', now(), '{}', 'probe', '', 'h')")) === null);
    // Re-stage the destroyed posture so the restore below re-applies from a
    // genuinely broken state, not from the repair we just proved.
    await admin.query("DELETE FROM audit_ledger WHERE id = 'repair-probe'");
    await admin.query(`REVOKE ALL ON audit_ledger, decisions, evidence_snapshots, sessions FROM ${RUNTIME_ROLE}`);

    await restoreBackup(url!, archive);

    // The same records came back…
    setAuditBackend(new PostgresAuditBackend(runtimeUrl));
    const restoredChain = await verifyLedger();
    check("after restore: the ledger verifies with the same count", restoredChain.ok === true && restoredChain.count === 3);
    // …the runtime can WORK again…
    await appendAuditRecord("decision.allow", { type: "system" }, { meta: { after: "restore" } });
    const grown = await verifyLedger();
    check("after restore: the runtime can append again (posture re-applied by the restore itself)", grown.ok === true && grown.count === 4);
    // …and still cannot DESTROY — the restore did not hand it ownership or width.
    check("after restore: runtime UPDATE is STILL denied (the split survives the round trip)",
      (await deniedCode(runtime, "UPDATE audit_ledger SET hash = 'forged' WHERE seq = 1")) === "42501");
    check("after restore: runtime DROP is STILL denied",
      (await deniedCode(runtime, "DROP TABLE audit_ledger")) === "42501");
    const ownerAfter = await admin.query(
      "SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = 'audit_ledger'",
    );
    check("after restore: the runtime is STILL not the owner (--no-owner cannot be smuggled around)",
      ownerAfter.rows[0]?.tableowner !== RUNTIME_ROLE);
    // …and a fresh store passes the privilege-probing readiness check — the
    // counterpart of the degraded refusal above, so the probe is proven able to
    // say yes as well as no.
    const healthy = new PostgresDecisionStore(runtimeUrl);
    check("after restore: a fresh store's readiness probe passes (the probe can say yes, not only no)",
      (await failureOf(() => healthy.ping())) === "");
    await healthy.close();

    await runtime.end();

    // ── 5a. RESTORE REFUSES a credential without GRANT AUTHORITY ─────────────
    // The runtime role exists and is valid here — but the restoring credential
    // does not own the database, so applyRoleSplit's GRANT CONNECT ON DATABASE
    // would fail AFTER pg_restore had already replaced everything. The
    // precheck must catch the credential's own authority, not just the role.
    await admin.query(dropRoleSql("sg_dbless_admin"));
    // Ephemeral throwaway-cluster credential, same standing as the others. gitleaks:allow
    await admin.query("CREATE ROLE sg_dbless_admin LOGIN PASSWORD 'sg-dbless-proof'"); // gitleaks:allow
    await admin.query(`GRANT CONNECT ON DATABASE "${dbname}" TO sg_dbless_admin`);
    const dblessUrl = withLogin(url!, "sg_dbless_admin", "sg-dbless-proof");
    const beforeAuthority = await admin.query("SELECT count(*)::int AS n FROM audit_ledger");
    const refusedAuthority = await failureOf(() => restoreBackup(dblessUrl, archive));
    check("restore REFUSES a credential without grant authority (not the database owner, not superuser)",
      /database owner/.test(refusedAuthority));
    const afterAuthority = await admin.query("SELECT count(*)::int AS n FROM audit_ledger");
    check("…and refused BEFORE pg_restore replaced anything (ledger untouched by the authority refusal)",
      afterAuthority.rows[0]?.n === beforeAuthority.rows[0]?.n && beforeAuthority.rows[0]?.n === 4);
    await admin.query(dropRoleSql("sg_dbless_admin"));

    // ── 5. RESTORE REFUSES BEFORE pg_restore when re-provisioning would fail ─
    // Stage the disaster: the runtime role is gone entirely, and the credential
    // attempting the restore cannot create roles. pg_restore --clean would
    // REPLACE the database and only then die in post-restore re-provisioning —
    // the precheck must refuse first, with the database untouched as the proof.
    await admin.query(dropRuntimeRoleSql());
    const beforeRefusal = await admin.query("SELECT count(*)::int AS n FROM audit_ledger");
    const refusedRestore = await failureOf(() => restoreBackup(limitedUrl, archive));
    check("restore REFUSES up front when the role is gone and the credential lacks CREATEROLE",
      refusedRestore.includes("CREATEROLE"));
    const afterRefusal = await admin.query("SELECT count(*)::int AS n FROM audit_ledger");
    check("…and refused BEFORE pg_restore replaced anything (ledger row count untouched)",
      afterRefusal.rows[0]?.n === beforeRefusal.rows[0]?.n && beforeRefusal.rows[0]?.n === 4);

    // Role loss RECOVERS: the admin re-applies the split, resets the deploy
    // password, and the system converges back to the same posture — working
    // writes, denied destruction.
    await applyRoleSplit(url!);
    await admin.query(`ALTER ROLE ${RUNTIME_ROLE} PASSWORD '${RUNTIME_PASSWORD}'`);
    const recoveredRuntime = new Pool({ connectionString: runtimeUrl });
    setAuditBackend(new PostgresAuditBackend(runtimeUrl));
    await appendAuditRecord("decision.allow", { type: "system" }, { meta: { after: "role-loss recovery" } });
    const recovered = await verifyLedger();
    check("role loss recovers: applyRoleSplit + password reset and the runtime appends again (chain verifies at 5)",
      recovered.ok === true && recovered.count === 5);
    check("…and the recovered role STILL cannot UPDATE the ledger (recovery converges to the same posture)",
      (await deniedCode(recoveredRuntime, "UPDATE audit_ledger SET hash = 'forged' WHERE seq = 1")) === "42501");
    await recoveredRuntime.end();

    // A hardened database revokes PUBLIC's ambient CONNECT. The runtime must
    // hold its own grant (applyRoleSplit issues it), or a fully-granted role
    // still cannot open a connection. Left revoked on purpose — the re-run
    // exercises the proof from hardened state.
    await admin.query(`REVOKE CONNECT ON DATABASE "${dbname}" FROM PUBLIC`);
    const hardenedConn = new Pool({ connectionString: runtimeUrl, max: 1 });
    check("runtime connects through its DIRECT CONNECT grant with PUBLIC's ambient CONNECT revoked (hardened DB)",
      (await failureOf(async () => { await hardenedConn.query("SELECT 1"); })) === "");
    await hardenedConn.end();
    await admin.query(dropRoleSql("sg_limited_admin"));
  } finally {
    await admin.end();
    await rm(workdir, { recursive: true, force: true });
  }
}

await main();
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
