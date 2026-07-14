/**
 * SignalGrid legacy DB-route integration test.
 *
 * Exercises the DATABASE_URL-gated legacy routers (decisions / metrics /
 * policies / signals) against a real Postgres — the surface the pure `/v1`
 * integration test cannot reach because those routers only mount when
 * DATABASE_URL is set. It proves the two things that mattered most in the
 * hardening pass:
 *   1. the routers are fail-closed — every one requires a bearer context, so a
 *      DATABASE_URL deployment never exposes an anonymous read/write surface;
 *   2. the list routes filter in SQL BEFORE the LIMIT and report a real COUNT
 *      (a page-size "total" or post-LIMIT filtering would be a wrong result).
 * Also confirms the limit clamp holds and that /v1 still works alongside.
 *
 * Requires DATABASE_URL (Postgres) and the schema already pushed. Skips cleanly
 * (exit 0) when DATABASE_URL is unset, so the default `pnpm test` is unaffected.
 *
 * Run: `DATABASE_URL=postgres://… pnpm --filter @workspace/api-server run test:api-db`
 */
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log("db integration test: SKIPPED (DATABASE_URL not set).");
  process.exit(0);
}

const PORT = 5411;
const BASE = `http://localhost:${PORT}/api`;
const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.mjs");
const OWNER = "sgk_demo_northwind_owner";

let passed = 0;
const failures = [];
function check(name, ok) {
  if (ok) passed += 1;
  else failures.push(name);
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
  return { status: res.status, json };
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

// Seed a deterministic set: many `deny` decisions + one recent `allow`, so a
// filtered+limited query would return the wrong result under the old post-LIMIT
// filtering (the recent allow would fill the window and denies would be dropped).
// Seeded via the `psql` client (present locally and on GitHub runners) so the
// test needs no extra node dependency.
const DENY_COUNT = 12;
function seed() {
  const rows = [];
  for (let i = 0; i < DENY_COUNT; i++) {
    rows.push(
      `('dbtest-deny-${i}','dbtest.user','dbtest.device','dbtest.workflow','deny', now() - interval '${i + 5} minutes', 10)`,
    );
  }
  // One allow, most recent, so it sits at the top of the desc(evaluated_at) window.
  rows.push(
    `('dbtest-allow-0','dbtest.user','dbtest.device','dbtest.workflow','allow', now(), 10)`,
  );
  const sql =
    "DELETE FROM decisions WHERE identity_id = 'dbtest.user';\n" +
    "INSERT INTO decisions (id, identity_id, device_id, workflow_id, outcome, evaluated_at, latency_ms) VALUES\n" +
    rows.join(",\n") +
    ";";
  execFileSync("psql", [DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], {
    stdio: ["ignore", "ignore", "inherit"],
  });
}

async function run() {
  // ── auth gate: every legacy route is fail-closed ────────────────────────
  for (const path of ["/decisions", "/metrics/dashboard", "/policies", "/signals/latest"]) {
    const anon = await req("GET", path);
    check(`legacy GET ${path} without bearer → 401`, anon.status === 401);
    const authed = await req("GET", path, { token: OWNER });
    check(`legacy GET ${path} with bearer → 200`, authed.status === 200);
  }
  // Write routes must also be gated.
  const anonIngest = await req("POST", "/signals/ingest", { body: { signalType: "identity", platform: "okta", deviceId: "d", value: {} } });
  check("legacy POST /signals/ingest without bearer → 401", anonIngest.status === 401);
  const anonPut = await req("PUT", "/policies/whatever", { body: {} });
  check("legacy PUT /policies/:id without bearer → 401", anonPut.status === 401);
  const anonDelete = await req("DELETE", "/policies/whatever");
  check("legacy DELETE /policies/:id without bearer → 401", anonDelete.status === 401);

  // ── filter-before-limit + real total (the wrong-result fix) ─────────────
  const denyPage = await req("GET", "/decisions?outcome=deny&limit=1", { token: OWNER });
  check("filtered list honours the limit (1 row)", Array.isArray(denyPage.json?.decisions) && denyPage.json.decisions.length === 1);
  check("filtered row actually matches the predicate", denyPage.json?.decisions?.[0]?.outcome === "deny");
  check("total is a real COUNT, not the page size", denyPage.json?.total >= DENY_COUNT);

  // ── limit clamp holds against a crafted value ───────────────────────────
  const huge = await req("GET", "/decisions?limit=100000000", { token: OWNER });
  check("crafted ?limit=1e8 is clamped, not a crash", huge.status === 200 && Array.isArray(huge.json?.decisions));
  const negative = await req("GET", "/decisions?limit=-5", { token: OWNER });
  check("negative ?limit is clamped, not an invalid SQL LIMIT", negative.status === 200);

  // ── signals round-trip (authed write then read) ─────────────────────────
  const ingest = await req("POST", "/signals/ingest", { token: OWNER, body: { signalType: "device-posture", platform: "intune", deviceId: "dbtest.device", value: { complianceStatus: "Compliant" } } });
  check("authed signal ingest → 202", ingest.status === 202 && ingest.json?.accepted === true);
  const latest = await req("GET", "/signals/latest?signalType=device-posture&limit=5", { token: OWNER });
  check("authed signals/latest → 200 and filtered", latest.status === 200 && (latest.json?.signals ?? []).every((s) => s.signalType === "device-posture"));

  // ── /v1 coexists with the DB routers ────────────────────────────────────
  const v1 = await req("GET", "/v1/keys");
  check("/v1 surface still public alongside DB routers", v1.status === 200);
}

async function main() {
  seed();
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
    console.log(`DB integration test: ${passed}/${total} assertions passed`);
    if (failures.length > 0) {
      console.error("Failed assertions:");
      for (const f of failures) console.error(`- ${f}`);
      exitCode = 1;
    } else {
      console.log("All legacy DB-route behaviours verified.");
    }
  } catch (err) {
    console.error("DB integration test crashed:", err);
    exitCode = 1;
  } finally {
    server.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

await main();
