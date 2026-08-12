# Inspiration & positioning references

A working mood-board and positioning reference for SignalGrid. These are *external
references we learn framing from* — not claims, not endorsements, not partnerships.
Nothing here implies certification or affiliation with any named vendor. The point
is to sharpen how we explain the grid: **many read-only signals → one verdict →
one automated response, run by workflows you configure.**

> **Core thesis to keep front-and-center in every surface:** the user does not
> drive the decisions. Signals stream in; the workflows you've configured fuse
> them and fire the action **automatically**. The more signals you add, the
> *smarter* the grid gets; the more workflows you add, the *more of the
> organization's infrastructure* the grid controls. Adding is the product.

---

## 1. The IAM landscape (uploaded reference)

A one-page "Identity & Access Management — the complete landscape" infographic,
organized as **three columns**:

| Column | Contents (abridged) |
|---|---|
| **IAM Domains** | Identity Governance (IGA), Access Management / SSO, CIAM, Privileged Access (PAM), Directory / identity store, Authentication services (MFA/passwordless/adaptive), Identity lifecycle (joiner/mover/leaver), API security & federation, Cloud & workload identity, Zero-Trust architecture, Identity Threat Detection & Response (ITDR), AI & identity security |
| **Core Capabilities & Concepts** | Identity modeling, Authentication, Authorization, Federation, Provisioning, Access certification, Policy & governance, **Monitoring & audit**, **APIs & connectors**, **Risk & context**, Compliance, **Automation & orchestration** |
| **Business Outcomes** | Reduce insider risk, Zero-Trust enablement, Regulatory compliance, Least-privilege access, Operational efficiency, Better UX, Secure cloud adoption, Faster on/offboarding, Business agility, Lower audit & access risk |

**Why it's useful to us — the structural lesson, not the content:**

- **Domains → Capabilities → Outcomes** is a clean way to tell a "whole
  landscape" story. SignalGrid's analog:
  **Signals (domains) → the Grid + Workflows (capabilities) → Outcomes.**
- Identity is presented as *one domain among twelve*. That's exactly how
  SignalGrid should present identity/SSO risk: **one signal among many**, not the
  whole story. Our differentiation is the *fusion + automated action across* all
  the domains, which this poster lists as separate capabilities ("Risk & context",
  "Automation & orchestration", "Monitoring & audit", "APIs & connectors").
- The **outcome language** is the register buyers actually reward — write our
  value in those terms (reduce insider risk, least privilege, faster off-boarding,
  lower audit risk, operational efficiency), backed by the concrete decision the
  grid took.

> Licensing note: the source image is a third-party infographic. We deliberately
> do **not** commit the raw JPEG to this public repo — this written synthesis
> (our own words) is the durable, shareable form. Keep the original in a private
> inspiration store if needed.

**SignalGrid mapping table** (reusable in decks / site copy):

| IAM poster element | SignalGrid element |
|---|---|
| The 12 IAM *domains* | Signal sources / connectors (identity is just one) |
| "Risk & context" capability | The composed verdict (strongest-action fusion) |
| "Automation & orchestration" capability | Workflows that fire the action automatically |
| "Monitoring & audit" capability | Tamper-evident audit ledger + one prioritized incident |
| "APIs & connectors" capability | Read-only connectors (Graph, EDR, DLP, RTLS, NAC, …) |
| Business Outcomes column | What we headline; the decision is the proof underneath |

---

## 2. Verdict-first signal fusion (XDR)

The industry is converging on **verdict-first**: correlate signals across the
whole attack surface *before* a human is engaged, and hand over **one
high-fidelity case** instead of 500 disconnected alerts — cutting noise
dramatically. This is precisely SignalGrid's "**one verdict + one prioritized
incident**", with our **no-noise rule** (a calm fabric raises zero tickets) as the
same idea taken to its logical end.

Language worth borrowing: *"one high-fidelity case file, not a pile of alerts,"*
*"triage before a human is engaged,"* *"reduce noise before review."*

- XDR signal fusion — definition & concepts: https://www.securview.com/ai-security-essentials/xdr-signal-fusion
- SOAR vs SIEM vs XDR (what each layer does): https://www.paloaltonetworks.com/cyberpedia/what-is-soar-vs-siem-vs-xdr
- XDR vs SIEM vs SOAR: https://www.crowdstrike.com/en-us/cybersecurity-101/next-gen-siem/xdr-vs-siem-vs-soar/
- XDR vs SOAR — orchestration vs automation: https://www.hexnode.com/blogs/xdr-vs-orchestration-vs-automation-in-response/

**Boundary we must keep honest:** SignalGrid is a *runtime decision + orchestration
layer for frontline/shared devices at the moment a workflow fires* — it does not
replace an XDR/SIEM/SOAR platform, and we never claim it does. We fuse read-only
signals into a decision; we don't ingest and store the enterprise's full security
lake.

---

## 3. Zero-Trust policy engine (NIST SP 800-207)

NIST SP 800-207 frames zero trust as **"trust is never granted implicitly but must
be continually evaluated."** Its architecture is a **Policy Engine + Policy
Administrator + Policy Enforcement Points (PEPs)** placed close to the resource.
The policy engine **continuously evaluates contextual signals** — identity, device
posture, network context, location, behavioral analytics, data sensitivity, threat
intelligence — and drives **automated, risk-based decisions** enforced at the PEPs.

This is the cleanest external articulation of SignalGrid's own model:

- **Policy Engine** ≈ the grid's fusion/decision core.
- **Continuously evaluated signals** ≈ our read-only signal dimensions.
- **Policy Enforcement Points** ≈ the workflows that carry out the action.
- **"Every session policed live, every anomaly triggers evidence"** ≈ our verdict
  + audit ledger per decision.

It also anchors the honest register: continuous *verification*, least privilege,
*automated enforcement* — decisions the system makes, not knobs a human turns.

- NIST SP 800-207 overview: https://www.paloaltonetworks.com/cyberpedia/what-is-nist-sp-800-207

---

## 4. What this changes about how we demo & message

1. **Show the grid acting, not a human operating.** The interactive demo presents
   scenarios (events that happen to the fleet); signals are **read-only status**;
   the **workflow fires the response automatically**. No per-signal knobs, no
   "approve" button in the core loop.
2. **Make "add more = smarter + more control" explicit.** Surface the live count
   of signals and workflows, and state that every addition widens coverage and
   deepens control over the organization's infrastructure ("the grid").
3. **Headline outcomes, prove with the decision.** Lead with the business outcome
   (insider-risk down, least privilege, faster off-boarding); underneath it, show
   the exact fused verdict + the automated action + the one incident.
4. **Stay inside the honest boundary** from `docs/WHAT_SIGNALGRID_DOES_TODAY.md`
   and `docs/PUBLIC_MESSAGING_GUARDRAILS.md`: no replacement/partnership/
   certification claims, read-only signals, action plane simulated until an owner
   turns it on.

---

## Filed reference documents

- [Spatial trust & session-control research report](SPATIAL_TRUST_RESEARCH_REPORT.md)
  — the owner-supplied deep-research report behind intake ledger row 17
  (external validation of the Facility Trust Graph architecture; source of the
  zone-presence state machine built in `transition.ts`).
- [Communications Systems & Mobile Apps API & GitHub catalog](COMMUNICATIONS_SYSTEMS_API_CATALOG.md)
  — the owner-compiled 441-system inventory behind intake ledger row 47 (16
  ecosystems from GSMA Open Gateway/CAMARA and CPaaS through mission-critical
  PTT, clinical communications and mobile-OS push; 71 CAMARA API records, 97
  mobile applications, 71 open-source resources, 66 standards; verified
  2026-08-02, all five bundle hashes and every stated count re-derived at
  intake). Its audit produced zero new verbs: the fabric already covers the
  decision-relevant senses of presence, reachability, network quality,
  authorized-region and dispatch ownership. Two boundaries are load-bearing —
  CAMARA availability is commercial rather than technical, and **"verify
  delivery" is a named refusal**: a platform receipt is dominated by a human
  acknowledgement, and the only thing it would add is permission to stop
  escalating.
- [OT / ICS / SCADA & Industrial Control API & GitHub catalog](OT_ICS_SCADA_API_CATALOG.md)
  — the 151-platform industrial inventory behind intake ledger row 45, and the
  only catalog in this folder **compiled by this repository** rather than
  supplied by the owner (verified 2026-08-02). Ten sections spanning OT asset
  visibility and ICS network monitoring, SCADA/HMI/DCS, PLC/RTU/IED and safety
  controllers, historians/gateways/protocol tooling, OT remote access, OT
  segmentation, industrial SIEM, open-source ICS security tooling, digital twin,
  and standards including ATT&CK for ICS. Because the repo authored it, the rows
  carry the repo's own honesty bar: 120 verified documentation URLs, 76 verified
  repositories, and 28 rows honestly recorded as "no detailed public contract
  located". Paywalled bodies (IEC 62443, ISA-95/99, ISO) appear by title and
  scope only. It carries the Purdue-level mapping against the fabric that
  actually exists, the change-window gap, and the **safety-state refusal** —
  SignalGrid gates who may attempt a bypass; the plant's safety system decides
  whether the machine is safe to move.
- [Asset Management & IT Governance API & GitHub catalog](ASSET_MANAGEMENT_IT_GOVERNANCE_API_CATALOG.md)
  — the owner-compiled 330-product inventory behind intake ledger row 44
  (16 ecosystems spanning ITAM/CMDB/SAM, SaaS management, cyber-asset
  intelligence, EAM/CMMS, FinOps/TBM, enterprise architecture, PPM, GRC/IRM,
  TPRM, data governance, policy-as-code, DAM and software supply-chain; 40
  open-source resources; 28 standards; 10 repository mappings; verified
  2026-08-02). The relevance score is the owner's internal sequencing model,
  never an analyst ranking; source platforms remain systems of record; the
  launch wedge stays Entra + Intune + one shared-device host app, with the
  first authoritative-asset connector design-partner-sequenced at P1.
- [ControlUp ONE / DEX / EUC & Digital Experience API Catalog](CONTROLUP_DEX_EUC_API_CATALOG.md)
  — the owner-compiled 62-platform inventory behind intake ledger row 36
  (direct DEX/EUC, VDI/DaaS-native, network/SASE DEM, observability, and
  endpoint-automation adjacencies; per-row API access classes, GitHub coverage
  honesty, 12 standards; verified 2026-08-01). The similarity model is the
  owner's internal comparison, never an analyst ranking; DEX platforms remain
  systems of record; sequencing preserved — the Entra+Intune wedge first, one
  read-only DEX platform per design-partner demand, governed remediation only
  after simulation/approval/rollback evidence.
- [Mobile App & Managed Configuration Master Catalog](MOBILE_APP_CONFIGURATION_CATALOG.md)
  — the owner-compiled mobile-application and managed-configuration inventory
  behind intake ledger row 33 (760 master app/mobile-surface records spanning
  confirmed Intune-protected apps, curated industry clients, candidate
  ecosystem surfaces and repo-defined host-app workflow models; 101
  managed-configuration keys; the build-metadata / AppConfig-declaration /
  assigned-payload / App-Protection / post-configuration-recording
  distinctions; verified 2026-08-01). Candidate rows are not claims;
  "Intune protected partner app" means Microsoft's catalog, never a
  SignalGrid partnership; companion scanner/recorder artifacts are
  dispositioned in ledger row 33.
- [Mobile-app catalog agent — unhardened reference source](MOBILE_APP_CATALOG_AGENT.md)
  — the owner's repository-scanner source and catalog JSON Schema, preserved
  verbatim with SHA-256 provenance and the intake audit's VERIFIED defect list
  (secret-leak path, symlink escape, non-determinism). Reference only; the
  hardened integration is the queued YELLOW-lane scanner phase in
  `docs/BUILD_BACKLOG.md`, and the scheduled PR-creating workflow is
  deliberately unwritten pending explicit owner approval.
- [Mobile post-configuration recorder — reference contract](MOBILE_CONFIG_RECORDER_CONTRACT.md)
  — the recorder JSON Schema + PostgreSQL model, preserved verbatim behind a
  binding preamble: nothing in this repository consumes them, the tenant
  recorder tables describe a private data plane that never enters this tree,
  an unproven rollback never permits a deploy, and version stamping defers to
  the queued normalization-version build.
- [Technology Ecosystem Master Catalog](TECHNOLOGY_ECOSYSTEM_MASTER_CATALOG.md)
  — the owner-compiled 21-sheet consolidation of the CIS, physical-access and
  endpoint catalogs, expanded across sixteen ecosystem domains (423 master
  entries with per-row source URLs and access classes; verified 2026-07-31).
  Filed as the ecosystem STRATEGY map, explicitly not a build queue — the
  launch path stays Entra+Intune → one shared-device workflow → one pilot →
  demand-driven expansion. The partner/buyer sheet is deliberately omitted
  from the public file (publication boundary).
- [Endpoint Management API & SignalGrid repository catalog](ENDPOINT_MANAGEMENT_API_CATALOG.md)
  — the owner-compiled ten-sheet inventory behind intake ledger row 27 (135
  API/platform entries across MDM/UEM/EMM, RMM, DEX, security/telemetry and
  platform standards; 45 open-source resources; 31 SignalGrid repository
  mappings; launch sequencing and the canonical normalized endpoint signal
  set; verified 2026-07-31). Reference material only — the adopted strategy is
  its own: one Microsoft-backed shared-device workflow first, breadth from
  design-partner demand.
- [Physical Access Control API & GitHub catalog](PACS_VENDOR_API_CATALOG.md)
  — the owner-compiled, source-linked inventory behind intake ledger row 26
  (61 vendor/API entries, 24 open-source resources, 10 standards, and the
  recommended SignalGrid integration sequencing with per-tier minimum signal
  sets; verified 2026-07-31). Reference material only: no dependency taken,
  and every future adapter stays behind connector discipline.
