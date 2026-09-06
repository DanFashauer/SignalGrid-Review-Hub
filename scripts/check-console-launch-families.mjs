#!/usr/bin/env node
// Console launch-families mirror — the Dashboard's "Connector health · launch
// families" card must name EXACTLY the launch-arm connector families the launch
// profile declares. Both directions.
//
//   node scripts/check-console-launch-families.mjs
//   node scripts/check-console-launch-families.mjs --self-test
//   node scripts/check-console-launch-families.mjs --scan <dir>   (diagnostic, see below)
//
// WHY A MIRROR IS ALLOWED TO EXIST HERE AT ALL. `LAUNCH_FAMILIES` in Dashboard.tsx is
// a deliberate second copy — the console is a browser bundle and cannot import
// `scripts/launch-profile.mjs`, and the comment above the array says as much ("A static
// list is correct here: family membership is a declared, gated fact"). A second copy is
// only ever acceptable when something holds it to the first, and until this file
// existed nothing did. So the copy is held to the same bijection
// `check-it-layer-model.mjs` applies to the console's route-owner mirror:
//
//   · every launch family in the profile appears on the card   (no silent family)
//   · every family on the card is a launch family              (no phantom claim)
//
// The second direction is the one that matters for what may be SAID: a card naming a
// family the profile has NOT put on the launch arm is a launch claim the launch
// profile does not carry, which is exactly the drift the claim gates exist to stop.
//
// SCOPE IS DERIVED, in both places. The profile side imports SURFACES and reads the
// `connector-families` surface's `launch` arm — the key is not retyped as a literal
// list, so a family promoted or demoted upstream moves this gate with it. The console
// side parses the array out of Dashboard.tsx.
//
// FAIL-CLOSED: an empty profile arm, a missing surface key, or an unparseable console
// array is fatal — two empty sets are equal, and that must never read as agreement.
// SELF-TEST FIRST: a fixture missing one id, and a fixture carrying an extra one, must
// both be flagged, or the gate refuses to conclude anything.
//
// --scan <dir> replaces the console src root; DIAGNOSTIC only, used to prove this gate
// fails on a real tree carrying the defect. preflight and CI pass no arguments.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SURFACES } from "./launch-profile.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scanIdx = process.argv.indexOf("--scan");
const CONSOLE_SRC = scanIdx !== -1 ? process.argv[scanIdx + 1] : join(repo, "artifacts/signalgrid-app/src");
const DASHBOARD = join(CONSOLE_SRC, "pages/Dashboard.tsx");
const SURFACE_KEY = "connector-families";
const CONSOLE_CONST = "LAUNCH_FAMILIES";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ── derivation: the console's copy ───────────────────────────────────────────
function parseConsoleFamilies(text) {
  const start = text.indexOf(`const ${CONSOLE_CONST} = [`);
  if (start === -1) return null;
  const open = text.indexOf("[", start);
  let depth = 0;
  let i = open;
  for (; i < text.length; i += 1) {
    if (text[i] === "[") depth += 1;
    else if (text[i] === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = text.slice(open, i + 1);
  return [...body.matchAll(/\bid:\s*(['"])([^'"]+)\1/g)].map((m) => m[2]);
}

// ── the mirror (shared by the self-test) ─────────────────────────────────────
/** @returns {string[]} failures */
function mirror(profileIds, consoleIds) {
  const failures = [];
  const inConsole = new Set(consoleIds);
  const inProfile = new Set(profileIds);
  for (const id of profileIds) {
    if (!inConsole.has(id)) {
      failures.push(
        `the launch profile puts "${id}" on the launch arm of ${SURFACE_KEY}, but the Dashboard's ${CONSOLE_CONST} card does not name it — ` +
          "a launch family with no health row is a family nobody is watching.",
      );
    }
  }
  for (const id of consoleIds) {
    if (!inProfile.has(id)) {
      failures.push(
        `the Dashboard's ${CONSOLE_CONST} card names "${id}", which is NOT on the launch arm of ${SURFACE_KEY} in scripts/launch-profile.mjs — ` +
          "the console would show a launch claim the launch profile does not carry.",
      );
    }
  }
  if (consoleIds.length !== new Set(consoleIds).size) {
    failures.push(`${CONSOLE_CONST} contains a duplicate id — the card would render the same family twice.`);
  }
  return failures;
}

// ── self-test ────────────────────────────────────────────────────────────────
let selfTestShapes = 0;
{
  const cases = [
    { name: "a fixture with one id missing is FLAGGED", profile: ["a", "b", "c"], console: ["a", "b"], want: 1 },
    { name: "a fixture with one EXTRA id is FLAGGED", profile: ["a", "b"], console: ["a", "b", "z"], want: 1 },
    { name: "an exact mirror (any order) is CLEAR", profile: ["a", "b", "c"], console: ["c", "a", "b"], want: 0 },
    { name: "a duplicated id is FLAGGED", profile: ["a", "b"], console: ["a", "b", "b"], want: 1 },
    { name: "a totally disjoint console list is FLAGGED in BOTH directions", profile: ["a"], console: ["z"], want: 2 },
  ];
  selfTestShapes = cases.length;
  const failures = [];
  for (const c of cases) {
    const got = mirror(c.profile, c.console).length;
    if (got !== c.want) failures.push(`${c.name} — expected ${c.want} failure(s), got ${got}`);
  }
  const parsed = parseConsoleFamilies(`const ${CONSOLE_CONST} = [\n  { id: "graph", reads: "x" },\n  { id: "local-authority", reads: "y" },\n];\n`);
  if (!parsed || parsed.join(",") !== "graph,local-authority") {
    failures.push(`parseConsoleFamilies no longer reads ids out of the console array (got ${JSON.stringify(parsed)})`);
  }
  if (parseConsoleFamilies("const SOMETHING_ELSE = [];") !== null) {
    failures.push("parseConsoleFamilies returns a parse where there is no array — a missing const must be fatal, not empty");
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    fail("SELF-TEST FAILED: the launch-families mirror no longer flags its synthetic violations. A gate that cannot fail proves nothing.");
  }
}

if (process.argv.includes("--self-test")) {
  console.log(`check-console-launch-families self-test passed (${selfTestShapes} shapes, both directions).`);
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
const surface = SURFACES.find((s) => s.key === SURFACE_KEY);
if (!surface) fail(`scripts/launch-profile.mjs has no SURFACES entry keyed "${SURFACE_KEY}" — fix this derivation, do not hand-list the families.`);
const profileIds = (surface.launch ?? []).map((e) => (typeof e === "string" ? e : e.id)).filter(Boolean);
if (profileIds.length === 0) fail(`the launch arm of "${SURFACE_KEY}" derived to zero families — two empty sets compare equal, and that must never read as agreement.`);

if (!existsSync(DASHBOARD)) fail(`${DASHBOARD} missing — the console surface moved; fix this derivation.`);
const consoleIds = parseConsoleFamilies(readFileSync(DASHBOARD, "utf8"));
if (consoleIds === null) fail(`no \`const ${CONSOLE_CONST} = [ … ]\` in ${DASHBOARD} — the card was renamed or removed; fix this gate rather than letting it pass on nothing.`);
if (consoleIds.length === 0) fail(`${CONSOLE_CONST} parsed to zero ids — the array shape changed under the parser.`);

const failures = mirror(profileIds, consoleIds);

console.log(
  `check-console-launch-families: ${profileIds.length} launch family(ies) in the profile [${profileIds.join(", ")}] ` +
    `vs ${consoleIds.length} on the Dashboard card [${consoleIds.join(", ")}]; self-test green` +
    (scanIdx !== -1 ? ` [DIAGNOSTIC --scan ${CONSOLE_SRC}]` : ""),
);
if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\nConsole launch-families gate FAILED — ${failures.length} mismatch(es) between the launch profile and the console's copy.`);
  process.exit(1);
}
console.log("Console launch-families gate passed — the Dashboard card mirrors the launch profile's launch arm exactly, in both directions.");
