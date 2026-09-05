#!/usr/bin/env node
// Posture-allow conformance — the shared vectors must hold somebody to something.
//
// Sibling of `scripts/check-remediation-allow-conformance.mjs`, same shape, same
// reasoning: a shared vector file only does its job if implementations consume it.
// This one guards `native/shared/posture-allow-vectors.json`, the table that pins
// whether an `allow` the simulator engine offered survives contact with the posture
// evidence it was granted on (eighth verdict-core round, 2026-09-05: the engine reads
// posture attributes only for their known-bad members, so `compliance: "unknown"`
// allows).
//
// WHAT IS GATED, because it is unambiguous:
//   1. the vector file exists, parses, and satisfies the floor IT declares — minCases,
//      every declared host outcome, state and reason code present, unique ids, a
//      stated `why` on every case. (`requires.minCases` moves WITH the table; the
//      independent brake on shrinkage is `scripts/check-proof-counts.mjs`.)
//   2. it is non-vacuous in both directions: some case must expect `allow`, and some
//      case must withhold one.
//   3. the TypeScript proof binds to the file BY PATH, and the module it describes
//      exists.
//
// WHAT IS REPORTED, not gated, and said out loud: the Swift twin. The lane order is
// the one `remediation-allow` used — the cloud lane writes the TS wrapper and proof
// first (the wrapper's shape is a design decision), the Mac lane ports the Swift twin
// second against these pinned vectors. Until it lands, a correctly-sequenced build
// must not fail on its absence; the gate prints PENDING by name so the gap is never
// silent. When it lands, flip `SWIFT_TWIN_REQUIRED` to true in the same change — the
// remediation gate's header records that exact transition.
//
//   node scripts/check-posture-allow-conformance.mjs [--self-test]

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const VECTORS = "native/shared/posture-allow-vectors.json";
const TS_PROOF = "scripts/src/posture-allow-proof.ts";
const TS_SOURCE = "lib/signalgrid-simulator/src/posture-allow.ts";
const SWIFT_TWIN = "native/ios/EnterpriseShell/Services/PostureAllow.swift";
const NATIVE_ROOT = "native";
/** Flip to true in the change that lands the Swift twin. */
const SWIFT_TWIN_REQUIRED = false;

function walk(dir, out = []) {
  const SKIP = new Set(["build", "target", ".gradle", "node_modules", ".build", "DerivedData"]);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function validateVectors(doc) {
  const problems = [];
  const cases = doc?.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    problems.push("`cases` is missing or empty — there is nothing to conform to");
    return problems;
  }
  const requires = doc.requires ?? {};
  if (typeof requires.minCases !== "number") {
    problems.push("`requires.minCases` is missing — the file states no floor for itself");
  } else if (cases.length < requires.minCases) {
    problems.push(`${cases.length} cases, below the file's own floor of ${requires.minCases}`);
  }
  if (typeof doc.rule !== "string" || doc.rule.length < 80) {
    problems.push("`rule` is missing or too short — a vector table nobody can read the rule off is a table nobody can review");
  }
  if (!doc.postureBearing || typeof doc.postureBearing !== "object" || Object.keys(doc.postureBearing).length === 0) {
    problems.push("`postureBearing` is missing — a twin cannot know which signal types and attributes to judge");
  }
  const outcomes = cases.map((c) => c.expectOutcome);
  for (const outcome of requires.outcomesPresent ?? []) {
    if (!outcomes.includes(outcome)) problems.push(`no case expects host outcome "${outcome}"`);
  }
  if (!outcomes.includes("allow")) problems.push("no case is expected to ALLOW, so a client hardcoded to STEP_UP would pass every case");
  if (!cases.some((c) => c.expectAllowWithheld === true)) problems.push("no case withholds an offered allow, so a client hardcoded to pass-through would pass");
  const states = cases.map((c) => c.expectState);
  for (const state of requires.statesPresent ?? []) {
    if (!states.includes(state)) problems.push(`no case exercises posture state "${state}"`);
  }
  const reasons = cases.map((c) => c.expectReasonCode);
  for (const reason of requires.reasonCodesPresent ?? []) {
    if (!reasons.includes(reason)) problems.push(`no case expects reason code "${reason}"`);
  }
  const ids = cases.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) problems.push(`duplicate case ids: ${[...new Set(dupes)].join(", ")}`);
  for (const c of cases) {
    if (!c.id) problems.push("a case has no id");
    if (!c.why) problems.push(`case ${c.id}: no "why"`);
    if (!Array.isArray(c.engineOutcomes)) problems.push(`case ${c.id}: engineOutcomes must be an array`);
    if (!Array.isArray(c.signals)) problems.push(`case ${c.id}: signals must be an array`);
    if (typeof c.expectAllowWithheld !== "boolean") problems.push(`case ${c.id}: expectAllowWithheld must be a boolean`);
    if (c.expectOutcome === "allow" && c.expectAllowWithheld === true) problems.push(`case ${c.id}: expects allow AND claims the allow was withheld`);
  }
  return problems;
}

function selfTest() {
  const good = {
    rule: "x".repeat(120),
    postureBearing: { "device.posture_observed": { required: { compliance: "compliant" }, optional: {} } },
    requires: { minCases: 2, outcomesPresent: ["allow", "step_up"], statesPresent: ["affirmed", "unaffirmed"], reasonCodesPresent: ["POSTURE_AFFIRMED", "ALLOW_WITHHELD_POSTURE_UNAFFIRMED"] },
    cases: [
      { id: "a", why: "w", engineOutcomes: ["allow"], signals: [], expectState: "affirmed", expectOutcome: "allow", expectReasonCode: "POSTURE_AFFIRMED", expectAllowWithheld: false },
      { id: "b", why: "w", engineOutcomes: ["allow"], signals: [], expectState: "unaffirmed", expectOutcome: "step_up", expectReasonCode: "ALLOW_WITHHELD_POSTURE_UNAFFIRMED", expectAllowWithheld: true },
    ],
  };
  const cases = [
    ["a well-formed file passes", good, true],
    ["a file with no ALLOW case is caught", { ...good, cases: [good.cases[1]] }, false],
    ["a file where no case withholds is caught", { ...good, cases: [good.cases[0]] }, false],
    ["a file below its own floor is caught", { ...good, requires: { ...good.requires, minCases: 99 } }, false],
    ["an empty case list is caught", { ...good, cases: [] }, false],
    ["duplicate ids are caught", { ...good, cases: [...good.cases, { ...good.cases[0] }] }, false],
    ["an unexercised declared state is caught", { ...good, requires: { ...good.requires, statesPresent: [...good.requires.statesPresent, "absent"] } }, false],
    ["an unexercised declared reason code is caught", { ...good, requires: { ...good.requires, reasonCodesPresent: [...good.requires.reasonCodesPresent, "POSTURE_ABSENT"] } }, false],
    ["a missing postureBearing table is caught", { ...good, postureBearing: {} }, false],
    ["a self-contradicting case is caught", { ...good, cases: [...good.cases, { id: "d", why: "w", engineOutcomes: ["allow"], signals: [], expectState: "affirmed", expectOutcome: "allow", expectReasonCode: "POSTURE_AFFIRMED", expectAllowWithheld: true }] }, false],
    ["a missing rule sentence is caught", { ...good, rule: "short" }, false],
  ];
  let failed = 0;
  for (const [label, doc, expectOk] of cases) {
    const ok = validateVectors(doc).length === 0;
    const pass = ok === expectOk;
    if (!pass) failed += 1;
    console.log(`  ${pass ? "ok" : "FAIL"} — ${label}`);
  }
  return failed;
}

function main() {
  if (process.argv.includes("--self-test")) {
    console.log("check-posture-allow-conformance self-test:");
    const failed = selfTest();
    console.log(failed === 0 ? "self-test: pass" : `self-test: ${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }
  const vectorsPath = join(REPO, VECTORS);
  if (!existsSync(vectorsPath)) {
    console.error(`FAIL: the shared posture-allow vectors are missing at ${VECTORS}.`);
    process.exit(1);
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(vectorsPath, "utf8"));
  } catch (err) {
    console.error(`FAIL: ${VECTORS} does not parse as JSON: ${err.message}`);
    process.exit(1);
  }
  const problems = validateVectors(doc);
  if (problems.length) {
    console.error(`FAIL: ${VECTORS} would not hold an implementation to anything:\n`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  const allowCases = doc.cases.filter((c) => c.expectOutcome === "allow").length;
  const withheldCases = doc.cases.filter((c) => c.expectAllowWithheld === true).length;
  console.log(`  ✓ ${VECTORS}: ${doc.cases.length} cases, ${allowCases} grant, ${withheldCases} withhold an offered allow`);

  const proofPath = join(REPO, TS_PROOF);
  if (!existsSync(proofPath) || !readFileSync(proofPath, "utf8").includes(VECTORS)) {
    console.error(`\nFAIL: ${TS_PROOF} does not reference ${VECTORS} — the table would be a document nothing runs.`);
    process.exit(1);
  }
  if (!existsSync(join(REPO, TS_SOURCE))) {
    console.error(`\nFAIL: ${TS_SOURCE} is missing — the vectors describe a module that is not there.`);
    process.exit(1);
  }
  console.log(`  ✓ ${TS_PROOF} binds to the vectors; ${TS_SOURCE} is the module under test`);

  const nativeFiles = existsSync(join(REPO, NATIVE_ROOT)) ? walk(join(REPO, NATIVE_ROOT)) : [];
  const bound = nativeFiles.filter((f) => {
    if (!/\.(swift|kt|rs|java)$/.test(f)) return false;
    if (!/[Tt]est/.test(relative(REPO, f))) return false;
    const txt = readFileSync(f, "utf8");
    return /["'][^"']*posture-allow-vectors\.json["']/.test(txt) && /XCTAssert|#\[test\]|@Test|assert\(/.test(txt);
  });
  const twinPresent = existsSync(join(REPO, SWIFT_TWIN));
  if (twinPresent && bound.length > 0) {
    console.log(`  ✓ Swift twin present; ${bound.length} native test(s) bound: ${bound.map((f) => relative(REPO, f)).join(", ")}`);
  } else if (SWIFT_TWIN_REQUIRED) {
    console.error(`\nFAIL: the Swift twin ${SWIFT_TWIN} is ${twinPresent ? "present but no native TEST consumes the vectors" : "missing"}.`);
    process.exit(1);
  } else {
    console.log(
      `  ~ PENDING (reported, not fatal): Swift twin ${SWIFT_TWIN} ${twinPresent ? "present but unbound" : "not yet ported"} — ` +
        `the Mac lane ports it against ${VECTORS}; flip SWIFT_TWIN_REQUIRED when it lands`,
    );
  }
  console.log("Posture-allow conformance: pass");
}

main();
