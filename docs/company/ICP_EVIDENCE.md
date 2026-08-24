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
nobody. **But no competitive surface anywhere in this repository names them**,
and a buyer who has heard of OLOID will ask. That is a positioning gap, not a
product one.

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
3. Build the competitive surface naming OLOID, Imprivata and IGEL with what each
   actually does, so the difference is stated by us before a buyer states it.
