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
  console.error(
    `usage: DATABASE_URL=postgres://... pnpm run db:verify-ledger [-- --batch-size N] [--min-records N]`,
  );
  process.exit(2);
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => a !== "--");

  // Parsed by consuming known flags rather than by "is this the only flag": the
  // previous form accepted --batch-size alone and rejected EVERY other argument,
  // so adding a second flag needs this shape or one of the two is refused.
  let batchSize = 1000;
  let minRecords: number | null = null;
  const rest = [...argv];
  while (rest.length > 0) {
    const flag = rest.shift() as string;
    if (flag === "--batch-size") {
      batchSize = Number(rest.shift());
      if (!Number.isFinite(batchSize) || batchSize < 1) usage();
    } else if (flag === "--min-records") {
      minRecords = Number(rest.shift());
      if (!Number.isInteger(minRecords) || minRecords < 0) usage();
    } else {
      usage();
    }
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
  }

  // --min-records: the operator's assertion that this ledger is not supposed to be
  // empty or short.
  //
  // WHY THIS FLAG EXISTS. This command refuses to run at all without DATABASE_URL,
  // on the stated grounds that "a verifier that can green-light the void is worse
  // than none" — and then exited 0 on an EMPTY table, printing a sentence about it.
  // A human reads the sentence. A cron job, a monitoring probe, and a CI step read
  // the exit code, and to all three a wiped ledger was indistinguishable from a
  // verified one. That is the same unearned affirmative the refusal above exists to
  // prevent, one layer down.
  //
  // It is a FLAG rather than an unconditional failure because a first-run
  // deployment has a legitimately empty ledger, and a check that cries wolf on day
  // one is a check somebody switches off by day three. The operator who knows their
  // ledger should hold history is the one who can say so.
  if (minRecords !== null && result.count < minRecords) {
    console.error(
      `\nTOO FEW RECORDS: ${result.count} < the ${minRecords} you asserted with --min-records.` +
        "\nThe chain that IS here verifies. That is not the same as the history being" +
        "\nintact — records can be deleted from the end without breaking any hash," +
        "\nand truncation is exactly what this flag is for. Investigate before" +
        "\ntreating this ledger as complete.",
    );
    process.exit(1);
  }

  if (result.count === 0) return;

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
