# Security-Baseline Alignment (CIS and other hardening baselines)

**Public-safe. Fixture-backed. No scan is performed and no certification is
claimed.** This document describes how SignalGrid keeps decisions aligned with
recognized security baselines — CIS Benchmarks and CIS Controls v8 first, plus
the other endpoint-hardening standards operators already run — by consuming a
**baseline-posture signal** as a first-class input to the runtime decision.

SignalGrid does **not** replace a hardening/benchmark scanner, an MDM/UEM, an
EDR, or a compliance-management platform, and it does not itself assess a device
against a benchmark. It *consumes* the alignment result those tools already
produce and turns it into an allow / step-up / restrict / deny decision at the
moment a worker starts a session.

## Why baselines belong in the decision, not just a report

A CIS Benchmark or DISA STIG tells you a device's hardening state *as of the last
scan*. That result usually lives in a compliance dashboard nobody reads at the
point of access. SignalGrid moves it to where it changes behavior: the runtime
decision. Two operational wins follow, and both were the point of this work:

- **More effective workflows.** When a device is *aligned* to its baseline, that
  is one more piece of positive trust evidence, so a session proceeds with less
  friction. When a device has *drifted*, the worker is stepped up or routed to a
  one-tap self-service fix instead of being silently allowed onto a degraded
  endpoint or hard-blocked with no path forward.
- **Better endpoint performance/health.** Baseline drift is frequently the
  early symptom of a misconfigured, unpatched, or tampered endpoint. Catching it
  at access time — and routing a *re-apply the hardening profile* action — keeps
  the fleet closer to its known-good configuration, which is exactly the state
  in which endpoints run predictably.

## The baseline-posture signal in the core

The public core models baseline alignment as a normalized signal and an evidence
dimension, exactly like device compliance or posture freshness:

| Piece | Where | Values |
| ----- | ----- | ------ |
| Signal category | `SignalCategory = "security_baseline"` (`lib/signalgrid-core/src/types.ts`) | one of the states below |
| Evidence field | `DecisionEvidence.baselineCompliance` (`BaselineState`) | `aligned`, `partial`, `drifted`, `not_assessed`, `unknown` |
| Rule condition | `{ field: "baselineState"; in: BaselineState[] }` | tested by a policy rule |

`BaselineState` is **vendor-neutral and fail-safe**:

| State | Meaning |
| ----- | ------- |
| `aligned` | Meets the device's assigned baseline profile. |
| `partial` | Minor, non-critical control drift. |
| `drifted` | Material drift — hardening regressed from the baseline. |
| `not_assessed` | No baseline scan on record for this device yet. |
| `unknown` | State could not be determined. **Never treated as aligned.** |

Since the benchmark-selection dimension shipped, the QUESTION behind this answer
is graded too: `DecisionEvidence.benchmarkSelection` records whether the result
came from the right benchmark document at a current version, from CIS's own
content, on the right platform, with real coverage — and the `benchmark-selection-misfit`
rule steps a session up when it affirmatively did not, whatever the alignment
answer says. See [Benchmark selection](BENCHMARK_SELECTION.md).

A source that reports no baseline normalizes to `unknown`, and `unknown` never
fabricates a healthy state and never, by itself, blocks a session — a device
that has simply never been scanned is not penalized by the baseline rule. This
is the same fail-safe rule the rest of the evidence model follows: absence adds
no conclusion, it does not invent one.

### How it flows through the decision loop

```
posture source (reports baseline result)
  → fixture connector sync normalizes a `security_baseline` signal
  → buildEvidence() derives evidence.baselineCompliance
  → policy rule `baseline-drifted` fires on `drifted`
  → most-restrictive outcome combines it with identity/device/custody signals
  → decision + tamper-evident evidence snapshot record the baseline state
  → Resolution Assistant routes a self-service "re-apply the hardening profile"
```

The baseline rule ships in the shared-device baseline policy:

| Rule | Condition | v1 outcome | v2 (stricter) | Reason code |
| ---- | --------- | ---------- | ------------- | ----------- |
| Baseline drift | `baselineState = drifted` | `step_up` | `restrict` | `BASELINE_DRIFTED` / `BASELINE_DRIFTED_STRICT` |

Because the engine takes the most-restrictive firing outcome, a device that is
otherwise healthy but has drifted from its baseline is stepped up (v1) or
restricted (v2) — the hardening state changes the runtime decision. Resolution
of a drift is **self-service and simulated**: return/reconnect the device so the
hardening profile re-applies, then re-evaluate. Nothing is executed on a source
system; SignalGrid records and simulates.

## Baseline frameworks this maps to

SignalGrid is baseline-*source-neutral*: any tool that emits an
alignment/benchmark result can feed the `security_baseline` signal. The mapping
is intentionally broad so operators can use the baseline they already run.

| Framework / service | What it produces | How SignalGrid consumes it |
| ------------------- | ---------------- | -------------------------- |
| **CIS Benchmarks** (Windows, macOS, iOS/iPadOS, Linux, mobile) | Per-platform device-hardening pass/fail against a benchmark profile | Benchmark result → `aligned` / `partial` / `drifted` |
| **CIS Controls v8** (IG1–IG3 safeguards) | Org-level control coverage (e.g. secure configuration, control 4) | Maps to the assigned per-device baseline profile |
| **Microsoft Security Baselines / Intune** | Baseline profile assignment + compliance in Intune | Compliance/baseline state → `security_baseline` signal via the (fixture) Entra/Intune connector |
| **Apple platform security / Jamf** | macOS/iOS configuration & hardening state | Same normalization path (documented, not exercised here) |
| **DISA STIG + SCAP / XCCDF / OVAL** | STIG checklist compliance, CAT I/II/III findings | Checklist state → `aligned` / `drifted`; severity informs strictness |
| **NIST SP 800-53 Rev 5 / 800-171** | Control-family coverage (e.g. CM-6 configuration settings) | Configuration-management controls map to the baseline dimension |

These are **mappings, not certifications.** SignalGrid does not assert it is
STIG-hardened, CIS-certified, FedRAMP/CMMC-authorized, or a benchmark scanner. It
consumes a baseline result and makes an access decision with it.

## Where to see it

- **Proof:** `pnpm run proof:signalgrid-core` includes baseline drift → step-up,
  aligned baseline recorded in the evidence snapshot, drift → restrict under v2,
  self-service resolution back to allow, `unknown` baseline not blocking, and the
  rule-validator accepting `baselineState` while rejecting out-of-domain values.
- **API:** `POST /api/v1/decisions/evaluate` for the drifted device returns
  `step_up` with `BASELINE_DRIFTED`, and `GET /api/v1/decisions/{id}/evidence`
  exposes `evidence.baselineCompliance`. Verified by the `/v1` integration test.
- **Data model:** `docs/PRODUCT_DATA_MODEL.md` (evidence dimensions).
- **Controls:** `docs/SECURITY_CONTROLS_MATRIX.md` (baseline row).

## Non-claims

- SignalGrid does **not** run a CIS/STIG/SCAP scan and does **not** replace a
  benchmark scanner, MDM/UEM, EDR, or GRC platform.
- No compliance, certification, authorization, or partnership is claimed
  (no "CIS certified", "STIG hardened", "FedRAMP authorized", or similar).
- The baseline signal here is deterministic and fixture-backed; the private
  production core would ingest a real baseline result from the operator's own
  posture source under a read-only, least-privilege scope.
- Every baseline-driven remediation is approval-gated and simulated, with no autonomous production remediation — SignalGrid records and simulates.
