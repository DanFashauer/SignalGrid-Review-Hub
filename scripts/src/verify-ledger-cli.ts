// The operator-facing whole-chain ledger verifier. NON-DESTRUCTIVE, always.
//
//   DATABASE_URL=postgres://... pnpm run db:verify-ledger
//   DATABASE_URL=postgres://... pnpm run db:verify-ledger -- --batch-size 500
//
// WHY THIS COMMAND EXISTS. Until it did, the only whole-chain verification in the
// repository was `proof:audit-ledger-pg` — a CI proof whose first statement drops the
// audit_ledger table — and the backup documentation told operators to run it against a
// freshly restored database. Following the docs destroyed the ledger the restore had
// just brought back. A CI proof that builds and tears down its own table is not an
// operator tool; this is the operator tool.
//
// It reads and recomputes. It never writes. It pages through the ledger in bounded
// batches (`verifyLedgerFull`), so a chain of any length is verified END TO END — the
// capped `verifyLedger()` reads a 10,000-record prefix and, now honestly, reports
// `truncated: true` when the ledger may extend past it.
//
// IT REFUSES TO RUN WITHOUT DATABASE_URL. Without one, the audit backend falls back to
// a fresh, EMPTY in-memory ledger — which verifies clean, prints a green message, and
// says precisely nothing about any real data. A verifier that can green-light the void
// is worse than none, so that path is a refusal, not a pass.

import { verifyLedgerFull, getAuditBackend } from "@workspace/audit";

function usage(): never {
  console.error(`usage: DATABASE_URL=postgres://... pnpm run db:verify-ledger [-- --batch-size N]`);
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  let batchSize = 1000;
  const flagAt = argv.indexOf("--batch-size");
  if (flagAt >= 0) {
    batchSize = Number(argv[flagAt + 1]);
    if (!Number.isFinite(batchSize) || batchSize < 1) usage();
  } else if (argv.length > 0) {
    usage();
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is not set. Without it there is no durable ledger to verify — the\n" +
        "backend would be a fresh, empty in-memory chain, and an empty chain verifying\n" +
        "clean is an unearned affirmative, not a verification. Refusing.",
    );
    process.exit(2);
  }

  const result = await verifyLedgerFull({ batchSize });

  console.log(`Ledger verification (whole chain, non-destructive)`);
  console.log(`  records:  ${result.count}`);
  console.log(`  batches:  ${result.batches} (batch size ${batchSize})`);
  console.log(`  first ts: ${result.firstTs || "(empty ledger)"}`);
  console.log(`  last ts:  ${result.lastTs || "(empty ledger)"}`);
  console.log(`  head:     ${result.headHash || "(empty ledger)"}`);

  if (!result.ok) {
    console.error(`\nCHAIN BROKEN at record index ${result.brokenAtIndex}.`);
    console.error(`  expected: ${result.expectedHash}`);
    console.error(`  actual:   ${result.actualHash}`);
    console.error(
      "\nEvery record before the break verifies; the break and everything after it is\n" +
        "not the chain this ledger recorded. Treat the ledger as tampered or corrupted\n" +
        "from that index and investigate before trusting any of it.",
    );
    process.exit(1);
  }

  if (result.count === 0) {
    // Verifying an empty DURABLE ledger is a real (if trivial) statement — but say
    // it plainly rather than letting "0 records: ok" read like a health check.
    console.log("\nThe ledger is EMPTY. Nothing to verify is not the same as verified history.");
    return;
  }

  console.log(`\nChain intact — every record from first to head recomputes and links. This read the`);
  console.log(`ENTIRE ledger (${result.count} record(s)); it is not the capped 10,000-record prefix check.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    // The Postgres backend holds a pool; without this the process hangs open.
    const backend = getAuditBackend();
    if (backend.close) await backend.close();
  });
