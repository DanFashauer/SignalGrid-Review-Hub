#!/usr/bin/env node
// Every @Test in the Android core module must have actually RUN.
//
//   node scripts/check-android-core-tests.mjs                     # native/android/core
//   node scripts/check-android-core-tests.mjs native/android/app   # the app module's JVM tests
//
// WHY. `gradle test` prints BUILD SUCCESSFUL over a run that executed eleven tests
// and over a run that executed zero, identically. Gradle skips the `test` task when
// it believes nothing changed, skips silently when a source set stops being picked
// up, and reports success when a filter matches nothing. Each of those leaves a
// green CI job standing over a suite that did not run — the shape this repository
// keeps finding, here pre-empted rather than discovered later.
//
// WHAT IT COMPARES. Not a pinned total: a number typed here would go stale the first
// time someone adds a test, and the usual fix (bump the number) trains people to
// treat the gate as bureaucracy. It derives the expected set from the SOURCE — every
// `@Test`-annotated function in the module — and checks each one appears in the JUnit
// XML the runner wrote. Add a test and this expects it automatically. Write a test
// that never runs and this says so, by name.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// The module is an ARGUMENT so the app module's JVM tests (DeviceGateTest, the one
// Android-side security decision) get the same declared-vs-ran comparison the core
// gets, instead of "find | head -1 exists". Gradle writes plain-JVM results to
// build/test-results/test and Android unit tests to build/test-results/testDebugUnitTest
// (one per variant), so every TEST-*.xml under build/test-results is read.
const MODULE_REL = process.argv[2] ?? "native/android/core";
const MODULE = join(repo, MODULE_REL);
const SRC = join(MODULE, "src/test/kotlin");
const RESULTS = join(MODULE, "build/test-results");

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

// ── Expected: every @Test in the Kotlin sources ───────────────────────────────
function kotlinFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...kotlinFiles(p));
    else if (e.name.endsWith(".kt")) out.push(p);
  }
  return out;
}

const sources = kotlinFiles(SRC);
if (sources.length === 0) {
  fail(`no Kotlin test sources under ${SRC.replace(repo + "/", "")} — the detector is stale, or the tests were deleted.`);
  process.exit(1);
}

// Kotlin test names are usually backtick-quoted sentences. Match both spellings.
const expected = new Set();
for (const file of sources) {
  const text = readFileSync(file, "utf8");
  const re = /@Test[\s\S]{0,200}?fun\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) expected.add(m[1] ?? m[2]);
}

if (expected.size === 0) {
  fail("found Kotlin test sources but ZERO @Test functions in them — refusing to call that a passing suite.");
  process.exit(1);
}

// ── Actual: what the runner recorded ──────────────────────────────────────────
if (!existsSync(RESULTS)) {
  fail(
    `no JUnit results at ${RESULTS.replace(repo + "/", "")}.\n` +
      "  The test task did not run, or ran without writing results. A green gradle\n" +
      "  exit code alone does not establish that any test executed.",
  );
  process.exit(1);
}

function resultXml(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...resultXml(p));
    else if (e.name.startsWith("TEST-") && e.name.endsWith(".xml")) out.push(p);
  }
  return out;
}
const xml = resultXml(RESULTS);
if (xml.length === 0) {
  fail(`${RESULTS.replace(repo + "/", "")} exists but holds no TEST-*.xml files.`);
  process.exit(1);
}

const ran = new Set();
let failures = 0;
let skipped = 0;
for (const f of xml) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/<testcase\b[^>]*\bname="([^"]*)"/g)) {
    // Gradle records Kotlin backtick names with a trailing "()".
    ran.add(m[1].replace(/\(\)$/, ""));
  }
  for (const m of text.matchAll(/<testsuite\b[^>]*>/g)) {
    const tag = m[0];
    failures += Number(/\bfailures="(\d+)"/.exec(tag)?.[1] ?? 0);
    failures += Number(/\berrors="(\d+)"/.exec(tag)?.[1] ?? 0);
    skipped += Number(/\bskipped="(\d+)"/.exec(tag)?.[1] ?? 0);
  }
}

console.log(`Android ${MODULE_REL} — every @Test in the source must have run\n`);
console.log(`  test sources:      ${sources.length}`);
console.log(`  @Test declared:    ${expected.size}`);
console.log(`  testcases recorded: ${ran.size}`);
console.log(`  failures/errors:   ${failures}`);
console.log(`  skipped:           ${skipped}`);

const missing = [...expected].filter((n) => !ran.has(n));
if (missing.length > 0) {
  fail(`${missing.length} declared test(s) produced no result — they did not run:`);
  for (const n of missing) console.error(`      ${n}`);
}
if (failures > 0) fail(`${failures} test failure(s)/error(s) recorded.`);
// Skips are reported but not fatal — a deliberately ignored test is a decision, and
// the count above makes it visible rather than letting it hide inside a total.
if (skipped > 0) console.log(`\n  note: ${skipped} skipped — visible on purpose, not folded into the pass count.`);

if (process.exitCode) {
  console.error("\n  A suite that did not run is not a suite that passed.");
  process.exit(1);
}
console.log(`\nAndroid test gate passed (${MODULE_REL}) — ${expected.size}/${expected.size} declared tests ran, 0 failures.`);
