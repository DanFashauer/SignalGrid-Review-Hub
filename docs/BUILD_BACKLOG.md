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

- [ ] **Control-plane admin surface** — a "Fleet & tenants" page in `signalgrid-app`
      that reads `/api/cp/v1/*` (tenants, sites, edge nodes, fleet health, sync
      status) — the "one pane of glass" across verticals.
- [ ] **Edge-sync contract proof** — a small harness that walks a node from
      behind → synced using `/cp/v1/sync/:nodeId` + `/cp/v1/policy-bundle`,
      asserting checksum integrity end-to-end.
- [ ] **`/cp/v1` in the OpenAPI + Postman** — document the control-plane surface
      and add it to the generated Postman collection.

## Next

- [ ] **Telemetry-up from the decision plane** — have the `/v1` core emit a
      periodic telemetry batch the control plane ingests (wire the two planes).
- [ ] **Warehouse scenario pack** — add pick/pack + controlled-area scenarios to
      the room-sim/console so the demo isn't hospital-only.
- [ ] **Global-fleet scenario pack** — vehicle-mount checkout + cross-region
      session scenarios.
- [ ] **Per-vertical policy bundles** — model distinct bundles per vertical and
      show them distributing in the admin surface.

## Later / vision

- [ ] **Signed policy bundles** — sign the config-down bundle; verify signature
      at the edge before applying (fail closed).
- [ ] **Operational-intelligence rollups (Phase 3)** — friction hotspots,
      posture drift, custody gaps across sites, from ingested telemetry.
- [ ] **Attestation verification** — verify packed/fido-u2f attestation at
      registration (today: `none` self-attested keys, which is acceptable but
      narrower).

## Done (recent)

- [x] SaaS control-plane scaffold (`@workspace/control-plane`) + `/cp/v1` routes
      + proof (3 verticals: healthcare / warehouse / global fleet).
- [x] WebAuthn step-up hardening (exact origin, User-Verification required).
- [x] Live `/v1` decision panel on the admin dashboard.
- [x] Admin console → api-server data layer; marketing site; deployment models;
      IGA adjacency; founder portfolio; multi-vertical narrative.
