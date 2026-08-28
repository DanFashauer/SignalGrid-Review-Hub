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
into one decision. These are the dimensions a policy rule can
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

### The 17 normalized signal categories

The connector layer normalizes source data into exactly **17 signal categories**
that feed the evidence above:

`identity_state`, `device_compliance`, `device_management`, `device_encryption`,
`os_support`, `posture_freshness`, `custody_state`, `charge_state`,
`battery_health`, `tamper_state`, `dock_state`, `security_baseline`,
`benchmark_selection`, `shift_context`, `badge_binding`,
`device_management_health`, `local_authority`.

The last two were added when the 2026-08-10 full-repo scan found the core could
not represent two of its three LAUNCH families — they existed as connectors,
proofs and doctrine while the engine had no vocabulary for them. Both ship with
active v1 rules that match only the AFFIRMATIVE bad state (`broken`, `withheld`);
silence stays quiet, so a fleet not yet emitting either signal sees no change.

**Declared divergence:** these two categories are evaluated by the SERVED core
(`/v1`) only. The demo simulator engine and its byte-faithful iOS port have no
vocabulary for them yet, so a device affirmatively reporting a broken management
plane is restricted by `/v1` while an on-device demo evaluation would not react.
Day-one-quiet bounds the exposure (no emitted signal, no divergence), and
`scripts/check-decision-port-parity.mjs` pins the gap in both directions — the
declaration goes stale loudly if either side changes. Porting the categories to
the simulator + Swift mirror is Mac-lane work, tracked in the backlog.

This count is DERIVED, not maintained by hand. `SIGNAL_CATEGORIES` in
`lib/signalgrid-core/src/types.ts` is a const array and the `SignalCategory` union
is derived from it, so `pnpm run proof:signalgrid-core` emits the real number and
`scripts/check-proof-figures.mjs` fails this document if it drifts. It previously
said 13 — omitting `benchmark_selection` and `shift_context`, both of which ship
active v1 policy rules — because nothing could check it.

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

- **Every signal in every proof, demo and default run is a synthetic,
  public-safe fixture.** No live vendor call happens by default, and none can
  happen without deliberate configuration.
- Live vendor transports DO EXIST in this repository and are gated off, which is
  a different statement from "there is no such code". `lib/integrations/.../graph/`
  ships a real Microsoft Graph transport; a live call requires ALL of
  `SIGNALGRID_TIER` in {beta, prod}, `SIGNALGRID_LIVE_INTEGRATIONS=true`, and a
  credential — each checked independently, so removing any one falls back to
  fixtures. `scripts/cutover/03-protect-and-environments.sh` sets that flag for
  the beta and prod environments, so the gate is a real switch rather than dead
  code. An earlier version of this line claimed no such call was made "anywhere
  in this repository", which a reader would reasonably have taken as a statement
  about the code rather than about the default configuration.
- **Source-agnostic by construction (owner-directed, 2026-08-11).** SignalGrid
  is not an MDM — it is the trust layer that reads MDM, identity, device,
  workflow, and local-authority evidence to decide whether work should
  continue. Device-management evidence enters through one adapter contract
  (`DeviceManagementEvidence` in `lib/integration-bridge`), so the decision
  engine never learns which vendor produced a reading: open-source MDM gives
  SignalGrid a low-cost lab (Fleet today, plus a Headwind-shaped Android
  fixture), and Microsoft Intune is the first enterprise production connector —
  swapped in without changing the engine. `proof:evidence-adapter` enforces the
  swap: the same device states through the fleet, headwind, and intune adapters
  must produce identical decisions, with provenance the only difference. No
  source system is replaced by any of this; each remains the system of record,
  and adapters supply evidence only.
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
  (Session / shift context was listed here and has been removed: it is evaluated
  today, with an active v1 `shift-context-misfit` step-up rule in `policy.ts`.)
- **Operational signals** (SIEM / SOAR / ITSM / monitoring state) — candidate.
- **RTLS / precise indoor location** — candidate.
- The **broader integration catalog** (~149 candidate sources across ~16
  categories in the catalog taxonomy) — these are *candidate signal-source
  categories*, distinct from the 15 categories the core normalizes today, and
  none is a live integration.
- **Cross-platform app shells** (React Native / Expo, Tauri / Electron) — not
  built; responsive web + PWA is the cross-platform delivery. This is NOT a
  statement about native iOS: `native/ios/` ships two real Xcode targets,
  EnterpriseShell (the kiosk-until-auth shell carrying the Assist gate) and <!-- framing:mechanism -->
  SignalGridMobile, merged via PRs #107/#125/#128 and built in CI. They are
  simulator-verified; no MDM-enrolled hardware evidence exists.
- **Certifications / authorizations** (SOC 2, FedRAMP, CMMC, STIG, EAL, FIPS) —
  design targets and signal mappings only; nothing is certified or authorized.

## The two demo lineages (so numbers reconcile)

The repo intentionally has two surfaces that must not be conflated:

1. **Product-core lineage** — `@workspace/signalgrid-core` and the Review Hub's
   Operator Console / Worker Self-Service run the real, deterministic decision
   loop with the 15 categories and 4 outcomes above. This is the truth.
2. **Catalog / app-shell lineage** — the `/api/integrations` catalog (~149
   candidate sources, ~16 taxonomy categories) and the platform app shells
   (`signalgrid-app`, `-desktop`, `-mobile-pwa`) illustrate the broader vision
   and per-platform chrome. Their counts describe the *candidate catalog*, not
   what the core evaluates.

When a surface shows "16 categories" or "~149 sources," it means the candidate
catalog taxonomy — not the 15 categories the core evaluates. When it shows the
signal dimensions a decision actually uses, it means the five evaluated-today
dimensions above.

## How to verify

- `pnpm run proof:signalgrid-core` — 239 assertions over the real core: outcomes,
  fail-closed, tenant isolation, RBAC, tamper-evidence, determinism, the
  security-baseline dimension, the badge-binding (reader case) dimension, the
  dock/SmartDock hardware-state dimension, and untrusted-input hardening.
- `pnpm run test:api` — the `/v1` HTTP surface end to end.
- `pnpm run bench:decision-latency` — the decision-latency gate.
- `pnpm run bench:decision-throughput` — sustained decisions/sec on one core and
  under saturation (one worker per core). The rates are hardware-specific and
  report-only; what it gates is a throughput floor derived from the latency gate,
  no collapse when cores are added, and identical verdicts on every thread. It
  measures the decision core alone — no HTTP, connector or database.

## Non-claims

SignalGrid is a pre-announcement, fixture-backed review artifact. It is not
production-ready, not certified/authorized/compliant, does not replace any
existing IAM / MDM / UEM / EDR / SIEM / ITSM system (those remain systems of
record), makes no partnership claims, and performs no autonomous remediation on
production systems (high-risk actions stay approval-gated and simulated).
