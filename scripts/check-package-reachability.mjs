// Package-reachability check — a library nobody ships is a library nobody runs.
//
//   node scripts/check-package-reachability.mjs                    # report; fail only if unreachable GREW
//   node scripts/check-package-reachability.mjs --update           # accept the current count as the new pin
//   node scripts/check-package-reachability.mjs --why @workspace/x # print the shortest artifact→x path
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
// THE ONE TIME IT ROSE (8 → 13, 2026-09-05) was a correction of the measurement, not
// of the tree: the edge extractor had credited every textual mention of a package —
// comments included — as an import, so six libraries reached only through prose
// ("mirrors @workspace/adaptive-proposals", "cannot import @workspace/integrations
// without…") were reported shipped, and the count read 7 on the day the fix landed.
// Nothing became unreachable; five packages had never been reachable and the gate
// had been saying otherwise. `--self-test` now pins the extractor's shapes.
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
 * Real edges: a `@workspace/x` specifier in an IMPORT POSITION in the package's source —
 * `import … from "@workspace/x"`, `import "@workspace/x"`, `import("@workspace/x")`,
 * `require("@workspace/x")`, `export … from "@workspace/x"`, and the subpath forms of
 * each (`@workspace/x/sub`).
 *
 * Matched against the FULL specifier with a boundary, so `@workspace/api-spec` is
 * never credited to `@workspace/api` — a prefix match would silently invent edges
 * and make an unreachable package look reachable, the exact direction of error this
 * gate must not have.
 *
 * WHY THE POSITION MATTERS. The first version matched the specifier ANYWHERE in the
 * text, so a comment that merely NAMED a package ("mirrors @workspace/x's ladder")
 * became an edge. A package nothing imports then read as shipped — the phantom edge
 * hid exactly the finding this gate exists to surface — and the ceiling "improved"
 * by one on a comment. A mention is not a dependency; only an import can carry code.
 */
const IMPORT_POSITION =
  /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*|\bimport\s+type\s+)["'](@workspace\/[a-z0-9][a-z0-9-]*)(?:\/[^"']*)?["']/g;

function importedEdgesInText(text, known) {
  const out = new Set();
  for (const match of text.matchAll(IMPORT_POSITION)) {
    if (known.has(match[1])) out.add(match[1]);
  }
  return out;
}

function importedEdges(dir, known) {
  const out = new Set();
  for (const file of sourceFiles(dir)) {
    for (const name of importedEdgesInText(readFileSync(file, "utf8"), known)) out.add(name);
  }
  return out;
}

// `--self-test` — the extractor against the shapes that must and must not count.
// A gate whose only evidence of working is "the count looked right" is the gate
// that credited a comment for a week.
if (process.argv.includes("--self-test")) {
  const known = new Set(["@workspace/alpha", "@workspace/alpha-beta", "@workspace/gamma"]);
  const cases = [
    ['import { x } from "@workspace/alpha";', ["@workspace/alpha"], "named import"],
    ["import x from '@workspace/alpha'", ["@workspace/alpha"], "default import, single quotes"],
    ['import "@workspace/alpha";', ["@workspace/alpha"], "side-effect import"],
    ['import type { T } from "@workspace/alpha";', ["@workspace/alpha"], "type-only import"],
    ['export { y } from "@workspace/alpha";', ["@workspace/alpha"], "re-export"],
    ['export * from "@workspace/alpha/sub";', ["@workspace/alpha"], "re-export of a subpath"],
    ['const m = await import("@workspace/alpha");', ["@workspace/alpha"], "dynamic import"],
    ['const m = require("@workspace/alpha/deep/path");', ["@workspace/alpha"], "require of a subpath"],
    ['import { z } from "@workspace/alpha-beta";', ["@workspace/alpha-beta"], "hyphenated name is not credited to its prefix"],
    ["// mirrors @workspace/alpha's ladder; see @workspace/gamma", [], "a comment mention is not an edge"],
    ['const doc = "see @workspace/alpha for the shape";', [], "a string literal outside an import is not an edge"],
    ['/* import { x } from "@workspace/gamma" */', ["@workspace/gamma"], "an import inside a block comment still counts (documented ceiling of a regex extractor)"],
    ['import { q } from "@workspace/unknown-pkg";', [], "an unknown package is never credited"],
  ];
  let failed = 0;
  for (const [text, expected, label] of cases) {
    const got = [...importedEdgesInText(text, known)].sort();
    const ok = JSON.stringify(got) === JSON.stringify([...expected].sort());
    console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — expected [${expected}] got [${got}]`}`);
    if (!ok) failed += 1;
  }
  if (failed > 0) {
    console.error(`\nPackage-reachability self-test FAILED — ${failed} extractor case(s) wrong.`);
    process.exit(1);
  }
  console.log(`\nPackage-reachability self-test passed — ${cases.length} extractor cases.`);
  process.exit(0);
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

// Why a package is unreachable, derived rather than annotated: a package nothing at
// all imports is a different situation from one only the proof harness imports, and
// the difference decides what to do about it.
const importersOf = (target) => [...edges].filter(([, deps]) => deps.has(target)).map(([name]) => name);
const classifyImporters = (name) => {
  const importers = importersOf(name);
  if (importers.length === 0) return "no importers at all";
  return `imported only by: ${importers.sort().join(", ")}`;
};

// `--why` — the question this gate exists to answer, asked about ONE package.
//
// "Is `posture-composition` reachable?" is answered by the ceiling; "HOW does it
// ship?" is what actually decides where to put new work, and the honest answer is
// often several hops away from where anyone would guess. Breadth-first, so the
// path printed is the shortest one and not an arbitrary walk.
const whyIndex = process.argv.indexOf("--why");
if (whyIndex !== -1) {
  const target = process.argv[whyIndex + 1];
  if (!target || !packages.has(target)) {
    console.error(`--why needs a workspace package name. Unknown: ${target ?? "(none given)"}`);
    console.error(`Known: ${[...packages.keys()].sort().join(", ")}`);
    process.exit(2);
  }
  const cameFrom = new Map();
  const seen = new Set(roots);
  const bfs = [...roots];
  let found = roots.includes(target);
  while (bfs.length > 0 && !found) {
    const name = bfs.shift();
    for (const dep of edges.get(name) ?? []) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      cameFrom.set(dep, name);
      if (dep === target) { found = true; break; }
      bfs.push(dep);
    }
  }
  if (!found) {
    console.log(`${target} is NOT reachable from any shipped artifact.`);
    console.log(`  ${classifyImporters(target)}`);
    console.log("  Building into it lands work nothing can call. Confirm a consuming");
    console.log("  surface ships first, or wire one as part of the same change.");
    process.exit(0);
  }
  const path = [target];
  let cursor = target;
  while (cameFrom.has(cursor)) {
    cursor = cameFrom.get(cursor);
    path.unshift(cursor);
  }
  console.log(`${target} ships via:\n\n  ${path.join("\n    → ")}\n`);
  process.exit(0);
}

const libs = [...packages]
  .filter(([, meta]) => meta.group === "lib")
  .map(([name]) => name)
  .sort();
const unreachable = libs.filter((name) => !reachable.has(name));

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
  for (const name of unreachable) log(`    · ${name} — ${classifyImporters(name)}`);
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
