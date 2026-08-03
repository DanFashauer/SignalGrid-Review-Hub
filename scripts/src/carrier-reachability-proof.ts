// Carrier / post-exit reachability proof — fully OFFLINE and deterministic.
//
// This exercises SignalGrid's answer to the "biggest technical constraint" the
// founder identified: once a shared device leaves managed Wi-Fi, is it still
// reachable, and how? It drives the REAL read-only carrier connector against a
// deterministic mock (normalization, pagination, read-only enforcement, auth
// failure, gating), then runs the PURE reachability evaluator over a full state
// matrix and asserts each device resolves to the right posture, reason code, and
// self-managing playbook action. No network, no SIMs, no wall clock (time is
// injected) — so it runs in the standard CI job.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CarrierConnectorError,
  CarrierReachabilityConnector,
  createMockCarrierTransport,
  evaluateReachability,
  guardReadOnly,
  normalizeSession,
  resolveCarrierReachabilityConnector,
  type CarrierSessionRaw,
  type ReachabilitySignal,
  type ReachabilityVerdict,
} from "@workspace/integrations/carrier";

interface ExpectedRow {
  cellularReachability: string;
  smsReachable: boolean;
  cellularBackchannel: string;
  provisioning: string;
  posture: string;
  reasonCode: string;
  recommendedAction: string;
  locatable: boolean;
}
interface FixtureSession extends CarrierSessionRaw {
  expected: ExpectedRow;
}
interface Fixture {
  accessToken: string;
  observedAt: string;
  sessions: FixtureSession[];
}

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/carrier/sessions.json",
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const OBSERVED_AT = fixture.observedAt;
const NOW_MS = Date.parse(OBSERVED_AT);
const BASE_URL = "https://api.carrier.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL — ${name}`);
  }
};

console.log("Carrier / post-exit reachability proof");
console.log(`sessions=${fixture.sessions.length} observedAt=${OBSERVED_AT}`);

// Strip the `expected` field before feeding the mock (it only serves raw fields).
const rawSessions: CarrierSessionRaw[] = fixture.sessions.map(({ expected, ...raw }) => raw);

// ── normalization + pagination (page size 2 forces multi-page reads) ───────────
const transport = createMockCarrierTransport({
  sessions: rawSessions,
  expectedToken: fixture.accessToken,
  pageSize: 2,
  baseUrl: BASE_URL,
});
const connector = new CarrierReachabilityConnector(
  { accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 },
  transport,
);

const listed = await connector.listSessions();
check(`pagination reassembles all ${fixture.sessions.length} sessions`, listed.length === fixture.sessions.length);

// THE CEILING OF A CARRIER-ONLY READ, asserted before anything else uses it.
// Whether a device HAS a radio is a device-inventory fact; this connector talks to
// one plane and must not guess at another's. Intake ledger row 55: the previous
// version derived it from three absences (no ICCID, no SMS capability, no data
// session) and asserted "no cellular backchannel at all" — so a device the carrier
// simply could not see was reported as having no radio, with `locatable: false`
// attached. A private-5G attachment produces exactly that wire shape.
const unposed = await connector.fetchReachability(OBSERVED_AT);
check(
  `a carrier-only read can NEVER assert the backchannel axis — all ${unposed.length} signals read \`unknown\``,
  unposed.length > 0 && unposed.every((s) => s.cellularBackchannel === "unknown"),
);
check(
  "...and that includes the device whose every relevant field is silent — silence is not a finding",
  unposed.find((s) => s.deviceId === "dev-private-5g")?.cellularBackchannel === "unknown",
);
// A posed map cannot be poisoned through the prototype chain.
check(
  "a prototype key cannot pose the axis",
  (await connector.fetchReachability(OBSERVED_AT, JSON.parse('{"__proto__":{"dev-private-5g":"absent"}}')))
    .every((s) => s.cellularBackchannel === "unknown"),
);

// Now pose each fixture's own answer and check the normalization end to end.
const posed: Record<string, string> = {};
for (const s of fixture.sessions) posed[s.deviceId] = s.expected.cellularBackchannel;
const signals = await connector.fetchReachability(
  OBSERVED_AT,
  posed as Readonly<Record<string, "present" | "absent" | "unknown">>,
);
const byDevice = new Map<string, ReachabilitySignal>(signals.map((s) => [s.deviceId, s]));

for (const s of fixture.sessions) {
  const sig = byDevice.get(s.deviceId);
  const normOk =
    !!sig &&
    sig.cellularReachability === s.expected.cellularReachability &&
    sig.smsReachable === s.expected.smsReachable &&
    sig.cellularBackchannel === s.expected.cellularBackchannel &&
    sig.provisioning === s.expected.provisioning;
  check(`normalize ${s.deviceId} → ${s.expected.cellularReachability}/${s.expected.provisioning}/${s.expected.cellularBackchannel}`, normOk);
}
check(
  "provenance is deterministic (sourceSystem + observedAt + correlationId)",
  signals.every((s) => s.sourceSystem === "carrier" && s.observedAt === OBSERVED_AT && s.correlationId.startsWith(`${s.deviceId}:`)),
);

// ── pure evaluator: the state matrix → posture + playbook action ───────────────
for (const s of fixture.sessions) {
  const sig = byDevice.get(s.deviceId)!;
  const v: ReachabilityVerdict = evaluateReachability(sig, NOW_MS);
  const ok =
    v.posture === s.expected.posture &&
    v.reasonCode === s.expected.reasonCode &&
    v.recommendedAction === s.expected.recommendedAction &&
    v.locatable === s.expected.locatable;
  check(`evaluate ${s.deviceId} → ${s.expected.posture}/${s.expected.reasonCode}/${s.expected.recommendedAction}`, ok);
}

// Determinism: same signal + same nowMs ⇒ identical verdict.
const detA = evaluateReachability(byDevice.get("dev-online")!, NOW_MS);
const detB = evaluateReachability(byDevice.get("dev-online")!, NOW_MS);
check("evaluator is deterministic (identical verdict for identical input)", JSON.stringify(detA) === JSON.stringify(detB));

// Freshness is time-driven: a once-reachable device far in the future is stale.
const future = evaluateReachability(byDevice.get("dev-online")!, NOW_MS + 3 * 60 * 60 * 1000);
check("a stale sighting degrades a reachable device to STALE_LAST_SEEN", future.reasonCode === "STALE_LAST_SEEN" && future.posture === "degraded");

// ── read-only enforcement ──────────────────────────────────────────────────────
let readOnly = false;
try {
  guardReadOnly("POST");
} catch (err) {
  readOnly = err instanceof CarrierConnectorError && err.code === "read_only_violation";
}
check("a non-GET request is refused by the read-only guard", readOnly);

// ── auth-failure handling ──────────────────────────────────────────────────────
const badConnector = new CarrierReachabilityConnector({ accessToken: "wrong", baseUrl: BASE_URL }, transport);
const badHealth = await badConnector.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: CarrierConnectorError | null = null;
try {
  await badConnector.listSessions();
} catch (err) {
  authErr = err instanceof CarrierConnectorError ? err : null;
}
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed" && authErr.status === 401);
const goodHealth = await connector.healthCheck();
check("health check reports healthy with a valid token", goodHealth.healthy === true && goodHealth.status === 200);

// ── gating: live vendor calls off unless explicitly enabled ────────────────────
check("dev tier resolves to fixture mode", resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod tier WITHOUT live flag stays fixture mode", resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check(
  "prod tier WITH live flag but no token stays fixture mode",
  resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture",
);
check(
  "prod tier + live flag + token resolves to a live connector",
  resolveCarrierReachabilityConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", CARRIER_ACCESS_TOKEN: "a-real-token" }).mode === "live",
);

// Sanity: normalizeSession is a pure function usable without the connector.
check("normalizeSession is pure and standalone", normalizeSession(rawSessions[0], OBSERVED_AT).deviceId === rawSessions[0].deviceId);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
