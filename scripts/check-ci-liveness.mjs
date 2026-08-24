// CI-liveness gate — a sweep that stops running must FAIL a build, not go quiet.
//
// WHY THIS EXISTS, with the incident that specified it. The mutation sweep is
// the harness that proves every guard in this repository can actually fail. It
// runs on a schedule, and a scheduled job is the one kind of work with no author
// waiting on its result: if it silently stops, nothing turns red and the whole
// falsifiability claim quietly becomes unbacked. GitHub also disables scheduled
// workflows on inactive repositories, so "it stopped" is a real state, not a
// hypothetical.
//
// GATE ON THE JOB, NOT THE RUN. On 2026-08-23 the Scheduled Verification RUN
// reported conclusion=failure while the mutation sweep itself SUCCEEDED — the
// failing job was the daily image-vulnerability gate, on a real CRITICAL. A
// run-level conclusion answers "did any job fail", which is a different question
// from "did the sweep run", and the two need opposite responses: one is a defect
// to fix, the other is a harness that has gone dark. Reading the run conclusion
// as the sweep's health conflates them, and that is exactly the wrong-question
// error this repository keeps finding. So this gate resolves the sweep JOB's own
// last success.
//
// WHY THE API AND NOT A COMMITTED HEARTBEAT. The obvious alternative is for the
// sweep to write an artifact that a freshness gate reads. It was rejected on two
// grounds. It needs the workflow's GITHUB_TOKEN to push, which was never
// established as possible here (the repo's only precedent commits to a PR head
// branch, never the protected default). And it is strictly less truthful: a
// committed artifact can be stale-but-present, or written by a run that then
// failed, whereas a job's completion timestamp cannot lie about whether the job
// ran. Measure the thing, not a proxy the thing wrote.
//
// FATAL IN CI, REPORTED LOCALLY. Unknown must tighten — but a gate that fails a
// developer's preflight because they hold no API token is a gate that gets
// switched off, and a switched-off gate protects nothing. CI always has a token,
// so in CI an unreachable API is FATAL: it means the check could not run where
// it must. Locally it is REPORTED, never silent.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not judge whether the sweep's
// FINDINGS are acceptable — only that the sweep ran and succeeded recently
// enough. A sweep that runs daily and reports real failures is healthy by this
// gate's lights, and correctly so: that is the sweep working.
//
// SELF-TEST: the freshness decision is a pure function, exercised against fresh,
// borderline, stale, and missing inputs before any network call. A gate that
// cannot fail proves nothing.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = process.env.GITHUB_REPOSITORY || "DanFashauer/SignalGrid-Review-Hub";
const WORKFLOW_FILE = "scheduled-verification.yml";

// The job whose liveness is the point. Matched by prefix so the parenthetical
// tagline can be reworded without silently unhooking the gate — a name match
// that breaks on an edit is a fossil, and this one would fail OPEN by finding
// no job at all.
const SWEEP_JOB_PREFIX = "Daily mutation sweep";

// The sweep is daily. 48h tolerates exactly one missed or delayed run and fails
// on two consecutive misses — long enough not to flap on a slow scheduler,
// short enough that a dark harness is caught the next working day.
const STALE_AFTER_HOURS = 48;

// How many recent runs to inspect for the job. The sweep runs once a day, so ten
// runs is over a week of history; if no success appears in that window the
// harness has been dark long enough that the exact age stops mattering.
const RUNS_TO_INSPECT = 10;

const IN_CI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

// ── the decision, as a pure function so it can be tested without a network ────
export function evaluateLiveness({ lastSuccessIso, nowMs, staleAfterHours }) {
  if (!lastSuccessIso) {
    return { ok: false, reason: "no successful run of the sweep job in the inspected window" };
  }
  const ms = Date.parse(lastSuccessIso);
  // An unparseable timestamp is NOT fresh. Same rule as everywhere else here:
  // what cannot be read cannot be trusted, and NaN comparisons are false in the
  // permissive direction.
  if (!Number.isFinite(ms)) {
    return { ok: false, reason: `last success timestamp is unparseable: ${JSON.stringify(lastSuccessIso)}` };
  }
  const ageHours = (nowMs - ms) / 3_600_000;
  if (ageHours > staleAfterHours) {
    return { ok: false, reason: `last success was ${ageHours.toFixed(1)}h ago, over the ${staleAfterHours}h threshold` };
  }
  return { ok: true, ageHours };
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const now = Date.parse("2026-08-23T12:00:00Z");
  const at = (h) => new Date(now - h * 3_600_000).toISOString();
  const cases = [
    ["fresh (2h)", { lastSuccessIso: at(2), nowMs: now, staleAfterHours: 48 }, true],
    ["one missed run (30h) still passes", { lastSuccessIso: at(30), nowMs: now, staleAfterHours: 48 }, true],
    ["borderline just inside (47.9h)", { lastSuccessIso: at(47.9), nowMs: now, staleAfterHours: 48 }, true],
    ["two missed runs (49h) FAILS", { lastSuccessIso: at(49), nowMs: now, staleAfterHours: 48 }, false],
    ["long dark (30 days) FAILS", { lastSuccessIso: at(720), nowMs: now, staleAfterHours: 48 }, false],
    ["no success at all FAILS", { lastSuccessIso: null, nowMs: now, staleAfterHours: 48 }, false],
    ["unparseable timestamp FAILS", { lastSuccessIso: "not-a-date", nowMs: now, staleAfterHours: 48 }, false],
    ["empty timestamp FAILS", { lastSuccessIso: "", nowMs: now, staleAfterHours: 48 }, false],
  ];
  const bad = cases.filter(([, input, expected]) => evaluateLiveness(input).ok !== expected);
  if (bad.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED — these cases did not behave as required:\n" +
        bad.map(([name]) => `    · ${name}`).join("\n") +
        "\n  The freshness decision no longer distinguishes a live sweep from a dark one.",
    );
    process.exit(1);
  }
}


// ── resolve the sweep job's last success ─────────────────────────────────────
//
// ONE FAILED REQUEST IS NOT AN UNREACHABLE API. This gate reddened
// SignalGrid_Alpha on 2026-08-24 because a single request returned 504 Gateway
// Timeout and the gate concluded the API could not be reached. It was reached
// on the retry seconds later.
//
// The fail-closed behaviour was RIGHT and is unchanged: a liveness gate that
// cannot see its subject must fail, never skip. What was wrong was the
// measurement feeding it — "this request 504'd" answered a different question
// from "the API is unreachable", which is the same shape as every other defect
// this repository keeps finding. `lastSweepSuccess` makes up to eleven calls,
// so even a low transient-error rate turns into a red default branch often
// enough to teach people to ignore it. A gate that cries wolf gets switched
// off, and this one is load-bearing.
//
// So: retry the transient statuses, and NEVER retry the permanent ones. 401 and
// 403 mean the token is missing or lacks `actions: read`; 404 means the path or
// workflow file is wrong. Those are real findings about configuration and must
// surface on the first attempt rather than being buried under three retries.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const API_ATTEMPTS = 4;
const API_BACKOFF_MS = [500, 1500, 4000];

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(Number(status));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Injectable for the self-test; the real one is global fetch. */
export async function apiWith(fetchImpl, path, { attempts = API_ATTEMPTS, backoff = API_BACKOFF_MS, wait = sleep } = {}) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "signalgrid-ci-liveness" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  let last = null;
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await wait(backoff[i - 1] ?? backoff[backoff.length - 1] ?? 0);
    let res;
    try {
      res = await fetchImpl(`https://api.github.com${path}`, { headers });
    } catch (err) {
      // A network-level throw carries no status. Treat it as transient — the
      // exhaustion message below still fails the build if it never recovers.
      last = { retryable: true, message: `GET ${path} -> ${err.message}` };
      continue;
    }
    if (res.ok) return res.json();
    last = { retryable: isRetryableStatus(res.status), message: `GET ${path} -> ${res.status} ${res.statusText}` };
    if (!last.retryable) break;
  }
  throw new Error(last.retryable ? `${last.message} (unchanged after ${attempts} attempts)` : last.message);
}

async function api(path) {
  return apiWith(fetch, path);
}

// ── self-test: the retry that stopped a 504 from reddening the branch ────────
// A gate nobody has watched fail proves nothing, and the same is true of a
// retry nobody has watched retry. Both directions are asserted with a fake
// fetch: a transient status must recover, and a permanent one must NOT be
// retried, because burying a 403 under three retries hides a real finding about
// the token's `actions: read` scope.
{
  const failures = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const bad = (status) => ({ ok: false, status, statusText: `status ${status}` });
  const noWait = async () => {};
  const counting = (responses) => {
    let n = 0;
    const f = async () => {
      const r = responses[Math.min(n, responses.length - 1)];
      n += 1;
      if (r instanceof Error) throw r;
      return r;
    };
    return { f, calls: () => n };
  };

  const t = async (name, run) => {
    try {
      await run();
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  };

  await t("a 504 then success RECOVERS, and does not fail the build", async () => {
    const c = counting([bad(504), ok({ recovered: true })]);
    const got = await apiWith(c.f, "/x", { wait: noWait });
    if (!got.recovered || c.calls() !== 2) throw new Error(`calls=${c.calls()} got=${JSON.stringify(got)}`);
  });

  await t("a persistent 504 still FAILS after exhausting attempts", async () => {
    const c = counting([bad(504)]);
    let threw = null;
    try { await apiWith(c.f, "/x", { attempts: 3, backoff: [0, 0], wait: noWait }); } catch (e) { threw = e; }
    if (!threw || !/unchanged after 3 attempts/.test(threw.message)) throw new Error(`threw=${threw && threw.message}`);
    if (c.calls() !== 3) throw new Error(`expected 3 attempts, made ${c.calls()}`);
  });

  await t("a 403 is NOT retried — a permission finding must not hide under retries", async () => {
    const c = counting([bad(403)]);
    let threw = null;
    try { await apiWith(c.f, "/x", { wait: noWait }); } catch (e) { threw = e; }
    if (!threw || /unchanged after/.test(threw.message)) throw new Error(`threw=${threw && threw.message}`);
    if (c.calls() !== 1) throw new Error(`expected 1 attempt, made ${c.calls()}`);
  });

  await t("a network throw is treated as transient and recovers", async () => {
    const c = counting([new Error("ECONNRESET"), ok({ recovered: true })]);
    const got = await apiWith(c.f, "/x", { wait: noWait });
    if (!got.recovered || c.calls() !== 2) throw new Error(`calls=${c.calls()}`);
  });

  await t("the retryable set separates transient from permanent", async () => {
    const wrong = [
      [504, true], [502, true], [503, true], [429, true], [500, true],
      [401, false], [403, false], [404, false], [422, false],
    ].filter(([code, want]) => isRetryableStatus(code) !== want);
    if (wrong.length) throw new Error(`misclassified: ${wrong.map(([c]) => c).join(", ")}`);
  });

  if (failures.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED — the API retry no longer behaves as required:\n" +
        failures.map((f) => `    · ${f}`).join("\n") +
        "\n  Either a transient blip can redden the branch again, or a permanent\n" +
        "  auth/permission error is being buried under retries.",
    );
    process.exit(1);
  }
}

async function lastSweepSuccess() {
  const runs = await api(
    `/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${RUNS_TO_INSPECT}&status=completed`,
  );
  for (const run of runs.workflow_runs ?? []) {
    const jobs = await api(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=30`);
    const sweep = (jobs.jobs ?? []).find((j) => String(j.name ?? "").startsWith(SWEEP_JOB_PREFIX));
    // A run with no such job is not evidence either way — the job may have been
    // added later, or renamed. Keep looking rather than concluding from silence.
    if (!sweep) continue;
    if (sweep.conclusion === "success") {
      return { iso: sweep.completed_at, runUrl: run.html_url, runConclusion: run.conclusion };
    }
  }
  return null;
}

// Importing this file must not perform a network call. The pure decision above
// is exported so it can be exercised directly; everything below runs only when
// the file is invoked as a script. Without this guard, `import { evaluateLiveness }`
// silently hits the API — which is the same class of surprise this gate exists
// to catch, in the gate itself.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!invokedDirectly) {
  // imported for its pure function only
} else {

console.log("CI liveness — a sweep that stops running must fail a build, not go quiet\n");

let found;
try {
  found = await lastSweepSuccess();
} catch (err) {
  const msg = `could not reach the GitHub Actions API: ${err.message}`;
  if (IN_CI) {
    console.error(
      `  ✗ ${msg}\n` +
        "      In CI this is FATAL. A token is always available here, so an unreachable\n" +
        "      API means the check could not run where it is required to run — and a\n" +
        "      liveness gate that silently skips is the failure it exists to prevent.",
    );
    process.exit(1);
  }
  console.log(
    `  · NOT CHECKED — ${msg}\n` +
      "      Reported, not fatal, off CI: this needs an API token, and failing a\n" +
      "      developer's preflight for not holding one is how a gate gets switched\n" +
      "      off. CI runs it for real on every push.",
  );
  console.log("\nci-liveness: not checked locally (no API access); self-test green");
  process.exit(0);
}

const verdict = evaluateLiveness({
  lastSuccessIso: found?.iso ?? null,
  nowMs: Date.now(),
  staleAfterHours: STALE_AFTER_HOURS,
});

if (!verdict.ok) {
  console.error(
    `  ✗ The mutation sweep is not demonstrably alive — ${verdict.reason}.\n` +
      `      Workflow: ${WORKFLOW_FILE}, job starting "${SWEEP_JOB_PREFIX}"\n` +
      (found?.runUrl ? `      Last run inspected: ${found.runUrl}\n` : "") +
      "      This gates the JOB, not the run: a red run whose sweep job succeeded is\n" +
      "      a different problem and does not trip this. Check whether the schedule\n" +
      "      is still enabled — GitHub disables scheduled workflows on inactive repos.",
  );
  console.error("\nCI-liveness gate FAILED — the harness that proves every guard can fail has gone dark.");
  process.exit(1);
}

console.log(
  `  ✓ mutation sweep last succeeded ${verdict.ageHours.toFixed(1)}h ago ` +
    `(threshold ${STALE_AFTER_HOURS}h)\n      ${found.runUrl}` +
    (found.runConclusion !== "success"
      ? `\n      NOTE: that run's overall conclusion was "${found.runConclusion}" — a SIBLING job failed.\n` +
        "      That is deliberately not this gate's business: the sweep itself ran and passed."
      : ""),
);
console.log(`\nci-liveness: sweep alive, ${STALE_AFTER_HOURS}h threshold; self-test green`);
console.log("CI-liveness gate passed — the mutation sweep is demonstrably still running.");

}
