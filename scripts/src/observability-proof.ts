// Proof: operational metrics endpoint. Boots the built API server, drives real
// traffic (a health check, an allow decision, a 404), scrapes GET /metrics, and
// asserts the Prometheus counters/histograms reflect what happened.
//
// Run: pnpm --filter @workspace/scripts run proof:observability
// (requires the api-server to be built; preflight builds it beforehand.)

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 5388;
const BASE = `http://localhost:${PORT}/api`;
const METRICS = `http://localhost:${PORT}/metrics`;
const TOKEN = "sgk_demo_northwind_operator";
// Resolve relative to THIS file (scripts/src/…), not the cwd, which is the
// scripts package dir under `pnpm --filter`.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverEntry = resolve(repoRoot, "artifacts/api-server/dist/index.mjs");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => { ok ? (passed += 1) : failures.push(name); };

async function waitReady(ms = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return true; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// Parse a single Prometheus sample's value by exact `name{labels}` prefix match.
function sampleValue(text: string, needle: string): number | null {
  for (const line of text.split("\n")) {
    if (line.startsWith("#")) continue;
    if (line.startsWith(needle)) {
      const v = Number(line.slice(line.lastIndexOf(" ") + 1));
      if (Number.isFinite(v)) return v;
    }
  }
  return null;
}

async function main() {
  const server = spawn(process.execPath, ["--enable-source-maps", serverEntry], {
    env: { ...process.env, PORT: String(PORT), DATABASE_URL: "" },
    stdio: "ignore",
  });
  try {
    if (!(await waitReady())) throw new Error("server did not become ready");

    // ── drive real traffic ────────────────────────────────────────────────────
    await fetch(`${BASE}/healthz`);
    const ev = await fetch(`${BASE}/v1/decisions/evaluate`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" }),
    });
    check("evaluate returned 200", ev.status === 200);
    // A 404 on a decision id → exercises the route normalizer (:id).
    await fetch(`${BASE}/v1/decisions/dec_does_not_exist`, { headers: { authorization: `Bearer ${TOKEN}` } });

    // ── scrape metrics ──────────────────────────────────────────────────────────
    const res = await fetch(METRICS);
    check("GET /metrics returns 200", res.status === 200);
    check("metrics content-type is prometheus text", (res.headers.get("content-type") || "").includes("text/plain"));
    const text = await res.text();

    check("signalgrid_up is 1", sampleValue(text, "signalgrid_up ") === 1);
    check("process uptime gauge present", sampleValue(text, "signalgrid_process_uptime_seconds") !== null);

    const evalReqs = sampleValue(text, 'signalgrid_http_requests_total{method="POST",route="/api/v1/decisions/evaluate",status="200"}');
    check("http_requests_total counted the evaluate 200", (evalReqs ?? 0) >= 1);

    const allowDecisions = sampleValue(text, 'signalgrid_decisions_total{outcome="allow"}');
    check("decisions_total counted the allow outcome", (allowDecisions ?? 0) >= 1);

    check("route normalizer collapsed the decision id to :id",
      text.includes('route="/api/v1/decisions/:id"'));

    check("latency histogram exposes a _count series",
      /signalgrid_http_request_duration_seconds_count\{/.test(text));
    check("latency histogram exposes bucket + Inf series",
      text.includes('signalgrid_http_request_duration_seconds_bucket{') && text.includes('le="+Inf"'));

    const total = passed + failures.length;
    console.log(`Observability proof: ${passed}/${total} assertions passed`);
    if (failures.length) {
      console.error("Failed assertions:");
      for (const f of failures) console.error(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log("Operational metrics verified — request counts, latency histogram, decision outcomes, liveness at /metrics.");
    }
  } finally {
    server.kill("SIGKILL");
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
