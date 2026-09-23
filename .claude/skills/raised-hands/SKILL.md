---
name: raised-hands
description: Answer every raised hand — the DR-054 channel for stuck work. Use at every session start, on every hourly steward cycle, and whenever `pnpm run hands` shows anything for your lane. Takes each hand, routes it to the agent or skill in docs/agent/hand-routing.json, acts, and clears it with what was done; bundles owner hands; turns an unanswerable or recurring hand into a new skill or agent. Works for both lanes.
---

# Raised hands — answering what is stuck

The owner, 2026-09-23: *"All agents will never raise their hand when they get stuck"*,
then *"build something that monitors the raise your hand function, then apply what is
needed for the agents to address it, or create a new agent or skill to fill that gap."*

Three parts already exist, and this skill is the fourth:

- **Raising a hand** (DR-054, `scripts/check-agent-raise-hand.mjs`) — every agent is told to stop and say so.
- **The register and the detector** (`scripts/raised-hands.mjs`, `docs/agent/RAISED_HANDS.json`) — a hand has somewhere to go, and stalls nobody reported are raised automatically.
- **The owner's page** (`.github/workflows/raised-hands.yml`) — one issue, refreshed hourly.
- **The answer** (this skill, `docs/agent/hand-routing.json`, the `hand-dispatcher` agent) — a raised hand that nobody picks up is a silent stall with extra steps.

## The loop, every time

1. `pnpm run hands`. Read the whole list, and the **Hand-raising health** line at the end:
   - "found by the system with no hand raised" means an agent was stuck and did not say so;
   - "nobody has taken" means a hand was raised and not answered.
   Both are defects of the org, not of the item.
2. **Take** each hand whose `clears` is your lane before acting, so two sessions do not
   work one hand: `pnpm run hand:take -- <id>`. For an auto hand (`mail:`, `sim:`,
   `heartbeat:`, `pr-red:`, `pr-idle:`) that belongs to your lane, act on it directly. If
   it cannot be finished this cycle, raise a covering hand that says what is left:
   `pnpm run hand:raise -- --clears <who> --covers <auto-id> --what "…" --needs "…"`.
3. **Route** by `docs/agent/hand-routing.json`: the route's `responder` does the work,
   its `skills` say how, and its `action` is the instruction. Dispatch agents by the tier
   DR-047 names for the work (never inherit the coordinator's model). Tell every
   dispatched agent to start its report with `BLOCKED: …` if it cannot finish. A BLOCKED
   report becomes a new raised hand. Never summarise it away.
4. **Clear** with evidence: `pnpm run hand:clear -- <id> --resolution "<what was done, with the PR/commit/sha>"`.
   "Done" without what was done does not clear. The gate refuses an empty resolution.
5. **Owner hands**: never act for the owner. Every owner hand that is OVERDUE (48h) goes
   into ONE bundled message per `owner-comms`: what is stuck, the one thing he does,
   where. New owner hands already notify him through the issue. Do not send a second
   ping for the same hand in the same day.
6. **Deliver** the register change the way mail is delivered: a `raise` / `clear` op in
   the cycle's single `pnpm run lane:deliver batch` (fields: `clears, what, needs, where?,
   covers?[]` / `id, resolution`). Never commit it on a code branch.

## Watching the watcher

The system that reports stalls can stall too. On each steward cycle, check both:

- **The owner's issue is fresh.** The open issue labelled `raised-hands` should have been
  updated within the last 2 hours. If it is older, the hourly job is not running.
  GitHub disables scheduled workflows after 60 days without repository activity, and a
  failing run comments on the issue. Re-run it (`actions_run_trigger`
  `run_workflow raised-hands.yml`), raise a `cloud` hand for the cause, and tell the
  owner once if it cannot be revived.
- **The gate still runs.** `node scripts/raised-hands.mjs --check` must be in both
  `scripts/preflight.mjs` and `.github/workflows/review-hub-ci.yml`. The preflight↔CI
  parity gate enforces that. A check that stopped running reads exactly like a check
  that passes.

The daily scheduled verification also fails, and opens its own issue, when the
raised-hands issue is more than 3 hours old. That catch is mechanical and does not
depend on any session being awake.

## Filling a gap: a new skill or a new agent

A hand is a **capability gap** when no route in `hand-routing.json` fits it, or when the
same kind of hand comes back three times in a week after being cleared. Route it to
`capability-gap` (the `agent-platform-steward` owns the agent and skill plane), and:

- **Write a skill** when the fix is a procedure any session can follow (`writing-skills`
  covers the format; `docs/agent/SKILL_AUTHORING_STANDARD.md` covers the house rules).
- **Hire an agent** under DR-016 when the fix needs a standing role: a tier, a charter,
  and a write scope that overlaps no one else's, all in `docs/agent/agent-tiers.json`.
  The definition carries DR-054's canonical raise-your-hand clause.
- **Add the route** in the same PR, so the next hand of that kind has somebody who
  answers it. `raised-hands.mjs --check` fails when a route names an agent or skill
  that does not exist.

The gap hand is cleared only when the PR that closes it is merged, and the resolution
names that PR.

## Never

- Never clear a hand you did not resolve, or with a resolution that does not say what
  changed.
- Never ack another lane's mail, merge the owner's decisions, or route around a
  refusal to make a hand go away. Raise it, name who clears it, and leave it visible.
- Never let a hand ride only in a chat transcript. The register and the issue are the
  record. Your transcript is not.
