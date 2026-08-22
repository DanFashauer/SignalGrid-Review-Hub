# SignalGrid — Positioning (ratified)

**Status: RATIFIED by the owner 2026-08-22** (decision session; DR-011 records
it; DR-012 amends the device-management clause to the Fleet-first truth). This page is the single source for how SignalGrid is described to any
outside reader. Every claim traces to a `launch`-class item in
`scripts/launch-profile.mjs`; nothing deferred appears here, which is why
location, badges, custody, network, and threat signals are absent — real and
proven in this repository, and not Limited GA.

## The one label, and the words around it

Five incompatible product labels circulated before this page. The owner
ratified all three finalists WITH DEFINED ROLES, which is what makes them
compatible:

- **Category / product name: "Shared-Device Trust Gateway"** — the name on
  the site, the deck, and the pilot paperwork. Identical to the ratified
  launch-profile product name (DR-005), so scope and name are the same word.
- **Descriptor: "an access-decision service"** — the explaining phrase that
  follows the name for a cold reader ("SignalGrid, a Shared-Device Trust
  Gateway — an access-decision service embedded in the apps your staff
  already use").
- **Vision phrase: "workflow trust engine"** — reserved for roadmap/vision
  contexts only; never used to describe what ships at Limited GA.

Any document using a label outside these three roles is wrong and gets fixed
to this page.

## SignalGrid — buyer-legible positioning (Limited GA scope, launch-profile v4)

Every claim below is checked against the `launch` class in scripts/launch-profile.mjs. Nothing deferred appears — which is why location, badges, custody, network, and threat signals are absent: they are real and proven in this repository, and they are not Limited GA.

### 1. The one sentence

SignalGrid is a decision gate built invisibly into the apps your staff already use: before a sensitive action on a shared device it answers allow, step up, restrict, or deny — from the device's compliance, how current that compliance answer really is, and whether the device can vouch for itself right now — and anything it can't verify tightens the answer instead of waving it through.

### 2. The 100-word version

SignalGrid is an access-decision service embedded invisibly in the apps your staff already use on shared frontline devices. Before a sensitive action, the host app asks and gets one answer — allow, step_up, restrict, or deny — computed from three signals: device compliance, read-only from your device-management source — proven live against Fleet, the management plane lean IT teams actually run, with Microsoft Entra/Intune as the enterprise connector on the roadmap (implemented, wire-hardened, awaiting a customer tenant); whether that compliance answer is still current; and whether the device may act on its own authority right now. Every verdict carries reproducible evidence an operator can audit. Missing or stale signals tighten the decision, never loosen it. Your app applies the verdict, including the step-up prompt.

### 3. The boundary paragraph — what SignalGrid is NOT

SignalGrid is not an MDM: it never enrolls, configures, locks, or wipes a device, and it cannot enforce anything on the device itself — no app can restrict other apps or make itself non-removable; enforcement on the device is your MDM's job on a supervised device, and Fleet, Intune, or Jamf remain your management plane. SignalGrid reads their evidence, read-only. It is not an IdP: it does not authenticate users, hold identities, or run MFA — when it returns step_up, your app satisfies it with your existing authenticator and identity provider; at Limited GA SignalGrid conducts no challenge itself. It is not an EDR or a SIEM: it detects nothing and investigates nothing. It sits downstream of systems like these and consumes their evidence rather than replacing them — and at Limited GA it consumes exactly one source: your device-management evidence. Domain safety — patient lookup, clinical rules — stays in the host application; SignalGrid answers only whether this device, in its current state, should proceed.

### Claim-to-proof trace

| Claim | Grounding |
|---|---|
| "invisibly into the apps your staff already use" | docs/EMBEDDED_UX_PRINCIPLE.md:1-32 (design law); ios:EnterpriseShell is launch as the reference host app (launch-profile.mjs:453-458) |
| "allow, step up, restrict, deny" | lib/signalgrid-core/src/types.ts:374; lib/api-spec/v1-openapi.yaml:243; /v1/decisions/evaluate is launch (launch-profile.mjs:308-310) |
| "device's compliance" | signal kind device_posture, launch (launch-profile.mjs:240-243); graph family launch (:151-160) |
| "how current that answer really is" | signal kind device_management_health, launch (:245-247); family reason: a stale 'compliant' is "the unearned affirmative in its purest form" (:162-168) |
| "vouch for itself right now" | signal kind local_authority, launch (:249-251); family launch (:175-181) |
| "tightens instead of waving through" / "never loosen" | lib/posture-composition/src/adapters.ts:543; enforced structurally by scripts/review-invariants.mjs:144-176, run in preflight (preflight.mjs:67) |
| "reproducible evidence an operator can audit" | /v1/decisions/{id}/evidence launch (:317-321, "it is the claim"); operator console signalgrid-app launch (:444-451) |
| "read-only from your device-management source" | criterion string (launch-profile.mjs:126-129); no write route to any source system (:362-367) |
| "your app applies the verdict, including the step-up prompt" | GAPS step-up-answerability (:633-646): Limited GA is shadow mode — SignalGrid returns step_up, /v1/step-up/* is deferred; the host app's native authenticator answers it (EMBEDDED_UX_PRINCIPLE.md:34-37) |
| Deliberately omitted: location | 'location' and 'location_certainty' are deferred signal kinds (launch-profile.mjs:274-275) — say it in the roadmap, never in the present tense |
