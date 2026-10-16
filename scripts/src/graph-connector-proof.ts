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
  toEstateSubjects,
  type GraphManagedDeviceRaw,
  type GraphPostureSignal,
  type GraphRequest,
  type GraphRiskyUserRaw,
  type GraphUserRaw,
} from "@workspace/integrations/graph";
import { checkLiveGateIsolated } from "./lib/live-gate.js";

interface Fixture {
  accessToken: string;
  users: GraphUserRaw[];
  devices: GraphManagedDeviceRaw[];
  riskyUsers: GraphRiskyUserRaw[];
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
  riskyUsers: fixture.riskyUsers,
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

// ── user risk comes from Identity Protection, not from /users ─────────────────
// user-0002 is ABSENT from the risky-user list: Graph's contract is "not flagged",
// so it grades `none` — but ONLY because the risk read succeeded (asserted below by
// taking the scope away). user-0001 is listed remediated with riskLevel none.
check(
  "risk: a user absent from /identityProtection/riskyUsers grades none when the risk read succeeded",
  byDevice.get("device-1002")?.userRisk === "none" && fixture.riskyUsers.every((r) => r.id !== "user-0002"),
);
check("risk: a user Identity Protection flags high grades high", byDevice.get("device-1003")?.userRisk === "high");
const noScopeConnector = new GraphPostureConnector(
  { accessToken: fixture.accessToken, baseUrl: BASE_URL },
  createMockGraphTransport({ users: fixture.users, devices: fixture.devices, expectedToken: fixture.accessToken, baseUrl: BASE_URL }),
);
const noScopeSignals = await noScopeConnector.fetchPosture(OBSERVED_AT);
check(
  "risk: when the tenant has not granted IdentityRiskyUser.Read.All (403), EVERY subject grades unknown — never none",
  noScopeSignals.length === fixture.devices.length && noScopeSignals.every((s) => s.userRisk === "unknown"),
);
check(
  "risk: …and the two inventory reads still succeed independently of the failed risk read",
  noScopeSignals.every((s) => s.deviceComplianceState !== undefined && s.identityStatus !== undefined),
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
      riskyUsers: fixture.riskyUsers,
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


// ── Posture-connector guards, each ISOLATED (wave 7 of the brace-less sweep) ───
//
// `graph/posture-connector.ts` is the connector pointed at a design partner's real tenant, and
// the mutation sweep had never reached it. Each case below fails when its ONE guard alone is
// turned into `if (false)`: a collection with no `value` array, a read that stops with pages
// remaining, and a device whose management state is retire-pending.
{
  const jsonResponse = (body: unknown) => async (): Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }> => ({
    status: 200,
    ok: true,
    json: async () => body,
  });
  const codeOf = async (run: () => Promise<unknown>): Promise<string | null> => {
    try {
      await run();
      return null;
    } catch (err) {
      return err instanceof GraphConnectorError ? err.code : `other:${String(err)}`;
    }
  };

  // 1. A 200 whose body carries no `value` array is a bad_response, not an empty inventory.
  const noValue = new GraphPostureConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL }, jsonResponse({ unexpected: true }));
  check(
    "a 200 collection with no `value` array is refused as bad_response, never read as empty",
    (await codeOf(() => noValue.listUsers())) === "bad_response",
  );

  // 2. A cursor still in hand at the page cap is incomplete_read; an exactly-complete read is not.
  const pagedTransport = (pages: number) => {
    let n = 0;
    return async (): Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }> => {
      n += 1;
      const next = n < pages ? { "@odata.nextLink": `${BASE_URL}/users?page=${n + 1}` } : {};
      return { status: 200, ok: true, json: async () => ({ value: [{ id: `u-${n}` }], ...next }) };
    };
  };
  const capped = new GraphPostureConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 2 }, pagedTransport(5));
  check(
    "a read that hits the page cap with a next cursor remaining is refused as incomplete_read",
    (await codeOf(() => capped.listUsers())) === "incomplete_read",
  );
  const exact = new GraphPostureConnector({ accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 2 }, pagedTransport(2));
  const exactRows = await exact.listUsers().catch(() => null);
  check(
    "a read that ends exactly on the page cap with no cursor remaining is complete (the refusal is not over-broad)",
    exactRows !== null && exactRows.length === 2,
  );

  // 3. retirePending is its own management state, in both spellings, regardless of the agent.
  const RETIRE_CASES: ReadonlyArray<readonly [string, string]> = [["retirePending", "camel"], ["retire_pending", "snake"]];
  const retireDevices = RETIRE_CASES.map(([state], i) => ({
    id: `device-retire-${i}`,
    userId: "user-0001",
    userPrincipalName: "ward.nurse@example.test",
    deviceName: `retire-case-${i}`,
    complianceState: "compliant",
    managementState: state,
    managementAgent: "",
    deviceRegistrationState: "registered",
    lastSyncDateTime: "2026-07-19T11:30:00Z",
    operatingSystem: "iPadOS",
    osVersion: "17.5",
  }));
  const retireConnector = new GraphPostureConnector(
    { accessToken: fixture.accessToken, baseUrl: BASE_URL, pageLimit: 50 },
    createMockGraphTransport({
      users: fixture.users,
      devices: retireDevices,
      riskyUsers: fixture.riskyUsers,
      expectedToken: fixture.accessToken,
      pageSize: 10,
      baseUrl: BASE_URL,
    }),
  );
  const retireSignals = await retireConnector.fetchPosture(OBSERVED_AT);
  RETIRE_CASES.forEach(([state, label], i) => {
    const got = (retireSignals[i] as { deviceManagementState?: string } | undefined)?.deviceManagementState;
    check(`managementState ${state} (${label}) with no agent -> retire_pending`, got === "retire_pending");
  });
}


// THE MOCK TRANSPORT'S REFUSALS AND THE ESTATE MAPPING (wave 9 joined `graph/mock-transport.ts` and
// `graph/estate.ts` to this target). Three guards survived `if (false)` with this proof green:
//   * the mock's non-GET refusal (405) — the connector only ever sends GET, so it was never driven;
//   * the mock's 403 for a tenant that has not granted IdentityRiskyUser.Read.All — the "403 -> every
//     subject grades unknown" check above is real, but without this guard `page(undefined, ...)`
//     throws inside the mock and the connector fails closed to the same unknown, so the check could
//     not tell the mock was serving a 403 at all;
//   * `toEstateSubjects`'s ownerless skip — an ownerless device must be SKIPPED AND COUNTED, never
//     given a shared synthetic identity (the mapping's own header). No check here fed it a null owner.
{
  const mock = createMockGraphTransport({ users: fixture.users, devices: fixture.devices, expectedToken: fixture.accessToken, baseUrl: BASE_URL });
  const auth = { authorization: `Bearer ${fixture.accessToken}` };
  const post = await mock({ method: "POST", url: `${BASE_URL}/users`, headers: auth } as never);
  check("mock transport: a non-GET request with a valid token is refused 405, not served", post.status === 405 && post.ok === false);
  const risky = await mock({ method: "GET", url: `${BASE_URL}/identityProtection/riskyUsers`, headers: auth });
  check("mock transport: riskyUsers absent from the tenant is a 403 Authorization_RequestDenied, not a thrown error or an empty 200",
    risky.status === 403 && JSON.stringify(await risky.json()) === JSON.stringify({ error: { code: "Authorization_RequestDenied" } }));
  const usersOk = await mock({ method: "GET", url: `${BASE_URL}/users`, headers: auth });
  check("mock transport: NON-VACUITY — a valid-token GET to /users IS served (200)", usersOk.status === 200 && usersOk.ok === true);

  const template = noScopeSignals[0]!;
  const owned = { ...template, subjectId: "user-owned", deviceId: "dev-owned" };
  const ownerless = { ...template, subjectId: null, deviceId: "dev-ownerless" };
  const mapped = toEstateSubjects([owned, ownerless, { ...ownerless, deviceId: "dev-ownerless-2" }]);
  check("estate: an ownerless device is SKIPPED and COUNTED, never given an invented subject",
    mapped.skippedOwnerless === 2 && mapped.subjects.length === 1 && mapped.subjects[0]!.identity.externalRef === "user-owned");
  check("estate: NON-VACUITY — a fully-owned read maps every device and skips none",
    (() => { const m = toEstateSubjects([owned]); return m.skippedOwnerless === 0 && m.subjects.length === 1; })());
  check("estate: no mapped subject carries the literal \"null\" or a shared synthetic identity",
    mapped.subjects.every((sub) => sub.identity.externalRef !== "null" && sub.identity.externalRef !== "unknown"));
}

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
