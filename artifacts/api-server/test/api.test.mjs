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
  check("keys lists the four demo keys", Array.isArray(keys.json?.keys) && keys.json.keys.length === 4);

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

  const scenarios = await req("GET", "/simulator/scenarios");
  check("simulator scenarios → 200", scenarios.status === 200 && Array.isArray(scenarios.json?.scenarios));
  const simRun = await req("POST", "/simulator/run", { body: { scenarioId: (scenarios.json?.scenarios ?? [])[0]?.id } });
  check("simulator run → 200 with audit evidence", simRun.status === 200 && Array.isArray(simRun.json?.auditEvidence));
  const simBad = await req("POST", "/simulator/run", { body: {} });
  check("simulator run without scenarioId → 400", simBad.status === 400);
  const simReset = await req("POST", "/simulator/reset", { body: {} });
  check("simulator reset → 200", simReset.status === 200 && Array.isArray(simReset.json?.auditEvidence));

  // ── legacy DB routes are gated: 503 when DATABASE_URL is unset ────────────
  // (This server runs without DATABASE_URL, so the legacy decisions/metrics/
  // policies/signals routers are replaced by the database-unavailable handler.
  // When DATABASE_URL IS set, those routers sit behind requireTenantContext —
  // see routes/index.ts — so they are never anonymously reachable.)
  for (const path of ["/decisions", "/metrics/dashboard", "/policies", "/signals/latest"]) {
    const legacy = await req("GET", path);
    check(`legacy ${path} without DATABASE_URL → 503`, legacy.status === 503 && legacy.json?.error === "database_unavailable");
  }

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
