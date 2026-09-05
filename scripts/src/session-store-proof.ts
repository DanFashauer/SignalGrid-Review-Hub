// Proof: session lifecycle (@workspace/persistence, in-memory backend).
//
// Deterministic — time is injected (nowMs), so start → refresh → expire → end
// is verified without sleeping. Runs in the default preflight (no database).
//
// Run: pnpm --filter @workspace/scripts run proof:session-store

import { InMemorySessionStore, type Session } from "@workspace/persistence";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

const T0 = 1_700_000_000_000; // fixed base clock (ms)
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
  const store = new InMemorySessionStore();

  // ── start + get ─────────────────────────────────────────────────────────────
  await store.start(mk("sess_a", "tenant_northwind", 900));
  const got = await store.get("tenant_northwind", "sess_a", T0 + 1000);
  check("start + get: an active session reads back active", got?.status === "active");

  // ── tenant isolation ────────────────────────────────────────────────────────
  const cross = await store.get("tenant_atlas", "sess_a", T0 + 1000);
  check("tenant isolation: another tenant cannot read the session", cross === null);

  // ── refresh extends the TTL from an active session ──────────────────────────
  const refreshed = await store.refresh("tenant_northwind", "sess_a", 1800, T0 + 60_000);
  check("refresh extends expiry and updates lastSeenAt",
    !!refreshed && Date.parse(refreshed.expiresAt) === T0 + 60_000 + 1800 * 1000 &&
    Date.parse(refreshed.lastSeenAt) === T0 + 60_000);

  // ── lazy expiry: reading past expiry yields "expired" ───────────────────────
  await store.start(mk("sess_b", "tenant_northwind", 60)); // expires at T0+60s
  const live = await store.get("tenant_northwind", "sess_b", T0 + 30_000);
  const dead = await store.get("tenant_northwind", "sess_b", T0 + 120_000);
  check("session is active before its TTL", live?.status === "active");
  check("session reads as expired after its TTL", dead?.status === "expired");

  // ── refresh cannot revive an expired session ────────────────────────────────
  // null, not the expired object: refresh used to hand the dead session back, and
  // the route answered 200 with status "expired" plus a session.refresh audit row
  // for a refresh that never happened.
  const noRevive = await store.refresh("tenant_northwind", "sess_b", 900, T0 + 130_000);
  check("refresh of an EXPIRED session returns null (nothing was refreshed)", noRevive === null);
  check("…and the session is still expired afterwards", (await store.get("tenant_northwind", "sess_b", T0 + 130_000))?.status === "expired");

  // ── an expiry that cannot be read is EXPIRED, not active ────────────────────
  // The Number.isFinite guard in withExpiry is correct today and nothing held it
  // there: every fixture here built expiresAt with iso(), so a refactor that moved
  // the parse behind a helper (which the NaN gate cannot follow) would have been
  // green. This is the assertion that fails when it comes back.
  await store.start({ ...mk("sess_nan", "tenant_northwind", 900), expiresAt: "not-a-date" });
  const unreadable = await store.get("tenant_northwind", "sess_nan", T0 + 1000);
  check("an UNPARSEABLE expiresAt reads as expired (fail closed), never active", unreadable?.status === "expired");
  check("…and cannot be refreshed back", (await store.refresh("tenant_northwind", "sess_nan", 900, T0 + 1000)) === null);

  // ── end (sign-out) ──────────────────────────────────────────────────────────
  const ended = await store.end("tenant_northwind", "sess_a");
  check("end marks the session ended", ended?.status === "ended");
  check("refresh of an ENDED session returns null", (await store.refresh("tenant_northwind", "sess_a", 900, T0 + 1000)) === null);
  const endedCross = await store.end("tenant_atlas", "sess_a");
  check("tenant isolation: another tenant cannot end the session", endedCross === null);

  // ── missing session ─────────────────────────────────────────────────────────
  check("get on an unknown id returns null", (await store.get("tenant_northwind", "nope", T0)) === null);

  const total = passed + failures.length;
  console.log(`Session-store proof: ${passed}/${total} assertions passed`);
  if (failures.length) {
    console.error("Failed assertions:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Session lifecycle verified (start / refresh / expire / end, tenant-scoped, deterministic).");
}

main().catch((err) => { console.error(err); process.exit(1); });
