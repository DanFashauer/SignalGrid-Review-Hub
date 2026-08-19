// Ledger export/verify core — the logic behind `db:export-ledger` and
// `verify:ledger-export`, factored out so `proof:audit-ledger` drives THIS code
// over an in-memory backend rather than a re-implementation that would drift.
//
// WHY AN EXPORT EXISTS AT ALL. The durable ledger's value is tamper-evidence,
// and tamper-evidence that can only be checked by the machine holding the data
// is weaker than it sounds: whoever can rewrite the table can also run the
// verifier and report green. An export is the chain leaving custody — a file a
// third party (an assessor, the owner's laptop, cold storage) can re-verify
// WITHOUT database access, against nothing but the mathematics.
//
// THE FORMAT. One canonical audit record per line (NDJSON), plus a manifest
// naming what the file must contain: record count, head hash, first/last
// timestamps, and the SHA-256 of the file bytes. The manifest is what makes
// TRUNCATION detectable — a hash chain alone cannot see records missing from
// its END, because a shorter chain is also a valid chain. Cutting the file and
// cutting the manifest to match would also be caught, one level up: the
// manifest's own digest and head hash are what an operator writes down (or
// countersigns) at export time.
//
// TWO REFUSAL RULES, both inherited from the CLI verifier:
//   · An export of a BROKEN chain is refused, not produced. A broken chain
//     laundered into an archival-looking file is tampering given provenance.
//   · An EMPTY export is refused. "Nothing exported, and it verifies" is the
//     unearned affirmative wearing an archive hat.

import { createHash } from "node:crypto";
import { getAuditRecords, verifySegment, type AuditRecord } from "@workspace/audit";

export const EXPORT_FORMAT = "signalgrid-audit-ledger-ndjson";
export const EXPORT_FORMAT_VERSION = 1;

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  formatVersion: number;
  recordCount: number;
  headHash: string;
  firstTs: string;
  lastTs: string;
  /** SHA-256 (hex) of the NDJSON file bytes, exactly as written. */
  fileSha256: string;
}

export type ExportResult =
  | { ok: true; manifest: ExportManifest; batches: number }
  | { ok: false; reason: "empty-ledger" }
  | {
      ok: false;
      reason: "chain-broken";
      brokenAtIndex: number;
      expectedHash: string;
      actualHash: string;
    };

/**
 * Stream the whole ledger to `sink`, one canonical JSON record per line,
 * verifying every segment AS IT LEAVES so a broken chain is refused rather
 * than exported. Pages through the backend in bounded batches, carrying the
 * linking hash across boundaries exactly as `verifyLedgerFull` does.
 *
 * `sink` receives each line WITHOUT the trailing newline; the caller decides
 * the separator so the file's bytes (and therefore its digest) are the
 * caller's responsibility to pin. `lineToBytes` below is the one true mapping.
 */
export async function exportLedger(
  sink: (line: string) => void,
  options?: { batchSize?: number },
): Promise<ExportResult> {
  const batchSize = Math.max(1, Math.floor(options?.batchSize ?? 1000));
  const hash = createHash("sha256");

  let offset = 0;
  let prevHash = "";
  let count = 0;
  let batches = 0;
  let firstTs = "";
  let lastTs = "";

  for (;;) {
    const records = await getAuditRecords(batchSize, offset);
    if (records.length === 0) break;
    batches += 1;

    const result = verifySegment(records, count, prevHash);
    if (result.broken) {
      return {
        ok: false,
        reason: "chain-broken",
        brokenAtIndex: result.broken.atIndex,
        expectedHash: result.broken.expectedHash,
        actualHash: result.broken.actualHash,
      };
    }

    if (count === 0) firstTs = records[0].ts;
    lastTs = records[records.length - 1].ts;

    for (const record of records) {
      const line = JSON.stringify(record);
      sink(line);
      hash.update(lineToBytes(line));
    }

    prevHash = result.headHash;
    count += records.length;
    offset += records.length;
    if (records.length < batchSize) break;
  }

  if (count === 0) return { ok: false, reason: "empty-ledger" };

  return {
    ok: true,
    batches,
    manifest: {
      format: EXPORT_FORMAT,
      formatVersion: EXPORT_FORMAT_VERSION,
      recordCount: count,
      headHash: prevHash,
      firstTs,
      lastTs,
      fileSha256: hash.digest("hex"),
    },
  };
}

/** The one mapping from a record line to file bytes: the line plus "\n". Export
 *  and offline verification both digest through this, so the manifest's
 *  `fileSha256` means the same bytes on both sides. */
export function lineToBytes(line: string): Buffer {
  return Buffer.from(line + "\n", "utf8");
}

export type ExportVerification =
  | { verdict: "verified"; recordCount: number; headHash: string }
  | { verdict: "refused"; reason: string }
  | {
      verdict: "broken";
      reason: string;
      brokenAtIndex?: number;
      expectedHash?: string;
      actualHash?: string;
    };

/**
 * Verify exported NDJSON lines against their manifest, with NO database.
 *
 * Order of checks, and why the order matters:
 *   1. Manifest shape — an unrecognized format is a refusal, not a guess.
 *   2. The hash chain, record by record, through the SAME `verifySegment` the
 *      live verifiers use (batched, carrying the linking hash, so the
 *      pagination-boundary behaviour is the tested one).
 *   3. Count and head against the manifest — this is where TRUNCATION dies:
 *      a file cut at a record boundary still carries a valid chain, and only
 *      the manifest knows how long the chain was supposed to be.
 *
 * The file-bytes digest is checked by `verifyExportContent` (the CLI path); it
 * is separate so the proof can also exercise chain/manifest verdicts directly.
 */
export function verifyExportLines(
  lines: Iterable<string>,
  manifest: ExportManifest,
  options?: { batchSize?: number },
): ExportVerification {
  if (manifest.format !== EXPORT_FORMAT || manifest.formatVersion !== EXPORT_FORMAT_VERSION) {
    return { verdict: "refused", reason: `unrecognized manifest format (${manifest.format} v${manifest.formatVersion})` };
  }

  const batchSize = Math.max(1, Math.floor(options?.batchSize ?? 1000));
  let batch: AuditRecord[] = [];
  let prevHash = "";
  let count = 0;
  let lineNo = 0;

  const flush = (): ExportVerification | null => {
    if (batch.length === 0) return null;
    const result = verifySegment(batch, count, prevHash);
    if (result.broken) {
      return {
        verdict: "broken",
        reason: "hash chain does not recompute",
        brokenAtIndex: result.broken.atIndex,
        expectedHash: result.broken.expectedHash,
        actualHash: result.broken.actualHash,
      };
    }
    prevHash = result.headHash;
    count += batch.length;
    batch = [];
    return null;
  };

  for (const raw of lines) {
    lineNo += 1;
    if (raw.trim().length === 0) continue; // a trailing blank line is not a record
    let record: AuditRecord;
    try {
      record = JSON.parse(raw) as AuditRecord;
    } catch {
      return { verdict: "broken", reason: `line ${lineNo} is not valid JSON` };
    }
    batch.push(record);
    if (batch.length >= batchSize) {
      const failed = flush();
      if (failed) return failed;
    }
  }
  const failed = flush();
  if (failed) return failed;

  if (count === 0) {
    return { verdict: "refused", reason: "the export contains zero records — nothing verifying clean is not verified history" };
  }
  if (count !== manifest.recordCount) {
    return {
      verdict: "broken",
      reason:
        `record count mismatch: file has ${count}, manifest says ${manifest.recordCount}. ` +
        "A shorter chain is still a valid chain, so truncation only the manifest can see IS tampering.",
    };
  }
  if (prevHash !== manifest.headHash) {
    return {
      verdict: "broken",
      reason: `head hash mismatch: file chain ends at ${prevHash}, manifest says ${manifest.headHash}`,
    };
  }
  return { verdict: "verified", recordCount: count, headHash: prevHash };
}

/**
 * The CLI-shaped verification: file content as one string, digest checked
 * FIRST (cheapest, and a digest mismatch makes any chain verdict about bytes
 * nobody vouched for), then the chain/manifest checks above.
 */
export function verifyExportContent(content: string, manifest: ExportManifest): ExportVerification {
  const digest = createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
  if (digest !== manifest.fileSha256) {
    return {
      verdict: "broken",
      reason: `file digest mismatch: computed ${digest}, manifest says ${manifest.fileSha256}`,
    };
  }
  return verifyExportLines(content.split("\n"), manifest);
}
