#!/usr/bin/env node
/**
 * The mutation sweep is sharded across CI runners. This gate proves the sharder
 * PARTITIONS the registry — every target lands in exactly one shard, for every
 * shard count the lane might plausibly use.
 *
 * WHY THIS IS A GATE AND NOT A COMMENT. A sharder that drops a target does not
 * fail; it reports success over work it never did. That is the precise failure
 * the mutation guard exists to catch, and putting it in the SCHEDULER would put
 * it somewhere the mutation guard cannot see. The sweep takes forty minutes, so
 * nobody re-runs it to check the split; this runs in milliseconds because
 * `mutationsFor` parses text and executes no proof.
 *
 * Balance is REPORTED, never gated. The spread depends on how lumpy the registry
 * happens to be, and a threshold on it would fail the build for a defensible
 * distribution — a flaky gate gets switched off, and this one is worth keeping.
 */
import { TARGETS, shardTargets, mutationsFor, MUTATORS, lineMutations } from "./mutation-guard.mjs";

let passed = 0;
const failures = [];
const check = (name, ok) => { if (ok) { passed += 1; console.log(`  ok — ${name}`); } else { failures.push(name); console.error(`  FAIL — ${name}`); } };

console.log("Mutation sharding — the split must lose nothing\n");

for (const n of [1, 2, 3, 4, 8, TARGETS.length, TARGETS.length + 3]) {
  const seen = [];
  for (let i = 0; i < n; i += 1) seen.push(...shardTargets(TARGETS, i, n).map((t) => t.proof));
  const unique = new Set(seen);
  check(`N=${n}: every target appears, exactly once (${seen.length} placements, ${unique.size} distinct)`,
    seen.length === TARGETS.length && unique.size === TARGETS.length);
}

// DETERMINISM IS LOAD-BEARING and easy to miss. Each shard runs in its own CI job
// on its own runner, and each computes the partition independently from the same
// registry — nothing communicates the split between them. If two runners disagreed
// about which targets belong to shard 2, some targets would be swept twice and
// others never, and the lane would still report every job green. The agreement is
// implicit, so it is asserted here rather than assumed.
//
// WHAT THIS DOES AND DOES NOT PROVE. It compares repeated computations over the
// same registry, so it catches genuine nondeterminism — a `Math.random`, a clock,
// an environment read — which is the class that would actually desynchronise two
// runners, and the class this repository forbids in decided paths anyway. It does
// NOT prove order-independence, because it cannot: every shard reads the same
// TARGETS from the same commit, so input order is a constant across the matrix and
// order-independence is not a property correctness needs here. Stated because a
// check named "determinism" invites being read as proving more than it does.
for (const n of [3, 4]) {
  const once = shardTargets(TARGETS, 1, n).map((t) => t.proof).join("|");
  const again = shardTargets(TARGETS, 1, n).map((t) => t.proof).join("|");
  const third = shardTargets([...TARGETS], 1, n).map((t) => t.proof).join("|");
  check(`N=${n}: shard 1 is identical across independent computations, in order`,
    once === again && once === third);
}

// Falsification: the guard must reject shard arguments that cannot describe a partition.
for (const [i, n] of [[0, 0], [2, 2], [-1, 3], [1.5, 3]]) {
  let threw = false;
  try { shardTargets(TARGETS, i, n); } catch { threw = true; }
  check(`rejects --shard=${i}/${n} rather than silently sweeping a subset`, threw);
}

// ── The mutators must still fire on the shapes they exist to catch ────────────
//
// The sharder above proves no TARGET is dropped. This proves no MUTATOR is
// silently neutered — the other way the sweep can report success over work it
// never did. A one-character narrowing of an operand regex (`(.+)` → `([^)]+)`)
// stops mutating every function-call guard operand, and because the full sweep
// is scheduled/post-merge, no per-PR check would notice: the drop reads as
// "skipped", never SURVIVOR. So each mutator is asserted to fire on a
// representative guard-line shape, through the SAME `lineMutations` the sweep
// uses. The fixture that matters most is a `&&`/`||` operand carrying a `)` — the
// exact multi-term shape (`isFinite(x) &&`, `!contradictory(cand) &&`) two named
// findings were built to catch and the exact shape the narrowing kills.
const MUTATOR_FIXTURES = [
  { line: `  if (isFinite(expiry) && report.ok) {`, expect: ["cond-false"] },
  { line: `  } else if (tier !== "prod") {`, expect: ["else-if-false"] },
  { line: `  } else if (!contradictory) {`, expect: ["else-if-false", "else-if-true"] },
  { line: `    isFinite(expiry) &&`, expect: ["conjunct-true"] },
  { line: `    !contradictory(cand) &&`, expect: ["conjunct-true"] },
  { line: `    report.credentialRef.length > 0 ||`, expect: ["disjunct-false"] },
  { line: `    zone === expectedZone ||`, expect: ["disjunct-false"] },
  { line: `    return false;`, expect: ["return-flip"] },
  { line: `    return true;`, expect: ["return-flip"] },
  { line: `  const remaining = budget - spent;`, expect: [] },
];
// Non-vacuity: the case set is itself pinned. Deleting fixtures to weaken this
// self-test is the same class of attack it defends against, so a shrunk fixture
// list fails the gate. Also assert every mutator id is exercised by at least one
// fixture, so adding a mutator without a fixture cannot leave it untested.
const FIXTURE_FLOOR = 10;
check(`mutator self-test is non-vacuous (${MUTATOR_FIXTURES.length} fixtures, floor ${FIXTURE_FLOOR})`,
  MUTATOR_FIXTURES.length >= FIXTURE_FLOOR);
const exercised = new Set(MUTATOR_FIXTURES.flatMap((f) => f.expect));
check(`every mutator id is exercised by a fixture (${exercised.size}/${MUTATORS.length})`,
  MUTATORS.every((m) => exercised.has(m.id)));
for (const f of MUTATOR_FIXTURES) {
  const got = lineMutations(f.line).map((x) => x.mutator).sort();
  const want = [...f.expect].sort();
  check(`mutators fire on \`${f.line.trim()}\` → [${want.join(", ") || "none"}]`,
    got.length === want.length && got.every((id, i) => id === want[i]));
}

// ── The hand-registered safety-critical targets must stay in the registry ─────
//
// `check-guard-registries.mjs` only requires the GRANT-SAFETY population to be in
// TARGETS; these four are registered by hand and sit outside it, so dropping one
// (e.g. `continuity.ts`, whose reconcileDecisions can emit `allow`) escapes that
// gate and shrinks the sweep by one safety-critical file with every per-PR check
// still green. Pin them by name.
const PINNED_PROOFS = ["proof:verdict-attestation", "proof:decision-continuity", "proof:pim-activation", "proof:dual-control"];
const present = new Set(TARGETS.map((t) => t.proof));
for (const p of PINNED_PROOFS) {
  check(`hand-registered safety-critical target present: ${p}`, present.has(p));
}

// Reported, not gated.
const N = Number.parseInt(process.env.MUTATION_SHARDS ?? "4", 10);
const weight = (t) => t.files.reduce((n, f) => n + mutationsFor(f).length, 0);
const loads = Array.from({ length: N }, (_, i) => shardTargets(TARGETS, i, N).reduce((sum, t) => sum + weight(t), 0));
const totalMutations = TARGETS.reduce((n, t) => n + weight(t), 0);
// Report the quantity the sharder actually balances on. An earlier version of this
// line reported FILES per shard while `shardTargets` balanced MUTATIONS — a real
// number answering a different question than the one the reader would take it for.
console.log(`\n  balance at N=${N}, by MUTATIONS per shard: ${loads.join(" · ")}`);
console.log(`  ${TARGETS.length} targets · ${TARGETS.reduce((n, t) => n + t.files.length, 0)} files · ${totalMutations} mutations`);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
