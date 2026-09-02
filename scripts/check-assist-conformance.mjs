#!/usr/bin/env node
// Every Assist client must run the shared conformance vectors.
//
// WHY. `native/shared/assist-wire-conformance.json` only does its job if the clients
// actually consume it. A client that quietly stops reading the file keeps its own
// hand-written tests, keeps passing, and stops being held to the shared expectation —
// and nothing about that is visible in a green run. That is the failure this gate
// exists to make loud.
//
// It caught two real defects on the day the file was introduced, both in the Kotlin
// client, both invisible to that client's own suite:
//   · `RESTRICT.proceedsWithoutFurtherAction` returned true, so a host app would have
//     carried on at FULL capability on a restrict decision, discarding the ceiling.
//   · `parse()` accepted "stepup" and "step-up" as STEP_UP, which is strictly more
//     permissive than denying an unrecognised value.
//
// SCOPE IS DERIVED. The client list is not written down here — it is every
// `native/*/core` directory on disk. Adding `native/whatever/core` without wiring the
// vectors fails this gate, which is the point: the next client is bound by default
// rather than by somebody remembering.
//
//   node scripts/check-assist-conformance.mjs [--self-test]

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const VECTORS = "native/shared/assist-wire-conformance.json";
const CLIENT_ROOT = "native";
const VALID_OUTCOMES = ["allow", "step_up", "restrict", "deny"];
/** How far `cases.length` may run ahead of `requires.minCases` before the gate fails. */
const FLOOR_SLACK = 4;
/**
 * Every key a case may carry — exactly the keys the two harnesses READ
 * (`case["…"]` in native/android/core/src/test/kotlin/.../SharedConformanceTest.kt,
 * `case.get("…")`/`case["…"]` in native/desktop/core/tests/conformance.rs). Any other
 * key is a typo or a field no client consumes, and either way it is a vector that
 * binds nothing while looking like one: `expectObligation` (no s) on the one case
 * that carries it left every gate green, because both harnesses treat the field as
 * opt-in by key presence. Add a key here only when a harness starts reading it.
 */
const KNOWN_CASE_KEYS = ["id", "why", "status", "body", "expect", "expectExplanationContains", "expectObligations"];

/** Every `native/<platform>/core` directory. Derived, not listed. */
function discoverClients() {
  const root = join(REPO, CLIENT_ROOT);
  return readdirSync(root)
    .map((p) => join(CLIENT_ROOT, p, "core"))
    .filter((p) => existsSync(join(REPO, p)) && statSync(join(REPO, p)).isDirectory())
    .sort();
}

/** Every file under `dir`, skipping build output that would make this slow and noisy. */
function walk(dir, out = []) {
  const SKIP = new Set(["build", "target", ".gradle", "node_modules", ".build"]);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Validate the vector file against the floor IT declares, rather than a floor pinned
 * here. A file that shrinks below its own stated minimum is a suite that quietly
 * stopped proving things.
 */
function validateVectors(doc) {
  const problems = [];
  const cases = doc.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    problems.push("`cases` is missing or empty — there is nothing to conform to");
    return problems;
  }
  const requires = doc.requires ?? {};
  if (typeof requires.minCases !== "number") {
    problems.push("`requires.minCases` is missing — the file states no floor for itself");
  } else if (cases.length < requires.minCases) {
    problems.push(`${cases.length} cases, below the file's own floor of ${requires.minCases}`);
  } else if (cases.length > requires.minCases + FLOOR_SLACK) {
    // The floor must be KEPT CURRENT, not merely satisfied. It sat at 30 while the
    // file held 44, and at that distance deleting a vector failed nothing — a floor
    // fourteen cases below the water line is a floor in name only. Not equality:
    // a batch may add a few cases before the number is raised, but not many.
    problems.push(
      `${cases.length} cases, but requires.minCases is ${requires.minCases} — more than ${FLOOR_SLACK} ` +
        `behind. Raise the floor to ${cases.length}; a floor that lags lets a deleted vector fail nothing`,
    );
  }

  const expects = cases.map((c) => c.expect);
  for (const outcome of requires.outcomesPresent ?? VALID_OUTCOMES) {
    if (!expects.includes(outcome)) {
      problems.push(
        `no case expects "${outcome}" — a client that answers the same way to ` +
          `everything would pass this file`,
      );
    }
  }
  // The one that kills the trivial client. Stated separately from the loop above so
  // that trimming `outcomesPresent` cannot remove it.
  if (!expects.includes("allow")) {
    problems.push("no case is expected to ALLOW, so a client hardcoded to DENY would pass");
  }

  const ids = cases.map((c) => c.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dupes.length) problems.push(`duplicate case ids: ${[...new Set(dupes)].join(", ")}`);

  // The opt-in assertions must be OPTED INTO somewhere: a file where no case carries
  // `expectObligations` is a file that asserts nothing about parsed obligations, and
  // the served-shape case exists precisely to assert "empty", not merely "step_up".
  const withObligations = cases.filter((c) => c.expectObligations !== undefined).length;
  if (withObligations === 0) {
    problems.push("no case carries expectObligations — the parsed-obligations assertion is opted into by nobody");
  }

  for (const c of cases) {
    for (const key of Object.keys(c)) {
      if (!KNOWN_CASE_KEYS.includes(key)) {
        problems.push(
          `case ${c.id ?? "(no id)"}: unknown key "${key}" — no harness reads it (known: ${KNOWN_CASE_KEYS.join(", ")}). ` +
            `A misspelled assertion key is a vector that binds nothing while looking like one`,
        );
      }
    }
    if (!c.id) problems.push("a case has no id");
    if (!VALID_OUTCOMES.includes(c.expect)) {
      problems.push(`case ${c.id}: expect "${c.expect}" is not one of ${VALID_OUTCOMES.join("/")}`);
    }
    if (typeof c.status !== "number") problems.push(`case ${c.id}: status must be a number`);
    if (c.body !== null && typeof c.body !== "string") {
      problems.push(`case ${c.id}: body must be a string or null`);
    }
    if (!c.why) problems.push(`case ${c.id}: no "why" — a case nobody can justify is a case nobody can review`);
    if (c.expectObligations !== undefined) {
      if (!Array.isArray(c.expectObligations) || c.expectObligations.some((o) => typeof o !== "string")) {
        problems.push(`case ${c.id}: expectObligations must be an array of strings`);
      }
    }
  }
  return problems;
}

function selfTest() {
  const good = {
    requires: { minCases: 2, outcomesPresent: VALID_OUTCOMES },
    cases: [
      { id: "a", why: "w", status: 200, body: '{"assist":"allow"}', expect: "allow", expectObligations: [] },
      { id: "b", why: "w", status: 200, body: null, expect: "deny" },
      { id: "c", why: "w", status: 200, body: '{"assist":"step_up"}', expect: "step_up" },
      { id: "d", why: "w", status: 200, body: '{"assist":"restrict"}', expect: "restrict" },
    ],
  };
  const cases = [
    ["a well-formed file passes", good, true],
    [
      "a file with no ALLOW case is caught (the vacuity trap)",
      { ...good, cases: good.cases.filter((c) => c.expect !== "allow") },
      false,
    ],
    [
      "a file below its own declared floor is caught",
      { ...good, requires: { ...good.requires, minCases: 99 } },
      false,
    ],
    ["an empty case list is caught", { ...good, cases: [] }, false],
    [
      "duplicate ids are caught",
      { ...good, cases: [...good.cases, { ...good.cases[0] }] },
      false,
    ],
    [
      "an unknown outcome name is caught",
      { ...good, cases: [...good.cases, { id: "e", why: "w", status: 200, body: "{}", expect: "maybe" }] },
      false,
    ],
    [
      "a case with no justification is caught",
      { ...good, cases: [...good.cases, { id: "f", status: 200, body: "{}", expect: "deny" }] },
      false,
    ],
    [
      "a floor more than FLOOR_SLACK behind the case count is caught (the floor must be kept current)",
      {
        ...good,
        requires: { ...good.requires, minCases: 1 },
        cases: [
          ...good.cases,
          ...[1, 2, 3, 4, 5].map((i) => ({ id: `pad${i}`, why: "w", status: 500, body: null, expect: "deny" })),
        ],
      },
      false,
    ],
    [
      "a floor within FLOOR_SLACK of the case count is fine (not equality)",
      { ...good, requires: { ...good.requires, minCases: 2 } },
      true,
    ],
    [
      "a non-list expectObligations is caught",
      { ...good, cases: [...good.cases, { id: "g", why: "w", status: 200, body: "{}", expect: "deny", expectObligations: "webauthn" }] },
      false,
    ],
    [
      "THE REVIEWER'S TYPO: expectObligation (no s) is an unknown key and is caught",
      {
        ...good,
        cases: good.cases.map((c) => (c.id === "a" ? { id: c.id, why: c.why, status: c.status, body: c.body, expect: c.expect, expectObligation: [] } : c)),
      },
      false,
    ],
    [
      "a file in which NO case carries expectObligations is caught (the assertion is opted into by nobody)",
      { ...good, cases: good.cases.map(({ expectObligations, ...rest }) => rest) },
      false,
    ],
    [
      "removing allow from outcomesPresent does NOT let a deny-only file pass",
      {
        requires: { minCases: 1, outcomesPresent: ["deny"] },
        cases: [{ id: "a", why: "w", status: 500, body: null, expect: "deny" }],
      },
      false,
    ],
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
    console.log("check-assist-conformance self-test:");
    const failed = selfTest();
    console.log(failed === 0 ? "self-test: pass" : `self-test: ${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  }

  const vectorsPath = join(REPO, VECTORS);
  if (!existsSync(vectorsPath)) {
    console.error(`FAIL: the shared conformance vectors are missing at ${VECTORS}.`);
    process.exit(1);
  }
  const doc = JSON.parse(readFileSync(vectorsPath, "utf8"));

  const problems = validateVectors(doc);
  if (problems.length) {
    console.error(`FAIL: ${VECTORS} would not hold a client to anything:\n`);
    for (const p of problems) console.error(`  · ${p}`);
    process.exit(1);
  }
  console.log(`  ✓ ${VECTORS}: ${doc.cases.length} cases, all four outcomes, ${
    doc.cases.filter((c) => c.expect === "allow").length
  } proceedable, ${doc.cases.filter((c) => c.expectObligations !== undefined).length} asserting parsed obligations, ` +
    `every key one of ${KNOWN_CASE_KEYS.length} the harnesses read`);

  const clients = discoverClients();
  if (clients.length === 0) {
    console.error(`FAIL: found no client under ${CLIENT_ROOT}/*/core. Either the tree moved or this gate did.`);
    process.exit(1);
  }

  const unwired = [];
  for (const client of clients) {
    const files = walk(join(REPO, client));
    const consumer = files.find((f) => {
      if (!/\.(kt|rs|swift|ts|mjs|js|java)$/.test(f)) return false;
      return readFileSync(f, "utf8").includes("assist-wire-conformance.json");
    });
    if (consumer) {
      console.log(`  ✓ ${client} → ${relative(REPO, consumer)}`);
    } else {
      unwired.push(client);
    }
  }

  if (unwired.length) {
    console.error(
      `\nFAIL: ${unwired.length} Assist client(s) do not run the shared conformance vectors:\n`,
    );
    for (const c of unwired) console.error(`  · ${c}`);
    console.error(
      `\nEach client must have a test that reads ${VECTORS} and asserts its own parser\n` +
        `agrees with every case. Without it that client is held only to tests written in\n` +
        `its own language, which is how two clients disagree while both stay green.`,
    );
    process.exit(1);
  }

  // The gate's own teeth, checked on every run rather than only under a flag.
  const failed = selfTest();
  if (failed !== 0) {
    console.error(`\nFAIL: ${failed} negative control(s) did not fire — this gate proves nothing.`);
    process.exit(1);
  }
  console.log(`\nAssist conformance gate passed — ${clients.length} client(s) bound to ${doc.cases.length} shared cases.`);
  // A status is not a diagnosis. State what a green run here does NOT establish, so
  // the pass is not read as broader than it is.
  console.log(`
  NOT established by a green here:
    · that the clients' tests actually RAN. This checks each client has a test that
      reads the vectors; the language-specific lanes (\`gradle test\`, \`cargo test\`)
      are what execute them.
    · iOS. \`native/ios\` has no \`core\` directory and is not scanned. The old reason
      here ("EnterpriseShell ports the decision engine rather than consuming /v1")
      went stale when RemoteDecisionService landed: the shell now DOES consume /v1
      (POST /v1/app-workflows/evaluate — a DEFERRED route, fenced under the
      gateway profile, so that wire is served only on the review-demo surface;
      DR-007 records both unserved wires honestly). The engine port is still
      covered by \`scripts/check-decision-port-parity.mjs\`; bringing the iOS wire
      envelope under shared vectors is follow-on work, stated rather than implied
      done. And note what a green run here proves: the Kotlin and Rust SDKs agree
      about the Assist wire (/v1/authorize — declared a gap by DR-007, served since DR-023) — served-ness is
      \`scripts/check-assist-wire-served.mjs\`'s question, not this gate's.
    · the TypeScript source of truth in \`lib/\`, which is what the vectors were
      written FROM. A case that misreads the product would be wrong in every client
      at once, and consistently.`);
}

main();
