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

- [ ] **Data-center / NOC seeded tenant** — the only vertical still catalog-only.
      Seed a NOC tenant in BOTH the core (so the `data_center` app catalog gates
      live) and the control-plane (Fleet page / ops-intelligence), completing the
      six-vertical story end to end. Deferred deliberately; owner OK'd retail +
      industrial first.

- [ ] **DDM / device-health signal connector (macOS 27)** — a fixture-first
      connector that normalizes Declarative Device Management health reporting +
      binary-control / declarative-privacy posture into the decision dimensions
      the core already understands (device compliance, baseline alignment,
      posture freshness), raising assurance where warranted (e.g. off-baseline
      binary-control state nudges a sensitive action auto → step-up). Complements
      OS binary control rather than duplicating it. See
      `docs/MACOS_27_DDM_SIGNAL_OPPORTUNITY.md`. No live MDM calls.

## Next

- [ ] **In-app step-up completion (real, hardware-backed)** — releasing a held
      `step_up` action requires a REAL WebAuthn assertion verified by the hardened
      `@workspace/webauthn` path (challenge → native gesture → cryptographic
      verify → release), plus device enrollment. A public-safe fixture cannot
      genuinely provide hardware evidence, so the product API must NOT ship a
      release stand-in (an earlier HMAC-proof attempt was removed for exactly this
      reason). Until then, step-up completion is a clearly-labeled client-side
      SIMULATION in the demo UI (`completeAppStepUp`), never a server control.
- [ ] **Reposition `signalgrid-mobile-pwa` as operator/support (not a worker
      destination)** — the embedded-UX demo below now covers the worker-side
      reference (option a); the remaining reconciliation is to reframe the
      branded "My Access" app itself per `docs/EMBEDDED_UX_PRINCIPLE.md`.
- [ ] **Per-integration workflow templates** — a starter catalog an integrator
      clones per app, plus a validation lint.

## Owner-gated (needs a decision before an agent builds it)

_These need the owner's call — an agent should not act on them unsupervised._

- [ ] **IP / disclosure posture** ⚠️ **owner decision first.** Before ANY detailed
      invention material is committed, the owner must confirm repo **visibility**
      (public GitHub = a public disclosure that starts the US 12-month patent
      clock and can bar patents abroad). Decisions the owner owns: file a
      **provisional patent** for the embedded-on-dock method + retrofit module +
      phone-case/locker embodiments; **trademark** "SignalGrid"; entity
      formation; **LICENSE posture** (the repo currently has no explicit
      proprietary notice — changing to "all rights reserved" or adding a LICENSE
      is a business call). An agent MAY, once the owner OKs and confirms the repo
      is private (or a private location is chosen): draft an invention-disclosure
      document from the architecture, add copyright/CONFIDENTIAL headers, and
      write a tiered-disclosure kit (public one-pager vs. NDA-gated technical
      brief) + `docs/IP_AND_DISCLOSURE.md`. Do NOT commit a detailed provisional
      spec into a public repo.

## Later / vision

_(see `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md` for the full app-workflow roadmap)_

## Done (recent)

- [x] Preflight mirrors the docs-sanity CI job — the required-docs check + the
      affirmative-unsafe-claim scan are now a shared `scripts/docs-sanity.mjs`
      used by BOTH the CI `docs-sanity` job and `pnpm run preflight`. A doc that
      trips the unsafe-claim denylist now fails preflight before the push, not
      just in CI. Preflight is now a complete mirror of all three CI jobs
      (validation, docs-sanity, supply-chain). `pnpm run docs:sanity` added.

- [x] Embedded host-app demo (worker-side invisible flow) —
      `docs/embedded-host-app-demo.html` (published at `/embedded-demo.html`): a
      generic clinical app ("Wardlink Chart", no SignalGrid branding in the phone
      frame) showing the loop from the worker's view — open chart / view results
      run with no friction (allow), a controlled med order is **held** for a
      step-up, the app triggers a native-style authenticator, and only the
      captured gesture releases it. A "behind the glass" panel (never seen by the
      worker) shows the `allow` / `step_up` decision. Step-up completion is a
      clearly-labeled demo simulation. Self-contained, theme-aware, no external
      hosts; wired into the Pages deploy. Realizes option (a) of
      `docs/EMBEDDED_UX_PRINCIPLE.md`.

- [x] Control-plane management-plane for retail + industrial — the
      `@workspace/control-plane` fleet rollup now spans five verticals: added
      **Vero Markets** (retail) and **Forge Industrial** (industrial) tenants
      with sites, edge nodes, fleet devices (new `pos_terminal` / `hmi_panel`
      kinds), signed policy bundles (keys matching the core), and telemetry, so
      the admin **Fleet & tenants** page and ops-intelligence rollups show all
      five. `Vertical` union + `VERTICAL_LABEL` extended on both the lib and the
      app client; Fleet UI renders them automatically. proof:control-plane 26/26.
      Data-center/NOC remains catalog-only (its seeded tenant is the next item).

- [x] Invariant reviewer — public-safe-web check — `review:invariants` now also
      fails on any third-party vendor host (fonts / analytics / CDN) in a
      published web artifact (the Codex #81 font-CDN class), so a visitor's IP
      can't leak to a vendor. Self-host assets instead. Fifth invariant in
      `docs/SELF_REVIEW.md`.

- [x] signalgrid.app GitHub Pages deploy — the `Deploy site to Pages` workflow
      now publishes the `signalgrid-web` marketing site at the apex custom domain
      (base `/`), with the on-device console + battlecard preserved at
      `/console.html` and `/battlecard.html` and an SPA `404.html` fallback so
      deep links resolve. `site/CNAME` pins `signalgrid.app`. `docs/DOMAIN_SETUP.md`
      has the exact Namecheap DNS records (4× A + AAAA + `www` CNAME), the
      enforce-HTTPS / `.app` HSTS note, a WHOIS-privacy reminder, and a go-live
      checklist. Workflow stays manual (`workflow_dispatch`) — the owner runs it
      once after setting DNS + Pages source. Assemble verified locally.

- [x] Self-review layer — a second reviewer that runs BEFORE every push so a
      change is proven correct the first time (`docs/SELF_REVIEW.md`). Two parts:
      `pnpm run preflight` runs the whole CI gate suite locally in one command
      (typecheck / build / every proof / API test / safety / Postman sync), and
      `pnpm run review:invariants` is a deterministic adversarial reviewer that
      encodes the defect classes review keeps catching — fail-closed `default`
      arms in every gating-lib switch (Codex #70), determinism in the pure
      planners, critical⇒sensitive in the app catalog, and a truth-guard denylist
      for internal over-claims (Codex #79). Wired into CI. On its first run it
      caught two real fail-closed gaps (the app-workflow + orchestration
      `summarize` switches had no default arm) — now fixed.

- [x] Retail + industrial tenants in the core — two new seeded demo tenants
      (**Vero Markets** retail, **Forge Industrial** industrial) so the POS /
      age-rx-restricted and MES / SCADA-HMI app catalogs gate against a **live
      decision**, not a supplied one. Each has its own workflows (keys matching
      the app-workflows catalog: `pos-session`/`restricted-sale`, `line-ops`),
      shared-device policy, a spread of subjects (allow / restrict / step-up /
      deny), benign dock custody, webhooks, resolution config, and an owner demo
      key (`sgk_demo_vero_owner`, `sgk_demo_forge_owner`). Live in the admin
      App-workflows page. core proof 166/166 (relative counts), api test 110/110
      (+3 live retail/industrial gating assertions), safety gate green. The
      control-plane management rollup still shows three verticals — see "Now".

- [x] Data-center / NOC app catalog (P5) — a sixth vertical for
      `@workspace/app-workflows` gating the tools a NOC runs, with **uptime as
      the north star**: DCIM / change mgmt, network config, power / PDU, ITSM /
      incident, cooling / BMS, compute / orchestration. The uptime-affecting
      actions (execute a change, push config to a core device, power-cycle a
      rack, trigger a failover, bypass a change freeze) are `critical` → always
      sensitive: held for confirmation on allow, step-up when required, blocked
      under restriction/deny; reads/acks stay available so a NOC can always SEE
      even when it may not ACT. Confirmation phrased for the shift lead. Live in
      the admin App-workflows page; proof:app-workflows 41/41 (10 new NOC/uptime
      safety assertions). See `docs/APP_WORKFLOWS_OPPORTUNITY_MAP.md` §P5.

- [x] Admin "Grid intelligence" console — one calm surface (design law) tying
      flow-health/self-heal + learned recommendations + signal-discovery, read
      live from `/cp/v1`. Exceptions-first "Needs attention", advisory
      recommendations, and a discovery table that labels onboarding as a
      proposal (never a completed action). Route `/intelligence`.

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
