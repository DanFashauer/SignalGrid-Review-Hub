// Proof: operational metrics endpoint. Boots the built API server, drives real
// traffic (a health check, an allow decision, a 404), scrapes GET /metrics, and
// asserts the Prometheus counters/histograms reflect what happened.
//
// Run: pnpm --filter @workspace/scripts run proof:observability
// (requires the api-server to be built; preflight builds it beforehand.)

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// ── connector health and evidence freshness, IN PROCESS (plan row 33) ─────────
//
// The black-box suite (api.test.mjs) sees only what the seeded core holds, which
// is always legible. These are the cases it cannot reach: a value outside the
// vocabulary, an empty inventory, and an inventory read that THROWS. Each must
// tighten the answer, never loosen it: nothing outside the vocabulary may land
// on an affirmative series, absence never reads healthy, and a throw reports
// `unknown` rather than an empty or a failed scrape.
//
// The module is loaded by URL because it lives outside this package's rootDir.
// Two mutants of the same source are then loaded from a temp copy and each must
// turn these cases red, so a refactor that quietly drops the fail-closed fold or
// the zero-fill cannot leave this proof green.
const metricsSource = resolve(repoRoot, "artifacts/api-server/src/lib/metrics.ts");
const coreEntry = pathToFileURL(resolve(repoRoot, "lib/signalgrid-core/src/index.ts")).href;
const KINDS = ["microsoft-entra-intune", "dockbridge-custody", "wfm-shift", "unknown"];
const STATUSES = ["healthy", "degraded", "never_synced", "unknown"];
const FRESHNESS = ["fresh", "stale", "expired", "missing", "unknown"];

type MetricsModule = {
  observeConnectors(rows: unknown[]): void;
  observeEvidence(rows: unknown[]): void;
  refreshInventoryGauges(source: { connectorInventory(): unknown[]; signalFreshnessInventory(): unknown[] }): void;
  renderMetrics(): string;
};

function exact(text: string, series: string): number | null {
  for (const line of text.split("\n")) {
    if (line.startsWith(`${series} `)) {
      const v = Number(line.slice(series.length + 1));
      return Number.isFinite(v) ? v : null;
    }
  }
  return null;
}
const conn = (t: string, kind: string, status: string) => exact(t, `signalgrid_connectors{kind="${kind}",status="${status}"}`);
const freshSeries = (t: string, f: string) => exact(t, `signalgrid_evidence_signals{freshness="${f}"}`);
const everySeries = (t: string) =>
  KINDS.every((k) => STATUSES.every((s) => conn(t, k, s) !== null)) && FRESHNESS.every((f) => freshSeries(t, f) !== null);
const noAffirmative = (t: string) =>
  KINDS.every((k) => conn(t, k, "healthy") === 0) && freshSeries(t, "fresh") === 0;

/** The in-process cases. Returns the names of the cases that FAILED. */
function inventoryCases(m: MetricsModule): string[] {
  const failed: string[] = [];
  const want = (name: string, ok: boolean) => { if (!ok) failed.push(name); };

  m.observeConnectors([{ kind: "microsoft-entra-intune", status: "bogus", count: 2 }]);
  m.observeEvidence([{ freshness: "ancient", count: 3 }]);
  let t = m.renderMetrics();
  want("a status outside the vocabulary renders as status=\"unknown\" 2",
    conn(t, "microsoft-entra-intune", "unknown") === 2);
  want("a status outside the vocabulary lands on NO healthy series", noAffirmative(t));
  want("a freshness outside the vocabulary renders as freshness=\"unknown\" 3", freshSeries(t, "unknown") === 3);
  want("an out-of-vocabulary row still leaves every series present", everySeries(t));

  m.observeConnectors([]);
  m.observeEvidence([]);
  t = m.renderMetrics();
  want("an empty inventory still renders every series (absence never reads healthy)", everySeries(t));
  want("an empty inventory renders every series at 0",
    KINDS.every((k) => STATUSES.every((s) => conn(t, k, s) === 0)) && FRESHNESS.every((f) => freshSeries(t, f) === 0));

  m.refreshInventoryGauges({
    connectorInventory() { throw new Error("planted: connector inventory unreadable"); },
    signalFreshnessInventory() { throw new Error("planted: signal inventory unreadable"); },
  });
  t = m.renderMetrics();
  want("a throwing connector read renders kind=\"unknown\",status=\"unknown\" 1", conn(t, "unknown", "unknown") === 1);
  want("a throwing evidence read renders freshness=\"unknown\" 1", freshSeries(t, "unknown") === 1);
  want("a throwing read renders no affirmative series", noAffirmative(t));
  want("a throwing read still renders every series", everySeries(t));
  return failed;
}

const MUTANTS: Array<{ name: string; from: string; to: string }> = [
  {
    name: "fold unknown into the affirmative value",
    from: 'typeof value === "string" && vocabulary.includes(value) ? value : UNKNOWN_LABEL;',
    to: 'typeof value === "string" && vocabulary.includes(value) ? value : (vocabulary === CONNECTOR_STATUS_LABELS ? "healthy" : vocabulary === FRESHNESS_LABELS ? "fresh" : UNKNOWN_LABEL);',
  },
  {
    name: "skip the zero-fill",
    from: "connectorsGauge.set(acc.get(key({ kind, status })) ?? 0, { kind, status });",
    to: "{ const v = acc.get(key({ kind, status })) ?? 0; if (v > 0) connectorsGauge.set(v, { kind, status }); }",
  },
];

async function inProcessInventoryProof(): Promise<void> {
  const real = (await import(pathToFileURL(metricsSource).href)) as MetricsModule;
  const realFailures = inventoryCases(real);
  check("in-process: connector/evidence gauges hold every fail-closed case on the real module" +
    (realFailures.length ? ` (failed: ${realFailures.join("; ")})` : ""), realFailures.length === 0);

  const source = readFileSync(metricsSource, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "sg-metrics-mutant-"));
  try {
    for (const [i, mutant] of MUTANTS.entries()) {
      const planted = source.includes(mutant.from);
      check(`mutant "${mutant.name}": its target text is present (else the mutant is a no-op)`, planted);
      if (!planted) continue;
      const file = join(dir, `metrics-mutant-${i}.ts`);
      writeFileSync(file, source.replace(mutant.from, mutant.to).replace('from "@workspace/signalgrid-core"', `from ${JSON.stringify(coreEntry)}`));
      const m = (await import(pathToFileURL(file).href)) as MetricsModule;
      const red = inventoryCases(m);
      console.log(`  mutant "${mutant.name}": ${red.length} case(s) red`);
      check(`mutant "${mutant.name}": turns the in-process cases red`, red.length > 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await inProcessInventoryProof();

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

    check("connector-health gauge is exported for every kind x status, zeros included",
      KINDS.every((k) => STATUSES.every((st) => conn(text, k, st) !== null)));
    check("evidence-freshness gauge is exported for every freshness value, zeros included",
      FRESHNESS.every((f) => freshSeries(text, f) !== null));

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
