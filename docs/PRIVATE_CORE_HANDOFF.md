# SignalGrid Private Core Handoff (public-safe blueprint)

This is a **buildable blueprint**, not an implementation. It tells a founding
engineer exactly how to build the **private production core** by replacing each
public-safe fixture module in
[`lib/signalgrid-core`](../lib/signalgrid-core) with its production counterpart.
It is public-safe: it contains no secrets, tenant identifiers, customer data, or
PHI/PII, and it makes no live vendor call. It does not claim any current
partnership, certification, or production readiness.

The public core described in the
[Product Core Foundation](PRODUCT_CORE_FOUNDATION.md) is a **deterministic,
fixture-backed, product-shaped review artifact**. It realises the tenancy →
connector → decision → evidence → audit loop with an in-memory store, synthetic
tokens, a fast content digest, and simulated connectors/webhooks/remediation.
The production build follows the
[Realistic Launch Plan](REALISTIC_LAUNCH_PLAN.md) from **Phase C onward** and
turns each of those into its durable, credentialed, monitored equivalent —
**without changing the security contract**: deny-by-default RBAC, fail-closed
decisions, tenant isolation, tamper-evident evidence/audit, read-only connector,
and approval-gated, simulated remediation (no autonomous production remediation).

The controlling principle for the whole handoff: **the observable contract of
`@workspace/signalgrid-core` stays fixed; only the backing implementations
change.** The deterministic proof harness that guards that contract
(`pnpm run proof:signalgrid-core`, 213 invariant assertions) must keep passing
against the production wiring, extended with the new tests below.

## 1. Public fixture → private production mapping

Each row is a swap. The public module on the left already defines the shape,
tests, and safety invariants; the private module on the right must satisfy the
same contract with a durable, credentialed backing.

| Concern | Public fixture (this repo) | Private production counterpart | Contract that must not change |
| ------- | -------------------------- | ------------------------------ | ----------------------------- |
| Persistence | In-memory `MemoryStore` (`src/store.ts`), lost on restart | **PostgreSQL** with row-level security; repository layer keyed on `(tenant_id, id)` | Every read/write is tenant-scoped; a customer-owned object is never fetched by `id` alone |
| Authentication | Synthetic bearer tokens → `Principal` via `authenticate()` (`src/auth.ts`) | Real **authentication provider** (operator OIDC / session; service principals via signed service tokens) → same `Principal` | Fail-closed on unknown/empty credential; tenant + role come from the verified credential, never from the caller |
| Authorization | `ROLE_PERMISSIONS` deny-by-default matrix (`src/auth.ts`) | **Same matrix, unchanged**, enforced server-side on every route | A permission not listed for a role is denied; matrix shape is identical |
| Evidence + audit integrity | FNV-1a content digest (`digest()` in `src/util.ts`) | **Keyed cryptographic construction**: HMAC-SHA-256 (or signed) over canonical JSON, key held in Key Vault | Same canonicalization and chaining; mutation is detectable; genesis → chained `prevDigest` |
| Connector sync | `runFixtureSync()` over synthetic `FixturePostureRecord[]` (`src/connector.ts`) | Real **read-only Microsoft Entra ID + Intune** connector via Graph, cached on an interval | Read-only, normalized signals with freshness, health + per-run records; decision path never blocks on a live call |
| Outbound webhooks | Simulated in-memory sink, backoff recorded not awaited (`src/webhooks.ts`) | Real **outbound HTTP** with **signed payloads**, real retries with backoff, and a **dead-letter queue** | Per-endpoint retry/backoff schedule; `delivered` / `failed` / `dead_letter` terminal states |
| Remediation | `proposeRemediation()` — `approvalRequired: true`, `simulatedOnly: true`, no `executed` status (`src/remediation.ts`) | Approval-gated real action **requests** routed to systems of record; still records/simulates, still no autonomous execution | Every proposal requires approval; SignalGrid issues a request, it does not execute a source-system change |
| Clock | `fixedClock()` deterministic ISO time | Real monotonic clock in production; fixed clock retained in tests | Deterministic tests still pin outcomes and ids |

Nothing in the private core widens the RBAC matrix, relaxes fail-closed
behaviour, or introduces an autonomous execution path. Those are contract
violations, not features.

## 2. Production monorepo layout

Mirrors the structure in the launch plan (sections 3–4). The private repository
is the real product monorepo; the public Review Hub keeps only synthetic
fixtures, the simulator, and sanitized architecture.

```
apps/
  operator-console        # Dashboard, Decisions, Signals, Policies,
                          # Integrations, Audit, Settings, Tenant admin
  public-site             # marketing / docs (no runtime secrets)
services/
  api                     # /v1 surface; auth + tenant-context + RBAC middleware
  connector-worker        # scheduled read-only Entra/Intune sync
packages/
  signalgrid-core         # domain types + engine (promoted from lib/signalgrid-core)
  auth                    # OIDC/session + service-token verification → Principal
  tenant-context          # request-scoped tenant, RLS session var binding
  policy-engine           # versioned rules, most-restrictive-wins, fail-closed
  signal-normalizer       # Graph payload → NormalizedSignal + freshness
  audit-ledger            # HMAC/signed, chained, append-only writer + verifier
  microsoft-connector     # MSAL client-credentials, read-only Graph client
  webhook-dispatcher      # signed outbound HTTP + retries + DLQ
db/
  migrations              # ordered, reversible SQL migrations (schema below)
  policies                # RLS policy definitions
infra/
  azure                   # IaC: Container Apps, Postgres, Key Vault, Monitor, ACR
docs/
  private-security        # threat model, risk register (private only)
  deployment
  incident-response
```

The domain model in `packages/signalgrid-core` is the same `types.ts` used here.
Runtime logic that touches customer data or credentials lives only in the
private services; the public demo may consume sanitized packages or generated
fixtures.

## 3. Data persistence and migrations

The durable schema mirrors the entities in
[`types.ts`](../lib/signalgrid-core/src/types.ts) and the data model in launch
plan section 4. Tables (from the plan):

```
tenants  users  memberships  roles  api_keys
connector_instances  connector_credential_refs  connector_sync_runs
connector_events_raw  identities  devices  workflows  normalized_signals
policies  policy_versions  policy_rules  policy_tests
decisions  decision_signal_evidence  decision_explanations
audit_events  remediation_actions  webhook_deliveries
```

Rules that the migrations and repository layer must enforce:

- **Every customer-owned table carries `tenant_id`** (a non-null FK to
  `tenants.id`). `users` may be global, but `memberships` binds a user to a
  tenant + role.
- **Two independent tenant checks — belt and braces.** Enforce
  `object.id + tenant_id` **at the application layer** (the repository never
  issues a query keyed on `id` alone) **and** with **PostgreSQL row-level
  security**. Both must hold; neither is trusted alone. This directly answers
  OWASP API1 (broken object-level authorization).
- **RLS binding.** The API sets a per-request Postgres session variable
  (e.g. `SET LOCAL app.tenant_id = $1`) from the authenticated principal's
  tenant — never from a client-supplied value. Each customer-owned table gets a
  policy of the shape `USING (tenant_id = current_setting('app.tenant_id')::uuid)`
  for `SELECT/INSERT/UPDATE/DELETE`. The application role runs with RLS enforced
  (not `BYPASSRLS`); migrations run under a separate privileged role.
- **Append-only audit.** `audit_events` is insert-only for the application role;
  no `UPDATE`/`DELETE` grant. Each row stores `seq`, `prevDigest`, and `digest`
  exactly as in the public `AuditEvent` type, but the digest is HMAC/signed
  (see section 5).
- **Migrations are ordered and reversible.** `db/migrations` holds forward +
  rollback SQL; schema changes ship through CI with a migration applied to a
  disposable database and verified before merge. `connector_credential_refs`
  stores **only a Key Vault reference**, never a secret value.

Column types follow `types.ts` (e.g. enum-like `text` with `CHECK` constraints
for `DecisionOutcome`, `Freshness`, `ComplianceState`, `RiskTier`; `jsonb` for
`DecisionEvidence`, `matchedRules`, `signalsUsed`, and rule specs).

## 4. Read-only Microsoft Graph connector spec

Realises launch-plan section 5 and Phase C. Built in
`packages/microsoft-connector` and driven by `services/connector-worker`.

- **Least-privilege permission.** Application permission
  `DeviceManagementManagedDevices.Read.All` — the least-privileged application
  permission documented for listing managed devices. The tenant must hold an
  active Intune license. Start with `GET /deviceManagement/managedDevices`. No
  write, no directory-modify, no device-action permission is requested.
- **Auth flow.** Service-to-service **client-credentials flow via MSAL** with
  administrator consent. **Prefer a certificate or workload-identity federated
  credential over a client secret.** No credential is ever committed to source.
- **Secret handling.** The database stores **only a Key Vault reference**
  (`connector_credential_refs`), not the credential. The worker resolves the
  reference to a credential at runtime via managed identity; secrets are never
  logged or returned over the API.
- **Cached, not inline.** The connector does **not** call Graph during an access
  decision. It syncs on a controlled interval, stores sanitized raw-event
  references (`connector_events_raw`), normalizes posture into
  `normalized_signals`, and marks **freshness** (`fresh` / `stale` / `expired` /
  `missing`) using windows equivalent to the fixture's `FRESH_WINDOW_HOURS` /
  `STALE_WINDOW_HOURS`. This gives reliable decision latency even when Graph is
  unavailable, and lets the decision engine fail closed on stale posture.
- **Fields to normalize** (mirroring the fixture's `FixturePostureRecord` and
  the plan): managed device id, Entra device id, user/UPN reference, device
  name, owner type, OS + version, management agent, compliance state, last sync
  time, enrollment type, supervised/encrypted state.
- **Reliability + observability.** Record `connector_sync_runs`
  (started/completed, status, records processed, signals normalized), report
  connector health (`healthy` / `degraded` / `never_synced`), implement retry
  with exponential backoff on Graph throttling (respect `Retry-After`), and keep
  logs sanitized (no tokens, no PII, reference ids only).
- **Hard boundary.** The connector implements **no device write and no
  remediation**. It is read-only by construction and by granted permission.

## 5. Keyed integrity for evidence and audit

The public core uses FNV-1a (`digest()` in `src/util.ts`) purely to demonstrate
tamper-evident snapshots and chained audit events — it is a fast content digest
for review, not a cryptographic guarantee. The private core replaces it with a
**keyed cryptographic construction** while keeping the same canonicalization and
chaining:

- **Canonical JSON stays identical.** Reuse the stable key-ordering
  canonicalizer so digests are reproducible and comparable across builds.
- **Keyed digest.** Replace `digest(canonical)` with
  `HMAC-SHA-256(key, canonical)` (or an asymmetric signature) for both
  `EvidenceSnapshot.digest` and each `AuditEvent.digest`. The key is held in Key
  Vault and rotated; snapshots record the key id used so verification survives
  rotation.
- **Chain unchanged in shape.** `AuditEvent` keeps `seq` + `prevDigest` +
  `digest` over `(prevDigest + canonical body)`, per-tenant, genesis-anchored.
  `verifyAuditChain` becomes an HMAC/signature verification that still reports
  the first broken `seq`.
- **Same guarantees, stronger:** mutating a snapshot fails its keyed check;
  mutating any audit event breaks the chain and is detected — now under a keyed
  construction an attacker without the key cannot forge a valid digest.

## 6. Azure infrastructure mapping

From launch-plan section 7. Because the first real connector is Microsoft, an
Azure-aligned stack is practical. IaC lives in `infra/azure`.

| Capability | Azure service | Notes |
| ---------- | ------------- | ----- |
| API + workers | **Azure Container Apps** | `services/api`, `services/connector-worker`; scale-to-load, managed identity |
| Database | **Azure Database for PostgreSQL** | RLS enforced; automated backups; PITR |
| Secrets | **Azure Key Vault** | connector credential + HMAC/signing keys; DB stores only references |
| Telemetry | **Azure Monitor / Application Insights** | request ids, latency, sanitized structured logs, alerts |
| Images | **Azure Container Registry** | signed images; provenance later (SLSA-aligned) |
| CI/CD | **GitHub Actions** | build, test, migrate, deploy; code/dependency/secret scanning |

### Required environments

Four environments, each fully isolated — **separate database, secrets, and app
registration** (and hostname, logging, retention). **Never reuse production
credentials in demo or staging.**

| Environment | Data | Connector | Notes |
| ----------- | ---- | --------- | ----- |
| `local` | synthetic fixtures | fixture mode | this repo's core; no credentials |
| `public-demo` | synthetic only | fixture mode | bannered public-safe alpha; no admin functions |
| `staging` | non-production | Microsoft **sandbox** app registration | production-like; independent secrets |
| `production` | customer, tenant-scoped | customer-consented read-only app | separate DB/secrets/registration; strict retention |

## 7. Testing and CI parity

Keep the deterministic proofs; add the production-only tests. CI must run the
existing public checks (`pnpm run typecheck`, the proof harnesses, and the
unsafe-claim `git grep` from `AGENTS.md`) plus:

- **Deterministic core proof, unchanged.** `pnpm run proof:signalgrid-core`
  (213 invariant assertions: correct outcomes, fail-closed, tenant isolation,
  RBAC, auth-fails-closed, tamper-evidence, determinism, the security-baseline
  dimension, the badge-binding dimension, and the dock/SmartDock hardware-state
  dimension) runs against the production wiring too.
- **Cross-tenant RLS tests.** With two seeded tenants, assert that tenant A's
  credential cannot read or evaluate tenant B's rows — exercised **twice**: once
  with the application check disabled to prove RLS alone denies, once with RLS
  disabled to prove the application check alone denies. Both layers must hold
  independently.
- **Load / latency tests against pilot gates.** Assert **p95 cached decision
  latency < 750 ms** under representative load (launch-plan section 11), plus
  connector sync completion above the sandbox-window target.
- **Backup / restore test.** Automated restore of a Postgres backup into a
  disposable database, then re-run the core proof against the restored data to
  prove the restore is usable.
- **Keyed-integrity tests.** Prove HMAC/signature verification detects mutation
  of a snapshot or audit event and survives key rotation.
- **Security scanning.** Dependency scanning (Dependabot), code scanning, and
  secret scanning gate the build; generate a CycloneDX SBOM for release
  artifacts.

## 8. Exit gates per phase

Taken directly from the launch plan's engineering sequence (section 14). The
private core build begins at Phase C; Phase B is the tenancy/auth foundation it
sits on.

| Phase | Scope | Exit gate |
| ----- | ----- | --------- |
| **B — Tenancy / auth** | tenant/user/membership/role schema, operator auth, tenant-context middleware, RBAC, cross-tenant tests, Postgres persistence, request-validation + security middleware | **All customer-owned routes are authenticated and tenant-scoped.** |
| **C — Microsoft sandbox connector** | register sandbox app, admin consent, read-only permission, Key Vault credential reference, connector-instance/sync-run tables, sync managed devices, normalize signals, connector health | **One sandbox tenant produces real normalized device-posture signals without writes.** |
| **D — Trusted decision loop** | versioned policies, active-version pointer, policy test fixtures, matched rules, evidence snapshots, signed/immutable decision records, replay/simulate, operator decision-detail page | **One real Microsoft-backed decision is explainable and replayable.** |
| **E — Pilot readiness** | durable audit ledger, staging deployment, backups + restore test, monitoring/alerting, incident response, security questionnaire, design-partner agreement, success criteria, independent security review | **A design partner can safely run a sandbox pilot.** |

## 9. What stays human-owned

Engineering can be largely automated; these decisions cannot be automated away
(launch-plan section 16). No agent and no automated pipeline may perform or
approve them — they require an authorized human:

- **Microsoft admin consent** for any tenant.
- **Customer tenant access** and onboarding.
- **Credential and secret ownership** (Key Vault contents, signing keys,
  app-registration credentials).
- **Production launch approval.**
- **Security risk acceptance** (accepting or waiving findings; sign-off before
  production-adjacent use).
- **Customer contracts** — pilot agreements, DPAs, and commercial terms.
- Company formation, tax/legal structure, IP assignments, privacy/PHI decisions,
  partnership terms, and fundraising/acquisition terms.

## 10. Safety invariants that carry over unchanged

These hold in the public core and must hold identically in production. They are
the reason the fixture-to-production swap is safe to do incrementally:

- **Deny-by-default RBAC.** The `ROLE_PERMISSIONS` matrix is copied verbatim; no
  route grants a permission a role does not hold.
- **Fail-closed decisions.** No decision returns `allow` when critical evidence
  is missing, stale, unknown, or degraded. Malformed or ambiguous high-risk
  input never yields an unsafe allow.
- **Tenant isolation is structural.** No API accepts a tenant id from the
  client; the tenant is derived from the verified credential and enforced again
  by RLS.
- **Tamper-evident evidence and audit**, now keyed.
- **Approval-gated, request-only remediation.** SignalGrid records and routes
  approved action requests to systems of record and treats those systems as the
  systems of record; it performs no autonomous production remediation and has no
  execute path.
- SignalGrid is the layer that normalizes signals, decides outcomes, routes
  approved actions, audits events, and verifies results — it does not replace
  Intune, does not replace Jamf, and does not replace ServiceNow or any other
  system of record.

---

This handoff is a plan. It is public-safe, uses only synthetic references, and
makes no claim of current partnership, certification, or production readiness.
The private production core, its credentials, and its customer data live only in
the protected private repository.
