---
name: cli-anything
description: The CLI-Anything method (HKUDS/CLI-Anything, vendored at a pin under third_party/cli-anything/) applied to SignalGrid's own control plane — how to give a piece of software an agent-native command line with stateful sessions, dual human/--json output, backend discovery and a generated SKILL.md, and where that work lands here. Use when building or reviewing the signalgrid CLI over /v1 and the MCP server, or when the owner asks to make any tool agent-native.
---

# SignalGrid — CLI-Anything

CLI-Anything's thesis is the owner's: software should be reachable by an agent as a
first-class citizen. Its seven-phase harness SOP is vendored here unmodified at
`810c18b0d1ab9b234bc996c9fd999318523a3ef0` (Apache-2.0), and this skill is the
first-party adapter that says how the method applies to THIS repository (DR-040).
Read the vendored text; do not paraphrase it back into the tree.

## What is vendored, and what is deliberately not

Taken, byte-identical, under `third_party/cli-anything/` (`VENDORED.md` there holds
the pin, the licence and the diff record):

- `third_party/cli-anything/HARNESS.md` — the 747-line SOP: discover the software's
  real operations, design a stateful session model, build a CLI with dual
  human/`--json` output, test it, generate its SKILL.md, validate, publish.
- `third_party/cli-anything/commands/cli-anything.md` and its four siblings
  (`refine`, `test`, `validate`, `list`) — the procedures the upstream plugin runs
  as slash commands. They are NOT registered as slash commands here: this repository
  packages its own plane as the `signalgrid` plugin (DR-030) and loads no third-party
  plugin. Follow them by reading.
- `third_party/cli-anything/guides/` — eight design notes. The ones that matter here:
  `third_party/cli-anything/guides/session-locking.md` (exclusive session files),
  `third_party/cli-anything/guides/auto-save-dry-run.md` (mutations preview before
  they apply), `third_party/cli-anything/guides/mcp-backend.md` (a CLI whose backend
  is an MCP server — this repository has one), and
  `third_party/cli-anything/guides/skill-generation.md`.
- Three stdlib-only Python modules (`skill_generator.py`, `preview_bundle.py`,
  `repl_skin.py`), a SKILL.md template and their tests. Nothing here executes them:
  no gate, no hook, no script. They are reference code.

Not taken, and why (measured 2026-09-12, `docs/agent/RESOURCE_INTAKE.md`):

- **`cli-hub`, the package manager.** It fetches an unversioned registry from a live
  URL and runs each entry's install string; two entries carry shell metacharacters
  and run under `shell=True`, one of them a pipe from `curl` into `bash`. Telemetry
  is on by default and posts the running agent's fingerprint and the user's free-text
  query to PostHog. Never `pip install cli-anything-hub` on either lane.
- **The 79 harnesses and 71 skills.** They wrap Blender, GIMP, QGIS and the like;
  none of them is software this repository runs.

## How the method applies here

The upstream SOP assumes a Python/Click harness wrapping a GUI application. Here the
software is SignalGrid's own control plane, and the phases transfer while the
template does not:

| HARNESS.md phase | Here |
| --- | --- |
| 1. Discover the operations | The `/v1` routes in `artifacts/api-server`, the tools the MCP server exposes in `artifacts/mcp-server` (`evaluate_decision`, `explain_decision`, `scan_signals`, `query_audit`, `list_connectors`, …) and the Bruno collection that already pins the wire contract. Read them; do not invent an operation the server does not have. |
| 2. Design the session | A `signalgrid` CLI with a session file OUTSIDE the tree (base URL, tenant, token read from the environment — never written), exclusive-locked as `session-locking.md` describes. Read-only against the fabric by default; a mutating command exists only where a task says so and previews first (`auto-save-dry-run.md`). |
| 3. Build | TypeScript under `artifacts/`, on the repository's toolchain — not Python. Dual output: a human table and `--json`, the same fields. Unknown or unreachable upstream answers print as unknown; the CLI never softens a verdict. |
| 4. Test | Fixture-backed, against the api-server's own test harness (`pnpm --filter @workspace/api-server run test:api` stays green, every assertion). No live tenant. |
| 5. Generate the SKILL.md | Draft with the vendored generator's idea, hand-finish. The result must pass `scripts/check-skill-plane-conformance.mjs` and `scripts/check-skill-instruction-conflicts.mjs` — a skill that tells the agent to run a denied command is refused. |
| 6. Validate | Every figure the CLI prints comes from a proof or a live answer, never a constant. |
| 7. Publish | Nothing is published outside the tree; the launch profile and the publication boundary govern what may be said to ship. |

This is a build item, recorded in `docs/BUILD_BACKLOG.md`, not a claim: nothing about
it changes how green is certified, so no decision record beyond DR-040 is needed.

## Rules that override the upstream text

- Session files, caches and generated bundles live outside the repository or under a
  tracked ignore rule; an untracked file flips `provenance.workingTreeClean`.
- No registry, no hub, no telemetry, no install script that fetches code at run time.
- A harness never writes to a live connector. The decision core stays deterministic
  and offline (golden rule 2); the CLI is a client of it, not a shortcut around it.
