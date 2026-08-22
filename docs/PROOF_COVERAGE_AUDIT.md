# SignalGrid-Review-Hub — Proof Coverage Audit

## Executive summary

> **Scope, stated honestly (added 2026-08-22):** this audit covers **28 of the
> proof gates as of 2026-08-03** — the suite has grown well past that since
> (`grep -c '"proof:' package.json` gives the live count), and nothing here
> re-audits gates added after that date. It remains the deepest per-gate
> coverage read the repo has; treat unlisted gates as UNAUDITED, not as fine.


Across 28 per-gate coverage audits, overall proof health is **fair-to-good but uneven**: **12 gates rate strong, 16 moderate, 0 weak**, and **0 gates were formally flagged as rubber-stamps** (`rubber_stamp: false` on all 28). However, the aggregate hides a consistent structural weakness — the moderate gates repeatedly assert only that outputs are *present/non-empty/well-typed* rather than *correct*, and several proofs contain tautological or self-referential assertions (notably `signalgrid-grid`, `microsoft-graph-sandbox`, and `signalgrid-simulator`) that cannot fail regardless of the code under test. The highest concentration of real risk is in **untested fail-closed security branches**: allow-suppression guardrails, hash-chain tamper localization, WebAuthn clone detection, and bundle-signature verification are each exercised only on the happy path or not at all. Several database-backed gates (`*-pg`) also self-skip or verify only `.status`, leaving field-mapping and durability largely unproven.

## Gate coverage

| Gate | Coverage | Rubber-stamp? | What it validates |
|---|---|---|---|
| intune-entra-posture | moderate | No | Inline posture engine routes 11 Intune/Entra device scenarios to correct decision + reason, fail-closed on bad lookups |
| signalgrid-core | strong | No | Decision facade turns fixtures into allow/step_up/restrict/deny with correct reasons; security invariants (tenancy, RBAC, tamper-evidence) |
| api-contract | moderate | No | Every Express `/v1` route is documented in OpenAPI and vice-versa (method+path presence only) |
| webauthn-verify | strong | No | Real ECDSA/ES256 signature + attestation verification with fail-closed rejection of tampered/forged/replayed inputs |
| audit-ledger | moderate | No | Recursive redaction of secret-named fields + SHA-256 hash-chain verify accepts genuine, detects in-place mutation |
| audit-ledger-pg | moderate | No | Live-Postgres hash-chained ledger: persistence, tamper detection, redaction, 25-way concurrent append |
| signalgrid-simulator | moderate | No | 11 fixtures through decisionEngine→routing→audit; a few allow-suppression negatives |
| signalgrid-grid | moderate | No | 11 scenarios × 22 risk mutations for riskScore monotonicity (never checks baseline correctness) |
| microsoft-graph-sandbox | moderate | No | 11 synthetic Graph fixtures through an *inline* decision-mapper to expected decisions |
| connector-emulator | moderate | No | Connector `decide()` maps posture/identity/custody/credential inputs to decision+reason with precedence |
| orchestration | strong | No | `planOrchestration` turns outcome+room context into an Assist-safe action plan (sensitive actions held) |
| app-workflows | strong | No | `planAppSession` maps outcomes to per-action dispositions; "sensitive/critical never auto" invariant |
| app-workflow-templates | strong | No | `lintAppIntegration` fails closed on unsafe configs, each pinned to its error code |
| flows | strong | No | Admin flow layer: health, break resolution, break-glass override gating, monotonic intelligence score |
| recommendations | moderate | No | Advisory engine emits correct recommendation kind per usage pattern with safety guards |
| room-sim | strong | No | Trusted-Entry runner drives real core+orchestration across warehouse/fleet/hospital packs |
| signal-radar | moderate | No | `scanSignals` classifies batches into evaluated/candidate/novel with alerts and deterministic reports |
| control-plane | moderate | No | Six-vertical seeding, per-tenant scoping, signed policy bundles, operational-intelligence rollup |
| edge-sync | strong | No | Cloud→edge distribution: checksum/HMAC verify, two tamper mutations + forged sig fail closed, idempotent apply |
| telemetry-up | moderate | No | Wires decision core to control plane; `aggregateOutcomes` batch tally reflected in fleet-health |
| signal-discovery | strong | No | Signal classification + auto-onboard only when source has an API; no-API gated to admin |
| ddm-connector | strong | No | DDM reports normalize to core dimensions; any weak posture fails closed to step-up |
| decision-store-pg | moderate | No | Live-Postgres decision/evidence round-trip, tenant scoping, digest verification, 20 concurrent saves |
| session-store | strong | No | In-memory session lifecycle with injected time: TTL expiry, refresh, end, tenant scoping |
| session-store-pg | moderate | No | Live-Postgres session lifecycle, (id,tenant) isolation, fresh-instance survival, 20 concurrent starts |
| observability | moderate | No | Built API server serves Prometheus `/metrics`; driven traffic reflected in gauges/counters/histogram |
| enterprise-auth | strong | No | Gated RS256/OIDC authenticator accepts one valid token, fail-closed rejects a broad forged matrix |
| graph-connector | moderate | No | Read-only Graph connector: pagination, enum normalization, owner join, GET-only, typed auth error |

## Highest-value gaps

Ranked by risk-reduction. Each is a concrete test to add.

1. **`signalgrid-core` — reach the `ALLOW_SUPPRESSED_DEGRADED_EVIDENCE` guardrail directly.** The proof's headline fail-closed invariant is dead-code-untested: no allow rule is ungated from `criticalSignalsPresent`, so "allow with degraded critical evidence → suppress to step_up" is never constructed. Build a rule set whose allow rule isn't gated on critical signals, evaluate with `criticalSignalsPresent===false`, and assert suppression + the reason code.

2. **`signalgrid-grid` — assert baseline decision correctness for all 11 scenarios.** Today baseline checks only that `primaryOutcome` is truthy and `reasonCodes.length>0`; if the engine returned `allow` instead of `restrict` for `non-compliant-clinical-device`, the proof still passes. Assert `result.status === "PASS"` (equivalently `outcomes` deep-equals `expectedOutcomes`).

3. **`signalgrid-simulator` — exact-outcome-set assertions + explicit "allow absent" negatives on high-risk scenarios.** The current per-scenario check is a self-referential subset check that never fails on extra/over-permissive outcomes; `edr-security-risk`, `wrong-zone`, and `dock-missing-overdue-device` have no guard against a spurious `allow`. A security regression that trusts a high-risk device currently passes.

4. **`control-plane` — negative bundle signature/checksum test.** `verifyBundleSignature`/`verifyBundleChecksum` are asserted only on a valid bundle, so the fail-closed authenticity guarantee is unproven. Mutate a bundle's workflows (or flip one signature hex char) and assert both return `false`.

5. **`webauthn-verify` — signature-counter clone detection.** The one implemented security guard with zero coverage. Register, authenticate to advance the stored counter to N, then submit a fresh genuinely-signed assertion with `signCount <= N` and assert it is rejected as a possible clone.

6. **`audit-ledger` (and `audit-ledger-pg`) — mid-chain tamper via the prevHash-mismatch branch.** Only the hash-mismatch branch at index 0 is exercised; deletion/reordering/truncation (a core hash-chain tamper mode) is completely untested. Delete/reorder a record in a 3+ record chain and assert `ok:false` with `brokenAtIndex` at the correct non-zero index.

7. **`microsoft-graph-sandbox` — import the real connector instead of the inline oracle, and pin reason codes.** The decision engine is defined inline in the proof, so no shipped code is exercised and expected values are tautological. Import the real Graph decision function, pin `expectedReasonCode` on all 11 cases, and add a multi-condition precedence case (e.g. disabled identity + unavailable health) to prove branch ordering.

8. **`enterprise-auth` — clock-tolerance boundary pair.** `clockToleranceSec: 60` is configured but never exercised; the expired case sits 120s out, so a zeroed/broken tolerance still passes. Add one token ~30s past exp (must ACCEPT) and one ~90s past (must REJECT).

## Rubber-stamp gates

**None were formally flagged** (`rubber_stamp: false` across all 28). That said, three gates contain enough tautological or self-referential assertions to warrant scrutiny in the next review cycle:

- **`signalgrid-grid`** — multiple assertion blocks cannot fail against the code under test: the approval-gate block checks hardcoded local booleans, evidence-integrity checks compare a value to a copy of itself, and malformed-input guards test a validator defined inside the proof file rather than the shipped module. Its genuine value (riskScore monotonicity) is real, but a large fraction of its 880 assertions are structurally incapable of catching a regression.
- **`microsoft-graph-sandbox`** — the oracle is defined inline in the proof; no production Graph connector code is exercised, so expected values are self-referential.
- **`signalgrid-simulator`** — the core per-scenario "PASS" assertion is a subset check against the fixture's own `expectedOutcomes`, and "audit evidence exists" / "routed owner exists" are constant-true tautologies.

These are not rubber stamps in the formal sense (each does validate *some* real behavior), but their assertion counts overstate their protective value.