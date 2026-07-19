// Read-only Microsoft Graph connector proof — fully OFFLINE and deterministic.
//
// Drives the real connector against a deterministic in-memory Graph (the mock
// transport that serves genuine Graph-shaped responses, including `@odata.nextLink`
// pagination and a 401 for a bad token). It proves:
//   • normalization — every vendor enum maps to the SignalGrid posture vocabulary,
//   • pagination — a small page size forces multi-page reads that recombine,
//   • identity/device join — devices link to their owner by userId OR by UPN,
//   • read-only enforcement — a non-GET request is refused at the guard,
//   • auth-failure handling — a bad token surfaces a typed auth_failed error,
//   • gating — live calls are OFF unless tier is beta/prod AND live-integrations
//     are explicitly enabled AND a token is present.
//
// No network, no live tenant — runs in the standard CI job.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GraphConnectorError,
  GraphPostureConnector,
  createMockGraphTransport,
  guardReadOnly,
  resolveGraphPostureConnector,
  type GraphManagedDeviceRaw,
  type GraphPostureSignal,
  type GraphRequest,
  type GraphUserRaw,
} from "@workspace/integrations/graph";

interface Fixture {
  accessToken: string;
  users: GraphUserRaw[];
  devices: GraphManagedDeviceRaw[];
  expectedNormalized: Record<string, Partial<GraphPostureSignal>>;
}

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/microsoft-graph/graph-raw-responses.json",
);
const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;

const OBSERVED_AT = "2026-07-19T12:00:00.000Z";
const BASE_URL = "https://graph.microsoft.com/v1.0";

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

console.log("Read-only Microsoft Graph connector proof");
console.log(`fixture=${fixture.users.length} users, ${fixture.devices.length} devices`);

// ── normalization + pagination (page size 2 forces multi-page reads) ───────────
const transport = createMockGraphTransport({
  users: fixture.users,
  devices: fixture.devices,
  expectedToken: fixture.accessToken,
  pageSize: 2,
  baseUrl: BASE_URL,
});
const connector = new GraphPostureConnector(
  { accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 },
  transport,
);

const users = await connector.listUsers();
check(`pagination reassembles all ${fixture.users.length} users`, users.length === fixture.users.length);
const devices = await connector.listManagedDevices();
check(`pagination reassembles all ${fixture.devices.length} devices`, devices.length === fixture.devices.length);

const signals = await connector.fetchPosture(OBSERVED_AT);
check("one posture signal emitted per device", signals.length === fixture.devices.length);

const byDevice = new Map(signals.map((s) => [s.deviceId, s]));
for (const [deviceId, expected] of Object.entries(fixture.expectedNormalized)) {
  const actual = byDevice.get(deviceId);
  const fieldsOk =
    !!actual &&
    (Object.keys(expected) as Array<keyof GraphPostureSignal>).every(
      (k) => actual[k] === expected[k],
    );
  check(`normalized ${deviceId} matches expected posture`, fieldsOk);
}
check(
  "provenance is deterministic (sourceSystem + observedAt + correlationId)",
  signals.every(
    (s) => s.sourceSystem === "microsoft-graph" && s.observedAt === OBSERVED_AT && s.correlationId === `${s.subjectId}:${s.deviceId}`,
  ),
);
check(
  "device joined to its owner by UPN when userId is absent (device-1005 → user-0001)",
  byDevice.get("device-1005")?.subjectId === "user-0001",
);

// ── read-only enforcement ──────────────────────────────────────────────────────
let readOnlyEnforced = false;
try {
  guardReadOnly("POST");
} catch (err) {
  readOnlyEnforced = err instanceof GraphConnectorError && err.code === "read_only_violation";
}
check("a non-GET request is refused by the read-only guard", readOnlyEnforced);

// A transport that records every method it sees proves the connector only GETs.
const seenMethods = new Set<string>();
const recordingTransport = (req: GraphRequest) => {
  seenMethods.add(req.method);
  return transport(req);
};
const recordingConnector = new GraphPostureConnector(
  { accessToken: fixture.accessToken, baseUrl: BASE_URL },
  recordingTransport,
);
await recordingConnector.fetchPosture(OBSERVED_AT);
check("connector issues GET requests only", seenMethods.size === 1 && seenMethods.has("GET"));

// ── auth-failure handling ──────────────────────────────────────────────────────
const badConnector = new GraphPostureConnector(
  { accessToken: "wrong-token", baseUrl: BASE_URL },
  transport,
);
const health = await badConnector.healthCheck();
check("health check reports unhealthy on a bad token", health.healthy === false && health.status === 401);
let authError: GraphConnectorError | null = null;
try {
  await badConnector.listUsers();
} catch (err) {
  authError = err instanceof GraphConnectorError ? err : null;
}
check("a bad token surfaces a typed auth_failed error", authError?.code === "auth_failed" && authError.status === 401);

const goodHealth = await connector.healthCheck();
check("health check reports healthy with a valid token", goodHealth.healthy === true && goodHealth.status === 200);

// ── gating: live vendor calls off unless explicitly enabled ────────────────────
check("dev tier resolves to fixture mode (no live calls)", resolveGraphPostureConnector({ SIGNALGRID_TIER: "dev" }).mode === "fixture");
check("prod tier WITHOUT live flag stays fixture mode", resolveGraphPostureConnector({ SIGNALGRID_TIER: "prod" }).mode === "fixture");
check(
  "prod tier WITH live flag but no token stays fixture mode",
  resolveGraphPostureConnector({ SIGNALGRID_TIER: "prod", SIGNALGRID_LIVE_INTEGRATIONS: "true" }).mode === "fixture",
);
check(
  "prod tier + live flag + token resolves to a live connector",
  resolveGraphPostureConnector({
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    GRAPH_ACCESS_TOKEN: "a-real-token",
  }).mode === "live",
);

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
