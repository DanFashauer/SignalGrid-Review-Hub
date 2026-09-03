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
// WHAT COUNTS AS A WALKER: a scripts/*.mjs that declares a `const ROOTS` / `const
// roots` ARRAY LITERAL and also calls `readdirSync`. A DERIVED roots set
// (`const roots = deriveRoots(...)`) is the good pattern and is deliberately not
// in scope — the fossil this guards is the hand-listed array.
//
// WHAT DISCHARGES IT: any of a `FILE_FLOOR`, a `.length < N` bar, the word
// "floor", an "Only N … scanned" message, OR an explicit
// `// walker-floor: not needed — <reason>` waiver above the array. The accepted
// forms are broad on purpose (this is a meta-gate over other gates' own floors,
// not a second floor); the waiver is for genuine non-fatal / reported-only walks.
//
// SELF-TEST: a walker with no floor must be flagged; the same walker with a floor
// or a waiver must pass; and the live detector must still find the real walkers.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptsDir = join(repo, "scripts");
const SELF = "check-walker-floors.mjs";

// A hand-listed array of roots, plus a filesystem walk.
export const WALKER_ARRAY = /\bconst\s+(?:ROOTS|roots)\s*=\s*\[/;
export const WALKS = /\breaddirSync\b/;
export function isRootsWalker(source) {
  return WALKER_ARRAY.test(source) && WALKS.test(source);
}

// The controls that satisfy the requirement.
export function hasFloorControl(source) {
  return (
    /\bFILE_FLOOR\b/.test(source) ||
    /\/\/\s*walker-floor:\s*not needed/i.test(source) ||
    /\.length\s*<\s*\d/.test(source) ||
    /\bfloor\b/i.test(source) ||
    /\bOnly\s+[^\n]*\bscann/i.test(source)
  );
}

// The meta-gate's own non-vacuity floor: far below the ~8 walkers today, and only
// tripped if the detector itself stops matching.
const WALKER_FLOOR = 5;

function scriptSources() {
  return readdirSync(scriptsDir)
    .filter((f) => f.endsWith(".mjs") && f !== SELF) // skip self: our self-test embeds a walker string
    .map((f) => [f, readFileSync(join(scriptsDir, f), "utf8")]);
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

  const walkers = scriptSources().filter(([, s]) => isRootsWalker(s));
  checks.push([`LIVE: ${walkers.length} roots-walker(s) found (floor ${WALKER_FLOOR})`, walkers.length >= WALKER_FLOOR]);
  checks.push(["LIVE: every found walker carries a floor or a waiver", walkers.every(([, s]) => hasFloorControl(s))]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const walkers = scriptSources().filter(([, s]) => isRootsWalker(s));
if (walkers.length < WALKER_FLOOR) {
  console.error(
    `✗ only ${walkers.length} roots-walker(s) detected (floor ${WALKER_FLOOR}) — the detector has ` +
      "stopped matching, not the tree emptied. Fix the pattern before trusting a green here.",
  );
  process.exit(1);
}

const offenders = walkers.filter(([, s]) => !hasFloorControl(s)).map(([f]) => f);
console.log(`Walker-floor meta-gate — ${walkers.length} ROOTS/roots-array walker(s) scanned\n`);
if (offenders.length > 0) {
  for (const f of offenders) {
    console.error(
      `  ✗ scripts/${f}: walks a hand-listed roots array with readdirSync but declares NO scanned-count floor.`,
    );
  }
  console.error(
    `\nWalker-floor meta-gate FAILED (${offenders.length}). Add a FILE_FLOOR or a \`.length < N\` bar,\n` +
      "or a `// walker-floor: not needed — <reason>` waiver above the array.",
  );
  process.exit(1);
}
console.log("Walker-floor meta-gate passed — every roots-array walker carries a floor or a stated waiver.");
