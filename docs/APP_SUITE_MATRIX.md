# SignalGrid App Suite — Platform × Persona Matrix

**Public-safe. Review artifacts, not shipping products.** This document maps the
SignalGrid client surfaces across the five target platforms — **iOS, Android,
Web, macOS, Windows** — and the two personas — **administrative** (operator /
security admin) and **end-user** (frontline worker). It is the authoritative
answer to "which app serves which platform and persona," and it is honest about
what is built today (responsive web + PWA) versus what is a documented next step
(native shells).

Companion strategy docs: [Mobile & Platform Strategy](MOBILE_AND_PLATFORM_STRATEGY.md),
[App Suite Plan](SIGNALGRID_APP_SUITE_PLAN.md).

## Two data lineages (important)

The suite has two intentionally-separate demo lineages:

1. **Product-core lineage** — [`signalgrid-review`](../artifacts/signalgrid-review)
   runs `@workspace/signalgrid-core` **in-browser** (no server), so it exercises
   the real, deterministic decision loop: tenancy, policy, evidence, audit,
   custody, and the **security-baseline (CIS)** dimension. It hosts both personas
   as live sub-surfaces (Operator Console + Worker Self-Service).
2. **App-shell lineage** — [`signalgrid-app`](../artifacts/signalgrid-app),
   [`signalgrid-desktop`](../artifacts/signalgrid-desktop), and
   [`signalgrid-mobile-pwa`](../artifacts/signalgrid-mobile-pwa) are
   platform-framed React apps that call the API via the generated
   `@workspace/api-client-react` client. They demonstrate the per-platform app
   chrome and navigation for the administrative/operator persona.

The public marketing site [`signalgrid-web`](../artifacts/signalgrid-web) is a
static product/website surface (Home, Hardware, Pricing, Federal, Downloads), not
a persona app.

## Platform × persona coverage (today)

| Platform | Administrative surface | End-user (frontline worker) surface |
| -------- | ---------------------- | ----------------------------------- |
| **Web** | `signalgrid-app` (responsive admin console: dashboard, decisions, policies, signals, integrations) + `signalgrid-review` Operator Console (core-driven) | `signalgrid-review` Worker Self-Service (core-driven: outcome + plain-language reason + self-service steps) |
| **iOS** | `signalgrid-mobile-pwa` (installable PWA, operator triage) | `signalgrid-mobile-pwa` **My Access** worker surface (session start → outcome → self-service) |
| **Android** | `signalgrid-mobile-pwa` (same PWA) | `signalgrid-mobile-pwa` **My Access** worker surface |
| **macOS** | `signalgrid-desktop` (desktop-chromed operator console + ITSM hand-off) | (routes frontline workers to the mobile PWA / kiosk) |
| **Windows** | `signalgrid-desktop` (same desktop shell) | (routes frontline workers to the mobile PWA / kiosk) |

Notes:

- **Web / PWA first.** Every surface above is responsive web or an installable
  PWA today. The mobile surfaces are delivered as a PWA (installable on iOS and
  Android home screens); the desktop surface is a desktop-chromed web app for the
  macOS/Windows operator.
- **Native is the documented next step, not a present claim.** True native shells
  (React Native / Expo for iOS-Android, Tauri / Electron for macOS-Windows) are
  described in [Mobile & Platform Strategy](MOBILE_AND_PLATFORM_STRATEGY.md) as
  the path taken only after the workflows are validated. Nothing in this repo
  ships a native binary, and none is claimed.
- **Admin actions stay constrained.** Administrative surfaces expose read/monitor
  plus explicitly approval-gated actions (e.g. remediation approval, ITSM
  hand-off). High-risk actions are simulated and logged, never autonomous.

## Persona responsibilities

**Administrative (operator / security admin)** — monitor the decision stream,
inspect evidence (including custody and the security-baseline/CIS dimension),
run the policy lab (v1 vs v2), review the tamper-evident audit ledger, and
approve simulated remediations. Homes: `signalgrid-app` (Web),
`signalgrid-desktop` (macOS/Windows), `signalgrid-review` Operator Console.

**End-user (frontline worker)** — start a session, see the outcome in plain
language, and follow the self-service steps to resolve a block (refresh posture,
return/dock the device, re-badge, or **re-apply the security baseline** when a
device has drifted). Homes: `signalgrid-review` Worker Self-Service (Web) and the
`signalgrid-mobile-pwa` **My Access** surface (iOS/Android).

## Where the security-baseline (CIS) dimension shows up

Because the baseline dimension lives in `signalgrid-core`, it is visible in the
core-driven surfaces:

- **Operator Console** — the decision evidence shows a "Security baseline (CIS)"
  row (`aligned` / `drifted`), and the Security-baseline-drift scenario is
  selectable.
- **Worker Self-Service** — a drifted device produces a self-service step to
  return/reconnect so the hardening profile re-applies, then re-evaluate.

See [Security-Baseline Alignment](SECURITY_BASELINE_ALIGNMENT.md) for the model.

## Non-claims

- These are review artifacts, not production apps; nothing here is "available
  now," app-store-published, or production-ready.
- No native iOS/Android/macOS/Windows binary is shipped or claimed; the current
  cross-platform delivery is responsive web + PWA.
- Administrative high-risk actions are approval-gated and simulated, with no autonomous production remediation.
