# Competitive Evaluation — Microsoft Entra vs. SignalGrid

> **Scope:** Entra **shared device mode** + **Conditional Access** + **Continuous
> Access Evaluation (CAE)** + **device posture/compliance**. Internal competitive
> research, compiled 2026-07-14 from Microsoft-official docs (read via the
> MicrosoftDocs GitHub sources where learn.microsoft.com 403'd to fetch; canonical
> Learn URLs cited in Sources). Makes no claims on SignalGrid's behalf — it exists
> to keep competitive risk low by naming the boundary precisely.

## Executive summary

- **Threat rating: MEDIUM (leaning LOW-MEDIUM).** The prior "objection more than a competitor" read is substantially correct but slightly too comfortable. Entra genuinely does not do SignalGrid's core job — per-action authorization gated on *who is physically holding a shared device right now* — but one inconvenient truth narrows the gap.
- **Inconvenient truth: Conditional Access authentication context already does real per-action step-up MFA.** So "Entra can't do granular per-action decisions" is an **overclaim SignalGrid must stop making.** The honest limit is that it steps up on *authentication strength*, is blind to custody/badge/CIS, and requires per-app developer wiring.
- **Entra operates at the session/token level, not the action-custody level.** Shared device mode manages *one signed-in user's session* (single sign-in / global sign-out) and assumes "session = the credentialed user." No concept of physical custody, badge-holder identity, dock/charge state, or tamper. **CAE** is real-time but coarse — it revokes/re-evaluates *tokens* on a fixed critical-event list (account disabled, password reset, MFA change, admin revocation, high user risk, IP change), token-scoped, up to ~15-min propagation.
- **Microsoft's platform gravity is the real threat — not feature parity.** In Microsoft-standardized shops that already own Entra P1/P2 + Intune, "we already pay for this" crowds the budget even though what they own doesn't cover custody/badge/CIS-fusion. The risk is **procurement/mindshare, not capability overlap.**
- **Recommended posture: build ON Entra, never against it.** Consume Entra compliance state + CAE signals as inputs and add the three things Entra structurally lacks — physical custody, badge-holder binding, and per-*workflow* decisioning across a vendor-neutral (non-Microsoft-only) estate.

## What Entra is (cited)

- **Shared Device Mode (SDM)** — an Entra ID feature configuring **iOS/iPadOS/Android only** (not Windows) for pooled frontline use: **single sign-in** (into one SDM app → authenticated across all SDM apps) and **global sign-out** (readying the device for the next worker). Fundamentally **per-user session management, not per-action authorization** — apps are *notified of account switching* and must clear the prior user's data. No custody/badge/dock/tamper concept.
- **Conditional Access (CA)** — the policy engine. Signals: user/group, location/IP, device state (compliant/hybrid-joined), client app, real-time/user risk (Identity Protection). Grant controls: block, require MFA, auth strength, compliant/hybrid device, approved app, app-protection, password change, risk remediation, terms. Session controls: sign-in frequency, persistent browser, app-enforced restrictions. Targets **applications/resources, not individual in-app actions** — *except* built-in user actions and **authentication context**.
- **Authentication context (the nuance)** — gives **per-action step-up MFA**: an app can, at the moment of a high-risk action, demand a fresh step-up "exactly for that action" (up to 99 contexts; powers Protected Actions and Defender for Cloud Apps step-up-on-risky-action). **Caveats:** not automatic (developers/admins must tag actions and wire the app), and it authorizes on *authentication strength*, not custody/badge/device-physical state.
- **Continuous Access Evaluation (CAE)** — near-real-time **token** revocation/re-evaluation (OpenID CAEP). Critical events: account deleted/disabled, password change/reset, MFA enabled, admin revokes tokens, high user risk, IP-location change. **Token/session-level, not action-level;** up to ~15-min latency (IP instant).
- **Device posture/compliance** — from **Intune** (OS version, enrollment, encryption, jailbreak/root), surfaced to CA via "require compliant device." **No** custody/badge/dock/tamper or **CIS-benchmark** fusion in the grant/compliance docs.
- **Frontline positioning** — "Frontline Worker" management (SDM + Intune zero-touch + Managed Home Screen) for healthcare/retail/etc. The story is *device setup + sign-in/out lifecycle at scale*, not runtime workflow authorization.

## Overlap map

| Capability | Entra | SignalGrid | Real overlap? |
|---|---|---|---|
| Policy-driven access **decision** | CA engine (block/MFA/compliant/step-up) | Runtime allow/step-up/restrict/deny | **Yes** — both are PDPs |
| Device compliance **as a signal** | Intune → CA | Consumes posture as one input | **Yes** — but SignalGrid treats it as *an* input, not the verdict |
| Session-level **step-up / MFA** | CA + authentication context (per-action) | Per-workflow step-up | **Partial** — closer than expected via auth context |
| Near-real-time **revocation** | CAE (token/session) | Re-decision at workflow fire | **Partial** — different granularity |
| Frontline **shared-device sign-in/out** | SDM single sign-in / global sign-out | Assumes SDM underneath | **Yes at session layer** — complementary |

Overlaps are real at the *session and posture* layer; they do **not** extend to custody, badge-holder, or per-workflow decisioning.

## Fundamental differences

| Dimension | Microsoft Entra | SignalGrid |
|---|---|---|
| **Decision granularity** | Session/token; per-app; per-action *only* via developer-wired authentication context | Per **workflow/action** at the moment it fires, natively |
| **"Who is using the device?"** | Assumes **session = the signed-in user**; SDM tracks the *credentialed* account only | Binds decision to the **badge-holder physically holding the device now** |
| **Physical custody** | None (no dock/charge/tamper/handoff) | **Core signal** |
| **Badge binding** | None | Binds current holder to the active session |
| **Security baseline** | Intune compliance; **no CIS-baseline fusion** | Fuses **CIS/security-baseline** with identity + custody + workflow risk |
| **Revocation trigger** | Fixed critical-event list; token-scoped; ≤15 min | Re-evaluates at each workflow fire, in-context |
| **Stack assumption** | **Microsoft-centric** (Entra + Intune + MSAL apps) | **Vendor-neutral overlay** consuming Entra/UEM/EDR/ITSM |
| **Per-action integration burden** | App developers must tag actions & request auth contexts | Decision layer above apps; workflow-aware without per-app rewiring |

**Load-bearing difference:** Entra authenticates and manages a *session*; SignalGrid authorizes an *action* against the physical reality of a shared device and its current holder. Entra has no primitive for "the badge that unlocked this session 40 minutes ago left the room and someone else is now scanning."

## Threat assessment — MEDIUM (LOW-MEDIUM)

**Competitor, platform, or both? — Both, mostly a platform.** Entra is the substrate SignalGrid lives on top of (consuming compliance state, CAE events, SDM session lifecycle). It's a *competitor* mainly rhetorically — in the buyer's budget conversation.

**Where "Microsoft already does this" bites:** deeply Microsoft-standardized shops that own Entra P1/P2 + Intune reflexively resist a "second access tool." This is the dominant real risk — **procurement/mindshare, not capability match.** SignalGrid loses these deals not because Entra does the job, but because the buyer won't look closely enough to see it doesn't.

**Two truths that weaken an aggressive pitch:** (1) authentication context already does per-action step-up — if the deck says "Entra can't," a Microsoft SE disproves it live; reframe to "Entra steps up per-action *on auth strength*, but can't condition on **who holds the device, custody/tamper, or CIS baseline**, and needs per-app wiring." (2) CAE + Intune already deliver "real-time-ish" revocation + posture — the edge is granularity and custody, not "Microsoft has nothing."

**Could Microsoft close the gap? Moderately unlikely near-term.** Custody (dock/charge/tamper) and badge-holder-at-action are outside Entra's identity-session paradigm and would require new device-side primitives + breaking "session = signed-in user." Microsoft's frontline investment flows into provisioning + sign-in/out lifecycle, not runtime custody. But Microsoft absorbs adjacent categories, and auth context shows movement toward finer granularity — treat closure as a **medium-term platform risk**, which is exactly why building *on* Entra is the safe posture.

## Differentiation & keep-risk-low recommendations

1. **Position as an Entra *multiplier*, never a replacement.** "SignalGrid consumes Entra compliance + CAE signals and adds custody + badge-holder + per-workflow decisioning Entra structurally can't make." Make Entra investment a prerequisite you strengthen.
2. **Own the one sentence Entra cannot say:** *"Entra knows the account that signed in; SignalGrid knows the person physically holding this shared device at the instant the workflow fires."*
3. **Stop the "Entra can't do per-action" overclaim.** Concede authentication context openly, then redirect to its limits (auth-strength-only, developer-wiring-dependent, blind to custody/CIS). Credibility with Microsoft-literate buyers is itself a differentiator.
4. **Anchor on CIS-baseline fusion + vendor-neutrality.** Entra posture stops at Intune compliance and a Microsoft-centric app model; SignalGrid fuses CIS alignment with identity + custody + workflow risk across mixed estates (Zebra scanners, kiosks, non-MSAL apps).
5. **Pre-empt "second tool" in the sales motion:** "You already own Entra for identity; SignalGrid is the *runtime custody-and-action* layer it doesn't provide — priced as an extension, integrated via your existing Entra/Intune signals." Quantify the residual risk (wrong-badge-holder actions on shared clinical devices) with an audit-trail demo.
6. **Know when to walk.** Pure Microsoft shop, no shared-device custody incidents, low frontline-workflow risk, hard "no second tool" policy → disqualify early. Prioritize shared clinical/retail devices, multi-vendor estates, and audit/compliance pressure where custody gaps are felt.

## Sources

learn.microsoft.com/en-us/entra/identity-platform/msal-shared-devices · learn.microsoft.com/en-us/microsoft-365/frontline/flw-shared-devices · learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation · …/concept-conditional-access-grant · …/concept-conditional-access-cloud-apps · …/concept-conditional-access-session · …/concept-conditional-access-conditions · learn.microsoft.com/en-us/entra/identity-platform/developer-guide-conditional-access-authentication-context · learn.microsoft.com/en-us/entra/identity/role-based-access-control/protected-actions-overview · learn.microsoft.com/en-us/defender-cloud-apps/tutorial-step-up-authentication · learn.microsoft.com/en-us/entra/identity/conditional-access/policy-all-users-device-compliance · learn.microsoft.com/en-us/intune/solutions/frontline-worker/ · learn.microsoft.com/en-us/microsoft-365/frontline/flw-devices · learn.microsoft.com/en-us/entra/fundamentals/frontline-worker-management · techcommunity.microsoft.com/blog/intunecustomersuccess/from-the-frontlines-accelerating-retail-worker-shared-device-experience-part-one/4397212

**Caveat:** learn.microsoft.com 403'd to the fetcher; identical content read via the MicrosoftDocs GitHub doc sources + Microsoft-official search summaries, cited to canonical Learn URLs.
