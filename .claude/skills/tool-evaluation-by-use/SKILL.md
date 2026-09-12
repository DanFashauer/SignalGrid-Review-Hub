---
name: tool-evaluation-by-use
description: Use when the owner shares a tool, plugin, CLI or repository and it has to be judged — before writing its docs/agent/RESOURCE_INTAKE.md row, before adopting or rejecting it, and before writing any sentence about what it does or what it costs.
---

# Evaluating an owner-shared tool BY USE

A shared resource is answered with a measurement or a named blocker, never with a
memo of reasons (`docs/agent/RESOURCE_INTAKE.md`, "Rules for a new row"; DR-021).
The row is logged the day it arrives; the verdict lands after the tool has run.

## 1 — Log the row first, evaluate second

Append to the intake log in `docs/agent/RESOURCE_INTAKE.md`: Date | Resource |
Directed by (the owner's own words) | Disposition | What it changed. A row reading
"evaluated, not adopted" is legitimate only when it names what was actually run or
read. Reasons alone are the failure mode that file exists to replace.

## 2 — Identify and pin before anything executes

- Resolve the real upstream, redirects included, and record both names.
- Record licence, language, package name and published version, default branch,
  and a **full commit sha**. Pin the sha. "Latest" is not a pin, and a pin that
  cannot be fetched is a finding, not a detail.
- When an article is the source, check the ARTICLE against upstream before the
  tool: the 2026-09-12 listicle row refuted every command it printed, and two of
  its four tools were already absorbed (DR-029 for the gateway).
- Licence first if anything would be copied into this public tree —
  `.claude/skills/VENDORED.md` states why absence of a licence grants nothing.

## 3 — Read the source before running it

Answer four questions from the source, each with a path:

- what it READS;
- what it WRITES, and whether any of it lands inside a checkout;
- what it sends over the NETWORK, and to whom;
- what it registers as a HOOK.

A third-party binary auto-executed from a `PreToolUse` or post-commit hook is
refused here whatever it measures (intake rule 3). So is anything that would put
untracked output inside the tree: `provenance.workingTreeClean` in
`artifacts/sim-results/` counts untracked files, so one stray output directory
stamps every later result as minted from a dirty tree.

## 4 — Run it in a sandbox, with no keys, against a COPY

```bash
git worktree add -b eval/<tool>-<stamp> <scratchpad>/eval-<tool> origin/SignalGrid_Alpha
pnpm install --frozen-lockfile          # in the new worktree, its own install
```

Then copy only the surface under test (for the 2026-09-12 Graphify run: `lib/` +
`scripts/`, 956 files) into a scratch directory and point the tool at the copy.
No API keys. No tenant data. No install into any session config. Nothing that
edits `CLAUDE.md`, `.claude/settings.json` or `.claude/skills/`.

## 5 — Measure. Do not quote the README

Record, from output:

- the real command, its exit code and its wall time;
- what it emitted, in counts;
- **offline behaviour** — re-run with every socket denied by a shim. Identical
  output means the tool needs no network; a different or failed run means it does,
  and the row says so;
- **determinism** — repeat over an UNCHANGED tree. Output that oscillates between
  runs is not a pure function of the source (five forced rebuilds alternating
  11,489 / 11,464 nodes is a fail, not noise);
- **the headline claim, recomputed** — find the denominator yourself. The
  "70x" figure was not in its README, and the tool's own benchmark printed 463.4x
  because it wrote the word count to one path and read it from another.

## 6 — Disposition: one sentence, one landing place

State adopted / adopted-by-reference / evaluated-not-adopted, the numbered reasons
that came from the run, and the ONE place it would land if ever used, with its
conditions. A tool that changes how green is certified needs a decision record
before adoption (intake rule 3; DR-029 and DR-031 are the two shapes this has
taken). Close the row with what changed in the tree — "Nothing of it is in the
tree" is a complete answer.

## Never

- Never adopt, or reject, from a README or an article.
- Never install a tool under evaluation into a session config or a git hook.
- Never let it write inside the checkout, and never cite its output in a gate, a
  proof, a doc figure, or anything on the decision path.
- Never write "X does not exist" before `pnpm run check:absence <topic>` and
  reading the matches yourself.
- Never send repository content or owner data to an external service without
  asking first (CLAUDE.md, "Ask before").
- Never report a refused or blocked trial as a result. It is a named blocker,
  and the row says who has to unblock it.
