# Continuity — what the next session must know

The `signalgrid-scribe` role's handoff surface: state that lives in someone's
head at session end gets written here instead. Seeded at install (2026-08-22).
Keep entries dated, newest first, and DELETE entries once their content is
either done or landed in a real document — this file is a buffer, not an
archive. The operating lane's equivalents (lane messages, sim requests, the
build-plan queue) remain authoritative for cross-machine work; this file is
for session-to-session context that fits nowhere else.

---

## What a fresh session reads first, in order

1. **`docs/agent/LOOP.md`'s STATE block** (`docs/agent/LOOP.md:47`) — four lines,
   updated every session: PHASE, LAST TOUCHED, what is red, what is next. This is
   the fastest way to know where the org left off; read it before touching
   anything.
2. **The lane inbox** — `pnpm run lane:inbox` (`scripts/lane-message.mjs inbox`).
   What the other lane needs you to know, how long it has waited, and which of
   your branches mainline does not carry yet. See `docs/LANE_COORDINATION.md`.
3. **The standing routines** — `docs/agent/scheduled-routines.json`. The
   committed registry of always-on scheduled lanes (cadence, who authorized each
   one, what it may write, where it escalates, where its heartbeat lands).
   `scripts/check-scheduled-routines.mjs` holds this file against the heartbeat
   artifacts and the org roster; a routine not declared here is not a standing
   lane, whatever the account scheduler says.

## The worktree convention for parallel/build work

Per `docs/LANE_COORDINATION.md` ("How the cloud lane runs build work"): the
orchestrating session writes the spec (what changes, which check fails without
it, which gates must stay green), fans execution out to sub-agents each in its
own git worktree with its own `pnpm install`, reviews what comes back against
the spec, and only runs the full gates and opens the PR once the diff is good.
The loop closes on a failing check turning green, never on a description of
one. The vendored `subagent-driven-development` and `dispatching-parallel-agents`
skills describe the mechanics; `using-git-worktrees` covers the isolation
pattern itself.

## DR-037 — landing conditions before the cloud lane merges its own PR

`docs/DECISION_RECORDS.md:2171` (DR-037): since 2026-09-12 the cloud lane merges
its own green product PRs instead of parking them on the owner. A PR is
mergeable by the lane only when ALL of the following hold on its current head:
the gating check "Typecheck, build, and proof scaffold" has passed (the lane
reads the check run, not just a `check_suite.completed` event); `node
scripts/preflight.mjs` and `pnpm run verify:breadth` passed locally on the
branch before the push that produced that head, with output quoted in the PR
body or `docs/agent/EVIDENCE.md`; every review thread is resolved and every bot
finding verified and fixed or answered; the branch is not conflicted with
`SignalGrid_Alpha`; and the lane never approves a PR and never merges one it
did not open or was not asked to drive (the Mac lane's landing PRs are the
named exception, only when the Mac asked for it in mail). `scripts/**`,
`.github/workflows/**`, `lib/**/fixtures/**` and the brain-cycle veto config
stay owner-gated (`check-owner-gated-surfaces.mjs`); a merge that touches one
of those must say so in the PR body as "merged under DR-037" with the check-run
id.
