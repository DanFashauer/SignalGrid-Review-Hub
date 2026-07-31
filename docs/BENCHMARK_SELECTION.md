# Benchmark selection — which CIS benchmark graded this device, and from what content

## The gap this closes

SignalGrid already consumes a baseline-alignment result as a decision input:
`BaselineState = aligned | partial | drifted | not_assessed | unknown`
(`lib/signalgrid-core/src/types.ts`, documented in
[Security-Baseline Alignment](SECURITY_BASELINE_ALIGNMENT.md)).

That axis records the **answer** and nothing about the **question**. A device
running macOS 26 Tahoe, graded against the *Apple macOS 12.0 Monterey* benchmark,
reports `aligned` — and every surface downstream reads that as a hardened device.
The bar was wrong, so the answer means nothing, and nothing in the fabric could see
it.

That is this fabric's recurring defect — the **unearned affirmative**, a positive
state reported without the thing it claims having been established — in the
hardening plane. `benchmark-selection` withdraws it.

## What it grades

Five independent questions, each answerable from what a real assessor already
reports. None of them is "did the device pass" — that stays with the baseline
dimension, deliberately.

| Question | Axis | How it is answered |
| --- | --- | --- |
| Is this a real, current benchmark? | `recognition` | `(title, version)` looked up in a committed snapshot of the published CIS catalog |
| Whose content produced the result? | `provenance` | CIS's own published content, a named third-party implementation, or a bare "CIS" label |
| Does the document target this device? | `platformMatch` | the platform the **document** declares vs the platform the **tool** read, both reported by the assessor |
| How much was actually evaluated? | `coverage` | rule counts that must reconcile to their own stated total |
| Is it the benchmark this work requires? | `requirementFit` | membership in a caller-supplied allowlist for the workflow |

| Observation | Verdict | Why |
| --- | --- | --- |
| recognized + CIS content + matching platform + complete coverage + on requirement | `none` — the grant | the right document, honestly sourced, adequately covered |
| the document targets a **different platform** than the tool read | `restrict` | the wrong-bar case, caught affirmatively rather than inferred |
| the counts reconcile and **zero rules were evaluated** | `restrict` | a perfect score over an empty denominator |
| a title the published catalog **does not carry** | `alert` | measurement is broken at operator scale, not for one device |
| a real benchmark that is **not the one this work requires** | `alert` | a citation/targeting failure — it must not block a correctly hardened device mid-shift |
| a **superseded** version, or one not listed for that title | `step_up` | a real document at a bar the catalog no longer leads with |
| the tool only **labels** its checks "CIS" | `step_up` | a label is a name, not a provenance |
| **no requirement** stated for this workflow | `step_up` | nobody said what the bar is — a hole, not a pass |
| a **third-party implementation** of CIS-aligned checks | `monitor` | real work, but not CIS's published content, and the verdict says so |
| errors or skipped rules remain | `monitor` | partial coverage |
| any axis unknown | `step_up` | unknown raises, never grants |

## Provenance — the rule that a label is not a provenance

Most fleets do not assess with CIS-CAT. They use **kube-bench**, **Prowler**,
**ComplianceAsCode**, **usnistgov/macos_security**, **ansible-lockdown**, or
**steampipe/powerpipe** compliance mods. Those are real projects doing real work,
and they are *implementations of* CIS-aligned checks — not CIS's published content.

So the dimension refuses two things:

- It never **represents a third-party implementation as official CIS content**. An
  `independent_implementation` result is a `monitor` finding, carried with the tool's
  name and version, never a confirmed selection.
- It never **infers compliance because a tool labels its checks "CIS"**. That is
  `tool_declared` — an asserted name with no stated content source — and it raises.

An **absent** provenance normalizes to `unknown` and raises. A tool that was never
asked has not answered, and defaulting the silence to `cis_published` would
reinstate exactly the affirmative this axis exists to withdraw.

## Coverage — the denominator is load-bearing

The first draft of this dimension collected `rules_total` and never read it. A scan
that evaluated 3 rules out of 400 graded `complete` and **granted** — this
dimension reproducing, inside itself, the defect it was built to catch. Two
independent adversarial reviews found it before it shipped.

The fix is an **accounting identity**, not a threshold:

```
passed + failed + not_applicable + error + not_checked === total
```

A report whose buckets do not reconcile to its own denominator contradicts itself
and grades `ungraded` → `step_up`. Because it is an identity, no coverage percentage
had to be chosen — there is no tuned number anywhere in this dimension.

Two related rules: `not_applicable` is **excluded from the numerator** (a run that
found 98% of a benchmark inapplicable evaluated almost nothing), and an **absent
count is `null`, never `0`** — a defaulted zero is precisely how a missing
denominator becomes a clean bill of health.

## Persona and workflow binding

The requirement is **caller-supplied**, like every policy in this fabric. An
organisation's bar for a given persona and use case is theirs to state; the fabric
grades membership and never invents which benchmark is right.

This is what makes the catalog's variants decision-relevant. *Apple macOS 15.0
Sequoia*, *…Sequoia Intune* and *…Sequoia Cloud-tailored* are **three separate
catalog rows** — three different bars for the same OS. A shared clinical iPad in a
kiosk workflow, a BYOD phone, a warehouse scanner and an OT controller do not share a
requirement, and the same device grades differently under two workflows' rows. The
proof pins exactly that.

An **empty** requirement list reads as unreadable, never as "anything goes": a
vacuous policy must not be the cheapest route to a grant.

## The catalog snapshot

`lib/integrations/src/integrations/benchmark-selection/cis-catalog.data.ts` — a dated
snapshot of the public catalog listing, regenerated by
`scripts/gen/build-cis-catalog.mjs`.

**TITLE is the identity.** `family` and `section` are the catalog page's presentation
buckets, carried as evidence only. This is not a style choice — it is measurably
wrong to do otherwise: the catalog files *Microsoft Windows Server 2019 STIG* v3.0.0
under family "Microsoft Windows Server" and its successor v4.0.0 under family "DISA
STIG". A family-keyed index makes those two separate coordinates with one version
each, so **both** read as current and a device graded against the superseded v3.0.0
is granted. Keying on family hides **3 of the 7** superseded rows; the first draft of
the loader did exactly that, and the count is what caught it.

Derived figures, re-computed from the entries on every load: **454** entries, **447**
distinct titles, **7** titles carrying more than one listed version, **447** current
rows and **7** superseded, across **83** families — **324** on the main catalog page
and **130** under DISA STIG.

Four properties the loader **enforces rather than documents**:

1. **Self-checking.** The snapshot declares its own counts; the loader re-derives
   every one and refuses the file on any disagreement. The declared block is a claim;
   the entries are the fact.
2. **Non-vacuity.** An empty or tiny index cannot load — it would answer
   "not in catalog" for every device on earth, a uniform verdict that looks like a
   working control and is a dead one.
3. **Supersession stays representable.** If no title carries two versions, the load
   fails. A future refresh that "tidied up" duplicates would retire the
   `version_superseded` rung while every proof stayed green.
4. **The licensing boundary, mechanically.** Four keys per row, and values are
   shape-checked against control-statement grammar.

## Licensing and claim boundary

- The snapshot carries benchmark **titles and version strings** and the family/section
  each is filed under — factual catalog metadata.
- CIS benchmark **rule content** — control text, rationale, audit and remediation
  procedures — is licensed by CIS and is **not reproduced anywhere in this
  repository**. The loader refuses any value carrying control-statement grammar, so a
  careless refresh fails loudly rather than quietly publishing licensed text.
- SignalGrid **performs no benchmark assessment**, launches no scan, and re-grades no
  rule. It consumes an assessment somebody else performed and grades its shape and
  provenance.
- No CIS **certification, conformance, or partnership** is claimed. Nothing in this
  dimension is named "compliant" or "conformant": `selectionConfirmed` means the test
  was the right test.

## What this deliberately does not do

- **It does not say the device passed.** `alignment` is carried on every normalized
  record and is deliberately **outside** the grant conjunction. `requirement_matched`
  alongside `drifted` is the honest and useful pair, and the proof asserts that state
  exists and grants. Over the normalized enumeration exactly **5** states grant — one
  per alignment value — which is the mechanical proof that this dimension never
  grades whether the device passed.
- **It does not infer a benchmark from a device.** No OS-marketing-name → benchmark
  mapping is attempted; that inference is the invented judgement the dimension
  refuses to make. Applicability comes from two strings the assessor itself reports,
  and requirement comes from a row a human authored.
- **It does not grade profile level.** L1/L2 is carried as evidence, never graded: the
  public catalog carries no profile field, so grading it would be a naked wire
  assertion. An operator expresses a stricter bar by pinning a different catalog
  **title** (base vs STIG), which is verifiable.
- **It does not cover platforms the catalog has no benchmark for.** Rugged Android
  forks, HMI panels and vehicle mounts will sit at `REQUIREMENT_ABSENT` until an
  operator authors a row. That is truthful, and it is honest to say plainly that it is
  also the state most likely to be muted — at which point the unearned affirmative
  has simply moved outside the code.

## Known follow-up, stated rather than implied

The dimension fuses through `posture-composition`, where worst-concern-wins means a
raised selection verdict raises the composed device risk. It does **not** yet have an
arm in the `/v1` policy layer, so a policy whose rule set grants on
`baselineCompliance === "aligned"` still grants on that path alone. The next step is a
core evidence field plus an **active v1 rule matching only the affirmative bad state**
(`misfit`), leaving the `unverified` arm to a later policy version so the whole fleet
does not step up on day one. That is a change to `lib/signalgrid-core`, deliberately
not bundled here.

Proven by `proof:benchmark-selection` (71 checks; targeted ladder checks, per-field
integrity, hostile wire shapes, catalog-loader refusals, the comparator asserted
directly, both grant-safety enumerations, connector surface, fusion; deterministic,
offline).
