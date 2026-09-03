#!/usr/bin/env node
// Context7 adoption — the disciplined, opt-in installer for the highest-value
// keyless dev MCP server the cloud lane uses (live library/API documentation).
//
//   pnpm run context7:install          # or via: pnpm run mcp:setup
//
// WHY THIS EXISTS. Context7 is already connected in the cloud sessions but had no
// installer, so the Mac lane could not reach it in one command. It fetches
// up-to-date library docs and code examples for an LLM straight from source, which
// is a research/reference aid — it never enters a decision path, a proof fixture,
// the deterministic core, or the product build.
//
// FOLLOWS THE DR-026 INSTALLER PATTERN, like install-firecrawl.mjs:
//   · PINNED to an exact version, not @latest (RESOURCE_INTAKE rule 3).
//   · USER scope — never the repo's committed .mcp.json, so a keyless session
//     cannot try to spawn it and break.
//   · KEYLESS — Context7 works with no API key; this installer registers no key
//     and reads no secret. (Context7 offers an optional key for higher rate
//     limits; supplying one is a per-machine choice made outside this repo.)
//   · FAIL-CLEAN — if the `claude` CLI is absent, nothing is registered and that
//     is reported plainly. not-installed is never reported as success.
import { spawnSync } from "node:child_process";

const PINNED = "@upstash/context7-mcp@4.0.4"; // MIT, keyless, pinned (not @latest)

// The Claude Code CLI is how an MCP server is registered without hand-editing config.
const hasClaude = spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasClaude) {
  console.error("context7:install: the `claude` CLI is not on PATH here, so nothing was");
  console.error("registered (not-installed is never reported as success). On the machine that");
  console.error("has Claude Code, run this same command, or register the pinned client manually:");
  console.error("");
  console.error(`  claude mcp add context7 --scope user -- npx -y ${PINNED}`);
  process.exit(1);
}

// Replace only OUR registration: a same-named server that points elsewhere is
// somebody else's and is never silently removed.
const existing = spawnSync("claude", ["mcp", "get", "context7"], { encoding: "utf8" });
if (existing.status === 0 && !existing.stdout.includes("context7-mcp")) {
  console.error("context7:install refused — an MCP server named context7 is already registered");
  console.error("and does not point at context7-mcp; remove or rename it yourself. Nothing was changed.");
  process.exit(1);
}
if (existing.status === 0) {
  spawnSync("claude", ["mcp", "remove", "context7", "--scope", "user"], { stdio: "ignore" });
}

const res = spawnSync(
  "claude",
  ["mcp", "add", "context7", "--scope", "user", "--", "npx", "-y", PINNED],
  { stdio: "inherit" },
);
if (res.status !== 0) {
  console.error(`context7:install: registration failed (exit ${res.status}).`);
  process.exit(res.status || 1);
}
console.log(`context7:install: registered ${PINNED} as a user-scoped, keyless MCP server (repo untouched).`);
