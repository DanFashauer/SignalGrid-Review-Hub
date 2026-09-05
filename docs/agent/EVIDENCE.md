# Reviewer evidence log — claim → command → output

The `signalgrid-reviewer` role's only write path (with
`docs/agent/FALSE_CLAIMS.json`). Every entry is one verified claim: what was
claimed, the exact command run, and the output that confirms or refutes it.
Seeded empty at install (2026-08-22); the first review writes the first entry.
Format per entry:

```
## <date> — <claim, one sentence>
Command:  <exactly what was run>
Output:   <the relevant lines, verbatim>
Verdict:  holds | refuted (→ FALSE_CLAIMS.json) | not verifiable here (why)
```

---

## 2026-08-24 — "The ungated-fetch gate covers every outbound path in the connector tree"
Command:
```
cat >> lib/integrations/src/integrations/itsm/zendesk.ts <<'X'
export async function plantedUngated(u: string) {
  return fetch(u, { method: "POST" });
}
X
node scripts/check-ungated-fetch.mjs; echo "exit=$?"
```
Output:
```
  connector files containing fetch: 88
  fetch call sites checked:         86
Ungated-fetch gate passed — no ungated healthCheck() remains.
exit=0
```
Verdict:  **refuted.** `itsm/` is one of four directories where a finding FAILS the
build, and the gate passed with an ungated `fetch` sitting in it. Scope was class
methods only (`if (start === -1 || !isClassMethod) continue`), while the stated
reason for that scope was external callability — which an exported top-level
function also has. Fixed in PR #297; backlog row 65.

## 2026-08-24 — "The fix catches the planted defect without flagging legitimate factories"
Command:
```
Z=lib/integrations/src/integrations/itsm/zendesk.ts
cp $Z /tmp/z.bak
run() { node scripts/check-ungated-fetch.mjs >/dev/null 2>&1; echo "  exit=$?"; }

# 1. the planted hole: exported, ungated, in an ENFORCED dir
cp /tmp/z.bak $Z
printf '\nexport async function plantedUngated(u: string) {\n  return fetch(u, { method: "POST" });\n}\n' >> $Z
run

# 2. control: identical body, NOT exported (internal plumbing, out of scope by design)
cp /tmp/z.bak $Z
printf '\nasync function privatePlumbing(u: string) {\n  return fetch(u);\n}\n' >> $Z
run

# 3. control: exported but carrying its own gate token
cp /tmp/z.bak $Z
printf '\nexport async function selfGated(u: string) {\n  const e = resolveEmission();\n  if (e.mode !== "live") return null;\n  return fetch(u);\n}\n' >> $Z
run

cp /tmp/z.bak $Z   # restore; `git status --porcelain -- $Z` must be empty
node scripts/check-ungated-fetch.mjs | tail -3
```
Output:
```
1. exported ungated fetch in enforced dir (expect 1):
  exit=1
2. non-exported plumbing (expect 0):
  exit=0
3. exported but self-gated (expect 0):
  exit=0
restored: (git status empty)

clean tree:
  connector files containing fetch: 88
  fetch call sites checked:         85
Ungated-fetch gate passed — no ungated healthCheck() remains.
```
Verdict:  **holds.** All ~25 `makeDefault*Transport` factories clear automatically,
including `device-management-health/graph-transport.ts` whose resolver lives one
file over and is reached through the family `index.ts` source.

## 2026-08-24 — "telemetry/ and passkey-assurance are STILL NOT ENFORCED" (a comment in check-ungated-fetch.mjs)
Command:
```
grep -n "STILL NOT ENFORCED" -A 8 scripts/check-ungated-fetch.mjs
# then plant an exported ungated fetch in telemetry/fleetdm.ts
node scripts/check-ungated-fetch.mjs; echo "exit=$?"
```
Output:
```
362:    // STILL NOT ENFORCED ... telemetry/ and passkey-assurance ... stay visible here.
369-    const enforcedDir = /\/(itsm|siem|telemetry|passkey-assurance)\//.test(file);
...
planted in telemetry/ -> exit=1
```
Verdict:  **refuted.** The sentence sat seven lines above the line that made both
families fatal, and contradicted its own preceding bullet, which already listed
telemetry/ as enforced. The enforced list is now derived from a named
`ENFORCED_DIRS` array and printed on every run. Backlog row 67.

## 2026-08-24 — "The ITSM credential store derives a 32-byte AES key" (true, and not the question)
Command:
```
# revert getEncryptionKey() to slice(0,32).padEnd(32,'0'), then:
pnpm run proof:itsm-credential-crypto
```
Output:
```
  FAIL — a human-typed password ('secret') is REFUSED, not padded to 32 bytes
  FAIL — a key one character under the 32-char floor is refused
  FAIL — two 64-char secrets sharing their first 32 chars derive DIFFERENT keys
  FAIL — derivation is SHA-256 of the secret, matching the sibling webhooks store
  FAIL — the IV is GCM's standard 12 bytes
FAIL — 16/21 checks
```
Verdict:  **refuted as a safety claim.** It produced 32 BYTES, not 32 bytes of
entropy: a short secret was stretched with ASCII zeros rather than refused, and a
64-hex secret lost half its entropy to the slice. LATENT, not live — the config
half of that store is wired to nothing. Fixed in PR #297; backlog row 66.

## 2026-08-24 — "The Fleet posture cache honours its own expiry"
Command:
```
# revert getPostureForHost to `return inMemoryPosture.get(key) ?? null`, then:
pnpm run proof:telemetry-posture-cache
```
Output:
```
  FAIL — an entry read AFTER its TTL returns null, not stale posture
  FAIL — a read that finds an expired entry EVICTS it rather than leaving it
FAIL — 17/19 checks
```
Verdict:  **refuted.** `expiresAt` was written at two sites and read at ZERO,
repository-wide. Redis expired its own keys via `EX`; the in-memory half — the
default path when `REDIS_URL` is unset — would have served stale posture forever.
The write is live and the read is dead, so nothing was served stale in practice.
Fixed in PR #297; backlog row 68.

## 2026-08-24 — "Six device-attestation reason codes are asserted in no proof"
Command:
```
for r in ATTESTED_SIP_DISABLED ATTESTED_KEXT_ALLOWED ...; do
  grep -rl "$r" scripts/src | grep -v evaluate.ts | wc -l
done
# then, the real test:
sed -i 's/reason: "ATTESTED_KEXT_ALLOWED"/reason: "ATTESTED_SECUREBOOT_REDUCED"/' \
  lib/integrations/src/integrations/device-attestation/evaluate.ts
pnpm run proof:device-attestation
```
Output:
```
grep: 0 files for six of eleven codes
baseline:  summary=pass (77/77)
mutant:    Exit status 1
```
Verdict:  **my claim refuted — NOT a defect.** Recorded so the next session does
not re-raise it.

CORRECTED 2026-08-24, after external review on PR #299 caught this entry stating
the wrong MECHANISM. It said the proof "asserts on posture/recommendedAction/
criticalFindings, not on the code strings". That is FALSE, and the conclusion
being right did not make the explanation harmless — an evidence log whose
reasoning is wrong teaches the next reader the wrong thing about coverage.

What is actually true:
```
scripts/src/device-attestation-proof.ts:72     v.reasonCode === spec.expected.reasonCode &&
scripts/fixtures/device-attestation/devices.json:22   "reasonCode": "ATTESTED_SECUREBOOT_REDUCED"
scripts/fixtures/device-attestation/devices.json:27   "reasonCode": "ATTESTED_KEXT_ALLOWED"
```
The proof is TABLE-DRIVEN and compares `reasonCode` directly against a fixture
that pins both codes. The mutation dies because the codes are fixture-backed —
not because some other field happened to catch it.

And the reason my grep returned zero is now exact, which is the part worth
keeping: the codes live ONLY in `scripts/fixtures/`, and I searched
`scripts/src`. A narrow search over the wrong subtree — the precise failure
`pnpm run check:absence` exists to prevent, which I did not run before asserting
absence.

## 2026-08-24 — "credential-exposure escalates on highValue only, ignoring severity"
Command:
```
grep -n "highValue" lib/integrations/src/integrations/credential-exposure/*.ts
```
Output:
```
credential-connector.ts:160:  highValue: HIGH_VALUE_KINDS.has(kind)
                              || severity === "critical" || severity === "high",
```
Verdict:  **my claim refuted — NOT a defect.** Severity is folded into `highValue`
at NORMALIZATION, so a critical secret does escalate; the comment is accurate and
the code implements it one layer up. This was the third hypothesis of the day with
the same shape — reading an evaluator in isolation and assuming its input was raw.
This codebase does the fail-closed work at the normalization boundary so the
evaluator can stay simple, and a grep across one layer cannot see that.

## NOT VERIFIED HERE (as of 2026-08-24)

Not an evidence record — no claim, command or verdict. Deliberately headed so the
entry counter cannot mistake it for one; coverage gaps are findings, and they are
reported separately rather than padding the entry count.
- **iOS / Swift behaviour.** No Xcode in this environment. Backlog row 58 (the
  Swift analogue of the NaN fail-open) remains open and is owed by the Mac lane.
- **`validate-sim-macos.sh` on real macOS.** This lane runs `preflight.mjs`; the
  harness under bash 3.2 on arm64 is the Mac lane's surface.
- **GitHub Pages source setting.** The REST call returns 403 through this
  environment's proxy; the branch-based-Jekyll conclusion was reached from served
  artifacts (a `?v=` stylesheet hash resolving to a real commit, `/README.md`
  returning 200, no `_config.yml`, no `gh-pages` branch), not from the API.

## 2026-08-24 — "A 403 from the GitHub API is always a permission finding"
Command:
```
# CI, PR #303, job "Typecheck, build, and proof scaffold", re-run after an
# unrelated E2E flake:
node scripts/check-ci-liveness.mjs
```
Output:
```
  ✗ could not reach the GitHub Actions API: GET /repos/DanFashauer/SignalGrid-Review-Hub/
    actions/workflows/scheduled-verification.yml/runs?per_page=10&status=completed
    -> 403 rate limit exceeded
      In CI this is FATAL.
```
Verdict:  **refuted, and it was my own arm.** Earlier the same day I gave this gate a
bounded retry and wrote that 401/403/404 "must surface on the first attempt rather than
being buried under three retries". True for a token lacking `actions: read` — and GitHub
also returns 403 for a SECONDARY RATE LIMIT, which is as transient as the 429 the same
commit made retryable. The arm added to keep permission findings honest reintroduced the
cry-wolf failure the retry existed to prevent.

The status alone cannot separate them, so the BODY decides: a 403 saying "rate limit",
"secondary rate" or "abuse detection", or carrying an exhausted-quota header, is
retried; every other 403 still fails on the first attempt. Positive evidence only — an
empty or unreadable body stays permanent, because guessing "probably a rate limit" would
bury the `actions: read` finding.

Falsified in BOTH directions, which is the part that matters for a discriminator:
```
classifier forced FALSE -> 3 checks fail, incl. "a rate-limit BODY marks a 403 retryable"
classifier forced TRUE  -> 3 checks fail, incl. "a PERMISSION 403 stays permanent"
restored                -> self-test green
```

## 2026-08-24 — "The E2E failure on PR #303 was caused by this branch"
Command:
```
pnpm --filter @workspace/scripts exec playwright test --config playwright.config.ts \
  --tsconfig ../tsconfig.base.json src/e2e/workflow-safety.spec.ts
pnpm run test:e2e            # the full suite, full concurrency
pnpm --filter @workspace/api-server run test:api
```
Output:
```
3 passed (28.7s)        # including the exact spec CI failed on
53 passed (57.3s)       # E2E_EXIT=0
API integration test: 301/301 assertions passed
```
Verdict:  **not reproducible here — reported as such, not as "fixed".** CI failed one of
53 E2E tests (`workflow-safety.spec.ts:37`, a `/cp/v1/grid/config` status check); the
same spec and the whole suite pass locally on the same tree, and the api-server suite is
301/301. The re-run then failed on the unrelated 403 above rather than repeating it,
so the E2E failure has been observed ONCE and never reproduced. Recorded as an
unexplained single occurrence, not as a flake I have proven.

## 2026-09-04 — "The enterprise-auth (OIDC/JWT) sign-in surface is fail-closed with no fail-open defects"
Command (adversarial read of the whole surface against the repo's known defect classes):
```
lib/enterprise-auth/src/{jwt,jwks,claims,config,provider,base64url}.ts   (653 lines)
```
Output (what each fail-closed property was checked to hold):
```
jwt.ts    alg gate FIRST: header.alg !== "RS256" -> reject, before key material (none/HS* blocked)
          signature verified BEFORE claims; RSA-SHA256 (PKCS1-v1_5) only
          exp REQUIRED (missing exp -> fail); exp/nbf/iat use injected nowMs (deterministic), tol default 60s
          no-kid header accepted only when JWKS has exactly ONE usable RSA key; else reject
          iss exact-match, aud contains, sub non-empty — every default REJECT
jwks.ts   never caches a failed fetch (throws on !ok); unknown-kid refetch is cooldown-limited (forged-kid DoS guard)
          kid-miss after cooldown -> serve cache -> caller rejects (fail-closed); fetch + clock injected
config.ts OIDC OFF unless OIDC_ISSUER set; partial config -> invalid (not silently enabled)
          empty tenant/role map -> invalid; blank OIDC_CLOCK_TOLERANCE_SEC -> 60, NOT Number("")===0 (the fail-open class, handled)
          role-map values validated against VALID_ROLES
claims.ts deny-by-default: missing/unmapped tenant or role -> reject; hasOwnProperty.call guards prototype pollution
provider  JWKS fetch failure -> {ok:false}; verify->map all fail-closed; authenticateOrThrow -> CoreError(401); logs subject, never token
```
Verdict:  **approved — zero fail-open, non-determinism, or unknown-treated-as-permissive defects.**
Two NOTE-level, non-defect observations (recorded, not filed as defects; the identity legitimately
holds all mapped roles and the JWKS is IdP-controlled):
  1. claims.ts grants the FIRST token-order role value that maps; a least-privilege-among-mapped
     tie-break would be the more deterministic fail-closed choice on a multi-role token.
  2. jwt.ts selectKey filters kty/n/e but not use==="sig"; an enc-designated RSA key in the JWKS
     could be selected (low risk — the IdP controls the JWKS).

## 2026-09-04 — "The audit-ledger surface (lib/audit) is a fail-closed, provably append-only hash chain"
Command (adversarial read of the whole surface):
```
lib/audit/src/{index,backend,types}.ts   (672 lines)
```
Output (fail-closed / integrity properties checked):
```
index.ts   canonical JSON sorts keys AT EVERY DEPTH incl. inside arrays; keys AND values escaped (a crafted
           key can't forge neighbouring framing); MAX_CANONICAL_DEPTH=32 -> append REFUSES rather than hash
           over a truncated serialization; secrets redacted BEFORE hashing (never enter hash input in clear)
           verifySegment re-derives the record field-set identically to append (append<->verify hash match);
           verifyLedger is cap-HONEST (truncated:true means "prefix intact", not a clean-chain all-clear);
           verifyLedgerFull paginates the whole chain in bounded memory
           new Date()/uuidv4() are appropriate here (an audit record captures real time/id — NOT a decision
           path, so golden rule 2 does not apply)
backend.ts appendWithChain is ATOMIC: BEGIN + pg_advisory_xact_lock + read-head + insert + COMMIT, so the
           chain cannot fork under concurrent writers; Postgres gated on DATABASE_URL, in-memory default
           readiness ASSERTS the append-only boundary: SELECT+INSERT+seq USAGE required, and UPDATE/DELETE/
           TRUNCATE (table/column/PUBLIC/sequence-setval) FORBIDDEN -> not ready. The runtime role provably
           cannot delete tail records, which is the structural tail-truncation defense.
           rejected-init retried single-flight; ts re-serialized to the exact ISO the hash was computed over
```
Verdict:  **approved — zero fail-open / integrity defects; the append-only boundary is actively enforced at readiness.**
Two NOTE-level, non-defect observations:
  1. The hash chain alone cannot detect TAIL truncation (deleting the most-recent K records leaves a valid
     shorter chain); this is mitigated structurally by the forbidden-DELETE/TRUNCATE readiness check rather
     than by a persisted external head-hash/count anchor. An admin-level DB actor is outside that boundary.
  2. Secret redaction matches SECRET_KEYS as a substring ("key" matches "monkey"/"keyboard"): over-redacts,
     which is the safe direction for an audit trail.

## 2026-09-04 — "The event-contract surface (lib/event-contract) is fail-closed input validation + pure detection"
Command (adversarial read of the whole surface):
```
lib/event-contract/src/{validate,detect,types}.ts   (381 lines)
```
Output (fail-closed properties checked):
```
validate.ts non-object/array input -> reject; required fields missing -> error; enum fields reject any value
            not in the frozen domain (unknown -> error, never admitted); id fields use a length-bounded
            ReDoS-safe regex; FORBIDDEN_KEYS (__proto__/constructor/prototype) rejected and the result is
            built from validated locals only (no dynamic obj[key] write) -> no prototype pollution;
            batteryPercent Number.isFinite + [0,100] (NaN/Infinity rejected); unknown fields dropped;
            never throws on hostile input
detect.ts   pure/deterministic (no clock, no randomness), set-based; detections are ALARMS (info..critical),
            not grants — a missing signal fails to FIRE an alarm, it never loosens a decision; unknown MDM
            state ("unmanaged"/"unknown") is treated as DARK and fires the alarm (the tightening direction)
types.ts    EVENT_TYPES/MDM_STATES/CARRIER_STATES/TAMPER_STATES/CHARGE_STATES const arrays match the union
            types exactly; the "unknown" members are in-domain and drive fail-closed detection
```
Verdict:  **approved — zero fail-open defects; unknown/malformed input is rejected and unknown states tighten.**
Two NOTE-level, non-defect observations:
  1. isoField validates occurredAt with Date.parse, which is engine-lenient — a parseable but non-strict
     timestamp is admitted despite the "ISO-8601" field contract (downstream freshness is fail-closed on
     future/unknown, so this is a contract-tightness gap, not a decision fail-open).
  2. detectCrossDomain uses events[0].correlationId for all detections without asserting every event shares
     it — a single-timeline caller contract, not enforced here.

## 2026-09-04 — "The DDM connector (lib/ddm-connector) normalizes fail-closed: unknown/stale posture only RAISES assurance"
Command (adversarial read of the whole surface):
```
lib/ddm-connector/src/{index,apple-schema,fixture}.ts   (~380 lines)
```
Output (fail-closed properties checked):
```
index.ts     deviceManaged = (enrolled === true) — strict; any non-true (undefined/"true"/truthy) -> unmanaged
             health: healthy->compliant, degraded->non_compliant, ELSE (unreporting/unknown/anything)->unknown
             binaryControl: enforced->aligned, permissive/disabled->drifted, ELSE->unknown
             freshnessOf: null->missing, Date.parse NaN->unknown, future(age<0)->unknown, <=24h fresh,
               <=72h stale, else expired; a malformed nowIso (NaN) lands on "expired" via the NaN-compare
               chain -> non-fresh -> raise (still fail-closed)
             enforcementCurrencyOf: ONLY exact "declarative"->current; legacy on OS>=27->dead, legacy pre-27
               or unknown-OS->at_risk, none->dead, unmapped/unknown->unknown (never current)
             `weak` ORs every weak-posture condition; assurance is advisory and can only move auto->step-up,
               never relax; "standard" requires enrolled+enforced+declared+healthy+fresh+current all true
apple-schema compile-time provenance map with exhaustiveness teeth against DdmDeviceReport (missing/extra
             field = build error); no runtime logic, no fail-open surface
```
Verdict:  **approved — zero fail-open defects; every unknown/missing/stale/unverifiable input tightens (raises assurance).**
No defects and no material NOTES (the connector's guarantees block comment is met by the code).

## 2026-09-04 — "The control-plane bundle-authenticity check failed OPEN for unprovisioned tenants — fixed and gated"
Command (adversarial read via fail-closed-auditor, reproduced + fixed + mutation-tested):
```
lib/control-plane/src/index.ts   (598 lines)   consumers: artifacts/api-server/src/routes/control-plane.ts, scripts/src/edge-sync-proof.ts
```
Output:
```
FINDING 1 (fixed) — bundleSignature() used FIXTURE_SIGNING_KEYS[tenantId] ?? "cpk_demo_unknown_signing",
  and verifyBundleSignature() calls that same function. A bundle for any tenant NOT in the six-key registry
  therefore verified against a shared, source-literal fallback: an attacker naming an unprovisioned tenant,
  computing its (public) checksum and signing with that public constant, produced a bundle that VERIFIED —
  an unknown signal loosening the authenticity answer (golden rule 2 inverted). Structural, survives the
  move to real per-tenant secrets the comment anticipates.
  FIX: signingKeyFor() returns undefined for an unprovisioned (or prototype-named) tenant via
  hasOwnProperty; bundleSignature() returns undefined with NO fallback; verifyBundleSignature() returns
  false when expected is undefined; getPolicyBundle() returns null rather than mint an unsignable bundle.
FINDING 2 (fixed) — edge-sync-proof only forged by MUTATING content (breaks the recomputed hash regardless
  of key) or zeroing the signature, so it never exercised the unprovisioned-tenant path and certified
  nothing about the fallback. FIX: an assertion constructs a checksum-valid bundle for an unprovisioned
  tenant signed with the (now-removed) shared fallback and asserts verifyBundleSignature === false.
  MUTATION TEST: restoring the fallback -> "unprovisioned tenant fails authenticity" FAILS (16/17, exit 1);
  with the fix, 17/17.
FINDING 3 (latent, NOT fixed here) — listSites/listEdgeNodes/listFleet/fleetHealth/operationalIntelligence
  filter with `!tenantId || s.tenantId === tenantId`, so an empty-string tenant returns EVERY tenant's data
  (same as undefined). Not a live breach: the HTTP route normalizes "" -> undefined and the plane has no
  per-caller authz (all fixture data is public). Deferred to a follow-up: treat "" as invalid (empty result),
  distinct from undefined (all). Recorded, not fixed, to keep this PR the reachable security fix.
Fail-CLOSED and verified correct: verifyBundleChecksum, the signature length/hex-parse/timingSafeEqual
guards (catch -> false), ingestTelemetry nonNeg (NaN/Inf/neg -> 0), getPolicyBundle/applyBundle/syncPlan
(unknown -> null, version only advances), custodyGaps (status !== "healthy" -> gap), no allow-default switch.
```
Verdict:  **one real fail-open on the authenticity boundary, FIXED and now gated by a mutation-proven proof assertion; one latent caller-gated note deferred; everything else fail-closed.**

## 2026-09-04 — "Finding 3 fixed: control-plane empty-string scope no longer reads as a cross-tenant wildcard"
Command (fix + mutation-proven proof, follow-up to the 2026-09-04 control-plane read; owner-requested):
```
lib/control-plane/src/index.ts   scripts/src/control-plane-proof.ts
```
Output:
```
listSites/listFleet/fleetHealth/operationalIntelligence filtered with `!tenantId || ...` (and listFleet
`!siteId || ...`), so `!"" === true` made an empty-string scope return EVERY tenant's/site's rows — same as
undefined. listEdgeNodes delegates to listSites, so it inherited it too. Caller-gated today (the HTTP route
maps "" -> undefined) but a latent cross-tenant wildcard the moment any caller passes an unresolved id.
FIX: one scopeIncludes(rowValue, scope) helper — undefined -> include all; "" or whitespace-only -> include
NONE; else exact match — applied to all four filters (listEdgeNodes covered via listSites).
GATE: 9 assertions added to control-plane-proof (undefined -> all; "" and "   " -> none, across sites, edge
nodes, fleet devices, fleetHealth verticals, operationalIntelligence). 42/42 with the fix.
MUTATION TEST: restoring listSites's `!tenantId` -> "empty-string tenant scope returns NO sites" and "... NO
edge nodes" both FAIL (40/42, exit 1). typecheck green; edge-sync proof still 17/17.
```
Verdict:  **fixed and gated — an unresolved (empty) scope now fails closed to no rows, distinct from undefined (all).**

## 2026-09-04 — "lib/api-zod is fail-closed by construction, but mostly dead as an input guard; the live /v1 boundary is hand-rolled and fail-closed end-to-end"
Command (fail-closed audit of the Zod surface + verification of the real boundary):
```
lib/api-zod/src/generated/api.ts (355 lines, the whole runtime Zod surface; the other 45 src/generated/types/*.ts are pure interfaces, no runtime)
artifacts/api-server/src/routes/{v1.ts,integrations.ts,health.ts,monitoring.ts}   lib/signalgrid-core/src/decision.ts
```
Output:
```
api-zod schemas: fail-closed by construction (verified vs zod 3.25.76) — objects STRIP unknown fields (no
  .passthrough anywhere); enums REJECT unrecognized values (no .catch/fallback); z.coerce.date rejects NaN/""
  (the expiry-NaN shape, safe here); z.coerce.number rejects "abc"/"false"; no refine/superRefine can fail open.
SYSTEMIC FINDING (architectural, not a loosening): the generated *Body/*QueryParams schemas are DEAD as input
  guards. Only GetIntegrationParams.safeParse runs on live input (a read-only id lookup, safe). The live /v1
  decision/ingest/policy/reconcile routes do NOT import api-zod — they hand-roll validation in v1.ts.
REAL BOUNDARY (v1.ts) verified fail-closed end-to-end: parseEvaluate rejects a non-object body and non-string
  identityRef/deviceRef/workflowKey; clampTtl maps non-finite -> 900 and clamps [60s,86400s] (no zero/unbounded
  TTL); parseReconcile bounds records to 64 and REFUSES rather than truncates (truncating would silently drop a
  restriction). An EMPTY binding string passes parseEvaluate but the core's validateRequest (decision.ts:208,
  `typeof value !== "string" || value.trim().length === 0` -> 400) and findIdentityByRef (unknown ref -> not
  found -> error) reject it. No live fail-open.
LATENT (only if the api-zod schemas are ever wired to the boundary; the file is orval-GENERATED, so fixes belong
  in the OpenAPI source): z.string() with no .min(1) on identity/device/tenant/workflow fields; z.coerce.number
  limit with ""->0 and no int/min/max; sourceTimestamp with no upper bound (far-future = "always fresh").
```
Verdict:  **approved — no live fail-open. api-zod is fail-closed by shape; the /v1 boundary is fail-closed end-to-end.**
Backlog (design targets, deferred): a wiring gate that flags an orphaned generated input schema (a defined-but-
dead validator masquerading as coverage); the latent schema tightenings in the OpenAPI source; and a
defense-in-depth empty-binding reject at parseEvaluate (currently caught only by the core).

## 2026-09-04 — "lib/reliability is fail-closed by construction; one real drift — the owner-facing plain summary was not actually worst-first"
Command (firsthand read of the whole surface + fix + mutation-proof):
```
lib/reliability/src/{index,types,slo,summarize}.ts (291 lines, the whole module)
scripts/src/reliability-proof.ts   artifacts/api-server/src/routes/control-plane.ts (the live consumer)
```
Output:
```
FAIL-CLOSED CORE (verified, unchanged): `unknown` (rank 2) outranks `at_risk` (1) and is in the attention
  set — not-measured is treated as worse than fine; the zero-tolerance integrity SLO has a zero budget so a
  single fail-open exhausts it at any window size and can never be bought down; an empty window is `unknown`,
  never `healthy`; no Date.now/Math.random — SLIs are computed from the supplied record window only.
FINDING (drift, owner-facing): summarize.ts:55-56 claimed the plain lines are "Worst-first: exhausted, then
  unknown, then at_risk" but the sort key was binary — `Number(b.needsAttention) - Number(a.needsAttention)`.
  With TWO attention lines of differing severity it left them in input order, so a critical fail-closed breach
  ("Treat as critical.") could render BELOW a merely "Getting close" at_risk line. summarizeReliability is
  consumed by control-plane.ts (the operator surface), so the mis-order reaches a real reader.
FIX: sort by the shared BUDGET_STATUS_RANK descending (exhausted>unknown>at_risk>healthy); Array.sort is stable
  so equal-rank lines keep input order.
GATE: reliability-proof gains a scrambled-report assertion (healthy,at_risk,exhausted,unknown in -> the plain
  states must read "Over budget|Not measured|Getting close|On track") plus a tie-stability assertion. 30/30.
MUTATION TEST: restoring the binary needsAttention sort -> the worst-first assertion FAILS (29/30, exit 1).
```
Verdict:  **fixed and gated — the operator's plain reliability summary now leads with the most critical objective, matching its stated contract.**

## 2026-09-04 — "lib/self-audit's probe path is fail-closed, but an audit that checked NOTHING reported the calm all-clear (nothing-checked read as all-clear)"
Command (fail-closed audit of the integrity module + firsthand repro + fix + mutation-proof):
```
lib/self-audit/src/{audit,summarize,types,checklist,heal,defaults,index}.ts
scripts/src/self-audit-proof.ts
repro: runAudit([], {}) -> overall=healthy, counts all 0; summarizePlain(...).allClear=true, headline="Everything is working."
```
Output:
```
FAIL-CLOSED PROBE PATH (verified, unchanged): resolveStatus forces absent/malformed/unrecognized results to
  `unknown`; `unknown` outranks `drifted`; the heal lifecycle has no proposed->applied edge and re-checks the
  approver ref in applyHeal; no Date.now/Math.random. That half is sound.
FINDING (fail-open reporting, the system's OWN integrity module): runAudit seeded `overall` and every per-layer
  status to "healthy" and only ever moved them WORSE as items were seen (audit.ts:84-95). A scope with zero
  items left the seed intact, and summarizePlain derived allClear purely from per-ITEM counts (summarize.ts:132),
  so an empty audit read allClear=true / "Everything is working." An audit that verified nothing affirmed the
  whole system green — "a green check must be positively earned" (the module's own header) violated for the one
  input where nothing was earned. Reproduced firsthand (quoted above).
FIX: the three FUNCTIONAL layers now seed `unknown` (unchecked, not vacuously healthy) with the first item
  REPLACING the seed; `meta` stays healthy-when-empty (its coverage-gap machinery runs on every audit, so empty
  meta genuinely means no meta problems — this avoids forcing a noisy "Not checked" on a clean run). `overall`
  folds the per-layer statuses, so any unchecked functional layer taints it to `unknown`. summarizePlain's
  allClear now requires overall==="healthy"; a not-healthy report with zero attention items gets the honest
  headline "The system could not fully check itself."
GATE: self-audit-proof section (7): empty audit -> overall unknown, functional layers unknown, meta healthy,
  allClear false with the honest headline; and a backend-only audit (frontend/api_int unchecked) -> overall
  unknown. 61/61. Existing all-healthy/broken/gap-unknown assertions still hold (populated audits unchanged).
MUTATION TEST: reverting the functional seeds to "healthy" and allClear to item-count-only -> the four new
  assertions FAIL (57/61, exit 1). typecheck green.
```
Verdict:  **fixed and gated — the self-audit can no longer show a false all-clear; nothing-checked reads as unverified.**

## 2026-09-04 — "lib/facility-trust-graph is fail-closed except one field: a present-but-unparseable map_version granted, while a well-formed-wrong one restricted"
Command (fail-closed audit of all 8 files + fix + mutation-proof):
```
lib/facility-trust-graph/src/{graph,evaluate,correlate,clinical,transition,gateway,fixture,index}.ts (1846 lines)
scripts/src/facility-trust-graph-proof.ts
```
Output:
```
CLEAN (verified): no Date.now/Math.random; all four Date.parse calls are regex+Number.isFinite guarded
  (instantOf) so a bad instant is null and every comparison is null-guarded; graph loader refuses empty/
  blank/unknown-kind/dup-id/multi-root/cycle and resolves ambiguous vendor refs to null (never a guess);
  evaluate's severity ladder raises on every non-affirmative axis with a positivelyCertain fallback;
  correlate/transition/clinical/gateway all fail closed on unreadable/unknown/future/unmapped inputs.
FINDING (fail-open, decision-adjacent): map_version was the ONLY externally-typed observation field with no
  "shapeBad" tripwire. accuracy_class/source_health/observed_at/confidence each fold a *ShapeBad term into
  `malformed`; map_version did not. textOf(raw.map_version) maps a number / "" / whitespace to null, and
  null reads mapVersionMatch="unassessed" — which the grant path accepts. So a PRESENT-but-unparseable
  map_version produced SUFFICIENT_CERTAINTY (grant), while a well-formed-but-WRONG one produced
  MAP_VERSION_MISMATCH (restrict): garbage wire data was strictly MORE permissive than bad data. Reproduced
  by the sub-agent against the fixture graph via the real normalize->evaluate path.
FIX: added mapVersionShapeBad = (map_version present && not null && textOf === null) folded into `malformed`
  (evaluate.ts). A present, illegible map_version now -> malformed -> REPORT_MALFORMED -> step_up. An ABSENT
  map_version stays "unassessed"/grant-eligible by design (no requirement lever forces map assessment; only
  present garbage raises).
GATE: facility-trust-graph-proof gains 3 present-garbage assertions (123, "", "   " -> malformed + step_up +
  REPORT_MALFORMED) + 1 absent-stays-grant-eligible assertion. 124/124. grantingCombos figure unchanged (24).
MUTATION TEST: removing mapVersionShapeBad from the malformed disjunction -> the 3 present-garbage assertions
  FAIL (121/124, exit 1); the absent-case assertion correctly stays green (the fix does not over-tighten).
```
Verdict:  **fixed and gated — an unparseable map_version now fails closed like every sibling field; garbage can no longer out-grant a well-formed conflict.**

## 2026-09-04 — "lib/posture-composition fuses correctly (strongest action wins), but an OFF-LADDER action NaN-sorted into an undefined riskTier"
Command (fail-closed audit of all 4 files + fix + mutation-proof):
```
lib/posture-composition/src/{types,compose,adapters,index}.ts
scripts/src/posture-composition-proof.ts
```
Output:
```
CLEAN (verified): composeDeviceRisk takes the MAX rank across signals (strongest concern wins, never
  diluted); fromDevicePosture requires positive confirmation on all five Graph fields (only
  enabled x compliant x managed x registered x userRisk<=medium reaches the `none` seed); the other ~40
  adapters are pure pass-throughs whose action unions are subsets of UNIFIED_ACTIONS; no Date.now/Math.random;
  ACTION_RANK is built from UNIFIED_ACTIONS order (no key-order dependence).
FINDING (latent fail-open + determinism, behind 40 `as UnifiedAction` casts): an action NOT on the unified
  ladder (reachable via any adapter's cast or a hand-built ComposableSignal) made ACTION_RANK[action]
  undefined -> the sort comparator `b.rank - a.rank` returned NaN (order-DEPENDENT result, violating the
  module's own determinism contract) and TIER_BY_ACTION[strongestAction] === undefined riskTier (a consumer
  reads undefined as the permissive side). No live path produces an off-ladder action today (all unions are
  subsets), so this is LATENT — the exposure is the cast, and a future integration whose action union grows a
  member (e.g. "deny") would flow straight through with zero compile error.
FIX (compose.ts): rankOf()/tierOf() helpers — an action absent from ACTION_RANK/TIER_BY_ACTION is treated as
  the MOST severe (rank = UNIFIED_ACTIONS.length, tier "blocked"), never NaN/undefined. Fail closed: an unknown
  concern outranks every known one and yields a defined, order-independent verdict.
GATE: posture-composition-proof gains 3 assertions (off-ladder -> blocked/defined; off-ladder outranks a
  genuine escalate; order-independent across [off,escalate] vs [escalate,off]). 78/78.
MUTATION TEST: reverting to ACTION_RANK[s.action] / TIER_BY_ACTION[strongestAction] -> all 3 FAIL (75/78,
  exit 1). typecheck green.
NOTE (not fixed here, filed): composeDeviceRisk's empty-input contract returns ok/none with signalCount 0 —
  deliberate and documented, guarded correctly by pim-activation but relied-on-caller by work-context; a
  fusion-contract gate (every call site reads signalCount, or the module returns unknown for signalCount 0)
  is a design-target for whoever owns the contract, not this fix.
```
Verdict:  **fixed and gated — an off-ladder action now fails closed to the most-severe, order-independent verdict instead of a NaN sort and an undefined tier.**

## 2026-09-05 — "lib/location's NAC ingest validated the event timestamp and then discarded it — the freshness guard compared now against now and could never fire"
Command (firsthand read of the whole surface + fix + proof + mutation):
```
lib/location/src/{config,index,radius-dhcp,store,types,validate}.ts (444 lines, 6 files)
scripts/src/location-services-proof.ts   scripts/review-invariants.mjs (the lib/location/src/ clock-read pin)
```
Output:
```
CLEAN (verified): store.ts guards NaN on both the read TTL and the sweep (Number.isFinite, keyed by
  check-nan-fail-open); validate.ts rejects a non-finite observedAt, a future instant beyond 30s, an age
  beyond LOCATION_MAX_AGE_SECONDS, and a mode mismatch; config.ts clamps a garbled max-age to 120 and
  refuses < 30; an empty deviceId is dropped, never fabricated as "unknown". No decision consumes stored
  presence today (zero importers — the invariant pin records this as the EXPECTED state of a deferred
  family, not evidence the package is dead).
FINDING (latent fail-open, freshness): RADIUSAccountingSchema requires eventTimestamp and DHCPLeaseSchema
  requires timestamp as ISO datetimes — then ingestRADIUS/ingestDHCP stamped `observedAt: Date.now()`, the
  INGEST instant, and never read them. validateLocationSignal's age check therefore compared the receiving
  clock against itself: a late-delivered or replayed Accounting-Start / lease from yesterday became a FRESH
  coarse presence fact, and the future-instant check could never fire either. A guard that cannot fire.
  Neither location proof covered this path (both exercise lib/integrations' evaluateLocation).
FIX: observedAt is Date.parse() of the event's own required timestamp (the schema already guarantees an ISO
  string; an unparseable value is NaN and the validator's Number.isFinite guard rejects it — fail closed,
  never re-stamped). Two clock reads REMOVED, not injected; the lib/location/src/ pin in
  review-invariants dropped 5 -> 3 with the drop documented in its reason (the three that remain are the
  age comparisons themselves, which are the point).
GATE: proof:location-services (the same deferred family, so no new proof name — breadth membership is
  derived one-to-one from family names and the census would refuse an orphan) gains 8 assertions: a current
  Start/lease is accepted with observedAt === the event instant; a replayed record beyond the max age is
  REFUSED; a future-dated record beyond the skew tolerance is REFUSED; Stop/expire still create no presence.
  LOCATION_MODE is read at module load and defaults to "presence" while the ingest emits "coarse" — a
  mismatch that would mask the freshness verdict — so the proof sets the env and imports the package
  dynamically. 40/40 -> 48/48. review:invariants clean at count 3. scripts gained the @workspace/location
  dependency; lockfile regenerated (pnpm install --lockfile-only) and the workspace link verified.
MUTATION TEST: restoring `observedAt: Date.now()` on both paths -> 4 assertions FAIL (44/48, exit 1): both
  replay refusals, the future-instant refusal, and the DHCP observedAt-is-the-lease-instant check.
NOTED, not changed (design targets): (1) the default LOCATION_MODE="presence" vs the ingest's hardcoded
  "coarse" means the NAC ingest is inert out of the box — fail-closed, but a config coupling worth a
  startup-time refusal rather than silent total rejection; (2) an Accounting-Stop / lease release does not
  CLEAR presence, so departure is invisible until the store's 24h TTL — a stale-true presence if a decision
  ever consumes getLast; (3) handleNetworkLocationIngest reports success:true with location undefined when
  the validator DROPPED the record, so a fail-closed rejection reads as success to the caller.
```
Verdict:  **fixed and gated — a replayed or stale NAC record can no longer re-stamp itself fresh; the freshness guard now has something to bite on.**

## 2026-09-05 — "One family, six libraries: an unknown, off-ladder or zero-signal input read as the permissive answer"
Command (firsthand reads + four independent audits + fix + proof + mutation on each):
```
lib/orchestration/src/index.ts (499)   lib/work-context/src/{reevaluate,types,assemble}.ts   lib/pim-activation/src/from-posture.ts
lib/handoff-sim/src/{release,simulate,types}.ts   lib/incident-playbook/src/map.ts   lib/integration-bridge/src/{index,evidence}.ts
lib/fleet-connector/src/{index,client}.ts   lib/posture-composition/src/compose.ts (rankOf/tierOf now exported)
```
Output:
```
REACHABILITY (bounds every severity): every finding below is LATENT. orchestration, work-context, handoff-sim,
  incident-playbook and integration-bridge are imported only by @workspace/scripts (check-package-reachability);
  pim-activation's only signalCount producer is composeDeviceRisk; fleet-connector's parser cannot emit NaN. None is
  exploitable from a shipped artifact today. Each becomes REAL the day a product integration inherits it whole.
orchestration  F1 `sensitivity === "controlled"` at 3 catalog entries + the catalog selector: an unrecognised or
               absent sensitivity got the STANDARD room's plan (no cabinet, no witness, device.assign auto). Now
               fail-closed: controlled unless a recognised LOWER tier. F2 `CATALOGS[room.domain]` on an unknown
               domain destructured undefined and THREW — no plan, no audit record; now enumerated against the default
               catalog with every action blocked and mode deny. F3 `firstReason(codes)` crashed on a non-array and
               produced "Denied — undefined" on a holey one; now type-guarded. 41 -> 48 checks incl. a full-ladder
               monotonicity sweep (drops=0, gains=0 over 4 outcomes x 3 rungs).
work-context   F1 a device with ZERO signals composed `none` and, under a `none` ceiling, walked away with a `none`
               decision and an `ok` tier — the proof PINNED it (rank none at line 218). Now a dark device is graded
               step_up with the step_up tier, guard `!(count > 0)` so an unreadable count is dark too. F2 four raw
               `ACTION_RANK[x]` sites (worstAction, ceilingFromAction, worstCeiling, assemble) read undefined for an
               off-ladder action and `undefined >= n` is false; all four now rank through the composer's exported
               rankOf. 52 -> 58 checks: absolute dark-device assertion over 6 contexts + off-ladder at all four sites.
pim-activation F1 `signalCount <= 0` read undefined/NaN/"3" as a confirmation; now typeof number && > 0, and the
               tier is checked against the known set. F2 the exhaustive sweep's hand-listed domains are pinned to
               PIM_ACTIVATION_REQUEST_KEYS so a new ignored field cannot hide. 43 -> 51.
handoff-sim    F1 release trusted a zero-signal device and, via a raw rank, an off-ladder one; now judged on
               drivers.length and rankOf. F4 an unknown step kind was recorded APPLIED; now refused `unknown_step_kind`.
               F5 handoff.deviceRef and verify.verificationEvidenceRef were the unswept ingress refs; swept. F6 the
               vocabulary is HANDOFF_SIM_ERROR_CODES (as const, type derived) and the proof iterates it — the hand
               copy claimed "every" while two codes were missing and its size===7 pin resisted correction. 55 -> 59,
               refusals figure 7 -> 10 (docs updated).
incident-playbook F1/F2 the default arms of urgencyFromAction/urgencyFromDetection returned null — an off-ladder
               action the composer tiers `blocked` at the maximum rank opened NO incident while a milder step_up
               opened a P2; now critical. F3/F7 empty drivers and unknown driver kinds routed to the Service Desk;
               now SecOps. F6 a prototype-key impact yielded a ticket with no priority, no SLA, escalate:false;
               matrix lookup now guarded, unknown -> P1. 49 -> 60. Accepted as design, not changed: absent impact
               defaults to medium (pinned); zero-signal postures open no incident (the no-noise rule).
integration-bridge F1 `device_management: true` asserted UNCONDITIONALLY from FleetDMPostureSignal, which has no
               enrollment field — moved a verdict from step_up to allow on a fact nobody read. Removed (silence is
               the rule); launch-seam gains the guard (45 -> 46). F4 policyState now gated on enrolment like
               compliance. F7 an empty-string provenance no longer skips the fallback. Design targets NOT changed,
               recorded: draft observedAt is the read instant not the sighting (F2/F3), `partial` quality keeps
               positives with no stated reason (F5), `source_verified` is a literal (F6), FILE_FLOOR comment claims a
               detection it lacks (F8).
fleet-connector F1 `typeof x === "number"` read NaN as OBSERVED on both OS-floor guards; now Number.isFinite.
               F2 the osFloor comment claimed the normalizer answered `unknown` for an absent floor; the code never
               did — comment made true (absent floor = not enforced). F5 fleetSummary gains complianceUnknown so
               "3 of 8 non-compliant" no longer implies 5 healthy. 63 -> 67. F3 (/^on/ prefix), F4 (hostRef
               collapse), F6 (envelope assertion shape) recorded, not changed.
MUTATION (each fix reverted alone on a backup copy; its proof must fail):
  wc dark=false 56/58 FAIL · wc raw worstAction 57/58 FAIL · wc raw ceilingFromAction 55/58 FAIL
  orch sensitivity===controlled 46/48 FAIL · orch domain unguarded CRASH · orch firstReason unguarded CRASH
  pim count<=0 48/51 FAIL · handoff release guard reverted 56/59 FAIL · incident defaults->null 41/60 FAIL
  incident empty-drivers->general 59/60 FAIL · fleet typeof-number 66/67 FAIL · bridge device_management restored 45/46 FAIL
  All twelve killed; zero .mutbak left in the tree.
review:invariants passed. typecheck exit 0.
```
Verdict:  **fixed and gated across all six — the same inversion in six places, each now refusing on the unknown instead of waving it through, and each refusal proven load-bearing.**

## 2026-09-05 — "Second audit round, four more libraries: the unknown loosens the answer in flows, recommendations, adaptive-proposals and app-workflows"
Command (five independent audits + firsthand reads of every edit site + fix + proof + mutation):
```
lib/flows/src/{index,provisioning-teardown,signal-sourcing}.ts   lib/recommendations/src/index.ts
lib/adaptive-proposals/src/{measure,lifecycle,observe}.ts         lib/app-workflows/src/index.ts
(lib/room-sim/src/** read and found CLEAN in itself — its findings sit in the console and proof and land in the next batch)
```
Output:
```
REACHABILITY: flows, recommendations and app-workflows SHIP via @workspace/api-server; adaptive-proposals is
  proof-only (the reachability gate said otherwise — it credits `@workspace/…` mentions inside COMMENTS as
  dependency edges; that gate defect is the next batch's). Each finding's severity below carries its own bound.
flows          F1 REAL: an unrecognised SignalStatus ("offline", "toString") counted as neither broken nor stale, so
               the flow graded HEALTHY — and because `3 > undefined` is false, an unknown observed FIRST masked a
               `broken` observed second: no incident, no self-heal, coverage 100% "auto_handled". SignalStatus was
               validated nowhere in the estate. Now normalized to `broken` (most restrictive) with a terminal arm.
               F2 LATENT: `kind in TEARDOWN_ORDER` walks the prototype chain — a "toString" kind passed the unknown-
               kind guard and `Math.max(prev, function)` NaN-poisoned the ordering guard, so `teardownProven` said
               true for a reversal that strands its extension. Own-key + finite now. F3 `BASE_FIDELITY[method] ??
               "none"` — a prototype key is not nullish; own-key now. F4 recorded, owner doctrine: the break-glass
               arm returns before the outcome switch, so it survives `step_up` (unverified holder) and an
               UNPARSEABLE outcome. F5 recorded: approval satisfaction is a bare caller boolean (planner has no
               executor). flows 32 -> 35, provisioning-teardown 25 -> 28.
recommendations F1 REAL (contained to fixture input today): `denied > 0 || overrides > 0` with an unreadable count
               skipped the anomaly arm and fell into RELAX — the one field that would have blocked the relaxation
               was the one that could not be read, and the rationale then asserted "no denials/overrides". Unreadable
               is now an anomaly (tightened, rationale says the count could not be read). F2 `samples < MIN` let an
               unreadable count through (defended only by a downstream NaN); positive-form guard now. F3 NaN
               confidence escaped as `null` on the wire and `NaN%` on the page; `bounded()` now. F7 locale-sensitive
               tiebreak -> codepoint. Recorded: tighten() has no rung above the downtime override (silence, not a
               refusal); duplicate ids across duplicate usage rows. 15 -> 24.
adaptive-proposals F1 REAL: a 0% prediction made the threshold `helpedRate >= 0` — twenty incidents that ALL fell back
               to a human reported `helped: true` "realizing the simulation's 0% prediction"; the fix left all 37
               prior checks byte-identical. Now requires incidents > 0, helpedCount > 0, predictedRate > 0. F2 the
               auto-resolution test was a DENYLIST (connector.synced counted as success); allowlist now. F3 a
               simulation over ZERO incidents satisfied the step-5 gate; refused. F4 raw LEGAL_TRANSITIONS[from] on an
               unknown status was an untyped TypeError; typed illegal_transition now. F5 approvedAtRef unvalidated;
               same standard as approvedByRef now. F6 an ABSENT references array flatMapped to [undefined] and read
               "these 1 signal(s) []"; a non-string subject minted prop-undefined; both refused. F7 localeCompare ->
               codepoint. F9 a later kinder fixture overwrote a standing FINDING; a finding now stands. 37 -> 48.
               The core invariant (a proposal cannot activate itself) HELD throughout — verified by the 7x7 sweep
               and a planted illegal transition (34/37 with it planted).
app-workflows  F1 REAL (latent reach): `heldKeys.every(...)` on an integration with NO held actions is vacuously true,
               and released keys were never checked against the integration's own keys — a key that does not exist
               turned a live step_up into `mode: "proceed"` with a summary asserting a step-up that never happened,
               and the linter blessed the shape with zero warnings. Held-set must be non-empty and keys must be the
               integration's. F3 the scoped release had ZERO coverage in the TS lane (deleting the feature left the
               proof and the parity gate green; only test:api noticed) — asserted here now. F4 raw
               DEFAULT_CONFIRMER[vertical] wrote "undefined confirmation" into the sentence a confirmer reads. F5
               firstReason threw on the three RESTRICTIVE outcomes and survived on allow. 43 -> 49.
               F2/F6 are the Swift port's (completeAppStepUp releases the whole integration; a dead permissive
               default in integration(forVertical:)) — backlog item 101, Mac lane, golden rule 1. The parity gate
               compares SHAPE ONLY (3 enums + 4 function names): planted P1-P4 behavioural divergences all green,
               P5/P6 shape controls red. Recorded, not changed here.
MUTATION (each fix reverted alone on a backup copy; its proof must fail):
  teardown bare-in 26/28 FAIL · rec anomaly-not-anomalous 20/24 FAIL · rec samples<MIN 23/24 FAIL
  adaptive zero-prediction / denylist / finding-overwritable / raw-lookup / approvedAtRef / vacuous-sim / unreadable-
  subject: 47/48 FAIL each (7 of 7) · appwf raw confirmer 48/49 FAIL · appwf firstReason CRASH
  DEFENCE IN DEPTH, stated honestly: flows' unknown-status fix and app-workflows' release fix each have TWO guards
  that cover each other, so reverting ONE alone stays green; reverting BOTH fails (flows 32/35, appwf 48/49).
  Fourteen reversions, fourteen kills counting the two doubles; zero .mutbak left.
typecheck exit 0; test:api 370/370; the ten flows-family proofs all green.
```
Verdict:  **fixed and gated across all four — and two of the four are shipping packages whose proofs had been green for the whole life of the defects, because every negative test fed a KNOWN value.**

## 2026-09-05 — "Third audit round, one level out from room-sim: the console coloured non_compliant green, the reachability gate counted comments as imports, and the public console page shipped stale"
Command (firsthand reads of every edit site + fix + gate + mutation):
```
tools/room-console/shell.html (sigClass)      scripts/build-room-console.mjs      scripts/check-package-reachability.mjs
scripts/lane-deliver.mjs                      scripts/src/room-sim-proof.ts       artifacts/mcp-server/src/index.ts (tokenForTenant)
artifacts/signalgrid-app/src/pages/Intelligence.tsx (three "Loading…" sites)     docs/COMPANY_BUILD_PLAN.md items 101 + x-request-id
```
Output:
```
CONSOLE COLOUR: sigClass matched raw substrings — "non_compliant" contains "compliant" and "not_present" contains
  "present", so both rendered GREEN on the public page; unknown/missing/expired rendered blank. Rewritten (separators
  stripped, exact good values first, every bad/warn word beats every good word, unlisted negations bad, unrecognised
  amber, null/undefined amber). 41 vectors now run INSIDE the build, plus a "nothing non-good is green" sweep.
  MUTATION: the original function body → 4 wrong colours, build exit 1 · negation rule dropped → 3 wrong colours,
  exit 1 · strip-only reverted → SURVIVES (the negation rule covers it: defence in depth, stated).
STALE PAGE: a fresh `pnpm run build:room-console` differed from the committed docs/room-entry-console.html BEFORE any
  shell change — the public console had been shipping an older decision core. Gated now in preflight and CI exactly
  like the evidence page ("Room Entry console committed in sync"); the build also refuses a missing /*__BUNDLE__*/
  marker (String.replace no-ops silently) and a bundle without three scenario ids.
REACHABILITY: the edge extractor matched `@workspace/x` ANYWHERE in the text, comments included. Six libraries were
  reported shipped on the strength of prose (adaptive-proposals, event-contract, integrations, location,
  posture-composition, work-context) and the gate said "Unreachable fell from 8 to 7" on the day the fix landed.
  Import positions only now (from / import / import() / require / export-from, subpaths); --self-test with 13 shapes
  registered in preflight and CI; measured count 7 → 13; pin raised 8 → 13 with the reason in the script header,
  BUILD_BACKLOG.md and CI_AND_VALIDATION.md. One non-import mention survives in the tree (ConnectorSetup.tsx JSX prose).
LANE LOOP: a NEW message file moves artifacts/lane-messages' file count, which stales SURFACE_REVIEW_COVERAGE.md and
  failed mail PR #445 on the coverage gate. lane-deliver now regenerates the page inside the worktree after staging
  the mail and lets that one file ride; dry run shows "coverage … regenerated (the file count moved)".
PROOF: room-sim's two cross-tenant refusals were bare catches — an EMPTY token or an unknown scenario id would have
  satisfied them. Now: token non-empty, message contains "not found in tenant" and not "Unknown scenario", and the
  positive control (the tenant's own token runs the scenario). proof:room-sim 43/43.
SMALLER: mcp-server tokenForTenant returned "" for an unseeded tenant (now throws, no tenant echoed; proof 11/11) ·
  Intelligence.tsx three panels said "Loading…" forever on a control-plane error (now name the error) · "20 scenarios"
  → 19 (SCENARIOS.length) in package.json and PRODUCT_COMPLETION_PLAN.md · item 101 cites HostAppViewController.swift:685
  and v1.ts:813 (were 631/723); the x-request-id item cites middlewares/context.ts:31-36 (was v1.ts:749-762, moved).
FOUND, NOT FIXED (owner setting): every "pages build and deployment" run on SignalGrid_Alpha in the 30 listed (back to
  2026-09-04 12:37Z) FAILED at "Build with Jekyll" — Liquid chokes on third_party/everything-claude-code/skills/
  frontend-patterns/SKILL.md line 368. That is GitHub's legacy branch build; pages.yml is manual by design and expects
  Settings → Pages → Source = "GitHub Actions". Until that setting flips, the branch-source site never updates.
typecheck 0 errors · reachability self-test 13/13 · proof-count 58/58 · cited-paths 1734 resolve · coverage gate passed:
  30 read, 10 partial, 60 not read, of 100 surfaces (tools now read in full; scripts, mcp-server, signalgrid-app partial).
```
Verdict:  **fixed and gated — the console's colour law and the reachability count were both wrong in the permissive direction, and each now has a test that fails when it lies; the stale public page can no longer ship.**

## 2026-09-05 — "Fourth audit round, four shipping libraries: an empty radar batch read as a covered grid, a dead session refreshed to 200, the web client resolved undefined as success"
Command (two independent read-only audits + firsthand reads of every edit site + fix + proof + mutation):
```
lib/signal-radar/src/**  lib/signal-discovery/src/**  lib/persistence/src/**  lib/api-client-react/src/**
artifacts/api-server/src/routes/{radar,v1}.ts   artifacts/signalgrid-app/src/pages/Dashboard.tsx
reachability (--why): all four SHIP — radar/discovery/persistence via api-server, api-client-react via signalgrid-app
```
Output:
```
RADAR: scanSignals([]) → "All observed signals are already evaluated by the grid." A dropped body, a broken collector
  and a covered feed read the same, and POST /api/signals/radar substituted [] for ANY non-array (`{}`, null, "all").
  Fixed: `scanned` on the report, a coverage-UNKNOWN summary at zero, 400 on a non-array body (an explicit [] stays
  200). localeCompare → codepoint order (radar + discovery, two sites); the two-calls-in-one-process determinism
  assertions could not see it, so the ORDER is pinned ("Zebra" < "a" < "z" < "ä"). Pinned in absent-collection-proof
  too, whose header claimed "every place in the repo that grades a collection" and had never named radar.
DISCOVERY: dedupe keyed on the RAW category while the classifier trimmed it — " x", "x", "x " were three detections
  and three "recognized"; planOnboarding auto-onboarded on any truthy value ("false" onboarded a no-API signal);
  four configured sources with zero detections read "sources: 4". Fixed: trimmed key, `=== true`, sourcesObserved.
PERSISTENCE: refresh() returned the EXPIRED/ENDED session object, so POST /v1/sessions/:id/refresh answered 200 and
  wrote a session.refresh audit row for a refresh that never happened (the api test accepted "not a 200-with-active");
  now null → 404, test asserts 404. listDecisions' 100-row page length was reported as `total` (in-memory branch
  reports the whole set) — countDecisions added, `id DESC` tiebreak; role-split COALESCE(pg_has_role(...), TRUE)
  proved schema ownership from a MISSING pg_namespace row — now FALSE. The unparseable-expiry guard was correct and
  unheld (every fixture used iso()): an assertion now fails if it goes.
CLIENT: custom-fetch.ts, the generated client's one hand-written file, had ZERO proofs. responseType "JSON"/"xml"
  fell out of the switch and resolved undefined AS SUCCESS; a 200 with no content-type came back as a string typed as
  the result (health.status → undefined; a captive-portal page typed itself as HealthStatus). Fixed: default arm
  throws by name; no content-type → JSON-shaped parsed, else ResponseParseError. proof:api-client-react (13) NEW,
  registered in preflight + CI (parity gate: 304 gates, 0 unwired). Dashboard "Stale / non-compliant" card excluded
  `unknown` from both the list and the emptiness test — now everything not `nominal`.
PROOFS: signal-radar 22/22 (+4) · signal-discovery 21/21 (+5) · absent-collection 32/32 (+2) · session-store 13/13
  (+4) · api-client-react 13/13 (new) · mcp-server 11/11 · test:api 373/373 (+3) · typecheck 0 · PG proofs extended
  (refresh-after-expiry null; two-row newest-first + count) — NOT runnable here (no Postgres), CI runs them.
MUTATION (each fix reverted alone on a .mutbak copy; its proof must fail): radar empty arm 20/22 + absent 31/32 ·
  radar localeCompare 21/22 · discovery raw key 20/21 · truthy autoOnboardable 20/21 · discovery localeCompare 20/21 ·
  refresh returns dead session 10/13 · NaN expiry guard 11/13 · client default arm 10/13 · client no-content-type 9/13.
  Ten reversions, ten kills; zero .mutbak left. NOT mutated: the radar route's 400 and the countDecisions wiring
  (test:api and the PG proof assert them directly; a reversion run of the full api suite was not repeated).
DOCS: REPO_LAYOUT.md called api-client-react "bindings for the /v1 API" — it is generated from openapi.yaml for /api
  (PURPOSE.md and CI_AND_VALIDATION.md already said so); build-plan line counts 174/228/136 → 245/305/175 (measured).
GATES TO SPECIFY, not built here: check-nan-fail-open following ONE level of same-file helper indirection (a
  `toMs()` wrapper hides the parse from rule 3 today — planted and confirmed by the auditor); review-invariants
  flagging localeCompare in lib/*/src with dispositions for the 5 existing sites (self-audit ×4, control-plane ×1);
  a docs↔filesystem re-measure of `path (N)` line-count figures.
coverage gate: 34 read, 10 partial, 56 not read, of 100 surfaces (+4 full reads).
```
Verdict:  **fixed and gated — four shipping libraries whose green proofs had never fed the unknown, and a web client that had never been asked anything; every fix now has an assertion that fails when it is reverted.**

## 2026-09-05 — "The three gates the fourth round specified, built: a parse hidden behind a helper, a sort that follows the machine, a line count quoted forever"
Command:
```
scripts/check-nan-fail-open.mjs (same-file helper hop)   scripts/review-invariants.mjs (check 2b: localeCompare)
scripts/check-doc-line-counts.mjs (NEW, --self-test)      11 localeCompare sites → cmpCodepoint (control-plane ×3, self-audit ×4, core store.ts ×4)
```
Output:
```
NaN GATE: `const exp = toMs(x)` where toMs is a same-file `return Date.parse(x)` (function, arrow, or typed) now
  taints the call site like a literal parse; a helper that guards inside, and a call into another file, are not
  followed (documented ceiling). Self-test +6 cases; 974 files scanned, 0 violations. MUTATION: hop removed → the
  three helper cases fail the self-test.
COLLATION: review:invariants check 2b — `.localeCompare(` in lib/*/src is a failure (comment-stripped, literal-masked,
  so a comment NAMING it is not a hit; self-test +3). Sites fixed: control-plane nodeId tiebreaks ×3, self-audit
  proposalId/id/area ×4, signalgrid-core store.ts ISO-timestamp sorts ×4 (codepoint order on an ISO string IS
  chronological; localeCompare's was locale-dependent). 475 planner files, 0 sites. Proofs: control-plane 42/42,
  self-audit 61/61, signalgrid-core exit 0; typecheck 0. MUTATION: one site restored → "localeCompare in 1 site(s)".
LINE COUNTS: 29 `path (N)` figures in the tree, 20 wrong (evidence.ts 340 → 750, v1.ts 923 → 1023, preflight.mjs 377
  → 577, audit backend 185 → 318 …). New gate re-measures every figure against wc -l on every push; EVIDENCE.md is the
  one exemption (a dated ledger records the count AT THAT READ), with its reason, and a stale exemption is a failure;
  .json fixtures excluded (their (N) is a record count — CLAIM_INVENTORY.md:1597 proved it). Self-test 10/10 incl. a
  hit-count floor of 20 and the real-tree positive control. MUTATION: engine.ts (572) → (560) in the real tree → FAIL
  naming the real count. Registered in preflight + CI; parity gate 0 unwired.
```
Verdict:  **built and gated — each of the three was specified by an audit that had proven the gap with a planted defect, and each gate now fails on that exact plant.**

## 2026-09-05 — "Fifth audit round, the edges: an emulator that allow-candidates on unknown zones, a deck rendering a digest that matches nothing, a spec no gate read, a fleet that 'matches' when nothing is declared"
Command (two independent read-only audits + firsthand reads of every edit site + fix + proof + mutation):
```
artifacts/connector-emulator/** + scripts/src/connector-emulator-{harness,proof,scenarios}.ts   artifacts/signalgrid-review/src/**
lib/api-spec/** (+ orval)   lib/iac/src/**   config/**   docker/** + docker-compose*.yml
```
Output:
```
EMULATOR: decide() tested only the BAD member of custodyZone/networkZone ("wrong"/"mismatch"), so "unknown" slipped past
  both allow arms — a reader offline or a segmentation lookup that timed out emulated as an allow candidate; the fixture
  type declared credentialConfidence and badgeEventObservedAt, every row populated them, and nothing read them. Fixed:
  positive members on both arms; degraded/unknown/ABSENT confidence and an unreadable badge instant step up by name.
  12 synthetic guardrails (7 reader, 4 posture incl. both-zones-unknown, 1 identity control); fixtures unchanged, hash
  unchanged (026712a3…), cases 15.
DECK: connectorEmulatorData.ts carried a hand-typed digest (893c8bb5…), scenarioCount 8 and four packs under "Evidence
  panel" — the artifact said 15, five packs, a different hash; the credentialReader group (the only one with an
  approval gate) was absent; guardrail ✓ pills were a string array; the pill labelled decision was the fixture's INTENT.
  CLAIM_INVENTORY.md:486 had said "unsubstantiated / remove" for weeks and it shipped anyway. Now: scenarios from the
  five fixture packs, hash/count from results.json, guardrails COMPUTED (a broken property renders ✗), the engine's
  actual decision rendered with a red mismatch marker. robots.txt now disallows (index.html was noindex since 08-25).
  Smoke-workflow dispatch list gains credentialReader. Review app builds (vite, 718ms).
SPEC: openapi.yaml — orval's input for @workspace/api-zod (ships via api-server) and @workspace/api-client-react (ships
  via signalgrid-app) — documented six write operations the server never served (POST /decisions, /signals/ingest,
  policy create/get/update/delete) and was read by NO gate; api-contract-proof's scope was ["/v1/","/cp/v1/"] while
  its header warned against exactly that. Pruned; /readyz, /signals/catalog, /signals/radar and five /simulator/*
  routes documented; the proof now holds BOTH documents (59 + 17 routes) each against its own router set, with a
  route-file registry (9 on disk, 7 in a document, sim.ts undocumented by design WITH the reason) and a zero-endpoint
  floor per document; self-test 10/10; a planted POST /policies fails by name. api-client-react regenerated (orval
  8.24 vs the committed 8.9.1 output; typecheck 0; no app used the removed hooks). NOT DONE: api-zod — orval 8.24
  emits z.int() (zod 4) against zod 3.25, so its output fails typecheck; reverted, recorded in BUILD_BACKLOG.
IAC: detectDrift({resources:[]},{resources:[]}) → in_sync, zero findings, empty probe set: a desired state that failed
  to load read as a healthy fleet, and the `unknown` rung was producible by nothing. Now one unknown finding named for
  its cause, overall unknown (outranks unmanaged), summary "cannot be compared", one unknown probe. proof:iac 67 → 72;
  MUTATION: the synthetic finding disabled → 67/72.
COMPOSE: docker-compose.yml (the topology a reviewer runs) had NO healthcheck on api/web/nginx while .prod.yml carried
  22 lines on why one is needed; all three plus the sim service now have one, with service_healthy conditions. New
  gate check-compose-healthchecks.mjs (line-based, unparseable ≠ passed; migrate.yml's db exempt as an overlay, with the
  reason; self-test 7/7; a real-tree mutation fails by service name). Registered in preflight + CI.
DRIFT: 13 stale v1-openapi.yaml line citations in CLAIM_INVENTORY.md re-anchored (393→426 /v1/audit, 180→213 evidence,
  568→614 challenge …), every anchor verified against the file; row 466's "index.html:8 sets index, follow" re-measured.
CLEAN: config/ (no secret defaults, live integrations off in all four tiers, the prod "everything is 401" claim
  verified in context.ts), Dockerfiles pinned, lib/iac lifecycle/plan/validation, emulator route-field checks, the
  review console e2e spec (the strongest artifact read).
typecheck 0 · contract holds across 2 documents · emulator pass · iac 72/72 · compose 6 published / 5 checked + 1
  exempt · coverage ledger 40 read / 10 partial / 50 not read of 100 (+6 full reads).
```
Verdict:  **fixed and gated at the edges — the surfaces a reviewer actually runs (the emulator, the deck, the compose file) and the document two shipping clients are generated from had each been telling a smaller truth than the core, and each now has a gate that fails when it does.**

## 2026-09-05 — "Sixth audit round, the operating floor: a Stop hook whose gate could never fire, a deny-list any wrapper walked past, a desktop that said all-clear to a dead feed, an MDM proof holding its rule on the wrong profile"
Command (four independent read-only audits + firsthand reads of every edit site + fix + proof + mutation):
```
.claude/hooks/** .githooks/** .github/**   artifacts/signalgrid-desktop/** artifacts/signalgrid-mobile-pwa/**
artifacts/signalgrid-web/** site/**   fleet/** firmware/** native/ios/mdm/** native/ios/scripts/**
tests/** fixtures/** .agents/** .claude/commands/**
```
Output:
```
HOOKS: verify-done.sh ran `pnpm run loop:state` as its gate; loop-state.mjs had no exit code at all — it printed
  "3 thing(s) need you." and returned 0 — so the arm CLAUDE.md calls "enforced by hooks" could never fire (reproduced:
  three failing rows, empty hook output, session allowed to end). It also never looked at the working tree, so an
  uncommitted edit satisfied "done", and `cd ""` on an unset CLAUDE_PROJECT_DIR succeeded into whatever directory the
  hook started in. loop-state now sets exit 1 on a failing SEAM (unpushed work, origin, framing, PURPOSE.md, an
  unreachable Hub — which was a `warn` that SKIPPED the unpushed-work check); the discovery rows are reported and do
  not move it. The hook consults `git status --porcelain` first and quotes the failing rows.
  block-dangerous.sh stripped quoted spans before matching, and a wrapped command lives in a quoted span:
  `bash -c 'rm -rf /tmp/x'` was ALLOWED, as was every pattern behind `sh -c`, the force-push pattern with two spaces
  in it, and any non-JSON stdin (jq failed, cmd empty, nothing matched — unreadable meant allowed). Now: whitespace
  collapsed, `-c`/`-lc` payloads unwrapped to a fixpoint before quotes are stripped, whole-token patterns
  (`git stash-list-helper` is not `git stash`), unreadable input DENIES. `--self-test` 16/16, in preflight + CI.
  The new hook blocked THIS entry's first append — the heredoc body named the force-push pattern in an unquoted
  position — which is the hook working, not a defect; heredoc bodies stay in scope because `bash <<EOF` executes them.
  session-start.sh grepped a hardcoded "→ cloud (from mac)": on the Mac lane it was structurally incapable of
  reporting mail, and a node failure printed the same "none". Lane derived (scripts/lib/lane-identity.mjs), an
  unreadable mailbox reads UNKNOWN; pending sim requests counted in full (the old `-A 2 | head -3` showed two of five).
WORKFLOWS: ios-ci.yml's two GATED scans passed green on a scan root that did not exist (inside `if`, errexit never
  trips and pipefail hides grep's exit 2) — reproduced with a renamed directory; roots asserted, 20-file floor, and
  SignalGridMobile (never scanned) added. supply-chain.yml's two `git diff --quiet` SBOM checks were blind to an
  untracked file; `ls-files --error-unmatch` first, as the three review-hub-ci regenerate steps already do.
  mac-lane.yml's summary never mentioned the seven env-guarded proofs the harness skips; it now quotes the harness's
  SUMMARY and skipped lines and fails if there is no SUMMARY line; "6 non-proof gates" → 7 (the harness runs 7).
DESKTOP/PWA: DesktopLayout rendered a GREEN check and "No active alerts" when the signal feed had FAILED (react-query
  `data` is undefined for a 404 and for loading alike; `?? []` made both "no anomalies") — zero uses of isError in
  either tree. Three states now: unreachable (amber, "alert state UNKNOWN — not an all-clear"), loading, known.
  Desktop Decisions.tsx carried a local verdict map with `?? "text-muted-foreground"` and PWA OutcomeBadge seeded
  `text-zinc-500` — the desktop's own outcome-tone.ts had written "an unrecognised verdict resolves to the
  RESTRICTIVE tone" and reached three of five sites. Both route through a tone module now (PWA gained one); the
  review deck's FOUR local maps (one a Partial with a neutral fallback) route through a third. PWA formatNumber
  rendered an absent count as "0" and Overview `|| 0` rendered "0.0%" for a feed that never answered — dashes now,
  as the desktop already did. Handoff mock minted Date.now() and threw on an unknown status; desktop Integrations
  emitted the class `undefined` for an unknown status (renders as healthy) — restrictive arms. PWA manifest named
  two icon files that do not exist — dropped. List pages render an explicit unreachable row instead of a blank list.
  check-verdict-tone-source.mjs widened: PWA tree scanned; a verdict→class MAP outside a tone module is a finding
  (comparison rule alone missed both shapes); inside a tone module every `??` fallback must be status-restrict or
  status-deny. Self-test 27/27; neutral-fallback mutation and local-map mutation both fail by file:line.
FLEET/MDM: proof:mdm-profile asserted no-app_lock / System scope / removal-disallowed on the KIOSK profile only and
  read the Fleet profile's PayloadContent[0] only — a planted `com.apple.app_lock` SECOND payload in the profile
  Fleet actually ships passed 18/18. The profile set is now derived from `git ls-files '*.mobileconfig'`; every
  payload of every profile: admitted type, no app_lock anywhere in the file, System scope, removal disallowed,
  PayloadUUID/Identifier unique across all profiles. The Fleet profile carried neither scope nor removal key
  (added: the next holder could have deleted it). 40/40; app_lock plant → 41/43 FAIL; removal key removed → 39/40.
  check-demo-flags-documented.mjs gated one of three copies of the managed-key table; all three now, a dropped row in
  mdm/README fails by key. FLEET_MDM.md showed a three-file GitOps sketch under the real team file's name — none of
  the files existed and the schema was not Fleet's — rewritten to point at the tracked files. The team yml's comment
  named 3 of 8 keys and omitted BackendBaseURL (required, or no session ever starts) and applied an iOS-only profile
  to macOS as if it restricted Macs — said plainly now; `../profiles/` path resolution is UNVERIFIED (no fleetctl
  here) and marked for the Mac lane. mdm/README's MDM list gains Fleet, the chosen MDM.
  proof comment corrected: it binds ASAM to Signing.xcconfig, the SIMULATOR id; Signing.local.xcconfig (gitignored,
  wins on device builds) is invisible to it. firmware/dock/core, pick-simulator.py, both profiles' supervision
  caveats, the 8-key parity: CLEAN (28 tests claimed = 28 counted).
TESTS/FIXTURES/AGENTS/COMMANDS: tests/load k6 drivers could not fail (see COMPANY_BUILD_PLAN row 43) — fixed 4b50c4d;
  retirement is the owner's. .agents/agent_assets_metadata.toml: both entries point at images that never existed,
  nothing reads it (row 73, re-verified) — deletion is the owner's. fixtures/: microsoft-graph packs read in full,
  every expectedDecision asserted by proof:microsoft-graph-sandbox; emulator packs read in the fifth round. CLEAN.
  .claude/commands/: nine prompts, no claims, CLEAN.
FOUND, NOT FIXED (next PR, batch I — the shipping site): 13 evidence links on signalgrid.app point at
  `blob|tree/main/…` and there is no `main` branch — every one 404s live (the hero CTAs, API reference, Security,
  launch plan, validation, both Federal CTAs, both SmartDock links); `site/index.html` is not deployed by pages.yml
  AND is outside check-launch-claims' derived scope while asserting three deferred signals under "the core reasons
  over today"; About.tsx claims location/identity as current with no hedge and the noun list cannot see "location";
  "SIGNALS FUSED 7" beside a 4-row array, "16 candidate source categories" beside 5 groups, CLAIM_INVENTORY:1194
  says the 17 is guarded by guard:figures (it reads docs/*.md only); LIVE_VERIFIED matches "Fleet" against the label
  "Fleet (live-proven)"; Federal.tsx STATUS_META unguarded with an unused green arm.
mutations: hook self-test 16/16 · verdict gate 27/27 + 2 mutations · mdm 40/40 + 2 mutations · demo-flags 3 docs + 1
  mutation · loop:state exit 1 on a failing seam, 0 otherwise (verified both) · typecheck 0.
coverage ledger: 58 read / 9 partial / 33 not read of 100 (+18 reads, 17 surfaces newly read in full).
```
Verdict:  **fixed and gated on the floor the lanes stand on** — the hook that was supposed to hold "done" could not
  hold anything, and the deny-list held nothing a wrapper could carry; both now fail their own self-tests when
  loosened. The desktop's all-clear for a dead feed is the room-console defect from the third round in a second
  tree, and the verdict fallback is the same defect in a third; the widened gate holds all four trees. Two surfaces
  are owner decisions (delete), one is the next PR (the site), and every remaining not-read surface is a docs family
  or a data directory.

## 2026-09-05 — "Seventh round, the shipping site: thirteen evidence links to a branch that does not exist, a landing page outside the scan, a figure with a false provenance badge"
Command (the sixth round's web+site audit, then firsthand reads of every edit site + fix + gate + mutation):
```
artifacts/signalgrid-web/src/**   site/**   docs/{pitch-deck,fabric-console,evidence-coverage}.html   docs/inspiration/*_CATALOG.md (links only)
```
Output:
```
LINKS: the SPA linked thirteen evidence URLs — both hero CTAs, API reference, Security, launch plan, "what ships today",
  both Federal CTAs, both SmartDock links, CI_AND_VALIDATION — to blob|tree/main/…; there is no main branch (the default
  is SignalGrid_Alpha) and every one 404'd live on the page whose whole argument is "every claim traces to a proof you
  can open". The pitch deck, the fabric console and the GENERATED evidence-coverage page (its builder) carried the same
  ref; four inspiration catalogues linked tree/…/signalgrid-app etc. without the artifacts/ prefix, and two named docs
  that do not exist (IGA_ADJACENCY.md, SIGNALGRID_V0_2_READINESS_PLAN.md). check-cited-paths resolves repo-relative
  backtick paths and has no concept of a ref segment, so none of this sat inside any gate. All repointed. NEW GATE
  scripts/check-repo-links.mjs: every blob/tree/raw/commits link into this repo (literal URL or the SPA's `${REPO}/…`
  template form) must name the default branch — pinned, and checked against origin/HEAD when the clone carries it —
  and a path tracked at HEAD (tree: a file or a directory holding tracked files). Offline. Self-test 16/16; its own
  first version scanned zero SPA files (git's :(glob) has no brace expansion) and reported a pass over four links —
  caught by the "template form is caught" control before it shipped. Mutation: blob/main planted in Footer.tsx →
  fails by file:line.
LANDING PAGE: site/index.html is not served (pages.yml deploys the SPA and takes only site/CNAME) and was outside
  check-launch-claims' derived scope. Put in scope (every tracked site/*.html, derived) it produced two violations on
  first contact — "badge tap" and "custody lost" as current in the outcome cards — beside the "reasons over today"
  chips the audit named. Hedged where the claims are; a banner marks the page superseded and not served (worded so
  the page-scope exemption does NOT fire — a banner must not be the way a page passes); "Twelve signal categories" and
  "Eight scenarios" (17 and 19 in the tree) replaced with numberless copy; "independent project" → "founder-built".
  Deletion of the page is the honest end state and is the owner's (tracked-file deletion refused to this lane).
FIGURES: HeroSection "SIGNALS FUSED 7" sat over a four-row panel (three signals + verdict) — now COMPUTED from the
  panel (3). "16 candidate source categories" (heading, stat tile, Pricing) matched no artifact the inventory could
  name — it IS one: the api-server integrations catalog carries exactly 16 distinct categories. CLAIM_INVENTORY said
  the "17 core signal categories" tile was "guarded by guard:figures" — that gate reads docs/**/*.md only and never
  held a .tsx. NEW GATE scripts/check-site-figures.mjs binds 17 to EVALUATED_CATEGORIES.length and 16 to the catalog's
  distinct-category count, every site named; self-test 9/9; a stale 12 on the hero fails by file. Four inventory rows
  re-anchored (16 substantiated; 7 rewritten as computed; two "guard:figures" provenance claims corrected).
ABOUT/INTEGRATIONS/FEDERAL: About.tsx claimed location as a current input with no hedge anywhere in the file (the
  noun list cannot see "location", and widening it would raise the docs ceiling by hundreds of legitimate engineering
  mentions — recorded as the gate's limit, not changed); hedged where the claims are. LIVE_VERIFIED matched the label
  "Fleet (live-proven)" against "Fleet" so the Fleet chip never earned its badge — matched on the product name now.
  Federal STATUS_META threw on an unknown status and carried an unused green `available` arm — restrictive fallback,
  arm removed.
launch-claims 100 files / 0 violations (was 99) · repo-links 16/16 self-test, 0 dead across the scan set · site figures
  17 and 16 bound · typecheck 0 · claim-inventory drift 0 · line counts (586) · parity, census, cited paths green.
```
Verdict:  **the evidentiary spine of the public site is reattached and gated** — a buyer who clicks "Read Architecture
  Docs" now reaches the docs, and the next branch rename or moved file fails a gate instead of a visitor. The landing
  page can no longer assert a deferred family as current without failing the same gate the SPA answers to. Left open,
  named: site/index.html should be deleted (owner); the noun list does not see "location" (gate limit, recorded).
