# SignalGrid Product Core Foundation (public-safe)

This document describes the product-shaped SignalGrid core that now lives in
Review Hub as a **deterministic, fixture-backed, public-safe** implementation. It
realises the tenancy → connector → decision → evidence → audit loop from the
[Realistic Launch Plan](REALISTIC_LAUNCH_PLAN.md) (plan phases B–D) in a form that
is safe to keep in the public repository: no real authentication secrets, no
tenant or customer data, no PHI/PII, and no live Microsoft Graph or vendor calls.

It is a **product-shaped review artifact, not the production core.** The private
SignalGrid repository remains the protected implementation where real
authentication, real connector credentials, durable persistence, and production
deployment live.

## What was added

| Area | Package / location | Public-safe form |
| ---- | ------------------ | ---------------- |
| Core domain + engine | `lib/signalgrid-core` (`@workspace/signalgrid-core`) | Pure, isomorphic TypeScript; in-memory store; deterministic clock |
| Tenancy & isolation | `src/store.ts`, `src/engine.ts` | Every entity is `tenant_id`-scoped; tenant is derived from the key, never the caller |
| Authentication & RBAC | `src/auth.ts` | Synthetic fixture bearer tokens → principals; deny-by-default role→permission matrix |
| Connector (Entra/Intune) | `src/connector.ts` | Fixture-only, read-only sync; normalizes posture + marks freshness; no Graph call |
| Versioned policy engine | `src/policy.ts` | Ordered, typed rules; most-restrictive-wins; fail-closed on degraded evidence |
| Decision loop | `src/decision.ts` | Resolve → gather signals → evidence → evaluate → snapshot → audit |
| Evidence snapshots | `src/evidence.ts` | Immutable, content-digested, reproducible |
| Audit ledger | `src/audit.ts` | Append-only, per-tenant, digest-chained (tamper-evident) |
| Product API | `artifacts/api-server/src/routes/v1.ts` + middleware | `/v1` surface backed by the in-memory core (works with no database) |
| Operator console | `artifacts/signalgrid-review/.../OperatorConsoleSection.tsx` | In-browser decision trace over synthetic data |
| Proof | `scripts/src/signalgrid-core-proof.ts` | `pnpm run proof:signalgrid-core` — 489 invariant assertions |

## The decision loop

```
bearer token → authenticate → principal (tenant + role)
     → authorize (decision:evaluate)
     → resolve identity + device + workflow (tenant-scoped)
     → gather cached normalized signals (from fixture connector sync)
     → derive decision evidence (missing ⇒ "unknown"/"missing", never healthy)
     → select the active policy version
     → evaluate rules (deterministic, fail-closed)
     → outcome ∈ { allow, step_up, restrict, deny } + reason codes + matched rules
     → capture immutable evidence snapshot (content digest)
     → persist decision
     → append tamper-evident audit events
```

Every decision stores: `tenant_id`, identity/device/workflow, outcome, `policy_id`,
`policy_version_id`, matched rule ids, reason codes, signal ids, evidence snapshot
id, request context, latency, created-at, and review status.

## Security invariants (verified by the proof)

The core proof (`pnpm run proof:signalgrid-core`) asserts, deterministically:

1. **Correct outcomes** for a spread of posture cases (compliant→allow,
   non-compliant→restrict, stale→step-up, unmanaged→restrict, disabled
   identity→deny, missing posture→restrict, critical workflow on an untrusted
   device→deny).
2. **Fail-closed:** no decision returns `allow` when critical evidence is
   missing, stale, or unknown. `allow` is actively suppressed on degraded
   evidence.
3. **Tenant isolation:** one tenant's device/identity/decision is invisible under
   another tenant's key; cross-tenant reads and evaluations fail closed
   (`not_found`), and audit chains never cross tenants.
4. **RBAC:** an auditor cannot evaluate decisions; an operator cannot read the
   audit ledger; roles are limited to their permitted actions.
5. **Authentication fails closed:** unknown or empty tokens are rejected.
6. **Tamper-evidence:** mutating an evidence snapshot fails its digest check;
   mutating an audit event breaks the chain and is detected with the broken seq.
7. **Determinism:** two fresh cores produce identical decision and snapshot ids
   for the same request.

## The `/v1` API surface

Backed by the in-memory core, so it runs without a database. The tenant is always
derived from the authenticated bearer token — no route accepts a tenant id from
the client, which is what makes cross-tenant access structurally impossible.

| Method & path | Permission | Purpose |
| ------------- | ---------- | ------- |
| `GET /api/v1/keys` | none | Discover the public-safe demo keys — `demo_only` in `scripts/launch-profile.mjs`, not product surface; refused under the `shared-device-gateway` product profile (`docs/PRODUCT_PROFILE.md`) |
| `GET /api/v1/context` | any | Who am I / which tenant |
| `POST /api/v1/decisions/evaluate` | `decision:evaluate` | Run the decision loop |
| `GET /api/v1/decisions` | `decision:read` | List tenant decisions |
| `GET /api/v1/decisions/:id` | `decision:read` | Decision detail |
| `GET /api/v1/decisions/:id/evidence` | `decision:read` | Evidence snapshot + integrity check |
| `GET /api/v1/policies` | `policy:read` | List policies |
| `GET /api/v1/policies/:id/versions` | `policy:read` | Policy version history |
| `GET /api/v1/connectors` | `connector:read` | Connector health |
| `GET /api/v1/connectors/:id/sync-runs` | `connector:read` | Sync run history |
| `POST /api/v1/connectors/:id/sync` | `connector:sync` | Replay fixture sync |
| `GET /api/v1/audit` | `audit:read` | Audit events + chain verification |
| `GET /api/v1/metrics` | `decision:read` | Operator metrics (outcomes, p95 latency, pilot gates) |
| `POST /api/v1/decisions/:id/simulate` | `decision:read` | Replay a decision against a chosen policy version |
| `POST /api/v1/policies/:id/versions` | `policy:write` | Author a draft policy version |
| `POST /api/v1/policies/:id/versions/:vid/activate` | `policy:write` | Activate a policy version |
| `GET /api/v1/policies/:id/tests` | `policy:read` | Run a version's policy test fixtures |
| `GET /api/v1/webhooks` | `connector:read` | Configured webhook endpoints (simulated) |
| `GET /api/v1/webhooks/deliveries` | `connector:read` | Simulated deliveries with retry/backoff |
| `GET /api/v1/remediation` | `decision:read` | Proposed remediation (approval-required, simulated) |
| `POST /api/v1/remediation/:id/approve` | `remediation:approve` | Approve a remediation (simulated, never executed) |
| `GET /api/v1/decisions/:id/resolution` | `decision:read` | Resolution Assistant plan (steps, classes, channels) |
| `POST /api/v1/decisions/:id/resolve` | `decision:read` | Simulate the resolution → projected outcome |

Middleware: request id + security headers (`x-content-type-options`,
`x-frame-options`, `referrer-policy`, `cache-control`), bearer authentication /
tenant context, a fixed-window rate limiter, a 64 KB body cap, and a structured
error translator that never leaks internal detail.

### Demo keys (public-safe, not real credentials)

```
sgk_demo_northwind_owner      owner    (Northwind Health — hospital shared iPads)
sgk_demo_northwind_operator   operator
sgk_demo_northwind_auditor    auditor
sgk_demo_atlas_owner          owner    (Atlas Logistics — warehouse handhelds)
```

Seven tenants are seeded — nine `sgk_demo_*` keys in `lib/signalgrid-core/src/seed.ts`: the four above plus one owner key each for Meridian, Vero, Forge, Orion and Civic — so cross-tenant isolation can be exercised directly. (This said "two tenants" until 2026-09-06.)

Example:

```bash
curl -s -X POST http://localhost:5174/api/v1/decisions/evaluate \
  -H "Authorization: Bearer sgk_demo_northwind_operator" \
  -H "Content-Type: application/json" \
  -d '{"identityRef":"nurse.compliant","deviceRef":"ipad-ward-01","workflowKey":"clinical-session"}'
```

## Operator console

The Review Hub UI includes an **Operator Console — Decision Trace** section that
runs the core directly in the browser (no network) and traces each decision from
outcome → matched rules → decision evidence → evidence snapshot digest →
versioned policy → tamper-evident audit chain. It is bannered as a public-safe
alpha over synthetic data.

## Mapping to the launch plan

| Plan phase | Plan intent | Public-safe realization here |
| ---------- | ----------- | ---------------------------- |
| B — Tenancy/auth | tenant schema, auth, tenant context, RBAC, cross-tenant tests | `lib/signalgrid-core` store/auth/engine + isolation proof |
| C — Microsoft sandbox connector | read-only Entra/Intune sync, normalize signals, connector health | fixture connector + normalized signals + freshness + sync runs |
| D — Trusted decision loop | versioned policies, matched rules, evidence snapshots, immutable/replayable decisions, operator detail | policy engine + evidence snapshots + audit chain + operator console |

## What is deliberately NOT here (private-core / human boundary)

Consistent with `AGENTS.md` and the launch plan, this public core does **not**
contain and does **not** claim:

- real authentication providers, sessions, or secrets;
- real Microsoft Graph / vendor calls or real tenant credentials;
- durable production persistence (the store is in-memory);
- no production deployment, availability, or operations;
- no compliance certification, partnership, or replacement of any system of record;
- no autonomous production remediation.

Those belong to the private production core and to human-owned decisions
(company formation, admin consent, customer contracts). The digest used for
snapshot/audit tamper-evidence is a fast content digest for review, not a
cryptographic guarantee; the private core would use a keyed cryptographic
construction.

## Run it locally

```bash
pnpm install
pnpm run proof:signalgrid-core          # 489 deterministic invariant assertions
pnpm run typecheck                      # whole workspace
# API surface:
pnpm --filter @workspace/api-server run build
PORT=5174 pnpm --filter @workspace/api-server run start
# Operator console: build/serve artifacts/signalgrid-review and open the
# "Operator Console" section.
```
