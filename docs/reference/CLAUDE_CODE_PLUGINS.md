# Claude Code plugins — reference and provenance

Source, read 2026-09-07 (owner-shared):

- Documentation index: `https://code.claude.com/docs/llms.txt` — the canonical
  discovery file for every Claude Code docs page. Fetch it first when a plugin
  question is not answered here.
- Plugins reference: `https://code.claude.com/docs/en/plugins-reference`

This file is a pointer, not a frozen copy. The live docs are canonical and change;
what is recorded here is the small set of facts this repository actually built to,
so a future reader does not have to re-derive them. What we did with the reference is
[DR-030](../DECISION_RECORDS.md); the plugin itself is `.claude-plugin/plugin.json`
and its gate is [`scripts/check-plugin-manifest.mjs`](../../scripts/check-plugin-manifest.mjs).

## What a plugin is

A plugin is a self-contained directory of components that extends Claude Code:
skills, agents, hooks, MCP servers, LSP servers, monitors, themes, workflows,
output-styles. The manifest is `.claude-plugin/plugin.json`; every other component
directory lives at the plugin root, never inside `.claude-plugin/`.

## The facts this repo relied on

- **`name` is the only required manifest field.** It is kebab-case and namespaces every
  component (`signalgrid:code-reviewer`).
- **`skills` and `commands` accept a directory path; `agents` does not.** The loader
  rejects a directory for `agents` ("agents: Invalid input") — it must be a list of file
  paths. This is why the manifest carries a hand-list of agent files and why that list is
  gated against `.claude/agents/` (the drift hazard the gate exists for).
- **Component paths are relative, start with `./`, and may not escape the plugin root.**
  A path resolving outside the plugin root is rejected (`path escapes plugin directory`).
  This is why the plugin root is the repository root: a subdirectory plugin could not
  reference the `.claude/` plane above it, so a root manifest is the only single-source
  design.
- **`skills` adds to the default `skills/` scan; `commands`, `agents`, `workflows`,
  `output-styles` REPLACE their defaults.**
- **A bare manifest does not auto-activate.** Plugins load via a marketplace install,
  `--plugin-dir`/`--plugin-url`, an `@skills-dir` manifest under a skills directory, or
  claude.ai sync. Committing `.claude-plugin/plugin.json` at the repo root therefore does
  not change this repo's own sessions.
- **`claude plugin validate <dir>` is the ground truth**; `--strict` turns warnings into
  errors. A CLAUDE.md at a plugin root draws a benign warning (it is not loaded as plugin
  context) — expected here, since our CLAUDE.md is project context.

## What this repo deliberately did NOT package

Hooks. The three hooks (`session-start`, `block-dangerous`, `verify-done`) stay wired in
`.claude/settings.json` at project scope. Re-declaring them in the plugin would double-fire
them, and they are repo-specific rather than portable. See DR-030 for the full boundary.
