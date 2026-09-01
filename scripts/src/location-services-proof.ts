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
  normalizeFix,
  resolveLocationServicesConnector,
  type LocationFixRaw,
  type LocationVerdict,
  type NormalizedLocationSignal,
  type LocationTransport,
} from "@workspace/integrations/location-services";
import { checkLiveGateIsolated, checkCollectionRefusals } from "./lib/live-gate.js";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

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


// ── Wedges #12/#13, caught by the shift-1 sweep — each an executed
// counterexample before the fix, each pinned here after it ──────────────────────

const NOW_ENUM = Date.parse("2026-07-20T12:00:00Z");
const FRESH_AT = "2026-07-20T11:55:00Z";
const STALE_AT = "2026-07-20T10:00:00Z";
const FUTURE_AT = "2026-07-20T14:00:00Z";
const mkSignal = (geofenceState: string, capturedAt: string | null): NormalizedLocationSignal =>
  normalizeFix({ deviceId: "d.enum", geofenceId: "g1", geofenceState, capturedAt: capturedAt ?? undefined }, "2026-07-20T11:59:00Z");

// #12: an inside-geofence fix with NO capture time (or an unparseable one) used
// to skip the stale guard — only provably-stale fixes were caught — and mint the
// on_premises/none grant. A membership of unverifiable currency is not "inside".
for (const [label, at] of [["a null capturedAt", null], ["an unparseable capturedAt", "not-a-date"]] as const) {
  const w = evaluateLocation(mkSignal("inside", at), NOW_ENUM);
  check(`inside + ${label} → monitor/UNVERIFIED_LOCATION_FRESHNESS, never on_premises (wedge #12)`,
    w.recommendedAction === "monitor" && w.reasonCode === "UNVERIFIED_LOCATION_FRESHNESS" && w.locatable === false);
}

// #13: a capture time claimed from the FUTURE (beyond clock-skew tolerance) is a
// contradiction; it used to read as the freshest possible fix and grant.
const future = evaluateLocation(mkSignal("inside", FUTURE_AT), NOW_ENUM);
check("inside + a future-dated capturedAt → monitor/UNVERIFIED_LOCATION_FRESHNESS, never on_premises (wedge #13)",
  future.recommendedAction === "monitor" && future.reasonCode === "UNVERIFIED_LOCATION_FRESHNESS");

// ── GRANT SAFETY, QUANTIFIED — the whole input space, not chosen fixtures ─────
//
// Owner-sequenced shift 1: a grant must be UNREACHABLE by any unknown, missing,
// stale, or contradictory input. Every combination of every axis is executed
// through the REAL normalizer + evaluator and the granting set is pinned by
// equality.
{
  const domains = {
    // "loitering" is an out-of-vocabulary vendor value; the normalizer must fold
    // it to unknown, so it doubles as the unknown member of the axis.
    geofenceState: ["inside", "outside", "loitering"],
    capturedAt: [FRESH_AT, STALE_AT, FUTURE_AT, "not-a-date", null],
  } as const;

  const swept = enumerateGrantSafety<NormalizedLocationSignal, LocationVerdict>({
    domains,
    build: (c) => mkSignal(c.geofenceState as string, c.capturedAt as string | null),
    evaluate: (s) => evaluateLocation(s, NOW_ENUM),
    actionOf: (v) => v.recommendedAction,
    // The ONLY granting state: a POSITIVELY-inside membership on a fix whose
    // capture time is reported, parseable, not from the future, and fresh.
    positivelyClean: (c) => c.geofenceState === "inside" && c.capturedAt === FRESH_AT,
    confirmedWhenNone: (v) =>
      v.reasonCode === "INSIDE_AUTHORIZED_GEOFENCE" && v.posture === "on_premises" && v.locatable === true,
  });
  check(`ENUMERATION: all ${swept.combos} combinations swept (= product of domains)`,
    swept.combos === productOf(domains) && swept.combos === 3 * 5);
  check("ENUMERATION: a grant is reachable ONLY by the fully-verified state — zero mismatches",
    swept.mismatches === 0);
  check("ENUMERATION: exactly ONE granting state (non-vacuous)", swept.noneCount === 1);

  // NEGATIVE CONTROL — the enumeration can fail: declare capture-time currency
  // irrelevant to being inside and the harness must object, because the
  // evaluator (correctly) refuses stale, unverifiable, and future-dated fixes.
  const wrongPredicate = enumerateGrantSafety<NormalizedLocationSignal, LocationVerdict>({
    domains,
    build: (c) => mkSignal(c.geofenceState as string, c.capturedAt as string | null),
    evaluate: (s) => evaluateLocation(s, NOW_ENUM),
    actionOf: (v) => v.recommendedAction,
    positivelyClean: (c) => c.geofenceState === "inside",
  });
  check("NEGATIVE CONTROL: declaring capture-time currency irrelevant is CAUGHT (mismatches > 0)",
    wrongPredicate.mismatches > 0 && typeof wrongPredicate.firstMismatch === "string");
}

// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// Replaces / supplements a cumulative ladder in which each step added one variable, so
// the conditions below the one under test were also failing and only the last was
// genuinely exercised. See lib/live-gate.ts. The tier check is the control behind the
// written claim that dev and alpha never make live vendor calls.
checkLiveGateIsolated({
  check,
  family: "location-services",
  resolve: (env) => resolveLocationServicesConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    LOCATION_ACCESS_TOKEN: "t",
  },
});


// COLLECTION SHAPE and PAGE-CAP REFUSAL — both survived mutation until 2026-08-25.
// Shared helper, one statement of a rule nine families implement identically.
await checkCollectionRefusals({
  check,
  family: "location-services",
  listWith: (t, pageLimit) => () =>
    new LocationServicesConnector({ accessToken: "t", baseUrl: BASE_URL, pageLimit }, t as unknown as LocationTransport).listFixes(),
  codeOf: (e) => (e instanceof LocationConnectorError ? e.code : undefined),
});


// The BOUND (independent sweep + ECC, 2026-09-01): a garbled staleAfterMs must grade an
// ancient fix STALE_LOCATION_FIX/locate — the default bound's verdict — never the weaker
// UNVERIFIED_LOCATION_FRESHNESS/monitor (a posed 0 must not outscore no bound at all).
{
  const ancient = mkSignal("inside", "2019-01-01T00:00:00Z");
  const onDefault = evaluateLocation(ancient, NOW_MS);
  check("bound control: a 2019 fix is STALE_LOCATION_FIX/locate on the default bound", onDefault.reasonCode === "STALE_LOCATION_FIX" && onDefault.recommendedAction === "locate");
  for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, 0]) {
    const v = evaluateLocation(ancient, NOW_MS, { staleAfterMs: bad });
    check(`a garbled staleAfterMs (${String(bad)}) grades the same fix STALE_LOCATION_FIX/locate — never the weaker unverified/monitor`, v.reasonCode === "STALE_LOCATION_FIX" && v.recommendedAction === "locate");
  }
}

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
