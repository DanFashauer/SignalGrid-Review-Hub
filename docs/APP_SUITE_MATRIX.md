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
| **iOS** | `signalgrid-mobile-pwa` (installable PWA, operator/support triage; **Access support** tab) | Embedded in the worker's host app — no SignalGrid worker screen (reference: [`embedded-host-app-demo.html`](embedded-host-app-demo.html)). Native reference host shell: `native/ios/EnterpriseShell` (Swift, kiosk-until-auth + Assist gate; CI builds for the simulator, no `.ipa`) |
| **Android** | `signalgrid-mobile-pwa` (same PWA) | Embedded in the worker's host app — no SignalGrid worker screen. Native reference host shell: `native/android` (Kotlin/Compose, fixture decision, no transport; CI builds an unsigned debug APK) |
| **macOS** | `signalgrid-desktop` (desktop-chromed operator console + ITSM hand-off) | Embedded in the worker's host app (reference: [`embedded-desktop-demo.html`](embedded-desktop-demo.html)). No native macOS build exists |
| **Windows** | `signalgrid-desktop` (same desktop shell) | Embedded in the worker's host app (reference: [`embedded-desktop-demo.html`](embedded-desktop-demo.html)). Native reference host shell: `native/desktop` (Tauri/Rust, fixture decision, no transport; CI builds an unsigned executable) |
| **Linux** | — (no administrative surface is targeted) | Native reference host shell: `native/desktop` (same Tauri shell, same CI claim as Windows). Not one of the five target platforms; listed because the tree builds for it |

Notes:

- **Web / PWA first.** Every surface above is responsive web or an installable
  PWA today. The mobile surfaces are delivered as a PWA (installable on iOS and
  Android home screens); the desktop surface is a desktop-chromed web app for the
  macOS/Windows operator.
- **Native code exists; SHIPPING a native product is not claimed.** ~~Nothing in
  this repo ships a native binary, and none is claimed.~~ That sentence outlived
  the tree: `native/ios` (Swift), `native/android` (Kotlin), `native/desktop`
  (Tauri/Rust) and `firmware/dock` (Rust) all build in CI today — the exact
  artifact each build produces, and what it is NOT (no signing, no store, no
  installer), is the table below in this document. The honest distinction is
  build-vs-ship: CI proves the native code compiles and passes its tests; no
  signed, distributable native product is claimed. [Mobile & Platform
  Strategy](MOBILE_AND_PLATFORM_STRATEGY.md) still governs when shipping becomes
  the goal.
- **Admin actions stay constrained.** Administrative surfaces expose read/monitor
  plus explicitly approval-gated actions (e.g. remediation approval, ITSM
  hand-off). High-risk actions are simulated and logged, never autonomous.

## Persona responsibilities

**Administrative (operator / security admin)** — monitor the decision stream,
inspect evidence (including custody and the security-baseline/CIS dimension),
run the policy lab (v1 vs v2), review the tamper-evident audit ledger, and
approve simulated remediations. Homes: `signalgrid-app` (Web),
`signalgrid-desktop` (macOS/Windows), `signalgrid-review` Operator Console.

**End-user (frontline worker)** — start a session and see the outcome resolve in
plain language, with the resolution (refresh posture, return/dock the device,
re-badge, or **re-apply the security baseline** when a device has drifted)
happening **inside the worker's own host app**, not a SignalGrid screen. Per
[the embedded-UX design law](EMBEDDED_UX_PRINCIPLE.md) the worker never opens a
SignalGrid app; the reference demonstrations of this embedded flow are
[`embedded-host-app-demo.html`](embedded-host-app-demo.html) (mobile) and
[`embedded-desktop-demo.html`](embedded-desktop-demo.html) (macOS/Windows). The
`signalgrid-mobile-pwa` **Access support** tab is the operator/support-side
window into these worker sessions — it relays guidance, it is not a worker
destination. `signalgrid-review` Worker Self-Service (Web) remains a core-driven
demonstration of the worker's plain-language view.

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
- **No signed, installable, or store-published binary exists for any platform.** This
  bullet used to say no native binary was "shipped or claimed", and that has become
  imprecise rather than wrong, so here is the current state exactly:

  | Platform | What CI actually produces | What it is not |
  | --- | --- | --- |
  | Android | an **unsigned debug APK** (`.github/workflows/android.yml`) | not release-signed, not on Play |
  | Windows / Linux | an **unsigned executable** (`.github/workflows/desktop.yml`) | not an installer, not code-signed, no auto-update |
  | iOS / iPadOS | a simulator build + tests (`ios-ci.yml`) | no `.ipa`, no provisioning profile, not on the App Store |
  | macOS | a native SwiftPM build + tests of the decision port | no `.app`, no notarisation |

  These are build artifacts attached to a CI run so that "it builds" can be checked by
  running the thing. Distribution, signing and notarisation are untouched. The
  cross-platform *delivery* story remains responsive web + PWA.
- Administrative high-risk actions are approval-gated and simulated, with no autonomous production remediation.
