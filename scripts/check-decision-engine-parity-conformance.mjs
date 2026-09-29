#!/usr/bin/env node
// Decision-engine parity conformance — the Swift replay must stay bound to the shared vectors.
//
// Sibling of `scripts/check-remediation-allow-conformance.mjs`, same reasoning. The TS side
// is pinned by `proof:decision-engine-parity`, which emits and byte-checks
// `native/shared/decision-engine-vectors.json`. The Swift side is
// `native/ios/EnterpriseShellTests/DecisionEngineParityTests.swift`, which only ios-ci's
// macOS jobs run — so until the cloud review of #1118 nothing on Linux bound the two:
// deleting that test, gutting it, or pointing it at another file stayed green in every
// Linux gate. This gate requires the test to exist, load the vectors by a quoted literal
// outside a comment (a doc comment naming the file does not count), replay through
// `DecisionEngine.evaluate`, and assert.
//
// NOT established by a green here: that the port AGREES with the TS engine. This gate
// reads no Swift semantics; the XCTest replaying every case in ios-ci argues behaviour.
//
//   node scripts/check-decision-engine-parity-conformance.mjs [--self-test]

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SWIFT_TEST = "native/ios/EnterpriseShellTests/DecisionEngineParityTests.swift";

/** What is wrong with the Swift test's binding; `text` is null when the file is missing. */
function bindingProblems(text) {
  if (text === null) return [`${SWIFT_TEST} is missing — nothing replays the vectors in Swift`];
  const code = text.replace(/\/\/.*$/gm, ""); // comments never count as a binding
  const problems = [];
  if (!/"[^"\n]*decision-engine-vectors\.json"/.test(code)) problems.push("does not load decision-engine-vectors.json by a quoted literal");
  if (!/DecisionEngine\.evaluate\(/.test(code)) problems.push("never calls DecisionEngine.evaluate( — the cases are not replayed through the port");
  if (!/XCTAssert/.test(code)) problems.push("carries no XCTAssert — a replay that asserts nothing proves nothing");
  return problems;
}

function selfTest() {
  const good = 'let p = "shared/decision-engine-vectors.json"\nlet r = DecisionEngine.evaluate(signals)\nXCTAssertEqual(r.allOutcomes, e)';
  const cases = [
    ["the real shape passes", good, true],
    ["a missing test file is caught", null, false],
    ["a test naming ANOTHER vectors file is caught", good.replace("decision-engine-vectors", "remediation-allow-vectors"), false],
    ["the vectors named only in a comment is caught", good.replace('let p = "', '/// reads "'), false],
    ["a test that never calls DecisionEngine.evaluate is caught", good.replace("DecisionEngine.evaluate(", "DecisionEngine.describe("), false],
    ["a test with no XCTAssert is caught", good.replace("XCTAssertEqual", "print"), false],
  ];
  let failed = 0;
  for (const [label, text, expectOk] of cases) {
    const pass = (bindingProblems(text).length === 0) === expectOk;
    if (!pass) failed += 1;
    console.log(`  ${pass ? "ok" : "FAIL"} — ${label}`);
  }
  console.log(failed === 0 ? `self-test: ${cases.length}/${cases.length} pass` : `self-test: ${failed} FAILED`);
  return failed;
}

// The gate's own teeth, on every run rather than only under the flag.
console.log("check-decision-engine-parity-conformance self-test:");
if (selfTest() !== 0) {
  console.error("\nFAIL: a negative control did not fire — this gate proves nothing.");
  process.exit(1);
}
if (process.argv.includes("--self-test")) process.exit(0);

const path = join(REPO, SWIFT_TEST);
const problems = bindingProblems(existsSync(path) ? readFileSync(path, "utf8") : null);
if (problems.length) {
  console.error(`\nFAIL: ${SWIFT_TEST} is not bound to the shared decision-engine vectors:`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`\nDecision-engine parity conformance passed — ${SWIFT_TEST} loads decision-engine-vectors.json, replays through DecisionEngine.evaluate, and asserts.`);
