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
//      of the two parsers broke, which is itself worth failing on);
//   4. the registered resources (registerResource URIs) must equal the server's
//      "Resources:" ready line — the same missing/ghost drift, for the resource
//      surface the server also announces;
//   5. every registered tool must be EXERCISED — actually CALLED — by one of the
//      MCP proofs or the server unit test, or carry a dated EXERCISE_EXEMPT
//      reason. A tool can pass 1-4 (registered, documented, announced, in the
//      manifest) while being invoked by nothing; this is the check that a new
//      tool ships wired to a test rather than untested. Run
//      `--self-test` to prove checks 4 and 5 can fail in both directions.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const failures = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.error(`  ✗ ${m}`); };

// ── Coverage: a registered tool that no proof or test CALLS is not exercised ──
//
// The original three checks are NAME-drift checks — server, docs, ready message
// and manifest must list the same tools. A tool can pass every one of them and be
// invoked by nothing: registered, documented, announced, and never actually
// called. This adds that fourth question, derived from source the same way.
//
// The three files that actually drive the server.
const EXERCISE_SOURCES = [
  "scripts/src/mcp-server-proof.ts",
  "scripts/src/mcp-answer-discipline-proof.ts",
  "artifacts/mcp-server/test/server.test.ts",
];

// Registered tools deliberately NOT invoked by any proof/test — each with a
// reason and a date. Empty is the goal; a stale entry (a tool that IS exercised,
// or one the server no longer registers) fails the gate.
const EXERCISE_EXEMPT = new Map([
  [
    "bruno_collection_run",
    "2026-09-02: BUILDS the api-server and runs the whole Bruno collection under both " +
      "profiles (~1 min) — too heavy to fire from the fast MCP proofs/tests. Exercised " +
      "directly by the `Bruno collection live run` step (scripts/run-bruno-collection.mjs) " +
      "in preflight and CI; its annotations are asserted in artifacts/mcp-server/test/server.test.ts.",
  ],
]);

/** The tool names a source file actually INVOKES, by the call forms the three
 *  exercise files use. Deliberately NOT a plain substring scan: every registered
 *  tool is NAMED in a registration-assertion array (EXPECTED_TOOLS / NEW_TOOLS /
 *  PREEXISTING_TOOLS) and in `t.name === "…"` annotation assertions, so substring
 *  would make every tool look exercised and the exemption vacuous. Membership in
 *  a *call* is the discriminator. */
function calledTools(text) {
  const names = new Set();
  const add = (re) => { for (const m of text.matchAll(re)) names.add(m[1]); };
  add(/\bcall\(\s*"([a-z0-9_]+)"/g);                 // server.test helper: call("x", …)
  add(/\banswer\(\s*"([a-z0-9_]+)"/g);               // mcp-server-proof helper: answer("x", …)
  add(/callTool\(\s*\{\s*name:\s*"([a-z0-9_]+)"/g);  // callTool({ name: "x", … })
  add(/callTool\(\s*mcp\s*,\s*"([a-z0-9_]+)"/g);     // callTool(mcp, "x", …)
  add(/\{\s*tool:\s*"([a-z0-9_]+)"/g);               // strictTargets: { tool: "x", args }
  add(/(?:const|let)\s+[A-Z][A-Z0-9_]*\s*=\s*"([a-z0-9_]+)"/g); // const LOCATION_TOOL = "x"
  return names;
}

/** Registered tools no exercise source invokes and that carry no exemption, plus
 *  stale exemptions (exempt but actually exercised, or no longer registered). */
function coverageProblems(registeredTools, called, exempt) {
  const problems = [];
  for (const t of registeredTools) {
    if (called.has(t) || exempt.has(t)) continue;
    problems.push(
      `tool "${t}" is registered but INVOKED by no proof or test — add a call in one of ` +
        `${EXERCISE_SOURCES.join(", ")}, or add it to EXERCISE_EXEMPT with a reason`,
    );
  }
  for (const [t, reason] of exempt) {
    if (called.has(t)) problems.push(`EXERCISE_EXEMPT lists "${t}" ("${reason.slice(0, 40)}…") but it IS invoked by a proof/test — remove the exemption`);
    else if (!registeredTools.includes(t)) problems.push(`EXERCISE_EXEMPT lists "${t}" but the server no longer registers it — remove the exemption`);
  }
  return problems;
}

/** Registered resource URIs vs the ready "Resources:" line — missing and ghost. */
function resourceProblems(registeredResources, announced) {
  const problems = [];
  for (const uri of registeredResources) if (!announced.includes(uri)) problems.push(`ready message omits resource: ${uri}`);
  for (const uri of announced) if (!registeredResources.includes(uri)) problems.push(`ready message announces unregistered resource: ${uri}`);
  return problems;
}

// ── self-test: the new logic must be able to fail, in BOTH directions ─────────
if (process.argv.includes("--self-test")) {
  const fails = [];
  // Coverage direction A — an uncalled, unexempt tool must be flagged.
  if (coverageProblems(["phantom_tool"], new Set(), new Map()).length === 0)
    fails.push("coverage: an uncalled, unexempt tool was not flagged");
  // …and a called tool, or a legitimately exempt one, passes.
  if (coverageProblems(["foo"], new Set(["foo"]), new Map()).length !== 0)
    fails.push("coverage: a called tool was wrongly flagged");
  if (coverageProblems(["heavy"], new Set(), new Map([["heavy", "slow"]])).length !== 0)
    fails.push("coverage: a valid exemption (registered, uncalled) was wrongly flagged");
  // Coverage direction B — a stale exemption must be flagged, both shapes.
  if (coverageProblems(["foo"], new Set(["foo"]), new Map([["foo", "slow"]])).length === 0)
    fails.push("coverage: a stale exemption (tool IS called) was not flagged");
  if (coverageProblems(["foo"], new Set(["foo"]), new Map([["gone", "slow"]])).length === 0)
    fails.push("coverage: a stale exemption (tool not registered) was not flagged");
  // calledTools must distinguish a CALL from a registration-array mention.
  const t1 = calledTools('const NEW_TOOLS = ["only_listed"];\nawait call("really_called", {});');
  if (t1.has("only_listed")) fails.push("calledTools: an array-only mention counted as a call");
  if (!t1.has("really_called")) fails.push("calledTools: a real call() was not recognised");
  if (!calledTools('callTool(mcp, "wired", {})').has("wired")) fails.push('calledTools: callTool(mcp, "x") not recognised');
  if (!calledTools('const LOCATION_TOOL = "loc_tool";').has("loc_tool")) fails.push('calledTools: const NAME = "x" not recognised');
  if (calledTools('assert.ok(tool, "annotated_only missing");').has("annotated_only"))
    fails.push("calledTools: an assert-message mention counted as a call");
  // Resources, both directions.
  if (resourceProblems(["a://x"], ["a://x"]).length !== 0) fails.push("resources: a matching set was wrongly flagged");
  if (resourceProblems(["a://x", "a://y"], ["a://x"]).length === 0) fails.push("resources: a missing resource was not flagged");
  if (resourceProblems(["a://x"], ["a://x", "a://ghost"]).length === 0) fails.push("resources: a ghost resource was not flagged");

  if (fails.length > 0) {
    console.error("MCP surface self-test FAILED:");
    for (const f of fails) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    "MCP surface self-test passed — coverage (both directions), calledTools call/mention " +
      "discrimination, and resource parity can all fail.",
  );
  process.exit(0);
}

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

// 4. Resources: the registered resource URIs equal the ready "Resources:" line.
//    The same drift the tool ready-message check catches (missing / ghost), for
//    the resource surface the server also announces on its own stderr line.
const registeredResources = [...serverSrc.matchAll(/registerResource\(\s*"[^"]+",\s*"([^"]+)"/g)].map((m) => m[1]);
if (registeredResources.length === 0) {
  bad("could not parse any registerResource calls from the server source — the resource parser broke");
} else {
  ok(`server registers ${registeredResources.length} resources: ${registeredResources.join(", ")}`);
}
const resMatch = serverSrc.match(/Resources: ([^"]+)\."/);
if (!resMatch) {
  bad("could not find the server's 'Resources:' ready line");
} else {
  const announcedResources = resMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
  const resProblems = resourceProblems(registeredResources, announcedResources);
  if (resProblems.length === 0) ok("ready message lists exactly the registered resources");
  for (const p of resProblems) bad(`${p} — run: node scripts/generate-sync-manifest.mjs / align the ready line`);
}

// 5. Every registered tool is EXERCISED (actually called) by a proof or test.
const called = new Set();
for (const rel of EXERCISE_SOURCES) {
  let text = "";
  try {
    text = readFileSync(join(repo, rel), "utf8");
  } catch {
    bad(`could not read exercise source ${rel} — tool coverage cannot be derived`);
    continue;
  }
  for (const t of calledTools(text)) called.add(t);
}
const covProblems = coverageProblems(registered, called, EXERCISE_EXEMPT);
if (covProblems.length === 0) {
  ok(`every registered tool is exercised by a proof or test (${EXERCISE_EXEMPT.size} exempt by name with a reason)`);
} else {
  for (const p of covProblems) bad(p);
}

if (failures.length > 0) {
  console.error(`\nMCP surface gate FAILED: ${failures.length} drift(s). The chat connection must match the fabric.`);
  process.exit(1);
}
console.log(
  "\nMCP surface gate passed — server, docs, ready message, and manifest agree; every registered " +
    "tool is exercised; and the registered resources match the ready line.",
);
