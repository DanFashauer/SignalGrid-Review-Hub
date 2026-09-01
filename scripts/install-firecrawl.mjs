#!/usr/bin/env node
// Firecrawl adoption — the disciplined, opt-in installer (owner-directed 2026-09-01,
// DR-022; adopted "on top of ECC" as a web-research / source-verification lane).
//
//   FIRECRAWL_API_KEY=fc-... pnpm run firecrawl:install
//
// WHY THIS IS NOT THE VENDOR'S ONE-LINER. The Firecrawl marketing email advertises
//   npx -y firecrawl-cli@latest init --all --browser
// and "handles auth automatically". Every one of those defaults is something this
// repo forbids:
//   · @latest        → this repo PINS third-party tools to an exact version
//                      (RESOURCE_INTAKE rule 3; the ECC precedent pins 2.2.0).
//   · --all          → installs the skill into EVERY detected agent. We scope to
//                      one client on purpose.
//   · -y             → auto-confirms. We fail CLOSED instead: no key, no install.
//   · auto-auth      → the API key is a SECRET. It comes from the environment and
//                      NEVER enters the repo tree, a commit, or this file.
//
// LICENCE NOTE. The self-hostable `firecrawl/firecrawl` SERVER is AGPL-3.0 (the
// reason INTAKE_LEDGER row 97 first said "not needed"). This installer uses the
// hosted API through the MIT-licensed `firecrawl-mcp` client only; it does not
// vendor or self-host the AGPL server, so no copyleft surface is added.
//
// SCOPE. Research / source-verification infrastructure, report-only. Firecrawl
// output is external web content: it never enters a decision path, a proof
// fixture, the deterministic core, or the public product build. It is a way to
// FETCH what a human would read, nothing the product ships.
import { spawnSync } from "node:child_process";

const PINNED = "firecrawl-mcp@3.24.0"; // MIT hosted-API client, pinned (not @latest)
const KEY = process.env.FIRECRAWL_API_KEY;

// Fail CLOSED: an unset key is a refusal, not a silent no-op. Never print the key.
if (!KEY || !KEY.trim()) {
  console.error("firecrawl:install refused — FIRECRAWL_API_KEY is not set.");
  console.error("");
  console.error("This is deliberate: the key is a secret, so it is supplied through the");
  console.error("environment and never committed. Run once, on the machine that will use it:");
  console.error("");
  console.error("  FIRECRAWL_API_KEY=fc-your-key pnpm run firecrawl:install");
  console.error("");
  console.error("Get a key at firecrawl.dev. It registers the pinned MIT client");
  console.error(`(${PINNED}) as a user-scoped MCP server for Claude Code; the repo tree is untouched.`);
  process.exit(1);
}

// The Claude Code CLI is how an MCP server is registered without hand-editing config.
const hasClaude = spawnSync("claude", ["--version"], { stdio: "ignore" }).status === 0;
if (!hasClaude) {
  console.error("firecrawl:install: the `claude` CLI is not on PATH here, so nothing was");
  console.error("registered (not-installed is never reported as success). On the machine that");
  console.error("has Claude Code, run this same command, or register the pinned client manually:");
  console.error("");
  console.error(`  claude mcp add firecrawl --scope user --env FIRECRAWL_API_KEY=<key> -- npx -y ${PINNED}`);
  process.exit(1);
}

// User scope (not the repo's committed .mcp.json — a keyless session must not try to
// spawn this and break). The key is passed from the environment we already validated.
const res = spawnSync(
  "claude",
  ["mcp", "add", "firecrawl", "--scope", "user", "--env", `FIRECRAWL_API_KEY=${KEY}`, "--", "npx", "-y", PINNED],
  { stdio: "inherit" },
);
if (res.status !== 0) {
  console.error(`firecrawl:install: registration failed (exit ${res.status}).`);
  process.exit(res.status || 1);
}
console.log(`firecrawl:install: registered ${PINNED} as a user-scoped MCP server (key from env, repo untouched).`);
