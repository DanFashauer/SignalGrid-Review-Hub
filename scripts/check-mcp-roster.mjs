// MCP roster gate (DR-060 rule 3, first slice) — docs/agent/mcp-roster.json says
// which lane or first-party skill may call which MCP server, and for what; this
// gate checks that the DOCUMENT is internally honest, not that a call obeys it.
//
//   node scripts/check-mcp-roster.mjs              # the gate
//   node scripts/check-mcp-roster.mjs --self-test  # prove it can fail
//
// WHAT THIS CHECKS (a document, never a call):
//   - `docs/agent/mcp-roster.json` parses and has `servers`/`grants`.
//   - `signalgrid-mcp`'s `tools`/`toolNames` in the roster are DERIVED from
//     `artifacts/mcp-server/src/index.ts`'s own `server.registerTool("name", ...)`
//     calls, in source order — never hand-typed and left to drift.
//   - Every server id named in `grants.lanes.*` or `grants.skills.*` exists in
//     `servers[]` or `external[]`.
//   - Every `grants.skills` key is a real FIRST-PARTY skill directory (the same
//     `.claude/skills/VENDORED.md` carve-out `scripts/lib/skill-plane.mjs` uses
//     elsewhere; a vendored skill is out of scope, same exemption every other
//     doc gate gives it).
//   - Every first-party skill doc that names an `mcp__<server>__` tool call holds
//     a grant for that server — an ungranted call is a FAIL naming the file, the
//     server and the missing grant.
//   - No grant names a server whose roster disposition is `evaluated-not-adopted`
//     or `deferred` (a resource explicitly not cleared for use).
//
// Server ids are matched CASE-INSENSITIVELY, read as the text between `mcp__`
// and the next `__` in a tool name (`mcp__Context7__resolve-library-id` names
// `context7`).
//
// Fail-closed: an unparseable roster, or one missing `servers`/`grants`, is
// itself a finding — a broken roster is silence dressed as a green gate.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { firstPartySkillDirsIn, SKILLS_DIR, VENDORED_DOC } from "./lib/skill-plane.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER_PATH = "docs/agent/mcp-roster.json";
const INDEX_PATH = "artifacts/mcp-server/src/index.ts";

/** Pure: ordered tool names from `server.registerTool(\n  "name"` calls in the source. */
export function deriveToolNames(indexSource) {
  const out = [];
  const re = /server\.registerTool\(\s*\n\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(indexSource))) out.push(m[1]);
  return out;
}

/** Pure: the mcp__<server>__ prefixes (lowercased) named in a chunk of markdown. */
export function mcpServerNamesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/mcp__([A-Za-z0-9][A-Za-z0-9_-]*?)__/g)) out.add(m[1].toLowerCase());
  return out;
}

/**
 * Pure verdict. `roster` is a parsed object OR a raw string (unparseable input is
 * itself a finding, never thrown). `indexSource` is the mcp-server source text.
 * `skillDocs` is [{ dir, path, text }] for every *.md under every TRACKED
 * first-party skill dir; `firstPartyDirs` is that dir-name list.
 * Returns an array of problem strings; empty means clean.
 */
export function check({ roster, indexSource, skillDocs, firstPartyDirs }) {
  const problems = [];

  let r = roster;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch (err) {
      return [`${ROSTER_PATH} does not parse as JSON: ${err.message}`];
    }
  }
  if (!r || typeof r !== "object" || !Array.isArray(r.servers) || !r.grants || typeof r.grants !== "object") {
    return [`${ROSTER_PATH} is missing servers[] or grants{} — fail-closed`];
  }

  const external = Array.isArray(r.external) ? r.external : [];
  const knownIds = new Set([...r.servers.map((s) => s.id), ...external.map((e) => e.id)]);
  const dispositionById = new Map([
    ...r.servers.map((s) => [s.id, s.disposition]),
    ...external.map((e) => [e.id, e.decision]),
  ]);

  // r2 — signalgrid-mcp's tool count/names are DERIVED, never typed.
  const derived = deriveToolNames(indexSource);
  if (derived.length === 0) {
    problems.push(`${INDEX_PATH}: zero server.registerTool(...) calls matched — the derivation itself is broken`);
  }
  const sg = r.servers.find((s) => s.id === "signalgrid-mcp");
  if (!sg) {
    problems.push(`${ROSTER_PATH}: no servers[] entry with id "signalgrid-mcp"`);
  } else {
    if (sg.tools !== derived.length) {
      problems.push(`${ROSTER_PATH}: signalgrid-mcp.tools is ${sg.tools}, but ${INDEX_PATH} derives ${derived.length} registerTool(...) calls`);
    }
    const rosterSet = new Set(sg.toolNames ?? []);
    const derivedSet = new Set(derived);
    const missingFromRoster = derived.filter((n) => !rosterSet.has(n));
    const extraInRoster = (sg.toolNames ?? []).filter((n) => !derivedSet.has(n));
    if (missingFromRoster.length) problems.push(`${ROSTER_PATH}: signalgrid-mcp.toolNames is missing ${missingFromRoster.join(", ")} (present in ${INDEX_PATH})`);
    if (extraInRoster.length) problems.push(`${ROSTER_PATH}: signalgrid-mcp.toolNames names ${extraInRoster.join(", ")}, not present in ${INDEX_PATH}`);
  }

  // r3 — every granted server id must exist; every skill-grant key must be first-party.
  const fpDirs = new Set(firstPartyDirs ?? []);
  if (fpDirs.size === 0) {
    problems.push(`${VENDORED_DOC}: zero first-party skill directories resolved — refusing to check skill grants against nothing`);
  }
  const lanes = r.grants.lanes ?? {};
  for (const [lane, entries] of Object.entries(lanes)) {
    for (const g of entries ?? []) {
      if (!knownIds.has(g.server)) problems.push(`${ROSTER_PATH}: grants.lanes.${lane} names unknown server "${g.server}"`);
      else if (["evaluated-not-adopted", "deferred"].includes(dispositionById.get(g.server))) {
        problems.push(`${ROSTER_PATH}: grants.lanes.${lane} grants "${g.server}", whose disposition is "${dispositionById.get(g.server)}"`);
      }
    }
  }
  const skillGrants = r.grants.skills ?? {};
  for (const [skillDir, entries] of Object.entries(skillGrants)) {
    if (fpDirs.size > 0 && !fpDirs.has(skillDir)) {
      problems.push(`${ROSTER_PATH}: grants.skills has a key "${skillDir}" that is not a first-party skill directory`);
    }
    for (const g of entries ?? []) {
      if (!knownIds.has(g.server)) problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} names unknown server "${g.server}"`);
      else if (["evaluated-not-adopted", "deferred"].includes(dispositionById.get(g.server))) {
        problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} grants "${g.server}", whose disposition is "${dispositionById.get(g.server)}"`);
      }
    }
  }

  // r4 — an mcp__<server>__ call in a first-party skill doc must have a grant.
  const grantedByskill = new Map();
  for (const [skillDir, entries] of Object.entries(skillGrants)) {
    grantedByskill.set(skillDir, new Set((entries ?? []).map((g) => String(g.server).toLowerCase())));
  }
  for (const { dir, path, text } of skillDocs ?? []) {
    const named = mcpServerNamesIn(text);
    if (named.size === 0) continue;
    const granted = grantedByskill.get(dir) ?? new Set();
    for (const server of named) {
      if (!granted.has(server)) {
        problems.push(`${path}: names mcp__${server}__ but grants.skills.${dir} has no grant for "${server}"`);
      }
    }
  }

  return problems;
}

function loadSkillDocs(firstPartyDirs) {
  const out = [];
  for (const dir of firstPartyDirs) {
    const base = `${SKILLS_DIR}/${dir}`;
    let files;
    try {
      files = execSync(`git ls-files -- ${base}`, { cwd: repo, encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".md"));
    } catch {
      files = [];
    }
    for (const f of files) {
      if (!existsSync(resolve(repo, f))) continue;
      out.push({ dir, path: f, text: readFileSync(resolve(repo, f), "utf8") });
    }
  }
  return out;
}

function selfTest() {
  const goodIndex = `
server.registerTool(
  "alpha",
  {},
  async () => {},
);
server.registerTool(
  "beta",
  {},
  async () => {},
);
`;
  const goodRoster = {
    servers: [
      { id: "signalgrid-mcp", tools: 2, toolNames: ["alpha", "beta"], disposition: "adopted" },
      { id: "context7", tools: 2, disposition: "adopted" },
    ],
    external: [{ id: "firecrawl", decision: "adopted" }],
    grants: {
      lanes: { cloud: [{ server: "signalgrid-mcp", for: "x", source: "y" }] },
      skills: { "loop-start": [{ server: "signalgrid-mcp", for: "x" }] },
    },
  };
  const fp = ["loop-start"];

  const run = (over = {}) =>
    check({
      roster: goodRoster,
      indexSource: goodIndex,
      skillDocs: [],
      firstPartyDirs: fp,
      ...over,
    });

  const checks = [];
  const expectFail = (name, over, want) => {
    const problems = run(over);
    checks.push([name, problems.some((p) => p.includes(want))]);
  };

  checks.push(["a clean roster passes", run().length === 0]);

  expectFail(
    "a wrong tools count FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], tools: 99 }, goodRoster.servers[1]] } },
    "signalgrid-mcp.tools is 99",
  );
  expectFail(
    "a missing toolName FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], toolNames: ["alpha"] }, goodRoster.servers[1]] } },
    "missing alpha".replace("alpha", "beta"), // missingFromRoster names "beta"
  );
  expectFail(
    "an extra toolName FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], toolNames: ["alpha", "beta", "ghost"] }, goodRoster.servers[1]] } },
    "ghost",
  );
  expectFail(
    "a grant to an unknown server FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "nope", for: "x", source: "y" }] } } } },
    'unknown server "nope"',
  );
  expectFail(
    "a skill doc naming an ungranted mcp__ghost__x call FAILS",
    { skillDocs: [{ dir: "loop-start", path: ".claude/skills/loop-start/SKILL.md", text: "call mcp__ghost__x here" }] },
    "no grant for \"ghost\"",
  );
  expectFail(
    "a grant to an evaluated-not-adopted server FAILS",
    {
      roster: {
        ...goodRoster,
        servers: [...goodRoster.servers, { id: "keycloak-admin", tools: 1, disposition: "evaluated-not-adopted" }],
        grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "keycloak-admin", for: "x", source: "y" }] } },
      },
    },
    'whose disposition is "evaluated-not-adopted"',
  );
  {
    const problems = run({ roster: "{ not json" });
    checks.push(["an unparseable roster FAILS", problems.length > 0 && problems[0].includes("does not parse")]);
  }

  const bad = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (bad.length) {
    console.error(`check-mcp-roster self-test: ${bad.length} FAILED`);
    process.exit(1);
  }
  console.log(`check-mcp-roster self-test: ${checks.length}/${checks.length}`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const rosterText = readFileSync(resolve(repo, ROSTER_PATH), "utf8");
  const indexSource = readFileSync(resolve(repo, INDEX_PATH), "utf8");
  const vendoredMd = readFileSync(resolve(repo, VENDORED_DOC), "utf8");
  const firstPartyDirs = firstPartySkillDirsIn(vendoredMd);
  const skillDocs = loadSkillDocs(firstPartyDirs);

  let roster;
  try {
    roster = JSON.parse(rosterText);
  } catch {
    roster = rosterText; // let check() report the parse failure uniformly
  }

  const problems = check({ roster, indexSource, skillDocs, firstPartyDirs });
  if (problems.length) {
    console.error(`check-mcp-roster FAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  const nServers = Array.isArray(roster.servers) ? roster.servers.length : 0;
  const nExternal = Array.isArray(roster.external) ? roster.external.length : 0;
  const laneGrants = Object.values(roster.grants?.lanes ?? {}).reduce((n, a) => n + (a?.length ?? 0), 0);
  const skillGrantEntries = Object.values(roster.grants?.skills ?? {});
  const skillGrants = skillGrantEntries.reduce((n, a) => n + (a?.length ?? 0), 0);
  const sg = roster.servers.find((s) => s.id === "signalgrid-mcp");
  const derived = deriveToolNames(indexSource);
  console.log(
    `mcp-roster: ${nServers} servers (+${nExternal} external), signalgrid-mcp ${sg?.tools ?? 0}/${derived.length} tools derived, ` +
      `${laneGrants} lane grants, ${skillGrants} skill grants over ${firstPartyDirs.length} first-party skills, 0 problems`,
  );
  console.log("PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
