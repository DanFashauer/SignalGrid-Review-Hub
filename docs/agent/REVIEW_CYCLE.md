# The review cycle — how a surface gets read, checked, and checked again

**Basis: owner directive, 2026-08-24.** In his words: *"report back to you were you
oversee and have another agent and or skill validate what was done then have one final
agent recheck both employees then commit if the cycle needs to repeat until it is right
and or something is broken and now part of that role or agent then someone who is needs
to step in."*

This page is the loop. It is written to be run, not admired.

## The precondition that had to be built first

The cycle is per-surface, and on 2026-08-24 **399 of 2,324 tracked files (17%) belonged
to no role at all** — including `.claude/` entire, the skills and agents that run every
other role. `check-role-coverage.mjs` could never have found this: it iterates roles, so
a file no role claims is invisible to it.

`check-surface-ownership.mjs` closed that. Every tracked file is now either owned by a
named role or declared-excluded with a stated reason, and the unowned count is ratcheted
so new code cannot arrive without an owner. **A cycle that starts from roles cannot cover
a repository until every file is inside one.**

## The three stages

Each stage is a DIFFERENT agent. The separation is the mechanism, not ceremony: an agent
that reviews its own work is one author with two opinions.

### Stage 1 — READ (the role's own executor)

The role that owns the surface reads it and reports. Rules:

- **Read only.** A reader that fixes becomes a second author and stops being a reader.
- **Findings carry a reproduction**: what / where (`path:line`) / the exact command and
  its *verbatim* output / why it matters / the suggested fix, unapplied.
- **A clean read is a result.** "I read this and found nothing" must be recorded, because
  it is a different state from "nobody opened this", and only the ledger tells them apart.
- **What was NOT checked is a finding.** Coverage gaps get their own section.

### Stage 2 — VALIDATE (an independent agent)

A different agent re-derives the stage-1 claims from the tree. It is not asked whether
the report reads well; it is asked whether each claim is *true*.

- Re-run the commands. A builder saying "tests pass" is not evidence; the output is.
- Check the boundary: did stage 1 stay inside its declared surface?
- **Try to break each finding**, not just confirm it. A finding that survives an attempt
  to refute it is worth acting on; one that does not was noise.
- Verdict per finding: `confirmed` / `refuted` / `unverifiable here (why)`.

### Stage 3 — RECHECK (a third agent, over both)

Reads stage 1 and stage 2 together and asks what both missed:

- A finding stage 1 raised that stage 2 neither confirmed nor refuted — silence is not
  agreement.
- A claim stage 2 accepted on stage 1's word rather than re-deriving.
- A modality nobody ran, a file nobody opened, a claim nobody checked.
- **Anything belonging to a role that was not in this cycle** — see escalation below.

Only after stage 3 does anything get committed.

## Escalation: when a finding is not this role's to fix

The owner's rule, in his words: *"something is broken and now part of that role or agent
then someone who is needs to step in but it needs to be reported correctly so the right
employee aka agent can come in and do the right thing."*

So a finding outside the reading role's surface is **never fixed in place and never
dropped**. It is:

1. Filed as a `docs/COMPANY_BUILD_PLAN.md` row naming the role that owns it — which is
   now always answerable, because every file has an owner.
2. Written into that role's `nextAction` in `docs/agent/org-roster.json`, so it is picked
   up by the executor with the right skill rather than by whoever happened to find it.
3. Left for that role. A reader fixing another role's surface is how a boundary rots.

`check-backlog-ownership.mjs` already fails the build on a row with open work that names
no role, so a mis-filed escalation cannot pass quietly.

## Repeat until it is right

A surface is done for this pass when stage 3 finds nothing new. That is **not** the same
as "the surface is correct" — it is "three independent passes stopped finding things",
which is the strongest claim this process can honestly make. Say it that way.

If stage 3 finds something, the cycle repeats on that surface. It does not repeat on the
whole repository: re-reading what was already read to make a number look thorough is the
waste this process exists to avoid.

## What gets written down, every pass

| Artifact | What it records |
| --- | --- |
| `docs/agent/review-coverage.json` | which files were read, by which role, at what depth, with a note naming what was and was NOT examined |
| `docs/agent/EVIDENCE.md` | claim → exact command → verbatim output → verdict, for anything verified or refuted |
| `docs/COMPANY_BUILD_PLAN.md` | findings that survived validation, each naming its owning role |
| `docs/agent/org-roster.json` | the `nextAction` for each role the cycle handed work to |

Depth is honest or it is worthless: `read` < `audited` < `verified-live`. Recording a
property scan as a read inflates the exact number this whole effort exists to make true.

## The method rule that outranks the rest

**Never conclude absence from one narrow search.** On the day this page was written, four
separate false "X does not exist" claims were made in this repository — one caught by an
external reviewer, one made *inside the correction for another*. Every one came from
searching too few places.

Before writing "X does not exist" or "nothing references Y": run
`pnpm run check:absence <topic>`, search at least two differently-shaped ways, read the
matches yourself, and say which searches you ran. The feeling of being sure is what every
one of those four had in common.
