# Customer discovery — the log

**State: Customer Discovery.** Repository engineering is stopped. The next
evidence that can materially change `docs/PURPOSE.md`, the P0 wedge, or the
product hierarchy must come from outside the repo.

`PURPOSE.md` closes on this test:

> *The constraint is no longer technical possibility. It is external proof that
> this decision matters enough for an organization to change behavior around it.*

**Problem recognition is not that proof.** A protocol that only establishes
"yes, that's a real gap" can finish fifteen conversations with five strong
PROBLEM findings and still not know whether anyone would spend political
capital, security-review effort, implementation time or money. So discovery runs
in two phases, scored separately.

---

## Phase 1 — Problem recognition

### The question

> **"Which system in your environment knows the employee, the device posture,
> the checkout/custody state, the location, and the applicable policy at the
> moment a shared-device session begins?"**

Then silence. No demo, no diagram, no second question until they have finished.

**Target:** enterprise mobility leads, endpoint engineering managers, IT
directors at multi-facility health systems. People who have run the estate.

### Phase 2 — Behavioral commitment

Only after Phase 1 is fully answered. Ask for a concrete next step that costs
them something: technical scoping, bringing in another stakeholder, a sandbox
path, review of a read-only observe-mode pilot, a second working session.

*"Very interesting, send me something"* is not a commitment. It is the polite
form of no, and logging it as interest is the single easiest way to fool
yourself in this phase.

---

## The record

Log the same day, in their words, before impressions consolidate.

```
DATE · ROLE · ORG TYPE

VERBATIM — what they actually said, not the gist:
  "…"

CURRENT WORKAROUND — what actually happens today:
  "…"

CLASSIFICATION (one or more):
  [ ] SUBSTITUTE      "we solve that with X"
  [ ] INDIFFERENCE    "nobody knows all that, but we don't care"
  [ ] PROBLEM         "that causes us problems when…"
  [ ] REQUIREMENT     "we'd need Y before we'd let you observe it"
  [ ] ROUTING         "you need to talk to <role>"
  [ ] COMMITMENT      agreed to a concrete next step that costs them something

SUBSTITUTE DETAILS — what it actually covers, and what it does not:

CONCRETE CONSEQUENCE — what went wrong last time, and what it cost:

NEXT STEP / COMMITMENT — exact words, exact date, or none:

WHAT I DID NOT ASK:
```

**CURRENT WORKAROUND may be the most valuable field.** It locates the
operational seam more reliably than whether someone uses the word "problem":

> *"Charge nurse keeps a spreadsheet." · "We just trust the checkout
> assignment." · "Security gets a ServiceNow ticket after the fact." · "We don't
> correlate it." · "Imprivata handles the login and Intune handles the device."
> · "Nobody owns it."*

Two rules that matter more than they look:

1. **Verbatim, not paraphrase.** Paraphrase is how "we tried that once" becomes
   "they're interested."
2. **Log the disconfirming signal first.** If a conversation produced both a
   PROBLEM and a SUBSTITUTE, write the SUBSTITUTE at the top.

---

## The six realities these fields separate

1. There is no problem.
2. There is a problem, but an incumbent solves it.
3. There is a problem with a tolerable manual workaround.
4. There is a problem with meaningful consequences.
5. There is a problem they want fixed.
6. There is a problem they will spend organizational effort to fix.

**Only 5 and 6 start making a company.** Everything above 4 feels encouraging
and proves nothing.

---

## Pre-registered thresholds

Set **before** Conversation #1, so no result can be reinterpreted afterward.
Sample: **15 conversations** with the target role.

| Signal | Threshold | Conclusion — scoped exactly |
| --- | --- | --- |
| **INDIFFERENCE** | ≥ 6 of 15 | **The current healthcare mobility-lead wedge is falsified.** Not the cross-domain thesis everywhere — but do not respond by inventing another vertical. Stop and reassess with the owner. |
| **SUBSTITUTE**, same product | ≥ 5 of 15 | That substitute is the **highest-priority competitive hypothesis**. Stop expansion and investigate it against the exact moment-of-use workflow. Five people naming Imprivata does not settle it if Imprivata covers authentication while custody/context correlation stays manual. |
| **PROBLEM**, unprompted, specific | ≥ 5 of 15 | Problem recognition supported. **Not sufficient alone** — see COMMITMENT. |
| **COMMITMENT** | ≥ 3 of 15 | Strong enough to proceed to structured design-partner qualification. |
| **COMMITMENT = 0** despite ≥ 5 PROBLEM | — | The problem is real but **insufficiently important**. Do not treat pain recognition as product validation. This is the outcome most likely to be rationalized away. |
| **REQUIREMENT**, repeated | ≥ 4 of 15 | That requirement is the real first engineering task, ahead of anything in the backlog. |
| **ROUTING**, consistent role | ≥ 4 of 15 | That role is the **leading buyer/champion hypothesis and must be tested directly.** It does not close the economic-buyer question. |

**The economic-buyer question in `PURPOSE.md` closes only when interviews
establish all three:** who owns the problem, who can sponsor a pilot, and who can
authorize spend. Four endpoint managers pointing at a CISO establishes a next
stakeholder, not a budget holder.

**The trap, named now:** *"they were the wrong person"* is a valid explanation
only if decided **before** hearing the answer. If a target matches the role
profile, their answer counts.

---

## What does not count as evidence

- Enthusiasm about the architecture.
- "That's really interesting, send me something."
- Anyone who has already seen the repo or the diagrams.
- LinkedIn engagement of any kind.
- Anything said after a demo. The question comes first, or the answer is
  contaminated by the pitch.

---

## Running tally

| # | Date | Role | S | I | P | R | Rt | **C** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | | |

*S ubstitute · I ndifference · P roblem · R equirement · R(ou)t(ing) ·
**C ommitment***

**Experiment started: 2026-08-27**
**Conversations logged: 0 of 15 · Commitments: 0**

---

## The honest boundary

Nothing in this file, the repository, the doctrine, the gates or the diagrams
can produce a single row in that table. This phase cannot be prepared for
further — it can only be done.
