# Repository layout & project stage

> **This is the canonical SignalGrid repository.** All active development happens
> here. The earlier `DanFashauer/DEV` and `DanFashauer/SignalGrid` (beta) repos
> are retired POC / concept and are superseded by this one (see *Legacy
> repositories* below). CI, the safety gate, CodeQL and Supply-Chain run on every
> pull request and on pushes to **`SignalGrid_Alpha`**, the default branch and the
> only long-lived branch that exists. The four tier branches this line named until
> 2026-09-02 were pruned; see *Tier branches* below and `docs/BRANCH_HYGIENE.md`.

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
artifacts/               21 tracked directories. 7 are runnable packages (each has a
                         package.json): api-server, mcp-server, signalgrid-app,
                         signalgrid-review, signalgrid-desktop, signalgrid-mobile-pwa,
                         signalgrid-web. The other 14 are EVIDENCE AND COORDINATION
                         surfaces, not apps: agent-heartbeats, api-collection,
                         build-loop, connector-emulator, lab-collections,
                         lane-messages, live-captures, live-evidence, outreach-log,
                         sbom, scanner-comparison, sim-requests, sim-results, sync.
                         (Derived 2026-09-02: `git ls-files artifacts | cut -d/ -f2
                         | sort -u`. The line here previously named six and omitted
                         signalgrid-review and every evidence surface.)
config/tiers/            dev / alpha / beta / prod environment examples (profiles,
                         not branches — see Tier branches below)
docs/                    Strategy, proofs, positioning, runbooks
scripts/                 Proof harnesses + tooling (pnpm run proof:*)
native/                  FOUR trees, not one: android/ (native port), desktop/,
                         ios/ (TWO Xcode apps — EnterpriseShell and SignalGridMobile),
                         shared/ (cross-port wire-conformance fixtures)
firmware/dock/           SmartDock firmware core
.github/workflows/       14 workflow files (`ls .github/workflows`, 2026-09-02):
                         review-hub-ci, supply-chain (SBOM + gitleaks + signing),
                         codeql, pages, ios-ci, android, desktop, firmware,
                         mac-lane, branch-prune, pr-triage, phase-pr-evidence,
                         connector-emulator-smoke, scheduled-verification
                         (promote was retired 2026-09-02 with the tier branches)
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

### `artifacts/` — runnable surfaces (7)

| Package | What it is |
| --- | --- |
| `api-server` | The Node control-plane + `/v1` decision API |
| `mcp-server` | The 16-tool MCP agent gateway |
| `signalgrid-app` | The operator web console |
| `signalgrid-desktop` | Tauri desktop shell |
| `signalgrid-mobile-pwa` | Mobile PWA surface |
| `signalgrid-review` | The public review hub app |
| `signalgrid-web` | The marketing/website surface |

## Tier branches — the tiers are configuration; the branches are gone

**Corrected 2026-09-02.** This section stated the four tier branches as existing,
flatly, in a table. They do not exist. `docs/BRANCH_HYGIENE.md` records them in the
prune list (`artifacts/sync/merged-branches-to-prune.txt`, lines 4/5/63/65, all four
pinned to the same tip `7ee88ef`) with the reason: *"They had not moved since
2026-07-15 and nothing in CI or the compose files referenced them; as stale pointers
they implied a promotion flow this repo does not run."* Verified 2026-09-02 with
`git ls-remote --heads origin`, which returns 16 refs — `SignalGrid_Alpha`, four
`claude/*`, ten `dependabot/*` and one `mac-sim-*` — and no `dev`, `alpha`, `beta`
or `prod`.

**What is real:**

- **One long-lived branch: `SignalGrid_Alpha`.** Everything merges there; CI, the
  safety gate, CodeQL, Supply-Chain and the Pages demo are wired to it. Topic
  branches are `claude/<topic>`, squash-merged and deleted
  (`docs/BRANCH_HYGIENE.md` §*The convention*).
- **The four TIERS are still real, as configuration.** `config/tiers/{dev,alpha,beta,prod}.env.example`
  exist; each environment sets `SIGNALGRID_TIER`, the api-server resolves it
  (`artifacts/api-server/src/lib/tier.ts`, defaulting to `dev`) and reports it at
  `GET /api/healthz`. `isLiveIntegrationsEnabled()` returns `false` for `dev`/`alpha`
  unconditionally and for `beta`/`prod` unless `SIGNALGRID_LIVE_INTEGRATIONS=true`,
  so live vendor calls only ever happen in an explicitly-configured beta/prod deploy.
  **A tier is a deployment profile, not a branch.**
- **The Promote Tier workflow is gone too.** `.github/workflows/promote.yml` was
  retired in the same sweep that pruned the branches: every promotion it could open
  had an empty diff, and a `workflow_dispatch` whose inputs all name refs that
  resolve to nothing can only fail. There is no automated promotion today.

Reconnecting the pipeline is an owner decision with three defensible answers, set out
in `docs/BRANCHING_AND_ENVIRONMENTS.md`. Until one is chosen, read the four-tier
diagram anywhere in these docs as **intent, not current state**.

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
