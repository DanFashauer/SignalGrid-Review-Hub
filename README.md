# SignalGrid Review Hub

The public, pre-production working repository for **SignalGrid**. Everything
here is fixture-backed and public-safe: no secrets, no tenant identifiers, no
customer data, and no live vendor calls unless a proof is explicitly opted in.

## What SignalGrid is

[`docs/PURPOSE.md`](docs/PURPOSE.md) owns the product sentence (DR-020); this
README references it and does not restate it. No category label is ratified — every
earlier label is retired, and this file does not coin a new one.

Inside a host app the mechanism is the Assist gate <!-- framing:mechanism -->:
the host asks whether a workflow may proceed and receives one of four verdicts,
`allow` / `step_up` / `restrict` / `deny` (the exact wire vocabulary lives in
[`lib/signalgrid-core/src/policy.ts`](lib/signalgrid-core/src/policy.ts)),
wrapped in a reconstructable `DecisionEnvelope`. The gate is deterministic —
same normalised inputs and policy version, same verdict — and fail-closed: a
missing, stale or unreachable signal raises the assurance required, never
lowers it. End users never see SignalGrid; they use their own host app.

What it is not (CLAUDE.md golden rules 3 and 4):

- **Not an MDM.** An app cannot grant device access, restrict other apps, make
  itself non-removable or self-kiosk. Those are OS/MDM capabilities on a
  supervised device; Fleet is the MDM used in the lab (`fleet/`).
- **Not domain safety.** Patient lookup, clinical guidelines and every other
  vertical rule belong in the host app. Nothing industry-specific enters the
  core.
- **Not on-device enforcement proven from a simulator.** A simulator cannot be
  MDM-enrolled, so nothing run on one says anything about enforcement.
- **Not a system of record.** IAM, UEM, MDM, ITSM, SIEM and NAC stay
  authoritative; SignalGrid reads before it writes and delegates action.

## Repository layout

A pnpm workspace (`pnpm-workspace.yaml`: `lib/*`, `artifacts/*`, `scripts`),
Node 22, TypeScript project references. Package one-liners are derived from
the tree; [`docs/REPO_LAYOUT.md`](docs/REPO_LAYOUT.md) carries the full table.

| Path | What it is |
| --- | --- |
| `lib/` | Source-only `@workspace/*` packages — the decision fabric (see below). |
| `artifacts/api-server` | The Node control plane and `/v1` decision API; the product surface. |
| `artifacts/signalgrid-app` | The operator console, bound to the served `/v1` API. |
| `artifacts/signalgrid-review` | The zero-network review deck (demo-only per the launch profile). |
| `artifacts/signalgrid-web` | The public website source. |
| `artifacts/signalgrid-desktop` | The desktop-shaped operator console (Vite web app). |
| `artifacts/signalgrid-mobile-pwa` | The mobile PWA surface. |
| `artifacts/mcp-server` | The read-only MCP gateway ([`docs/MCP_SECURITY_MODEL.md`](docs/MCP_SECURITY_MODEL.md)). |
| `artifacts/*` (data) | Committed records, not packages: `lane-messages`, `sim-requests`, `sim-results`, `live-evidence`, `live-captures`, `api-collection` and `lab-collections` (Bruno), `agent-heartbeats`, `outreach-log`, `sbom`, `scanner-comparison`, `connector-emulator`, `build-loop`, `sync` (generated manifests and pins). |
| `scripts/` | Proof harnesses (`pnpm run proof:*`), the gate suite, `scripts/preflight.mjs`, `scripts/verify-breadth.mjs`, the lane and simulation tooling. |
| `native/ios` | Two apps: `EnterpriseShell` (the host-app reference with the gate inside) and `SignalGridMobile` (`SignalGridOperator` + `WardlinkDemo`). |
| `native/android`, `native/desktop` | Kotlin and Rust/Tauri Assist clients; deferred surfaces, kept and CI-built. |
| `native/shared` | The one wire-conformance case set every client must agree on. |
| `firmware/dock` | SmartDock firmware core (Rust, `no_std`): sensor readings to a custody event. A deferred surface. |
| `docs/` | Product, design and operating docs — the de-facto PRD. Start at [`docs/INDEX.md`](docs/INDEX.md). |
| `third_party/` | Vendored developer tooling (a Claude Code skill pack); not product code, not shipped. |
| `config/` | Tier environment examples (`config/tiers`) and the example grid config (`config/grid`). |
| `fixtures/`, `fleet/`, `tests/`, `tools/` | Public-safe Graph fixtures; example Fleet config; harvested security test specs and load tests; the self-contained room-console and evidence-coverage pages. |
| `site/`, `docker/`, `docker-compose.*.yml` | GitHub Pages landing, nginx config, and the compose stacks CI smoke-tests. |
| `.github/workflows` | Review Hub CI, breadth lane, Apple lane, Android, desktop, firmware, supply chain, CodeQL, Pages. |

`lib/` grouped by role (all 35 are listed in `docs/REPO_LAYOUT.md`):

| Group | Packages |
| --- | --- |
| Decision core | `signalgrid-core`, `signalgrid-simulator`, `orchestration`, `posture-composition`, `incident-playbook`, `self-audit`, `reliability`, `verdict-attestation` |
| Contract | `api-spec` (`lib/api-spec/v1-openapi.yaml`), `api-zod`, `api-client-react`, `event-contract` |
| Identity and step-up | `enterprise-auth`, `webauthn`, `pim-activation`, `dual-control` |
| Connectors and evidence | `integrations`, `integration-bridge`, `fleet-connector`, `ddm-connector`, `signal-discovery`, `signal-radar`, `location`, `facility-trust-graph` — most families are deferred; see the launch profile |
| Flows and workflows | `flows`, `app-workflows`, `work-context`, `handoff-sim`, `room-sim`, `recommendations`, `adaptive-proposals`, `iac` ([`docs/IAC_GITOPS.md`](docs/IAC_GITOPS.md)) |
| Persistence and control plane | `persistence`, `audit`, `control-plane` |

## How to run it

```bash
pnpm install --frozen-lockfile                          # Node 22, pnpm (see packageManager)
PORT=8080 pnpm --filter @workspace/api-server run dev   # /v1 API + console at /console; PORT is required
pnpm run dev:simulator                                   # review UI + API together (5173 / 5174)
pnpm run proof:signalgrid-simulator                      # one proof; every proof is a proof:* script
pnpm run typecheck && pnpm run review:invariants         # the two cheapest gates
```

The api-server runs without a database; fixtures back every decision. The
in-browser consoles ([`docs/room-entry-console.html`](docs/room-entry-console.html),
[`docs/fabric-console.html`](docs/fabric-console.html)) need no install at all
and are demo surfaces, not shipping product.

**The harness and the lanes.**

```bash
./validate-sim-macos.sh          # macOS: every proof:* natively; read "== SUMMARY: N passed, M failed ==" and compare M to 0
node scripts/preflight.mjs       # the per-push gate lane CI mirrors (--quick skips heavy builds)
pnpm run verify:breadth          # deferred connector families + doctrine proofs; its own CI job
```

The harness enumerates proofs only; preflight also runs the non-proof gates
(figure guard, launch profile, parity checks, registries, publication
boundary). Run both before pushing anything that touches gates, docs figures
or the launch surface. Details: [`docs/CI_AND_VALIDATION.md`](docs/CI_AND_VALIDATION.md).

**Toolchain wrinkle.** `pnpm-workspace.yaml` strips every native binary except
linux-x64-gnu, so `pnpm run build` (the Vite web build) runs only on linux-x64
or in CI; `validate-sim-macos.sh` supplies the darwin binaries for its own run.
Shell scripts must stay bash 3.2 compatible (see CLAUDE.md).

**Postgres proofs.** `proof:*-pg`, `proof:db-role-split` and
`proof:backup-restore` DROP the tables they test and re-password a cluster-wide
role, so they refuse (exit 1, never a silent skip) unless
`SIGNALGRID_DB_DISPOSABLE=1` declares the whole cluster at `DATABASE_URL`
throwaway. `pnpm run verify:docker` provisions such a cluster itself. See
[`docs/BACKUP_AND_RESTORE.md`](docs/BACKUP_AND_RESTORE.md).

**Touched the api-server?** `pnpm --filter @workspace/api-server run test:api`
must print every assertion green (`N/N`). Changed a package's dependencies?
`pnpm install --lockfile-only` and commit `pnpm-lock.yaml` — `.githooks/pre-push`
refuses a mismatched lockfile.

## How it is proven

The ladder, cheapest first; stop at the first failure:

| Rung | Command | What green means |
| --- | --- | --- |
| 1 | `pnpm run typecheck` | The project references compile. |
| 2 | `pnpm run review:invariants` | No `Date.now()`/`Math.random()` in decision paths; fail-closed and truthful-status invariants hold. |
| 3 | `pnpm run proof:signalgrid-core` (any `proof:*` script) | One fixture-backed proof passes with its printed check count. |
| 4 | `pnpm --filter @workspace/api-server run test:api` | The served `/v1` surface, every assertion. |
| 5 | `node scripts/preflight.mjs` | Every registered gate; `scripts/check-preflight-ci-parity.mjs` fails CI if a gate is registered but unwired. Mirrors the CI jobs that need no external service — Postgres, the compose smoke and the secret scan run only in CI. |
| 6 | `pnpm run verify:breadth` | The deferred families and doctrine proofs, held disjoint from preflight. |

**What green does not mean.** A gate checks an invariant; it does not mean
the code has been read. `scripts/check-review-coverage.mjs` prints review
coverage beside every green preflight for exactly that reason, and a green
harness is narrower than a green preflight. A proof that refuses (a missing
server, a non-disposable database) exits 1 by name; nothing skips silently.

The fail-closed doctrine, in three lines:

1. Unknown, stale or unreachable raises assurance; it never lowers it.
2. The same inputs and policy version always produce the same verdict.
3. Status is reported as measured — a failing gate is failing, and a claim
   that cannot be checked is not made.

**Provenance.** Every `artifacts/sim-results/*.json` records the commit and
`workingTreeClean` (untracked files included) sampled *before* the run by
`scripts/mac/run-requests.mjs`; a result from a dirty tree says so. Live
evidence (`artifacts/live-evidence/mac-run.json`) can be refreshed only by the
Mac lane's `pnpm run verify:all --require-mcp --emit-evidence`, never from CI.

## How the repository is operated

**The layered model (DR-024, owner-directed).** Ponytail runs on top as the
minimalism lens — its cut list is executed, bounded by its own never-cut rules
and this repository's gates. ECC runs second (correctness, security, test
discipline; it advises, and only the gates make a run green). The owner's own builds are scanned by
both. The repository's independent scan then covers what neither targets:
fail-closed inversions, contract drift, runtime truth, claim discipline. Last,
the findings converge and are built, gated (`preflight` + `verify:breadth`),
PR'd and merged. The owner is hands-off except for approvals and access.
Installers: `pnpm run ponytail:install`, `pnpm run ecc:install` (pinned, opt-in,
hooks off).

**Two lanes, one repository.** A cloud lane (decision fabric, proofs, docs)
and a Mac lane (iOS, the harness, benches, hardware operations) work in
parallel and cannot message each other; git is the bus. Protocol:
[`docs/LANE_COORDINATION.md`](docs/LANE_COORDINATION.md). Channels:

| Channel | Commands | Rule |
| --- | --- | --- |
| Lane messages (`artifacts/lane-messages/`) | `pnpm run lane:inbox` first every session; `lane:send`, `lane:ack` | Only the addressee closes a message; the push is the delivery. |
| Simulation requests (`artifacts/sim-requests/` → `artifacts/sim-results/`) | `pnpm run sim:run-requests` on the Mac; `node scripts/check-sim-requests.mjs` for what is owed | A refusal or skip never closes a request. See [`docs/LIVE_SYNC_LOOP.md`](docs/LIVE_SYNC_LOOP.md). |
| Session state | `pnpm run loop:state`; [`docs/agent/LOOP.md`](docs/agent/LOOP.md) | Read at start, update last. |

**Memory substrate (DR-026).** Neural Memory is installed as an MCP server
only — pinned, hooks off, store outside the tree (`pnpm run
neural-memory:install`). It holds operating memory (a gate's quirk, a lane's
state); the committed docs and decision records remain the memory of record,
and nothing in `lib/*`, the api-server or any proof may read it.

**Claim registries.** `docs/agent/FALSE_CLAIMS.json` holds every claim that
proved false, with the refutation; `pnpm run check:false-claims` fails if a
document re-states one. Before writing that anything is absent, run
`pnpm run check:absence <topic>` and read the matches yourself — two in-repo
documents have declared a surface missing while it sat in the tree.
[`docs/DECISION_RECORDS.md`](docs/DECISION_RECORDS.md) records each call with
its evidence and reversal path.

## Status, honestly

Scope is held as data in `scripts/launch-profile.mjs` and published by
`pnpm run proof:launch-profile`; `scripts/check-launch-profile.mjs` fails the
build if the profile and the tree disagree in either direction. Read
[`docs/LAUNCH_PROFILE.md`](docs/LAUNCH_PROFILE.md) before reading any of this
as readiness.

**Limited GA is deliberately narrow:** one read-only Entra/Intune connector
(`graph`) with the device-management-health and local-authority families; the
three signal kinds they produce; the `/v1` decision, evidence, audit, context,
metrics, connector-read and policy-read paths; and three app surfaces —
`api-server`, `signalgrid-app`, and `EnterpriseShell` as the host-app
reference. Everything else in the tree is `deferred` (real, gated, proven,
staying — not shipping), `demo_only`, or `internal`. The counts per status are
the `figures=` line that proof prints; do not quote them from memory.

**Declared gaps** (`GAPS` in `scripts/launch-profile.mjs`, verified
2026-09-02 by running the proof — four, each with a `closedWhen` condition the
gate evaluates against source):

| Gap | What is missing |
| --- | --- |
| `device-management-health` | The Graph transport exists but is not yet the default; the launch connector set is `graph` alone until it flips. |
| `step-up-answerability` | Limited GA runs in shadow mode: the gate can return `step_up`, and no launch route can answer one. |
| `runtime-launch-status` | No served report of enforced vs observed vs simulated per signal kind. |
| `non-demo-core-constructor` | The served core is still the seeded demo factory; it does not yet decide about a customer's own estate. |

Nothing here is deployed; the grid compounds only after a live room. Pilot
terms and what a pilot receives: [`docs/PILOT_PACKAGE.md`](docs/PILOT_PACKAGE.md).
The current gate verdict, generated rather than written: [`docs/STATUS.md`](docs/STATUS.md).

## Where to read next

- [`docs/INDEX.md`](docs/INDEX.md) — the tiered entry points ("your first hour, by who you are") and the full catalog.
- [`docs/WHAT_SIGNALGRID_DOES_TODAY.md`](docs/WHAT_SIGNALGRID_DOES_TODAY.md) — the implemented-vs-candidate boundary for a technical evaluator.
- [`docs/CI_AND_VALIDATION.md`](docs/CI_AND_VALIDATION.md) — every CI lane and what a green run does and does not establish.
- [`docs/DECISION_RECORDS.md`](docs/DECISION_RECORDS.md) — the calls, the evidence, the reversal paths.
- [`docs/BUILD_BACKLOG.md`](docs/BUILD_BACKLOG.md) — the live queue.
- Security and evidence: [`docs/SECURITY_CONTROLS_MATRIX.md`](docs/SECURITY_CONTROLS_MATRIX.md), [`docs/RELEASE_EVIDENCE.md`](docs/RELEASE_EVIDENCE.md), [`docs/SECURITY_REVIEW_RUNBOOK.md`](docs/SECURITY_REVIEW_RUNBOOK.md), [`docs/PUBLICATION_BOUNDARY.md`](docs/PUBLICATION_BOUNDARY.md), [`docs/PRODUCT_CORE_THREAT_MODEL.md`](docs/PRODUCT_CORE_THREAT_MODEL.md).
- Agents and roles: `CLAUDE.md`, [`AGENTS.md`](AGENTS.md), [`docs/agent/ORG.md`](docs/agent/ORG.md), the skills under `.claude/skills/`.

## License

Open source under the [MIT License](LICENSE).

## Security

See [SECURITY.md](SECURITY.md) to report a concern privately.

## Disclaimer

This is a public, pre-production review and validation surface. It claims no
compliance attestation, no vendor alliance or endorsement, and no on-device
enforcement; it does not stand in for IAM, UEM, MDM, DEX, RMM, SIEM, ITSM,
NAC or any other system of record. Remediation is simulated, constrained or
operator-approved unless separately validated.
