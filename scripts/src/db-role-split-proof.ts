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

import {
  appendAuditRecord,
  verifyLedger,
  setAuditBackend,
  PostgresAuditBackend,
} from "@workspace/audit";
import {
  PostgresDecisionStore,
  PostgresSessionStore,
  runMigrations,
  RUNTIME_ROLE,
} from "@workspace/persistence";
import { SignalGridCore } from "@workspace/signalgrid-core";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBackup, restoreBackup } from "./lib/backup";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DB role-split proof: SKIPPED (DATABASE_URL unset — this proof needs a real Postgres).");
  process.exit(0);
}

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
    // ── Clean slate, then the REAL provisioning path: migrations v1 + v2 ─────
    await admin.query("DROP TABLE IF EXISTS audit_ledger, decisions, evidence_snapshots, sessions, schema_version CASCADE");
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

    await runtime.end();
  } finally {
    await admin.end();
    await rm(workdir, { recursive: true, force: true });
  }
}

await main();
const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
