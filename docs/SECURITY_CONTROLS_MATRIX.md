# SignalGrid Security Controls Matrix (public-safe readiness)

This is a **security-readiness control matrix**, not an attestation. It maps
concrete SignalGrid controls to their current status and to the point in the
codebase (or program) where each control lives. It exists so a reviewer or
design partner can see, honestly, what the public fixture-backed core already
enforces versus what belongs to the private production core or to human-owned
program work.

Scope and honesty guardrails:

- The public core in this repository is **fixture-backed and public-safe**. It is
  explicitly **not** production-ready, is **not** compliance-certified, and is
  **not** a replacement for any system of record.
- SignalGrid does **not** claim any current certification, attestation, audit
  report, or vendor partnership. Framework names below are used as **design
  references only** — mapping controls to well-known baselines, not asserting
  conformance or a passed audit.
- SOC 2 is treated here as a **readiness program** (control matrix, policies,
  evidence collection), not a certification. A Type I / Type II engagement is a
  later, human-owned, CPA-performed step that comes only after controls exist and
  operate; nothing here should be read as a SOC 2 report.

## Status legend

| Status | Meaning |
| ------ | ------- |
| **Implemented (public core)** | Enforced today in the deterministic, fixture-backed `lib/signalgrid-core` and verified by the core proof. |
| **Automated (CI bot)** | Owned by CI automation and GitHub-native scanning rather than by product code at runtime. |
| **Private-core (planned)** | Belongs to the protected private production repository (real providers, real secrets, durable persistence); intentionally absent from this public repo. |
| **Human-owned (planned)** | A program/governance control that authorized humans must own and approve; it cannot be responsibly automated away. |

## Framework references used in this matrix

| Short ref | Framework |
| --------- | --------- |
| **ASVS 5.0** | OWASP Application Security Verification Standard 5.0 (testable app-security requirements) |
| **API Top 10** | OWASP API Security Top 10 (esp. **API1 Broken Object Level Authorization**) |
| **800-207** | NIST SP 800-207, Zero Trust Architecture |
| **CSF 2.0** | NIST Cybersecurity Framework 2.0 (org security/risk program functions) |

---

## 1. Access control & tenant isolation

Tenant is derived from the authenticated key, never accepted from the caller, so
cross-tenant access is structurally denied rather than filtered. Every
customer-owned entity is `tenant_id`-scoped and every access is keyed on
`object.id + tenant_id`.

| Control | Framework refs | Status | Where |
| ------- | -------------- | ------ | ----- |
| Tenant derived from key, never from client input | 800-207; API Top 10 (API1) | Implemented (public core) | `lib/signalgrid-core/src/auth.ts` (`authenticate`); `docs/PRODUCT_CORE_FOUNDATION.md` (`/v1` surface) |
| Object access keyed on `object.id + tenant_id` (no ID-only lookups) | API Top 10 (API1); ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/store.ts` / `engine.ts` (tenant-scoped reads) |
| Cross-tenant access denied, not silently ignored (`cross_tenant_denied`, HTTP 403) | API Top 10 (API1); 800-207 | Implemented (public core) | `lib/signalgrid-core/src/auth.ts` (`assertSameTenant`); `CoreError` in `types.ts` |
| Deny-by-default RBAC (role → permission matrix; unlisted permission denied) | ASVS 5.0; CSF 2.0 (PR.AA) | Implemented (public core) | `lib/signalgrid-core/src/auth.ts` (`ROLE_PERMISSIONS`, `authorize`) |
| Least-privilege roles (`owner`/`admin`/`operator`/`auditor`/`connector`) | ASVS 5.0; 800-207 | Implemented (public core) | `lib/signalgrid-core/src/types.ts` (`Role`, `Permission`) |
| Per-route permission enforcement on the `/v1` surface | API Top 10; ASVS 5.0 | Implemented (public core) | `docs/PRODUCT_CORE_FOUNDATION.md` (permission-per-route table) |
| Cross-tenant isolation and RBAC verified deterministically | ASVS 5.0; CSF 2.0 (ID.RA) | Implemented (public core) | `pnpm run proof:signalgrid-core` (isolation + RBAC invariants) |
| PostgreSQL row-level security supplementing app-layer checks | API Top 10 (API1); 800-207 | Private-core (planned) | Private production repo (durable persistence layer) |

---

## 2. Authentication

The public core resolves **synthetic fixture bearer tokens only** — there are no
real secrets, sessions, or identity-provider calls. Authentication fails closed:
unknown or empty tokens are rejected and never resolve to a default tenant or
role. A real authentication provider is a private-core concern.

| Control | Framework refs | Status | Where |
| ------- | -------------- | ------ | ----- |
| Fail-closed token resolution (unknown/empty token → `unauthorized`, HTTP 401) | ASVS 5.0; 800-207 | Implemented (public core) | `lib/signalgrid-core/src/auth.ts` (`authenticate`) |
| No default tenant/role fallback on auth failure | ASVS 5.0; API Top 10 | Implemented (public core) | `lib/signalgrid-core/src/auth.ts` (throws before principal construction) |
| Non-secret key reference only (no real credential stored) | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/types.ts` (`ApiKeyRecord.token` is a synthetic demo token; `keyReference`) |
| Real authentication provider, sessions, MFA/step-up assurance | ASVS 5.0; 800-207 | Private-core (planned) | Private production repo (`packages/auth`); see `docs/REALISTIC_LAUNCH_PLAN.md` (phase B) |
| Service-to-service auth (client-credentials, certificate / workload-identity federation) | ASVS 5.0; 800-207 | Private-core (planned) | Private production repo (connector worker); `docs/REALISTIC_LAUNCH_PLAN.md` (connector auth model) |

---

## 3. Auditability & non-repudiation

Every decision captures an immutable, content-digested evidence snapshot, and
audit events form a per-tenant, append-only, digest-chained ledger. The digest
is a fast content digest for review, not a cryptographic guarantee — a keyed
cryptographic construction is a private-core concern.

| Control | Framework refs | Status | Where |
| ------- | -------------- | ------ | ----- |
| Per-tenant append-only audit ledger (`seq`, `prevDigest`, `digest`) | CSF 2.0 (DE/PR.PS); ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/audit.ts`; `types.ts` (`AuditEvent`) |
| Digest-chained tamper-evidence (mutation breaks chain, detected with broken seq) | ASVS 5.0; CSF 2.0 (DE.CM) | Implemented (public core) | `lib/signalgrid-core/src/audit.ts`; verified by `proof:signalgrid-core` |
| Immutable, reproducible evidence snapshots (content digest) | ASVS 5.0; CSF 2.0 | Implemented (public core) | `lib/signalgrid-core/src/evidence.ts`; `types.ts` (`EvidenceSnapshot`) |
| Decision records store policy version, matched rules, reason codes, signal ids, evidence id | CSF 2.0 (ID/DE); ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/decision.ts`; `types.ts` (`Decision`) |
| Audit chains never cross tenants | API Top 10 (API1); 800-207 | Implemented (public core) | `proof:signalgrid-core` (isolation invariant) |
| Keyed / cryptographically signed audit + snapshot integrity | ASVS 5.0 | Private-core (planned) | Private production repo (`packages/audit-ledger`); see `docs/PRODUCT_CORE_FOUNDATION.md` (digest note) |
| Durable, retained audit storage and log retention policy | CSF 2.0 (PR.PS); ASVS 5.0 | Private-core (planned) | Private production repo (durable persistence) |

---

## 4. Input validation & error handling

The `/v1` surface validates typed input, returns structured errors that never
leak internal detail, caps request bodies, and rate-limits. Malformed, missing,
or degraded critical input must **not** produce an unsafe `allow` — evaluation is
fail-closed by design.

| Control | Framework refs | Status | Where |
| ------- | -------------- | ------ | ----- |
| Typed request/response contracts | ASVS 5.0; API Top 10 | Implemented (public core) | `lib/signalgrid-core/src/types.ts` (`EvaluateRequest`, `RuleCondition`) |
| Untrusted authored-rule validation at the write boundary (structure, field domains, non-empty `match`, ≤64 rules / ≤16 conditions, re-materialised keys) | ASVS 5.0; API Top 10 (API8) | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` (`validatePolicyRules`); verified by `proof:signalgrid-core` (untrusted-input hardening) |
| Bounded-depth canonical JSON (rejects stack-overflow DoS input) | ASVS 5.0; API Top 10 (API4) | Implemented (public core) | `lib/signalgrid-core/src/util.ts` (`canonicalJson`, `MAX_CANONICAL_DEPTH`) |
| Defensive fail-closed evaluation (empty/absent `match` never fires vacuously; malformed condition never matches) | ASVS 5.0; 800-207 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` (`evaluatePolicy`, `matches`) |
| Structured error codes with safe messages (no internal-detail leak) | ASVS 5.0; API Top 10 | Implemented (public core) | `lib/signalgrid-core/src/types.ts` (`CoreError`, `CoreErrorCode`); error translator middleware |
| Body-parser failures mapped to 4xx (malformed JSON → 400, oversized → 413), never a misleading 500 | ASVS 5.0; API Top 10 (API4) | Implemented (public core) | `artifacts/api-server/src/middlewares/errors.ts` (`classifyBodyError`) |
| 64 KB request body cap | ASVS 5.0; API Top 10 (API4) | Implemented (public core) | `/v1` middleware (`docs/PRODUCT_CORE_FOUNDATION.md`) |
| Explicit CORS allow-list (no wildcard on the authenticated surface; default deny-all cross-origin) | ASVS 5.0; API Top 10 (API8) | Implemented (public core) | `artifacts/api-server/src/app.ts` (`corsOptions`, `CORS_ALLOWED_ORIGINS`) |
| Two-tier rate limiting: coarse global limiter over every route (covers the unauthenticated public surface) + tighter per-key `/v1` limiter | ASVS 5.0; API Top 10 (API4) | Implemented (public core) | `artifacts/api-server/src/middlewares/rateLimit.ts` (`globalRateLimiter`, `v1RateLimiter`) |
| Constant-time (length-independent) token comparison | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/util.ts` (`constantTimeEquals`); `store.ts` (`findApiKeyByToken`) |
| No unauthenticated cross-tenant affordances on the shipped facade (removed `unsafeStore()` / caller-supplied-tenant probe) | API Top 10 (API1); ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/engine.ts` (gated `demoApiKeys()` only) |
| Security response headers (content-type-options, frame-options, referrer-policy, cache-control) | ASVS 5.0 | Implemented (public core) | `/v1` middleware (`docs/PRODUCT_CORE_FOUNDATION.md`) |
| Request id propagation for traceability | ASVS 5.0; CSF 2.0 (DE) | Implemented (public core) | `/v1` middleware (`docs/PRODUCT_CORE_FOUNDATION.md`) |
| Fail-closed on missing/stale/unknown critical evidence (no unsafe `allow`) | ASVS 5.0; 800-207 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; verified by `proof:signalgrid-core` (fail-closed invariant) |
| PII-safe / sanitized production logging | ASVS 5.0; CSF 2.0 (PR.DS) | Private-core (planned) | Private production repo (API + connector worker) |

---

## 5. Supply chain & vulnerability management

These controls are owned by CI automation and GitHub-native scanning rather than
by runtime product code. The proof-harness and unsafe-claim scan already run in
CI today; the dependency, code, and secret scanners plus SBOM generation are part
of the CI security-automation program and are enabled at the CI / GitHub-platform
level (some via GitHub default setup, so they have no in-repo workflow file).

| Control | Framework refs | Status | Where |
| ------- | -------------- | ------ | ----- |
| Deterministic proof + typecheck/build gates on every PR | CSF 2.0 (ID.RA); ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml` (validation job) |
| Unsafe-claim / public-safety denylist scan on docs and app copy | CSF 2.0 (GV); ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml` (docs-sanity job) |
| Dependency vulnerability + update automation (Dependabot) | CSF 2.0 (ID.RA); ASVS 5.0 | Automated (CI bot) | GitHub-native dependency scanning (repo/org settings); `docs/REALISTIC_LAUNCH_PLAN.md` (security baselines) |
| Static code scanning (CodeQL) | ASVS 5.0; CSF 2.0 (DE.CM) | Automated (CI bot) | GitHub-native code scanning (default setup at repo level) |
| Secret scanning (gitleaks) | ASVS 5.0; CSF 2.0 (PR.DS) | Automated (CI bot) | GitHub-native / CI secret scanning at repo level |
| CycloneDX SBOM for release artifacts | CSF 2.0 (ID.AM); ASVS 5.0 | Automated (CI bot) | Release CI (SBOM generation step); `docs/REALISTIC_LAUNCH_PLAN.md` |
| Dependency cooldown (`pnpm` `minimumReleaseAge`) | CSF 2.0 (ID.RA) | Automated (CI bot) | `pnpm` config surface (`.npmrc` / `pnpm-workspace.yaml`) |
| Frozen-lockfile installs (reproducible dependency graph) | ASVS 5.0; CSF 2.0 (ID.AM) | Automated (CI bot) | `.github/workflows/review-hub-ci.yml` (`pnpm install --frozen-lockfile`) |
| Build provenance / artifact signing (SLSA-aligned) | CSF 2.0 (PR.PS) | Human-owned (planned) | Release pipeline; `docs/REALISTIC_LAUNCH_PLAN.md` (provenance later) |

---

## 6. Encryption & secret management

The public core stores **no real secrets**. It documents a Key Vault reference
model — `credentialRef` records *where* a real credential reference would live in
the private production core, and is itself neither a secret nor a real reference.
Real encryption and secret management are private-core concerns.

| Control | Framework refs | Status | Where |
| ------- | -------------- | ------ | ----- |
| Key Vault reference model (secret store URI documented, not exercised) | ASVS 5.0; 800-207 | Implemented (public core) | `lib/signalgrid-core/src/types.ts` (`Connector.credentialRef`) |
| No real credentials, secrets, or tenant identifiers in the public repo | ASVS 5.0; CSF 2.0 (PR.DS) | Implemented (public core) | Repo-wide public-safety guardrails (`AGENTS.md`); secret scanning (§5) |
| Encryption in transit (TLS) | ASVS 5.0; 800-207 | Private-core (planned) | Private production repo / deployment (Azure-aligned stack) |
| Encryption at rest | ASVS 5.0; CSF 2.0 (PR.DS) | Private-core (planned) | Private production repo (managed database + Key Vault) |
| Managed secret store (Key Vault) with certificate / federated identity | ASVS 5.0; 800-207 | Private-core (planned) | Private production repo; `docs/REALISTIC_LAUNCH_PLAN.md` (connector auth model) |
| Environment separation (no prod credentials in demo/staging) | CSF 2.0 (PR.AA); ASVS 5.0 | Private-core (planned) | Private production repo (deployment); `docs/REALISTIC_LAUNCH_PLAN.md` (environments) |

---

## 7. Program & governance controls

These are human-owned program controls that cannot be responsibly automated away.
They are listed for readiness completeness; none are claimed as complete, and
none imply a current certification, attestation, or partnership.

| Control | Framework refs | Status | Where |
| ------- | -------------- | ------ | ----- |
| Incident response plan and runbooks | CSF 2.0 (RS/RC) | Human-owned (planned) | Security program; `docs/REALISTIC_LAUNCH_PLAN.md` (pilot readiness) |
| Backup and restore, with a verified restore test | CSF 2.0 (RC.RP); ASVS 5.0 | Human-owned (planned) | Private production repo / operations; launch-plan pilot gates |
| Independent penetration test / security review | ASVS 5.0; CSF 2.0 (ID.RA) | Human-owned (planned) | External engagement; `docs/REALISTIC_LAUNCH_PLAN.md` (phase E/G) |
| Vendor / third-party risk management | CSF 2.0 (GV.SC) | Human-owned (planned) | Security program (vendor register) |
| Vulnerability-disclosure contact | CSF 2.0 (RS); ASVS 5.0 | Human-owned (planned) | Security program |
| Risk register and access reviews | CSF 2.0 (GV/ID) | Human-owned (planned) | Security program |
| HIPAA / PHI boundary (no patient context or PHI in pilots) | CSF 2.0 (GV); ASVS 5.0 | Human-owned (planned) | `docs/REALISTIC_LAUNCH_PLAN.md` (healthcare boundary); BAA + risk assessment before any PHI |
| SOC 2 **readiness** program (control matrix, policies, evidence collection) | CSF 2.0 (GV) | Human-owned (planned) | This matrix + security program; readiness only, not a report |
| SOC 2 Type I / Type II **engagement** | CSF 2.0 (GV) | Human-owned (planned) | CPA-performed, after controls exist and operate; not claimed here |

---

## Public / private boundary (closing note)

Everything marked **Implemented (public core)** runs in the deterministic,
fixture-backed core in this public repository and is exercised by
`pnpm run proof:signalgrid-core`. It demonstrates the *shape* of the controls —
tenant isolation, deny-by-default RBAC, fail-closed evaluation, tamper-evident
evidence and audit — over synthetic data.

Controls marked **Private-core (planned)** (real authentication, real connector
credentials, encryption, durable persistence, sanitized production logging) and
**Human-owned (planned)** (company, program, and audit governance) deliberately
do **not** live in this repository. They belong to the protected private
production core and to authorized human decisions.

This document is a readiness aid. It is **not** an attestation, **not** a
compliance certification, and **not** evidence of a passed audit or a vendor
partnership. SignalGrid is a fixture-backed public-safe review surface, is **not**
production-ready, and does **not** replace any system of record.
