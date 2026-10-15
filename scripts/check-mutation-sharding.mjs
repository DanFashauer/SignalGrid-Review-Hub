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
 * (never from a clock):
 *
 * (1) the split covers every MUTATION exactly once, not merely every target, because a heavy
 *     target is cut into slices. Four things prove it; b to d exist because a pin on main()'s
 *     source text was satisfied by a comment, a dead branch, or a statement that rewrote the
 *     selection afterwards:
 *     a. the SAME `selectSliceMutations` that mutation-guard's main() sweeps with is run over
 *        every real unit (a gate that re-implemented the ownership loop covered a model of it:
 *        three one-token regressions in main()'s own copy stayed green, one a silent skip);
 *     b. main() ITSELF is run in its `--plan` mode (its own target resolution, shard split and
 *        selection, stopping where the first mutation would be written) for shard counts 1 to 4,
 *        and what it plans is compared with the selector's own run and the registry's totals;
 *     c. main() ITSELF is SWEPT, shards 0 to 3 of the whole registry and of the heavy proof's
 *        local slice command, with the disk and the proof stubbed, and what it writes is compared
 *        with its own `--plan`. `--plan` stops before the write, so one-line plants in the half
 *        after it (a skip after the plan stop, a `planOnly`-keyed splice of the owned list, a
 *        `planOnly`-keyed drop of the first unit) left the plan, the selector and every text pin
 *        as they were while the sweep ran 1021, 1832 and 1977 of 2026 mutations, every shard rc 0;
 *     d. main()'s text is the second net (comments stripped): the statements that write, count,
 *        run and restore a mutation are pinned to follow the plan stop with nothing between, and
 *        the number of places main() forks on the plan flag is pinned. At runtime each unit's
 *        written count is checked against the selector's own (the one net no text pin gives).
 *     Each has fixture mutants that must go red, and a fixture that cannot be built fails the gate
 *     by name instead of passing or crashing it.
 *
 *     Every child runs under scripts/lib/no-write-preload.mjs (a write under the repository, or a
 *     spawned process, throws), the registered guard files are hashed before the first child and
 *     after the last, and each child has a time limit that stops the pool at the first hang. The
 *     workflow's run line is refused if it passes `--plan` or any flag but `--shard=`/`--proof=`
 *     (every shard would be a green no-op).
 *
 * (2) a target that registers a cost heavier than one unit is in fact sliced;
 *
 * (3) no shard's REGISTERED load exceeds 80% of the sweep job's own `timeout-minutes`. (3) exists
 *     because the sweep was balanced by mutation count while one proof cost 45x the others per
 *     mutation, and shard 3 sat over its 40-minute bound for a week (see mutation-guard.mjs, WHY
 *     THE SHARDS ARE BALANCED BY COST). An unregistered cost is invisible to this gate by
 *     construction; the sweep's own COST DRIFT line is the net for that.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { TARGETS, ALLOWED, shardTargets, mutationsFor, MUTATORS, lineMutations, unknownArgs, resolveAllowedLine, allowlistProblem, auditAllowlist, allowlistFailureCount, isAllowed, DEFAULT_RUN_SECONDS, MAX_UNIT_SECONDS, runSecondsOf, mutationTotal, sliceOwns, sliceSize, sliceCount, unitWeight, costDrifted, mutationsByFile, selectSliceMutations, unitName, placementOf } from "./mutation-guard.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
const failures = [];
const check = (name, ok) => { if (ok) { passed += 1; console.log(`  ok — ${name}`); } else { failures.push(name); console.error(`  FAIL — ${name}`); } };

console.log("Mutation sharding — the split must lose nothing\n");

//
// The unit of "swept exactly once" is the MUTATION, not the target. A heavy target is cut into
// slices (mutation-guard.mjs, WHY THE SHARDS ARE BALANCED BY COST), so a sharder that dropped
// or repeated one slice would lose or double part of a target while every target still
// "appears". A mutation is keyed by its IDENTITY (its place in the target's file list, its file, line
// and mutator), never by the ordinal the selector reports: a selector that counts wrongly reports
// shifted ordinals, which can still look like a clean partition of their own numbers while real
// mutations are skipped and repeated. The reported ordinal is checked separately, against the true
// position.
//
// WHAT IS SWEPT is decided by `selectSliceMutations` (ordinal accumulation, slice filter, whole-file
// count), the function mutation-guard's main() calls. This gate runs THAT over the real files, not a
// loop of its own: it once re-implemented the ownership rule, and three regressions in main()'s copy
// of it (slice ignored; ordinal advanced by the filtered count, so mutations were skipped and repeated
// with every shard exiting 0; zero check on the filtered count) all left it at 123/123.
const unitKey = unitName;
const TOTALS = new Map(TARGETS.map((t) => [t.proof, mutationTotal(t)]));
const totalOf = (t) => TOTALS.get(t.proof) ?? mutationTotal(t);
// Each (file, opt-in) is parsed ONCE and shared by every call below. The selector only counts and
// indexes what it is given, so the cache keeps the identifying fields and drops the whole-file text
// each mutation carries (2000+ copies of 185 files).
const PARSED = new Map();
const parseOnce = (file, opts) => {
  const key = `${opts?.oneLine === true ? 1 : 0}|${file}`;
  if (!PARSED.has(key)) PARSED.set(key, mutationsFor(file, opts).map((m) => ({ file: m.file, lineNo: m.lineNo, mutator: m.mutator })));
  return PARSED.get(key);
};
const perFileOf = (u) => mutationsByFile(u, parseOnce);
function coverage(registry, n, totals = totalOf, maxUnitSeconds, select = selectSliceMutations) {
  const hits = new Map();
  const proofs = new Set();
  let units = 0;
  let allCountsWhole = true;
  let ordinalsTrue = true;
  for (let i = 0; i < n; i += 1) {
    for (const u of shardTargets(registry, i, n, maxUnitSeconds)) {
      units += 1;
      proofs.add(u.proof);
      const perFile = perFileOf(u);
      const plan = select(u, perFile);
      // The zero-mutation check looks at the WHOLE file, so its count must not shrink to the slice.
      if (plan.files.length !== perFile.length) allCountsWhole = false;
      let before = 0;
      plan.files.forEach((f, k) => {
        if (f.allCount !== perFile[k]?.mutations.length) allCountsWhole = false;
        for (const { ordinal, mutation } of f.owned) {
          const id = `${u.proof}#${k}:${mutation.file}:${mutation.lineNo}:${mutation.mutator}`;
          hits.set(id, (hits.get(id) ?? 0) + 1);
          if (ordinal !== before + (perFile[k]?.mutations.indexOf(mutation) ?? -1)) ordinalsTrue = false;
        }
        before += perFile[k]?.mutations.length ?? 0;
      });
    }
  }
  const expected = registry.reduce((sum, t) => sum + totals(t), 0);
  const placed = [...hits.values()].reduce((a, b) => a + b, 0);
  return { units, expected, placed, distinct: hits.size, once: [...hits.values()].every((c) => c === 1), proofsPlaced: proofs.size, allCountsWhole, ordinalsTrue };
}
check(`registry proof names are unique (${TARGETS.length} entries, ${TOTALS.size} names) — the partition keys on them`, TOTALS.size === TARGETS.length);
for (const n of [1, 2, 3, 4, 8, TARGETS.length, TARGETS.length + 3]) {
  const c = coverage(TARGETS, n);
  check(`N=${n}: every target is placed and each of its ${c.expected} mutations is swept exactly once (${c.placed} placements, ${c.distinct} distinct, ${c.units} units)`,
    c.once && c.placed === c.expected && c.distinct === c.expected && c.proofsPlaced === TARGETS.length && c.allCountsWhole && c.ordinalsTrue);
}
check("mutationsByFile agrees with mutationTotal on every registered target (the selector is fed the files the sharder weighs)",
  TARGETS.every((t) => perFileOf(t).length === t.files.length && perFileOf(t).reduce((n, f) => n + f.mutations.length, 0) === TOTALS.get(t.proof)));
// The two checks above hand mutationsByFile the gate's OWN reader. main() passes none: it takes the
// DEFAULT, so a default that quietly drops the brace-less sweep (432 of 2026 mutations, every shard
// exiting 0) or reads every file as empty never reached the gate. This one calls it exactly as main()
// does, with no reader, on every registered target, and compares with the cached parse and with TOTALS.
{
  const bad = [];
  let readTotal = 0;
  for (const t of TARGETS) {
    const real = mutationsByFile(t);
    const here = real.reduce((n, f) => n + f.mutations.length, 0);
    readTotal += here;
    const same = real.length === t.files.length
      && real.every((f, k) => f.file === t.files[k]
        && JSON.stringify(f.mutations.map((m) => [m.lineNo, m.mutator])) === JSON.stringify(parseOnce(t.files[k], { oneLine: t.oneLine === true }).map((m) => [m.lineNo, m.mutator])));
    if (!same || here !== TOTALS.get(t.proof)) bad.push(t.proof);
  }
  const registered = [...TOTALS.values()].reduce((a, b) => a + b, 0);
  check(`mutationsByFile with NO reader (its default, the call main() makes) returns the registered mutations of every target, brace-less sweep included (${readTotal} of ${registered} mutations, ${TARGETS.length} targets)${bad.length ? ` — differs for ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? `, +${bad.length - 4} more` : ""}` : ""}`,
    bad.length === 0 && readTotal === registered);
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
        c.once && c.placed === c.expected && c.distinct === c.expected && c.proofsPlaced === reg.length && c.allCountsWhole && c.ordinalsTrue);
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

// ── main() sweeps with the selector proven above, and a mutant of either goes red ────────────
//
// Two ways to break the selection survive a gate that proves only the arithmetic: the function
// itself (checked above on the real registry, and below on mutants of its own text), and the
// CALLER, main(), which can ignore the slice, keep a private filter and counter, rewrite the
// selection afterwards, or drop the assignment of its shard split. main() cannot be RUN here in
// full (it mutates source for the better part of an hour), so it is checked two ways.
//
// 1. It is run as far as it is safe to: `--plan` takes main()'s own path (target resolution, shard
//    split, selection, the loops over files and owned mutations) and records each placement at the
//    statement that would otherwise write the mutation, then stops. A comment holding the call, a
//    dead branch, a splice into `owned` after the selector, a discarded shard split: all of those
//    change what main() plans, and the plan is compared below with the selector's own run.
// 2. Its source text is pinned, comments stripped, as a second net: the pins also keep the plan
//    mode honest (it must stop before the baseline and before a mutation is written, which is what
//    makes spawning it safe).
const GUARD_SRC = readFileSync(join(REPO, "scripts/mutation-guard.mjs"), "utf8");
// Comments removed, everything else kept, so a pin cannot be satisfied (or tripped) by a comment. Not
// a parser: it knows quotes, nested template literals and regex literals, which is what main() holds.
function stripComments(src) {
  let out = "";
  let i = 0;
  let prev = "";
  const subst = [];
  const scanTemplate = () => {
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { out += c; i += 1; prev = "`"; return; }
      if (c === "$" && src[i + 1] === "{") { out += "${"; i += 2; subst.push(0); prev = "{"; return; }
      out += c; i += 1;
    }
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && d === "*") {
      const close = src.indexOf("*/", i + 2);
      const stop = close < 0 ? src.length : close + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; prev = c;
      continue;
    }
    if (c === "`") { out += c; i += 1; scanTemplate(); continue; }
    if (c === "{" && subst.length > 0) subst[subst.length - 1] += 1;
    if (c === "}" && subst.length > 0) {
      if (subst[subst.length - 1] === 0) { subst.pop(); out += c; i += 1; scanTemplate(); continue; }
      subst[subst.length - 1] -= 1;
    }
    if (c === "/" && (prev === "" || "(,=:[!&|?{;".includes(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n" && (inClass || src[j] !== "/")) {
        if (src[j] === "\\") j += 1;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        j += 1;
      }
      if (src[j] === "/") {
        j += 1;
        while (j < src.length && /[a-z]/.test(src[j])) j += 1;
        out += src.slice(i, j); i = j; prev = ")";
        continue;
      }
    }
    out += c; i += 1;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}
check("fixture: stripComments drops line and block comments and keeps '//', '/*' and quotes inside strings, nested templates and regex literals",
  stripComments("a(); // it's gone\nb(\"//\", '/* kept */'); /* x\ny */ c();").replace(/ +/g, " ") === "a(); \nb(\"//\", '/* kept */'); \n c();"
  && stripComments("`a ${b ? `c // ${d}` : \"//\"} // text` // tail") === "`a ${b ? `c // ${d}` : \"//\"} // text` "
  && stripComments("s.replace(/^p:/, \"\") // tail\nx = a / b; // t") === "s.replace(/^p:/, \"\") \nx = a / b; ");
// Whitespace is folded to single spaces after the comments go, so a pin reads one statement per
// string and is neither tripped by a reformat nor satisfied by a comment.
function mainBody(src) {
  const start = src.indexOf("\nfunction main() {");
  const end = src.indexOf("\nif (IS_MAIN) main();", start);
  return start < 0 || end < 0 ? "" : stripComments(src.slice(start, end)).replace(/\s+/g, " ");
}
const PIN_SELECT = "const plan = selectSliceMutations(target, mutationsByFile(target));";
const PIN_SHARD = "targets = shardTargets(targets, i, n);";
const PIN_FILES = "for (const { file, allCount, owned } of plan.files) {";
const PIN_ZERO = "if (allCount === 0) {";
// The statement that WRITES the mutation is pinned to follow the plan stop with nothing conditional
// between, and the statements that count it, run the proof and restore the file follow it the same way.
// The plan, the selector's own run and the text pins that stopped at the plan stop all left room for a
// line that ran only in a real sweep (`if (mutation.lineNo % 2 === 1) continue;` after the stop swept
// 1021 of 2026 mutations with every shard exiting 0), and a write-then-restore without the proof run is the
// same hole one statement later.
const foldPin = (text) => text.replace(/\s+/g, " ").trim();
const PIN_PLAN_STOP = foldPin(`for (const { ordinal, mutation } of owned) {
  if (planOnly) { placements.push(placementOf(target, file, ordinal, mutation)); continue; }
  total += 1; writeFileSync(mutation.abs, mutation.content); writtenInUnit += 1;
  let verdict; try { verdict = runProof(target.proof); } finally { writeFileSync(mutation.abs, mutation.original); }`);
const PIN_NO_BASELINE = "if (!planOnly) { const base = baselineProbe(target.proof, runProof);";
// The runtime net (what a unit actually wrote must equal what the selector planned) and its report.
const PIN_COUNT_INIT = foldPin("const swept = plan.swept; const placedBefore = placements.length; let writtenInUnit = 0;");
const PIN_COUNT_CHECK = foldPin("const accounted = writtenInUnit + (placements.length - placedBefore); if (accounted !== swept) { const line = `${unitName(target)}: ${accounted} mutations written, the selector planned ${swept}`; writeMismatches.push(line); console.error(`   ✗ WRITTEN-vs-PLAN  ${line}`); process.exitCode = 1; }");
const PIN_MISMATCH_EXIT = foldPin("if (writeMismatches.length > 0) { console.error(\"\\nMutation guard FAILED — the sweep did not write what the plan selected, so the counts above are over a different set than the one the shards were balanced for:\\n\"); for (const m of writeMismatches) console.error(`  ✗ WRITTEN-vs-PLAN  ${m}`); process.exit(1); }");
const MAIN_PINS = [PIN_SELECT, PIN_SHARD, PIN_FILES, PIN_ZERO, PIN_PLAN_STOP, PIN_NO_BASELINE, PIN_COUNT_INIT, PIN_COUNT_CHECK, PIN_MISMATCH_EXIT];
// A new plan/sweep fork has to be reviewed, so the number of places main() names the plan flag, and reads
// its arguments and environment, is pinned. `planOnly` today: the declaration, the log alias, the empty-shard
// guard, the baseline guard, the loop stop and the final print. (`if (!planOnly) owned.splice(0, 1);` before
// the owned loop swept 1832 of 2026; `if (!planOnly) targets = targets.slice(1);` dropped every shard's
// device-management-health slice while --plan still showed 13/12/12/12; a second `process.argv.includes("--plan")`
// under another name would escape a count of the first.)
const FORK_COUNTS = { planOnly: 6, "process.argv": 4, "process.env": 1 };
const forkCountsOf = (body) => ({
  planOnly: (body.match(/\bplanOnly\b/g) ?? []).length,
  "process.argv": (body.match(/\bprocess\.argv\b/g) ?? []).length,
  "process.env": (body.match(/\bprocess\.env\b/g) ?? []).length,
});
const forksPinned = (body) => { const got = forkCountsOf(body); return body !== "" && Object.entries(FORK_COUNTS).every(([name, n]) => got[name] === n); };
function mainSweepsWithSelector(src) {
  const body = mainBody(src);
  // The words below may appear only inside the pinned statements (the plan records the selector's
  // own ordinal); anywhere else they are a private ownership filter or counter.
  const rest = MAIN_PINS.reduce((b, p) => b.split(p).join(""), body);
  return body !== ""
    && (body.match(/selectSliceMutations\(/g) ?? []).length === 1
    && MAIN_PINS.every((p) => body.includes(p))
    && forksPinned(body)
    && !/sliceOwns\(|ordinal|mutationsFor\(|owned\.length === 0|allInFile/.test(rest);
}
const planModeStopsBeforeMutation = (src) => { const body = mainBody(src); return body.includes(PIN_PLAN_STOP) && body.includes(PIN_NO_BASELINE); };
check("main() (comments stripped) sweeps with the exported selector, passes the unit's own slice, assigns its shard split, zero-checks the WHOLE file, keeps no ownership filter or counter of its own, goes from the plan stop straight to the write, the count, the proof run and the restore with nothing between, and checks what each unit wrote against what the selector planned", mainSweepsWithSelector(GUARD_SRC));
{
  const got = forkCountsOf(mainBody(GUARD_SRC));
  check(`main() (comments stripped) names planOnly exactly ${FORK_COUNTS.planOnly} times (found ${got.planOnly}) and reads process.argv ${FORK_COUNTS["process.argv"]} (found ${got["process.argv"]}) and process.env ${FORK_COUNTS["process.env"]} times (found ${got["process.env"]}): a statement that runs only in a real sweep, or a second reading of the plan flag, must edit this pin in review`, forksPinned(mainBody(GUARD_SRC)));
}
check("main()'s --plan mode takes no baseline and records each placement INSTEAD of writing the mutation (the condition for spawning it below)", planModeStopsBeforeMutation(GUARD_SRC));
const withReplaced = (src, from, to) => (src.split(from).length === 2 ? src.replace(from, () => to) : undefined);
// A fixture mutant is a replacement in the real text. When the text it replaces has MOVED, nothing was
// mutated: that is a broken fixture, not a mutant that went undetected, and it must fail by its own
// name (an earlier version fell through to "the mutant is not detected" or to an uncaught throw).
const fixtureText = (src, name, from, to) => {
  const text = withReplaced(src, from, to);
  if (text === undefined) check(`fixture text not found — update the pin (the text it replaces moved or is no longer unique): ${name}`, false);
  return text;
};
const errText = (err) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));
const MAIN_CALL = PIN_SELECT;
for (const [name, from, to] of [
  ["main() ignores the slice (the selector is called without it)", MAIN_CALL, "const plan = selectSliceMutations({ ...target, slice: undefined }, mutationsByFile(target));"],
  ["main() bypasses the selector and filters by itself", MAIN_CALL, "const plan = { files: mutationsByFile(target).map(({ file, mutations }) => ({ file, allCount: mutations.length, owned: mutations.filter((_, i) => sliceOwns(target.slice, i)).map((mutation) => ({ mutation })) })), swept: 0 };"],
  ["main() computes the selection and then walks every mutation of the file instead of what it owns", PIN_FILES, "for (const { file, mutations: all } of mutationsByFile(target)) { const allCount = all.length; const owned = all.map((mutation) => ({ mutation }));"],
  ["main() zero-checks the slice instead of the whole file", PIN_ZERO, "if (owned.length === 0) {"],
  ["main() discards the shard split (every shard sweeps the whole registry)", PIN_SHARD, "shardTargets(targets, i, n);"],
  ["main()'s plan mode falls through to the mutation instead of stopping", "placements.push(placementOf(target, file, ordinal, mutation));\n          continue;", "placements.push(placementOf(target, file, ordinal, mutation));"],
  ["main()'s plan mode takes the baseline", "if (!planOnly) {\n      // See baselineProbe()", "if (true) {\n      // See baselineProbe()"],
  // The sweep after the plan fork: each of these leaves the plan, the selector's run and the earlier text
  // pins as they were. Measured through a stub-driven main(): the first swept 1021 of 2026 mutations and
  // the second 1832, every shard exiting 0; the third dropped every shard's device-management-health slice
  // (1977 of 2026) while --plan still showed 13/12/12/12.
  ["a statement after the plan stop drops half the mutations (the plan and the selector are untouched)", "          continue;\n        }\n        total += 1;", "          continue;\n        }\n        if (mutation.lineNo % 2 === 1) continue;\n        total += 1;"],
  ["a sweep-only splice of the owned list (the plan is untouched)", "      for (const { ordinal, mutation } of owned) {", "      if (!planOnly) owned.splice(0, 1);\n      for (const { ordinal, mutation } of owned) {"],
  ["a sweep-only drop of the first unit (every shard loses its device-management-health slice; the plan is untouched)", "    const slicedUnits = targets.filter", "    if (!planOnly) targets = targets.slice(1);\n    const slicedUnits = targets.filter"],
  ["a mutation is written and restored without its proof run (counted, so the written count alone would not see it)", "        writtenInUnit += 1;\n        let verdict;", "        writtenInUnit += 1;\n        if (mutation.lineNo % 2 === 1) { writeFileSync(mutation.abs, mutation.original); continue; }\n        let verdict;"],
  ["a second reading of the plan flag under another name (a count of planOnly alone cannot see it)", "  const planOnly = process.argv.includes(\"--plan\");", "  const planOnly = process.argv.includes(\"--plan\");\n  const dry = process.argv.includes(\"--plan\");"],
  ["the unit's planned count is rewritten before it is compared (a short sweep would then match it)", "    const swept = plan.swept;\n", "    const swept = plan.swept - 1;\n"],
  ["the written-vs-plan check of each unit is switched off", "if (accounted !== swept) {", "if (false) {"],
  ["the written-vs-plan failure no longer ends the sweep", "for (const m of writeMismatches) console.error(`  ✗ WRITTEN-vs-PLAN  ${m}`);\n    process.exit(1);", "for (const m of writeMismatches) console.error(`  ✗ WRITTEN-vs-PLAN  ${m}`);"],
]) {
  const mutant = fixtureText(GUARD_SRC, name, from, to);
  if (mutant !== undefined) check(`fixture mutant is detected, the gate goes red: ${name}`, mutant !== GUARD_SRC && !mainSweepsWithSelector(mutant));
}

// main() RUN. Each shard of each shard count is planned by the real entrypoint and compared, in
// order, with what the selector gives for the same shard, then the shards of one count are checked
// to cover every registered mutation exactly once. The heavy proof's local slice command
// (`--proof=<heavy proof> --shard=i/4`) is planned too; CI itself runs `--shard=i/4` with no `--proof`,
// which is the N=4 run. Planning parses text and runs no proof.
//
// Then the four shards of the whole registry, and of the heavy proof's local slice command, are SWEPT by
// the real main() with the disk and the proof stubbed (scripts/lib/sweep-stub-preload.mjs: a write is
// recorded instead of performed, a `pnpm run` is answered, nothing is mutated or run), and what each
// sweep WROTE is compared, in order, with what that
// shard's `--plan` listed. The plan is the half of main() that stops before the write; this is the other
// half. Three one-line plants in the sweep path alone (a skip after the plan stop, a `planOnly`-keyed splice
// of `owned`, a `planOnly`-keyed drop of the first unit) left the plan, the selector and every text pin as they
// were and swept 1021, 1832 and 1977 of 2026 mutations with every shard exiting 0. A stubbed child takes about
// 0.2 s, so nothing is sampled: all 2026 mutations are swept this way.
//
// The children cannot hurt the tree they run in. Every child starts with scripts/lib/no-write-preload.mjs: a
// write, rename or removal under the repository, or a spawned process, throws, after a marker line on stderr
// that this gate also fails on (a throw swallowed by a catch is still seen). Before, that was a text pin alone,
// and one plan-mode `writeFileSync` that got past the pins left all 185 registered guard files (deliberately
// broken security guards) mutated on disk after a single gate run. As a second net the registered files are
// hashed before the first child and after the last, and any that moved fail the gate by name. Each child has
// a time limit and the first to run out stops the rest from starting, so a hang fails the gate in about a
// minute instead of after the whole pool had waited its turn (608 s measured, 16 children at 120 s each).
const GUARD_PATH = join(REPO, "scripts/mutation-guard.mjs");
const PRELOAD_NOWRITE_PATH = join(REPO, "scripts/lib/no-write-preload.mjs");
const PRELOAD_NOWRITE = pathToFileURL(PRELOAD_NOWRITE_PATH).href;
const PRELOAD_STUB = pathToFileURL(join(REPO, "scripts/lib/sweep-stub-preload.mjs")).href;
const DENIED_MARKER = "NO-WRITE-DENIED";
const REPORT_MARKER = "SWEEP-STUB-REPORT";
const CHILD_TIMEOUT_SECONDS = 60;
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const REGISTERED_FILES = [...new Set([...TARGETS.flatMap((t) => t.files), "scripts/mutation-guard.mjs"])].sort();
const hashFiles = (root, files) => new Map(files.map((f) => { try { return [f, sha256(readFileSync(join(root, f)))]; } catch { return [f, "unreadable"]; } }));
const movedFiles = (before, after) => [...before.keys()].filter((f) => before.get(f) !== after.get(f));
const digestOf = (hashes) => sha256([...hashes].map(([f, h]) => `${f} ${h}`).join("\n")).slice(0, 16);
const spawnGuard = (preloads, args, env = {}) => new Promise((done) => {
  execFile(process.execPath, [...preloads.flatMap((p) => ["--import", p]), GUARD_PATH, ...args], { cwd: REPO, env: { ...process.env, ...env, NOWRITE_ALLOW: "" }, maxBuffer: 64 * 1024 * 1024, timeout: CHILD_TIMEOUT_SECONDS * 1000, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
    let doc = null;
    try { doc = JSON.parse(stdout); } catch { /* not JSON: the checks below say so */ }
    done({ rc: err === null ? 0 : typeof err.code === "number" ? err.code : 1, stdout, stderr, doc, timedOut: err !== null && err.killed === true && typeof err.code !== "string", denied: stderr.includes(DENIED_MARKER) });
  });
});
const runPlan = (args, env) => spawnGuard([PRELOAD_NOWRITE], ["--plan", ...args], env);
const runStubSweep = (args) => spawnGuard([PRELOAD_NOWRITE, PRELOAD_STUB], args);
// The first child to hit its time limit is remembered; the pool starts no more after it.
let firstHung;
const watched = (label, fn) => async () => {
  const run = await fn();
  if (run.timedOut && firstHung === undefined) firstHung = { ...run, label };
  return run;
};
const inPool = async (jobs, limit) => {
  const out = new Array(jobs.length).fill(undefined);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length && firstHung === undefined) { const k = next; next += 1; out[k] = await jobs[k](); }
  }));
  return out;
};
const hungCheck = (what, runs) =>
  check(`${what} finished: \`${firstHung.label}\` ran past ${CHILD_TIMEOUT_SECONDS} s and was killed, and no further child was started (${runs.filter((r) => r === undefined).length} of ${runs.length} never started)`, false);
const expectedPlan = (registry, i, n) =>
  shardTargets(registry, i, n).flatMap((u) => selectSliceMutations(u, perFileOf(u)).files.flatMap((f) => f.owned.map(({ ordinal, mutation }) => placementOf(u, f.file, ordinal, mutation))));
const briefly = (p) => (p === undefined ? "none" : `${p.unit} ${p.file.split("/").pop()}:${p.line} ${p.mutator} #${p.ordinal}`);
const firstDifference = (got, want) => {
  const k = Array.from({ length: Math.max(got.length, want.length) }, (_, x) => x).find((x) => JSON.stringify(got[x]) !== JSON.stringify(want[x]));
  return k === undefined ? "" : ` (first difference at placement ${k}: ${briefly(got[k])} vs expected ${briefly(want[k])})`;
};
const proofOfUnit = (unit) => unit.replace(/\[\d+\/\d+\]$/, "");
const PLAN_COUNTS = [1, 2, 3, 4];
const dmhTarget = TARGETS.find((t) => t.proof === "proof:device-management-health");

// Fixtures for the two safety nets, before anything is spawned against the real tree.
// (1) The write-denying preload, a COPY of it rooted in a scratch directory (it takes its root from its own
//     location), against a child that tries every kind of write at a file under that root.
{
  const root = mkdtempSync(join(tmpdir(), "sg-nowrite-"));
  const outside = mkdtempSync(join(tmpdir(), "sg-nowrite-out-"));
  try {
    mkdirSync(join(root, "scripts/lib"), { recursive: true });
    copyFileSync(PRELOAD_NOWRITE_PATH, join(root, "scripts/lib/no-write-preload.mjs"));
    writeFileSync(join(root, "victim.txt"), "keep");
    writeFileSync(join(root, "child.mjs"), [
      "import fs from \"node:fs\";",
      "import fsp from \"node:fs/promises\";",
      "import { spawnSync } from \"node:child_process\";",
      "const [victim, free] = process.argv.slice(2);",
      "const out = [];",
      "for (const [name, fn] of [[\"writeFileSync\", () => fs.writeFileSync(victim, \"x\")], [\"promises.writeFile\", () => fsp.writeFile(victim, \"x\")], [\"createWriteStream\", () => fs.createWriteStream(victim)], [\"renameSync\", () => fs.renameSync(victim, `${victim}.b`)], [\"rmSync\", () => fs.rmSync(victim)], [\"spawnSync\", () => spawnSync(\"true\")], [\"outside\", () => fs.writeFileSync(free, \"ok\")]]) {",
      "  try { await fn(); out.push(`${name}:allowed`); } catch { out.push(`${name}:denied`); }",
      "}",
      "console.log(out.join(\",\"));",
    ].join("\n"));
    const r = await new Promise((done) => execFile(process.execPath, ["--import", pathToFileURL(join(root, "scripts/lib/no-write-preload.mjs")).href, join(root, "child.mjs"), join(root, "victim.txt"), join(outside, "free.txt")], { env: { ...process.env, NOWRITE_ALLOW: "" }, timeout: 30_000, killSignal: "SIGKILL" }, (err, stdout, stderr) => done({ stdout: stdout.trim(), stderr })));
    check("fixture: the write-denying preload refuses writeFileSync, promises.writeFile, createWriteStream, renameSync, rmSync and a spawned process under its root, marks stderr, leaves the file as it was, and still lets a write outside its root through",
      r.stdout === "writeFileSync:denied,promises.writeFile:denied,createWriteStream:denied,renameSync:denied,rmSync:denied,spawnSync:denied,outside:allowed"
      && r.stderr.includes(DENIED_MARKER) && readFileSync(join(root, "victim.txt"), "utf8") === "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}
// (2) The before/after comparison of the registered files names a file that moved.
{
  const dir = mkdtempSync(join(tmpdir(), "sg-hash-"));
  try {
    writeFileSync(join(dir, "a.ts"), "one");
    writeFileSync(join(dir, "b.ts"), "two");
    const before = hashFiles(dir, ["a.ts", "b.ts"]);
    const unchanged = movedFiles(before, hashFiles(dir, ["a.ts", "b.ts"]));
    writeFileSync(join(dir, "b.ts"), "TWO");
    const rewritten = movedFiles(before, hashFiles(dir, ["a.ts", "b.ts"]));
    rmSync(join(dir, "a.ts"));
    const removed = movedFiles(before, hashFiles(dir, ["a.ts", "b.ts"]));
    check("fixture: the before/after hash comparison reports nothing when no file moved and names a file that was rewritten or removed",
      unchanged.length === 0 && rewritten.join() === "b.ts" && removed.join() === "a.ts,b.ts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const HASH_BEFORE = hashFiles(REPO, REGISTERED_FILES);
if (!planModeStopsBeforeMutation(GUARD_SRC)) {
  check("main()'s real --plan places every mutation exactly once (NOT RUN: its stop before the mutation is not pinned, and running it could sweep)", false);
} else {
  const jobs = [
    ...PLAN_COUNTS.flatMap((n) => Array.from({ length: n }, (_, i) => ({ n, i, args: [`--shard=${i}/${n}`], registry: TARGETS }))),
    ...(dmhTarget ? Array.from({ length: 4 }, (_, i) => ({ n: 4, i, args: [`--proof=${dmhTarget.proof}`, `--shard=${i}/4`], registry: [dmhTarget], only: dmhTarget.proof })) : []),
  ];
  const runs = await inPool(jobs.map((j) => watched(`--plan ${j.args.join(" ")}`, () => runPlan(j.args))), 4);
  if (firstHung !== undefined) {
    hungCheck("main()'s real --plan", runs);
  } else {
    const judged = jobs.map((j, k) => {
      const run = runs[k];
      const want = expectedPlan(j.registry, j.i, j.n);
      const got = run.doc?.placements ?? [];
      const ok = run.rc === 0 && !run.denied && run.doc !== null && run.doc.shard === `${j.i}/${j.n}` && run.doc.proof === (j.only ?? null)
        && run.doc.count === got.length && JSON.stringify(got) === JSON.stringify(want);
      if (!ok) console.error(`    plan ${j.args.join(" ")}: rc=${run.rc}, ${run.denied ? `a write or spawn was attempted and refused (${run.stderr.split("\n").find((l) => l.includes(DENIED_MARKER)) ?? DENIED_MARKER})` : run.doc === null ? `stdout is not JSON (${run.stderr.trim().split("\n").pop() ?? ""})` : `${got.length} placements vs ${want.length} expected${firstDifference(got, want)}`}`);
      return { ...j, got, want, ok };
    });
    // A mutation is keyed by its identity (proof, file, line, mutator), never by the ordinal main()
    // reports: a wrong ordinal must not be able to make a repeated mutation look like a distinct one.
    const onceAndTotal = (set, expected) => {
      const seen = new Map();
      for (const p of set) {
        const id = `${proofOfUnit(p.unit)}|${p.file}|${p.line}|${p.mutator}`;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      }
      return { placed: set.length, distinct: seen.size, ok: set.length === expected && seen.size === expected && [...seen.values()].every((c) => c === 1) };
    };
    for (const n of PLAN_COUNTS) {
      const mine = judged.filter((j) => j.n === n && j.only === undefined);
      const expected = TARGETS.reduce((sum, t) => sum + totalOf(t), 0);
      const u = onceAndTotal(mine.flatMap((j) => j.got), expected);
      check(`N=${n}: main()'s real --plan, shards 0..${n - 1}, plans exactly what the selector gives and every registered mutation exactly once (${u.placed} placements, ${u.distinct} distinct, ${expected} registered)`,
        mine.length === n && mine.every((j) => j.ok) && u.ok);
    }
    const quarter = judged.find((j) => j.n === 4 && j.i === 0 && j.only === undefined);
    const whole = TARGETS.reduce((sum, t) => sum + totalOf(t), 0);
    check(`main()'s --plan for shard 0/4 is a strict subset of the sweep (${quarter?.got.length} of ${whole} mutations, ${expectedPlan(TARGETS, 0, 4).length} expected), so the shard split is in effect`,
      quarter !== undefined && quarter.ok && quarter.got.length > 0 && quarter.got.length < whole);
    if (dmhTarget) {
      const mine = judged.filter((j) => j.only === dmhTarget.proof);
      const u = onceAndTotal(mine.flatMap((j) => j.got), totalOf(dmhTarget));
      check(`main()'s real --plan for the local slice command (--proof=${dmhTarget.proof} --shard=i/4) holds ${mine.map((j) => j.got.length).join("+")} = ${u.placed} of ${totalOf(dmhTarget)} mutations, each once`,
        mine.length === 4 && mine.every((j) => j.ok) && u.ok);
    }
    // The split is computed independently on every runner, so the REAL entrypoint must not depend on the
    // machine: same bytes under a different locale and time zone.
    const shardOne = judged.find((j) => j.n === 4 && j.i === 1 && j.only === undefined);
    const localeRuns = await inPool([
      watched("--plan --shard=1/4 (LC_ALL=C TZ=UTC)", () => runPlan(["--shard=1/4"], { LC_ALL: "C", LANG: "C", TZ: "UTC" })),
      watched("--plan --shard=1/4 (LC_ALL=tr_TR.UTF-8 TZ=Pacific/Kiritimati)", () => runPlan(["--shard=1/4"], { LC_ALL: "tr_TR.UTF-8", LANG: "tr_TR.UTF-8", TZ: "Pacific/Kiritimati" })),
    ], 2);
    if (firstHung !== undefined) {
      hungCheck("main()'s real --plan under another locale and time zone", localeRuns);
    } else {
      const [plainRun, [utcRun, farRun]] = [runs[judged.indexOf(shardOne)], localeRuns];
      check("main()'s --plan is byte-identical under LC_ALL=C TZ=UTC and under LC_ALL=tr_TR.UTF-8 TZ=Pacific/Kiritimati (independent runners each compute the split)",
        plainRun.rc === 0 && utcRun.rc === 0 && farRun.rc === 0 && plainRun.stdout !== "" && utcRun.stdout === plainRun.stdout && farRun.stdout === plainRun.stdout);
    }

    // The sweep half. The mutations a stubbed sweep of each shard WRITES, in order, against what that
    // shard's own `--plan` listed (content hashes: a write is the whole mutated file). A stubbed child takes
    // about 0.2 s, so this is not a sample: the whole registry at N=4 (2026 mutations over four shards) and the
    // heavy proof's local slice command.
    if (firstHung === undefined) {
      const sweepJobs = [
        ...Array.from({ length: 4 }, (_, i) => ({ i, args: [`--shard=${i}/4`], registry: TARGETS })),
        ...(dmhTarget ? Array.from({ length: 4 }, (_, i) => ({ i, args: [`--proof=${dmhTarget.proof}`, `--shard=${i}/4`], registry: [dmhTarget], only: dmhTarget.proof })) : []),
      ];
      const sweeps = await inPool(sweepJobs.map((j) => watched(`sweep ${j.args.join(" ")} (stubbed)`, () => runStubSweep(j.args))), 4);
      if (firstHung !== undefined) {
        hungCheck("main()'s stubbed sweep", sweeps);
      } else {
        const contentHash = new Map();
        for (const t of TARGETS) for (const f of mutationsByFile(t)) for (const m of f.mutations) contentHash.set(`${f.file}|${m.lineNo}|${m.mutator}`, sha256(m.content));
        const sweepJudged = sweepJobs.map((j, k) => {
          const run = sweeps[k];
          const planned = (judged.find((p) => p.n === 4 && p.i === j.i && p.only === j.only)?.got ?? []).map((p) => `${p.file}|${contentHash.get(`${p.file}|${p.line}|${p.mutator}`) ?? "unknown"}`);
          const reportLine = run.stderr.split("\n").find((l) => l.startsWith(`${REPORT_MARKER} `));
          let report = null;
          try { report = reportLine === undefined ? null : JSON.parse(reportLine.slice(REPORT_MARKER.length + 1)); } catch { /* no report: the check below says so */ }
          const written = (report?.writes ?? []).map((w) => `${w.file}|${w.sha256}`);
          const summary = `mutations=${planned.length} killed=${planned.length} hung=0 known-inert=0 survivors=0`;
          const runsWanted = shardTargets(j.registry, j.i, 4).length + planned.length;
          const ok = run.rc === 0 && !run.denied && report !== null && planned.length > 0 && JSON.stringify(written) === JSON.stringify(planned)
            && report.dirty === 0 && report.proofRuns === runsWanted && run.stdout.includes(summary);
          if (!ok) {
            const x = Array.from({ length: Math.max(written.length, planned.length) }, (_, y) => y).find((y) => written[y] !== planned[y]);
            const brief = (w) => (w === undefined ? "none" : `${w.split("|")[0].split("/").pop()} ${w.split("|")[1].slice(0, 8)}`);
            console.error(`    stubbed sweep ${j.args.join(" ")}: rc=${run.rc}, ${report === null ? `no report (${run.stderr.trim().split("\n").pop() ?? ""})` : `${written.length} written vs ${planned.length} planned${x === undefined ? "" : ` (first difference at ${x}: ${brief(written[x])} vs planned ${brief(planned[x])})`}, dirty=${report.dirty}, proof runs=${report.proofRuns} (expected ${runsWanted})`}${run.stdout.includes(summary) ? "" : `, no \`${summary}\``}`);
          }
          return { ...j, written, ok };
        });
        for (const [what, mine, registered] of [
          ["the whole registry", sweepJudged.filter((j) => j.only === undefined), whole],
          ...(dmhTarget ? [[dmhTarget.proof, sweepJudged.filter((j) => j.only === dmhTarget.proof), totalOf(dmhTarget)]] : []),
        ]) {
          const writtenTotal = mine.reduce((n, j) => n + j.written.length, 0);
          check(`main()'s REAL sweep of ${what} with the disk and the proof stubbed, shards 0..3 of 4, writes exactly the mutations each shard's --plan lists, in order, restores every one, runs the proof once per mutation and once per unit for its baseline, and exits 0 (${mine.map((j) => j.written.length).join("+")} = ${writtenTotal} of ${registered} written)`,
            mine.length === 4 && mine.every((j) => j.ok) && writtenTotal === registered);
        }
      }
    }
  }
}
// Whatever the children did, the files they could have mutated are the files they started with.
{
  const after = hashFiles(REPO, REGISTERED_FILES);
  const moved = movedFiles(HASH_BEFORE, after);
  for (const f of moved) console.error(`    MOVED by a spawned child: ${f}`);
  check(`the ${REGISTERED_FILES.length - 1} registered guard files and the guard itself hash identically before and after every spawned child (digest ${digestOf(HASH_BEFORE)} before, ${digestOf(after)} after)${moved.length ? ` — MOVED: ${moved.slice(0, 4).join(", ")}${moved.length > 4 ? `, +${moved.length - 4} more` : ""}` : ""}`, moved.length === 0);
}

// The function's own text, mutated, loaded as a module and run through the SAME coverage() the real
// registry gets. The fixture registry is built from real files and holds one target spread over
// SEVERAL files and cut into three slices, because the ordinal only matters when it has to carry
// across a file boundary and a slice only matters when the target is cut.
const fnText = (src, name) => {
  const start = src.indexOf(`export function ${name}(`);
  const end = src.indexOf("\n}\n", start);
  return start < 0 || end < 0 ? undefined : src.slice(start, end + 3);
};
const loadSelector = async (code) => (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)).selectSliceMutations;
const SELECTOR_TEXT = [fnText(GUARD_SRC, "sliceOwns"), fnText(GUARD_SRC, "selectSliceMutations")];
const selectorExtracted = SELECTOR_TEXT.every((x) => typeof x === "string");
check("the selector and the ownership rule it calls can be extracted from mutation-guard.mjs", selectorExtracted);
if (selectorExtracted) {
  const seen = new Set();
  const smallFiles = TARGETS.flatMap((t) => t.files.filter((f) => !seen.has(f) && seen.add(f) && t.oneLine !== true && parseOnce(f, {}).length >= 3 && parseOnce(f, {}).length <= 40));
  const fxFiles = smallFiles.slice(0, 3);
  const fxTotal = fxFiles.reduce((n, f) => n + parseOnce(f, {}).length, 0);
  check(`fixture: three real multi-mutation files exist to span a target (${fxFiles.length} files, ${fxTotal} mutations)`, fxFiles.length === 3 && fxTotal >= 9 && fxTotal <= 300);
  if (fxFiles.length === 3 && fxTotal >= 9 && fxTotal <= 300) {
    const multi = { proof: "proof:fx-multi", files: fxFiles, runSeconds: Math.ceil((2.5 * MAX_UNIT_SECONDS) / fxTotal) };
    const fxReg = [multi, ...TARGETS.filter((t) => t.runSeconds === undefined).slice(0, 3)];
    const selectorHolds = (select) =>
      [1, 2, 3, 4, 5, 7].every((n) => {
        const c = coverage(fxReg, n, mutationTotal, undefined, select);
        return c.once && c.placed === c.expected && c.distinct === c.expected && c.proofsPlaced === fxReg.length && c.allCountsWhole && c.ordinalsTrue;
      });
    const sliced = shardTargets(fxReg, 0, 1).filter((u) => u.proof === "proof:fx-multi");
    check(`fixture: the multi-file target is cut into ${sliced.length} slices, so the ordinal has to carry across files`, sliced.length === 3 && sliced.every((u) => u.slice !== undefined));
    // A battery that THROWS on a selector is a verdict on that selector, never a crash of the gate: a
    // mutant that throws is detected (it does not do the job), the real selector and the control that
    // throw are failures with the reason printed.
    const verdictOf = (select) => {
      try { return { holds: selectorHolds(select) }; } catch (err) { return { holds: false, threw: errText(err) }; }
    };
    const real = verdictOf(selectSliceMutations);
    check(`the real selector loses and repeats no mutation, reports true ordinals and keeps each file's whole count, on the multi-file fixture${real.threw ? ` — it threw: ${real.threw}` : ""}`, real.holds);
    let control;
    let controlError = "";
    try { control = verdictOf(await loadSelector(SELECTOR_TEXT.join("\n"))); } catch (err) { controlError = errText(err); }
    check(`control: the selector's own text, extracted and loaded back as a module, passes the same battery (so a red below is the mutant, not the harness)${controlError ? ` — it did not load: ${controlError}` : control?.threw ? ` — it threw: ${control.threw}` : ""}`, control?.holds === true);
    for (const [name, from, to] of [
      ["the ordinal advances by the FILTERED count (mutations skipped and repeated, every shard exits 0)", "ordinal += all.length;", "ordinal += owned.length;"],
      ["the slice is ignored (every unit sweeps the whole target)", "sliceOwns(target.slice, ordinal + i)", "sliceOwns(undefined, ordinal + i)"],
      ["allCount is the FILTERED count (a file with mutations the slice does not own reads as empty)", "allCount: all.length", "allCount: owned.length"],
      ["the reported ordinal restarts in each file (its numbers stop being positions in the target)", "owned.push({ ordinal: ordinal + i, mutation: all[i] })", "owned.push({ ordinal: i, mutation: all[i] })"],
    ]) {
      const text = fixtureText(SELECTOR_TEXT[1], name, from, to);
      if (text === undefined) continue;
      let verdict;
      try { verdict = verdictOf(await loadSelector([SELECTOR_TEXT[0], text].join("\n"))); } catch (err) {
        check(`fixture could not be built (the mutant does not load: ${errText(err)}): ${name}`, false);
        continue;
      }
      check(`fixture mutant of the selector is detected, the gate goes red${verdict.threw ? ` (by a throw: ${verdict.threw})` : ""}: ${name}`, text !== SELECTOR_TEXT[1] && verdict.holds === false);
    }
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
// The run line may carry `--shard=` and `--proof=` and nothing else. `--plan` is accepted by the script (it is how
// this gate observes main()), and on the run line it turns every shard into a green no-op: a JSON plan, exit 0, no
// proof run. Before `--plan` existed any extra flag exited 1 through unknownArgs, so the gate has to refuse the one
// flag the script now accepts. Only the command that runs mutation-guard.mjs is read (a multi-line `run:` may hold
// others), and the substring test on that command is a second net for a flag spelled across a template expression.
const guardCommandsOf = (run) => String(run ?? "").split("\n").flatMap((l) => {
  const at = l.indexOf("mutation-guard.mjs");
  return at < 0 ? [] : [l.slice(at + "mutation-guard.mjs".length)];
});
const refusedRunFlags = (run) => [...new Set(guardCommandsOf(run).flatMap((cmd) => [
  ...cmd.split(/&&|\|\||;|\|/)[0].split(/\s+/).filter((t) => t.startsWith("-") && t !== "--" && !/^--(shard|proof)=\S+$/.test(t)),
  ...(cmd.includes("--plan") ? ["--plan"] : []),
]))];
check(`workflow: the mutation-sweep run line passes no flag but --shard=/--proof= and never --plan${refusedRunFlags(runLine).length ? ` — it passes ${refusedRunFlags(runLine).join(" ")}` : ""}`, runLine !== undefined && refusedRunFlags(runLine).length === 0);
{
  const refused = (run) => refusedRunFlags(run).join();
  check("fixture: the run-line check refuses --plan (before the shard, after it, or spelled through a template expression), --help and -h, and passes the real run line and a --proof= line beside another command",
    refused("node scripts/mutation-guard.mjs --shard=${{ matrix.shard }}/4") === ""
    && refused("node scripts/mutation-guard.mjs --plan --shard=${{ matrix.shard }}/4") === "--plan"
    && refused("node scripts/mutation-guard.mjs --shard=${{ matrix.shard }}/4 --plan") === "--plan"
    && refused("node scripts/mutation-guard.mjs --shard=${{ matrix.shard }}/4${{ '--plan' }}") === "--plan"
    && refused("node scripts/mutation-guard.mjs --shard=${{ matrix.shard }}/4 --help") === "--help"
    && refused("node scripts/mutation-guard.mjs --shard=${{ matrix.shard }}/4 -h") === "-h"
    && refused("pnpm install --frozen-lockfile\nnode scripts/mutation-guard.mjs --proof=proof:x --shard=0/4") === "");
}
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
check("known flags (--proof=, --shard=, --plan) and pnpm's forwarded bare -- are accepted; --plan takes no value", unknownArgs(["--", "--proof=proof:x", "--shard=0/4", "--plan"]).length === 0 && unknownArgs(["--plan=1"]).length === 1 && unknownArgs(["--Plan"]).length === 1);

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
