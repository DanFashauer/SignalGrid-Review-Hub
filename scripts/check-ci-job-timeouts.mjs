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
// Reusable-workflow callers cannot carry timeout-minutes (GitHub rejects it on a `uses:` job); the
// bound lives in the callee. Declared with the reason so the parser's blind spot is named, not hidden.
DECLARED_UNBOUNDED.set("mac-runner-auto.yml:nightly-both", "BOUNDED, not unbounded — a reusable-workflow CALLER (uses: ./.github/workflows/mac-runner-harness.yml). GitHub rejects timeout-minutes on a `uses:` job; the bound is the callee's, mac-runner-harness.yml job mac-harness timeout-minutes: 90, and the callee's concurrency group serialises the two nightly calls. Declared here only because this parser does not follow `uses:`. Follow-up: resolve a local `uses:` and inherit the callee's bound, then delete this entry (added 2026-09-10 with the nightly flow, DR-036).");
DECLARED_UNBOUNDED.set("mac-runner-auto.yml:nightly-mcp", "BOUNDED, not unbounded — a reusable-workflow CALLER (uses: ./.github/workflows/mac-runner-harness.yml). GitHub rejects timeout-minutes on a `uses:` job; the bound is the callee's, mac-runner-harness.yml job mac-harness timeout-minutes: 90, and the callee's concurrency group serialises the two nightly calls. Declared here only because this parser does not follow `uses:`. Follow-up: resolve a local `uses:` and inherit the callee's bound, then delete this entry (added 2026-09-10 with the nightly flow, DR-036).");

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
    const block = lines.slice(k.at, end).join("\n");
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
    const hasJobTimeout = /^ {4}timeout-minutes:/m.test(block);
    // A REUSABLE-WORKFLOW CALLER: `uses:` at the JOB level (exactly four spaces —
    // a step's `uses:` sits at six under `steps:` and is not matched). GitHub Actions
    // FORBIDS `timeout-minutes` on a job that calls a reusable workflow, so such a job
    // can never satisfy the rule above no matter how it is written — and its runtime is
    // bounded not by a field it may not carry but by the workflow it calls. A LOCAL
    // callee (`./.github/workflows/x.yml`) we can resolve and verify; a remote one
    // (`owner/repo/.github/workflows/y.yml@ref`) we cannot, so it stays unbounded.
    // This blind spot is why mac-runner-auto.yml's `nightly-both`/`nightly-mcp` (callers
    // of mac-runner-harness.yml, whose `mac-harness` job is bounded at 90m) reddened the
    // gate on every PR into Alpha though nothing was actually unbounded (2026-09-10).
    const usesMatch = /^ {4}uses:\s*(\S+)/m.exec(block);
    const usesTarget = usesMatch ? usesMatch[1] : null;
    const localCallee = usesTarget && /^\.\/.+\.ya?ml$/.test(usesTarget) ? usesTarget.replace(/^\.\//, "") : null;
    const remoteUses = Boolean(usesTarget) && !localCallee;
    return { name: k.name, hasJobTimeout, localCallee, remoteUses };
  });
}

/**
 * Is a job bounded? True when it carries its own `timeout-minutes`, OR it is a caller of
 * a LOCAL reusable workflow whose every job is itself bounded (recurse one level or more,
 * cycle-guarded). FAIL CLOSED everywhere else: a remote `uses:` we cannot read, a callee
 * that does not resolve, a callee with no jobs, or a call cycle, all read UNBOUNDED — the
 * same discipline the rest of this gate keeps, so a delegated bound is verified, never
 * assumed. `resolve(path)` returns the callee's parsed jobs (or null); it is injected so
 * the self-test can exercise the recursion without touching the real filesystem.
 */
function isBounded(job, resolve, visiting = new Set()) {
  if (job.hasJobTimeout) return true;
  if (job.remoteUses) return false; // cannot verify a workflow this checkout does not hold
  if (!job.localCallee) return false;
  if (visiting.has(job.localCallee)) return false; // a call cycle bounds nothing
  const callee = resolve(job.localCallee);
  if (!callee || callee.length === 0) return false; // unresolved or jobless → unbounded
  const next = new Set(visiting);
  next.add(job.localCallee);
  return callee.every((j) => isBounded(j, resolve, next));
}

// Resolve a local reusable workflow to its parsed jobs, cached; missing file → null.
const parsedFileCache = new Map();
function jobsForFile(relPath) {
  if (parsedFileCache.has(relPath)) return parsedFileCache.get(relPath);
  const jobs = existsSync(relPath) ? jobsIn(readFileSync(relPath, "utf8")) : null;
  parsedFileCache.set(relPath, jobs);
  return jobs;
}
const resolveLocal = (relPath) => jobsForFile(relPath);

// ── self-test ────────────────────────────────────────────────────────────────
{
  const NONE = () => null; // a resolver that finds no callees — for the non-caller cases
  const one = (yaml) => jobsIn(yaml)[0];
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
  const catchesUnbounded = jobsIn(bad).some((j) => !isBounded(j, NONE));
  const acceptsBounded = jobsIn(good).every((j) => isBounded(j, NONE));
  const twoParsed = jobsIn(twoJobs);
  const separatesJobs = twoParsed.length === 2 && isBounded(twoParsed[0], NONE) && !isBounded(twoParsed[1], NONE);
  const stepIsNotJob = jobsIn(stepOnly).length === 1 && !isBounded(one(stepOnly), NONE);
  const jobLevelStillCounts = jobsIn(bothLevels).length === 1 && isBounded(one(bothLevels), NONE);

  // Reusable-workflow CALLER recursion — the 2026-09-10 blind spot. A job whose only
  // marker of duration is `uses: ./…` is bounded IFF the workflow it calls is bounded,
  // and fail-closed against every way that verification can come up empty.
  const caller = "jobs:\n  call:\n    uses: ./.github/workflows/harness.yml\n    with:\n      lane: both\n";
  const boundedCallee = jobsIn("jobs:\n  work:\n    timeout-minutes: 90\n    runs-on: x\n");
  const unboundedCallee = jobsIn("jobs:\n  work:\n    runs-on: x\n    steps:\n      - run: echo hi\n");
  const remoteCaller = "jobs:\n  call:\n    uses: owner/repo/.github/workflows/y.yml@main\n";
  const callerToBounded = isBounded(one(caller), (p) => (p === ".github/workflows/harness.yml" ? boundedCallee : null));
  const callerToUnbounded = isBounded(one(caller), (p) =>
    p === ".github/workflows/harness.yml" ? unboundedCallee : null,
  );
  const callerToMissing = isBounded(one(caller), () => null); // callee does not resolve
  const remoteIsUnbounded = isBounded(one(remoteCaller), NONE); // a workflow we cannot read
  const cycleIsUnbounded = isBounded(one(caller), (p) =>
    p === ".github/workflows/harness.yml" ? jobsIn(caller) : null,
  ); // harness.yml calls back into itself → the call cycle bounds nothing

  const callerBoundedPasses = callerToBounded === true;
  const callerUnboundedFails = callerToUnbounded === false;
  const callerMissingFails = callerToMissing === false;
  const remoteFails = remoteIsUnbounded === false;
  const cycleFails = cycleIsUnbounded === false;

  if (
    !catchesUnbounded ||
    !acceptsBounded ||
    !separatesJobs ||
    !stepIsNotJob ||
    !jobLevelStillCounts ||
    !callerBoundedPasses ||
    !callerUnboundedFails ||
    !callerMissingFails ||
    !remoteFails ||
    !cycleFails
  ) {
    console.error(
      `✗ SELF-TEST FAILED — unbounded=${catchesUnbounded}, bounded=${acceptsBounded}, boundaries=${separatesJobs}, ` +
        `stepTimeoutIsNotAJobTimeout=${stepIsNotJob}, jobLevelStillCounts=${jobLevelStillCounts}, ` +
        `callerBoundedPasses=${callerBoundedPasses}, callerUnboundedFails=${callerUnboundedFails}, ` +
        `callerMissingFails=${callerMissingFails}, remoteUsesFails=${remoteFails}, callCycleFails=${cycleFails}. ` +
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
    if (isBounded(job, resolveLocal)) {
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
