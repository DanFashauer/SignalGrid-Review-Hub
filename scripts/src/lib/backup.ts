// Backup and restore for a self-hosted SignalGrid database.
//
// WHY THIS EXISTS. The audit ledger is a tamper-evident hash chain and the product's
// whole claim about it is that a decision can be shown to have happened, unaltered.
// Until now this repository had NO backup path at all — `pg_dump` appeared in zero
// files — which means an operator running the durable stack had a ledger they could
// lose, and no way to prove a restore of it was the same ledger.
//
// THE TWO RULES THIS MODULE IS BUILT AROUND:
//
//   1. A RESTORE VERIFIES BEFORE IT RESTORES. A truncated or altered archive is
//      refused, not installed. Restoring a damaged ledger is worse than failing to
//      restore: the operator ends up with something that looks like history.
//   2. A BACKUP RECORDS WHAT IT CONTAINED. The manifest carries the audit head hash
//      and row counts taken at dump time, so "the restore worked" is checkable
//      against what was backed up rather than against nothing.
//
// A backup nobody has restored is not a backup. `scripts/src/backup-restore-proof.ts`
// takes a real database, backs it up, DESTROYS it, restores, and re-verifies the
// chain — because the restore path is the one that is never exercised until the day
// it matters.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

/** What a backup claims about itself. Written next to the archive. */
export interface BackupManifest {
  /** Bumped when the manifest shape changes, so an old manifest is not misread. */
  manifestVersion: 1;
  /** RFC3339. Passed in by the caller — this module never reads a clock. */
  createdAt: string;
  /** The archive's SHA-256, checked before any restore. */
  sha256: string;
  bytes: number;
  /** `pg_dump --version`, because a dump is only restorable by a compatible tool. */
  pgDumpVersion: string;
  /** Row counts per table at dump time. */
  tables: Record<string, number>;
  /**
   * The audit chain's head hash and length at dump time. This is what makes a
   * restore checkable: the same chain must come back, not merely some chain.
   * Null when the ledger table did not exist yet — a fact, not a failure.
   */
  auditHeadHash: string | null;
  auditCount: number | null;
}

export class BackupError extends Error {}

async function sha256File(path: string): Promise<string> {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

export function manifestPathFor(archivePath: string): string {
  return `${archivePath}.manifest.json`;
}

/** Every table in the public schema, discovered rather than listed. */
async function tableRowCounts(url: string): Promise<Record<string, number>> {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const pool = new Pool({ connectionString: url });
  try {
    // Derived from the catalog: a hard-coded table list would silently stop counting
    // a table added later, and the manifest would look complete while missing it.
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    );
    const counts: Record<string, number> = {};
    for (const r of rows as { tablename: string }[]) {
      // Identifier comes from pg_tables, not from user input; quoted defensively.
      const c = await pool.query(`SELECT count(*)::int AS n FROM "${r.tablename}"`);
      counts[r.tablename] = c.rows[0].n;
    }
    return counts;
  } finally {
    await pool.end();
  }
}

async function auditHead(url: string): Promise<{ head: string | null; count: number | null }> {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const pool = new Pool({ connectionString: url });
  try {
    const exists = await pool.query(`SELECT to_regclass('public.audit_ledger') IS NOT NULL AS ok`);
    if (!exists.rows[0].ok) return { head: null, count: null };
    // ORDER BY seq, NOT id. `seq` is the BIGSERIAL insertion order the chain is built
    // in (see lib/audit/src/backend.ts, which reads its own head the same way); `id`
    // is the record's own identifier and sorts arbitrarily.
    //
    // The first version of this used `id` and recorded a head hash belonging to some
    // other row. Every restore assertion still passed, because they compared this
    // function's output against ITSELF — the proof only caught it because one check
    // compares against `verifyLedger()`, which computes the head independently. A
    // manifest that records the wrong head is worse than one that records none: it
    // looks like an integrity claim and is not one.
    const { rows } = await pool.query(
      `SELECT hash FROM audit_ledger ORDER BY seq DESC LIMIT 1`,
    );
    const counted = await pool.query(`SELECT count(*)::int AS n FROM audit_ledger`);
    if (rows.length === 0) return { head: null, count: 0 };
    return { head: rows[0].hash, count: counted.rows[0].n };
  } finally {
    await pool.end();
  }
}

/**
 * Create a backup.
 *
 * `createdAt` is an argument rather than a clock read, so the caller owns time and a
 * test can produce a byte-identical run.
 */
export async function createBackup(
  url: string,
  archivePath: string,
  createdAt: string,
): Promise<BackupManifest> {
  // Read the facts BEFORE dumping so the manifest describes what the dump contains.
  const tables = await tableRowCounts(url);
  const { head, count } = await auditHead(url);

  const version = (await run("pg_dump", ["--version"])).stdout.trim();
  // Custom format: compressed, and restorable selectively by pg_restore.
  await run("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", archivePath, url], {
    maxBuffer: 1024 * 1024 * 64,
  });

  const manifest: BackupManifest = {
    manifestVersion: 1,
    createdAt,
    sha256: await sha256File(archivePath),
    bytes: (await stat(archivePath)).size,
    pgDumpVersion: version,
    tables,
    auditHeadHash: head,
    auditCount: count,
  };
  await writeFile(manifestPathFor(archivePath), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/**
 * Read and check an archive against its manifest.
 *
 * THROWS on any doubt. A missing manifest is a refusal, not an assumption that the
 * archive is fine — "I could not check" and "I checked and it is good" must never
 * produce the same outcome.
 */
export async function verifyBackup(archivePath: string): Promise<BackupManifest> {
  let raw: string;
  try {
    raw = await readFile(manifestPathFor(archivePath), "utf8");
  } catch {
    throw new BackupError(
      `no manifest at ${manifestPathFor(archivePath)} — refusing to restore an archive whose contents cannot be checked`,
    );
  }

  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(raw);
  } catch (e) {
    throw new BackupError(`manifest is not valid JSON: ${(e as Error).message}`);
  }
  if (manifest.manifestVersion !== 1) {
    throw new BackupError(
      `manifest version ${manifest.manifestVersion} is not understood by this build; refusing rather than guessing`,
    );
  }

  const actualBytes = (await stat(archivePath)).size;
  if (actualBytes !== manifest.bytes) {
    throw new BackupError(
      `archive is ${actualBytes} bytes, manifest says ${manifest.bytes} — truncated or replaced`,
    );
  }
  const actual = await sha256File(archivePath);
  if (actual !== manifest.sha256) {
    throw new BackupError(
      `archive checksum ${actual} does not match manifest ${manifest.sha256} — the archive has been altered`,
    );
  }
  return manifest;
}

/**
 * Restore an archive into `url`, after verifying it.
 *
 * Returns the manifest so the caller can compare what came back against what was
 * backed up. `pg_restore --clean --if-exists` replaces existing objects; the caller
 * is expected to be pointing at a database it intends to overwrite.
 *
 * PRIVILEGE POSTURE IS RE-APPLIED, NOT RESTORED. `--no-owner --no-privileges`
 * means every object comes back owned by the restoring (admin) credential with
 * every grant stripped — which is the safe direction (the runtime role can never
 * be smuggled into ownership through an archive), but it also silently un-splits
 * the roles: the runtime would go from "minimally privileged" to "no privileges
 * at all", and the tempting 3am fix is a blanket GRANT ALL. So the restore
 * re-applies the canonical role split as its last step, recreating the same
 * posture the running system had — the ledger append-only by privilege, the
 * runtime owning nothing.
 */
export async function restoreBackup(url: string, archivePath: string): Promise<BackupManifest> {
  const manifest = await verifyBackup(archivePath);

  // Refuse BEFORE pg_restore replaces the database if the post-restore role
  // re-provisioning would fail (role missing + credential lacks CREATEROLE).
  // Failing AFTER the restore has run leaves a replaced database with no
  // privilege posture — the exact half-done state this module exists to avoid.
  {
    const pg = await import("pg");
    const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
    const { assertRoleSplitProvisionable } = await import("@workspace/persistence");
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      await assertRoleSplitProvisionable((sql: string) => pool.query(sql));
    } finally {
      await pool.end();
    }
  }

  try {
    await run(
      "pg_restore",
      ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--exit-on-error", "--dbname", url, archivePath],
      { maxBuffer: 1024 * 1024 * 64 },
    );
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new BackupError(`pg_restore failed: ${err.stderr?.trim() || err.message}`);
  }
  const { applyRoleSplit } = await import("@workspace/persistence");
  await applyRoleSplit(url);
  return manifest;
}

/** Read back the same facts the manifest recorded, for comparison after a restore. */
export async function describeDatabase(url: string): Promise<{
  tables: Record<string, number>;
  auditHeadHash: string | null;
  auditCount: number | null;
}> {
  const tables = await tableRowCounts(url);
  const { head, count } = await auditHead(url);
  return { tables, auditHeadHash: head, auditCount: count };
}
