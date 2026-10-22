// Proof: operational metrics endpoint. Boots the built API server, drives real
// traffic (a health check, an allow decision, a 404), scrapes GET /metrics, and
// asserts the Prometheus counters/histograms reflect what happened.
//
// Run: pnpm --filter @workspace/scripts run proof:observability
// (requires the api-server to be built; preflight builds it beforehand.)

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
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

/** Every sample on the two gauges is a finite, non-negative number: no NaN,
 *  Infinity or negative value may reach the exposition, whatever the core hands over. */
const legibleSamples = (t: string) =>
  t.split("\n")
    .filter((l) => /^signalgrid_(connectors|evidence_signals)\{/.test(l))
    .every((l) => { const v = Number(l.slice(l.lastIndexOf(" ") + 1)); return Number.isFinite(v) && v >= 0; });

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

  // An out-of-vocabulary KIND (with a legible status) must still be counted, under
  // kind="unknown", rather than vanish from the exposition.
  m.observeConnectors([{ kind: "acme-badge", status: "degraded", count: 4 }]);
  t = m.renderMetrics();
  want("a kind outside the vocabulary renders as kind=\"unknown\" under its status",
    conn(t, "unknown", "degraded") === 4);
  want("a kind outside the vocabulary is not dropped (the exported total is still 4)",
    KINDS.reduce((n, k) => n + STATUSES.reduce((a, st) => a + (conn(t, k, st) ?? 0), 0), 0) === 4);

  // An unrecognised kind cannot vouch for itself: a legible `healthy` on it is
  // demoted, so no series labelled kind="unknown" ever reads healthy.
  m.observeConnectors([{ kind: "acme-badge", status: "healthy", count: 5 }]);
  t = m.renderMetrics();
  want("an unrecognised kind with status=healthy renders as kind=\"unknown\",status=\"unknown\" 5",
    conn(t, "unknown", "unknown") === 5);
  want("an unrecognised kind with status=healthy lands on NO healthy series", noAffirmative(t) && conn(t, "unknown", "healthy") === 0);

  // An ILLEGIBLE count (NaN, negative, Infinity, not a number) is one illegible item:
  // it folds into unknown/unknown as 1, never onto the row's own (affirmative) labels,
  // and never prints as NaN, Infinity or a negative.
  m.observeConnectors([
    { kind: "microsoft-entra-intune", status: "healthy", count: Number.NaN },
    { kind: "wfm-shift", status: "healthy", count: -3 },
    { kind: "dockbridge-custody", status: "healthy", count: Number.POSITIVE_INFINITY },
    { kind: "wfm-shift", status: "healthy", count: "7" },
    { kind: "wfm-shift", status: "healthy", count: null },
    { kind: "wfm-shift", status: "healthy", count: undefined },
    { kind: "wfm-shift", status: "healthy", count: 1.5 },
  ]);
  m.observeEvidence([
    { freshness: "fresh", count: Number.NaN },
    { freshness: "fresh", count: -1 },
  ]);
  t = m.renderMetrics();
  want("illegible connector counts (NaN, negative, Infinity, string, null, undefined, fractional) fold to kind=\"unknown\",status=\"unknown\" as one item each",
    conn(t, "unknown", "unknown") === 7);
  want("illegible counts land on NO healthy or fresh series", noAffirmative(t));
  want("illegible evidence counts fold to freshness=\"unknown\" as one item each", freshSeries(t, "unknown") === 2);
  want("no NaN, Infinity or negative value reaches the exposition", legibleSamples(t));

  // Two huge but individually legible counts must not sum to Infinity on an
  // affirmative series.
  m.observeConnectors([
    { kind: "wfm-shift", status: "healthy", count: Number.MAX_VALUE },
    { kind: "wfm-shift", status: "healthy", count: Number.MAX_VALUE },
  ]);
  m.observeEvidence([]);
  t = m.renderMetrics();
  want("counts too large to add exactly never overflow a healthy series to Infinity",
    legibleSamples(t) && conn(t, "wfm-shift", "healthy") === 0);

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
  {
    name: "stop folding an out-of-vocabulary kind",
    from: "const kind = inVocabulary(CONNECTOR_KIND_LABELS, row.kind);",
    to: "const kind = String(row.kind);",
  },
  {
    name: "let an unrecognised kind keep a healthy status",
    from: 'kind === UNKNOWN_LABEL && status === "healthy" ? UNKNOWN_LABEL : status',
    to: "status",
  },
  {
    name: "accept an illegible count as given",
    from: "typeof count === \"number\" && Number.isSafeInteger(count) && count >= 0 ? count : null;",
    to: "typeof count === \"number\" ? count : null;",
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

// ── the core inventories THEMSELVES, against an oracle (plan row 33) ──────────
//
// The cases above feed the exporter rows by hand, so they cannot see a core
// inventory that reports the wrong values: a store that called every signal fresh
// would leave the stale-evidence gauge at zero while stale evidence is held, and
// every case above would stay green. These read the SAME store maps the
// inventories read, tally them independently, and require the inventories (and
// the exported series) to match, on the seeded demo core (which holds stale and
// missing evidence) with a planted degraded and never_synced connector. Three
// mutants of store.ts are then loaded from a temp copy and must each turn it red.
const storeSource = resolve(repoRoot, "lib/signalgrid-core/src/store.ts");
const coreSrcDir = resolve(repoRoot, "lib/signalgrid-core/src");

type Row = Record<string, unknown>;
type StoreLike = {
  connectorInventory(): Array<{ kind: string; status: string; count: number }>;
  signalFreshnessInventory(): Array<{ freshness: string; count: number }>;
  putConnector(c: Row): void;
  putSignal(s: Row): void;
  connectors: Map<string, Row>;
  signals: Map<string, Row>;
};

const tally = (values: string[]) => {
  const out = new Map<string, number>();
  for (const v of values) out.set(v, (out.get(v) ?? 0) + 1);
  return out;
};
const sameCounts = (rows: Array<{ key: string; count: number }>, oracle: Map<string, number>) =>
  rows.length === oracle.size && rows.every((r) => oracle.get(r.key) === r.count);

/** Oracle cases over a store already holding the seeded rows plus the planted ones.
 *  Returns the names of the cases that FAILED. */
function oracleCases(store: StoreLike): string[] {
  const failed: string[] = [];
  const want = (name: string, ok: boolean) => { if (!ok) failed.push(name); };
  const sigOracle = tally([...store.signals.values()].map((x) => String(x.freshness)));
  const connOracle = tally([...store.connectors.values()].map((x) => `${String(x.kind)}|${String(x.status)}`));
  const fInv = store.signalFreshnessInventory();
  const cInv = store.connectorInventory();
  want("signalFreshnessInventory matches an independent tally of the held signals",
    sameCounts(fInv.map((r) => ({ key: r.freshness, count: r.count })), sigOracle));
  want("connectorInventory matches an independent tally of the held connectors",
    sameCounts(cInv.map((r) => ({ key: `${r.kind}|${r.status}`, count: r.count })), connOracle));
  const fCount = (f: string) => fInv.find((r) => r.freshness === f)?.count ?? 0;
  want("the seeded core holds stale evidence and the inventory reports it", fCount("stale") > 0 && fCount("stale") === (sigOracle.get("stale") ?? 0));
  want("the seeded core holds missing evidence and the inventory reports it", fCount("missing") > 0 && fCount("missing") === (sigOracle.get("missing") ?? 0));
  const cCount = (kind: string, status: string) => cInv.find((r) => r.kind === kind && r.status === status)?.count ?? 0;
  want("a planted degraded connector is reported degraded", cCount("wfm-shift", "degraded") >= 1);
  want("a planted never_synced connector is reported never_synced", cCount("dockbridge-custody", "never_synced") >= 1);
  return failed;
}

function plant(store: StoreLike, template: Row): void {
  store.putConnector({ ...template, id: "conn_proof_planted_degraded", kind: "wfm-shift", status: "degraded" });
  store.putConnector({ ...template, id: "conn_proof_planted_never_synced", kind: "dockbridge-custody", status: "never_synced", lastSyncAt: null });
}

const STORE_MUTANTS: Array<{ name: string; from: string; to: string }> = [
  { name: "report every held signal fresh", from: "const freshness = String(signal.freshness as string);", to: 'const freshness = "fresh";' },
  { name: "report every connector healthy", from: "const status = String(connector.status as string);", to: 'const status = "healthy";' },
  {
    name: "drop the connectors that are not healthy",
    from: "    for (const connector of this.connectors.values()) {\n      const kind = String(connector.kind as string);",
    to: '    for (const connector of [...this.connectors.values()].filter((c) => c.status === "healthy")) {\n      const kind = String(connector.kind as string);',
  },
];

async function coreInventoryProof(m: MetricsModule): Promise<void> {
  const coreMod = (await import(coreEntry)) as { SignalGridCore: { demo(): unknown } };
  const core = coreMod.SignalGridCore.demo() as { store: StoreLike } & Parameters<MetricsModule["refreshInventoryGauges"]>[0];
  const store = core.store;
  const template = [...store.connectors.values()][0];
  check("core oracle: the demo core holds connectors to plant beside", template !== undefined);
  if (!template) return;
  plant(store, template);
  const realFailures = oracleCases(store);
  check("core oracle: the inventories match the held state on the seeded core" +
    (realFailures.length ? ` (failed: ${realFailures.join("; ")})` : ""), realFailures.length === 0);

  // Through the exporter: the exported series equal the oracle, so a wiring that
  // dropped or relabelled a row between the core and the exposition is red too.
  m.refreshInventoryGauges(core);
  const t = m.renderMetrics();
  const sigOracle = tally([...store.signals.values()].map((x) => String(x.freshness)));
  check("core oracle: exported freshness series equal the held signals, stale and missing included",
    FRESHNESS.every((f) => freshSeries(t, f) === (sigOracle.get(f) ?? 0)) && (freshSeries(t, "stale") ?? 0) > 0);
  check("core oracle: the planted degraded and never_synced connectors reach the exposition",
    (conn(t, "wfm-shift", "degraded") ?? 0) >= 1 && (conn(t, "dockbridge-custody", "never_synced") ?? 0) >= 1);

  const source = readFileSync(storeSource, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "sg-store-mutant-"));
  try {
    for (const [i, mutant] of STORE_MUTANTS.entries()) {
      const hits = source.split(mutant.from).length - 1;
      check(`store mutant "${mutant.name}": its target text is present exactly once`, hits === 1);
      if (hits !== 1) continue;
      const rewritten = source
        .replace(mutant.from, mutant.to)
        .replace(/from "\.\/([a-z-]+)"/g, (_all, mod: string) => `from ${JSON.stringify(pathToFileURL(join(coreSrcDir, `${mod}.ts`)).href)}`);
      const file = join(dir, `store-mutant-${i}.ts`);
      writeFileSync(file, rewritten);
      const { MemoryStore } = (await import(pathToFileURL(file).href)) as { MemoryStore: new () => StoreLike };
      const mutantStore = new MemoryStore();
      for (const c of store.connectors.values()) mutantStore.putConnector(c);
      for (const x of store.signals.values()) mutantStore.putSignal(x);
      const red = oracleCases(mutantStore);
      console.log(`  store mutant "${mutant.name}": ${red.length} case(s) red`);
      check(`store mutant "${mutant.name}": turns the core oracle red`, red.length > 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── /metrics RE-READS held state on every scrape (plan row 33) ────────────────
//
// Every case above drives the exporter or the core directly, and the black-box
// suite cannot change connector state (demo mode's only state-changing route
// re-syncs to identical values). So a handler that refreshed the gauges once at
// boot, or AFTER rendering, would freeze them and pass everything else. This
// serves the real app.ts in process, scrapes, degrades a held connector and
// stales a held signal, scrapes again, and requires the series to move.
const appSource = resolve(repoRoot, "artifacts/api-server/src/app.ts");

/** Serve the app module at `appUrl` in process and run the scrape-moves cases.
 *  Returns the names of the cases that FAILED. */
async function scrapeMovesCases(appUrl: string): Promise<string[]> {
  const failed: string[] = [];
  const want = (name: string, ok: boolean) => { if (!ok) failed.push(name); };
  const appModule = (await import(appUrl)) as {
    default: { listen(port: number, host: string, cb: () => void): import("node:http").Server };
  };
  const coreModule = (await import(pathToFileURL(resolve(repoRoot, "artifacts/api-server/src/lib/core.ts")).href)) as {
    core: { store: StoreLike };
  };
  const store = coreModule.core.store;
  const server = await new Promise<import("node:http").Server>((done) => {
    const s = appModule.default.listen(0, "127.0.0.1", () => done(s));
  });
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const scrape = async () => (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
    const healthy = [...store.connectors.values()].find((c) => c.status === "healthy");
    const fresh = [...store.signals.values()].find((x) => x.freshness === "fresh");
    want("the served core holds a healthy connector and a fresh signal to change", Boolean(healthy && fresh));
    if (!healthy || !fresh) return failed;
    const kind = String(healthy.kind);
    // A warm-up scrape first, so `before` is measured on a scrape that already
    // follows one: a handler that refreshes AFTER rendering then serves the
    // pre-change state on `after`, instead of leftover state from an earlier run
    // happening to equal the expected movement.
    await scrape();
    const before = await scrape();
    store.putConnector({ ...healthy, status: "degraded" });
    store.putSignal({ ...fresh, freshness: "stale" });
    const after = await scrape();
    const moved = (series: number | null, prior: number | null, by: number) =>
      series !== null && prior !== null && series === prior + by;
    want("a connector that degrades after an earlier scrape moves healthy -1 and degraded +1",
      moved(conn(after, kind, "healthy"), conn(before, kind, "healthy"), -1) &&
        moved(conn(after, kind, "degraded"), conn(before, kind, "degraded"), 1));
    want("a signal that goes stale after an earlier scrape moves fresh -1 and stale +1",
      moved(freshSeries(after, "fresh"), freshSeries(before, "fresh"), -1) &&
        moved(freshSeries(after, "stale"), freshSeries(before, "stale"), 1));
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
  return failed;
}

const HANDLER_REFRESH = `  refreshInventoryGauges(core);
  res.type("text/plain; version=0.0.4").send(renderMetrics());`;
const APP_MUTANTS: Array<{ name: string; to: string }> = [
  {
    name: "refresh once at boot, not per scrape",
    to: `  res.type("text/plain; version=0.0.4").send(renderMetrics());`,
  },
  {
    name: "refresh after rendering",
    to: `  const body = renderMetrics();
  refreshInventoryGauges(core);
  res.type("text/plain; version=0.0.4").send(body);`,
  },
];

async function scrapeTracksHeldState(): Promise<void> {
  const realFailures = await scrapeMovesCases(pathToFileURL(appSource).href);
  check("scrape tracks state: /metrics re-reads held state on every scrape" +
    (realFailures.length ? ` (failed: ${realFailures.join("; ")})` : ""), realFailures.length === 0);

  // The mutant copies live outside the package, so every specifier is rewritten
  // to the file app.ts itself resolves to: the copies share app.ts's core and
  // metrics module instances, and differ only in the handler.
  const source = readFileSync(appSource, "utf8");
  const requireFromApp = createRequire(appSource);
  const appDir = dirname(appSource);
  const rewired = source.replace(/from "([^"]+)"/g, (_all, spec: string) => {
    let target: string;
    if (spec.startsWith(".")) {
      const base = resolve(appDir, spec);
      target = existsSync(`${base}.ts`) ? `${base}.ts` : join(base, "index.ts");
    } else {
      target = requireFromApp.resolve(spec);
    }
    return `from ${JSON.stringify(pathToFileURL(target).href)}`;
  });
  const dir = mkdtempSync(join(tmpdir(), "sg-app-mutant-"));
  try {
    for (const [i, mutant] of APP_MUTANTS.entries()) {
      const hits = rewired.split(HANDLER_REFRESH).length - 1;
      check(`app mutant "${mutant.name}": the handler's refresh-then-render text is present exactly once`, hits === 1);
      if (hits !== 1) continue;
      let planted = rewired.replace(HANDLER_REFRESH, mutant.to);
      if (i === 0) planted += "\nrefreshInventoryGauges(core);\n";
      const file = join(dir, `app-mutant-${i}.mts`);
      writeFileSync(file, planted);
      const red = await scrapeMovesCases(pathToFileURL(file).href);
      console.log(`  app mutant "${mutant.name}": ${red.length} case(s) red`);
      check(`app mutant "${mutant.name}": turns the scrape-moves cases red`, red.length > 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await inProcessInventoryProof();
  await coreInventoryProof((await import(pathToFileURL(metricsSource).href)) as MetricsModule);
  await scrapeTracksHeldState();

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
