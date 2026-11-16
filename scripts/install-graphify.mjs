#!/usr/bin/env node
// Graphify — a deterministic (tree-sitter) knowledge graph of a codebase with query/path/explain
// tools, absorbed by owner direction 2026-09-12 (RESOURCE_INTAKE row, DR-038). Pinned to the
// PyPI release that was measured on this tree; user scope; the skill goes to ~/.claude/skills,
// NEVER into this repository's .claude/ (that is a gated surface) — so `graphify install
// --project` is deliberately not run here. Its build output, graphify-out/, is gitignored:
// untracked output would flip provenance.workingTreeClean on every sim result.
// graphify: shell-out sequence, not a library; ceiling = uv's and graphify's own errors.
import { spawnSync } from "node:child_process";
const VERSION = "0.9.58";
const sh = (...a) => spawnSync(a[0], a.slice(1), { stdio: "inherit" }).status === 0 || process.exit(1);
sh("uv", "tool", "install", "--force", `graphifyy==${VERSION}`);
sh("graphify", "install", "--platform", "claude");
console.log(`graphify ${VERSION} installed (uv tool, user scope; skill at ~/.claude/skills/graphify) — build with /graphify . from the repo root; output stays in the gitignored graphify-out/.`);
