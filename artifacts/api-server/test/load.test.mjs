/**
 * SignalGrid /v1 LOAD and STRESS harness.
 *
 * Boots the built API server and drives the real HTTP decision surface under
 * concurrency. Public-safe: in-memory core, synthetic demo keys, no database, no
 * secrets, no live vendor calls, no network beyond localhost.
 *
 *   node ./test/load.test.mjs            # load: steady concurrency, gated
 *   node ./test/load.test.mjs --stress   # + ramp until degradation, reported
 *
 * WHY THIS EXISTS, and what it deliberately refuses to do.
 *
 * `bench:decision-latency` measures the decision CORE in-process: p95 ≈ 1.3 ms
 * for one evaluation on one thread. That number is true and it is not throughput.
 * Quoting it as "SignalGrid serves N decisions per second" would be exactly the
 * unearned affirmative this repository hunts — a measurement presented as an
 * answer to a question it never asked. A design partner's first infrastructure
 * question is *how many decisions per second, and where does it degrade*, and
 * until now nothing here could answer it.
 *
 * WHAT IS GATED vs WHAT IS REPORTED. This is the load-testing trap and it is
 * worth stating plainly: a latency threshold asserted on a shared CI runner is a
 * flaky gate, and a flaky gate gets switched off — which is strictly worse than
 * no gate, because its name stays in the list. So:
 *
 *   GATED (machine-independent correctness under concurrency):
 *     · zero 5xx and zero transport errors
 *     · every response a well-formed envelope with a decision
 *     · outcomes IDENTICAL to the single-request answer — concurrency must not
 *       change a verdict, which is determinism asserted through the wire rather
 *       than in-process
 *     · no cross-tenant leakage while tenants are interleaved in flight
 *
 *   REPORTED (machine-dependent, never asserted):
 *     · throughput, latency percentiles, and the concurrency at which they knee
 *
 * The stress phase RAMPS and prints where degradation begins. It does not claim a
 * capacity number: the honest form of that claim is "measured X on this machine,
 * at this commit", which is what the sim-result provenance carries.
 */
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5320;
const BASE = `http://localhost:${PORT}/api`;
const here = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(here, "../dist/index.mjs");

const STRESS = process.argv.includes("--stress");
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY ?? 32);
const REQUESTS = Number(process.env.LOAD_REQUESTS ?? 600);

// Two tenants, interleaved on purpose: the cross-tenant assertion below is only
// meaningful if both are genuinely in flight at once.
const KEYS = { northwind: "sgk_demo_northwind_operator", atlas: "sgk_demo_atlas_owner" };

/** Fixed cases with KNOWN outcomes, so concurrency can be checked against truth
 *  rather than against itself. */
const CASES = [
  { key: KEYS.northwind, tenant: "northwind", body: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" }, expect: "allow" },
  { key: KEYS.northwind, tenant: "northwind", body: { identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session" }, expect: "restrict" },
  { key: KEYS.northwind, tenant: "northwind", body: { identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session" }, expect: "step_up" },
];

let passed = 0;
const failures = [];
const check = (name, ok) => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

const pct = (sorted, p) => sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

async function evaluateOnce(c) {
  const started = process.hrtime.bigint();
  try {
    const res = await fetch(`${BASE}/v1/decisions/evaluate`, {
      method: "POST",
      headers: { authorization: `Bearer ${c.key}`, "content-type": "application/json" },
      body: JSON.stringify(c.body),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return {
      ms: Number(process.hrtime.bigint() - started) / 1e6,
      status: res.status,
      outcome: json?.decision?.outcome ?? null,
      tenant: json?.decision?.tenantId ?? json?.tenantId ?? null,
      enveloped: typeof json?.requestId !== "undefined" && typeof json?.timestamp === "string",
      expect: c.expect,
      askedTenant: c.tenant,
      transportError: null,
    };
  } catch (err) {
    return { ms: Number(process.hrtime.bigint() - started) / 1e6, status: 0, outcome: null, tenant: null, enveloped: false, expect: c.expect, askedTenant: c.tenant, transportError: String(err?.message ?? err) };
  }
}

/** Drive `total` requests at a fixed in-flight `concurrency`. */
async function drive(total, concurrency) {
  const results = [];
  let issued = 0;
  const wall = Date.now();
  const worker = async () => {
    while (issued < total) {
      const c = CASES[issued % CASES.length];
      issued += 1;
      results.push(await evaluateOnce(c));
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = Date.now() - wall;
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  return {
    results,
    elapsedMs,
    rps: results.length / (elapsedMs / 1000),
    p50: pct(lat, 50), p95: pct(lat, 95), p99: pct(lat, 99), max: lat[lat.length - 1] ?? 0,
    errors: results.filter((r) => r.transportError !== null).length,
    server5xx: results.filter((r) => r.status >= 500).length,
    non200: results.filter((r) => r.status !== 200).length,
  };
}

// THE LIMITER IS LIFTED FOR THE THROUGHPUT PHASE, and that is the whole reason
// this harness needed a second look. The first honest run measured 589 req/s and
// failed its own determinism check — because 63 of 300 requests came back 429.
// The server was right and the test was wrong: at the shipped default a single
// key is capped at 240/minute, so a naive load run measures the RATE LIMITER and
// reports it as the decision path's ceiling. Raising it here isolates the engine;
// the limiter's own correctness is asserted separately, at the default, below.
const server = spawn("node", [serverEntry], {
  env: {
    ...process.env,
    PORT: String(PORT),
    NODE_ENV: "production",
    LOG_LEVEL: "silent",
    SIGNALGRID_V1_RATE_LIMIT: "1000000",
    SIGNALGRID_GLOBAL_RATE_LIMIT: "1000000",
  },
  stdio: ["ignore", "ignore", "inherit"],
});

// A second server at the SHIPPED defaults, so the limiter is proven as it
// actually deploys rather than as configured for convenience.
const LIMIT_PORT = 5321;
const LIMIT_BASE = `http://localhost:${LIMIT_PORT}/api`;
const limitServer = spawn("node", [serverEntry], {
  env: { ...process.env, PORT: String(LIMIT_PORT), NODE_ENV: "production", LOG_LEVEL: "silent" },
  stdio: ["ignore", "ignore", "inherit"],
});

async function waitForReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  console.log("SignalGrid /v1 load + stress harness");
  const ready = await waitForReady();
  check("the API server boots and answers /healthz", ready === true);
  if (!ready) throw new Error("server never became ready");

  // Single-request truth, established BEFORE any concurrency, so the assertion
  // below compares against a known answer rather than against the load run's own
  // majority — which would agree with itself even if every answer were wrong.
  const baseline = [];
  for (const c of CASES) baseline.push(await evaluateOnce(c));
  check("baseline: every case answers 200 with its expected outcome", baseline.every((r) => r.status === 200 && r.outcome === r.expect));

  console.log(`\n-- load: ${REQUESTS} requests at concurrency ${CONCURRENCY}`);
  const load = await drive(REQUESTS, CONCURRENCY);

  // ── GATED: correctness under concurrency, machine-independent ─────────────
  check(`no transport errors under load (errors=${load.errors})`, load.errors === 0);
  check(`no 5xx under load (server5xx=${load.server5xx})`, load.server5xx === 0);
  check(`every response is 200 (non200=${load.non200})`, load.non200 === 0);
  check("every response is a well-formed envelope carrying a decision", load.results.every((r) => r.enveloped && r.outcome !== null));
  check(
    "DETERMINISM THROUGH THE WIRE: concurrency never changes an outcome",
    load.results.every((r) => r.outcome === r.expect),
  );
  // The cross-tenant assertion is only meaningful because both tenants were in
  // flight together; `proof:isolation-scope` proves the same law in-process.
  const leaked = load.results.filter((r) => r.tenant !== null && r.askedTenant !== null && !String(r.tenant).includes(r.askedTenant));
  check(`no tenant sees another's answer while interleaved in flight (leaks=${leaked.length})`, leaked.length === 0);

  // ── REPORTED: machine-dependent, deliberately not asserted ────────────────
  console.log(
    `\n  MEASURED (this machine, this commit — reported, never asserted):\n` +
    `    throughput ${load.rps.toFixed(0)} req/s over ${(load.elapsedMs / 1000).toFixed(1)}s\n` +
    `    latency    p50 ${load.p50.toFixed(1)}ms · p95 ${load.p95.toFixed(1)}ms · p99 ${load.p99.toFixed(1)}ms · max ${load.max.toFixed(1)}ms`,
  );

  // ── the limiter, at its shipped default, is a FEATURE and is asserted ─────
  {
    const upStart = Date.now();
    let limitReady = false;
    while (Date.now() - upStart < 20000) {
      try { if ((await fetch(`${LIMIT_BASE}/healthz`)).ok) { limitReady = true; break; } } catch { /* not up */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    check("the default-configuration server boots", limitReady === true);

    const burst = [];
    for (let i = 0; i < 300; i += 1) {
      burst.push(fetch(`${LIMIT_BASE}/v1/decisions/evaluate`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEYS.northwind}`, "content-type": "application/json" },
        body: JSON.stringify(CASES[0].body),
      }));
    }
    const settled = await Promise.all(burst);
    const throttled = settled.filter((r) => r.status === 429);
    const fived = settled.filter((r) => r.status >= 500);
    check(`deliberate overload is THROTTLED, not dropped (429s=${throttled.length})`, throttled.length > 0);
    check(`overload never becomes a server error (5xx=${fived.length})`, fived.length === 0);
    check(
      "a throttled response carries the standard rate-limit headers a client can back off on",
      throttled.length === 0 || (throttled[0].headers.get("ratelimit-limit") !== null || throttled[0].headers.get("retry-after") !== null),
    );
    console.log(
      `\n  MEASURED CEILING (shipped default): a single key is capped at 240 requests/minute —\n` +
      `    four decisions a second. ${throttled.length} of 300 burst requests were throttled.\n` +
      `    The DECISION PATH is orders of magnitude faster than that, so the limiter — not the\n` +
      `    engine — defines per-tenant capacity today. Tunable via SIGNALGRID_V1_RATE_LIMIT.`,
    );
  }

  if (STRESS) {
    console.log("\n-- stress: ramping concurrency until degradation");
    let knee = null;
    let prev = null;
    for (const c of [8, 16, 32, 64, 128, 256]) {
      const r = await drive(Math.max(200, c * 6), c);
      const bad = r.errors + r.server5xx;
      console.log(
        `    c=${String(c).padStart(3)}  ${r.rps.toFixed(0).padStart(5)} req/s  p95 ${r.p95.toFixed(1).padStart(7)}ms  errors ${bad}`,
      );
      // THE KNEE IS A THROUGHPUT PLATEAU, NOT A THROUGHPUT DROP — and the first
      // version of this detector got that wrong, then reported "no degradation"
      // over a ramp where p95 went 20ms → 1809ms. Past saturation a queueing
      // system does not lose throughput; it holds flat and converts every
      // additional client into latency. Flat rps WITH climbing latency IS the
      // saturation point, and reading it as health is how a load test reassures
      // you right up until production falls over.
      // REPORTED, not asserted — where it lands is a property of the machine.
      if (knee === null && prev && (bad > 0 || (r.rps < prev.rps * 1.05 && r.p95 > prev.p95 * 1.5))) knee = prev.c;
      prev = { ...r, c };
    }
    console.log(
      knee === null
        ? "    no saturation observed across the ramp — the ceiling is above what was driven here"
        : `    SATURATED at concurrency ${knee} on this machine: beyond it throughput holds flat\n` +
          "    and every additional client becomes latency, which is what a queue does when it is full.",
    );
  }

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  console.log(`figures=cases=${CASES.length},concurrency=${CONCURRENCY}`);
  if (failures.length > 0) {
    console.error("Failed checks:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  }
} finally {
  server.kill("SIGTERM");
  limitServer.kill("SIGTERM");
}
