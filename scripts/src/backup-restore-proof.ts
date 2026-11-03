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
//   5. ARCHIVE SHAPE — a checksum-valid archive carrying a TRIGGER, RULE, POLICY or
//      ROW SECURITY on a managed table, or an EVENT TRIGGER, is refused BEFORE
//      pg_restore replaces anything, proven by a sentinel row on the live ledger
//      that a restore would have erased.

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
import { requireDisposableCluster } from "./lib/db-guard";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("Backup/restore proof: SKIPPED (DATABASE_URL unset — this proof needs a real Postgres).");
  process.exit(0);
}
requireDisposableCluster("Backup/restore proof");

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

    // ── Archive shape: foreign machinery is refused UP FRONT ────────────────
    // The archive is checksum-valid and manifest-valid — it is the SHAPE that is
    // wrong: machinery that pg_restore would install on a managed table, or
    // database-wide. A live check runs only after `pg_restore --clean` has already
    // replaced the database. The proof of "BEFORE" is a sentinel row appended to the
    // live ledger after the backup: a restore that ran would erase it.
    //
    // EVENT TRIGGER needs a superuser to create. CI's role is one (it is the
    // POSTGRES_USER of the postgres service); a role that is not fails here, loudly,
    // rather than skipping the case.
    //
    // `unplant` is idempotent and runs twice: once before the restore attempt (the
    // live database must not hold the object, or the refusal proves nothing) and once
    // at the end of the case, so a regression that lets one object leak cannot lie
    // to the next case.
    const shapes = [
      {
        kind: "RULE",
        plant: ["CREATE RULE sg_r AS ON DELETE TO public.audit_ledger DO INSTEAD NOTHING"],
        unplant: ["DROP RULE IF EXISTS sg_r ON public.audit_ledger"],
      },
      {
        kind: "TRIGGER",
        plant: [
          "CREATE FUNCTION public.sg_t() RETURNS trigger LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END $fn$",
          "CREATE TRIGGER sg_t BEFORE INSERT ON public.audit_ledger FOR EACH ROW EXECUTE FUNCTION public.sg_t()",
        ],
        unplant: ["DROP TRIGGER IF EXISTS sg_t ON public.audit_ledger", "DROP FUNCTION IF EXISTS public.sg_t() CASCADE"],
      },
      {
        kind: "EVENT TRIGGER",
        plant: [
          "CREATE FUNCTION public.sg_evt() RETURNS event_trigger LANGUAGE plpgsql AS $fn$ BEGIN NULL; END $fn$",
          "CREATE EVENT TRIGGER sg_evt ON ddl_command_end EXECUTE FUNCTION public.sg_evt()",
        ],
        unplant: ["DROP EVENT TRIGGER IF EXISTS sg_evt", "DROP FUNCTION IF EXISTS public.sg_evt() CASCADE"],
      },
      {
        kind: "POLICY",
        plant: ["CREATE POLICY sg_p ON public.audit_ledger USING (true)"],
        unplant: ["DROP POLICY IF EXISTS sg_p ON public.audit_ledger"],
      },
      {
        kind: "ROW SECURITY",
        plant: ["ALTER TABLE public.audit_ledger ENABLE ROW LEVEL SECURITY"],
        unplant: ["ALTER TABLE public.audit_ledger DISABLE ROW LEVEL SECURITY"],
      },
    ];
    for (const { kind, plant, unplant } of shapes) {
      const shaped = join(workdir, `shaped-${kind.replace(/ /g, "-")}.dump`);
      for (const sql of plant) await admin.query(sql);
      await createBackup(url!, shaped, "2026-08-08T00:00:00Z");
      for (const sql of unplant) await admin.query(sql);
      await appendAuditRecord("policy.matched", { type: "system" }, { meta: { sentinel: kind } });
      const live = await describeDatabase(url!);
      let refusal: unknown;
      try {
        await restoreBackup(url!, shaped);
      } catch (e) {
        refusal = e;
      }
      check(
        `an archive carrying ${kind} is REFUSED (BackupError naming ${kind})`,
        refusal instanceof BackupError && String(refusal).includes(kind),
      );
      const kept = await describeDatabase(url!);
      check(
        `…and refused BEFORE pg_restore replaced anything (${kind} case: ledger and sentinel unchanged)`,
        kept.auditCount === live.auditCount && kept.auditHeadHash === live.auditHeadHash,
      );
      const leaked = await admin.query(
        `SELECT (SELECT count(*) FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
                  WHERE c.relname = 'audit_ledger' AND r.rulename <> '_RETURN')
              + (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.audit_ledger'::regclass AND NOT tgisinternal)
              + (SELECT count(*) FROM pg_event_trigger)
              + (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.audit_ledger'::regclass)
              + (SELECT count(*) FROM pg_class WHERE oid = 'public.audit_ledger'::regclass AND relrowsecurity) AS n`,
      );
      check(`…and the ${kind} did not leak into the live database`, Number(leaked.rows[0].n) === 0);
      for (const sql of unplant) await admin.query(sql);
    }
  } finally {
    // On a failed run the planted objects may still stand, and the next proof in CI
    // order must start clean. The event trigger goes first: it is database-wide, so a
    // leaked one would fire on every later proof's DDL. Dropping the ledger removes its
    // rules, triggers, policies and the sentinel rows; the functions outlive it.
    await admin.query("DROP EVENT TRIGGER IF EXISTS sg_evt").catch(() => {});
    await admin.query("DROP TABLE IF EXISTS audit_ledger").catch(() => {});
    await admin.query("DROP FUNCTION IF EXISTS public.sg_evt() CASCADE").catch(() => {});
    await admin.query("DROP FUNCTION IF EXISTS public.sg_t() CASCADE").catch(() => {});
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
