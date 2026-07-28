// Registry-drift guard — the guards' own coverage lists must not fall behind.
//
// `mutation-guard.mjs` and `check-proof-figures.mjs` each carry a hand-maintained list of
// what they cover. That is the same shape as the defect that put this file here: the
// no-fallthrough check in `incident-playbook-proof.ts` restated `SignalKind` by hand and
// drifted FIVE kinds behind, leaving five dimensions' incident routing ungated until an
// adversarial review happened to look. `SignalKind` is now derived from a runtime array so
// that particular list cannot drift — and then the fix introduced two more hand-maintained
// lists, which is exactly how this class of defect propagates.
//
// The uncomfortable version: a guard whose coverage list is stale is WORSE than no guard,
// because it reports success over the part it has stopped looking at. `guard:mutations`
// printing "0 survivors" says nothing at all about a connector nobody added to TARGETS.
//
// So this derives the expected coverage from the code rather than trusting a list:
//
//   - Any proof importing `enumerateGrantSafety` is enumerating an ALLOW PATH. Its
//     connector must be registered with the mutation guard, or excluded here with a
//     reason. That is the population where an unfalsifiable guard is most dangerous.
//   - Any proof printing a `figures=` line is publishing measurements the docs may quote.
//     It must be registered with the figure guard, or those figures are unguarded.
//
// It runs in milliseconds and reads no proof output, so it belongs in preflight even
// though the full mutation sweep — one proof run per mutation, per registered file —
// deliberately does not. (That count is deliberately NOT written here: a hard-coded
// sweep size is exactly the fossil figure this file exists to prevent, and it went
// stale the moment the queued connectors were registered.)

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TARGETS } from "./mutation-guard.mjs";
import { PROOFS } from "./check-proof-figures.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const proofDir = join(repoRoot, "scripts", "src");

/** Allow-path proofs deliberately NOT under the mutation guard, each with a reason a
 *  reader can check. Kept deliberately short: every entry is coverage this repo has
 *  chosen not to have, and that choice should be uncomfortable to add to. */
const MUTATION_EXCLUDED = [
  {
    proof: "proof:grant-safety",
    reason:
      "It IS the harness, not a connector — it has no normalizer or evaluator to mutate, and it already ships its own negative controls (deliberately too-strict and too-loose predicates, each asserted to be caught).",
  },
];

/** `<name>-proof.ts` → `proof:<name>`, the script name the guards register. */
const proofNameOf = (file) => `proof:${file.replace(/-proof\.ts$/, "")}`;

const files = readdirSync(proofDir).filter((f) => f.endsWith("-proof.ts"));
const usesGrantSafety = [];
const emitsFigures = [];
for (const f of files) {
  const text = readFileSync(join(proofDir, f), "utf8");
  if (text.includes("enumerateGrantSafety")) usesGrantSafety.push(proofNameOf(f));
  if (/console\.log\(`figures=/.test(text)) emitsFigures.push(proofNameOf(f));
}

const mutationCovered = new Set(TARGETS.map((t) => t.proof));
const excluded = new Map(MUTATION_EXCLUDED.map((e) => [e.proof, e.reason]));
const figureCovered = new Set(PROOFS);

console.log("Guard-registry drift check — the guards' coverage lists, derived not trusted\n");
console.log(`  allow-path proofs (import enumerateGrantSafety): ${usesGrantSafety.length}`);
console.log(`  proofs publishing figures=:                      ${emitsFigures.length}`);
console.log(`  mutation-guard targets:                          ${mutationCovered.size}`);
console.log(`  figure-guard registrations:                      ${figureCovered.size}`);

let failures = 0;

for (const proof of usesGrantSafety) {
  if (mutationCovered.has(proof) || excluded.has(proof)) continue;
  console.error(`\n✗ ${proof} enumerates an allow path but is NOT registered with the mutation guard.`);
  console.error("  Add it to TARGETS in scripts/mutation-guard.mjs, or to MUTATION_EXCLUDED here");
  console.error("  with a reason. Silence is not an option: 0 survivors would then be reported");
  console.error("  over a connector nobody looked at.");
  failures += 1;
}

for (const proof of emitsFigures) {
  if (figureCovered.has(proof)) continue;
  console.error(`\n✗ ${proof} publishes a \`figures=\` line but is NOT registered with the figure guard.`);
  console.error("  Add it to PROOFS in scripts/check-proof-figures.mjs, or those figures can be");
  console.error("  quoted in docs and go stale unnoticed.");
  failures += 1;
}

// A registration pointing at a proof that no longer exists is drift in the other
// direction — the guard is spending time on nothing and its coverage count lies.
const allProofs = new Set(files.map(proofNameOf));
for (const proof of [...mutationCovered, ...figureCovered, ...excluded.keys()]) {
  if (allProofs.has(proof)) continue;
  console.error(`\n✗ a guard registry names "${proof}", which no longer exists.`);
  failures += 1;
}

const queued = MUTATION_EXCLUDED.filter((e) => e.reason.startsWith("QUEUED"));
if (queued.length > 0) {
  console.log(`\n  ${queued.length} allow-path proofs are QUEUED for mutation sweeping, not waived:`);
  for (const q of queued) console.log(`    · ${q.proof}`);
  console.log("  Stated here so partial coverage is never mistaken for full coverage.");
}

if (failures > 0) {
  console.error(`\nRegistry drift check FAILED: ${failures} unregistered or dangling entr${failures === 1 ? "y" : "ies"}.`);
  process.exit(1);
}

console.log("\nRegistry drift check passed — every allow-path proof and every published figure is accounted for.");
