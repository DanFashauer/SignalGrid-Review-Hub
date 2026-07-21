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
  setAuditBackend,
  InMemoryAuditBackend,
} from "@workspace/audit";

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
