# Design law: SignalGrid is invisible to end users

**The end user never interacts with SignalGrid.** Their only action is physical —
having and using the device (holding it, the badge sitting in the reader case,
the biometric their *own app* prompts for). Everything else happens **inside the
host app on the device**, identically on iOS / Android / Web / desktop.

This is a hard product constraint, not a preference. Every surface, API, and
flow is measured against it.

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

## Open reconciliation

- `artifacts/signalgrid-mobile-pwa` ("My Access") today renders a **SignalGrid-
  branded end-user screen** with self-service resolution steps. That predates this
  law and conflicts with it: an end user should not open a SignalGrid app. It
  should be repositioned as either (a) a **demonstration of the embedded UX** (a
  reference host app showing how gating/step-up look *inside* a partner app,
  clearly framed as illustrative), or (b) an **operator/support** view — not a
  worker destination. Tracked in `docs/BUILD_BACKLOG.md`.

## The test for any new surface

> Would a frontline worker ever have to open this, log into this, or think about
> "SignalGrid" to do their job? If yes, it violates the law — move the behavior
> into the host app (SDK/API), and keep only the operator/admin view here.
