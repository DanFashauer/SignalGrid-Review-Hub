# Keycloak — lab source collection

Read-only evidence requests against the Keycloak server the `keycloak` lane
starts.

- **Base URL:** `http://127.0.0.1:8480` (host port 8480 → container 8080,
  plain HTTP; `start-dev --features=dpop`).
- **Started by:** `scripts/run-live-lanes.sh:258` (`sg-keycloak`,
  `quay.io/keycloak/keycloak:26.4`).
- **Credentials:** `admin` / `admin` — the `KC_BOOTSTRAP_ADMIN_USERNAME` /
  `KC_BOOTSTRAP_ADMIN_PASSWORD` container defaults the lane sets on a per-run
  localhost container: a documented image bootstrap, not a secret, the same
  public-safe standing `.gitleaksignore` records for wazuh:wazuh. The seeded
  DPoP client is `sg-dpop` / `sg-dpop-secret` — a lab fixture pair hardcoded
  in the lane script.

Requests mirror what `scripts/src/live-keycloak-proof.ts` and the lane's own
seeding reads consume: realm info, OIDC discovery, JWKS, the admin-cli
password grant (auth bootstrap — the only POST), and the `sg-dpop` client
lookup on the admin API. Client creation and protocol-mapper POSTs are
mutations and stay in the lane script; nothing here creates users, clients,
or mappers.

**Boundary:** these requests collect evidence; no request here grants trust —
normalization and the decision stay in SignalGrid
(`docs/OPEN_SOURCE_LAB_REGISTRY.md`: external system → source adapter →
normalized evidence → freshness + provenance + contradictions →
deterministic policy → verdict).
