// MCP roster gate (DR-060 rule 3, first slice) — docs/agent/mcp-roster.json says
// which lane or first-party skill may call which MCP server, and for what; this
// gate checks that the DOCUMENT is internally honest, not that a call obeys it.
//
//   node scripts/check-mcp-roster.mjs              # the gate
//   node scripts/check-mcp-roster.mjs --self-test  # prove it can fail
//
// WHAT THIS CHECKS (a document, never a call):
//   - `docs/agent/mcp-roster.json` parses and has `servers`/`grants`, and
//     `grants.lanes` is an object carrying `cloud`/`mac` arrays and `grants.skills`
//     is an object — a missing or non-object required map is a FAIL, never a
//     silent `?? {}` fallback that would count a lost document as "0 grants, PASS".
//   - `signalgrid-mcp`'s `tools`/`toolNames` in the roster are DERIVED from
//     `artifacts/mcp-server/src/index.ts`'s own `server.registerTool("name", ...)`
//     calls, in source order — never hand-typed and left to drift. The
//     derivation itself is cross-checked against a plain `registerTool(` count,
//     so a registration written in a shape the derivation doesn't recognize
//     (single line, single-quoted name, ...) fails the gate instead of just
//     vanishing from the count. `toolNames` is compared to the derived list as
//     an ORDERED ARRAY (same length, same element at each position), so a
//     duplicate entry fails even though it changes neither the missing nor the
//     extra set.
//   - Every server id named in `grants.lanes.*` or `grants.skills.*` exists in
//     `servers[]` or `external[]`, and every lane/skill grant and every
//     `grants.mentions` entry carries a non-empty `for`/`why`; every lane grant
//     also carries a non-empty `source`.
//   - Every `grants.skills` key is a real FIRST-PARTY skill directory (the same
//     `.claude/skills/VENDORED.md` carve-out `scripts/lib/skill-plane.mjs` uses
//     elsewhere; a vendored skill is out of scope, same exemption every other
//     doc gate gives it).
//   - A grant is allowed only when its target is an `external[]` entry, or a
//     `servers[]` entry whose `disposition` is exactly `"adopted"` or
//     `"adopted-by-reference"` — any other disposition (a misspelling, an
//     unknown value, `evaluated-not-adopted`, `deferred`) FAILS, naming the
//     value.
//   - Every first-party skill doc naming a server — either an `mcp__<server>__`
//     tool call, or the roster's own id (or one of its optional `aliases`) as a
//     whole word, case-insensitively — must have EITHER a `grants.skills` entry
//     for that server, or a `grants.mentions[skill]` entry naming it as
//     precedent/context rather than a call. An unaccounted-for name is a FAIL
//     naming the file, the server and the missing grant/mention.
//   - Every copy of the Context7 pin equals the version in
//     `scripts/install-context7.mjs`'s `export const PINNED`, read from its
//     SOURCE by regex (importing it would run `claude mcp add`). The copies are
//     DERIVED: every tracked text file is swept for the package spec and for a
//     `Context7 … x.y.z` phrase; only the dated records in CONTEXT7_PIN_HISTORY
//     are exempt. A stale copy FAILS naming file:line; a known copy site whose
//     copy vanished FAILS too. Pin-vs-published needs the network: not here.
//
// Fail-closed: an unparseable roster, or one missing `servers`/`grants`, is
// itself a finding — a broken roster is silence dressed as a green gate.
import { readFileSync, existsSync, statSync } from "node:fs";
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

// Context7 pin parity (BUILD_BACKLOG "Context7 pin staleness", offline half).
// `scripts/install-context7.mjs` owns the pin; it is read from that file's
// SOURCE by regex — never imported, because importing it runs `claude mcp add`
// at module load. Two layers:
//   1. A DERIVED sweep of every tracked text file: each `@upstash/context7-mcp@<v>`
//      package spec, and each `Context7 … <x.y.z>` phrase (case-insensitive, same
//      line, ≤40 chars apart), must name PINNED. Nothing is typed in a list, so a
//      new copy anywhere — a skill doc, .mcp.json, a new doc — is held on arrival.
//      The only exemptions are CONTEXT7_PIN_HISTORY: dated, append-only records of
//      what was true on a day (and this gate, whose fixtures plant stale pins).
//   2. The known copy sites below must STILL carry a copy: a site whose copy was
//      reworded out of the sweep's shapes is a finding, not a pass. The roster's
//      `packageVersion` has no "context7" on its line, so it is held structurally.
export const CONTEXT7_INSTALLER = "scripts/install-context7.mjs";
const CONTEXT7_SPEC_RE = /@upstash\/context7-mcp@(\d+\.\d+\.\d+[^\s`"'),;]*)/g;
const CONTEXT7_PHRASE_RE = /context7[^0-9\n]{0,40}?(\d+\.\d+\.\d+)/gi;
export const CONTEXT7_PIN_HISTORY = [
  /^docs\/BUILD_BACKLOG\.md$/,
  /^docs\/agent\/RESOURCE_INTAKE\.md$/,
  /^artifacts\/lane-messages\//,
  /^scripts\/check-mcp-roster\.mjs$/,
];
export const CONTEXT7_PIN_COPIES = [
  { path: CONTEXT7_INSTALLER, re: /^\/\/ (\d+\.\d+\.\d+) published/g },
  { path: "docs/MCP_AND_SKILLS_LANE_PARITY.md", re: CONTEXT7_SPEC_RE },
  { path: ROSTER_PATH, re: /"packageVersion":\s*"([^"]+)"/g, section: /"id":\s*"context7"/ },
  { path: ROSTER_PATH, re: CONTEXT7_SPEC_RE, section: /"id":\s*"context7"/ },
  { path: "scripts/setup-mcp-lane.mjs", re: CONTEXT7_PHRASE_RE },
];

/** Pure: the version in install-context7's `export const PINNED = "@upstash/context7-mcp@X"`, or null. */
export function deriveContext7Pin(installerSource) {
  const m = /export const PINNED = "@upstash\/context7-mcp@([^"]+)"/.exec(installerSource ?? "");
  return m ? m[1] : null;
}

/**
 * Pure: every Context7 pin copy that differs from PINNED, as file:line findings.
 * `files` maps every tracked text path to its contents (the sweep's universe).
 */
export function checkContext7Pin({ installerSource, files, copies = CONTEXT7_PIN_COPIES, history = CONTEXT7_PIN_HISTORY }) {
  const pin = deriveContext7Pin(installerSource);
  if (!pin) return [`${CONTEXT7_INSTALLER}: no \`export const PINNED = "@upstash/context7-mcp@<version>"\` — the pin every copy is held to cannot be derived`];
  const problems = [];
  const stale = (path, line, v) => `${path}:${line}: Context7 pin copy says ${v}, but ${CONTEXT7_INSTALLER} PINNED is ${pin}`;

  // 1. the derived sweep
  let swept = 0;
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== "string" || history.some((re) => re.test(path))) continue;
    if (!/context7/i.test(text)) continue;
    text.split("\n").forEach((line, i) => {
      const seen = new Set();
      for (const re of [CONTEXT7_SPEC_RE, CONTEXT7_PHRASE_RE]) {
        for (const m of line.matchAll(new RegExp(re.source, re.flags))) {
          swept++;
          if (m[1] !== pin && !seen.has(m[1])) {
            seen.add(m[1]);
            problems.push(stale(path, i + 1, m[1]));
          }
        }
      }
    });
  }

  // 2. the known sites must still hold a copy (and the roster's packageVersion is held here)
  for (const { path, re, section } of copies) {
    const text = files[path];
    if (typeof text !== "string") {
      problems.push(`${path}: unreadable — its Context7 pin copy cannot be checked against PINNED ${pin}`);
      continue;
    }
    const lines = text.split("\n");
    let from = 0;
    let to = lines.length;
    if (section) {
      from = lines.findIndex((l) => section.test(l));
      if (from < 0) {
        problems.push(`${path}: no line matching ${section} — the Context7 entry holding the pin copy is gone`);
        continue;
      }
      const next = lines.findIndex((l, i) => i > from && /"id":\s*"/.test(l));
      if (next > 0) to = next;
    }
    let seen = 0;
    for (let i = from; i < to; i++) {
      for (const m of lines[i].matchAll(new RegExp(re.source, re.flags))) {
        seen++;
        const msg = stale(path, i + 1, m[1]);
        if (m[1] !== pin && !problems.includes(msg)) problems.push(msg);
      }
    }
    if (!seen) problems.push(`${path}: no Context7 pin copy matching ${re} — reworded or removed, so the gate can no longer hold it to PINNED ${pin}`);
  }
  if (!swept) problems.push(`the Context7 pin sweep matched nothing across ${Object.keys(files).length} tracked file(s) — a sweep that sees nothing is not a pass`);
  return problems;
}

/** The sweep's universe: every tracked, non-binary file under 2 MB. */
function loadContext7PinFiles() {
  const files = {};
  const listed = execSync("git ls-files -z", { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  for (const path of listed) {
    const abs = resolve(repo, path);
    let buf;
    try {
      if (statSync(abs).size > 2 * 1024 * 1024) continue;
      buf = readFileSync(abs);
    } catch {
      continue; // a tracked file deleted in the worktree is not a copy
    }
    if (buf.includes(0)) continue;
    files[path] = buf.toString("utf8");
  }
  return files;
}

/** Pure: the mcp__<server>__ prefixes (lowercased) named in a chunk of markdown. */
export function mcpServerNamesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/mcp__([A-Za-z0-9][A-Za-z0-9_-]*?)__/g)) out.add(m[1].toLowerCase());
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure: which of `candidates` (a server id plus its aliases) appear in `text` as a
 * whole word, case-insensitively. A multi-word alias ("Neural Memory") is matched
 * literally with `\b` at each end, so internal spaces are not treated as
 * additional boundaries.
 */
function anyWholeWordIn(text, candidates) {
  return candidates.some((c) => new RegExp(`\\b${escapeRegExp(c)}\\b`, "i").test(text));
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

  // D1 — grants.lanes must be an object carrying cloud[] and mac[] arrays, and
  // grants.skills must be an object. No `?? {}` fallback on either: a document
  // that lost these nested maps is a FAIL, not "0 grants, PASS".
  const lanesRaw = r.grants.lanes;
  if (!lanesRaw || typeof lanesRaw !== "object" || Array.isArray(lanesRaw)) {
    problems.push(`${ROSTER_PATH}: grants.lanes is missing or not an object — fail-closed`);
  } else {
    for (const laneName of ["cloud", "mac"]) {
      if (!Array.isArray(lanesRaw[laneName])) problems.push(`${ROSTER_PATH}: grants.lanes.${laneName} is missing or not an array — fail-closed`);
    }
  }
  const skillsRaw = r.grants.skills;
  if (!skillsRaw || typeof skillsRaw !== "object" || Array.isArray(skillsRaw)) {
    problems.push(`${ROSTER_PATH}: grants.skills is missing or not an object — fail-closed`);
  }
  // Once either required map is unusable, the rest of this function has nothing
  // honest to check it against — report just the shape failures above.
  if (problems.length) return problems;

  const external = Array.isArray(r.external) ? r.external : [];
  const knownIds = new Set([...r.servers.map((s) => s.id), ...external.map((e) => e.id)]);
  const externalIds = new Set(external.map((e) => e.id));
  const dispositionById = new Map(r.servers.map((s) => [s.id, s.disposition]));
  const aliasesById = new Map(r.servers.map((s) => [s.id, Array.isArray(s.aliases) ? s.aliases : []]).concat(external.map((e) => [e.id, Array.isArray(e.aliases) ? e.aliases : []])));

  // r2 — signalgrid-mcp's tool count/names are DERIVED, never typed.
  const derived = deriveToolNames(indexSource);
  if (derived.length === 0) {
    problems.push(`${INDEX_PATH}: zero server.registerTool(...) calls matched — the derivation itself is broken`);
  }
  // The derivation only recognizes one call shape (`registerTool(\n  "name"`); a
  // registration written any other way (single line, single-quoted, etc.) would
  // silently vanish from `derived` while still counting toward the real total.
  // Cross-check against the plain call count so that shape drift fails closed.
  const plainCallCount = (indexSource.match(/registerTool\(/g) ?? []).length;
  if (plainCallCount !== derived.length) {
    problems.push(
      `${INDEX_PATH}: ${plainCallCount} registerTool( calls but only ${derived.length} in the derivable shape — a registration is written in a form the derivation does not recognize`,
    );
  }
  const sg = r.servers.find((s) => s.id === "signalgrid-mcp");
  if (!sg) {
    problems.push(`${ROSTER_PATH}: no servers[] entry with id "signalgrid-mcp"`);
  } else {
    if (sg.tools !== derived.length) {
      problems.push(`${ROSTER_PATH}: signalgrid-mcp.tools is ${sg.tools}, but ${INDEX_PATH} derives ${derived.length} registerTool(...) calls`);
    }
    // ORDERED array comparison (Codex #1127 finding 4): same length, same element
    // at each position — a Set-based compare hides both a duplicate and a
    // reordering, and the roster's own prose says toolNames is source-ordered.
    const roster_ = sg.toolNames ?? [];
    if (roster_.length !== derived.length) {
      problems.push(`${ROSTER_PATH}: signalgrid-mcp.toolNames has ${roster_.length} entries, but ${INDEX_PATH} derives ${derived.length}`);
    }
    const mismatchAt = [];
    for (let i = 0; i < Math.max(roster_.length, derived.length); i++) {
      if (roster_[i] !== derived[i]) mismatchAt.push(`[${i}] roster=${JSON.stringify(roster_[i])} derived=${JSON.stringify(derived[i])}`);
    }
    if (mismatchAt.length) {
      problems.push(`${ROSTER_PATH}: signalgrid-mcp.toolNames is out of order or mismatched against ${INDEX_PATH}'s derived order: ${mismatchAt.join("; ")}`);
    }
  }

  // r3 — every granted server id must exist; every skill-grant key must be first-party.
  const fpDirs = new Set(firstPartyDirs ?? []);
  if (fpDirs.size === 0) {
    problems.push(`${VENDORED_DOC}: zero first-party skill directories resolved — refusing to check skill grants against nothing`);
  }

  // D4 — a grant is allowed only onto an external[] entry, or a servers[] entry
  // whose disposition is exactly "adopted" or "adopted-by-reference".
  const ALLOWED_DISPOSITIONS = new Set(["adopted", "adopted-by-reference"]);
  const grantable = (server) => {
    if (externalIds.has(server)) return null; // external[] entries carry no disposition gate here
    const disp = dispositionById.get(server);
    if (!ALLOWED_DISPOSITIONS.has(disp)) return disp;
    return null;
  };

  const lanes = lanesRaw;
  for (const [lane, entries] of Object.entries(lanes)) {
    if (entries != null && !Array.isArray(entries)) {
      problems.push(`${ROSTER_PATH}: grants.lanes.${lane} must be an array, got ${typeof entries}`);
      continue;
    }
    for (const g of entries ?? []) {
      if (!knownIds.has(g.server)) {
        problems.push(`${ROSTER_PATH}: grants.lanes.${lane} names unknown server "${g.server}"`);
        continue;
      }
      const badDisp = grantable(g.server);
      if (badDisp !== null) problems.push(`${ROSTER_PATH}: grants.lanes.${lane} grants "${g.server}", whose disposition is "${badDisp}"`);
      // D3 — every lane grant needs a purpose and a source.
      if (typeof g.for !== "string" || g.for.trim() === "") problems.push(`${ROSTER_PATH}: grants.lanes.${lane} grants "${g.server}" with no non-empty "for"`);
      if (typeof g.source !== "string" || g.source.trim() === "") problems.push(`${ROSTER_PATH}: grants.lanes.${lane} grants "${g.server}" with no non-empty "source"`);
    }
  }
  const skillGrants = skillsRaw;
  for (const [skillDir, entries] of Object.entries(skillGrants)) {
    if (fpDirs.size > 0 && !fpDirs.has(skillDir)) {
      problems.push(`${ROSTER_PATH}: grants.skills has a key "${skillDir}" that is not a first-party skill directory`);
    }
    if (entries != null && !Array.isArray(entries)) {
      problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} must be an array, got ${typeof entries}`);
      continue;
    }
    for (const g of entries ?? []) {
      if (!knownIds.has(g.server)) {
        problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} names unknown server "${g.server}"`);
        continue;
      }
      const badDisp = grantable(g.server);
      if (badDisp !== null) problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} grants "${g.server}", whose disposition is "${badDisp}"`);
      // D3 — every skill grant needs a purpose.
      if (typeof g.for !== "string" || g.for.trim() === "") problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} grants "${g.server}" with no non-empty "for"`);
    }
  }

  // D3 (mentions half) — every grants.mentions entry needs a non-empty why. "$…" keys
  // (e.g. "$comment") are documentation, not a skill directory, and are skipped —
  // same convention the roster already uses at its top level.
  const mentionsRaw = r.grants.mentions && typeof r.grants.mentions === "object" ? r.grants.mentions : {};
  const mentions = Object.fromEntries(Object.entries(mentionsRaw).filter(([k]) => !k.startsWith("$")));
  for (const [skillDir, entries] of Object.entries(mentions)) {
    // A mentions key names a skill precedent/context reference, not a call — it is
    // checked against the same first-party directory set as grants.skills keys, so a
    // stray or misspelled skill directory here is caught the same way there.
    if (fpDirs.size > 0 && !fpDirs.has(skillDir)) {
      problems.push(`${ROSTER_PATH}: grants.mentions has a key "${skillDir}" that is not a first-party skill directory`);
    }
    if (entries != null && !Array.isArray(entries)) {
      problems.push(`${ROSTER_PATH}: grants.mentions.${skillDir} must be an array, got ${typeof entries}`);
      continue;
    }
    for (const m of entries ?? []) {
      if (!knownIds.has(m.server)) problems.push(`${ROSTER_PATH}: grants.mentions.${skillDir} names unknown server "${m.server}"`);
      if (typeof m.why !== "string" || m.why.trim() === "") problems.push(`${ROSTER_PATH}: grants.mentions.${skillDir} names "${m.server}" with no non-empty "why"`);
    }
  }

  // r4/D5 — a first-party skill doc's ACTUAL CALLS (an `mcp__<server>__` tool token)
  // must have a `grants.skills` entry — a `grants.mentions` entry means "not a call",
  // so it can satisfy only a MENTION (the server's id/alias appearing as a whole word
  // without a call token), never a call token itself; otherwise a mentions row could
  // silently clear a real call that has no grant. Calls and mentions are therefore
  // tracked as two separate named-sets, not merged into one.
  const grantedByskill = new Map();
  for (const [skillDir, entries] of Object.entries(skillGrants)) {
    if (!Array.isArray(entries)) continue; // already reported above
    grantedByskill.set(skillDir, new Set(entries.map((g) => String(g.server).toLowerCase())));
  }
  const mentionedByskill = new Map();
  for (const [skillDir, entries] of Object.entries(mentions)) {
    if (!Array.isArray(entries)) continue; // already reported above
    mentionedByskill.set(skillDir, new Set(entries.map((m) => String(m.server).toLowerCase())));
  }
  for (const { dir, path, text } of skillDocs ?? []) {
    const calledNames = mcpServerNamesIn(text); // mcp__<server>__ tokens — actual calls
    const mentionedNames = new Set();
    for (const id of knownIds) {
      const candidates = [id, ...(aliasesById.get(id) ?? [])];
      if (anyWholeWordIn(text, candidates)) mentionedNames.add(id.toLowerCase());
    }
    if (calledNames.size === 0 && mentionedNames.size === 0) continue;
    const granted = grantedByskill.get(dir) ?? new Set();
    const mentioned = mentionedByskill.get(dir) ?? new Set();
    for (const server of calledNames) {
      if (!granted.has(server)) {
        problems.push(`${path}: calls "mcp__${server}__..." but grants.skills.${dir} has no grant for it (a grants.mentions entry does not cover an actual call)`);
      }
    }
    for (const server of mentionedNames) {
      if (calledNames.has(server)) continue; // already checked above as a call
      if (!granted.has(server) && !mentioned.has(server)) {
        problems.push(`${path}: names "${server}" but grants.skills.${dir} has no grant and grants.mentions.${dir} has no mention for it`);
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
      lanes: { cloud: [{ server: "signalgrid-mcp", for: "x", source: "y" }], mac: [] },
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
    "toolNames has 1 entries, but",
  );
  expectFail(
    "an extra toolName FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], toolNames: ["alpha", "beta", "ghost"] }, goodRoster.servers[1]] } },
    "toolNames has 3 entries, but",
  );
  expectFail(
    "a grant to an unknown server FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "nope", for: "x", source: "y" }], mac: [] } } } },
    'unknown server "nope"',
  );
  expectFail(
    "a skill doc naming an ungranted mcp__ghost__x call FAILS",
    { skillDocs: [{ dir: "loop-start", path: ".claude/skills/loop-start/SKILL.md", text: "call mcp__ghost__x here" }] },
    'calls "mcp__ghost__..." but grants.skills.loop-start has no grant',
  );
  expectFail(
    "a grant to an evaluated-not-adopted server FAILS",
    {
      roster: {
        ...goodRoster,
        servers: [...goodRoster.servers, { id: "keycloak-admin", tools: 1, disposition: "evaluated-not-adopted" }],
        grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "keycloak-admin", for: "x", source: "y" }], mac: [] } },
      },
    },
    'whose disposition is "evaluated-not-adopted"',
  );
  expectFail(
    "a grant to a deferred server FAILS",
    {
      roster: {
        ...goodRoster,
        servers: [...goodRoster.servers, { id: "postgres-hardened", tools: null, disposition: "deferred" }],
        grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "postgres-hardened", for: "x", source: "y" }], mac: [] } },
      },
    },
    'whose disposition is "deferred"',
  );
  expectFail(
    "a registerTool( call in a shape the derivation doesn't recognize FAILS",
    { indexSource: goodIndex + `\nserver.registerTool("gamma", {}, async () => ({}));\n` },
    "registerTool( calls but only",
  );
  expectFail(
    "a roster missing servers[] or grants{} FAILS",
    { roster: { servers: goodRoster.servers } },
    "missing servers[] or grants{}",
  );
  expectFail(
    "zero registerTool(...) calls FAILS",
    { indexSource: "// no tools registered here" },
    "zero server.registerTool(...) calls matched",
  );
  expectFail(
    "zero first-party skill directories FAILS",
    { firstPartyDirs: [] },
    "zero first-party skill directories resolved",
  );
  expectFail(
    "a grants.skills key that is not a first-party skill directory FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, skills: { "ghost-skill": [{ server: "signalgrid-mcp", for: "x" }] } } } },
    'key "ghost-skill" that is not a first-party skill directory',
  );
  expectFail(
    "a grants.skills entry naming an unknown server FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, skills: { "loop-start": [{ server: "nope", for: "x" }] } } } },
    'grants.skills.loop-start names unknown server "nope"',
  );
  {
    const problems = run({ roster: "{ not json" });
    checks.push(["an unparseable roster FAILS", problems.length > 0 && problems[0].includes("does not parse")]);
  }

  // D1
  expectFail(
    "missing grants.lanes FAILS",
    { roster: { ...goodRoster, grants: { skills: goodRoster.grants.skills } } },
    "grants.lanes is missing or not an object",
  );
  expectFail(
    "missing grants.skills FAILS",
    { roster: { ...goodRoster, grants: { lanes: goodRoster.grants.lanes } } },
    "grants.skills is missing or not an object",
  );
  expectFail(
    "grants.lanes without 'mac' FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [] } } } },
    "grants.lanes.mac is missing or not an array",
  );

  // D2
  expectFail(
    "toolNames out of order FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], toolNames: ["beta", "alpha"] }, goodRoster.servers[1]] } },
    "toolNames is out of order or mismatched",
  );
  expectFail(
    "a duplicate toolName FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], tools: 2, toolNames: ["alpha", "alpha"] }, goodRoster.servers[1]] } },
    "toolNames is out of order or mismatched",
  );

  // D3
  expectFail(
    "a lane grant with no 'for' FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "signalgrid-mcp", source: "y" }], mac: [] } } } },
    'grants "signalgrid-mcp" with no non-empty "for"',
  );
  expectFail(
    "a lane grant with no 'source' FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "signalgrid-mcp", for: "x" }], mac: [] } } } },
    'grants "signalgrid-mcp" with no non-empty "source"',
  );

  // D4
  expectFail(
    "a disposition of 'totally-unknown' FAILS",
    {
      roster: {
        ...goodRoster,
        servers: [...goodRoster.servers, { id: "weird-server", tools: 1, disposition: "totally-unknown" }],
        grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "weird-server", for: "x", source: "y" }], mac: [] } },
      },
    },
    'whose disposition is "totally-unknown"',
  );

  // D5
  expectFail(
    "a skill doc naming 'wazuh' with neither grant nor mention FAILS",
    {
      roster: { ...goodRoster, servers: [...goodRoster.servers, { id: "wazuh", tools: 1, disposition: "adopted-by-reference" }] },
      skillDocs: [{ dir: "loop-start", path: ".claude/skills/loop-start/SKILL.md", text: "this skill reads the live Wazuh dashboard for context" }],
    },
    'names "wazuh" but grants.skills.loop-start has no grant',
  );
  expectFail(
    "a mention with empty why FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, mentions: { "loop-start": [{ server: "firecrawl", why: "" }] } } } },
    'names "firecrawl" with no non-empty "why"',
  );
  expectFail(
    "a grants.mentions entry does NOT clear an actual mcp__ call FAILS",
    {
      roster: { ...goodRoster, grants: { ...goodRoster.grants, mentions: { "loop-start": [{ server: "context7", why: "precedent only" }] } } },
      skillDocs: [{ dir: "loop-start", path: ".claude/skills/loop-start/SKILL.md", text: "call mcp__context7__query-docs here" }],
    },
    'calls "mcp__context7__..." but grants.skills.loop-start has no grant',
  );
  expectFail(
    "a grants.mentions key that is not a first-party skill directory FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, mentions: { "ghost-skill": [{ server: "firecrawl", why: "x" }] } } } },
    'key "ghost-skill" that is not a first-party skill directory',
  );
  expectFail(
    "a non-array grants.skills entry FAILS instead of throwing",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, skills: { "loop-start": { server: "signalgrid-mcp", for: "x" } } } } },
    "grants.skills.loop-start must be an array, got object",
  );

  // Context7 pin parity, against the REAL tracked tree. Stale versions are built
  // at run time so this file never carries a literal stale pin of its own.
  const pinFiles = loadContext7PinFiles();
  const realInstaller = pinFiles[CONTEXT7_INSTALLER] ?? "";
  const realPin = deriveContext7Pin(realInstaller);
  const OLD = ["4", "0", "4"].join(".");
  const SPEC = ["@upstash", "context7-mcp"].join("/") + "@";
  const pinRun = (over = {}, installer = realInstaller) => checkContext7Pin({ installerSource: installer, files: { ...pinFiles, ...over } });
  const appendTo = (path, line) => ({ [path]: `${pinFiles[path] ?? ""}\n${line}\n` });
  const lineCount = (path) => (pinFiles[path] ?? "").split("\n").length + 1;
  const names = (problems, path, line, v) => problems.some((p) => p.startsWith(`${path}:${line}: Context7 pin copy says ${v},`));
  checks.push(["the committed tree holds every Context7 pin copy at PINNED", realPin !== null && pinRun().length === 0]);

  const bumped = realInstaller.replace(/(export const PINNED = "@upstash\/context7-mcp@)[^"]+"/, '$19.9.9"');
  const stale = pinRun({}, bumped);
  const expectStale = [];
  for (const [path, text] of Object.entries(pinFiles)) {
    if (path === CONTEXT7_INSTALLER || CONTEXT7_PIN_HISTORY.some((re) => re.test(path))) continue;
    text.split("\n").forEach((l, i) => {
      if (/@upstash\/context7-mcp@\d|context7[^0-9\n]{0,40}?\d+\.\d+\.\d+|"packageVersion":\s*"4/i.test(l) && (path !== ROSTER_PATH || /context7|packageVersion/.test(l)))
        expectStale.push(`${path}:${i + 1}:`);
    });
  }
  checks.push([
    `a bumped PINNED (9.9.9) names every stale copy (${expectStale.join(" ")})`,
    expectStale.length >= 5 && expectStale.every((loc) => stale.some((p) => p.startsWith(loc) && p.includes("PINNED is 9.9.9"))),
  ]);
  const plants = [
    ["docs/agent/mcp-roster-UNLISTED.md", `${SPEC}${OLD}`, "an UNLISTED file's package spec"],
    [".mcp.json", `"x": "${SPEC}${OLD}"`, "an unlisted .mcp.json key"],
    [".claude/skills/signalgrid-master/SKILL.md", `npx -y ${SPEC}${OLD}`, "the context7-granted skill's doc"],
    ["docs/MCP_AND_SKILLS_LANE_PARITY.md", `Context7 pinned at ${OLD}`, "a reworded phrase in a listed doc"],
    ["scripts/setup-mcp-lane.mjs", `// ${SPEC}${OLD}`, "the package-spec form in a phrase-shaped site"],
  ];
  for (const [path, line, what] of plants) {
    checks.push([`a stale pin in ${what} (${path}) is named`, names(pinRun(appendTo(path, line)), path, lineCount(path), OLD)]);
  }
  checks.push([
    "a stale pin in a dated history record (docs/agent/RESOURCE_INTAKE.md) is exempt, by name",
    pinRun(appendTo("docs/agent/RESOURCE_INTAKE.md", `${SPEC}${OLD}`)).length === 0,
  ]);
  checks.push(["an installer with no PINNED FAILS", pinRun({}, "const X = 1;").some((p) => p.includes("cannot be derived"))]);
  checks.push([
    "a reworded copy (no match left at a known site) FAILS instead of passing unseen",
    pinRun({ "scripts/setup-mcp-lane.mjs": "// Context seven, pinned" }).some((p) => p.startsWith("scripts/setup-mcp-lane.mjs: no Context7 pin copy")),
  ]);
  checks.push([
    "a roster with no context7 entry FAILS",
    pinRun({ [ROSTER_PATH]: "{}" }).some((p) => p.includes("Context7 entry holding the pin copy is gone")),
  ]);
  checks.push([
    "an empty sweep universe FAILS",
    checkContext7Pin({ installerSource: realInstaller, files: {}, copies: [] }).some((p) => p.includes("matched nothing")),
  ]);

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

  const pinFiles = loadContext7PinFiles();
  const problems = [
    ...check({ roster, indexSource, skillDocs, firstPartyDirs }),
    ...checkContext7Pin({ installerSource: pinFiles[CONTEXT7_INSTALLER], files: pinFiles }),
  ];
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
  const mentionEntries = Object.entries(roster.grants?.mentions ?? {}).filter(([k]) => !k.startsWith("$"));
  const mentionCount = mentionEntries.reduce((n, [, a]) => n + (Array.isArray(a) ? a.length : 0), 0);
  const sg = roster.servers.find((s) => s.id === "signalgrid-mcp");
  const derived = deriveToolNames(indexSource);
  console.log(
    `mcp-roster: ${nServers} servers (+${nExternal} external), signalgrid-mcp ${sg?.tools ?? 0}/${derived.length} tools derived, ` +
      `${laneGrants} lane grants, ${skillGrants} skill grants over ${firstPartyDirs.length} first-party skills, ${mentionCount} mentions, ` +
      `Context7 pin ${deriveContext7Pin(pinFiles[CONTEXT7_INSTALLER])} held across ${Object.keys(pinFiles).length} tracked text files ` +
      `(${CONTEXT7_PIN_HISTORY.length} dated-record exemptions, ${CONTEXT7_PIN_COPIES.length} known sites present), 0 problems`,
  );
  console.log("PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
