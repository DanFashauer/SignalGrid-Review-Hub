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

import { appendAuditRecord, getAuditRecords, verifyLedger } from "@workspace/audit";

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
