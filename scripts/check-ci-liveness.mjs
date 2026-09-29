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
// switched off, and a switched-off gate protects nothing. CI has a token — when
// the workflow STEP hands it over (`env: GITHUB_TOKEN: ${{ github.token }}`;
// Actions never exports it on its own) — so in CI an unreachable API is FATAL: it
// means the check could not run where it must. Locally it is REPORTED, never silent.
//
// AN ABSENT TOKEN IN CI IS FATAL TOO, NOT A FALLBACK. From the day it was wired until
// 2026-09-26 the CI step set no env, this script found no token, and every call went
// out unauthenticated on the runner address's 60-per-hour budget — the paragraph
// above said "CI always has a token" while the gate had never once used one. It
// passed on that budget until a mail PR found it exhausted (`limit=60 used=60`). A
// gate that quietly degrades to a weaker credential is the fail-open shape golden
// rule 2 forbids, so `tokenProblem` below refuses to run unauthenticated in CI.
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

/** In CI, no token is a broken step, never a reason to call unauthenticated. Pure. */
export function tokenProblem({ inCi, token }) {
  if (!inCi || (typeof token === "string" && token.length > 0)) return null;
  return "no GITHUB_TOKEN/GH_TOKEN in the environment — in CI this gate refuses to fall back to an " +
    "unauthenticated call (a 60-per-hour per-address budget that this step ran on, unnoticed, until " +
    "2026-09-26). Hand the step the token: env: GITHUB_TOKEN: ${{ github.token }}";
}

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
  for (const [name, input, expectNull] of [
    ["token: CI with a token → no problem", { inCi: true, token: "ghs_x" }, true],
    ["token: local with no token → no problem (REPORTED path, not this check)", { inCi: false, token: "" }, true],
    ["token: CI with an EMPTY token → FATAL problem naming the fix", { inCi: true, token: "" }, false],
    ["token: CI with an undefined token → FATAL problem", { inCi: true, token: undefined }, false],
  ]) {
    const p = tokenProblem(input);
    if ((p === null) !== expectNull || (p !== null && !/github\.token/.test(p))) bad.push([name]);
  }
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
// So: retry the transient statuses, and NEVER retry the permanent ones. 401 means
// the token is missing; 404 means the path or workflow file is wrong. Those are real
// findings about configuration and must surface on the first attempt rather than
// being buried under three retries.
//
// 403 IS BOTH, AND THAT IS WHY IT NEEDS THE BODY. GitHub returns 403 for a token
// lacking `actions: read` — a permanent configuration finding — AND for a secondary
// rate limit, which is as transient as a 429. Treating all 403s as permanent reddened
// this branch on 2026-08-24 with "403 rate limit exceeded", after the E2E job had
// already been re-run once: exactly the cry-wolf failure the retry was added to
// prevent, reintroduced by the arm meant to keep permission findings honest.
//
// The status alone cannot tell them apart, so the BODY decides. A 403 whose payload
// says "rate limit" or carries the exhausted-quota headers is retried; every other
// 403 still fails on the first attempt. Fail-closed on the ambiguity in the direction
// that matters: an unreadable or unexpected 403 body is NOT treated as a rate limit.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const API_ATTEMPTS = 4;
const API_BACKOFF_MS = [500, 1500, 4000];

// A RATE LIMIT SAYS WHEN IT CLEARS, AND SECONDS OF BACKOFF CANNOT REACH IT. The
// retry above recovers a 504; it cannot recover a rate limit, because GitHub's
// windows are measured in minutes to an hour and the four attempts here span
// about six seconds. #828 (2026-09-18) and #654 (2026-09-12) both reddened on
// "403 rate limit exceeded (rate limited) (unchanged after 4 attempts)" — a
// retry that was never going to succeed, and a failure that named neither the
// limit it hit nor when it would clear, so nothing in the log said which token,
// which resource, or what was spending it.
//
// So a rate-limited response is waited out by ITS OWN clock — `retry-after`, or
// `x-ratelimit-reset` — up to a cap, and when the clock is past the cap the gate
// fails AT ONCE naming the instant, rather than spending three pointless retries
// first. Fail-closed is unchanged either way; what changes is that the failure is
// legible, and the recoverable case actually recovers. The cap is a bound on
// runner minutes, not a claim about the limit.
const RATE_LIMIT_WAIT_CAP_MS = 120_000;

const headerOf = (headers, k) =>
  headers && typeof headers.get === "function" ? headers.get(k) : undefined;

/** ms to wait per the response's own headers; null when they say nothing. */
export function rateLimitWaitMs(headers, nowMs) {
  const retryAfter = Number(headerOf(headers, "retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  const reset = Number(headerOf(headers, "x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - nowMs);
  return null;
}

/** The limit headers, so a failure names WHICH limit and WHEN it clears. */
export function describeRateLimit(headers) {
  const parts = [];
  for (const k of ["x-ratelimit-resource", "x-ratelimit-limit", "x-ratelimit-used", "x-ratelimit-remaining"]) {
    const v = headerOf(headers, k);
    if (v !== undefined && v !== null) parts.push(`${k.slice("x-ratelimit-".length)}=${v}`);
  }
  const reset = Number(headerOf(headers, "x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) parts.push(`reset=${new Date(reset * 1000).toISOString()}`);
  const ra = headerOf(headers, "retry-after");
  if (ra !== undefined && ra !== null) parts.push(`retry-after=${ra}s`);
  return parts.length > 0 ? ` [${parts.join(" ")}]` : "";
}

export function isRetryableStatus(status) {
  return RETRYABLE_STATUS.has(Number(status));
}

/**
 * Is this 403 a RATE LIMIT (transient) rather than a permission denial (permanent)?
 *
 * Positive evidence only. The body must actually say so, or the headers must show an
 * exhausted quota. Anything else — an empty body, an unreadable one, a permission
 * message — stays permanent, because guessing "probably a rate limit" would bury the
 * `actions: read` finding this gate exists to surface.
 */
export function isRateLimited403(status, body, headers) {
  if (Number(status) !== 403) return false;
  const text = String(body ?? "").toLowerCase();
  if (text.includes("rate limit") || text.includes("secondary rate") || text.includes("abuse detection")) return true;
  const get = (k) => (headers && typeof headers.get === "function" ? headers.get(k) : undefined);
  return get("x-ratelimit-remaining") === "0" || get("retry-after") !== undefined && get("retry-after") !== null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Injectable for the self-test; the real one is global fetch. */
export async function apiWith(
  fetchImpl,
  path,
  { attempts = API_ATTEMPTS, backoff = API_BACKOFF_MS, wait = sleep, now = Date.now, rateLimitCapMs = RATE_LIMIT_WAIT_CAP_MS } = {},
) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "signalgrid-ci-liveness" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  let last = null;
  let headerWait = null; // set by a response that says when its limit clears
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await wait(headerWait ?? backoff[i - 1] ?? backoff[backoff.length - 1] ?? 0);
    headerWait = null;
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
    // Read the body ONLY for a 403, and only to tell a rate limit from a permission
    // denial. A failed read leaves `body` empty, which keeps the 403 permanent.
    let body = "";
    if (Number(res.status) === 403) {
      try { body = await res.text(); } catch { body = ""; }
    }
    const rateLimited = isRateLimited403(res.status, body, res.headers);
    last = {
      retryable: isRetryableStatus(res.status) || rateLimited,
      message: `GET ${path} -> ${res.status} ${res.statusText}${rateLimited ? " (rate limited)" : ""}${describeRateLimit(res.headers)}`,
    };
    if (!last.retryable) break;
    const waitMs = rateLimitWaitMs(res.headers, now());
    if (waitMs !== null && waitMs > rateLimitCapMs) {
      // The response said when it clears and that is past what this gate will
      // wait: fail now, naming it, instead of retrying into the same window.
      last.retryable = false;
      last.message += ` — clears in ${Math.ceil(waitMs / 1000)}s, beyond the ${rateLimitCapMs / 1000}s this gate will wait; not retried`;
      break;
    }
    if (waitMs !== null) headerWait = waitMs + 1000;
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

  await t("a 403 whose BODY says rate limit IS retried — GitHub uses 403 for secondary limits", async () => {
    const limited = { ok: false, status: 403, statusText: "Forbidden",
      text: async () => '{"message":"API rate limit exceeded for user"}',
      headers: new Map([["x-ratelimit-remaining", "0"]]) };
    limited.headers.get = Map.prototype.get.bind(limited.headers);
    const c = counting([limited, limited, ok({ recovered: 1 })]);
    const got = await apiWith(c.f, "/x", { wait: noWait });
    if (!got.recovered) throw new Error("expected recovery after rate-limited 403s");
    if (c.calls() !== 3) throw new Error(`expected 3 attempts, made ${c.calls()}`);
  });

  const limitedWith = (entries) => {
    const h = new Map(entries); h.get = Map.prototype.get.bind(h);
    return { ok: false, status: 403, statusText: "Forbidden", text: async () => '{"message":"API rate limit exceeded"}', headers: h };
  };
  const recordingWait = () => { const waits = []; return { waits, wait: async (ms) => { waits.push(ms); } }; };
  const T0 = 1_700_000_000_000;

  await t("a rate-limited 403 with x-ratelimit-reset 30s out waits for the RESET, not the backoff, then recovers", async () => {
    const c = counting([limitedWith([["x-ratelimit-remaining", "0"], ["x-ratelimit-reset", String(T0 / 1000 + 30)]]), ok({ recovered: 1 })]);
    const r = recordingWait();
    const got = await apiWith(c.f, "/x", { wait: r.wait, now: () => T0 });
    if (!got.recovered || c.calls() !== 2) throw new Error(`calls=${c.calls()}`);
    if (r.waits.length !== 1 || r.waits[0] !== 31_000) throw new Error(`waited ${JSON.stringify(r.waits)}, expected [31000]`);
  });
  await t("retry-after WINS over the reset header and over the backoff", async () => {
    const c = counting([limitedWith([["retry-after", "7"], ["x-ratelimit-reset", String(T0 / 1000 + 90)]]), ok({ recovered: 1 })]);
    const r = recordingWait();
    await apiWith(c.f, "/x", { wait: r.wait, now: () => T0 });
    if (r.waits[0] !== 8_000) throw new Error(`waited ${JSON.stringify(r.waits)}, expected [8000]`);
  });
  await t("a reset BEYOND the cap fails AT ONCE, names the instant, and is not retried", async () => {
    const c = counting([limitedWith([["x-ratelimit-resource", "core"], ["x-ratelimit-limit", "1000"], ["x-ratelimit-remaining", "0"], ["x-ratelimit-reset", String(T0 / 1000 + 3600)]])]);
    const r = recordingWait();
    let threw = null;
    try { await apiWith(c.f, "/x", { wait: r.wait, now: () => T0 }); } catch (e) { threw = e; }
    if (!threw) throw new Error("did not throw");
    if (c.calls() !== 1 || r.waits.length !== 0) throw new Error(`calls=${c.calls()} waits=${JSON.stringify(r.waits)}`);
    for (const must of [/resource=core/, /limit=1000/, /reset=2023-11-14T23:13:20\.000Z/, /clears in 3600s, beyond the 120s/]) {
      if (!must.test(threw.message)) throw new Error(`message lacks ${must}: ${threw.message}`);
    }
    if (/unchanged after/.test(threw.message)) throw new Error(`still reads as a retry exhaustion: ${threw.message}`);
  });
  await t("a rate-limited 403 with NO clock headers still takes the plain backoff path", async () => {
    const c = counting([limitedWith([["x-ratelimit-remaining", "0"]]), ok({ recovered: 1 })]);
    const r = recordingWait();
    await apiWith(c.f, "/x", { wait: r.wait, now: () => T0 });
    if (r.waits[0] !== API_BACKOFF_MS[0]) throw new Error(`waited ${JSON.stringify(r.waits)}, expected [${API_BACKOFF_MS[0]}]`);
  });
  await t("describeRateLimit: no headers, no note", () => {
    if (describeRateLimit(null) !== "" || describeRateLimit(new Map()) !== "") throw new Error("note on nothing");
  });

  await t("classifier: a rate-limit BODY marks a 403 retryable", () => {
    if (!isRateLimited403(403, '{"message":"You have exceeded a secondary rate limit"}', null)) throw new Error("not detected");
  });
  await t("classifier: an EXHAUSTED-QUOTA header marks a 403 retryable even with no body", () => {
    const h = new Map([["x-ratelimit-remaining", "0"]]); h.get = Map.prototype.get.bind(h);
    if (!isRateLimited403(403, "", h)) throw new Error("not detected");
  });
  await t("classifier: a PERMISSION 403 stays permanent — the actions:read finding must not hide", () => {
    const h = new Map(); h.get = Map.prototype.get.bind(h);
    if (isRateLimited403(403, '{"message":"Resource not accessible by integration"}', h)) throw new Error("misclassified");
  });
  await t("classifier: an EMPTY or unreadable 403 body stays permanent — fail closed on the ambiguity", () => {
    const h = new Map(); h.get = Map.prototype.get.bind(h);
    if (isRateLimited403(403, "", h)) throw new Error("misclassified");
    if (isRateLimited403(403, undefined, null)) throw new Error("misclassified");
  });
  await t("classifier: a rate-limit-shaped body on a NON-403 is not a 403 rate limit", () => {
    if (isRateLimited403(500, "rate limit", null)) throw new Error("misclassified");
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

// The sweep is a MATRIX of shards, so one run carries several jobs with the
// prefix. Liveness asks "did the harness run", not "was every shard green": a
// run where three shards succeeded and one found a survivor proves the harness
// is alive (the survivor is the sweep doing its job). So the run counts as a
// success if ANY shard job succeeded, and the timestamp is the latest such
// completion — independent of the order the API happens to list the jobs in.
// (Before this, `.find()` took the FIRST listed shard: on 2026-09-11 one shard
// of four was red, the API's job order varied between calls, and the gate
// flipped red/green on identical repo state — the flaky gate this file warns
// about, in this file.)
export function latestSweepSuccessInRun(jobs, prefix = SWEEP_JOB_PREFIX) {
  const shards = (jobs ?? []).filter((j) => String(j?.name ?? "").startsWith(prefix));
  if (shards.length === 0) return { present: false, iso: null, succeeded: 0, total: 0 };
  const ok = shards.filter((j) => j.conclusion === "success" && typeof j.completed_at === "string");
  const iso = ok.map((j) => j.completed_at).sort().at(-1) ?? null;
  return { present: true, iso, succeeded: ok.length, total: shards.length };
}

// Self-test for the shard rule — a pure function, no network.
{
  const shard = (n, conclusion, at) => ({ name: `${SWEEP_JOB_PREFIX} (every guard must be falsifiable) (${n})`, conclusion, completed_at: at });
  const other = { name: "Daily verification", conclusion: "success", completed_at: "2026-09-11T12:16:52Z" };
  const mixed = [other, shard(2, "success", "2026-09-11T12:21:53Z"), shard(1, "failure", "2026-09-11T12:18:52Z"), shard(0, "success", "2026-09-11T12:19:40Z"), shard(3, "success", "2026-09-11T12:25:44Z")];
  const cases = [
    ["one red shard among three green → alive, latest green completion", latestSweepSuccessInRun(mixed), { present: true, iso: "2026-09-11T12:25:44Z", succeeded: 3, total: 4 }],
    ["job order does not change the answer", latestSweepSuccessInRun([...mixed].reverse()), { present: true, iso: "2026-09-11T12:25:44Z", succeeded: 3, total: 4 }],
    ["every shard red → present but no success", latestSweepSuccessInRun([other, shard(0, "failure", "x"), shard(1, "failure", "y")]), { present: true, iso: null, succeeded: 0, total: 2 }],
    ["no sweep job at all → not present (silence is not evidence)", latestSweepSuccessInRun([other]), { present: false, iso: null, succeeded: 0, total: 0 }],
    ["a success with no timestamp does not count", latestSweepSuccessInRun([shard(0, "success", undefined)]), { present: true, iso: null, succeeded: 0, total: 1 }],
    ["empty / missing jobs → not present", latestSweepSuccessInRun(undefined), { present: false, iso: null, succeeded: 0, total: 0 }],
    // THE 2026-09-14 FALSE RED, pinned. An empty or unmatched payload must read as
    // "could not look", never as "the sweep is dark": different causes, different
    // fixes, and only one of them is this gate's finding.
    ["no runs returned → could-not-look, NOT dark", classifyScan({ runsInspected: 0, runsWithSweep: 0 }).status, "could-not-look"],
    ["runs inspected, NONE carried a sweep job → could-not-look (the live failure)", classifyScan({ runsInspected: 10, runsWithSweep: 0 }).status, "could-not-look"],
    ["the sweep ran and no shard succeeded → dark, which IS the finding", classifyScan({ runsInspected: 10, runsWithSweep: 3 }).status, "dark"],
    [
      "a could-not-look verdict names WHICH of the two it was",
      [
        classifyScan({ runsInspected: 0, runsWithSweep: 0 }).why.includes("NO completed runs"),
        classifyScan({ runsInspected: 10, runsWithSweep: 0 }).why.includes("NOT ONE carried a job"),
      ],
      [true, true],
    ],
  ];
  const bad = cases.filter(([, got, want]) => JSON.stringify(got) !== JSON.stringify(want));
  if (bad.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED — the shard rule no longer behaves as required:\n" +
        bad.map(([name, got]) => `    · ${name}: got ${JSON.stringify(got)}`).join("\n"),
    );
    process.exit(1);
  }
}

/**
 * WHY THIS RETURNS A SHAPE AND NOT `null` (fixed 2026-09-14, from a live false red).
 *
 * On PR #742 this gate failed the gating job with "the mutation sweep is not
 * demonstrably alive" at 14:32:48Z — while scheduled-verification run 34853811860
 * had all FOUR sweep shards green between 14:14:33Z and 14:20:54Z, twelve minutes
 * earlier and well inside the 48h threshold. The identical commit passed on re-run
 * with nothing changed, so the payload, not the repository, was what differed.
 *
 * The old code could not tell three situations apart, because all three returned
 * `null`:
 *   (a) the API returned no runs at all — we could not look;
 *   (b) runs came back but none carried a sweep job — the job was renamed, or the
 *       payload was empty/partial — we still could not look;
 *   (c) the sweep job ran and every shard failed — the sweep really is dark.
 * Only (c) is the finding this gate exists to report. (a) and (b) were reported as
 * (c), which is a gate crying wolf on the repository's most load-bearing claim and
 * failing the gating job on EVERY open PR while it lasts.
 *
 * This file's own header states the rule it broke: "A PROBE THAT COULD NOT RUN IS
 * NOT A PROBE THAT FOUND NOTHING." The same sentence is written above `gitLines`
 * in absence-check.mjs, and it was already the fix for a previous bug here. It is
 * applied to the OUTER loop now, not just the inner fetch.
 *
 * The diagnostic line also moved ABOVE the `continue`. It used to print only for
 * runs that already carried a sweep job, so the one shape that most needed a trace
 * — every run inspected, none matching — produced a red verdict with an empty log
 * and nothing to read back. That silence is what made the live failure take an API
 * cross-check to diagnose instead of a glance at the log.
 */
async function lastSweepSuccess() {
  const runs = await api(
    `/repos/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${RUNS_TO_INSPECT}&status=completed`,
  );
  // WHAT THE WINDOW ACTUALLY CONTAINED. This line exists because on 2026-09-17 the
  // gate returned OPPOSITE verdicts on the identical commit 19704f65 — attempt 1
  // said the sweep had been dark 291h, attempt 2 passed, nothing pushed between
  // them — and then said "dark" again on a later PR naming the SAME 2026-09-05 run
  // both times. Four explanations were proposed and all four were falsified against
  // the live API: the ten-run page is not overflowing (today's sweep sits at index
  // 0), `apiWith` does not swallow a non-200 (it throws, and in CI that path is
  // fatal), the runs carry 6 jobs against a per_page of 30, and the job names match
  // SWEEP_JOB_PREFIX. Every one of those was ruled out by looking from OUTSIDE CI at
  // a list the failing job never showed anyone.
  //
  // So this is not a fix and does not pretend to be one: the verdict logic below is
  // untouched. It prints what the gate SAW, which is the one thing no amount of
  // reasoning from outside could recover, and it is the difference between the next
  // occurrence being another dead end and being a diagnosis. A gate that can fail
  // for a reason its own output cannot express is a gate nobody can repair.
  const list = runs.workflow_runs ?? [];
  let runsWithSweep = 0;
  console.log(
    `  window: ${list.length} completed run(s) of ${WORKFLOW_FILE} — ` +
      (list.length === 0
        ? "EMPTY (the API returned no runs at all)"
        : list.map((r) => `${r.id}@${String(r.created_at ?? "?").slice(0, 16)}Z`).join(", ")),
  );

  for (const run of list) {
    const jobs = await api(`/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=30`);
    const sweep = latestSweepSuccessInRun(jobs.jobs);
    // One line per INSPECTED run — including the ones carrying no sweep job, which
    // is precisely the case a red verdict most needs evidence for.
    console.log(
      `  · run ${run.id} (${String(run.created_at ?? "").slice(0, 16)}Z): ` +
        (sweep.present ? `${sweep.succeeded}/${sweep.total} sweep shard(s) succeeded` : "no sweep job in this run"),
    );
    // A run with no such job is not evidence either way — the job may have been
    // added later, or renamed. Keep looking rather than concluding from silence.
    if (!sweep.present) continue;
    runsWithSweep += 1;
    if (sweep.iso) {
      return { status: "found", iso: sweep.iso, runUrl: run.html_url, runConclusion: run.conclusion };
    }
  }
  return classifyScan({ runsInspected: list.length, runsWithSweep });
}

/**
 * The pure half of the outer loop's verdict, exported so the self-test can exercise it
 * without a network. Only the THIRD case is "the sweep is dark"; the first two are
 * "this gate could not see", and conflating them produced the 2026-09-14 false red.
 */
export function classifyScan({ runsInspected, runsWithSweep }) {
  if (runsInspected === 0) {
    return { status: "could-not-look", why: `the Actions API returned NO completed runs for ${WORKFLOW_FILE}` };
  }
  if (runsWithSweep === 0) {
    return {
      status: "could-not-look",
      why:
        `${runsInspected} completed run(s) were inspected and NOT ONE carried a job starting ` +
        `"${SWEEP_JOB_PREFIX}" — the job was renamed, or the jobs payload came back empty`,
    };
  }
  return { status: "dark", why: `the sweep job ran in ${runsWithSweep} inspected run(s) and no shard succeeded` };
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

{
  const p = tokenProblem({ inCi: IN_CI, token: TOKEN });
  if (p) {
    console.error(`  ✗ ${p}`);
    console.error("\nCI-liveness gate FAILED — it would have run unauthenticated where it is required to run for real.");
    process.exit(1);
  }
}

let found;
try {
  found = await lastSweepSuccess();
} catch (err) {
  const msg = `could not reach the GitHub Actions API: ${err.message}`;
  if (IN_CI) {
    console.error(
      `  ✗ ${msg}\n` +
        "      In CI this is FATAL. The step handed this gate a token, so an unreachable\n" +
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

// COULD NOT LOOK is its own outcome, and in CI it is fatal for a DIFFERENT reason
// than a dark sweep. Treating it as "dark" is the fail-open-wearing-a-mask this gate
// was built to refuse: it makes an unreadable payload indistinguishable from the
// repository's mutation harness having actually stopped. Off CI it is reported and
// not fatal, matching the API-unreachable arm above — a developer without an API
// token must not have their preflight reddened by GitHub's response shape.
if (found?.status === "could-not-look") {
  const msg = `could not determine whether the sweep is alive — ${found.why}`;
  if (IN_CI) {
    console.error(
      `  ✗ ${msg}\n` +
        `      Workflow: ${WORKFLOW_FILE}, job starting "${SWEEP_JOB_PREFIX}"\n` +
        "      This is NOT the same finding as a dark sweep, and it is deliberately\n" +
        "      not reported as one. The sweep may be perfectly healthy; what failed is\n" +
        "      this gate's ability to see it. Check the per-run lines above, then the\n" +
        "      job name in scheduled-verification.yml against SWEEP_JOB_PREFIX here.",
    );
    console.error("\nCI-liveness gate FAILED — the sweep's state could not be read, which is not the same as dark.");
    process.exit(1);
  }
  console.log(`  · NOT CHECKED — ${msg}\n      Reported, not fatal, off CI.`);
  console.log("\nci-liveness: not checked locally (sweep state unreadable); self-test green");
  process.exit(0);
}

const verdict = evaluateLiveness({
  lastSuccessIso: found?.status === "found" ? found.iso : null,
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
