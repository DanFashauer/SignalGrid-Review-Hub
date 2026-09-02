#!/usr/bin/env node
// Neural Memory — the memory SUBSTRATE under the DR-024 stack (DR-026): it remembers, it judges
// nothing. Pinned (commit 2015cb9b = v4.62.0, MIT, vetted 2026-09-01), MCP server ONLY at user scope.
// The plugin form is refused on purpose: it pulls the PyPI-latest server and four hooks, two of
// which ingest the Claude Code transcript and one of which logs every tool call. No hook is installed.
// The store lives OUTSIDE the repo (NEURALMEMORY_DIR) and holds operating memory only — never tenant
// data, secrets, PHI, live-evidence, or an index of the tree; committed docs stay the memory of record.
// Only the top-level package is commit-pinned; its nine transitive Python dependencies resolve from
// PyPI at install time (the same registry exposure Firecrawl's pinned npm client has).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const VERSION = "4.62.0", PIN = "2015cb9b0973a6fe14a3bc547c932d64d6ced203";
const SPEC = `neural-memory @ git+https://github.com/nhadaututtheky/neural-memory@${PIN}`;
const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const DIR = resolve(process.env.NEURALMEMORY_DIR ?? `${process.env.HOME}/.neuralmemory`);
const CONFIG = `[maintenance]\nversion_check_enabled = false\n\n[mem0_sync]\nenabled = false\n\n[sync]\nenabled = false\n\n[telegram]\nenabled = false\n`;
const refuse = (why) => { console.error(`neural-memory:install refused — ${why}`); process.exit(1); };
const has = (bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0;
const sh = (...a) => spawnSync(a[0], a.slice(1), { stdio: "inherit" }).status === 0;
if (!has("uv")) refuse("`uv` is not on PATH. Nothing was done.");
if (!has("claude")) refuse("the `claude` CLI is not on PATH. Nothing was done.");
const inTree = (d) => d === ROOT || d.startsWith(ROOT + sep);
if (inTree(DIR)) refuse(`NEURALMEMORY_DIR=${DIR} is inside the repo tree (${ROOT}); the store must live outside it. Nothing was done.`);
if (!sh("uv", "tool", "install", "--python", "3.11", "--force", SPEC)) refuse(`the pinned install failed (${SPEC}); there is no PyPI fallback. Nothing was registered.`);
const BIN = `${spawnSync("uv", ["tool", "dir", "--bin"], { encoding: "utf8" }).stdout.trim()}/nmem-mcp`;
if (!existsSync(BIN)) refuse(`${BIN} is missing after install. Nothing was registered.`);
try {
  mkdirSync(DIR, { recursive: true });
  // the string check above cannot see a symlink; re-check the REAL path before anything is written
  if (inTree(realpathSync(DIR))) refuse(`NEURALMEMORY_DIR resolves (through a symlink) to ${realpathSync(DIR)}, inside the repo tree. Nothing was written.`);
  if (existsSync(`${DIR}/config.toml`)) console.log(`neural-memory:install: ${DIR}/config.toml already exists — left untouched (never overwritten).`);
  else { writeFileSync(`${DIR}/config.toml`, CONFIG); console.log(`neural-memory:install: wrote ${DIR}/config.toml (version check, mem0, sync, telegram all off).`); }
} catch (err) { refuse(`could not prepare the store at ${DIR}: ${err.message}. Nothing was registered.`); }
// Replace only OUR registration: a same-named server that points elsewhere is somebody else's and is never removed.
const existing = spawnSync("claude", ["mcp", "get", "neural-memory"], { encoding: "utf8" });
if (existing.status === 0) {
  if (!existing.stdout.includes("nmem-mcp")) refuse(`an MCP server named neural-memory is already registered and does not point at nmem-mcp; remove or rename it yourself. Nothing was changed.`);
  console.log("neural-memory:install: replacing the existing neural-memory registration (it points at nmem-mcp).");
  if (!sh("claude", "mcp", "remove", "neural-memory", "--scope", "user")) refuse("`claude mcp remove` failed.");
}
if (!sh("claude", "mcp", "add", "neural-memory", "--scope", "user", "--env", `NEURALMEMORY_DIR=${DIR}`, "--", BIN)) refuse("`claude mcp add` failed.");
console.log(`neural-memory ${VERSION} installed (MCP server only, user scope, pinned ${PIN.slice(0, 8)}, hooks OFF, store ${DIR}) — active from the next session start.`);
