# Wazuh manager — lab source collection

Read-only evidence requests against the Wazuh manager the `edr` lane starts.

- **Base URL:** `https://localhost:55000` — **must be `localhost`, never
  `127.0.0.1`**: the container's self-minted cert has SAN `DNS:localhost`
  only. The lane extracts that cert to `$HOME/.sg-wazuh-ca.<pid>.crt` and
  trusts it explicitly; do the same in Bruno rather than disabling
  verification — verification is never disabled in this lab.
- **Started by:** `scripts/run-live-lanes.sh:295` (`sg-wazuh`,
  `docker.io/wazuh/wazuh-manager:4.14.7`, pinned; ~2GB first pull).
- **Credentials:** `wazuh` / `wazuh` — the wazuh-manager image's DOCUMENTED
  default API credential for a per-run, localhost-only lab container, the
  exact finding already reviewed and accepted in `.gitleaksignore` (same
  standing as the postgres/mysql defaults in CI service containers). Not a
  secret; cite that entry, don't re-litigate it. Run `Authenticate` and paste
  the JWT into the `wazuhJwt` environment var.

Requests mirror what `scripts/src/live-edr-proof.ts` consumes — the
authenticate exchange (the only POST; auth bootstrap, not a mutation) and the
`/agents` evidence read — plus a liveness probe. Nothing here adds, restarts,
or removes agents.

**Boundary:** these requests collect evidence; no request here grants trust —
normalization and the decision stay in SignalGrid
(`docs/OPEN_SOURCE_LAB_REGISTRY.md`: external system → source adapter →
normalized evidence → freshness + provenance + contradictions →
deterministic policy → verdict).
