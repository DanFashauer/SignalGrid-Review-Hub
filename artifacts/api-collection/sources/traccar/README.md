# Traccar — lab source collection

Read-only evidence requests against the Traccar server the `location` lane
starts.

- **Base URL:** `http://127.0.0.1:8482` (host port 8482 → container 8082,
  plain HTTP). Device-position ingest is the OsmAnd protocol on
  `http://127.0.0.1:5055` — not REST, so no request here targets it.
- **Started by:** `scripts/run-live-lanes.sh:238` (`sg-traccar`,
  `docker.io/traccar/traccar:latest` — deliberately unpinned; the Server info
  request reports the version actually running).
- **Credentials:** Basic auth `sg@signalgrid.test` / `SignalGrid!2026x` —
  Traccar's first-registered-user bootstrap, created by `run-live-lanes.sh`
  itself (`POST /api/users`, line 241) in a per-run localhost container. A
  script-minted lab fixture, not a secret — the same public-safe,
  documented-default standing `.gitleaksignore` records for this repo's other
  lab credentials.

Requests mirror exactly what `scripts/src/live-location-proof.ts` consumes:
server info, the device list, and position history. Nothing here creates
devices or users, ingests positions, or deletes anything.

**Boundary:** these requests collect evidence; no request here grants trust —
normalization and the decision stay in SignalGrid
(`docs/OPEN_SOURCE_LAB_REGISTRY.md`: external system → source adapter →
normalized evidence → freshness + provenance + contradictions →
deterministic policy → verdict).
