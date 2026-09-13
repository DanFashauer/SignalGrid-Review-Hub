---
description: Repeatable multi-agent review pass on the current diff or a PR — runs SignalGrid's own reviewer, fail-closed auditor and code-reviewer in parallel, verifies each finding, and requires the SignalGrid gates green. The repo-specific pass, not the generic /code-review.
argument-hint: [optional: PR number/URL, or a path to scope the review]
---

Run the SignalGrid review pass.

<scope>
$ARGUMENTS
</scope>

**1. Establish the diff.** Local uncommitted work:
`git add -A -N && git diff HEAD` — a staged new file is invisible to a plain
`git diff`, and this repo has lost files exactly that way. A PR number/URL in
`<scope>`: review that PR's diff on its CURRENT head.

**2. Fan out across dimensions, in parallel, each reading the same diff:**

- **signalgrid-reviewer** — the repo's known defect classes, fossil figures,
  unguarded prose, the publication boundary; verifies claims against what shipped.
- **fail-closed-auditor** — every place an unknown / missing / stale / empty input
  LOOSENS an answer instead of tightening it, and any figure that drifted from the
  artifact it describes.
- **code-reviewer** — correctness, security and maintainability of the change itself.
- Add **verdict-core-reader** if the diff touches `lib/signalgrid-core` or
  `lib/signalgrid-simulator`; add **gate-and-proof-engineer** if it adds or changes
  a gate or proof; add **security-reviewer** if it touches auth, an endpoint, or
  handles external input.

**3. Verify before reporting.** Give each finding an adversarial second look — a
plausible-but-wrong finding is worse than none. Drop what does not survive.

**4. Gates are not optional.** The change is not "reviewed clean" until
`node scripts/preflight.mjs` and `pnpm run verify:breadth` are green (quote them),
and for an api-server change `test:api` is N/N. A green agent panel over a red gate
is not done.

Report findings ranked most-severe first, each with a `file:line` and the concrete
failure it causes. Nothing found: say so plainly, with the gate output that backs it.

**Failure mode this guards:** treating one agent's opinion, or a passing typecheck,
as "reviewed." Review here is the panel AND the gates, verified — not one prompt.
