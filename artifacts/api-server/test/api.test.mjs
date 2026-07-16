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

async function run() {
  // ── health + discovery ──────────────────────────────────────────────────
  const health = await req("GET", "/healthz");
  check("healthz returns 200 ok", health.status === 200 && health.json?.status === "ok");

  const keys = await req("GET", "/v1/keys");
  check("keys discovery is public (200)", keys.status === 200);
  check("keys lists the seven demo keys", Array.isArray(keys.json?.keys) && keys.json.keys.length === 7);

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
  check("signal catalog → 200 with 12 evaluated categories", catalog.status === 200 && catalog.json?.evaluated?.length === 12);
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
