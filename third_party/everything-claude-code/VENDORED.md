# Vendored: affaan-m/everything-claude-code

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/affaan-m/everything-claude-code |
| Author | Affaan Mustafa |
| Licence | MIT (`LICENSE` in this directory, copyright notice intact) |
| Commit | `d8409a4b0813771235555e32e3d8046a73988bfa` |
| Committed upstream | 2026-08-19T23:31:56+00:00 |
| Vendored | 2026-08-23 |
| Contents | 46 files — 9 agents, 10 common rules, 10 skills, 10 commands, 3 contexts, 1 MCP config. **No executable code.** |
| Basis | DR-016 |

## Why this source and not the one the owner named

The owner supplied `https://github.com/worldflowai/everything-claude-code.git`.
That repository was cloned and read, and it is **not** what was vendored. Two
verified reasons:

**1. It carries no licence.** `curl` of its `LICENSE` returns **HTTP 404**, and
no file in its tree contains MIT text. Its `.claude-plugin/plugin.json` declares
`"license": "MIT"` in JSON metadata and points `homepage`/`repository` at
`affaan-m/everything-claude-code`, which is evidence of origin, not a grant.
`.claude/skills/VENDORED.md` already states the rule this repository lives by,
in bold: **absence of a licence is not permission — it is the default, which
grants nothing.** This repository is PUBLIC, so anything committed here is
republished under our own MIT grant, and we can only grant what we were granted.

The upstream it forks from **does** carry a real licence — verified, HTTP 200,
`MIT License / Copyright (c) 2026 Affaan Mustafa`. So the material is usable;
only the route to it had to change.

**2. It is a seven-month-old snapshot.** Fork HEAD is `432485b`, 2026-01-23.
Upstream HEAD is the commit above, 2026-08-19. In between, upstream grew from 81
files to 3,493, `agents/` went from 9 to dozens, `skills/` from 11 to 286, and
flat `rules/*.md` were reorganised into 22 language-scoped folders. Only **6 of
the fork's 81 files are byte-identical** to upstream today; 52 have evolved.

So "the fork's component set, at the licensed upstream's current version" is what
this directory holds. Same shape, licensed source, current content.

## What was deliberately NOT taken, and why

| Not taken | Reason |
|---|---|
| `WORLDFLOWAI.md` | Fork-only. Exists in no licensed source, so there is no grant covering it. |
| `examples/sessions/*.tmp` | Fork-only sample transcripts. Sample data, no value here. |
| `hooks/**/*.sh` (4 shell hooks) | Superseded upstream by the Node versions in `scripts/hooks/`, which are what this directory carries. |
| `skills/project-guidelines-example` | Fork-only, and an example by its own name. |
| `commands/{e2e,eval,orchestrate,tdd,verify}.md` | Absent from upstream `commands/`. The only basename matches are under `docs/tr/` — Turkish translations, not the English originals — so vendoring them would have meant shipping a translation while claiming it was the source. |
| Upstream's other ~3,400 files | Out of the scope the owner approved: 286 skills, 94 commands, 21 language rule sets, Codex/Cursor/Kiro tooling, a 62MB tree. This repository is under a breadth freeze. |

Three of the resolutions above came from a basename search that returned
CONFIDENT WRONG ANSWERS — `rules/coding-style.md` matched `rules/kotlin/coding-style.md`,
`rules/testing.md` matched a `tinystruct-patterns` reference, and the five
commands matched Turkish translations. Each was checked against
`rules/common/` before copying. A basename is a hypothesis, not a resolution.

## Why no JavaScript is vendored here

The first version of this directory carried the upstream Node hook scripts and
their tests — `scripts/hooks/*.js`, `scripts/lib/*.js`, `tests/**`. CI rejected
it: **CodeQL raised 71 high-severity alerts, every one of them inside that
vendored code.** Two shapes, both real:

- **Insecure temporary files** — predictable paths created in the OS temp
  directory, in `scripts/lib/utils.js`, `scripts/hooks/suggest-compact.js`, and
  throughout the test files. On a shared machine that is a symlink/TOCTOU
  opening.
- **Incomplete string escaping** in `scripts/hooks/session-end.js`, which does
  not escape backslashes in its input.

None of it was ever going to run here — the hooks were already inert by
decision. So the code was carrying 71 findings on our public security surface in
exchange for nothing.

**It was deleted rather than suppressed.** Adding `third_party/` to a CodeQL
ignore list would have made the number go away while the code stayed in a public
repository under our own republication. This repository's whole discipline is
that a failing gate is failing; quieting a scanner over code we chose to ship
would be the same move as relaxing a gate to fit the copy, which the launch-claims
work refused twice in one day.

What remains is prose and configuration: agent definitions, rules, skills,
commands, contexts, one MCP config. **No executable code.** `hooks/hooks.json`
went too — a hook configuration pointing at scripts that no longer exist would
describe a wiring nobody has.

If the hooks are ever wanted, they are re-vendored deliberately, at that
version, and **read** before activation — with those 71 findings as the starting
point of the review rather than a surprise after it.

## Status: vendored, NOT yet activated

Only `agents/` is wired into the harness (`.claude/agents/`). Everything else is
present, licensed and auditable, and is loaded by nothing:

- **The hooks are not here at all.** They would have run third-party code on
  session start, session end and pre-compact — an execution surface overlapping
  `.githooks/pre-push`. They were vendored inert, then removed outright when
  CodeQL found 71 high-severity issues in them (see above).
- **`.claude/package-manager.json` upstream declares `bun`.** This repository is
  pnpm, and `pnpm-lock.yaml` drift already has a pre-push hook guarding it. That
  file was not copied, and the package-manager scripts are inert for the same
  reason.
- **Commands, rules, skills and contexts are reference material** until something
  first-party cites them.

## Why this directory is `third_party/` and not `vendor/`

It was `vendor/` for about ten minutes, and the cited-path gate rejected it —
correctly, and for a reason worth keeping.

`docs/MAC_LANE.md` quotes `vendor/go.podman.io/buildah/define/types.go` while
explaining a Podman ulimit default. That path lives inside **Podman's** source
tree, not ours. While no `vendor/` directory existed here, the gate read it as an
external reference and left it alone. Creating one turned the same string into a
repository path that resolved to nothing, and a true sentence in an unrelated
document started failing the build.

`scripts/check-cited-paths.mjs` had already reserved the right name: its
`INTAKE_PREFIXES` lists `third_party/`, with an underscore, alongside `vendor/`.
Renaming to the convention the repository had already anticipated fixed both
halves at once — MAC_LANE's external citation is external again, and this tree is
excluded from a gate that governs OUR claims about OUR files, which is the only
thing it can honestly govern given we may not edit anything in here.

The general lesson, since it will recur: **a new top-level directory can change
the meaning of text nobody touched.** `vendor/`, `build/`, `dist/`, `test/` and
`lib/` are all names that appear inside quoted output from other projects.

## Caveats a reader needs

- **Unmodified on purpose.** An untouched copy is the cheapest thing to audit and
  to re-sync. Do not edit files here. If something needs to differ for this repo,
  write our own and say why it differs. Per DR-016, on a conflict with
  first-party doctrine the vendored copy is **deleted, not edited** — an edited
  vendor copy can no longer be diffed against upstream.
- **Vendored, not tracked.** Nothing re-syncs this. The commit above is the
  version that was read.
- **Not reviewed line by line.** These 60 files are third-party content that has
  been surveyed, not audited. They are NOT counted in
  `docs/agent/review-coverage.json`, because counting unread files as reviewed is
  the precise fiction that ledger exists to prevent.
- **No test files are vendored**, so none are declared unexecuted. The earlier
  declaration in `scripts/check-test-execution.mjs` was removed with them — a
  stale exemption fails that gate, which is how the removal stayed honest.
