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
  verifyLedgerFull,
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

  // ── 6. PAGINATING VERIFIER on the real database ────────────────────────────
  // The capped verifier's false all-clear was worst HERE: only Postgres ledgers
  // ever grow past the cap. Reuse the 25-row chain: paginate in batches of 10,
  // then plant a tamper in the THIRD batch via direct UPDATE (row 21 → global
  // index 20, the first record of batch 3) so detection requires the linking
  // hash to survive the page turn on the SQL OFFSET/LIMIT path specifically.
  const fullClean = await verifyLedgerFull({ batchSize: 10 });
  check("verifyLedgerFull pages the persisted chain end to end (3 batches of 10)",
    fullClean.ok === true && fullClean.count === N && fullClean.batches === 3);

  const cappedHonest = await verifyLedger(10);
  check("the capped verifier over a longer persisted ledger says truncated:true",
    cappedHonest.ok === true && cappedHonest.truncated === true);

  await admin.query(
    "UPDATE audit_ledger SET meta = '{\"i\":999}'::jsonb WHERE seq = (SELECT seq FROM audit_ledger ORDER BY seq ASC OFFSET 20 LIMIT 1)",
  );
  const beyond = await verifyLedgerFull({ batchSize: 10 });
  check("verifyLedgerFull DETECTS a direct-UPDATE tamper planted beyond the first batch", beyond.ok === false);
  check("…localized to the correct global index across SQL pagination", beyond.brokenAtIndex === 20);
  const blindPrefix = await verifyLedger(10);
  check("the capped verifier still passes its clean 10-row prefix over the same tampered ledger",
    blindPrefix.ok === true && blindPrefix.truncated === true);

  // ── END-TRUNCATION: what the chain CANNOT see ────────────────────────────────
  //
  // A hash chain binds each record to the one before it. Delete records from the
  // END and every surviving link still recomputes — so the verifier reports a
  // clean chain over a ledger whose recent history has been removed. Confirmed
  // against a real Postgres before it was written down: 40 records seeded, the
  // last 10 deleted, `db:verify-ledger` printed "Chain intact" and exited 0.
  //
  // Asserted here as a PASSING assertion on purpose. This is a known limit of the
  // construction, not a bug in the verifier, and the only thing worse than the
  // limit is rediscovering it during an incident. Pinning it means that the day
  // someone adds an external anchor or a monotonic counter, THIS assertion fails
  // and the doctrine gets updated deliberately instead of drifting.
  //
  // The operator-facing answer is `db:verify-ledger --min-records N`: the expected
  // count is an assertion the ledger's OWNER makes, because nothing inside the
  // chain can make it.
  await admin.query("DROP TABLE IF EXISTS audit_ledger");
  setAuditBackend(new PostgresAuditBackend(url!));
  for (let i = 0; i < 12; i++) {
    await appendAuditRecord("admin.access", { type: "admin", id: "op" }, { meta: { i } });
  }
  const beforeCut = await verifyLedgerFull({ batchSize: 100 });
  check("truncation setup: 12 records, chain intact", beforeCut.ok === true && beforeCut.count === 12);

  await admin.query("DELETE FROM audit_ledger WHERE seq > (SELECT MIN(seq) + 7 FROM audit_ledger)");
  const afterCut = await verifyLedgerFull({ batchSize: 100 });
  check(
    "KNOWN LIMIT: deleting records from the END leaves the chain verifying CLEAN — " +
      "a hash chain detects edits, not deletions of its own tail",
    afterCut.ok === true && afterCut.count === 8,
  );
  check(
    "…and the head MOVED, so a separately-recorded head or count is what detects it",
    afterCut.headHash !== beforeCut.headHash,
  );

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
