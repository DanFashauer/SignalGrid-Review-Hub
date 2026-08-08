// Proof: a self-hosted SignalGrid database can be backed up, LOST, and restored —
// with the audit chain still verifying afterwards.
//
// A backup nobody has restored is not a backup. The restore path is the one that is
// never exercised until the day it matters, and this repository had neither: no
// `pg_dump` anywhere, and so no evidence that the tamper-evident ledger survives a
// round trip at all.
//
// SELF-SKIPS when DATABASE_URL is unset, so preflight stays deterministic and needs no
// external service. Point it at a throwaway Postgres:
//
//   DATABASE_URL=postgres://sg@localhost:5433/signalgrid \
//     pnpm --filter @workspace/scripts run proof:backup-restore
//
// What it proves:
//   1. ROUND TRIP    — counts, head hash and the verified chain all come back.
//   2. REAL LOSS     — the database is genuinely destroyed in between, and that is
//      asserted, not assumed. Without this the "restore" could be a no-op and every
//      other assertion would still pass.
//   3. INTEGRITY     — a single flipped byte in the archive is REFUSED, not restored.
//   4. HONEST GAPS   — a missing manifest is refused; a size mismatch is refused.

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendAuditRecord,
  verifyLedger,
  setAuditBackend,
  PostgresAuditBackend,
} from "@workspace/audit";

import {
  createBackup,
  restoreBackup,
  verifyBackup,
  describeDatabase,
  manifestPathFor,
  BackupError,
} from "./lib/backup";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("Backup/restore proof: SKIPPED (DATABASE_URL unset — this proof needs a real Postgres).");
  process.exit(0);
}

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

/** The archive is written under a temp dir; nothing is left in the repo. */
async function main() {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const admin = new Pool({ connectionString: url });
  const workdir = await mkdtemp(join(tmpdir(), "sg-backup-"));
  const archive = join(workdir, "signalgrid.dump");

  try {
    // ── Seed a ledger worth losing ──────────────────────────────────────────
    await admin.query("DROP TABLE IF EXISTS audit_ledger");
    setAuditBackend(new PostgresAuditBackend(url!));
    const SEEDED = 12;
    for (let i = 0; i < SEEDED; i += 1) {
      await appendAuditRecord("policy.matched", { type: "system" }, { meta: { i } });
    }
    const before = await verifyLedger();
    check(`seeded ledger of ${SEEDED} records verifies before backup`, before.ok === true && before.count === SEEDED);

    const beforeState = await describeDatabase(url!);
    check("the ledger table is present and counted before backup", (beforeState.tables.audit_ledger ?? 0) === SEEDED);

    // ── Back up ─────────────────────────────────────────────────────────────
    // A fixed timestamp: this module never reads a clock, so the caller owns time.
    const manifest = await createBackup(url!, archive, "2026-08-08T00:00:00Z");
    check("backup writes an archive and a manifest", manifest.bytes > 0 && manifest.sha256.length === 64);
    check(
      "the manifest records the audit head hash and count taken at dump time",
      manifest.auditHeadHash === before.headHash && manifest.auditCount === SEEDED,
    );
    check("the manifest records per-table row counts", manifest.tables.audit_ledger === SEEDED);

    // ── Destroy, and PROVE it was destroyed ─────────────────────────────────
    // Without this assertion the restore below could be a no-op and every remaining
    // check would still pass. "The data came back" only means something if it was
    // genuinely gone.
    await admin.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    const wiped = await describeDatabase(url!);
    check(
      "the database is genuinely destroyed before the restore (not a no-op)",
      Object.keys(wiped.tables).length === 0 && wiped.auditHeadHash === null,
    );

    // ── Restore ─────────────────────────────────────────────────────────────
    await restoreBackup(url!, archive);
    const after = await describeDatabase(url!);
    check("every table comes back with the same row count", JSON.stringify(after.tables) === JSON.stringify(beforeState.tables));
    check("the audit head hash is the same chain, not merely some chain", after.auditHeadHash === manifest.auditHeadHash);

    // The one that matters: a restored ledger whose chain no longer verifies would be
    // worse than no restore, because it looks like history.
    setAuditBackend(new PostgresAuditBackend(url!));
    const restored = await verifyLedger();
    check("the restored audit chain still verifies end to end", restored.ok === true && restored.count === SEEDED);
    check("the restored chain's head matches the pre-backup head", restored.headHash === before.headHash);

    // And it must still be appendable — a restore that produces a read-only or
    // broken-sequence ledger has not restored the system, only the rows.
    await appendAuditRecord("policy.matched", { type: "system" }, { meta: { after: true } });
    const extended = await verifyLedger();
    check("the restored ledger can still be appended to, chain intact", extended.ok === true && extended.count === SEEDED + 1);

    // ── Integrity: a damaged archive must be refused ────────────────────────
    // Restore it fresh first, so the corruption test starts from a good archive.
    const good = await readFile(archive);
    const flipped = Buffer.from(good);
    // Flip one bit deep inside the archive body, past any header.
    flipped[Math.floor(flipped.length / 2)] ^= 0x01;
    await writeFile(archive, flipped);
    let refusedCorrupt = false;
    let refusalMentionedChecksum = false;
    try {
      await restoreBackup(url!, archive);
    } catch (e) {
      refusedCorrupt = e instanceof BackupError;
      refusalMentionedChecksum = String(e).includes("checksum");
    }
    check("a single flipped byte in the archive is REFUSED, not restored", refusedCorrupt);
    check("the refusal says what was wrong (checksum), not just that it failed", refusalMentionedChecksum);
    await writeFile(archive, good);

    // A truncated archive is a different failure and must be caught by size before the
    // checksum even runs — a cheap check that also produces a clearer message.
    await writeFile(archive, good.subarray(0, good.length - 16));
    let refusedTruncated = false;
    try {
      await verifyBackup(archive);
    } catch (e) {
      refusedTruncated = e instanceof BackupError && String(e).includes("truncated");
    }
    check("a truncated archive is refused and named as truncated", refusedTruncated);
    await writeFile(archive, good);

    // ── Honest gaps: no manifest means no restore ───────────────────────────
    await rm(manifestPathFor(archive));
    let refusedNoManifest = false;
    try {
      await verifyBackup(archive);
    } catch (e) {
      refusedNoManifest = e instanceof BackupError;
    }
    check("an archive with no manifest is refused rather than assumed good", refusedNoManifest);

    // Positive control on the verifier itself: it must ACCEPT a good archive. A
    // verifier that refuses everything would pass every negative test above.
    await createBackup(url!, archive, "2026-08-08T00:00:00Z");
    let acceptedGood = false;
    try {
      await verifyBackup(archive);
      acceptedGood = true;
    } catch {
      acceptedGood = false;
    }
    check("a good archive is ACCEPTED (the verifier is not simply refusing everything)", acceptedGood);
  } finally {
    await admin.query("DROP TABLE IF EXISTS audit_ledger").catch(() => {});
    await admin.end().catch(() => {});
    await rm(workdir, { recursive: true, force: true }).catch(() => {});
  }

  const total = passed + failures.length;
  console.log(`\nBackup/restore proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `A SignalGrid database was backed up, destroyed, and restored — with the audit chain
verifying end to end afterwards and still appendable.

  NOT established by a green here:
    · point-in-time recovery, WAL archiving, or any RPO/RTO claim. This is a full
      logical dump and a full restore, nothing finer.
    · that a backup is ever actually TAKEN in production. That is a schedule and an
      operator's job; this proves the mechanism, not its use.
    · encryption at rest of the archive, or where it is stored. A dump contains
      everything the database contains.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
