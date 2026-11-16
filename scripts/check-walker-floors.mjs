#!/usr/bin/env node
// Walker-floor meta-gate — every hand-listed ROOTS/roots array walk declares a
// non-vacuity floor, or says why it needs none.
//
//   node scripts/check-walker-floors.mjs              # the meta-gate
//   node scripts/check-walker-floors.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS. A gate that walks a fixed array of roots with readdirSync
// scans NOTHING when the roots do not resolve — an absent directory, a walk
// rooted at process.cwd() run from the wrong place, a glob that rotted — and a
// scan of nothing reports green. This is one of the recurring shapes in this
// repository: a check that reports success over the part it has stopped looking
// at. check-module-init-order walked relative to the cwd and passed at zero files
// from anywhere but the repo root; check-nan-fail-open's FILE_FLOOR is the
// control that would have caught it. This meta-gate makes that control mandatory.
//
// WHAT COUNTS AS A WALKER, and how that is DERIVED. Any `scripts/**/*.mjs` that
// binds a const to a HAND-LISTED array of string literals and then feeds that
// identifier to a filesystem walk (`for (const x of IDENT)`, `IDENT.flatMap(…)`,
// `…IDENT`) within reach of a `readdirSync`/`walk*()` call. The identifier's NAME is
// derived from the file, not hand-listed here: `CSS_TREES`, `SCAN_PATHS`, `TREES`,
// `SCAN_SUBDIRS` and `ENTRY_FILES` are all walk roots, and a detector that knew only
// the names `ROOTS`/`roots` could not see any of them. Measured on the tree the day
// this was widened: the name-only net found 7 walkers, deriving from USE found 13.
// The old `ROOTS`/`roots` name test is kept as an ADDITIONAL net (a root passed to a
// helper defined far away is still caught); a hand-list that can only widen scope,
// never narrow it, cannot fossilise into a miss.
//
// The scan is RECURSIVE over `scripts/`. It was `readdirSync(scriptsDir)` — top level
// only — so a walker under `scripts/lib/`, `scripts/mac/`, `scripts/agent/` or
// `scripts/gen/` (12 nested .mjs files today) was invisible to the meta-gate. A
// meta-gate against scans that miss things must not itself miss a subdirectory. Only
// `.mjs` is read, so `scripts/src/e2e/` (TypeScript specs, owned by the e2e runner) is
// not touched.
//
// WHAT DISCHARGES IT — control SHAPES, not vocabulary: a `*FLOOR*` identifier, a
// `.length < N` bar, an "Only N … scanned" message, a VACUITY REFUSAL (a zero/empty
// test sitting beside a message that says the scan read nothing / the scanner is
// broken), OR an explicit `// walker-floor: not needed — <reason>` waiver.
//
// THE BARE WORD "floor" USED TO DISCHARGE IT, and that was the meta-gate's own version
// of the defect it polices: any file that merely mentioned the word — in a comment, in
// prose about some other gate's floors, in `Math.floor` — was recorded as carrying a
// control. Five of the seven walkers it then passed were discharged by a word. The word
// is gone; the shapes replaced it, and they were checked against every live walker
// first, because a control shape that fails to recognise a REAL floor would flag an
// honest file. Three files (check-decision-palette, check-retention-claims,
// check-verdict-tone-source) carry genuine vacuity refusals in exactly that
// non-obvious shape, and the predicate was widened to see them rather than the files
// being asked to change.
//
// SELF-TEST: a walker with no floor must be flagged; the same walker with each accepted
// control must pass; a mention of the word "floor" must NOT pass; a vocabulary array
// that is never walked must not be a walker; and the live detector must still find the
// real walkers, in subdirectories included.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(repo, "scripts");
const SELF = "check-walker-floors.mjs";

// A hand-listed array of STRING LITERALS bound to a const — the fossil shape. The
// identifier's name is captured, never assumed.
export const ARRAY_OF_STRINGS = /\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*\[(?:[^\S\n]*(?:\/\/[^\n]*)?\n)*[^\S\n]*["'`]/g;
// A filesystem walk, by any of the names this repository's gates give one.
export const WALK_CALL = /\breaddirSync\s*\(|\bwalk[A-Za-z]*\s*\(|\bcollectFiles\s*\(|\blistFiles\s*\(/;
export const WALKS = /\breaddirSync\b/;
// The legacy name net, kept only to WIDEN: a `ROOTS` handed to a helper defined
// fifty lines away is still a hand-listed walk root.
export const WALKER_ARRAY = /\bconst\s+(?:ROOTS|roots)\s*=\s*\[/;
// How close a use has to sit to a walk call to count as feeding it.
const USE_WINDOW = 12;

/**
 * The walk-root identifiers this source declares, DERIVED from how they are used:
 * bound to a hand-listed array of strings, then iterated/spread within reach of a
 * walk call. A vocabulary array (`const VALID_OUTCOMES = ["allow", "deny"]`) is not a
 * walk root and must not be treated as one — flagging a file for failing to floor a
 * list it never walks would be a gate punishing an honest file.
 */
export function walkRootNames(source) {
  const lines = source.split("\n");
  const found = new Set();
  for (const m of source.matchAll(ARRAY_OF_STRINGS)) {
    const name = m[1];
    const use = new RegExp(`(?:\\bof\\s+${name}\\b|\\b${name}\\.(?:flatMap|map|forEach)\\s*\\(|\\.\\.\\.${name}\\b)`);
    for (let i = 0; i < lines.length; i += 1) {
      if (!use.test(lines[i])) continue;
      if (WALK_CALL.test(lines.slice(i, i + USE_WINDOW).join("\n"))) {
        found.add(name);
        break;
      }
    }
  }
  return [...found];
}

export function isRootsWalker(source) {
  return walkRootNames(source).length > 0 || (WALKER_ARRAY.test(source) && WALKS.test(source));
}

/**
 * A VACUITY REFUSAL: a zero/emptiness test sitting beside a message that says the scan
 * found nothing or the scanner is broken. This is what a real floor looks like when it
 * is not called one — `if (files.length === 0) { console.error("refusing to report a
 * pass from a scan that read nothing"); }`. The proximity to the refusal message is
 * what keeps it from matching `problems.length === 0`, which is a PASS test.
 */
const ZERO_TEST = /(?:\b\w+\s*===?\s*0\b|\.length\s*[=<]==?\s*0|\.length\s*<\s*1|!\s*\w+\.length|\blength\s*<\s*\d+|===\s*undefined)/;
const REFUSAL_TEXT = /vacuity|read nothing|scanned nothing|found nothing|no .{0,40}(?:found|to scan)|missing from scan|stopped matching|is broken|the tree brok|extractor .{0,20}brok|scanner,? not the/i;
export function hasVacuityRefusal(source) {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!ZERO_TEST.test(lines[i])) continue;
    if (REFUSAL_TEXT.test(lines.slice(Math.max(0, i - 1), i + 4).join("\n"))) return true;
  }
  return false;
}

// The controls that satisfy the requirement. SHAPES ONLY — the bare word "floor" was
// removed; see the header for what it was discharging.
export function hasFloorControl(source) {
  return (
    /\b[A-Z_]*FLOOR[A-Z_]*\b/.test(source) ||
    /\/\/\s*walker-floor:\s*not needed/i.test(source) ||
    /\.length\s*<\s*\d/.test(source) ||
    /\bOnly\s+[^\n]*\bscann/i.test(source) ||
    hasVacuityRefusal(source)
  );
}

// The meta-gate's own non-vacuity floor. 13 walkers today; 8 is below that and ABOVE
// the 7 the name-only detector used to find, so a regression that drops the derived
// half of the detection trips this rather than passing quietly with a smaller sweep.
const WALKER_FLOOR = 8;
// …and the recursion itself: 12 nested .mjs today, so a scan that silently stopped
// descending would fail here rather than report a clean top level.
const NESTED_FLOOR = 6;

function scriptSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      // skip self: our self-test embeds walker strings (dirent type avoids a stat-then-read race)
      else if (entry.name.endsWith(".mjs") && entry.name !== SELF) out.push([relative(scriptsDir, full), readFileSync(full, "utf8")]);
    }
  };
  walk(scriptsDir);
  return out;
}

function selfTest() {
  const checks = [];
  const noFloor = 'const ROOTS = ["lib"];\nfor (const r of ROOTS) readdirSync(r);\n';
  const withFileFloor = `${noFloor}const FILE_FLOOR = 200;\nif (files.length < FILE_FLOOR) process.exit(1);\n`;
  const withLengthBar = `${noFloor}if (files.length < 50) process.exit(1);\n`;
  const withMarker = `// walker-floor: not needed — reported only, never fatal\n${noFloor}`;
  const notAWalker = 'const ROOTS = ["a.ts", "b.ts"];\nfor (const f of ROOTS) readFileSync(f);\n';

  checks.push(["a roots array + readdirSync is a walker", isRootsWalker(noFloor)]);
  checks.push(["a roots array WITHOUT readdirSync is not a walker", !isRootsWalker(notAWalker)]);
  checks.push(["a walker with NO floor is flagged (RED)", isRootsWalker(noFloor) && !hasFloorControl(noFloor)]);
  checks.push(["a walker with FILE_FLOOR passes (GREEN)", hasFloorControl(withFileFloor)]);
  checks.push(["a walker with a `.length < N` bar passes (GREEN)", hasFloorControl(withLengthBar)]);
  checks.push(["a walker with a walker-floor waiver passes (GREEN)", hasFloorControl(withMarker)]);

  // ── the NAME is derived from use, not hand-listed ──────────────────────────
  const namedTrees = 'const CSS_TREES = ["a/src", "b/src"];\nfor (const t of CSS_TREES) readdirSync(t);\n';
  const namedFlat = 'const SCAN_PATHS = ["a", "b"];\nconst files = SCAN_PATHS.flatMap((p) => walkDir(p));\n';
  const vocabulary = 'const VALID_OUTCOMES = ["allow", "deny"];\nconst files = readdirSync("lib");\nif (VALID_OUTCOMES.includes(x)) go();\n';
  checks.push(["a walk root named CSS_TREES is detected (the name is DERIVED, not ROOTS-only)", isRootsWalker(namedTrees) && walkRootNames(namedTrees).includes("CSS_TREES")]);
  checks.push(["a walk root fed through .flatMap(walkDir) is detected", walkRootNames(namedFlat).includes("SCAN_PATHS")]);
  checks.push(["a VOCABULARY array that is never walked is NOT a walk root (a gate must not flag an honest file)", walkRootNames(vocabulary).length === 0]);

  // ── the word "floor" is not a control; the shapes are ──────────────────────
  const wordOnly = `${noFloor}// the floor for this sort of thing lives in a sibling gate\nconst n = Math.floor(x / 2);\n`;
  const vacuity = `${noFloor}if (files.length === 0) {\n  console.error("refusing to report a pass from a scan that read nothing");\n  process.exit(1);\n}\n`;
  const passTest = `${noFloor}console.log(problems.length === 0 ? "ok" : "bad");\n`;
  checks.push(["the WORD \"floor\" in prose (and Math.floor) does NOT discharge the requirement", !hasFloorControl(wordOnly)]);
  checks.push(["a vacuity refusal beside a zero test DOES discharge it", hasFloorControl(vacuity)]);
  checks.push(["`problems.length === 0` — a PASS test, not a floor — does not discharge it", !hasFloorControl(passTest)]);

  const sources = scriptSources();
  const walkers = sources.filter(([, s]) => isRootsWalker(s));
  const nested = sources.filter(([rel]) => rel.includes("/"));
  checks.push([`LIVE: ${walkers.length} roots-walker(s) found (floor ${WALKER_FLOOR})`, walkers.length >= WALKER_FLOOR]);
  checks.push([`LIVE: the scan RECURSES — ${nested.length} nested script(s) read (floor ${NESTED_FLOOR})`, nested.length >= NESTED_FLOOR]);
  checks.push(["LIVE: every found walker carries a floor or a waiver", walkers.every(([, s]) => hasFloorControl(s))]);
  // The detector must not be trivially true either: most scripts are NOT walkers.
  checks.push([`LIVE: not everything is a walker (${walkers.length} of ${sources.length})`, walkers.length < sources.length / 2]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const sources = scriptSources();
const walkers = sources.filter(([, s]) => isRootsWalker(s));
const nestedRead = sources.filter(([rel]) => rel.includes("/")).length;
if (walkers.length < WALKER_FLOOR) {
  console.error(
    `✗ only ${walkers.length} walk-root array(s) detected (floor ${WALKER_FLOOR}) — the detector has ` +
      "stopped matching, not the tree emptied. Fix the pattern before trusting a green here.",
  );
  process.exit(1);
}
if (nestedRead < NESTED_FLOOR) {
  console.error(
    `✗ only ${nestedRead} nested script(s) read under scripts/ (floor ${NESTED_FLOOR}) — the walk stopped ` +
      "descending, so a clean top level would be reported over subdirectories nobody looked at.",
  );
  process.exit(1);
}

const offenders = walkers.filter(([, s]) => !hasFloorControl(s)).map(([f]) => f);
console.log(
  `Walker-floor meta-gate — ${walkers.length} walk-root array(s) across ${sources.length} script(s) ` +
    `(${nestedRead} in subdirectories)\n`,
);
if (offenders.length > 0) {
  for (const f of offenders) {
    console.error(
      `  ✗ scripts/${f}: feeds a hand-listed array of paths to a filesystem walk but declares NO scanned-count floor.`,
    );
  }
  console.error(
    `\nWalker-floor meta-gate FAILED (${offenders.length}). Add a FILE_FLOOR or a \`.length < N\` bar,\n` +
      "or a `// walker-floor: not needed — <reason>` waiver above the array.",
  );
  process.exit(1);
}
console.log("Walker-floor meta-gate passed — every roots-array walker carries a floor or a stated waiver.");
