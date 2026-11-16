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

/**
 * Pure: every `@Test` function a Kotlin source declares, and whether it is `@Ignore`d.
 *
 * WHY @Ignore IS PARSED (fixed 2026-09-06). Gradle writes a `<testcase>` element for an
 * ignored test, with a `<skipped/>` child. The old reading counted that element as
 * "ran", so a suite in which EVERY test was `@Ignore`d printed
 * "N/N declared tests ran, 0 failures" and exited 0 — reproduced against a synthetic
 * module with two `@Test @Ignore` functions and a JUnit XML marking both `<skipped/>`.
 * The header's thesis is "a suite that did not run is not a suite that passed"; the
 * success line asserted the opposite. The Rust twin (check-desktop-core-tests.mjs)
 * already subtracts `#[ignore]` and says "N ran of M runnable".
 *
 * Both annotation orders are honoured — `@Ignore` above or below `@Test` — because
 * either is legal Kotlin and a rule that sees only one spelling is a rule you can walk
 * around by accident.
 */
export function declaredTests(text) {
  const out = [];
  const re = /@Test([\s\S]{0,200}?)fun\s+(?:`([^`]+)`|([A-Za-z_][A-Za-z0-9_]*))\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 160), m.index);
    // Only annotations attached to THIS declaration: stop at the previous `fun`/`}`.
    const attached = before.split(/\bfun\b|\}/).pop() ?? "";
    const ignored = /@Ignore\b/.test(attached) || /@Ignore\b/.test(m[1]);
    out.push({ name: m[2] ?? m[3], ignored });
  }
  return out;
}

/**
 * Pure: what the runner RECORDED, per testcase. A `<testcase>` carrying `<skipped/>` is
 * a test that did not run, and is kept apart from one that did.
 */
export function parseResults(xmlText) {
  const ran = new Set();
  const skipped = new Set();
  for (const m of xmlText.matchAll(/<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1])?.[1];
    if (name === undefined) continue;
    // Gradle records Kotlin backtick names with a trailing "()".
    const clean = name.replace(/\(\)$/, "");
    if (/<skipped\b/.test(m[3] ?? "")) skipped.add(clean);
    else ran.add(clean);
  }
  return { ran, skipped };
}

// ── self-test: runs on EVERY invocation ──────────────────────────────────────
// Not behind a flag, because this gate runs only in the Android CI job (android.yml)
// and a flag nobody registers is a self-test nobody runs.
{
  const src = [
    "class T {",
    "  @Test fun `a runs`() {}",
    "  @Test",
    "  @Ignore(\"flaky\")",
    "  fun `b is ignored`() {}",
    "  @Ignore",
    "  @Test",
    "  fun `c is ignored the other way round`() {}",
    "}",
  ].join("\n");
  const decl = declaredTests(src);
  const xml =
    '<testsuite tests="3" failures="0" errors="0" skipped="2">' +
    '<testcase name="a runs()" classname="T"/>' +
    '<testcase name="b is ignored()" classname="T"><skipped/></testcase>' +
    '<testcase name="c is ignored the other way round()" classname="T"><skipped/></testcase>' +
    "</testsuite>";
  const res = parseResults(xml);
  const st = [
    ["three declarations are found", decl.length === 3],
    ["an unannotated @Test is not ignored", decl[0].ignored === false],
    ["@Ignore BELOW @Test is seen", decl[1].ignored === true],
    ["@Ignore ABOVE @Test is seen", decl[2].ignored === true],
    ["a plain testcase counts as RAN", res.ran.has("a runs")],
    ["A SKIPPED TESTCASE IS NOT A TESTCASE THAT RAN", !res.ran.has("b is ignored") && res.skipped.has("b is ignored")],
    ["the skipped set carries both ignored tests", res.skipped.size === 2],
  ];
  const bad = st.filter(([, ok]) => !ok);
  if (bad.length > 0) {
    for (const [label] of bad) console.error(`✗ SELF-TEST: ${label}`);
    console.error("  The declaration or result parser has drifted; refusing to judge a suite with it.");
    process.exit(1);
  }
}

// Kotlin test names are usually backtick-quoted sentences. Match both spellings.
const declarations = [];
for (const file of sources) declarations.push(...declaredTests(readFileSync(file, "utf8")));
const expected = new Set(declarations.map((d) => d.name));
const ignoredInSource = new Set(declarations.filter((d) => d.ignored).map((d) => d.name));
const runnable = [...expected].filter((n) => !ignoredInSource.has(n));

if (expected.size === 0) {
  fail("found Kotlin test sources but ZERO @Test functions in them — refusing to call that a passing suite.");
  process.exit(1);
}
if (runnable.length === 0) {
  fail(`all ${expected.size} declared @Test function(s) are @Ignore'd — there is no suite here to pass.`);
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
const skippedNames = new Set();
let failures = 0;
let skippedAttr = 0;
for (const f of xml) {
  const text = readFileSync(f, "utf8");
  const parsed = parseResults(text);
  for (const n of parsed.ran) ran.add(n);
  for (const n of parsed.skipped) skippedNames.add(n);
  for (const m of text.matchAll(/<testsuite\b[^>]*>/g)) {
    const tag = m[0];
    failures += Number(/\bfailures="(\d+)"/.exec(tag)?.[1] ?? 0);
    failures += Number(/\berrors="(\d+)"/.exec(tag)?.[1] ?? 0);
    skippedAttr += Number(/\bskipped="(\d+)"/.exec(tag)?.[1] ?? 0);
  }
}

console.log(`Android ${MODULE_REL} — every @Test in the source must have run\n`);
console.log(`  test sources:       ${sources.length}`);
console.log(`  @Test declared:     ${expected.size}`);
console.log(`  @Ignore'd in source: ${ignoredInSource.size}`);
console.log(`  runnable:           ${runnable.length}`);
console.log(`  testcases that RAN: ${ran.size}`);
console.log(`  testcases SKIPPED:  ${skippedNames.size}`);
console.log(`  failures/errors:    ${failures}`);

// A declared test that is neither @Ignore'd in source nor present as a RUN testcase did
// not run — whether it is absent from the XML or present with a <skipped/> child. Those
// were the same thing to the old reading, and the second one is the one that passed.
const missing = runnable.filter((n) => !ran.has(n));
if (missing.length > 0) {
  fail(`${missing.length} runnable test(s) did not run (absent from the results, or recorded as skipped):`);
  for (const n of missing) console.error(`      ${n}${skippedNames.has(n) ? "   [recorded <skipped/>]" : "   [no result at all]"}`);
}
if (failures > 0) fail(`${failures} test failure(s)/error(s) recorded.`);
if (ran.size === 0) fail("ZERO testcases actually ran — every recorded case was skipped.");

// PARSER-DRIFT CONTROL, REPORTED. The per-testcase count and the <testsuite skipped="">
// attribute are two independent readings of the same fact; if they disagree, one of the
// two parses is wrong and the verdict above rests on the first.
if (skippedAttr !== skippedNames.size) {
  console.log(
    `\n  note (REPORTED): testsuite skipped="${skippedAttr}" but ${skippedNames.size} testcase(s) carry <skipped/> —` +
      " the two readings disagree; the per-testcase reading is what was gated.",
  );
}
// REPORTED, not gated: an @Ignore'd test is a recorded decision, and naming it keeps it
// from hiding inside a total.
for (const n of ignoredInSource) console.log(`  · ${n}: @Ignore'd in source — not expected to run`);

if (process.exitCode) {
  console.error("\n  A suite that did not run is not a suite that passed.");
  process.exit(1);
}
console.log(
  `\nAndroid test gate passed (${MODULE_REL}) — ${ran.size} ran of ${runnable.length} runnable ` +
    `(${expected.size} declared, ${ignoredInSource.size} @Ignore'd, ${skippedNames.size} skipped), 0 failures.`,
);
