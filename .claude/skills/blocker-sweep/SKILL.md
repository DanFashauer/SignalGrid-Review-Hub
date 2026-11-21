---
name: blocker-sweep
description: Treat anything and everything that keeps the goal from working as a blocker, and clear it. Use whenever a session is about to say "waiting", "not mine", "out of scope" or "done for now"; at every goal check-in or stop-hook nudge; and before ending a turn while the owner's goal is still unverified. Enumerates every open obstacle, names who can clear each one, clears what this lane can now, and raises the rest precisely.
---

# Blocker sweep — anything and everything is a blocker

The owner, 2026-11-21, on the independent-Mac-operation goal: *"Anything and everything
can be considered a blocker."* A blocker is not only a red check. It is anything that
stands between now and the goal **working and verified**. This skill is the habit that
keeps a lane from mistaking "I am waiting" for "nothing is wrong".

It sits on top of DR-054 (raise your hand when stuck) and the `raised-hands` skill. Those
answer hands that someone raised. This one finds the blockers nobody has called blockers
yet, including your own.

## What counts — all of these

- A check that is red, flaky, cancelled, skipped or still running on the head you need.
- A refusal: a classifier, a hook, a privacy or source review, a publisher route. The
  refusal is correct until shown otherwise; the blocker is whatever it refused.
- A merge, PR or branch that is behind, conflicted, unreviewed or unanswered.
- Mail, a sim request, a heartbeat or a hand older than its limit (`pnpm run hands`).
- A wait on another lane, the owner, a quota, a reset or a window — and no named next
  step or time.
- A claim not yet confirmed by output: an assumption, a "should work", a fix that covers
  one path but not the path that failed.
- **Your own error** — a wrong prediction, a stale statement, a step you skipped. Correct
  it in the same place you made it, first.

## The loop

1. **Enumerate.** Read the goal's real state, not your notes: `pnpm run loop:state`,
   `pnpm run hands`, the open PRs you own and their check runs, the mailbox PR's latest
   comments, `node scripts/check-lane-messages.mjs`, `node scripts/check-sim-requests.mjs`.
   Write the list down; do not keep it in your head.
2. **Name who clears each one:** this lane, the other lane, the owner, or time (a reset,
   a running job). A blocker with no name is a GAP — raise it with `pnpm run hand:raise`.
3. **Clear what this lane can, now.** Take the smallest safe step that moves each one:
   merge the base into a behind branch, re-read a check run, find the root cause of a
   failure, trace where a refused value enters, post the exact fix. Verify with real
   output before you report it.
4. **Raise the rest precisely.** For each blocker another party must clear, say once,
   where they will see it: what is blocked, the evidence (file:line, run id, comment id),
   exactly what is needed, and who. Then stop repeating it until something changes.
5. **Set the next check.** Every remaining wait gets a named time or event that will
   bring you back (a scheduled check-in, a PR subscription). "Waiting" with no next
   check is itself a blocker.
6. **Report honestly.** If the goal is not verified, say so in one line, list what is
   left and who holds each item. Never call a partial result done.

## Never

- Never route around a refusal, hook or classifier block to clear a blocker. Report it.
- Never clear another lane's blocker by doing its work where the goal requires that
  lane to do it (an independence proof is one such goal).
- Never repeat the same status line as a substitute for a new action. If nothing new can
  be done, say what the next check is and when, once.
- Never mark a blocker cleared on a prediction. A predicted failure that did not happen
  is a correction to post, not a success.
