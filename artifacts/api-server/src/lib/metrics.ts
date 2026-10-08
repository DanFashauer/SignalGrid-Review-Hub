// Operational metrics — dependency-free Prometheus text exposition.
//
// Structured request LOGGING already exists (pino-http). This adds the
// operational METRICS a production deploy scrapes: request counts, latency
// distribution, decision outcomes, and liveness — rendered at GET /metrics in
// the Prometheus text format. No external client, so there is no ambiguity about
// what is exported and no supply-chain surface.

import { FRESHNESS_VALUES, type ConnectorKind, type ConnectorStatus } from "@workspace/signalgrid-core";

type Labels = Record<string, string>;

function key(labels: Labels): string {
  return Object.keys(labels).sort().map((k) => `${k}\u0000${labels[k]}`).join("\u0001");
}
function fmt(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  const parts = keys.map((k) => `${k}="${String(labels[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`);
  return `{${parts.join(",")}}`;
}

/**
 * The single bucket every unlabelable route collapses into.
 *
 * Exported so the middleware and the proof name the SAME string — a second
 * literal would be a second thing to drift.
 */
export const OTHER_ROUTE = "other";

/**
 * Hard ceiling on distinct label tuples per metric.
 *
 * A SECOND NET, deliberately. The middleware now labels from the route Express
 * matched, so unbounded growth should be impossible at the source — but the source
 * is one caller, and these are exported instruments any future caller can reach.
 * The docblock on `normalizeRoute` below CLAIMED the label stayed bounded and
 * nothing enforced it; 150 unauthenticated requests grew the exposition 88x.
 *
 * When the ceiling is reached a new tuple is folded into a single overflow series
 * rather than dropped, so the count stays truthful and the overflow is VISIBLE in
 * the exposition instead of silently missing. 512 is far above any real route x
 * method x status product this server can produce and far below anything that
 * threatens memory.
 */
const MAX_SERIES_PER_METRIC = 512;
const OVERFLOW_LABELS: Labels = { route: OTHER_ROUTE, overflow: "true" };

/**
 * Fold a label set into the overflow series once a metric is at its ceiling.
 * Returns the key to use and the labels to store under it.
 */
function boundLabels(
  values: Map<string, { labels: Labels; v: number }> | Map<string, unknown>,
  labels: Labels,
): { k: string; labels: Labels } {
  const k = key(labels);
  if (values.has(k) || values.size < MAX_SERIES_PER_METRIC) {
    return { k, labels };
  }
  return { k: key(OVERFLOW_LABELS), labels: OVERFLOW_LABELS };
}

class Counter {
  private values = new Map<string, { labels: Labels; v: number }>();
  constructor(readonly name: string, readonly help: string) {}
  inc(labels: Labels = {}, by = 1): void {
    const bound = boundLabels(this.values, labels);
    const cur = this.values.get(bound.k) ?? { labels: bound.labels, v: 0 };
    cur.v += by;
    this.values.set(bound.k, cur);
  }
  render(): string {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    if (this.values.size === 0) out.push(`${this.name} 0`);
    for (const { labels, v } of this.values.values()) out.push(`${this.name}${fmt(labels)} ${v}`);
    return out.join("\n");
  }
}

class Gauge {
  private values = new Map<string, { labels: Labels; v: number }>();
  constructor(readonly name: string, readonly help: string) {}
  set(v: number, labels: Labels = {}): void {
    // Bounded like Counter.inc and Histogram.observe. It was NOT, and the file
    // above claims the cap is applied — an incomplete fix that reads as a
    // complete one. Latent today because both gauges are set unlabelled from
    // inside this module, so no caller can currently mint a series here; the
    // guard is applied anyway, because "no caller does this yet" is the state
    // the labelled-route cardinality bug was in right before it happened.
    const bound = boundLabels(this.values, labels);
    this.values.set(bound.k, { labels: bound.labels, v });
  }
  render(): string {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const { labels, v } of this.values.values()) out.push(`${this.name}${fmt(labels)} ${v}`);
    return out.join("\n");
  }
}

class Histogram {
  private data = new Map<string, { labels: Labels; counts: number[]; sum: number; count: number }>();
  constructor(readonly name: string, readonly help: string, readonly buckets: number[]) {}
  observe(labels: Labels, value: number): void {
    // Same ceiling as Counter. The histogram is the more expensive of the two —
    // each new series retains an 11-element bucket array — so it is the one that
    // grew the exposition fastest when the label was caller-controlled.
    const bound = boundLabels(this.data, labels);
    let entry = this.data.get(bound.k);
    if (!entry) {
      entry = {
        labels: bound.labels,
        counts: new Array(this.buckets.length).fill(0),
        sum: 0,
        count: 0,
      };
      this.data.set(bound.k, entry);
    }
    entry.sum += value;
    entry.count += 1;
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) entry.counts[i] += 1;
    }
  }
  render(): string {
    const out = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const { labels, counts, sum, count } of this.data.values()) {
      let cumulative = 0;
      for (let i = 0; i < this.buckets.length; i++) {
        cumulative += counts[i];
        out.push(`${this.name}_bucket${fmt({ ...labels, le: String(this.buckets[i]) })} ${cumulative}`);
      }
      out.push(`${this.name}_bucket${fmt({ ...labels, le: "+Inf" })} ${count}`);
      out.push(`${this.name}_sum${fmt(labels)} ${sum}`);
      out.push(`${this.name}_count${fmt(labels)} ${count}`);
    }
    return out.join("\n");
  }
}

// ── the SignalGrid metric set ───────────────────────────────────────────────
export const httpRequests = new Counter(
  "signalgrid_http_requests_total",
  "Total HTTP requests, by method, normalized route, and status.",
);
export const httpDuration = new Histogram(
  "signalgrid_http_request_duration_seconds",
  "HTTP request latency in seconds, by normalized route.",
  [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
);
export const decisionsTotal = new Counter(
  "signalgrid_decisions_total",
  "Total trust decisions, by outcome (allow/step_up/restrict/deny).",
);
/** Incremented BESIDE every route-level appendAuditRecord call, so the fact
 *  that an admin action emitted its audit event is observable at /metrics —
 *  the durable ledger itself has no HTTP route, and a test (or an operator)
 *  needs a way to see emission happen without database access. The ledger
 *  content and redaction are proof:audit-ledger's job; this only witnesses
 *  that the route fired the append. */
export const auditEventsTotal = new Counter(
  "signalgrid_audit_events_total",
  "Route-level audit events appended to the durable ledger, by event type.",
);
/** 1 once the process is SERVING, which is a different fact from "this module was
 *  imported" — and the module was where it used to be set, at import, before
 *  `app.listen`. A gauge whose only reachable value is the healthy one is a green
 *  light wired to the switch rather than to the circuit, and the HELP text below
 *  says "serving". `markServing()` is called from the listen callback in index.ts,
 *  so the 0 is real for as long as the process is not listening. */
const up = new Gauge("signalgrid_up", "1 if the API process is serving (set when the listener is bound).");
up.set(0);

/** Called from `app.listen`'s callback once the socket is bound. */
export function markServing(): void {
  up.set(1);
}

/** Uptime comes from `process.uptime()`, which is monotonic, needs no wall clock,
 *  and is on no decision path. The previous implementation started its clock on the
 *  FIRST SCRAPE, so the metric reported time-since-a-scraper-arrived: always 0 on
 *  the first scrape however old the process was, and an alert on
 *  `signalgrid_process_uptime_seconds < N` (the restart-loop alert this metric
 *  exists for) fired once per new scraper and never for an actual restart. */
const processUptime = new Gauge("signalgrid_process_uptime_seconds", "Process uptime in seconds.");

// ── connector health and evidence freshness (plan row 33) ─────────────────────
//
// Both are GAUGES over what the core HOLDS at scrape time, not counters bumped
// beside a route: a re-sync overwrites a connector's status and a signal's
// freshness in place, so the series recover when the estate does.
//
// Every label value is enumerated here. The kind and status vocabularies are
// `Record<Union, true>` maps, so adding a member to `ConnectorKind` or
// `ConnectorStatus` without updating the exposition is a typecheck error, and
// freshness comes from `FRESHNESS_VALUES`, exhaustive by construction. Each axis
// carries a literal `unknown` that every value outside the vocabulary folds into.
//
// FAIL-CLOSED: `healthy` and `fresh` are the only affirmative values. `unknown`
// is counted as not-healthy / not-fresh, and EVERY series is written on EVERY
// scrape, zeros included, so an absent series never reads as an absent problem.
// 4 kinds x 4 statuses + 5 freshness values is far under MAX_SERIES_PER_METRIC.

/** The fold for any label value outside a declared vocabulary. */
export const UNKNOWN_LABEL = "unknown";

const CONNECTOR_KINDS: Record<ConnectorKind, true> = {
  "microsoft-entra-intune": true,
  "dockbridge-custody": true, // deferred family: the label is enumerated so the series is bounded, not Limited GA capability
  "wfm-shift": true,
};
const CONNECTOR_STATUSES: Record<ConnectorStatus, true> = {
  healthy: true,
  degraded: true,
  never_synced: true,
};

const withUnknown = (values: readonly string[]): readonly string[] => [
  ...values.filter((v) => v !== UNKNOWN_LABEL),
  UNKNOWN_LABEL,
];
/** Every `kind` label value the connector gauge can carry. */
export const CONNECTOR_KIND_LABELS = withUnknown(Object.keys(CONNECTOR_KINDS));
/** Every `status` label value the connector gauge can carry. */
export const CONNECTOR_STATUS_LABELS = withUnknown(Object.keys(CONNECTOR_STATUSES));
/** Every `freshness` label value the evidence gauge can carry. */
export const FRESHNESS_LABELS = withUnknown(FRESHNESS_VALUES);

const inVocabulary = (vocabulary: readonly string[], value: unknown): string =>
  typeof value === "string" && vocabulary.includes(value) ? value : UNKNOWN_LABEL;

/** A count that is not a non-negative finite number is itself illegible: it is
 *  folded into the `unknown` series as ONE item, never dropped and never added
 *  to an affirmative series. */
const legibleCount = (count: unknown): number | null =>
  typeof count === "number" && Number.isFinite(count) && count >= 0 ? count : null;

const connectorsGauge = new Gauge(
  "signalgrid_connectors",
  "Connectors held by this process, by kind and status. Only status=healthy is affirmative; unknown counts as not healthy.",
);
const evidenceGauge = new Gauge(
  "signalgrid_evidence_signals",
  "Normalized signals held by this process, by freshness. Only freshness=fresh is affirmative; unknown counts as not fresh.",
);

/** Write EVERY kind x status series from the core's connector inventory. */
export function observeConnectors(rows: ReadonlyArray<{ kind: unknown; status: unknown; count: unknown }>): void {
  const acc = new Map<string, number>();
  for (const kind of CONNECTOR_KIND_LABELS) for (const status of CONNECTOR_STATUS_LABELS) acc.set(key({ kind, status }), 0);
  for (const row of rows) {
    const count = legibleCount(row?.count);
    const labels =
      count === null
        ? { kind: UNKNOWN_LABEL, status: UNKNOWN_LABEL }
        : { kind: inVocabulary(CONNECTOR_KIND_LABELS, row.kind), status: inVocabulary(CONNECTOR_STATUS_LABELS, row.status) };
    const k = key(labels);
    acc.set(k, (acc.get(k) ?? 0) + (count ?? 1));
  }
  for (const kind of CONNECTOR_KIND_LABELS) {
    for (const status of CONNECTOR_STATUS_LABELS) connectorsGauge.set(acc.get(key({ kind, status })) ?? 0, { kind, status });
  }
}

/** Write EVERY freshness series from the core's signal-freshness inventory. */
export function observeEvidence(rows: ReadonlyArray<{ freshness: unknown; count: unknown }>): void {
  const acc = new Map<string, number>(FRESHNESS_LABELS.map((f) => [f, 0]));
  for (const row of rows) {
    const count = legibleCount(row?.count);
    const freshness = count === null ? UNKNOWN_LABEL : inVocabulary(FRESHNESS_LABELS, row.freshness);
    acc.set(freshness, (acc.get(freshness) ?? 0) + (count ?? 1));
  }
  for (const freshness of FRESHNESS_LABELS) evidenceGauge.set(acc.get(freshness) ?? 0, { freshness });
}

/**
 * Refresh both gauges from the core immediately before a render. If either
 * inventory read THROWS, that gauge reports a single `unknown` item and every
 * affirmative series at 0 — never a silent omission and never a failed scrape,
 * because a scrape that fails hides the outage the metric exists to show.
 */
export function refreshInventoryGauges(source: {
  connectorInventory(): ReadonlyArray<{ kind: unknown; status: unknown; count: unknown }>;
  signalFreshnessInventory(): ReadonlyArray<{ freshness: unknown; count: unknown }>;
}): void {
  try {
    observeConnectors(source.connectorInventory());
  } catch {
    observeConnectors([{ kind: UNKNOWN_LABEL, status: UNKNOWN_LABEL, count: 1 }]);
  }
  try {
    observeEvidence(source.signalFreshnessInventory());
  } catch {
    observeEvidence([{ freshness: UNKNOWN_LABEL, count: 1 }]);
  }
}

// Zero-filled at import, so a render before the first refresh still carries every
// series (and they read not-healthy / not-fresh, never healthy by absence).
observeConnectors([]);
observeEvidence([]);

/** Render the full metrics registry in Prometheus text format. */
export function renderMetrics(): string {
  processUptime.set(Math.max(0, process.uptime()));
  return [
    up.render(),
    processUptime.render(),
    httpRequests.render(),
    httpDuration.render(),
    decisionsTotal.render(),
    auditEventsTotal.render(),
    connectorsGauge.render(),
    evidenceGauge.render(),
    "",
  ].join("\n");
}
