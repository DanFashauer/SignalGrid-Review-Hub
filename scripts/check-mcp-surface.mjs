// MCP surface drift gate — the chat connection must not drift from the fabric.
//
// WHY THIS EXISTS. The owner drives SignalGrid from Claude Desktop over MCP,
// and the tool surface has THREE descriptions that historically moved
// independently: the tools the server actually registers (source of truth),
// the tool list docs/RUN_ON_MAC.md teaches, and the server's own stderr ready
// message. shift-context and the Facility Trust Graph both shipped with NO
// chat exposure until someone noticed — "someone noticed" is not a control.
// This gate makes tool-surface drift fail the build instead.
//
// DERIVED, NEVER HAND-MAINTAINED. The canonical list is parsed from the
// registerTool calls in the server source; everything else must agree with it:
//   1. docs/RUN_ON_MAC.md must name every tool (and name no tool that no
//      longer exists);
//   2. the server's ready message must list exactly the registered tools;
//   3. the live-sync manifest's mcpTools count must equal the registered count
//      (the manifest generator counts independently — a disagreement means one
//      of the two parsers broke, which is itself worth failing on).

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

const serverSrc = readFileSync(join(repo, "artifacts/mcp-server/src/index.ts"), "utf8");
const registered = [...serverSrc.matchAll(/registerTool\(\s*\n?\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);

if (registered.length === 0) {
  bad("could not parse any registerTool calls from the server source — the gate's own parser broke");
} else {
  ok(`server registers ${registered.length} tools: ${registered.join(", ")}`);
}

// 1. The doc teaches every tool.
const doc = readFileSync(join(repo, "docs/RUN_ON_MAC.md"), "utf8");
for (const t of registered) {
  if (doc.includes(`\`${t}\``)) ok(`docs/RUN_ON_MAC.md names \`${t}\``);
  else bad(`docs/RUN_ON_MAC.md does not name \`${t}\` — the chat's manual drifted behind the server`);
}
// ...and names no ghost. Backticked snake_case identifiers near the MCP section
// that look like tool names but are not registered are fossils.
const docTools = [...doc.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)].map((m) => m[1]);
const NOT_TOOLS = new Set(["claude_desktop_config", "signal_catalog_call"]);
for (const t of new Set(docTools)) {
  if (NOT_TOOLS.has(t)) continue;
  // Only flag identifiers that LOOK like this server's tools (verb_noun snake
  // case already listed once as a tool elsewhere in history): compare against
  // the registered list only — a doc identifier that is not a registered tool
  // fails only if the doc presents it in the tools sentence.
  const toolsSentence = doc.slice(doc.indexOf("Claude now has the fabric's tools"), doc.indexOf("decision core.") + 14);
  if (toolsSentence.includes(`\`${t}\``) && !registered.includes(t)) {
    bad(`docs/RUN_ON_MAC.md lists \`${t}\` as a tool but the server does not register it — a fossil`);
  }
}

// 2. The ready message lists exactly the registered tools.
const readyMatch = serverSrc.match(/ready \(stdio\)\. Tools: ([^"]+)\."/);
if (!readyMatch) {
  bad("could not find the server's ready message");
} else {
  const announced = readyMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  const missing = registered.filter((t) => !announced.includes(t));
  const ghost = announced.filter((t) => !registered.includes(t));
  if (missing.length === 0 && ghost.length === 0) ok("ready message lists exactly the registered tools");
  if (missing.length > 0) bad(`ready message omits: ${missing.join(", ")}`);
  if (ghost.length > 0) bad(`ready message announces unregistered tools: ${ghost.join(", ")}`);
}

// 3. The live-sync manifest count agrees (independent parser cross-check).
const manifest = JSON.parse(readFileSync(join(repo, "artifacts/sync/live-sync-manifest.json"), "utf8"));
const manifestTools = manifest?.body?.mcpTools;
if (Array.isArray(manifestTools)) {
  const names = manifestTools.map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean);
  const missing = registered.filter((t) => !names.includes(t));
  const ghost = names.filter((t) => !registered.includes(t));
  if (missing.length === 0 && ghost.length === 0) ok(`live-sync manifest agrees: ${names.length} tools`);
  if (missing.length > 0) bad(`live-sync manifest omits: ${missing.join(", ")} — run: node scripts/generate-sync-manifest.mjs`);
  if (ghost.length > 0) bad(`live-sync manifest lists unregistered tools: ${ghost.join(", ")} — run: node scripts/generate-sync-manifest.mjs`);
} else {
  bad("live-sync manifest carries no body.mcpTools list — the manifest generator moved; update this gate's path");
}

if (failures.length > 0) {
  console.error(`\nMCP surface gate FAILED: ${failures.length} drift(s). The chat connection must match the fabric.`);
  process.exit(1);
}
console.log("\nMCP surface gate passed — server, docs, ready message, and manifest agree.");
