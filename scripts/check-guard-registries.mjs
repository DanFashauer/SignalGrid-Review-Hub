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

// WHAT WE ARE DETECTING, stated precisely because getting it slightly wrong has
// now cost this repo twice: `check-proof-figures.mjs` parses a stdout LINE THAT
// STARTS WITH `figures=`. Statically, "start of a line" inside a string literal
// is one of three things — the start of the literal, a `\n` ESCAPE inside it, or
// a real newline inside a template literal. All three are permitted here.
//
// Two failures are recorded in this pattern, both the same root cause:
//
//   1. It was anchored to `console.log(` on ONE line, so a proof that wrapped its
//      call read as "publishes no figures". `proof:iac` does exactly that, so it
//      sat in the figure guard's PROOFS registry while this scanner reported it
//      absent. The two printed totals disagreed (16 vs 17) and the check still
//      exited 0, because nothing compared them. `\s*` and /s fixed that, and the
//      reverse-direction check below was added so the totals could never disagree
//      in silence again.
//
//   2. It required `figures=` to be the FIRST characters of the literal, so the
//      extremely ordinary `` `\nfigures=…` `` — a blank line before the block —
//      was invisible. FOUR proofs write it that way. Only one of them
//      (`proof:signalgrid-core`) was caught, and only because the reverse check
//      from failure 1 fired on it. The other three — credential-rotation,
//      local-authority, observability-integrity — were undetected AND
//      unregistered, and those two errors CANCEL: this scanner said nothing at
//      all while three proofs published figures no guard was checking. A blind
//      spot that lines up with a gap in the registry is silent by construction,
//      which is why the controls below exist rather than another careful read.
const FIGURES_EMISSION = /console\.log\(\s*[`"'](?:\\n|\s)*figures=/s;

// Negative and positive controls for the detector itself. A regex nobody has
// watched fail is indistinguishable from a comment — and this one has been wrong
// twice while looking correct both times.
const DETECTOR_CONTROLS = [
  { expect: true, name: "single-line", src: "console.log(`figures=a=1`);" },
  { expect: true, name: "wrapped call", src: "console.log(\n  `figures=a=1`,\n);" },
  { expect: true, name: "leading \\n escape", src: "console.log(\n  `\\nfigures=a=1`,\n);" },
  { expect: true, name: "real newline in template", src: "console.log(`\n\nfigures=a=1`);" },
  { expect: true, name: "double-quoted", src: 'console.log("\\nfigures=a=1");' },
  // The comment shape below is real: `webauthn-enrollment-race-proof.ts` explains
  // in prose why it deliberately does NOT emit a figures= line. Detecting that as
  // an emission would register a Redis-gated proof with the figure guard and turn
  // a green sweep red on every machine without a Redis.
  { expect: false, name: "prose mention", src: "// Deliberately NOT a `figures=` line." },
  { expect: false, name: "mid-line, not line start", src: "console.log(`summary=figures=nope`);" },
  { expect: false, name: "not a console.log", src: "const s = `figures=a=1`;" },
];
const controlFailures = DETECTOR_CONTROLS.filter((c) => FIGURES_EMISSION.test(c.src) !== c.expect);
if (controlFailures.length > 0) {
  console.error("✗ the figures= detector failed its own controls — it cannot be trusted to scan:");
  for (const c of controlFailures) {
    console.error(`    ${c.expect ? "missed" : "false-matched"}: ${c.name}`);
  }
  process.exit(1);
}

const files = readdirSync(proofDir).filter((f) => f.endsWith("-proof.ts"));
const usesGrantSafety = [];
const emitsFigures = [];
for (const f of files) {
  const text = readFileSync(join(proofDir, f), "utf8");
  if (text.includes("enumerateGrantSafety")) usesGrantSafety.push(proofNameOf(f));
  if (FIGURES_EMISSION.test(text)) emitsFigures.push(proofNameOf(f));
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

// THE REVERSE DIRECTION, and the reason the printed numbers could disagree in
// silence. Every check above is "detected ⊆ registered": a proof that emits
// figures must be registered. Nothing asserted "registered ⊆ detected", so a
// registration whose proof this scanner does not SEE emitting was invisible —
// which is precisely how the multi-line `figures=` blind spot above survived.
//
// This is the assertion the printed totals imply and never made. It is not
// circular: the left side is a scan of the source tree, the right side is a
// hand-maintained registry in a DIFFERENT file, and neither is derived from the
// other. (Asserting `figureCovered.size === 17` against a literal WOULD be
// circular — that is the fossil class this file exists to prevent.)
for (const proof of figureCovered) {
  if (emitsFigures.includes(proof)) continue;
  console.error(`\n✗ ${proof} is registered with the figure guard, but no \`figures=\` emission was detected in its source.`);
  console.error("  Either the registration is stale (the proof stopped publishing figures and the");
  console.error("  figure guard is now checking nothing for it), or THIS scanner's detector missed");
  console.error("  the emission — check for a wrapped `console.log(\\n  `figures=…`)` before");
  console.error("  assuming the registry is at fault.");
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
