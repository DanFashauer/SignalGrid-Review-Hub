# Competitive Evaluation — SGNL (→ CrowdStrike) vs. SignalGrid

> **What this is:** internal competitive research, compiled 2026-07-14 from public
> sources. Vendor/news pages 403'd to the fetcher this session, so findings are
> drawn from search-result summaries of primary sources (CrowdStrike press
> release/blog, SGNL.ai, trade press) with URLs cited; treat verbatim phrasing as
> high-but-not-100%-confidence. Makes no claims on SignalGrid's behalf — it keeps
> competitive risk low by naming the boundary precisely.

## Executive summary

- **Threat rating — TODAY: LOW. STRATEGIC (12–36 mo): LOW-to-MEDIUM.** SGNL is the closest *conceptual* pattern-match to SignalGrid's "runtime authorization decision" thesis, but it decides on a **different resource class** (SaaS/cloud/hyperscaler apps + infrastructure), for **different subjects** (workforce, non-human, and AI-agent identities), sold to a **different buyer** (enterprise IAM/PAM/ITDR/security). It does not touch physical shared frontline devices.
- **The deal validates the thesis, not the product overlap.** CrowdStrike's ~$740M acquisition (announced Jan 8, 2026) frames the future as continuously evaluating "identity, device, and behavior to dynamically grant, deny, or revoke access as conditions change" — strong third-party endorsement that runtime, context-fused access decisioning is where security is heading (SignalGrid's core bet). But the deal aims at **AI-era / agentic / machine-identity access to cloud resources**, not frontline clinical/retail/logistics workflows.
- **"Device" means the opposite thing in each product.** For SGNL/CrowdStrike, "device" = **endpoint/EDR posture** (OS version, patch, encryption, compliance, Falcon threat signals) of a *user's assigned endpoint*. For SignalGrid, "device" = **physical custody, badge-binding, and dock/tamper state of a *shared* device.** Non-overlapping signal domains.
- **The real risk is strategic reach, not product collision.** CrowdStrike is a ~$100B platform with a Falcon sensor already on millions of endpoints, and now owns a runtime-authorization engine. The medium-term watch item is not "CrowdStrike builds badge-binding for clinical iPads" (very unlikely — not their buyer, not their motion) but "CrowdStrike normalizes continuous access evaluation as a platform-default expectation," which could commoditize the *vocabulary* SignalGrid uses ("don't we get this from CrowdStrike?").
- **Recommended posture:** treat SGNL/CrowdStrike as **orthogonal-to-adjacent and a potential signal *source*, not a competitor.** Differentiate on physical custody / badge-holder / shared-device / non-engineer frontline user; position Falcon/EDR posture as an *input* SignalGrid can consume; avoid the shared "runtime authorization / CAE / ZSP" vocabulary that invites a direct, unflattering comparison to a $740M-validated incumbent.

## What SGNL / CrowdStrike is

**Category.** "Continuous Identity" / Continuous Access Management — real-time, policy-based dynamic authorization that eliminates standing privilege (Zero Standing Privilege) and grants just-in-time access. Founded 2021 (ex-Google/Okta/Microsoft leaders); **$30M Series A, Feb 2025** (~$42M total; investors incl. M12, Cisco Investments).

**Architecture (three layers):** (1) **Identity Data Fabric** — a central graph ingesting HRIS/AD/CRM/app data in near-real-time; (2) **Policy Engine** — policy-as-code; "protected systems" call it via control points; returns **Allow/Deny**; (3) **CAEP Hub** — event framework on the **Shared Signals Framework / Continuous Access Evaluation Profile** for real-time session-change signals.

**What it decides, for what.** Enforces policy in "cloud infrastructure, SaaS apps, API gateways, and custom apps." CrowdStrike describes it as "the runtime access enforcement layer between modern identity providers and the SaaS and hyperscaler resources that people, NHIs, and AI agents access." A Fortune-50 case reduced 30,000 static role assignments to 6 contextual policies and achieved ZSP across 500 AWS accounts. Adjacency: PAM/IGA modernization + ITDR.

**Subjects.** Workforce identities + **non-human identities (NHIs) and AI agents** — increasingly the headline.

**The acquisition (Jan 8, 2026, ~$740M).** Extends Falcon Next-Gen Identity Security: "powered by real-time Falcon platform intelligence… SGNL will continuously evaluate identity, device, and behavior to dynamically grant, deny, or revoke access." CAEP enforcement integrates into Falcon Fusion SOAR ("revoke access beyond the identity provider"). Strategic direction: **AI-era / agentic identity security.**

**"Device" (critical detail).** Device = **endpoint security posture** (OS version, patch, security software, encryption, compliance) + Falcon threat signals; out-of-compliance or malicious activity → restrict/revoke. **No evidence of physical custody, badge-holder identity, dock/charge, or tamper on a *shared* device.**

**Buyer / footprint.** Enterprise security / IAM / PAM / ITDR; documented customers are Fortune 50/200 in cloud-heavy industries (financial services, e-commerce, tech). A targeted search for any SGNL **healthcare/clinical/retail/warehouse/badge/kiosk/shared-device** footprint returned nothing.

## Overlap map (honest — the pattern-match is real)

| Shared concept | SGNL / CrowdStrike | SignalGrid |
|---|---|---|
| Runtime authorization decision | Allow/Deny at access-request time via control points | Allow/step-up/restrict/deny at workflow-fire time |
| Continuous / event-driven evaluation | CAEP + Shared Signals Framework | Re-evaluate on device/custody/posture change |
| Identity + device + behavior fusion | Falcon signals + identity graph + posture | Identity + posture + custody + badge + workflow risk |
| Grant / deny / revoke | Explicit; revoke beyond the IdP | Allow/step-up/restrict/deny + audit |
| Policy-as-code | Reusable human-readable policies | Policy-driven decisions |
| "Identity is the perimeter" | Core narrative | Adjacent framing |
| Zero standing privilege / JIT step-up | Central | Step-up on elevated risk |
| Sits on top of existing stack | On top of IdP/EDR/ITSM | On top of IAM/UEM/EDR/ITSM |

Overlap is real at the **pattern/vocabulary layer** (source of the "validates the thesis / incumbent entering the space" read). Divergence is entirely at the **object layer** (what/who/where).

## Fundamental differences

| Dimension | SGNL / CrowdStrike | SignalGrid |
|---|---|---|
| **Resource protected** | SaaS apps, cloud/hyperscaler (AWS/GCP/Azure), infra, APIs, privileged systems | A workflow firing on a shared/mobile/frontline physical device |
| **Subject / identity** | Workforce, non-human identities, AI agents | The human physically holding a shared device *right now* |
| **Meaning of "device"** | Endpoint/EDR **posture** of an assigned device | **Physical custody**: dock/charge/tamper + badge-binding to current holder |
| **Decision trigger** | Access request to app/cloud/API | Moment a clinical/retail/logistics workflow fires on the shared device |
| **Outputs** | Allow / Deny; revoke session | Allow / step-up / restrict / deny + audit |
| **Environment** | Cloud / enterprise software plane | Physical frontline: clinical iPads, Zebra scanners, shared workstations |
| **Buyer** | Enterprise security / IAM / PAM / ITDR | Frontline & clinical IT/security, ops |
| **Verticals (evidenced)** | Financial services, e-commerce, tech (Fortune 50/200) | Healthcare, retail, logistics frontline |
| **Standards anchor** | CAEP / Shared Signals Framework (open) | Proprietary custody/workflow-risk fusion |

The gap SGNL structurally *cannot* see today: **who is physically holding a shared device and whether it left its dock.** Its identity graph + CAEP signals model *logical* session/endpoint state; they have no representation of physical custody of a many-user device.

## Threat assessment (two-horizon)

**TODAY — LOW.** Not a direct competitor to the frontline shared-device niche: different resource (SaaS/cloud/infra, not a shared clinical iPad or scanner), different subject (workforce/NHI/AI agents, not the transient physical holder), different "device" signal (EDR posture, no custody/badge/dock/tamper), different buyer (enterprise IAM/PAM/ITDR, zero evidenced frontline footprint). A frontline buyer evaluating SignalGrid would not find SGNL on the shortlist for the same job. Overlap is thesis-level, not deal-level.

**STRATEGIC (12–36 mo) — LOW-to-MEDIUM.** Not pinned at LOW because: (1) **reach** — Falcon's sensor is already on a vast endpoint estate incl. hospitals/retailers, now paired with a runtime-authorization engine; (2) **vocabulary commoditization** — if "runtime, context-aware authorization" becomes a security-platform checkbox, SignalGrid must fight "don't we already get this from CrowdStrike?"; (3) **adjacent-expansion pattern**. Not HIGH, and probably stays LOW because: (1) **buyer mismatch is durable** (CISO/security org, not clinical-ops or store/warehouse IT); (2) **no physical-custody primitive** (badge/dock/tamper on shared devices is a hardware/ops problem outside their identity-graph + EDR model, and a down-market, high-touch, low-ACV motion against a $100B platform's incentives); (3) **explicit direction is elsewhere** (AI-era / agentic / NHI / cloud). **Net: watch, don't fear.**

## Differentiation & keep-risk-low recommendations

1. **Position as orthogonal-to-adjacent; never claim to compete with CrowdStrike.** "SGNL/CrowdStrike governs access to cloud and software resources for workforce, machine, and AI identities; SignalGrid governs what a person can *do on a shared physical device at the moment of use*." Different job, different buyer.
2. **Own the physical-custody / badge-holder / shared-device wedge** — the thing SGNL structurally cannot see, precisely because the incumbent's identity-graph + EDR model has no primitive for it.
3. **Frame Falcon/EDR posture as an *input you consume*, not a rival.** SGNL itself consumes EDR posture; SignalGrid can ingest EDR/Falcon posture as one input into a custody-aware frontline decision — turning the incumbent into a complement and de-risking the "you overlap with CrowdStrike" objection.
4. **Retire the shared "runtime authorization" vocabulary in positioning.** "Continuous access evaluation," "zero standing privilege," "runtime authorization," "PDP" map you onto SGNL's $740M-validated turf, where you lose the framing war. Prefer concrete frontline language: "who's holding this device," "custody-aware workflow guardrails," "step-up on the shared iPad," "safe hand-off." Keep the rigor; change the surface vocabulary.
5. **Anchor on the non-engineer frontline user + the workflow-fire moment** — a nurse/tech/picker mid-task, not an engineer getting cloud access via a ServiceNow ticket. Emphasize the human factor, physical environment, and workflow (med admin, specimen handling, POS, pick/pack).
6. **Add a light "strategic watch" to the competitive tracker (not a threat entry).** Re-rate only on evidence: does post-close CrowdStrike/SGNL ship device-*context* (vs device-*posture*) runtime decisioning, target frontline healthcare/retail/logistics buyers, or introduce any shared-device/custody concept? Absent those three, keep it LOW.

## Sources

crowdstrike.com/en-us/press-releases/crowdstrike-to-acquire-sgnl-to-transform-identity-security-for-ai-era · ir.crowdstrike.com/news-releases/…/crowdstrike-acquire-sgnl-transform-identity-security-ai-era · crowdstrike.com/en-us/blog/crowdstrike-to-acquire-sgnl · cnbc.com/2026/01/08/crowdstrike-ai-cybersecurity-sgnl-acquisition.html · securityweek.com/crowdstrike-to-buy-identity-security-firm-sgnl-for-740-million-in-cash · cyberscoop.com/crowdstrike-sngl-deal-740-million · theregister.com/2026/01/08/crowdstrikes_740m_sgnl_deal_proves · csoonline.com/article/4114957/crowdstrike-to-acquire-sgnl-for-740m-expanding-real-time-identity-security · darkreading.com/endpoint-security/crowdsrike-buy-sgnl-expand-identity-security-capabilities · marketplace.crowdstrike.com/…/listings/sgnl.html · sgnl.ai/product · prnewswire.com/news-releases/sgnl-announces-continuous-access-evaluation-profile-caep-hub-302078021.html · sgnl.ai/2025/04/the-impact-of-device-posture-on-identity-security · sgnl.ai/2025/03/zero-standing-privilege-case-study · sgnl.ai/case-study/fortune-200-e-commerce · sgnl.ai/use-cases/secure-ai-agents · sgnl.ai/2024/08/zero-standing-privilege-the-next-evolution-in-financial-services-security · techcrunch.com/2025/02/12/sgnl-snags-30m-… · finsmes.com/2025/02/sgnl-receives-30m-in-series-a-funding · ciscoinvestments.com/portfolio/sgnl · itpro.com/business/acquisition/crowdstrike-targets-identity-security-gains-with-usd740-million-sgnl-acquisition

**Caveats:** all content read via search-result summaries, not full-page fetches (fetch blocked this session). The absence of any frontline/shared-device footprint is an evidenced *negative* (a targeted search found none), not a claim of impossibility.
