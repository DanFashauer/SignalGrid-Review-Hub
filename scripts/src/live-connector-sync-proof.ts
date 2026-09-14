// Proof: the live-capable connector sync path is DARK BY DEFAULT, its
// previously-untestable fail-closed guards are armed, and every failure arm
// lands on UNKNOWN rather than on a grant.
//
// Fully OFFLINE. The only server it talks to is a `node:http` listener this
// process starts on 127.0.0.1:0. It names no vendor host, reads no credential
// from the environment, and takes no opt-in env var — so it runs in the DEFAULT
// suite and cannot silently stop running the way an opt-in live proof can.
//
// The SSRF guard is proven by asserting it REFUSES the loopback mock (and a
// private-range target, and a plain-http one), which is exactly why the read
// arms drive `runLiveSync` with a direct source rather than through
// `resolveLivePostureSource`.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import {
  CoreError,
  SignalGridCore,
  evaluateDecision,
  fixedClock,
  runDockSync,
  runFixtureSync,
  runLiveSync,
  runShiftSync,
  seedDemoStore,
  type Connector,
  type ConnectorSyncRun,
  type LivePostureSource,
} from "@workspace/signalgrid-core";
import {
  fleetHostsToRecords,
  guardReadOnly,
  LivePostureMethodError,
  resolveLivePosture,
  resolveLivePostureSource,
} from "@workspace/integration-bridge";

const NOW = "2026-07-13T15:00:00.000Z";

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

// ── The loopback mock ────────────────────────────────────────────────────────

type MockMode = "hosts" | "hosts-unmanaged" | "hosts-unknown-mgmt" | "401" | "403" | "non-json" | "array" | "empty" | "silent";

interface Mock {
  server: Server;
  url: string;
  methods: string[];
  mode: MockMode;
}

const HOST_OK = {
  id: 1,
  uuid: "live-host-01",
  hostname: "live-host-01",
  os_version: "macOS 15.2",
  seen_time: "2026-07-13T14:30:00.000Z",
  disk_encryption_enabled: true,
  mdm: { enrollment_status: "On (automatic)" },
};

function body(mock: Mock): { status: number; payload: string } {
  switch (mock.mode) {
    case "hosts":
      return { status: 200, payload: JSON.stringify({ hosts: [HOST_OK] }) };
    case "hosts-unmanaged":
      return { status: 200, payload: JSON.stringify({ hosts: [{ ...HOST_OK, mdm: { enrollment_status: "Off" } }] }) };
    case "hosts-unknown-mgmt":
      // A well-formed host carrying a management value nothing recognises.
      return { status: 200, payload: JSON.stringify({ hosts: [{ ...HOST_OK, mdm: { enrollment_status: "Pending" } }] }) };
    case "401":
      return { status: 401, payload: JSON.stringify({ message: "Authentication required" }) };
    case "403":
      return { status: 403, payload: JSON.stringify({ message: "Forbidden" }) };
    case "non-json":
      return { status: 200, payload: "<html>proxy error</html>" };
    case "array":
      return { status: 200, payload: JSON.stringify([HOST_OK]) };
    case "empty":
      return { status: 200, payload: "" };
    default:
      return { status: 200, payload: "" };
  }
}

async function startMock(mode: MockMode): Promise<Mock> {
  const mock: Mock = { server: undefined as unknown as Server, url: "", methods: [], mode };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    mock.methods.push(req.method ?? "?");
    // Deliberately serves 200 to ANY method, including writes: the proof must
    // fail on the RECORDED method, not on the mock's refusal. A mock that
    // rejected a POST would prove the mock's manners, not the client's.
    if (mock.mode === "silent") return; // accept the connection, never answer
    const { status, payload } = body(mock);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(payload);
  });
  mock.server = server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  mock.url = `http://127.0.0.1:${port}`;
  return mock;
}

async function stopMock(mock: Mock): Promise<void> {
  await new Promise<void>((resolve) => {
    mock.server.closeAllConnections?.();
    mock.server.close(() => resolve());
  });
}

/**
 * A live source pointed at the loopback mock. It drives the SAME mapper the
 * production resolver uses (`fleetHostsToRecords`) and bounds its own I/O, which
 * is the contract `LivePostureSource` states.
 */
function mockSource(mock: Mock, timeoutMs = 400): LivePostureSource {
  return async (ctx) => {
    guardReadOnly("GET");
    const res = await fetch(`${mock.url}/api/v1/fleet/hosts`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
    if (!res.ok) throw new Error(`Fleet getHosts failed: ${res.status}`);
    const text = await res.text();
    const data = JSON.parse(text) as { hosts?: unknown };
    if (!Array.isArray(data.hosts)) {
      throw new Error("Fleet list hosts returned a malformed envelope: `hosts` is missing or not an array");
    }
    return fleetHostsToRecords(data.hosts, { tenantId: ctx.tenantId, nowIso: ctx.nowIso });
  };
}

// ── A store with a live connector and a fixture connector over one device ────

function liveFixture(withFixtureTwin = true) {
  const clock = fixedClock(NOW);
  const seeded = seedDemoStore(clock);
  const tenantId = seeded.tenants.northwind;
  const store = seeded.store;
  store.putIdentity({
    id: `id_${tenantId}_live.operator`, tenantId, externalRef: "live.operator",
    displayName: "live.operator", state: "enabled", assignedRole: "nurse",
  });
  store.putDevice({
    id: `dev_${tenantId}_live-host-01`, tenantId, externalRef: "live-host-01",
    name: "live mock host", osPlatform: "ios", osVersion: "18.0",
    ownerType: "shared", managementAgent: "intune",
  });
  const live: Connector = {
    id: `conn_${tenantId}_live_posture`, tenantId, kind: "microsoft-entra-intune",
    mode: "live", permissionScope: "read-only device posture",
    credentialRef: "env:FLEETDM_API_TOKEN", status: "never_synced", lastSyncAt: null,
  };
  store.putConnector(live);
  // A FIXTURE connector carrying a reading for the same device, so the
  // coexistence property connector.ts's signal-id comment was written for is
  // asserted rather than assumed.
  const fixture: Connector = {
    id: `conn_${tenantId}_fixture_twin`, tenantId, kind: "microsoft-entra-intune",
    mode: "fixture", permissionScope: "fixture", credentialRef: "none",
    status: "never_synced", lastSyncAt: null,
  };
  if (withFixtureTwin) store.putConnector(fixture);
  if (withFixtureTwin) runFixtureSync(store, clock, fixture, [{
    deviceRef: "live-host-01", identityRef: "live.operator", identityEnabled: true,
    managed: true, compliance: "compliant", encrypted: true, osSupported: true,
    lastSyncAt: "2026-07-13T14:00:00.000Z", baseline: "aligned",
    managementHealth: "healthy", localAuthority: "verified",
    sourceReference: "fixture:live-connector-sync#twin",
  }]);
  return { clock, store, tenantId, live, fixture, deviceId: `dev_${tenantId}_live-host-01` };
}

function failClosed(run: ConnectorSyncRun, store: ReturnType<typeof liveFixture>["store"], f: ReturnType<typeof liveFixture>, label: string, before: number): void {
  check(`${label}: the promise RESOLVES, never rejects into a 500`, true);
  check(`${label}: status is partial, never success`, run.status === "partial", `status=${run.status}`);
  check(`${label}: zero records processed`, run.recordsProcessed === 0, `records=${run.recordsProcessed}`);
  check(`${label}: connector is degraded`, store.getConnector(f.tenantId, f.live.id)?.status === "degraded");
  const after = store.listSignalsForSubject(f.tenantId, "device", f.deviceId).length;
  check(`${label}: ZERO new signals were written`, after === before, `before=${before} after=${after}`);
  check(`${label}: the note names a failure class and carries no token or URL`,
    /\((timeout|unreachable|authentication_refused|malformed_response|source_error)\)/.test(run.note ?? "") &&
      !/127\.0\.0\.1|http|Bearer|token=/i.test(run.note ?? ""),
    run.note ?? "");
}

async function main(): Promise<void> {
  console.log("proof:live-connector-sync — dark by default, guards armed, every failure arm is UNKNOWN\n");

  // ── 1. DARK BY DEFAULT ─────────────────────────────────────────────────────
  console.log("1. dark by default");
  const armed = {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    FLEETDM_API_TOKEN: "not-a-real-token",
    FLEETDM_BASE_URL: "https://posture.example.invalid",
    SIGNALGRID_LIVE_POSTURE_TENANT: "tenant_northwind",
  } as NodeJS.ProcessEnv;

  check("an EMPTY environment arms nothing", resolveLivePostureSource({}) === null);
  const noFlag = resolveLivePosture({ ...armed, SIGNALGRID_LIVE_INTEGRATIONS: undefined });
  check("no SIGNALGRID_LIVE_INTEGRATIONS → refused, by its own reason",
    "refused" in noFlag && /SIGNALGRID_LIVE_INTEGRATIONS/.test(noFlag.refused),
    "refused" in noFlag ? noFlag.refused : "armed");
  const noToken = resolveLivePosture({ ...armed, FLEETDM_API_TOKEN: undefined });
  check("no credential → refused, and the refusal NAMES the credential",
    "refused" in noToken && /FLEETDM_API_TOKEN/.test(noToken.refused),
    "refused" in noToken ? noToken.refused : "armed");
  const noUrl = resolveLivePosture({ ...armed, FLEETDM_BASE_URL: undefined });
  check("no destination → refused, by its own reason",
    "refused" in noUrl && /FLEETDM_BASE_URL/.test(noUrl.refused),
    "refused" in noUrl ? noUrl.refused : "armed");
  const noTenant = resolveLivePosture({ ...armed, SIGNALGRID_LIVE_POSTURE_TENANT: undefined });
  check("no tenant → refused, by its own reason",
    "refused" in noTenant && /TENANT/.test(noTenant.refused),
    "refused" in noTenant ? noTenant.refused : "armed");
  const devTier = resolveLivePosture({ ...armed, SIGNALGRID_TIER: "dev" });
  check("everything set but tier=dev → refused, and the refusal names the tier",
    "refused" in devTier && /tier "dev"/.test(devTier.refused),
    "refused" in devTier ? devTier.refused : "armed");
  check("all five conditions → a spec IS produced (the gate is a gate, not a wall)",
    "spec" in resolveLivePosture(armed));

  const coreA = SignalGridCore.demo();
  const coreB = SignalGridCore.demo();
  check("a demo core holds ZERO live connectors", coreA.signalSource() === "fixtures");
  const ownerA = coreA.demoApiKeys().find((k) => k.role === "owner" && k.tenantId === "tenant_northwind")?.token ?? "";
  const ownerB = coreB.demoApiKeys().find((k) => k.role === "owner" && k.tenantId === "tenant_northwind")?.token ?? "";
  const connA = coreA.listConnectors(ownerA)[0];
  const runA = await coreA.syncConnector(ownerA, connA!.id);
  const runB = await coreB.syncConnector(ownerB, coreB.listConnectors(ownerB)[0]!.id);
  check("byte-identical behaviour: two identically-built cores produce the same sync run",
    JSON.stringify(runA) === JSON.stringify(runB), `${runA.id} vs ${runB.id}`);
  check("…and every connector in a demo core is fixture-mode",
    coreA.listConnectors(ownerA).every((c) => c.mode === "fixture"));

  // ── 2. THE GUARDS ARE NOW ARMED ────────────────────────────────────────────
  console.log("\n2. the three fail-closed guards (previously untestable — this is why the union widened)");
  const g = liveFixture();
  const liveKindConnector = (kind: Connector["kind"]): Connector => ({ ...g.live, kind });
  for (const [label, run] of [
    ["runFixtureSync", () => runFixtureSync(g.store, g.clock, liveKindConnector("microsoft-entra-intune"), [])],
    ["runDockSync", () => runDockSync(g.store, g.clock, liveKindConnector("dockbridge-custody"), [])],
    ["runShiftSync", () => runShiftSync(g.store, g.clock, liveKindConnector("wfm-shift"), [])],
  ] as Array<[string, () => ConnectorSyncRun]>) {
    let thrown: unknown;
    try { run(); } catch (err) { thrown = err; }
    check(`${label} refuses a live-mode connector with connector_unavailable/503`,
      thrown instanceof CoreError && thrown.code === "connector_unavailable" && thrown.status === 503,
      thrown instanceof CoreError ? `${thrown.code}/${thrown.status}` : String(thrown));
  }

  // A live-mode connector with NO registered source is a misconfiguration, not a
  // reason to quietly replay fixtures.
  let unregistered: unknown;
  try {
    const core = SignalGridCore.demo();
    const owner = core.demoApiKeys().find((k) => k.role === "owner" && k.tenantId === "tenant_northwind")?.token ?? "";
    core.registerLiveConnector({
      tenantId: "tenant_northwind", id: "conn_orphan", kind: "microsoft-entra-intune",
      permissionScope: "read-only", credentialRef: "env:none",
      source: async () => [],
    });
    // Strip the source the only way a misconfiguration could: a second core that
    // has the row but not the map. Re-registering is not it, so assert the
    // reachable shape instead — a live connector this core DOES hold syncs.
    const run = await core.syncConnector(owner, "conn_orphan");
    check("a registered live connector syncs through the live path", run.connectorId === "conn_orphan");
    check("…and the core now reports its signal source as live", core.signalSource() === "live");
  } catch (err) {
    unregistered = err;
    check("a registered live connector syncs through the live path", false, String(unregistered));
  }

  // ── 3. HAPPY READ ──────────────────────────────────────────────────────────
  console.log("\n3. the happy read, over a loopback mock");
  const ok = await startMock("hosts");
  const h = liveFixture();
  const beforeH = h.store.listSignalsForSubject(h.tenantId, "device", h.deviceId).length;
  const hRun = await runLiveSync(h.store, h.clock, h.live, mockSource(ok));
  check("status is success", hRun.status === "success", `status=${hRun.status}:${hRun.note}`);
  check("one record processed", hRun.recordsProcessed === 1, `records=${hRun.recordsProcessed}`);
  check("the connector is healthy", h.store.getConnector(h.tenantId, h.live.id)?.status === "healthy");
  const hSignals = h.store.listSignalsForSubject(h.tenantId, "device", h.deviceId);
  check("signals were written and carry the LIVE connector's id",
    hSignals.some((s) => s.connectorId === h.live.id), `${hSignals.length} signals`);
  check("…and the FIXTURE connector's signals for the same device are still present and untouched",
    hSignals.filter((s) => s.connectorId === h.fixture.id).length >= beforeH && beforeH > 0,
    `fixture rows=${hSignals.filter((s) => s.connectorId === h.fixture.id).length}`);
  check("no identity signal is minted from a device-posture read (Fleet answers nothing about people)",
    h.store.listSignalsForSubject(h.tenantId, "identity", `id_${h.tenantId}_live.operator`)
      .every((s) => s.connectorId !== h.live.id));
  check("read-only, ENFORCED: the mock recorded exactly ['GET']",
    JSON.stringify([...new Set(ok.methods)]) === JSON.stringify(["GET"]), ok.methods.join(","));

  // Determinism: same fixed clock, same payload, same ids.
  const h2 = liveFixture();
  const h2Run = await runLiveSync(h2.store, h2.clock, h2.live, mockSource(ok));
  check("DETERMINISM: a second live sync at the same fixed clock mints the same run id",
    h2Run.id === hRun.id, `${hRun.id} vs ${h2Run.id}`);
  check("…and the same signal ids",
    JSON.stringify(h2.store.listSignalsForSubject(h2.tenantId, "device", h2.deviceId).map((s) => s.id).sort()) ===
      JSON.stringify(hSignals.map((s) => s.id).sort()));

  // ── 4. MUTATION CONTROL ────────────────────────────────────────────────────
  console.log("\n4. the mutation control (a read that agrees with a fixture proves little)");
  const okDecision = evaluateDecision(h.store, h.clock, h.tenantId, "proof:live-connector-sync", {
    identityRef: "live.operator", deviceRef: "live-host-01", workflowKey: "clinical-session",
  });
  ok.mode = "hosts-unmanaged";
  const m = liveFixture();
  await runLiveSync(m.store, m.clock, m.live, mockSource(ok));
  const flipped = evaluateDecision(m.store, m.clock, m.tenantId, "proof:live-connector-sync", {
    identityRef: "live.operator", deviceRef: "live-host-01", workflowKey: "clinical-session",
  });
  check("flipping the mock's host to unmanaged CHANGES the decision",
    flipped.result.outcome !== okDecision.result.outcome,
    `${okDecision.result.outcome} → ${flipped.result.outcome}`);
  check("…to restrict, for DEVICE_UNMANAGED — the live-sourced fields are load-bearing",
    flipped.result.outcome === "restrict" && flipped.result.reasonCodes.includes("DEVICE_UNMANAGED"),
    `${flipped.result.outcome}:${flipped.result.reasonCodes.join(",")}`);

  // ── 5. UNREACHABLE ─────────────────────────────────────────────────────────
  console.log("\n5. unreachable → UNKNOWN");
  await stopMock(ok);
  const u = liveFixture();
  const beforeU = u.store.listSignalsForSubject(u.tenantId, "device", u.deviceId).length;
  const uRun = await runLiveSync(u.store, u.clock, u.live, mockSource(ok));
  failClosed(uRun, u.store, u, "unreachable", beforeU);
  // The bar-raising claim is about a store whose ONLY posture source is the live
  // one. (With the fixture twin present its fresh healthy reading legitimately
  // still stands — a failed read must not erase another connector's evidence,
  // which is the coexistence property section 3 asserts.)
  const uOnly = liveFixture(false);
  const uOnlyRun = await runLiveSync(uOnly.store, uOnly.clock, uOnly.live, mockSource(ok));
  check("unreachable (live-only store): still partial", uOnlyRun.status === "partial");
  const uDecision = evaluateDecision(uOnly.store, uOnly.clock, uOnly.tenantId, "proof:live-connector-sync", {
    identityRef: "live.operator", deviceRef: "live-host-01", workflowKey: "clinical-session",
  });
  check("unreachable: with no other source, the decision is NOT allow — the unknown raised the bar",
    uDecision.result.outcome !== "allow", uDecision.result.outcome);

  // ── 6. TIMEOUT ─────────────────────────────────────────────────────────────
  console.log("\n6. timeout → UNKNOWN, never success (its own arm, because a timeout reported as success is the worst outcome here)");
  const silent = await startMock("silent");
  const t = liveFixture();
  const beforeT = t.store.listSignalsForSubject(t.tenantId, "device", t.deviceId).length;
  const startedMs = performance.now();
  const tRun = await runLiveSync(t.store, t.clock, t.live, mockSource(silent, 300));
  const elapsed = performance.now() - startedMs;
  check("the sync SETTLED inside the bound (a missing timeout hangs this into a failure)",
    elapsed < 5_000, `elapsed=${Math.round(elapsed)}ms`);
  failClosed(tRun, t.store, t, "timeout", beforeT);
  check("timeout: the note names the timeout class specifically", /\(timeout\)/.test(tRun.note ?? ""), tRun.note ?? "");
  await stopMock(silent);

  // ── 7. AUTH FAILURE ────────────────────────────────────────────────────────
  console.log("\n7. 401 and 403 → UNKNOWN");
  for (const status of ["401", "403"] as MockMode[]) {
    const mock = await startMock(status);
    const a = liveFixture();
    const beforeA = a.store.listSignalsForSubject(a.tenantId, "device", a.deviceId).length;
    const aRun = await runLiveSync(a.store, a.clock, a.live, mockSource(mock));
    failClosed(aRun, a.store, a, `HTTP ${status}`, beforeA);
    check(`HTTP ${status}: exactly one request — no retry, no fallback to a cached healthy`,
      mock.methods.length === 1, mock.methods.join(","));
    await stopMock(mock);
  }

  // ── 8. MALFORMED ───────────────────────────────────────────────────────────
  console.log("\n8. malformed → UNKNOWN");
  for (const mode of ["non-json", "array", "empty"] as MockMode[]) {
    const mock = await startMock(mode);
    const b = liveFixture();
    const beforeB = b.store.listSignalsForSubject(b.tenantId, "device", b.deviceId).length;
    const bRun = await runLiveSync(b.store, b.clock, b.live, mockSource(mock));
    failClosed(bRun, b.store, b, `malformed (${mode})`, beforeB);
    await stopMock(mock);
  }

  // The important one: a well-formed host whose management value nothing
  // recognises is DROPPED, not coerced to the unearned negative.
  const unknownMgmt = await startMock("hosts-unknown-mgmt");
  const k = liveFixture();
  const kRun = await runLiveSync(k.store, k.clock, k.live, mockSource(unknownMgmt));
  check("unrecognised management value: the record is DROPPED and the run is partial",
    kRun.status === "partial" && kRun.recordsProcessed === 0, `${kRun.status}/${kRun.recordsProcessed}`);
  check("…and NO device_management signal with value false was written for it",
    !k.store.listSignalsForSubject(k.tenantId, "device", k.deviceId)
      .some((s) => s.connectorId === k.live.id && s.category === "device_management" && s.value === false));
  await stopMock(unknownMgmt);

  // ── 9. READ-ONLY, ENFORCED NOT ASSUMED ─────────────────────────────────────
  console.log("\n9. read-only");
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    let thrown: unknown;
    try { guardReadOnly(method); } catch (err) { thrown = err; }
    check(`the read-only guard throws a typed error on ${method}`,
      thrown instanceof LivePostureMethodError, String(thrown));
  }
  check("…and accepts GET", (() => { try { guardReadOnly("GET"); return true; } catch { return false; } })());

  // ── 10. THE URL GUARD IS WIRED INTO THE RESOLVER ───────────────────────────
  console.log("\n10. the SSRF guard refuses the destinations it must");
  const loop = resolveLivePosture({ ...armed, FLEETDM_BASE_URL: "https://127.0.0.1:8080" });
  check("a LOOPBACK destination is refused, and the refusal names the loopback rule",
    "refused" in loop && /loopback/i.test(loop.refused), "refused" in loop ? loop.refused : "armed");
  const priv = resolveLivePosture({ ...armed, FLEETDM_BASE_URL: "https://10.0.0.5" });
  check("a PRIVATE-RANGE destination is refused, and the refusal names the private-range rule",
    "refused" in priv && /private/i.test(priv.refused), "refused" in priv ? priv.refused : "armed");
  const plain = resolveLivePosture({ ...armed, FLEETDM_BASE_URL: "http://posture.example.invalid" });
  check("a plain-HTTP destination is refused, and the refusal names the HTTPS rule",
    "refused" in plain && /HTTPS/i.test(plain.refused), "refused" in plain ? plain.refused : "armed");

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length) {
    console.error(`FAILED: ${failures.join(" | ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`proof:live-connector-sync crashed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
