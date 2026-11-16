#!/usr/bin/env node
// Ponytail — top layer of the review stack (DR-024). Pinned (commit 2ed6c52c…, MIT, vetted
// 2026-09-01), user scope, non-interactive, default mode ultra. The pin is the one thing
// `/plugin marketplace add DietrichGebert/ponytail` cannot give you: that tracks HEAD.
//
// The pin is the FULL 40-character id on purpose (2026-09-12). `git fetch origin <id>` fetches
// an object only by its full id; an abbreviated one is looked up as a REF NAME, and upstream
// has no ref called `2ed6c52`, so `pnpm run ponytail:install` died on a new machine with
// "fatal: couldn't find remote ref 2ed6c52" — the pin looked unreproducible when only its
// spelling was. Re-verified against upstream the same day: 2ed6c52c… exists, sits 3 commits
// AFTER tag v4.9.0 (0a4dd63a: tests + a Grok Build adapter; the skills tree is byte-identical
// to the tag), and its plugin manifest reads version 4.9.0 — which is what "= v4.9.0" meant.
// ponytail: shell-out sequence, not a library; ceiling = the claude CLI's own errors, upgrade = none needed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const PIN = "2ed6c52c9d7e5e56942508591085fd45dea277d3", DIR = process.env.PONYTAIL_DIR ?? `${process.env.HOME}/dietrichgebert/ponytail`;
const sh = (...a) => spawnSync(a[0], a.slice(1), { stdio: "inherit" }).status === 0 || process.exit(1);
if (!existsSync(`${DIR}/.git`)) sh("git", "clone", "--depth", "1", "https://github.com/DietrichGebert/ponytail", DIR);
sh("git", "-C", DIR, "fetch", "--depth=1", "origin", PIN);
sh("git", "-C", DIR, "checkout", "--quiet", PIN);
sh("claude", "plugin", "validate", DIR);
spawnSync("claude", ["plugin", "marketplace", "add", DIR], { stdio: "inherit" }); // idempotent
sh("claude", "plugin", "install", "ponytail@ponytail", "--scope", "user", "-y");
sh(process.execPath, "-e", `require(${JSON.stringify(`${DIR}/hooks/ponytail-config.js`)}).writeDefaultMode("ultra")||process.exit(1)`);
console.log(`ponytail 4.9.0 installed (user scope, pinned ${PIN.slice(0, 7)}, mode ultra) — active from the next session start.`);
