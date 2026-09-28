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
  (118 tracked skill directories as of 2026-09-20 — 101 vendored (14 obra/superpowers, 1 bradautomates/claude-video, 85 from eleven collections, 1 nidhinjs/prompt-master)
  skills plus 17 first-party, per `.claude/skills/VENDORED.md`; the command above is
  the derivation, and this said 26 = 14 + 12 before that date). Nothing needs
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
| Context7 | Registers `scripts/install-context7.mjs` — pinned `@upstash/context7-mcp@4.1.1`, user scope, keyless. **Two channels, not one (measured 2026-09-20, DR-053 re-scan):** the Mac reaches it through this installer; the cloud sessions reach it through a hosted claude.ai connector (`mcp__Context7__resolve-library-id`, `mcp__Context7__query-docs`) that the installer neither creates nor sees. Reference only, never on the decision path: keyless, the same query returned a 98 B quota error and then 1,556 B of docs on consecutive runs (shared-egress rate limit), and it cannot answer offline — its output is never cited in a gate, a proof, a fixture or a doc figure. | none (keyless); a per-machine `CONTEXT7_API_KEY` is the owner's decision, outside the tree (DR-029) |
| Neural Memory | Runs `scripts/install-neural-memory.mjs` when `uv` + `claude` are present; skips cleanly otherwise (DR-026) | `NEURALMEMORY_DIR` (a path, not a secret; defaults to `~/.neuralmemory`, must be outside the repo) |
| Firecrawl | Runs `scripts/install-firecrawl.mjs` when `FIRECRAWL_API_KEY` is set; skips cleanly otherwise (DR-022) | `FIRECRAWL_API_KEY` (secret) |
| GitHub | **Documented, not auto-registered** — the correct command depends on the transport (hosted HTTP vs a local server image), and guessing wrong is worse than documenting | `GITHUB_PERSONAL_ACCESS_TOKEN` (secret) |
| Playwright | **Documented, not auto-registered** — keyless; evaluated by use 2026-09-18 (`docs/agent/mcp-roster.json`: 26 tools, no env, no writes, boots offline). Register the pinned client by hand at user scope once a Chromium is present: `claude mcp add playwright --scope user -- npx -y @playwright/mcp@0.0.81 --headless --browser chromium` (the cloud lane adds `--executable-path /opt/pw-browsers/chromium`; a Mac runs `npx playwright install chromium` first). Local pages only, never a tenant's console. | none (keyless) |
| Wazuh | **Documented, not auto-registered** — `gbrigandi/mcp-server-wazuh` at the pinned commit in the roster; all 14 tools are reads, credentials env-only. Build it under `~/.cache/signalgrid/` (never in the tree) and register by hand at user scope with the eight `WAZUH_*` variables passed as `--env`. For the Mac lane's live-edr rehearsal only. | `WAZUH_API_HOST/PORT`, `WAZUH_INDEXER_HOST/PORT`, `WAZUH_API_USERNAME/PASSWORD`, `WAZUH_INDEXER_USERNAME/PASSWORD` (secrets) |

The setup script prints this same per-lane env map on every run, so a lane always
knows what it must supply. A missing CLI (`claude`, `uv`) or a missing key is a
clean **skip with a warning, never a failure** — the same behaviour `mac-kickoff.sh`
step 4 uses for the `signalgrid-mcp` registration. An installer whose preconditions
were met but which then errors *does* fail the run: not-installed is never reported
as success.

## The honest boundary

Every third-party server this repository names was **evaluated by use** before it
was named: cloned at a pinned sha, read for what it reads, writes, sends and
hooks, built, and probed over stdio with every socket denied, twice. The
measurements, tool counts and dispositions live in `docs/agent/mcp-roster.json`;
the ones not adopted (Keycloak admin: 31 of 56 tools mutate the realm; the
hardened Postgres server: refuses to serve without a live database, re-measure
there) are recorded with the reason, so the next person does not re-run the trial.

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

## Who may call what

`docs/agent/mcp-roster.json`'s `grants.lanes` and `grants.skills` name which lane
and which first-party skill may call which server, and for what; its `ungranted`
block reports what a session sees beyond that set, counted, not named. Its
`servers[]`/`external[]` entries carry the dispositions above — `keycloak-admin`
and `postgres-hardened` may never be granted.

`scripts/check-mcp-roster.mjs` (in `scripts/preflight.mjs` and CI) checks the
DOCUMENT, not a call: every granted server id must exist, every `grants.skills`
key must be a real first-party skill, and a first-party skill doc that names an
`mcp__<server>__` tool must hold a matching grant. It cannot see, and does not
intercept, what a session actually calls.

## The one command per lane

```bash
pnpm run mcp:setup      # sets up the per-machine dev MCP servers on this lane
```

On the Mac, `./mac-kickoff.sh` runs this early (skippable with `--skip-mcp-lane`)
and then proceeds to the evidence lane. The intake context is in
`docs/agent/RESOURCE_INTAKE.md` (Firecrawl DR-022, Neural Memory DR-026), and the
leaderboard disposition that named this parity work is
`docs/research/MCP_MARKET_LEADERBOARDS.md`.
