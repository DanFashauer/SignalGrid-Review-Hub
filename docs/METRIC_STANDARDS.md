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
`signalgrid_process_uptime_seconds`. Every label set is bounded per rule 1;
none is tenant-shaped. The opt-in lab transport for these is
`./scripts/run-live-lanes.sh --with-telemetry`
(app → OTel collector → Prometheus, asserted end to end).
