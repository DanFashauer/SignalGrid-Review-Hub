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
// mac-runner-auto.yml's nightly-both/nightly-mcp (reusable-workflow callers of
// mac-runner-harness.yml, whose mac-harness job bounds admission + 90m work) used to need a
// DECLARED_UNBOUNDED entry each because this parser did not follow `uses:`. Now that
// isBounded() resolves a local callee and inherits its bound, both jobs verify as
// bounded directly and the entries are gone — the follow-up their own reason text
// promised (added 2026-09-10 with the nightly flow, DR-036; resolved 2026-09-12).

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
    // A YAML scalar may be quoted (`uses: "./.github/workflows/x.yml"`); the quotes are not
    // part of the path. Strip one matching pair so a formatting-only change cannot turn a
    // verified local callee into an unreadable "remote" one (Codex P2 on #683, 2026-09-12).
    const usesTarget = usesMatch ? usesMatch[1].replace(/^(["'])(.*)\1$/, "$2") : null;
    const localCallee = usesTarget && /^\.\/.+\.ya?ml$/.test(usesTarget) ? usesTarget.replace(/^\.\//, "") : null;
    const remoteUses = Boolean(usesTarget) && !localCallee;
    // For the REPORTED margin comparison below: the job's display name (API job names are
    // the `name:` field, not the key) and its numeric bound. An expression bound
    // (`${{ … }}`) has no number to compare, so it reads null → "bound unreadable".
    const nameMatch = /^ {4}name:\s*(.+?)\s*$/m.exec(block);
    const displayName = nameMatch ? nameMatch[1].replace(/^(["'])(.*)\1$/, "$2") : null;
    const boundMatch = /^ {4}timeout-minutes:\s*(\d+(?:\.\d+)?)\s*(?:#.*)?$/m.exec(block);
    const timeoutMinutes = boundMatch ? Number(boundMatch[1]) : null;
    return { name: k.name, displayName, timeoutMinutes, hasJobTimeout, localCallee, remoteUses };
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

// ── REPORTED margin comparison: a bound against the job's longest recent run ──
// The header's "two to three times observed runtime" was prose; a bound 14 seconds above
// its job's longest green run (validation: 20 minutes against 19m46s, 1.01x) passed this
// gate while that bound cancelled runs in which no step had failed. This compares the two.
// REPORTED, NEVER FATAL: a latency threshold on a shared runner is a flaky gate and a flaky
// gate gets switched off. What it must never do is read clean over history it could not
// read — unreadable history is NOT-SCANNED, said aloud, never "0 below the floor".
const MARGIN_RATIO = 2;
const RUNS_PER_WORKFLOW = 5;
const HISTORY_LISTING_SIZE = 100;
const REPO = process.env.GITHUB_REPOSITORY || "DanFashauer/SignalGrid-Review-Hub";

/** The below-the-floor test. Pure; the self-test's mutant swaps this out. */
const belowFloor = (boundSeconds, longestSeconds, ratio) => boundSeconds < ratio * longestSeconds;

const fmtDur = (sec) => `${Math.floor(sec / 60)}m${String(Math.round(sec % 60)).padStart(2, "0")}s`;

/** Does an API job name belong to this parsed job? Exact, matrix (`name (x)`), or reusable (`caller / name`). */
function jobNameMatches(apiName, job) {
  const names = new Set([job.name]);
  if (job.displayName) names.add(job.displayName.split("${{")[0].trim());
  for (const n of names) {
    if (!n) continue;
    if (apiName === n || apiName.startsWith(`${n} (`) || apiName.endsWith(` / ${n}`)) return true;
  }
  return false;
}

/**
 * observations: [{ workflow: "x.yml", jobName, seconds, conclusion }]. Counts the longest
 * completed green run, or a mid-step kill (cancelled) at its kill time — whichever is
 * longer. Any other conclusion (an early failure) proves nothing about duration.
 */
export function evaluateMargins({ workflows, observations, ratio = MARGIN_RATIO, below = belowFloor }) {
  const listed = [];
  let compared = 0;
  let noRuns = 0;
  let noBound = 0;
  for (const { file, jobs } of workflows) {
    for (const job of jobs) {
      if (job.timeoutMinutes === null) { noBound += 1; continue; } // callers / expression bounds
      const seen = observations.filter(
        (o) => o.workflow === file && jobNameMatches(String(o.jobName), job) &&
          Number.isFinite(o.seconds) && (o.conclusion === "success" || o.conclusion === "cancelled"),
      );
      if (seen.length === 0) { noRuns += 1; continue; }
      compared += 1;
      const longest = Math.max(...seen.map((o) => o.seconds));
      const bound = job.timeoutMinutes * 60;
      if (below(bound, longest, ratio)) listed.push({ key: `${file}:${job.name}`, boundMin: job.timeoutMinutes, longest, times: bound / longest });
    }
  }
  return { listed, compared, noRuns, noBound };
}

/** Normalise one run's jobs payload (Actions API shape) into observations. Pure. */
export function observationsFromRun(workflow, jobsPayload) {
  const out = [];
  for (const j of jobsPayload?.jobs ?? []) {
    const a = Date.parse(j.started_at);
    const b = Date.parse(j.completed_at);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue; // unreadable timing is not evidence
    out.push({ workflow, jobName: j.name, seconds: (b - a) / 1000, conclusion: j.conclusion });
  }
  return out;
}

/**
 * Read history. Returns { ok, reason, observations }. Injectable: `file` (JSON of
 * { observations } or { unreadable: "why" }) or `fetchJson`. No token → NOT-scanned: the
 * liveness gate refuses an unauthenticated call in CI for the same reason (60/hour budget).
 */
export async function readHistory({ file, token, fetchJson }) {
  if (file) {
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      if (j.unreadable) return { ok: false, reason: String(j.unreadable), observations: [] };
      if (!Array.isArray(j.observations)) return { ok: false, reason: `${file} has no observations array`, observations: [] };
      return { ok: true, reason: null, observations: j.observations };
    } catch (e) {
      return { ok: false, reason: `history file unreadable: ${e.message}`, observations: [] };
    }
  }
  if (!token) return { ok: false, reason: "no GITHUB_TOKEN/GH_TOKEN in the environment", observations: [] };
  try {
    const listing = await fetchJson(`/repos/${REPO}/actions/runs?status=completed&per_page=${HISTORY_LISTING_SIZE}`);
    const perWorkflow = new Map();
    for (const run of listing.workflow_runs ?? []) {
      const wf = String(run.path ?? "").replace(/^\.github\/workflows\//, "").replace(/@.*$/, "");
      if (!wf) continue;
      perWorkflow.set(wf, [...(perWorkflow.get(wf) ?? []), run]);
    }
    if (perWorkflow.size === 0) return { ok: false, reason: "the runs listing returned no completed runs", observations: [] };
    const observations = [];
    for (const [wf, runs] of perWorkflow) {
      for (const run of runs.slice(0, RUNS_PER_WORKFLOW)) {
        observations.push(...observationsFromRun(wf, await fetchJson(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=100&filter=all`)));
      }
    }
    return { ok: true, reason: null, observations };
  } catch (e) {
    return { ok: false, reason: `Actions API read failed: ${e.message}`, observations: [] };
  }
}

async function githubJson(path) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "signalgrid-ci-job-timeouts", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status} ${res.statusText}`);
  return res.json();
}

/** The report lines for a history result. Pure, so the self-test can read them. */
export function renderMarginReport(history, result) {
  if (!history.ok) {
    return [`  margin vs longest run: NOT-SCANNED — ${history.reason}. Unreadable history is not a clean bill; no job was compared.`];
  }
  const lines = result.listed.map(
    (r) => `  ⚠ ${r.key}: bound ${r.boundMin}m is ${r.times.toFixed(2)}x its longest recent run (${fmtDur(r.longest)}), below the ${MARGIN_RATIO}x floor`,
  );
  lines.push(
    `  margin vs longest run (REPORTED, not fatal): ${result.listed.length} below ${MARGIN_RATIO}x of ${result.compared} compared; ` +
      `${result.noRuns} with no recent run, ${result.noBound} with no numeric bound (callers/expressions) not compared`,
  );
  return lines;
}

// ── self-test for the margin comparison ──────────────────────────────────────
{
  const wf = [{ file: "ci.yml", jobs: jobsIn("jobs:\n  validation:\n    name: Validation (x)\n    timeout-minutes: 20\n    runs-on: x\n  roomy:\n    timeout-minutes: 45\n    runs-on: x\n") }];
  const obs = [
    { workflow: "ci.yml", jobName: "Validation (x)", seconds: 19 * 60 + 46, conclusion: "success" },
    { workflow: "ci.yml", jobName: "roomy", seconds: 20 * 60, conclusion: "success" },
    { workflow: "ci.yml", jobName: "roomy", seconds: 3600, conclusion: "failure" }, // early failure: not evidence
  ];
  const real = evaluateMargins({ workflows: wf, observations: obs });
  const mutant = evaluateMargins({ workflows: wf, observations: obs, below: () => false }); // the comparison deleted
  const unread = renderMarginReport({ ok: false, reason: "no GITHUB_TOKEN/GH_TOKEN in the environment" }, { listed: [], compared: 0 });
  const killObs = evaluateMargins({ workflows: wf, observations: [{ workflow: "ci.yml", jobName: "roomy", seconds: 30 * 60, conclusion: "cancelled" }] });
  const checks = {
    flagsTightBound: real.listed.length === 1 && real.listed[0].key === "ci.yml:validation" && real.listed[0].times < 1.02,
    doesNotFlagRoomyBound: !real.listed.some((r) => r.key === "ci.yml:roomy"),
    killTimeCounts: killObs.listed.length === 1 && killObs.listed[0].key === "ci.yml:roomy",
    mutantIsCaught: mutant.listed.length === 0, // the assertion above (flagsTightBound) would fail on it
    unreadableIsNotScanned: unread.length === 1 && /NOT-SCANNED/.test(unread[0]) && !/0 below/.test(unread[0]),
  };
  if (!Object.values(checks).every(Boolean)) {
    console.error(`✗ SELF-TEST FAILED (margin comparison) — ${JSON.stringify(checks)}`);
    process.exit(1);
  }
}

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
  const quotedCaller = 'jobs:\n  call:\n    uses: "./.github/workflows/harness.yml"\n';
  const singleQuotedCaller = "jobs:\n  call:\n    uses: './.github/workflows/harness.yml'\n";
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
  const boundedResolver = (p) => (p === ".github/workflows/harness.yml" ? boundedCallee : null);
  const quotedCallerPasses = isBounded(one(quotedCaller), boundedResolver) === true;
  const singleQuotedCallerPasses = isBounded(one(singleQuotedCaller), boundedResolver) === true;
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
    !quotedCallerPasses ||
    !singleQuotedCallerPasses ||
    !callerUnboundedFails ||
    !callerMissingFails ||
    !remoteFails ||
    !cycleFails
  ) {
    console.error(
      `✗ SELF-TEST FAILED — unbounded=${catchesUnbounded}, bounded=${acceptsBounded}, boundaries=${separatesJobs}, ` +
        `stepTimeoutIsNotAJobTimeout=${stepIsNotJob}, jobLevelStillCounts=${jobLevelStillCounts}, ` +
        `callerBoundedPasses=${callerBoundedPasses}, quotedCallerPasses=${quotedCallerPasses}, singleQuotedCallerPasses=${singleQuotedCallerPasses}, callerUnboundedFails=${callerUnboundedFails}, ` +
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

// The margin comparison is REPORTED and never changes the exit code.
{
  const workflows = readdirSync(DIR).filter((e) => /\.ya?ml$/.test(e)).sort()
    .map((f) => ({ file: f, jobs: jobsIn(readFileSync(join(DIR, f), "utf8")) }));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const history = await readHistory({ file: process.env.CI_JOB_RUN_HISTORY_FILE, token, fetchJson: githubJson });
  const result = history.ok ? evaluateMargins({ workflows, observations: history.observations }) : null;
  console.log("");
  for (const line of renderMarginReport(history, result)) console.log(line);
}

console.log(`\nci-job-timeouts: ${total} jobs, ${problems} unbounded; self-test green`);
if (problems > 0) {
  console.error("\nCI-job-timeout gate FAILED — bound the job, or declare it with a reason.");
  process.exit(1);
}
console.log("CI-job-timeout gate passed — every job declares how long it may run.");
