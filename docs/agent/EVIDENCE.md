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
