#!/usr/bin/env node
// setup-mcp-lane.mjs — reach dev-MCP parity between the cloud and Mac lanes in one command.
//
//   pnpm run mcp:setup
//
// WHY THIS EXISTS. The skills and agents are shared through git — `.claude/skills`
// and `.claude/agents` are tracked, so both lanes get every one on pull, and
// `signalgrid-mcp` is registered from the tracked `.mcp.json`. The DEV MCP servers
// the cloud lane leans on (Context7, Firecrawl, Neural Memory, GitHub, Playwright)
// are NOT in the repo: they install per machine. Until now the Mac lane had no
// single command to set them up, so "the cloud lane has these tools" and "this
// machine has these tools" were different sentences. This is that command, and it
// is safe to run on cloud AND Mac. The full parity map is
// `docs/MCP_AND_SKILLS_LANE_PARITY.md`.
//
// THE RULES IT OBEYS, all inherited from the DR-026 installer pattern:
//   · Never writes a secret to a tracked file. It only READS env vars and shells
//     out to `claude mcp add`; no key is printed, committed, or stored here.
//   · USER scope for every registration — never the repo's committed .mcp.json.
//   · PINNED clients where a version exists (Context7 4.0.4, Firecrawl 3.24.0,
//     Neural Memory at its pinned commit).
//   · SKIPS CLEANLY — a missing `claude`/`uv` CLI or a missing API key is a
//     WARNING and a skip, never a hard failure, exactly like mac-kickoff.sh step 4.
//     Not-installed is never reported as success, but an absent optional key is not
//     an error either.
//   · DOCUMENTS what it cannot install correctly rather than guessing a command.
//
// EXIT CODE: 0 when everything either registered or was cleanly skipped; 1 only
// when an installer whose preconditions were MET actually failed.
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const has = (bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
const hasEnv = (k) => typeof process.env[k] === "string" && process.env[k].trim() !== "";
const runInstaller = (rel, env = {}) =>
  spawnSync("node", [join(repo, rel)], { stdio: "inherit", env: { ...process.env, ...env } }).status === 0;

const c = { reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m" };
const head = (s) => console.log(`\n${c.bold}== ${s}${c.reset}`);
const ok = (s) => console.log(`   ${c.green}ok${c.reset}   ${s}`);
const warn = (s) => console.log(`   ${c.yellow}skip${c.reset} ${s}`);
const bad = (s) => console.log(`   ${c.red}FAIL${c.reset} ${s}`);

const claude = has("claude");
const uv = has("uv");

const results = { registered: [], skipped: [], failed: [], documented: [] };

head("dev-MCP lane setup — user scope, keys from env only, nothing written to the tree");
if (!claude) {
  warn("the `claude` CLI is not on PATH — no MCP server can be registered from this shell.");
  warn("This is the expected state in a sandbox that already has its servers wired another way.");
  warn("On a machine with Claude Code installed, re-run `pnpm run mcp:setup`.");
} else {
  ok("`claude` CLI present — registrations will target user scope");
}

// ── Context7 — keyless, always safe when `claude` is present ──────────────────
head("Context7 (live library/API docs) — keyless");
if (!claude) {
  warn("no `claude` CLI; not registered.");
  results.skipped.push("context7 (no claude CLI)");
} else if (runInstaller("scripts/install-context7.mjs")) {
  ok("Context7 registered (pinned @upstash/context7-mcp@4.0.4).");
  results.registered.push("context7");
} else {
  bad("Context7 registration failed — see the output above.");
  results.failed.push("context7");
}

// ── Neural Memory — needs `uv` and `claude` (DR-026 memory substrate) ─────────
head("Neural Memory (operating-memory substrate, DR-026) — needs `uv` + `claude`");
if (!claude || !uv) {
  warn(`not registered — missing ${!claude ? "`claude`" : ""}${!claude && !uv ? " and " : ""}${!uv ? "`uv`" : ""}.`);
  warn("Install uv (https://docs.astral.sh/uv/) and Claude Code, then re-run. Store lives OUTSIDE the repo (NEURALMEMORY_DIR).");
  results.skipped.push("neural-memory (needs uv + claude)");
} else if (runInstaller("scripts/install-neural-memory.mjs")) {
  ok("Neural Memory registered (pinned, MCP server only, hooks OFF).");
  results.registered.push("neural-memory");
} else {
  bad("Neural Memory install failed — see the output above.");
  results.failed.push("neural-memory");
}

// ── Firecrawl — needs FIRECRAWL_API_KEY (a secret, env only) + `claude` ───────
head("Firecrawl (web research / source verification, DR-022) — needs FIRECRAWL_API_KEY");
if (!claude) {
  warn("no `claude` CLI; not registered.");
  results.skipped.push("firecrawl (no claude CLI)");
} else if (!hasEnv("FIRECRAWL_API_KEY")) {
  warn("FIRECRAWL_API_KEY is not set — skipping (the key is a secret, supplied via env, never committed).");
  warn("To enable on this machine: FIRECRAWL_API_KEY=fc-... pnpm run mcp:setup");
  results.skipped.push("firecrawl (FIRECRAWL_API_KEY unset)");
} else if (runInstaller("scripts/install-firecrawl.mjs")) {
  ok("Firecrawl registered (pinned MIT client, key from env).");
  results.registered.push("firecrawl");
} else {
  bad("Firecrawl install failed — see the output above.");
  results.failed.push("firecrawl");
}

// ── DOCUMENTED, NOT AUTO-REGISTERED ──────────────────────────────────────────
// These two are used in the cloud lane, but this script does not register them,
// for reasons stated per the "do not install a server whose command you cannot
// state correctly" rule.
head("Documented (not auto-registered) — set these up per machine when needed");
console.log(
  "   · GitHub — needs a Personal Access Token (env: GITHUB_PERSONAL_ACCESS_TOKEN).\n" +
    "       Not auto-registered: the correct command depends on the transport you use\n" +
    "       (the hosted HTTP endpoint vs. a local server image), and guessing it wrong\n" +
    "       is worse than documenting it. Register the variant your lane uses with the\n" +
    "       token from the environment; never place the token in a tracked file.\n" +
    "   · Playwright — keyless, but registering it cleanly needs BOTH a pinned client\n" +
    "       and a browser install (`npx playwright install chromium`), which is more\n" +
    "       than one registration. The cloud lane already carries Chromium; on a Mac,\n" +
    "       install the browsers first, then register `npx @playwright/mcp` at a pinned\n" +
    "       version. Documented rather than half-installed.",
);
results.documented.push("github", "playwright");

// ── env-key map, so each lane knows what it supplies ──────────────────────────
head("Per-lane env keys (each lane supplies its own; nothing here is committed)");
console.log("   · Context7          — none (keyless)");
console.log("   · Neural Memory     — NEURALMEMORY_DIR (a path, not a secret; defaults to ~/.neuralmemory)");
console.log("   · Firecrawl         — FIRECRAWL_API_KEY (secret)");
console.log("   · GitHub            — GITHUB_PERSONAL_ACCESS_TOKEN (secret)");
console.log("   · signalgrid-mcp    — shared via the tracked .mcp.json; both lanes get it on pull");

// ── summary ──────────────────────────────────────────────────────────────────
head("summary");
console.log(`   registered:  ${results.registered.join(", ") || "none"}`);
console.log(`   skipped:     ${results.skipped.join(", ") || "none"}`);
console.log(`   documented:  ${results.documented.join(", ")}`);
if (results.failed.length > 0) {
  console.log(`   ${c.red}failed:${c.reset}      ${results.failed.join(", ")}`);
  console.error("\nmcp:setup: at least one installer whose preconditions were met failed. Fix the cause above.");
  process.exit(1);
}
console.log(
  "\nmcp:setup done. Skips above are clean (a missing CLI or key is expected on some machines),\n" +
    "not failures. Skills and agents are already shared through git; this only sets up the\n" +
    "per-machine dev MCP servers. See docs/MCP_AND_SKILLS_LANE_PARITY.md.",
);
