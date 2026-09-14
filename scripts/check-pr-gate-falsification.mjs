#!/usr/bin/env node
// Pre-merge gate-falsification authorizer — a diff cannot WEAKEN a gate and still be
// authorized green.
//
//   node scripts/check-pr-gate-falsification.mjs              # authorize the checkout vs its base
//   node scripts/check-pr-gate-falsification.mjs --json       # same, machine-readable verdict
//   node scripts/check-pr-gate-falsification.mjs --self-test  # prove the authorizer can fail, both ways
//
// WHY THIS EXISTS (DR-050's hole).
// -------------------------------
// `scripts/mutation-guard.mjs` proves that every REGISTERED guard is falsifiable by its
// own proof — but it sweeps the whole registry on a schedule, post-merge. Nothing asked
// the narrower, per-PR question: does THIS diff's own changed logic stay falsifiable? A
// pull request can weaken a decision branch in a covered file and, if the covering proof
// never pinned that exact line, the weakened line's mutation SURVIVES — the change ships
// green and the scheduled sweep only notices later, if at all.
//
// This authorizer closes that. It is MODEL-FREE and deterministic: it reuses the mutation
// guard's own MUTATORS and proof runner (imported, never re-implemented), applies them to
// the diff's OWN changed lines, and demands that each changed LINE be KILLED by a
// covering gate. It authorizes GREEN only for changes it can prove are still falsifiable;
// everything it cannot prove ESCALATES to a human — which, given the registry maps the
// decision core thinly and the mutators express only a handful of guard shapes, is the
// expected outcome for almost every real diff. That is by design: a merge authorizer that
// is easy to satisfy authorizes nothing. ESCALATE is the normal verdict, not a failure.
//
// VERDICTS (three-way, fail-closed):
//   green        every changed file is covered by a gate, its baseline passes unmutated,
//                and EVERY changed line carries at least one planted mutation the covering
//                gate KILLS. Only this authorizes an unattended merge.
//   escalate     a changed file has NO covering gate, OR a changed line's mutations all
//                SURVIVED (the weakening is not falsified), OR a changed line carries no
//                mutation the mutators express at all, OR the diff deletes lines outright.
//                A human must review. NOT an error — the normal outcome — but never an
//                unattended green.
//   inconclusive the baseline does not pass unmutated, a planted mutation HUNG/timed out,
//                the probe budget ran out, the working tree is dirty or locked, the diff
//                could not be computed, or a changed path did not survive normalization
//                verbatim. Fail-closed: never green.
//
// The hung=>killed polarity of the scheduled sweep is INVERTED here on purpose. In the
// sweep a hang is a detected regression (counted a kill); in a MERGE AUTHORIZER a hang is
// an observation we could not finish, so it is inconclusive and never authorizes green.
//
// EXIT CODES (so the auto-merge lane can consume the verdict without parsing prose):
//   0  green        3  escalate        2  inconclusive        1  usage / internal error
//
// ── WHAT AN ADVERSARIAL REVIEW FOUND HERE, AND WHAT THE SHAPE NOW IS ─────────────────
// Five blocking defects, each reproduced against the first version of this file. They are
// written down because every one of them was a FALSE GREEN, and a false green here is not
// a wrong answer — it is an unattended merge of a weakened gate.
//
//   B1  A changed hunk the mutators could not express was DROPPED, not escalated: the
//       emptiness check ran per FILE, after hunks with no mutation were filtered out. One
//       killed hunk anywhere in a file authorized every other changed hunk in it.
//       Reproduced: raising a connector's MAX_PROTOTYPE_DEPTH (the file's own hang control)
//       64x carries no mutation, so its hunk vanished; a trailing comment added to a
//       `return false;` line elsewhere in the same file was killed; verdict GREEN, exit 0.
//       The same weakening ALONE returned ESCALATE. → kills are now counted per changed
//       LINE, and a changed line with no expressible mutation ESCALATES.
//   B1b The kill was hunk-granular: `break` after the first kill, with `unprotected`
//       counting hunks. Under `--unified=0` a hunk is a contiguous run of changed lines,
//       so a kill on one line vouched for every other changed line beside it. Reproduced
//       on link-usability/evaluate.ts:221-222 — 221 is a SURVIVOR the sweep allowlists as
//       inert, 222 is KILLED, and they sit inside the same `if (`. Verdict GREEN.
//   B2  `--head=` / `PR_GATE_HEAD` authorized a revision whose code was never on disk: the
//       diff came from the named ref, every probe read the WORKING TREE, and nothing
//       asserted the two agreed. Reproduced with the checkout at base, tree clean: GREEN.
//       → the flag is GONE. The head is the checkout, always; the caller owns the worktree.
//   B3  Path normalization laundered an unexamined file into a covered one: `a/`/`b/`
//       stripping (which `git diff --name-only` never needs) plus a `Set` dedupe turned
//       `a/lib/incident-playbook/src/map.ts` — a NEW, UNCOVERED file — into the covered
//       `lib/...` twin, and the twin's kill authorized both. Two files in, one file out,
//       GREEN. → a live changed path must survive normalization VERBATIM or the run
//       refuses.
//   B4  `--self-test` proved nothing about the authorizer that actually runs: it drove only
//       the pure classifier with injected fakes, so `mainLive`, `emit`, the `EXIT` map, the
//       floor branch and the restore were never executed. Four broken-authorizer mutants
//       each passed 22/22 — including `EXIT = { green: 0, inconclusive: 0, escalate: 0 }`,
//       which authorizes every PR. → the self-test now SPAWNS this script and asserts the
//       observed exit code for each of the three verdicts.
//
// ISOLATION — and the reason it is no longer only a comment. In live mode this WRITES each
// mutation to disk, runs the proof, and restores the file. It is designed to be invoked
// inside a THROWAWAY git worktree checked out at the PR head; creating that worktree
// belongs to the caller, not to this gate. What this file now ENFORCES rather than
// assumes: it refuses to probe unless `git status --porcelain` is empty, and it holds a pid
// lock in the git dir naming the file it is currently mutating.
//
// SIGNALS, measured rather than assumed — because the obvious claim here is false. This
// runner is SYNCHRONOUS end to end (`runProof` is `spawnSync`), so the JS event loop never
// turns between the first probe and `process.exit`, and a signal handler registered here
// therefore never executes. What registering SIGINT/SIGTERM handlers actually buys is the
// SUPPRESSION of default termination: a SIGTERM delivered mid-probe is swallowed, the run
// finishes, and `finally` puts the guard back. Verified twice on a 14s proof — `kill -TERM`
// to the process, and a Ctrl-C-shaped SIGINT to the whole process group — each leaving the
// working tree CLEAN and the lock released. The price is honest and deliberate: while a
// probe is in flight this run cannot be stopped except with SIGKILL. SIGKILL cannot be
// caught, so the mutation survives on disk — and the dirty-tree refusal above is the net
// that catches it, by refusing the NEXT run instead of authorizing over a weakened
// checkout. Never leaving a weakened guard behind is worth more here than being killable.
//
// This file is SAFETY MACHINERY. It does not merge anything and it enables no auto-merge;
// it only produces the verdict a human or the auto-merge lane reads.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALLOWED, MUTATORS, TARGETS, mutationsFor, runProof } from "./mutation-guard.mjs";

const selfPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(selfPath), "..");

// The base the PR merges into. Overridable for testing and for a renamed base, but the
// default is the one branch this repo merges to.
const DEFAULT_BASE = process.env.PR_GATE_BASE || "origin/SignalGrid_Alpha";

// Floors on the imported machinery: if the registry or the mutator set has been gutted,
// this authorizer would wave everything through (nothing covered, or nothing mutable).
// Refuse rather than authorize over an empty world. Kept low enough to be true today and
// high enough that a collapse to a handful is caught. `--min-mutators` / `--min-covered`
// may only RAISE them (that is how the self-test reaches this branch end-to-end); nothing
// can lower them, because a flag that loosens a floor is a floor with a bypass.
const MUTATOR_FLOOR = 5;
const COVERAGE_FILE_FLOOR = 20;

// Ceiling on planted mutations per run. Per-LINE probing means a wide diff can ask for
// hundreds of proof runs; an unattended lane that silently burns hours is its own failure
// mode. Hitting the ceiling is INCONCLUSIVE — an observation that could not be finished,
// never a pass.
const PROBE_BUDGET = 200;

class Refusal extends Error {}
class UsageError extends Error {}

// ── path normalization ──────────────────────────────────────────────────────
// Used to key the coverage map off the registry's own spellings. It deliberately no
// longer strips git's `a/`/`b/` patch-header prefixes: `git diff --name-only` never emits
// them, so the stripping bought nothing and cost correctness — it collapsed a real,
// UNCOVERED top-level `a/lib/...` file onto its covered twin (B3). On the live path a
// changed path must now survive this function VERBATIM (see assertSaneChangedFiles), so
// normalization can no longer launder anything into coverage.
export function normalizePath(p) {
  let s = String(p).trim().replace(/\\/g, "/");
  if (s.startsWith("./")) s = s.slice(2);
  return s;
}

// Every live changed path, checked before it can be looked up in the coverage map.
// Exported so the self-test drives the exact function the live path uses.
export function assertSaneChangedFiles(rawPaths) {
  const seen = new Map();
  const files = [];
  for (const raw of rawPaths) {
    if (!raw) continue;
    const n = normalizePath(raw);
    if (n !== raw) {
      throw new Refusal(
        `git reported a changed path that does not survive normalization verbatim: ${JSON.stringify(raw)} → ` +
          `${JSON.stringify(n)}. Refusing — normalization is exactly how an unexamined path gets laundered onto ` +
          `a covered one (a real top-level "a/lib/..." file was authorized by its "lib/..." twin's kill).`,
      );
    }
    if (n.startsWith("/") || n.split("/").includes("..")) {
      throw new Refusal(`changed path escapes the repository: ${JSON.stringify(raw)}`);
    }
    // Unreachable while the verbatim rule above holds — kept as the second net, because
    // the first version of this file had only the dedupe and the dedupe is what silently
    // lost a file. If someone ever loosens normalization again, this refuses instead.
    if (seen.has(n)) {
      throw new Refusal(
        `two distinct changed paths collapse to one key: ${JSON.stringify(seen.get(n))} and ${JSON.stringify(raw)}. ` +
          `Refusing — a collapsed pair means one changed file is never examined.`,
      );
    }
    seen.set(n, raw);
    files.push(n);
  }
  return files;
}

// ── hunk parsing ────────────────────────────────────────────────────────────
// New-side line ranges from a `git diff --unified=0` body. A `+l,0` hunk is a PURE
// DELETION: it has no new-side line, so there is nothing to mutate and nothing to
// falsify. It used to be dropped, which made deleting a guard structurally invisible to
// this authorizer; it is now kept, flagged, and escalates.
export function parseHunks(diffText) {
  const hunks = [];
  for (const line of String(diffText).split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Number.parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : Number.parseInt(m[2], 10);
    if (count === 0) {
      hunks.push({ start, end: start, pureDeletion: true });
      continue;
    }
    hunks.push({ start, end: start + count - 1, pureDeletion: false });
  }
  return hunks;
}

// ── coverage map (DERIVED from mutation-guard's TARGETS, never hand-listed) ───
// Carries the target's `oneLine` opt-in too: the sweep applies the brace-less mutator only
// to targets that have opted in, and an authorizer that used a different mutator set than
// the sweep would report coverage the sweep does not have.
export function coverageMap() {
  const m = new Map();
  for (const t of TARGETS) for (const f of t.files) m.set(normalizePath(f), { proof: t.proof, oneLine: t.oneLine === true });
  return m;
}

const MAX_LISTED = 12;
const listLines = (ns) => (ns.length > MAX_LISTED ? `${ns.slice(0, MAX_LISTED).join(", ")}, …+${ns.length - MAX_LISTED}` : ns.join(", "));

// ── the pure classifier ──────────────────────────────────────────────────────
// Every side effect is injected, so the self-test drives the EXACT decision logic the
// live run uses without touching git or running a proof:
//
//   coveringProofOf(file)   -> proof name | null
//   fileExistsInHead(file)  -> boolean
//   hunksOf(file)           -> [{start,end,pureDeletion}]  new-side line ranges
//   mutationsOf(file)       -> [{lineNo,...}]              mutable lines in the head file
//   baselineOf(proof)       -> "survivor"|"killed"|"hung"
//   probe(proof, mutation)  -> "killed"|"survivor"|"hung"
//   noteFor(mutation)       -> ""|" (…)"  optional annotation for a surviving line
export function classifyPr(deps) {
  const { changedFiles, coveringProofOf, fileExistsInHead, hunksOf, mutationsOf, baselineOf, probe } = deps;
  const noteFor = deps.noteFor ?? (() => "");
  let budget = deps.probeBudget ?? PROBE_BUDGET;

  // POSITIVE CONTROL: an empty diff is not a green. A merge authorizer never green-lights
  // a no-op, and this is what stops the whole gate passing vacuously when it found nothing.
  if (changedFiles.length === 0) {
    return { overall: "escalate", files: [], reason: "empty diff — a merge authorizer never green-lights a no-op" };
  }

  const files = [];
  for (const file of changedFiles) {
    const proof = coveringProofOf(file);
    if (!proof) {
      files.push({ file, verdict: "escalate", reason: "no covering gate — not in mutation-guard TARGETS" });
      continue;
    }
    if (!fileExistsInHead(file)) {
      files.push({ file, proof, verdict: "escalate", reason: "covered decision module removed in head — owner review" });
      continue;
    }

    const hunks = hunksOf(file);
    const deletions = hunks.filter((h) => h.pureDeletion).length;
    if (deletions > 0) {
      files.push({
        file,
        proof,
        verdict: "escalate",
        reason: `${deletions} pure-deletion hunk(s) — deleted logic leaves no new-side line to mutate, so nothing there can be falsified`,
      });
      continue;
    }
    const changedLines = [];
    for (const h of hunks) for (let n = h.start; n <= h.end; n += 1) changedLines.push(n);
    if (changedLines.length === 0) {
      files.push({ file, proof, verdict: "escalate", reason: "the diff reports no new-side changed line here — nothing falsifiable to authorize" });
      continue;
    }

    const base = baselineOf(proof);
    if (base !== "survivor") {
      files.push({
        file,
        proof,
        verdict: "inconclusive",
        reason: `baseline reads "${base}" unmutated — cannot tell a kill from a broken harness`,
      });
      continue;
    }

    const byLine = new Map();
    for (const m of mutationsOf(file)) {
      if (!byLine.has(m.lineNo)) byLine.set(m.lineNo, []);
      byLine.get(m.lineNo).push(m);
    }

    let inconclusive = null;
    const unexpressed = [];
    const unprotected = [];
    let checked = 0;
    // PER CHANGED LINE, never per hunk. Under `--unified=0` a hunk is a contiguous run of
    // changed lines, so crediting a hunk with one kill lets a kill on one line vouch for
    // the weakened line next to it (B1b, reproduced on two adjacent conjuncts).
    for (const lineNo of changedLines) {
      const lineMuts = byLine.get(lineNo) ?? [];
      // B1: no mutator expresses this line. It is NOT authorized and NOT dropped — an
      // unfalsifiable changed line is exactly the thing a human has to look at.
      if (lineMuts.length === 0) {
        unexpressed.push(lineNo);
        continue;
      }
      let killed = false;
      let note = "";
      for (const m of lineMuts) {
        if (budget <= 0) {
          inconclusive = `probe budget of ${deps.probeBudget ?? PROBE_BUDGET} mutation(s) exhausted at line ${lineNo} — the falsification was not finished`;
          break;
        }
        budget -= 1;
        checked += 1;
        const v = probe(proof, m);
        if (v === "hung") {
          inconclusive = `a planted mutation at line ${m.lineNo} hung/timed out — falsification could not be completed`;
          break;
        }
        if (v === "killed") {
          killed = true;
          break; // this LINE is protected; no need to run its remaining mutations
        }
        if (!note) note = noteFor(m); // survivor: keep trying this line's other mutations
      }
      if (inconclusive) break;
      if (!killed) unprotected.push(`${lineNo}${note}`);
    }

    if (inconclusive) {
      files.push({ file, proof, verdict: "inconclusive", reason: inconclusive });
    } else if (unprotected.length > 0 || unexpressed.length > 0) {
      const parts = [];
      if (unprotected.length > 0) {
        parts.push(`${unprotected.length} changed line(s) unfalsified [${listLines(unprotected)}] — ${proof} does not catch a weakening there`);
      }
      if (unexpressed.length > 0) {
        parts.push(`${unexpressed.length} changed line(s) carry no mutation the mutators express [${listLines(unexpressed)}] — unfalsifiable, so escalated rather than dropped`);
      }
      files.push({ file, proof, verdict: "escalate", reason: parts.join("; ") });
    } else {
      files.push({
        file,
        proof,
        verdict: "green",
        reason: `covered by ${proof}; all ${changedLines.length} changed line(s) falsified (${checked} mutation probe(s))`,
      });
    }
  }

  const overall = files.some((f) => f.verdict === "inconclusive")
    ? "inconclusive"
    : files.some((f) => f.verdict === "escalate")
      ? "escalate"
      : "green";
  return { overall, files };
}

// ── live wiring ───────────────────────────────────────────────────────────────
function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// `.git` is a FILE, not a directory, inside a linked worktree — which is exactly where
// this authorizer is meant to run — so the git dir is always asked for, never assembled.
function gitDir() {
  return git(["rev-parse", "--absolute-git-dir"]).trim();
}

function lockPath() {
  return join(gitDir(), "pr-gate-falsification.lock");
}

function lockHolder() {
  const p = lockPath();
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { pid: null, mutating: null, unreadable: true };
  }
}

/** Pure, so both directions are provable without dirtying a tree or racing a lock.
 *  Returns a refusal verdict, or null when it is safe to plant mutations. */
export function probeReadyRefusal(dirtyText, holder) {
  // The LOCK is reported before the dirt, on purpose: when a run dies mid-probe both are
  // true at once, and the lock is the one that names the file whose mutation is still on
  // disk. Reporting the dirt first would describe the symptom and hide the cause.
  if (holder) {
    return {
      overall: "inconclusive",
      files: [],
      reason:
        `another gate-falsification run holds the lock (pid ${holder.pid ?? "unknown"}` +
        `${holder.mutating ? `, mutating ${holder.mutating}` : ""}). Two runs planting mutations in one checkout ` +
        `overwrite each other's restores. If that pid is gone, the run died mid-probe — check the named file, then ` +
        `delete the lock.`,
    };
  }
  if (dirtyText) {
    const lines = dirtyText.split("\n").filter(Boolean);
    return {
      overall: "inconclusive",
      files: [],
      reason:
        `refusing to plant mutations in a DIRTY working tree — ${lines.length} uncommitted/untracked entr(ies), first: ` +
        `${JSON.stringify(lines[0])}. This authorizer probes the CHECKOUT, so an unclean tree means the code being ` +
        `authorized is not the code that was committed. It is also the net under a SIGKILLed run: a mutation left on ` +
        `disk shows up here instead of being authorized.`,
    };
  }
  return null;
}

function liveProbeReadyRefusal() {
  return probeReadyRefusal(git(["status", "--porcelain"]).trim(), lockHolder());
}

// The mutation currently on disk. `finally` is what puts it back on every path a running
// process can take; this handle exists so the top-level catch can too.
let pendingRestore = null;

function restorePending() {
  if (!pendingRestore) return;
  writeFileSync(pendingRestore.abs, pendingRestore.original);
  pendingRestore = null;
}

/** Plant one mutation, run `run()`, restore. The ONLY place that writes a mutation to
 *  disk, and the only place that restores one — a per-caller restore is a restore someone
 *  forgets. Returns `run()`'s verdict VERBATIM: folding "hung" into "killed" here is the
 *  sweep's polarity, and in a merge authorizer it is a false green. */
export function probeWithRestore(mutation, run) {
  pendingRestore = { abs: mutation.abs, original: mutation.original };
  writeFileSync(mutation.abs, mutation.content);
  try {
    return run();
  } finally {
    restorePending();
  }
}

function parseArgs(argv) {
  const out = { json: false, selfTest: false, base: DEFAULT_BASE, minMutators: 0, minCovered: 0, child: null };
  const num = (name, v) => {
    if (!/^\d+$/.test(v)) throw new UsageError(`${name} expects a non-negative integer, got ${JSON.stringify(v)}`);
    return Number.parseInt(v, 10);
  };
  for (const a of argv) {
    if (a === "--json") {
      out.json = true;
      continue;
    }
    if (a === "--self-test") {
      out.selfTest = true;
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq === -1 ? a : a.slice(0, eq);
    const value = eq === -1 ? null : a.slice(eq + 1);
    if (name === "--head") {
      throw new UsageError(
        "--head is gone. It diffed the named ref while every probe read the working tree, so it authorized code that " +
          "was never on disk. Check the worktree out at the PR head instead — the caller owns worktree setup.",
      );
    }
    if (!["--base", "--min-mutators", "--min-covered", "--self-test-child"].includes(name)) {
      throw new UsageError(`unknown argument ${JSON.stringify(a)}`);
    }
    // A bare `--base` used to fall through to the default base SILENTLY, which authorizes
    // a diff against something other than what the caller named.
    if (value === null) throw new UsageError(`${name} needs a value: ${name}=<value>`);
    if (value === "") throw new UsageError(`${name}= is empty`);
    if (name === "--base") out.base = value;
    else if (name === "--min-mutators") out.minMutators = num(name, value);
    else if (name === "--min-covered") out.minCovered = num(name, value);
    else out.child = value;
  }
  if (process.env.PR_GATE_HEAD) {
    throw new UsageError("PR_GATE_HEAD is no longer honoured (it authorized code that was never on disk). Unset it and check the worktree out at the PR head.");
  }
  return out;
}

function mainLive(args) {
  const asJson = args.json;

  // Floors first: an authorizer over an empty world would wave everything through green.
  // `--min-*` may only raise them.
  const cov = coverageMap();
  const mutatorFloor = Math.max(MUTATOR_FLOOR, args.minMutators);
  const coverageFloor = Math.max(COVERAGE_FILE_FLOOR, args.minCovered);
  if (MUTATORS.length < mutatorFloor || cov.size < coverageFloor) {
    return emit(asJson, {
      overall: "inconclusive",
      files: [],
      reason: `imported machinery looks gutted — ${MUTATORS.length} mutator(s) (floor ${mutatorFloor}), ${cov.size} covered file(s) (floor ${coverageFloor}). Refusing to authorize over an empty world.`,
    });
  }

  // The end-to-end self-test's only door into this file. It is a FLAG, never an
  // environment variable: a flag has to be typed into the command line, so no ambient
  // setting can put the authorizer into it. Output is labelled, and the `emit`/`EXIT`
  // path it exercises is the real one — that is the entire point (B4).
  if (args.child) return childCase(args.child, asJson);

  let base;
  let changedFiles;
  try {
    base = git(["merge-base", args.base, "HEAD"]).trim();
    changedFiles = assertSaneChangedFiles(git(["diff", "--name-only", "--no-renames", `${base}..HEAD`]).split("\n"));
  } catch (err) {
    const why = err instanceof Refusal ? err.message : `could not compute the diff against ${args.base} (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). Fetch the base ref, then re-run`;
    return emit(asJson, { overall: "inconclusive", files: [], reason: `${why} — fail-closed, never green on an unknown diff.` });
  }

  // Only a COVERED changed file can lead to a probe, and only a probe can lead to green,
  // so the tree/lock preconditions are demanded exactly there. Checking them earlier would
  // make this gate unrunnable from a working checkout with uncommitted edits, which is how
  // a gate gets switched off.
  const willProbe = changedFiles.some((f) => cov.has(f));
  let locked = false;
  if (willProbe) {
    const refusal = liveProbeReadyRefusal();
    if (refusal) return emit(asJson, refusal);
    try {
      writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, mutating: null }), { flag: "wx" });
      locked = true;
    } catch (err) {
      return emit(asJson, {
        overall: "inconclusive",
        files: [],
        reason: `could not take the probe lock (${err instanceof Error ? err.message.split("\n")[0] : String(err)}) — refusing rather than racing another run's restores.`,
      });
    }
    // Registered for what it SUPPRESSES, not for what it runs (see the SIGNALS note in the
    // header): a synchronous runner never reaches the event loop, so these bodies do not
    // execute mid-probe — but with them registered the default "terminate now, leave the
    // mutation on disk" is off, the blocking proof returns, and `finally` restores. They do
    // run for a signal that arrives before the first probe, which is why they still restore
    // and release rather than just swallowing.
    for (const sig of ["SIGINT", "SIGTERM"]) {
      process.on(sig, () => {
        restorePending();
        try {
          rmSync(lockPath(), { force: true });
        } catch {
          /* the dirty-tree refusal on the next run is the backstop */
        }
        process.exit(1);
      });
    }
  }

  const baselineCache = new Map();
  try {
    const result = classifyPr({
      changedFiles,
      coveringProofOf: (f) => cov.get(f)?.proof ?? null,
      fileExistsInHead: (f) => existsSync(join(repoRoot, f)),
      hunksOf: (f) => parseHunks(git(["diff", "--unified=0", "--no-renames", `${base}..HEAD`, "--", f])),
      mutationsOf: (f) => mutationsFor(f, { oneLine: cov.get(f)?.oneLine === true }),
      baselineOf: (proof) => {
        if (!baselineCache.has(proof)) baselineCache.set(proof, runProof(proof));
        return baselineCache.get(proof);
      },
      probe: (proof, mutation) => {
        if (locked) writeFileSync(lockPath(), JSON.stringify({ pid: process.pid, mutating: mutation.file }));
        return probeWithRestore(mutation, () => runProof(proof));
      },
      // The sweep's allowlist NEVER authorizes anything here — an exemption is not a
      // falsification — but naming it tells the human reviewing the escalation that this
      // line is known-inert rather than newly broken.
      noteFor: (m) =>
        ALLOWED.some((a) => a.file === m.file && m.sourceLine.includes(a.line))
          ? " (allowlisted INERT in the sweep — still escalated: an exemption is not a falsification)"
          : "",
    });
    return emit(asJson, { base, baseRef: args.base, head: git(["rev-parse", "HEAD"]).trim(), ...result });
  } finally {
    restorePending();
    if (locked) rmSync(lockPath(), { force: true });
  }
}

const EXIT = { green: 0, inconclusive: 2, escalate: 3 };

function emit(asJson, result) {
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`PR gate-falsification — verdict: ${result.overall.toUpperCase()}`);
    if (result.reason) console.log(`  ${result.reason}`);
    for (const f of result.files ?? []) {
      const mark = f.verdict === "green" ? "ok" : f.verdict === "escalate" ? "→ ESCALATE" : "✗ INCONCLUSIVE";
      console.log(`  ${mark}  ${f.file}${f.proof ? ` [${f.proof}]` : ""}\n        ${f.reason}`);
    }
    console.log(
      result.overall === "green"
        ? "\nAUTHORIZED — every changed file is covered and every changed line stays falsifiable."
        : result.overall === "escalate"
          ? "\nESCALATE — a human must review; this branch is not eligible for an unattended merge."
          : "\nINCONCLUSIVE (fail-closed) — the authorizer could not finish; not green.",
    );
  }
  return EXIT[result.overall] ?? 1;
}

// ── the end-to-end self-test's child cases ───────────────────────────────────
// Each drives the REAL emit/EXIT/process.exit path. `green` and `escalate` run the REAL
// classifier over injected fakes; `probe-ready` runs the REAL tree/lock precondition.
function childCase(which, asJson) {
  const fake = {
    changedFiles: ["lib/x/evaluate.ts"],
    coveringProofOf: () => "proof:x",
    fileExistsInHead: () => true,
    hunksOf: () => [{ start: 10, end: 10, pureDeletion: false }],
    mutationsOf: () => [{ lineNo: 10, file: "lib/x/evaluate.ts", sourceLine: "if (x) {", describe: "d", abs: "/x", original: "o", content: "c" }],
    baselineOf: () => "survivor",
  };
  const label = (r) => ({ ...r, selfTestFixture: true });
  if (which === "green") return emit(asJson, label(classifyPr({ ...fake, probe: () => "killed" })));
  if (which === "escalate") return emit(asJson, label(classifyPr({ ...fake, probe: () => "survivor" })));
  if (which === "inconclusive") return emit(asJson, label(classifyPr({ ...fake, probe: () => "hung" })));
  if (which === "probe-ready") {
    const refusal = liveProbeReadyRefusal();
    return emit(asJson, label(refusal ?? { overall: "escalate", files: [], reason: "probe preconditions met (tree clean, lock free)" }));
  }
  throw new UsageError(`--self-test-child expects green|escalate|inconclusive|probe-ready, got ${JSON.stringify(which)}`);
}

// ── self-test: the authorizer must be able to fail, both directions ──────────
function runChild(args) {
  const run = spawnSync(process.execPath, [selfPath, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });
  return { status: run.status, out: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

function selfTest() {
  const checks = [];
  const threw = (fn) => {
    try {
      fn();
      return null;
    } catch (e) {
      return e;
    }
  };

  // Fakes let us drive classifyPr's exact logic without git or a real proof.
  const covered = "lib/integrations/src/integrations/link-usability/evaluate.ts";
  const oneHunk = () => [{ start: 10, end: 10, pureDeletion: false }];
  const mut = (lineNo, tag, sourceLine = "if (x) {") => ({ lineNo, file: covered, sourceLine, describe: tag, abs: "/x", original: "o", content: `c${tag}` });
  const oneMut = () => [mut(10, "m")];
  const base = {
    changedFiles: [covered],
    coveringProofOf: () => "proof:link-usability",
    fileExistsInHead: () => true,
    hunksOf: oneHunk,
    mutationsOf: oneMut,
    baselineOf: () => "survivor",
  };

  // 1. OK direction: a covered changed line with a killed mutant authorizes green.
  const green = classifyPr({ ...base, probe: () => "killed" });
  checks.push(["a covered changed line with a KILLED mutant → green", green.overall === "green" && green.files[0].verdict === "green"]);

  // 2. Positive control that the machinery is not a no-op: the SAME inputs but a surviving
  //    mutant must NOT be green — proving the verdict actually depends on the probe.
  const survive = classifyPr({ ...base, probe: () => "survivor" });
  checks.push(["POSITIVE CONTROL: the same line with a SURVIVING mutant is NOT green (verdict depends on the probe)", survive.overall === "escalate"]);
  checks.push(["…and it names the unfalsified line", /unfalsified \[10\]/.test(survive.files[0].reason)]);

  // 3. A changed file with no covering gate escalates.
  const uncovered = classifyPr({ ...base, changedFiles: ["docs/thing.md"], coveringProofOf: () => null, probe: () => "killed" });
  checks.push(["a changed file with NO covering gate → escalate", uncovered.overall === "escalate" && /no covering gate/.test(uncovered.files[0].reason)]);

  // 4. INVERTED POLARITY: a hung/timed-out mutation is inconclusive, never green/killed.
  const hung = classifyPr({ ...base, probe: () => "hung" });
  checks.push(["a planted mutation that HANGS → inconclusive, never green (inverted hung polarity)", hung.overall === "inconclusive" && hung.files[0].verdict === "inconclusive"]);

  // 5. A baseline that does not pass unmutated is inconclusive (broken harness, not a kill).
  const badBase = classifyPr({ ...base, baselineOf: () => "killed", probe: () => "killed" });
  checks.push(["a baseline that fails unmutated → inconclusive", badBase.overall === "inconclusive"]);
  const hungBase = classifyPr({ ...base, baselineOf: () => "hung", probe: () => "killed" });
  checks.push(["a baseline that hangs unmutated → inconclusive", hungBase.overall === "inconclusive"]);

  // 6. B1 — a changed line the mutators cannot express ESCALATES. It used to be filtered
  //    out before the emptiness check, so one killed line authorized the rest of the file.
  const noMut = classifyPr({ ...base, mutationsOf: () => [], probe: () => "killed" });
  checks.push(["B1: a covered file with no mutable changed logic → escalate", noMut.overall === "escalate" && /no mutation the mutators express/.test(noMut.files[0].reason)]);
  const b1 = classifyPr({
    ...base,
    // line 10 is unmutable (the weakening); line 20 is mutable and killed (the decoy).
    hunksOf: () => [
      { start: 10, end: 10, pureDeletion: false },
      { start: 20, end: 20, pureDeletion: false },
    ],
    mutationsOf: () => [mut(20, "decoy")],
    probe: () => "killed",
  });
  checks.push(["B1: a KILLED line elsewhere in the file does NOT authorize an unmutable changed line", b1.overall === "escalate" && /\[10\]/.test(b1.files[0].reason)]);

  // 7. B1b — kills are per LINE. Two changed lines in ONE hunk: one killed, one survivor.
  const b1b = classifyPr({
    ...base,
    hunksOf: () => [{ start: 221, end: 222, pureDeletion: false }],
    mutationsOf: () => [mut(221, "survivor"), mut(222, "killed")],
    probe: (_p, m) => (m.describe === "killed" ? "killed" : "survivor"),
  });
  checks.push(["B1b: a kill on line 222 does NOT vouch for the surviving line 221 beside it in the same hunk", b1b.overall === "escalate" && /unfalsified \[221\]/.test(b1b.files[0].reason)]);

  // 8. POSITIVE CONTROL: an empty diff cannot vacuously pass.
  const empty = classifyPr({ ...base, changedFiles: [], probe: () => "killed" });
  checks.push(["POSITIVE CONTROL: an empty diff is NOT green", empty.overall === "escalate" && /never green-lights a no-op/.test(empty.reason)]);

  // 9. Inconclusive dominates escalate dominates green across a mixed diff.
  const mixed = classifyPr({
    changedFiles: ["lib/a/evaluate.ts", "docs/x.md"],
    coveringProofOf: (f) => (f.startsWith("lib/") ? "proof:a" : null),
    fileExistsInHead: () => true,
    hunksOf: oneHunk,
    mutationsOf: oneMut,
    baselineOf: () => "survivor",
    probe: () => "killed",
  });
  checks.push(["a mixed diff (one green, one uncovered) → escalate overall", mixed.overall === "escalate"]);

  // 10. A LINE with one surviving and one killing mutation is protected (one kill suffices).
  const twoMuts = classifyPr({ ...base, mutationsOf: () => [mut(10, "m1"), mut(10, "m2")], probe: (_p, m) => (m.describe === "m2" ? "killed" : "survivor") });
  checks.push(["a line where any one of its mutations is killed is protected", twoMuts.overall === "green"]);

  // 11. A pure deletion is no longer structurally invisible.
  const deleted = classifyPr({ ...base, hunksOf: () => [{ start: 40, end: 40, pureDeletion: true }], probe: () => "killed" });
  checks.push(["a pure-deletion hunk → escalate (a deleted guard has no new-side line to falsify)", deleted.overall === "escalate" && /pure-deletion/.test(deleted.files[0].reason)]);

  // 12. The probe budget is fail-closed.
  const broke = classifyPr({ ...base, probeBudget: 0, probe: () => "killed" });
  checks.push(["an exhausted probe budget → inconclusive, never green", broke.overall === "inconclusive"]);

  // 13. The allowlist annotates a survivor; it never authorizes one.
  const annotated = classifyPr({ ...base, probe: () => "survivor", noteFor: () => " (allowlisted INERT)" });
  checks.push(["an allowlisted survivor is annotated but still escalates (an exemption is not a falsification)", annotated.overall === "escalate" && /allowlisted INERT/.test(annotated.files[0].reason)]);

  // ── path & hunk parsing ──
  checks.push(["normalizePath strips ./", normalizePath("./lib/x.ts") === "lib/x.ts"]);
  checks.push(["normalizePath maps \\ to /", normalizePath("lib\\x.ts") === "lib/x.ts"]);
  checks.push(["B3: normalizePath does NOT strip a/ b/ any more", normalizePath("a/lib/x.ts") === "a/lib/x.ts" && normalizePath("b/lib/x.ts") === "b/lib/x.ts"]);
  checks.push(["normalizePath does NOT strip a real dir (artifacts/)", normalizePath("artifacts/x.ts") === "artifacts/x.ts"]);
  checks.push(["a clean changed-file list passes through verbatim", JSON.stringify(assertSaneChangedFiles(["lib/a.ts", "a/lib/a.ts", ""])) === JSON.stringify(["lib/a.ts", "a/lib/a.ts"])]);
  checks.push(["B3: a path that does not survive normalization verbatim → REFUSED", /verbatim/.test(threw(() => assertSaneChangedFiles(["./lib/a.ts"]))?.message ?? "")]);
  checks.push(["B3: a Set-collapsing duplicate pair → REFUSED", /collapse/.test(threw(() => assertSaneChangedFiles(["lib/a.ts", "lib/a.ts"]))?.message ?? "")]);
  checks.push(["a path escaping the repo → REFUSED", /escapes/.test(threw(() => assertSaneChangedFiles(["../outside.ts"]))?.message ?? "")]);
  const hunks = parseHunks("@@ -1,2 +3,4 @@\n@@ -9 +9 @@\n@@ -20,5 +20,0 @@\n");
  checks.push(["parseHunks reads a +l,s hunk", hunks[0]?.start === 3 && hunks[0]?.end === 6 && hunks[0]?.pureDeletion === false]);
  checks.push(["parseHunks reads a +l (implicit ,1) hunk", hunks[1]?.start === 9 && hunks[1]?.end === 9]);
  checks.push(["parseHunks KEEPS a +l,0 pure-deletion hunk, flagged", hunks.length === 3 && hunks[2]?.pureDeletion === true]);

  // ── the live probe wrapper: it restores, and it does not launder a hang ──
  const tmp = join(gitDir(), "pr-gate-selftest-probe.tmp");
  writeFileSync(tmp, "ORIGINAL");
  const fakeMut = { abs: tmp, original: "ORIGINAL", content: "MUTATED", file: "x", lineNo: 1 };
  const seen = probeWithRestore(fakeMut, () => readFileSync(tmp, "utf8"));
  checks.push(["probeWithRestore plants the mutation while the proof runs", seen === "MUTATED"]);
  checks.push(["probeWithRestore restores the file afterwards", readFileSync(tmp, "utf8") === "ORIGINAL"]);
  writeFileSync(tmp, "ORIGINAL");
  threw(() =>
    probeWithRestore(fakeMut, () => {
      throw new Error("proof exploded");
    }),
  );
  checks.push(["probeWithRestore restores even when the proof throws", readFileSync(tmp, "utf8") === "ORIGINAL"]);
  checks.push(["probeWithRestore does NOT fold hung → killed (the sweep's polarity is a false green here)", probeWithRestore(fakeMut, () => "hung") === "hung"]);
  rmSync(tmp, { force: true });

  // ── the probe preconditions, both directions ──
  checks.push(["a DIRTY tree refuses to be probed", probeReadyRefusal("?? junk.ts", null)?.overall === "inconclusive"]);
  checks.push(["a HELD lock refuses to be probed", probeReadyRefusal("", { pid: 4242, mutating: "lib/x.ts" })?.overall === "inconclusive"]);
  checks.push(["a clean tree with a free lock is allowed to probe (the gate is satisfiable)", probeReadyRefusal("", null) === null]);

  // ── LIVE floors on the imported machinery (non-vacuity) ──
  checks.push([`LIVE: ${MUTATORS.length} mutator(s) imported (floor ${MUTATOR_FLOOR})`, MUTATORS.length >= MUTATOR_FLOOR]);
  const cov = coverageMap();
  checks.push([`LIVE: ${cov.size} covered file(s) derived from TARGETS (floor ${COVERAGE_FILE_FLOOR})`, cov.size >= COVERAGE_FILE_FLOOR]);
  const sampleFile = TARGETS[0]?.files?.[0];
  const sampleMuts = sampleFile ? mutationsFor(sampleFile) : [];
  checks.push([`LIVE: mutationsFor a real target (${sampleFile}) yields ${sampleMuts.length} mutation(s)`, sampleMuts.length > 0]);
  checks.push(["LIVE: coverage map resolves a known target file, and null for a made-up one", cov.get(normalizePath(sampleFile))?.proof != null && cov.get("nope/not-a-file.ts") == null]);
  checks.push(["LIVE: the coverage map carries each target's oneLine opt-in, so this authorizer mutates exactly what the sweep does", [...cov.values()].some((v) => v.oneLine === true) && [...cov.values()].some((v) => v.oneLine === false)]);

  // ── B4: END-TO-END. Everything above drives the pure classifier with fakes; four
  //    broken-authorizer mutants passed all of it. These arms SPAWN this script and read
  //    the exit code the auto-merge lane would read.
  const e2e = [
    ["green", ["--self-test-child=green"], 0],
    ["escalate", ["--self-test-child=escalate"], 3],
    ["inconclusive", ["--self-test-child=inconclusive"], 2],
  ];
  for (const [name, argv, want] of e2e) {
    const r = runChild(argv);
    checks.push([`E2E: a ${name.toUpperCase()} verdict exits ${want} (the EXIT map and emit(), not just the classifier)`, r.status === want]);
  }
  const emptyRun = runChild(["--base=HEAD"]);
  checks.push(["E2E: a REAL run over an empty diff exits 3 and refuses to green-light a no-op", emptyRun.status === 3 && /never green-lights a no-op/.test(emptyRun.out)]);
  const badRef = runChild(["--base=refs/heads/__pr_gate_self_test_no_such_ref__"]);
  checks.push(["E2E: a REAL run against an unknown base exits 2 (inconclusive, never green)", badRef.status === 2]);
  const gutted = runChild(["--base=HEAD", "--min-mutators=99999"]);
  checks.push(["E2E: the gutted-machinery FLOOR branch exits 2 (it is reachable and it fires)", gutted.status === 2 && /looks gutted/.test(gutted.out)]);
  const bareBase = runChild(["--base"]);
  checks.push(["E2E: a bare --base is a usage error (exit 1), not a silent fallback to the default base", bareBase.status === 1 && /needs a value/.test(bareBase.out)]);
  const headFlag = runChild(["--head=HEAD"]);
  checks.push(["E2E: B2 — --head is gone and rejected, not honoured", headFlag.status === 1 && /--head is gone/.test(headFlag.out)]);
  const envHead = spawnSync(process.execPath, [selfPath, "--base=HEAD"], { cwd: repoRoot, encoding: "utf8", env: { ...process.env, PR_GATE_HEAD: "HEAD" }, timeout: 120_000 });
  checks.push(["E2E: B2 — PR_GATE_HEAD is rejected, not honoured", envHead.status === 1 && /PR_GATE_HEAD is no longer honoured/.test(`${envHead.stdout}${envHead.stderr}`)]);
  const unknown = runChild(["--nope"]);
  checks.push(["E2E: an unknown argument is a usage error, never a default", unknown.status === 1 && /unknown argument/.test(unknown.out)]);

  // E2E: the probe preconditions as the live path actually calls them. The lock lives in
  // the git dir, so taking it here dirties nothing a gate can see.
  const lp = lockPath();
  const hadLock = existsSync(lp);
  if (hadLock) {
    checks.push(["E2E: probe-lock arm SKIPPED — a lock is already held (another run)", false]);
  } else {
    writeFileSync(lp, JSON.stringify({ pid: process.pid, mutating: "self-test" }));
    const held = runChild(["--self-test-child=probe-ready"]);
    rmSync(lp, { force: true });
    checks.push(["E2E: a HELD probe lock refuses the live run (exit 2)", held.status === 2 && /holds the lock/.test(held.out)]);
    const free = runChild(["--self-test-child=probe-ready"]);
    const treeDirty = git(["status", "--porcelain"]).trim() !== "";
    checks.push([
      `E2E: with the lock free the live precondition ${treeDirty ? "still refuses (this tree is dirty)" : "passes (this tree is clean)"} — the gate is satisfiable, not always-refuse`,
      free.status === (treeDirty ? 2 : 3),
    ]);
  }

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`usage error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("  node scripts/check-pr-gate-falsification.mjs [--base=<ref>] [--json] [--min-mutators=N] [--min-covered=N]");
    console.error("  node scripts/check-pr-gate-falsification.mjs --self-test");
    process.exit(1);
  }
  if (args.selfTest) process.exit(selfTest());
  try {
    process.exit(mainLive(args));
  } catch (err) {
    restorePending();
    console.error(`internal error: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  }
}
