/**
 * SignalGrid /v1 API integration test.
 *
 * Boots the built API server and exercises the real HTTP surface end to end:
 * the full decision flow plus the negative cases (auth, RBAC, cross-tenant) and
 * transport concerns (response envelope, status codes, rate-limit headers) that
 * the pure-core proof cannot reach. Public-safe: uses the in-memory core and the
 * synthetic demo keys only — no database, secrets, or live vendor calls.
 *
 * Run: `pnpm --filter @workspace/api-server run test:api`
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PORT = 5310;
const BASE = `http://localhost:${PORT}/api`;
const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.mjs");

const KEYS = {
  owner: "sgk_demo_northwind_owner",
  operator: "sgk_demo_northwind_operator",
  auditor: "sgk_demo_northwind_auditor",
  atlas: "sgk_demo_atlas_owner",
  vero: "sgk_demo_vero_owner",
  forge: "sgk_demo_forge_owner",
  orion: "sgk_demo_orion_owner",
};

let passed = 0;
const failures = [];

// Only the (static) assertion name is ever recorded/logged — never any value
// derived from an HTTP response — so response data is not written to logs.
function check(name, ok) {
  if (ok) {
    passed += 1;
  } else {
    failures.push(name);
  }
}

async function req(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json };
}

async function waitForReady(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// ── WebAuthn fixture crypto (mirrors scripts/src/webauthn-verify-proof.ts) ──
// A GENUINE ES256 ceremony: real P-256 keypair, real DER signature over
// authenticatorData ‖ SHA-256(clientDataJSON), UV flag set. Software-keyed, but
// the server code path exercised is the true hardware path — no stand-ins.
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";

function cborUint(n) {
  if (n < 24) return Buffer.from([n]);
  if (n < 256) return Buffer.from([0x18, n]);
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = 0x19; b.writeUInt16BE(n, 1); return b; }
  const b = Buffer.alloc(5); b[0] = 0x1a; b.writeUInt32BE(n, 1); return b;
}
function cborInt(v) { if (v >= 0) return cborUint(v); const u = cborUint(-1 - v); u[0] = (u[0] & 0x1f) | 0x20; return u; }
function cborBytes(buf) { const h = cborUint(buf.length); h[0] = (h[0] & 0x1f) | 0x40; return Buffer.concat([h, buf]); }
function cborText(s) { const b = Buffer.from(s, "utf8"); const h = cborUint(b.length); h[0] = (h[0] & 0x1f) | 0x60; return Buffer.concat([h, b]); }
function cborMap(pairs) {
  const h = cborUint(pairs.length); h[0] = (h[0] & 0x1f) | 0xa0;
  return Buffer.concat([h, ...pairs.map(([k, v]) => Buffer.concat([typeof k === "number" ? cborInt(k) : cborText(k), v]))]);
}
const sha256 = (b) => createHash("sha256").update(b).digest();

function makeStepUpAuthenticator(rpId, origin) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = cborMap([
    [1, cborInt(2)], [3, cborInt(-7)], [-1, cborInt(1)],
    [-2, cborBytes(Buffer.from(jwk.x, "base64url"))],
    [-3, cborBytes(Buffer.from(jwk.y, "base64url"))],
  ]);
  const credId = randomBytes(16);
  const credIdStr = credId.toString("base64url");
  const authData = (flags, signCount, attested) => {
    const head = Buffer.alloc(37);
    sha256(Buffer.from(rpId, "utf8")).copy(head, 0);
    head.writeUInt8(flags, 32);
    head.writeUInt32BE(signCount, 33);
    return attested ? Buffer.concat([head, attested]) : head;
  };
  const clientData = (type, challenge) => Buffer.from(JSON.stringify({ type, challenge, origin }), "utf8");
  return {
    credIdStr,
    registration(challenge) {
      const credIdLen = Buffer.alloc(2); credIdLen.writeUInt16BE(credId.length, 0);
      const attested = Buffer.concat([Buffer.alloc(16), credIdLen, credId, cose]);
      const attObj = cborMap([
        ["fmt", cborText("none")], ["attStmt", cborMap([])],
        ["authData", cborBytes(authData(0x45, 0, attested))], // UP+UV+AT
      ]);
      return {
        id: credIdStr, rawId: credIdStr, type: "public-key",
        response: {
          clientDataJSON: clientData("webauthn.create", challenge).toString("base64url"),
          attestationObject: attObj.toString("base64url"),
        },
      };
    },
    assertion(challenge, { signCount = 1, tamper = false } = {}) {
      const cd = clientData("webauthn.get", challenge);
      const ad = authData(0x05, signCount); // UP+UV
      let sig = createSign("SHA256").update(Buffer.concat([ad, sha256(cd)])).sign(privateKey);
      if (tamper) sig = Buffer.concat([sig.subarray(0, sig.length - 1), Buffer.from([sig[sig.length - 1] ^ 0xff])]);
      return {
        id: credIdStr, rawId: credIdStr, type: "public-key",
        response: {
          clientDataJSON: cd.toString("base64url"),
          authenticatorData: ad.toString("base64url"),
          signature: sig.toString("base64url"),
        },
      };
    },
  };
}

async function run() {
  // ── health + discovery ──────────────────────────────────────────────────
  const health = await req("GET", "/healthz");
  check("healthz returns 200 ok", health.status === 200 && health.json?.status === "ok");

  const keys = await req("GET", "/v1/keys");
  check("keys discovery is public (200)", keys.status === 200);
  check("keys lists the nine demo keys (incl. the government/civic tenant)", Array.isArray(keys.json?.keys) && keys.json.keys.length === 9);
  check("civic (government) owner key is discoverable", keys.json.keys.some((k) => k.token === "sgk_demo_civic_owner"));

  // ── public catalog + simulator routes ────────────────────────────────────
  const integrations = await req("GET", "/integrations");
  check("integrations catalog → 200", integrations.status === 200);
  check("integrations catalog is a non-empty array", Array.isArray(integrations.json?.integrations) && integrations.json.integrations.length > 0);
  // The immutable catalog is served cacheable (overriding the global no-store).
  check("integrations catalog is cacheable", (integrations.headers.get("cache-control") ?? "").includes("max-age"));
  const firstIntegrationId = integrations.json?.integrations?.[0]?.id;
  const oneIntegration = await req("GET", `/integrations/${firstIntegrationId}`);
  check("single integration fetch → 200", oneIntegration.status === 200);
  const badIntegration = await req("GET", "/integrations/does-not-exist-xyz");
  check("unknown integration → 404", badIntegration.status === 404);

  // ── monitoring surface (operator console + mobile dashboards) ─────────────
  const dash = await req("GET", "/metrics/dashboard");
  check("dashboard metrics → 200", dash.status === 200);
  check("dashboard metrics has totals + rates", typeof dash.json?.totalDecisions === "number" && typeof dash.json?.allowRate === "number");
  const series = await req("GET", "/metrics/decisions/series");
  check("decision series → 200 with points", series.status === 200 && Array.isArray(series.json?.series) && series.json.series.length > 0);
  check("series point shape", typeof (series.json?.series?.[0]?.allow) === "number" && typeof (series.json?.series?.[0]?.timestamp) === "string");
  const decisions = await req("GET", "/decisions?limit=5");
  check("decisions list → 200", decisions.status === 200 && Array.isArray(decisions.json?.decisions));
  check("decisions list honors limit + reports total", decisions.json.decisions.length <= 5 && typeof decisions.json?.total === "number");
  const oneDecision = await req("GET", `/decisions/${decisions.json?.decisions?.[0]?.id}`);
  check("single monitoring decision → 200", oneDecision.status === 200 && oneDecision.json?.id === decisions.json.decisions[0].id);
  const badDecision = await req("GET", "/decisions/does-not-exist-xyz");
  check("unknown monitoring decision → 404", badDecision.status === 404);
  const latest = await req("GET", "/signals/latest?limit=4");
  check("latest signals → 200 within limit", latest.status === 200 && Array.isArray(latest.json?.signals) && latest.json.signals.length <= 4);
  const idOnly = await req("GET", "/signals/latest?signalType=identity");
  check("signals filter by type", idOnly.status === 200 && (idOnly.json?.signals ?? []).every((s) => s.signalType === "identity"));
  const policies = await req("GET", "/policies");
  check("monitoring policies → 200 with rules", policies.status === 200 && Array.isArray(policies.json?.policies) && (policies.json.policies[0]?.rules?.length ?? 0) > 0);

  // ── smart-hospital sim: Trusted Room Entry (decision → orchestration) ─────
  const roomScenarios = await req("GET", "/sim/room-entry/scenarios");
  check("room-entry scenarios → 200 non-empty", roomScenarios.status === 200 && Array.isArray(roomScenarios.json?.scenarios) && roomScenarios.json.scenarios.length > 0);
  const allowEntry = await req("POST", "/sim/room-entry", { body: { scenarioId: "compliant-bedside" } });
  check("room-entry allow scenario → 200 with plan", allowEntry.status === 200 && Array.isArray(allowEntry.json?.plan?.actions));
  check("room-entry allow: sensitive display is assist, not auto",
    allowEntry.json?.plan?.actions?.find((a) => a.kind === "clinical.display.activate")?.disposition === "assist");
  check("room-entry allow: signals include custody + baseline + badge dimensions",
    allowEntry.json?.signals && "custodyState" in allowEntry.json.signals && "baselineCompliance" in allowEntry.json.signals && "badgeBinding" in allowEntry.json.signals);
  const denyEntry = await req("POST", "/sim/room-entry", { body: { scenarioId: "disabled-account" } });
  check("room-entry deny scenario → deny + all blocked",
    denyEntry.json?.decision?.outcome === "deny" && denyEntry.json?.plan?.mode === "deny" && denyEntry.json.plan.actions.every((a) => a.disposition === "blocked"));
  const confirmEntry = await req("POST", "/sim/room-entry", { body: { scenarioId: "compliant-bedside", confirmedActionIds: ["act-RM-418-clinical.display.activate"] } });
  check("room-entry confirm moves an assist action to applied",
    confirmEntry.json?.plan?.actions?.find((a) => a.kind === "clinical.display.activate")?.disposition === "applied");
  const badEntry = await req("POST", "/sim/room-entry", { body: { scenarioId: "does-not-exist" } });
  check("room-entry unknown scenario → 404", badEntry.status === 404);
  // step-up scenario holds, then completes on badge tap
  const stepHeld = await req("POST", "/sim/room-entry", { body: { scenarioId: "baseline-drift" } });
  check("room-entry step-up scenario holds gated actions", stepHeld.json?.plan?.mode === "step_up");
  const stepDone = await req("POST", "/sim/room-entry", { body: { scenarioId: "baseline-drift", stepUpSatisfied: true } });
  check("room-entry step-up completion releases the mobile session (auto)",
    stepDone.json?.plan?.mode !== "step_up" && stepDone.json?.plan?.actions?.find((a) => a.kind === "mobile.session.start")?.disposition === "auto");
  // controlled med room carries the extra clinical actions
  const medRoom = await req("POST", "/sim/room-entry", { body: { scenarioId: "compliant-medroom" } });
  check("controlled med room includes medication-cabinet action",
    (medRoom.json?.plan?.actions ?? []).some((a) => a.kind === "medication.cabinet.unlock"));

  // ── Signal Radar: new-signal detection ───────────────────────────────────
  const catalog = await req("GET", "/signals/catalog");
  check("signal catalog → 200 with 14 evaluated categories", catalog.status === 200 && catalog.json?.evaluated?.length === 14);
  check(
    "signal catalog → benchmark_selection is evaluated, not novel (the category the /v1 misfit rule reads)",
    (catalog.json?.evaluated ?? []).includes("benchmark_selection"),
  );
  check(
    "signal catalog → battery_health is evaluated, not novel",
    (catalog.json?.evaluated ?? []).includes("battery_health"),
  );
  const radar = await req("POST", "/signals/radar", { body: { signals: [
    { category: "identity_state" },
    { category: "rtls_location" },
    { category: "smart_bed_occupancy", sourceReference: "bed-42" },
  ] } });
  check("radar → 200 flags the novel signal", radar.status === 200 && radar.json?.novel?.some((o) => o.category === "smart_bed_occupancy"));
  check("radar does not flag an evaluated signal as novel", !radar.json?.novel?.some((o) => o.category === "identity_state"));
  check("radar raises a first-seen alert for the novel signal", (radar.json?.alerts ?? []).some((a) => a.includes("smart_bed_occupancy")));
  const emptyRadar = await req("POST", "/signals/radar", { body: {} });
  check("radar with no signals → 200 empty report", emptyRadar.status === 200 && Array.isArray(emptyRadar.json?.observations) && emptyRadar.json.observations.length === 0);

  const scenarios = await req("GET", "/simulator/scenarios");
  check("simulator scenarios → 200", scenarios.status === 200 && Array.isArray(scenarios.json?.scenarios));
  const simRun = await req("POST", "/simulator/run", { body: { scenarioId: (scenarios.json?.scenarios ?? [])[0]?.id } });
  check("simulator run → 200 with audit evidence", simRun.status === 200 && Array.isArray(simRun.json?.auditEvidence));
  const simBad = await req("POST", "/simulator/run", { body: {} });
  check("simulator run without scenarioId → 400", simBad.status === 400);
  const simReset = await req("POST", "/simulator/reset", { body: {} });
  check("simulator reset → 200", simReset.status === 200 && Array.isArray(simReset.json?.auditEvidence));

  // ── auth fails closed ───────────────────────────────────────────────────
  const noAuth = await req("GET", "/v1/decisions");
  check("unauthenticated request is 401", noAuth.status === 401);

  const badToken = await req("GET", "/v1/decisions", { token: "sgk_not_real" });
  check("unknown token is 401", badToken.status === 401);

  // ── evaluate: allow ─────────────────────────────────────────────────────
  const allow = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  });
  check("evaluate compliant → 200", allow.status === 200);
  check("evaluate response is enveloped", typeof allow.json?.requestId !== "undefined" && typeof allow.json?.timestamp === "string");
  check("evaluate returns decision under `decision`", allow.json?.decision?.decisionId !== undefined);
  check("compliant outcome is allow", allow.json?.decision?.outcome === "allow");
  const allowId = allow.json?.decision?.decisionId;

  // ── evaluate: restrict + stale ──────────────────────────────────────────
  const restrict = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session" },
  });
  check("non-compliant outcome is restrict", restrict.json?.decision?.outcome === "restrict");

  const stale = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session" },
  });
  check("stale posture outcome is step_up", stale.json?.decision?.outcome === "step_up");
  const staleId = stale.json?.decision?.decisionId;

  // ── app-workflows: gate application actions ─────────────────────────────
  const appList = await req("GET", "/v1/app-workflows/integrations?vertical=healthcare", { token: KEYS.operator });
  check("app-workflows catalog (healthcare) → 200 with EMR", appList.status === 200 && appList.json?.integrations?.some((i) => i.id === "emr-chart"));
  const gateEmr = await req("POST", "/v1/app-workflows/evaluate", {
    token: KEYS.operator,
    body: { integrationId: "emr-chart", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01" },
  });
  check("app-workflows EMR gate → 200 allow", gateEmr.status === 200 && gateEmr.json?.decision?.outcome === "allow");
  check("app-workflows: sensitive med order is assist, not auto",
    gateEmr.json?.plan?.actions?.find((a) => a.key === "order.place")?.disposition === "assist");
  const gateUnknown = await req("POST", "/v1/app-workflows/evaluate", { token: KEYS.operator, body: { integrationId: "nope", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01" } });
  check("app-workflows unknown integration → 404", gateUnknown.status === 404);

  // A step_up keeps its high-assurance actions held — the product API never
  // releases them from a request-supplied signal (real completion requires a
  // hardware-backed WebAuthn assertion; see docs/EMBEDDED_UX_PRINCIPLE.md).
  const bcmaHeld = await req("POST", "/v1/app-workflows/evaluate", {
    token: KEYS.operator,
    body: { integrationId: "bcma", identityRef: "nurse.baseline_drift", deviceRef: "ipad-ward-06" },
  });
  check("app-workflows BCMA baseline-drift → step_up, controlled admin held",
    bcmaHeld.json?.decision?.outcome === "step_up" &&
    bcmaHeld.json?.plan?.actions?.find((a) => a.key === "controlled.administer")?.disposition === "step_up");

  // Retail + industrial now gate LIVE against their own seeded tenants (not
  // catalog-only): the POS and MES/SCADA-HMI catalogs run a real decision.
  const posGate = await req("POST", "/v1/app-workflows/evaluate", {
    token: KEYS.vero,
    body: { integrationId: "restricted-sale", identityRef: "cashier.compliant", deviceRef: "pos-station-01" },
  });
  check("app-workflows retail (Vero) restricted-sale → 200 allow", posGate.status === 200 && posGate.json?.decision?.outcome === "allow");
  check("app-workflows: retail age-restricted approval is assist, not auto (sensitive)",
    posGate.json?.plan?.actions?.find((a) => a.key === "agerestricted.approve")?.disposition === "assist");
  const mesGate = await req("POST", "/v1/app-workflows/evaluate", {
    token: KEYS.forge,
    body: { integrationId: "mes-scada", identityRef: "operator.baseline_drift", deviceRef: "hmi-panel-06" },
  });
  check("app-workflows industrial (Forge) MES baseline-drift → step_up, interlock bypass held",
    mesGate.json?.decision?.outcome === "step_up" &&
    mesGate.json?.plan?.actions?.find((a) => a.key === "interlock.bypass")?.disposition === "step_up");

  // Data-center / NOC now gates LIVE against its own seeded tenant (Orion),
  // completing the six-vertical story: uptime-affecting actions are held.
  const nocGate = await req("POST", "/v1/app-workflows/evaluate", {
    token: KEYS.orion,
    body: { integrationId: "network-config", identityRef: "noc.compliant", deviceRef: "noc-console-01" },
  });
  check("app-workflows data-center (Orion) network-config → 200 allow", nocGate.status === 200 && nocGate.json?.decision?.outcome === "allow");
  check("app-workflows: NOC config push is assist, not auto (uptime-critical)",
    nocGate.json?.plan?.actions?.find((a) => a.key === "config.push")?.disposition === "assist");
  const powerGate = await req("POST", "/v1/app-workflows/evaluate", {
    token: KEYS.orion,
    body: { integrationId: "power-pdu", identityRef: "noc.noncompliant", deviceRef: "noc-console-02" },
  });
  check("app-workflows: NOC power-cycle blocked under restriction (non-compliant console)",
    powerGate.json?.decision?.outcome === "restrict" &&
    powerGate.json?.plan?.actions?.find((a) => a.key === "rack.powercycle")?.disposition === "blocked");

  // ── validation error ────────────────────────────────────────────────────
  const badBody = await req("POST", "/v1/decisions/evaluate", { token: KEYS.operator, body: { identityRef: "x" } });
  check("missing fields → 400", badBody.status === 400);

  // ── evidence + integrity ────────────────────────────────────────────────
  const evidence = await req("GET", `/v1/decisions/${allowId}/evidence`, { token: KEYS.operator });
  check("evidence fetch → 200", evidence.status === 200);
  check("evidence snapshot verifies", evidence.json?.verified === true);

  // ── simulate stale decision against v2 → restrict ───────────────────────
  const sim = await req("POST", `/v1/decisions/${staleId}/simulate`, {
    token: KEYS.operator,
    body: { policyVersionId: "pol_tenant_northwind_shared_device_v2" },
  });
  check("simulate → 200", sim.status === 200);
  check("stale decision escalates to restrict under v2", sim.json?.simulation?.simulatedOutcome === "restrict" && sim.json?.simulation?.changed === true);

  // ── resolution assistant ────────────────────────────────────────────────
  const resolution = await req("GET", `/v1/decisions/${staleId}/resolution`, { token: KEYS.operator });
  check("resolution plan → 200", resolution.status === 200);
  check("stale decision is self-service", resolution.json?.resolution?.path === "self_service" && resolution.json?.resolution?.autoResolvable === true);
  const resolve = await req("POST", `/v1/decisions/${staleId}/resolve`, { token: KEYS.operator });
  check("resolve simulation → 200", resolve.status === 200);
  check("simulated resolution reaches allow", resolve.json?.simulation?.resolved === true && resolve.json?.simulation?.projectedOutcome === "allow");

  // ── metrics ─────────────────────────────────────────────────────────────
  const metrics = await req("GET", "/v1/metrics", { token: KEYS.operator });
  check("metrics → 200", metrics.status === 200);
  check("metrics count all evaluations", (metrics.json?.metrics?.totalDecisions ?? 0) >= 3);
  check("metrics report p95 latency", typeof metrics.json?.metrics?.p95LatencyMs === "number");

  // ── audit chain ─────────────────────────────────────────────────────────
  const audit = await req("GET", "/v1/audit", { token: KEYS.owner });
  check("audit → 200", audit.status === 200);
  check("audit chain is verified", audit.json?.chain?.valid === true);

  const auditByOperator = await req("GET", "/v1/audit", { token: KEYS.operator });
  check("operator cannot read audit (403)", auditByOperator.status === 403);

  // ── policy tests + versions ─────────────────────────────────────────────
  const tests = await req("GET", "/v1/policies/pol_tenant_northwind_shared_device/tests", { token: KEYS.owner });
  check("policy tests pass", tests.status === 200 && tests.json?.passed === true);

  // ── security hardening: untrusted policy rules are validated (no deferred DoS)
  const malformedRule = await req("POST", "/v1/policies/pol_tenant_northwind_shared_device/versions", {
    token: KEYS.owner,
    body: { rules: [{ id: "x", description: "d", outcome: "allow", reasonCode: "R", severity: "low" }] },
  });
  check("malformed policy rule (no match) → 400 not 500", malformedRule.status === 400);

  const badField = await req("POST", "/v1/policies/pol_tenant_northwind_shared_device/versions", {
    token: KEYS.owner,
    body: { rules: [{ id: "x", description: "d", match: [{ field: "notAField", equals: true }], outcome: "allow", reasonCode: "R", severity: "low" }] },
  });
  check("policy rule with unknown condition field → 400", badField.status === 400);

  // A deeply-nested rules payload is rejected as a client error, never a 500.
  let nested = 0;
  for (let i = 0; i < 400; i++) nested = [nested];
  const deepRules = await req("POST", "/v1/policies/pol_tenant_northwind_shared_device/versions", {
    token: KEYS.owner,
    body: { rules: [{ id: "x", description: "d", match: nested, outcome: "allow", reasonCode: "R", severity: "low" }] },
  });
  check("deeply-nested rules payload → 4xx not 500", deepRules.status >= 400 && deepRules.status < 500);

  // A valid authored draft still activates and evaluates cleanly afterwards.
  // Capture the currently-active version so we can restore it — activating a
  // new version is global state and later assertions depend on the seed policy.
  const policiesBefore = await req("GET", "/v1/policies", { token: KEYS.owner });
  const sharedPolicy = (policiesBefore.json?.policies ?? []).find(
    (p) => p.id === "pol_tenant_northwind_shared_device",
  );
  const originalActiveVersionId = sharedPolicy?.activeVersionId;

  const goodDraft = await req("POST", "/v1/policies/pol_tenant_northwind_shared_device/versions", {
    token: KEYS.owner,
    body: { rules: [{ id: "sec-rule", description: "d", match: [{ field: "deviceManaged", equals: false }], outcome: "restrict", reasonCode: "SEC", severity: "high" }] },
  });
  check("valid authored policy draft → 201", goodDraft.status === 201);
  const activateGood = await req("POST", `/v1/policies/pol_tenant_northwind_shared_device/versions/${goodDraft.json?.version?.id}/activate`, { token: KEYS.owner });
  check("valid draft activates → 200", activateGood.status === 200);
  const postActivateEval = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  });
  check("evaluation after activating a validated draft still succeeds (no brick)", postActivateEval.status === 200);

  // Restore the seed policy so downstream assertions see the original engine.
  if (originalActiveVersionId) {
    await req("POST", `/v1/policies/pol_tenant_northwind_shared_device/versions/${originalActiveVersionId}/activate`, { token: KEYS.owner });
  }

  // Malformed JSON body is a client error (400), not a server fault (500).
  const brokenJson = await fetch(`${BASE}/v1/decisions/evaluate`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEYS.operator}`, "content-type": "application/json" },
    body: "{ not valid json",
  });
  check("malformed JSON body → 400 not 500", brokenJson.status === 400);

  // ── connectors (posture + DockBridge custody) ───────────────────────────
  const connectors = await req("GET", "/v1/connectors", { token: KEYS.owner });
  check("connectors listed", connectors.status === 200 && Array.isArray(connectors.json?.connectors));
  check("dockbridge custody connector present", (connectors.json?.connectors ?? []).some((c) => c.kind === "dockbridge-custody"));

  // Overdue-custody decision carries the dock state and is self-service.
  const overdue = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.overdue", deviceRef: "ipad-loan-01", workflowKey: "clinical-session" },
  });
  check("overdue custody → restrict", overdue.json?.decision?.outcome === "restrict");
  const overdueRes = await req("GET", `/v1/decisions/${overdue.json?.decision?.decisionId}/resolution`, { token: KEYS.operator });
  check("overdue return is self-service", overdueRes.json?.resolution?.path === "self_service");

  // ── security-baseline (CIS/hardening) posture as a decision dimension ─────
  const baselineDrift = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.baseline_drift", deviceRef: "ipad-ward-06", workflowKey: "clinical-session" },
  });
  check("baseline drift → step_up", baselineDrift.json?.decision?.outcome === "step_up");
  check("baseline drift reason surfaced", (baselineDrift.json?.decision?.reasonCodes ?? []).includes("BASELINE_DRIFTED"));
  const driftId = baselineDrift.json?.decision?.decisionId;
  const driftEvidence = await req("GET", `/v1/decisions/${driftId}/evidence`, { token: KEYS.operator });
  check("baseline state is exposed in decision evidence", driftEvidence.json?.evidence?.evidence?.baselineCompliance === "drifted");
  const driftRes = await req("GET", `/v1/decisions/${driftId}/resolution`, { token: KEYS.operator });
  check("baseline drift is self-service (re-apply hardening profile)", driftRes.json?.resolution?.path === "self_service");

  // ── badge-reader case: identity↔device binding as a decision dimension ────
  const badgeOut = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.badge_removed", deviceRef: "ipad-badge-01", workflowKey: "clinical-session" },
  });
  check("badge withdrawn → restrict", badgeOut.json?.decision?.outcome === "restrict");
  check("badge-removed reason surfaced", (badgeOut.json?.decision?.reasonCodes ?? []).includes("BADGE_REMOVED"));
  const badgeId = badgeOut.json?.decision?.decisionId;
  const badgeEvidence = await req("GET", `/v1/decisions/${badgeId}/evidence`, { token: KEYS.operator });
  check("badge binding is exposed in decision evidence", badgeEvidence.json?.evidence?.evidence?.badgeBinding === "removed");
  const badgeRes = await req("GET", `/v1/decisions/${badgeId}/resolution`, { token: KEYS.operator });
  check("badge withdrawn is self-service (re-insert badge)", badgeRes.json?.resolution?.path === "self_service");
  const badgeForced = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.badge_forced", deviceRef: "ipad-badge-02", workflowKey: "clinical-session" },
  });
  check("badge forced removal → deny", badgeForced.json?.decision?.outcome === "deny" && (badgeForced.json?.decision?.reasonCodes ?? []).includes("BADGE_FORCED_REMOVAL"));

  // ── SmartDock: the embedded dock's own hardware state drives decisions ────
  const dockFaulted = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.dock_faulted", deviceRef: "ipad-dock-01", workflowKey: "clinical-session" },
  });
  check("faulted SmartDock → restrict", dockFaulted.json?.decision?.outcome === "restrict");
  check("dock-faulted reason surfaced", (dockFaulted.json?.decision?.reasonCodes ?? []).includes("DOCK_FAULTED"));
  const dockFaultedId = dockFaulted.json?.decision?.decisionId;
  const dockEvidence = await req("GET", `/v1/decisions/${dockFaultedId}/evidence`, { token: KEYS.operator });
  check("dock hardware state is exposed in decision evidence", dockEvidence.json?.evidence?.evidence?.dockState === "faulted");
  const dockOffline = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.operator,
    body: { identityRef: "nurse.dock_offline", deviceRef: "ipad-dock-02", workflowKey: "clinical-session" },
  });
  check("offline SmartDock → step-up", dockOffline.json?.decision?.outcome === "step_up" && (dockOffline.json?.decision?.reasonCodes ?? []).includes("DOCK_OFFLINE"));
  const smartdockConnectors = await req("GET", "/v1/connectors", { token: KEYS.owner });
  check("embedded SmartDock connector is present", (smartdockConnectors.json?.connectors ?? []).some((c) => c.ingestionMode === "embedded_smartdock"));

  // ── connector + webhooks ────────────────────────────────────────────────
  const deliveries = await req("GET", "/v1/webhooks/deliveries", { token: KEYS.owner });
  check("webhook deliveries listed", deliveries.status === 200 && Array.isArray(deliveries.json?.deliveries));
  check("some deliveries succeeded", (deliveries.json?.deliveries ?? []).some((d) => d.status === "delivered"));

  // ── remediation: approval-gated, simulated ──────────────────────────────
  const remediation = await req("GET", "/v1/remediation", { token: KEYS.operator });
  check("remediation listed", remediation.status === 200 && Array.isArray(remediation.json?.actions));
  const pending = (remediation.json?.actions ?? []).find((a) => a.status === "requires_approval");
  check("a pending remediation exists", Boolean(pending));
  check("remediation is approval-required and simulated", pending?.approvalRequired === true && pending?.simulatedOnly === true);

  if (pending) {
    const denyApprove = await req("POST", `/v1/remediation/${pending.id}/approve`, { token: KEYS.operator });
    check("operator cannot approve remediation (403)", denyApprove.status === 403);

    const approve = await req("POST", `/v1/remediation/${pending.id}/approve`, { token: KEYS.owner });
    check("owner approves remediation (200)", approve.status === 200);
    check("approval is simulated only", approve.json?.action?.status === "approved_simulated");
  }

  // ── RBAC + cross-tenant isolation ───────────────────────────────────────
  const auditorEval = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.auditor,
    body: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  });
  check("auditor cannot evaluate (403)", auditorEval.status === 403);

  const crossTenant = await req("GET", `/v1/decisions/${allowId}`, { token: KEYS.atlas });
  check("cross-tenant read is 404", crossTenant.status === 404);

  const atlasEval = await req("POST", "/v1/decisions/evaluate", {
    token: KEYS.atlas,
    body: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" },
  });
  check("atlas key cannot resolve northwind subjects (404)", atlasEval.status === 404);

  // ── DDM (macOS 27) — enforcement-currency fail-safe ──────────────────────
  const ddm = await req("GET", "/cp/v1/ddm");
  check("ddm surfaces update-enforcement currency + a dead-enforcement count", ddm.status === 200 && typeof ddm.json?.summary?.enforcementDead === "number" && ddm.json.summary.enforcementDead >= 1);
  const deadEnf = (ddm.json?.signals ?? []).find((s) => s.enforcementCurrency === "dead");
  check("ddm: a device with dead update enforcement raises step-up (not trusted as patched)", deadEnf && deadEnf.assurance === "raise_step_up");

  // ── Fleet MDM (osquery) — fixture host posture, fail-closed assurance ──────
  // Contract coverage for GET /cp/v1/fleet-mdm: without this the route could change its
  // serialized shape or disappear while every deterministic gate stayed green, and the
  // native client silently degrades a failure to an empty Fleet view (review finding).
  const fleetMdm = await req("GET", "/cp/v1/fleet-mdm");
  check("fleet-mdm returns normalized host posture: summary.hosts + a signals row per host", fleetMdm.status === 200 && typeof fleetMdm.json?.summary?.hosts === "number" && Array.isArray(fleetMdm.json?.signals) && fleetMdm.json.signals.length === fleetMdm.json.summary.hosts);
  check("fleet-mdm: only the fully-healthy+supervised host is 'standard' — every weak/unsupervised host raises assurance", (fleetMdm.json?.summary?.raiseStepUp ?? 0) >= 1 && (fleetMdm.json?.signals ?? []).filter((s) => s.assurance === "standard").length === (fleetMdm.json.summary.hosts - fleetMdm.json.summary.raiseStepUp));
  const unsupervisedHost = (fleetMdm.json?.signals ?? []).find((s) => s.enforceable === false);
  check("fleet-mdm: an unenforceable (unsupervised) host raises step-up, never trusted as standard", unsupervisedHost && unsupervisedHost.assurance === "raise_step_up");
  // ── self-audit: the plain-language administrative health surface ─────────
  const selfAudit = await req("GET", "/cp/v1/self-audit");
  check("self-audit responds 200 with plain + report + proposedHeals",
    selfAudit.status === 200 && !!selfAudit.json?.plain && !!selfAudit.json?.report && Array.isArray(selfAudit.json?.proposedHeals));
  check("self-audit fixture snapshot reads as the all-clear 'just works' state",
    selfAudit.json?.plain?.allClear === true && selfAudit.json?.plain?.headline === "Everything is working." && selfAudit.json?.plain?.attentionCount === 0);
  check("self-audit healthy fixture proposes no heals (nothing to fix)",
    selfAudit.json?.proposedHeals?.length === 0);
  check("self-audit plain lines never leak an internal status enum word",
    !/\b(healthy|drifted|broken|unknown)\b/.test((selfAudit.json?.plain?.lines ?? []).map((l) => `${l.state} ${l.sentence}`).join(" ")));

  // ── reliability: SLO / error-budget for the decision plane ───────────────
  const reliability = await req("GET", "/cp/v1/reliability");
  check("reliability responds 200 with plain + report", reliability.status === 200 && !!reliability.json?.plain && !!reliability.json?.report);
  check("reliability healthy fixture is on track", reliability.json?.plain?.allOnTrack === true && reliability.json?.plain?.headline === "Reliability is on track.");
  check("reliability includes the zero-tolerance fail-closed-integrity SLO with no budget",
    (reliability.json?.report?.budgets ?? []).some((b) => b.slo?.id === "fail-closed-integrity" && b.slo?.zeroTolerance === true && b.budgetEvents === 0));
  check("reliability plain lines never leak the raw status enum",
    !/\b(healthy|at_risk|exhausted)\b/.test((reliability.json?.plain?.lines ?? []).map((l) => l.state).join(" ")));

  // ── build-the-grid control-plane surface (decision-fabric layer, live) ───
  const coverage = await req("GET", "/cp/v1/grid/coverage");
  check("grid coverage responds 200", coverage.status === 200);
  check("grid coverage handles every situation (fixture fully sourced)", coverage.json?.coverage?.coveragePct === 100);
  check("grid coverage reports sourcing (some grid-lifted)", coverage.json?.sourcing?.gridCollected > 0);

  const sourcing = await req("GET", "/cp/v1/grid/sourcing");
  check("grid sourcing responds with per-signal rows + summary", sourcing.status === 200 && Array.isArray(sourcing.json?.signals) && typeof sourcing.json?.summary?.total === "number");
  const srcSignals = sourcing.json?.signals ?? [];
  const gap = srcSignals.find((r) => r.method === "unavailable");
  check("grid sourcing surfaces a gap (unavailable → not wireable, no fidelity)", gap?.wireable === false && gap?.fidelity === "none");
  check("grid sourcing marks vendor-integrated signals high fidelity + not grid-lifted", srcSignals.filter((r) => r.method === "api" || r.method === "native").every((r) => r.fidelity === "high" && r.wireable === true && r.gridLifted === false));
  check("grid sourcing marks grid-collected as the Grid doing the lifting", srcSignals.filter((r) => r.method === "grid_collected").every((r) => r.gridLifted === true && r.wireable === true));

  const gridConfig = await req("GET", "/cp/v1/grid/config");
  check("grid config validates clean", gridConfig.status === 200 && gridConfig.json?.valid === true);
  check("grid config warns on the unwired gap signal (surfaced, not blocking)", (gridConfig.json?.summary?.warnings ?? 0) >= 1);
  check("grid config surfaces a governance scorecard (ownership + accountability)", typeof gridConfig.json?.governance?.workflows === "number" && gridConfig.json.governance.owned === gridConfig.json.governance.workflows && gridConfig.json.governance.complete === true);
  check("grid config workflows carry owner + accountable governance fields", (gridConfig.json?.config?.workflows ?? []).every((w) => "owner" in w && "accountable" in w));
  check("grid config returns the declarative artifact (signals + workflows + situations)", Array.isArray(gridConfig.json?.config?.signals) && gridConfig.json.config.signals.length > 0 && Array.isArray(gridConfig.json?.config?.workflows) && gridConfig.json.config.workflows.length > 0 && Array.isArray(gridConfig.json?.config?.situations));
  check("grid config workflows carry required signals + approval-gated actions", (gridConfig.json?.config?.workflows ?? []).every((w) => Array.isArray(w.requiredSignals) && Array.isArray(w.actions) && w.actions.every((a) => typeof a.approval === "string")));

  const provisioning = await req("GET", "/cp/v1/grid/provisioning");
  check("provisioning plan is simulated (nothing auto-applies)", provisioning.status === 200 && provisioning.json?.plan?.willApplyAnything === false && provisioning.json?.plan?.matched === true);
  check("provisioning surfaces the recording + its validation", provisioning.json?.recordingValid === true && Array.isArray(provisioning.json?.issues));
  check("provisioning exposes preset devices for the Designer preview", Array.isArray(provisioning.json?.devices) && provisioning.json.devices.length >= 2);
  const provMatch = await req("GET", "/cp/v1/grid/provisioning?serial=CLIN-00042");
  check("provisioning matches a device with the recording's serial prefix", provMatch.json?.plan?.matched === true && provMatch.json?.plan?.steps?.length > 0);
  const provNoMatch = await req("GET", "/cp/v1/grid/provisioning?serial=WARE-88120");
  check("provisioning never touches a non-matching device (fail-safe)", provNoMatch.json?.plan?.matched === false && provNoMatch.json?.plan?.steps?.length === 0 && provNoMatch.json?.plan?.willApplyAnything === false);
  const provProto = await req("GET", "/cp/v1/grid/provisioning?serial=constructor");
  check("provisioning serial lookup is prototype-safe (constructor is an ad-hoc, non-matching device)", provProto.status === 200 && provProto.json?.device?.serial === "constructor" && provProto.json?.plan?.matched === false);

  const resilience = await req("GET", "/cp/v1/apps/resilience");
  check("app resilience rollup responds with a fleet", resilience.status === 200 && typeof resilience.json?.fleet?.total === "number");
  const resApps = resilience.json?.fleet?.apps ?? [];
  const phiBlocked = resApps.find((a) => a.appId === "billing");
  // Endpoint-level fail-safe: a PHI app in outage with a fallback but NO safety
  // nets is blocked, never a workaround. (The general "PHI never on a fallback
  // without nets, at any availability" invariant is pinned by proof:app-resilience;
  // the response shape here doesn't carry handlesPhi, so we assert the concrete
  // blocked case rather than a shape-fragile all-fallbacks predicate.)
  check("app resilience blocks a PHI app in outage with no safety nets (fail-safe)", phiBlocked?.mode === "blocked_no_fallback" && phiBlocked?.canProceed === false && phiBlocked?.requiredSafetyNets?.length === 0);
  check("app resilience surfaces a per-app reason", resApps.length > 0 && resApps.every((a) => typeof a.reason === "string" && a.reason.length > 0));

  // ── step-up completion: real WebAuthn ceremony, fail-closed everywhere ────
  // The one path that may release a held step_up action: enroll → challenge →
  // genuinely-signed ES256 assertion (UV set) → verify → re-plan. Everything
  // else — no enrollment, tampered signature, replayed challenge, request-body
  // flags, cross-tenant credentials — must hold or 403, never release.
  const authenticator = makeStepUpAuthenticator("localhost", "http://localhost:3000");
  const suIdentity = "nurse.baseline_drift";
  const suDevice = "ipad-ward-06";

  // Fail-closed before enrollment: no credential ⇒ no challenge.
  const noCred = await req("POST", "/v1/step-up/challenge", {
    token: KEYS.operator, body: { identityRef: suIdentity, integrationId: "bcma", deviceRef: suDevice, actionKey: "controlled.administer" },
  });
  check("step-up challenge without enrollment → 409 (fail closed)", noCred.status === 409);

  // NEGATIVE CONTROL (enrollment RBAC): enrolling a credential FOR an identity is an
  // operator/owner ceremony — an auditor key must be refused before any WebAuthn work.
  const auditorEnroll = await req("POST", "/v1/step-up/enroll/options", {
    token: KEYS.auditor, body: { identityRef: suIdentity },
  });
  check("auditor key cannot enroll a step-up credential (403)", auditorEnroll.status === 403);

  // Enroll.
  const enrollOpts = await req("POST", "/v1/step-up/enroll/options", {
    token: KEYS.operator, body: { identityRef: suIdentity },
  });
  check("step-up enroll options → 200 with challenge", enrollOpts.status === 200 && typeof enrollOpts.json?.challengeId === "string" && typeof enrollOpts.json?.publicKey?.challenge === "string");
  // Truthful framing (review finding): with no out-of-band secret configured, the
  // ceremony IS self-service (the role gate is satisfiable with the published demo
  // keys), and the response must say so rather than presenting a real privileged gate.
  check("enroll options carries the self-service demo note (secret unset)", typeof enrollOpts.json?.demoNote === "string" && enrollOpts.json.demoNote.includes("simulated") && enrollOpts.json.demoNote.includes("SIGNALGRID_ENROLLMENT_SECRET"));
  // Principal binding (review finding): the ceremony was minted by the OPERATOR key;
  // a different authorized principal (owner) presenting the same challengeId must be
  // refused BEFORE any WebAuthn work — and the challenge must remain unconsumed, so
  // the legitimate verify below still succeeds.
  const crossPrincipalVerify = await req("POST", "/v1/step-up/enroll/verify", {
    token: KEYS.owner,
    body: {
      identityRef: suIdentity,
      challengeId: enrollOpts.json.challengeId,
      response: authenticator.registration(enrollOpts.json.publicKey.challenge),
    },
  });
  check("a different principal cannot complete another's enrollment ceremony (403)", crossPrincipalVerify.status === 403);

  const enrollVerify = await req("POST", "/v1/step-up/enroll/verify", {
    token: KEYS.operator,
    body: {
      identityRef: suIdentity,
      challengeId: enrollOpts.json.challengeId,
      response: authenticator.registration(enrollOpts.json.publicKey.challenge),
    },
  });
  check("step-up enrollment verifies a genuine attestation", enrollVerify.status === 200 && enrollVerify.json?.enrolled === true);
  check("enrollment is attributed to the minting principal", enrollVerify.json?.enrolledByRef === "user_northwind_operator");

  // The evaluate route must NEVER release from a request flag, even enrolled.
  const flagSmuggled = await req("POST", "/v1/app-workflows/evaluate", {
    token: KEYS.operator,
    body: { integrationId: "bcma", identityRef: suIdentity, deviceRef: suDevice, stepUpSatisfied: true },
  });
  check("evaluate ignores request-body stepUpSatisfied (still held)",
    flagSmuggled.json?.decision?.outcome === "step_up" &&
    flagSmuggled.json?.plan?.actions?.find((a) => a.key === "controlled.administer")?.disposition === "step_up");

  // Tampered signature → 403, and no plan escapes with the error.
  const chalBad = await req("POST", "/v1/step-up/challenge", { token: KEYS.operator, body: { identityRef: suIdentity, integrationId: "bcma", deviceRef: suDevice, actionKey: "controlled.administer" } });
  const tampered = await req("POST", "/v1/app-workflows/complete-step-up", {
    token: KEYS.operator,
    body: {
      integrationId: "bcma", identityRef: suIdentity, deviceRef: suDevice, actionKey: "controlled.administer",
      challengeId: chalBad.json.challengeId,
      assertion: authenticator.assertion(chalBad.json.publicKey.challenge, { tamper: true }),
    },
  });
  check("tampered assertion → 403 with no plan", tampered.status === 403 && tampered.json?.plan === undefined);

  // The genuine ceremony releases the held action.
  const chalGood = await req("POST", "/v1/step-up/challenge", { token: KEYS.operator, body: { identityRef: suIdentity, integrationId: "bcma", deviceRef: suDevice, actionKey: "controlled.administer" } });
  check("step-up auth challenge → 200 (enrolled)", chalGood.status === 200 && typeof chalGood.json?.challengeId === "string");
  const goodAssertion = authenticator.assertion(chalGood.json.publicKey.challenge, { signCount: 2 });

  // NEGATIVE CONTROLS (challenge→action binding): the challenge above was minted for
  // (nurse.baseline_drift, bcma, ipad-ward-06). A signed gesture must release ONLY
  // that action — a different integration, identity, or device is refused BEFORE the
  // cryptographic verify, leaving the challenge unconsumed.
  const wrongIntegration = await req("POST", "/v1/app-workflows/complete-step-up", {
    token: KEYS.operator,
    body: { integrationId: "emr-chart", identityRef: suIdentity, deviceRef: suDevice, actionKey: "controlled.administer", challengeId: chalGood.json.challengeId, assertion: goodAssertion },
  });
  check("challenge minted for bcma cannot release emr-chart (403)", wrongIntegration.status === 403 && wrongIntegration.json?.plan === undefined);
  const wrongIdentity = await req("POST", "/v1/app-workflows/complete-step-up", {
    token: KEYS.operator,
    body: { integrationId: "bcma", identityRef: "nurse.compliant", deviceRef: suDevice, actionKey: "controlled.administer", challengeId: chalGood.json.challengeId, assertion: goodAssertion },
  });
  check("challenge minted for one identity cannot release another's action (403)", wrongIdentity.status === 403);
  const wrongDevice = await req("POST", "/v1/app-workflows/complete-step-up", {
    token: KEYS.operator,
    body: { integrationId: "bcma", identityRef: suIdentity, deviceRef: "ipad-ward-01", actionKey: "controlled.administer", challengeId: chalGood.json.challengeId, assertion: goodAssertion },
  });
  check("challenge minted for one device cannot release another's action (403)", wrongDevice.status === 403);

  // SCOPED release (Codex finding): the challenge above was minted for
  // controlled.administer. A completion claiming a DIFFERENT action of the SAME
  // integration is refused before the cryptographic verify.
  const wrongAction = await req("POST", "/v1/app-workflows/complete-step-up", {
    token: KEYS.operator,
    body: { integrationId: "bcma", identityRef: suIdentity, deviceRef: suDevice, actionKey: "dose.override", challengeId: chalGood.json.challengeId, assertion: goodAssertion },
  });
  check("challenge minted for one action cannot release a different action of the same integration (403)", wrongAction.status === 403 && wrongAction.json?.plan === undefined);
  // An unknown action key has nothing to bind to — no challenge is minted.
  const unknownAction = await req("POST", "/v1/step-up/challenge", {
    token: KEYS.operator, body: { identityRef: suIdentity, integrationId: "bcma", deviceRef: suDevice, actionKey: "no.such.action" },
  });
  check("challenge for an unknown action key → 404 (nothing to bind to)", unknownAction.status === 404);
  // A KNOWN action that the planner never holds is refused too (review finding). Only
  // `gatedByStepUp || sensitive` actions are held; `note.document` is standard-tier, so
  // it stays `auto` even under a step_up decision. Minting a challenge for it produced a
  // record asserting `released: true` over something that was never withheld — a
  // ceremony proving nothing, written into the audit trail as though it authorized
  // access. Rejecting at mint time is what keeps the record truthful.
  const notHeld = await req("POST", "/v1/step-up/challenge", {
    token: KEYS.operator, body: { identityRef: suIdentity, integrationId: "emr-chart", deviceRef: suDevice, actionKey: "note.document" },
  });
  check("challenge for a known but never-held action → 400 (it would release nothing)",
    notHeld.status === 400 && notHeld.json?.challengeId === undefined);
  // Control: the same integration's genuinely gated action still mints, so the guard
  // above rejects for being un-held rather than by rejecting emr-chart wholesale.
  const heldSameIntegration = await req("POST", "/v1/step-up/challenge", {
    token: KEYS.operator, body: { identityRef: suIdentity, integrationId: "emr-chart", deviceRef: suDevice, actionKey: "order.place" },
  });
  check("control: a held action of the SAME integration still mints a challenge",
    heldSameIntegration.status === 200 && typeof heldSameIntegration.json?.challengeId === "string");

  const completed = await req("POST", "/v1/app-workflows/complete-step-up", {
    token: KEYS.operator,
    body: {
      integrationId: "bcma", identityRef: suIdentity, deviceRef: suDevice, actionKey: "controlled.administer",
      challengeId: chalGood.json.challengeId, assertion: goodAssertion,
    },
  });
  check("verified assertion releases the BOUND action (no longer held)",
    completed.status === 200 && completed.json?.stepUp?.released === true &&
    completed.json?.stepUp?.actionKey === "controlled.administer" &&
    completed.json?.plan?.actions?.find((a) => a.key === "controlled.administer")?.disposition !== "step_up");
  // THE scoped-release invariant: the gesture was bound to controlled.administer, so
  // every OTHER gated action of the integration stays held and the plan honestly
  // remains in step_up mode. Before the fix, one gesture released them all.
  check("...and the integration's OTHER gated actions stay held (scoped, not integration-wide)",
    completed.json?.plan?.actions?.find((a) => a.key === "dose.override")?.disposition === "step_up" &&
    completed.json?.plan?.actions?.find((a) => a.key === "witness.cosign")?.disposition === "step_up" &&
    completed.json?.plan?.mode === "step_up");
  check("completion reports the webauthn method + credential", completed.json?.stepUp?.method === "webauthn" && typeof completed.json?.stepUp?.credentialId === "string");

  // Replay: the same challenge is single-use.
  const replay = await req("POST", "/v1/app-workflows/complete-step-up", {
    token: KEYS.operator,
    body: {
      integrationId: "bcma", identityRef: suIdentity, deviceRef: suDevice, actionKey: "controlled.administer",
      challengeId: chalGood.json.challengeId, assertion: goodAssertion,
    },
  });
  check("replayed challenge → 403 (single-use)", replay.status === 403);

  // Cross-tenant isolation: the credential lives under northwind's tenant key;
  // another tenant's token sees no enrollment at all.
  const stepUpCrossTenant = await req("POST", "/v1/step-up/challenge", {
    token: KEYS.atlas, body: { identityRef: suIdentity, integrationId: "bcma", deviceRef: suDevice, actionKey: "controlled.administer" },
  });
  check("step-up credentials are tenant-scoped (other tenant → 409)", stepUpCrossTenant.status === 409);

  // ── out-of-band enrollment authorization (secret-configured mode) ────────
  // The block above proved the DEMO mode honest. This proves the REAL mode closed:
  // with SIGNALGRID_ENROLLMENT_SECRET configured, a published demo owner token alone
  // must no longer authorize enrollment — the x-enrollment-authorization header must
  // carry the secret (which /v1/keys does not publish), and the role gate still holds
  // independently. Runs against a second, short-lived server so the main server's
  // self-service coverage above is untouched.
  {
    const PORT2 = 5311;
    const BASE2 = `http://localhost:${PORT2}/api`;
    const SECRET = "test-out-of-band-enrollment-secret";
    const server2 = spawn("node", [serverEntry], {
      env: { ...process.env, PORT: String(PORT2), NODE_ENV: "production", LOG_LEVEL: "silent", SIGNALGRID_ENROLLMENT_SECRET: SECRET, CORS_ALLOWED_ORIGINS: "http://console.example" },
      stdio: ["ignore", "ignore", "inherit"],
    });
    try {
      let ready2 = false;
      const start2 = Date.now();
      while (Date.now() - start2 < 15000) {
        try { if ((await fetch(`${BASE2}/healthz`)).ok) { ready2 = true; break; } } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      check("secret-mode server becomes ready", ready2 === true);
      const enroll2 = async (headers) => {
        const res = await fetch(`${BASE2}/v1/step-up/enroll/options`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify({ identityRef: suIdentity }),
        });
        let json = null;
        try { json = await res.json(); } catch { json = null; }
        return { status: res.status, json };
      };
      const ownerAuth = { authorization: `Bearer ${KEYS.owner}` };
      const noHeader = await enroll2(ownerAuth);
      check("secret mode: published owner token WITHOUT the out-of-band header → 403 (self-service closed)", noHeader.status === 403);
      const wrongHeader = await enroll2({ ...ownerAuth, "x-enrollment-authorization": "guess" });
      check("secret mode: wrong out-of-band value → 403 (fail closed)", wrongHeader.status === 403);
      const rightHeader = await enroll2({ ...ownerAuth, "x-enrollment-authorization": SECRET });
      check("secret mode: owner token + correct out-of-band header → 200", rightHeader.status === 200 && typeof rightHeader.json?.challengeId === "string");
      check("secret mode: the self-service demo note is ABSENT (no longer self-service)", rightHeader.json?.demoNote === undefined);
      const auditorWithSecret = await enroll2({ authorization: `Bearer ${KEYS.auditor}`, "x-enrollment-authorization": SECRET });
      check("secret mode: the secret does not override the role gate (auditor still 403)", auditorWithSecret.status === 403);
      // Cross-origin flow (review finding): a browser console on an allowed origin
      // sends a CORS preflight naming x-enrollment-authorization. If the CORS
      // allowedHeaders list omits it, the browser blocks every correctly-authorized
      // enrollment BEFORE the server-side check can run. server2 was spawned with an
      // allowed origin, so the preflight must echo the header back.
      const preflight = await fetch(`${BASE2}/v1/step-up/enroll/options`, {
        method: "OPTIONS",
        headers: {
          origin: "http://console.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization,content-type,x-enrollment-authorization",
        },
      });
      const allowedHdrs = (preflight.headers.get("access-control-allow-headers") ?? "").toLowerCase();
      check("secret mode: CORS preflight permits x-enrollment-authorization for an allowed origin", preflight.headers.get("access-control-allow-origin") === "http://console.example" && allowedHdrs.includes("x-enrollment-authorization"));
    } finally {
      server2.kill("SIGTERM");
    }
  }

  // ── store unavailability is an error, never an empty credential set ──────
  // (Review finding.) With Redis CONFIGURED but unreachable, getUser used to
  // swallow the failure into the same `null` that means "this user has no
  // credentials" — so /v1/step-up/challenge answered a definitive 409 "no
  // enrolled credential" from a FAILED read, and an enrollment racing a Redis
  // blip could rebuild the user with only the new credential, silently wiping
  // every previously enrolled one once Redis recovered. The read failure must
  // propagate: a 5xx, and specifically NEVER the 409 that asserts an empty
  // credential set it could not actually observe. Third short-lived server so
  // the main (no-Redis) coverage above is untouched.
  {
    const PORT3 = 5312;
    const BASE3 = `http://localhost:${PORT3}/api`;
    const server3 = spawn("node", [serverEntry], {
      env: { ...process.env, PORT: String(PORT3), NODE_ENV: "production", LOG_LEVEL: "silent", REDIS_URL: "redis://127.0.0.1:1" },
      stdio: ["ignore", "ignore", "inherit"],
    });
    try {
      let ready3 = false;
      const start3 = Date.now();
      while (Date.now() - start3 < 15000) {
        try { if ((await fetch(`${BASE3}/healthz`)).ok) { ready3 = true; break; } } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      check("redis-down server becomes ready", ready3 === true);
      const res3 = await fetch(`${BASE3}/v1/step-up/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${KEYS.owner}` },
        body: JSON.stringify({ identityRef: suIdentity, integrationId: "bcma", deviceRef: suDevice, actionKey: "controlled.administer" }),
      });
      check("unreachable credential store → 5xx, never 409's definitive 'no enrolled credential'", res3.status >= 500);
    } finally {
      server3.kill("SIGTERM");
    }
  }

  // ── PRODUCT PROFILE: the gateway must refuse what the demo publishes ─────
  //
  // Everything above runs in the DEFAULT (review-demo) profile, and asserts the demo
  // surfaces work — including that /v1/keys is public. That is correct for a public
  // review deployment and it is the half a production switch could silently break, so
  // it stays exactly as it was.
  //
  // What was missing is the other half. An audit found /v1/keys registered ABOVE the
  // auth guard, publishing the RAW owner bearer for all seven seeded tenants to
  // anonymous callers — and THIS SUITE asserted that as correct while spawning the
  // server with NODE_ENV=production. The suite did not miss the leak; it certified it.
  // NODE_ENV was never the signal: it says how Node should behave, not whether a
  // customer is on the other end.
  //
  // Fourth short-lived server, in the gateway profile, so the demo coverage above is
  // untouched and both halves are proven in one run.
  {
    const PORT4 = 5313;
    const BASE4 = `http://localhost:${PORT4}/api`;
    const server4 = spawn("node", [serverEntry], {
      env: {
        ...process.env,
        PORT: String(PORT4),
        NODE_ENV: "production",
        LOG_LEVEL: "silent",
        SIGNALGRID_PRODUCT_PROFILE: "shared-device-gateway",
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    try {
      let ready4 = false;
      const start4 = Date.now();
      while (Date.now() - start4 < 15000) {
        try { if ((await fetch(`${BASE4}/healthz`)).ok) { ready4 = true; break; } } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      check("gateway-profile server becomes ready (the profile does not break boot)", ready4 === true);

      // 401, not 404, and the difference is worth stating: with the route unregistered
      // the path falls under the `/v1` auth guard like every other /v1 path, so it now
      // DEMANDS a credential instead of handing one out. Combined with the demo-bearer
      // refusal below, there is no token that satisfies it.
      const gwKeys = await fetch(`${BASE4}/v1/keys`);
      check("gateway: /v1/keys no longer publishes bearers — it demands one (401)", gwKeys.status === 401);

      const gwSim = await fetch(`${BASE4}/sim/room-entry`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId: "compliant-bedside" }),
      });
      check("gateway: the unauthenticated simulator is NOT mounted (no anonymous write path)", gwSim.status === 404);

      const gwCp = await fetch(`${BASE4}/cp/v1/tenants`);
      check("gateway: the unauthenticated control plane is NOT mounted (no tenant roster)", gwCp.status === 404);

      const gwDemoToken = await fetch(`${BASE4}/v1/context`, {
        headers: { authorization: `Bearer ${KEYS.owner}` },
      });
      check("gateway: a demo bearer is refused — no fallback to fixture credentials", gwDemoToken.status === 401);

      // NON-VACUITY. Every check above asserts an ABSENCE, and a server that failed to
      // boot, or a wrong base URL, would satisfy all of them. Something must still be
      // served, or these prove nothing.
      const gwHealth = await fetch(`${BASE4}/healthz`);
      check("gateway: the server is genuinely up — the 404s above are refusals, not a dead port",
        gwHealth.status === 200);
    } finally {
      server4.kill("SIGTERM");
    }
  }

  // ── transport hygiene ───────────────────────────────────────────────────
  check("rate-limit headers present", allow.headers.get("ratelimit-limit") !== null);
  check("security header x-content-type-options set", allow.headers.get("x-content-type-options") === "nosniff");
  check("framework header x-powered-by is not disclosed", allow.headers.get("x-powered-by") === null);
  check("request id echoed", typeof allow.headers.get("x-request-id") === "string");
}

async function main() {
  const server = spawn("node", [serverEntry], {
    env: { ...process.env, PORT: String(PORT), NODE_ENV: "production", LOG_LEVEL: "silent" },
    stdio: ["ignore", "ignore", "inherit"],
  });

  let exitCode = 0;
  try {
    const ready = await waitForReady();
    if (!ready) {
      console.error("API server did not become ready in time.");
      process.exitCode = 1;
      return;
    }
    await run();
    const total = passed + failures.length;
    console.log(`API integration test: ${passed}/${total} assertions passed`);
    if (failures.length > 0) {
      console.error("Failed assertions:");
      for (const f of failures) console.error(`- ${f}`);
      exitCode = 1;
    } else {
      console.log("All /v1 API behaviours verified.");
    }
  } catch (err) {
    console.error("API integration test crashed:", err);
    exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

await main();
