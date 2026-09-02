#!/usr/bin/env node
// The EnterpriseShell decision port is compiled by two different build systems, and
// this asserts they compile the same files.
//
// WHY. `native/ios/project.yml` lists the port sources inside the `EnterpriseShellTests`
// Xcode target; `native/ios/Package.swift` lists them again as the `EnterpriseShellPort`
// SwiftPM target. Both lists are hand-maintained, both are easy to extend, and nothing
// forces a change to one to reach the other. Left alone, the iOS run and the macOS run
// slowly stop testing the same code — and the failure is silent in the worst way: both
// lanes stay green while one of them quietly stops covering a file.
//
// Duplicating the list was still the right call. The alternative — one build system —
// means either giving up the fast, simulator-free macOS run or giving up the Xcode test
// target that proves the app itself builds. Two lists plus a gate is cheaper than
// either loss. This file is the gate.
//
// SCOPE IS DERIVED, NOT PINNED. Nothing here hard-codes which files the port contains;
// both sides are parsed and compared as sets. Adding another source file to both
// places passes with no edit here. Adding it to one fails.
//
// Run: node scripts/check-ios-port-sources.mjs [--self-test]

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_SWIFT = "native/ios/Package.swift";
const PROJECT_YML = "native/ios/project.yml";

const SWIFT_TARGET = "EnterpriseShellPort";
const XCODE_TARGET = "EnterpriseShellTests";

/**
 * Pull the `sources:` array out of the named SwiftPM target, and prefix each entry
 * with that target's `path:`, so the result is repo-relative under native/ios/.
 *
 * Deliberately strict: a target that cannot be found, or that has no `sources` array,
 * throws instead of returning an empty set. "Found nothing" and "there is nothing"
 * are different facts, and only one of them should ever pass a gate.
 */
function swiftPackageSources(text) {
  // Split into target declarations first, then find the one by name. Searching for
  // the name directly would land on `Package(name: "EnterpriseShellPort")`, which
  // shares the string and declares no sources — a parser that silently reads the
  // wrong block is worse than one that fails.
  const starts = [...text.matchAll(/\.(?:test)?[Tt]arget\s*\(/g)].map((m) => m.index);
  const blocks = starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length));
  const matching = blocks.filter((b) => b.includes(`name: "${SWIFT_TARGET}"`));
  if (matching.length === 0) {
    throw new Error(`${PACKAGE_SWIFT}: no target named "${SWIFT_TARGET}"`);
  }
  if (matching.length > 1) {
    throw new Error(`${PACKAGE_SWIFT}: ${matching.length} targets named "${SWIFT_TARGET}"`);
  }
  const block = matching[0];

  const pathMatch = block.match(/\bpath:\s*"([^"]+)"/);
  if (!pathMatch) {
    throw new Error(`${PACKAGE_SWIFT}: target "${SWIFT_TARGET}" declares no path:`);
  }
  const sourcesMatch = block.match(/\bsources:\s*\[([\s\S]*?)\]/);
  if (!sourcesMatch) {
    throw new Error(
      `${PACKAGE_SWIFT}: target "${SWIFT_TARGET}" declares no explicit sources: array. ` +
        `Without one SwiftPM scans the whole app directory, which would pull UIKit ` +
        `view controllers into a package that must stay pure Foundation.`,
    );
  }
  const files = [...sourcesMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (files.length === 0) {
    throw new Error(`${PACKAGE_SWIFT}: target "${SWIFT_TARGET}" has an empty sources: array`);
  }
  return new Set(files.map((f) => `${pathMatch[1]}/${f}`));
}

/**
 * Pull the `.swift` file entries out of the named XcodeGen target's `sources:` list.
 *
 * Directory entries (`- path: EnterpriseShellTests`) are skipped: they are the test
 * files themselves, which SwiftPM picks up through its own test target. Only the
 * individual source files — the port being compiled into the bundle — are compared.
 */
function xcodeGenSources(text) {
  const lines = text.split("\n");
  const targetLine = lines.findIndex((l) => /^\s{2}EnterpriseShellTests:\s*$/.test(l));
  if (targetLine === -1) {
    throw new Error(`${PROJECT_YML}: no target named "${XCODE_TARGET}"`);
  }
  const targetIndent = lines[targetLine].search(/\S/);

  let inSources = false;
  const files = new Set();
  for (let i = targetLine + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S/);
    if (indent <= targetIndent) break; // left the target
    if (/^\s+sources:\s*$/.test(line)) {
      inSources = true;
      continue;
    }
    if (inSources) {
      const entry = line.match(/^\s+-\s+path:\s*(\S+)\s*$/);
      if (entry) {
        if (entry[1].endsWith(".swift")) files.add(entry[1]);
        continue;
      }
      // Any other key at the target's child level ends the sources block.
      if (/^\s+\w[\w-]*:/.test(line)) inSources = false;
    }
  }
  if (files.size === 0) {
    throw new Error(
      `${PROJECT_YML}: target "${XCODE_TARGET}" listed no .swift source files. ` +
        `Either the target changed shape or this parser did; both need a human.`,
    );
  }
  return files;
}

function compare(swift, xcode) {
  const onlySwift = [...swift].filter((f) => !xcode.has(f)).sort();
  const onlyXcode = [...xcode].filter((f) => !swift.has(f)).sort();
  return { onlySwift, onlyXcode, ok: onlySwift.length === 0 && onlyXcode.length === 0 };
}

/**
 * Negative controls. A comparison that cannot fail proves nothing, so before trusting
 * a pass we check that this one actually catches each direction of drift. The
 * expectations here are written out independently — they do not ask `compare` what it
 * thinks, they state what a divergence is.
 */
function selfTest() {
  const cases = [
    {
      name: "identical lists agree",
      a: ["A.swift", "B.swift"],
      b: ["A.swift", "B.swift"],
      expectOk: true,
    },
    {
      name: "a file added only to SwiftPM is caught",
      a: ["A.swift", "B.swift"],
      b: ["A.swift"],
      expectOk: false,
    },
    {
      name: "a file added only to XcodeGen is caught",
      a: ["A.swift"],
      b: ["A.swift", "B.swift"],
      expectOk: false,
    },
    {
      name: "a file renamed on one side only is caught",
      a: ["A.swift", "B.swift"],
      b: ["A.swift", "Bee.swift"],
      expectOk: false,
    },
    {
      name: "order does not matter",
      a: ["B.swift", "A.swift"],
      b: ["A.swift", "B.swift"],
      expectOk: true,
    },
  ];
  let failed = 0;
  for (const c of cases) {
    const got = compare(new Set(c.a), new Set(c.b)).ok;
    const pass = got === c.expectOk;
    if (!pass) failed += 1;
    console.log(`  ${pass ? "ok" : "FAIL"} — ${c.name}`);
  }
  // Plus one control on the parsers: a manifest with no sources array must throw,
  // not return an empty set that trivially matches an empty set.
  try {
    swiftPackageSources(`.target(name: "${SWIFT_TARGET}", path: "EnterpriseShell")`);
    console.log("  FAIL — a SwiftPM target with no sources: array was accepted");
    failed += 1;
  } catch {
    console.log("  ok — a SwiftPM target with no sources: array throws");
  }
  try {
    xcodeGenSources("targets:\n  EnterpriseShellTests:\n    type: bundle.unit-test\n");
    console.log("  FAIL — an XcodeGen target with no .swift sources was accepted");
    failed += 1;
  } catch {
    console.log("  ok — an XcodeGen target with no .swift sources throws");
  }
  return failed;
}

function main() {
  if (process.argv.includes("--self-test")) {
    console.log("check-ios-port-sources self-test:");
    const failed = selfTest();
    console.log(failed === 0 ? "self-test: pass" : `self-test: ${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const swift = swiftPackageSources(readFileSync(join(REPO, PACKAGE_SWIFT), "utf8"));
  const xcode = xcodeGenSources(readFileSync(join(REPO, PROJECT_YML), "utf8"));
  const { onlySwift, onlyXcode, ok } = compare(swift, xcode);

  console.log(`  ${PACKAGE_SWIFT} → ${swift.size} port source(s)`);
  console.log(`  ${PROJECT_YML}   → ${xcode.size} port source(s)`);

  if (ok) {
    console.log(`  ✓ both build systems compile the same ${swift.size} port sources`);
    // The self-test runs on every invocation, not only under a flag: a gate whose
    // teeth are checked only when someone remembers to check them has no teeth.
    const failed = selfTest();
    if (failed !== 0) {
      console.error(`\nFAIL: ${failed} negative control(s) did not fire — this gate is not proving anything.`);
      process.exit(1);
    }
    return;
  }

  console.error("\nFAIL: the two build systems no longer compile the same port sources.");
  if (onlySwift.length) {
    console.error(`\n  In ${PACKAGE_SWIFT} but not ${PROJECT_YML}:`);
    for (const f of onlySwift) console.error(`    ${f}`);
    console.error(`  → the macOS run covers these; the iOS simulator run does not.`);
  }
  if (onlyXcode.length) {
    console.error(`\n  In ${PROJECT_YML} but not ${PACKAGE_SWIFT}:`);
    for (const f of onlyXcode) console.error(`    ${f}`);
    console.error(`  → the iOS simulator run covers these; the macOS run does not.`);
  }
  console.error("\nAdd the missing entries to the other manifest so both lanes test the same code.");
  process.exit(1);
}

main();
