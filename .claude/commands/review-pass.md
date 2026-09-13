---
description: Repeatable multi-agent review pass on the current diff or a PR — the DR-024 stack (ponytail on top) plus SignalGrid's own review agents, findings verified, gates required green. The repo-specific pass, not the generic /code-review.
argument-hint: [optional: PR number/URL, or a pathspec to scope the review]
---

Run the SignalGrid review pass.

<scope>
$ARGUMENTS
</scope>

**1. Establish the diff — read-only, never touching the index.** Determine the scope first:

- A PR number/URL in `<scope>`: review that PR's diff on its CURRENT head.
- A pathspec in `<scope>`: scope the review to it — `git --no-pager diff HEAD -- <pathspec>` for tracked changes, and enumerate matching untracked files with `git ls-files --others --exclude-standard -- <pathspec>`. Pass the SAME pathspec to every lens below.
- No argument: `git --no-pager diff HEAD` for tracked changes (this shows staged-and-unstaged modifications AND deletions without staging anything), plus untracked files from `git ls-files --others --exclude-standard`, each read with `git --no-pager diff --no-index -- /dev/null <file>`.

Do NOT run `git add -A -N`: `-N` still stages a tracked file's deletion, so a later commit could carry a removal the user left unstaged. The read-only forms above see new and deleted files without mutating the index.

**2. The DR-024 review stack, in order:**

- **ponytail-review FIRST** (DR-024 requires the minimalism lens on every diff): `/ponytail-review` (ultra). An unavailable ponytail lens makes the pass INCOMPLETE, not clean.
- Then fan out the correctness + repo lenses in parallel (dispatching-parallel-agents), each on the scoped diff, each setting its own model per DR-047 (no spawn inherits this session's model): the two vetoes **fail-closed-auditor** + **security-reviewer** ALWAYS, plus **code-reviewer**; add **verdict-core-reader** if the diff touches `lib/signalgrid-core`/`lib/signalgrid-simulator`, and **gate-and-proof-engineer** if it adds/changes a gate or proof.
- Apply the **signalgrid-reviewer** discipline as a SKILL, not a spawned agent — it is `.claude/skills/signalgrid-reviewer/SKILL.md`, not a dispatchable agent. Load it (or run `/code-review`, which carries the repo's review checklist) so the known defect classes, fossil figures, unguarded prose and publication boundary are checked against what shipped.

**3. Verify before reporting.** Give each finding an adversarial second look — a
plausible-but-wrong finding is worse than none. Drop what does not survive.

**4. Gates are not optional.** The change is not "reviewed clean" until
`node scripts/preflight.mjs` and `pnpm run verify:breadth` are green (quote them),
and for an api-server change `test:api` is N/N. A green panel over a red gate is
not done.

Report findings ranked most-severe first, each with a `file:line` and the concrete
failure it causes. Nothing found: say so plainly, with the gate output that backs it.

**Failure mode this guards:** treating one agent's opinion, or a passing typecheck,
as "reviewed"; skipping the ponytail lens the stack requires; naming an agent that
cannot actually be dispatched; and a "review" that quietly stages a deletion. Review
here is the full DR-024 stack AND the gates, verified — not one prompt.
