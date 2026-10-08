# Metric standards — the rules that exist BEFORE the first tenant-shaped label

Backlog row 33 ordered this document deliberately ahead of need: the moment a
metric grows a `tenant` label is the moment the metrics surface becomes a
privacy surface and a cardinality bomb at once, and the rule has to already be
written when someone reaches for it. Owned by `sre` per the lab registry;
applies to `artifacts/api-server/src/lib/metrics.ts` (the only exporter today)
and to every future exporter.

## The four rules

1. **No unbounded label values — ever.** A label's complete value set must be
   enumerable at review time: HTTP method, NORMALIZED route (the fixed route
   registry, never the raw path — a raw path with an ID in it is an unbounded
   set), status class, decision outcome (`allow`/`step_up`/`restrict`/`deny`),
   audit event type. Adding a label whose values the reviewer cannot list in
   the diff is the thing this rule forbids. Device IDs, person IDs, session
   IDs, request IDs never appear as labels — that is what structured logs and
   the audit ledger are for.

2. **No tenant-shaped label without a decision record.** `tenant`,
   `org`, `site`, `customer` — any label whose values grow with the customer
   base — requires a DR first, because it changes three things at once: the
   cardinality budget, the privacy classification of the scrape surface, and
   the blast radius of exposing `/metrics` to a shared Prometheus. The DR must
   name the bound (e.g. "tenants on this instance, expected < 100"), the
   scrape-surface protection, and the retention story. Until such a DR exists,
   per-tenant observability comes from the audit ledger, not from metrics.

3. **The scrape surface is a boundary, not a courtesy.** `/metrics` is
   unauthenticated inside the lab profile (loopback + lab network only, the
   lane publishes Prometheus on 127.0.0.1). A production deployment protects
   it at the network boundary (deployment runbook), because even
   tenant-label-free metrics leak operational shape — request rates, deny
   rates, error bursts. Metric names and label sets are part of the published
   contract: renaming one is a breaking change to every dashboard and alert
   downstream, reviewed like an API change.

4. **Collector components are allowlisted, not inherited.** The OTel contrib
   image ships hundreds of receivers/processors/exporters; the lane's
   collector config names exactly the pipeline it uses (one receiver, one
   exporter, one health extension). A component is added by naming it in a
   reviewed config diff — "the image already had it" is never how a data path
   appears. This is the report's curated-allowlist doctrine applied to the one
   place it currently binds.

## What exists today

`GET /metrics` on the api-server: dependency-free Prometheus text exposition —
`signalgrid_http_requests_total` (method, normalized route, status),
`signalgrid_http_request_duration_seconds` (fixed buckets, normalized route),
`signalgrid_decisions_total` (outcome enum),
`signalgrid_audit_events_total` (event type), `signalgrid_up`,
`signalgrid_process_uptime_seconds`,
`signalgrid_connectors` (connector kind, connector status) and
`signalgrid_evidence_signals` (signal freshness). Every label set is bounded
per rule 1; none is tenant-shaped. The opt-in lab transport for these is
`./scripts/run-live-lanes.sh --with-telemetry`
(app → OTel collector → Prometheus, asserted end to end; that lane predates the
last two series and has not been re-run against them).

### Connector health and evidence freshness

The last two are gauges over state the core HOLDS at scrape time
(`connectorInventory()` and `signalFreshnessInventory()`, beside
`signalInventory()`), not counters bumped beside a route, so they recover when
a re-sync does. How they keep the four rules:

- **Rule 1.** `kind` is `ConnectorKind` (3 values) plus a literal `unknown`,
  `status` is `ConnectorStatus` (3) plus a literal `unknown`, and `freshness`
  is `Freshness` (5), whose own `unknown` member is the fold. The
  vocabularies are typed maps in `metrics.ts`, so a new union member that the
  exposition does not list is a typecheck error. 16 + 5 series in total.
- **Rule 2.** No label names a customer. The counts aggregate over every
  customer this process holds; the per-customer view stays with the audit
  ledger. The exposition is also asserted (`api.test.mjs`) to contain no
  customer-scope word anywhere, HELP and TYPE text included, which is why
  the HELP strings avoid it.
- **Fail-closed.** `healthy` and `fresh` are the only affirmative values. Any
  value outside the vocabulary, and any count that is not a non-negative
  number, folds into `unknown`, which reads as not healthy and not fresh.
  Every series is written on every scrape, zeros included, so a missing
  series never stands in for a missing problem. If an inventory read throws,
  the scrape still answers 200 with `kind="unknown",status="unknown"` (or
  `freshness="unknown"`) at 1 and every affirmative series at 0: a failed
  scrape would hide the outage the metric exists to show.
  `proof:observability` pins these cases in process: an out-of-vocabulary
  status, kind and freshness; illegible counts (NaN, negative, Infinity, a
  string), which must reach no affirmative series and print no NaN, Infinity
  or negative; an empty inventory; a throwing read. It plants four mutants
  (fold `unknown` into the affirmative value; skip the zero-fill; stop
  folding an out-of-vocabulary kind; accept an illegible count as given),
  each of which turns it red. The `/metrics` handler's call into the core is
  pinned by `api.test.mjs`, not by the proof.
- **What freshness means here.** `freshness` is the value stamped on each
  signal when it was ingested, so the gauge reports what the last sync saw,
  not a re-evaluation against the clock at scrape time.
