// CI-job-timeout gate — an unbounded job is an unbounded outage.
//
// WHY THIS EXISTS. docs/COMPANY_BUILD_PLAN.md row 50 measured nine CI jobs with
// no `timeout-minutes`, two of them PR-gating. GitHub's default ceiling is 360
// minutes, so a hung step does not fail — it sits for six hours holding a
// merge, burning runner minutes, and looking "in progress" the whole time. On a
// PR-gating job that is indistinguishable from slow CI, which is exactly how it
// goes unnoticed.
//
// This is the operability twin of the repo's proof discipline: a gate that can
// never conclude tells you nothing, and a job that can never end is the same
// failure in the time domain.
//
// WHAT IS GATED. Every job in .github/workflows/*.yml declares
// `timeout-minutes`, or carries a DECLARED exemption below with a reason.
//
// A NOTE ON THE VALUES, since a bad bound is worse than none: these are set at
// roughly two to three times observed runtime, not at the observed runtime. A
// tight timeout is a flaky gate, and this repository's standing position is
// that a flaky gate gets switched off — at which point the bound protects
// nothing at all.
//
// SELF-TEST: the parser must find the real jobs (floor), and a synthetic job
// with no bound must be flagged. A gate that cannot fail proves nothing.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DIR = ".github/workflows";
const JOB_FLOOR = 20;

/** A job may be unbounded ONLY with a reason. Empty is the goal state. */
const DECLARED_UNBOUNDED = new Map();

function jobsIn(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const keys = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break; // left the jobs block
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (m) keys.push({ name: m[1], at: i });
  }
  return keys.map((k, idx) => {
    const end = idx + 1 < keys.length ? keys[idx + 1].at : lines.length;
    // THE JOB'S OWN KEY, at exactly four spaces — not `^\s+`, which was the defect
    // (found 2026-09-06). The block searched is the whole job INCLUDING its `steps:`,
    // so `^\s+timeout-minutes:` matched a STEP-level bound at 8 spaces and reported the
    // JOB as bounded. A step timeout bounds that step; the job's other steps, and the
    // merge waiting on the job, still ride GitHub's 360-minute default — which is the
    // only thing this gate is about. Reproduced against a planted workflow:
    //
    //     jobs:
    //       unbounded_job:
    //         runs-on: ubuntu-latest
    //         steps:
    //           - run: echo hi
    //             timeout-minutes: 10
    //
    // scored "0 unbounded" and exited 0. The self-test could not catch it: its `bad`
    // fixture has a `steps:` block with no nested timeout, so the one shape that
    // defeats the rule was the one shape untested. It is a fixture now.
    return { name: k.name, bounded: /^ {4}timeout-minutes:/m.test(lines.slice(k.at, end).join("\n")) };
  });
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const bad = "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n";
  const good = "jobs:\n  build:\n    timeout-minutes: 10\n    runs-on: ubuntu-latest\n";
  const twoJobs = "jobs:\n  a:\n    timeout-minutes: 5\n  b:\n    runs-on: x\n";
  // The shape that defeated the rule: a bound on a STEP, none on the job.
  const stepOnly =
    "jobs:\n  unbounded_job:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n        timeout-minutes: 10\n";
  // …and the honest neighbour: a job bounded at the job level that ALSO bounds a step,
  // which is what review-hub-ci.yml actually does. It must stay bounded, or the fix
  // above would punish the correct shape.
  const bothLevels =
    "jobs:\n  ok_job:\n    timeout-minutes: 30\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n        timeout-minutes: 10\n";
  const catchesUnbounded = jobsIn(bad).some((j) => !j.bounded);
  const acceptsBounded = jobsIn(good).every((j) => j.bounded);
  const separatesJobs = jobsIn(twoJobs).length === 2 && jobsIn(twoJobs)[0].bounded && !jobsIn(twoJobs)[1].bounded;
  const stepIsNotJob = jobsIn(stepOnly).length === 1 && !jobsIn(stepOnly)[0].bounded;
  const jobLevelStillCounts = jobsIn(bothLevels).length === 1 && jobsIn(bothLevels)[0].bounded;
  if (!catchesUnbounded || !acceptsBounded || !separatesJobs || !stepIsNotJob || !jobLevelStillCounts) {
    console.error(
      `✗ SELF-TEST FAILED — unbounded=${catchesUnbounded}, bounded=${acceptsBounded}, boundaries=${separatesJobs}, ` +
        `stepTimeoutIsNotAJobTimeout=${stepIsNotJob}, jobLevelStillCounts=${jobLevelStillCounts}. ` +
        "The job parser has drifted from the workflow shape; a gate that resolves nothing is green about nothing.",
    );
    process.exit(1);
  }
}

// AN ABSENT SUBJECT IS NOT A CLEAN SUBJECT (fixed 2026-09-06). This used to print
// "nothing to bound" and exit 0 — before JOB_FLOOR was ever consulted, so the one
// control against a drifted parse was bypassed by the case where the scan finds
// nothing at all. Reproduced: run the gate from any directory without a
// `.github/workflows` and it exited 0 having judged nothing. This repository ships
// workflows; their absence means the gate is looking in the wrong place.
if (!existsSync(DIR)) {
  console.error(`✗ no ${DIR} — this repository has workflows, so this is a wrong cwd or a deletion, not a clean tree.`);
  console.error(`  Refusing to report green over zero jobs (the floor below is ${JOB_FLOOR}). Run from the repo root.`);
  process.exit(1);
}

console.log("CI job timeouts — an unbounded job is an unbounded outage\n");
let total = 0;
let problems = 0;
for (const f of readdirSync(DIR).filter((e) => /\.ya?ml$/.test(e)).sort()) {
  for (const job of jobsIn(readFileSync(join(DIR, f), "utf8"))) {
    total += 1;
    const key = `${f}:${job.name}`;
    if (job.bounded) {
      if (DECLARED_UNBOUNDED.has(key)) {
        console.error(`  ✗ ${key}: now bounded, but still carries a declared-unbounded entry — remove the exemption`);
        problems += 1;
      }
      continue;
    }
    const reason = DECLARED_UNBOUNDED.get(key);
    if (reason) {
      console.log(`  · ${key}: DECLARED unbounded — ${reason.slice(0, 80)}…`);
      continue;
    }
    console.error(
      `  ✗ ${key}: no timeout-minutes. GitHub's default ceiling is 360 minutes, so a hung step holds\n` +
        "      the job — and the merge — for six hours while reporting 'in progress'.",
    );
    problems += 1;
  }
}

if (total < JOB_FLOOR) {
  console.error(`✗ only ${total} jobs found (floor ${JOB_FLOOR}) — the parse has drifted; refusing to report green.`);
  process.exit(1);
}

console.log(`\nci-job-timeouts: ${total} jobs, ${problems} unbounded; self-test green`);
if (problems > 0) {
  console.error("\nCI-job-timeout gate FAILED — bound the job, or declare it with a reason.");
  process.exit(1);
}
console.log("CI-job-timeout gate passed — every job declares how long it may run.");
