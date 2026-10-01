// Smoke test for a RUNNING SignalGrid stack (API + durable Postgres).
//
// Dependency-free (uses Node's global fetch). Points at BASE_URL (default
// http://localhost:8080) and proves the packaged, durable deployment actually
// works end to end: it evaluates a real decision, reads it back FROM the durable
// store, and confirms the operational metrics endpoint reflects the traffic.
//
//   BASE_URL=http://localhost:8080 node scripts/smoke-stack.mjs
//
// Used by the `deploy-stack` CI job after `docker compose -f
// docker-compose.prod.yml up` — but it works against any running stack, so the
// exact assertions can be validated against a local server + Postgres too.

const BASE = (process.env.BASE_URL ?? "http://localhost:8080").replace(/\/$/, "");
const API = `${BASE}/api`;
const TOKEN = "sgk_demo_northwind_operator";

let passed = 0;
const failures = [];
const check = (name, ok) => { ok ? (passed += 1) : failures.push(name); };

async function main() {
  // ── health ──────────────────────────────────────────────────────────────────
  const health = await (await fetch(`${API}/healthz`)).json();
  check("healthz is ok", health.status === "ok");
  // Fixture-safe by default even at prod tier: no live vendor calls.
  check("live integrations are OFF by default", health.liveIntegrations === false);

  // ── which profile is this stack actually serving? ───────────────────────────
  // Probed, not assumed: /v1/keys exists ONLY under review-demo. Under the
  // shared-device-gateway profile this suite asserts THE FENCE — the exact
  // leak measured before the compose file set the profile (an anonymous
  // caller received nine demo bearers, a tenant owner among them) — and skips
  // the demo-credential flow LOUDLY, because no credential can exist here:
  // the gateway profile accepts only verified enterprise credentials.
  const keysProbe = await fetch(`${API}/v1/keys`);
  const servedProfile = keysProbe.status === 200 ? "review-demo" : "shared-device-gateway";
  // SMOKE_EXPECT_PROFILE pins the phase's intent: a CI step labeled "gateway
  // fence" must FAIL if the stack quietly serves review-demo (a compose or
  // workflow regression), not run the other branch green.
  const expected = (process.env.SMOKE_EXPECT_PROFILE ?? "").trim();
  if (expected && expected !== servedProfile) {
    console.error(`Stack smoke: expected profile "${expected}" but the stack serves "${servedProfile}" — failing before any branch runs.`);
    process.exit(1);
  }
  if (keysProbe.status !== 200) {
    check("gateway fence: /v1/keys is NOT served (was the credential dispenser)", keysProbe.status === 404);
    const sim = await fetch(`${API}/sim/room-entry`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check("gateway fence: the unauthenticated simulator is NOT mounted", sim.status === 404);
    const demoEval = await fetch(`${API}/v1/decisions/evaluate`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" }),
    });
    check("gateway fence: a demo bearer is REFUSED as a credential (401)", demoEval.status === 401);
    // 200 REQUIRED, not merely answered: /readyz is the probe that exercises
    // the durable store with the running credential, and a production-shaped
    // instance answering 503 is explicitly saying "do not send me traffic" —
    // a smoke that passes anyway certifies a stack that refuses work.
    const ready = await fetch(`${API}/readyz`);
    check("readyz reports READY (200) — the gateway can reach its durable store", ready.status === 200);
    // THE POSITIVE PATH, on the packaged image. When the phase boots with the
    // CI fixture IdP (scripts/fixture-idp.compose.yml) SMOKE_IDP_URL points at its
    // /mint endpoint's host. A token signed by the fixture's runtime key, with
    // claims the OIDC_*_MAP variables map, must complete an allowed /v1
    // request as the MAPPED tenant — and the same key must still be refused
    // when the audience is wrong, the token is expired, or the role is not in
    // the map (otherwise the 200 above could be vacuous: an api that accepted
    // anything would pass it).
    const idpUrl = (process.env.SMOKE_IDP_URL ?? "").trim().replace(/\/$/, "");
    if (idpUrl) {
      await oidcPositivePath(idpUrl);
    } else {
      console.log("  NOTE: SMOKE_IDP_URL unset — the signed-token positive path was NOT exercised in this run.");
    }
    console.log("  NOTE: gateway profile detected — demo-credential flow NOT RUN (no credential can exist here); the review-demo pass covers it.");
    return finishSmoke();
  }

  // ── evaluate a real decision (write-through to durable store) ────────────────
  const evalRes = await fetch(`${API}/v1/decisions/evaluate`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" }),
  });
  check("evaluate returns 200", evalRes.status === 200);
  const decision = (await evalRes.json()).decision;
  check("decision outcome is allow", decision?.outcome === "allow");

  // ── read it back FROM the durable store ──────────────────────────────────────
  const getRes = await fetch(`${API}/v1/decisions/${decision.decisionId}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  check("the persisted decision reads back (200)", getRes.status === 200);
  const stored = (await getRes.json()).decision;
  check("stored decision id matches", stored?.id === decision.decisionId);

  // ── evidence verifies from the durable record ────────────────────────────────
  const evRes = await fetch(`${API}/v1/decisions/${decision.decisionId}/evidence`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  check("evidence endpoint returns 200", evRes.status === 200);
  check("evidence snapshot verifies (tamper-evident)", (await evRes.json()).verified === true);

  // ── cross-tenant isolation still holds on the deployed stack ─────────────────
  const crossRes = await fetch(`${API}/v1/decisions/${decision.decisionId}`, {
    headers: { authorization: `Bearer sgk_demo_atlas_owner` },
  });
  check("cross-tenant read is denied (404)", crossRes.status === 404);

  // ── operational metrics reflect the traffic ──────────────────────────────────
  // A stack with METRICS_TOKEN set protects /metrics with a bearer; a bare
  // fetch would 401 and fail all three assertions on a correctly-secured
  // stack, so pass the token through when the environment has it.
  const metricsHeaders = process.env.METRICS_TOKEN
    ? { authorization: `Bearer ${process.env.METRICS_TOKEN}` }
    : {};
  const metrics = await (await fetch(`${BASE}/metrics`, { headers: metricsHeaders })).text();
  check("metrics: process is up", /(^|\n)signalgrid_up 1/.test(metrics));
  check("metrics: an allow decision was counted",
    /signalgrid_decisions_total\{outcome="allow"\} [1-9]/.test(metrics));
  check("metrics: request counter present", metrics.includes("signalgrid_http_requests_total"));

  finishSmoke();
}

async function mintToken(idpUrl, kind) {
  const res = await fetch(`${idpUrl}/mint?kind=${kind}`);
  if (!res.ok) throw new Error(`fixture IdP /mint?kind=${kind} answered ${res.status}`);
  return (await res.json()).token;
}

async function evaluateWith(token) {
  return fetch(`${API}/v1/decisions/evaluate`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" }),
  });
}

async function oidcPositivePath(idpUrl) {
  const expectedTenant = (process.env.SMOKE_EXPECT_TENANT ?? "tenant_northwind").trim();
  const ok = await evaluateWith(await mintToken(idpUrl, "valid"));
  check("oidc positive: a fixture-signed, mapped token completes /v1/decisions/evaluate (200)", ok.status === 200);
  if (ok.status === 200) {
    const decisionId = (await ok.json()).decision?.decisionId;
    check("oidc positive: the evaluation returned a decision id", typeof decisionId === "string" && decisionId.length > 0);
    // The mapped (INTERNAL) tenant, not the IdP's: /v1/context echoes the
    // tenant the principal resolved to.
    const ctx = await fetch(`${API}/v1/context`, { headers: { authorization: `Bearer ${await mintToken(idpUrl, "valid")}` } });
    const body = ctx.status === 200 ? await ctx.json() : null;
    check(`oidc positive: the token resolves to the mapped tenant ${expectedTenant}`, body?.tenant?.id === expectedTenant);
  }
  // Each control must be refused FOR ITS OWN REASON. A bare 401 is satisfied by
  // any broken token (a fixture that mints a malformed or wrongly signed
  // "expired" token would pass), so the gateway's message is pinned per kind.
  const refusals = {
    "wrong-audience": /audience mismatch/,
    "expired": /token has expired/,
    "unmapped-role": /no role claim value in \[ci-role-intruder\] maps to a known role/,
  };
  for (const [kind, reason] of Object.entries(refusals)) {
    const res = await evaluateWith(await mintToken(idpUrl, kind));
    const message = res.status === 401 ? String((await res.json().catch(() => ({}))).message ?? "") : "";
    check(`oidc negative control: a ${kind} token signed by the same key is REFUSED (401) for its own reason`, res.status === 401 && reason.test(message));
  }
}

function finishSmoke() {
  const total = passed + failures.length;
  console.log(`Stack smoke: ${passed}/${total} checks passed (BASE=${BASE})`);
  if (failures.length) {
    console.error("Failed checks:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("Deployed stack verified for the profile it serves.");
}

main().catch((err) => { console.error("Smoke test error:", err.message); process.exit(1); });
