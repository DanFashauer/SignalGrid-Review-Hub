# SignalGrid — Competitive Battlecard

> **Audience:** sales / founder-led selling. **Source of truth:** the cited
> evaluations in this repo — [`MARKET_LANDSCAPE.md`](./MARKET_LANDSCAPE.md),
> [`COMPETITIVE_OLOID.md`](./COMPETITIVE_OLOID.md),
> [`COMPETITIVE_IMPRIVATA.md`](./COMPETITIVE_IMPRIVATA.md),
> [`COMPETITIVE_TELEPORT.md`](./COMPETITIVE_TELEPORT.md). **Rule of the card:**
> be honest. We win by being *narrow and true*, not by claiming everything. Never
> overclaim custody certainty, compliance, or novelty on "step-up." Where a
> competitor already wins, say so and reframe.
>
> **Visual version:** a self-contained, theme-aware HTML rendering of this card is
> at [`competitive-battlecard.html`](./competitive-battlecard.html) (open in a
> browser) — it renders the competitor threat levels in SignalGrid's own
> allow/step-up/deny decision colors.

---

## 1. The 10-second frame

> **"SignalGrid is a vendor-neutral decision layer that answers one question at the moment a high-risk workflow fires on a *shared* device: *is the person holding this device right now allowed to do this — given who's badged in, whether the device is in trusted custody, and its security baseline?* We sit on top of your IAM, badge/SSO, UEM and EDR — we don't replace them."**

- **Category words to USE:** custody-aware authorization · shared-device workflow governance · moment-of-action decisioning · decision/attribution layer · vendor-neutral overlay.
- **Trap phrases to AVOID** (they hand the frame to a competitor): "device trust," "just-in-time access," "infrastructure identity" (→ Teleport); "passwordless login," "badge tap," "kill shared passwords" (→ OLOID); "badge SSO," "tap-and-go," "EPCS" (→ Imprivata). We are **not** an auth product.

---

## 2. The three-pillar moat — always anchor here

Every serious player now says "runtime access decision," "device trust," "step-up." That is **not** our moat. Our defensible ground is exactly three things competitors don't fuse:

1. **Physical custody + tamper as a decision input** — is the shared device docked / charging / in-hand / **tampered**, and is the badged-in holder still the one using it? (Others use charge/dock state for *logout hygiene*, not as a *gating signal in the verdict*.)
2. **CIS / security-baseline drift fused into the decision** — not just "is the device enrolled," but "has it drifted from baseline," as a weighted input.
3. **Vendor-neutral overlay PDP** — one fused allow/step-up/restrict/deny verdict **and one audit plane** across a mixed IAM/UEM/EDR/ITSM/badge stack. We consume others' signals; we don't own the login.

If a deal doesn't touch at least one of these three, it's not our wedge — qualify hard (see §5).

---

## 3. Discovery questions (surface the wedge; disqualify fast)

- "When a nurse/associate does a **high-risk action** on a **shared** device — controlled-substance pull, inventory override, high-value refund — what decides whether it proceeds *right then*? Is that decision the same across every app?"
- "Who was **physically holding** that device at that moment, and how do you know? What happens if it's undocked, low battery, or walked off?"
- "How many **different vendors** touch that decision today — IdP, badge/SSO, UEM, EDR, ITSM? Is there **one** place that fuses them into a verdict and **one** audit trail, or is it stitched together?"
- "Do you evaluate **device security-baseline drift** at the moment of action, or only at enrollment?"
- "Outside healthcare — in your **retail/warehouse** sites — what's watching shared-scanner workflows? (Often: nothing.)"

Green flags: mixed multi-vendor fleet · non-EPCS high-risk workflows · retail/logistics frontline · "our audit can't say *why* an action was allowed." Red flags: "we just need passwordless login" · "we only need EPCS" · single-vendor all-Imprivata healthcare shop with no mixed-fleet pain.

---

## 4. Where we WIN / where we WALK

| WIN when… | WALK (or partner) when… |
|---|---|
| Mixed, multi-vendor frontline stack needing **one** decision + audit plane | Pure "kill shared passwords / passwordless login" ask → that's OLOID's |
| **Retail / warehouse / logistics** frontline (incumbents shallow here) | Deep all-Imprivata healthcare shop wanting only badge-SSO + EPCS |
| Buyer wants per-action gating **without changing how workers log in** | Buyer wants to *replace* their IdP/badge system (we're an overlay, not a replacement) |
| **Custody/tamper** or **baseline-drift** is a felt pain | Infrastructure/server/K8s access for engineers → that's Teleport; refer and move on |
| Audit must explain **why** a decision was made, not just who acted | Compliance mandate is satisfied by attribution alone |

---

## 5. Per-competitor quick cards

### 🟥 OLOID — threat HIGH (closest thesis-twin)
- **Their strength (concede it):** owns the passwordless-frontline-login + badge-attribution frame, HIPAA/21 CFR Part 11 story, real logos, Okta/Entra/Ping/Workday certs, and hardware (readers/time-clocks). Their **FIL** (May 2026) is moving toward per-action governance.
- **Our wedge:** OLOID *attributes at login*; we *decide per action*. We fuse **custody/tamper + CIS baseline** (they don't) and are a **neutral overlay** (they're auth-led + hardware-led). FIL routes high-risk actions to a **human for approval**; we **compute** a multi-signal verdict and escalate to a human only as one outcome.
- **If they say "OLOID already does this":** "OLOID resolves *who's logged in* and logs it — brilliantly. We decide *whether this specific action should proceed* given device custody and baseline, across your whole stack, and can take OLOID's badge event as an input. Different job, same shift."
- **Walk/partner:** if the whole ask is passwordless login + attribution, it's theirs. Offer coexistence (consume their attribution).
- **Watch:** FIL roadmap — the feature most likely to erode our edge. Don't claim "per-action" as unique; claim **automated multi-signal fusion incl. custody/baseline** as unique.

### 🟥 Imprivata — threat HIGH (healthcare) / MEDIUM (retail-logistics)
- **Their strength (concede it, loudly):** in healthcare they own badge tap-in/tap-out, roaming sessions, Entra Seamless SSO, **per-transaction EPCS step-up**, posture checks, charge-state custody — and bought **Verosint** (Nov 2025) for runtime risk decisioning. "We already own the badge; attribution's free" is *largely true*.
- **Our wedge:** a **vendor-neutral, unified** per-action verdict fusing custody(+**tamper**) + **CIS baseline** + posture + badge + workflow risk into **one decision + one audit plane** across a **mixed** fleet — and we **consume the Imprivata badge as a signal** rather than replace it. Their pieces are distributed across a single-vendor stack; custody is used for session hygiene, not as a fused decision input.
- **If they say "isn't this just Imprivata?":** "If you're all-Imprivata in one hospital, they cover most of this. We're for the **mixed fleet** and the **non-EPCS workflows** — and we sit *above* Imprivata, taking its badge as one input while adding device custody and baseline into a single decision and audit trail. We don't replace the badge."
- **Do NOT fight head-on:** badge-SSO, roaming, Entra SSO, EPCS signing. You will lose.
- **Best ground:** retail/warehouse/logistics (Imprivata present but shallow) — move fast. **Verosint counter:** if their risk signals stay identity/fraud-centric (ATO, MFA fatigue) vs device-custody/baseline, that boundary is our durable edge.

### 🟩 Teleport — threat LOW (orthogonal/adjacent)
- **Their world:** infrastructure access — servers/K8s/DBs/apps for **engineers, machines, AI agents** via a cert-issuing protocol proxy. Their "Device Trust" = hardware-attested **1:1 engineer laptops**; no shared-device/custody/badge notion.
- **Our wedge:** different resource (frontline *workflows* not servers), different user (clinical/frontline not engineers), different mechanism (overlay decision API, not an inline proxy).
- **If they say "isn't this Teleport for devices?":** "Teleport secures how engineers reach infrastructure. We decide whether a *frontline worker's action on a shared device* should proceed. Non-overlapping planes — they can run both." Then leave it; not a real contest.

### ⬜ Microsoft Entra (shared device mode + CAE) — objection more than competitor
- **Their strength:** Conditional Access + Continuous Access Evaluation + Shared Device Mode + device posture — native, and many buyers are Microsoft-standardized.
- **Our wedge:** Entra decides at **session/token** granularity and assumes *session = person*; it does not fuse **physical custody / badge-holder at action time**. We **extend** Entra (consume its posture/CAE signals), we don't compete with it.
- **If they say "we already have Entra":** "Perfect — we sit on top of it. Entra tells us the session and posture; we add *who is physically holding this shared device* and *should this action proceed*, and write one decision trail. It's an Entra multiplier, not a replacement."

### ⬜ Runtime-authz / PDP engines (Cerbos, SGNL/CrowdStrike, Oso, PlainID…) — vocabulary overlap
- **Their world:** fine-grained authorization for **software/app resources** (ABAC/ReBAC/policy-as-code). SGNL (being acquired by CrowdStrike, ~$740M, Jan 2026) does identity+device+behavior for enterprise/cloud/AI-agent access.
- **Our wedge:** we're a PDP for **physical shared-device frontline workflows** with custody/badge/baseline signals a generic authz engine has no concept of. Frame: "same PDP *pattern*, a signal set and buyer they don't serve."

---

## 6. Top objections → one-line responses

- **"Isn't this just Imprivata / OLOID?"** → "Those own the *login and badge*. We own the *decision at the moment of action*, across your whole stack, and we take their badge as an input. We're a layer above, not a replacement."
- **"We already have Entra Conditional Access."** → "Great — we consume it. Entra decides the session; we decide the *action on a shared device* using custody and baseline it doesn't track."
- **"We already do step-up for controlled substances (EPCS)."** → "That's mandated and solved. We're for the *other* high-risk workflows and the mixed-fleet fusion + one audit trail — not EPCS re-invention."
- **"Sounds like a policy engine / PDP."** → "It is one — for the physical frontline. The novelty is the signals (custody, tamper, badge-holder, CIS drift), not the pattern."
- **"How reliable is 'custody' really?"** → "It's one *weighted* evidence input, never ground truth. We publish false-accept/false-reject behavior and let policy decide how much it counts." *(Never overclaim custody certainty.)*
- **"Is this production-ready / certified?"** → *(Honesty guardrail)* "Today it's a fixture-backed, public-safe decision core with real integration adapters gated behind explicit config. It is not compliance-certified and doesn't replace your source systems. Here's exactly what it decides today." (→ `WHAT_SIGNALGRID_DOES_TODAY.md`)

---

## 7. Coexistence plays (turn "competitor?" into "adjacent layer")

- **Consume, don't collide:** OLOID/Imprivata badge event → SignalGrid decision input. Entra CAE/posture → input. Teleport → different plane entirely.
- **The Switzerland pitch:** "We're the one neutral place that fuses all of them into a verdict and a single audit trail — including vendors you already bought."
- Every coexistence framing de-risks the RFP: you stop being scored as "a worse [incumbent]" and become "the missing decision layer above them."

---

## 8. Landmines (disqualify or partner — don't force it)

- All-single-vendor healthcare shop, ask = badge-SSO + EPCS only → Imprivata's; walk.
- Ask = passwordless login / kill shared passwords → OLOID's; walk or partner.
- Infrastructure/server/engineer access → Teleport's; refer.
- Buyer wants to *replace* IdP/badge/UEM → we're an overlay; reset expectations or pass.
- Compliance need met by attribution alone (no "why") → thin value; requalify.

---

### One sentence to leave in every prospect's head
> *"You've already bought identity, badges, and device management — SignalGrid is the neutral decision layer that fuses them, plus device custody and baseline, into one allow/step-up/deny verdict at the moment a shared-device workflow fires, with an audit trail that explains **why**."*
