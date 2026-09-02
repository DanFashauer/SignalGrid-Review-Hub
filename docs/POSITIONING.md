# SignalGrid — Positioning (ratified)

**Status: RATIFIED by the owner 2026-08-22** (decision session; DR-011 records
it; DR-012 amends the device-management clause to the Fleet-first truth). This page is the single source for how SignalGrid is described to any
outside reader. Every claim traces to a `launch`-class item in
`scripts/launch-profile.mjs`; nothing deferred appears here, which is why
location, badges, custody, network, and threat signals are absent — real and
proven in this repository, and not Limited GA.

## The label question — superseded, and deliberately left open

**This section was reconciled to DR-019/DR-020 on 2026-09-01.** An earlier
version of this page (last edited 2026-08-23) ratified "Shared-Device Trust
Gateway" as the category/product name. **DR-019 (2026-08-26) superseded that
ratification and ratified NO replacement label; DR-020 reinforced it.** The
category question is deferred to customer discovery — manufacturing a category
before buyers recognise one is the error DR-004 made once and DR-019 refused to
repeat.

So there is no ratified product-category name to put here, and this page no
longer asserts one. What survives:

- **`docs/PURPOSE.md` owns the product sentence** (canonical, DR-020). Describe
  SignalGrid by what it does — an orchestration grid across door, device, room
  and app that decides and acts on a person's behalf, invisible to the worker —
  not by a coined category label.
- **Descriptor, still usable for a cold reader: "an access-decision service"** —
  the explaining phrase, e.g. "SignalGrid, an access-decision service embedded
  in the apps your staff already use." This is a description, not a category
  claim.

Any document asserting a coined category label as SignalGrid's name is wrong
and gets fixed to this rule. (The 2026-08 category name is superseded, DR-019 —
named here only as the retired form this rule exists to catch.)

## SignalGrid — buyer-legible positioning (Limited GA scope, launch-profile v5)

Every claim below is checked against the `launch` class in scripts/launch-profile.mjs. Nothing deferred appears — which is why location, badges, custody, network, and threat signals are absent: they are real and proven in this repository, and they are not Limited GA.

### 1. The one sentence — quoted, never paraphrased

`docs/PURPOSE.md` §2 owns the product sentence (canonical, DR-020). This page
**quotes** it rather than restating it in its own words, because paraphrase is
exactly how a canonical sentence drifts — the rule `check-product-framing.mjs`
exists to enforce:

> **SignalGrid connects the systems a building already runs - access control,
> identity, device management, location, applications, ticketing - into one grid
> that decides and acts on the person's behalf.**
>
> — `docs/PURPOSE.md` §2, verbatim

**Corrected 2026-09-02.** This section previously opened "SignalGrid is a decision
gate built invisibly into the apps your staff already use…" — a paraphrase, and one
DR-020 had already reversed when it corrected PURPOSE.md *from gate to grid*: a
decision is the trigger for a cascade, not the output. `docs/agent/LOOP.md` states
the same correction. The paraphrase survived because this file is not on the
product-framing gate's surface list and no gate reads English.

**What that sentence is, and what the rest of this page is.** The quote above is the
PRODUCT. Everything below is the **Limited GA SCOPE** of it, which is deliberately
much narrower: at Limited GA the grid reads exactly one source class — your
device-management evidence — and several of the systems the canonical sentence names
are classified `deferred` in `scripts/launch-profile.mjs` and do not ship. Read §2
for what is actually connected today, and never quote §2 as the company description.

### 2. The 100-word version — the Limited GA scope, not the product sentence

SignalGrid is an access-decision service embedded invisibly in the apps your staff already use on shared frontline devices. Before a sensitive action, the host app asks and gets one answer — allow, step_up, restrict, or deny — computed from three signals: device compliance, read-only from your device-management source — proven live against Fleet, the management plane lean IT teams actually run, with Microsoft Entra/Intune as the enterprise connector on the roadmap (implemented, wire-hardened, awaiting a customer tenant); whether that compliance answer is still current; and whether the device may act on its own authority right now. Every verdict carries reproducible evidence an operator can audit. Missing or stale signals tighten the decision, never loosen it. Your app applies the verdict, including the step-up prompt.

### 3. The boundary paragraph — what SignalGrid is NOT

SignalGrid is not an MDM: it never enrolls, configures, locks, or wipes a device, and it cannot enforce anything on the device itself — no app can restrict other apps or make itself non-removable; enforcement on the device is your MDM's job on a supervised device, and Fleet, Intune, or Jamf remain your management plane. SignalGrid reads their evidence, read-only. It is not an IdP: it does not authenticate users, hold identities, or run MFA — when it returns step_up, your app satisfies it with your existing authenticator and identity provider; at Limited GA SignalGrid conducts no challenge itself. It is not an EDR or a SIEM: it detects nothing and investigates nothing. It sits downstream of systems like these and consumes their evidence rather than replacing them — and at Limited GA it consumes exactly one source: your device-management evidence. Domain safety — patient lookup, clinical rules — stays in the host application; SignalGrid answers only whether this device, in its current state, should proceed.

### Claim-to-proof trace

| Claim | Grounding |
|---|---|
| "invisibly into the apps your staff already use" | docs/EMBEDDED_UX_PRINCIPLE.md:1-32 (design law); ios:EnterpriseShell is launch as the reference host app (launch-profile: `ios:EnterpriseShell` is `launch`) |
| "allow, step up, restrict, deny" | lib/signalgrid-core/src/types.ts:374; lib/api-spec/v1-openapi.yaml:243; /v1/decisions/evaluate is launch (launch-profile: `/v1/decisions/evaluate` is `launch`) |
| "device's compliance" | signal kind device_posture, launch (launch-profile: `device_posture` is `launch`); graph family launch (launch-profile: `graph` is `launch`) |
| "how current that answer really is" | signal kind device_management_health, launch (:245-247); family reason: a stale 'compliant' is "the unearned affirmative in its purest form" (:162-168) |
| "vouch for itself right now" | signal kind local_authority, launch (:249-251); family launch (:175-181) |
| "tightens instead of waving through" / "never loosen" | lib/posture-composition/src/adapters.ts:543; enforced structurally by scripts/review-invariants.mjs:144-176, run in preflight (preflight.mjs:67) |
| "reproducible evidence an operator can audit" | /v1/decisions/{id}/evidence launch (:317-321, "it is the claim"); operator console signalgrid-app launch (:444-451) |
| "read-only from your device-management source" | criterion string (launch-profile: `CRITERION`); no write route to any source system (scripts/launch-profile.mjs) |
| "your app applies the verdict, including the step-up prompt" | GAPS step-up-answerability (:633-646): Limited GA is shadow mode — SignalGrid returns step_up, /v1/step-up/* is deferred; the host app's native authenticator answers it (EMBEDDED_UX_PRINCIPLE.md:34-37) |
| Deliberately omitted: location | 'location' and 'location_certainty' are deferred signal kinds (launch-profile: `location` is `deferred`; launch-profile: `location_certainty` is `deferred`) — say it in the roadmap, never in the present tense |
