# Competitive Evaluation — Teleport (goteleport.com) vs. SignalGrid

> **What this is:** internal competitive research, compiled 2026-07-14 from
> public sources (every claim anchored to a real URL in Sources). Teleport
> descriptions summarize Teleport's own public docs/pages; goteleport.com blocks
> automated fetch, so several items were read via Teleport's GitHub-hosted docs
> and search retrieval and are cited as such. This doc makes no
> partnership/superiority claims on SignalGrid's behalf — it exists to keep
> competitive risk low by naming the overlap precisely.

## Executive summary

- **Threat rating: LOW.** Teleport and SignalGrid share genuine *conceptual* DNA (runtime identity-based access decisions, device trust, just-in-time/step-up, session/audit, policy-driven RBAC) but protect fundamentally different things for different buyers. Teleport secures **infrastructure** (servers, Kubernetes, databases, internal web apps, Windows/RDP, cloud consoles, and increasingly GPU/AI infra) for **engineers, machines, and AI agents**; SignalGrid governs **frontline/clinical workflows on shared physical devices** for **non-engineer workers**.
- Teleport's "Device Trust" is a **hardware-attestation gate for managed, individually-assigned engineer laptops** (macOS Secure Enclave / TPM 2.0, one enrollment per user+device, MDM-synced via Jamf/Intune). It has **no concept of shared devices, physical custody, dock/charge/tamper state, or badge-to-holder binding** — the exact primitives that define SignalGrid.
- Teleport does **not** appear anywhere in the healthcare/retail/logistics frontline shared-device space; that market (shared clinical iPads, Zebra scanners, badge tap-in) is served by Imprivata, ManageEngine, Samsung Knox, etc.
- Architecturally the two are opposites: Teleport is an **inline cert-issuing protocol proxy** — you connect *through* Teleport, which mints short-lived certificates and reverse-tunnels traffic. SignalGrid is a **decision API / PDP that sits on top of** existing IAM/UEM/EDR/ITSM and returns allow/step-up/restrict/deny, **not in the data path**.
- **Scale asymmetry:** Teleport is a unicorn ($110M Series C at $1.1B, May 2022; ~$169M raised; 600+ customers incl. DoorDash, Nasdaq, Snowflake, Square, Samsung, IBM), and its 2025-2026 messaging is pivoting toward **AI-infrastructure identity**, not frontline devices. (No later round surfaced as of July 2026.)

## What Teleport is

**Core value prop.** Teleport markets itself as the **"Infrastructure Identity Platform"** — cryptographic identities for humans, machines, and AI agents to access infrastructure, replacing static credentials/VPNs/shared secrets with short-lived certificates and least-privilege access.

**Product pillars (2025-2026):**
- **Infrastructure Access / Zero Trust Access** — passwordless, ephemeral, least-privileged access to protected resources.
- **Identity Governance** — just-in-time access requests (request a role/resource, N approvers, auto-expiry), Access Lists, access reviews; routed via Slack/Jira/PagerDuty.
- **Identity Security (Access Graph / Policy)** — a visual + SQL-queryable graph of "who can access what," lateral-movement/attack paths, standing privileges, shadow access, ITDR-style anomaly alerts across Teleport roles and cloud providers.
- **Machine & Workload Identity** — non-human identity (services, CI/CD via `tbot`, AI agents), eliminating static credentials.
- **Device Trust** — hardware-attested device gating (below).
- **Emerging: Agentic AI Identity** — reference architecture for securing AI agents on infrastructure; MCP (Model Context Protocol) security.

**Architecture.** An **Auth Service** issues short-lived certificates (RBAC restrictive-by-default); a **Proxy Service** establishes reverse tunnels (only port 443 exposed) and proxies native protocols — **SSH, Kubernetes API, databases, internal web/TCP apps, and Windows via RDP** — with automated cloud VM discovery. **Every session is recorded** into a tamper-proof, searchable audit log. Identities: humans (local or SSO), machines/AI agents, and bot users (`tbot`).

**Device Trust — the closest surface to SignalGrid.** Restricts resource access to devices **owned and managed by the org**, establishing device identity via **macOS Secure Enclave** or **TPM 2.0**. Lifecycle: registration (manual `tctl` or auto-sync from **Jamf Pro / Microsoft Intune**) → enrollment (hardware-backed key) → authentication (embeds `teleport-device-*` extensions into the user cert). Crucially, **enrollment happens once per user/device combination** — a **1:1 user-to-device** model for **managed engineer devices**. The docs mention **no** shared devices, physical custody, dock/tamper state, badge binding, or frontline users.

**Target market & scale.** Buyers: platform engineering, DevOps, infrastructure security. Resources: servers/K8s/DBs/internal apps/cloud, increasingly GPU/AI infra. 600+ customers; unicorn since 2022; recognized in 2025-2026 as an AI-infrastructure identity player. **Frontline/healthcare touch: none found.**

## A. Overlap map (honest)

Real, defensible conceptual overlaps a skeptic could raise:

1. **Runtime access decision** — both decide at the moment of access, not just at provisioning.
2. **Device trust as an input** — both treat device trustworthiness as first-class.
3. **Just-in-time / step-up** — Teleport's JIT access requests and SignalGrid's step-up/restrict share "grant the minimum, time-bound, on demand."
4. **Session context & audit trail** — both produce a tamper-evident identity+action+context record.
5. **Policy-as-code / PDP framing** — both externalize access policy from the app.
6. **"Identity is the new perimeter" narrative** — both sell against static credentials/standing access.

These are why a buyer *skimming taglines* might briefly conflate them — but they dissolve on specifics.

## B. Fundamental differences

| Dimension | **Teleport** | **SignalGrid** |
|---|---|---|
| **Resource protected** | Infrastructure: servers, K8s, databases, internal web apps, Windows/RDP, cloud, GPU/AI infra | Frontline/clinical *workflows* (med scan, bedside charting, pick/pack, POS) on shared devices |
| **User type** | Engineers, DevOps, machines/workloads, bots, AI agents | Nurses, clinicians, retail/warehouse frontline — non-engineers |
| **Device model** | Managed, **1:1 user-to-device** engineer laptops, hardware-attested (Secure Enclave/TPM) | **Shared, rotating** iPads / workstations / Zebra scanners |
| **Mechanism** | **Inline cert-issuing protocol proxy** — you connect *through* it (short-lived certs, reverse tunnels) | **Decision API / PDP on top of** existing IAM/UEM/EDR/ITSM — returns allow/step-up/restrict/deny, not in the data path |
| **Physical-custody signals** | **None** — no dock/charge/tamper, no badge-to-holder binding | **Core** — physical custody, badge binding to current holder, CIS/baseline + workflow risk fusion |
| **Buyer / department** | Platform engineering, DevOps, infra security | Clinical/frontline IT & security in healthcare/retail/logistics |
| **Replaces / augments** | Replaces VPN/bastion/SSH keys; **is** the access path | Augments (sits on top of) IAM/UEM/EDR; **is** a decision layer |
| **Footprint** | Horizontal infra/tech, fintech, AI compute | Vertical: healthcare, retail, logistics frontline |

## C. Threat assessment — LOW

**Competitor?** No, not in any current buying scenario. Disjoint resource classes (infrastructure vs. frontline workflows), disjoint users (engineers/machines vs. clinical/frontline workers), opposite mechanisms (inline cert proxy vs. overlay decision API), different departments. Teleport's Device Trust — the one adjacent-sounding feature — is architecturally incompatible with SignalGrid's core problem: it assumes hardware-attested, individually-owned, MDM-managed engineer devices with **no primitive for shared custody, badge-holder identity, or physical device state**.

**Could Teleport move into frontline shared-device decisioning?** Very unlikely medium-term. It would require abandoning the cert-proxy architecture that is its moat, building physical-custody/badge primitives from scratch, and selling into a different buyer with different compliance drivers (bedside HIPAA vs. infra SOC2). Teleport's actual 2025-2026 trajectory is the opposite: deeper into AI-agent/machine identity for infrastructure.

**Any surface where a buyer evaluates both?** Only a large enterprise's central security-architecture team doing a "zero trust / continuous authorization" strategy review, where both might appear as PDP-style controls scoped to different programs (infra access vs. frontline device governance) — and could coexist. No head-to-head RFP exists today.

**Residual risk (why not "negligible"):** the *category vocabulary* overlaps enough ("device trust," "just-in-time," "PDP," "zero trust") that an analyst, investor, or competitor could **mislabel** SignalGrid as "Teleport for frontline devices." That is a **narrative/positioning risk, not product competition** — and it's controllable (below).

## D. Differentiation & keeping competitive risk low

1. **Lead with the physical-world primitive Teleport structurally lacks** — physical custody + badge-to-current-holder binding on a shared device ("who is physically holding this shared iPad right now, and is it docked/tampered?"). Teleport's identity model is purely logical/cryptographic; it has no answer here. Cleanest "different category" wedge.
2. **Say "workflow decision layer," not "infrastructure access."** Describe the protected object as a clinical/operational **workflow firing on a shared device**, never as "resources"/"servers"/"access." "Access" is Teleport's turf; "workflow risk decision at the moment of action" is yours.
3. **Emphasize the overlay/PDP architecture explicitly** — SignalGrid sits on top of IAM/UEM/EDR/ITSM and returns a decision; it is *not* in the data path, *not* a proxy, *not* issuing certificates. Forecloses the "cert-proxy competitor" reading and signals complementarity.
4. **Own the vertical and the non-engineer user** — consistently frame the user as the nurse/clinician/frontline worker and the buyer as clinical/frontline IT & security. Naming the human user differently makes the distinction self-evident and keeps you out of infra-security RFPs.
5. **Avoid the trap phrases** — don't headline "device trust," "just-in-time access," or "infrastructure identity" (Teleport's category terms). Prefer **"custody-aware authorization," "shared-device workflow governance," "moment-of-action risk decisioning."**
6. **Position as complementary, and mean it** — in an enterprise running both, SignalGrid governs the frontline/clinical device layer while Teleport governs backend infrastructure access: non-overlapping planes of the same zero-trust program. If asked, SignalGrid can honestly say it coexists with (even consumes signals from) an infra-access platform, not displaces one. Turns a "competitor" question into an "adjacent, complementary layer" answer.

**Bottom line:** Teleport is **orthogonal-to-adjacent**, not competitive. The overlap is *vocabulary and design philosophy*, not product, mechanism, user, or buyer. Keep the threat low by refusing the shared vocabulary and anchoring on the physical-custody / shared-device / frontline-workflow trio Teleport neither has nor is building toward.

## Sources

- goteleport.com/ and goteleport.com/platform/
- Device Trust docs — raw.githubusercontent.com/gravitational/teleport/master/docs/pages/zero-trust-access/device-trust/device-trust.mdx
- Device Trust architecture — goteleport.com/docs/reference/architecture/device-trust/
- Device management (Jamf/Intune sync) — goteleport.com/docs/zero-trust-access/device-trust/device-management/
- Jamf + Teleport device trust — jamf.com/blog/protecting-infrastructure-with-device-trust/
- Core concepts/architecture — raw.githubusercontent.com/gravitational/teleport/master/docs/pages/core-concepts.mdx
- Identity Governance (JIT, session recording, RBAC) — goteleport.com/platform/identity-governance/
- JIT Access Requests docs — goteleport.com/docs/identity-governance/access-requests/
- Identity Security / Access Graph — goteleport.com/platform/identity-security/ ; goteleport.com/docs/identity-security/usage/
- Machine & Workload Identity — goteleport.com/about/newsroom/press-releases/teleport-unveils-machine-and-workload-identity-solution/
- Secure MCP / AI-agent direction — goteleport.com/use-cases/secure-model-context-protocol/ ; futuriom.com/articles/news/teleport-agentic-ai-forces-an-identity-rethink/2026/01
- Series C ($110M, $1.1B) — prnewswire.com/news-releases/teleport-raises-110-million-series-c-at-1-1-billion-valuation-led-by-bessemer-venture-partners-with-participation-from-new-investor-insight-partners-301537825.html
- Funding history — tracxn.com/d/companies/teleport/…/funding-and-investors
- 2026 Fortune Cyber 60 — goteleport.com/about/newsroom/press-releases/teleport-named-to-2026-fortune-cyber-60-list/
- Frontline shared-clinical-device market (confirming Teleport absence) — imprivata.com/blog/why-shared-mobile-new-gold-standard-clinical-workflow-convenience-necessity ; manageengine.com/products/desktop-central/blog/shared-devices-in-healthcare.html

**Gaps:** Teleport doesn't publicly disclose current ARR/customer count beyond "600+"; no Series D found as of July 2026, so scale figures rest on the May 2022 Series C. goteleport.com returns 403 to automated fetch; product-page claims were retrieved via search snippets and Teleport's GitHub docs, cited as such.
