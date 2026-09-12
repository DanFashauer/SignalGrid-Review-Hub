# Vendored: HKUDS/CLI-Anything (the plugin directory only)

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/HKUDS/CLI-Anything |
| Author | HKU Data Intelligence Lab (HKUDS) and contributors |
| Licence | Apache-2.0 (`LICENSE` in this directory, byte-identical to the upstream root `LICENSE`; upstream ships no `NOTICE` file) |
| Commit | `810c18b0d1ab9b234bc996c9fd999318523a3ef0` (`main`) |
| Committed upstream | 2026-08-21T15:26:58+08:00 |
| Vendored | 2026-09-12 |
| Contents | 26 files — the upstream `cli-anything-plugin/` directory: `HARNESS.md`, 5 commands, 8 guides, 3 Python modules, 1 template, 1 test file, 2 shell scripts, `README.md`, `QUICKSTART.md`, `PUBLISHING.md`, the plugin manifest and `LICENSE`. **Nothing here is executed by any gate, hook or script.** |
| Byte-identity | `diff -r <upstream>/cli-anything-plugin third_party/cli-anything -x __pycache__` empty on 2026-09-12 (this file is the one addition) |
| Basis | DR-038 (owner-directed 2026-09-12); intake row in `docs/agent/RESOURCE_INTAKE.md` |
| Activated through | `.claude/skills/cli-anything/SKILL.md` — a first-party adapter that says how the method applies to this repository. Nothing in this directory is loaded by the harness directly. |

## What was taken

The methodology: `HARNESS.md` (747 lines, seven phases), the five command procedures
under `commands/`, the eight design notes under `guides/`, the SKILL.md template, and
the three stdlib-only Python modules the plugin uses to draft a SKILL.md from a
finished harness (`skill_generator.py`), bundle previews (`preview_bundle.py`) and
draw terminal chrome (`repl_skin.py`), with their tests. Read at the pin in full on
2026-09-12: the plugin registers **no hooks** (grep for `hooks`, `PreToolUse`,
`SessionStart` across it returns nothing), ships **no MCP server**, and makes **no
network call** — the modules import `ast, re, pathlib, typing, dataclasses, hashlib,
json, mimetypes, os, datetime, sys` and nothing else.

## What was deliberately NOT taken, and why

- **`cli-hub/` — the pip package `cli-anything-hub` (0.4.1).** Measured in a sandbox
  at the pin, `HOME` redirected, a local sink standing in for its telemetry host:
  `cli-hub --version` alone posted two PostHog events fingerprinting the running
  agent (it reads `/proc/<pid>/status` four parents deep and matched
  `claude-code-env-alt`); `cli-hub can <query>` posted the query string verbatim.
  Its registry is fetched unversioned from a live GitHub Pages URL and each entry's
  `install_cmd` is executed — 77 of 78 `pip install git+…` entries resolve to `main`
  at that moment, two carry shell metacharacters and run under `shell=True`, one of
  them a pipe from `curl` into `bash`. Every one of those is a line this repository
  does not cross (CLAUDE.md, DR-026, DR-030).
- **The 79 harness directories and 71 `skills/` entries.** Hand-written wrappers for
  Blender, GIMP, QGIS, Kdenlive, Zotero and the like. None wraps software this
  repository runs; four call model providers under their own keys.
- **The marketplace manifests** (`.claude-plugin/marketplace.json`, the Cursor and Pi
  variants). This repository loads no third-party plugin (DR-030); the method is
  followed by reading, not by installing.

## What the upstream README claims, and what held

The README's aggregate test figure does not reconcile (2,461 claimed; its own
breakdown sums to 2,330; its per-harness table to 3,424), and 2 of 5 sampled
`pip install cli-anything-<name>` lines name packages PyPI returns 404 for. The
plugin's own tests pass (`41 passed in 0.15s`); the generator drafted a SKILL.md for
the sample mermaid harness in 0.048 s and rejected a SignalGrid script
(`ValueError: cli_anything directory not found`) — it reads Python/Click packages
only, which is why the method and not the tool is what this repository uses.

## Why this directory is `third_party/`

Same reason as its neighbour: `scripts/publication-boundary.mjs` classifies it
`third_party_intake` with the licence basis above. Apache-2.0 asks that the licence
travel with the copy and that modifications be marked; the licence is here and there
are no modifications. A re-vendor is a diff against the pin, recorded here.
