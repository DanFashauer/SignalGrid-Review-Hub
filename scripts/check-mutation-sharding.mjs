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
 *        the number of places main() forks on the plan flag, leaves a unit or the run early
 *        (continue, break, return, throw, exit) or touches the list the loop walks is pinned, and
 *        every read of the clock, the process (arguments, environment, identity, platform, any
 *        member) and the machine is counted over the WHOLE file, helpers included, because a skip
 *        in `selectSliceMutations` or `shardTargets` keyed on a time budget or on an empty
 *        `process.execArgv` is read by none of main()'s own counts.
 *        At runtime each unit's written count is checked against the selector's own (the one
 *        net no text pin gives), the selector's own count against the slice ARITHMETIC (the
 *        registry's mutation count and the slice: `PLAN-vs-SIZE`, because a selector that
 *        returns nothing agrees with its own zero), and each UNIT is accounted for: the names a run is to sweep are
 *        computed from its arguments before the loop, every unit that reaches its count prints
 *        `unit-done <unit> written=<n> planned=<m>`, and one that never did is named
 *        `UNIT-SKIPPED` (exit 1). A unit skipped on a time budget, a cost-drift warning or the
 *        runner's environment has no count to fail and takes none of the stub's paths, so this
 *        gate compares the SET of units that printed a line with the units each shard holds, in
 *        the plan and in the stubbed sweep;
 *     e. one mutant is made to SURVIVE its proof in the stubbed sweep, the one branch a
 *        kill-everything stub never takes: it must be reported, not counted as known-inert, and
 *        end the sweep with exit 1.
 *     Each has fixture mutants that must go red, and a fixture that cannot be built fails the gate
 *     by name instead of passing or crashing it.
 *
 *     Every child runs under scripts/lib/no-write-preload.mjs (a write, a permission or time
 *     change, a hard link, a spawned process, a worker thread, `process.binding`, `execve` or
 *     `dlopen` under or from the repository throws; a path is judged where it LANDS, through
 *     symlinks to files that do not exist yet and `..` after a link; every `process.report`
 *     setting is refused), loaded through NODE_OPTIONS so that the child sees the empty
 *     `process.execArgv` a CI step gives it, `git status --untracked-files=all` and a hash
 *     of every file it names are compared before the first child and after the last (the whole
 *     tree, with the differing paths named: the preload lists the routes known, this is the net
 *     under the rest), and each child has a time limit that stops the pool at the first hang. The
 *     workflow's sweep step must be exactly one `run:` line whose only expression is
 *     `${{ matrix.shard }}`, with only `name` and `run` on the step and nothing in the job or
 *     before it that could change what runs (every shard would otherwise be a green no-op): the
 *     job holds `name`, `runs-on` (the literal ubuntu-latest), `timeout-minutes`, `strategy`
 *     (`fail-fast` and a matrix of `shard` alone, a plain list of 0..N-1) and `steps`, with an
 *     `env` only as a plain mapping of literals, and no `needs`, `container`, `services`, `if`.
 *
 * (2) a target that registers a cost heavier than one unit is in fact sliced;
 *
 * (3) no shard's REGISTERED load exceeds 80% of the sweep job's own `timeout-minutes`. (3) exists
 *     because the sweep was balanced by mutation count while one proof cost 45x the others per
 *     mutation, and shard 3 sat over its 40-minute bound for a week (see mutation-guard.mjs, WHY
 *     THE SHARDS ARE BALANCED BY COST). An unregistered cost is invisible to this gate by
 *     construction; the sweep's own COST DRIFT line is the net for that.
 */
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants as fsConstants, copyFileSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isBuiltin } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";
import { TARGETS, ALLOWED, shardTargets, mutationsFor, MUTATORS, lineMutations, unknownArgs, resolveAllowedLine, allowlistProblem, auditAllowlist, allowlistFailureCount, isAllowed, DEFAULT_RUN_SECONDS, MAX_UNIT_SECONDS, runSecondsOf, mutationTotal, sliceOwns, sliceSize, sliceCount, unitWeight, costDrifted, mutationsByFile, selectSliceMutations, unitName, placementOf, expectedUnitNames, unitAccountingProblems } from "./mutation-guard.mjs";
import { scratchGitOk, scrubProcessGitEnv } from "./lib/scratch-git.mjs";

// A caller's GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE must not point the whole-tree write net (treeSnapshot of REPO) at another repository.
scrubProcessGitEnv();
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
// `blankStrings` also blanks the inside of '...' and "..." strings (not of template literals, whose `${}` holds code): the
// ambient counts below count code, and a word in a message or an allowlist reason is not a read of the clock.
function stripComments(src, blankStrings = false) {
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
      out += blankStrings ? `${c}${src.slice(i + 1, j).replace(/[^\n]/g, " ")}${src.slice(j, j + 1)}` : src.slice(i, j + 1); i = j + 1; prev = c;
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
  && stripComments("s.replace(/^p:/, \"\") // tail\nx = a / b; // t") === "s.replace(/^p:/, \"\") \nx = a / b; "
  && stripComments("a('word', \"word.call()\", `${word.call()} text`, \"it\\\"s\") // tail", true) === "a('    ', \"           \", `${word.call()} text`, \"     \") ");
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
const PIN_COUNT_CHECK = foldPin("const accounted = writtenInUnit + (placements.length - placedBefore); if (accounted !== swept) { const line = `${unitName(target)}: ${accounted} mutations written, the selector planned ${swept}`; writeMismatches.push(line); console.error(`   ✗ WRITTEN-vs-PLAN  ${line}`); process.exitCode = 1; } countedUnits.push(unitName(target)); log(`unit-done ${unitName(target)} written=${accounted} planned=${swept}`);");
const PIN_MISMATCH_EXIT = foldPin("if (writeMismatches.length > 0) { console.error(\"\\nMutation guard FAILED — the sweep did not write what the plan selected, so the counts above are over a different set than the one the shards were balanced for:\\n\"); for (const m of writeMismatches) console.error(`  ✗ WRITTEN-vs-PLAN  ${m}`); process.exit(1); }");
// The net under the count: a unit that never started has no count to fail. The names a run is to sweep come from
// the arguments, before the loop and not from `targets`; each unit that reaches its count (or fails its baseline) is
// recorded; what is neither is named and ends the run before the survivor report. The loop head, the list it walks,
// the baseline failure's record and the verdict handling are pinned too, because a statement that rewrites any of
// them can drop a unit (or a mutation's verdict) without touching the count.
const PIN_TARGETS_INIT = "let targets = only ? TARGETS.filter((t) => t.proof === only) : [...TARGETS];";
const PIN_EXPECTED = "const expectedUnits = expectedUnitNames(TARGETS, only, shardArg);";
const PIN_LOOP_HEAD = "for (const target of targets) {";
const PIN_BASELINE_FAIL = foldPin("baselineFailures.push(base); failedBaselineUnits.push(unitName(target));");
const PIN_UNIT_PROBLEMS = foldPin("const unitProblems = unitAccountingProblems(expectedUnits, countedUnits, failedBaselineUnits); for (const problem of unitProblems) console.error(`✗ ${problem}`); if (unitProblems.length > 0) process.exitCode = 1;");
const PIN_UNIT_EXIT = foldPin("if (unitProblems.length > 0) { console.error(\"\\nMutation guard FAILED — the sweep did not cover the units it was to cover, so the counts above are over fewer (or other) units than the shards were balanced for:\\n\"); for (const problem of unitProblems) console.error(`  ✗ ${problem}`); process.exit(1); }");
const PIN_VERDICT = foldPin(`if (verdict === "killed") { killed += 1; } else if (verdict === "hung") { hung += 1; console.log(\`   ⚠ HANG  \${file}:\${mutation.lineNo}  \${mutation.describe}\`); console.log("           (detected, but its CI failure mode is a job timeout rather than a red assertion)"); } else { const entry = isAllowed(mutation); if (entry) { allowed += 1; } else { survivors.push(mutation); console.log(\`   ✗ SURVIVED  \${file}:\${mutation.lineNo}  \${mutation.describe}\`); } }`);
// The arithmetic net under the selector. Both nets above agree with themselves when the selector returns NOTHING: the unit writes 0 of 0 planned, prints its
// `unit-done` line, and the unit accounting is satisfied. So each unit's planned count is also held to `sliceSize(mutationTotal(target), target.slice)`, which
// depends on the target and the slice alone, and a difference ends the run before the survivor report. (A condition on elapsed time at the top of the exported
// selector that returns an empty selection swept 13 of 475 mutations in a CI-shaped run, every later unit printing `written=0 planned=0`, rc 0.)
const PIN_SIZE_CHECK = foldPin("const sized = sliceSize(mutationTotal(target), target.slice); if (plan.swept !== sized) { const line = `${unitName(target)}: selector planned ${plan.swept}, the slice arithmetic says ${sized}`; sizeMismatches.push(line); console.error(`   ✗ PLAN-vs-SIZE ${line}`); process.exitCode = 1; }");
const PIN_SIZE_EXIT = foldPin("if (sizeMismatches.length > 0) { console.error(\"\\nMutation guard FAILED — a unit's selection is not the size its slice holds, so the counts above are over a different set than the one the shards were balanced for:\\n\"); for (const m of sizeMismatches) console.error(`  ✗ PLAN-vs-SIZE ${m}`); process.exit(1); }");
const MAIN_PINS = [PIN_SELECT, PIN_SHARD, PIN_FILES, PIN_ZERO, PIN_PLAN_STOP, PIN_NO_BASELINE, PIN_COUNT_INIT, PIN_COUNT_CHECK, PIN_MISMATCH_EXIT, PIN_SIZE_CHECK, PIN_SIZE_EXIT, PIN_TARGETS_INIT, PIN_EXPECTED, PIN_LOOP_HEAD, PIN_BASELINE_FAIL, PIN_UNIT_PROBLEMS, PIN_UNIT_EXIT, PIN_VERDICT];
// A new plan/sweep fork, and a new way to leave a unit (or the run) early, has to be reviewed, so the number of
// places main() names the plan flag, reads its arguments and environment, skips, breaks, returns, throws or exits,
// and touches the list the loop walks, is pinned. `planOnly` today: the declaration, the log alias, the empty-shard
// guard, the baseline guard, the loop stop and the final print. (`if (!planOnly) owned.splice(0, 1);` before the owned
// loop swept 1832 of 2026; `if (!planOnly) targets = targets.slice(1);` dropped every shard's device-management-health
// slice while --plan still showed 13/12/12/12; a second `process.argv.includes("--plan")` under another name would
// escape a count of the first.) The rest were found the same way, by a plant that left every other net green:
//   continue: the baseline failure and the plan stop. `if (baselineSeconds > 40) continue;` skipped a unit when its
//     baseline ran long (device-management-health, 30-46 s on a runner), and `continue;` after the cost-drift warning
//     skipped a drifted proof: a shard swept 462 of 475 and another swept `mutations=0`, both exiting 0.
//   break, return, throw, process.exit(, process.exitCode: a time budget that ends the loop, or the run, early.
//   targets (assigned, and named at all), TARGETS (the registry itself): `targets = targets.slice(1)` keyed on the
//     runner's environment, and `targets.splice(0, 1)`, which an assignment count does not see.
//   try, catch: a catch around the unit's body that swallows what drops it.
//   if, else, for, while, switch, ?:, &&, ||: any new branch or loop, which is how a unit's body is wrapped in a condition
//     (`if (<runner state>) { ...the sweep... }`) without a `continue`, a `break` or a second name for the list.
//   countedUnits, failedBaselineUnits, expectedUnits, unitProblems: a skipped unit recorded as done, or the list it is
//     held to shortened.
const FORK_COUNTS = {
  planOnly: 6, "process.argv": 4, "process.env": 1,
  continue: 2, break: 0, return: 3, throw: 0, try: 2, catch: 2, "process.exit(": 9, "process.exitCode": 4,
  "targets =": 2, targets: 16, TARGETS: 8,
  if: 26, else: 5, for: 12, while: 0, switch: 0, "?": 9, "&&": 1, "||": 0,
  countedUnits: 3, failedBaselineUnits: 3, expectedUnits: 2, unitProblems: 5,
};
const FORK_PATTERNS = {
  planOnly: /\bplanOnly\b/g, "process.argv": /\bprocess\.argv\b/g, "process.env": /\bprocess\.env\b/g,
  continue: /\bcontinue\b/g, break: /\bbreak\b/g, return: /\breturn\b/g, throw: /\bthrow\b/g, try: /\btry\s*\{/g, catch: /\bcatch\b/g,
  "process.exit(": /\bprocess\.exit\(/g, "process.exitCode": /\bprocess\.exitCode\b/g,
  "targets =": /\btargets\s*[-+*/|&]?=(?![=>])/g, targets: /\btargets\b/g, TARGETS: /\bTARGETS\b/g,
  if: /\bif\s*\(/g, else: /\belse\b/g, for: /\bfor\s*\(/g, while: /\bwhile\s*\(/g, switch: /\bswitch\s*\(/g, "?": /\?(?![.?])/g, "&&": /&&/g, "||": /\|\|/g,
  countedUnits: /\bcountedUnits\b/g, failedBaselineUnits: /\bfailedBaselineUnits\b/g, expectedUnits: /\bexpectedUnits\b/g, unitProblems: /\bunitProblems\b/g,
};
const forkCountsOf = (body) => Object.fromEntries(Object.entries(FORK_PATTERNS).map(([name, re]) => [name, (body.match(re) ?? []).length]));
const forksPinned = (body) => { const got = forkCountsOf(body); return body !== "" && Object.entries(FORK_COUNTS).every(([name, n]) => got[name] === n); };
// Outside main() the file may not learn the environment, the clock or the process, or load code by a route the counts above cannot see: a
// module-level `typeof process["en" + "v"].NOWRITE_ALLOW === "string"` read in one place and acted on in main() as
// `if (!UNDER_GATE) targets = targets.slice(1)` kept a runner-only skip out of every net but the `targets =` count. The same holds for the helpers main()
// calls, which main()'s own counts never see: a ten-minute budget on elapsed time at the top of `selectSliceMutations` that returns an empty selection (not aware of the
// gate at all), and `process.execArgv.length === 0` in `shardTargets` or the selector (a CI step has no execArgv, the gate's children had two), each left the gate
// at 224/224 and, in a CI-shaped run, swept 13 of 475 mutations, 490 with the heavy proof's slice missing, or 462 with every later unit printing
// `written=0 planned=0`, every shard exiting 0. So every read of the clock, of the process (its arguments, environment, identity, platform, anything else on
// `process`), of the machine (`os`), of the module's own location and of the file system is counted over the WHOLE file, comments stripped, and a count that moves
// goes red; as are the import statements, and any use of a timer, entropy or locale. The environment is read once in the whole file, in main(), for GITHUB_ACTIONS.
const AMBIENT_COUNTS = {
  "process[": 0, "process.env": 1, globalThis: 0, getBuiltinModule: 0, eval: 0, "new Function": 0, "import(": 0, "require(": 0,
  performance: 5, "performance (not .now())": 0, Date: 0, "high-resolution time": 0,
  "process.execArgv": 0, "process.argv": 6, "process.pid": 0, "process.platform": 0, "os.": 0,
  "import.meta": 2, readFileSync: 3, writeFileSync: 3, spawnSync: 2, Function: 0, "timers, entropy, locale": 0,
};
const AMBIENT_PATTERNS = {
  "process[": /\bprocess\s*\[/g, "process.env": /\bprocess\.env\b/g, globalThis: /\bglobalThis\b/g, getBuiltinModule: /getBuiltinModule/g, eval: /\beval\s*\(/g, "new Function": /\bnew\s+Function\b/g, "import(": /\bimport\s*\(/g, "require(": /\brequire\s*\(/g,
  performance: /\bperformance\b/g, "performance (not .now())": /\bperformance\b(?!\.now\(\))/g, Date: /\bDate\b/g, "high-resolution time": /h[r]time/g,
  "process.execArgv": /\bprocess\.execArgv\b/g, "process.argv": /\bprocess\.argv\b/g, "process.pid": /\bprocess\.pid\b/g, "process.platform": /\bprocess\.platform\b/g, "os.": /\bos\s*\./g,
  "import.meta": /\bimport\.meta\b/g, readFileSync: /\breadFileSync\b/g, writeFileSync: /\bwriteFileSync\b/g, spawnSync: /\bspawnSync\b/g, Function: /\bFunction\b/g,
  "timers, entropy, locale": /\b(?:Math\.rando[m]|crypto|Atomics|SharedArrayBuffer|WebAssembly|I[n]tl|navigator|setTimeout|setInterval|setImmediate)\b|locale[C]ompare|to[L]ocale\w*/g,
};
// Everything the file does with `process`: these members and no others, and no use of `process` that is not a member access (an alias, an argument, a
// destructuring would hide the members from the counts). Strings are blanked first: `Date` is 0 although four ALLOWED reasons say `Date.parse(null)`.
const PROCESS_MEMBERS = { argv: 6, env: 1, exit: 9, exitCode: 4, stdout: 1 };
const IMPORT_LINES = ['import { readFileSync, writeFileSync } from "node:fs";', 'import { spawnSync } from "node:child_process";', 'import { dirname, join, resolve } from "node:path";', 'import { fileURLToPath } from "node:url";'];
const IMPORT_SPECIFIERS = ["node:child_process", "node:fs", "node:path", "node:url"];
const processReadsOf = (text) => {
  const members = {};
  for (const m of text.matchAll(/\bprocess\s*\.\s*([A-Za-z_$][\w$]*)/g)) members[m[1]] = (members[m[1]] ?? 0) + 1;
  return { members, bare: (text.match(/\bprocess\b/g) ?? []).length - Object.values(members).reduce((a, b) => a + b, 0) };
};
const importsOf = (text) => ({
  lines: (text.match(/^[ \t]*import\b(?!\.|\s*\().*$/gm) ?? []).map((l) => l.trim()),
  specifiers: [...text.matchAll(/\b(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]).sort(),
});
const ambientCountsOf = (src) => { const text = stripComments(src, true); return Object.fromEntries(Object.entries(AMBIENT_PATTERNS).map(([name, re]) => [name, (text.match(re) ?? []).length])); };
const ambientProblems = (src) => {
  const text = stripComments(src, true);
  const got = ambientCountsOf(src);
  const off = Object.entries(AMBIENT_COUNTS).filter(([name, n]) => got[name] !== n).map(([name, n]) => `${name} ${got[name]} (pinned ${n})`);
  const reads = processReadsOf(text);
  const wantMembers = JSON.stringify(Object.entries(PROCESS_MEMBERS).sort());
  if (JSON.stringify(Object.entries(reads.members).sort()) !== wantMembers) off.push(`process members ${JSON.stringify(reads.members)} (pinned ${JSON.stringify(PROCESS_MEMBERS)})`);
  if (reads.bare !== 0) off.push(`process used other than as a member access ${reads.bare} (pinned 0)`);
  const imports = importsOf(stripComments(src));
  if (JSON.stringify(imports.lines) !== JSON.stringify(IMPORT_LINES) || JSON.stringify(imports.specifiers) !== JSON.stringify(IMPORT_SPECIFIERS)) off.push(`imports ${JSON.stringify(imports.lines)} (pinned ${IMPORT_LINES.length} statements from ${IMPORT_SPECIFIERS.join(", ")})`);
  return off;
};
const ambientPinned = (src) => ambientProblems(src).length === 0;
function mainSweepsWithSelector(src) {
  const body = mainBody(src);
  // The words below may appear only inside the pinned statements (the plan records the selector's
  // own ordinal); anywhere else they are a private ownership filter or counter.
  const rest = MAIN_PINS.reduce((b, p) => b.split(p).join(""), body);
  return body !== ""
    && (body.match(/selectSliceMutations\(/g) ?? []).length === 1
    && MAIN_PINS.every((p) => body.includes(p))
    && forksPinned(body)
    && ambientPinned(src)
    && !/sliceOwns\(|ordinal|mutationsFor\(|owned\.length === 0|allInFile/.test(rest);
}
const planModeStopsBeforeMutation = (src) => { const body = mainBody(src); return body.includes(PIN_PLAN_STOP) && body.includes(PIN_NO_BASELINE); };
check("main() (comments stripped) sweeps with the exported selector, passes the unit's own slice, assigns its shard split, zero-checks the WHOLE file, keeps no ownership filter or counter of its own, goes from the plan stop straight to the write, the count, the proof run and the restore with nothing between, checks the selector's count for each unit against the slice arithmetic and what each unit wrote against what the selector planned, records every unit that reached that check, holds the run to the units its arguments select (computed before the loop, not from `targets`), and hands the verdict of each mutation to the survivor list", mainSweepsWithSelector(GUARD_SRC));
{
  const got = forkCountsOf(mainBody(GUARD_SRC));
  const off = Object.entries(FORK_COUNTS).filter(([name, n]) => got[name] !== n).map(([name, n]) => `${name} ${got[name]} (pinned ${n})`);
  check(`main() (comments stripped) holds ${Object.keys(FORK_COUNTS).length} counts of the places it forks on the plan flag, reads its arguments and environment, leaves a unit or the run early (continue ${FORK_COUNTS.continue}, break ${FORK_COUNTS.break}, return ${FORK_COUNTS.return}, throw ${FORK_COUNTS.throw}, try ${FORK_COUNTS.try}, catch ${FORK_COUNTS.catch}, process.exit( ${FORK_COUNTS["process.exit("]}) and touches the list the loop walks (\`targets =\` ${FORK_COUNTS["targets ="]}, \`targets\` ${FORK_COUNTS.targets}, \`TARGETS\` ${FORK_COUNTS.TARGETS}): a statement that runs only in a real sweep, or drops a unit on a time budget, a warning or the runner's environment, must edit this pin in review${off.length ? ` — OFF: ${off.join(", ")}` : ""}`, forksPinned(mainBody(GUARD_SRC)));
  const ambOff = ambientProblems(GUARD_SRC);
  check(`mutation-guard.mjs (comments stripped, WHOLE file, helpers included) reads the clock, the process and the machine in exactly the pinned places: performance ${AMBIENT_COUNTS.performance} (all \`.now()\`), Date ${AMBIENT_COUNTS.Date}, high-resolution time ${AMBIENT_COUNTS["high-resolution time"]}, process.execArgv ${AMBIENT_COUNTS["process.execArgv"]}, process.argv ${AMBIENT_COUNTS["process.argv"]}, process.env ${AMBIENT_COUNTS["process.env"]}, process.pid ${AMBIENT_COUNTS["process.pid"]}, process.platform ${AMBIENT_COUNTS["process.platform"]}, os ${AMBIENT_COUNTS["os."]}, import.meta ${AMBIENT_COUNTS["import.meta"]}, readFileSync ${AMBIENT_COUNTS.readFileSync}, writeFileSync ${AMBIENT_COUNTS.writeFileSync}, spawnSync ${AMBIENT_COUNTS.spawnSync} (each: the import and the calls, so no reading of a stub's identity), Function ${AMBIENT_COUNTS.Function}, \`process\` members ${JSON.stringify(PROCESS_MEMBERS)}, ${IMPORT_LINES.length} import statements, and no timer, entropy, locale, computed-module route (process[, globalThis, getBuiltinModule, eval, new Function, import(), require() all 0)${ambOff.length ? ` — OFF: ${ambOff.join("; ")}` : ""}`, ambOff.length === 0);
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
// The helpers main() calls are not main(): a skip placed there is read by no count of main()'s own. `CI_SHAPED` is the key the round-5 re-check used (a CI step has
// an empty execArgv; the gate's children had two) and `EMPTY_SELECTION` what a selector that sweeps nothing returns.
const SELECTOR_HEAD = "export function selectSliceMutations(target, perFile) {\n";
const SHARDER_HEAD = "export function shardTargets(all, index, count, maxUnitSeconds = MAX_UNIT_SECONDS) {\n";
const CI_SHAPED = "process.execArgv.length === 0 && String(process.argv[1]).endsWith(\"mutation-guard.mjs\")";
// Spelled in pieces so an added-lines search for clock reads in this file finds none.
const spell = (...parts) => parts.join("");
const ELAPSED = spell("perfor", "mance.now()");
const WALL_CLOCK = spell("Da", "te.now()");
const HIGH_RES = spell("process.hr", "time.bigint()");
const EMPTY_SELECTION = "return { files: perFile.map(({ file, mutations }) => ({ file, allCount: mutations.length, owned: [] })), total: perFile.reduce((n, f) => n + f.mutations.length, 0), swept: 0 };";
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
  // A unit skipped on TIME or on the RUNNER, which the stubbed sweep (it answers in microseconds, in an environment the
  // gate builds) cannot take and the count cannot see, because the unit is skipped before its count starts. Each of the
  // first four was measured through main() with a 600 ms delay on the device-management-health proof run: shard 0 swept
  // 462 of 475, the slice 0 of 13, and a drifted proof printed `mutations=0 ... Mutation guard passed`, every exit 0.
  ["n1: a unit is skipped when its baseline runs long (30-46 s for device-management-health on a runner; the stub never does)", "      if (!base.ok) {\n", "      if (baselineSeconds > 40) continue;\n      if (!base.ok) {\n"],
  ["n2: a unit is skipped after the cost-drift warning (the 2026-10-09 failure class, silent again)", "console.log(`::warning title=Mutation sweep cost drift::${note}`);\n", "console.log(`::warning title=Mutation sweep cost drift::${note}`);\n        continue;\n"],
  ["n3: the first unit is dropped when an environment variable the gate sets is absent (a runner-only skip)", "    const slicedUnits = targets.filter", "    if (typeof process.env.NOWRITE_ALLOW !== \"string\") targets = targets.slice(1);\n    const slicedUnits = targets.filter"],
  ["n3b: the first unit is dropped without an assignment (an in-place splice of the list the loop walks)", "    const slicedUnits = targets.filter", "    if (process.argv.length > 99) targets.splice(0, 1);\n    const slicedUnits = targets.filter"],
  ["n3e: the registry itself is shortened in place (the list the unit accounting is computed from)", "    const slicedUnits = targets.filter", "    if (process.argv.length > 99) TARGETS.splice(0, 1);\n    const slicedUnits = targets.filter"],
  ["n3f: the unit's body is wrapped in a catch that swallows what drops it", "    if (!planOnly) {\n      // See baselineProbe()", "    try { if (target.proof === \"x\") continue; } catch { /* swallowed */ }\n    if (!planOnly) {\n      // See baselineProbe()"],
  ["n13: a new condition where no pin looks (nothing pinned is near it)", "  const timings = [];\n", "  const timings = [];\n  if (process.argv.length > 99) { timings.length = 0; }\n"],
  ["n3c: the loop walks a filtered copy of the list (no assignment, no new name)", "for (const target of targets) {", "for (const target of targets.filter((t) => t.proof !== \"proof:device-management-health\")) {"],
  ["n4: a unit is cut short on an in-unit time budget (the count sees this one in a slow run)", "          writeFileSync(mutation.abs, mutation.original);\n        }\n", "          writeFileSync(mutation.abs, mutation.original);\n        }\n        if (writtenInUnit * runSecondsOf(target) > 120) break;\n"],
  ["n5: the sweep ends early with exit 0 on a total time budget", "    if (!planOnly) {\n      // See baselineProbe()", "    if (timings.length > 20) return;\n    if (!planOnly) {\n      // See baselineProbe()"],
  ["n6: the sweep exits 0 on a total time budget", "    if (!planOnly) {\n      // See baselineProbe()", "    if (timings.length > 20) process.exit(0);\n    if (!planOnly) {\n      // See baselineProbe()"],
  ["n7: a unit that is skipped is recorded as done (the unit accounting is satisfied by its own record)", "      if (!base.ok) {\n", "      if (baselineSeconds > 40) { countedUnits.push(unitName(target)); continue; }\n      if (!base.ok) {\n"],
  ["n8: the list the loop is held to is shortened after it is computed", "  log(\"Mutation guard — every registered guard must be falsifiable by its own proof\\n\");\n", "  if (process.argv.length > 99) expectedUnits.pop();\n  log(\"Mutation guard — every registered guard must be falsifiable by its own proof\\n\");\n"],
  ["n9: the unit accounting no longer sets the exit code", "if (unitProblems.length > 0) process.exitCode = 1;", ""],
  ["n10: the unit accounting no longer ends the sweep before the survivor report", "for (const problem of unitProblems) console.error(`  ✗ ${problem}`);\n    process.exit(1);", "for (const problem of unitProblems) console.error(`  ✗ ${problem}`);"],
  ["n11: a mutation that survives its proof is counted as known-inert", "            survivors.push(mutation);\n", "            allowed += 1;\n"],
  ["n12: a unit's baseline failure is no longer recorded for the unit accounting", "        failedBaselineUnits.push(unitName(target));\n", ""],
  ["n3d: the environment is read at module level through a computed key (nothing in main() names it)", "\nfunction main() {", "\nconst UNDER_GATE = typeof process[\"en\" + \"v\"].NOWRITE_ALLOW === \"string\";\nfunction main() {"],
  // Skips in the exported helpers, where main()'s own counts do not look. Each of g1 to g3 was measured through the real main() in a CI-shaped run (stubs and a
  // 600 ms device-management-health delay through NODE_OPTIONS, so execArgv is empty) with the gate at 224/224: g3 swept 13 of 475 mutations, g1 490 with the heavy
  // proof's slice absent, g2 462 with `unit-done ... written=0 planned=0` for it, every exit 0. The runtime nets agree with a helper that is wrong the same way in
  // every place they look, so the helpers' reads of the clock and the process are pinned, and the unit's planned count is held to the slice arithmetic.
  ["g3: the selector returns an empty selection after a time budget (not aware of the gate at all)", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (${ELAPSED} > 600000) ${EMPTY_SELECTION}\n`],
  ["g1: the sharder drops the heavy proof's slice when it runs as the entrypoint with an empty execArgv", SHARDER_HEAD, `${SHARDER_HEAD}  if (${CI_SHAPED}) all = all.filter((t) => t.proof !== "proof:device-management-health");\n`],
  ["g2: the selector returns an empty selection for a sliced unit when it runs as the entrypoint with an empty execArgv", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (target.slice && ${CI_SHAPED}) ${EMPTY_SELECTION}\n`],
  ["g4: the selector reads the wall clock (Date)", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (${WALL_CLOCK} > 4e12) ${EMPTY_SELECTION}\n`],
  ["g5: the sharder reads a high-resolution clock", SHARDER_HEAD, `${SHARDER_HEAD}  if (${HIGH_RES} < 0n) all = [];\n`],
  ["g6: the selector reads the process id", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (process.pid < 0) ${EMPTY_SELECTION}\n`],
  ["g7: the sharder reads the platform", SHARDER_HEAD, `${SHARDER_HEAD}  if (process.platform === "linux" && process.argv.length > 99) all = [];\n`],
  ["g8: the selector reads the process's uptime (a member of process nothing else uses)", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (process.uptime() > 1e9) ${EMPTY_SELECTION}\n`],
  ["g9: the sharder asks whether stdout is a terminal (a second use of process.stdout)", SHARDER_HEAD, `${SHARDER_HEAD}  if (process.stdout.isTTY === 7) all = [];\n`],
  ["g10: the selector reads the working directory", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (process.cwd() === "/") ${EMPTY_SELECTION}\n`],
  ["g11: the sharder reads the module's own location a third time", SHARDER_HEAD, `${SHARDER_HEAD}  if (import.meta.url === "") all = [];\n`],
  ["g12: the selector reads a file the registry does not name (the process's own environment)", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (readFileSync("/proc/self/environ", "utf8").length < 0) ${EMPTY_SELECTION}\n`],
  ["g13: the sharder keeps an alias of process", SHARDER_HEAD, `${SHARDER_HEAD}  const p = process;\n  if (p["execArgv"].length === 0 && p.argv.length > 99) all = [];\n`],
  ["g14: the module imports the machine (os)", "import { fileURLToPath } from \"node:url\";\n", "import { fileURLToPath } from \"node:url\";\nimport { cpus } from \"node:os\";\n"],
  ["g16: the sharder tells the stubbed file write from the real one by the function's name", SHARDER_HEAD, `${SHARDER_HEAD}  if (writeFileSync.name === "recorded") all = [];\n`],
  ["g17: the selector tells the stubbed spawn from the real one by the function's source", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (String(spawnSync).length < 200) ${EMPTY_SELECTION}\n`],
  ["g18: the sharder reads the source of a function through Function.prototype", SHARDER_HEAD, `${SHARDER_HEAD}  if (Function.prototype.toString.call(readFileSync).length < 0) all = [];\n`],
  ["g15: a timer decides the selection", SELECTOR_HEAD, `${SELECTOR_HEAD}  if (typeof setTimeout === "number") ${EMPTY_SELECTION}\n`],
  // The arithmetic net itself, in main().
  ["s1: the plan-vs-size check of each unit is switched off", "if (plan.swept !== sized) {", "if (false) {"],
  ["s2: the plan-vs-size check compares the selector with its own total instead of the registry's count", "const sized = sliceSize(mutationTotal(target), target.slice);", "const sized = sliceSize(plan.total, target.slice);"],
  ["s3: the plan-vs-size failure no longer sets the exit code", "console.error(`   ✗ PLAN-vs-SIZE ${line}`);\n      process.exitCode = 1;", "console.error(`   ✗ PLAN-vs-SIZE ${line}`);"],
  ["s4: the plan-vs-size failure no longer ends the sweep before the survivor report", "for (const m of sizeMismatches) console.error(`  ✗ PLAN-vs-SIZE ${m}`);\n    process.exit(1);", "for (const m of sizeMismatches) console.error(`  ✗ PLAN-vs-SIZE ${m}`);"],
  ["s5: the plan-vs-size check compares the unit's rewritten count instead of the selector's", "if (plan.swept !== sized) {", "if (swept - 1 !== sized) {"],
]) {
  const mutant = fixtureText(GUARD_SRC, name, from, to);
  if (mutant !== undefined) check(`fixture mutant is detected, the gate goes red: ${name}`, mutant !== GUARD_SRC && !mainSweepsWithSelector(mutant));
}

// ── The unit accounting main() ends a run on ──────────────────────────────────────────────────
//
// `expectedUnitNames` (what a run is to sweep, from its arguments) and `unitAccountingProblems` (what is wrong with the units it
// got to) decide whether a run that skipped a unit exits 0. Both are checked on the real exports, and the second also on mutants of
// its own text: a stub that never skips a unit cannot show either of them failing.
{
  const names = (xs) => xs.map(unitName);
  const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const dmhProof = "proof:device-management-health";
  const expectedOk =
    sameList(expectedUnitNames(TARGETS, undefined, undefined), names(TARGETS))
    && [1, 2, 3, 4].every((n) => {
      const seen = new Map();
      for (let i = 0; i < n; i += 1) {
        const got = expectedUnitNames(TARGETS, undefined, `${i}/${n}`);
        if (!sameList(got, names(shardTargets(TARGETS, i, n)))) return false;
        for (const u of got) seen.set(u, (seen.get(u) ?? 0) + 1);
      }
      return seen.size === names(Array.from({ length: n }, (_, i) => shardTargets(TARGETS, i, n)).flat()).length && [...seen.values()].every((c) => c === 1);
    })
    && sameList(expectedUnitNames(TARGETS, dmhProof, "1/4"), names(shardTargets(TARGETS.filter((t) => t.proof === dmhProof), 1, 4)))
    && sameList(expectedUnitNames(TARGETS, TARGETS[0].proof, undefined), [TARGETS[0].proof]);
  check("expectedUnitNames gives, from the arguments alone, exactly the units main() will walk: every unit of the registry for no shard, each shard's own units (all of them, once, over the shards of 1 to 4), and the one proof's slice for --proof with --shard", expectedOk);
  const kind = (p) => p.split(":")[0];
  const accounts = (fn) => {
    const run = (expected, counted, failed) => fn(expected, counted, failed).map(kind).join("|");
    return run(["a", "b"], ["a", "b"], []) === ""
      && run(["a", "b"], ["a"], []) === "UNIT-SKIPPED b"
      && run(["a", "b"], ["a"], ["b"]) === ""
      && run(["a", "b"], [], []) === "UNIT-SKIPPED a|UNIT-SKIPPED b"
      && run(["a"], ["a", "c"], []) === "UNIT-UNEXPECTED c"
      && run(["a"], ["a", "a"], []) === "UNIT-UNEXPECTED a"
      && run(["a"], [], ["z"]) === "UNIT-SKIPPED a|UNIT-UNEXPECTED z";
  };
  check("unitAccountingProblems names a unit that never reached its count (UNIT-SKIPPED), accepts one that failed its baseline, and names a unit that was swept but not selected or counted twice (UNIT-UNEXPECTED)", accounts(unitAccountingProblems));
  const accountingText = GUARD_SRC.slice(GUARD_SRC.indexOf("export function unitAccountingProblems("));
  const accountingEnd = accountingText.indexOf("\n}\n");
  const accountingFn = accountingEnd < 0 ? undefined : accountingText.slice(0, accountingEnd + 3);
  const loadFn = async (code) => (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)).unitAccountingProblems;
  let controlFn;
  try { controlFn = accountingFn === undefined ? undefined : await loadFn(accountingFn); } catch { /* the check below says it did not load */ }
  check("control: unitAccountingProblems' own text, extracted and loaded back as a module, passes the same battery (so a red below is the mutant, not the harness)", controlFn !== undefined && accounts(controlFn));
  for (const [name, from, to] of [
    ["a unit that never reached its count is no longer named", "if (!accounted.has(unit)) problems.push(", "if (false) problems.push("],
    ["a unit that failed its baseline is no longer accounted for", "new Set([...counted, ...failedBaseline])", "new Set(counted)"],
    ["every expected unit counts as accounted for", "new Set([...counted, ...failedBaseline])", "new Set(expected)"],
    ["a unit swept without being selected is no longer named", "if (!expected.includes(unit)) problems.push(", "if (false) problems.push("],
    ["a unit counted twice is no longer named", "else if (seen.has(unit))", "else if (false)"],
  ]) {
    const text = accountingFn === undefined ? undefined : fixtureText(accountingFn, name, from, to);
    if (text === undefined) continue;
    let verdict = true;
    try { verdict = accounts(await loadFn(text)); } catch (err) { check(`fixture could not be built (the mutant does not load: ${errText(err)}): ${name}`, false); continue; }
    check(`fixture mutant of unitAccountingProblems is detected, the gate goes red: ${name}`, text !== accountingFn && verdict === false);
  }
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
// broken security guards) mutated on disk after a single gate run. As a second net the WHOLE working tree is compared
// before the first child and after the last (see treeSnapshot), and any path that moved fails the gate by name. Each child has
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
// THE TREE NET. What `git status` names in the WHOLE working tree (tracked files changed, files untracked, files gone, mode
// changes), plus a hash of every file it names, taken before the first child and after the last. The earlier net hashed the
// 185 registered guard files and nothing else: a child that wrote anywhere else (a new file in lib/, a file outside it)
// left the gate green, and one that wrote a registered file turned the gate red but left the file modified. A file that was
// already modified when the gate started (work in progress) is hashed too, so modifying it again still moves. Not covered,
// and said so: paths git ignores, and a change to a file's mtime alone; the preload refuses both by path, whatever git thinks.
// `GIT_OPTIONAL_LOCKS=0` keeps the check from writing the index itself, and the ceiling stops git from finding a repository
// above the one it was asked about (a scratch copy of the tree is its own repository, or it is not one and the net says so).
// A path is opened ONCE and classified from the descriptor that open returned (CodeQL js/file-system-race): there is no stat
// of the name before the open, so no writer can land between a check and a use. The open carries O_NOFOLLOW, which makes the
// kernel refuse a symlink (ELOOP, dangling or not); that refusal is how a link is recognised, and it is reported as
// `link <sha256 of readlink>`. A directory opens read-only on Linux and macOS and fstat names it "dir". A regular file's mode
// and content both come from the same descriptor. Anything else (a socket, a device, a path gone or unreadable) is "absent".
// Without O_NOFOLLOW (win32) the open follows a link to its target and the target's mode and content are hashed from the one
// descriptor: there a symlink is reported as its target, never as a link. The gate runs on Linux and macOS.
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0;
const contentHash = (abs) => {
  let fd;
  try {
    fd = openSync(abs, fsConstants.O_RDONLY | O_NOFOLLOW);
  } catch (err) {
    if (err?.code !== "ELOOP") return "absent";
    try { return `link ${sha256(readlinkSync(abs))}`; } catch { return "absent"; }
  }
  try {
    const own = fstatSync(fd);
    if (own.isDirectory()) return "dir";
    if (!own.isFile()) return "absent";
    return `${(own.mode & 0o777).toString(8)} ${sha256(readFileSync(fd))}`;
  } catch { return "absent"; } finally { closeSync(fd); }
};
const treeSnapshot = (root) => {
  let raw;
  try {
    raw = execFileSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_CEILING_DIRECTORIES: dirname(root) }, maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    return { error: String(err?.stderr?.toString() || err?.message || err).trim().split("\n")[0] };
  }
  const entries = new Map();
  const parts = raw.toString("utf8").split("\0");
  for (let k = 0; k < parts.length; k += 1) {
    if (parts[k] === "") continue;
    const code = parts[k].slice(0, 2);
    const path = parts[k].slice(3);
    if (/[RC]/.test(code)) k += 1; // the entry after a rename or a copy is the path it came from
    entries.set(path, `${code}|${contentHash(join(root, path))}`);
  }
  return { entries };
};
const treeChanges = (before, after) =>
  [...new Set([...before.entries.keys(), ...after.entries.keys()])].sort()
    .filter((f) => before.entries.get(f) !== after.entries.get(f))
    .map((f) => {
      const was = before.entries.get(f)?.split("|")[0];
      const now = after.entries.get(f)?.split("|")[0];
      return `${f} (${was === undefined ? "clean" : `git status "${was}"`} -> ${now === undefined ? "clean" : `git status "${now}"`}${was === now ? ", content changed" : ""})`;
    });
const digestOf = (snapshot) => sha256([...snapshot.entries].sort().map(([f, h]) => `${f} ${h}`).join("\n")).slice(0, 16);
// The preloads go in through NODE_OPTIONS and not as arguments to `node`, so the child sees the `process.execArgv` a CI step gives it: EMPTY. As arguments it saw
// two (`--import <file>`), and a skip keyed on that (`process.execArgv.length === 0` in the sharder or the selector) was never taken in any run this gate made.
const spawnGuard = (preloads, args, env = {}) => new Promise((done) => {
  const nodeOptions = [process.env.NODE_OPTIONS ?? "", ...preloads.map((p) => `--import=${p}`)].filter((x) => x !== "").join(" ");
  execFile(process.execPath, [GUARD_PATH, ...args], { cwd: REPO, env: { ...process.env, ...env, NOWRITE_ALLOW: "", NODE_OPTIONS: nodeOptions }, maxBuffer: 64 * 1024 * 1024, timeout: CHILD_TIMEOUT_SECONDS * 1000, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
    let doc = null;
    try { doc = JSON.parse(stdout); } catch { /* not JSON: the checks below say so */ }
    done({ rc: err === null ? 0 : typeof err.code === "number" ? err.code : 1, stdout, stderr, doc, timedOut: err !== null && err.killed === true && typeof err.code !== "string", denied: stderr.includes(DENIED_MARKER) });
  });
});
const runPlan = (args, env) => spawnGuard([PRELOAD_NOWRITE], ["--plan", ...args], env);
const runStubSweep = (args, env) => spawnGuard([PRELOAD_NOWRITE, PRELOAD_STUB], args, env);
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
// Every unit a run finished prints `unit-done <unit> written=<n> planned=<m>` (stdout in a sweep, stderr in --plan). The units
// that print one must be exactly the units the shard holds, none missing and none twice, and each must have written what the
// selector planned for it, which must be what the slice ARITHMETIC says the unit holds (and more than nothing when it holds any).
// A skipped unit has no count to fail, so a run that swept 462 of 475 mutations and exited 0 is visible only as a unit that never
// printed a line, or printed `written=0 planned=0`.
const UNIT_DONE = /^unit-done (\S+) written=(\d+) planned=(\d+)$/gm;
const unitsDoneIn = (text) => [...text.matchAll(UNIT_DONE)].map((m) => ({ unit: m[1], written: Number(m[2]), planned: Number(m[3]) }));
const unitAccount = (text, registry, i, n, planUnits = []) => {
  const done = unitsDoneIn(text);
  // `size` is the slice ARITHMETIC (the registry's mutation count and the slice, nothing the selector computes): a unit that planned and wrote nothing
  // (`written=0 planned=0`, which every net that compares a unit with itself accepts) fails it whatever made the selection empty.
  const held = shardTargets(registry, i, n).map((u) => ({ unit: unitName(u), swept: selectSliceMutations(u, perFileOf(u)).swept, size: sliceSize(totalOf(u), u.slice) }));
  const names = (xs) => JSON.stringify(xs.map((x) => x.unit).sort());
  const missing = held.filter((h) => !done.some((d) => d.unit === h.unit)).map((h) => h.unit);
  const notPlanned = planUnits.filter((u) => !done.some((d) => d.unit === u));
  const wrong = done.filter((d) => { const h = held.find((x) => x.unit === d.unit); return h === undefined || d.written !== d.planned || d.planned !== h.swept || d.planned !== h.size || (h.size > 0 && d.written === 0); }).map((d) => d.unit);
  const counted = wrong.length === 0;
  return { ok: names(done) === names(held) && counted && notPlanned.length === 0, done: done.length, held: held.length, missing, text: `${done.length} of ${held.length} units finished${missing.length ? ` (never finished: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? `, +${missing.length - 3} more` : ""})` : counted ? "" : ` (a unit wrote or planned other than its slice holds: ${wrong.slice(0, 3).join(", ")}${wrong.length > 3 ? `, +${wrong.length - 3} more` : ""})`}` };
};
const PLAN_COUNTS = [1, 2, 3, 4];
const dmhTarget = TARGETS.find((t) => t.proof === "proof:device-management-health");

// Fixtures for the two safety nets, before anything is spawned against the real tree.
// (1) The write-denying preload, a COPY of it rooted in a scratch directory (it takes its root from its own
//     location), against a child that tries one way after another to change something under that root: the
//     content-changing calls, the metadata-only ones (chmod, utimes, and the descriptor and handle forms of both),
//     a hard link out of the tree, and the routes AROUND the patched functions (a worker thread, the runtime's
//     `fs` binding, execve, dlopen, a bare ChildProcess, a diagnostic report). A worker alone wrote a new file
//     into lib/ with the gate at 167/167. Only the last probe, a write outside the root, may succeed.
const NOWRITE_PROBES = [
  ["writeFileSync", "fs.writeFileSync(victim, \"x\")"],
  ["promises.writeFile", "await fsp.writeFile(victim, \"x\")"],
  ["createWriteStream", "fs.createWriteStream(victim)"],
  ["renameSync", "fs.renameSync(victim, `${victim}.b`)"],
  ["rmSync", "fs.rmSync(victim)"],
  ["spawnSync", "spawnSync(\"true\")"],
  ["chmodSync", "fs.chmodSync(victim, 0o755)"],
  ["utimesSync", "fs.utimesSync(victim, 1, 1)"],
  ["fchmodSync on a read-only descriptor", "fs.fchmodSync(fs.openSync(victim, \"r\"), 0o755)"],
  ["FileHandle.chmod on a read-only handle", "await (await fsp.open(victim, \"r\")).chmod(0o755)"],
  ["hard link out of the tree", "fs.linkSync(victim, `${free}.link`)"],
  ["new Worker", "new Worker(\"1\", { eval: true })"],
  ["process.binding", "process.binding(\"fs\")"],
  // (execve is Node 22.15 and later, and node:sqlite 22.5 and later: a probe for a call this Node does not have would only report that it threw.)
  ...(typeof process.execve === "function" ? [["process.execve", "process.execve(process.execPath, [process.execPath, \"-e\", \"1\"], process.env)"]] : []),
  ["process.dlopen", "process.dlopen({ exports: {} }, \"/nonexistent.node\")"],
  ["new ChildProcess", "new ChildProcess()"],
  ["process.report.writeReport", "process.report.writeReport(victim)"],
  ["v8.writeHeapSnapshot", "(await import(\"node:v8\")).writeHeapSnapshot(victim)"],
  ["v8.setFlagsFromString", "(await import(\"node:v8\")).setFlagsFromString(\"--no-prof\")"],
  ["trace_events.createTracing", "(await import(\"node:trace_events\")).createTracing({ categories: [\"node.perf\"] })"],
  ["module.register (the hooks thread)", "(await import(\"node:module\")).register(\"data:text/javascript,\", import.meta.url)"],
  ["a Uint8Array as the path", "fs.writeFileSync(new TextEncoder().encode(victim), \"x\")"],
  ["a URL-shaped plain object as the path", "fs.writeFileSync({ href: `file://${victim}`, protocol: \"file:\", hostname: \"\", pathname: victim }, \"x\")"],
  ["a unix socket bound in the tree", "await new Promise((ok, no) => { const s = net.createServer(); s.on(\"error\", no); s.listen(`${victim}.sock`, () => s.close(ok)); })"],
  // Paths that LAND in the tree without being spelled there: a symlink outside the root to a file that does not exist yet inside it (the write creates the
  // file), a chain of two, one to a directory in the tree reached with `..`, and a loop of links (refused: a path that cannot be placed counts as inside).
  // The links are made outside the root, which is allowed; the writes through them are the probes.
  ["a dangling symlink outside the root whose target is a new file inside it", "fs.symlinkSync(`${victim}.made-through-a-link`, `${free}.link1`); fs.writeFileSync(`${free}.link1`, \"x\")"],
  ["a chain of two dangling symlinks outside the root ending in a new file inside it", "fs.symlinkSync(`${victim}.made-through-a-chain`, `${free}.link2b`); fs.symlinkSync(`${free}.link2b`, `${free}.link2a`); fs.writeFileSync(`${free}.link2a`, \"x\")"],
  ["a relative dangling symlink outside the root whose target is a new file inside it", "const rel = path.relative(free.slice(0, free.lastIndexOf(\"/\")), `${victim}.made-through-a-relative-link`); fs.symlinkSync(rel, `${free}.link3`); fs.writeFileSync(`${free}.link3`, \"x\")"],
  ["`..` after a symlink outside the root that points at a directory inside it", "fs.symlinkSync(`${victim.slice(0, victim.lastIndexOf(\"/\"))}/scripts/lib`, `${free}.link4`); fs.writeFileSync(`${free}.link4/../made-through-dotdot.txt`, \"x\")"],
  ["a symlink to a new file inside the root, written with the descriptor of a write-flag open", "fs.symlinkSync(`${victim}.opened-through-a-link`, `${free}.link5`); fs.closeSync(fs.openSync(`${free}.link5`, \"w\"))"],
  ["a loop of symlinks outside the root", "fs.symlinkSync(`${free}.link6b`, `${free}.link6a`); fs.symlinkSync(`${free}.link6a`, `${free}.link6b`); fs.writeFileSync(`${free}.link6a`, \"x\")"],
  // The runtime writes `report.<date>.json` into `report.directory` (the working directory by default) when a trigger is on and its signal or an uncaught
  // exception arrives, so the settings are refused, not only `writeReport`.
  ["process.report.reportOnSignal", "process.report.reportOnSignal = true"],
  ["process.report.reportOnUncaughtException", "process.report.reportOnUncaughtException = true"],
  ["process.report.reportOnFatalError", "process.report.reportOnFatalError = true"],
  ["process.report.directory", "process.report.directory = victim.slice(0, victim.lastIndexOf(\"/\"))"],
  ["process.report.filename", "process.report.filename = \"report-made-here.json\""],
  ...(isBuiltin("node:sqlite") ? [["new DatabaseSync (SQLite creates the file)", "new ((await import(\"node:sqlite\")).DatabaseSync)(`${victim}.db`)"]] : []),
  ["new WASI with the tree preopened", "new ((await import(\"node:wasi\")).WASI)({ version: \"preview1\", preopens: { \"/sandbox\": victim.slice(0, victim.lastIndexOf(\"/\")) } })"],
  ["write outside the root", "fs.writeFileSync(free, \"ok\")"],
];
{
  const root = mkdtempSync(join(tmpdir(), "sg-nowrite-"));
  const outside = mkdtempSync(join(tmpdir(), "sg-nowrite-out-"));
  try {
    mkdirSync(join(root, "scripts/lib"), { recursive: true });
    copyFileSync(PRELOAD_NOWRITE_PATH, join(root, "scripts/lib/no-write-preload.mjs"));
    writeFileSync(join(root, "victim.txt"), "keep");
    chmodSync(join(root, "victim.txt"), 0o644);
    utimesSync(join(root, "victim.txt"), 1000, 1000);
    const stat0 = statSync(join(root, "victim.txt"));
    writeFileSync(join(root, "child.mjs"), [
      "import fs from \"node:fs\";",
      "import fsp from \"node:fs/promises\";",
      "import net from \"node:net\";",
      "import { ChildProcess, spawnSync } from \"node:child_process\";",
      "import { Worker } from \"node:worker_threads\";",
      "import path from \"node:path\";",
      "const [victim, free] = process.argv.slice(2);",
      "const out = [];",
      `for (const [name, fn] of [${NOWRITE_PROBES.map(([name, code]) => `[${JSON.stringify(name)}, async () => { ${code}; }]`).join(", ")}]) {`,
      // Only the preload's own refusal counts as denied: a call that threw for any other reason (a path that does not exist, a
      // bad argument) proves nothing about the guard, and is reported as it is.
      "  try { await fn(); out.push(`${name}:allowed`); } catch (err) { out.push(`${name}:${String(err?.message ?? err).includes(\"NO-WRITE-DENIED\") ? \"denied\" : \"threw\"}`); }",
      "}",
      "console.log(out.join(\"|\"));",
    ].join("\n"));
    const r = await new Promise((done) => execFile(process.execPath, ["--import", pathToFileURL(join(root, "scripts/lib/no-write-preload.mjs")).href, join(root, "child.mjs"), join(root, "victim.txt"), join(outside, "free.txt")], { env: { ...process.env, NOWRITE_ALLOW: "" }, timeout: 30_000, killSignal: "SIGKILL" }, (err, stdout, stderr) => done({ stdout: stdout.trim(), stderr })));
    const stat1 = statSync(join(root, "victim.txt"));
    const want = NOWRITE_PROBES.map(([name], k) => `${name}:${k === NOWRITE_PROBES.length - 1 ? "allowed" : "denied"}`).join("|");
    check(`fixture: the write-denying preload refuses all ${NOWRITE_PROBES.length - 1} probes under its root (content writes, chmod and utimes, descriptor and handle forms, a hard link out, a worker thread, process.binding, execve, dlopen, ChildProcess, module.register, a diagnostic report and every setting that makes the runtime write one, heap snapshot or trace file, a unix socket, WASI, a path given as a Uint8Array or a URL-shaped object, a symlink outside the root to a file that does not exist yet inside it (one link, a chain, a relative one, a loop, and \`..\` after a link to a directory in the tree), a spawned process), marks stderr, leaves the file's content, mode and mtime as they were, creates nothing, and still lets a write outside its root through${r.stdout === want ? "" : ` — got ${r.stdout.split("|").filter((x, k) => x !== want.split("|")[k]).join(" | ") || r.stdout.slice(0, 200)}`}`,
      r.stdout === want && r.stderr.includes(DENIED_MARKER)
      && readFileSync(join(root, "victim.txt"), "utf8") === "keep" && stat1.mode === stat0.mode && stat1.mtimeMs === stat0.mtimeMs
      && readdirSync(root).sort().join() === "child.mjs,scripts,victim.txt" && readdirSync(join(root, "scripts")).join() === "lib"
      && readdirSync(outside).filter((x) => !/^free\.txt\.link\d[ab]?$/.test(x)).join() === "free.txt");
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}
// (2) The tree comparison names what moved. A scratch repository: a file added, one edited, one edited AGAIN while it was
//     already modified, one removed, one made executable, one nested in a new directory; and a directory that is not a
//     repository is reported rather than read as clean.
{
  const dir = mkdtempSync(join(tmpdir(), "sg-tree-"));
  const notRepo = mkdtempSync(join(tmpdir(), "sg-tree-none-"));
  const git = (...args) => scratchGitOk(dir, args);
  try {
    git("init", "-q");
    writeFileSync(join(dir, "a.ts"), "one");
    writeFileSync(join(dir, "b.ts"), "two");
    git("add", "-A");
    git("commit", "-q", "-m", "fixture");
    const named = (before) => treeChanges(before, treeSnapshot(dir)).map((x) => x.split(" ")[0]).join();
    const clean = treeSnapshot(dir);
    const unchanged = named(clean);
    writeFileSync(join(dir, "c.ts"), "new");
    const added = named(clean);
    const withC = treeSnapshot(dir);
    writeFileSync(join(dir, "c.ts"), "NEW");
    const addedThenEdited = named(withC);
    rmSync(join(dir, "c.ts"));
    writeFileSync(join(dir, "a.ts"), "ONE");
    const edited = named(clean);
    const dirty = treeSnapshot(dir);
    writeFileSync(join(dir, "a.ts"), "ONE AGAIN");
    const editedAgain = named(dirty);
    writeFileSync(join(dir, "a.ts"), "one");
    rmSync(join(dir, "b.ts"));
    const removed = named(clean);
    writeFileSync(join(dir, "b.ts"), "two");
    chmodSync(join(dir, "b.ts"), 0o755);
    const madeExecutable = named(clean);
    chmodSync(join(dir, "b.ts"), 0o644);
    mkdirSync(join(dir, "d/e"), { recursive: true });
    writeFileSync(join(dir, "d/e/f.ts"), "nested");
    const nested = named(clean);
    const settled = (() => { rmSync(join(dir, "d"), { recursive: true }); return named(clean); })();
    check("fixture: the tree comparison reports nothing for an untouched tree and names a file that was added, edited, edited again while already modified, removed, made executable, or created in a new directory, and nothing once they are put back",
      unchanged === "" && added === "c.ts" && addedThenEdited === "c.ts" && edited === "a.ts" && editedAgain === "a.ts" && removed === "b.ts" && madeExecutable === "b.ts" && nested === "d/e/f.ts" && settled === "");
    check("fixture: a directory that is not a repository is reported by the tree net, never read as a clean tree", treeSnapshot(notRepo).error !== undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(notRepo, { recursive: true, force: true });
  }
}

const TREE_BEFORE = treeSnapshot(REPO);
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
      const units = unitAccount(run.stderr, j.registry, j.i, j.n);
      const ok = run.rc === 0 && !run.denied && run.doc !== null && run.doc.shard === `${j.i}/${j.n}` && run.doc.proof === (j.only ?? null)
        && run.doc.count === got.length && JSON.stringify(got) === JSON.stringify(want) && units.ok;
      if (!ok) console.error(`    plan ${j.args.join(" ")}: rc=${run.rc}, ${run.denied ? `a write or spawn was attempted and refused (${run.stderr.split("\n").find((l) => l.includes(DENIED_MARKER)) ?? DENIED_MARKER})` : run.doc === null ? `stdout is not JSON (${run.stderr.trim().split("\n").pop() ?? ""})` : `${got.length} placements vs ${want.length} expected${firstDifference(got, want)}; ${units.text}`}`);
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
          const planUnits = [...new Set((judged.find((p) => p.n === 4 && p.i === j.i && p.only === j.only)?.got ?? []).map((p) => p.unit))];
          const units = unitAccount(run.stdout, j.registry, j.i, 4, planUnits);
          const ok = run.rc === 0 && !run.denied && report !== null && planned.length > 0 && JSON.stringify(written) === JSON.stringify(planned)
            && report.dirty === 0 && report.proofRuns === runsWanted && run.stdout.includes(summary) && units.ok;
          if (!ok) {
            const x = Array.from({ length: Math.max(written.length, planned.length) }, (_, y) => y).find((y) => written[y] !== planned[y]);
            const brief = (w) => (w === undefined ? "none" : `${w.split("|")[0].split("/").pop()} ${w.split("|")[1].slice(0, 8)}`);
            console.error(`    stubbed sweep ${j.args.join(" ")}: rc=${run.rc}, ${report === null ? `no report (${run.stderr.trim().split("\n").pop() ?? ""})` : `${written.length} written vs ${planned.length} planned${x === undefined ? "" : ` (first difference at ${x}: ${brief(written[x])} vs planned ${brief(planned[x])})`}, dirty=${report.dirty}, proof runs=${report.proofRuns} (expected ${runsWanted})`}${run.stdout.includes(summary) ? "" : `, no \`${summary}\``}; ${units.text}`);
          }
          return { ...j, written, ok };
        });
        for (const [what, mine, registered] of [
          ["the whole registry", sweepJudged.filter((j) => j.only === undefined), whole],
          ...(dmhTarget ? [[dmhTarget.proof, sweepJudged.filter((j) => j.only === dmhTarget.proof), totalOf(dmhTarget)]] : []),
        ]) {
          const writtenTotal = mine.reduce((n, j) => n + j.written.length, 0);
          check(`main()'s REAL sweep of ${what} with the disk and the proof stubbed, shards 0..3 of 4, writes exactly the mutations each shard's --plan lists, in order, restores every one, runs the proof once per mutation and once per unit for its baseline, finishes every unit its shard holds (a \`unit-done\` line each, written = planned = what the slice arithmetic says, and more than none for a unit that holds any), and exits 0 (${mine.map((j) => j.written.length).join("+")} = ${writtenTotal} of ${registered} written)`,
            mine.length === 4 && mine.every((j) => j.ok) && writtenTotal === registered);
        }
        // The one branch of main() a kill-everything stub never takes: a mutant that SURVIVES its proof. The smallest target with
        // a few mutations is swept with the first of them that is not on the allowlist answering `pass`. It must be reported
        // as a survivor (not counted as known-inert, not lost), the sweep must exit 1 on it, and every write must be restored.
        // (Counting each survivor as known-inert made main() unable to fail on a survivor at all, with the gate at 167/167.)
        {
          const smallest = [...TARGETS].filter((t) => totalOf(t) >= 3).sort((a, b) => totalOf(a) - totalOf(b) || (a.proof < b.proof ? -1 : 1))[0];
          const flat = smallest === undefined ? [] : mutationsByFile(smallest).flatMap((f) => f.mutations);
          const at = flat.findIndex((m) => !isAllowed(m));
          if (smallest === undefined || at < 0) {
            check("main()'s REAL sweep with one mutant surviving its proof (NOT RUN: no registered target has three mutations with one off the allowlist)", false);
          } else {
            const run = await watched(`sweep --proof=${smallest.proof} (stubbed, mutant ${at + 1} survives)`, () => runStubSweep([`--proof=${smallest.proof}`], { SWEEP_STUB_SURVIVE: String(at + 1) }))();
            if (firstHung !== undefined) {
              hungCheck("main()'s stubbed sweep with a surviving mutant", [run]);
            } else {
              const reportLine = run.stderr.split("\n").find((l) => l.startsWith(`${REPORT_MARKER} `));
              let report = null;
              try { report = reportLine === undefined ? null : JSON.parse(reportLine.slice(REPORT_MARKER.length + 1)); } catch { /* no report: the check says so */ }
              const want = `mutations=${flat.length} killed=${flat.length - 1} hung=0 known-inert=0 survivors=1`;
              const survivor = `✗ SURVIVED  ${flat[at].file}:${flat[at].lineNo}`;
              const ok = run.rc === 1 && !run.denied && report !== null && report.dirty === 0 && report.writes.length === flat.length
                && run.stdout.includes(want) && run.stdout.includes(survivor) && run.stderr.includes("unfalsifiable by their own proof");
              if (!ok) console.error(`    stubbed sweep --proof=${smallest.proof} (mutant ${at + 1} survives): rc=${run.rc}, ${report === null ? "no report" : `${report.writes.length} written, dirty=${report.dirty}`}, ${run.stdout.includes(want) ? "" : `no \`${want}\`, `}${run.stdout.includes(survivor) ? "" : `no \`${survivor}\`, `}${run.stderr.includes("unfalsifiable by their own proof") ? "" : "no survivor report"}`);
              check(`main()'s REAL sweep of ${smallest.proof} (${flat.length} mutations) with the disk and the proof stubbed and mutation ${at + 1} answering "pass": reports it as a survivor (\`survivors=1\`, \`known-inert=0\`), prints the survivor report and exits 1, with every write restored`, ok);
            }
          }
        }
      }
    }
  }
}
// Whatever the children did, the tree they ran in is the tree they started with: the same paths named by `git status`, with the
// same content, before the first child and after the last.
{
  const after = treeSnapshot(REPO);
  if (TREE_BEFORE.error !== undefined || after.error !== undefined) {
    check(`the working tree is the same before the first spawned child and after the last (NOT RUN: \`git status\` failed — ${TREE_BEFORE.error ?? after.error})`, false);
  } else {
    const moved = treeChanges(TREE_BEFORE, after);
    for (const m of moved) console.error(`    CHANGED by a spawned child: ${m}`);
    check(`the whole working tree is the same before the first spawned child and after the last: \`git status --untracked-files=all\` names ${TREE_BEFORE.entries.size} paths before and ${after.entries.size} after, each with the same content (digest ${digestOf(TREE_BEFORE)} before, ${digestOf(after)} after)${moved.length ? ` — CHANGED: ${moved.slice(0, 4).join("; ")}${moved.length > 4 ? `; +${moved.length - 4} more` : ""}` : ""}`, moved.length === 0);
  }
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
      ["the selection comes back empty (what a time budget or a runner key in the selector would make it do)", "  const files = [];\n", `  if (${ELAPSED} > 0) ${EMPTY_SELECTION}\n  const files = [];\n`],
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
const WORKFLOW_TEXT = readFileSync(join(REPO, ".github/workflows/scheduled-verification.yml"), "utf8");
const WORKFLOW = parseYaml(WORKFLOW_TEXT);
const sweepJob = WORKFLOW?.jobs?.["mutation-sweep"];
// The sweep step is ONE line and nothing else. `--plan` is accepted by the script (it is how this gate observes main()), and
// on the run line it turns every shard into a green no-op: a JSON plan, exit 0, no proof run. A flag spelled out was refused
// first, then eight other shapes turned out to reach the same place without ever writing `--plan` on the line: another
// expression (`${{ vars.X }}`), a shell variable (`F=--plan; ... $F`), an `env:` block read as `$SWEEP_ARGS`, a `|` block with a
// backslash continuation, `if: false`, `|| true`, `continue-on-error: true`, and `NODE_OPTIONS=--import=<the stub preload>` (which
// turns the daily sweep into a faked, all-killed run). So the step is held to exactly the line below with only `name` and `run`,
// the job may not continue on error, be skipped, or carry defaults or an environment that sets NODE_OPTIONS, and no earlier step
// may write to GITHUB_ENV or GITHUB_PATH (an environment the later step would inherit). The expression `${{ matrix.shard }}` is the
// only one the line may hold. Exactly one step may name mutation-guard at all.
const SWEEP_RUN = /^node scripts\/mutation-guard\.mjs --shard=\$\{\{ matrix\.shard \}\}\/(\d+)$/;
const REFUSED_ENVIRONMENT = /NODE_OPTIONS|GITHUB_ENV|GITHUB_PATH|--import\b|--require\b|--loader\b|--experimental-loader\b/;
const sweepStepsOf = (job) => (Array.isArray(job?.steps) ? job.steps : []).flatMap((st, k) => (JSON.stringify(st ?? null).includes("mutation-guard") ? [k] : []));
// The JOB holds these keys and no others. A key the list does not name is a way to make the daily sweep not run, or run faked, with this gate green:
// `strategy.matrix.exclude: [{ shard: 3 }]` (shard 3 never runs), `container.env.NODE_OPTIONS` (every step in the container loads the stub preload, so the
// sweep is faked), `needs:` a job that is `if: false` (the sweep job is skipped). Each of those was green at 224/224. `env` and `continue-on-error` are
// allowed only in the forms below.
const SWEEP_JOB_KEYS = ["name", "runs-on", "timeout-minutes", "strategy", "steps", "env", "continue-on-error"];
const WHY_REFUSED = {
  needs: "a job that is skipped or fails makes the sweep job skip", container: "its env reaches every step", services: "a service container changes what the step runs against",
  if: "the sweep job would not run", defaults: "a shell or working directory changes how the line runs", "continue-on-error": "a failing shard would read green",
  permissions: "not part of the pinned sweep job", concurrency: "a cancelled or queued shard is a shard that does not finish", environment: "an environment brings its own variables and approvals",
  outputs: "not part of the pinned sweep job", uses: "a reusable workflow replaces the steps", with: "belongs to a reusable workflow",
};
const isLiteral = (v) => ["string", "number", "boolean"].includes(typeof v) && !String(v).includes("${{");
const isMapping = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
// An `env` block is a plain mapping of literal strings (numbers, booleans): not an expression, a list, or a value computed from the repository's variables.
function envProblems(where, env) {
  if (env === undefined) return [];
  if (!isMapping(env)) return [`the ${where} env is ${JSON.stringify(env)}, not a plain mapping (an expression there can set anything, NODE_OPTIONS included)`];
  const problems = Object.entries(env).filter(([, v]) => !isLiteral(v)).map(([k]) => `the ${where} env sets ${k} to a value that is not a literal (${JSON.stringify(env[k])})`);
  const hit = REFUSED_ENVIRONMENT.exec(JSON.stringify(env));
  if (hit !== null) problems.push(`the ${where} env sets ${hit[0]}`);
  return problems;
}
function sweepProblems(workflow) {
  const job = workflow?.jobs?.["mutation-sweep"];
  if (job === undefined || job === null || typeof job !== "object") return ["there is no mutation-sweep job"];
  const problems = [];
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const naming = sweepStepsOf(job);
  if (naming.length !== 1) problems.push(`${naming.length} steps name mutation-guard (exactly one runs the sweep)`);
  const step = steps[naming[0]];
  let shardsInLine = Number.NaN;
  if (step !== undefined) {
    const keys = Object.keys(step ?? {}).sort().join(",");
    if (keys !== "name,run") problems.push(`the sweep step carries {${keys}} (only name and run)`);
    if (typeof step?.run !== "string" || !SWEEP_RUN.test(step.run)) problems.push(`the sweep step's run is not exactly one line \`node scripts/mutation-guard.mjs --shard=\${{ matrix.shard }}/N\` (${JSON.stringify(step?.run)})`);
    else shardsInLine = Number.parseInt(SWEEP_RUN.exec(step.run)[1], 10);
  }
  for (const key of Object.keys(job)) if (!SWEEP_JOB_KEYS.includes(key)) problems.push(`the job carries \`${key}\` (${WHY_REFUSED[key] ?? "the sweep job holds only name, runs-on, timeout-minutes, strategy, steps and a literal env"})`);
  if (job["continue-on-error"] !== undefined && job["continue-on-error"] !== false) problems.push(`the job sets continue-on-error: ${JSON.stringify(job["continue-on-error"])}`);
  if (job["runs-on"] !== "ubuntu-latest") problems.push(`the job runs on ${JSON.stringify(job["runs-on"])}, not the literal ubuntu-latest (a self-hosted or computed runner brings its own environment)`);
  if (typeof job.name !== "string" || !isLiteral(job.name)) problems.push(`the job's name is not a literal string (${JSON.stringify(job.name)})`);
  if (!Number.isInteger(job["timeout-minutes"]) || job["timeout-minutes"] <= 0) problems.push(`the job's timeout-minutes is not a positive integer literal (${JSON.stringify(job["timeout-minutes"])})`);
  // The strategy is `fail-fast` (a literal boolean) and a matrix whose ONLY key is `shard`, a plain list of the integers 0..N-1 for the N the run line divides by:
  // no include, no exclude, no second axis, no expression anywhere.
  const strategy = job.strategy;
  if (!isMapping(strategy)) problems.push(`the job's strategy is ${JSON.stringify(strategy)}, not a plain mapping`);
  else {
    for (const key of Object.keys(strategy)) if (key !== "fail-fast" && key !== "matrix") problems.push(`the strategy carries \`${key}\` (it holds only fail-fast and matrix)`);
    if (strategy["fail-fast"] !== undefined && typeof strategy["fail-fast"] !== "boolean") problems.push(`strategy.fail-fast is ${JSON.stringify(strategy["fail-fast"])}, not a literal boolean`);
    const matrix = strategy.matrix;
    if (!isMapping(matrix)) problems.push(`strategy.matrix is ${JSON.stringify(matrix)}, not a plain mapping`);
    else {
      for (const key of Object.keys(matrix)) if (key !== "shard") problems.push(`strategy.matrix carries \`${key}\` (it holds shard and nothing else: an exclude drops a shard, an include adds one)`);
      const shard = matrix.shard;
      if (!Array.isArray(shard) || !shard.every((v, i) => Number.isInteger(v) && v === i)) problems.push(`strategy.matrix.shard is ${JSON.stringify(shard)}, not a plain list of the integers 0..N-1`);
      else if (Number.isInteger(shardsInLine) && shard.length !== shardsInLine) problems.push(`strategy.matrix.shard lists ${shard.length} shards and the run line divides by ${shardsInLine}`);
    }
  }
  problems.push(...envProblems("job", job.env), ...envProblems("workflow", workflow.env));
  if (workflow.defaults !== undefined) problems.push(`the workflow sets defaults (${WHY_REFUSED.defaults})`);
  for (const k of naming.length > 0 ? Array.from({ length: naming[0] }, (_, x) => x) : []) {
    const hit = REFUSED_ENVIRONMENT.exec(JSON.stringify({ run: steps[k]?.run ?? null, env: steps[k]?.env ?? null, with: steps[k]?.with ?? null }));
    if (hit !== null) problems.push(`step ${k + 1} (${steps[k]?.name ?? "unnamed"}) before the sweep touches ${hit[0]}`);
    // A local (composite) action runs steps this file does not show, and any of them may write GITHUB_ENV.
    if (typeof steps[k]?.uses === "string" && steps[k].uses.startsWith("./")) problems.push(`step ${k + 1} (${steps[k]?.name ?? "unnamed"}) before the sweep uses the local action ${steps[k].uses}, whose steps this file does not show`);
  }
  return problems;
}
const realSweepProblems = sweepProblems(WORKFLOW);
const sweepStep = sweepJob?.steps?.[sweepStepsOf(sweepJob)[0]];
const shardsInRun = Number.parseInt(SWEEP_RUN.exec(typeof sweepStep?.run === "string" ? sweepStep.run : "")?.[1] ?? "", 10);
const timeoutMinutes = sweepJob?.["timeout-minutes"];
const workflowOk = Number.isInteger(shardsInRun) && shardsInRun >= 1 && Number.isInteger(timeoutMinutes) && timeoutMinutes > 0;
check(`workflow: the mutation-sweep job runs \`--shard=<matrix>/N\` (N=${shardsInRun}) and bounds itself with timeout-minutes (${timeoutMinutes})`, workflowOk);
const matrixShards = sweepJob?.strategy?.matrix?.shard;
check(`workflow: matrix.shard is exactly 0..${shardsInRun - 1} (a shard the matrix lacks is swept by no runner)`,
  workflowOk && Array.isArray(matrixShards) && matrixShards.length === shardsInRun && matrixShards.every((v, i) => v === i));
check(`workflow: the mutation-sweep step is exactly one run line with \`\${{ matrix.shard }}\` as its only expression and only name and run beside it; the job holds ${SWEEP_JOB_KEYS.slice(0, 5).join(", ")} (and a literal env, continue-on-error only as false) and nothing else — no needs, container, services, if or defaults — on the literal ubuntu-latest, with a strategy that is fail-fast and a matrix of shard alone (a plain list of the integers 0..N-1: no include, no exclude); and nothing before the step writes GITHUB_ENV or GITHUB_PATH${realSweepProblems.length ? ` — ${realSweepProblems.join("; ")}` : ""}`, realSweepProblems.length === 0);
{
  const STEP = /^      - name: Mutation sweep \(shard \$\{\{ matrix\.shard \}\} of \d+\)\n        run: node scripts\/mutation-guard\.mjs --shard=\$\{\{ matrix\.shard \}\}\/\d+\n/m.exec(WORKFLOW_TEXT)?.[0];
  const head = "      - name: Mutation sweep (shard ${{ matrix.shard }} of 4)\n";
  const line = "node scripts/mutation-guard.mjs --shard=${{ matrix.shard }}/4";
  check("fixture: the real sweep step can be found in the workflow text, so the shapes below are built from it", STEP !== undefined);
  if (STEP !== undefined) {
    const withStep = (text) => parseYaml(WORKFLOW_TEXT.replace(STEP, () => text));
    const edited = (edit) => { const wf = structuredClone(WORKFLOW); edit(wf.jobs["mutation-sweep"], wf); return wf; };
    const earlier = (run) => edited((job) => { job.steps.splice(1, 0, { name: "Earlier step", run }); });
    check("fixture: the sweep-step check passes the real step and, so a pass means something, the unedited workflow rebuilt from its own text", sweepProblems(WORKFLOW).length === 0 && sweepProblems(withStep(STEP)).length === 0);
    // The forms the job MAY take stay green (a literal env, `continue-on-error: false`, `fail-fast: true`), so the key set is a closed list and not a ban on every edit.
    check("fixture: the permitted forms of the sweep job stay green (a literal env, `continue-on-error: false`, a literal `fail-fast: true`)",
      sweepProblems(edited((job) => { job.env = { TZ: "UTC", COUNT: 4, FLAG: true }; })).length === 0
      && sweepProblems(edited((job) => { job["continue-on-error"] = false; })).length === 0
      && sweepProblems(edited((job) => { job.strategy["fail-fast"] = true; })).length === 0);
    for (const [shape, wf] of [
      // The eight shapes that were green before, then the old ones and the job-level and earlier-step routes.
      ["another expression on the line (`${{ vars.SWEEP_FLAGS }}`)", withStep(`${head}        run: ${line} \${{ vars.SWEEP_FLAGS }}\n`)],
      ["a shell variable (`F=--plan; node ... $F`)", withStep(`${head}        run: F=--plan; ${line} $F\n`)],
      ["an `env:` block read as `$SWEEP_ARGS`", withStep(`${head}        env:\n          SWEEP_ARGS: --plan\n        run: ${line} $SWEEP_ARGS\n`)],
      ["a `|` block with a backslash continuation", withStep(`${head}        run: |\n          node scripts/mutation-guard.mjs \\\n            --plan --shard=\${{ matrix.shard }}/4\n`)],
      ["`if: false` on the step", withStep(`${head}        if: false\n        run: ${line}\n`)],
      ["`if: false` on the step followed by a step that runs `--plan`", withStep(`${head}        if: false\n        run: ${line}\n      - name: Mutation plan\n        run: node scripts/mutation-guard.mjs --plan --shard=\${{ matrix.shard }}/4\n`)],
      ["`|| true` on the line", withStep(`${head}        run: ${line} || true\n`)],
      ["`continue-on-error: true` on the step", withStep(`${head}        continue-on-error: true\n        run: ${line}\n`)],
      ["`NODE_OPTIONS=--import=<the stub preload>` in the step's env", withStep(`${head}        env:\n          NODE_OPTIONS: --import=./scripts/lib/sweep-stub-preload.mjs\n        run: ${line}\n`)],
      ["`--plan` before the shard", withStep(`${head}        run: node scripts/mutation-guard.mjs --plan --shard=\${{ matrix.shard }}/4\n`)],
      ["`--plan` after the shard", withStep(`${head}        run: ${line} --plan\n`)],
      ["`--plan` spelled through a template expression", withStep(`${head}        run: ${line}\${{ '--plan' }}\n`)],
      ["`--plan` in a `>` folded scalar", withStep(`${head}        run: >\n          node scripts/mutation-guard.mjs\n          --plan --shard=\${{ matrix.shard }}/4\n`)],
      ["`&& ... --plan` after the real command", withStep(`${head}        run: ${line} && node scripts/mutation-guard.mjs --plan --shard=\${{ matrix.shard }}/4\n`)],
      ["`--help` and `-h` on the line", withStep(`${head}        run: ${line} --help -h\n`)],
      ["the real line in a `|` block (a trailing newline: not one run line)", withStep(`${head}        run: |\n          ${line}\n`)],
      ["a second step that runs `--plan` after the real one", withStep(`${STEP}      - name: Mutation sweep, again\n        run: node scripts/mutation-guard.mjs --plan --shard=\${{ matrix.shard }}/4\n`)],
      ["`shell: bash -c true {0}` on the step", withStep(`${head}        shell: bash -c true {0}\n        run: ${line}\n`)],
      // The three shapes the round-5 re-check found GREEN (224/224), each a way to make the daily sweep not run or run faked, and the forms around them.
      ["`strategy.matrix.exclude: [{ shard: 3 }]` (shard 3 never runs)", edited((job) => { job.strategy.matrix.exclude = [{ shard: 3 }]; })],
      ["`strategy.matrix.include: [{ shard: 4 }]` (a fifth shard that refuses its own argument)", edited((job) => { job.strategy.matrix.include = [{ shard: 4 }]; })],
      ["a second matrix axis", edited((job) => { job.strategy.matrix.os = ["ubuntu-latest"]; })],
      ["`container.env.NODE_OPTIONS` loading the stub preload (every step in the container inherits it, so the sweep is faked)", edited((job) => { job.container = { image: "node:22", env: { NODE_OPTIONS: "--import=./scripts/lib/sweep-stub-preload.mjs" } }; })],
      ["a `services:` container", edited((job) => { job.services = { db: { image: "postgres:16" } }; })],
      ["`needs:` a job that is `if: false` (the sweep job is skipped)", edited((job, wf) => { wf.jobs.gatekeeper = { if: false, "runs-on": "ubuntu-latest", "timeout-minutes": 1, steps: [{ run: "echo never" }] }; job.needs = "gatekeeper"; })],
      ["`needs:` a job that is real (any dependency can skip this job)", edited((job) => { job.needs = ["verify"]; })],
      ["a job-level `env: ${{ fromJSON(vars.SWEEP_ENV) }}` expression", edited((job) => { job.env = "${{ fromJSON(vars.SWEEP_ENV) }}"; })],
      ["a job-level `env` that is a list", edited((job) => { job.env = ["NODE_OPTIONS=--import=./x.mjs"]; })],
      ["a job-level `env` value that is an expression (`FOO: ${{ vars.FOO }}`)", edited((job) => { job.env = { FOO: "${{ vars.FOO }}" }; })],
      ["a workflow-level `env: ${{ fromJSON(vars.SWEEP_ENV) }}` expression", edited((job, wf) => { wf.env = "${{ fromJSON(vars.SWEEP_ENV) }}"; })],
      ["`runs-on: ${{ vars.RUNNER }}`", edited((job) => { job["runs-on"] = "${{ vars.RUNNER }}"; })],
      ["`runs-on: self-hosted`", edited((job) => { job["runs-on"] = "self-hosted"; })],
      ["`runs-on` as a runner group", edited((job) => { job["runs-on"] = { group: "sweep" }; })],
      ["`strategy.fail-fast: ${{ vars.FF }}`", edited((job) => { job.strategy["fail-fast"] = "${{ vars.FF }}"; })],
      ["`strategy.max-parallel: 1`", edited((job) => { job.strategy["max-parallel"] = 1; })],
      ["`strategy:` as an expression", edited((job) => { job.strategy = "${{ fromJSON(vars.STRATEGY) }}"; })],
      ["`strategy.matrix:` as an expression", edited((job) => { job.strategy.matrix = "${{ fromJSON(vars.MATRIX) }}"; })],
      ["`matrix.shard:` as an expression", edited((job) => { job.strategy.matrix.shard = "${{ fromJSON(vars.SHARDS) }}"; })],
      ["`matrix.shard` with a string among the integers", edited((job) => { job.strategy.matrix.shard = [0, 1, 2, "3"]; })],
      ["`matrix.shard` missing the last shard", edited((job) => { job.strategy.matrix.shard = [0, 1, 2]; })],
      ["`matrix.shard` out of order", edited((job) => { job.strategy.matrix.shard = [0, 1, 3, 2]; })],
      ["`timeout-minutes` as an expression", edited((job) => { job["timeout-minutes"] = "${{ vars.T }}"; })],
      ["no `timeout-minutes`", edited((job) => { delete job["timeout-minutes"]; })],
      ["`concurrency` on the job", edited((job) => { job.concurrency = { group: "sweep", "cancel-in-progress": true }; })],
      ["`permissions` on the job", edited((job) => { job.permissions = "write-all"; })],
      ["`outputs` on the job", edited((job) => { job.outputs = { x: "${{ steps.a.outputs.x }}" }; })],
      ["the job as a reusable workflow call (`uses:`)", edited((job) => { job.uses = "./.github/workflows/other.yml"; })],
      ["`NODE_OPTIONS` in the job's env", edited((job) => { job.env = { NODE_OPTIONS: "--import=./scripts/lib/sweep-stub-preload.mjs" }; })],
      ["`NODE_OPTIONS` in the workflow's env", edited((job, wf) => { wf.env = { NODE_OPTIONS: "--require ./x.cjs" }; })],
      ["`continue-on-error: true` on the job", edited((job) => { job["continue-on-error"] = true; })],
      ["`continue-on-error: ${{ true }}` on the job (an expression is not `false`)", edited((job) => { job["continue-on-error"] = "${{ true }}"; })],
      ["`if: false` on the job", edited((job) => { job.if = false; })],
      ["`defaults.run.shell` on the job", edited((job) => { job.defaults = { run: { shell: "bash -c true {0}" } }; })],
      ["an earlier step that writes NODE_OPTIONS to GITHUB_ENV", earlier("echo \"NODE_OPTIONS=--import=./x.mjs\" >> $GITHUB_ENV")],
      ["an earlier step that writes to GITHUB_PATH", earlier("echo \"$PWD/fake-bin\" >> $GITHUB_PATH")],
      ["an earlier step that uses a local action (its steps are not in this file)", edited((job) => { job.steps.splice(1, 0, { name: "Local setup", uses: "./.github/actions/setup" }); })],
    ]) {
      const problems = sweepProblems(wf);
      check(`fixture: the sweep-step check refuses ${shape}`, problems.length > 0);
    }
  }
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
