# Definition of Done — the org-wide operating law

**One line:** a piece of work is not *done* until it is **built**, **validated by a
real run**, **reviewed by a role that did not build it**, and — if any of those
fail — **looped back to the owning role and redone until it actually works.**
No shortcut to "done." A claim of completion without the run and the independent
review behind it is the exact defect class this repository is built to catch: an
assertion outrunning its evidence.

This is the **per-work-item** law. It complements, and does not replace, the two
completion surfaces that already exist:

- [`PRODUCT_COMPLETION_PLAN.md`](PRODUCT_COMPLETION_PLAN.md) — what "done" means
  for the **product** (a buyer can test it, a reviewer can trust its boundaries).
- [`research/FOUNDER_EXECUTION_REPORT.md`](research/FOUNDER_EXECUTION_REPORT.md) —
  delivery gates and decision rights for the **execution team**.

This document is narrower and sharper: it is the bar every single backlog row,
fix, and shift output must clear before it may be called closed.

## The four gates of done

Work moves through these in order. Failing any gate sends it back to the gate
before it — never forward.

1. **Built.** The change exists in the tree and does what the task asked. Nothing
   is "done in principle."

2. **Validated by a real run.** The exact gates CI runs must pass on the change —
   not a description of passing. The runnable harness is
   [`scripts/build-loop.mjs`](../scripts/build-loop.mjs) ([`BUILD_LOOP.md`](BUILD_LOOP.md)):
   build → run the gates → fix → **re-run**. Its standing rule is the heart of
   this law: *nothing counts as fixed until the re-run is green.* A gate that was
   asked to run but could not spawn is a **failure**, never "skipped."

3. **Reviewed by a role that did not build it.** The builder does not certify
   their own work. An independent lens — the [reviewer role](../.claude/skills/signalgrid-reviewer/SKILL.md),
   plus whichever domain role the change touches — verifies the claim against the
   run, adversarially, per the operating loop in [`agent/ORG.md`](agent/ORG.md)
   and [`VIRTUAL_TEAM.md`](VIRTUAL_TEAM.md). *An agent that fixes its own findings
   has stopped being independent.* Findings are refuted-or-applied; an unrefuted
   finding is work, not an opinion.

4. **Looped until it works.** If validation or review finds anything wrong, the
   item returns to the **owning role** (named in the backlog row) and re-enters at
   gate 1. It does not close, and it does not get handed off half-finished. The
   loop has a terminal state — green and reviewed — and the shift drives it there,
   the same way a CI-failure wake is driven to green rather than abandoned.

## The one boundary the loop never crosses

The loop validates, reviews, and prepares everything **up to an irreversible
external action** — and stops there. Anything that leaves the company or cannot
be taken back **queues for the owner and waits**:

- Sending an outreach message, or any email under the owner's identity.
- Signing anything — an MSA, DPA, BAA, an artifact signature.
- Publishing to an external service, or moving money.
- Any regulated-vertical (healthcare / fintech) sign-off: a human compliance
  review is required, never inferred.

The work behind these can be *done* to this law's bar — drafted, validated,
reviewed — but the **act** stays the owner's. The owner can halt any lane with one
word.

## How this is enforced, not just stated

A doctrine no gate reads is a wish. This law is held up by three mechanisms:

| The claim | What holds it |
| --- | --- |
| Every open job names a role that owns it. | [`check-backlog-ownership.mjs`](../scripts/check-backlog-ownership.mjs) — an unowned open row fails the build. |
| A row called **done** hands the reader something to check. | [`check-backlog-evidence.mjs`](../scripts/check-backlog-evidence.mjs) — a closed row with no evidence (a PR, a commit, a runnable command, or a file path) is counted against a debt ceiling that may only ever fall. |
| "Fixed" is never claimed without a green re-run. | [`scripts/build-loop.mjs`](../scripts/build-loop.mjs) refuses to report a fix the re-run does not prove. |

The **shift routines** in [`agent/scheduled-routines.json`](agent/scheduled-routines.json)
are what *run* the loop on a cadence — each shift picks the top owned, unblocked
work, carries it through the four gates, and opens a PR only for work that reached
gate 3. Work that is blocked upstream (a role whose `nextAction` records a real
dependency) waits, honestly, rather than being forced forward.

## Why "reviewed by all roles" does not mean "reviewed by everyone"

The owner's instruction was that work is done only when "reviewed from all roles
to see work was completed correctly." Read literally that would stall every one-line
fix behind forty sign-offs. What it means in practice, and what this law encodes:
the work is reviewed by **every role the change actually touches**, plus the
independent reviewer — no more, no fewer. A change to the decision core is reviewed
by the decision-core and security lenses; a change to a connector by that domain
lead. A role with no stake in the change does not gate it. Coverage of the relevant
roles is the bar; unanimous ceremony is not.
