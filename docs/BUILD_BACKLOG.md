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

- [ ] **Data-center / NOC app catalog** — a new vertical for `@workspace/app-workflows`
      gating the tools a NOC uses, with uptime as the north star: DCIM / change
      management, network config push, power / PDU control, ITSM incident, remote
      hands / BMS. The uptime-affecting actions (config push, power-cycle, failover,
      change-freeze bypass) are critical → held for confirmation/step-up. See
      `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md`.
- [ ] **Retail + industrial tenants in the core** — seed two more demo tenants so
      the retail (POS / restricted-sale) and industrial (MES / SCADA-HMI) app
      catalogs gate live, not catalog-only. Same pattern as the Meridian add.

## Next

- [ ] **In-app step-up completion (real, hardware-backed)** — releasing a held
      `step_up` action requires a REAL WebAuthn assertion verified by the hardened
      `@workspace/webauthn` path (challenge → native gesture → cryptographic
      verify → release), plus device enrollment. A public-safe fixture cannot
      genuinely provide hardware evidence, so the product API must NOT ship a
      release stand-in (an earlier HMAC-proof attempt was removed for exactly this
      reason). Until then, step-up completion is a clearly-labeled client-side
      SIMULATION in the demo UI (`completeAppStepUp`), never a server control.
- [ ] **Embedded host-app demo UI (worker-side invisible flow)** — a mock host
      app (e.g. a generic clinical app, no SignalGrid branding) that shows the loop
      from the worker's view: normal use → a held action → a native prompt →
      proceed, with the step-up completion clearly labeled as a demo simulation.
      Reframes `artifacts/signalgrid-mobile-pwa` per `docs/EMBEDDED_UX_PRINCIPLE.md`.
- [ ] **Per-integration workflow templates** — a starter catalog an integrator
      clones per app, plus a validation lint.

## Later / vision

_(see `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md` for the full app-workflow roadmap)_

## Done (recent)

- [x] Signal discovery + auto-onboarding (`@workspace/signal-discovery`) — tells
      admins what signals were detected across connected sources, classifies each
      (recognised / candidate / novel via signal-radar), and **auto-onboards** an
      unrecognised signal when its source exposes an API/connector — otherwise
      flags it for an admin (never silently added). Signal lifecycle
      (discovered → proposed → onboarded → active). Read API
      `GET /cp/v1/signal-discovery`; proof:signal-discovery 16/16. The more
      sources/APIs a business opens, the more the Grid sees and uses.

- [x] Recommendations engine (`@workspace/recommendations`) — the Grid learns from
      observed usage and PROPOSES improvements (never applies): relax a gate that's
      always approved on healthy posture (one step), tighten an action showing
      denials/overrides, add a candidate signal to a flow that keeps breaking or
      runs hot, merge near-duplicate flows. Evidence-gated (min-sample threshold),
      confidence-ranked, advisory only. Read API `GET /cp/v1/recommendations`;
      proof:recommendations 15/15.

- [x] Apple-inspired admin design law (`docs/ADMIN_DESIGN_PRINCIPLE.md`) —
      progressive disclosure, only-necessary-data, one source of truth, cross-
      surface consistency, calm-by-default; the test every admin surface must pass.

- [x] Admin flow layer (`@workspace/flows`) — administrators configure signals +
      flows; the Grid runs them. Per-action approval policy (automated / admin /
      dual / downtime-only user override with DR safety nets); flow + signal health
      (healthy / degraded / broken); a broken flow **self-heals** via a configured
      agent **or** raises an **ITSM-agnostic incident** (severity, support team,
      target ITSM named, never called); a grid-intelligence score that rises as
      more healthy signals feed more flows. Read API `GET /cp/v1/flows` +
      `/cp/v1/flows/health`; proof:flows 26/26. See `docs/ADMIN_FLOWS.md`.

- [x] Embedded-UX design law captured (`docs/EMBEDDED_UX_PRINCIPLE.md`) — the end
      user never touches SignalGrid; everything happens inside the host app, for
      every role (frontline to CEO) and every platform (mobile / web / macOS /
      Windows). The `/v1/app-workflows/evaluate` product endpoint returns the plan
      AS DECIDED — a `step_up` keeps its high-assurance actions held; the API never
      releases them from a request-supplied signal.

- [x] App-workflow gating (`@workspace/app-workflows`) — SignalGrid now gates
      APPLICATION actions, not just physical ones: an app calls it before a
      sensitive action and gets back which of its actions may run automatically
      vs. which must be human-confirmed (Assist model), from a live decision.
      Catalog spans five verticals (healthcare EMR/BCMA/messaging/alarms;
      warehouse WMS/labor; industrial MES-HMI; fleet TMS/ELD/telematics; retail
      POS/restricted). New `GET /v1/app-workflows/integrations` +
      `POST /v1/app-workflows/evaluate` (OpenAPI + Postman), an "App workflows"
      admin page with live per-vertical gating, and `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md`.
      Proof: app-workflows 31/31 (incl. real-core EMR/BCMA end-to-end), api test 106/106.

- [x] Operational-intelligence rollups (Phase 3) — `operationalIntelligence()`
      on the control plane derives friction hotspots (from ingested telemetry),
      posture/config drift (nodes behind target bundle), and custody gaps
      (unreachable/degraded or stale-sync nodes) across sites, tenant-scoped.
      Exposed at `GET /cp/v1/ops-intelligence` (OpenAPI + Postman) and surfaced
      as a three-panel card on the admin Fleet page. Proof: control-plane 23/23.

- [x] Attestation verification — registration now verifies the attestation
      STATEMENT, not just the credential key. `none` (self-attested) is accepted;
      `packed` and `fido-u2f` are cryptographically verified (authData ||
      SHA-256(clientDataJSON), self- or x5c-attestation); any other format or a
      bad signature is refused (fail-closed). Proof: webauthn-verify 14/14
      (valid packed accepted; forged sig, alg/key mismatch, unsupported format,
      malformed none, malformed fido-u2f all rejected).

- [x] Global-fleet scenario pack — a third vertical (Meridian) added to the core
      seed and the Trusted-Entry runner + console: vehicle-mount field session and
      cross-region regulated-cargo checkout, across the full allow / step-up /
      restrict / deny spectrum. Fleet orchestration catalog (vehicle unlock,
      mount session, TMS route, cargo seal, dispatcher co-sign) + dispatcher
      confirmation language, cross-tenant fail-closed. Proof: room-sim 39/39,
      orchestration 40/40, core 166/166.

- [x] Warehouse scenario pack — the Trusted-Entry runner + on-device console now
      span two verticals: smart-hospital (Northwind) and warehouse (Atlas), with
      pick-aisle and controlled high-value/hazmat cage scenarios across the full
      allow / step-up / restrict / deny spectrum. Domain-aware orchestration
      catalog (zone gate, handheld, WES/WMS task, cage, supervisor witness) +
      confirmation language, cross-tenant fail-closed. Proof: room-sim 22/22,
      orchestration 35/35. (Also fixed a pre-existing api-contract parser bug
      where `/cp/v1/*` methods leaked onto the last `/v1` path.)

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
