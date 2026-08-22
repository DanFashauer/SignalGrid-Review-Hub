# Repository layout & project stage

> **This is the canonical SignalGrid repository.** All active development happens
> here. The earlier `DanFashauer/DEV` and `DanFashauer/SignalGrid` (beta) repos
> are retired POC / concept and are superseded by this one (see *Legacy
> repositories* below). CI, the safety gate, CodeQL, and Supply-Chain run across
> the `dev` / `alpha` / `beta` / `prod` tier branches.

## Project stage — concept / pre-dev

**SignalGrid is at an early concept / pre-development stage.** This repository is
a working, public-safe **prototype and review surface** — deterministic fixtures,
proof harnesses, review apps, docs, and a live on-device demo — that explains and
validates the SignalGrid direction. It is **not** production software, not
compliance-certified, and not a customer deployment. Treat everything here as a
buildable concept moving toward a first real pilot, not a shipped product.

## One consolidated monorepo (this repo is current)

The work that used to live across separate repositories is now consolidated into
this single monorepo, so there is one source of truth for the core, apps, API,
control plane, and docs.

### Legacy repositories — superseded

The following earlier repositories are **legacy**: they represent the original
**pre-dev / concept** stage and are **superseded by this consolidated monorepo**.
They are kept only for history; new work happens here.

| Legacy repo | Was | Status |
|---|---|---|
| `DanFashauer/DEV` | Early "home" / dev workspace | **Legacy — pre-dev / concept; superseded by this repo** |
| `DanFashauer/SignalGrid` | "SignalGrid-Beta" repo | **Legacy — pre-dev / concept; superseded by this repo** |

> `DanFashauer/VaultLens` is a separate, unrelated side project (a collectibles
> app) — not part of SignalGrid.

Package layout of this consolidated repo:

```
lib/        Source-only @workspace/* packages (TypeScript project refs)
  signalgrid-core        Deterministic decision core (injected clock; no Date.now/Math.random)
  orchestration          Trust → Action planner (allow/step-up/restrict/deny + Assist)
  room-sim               Trusted Room Entry scenarios
  signal-radar           New-signal detection (evaluated / candidate / novel)
  control-plane          SaaS control plane (tenants, fleet, config-down, telemetry-up)
  webauthn               Passkeys + step-up (real CBOR/COSE + ES256/RS256, UV-required)
  audit                  Hash-chained, tamper-evident audit ledger
  integrations           Harvested vendor adapters (ITSM/UEM/NAC/SIEM/EDR), fixture-safe
  api-spec               /v1 + /cp/v1 OpenAPI contract
  api-client-react       Generated typed client + hooks
artifacts/  Runnable apps: api-server, admin app, mobile PWA, desktop, web, MCP server
config/tiers/            dev / alpha / beta / prod environment examples
docs/                    Strategy, proofs, positioning, runbooks
scripts/                 Proof harnesses + tooling (pnpm run proof:*)
native/ios/              EnterpriseShell (BLE / USB-C badge) — hardware design concept
.github/workflows/       CI, safety gate, CodeQL, SBOM, gitleaks, Pages, promote-tier
```

## The packages — all 43, derived not curated

Counted from `lib/*/package.json` + `artifacts/*/package.json` on 2026-08-22;
one-liners come from each package's own source header where one exists. The
code is the truth — a one-liner that drifts gets fixed by reading the source,
not by trusting this table. (`scripts/` is a 44th workspace package holding
the proof harnesses and gates.)

### `lib/` — the decision fabric (35)

| Package | What it is |
| --- | --- |
| `adaptive-proposals` | The governed lifecycle around a recommendation |
| `api-client-react` | React client bindings for the /v1 API |
| `api-spec` | The OpenAPI contract (`v1-openapi.yaml`) |
| `api-zod` | Zod schemas mirroring the API contract |
| `app-workflows` | Public-safe catalog of integrated application workflows, by vertical |
| `audit` | Audit ledger storage backends |
| `control-plane` | Control-plane bundles, checksums, seeded refs |
| `ddm-connector` | Apple Declarative Device Management schema alignment |
| `dual-control` | Two-person approval flows |
| `enterprise-auth` | JWT/OIDC parsing and enterprise auth helpers |
| `event-contract` | Shared event-shape contract between surfaces |
| `facility-trust-graph` | Facility/room/bed context graph (clinical phases) |
| `fleet-connector` | The read half of the SignalGrid↔Fleet loop |
| `flows` | Application resilience — keep staff working when a cloud app wobbles |
| `handoff-sim` | Deterministic cross-device handoff simulation |
| `iac` | Public-safe infrastructure-as-code demo fixtures |
| `incident-playbook` | Deterministic mapping from a decision to an incident playbook |
| `integration-bridge` | The source-agnostic device-management evidence contract |
| `integrations` | The connector families (graph, headwind, fleet, radius, wazuh…) |
| `location` | Location/zone evidence |
| `orchestration` | The "trust + orchestration = action" layer |
| `persistence` | Durable decision + evidence store (production persistence) |
| `pim-activation` | Privileged-identity activation flows |
| `posture-composition` | Composes posture evidence; task-exception subpath |
| `recommendations` | Public-safe observed-usage fixtures for the demo flows |
| `reliability` | SLOs and error budgets for the decision plane |
| `room-sim` | Client-side Trusted Room Entry console |
| `self-audit` | The fail-closed self-audit checklist runner |
| `signal-discovery` | Discovery fixtures: connected sources and raw signals |
| `signal-radar` | "Watch the edges of the grid" — signal coverage radar |
| `signalgrid-core` | The deterministic decision core |
| `signalgrid-simulator` | The real-life simulator the proofs and iOS port share |
| `verdict-attestation` | Signing/attestation of decision verdicts |
| `webauthn` | FIDO2/passkey registration + authentication |
| `work-context` | Fabric verdict summaries in, portable work context out |

### `artifacts/` — runnable surfaces (8)

| Package | What it is |
| --- | --- |
| `api-server` | The Node control-plane + `/v1` decision API |
| `mcp-server` | The 16-tool MCP agent gateway |
| `mockup-sandbox` | Design mockup sandbox |
| `signalgrid-app` | The operator web console |
| `signalgrid-desktop` | Tauri desktop shell |
| `signalgrid-mobile-pwa` | Mobile PWA surface |
| `signalgrid-review` | The public review hub app |
| `signalgrid-web` | The marketing/website surface |

## Tier branches — dev → alpha → beta → prod

The four-tier buildout is reflected as branches, promoted upward. Each tier runs
the **same code** with a different environment profile
(`config/tiers/<tier>.env.example`); live vendor integrations stay **gated off**
until a `beta`/`prod` deployment explicitly enables them with real credentials.

| Branch | Tier | Purpose | Live integrations |
|---|---|---|---|
| `dev` | dev | Active development, fastest iteration | off (fixtures only) |
| `alpha` | alpha | Review / validation surface (this is where CI + Pages are wired today, as `SignalGrid_Alpha`) | off (fixtures only) |
| `beta` | beta | Pilot-facing, real credentials behind an explicit env flag | opt-in |
| `prod` | prod | Production profile (concept — no live deployment today) | opt-in |

Promotion flows one step upward (`dev → alpha → beta → prod`) via the
**Promote Tier** workflow, which opens a promotion PR for review — nothing is
promoted blindly.

> Note: `SignalGrid_Alpha` is the current default/working branch where CI, the
> safety gate, and the Pages demo are wired. The `dev`/`alpha`/`beta`/`prod`
> branches make the promotion pipeline explicit; branch protection and the
> default-branch choice are owner settings.

## What is intentionally *not* here

- No secrets, tenant IDs, PHI/PII, or customer data.
- No live vendor / Microsoft Graph / production API calls by default.
- No production-readiness, compliance, certification, partnership, or
  replacement claims.
- Protected production-core implementation detail is kept separate from this
  public review surface.

See also: [`DEPLOYMENT_MODELS.md`](./DEPLOYMENT_MODELS.md) (SaaS vs on-prem, the
control-plane/decision-plane split) and [`AGENTS.md`](../AGENTS.md) (repo-wide
guardrails).
