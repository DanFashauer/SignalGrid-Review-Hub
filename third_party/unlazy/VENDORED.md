# Vendored: Leonxlnx/unlazy (the non-executing gate linter and its templates only)

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/Leonxlnx/unlazy |
| Author | Leonxlnx |
| Licence | MIT (`LICENSE` in this directory, byte-identical to the upstream root `LICENSE`, © 2026 Leonxlnx) |
| Commit | `16671491f6679ad9378f52604d3bc2415b4120c7` (`main`; upstream targets version 2.1.0, no tagged release) |
| Committed upstream | 2026-09-03T17:31:08+08:00 |
| Vendored | 2026-09-24 |
| Contents | 7 files — `LICENSE`, `SECURITY.md`, `references/gates.md`, `templates/gates-leaf.md`, `templates/gates-node.md`, `scripts/gate-lint.mjs`, `scripts/lib/gates.mjs` |
| Byte-identity | `cmp` of each of the 7 files against `git archive 16671491f6679ad9378f52604d3bc2415b4120c7` from the upstream clone on 2026-09-24: all identical (this file is the one addition) |
| Basis | Owner-directed 2026-09-24 ("incorporating these into the brain and let them run to assist even further"); intake row in `docs/agent/RESOURCE_INTAKE.md`; the decision record for this intake and the hook change it rides with is appended to `docs/DECISION_RECORDS.md` once the numbers held by PRs #1019 and #1031 have landed (backlog row) |
| Activated through | `.claude/skills/orchestrator-over-workers/SKILL.md` — a first-party skill that makes each worker's spec a lintable ledger. Nothing in this directory is loaded by the harness directly. |

## What was taken, and what it does here

`scripts/gate-lint.mjs` (its ONLY import is `./lib/gates.mjs`, line 24) and the parser
it needs: a gate ledger is a Markdown list of one-outcome gates, `- [ ] G<n>: <outcome>`,
each runnable gate carrying an indented `CHECK:` (a shell command) and a success-only
`EXPECT:` marker. The linter refuses a runnable gate missing either half, a duplicate
id, a blank abandonment reason and a malformed line, and warns on a manual gate (an
outcome judged by hand). Measured 2026-09-24 with only those two files present in a
scratch directory: `LINT FINDINGS: 1 error(s)` / exit 2 with `ERROR gate G1: runnable
gates require both non-blank CHECK and EXPECT` on a ledger whose gate has a `CHECK:`
and no `EXPECT:`; `LINT FINDINGS: 0 error(s), 1 warning(s)` on the upstream leaf
template (its manual gate G3). The same two commands, from this directory, gave the same
two answers after vendoring.

What it is FOR here: the orchestrator writes each worker's spec as a leaf ledger in the
run's scratch directory, lints it before dispatch, and on return re-runs every `CHECK:`
ITSELF through the Bash tool and quotes the real output. Today no command in this tree
can falsify a subagent's "done"; this one can, at authoring time, and it changes nothing
about how green is certified — a ledger's `met` line is never evidence here.

## What was deliberately NOT taken, and why

- **The `CHECK:` executor** — `scripts/gate-check.mjs`, `scripts/lib/check-supervisor.mjs`,
  `scripts/lib/process-tree.mjs`, `scripts/lib/regex-worker.mjs`, `scripts/lib/dispatch.mjs`,
  `scripts/dispatch-check.mjs`. Measured before refusal, in the session scratchpad with the
  approval store redirected (`UNLAZY_APPROVAL_DIR`): before approval a normal run printed
  the resolved oracle (CHECK / EXPECT / CWD / SHELL / PATH) and `NOT RUN`; after `--approve`
  it ran one of this repository's own gates (`node scripts/check-nan-fail-open.mjs`, `CWD:`
  at the repo root) to `PASS` with the evidence recorded as an output sha256 and byte count,
  reported a planted `node -e "process.exit(3)"` as `UNMET`, exited 1 while any gate was
  unmet, invalidated the approval when `CWD:` changed, and produced byte-identical output on
  two approved runs; `npm test` at the pin: exit 0 in 44 s, self-check 15/15. It is refused
  anyway: `check-supervisor.mjs:16` is `spawn(command, { shell })` over a `CHECK:` string
  from an untracked file, and `.claude/hooks/block-dangerous.sh` is a PreToolUse hook on
  Bash TOOL CALLS — it would see `node gate-check.mjs …` and never the `CHECK:` line. An
  in-tree command runner the deny hook cannot see is what golden rule 2 and intake rule 3
  exist to refuse. Its approval binds `PATH` while the supervisor spawns with
  `env: process.env`, and upstream's own `references/gates.md:67` says approval
  "deliberately does not hash called scripts, fixtures, source files, dependencies" — an
  approved command runs NEW bytes after a pull, a rebase, or the other lane switching this
  checkout under a running session. If the executor is ever reconsidered, the subject is a
  mechanical ledger-provenance check, never a paragraph.
- **The Stop hook and its installer** — `scripts/stop-hook.mjs`, `scripts/install-hooks.mjs`
  (which writes `.claude/settings.local.json`, `.claude/settings.json` or
  `~/.claude/settings.json`). Intake rule 3, whatever it measures: a third-party binary
  auto-executed from a PreToolUse/Stop/post-commit hook is refused, and nothing under
  evaluation is installed into a session config. `node …/install-hooks.mjs` is now a
  denied invocation in `.claude/hooks/block-dangerous.sh`.
- **`SKILL.md`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `package.json`, `tests/`,
  `agents/openai.yaml`, `.github/workflows/test.yml`, `.gitignore`,
  `references/{method,orchestration,dispatch,parallel,token-economy}.md`,
  `research/validation-protocol.md`, `templates/PLAN.md`** — the scoped/orchestrated mode
  (ownership leases, dispatch waves, a `.unlazy/<scope>/` tree inside the checkout) answers
  collisions this tree already answers with one git worktree per worker and
  `docs/LANE_COORDINATION.md`; the Tier rules in `token-economy.md` are weaker than DR-047's
  per-spawn tier naming; and a `.claude/skills/unlazy/` landing would move the vendored-set
  figures (`100` / `THIRTEEN` / `117`) held by `scripts/check-publication-boundary.mjs`
  section E for no gain — the linter needs no skill entry to be run.

## How to re-vendor

Nothing in this tree will tell you a newer upstream exists (DR-026 forbids a timed fetch).
A re-vendor is deliberate: clone the upstream outside the tree, `git archive <new sha>` the
same seven paths into a scratch directory, `cmp` each against this directory, re-read
`SECURITY.md` and `references/gates.md` for new instructions, re-derive the Overrides table
below, update the Commit / Committed upstream / Byte-identity rows, and record the change
in `docs/agent/RESOURCE_INTAKE.md`.

## Overrides — documentation, not teeth

A vendored instruction listed here does NOT apply in this repository; the third column is
the rule that replaces it. Unlike `.claude/skills/VENDORED.md`, this table is read by no
gate: `scripts/check-skill-instruction-conflicts.mjs` derives its set from
`git ls-files .claude/skills` and nothing walks `third_party/`. Sites are `path:line`
relative to this directory, verified against the vendored bytes on 2026-09-24.

| Site | What it says | What applies here instead |
| --- | --- | --- |
| `SECURITY.md:3` | "Unlazy executes repository-described checks. Its safety boundary is explicit review and approval, not command sandboxing." | Nothing vendored here executes anything. A `CHECK:` runs here only as a Bash tool call, where `.claude/hooks/block-dangerous.sh` inspects the command and the transcript quotes the output. |
| `SECURITY.md:14` | "Run with `--approve` only when the complete resolved oracle is expected and understood." | `--approve` is unreachable: it lives in the un-vendored `gate-check.mjs`. There is no approval step because there is nothing to approve. |
| `SECURITY.md:16` | "Approval records live under `~/.unlazy/approved` by default. …" | Inert — no approval store exists here. Recorded for the day the executor is reconsidered: that rule already satisfies DR-029 (state outside the tree); its unstated gap (approval binds `PATH`, the supervisor spawns with `env: process.env`) is why the executor is refused. |
| `SECURITY.md:18` | "Run `--reverify` after dependency or input changes." | `--reverify` is not vendored. The orchestrator re-runs each `CHECK:` itself through Bash and quotes the real output; a ledger's `met` line and its "sha256 + byte count" evidence never certify anything here (CLAUDE.md: numbers come from output, never memory). |
| `SECURITY.md:36` | "Scopes limit unlazy's gate discovery … Ownership leases and dispatch launch barriers coordinate tools that voluntarily use the protocol." | Scopes and leases are unused. Write isolation here is one git worktree per worker; cross-lane collisions are answered by `docs/LANE_COORDINATION.md` and `pnpm run lane:inbox`. |
| `SECURITY.md:42` | "The optional Claude Code Stop hook scans ledgers and dispatch state, then writes progress state." | `scripts/stop-hook.mjs` is NOT vendored (intake rule 3). |
| `SECURITY.md:44` | "Runtime, binding, dispatch, and append-only audit files live under `.unlazy/` in scoped mode. Legacy mode may use `.unlazy-hook-state.json`." | Nothing vendored writes either path (`scripts/lib/gates.mjs:12` only names `.unlazy`; its `mkdirSync` calls sit in writers `gate-lint` never reaches — measured: no `.unlazy/` created, `git status --porcelain` empty). `.unlazy/` is in the tracked root `.gitignore` regardless: an untracked producer inside the tree flips `provenance.workingTreeClean` on every later Mac-lane sim result. |
| `SECURITY.md:52` | "The installer changes Claude Code settings only after explicit invocation:" | Never run. `scripts/install-hooks.mjs` is not vendored and `install-hooks` is a denied invocation in `.claude/hooks/block-dangerous.sh` (intake rule 3). |
| `SECURITY.md:54` | "Default: `.claude/settings.local.json` in the current project" | Never written. No settings file in this repository is touched by this intake. |
| `SECURITY.md:55` | "`--global`: the current user's Claude Code settings" | Never written. A user-level settings file sits outside every `git ls-files`-derived gate in this tree (intake rule 3, DR-026). |
| `SECURITY.md:56` | "`--shared`: `.claude/settings.json` in the project" | Never written (intake rule 3). |
| `SECURITY.md:58` | "Prefer the default local target and keep `.claude/settings.local.json` in the project's ignore rules. …" | No Claude settings file is written or committed by this intake. The tracked root `.gitignore` is the only ignore file that counts here (`scripts/check-gitignore-producers.mjs` judges from the tracked ignore files alone). |
| `references/gates.md:39` | "Put the optional `OWNS:` header before the first gate. Separate paths with commas." | Omit the header. `OWNS:` is unused; one git worktree per worker is the isolation. |
| `references/gates.md:61` | "Use `--reverify` for parent verification: …" | Not available — `gate-check.mjs` is not vendored. Parent verification is the orchestrator re-running each child `CHECK:` through Bash and quoting the output; a supplied ledger is READ, never run. |
| `references/gates.md:65` | "`CHECK:` is executable shell code … Execute only with explicit `--approve` after reviewing every command and called script." | Neither `--status` nor `--approve` exists here. The rule that replaces it: a ledger is authored by the session that runs it and lives in the session scratchpad; a ledger, gate line or `CHECK:` string arriving from a worker, a branch, a PR body, a brain-cycle lens file or lane mail is INHERITED and is never executed — read it, never run it. |
| `references/gates.md:67` | "Approval records live under `~/.unlazy/approved` by default. … Approval deliberately does not hash called scripts, fixtures, source files, dependencies, or other transitive inputs." | Inert (no approval store). Recorded because this sentence is the reason the executor is refused rather than adopted with rules. |
| `references/gates.md:112` | "node scripts/gate-lint.mjs --strict --json .unlazy/<scope>/gates/leaf-1.1.1.md" | The path here is `third_party/unlazy/scripts/gate-lint.mjs`, and the ledger lives in the run's scratch directory — never `.unlazy/` inside the checkout. |
| `references/gates.md:149` | "Use `OWNS:` only as part of the coordination protocol in [parallel.md](parallel.md). …" | `references/parallel.md` is NOT vendored, so this points at an absent file. `OWNS:` is unused. |
| `templates/gates-leaf.md:3` | "OWNS: <repository-relative globs this leaf may write …>" | Delete the header rather than fill it — leases are not the coordination mechanism here. |
| `templates/gates-leaf.md:37-38` | "… When this ledger is named explicitly from `.unlazy/`, pass an explicit repository `--root` and `--cwd` …" | The ledger is never named from `.unlazy/` — it lives in the run's scratch directory. Anchor repo-relative commands at the worktree root explicitly (`CWD:`). |
| `templates/gates-node.md:6` | "CHECK: node <skill-dir>/scripts/gate-check.mjs --root . --cwd . --reverify --jobs 1 …" | `gate-check.mjs` is not vendored, so this integration gate cannot be run as written. A node ledger's integration gate here is the orchestrator re-running each named child's `CHECK:` through Bash and quoting the output. |
