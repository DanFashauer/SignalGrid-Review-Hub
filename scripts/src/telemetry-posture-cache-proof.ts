// Proof: the Fleet posture cache SERVES NOTHING STALE, and does not grow without bound.
//
// THE DEFECT THIS PINS. getPostureForHost() returned the cached entry without ever
// consulting `expiresAt`:
//
//     return inMemoryPosture.get(key) ?? null;
//
// Redis expires its own keys through `EX`, so that half was covered by the server. The
// IN-MEMORY half — the default path whenever REDIS_URL is unset, and the fallback
// whenever Redis throws — returned indefinitely stale posture carrying an `expiresAt`
// long in the past. The field was computed on write, stored, and read by NOTHING in
// the repository: two write sites, zero readers.
//
// Second defect, same function family: `inMemoryPosture` never pruned. It gained an
// entry per host UUID on every posture fetch (fleetdm.ts calls setPostureForHost on
// each one) and was emptied only by an explicit clearPostureCache(), so a long-running
// process polling a fleet grew it without bound.
//
// Stale device posture must TIGHTEN the answer, never be served as current. An expired
// or unreadable entry now reads as "no cached posture", which forces a fresh fetch.
//
// Run: pnpm --filter @workspace/scripts run proof:telemetry-posture-cache
import {
  clearPostureCache,
  getPostureForHost,
  inMemoryPostureSize,
  isPostureExpired,
  parsePostureEntry,
  purgeExpiredPosture,
  setPostureForHost,
} from "@workspace/integrations/telemetry/store";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Proof: telemetry posture cache — nothing stale is served, nothing grows unbounded\n");

// This proof drives the in-memory path deliberately: it is the half that was broken,
// and the half that runs whenever REDIS_URL is unset.
delete process.env.REDIS_URL;

const T0 = 1_000_000_000_000; // a fixed clock; no Date.now() in the assertions

// --- EXPIRY IS HONORED ------------------------------------------------------------
await clearPostureCache();
await setPostureForHost("host-a", { compliant: true }, 300);

const fresh = await getPostureForHost("host-a", T0);
check("a just-written entry is returned (the cache is not merely always-null)", fresh !== null);

// The write stamps expiresAt from the real clock, so read far past any plausible TTL.
const FAR_FUTURE = Date.now() + 300 * 1000 + 60_000;
check(
  "an entry read AFTER its TTL returns null, not stale posture — this is the defect",
  (await getPostureForHost("host-a", FAR_FUTURE)) === null,
);

// --- FAIL-CLOSED ON ANYTHING UNREADABLE -------------------------------------------
check("a NaN expiry counts as EXPIRED (NaN <= now is false, so a bare compare would serve it forever)",
  isPostureExpired({ data: {}, expiresAt: Number.NaN }, T0));
check("an Infinity expiry counts as expired — not-finite is not a licence to serve", 
  isPostureExpired({ data: {}, expiresAt: Number.POSITIVE_INFINITY }, T0));
check("an expiry exactly equal to now counts as expired (boundary tightens, not loosens)",
  isPostureExpired({ data: {}, expiresAt: T0 }, T0));
check("an expiry in the future is NOT expired — the check is not vacuously true",
  !isPostureExpired({ data: {}, expiresAt: T0 + 1 }, T0));

check("malformed JSON parses to null, never to a servable entry", parsePostureEntry("{not json") === null);
check("an entry with NO expiresAt parses to null", parsePostureEntry(JSON.stringify({ data: 1 })) === null);
check("an entry with a non-numeric expiresAt parses to null",
  parsePostureEntry(JSON.stringify({ data: 1, expiresAt: "soon" })) === null);
check("a JSON null parses to null", parsePostureEntry("null") === null);
check("a well-formed entry DOES parse — the parser is not refusing everything",
  parsePostureEntry(JSON.stringify({ data: { x: 1 }, expiresAt: T0 }))?.expiresAt === T0);

// --- THE MAP IS BOUNDED ------------------------------------------------------------
await clearPostureCache();
check("cleared cache is empty", inMemoryPostureSize() === 0);

for (let i = 0; i < 25; i += 1) await setPostureForHost(`host-${i}`, { i }, 300);
check("25 live hosts are all retained — purging does not throw away valid entries", inMemoryPostureSize() === 25);

check("purging at a time past every TTL removes all 25", purgeExpiredPosture(FAR_FUTURE) === 25);
check("...and the Map is then empty, so it cannot grow without bound", inMemoryPostureSize() === 0);

check("purging with nothing expired removes nothing", purgeExpiredPosture(T0) === 0);

// --- READING AN EXPIRED ENTRY ALSO EVICTS IT ---------------------------------------
await clearPostureCache();
await setPostureForHost("host-evict", { compliant: false }, 300);
check("entry present before the expired read", inMemoryPostureSize() === 1);
await getPostureForHost("host-evict", FAR_FUTURE);
check("a read that finds an expired entry EVICTS it rather than leaving it to accumulate",
  inMemoryPostureSize() === 0);

// --- PRUNING IS ACTUALLY WIRED INTO THE WRITE PATH -------------------------------
// Asserting purgeExpiredPosture() works is not the same claim as asserting it RUNS.
// A ttl of 0 stamps expiresAt === the write instant, which isPostureExpired treats as
// already expired (the boundary tightens), so the NEXT write must sweep it away.
await clearPostureCache();
await setPostureForHost("host-ttl0", { stale: true }, 0);
await setPostureForHost("host-live", { stale: false }, 300);
check(
  "writing purges entries that have already expired — the sweep is wired into set(), not merely available",
  inMemoryPostureSize() === 1,
);
check("...and the surviving entry is the live one", (await getPostureForHost("host-live", T0)) !== null);

check("a miss on an unknown host is null", (await getPostureForHost("never-written", T0)) === null);

await clearPostureCache();
console.log(`\n${failures.length === 0 ? "PASS" : "FAIL"} — ${passed}/${passed + failures.length} checks`);
if (failures.length > 0) {
  for (const f of failures) console.error(`  x ${f}`);
  process.exit(1);
}
