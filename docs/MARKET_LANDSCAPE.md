# SignalGrid — Market Landscape & Positioning Review

> **What this is:** internal strategy research, compiled 2026-07-14 from public,
> currently-live sources (every claim is anchored to a real URL in the Sources
> list). It is deliberately honest and self-critical — it exists to sharpen
> positioning, not to market. It makes **no** partnership, certification, or
> competitive-superiority claims on SignalGrid's behalf; competitor descriptions
> are summaries of those vendors' own public pages. Treat analyst-category
> framing as directional, not gospel.

## Executive summary

- **The underlying category is real, but it is not called "Operational Trust Orchestration."** The recognized terms are *runtime authorization / authorization-as-a-service (PDP/PEP)*, *Continuous Access Evaluation (CAE / CAEP)* under the OpenID *Shared Signals Framework*, *device trust*, and *ITDR*. SignalGrid's coined label is derivative of a crowded "trust orchestration / identity orchestration" space (Signicat, Daon, NHI Management Group), so it wins little recognition while colliding conceptually with several live terms.
- **The frontline shared-device angle is SignalGrid's one genuinely under-served wedge — but it is not empty.** OLOID markets almost the exact thesis ("the shared-device attribution gap breaks IAM/HIPAA/21 CFR Part 11"), and Imprivata owns the healthcare shared-device beachhead (tap-in/tap-out, roaming sessions, badge SSO). The "fuse many signals into an allow/step-up/deny decision at the moment of action" mechanism is the *runtime authorization / PDP* pattern that Cerbos, SGNL, PlainID, Axiomatics, Oso and the OpenID AuthZEN group already occupy.
- **The two clusters most likely to dismiss SignalGrid as "a feature we already ship"** are (1) **Imprivata** for healthcare shared clinical devices, and (2) **Microsoft Entra** (shared device mode + Continuous Access Evaluation + Conditional Access + device posture).
- **The market just consolidated in this exact direction:** CrowdStrike announced (Jan 8, 2026) it will acquire SGNL for ~$740M to "continuously evaluate identity, device, and behavior to dynamically grant, deny, or revoke access." That validates the runtime-decision thesis and signals platform incumbents moving in.
- **Sharpest defensible position:** not "a new trust category," but a **decision/attribution layer for the moment a workflow fires on a shared, physically-custodied frontline device** — the one context where per-request identity is genuinely ambiguous (who is holding ward-terminal-3 right now?) and where physical custody + badge binding + workflow risk are inputs the IAM/CAE/PDP incumbents do not natively fuse. Lead with "shared-device attribution + step-up at point of action," integrate on top of Imprivata/Entra, and drop the invented category name.

## Category & terminology

1. **Runtime authorization / PDP–PEP is an established pattern.** The Policy Decision Point / Policy Enforcement Point split is standard access-control vocabulary (evaluate subject/action/resource/context → decision + obligations; the PEP enforces). See Pomerium's glossary, NextLabs on PEPs, and AWS Prescriptive Guidance. Cerbos frames the productized version as a "runtime authorization platform."
2. **Continuous Access Evaluation (CAE / CAEP) is the "re-evaluate at the moment" standard.** CAEP is part of the OpenID **Shared Signals Framework**; final specs were published in 2025. It moves from "was this allowed at token issuance" to "has anything changed that should revoke/step-up now." Microsoft Entra, Cisco Duo and Okta all ship continuous/adaptive access evaluation.
3. **Authorization-as-a-service is standardizing via AuthZEN.** The OpenID Foundation's AuthZEN WG defines a common authorization request/response API; interop demonstrated by Aserto, Axiomatics, Cerbos, Permit.io, SGNL, Strata, Thales, 3Edges. SignalGrid's "single allow/step-up/restrict/deny decision with audit trail" is the AuthZEN decision-API shape.
4. **ITDR is the runtime-identity-attack category** (Gartner, March 2022) — operates after authentication, watching for abuse of legitimate access.
5. **"Operational Trust Orchestration" — collision assessment.** The exact phrase is not an established analyst/vendor category (ownable as a wordmark) but sits in a busy neighborhood: "trust orchestration" is a shipping Signicat product; "orchestration as the control plane" is Daon's framing; "context-aware trust orchestration" is a defined glossary term; "identity orchestration" is a full category. **Net:** the coined name gets no free recognition, invites "how is this different from identity orchestration?", and understates the actual differentiator (custody/attribution at point of action).

## Competitor map

**Cluster A — Runtime / fine-grained authorization (PDP-as-a-service).** Own the "fuse context → single decision + audit" mechanism.
- **Cerbos** — stateless runtime authorization engine (YAML/CEL); developer-embedded app authz, no device/custody/frontline notion.
- **SGNL** — dynamic access management, CAEP hub, zero standing privilege; **being acquired by CrowdStrike for ~$740M** (Jan 8 2026). Enterprise SaaS/cloud + AI-agent identity, not shared physical frontline devices.
- **Oso, Aserto/Topaz, OpenFGA (Auth0/Okta), Styra/OPA, PlainID, Axiomatics** — application/enterprise authorization engines (ABAC/ReBAC/policy); none reason about "who is physically holding this shared scanner."

**Cluster B — Continuous Access Evaluation / adaptive access (IdP-native).** Microsoft Entra (Conditional Access + CAE + device posture), Cisco Duo, Okta. Re-evaluate a user's *session/token*; assume a 1:1 user↔session. The shared-device "which human is this right now" gap is what they don't natively resolve.

**Cluster C — Device trust (managed/unmanaged/browser).**
- **Kolide (now 1Password Extended Access Management)** — endpoint-agent device trust; oriented to managed endpoints, no longer sold standalone.
- **Cloudflare Access** — device-posture rules; a network/app access gateway.
- **Beyond Identity** — phishing-resistant auth + device risk; not frontline shared-custody.
- **Island (enterprise browser)** — assesses device posture and applies conditional access + DLP in-browser (targets healthcare BYOD/EHR access); controls the *browser session*, not the moment a workflow fires on a shared clinical/rugged device.

**Cluster D — Frontline shared-device management (UEM/kiosk).** SOTI MobiControl, 42Gears SureMDM/SureLock, **Microsoft Entra Shared Device Mode** (single-gesture sign-in/global sign-out for pooled frontline devices). They *manage/provision* the device or handle *who is signed in* — not per-action allow/step-up decisions given custody + posture + workflow risk.

**Cluster E — Healthcare shared-device incumbent (beachhead owner).** **Imprivata** — Mobile Device Access (badge tap-in/tap-out to shared clinical mobile), roaming sessions, and Healthcare Seamless SSO that extends Microsoft Entra to shared clinical workstations. Owns badge-bound SSO + audit on shared clinical devices — the single hardest cluster for SignalGrid. It *already* does per-transaction step-up (EPCS), posture checks, charge-state custody, and (via the Nov-2025 Verosint acquisition) runtime risk decisioning. **Threat HIGH in healthcare, MEDIUM in retail/logistics;** full analysis in [`COMPETITIVE_IMPRIVATA.md`](./COMPETITIVE_IMPRIVATA.md).

**Cluster F — The nearest thesis-twin.** **OLOID** — explicitly markets "the shared-device attribution gap breaks traditional IAM," ties it to HIPAA and FDA 21 CFR Part 11, and sells badge-tap attribution for frontline/warehouse/factory. The competitor whose language most overlaps SignalGrid's — and, as of its May-2026 **FIL** product, moving toward per-action "moment of action" governance. **Threat HIGH;** full analysis in [`COMPETITIVE_OLOID.md`](./COMPETITIVE_OLOID.md).

**Cluster G — Infrastructure-access platforms (vocabulary overlap only).** **Teleport** and similar infra-access tools share the *vocabulary* (device trust, just-in-time, PDP, zero trust) but protect servers/K8s/DBs for engineers/machines via a cert-based protocol proxy — no shared-device / physical-custody / frontline-worker notion. Assessed as **orthogonal-to-adjacent, threat LOW**; full analysis in [`COMPETITIVE_TELEPORT.md`](./COMPETITIVE_TELEPORT.md).

## SignalGrid's wedge (honest)

Where it is genuinely differentiated:
1. **Custody + badge binding as decision inputs, at the moment of action.** No Cluster A/B vendor natively reasons about physical custody of a shared device or badge binding to the current holder as a live signal — the one input class uniquely hard on shared frontline devices, which IAM/CAE/PDP tools structurally assume away.
2. **Decision at workflow-fire time, not login/session time.** A finer granularity than Entra Shared Device Mode / Imprivata's "sign-in/sign-out gesture."
3. **Sits on top of IAM/UEM/EDR/ITSM rather than replacing them** — the correct PDP/AuthZEN integration story for regulated buyers who already own Entra + Imprivata + a UEM.
4. **Cross-vertical attribution + audit trail** framed for HIPAA / 21 CFR Part 11 / retail-loss / warehouse.

**The strongest single sentence to defend:** *"A per-action decision-and-attribution layer that answers 'which human is holding this shared device, and should this specific workflow proceed right now?' — fusing badge/custody/posture/workflow-risk on top of the IAM, UEM and SSO you already run."*

## Weakest points / likely objections

1. **"Imprivata already does this for healthcare."** The most dangerous objection, and partly true. Counter with per-action step-up / workflow-risk granularity Imprivata's session-level model doesn't cover, and interoperate with (don't fight) the badge infrastructure.
2. **"Entra already does Conditional Access + CAE + Shared Device Mode + posture."** Counter is narrow: Entra decides at session/token granularity and assumes session=user; it doesn't fuse physical custody/badge-holder at action time. A real but subtle gap a Microsoft-standardized buyer may not fund.
3. **"This is just a PDP / authorization-as-a-service."** Cluster A + AuthZEN already productize "fuse context → decision + audit," and CrowdStrike just paid $740M for SGNL. Risk of being bucketed as a niche PDP.
4. **"Operational Trust Orchestration is an invented category."** No analyst quadrant; raises education cost without a moat.
5. **"OLOID already says the same thing."** The attribution-gap narrative is contested; differentiate on product depth, not narrative.
6. **Overclaim risk on physical custody as a reliable signal.** Custody is hard to sense robustly. Claim it as *one weighted evidence input*, never ground truth; be ready to discuss false-accept/false-reject behavior.

## Buyer language glossary

Shared-device attribution gap · tap-in/tap-out (tap-and-go) · roaming session · shift hand-off / per-shift personalization · global sign-out / shared device mode · badge binding / badge tap access · device posture / security baseline · Continuous Access Evaluation (CAE/CAEP), step-up, session revocation · zero standing privilege / just-in-time access · compliance anchors: HIPAA, **FDA 21 CFR Part 11**, retail shrink/loss, chain-of-custody.

> Use these verbatim in messaging. Avoid leading with "Operational Trust Orchestration," "trust fabric," or "decision plane" until the buyer recognizes the problem in their own words.

## Positioning recommendations

1. **Drop the coined category from the lead; keep it as at most a tagline.** Lead with the recognized problem — *"Per-action attribution and step-up for shared frontline devices"* — and describe the mechanism as a runtime authorization / PDP that adds custody + badge + posture + workflow-risk.
2. **Pick a beachhead where the incumbent is weakest.** In hospitals, position as a layer *above* Imprivata/Entra adding per-workflow step-up (not a badge-SSO replacement). In warehouse/retail (Zebra/SOTI/42Gears territory, no Imprivata), the attribution gap is wide open and the incumbent is only a UEM — possibly the cleaner entry. Validate with ~5 buyer interviews before committing.
3. **Make "physical custody + badge binding at moment-of-action" the one-line moat, and prove it with numbers.** State it as a weighted evidence input feeding an auditable decision; publish false-accept/false-reject behavior; never assert custody as certainty.
4. **Position as "integrates with, does not replace" Entra CAE, Imprivata badge, and the UEM/EDR.** An AuthZEN-shaped decision API that consumes their signals and emits allow/step-up/deny + audit is a land-and-expand story.
5. **Differentiate from OLOID on depth, not narrative** — multi-signal fusion (custody + posture/CIS baseline + workflow risk), per-action granularity, and a defensible audit artifact; be ready to explain why badge-tap attribution alone is necessary but insufficient for high-risk workflows.

## Sources

Category / terminology: pomerium.com/glossary/policy-decision-point-pdp · nextlabs.com/blogs/what-is-a-policy-enforcement-point-pep · docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-api-access-authorization/pep.html · cerbos.dev/blog/what-is-a-runtime-authorization-platform · systemshardening.com/articles/cross-cutting/continuous-authorization-caep · sgnl.ai/2025/09/sgnl-welcomes-the-publication-of-the-final-shared-signals-and-caep-specifications · crowdstrike.com/en-us/cybersecurity-101/identity-protection/continuous-access-evaluation-profile-caep · openid.net/specs/authorization-api-1_0-01.html · axiomatics.com/news/press-releases/openid-foundation-authzen-working-group-announces-interop-results · axiomatics.com/blog/introducing-the-era-of-authorization-with-authzen · permify.co/post/top-axiomatics-alternatives · gartner.com/reviews/market/identity-threat-detection-and-response-itdr · exaforce.com/learning-center/what-is-itdr

"Trust orchestration" collision: signicat.com/products/trust-orchestration · daon.com/resource/adaptive-trust-why-orchestration-is-becoming-the-control-plane-for-modern-identity · nhimg.org/glossary/context-aware-trust-orchestration · blog.gitguardian.com/top-identity-orchestration-tools · trustbuilder.com/en/solutions/identity-orchestration

Runtime authz & SGNL/CrowdStrike: sgnl.ai/2025/03/caep-cloud-security · securityweek.com/crowdstrike-to-buy-identity-security-firm-sgnl-for-740-million-in-cash · cnbc.com/2026/01/08/crowdstrike-ai-cybersecurity-sgnl-acquisition.html · crowdstrike.com/en-us/press-releases/crowdstrike-to-acquire-sgnl-to-transform-identity-security-for-ai-era

Device trust: kolide.com/blog/introducing-1password-extended-access-management-with-kolide · cloudflare.com/sase/use-cases/third-party-access · blog.cloudflare.com/zero-trust-with-managed-devices · beyondidentity.com/resource/device-trust-a-key-element-of-zero-trust-authentication · island.io/enterprise-browser · island.io/industries/healthcare

Frontline shared-device (UEM/Entra): soti.net/products/soti-mobicontrol · soti.net/resources/blog/2025/soti-mobicontrol-xs-vs-42gears-why-soti-comes-out-on-top · learn.microsoft.com/en-us/entra/identity-platform/msal-shared-devices · learn.microsoft.com/en-us/microsoft-365/frontline/flw-shared-devices

Imprivata: imprivata.com/solutions/industries/for-healthcare · d7.imprivata.com/mobile-device-access · docs.imprivata.com/supported/content/topics/healthcareseamlesssso/seamlesssso.html

OLOID: oloid.com/blog/shared-devices-iam-attribution-gap · oloid.com/blog/shared-passwords-frontline-break-audit-trails · oloid.com/blog/badge-tap-access

**Method note:** Several publisher pages (CrowdStrike, OLOID, Imprivata blog, Cerbos, systemshardening, nhimg) block automated fetching (HTTP 403); their content was read via page-level search retrieval rather than full-page fetch. Gartner's ITDR/"March 2022" framing is cited to the public market page and a secondary explainer, not the paywalled primary document. No vendor, quote, or report was invented.
