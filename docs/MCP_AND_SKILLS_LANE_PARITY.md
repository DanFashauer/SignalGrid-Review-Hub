# MCP and skills — lane parity

Two Claude lanes work this repository: a cloud lane and a Mac lane. This page is
the honest map of what each lane gets automatically, what it must set up per
machine, and the boundary between them — so "the cloud lane has these tools" and
"this machine has these tools" stop being different sentences.

The short version: **skills and agents travel through git, so both lanes already
have them on pull. The dev MCP servers do not travel through git — they install
per machine, and `pnpm run mcp:setup` is the one command that sets them up on
either lane.**

## What both lanes already share, through git

- **Skills** — everything under `.claude/skills/` is tracked, so a pull gives a
  lane every skill. The count is derived, not hardcoded:
  `git ls-files .claude/skills | awk -F/ 'NF>3{print $3}' | sort -u | wc -l`
  (25 tracked skill directories at time of writing — 14 vendored obra/superpowers
  skills plus 11 first-party, per `.claude/skills/VENDORED.md`). Nothing needs
  installing; a pull is the whole mechanism.
- **Agents** — everything under `.claude/agents/` is tracked too. Derived count:
  `ls .claude/agents/*.md | wc -l` (13 dispatchable agents at time of writing),
  governed by `scripts/check-agent-roster.mjs` and `scripts/check-org-roster.mjs`,
  and now shape-checked by `scripts/check-skill-plane-conformance.mjs`.
- **`signalgrid-mcp`** — the repo's own MCP server is registered from the tracked
  `.mcp.json`, which names only that one server (command and args, no credentials).
  Both lanes get it on pull. The Node server it points at lives in
  `artifacts/mcp-server/package.json` in this same tree.

This half needs no fix and no command — it is documentation of a property that
already holds. Pull the branch and both lanes are at parity on skills, agents, and
`signalgrid-mcp`.

## What each lane sets up per machine — the dev MCP servers

The dev MCP servers the cloud lane leans on are **not** in the repo; they install
per machine at user scope. `scripts/setup-mcp-lane.mjs` (`pnpm run mcp:setup`) runs
the existing pinned installers and registers the keyless ones idempotently, safe on
cloud and Mac, writing no secret to any tracked file:

| Server | How `pnpm run mcp:setup` handles it | Env key the lane supplies |
| --- | --- | --- |
| Context7 | Registers `scripts/install-context7.mjs` — pinned `@upstash/context7-mcp@4.0.4`, user scope, keyless | none (keyless) |
| Neural Memory | Runs `scripts/install-neural-memory.mjs` when `uv` + `claude` are present; skips cleanly otherwise (DR-026) | `NEURALMEMORY_DIR` (a path, not a secret; defaults to `~/.neuralmemory`, must be outside the repo) |
| Firecrawl | Runs `scripts/install-firecrawl.mjs` when `FIRECRAWL_API_KEY` is set; skips cleanly otherwise (DR-022) | `FIRECRAWL_API_KEY` (secret) |
| GitHub | **Documented, not auto-registered** — the correct command depends on the transport (hosted HTTP vs a local server image), and guessing wrong is worse than documenting | `GITHUB_PERSONAL_ACCESS_TOKEN` (secret) |
| Playwright | **Documented, not auto-registered** — keyless, but a clean setup needs both a pinned client and a browser install (`npx playwright install chromium`), more than one registration | none (keyless) |

The setup script prints this same per-lane env map on every run, so a lane always
knows what it must supply. A missing CLI (`claude`, `uv`) or a missing key is a
clean **skip with a warning, never a failure** — the same behaviour `mac-kickoff.sh`
step 4 uses for the `signalgrid-mcp` registration. An installer whose preconditions
were met but which then errors *does* fail the run: not-installed is never reported
as success.

## The honest boundary

- **Each lane supplies its own keys.** A secret (`FIRECRAWL_API_KEY`,
  `GITHUB_PERSONAL_ACCESS_TOKEN`) is read from the environment on the machine that
  will use it. Nothing is committed, printed, or copied between lanes. This is the
  DR-026 installer discipline: pinned, user scope, keys env-only, hooks off.
- **Registrations are user scope, not the repo's `.mcp.json`.** A keyless session
  must not try to spawn a server that needs a key and break, so only
  `signalgrid-mcp` lives in the tracked config.
- **The dev servers are research/verification infrastructure, not product.** None
  enters a decision path, a proof fixture, the deterministic core, or the product
  build. They are how a human-shaped research or documentation step gets done, and
  nothing the product ships depends on them.
- **The Mac lane's evidence job is unchanged.** `mac-kickoff.sh` still mints and
  commits real-hardware evidence exactly as before; it can call `pnpm run mcp:setup`
  as an early, skippable, non-fatal step so a cold Mac reaches full parity in one
  command, but the evidence lane does not depend on the dev servers.

## The one command per lane

```bash
pnpm run mcp:setup      # sets up the per-machine dev MCP servers on this lane
```

On the Mac, `./mac-kickoff.sh` runs this early (skippable with `--skip-mcp-lane`)
and then proceeds to the evidence lane. The intake context is in
`docs/agent/RESOURCE_INTAKE.md` (Firecrawl DR-022, Neural Memory DR-026), and the
leaderboard disposition that named this parity work is
`docs/research/MCP_MARKET_LEADERBOARDS.md`.
