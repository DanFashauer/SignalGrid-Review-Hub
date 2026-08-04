// RTLS / badge-dwell physical-custody proof — fully OFFLINE and deterministic.
//
// Drives the read-only RTLS custody connector against a deterministic mock
// (normalization of vendor zone vocabularies, pagination, read-only enforcement,
// auth failure, gating) and runs the pure evaluator per device — asserting each
// device's real-time location + dwell + badge association resolve to the right
// custody posture and the action it warrants (left the area ⇒ escalate; stale/
// unconfirmable fix ⇒ locate; untracked ⇒ unknown, never in-custody). No network,
// no real location data.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RtlsConnectorError,
  RtlsCustodyConnector,
  createMockRtlsTransport,
  evaluateCustodyPosture,
  guardReadOnly,
  normalizeLocation,
  resolveRtlsCustodyConnector,
  type AssetLocationRaw,
} from "@workspace/integrations/rtls-custody";
import { checkLiveGateIsolated } from "./lib/live-gate.js";

interface Expected {
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  zoneType: string;
}
interface Fixture {
  accessToken: string;
  locations: Record<string, { record: AssetLocationRaw; expected: Expected }>;
}

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/rtls-custody/locations.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const BASE_URL = "https://api.rtls.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("RTLS / badge-dwell physical-custody proof");
const names = Object.keys(fixture.locations);
console.log(`devices=${names.length}`);

// Feed every device record through the connector to exercise paging/normalize.
const records: AssetLocationRaw[] = names.map((n) => fixture.locations[n].record);
const transport = createMockRtlsTransport({ locations: records, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new RtlsCustodyConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const normalized = await connector.fetchLocations();
check(`pagination reassembles all ${records.length} devices`, normalized.length === records.length);
check("every normalized location carries sourceSystem", normalized.every((l) => l.sourceSystem === "rtls-custody"));

// Per-device custody posture against the fixture expectations.
for (const name of names) {
  const spec = fixture.locations[name];
  const l = normalized.find((x) => x.deviceId === spec.record.deviceId)!;
  const v = evaluateCustodyPosture(l);
  const ok =
    v.posture === spec.expected.posture &&
    v.reasonCode === spec.expected.reasonCode &&
    v.recommendedAction === spec.expected.recommendedAction &&
    v.zoneType === spec.expected.zoneType;
  check(`evaluate ${name} → ${spec.expected.posture}/${spec.expected.recommendedAction}`, ok);
}

// ── fail-safe invariants ──────────────────────────────────────────────────────

// Untracked ≠ in-custody: a device the RTLS has no record for is unknown (a
// blind spot), NOT in good custody.
const untracked = evaluateCustodyPosture(normalizeLocation({ deviceId: "ghost" }), { tracked: false });
check("an untracked device is 'unknown', never 'in_zone'", untracked.posture === "unknown" && untracked.reasonCode === "NOT_TRACKED");

// Not present dominates: a device that left the monitored area escalates even if
// every other field looks clean.
const gone = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 5, badgeAssociated: true, present: false }));
check("a device not present in the area escalates (LEFT_AREA), regardless of other fields", gone.posture === "left_area" && gone.recommendedAction === "escalate");

// Fail-safe: an unconfirmable (null) fix age is treated as stale, not fresh.
const noFix = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, badgeAssociated: true, present: true }));
check("an unreported fix age is treated as stale → locate (never in_zone)", noFix.posture === "stale_fix" && noFix.recommendedAction === "locate");

// Fail-safe: no badge + unconfirmable (null) dwell → abandoned (dwell not assumed short).
const noBadgeNoDwell = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "public", zoneAuthorized: true, fixAgeSeconds: 30, badgeAssociated: false, present: true }));
check("no badge with an unreported dwell is treated as abandoned", noBadgeNoDwell.posture === "abandoned" && noBadgeNoDwell.reasonCode === "ABANDONED");

// Order-proof: at egress (alert) co-present with a stale fix (locate) → the
// stronger alert wins, regardless of check order.
const egressAndStale = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "egress", zoneAuthorized: true, fixAgeSeconds: 5000, badgeAssociated: true, atEgress: true, present: true }));
check("at-egress (alert) outranks a co-present stale fix (locate)", egressAndStale.recommendedAction === "alert" && egressAndStale.posture === "at_egress");

// Fail-safe (regression): a device in an UNCLASSIFIABLE zone with UNCONFIRMED
// authorization must never read as 'custody OK' — it surfaces as zone_unverified.
const unverified = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "quarantine", fixAgeSeconds: 5, dwellSeconds: 10, badgeAssociated: true, present: true }));
check("an unmapped zone with unconfirmed authorization is never 'custody OK' (→ zone_unverified/monitor)", unverified.posture === "zone_unverified" && unverified.recommendedAction === "monitor" && unverified.reasonCode === "ZONE_UNVERIFIED");

// Fail-safe (regression): an OMITTED presence field is unknown (null), NOT a
// positive "present" — so a departed device with no presence flag and a stale
// fix still surfaces (via the fix-age fail-safe), never reads as clean in_zone.
const presenceOmitted = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, badgeAssociated: true }));
check("an omitted presence field does not read as a clean in_zone (null fix → stale/locate)", presenceOmitted.posture === "stale_fix" && presenceOmitted.recommendedAction === "locate");
check("only an explicit present:false escalates to left_area", evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 5, badgeAssociated: true, present: false })).posture === "left_area");

// A fresh fix just under the threshold stays in-zone.
const freshEnough = evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 899, dwellSeconds: 60, badgeAssociated: true, present: true }));
check("a fix under the 900s threshold stays in_zone", freshEnough.posture === "in_zone" && freshEnough.recommendedAction === "none");

// Determinism.
const dl = normalized.find((l) => l.deviceId === "d-abandoned")!;
check("evaluator is deterministic", JSON.stringify(evaluateCustodyPosture(dl)) === JSON.stringify(evaluateCustodyPosture(dl)));

// ── connector guarantees ──────────────────────────────────────────────────────

// read-only enforcement
let readOnly = false;
try { guardReadOnly("PATCH"); } catch (err) { readOnly = err instanceof RtlsConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new RtlsCustodyConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: RtlsConnectorError | null = null;
try { await bad.listLocations(); } catch (err) { authErr = err instanceof RtlsConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live but NO token stays fixture", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture");
check("prod + live + token resolves live", resolveRtlsCustodyConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", RTLS_ACCESS_TOKEN: "t" }).mode === "live");


// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "rtls-custody",
  resolve: (env) => resolveRtlsCustodyConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    RTLS_ACCESS_TOKEN: "t",
  },
});

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
