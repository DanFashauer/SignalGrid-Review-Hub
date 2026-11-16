# SignalGrid — Business Package & Founder Checklist

**Public-safe planning doc. Not legal, financial, or tax advice.** This is the
single map of the business package: what exists and where, and the prioritized
checklist of what only the founder can do. Goal: get to funding, then to a
hardware path (which needs partners and outside services).

---

## Part 1 — The package (what exists, and the disclosure tier)

Share by tier: **Public** = fine to send anyone; **Feedback** = warm contacts;
**NDA** = only under a mutual NDA. Never put NDA-tier material in a public share.

| Asset | Where | Tier | Status |
| ----- | ----- | ---- | ------ |
| Investor / accelerator one-pager | shareable link (Artifacts) + file | Public | ✅ built |
| Tailored one-pager (per contact) | private file, founder-sent | Feedback | ✅ built (Claire version) |
| Pitch deck | `docs/pitch-deck.html` (shareable) | Public | ✅ built |
| Live demos | signalgrid.app/embedded-demo.html, /desktop-demo.html, /console.html (the first two are the paths `.github/workflows/pages.yml` writes) | Public | ✅ built |
| Fundraising map + IP checklist | `docs/research/FUNDRAISING_OPTIONS.md` | Public | ✅ built |
| Executive one-pager (narrative) | `docs/EXECUTIVE_ONE_PAGER.md` | Public | ✅ exists |
| Honest readiness / stage | `docs/research/INVESTOR_DESIGN_PARTNER_READINESS.md`, `docs/LEVEL_10_COMPLETION_MATRIX.md` | Feedback | ✅ exists |
| Competitive positioning | `docs/research/COMPETITIVE_BATTLECARD.md` (+ `docs/competitive-battlecard.html`) | Feedback | ✅ exists |
| Target buyers / partners | `docs/research/TARGET_BUYER_PARTNER_MATRIX.md` | Feedback | ✅ exists |
| Partnership / acquisition paths | `docs/research/PARTNERSHIP_AND_ACQUISITION_PATHS.md` | Feedback | ✅ exists |
| Hardware partner landscape | `docs/HARDWARE_PARTNER_MATRIX.md` | Feedback | ✅ exists |
| "What needs Dan" live dashboard | `docs/WHAT_NEEDS_DAN.md` | Internal | ✅ built |
| Architecture / core method / code | private core | **NDA only** | — hold |

**Still to build (agent can do — tracked in `BUILD_BACKLOG.md`):**
- One-page financial model / use-of-funds (a simple, honest pre-seed version).
- A diligence "data room" index (assembles the Feedback-tier docs behind one link).

---

## Part 2 — Founder checklist (what only you can do)

Sequenced so each step unlocks the next. Rough order, not rigid.

### 🥇 Now — protect + package (before wide outreach)
- [ ] **File a provisional patent** on the method (device-custody + baseline + badge
      fused into one per-action verdict). Engage a patent attorney; this is the
      single highest-leverage move before disclosing to anyone who could build it.
- [ ] **Trademark "SignalGrid"** (word mark; the app category class). Can run in
      parallel with the patent.
- [ ] **Archive the old repo** — `DanFashauer/SignalGrid` (PR #1 merged): Settings →
      General → Archive this repository.
- [x] **Create the `signalgrid-mcp` repo** — done: `DanFashauer/signalgrid-mcp` is public
      and released at v1.0.2 (`docs/API_ACCESS_AND_CONNECTORS.md`, `docs/ESTATE_SYNC_REPORT.md`
      §2.1; corroborated in-tree, not re-fetched on 2026-09-06). Left unticked here until 2026-09-06.

### 🥈 Set up the company (needed before you can take investment)
- [ ] **Incorporate** — a Delaware C-corp is the standard for US venture funding.
      Fastest paths: Stripe Atlas or Clerky (they also handle the initial cap table).
- [ ] **EIN + business bank account** (Mercury / Brex are common for startups).
- [ ] **Assign your IP to the company** (a founder IP-assignment agreement) — VCs
      will require this; do it at formation.
- [ ] **Get a startup lawyer** — even a fixed-fee formation package. Needed for the
      SAFE/priced round paperwork later.

### 🥉 Fund it (see `docs/research/FUNDRAISING_OPTIONS.md` for the full map)
- [ ] **Decide the ask** — how much, for what (pilot + IP + first hardware proto).
      A pre-seed SAFE is the usual instrument.
- [ ] **Apply to 1–2 accelerators** — Y Combinator / Techstars (+ a health or
      security-specific one). Application answers can be drafted by the agent.
- [ ] **Set up a Wellfound (AngelList) profile** so you're "open for investors."
- [ ] **Line up warm intros** to 5–10 pre-seed angels/VCs who look at health +
      security (research fit first — don't cold-blast).
- [ ] **Send the tailored one-pager** to your first feedback contacts (e.g. the
      Claire version) — feedback + design-partner ask, not a hard money ask.

### 🏅 Get a design partner (the real unlock)
- [ ] **Get one frontline org** (hospital ward, warehouse, or data-center/NOC) to
      agree to a small, low-risk pilot. This de-risks funding AND the hardware path.
- [ ] **Sign a mutual NDA** before any deep/architecture conversation.

### 🔧 Hardware path (needs partners + outside services — do AFTER funding/pilot)
- [ ] **Shortlist dock / embedded-hardware partners** (start from
      `docs/HARDWARE_PARTNER_MATRIX.md`) — the embedded-board-in-the-dock and the
      charging-bay/locker approaches.
- [ ] **NDA + intro calls** with 2–3 dock vendors; ask about running software on
      their embedded boards vs. a retrofit module.
- [ ] **Get a rough proto quote** (BOM + NRE) so you can size the hardware ask.
- [ ] **Line up the outside services you'll need:** an embedded/firmware contractor,
      an industrial-design/enclosure shop, and a compliance/testing lab (later).

### 🌐 Go-live (when you're ready to be public)
- [ ] **Domain go-live** — enable WHOIS privacy, add DNS, run the Pages workflow,
      enforce HTTPS (steps in `docs/DOMAIN_SETUP.md`).
- [ ] **Decide repo visibility** for the public review hub vs. what stays private.

---

## Part 3 — What the agent is handling (no action needed from you)

- ✅ The whole `SignalGrid-Review-Hub` build, demos, and honest docs.
- ✅ Investor/accelerator one-pager, tailored one-pager, pitch deck, fundraising map.
- 🔄 Completing the open PRs (#89 refinement; #72 Dependabot needs a staged redo).
- 🔄 A full multi-agent best-practices review of the monorepo (report + safe fixes).
- 🔄 On request: financial model, data-room index, accelerator application drafts,
      the outreach email to send alongside a one-pager.
- ✅ `signalgrid-mcp` pushed and released (v1.0.2 — see the ticked item above).

_Check `docs/WHAT_NEEDS_DAN.md` for the always-current short list of what's waiting on you._
