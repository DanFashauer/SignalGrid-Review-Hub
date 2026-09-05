# ECC full evaluation — the six-stage sequence the owner asked for, run on the Mac lane

**What this is.** The owner directed (2026-09-01, relayed by the cloud lane as
`artifacts/sim-requests/2026-09-01-ecc-full-evaluation.json`) that ECC evaluate the whole
repository and drive it through build → test → security review → adversarial
testing → re-test → validate. ECC's seat is the Mac lane, because the sequence needs a
running api-server, Xcode and a fuzzer. This document is that run, executed
2026-09-05, each stage recorded with the output it produced. The cloud lane's own
independent six-dimension evaluation is `docs/agent/SOLUTION_READINESS_ASSESSMENT.md`;
where the two disagree, the disagreement is the finding (section 7).

**The standing rule, restated because it governs how to read every line below:**
ECC ADVISES. It never certifies green. Only `node scripts/preflight.mjs` and
`pnpm run verify:breadth` certify. A finding ECC raises that the repository's own gates
already hold is a false positive and is labelled so; a finding the gates hold nothing
for is a backlog row, not a fix made here.

**Where the raw output went.** The request named a `tools/ecc-reviews/` directory as
the destination; that directory has never existed in this repository's history
(`git log -- tools/ecc-reviews` is empty), so the record lives here under `docs/agent/`
with the other evaluations, and the machine-readable JUnit reports from the fuzzer stay
in the session's scratch directory (they carry generated request bodies and are not
publishable content).

## 1. Build all surfaces

| Surface | Command | Result 2026-09-05 |
| --- | --- | --- |
| iOS EnterpriseShell (simulator) | `xcodegen generate`, `xcodebuild test -scheme EnterpriseShell -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17'` | `** TEST SUCCEEDED **`, `Executed 76 tests, with 0 failures` — run twice on the Ponytail-cut branch (`mac/ponytail-native-cuts`), identical result |
| api-server | `pnpm --filter @workspace/api-server run build` | built (`dist/index.mjs`), then served every request of stage 4 |
| web (vite) | `pnpm run build` | linux-x64 / CI only by design (`CLAUDE.md`, toolchain wrinkle) — not run on the Mac, not claimed |
| Kotlin core, Rust desktop core | recorded in `artifacts/sim-results/2026-09-02-android-desktop-first-run.json` | android-core PASS, desktop-core PASS; window-smoke blocked on the owner's Screen Recording grant |

## 2. Full test

| Suite | Result |
| --- | --- |
| `./validate-sim-macos.sh` (every `proof:*`) | the 2026-09-01 request run: `proofs PASS validate-sim-macos.sh green` (`artifacts/sim-results/2026-09-01-ecc-full-evaluation.json`, operation `everything`, clean tree at `45cdecff`) |
| `node scripts/preflight.mjs` | `Preflight PASSED — everything it runs is green.` — 245 gates on 2026-09-04 (`11a1110e` tree); re-run on the Ponytail-cut branch on 2026-09-05, result recorded in that branch's commit |
| `pnpm run verify:breadth` | `Breadth lane PASSED — 56 breadth proofs green` — 2026-09-04 and again 2026-09-05 on the cut branch |
| `pnpm --filter @workspace/api-server run test:api` | runs inside preflight's api gate; the `everything` run above reports `api PASS test:api green` |

## 3. Security review — ECC `security-reviewer`, report-only

Run 2026-09-05 against mainline `db546c8b` by the ECC `security-reviewer` agent with
read-only tools; nothing was edited. Scope read in full: `lib/enterprise-auth/src`
(jwt, jwks, config, claims, provider, base64url), `lib/webauthn/src`
(`webauthn/verify.ts`, `webauthn/server.ts`, `webauthn/store.ts`, `stepUpStore.ts`),
`lib/signalgrid-core/src/policy.ts` and the verdict path it calls
(`lib/signalgrid-core/src/engine.ts`, `auth.ts`, `decision.ts`, `util.ts`),
`artifacts/api-server/src/middlewares` (context, rateLimit, idempotency, errors),
`artifacts/api-server/src/app.ts`, `artifacts/api-server/src/routes` (v1,
control-plane, index, sim), `artifacts/api-server/src/lib/profile.ts`,
`artifacts/api-server/src/lib/core.ts`, `lib/api-zod`, and for the injection and
logging checks `lib/persistence/src/decision-store.ts`,
`lib/persistence/src/session-store.ts`, `lib/audit/src/index.ts`.

The reviewer's own framing: most of what looks like a defect on first read is already
a fixed, commented, gated regression. Findings are split into open items and
explicitly verified-clean surfaces; false positives are labelled, not omitted.

### 3.1 Open findings — three, all Low, all in code unreachable from the live API today

**LOW — `createStepUpSession` dual-writes to the in-memory step-up store when Redis is
authoritative, and swallows a Redis write failure.** `lib/webauthn/src/webauthn/store.ts:485-509`:
the Redis write sits in a `try { … } catch { /* fall through */ }` and the in-memory
`set` runs unconditionally afterwards, outside the `if (redis)` block — the exact rule
the same file's `saveChallenge` (384-413) and `getUser` (55-92) state and follow: when
Redis is configured it is the SOLE store and a write failure must propagate. Fail
direction: loosens (a failed durable write reads as success; on a multi-instance
deployment a session invalidated on the authoritative store could still read as live
from another instance's memory). Held by an existing gate: NO. Reachability:
`verifyStepUp` (`lib/webauthn/src/webauthn/server.ts:587-612`), the only consumer, has
zero callers in `artifacts/api-server`; the live step-up path in
`artifacts/api-server/src/routes/v1.ts` uses `lib/webauthn/src/stepUpStore.ts`, which
does not have this defect. Fix: make the in-memory write conditional on `!redis` and
propagate the error — or delete the dead path together with `verifyStepUp`.

**LOW — step-up session ids logged in cleartext.** `lib/webauthn/src/stepUpStore.ts:161,
167, 197, 209, 215, 221, 227`: `console.log` prints the full `stepUpSessionId` — a CSPRNG
value that gates the high-risk operations in `STEPUP_REQUIRED_OPERATIONS` — on
creation, miss, expiry and every mismatch branch; anyone with log access inside the
300 s TTL holds a bearer-equivalent for that operation. Fail direction:
neutral-to-loosens (disclosure surface). Held by an existing gate: NO. Reachability:
the module is exported as `stepUp` but imported by no route. Fix: log a truncated hash
of the id, the pattern `keyReference` already uses in `lib/enterprise-auth`.

**LOW / INFO — the `/v1` per-key rate limiter keys on the raw bearer, which rotates
under OIDC.** `artifacts/api-server/src/middlewares/rateLimit.ts:54-72`, ordering at
`artifacts/api-server/src/routes/v1.ts:56`: the limiter runs before
`requireTenantContext` and buckets by the caller's JWT, so a fresh JWT (refresh,
re-auth, or several valid tokens minted concurrently) is a fresh bucket.
`artifacts/api-server/src/middlewares/idempotency.ts:54-64` documents and fixes the same
hazard for its own cache by keying on the verified principal. Fail direction: loosens
throughput ceilings, never a verdict. Held by an existing gate: NO. The ordering is
deliberate (`artifacts/api-server/src/app.ts:76-82`: a 429 must still carry
`x-request-id`; the limiter sits upstream of auth so an anonymous flood never reaches
the auth path), so the fix keys smarter within that order — a non-verifying claim
peek, as `peekJwtKid` already does for another purpose — rather than moving the
limiter.

### 3.2 Verified clean, or already held by a gate — recorded so nobody re-finds them

- JWT verification (`lib/enterprise-auth/src/jwt.ts`): RS256-only gate before key
  lookup, every claim check fails closed, `nowMs` injected, aud/iss/exp/nbf/iat/sub all
  required. JWKS cache (`lib/enterprise-auth/src/jwks.ts`): cooldown-limited refetch on
  an unknown `kid`, failed fetches never cached. Claim mapping
  (`lib/enterprise-auth/src/claims.ts`): deny by default.
- `requireTenantContext` (`artifacts/api-server/src/middlewares/context.ts:107-170`):
  exactly one credential type per server configuration, no fallback when OIDC is
  configured, an unknown token is always 401 and never a default tenant.
- The NaN / unparseable-expiry family: six sites carrying the exact pattern
  (`lib/webauthn/src/webauthn/server.ts:195-199, 411-415, 605-609`;
  `lib/webauthn/src/webauthn/store.ts:378-380, 448-449`;
  `lib/webauthn/src/stepUpStore.ts:190-191, 206-208`) — all six already fixed, each
  carrying the `scripts/check-nan-fail-open.mjs` marker, and that gate's self-test
  enumerates this class. HELD.
- WebAuthn `attested` (`lib/webauthn/src/webauthn/verify.ts:259-290`) can be true from a
  self-signed leaf, and nothing reads it: registration gates on `ok` plus rpId/UP/UV
  (`lib/webauthn/src/webauthn/server.ts:242-253`). Info, not open.
- Tenant isolation: every `SignalGridCore` method authenticates, calls
  `authorize(principal, permission)` for a named permission, and scopes every store read
  by `principal.tenantId` (`lib/signalgrid-core/src/engine.ts:189-536`); the earlier
  `context()`-for-`authorizedContext()` escalation is documented fixed at
  `lib/signalgrid-core/src/engine.ts:110-136`, and the durable branches in
  `artifacts/api-server/src/routes/v1.ts` (148, 168, 191, 435) use `authorizedContext`.
- SQL: every statement in `lib/persistence/src/decision-store.ts` and
  `lib/persistence/src/session-store.ts` is parameterised and keyed on `(id, tenant_id)`.
- Audit-log redaction (`lib/audit/src/index.ts:16-50`): recursive over the secret
  keyword list on every `appendAuditRecord`.
- CORS and headers (`artifacts/api-server/src/app.ts:22-51`): explicit allowlist, no
  wildcard, `nosniff` / `DENY` / `no-referrer` / `no-store` set request-context-first.
  Body limits (`artifacts/api-server/src/app.ts:91-92`,
  `artifacts/api-server/src/middlewares/errors.ts:57-104`): 64 kb, parser errors mapped
  without echoing body bytes.
- Enrollment authorisation (`artifacts/api-server/src/routes/v1.ts:558-617`): role gate
  plus an out-of-band secret compared as SHA-256 digests with `timingSafeEqual`; the
  demo-mode gap is documented and labelled to the caller.
- Step-up release binding (`artifacts/api-server/src/routes/v1.ts:676-831`): challenge
  context checked against the stored record before any cryptography; a verified
  assertion releases only the one action key it was minted for; re-evaluation is fresh
  at completion.
- Review-demo profile fencing (`artifacts/api-server/src/lib/profile.ts:11-37`,
  `artifacts/api-server/src/routes/index.ts:14-61`): the three unauthenticated demo
  surfaces are named, gated behind `demoSurfacesEnabled()`, fenced by allowlist under
  `shared-device-gateway`, and `resolveProfile()` refuses to boot on a misspelled
  profile; `scripts/check-launch-profile.mjs` cross-checks. By design and gated.
- `lib/api-zod`: generated schemas used with `safeParse` / `parse` on deferred surfaces
  only; the `/v1` routes validate by hand with prototype-pollution-safe key handling and
  a backtracking-free bearer parser (`artifacts/api-server/src/middlewares/context.ts:172-187`).

### 3.3 Not verified by this stage

- `lib/api-zod`'s `step-up` versus the core's `step_up` enum spelling — contract drift
  only; SDKs read any non-2xx as deny, so it cannot loosen a verdict; no client
  round-trip was traced.
- `express-rate-limit` internals beyond the configuration read; the code already states
  the in-memory store is single-process.
- `@workspace/control-plane`'s `ControlPlane.demo()` internals behind `/cp/v1/*` were not
  traced field by field.
- The `lib/webauthn` Redis lock and WATCH/MULTI counter paths were read, not exercised
  against a live Redis (`proof:enrollment-race` does that).
- The iOS `SecurityManager` request-signing findings were out of this stage's scope;
  separately verified on mainline the same day: `signRequest` now sends
  `deviceBindingIdentifier(for:)` — an identifier, not the key — and
  `verifyTokenBinding` no longer prefix-compares (both closed after the Mac lane's
  2026-09-02 report).

### 3.4 Stage 3 summary

| Severity | Open | Already held by a gate, or verified clean |
| --- | --- | --- |
| Critical | 0 | — |
| High | 0 | — |
| Medium | 0 | — |
| Low | 3 (all in code unreachable from the live API) | about a dozen candidates resolved |

## 4. Adversarial — Schemathesis against the served api-server

Tooling: Schemathesis 4.4.4 (installed user-scope on the Mac for this run; the
evidence-toolchain skill blesses it for exactly this), driving a locally started
`artifacts/api-server/dist/index.mjs` (`NODE_ENV=production`, `LOG_LEVEL=silent`) with
the operator demo key fetched at runtime from the published `GET /api/v1/keys` — never a
literal in any command. Checks: all; workers 2; request timeout 10 s.

Two runs, because the tree holds two OpenAPI documents and the first run used the
wrong one — recorded rather than hidden, since both produced findings:

### 4.1 `lib/api-spec/openapi.yaml` — the legacy `/api` monitoring and demo surface

613 generated cases over 15 operations, 6.3 s, seed `272411697607012901189067931979686309049`.
32 unique failures, none a 5xx, none on the decision path:

- **Two response-schema drifts, both real.** `GET /api/integrations` returns
  `lastSync: null` where the schema says `string, date-time`; `GET /api/metrics/dashboard`
  returns `avgLatencyMs: 11.4` where the schema says `integer`. Both are fixture
  responses from `artifacts/api-server/src/routes/monitoring.ts` and
  `artifacts/api-server/src/routes/integrations.ts`; the document, not the server, is
  what to correct (or the fixture, if the integer was the intent).
- **The document promises write operations the server does not serve at those
  paths** — `POST /api/decisions` (documented 200), `POST /api/signals/ingest` (202),
  `POST /api/policies` (201), `GET`/`PUT`/`DELETE /api/policies/{id}` — all answer the
  JSON 404 catch-all. `docs/API_CONTRACT_AUDIT.md` already records this class of drift
  for the `/v1` document and gates it; the legacy document is outside that gate.
- **Three enum query parameters accepted silently**: `GET /api/decisions?outcome=AAA`,
  `GET /api/signals/latest?signalType=AAA`, `GET /api/metrics/decisions/series?window=AAA`
  answer 200. Reading `artifacts/api-server/src/routes/monitoring.ts:147-153`: an
  unknown outcome filters to an empty list — the tightening direction, on a fixture
  surface — but the document says the value is an enum, so 400 is what it promises.
- **Rate limiting undocumented**: three "rejected schema-compliant request" items and
  several "undocumented 429" items are the fuzzer exceeding the deliberate per-key
  limiter (`SIGNALGRID_V1_RATE_LIMIT`, default 240/min); the limiter behaving is not a
  defect, the document never mentioning 429 is a gap.
- **`TRACE` answers 404, not 405** on every path (12 items): the JSON 404 catch-all
  mounted last is a documented design choice
  (`artifacts/api-server/src/routes/index.ts`); recorded as information.

### 4.2 `lib/api-spec/v1-openapi.yaml` — the `/v1` product contract, the run that matters

2,632 generated cases over all 59 operations, 26.4 s, seed
`200227621342388946771104130099600193949`, 71 unique failures, 216 cases skipped. For
this run only, both rate limiters were raised (`SIGNALGRID_V1_RATE_LIMIT=1000000`,
`SIGNALGRID_GLOBAL_RATE_LIMIT=1000000`) so the fuzzer measured the contract and not the
limiter — the limiter has its own tests in `test:api`, and the raise is the reason 429
does not appear below.

**What did NOT happen, stated first: no request produced a 5xx, the server log holds
zero error lines, and no operation under `/v1` accepted a schema-violating body.** The
71 items are, by class:

| Class | Count | What it is |
| --- | --- | --- |
| Unsupported method (`TRACE` → 404 instead of 405) | 33 | the same catch-all design as 4.1; information |
| Undocumented status code | 27 | 401 on roughly twenty-five protected operations whose documented responses list only 200/404/400/403/409 — the contract never documents the 401 every protected route returns to a missing or unknown bearer; plus 404 on `GET /v1/policies/{id}/versions`, `GET /v1/policies/{id}/tests`, `GET /v1/connectors/{id}/sync-runs` for an unknown id — the existence-hiding 404 `artifacts/api-server/src/lib/profile.ts` mandates, undocumented on those three |
| API rejected a schema-compliant request | 10 | `POST /v1/authorize`, `/v1/decisions/evaluate`, `/v1/decisions/reconcile`, `/v1/step-up/enroll/options`, `/v1/step-up/enroll/verify`, `/v1/step-up/challenge` and four more answer 400 to bodies the document allows — the hand validation in `artifacts/api-server/src/routes/v1.ts` (`parseEvaluate`, `parseReconcile`, `sanitizeContext`) is STRICTER than the document. Fail direction: tightens. The document is looser than the server; the fix is to the document |
| API accepted a schema-violating request | 1 | `POST /cp/v1/sync/{nodeId}` accepted `restrict: false` where an integer is documented and answered 200 with zero counts — on the `/cp/v1` control-plane DEMO surface (fixture-only, one of the three fenced demo surfaces), not on `/v1` |
| Warnings | 3 | 5 operations answered only 401/403 to the operator key (owner-only routes — expected); 10 operations answered 404 throughout because the fuzzer holds no valid ids (expected without seeded fixtures); `POST /v1/app-workflows/evaluate` rejected most generated data — the schema-vs-validation mismatch above, seen from the other side |

**Reading of stage 4 against the doctrine.** Every deviation on `/v1` is the CONTRACT
under-stating what the server does — it answers 401, 404 and 400 in more places than
it documents and validates harder than it promises. That is the fail-closed shape the
repository wants, expressed as a documentation debt: a client generated from the
document would be surprised by refusals, never by permissions. The one permissive
acceptance sits on the fixture control-plane surface that the gateway profile fences
out. Nothing here changes what the gates certify.

**Reproduction shape** (no credentials in the command; the key is fetched at runtime):
build `artifacts/api-server`, start `dist/index.mjs` with `PORT` set, `curl` the
published `/api/v1/keys` for the operator token, then
`st run lib/api-spec/v1-openapi.yaml --url http://127.0.0.1:<port>/api -H "Authorization: Bearer <token>" --checks all`.
One housekeeping fact for whoever runs it next: the fuzzer writes a `.hypothesis/`
cache directory into the working directory it is launched from, which is untracked
and dirties `git status --porcelain` — launch it from outside the tree or delete the
directory afterwards.

## 5. Re-test after fixes

No fix was applied from stages 3 or 4 in this run — every open item is either in a
module unreachable from the live API (stage 3) or a contract document owned by the
cloud lane (stage 4), so each became a backlog row rather than a change made here.
The re-test is therefore the same as stage 2, and it was run again on the Ponytail-cut
branch after the native changes that DID happen this session: preflight and breadth on
that branch, quoted in its commit.

## 6. Validate

- `node scripts/preflight.mjs` → `Preflight PASSED — everything it runs is green.` (245 gates, 2026-09-04 mainline tree)
- `pnpm run verify:breadth` → `Breadth lane PASSED — 56 breadth proofs green` (2026-09-04 and 2026-09-05)
- iOS: `** TEST SUCCEEDED **`, `Executed 76 tests, with 0 failures` (2026-09-05, twice)
- Stage 3: 0 Critical, 0 High, 0 Medium, 3 Low (unreachable) — none held; all filed
- Stage 4: 0 server errors in 3,245 generated requests across both documents; 0 permissive acceptances on `/v1`

## 7. ECC's verdict against the cloud lane's — the disagreement is the finding

`docs/agent/SOLUTION_READINESS_ASSESSMENT.md` evaluated the same tree along six
dimensions from the code. ECC's stages agree with it on the load-bearing conclusion
(the decision and auth surfaces fail closed and are gated) and add two things that
reading alone did not produce: the three dormant-module Low findings, and the measured
gap between the `/v1` OpenAPI document and the server's actual refusals. Neither lane
found a fail-open on the live decision path. The place they most differ is confidence
in the API contract as a client-facing promise: the assessment treats the document as
the contract; the fuzzer shows the server keeps a stricter one.

## 8. Backlog rows this run files

Filed in `docs/BUILD_BACKLOG.md` for the lane that owns each surface:

1. `lib/webauthn/src/webauthn/store.ts` — `createStepUpSession` dual write / swallowed Redis error (Low, dormant path; fix or delete with `verifyStepUp`).
2. `lib/webauthn/src/stepUpStore.ts` — step-up session ids logged in cleartext (Low; log a truncated hash).
3. `artifacts/api-server/src/middlewares/rateLimit.ts` — OIDC rate-limit keying on the rotatable bearer (Low; key on a pre-auth claim peek within the existing order).
4. `lib/api-spec/v1-openapi.yaml` — document 401 on every protected operation, 404 on the three id-keyed reads above, 429 everywhere the limiter applies, and tighten the ten request schemas the server validates more strictly than the document states.
5. `lib/api-spec/openapi.yaml` — two response-schema drifts (`lastSync` nullable, `avgLatencyMs` non-integer) and the documented write operations the server does not serve; decide whether the legacy document is retired or brought under the drift gate.
