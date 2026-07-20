// Network / NAC posture proof — fully OFFLINE and deterministic.
//
// Drives the read-only NAC connector against a deterministic mock (normalization,
// pagination, read-only enforcement, auth failure, gating), runs the pure network
// evaluator over an auth-state matrix, and confirms the verdict fuses into the
// unified posture composer via the new `network` adapter. No network, no real
// controller, no wall clock (time injected).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  NetworkConnectorError,
  NetworkNacConnector,
  createMockNetworkTransport,
  evaluateNetwork,
  guardReadOnly,
  resolveNetworkNacConnector,
  type NetworkPostureRaw,
  type NormalizedNetworkSignal,
} from "@workspace/integrations/network-nac";
import { composeDeviceRisk, fromNetwork } from "@workspace/posture-composition";

interface Expected { authState: string; posture: string; reasonCode: string; recommendedAction: string; }
interface FixtureRow extends NetworkPostureRaw { expected: Expected; }
interface Fixture { accessToken: string; observedAt: string; sessions: FixtureRow[]; }

const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/network-nac/sessions.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
const OBSERVED_AT = fixture.observedAt;
const NOW_MS = Date.parse(OBSERVED_AT);
const BASE_URL = "https://api.nac.example/v1";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Network / NAC posture proof");
console.log(`sessions=${fixture.sessions.length} observedAt=${OBSERVED_AT}`);

const rawSessions: NetworkPostureRaw[] = fixture.sessions.map(({ expected, ...raw }) => raw);
const transport = createMockNetworkTransport({ sessions: rawSessions, expectedToken: fixture.accessToken, pageSize: 2, baseUrl: BASE_URL });
const connector = new NetworkNacConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 }, transport);

const listed = await connector.listSessions();
check(`pagination reassembles all ${fixture.sessions.length} sessions`, listed.length === fixture.sessions.length);

const signals = await connector.fetchNetworkPosture(OBSERVED_AT);
const byDevice = new Map<string, NormalizedNetworkSignal>(signals.map((s) => [s.deviceId, s]));

for (const s of fixture.sessions) {
  const sig = byDevice.get(s.deviceId);
  check(`normalize ${s.deviceId} → authState ${s.expected.authState}`, sig?.authState === s.expected.authState);
}
check(
  "switch port / AP is carried as a coarse access-location",
  byDevice.get("dev-trusted")?.accessLocation === "sw3/gi1/0/12" && byDevice.get("dev-unauth")?.accessLocation === "ap-lobby-2",
);
check("provenance is deterministic", signals.every((s) => s.sourceSystem === "network-nac" && s.observedAt === OBSERVED_AT));

for (const s of fixture.sessions) {
  const v = evaluateNetwork(byDevice.get(s.deviceId)!, NOW_MS);
  const ok = v.posture === s.expected.posture && v.reasonCode === s.expected.reasonCode && v.recommendedAction === s.expected.recommendedAction;
  check(`evaluate ${s.deviceId} → ${s.expected.posture}/${s.expected.recommendedAction}`, ok);
}

// A once-trusted device with a stale auth is no longer proof of current state.
check("a fresh authenticated+compliant device is trusted", evaluateNetwork(byDevice.get("dev-trusted")!, NOW_MS).posture === "on_trusted_segment");
check("far-future makes the trusted device stale → step_up", evaluateNetwork(byDevice.get("dev-trusted")!, NOW_MS + 60 * 60 * 1000).reasonCode === "STALE_NETWORK_STATE");

// ── fuses into the unified composer via the new `network` adapter ─────────────
const unauthVerdict = evaluateNetwork(byDevice.get("dev-unauth")!, NOW_MS);
const composed = composeDeviceRisk([fromNetwork(unauthVerdict)]);
check("an unauthenticated NAC verdict composes to restrict/blocked", composed.strongestAction === "restrict" && composed.riskTier === "blocked");
check("the network driver is carried with its reason", composed.drivers[0]?.kind === "network" && composed.drivers[0]?.reason === "UNAUTHENTICATED_AT_CONNECTION");

// ── read-only enforcement ──────────────────────────────────────────────────────
let readOnly = false;
try { guardReadOnly("POST"); } catch (err) { readOnly = err instanceof NetworkConnectorError && err.code === "read_only_violation"; }
check("a non-GET request is refused by the read-only guard", readOnly);

// ── auth failure ──────────────────────────────────────────────────────────────
const bad = new NetworkNacConnector({ accessToken: "nope", baseUrl: BASE_URL }, transport);
const badHealth = await bad.healthCheck();
check("health check reports unhealthy on a bad token", badHealth.healthy === false && badHealth.status === 401);
let authErr: NetworkConnectorError | null = null;
try { await bad.listSessions(); } catch (err) { authErr = err instanceof NetworkConnectorError ? err : null; }
check("a bad token surfaces a typed auth_failed error", authErr?.code === "auth_failed");

// ── gating ────────────────────────────────────────────────────────────────────
check("dev tier resolves to fixture mode", resolveNetworkNacConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod WITHOUT live flag stays fixture", resolveNetworkNacConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check("prod + live + token resolves live", resolveNetworkNacConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true", NAC_ACCESS_TOKEN: "t" }).mode === "live");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
