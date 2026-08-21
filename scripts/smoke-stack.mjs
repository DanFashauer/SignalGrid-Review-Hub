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
    const ready = await fetch(`${API}/readyz`);
    check("readyz answers under the gateway profile", ready.status === 200 || ready.status === 503);
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
  const metrics = await (await fetch(`${BASE}/metrics`)).text();
  check("metrics: process is up", /(^|\n)signalgrid_up 1/.test(metrics));
  check("metrics: an allow decision was counted",
    /signalgrid_decisions_total\{outcome="allow"\} [1-9]/.test(metrics));
  check("metrics: request counter present", metrics.includes("signalgrid_http_requests_total"));

  finishSmoke();
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
