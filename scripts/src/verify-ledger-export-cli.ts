// Verify a ledger export OFFLINE — no database, no DATABASE_URL, no custody.
//
//   pnpm run verify:ledger-export -- ledger.ndjson
//   pnpm run verify:ledger-export -- ledger.ndjson --manifest other.json
//
// This is the other half of `db:export-ledger`, and the reason the export
// exists: tamper-evidence checked only by the machine that holds the data is
// weak evidence, because whoever can rewrite the table can also run that
// machine's verifier. This command runs anywhere the file does — an assessor's
// laptop, cold storage, the owner's phone via a shell — and answers from
// nothing but the mathematics and the manifest.
//
// Exit codes: 0 verified · 1 broken or tampered · 2 refused (missing/empty/
// malformed inputs — a refusal is not a verdict about the chain).

import { readFileSync, existsSync } from "node:fs";
import { verifyExportContent, type ExportManifest } from "./ledger-export";

function usage(): never {
  console.error("usage: pnpm run verify:ledger-export -- FILE [--manifest FILE]");
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  const file = argv[0];
  if (!file || file.startsWith("--")) usage();
  let manifestPath = `${file}.manifest.json`;
  if (argv.length > 1) {
    if (argv[1] !== "--manifest" || !argv[2] || argv.length > 3) usage();
    manifestPath = argv[2];
  }

  if (!existsSync(file)) {
    console.error(`${file} does not exist. Refusing — a missing file is not a verified file.`);
    process.exit(2);
  }
  if (!existsSync(manifestPath)) {
    console.error(
      `${manifestPath} does not exist. Refusing — without the manifest, truncation is\n` +
        "invisible: a shorter chain is still a valid chain, and only the manifest knows\n" +
        "how long this one was supposed to be.",
    );
    process.exit(2);
  }

  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExportManifest;
  } catch {
    console.error(`${manifestPath} is not valid JSON. Refusing.`);
    process.exit(2);
  }

  const content = readFileSync(file, "utf8");
  const result = verifyExportContent(content, manifest);

  if (result.verdict === "refused") {
    console.error(`REFUSED: ${result.reason}`);
    process.exit(2);
  }
  if (result.verdict === "broken") {
    console.error(`EXPORT DOES NOT VERIFY: ${result.reason}`);
    if (result.brokenAtIndex !== undefined) {
      console.error(`  broken at record index ${result.brokenAtIndex}`);
      console.error(`  expected: ${result.expectedHash}`);
      console.error(`  actual:   ${result.actualHash}`);
    }
    console.error(
      "\nTreat the export as tampered or corrupted. If you hold the original database,\n" +
        "db:verify-ledger answers whether the LIVE chain is intact — this verdict is\n" +
        "about the file in front of you.",
    );
    process.exit(1);
  }

  console.log("Export verified offline — no database consulted.");
  console.log(`  records: ${result.recordCount}`);
  console.log(`  head:    ${result.headHash}`);
  console.log("\nEvery record recomputes, every link holds, the count and head match the");
  console.log("manifest, and the file bytes match the manifest's digest.");
}

main();
