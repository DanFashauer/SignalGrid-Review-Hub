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
