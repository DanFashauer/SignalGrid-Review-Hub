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

## 2026-09-05 — "Eighth round, the partial and unread code: an engine that allows on an unknown posture, a WebAuthn proof that could not tell four checks from their absence, a phone rendering a green seal over a failed digest, a deny-list that allowed what it could not read"
Command:  five independent audit agents over the partial/unread surfaces, then firsthand reads of every edit site + fix + proof + mutation (every figure below from a run in this session):
```
lib/signalgrid-core/src/{evidence,engine,auth,continuity,connector,dock,shift,webhooks,remediation,audit}.ts
lib/signalgrid-simulator/src/{decisionEngine,remediation-allow,scenarios,types}.ts   lib/webauthn/src/** (full ceremony)
artifacts/api-server/src/{middlewares,routes/health,routes/simulator,routes/control-plane}  lib/persistence/src/*  artifacts/mcp-server/src
native/ios/SignalGridMobile/** (46 files)  native/ios/EnterpriseShellTests/*  native/ios/* (12 loose)
CLAUDE.md AGENTS.md README.md SECURITY.md .claude/agents/*.md .claude/settings.json .claude/hooks/*.sh + every tracked root file
```
Output:
```
CORE (lib/signalgrid-core): groupLatest kept the FIRST-inserted reading on an exact observedAt tie — the core proof
  asserted it as a feature ("first-inserted wins") — so `compliant` then `non_compliant` derived compliant and the
  reverse derived non_compliant: array order deciding the answer, in the permissive direction. Ties are now kept in
  `tied` and every reader folds them worst-wins (no "unknown" floor — a twin is legible); a strictly newer reading
  still clears the tie. engine.getResolution's fallback for a tenant with NO resolution config was
  `autoProposeEnabled: true` (absence switched the most permissive class on) → false. roleHasPermission and the
  continuity standing bound indexed raw (a "constructor" role/id resolved through the prototype) → own-property.
  Fixture/dock/shift syncs that SKIPPED every record reported status success + connector healthy → partial +
  degraded, recordsProcessed excludes skips, the note names the count. shift.ts exported. Webhook dead_letter arm
  and the exhausted-retry schedule were unproven → 5 assertions. Simulator proof: `auditEvidence.length > 0` ×4
  were constants (an unconditional two-element literal) → decision trace must name the decision AND every starting
  signal, routing trace exactly the routed ids, ids distinct. WHAT_SIGNALGRID_DOES_TODAY listed 15 evidence
  dimensions while EVIDENCE_FIELDS holds 20 → five rows added, count bound to the array.
  proof:signalgrid-core 489 (was 481) · mutations: tie→first-wins, autoPropose→true, sync→always success,
  raw role index: each caught BY NAME (4/4) · decision-continuity 76/76 · webhooks 206/206 · simulator 73/73.
SIMULATOR (lib/signalgrid-simulator): the engine's base-trust allow fires on the PRESENCE of a posture signal and
  reads its attributes only for bad literals, so compliance "unknown"/"expired"/absent/non-string ALLOWS —
  measured live: the clinical medication-round scenario with compliance:"unknown" allows exactly as "compliant".
  Engine frozen (golden rule 1) → NEW WRAPPER lib/signalgrid-simulator/src/posture-allow.ts (states affirmed /
  unaffirmed / illegible / absent; six declared reason codes; allow withheld one step, never permissive movement),
  NEW proof:posture-allow 189/189 driving the LIVE engine (the twin still allows BY THE ENGINE — reported; withheld
  BY THE WRAPPER — gated), NEW native/shared/posture-allow-vectors.json (52 cases, floor = its own count), NEW
  scripts/check-posture-allow-conformance.mjs (self-test 11/11; Swift twin REPORTED pending, flip
  SWIFT_TWIN_REQUIRED when the Mac lane lands it). Reason-code catalogue folds every wrapper's declared array
  (SIMULATOR_WRAPPERS), floor 25 → 31. Mutation: unaffirmed arm disabled → 189 drops with the live-engine
  withhold assertion named.
WEBAUTHN (lib/webauthn): six conditions replaced with `if (false)` — registration ceremony type, registration
  rpId, registration UV, user presence on BOTH paths, assertion ceremony type — and the proof still passed 56/56.
  Now pinned BY REASON STRING (72/72). Challenge user binding was `userId !== undefined && userId !== caller`: a
  challenge saved with NO binding was checked against nobody and a genuinely signed assertion under an unrelated
  user was ACCEPTED (reproduced through the public saveChallenge) → userId required in the type, guard inverted,
  both paths proven. Registration accepted a response with no id/rawId and stored a credential whose id was
  undefined → shape guard, and the stored id must EQUAL the attested credential id (a client-chosen name is
  refused). 32-byte authenticatorData threw a RangeError (a 500) → AUTH_DATA_MIN_BYTES refusal with a reason.
  Re-enrolling an existing id reported success while storing nothing → alreadyEnrolled reported, /v1 route answers
  enrolled:false + alreadyEnrolled:true (api test). Dead step-up-session surface (stepUpStore.ts + verifyStepUp,
  zero callers, Redis error falls through to a per-process map) recorded OPEN — deletion is the owner's.
API-SERVER + PERSISTENCE: /api/readyz unauthenticated, exempt from BOTH limiters, seven DB round-trips per call
  (measured by the audit: 40 calls, 0 × 429, 280 probe units against pools of ten) → one coalesced composite probe,
  shared in-flight, reused 1s, `probedAt` in both bodies; api test: 8 concurrent calls share ONE probedAt, a call
  after the TTL probes again. x-request-id accepted unbounded and hashed into the audit chain (a 429-char forged id
  landed in the ledger) → honoured only in the bounded id shape REQUEST_ID_SHAPE exports (letters, digits, dot, underscore, dash; at most 128 chars), else minted; three assertions BY VALUE (the
  old one was "is a string"). Readiness verified the ledger's schema and never the other three tables' →
  assertSchema on decisions/evidence_snapshots/sessions, on init and every ping (unproven here: no Postgres;
  needs the durable CI job — OPEN). POST /simulator/run's catch answered "scenario not found" to every failure →
  existence by lookup (404), run failure 500 simulator_error. /cp/v1/telemetry folded "many"/null/absent counts to
  measured zeros → 400 naming the unreadable field. MCP DEFAULT_TENANT comment states the tenancy limit.
  test:api 384/384 (was 373).
NATIVE (SignalGridMobile, uncompiled here — no Swift toolchain; Mac build requested): the evidence "Verified"
  seal was a HARDCODED green Label while the server's `verified` flag was decoded and dropped in fetchEvidence —
  a failed tamper check rendered identically to a pass → EvidenceFetch carries the flag, the seal branches on it
  (red "Digest check FAILED"). StepUpGate — the tested fail-closed gate — had ZERO production callers while
  WardlinkModel hand-rolled LAContext inverted: cannot-ask raised an alert whose button GRANTED the gated action →
  routed through StepUpGate, .unavailable withholds, the demo-verification alert removed. connectLive accepted any
  scheme (ATS allows cleartext to .local names; the Keychain token would travel in the clear) → https, or http to
  loopback only, on connect AND reconnect. lastRefresh computed and read by nothing → rendered in the header, and a
  failed refresh now says the figures below are from the last successful one. verify.sh exited 0 with both app
  targets unbuilt → --require-xcode (ios-ci passes it). Tests: testStepUpHoldsGatedActions allSatisfy over a
  possibly-empty list → non-empty guard; testUnobservedPostureFailsClosed pins the absent base-trust reasons.
  README "six deterministic tests" (14) and 15 endpoints (20, one outside /v1) corrected; CONVERGENCE.md claimed
  EnterpriseShell "currently talks to an older /api/sessions/* endpoint" — the tree refutes it (FALSE_CLAIMS).
INSTRUCTION LAYER + ROOT: block-dangerous.sh allowed valid JSON whose command field was absent or renamed, and
  with jq off PATH could not emit its deny (exit 0 = allow) → both deny (self-test 23/23); settings.json denied
  `sudo` and `git branch -D` and the hook did not → added, and check-hook-denylist now feeds every settings.json
  Bash deny pattern to the hook behaviourally (9/9 held; match made case-sensitive so `git branch -d` stays
  allowed). session-start.sh's loop:state fallback bound `||` to the pipeline (head's status) → never fired →
  captures the real exit. CLAUDE.md said "roughly thirty-five" non-proof preflight gates while the parity
  extractor counts 182 of 257, "47 + 8" breadth while STEPS holds 56, and quoted a SUMMARY literal without the
  skipped field → reworded to derived. verdict-core-reader's reason-to-exist ("no named reader") was discharged
  2026-08-23 and still dispatched a finished first read → premise dated, role re-scoped to changed/unread files
  (FALSE_CLAIMS). gate-and-proof-engineer "317 files" (386) → derived wording in the .md, the charter and the
  roster gate's comment. tdd-guide bounded to tests/ (three k6 scripts) with npm test that does not exist → LOCAL
  CORRECTION in its charter; build-error-resolver / refactor-cleaner / security-reviewer charters corrected for
  tooling this repo does not have (vendored bodies untouched — byte-identity gate). .gitignore ignored the
  directory holding the TRACKED build-loop history → negation added.
  typecheck 0 · review:invariants green · reason-codes 31 (floor 31) · port parity green · cited paths 1747 ·
  launch-claims 0 violations · repo-links 0 dead · figures guard green · proof counts synced (the proof:* key count moved by one; the derived gate holds it).
```
Verdict:  **the unknown loosened the answer in the engine itself, and in the phone, and in the hook that guards the
  session** — each closed around the frozen engine, at the store, or in the view, and each proven by a mutation
  that fails by name. Left open, named: the Swift twin of posture-allow (Mac lane, vectors pinned); the four
  SignalGridMobile edits are source-level and unbuilt here (Mac build requested); assertSchema on the two
  persistence stores is unproven without Postgres; the dead step-up-session surface and the 18 lib packages without
  a tsconfig (typecheck coverage unverified) are recorded, not resolved; validate-sim-macos.sh --sim-only prints an
  unqualified GREEN and hand-pins "11 scenarios" (Mac-owned file, mailed).

## 2026-09-05 — "The Mac lane, second revision: everything CI's macOS runners can verify moves to the cloud lane; what needs the physical Mac runs from a launchd tick, unattended"
Command:  measured the loop the first revision left behind (owner, same day: "this isn't working and causing delay"), then built and gated the replacement:
```
node scripts/check-lane-messages.mjs                 # six cloud→mac messages unread, oldest 1.8h+; no Mac commit since 09-03
git log origin/mac/* -1 --format=%cI                 # six mac/* branches unmoved since 09-02/03
gh: ios-ci.yml on PR #456 head 0660892               # SignalGridMobile + EnterpriseShell (iPhone, iPad) + macOS SwiftPM: ALL GREEN on the cloud's seven Swift edits
node scripts/check-posture-allow-conformance.mjs     # after the twin: "Swift twin present; 1 native test(s) bound: …/PostureAllowTests.swift"
bash -n scripts/mac/lane-tick.sh scripts/mac/install-launchd.sh validate-sim-macos.sh   # syntax under bash
node scripts/check-scheduled-routines.mjs            # mac-lane-tick declared; "no heartbeat written yet" REPORTED, as designed
```
Output:
```
WHAT WAS WAITING ON A HUMAN-STARTED MAC SESSION, and should not have been: (1) a Swift twin the cloud had pinned with 52
  vectors and then mailed away — remediation-allow's twin took three days the same way; (2) "please build the seven Swift
  files" — ios-ci.yml had ALREADY built and tested them on macos-latest on the PR, green, while the mail sat unread; (3) a
  two-line banner fix in validate-sim-macos.sh, deferred because "Mac owns the file". None of the three needs a physical Mac.
DONE IN THE CLOUD, PROVEN BY CI: native/ios/EnterpriseShell/Services/PostureAllow.swift (twin of posture-allow.ts; reuses
  RemediationAllow's outcome ladder so there is one projection, not two) + PostureAllowTests.swift (loads the vectors BY PATH,
  asserts every case's five pinned fields, holds the Swift postureBearing table equal to the file's, and three Swift-only
  edges: non-object attributes, a boolean attribute, deficiency order); registered in Package.swift and project.yml;
  SWIFT_TWIN_REQUIRED flipped — the conformance gate now FAILS if the twin or its test vanishes. validate-sim-macos.sh:
  --sim-only now prints "MODE: --sim-only — ONLY the four simulator gates above ran", names what did not run, and its
  SUMMARY line says partial; "11 scenarios" derived from scenarios.ts. Both verified by mac-lane.yml / check-shell on CI.
THE PHYSICAL MAC, UNATTENDED: scripts/mac/lane-tick.sh (bash 3.2) — every 30 min from launchd: fetch --prune; refuse a dirty
  or non-Alpha checkout (a person's work is never pulled over) and SAY so; fast-forward Alpha; install only when the lockfile
  moved; run every pending sim request; push results on mac/tick-<stamp> (gh opens the PR when present, else the steward
  does within the hour); print unread cloud→mac mail WITHOUT acking it (a machine is not the addressee); heartbeat on EVERY
  path through lane:deliver so "ran, nothing to do" ≠ "never ran". scripts/mac/install-launchd.sh — one command, once
  (--status, --uninstall). Declared in scheduled-routines.json (mac-lane-tick, tolerance 3h). The steward routine now reads
  that heartbeat and escalates to the owner once per day, with the one command, when the Mac has gone silent.
PROTOCOL (docs/LANE_COORDINATION.md, second revision; CLAUDE.md row): Rule 1 the cloud does what CI can verify; Rule 2 the
  physical-Mac work runs from the tick; Rule 3 mail asks a person only for judgment or a physical action — never a build.
  The steward trigger prompt carries the same three rules and the tick-staleness escalation.
NOT VERIFIED HERE, said plainly: the tick and the installer have not been executed on a Mac (no macOS in this container);
  bash -n and the shell gate hold their syntax, and the first heartbeat is the proof of the rest — its absence is what the
  steward now escalates. The Swift twin is compiled and tested by ios-ci.yml on the PR, not on this lane.
```
Verdict:  **the Mac is no longer on the critical path for anything a runner can do, and its silence is now a measured
  signal rather than a wait.** What the owner does once: on the Mac, `bash scripts/mac/install-launchd.sh`.

## 2026-09-06 — "Fleet Premium, verified in the cloud lab the day the owner handed over the key: the unlocked transfer endpoint, the team branch nobody could run, and the inherited policies it was dropping"
Command:  the owner shared the Premium trial JWT (sub signalgrid.app, 10 devices, exp 2026-09-16) and a Fleet server-configuration reference; the key went into a session scratch file (mode 600, outside the tree), the container's Docker daemon was started, and the pinned lab came up with `FLEET_LICENSE_KEY` on the server only:
```
docker … fleetdm/fleet:v4.89.2 … -e FLEET_LICENSE_KEY=<from scratch file>     # + mysql:8, redis:7, osqueryd 5.17.0, per-run TLS
iptables -I DOCKER-USER -s <fleet ip> ! -d 172.16.0.0/12 -j DROP                # Premium cannot disable usage statistics; the firewall can
curl …/api/v1/fleet/config                                                       # license tier
pnpm run proof:live-fleet ; pnpm run proof:live-fleet-workflow                   # against the Premium lab, host inside a team
raw probes: POST /teams, POST /teams/1/policies, GET /teams/1/policies, POST /hosts/transfer, GET /hosts/2
tsx probe through the real adapter with teamId: 1                               # the branch marked UNVERIFIED since 2026-08-12
```
Output:
```
"license":{"tier":"premium","organization":"signalgrid.app","device_count":10,"expiration":"2026-09-16T18:57:56Z"}
PATCH server_settings.enable_analytics=false → still true (Premium keeps statistics on; egress blocked instead)
POST /api/v1/fleet/teams                       → 200  {"team":{"id":1,"name":"SG Clinical"…}}        (Free: refused)
GET  /api/v1/fleet/teams/1/policies            → 200  keys: ['policies', 'inherited_policies']        own 1, inherited 1
adapter getPolicies() with teamId:1            → [ { id: 2, name: 'Team: screen lock', team_id: 1 } ]  ← inherited global policy DROPPED
POST /api/v1/fleet/hosts/transfer {team_id:1}  → 200  {}   host 2 team_id 1 "SG Clinical"           (Free: 422, measured 2026-08-12)
host policy results through the team adapter   → [ [ 'Team: screen lock', 'fail' ] ]   posture { compliant: false, platform: 'ubuntu' }
fleet-connector exports: 8, write-shaped: []   adapter methods matching transfer|move|assign|team: []
POST /api/v1/fleet/hosts/transfer {team_id:null} → 200   host 2 team_id None   (lab restored)
proof:live-fleet            summary=pass (37/37) before the section; summary=pass (52/52) with it (premium section: RAN); 37/37 + "SKIPPED … FLEET_LAB_WRITE_OK" without the write flag
proof:live-fleet-workflow   summary=pass (21/21)   (FLEET_HOST_UUID = the live agent, inside the team)
```
Verdict:  **the trial bought exactly what the 2026-08-12 note said it would — evidence, not enforcement — plus one bug the Free server could never have shown.** Under Premium the transfer endpoint SUCCEEDS, so the connector's refusal is now provably the product's choice rather than Fleet's 422; SignalGrid's public packages carry no path to it at all. The team branch of `getPolicies()` worked as far as it went and no further: Fleet reports a team's policies in two lists, and the adapter returned only the first, so a team-scoped catalogue omitted every global policy the team inherits — fewer policies than Fleet applies to the host. Fixed to fold both (more policies known is the strict direction), asserted live in the new Premium section of `proof:live-fleet`, which skips LOUDLY and uncounted on a Free server or without `FLEET_LAB_WRITE_OK=true`. The key never touched the tree, a commit, a log or a result file; the lab could not phone home. Not verified: the Free-tier skip of the new section (this lab is Premium, so only the no-write-flag skip was run for real). One more wire fact the section caught on its first run: a team with no policies of its own answers with `inherited_policies` ONLY — Fleet omits the `policies` key rather than sending `[]` — so the adapter's `?? []` is load-bearing, and the proof now pins that shape too. The trial's clock ends 2026-09-16.

## 2026-09-06 — "Ninth round: the rest of lib/integrations and the twelve data directories — a key that folded two devices into one record, an allowlist a typo could open, gates that could not fail on the thing they guard"
Command:  two independent fail-closed audits (the 45 unread evaluate.ts families + registry/resolver/graph/store-scope/utils; the twelve artifacts data directories against their producers and consumer gates), then a firsthand read of every edit site; every fix behind a proof or a self-test that fails by mutation:
```
pnpm run proof:device-registry                  # new; then mutated: old key transform, "TRUE" opens
node scripts/check-scheduled-routines.mjs --self-test ; node scripts/check-lab-registry.mjs --self-test
node scripts/check-sim-requests.mjs --self-test ; node scripts/check-lab-collections.mjs --self-test   # new gate
node scripts/check-live-sync.mjs               # now refuses a doc that restates a status it does not print
pnpm run proof:graph-connector ; proof:graph-wire ; proof:launch-seam ; pnpm run typecheck ; pnpm run review:invariants
```
Output:
```
deviceKey: AA:BB:CC:DD:EE:FF vs AA_BB_CC_DD_EE_FF → different keys; exhaustive 4-letter alphabet 256/256 distinct (old transform: 81/256)
parseAllowlistMode: "true"→enforced/explicit  "false"→open/explicit  absent→enforced/absent  "TRUE","1","yes",""→enforced/unrecognized
isAllowedByPolicy: no lastSeenAt → false · unparseable → false · 31 days → false · exactly the bound → true · future beyond skew → false
proof:device-registry  summary=pass (52/52)
  mutation (old Redis key transform)   → summary=FAIL (50/52): "the two ids that used to collide…" and "injective over that set (81/256)"
  mutation ("TRUE" opens the allowlist) → summary=FAIL (51/52): "\"TRUE\" enforces and is reported as unrecognized"
check-scheduled-routines self-test 25/25 (future firedAt FATAL; active routine without tolerance FATAL; staleness still REPORTED)
check-lab-registry self-test 22/22 (refusal-only sim-result, empty capture, unparseable file, missing evidenceMarker all FATAL)
check-sim-requests self-test 19/19; real run: REPORTED — 2026-08-23-headwind-first-capture: provenance.commit da1ee232fc9f does not resolve (shallow clone: reported, not fatal)
check-lab-collections self-test 10/10; real run: 5 service folder(s), 20 request file(s) — passed
check-live-sync: liveEvidence=stale; docs/BUILD_BACKLOG.md restated "fresh" → corrected; a quoted citation in the 2026-08-21 review is exempt by rule
graph: proof:graph-connector 31/31 (absent from riskyUsers → none; 403 → every subject unknown; inventory reads still succeed)
       proof:graph-wire 12/12 · proof:launch-seam 46/46 (risk mirrored case for case from FIXTURE_GRAPH_RISKY_USERS)
review:invariants — clock-read pin lib/integrations/src 20 → 22, the two reads named (deviceRegistry.isAllowed on both backends)
coverage ledger: 81 read, 4 partial, 15 not read, of 100 surfaces (was 68 / 5 / 27)
```
Verdict:  **the registry could admit the wrong device, and a typo in one environment variable admitted every device.** `AA:BB:CC:DD:EE:FF` and `AA_BB_CC_DD_EE_FF` are both valid ids and shared one Redis record; `DEVICE_ALLOWLIST_MODE=TRUE` (or unset) opened the allowlist with no log line; the production backend validated nothing the dev backend checked; a freshness stamp was written on every check-in and read by nothing. All four now live behind pure, exported helpers a proof drives with a fixed clock, and the allowlist opens only on the exact string `false`. The Graph connector graded every live user's risk `unknown` because it read a field the live `$select` never requested — fixtures supplied it, so every proof passed; it now reads Identity Protection's risky-user list, and a tenant without the scope grades `unknown`, never `none`. Three gates carried the shape this repository keeps finding in itself: a check that skips on the unknown (no tolerance ⇒ exempt), an age that goes negative (future heartbeat ⇒ fresh forever), and evidence checked for existence rather than content (a refusal-only result closing a deployment claim). One committed result names a commit this repository has never held; the gate now resolves every commit and says, on a shallow clone, what it cannot vouch for. Not verified here: the Redis backend against a live Redis (the shared validator and injective key are proven pure; the Redis wiring compiles and mirrors the in-memory path); the `resolveFromRegistry` collision through `deviceResolver` (its input now cannot collide).


## 2026-09-06 — "Tenth round, the documentation families: a word numeral no sweep could read, three thousand line citations nobody bounded, a required variable nothing read, and an audit claim the tree refuted"
Command:  one independent docs audit agent over the 214 loose docs/* files (mechanical sweep of every cited gate script, proof figure and fail-open phrase; close read of 10) plus firsthand reads of docs/env, docs/agent's registries, PONYTAIL_AUDIT, LAB_001 and every edit site; then:
```
node scripts/check-derived-doc-figures.mjs ; node scripts/check-derived-doc-figures.mjs --self-test     # +2 rows, word-numeral sweep
node scripts/check-cited-paths.mjs ; node scripts/check-cited-paths.mjs --self-test                     # path:N bound, machine-local prefix rule
node scripts/check-known-false-claims.mjs ; node scripts/check-known-false-claims.mjs --self-test       # field detector + incomplete ratchet
node scripts/check-env-doc-readers.mjs ; node scripts/check-env-doc-readers.mjs --self-test             # new gate
git ls-files .github/workflows | wc -l ; ls scripts/src/*-proof.ts | wc -l ; git grep -l SIGNALGRID_SANITIZE_OUTPUT
ls scripts/check-doc-html-figures.mjs && node scripts/check-doc-html-figures.mjs --self-test           # the refutation
```
Output:
```
docs/CI_AND_VALIDATION.md:18 "Fifteen workflow files total" — git ls-files .github/workflows → 14 (promote.yml retired 19e53e0, 2026-09-02); REPO_LAYOUT.md:73 and STATUS.md:57 already said 14
  sweepHits("- **Fifteen workflow files total**", 15, "workflow files|workflows") → 0 hits BEFORE (digits only) · 1 hit AFTER
docs/ZERO_COST_LIVE_TEST_MATRIX.md:16 "140 are scripts/src/*-proof.ts" — tree: 143 (+1 alias = the gated 144); at the commit that wrote it there were 142
check-derived-doc-figures: 21 figure(s) across 11 document(s) match; self-test passed (50/50) — the two new rows' plants both "REPORTED AS DRIFT"
scan of tracked markdown: 3,080 path:N / path:N-M citations; 10 past EOF — CLAIM_INVENTORY.md:785 (OutcomeBadge.tsx:7-15 vs 13 lines), :2058 (monitoring.ts:147-186 vs 184), 8 in PONYTAIL_AUDIT_2026-09-01.md; 44 citations through /home/user/SignalGrid-Review-Hub/ in the same audit
check-cited-paths: 3184 line citations bounded; REPORTED — 12 range(s) past EOF inside 1 document declared "as measured 2026-09-01, not maintained"; passed; self-test 48/48
git grep -l SIGNALGRID_SANITIZE_OUTPUT → docs/MICROSOFT_GRAPH_LIVE_SMOKE_TEST_RUNBOOK.md, docs/env/MICROSOFT_GRAPH_ENV_EXAMPLE.md — no reader in any tracked file
check-env-doc-readers: 380 documents, 9 SIGNALGRID_*= instructions checked, every one read (TIER 119 files … ALLOW_LIVE_QUERY 3); REPORTED — LAB_001.md declares MACOS_POSTURE and MCP_CMD proposed
  first version of the reader lookup matched the bare name and counted its own header comment as 3 readers of SANITIZE_OUTPUT — replaced by read shapes (process.env.X, env.X, $X, getenv("X"), environment["X"])
check-known-false-claims BEFORE: "14 complete entr(ies) … 19 dated heading(s) NOT counted — missing Command, Output"; every one of the 19 carried `Command (…):` / `Output (…):`
                          AFTER: "33 complete entr(ies), newest 2026-09-06 · incomplete-heading ratchet: 0 = ceiling 0 (held)"; self-test 28/28 (Commander: is not the field; rise AND unlowered fall both fatal)
REFUTED audit claim: "the sweep reads no HTML — 8 buyer-facing files are outside every figure gate" → scripts/check-doc-html-figures.mjs exists, is in preflight and CI, gates architecture.html's dimension count against SIGNAL_CATEGORIES with a self-test, since 2026-09-02
coverage ledger: 82 read, 7 partial, 11 not read, of 100 surfaces (was 81 / 4 / 15)
```
Verdict:  **the figure gates were blind to the two spellings a document actually uses — a number written as a word, and a line range — and a runbook could require a control that did not exist.** `Fifteen` sat in the CI entry document eight lines above the paragraph about not copying derived numbers, and the sweep that guards that paragraph interpolated digits only. Ten line ranges pointed past the end of their files and nothing had ever compared a range to a length. `SIGNALGRID_SANITIZE_OUTPUT` (instructed as true) was "required" and read by nothing — the prose form of a fail-open: a control whose only implementation is the sentence enabling it. Each is now a rule with a self-test: words are hits, ranges are bounded (a dated record declares itself and is reported), an instructed variable needs a reader in a read shape. The audit agent's own absence claim about HTML gating was false, which is the check:absence lesson again from the other side: the tree is the authority, not the report. Not read: the bodies of BUILD_BACKLOG, COMPANY_BUILD_PLAN and CLAIM_INVENTORY (~10k lines), and eleven docs families still marked not read in the ledger.

## 2026-09-06 — "Eleventh round, the research, company, inspiration and connector families: a permission page that under-granted for a few hours, a roster count five files got wrong beside a sixth that had it right, thirty-five dead links no gate could see, and a send-ready pitch outside every claim scan"
Command:  one independent fail-closed audit agent over 74 files (42 read line by line, 32 grepped; every DR citation, self-repo URL, relative link, tree-describing figure, fail-open phrase and retired label swept mechanically), then firsthand verification of every finding against the tree and a read of every edit site; then:
```
grep -n 'baseUrl}/\|Read\.All' lib/integrations/src/integrations/graph/posture-connector.ts   # three reads, three scopes
node scripts/check-graph-permission-boundary.mjs ; node scripts/check-graph-permission-boundary.mjs --self-test   # new
node scripts/check-markdown-links.mjs ; node scripts/check-markdown-links.mjs --self-test                         # new
node scripts/check-send-copy-banner.mjs ; node scripts/check-send-copy-banner.mjs --self-test                     # new
node scripts/check-derived-doc-figures.mjs ; node scripts/check-derived-doc-figures.mjs --self-test               # +12 rows, +2 probes
node -e "console.log(require('./docs/agent/org-roster.json').roles.length)" ; git ls-files .claude/skills | awk -F/ 'NF>3{print $3}' | sort -u | wc -l
node scripts/check-index-banner-parity.mjs ; node scripts/check-launch-claims.mjs ; node scripts/check-cited-paths.mjs
```
Output:
```
posture-connector.ts: /users · /deviceManagement/managedDevices · /identityProtection/riskyUsers ; User.Read.All · DeviceManagementManagedDevices.Read.All · IdentityRiskyUser.Read.All
docs/connectors/MICROSOFT_GRAPH_PERMISSION_BOUNDARY.md (before): "Two endpoints … These two are what the connector names in code … Grant nothing else" — riskyUsers landed in #463 (e61d4ca), which updated seven records and not this page; its own line 73: "No gate currently reads this document"
check-graph-permission-boundary: connector reads 3, page tables 3 endpoint(s), 3 scope(s) — passed; self-test 8/8 (the omitted-scope plant fails with "403")
roster: roles.length = 42; docs/company: 10 sites in 5 files said 41 (HIRING_SEQUENCE, ORG_STRUCTURE, RESPONSIBILITY_AND_DRI_MATRIX, ROLE_ACTIVATION_MATRIX, ROLE_CATALOG); INVESTOR_ONE_PAGER.md:49 said 42 — corrected; 10 rows + probe roster-roles
skills: 26 tracked directories; MCP_MARKET_LEADERBOARDS.md:14 said 25 five lines above the command that derives it — corrected; row skill-directories
scan of tracked markdown: 782 relative links, 35 do not resolve document-relative (12 in docs/research from the 2026-08-10 relocation, 7 top-level docs pointing at moved files, 2 in the rendered CLAIM_INVENTORY, 13 in the HOME_REPO_README snapshot, 1 regex inside a code span)
check-markdown-links: 782 link(s) resolved from their own directory; REPORTED 13 in 1 declared snapshot; passed; self-test 11/11
check-send-copy-banner: 2 documents hold a Subject: template — 0 inside docs/outreach, 2 bannered (OUTREACH_EMAIL_TEMPLATES since 2026-08-23, STRATEGIC_BUYER_PARTNER_PITCH_PACK since today); passed; self-test 7/7
check-derived-doc-figures: 33 figure(s) across 18 document(s) match; self-test 62/62
DRI matrix: 23 classes; approval column opens "Founder alone" on 17, "Mechanical" on 4, "Nobody" on 2 — the doc said 12 (corrected, rule stated)
FUNDING_READINESS: "Keycloak 15 dimensions" as live proof → ORG_CHART/COMPANY_BUILD_PLAN: 2 of 15 iam dimensions live-verified (restated)
PRODUCT_REALITY_CHECKLIST.md:23 "Configurable fail-open/fail-closed behavior with conservative defaults for high-risk paths" (since 2026-07-08); git grep failOpen|fail_open lib/ artifacts/*/src → 0 (rewritten fail-closed)
docs/research/README.md: "no gate, proof, script or workflow references" → grep -rhoE 'docs/research/[A-Z_0-9]+\.md' scripts/ .github/workflows/ | sort -u → 6 files, one a hard gate since 2026-09-02 (reworded, dated)
index-banner parity passed · launch-claims passed (ceilings unchanged) · cited-paths passed · preflight↔CI parity 325 gates, 0 unwired
coverage ledger: 83 read / 10 partial / 7 not read of 100 (was 82 / 7 / 11; docs/research moved from read to partial, honestly)
```
Verdict:  **the permission page is the sharpest instance yet of a document loosening what the code holds closed.** The connector answers 403 → `unknown` exactly as the doctrine demands; the page told the one person who could grant the scope not to. It had said "no gate reads this" for twelve days and drifted the first morning it could. Three gates hold the shapes this round found: the page's tables ⇔ the connector's reads, a relative link ⇔ its own directory, a send template ⇔ a claim scan or a banner. The roster and skill counts are rows now, and the figure sweep has a roster probe. Left for the owner's judgement, not gated: the ICP segment stated flatly to investors while ICP_EVIDENCE calls it an assumption. Not read: 17 of 49 research files (send-copy, founder-strategy and social drafts), 4 of 9 company files by structure only, 11 inspiration catalogs by derivation only.

## 2026-09-06 — "Twelfth round, the send surface and the skills every role loads: an exemption that shielded authored prose as if it were vendored, a CI-coverage list three skills retyped from the defect it replaced, and a decision ladder drawn with the wrong rungs"
Command:  one independent fail-closed audit agent over docs/outreach, docs/preview, docs/assets, docs/consolidation, docs/estate, docs/postman and the content of .claude/skills (28 files read in full, 4 grepped only, vendored content not audited), then firsthand verification of every finding and a read of every edit site; then:
```
node scripts/check-cited-paths.mjs                       # before: 1757 citations, .claude/skills/ exempt wholesale; after: 1858, first-party skills checked
node scripts/check-known-false-claims.mjs                # + preflight-mirrors-three-of-six-ci-jobs (denials scan every tracked .md, skills included)
node scripts/check-send-copy-banner.mjs --self-test      # blockquoted template now a template; live assertion requires the outreach surface to be SEEN
node scripts/check-svg-outcome-ladder.mjs ; --self-test  # new
node scripts/check-index-banner-parity.mjs ; node scripts/check-preflight-ci-parity.mjs ; node scripts/check-launch-claims.mjs
```
Output:
```
.claude/skills/VENDORED.md:5 "TWELVE exceptions in this directory … FIRST-PARTY, written in this repository" vs check-cited-paths INTAKE_PREFIXES ".claude/skills/" (whole directory) — also in check-markdown-links, check-send-copy-banner, check-env-doc-readers
  first-party skill markdown: 20 files, 96 repository-path citations, 3 dead — stack-reference/ai-cli.md:28 tools/ecc-review-pass.sh (never existed), stack-reference/http-docs.md:13,:27 lib/profile.ts (the file is artifacts/api-server/src/lib/profile.ts)
  after: scripts/lib/skill-plane.mjs derives vendored = tracked skill dirs − VENDORED.md carve-out rows (throws on zero rows); check-cited-paths 1858 citation(s) across 484 docs — passed
node scripts/check-preflight-ci-parity.mjs → 31 jobs, 3 mirrored by preflight, 23 reported as uncovered; secret-scan lives in supply-chain.yml, not the main workflow
  .claude/skills/signalgrid/SKILL.md:92-96, signalgrid-core/SKILL.md:132-133, signalgrid-scribe/SKILL.md:29-30 said a typed three-of-six coverage list naming three jobs — the array scripts/lib/ci-jobs.mjs:6-20 records as the defect it was built to replace; rewritten to the command; FALSE_CLAIMS.json +1 (15 entries), gate: "still refuted … passed"
validate-sim-macos.sh:302 prints "N passed, M failed, S skipped"; three skills quoted it without S (signalgrid:87, signalgrid-native:107, signalgrid-reviewer:111) — fixed; signalgrid:184 "Refusing is correct behaviour, not a failure" → "and a SKIP, not a pass"
loop-end/SKILL.md: five steps, no reviewer, one unnamed gate → both gates named, signalgrid-reviewer before push
docs/assets/signalgrid-ecosystem-positioning.svg: outcome chips Allow · Step-Up · Deny · Remediate · Record; check-decision-vocabulary SCAN = lib/artifacts/native/scripts (no docs, no .svg) → chips now Allow · Step-Up · Restrict · Deny; check-svg-outcome-ladder: 1 SVG draws a ladder — passed; self-test 5/5 (Remediate/Record + missing restrict fatal)
docs/consolidation/*: "copies this to the home repo's README.md at cutover", "Re-run … at cutover", Review-Hub → archived / SignalGrid → home; docs/PHASE6_CUTOVER_RUNBOOK.md:3 "⛔ SUPERSEDED 2026-08-19 — do not execute … plans the opposite"; INDEX.md:361 "before cutover" → bannered, index repeats it; index-banner parity passed
docs/outreach/TEMPLATES.md:49 "in our lab, a device … had actually gone unverified for hours" ↔ trace to ProblemSection.tsx:36 (illustrative); check:absence "medication cart" INCONCLUSIVE (5 marketing hits, no lab record) → rewritten as the scenario
docs/estate/REPO_PRESENTATION_PROPOSALS.md:3 "five of seven" vs ESTATE_SYNC_REPORT.md §4 six rows, three own-name (four charitably); INDEX.md repeated five → both corrected
stack-reference/SKILL.md: 102 → 105 contradictions from the sheets (107 entries − 2 marked found-while-landing), shell.md 28 → 29, "nine reader agents" → eight (8 domain files); signalgrid-master: authority order now places docs/PURPOSE.md (what) above CLAUDE.md (how), "all four tools" → three; signalgrid/SKILL.md "~131 proofs" → 144, dated 2026-09-06
docs/preview/signalgrid-teaser.html:440 "· 16 events" → "· 16 events · synthetic data" (the disclosure lived only in README.md)
send-copy banner: SUBJECT_LINE could not see "> Subject:" — the form TEMPLATES.md writes; fixed; self-test 8/8 with the live check requiring scanned ≥ 1
preflight↔CI parity: 327 gates, 0 unwired · launch-claims passed, ceilings unchanged
coverage ledger: docs/outreach, docs/consolidation, docs/estate read; preview/assets/postman/.claude/skills partial
```
Verdict:  **the gates that guard prose had a hole exactly the size of the prose the org writes for itself.** Every role loads the first-party skills; four documentation gates had declared them foreign and walked past 96 citations, three of them dead, on a premise the exempting document's first paragraph denies. Inside that blind spot the skills retyped the CI-coverage list that `ci-jobs.mjs` exists to derive and quoted the harness summary with its skip field deleted — the two figures a builder reads at the moment of deciding to push. The exemption is derived now, the fossil is a registered false claim with denials, and the rendered ladder has its fourth rung. On the send surface itself nothing was untrue but one verb tense, and that tense is what a prospect would have believed. Not read: the four smaller stack-reference files, the 14 vendored skill directories (byte-identity to upstream is asserted with a sha and no in-repo means to check it — a gap recorded, not a finding), request bodies in the Postman collections.

## 2026-09-06 — "Thirteenth round, the two plans read end to end and the remainders: a NaN signature age that graded protected, a link repair that falsified two quotations in the evidence source, three lint rules that had never fired on their subject, and closures that reached the tree but not the rows"
Command:  two independent fail-closed audit agents — one over docs/BUILD_BACKLOG.md + docs/COMPANY_BUILD_PLAN.md (both read in full) + docs/agent/CLAIM_INVENTORY.json (1,023 rows, four programmatic properties, ~70 hand-verified), one over the 17 remainder research files, ROLE_CATALOG (164 entries parsed), four stack-reference files and the Postman request bodies — then firsthand verification of every finding and a read of every edit site; then:
```
pnpm run proof:edr-threat                                      # +2 assertions; then the isFinite predicate reverted to `=== null`
node scripts/check-swiftlint-rules.mjs ; --self-test           # new: each custom rule vs a planted positive and negative
node scripts/check-role-heading-status.mjs ; --self-test       # new
node scripts/build-postman.mjs --self-test ; --check           # orphans by method + path (new direction)
node scripts/check-send-copy-banner.mjs --self-test            # outbound-artifact headings
node scripts/gen-claim-inventory-md.mjs ; --check ; node scripts/check-markdown-links.mjs
node scripts/check-connector-discipline.mjs ; node scripts/check-preflight-ci-parity.mjs ; node scripts/check-launch-profile.mjs
```
Output:
```
lib/integrations/src/integrations/edr-threat/evaluate.ts:89-90 (before): signaturesStale = signatureAgeHours === null || staleHours === null || signatureAgeHours >= staleHours
  evaluateThreatPosture with signatureAgeHours: NaN → posture=protected action=none (the null case → degraded_protection/step_up) — an UNREADABLE age graded better than an honestly absent one
  after (Number.isFinite): proof:edr-threat summary=pass (51/51); mutation (predicate back to === null) → summary=fail (50/51): "an UNREADABLE signature age (NaN) is stale, never protected"
  scope: evaluateThreatPosture is exported; every caller today is a proof, and the one wired connector guards the field with Number.isFinite — latent on the wire, live in the evaluator; check-nan-fail-open (997 files, 0 violations) keys on Date parses and cannot see a plain number|null field — rule 5 is specified, not built
native/ios/.swiftlint.yml force_unwrap regex `!\s*(as|is)` → fires on "x as! Foo"? no (the ! is on the wrong side); on ".year!"? no. force_cast (same regex renamed) → no Swift cast at all. weak_delegate → fired ON "weak var xDelegate: X?"
  after: force_unwrap "[A-Za-z0-9_)\]]!(?![=A-Za-z0-9_\"'])", force_cast "\bas!", weak_delegate "(?<!weak )(var|let)\s+\w+Delegate\s*:" — check-swiftlint-rules: 8 rules, every positive fires, every negative silent; self-test 6/6 (the old regex fails on ".year!" by name)
docs/agent/CLAIM_INVENTORY.json (9147154, "Batch M"): two `claim` fields rewritten by the link repair — README.md:234 reads "[MIT License](LICENSE)" (no ../) and the Pages sentence is gone from README (aec28c8, #370) — both quotations restored, the MIT row's line 140 → 234, the Pages row annotated; gen-claim-inventory-md now escapes "](" inside the claim column → check-markdown-links passed over the re-render; 7 rows cited lib/signal-radar/dist/index.d.ts (untracked) → src/index.ts:24
check-send-copy-banner (before): hasSendTemplate=false for SOCIAL_PLATFORM_MESSAGE_VARIANTS (## Partner DM, ## Website hero teaser, a paste-ready email under ## Email intro snippet), LINKEDIN_POST_DRAFTS, SOCIAL_MEDIA_PREANNOUNCEMENT_PACKET — all unbannered, two carrying the retired label 5 and 2 times
  after: OUTBOUND_HEADING (DM|teaser|blurb|snippet|CTA|short posts|lettered post drafts; measured against every tracked heading — Post-exit, Pre-post, Drafts produced excluded); the three bannered do-not-post, index repeats it; self-test 11/11
check-launch-claims QUOTE_CONTEXT exempted SOCIAL_VISUAL_CONCEPTS.md:35 `Add a small caption: "Operational trust orchestration …"` and :66 — instructions to typeset the retired label; TYPESET_CONTEXT now withholds the quote idiom after a typesetting verb; captions rewritten to the ratified label; ceilings unchanged (29 / 453)
docs/company/ROLE_CATALOG.md:1160,1384 "(engaged)" over Current coverage "Not covered … no tester is engaged" / "No auditor … is engaged" → removed; check-role-heading-status: 164+ headings, none carries a status word; self-test 4/4
build-postman coverage(): spec→collection by path only → both directions keyed on METHOD + path; live: 58 spec paths present, 59 /v1 + /cp/v1 requests all defined; self-test 4/4 (planted POST /v1/totally-not-a-route reported; POST to a GET-only path reported)
docs/BUILD_BACKLOG.md:286 "36/36 families" vs check-connector-discipline "51 of 51" (flagged 2026-08-21 in ROLE_LENS_REVIEW:178, left standing while its twin liveEvidence claim was fixed 2026-09-06) → 51/51 dated; :92-94 placement rationale re-measured (both packages unreachable since b54be02); :1143 "six of seven" → four GAPS ids, one retired by DR-023
docs/COMPANY_BUILD_PLAN.md: 174/179 classified items → 180 (check-launch-profile: 180 items, 4 declared gaps); 175 / 179 / "180-odd" preflight gates → 327 dated or the command; row 73: five bullets annotated CLOSED (three closed by f97cebf, which edited this file by one line and left the row); row 157 CLOSED (row 160 already said so; rc:smoke has 0 occurrences in the review app); row 122 CLOSED (root key exists; the proposed equality gate would fail on proof:decision-palette); row 113 CLOSED-as-filed with the empty-icons caveat; :2793's CLAUDE.md correction APPLIED (WardlinkDemo named, SignalGridOperator excluded)
docs/company: "18 raw font calls remain … as of 2026-08-21" ×3 → 0 as of 2026-09-06 (check-ios-dynamic-type: 77 files, none); two do-not-send banners' stale reason corrected; scripts/src/e2e/README.md:98 "grown to 35" → 41 test( declarations dated
mac-host.md:62 ".env*" → ".env, .env.local, .env.*.local (so .env.production is unignored too)" — git check-ignore agrees
coverage ledger: docs/* partial (the two plans in full), docs/agent partial, docs/research partial (5 more in full), docs/company partial, .claude/skills partial (all eight stack-reference files now in full), docs/postman surface
```
Verdict:  **the evaluator was fail-open on the one input nobody can honestly report, and the tool that guards prose had rewritten the prose it guards.** `NaN >= n` is false, so an unreadable signature age slipped between the null arm and the comparison and came out `protected`, one predicate away from the doctrine sentence three lines above it — fixed with `Number.isFinite`, proven, and the mutation fails by name. The markdown-link gate, built the same morning, "fixed" two quoted excerpts in the claim inventory's source because the derived table rendered them as links — an excerpt is never a navigation target, and the renderer now escapes the syntax so the gate has nothing to repair. Three of eight SwiftLint custom rules had regexes that could not match their subject, one of them cited by a skill as a working guard; each now has a planted positive and negative it must pass. The plans show the loop's remaining weakness in one shape: closures propagate into the tree and not back into the rows — a HEAD commit closed three bullets of row 73 and edited that file by one unrelated line. Open and recorded, not done: the 58 README rows in CLAIM_INVENTORY.json quote a README rebuilt on 2026-09-01; a claim-anchor gate (a quoted claim must still be a quotation, ratcheted) and check-nan-fail-open rule 5 (a `number | null` field compared without Number.isFinite) are specified for the next batch.

## 2026-09-06 — "Fourteenth round, the three gates Batch O specified: the NaN rule found five more evaluators, the anchor gate found the inventory quoting surfaces that no longer say it, and the README rows were re-extracted against the README that exists"
Command:  build the three items LOOP.md specified after Batch O, then measure each against the tree before and after:
```
node scripts/check-nan-fail-open.mjs                              # rule 5: number|null fields compared in lib/**/src/**/evaluate.ts
  (then the six evaluators restored to the Batch-O head and the gate re-run — the pre-fix tree must fire)
pnpm run proof:rtls-custody ; proof:macos-posture ; proof:app-update ; proof:session-readiness ; proof:entitlement-binding
  (each once fixed, once with its evaluator reverted — a new assertion must fail by name)
node scripts/mutation-guard.mjs --proof=proof:<family>            # the six families, then the two that overlapped a revert re-run on a quiet tree
node scripts/check-claim-inventory-anchors.mjs ; --self-test ; --write ; node scripts/gen-claim-inventory-md.mjs
node scripts/check-preflight-ci-parity.mjs ; check-proof-counts ; check-doc-line-counts ; check-derived-doc-figures ; check-cited-paths ; check-launch-claims
```
Output:
```
rule 5 against the Batch-O head (edr-threat reverted too): 9 hits in 6 evaluators — app-update:91 crashCount; edr-threat:100 signatureAgeHours;
  entitlement-binding:139 nestingDepth AND nestingDepthBudget; macos-posture:111 sysextResidual; rtls-custody:109 fixAgeSeconds, :114 and :116 dwellSeconds;
  session-readiness:145 elapsedToUsableSeconds — 47 evaluator files, 46 nullable-number fields in scope; after the fixes: 0 violations, self-test green
  what each graded on NaN before: rtls fix age FRESH and dwell SHORT (in_zone); macos residual count "no residual" (hardened); app-update "unstable" (right verdict,
  wrong reason — unknown is the honest one); entitlement depth or budget GOVERNABLE; session-readiness READY with a budget posed (both the EXCEEDED branch and the
  UNPOSED fallback switched off, the same double switch-off the budget side had been fixed for on 2026-08-25). Wire normalisers guard four of the fields;
  entitlement's budget is an operator PARAMETER with no normaliser, and every evaluator is exported and called directly by its proof.
proofs after: rtls-custody 56/56, macos-posture 73/73, app-update 71/71, session-readiness 63/63, entitlement-binding 62/62 (state space 1200 → 2160 with NaN on both axes; clean stays 18)
proofs against the pre-fix evaluators: 54/56, 72/73, 70/71, 62/63, 57/62 — every new assertion fails by name (entitlement: the 2160-state enumeration leaks 5 NaN states and "18 reviewable" reads 34)
mutation-guard: session-readiness 26/25 killed + 1 known-inert, entitlement-binding 20/20, rtls-custody 14/14, macos-posture 16/16, app-update 41/37 + 4 inert, edr-threat 15/14 + 1 inert — survivors 0 (the first two re-run on a quiet tree: identical)
check-claim-inventory-anchors, first live run over 1,023 rows: anchored 421, moved 46, absent 391, unquoted 148, resolved 17; remove-actioned still present 64
  README.md: 1 anchored (the MIT line), 57 absent — every one quoting the README that #370 rebuilt on 2026-09-01; none resolved
  --write: 46 line citations re-anchored (About.tsx:28-31 → 122, ComplianceSection.tsx:4-18 → 90, demoData.ts "~53" → 66, AppLayout.tsx ":45, 116" → 134 …)
  57 README rows resolved (RESOLVED for the 25 rewrite/remove rows, SUPERSEDED for the 32 keep rows, each naming #370); 58 rows re-extracted against the current README by an
  agent and verified here: every quotation anchors at its cited line, every path:line cited in evidence exists and is within its file; 47 launch, 6 demo-only, 3 deferred,
  2 unsubstantiated; 5 rows entered already resolved because the README line they quote was corrected in the same change
  after: rows 1,081; anchored 520, moved 0, absent 334, resolved 79, unquoted 148; ratchet docs/agent/claim-inventory-anchors-ratchet.json absent=334 removeActionedStillPresent=64
  self-test 15/15 (anchored / moved / absent / resolved / unquoted / re-flowed "~" range / re-anchor / a RISE is fatal by name / a fall is stale until --write / untracked controls nothing)
README.md corrected from the re-extraction's evidence: :48 signalgrid-desktop is not "the operator console" (launch-profile.mjs:500-503 demo_only; signalgrid-app is); :60 `tests/`
  holds the k6 load tests only (`git ls-files tests` → tests/load/*.js, nothing harvested); :79 /console is the demo console (app.ts:96-103); :103-105 the win32 bindings
  are kept (pnpm-workspace.yaml:107-108, CLAUDE.md); :172 lane:deliver is the one-step delivery, lane:send/ack only write the file (LANE_COORDINATION.md:85)
scripts/launch-profile.mjs:333 "the 42 shared conformance vectors" (assist-wire-conformance.json holds 44) and :618 "One JSON file" (native/shared holds three: 44 + 52 + 40 vectors) → corrected
docs/INTEGRATION_CATALOG.md + APP_UPDATE_CURRENCY.md: proof counts 70 → 71, 59 → 62, 62 → 63 (check-proof-counts: all 59 documented counts match)
check-launch-claims: retired-label mentions 29 → 27 (docs/CLAIM_INVENTORY.md 2 → 0 — the two were in README rows now marked resolved); the deferred-noun ceiling unchanged
check-preflight-ci-parity: 334 gates, 0 unwired (2026-09-06)
```
Verdict:  **the rule Batch O specified against one line found five more, and the inventory that certifies buyer-facing prose had stopped quoting it.** Rule 5 asked one question — is a `number | null` field compared before `Number.isFinite` has seen it — and the answer was yes in six evaluators, five of them still live after the EDR fix: a NaN fix age read fresh, a NaN residual count read hardened, a NaN depth read governable, a NaN elapsed time read ready. Each is the same shape the NaN family has taken since the webauthn sweep, and each was one predicate from the doctrine sentence beside it; all five are fixed with the honest grade (unknown where a reason exists for it, a new `NESTING_BUDGET_UNREADABLE` where none did), proven, and the mutation fails by name. The claim inventory's own preamble had promised a synchronisation gate "until it exists"; measured, 57 of the 58 README rows quoted a document rebuilt five days earlier, 391 quoted claims were absent from their surfaces and 76 sat far from their citation. The anchor gate now holds every quoted row: line drift is fatal until `--write` re-anchors it, and the two absence counts may only fall. What it does NOT do is written in its header — 334 absent rows across the web, review and app surfaces are ratcheted, not resolved, 64 remove-actioned claims still render, and no gate yet checks the `evidence` citations themselves; those are the next batch, by name.

## 2026-09-06 — "Fifteenth round: the inventory's evidence citations held to their files, 325 vanished quotations given their removing commit, five site surfaces re-extracted, and the remove-actioned rows read one by one — 54 still assert what the tree does not back"
Command:  the anchor gate extended and re-run at each step, git pickaxe for the removing commit of every absent quotation, two read-only agents (one re-extracting five web surfaces, one dispositioning every remove-actioned row still rendering), every finding re-run firsthand:
```
node scripts/check-claim-inventory-anchors.mjs ; --self-test ; --write ; node scripts/gen-claim-inventory-md.mjs
git log -1 -S<segment> -- <file> ; then --pickaxe-regex with \s+ between words for the quotations that spanned a re-flow
node scripts/check-launch-claims.mjs                          # after the noun widening, on a scratch copy first, then live
pnpm run typecheck ; node scripts/check-launch-profile.mjs ; check-cited-paths ; check-derived-doc-figures ; docs-sanity ; check-known-false-claims
```
Output:
```
evidence citations in unresolved rows, first measurement: 1,066 root-anchored path:line citations — missing file 0, past EOF 0; 217 carried a double-quoted fragment: 97 near, 53 drifted, 67 absent
  --write re-anchored 33 drifted citations inside their evidence text; a backtick span is an identifier, not a quotation (16 false absences on the first re-extraction); a fragment belongs to the nearest citation before it (683-753 had been handed the next citation's "4 declared gaps")
  HTML entities and curly quotes are markup (22 of 334 "absent" claims differed by &amp; alone); a JavaScript string continued with `" +` and a `//` comment prefix are seams, joined without moving a line number
absent quotations 334 → 0: removing commit found for 132 by exact pickaxe + 12 by whitespace-tolerant regex — 125 of them 905c243 (2026-08-22, #253, the site rewrite the day after extraction), 4 the 2026-08-25 fail-open fixes (#309), 2 the org sweep, 2 the claims cluster itself, 1 each 29e29f7 / 7cf10ef / 26fc83f
  resolutions written: 110 RESOLVED + 26 SUPERSEDED naming the commit, 183 by a rewrite pickaxe cannot pin (the quotation spanned a re-flow or markup), 6 UNVERIFIABLE (the file has not changed that text since before the 2026-08-21 extraction — it was never quoted verbatim)
five web surfaces re-extracted against their current copy: 120 rows (SignalTypes 21, Verticals 19, Differentiators 23, Outcomes 21, fabric-console 36) — 83 launch, 21 deferred, 10 demo-only, 6 unsubstantiated; every quotation verified at its line; the extraction found OutcomesSection.tsx:105-114 asserting a dock/badge/location/PACS exit-violation flow with no hedge in its block, :43 "Session close recorded" (every /v1/sessions/* path deferred), DifferentiatorsSection:52 "Nobody Owns This Gap. Yet." (docs/research/MARKET_LANDSCAPE.md:14 "not empty"; :38, :48, :50 name who does), SignalTypesSection:18 a market-share clause and :75 "every claim on this page traces to a proof that runs on every commit" (false for :18), VerticalsSection:54 "the management plane the MSP already runs", fabric-console.html:9 an og:description whose hedge did not travel
  check-launch-claims DEFERRED_NOUNS matched none of "not docked", "badge checkout", "location escalation", "routed to the PACS" — widened; measured on a scratch copy first: docs ceiling 453 → 453, buyer gate +1 block (the finding); three self-test cases pinned; all eleven sites rewritten or hedged in their own block; 100 buyer-facing files, 0 violations after
remove-actioned rows still rendering, read one by one (64 → 63 when this batch rewrote a chip mid-read): 54 STILL ASSERTED (Pricing 11, Federal 10, DeploymentSection 8, Downloads 6, demoData 13, About/ProblemSection/Verticals/architectureData/competitiveData/DesktopLayout 1 each), 9 HEDGED IN CONTEXT — the fence was on the page at extraction (git diff 08eecbe..HEAD), the classifier's remove was wrong → reclassified rewrite (399 keep, hedged by this batch), 1 removed mid-audit
  fixed now: artifacts/signalgrid-review/src/data/demoData.ts:465 — a prepared prospect answer offering fail-open "configurable per workflow category", the exact mode golden rule 2 makes structural → fail-closed by construction and not configurable
  recorded, not fixed: the 54 in docs/agent/CLAIM_REMOVE_DISPOSITIONS_2026-09-06.json with current text, proposed edit and evidence check per row — the next batch's queue; ratchet remove-actioned still present 64 → 53
new fatal rule: a remove-actioned row that carries a resolution while its quotation still renders — a resolution retires the row from every count, so it is the one edit that could silently drop a live defect; self-test 26/26
README.md:200-202: the launch decision paths now name /v1/decisions/* and /v1/authorize (the host-app shape of the same gate)
after: rows 1,201 — anchored 619, moved 0, absent 0, resolved 433, unquoted 149; evidence citations 822 (fragments near 109, absent 12 — all in 2026-08-21 rows, ratcheted); remove-actioned still present 53; launch-claims 100 files 0 violations; typecheck Done
```
Verdict:  **the inventory now stands on its surfaces and on its evidence, and what it revealed is a queue, not a clean bill.** Every quoted claim either anchors where it says or names the commit that removed it; every evidence fragment either sits at its cited line or is counted where it fell. The re-extraction and the row-by-row read found what the launch-claims gate's noun list could not see: a shipping-site scenario asserting four deferred capabilities in one block, a heading contradicted by the repository's own market landscape, and — the one fixed on sight — a prepared answer telling a prospect that fail-open is a configuration choice. Fifty-four remove-actioned claims still render on Pricing, Federal, Downloads, Deployment and the review deck; each carries its current text, a proposed edit and an evidence check in the dispositions record, and the gate now refuses the shortcut of resolving them while the words stand. The auditor's other finding is a gate to build, not a row to fix: 28 launch-profile citations inside these rows land on unrelated lines while every membership claim is still true, so the check that holds them must import the profile and test membership, never a line number.

## 2026-09-06 — "Sixteenth round: the 53 remove-actioned claims that still rendered are gone from the copy or hedged in their own block — the ratchet the fifteenth round left at 53 reads 0"
Command:  every row of docs/agent/CLAIM_REMOVE_DISPOSITIONS_2026-09-06.json applied at its line, then the gate that refuses a resolution while the words render, run after each pass:
```
node scripts/check-claim-inventory-anchors.mjs            # before: remove-actioned still present 53
<edit the eleven surfaces>; node <scratch>/batch-r-resolve.mjs --apply   # presence decided by the gate's own quotedSegment/occurrences, never by eye
node scripts/gen-claim-inventory-md.mjs ; node scripts/check-claim-inventory-anchors.mjs --write ; node scripts/check-claim-inventory-anchors.mjs
node scripts/check-launch-claims.mjs ; pnpm run typecheck ; node scripts/check-known-false-claims.mjs ; node scripts/check-doc-line-counts.mjs ; node scripts/check-derived-doc-figures.mjs ; node scripts/gen-claim-inventory-md.mjs --check
```
Output:
```
before: rows 1201 — anchored 619, absent 0, resolved 433; remove-actioned still present 53; evidence fragments absent 12
the 53 (54 still-asserted dispositions less demoData.ts:465, fixed in Q), decided by the gate after the edits: 47 quotations no longer render → RESOLVED (this PR); 6 render inside a hedge in their own line → RECLASSIFIED remove → rewrite with the reason
  the six: Pricing.tsx:24 "Air-gap / on-premise deploy (roadmap design, not delivered)"; Federal.tsx:139 "FIPS 140-2-oriented (design target)"; VerticalsSection.tsx:16 (the buyer's own scanners read through the management plane, not a client claim); DeploymentSection.tsx:43/:46 "(design intent)" / "(design target)" under a card that now says it is a deployment DESIGN; architectureData.ts:35 cut to Entra ID and Fleet's logged_in_users
  two older rewrite rows lost their quotation to the same edits (Federal.tsx:16 NIST 800-171, competitiveData.ts:78 the objection response) → resolved in the same pass; absent 0 → 2 → 0
copy, by file — Pricing.tsx: "Shift Handoff Intelligence", "Compliance reporting export" and both alert-routing lines removed from both tiers; "Mobile PWA" is "demo surface, not in Limited GA" with ok:false in both tiers; Enterprise loses "+ Desktop client"; the FAQ's badge-case custody binding is a design target (deferred), not a Limited GA capability
  Federal.tsx: DISA STIG detail says the images are stock node:22 with no hardened base image; 800-53 "no control-mapping document exists yet"; 800-171 → configuration-management controls mapped into the baseline dimension, the 110-control baseline and CUI handling design goals, not modeled; "Offline license model — design intent, not built"; the STIG base-image feature removed; FIPS module "design target, no module selected"; table: OS Baseline "Stock node:22 images (hardened baseline: design)", Auth "CAC / PIV — candidate PACS signal category (design)"
  About.tsx: the NAC/SIEM/ITSM layer is "designed to sit alongside" them and "none is a Limited GA connector"
  Downloads.tsx: "approval-gated remediation" (desc + feature), "adding an ITSM hand-off view", "Shift hand-off view" and "Audit export" removed; "Offline-capable (PWA)" → "Installable (PWA)" (no offline path exists)
  ProblemSection.tsx:79: "All 7 signal sources fused" → "Three Limited GA signal sources fused into one calibrated decision — the other four are deferred"
  DeploymentSection.tsx: "PHI-access controls by design", "FIPS 140-2-oriented crypto design", "Bring your own PKI", "DISA STIG-oriented base image" removed; "Custom scaling and HA config" → "Single-node Docker Compose today; scaling and HA are not configurable"; the air-gapped card is "An air-gap deployment DESIGN … not an available offering"
  DesktopLayout.tsx:198: "macOS / Windows / Linux" → "macOS / Windows (desktop-chromed web console)" (no Linux shell, no native shell)
  competitiveData.ts:78: consumed today = Intune compliance and Entra identity; shift context, ITSM state and session anomalies "designed to add … (deferred, not Limited GA)"
  demoData.ts (15 prepared answers): the Workspace ONE, Hexnode, Tanium and MaaS360 API calls are now fixture-shaped payloads with "no <vendor> connector exists"; push notifications, automated remediation tasks, webhooks and IT alerts are recommendations the evidence records while the source system acts; "a 30-millisecond API call", "Tanium responds in 12 seconds", "the #1 use case for Workspace ONE customers", the three named regulators and the 200–800 ms / 20 s / 15-minute latency figures are gone
after: rows 1201 — anchored 564, moved 0, absent 0, resolved 486, unquoted 149; evidence citations 767 (fragments near 103, absent 11 — one fell with the copy); remove-actioned still present 0; actions remove 142 / rewrite 578 / keep 481
Claim-inventory anchors passed — absent held at 0, remove-actioned still present at 0, evidence fragments absent at 11
Launch-claims gate passed — 100 buyer-facing files, 0 violation(s); docs ceiling 453 held
typecheck: artifacts/signalgrid-web Done, artifacts/signalgrid-review Done, artifacts/signalgrid-app Done, scripts Done
Known-false-claim check passed; doc line counts 0 drifted; derived-doc-figure check passed (33 figures, 18 documents); Claim-inventory drift check passed (1201 rows, 87 files)
```
Verdict:  **the queue the fifteenth round left is empty, and the gate that keeps it empty is the one that emptied it.** Fifty-three claims the inventory had marked for removal on 2026-08-21 were still on the pricing page, the federal page, the deployment section and the review deck's prepared answers sixteen days later; each is now either gone from the copy or sits inside a hedge in its own line, and the decision of which was made by the same quotation match the gate runs, not by reading. The pattern under them was one pattern: a priced tier, a compliance table, a deployment card and a demo script each described the design as the product — features nobody built with green checkmarks, vendor API calls no connector makes, notifications SignalGrid has no surface to send, latency figures no harness measured. What remains is the membership check the auditor specified (a launch-profile citation must be tested by importing SURFACES, never by line number) and eleven evidence fragments in 2026-08-21 rows that no longer sit at their cited lines.

## 2026-09-06 — "Seventeenth round: a launch-profile citation is now tested by importing the profile, never by its line number — and the last eleven absent evidence fragments were the gate quoting the claim back at itself"
Command:  the membership check the fifteenth round's auditor specified, built into the anchor gate and measured on the live inventory at each step; the eleven remaining absent fragments read one by one:
```
node scripts/check-claim-inventory-anchors.mjs --self-test     # 37/37 after the first cut, 41/41 after the pairing rewrite
node <scratch>/membership-survey.mjs                           # nearest-status-word pairing, measured before it became a rule
node scripts/check-claim-inventory-anchors.mjs ; --write ; node scripts/gen-claim-inventory-md.mjs ; --check
node scripts/check-launch-claims.mjs ; check-known-false-claims ; check-doc-line-counts ; check-derived-doc-figures ; check-cited-paths ; docs-sanity ; check-preflight-ci-parity
```
Output:
```
survey, nearest status word within ±160 chars (the obvious rule): 346 launch-profile citations in unresolved rows, 151 id/arm pairs — 147 ok, 4 MISMATCH; all four were the word "launch" inside "launch-profile.mjs" itself
first cut (citations masked, nearest status word in the citation's clause): 29 MISMATCH — every one a false pairing: "No alert-routing surface at launch: /v1/webhooks and /v1/webhooks/deliveries are deferred" paired the path with the nearer "launch"; "`graph`, scripts/launch-profile.mjs:158), but the identity leg is deferred" paired graph with deferred; "zero network browser demo" read the English word as the `network` connector family
rule as landed: an id is paired with the status word that GOVERNS it — the nearest after it with only link material between (ids, "and/are/both/all/the", family/kind/path nouns, numbers, citations, parentheticals), else the nearest before it the same way ("defers X, Y", "three launch families — X, Y"); a sentence break or any other word between them means the status belongs to another subject; a bare dictionary word that is also an id counts only when backticked, quoted, or the subject of is/are
live: 180 profile id(s) imported (SURFACES entries are `{ id }` objects OR bare strings — the first survey read only the objects and saw 46); 459 citation clause(s) — asserted arm ok 246, MISMATCH 0, unasserted 213 (reported, never judged)
floor: fewer than 40 ids or fewer than four arms from the import is FATAL — a membership test over an empty map proves nothing; ratchet field membershipMismatches starts at 0, so the first forged arm fails
self-test pins: a forged arm ("graph is deferred") is a mismatch naming id, asserted arm and profile arm; "at launch: X and Y are deferred" asserts deferred; "graph … but the identity leg is deferred" asserts nothing about graph; "zero network" is English; "defers `pacs-access`, `itsm`" governs the ids after it; a status word across a semicolon is not borrowed; a resolved row's evidence asserts nothing; a rise in mismatches is fatal by name; the live import clears the floor — 41/41
the eleven absent evidence fragments, read one by one: 8 were the row's OWN claim wording quoted after a citation — `scripts/launch-profile.mjs:246-259). Future-tense framing ("being designed")` quotes Federal.tsx, not the profile — now a CLAIM ECHO status (existence-checked, never held against the cited file); 2 were stale citations re-cited to the current text (row 503 launch-profile.mjs:446-449 → :466-467 "The product: one tenant-aware decision service"; row 555 SECURITY_BASELINE_ALIGNMENT.md:128 → :132 "Every baseline-driven remediation is approval-gated and simulated"); 1 (row 69) was a superseded sentence still carrying a line citation to text that no longer exists — de-cited and dated
after: rows 1201 — anchored 564, moved 0, absent 0, resolved 488; evidence citations 764 — fragment near 105, moved 0, absent 0, claim echo 8; membership ok 246 / mismatch 0 / unasserted 213
Claim-inventory anchors passed — absent 0, remove-actioned still present 0, evidence fragments absent 0 (12 → 0 across Batches R and S), membership mismatches 0
Launch-claims gate passed; known-false-claims, doc line counts, derived figures, cited paths (1,875), docs sanity, preflight↔CI parity — all passed; claim-inventory drift check passed (1201 rows, 87 files)
```
Verdict:  **a line number was never evidence that an id sits in an arm, and now nothing pretends it was.** Every citation into the launch profile that names an id and an arm is checked against the profile's own SURFACES export; 246 such assertions hold, none contradict the profile, and the first that does will fail the gate by name. The instructive part is what the two obvious rules did before the real one landed: nearest-word pairing produced 33 false mismatches across two attempts, each a sentence a person reads correctly without noticing they did — "at launch: … are deferred", "graph …, but the identity leg is deferred" — so the rule that shipped pairs an id only with a status word linked to it by nothing but list material, and reports 213 clauses it cannot parse rather than guessing. The eleven fragments the ratchet had carried since the fifteenth round were the same lesson from the other side: eight were the gate hearing the claim's own words as the cited file's, and the fix is a rule, not eleven edits.

## 2026-09-06 — "Eighteenth round: the lane mail channel read as a whole for the first time — a message with no sentAt could never go stale, a routine that never fired was exempt from the only clock in its gate, and a delivery skipped a missing gate in silence"
Command:  artifacts/lane-messages (168 files) and the code that owns it read by a fail-closed auditor, every finding re-run firsthand, every fixed shape given an assertion that fails against the old code:
```
node scripts/check-lane-messages.mjs ; --self-test          # before: unread 9, stale 0, self-test 12/12 WITH the defect asserted as correct
node scripts/check-scheduled-routines.mjs ; --self-test     # before: "no heartbeat written yet … (the next fire writes the first)" for a routine authorized 30h ago with a 3h tolerance
pnpm run proof:lane-messages ; pnpm --filter @workspace/scripts run typecheck
cp f f.mutbak; <plant only the old guard / the old branch>; node <gate> --self-test; mv f.mutbak f     # the new assertions must fail by name
SIGNALGRID_LANE=mac node scripts/lane-message.mjs inbox     # read-only: the order the Mac sees
```
Output:
```
lane-message.mjs:107 (before): `if (m.sentAt !== undefined) { … stale.push }` — the staleness clock nested inside the presence check; an UNPARSEABLE sentAt was correctly stale, an ABSENT one exempt forever. schema 1 (no sentAt) is the shape of all but eight of the messages then on file - eighty of them - with 79 acked, 1 exposed: cloud-fleet-headwind-device-dimensions-need-your, committed 2026-08-24 (ad334f0), printed with NO age; check-lane-messages.mjs:60 asserted "a v1 message keeps its exact line … stale.length === 0" and passed 12/12
after: every unread message has an instant — sentAt, else the commit that delivered it (one `git log --diff-filter=A` for the directory), else "unknown age" — and every one is eligible for stale. Live: unread 9, STALE 1 — "cloud-fleet-headwind-device-dimensions-need-your … unread for 13.0d (by its commit date; sent before sentAt existed)"
  self-test inverted and extended (19/19); with ONLY the old guard planted back: FAIL "a v1 message with no sentAt and no commit date is STALE with an unknown age", FAIL "ages by its commit date", FAIL "one committed an hour ago is not stale" — 16/19
check-scheduled-routines.mjs:99 (before): `if (hb === undefined) reported.push("no heartbeat written yet … (the next fire writes the first)")` — cadenceToleranceHours consulted only in the else branch; mac-lane-tick (tolerance 3h, authorized 2026-09-05) and live-sync-loop-keeper (50h, authorized 2026-07-27) both absent and both described as young
after: the clock for a routine with no heartbeat is its authorization instant — live: "mac-lane-tick: NEVER fired — authorized 30.2h ago, tolerance 3h" and "live-sync-loop-keeper: NEVER fired — authorized 990.2h ago, tolerance 50h" (REPORTED, never fatal; no authorizedOn with no heartbeat is FATAL — with neither instant it would read as fresh forever); self-test 28/28, with the old branch planted back 25/28, the three new cases failing by name
lane-deliver.mjs:206/:223 (before): `if (!existsSync(join(wt, script))) continue;` — a missing gate skipped in silence, no gate line printed, the run still ended "done" under a header promising FAIL CLOSED. after: refused by name unless --allow-ungated, and the skip is printed when allowed
supersedes: a withdrawal existed only as prose, and the inbox printed by FILENAME — the withdrawn batch-J work order 2nd of 9, the notice withdrawing it 9th of 9. after: `send … --supersedes <id>` (batch op `supersedes`), the audit marks the superseded id (a nonexistent target is FATAL), the inbox orders by sent instant and prints superseded messages last under a banner; live Mac inbox now reads oldest-first: the 13-day Fleet handoff first, the batch-J order 7th and its withdrawal 8th
acks: 79 of 79 are schema 1 with no ackedAt; round trip now measured from the ack's commit date (inbox --all prints "acknowledged after Xh"); the writer refuses a blank note (proof LIVE: exit 2, "an ack needs a note"), a blank schema-2 note is FATAL, the one blank schema-1 note (acks/cloud-lab-001-step-1-formally-queued-as-a-sim-re.json) is REPORTED
readJson names the file it cannot parse; SIGNALGRID_LANE="Mac" is still ignored, now out loud ("names no lane (cloud, mac) — ignored; acting as the cloud lane")
false claim in the newest instruction to the Mac (cloud-withdrawn-the-three-batch-j-asks-the-cloud): "The six unread cloud→mac messages can be acked in one go with pnpm run lane:inbox" — inbox only prints (acks go through lane:deliver batch), and the count was seven: the six with a sentAt, omitting exactly the message the old clock rendered without an age. A delivered message is a record — corrected by a follow-up message in the next steward batch that supersedes both batch-J messages
clean: secrets/PII (FLEET_LICENSE_KEY appears as a variable name only; HMDM lab seed hashes and a vendor sample e-mail quoted from upstream SQL), id↔filename 88/88, from/to ∈ {cloud, mac} 88/88, 0 dangling acks, unread count 9 agrees with the gate, the newest sixteen entries' factual claims true except the one above
proof:lane-messages 44/44 (was 40; the v1 assertion inverted, commit-date age, supersedes, dangling supersedes, LIVE blank-note refusal); scripts typecheck Done; cited paths, docs sanity, line counts, derived figures, known-false-claims, launch-claims — all passed
```
Verdict:  **the channel that carries what one lane needs the other to know could not say how long the oldest thing in it had waited, and the gate that watches the routines could not say that one had never run.** Both were the same inversion: the harder case handled (a corrupt timestamp, a stale heartbeat) and the easier one exempt (no timestamp, no heartbeat), with a self-test pinning the exemption as correct. The 13-day-unread Fleet handoff and the tick that never fired are one sentence — absence reported as youth — and both are now measured from the instant that actually exists, the commit or the authorization. The withdrawal that lived only in prose is the third shape: an instruction cannot be cancelled by a sentence the reader has not reached yet, so the field the audit reads now does it. What this round did not do: rewrite any delivered message — the false ack instruction is corrected by a message that supersedes it, because a record is a record.

## 2026-09-06 — "Eighteenth round, second half: the eleven inspiration catalogs' prose — a reference document that states an absence is a claim with a shelf life, and three of them had expired"
Command:  every catalog under docs/inspiration read as prose by a fail-closed auditor (preambles, summaries, repo maps, priorities, guardrails, methodology, every row naming a SignalGrid path or symbol), every figure re-counted from the file, every citation opened; the counts re-measured firsthand before editing:
```
ls lib/integrations/src/integrations/change-window/ ; grep -n ChangeWindowStanding …/types.ts ; grep -n change-window docs/BUILD_BACKLOG.md
grep -rl '"<KEY>"' native/ios --include=*.swift        # for each of the 38 SignalGrid-iOS config-key rows
awk 'NR>=60 && NR<=482 && /^\|/' TECHNOLOGY_ECOSYSTEM_MASTER_CATALOG.md | <count url / access / vendor columns>
sed -n 1079,1109p TECHNOLOGY_ECOSYSTEM_MASTER_CATALOG.md | sort -u | wc -l
<diff the doc's 77-row action map against lib/app-workflows/src/catalog.ts grades>
node scripts/check-known-false-claims.mjs ; check-cited-paths ; docs-sanity ; check-doc-line-counts ; check-derived-doc-figures ; check-launch-claims
```
Output:
```
OT_ICS_SCADA_API_CATALOG.md §"The one genuine near-term gap": ""queued in BUILD_BACKLOG.md, not built here" (its words for the change-window question, which it said nothing answered) — refuted: lib/integrations/src/integrations/change-window/ (types.ts: ChangeWindowStanding = inside | outside | unknown), proof:change-window, BUILD_BACKLOG.md:71-73 "[x] … DONE"; landed 2026-08-02, the catalog kept the gap for five weeks → section rewritten in the past tense with the closure named; INSPIRATION.md:160 likewise; registered in docs/agent/FALSE_CLAIMS.json (id change-window-queued-not-built, refutation path_exists, two denial patterns) — 16 claims, gate passed, 0 re-assertions across 484 documents
MOBILE_APP_CATALOG_AGENT.md:12-13 "QUEUED YELLOW-LANE BUILD" — scripts/mobile-app-catalog/scan.py v2.0.0 + proof:mobile-app-catalog (package.json, review-hub-ci.yml) exist; BUILD_BACKLOG rows 191-196 "[x] SCANNER HALF DONE" → rewritten; INSPIRATION.md:197-198 likewise
MOBILE_CONFIG_RECORDER_CONTRACT.md:22-25 "DEFERS to the queued normalization-version stamping build … if that build lands first" — BUILD_BACKLOG.md:26 "[x] 27a … BUILT", scripts/generate-core-normalization-version.mjs exists → rewritten
TECHNOLOGY_ECOSYSTEM_MASTER_CATALOG.md:9-10 "423 master entries with row-level source URLs and per-row access classification" — measured over the 423 data rows: 71 with no URL (352 with), 24 with no access class (399 with), 134 with no vendor, product or category (the MDM/UEM/EMM block), 1 with no priority (the sheet's own distribution sums to 422); the workbook's methodology row says "when available" and the repo preamble had dropped it → rewritten with the measured figures; INSPIRATION.md:208-209 likewise; the SignalGrid-Repos sheet's "37 entries · source URLs included row-wise" is 6 rows with content and 31 byte-identical placeholders (sort -u → 1 line) → preamble note
MOBILE_APP_CONFIGURATION_CATALOG.md:33-40 tier-drift warning named four under-graded actions; measured against catalog.ts: seven UNDER-graded (witness.cosign, alarm.silence, code.broadcast, log.edit, node.drain critical→standard; door.request, physician.escalate elevated→standard) → rewritten; :924-945 — 19 of the 38 SignalGrid-iOS config-key rows name environment reads commit 27e0e71 (PR #436) deleted from ProviderConfigurationService.swift (13 appear nowhere in the tree), rows 942-944 live but read by BackendService.swift → KEY-REMOVAL DRIFT paragraph in the repo-authored preamble (the body is a verbatim owner workbook)
SPATIAL_TRUST_RESEARCH_REPORT.md:626 "The safe default should be risk-dependent, not universally 'fail open' or 'fail closed'" — the one paragraph in the folder arguing against golden rule 2; the preamble hedged vendors and endorsements but not this → marked NOT adopted, the fabric's unconditional rule named
CONTROLUP_DEX_EUC_API_CATALOG.md:56 "54" and ASSET_MANAGEMENT_IT_GOVERNANCE_API_CATALOG.md:69 "114": no derivation rule reproduces them from the filed tables (every other total in both files re-derives exactly) → marked unverified with the derivations tried, not restated
COMMUNICATIONS_SYSTEMS_API_CATALOG.md:909 cites sandbox:/mnt/data/… (a generator-local path) → named in the preamble with the in-repo equivalent
clean: no deferred or nonexistent capability presented as CURRENT (every deferred noun — PACS, RTLS, custody, location, webhooks, sessions, change-window, shift-context, dock — sits inside "recommended order", "P1/P2 target", "candidate", "reference material, not a claim"); the OT catalog's "ISE quarantine actuators were deliberately removed" is true (nac/cisco-ise.ts:3-13); no unsourced superlative; Imprivata characterisations agree with docs/research/MARKET_LANDSCAPE.md:48; overlapping figures agree across catalogs (PACS 61/24/10, ENDPOINT 135/45/31, COMMUNICATIONS 441/71/97/71/66, ASSET 330/16/40/28/10, ControlUp 62/12, MOBILE 760/101, OT 151/120/76/28)
not read: the vendor-row bodies of the six large tables (~2.4MB of the folder's 2.6MB) — counted and column-tallied; a false vendor-capability claim buried in one of roughly nineteen hundred rows would not have been caught
gate the auditor specified, not built here: a document that cites a repository file AND names a symbol inside it must name a symbol the file still contains — check-cited-paths proves the path and stops; findings 2, 5 and 6 all passed it. Match against code, not comments (ProviderConfigurationService.swift names BACKEND_TIMEOUT precisely to record its deletion); verbatim imports need a visible per-file opt-out; it must not read English
docs gates after: known-false-claims (16 claims, 0 re-assertions), cited paths, docs sanity, doc line counts, derived figures, launch-claims — all passed
```
Verdict:  **three catalogs said something did not exist that did, and the oldest of them had been wrong for five weeks.** None of the three was a lie when written; each was a "queued" that nobody revisited when the queue moved, which is the shape `docs/agent/FALSE_CLAIMS.json` already holds two entries for and now holds a third. The figure findings are the same shape with numbers: "423 with per-row URLs" was a qualifier dropped between the workbook and the preamble, and a tier-drift warning that named four of seven under-graded safety actions was accurate about every one it named and wrong about how many there were. The fail-closed paragraph in the spatial-trust report was never adopted by any code — but an unmarked external argument against the fabric's one unconditional rule is the kind of sentence that gets imported later by someone who trusts the preamble, so it is marked now.

## 2026-09-06 — "Nineteenth round: a document that cites a file and names a symbol inside it is now held to the file — check-cited-paths proved the path and stopped, and three of the eighteenth round's findings walked through it"
Command:  the gate the catalog auditor specified, built, measured against every tracked document, falsified, registered:
```
node scripts/check-cited-symbols.mjs --self-test        # 16 shapes: presence, comment lines, glob safety, pairing boundaries, registry rows, exemptions, ratchet
node scripts/check-cited-symbols.mjs                    # live, before and after the rule changes below
node scripts/check-cited-symbols.mjs --write ; git add docs/agent/cited-symbols-ratchet.json
cp docs/MAC_LANE.md docs/MAC_LANE.md.mutbak; <append "`PLANTED_MISSING_KEY` is exported by `lib/verdict-attestation/src/attest.ts`.">; node scripts/check-cited-symbols.mjs; mv docs/MAC_LANE.md.mutbak docs/MAC_LANE.md
node scripts/check-preflight-ci-parity.mjs ; node scripts/check-cited-paths.mjs ; node scripts/docs-sanity.mjs ; node scripts/check-doc-line-counts.mjs ; node scripts/check-known-false-claims.mjs ; node scripts/check-derived-doc-figures.mjs
```
Output:
```
rule: a code-file citation (repo-relative path under lib|scripts|artifacts|native|fixtures|fleet|tests|tools|config|firmware|site with a code extension, bare or inside a blob URL) paired with a symbol on the same line — SCREAMING_SNAKE, or a backticked camelCase / snake_case identifier — must name a symbol the file contains on a NON-COMMENT line. English is never read: pairing is positional (an explicit attribution after the symbol — "in/at/from/of/exported by/defined in `path`", "is defined in", or a parenthetical citation within two words — wins; else the nearest citation within 60 characters before it, broken by a `;`, a sentence end, a table-cell bar, a bare file name, or a possessive of some other noun). A registry row (one code citation, by URL) pairs every symbol in the row. A document's own name is never a symbol (path stems and tracked doc names excluded). Anything not paired is COUNTED and printed as unpaired, never judged.
first live pass (before the boundary rules): 123 pairs, ok 95, MISSING 26 — 19 were the iOS config-key registry's deleted keys (the eighteenth round's finding, already recorded in that file's preamble), 3 were the gate mis-pairing English that a reader gets right ("before `requireTenantContext` runs (`v1.ts:56`)" paired to the PRECEDING rateLimit.ts; "the signalgrid-mcp sibling's `_xprotect_readable`" paired to the preceding types.ts; "**COVERED.** `never_synced`" paired across a table cell), 1 was real
self-test at that point: 13/16 — the three failing shapes were exactly the three mis-pairings, written as cases before the rule was changed; after (explicit-after wins, `|` and a foreign possessive break the before-pairing): 16/16
real finding: docs/MAC_LANE.md:248 said `swift test` runs "over `native/ios/Package.swift` and `SignalGridMobileCore`" — SignalGridMobileCore is its own package at native/ios/SignalGridMobile/SignalGridMobileCore/Package.swift (ios-ci.yml job macos-native runs swift test in each directory in turn); check-cited-paths passed the line because native/ios/Package.swift exists → reworded to name both manifests
verbatim import: docs/inspiration/MOBILE_APP_CONFIGURATION_CATALOG.md carries `<!-- cited-symbols: verbatim import, drift recorded in the preamble (KEY-REMOVAL DRIFT, measured 2026-09-06) -->` as its first line — the body is an owner workbook the eighteenth round chose not to edit; the gate prints the exemption by name on every run (four named exemptions: the derived inventory page, EVIDENCE.md as a dated record, PONYTAIL_AUDIT_2026-09-01.md by its line-citations marker, the catalog by this marker)
after: 484 documents, 82 pairs checked — ok 80, MISSING 0, cited file absent 2 (check-cited-paths owns those: both are dated-record exemptions there), 194 symbols near a citation left unpaired and reported; ratchet docs/agent/cited-symbols-ratchet.json written at missing 0, byDoc {} (may only fall; an uncommitted ratchet is refused: "an uncommitted ratchet controls nothing")
mutation (doc): one planted line → "MISSING 1 … MAC_LANE.md line 318 (the appended line, past the file's real end) "PLANTED_MISSING_KEY" ∉ lib/verdict-attestation/src/attest.ts" and "✗ Cited-symbol ratchet ROSE: missing 0 → 1", exit 1; reverted from the .mutbak copy, tree clean
mutation (gate, in the self-test): a symbol present ONLY in a comment of the cited file is MISSING (attest.ts-shaped fixture with a deletion note), a `/*` inside a string does not swallow the code after it (the survey's regex stripper had — PRODUCT_NAME reported missing from a file that defines it)
registered: preflight.mjs (two entries: the check, its self-test) and review-hub-ci.yml (same two, with the reason as a comment); parity: 336 preflight gates, 0 unwired
side findings while the docs gates ran: COMPANY_BUILD_PLAN.md:4890 quoted preflight.mjs at 630 lines (632 after the registration) → updated; the eighteenth-round entry above wrote "80 of 88 messages" in a section naming the lane-messages proof, and the steward's next delivery made it 89 — the figure guard failed mail PR #479 on it → written in words (a count of messages changes with every delivery and must never sit as a digit beside that proof's name); LOOP.md's NEXT ACTION still told the Mac lane that unread messages "can be acked with `pnpm run lane:inbox`" — the instruction the eighteenth round corrected in the mail channel was also in the loop file → corrected (acks go through `lane:deliver batch`, each with a note)
docs gates after: parity, cited paths (1884 citations across 484 docs), docs sanity, doc line counts, known-false-claims (16 claims, 0 re-assertions), derived figures — all passed
```
Verdict:  **a path that resolves is not a sentence that holds, and the gate that proved paths let three sentences through that named things the files no longer had.** The new check reads no English: it pairs a symbol with a citation by position and a short list of breaks, and the honest part is what it does with everything it cannot pair — counts it, prints it, judges none of it. The instructive measurement is the first live pass: of the 26 misses, 22 were either the finding already on record or the gate being wrong about which file a reader would attach the symbol to, and each of the three mis-pairings became a self-test case BEFORE the rule moved, so the rule that shipped is the one those cases forced. One real defect in the tree, fixed by naming both manifests. What this round did not do: read the 194 unpaired symbols — a symbol two clauses from its citation is unchecked, and the gate says so on every run rather than guessing.

## 2026-09-06 — "Twentieth round: six partial surfaces read whole — two public PNGs carried a retired label five days after their sources were fixed, the orchestration skill's authority ladder had lost the owner, a rehearsal called a different server 'the same tool', and the console still renders a dead control plane as 'Loading…' at eight sites"
Command:  four independent fail-closed reads (artifacts/signalgrid-app, docs/lab + docs/preview + docs/assets, the vendored .claude/skills content, docs/company), every finding reproduced by running something, every fix falsified before it landed; two gates built by the gate engineer from the reads' specifications, two rules added to existing gates:
```
node scripts/check-svg-outcome-ladder.mjs ; --self-test          # ΔE neighbour rule + AA text rule; the two shipped ambers planted
node scripts/check-sim-requests.mjs ; --self-test                # stale-pending prose rule; the rehearsal doc's OLD text planted back
node scripts/check-launch-claims.mjs                             # retired-label scan now opens docs/**/*.svg (floor 1)
node scripts/render-preview-assets.mjs ; node scripts/check-rendered-assets.mjs ; --self-test
node scripts/check-skill-instruction-conflicts.mjs ; --self-test ; node scripts/check-gitignore-producers.mjs ; --self-test
bash .claude/hooks/block-dangerous.sh --self-test                # 23 passed, 0 failed — the judge the skills gate invokes
node scripts/check-publication-boundary.mjs ; check-skill-plane-conformance ; check-known-false-claims ; docs-sanity ; check-cited-paths ; check-preflight-ci-parity
```
Output:
```
docs/preview: both PNGs VIEWED — each rendered the eyebrow OPERATIONAL TRUST ORCHESTRATION (check-launch-claims.mjs:427 RETIRED_LABELS); commit ab72355 (2026-09-01) deleted <p class="eyebrow"> from both html sources, 2 files changed, 2 deletions, neither PNG touched; both blobs byte-identical to 2026-08-03; the retired-label scope is ls-files docs filtered .html?/.md — nothing opens an image. OG card: LIVE DECISION / ALLOW / TRUST_ESTABLISHED / audit chain VERIFIED with no synthetic-data marker; the teaser twin got "· synthetic data" in Batch N (EVIDENCE:1328) and the OG did not
  after: "· synthetic data" inside the OG verdict block; both PNGs re-rendered from the committed html (Chromium 141 via Playwright, deviceScaleFactor 2 — the raster the files shipped at — prefers-reduced-motion emulated so the teaser's Math.random canvas never reaches a pixel; each page rendered twice per run and refused on any byte difference); viewed again: eyebrow gone, disclosure legible
  gate check-rendered-assets: scope DERIVED from tracked docs/**/*.html declaring <!-- render-viewport --> and <!-- render-output -->; manifest docs/preview/assets/renders.json pins each PNG to sha256(source); source moved without a re-render → FAIL by name; unpinned docs PNGs REPORTED never fatal; floor 2; self-test 7/7 (messages asserted, not counts); planted: one comment line in og.html → "source moved since the render — re-run scripts/render-preview-assets.mjs", exit 1. NOT covered, said in the header: visual correctness, and whether the pixels came from that source (the hash is written by the renderer and trusted after; cross-machine byte identity was not measured)
docs/assets: ladder order matches lib/signalgrid-core (types.ts:384; policy.ts:16-21 and continuity.ts:96-101 rank allow 1 < step_up 2 < restrict 3 < deny 4); geometry: one arrow M640 526 L640 596 landed inside the Restrict box while the ladder group's centre was x=530 under a card centred at 640; Step-Up #d6a85b beside Restrict #c98f3e — ΔE 11.0. after: a fan (one line out of the card, a bus, four drops) to four rungs centred at 640; rungs #72b989 / #e9c65f / #d9843f / #c7645c (neighbour ΔE 51.6 / 32.4 / 30.7; chip text ≥ 4.7:1 on every fill)
  ladder gate: chip fills read from the <rect fill> before each chip; neighbours must differ by ΔE*ab ≥ 20 (CIE76), chip text must clear 4.5:1; a chip with no readable fill is FATAL. The first cut used luminance contrast at 1.5:1 and failed the LIVE tree on Allow/Step-Up (1.41:1) and Restrict/Deny (1.35:1) — green beside yellow is ΔE 51.6 and 1.41:1 at once, so luminance was the wrong measure and the self-test now records that pair. self-test 10/10, the two shipped ambers FATAL by name. Header comment that delegated <title>/<desc> prose to "the retired-label scan" corrected — that scan's scope had no .svg; it does now (check-launch-claims: docsSvg loop, floor 1; live run: 0 violations, 138 buyer-facing + 150 code files scanned, gate passed)
docs/lab: LAB_001_CLOUD_REHEARSAL.md:13-16 "the same server, the same JSON-RPC wire, the same tool the Mac run will use" — the rehearsal drove artifacts/mcp-server (TypeScript, .mcp.json name signalgrid-mcp, tool evaluate_location_certainty over the fixture hospital graph, 16 tools); the Mac's half runs the SEPARATE Python repository signalgrid-mcp (scripts/verify-all.mjs:4 "The two repos stay SEPARATE", :132 clones it, :160 pytest; the sim-result tail: 99 passed, 22 tools) against macOS posture; :52-53 "if the Mac's run disagrees with a row above, the disagreement is the finding" compared nothing — no disagreement guaranteed by construction. The five-row table itself reproduces verbatim today (driver in the scratchpad: known/SUFFICIENT_CERTAINTY; degraded/SOURCE_DEGRADED step_up unknownSignals source_health; unavailable/SOURCE_UNAVAILABLE; stale/LOCATION_STALE; degraded/LOCATION_UNKNOWN). Status line "real-hardware evidence NOT minted" four days after artifacts/sim-results/2026-08-31-lab001-step1-real-posture.json completedAt 2026-09-02T16:51Z status passed exit 0 workingTreeClean true; mac-run.json a single slot (LAB_001's 655b9fae… overwritten by dee798b on 09-03). after: analogue-not-baseline framing, dated completion, the slot named. LAB_001.md:40 cd ~/signalgrid-mcp — verify-all searches ../signalgrid-mcp, ./signalgrid-mcp, /workspace/signalgrid-mcp, never ~ → sibling clone / SIGNALGRID_MCP_PATH; "expect 99 passed" dated as an external repository's figure; Keycloak admin/admin -p 8080:8080 and ntfy -p 8090:80 on a "MAC / LOCAL LAN" lane → 127.0.0.1 binds with the reason. Clean: no fail-open instruction (:64-67, :134 both tighten); the PROPOSED env names are live-gated by check-env-doc-readers
  sim-requests gate (as of 2026-09-06): stalePendingProse — a paragraph naming a request whose result PASSED and still saying NOT minted / not yet / pending / when that lands, without an "as of YYYY-MM-DD", is a problem. First cut split on blank lines only and read docs/BUILD_BACKLOG.md's 40-bullet list as ONE paragraph (an id in one bullet paired with "not yet" in another) → list items are paragraphs. self-test 23/23 (was 19); LIVE passed; with the rehearsal doc's committed text planted back: "docs/lab/LAB_001_CLOUD_REHEARSAL.md:47: names request 2026-08-31-lab001-step1-real-posture (result PASSED) in a paragraph that still says \"When that lands\"", exit 1
.claude/skills: 57 files read in full (51 vendored + LICENSE + VENDORED.md + signalgrid-master + loop-start/loop-end/signalgrid-reviewer for the conflicts); signalgrid-master/SKILL.md:19-29 Authority order began "2. Ratified records…" — git show f97cebf: "-1. The owner's explicit current instruction." removed by a renumbering whose message said only that PURPOSE.md moved above CLAUDE.md; shipped 03:10Z, four hours headless → restored with the reason in the line. brainstorming/scripts/server.cjs:106 SUPERPOWERS_BRAND_IMAGE_URL = https://primeradiant.com/… embedded at :249 with ?v=<version> unless SUPERPOWERS_DISABLE_TELEMETRY / DISABLE_TELEMETRY / CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC is set (:107-112); reproduced by starting the server: the page carried ?v=unknown (:208-225 reads .claude/package.json, absent) → .claude/settings.json env SUPERPOWERS_DISABLE_TELEMETRY=1 (the narrow switch; the CLAUDE_CODE one would also silence the harness's own traffic). Against the hook (self-test 23/23): subagent-driven-development/SKILL.md:483 rm -rf <workspace> DENIED; finishing-a-development-branch/SKILL.md:156 git branch -D DENIED; :225 "force-push only on your human partner's explicit request" (CLAUDE.md: never); :16 npm test (no root test script; green here is validate-sim + preflight); five commit-without-asking sites; writing-skills/anthropic-best-practices.md:856-877 teaches FileNotFoundError/PermissionError → return '' as the GOOD example; systematic-debugging/test-pressure-{1,2,3}.md:3 "This is a real scenario. You must choose and act." are RED-phase fixtures; git check-ignore: .superpowers, .worktrees, worktrees, writing-plans/diagrams all NOT ignored — a brainstorm session left ?? .superpowers/ in a scratch repo carrying this .gitignore, and scripts/mac/run-requests.mjs:79 samples git status --porcelain for provenance.workingTreeClean. VENDORED.md inventory re-derived: 26 tracked dirs, 12 first-party rows, 14 vendored / 51 files, MIT notice intact, one vendoring commit (957f310); upstream byte-identity UNVERIFIED (api.github.com 403 through the proxy). after: VENDORED.md ## Overrides (one row per site, the repo rule that replaces it; the "Not reviewed line by line" caveat now dated as read), the producers gitignored, two gates (below)
  gate check-skill-instruction-conflicts: every bash/sh/shell/console fence line and every inline span under .claude/skills judged by INVOKING the hook (stdin JSON as Claude Code sends it; the hook exits 0 even when it denies — the verdict is hookSpecificOutput.permissionDecision on stdout, so a non-zero exit or unparseable stdout is FATAL); two live capability probes (one command it must deny, one it must allow) before every scan so a neutered hook cannot go green; a span in a paragraph carrying never/don't/forbidden/hazard/banned/deny/refuse/must not/ask-first is a MENTION, judged and REPORTED, never gated (14 today, all documentation of the deny list itself); Overrides rows exempt by exact site or range. Live: 73 files, 1066 candidates, 3 denied — the two the read named (finishing-a-development-branch:156 git branch -D, subagent-driven-development:483 rm -rf) plus one the read had not: brainstorming/scripts/stop-server.sh:114 rm -rf "$SESSION_DIR", inside a script the hook can never see (it judges `bash stop-server.sh`), guarded by [[ "$SESSION_DIR" == /tmp/* ]] on :113 → its own Overrides row recording that a person read the guard; after: 3 overridden, 0 denied, passed. self-test 13/13 including a plant into a REAL skill (3 → 4 findings) and an unexecutable hook → FATAL. Floors 20 files / 200 candidates. ~25 s
  gate check-gitignore-producers: git check-ignore reads .git/info/exclude and core.excludesFile and has no flag to restrict its sources (--no-index is about the index — verified: an info/exclude entry still matched under it), so the gate builds a pristine git harness (info/exclude truncated, a local empty excludesFile, the 7 tracked .gitignore files copied in) and asks real git; before the .gitignore edit 0/31 ignored (including .claude/worktrees/, ignored here only by this machine's info/exclude), after 30/30; each listed producer cites the vendored file:line that writes it and the gate is FATAL if that line no longer carries the text; the 26 diagrams/ probes are derived from git ls-files .claude/skills. self-test 10/10 (each producer's rule removed in turn, exactly that producer flagged). No tracked file shadowed by the new rules
  registered: preflight (six entries: rendered assets + self-test, skill instruction conflicts + self-test, gitignore producers + self-test) and review-hub-ci.yml; parity 342 preflight gates, 0 unwired; scripts typecheck exit 0
docs/company (read; fixes are Batch X): 9/9 files, every re-derivable figure re-derived — 42 duties, the gated proof-script figure, 164 roles, 21 divisions, 17/23 founder-alone + 4 mechanical + 2 nobody, 7 fractional, brief line counts 79/74/102/127, domain dimensions 9/15/10/6/5/6, every cited pnpm script resolves; twelve defects across 24 sites (INVESTOR_ONE_PAGER:57 "in flight"/"live" over an empty outreach-log and 0 of 15 conversations; FUNDING_READINESS:31-32 "first sends Monday" 2026-08-24 with none logged; iam verified 2 / 5 / 15 across the folder; "No cost or billing figure appears in this repository" at three sites vs Pricing.tsx $8/$14 and COST_MODEL.md — the 2026-08-21 lens review already named the line; "47 deferred families" (48 families, 47 gates, 56 steps); "no lint rule yet" for raw fonts; FreeRADIUS "end-to-end"; "no cost model exists yet" ×2 with COST_MODEL.md in the tree — check:absence INCONCLUSIVE, matches read, refuted; ROLE_CATALOG:30-32 "no hiring sequence has been published" beside a ratified one; v4/174 vs v5/180); structural: docs/company sits outside every buyer-facing derivation of check-launch-claims, and ROLE_LENS_REVIEW's 192 unbackticked path:line citations are invisible to check-cited-paths (3 dead, 3 drifted onto other content). Recorded in the scratchpad findings file; no deferred noun presented as current; no fail-open role instruction
artifacts/signalgrid-app (read; fixes are Batch W): 41/65 in full, 19 vendored ui/* by status-word and clock grep (0 hits), 5 not read; a first render harness primed react-query's error cache under renderToString and reported four false positives — thrown away for a controlled useQuery stand-in with positive and negative controls; then live HTTP against a built api-server. {!q.data && "Loading…"} renders a SETTLED error as pending at AppResilience:65, SignalSourcing:87, GridConfig:85, Provisioning:79/:148, GridOverview:83-88, AppWorkflows:90, Dashboard:190-192 — the fix Batch D made in Intelligence.tsx:85/147/185 never reached its siblings; under SIGNALGRID_PRODUCT_PROFILE=shared-device-gateway every /api/cp/v1/* is 404 (routes/index.ts:58-60) so every Build-the-grid page spins forever; AppResilience's "Blocked · escalate" card is gated on fleet?.apps ?? [] and disappears when the control plane is unreachable; Dashboard:140-149 buckets the served 149 integrations by three literals — connected 59, degraded 2, DOWN 0 (disconnected never emitted), 88 not-configured in no tile and no alert; Fleet:190 sp && sp.updateAvailable renders a failed sync read as no drift (A/B on one node); Fleet:153-158 "signed" from the presence of a signature string; DecisionDetail:180 one neutral badge for fresh/missing/unknown/stale/expired — live nurse.stale decision: seven stale rows reading compliant/true/verified; PolicyDetail:33-35 "Policy not found." on a failed list read; StatusBadge:40-42 disconnected → "Not Configured"; AppWorkflows:124 unknown mode → amber assist; /overview (the only live /v1 trigger) reachable from no nav and the one non-launch route without preview(). Clean: no client-side verdict; check-console-routes green (34 targets / 78 routes); no clock/random in a decision path; format.ts guards NaN dates correctly
records: EVIDENCE (this), LOOP, ledger (docs/lab, docs/preview, docs/assets, .claude/skills → surface; docs/company and artifacts/signalgrid-app → surface with the open counts their batches owe), coverage page
```
Verdict:  **the pattern of this round is a fix that stopped one file short of its siblings — and a gate whose scope never included the file type the defect lived in.** The eyebrow was struck from two HTML sources and lives on in the two images that actually travel; the error-state fix landed in one console page and seven siblings still say "Loading…" over a dead control plane; the synthetic-data disclosure reached the teaser and not the OG card; the SVG's prose was handed to a scan that could not open an SVG. Each is now held by a rule over a derived scope rather than by the memory of the person who made the first fix. The two findings with the widest blast radius were not in code: the orchestration skill every role inherits had lost the owner from the top of its authority ladder in a renumbering that said nothing about it, and a vendored server was reporting to a third-party host from every brainstorm page. What this round did not do: fix the console or the company docs — both reads are complete, recorded, and owed by their own batches, and the ledger says so with the open counts.

## 2026-09-06 — "Twenty-first round: the console's fourteen fail-open shapes fixed and gated — a dead control plane no longer reads as 'Loading…', a health card no longer hides the unconfigured majority, and a route nobody could reach is in the nav"
Command:  the twentieth round's console findings applied (fixes by a general-purpose agent working from the findings file; four gates by the gate engineer), every fix spot-read firsthand, every gate proven against the committed pre-fix console, not only against fixtures:
```
pnpm --filter @workspace/signalgrid-app run typecheck
node scripts/check-console-error-states.mjs ; --self-test ; --scan <git archive HEAD of the pre-fix src>
node scripts/check-console-enum-coverage.mjs ; --self-test ; --scan <pre-fix>
node scripts/check-console-routes-reachable.mjs ; --self-test ; --scan <pre-fix>
node scripts/check-console-launch-families.mjs ; --self-test
node scripts/check-console-routes.mjs ; node scripts/check-dead-nav.mjs ; node scripts/check-preflight-ci-parity.mjs
```
Output:
```
fixes (18 files under artifacts/signalgrid-app/src): every {!q.data && "Loading…"} site renders `q.isError ? "<surface> unavailable — the control plane did not answer" : "Loading…"` — AppResilience:65, SignalSourcing:87, GridConfig:40 ("Validating…", the ninth site the read had not named; the gate found it) and :85, Provisioning:79 and :148, GridOverview:83-88 (a `failed[]` derived from the five queries' isError renders a red "Grid status unavailable … nothing here reads as clear until every surface answers" arm before any loading word), AppWorkflows:90, Dashboard:190-192, and the Dashboard chart ("Decision series unavailable" instead of "Loading chart..." forever); AppResilience renders a red "Resilience posture unreadable — treat every app as blocked until the control plane answers" card on isError instead of the empty list the `fleet?.apps ?? []` fallback produced; Dashboard imports IntegrationHealthStatus (re-exported from lib/api-zod's generated enum) and buckets through `HEALTH_BUCKET: Record<IntegrationHealthStatus, …>` — exhaustive by construction — with tiles for every member (NOT CONFIGURED added), the alert list `status !== "connected"` sorted worst first with a "+N more not connected" line; Intelligence recommendations `recs.data ? String(n) : "-"`; SignalList and IntegrationList destructure isError and render "FEED UNAVAILABLE" / "Integrations unavailable" ahead of any zero; IntegrationList's header now says what its green tile counts ("N OF M MARKED CONNECTED IN THE FIXTURE · NO LIVE VENDOR CONNECTION"); Fleet drift three-way (`sp === undefined` → amber "target unread", updateAvailable → amber "v7 → v8", else muted) with sync.error and bundles.error surfaced; "bundle v7 · signed" → "signature present" in a neutral tone with a title saying not verified by this console; DecisionDetail exports FRESHNESS_TONE mirroring lib/signalgrid-core/src/evidence.ts:551-557 (fresh → allow tone; missing/unknown → anomalous; stale/expired → deny; off-union → deny); PolicyDetail's isError arm ("Policies unreadable") precedes "Policy not found"; StatusBadge gives disconnected its own "Disconnected" danger label; AppWorkflows `MODE_STYLE: Record<mode, …>` with hold → blocked and a `?? "blocked"` runtime fallback; Audit renders "chain unverified — audit read failed" on error instead of nothing; Fleet statusStyle()/verticalLabel() fall back (UNKNOWN (<raw>) / raw) instead of throwing or printing undefined; SystemHealth's Approve reads "route not served" with PolicyCreate's amber notice; IntegrationDetail carries SignalList's visible deferred-categories paragraph; not-found.tsx loses the scaffold copy; App.tsx wraps /overview in preview(); AppLayout's PREVIEW_NAV gains /overview and /policies/new (fixture previews, not launch screens)
typecheck: `tsc -p tsconfig.json --noEmit` exit 0
gate check-console-error-states — binds each pending conditional to its QUERY object, not the component (a loose "isError anywhere in the component" rule would have cleared the pre-fix Dashboard, which contains `i.status === "connected"`); accepts the GridOverview `.filter(([q]) => q.isError)` arm; deliberately does NOT judge deeper property paths (`seriesData?.series ? … : "Loading chart..."` — fixed by hand this round, the shape stays unjudged and is said so in the header); floors 30 files / 25 bindings / 30 pending-word sites, none on conditionals judged (the correct fix removes the .data test and drives that number down). Against the committed pre-fix console: 9 sites flagged, exit 1 (the eight the read named + GridConfig.tsx:40); live: 47 files, 37 query bindings, 16 conditionals, 0 flagged, passed; self-test 11 shapes
gate check-console-enum-coverage — members derived from lib/api-zod/src/generated/types/integrationHealthStatus.ts (4); pre-fix: `Dashboard.tsx never names the "not-configured" member`, exit 1; live passed; REPORTS (never gates) that the bucket table is bound as Record<IntegrationHealthStatus, …>; self-test 7 shapes
gate check-console-routes-reachable — launch set is a CLOSURE (prefix, same-component identity, links out of a launch page's own file), not LAUNCH_NAV membership, which would flag /, /audit, /status, /connectors/setup, /decisions*; property (b) one-directional (fails an unwrapped non-launch route, never a launch route); allowlist entries carry a staleness check — the engineer's own "/ is unlinked by construction" entry was refuted at once by not-found.tsx's link to / and deleted; one entry remains, /sessions/:param, which nothing links (every link goes through the /decisions/:id alias — recorded, not hidden). Pre-fix: /overview and /policies/new unreachable, /overview unwrapped (and / unreachable, since the not-found link came with the fix), exit 1; live: 25 routes, 24 targets, passed; self-test 9 shapes
gate check-console-launch-families — LAUNCH_FAMILIES (3) vs the launch arm of SURFACES connector-families (3), both directions; a copy with device-management-health swapped for custody-beacon fails both ways; live passed; self-test 5 shapes
existing gates after: check-console-routes 34 targets / 78 served routes passed; check-dead-nav 3 declarations passed; parity: every preflight gate wired (eight new entries)
still open on this surface, recorded in the ledger (open 3): connector `status` (healthy|degraded|never_synced) rendered nowhere in ConnectorSetup or the Dashboard family cards — latent, every fixture connector is healthy today; the Toaster mounted with no caller; the CATEGORY_ORDER hand list (complete today); plus the /sessions/:id canonical path nothing links to
```
Verdict:  **a settled error is not a pending state, and a card that buckets by three literals of a four-member enum is a card that reports the majority of the estate as nothing.** The eight sites the read named were one fix that stopped at one file in Batch D; the gate that now holds them found a ninth the read had missed, and its rule had to bind to the query object rather than the component because the loosest reading of the specification would have cleared the very site it was written for. The honest arms are explicit: "unavailable", "unreadable", "target unread", "signature present", "chain unverified" — each one the answer the console used to paint as pending, empty, current, signed or verified. What this round did not do: render the pages against a dead backend (the fixes are proven by type and by the gates over the source, not by pixels), and the four open items above stay open and named.
