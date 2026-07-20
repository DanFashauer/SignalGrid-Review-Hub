// Location-services proof — fully OFFLINE and deterministic.
//
// Drives the read-only location connector against a deterministic mock
// (normalization, pagination, read-only enforcement, auth failure, gating) and
// runs the pure location evaluator over a geofence state matrix — asserting each
// device resolves to the right posture, action, locatability, and privacy flag.
// No network, no real coordinates, no wall clock (time injected).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LocationConnectorError,
  LocationServicesConnector,
  createMockLocationTransport,
  evaluateLocation,
  guardReadOnly,
  resolveLocationServicesConnector,
  type LocationFixRaw,
  type LocationVerdict,
  type NormalizedLocationSignal,
} from "@workspace/integrations/location-services";

interface Expected {
  geofenceState: string; hasPreciseCoordinates: boolean;
  posture: string; reasonCode: string; recommendedAction: string; locatable: boolean; usesPreciseLocation: boolean;
}
interface FixtureFix extends LocationFixRaw { expected: Expected; }
interface Fixture { accessToken: string; observedAt: string; fixes: FixtureFix[]; }

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/location-services/fixes.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const OBSERVED_AT = fixture.observedAt;
const NOW_MS = Date.parse(OBSERVED_AT);
const BASE_URL = "https://api.location.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Location-services proof");
console.log(`fixes=${fixture.fixes.length} observedAt=${OBSERVED_AT}`);

const rawFixes: LocationFixRaw[] = fixture.fixes.map(({ expected, ...raw }) => raw);
const transport = createMockLocationTransport({ fixes: rawFixes, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new LocationServicesConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const listed = await connector.listFixes();
check(`pagination reassembles all ${fixture.fixes.length} fixes`, listed.length === fixture.fixes.length);

const signals = await connector.fetchLocations(OBSERVED_AT);
const byDevice = new Map<string, NormalizedLocationSignal>(signals.map((s) => [s.deviceId, s]));

for (const f of fixture.fixes) {
  const sig = byDevice.get(f.deviceId);
  const normOk = !!sig && sig.geofenceState === f.expected.geofenceState && sig.hasPreciseCoordinates === f.expected.hasPreciseCoordinates;
  check(`normalize ${f.deviceId} → ${f.expected.geofenceState}${f.expected.hasPreciseCoordinates ? "/precise" : ""}`, normOk);
}
check(
  "provenance is deterministic (sourceSystem + observedAt)",
  signals.every((s) => s.sourceSystem === "location-services" && s.observedAt === OBSERVED_AT),
);

for (const f of fixture.fixes) {
  const sig = byDevice.get(f.deviceId)!;
  const v: LocationVerdict = evaluateLocation(sig, NOW_MS);
  const ok = v.posture === f.expected.posture && v.reasonCode === f.expected.reasonCode &&
    v.recommendedAction === f.expected.recommendedAction && v.locatable === f.expected.locatable &&
    v.usesPreciseLocation === f.expected.usesPreciseLocation;
  check(`evaluate ${f.deviceId} → ${f.expected.posture}/${f.expected.reasonCode}`, ok);
}

// Privacy: the verdict flags precise-coordinate use so a policy can require coarse-only.
check("precise-coordinate use is flagged for the off-site GPS device", byDevice.get("dev-offsite") ? evaluateLocation(byDevice.get("dev-offsite")!, NOW_MS).usesPreciseLocation === true : false);
check("coarse geofence-only device is not flagged as precise", evaluateLocation(byDevice.get("dev-onsite")!, NOW_MS).usesPreciseLocation === false);

// A once-on-premises fix, far in the future, is stale (time-driven).
check("a stale fix degrades to off_premises_stale", evaluateLocation(byDevice.get("dev-onsite")!, NOW_MS + 60 * 60 * 1000).reasonCode === "STALE_LOCATION_FIX");

// read-only enforcement
let readOnly = false;
try { guardReadOnly("DELETE"); } catch (err) { readOnly = err instanceof LocationConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// auth failure
const bad = new LocationServicesConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: LocationConnectorError | null = null;
try { await bad.listFixes(); } catch (err) { authErr = err instanceof LocationConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// gating
check("dev tier resolves to fixture mode", resolveLocationServicesConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveLocationServicesConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live + token resolves live", resolveLocationServicesConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", LOCATION_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
