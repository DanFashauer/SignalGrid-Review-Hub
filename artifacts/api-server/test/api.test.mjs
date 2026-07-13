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
