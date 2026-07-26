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
| Denial of service | Unbounded in-memory growth, or per-decision full-store scans that degrade under load | Fixed public-safe seed; deterministic dataset; per-decision device/identity/workflow/signal resolution uses **tenant-prefixed composite-key indexes** (O(1)), so lookups do not scan the whole store and remain structurally tenant-scoped (the tenant id is the first key segment) | Durable, quota-bounded persistence with indexed, tenant-partitioned queries |

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
| Information disclosure | Stack traces, file paths, or raw errors leak to clients | **Structured errors only:** `CoreError` maps to a stable `{ requestId, error, message }` shape; unknown errors become a generic `internal` 500; internals are logged server-side, never returned. The `X-Powered-By: Express` framework header is disabled (`app.disable`). An adversarial fuzz/pentest pass (auth bypass, cross-tenant, prototype pollution, path traversal, injection, oversized/deeply-nested/malformed bodies, method confusion, rate-limit burst) produced **no 500 crash, no bypass, and no stack leak** | Same posture with production log hygiene |
| Tampering | Oversized body abuses the parser | **64 KB body cap** on JSON and urlencoded parsing (`app.ts`); an oversized body maps to a **413 `payload_too_large`** | Streaming limits and upload quotas |
| Denial of service | Malformed JSON body throws a raw parser error and is mishandled as a 500 | Body-parser failures (bad JSON, unsupported charset/encoding) are **classified to a 400 `bad_request`** with a fixed, non-leaky message instead of a 500 | Unchanged |
| Spoofing | Any web origin scripts the authenticated API from a victim's browser | **CORS is an explicit allow-list** (`CORS_ALLOWED_ORIGINS`), not a wildcard; unknown browser origins receive no `Access-Control-Allow-Origin` and are blocked; default is deny-all cross-origin | Per-environment origin policy tied to the real console host |
| Denial of service | Verbose error handling amplifies load | Cheap, bounded translation; no reflection of client input beyond the request id | Unchanged |
| Elevation of privilege | A parallel, database-backed surface could expose unauthenticated reads/writes | **Removed by construction:** there is no database and no DB-backed route. The product is the single deterministic, in-memory `/v1` surface, which is authenticated (`requireTenantContext`, bearer required) and tenant-isolated. There is no anonymous read/write surface | Tenant-scoped durable store with row-level security when a private production core is built |
| Denial of service | Unbounded `limit` query param dumps a whole result set / crafted value throws | The `/v1` list routes **clamp `limit`** server-side; the simulator demo ledger is a **bounded ring buffer** (≤500) so repeated calls cannot grow memory without bound | Query cost limits + pagination cursors in the durable store |
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

## SignalGrid as the compromised hub

Everything above answers "can one tenant reach another's data inside SignalGrid?" —
tenant scoping, fail-closed cross-tenant reads, per-tenant audit chains. That is the
right question and the proof constrains it. It is not the question the current
healthcare threat landscape is actually asking.

Comparitech's H1 2026 data, reported by Dark Reading on 10 July 2026, found attacks on
healthcare **providers** rising moderately while attacks on healthcare **businesses** —
the vendors and service providers behind them — rose 35% against H2 2025 and 110% against
H1 2025. The stated reason is not subtle. In Comparitech's Rebecca Moody's words,
"through one central hub, you're targeting multiple healthcare organizations." The
worked examples in the same reporting are a medical-billing provider serving 95% of one
country's university hospitals, and a claims processor whose breach exposed 3.4 million
patients held at its *customers'* facilities.

A runtime decision fabric reading security signals across many hospitals is that
archetype. Not a market this product sells into — a **description of what this product
becomes at scale**. The threat model has to say so, and has to be honest about which
parts of the answer are already structural and which are still owed.

### What already limits the blast radius, and why it is architecture rather than policy

- **Every connector is read-only, enforced in code.** Each one carries a `guardReadOnly`
  that throws on any non-GET, and each proof asserts it. A compromised SignalGrid cannot
  push a profile, wipe a device, revoke a certificate, or open a door, because no such
  code path exists to abuse. This is the single largest reduction in what a stolen
  position is worth, and it was a design choice made long before this data.
- **The product decides; it does not enforce.** Remediation is approval-gated and
  simulated. `pim-activation`, the one inbound control point, defaults every unknown to
  `Approved` — meaning *a human is asked* — and reserves `AutoApproved` for the case where
  all seven inputs are positively confirmed.
- **Live vendor calls are gated three ways** — tier must be beta/prod, `SIGNALGRID_LIVE_INTEGRATIONS`
  must be `"true"`, and the connector's token must be set — so a deployment that has not
  deliberately opted in makes no outbound vendor call at all.
- **The audit ledger is a hash chain**, each record's `prevHash` bound to its predecessor,
  so silent retroactive edits to a decision history do not survive verification.

### What does not limit it, stated plainly

- **A corrupted verdict is the real prize, and nothing in this repo currently detects
  one.** An attacker who cannot write to a hospital's MDM but *can* flip SignalGrid's
  verdicts to `allow` has turned the product into a machine for manufacturing false
  confirmations at fleet scale. That is the exact inverse of the discipline every
  connector is built on — a grant requires positive confirmation of every input — applied
  one level up, at the fabric rather than the field. The verdict leaving SignalGrid is
  not signed, and a consumer has no way to distinguish a genuine `allow` from an injected
  one.
- **Connector credentials are process-global, not per-tenant.** Every resolver reads a
  single `<NAME>_ACCESS_TOKEN` from the environment. In a single-tenant deployment that
  is correct and simple. In a hub serving many hospitals it means one stolen process
  environment yields every tenant's bridge at once — precisely the concentration the
  attack data describes.
- **`AutoApproved` is the one outbound grant of privilege.** Its inputs are enumerated
  and its allow-path is brute-forced, but the enumeration proves the *logic* is tight; it
  does not prove the *inputs* were not fabricated by whoever owns the process.

### What is therefore owed before a multi-tenant pilot

These are additions to the private production core, listed here so the gap is recorded
rather than discovered:

1. ~~**Signed verdicts.**~~ **Shape built** — see below. A consumer must be able to verify
   that an `allow` originated from the evaluator and was not injected in transit or at
   rest; the webhook HMAC covers delivery, not the decision itself. What remains for the
   private core is key custody and asymmetric signing, not the contract.
2. **Per-tenant connector credentials**, so the blast radius of a stolen credential is one
   hospital rather than the fleet — replacing the process-global environment token.
3. **A bounded `AutoApproved` surface** — rate, scope, and time limits on automatic
   privileged elevation, so a compromised hub cannot mint unbounded activations even with
   valid-looking inputs.
4. **An explicit "assume the hub is compromised" review**, run the way the connector
   allow-paths are: adversarially, with the finding written down whether or not it is
   comfortable.

Non-claims, stated as plainly as the rest: nothing here asserts that SignalGrid prevents
a ransomware incident, reduces patient harm, or satisfies any regulatory obligation. The
figures cited above are third-party research about the sector, reproduced as context for
a design decision. They are not outcomes this product claims to produce.

### Verdict attestation, as built

`lib/verdict-attestation` is the public-core half of item 1: the envelope, the
verification contract, and the fail-closed behaviour. The production core swaps the
sealing primitive for asymmetric signing with real key custody; the contract does not
change, and the contract is what carries the safety.

The design decision worth arguing about is what happens when verification FAILS. The
obvious answer — return an error and let the caller decide — is how this class of control
stops working in practice: a status field a caller may ignore is a status field some
caller eventually ignores, and the first such caller silently re-opens the hole. So
`openVerdict` never hands back a usable grant it could not verify. An unverifiable verdict
comes back with its action raised to `step_up` and its reason replaced with
`VERDICT_UNVERIFIED`, which means **a caller that never inspects the status still cannot
act on a forged `allow`**. The proof asserts exactly that across the whole enumerated
space, not just the happy path.

Three details are load-bearing and easy to get wrong in the other direction:

- **The degrade is one-directional.** A verdict that already says `restrict` is not
  lowered to `step_up` by a verification failure. Failing to confirm a verdict is never a
  reason to trust a device *more* than the unverified claim about it did.
- **`step_up`, not `escalate`.** A failed verification means we do not know the truth; it
  does not mean the device is compromised. Escalating every unverifiable read would make a
  key-rotation mistake indistinguishable from an attack, and the first noisy week would
  end with the control switched off.
- **The verdict object is copied, never mutated.** The caller is often holding the
  original for an audit record, and rewriting it underneath them would corrupt exactly the
  evidence this is meant to protect.

`tenantId` is bound *inside* the sealed payload rather than sitting alongside it, so a
genuine, correctly-sealed `allow` for one hospital does not transfer to another — the hub
threat above, closed at the cryptographic layer rather than by policy. `alg` is checked
for membership in an allowlist and never used to *select* a verifier, which is the
algorithm-confusion mistake that has broken signed-token schemes repeatedly; the verifier
comes from the keyring entry. An unknown `keyId` is a refusal rather than a fallback to
trying every key, because a verifier that roams its ring is an oracle for which keys
exist.

Canonicalization is its own small module for a reason: a seal is only as good as the bytes
it covers, and `JSON.stringify` guarantees neither that two different verdicts serialize
differently (it maps `NaN` and `Infinity` alike to `null`) nor that one verdict serializes
the same way twice (key order follows insertion order). The canonical form is key-sorted
and own-property-only, so a polluted prototype cannot change what a signature covers, and
it returns an `UNCANONICAL` sentinel rather than throwing — a hostile value fails closed
inside a verification path instead of exploding out of it.

Proven offline by `pnpm run proof:verdict-attestation` (76 checks): 288 envelope states
enumerated across tamper site, key, algorithm, clock and replay, with **exactly one**
verifying, and — separately asserted through `openVerdict` — **exactly one** yielding a
usable `none`.

The count moved from 64 to 76 within an hour of being written, and by a route worth
recording. The new mutation guard was pointed at this package and reported **13 of 19
mutations surviving** — thirteen conditions here could be deleted with the proof still
green. Most were type checks whose deletion changed the failure *reason* without changing
the refusal: a numeric `keyId` still fails, but as `unknown_key` rather than
`envelope_malformed`, which sends an operator hunting a key-rotation problem that does not
exist. Asserting the reason instead of merely the refusal made them load-bearing. The two
that remain are genuinely unreachable, labelled as such in the source, and allowlisted with
reasons. Code written an hour ago is not a reason to trust it more than anything else.

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
