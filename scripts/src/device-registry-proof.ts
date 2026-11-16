// Proof: the device registry's three fail-open shapes, found by the ninth audit
// round (2026-09-06) and each reproduced against the real module before the fix:
//
//   1. KEY COLLISION. The Redis backend stored a device under
//      `deviceId.replace(/[\s:]/g, '_')` while the validator admits ':' AND '_',
//      so `AA:BB:CC:DD:EE:FF` and `AA_BB_CC_DD_EE_FF` — two valid, distinct ids —
//      shared ONE record. Enrolling the first made the second "allowed", and the
//      resolver handed the wrong device's serial and platform to NAC/UEM lookups.
//      The key is now injective over valid ids; asserted exhaustively over a
//      small alphabet, and the OLD transform is shown to collide on the same set.
//   2. ALLOWLIST OPENED BY A TYPO. `process.env.DEVICE_ALLOWLIST_MODE === 'true'`
//      meant "TRUE", "1", "yes" and an UNSET variable all opened the allowlist:
//      an operator who believed it was on had every device admitted. Now "false"
//      is the only value that opens it; absent or unrecognized ENFORCES.
//   3. FRESHNESS WRITTEN, NEVER READ. `lastSeenAt` was stamped on every check-in
//      and consulted by nothing; an enrolled device unseen for 364 days stayed
//      allowed for the whole one-year record TTL. `isAllowedByPolicy` now bounds
//      it (default 30 days), and an absent, unparseable or future stamp never
//      counts as fresh.
//
// Plus: the production (Redis) `enroll` validated nothing while the dev backend
// validated everything — both now share `validateEnrollmentRequest`.
//
// Every assertion here is a pure function call; no Redis is needed, and the
// singleton is exercised in its in-memory form with the environment unset.

import { deviceRegistry as registryModule } from "@workspace/integrations";

const {
  deviceKey,
  isValidHardwareId,
  validateEnrollmentRequest,
  parseAllowlistMode,
  parseStaleSeconds,
  isAllowedByPolicy,
  DEFAULT_STALE_SECONDS,
  FUTURE_SKEW_MS,
  deviceRegistry,
  DEVICE_CONFIG,
} = registryModule;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

const NOW = Date.parse("2026-09-06T00:00:00.000Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const device = (over: Partial<Parameters<typeof isAllowedByPolicy>[0] & object> = {}) => ({
  deviceId: "dev-0001",
  deviceSerial: "SN000001",
  deviceModel: "m",
  osVersion: "1",
  enrolled: true,
  lastSeenAt: iso(NOW - DAY),
  ...over,
});

async function main(): Promise<void> {
  console.log("Device-registry proof");

  // ── 1. Key injectivity ────────────────────────────────────────────────────
  check("the two ids that used to collide now map to different keys",
    deviceKey("device", "AA:BB:CC:DD:EE:FF") !== deviceKey("device", "AA_BB_CC_DD_EE_FF"),
    `${deviceKey("device", "AA:BB:CC:DD:EE:FF")} vs ${deviceKey("device", "AA_BB_CC_DD_EE_FF")}`);

  // Exhaustive over a 4-letter alphabet that contains BOTH characters the old
  // transform folded together: every valid id of length 4 gets its own key.
  const alphabet = ["a", ":", "_", "-"];
  const ids: string[] = [];
  for (const a of alphabet) for (const b of alphabet) for (const c of alphabet) for (const d of alphabet) ids.push(a + b + c + d);
  const allValid = ids.every((id) => isValidHardwareId(id));
  check("every id in the exhaustive set is admitted by the validator (so the set is the right one to test)", allValid);
  const keys = new Set(ids.map((id) => deviceKey("device", id)));
  check("the new key is injective over that set: as many keys as ids", keys.size === ids.length, `${keys.size}/${ids.length}`);
  const oldKeys = new Set(ids.map((id) => `device:${id.replace(/[\s:]/g, "_")}`));
  check("…and the OLD transform was NOT: it folded the same set into fewer keys", oldKeys.size < ids.length, `${oldKeys.size}/${ids.length}`);
  check("the key keeps the prefix separator and never contains the raw ':' from the id",
    deviceKey("device", "a:b:c:d").startsWith("device:") && !deviceKey("device", "a:b:c:d").slice("device:".length).includes(":"));

  // ── 2. The validator, shared by both backends ────────────────────────────
  check("a 3-character id is rejected", !isValidHardwareId("abc"));
  check("a 65-character id is rejected", !isValidHardwareId("a".repeat(65)));
  check("a 64-character id is admitted", isValidHardwareId("a".repeat(64)));
  check("whitespace is rejected (so the old replace() had nothing to fold)", !isValidHardwareId("ab cd"));
  check("'%' is rejected (so an encoded ':' cannot be forged by a raw id)", !isValidHardwareId("ab%3Acd"));
  check("a non-string is rejected", !isValidHardwareId(1234 as unknown));
  const good = { deviceId: "dev-0001", deviceSerial: "SN000001", deviceModel: "iPhone", osVersion: "17.0", mdmEnrolled: true };
  let threw = "";
  try { validateEnrollmentRequest(good); } catch (e) { threw = String(e); }
  check("a well-formed enrollment request validates", threw === "", threw);
  for (const [field, value, expect] of [
    ["deviceId", "x", "Invalid device ID"],
    ["deviceSerial", "a b", "Invalid device serial"],
    ["deviceModel", "", "Device model is required"],
    ["osVersion", "", "OS version is required"],
  ] as const) {
    let msg = "";
    try { validateEnrollmentRequest({ ...good, [field]: value }); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    check(`an enrollment with a bad ${field} is refused by name`, msg.includes(expect), msg);
  }

  // ── 3. Allowlist mode: "false" is the only opener ────────────────────────
  check("'true' enforces (explicit)", JSON.stringify(parseAllowlistMode("true")) === JSON.stringify({ mode: "enforced", source: "explicit" }));
  check("'false' opens (explicit)", JSON.stringify(parseAllowlistMode("false")) === JSON.stringify({ mode: "open", source: "explicit" }));
  check("ABSENT enforces — a policy default is never derived from missing configuration",
    JSON.stringify(parseAllowlistMode(undefined)) === JSON.stringify({ mode: "enforced", source: "absent" }));
  for (const raw of ["TRUE", "1", "yes", "", "False", " false"]) {
    const r = parseAllowlistMode(raw);
    check(`${JSON.stringify(raw)} enforces and is reported as unrecognized (it used to OPEN the allowlist)`,
      r.mode === "enforced" && r.source === "unrecognized", JSON.stringify(r));
  }

  // ── 4. Stale bound parsing: never "forever" ──────────────────────────────
  check("absent stale bound is the 30-day default", parseStaleSeconds(undefined) === DEFAULT_STALE_SECONDS && DEFAULT_STALE_SECONDS === 30 * 86_400);
  check("a positive integer is honoured", parseStaleSeconds("86400") === 86_400);
  for (const raw of ["0", "-5", "abc", "1.5", "Infinity", ""]) {
    check(`${JSON.stringify(raw)} falls back to the default, never to no bound`, parseStaleSeconds(raw) === DEFAULT_STALE_SECONDS);
  }

  // ── 5. The allow decision ────────────────────────────────────────────────
  const S = DEFAULT_STALE_SECONDS;
  check("open mode allows even an unknown device (the explicit operator choice)", isAllowedByPolicy(null, "open", NOW, S) === true);
  check("enforced: an unknown device is refused", isAllowedByPolicy(null, "enforced", NOW, S) === false);
  check("enforced: an un-enrolled record is refused", isAllowedByPolicy(device({ enrolled: false }), "enforced", NOW, S) === false);
  check("enforced: enrolled and seen yesterday is allowed", isAllowedByPolicy(device(), "enforced", NOW, S) === true);
  check("enforced: `enrolled` must be the boolean true, not a truthy string",
    isAllowedByPolicy(device({ enrolled: "yes" as unknown as boolean }), "enforced", NOW, S) === false);
  check("freshness: NO lastSeenAt is not fresh", isAllowedByPolicy(device({ lastSeenAt: undefined }), "enforced", NOW, S) === false);
  check("freshness: an unparseable lastSeenAt is not fresh", isAllowedByPolicy(device({ lastSeenAt: "yesterday-ish" }), "enforced", NOW, S) === false);
  check("freshness: seen 31 days ago is stale under the 30-day default", isAllowedByPolicy(device({ lastSeenAt: iso(NOW - 31 * DAY) }), "enforced", NOW, S) === false);
  check("freshness: seen exactly at the bound is still allowed (inclusive)", isAllowedByPolicy(device({ lastSeenAt: iso(NOW - S * 1000) }), "enforced", NOW, S) === true);
  check("freshness: one second past the bound is refused", isAllowedByPolicy(device({ lastSeenAt: iso(NOW - S * 1000 - 1000) }), "enforced", NOW, S) === false);
  check("freshness: a stamp from the future beyond the skew tolerance is a broken clock, not freshness",
    isAllowedByPolicy(device({ lastSeenAt: iso(NOW + FUTURE_SKEW_MS + 1000) }), "enforced", NOW, S) === false);
  check("freshness: a stamp slightly ahead (within the skew tolerance) is honest clock drift and allowed",
    isAllowedByPolicy(device({ lastSeenAt: iso(NOW + FUTURE_SKEW_MS - 1000) }), "enforced", NOW, S) === true);
  check("a tighter operator bound tightens: seen yesterday, bound of one hour → refused",
    isAllowedByPolicy(device(), "enforced", NOW, 3600) === false);

  // ── 6. The singleton, in-memory, with the environment as it is here ──────
  check("this process has no DEVICE_ALLOWLIST_MODE set (so the singleton exercises the ABSENT default)", process.env.DEVICE_ALLOWLIST_MODE === undefined);
  check("…and the live CONFIG reads enforced/absent", DEVICE_CONFIG.allowlistMode === "enforced" && DEVICE_CONFIG.allowlistSource === "absent",
    `${DEVICE_CONFIG.allowlistMode}/${DEVICE_CONFIG.allowlistSource}`);
  check("singleton: a never-enrolled id is refused", (await deviceRegistry.isAllowed("never-enrolled-device")) === false);
  check("singleton: the enrolled, just-seen demo device is allowed", (await deviceRegistry.isAllowed("test-device-001")) === true);
  check("singleton: the demo device with enrolled:false is refused", (await deviceRegistry.isAllowed("test-device-003")) === false);
  let enrollMsg = "";
  try { await deviceRegistry.enroll({ ...good, deviceId: "x" }); } catch (e) { enrollMsg = e instanceof Error ? e.message : String(e); }
  check("singleton: enroll() refuses a malformed id through the shared validator", enrollMsg.includes("Invalid device ID"), enrollMsg);

  const total = passed + failures.length;
  console.log(`\nDevice-registry proof: ${passed}/${total} assertions passed`);
  console.log(`summary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Device registry: keys injective over valid ids, the allowlist opens only on an explicit \"false\", freshness bounds the allow, both backends validate.");
}

main().catch((err) => {
  console.error(`proof:device-registry crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
