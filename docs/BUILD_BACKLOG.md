# SignalGrid build backlog

A living, prioritized backlog for continued build — human- or agent-driven.
Each item is scoped to ship as one reviewable PR. Ground rules for any agent
picking these up:

- **Public-safe by default** — no secrets, PHI/PII, tenant data, or live vendor
  calls; no production-ready / compliance / partnership / replacement claims.
- **Fail closed & fixture-first** — deterministic seeds; high-risk actions stay
  approval-gated and simulated.
- **Prove it** — every substantive change lands with a passing proof/test and
  `pnpm run typecheck` + `pnpm run safety:check` green.
- **One PR per item** — open for review; do **not** auto-merge.

## Now (next up)

- [ ] **Warehouse scenario pack** — add pick/pack + controlled-area scenarios to
      the room-sim/console so the demo isn't hospital-only.

## Next

- [ ] **Global-fleet scenario pack** — vehicle-mount checkout + cross-region
      session scenarios.

## Later / vision

- [ ] **Operational-intelligence rollups (Phase 3)** — friction hotspots,
      posture drift, custody gaps across sites, from ingested telemetry.
- [ ] **Attestation verification** — verify packed/fido-u2f attestation at
      registration (today: `none` self-attested keys, which is acceptable but
      narrower).

## Done (recent)

- [x] Per-vertical policy bundles surfaced in the admin Fleet UI — each tenant
      shows its signed bundle version + the workflow set it distributes
      (healthcare: clinical-session/med-admin; warehouse: pick-pack/controlled-area;
      global-fleet: field-session/vehicle-checkout). Reads `/api/cp/v1/policy-bundle`.

- [x] Signed policy bundles — config-down bundle is HMAC-signed (authenticity)
      on top of the checksum (integrity); edge verifies signature before applying,
      fail-closed on a checksum-valid forgery. Proofs updated (edge-sync 15/15,
      control-plane 17/17).

- [x] Telemetry-up wiring — real /v1 core decisions aggregated and ingested into
      the control-plane rollup (proof:telemetry-up, 7/7).
- [x] `/cp/v1` documented in the OpenAPI spec + Postman collection (with a
      lockstep coverage check for both `/v1` and `/cp/v1`).
- [x] Edge-sync contract proof — walks a node behind → synced (pull, verify
      checksum, reject tampered bundle fail-closed, apply, idempotent). 12/12.
- [x] Control-plane admin surface — "Fleet & tenants" page reading `/api/cp/v1/*`
      (rollup, per-vertical breakdown, edge-node sync + health across verticals).
- [x] SaaS control-plane scaffold (`@workspace/control-plane`) + `/cp/v1` routes
      + proof (3 verticals: healthcare / warehouse / global fleet).
- [x] WebAuthn step-up hardening (exact origin, User-Verification required).
- [x] Live `/v1` decision panel on the admin dashboard.
- [x] Admin console → api-server data layer; marketing site; deployment models;
      IGA adjacency; founder portfolio; multi-vertical narrative.
