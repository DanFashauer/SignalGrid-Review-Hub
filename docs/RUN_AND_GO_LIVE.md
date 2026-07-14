# Run and Go-Live Runbook (public-safe)

A practical runbook for **running the public-safe SignalGrid product core locally**
and a **staged go-live checklist** for moving from public demo to a paid pilot.

Everything documented here is **deterministic, fixture-backed, and public-safe**:
no secrets, no PHI/PII, no tenant or customer data, and no live Microsoft Graph or
vendor calls. It is a **product-shaped review artifact, not the production core** —
the private SignalGrid repository holds real authentication, real connector
credentials, durable persistence, and production deployment.

See [`PRODUCT_CORE_FOUNDATION.md`](PRODUCT_CORE_FOUNDATION.md) for the core design,
[`REALISTIC_LAUNCH_PLAN.md`](REALISTIC_LAUNCH_PLAN.md) for the end-to-end launch
sequence, and [`PILOT_READINESS_CRITERIA.md`](PILOT_READINESS_CRITERIA.md) for the
paid-pilot gate.

## Prerequisites

| Requirement | Version |
| ----------- | ------- |
| Node.js | 22.x |
| pnpm | 10.x |

```bash
pnpm install
```

Use `pnpm install --frozen-lockfile` when reproducing CI exactly.

## Validation

Run these before opening or updating a pull request. They are the same checks CI
and `AGENTS.md` expect.

```bash
pnpm run typecheck                      # whole workspace
PORT=3000 BASE_PATH=/ pnpm run build    # build the Review Hub + workspace

# Deterministic proof suite (fixture-backed, no network):
pnpm run proof:signalgrid-core          # product core — 166 invariants, deterministic
pnpm run proof:signalgrid-simulator     # simulator scenarios
pnpm run proof:signalgrid-grid          # grid proof
pnpm run proof:intune-entra-posture     # Intune/Entra posture proof (fixtures)

pnpm run sbom                           # generate the software bill of materials
```

The **core proof asserts 166 invariants deterministically** — correct outcomes for
a spread of posture cases, fail-closed on degraded evidence (`allow` is actively
suppressed), tenant isolation (cross-tenant reads/evaluations fail closed),
deny-by-default RBAC, authentication fail-closed, tamper-evidence on evidence
snapshots and the audit chain, and reproducible decision/snapshot ids. It runs
against the fixed demo clock and requires no database or network.

## Running the `/v1` API (no database)

The product API is backed by the in-memory core (`SignalGridCore.demo()`), so it
runs **without any database or external service**. All data is the deterministic
public-safe demo seed. The base path is `/api`.

```bash
# Build the api-server, then start it:
pnpm --filter @workspace/api-server run build
PORT=5174 pnpm --filter @workspace/api-server run start
```

The API is then reachable at `http://localhost:5174/api/v1/...`.

The tenant is always derived from the authenticated bearer token — **no route
accepts a tenant id from the client**, which is what makes cross-tenant access
structurally impossible.

## Demo keys (public-safe, not real credentials)

These are obviously-fake fixture tokens surfaced so reviewers can authenticate
against the seeded tenants. **They are not real credentials** and grant access to
nothing but the in-memory demo seed. Two tenants exist so cross-tenant isolation
can be exercised directly.

| Demo key | Tenant | Role | Can do |
| -------- | ------ | ---- | ------ |
| `sgk_demo_northwind_owner` | Northwind Health (hospital shared iPads) | owner | Everything: evaluate + read decisions, read/write policies, read/sync connectors, read audit, **approve remediation** |
| `sgk_demo_northwind_operator` | Northwind Health | operator | Evaluate + read decisions, read policies, read connectors. **Cannot** read audit or approve remediation |
| `sgk_demo_northwind_auditor` | Northwind Health | auditor | Read decisions, read policies, read connectors, **read audit**. **Cannot** evaluate |
| `sgk_demo_atlas_owner` | Atlas Logistics (warehouse handhelds) | owner | Everything, but scoped to the Atlas tenant only |

Deny-by-default: a permission not listed for a role is denied. Discover the keys
live at any time with `GET /api/v1/keys` (no auth).

## End-to-end curl walkthrough

Authenticate every non-discovery call with `Authorization: Bearer <demo key>`.
Set a base variable first:

```bash
BASE=http://localhost:5174/api/v1
OWNER="Authorization: Bearer sgk_demo_northwind_owner"
OP="Authorization: Bearer sgk_demo_northwind_operator"
AUD="Authorization: Bearer sgk_demo_northwind_auditor"
```

### 1. Discover the demo keys (no auth)

```bash
curl -s $BASE/keys
```

### 2. Confirm identity and tenant

```bash
curl -s $BASE/context -H "$OP"
# → { principal: {role: "operator", ...}, tenant: {id: <northwind>, ...} }
```

### 3. Evaluate a decision — compliant nurse → allow

```bash
curl -s -X POST $BASE/decisions/evaluate -H "$OP" \
  -H "Content-Type: application/json" \
  -d '{"identityRef":"nurse.compliant","deviceRef":"ipad-ward-01","workflowKey":"clinical-session"}'
# → decision.outcome == "allow", with policyVersionId, matched rules,
#   reason codes, and evidenceSnapshotId. Capture decision.id as DID.
```

### 4. Evaluate a decision — non-compliant nurse → restrict

```bash
curl -s -X POST $BASE/decisions/evaluate -H "$OP" \
  -H "Content-Type: application/json" \
  -d '{"identityRef":"nurse.noncompliant","deviceRef":"ipad-ward-02","workflowKey":"clinical-session"}'
# → decision.outcome == "restrict" (degraded/non-compliant posture → allow suppressed).
```

### 5. Inspect the evidence snapshot + integrity check

```bash
curl -s $BASE/decisions/$DID/evidence -H "$OP"
# → { evidence: {immutable, content-digested snapshot}, verified: true }
```

### 6. Replay the decision against a chosen policy version (simulate)

```bash
curl -s -X POST $BASE/decisions/$DID/simulate -H "$OP" \
  -H "Content-Type: application/json" \
  -d '{"policyVersionId":"pol_tenant_northwind_shared_device_v2"}'
# → simulation shows the outcome under the named policy version, side-effect free.
```

### 7. Operator metrics (outcomes, p95 latency, pilot gates)

```bash
curl -s $BASE/metrics -H "$OP"
# → totalDecisions, byOutcome, allowRate, restrictDenyRate, p95LatencyMs,
#   decisionsWithPolicyVersion, decisionsWithEvidence, pendingReview.
```

### 8. Audit ledger (auditor or owner only)

```bash
curl -s $BASE/audit -H "$AUD"
# → { events: [...append-only, digest-chained...], chain: {verified: true} }
```

### 9. Simulated webhook deliveries

```bash
curl -s $BASE/webhooks/deliveries -H "$OP"
# → simulated deliveries with retry/backoff (no real outbound calls).
```

### 10. Remediation — list, then approve (owner only)

```bash
curl -s $BASE/remediation -H "$OWNER"
# → proposed actions in "requires_approval" status (no autonomous execution).
# Capture an action id as RID, then approve it (owner has remediation:approve):
curl -s -X POST $BASE/remediation/$RID/approve -H "$OWNER"
```

Remediation is proposal-only and approval-gated by design: actions start in
`requires_approval` and there is no autonomous execution path. An operator key
(`$OP`) approving would be rejected (deny-by-default RBAC).

### Negative tests — the two failures that must hold

```bash
# Cross-tenant access returns 404 (the decision belongs to Northwind, key is Atlas):
curl -s -o /dev/null -w "%{http_code}\n" $BASE/decisions/$DID \
  -H "Authorization: Bearer sgk_demo_atlas_owner"
# → 404 (structurally invisible across tenants; never leaks existence)

# Unauthenticated request returns 401:
curl -s -o /dev/null -w "%{http_code}\n" $BASE/context
# → 401
```

## Running the Operator Console

The Review Hub UI includes an **Operator Console — Decision Trace** section that
runs the core directly in the browser (no network) and traces each decision from
outcome → matched rules → decision evidence → evidence snapshot digest →
versioned policy → tamper-evident audit chain.

```bash
# Build/serve the Review Hub app:
PORT=3000 BASE_PATH=/ pnpm run build
# then serve artifacts/signalgrid-review and open the "Operator Console" section.
# In local dev the UI is served at http://localhost:5173
```

It is bannered as a public-safe alpha over synthetic data.

## Deterministic demo clock

The demo core evaluates against a **fixed clock: `2026-07-13T15:00:00Z`**
(`DEMO_CLOCK_ISO`). Every sync, decision, evidence snapshot, and audit event is
timestamped from this clock, so decision ids, snapshot digests, audit sequences,
and freshness calculations are **fully reproducible**: two fresh cores produce
identical decision and snapshot ids for the same request. This is what lets the
proof assert determinism and lets reviewers diff runs. The content digest used
for snapshot/audit tamper-evidence is a fast review digest, **not** a cryptographic
guarantee — the private core would use a keyed cryptographic construction.

## Staged go-live checklist

Three gated stages. Each gate must pass before advancing. This mirrors the launch
sequence in [`REALISTIC_LAUNCH_PLAN.md`](REALISTIC_LAUNCH_PLAN.md) and the paid-pilot
gate in [`PILOT_READINESS_CRITERIA.md`](PILOT_READINESS_CRITERIA.md).

### Stage 1 — Public demo (public-safe now)

Status: **available in this repository today.**

- [ ] `pnpm run typecheck` passes.
- [ ] `PORT=3000 BASE_PATH=/ pnpm run build` succeeds.
- [ ] Proof suite green, including `pnpm run proof:signalgrid-core` (166 invariants).
- [ ] `pnpm run sbom` generated.
- [ ] `/v1` API runs with no database; curl walkthrough above reproduces the
      documented outcomes; cross-tenant → 404 and unauthenticated → 401.
- [ ] Operator Console decision trace renders over synthetic data.
- [ ] Public-safety banners present; only fixture demo keys; no real vendor calls.

Gate to advance: reviewers can reproduce the decision loop deterministically and
confirm the public-safety guardrails.

### Stage 2 — Design-partner sandbox (private-core / human-owned)

Status: **not in this public repo.** Requires the private core and a
customer-approved sandbox tenant.

- [ ] Real authentication implemented in the private/customer-appropriate context.
- [ ] Tenant isolation tests pass, including cross-tenant negative tests.
- [ ] Read-only Microsoft connector runs against a **customer-approved sandbox or
      test tenant only**.
- [ ] Secret handling uses managed storage; no committed credentials.
- [ ] Enforcement stays in observe/advise mode; write/remediation actions remain
      approval-gated and separately scoped.
- [ ] Durable audit records decision evidence, source system, policy version,
      action, actor/system, and review path.

Gate to advance: design-partner validation on their sandbox, with owner approval.

### Stage 3 — Paid pilot (private-core / human-owned)

Status: **not in this public repo.** Requires explicit owner approval; a paid pilot
does not start merely because Review Hub builds or demos run.

- [ ] Backup/restore documented and tested for pilot data.
- [ ] Incident response contacts, severity levels, escalation paths defined.
- [ ] Pilot agreement and scope boundaries in place.
- [ ] Privacy and security documents reviewed for the pilot context.
- [ ] Customer success criteria written **before** pilot start.

**Technical pilot gates (must all hold):**

- [ ] **100% of decisions carry a policy version and an evidence snapshot.**
- [ ] **Zero cross-tenant access** (isolation negative tests pass).
- [ ] **No `allow` on degraded evidence** (fail-closed verified).
- [ ] **p95 decision latency < 750ms.**
- [ ] **Audit chain verified** (append-only, digest-chained, tamper-evident).

The `/v1/metrics` endpoint surfaces the raw counters (`decisionsWithPolicyVersion`,
`decisionsWithEvidence`, `p95LatencyMs`), `/v1/audit` returns the chain verification,
and the core proof exercises fail-closed and isolation — so the same gates are
observable in the public demo, but the pilot itself is a private, human-owned step.

## Public-safe now vs private-core / human-owned later

| Capability | Here (public-safe) | Later (private core / human-owned) |
| ---------- | ------------------ | ---------------------------------- |
| Decision loop, evidence, audit | Deterministic, fixture-backed | Durable, production-persisted |
| Authentication | Synthetic fixture bearer tokens | Real auth providers, sessions, secrets |
| Microsoft connector | Fixture-only, read-only, no Graph call | Read-only against approved sandbox/test tenant |
| Remediation | Proposal-only, approval-gated, simulated | Scoped, approved actions; not autonomous production remediation |
| Tamper-evidence | Fast content digest for review | Keyed cryptographic construction |
| Company/contract/consent decisions | Out of scope | Human-owned |

This runbook and everything it exercises is **public-safe and fixture-backed, not
production-ready**. It does not replace any IAM, UEM, DEX, RMM, SIEM, ITSM, MDM, or
NAC system of record, and it claims no partnership, certification, or autonomous
production remediation.
