# Vendored: obra/superpowers

Third-party work, copied in unmodified. **Not ours.**

> **SEVENTEEN exceptions in this directory — read this before any re-vendor.** These are
> FIRST-PARTY, written in this repository and NOT part of the upstream set. They live
> here because the harness loads skills from this directory. Everything else below
> describes the other 100, from THIRTEEN upstreams — 14 from obra/superpowers, `watch/`
> from bradautomates/claude-video (2026-09-12, DR-040), and, the same day, 85 more from
> eleven collections the owner's bar admitted in one pass: mattpocock/skills (25),
> addyosmani/agent-skills (24), K-Dense-AI/scientific-agent-skills (13),
> mcollina/skills (4), google/skills (5), NVIDIA/skills (4),
> raintree-technology/hig-doctor (3), Neeeophytee/finding-unknowns-skills (3),
> rainmanjam/poka-yoke (2), oliver-zehentleitner/keep-the-why (1),
> and conorluddy/ios-simulator-skill (1) — 14 + 1 + 85 = 100. Each has its own section
> at the end of this file. Counted, not remembered: `git ls-files .claude/skills | awk -F/ 'NF>3{print $3}' | sort -u | wc -l`
> lists 117 tracked directories = 100 upstream + the 17 in the table (tracked, because only
> tracked paths publish; section E of `scripts/check-publication-boundary.mjs` holds this
> table, this count and the carve-outs to one another since 2026-09-02). This line said SEVEN until 2026-09-02,
> then TEN, then ELEVEN on 2026-09-03 when `research-ops/` was authored, then TWELVE on
> 2026-09-04 when `stack-reference/` was authored, then FOURTEEN on 2026-09-12 when
> `cli-anything/` and `video-intake/` were authored (DR-040) — the same drift
> that took it from "one exception" to seven, recorded below and now caught by section E
> the moment the count and the carve-outs disagree. SEVENTEEN on 2026-09-12, when the cloud
> lane wrote down three workflows it had run by hand that day (a fourth, `media-intake/`,
> was folded into `video-intake/` before landing — one skill per resource kind).
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
> | `cli-anything/` | 2026-09-12 | the first-party adapter for the CLI-Anything method, vendored unmodified under `third_party/cli-anything/` — how the seven phases map onto the `signalgrid` CLI over `/v1` and the MCP server (DR-040) |
> | `video-intake/` | 2026-09-12 | owner-shared video → frames through the vendored `watch/` skill, a transcript produced locally with faster-whisper (no key, no upload), an intake row (DR-040) |
> | `tool-evaluation-by-use/` | 2026-09-12 | how an owner-shared tool is evaluated BY USE and written into the intake log (Graphify intake) |
> | `landing-under-dr-037/` | 2026-09-12 | DR-037's five merge conditions, the merge-then-regenerate order, and the single evidence re-mint that follows |
> | `orchestrator-over-workers/` | 2026-09-12 | the spec-write / fan-out / review / land-one-at-a-time build pattern (docs/LANE_COORDINATION.md, 2026-09-12) |
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
| Commit | `b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (Release v6.3.0) |
| Committed upstream | 2026-08-12T09:53:21-07:00 |
| Vendored | 2026-08-20 |
| Contents | 14 skills, 51 files, byte-identical to upstream |
| Byte-identity re-verified | 2026-09-08 — 51 files + LICENSE identical to upstream@pin; HEAD still == pin (re-fetched from the raw CDN and diffed) |

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
| `bradautomates/claude-video` | MIT © 2026 Bradley Bonanno | **yes** — vendored (DR-040) |
| `mattpocock/skills` | MIT © 2026 Matt Pocock | **yes** — 25 vendored |
| `addyosmani/agent-skills` | MIT © 2025 Addy Osmani | **yes** — 24 vendored |
| `google/skills` | Apache-2.0 (no NOTICE; `plugin.json` attributes Google LLC) | **yes** — 5 vendored |
| `NVIDIA/skills` | Apache-2.0, and CC-BY-4.0 on some skills — the per-skill `license:` is read, not assumed | **yes** — 4 vendored |
| `K-Dense-AI/scientific-agent-skills` | MIT © 2025 K-Dense Inc. in aggregate, but 27 distinct per-skill `license:` values across 165 skills | **partly** — 13 vendored, each MIT in its own frontmatter |
| `rainmanjam/poka-yoke` | MIT © 2026 rainmanjam | **yes** — 2 vendored |
| `mcollina/skills` | MIT © 2026 Matteo Collina | **yes** — 4 vendored |
| `Neeeophytee/finding-unknowns-skills` | MIT © 2026 Neeeophytee | **yes** — 3 vendored |
| `oliver-zehentleitner/keep-the-why` | MIT © 2026 Oliver Zehentleitner | **yes** — 1 vendored |
| `raintree-technology/hig-doctor` | MIT © 2025 Raintree Technology | **yes** — 3 vendored |
| `conorluddy/ios-simulator-skill` | MIT © 2025 Conor Luddy | **yes** — 1 vendored |
| `Bambushu/crucible` | MIT © 2026 Maikel Slomp | yes by licence, **NOT taken** — the owner's list named one Crucible and the Mac lane adopted a different project of that name (`raddue/crucible`, installed selectively by `scripts/install-crucible.mjs`). What was measured of the namesake is recorded in the `raddue/crucible` row of `docs/agent/RESOURCE_INTAKE.md`. |
| `VoltAgent/awesome-agent-skills` | MIT (an INDEX; it ships no skill of its own) | read as a map only — every candidate was fetched from its own repository at its own pin |
| `ramzesenok/iOS-Accessibility-Audit-Skill` | **none** | **NO** — absence of a licence grants nothing |
| `trailofbits/skills` | **CC BY-SA 4.0** | **NO** — ShareAlike would reach this repository's own MIT grant. Doctrine read and written up first-party in `docs/agent/SKILL_AUTHORING_STANDARD.md` |
| `K-Dense-AI` — `deepspot-m` | **PolyForm-Noncommercial-1.0.0** | **NO** |
| `K-Dense-AI` — `what-if-oracle` | **CC BY-NC-SA 4.0** | **NO** |
| `K-Dense-AI` — `docx`, `pdf`, `pptx`, `xlsx`, `rowan` | **proprietary** ("LICENSE.txt has complete terms"; `rowan`: API key required) | **NO** |
| `K-Dense-AI` — `hugging-science`, `infographics`, `latex-posters`, `pyhealth` | **none declared** | **NO** |
| `K-Dense-AI` — `glycoengineering`, `phylogenetics`, `primekg` | **Unknown** | **NO** |
| `K-Dense-AI` — GPL-family (`GPLv3`, `GPL-2.0`, `GPL-3.0-or-later`) | **copyleft** | **NO** |

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
  re-read the first-party files the twelfth round had already read in full.
- **Byte-identity verified 2026-09-08, closing the caveat above.** The GitHub API
  is still 403 through the proxy, but the raw CDN (`raw.githubusercontent.com`) is
  reachable, so every vendored file was fetched from upstream at the pinned commit
  and compared: all 51 skill files plus the `LICENSE` (52 in total) are byte-identical
  to `obra/superpowers@b36e0829`. The owner re-shared the repository the same day; the
  commits feed showed upstream HEAD is STILL that pinned commit (Release v6.3.0,
  2026-08-12) — the pin is current, upstream has not moved since we vendored, and there
  is nothing new to vendor or adopt (no re-vendor, no new skill; a new skill would
  duplicate one already here). The verification was performed by fetching every vendored
  file from the raw CDN at the pinned commit and diffing it (fail-closed — a file that
  will not fetch is NOT-VERIFIED, never a silent pass); to re-check after a re-share,
  repeat that fetch-and-diff against the `Commit` above. It was deliberately NOT shipped
  as a committed script: no script in this repository makes an outbound network request,
  and the one written for this check tripped CodeQL's file-data-in-outbound-request query
  — introducing the tree's first network-fetching script for a convenience is not worth
  the surface, so the record is the evidence and the check stays a manual re-run.

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
| `watch/SKILL.md:193` | "delete it with `rm -rf <dir>`" (Step 5, clean up) | DENIED by the hook. The working directory lives under the system temp dir or the session scratchpad and is left for the harness to reclaim (`video-intake/SKILL.md`, step 4). |
| `watch/scripts/setup.py:201` | a printed install hint for Linux: `sudo apt install ffmpeg` / `sudo dnf install ffmpeg` | A string the installer PRINTS, never a command it runs — and `sudo` is denied here regardless. The cloud lane puts a pinned static ffmpeg build on PATH under the scratchpad; the Mac uses Homebrew (`video-intake/SKILL.md`, step 1). |
| `requesting-code-review/code-reviewer.md:116, :178` | Reviewer answers "Ready to merge? Yes / No / With fixes" | The reviewer vocabulary is `blocked \| approved-with-notes \| approved` and a reviewer never merges (`signalgrid-reviewer/SKILL.md:136-145`). |
| `dispatching-parallel-agents/SKILL.md:71-73, :95-112` | Dispatch "Fix <file> failures" agents; "Adjusting test expectations if testing changed behavior" | A proof may never be weakened to make something pass; the fixer is never the reviewer (`signalgrid-reviewer/SKILL.md:47, :110`; CLAUDE.md "Never bypass a check"). |
| `receiving-code-review/SKILL.md:205` | Reply via `gh api …/replies` unconditionally | The cloud lane has no `gh`; GitHub writes go through the MCP tools and are frugal (one reply when it resolves the task or raises a question). |
| `systematic-debugging/test-pressure-{1,2,3}.md:3` | "IMPORTANT: This is a real scenario. You must choose and act." | RED-phase FIXTURES written to defeat a skill's discipline (`writing-skills/testing-skills-with-subagents.md:154-161`). They describe no real outage; a session that opens one is reading a manufactured emergency. |
| `systematic-debugging/CREATION-LOG.md`, `test-*.md`, `writing-skills/examples/CLAUDE_MD_TESTING.md` | Nested layouts (`skills/debugging/…`, `~/.claude/skills/testing/…`) | This tree is flat; those paths do not exist and are upstream prose, not instructions. |
| `brainstorming/SKILL.md:100, :206`; `writing-plans/SKILL.md:18` | Write specs/plans to `docs/superpowers/{specs,plans}/` | No such directory exists and nothing gates it. Plans and designs are decision records (`docs/DECISION_RECORDS.md`) or scratchpad files, never a new untracked docs tree. |
| `using-superpowers/SKILL.md:54-59` | Lists Codex, Pi, Antigravity, Hermes references | Harness-specific; `references/gemini-tools.md` exists and is not listed. None of them apply here. |
| `brainstorming/scripts/server.cjs:208-225` | Reads `.claude/package.json` / `.claude/.codex-plugin/plugin.json` for a version | Neither file exists here; the version reads `unknown` (and, before the kill-switch above, was beaconed as such). |

| `constraint-driven-development/SKILL.md:287` | Lists `--no-verify` as the symptom of a slow edit-loop check | DENIED by `.claude/hooks/block-dangerous.sh` and by CLAUDE.md ("Never bypass a check: no `--no-verify`"). The sentence is a diagnosis, not a step, but the gate judges the span as written and the row is how a judgement is released here — a slow check is made faster or moved to CI, never skipped. |
| `setup-matt-pocock-skills/SKILL.md:76` | "If `CLAUDE.md` exists, edit it." (adds an `## Agent skills` block) | CLAUDE.md is the owner's file and is never edited by a skill (CLAUDE.md "Ask before"; the same rule that keeps `constraint-driven-development` out of it). What a session needs to know about these skills is this file. |
| `setup-matt-pocock-skills/SKILL.md:40` | Assumes an issue tracker reachable with `gh issue create` | The cloud lane has no `gh`. GitHub writes go through the MCP tools; the live queue is `docs/BUILD_BACKLOG.md` and decisions are `docs/DECISION_RECORDS.md`. |
| `implement/SKILL.md:15` | "Commit your work to the current branch." | Commit and push only when asked (CLAUDE.md "Ask before"). |
| `resolving-merge-conflicts/SKILL.md:12` | "Discover the project's **automated checks** and run them, typically typecheck, then tests, then format." | Green here is BOTH `node scripts/preflight.mjs` and `pnpm run verify:breadth` — `validate-sim-macos.sh` green is narrower and misses most gates (CLAUDE.md "Before you push"). |
| `resolving-merge-conflicts/SKILL.md:14` | "Stage everything and commit." | Commit only when asked (CLAUDE.md "Ask before"). |
| `triage/AGENT-BRIEF.md:32` | `gh issue list --label needs-triage` as the worked example | No `gh` on the cloud lane; the triage surface is `docs/BUILD_BACKLOG.md` and the MCP GitHub tools. |
| `api-and-interface-design/SKILL.md:215` | "**Set retention from the longest retry chain**" — an idempotency key must outlive every replay path, including a week-old dead-letter queue | LOSES to `artifacts/api-server/src/middlewares/idempotency.ts:47`, whose TTL is FIVE minutes. A decision-bearing 2xx is not a receipt: replaying an allow a working day after the posture that earned it degraded is posture pinning, and freshness beats retry convenience on a decision path (golden rule 2). |
| `git-workflow-and-versioning/SKILL.md:189` | `git reset --hard HEAD` "takes you back to the last successful state" | DENIED by the hook and by `settings.json`. Recovery here is a new commit or a fresh worktree, never a destructive reset. |
| `git-workflow-and-versioning/SKILL.md:292` | `git push origin v1.4.0` as a release step | Tagging, pushing and releasing are owner decisions (CLAUDE.md "Ask before"); the launch profile governs what may be said to ship. |
| `constraint-driven-development/SKILL.md:140` | "add one line to `AGENTS.md` and `CLAUDE.md`" | Never edits CLAUDE.md. The equivalent constraint file here is the gate suite itself — `scripts/preflight.mjs` and `scripts/verify-breadth.mjs` — and a gate is never weakened to make a change pass. |
| `constraint-driven-development/SKILL.md:154` | `brew install gitleaks` and the other machine-wide tool installs in the dimension table | The cloud lane installs nothing machine-wide and has no Homebrew; the Mac lane's toolchain is the owner's. Secret scanning here is CodeQL plus the repo's own gates, and a new dependency needs the lockfile discipline in CLAUDE.md. |
| `doubt-driven-development/SKILL.md:122` | Offers a cross-model second opinion through the Gemini or Codex CLI | Sending repository source to a third-party model is the owner's call per machine and the owner's key (CLAUDE.md "Ask before: anything that sends data to an external service"; DR-029 keeps keys out of the tree). The in-repo second reviewer is `signalgrid-reviewer`. |
| `finding-google-skills/SKILL.md:24` | "**Fetch the catalog byte-exactly.**" from `raw.githubusercontent.com/google/skills/main/index.json`, then load what it names | That is unpinned HEAD-tracking execution — the shape DR-026 refuses and the reason `cli-hub` was left out on 2026-09-12. Read the five vendored copies in this directory instead; a newer upstream arrives by a deliberate re-vendor. |
| `retrieving-developer-knowledge/SKILL.md:62` | Uses `DEVELOPERKNOWLEDGE_API_KEY`, or Application Default Credentials, against a Google endpoint | EGRESS. The query text leaves the machine. A key is the owner's per-machine decision and never lives in the tree (DR-029); with no credential the skill is read as documentation, not run. |
| `dpop-adoption/SKILL.md:33` | "**NEVER** import legacy CommonJS modules via `require('node:crypto')`" | Scoped to its own worked example. This tree's proofs and the `/v1` server are built on `node:crypto` and stay that way; the transferable half of the rule is the ESM import form, not a ban on the module. |
| `nemo-rl-session-memory/SKILL.md:27` | `mkdir -p session/<session_date_time>` in the repository being worked | Untracked directories flip `provenance.workingTreeClean` and stamp every later sim result as minted from a dirty tree. Checkpoints go under the session scratchpad. The path is ALSO ignored by the tracked `.gitignore` as a second line (`scripts/check-gitignore-producers.mjs`). |
| `nvidia-skill-finder/SKILL.md:147` | `npx skills add nvidia/skills --skill <name> --agent codex --global --yes` | Never run. It fetches and installs unpinned code at run time (DR-026, and the same ground `cli-hub` was refused on). Vendoring here is `git archive` at a pin plus a row in this file. |
| `mcore-split-pr/SKILL.md:40` | `gh pr view` / `gh pr diff` / `gh api user` against NVIDIA/Megatron-LM | No `gh` on the cloud lane and a different repository. The transferable part is the split discipline — one PR per reviewer group, tests travel with the code they validate, each PR independently mergeable. |
| `octocat/SKILL.md:82` | `git rebase -i <base>` | Interactive flags are not supported in this environment, and history rewriting is an owner decision (CLAUDE.md "Ask before: … history rewrite"). |
| `octocat/SKILL.md:86` | `git branch -d <branch>` → `git push origin --delete <branch>` | Branch deletion is an owner decision (CLAUDE.md "Ask before"); `scripts/cleanup-merged-branches.sh` is the only path and it reports before it acts. |
| `keep-the-why/references/setup.md:78` | `update-check: every 14 days` — a periodic release check against the upstream project | Never runs. Nothing in this tree makes an outbound request on a timer; the pin in this file is how a newer upstream arrives, deliberately. |
| `keep-the-why/SKILL.md:73` | "check `.keep-the-why` for a pinned version … the pin takes over" | The pin that governs is the `Commit` row of this file's `oliver-zehentleitner/keep-the-why` section. A config file inside the tree does not get to redirect which vendored copy loads. |
| `keep-the-why/SKILL.md:191` | Personal config at `~/.keep-the-why/<id>.md`, and a project `.keep-the-why` at the repository root | State lives under the session scratchpad, not in this tree and not in a home directory the gates cannot see (the same rule that moved the NVIDIA `session/` directory). |
| `clinical-decision-support/SKILL.md:240` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `database-lookup/SKILL.md:390` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `exploratory-data-analysis/SKILL.md:282` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `get-available-resources/SKILL.md:262` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `hypothesis-generation/SKILL.md:266` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `iso-standards-readiness/SKILL.md:354` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `market-research-reports/SKILL.md:339` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `paper-lookup/SKILL.md:288` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `peer-review/SKILL.md:290` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `scholar-evaluation/SKILL.md:298` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `scientific-critical-thinking/SKILL.md:182` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `scientific-writing/SKILL.md:358` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |
| `statistical-power/SKILL.md:202` | "Citing Scientific Agent Skills" — add the K-Dense arXiv paper to the references of anything the skill materially contributed to, and fetch `arxiv.org/abs/2609.00065` first to get the current version | No vendor citation is inserted into any SignalGrid deliverable, and no arxiv.org fetch is made (no script in this tree makes an outbound request). Attribution for these files is where it belongs and is machine-checked: the `K-Dense-AI/scientific-agent-skills` section of this file, the MIT `LICENSE.md` in each vendored directory, and the `.claude/skills` area of `scripts/publication-boundary.mjs`. |

Strength worth naming so a re-vendor cannot drop it: `verification-before-completion/SKILL.md:17-36`
("NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE") is the workflow form of
CLAUDE.md's "Truth and completion" block.

# Vendored: bradautomates/claude-video — `watch/`

Third-party work, copied in unmodified. **Not ours.** The second upstream in this
directory (DR-040, owner-directed 2026-09-12); its licence file travels with it as
`watch/LICENSE` because the directory-level `LICENSE` above is Jesse Vincent's.

| | |
|---|---|
| Upstream | https://github.com/bradautomates/claude-video |
| Author | Bradley Bonanno (bradautomates) |
| Licence | MIT © 2026 Bradley Bonanno (`watch/LICENSE`, copyright notice intact) |
| Commit | `83da59fa78c3eee9e20f515fe75c438bb5166efd` (`main`; manifest version 0.2.0, tag v0.2.0) |
| Committed upstream | 2026-06-30T17:20:07+10:00 |
| Vendored | 2026-09-12 |
| Contents | 1 skill, 12 files (`SKILL.md`, `.skillignore`, 8 Python scripts, 1 shell script) + LICENSE, byte-identical to `skills/watch/` at the pin (`diff -r` empty, excluding `__pycache__` and the added LICENSE) |
| NOT taken | `hooks/` — a `SessionStart` hook that runs `hooks/scripts/check-setup.sh` on every session start (the hooks-off rule of DR-026); `tests/`; the Claude, Codex and agents marketplace manifests; `dev-sync.sh`. The skill runs from this directory exactly as it would from a plugin cache — its `SKILL_DIR` convention is the directory containing the SKILL.md you read. |
| What it does here | Frames only, by default. Its transcript path POSTs the audio to Groq or OpenAI under a key; this repository's transcript comes from `video-intake/scripts/transcribe-local.py` instead, locally. A key in `~/.config/watch/.env` is the owner's per-machine decision (DR-029: never in the tree). |
| Measured before adoption | Sandbox at the pin, no key, one of the owner's 70.61 s clips: `--detail balanced` exit 0 in 4.53 s, 58 frames, `Transcript: none available`; its suite `5 failed, 66 passed` (all five: `yt-dlp` absent). Intake row 2026-09-12. |
| Overrides | Two rows in the table above: `watch/SKILL.md:193` and `watch/scripts/setup.py:201`. |

# Vendored: mattpocock/skills — 25 skills

Third-party work, copied in unmodified. **Not ours.** Vendored 2026-09-12 under the
owner's bar: a skill is taken if any part of it can aid building any aspect of this
company. Overlap with an existing skill is recorded in a row, never a reason to refuse.

| | |
|---|---|
| Upstream | https://github.com/mattpocock/skills |
| Author | Matt Pocock |
| Licence | MIT © 2026 Matt Pocock (`LICENSE` in each vendored directory, copyright notice intact) |
| Commit | `3cca18b368ae95cdbdebbff572ccafa662551015` |
| Committed upstream | 2026-09-04T09:43:27+01:00 |
| Vendored | 2026-09-12 |
| Contents | 25 skills, 74 files + 25 LICENSE copies, byte-identical to `skills/engineering/*` and `skills/productivity/*` at the pin (`diff -r` empty, excluding the added LICENSE) |
| Skills | `ask-matt`, `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-with-docs`, `implement`, `improve-codebase-architecture`, `prototype`, `research`, `resolving-merge-conflicts`, `setup-matt-pocock-skills`, `tdd`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `wizard`, `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents` |
| NOT taken | `misc/git-guardrails-claude-code` — installs a `PreToolUse` hook (the hooks-off rule of DR-026), and this repository already has `.claude/hooks/block-dangerous.sh`. `misc/setup-pre-commit` — installs Husky over the repo's own `.githooks/pre-push`. `misc/migrate-to-shoehorn` — adds a dependency. `misc/scaffold-exercises` — targets a foreign CLI. The whole `in-progress/` bucket, because its own README says those skills "can change or disappear without warning" and a pin to something disappearing is not a pin. `deprecated/` holds only a README. The plugin manifests. |
| Name twins | `grill-me/` and `handoff/` share a name with `.claude/commands/grill-me.md` and `.claude/commands/handoff.md`. A command and a skill are different namespaces and the plane gate keys on the skill directory, so both load; a session that means the owner's command should say so. Not a directory collision. |
| Overrides | Six rows in the table above: `setup-matt-pocock-skills/SKILL.md:76` and `:40`, `implement/SKILL.md:15`, `resolving-merge-conflicts/SKILL.md:12` and `:14`, `triage/AGENT-BRIEF.md:32`. |

# Vendored: addyosmani/agent-skills — 24 skills

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/addyosmani/agent-skills |
| Author | Addy Osmani |
| Licence | MIT © 2025 Addy Osmani (`LICENSE` in each vendored directory) |
| Commit | `6ca0cd7db39b41b1c37e26d335c507ee92382c6d` |
| Committed upstream | 2026-09-08T09:21:56+02:00 |
| Vendored | 2026-09-12 |
| Contents | 24 skills, 29 files + 24 LICENSE copies, byte-identical to `skills/*` at the pin |
| NOT taken | `test-driven-development/` — DIRECTORY COLLISION with the obra/superpowers skill already in this tree, which stays (the plane gate keys on the directory name). `hooks/` — a `SessionStart` hook plus an in-place file rewriter. `scripts/run-evals.js --behavioral`. The Claude, Codex, Gemini, opencode and agents marketplace manifests. |
| Overrides | Six rows: `api-and-interface-design/SKILL.md:215`, `git-workflow-and-versioning/SKILL.md:189` and `:292`, `constraint-driven-development/SKILL.md:287` and `:140` and `:154`, `doubt-driven-development/SKILL.md:122`. |

# Vendored: google/skills — 5 skills

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/google/skills |
| Author | Google LLC (attribution from `plugin.json`; the repository ships no NOTICE file) |
| Licence | Apache-2.0 (`LICENSE` in each vendored directory) |
| Commit | `150f8525e7e3329603b18d23a0f434aa29137eda` |
| Committed upstream | 2026-09-11T18:43:51-07:00 |
| Vendored | 2026-09-12 |
| Contents | 5 skills, 29 files + 5 LICENSE copies, byte-identical to `skills/identity/dpop-adoption`, `skills/cloud/gcloud`, `skills/cloud/developing-genkit-js`, `skills/developers/finding-google-skills` and `skills/developers/retrieving-developer-knowledge` at the pin |
| NOT taken | The rest of the catalog (ads, analytics and the remaining cloud/developer skills) was not read at this pin and is therefore not vendored — unread is not the same as refused, and a later pass can take more. The marketplace manifests and `index.json`. |
| Overrides | Three rows: `finding-google-skills/SKILL.md:24` (remote catalog fetch-and-follow), `retrieving-developer-knowledge/SKILL.md:62` (key / ADC egress), `dpop-adoption/SKILL.md:33` (the `node:crypto` ban). |

# Vendored: NVIDIA/skills — 4 skills

Third-party work, copied in unmodified. **Not ours.** The per-skill `license:` varies
across this repository, so each was read rather than assumed.

| | |
|---|---|
| Upstream | https://github.com/NVIDIA/skills |
| Author | NVIDIA Corporation & Affiliates |
| Licence | Apache-2.0 for `nemo-rl-session-memory`, `doca-hardware-safety` and `mcore-split-pr`; `nvidia-skill-finder` declares `CC-BY-4.0 AND Apache-2.0` in its own frontmatter and carries BOTH licence files. Attribution-only terms, no NonCommercial and no ShareAlike. |
| Commit | `9ca28078c7e9acef40347c7bb15449a281f3fb8d` |
| Committed upstream | 2026-09-11T09:34:17-05:00 |
| Vendored | 2026-09-12 |
| Contents | 4 skills, 24 files + 5 licence copies, byte-identical to `skills/*` at the pin. Each carries upstream's own `skill-card.md`, `BENCHMARK.md`, `evals/evals.json` and a sigstore bundle (`skill.oms.sig`) — the authoring bar written up first-party in `docs/agent/SKILL_AUTHORING_STANDARD.md`. |
| NOT taken | `skill-card-generator` — its frontmatter `name:` is QUOTED, which the plane gate reads as a name that does not equal its directory, and a vendored file is never edited to make a gate pass. Recorded here rather than silently dropped. The `plugins/` duplicate of `nvidia-skill-finder`, the marketplace manifests, `benchmarks.json`, the root certificate. |
| Signature note | The `.sig` bundles are vendored as files. Nothing in this tree verifies them: no script here makes an outbound request, and sigstore verification needs one. They are evidence of upstream's process, not a check this repository runs. |
| Overrides | Three rows: `nemo-rl-session-memory/SKILL.md:27` (a `session/` directory in the repository root), `nvidia-skill-finder/SKILL.md:147` (`npx skills add`), `mcore-split-pr/SKILL.md:40` (`gh`). |

# Vendored: K-Dense-AI/scientific-agent-skills — 13 skills

Third-party work, copied in unmodified. **Not ours.** This upstream needed the most
reading: the repository LICENSE.md is MIT, but its 165 skills carry 27 distinct
per-skill `license:` values, several of them NonCommercial, ShareAlike, proprietary,
GPL, "Unknown", or absent.

| | |
|---|---|
| Upstream | https://github.com/K-Dense-AI/scientific-agent-skills |
| Author | K-Dense Inc. |
| Licence | MIT © 2025 K-Dense Inc. (`LICENSE.md` in each vendored directory). Every vendored skill ALSO declares MIT in its own frontmatter. Both halves agree; nothing was taken on the aggregate alone. |
| Commit | `c1ed16d97dd61ff50a3bd46dd353e4a55fd77f34` |
| Committed upstream | 2026-09-11T19:09:21-07:00 |
| Vendored | 2026-09-12 |
| Contents | 13 skills, 338 files + 13 LICENSE.md copies, byte-identical to `skills/*` at the pin |
| Skills | `market-research-reports`, `scientific-critical-thinking`, `peer-review`, `scientific-writing`, `hypothesis-generation`, `exploratory-data-analysis`, `statistical-power`, `scholar-evaluation`, `get-available-resources`, `iso-standards-readiness`, `clinical-decision-support`, `database-lookup`, `paper-lookup` |
| NOT taken — licence | `deepspot-m` (PolyForm-Noncommercial-1.0.0), `what-if-oracle` (CC BY-NC-SA 4.0), `docx` / `pdf` / `pptx` / `xlsx` / `rowan` (proprietary — "LICENSE.txt has complete terms"; `rowan` also API-key-gated), `hugging-science` / `infographics` / `latex-posters` / `pyhealth` (no licence declared), `glycoengineering` / `phylogenetics` / `primekg` ("Unknown"), and the GPL-family skills. Absence of a licence grants nothing; NonCommercial and ShareAlike both reach this repository's own MIT grant. |
| NOT taken — mechanism | `citation-management` (ships its own scanner — an exfiltration chain), `literature-review` (mandatory OpenRouter plus a pipe from `curl` into a shell), `exa-search` (a vendor key and a mandatory vendor header), `autoskill`. |
| NOT taken — unread | The remaining ~130 skills were not read individually at this pin. Many declare MIT, Apache-2.0 or BSD and would be admissible under the owner's bar; several of those `license:` values describe the WRAPPED library rather than the skill's own grant, which is a question a person answers, not a regex. Unread is not refused: a later pass can take them, one read at a time. |
| Keys | `database-lookup` and `paper-lookup` ARE vendored: they document PUBLIC APIs. Several of the databases they name (for example the licensed clinical and chemical sources) need a key the caller supplies; no key is in this tree and none is fetched (DR-029). |
| NOT taken — this repository's own gate | `markdown-mermaid-writing`. Its `references/markdown_style_guide.md` carries two U+200E LEFT-TO-RIGHT MARKs (lines 529 and 543, prefixing a nested ```` ```mermaid ```` fence), which `scripts/check-text-safety.mjs` refuses as hidden bidirectional text (Trojan Source, CVE-2021-42574). A vendored file is not edited to make a gate pass, and a security gate is not given an exemption to admit one — so the skill is recorded here rather than taken. The same shape as NVIDIA's `skill-card-generator` one section up. |
| Overrides | Thirteen rows, one per site — the "Citing Scientific Agent Skills" directive, which appears in all 13 vendored SKILL.md files and asks for a vendor citation in the deliverable plus an arxiv.org fetch. Neither happens here. |

# Vendored: rainmanjam/poka-yoke — 2 skills

Third-party work, copied in unmodified. **Not ours.** Found through
`VoltAgent/awesome-agent-skills` (an index, read as a map only) and fetched from its own
repository at its own pin.

| | |
|---|---|
| Upstream | https://github.com/rainmanjam/poka-yoke |
| Author | rainmanjam |
| Licence | MIT © 2026 rainmanjam (`LICENSE` in each vendored directory) |
| Commit | `726a575e3d48d07d908abfcbb192cae09671fff2` |
| Committed upstream | 2026-08-31T18:08:48-07:00 |
| Vendored | 2026-09-12 |
| Contents | 2 skills, 2 files + 2 LICENSE copies, byte-identical to `plugins/poka-yoke/skills/poka-yoke` and `plugins/poka-yoke/skills/agent-guardrails` at the pin |
| NOT taken | The other ~19 MB of the repository: the plugin scaffolding for eleven agent harnesses, the `benchmarks/` corpus, the `assets/devices/` hook and pre-commit templates (auto-execution), `scripts/`, and the nine other skills in the same plugin, which were not read at this pin. |
| Why it is here | `poka-yoke` is mistake-proofing as a design discipline — make the wrong thing impossible rather than documented — which is what every gate in `scripts/` is. `agent-guardrails` names the commands an agent must never run; this repository's version of that is `.claude/hooks/block-dangerous.sh`, and the two are worth reading against each other. |
| Overrides | None needed. Both files NAME dangerous commands inside warning prose, which the instruction-conflict gate reads as mentions, not invocations, and reports rather than fails on. |

# Vendored: mcollina/skills — 4 skills

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/mcollina/skills |
| Author | Matteo Collina |
| Licence | MIT © 2026 Matteo Collina (`LICENSE` in each vendored directory) |
| Commit | `856efd268ae85482d882f3d0bed869fd020b5c06` |
| Committed upstream | 2026-08-17T16:47:06+00:00 |
| Vendored | 2026-09-12 |
| Contents | 4 skills (`node`, `typescript-magician`, `documentation`, `octocat`), 39 files + 4 LICENSE copies, byte-identical to `skills/*` at the pin |
| NOT taken | `fastify`, `nodejs-core`, `oauth`, `init`, `linting-neostandard-eslint9`, `skill-optimizer`, `snipgrapher` — not read at this pin, not refused. The `src/` TypeScript tooling and `package.json` (a dependency). |
| Overrides | Two rows: `octocat/SKILL.md:82` (`git rebase -i`) and `:86` (`git push origin --delete`). |

# Vendored: Neeeophytee/finding-unknowns-skills — 3 skills

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/Neeeophytee/finding-unknowns-skills |
| Author | Neeeophytee |
| Licence | MIT © 2026 Neeeophytee (`LICENSE` in each vendored directory) |
| Commit | `6d7dda2a7b6d50db6a0da3a8b7899dea7f2856cd` |
| Committed upstream | 2026-09-09T21:32:28+05:30 |
| Vendored | 2026-09-12 |
| Contents | 3 skills (`blindspot-pass`, `assumption-test`, `context-audit`), 3 files + 3 LICENSE copies, byte-identical to `skills/*` at the pin |
| NOT taken | The rest of the collection, the `evals/`, `scripts/`, `site/` and the five harness plugin manifests. |
| Why it is here | The same discipline `pnpm run check:absence` enforces mechanically — prove the absence before writing it down — expressed as a procedure. `docs/agent/FALSE_CLAIMS.json` is the record of what happens when nobody does. |
| Overrides | None needed. |

# Vendored: oliver-zehentleitner/keep-the-why — 1 skill

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/oliver-zehentleitner/keep-the-why |
| Author | Oliver Zehentleitner |
| Licence | MIT © 2026 Oliver Zehentleitner (`LICENSE` in the vendored directory) |
| Commit | `9cf4ca65088cf4fca7ab6f3548621bfb73ad0192` |
| Committed upstream | 2026-09-11T16:57:22+02:00 |
| Vendored | 2026-09-12 |
| Contents | 1 skill, 17 files + LICENSE, byte-identical to `skills/keep-the-why` at the pin |
| NOT taken | `action.yml` (a GitHub Action), the `dashboard/` web app, `context/`, `experiments/`, the `keep-the-why-lint` packaging, and the five harness plugin manifests. |
| Why it is here | It is `docs/DECISION_RECORDS.md` as a working habit: record WHY, grade the evidence, mark a decision superseded rather than deleting it. Its Status/Evidence split (`confirmed` / `inferred` / `unknown`) is a sharper vocabulary than this repository currently uses for its own records. |
| Overrides | Three rows: `references/setup.md:78` (the periodic update check), `SKILL.md:73` (a config file redirecting which version loads), `SKILL.md:191` (state in the project root and in a home directory). |

# Vendored: raintree-technology/hig-doctor — 3 skills

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/raintree-technology/hig-doctor |
| Author | Raintree Technology |
| Licence | MIT © 2025 Raintree Technology (`LICENSE` in each vendored directory) |
| Commit | `3ec08f5a6f9d2fa22a64950274ba6baee2a38838` |
| Committed upstream | 2026-09-04T13:36:07-07:00 |
| Vendored | 2026-09-12 |
| Contents | 3 skills (`hig-foundations`, `hig-platforms`, `hig-project-context`), 28 files + 3 LICENSE copies, byte-identical to `skills/*` at the pin |
| NOT taken | The other `hig-components-*` and `hig-inputs` skills (not read at this pin), the `plugin/` bundle, `action.yml`, the Remotion demo, `brand/`, and `.env.example` / `.infisical.json` (a secrets workflow). |
| Why it is here | CLAUDE.md's iOS section is a list of Human Interface Guidelines defects this repository has already shipped and fixed — a pinned `UIUserInterfaceStyle`, 18 raw `systemFont` call sites, fixed 44pt rows under Dynamic Type, `deny` at 3.18:1 on card. These three are the general form of that checklist. They ADVISE; `scripts/check-ios-dynamic-type.mjs` and `scripts/check-ios-policy-defaults.mjs` still decide. |
| Overrides | None needed. |

# Vendored: conorluddy/ios-simulator-skill — 1 skill

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/conorluddy/ios-simulator-skill |
| Author | Conor Luddy |
| Licence | MIT © 2025 Conor Luddy (`LICENSE.md` in the vendored directory) |
| Commit | `4207f82fc2309962f35ebfc9ed67cc7f61b8f6a1` |
| Committed upstream | 2026-09-11T10:55:51+01:00 |
| Vendored | 2026-09-12 |
| Contents | 1 skill, 45 files + LICENSE.md, byte-identical to `ios-simulator-skill/skills/ios-simulator-skill` at the pin |
| NOT taken | `.pre-commit-config.yaml` and the repository's own CI, `tests/`, `site/`, `pyproject.toml` (a dependency), the plugin manifest. |
| How its scripts are treated | Exactly as the `watch/` skill's Python is: a PERSON runs them, on the Mac lane, against a booted simulator. Nothing in this tree auto-runs them, and no hook or `SessionStart` was taken. They are simulator drivers — `xcrun simctl` wrappers — so they cannot and do not claim on-device enforcement (CLAUDE.md, platform honesty: a simulator cannot be MDM-enrolled). |
| Why it is here | CLAUDE.md already requires verifying EnterpriseShell at `accessibility-extra-large`, not just the default. `appearance.py` and `accessibility_audit.py` are that check with a handle on it. |
| Overrides | None needed. |
