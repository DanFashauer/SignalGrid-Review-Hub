# IP & licensing posture

**Purpose:** a plain-language orientation to how SignalGrid's intellectual
property is currently held, and the open decisions to settle with a licensed
attorney. This is engineering/business documentation to make counsel meetings
faster — it is **not legal advice**, and nothing here is a filed claim.

Companion: [`REPO_LINEAGE.md`](REPO_LINEAGE.md) (which repo holds what),
[`PUBLIC_MESSAGING_GUARDRAILS.md`](PUBLIC_MESSAGING_GUARDRAILS.md) (what to say
publicly), and the root [`NOTICE`](../NOTICE) and [`LICENSE`](../LICENSE).

## What is protected, and how

| Asset | Protection today | Where it lives |
| --- | --- | --- |
| Public reference code (this repo) | Copyright, licensed **MIT** | `DanFashauer/SignalGrid-Review-Hub` (public) |
| Proprietary decision/orchestration core | Copyright + trade-secret, **all rights reserved** | private repo, not published |
| Hardware / enclosure designs | Copyright + trade-secret; **do not publish** pending counsel | private / offline, not published |
| Invention disclosure(s) | Confidential; prepared for a patent attorney | private / offline, not published |
| The name "SignalGrid" | Claimed as a **trademark** (common-law use) | `NOTICE`, brand usage |
| Dated inventor's record | Preserved git history (do not rewrite) | all repos |

The four distinct protections do different jobs and do **not** substitute for
one another:

- **Copyright** protects the *expression* (the specific code/text). MIT gives it
  away for reuse; that is fine for a public reference and a real choice for the
  core.
- **Trademark** protects the *name/brand* ("SignalGrid"). Independent of the
  code license — the MIT grant explicitly does not license the mark.
- **Trade secret** protects what is *kept confidential* (the private core and
  hardware). Public disclosure ends it, which is why the crown jewels stay
  private.
- **Patent** would protect *methods/apparatus* (if novel and filed). Public
  disclosure can start or forfeit patent rights depending on jurisdiction —
  hence the boundary below.

## Open decisions for counsel (not decided here)

1. **License of the public code — keep MIT, or move to source-available?**
   MIT lets anyone reuse this code freely, including commercially. That is
   appropriate for a *reference/demo subset* and helps adoption/credibility. It
   is a deliberate choice, not a default — if any file here should not be freely
   reusable, it belongs in the private core instead, not under MIT. Decision:
   confirm the MIT boundary is drawn where you want it (reference public, core
   private), with counsel.

2. **Trademark registration.** Common-law rights exist from use; a USPTO
   registration in the right class strengthens them. Do a knock-out search
   (USPTO TESS + web/domain) before spending on branding.

3. **Patent timing.** Parts of the software are already public in this repo.
   Before any *further* public disclosure — especially of the hardware and the
   core fusion method — an attorney should assess what remains protectable and
   whether a provisional application should lock a priority date. Until then,
   the hardware and core method stay private. Three facts drive that rule:

   - **First-to-file.** Since the America Invents Act (2011) the US awards
     priority to the first *filer*, not the first inventor. A self-mailed or
     self-emailed dated envelope — the so-called "poor man's patent" — does
     **not** establish patent rights; the USPTO says so directly. Do not rely
     on it in place of a filing.
   - **Jurisdictions differ, and the difference is one-way.** The US allows a
     one-year grace period following the inventor's *own* disclosure. The EPO,
     China, Japan and most other jurisdictions apply **absolute novelty**: any
     public disclosure before filing forfeits those rights immediately and
     permanently. Publishing first is therefore irreversible outside the US.
   - **A provisional application is the low-cost bridge.** It establishes a real
     priority date and supports "patent pending" for twelve months, which is
     usually enough time to decide on a full filing. Check the current USPTO fee
     schedule for micro-/small-entity rates rather than relying on a quoted
     figure.

   A confidential invention-disclosure record is maintained **offline** (not in
   this repository). It captures the unpublished hardware concepts and lists the
   first-publication dates of the already-public hardware-adjacent documents, so
   counsel can assess grace-period exposure quickly.

4. **IP assignment to the entity.** Once an entity is formed, assign the IP
   (code, designs, marks, any patents) from the individual to the company. This
   matters a great deal to future investors.

## Publication boundary (what keeps patent options open)

- **Public-safe** (may live here): the reference code subset, review docs,
  positioning, the fixture-backed simulator, architecture *overview* diagrams,
  and the public messaging within the guardrails.
- **Keep private** (never commit to this public repo): the proprietary core
  implementation, the hardware/enclosure design and CAD, invention disclosures,
  and any detailed description of the novel fusion method or custody-binding
  hardware beyond the already-public overview.

When in doubt, treat it as private until counsel says otherwise. It is easy to
move something from private to public later; it is impossible to un-disclose.

This applies to *every* public channel, not just this repository: a website, a
demo video, a conference talk, a trade-show display, a social post, or a pitch
deck shown to a non-NDA audience each counts as a public disclosure. The
publication boundary is only as strong as the least careful channel.

## Honest expectations

Copyright and common-law trademark exist automatically from creation and use.
Registration and patents cost time and money and are not guaranteed. The
highest-leverage moves that cost little today: keep the crown jewels private,
preserve the dated git record, NDA anything sensitive shown to vendors or
collaborators, and get a first patent-attorney consult on the calendar before
disclosing the hardware or core method further.
