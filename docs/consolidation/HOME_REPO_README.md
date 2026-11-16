<!--
  DRAFT — post-cutover README for the DanFashauer/SignalGrid home repo.
  Phase 6 Section 7 copies this to the home repo's README.md at cutover:
      cp docs/consolidation/HOME_REPO_README.md README.md
  It intentionally replaces the "Review Hub" README, which described a
  pre-production review surface that no longer applies once SignalGrid is the
  consolidated production home. Kept as a draft here so nothing is destroyed
  before cutover and the text is reviewable.
-->


> **SUPERSEDED 2026-08-19 — do not execute.** The Phase 6 cutover these records prepared plans the OPPOSITE of the current decision (`docs/PHASE6_CUTOVER_RUNBOOK.md` carries the same banner): `SignalGrid-Review-Hub` is the maintained tree and `DanFashauer/SignalGrid` is legacy, retirement-pending. Kept as a dated record (issues snapshot 2026-07-14); nothing here is pending.
# SignalGrid

**Operational Trust Orchestration — a runtime decision layer for shared, mobile,
and frontline devices.** At the moment a workflow fires, SignalGrid fuses live
evidence into a single **allow / step-up / restrict / deny** decision, with an
audit trail for every call.

> **What the core evaluates today:** identity state, device posture, physical
> custody (DockBridge dock/charge/tamper), security-baseline (CIS) alignment, and
> badge binding — combined with device-owner type and workflow risk. Broader
> categories (network/cellular, session/shift, operational SIEM/ITSM streams) are
> catalogued as candidates, **not** decision inputs today. The exact
> implemented-vs-candidate boundary is in
> [`docs/WHAT_SIGNALGRID_DOES_TODAY.md`](docs/WHAT_SIGNALGRID_DOES_TODAY.md).

---

## This is the consolidated home

This repository is the single production home for SignalGrid, consolidated from
three sources with full git history preserved:

| Source | Contributed | Status |
| ------ | ----------- | ------ |
| `SignalGrid-Review-Hub` | Deterministic decision core, app shells, product docs (the clean baseline) | archived |
| `DEV` | Real-world integration adapters, audit ledger, WebAuthn, location, the iOS badge shell | archived |
| `SignalGrid` (this repo) | Original home; history retained as ancestry | **home** |

How the merge was done and how to reproduce it is documented in
[`docs/PHASE6_CUTOVER_RUNBOOK.md`](docs/PHASE6_CUTOVER_RUNBOOK.md). (The harvest
inventory doc was retired 2026-08-10 once the merge it described was long done.)

---

## Layout

```
lib/                       Source-only @workspace/* packages (TypeScript project refs)
  signalgrid-core            Deterministic decision core (injected clock, no Date.now/Math.random)
  integrations               ITSM / UEM / NAC / SIEM / EDR adapters (fixture-safe by default)
  integration-bridge         FleetDM (osquery) posture → normalized core signals
  audit                      Hash-chained, tamper-evident audit ledger
  webauthn                   Passkeys + step-up — real CBOR/COSE + ES256/RS256 assertion verification, exact-origin, User-Verification-required, counter clone-detection (proof: proof:webauthn-verify)
  location                   Vendor-neutral presence / coarse / precise signals
  api-client-react           Generated typed API client + hooks
  api-spec                   /v1 OpenAPI contract
artifacts/
  api-server                 /v1 decision API (runs without a database)
  signalgrid-app             Operator console (admin)
  signalgrid-mobile-pwa      Operator/support mobile surface
  signalgrid-desktop         Desktop shell
  signalgrid-review          Public review / operator-console site
  signalgrid-web             Company website (marketing + About)
native/ios                   EnterpriseShell — BLE/USB-C badge login (Swift; built on macOS CI)
config/tiers                 Public-safe per-tier env examples
docs/                        Product, security, and consolidation documentation
```

## Four-tier pipeline

Code promotes upward only, via PR, after CI is green:

```
dev  ──▶  alpha  ──▶  beta  ──▶  prod
(default)                        (protected)
```

| Tier | Live integrations |
| ---- | ----------------- |
| `dev`, `alpha` | **Never** — always fixture-safe |
| `beta`, `prod` | Gated: only with `SIGNALGRID_LIVE_INTEGRATIONS=true` **and** real creds |

Details: [`docs/BRANCHING_AND_ENVIRONMENTS.md`](docs/BRANCHING_AND_ENVIRONMENTS.md).

> The tier **branches** and the **Promote Tier** workflow that opened promotion
> PRs between them were retired on 2026-09-02 (see `docs/BRANCH_HYGIENE.md`);
> the tiers above survive as deployment **environments**, selected by
> `SIGNALGRID_TIER`. Promotion is a manual PR until a replacement workflow
> exists.

## Quickstart

```bash
pnpm install
pnpm -w run build           # all packages + apps
pnpm run typecheck          # tsc --build across the workspace

# Proof / tests
pnpm run proof:signalgrid-core   # deterministic core (tenancy, policy, decision, evidence, audit)
pnpm run test:api                # /v1 API integration
pnpm run proof:api-contract      # OpenAPI contract

# Run the decision API (no database required)
pnpm --filter @workspace/api-server run dev
# → GET /api/healthz  reports { status, tier, liveIntegrations }
# → POST /api/v1/decisions/evaluate  with a demo Bearer key
```

## Guardrails (always on)

- **Fixture-safe by default.** No secrets, tenant IDs, or PII/PHI in git. The
  simulator and CI are deterministic and offline.
- **Live vendor/Graph/API calls are gated** to `beta`/`prod` deploys that both set
  `SIGNALGRID_LIVE_INTEGRATIONS=true` and supply real credentials (environment
  secrets, added by hand — never committed). `config/tiers/*.env.example` are
  placeholders only.
- **High-risk remediation is approval-gated and simulated** unless separately
  validated.

## Documentation

- Start here: [`docs/INDEX.md`](docs/INDEX.md)
- What it does today: [`docs/WHAT_SIGNALGRID_DOES_TODAY.md`](docs/WHAT_SIGNALGRID_DOES_TODAY.md)
- Product core: [`docs/PRODUCT_CORE_FOUNDATION.md`](docs/PRODUCT_CORE_FOUNDATION.md) ·
  [data model](docs/PRODUCT_DATA_MODEL.md) ·
  [threat model](docs/PRODUCT_CORE_THREAT_MODEL.md) ·
  [security controls](docs/SECURITY_CONTROLS_MATRIX.md)
- Category definition: [`docs/OPERATIONAL_TRUST_ORCHESTRATION.md`](docs/OPERATIONAL_TRUST_ORCHESTRATION.md)
- Branching & environments: [`docs/BRANCHING_AND_ENVIRONMENTS.md`](docs/BRANCHING_AND_ENVIRONMENTS.md)
- Consolidation & cutover: [`docs/PHASE6_CUTOVER_RUNBOOK.md`](docs/PHASE6_CUTOVER_RUNBOOK.md)
- Agent guardrails: [`AGENTS.md`](AGENTS.md)

## Founder

Built by **Daniel Fashauer**.
[LinkedIn](https://www.linkedin.com/in/daniel-fashauer-a0148278) ·
[GitHub](https://github.com/DanFashauer)

---

## Disclaimer

SignalGrid is not production-ready, not compliance-certified, and not a
replacement for IAM, UEM, DEX, RMM, monitoring, observability, SIEM, ITSM, MDM,
NAC, or other source systems. Remediation concepts are simulated, constrained, or
operator-approved unless separately validated. No current partner certification,
partnership, or alliance status is claimed with any listed vendor.
