#!/usr/bin/env node
// Every #[test] in a Rust crate must have actually RUN — the cargo twin of
// scripts/check-android-core-tests.mjs.
//
//   node scripts/check-desktop-core-tests.mjs <crate-dir> <cargo-test-log>
//   node scripts/check-desktop-core-tests.mjs --self-test
//
// WHY. `test result: ok.` is printed by a run that executed zero tests as happily as
// by one that executed forty-one, and the CI floors that guarded against that were
// TYPED: desktop.yml failed only below 30 while the suite held 41, firmware.yml below
// 20 while it held 28. A typed floor is a fossil the day a test is added, and a floor
// eleven tests under the water line lets eleven tests vanish unnoticed.
//
// WHAT IT COMPARES. The expected count is DERIVED from the source — every `#[test]`
// attribute under <crate-dir>/src and <crate-dir>/tests — and the actual count is the
// sum of `N passed` over every `test result:` line in the log of the run that just
// happened. `#[ignore]` tests are subtracted (they are declared, not run) and reported;
// tests behind a `#[cfg(...)]` in the same attribute block are reported separately and
// allowed to be absent (they may not build on this platform), never allowed to fail.
// Add a test and this expects it automatically. Write one that never runs and this says
// so, by count.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function rsFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) rsFiles(p, out);
    else if (e.name.endsWith(".rs")) out.push(p);
  }
  return out;
}

/** Pure: count #[test] attributes in one source text, split by ignore / cfg-gated. */
export function countTests(text) {
  const lines = text.split("\n");
  let declared = 0;
  let ignored = 0;
  let cfgGated = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*#\[test\]/.test(lines[i])) continue;
    declared += 1;
    // The contiguous attribute block around this #[test].
    let lo = i;
    while (lo > 0 && /^\s*#\[/.test(lines[lo - 1])) lo -= 1;
    let hi = i;
    while (hi + 1 < lines.length && /^\s*#\[/.test(lines[hi + 1])) hi += 1;
    const block = lines.slice(lo, hi + 1).join("\n");
    if (/#\[ignore\b/.test(block)) ignored += 1;
    if (/#\[cfg\(/.test(block)) cfgGated += 1;
  }
  return { declared, ignored, cfgGated };
}

/** Pure: totals over every `test result:` line cargo printed. */
export function countRan(log) {
  let passed = 0;
  let failed = 0;
  let ignoredRan = 0;
  let lines = 0;
  for (const m of log.matchAll(/^test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored;/gm)) {
    lines += 1;
    passed += Number(m[1]);
    failed += Number(m[2]);
    ignoredRan += Number(m[3]);
  }
  return { passed, failed, ignoredRan, lines };
}

/** Pure verdict, so the self-test drives the same comparison the gate does. */
export function audit(counts, ran) {
  const problems = [];
  if (ran.lines === 0) problems.push("the log holds no `test result:` line — cargo test did not run, or the log is not its output");
  if (counts.declared === 0) problems.push("ZERO #[test] attributes found in the crate — the detector is stale, or the tests were deleted");
  if (ran.failed > 0) problems.push(`${ran.failed} test(s) failed`);
  const mustRun = counts.declared - counts.ignored - counts.cfgGated;
  const mayRun = counts.declared - counts.ignored;
  if (ran.passed < mustRun) {
    problems.push(`${ran.passed} test(s) passed but ${mustRun} were declared and unconditional (${counts.declared} #[test], ${counts.ignored} #[ignore], ${counts.cfgGated} cfg-gated) — ${mustRun - ran.passed} did not run`);
  }
  if (ran.passed > mayRun) {
    // Doc-tests can add to the total; more than declared is reported, not fatal.
    console.log(`  note: ${ran.passed} passed exceeds the ${mayRun} runnable #[test] attributes (doc-tests?) — reported, not fatal.`);
  }
  return problems;
}

function selfTest() {
  const src = `
#[test]
fn a() {}
#[test]
#[ignore]
fn b() {}
#[cfg(unix)]
#[test]
fn c() {}
#[cfg(test)]
mod tests {
    #[test]
    fn d() {}
}
`;
  const c = countTests(src);
  const checks = [];
  checks.push(["#[test] attributes are counted, ignore and cfg split out", c.declared === 4 && c.ignored === 1 && c.cfgGated === 1]);
  const ok = countRan("running 3 tests\ntest result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out\n");
  checks.push(["a run of every unconditional test passes", audit(c, ok).length === 0]);
  checks.push(["the cfg-gated test may be absent (2 ran of 2 unconditional)", audit(c, countRan("test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured\n")).length === 0]);
  checks.push(["ONE MISSING TEST IS CAUGHT — the gate's whole purpose", audit(c, countRan("test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured\n")).some((p) => p.includes("did not run"))]);
  checks.push(["a failure is caught even when the count matches", audit(c, countRan("test result: FAILED. 3 passed; 1 failed; 0 ignored; 0 measured\n")).some((p) => p.includes("failed"))]);
  checks.push(["a log with no test result line is caught", audit(c, countRan("Compiling foo\n")).some((p) => p.includes("no `test result:`"))]);
  checks.push(["zero declared tests is caught, never a vacuous pass", audit(countTests("fn main() {}"), ok).some((p) => p.includes("ZERO"))]);
  checks.push(["totals sum across several result lines (unit + integration + doc)", countRan("test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured\n").passed === 3]);
  const failed = checks.filter(([, k]) => !k);
  for (const [name, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const [crateRel, logRel] = process.argv.slice(2);
if (!crateRel || !logRel) {
  console.error("usage: node scripts/check-desktop-core-tests.mjs <crate-dir> <cargo-test-log>   (or --self-test)");
  process.exit(2);
}
const crate = resolve(repo, crateRel);
const logPath = resolve(repo, logRel);
if (!existsSync(join(crate, "Cargo.toml"))) {
  console.error(`✗ ${crateRel} has no Cargo.toml`);
  process.exit(1);
}
if (!existsSync(logPath) || !statSync(logPath).isFile()) {
  console.error(`✗ no cargo test log at ${logRel} — the run did not happen, or its output was not captured`);
  process.exit(1);
}

const files = [...rsFiles(join(crate, "src")), ...rsFiles(join(crate, "tests"))];
const counts = { declared: 0, ignored: 0, cfgGated: 0 };
for (const f of files) {
  const c = countTests(readFileSync(f, "utf8"));
  counts.declared += c.declared;
  counts.ignored += c.ignored;
  counts.cfgGated += c.cfgGated;
}
const ran = countRan(readFileSync(logPath, "utf8"));

console.log(`Rust ${crateRel} — every #[test] in the source must have run\n`);
console.log(`  source files:      ${files.length}`);
console.log(`  #[test] declared:  ${counts.declared}`);
console.log(`  #[ignore]:         ${counts.ignored}  (declared, not run — reported)`);
console.log(`  cfg-gated:         ${counts.cfgGated}  (may be absent on this platform — reported)`);
console.log(`  passed in the log: ${ran.passed}  (${ran.lines} result line(s))`);
console.log(`  failed in the log: ${ran.failed}`);

const problems = audit(counts, ran);
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error("\n  A suite that did not run is not a suite that passed.");
  process.exit(1);
}
console.log(`\nRust test gate passed (${crateRel}) — ${ran.passed} ran of ${counts.declared - counts.ignored} runnable #[test] declared, 0 failures.`);
