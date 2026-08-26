# Security Questionnaire Pack — DRAFT

> **Status: DRAFT, awaiting owner review.** This pack pre-answers the questions a
> partner's security assessor will ask, so the owner is never improvising an answer
> under pressure. Every answer is grounded in a file or gate in this repository that
> the assessor can be pointed at. **Where the honest answer is "not built" or "not
> held", the answer says so** — an overstated security answer is the most expensive
> false claim this project could make, because it is the one a counterparty will
> verify.

## How to use this

Copy the relevant rows into the partner's questionnaire format. Do not "improve"
an answer beyond what its evidence column supports; if the state of the tree has
moved, update the row here first (the cited-path gate holds the evidence column
against the repository). Answers use three statuses:

- **Built and gated** — exists, and a CI gate or proof fails the build if it regresses.
- **Built, not gated** — exists; nothing fails automatically if it drifts.
- **Not built, not claimed** — does not exist, and no document may say otherwise.

## Certifications and attestations — read this row first

| Question | Answer | Status |
|---|---|---|
| SOC 2 / ISO 27001 / HIPAA / FedRAMP? | **None held, none claimed.** No audit has been performed. For regulated verticals a human compliance review is required, not optional. The docs-sanity gate (`scripts/docs-sanity.mjs`) fails the build if any document claims otherwise. | Not built, not claimed |
| Penetration test? | **None performed.** The threat model (`threat_model.md`) is maintained and names its own known gaps rather than smoothing them. | Not built, not claimed |
| BAA available? | **No.** No PHI, PII, tenant IDs, or customer data may enter this repository by rule (`AGENTS.md`); all fixtures are public-safe by construction. | Not built, not claimed |

## Product architecture

| Question | Answer | Evidence | Status |
|---|---|---|---|
| What does the product do? | A signal- and location-driven Assist gate for shared frontline devices: the host app asks, the gate answers allow / step_up / restrict / deny. It is embedded — invisible to end workers — and supplies evidence for decisions; **source systems remain the systems of record**. | `docs/LAUNCH_PROFILE.md` | Built and gated |
| Is the decision path deterministic? | Yes, and enforced: no wall-clock reads or randomness in decision paths, unknown or unreachable signals raise required assurance rather than lowering it (fail closed). A CI invariant gate fails the build on violations. | `pnpm run review:invariants` (`docs/CI_AND_VALIDATION.md`) | Built and gated |
| What is the declared product edge? | A launch profile classifies every connector family, signal kind, API path and app surface as launch / deferred / demo-only / internal, and a bijection gate fails CI if the declared edge and the repository disagree in either direction. | `scripts/launch-profile.mjs`, `scripts/check-launch-profile.mjs` | Built and gated |
| Does the product enforce anything on devices? | **No, and it cannot.** An app cannot grant device access, restrict other apps, or make itself non-removable; those are MDM/OS capabilities requiring a supervised device. SignalGrid consumes MDM evidence (Fleet is the chosen lab MDM); it does not replace MDM. | `threat_model.md` | Not built, not claimed |

## Authentication and authorization

| Question | Answer | Evidence | Status |
|---|---|---|---|
| How are API callers authenticated? | The `/v1` surface sits behind a bearer-token guard; the token **verifier** is real (RS256, JWKS, proven against a certified in-process OIDC provider in `proof:live-idp`). DPoP sender-constrained binding is demonstrated at the IdP/client level (`proof:live-idp`, cross-checked against real Keycloak in `proof:live-keycloak` via RFC 7638) — the verifier accepts the resulting DPoP-bound token but does not itself validate the DPoP proof-of-possession. The **credential lifecycle** (issuance, rotation, revocation for real tenants) is not built and not claimed — demo deployments use fixture-grade seeded credentials. | `lib/enterprise-auth`, `docs/AUTHENTICATION_AND_CREDENTIAL_ARCHITECTURE.md` | Built and gated (verifier); Not built, not claimed (lifecycle) |
| Is authorization enforced per route? | Durable-path routes carry declared permissions, and a CI gate fails if a durable path is served without an authorization declaration. | `scripts/check-durable-path-authorization.mjs` | Built and gated |
| Can an anonymous caller enumerate routes? | No. The auth guard answers 401 before the 404 catch-all on `/v1`, so an unauthenticated prober cannot distinguish existing from non-existing routes. Asserted from both sides in the API test suite. | `artifacts/api-server/test/api.test.mjs` | Built and gated |

## Audit and integrity

| Question | Answer | Evidence | Status |
|---|---|---|---|
| Is there a tamper-evident audit trail? | Two chains, stated honestly. The **durable** ledger is a SHA-256 hash chain in Postgres with a paginating full-chain verifier (`db:verify-ledger`) that localizes a break to its exact index and refuses to report an empty chain as clean. The **in-process** per-tenant digest chain served at `/v1/audit` does not survive a restart, and no document may call it durable. | `lib/audit/src/index.ts`, `scripts/src/verify-ledger-cli.ts`, `docs/BACKUP_AND_RESTORE.md` | Built and gated |
| Are audit records verified after backup/restore? | The restore procedure requires a full-chain verification against the restored database before the restore is called good. | `docs/BACKUP_AND_RESTORE.md` | Built and gated |
| Are decisions explainable? | Every decision exposes its evidence (`/v1/decisions/{id}/evidence`): reason codes, matched rules, digest-verified evidence snapshots, per-signal freshness. | `lib/api-spec/v1-openapi.yaml` | Built and gated |

## Data handling

| Question | Answer | Evidence | Status |
|---|---|---|---|
| What customer data does the repository hold? | **None, by enforced rule**: no secrets, credentials, tenant IDs, customer data, PHI, or PII. All fixtures are public-safe. | `AGENTS.md` | Built and gated |
| Does the product write to source systems? | No write to any source system exists on the launch surface; adapters supply evidence only. The one sync trigger route runs the core's fixture pipeline and the core refuses non-fixture connectors by construction. | `scripts/launch-profile.mjs` (the `/v1/connectors/{id}/sync` entry) | Built and gated |
| Data retention? | **Not implemented** — no retention or deletion mechanism exists in any durable store; the intended default is recorded in DR-003 and is not shipped. Session expiry exists (rows persist); ledger export is the operator-side `db:export-ledger` CLI (no tenant filter, no `/v1` route — customer self-serve export is not available). | `docs/DATA_RETENTION_AND_PERSONAL_DATA.md` | Position documented, mechanism not built |

## API robustness

| Question | Answer | Evidence | Status |
|---|---|---|---|
| Rate limiting? | Two limiters (global per-address, and per-token on `/v1`), answering 429 in the same flat error envelope as every other error, with standard RateLimit and Retry-After headers. Asserted live under concurrency in the load suite. | `artifacts/api-server/src/middlewares/rateLimit.ts`, `artifacts/api-server/test/load.test.mjs` | Built and gated |
| Consistent error contract? | Every error a client can receive — 400, 401, 404, 429 — carries the same flat `{requestId, error, message}` envelope, asserted on response bodies, not just status codes. | `artifacts/api-server/test/api.test.mjs` | Built and gated |
| Load characteristics? | Correctness under concurrency is gated; throughput and latency figures are **reported with provenance in committed result files, never restated in prose** — ask for the result artifacts rather than a quoted number. | `pnpm run test:load` (`docs/CI_AND_VALIDATION.md`) | Built and gated |

## Supply chain

| Question | Answer | Evidence | Status |
|---|---|---|---|
| SBOM? | Generated and committed, covering every ecosystem in the tree — npm (pnpm resolved tree), cargo (3 committed Cargo.lock files), maven (2 committed build.gradle.kts files); the Swift manifests are read and currently declare zero external packages, recorded as such in the SBOM's metadata. Each component carries a licence entry, and `scripts/check-licence-policy.mjs` (preflight + CI) fails on any licence that is absent, unparsed, deny-class, or never ruled on. Not covered: container base images and OS packages — the bill is source-dependency scope only. | `artifacts/sbom`, `scripts/check-licence-policy.mjs` | Built and gated |
| Dependency scanning? | Dependabot (grouped minor/patch cadence) plus a Supply Chain CI workflow; lockfile integrity is enforced (`--frozen-lockfile` in CI, plus a pre-push hook). | `.github/workflows/supply-chain.yml` | Built and gated |
| Static analysis? | CodeQL runs on every push; findings have been remediated by capability removal (removing shell and dynamic-regex capabilities rather than escaping around them). | `.github/workflows/codeql.yml` | Built and gated |

## Operations — honest gaps

| Question | Answer | Status |
|---|---|---|
| Hosted service / SLA? | **This repository is not a hosted service and no SLA is claimed.** Deployment is the partner's or a later phase's concern. | Not built, not claimed |
| Incident response process? | Not built, not claimed. | Not built, not claimed |
| Step-up enforcement? | Limited GA ships in **shadow mode**: the gate returns step_up and no launch route answers one. Declared as a gap in the launch profile with a machine-checked closure condition, so "returns step_up" is never read as "performs step-up". | Built and gated (the honesty), Not built (the enforcement) |

## What the assessor should be sent

1. `threat_model.md` — the current surface, every guarantee naming its enforcing gate, and the known-gaps section.
2. `docs/LAUNCH_PROFILE.md` — what is in scope and what is deferred, with the gate that keeps it true.
3. `docs/CI_AND_VALIDATION.md` — how to run the full validation harness themselves.
4. This pack, so the answers and their evidence arrive together.

Security questions and follow-ups go to **hello@signalgrid.app** (Dan Fashauer, Founder) — the single point of contact for assessor conversations.
