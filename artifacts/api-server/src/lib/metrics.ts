// Operational metrics — dependency-free Prometheus text exposition.
//
// Structured request LOGGING already exists (pino-http). This adds the
// operational METRICS a production deploy scrapes: request counts, latency
// distribution, decision outcomes, and liveness — rendered at GET /metrics in
// the Prometheus text format. No external client, so there is no ambiguity about
// what is exported and no supply-chain surface.

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
const up = new Gauge("signalgrid_up", "1 if the API process is serving.");
up.set(1);
const startedAtMs = { v: 0 }; // set on first render to avoid Date.now at import
const processUptime = new Gauge("signalgrid_process_uptime_seconds", "Process uptime in seconds.");

/** Render the full metrics registry in Prometheus text format. */
export function renderMetrics(nowMs: number): string {
  if (startedAtMs.v === 0) startedAtMs.v = nowMs;
  processUptime.set(Math.max(0, (nowMs - startedAtMs.v) / 1000));
  return [
    up.render(),
    processUptime.render(),
    httpRequests.render(),
    httpDuration.render(),
    decisionsTotal.render(),
    auditEventsTotal.render(),
    "",
  ].join("\n");
}

/**
 * Collapse high-cardinality id segments to `:id` so the route label stays
 * bounded (a metric per real decision/session id would explode cardinality).
 */
export function normalizeRoute(pathWithQuery: string): string {
  const path = pathWithQuery.split("?")[0];
  return path
    .replace(/\/(?:dec|sess|evid|evd|pol|conn|rem|whk)_[A-Za-z0-9_-]+/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id");
}
