// Proof: retention, erasure and DSAR export over the durable stores — and the audit
// chain survives all three.
//
// DR-003's status note ratified that NO durable store had a retention mechanism: a
// decision, its evidence snapshot and the caller-supplied requestContext inside it
// were written once and kept forever, with no path to remove a subject's records.
// `lib/persistence/src/lifecycle.ts` is the path. This proves the rules it is built
// on, and proves them against the REAL audit ledger rather than a stand-in for one.
//
// Claims:
//   1. A per-tenant policy with a default. An override applies; an INVALID override
//      falls back to the default window and never to unbounded — retention is the one
//      place where "fail closed" means keep LESS, not more.
//   2. Retention deletes what is past its window and nothing else. Evidence snapshots
//      go with their decisions. Request context has its OWN, shorter window: a
//      decision inside the decision window but past the context window keeps the
//      decision and loses the context.
//   3. Erasure removes everything durable about ONE subject, in ONE tenant, and the
//      same subject id in another tenant is untouched.
//   4. The audit chain VERIFIES before and after — nothing is ever removed from it —
//      and the tombstone it gains names counts and the operator's request id and
//      NEVER the subject. The subject's identifier appears nowhere in the ledger.
//   5. DSAR export returns what is held, names what it does not include, and APPENDS
//      NOTHING: asking what is held must not create a new record naming you.
//
// WHAT THIS DOES NOT PROVE, stated rather than implied: the SQL in
// `PostgresLifecycleStore` is not exercised here. There is no database in CI, and a
// proof that pretended otherwise would be the defect this repository keeps finding.
// The store below is an in-memory implementation of the SAME interface; the audit
// ledger is the real one.
import {
  DEFAULT_RETENTION,
  applyRetention,
  cutoff,
  eraseSubject,
  exportSubject,
  retentionFor,
  type LifecycleDecision,
  type LifecycleStore,
} from "@workspace/persistence";
import { InMemoryAuditBackend, appendAuditRecord, getAuditRecords, setAuditBackend, verifyLedgerFull } from "@workspace/audit";

const SELF_TEST = process.argv.includes("--self-test");
let checks = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  checks += 1;
  if (cond) {
    console.log(`  ok — ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL — ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const NOW = new Date("2026-09-18T12:00:00.000Z");
const SUBJECT = "user.erasure.requested@example.invalid";

/** In-memory LifecycleStore. Same interface the Postgres one implements. */
class FakeStore implements LifecycleStore {
  rows: LifecycleDecision[];
  constructor(rows: LifecycleDecision[]) {
    this.rows = rows.map((r) => ({ ...r, requestContext: { ...r.requestContext } }));
  }
  async findByIdentity(tenantId: string, identityId: string): Promise<LifecycleDecision[]> {
    return this.rows.filter((r) => r.tenantId === tenantId && r.identityId === identityId);
  }
  async findOlderThan(tenantId: string, before: string): Promise<LifecycleDecision[]> {
    return this.rows.filter((r) => r.tenantId === tenantId && r.createdAt < before);
  }
  async deleteDecisions(tenantId: string, ids: readonly string[]): Promise<{ decisions: number; snapshots: number }> {
    const doomed = new Set(ids);
    const before = this.rows.length;
    const snapshots = this.rows.filter((r) => r.tenantId === tenantId && doomed.has(r.id) && r.evidenceSnapshotId !== "").length;
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && doomed.has(r.id)));
    return { decisions: before - this.rows.length, snapshots };
  }
  async clearRequestContext(tenantId: string, ids: readonly string[]): Promise<number> {
    const target = new Set(ids);
    let n = 0;
    for (const row of this.rows) {
      if (row.tenantId === tenantId && target.has(row.id)) {
        row.requestContext = {};
        n += 1;
      }
    }
    return n;
  }
}

function decision(id: string, tenantId: string, identityId: string, daysAgo: number): LifecycleDecision {
  return {
    id,
    tenantId,
    identityId,
    createdAt: cutoff(NOW, daysAgo),
    outcome: "step_up",
    evidenceSnapshotId: `snap_${id}`,
    // The caller-supplied field: the one place a durable row can carry something
    // nobody intended, which is why it has its own, shorter window.
    requestContext: { ward: "3B", note: identityId },
  };
}

async function main(): Promise<void> {
  setAuditBackend(new InMemoryAuditBackend());

  // ── 1. policy with a default, and an invalid override that SHORTENS ────────
  ok("a tenant with no override gets the default window",
    retentionFor("tenant_a").decisionDays === DEFAULT_RETENTION.decisionDays &&
    retentionFor("tenant_a").requestContextDays === DEFAULT_RETENTION.requestContextDays);
  ok("a valid per-tenant override applies",
    retentionFor("tenant_a", { tenant_a: { decisionDays: 90 } }).decisionDays === 90);
  ok("...and leaves the other field at the default (an override is partial, not a replacement)",
    retentionFor("tenant_a", { tenant_a: { decisionDays: 90 } }).requestContextDays === DEFAULT_RETENTION.requestContextDays);
  for (const bad of [0, -1, 1.5, 99999, Number.NaN, "365" as unknown as number, undefined]) {
    ok(`an invalid override (${JSON.stringify(bad)}) falls back to the DEFAULT window, never to unbounded`,
      retentionFor("tenant_a", { tenant_a: { decisionDays: bad as number } }).decisionDays === DEFAULT_RETENTION.decisionDays);
  }

  // ── 2. retention deletes past the window and nothing else ──────────────────
  const store = new FakeStore([
    decision("dec_ancient", "tenant_a", SUBJECT, 500),        // past the decision window
    decision("dec_old_context", "tenant_a", SUBJECT, 100),    // inside decisions, past context
    decision("dec_recent", "tenant_a", SUBJECT, 5),           // inside both
    decision("dec_other_tenant", "tenant_b", SUBJECT, 500),   // another tenant's, same subject
  ]);
  const chainBefore = await verifyLedgerFull();
  const run = await applyRetention(store, "tenant_a", NOW);
  ok("retention deleted exactly the decision past its window",
    run.decisionsDeleted === 1 && store.rows.some((r) => r.id === "dec_recent") && !store.rows.some((r) => r.id === "dec_ancient"),
    `deleted=${run.decisionsDeleted}`);
  ok("...and the evidence snapshot went with it", run.snapshotsDeleted === 1);
  ok("...and ANOTHER TENANT'S equally-old row was not touched",
    store.rows.some((r) => r.id === "dec_other_tenant"));
  const cleared = store.rows.find((r) => r.id === "dec_old_context");
  const kept = store.rows.find((r) => r.id === "dec_recent");
  ok("a decision inside the decision window but past the CONTEXT window keeps the decision and loses the context",
    run.requestContextsCleared === 1 && cleared !== undefined && Object.keys(cleared.requestContext).length === 0);
  ok("...while a decision inside both windows keeps its context",
    kept !== undefined && Object.keys(kept.requestContext).length > 0);
  const second = await applyRetention(store, "tenant_a", NOW);
  ok("a second run is a no-op: nothing is re-counted and an already-blank context is not re-cleared",
    second.decisionsDeleted === 0 && second.snapshotsDeleted === 0 && second.requestContextsCleared === 0,
    JSON.stringify(second));

  // ── 3. erasure: one subject, one tenant ────────────────────────────────────
  const erasureStore = new FakeStore([
    decision("dec_1", "tenant_a", SUBJECT, 10),
    decision("dec_2", "tenant_a", SUBJECT, 2),
    decision("dec_3", "tenant_a", "somebody.else@example.invalid", 2),
    decision("dec_4", "tenant_b", SUBJECT, 2),
  ]);
  const receipt = await eraseSubject(erasureStore, "tenant_a", SUBJECT, NOW, "dsar-2026-0042");
  ok("erasure removed every durable decision this tenant held for the subject",
    receipt.decisionsDeleted === 2 && (await erasureStore.findByIdentity("tenant_a", SUBJECT)).length === 0);
  ok("...and their evidence snapshots", receipt.snapshotsDeleted === 2);
  ok("...and left ANOTHER subject's rows in the same tenant alone",
    erasureStore.rows.some((r) => r.id === "dec_3"));
  ok("...and left the SAME subject's rows in another tenant alone (erasure is tenant-scoped, like every other path)",
    erasureStore.rows.some((r) => r.id === "dec_4"));
  let refusedWithoutRequestId = false;
  try {
    await eraseSubject(erasureStore, "tenant_a", SUBJECT, NOW, "   ");
  } catch {
    refusedWithoutRequestId = true;
  }
  ok("an erasure with no request id is refused — a tombstone must have something to name", refusedWithoutRequestId);

  if (SELF_TEST) {
    // THE PLANTED MISTAKE, and it is the one a well-meaning implementer makes: a
    // tombstone that names the subject of the erasure request, so the ledger you
    // cannot edit gains a permanent new copy of the identifier you were asked to
    // remove. Claim 4's last check exists for exactly this.
    await appendAuditRecord("data.subject.erased", { type: "admin" }, {
      tenantId: "tenant_a",
      target: { type: "tenant", id: "tenant_a" },
      meta: { requestId: "dsar-2026-0042", erasedSubject: SUBJECT },
    });
  }

  // ── 4. the chain, before and after; the tombstone names no subject ─────────
  const chainAfter = await verifyLedgerFull();
  ok("the audit chain verified before any lifecycle work ran", chainBefore.ok === true);
  ok("...and still verifies after retention and erasure — nothing is ever removed from the ledger",
    chainAfter.ok === true && chainAfter.count > chainBefore.count,
    `before=${chainBefore.count} after=${chainAfter.count} ok=${chainAfter.ok}`);
  const ledger = await getAuditRecords(1000, 0);
  const tombstone = ledger.find((r) => r.eventType === "data.subject.erased");
  ok("the erasure left a tombstone in the chain", tombstone !== undefined);
  ok("...carrying the counts and the operator's request id",
    tombstone?.meta?.["decisionsDeleted"] === 2 && tombstone?.meta?.["requestId"] === "dsar-2026-0042");
  ok("...and the retention run left its own record too",
    ledger.some((r) => r.eventType === "data.retention.applied"));
  // THE RULE THAT IS EASY TO GET BACKWARDS: an append-only row naming the subject of
  // an erasure request is a permanent new copy of the identifier being erased.
  const serializedLedger = JSON.stringify(ledger);
  ok("the subject's identifier appears NOWHERE in the audit ledger — not in the tombstone, not anywhere",
    !serializedLedger.includes(SUBJECT));

  // ── 5. DSAR export: reads, names its own gaps, and writes nothing ──────────
  const exportStore = new FakeStore([
    decision("dec_x", "tenant_a", SUBJECT, 10),
    decision("dec_y", "tenant_a", "another@example.invalid", 10),
  ]);
  const countBeforeExport = (await getAuditRecords(1000, 0)).length;
  const dsar = await exportSubject(exportStore, "tenant_a", SUBJECT, NOW);
  ok("the export returns the subject's decisions and only theirs",
    dsar.decisions.length === 1 && dsar.decisions[0]!.id === "dec_x");
  ok("...with the outcome, the timestamp and the request context still held",
    dsar.decisions[0]!.outcome === "step_up" && typeof dsar.decisions[0]!.createdAt === "string" &&
    Object.keys(dsar.decisions[0]!.requestContext).length > 0);
  ok("...and NAMES what it does not include, rather than leaving the list to look complete",
    dsar.notIncluded.length >= 3 && dsar.notIncluded.some((n) => n.includes("audit ledger")));
  ok("an export APPENDS NOTHING — asking what is held must not create a record naming you",
    (await getAuditRecords(1000, 0)).length === countBeforeExport);

  console.log(`\ndata-lifecycle proof: ${checks - failed}/${checks} checks passed (${ledger.length} ledger rows, chain ok=${chainAfter.ok})`);
  console.log(`summary=${failed === 0 ? "pass" : "fail"} (${checks - failed}/${checks})`);
  if (SELF_TEST) {
    if (failed > 0) {
      console.log("self-test: the planted loosening was CAUGHT — the proof can fail.");
      process.exit(0);
    }
    console.log("self-test: the planted loosening was NOT caught — the proof cannot fail.");
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
