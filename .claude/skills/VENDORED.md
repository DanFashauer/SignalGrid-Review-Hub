# Vendored: obra/superpowers

Third-party work, copied in unmodified. **Not ours.**

> **TWELVE exceptions in this directory — read this before any re-vendor.** These are
> FIRST-PARTY, written in this repository and NOT part of the upstream set. They live
> here because the harness loads skills from this directory. Everything else below
> describes the other 14. Counted, not remembered: `git ls-files .claude/skills | awk -F/ 'NF>3{print $3}' | sort -u | wc -l`
> lists 26 tracked directories = 14 upstream + the 12 in the table (tracked, because only
> tracked paths publish; section E of `scripts/check-publication-boundary.mjs` holds this
> table, this count and the carve-outs to one another since 2026-09-02). This line said SEVEN until 2026-09-02,
> then TEN, then ELEVEN on 2026-09-03 when `research-ops/` was authored, then TWELVE on
> 2026-09-04 when `stack-reference/` was authored — the same drift
> that took it from "one exception" to seven, recorded below and now caught by section E
> the moment the count and the carve-outs disagree.
>
> **The seventh, `signalgrid-master/`, arrived 2026-08-25 under DR-018 and is a
> MIRROR, not an original.** The owner's synced copy at
> `~/.claude/skills/synced/signalgrid-master/` still exists and still loads on that
> machine. What changed is which copy is AUTHORITATIVE: this one, because it is the
> one that can be reviewed, diffed, and named as an executor by
> `check-org-roster.mjs`, which derives executors from disk under the repository root
> and cannot see a home directory at all. `pnpm run scan:agent-plane` reports the
> synced copy AND compares it byte-for-byte against this one, printing `identical` or
> `DIVERGED` — and `no mirror` on a machine with nothing synced, which is what it
> prints on any box but the owner's. That comparison did not
> exist when this sentence was first written on 2026-08-25 — the scanner read only
> the home directory and never opened the committed copy, so the safeguard named
> here was a claim with nothing behind it. Implemented the same day, once the first
> agent-platform-engineer shift caught it. When the two disagree the committed copy
> wins, and the synced one is the one to correct.
>
> | Skill | Authored | What it defines |
> | --- | --- | --- |
> | `owner-comms/` | 2026-08-20 | how this org writes to the owner |
> | `signalgrid/` | 2026-08-22 | the base skill every SignalGrid role inherits |
> | `signalgrid-core/` | 2026-08-22 | executor for web, performance, data, API and six domain roles |
> | `signalgrid-native/` | 2026-08-22 | executor for mobile, desktop, firmware and the Mac lane |
> | `signalgrid-reviewer/` | 2026-08-22 | executor for qa-engineer |
> | `signalgrid-scribe/` | 2026-08-22 | executor for docs, compliance, release, archivist, positioning |
> | `signalgrid-master/` | 2026-08-25 | the orchestration layer — vendored from the owner's synced skills per DR-018 |
> | `signalgrid-evidence-toolchain/` | 2026-08-26 | the evidence toolchain a role uses to produce provable output (#321) |
> | `loop-start/` | 2026-08-31 | the session-start ritual — handoff enforcement pack, DR-021 |
> | `loop-end/` | 2026-08-31 | the session-end ritual — handoff enforcement pack, DR-021 |
> | `research-ops/` | 2026-09-03 | evidence-first market/competitive/discovery research discipline (MCP Market leaderboards intake) |
> | `stack-reference/` | 2026-09-04 | the corrected quick reference for every tool in the stack — 102 verified places generic cheatsheet advice breaks a rule here, and the form to use instead (Fechin/reference intake) |
>
> **This note said "one exception" until 2026-08-24, and it was true when written on
> 08-20.** The five `signalgrid-*` skills landed on 08-22, after it, and nothing
> updated the sentence — so a re-vendor operator following it literally would have
> overwritten the skills that define four of the org's executors. Found by the
> first audit of `.claude/`, which until that day no role owned.

| | |
|---|---|
| Upstream | https://github.com/obra/superpowers |
| Author | Jesse Vincent |
| Licence | MIT (`LICENSE` in this directory, copyright notice intact) |
| Commit | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` |
| Committed upstream | 2026-08-12T09:53:21-07:00 |
| Vendored | 2026-08-20 |
| Contents | 14 skills, 51 files, byte-identical to upstream |

## Why these and nothing else

Seven skill collections were surveyed. Only these were taken, and the reason is
licensing before it is taste — **this repository is PUBLIC**, so anything committed
here is republished under our own MIT grant, and we can only grant what we were
granted.

| Surveyed | Licence | Usable here |
| --- | --- | --- |
| `obra/superpowers` | MIT © 2025 Jesse Vincent | **yes** — vendored |
| `OneWave-AI/claude-skills` | MIT © 2025 OneWave AI | yes, not taken |
| `affaan-m/ECC` | MIT © 2026 Affaan Mustafa | yes, not taken |
| `ericbuess/claude-code-docs` | MIT | yes, not taken |
| `yamadashy/repomix` | MIT © 2024 Kazuki Yamada | yes — a tool, would be a dependency |
| `eyaltoledano/claude-task-master` | custom "Task Master License" | **unread — do not use until read** |
| `ComposioHQ/awesome-claude-skills` | **none** | **NO** |
| `travisvn/awesome-claude-skills` | **none** | **NO** |
| `hesreallyhim/awesome-claude-code` | **CC BY-NC-ND 4.0** | **NO** |

Three of those carry **no licence file at all**, and one of them holds 864 skills.
Absence of a licence is not permission — it is the default, which grants nothing.
"It is on GitHub and the repo is called awesome" is the exact reasoning this table
exists to stop. `CC BY-NC-ND` rules itself out twice over: **NonCommercial**
against a commercial venture, **NoDerivatives** against adapting anything.

This is what `scripts/publication-boundary.mjs` means by its `third_party_intake`
class: *"The risk here is not leaking outward — it is REPUBLISHING someone else's
licensed work from a public repository."* This directory is classified there, with
the licence basis above as the stated basis.

## Why superpowers specifically

Its 14 skills describe the discipline this repository already enforces mechanically.
`verification-before-completion`, `systematic-debugging`,
`test-driven-development`, `requesting-code-review` and
`finishing-a-development-branch` are the workflow form of what `preflight.mjs` and
the `proof:*` suite enforce as gates. Adopting them adds no new claim to the
product and no new surface to the launch profile.

## Caveats a reader needs

- **Unmodified on purpose.** An untouched copy is the cheapest thing to audit and
  to re-sync against upstream. Do not edit files here — if a skill needs to differ
  for this repo, write our own under `.claude/commands/` and say why it differs.
- **`using-superpowers` is harness-specific.** Its `references/` name Codex,
  Gemini, Antigravity, Hermes and Pi tooling that this repository does not use.
  Kept anyway rather than pruned, because a partial copy is harder to diff against
  upstream than a whole one, and MIT does not require us to ship all of it.
- **Vendored, not tracked.** Nothing re-syncs this automatically. The commit above
  is the version that was read; a newer upstream is not in this tree until someone
  deliberately re-vendors and re-reads.
- **Read line by line on 2026-09-06 (nineteenth/twentieth audit round), not before.**
  Until that date these 51 files were third-party prompt content that had been
  surveyed, not audited. The read produced the Overrides table below: every
  vendored instruction that contradicts CLAUDE.md, the hooks, or the tree, and the
  repo rule that replaces it. The files themselves stay unmodified (first caveat);
  the override is the record. What the read did NOT do: verify byte-identity
  against upstream (the GitHub API returned 403 through the sandbox proxy), or
  re-read the 16 first-party files the twelfth round had already read in full.

## Overrides

A vendored instruction listed here does NOT apply in this repository. The first cell
is the site (`path:line`, relative to `.claude/skills/`); `scripts/check-skill-instruction-conflicts.mjs`
reads this table and exempts exactly these sites from its deny-list check — a site
not listed here that prescribes a command `.claude/hooks/block-dangerous.sh` denies
fails the gate. Judgement conflicts (commit without asking, verdict vocabulary) are
recorded here for the reader; no regex reads intent.

| Site | What it says | What applies here instead |
| --- | --- | --- |
| `finishing-a-development-branch/SKILL.md:16` | "Run the project's full test suite (`npm test` …)" | There is no `test` script at the root. Green means BOTH `./validate-sim-macos.sh` (failures 0 AND the skipped count read) and `node scripts/preflight.mjs` — CLAUDE.md "Before you push", `loop-end/SKILL.md`. |
| `finishing-a-development-branch/SKILL.md:96` | `git merge <feature-branch>` | Merging is the owner's decision or a reviewed PR; never a local merge into mainline (CLAUDE.md "Ask before"). |
| `finishing-a-development-branch/SKILL.md:111` | `git branch -d <feature-branch>` | Branch deletion is an owner decision (CLAUDE.md "Ask before: … branch deletion"). |
| `finishing-a-development-branch/SKILL.md:156` | `git branch -D <feature-branch>` | DENIED by `.claude/hooks/block-dangerous.sh` and `settings.json`; never run. |
| `finishing-a-development-branch/SKILL.md:225` | "force-push only on your human partner's explicit request" | No force-push, full stop (CLAUDE.md "Truth and completion"; `settings.json` denies it). A rejected push is fetched and merged, never forced. |
| `subagent-driven-development/SKILL.md:17-25` | "Continuous execution: do not pause to check in … Rulings, not stalls" | Dan decides; Claude Code executes. Show a plan before editing; commit and push only when asked (CLAUDE.md). The carve-outs at :27-31 (merges, shared-branch pushes, publishes) are the floor here, not the ceiling. |
| `subagent-driven-development/SKILL.md:483` | "delete this plan's workspace (`rm -rf <workspace>`)" | DENIED by the hook. Workspaces live under the session scratchpad and are left for the harness to reclaim. |
| `brainstorming/scripts/stop-server.sh:114` | `rm -rf "$SESSION_DIR"` in the server teardown | Guarded by `[[ "$SESSION_DIR" == /tmp/* ]]` on :113, so it reaches only an ephemeral session directory — and it runs INSIDE a script, where the Bash hook judges `bash stop-server.sh` and never sees the line. The gate found it; this row is the record that a person read the guard. |
| `subagent-driven-development/implementer-prompt.md:38` | "4. Commit your work" | Commit only when asked (CLAUDE.md "Ask before"). |
| `writing-plans/SKILL.md:123-128` | "Step 5: Commit" + `git commit -m …` | Same. |
| `brainstorming/SKILL.md:210` | "Commit the design document to git" | Same. |
| `using-git-worktrees/SKILL.md:86` | "Add to .gitignore, commit the change, then proceed" | Same; and the worktree roots it names are ignored by the tracked `.gitignore` (gated by `scripts/check-gitignore-producers.mjs`). |
| `writing-skills/SKILL.md:665` | "Commit skill to git and push to your fork" | Same. |
| `writing-skills/anthropic-best-practices.md:856-877` | "Good example: Handle errors explicitly" — `FileNotFoundError` and `PermissionError` both return `''` | That is the catch-arm-mints-its-own-success shape golden rule 2 forbids: an unreadable input is UNKNOWN and tightens, never an empty success. `scripts/check-nan-fail-open.mjs` holds the TypeScript twin of this defect. |
| `brainstorming/scripts/server.cjs:106-112, :247-249` | Embeds `https://primeradiant.com/brand/…logo.png?v=<version>` in every served page unless a telemetry kill-switch is set | Outbound traffic to a third party without asking (CLAUDE.md "Ask before: anything that sends data to an external service"). `.claude/settings.json` now sets `SUPERPOWERS_DISABLE_TELEMETRY=1` in the session environment, which the server's own code honours. |
| `brainstorming/visual-companion.md:95-102` | `--host 0.0.0.0` "if the URL is unreachable" | Loopback only. Mockups here carry unreleased copy, a claim surface. |
| `brainstorming/visual-companion.md:278` | "use actual images (Unsplash)" | No third-party fetch into a mockup; the fixture assets under `docs/preview/` and `docs/assets/`. |
| `requesting-code-review/code-reviewer.md:116, :178` | Reviewer answers "Ready to merge? Yes / No / With fixes" | The reviewer vocabulary is `blocked \| approved-with-notes \| approved` and a reviewer never merges (`signalgrid-reviewer/SKILL.md:136-145`). |
| `dispatching-parallel-agents/SKILL.md:71-73, :95-112` | Dispatch "Fix <file> failures" agents; "Adjusting test expectations if testing changed behavior" | A proof may never be weakened to make something pass; the fixer is never the reviewer (`signalgrid-reviewer/SKILL.md:47, :110`; CLAUDE.md "Never bypass a check"). |
| `receiving-code-review/SKILL.md:205` | Reply via `gh api …/replies` unconditionally | The cloud lane has no `gh`; GitHub writes go through the MCP tools and are frugal (one reply when it resolves the task or raises a question). |
| `systematic-debugging/test-pressure-{1,2,3}.md:3` | "IMPORTANT: This is a real scenario. You must choose and act." | RED-phase FIXTURES written to defeat a skill's discipline (`writing-skills/testing-skills-with-subagents.md:154-161`). They describe no real outage; a session that opens one is reading a manufactured emergency. |
| `systematic-debugging/CREATION-LOG.md`, `test-*.md`, `writing-skills/examples/CLAUDE_MD_TESTING.md` | Nested layouts (`skills/debugging/…`, `~/.claude/skills/testing/…`) | This tree is flat; those paths do not exist and are upstream prose, not instructions. |
| `brainstorming/SKILL.md:100, :206`; `writing-plans/SKILL.md:18` | Write specs/plans to `docs/superpowers/{specs,plans}/` | No such directory exists and nothing gates it. Plans and designs are decision records (`docs/DECISION_RECORDS.md`) or scratchpad files, never a new untracked docs tree. |
| `using-superpowers/SKILL.md:54-59` | Lists Codex, Pi, Antigravity, Hermes references | Harness-specific; `references/gemini-tools.md` exists and is not listed. None of them apply here. |
| `brainstorming/scripts/server.cjs:208-225` | Reads `.claude/package.json` / `.claude/.codex-plugin/plugin.json` for a version | Neither file exists here; the version reads `unknown` (and, before the kill-switch above, was beaconed as such). |

Strength worth naming so a re-vendor cannot drop it: `verification-before-completion/SKILL.md:17-36`
("NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE") is the workflow form of
CLAUDE.md's "Truth and completion" block.
