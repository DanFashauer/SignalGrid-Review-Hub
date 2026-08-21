# Fleet MDM — lab source collection

Read-only evidence requests against the Fleet server the `fleet` lane starts.

- **Base URL:** `https://127.0.0.1:8412` (host port 8412 → container 8080,
  HTTPS with a per-run self-signed cert minted into `$HOME/.sg-fleet-lab.XXXXXX`;
  trust that `fleet.crt` — verification is never disabled).
- **Started by:** `scripts/run-live-lanes.sh:143` (`sg-fleet`,
  `docker.io/fleetdm/fleet:v4.89.2`), with `sg-fleet-mysql` (`:84`),
  `sg-fleet-redis` (`:86`) and the real enrolled `sg-osquery` agent (`:189`)
  on network `sg-fleetnet`.
- **Credentials:** `sg@signalgrid.test` / `SignalGrid!2026x` — the lab
  bootstrap admin that `run-live-lanes.sh` itself creates via
  `POST /api/v1/setup` in a per-run localhost container. A script-minted lab
  fixture, not a secret — same public-safe standing as the documented image
  defaults recorded in `.gitleaksignore` (mysql `root`/`root` in this lane is
  the mysql:8 image's documented container default). Run `Login` and paste the
  token into the `fleetToken` environment var.

Requests mirror the paths SignalGrid's own code already consumes —
`lib/integrations/src/integrations/telemetry/fleetdm.ts`,
`lib/fleet-connector/src/client.ts`, `scripts/src/live-fleet-proof.ts` — not
Fleet's full API. Nothing here enrolls, edits, or deletes anything; `Login` is
the only POST and mints a token.

**Boundary:** these requests collect evidence; no request here grants trust —
normalization and the decision stay in SignalGrid
(`docs/OPEN_SOURCE_LAB_REGISTRY.md`: external system → source adapter →
normalized evidence → freshness + provenance + contradictions →
deterministic policy → verdict).
