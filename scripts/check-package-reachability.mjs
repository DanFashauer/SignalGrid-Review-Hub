// Package-reachability check — a library nobody ships is a library nobody runs.
//
//   node scripts/check-package-reachability.mjs            # report; fail only if unreachable GREW
//   node scripts/check-package-reachability.mjs --update   # accept the current count as the new pin
//
// WHY THIS EXISTS — a mistake, not a theory. An audit reported a missing
// two-person-approval wiring in `lib/dual-control` and it read as a launch-path
// defect worth fixing immediately. It was not: `planFlowActions` has ZERO shipped
// consumers, so wiring a ceremony into it would have been decorative — proven by a
// proof, reachable by nothing. The defect was real in the source and irrelevant in
// production, and nothing in the repository made that difference visible before the
// work started.
//
// A package can be fully typechecked, fully proven, and still be unreachable from
// everything that ships. Proofs do not distinguish the two: `scripts/` imports a
// proof-only package exactly the way `artifacts/api-server` imports a live one, and
// a green suite reports both as healthy. So this measures the one thing a proof
// cannot: can a shipped artifact actually get here?
//
// WHAT COUNTS AS A ROOT. `artifacts/*` only. `scripts/` is deliberately NOT a root —
// "reachable only from a proof harness" is precisely the condition being measured,
// and admitting proofs as roots would make every proof-only package look shipped.
// `native/ios/*` is Swift with no package manifest and cannot import a TS package;
// its parity with the TS simulator is enforced separately by
// `check-decision-port-parity.mjs`.
//
// WHAT UNREACHABLE DOES NOT MEAN. It is not "delete this". Several of these are
// deliberate: a package may be staged ahead of the artifact that will consume it, or
// exist to hold a contract. The finding is a REQUIREMENT TO LOOK, not a verdict —
// before building into one of these, confirm the surface actually ships, or the work
// lands somewhere nothing can call.
//
// WHY A RATCHET AND NOT A HARD GATE. Failing on any unreachable package would mean
// either breaking CI today or force-wiring nine packages into artifacts that do not
// need them yet — manufacturing exactly the fake edges this check exists to detect.
// The pin is a CEILING that may only fall.
//
// EDGES ARE DERIVED TWICE, and the union is used. A `workspace:*` entry in
// package.json is a declared edge; a `@workspace/x` specifier in source is a real
// one. They disagree in both directions (an undeclared import still runs; a declared
// dep may be unused), and for reachability the honest answer is: if either says the
// edge exists, it exists. Trusting manifests alone would let an undeclared import
// masquerade as an unreachable package.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PIN_PATH = join(repoRoot, "artifacts/sync/package-reachability-pin.json");

const SOURCE_EXT = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "coverage", ".turbo", ".git"]);

/** Every workspace package, keyed by its package.json `name`. */
function discoverPackages() {
  const packages = new Map(); // name -> { dir, group }
  for (const group of ["artifacts", "lib"]) {
    const groupDir = join(repoRoot, group);
    for (const entry of readdirSync(groupDir)) {
      const dir = join(groupDir, entry);
      let manifest;
      try {
        manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      } catch {
        continue; // not a package
      }
      if (manifest.name) packages.set(manifest.name, { dir, group });
    }
  }
  const scriptsManifest = JSON.parse(readFileSync(join(repoRoot, "scripts/package.json"), "utf8"));
  packages.set(scriptsManifest.name, { dir: join(repoRoot, "scripts"), group: "scripts" });
  return packages;
}

function* sourceFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) yield* sourceFiles(full);
    else if (SOURCE_EXT.test(entry)) yield full;
  }
}

/** Declared edges: `workspace:` entries in a package's manifest. */
function declaredEdges(dir, known) {
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const out = new Set();
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (typeof spec === "string" && spec.startsWith("workspace:") && known.has(name)) out.add(name);
    }
  }
  return out;
}

/**
 * Real edges: a `@workspace/x` specifier anywhere in the package's source.
 *
 * Matched against the FULL specifier with a boundary, so `@workspace/api-spec` is
 * never credited to `@workspace/api` — a prefix match would silently invent edges
 * and make an unreachable package look reachable, the exact direction of error this
 * gate must not have.
 */
function importedEdges(dir, known) {
  const out = new Set();
  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/@workspace\/[a-z0-9][a-z0-9-]*/g)) {
      if (known.has(match[0])) out.add(match[0]);
    }
  }
  return out;
}

const packages = discoverPackages();
const known = new Set(packages.keys());

const edges = new Map(); // name -> Set(dependency names)
for (const [name, { dir }] of packages) {
  const union = new Set([...declaredEdges(dir, known), ...importedEdges(dir, known)]);
  union.delete(name); // a package's own name appears in its own manifest
  edges.set(name, union);
}

const roots = [...packages].filter(([, meta]) => meta.group === "artifacts").map(([name]) => name);

// Transitive closure from the shipped artifacts. Direct importers are not enough:
// a package reached only through two hops of libraries still ships.
const reachable = new Set();
const queue = [...roots];
while (queue.length > 0) {
  const name = queue.pop();
  if (reachable.has(name)) continue;
  reachable.add(name);
  for (const dep of edges.get(name) ?? []) queue.push(dep);
}

const libs = [...packages]
  .filter(([, meta]) => meta.group === "lib")
  .map(([name]) => name)
  .sort();
const unreachable = libs.filter((name) => !reachable.has(name));

// Why each one is unreachable, derived rather than annotated: a package nothing at
// all imports is a different situation from one only the proof harness imports, and
// the difference decides what to do about it.
const importersOf = (target) => [...edges].filter(([, deps]) => deps.has(target)).map(([name]) => name);
const classify = (name) => {
  const importers = importersOf(name);
  if (importers.length === 0) return "no importers at all";
  return `imported only by: ${importers.sort().join(", ")}`;
};

console.log("Package-reachability check — every library should be reachable from a shipped artifact\n");
console.log(`  shipped artifacts (roots):    ${roots.length}`);
console.log(`  lib/* packages:               ${libs.length}`);
console.log(`  reachable from an artifact:   ${libs.length - unreachable.length}`);
console.log(`  unreachable:                  ${unreachable.length}`);

// NON-VACUITY. Both edge scans are pattern-based; if either stops matching, the
// closure collapses, every library reports unreachable — or, worse for a ratchet,
// the root list goes empty and the check still "passes" by finding nothing to grow
// past. The floors are far below the real counts and exist only to catch a scanner
// that has stopped working rather than a repository that has changed.
let vacuity = 0;
if (roots.length < 5) {
  console.error(`  ✗ only ${roots.length} artifact roots found — the package scan is broken, not the repo`);
  vacuity += 1;
}
if (libs.length < 20) {
  console.error(`  ✗ only ${libs.length} lib packages found — the package scan is broken, not the repo`);
  vacuity += 1;
}
if (libs.length - unreachable.length < 10) {
  console.error(`  ✗ only ${libs.length - unreachable.length} libs reachable — the edge scan is broken, not the repo`);
  vacuity += 1;
}
if (vacuity > 0) {
  console.error("\nPackage-reachability check FAILED — the check itself is not working.");
  process.exit(1);
}

let pin = null;
try {
  pin = JSON.parse(readFileSync(PIN_PATH, "utf8"));
} catch {
  /* first run — established below */
}

const report = (log) => {
  for (const name of unreachable) log(`    · ${name} — ${classify(name)}`);
};

if (process.argv.includes("--update") || pin === null) {
  writeFileSync(PIN_PATH, `${JSON.stringify({ maxUnreachable: unreachable.length }, null, 2)}\n`);
  console.log(`\n  pin set: maxUnreachable=${unreachable.length}`);
  if (unreachable.length > 0) {
    console.log("  Unreachable (confirm a consumer ships before building into these):");
    report(console.log);
  }
  process.exit(0);
}

if (unreachable.length > pin.maxUnreachable) {
  console.error(`\n✗ Unreachable packages GREW: ${unreachable.length} > pinned ceiling ${pin.maxUnreachable}.`);
  console.error("  A library was added that no shipped artifact can reach, or an artifact stopped");
  console.error("  importing one. Either wire it to a consumer, or argue for the new ceiling in the");
  console.error("  commit that raises it. Current unreachable packages:");
  report(console.error);
  process.exit(1);
}

if (unreachable.length < pin.maxUnreachable) {
  console.log(
    `\n  Unreachable fell from ${pin.maxUnreachable} to ${unreachable.length}. Re-run with --update to ` +
      "lower the ceiling so the improvement cannot be undone.",
  );
} else {
  console.log(`\n  At the pinned ceiling (${pin.maxUnreachable}). Not growing.`);
}

if (unreachable.length > 0) {
  console.log("\n  Not reachable from any shipped artifact — proven, but nothing ships them:");
  report(console.log);
  console.log("\n  This is a requirement to LOOK, not a verdict. Before building into one of these,");
  console.log("  confirm the consuming surface actually ships (docs/BUILD_BACKLOG.md records why).");
}

console.log("\nPackage-reachability check passed — no new unshippable libraries.");
