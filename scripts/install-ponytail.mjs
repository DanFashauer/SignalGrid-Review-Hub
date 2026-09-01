#!/usr/bin/env node
// Ponytail — top layer of the review stack (DR-024). Pinned (commit 2ed6c52 = v4.9.0, MIT,
// vetted 2026-09-01), user scope, non-interactive, default mode ultra. The pin is the one
// thing `/plugin marketplace add DietrichGebert/ponytail` cannot give you: that tracks HEAD.
// ponytail: shell-out sequence, not a library; ceiling = the claude CLI's own errors, upgrade = none needed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const PIN = "2ed6c52", DIR = process.env.PONYTAIL_DIR ?? `${process.env.HOME}/dietrichgebert/ponytail`;
const sh = (...a) => spawnSync(a[0], a.slice(1), { stdio: "inherit" }).status === 0 || process.exit(1);
if (!existsSync(`${DIR}/.git`)) sh("git", "clone", "--depth", "1", "https://github.com/DietrichGebert/ponytail", DIR);
sh("git", "-C", DIR, "fetch", "--depth=1", "origin", PIN);
sh("git", "-C", DIR, "checkout", "--quiet", PIN);
sh("claude", "plugin", "validate", DIR);
spawnSync("claude", ["plugin", "marketplace", "add", DIR], { stdio: "inherit" }); // idempotent
sh("claude", "plugin", "install", "ponytail@ponytail", "--scope", "user", "-y");
sh(process.execPath, "-e", `require(${JSON.stringify(`${DIR}/hooks/ponytail-config.js`)}).writeDefaultMode("ultra")||process.exit(1)`);
console.log(`ponytail 4.9.0 installed (user scope, pinned ${PIN}, mode ultra) — active from the next session start.`);
