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
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TARGETS, shardTargets, mutationsFor, MUTATORS, lineMutations, unknownArgs, journalWrite, journalRestore, journalStale, journalClear, classifyRun } from "./mutation-guard.mjs";

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
  // The brace-less mutator is OPT-IN per target (`oneLine: true`), so the same
  // guard line is asserted twice: it fires when the target opted in, and it
  // stays silent when it did not — a target that never opted in is never swept
  // by it, and the census line reports that rather than the sweep pretending.
  { line: `  if (typeof raw !== "string") return null;`, opts: { oneLine: true }, expect: ["oneline-cond-false"] },
  { line: `  if (!isPlainReport(report)) return UNKNOWN; // hostile shape`, opts: { oneLine: true }, expect: ["oneline-cond-false"] },
  { line: `  if (typeof raw !== "string") return null;`, expect: [] },
];
// Non-vacuity: the case set is itself pinned. Deleting fixtures to weaken this
// self-test is the same class of attack it defends against, so a shrunk fixture
// list fails the gate. Also assert every mutator id is exercised by at least one
// fixture, so adding a mutator without a fixture cannot leave it untested.
const FIXTURE_FLOOR = 13;
check(`mutator self-test is non-vacuous (${MUTATOR_FIXTURES.length} fixtures, floor ${FIXTURE_FLOOR})`,
  MUTATOR_FIXTURES.length >= FIXTURE_FLOOR);
const exercised = new Set(MUTATOR_FIXTURES.flatMap((f) => f.expect));
check(`every mutator id is exercised by a fixture (${exercised.size}/${MUTATORS.length})`,
  MUTATORS.every((m) => exercised.has(m.id)));
for (const f of MUTATOR_FIXTURES) {
  const got = lineMutations(f.line, f.opts ?? {}).map((x) => x.mutator).sort();
  const want = [...f.expect].sort();
  check(`mutators fire on \`${f.line.trim()}\`${f.opts?.oneLine ? " (oneLine opt-in)" : ""} → [${want.join(", ") || "none"}]`,
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

// ── Wave 5 (2026-10-01): six families joined the brace-less sweep ─────────────
// Their registered files held no one-line `if (...) return` guard when they joined, so
// joining added 0 mutations and 0 survivors — the opt-in is a ratchet for the NEXT
// brace-less guard added there. Pin it so the flag cannot be dropped quietly.
for (const p of ["ot-posture", "token-binding", "carrier-reachability", "credential-exposure", "data-protection", "identity-risk"]) {
  check(`brace-less sweep: proof:${p} stays opted in (oneLine: true)`, TARGETS.find((t) => t.proof === `proof:${p}`)?.oneLine === true);
}

// The three connector files round-1 review found unswept must STAY registered: the proofs pin their
// guards, but only the registration makes the sweep notice if a pin is ever lost.
for (const [proof, file] of [
  ["proof:carrier-reachability", "lib/integrations/src/integrations/carrier/reachability-connector.ts"],
  ["proof:ot-posture", "lib/integrations/src/integrations/ot-posture/ot-connector.ts"],
  ["proof:token-binding", "lib/integrations/src/integrations/token-binding/token-binding-connector.ts"],
]) {
  check(`${proof} keeps its connector registered: ${file.split("/").pop()}`, TARGETS.find((t) => t.proof === proof)?.files.includes(file) === true);
}

// The decision ladder the carrier proof imports (evaluateReachability) was registered under no
// entry until 2026-10-01, so its mutations were never swept. Dropping the line must go red.
check("proof:carrier-reachability keeps its decision ladder registered: evaluate.ts",
  TARGETS.find((t) => t.proof === "proof:carrier-reachability")?.files.includes("lib/integrations/src/integrations/carrier/evaluate.ts") === true);

// ── The mutation journal: a killed sweep must not leave a broken guard in the tree ─────────────
// Exercised on a scratch directory, through the SAME functions the sweep calls. A journal whose
// restore silently did nothing would read as green here only if the restore check below passed.
{
  const root = mkdtempSync(join(tmpdir(), "mg-journal-root-"));
  const jdir = mkdtempSync(join(tmpdir(), "mg-journal-dir-"));
  try {
    mkdirSync(join(root, "lib"), { recursive: true });
    const file = "lib/guard.ts";
    const original = "if (x) return 1;\n";
    writeFileSync(join(root, file), original);
    journalWrite(jdir, 4242, [{ file, original }]);
    writeFileSync(join(root, file), "if (false) return 1;\n"); // the mutation, never restored
    const stale = journalStale(jdir, root, () => false);
    check("a dead sweep's journal is reported stale, naming the file whose bytes differ",
      stale.length === 1 && stale[0].differing.length === 1 && stale[0].differing[0] === file);
    check("a journal whose sweep is still alive is NOT reported stale", journalStale(jdir, root, () => true).length === 0);
    const restored = journalRestore(jdir, 4242, root);
    check("journalRestore writes the original bytes back and reports the file",
      restored.length === 1 && readFileSync(join(root, file), "utf8") === original);
    check("journalRestore is idempotent and leaves no journal behind", journalRestore(jdir, 4242, root).length === 0 && journalStale(jdir, root, () => false).length === 0);
    writeFileSync(join(jdir, "7.json"), "{not json");
    check("an unreadable journal is stale (fail closed), not ignored", journalStale(jdir, root, () => false).some((j) => j.unreadable));
    let outsideRefused = false;
    journalWrite(jdir, 9, [{ file: "../escape.txt", original: "x" }]);
    try { journalRestore(jdir, 9, root); } catch { outsideRefused = true; }
    check("a journal entry that escapes the repo root is refused, never written", outsideRefused && journalStale(jdir, root, () => false).some((j) => j.pid === 9 && j.unreadable));
    journalClear(jdir, 9);
    const loose = mkdtempSync(join(tmpdir(), "mg-journal-loose-"));
    try { chmodSync(loose, 0o755); let refused = false; try { journalWrite(loose, 1, []); } catch { refused = true; } check("a journal dir open to group/other is refused (insecure temp dir)", refused); } finally { rmSync(loose, { recursive: true, force: true }); }
    journalClear(jdir, 7); journalWrite(jdir, 8, [{ file, original }]); journalClear(jdir, 8);
    check("journalClear removes the journal", journalStale(jdir, root, () => false).length === 0);
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(jdir, { recursive: true, force: true }); }
}
check("classifyRun: pass → survivor, fail/no summary → killed, timeout → hung",
  classifyRun(false, "summary=pass (3/3)") === "survivor" && classifyRun(false, "summary=fail (2/3)") === "killed" && classifyRun(false, "") === "killed" && classifyRun(true, "summary=pass (3/3)") === "hung");
check("--restore-stale is a known flag", unknownArgs(["--restore-stale"]).length === 0);

// An unknown argument must be refused, not fall through to a full in-place sweep.
check("unknown flags are refused (--help, a bare -h, a space-separated --proof)", unknownArgs(["--help"]).length === 1 && unknownArgs(["-h"]).length === 1 && unknownArgs(["--proof", "x"]).length === 2);
check("a bare positional is refused (`mutation-guard.mjs proof:ot-posture` used to sweep everything)", unknownArgs(["proof:ot-posture"]).length === 1);
check("an EMPTY --proof= / --shard= is refused (a falsy value used to select every target)", unknownArgs(["--proof="]).length === 1 && unknownArgs(["--shard="]).length === 1);
check("a malformed value is refused: --proof==, --proof==x, --proof=a=b, --shard=1/4/9, --shard==1/4, --shard=a/b", ["--proof==", "--proof==proof:x", "--proof=a=b", "--shard=1/4/9", "--shard==1/4", "--shard=a/b"].every((a) => unknownArgs([a]).length === 1));
check("known flags and pnpm's forwarded bare -- are accepted", unknownArgs(["--", "--proof=proof:x", "--shard=0/4"]).length === 0);

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
