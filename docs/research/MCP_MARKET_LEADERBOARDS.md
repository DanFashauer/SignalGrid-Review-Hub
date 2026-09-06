# MCP Market leaderboards — disposition by use

**Provenance.** Two MCP Market leaderboards were shared by the owner on 2026-09-03:
"Top Agent Skills" (82 entries) and "Top 100 MCP Servers" (the top ~82 shown,
ranked by GitHub stars). The screenshots are third-party artwork and are **not
committed** (the publication boundary keeps someone else's page out of this public
repo). This catalogue holds every leaderboard entry that could plausibly help
build and complete SignalGrid against what this repository already has, then names
the genuine gaps that were adopted and the categories that are noise for an
enterprise access-decision fabric.

This follows the intake doctrine (DR-021, `docs/agent/RESOURCE_INTAKE.md`): a
resource is absorbed **by use**, wired into the tree where it strengthens it, and
never answered with a memo of reasons. The repository is already saturated — 26
tracked skill directories, 13 dispatchable agents, and the dev MCP servers the
cloud lane uses — so most of the leaderboard is *already covered*, and the honest
disposition for it is to say so and point at the surface that does the job.

The counts above are derived, not remembered:
`git ls-files .claude/skills | awk -F/ 'NF>3{print $3}' | sort -u | wc -l` and
`ls .claude/agents/*.md | wc -l`.

---

## (a) Already covered — the leaderboard entry and the surface that already does it

### Dev MCP servers this repo already uses

| Leaderboard entry | Already covered by |
| --- | --- |
| Context7 (servers #6); "Documentation Lookup" / "Live Documentation Lookup" (skills #37, #44, #47) | Connected in the cloud sessions; now installable per-machine with `scripts/install-context7.mjs` (`pnpm run context7:install`, pinned, keyless) so the Mac lane reaches it too. |
| Playwright (servers #12); Chrome DevTools / Chrome Browser / Steel Browser / BrowserTools / Browser (servers #8, #44, #75, #77, #79) | Playwright + Chromium in the cloud session and the `.claude/agents/e2e-runner.md` agent. Browser automation for this repo is end-to-end testing, not a product surface. |
| GitHub (servers #14); "GitHub Operations" / "GitHub Integration" / "GH Issues Auto-Fixer" (skills #22, #31, #9) | The `github` MCP in-session, plus the repo's PR/branch discipline and `.claude/skills/finishing-a-development-branch/SKILL.md`. |
| Firecrawl (servers #76); "Data Scraper Agent" (skill #24) | Connected; installable with `scripts/install-firecrawl.mjs` (`pnpm run firecrawl:install`, DR-022) — hosted MIT client, key from env, report-only. |
| Codebase Memory / Graphiti / Cognee / Claude Context (servers #10, #15, #16, #43); Serena (#18); "Context Keeper" (skill #56); Beads (#28) | Neural Memory (DR-026), installable with `scripts/install-neural-memory.mjs`. Operating-memory substrate only — it remembers, it judges nothing, and committed docs stay the memory of record. Durable issue/continuity memory also lives in `docs/BUILD_BACKLOG.md` (gated by `scripts/check-backlog-ownership.mjs`) and `docs/agent/LOOP.md`. |

All five are per-machine servers, not repo content. `scripts/setup-mcp-lane.mjs`
(`pnpm run mcp:setup`) now installs the keyless/keyed ones in one command on either
lane; the full parity map is `docs/MCP_AND_SKILLS_LANE_PARITY.md`.

### MCP frameworks → the repo builds its own server

| Leaderboard entry | Already covered by |
| --- | --- |
| FastMCP (#22), Mcp-Go (#62), MCP Agent (#66), Eino (#40), "Model Context Protocol for Beginners" (#30) | The repo's own MCP server, `artifacts/mcp-server/package.json` — a read-only server over the fixture-backed decision core (DR-008: an orchestration interface, not a trust authority). SignalGrid does not need a framework to *build* an MCP server; it has one. `docs/MCP_ARCHITECTURE.md` states the plane split. |

### Agent-workflow and orchestration skills → the repo's own skill/agent plane

| Leaderboard entry | Already covered by |
| --- | --- |
| Superpowers (servers #1) | Vendored unmodified under MIT — 14 skills, recorded in `.claude/skills/VENDORED.md`. |
| "Agent Skill Creator" (#5); Skill Seeker (servers #38) | `.claude/skills/writing-skills/SKILL.md`, plus the new `scripts/check-skill-plane-conformance.mjs` gate (see section b). |
| "Skill Compliance Checker" (#13) | `scripts/check-agent-roster.mjs`, `scripts/check-org-roster.mjs`, `scripts/scan-agent-plane.mjs`, and the new `scripts/check-skill-plane-conformance.mjs` — the mechanical form of "does the agent adhere to its definition". |
| "Background Coding Agent" (#7), "Coding Agent Orchestrator" (#33), "Implement Spec" (#30); Ruflo / Claude-Flow / Praison AI / Archon / PAL / Zen (servers #3, #37, #64, #21, #49, #58) | `.claude/skills/dispatching-parallel-agents/SKILL.md`, `.claude/skills/subagent-driven-development/SKILL.md`, and the 13-agent roster (`.claude/agents/planner.md`, `architect.md`, etc.) governed by the roster gates. |
| OpenSpec (#4), Task Master (servers #19); "Implement Spec" | `.claude/skills/writing-plans/SKILL.md` + `.claude/skills/executing-plans/SKILL.md`. Task Master is unread-licence in `.claude/skills/VENDORED.md` and deliberately not taken. |
| "Prompt Optimizer" (#17) | The prompt-authoring slash commands under `.claude/` (see `.claude/COMMANDS.md`) and `.claude/skills/owner-comms/SKILL.md`. |
| "Strategic Context Compaction" (#16) | The session rituals `.claude/skills/loop-start/SKILL.md` / `loop-end/SKILL.md` and `docs/agent/LOOP.md`. |

### Quality, security, and research skills → existing roles and gates

| Leaderboard entry | Already covered by |
| --- | --- |
| "Repo Scan" (#18, #50) | `pnpm run scan:estate`, `pnpm run review:invariants`, and the whole `proof:*` / `check:*` gate suite; the ponytail-audit lane (DR-024). |
| "Security Review" (#38, #66), "GateGuard Pre-Action Gate" (#11) | `.claude/agents/security-reviewer.md`, `.claude/agents/fail-closed-auditor.md`, `guard:boundary`, and the fail-closed doctrine itself — a pre-action gate is the product's entire premise. |
| "TDD" / "Python Testing" / "Go Testing" (#72, #81) | `.claude/skills/test-driven-development/SKILL.md` + `.claude/skills/verification-before-completion/SKILL.md` + the proof suite. (The stack is TypeScript, so the Python/Go *language* skills themselves are out of scope — see section c.) |
| "Implement Spec" worktrees; git-worktree workflows | `.claude/skills/using-git-worktrees/SKILL.md`. |
| "Deep Research" (#20), "Market Research & Intelligence" (#21), "Research Ops" (#48), "Lead Intelligence" (#68); GPT Researcher (servers #17) | The `docs/research/` corpus (`docs/research/README.md`) + the new `.claude/skills/research-ops/SKILL.md` (see section b), and `pnpm run check:absence` before asserting any absence. |
| "Diagram Maker" / "Next AI Draw.io" / "DrawIO Skill" (#8; servers #13, #65) | `docs/research/VISUAL_CODE_ASSET_STRATEGY.md` (source-controlled visual code) + the artifact-diagramming guidance. |
| "1Password CLI" (#4) and secrets tooling | The repo's standing rule: secrets are env-only and never committed; installers read keys from the environment (`scripts/install-firecrawl.mjs` is the pattern). A vault CLI is a per-machine operator choice, not repo content. |

---

## (b) Adopt — the genuine, safe, non-duplicative gaps that were built

Each is **repo-native** — an instruction file or a gate, not an external MCP
install (that sends data out and needs the owner's explicit yes) and not a
duplicate of an existing skill.

1. **Skill/agent-plane conformance gate** — `scripts/check-skill-plane-conformance.mjs`
   (self-tested; wired into `scripts/preflight.mjs` and the CI workflow). It derives
   every `.claude/skills/*/SKILL.md` and `.claude/agents/*.md` and asserts each
   carries the `name` and `description` the harness selects it by, with a `name`
   that matches its own directory/filename, over a floor so a broken walk fails
   loudly. This is what "Skill Compliance Checker" (#13) and "Agent Skill Creator"
   (#5) point at, in the repo's own "everything is gated" idiom, and it fills a real
   gap between `check-agent-roster.mjs` (which never checked skills or the
   `description` field) and `check-org-roster.mjs` (which checks a skill exists, not
   its shape).

2. **`research-ops` skill** — `.claude/skills/research-ops/SKILL.md`. Evidence-first
   market/competitive/discovery research held to the repo's citation-and-truth
   discipline: every claim cited to something that resolves, nothing fabricated,
   `check:absence` before writing that anything is missing, the publication boundary
   and claim discipline, and the narrowest-truthful verb. It points at the existing
   `docs/research/` corpus and `docs/agent/DISCOVERY_LOG.md` rather than restating
   them, and it exists because the owner's #1 blocker is discovery — the only number
   that moves the company — and no existing skill was a research/discovery workflow
   (`research-ops skill` returns CORROBORATED-absent from `pnpm run check:absence`).
   It is an instruction file: it installs nothing and sends nothing out.

3. **One-command dev-MCP lane setup** — `scripts/setup-mcp-lane.mjs`
   (`pnpm run mcp:setup`) plus `scripts/install-context7.mjs`. This does not adopt a
   new external service; it makes the *already-adopted* servers reachable on either
   lane in one command, so "the cloud lane has these tools" and "this machine has
   these tools" stop being different sentences. Keys stay env-only; missing
   CLIs/keys skip cleanly; GitHub and Playwright are documented rather than
   guessed. See `docs/MCP_AND_SKILLS_LANE_PARITY.md`.

Nothing else on either leaderboard was a genuine, safe, non-duplicative gap.
Candidates that looked adoptable but were **already covered** are recorded in
section (a) rather than rebuilt.

---

## (c) Out of scope — the noise for an enterprise access-decision fabric

Named as categories, not one by one, because the disposition is the same for each:
they solve a problem this product does not have, and adding them would be surface
area a one-person-plus-agents org cannot carry.

- **Consumer content and media** — meme makers, persona forges, programmatic video
  (Remotion), slide generators, resume builders.
- **Social media distribution** — cross-platform posters and the Xiaohongshu /
  RedNote publishing and download tools.
- **Music, trading/quant, 3D modelling (Blender), bioinformatics (gget),
  telephony (Fonoster, ESP32 device backends), and reverse-engineering / offensive
  security** (IDA Pro, Ghidra, HexStrike) — entirely different domains.
- **Framework- and language-specific stacks the repo does not use** — Vue/Nuxt,
  Kotlin (Ktor/Exposed/Compose Multiplatform), Django, Go frameworks, Next.js /
  Turbopack, and the ClickHouse / MySQL / database-migration pattern skills. The
  decision core is deterministic and fixture-backed with no database in the
  decision path; the only databases here are the CI-only Postgres jobs.
- **OS / desktop / VM control and cluster tooling** — Desktop Commander, Cua,
  Osaurus, the Windows and Docker-Android servers, Kubeshark. Platform honesty
  (golden rule 4) already bounds what a client app may claim; a general desktop
  controller is not part of it.
- **Line-of-business verticals** — food delivery, energy procurement, USPTO
  patent/trademark search (IP is an owner-and-counsel matter, see
  `docs/research/IP_AND_LICENSING.md`), Google Workspace CLI, e-commerce.
- **Vertical clinical/safety skills** — e.g. "Healthcare CDSS Development". Domain
  safety belongs in the HOST apps, never in SignalGrid (the embedded-UX law,
  `docs/EMBEDDED_UX_PRINCIPLE.md`). This is a doctrine boundary, not a maturity gap.
- **Native-platform skills** (Apple On-Device Foundation Models, Swift Actor
  Persistence, Compose Multiplatform) are *adjacent* but deferred: the native
  surfaces are maintained, not extended, and any new one needs a decision record
  first (DR-020). Noted here so the boundary is explicit rather than silent.
