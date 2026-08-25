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
import { checkLiveGateIsolated } from "./lib/live-gate.js";

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

// ── The live-call gate, each condition ISOLATED ──────────────────────────────
//
// This replaced a four-step cumulative ladder (dev → prod → prod+flag → prod+flag+token).
// Each rung added one variable, so at every step the conditions BELOW the one under test
// were also failing and only the last was genuinely exercised. See lib/live-gate.ts —
// the same defect was found and fixed across twenty-one other families; graph was missed
// there because it is not in the grant-safety population, which is exactly how a
// population gap hides one more instance.
//
// It matters most here. `graph` is the read-only Microsoft connector a design partner
// would point at their OWN tenant, so the tier check is what stops their credentials
// being used from a dev or alpha tier.
checkLiveGateIsolated({
  check,
  family: "graph",
  resolve: (env) => resolveGraphPostureConnector(env),
  full: {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    GRAPH_ACCESS_TOKEN: "a-real-token",
  },
});

// ── An agent NAME may not stand in for a management STATE ─────────────────────
//
// `normalizeManagement` used to read `if (state === "" && agent !== "") return
// "managed"` — any non-empty string earned the affirmative. Graph's own vocabulary
// makes that unsound: `eas` is ActiveSync only and `msSense` is the Defender
// sensor, and BOTH mean the device is not MDM-managed. A typo qualified equally.
// Downstream, `posture-composition` grades "managed" as compliant/none and
// "unknown" as step_up, so one arbitrary string moved a device from challenge to
// allow — on one of only two families that address a real tenant.
//
// The four sibling normalizers in that file all fall through to "unknown" on
// silence. These cases pin the one that did not, in BOTH directions: a
// non-enrolling agent must not grant, and a genuine MDM agent must still be
// recognised, so the fix cannot be "always unknown".
{
  const AGENT_CASES: ReadonlyArray<readonly [string, string, string]> = [
    ["eas", "unknown", "ActiveSync only — explicitly NOT MDM-managed"],
    ["msSense", "unknown", "Defender sensor — explicitly NOT MDM-managed"],
    ["zzz-typo", "unknown", "an unrecognised string may not earn an affirmative"],
    ["", "unknown", "no state and no agent is the sibling behaviour"],
    ["mdm", "managed", "a genuine MDM agent IS still recognised"],
    ["intuneClient", "managed", "and so is its sibling enrolling agent"],
  ];

  const craftedDevices = AGENT_CASES.map(([agent], i) => ({
    id: `device-agent-${i}`,
    userId: "user-0001",
    userPrincipalName: "ward.nurse@example.test",
    deviceName: `agent-case-${i}`,
    complianceState: "compliant",
    // managementState DELIBERATELY ABSENT — that is the case under test.
    managementAgent: agent,
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-07-19T11:30:00Z",
    operatingSystem: "iPadOS",
    osVersion: "17.5",
  }));

  const agentConnector = new GraphPostureConnector(
    { accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 },
    createMockGraphTransport({
      users: fixture.users,
      devices: craftedDevices,
      expectedToken: fixture.accessToken,
      pageSize: 10,
      baseUrl: BASE_URL,
    }),
  );
  const agentSignals = await agentConnector.fetchPosture(OBSERVED_AT);

  check(
    "agent-name cases: one posture signal per crafted device",
    agentSignals.length === AGENT_CASES.length,
  );

  AGENT_CASES.forEach(([agent, expected, why], i) => {
    const got = (agentSignals[i] as { deviceManagementState?: string } | undefined)
      ?.deviceManagementState;
    check(
      `managementState absent + agent "${agent || "(none)"}" -> ${expected} (${why})`,
      got === expected,
    );
  });
}


const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
