# Competitive Evaluation — OLOID (oloid.com) vs. SignalGrid

> **What this is:** internal competitive research, compiled 2026-07-14 from public
> sources (every claim anchored to a real URL in Sources). OLOID's domain returns
> 403 to automated fetch, so OLOID-page content was read via search-result
> retrieval of those exact URLs; revenue figures are third-party estimates. This
> doc makes no claims on SignalGrid's behalf — it exists to keep competitive risk
> low by naming the overlap precisely. **This is the closest competitor found; the
> analysis is deliberately unflattering where the overlap is real.**

## Executive summary

- **Threat rating: HIGH.** OLOID is not adjacent — it is a genuine thesis-twin. It markets the same core narrative SignalGrid is built on: compliance frameworks (HIPAA, FDA 21 CFR Part 11) assume every access event traces to a specific individual, and shared logins on frontline devices break that. It sells badge-tap attribution for shared clinical/warehouse/factory devices, and as of **May 2026** has an explicitly **per-action, "moment of action" governance** product (FIL). The overlap is larger than a normal competitor's.
- **OLOID's center of gravity is still authentication/attribution-at-login, not a runtime PDP.** The flagship is passwordless auth for deskless workers on shared devices (badge tap, facial "FaceVault," NFC/RFID→FIDO2, QR, PIN, passkeys). Its primary job is *resolve the shared device to the person on shift and log it* — attribution, not per-workflow allow/step-up/restrict/deny.
- **But OLOID already does session-level runtime enforcement and is moving toward per-action decisioning.** Its C•CURE 9000 and SOTI MobiControl integrations describe device-posture/physical-access context driving step-up, access restriction, and session termination; FIL (May 2026) governs high-risk *actions* at the moment they fire. The gap SignalGrid relies on is real but **narrowing**.
- **SignalGrid's defensible wedge is narrow but real:** physical **custody** state of the shared device (dock/charge/tamper), **CIS/security-baseline** drift fusion, and a vendor-neutral **overlay PDP** posture. No evidence OLOID reasons about custody/tamper or CIS-baseline; OLOID consumes UEM/EDR posture as a context signal for *auth* decisions, and is authentication-led + hardware/PACS-led (readers, time clocks, door convergence).
- **Well-funded and entrenched in exactly SignalGrid's ICP** (~$26M raised; Dell Technologies Capital, Okta Ventures, Honeywell Ventures; logos incl. Tyson, Kraft Heinz, PepsiCo, Flex, GE, Elevance Health; certified Okta/Entra/Ping/Workday integrations; Ping 2025 "Innovation Partner of the Year" for frontline healthcare auth). In a "shared-device attribution + HIPAA/Part 11" RFP, OLOID is often already in the room.

## What OLOID is

**Positioning (its own words):** *"Passwordless Authentication Platform for Frontline Workers"* (homepage); elsewhere *"frontline identity platform,"* *"frontline IAM,"* and, in newer content, *"action-centric governance."* Through-line: frontline/deskless work is shared-device and shift-based, breaking the one-user-one-device assumption of traditional IAM.

**Product surface:**
- **Passwordless Authenticator** — face ("FaceVault," passive liveness on standard cameras), RFID/NFC badges (turns existing badges into **FIDO2** keys), mobile passkeys, QR, PIN; unlimited users on shared devices with fast switching.
- **Physical-access convergence hardware** — Cloud Key (cloud access on existing PACS), M-Tag (BLE mobile access retrofit), Smart Reader (facial + QR access that doubles as a tablet time clock); integrates with doors/turnstiles/PACS (C•CURE 9000, Lenel S2, Genea).
- **Auditable Shared Account Login** — attributes each login/session of a shared account to a named person; searchable audit trail.
- **Aura** — "AI Identity Assurance Agent" for workforce identity *processes* (onboarding/lifecycle), not runtime workflow decisioning.
- **FIL — Frontline In-the-Loop** (May 12, 2026) — a human-in-the-loop governance layer that *"operates at the moment of action,"* monitors frontline apps, flags high-risk actions (high-value returns, inventory overrides, clinical high-risk actions), and triggers human review/authorization. Framed as a shift *"from access-centric to action-centric governance."*

**Integrations:** Okta, Microsoft Entra, Ping (SSO/IdP); Workday (certified, Mar 2026); SOTI MobiControl (UEM); PACS (C•CURE 9000, Lenel S2, Genea); HRIS/time-and-attendance. **Verticals:** manufacturing, healthcare, pharma, retail, logistics, contact centers. **Funding:** founded 2018; ~$26.4M total (Seed $5M; Series A $12M, Dell Technologies Capital lead; Series A1 ~$6M). Revenue $10–25M (third-party estimate, soft).

## Overlap map (the uncomfortable ones)

1. **Identical problem thesis** — OLOID's "Why IAM's Core Assumption Fails on the Frontline" / "Shared Passwords Break Audit Trails" is almost word-for-word SignalGrid's attribution-gap pitch.
2. **HIPAA / FDA 21 CFR Part 11 framing** — same compliance wedge, same "attribution requirement" language, same verticals.
3. **Badge binding to the current holder** — OLOID ties each session to a named individual, adds a second factor to confirm the holder, and auto-locks on badge removal. Very close to SignalGrid's badge binding.
4. **Shared/mobile/frontline device target** — shared clinical tablets, kiosks, workstations, rugged handhelds, warehouse scanners.
5. **Compliance audit trail** — both deliver a per-person attributable, searchable trail.
6. **Adaptive / step-up / restrict / terminate** — OLOID's PACS + UEM integrations describe posture/behavior-driven step-up, restriction, session termination, re-auth.
7. **Per-action, moment-of-action governance (FIL)** — directly encroaches on SignalGrid's "runtime decision at the moment a workflow fires."
8. **Same stack neighbors** — both integrate Okta/Entra/Ping + a UEM (SOTI) and consume device posture as context.

## Fundamental differences

| Dimension | SignalGrid | OLOID |
|---|---|---|
| **Primary job** | Runtime **decision** (allow/step-up/restrict/deny) when a workflow fires | **Authentication + attribution** — resolve the shared device to the person and log it |
| **Decision granularity** | Per-action / per-workflow PDP as the design center | Per-**session/login** enforcement is the core; per-**action** (FIL) is new (May 2026), human-in-the-loop, early-stage |
| **Signal fusion** | identity + posture + **physical custody (dock/charge/tamper)** + badge binding + **CIS/security-baseline** + workflow risk → one decision | identity + auth factors + UEM/PACS posture + behavior → an **auth/session** decision; **no evidence of custody/tamper or CIS-baseline reasoning** |
| **Physical custody of device** | First-class signal | Not addressed (reasons about session state + door/reader/zone + badge in/out of range, not device custody/tamper) |
| **Security-baseline / CIS** | Explicit decision input | Not marketed; consumes EDR/UEM compliance as context only |
| **Architecture** | **Overlay PDP** — software decision layer *on top of* IAM/UEM/EDR/ITSM; vendor-neutral, replaces nothing | **Auth provider + hardware** — owns the login moment; ships readers, time clocks, PACS convergence |
| **Hardware footprint** | None | Meaningful (certified readers/tablets, time-clock hardware, PACS) |
| **Buyer entry point** | Frontline/clinical **security & risk** wanting a decision/enforcement point | Frontline **IT/ops + identity** wanting to kill passwords / modernize login & time clock |

## Threat assessment — HIGH

**Direct competitor? Yes — the closest, and materially so.** Same vertical, device surface, compliance narrative, and buyer conversations.

- **Where OLOID wins today:** deals framed as "kill shared passwords / passwordless frontline login + attributable audit for HIPAA/Part 11." OLOID owns that framing, the logos, the Okta/Entra/Ping/Workday certifications, and hardware for physical-access convergence.
- **Where SignalGrid wins today:** deals framed as "we already have IAM/UEM/EDR and even frontline SSO, but need a **decision/enforcement point** that reasons about **device custody and posture at the instant a high-risk workflow fires** — without changing how workers log in." Overlay-PDP, no hardware, custody + CIS-baseline + workflow-risk fusion is genuinely distinct.
- **Where they collide:** the "shared-device attribution + compliance audit" RFP. Vocabularies overlap heavily (badge binding, step-up, restrict/terminate, audit); a non-expert evaluator may see substitutes. SignalGrid must reframe toward per-action decisioning + custody + baseline or risk being scored as "OLOID without the login product / hardware."

**Is the differentiation defensible?** The inconvenient truth: **it's narrower than ideal, and OLOID is moving toward it.** FIL is explicit "action-centric, moment-of-action" governance. OLOID also already ships session-level step-up/restrict/terminate. What OLOID does *not* have (and does not appear to be building): (a) physical **custody/tamper** reasoning about the device itself, (b) **CIS/security-baseline** decisioning, (c) a vendor-neutral **overlay-PDP** posture (its business model biases it toward owning auth and selling hardware, not being neutral above someone else's auth). Those three are the real moat — each a feature OLOID *could* add, but its incentives pull it toward its auth/hardware core, which is the strategic seam to widen. **Net: HIGH, not existential** — the products still sell into different felt-pains (login vs. decisioning).

## Differentiation & keep-risk-low recommendations

1. **Lead with per-action runtime decisioning as a category boundary, not a feature:** "auth systems attribute; SignalGrid decides." Concede attribution to OLOID; reframe the buyer to the decision/enforcement moment. Do **not** compete on passwordless login or badge tap — OLOID's home turf.
2. **Own the two signals OLOID demonstrably lacks — physical custody (dock/charge/tamper) and CIS/security-baseline drift.** Cleanest, most defensible wedges; make custody-aware decisioning a headline with concrete scenarios OLOID's session model can't express.
3. **Hammer the overlay-PDP, zero-hardware, vendor-neutral posture** — "sits on top of your existing stack, *including on top of OLOID*." Turning OLOID into a possible upstream signal source (its badge-tap attribution feeds SignalGrid's decision) is both differentiation and a coexistence story that de-risks competitive RFPs. OLOID's hardware/PACS/time-clock footprint is a switching cost SignalGrid doesn't impose.
4. **Neutralize FIL specifically:** FIL routes high-risk *actions* to a human for approval; SignalGrid *computes* a multi-signal allow/step-up/restrict/deny from custody + posture + baseline + workflow risk and escalates to a human only as one outcome. Draw that line — and watch FIL's roadmap; it's the feature most likely to erode the differentiation.
5. **Win the compliance RFP on decision provenance, not just attribution:** OLOID logs *who accessed*; SignalGrid should log *why the decision was allow/step-up/deny and on what signals* — a decision-level audit trail that answers "was this action appropriate given device state," not only "who did it."
6. **Be honest internally: this is narrower differentiation than we'd like,** against a better-funded incumbent drifting toward per-action governance. Treat "prevent OLOID being scored as a substitute" as ongoing competitive enablement (battlecard, RFP language, discovery questions that surface custody/baseline pain OLOID can't serve), not a one-time exercise.

## Sources

oloid.com (homepage) · /platform/passwordless · /authentication-factors/face · /authentication-factors/rfid-badge · /solutions/{manufacturing,healthcare,pharmaceutical,retail,passwordless-device-access,passwordless-login-sso,auditable-shared-account-login} · /blog/{why-iam-core-assumption-fails-frontline, shared-passwords-frontline-break-audit-trails, badge-tap-access, hipaa-access-control-checklist, adaptive-authentication, risk-based-authentication, adaptive-mfa, policy-based-access-control, frontline-iam-platform, unlimited-users-shared-device-manufacturing, 10-types-of-physical-access-control-systems, authentication-logs} · /integrations/{oloid-c-cure-9000, oloid-soti-mobicontrol, oloid-lenel-s2, oloid-genea} · oloid.help/en/articles/8495939-set-up-c-cure-9000-for-oloid-workflow-integrations · /press-releases/oloid-expands-its-vision-for-frontline-ai-governance-with-human-in-the-loop-controls (FIL, May 12 2026) · natlawreview.com + einnews.com coverage of FIL · /press-releases/oloid-introduces-aura… · /press-releases/oloid-expands-partnership-with-workday… (Mar 12 2026) · /press-releases/oloid-ai-raises-5m-in-seed-funding… · /press-releases/oloid-closes-12m-series-a-funding · biometricupdate.com/202410/oloid-lands-6m-investment-round · crunchbase.com/organization/oloid-ai · tracxn.com/d/companies/oloid · pitchbook.com/profiles/company/279471-07 · cbinsights.com/company/oloid/financials (est.) · growjo.com/company/Oloid (est.) · securityinfowatch.com GSX coverage · /events/oloid-at-vive-2026

**Caveats:** oloid.com 403s to direct fetch — content read via search-result retrieval of the exact URLs. Revenue ($10–25M) is a third-party estimate. Some adaptive/risk-based content is educational/SEO; the integration-page step-up/restrict/terminate language describes product behavior. FIL is very recent (May 2026) and appears framework-level/early-stage rather than broadly deployed.
