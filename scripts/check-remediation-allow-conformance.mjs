#!/usr/bin/env node
// Remediation-allow conformance — the shared vectors must hold somebody to something.
//
// Sibling of `scripts/check-assist-conformance.mjs`, same shape, same reasoning: a
// shared vector file only does its job if implementations actually consume it. This
// one guards `native/shared/remediation-allow-vectors.json`, the table that pins
// whether an `allow` the simulator engine offered survives contact with the
// remediation record.
//
// WHY IT IS A SEPARATE FILE FROM THE ASSIST GATE. The assist gate derives its client
// list from `native/*/core` and FAILS on any that is unwired. That rule is correct
// for the Assist wire, which three clients already implement, and wrong for this
// file, which has exactly one implementation today (TypeScript) and a second that
// has not been written yet. Pointing the assist gate at this file would have failed
// on Android and Rust for not implementing a rule nobody asked them to.
//
// WHAT IS GATED, because it is unambiguous:
//   1. the vector file exists, parses, and satisfies the floor IT declares —
//      minCases, every declared host outcome, state and reason code present, unique
//      ids, a stated `why` on every case.
//
//      BE PRECISE ABOUT WHAT THAT FLOOR IS WORTH. `requires.minCases` is written by
//      the generator as `vectors.length`, so it moves WITH the table: it catches a
//      HAND-EDIT that deletes cases from the committed file, and it cannot catch the
//      table itself shrinking, because the floor shrinks with it. The independent
//      brake on shrinkage is `scripts/check-proof-counts.mjs` — the docs advertise
//      `proof:remediation-allow` (115 checks), the gate re-runs the proof and compares,
//      and dropping vectors drops the check count and fails there. Two cases removed
//      from the generator is a red build in the counts gate, not here.
//   2. it is non-vacuous in the direction that matters: some case must expect
//      `allow`, or a client hardcoded to `step_up` would pass the whole table;
//   3. the TypeScript proof binds to the file BY PATH, so the table cannot become a
//      document nothing executes.
//
// WHAT IS NOW GATED: the SWIFT twin. It has landed (mac/remediation-allow-swift-twin —
// `native/ios/EnterpriseShell/Services/RemediationAllow.swift` plus its XCTest bound to
// this table). The lane order was agreed in `artifacts/lane-messages/`: the cloud lane
// wrote the TS wrapper and proof first because the wrapper's shape is a design decision,
// and the Mac lane ported the Swift twin second against these pinned vectors. While the
// port was pending this rule was REPORTED, not fatal, so a correctly-sequenced build
// would not fail on its absence. Now that it is here, its presence and its binding to
// the shared file are REQUIRED — deleting the twin, or a test that stops reading the
// pinned file by path, fails this gate rather than drifting back to a TS-only rule. This
// gate argues the twin is bound; the Swift XCTest argues its behaviour matches.
//
//   node scripts/check-remediation-allow-conformance.mjs [--self-test]

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const VECTORS = "native/shared/remediation-allow-vectors.json";
const TS_PROOF = "scripts/src/remediation-allow-proof.ts";
const TS_SOURCE = "lib/signalgrid-simulator/src/remediation-allow.ts";
const SWIFT_TWIN = "native/ios/EnterpriseShell/Services/RemediationAllow.swift";
const NATIVE_ROOT = "native";

/** Every file under `dir`, skipping build output. */
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

/**
 * Validate the vector file against the floor IT declares, never a floor pinned here.
 * A file that shrinks below its own stated minimum is a suite that quietly stopped
 * proving things, and a floor written in the gate would have to be edited in lockstep
 * with the table — two lists that must agree, which is the fossil shape.
 */
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

  const outcomes = cases.map((c) => c.expectOutcome);
  for (const outcome of requires.outcomesPresent ?? []) {
    if (!outcomes.includes(outcome)) {
      problems.push(`no case expects host outcome "${outcome}" — a client answering the same way to everything would pass`);
    }
  }
  // Stated separately from the loop above so that trimming `outcomesPresent` cannot
  // remove it. This is the one that kills the trivial client.
  if (!outcomes.includes("allow")) {
    problems.push("no case is expected to ALLOW, so a client hardcoded to STEP_UP would pass every case");
  }
  if (!outcomes.some((o) => o !== "allow")) {
    problems.push("every case expects ALLOW, so a client hardcoded to ALLOW would pass — the withholding is unproven");
  }

  const states = cases.map((c) => c.expectState);
  for (const state of requires.statesPresent ?? []) {
    if (!states.includes(state)) problems.push(`no case exercises remediation state "${state}"`);
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
    if (!c.why) problems.push(`case ${c.id}: no "why" — a case nobody can justify is a case nobody can review`);
    if (!Array.isArray(c.engineOutcomes)) problems.push(`case ${c.id}: engineOutcomes must be an array`);
    if (typeof c.asOf !== "string") problems.push(`case ${c.id}: asOf must be an ISO string — the twin reads no clock`);
    if (typeof c.expectAllowWithheld !== "boolean") problems.push(`case ${c.id}: expectAllowWithheld must be a boolean`);
    if (c.expectOutcome === "allow" && c.expectAllowWithheld === true) {
      problems.push(`case ${c.id}: expects allow AND claims the allow was withheld — the case contradicts itself`);
    }
  }
  return problems;
}

function selfTest() {
  const good = {
    rule: "x".repeat(120),
    requires: {
      minCases: 2,
      outcomesPresent: ["allow", "step_up"],
      statesPresent: ["verified", "illegible"],
      reasonCodesPresent: ["REMEDIATION_VERIFIED", "REMEDIATION_STATE_ILLEGIBLE"],
    },
    cases: [
      { id: "a", why: "w", engineOutcomes: ["allow"], asOf: "2026-06-09T14:05:00.000Z", expectState: "verified", expectOutcome: "allow", expectReasonCode: "REMEDIATION_VERIFIED", expectAllowWithheld: false },
      { id: "b", why: "w", engineOutcomes: ["allow"], asOf: "2026-06-09T14:05:00.000Z", expectState: "illegible", expectOutcome: "step_up", expectReasonCode: "REMEDIATION_STATE_ILLEGIBLE", expectAllowWithheld: true },
    ],
  };
  const cases = [
    ["a well-formed file passes", good, true],
    ["a file with no ALLOW case is caught (the vacuity trap)", { ...good, cases: [good.cases[1]] }, false],
    ["a file where EVERY case allows is caught (the other vacuity trap)", { ...good, cases: [good.cases[0]] }, false],
    ["a file below its own declared floor is caught", { ...good, requires: { ...good.requires, minCases: 99 } }, false],
    ["an empty case list is caught", { ...good, cases: [] }, false],
    ["duplicate ids are caught", { ...good, cases: [...good.cases, { ...good.cases[0] }] }, false],
    ["an unexercised declared state is caught", { ...good, requires: { ...good.requires, statesPresent: [...good.requires.statesPresent, "stale"] } }, false],
    ["an unexercised declared reason code is caught", { ...good, requires: { ...good.requires, reasonCodesPresent: [...good.requires.reasonCodesPresent, "REMEDIATION_EVIDENCE_STALE"] } }, false],
    ["a case with no justification is caught", { ...good, cases: [...good.cases, { id: "c", engineOutcomes: [], asOf: "x", expectState: "absent", expectOutcome: "deny", expectReasonCode: "R", expectAllowWithheld: false }] }, false],
    ["a self-contradicting case (allow AND withheld) is caught", { ...good, cases: [...good.cases, { id: "d", why: "w", engineOutcomes: ["allow"], asOf: "x", expectState: "verified", expectOutcome: "allow", expectReasonCode: "REMEDIATION_VERIFIED", expectAllowWithheld: true }] }, false],
    ["a missing rule sentence is caught", { ...good, rule: "short" }, false],
    ["removing allow from outcomesPresent does NOT let a step_up-only file pass", { rule: "x".repeat(120), requires: { minCases: 1, outcomesPresent: ["step_up"] }, cases: [good.cases[1]] }, false],
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
    console.log("check-remediation-allow-conformance self-test:");
    const failed = selfTest();
    console.log(failed === 0 ? "self-test: pass" : `self-test: ${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const vectorsPath = join(REPO, VECTORS);
  if (!existsSync(vectorsPath)) {
    console.error(`FAIL: the shared remediation-allow vectors are missing at ${VECTORS}.`);
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
  console.log(
    `  ✓ ${VECTORS}: ${doc.cases.length} cases, ${allowCases} grant, ${withheldCases} withhold an offered allow`,
  );

  // GATED: the TypeScript side must bind to the file by path.
  const proofPath = join(REPO, TS_PROOF);
  if (!existsSync(proofPath) || !readFileSync(proofPath, "utf8").includes(VECTORS)) {
    console.error(
      `\nFAIL: ${TS_PROOF} does not reference ${VECTORS}.\n` +
        `The vector table has to be executed by the TypeScript proof, or it is a document\n` +
        `nothing runs — which is exactly the state the Swift twin would then be ported to.`,
    );
    process.exit(1);
  }
  if (!existsSync(join(REPO, TS_SOURCE))) {
    console.error(`\nFAIL: ${TS_SOURCE} is missing — the vectors describe a module that is not there.`);
    process.exit(1);
  }
  console.log(`  ✓ ${TS_PROOF} binds to the vectors; ${TS_SOURCE} is the module under test`);

  // GATED: the Swift twin has landed (mac/remediation-allow-swift-twin), so its
  // presence AND its binding to the shared table are now required — the transition this
  // gate's header always described ("when the Swift twin lands, the REPORTED line becomes
  // a GATED one"). Deleting the twin, or a test that stops reading the shared file by
  // path, now fails here instead of drifting silently back to a TypeScript-only rule.
  const nativeFiles = existsSync(join(REPO, NATIVE_ROOT)) ? walk(join(REPO, NATIVE_ROOT)) : [];
  if (!existsSync(join(REPO, SWIFT_TWIN))) {
    console.error(
      `\nFAIL: the Swift twin ${SWIFT_TWIN} is missing.\n` +
        `It landed against these vectors and must not vanish. If it is being retired on\n` +
        `purpose, retire this Swift assertion in the same change and say so here.`,
    );
    process.exit(1);
  }
  // A real binding is a TEST that CONSUMES the table, not a doc comment that names it —
  // so require a test-path file that references the pinned file AND carries an assertion.
  // (RemediationAllow.swift mentions the path in its header comment; that must not count.)
  const bound = nativeFiles.filter((f) => {
    if (!/\.(swift|kt|rs|java)$/.test(f)) return false;
    if (!/[Tt]est/.test(relative(REPO, f))) return false;
    const txt = readFileSync(f, "utf8");
    // The path must appear as a QUOTED string literal (the actual load), not only in a
    // backtick/prose doc comment, and the file must carry an assertion — so a comment
    // that merely names the pinned file cannot satisfy the binding.
    const loadsByLiteral = /["'\''][^"'\'']*remediation-allow-vectors\.json["'\'']/.test(txt);
    const asserts = /XCTAssert|#\[test\]|@Test|assert\(/.test(txt);
    return loadsByLiteral && asserts;
  });
  if (bound.length === 0) {
    console.error(
      `\nFAIL: ${SWIFT_TWIN} exists but no native TEST consumes ${VECTORS}.\n` +
        `A twin unbound from the shared table is a port that no longer proves it matches\n` +
        `the canonical — a test must read the pinned file by path and assert on it, the way\n` +
        `the TypeScript proof does. A doc comment naming the file does not count.`,
    );
    process.exit(1);
  }
  console.log(`  ✓ Swift twin present; ${bound.length} native client(s) bound: ${bound.map((f) => relative(REPO, f)).join(", ")}`);

  // The gate's own teeth, on every run rather than only under a flag.
  const failed = selfTest();
  if (failed !== 0) {
    console.error(`\nFAIL: ${failed} negative control(s) did not fire — this gate proves nothing.`);
    process.exit(1);
  }

  console.log(`\nRemediation-allow conformance passed — ${doc.cases.length} shared cases, TS bound, Swift twin bound.`);
  console.log(`
  NOT established by a green here:
    · that the vectors are RIGHT. They are generated from the TypeScript wrapper, so a
      case that misreads the product would be wrong in the wrapper and in the file at
      once, and consistently. \`pnpm run proof:remediation-allow\` is what argues the
      wrapper's behaviour; this gate argues the table's shape and its bindings.
    · that the Swift twin's LOGIC matches the canonical. This gate proves the twin exists
      and is bound to the shared table by path; whether its behaviour agrees is argued by
      the Swift XCTest suite (RemediationAllowTests) running every case in the iOS/macOS CI
      jobs — not by this Node gate, which reads no Swift semantics.
    · that the ENGINE was fixed. It was not, deliberately: DecisionEngine.swift is a
      byte-faithful port of decisionEngine.ts (CLAUDE.md golden rule 1), so the rule
      lives around the engine on both sides, not inside it.`);
}

// Run only as an entrypoint, so another script can import `validateVectors` without
// firing the gate as a side effect.
const IS_MAIN =
  process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (IS_MAIN) main();
