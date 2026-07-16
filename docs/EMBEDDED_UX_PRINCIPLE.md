# Design law: SignalGrid is invisible to end users

**The end user never interacts with SignalGrid.** Their only action is physical —
having and using the device (holding it, the badge sitting in the reader case,
the biometric their *own app* prompts for). Everything else happens **inside the
host app on the device**, identically on iOS / Android / Web / desktop.

This is a hard product constraint, not a preference. Every surface, API, and
flow is measured against it.

**It applies to every role, every industry, every platform.** A frontline nurse,
a warehouse picker, a long-haul driver, a NOC engineer, an executive, the CEO —
none of them ever log into SignalGrid, install a SignalGrid app, or make a
SignalGrid decision. They use their normal apps and their device; the trust layer
is underneath. The point is that it feels like the *future*: everything just
works, invisibly, because the hard part (is this the right person, on a
trustworthy device, in the right context, for this action?) is answered for the
app instead of by the user. This holds identically on the **macOS and Windows
desktop** apps as on mobile and web — the only per-platform difference is which
native authenticator the app invokes for a step-up.

## What this means concretely

1. **No SignalGrid login, screen, app, or portal for end users.** A nurse opens
   their EMR; a picker opens their WMS handheld app; a driver opens their fleet
   app. SignalGrid is embedded (SDK / API call) behind that app. The worker never
   sees the word "SignalGrid."

2. **Gating is invisible.** When SignalGrid returns `allow`, the app just works.
   When it returns `restrict` / `deny`, the app shows *its own* message in *its
   own* words ("this action isn't available on this device right now") — driven
   by SignalGrid's reason code, but rendered by the host app. No SignalGrid UI.

3. **Step-up is the host app's native prompt.** On `step_up`, the app triggers
   the platform's own authenticator — Face ID / Touch ID / Windows Hello / a
   badge tap — using the hardened WebAuthn path. The user experiences their
   familiar OS/app prompt, not a SignalGrid screen, and re-tries in place.

4. **Assist confirmations are the host app's own dialog.** A sensitive action
   held for confirmation surfaces as the app's existing confirm step (e.g. the
   EMR's "verify order" dialog), not a SignalGrid overlay.

5. **Cross-platform parity.** The embedded behavior is identical everywhere; the
   only thing that changes per platform is which native authenticator the app
   invokes for step-up.

6. **All human interaction that isn't the end user is the operator/admin side.**
   The dashboards, the Fleet page, ops-intelligence, policy authoring, the
   App-workflows preview — those are for operators/admins, deliberately separate
   from the worker's device experience.

## How the architecture already enforces this

- `/v1/app-workflows/evaluate` and `/v1/decisions/evaluate` are called by the
  **app**, authenticated by the app's bearer token — never by the end user. The
  user supplies no SignalGrid input.
- The decision + Assist plan is computed server/SDK-side and returned to the app,
  which renders the result in its own UI.
- The product endpoints return the plan **as decided** — the caller cannot
  self-assert confirmation or step-up (see the fail-closed hardening in
  `@workspace/app-workflows`), so "confirmation" always means a real native
  gesture the app captured, never a SignalGrid dialog the user had to find.

## The embedded flow, shown

`docs/embedded-host-app-demo.html` (published at `/embedded-demo.html`) is the
reference demonstration of this law: a generic clinical app ("Wardlink Chart",
no SignalGrid branding inside the phone) where the worker opens a chart and views
results with no friction, then places a controlled med order that is *held* — the
app triggers a native-style authenticator, and only a captured gesture releases
it. A separate "behind the glass" panel (never seen by the worker) shows the
`allow` / `step_up` decision the core returned. The step-up completion is a
clearly-labeled **demo simulation**, not a real hardware gesture.

`docs/embedded-desktop-demo.html` (published at `/desktop-demo.html`) is the
**cross-platform parity** companion: the identical Assist flow inside a generic
NOC desktop app on **macOS / Windows**, where a config push to a core switch is
held for a step-up then an in-app confirmation. A toggle swaps the native prompt
between **Touch ID** and **Windows Hello** — the *only* per-platform difference —
making the point that the behavior is identical everywhere; just the
authenticator changes.

## Reconciliation (done)

- `artifacts/signalgrid-mobile-pwa` previously rendered a **SignalGrid-branded
  end-user screen** ("My Access", "Alex R. · Nurse") with first-person
  self-service steps ("Fix it yourself", "Retry after these steps"). That
  predated this law and conflicted with it: an end user should not open a
  SignalGrid app. It has now been repositioned as an **operator/support** surface
  — the `AccessSupport` tab ("Access support · Worker session triage · relay
  guidance"). A support lead reviews a worker's blocked session and sees the
  guidance to relay; the worker's actual resolution happens invisibly in their
  host app, and there are no worker-executed controls in the PWA. The embedded-UX
  demonstrations (`embedded-host-app-demo.html` for mobile,
  `embedded-desktop-demo.html` for desktop) remain the reference for the worker's
  embedded flow. `docs/APP_SUITE_MATRIX.md` reflects the repositioning.

## The test for any new surface

> Would a frontline worker ever have to open this, log into this, or think about
> "SignalGrid" to do their job? If yes, it violates the law — move the behavior
> into the host app (SDK/API), and keep only the operator/admin view here.
