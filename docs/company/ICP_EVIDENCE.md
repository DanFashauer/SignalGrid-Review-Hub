# ICP evidence — what a shared-device frontline estate actually runs

**Status:** first pass, 2026-08-24. Opened because every buyer claim in this
repository was inferred from the product rather than from anyone who buys.

**Source tiers.** Every finding below carries one. This is not decoration — the
charter for this work says a vendor's own marketing is the weakest evidence
there is, and most of what a search returns on this topic is exactly that.

| Tier | What it is | How much weight |
| --- | --- | --- |
| **1** | Primary and adversarially-tested: patents, regulatory filings, vendor **technical** documentation describing constraints | Highest. A patent must disclose the problem precisely to claim the solution. |
| **2** | An organisation's own operational statement: job postings naming a stack, published integration matrices | Good. Nobody advertises for skills in software they do not run. |
| **3** | Vendor marketing, including a competitor's blog | Weakest. Describes a problem the vendor already sells the answer to. |

---

## Finding 1 — the attribution gap is real and independently documented

**Tier 1.** US patents 11329990, 11838295 and 12425415 ("Delayed and provisional
user authentication for medical devices") disclose that on a shared clinical
device, *"the audit trails may associate the subsequent user with all cumulative
changes, including changes made by the previous user, and the subsequent user may
accidentally approve changes made by the previous user in the audit trail."*

That is a granted patent describing the failure mode as prior art requiring a
remedy — not a marketing claim. It is the strongest single piece of evidence in
this file.

**Tier 3 corroboration:** industry and vendor writing describes the same thing as
"the attribution gap" — on a shared device the session binds to the DEVICE, not
the person, so audit logs point at machines. Treat the framing as useful and the
urgency as sales copy.

**What this means for us:** the problem SignalGrid describes is real and someone
has already patented an answer to a neighbouring version of it. That is
validation of the problem and a warning about the space, in the same fact.

## Finding 2 — the stack is plural, and standardising it is somebody's job

**Tier 2.** A healthcare system posting lists a manager role spanning **Intune,
M365 and Imprivata**, with a responsibility to *standardise device baselines
across Intune and Jamf Pro*.

Read carefully, that single posting supports three things our docs have been
asserting from intuition:

1. Identity (Imprivata) and device management (Intune/Jamf) are **separate
   systems** in the same estate.
2. **Two MDMs coexist** — Intune and Jamf — which is why "mixed vendor stack"
   is a description rather than a hedge.
3. Standardising across them is a **staffed, funded job**, meaning the gap costs
   real payroll today.

**Limitation, stated:** this is ONE posting. It establishes the shape exists, not
how common it is. A frequency claim needs a sample, and this file does not have
one yet.

## Finding 3 — the shift boundary is where it breaks

**Tier 3, but specific.** Industry writing puts the failure at the handoff:
*"every session left open from the previous shift contaminates the access
record"*, and the stated requirement is that a session must end when the
clinician walks away, when the shift changes, or when the workstation passes to
another person.

That is our exact seam. Noting it as tier 3 anyway, because the sources selling
the fix are the ones describing the pain.

## Finding 4 — there is a direct competitor and our docs never named one

**Tier 3, and material.** OLOID markets passwordless EHR access for shared
workstations, and writes specifically about shared devices breaking traditional
IAM and about the attribution gap. IGEL now ships Imprivata Web SSO on a
non-Windows platform, moving badge auth into the browser layer.

Neither is SignalGrid's shape — both are authentication products; we are a
decision layer that answers allow / step_up / restrict / deny and authenticates
nobody.

> **CORRECTION, 2026-08-24.** This paragraph originally ended *"But no
> competitive surface anywhere in this repository names them"*, and that was
> false. A competitive surface existed two weeks before this file was written:
> `docs/research/COMPETITIVE_OLOID.md` (79 lines), `COMPETITIVE_IMPRIVATA.md`
> (74), `COMPETITIVE_TELEPORT.md` (102) and `COMPETITIVE_BATTLECARD.md` (127)
> were all compiled 2026-07-14 with every claim anchored to a URL, plus
> `docs/competitive-battlecard.html` and a rendered `CompetitiveSection.tsx` on
> the review dashboard. IGEL is named in `ECOSYSTEM_POSITIONING.md` and
> `INTEGRATION_CATALOG.md`.
>
> The claim was written without running `pnpm run check:absence`, which is in
> this repository precisely for this and which returns **REFUTED** on the topic.
> `CLAUDE.md` already recorded that two documents had claimed a surface was
> absent while it sat in the tree. This was the third, and the tool that would
> have caught it takes four seconds.

The real gap is narrower and worth stating precisely: the competitive research
is INTERNAL and last compiled 2026-07-14. What it does not yet cover is IGEL's
Imprivata Web SSO move, which is recent. So the work is a refresh of an existing
surface, not the creation of a missing one.

---

## What is NOT established, and must not be inferred from the above

- **Segment size.** Nothing here supports "75–1,000 employees, 1–10 in IT". That
  number appears in `EXECUTIVE_ONE_PAGER.md` and this file does not corroborate
  it. It remains an assumption.
- **Willingness to pay**, price sensitivity, or budget owner. No evidence
  gathered.
- **Whether the attribution gap is felt as urgent** by the buyer, or tolerated as
  a known cost of doing business. The vendors selling the fix say urgent; that is
  precisely the tier-3 problem.
- **Non-healthcare verticals.** Every source here is healthcare. Our docs claim
  the pattern generalises to retail and field service. That generalisation is
  currently unevidenced.

## Next, in order

1. Sample 15–20 job postings rather than one, to turn Finding 2 from a shape into
   a frequency.
2. Find a published case study or conference talk where an estate describes the
   handoff failing in their own words — tier 2 evidence for Finding 3, which
   currently rests on tier 3.
3. REFRESH — not build — the competitive research. `docs/research/COMPETITIVE_*`
   already covers OLOID, Imprivata and Teleport from anchored sources, last
   compiled 2026-07-14. Re-verify those briefs against today and add IGEL's
   Imprivata Web SSO move, which postdates them. Check what exists before
   writing that it does not: `pnpm run check:absence <topic>`.

---

## Finding 8 — the audience the founder's public writing actually reaches, measured

**Added 2026-08-25.** Source: a LinkedIn creator analytics export for
**3 April – 1 July 2026**, supplied by the owner from his own Drive with explicit
permission to use it for the company. The underlying posts are already public;
what is new here is the measured composition of who saw them.

**This is a new evidence shape for this file, and it needs its own weight.** The
three tiers above rank what a SOURCE is worth. This is neither a primary document
nor an organisation's operational statement — it is a **demand-side signal**: who
chose to read a founder writing about this problem, unprompted, with no product
being sold. Treat it as corroboration for a vertical, never as pipeline.

### What it does NOT establish, stated first

- **It is small.** ~14.6k impressions and ~6.5k members reached across 90 days,
  from an account with a few hundred followers. That is a signal about
  composition, not reach.
- **An audience is not a buyer.** Nobody in this dataset asked for a demo,
  entered a pipeline, or spent anything. Reading is not intent.
- **Engagement is thin in absolute terms.** The best-performing post drew roughly
  1.3% engagement against its impressions.
- **Named companies are deliberately absent below.** The export identifies
  specific employers in the audience, including one health system and one device
  management vendor. Those names stay in the owner's private Drive per the
  standing rule that the named target list never enters this public repository —
  and naming an employer whose staff merely read a post would imply a
  relationship that does not exist. That is the overclaim this file exists to
  prevent.

### What it does establish — composition

| Dimension | Measured | Why it matters here |
| --- | --- | --- |
| **Industry** | IT services & consulting 28%; software development 10%; **hospitals and health care 8%**; technology/internet 6%; financial services 6%; computer & network security 4% | Healthcare arrives at 8% ORGANICALLY, against writing that is mostly about endpoint management generally. The vertical this repo chose is over-represented relative to a generic IT audience. |
| **Seniority** | Senior 47%; entry 20%; **director 7%, CXO 4%, VP 3%** | The champion tier — senior individual contributors who have walked the failure themselves — is the bulk. The economic-buyer tier is present at ~14% but thin. `WHY_THIS_EXISTS.md` predicted exactly this split; this is the first measurement of it. |
| **Company size** | 10,001+ employees 20%; 1,001–5,000 11%; 5,001–10,000 4% | Roughly a third of the audience sits in enterprise-scale estates — the only size where shared-device custody is a program rather than a preference. |
| **Geography** | One metropolitan area accounts for 28% | Heavily concentrated in the founder's own region. Read as a network effect, not as market demand. |

### The two posts that actually travelled

Both are already public, and both are cited by `WHY_THIS_EXISTS.md` from their
titles alone. This export adds the measurement:

- A post on how much enterprise IT work is repetitive rather than novel —
  ~2.5k impressions, the highest engagement count in the period.
- **"What managing 200k devices taught me"** — ~1.8k impressions, the
  second-highest engagement.

The observation worth keeping: the two best-performing posts are both about the
LIVED EXPERIENCE of operating at scale, not about a product, an architecture, or
a category. The lowest performers are the category-tagged posts. That is a
positioning input — `positioning-messaging` owns it — and it argues the founding
story is the asset, which is the premise `WHY_THIS_EXISTS.md` was written on.

### What follows from this

1. **Healthcare stays the first vertical**, and this is the first evidence for
   that choice that did not come from the product's own design.
2. **Write for the champion, not the buyer.** 47% senior IC against 14%
   director-and-above says the person who recognises the problem is not the
   person who signs. The pilot package should be something a senior engineer can
   run and then show upward.
3. **A device-management vendor's staff are in the audience.** The specific name
   stays in the owner's Drive, but the fact matters: this repo has already chosen
   an MDM to build against, and there is a warm surface for a partner
   conversation. `positioning-messaging` and the owner own that call — it is an
   outreach decision, not a repo change.
