#!/usr/bin/env node
// Crucible (raddue/crucible) — the ADVERSARIAL half only: quality-gate, red-team, inquisitor,
// adversarial-tester, temper, audit (+ the shared/ fragments they reference) and its four agent
// definitions, absorbed by owner direction 2026-09-12 (RESOURCE_INTAKE row, DR-038). Pinned to a
// full commit id reachable from main (the Ponytail lesson: an abbreviated id is looked up as a
// ref name and "disappears"). User scope, symlinked — NEVER into this repository's .claude/.
//
// Deliberately NOT installed: its lifecycle skills (planning, test-driven-development, verify,
// debugging, worktree, finish, parallel, skill-creator, design, handoff) — they are a diverged
// copy of obra/superpowers, which this repo already vendors (VENDORED.md, DR-030), and two of
// them collide by NAME with skills the project loads (test-driven-development, handoff) — the
// exact drift scripts/check-skill-instruction-conflicts.mjs exists to catch; its five hooks
// (one is a BLOCKING PreToolUse guard) — house rule is hooks OFF; its consensus MCP server
// (ships code to third-party vendors); and build/checkpoint/compass/adr, which write untracked
// files into docs/ (those paths are gitignored here in case a lens run ever triggers them).
// crucible: shell-out sequence, not a library; ceiling = git's and ln's own errors.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
const PIN = "13d7f8c8901dc785e9db95ec8da4517bfbd32a36"; // full id on purpose: an abbreviated one is looked up as a REF NAME by git fetch (see install-ponytail.mjs); first successful install 2026-09-12
const DIR = process.env.CRUCIBLE_DIR ?? `${process.env.HOME}/raddue/crucible`;
const HOME = process.env.HOME;
const SKILLS = ["quality-gate", "red-team", "inquisitor", "adversarial-tester", "temper", "audit", "shared"];
const sh = (...a) => spawnSync(a[0], a.slice(1), { stdio: "inherit" }).status === 0 || process.exit(1);
if (!existsSync(`${DIR}/.git`)) sh("git", "clone", "https://github.com/raddue/crucible.git", DIR);
sh("git", "-C", DIR, "fetch", "--quiet", "origin", "main");
sh("git", "-C", DIR, "checkout", "--quiet", PIN);
mkdirSync(`${HOME}/.claude/skills`, { recursive: true });
mkdirSync(`${HOME}/.claude/agents`, { recursive: true });
for (const s of SKILLS) {
  if (!existsSync(`${DIR}/skills/${s}`)) { console.error(`crucible: skills/${s} missing at ${PIN} — refusing a partial install`); process.exit(1); }
  sh("ln", "-sfn", `${DIR}/skills/${s}`, `${HOME}/.claude/skills/${s}`);
}
sh("sh", "-c", `ln -sf "${DIR}"/agents/*.md "${HOME}/.claude/agents/"`);
console.log(`crucible pinned ${PIN}: ${SKILLS.length} skills + agents linked (user scope, hooks off, report-only) — active from the next session start. Run the lenses in a git worktree, never the shared checkout.`);
