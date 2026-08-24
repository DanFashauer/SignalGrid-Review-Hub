# Why this exists

> Public-safe. Every source named below is either a public artifact or a reference
> diagram in the founder's own project folder. No customer, deployment, certification,
> pilot, or revenue is claimed anywhere on this page.

`WHY_SIGNALGRID_VERTICALS.md` answers **what** the product collapses and **where** it
starts. This page answers the question underneath it, which had never been written
down: **why this company exists at all.** `pnpm run check:absence "founding story"`
returned CORROBORATED across four probes on 2026-08-24 — the origin was in one
person's head and nowhere else, in a repository whose founding rule is that a claim
lives or dies by whether it can be checked.

## The observation the product is built on

The clearest statement of SignalGrid's thesis is not in this repository. It is the
closing line of a **macOS troubleshooting framework** diagram kept in the founder's
project folder:

> *"macOS doesn't just apply profiles. It evaluates trust, privacy and security at
> every layer. Always validate each layer to find the real root cause."*

That diagram traces one workflow through nine layers — APNs delivery, MDM check-in,
profile installation, PPPC payload, the TCC privacy decision, system-extension
approval, kernel-extension approval, the application, and finally the user
experience — and lists the ways each layer fails on its own.

Read it as an operator and it is a debugging aid. Read it as a founder and it is a
product spec, because it contains three facts at once:

1. **Trust is already evaluated in layers.** Nobody has to be convinced of that
   model; the platform vendors shipped it.
2. **Any single layer failing breaks the whole workflow** — and the symptom always
   surfaces at layer 9, in front of the person trying to work.
3. **Nothing joins the layers up.** The diagram exists precisely because a human has
   to walk all nine by hand, every time, to find the real cause.

SignalGrid is the answer to (3), taking (1) and (2) as given. It does not replace any
layer. It reads what the layers already produce and returns one decision —
allow / step-up / restrict / deny — *before* the workflow breaks, rather than leaving
a person to reconstruct why it did afterwards.

That is also why the decision core is **fail-closed and deterministic** rather than
scored or probabilistic. A layered trust evaluation that guesses is not a debugging
aid; it is a tenth layer to debug.

## Who is standing at layer 9

The other diagram in that folder — saved **2026-08-24**, the day this page was
commissioned — is a **Hospital Information System architecture**: the clinical,
administrative and financial modules over an integration layer of HL7, FHIR and
DICOM, over infrastructure, with twenty-one named HIS vendors beside it.

Put the two diagrams side by side and the company's shape falls out. One describes
how trust is evaluated on a device. The other describes the systems a clinician's
work actually runs through. **Neither knows the other exists.** Between them sits a
shared tablet that changed hands ten minutes ago, and a nurse starting a
medication-administration workflow on it.

In an office, a failed trust evaluation is an inconvenience — you retry, or you file
a ticket. On a shared clinical device it is **care delayed**, and the workaround is
worse than the failure: a credential shared, a session left open, a step skipped.
This is why `docs/EMBEDDED_UX_PRINCIPLE.md` insists SignalGrid stays invisible to the
worker and domain safety stays in the host app. The person at layer 9 did not sign up
to operate a security product.

## Why the founder, specifically

The public record is his own writing. Post titles from his LinkedIn between April and
July 2026 include *"What managing 200k devices taught me"*, *"A lot of IT work is just
…"*, *"Enterprise IT spends a lot of time talking …"*, and *"The older I get in IT,
the more I believe …"*.

Two things follow, and only two — this page will not invent a third:

- **The scale is first-hand.** The failure modes this product addresses were observed
  across a fleet, not derived from a market report. That is the same instinct
  `check:absence` and the review ledger encode: a claim is worth what its evidence is
  worth.
- **The audience was chosen before the product was.** He was already writing for
  endpoint and platform engineers. SignalGrid is aimed at the people whose work he
  had been describing for a year.

### What only the founder can write

**This section is deliberately blank, and should stay blank until he fills it.**

Everything above is inferred from artifacts. The part that cannot be inferred — what
made this worth starting, and worth continuing — is his to write in his own words,
and it should not be reconstructed by anyone else from his files. When it is written,
it belongs here, and the rest of this page should be read as supporting evidence for
it rather than as a substitute.

## What this changes about the work

A founding why is not decoration here; it settles three questions the May 2025
second-opinion review left open.

| The review asked | This page answers |
| --- | --- |
| *"How does SignalGrid handle the 'just extend our existing stack' objection?"* | Every layer in the nine-layer diagram already belongs to an incumbent. The gap is not a missing layer — it is that **no layer is accountable for the join**, and no vendor can be, because each sees only its own. |
| *"Who is the economic buyer vs. the technical champion?"* | The champion is the person who has walked all nine layers by hand. The diagram is the artifact that finds them. |
| *"What is the first proof point that isn't a smoke test?"* | One workflow, end to end, across layers owned by different vendors, with the decision explainable afterwards. That is the shape of the proof, whatever the integration turns out to be. |

It also explains why this repository is built the way it is. A product whose entire
premise is *"the layers do not check each other, and the person at the end pays for
it"* cannot be built by an organisation whose own layers do not check each other. The
gates, the review cycle, the surface-ownership ledger and the fail-closed doctrine are
the same idea applied inward.

## Sources

| Claim | Source |
| --- | --- |
| The nine-layer trust evaluation and its closing line | macOS troubleshooting framework diagram, founder's project folder, saved 2026-07-19 |
| The clinical systems a workflow runs through | HIS architecture diagram, same folder, saved 2026-08-24 |
| Fleet scale and chosen audience | The founder's own public LinkedIn posts, April–July 2026 |
| Positioning as a runtime decision layer, explicitly not replacing IAM/UEM/SIEM/ITSM | SignalGrid Second-Opinion Review, May 2025, v0.1 |
| The open questions this page answers | Same review, "Open Questions" section |

**Not sourced from, deliberately:** the founder's general screen-capture archive. It
is an unsorted personal collection containing private correspondence, and no part of
it informs this page or belongs in this repository.
