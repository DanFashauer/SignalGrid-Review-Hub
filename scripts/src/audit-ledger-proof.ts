// Proof: tamper-evident audit ledger (@workspace/audit).
//
// The audit ledger is the record that a decision was made and why. Two
// invariants matter and had no automated coverage:
//   1. SECRET REDACTION at any depth — a token/authorization/secret value must
//      never reach the (exported, readable) ledger, whether it sits at the top
//      level, inside a nested object, or inside an ARRAY of objects (the shape
//      the sweep flagged as un-redacted).
//   2. HASH-CHAIN INTEGRITY — verifyLedger accepts a genuine chain and DETECTS a
//      single mutated record (tampering) at the right index. A ledger that can be
//      edited without detection is not tamper-evident.
//
// Run: pnpm --filter @workspace/scripts run proof:audit-ledger

import {
  appendAuditRecord,
  getAuditRecords,
  verifyLedger,
  verifyLedgerFull,
  setAuditBackend,
  InMemoryAuditBackend,
} from "@workspace/audit";
import { exportLedger, verifyExportContent, verifyExportLines } from "./ledger-export";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const SECRET = "s3cr3t-should-never-appear";

async function main() {
  // ── 1. Redaction at every depth ────────────────────────────────────────────
  // Top-level secret key, a nested object, and — the flagged case — an array of
  // objects each carrying a secret-named field.
  await appendAuditRecord("admin.access", { type: "admin", id: "admin-1" }, {
    meta: {
      action: "rotate",
      token: SECRET,                                  // top-level secret key
      context: { authorization: SECRET, note: "ok" }, // nested object
      headers: [                                       // array of objects
        { name: "content-type", value: "application/json" },
        { authorization: SECRET },
        { nested: [{ api_key: SECRET }] },             // array within array within object
      ],
    },
  });
  await appendAuditRecord("session.start", { type: "user", id: "user-1" }, {
    meta: { reason: "login", password: SECRET },
  });

  const records = await getAuditRecords();
  const serialized = JSON.stringify(records);
  check("ledger accumulated the appended records", records.length === 2);
  check("no secret value survives redaction at any depth (top/nested/array)",
    !serialized.includes(SECRET));
  check("redaction preserves non-secret siblings",
    serialized.includes("application/json") && serialized.includes('"note":"ok"'));
  check("secret-named keys are replaced with the [REDACTED] marker",
    serialized.includes("[REDACTED]"));

  // ── 2. Genuine chain verifies ──────────────────────────────────────────────
  const clean = await verifyLedger();
  check("a genuine, unmodified ledger verifies ok", clean.ok === true && clean.count === 2);
  check("verifyLedger reports the head hash of a clean chain", clean.headHash.length === 64);

  // ── 3. Tampering is detected ───────────────────────────────────────────────
  // getAuditRecords returns the live record objects; mutating one in place is
  // exactly the tamper a hash chain must catch. Change the meta WITHOUT updating
  // the stored hash — verifyLedger recomputes and must flag the divergence.
  const live = await getAuditRecords();
  (live[0].meta as Record<string, unknown>).action = "tampered";

  const broken = await verifyLedger();
  check("verifyLedger DETECTS a mutated record (not ok)", broken.ok === false);
  check("tamper is localized to the mutated record's index", broken.brokenAtIndex === 0);
  check("verifyLedger surfaces the expected vs actual hash on a break",
    typeof broken.expectedHash === "string" && typeof broken.actualHash === "string" &&
    broken.expectedHash !== broken.actualHash);

  // ── 4. Mid-chain tamper is localized to a NON-ZERO index ────────────────────
  // The index-0 tests above only exercise a break at the head. A chain is a
  // chain because a break in the MIDDLE is caught AT the middle. Stage a clean
  // 3-record chain on a fresh backend, then REORDER the two middle records
  // (record[1] <-> record[2]) — a reorder that leaves each record's own hash
  // intact but breaks the prevHash linkage — and assert the break is reported
  // at the correct non-zero index, not at 0.
  setAuditBackend(new InMemoryAuditBackend());
  await appendAuditRecord("session.start", { type: "user", id: "chain-0" }, { meta: { step: 0 } });
  await appendAuditRecord("session.poll", { type: "user", id: "chain-1" }, { meta: { step: 1 } });
  await appendAuditRecord("session.end", { type: "user", id: "chain-2" }, { meta: { step: 2 } });

  const chain = await getAuditRecords();
  const chainClean = await verifyLedger();
  check("a genuine 3-record chain verifies ok", chainClean.ok === true && chainClean.count === 3);

  // Serve the same records with the two MIDDLE ones reordered. Each record's own
  // hash is unchanged, so the break can only be the prevHash-linkage divergence
  // at the first out-of-order record — index 1, not index 0.
  const reordered = [chain[0], chain[2], chain[1]];
  setAuditBackend({
    appendWithChain: async () => { throw new Error("frozen ledger"); },
    getRecords: async (limit: number, offset: number) => reordered.slice(offset, offset + limit),
  });

  const midBroken = await verifyLedger();
  check("verifyLedger DETECTS a reordered middle record (not ok)", midBroken.ok === false);
  check("mid-chain tamper is localized to the middle (non-zero) index",
    midBroken.brokenAtIndex === 1);
  check("the reordered record's prevHash diverges from the true predecessor's hash",
    midBroken.expectedHash === chain[0].hash && midBroken.actualHash === chain[2].prevHash &&
    midBroken.expectedHash !== midBroken.actualHash);

  // ── 5. The paginating verifier reads the WHOLE chain, not a prefix ─────────
  // verifyLedger(limit) used to return a bare `ok: true` after reading `limit`
  // records of an arbitrarily long chain — a false all-clear in the one
  // component whose entire value is tamper-evidence. Two things are pinned
  // here: the capped verifier is now HONEST about its cap (`truncated`), and
  // verifyLedgerFull pages to the true end in bounded batches.
  setAuditBackend(new InMemoryAuditBackend());
  for (let i = 0; i < 25; i++) {
    await appendAuditRecord("session.poll", { type: "user", id: `page-${i}` }, { meta: { step: i } });
  }

  const fullClean = await verifyLedgerFull({ batchSize: 10 });
  check("verifyLedgerFull verifies a 25-record chain across 3 batches of 10",
    fullClean.ok === true && fullClean.count === 25 && fullClean.batches === 3);
  check("a full verification is never truncated, by construction", fullClean.truncated === false);

  const capped = await verifyLedger(10);
  check("verifyLedger with a cap below the ledger length says truncated — a prefix pass is not a chain pass",
    capped.ok === true && capped.truncated === true && capped.count === 10);
  const underCap = await verifyLedger();
  check("verifyLedger under its cap says truncated:false — it provably reached the end",
    underCap.ok === true && underCap.truncated === false && underCap.count === 25);
  const exactCap = await verifyLedger(25);
  check("a read returning EXACTLY its cap is truncated — the verifier cannot know nothing follows",
    exactCap.truncated === true);

  // ── 6. Corruption planted BEYOND the first batch is caught, globally indexed ─
  // This is the exact blindness the old cap created: a clean first batch and a
  // tampered seventeenth record. The capped verifier at limit=10 still passes
  // its prefix — which is precisely why `truncated` has to be loud — and the
  // paginating verifier must localize the break at the GLOBAL index.
  const pages = await getAuditRecords(1000, 0);
  (pages[17].meta as Record<string, unknown>).step = 999;

  const beyond = await verifyLedgerFull({ batchSize: 10 });
  check("verifyLedgerFull DETECTS corruption planted beyond the first batch", beyond.ok === false);
  check("…localized to the correct GLOBAL index (17), not a batch-local one", beyond.brokenAtIndex === 17);
  const blindPrefix = await verifyLedger(10);
  check("the capped verifier still passes its clean prefix over the same tampered ledger — truncated:true is what stops that reading as green",
    blindPrefix.ok === true && blindPrefix.truncated === true);
  (pages[17].meta as Record<string, unknown>).step = 17; // restore

  // ── 7. A break exactly AT a batch boundary — the linking hash must survive
  // the page turn. Record 20 is the FIRST record of batch 3 (batchSize=10);
  // tampering its prevHash can only be caught if the verifier carried the
  // previous batch's head hash across the boundary.
  const trueLink = pages[20].prevHash;
  pages[20].prevHash = "0".repeat(64);
  const boundary = await verifyLedgerFull({ batchSize: 10 });
  check("verifyLedgerFull DETECTS a linkage break at the first record of a batch", boundary.ok === false && boundary.brokenAtIndex === 20);
  check("…because the linking hash was carried across the batch boundary",
    boundary.expectedHash === pages[19].hash && boundary.actualHash === "0".repeat(64));
  pages[20].prevHash = trueLink; // restore

  const oneBatch = await verifyLedgerFull({ batchSize: 1000 });
  check("a batch size larger than the chain degenerates to one clean batch", oneBatch.ok === true && oneBatch.batches === 1 && oneBatch.count === 25);

  // ── 8. Export round-trip: the chain leaves custody and still proves itself ──
  // These drive the REAL export/verify core (`./ledger-export`) — the same code
  // `db:export-ledger` and `verify:ledger-export` run — over the same 25-record
  // in-memory chain, so what is proven here is what an operator gets. Not a
  // re-implementation: the round trip below is the product path.
  const lines: string[] = [];
  const exported = await exportLedger((line) => lines.push(line), { batchSize: 10 });
  check("export of a clean 25-record chain succeeds, verified as it streams",
    exported.ok === true && exported.manifest.recordCount === 25 && exported.batches === 3);
  const manifest = exported.ok ? exported.manifest : (undefined as never);
  check("the export manifest's head hash IS the live chain's head",
    exported.ok === true && manifest.headHash === pages[24].hash);

  // The round trip: bytes → verdict, digest checked first, no database consulted.
  const content = lines.map((l) => l + "\n").join("");
  const roundTrip = verifyExportContent(content, manifest);
  check("the exported file verifies offline — digest, chain, count and head all hold",
    roundTrip.verdict === "verified" && roundTrip.recordCount === 25 && roundTrip.headHash === manifest.headHash);

  // A single flipped byte dies twice, at two independent layers. First the file
  // digest (the CLI's first check) — and then, even if an attacker regenerates
  // no digest, the chain itself, localized to the exact record.
  const flipped = lines.slice();
  flipped[17] = flipped[17].replace('"step":17', '"step":18');
  check("the flip actually changed line 17 — this probe is live, not vacuous", flipped[17] !== lines[17]);
  const flippedContent = flipped.map((l) => l + "\n").join("");
  const digestCaught = verifyExportContent(flippedContent, manifest);
  check("a one-byte flip is caught by the file digest before any chain math runs",
    digestCaught.verdict === "broken" && digestCaught.reason.startsWith("file digest mismatch"));
  const chainCaught = verifyExportLines(flipped, manifest, { batchSize: 10 });
  check("…and by the hash chain itself, localized to record 17, if the digest were bypassed",
    chainCaught.verdict === "broken" && chainCaught.brokenAtIndex === 17);

  // TRUNCATION is the attack a hash chain alone cannot see: a shorter chain is
  // still a valid chain. Only the manifest knows how long this one must be.
  const truncated = verifyExportLines(lines.slice(0, 22), manifest, { batchSize: 10 });
  check("a truncated export is refused by the manifest count — a valid shorter chain is still tampering",
    truncated.verdict === "broken" && truncated.reason.includes("count mismatch"));

  // DELETION mid-file breaks linkage at exactly the seam it created.
  const holed = lines.slice(0, 10).concat(lines.slice(11));
  const holeCaught = verifyExportLines(holed, manifest, { batchSize: 10 });
  check("deleting one mid-file record breaks the chain at the deletion index",
    holeCaught.verdict === "broken" && holeCaught.brokenAtIndex === 10);

  // A manifest whose head was rewritten to bless different content is caught.
  const reheaded = { ...manifest, headHash: "f".repeat(64) };
  const headCaught = verifyExportLines(lines, reheaded, { batchSize: 10 });
  check("a manifest head-hash rewrite is caught against the recomputed chain head",
    headCaught.verdict === "broken" && headCaught.reason.includes("head hash mismatch"));

  check("an empty export is REFUSED, never verified — nothing verifying clean is not verified history",
    verifyExportLines([], manifest).verdict === "refused");

  // The exporter REFUSES a broken chain rather than laundering it into an
  // archival-looking file. Same tamper as section 6, same index expected back.
  (pages[17].meta as Record<string, unknown>).step = -17;
  const refusedExport = await exportLedger(() => {}, { batchSize: 10 });
  check("export of a tampered chain is refused with the break's exact index",
    refusedExport.ok === false && refusedExport.reason === "chain-broken" && refusedExport.brokenAtIndex === 17);
  (pages[17].meta as Record<string, unknown>).step = 17; // restore

  // And exporting the VOID is a refusal, not an empty file that verifies.
  setAuditBackend(new InMemoryAuditBackend());
  const emptyExport = await exportLedger(() => {}, { batchSize: 10 });
  check("export of an empty ledger is refused — nothing to export is not an export",
    emptyExport.ok === false && emptyExport.reason === "empty-ledger");

  const total = passed + failures.length;
  console.log(`Audit-ledger proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Audit ledger verified — depth-recursive secret redaction + tamper-evident hash chain.");
}

main().catch((err) => { console.error(err); process.exit(1); });
