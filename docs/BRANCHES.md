# Branch policy

This repo accumulated 44 remote branches across several agent lanes before a
policy existed. This document states which branches are load-bearing, what the
rest were, and the rule that keeps the list honest. A branch listing that mixes
live lanes with dead experiments makes every seek slower and every reader less
sure what is current — the same reason the docs here carry drift gates.

## Load-bearing branches

| Branch | Role |
| --- | --- |
| `SignalGrid_Alpha` | Default branch and base. Everything merges here through a reviewed, CI-gated PR. |
| `fix/ios-enterpriseshell-build-and-run` | The owner's Mac lane: iOS EnterpriseShell/SignalGridMobile, Fleet MDM loop, full-stack E2E, real-hardware validation (PR #107). |
| `claude/signalgrid-launch-plan-emxm01` | The cloud lane: connectors, proofs, docs, and gates built in Claude Code sessions (PR #137 and predecessors). |
| `codex/add-signalgrid-autopilot-evidence-bot` | Deliberately preserved although its PR #36 closed unmerged — Issue #136 sequence step 2 queues that work for revival. Do not delete. |
| `dependabot/*` | Open dependency PRs; deleted automatically when their PR closes. |
| `alpha` / `beta` / `dev` / `prod` | Environment lanes from the monorepo consolidation. As of 2026-07-27 they sit 96 commits behind the base and carry no unique commits; the owner decides whether to re-point them at promotion time or remove them. Until then, treat them as historical markers, not as what runs anywhere. |

## The rule

- A branch exists because an open PR needs it, a named lane works on it, or a
  governing artifact (like Issue #136) reserves it. Anything else is clutter.
- When a PR merges or closes without revival plans, its branch is deleted.
- Branch deletion is an owner action (the hosted session's permission policy
  blocks deletion pushes), so cleanup ships as a verified script the owner runs:

      pnpm run branches:stale    # dry run — show what would go, and what is kept
      pnpm run branches:clean    # actually delete

  `scripts/cleanup-merged-branches.sh` DERIVES the set rather than carrying a
  list, because a list of branch names is a fossil the moment the next PR opens —
  the same failure the guard-registry drift check exists to prevent. It deletes a
  branch on either of two signals: every commit is already in the base, or the
  branch's PR is merged per GitHub. The second signal is not optional here — this
  repo **squash-merges**, which rewrites a branch's commits into one new commit,
  so a merged branch never satisfies the first test. A containment-only script
  would report a clean sweep while never removing anything this workflow produces.
  Open PRs' head branches are excluded (deleting one closes its PR), as are the
  protected names above. The script also prints what it is LEAVING BEHIND and how
  many unique commits each holds, so a partial cleanup is never mistaken for a
  complete one.

## Audit record — 2026-07-27

A full inventory at base `f974275` classified all 44 remote branches:

- **33 identified as safe to delete** — 32 with zero commits missing from
  `SignalGrid_Alpha` (every commit already reachable from the base, so deletion
  loses nothing; one of them was a stray branch literally named `origin`
  pointing at the base tip) plus `validation/sim-evidence-and-coverage-audit`,
  whose PR #94 had already been squash-merged. Tip SHAs were recorded and the
  deletion script was handed to the owner; this record does not claim the
  deletions have been executed.
- **2 flagged for an owner decision** — `codex/signalgrid-real-life-simulator-foundation`
  and its subset `codex/review-hub-local-dev-api-health`: closed unmerged in
  June and superseded by the Mac lane's newer simulation stack, but they carry
  unique commits, so removal is not automatic.
- The load-bearing branches above were kept.

## Audit record — 2026-07-28 (after PR #137 merged)

Re-inventoried at base `5c9b762`, 43 remote branches. The classification is
reproducible with `pnpm run branches:stale`; the numbers below are that script's
output, not a hand count.

- **31 fully contained in the base** — every commit already reachable from
  `SignalGrid_Alpha`, so deletion loses nothing. All are `codex/*`.
- **4 carry unique commits and are NOT safe to delete on git evidence alone**:
  `codex/add-signalgrid-autopilot-evidence-bot` (4), `codex/review-hub-local-dev-api-health` (1),
  `codex/signalgrid-real-life-simulator-foundation` (4), and
  `validation/sim-evidence-and-coverage-audit` (1). The last of these is the case
  the squash-merge signal exists for: its PR #94 merged, so the work is in the
  base under a different commit, and only the PR-state check can tell that from
  genuinely-unmerged work.
- Deletion could not be executed from the hosted session — the git proxy rejects
  both branch-deletion pushes and tag pushes with 403, so the unmerged branches
  could not even be archived as tags first. Nothing was deleted, and this record
  does not claim otherwise. Run `pnpm run branches:clean` locally to apply.
