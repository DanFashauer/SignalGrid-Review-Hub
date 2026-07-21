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
