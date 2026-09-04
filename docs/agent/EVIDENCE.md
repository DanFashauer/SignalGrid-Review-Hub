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
