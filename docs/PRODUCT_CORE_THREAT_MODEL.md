# SignalGrid Product Core Threat Model (public-safe)

This is a STRIDE-style threat model for the product-shaped SignalGrid core in
`lib/signalgrid-core` (`@workspace/signalgrid-core`) and the `/v1` API surface
that exposes it (`artifacts/api-server/src/routes/v1.ts` plus middleware). It
complements the repository [Threat Model](../threat_model.md) and the
[Product Core Foundation](PRODUCT_CORE_FOUNDATION.md).

Read this document as an honest map of what the **public core already does** and
what the **private production core must still add**. It is not a security
attestation and not a claim of production readiness.

## Scope and non-claims

- The core is **deterministic, fixture-backed, and public-safe**: no real
  credentials, sessions, tenant identifiers, customer data, PHI, or PII, and no
  live Microsoft Graph or vendor calls. The connector is fixture-only and
  read-only.
- This document is **not** a compliance certification, attestation, or
  regulatory approval, and it is **not production-ready**.
- SignalGrid **does not replace** any system of record (IAM, IGA, UEM, MDM, DEX,
  RMM, SIEM, SOAR, ITSM, or NAC). Existing enterprise systems remain the sources
  of record; SignalGrid normalizes their signals, decides outcomes, captures
  evidence, and audits events.
- There is **no autonomous production remediation** here. High-risk actions stay
  simulated and approval-owned by humans.
- The tamper-evidence digest is a fast **content digest for review**, **not** a
  cryptographic guarantee.

## Trust boundaries

- **Client to `/v1`** — every request crossing into the API is untrusted. The
  tenant is derived from the authenticated bearer token, never from a
  client-supplied identifier, so no route can be steered to another tenant.
- **API to core** — the Express layer holds no authority of its own; all
  authentication, authorization, tenant scoping, and fail-closed logic live in
  `lib/signalgrid-core` and are exercised the same way by the proof harness and
  the in-browser operator console.
- **Core to store** — the store is in-memory and process-local. Every entity is
  `tenant_id`-scoped; the store is the isolation boundary between tenants.
- **Public repo boundary** — everything in this module is synthetic and safe to
  publish. Real auth providers, real connector credentials, durable persistence,
  and real secret storage live only in the private production core.

## Component threat model (STRIDE)

Each component lists its material STRIDE threats, the mitigation **already
implemented** in the public core, and the **residual risk** the private
production core must close.

### 1. Tenant-context / authentication middleware

Files: `artifacts/api-server/src/middlewares/context.ts`,
`lib/signalgrid-core/src/auth.ts` (`authenticate`).

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Spoofing | Caller forges identity or claims another tenant | Bearer token resolved to a principal; **tenant + role derived from the key record, never from the client**; no default tenant | Real authentication provider (OIDC / session issuer), key rotation and revocation |
| Tampering | Client injects `x-request-id` or headers to confuse logs | Request id echoed but non-authoritative; auth reads only the `Authorization` header | Signed request context; provider-issued tokens |
| Repudiation | Actor denies making a call | Principal `keyReference` + request id flow into audit and logs | Provider-backed identity binding |
| Information disclosure | Auth errors leak whether a key exists | Uniform `unauthorized` (401) for both missing and unknown tokens; **token comparison is length-independent** (`constantTimeEquals`), so lookup does not leak a per-character timing signal | Real secret storage; compare fixed-length token digests with a native constant-time primitive |
| Denial of service | Auth path made expensive | Auth is an O(1) in-memory lookup with no network call | Cache and rate-limit the real provider |
| Elevation of privilege | Missing/empty token treated as a default principal | **Fail-closed:** missing or unknown token throws 401; never resolves to a default tenant or role | Same posture over a real IdP |

### 2. RBAC (role → permission authorization)

File: `lib/signalgrid-core/src/auth.ts` (`ROLE_PERMISSIONS`, `roleHasPermission`,
`authorize`, `assertSameTenant`).

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Elevation of privilege | A role performs an action outside its grant (auditor evaluates decisions; operator reads audit) | **Deny-by-default matrix:** a permission not listed for a role is denied; every `/v1` route names an explicit permission | Externalized/dynamic policy, least-privilege review, admin approval flows |
| Spoofing | Principal acts against another tenant's resources | `assertSameTenant` denies (403 `cross_tenant_denied`) rather than silently ignoring | Enforced at the durable data layer too |
| Repudiation | Denied action leaves no trace | Authorization failures are structured errors surfaced with a request id | Durable audit of authorization denials |
| Information disclosure | Error reveals internal policy structure | `forbidden` names only the role and requested permission | Unchanged |

### 3. Tenant-scoped store

File: `lib/signalgrid-core/src/store.ts`.

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Information disclosure | One tenant reads another's identities, devices, decisions, or audit | **Every entity is `tenant_id`-scoped**; lookups take the principal's tenant; cross-tenant reads fail closed as `not_found` | Row-level security / per-tenant isolation in durable storage |
| Tampering | Cross-tenant write or overwrite | Writes are keyed by the principal's tenant; the connector skips records referencing unknown subjects rather than trusting them | Database constraints and per-tenant keys |
| Elevation of privilege | Enumerating ids to reach another tenant's data | Ids are deterministic but access is still tenant-gated; a foreign id resolves to `not_found` | Same gate at the persistence layer |
| Denial of service | Unbounded in-memory growth | Fixed public-safe seed; deterministic dataset | Durable, quota-bounded persistence |

### 4. Fixture connector sync

File: `lib/signalgrid-core/src/connector.ts`.

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Spoofing | Sync trusts a record for a subject that does not exist | Records referencing an unknown device or identity are **skipped, not trusted** | Verified subject mapping from the real directory |
| Tampering | Stale posture presented as current | Freshness is classified from observation time; future/unparseable timestamps become `unknown`, never `fresh` | Signed source records; provider-side integrity |
| Information disclosure | Real credentials or Graph data leak | **No Graph call, no credential use, nothing leaves the process**; `credentialRef` is a documented placeholder, not a secret | Real read-only least-privilege scope and a real secret store (e.g. Key Vault) |
| Denial of service | A slow/large sync stalls the decision path | Sync is offline and cached; the decision path reads cached signals and never depends on a live call | Bounded, retried, rate-limited connector worker |
| Elevation of privilege | Connector role does more than read | `connector` role is limited to `connector:read` / `connector:sync`; sync is read-only and fixture-only | Enforced least-privilege vendor scope |

### 5. Versioned policy engine

Files: `lib/signalgrid-core/src/policy.ts`, `PolicyVersion.digest`.

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Tampering | Rule set altered after activation | Each `PolicyVersion` carries a deterministic **rule-set content digest**; versions are `active`/`superseded`/`draft`, not edited in place | Keyed cryptographic signing of policy versions; approval workflow |
| Elevation of privilege | Degraded evidence yields an unsafe `allow` | **Fail-closed:** `allow` is suppressed to `step_up` when `criticalSignalsPresent` is false; unmatched evidence defaults to `step_up`, never a silent allow; outcome is the most restrictive firing rule (deny > restrict > step_up > allow) | Same guardrail over real signals, with monitored rule-change review |
| Repudiation | Which policy decided is disputed | Decisions record `policyId`, `policyVersionId`, and `policyVersion` | Durable, signed version lineage |
| Denial of service | Pathological or malformed authored rule set (missing `match`, bad condition, deep nesting) crashes a later evaluation | **Authored rules are fully validated at the write boundary** (`validatePolicyRules`): structure, field domains, non-empty `match`, per-rule/condition caps (≤64 rules, ≤16 conditions), and a canonical-JSON depth cap; malformed input is rejected with a 400 and can never be stored, so `evaluatePolicy` only ever sees well-formed rules; evaluation is additionally defensive (an empty/absent `match` fails closed rather than firing vacuously) | Monitored rule-change review and per-tenant complexity budgets |
| Tampering | Authored rule injects unexpected/prototype-y keys | Rules are **re-materialised** into fresh objects with only known keys during validation, dropping any extra properties | Schema-registry-validated policy authoring |

### 6. Decision loop

File: `lib/signalgrid-core/src/decision.ts` and `evidence.ts` (`buildEvidence`).

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Elevation of privilege | Missing signals treated as healthy | Missing inputs become `unknown` / `missing` (never assumed healthy); `criticalSignalsPresent` is true only when all critical inputs are present and fresh | Same over real signals |
| Tampering | Client-supplied context steers the outcome | Request context is sanitized to string-only and is not a decision input; subjects are resolved tenant-scoped by reference | Schema-validated context; provenance checks |
| Repudiation | Decision cannot be reconstructed | Each decision stores identity/device/workflow, outcome, policy version, matched rules, reason codes, signal ids, evidence snapshot id, latency, and timestamp | Durable, replayable decision log |
| Information disclosure | Explanation leaks internals | Explanations are reason-code driven, no stack traces or internal state | Unchanged |

### 7. Evidence snapshots

File: `lib/signalgrid-core/src/evidence.ts` (`buildSnapshot`, `verifySnapshot`).

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Tampering | Evidence altered after the fact | Snapshots are **immutable and content-digested over canonical JSON**; `verifySnapshot` recomputes and detects any mutation | **Keyed cryptographic hashing** instead of the content digest; write-once durable storage |
| Repudiation | Dispute over what evidence was seen | Snapshot pins the exact signals used, evidence, policy version, and source references | Signed, timestamped snapshots |
| Information disclosure | Snapshot exposes raw source data | Snapshots reference synthetic source references only | Field-level minimization on real data |
| Denial of service | Snapshot generation is expensive | Deterministic, single-pass digest | Bounded snapshot size |

### 8. Audit ledger

File: `lib/signalgrid-core/src/audit.ts` (`appendAudit`, `verifyAuditChain`).

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Tampering | Retroactively edit or delete an event | **Per-tenant, append-only, digest-chained** ledger: each event digests `prevDigest` + canonical body, so any edit breaks the chain from that point; `verifyAuditChain` reports the broken seq | **Keyed cryptographic chaining**, external anchoring, WORM storage |
| Repudiation | Actor denies an audited action | Events record actor, subject, summary, references, seq, and timestamp | Signed events bound to provider identity |
| Information disclosure | One tenant reads another's audit | Chains are strictly tenant-scoped and never reference another tenant's events | Durable per-tenant isolation |
| Denial of service | Unbounded ledger growth | Bounded deterministic seed | Retention and archival policy |

### 9. Rate limiter

File: `artifacts/api-server/src/middlewares/rateLimit.ts`.

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Denial of service | Flood of requests exhausts the service | **Two limiters:** a coarse global limiter (600 req/60s) applied ahead of *every* route so the unauthenticated public surface (health, integrations, simulator, and the `/v1/keys` discovery route that sits ahead of the auth guard) cannot be spammed for amplification, plus a tighter per-key `/v1` limiter (240 req/60s); both return 429 with `retry-after` | **Distributed/shared limiter** across instances; per-route and per-tenant budgets |
| Spoofing | Rotate source to evade limits | The `/v1` limiter is keyed by bearer token first, so a single principal is bounded regardless of address | Provider-backed principal keys |

### 10. Error handling

File: `artifacts/api-server/src/middlewares/errors.ts`, `CoreError`.

| STRIDE | Threat | Implemented mitigation | Residual / private core |
| ------ | ------ | ---------------------- | ----------------------- |
| Information disclosure | Stack traces, file paths, or raw errors leak to clients | **Structured errors only:** `CoreError` maps to a stable `{ requestId, error, message }` shape; unknown errors become a generic `internal` 500; internals are logged server-side, never returned | Same posture with production log hygiene |
| Tampering | Oversized body abuses the parser | **64 KB body cap** on JSON and urlencoded parsing (`app.ts`); an oversized body maps to a **413 `payload_too_large`** | Streaming limits and upload quotas |
| Denial of service | Malformed JSON body throws a raw parser error and is mishandled as a 500 | Body-parser failures (bad JSON, unsupported charset/encoding) are **classified to a 400 `bad_request`** with a fixed, non-leaky message instead of a 500 | Unchanged |
| Spoofing | Any web origin scripts the authenticated API from a victim's browser | **CORS is an explicit allow-list** (`CORS_ALLOWED_ORIGINS`), not a wildcard; unknown browser origins receive no `Access-Control-Allow-Origin` and are blocked; default is deny-all cross-origin | Per-environment origin policy tied to the real console host |
| Denial of service | Verbose error handling amplifies load | Cheap, bounded translation; no reflection of client input beyond the request id | Unchanged |
| Elevation of privilege | Legacy DB-backed routers (`decisions`/`metrics`/`policies`/`signals`, active only when `DATABASE_URL` is set) expose unauthenticated writes (policy rewrite, signal injection) | **Fail-closed:** those routers are mounted behind `requireTenantContext` (bearer required) in `routes/index.ts`, so a `DATABASE_URL` deployment never exposes an anonymous read/write surface; `/v1` remains the tenant-isolated product surface | Tenant-scoped data layer + row-level security for the durable store |
| Denial of service | Unbounded `limit` query param dumps a whole table / crafted value throws | The DB list routes **clamp `limit` to `[1,200]`** server-side; the simulator demo ledger is a **bounded ring buffer** (≤500) so repeated calls cannot grow memory without bound | Query cost limits + pagination cursors in the durable store |
| Repudiation | Error not attributable | Every response carries the request id | Correlated distributed tracing |

## Security invariants verified by the proof

`pnpm run proof:signalgrid-core` asserts these invariants deterministically
(the proof runs the same core the API and console use):

| Invariant | What it proves |
| --------- | -------------- |
| Correct outcomes | A spread of posture cases maps to the expected outcome (compliant to allow, non-compliant to restrict, stale to step-up, unmanaged to restrict, disabled identity to deny, missing posture to restrict, critical workflow on an untrusted device to deny) |
| Fail-closed | No decision returns `allow` when critical evidence is missing, stale, or unknown; `allow` is actively suppressed on degraded evidence |
| Tenant isolation | One tenant's device/identity/decision is invisible under another key; cross-tenant reads and evaluations fail closed (`not_found`); audit chains never cross tenants |
| RBAC | Roles are limited to their grants (an auditor cannot evaluate; an operator cannot read the audit ledger) |
| Authentication failure | Unknown or empty tokens are rejected (fail-closed 401), never a default principal |
| Snapshot tamper-evidence | Mutating an evidence snapshot fails its digest check |
| Audit tamper-evidence | Mutating an audit event breaks the chain and is detected with the broken seq |
| Determinism | Two fresh cores produce identical decision and snapshot ids for the same request |
| Untrusted-input hardening | Every malformed authored rule shape (absent/empty `match`, unknown condition field, out-of-domain value, invalid outcome/severity, over the rule cap, duplicate ids, non-array) is rejected with a validation error; a validated draft still activates and evaluates without throwing; deeply-nested input is rejected by the canonical-JSON depth cap rather than exhausting the stack; the constant-time comparison behaves as an equality; the shipped facade exposes no `unsafeStore()`/caller-tenant probe |

## What the private production core must add

The public core establishes the shapes and fail-closed behaviors; production
hardening is deliberately out of this repository:

- a **real authentication provider** (session/token issuance, rotation,
  revocation) in place of synthetic fixture tokens;
- **keyed cryptographic hashing** for evidence snapshots and audit chaining in
  place of the fast content digest;
- **distributed rate limiting** shared across instances, with per-tenant and
  per-route budgets;
- **durable persistence** with tenant isolation enforced at the data layer, in
  place of the in-memory store;
- **real secret storage** for connector credentials, replacing the documented
  placeholder `credentialRef`;
- real read-only least-privilege vendor connectors, replacing the fixture sync.

These belong to the protected private core and to human-owned decisions. This
public core remains a review artifact: honest about its shape, explicit that it
is not production-ready, and safe to keep in the open.
