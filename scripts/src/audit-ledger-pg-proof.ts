// Proof: the audit ledger on REAL Postgres (durability + tamper-evidence +
// concurrency). This is the production-persistence proof for @workspace/audit.
//
// It SELF-SKIPS when DATABASE_URL is unset, so the default preflight (which runs
// no external services) passes trivially and stays deterministic. Point it at a
// throwaway Postgres to exercise the durable path:
//
//   DATABASE_URL=postgres://sg@localhost:5433/signalgrid \
//     pnpm --filter @workspace/scripts run proof:audit-ledger-pg
//
// What it proves against a real database:
//   1. DURABILITY   — records written by one backend instance are read back by a
//      SEPARATE instance (survives a "reconnect"), which the in-memory store can't.
//   2. INTEGRITY    — verifyLedger accepts the genuine chain and localizes a
//      tampered row (simulated via a direct UPDATE).
//   3. REDACTION    — a secret in array-valued metadata never lands in the DB.
//   4. CONCURRENCY  — N concurrent appends produce an intact, fork-free chain
//      (the advisory-lock critical section holds).

import {
  appendAuditRecord,
  getAuditRecords,
  verifyLedger,
  setAuditBackend,
  PostgresAuditBackend,
} from "@workspace/audit";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("Audit-ledger PG proof: SKIPPED (DATABASE_URL unset — in-memory default is covered by proof:audit-ledger).");
  process.exit(0);
}

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };
// A deliberately fake, obviously-not-real value used ONLY to prove it gets
// redacted before it can reach the database. Not a credential. gitleaks:allow
const SECRET = "pg-s3cr3t-never-persisted"; // gitleaks:allow

async function main() {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const admin = new Pool({ connectionString: url });
  // Clean slate so counts are deterministic across reruns.
  await admin.query("DROP TABLE IF EXISTS audit_ledger");

  // ── write through backend instance A ──────────────────────────────────────
  setAuditBackend(new PostgresAuditBackend(url!));
  await appendAuditRecord("admin.access", { type: "admin", id: "a1" }, {
    meta: { action: "rotate", headers: [{ authorization: SECRET }], token: SECRET },
  });
  await appendAuditRecord("session.start", { type: "user", id: "u1" }, { meta: { reason: "login" } });
  await appendAuditRecord("decision.allow", { type: "system" }, { meta: { outcome: "allow" } });

  // ── 1. DURABILITY: a SEPARATE instance reads the same chain ────────────────
  const b = new PostgresAuditBackend(url!);
  setAuditBackend(b);
  const reread = await getAuditRecords();
  check("durability: a fresh backend instance reads all 3 persisted records", reread.length === 3);

  // ── 2. INTEGRITY: genuine chain verifies ───────────────────────────────────
  const clean = await verifyLedger();
  check("genuine persisted chain verifies ok", clean.ok === true && clean.count === 3);

  // ── 3. REDACTION: no secret reached the database ───────────────────────────
  const raw = await admin.query("SELECT meta::text AS m FROM audit_ledger");
  const anySecret = raw.rows.some((r: any) => (r.m || "").includes(SECRET));
  check("no secret value is persisted (redacted at any depth, incl. arrays)", !anySecret);

  // ── 4. INTEGRITY: a direct DB tamper is detected at the right row ───────────
  await admin.query(
    "UPDATE audit_ledger SET meta = '{\"action\":\"tampered\"}'::jsonb WHERE seq = (SELECT MIN(seq) FROM audit_ledger)",
  );
  const broken = await verifyLedger();
  check("verifyLedger DETECTS a row mutated directly in the database", broken.ok === false);
  check("tamper is localized to the first record", broken.brokenAtIndex === 0);

  // ── 5. CONCURRENCY: parallel appends keep the chain intact ─────────────────
  await admin.query("TRUNCATE audit_ledger RESTART IDENTITY");
  setAuditBackend(new PostgresAuditBackend(url!));
  const N = 25;
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      appendAuditRecord("policy.matched", { type: "system" }, { meta: { i } }),
    ),
  );
  const conc = await verifyLedger();
  check(`concurrency: ${N} parallel appends produce an intact, fork-free chain`, conc.ok === true && conc.count === N);

  await admin.query("DROP TABLE IF EXISTS audit_ledger");
  await admin.end();
  await b.close?.();

  const total = passed + failures.length;
  console.log(`Audit-ledger PG proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Durable audit ledger verified on real Postgres — durability, tamper-evidence, redaction, concurrency.");
}

main().catch((err) => { console.error(err); process.exit(1); });
