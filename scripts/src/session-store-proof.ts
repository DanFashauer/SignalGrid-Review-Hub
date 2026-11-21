// Proof: session lifecycle (@workspace/persistence, in-memory backend).
//
// Deterministic — time is injected (nowMs), so start → refresh → expire → end
// is verified without sleeping. Runs in the default preflight (no database).
//
// Run: pnpm --filter @workspace/scripts run proof:session-store

import {
  InMemorySessionStore,
  durableDatabaseUrl,
  getDecisionStore,
  setDecisionStore,
  getSessionStore,
  setSessionStore,
  PostgresDecisionStore,
  PostgresSessionStore,
  type Session,
} from "@workspace/persistence";
import { getAuditBackend, setAuditBackend, PostgresAuditBackend, InMemoryAuditBackend } from "@workspace/audit";

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

  // ── refresh RACING end (in-memory parity with the Postgres status guard) ────
  // refresh() awaits get(), then writes. Force end() to land exactly in that
  // window (deterministic, not timing-dependent). Without the pre-write status
  // re-check the stale `active` snapshot overwrote the ended row — the ended
  // session came back to life in the default store.
  await store.start(mk("sess_race", "tenant_northwind", 900));
  const realGet = store.get.bind(store);
  let endedInWindow = false;
  (store as any).get = async (t: string, i: string, n: number) => {
    const s = await realGet(t, i, n);
    if (!endedInWindow && i === "sess_race") {
      endedInWindow = true;
      await store.end(t, i);
    }
    return s;
  };
  const lost = await store.refresh("tenant_northwind", "sess_race", 1800, T0 + 5_000);
  (store as any).get = realGet;
  check("race: end() landed between refresh's read and write", endedInWindow);
  check("race: the losing in-memory refresh returns null, never an `active` session", lost === null);
  const raced = await store.get("tenant_northwind", "sess_race", T0 + 6_000);
  check("race: the row stays `ended` (the stale snapshot did not revive it)", raced?.status === "ended");
  check("race: the losing refresh did not move expiresAt",
    !!raced && Date.parse(raced.expiresAt) === T0 + 900 * 1000);

  // ── end (sign-out) ──────────────────────────────────────────────────────────
  const ended = await store.end("tenant_northwind", "sess_a");
  check("end marks the session ended", ended?.status === "ended");
  check("refresh of an ENDED session returns null", (await store.refresh("tenant_northwind", "sess_a", 900, T0 + 1000)) === null);
  const endedCross = await store.end("tenant_atlas", "sess_a");
  check("tenant isolation: another tenant cannot end the session", endedCross === null);

  // ── missing session ─────────────────────────────────────────────────────────
  check("get on an unknown id returns null", (await store.get("tenant_northwind", "nope", T0)) === null);

  // ── DATABASE_URL reading (BUILD_BACKLOG "Empty/whitespace DATABASE_URL") ────
  // Unset and "" stay the supported off mode; surrounding whitespace is trimmed;
  // a set-but-blank value is REFUSED rather than read as "off" (which would let a
  // durable deployment go ephemeral and report ready). No database is touched:
  // the selector only constructs a store, it connects lazily.
  const refuses = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
  check("DATABASE_URL unset → no durable store", durableDatabaseUrl({}) === null);
  check("DATABASE_URL \"\" → no durable store (unchanged off mode)", durableDatabaseUrl({ DATABASE_URL: "" }) === null);
  check("DATABASE_URL with surrounding whitespace/newline → the trimmed URL",
    durableDatabaseUrl({ DATABASE_URL: "  postgres://h/db\n" }) === "postgres://h/db");
  check("DATABASE_URL whitespace-only → REFUSED, not read as 'off'",
    refuses(() => durableDatabaseUrl({ DATABASE_URL: " \t\n " })));
  const saved = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "   ";
    check("getDecisionStore() refuses a whitespace-only DATABASE_URL (no silent null)", refuses(() => getDecisionStore()));
    check("…and keeps refusing on the next call (the refusal is not cached as 'off')", refuses(() => getDecisionStore()));
    check("getSessionStore() refuses a whitespace-only DATABASE_URL (no silent in-memory fallback)", refuses(() => getSessionStore()));
    check("getAuditBackend() refuses a whitespace-only DATABASE_URL too (all three stores, one reading)", refuses(() => getAuditBackend()));

    // ALL THREE STORES AGREE on a padded URL. When only two trimmed, a leading
    // space persisted a decision while the ledger failed: a decision with no
    // audit record. Each selector must build its Postgres form from the SAME
    // trimmed string. (Nothing listens on port 1; the stores are closed below.)
    process.env.DATABASE_URL = "  postgres://nobody:nothing@127.0.0.1:1/absent\n";
    const want = "postgres://nobody:nothing@127.0.0.1:1/absent";
    const ds = getDecisionStore();
    const ss = getSessionStore();
    const ab = getAuditBackend();
    check("padded DATABASE_URL: decisions, sessions AND the audit ledger all select Postgres",
      ds instanceof PostgresDecisionStore && ss instanceof PostgresSessionStore && ab instanceof PostgresAuditBackend);
    check("padded DATABASE_URL: all three were handed the SAME trimmed connection string",
      [ds, ss, ab].every((x) => (x as unknown as { connectionString?: string })?.connectionString === want));
    await Promise.allSettled([ds?.close?.(), ss.close?.(), (ab as { close?: () => Promise<void> }).close?.()]);
    setDecisionStore(null);
    setSessionStore(new InMemorySessionStore());
    setAuditBackend(null);
    // Re-arm the decision selector's cache as "not chosen yet" for the next checks.
    setDecisionStore(undefined as unknown as null);
    delete process.env.DATABASE_URL;
    check("getDecisionStore() with DATABASE_URL unset → null (off mode intact)", getDecisionStore() === null);
    check("getSessionStore() with DATABASE_URL unset → the in-memory store",
      getSessionStore() instanceof InMemorySessionStore);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved;
    setSessionStore(new InMemorySessionStore());
    setAuditBackend(new InMemoryAuditBackend());
  }

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
