// The operator-facing backup/restore command.
//
// The proof (`backup-restore-proof.ts`) shows the mechanism works. This is the thing
// an operator actually runs — because a capability with no command is a capability
// nobody can use, and "there is a module for it" is not an answer at 3am.
//
//   DATABASE_URL=postgres://... pnpm run db:backup  -- ./backups
//   DATABASE_URL=postgres://... pnpm run db:restore -- ./backups/signalgrid-<stamp>.dump
//
// RESTORE OVERWRITES. It is not asked for confirmation here because it is a
// non-interactive tool that may run from a script; the guard is that it refuses an
// archive it cannot verify, and prints exactly what it is about to replace.

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  createBackup,
  restoreBackup,
  verifyBackup,
  describeDatabase,
  manifestPathFor,
  BackupError,
} from "./lib/backup";

function usage(): never {
  console.error(`usage:
  backup-cli backup  <output-directory>   create a verified backup
  backup-cli restore <archive.dump>       verify, then restore (OVERWRITES the database)
  backup-cli verify  <archive.dump>       check an archive without touching the database

DATABASE_URL must be set for backup and restore.`);
  process.exit(2);
}

async function main() {
  // Drop a bare `--`. `pnpm run db:backup -- ./backups` passes the separator straight
  // through, and the first version of this took it as the target — writing the archive
  // to a directory literally named `--`. Found by running the command the way the
  // README tells an operator to run it, which is the only way that class of defect
  // ever shows up.
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const [command, target] = argv;
  if (!command || !target) usage();

  if (command === "verify") {
    const manifest = await verifyBackup(resolve(target));
    console.log(`archive verified`);
    console.log(`  taken:      ${manifest.createdAt}`);
    console.log(`  sha256:     ${manifest.sha256}`);
    console.log(`  bytes:      ${manifest.bytes}`);
    console.log(`  pg_dump:    ${manifest.pgDumpVersion}`);
    console.log(`  audit head: ${manifest.auditHeadHash ?? "(no ledger in this backup)"}`);
    console.log(`  audit rows: ${manifest.auditCount ?? 0}`);
    for (const [table, n] of Object.entries(manifest.tables)) console.log(`  ${table}: ${n} row(s)`);
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Refusing to guess which database you meant.");
    process.exit(2);
  }

  if (command === "backup") {
    const dir = resolve(target);
    await mkdir(dir, { recursive: true });
    // The stamp is read here, at the edge, and passed in — the library never reads a
    // clock, so a caller can reproduce a run exactly.
    const stamp = new Date().toISOString();
    const archive = join(dir, `signalgrid-${stamp.replace(/[:.]/g, "-")}.dump`);
    const manifest = await createBackup(url, archive, stamp);
    console.log(`backup written`);
    console.log(`  archive:  ${archive}`);
    console.log(`  manifest: ${manifestPathFor(archive)}`);
    console.log(`  sha256:   ${manifest.sha256}`);
    console.log(`  ${manifest.auditCount ?? 0} audit record(s), head ${manifest.auditHeadHash ?? "(none)"}`);
    console.log(`
Keep the .manifest.json NEXT TO the archive. A restore refuses an archive it cannot
check, so an archive without its manifest is not restorable by this tool.`);
    return;
  }

  if (command === "restore") {
    const archive = resolve(target);
    // Verify and report BEFORE replacing anything, so an operator sees what they are
    // about to overwrite and what they are about to install.
    const manifest = await verifyBackup(archive);
    const current = await describeDatabase(url);
    console.log(`about to restore into the database named by DATABASE_URL`);
    console.log(`  currently: ${Object.keys(current.tables).length} table(s), ${current.auditCount ?? 0} audit record(s)`);
    console.log(`  archive:   ${manifest.tables ? Object.keys(manifest.tables).length : 0} table(s), ${manifest.auditCount ?? 0} audit record(s), taken ${manifest.createdAt}`);

    await restoreBackup(url, archive);

    const after = await describeDatabase(url);
    console.log(`restore complete`);
    console.log(`  now: ${Object.keys(after.tables).length} table(s), ${after.auditCount ?? 0} audit record(s)`);

    // Report rather than assume. A restore that produced a different head is a fact the
    // operator needs immediately, not on the next audit.
    if (after.auditHeadHash !== manifest.auditHeadHash) {
      console.error(
        `\nWARNING: the restored audit head (${after.auditHeadHash ?? "none"}) does not match
the manifest (${manifest.auditHeadHash ?? "none"}). The rows restored, but this is not the
chain the backup recorded. Do not treat this ledger as continuous until it is explained.`,
      );
      process.exit(1);
    }
    console.log(`  audit head matches the manifest: ${after.auditHeadHash ?? "(no ledger)"}`);
    // This used to tell the operator to run `proof:audit-ledger-pg` here. That proof
    // DROPS the audit_ledger table as its first statement — following the advice
    // destroyed the ledger the restore had just brought back. The non-destructive
    // whole-chain verifier that advice was reaching for now exists; point at it.
    console.log(`
A matching head hash means the same last record. To verify every record between —
the whole chain, paginated, read-only — run:

  DATABASE_URL=... pnpm run db:verify-ledger

Do NOT run proof:audit-ledger-pg against real data; it drops the table it tests.`);
    return;
  }

  usage();
}

main().catch((err) => {
  if (err instanceof BackupError) {
    // A refusal is an expected outcome, not a crash. Print it as a decision.
    console.error(`refused: ${err.message}`);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
