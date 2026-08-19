// Export the durable audit ledger to a file a third party can verify. READ-ONLY.
//
//   DATABASE_URL=postgres://... pnpm run db:export-ledger -- --out ledger.ndjson
//
// Writes `<out>` (one canonical record per line) and `<out>.manifest.json`
// (count, head hash, timestamps, file digest). The pair is what leaves custody:
// `pnpm run verify:ledger-export -- <out>` re-verifies both with no database.
//
// REFUSALS, matching db:verify-ledger's posture:
//   · No DATABASE_URL → exit 2. The fallback backend is a fresh in-memory
//     ledger, and exporting the void produces a file that "verifies clean"
//     while archiving nothing.
//   · Broken chain → exit 1, and NO export file is left behind. An export is
//     implicit vouching; a broken chain must be investigated where it lives,
//     not laundered into an archival-looking artifact.
//   · Empty ledger → exit 2. Nothing to export is not an export.

import { writeFileSync, rmSync, openSync, writeSync, closeSync } from "node:fs";
import { getAuditBackend } from "@workspace/audit";
import { exportLedger, lineToBytes } from "./ledger-export";

function usage(): never {
  console.error("usage: DATABASE_URL=postgres://... pnpm run db:export-ledger -- --out FILE [--batch-size N]");
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  let out = "";
  let batchSize = 1000;
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--out" && argv[i + 1]) out = argv[i + 1];
    else if (argv[i] === "--batch-size" && argv[i + 1]) {
      batchSize = Number(argv[i + 1]);
      if (!Number.isFinite(batchSize) || batchSize < 1) usage();
    } else usage();
  }
  if (!out) usage();

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Without it the backend is a fresh, empty in-memory\n" +
        "ledger — an export of the void that later 'verifies clean' is an unearned\n" +
        "affirmative in a file. Refusing.",
    );
    process.exit(2);
  }
  // "wx" IS the exists-check, atomically: exclusive create fails on a file that
  // already exists, with no separate stat racing against the open (CodeQL
  // flagged the check-then-open version of this as a TOCTOU — correctly).
  let fd: number;
  try {
    fd = openSync(out, "wx");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      console.error(`${out} already exists — refusing to overwrite an existing export.`);
      process.exit(2);
    }
    throw err;
  }
  try {
    const result = await exportLedger(
      (line) => {
        writeSync(fd, lineToBytes(line));
      },
      { batchSize },
    );

    if (!result.ok) {
      closeSync(fd);
      rmSync(out, { force: true }); // no partial export survives a refusal; force = no racy exists-check
      if (result.reason === "empty-ledger") {
        console.error("The ledger is EMPTY. Nothing to export is not an export. Refusing.");
        process.exit(2);
      }
      console.error(`CHAIN BROKEN at record index ${result.brokenAtIndex} — refusing to export.`);
      console.error(`  expected: ${result.expectedHash}`);
      console.error(`  actual:   ${result.actualHash}`);
      console.error("Investigate with db:verify-ledger; an export would launder the break into provenance.");
      process.exit(1);
    }

    closeSync(fd);
    writeFileSync(`${out}.manifest.json`, JSON.stringify(result.manifest, null, 2) + "\n", { flag: "wx" });

    console.log("Ledger export (whole chain, verified as it streamed)");
    console.log(`  records:  ${result.manifest.recordCount}`);
    console.log(`  batches:  ${result.batches} (batch size ${batchSize})`);
    console.log(`  first ts: ${result.manifest.firstTs}`);
    console.log(`  last ts:  ${result.manifest.lastTs}`);
    console.log(`  head:     ${result.manifest.headHash}`);
    console.log(`  file:     ${out}`);
    console.log(`  sha256:   ${result.manifest.fileSha256}`);
    console.log(`  manifest: ${out}.manifest.json`);
    console.log("\nWrite down (or countersign) the head hash and file digest OUTSIDE the machine");
    console.log("that produced them — the manifest proves the file, something else must prove the manifest.");
  } catch (err) {
    try { closeSync(fd); } catch { /* already closed on the refusal paths */ }
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    const backend = getAuditBackend();
    if (backend.close) await backend.close();
  });
