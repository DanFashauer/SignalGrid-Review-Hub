#!/usr/bin/env node
// Pre-merge gate-falsification authorizer — a diff cannot WEAKEN a gate and still be
// authorized green.
//
//   node scripts/check-pr-gate-falsification.mjs              # authorize the branch vs its base
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
// the diff's OWN changed hunks, and demands that each mutable changed hunk be KILLED by a
// covering gate. It authorizes GREEN only for changes it can prove are still falsifiable;
// everything it cannot prove ESCALATES to a human — which, given the registry maps the
// decision core thinly, is the expected outcome for most core/API diffs. That is by
// design: a merge authorizer that is easy to satisfy authorizes nothing.
//
// VERDICTS (three-way, fail-closed):
//   green        every changed file is covered by a gate, its baseline passes unmutated,
//                and every changed hunk carrying mutable logic has at least one planted
//                mutation the covering gate KILLS. Only this authorizes an unattended merge.
//   escalate     a changed file has NO covering gate, OR a covered file's changed hunk had
//                a mutation SURVIVE (the weakening is not falsified), OR a covered file's
//                change carries no mutable logic the mutators express. A human must review.
//                NOT an error — the normal outcome — but never an unattended green.
//   inconclusive the baseline does not pass unmutated, a planted mutation HUNG/timed out,
//                or the diff could not be computed. Fail-closed: never green.
//
// The hung=>killed polarity of the scheduled sweep is INVERTED here on purpose. In the
// sweep a hang is a detected regression (counted a kill); in a MERGE AUTHORIZER a hang is
// an observation we could not finish, so it is inconclusive and never authorizes green.
//
// EXIT CODES (so the auto-merge lane can consume the verdict without parsing prose):
//   0  green        3  escalate        2  inconclusive        1  usage / internal error
//
// ISOLATION. In live mode this WRITES each mutation to disk, runs the proof, and restores
// the file in a `finally` — the same in-place-and-restore the sweep uses. It is designed
// to be invoked inside a THROWAWAY git worktree checked out at the PR head, so the
// mutations never touch a shared checkout; the restore is the second safety net, not the
// first. Creating that worktree (and provisioning its node_modules) belongs to the
// caller — the auto-merge lane — not to this gate.
//
// This file is SAFETY MACHINERY. It does not merge anything and it enables no auto-merge;
// it only produces the verdict a human or the auto-merge lane reads.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MUTATORS, TARGETS, mutationsFor, runProof } from "./mutation-guard.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The base the PR merges into. Overridable for testing and for a renamed base, but the
// default is the one branch this repo merges to.
const DEFAULT_BASE = process.env.PR_GATE_BASE || "origin/SignalGrid_Alpha";

// Floors on the imported machinery: if the registry or the mutator set has been gutted,
// this authorizer would wave everything through (nothing covered, or nothing mutable).
// Refuse rather than authorize over an empty world. Kept low enough to be true today and
// high enough that a collapse to a handful is caught.
const MUTATOR_FLOOR = 5;
const COVERAGE_FILE_FLOOR = 20;

// ── path normalization ──────────────────────────────────────────────────────
// Nothing may be laundered on a path-shape technicality: a covered file dressed as
// `./lib/x`, `a/lib/x`, or `lib\x` must resolve to the same key the coverage map holds.
export function normalizePath(p) {
  let s = String(p).trim().replace(/\\/g, "/");
  if (s.startsWith("./")) s = s.slice(2);
  // git's patch-header `a/`,`b/` prefixes — only when the SECOND char is the slash, so a
  // real top-level dir (artifacts/, ...) is untouched.
  if (/^[ab]\//.test(s)) s = s.slice(2);
  return s;
}

// ── hunk parsing ────────────────────────────────────────────────────────────
// New-side line ranges from a `git diff --unified=0` body. A `+l,0` hunk is a pure
// deletion (no new-side lines) and carries nothing to mutate, so it is dropped.
export function parseHunks(diffText) {
  const hunks = [];
  for (const line of String(diffText).split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!m) continue;
    const start = Number.parseInt(m[1], 10);
    const count = m[2] === undefined ? 1 : Number.parseInt(m[2], 10);
    if (count === 0) continue;
    hunks.push({ start, end: start + count - 1 });
  }
  return hunks;
}

// ── coverage map (DERIVED from mutation-guard's TARGETS, never hand-listed) ───
export function coverageMap() {
  const m = new Map();
  for (const t of TARGETS) for (const f of t.files) m.set(normalizePath(f), t.proof);
  return m;
}

// ── the pure classifier ──────────────────────────────────────────────────────
// Every side effect is injected, so the self-test drives the EXACT decision logic the
// live run uses without touching git or running a proof:
//
//   coveringProofOf(file)   -> proof name | null
//   fileExistsInHead(file)  -> boolean
//   hunksOf(file)           -> [{start,end}]      new-side line ranges of the diff
//   mutationsOf(file)       -> [{lineNo,...}]     mutable lines in the head file
//   baselineOf(proof)       -> "survivor"|"killed"|"hung"
//   probe(proof, mutation)  -> "killed"|"survivor"|"hung"
export function classifyPr(deps) {
  const { changedFiles, coveringProofOf, fileExistsInHead, hunksOf, mutationsOf, baselineOf, probe } = deps;

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
    const muts = mutationsOf(file);
    const mutHunks = hunksOf(file)
      .map((h) => muts.filter((m) => m.lineNo >= h.start && m.lineNo <= h.end))
      .filter((list) => list.length > 0);
    if (mutHunks.length === 0) {
      files.push({
        file,
        proof,
        verdict: "escalate",
        reason: "covered, but the diff carries no mutable decision logic the mutators express — nothing falsifiable to authorize",
      });
      continue;
    }

    let inconclusive = null;
    let unprotected = 0;
    let checked = 0;
    outer: for (const hunkMuts of mutHunks) {
      let killed = false;
      for (const m of hunkMuts) {
        checked += 1;
        const v = probe(proof, m);
        if (v === "hung") {
          inconclusive = `a planted mutation at line ${m.lineNo} hung/timed out — falsification could not be completed`;
          break outer;
        }
        if (v === "killed") {
          killed = true;
          break; // hunk is protected; no need to run its remaining mutations
        }
        // survivor: keep trying this hunk's other mutations
      }
      if (!killed) unprotected += 1;
    }

    if (inconclusive) {
      files.push({ file, proof, verdict: "inconclusive", reason: inconclusive });
    } else if (unprotected > 0) {
      files.push({
        file,
        proof,
        verdict: "escalate",
        reason: `${unprotected} changed hunk(s) unfalsified — ${proof} does not catch a weakening there`,
      });
    } else {
      files.push({ file, proof, verdict: "green", reason: `covered by ${proof}; every mutable changed hunk falsified (${checked} mutation probe(s))` });
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

function liveChangedFiles(base, head) {
  const out = git(["diff", "--name-only", "--no-renames", `${base}..${head}`]);
  return [...new Set(out.split("\n").map(normalizePath).filter(Boolean))];
}

function mainLive() {
  const asJson = process.argv.includes("--json");
  const baseRef = process.argv.find((a) => a.startsWith("--base="))?.split("=")[1] || DEFAULT_BASE;
  const headRef = process.argv.find((a) => a.startsWith("--head="))?.split("=")[1] || process.env.PR_GATE_HEAD || "HEAD";

  // Floors first: an authorizer over an empty world would wave everything through green.
  const cov = coverageMap();
  if (MUTATORS.length < MUTATOR_FLOOR || cov.size < COVERAGE_FILE_FLOOR) {
    return emit(asJson, {
      overall: "inconclusive",
      files: [],
      reason: `imported machinery looks gutted — ${MUTATORS.length} mutator(s) (floor ${MUTATOR_FLOOR}), ${cov.size} covered file(s) (floor ${COVERAGE_FILE_FLOOR}). Refusing to authorize over an empty world.`,
    });
  }

  let base;
  let changedFiles;
  try {
    base = git(["merge-base", baseRef, headRef]).trim();
    changedFiles = liveChangedFiles(base, headRef);
  } catch (err) {
    return emit(asJson, {
      overall: "inconclusive",
      files: [],
      reason: `could not compute the diff against ${baseRef} (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). Fetch the base ref, then re-run — fail-closed, never green on an unknown diff.`,
    });
  }

  const baselineCache = new Map();
  const result = classifyPr({
    changedFiles,
    coveringProofOf: (f) => cov.get(f) ?? null,
    fileExistsInHead: (f) => existsSync(join(repoRoot, f)),
    hunksOf: (f) => parseHunks(git(["diff", "--unified=0", "--no-renames", `${base}..${headRef}`, "--", f])),
    mutationsOf: (f) => mutationsFor(f),
    baselineOf: (proof) => {
      if (!baselineCache.has(proof)) baselineCache.set(proof, runProof(proof));
      return baselineCache.get(proof);
    },
    probe: (proof, mutation) => {
      writeFileSync(mutation.abs, mutation.content);
      try {
        return runProof(proof);
      } finally {
        writeFileSync(mutation.abs, mutation.original); // ALWAYS restore — a left-behind mutation is a broken guard on disk
      }
    },
  });

  return emit(asJson, { base, baseRef, head: headRef, ...result });
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
        ? "\nAUTHORIZED — every changed file is covered and every changed hunk stays falsifiable."
        : result.overall === "escalate"
          ? "\nESCALATE — a human must review; this branch is not eligible for an unattended merge."
          : "\nINCONCLUSIVE (fail-closed) — the authorizer could not finish; not green.",
    );
  }
  return EXIT[result.overall] ?? 1;
}

// ── self-test: the authorizer must be able to fail, both directions ──────────
function selfTest() {
  const checks = [];

  // Fakes let us drive classifyPr's exact logic without git or a real proof.
  const covered = "lib/integrations/src/integrations/link-usability/evaluate.ts";
  const oneHunk = () => [{ start: 10, end: 10 }];
  const oneMut = () => [{ lineNo: 10, describe: "if (x) → if (false)", abs: "/x", original: "o", content: "c" }];
  const base = {
    changedFiles: [covered],
    coveringProofOf: () => "proof:link-usability",
    fileExistsInHead: () => true,
    hunksOf: oneHunk,
    mutationsOf: oneMut,
    baselineOf: () => "survivor",
  };

  // 1. OK direction: a covered changed hunk with a killed mutant authorizes green.
  const green = classifyPr({ ...base, probe: () => "killed" });
  checks.push(["a covered changed hunk with a KILLED mutant → green", green.overall === "green" && green.files[0].verdict === "green"]);

  // 2. Positive control that the machinery is not a no-op: the SAME inputs but a surviving
  //    mutant must NOT be green — proving the verdict actually depends on the probe.
  const survive = classifyPr({ ...base, probe: () => "survivor" });
  checks.push(["POSITIVE CONTROL: the same hunk with a SURVIVING mutant is NOT green (verdict depends on the probe)", survive.overall === "escalate"]);
  checks.push(["…and it names the unfalsified hunk", /unfalsified/.test(survive.files[0].reason)]);

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

  // 6. A covered file whose changed hunks carry no mutable logic escalates (nothing to authorize).
  const noMut = classifyPr({ ...base, mutationsOf: () => [], probe: () => "killed" });
  checks.push(["a covered file with no mutable changed logic → escalate", noMut.overall === "escalate" && /nothing falsifiable/.test(noMut.files[0].reason)]);

  // 7. POSITIVE CONTROL: an empty diff cannot vacuously pass.
  const empty = classifyPr({ ...base, changedFiles: [], probe: () => "killed" });
  checks.push(["POSITIVE CONTROL: an empty diff is NOT green", empty.overall === "escalate" && /never green-lights a no-op/.test(empty.reason)]);

  // 8. Inconclusive dominates escalate dominates green across a mixed diff.
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

  // 9. A hunk with one surviving and one killing mutation is protected (one kill suffices).
  const twoMuts = classifyPr({
    ...base,
    mutationsOf: () => [
      { lineNo: 10, describe: "m1", abs: "/x", original: "o", content: "c1" },
      { lineNo: 10, describe: "m2", abs: "/x", original: "o", content: "c2" },
    ],
    probe: (_p, m) => (m.describe === "m2" ? "killed" : "survivor"),
  });
  checks.push(["a hunk where any one mutation is killed is protected", twoMuts.overall === "green"]);

  // ── path & hunk parsing ──
  checks.push(["normalizePath strips ./", normalizePath("./lib/x.ts") === "lib/x.ts"]);
  checks.push(["normalizePath maps \\ to /", normalizePath("lib\\x.ts") === "lib/x.ts"]);
  checks.push(["normalizePath strips a/ b/ prefixes", normalizePath("a/lib/x.ts") === "lib/x.ts" && normalizePath("b/lib/x.ts") === "lib/x.ts"]);
  checks.push(["normalizePath does NOT strip a real dir (artifacts/)", normalizePath("artifacts/x.ts") === "artifacts/x.ts"]);
  const hunks = parseHunks("@@ -1,2 +3,4 @@\n@@ -9 +9 @@\n@@ -20,5 +20,0 @@\n");
  checks.push(["parseHunks reads a +l,s hunk", hunks[0]?.start === 3 && hunks[0]?.end === 6]);
  checks.push(["parseHunks reads a +l (implicit ,1) hunk", hunks[1]?.start === 9 && hunks[1]?.end === 9]);
  checks.push(["parseHunks drops a +l,0 pure-deletion hunk", hunks.length === 2]);

  // ── LIVE floors on the imported machinery (non-vacuity) ──
  checks.push([`LIVE: ${MUTATORS.length} mutator(s) imported (floor ${MUTATOR_FLOOR})`, MUTATORS.length >= MUTATOR_FLOOR]);
  const cov = coverageMap();
  checks.push([`LIVE: ${cov.size} covered file(s) derived from TARGETS (floor ${COVERAGE_FILE_FLOOR})`, cov.size >= COVERAGE_FILE_FLOOR]);
  const sampleFile = TARGETS[0]?.files?.[0];
  const sampleMuts = sampleFile ? mutationsFor(sampleFile) : [];
  checks.push([`LIVE: mutationsFor a real target (${sampleFile}) yields ${sampleMuts.length} mutation(s)`, sampleMuts.length > 0]);
  checks.push(["LIVE: coverage map resolves a known target file, and null for a made-up one", cov.get(normalizePath(sampleFile)) != null && cov.get("nope/not-a-file.ts") == null]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  process.exit(mainLive());
}
