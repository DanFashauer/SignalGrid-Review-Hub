# What SignalGrid Does Today — Implemented vs Candidate

**This is the canonical source of truth for what the SignalGrid product actually
evaluates and decides today.** Every other surface — the website, the apps, the
Review Hub, and the rest of the docs — must be consistent with this page. If a
surface claims a capability, a number, or a signal type, it has to appear here as
*implemented today* or be clearly marked as *candidate / roadmap*. Full
transparency is the standard: we never present a design intention as a shipped
capability.

Ground truth lives in code: `lib/signalgrid-core/src/types.ts`
(`SignalCategory`, `DecisionEvidence`, `DecisionOutcome`) and is enforced by
`pnpm run proof:signalgrid-core`.

## What the deterministic core evaluates today

At the moment a workflow fires, the core fuses the following normalized evidence
into one decision. These — and only these — are the dimensions a policy rule can
test today:

| Evidence dimension | What it captures |
| ------------------ | ---------------- |
| Identity state | enabled / disabled / unknown |
| Device managed | under management / not / unknown |
| Device compliance | compliant / non-compliant / unknown |
| Device encryption | encrypted / not / unknown |
| OS support | supported / not / unknown |
| Posture freshness | fresh / stale / expired / missing / unknown |
| Device owner type | corporate / personal / shared / unknown |
| Workflow risk tier | low / standard / elevated / critical |
| Custody state (DockBridge) | checked_in / checked_out / overdue / exception / maintenance / unknown |
| Charge state (DockBridge) | charging / charged / low / critical / not_present / unknown |
| Tamper state (DockBridge) | none / suspected / confirmed / sensor_unavailable / unknown |
| Dock state (DockBridge / SmartDock) | occupied / empty / reserved / faulted / offline / unknown — a faulted or offline dock can't vouch for custody |
| Security baseline (CIS) | aligned / partial / drifted / not_assessed / unknown |
| Badge binding (reader case) | present / removed / forced / absent / unknown — who is bound to the shared device right now |
| Critical signals present | derived fail-closed gate — `allow` is suppressed when a critical input is degraded |

### The 13 normalized signal categories

The connector layer normalizes source data into exactly **13 signal categories**
that feed the evidence above:

`identity_state`, `device_compliance`, `device_management`, `device_encryption`,
`os_support`, `posture_freshness`, `custody_state`, `charge_state`,
`battery_health`, `tamper_state`, `dock_state`, `security_baseline`,
`badge_binding`.

### The four outcomes

Every decision is one of: **allow · step-up · restrict · deny**. The engine takes
the most-restrictive firing rule and fails closed (never a silent `allow` on
degraded critical evidence).

### Grouped for humans: the signal dimensions we evaluate today

The website groups these into five **evaluated-today** dimensions:

1. **Identity state** — identity enabled/disabled/unknown.
2. **Device posture** — managed, compliant, encrypted, OS-supported, fresh.
3. **Physical custody (DockBridge / SmartDock)** — custody, charge, tamper, and
   the dock's own hardware state from dock/case hardware. The optional embedded
   [SmartDock](SIGNALGRID_SMARTDOCK.md) is a dedicated ingestion path for these
   signals; a faulted or offline dock changes the runtime decision.
4. **Security baseline (CIS)** — CIS/hardening alignment; drift steps up or
   restricts.
5. **Badge binding (reader case)** — who is physically bound to the shared
   device right now. A badge pulled from the reader case restricts the session;
   a forced/torn removal denies. This is the RFID/prox reader case turned into a
   first-class decision signal: the person→shared-device binding the workflow
   depends on.

## What is deterministic and fixture-backed

- No live vendor / Microsoft Graph / Apple / dock-vendor call is made anywhere in
  this repository. Every signal is a synthetic, public-safe fixture.
- The core is isomorphic and deterministic (injectable clock; no `Date.now` /
  `Math.random`), so proofs and reviews reproduce the exact same decision,
  evidence snapshot, and audit chain every run.
- Every high-risk action (remediation, baseline re-apply, custody clear) is
  **approval-gated and simulated** — recorded, never executed on a source system.

## What is candidate / roadmap (NOT evaluated by the core today)

These appear in the design, the integration catalog, and the marketing site as
**candidate signal-source categories** or future capabilities. They are *not*
decision inputs in the core today, and any surface that shows them must say so:

- **Network / cellular posture** (Wi-Fi/NAC/eSIM reachability) — candidate.
- **Session / shift context** (shift-window and role-match logic) — candidate.
- **Operational signals** (SIEM / SOAR / ITSM / monitoring state) — candidate.
- **RTLS / precise indoor location** — candidate.
- The **broader integration catalog** (~149 candidate sources across ~16
  categories in the catalog taxonomy) — these are *candidate signal-source
  categories*, distinct from the 12 categories the core normalizes today, and
  none is a live integration.
- **Native app shells** (React Native / Expo, Tauri / Electron) — the current
  cross-platform delivery is responsive web + PWA; native is a documented next
  step.
- **Certifications / authorizations** (SOC 2, FedRAMP, CMMC, STIG, EAL, FIPS) —
  design targets and signal mappings only; nothing is certified or authorized.

## The two demo lineages (so numbers reconcile)

The repo intentionally has two surfaces that must not be conflated:

1. **Product-core lineage** — `@workspace/signalgrid-core` and the Review Hub's
   Operator Console / Worker Self-Service run the real, deterministic decision
   loop with the 12 categories and 4 outcomes above. This is the truth.
2. **Catalog / app-shell lineage** — the `/api/integrations` catalog (~149
   candidate sources, ~16 taxonomy categories) and the platform app shells
   (`signalgrid-app`, `-desktop`, `-mobile-pwa`) illustrate the broader vision
   and per-platform chrome. Their counts describe the *candidate catalog*, not
   what the core evaluates.

When a surface shows "16 categories" or "~149 sources," it means the candidate
catalog taxonomy — not the 12 categories the core evaluates. When it shows the
signal dimensions a decision actually uses, it means the five evaluated-today
dimensions above.

## How to verify

- `pnpm run proof:signalgrid-core` — 166 assertions over the real core: outcomes,
  fail-closed, tenant isolation, RBAC, tamper-evidence, determinism, the
  security-baseline dimension, the badge-binding (reader case) dimension, the
  dock/SmartDock hardware-state dimension, and untrusted-input hardening.
- `pnpm run test:api` — the `/v1` HTTP surface end to end.
- `pnpm run bench:decision-latency` — the decision-latency gate.

## Non-claims

SignalGrid is a pre-announcement, fixture-backed review artifact. It is not
production-ready, not certified/authorized/compliant, does not replace any
existing IAM / MDM / UEM / EDR / SIEM / ITSM system (those remain systems of
record), makes no partnership claims, and performs no autonomous remediation on
production systems (high-risk actions stay approval-gated and simulated).
