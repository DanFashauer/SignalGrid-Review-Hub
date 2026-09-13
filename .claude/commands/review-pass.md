---
description: Repeatable multi-agent review pass on the current work or a PR — the DR-024 stack (ponytail on top) plus SignalGrid's own review agents, run against the RIGHT revision, findings verified, gates required green. The repo-specific pass, not the generic /code-review.
argument-hint: [optional: PR number/URL, or a pathspec to scope the review]
---

Run the SignalGrid review pass.

<scope>
$ARGUMENTS
</scope>

**1. Establish the diff AND the revision to gate — read-only, never touching the index.**

- **PR number/URL** in `<scope>`: resolve the PR's CURRENT head sha, and check it out in a TEMPORARY detached worktree (`git worktree add --detach <tmp> <headsha>`). The diff is that PR's diff; **run the gates in step 4 in that worktree**, not the local tree, so the verdict is about the PR's revision and not whatever is checked out here. Remove the worktree after.
- **Pathspec** in `<scope>`: `git --no-pager diff "$(git merge-base HEAD origin/SignalGrid_Alpha)"...HEAD -- <pathspec>` plus untracked matches from `git ls-files --others --exclude-standard -- <pathspec>`; pass the SAME pathspec to every lens and to the gates' scope where they take one.
- **No argument:** review the whole branch, not just the working tree. Base = `git merge-base HEAD origin/SignalGrid_Alpha`; the diff is `git --no-pager diff base...HEAD` (this includes committed-but-unpushed work — a plain `git diff HEAD` is EMPTY on a clean worktree after you commit, so the panel would review nothing) LAYERED with any working-tree changes (`git --no-pager diff HEAD`) and untracked files (`git ls-files --others --exclude-standard`, each via `git --no-pager diff --no-index -- /dev/null <file>`). Never `git add -A -N` (it stages a tracked deletion).

**2. The DR-024 review stack, in order:**

- **ponytail-review FIRST** (DR-024 requires the minimalism lens on every diff): `/ponytail-review` (ultra). An unavailable ponytail lens makes the pass INCOMPLETE, not clean.
- Then fan out the correctness + repo lenses in parallel (dispatching-parallel-agents), each on the scoped diff with a **strictly read-only brief**, each setting its own model per DR-047 (no spawn inherits this session's model): the two vetoes **fail-closed-auditor** + **security-reviewer** ALWAYS, plus **code-reviewer**; add **verdict-core-reader** if the diff touches `lib/signalgrid-core`/`lib/signalgrid-simulator`.
- **gate-and-proof-engineer** (only when the diff adds/changes a gate or proof) has Write/Edit and plants defects in the real tree, so it must NOT run in the shared-checkout parallel panel (`dispatching-parallel-agents` excludes shared-state work). Run it AFTER the panel, in its own isolated worktree, or give it an explicitly read-only brief for the review and defer any defect-planting to the gauntlet.
- **Every dispatched agent operates only within its `docs/agent/agent-tiers.json` writeScope and uses the LOCAL tool corrections recorded there and in its charter — do not restate them in the brief, point the agent at them.** In particular the vendored agents' default commands are wrong here (security-reviewer's `npm audit` / `npx eslint --plugin security`, refactor-cleaner's `npx knip/depcheck/ts-prune`): agent-tiers.json replaces each with the repo's registered scanners, and the dispatch brief must say "follow your agent-tiers.json correction, never the vendored command."
- Apply the **signalgrid-reviewer** discipline by LOADING its skill `.claude/skills/signalgrid-reviewer/SKILL.md` (known defect classes, fossil figures, unguarded prose, publication boundary). Do NOT substitute `/code-review` for it — that generic skill does not carry the SignalGrid checks.

**3. Verify before reporting.** Adversarial second look at each finding; drop what does not survive.

**4. Gates are not optional**, and they run against the REVIEWED revision (the PR-head worktree in PR mode; the branch tip otherwise): `node scripts/preflight.mjs` and `pnpm run verify:breadth` green (quote them), `test:api` N/N if the API moved. A green panel over a red gate is not done.

Report findings ranked most-severe first, each with a `file:line`. Nothing found: say so with the gate output that backs it.

**Failure mode this guards:** reviewing the wrong revision (an empty clean-worktree diff, or the local tree instead of the PR head); a defect-planting agent mutating the shared checkout mid-review; dispatching an agent with its invalid vendored commands; and substituting the generic review for the SignalGrid discipline. Review here is the full DR-024 stack AND the gates, on the right revision, verified.
