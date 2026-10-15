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
 * The SPREAD between shards is REPORTED, never gated. It depends on how lumpy the
 * registry happens to be, and a threshold on it would fail the build for a defensible
 * distribution — a flaky gate gets switched off, and this one is worth keeping.
 *
 * What IS gated is narrower, deterministic, and read from the registry and the workflow
 * (never from a clock): (1) the split covers every MUTATION exactly once, not merely every
 * target, because a heavy target is cut into slices; (2) a target that registers a cost
 * heavier than one unit is in fact sliced; (3) no shard's REGISTERED load exceeds 80% of the
 * sweep job's own `timeout-minutes`. (3) exists because the sweep was balanced by mutation
 * count while one proof cost 45x the others per mutation, and shard 3 sat over its 40-minute
 * bound for a week (see mutation-guard.mjs, WHY THE SHARDS ARE BALANCED BY COST). An unregistered
 * cost is invisible to this gate by construction; the sweep's own COST DRIFT line is the net
 * for that.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { TARGETS, ALLOWED, shardTargets, mutationsFor, MUTATORS, lineMutations, unknownArgs, resolveAllowedLine, allowlistProblem, auditAllowlist, allowlistFailureCount, isAllowed, DEFAULT_RUN_SECONDS, MAX_UNIT_SECONDS, runSecondsOf, mutationTotal, sliceOwns, sliceSize, sliceCount, unitWeight, costDrifted } from "./mutation-guard.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
const check = (name, ok) => { if (ok) { passed += 1; console.log(`  ok — ${name}`); } else { failures.push(name); console.error(`  FAIL — ${name}`); } };

console.log("Mutation sharding — the split must lose nothing\n");

//
// The unit of "swept exactly once" is the MUTATION, not the target. A heavy target is cut into
// slices (mutation-guard.mjs, WHY THE SHARDS ARE BALANCED BY COST), so a sharder that dropped
// or repeated one slice would lose or double part of a target while every target still
// "appears". A mutation is keyed `proof#position`, the position `sliceOwns` filters on.
const unitKey = (u) => `${u.proof}${u.slice ? `[${u.slice.index}/${u.slice.count}]` : ""}`;
const TOTALS = new Map(TARGETS.map((t) => [t.proof, mutationTotal(t)]));
const totalOf = (t) => TOTALS.get(t.proof) ?? mutationTotal(t);
function coverage(registry, n, totals = totalOf, maxUnitSeconds) {
  const hits = new Map();
  const proofs = new Set();
  let units = 0;
  for (let i = 0; i < n; i += 1) {
    for (const u of shardTargets(registry, i, n, maxUnitSeconds)) {
      units += 1;
      proofs.add(u.proof);
      for (let o = 0, t = totals(u); o < t; o += 1) {
        if (sliceOwns(u.slice, o)) hits.set(`${u.proof}#${o}`, (hits.get(`${u.proof}#${o}`) ?? 0) + 1);
      }
    }
  }
  const expected = registry.reduce((sum, t) => sum + totals(t), 0);
  const placed = [...hits.values()].reduce((a, b) => a + b, 0);
  return { units, expected, placed, distinct: hits.size, once: [...hits.values()].every((c) => c === 1), proofsPlaced: proofs.size };
}
check(`registry proof names are unique (${TARGETS.length} entries, ${TOTALS.size} names) — the partition keys on them`, TOTALS.size === TARGETS.length);
for (const n of [1, 2, 3, 4, 8, TARGETS.length, TARGETS.length + 3]) {
  const c = coverage(TARGETS, n);
  check(`N=${n}: every target is placed and each of its ${c.expected} mutations is swept exactly once (${c.placed} placements, ${c.distinct} distinct, ${c.units} units)`,
    c.once && c.placed === c.expected && c.distinct === c.expected && c.proofsPlaced === TARGETS.length);
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
  const once = shardTargets(TARGETS, 1, n).map(unitKey).join("|");
  const again = shardTargets(TARGETS, 1, n).map(unitKey).join("|");
  const third = shardTargets([...TARGETS], 1, n).map(unitKey).join("|");
  check(`N=${n}: shard 1 is identical across independent computations, in order`,
    once === again && once === third);
}

// Falsification: the guard must reject shard arguments that cannot describe a partition.
for (const [i, n] of [[0, 0], [2, 2], [-1, 3], [1.5, 3]]) {
  let threw = false;
  try { shardTargets(TARGETS, i, n); } catch { threw = true; }
  check(`rejects --shard=${i}/${n} rather than silently sweeping a subset`, threw);
}

// ── The split balances REGISTERED COST, and a target heavier than one unit is SLICED ─────────
//
// Balanced by mutation COUNT, the sweep put a proof that costs ~45s per mutation (the 9.5M-report
// enumeration of device-management-health) beside ordinary ones at ~1s, called the result "49
// mutations", and shard 3 sat over its 40-minute bound for a week with hung=0. The cost is now a
// registered number (`runSeconds`), the split weighs mutations x runSeconds, and a target above
// MAX_UNIT_SECONDS is cut into residue-class slices. Everything below is pure arithmetic over the
// registry and the workflow file: no proof runs and no clock is read.
const threw = (fn) => { try { fn(); return false; } catch { return true; } };
check("sliceOwns: no slice owns every position; a slice owns exactly its residue class",
  sliceOwns(undefined, 0) && sliceOwns(undefined, 99)
  && [1, 4, 7].every((o) => sliceOwns({ index: 1, count: 3 }, o))
  && [0, 2, 3, 5].every((o) => !sliceOwns({ index: 1, count: 3 }, o)));
check("sliceSize: 10 mutations in 3 slices hold 4+3+3, a slice past the total holds none, no slice holds all",
  [0, 1, 2].map((k) => sliceSize(10, { index: k, count: 3 })).join() === "4,3,3" && sliceSize(2, { index: 2, count: 3 }) === 0 && sliceSize(10, undefined) === 10);
check("sliceCount: exactly one unit of registered work stays whole, a heavy target is cut to fit, never into more pieces than mutations, an empty one stays whole",
  sliceCount(10, MAX_UNIT_SECONDS / 10) === 1 && sliceCount(10, (2.5 * MAX_UNIT_SECONDS) / 10) === 3 && sliceCount(5, 10 * MAX_UNIT_SECONDS) === 5 && sliceCount(0, 45) === 1);
check("runSecondsOf: absent is the default; zero, negative, NaN, Infinity, null and a string THROW instead of quietly reading as ordinary",
  runSecondsOf({ proof: "p" }) === DEFAULT_RUN_SECONDS && runSecondsOf({ proof: "p", runSeconds: 45 }) === 45
  && [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, "45"].every((v) => threw(() => runSecondsOf({ proof: "p", runSeconds: v }))));
check("shardTargets refuses a unit ceiling that is not a positive number (0, -1, NaN, a string)",
  [0, -1, Number.NaN, "600"].every((v) => threw(() => shardTargets(TARGETS, 0, 4, v))));
check("costDrifted flags a proof that outgrew its registration and stays quiet through the runner's own swing (30.5s vs 46.6s baselines of one proof) and a 1s proof that hiccups to 4s",
  costDrifted(12, 1) && costDrifted(100, 45) && !costDrifted(46.6, 45) && !costDrifted(30.5, 45) && !costDrifted(70, 45) && !costDrifted(4.2, 1));

// A fixture registry built from REAL registered files (mutationsFor reads them), one target
// registered heavy, one the same size registered nothing, and three ordinary fillers.
{
  const base = TARGETS.find((t) => t.runSeconds === undefined && TOTALS.get(t.proof) >= 6 && TOTALS.get(t.proof) <= 300);
  const baseTotal = base ? TOTALS.get(base.proof) : 0;
  check(`fixture base exists: an ordinary target with 6..300 mutations (${base?.proof}, ${baseTotal})`, base !== undefined);
  if (base) {
    const r = Math.ceil((2.5 * MAX_UNIT_SECONDS) / baseTotal);
    const heavy = { ...base, proof: "proof:fx-heavy", runSeconds: r };
    const unregistered = { ...base, proof: "proof:fx-unregistered" };
    const fillers = TARGETS.filter((t) => t.proof !== base.proof && t.runSeconds === undefined).slice(0, 3);
    const reg = [heavy, unregistered, ...fillers];
    for (const n of [1, 2, 3, 4, 5, 7]) {
      const c = coverage(reg, n, mutationTotal);
      check(`fixture N=${n}: a sliced target loses and repeats no mutation (${c.placed}/${c.expected} placements, ${c.distinct} distinct, ${c.units} units)`,
        c.once && c.placed === c.expected && c.distinct === c.expected && c.proofsPlaced === reg.length);
    }
    const placed4 = Array.from({ length: 4 }, (_, i) => shardTargets(reg, i, 4).map((u) => ({ i, u }))).flat();
    const heavyUnits = placed4.filter((x) => x.u.proof === "proof:fx-heavy");
    check(`fixture: the heavy target (${baseTotal} mutations x ${r}s = ${baseTotal * r}s) is cut into 3 slices, each at most one unit ceiling plus a mutation (${MAX_UNIT_SECONDS + r}s), on different shards`,
      heavyUnits.length === 3
      && heavyUnits.every((x) => unitWeight(x.u, baseTotal) <= MAX_UNIT_SECONDS + r)
      && new Set(heavyUnits.map((x) => x.i)).size === 3);
    check("fixture negative control: the same files registering NO cost stay one whole unit, so it is the registered cost that causes slicing, not the file's size",
      placed4.filter((x) => x.u.proof === "proof:fx-unregistered").length === 1 && placed4.find((x) => x.u.proof === "proof:fx-unregistered").u.slice === undefined);
    check("fixture negative control: with slicing switched off (unit ceiling Infinity) the heavy target is ONE unit of its full registered work",
      (() => {
        const off = Array.from({ length: 4 }, (_, i) => shardTargets(reg, i, 4, Number.POSITIVE_INFINITY)).flat().filter((u) => u.proof === "proof:fx-heavy");
        return off.length === 1 && off[0].slice === undefined && unitWeight(off[0], baseTotal) === baseTotal * r;
      })());
  }
}

// ── The sweep's own bound, read from the workflow ────────────────────────────────────────────
// The split is only as good as its fit to the job it runs in, so the job's `timeout-minutes`, its
// shard count and its matrix are READ from scheduled-verification.yml rather than copied here. A
// matrix that lacks a shard the run line divides by leaves that shard swept by no runner.
const REFUSE_FRACTION = 0.8;
const sweepJob = parseYaml(readFileSync(join(REPO, ".github/workflows/scheduled-verification.yml"), "utf8"))?.jobs?.["mutation-sweep"];
const runLine = (sweepJob?.steps ?? []).map((st) => st?.run).find((r) => typeof r === "string" && r.includes("mutation-guard.mjs"));
const shardsInRun = Number.parseInt(runLine?.match(/--shard=\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)\b/)?.[1] ?? "", 10);
const timeoutMinutes = sweepJob?.["timeout-minutes"];
const workflowOk = Number.isInteger(shardsInRun) && shardsInRun >= 1 && Number.isInteger(timeoutMinutes) && timeoutMinutes > 0;
check(`workflow: the mutation-sweep job runs \`--shard=<matrix>/N\` (N=${shardsInRun}) and bounds itself with timeout-minutes (${timeoutMinutes})`, workflowOk);
const matrixShards = sweepJob?.strategy?.matrix?.shard;
check(`workflow: matrix.shard is exactly 0..${shardsInRun - 1} (a shard the matrix lacks is swept by no runner)`,
  workflowOk && Array.isArray(matrixShards) && matrixShards.length === shardsInRun && matrixShards.every((v, i) => v === i));
const LANE_N = workflowOk ? shardsInRun : 4;
const BOUND_SECONDS = (workflowOk ? timeoutMinutes : 40) * 60;
const loadsOf = (registry, n, totals, maxUnitSeconds) =>
  Array.from({ length: n }, (_, i) => shardTargets(registry, i, n, maxUnitSeconds).reduce((sum, u) => sum + unitWeight(u, totals(u)), 0));
const laneLoads = loadsOf(TARGETS, LANE_N, totalOf);
const heaviest = Math.max(...laneLoads);
check(`the registered load of every shard stays within ${REFUSE_FRACTION * 100}% of the job's ${BOUND_SECONDS / 60}-minute bound (heaviest ${(heaviest / 60).toFixed(1)} min = ${((heaviest / BOUND_SECONDS) * 100).toFixed(0)}%) — beyond that a slow runner draw cancels it; add a shard or register a cost`,
  heaviest <= REFUSE_FRACTION * BOUND_SECONDS);

// What the real registry must keep doing: the one proof measured 45x the others stays registered
// and stays sliced across runners. Lowering the number, or deleting it, is the regression.
{
  const dmh = TARGETS.find((t) => t.proof === "proof:device-management-health");
  check("proof:device-management-health keeps its measured run cost registered (runSeconds >= 30: 30.9s per mutation on the fastest runner draw, 45s on the slow one)",
    dmh !== undefined && typeof dmh.runSeconds === "number" && dmh.runSeconds >= 30);
  const dmhPlaced = Array.from({ length: LANE_N }, (_, i) => shardTargets(TARGETS, i, LANE_N).filter((u) => u.proof === "proof:device-management-health").map(() => i)).flat();
  check(`at N=${LANE_N} proof:device-management-health is cut into slices (${dmhPlaced.length}) that land on ${new Set(dmhPlaced).size} different shards, none holding more than a unit ceiling's worth`,
    dmhPlaced.length >= 2 && new Set(dmhPlaced).size >= 2
    && Array.from({ length: LANE_N }, (_, i) => shardTargets(TARGETS, i, LANE_N)).flat().filter((u) => u.slice).every((u) => unitWeight(u, totalOf(u)) <= MAX_UNIT_SECONDS + runSecondsOf(u)));
}

// TEETH for the bound rule, on a fixture, so it does not depend on how today's registry happens to
// fall: a target whose registered work alone is 1.2x the job's bound is exactly the shape that
// cancelled shard 3. Unsliced, no split of it can fit; sliced, every shard stays within the rule.
{
  const base = TARGETS.find((t) => t.runSeconds === undefined && TOTALS.get(t.proof) >= 6 && TOTALS.get(t.proof) <= 300);
  if (base) {
    const baseTotal = TOTALS.get(base.proof);
    const oversize = { ...base, proof: "proof:fx-oversize", runSeconds: Math.ceil((1.2 * BOUND_SECONDS) / baseTotal) };
    const fx = [oversize, ...TARGETS.filter((t) => t.proof !== base.proof && t.runSeconds === undefined).slice(0, 3)];
    const unsliced = Math.max(...loadsOf(fx, LANE_N, mutationTotal, Number.POSITIVE_INFINITY));
    const sliced = Math.max(...loadsOf(fx, LANE_N, mutationTotal));
    check(`bound rule has teeth: an unsliced 1.2x-the-bound target puts ${(unsliced / 60).toFixed(0)} min on one shard (over the ${BOUND_SECONDS / 60}-minute bound), and the real sharder holds the heaviest shard to ${(sliced / 60).toFixed(0)} min (within ${REFUSE_FRACTION * 100}%)`,
      unsliced > BOUND_SECONDS && sliced <= REFUSE_FRACTION * BOUND_SECONDS);
  }
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

// ── Wave 7 (2026-10-09): the Graph posture connector, break-glass and response-accountability ──
// posture-connector.ts is the connector pointed at a real tenant and sat in NO target until now;
// the other two joined the brace-less sweep with their one-line guards pinned. Pin all three.
for (const p of ["graph-connector", "break-glass", "response-accountability"]) {
  check(`brace-less sweep: proof:${p} stays opted in (oneLine: true)`, TARGETS.find((t) => t.proof === `proof:${p}`)?.oneLine === true);
}
for (const [proof, file] of [
  ["proof:oauth-consent", "lib/integrations/src/integrations/oauth-consent/oauth-consent-connector.ts"],
  ["proof:access-governance", "lib/integrations/src/integrations/access-governance/access-governance-connector.ts"],
]) {
  check(`${proof} keeps its connector registered: ${file.split("/").pop()}`, TARGETS.find((t) => t.proof === proof)?.files.includes(file) === true);
}
check("brace-less sweep: proof:oauth-consent stays opted in (oneLine: true)", TARGETS.find((t) => t.proof === "proof:oauth-consent")?.oneLine === true);
check(
  "proof:graph-connector keeps the posture connector registered: posture-connector.ts",
  TARGETS.find((t) => t.proof === "proof:graph-connector")?.files.includes("lib/integrations/src/integrations/graph/posture-connector.ts") === true,
);

// ── Wave 9 (2026-10-09): nac, edr-threat, location-services, peripheral-control and incident-playbook ──
// join the brace-less sweep, the two nac connectors are re-registered (de-registered 2026-08-25
// because the mutator could not reach their brace-less guards; it can now), and the three
// families' mock transports the proofs DRIVE are registered under their existing targets.
for (const p of ["nac", "edr-threat", "location-services", "peripheral-control", "incident-playbook"]) {
  check(`brace-less sweep: proof:${p} stays opted in (oneLine: true)`, TARGETS.find((t) => t.proof === `proof:${p}`)?.oneLine === true);
}
for (const [proof, file] of [
  ["proof:nac", "lib/integrations/src/integrations/nac/cisco-ise.ts"],
  ["proof:nac", "lib/integrations/src/integrations/nac/aruba-clearpass.ts"],
  ["proof:edr-threat", "lib/integrations/src/integrations/edr-threat/mock-transport.ts"],
  ["proof:location-services", "lib/integrations/src/integrations/location-services/mock-transport.ts"],
  ["proof:peripheral-control", "lib/integrations/src/integrations/peripheral-control/mock-transport.ts"],
  ["proof:graph-connector", "lib/integrations/src/integrations/graph/mock-transport.ts"],
  ["proof:graph-connector", "lib/integrations/src/integrations/graph/estate.ts"],
]) {
  check(`${proof} keeps ${file.split("/").slice(-2).join("/")} registered`, TARGETS.find((t) => t.proof === proof)?.files.includes(file) === true);
}

// ── Wave 8 (2026-10-09): the shared adapter guards, emitter-discipline, the attestation connector ──
// url-guard (the outbound SSRF-class check), bounded-text, redirect and vendor-values are imported by
// every emitter family and sat in NO target; emitter-discipline joined the brace-less sweep with all
// of their survivors pinned in its proof. The attestation connector's two survivors are pinned too.
check("brace-less sweep: proof:emitter-discipline stays opted in (oneLine: true)", TARGETS.find((t) => t.proof === "proof:emitter-discipline")?.oneLine === true);
for (const f of ["url-guard", "bounded-text", "redirect", "vendor-values", "emitter-resolver"]) {
  const file = `lib/integrations/src/integrations/adapters/${f}.ts`;
  check(`proof:emitter-discipline keeps the shared adapter guard registered: ${f}.ts`, TARGETS.find((t) => t.proof === "proof:emitter-discipline")?.files.includes(file) === true);
}
check("proof:device-attestation keeps its connector registered: device-attestation-connector.ts",
  TARGETS.find((t) => t.proof === "proof:device-attestation")?.files.includes("lib/integrations/src/integrations/device-attestation/device-attestation-connector.ts") === true);

check("proof:config-scope keeps the tenant-key guard registered and opted in: store-scope.ts",
  TARGETS.find((t) => t.proof === "proof:config-scope")?.files.includes("lib/integrations/src/integrations/store-scope.ts") === true
  && TARGETS.find((t) => t.proof === "proof:config-scope")?.oneLine === true);

// ── Wave 10 (2026-10-09): the per-family mock transports ──
// Each family's `mock-transport.ts` is the fake the family proof drives its connector through; its
// non-GET / bad-token / unknown-path guards sit on the offline allow path and sat in NO target.
// Every one is registered under its own family proof (already `oneLine`) with its survivors pinned.
// local-authority is NOT in this list: its proof never references the factory, so a mutant there
// could not be killed and the file stays unregistered (listed on the BUILD_BACKLOG row "61 files under lib/integrations/src/integrations").
for (const f of ["credential-exposure", "data-protection", "identity-risk", "network-nac", "rtls-custody", "access-governance", "macos-posture", "oauth-consent", "ot-posture", "pacs-access", "sso-session", "task-exception", "token-binding", "link-usability", "agent-identity", "device-attestation"]) {
  const file = `lib/integrations/src/integrations/${f}/mock-transport.ts`;
  check(`proof:${f} keeps its mock transport registered: ${f}/mock-transport.ts`, TARGETS.find((t) => t.proof === `proof:${f}`)?.files.includes(file) === true);
}

// An unknown argument must be refused, not fall through to a full in-place sweep.
check("unknown flags are refused (--help, a bare -h, a space-separated --proof)", unknownArgs(["--help"]).length === 1 && unknownArgs(["-h"]).length === 1 && unknownArgs(["--proof", "x"]).length === 2);
check("a bare positional is refused (`mutation-guard.mjs proof:ot-posture` used to sweep everything)", unknownArgs(["proof:ot-posture"]).length === 1);
check("an EMPTY --proof= / --shard= is refused (a falsy value used to select every target)", unknownArgs(["--proof="]).length === 1 && unknownArgs(["--shard="]).length === 1);
check("a malformed value is refused: --proof==, --proof==x, --proof=a=b, --shard=1/4/9, --shard==1/4, --shard=a/b", ["--proof==", "--proof==proof:x", "--proof=a=b", "--shard=1/4/9", "--shard==1/4", "--shard=a/b"].every((a) => unknownArgs([a]).length === 1));
check("known flags and pnpm's forwarded bare -- are accepted", unknownArgs(["--", "--proof=proof:x", "--shard=0/4"]).length === 0);

// ── The allowlist resolves each entry to EXACTLY ONE line ─────────────────────
//
// `isAllowed` used to be `mutation.sourceLine.includes(entry.line)`, so an entry exempted
// EVERY line containing its text: attest.ts `return false;` also exempted the two real
// guards in digestsEqual (lines 42-43) that only the catch at 51 was meant to cover. An allowlist entry is a per-line justification; it must name one line.
function auditAllowed(entries, readText) {
  return auditAllowlist(entries, readText).map((p) =>
    p.kind === "missing" ? `${p.entry.file} (unreadable)`
      : p.kind === "stale" ? `${p.entry.file}: STALE "${p.entry.line}"`
        : `${p.entry.file}: AMBIGUOUS lines ${p.lines.join(",")} "${p.entry.line}"`);
}
{
  const bad = auditAllowed(ALLOWED, (f) => readFileSync(join(REPO, f), "utf8"));
  check(`every real ALLOWED entry resolves to exactly one line (${ALLOWED.length} entries)${bad.length ? " — " + bad.join(" | ") : ""}`, bad.length === 0);
  for (const b of bad) console.error(`    ${b}`);
}
{
  const fakeText = "a();\nreturn false;\nreturn false;\n";
  const read = (f) => { if (f === "gone.ts") throw new Error("ENOENT"); return fakeText; };
  const run = (e) => auditAllowed([e], read);
  check("fixture: the real-entry audit FAILS on an ambiguous entry, a stale entry and an unreadable file, and passes a unique one",
    run({ file: "x.ts", line: "return false;" }).some((b) => b.includes("AMBIGUOUS lines 2,3")) &&
    run({ file: "x.ts", line: "return 7;" }).some((b) => b.includes("STALE")) &&
    run({ file: "gone.ts", line: "a();" }).some((b) => b.includes("unreadable")) &&
    run({ file: "x.ts", line: "a();" }).length === 0);
}
{
  const text = ["export function f(a, b) {", "  if (a === b) return false;", "  if (!a) return false;", "  return true;", "}"].join("\n");
  check("fixture: a snippet two lines contain is AMBIGUOUS (lists both lines)", JSON.stringify(resolveAllowedLine({ line: "return false;" }, text).ambiguous) === "[2,3]");
  check("fixture: a snippet no line contains is STALE", resolveAllowedLine({ line: "return 42;" }, text).stale === true);
  check("fixture: a unique snippet resolves to its 1-based line", resolveAllowedLine({ line: "if (!a) return false;" }, text).line === 3);
  check("fixture: a mutation WITHOUT lineNo is never exempted by a stale or ambiguous entry (undefined === undefined must not match)",
    (() => {
      const saved2 = ALLOWED.splice(0, ALLOWED.length, { file: "fx.ts", line: "return false;", reason: "ambiguous" }, { file: "fx.ts", line: "return 42;", reason: "stale" });
      try {
        const noLine = (sourceLine) => ({ file: "fx.ts", original: text, sourceLine });
        return !isAllowed(noLine("return false;")) && !isAllowed(noLine("return 42;")) && !isAllowed({ file: "fx.ts", sourceLine: "return false;" });
      } finally { ALLOWED.splice(0, ALLOWED.length, ...saved2); }
    })());
  check("fixture: main()'s failure count is the audit problems plus the out-of-sweep entries (the sweep exits 1 iff it is > 0)",
    allowlistFailureCount([], []) === 0 && allowlistFailureCount([{}, {}], []) === 2 && allowlistFailureCount([], [{}]) === 1 && allowlistFailureCount([{}], [{}, {}]) === 3);
  check("fixture: `whole` pins a bare line that is a suffix of other lines (the attest.ts catch)", resolveAllowedLine({ line: "return false;", whole: true }, text.replace("  return true;", "    return false;")).ambiguous === undefined);
  check("fixture: allowlistProblem reports ambiguous with the lines, stale, and null for exactly one", allowlistProblem({ line: "return false;" }, text)?.kind === "ambiguous" && allowlistProblem({ line: "return false;" }, text).lines.join() === "2,3" && allowlistProblem({ line: "return 42;" }, text)?.kind === "stale" && allowlistProblem({ line: "if (!a) return false;" }, text) === null);
  const fx = (lineNo) => ({ file: "fx.ts", original: text, lineNo, sourceLine: text.split("\n")[lineNo - 1].trim() });
  const saved = ALLOWED.splice(0, ALLOWED.length, { file: "fx.ts", line: "if (!a) return false;", reason: "fixture" }, { file: "fx.ts", line: "return false;", reason: "fixture (ambiguous)" });
  try {
    check("fixture: an entry exempts only its own line, not a different line containing its text (the attest.ts shape)", !!isAllowed(fx(3)) && !isAllowed(fx(2)));
    check("fixture: an ambiguous entry exempts NOTHING (fail closed)", !isAllowed({ ...fx(2), sourceLine: "return false;" }) );
  } finally { ALLOWED.splice(0, ALLOWED.length, ...saved); }
}

// Reported, not gated.
const N = Number.parseInt(process.env.MUTATION_SHARDS ?? String(LANE_N), 10);
const secondsPerShard = loadsOf(TARGETS, N, totalOf);
const mutationsPerShard = Array.from({ length: N }, (_, i) => shardTargets(TARGETS, i, N).reduce((sum, u) => sum + sliceSize(totalOf(u), u.slice), 0));
const totalMutations = [...TOTALS.values()].reduce((a, b) => a + b, 0);
// Report the quantity the sharder actually balances on: REGISTERED MINUTES (mutations x
// runSeconds). An earlier version reported FILES per shard while the sharder balanced MUTATIONS,
// then MUTATIONS counted without the brace-less opt-in (1594) while the sharder counted 2026 —
// each a real number answering a different question than the one the reader would take it for.
console.log(`\n  balance at N=${N}, by REGISTERED MINUTES per shard: ${secondsPerShard.map((x) => (x / 60).toFixed(1)).join(" · ")} (the job's bound is ${BOUND_SECONDS / 60} min, refused above ${REFUSE_FRACTION * 100}%)`);
console.log(`  by MUTATIONS per shard: ${mutationsPerShard.join(" · ")}`);
console.log(`  ${TARGETS.length} targets · ${TARGETS.reduce((n, t) => n + t.files.length, 0)} files · ${totalMutations} mutations`);

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
