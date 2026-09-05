// Proof: session lifecycle on REAL Postgres (@workspace/persistence).
// SELF-SKIPS without DATABASE_URL. Proves durability across instances plus the
// lifecycle + tenant isolation + concurrency against a live database.
//
//   DATABASE_URL=postgres://sg@localhost:5433/signalgrid \
//     pnpm --filter @workspace/scripts run proof:session-store-pg

import { PostgresSessionStore, setSessionStore, type Session } from "@workspace/persistence";
import { requireDisposableCluster } from "./lib/db-guard";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("Session-store PG proof: SKIPPED (DATABASE_URL unset).");
  process.exit(0);
}
requireDisposableCluster("Session-store PG proof");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const T0 = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();
function mk(id: string, tenantId: string, ttlSeconds: number, now = T0): Session {
  return {
    id, tenantId,
    identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session",
    status: "active", outcome: "allow", decisionId: "dec_test",
    createdAt: iso(now), lastSeenAt: iso(now), expiresAt: iso(now + ttlSeconds * 1000),
  };
}

async function main() {
  const pg = await import("pg");
  const Pool = (pg as any).default?.Pool ?? (pg as any).Pool;
  const admin = new Pool({ connectionString: url });
  await admin.query("DROP TABLE IF EXISTS sessions");

  const store = new PostgresSessionStore(url!);
  setSessionStore(store);

  // ── start + get + isolation ─────────────────────────────────────────────────
  await store.start(mk("sess_pg_a", "tenant_northwind", 900));
  check("start + get: active session reads back", (await store.get("tenant_northwind", "sess_pg_a", T0 + 1000))?.status === "active");
  check("tenant isolation: cross-tenant get returns null", (await store.get("tenant_atlas", "sess_pg_a", T0 + 1000)) === null);

  // ── refresh + expiry ────────────────────────────────────────────────────────
  const r = await store.refresh("tenant_northwind", "sess_pg_a", 1800, T0 + 60_000);
  check("refresh extends the persisted TTL", !!r && Date.parse(r.expiresAt) === T0 + 60_000 + 1800 * 1000);
  await store.start(mk("sess_pg_b", "tenant_northwind", 60));
  check("expired session reads as expired (persisted transition)",
    (await store.get("tenant_northwind", "sess_pg_b", T0 + 120_000))?.status === "expired");
  check("refresh of an EXPIRED session returns null on Postgres too (nothing was refreshed)",
    (await store.refresh("tenant_northwind", "sess_pg_b", 900, T0 + 130_000)) === null);

  // ── DURABILITY: a fresh instance reads the same sessions ────────────────────
  const store2 = new PostgresSessionStore(url!);
  check("durability: a fresh instance reads the persisted session", (await store2.get("tenant_northwind", "sess_pg_a", T0 + 61_000))?.status === "active");

  // ── end + isolation ─────────────────────────────────────────────────────────
  check("end marks ended", (await store.end("tenant_northwind", "sess_pg_a"))?.status === "ended");
  check("tenant isolation: cross-tenant end returns null", (await store.end("tenant_atlas", "sess_pg_b")) === null);

  // ── CONCURRENCY: N parallel starts all persist ──────────────────────────────
  await admin.query("TRUNCATE sessions");
  const N = 20;
  await Promise.all(Array.from({ length: N }, (_, i) => store.start(mk(`sess_pg_c_${i}`, "tenant_northwind", 900))));
  const rows = await admin.query("SELECT count(*)::int AS n FROM sessions WHERE tenant_id = 'tenant_northwind'");
  check(`concurrency: ${N} parallel session starts all persist`, rows.rows[0].n === N);

  await admin.query("DROP TABLE IF EXISTS sessions");
  await admin.end();
  await store.close?.();
  await store2.close?.();

  const total = passed + failures.length;
  console.log(`Session-store PG proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Durable session lifecycle verified on real Postgres — start/refresh/expire/end, tenant isolation, durability, concurrency.");
}

main().catch((err) => { console.error(err); process.exit(1); });
