// Proof: the durable decision + evidence store on REAL Postgres
// (@workspace/persistence). Production-persistence proof for the decision core's
// records. SELF-SKIPS when DATABASE_URL is unset, so the default preflight stays
// DB-free and deterministic.
//
//   DATABASE_URL=postgres://sg@localhost:5433/signalgrid \
//     pnpm --filter @workspace/scripts run proof:decision-store-pg
//
// Uses the REAL decision core to mint genuine Decision + EvidenceSnapshot records,
// then proves, against a live database:
//   1. SAVE + GET       — a persisted decision reads back intact.
//   2. TENANT ISOLATION — the same id under a DIFFERENT tenant returns null.
//   3. SNAPSHOT + VERIFY— the evidence snapshot persists and still verifies
//      (tamper-evident digest) when read from the DB.
//   4. LIST             — a tenant's decisions come back newest-first.
//   5. DURABILITY       — a SEPARATE store instance reads the same records.
//   6. CONCURRENCY      — N parallel saves all persist and are retrievable.

import { SignalGridCore, verifySnapshot } from "@workspace/signalgrid-core";
import { PostgresDecisionStore, setDecisionStore } from "@workspace/persistence";
import { requireDisposableCluster } from "./lib/db-guard";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("Decision-store PG proof: SKIPPED (DATABASE_URL unset).");
  process.exit(0);
}
requireDisposableCluster("Decision-store PG proof");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

async function main() {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const admin = new Pool({ connectionString: url });
  await admin.query("DROP TABLE IF EXISTS decisions");
  await admin.query("DROP TABLE IF EXISTS evidence_snapshots");

  const core = SignalGridCore.demo();
  const token = core.demoApiKeys().find(
    (k) => k.tenantId === "tenant_northwind" && k.role === "operator",
  )!.token;
  const tenantId = "tenant_northwind";

  // Mint a genuine decision + snapshot from the real core.
  function mint() {
    const r = core.evaluate(token, {
      identityRef: "nurse.compliant",
      deviceRef: "ipad-ward-01",
      workflowKey: "clinical-session",
    });
    const decision = core.getDecision(token, r.decisionId);
    const snapshot = core.getSnapshot(token, decision.evidenceSnapshotId);
    return { decision, snapshot };
  }

  const store = new PostgresDecisionStore(url!);
  setDecisionStore(store);

  // ── 1. SAVE + GET ──────────────────────────────────────────────────────────
  const { decision, snapshot } = mint();
  await store.saveDecision(decision, snapshot);
  const got = await store.getDecision(tenantId, decision.id);
  check("save + get: a persisted decision reads back with the same id/outcome",
    !!got && got.id === decision.id && got.outcome === decision.outcome);

  // ── 2. TENANT ISOLATION ────────────────────────────────────────────────────
  const crossTenant = await store.getDecision("tenant_atlas", decision.id);
  check("tenant isolation: the same id under another tenant returns null", crossTenant === null);

  // ── 3. SNAPSHOT + VERIFY ───────────────────────────────────────────────────
  const gotSnap = await store.getSnapshot(tenantId, snapshot.id);
  check("snapshot persists and reads back", !!gotSnap && gotSnap.id === snapshot.id);
  check("persisted snapshot still verifies (tamper-evident digest holds)",
    !!gotSnap && verifySnapshot(gotSnap) === true);
  const crossSnap = await store.getSnapshot("tenant_atlas", snapshot.id);
  check("tenant isolation: snapshot under another tenant returns null", crossSnap === null);

  // ── 4. LIST ────────────────────────────────────────────────────────────────
  const list = await store.listDecisions(tenantId);
  check("list returns the tenant's decision(s)", list.some((d) => d.id === decision.id));
  // "Newest first" over ONE row is not an assertion: flipping ORDER BY to ASC left
  // it green. Two rows with distinct created_at, and the count that pages must not
  // stand in for.
  const older = mint();
  await store.saveDecision({ ...older.decision, createdAt: new Date(Date.parse(decision.createdAt) - 60_000).toISOString() }, older.snapshot);
  const two = await store.listDecisions(tenantId);
  check("list is newest first (the older row comes second)", two.length === 2 && two[0]!.id === decision.id && two[1]!.id === older.decision.id);
  check("list honours its limit (a PAGE, not the whole set)", (await store.listDecisions(tenantId, 1)).length === 1);
  check("countDecisions is the tenant's real count, independent of any page", (await store.countDecisions(tenantId)) === 2);
  check("countDecisions is tenant-scoped", (await store.countDecisions("tenant_atlas")) === 0);

  // ── 5. DURABILITY: a separate store instance reads the same record ─────────
  const store2 = new PostgresDecisionStore(url!);
  const durable = await store2.getDecision(tenantId, decision.id);
  check("durability: a fresh store instance reads the persisted decision", !!durable && durable.id === decision.id);

  // ── 6. CONCURRENCY: N parallel saves all persist ───────────────────────────
  await admin.query("TRUNCATE decisions, evidence_snapshots");
  const N = 20;
  const minted = Array.from({ length: N }, () => mint());
  await Promise.all(minted.map((m) => store.saveDecision(m.decision, m.snapshot)));
  const after = await store.listDecisions(tenantId, 100);
  const ids = new Set(minted.map((m) => m.decision.id));
  check(`concurrency: ${N} parallel saves all persist and are retrievable`,
    after.length === N && after.every((d) => ids.has(d.id)));

  // ── 7. WRITE-ONCE: a re-mint under the same id rewrites NOTHING ────────────
  // BUILD_BACKLOG "Durable decision write is keyed on `id` alone": with
  // `ON CONFLICT (id) DO UPDATE` a second save under the same id replaced the
  // decision's data+outcome AND its evidence snapshot, and verifySnapshot still
  // returned true over the replacement — a rewritten audit record passing the
  // tamper check. Each table is probed on its OWN (the other half of the second
  // save is byte-identical), so restoring DO UPDATE on either one fails that
  // half alone. The second save carries DIFFERENT values, so an unchanged row is
  // evidence, not coincidence; the comparison is on the stored `data::text`.
  await admin.query("TRUNCATE decisions, evidence_snapshots");
  const first = mint();
  await store.saveDecision(first.decision, first.snapshot);
  const rowOf = async (table: "decisions" | "evidence_snapshots", id: string) =>
    (await admin.query(
      table === "decisions"
        ? "SELECT tenant_id, outcome, data::text AS data FROM decisions WHERE id = $1"
        : "SELECT tenant_id, decision_id, data::text AS data FROM evidence_snapshots WHERE id = $1",
      [id],
    )).rows[0] as Record<string, string> | undefined;
  const decBefore = await rowOf("decisions", first.decision.id);
  const snapBefore = await rowOf("evidence_snapshots", first.snapshot.id);
  const refused = async (fn: () => Promise<void>) => {
    try { await fn(); return false; } catch { return true; }
  };

  // 7a. decisions half: different outcome + data, the SAME snapshot.
  const otherOutcome = first.decision.outcome === "deny" ? "allow" : "deny";
  const rewrittenDecision = {
    ...first.decision,
    outcome: otherOutcome as typeof first.decision.outcome,
    reasonCodes: ["PLANTED_REWRITE"],
  } as typeof first.decision;
  const decRefused = await refused(() => store.saveDecision(rewrittenDecision, first.snapshot));
  const decAfter = await rowOf("decisions", first.decision.id);
  check("write-once (decisions): a re-mint with a different outcome leaves `outcome` byte-identical",
    !!decBefore && !!decAfter && decAfter.outcome === decBefore.outcome && decAfter.outcome === first.decision.outcome);
  check("write-once (decisions): a re-mint with different data leaves `data` byte-identical",
    !!decBefore && !!decAfter && decAfter.data === decBefore.data);
  check("write-once (decisions): the conflicting re-mint is REFUSED, not swallowed", decRefused);

  // 7b. evidence_snapshots half: the SAME decision, a different snapshot
  //     (capturedAt and evidence both moved).
  const rewrittenSnapshot = {
    ...first.snapshot,
    capturedAt: new Date(Date.parse(first.snapshot.capturedAt) + 3_600_000).toISOString(),
    evidence: { ...(first.snapshot as any).evidence, planted: "rewrite" },
  } as typeof first.snapshot;
  const snapRefused = await refused(() => store.saveDecision(first.decision, rewrittenSnapshot));
  const snapAfter = await rowOf("evidence_snapshots", first.snapshot.id);
  check("write-once (evidence_snapshots): a re-mint leaves the snapshot `data` byte-identical, capturedAt included",
    !!snapBefore && !!snapAfter && snapAfter.data === snapBefore.data &&
      JSON.parse(snapAfter.data).capturedAt === first.snapshot.capturedAt);
  check("write-once (evidence_snapshots): the conflicting re-mint is REFUSED, not swallowed", snapRefused);
  const readBack = await store.getSnapshot(tenantId, first.snapshot.id);
  check("write-once: the stored snapshot still verifies and is the ORIGINAL",
    !!readBack && verifySnapshot(readBack) === true && readBack.capturedAt === first.snapshot.capturedAt);

  // 7c. a genuine retry (byte-identical on both tables) still succeeds.
  const retryOk = !(await refused(() => store.saveDecision(first.decision, first.snapshot)));
  check("write-once: a byte-identical retry is idempotent (accepted, row unchanged)",
    retryOk && (await rowOf("decisions", first.decision.id))?.data === decBefore?.data);

  // 7d. tenant-aware guard: the same id arriving under ANOTHER tenant is refused
  //     and the owning tenant's row is untouched.
  const foreign = { ...first.decision, tenantId: "tenant_atlas" } as typeof first.decision;
  const foreignSnap = { ...first.snapshot, tenantId: "tenant_atlas" } as typeof first.snapshot;
  const foreignRefused = await refused(() => store.saveDecision(foreign, foreignSnap));
  const afterForeign = await rowOf("decisions", first.decision.id);
  check("write-once: a same-id save under another tenant is REFUSED and the row keeps its tenant",
    foreignRefused && afterForeign?.tenant_id === tenantId && afterForeign?.data === decBefore?.data);
  check("write-once: tenant B still cannot read tenant A's decision",
    (await store.getDecision("tenant_atlas", first.decision.id)) === null);

  await admin.query("DROP TABLE IF EXISTS decisions");
  await admin.query("DROP TABLE IF EXISTS evidence_snapshots");
  await admin.end();
  await store.close?.();
  await store2.close?.();

  const total = passed + failures.length;
  console.log(`Decision-store PG proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Durable decision + evidence store verified on real Postgres — save/get/list, tenant isolation, tamper-evident snapshots, durability, concurrency.");
}

main().catch((err) => { console.error(err); process.exit(1); });
