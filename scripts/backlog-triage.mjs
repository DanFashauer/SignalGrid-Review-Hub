#!/usr/bin/env node
// backlog-triage.mjs — the open pull-request, issue and branch queue, read once, with a
// DISPOSITION and the reason for every pull request. READ-ONLY: the only HTTP verb it
// sends is GET, it merges, approves, closes, comments on and deletes nothing, and the one
// file it may write is the one named by --snapshot, between two markers.
//
//   node scripts/backlog-triage.mjs                          markdown report on stdout
//   node scripts/backlog-triage.mjs --json                   the same data, stable key order
//   node scripts/backlog-triage.mjs --markdown --snapshot docs/agent/BACKLOG_LANDING.md
//   node scripts/backlog-triage.mjs --classify 1608          one PR's files re-classified, no queue
//   node scripts/backlog-triage.mjs --self-test              fixture cases, no network
//   node scripts/backlog-triage.mjs --help                   every flag
//
// WHY THIS EXISTS (owner, 2026-10-22: "look for all these issues and pull requests plus
// need to get all the branches merged into main branch"). The queue was read by hand three
// times that day, each time from different API calls, each time with its own idea of what
// "stale" meant. This is the one reading: same inputs, same rules, same answer twice.
//
// THE RULES ARE THE INVENTORY'S, NOT NEW ONES (2026-10-22 PR inventory, 116 PRs). A PR gets
// the FIRST of these that holds, in this order:
//   STANDING       the mailbox PR named in docs/agent/lane-mailbox.json: a draft with no files. Any
//                  OTHER PR from that branch is UNKNOWN: the standing wake channel is never landed.
//   IN-FLIGHT      declared live by the caller (--declared-live). The tool cannot see a worker.
//   SUPERSEDED     its head is an ancestor of mainline, or it is a mac/tick-* snapshot whose
//                  every file was rewritten on mainline after its head commit (or is a
//                  sim-request whose result is already on mainline).
//   STALE          idle more than 14 days AND (red OR conflicting). Red = the gating check, the
//                  Mac-only check or CodeQL failed IN ITS NEWEST RUN (a re-run or a second
//                  trigger leaves the old run on the commit; the old failure is history);
//                  code-scanning, phase-pr-evidence and the SBOM check are ADVISORY and never
//                  make a PR red.
//   OWNER-MERGE    the diff reaches DECISION_PATH or OWNER_RESERVED (classifyDiff, imported
//                  from check-owner-gated-surfaces.mjs, not retyped), or an owner-named surface
//                  DR-037 keeps back, or it is Dependabot's, or it is not a lane's own branch.
//   MAC-ASK-NEEDED a mac/* PR. DR-037 cond. 5 lets the cloud lane land one only on the Mac's ask IN
//                  MAIL, which this tool does not read. A line in the PR body is not that ask (a
//                  body has no provenance: every lane pushes as one account and a body can be
//                  rewritten), so a body ask alone reads "ask in body; confirm mail" and the
//                  tool NEVER prints LAND for a mac/* PR. mac/tick-* PRs are here too (below).
//   LAND-UNDER-DR-037  a cloud-lane PR (claude/*, lane/cloud-*) that is landable NOW.
// A STALE or SUPERSEDED or IN-FLIGHT row keeps the class it would have in `natural`.
//
// WHAT IT NEVER DOES: guess. A fact it cannot read (a file list cut short, a check list that
// failed to load, a mergeable_state GitHub has not computed, a check-runs envelope with no
// total_count, a base branch the response omits, a check that ended cancelled, stale or with no
// conclusion, a count read without its Link header on a multi-page list, a draft flag, a file name or
// a check-run id the response leaves out) tightens the answer; where the
// rules above have no row for what it read, the disposition is UNKNOWN with the reason, and
// UNKNOWN is never LAND. An empty page is not "no PRs" unless the repository's own open
// count says so (open_issues_count = open PRs + open issues). A missing or placeholder
// token, an anonymous answer, or a rate limit too low to finish stops the run with a
// message; it never prints an empty queue.
//
// WHAT IT CANNOT KNOW, said here and in the report header every run:
//   * Review-thread RESOLUTION. GitHub exposes it through GraphQL only (and the proxy-only
//     ccr endpoint, which this tool does not call). From REST it reads each PR's review
//     comments: roots, and which roots have a reply. That is a heuristic. A PR with any
//     review thread is NOT landable from this reading (a thread whose state cannot be read
//     counts as open); --threads-file lets a caller who read the exact numbers supply them.
//     The comment list is checked against the PR's own review_comments count like every other
//     list: a different number (or no count) makes the comments unreadable, which blocks LAND.
//   * Mac lane mail. It is not read. A body line that reads as an ask is flagged, never trusted.
//   * Who opened a mac/tick-* PR. LANE_COORDINATION rule 2 has the cloud steward open and land
//     these, and DR-037 cond. 5 lets the lane land only a PR it opened; but lane-tick.sh opens
//     the PR itself when gh is on the Mac's PATH and the API cannot tell the two apart. The
//     stricter reading holds in this tool: an unsuperseded tick PR is MAC-ASK-NEEDED, and a
//     sweep lands one only if the steward opened it or the Mac's mail names it. That is a
//     statement about what the tool can read, not a claim that rule 2 is wrong.
//   * Which workers are live. Declare them with --declared-live; a PR touched in the last 3
//     hours and not declared is flagged, not classified.
//   * Mainline ancestry from a checkout that is shallow or behind: local git "yes" is
//     conclusive, local "no" is not, so the REST compare endpoint answers those, and the
//     report says how many PRs each source answered.
//
// EXIT CODES: 0 report printed (UNKNOWN rows are part of a report) · 1 self-test or --mutants
// failed · 2 usage, token, auth or rate-limit refusal (a 401, a 403 that is not a rate limit, or
// a 404 on a read the whole queue depends on is an auth refusal) · 3 the read was inconsistent
// (counts disagree after re-reads, a short branch or closed-PR page, a count read whose Link
// header is missing from a multi-page list, a listing missing the default branch, a read that
// failed after retries) · 4 --snapshot could not be written. --classify N prints one line: exit 0 and
// "CLASSIFIED" when the PR's file list was read in full, otherwise "NOT CLASSIFIED: <why>" and exit 2
// (token, auth, rate limit, a 404) or 3 (a failed read, an empty list, a list that does not match the
// PR's own changed_files). An empty list is never read as a PR that touches nothing.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyDiff } from "./check-owner-gated-surfaces.mjs";

const SELF_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(SELF_FILE), "..");
const SKILL_FILE = resolve(REPO_ROOT, ".claude/skills/backlog-landing/SKILL.md");
const PAGE_FILE = resolve(REPO_ROOT, "docs/agent/BACKLOG_LANDING.md");

// ── constants ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_REPO = "DanFashauer/SignalGrid-Review-Hub";
export const GATING_CHECK = "Typecheck, build, and proof scaffold";
export const MAC_ONLY_CHECK_RE = /^PR [—–-] Mac-only checks/;
/** An idle PR is STALE only past this many days AND red or conflicting. */
export const STALE_DAYS = 14;
/** A PR touched this recently and not declared live is flagged as a possible live worker. */
export const RECENT_HOURS = 3;
/** The rate-limit reserve checked before the PRs are read: requests per open PR, plus a fixed part for the
 *  queue-wide reads. Derived from a measured worst case, not a bound: a read of 80 open PRs with
 *  --no-local-git, taken right after mainline moved, made 1011 GET requests, 12.6 per PR (the likely
 *  cause of the surplus is the re-read of a PR whose mergeability GitHub had not computed); the same
 *  responses replayed took 465. 13 per PR plus 120 covers it (1160 for 80 PRs). A read that still costs
 *  more stops with exit 2 and prints no queue. */
export const RESERVE_PER_PR = 13;
export const RESERVE_FIXED = 120;
/** The worst read measured so far: GET requests, and the open PRs they were made for. */
export const MEASURED_WORST_READ = { requests: 1011, prs: 80, replayed: 465 };
export const SNAPSHOT_BEGIN_RE = /<!-- backlog-triage:snapshot:begin[^>]*-->/;
export const SNAPSHOT_END = "<!-- backlog-triage:snapshot:end -->";
export const SNAPSHOT_BEGIN = "<!-- backlog-triage:snapshot:begin - generated by `node scripts/backlog-triage.mjs --markdown --snapshot docs/agent/BACKLOG_LANDING.md`; never hand-edit between the markers -->";

/** The fixed order dispositions sort in. Not alphabetical, and not time-dependent. */
export const DISPOSITIONS = ["LAND-UNDER-DR-037", "MAC-ASK-NEEDED", "OWNER-MERGE", "SUPERSEDED", "STALE", "IN-FLIGHT", "STANDING", "UNKNOWN"];
const DISP_RANK = new Map(DISPOSITIONS.map((d, i) => [d, i]));
export const LANES = ["claude", "mac", "lane", "dependabot", "other"];
/** The standing mailbox branch (docs/agent/lane-mailbox.json); the fallback when that file is unreadable. */
export const MAILBOX_BRANCH = "lane/mailbox";

/** Conclusions that are a verdict of "failed". */
const FAILED = new Set(["failure", "timed_out", "startup_failure"]);
/** States that mean "no verdict yet" (action_required is a workflow run nobody approved). */
const PENDING = new Set(["queued", "in_progress", "waiting", "pending", "requested", "action_required"]);
/** The client suites a native-touching PR must also wait for (landing-under-dr-037). */
const NATIVE_CHECK_RE = /^(Dock firmware|Desktop shell|SignalGridMobile|Assist core|Shared Assist vectors|EnterpriseShell|macOS native|Android app)/;
const NATIVE_PATH_RE = /^native\/(shared|android|desktop|ios)\//;
const isCodeQL = (name) => /^CodeQL$/.test(name) || /^Analyze \(/.test(name);
/** The only conclusions that are a verdict of "fine". cancelled, stale and a missing conclusion are
 *  not a verdict at all, so a check in one of them is never read as passing. */
const VERDICT_OK = new Set(["success", "neutral", "skipped"]);

/**
 * Surfaces DR-037 keeps with the owner that the path classifier files only as ordinary
 * SAFETY_MACHINERY (scripts/**) or as plain docs. Fail-closed: the patterns are wider than
 * DR-037's words, because a false hit costs the owner a glance and a miss lands a boundary change.
 * The extension list is every JS/TS module form ([cm]?[jt]s: js, mjs, cjs, ts, mts, cts, and so
 * .d.mts, the file that declares the launch profile's shape) plus json. The self-test runs every
 * TRACKED file whose name holds one of these words through the list, so a file of a form the list
 * does not know fails the self-test rather than passing as ordinary SAFETY_MACHINERY.
 */
export const OWNER_NAMED = [
  { rule: "AGENTS.md (DR-037: not edited on the lane's authority)", re: /^AGENTS\.md$/ },
  { rule: "decision records (DR-037: edited only on owner authority)", re: /^docs\/DECISION_RECORDS\.md$/ },
  { rule: "launch profile (docs)", re: /^docs\/LAUNCH_PROFILE\.md$/ },
  { rule: "launch profile (code)", re: /(^|\/)(check-)?launch[-_]profile[\w.-]*\.([cm]?[jt]s|json)$/i },
  { rule: "launch-claims gate", re: /(^|\/)(check-)?launch[-_]claims[\w.-]*\.([cm]?[jt]s|json)$/i },
  { rule: "launch proof bindings", re: /(^|\/)(check-)?launch[-_]proof[-_]bindings[\w.-]*\.([cm]?[jt]s|json)$/i },
  { rule: "publication boundary", re: /(^|\/)(check-)?publication[-_]boundary[\w.-]*\.([cm]?[jt]s|json|md)$/i },
  // not a name DR-037 gives, but the code both launch gates read their ceiling files through: the self-test
  // follows the relative imports of every owner-named script and requires each target to be on this list
  { rule: "ratchet-file reader (the launch-claims and launch-proof-bindings gates read their ceiling files through it)", re: /(^|\/)ratchet-read[\w.-]*\.([cm]?[jt]s|json)$/i },
];

// ── small pure helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export const daysBetween = (fromIso, now) => (now.getTime() - new Date(fromIso).getTime()) / DAY_MS;
export const round1 = (x) => Math.round(x * 10) / 10;
const sortNum = (a, b) => a - b;
/** A base branch name, or null when GitHub did not give one: a PR whose base cannot be read is never assumed to sit on mainline. */
const baseRef = (x) => (typeof x === "string" && x !== "" ? x : null);
const uniqSorted = (xs) => [...new Set(xs)].sort();

/** Lane from the head branch prefix. user.login cannot tell: every lane pushes as one account. */
export function laneOf(ref) {
  const r = String(ref ?? "");
  if (r.startsWith("mac/")) return "mac";
  if (r.startsWith("claude/")) return "claude";
  if (r.startsWith("lane/cloud-") || r === "lane/mailbox") return "lane";
  if (r.startsWith("dependabot/")) return "dependabot";
  return "other";
}
/** The cloud lane's own branches: the only PRs DR-037 lets it land without a Mac ask. */
export const isCloudLane = (lane) => lane === "claude" || lane === "lane";

/** The token-shape verdict. Only `missing` and `placeholder` stop a run before any request:
 *  anything else is judged by what GitHub answers, because a credential-injecting proxy
 *  legitimately holds a marker string while the proxy supplies the real credential. */
export function tokenShape(raw) {
  const t = String(raw ?? "").trim();
  if (t === "") return { kind: "missing", note: "empty" };
  if (/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|[0-9a-f]{40})$/.test(t)) return { kind: "github", note: "GitHub token format" };
  const lower = t.toLowerCase();
  if (
    /^<.*>$/.test(t) || /^\$\{?[\w.-]*\}?$/.test(t) || /^\*+$/.test(t) || /^x{3,}$/i.test(t) ||
    /^(null|undefined|none|nil|false|true|token|test|todo|tbd|secret|password|empty|dummy|example|fake)$/.test(lower) ||
    /(placeholder|change[-_ ]?me|replace[-_ ]?me|your[-_ ]?(github[-_ ]?)?(token|key|pat)|redacted|insert[-_ ]|not[-_ ]set|<token>|xxxx)/.test(lower)
  ) return { kind: "placeholder", note: "looks like a placeholder, not a credential" };
  return { kind: "other", note: "not in GitHub's token format (a credential-injecting proxy may hold the real one); GitHub's authenticated answer decides" };
}

/** Pick the first usable token from GH_TOKEN then GITHUB_TOKEN. Returns {token, shape} or {error}. */
export function pickToken(env) {
  const names = ["GH_TOKEN", "GITHUB_TOKEN"];
  const seen = [];
  for (const n of names) {
    const v = env[n];
    if (v === undefined || String(v).trim() === "") continue;
    const shape = tokenShape(v);
    seen.push(`${n}: ${shape.kind}`);
    if (shape.kind === "github" || shape.kind === "other") return { token: String(v).trim(), shape, from: n };
  }
  if (seen.length === 0) {
    return { error: "no GitHub token: GH_TOKEN and GITHUB_TOKEN are both unset or empty. A queue read with no credential would be anonymous and rate-limited, and an empty answer from it would look like an empty queue. Set one and re-run." };
  }
  return { error: `the GitHub token is a placeholder (${seen.join("; ")}): ${seen.length === 1 ? "it is" : "they are"} not a credential, so GitHub would answer 401 and a silent fallback would print an empty queue. Set a real GH_TOKEN or GITHUB_TOKEN and re-run.` };
}

// ── the GitHub REST layer (GET only) ─────────────────────────────────────────────────────

export class ToolError extends Error {
  constructor(message, exitCode = 3) { super(message); this.name = "ToolError"; this.exitCode = exitCode; }
}
class ApiError extends Error {
  constructor(message, status = null) { super(message); this.name = "ApiError"; this.status = status; }
}

/**
 * A GET-only client. 401, rate limits and a 403 that names a limit are FATAL (they abort every
 * in-flight read); a 5xx or a network error is retried with a short back-off, then reported;
 * anything else is an ApiError the caller turns into an UNKNOWN row. The token is never printed.
 */
// The host is a constant: no flag, variable or response can point a token-bearing request elsewhere.
const API_URL = "https://api.github.com";

export function makeApi({ token, fetchImpl, sleep, maxAttempts = 3, shapeKind = "other" }) {
  let fatal = null;
  let calls = 0;
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "signalgrid-backlog-triage",
    Authorization: `Bearer ${token}`,
  };
  async function request(path, { allow404 = false } = {}) {
    if (fatal) throw fatal;
    if (!path.startsWith("/")) throw new ApiError(`refusing a request path that does not start with "/": ${path.slice(0, 40)}`);
    const url = `${API_URL}${path}`;
    let last = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (fatal) throw fatal;
      calls++;
      let res;
      try {
        res = await fetchImpl(url, { method: "GET", headers });
      } catch (e) {
        last = new ApiError(`network error on ${path}: ${e?.cause?.code ?? e?.code ?? e?.message ?? e}`);
        if (attempt < maxAttempts) await sleep(400 * attempt);
        continue;
      }
      if (res.status === 401) {
        fatal = new ToolError(
          `GitHub answered 401 to the token (${shapeKind === "other" ? "it is not in GitHub's token format, so it is probably a placeholder" : "it was rejected"}). Set a valid GH_TOKEN or GITHUB_TOKEN. Nothing was read, so there is no queue to report.`,
          2,
        );
        throw fatal;
      }
      if (res.status === 403 || res.status === 429) {
        const remaining = res.headers?.get?.("x-ratelimit-remaining");
        const retryAfter = res.headers?.get?.("retry-after");
        let text = "";
        try { text = await res.text(); } catch { /* the status is enough */ }
        if (remaining === "0" || retryAfter || res.status === 429 || /rate limit|abuse/i.test(text)) {
          const reset = res.headers?.get?.("x-ratelimit-reset");
          fatal = new ToolError(`GitHub rate limit reached on ${path}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}${reset ? ` (core limit resets at epoch ${reset})` : ""}. Re-run later; a partial queue is never printed.`, 2);
          throw fatal;
        }
        throw new ApiError(`403 on ${path}: ${text.slice(0, 160).replace(/\s+/g, " ")}`, 403);
      }
      if (res.status === 404 && allow404) return { status: 404, json: null, headers: res.headers };
      if (res.status >= 500) {
        last = new ApiError(`GitHub ${res.status} on ${path}`, res.status);
        if (attempt < maxAttempts) await sleep(500 * attempt);
        continue;
      }
      if (!res.ok) {
        let text = "";
        try { text = await res.text(); } catch { /* ignore */ }
        throw new ApiError(`${res.status} on ${path}: ${text.slice(0, 160).replace(/\s+/g, " ")}`, res.status);
      }
      try {
        return { status: res.status, json: await res.json(), headers: res.headers };
      } catch (e) {
        last = new ApiError(`unreadable JSON on ${path}: ${e?.message ?? e}`);
      }
    }
    throw last ?? new ApiError(`no answer for ${path}`);
  }
  return {
    get: request,
    json: async (path, opts) => (await request(path, opts)).json,
    callCount: () => calls,
    isFatal: () => fatal,
  };
}

const withQuery = (path, q) => `${path}${path.includes("?") ? "&" : "?"}${q}`;

/** Every page of a list endpoint: per_page=100, following until a SHORT page. */
export async function listAll(api, path, { perPage = 100, maxPages = 300 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const rows = await api.json(withQuery(path, `per_page=${perPage}&page=${page}`));
    if (!Array.isArray(rows)) throw new ApiError(`${path} page ${page} was not a JSON array`);
    out.push(...rows);
    if (rows.length < perPage) return out;
  }
  throw new ApiError(`${path}: more than ${maxPages} pages; refusing to loop further`);
}

/** The check runs on one commit. The envelope's total_count is the check on an empty page, and it
 *  is required: an envelope without it cannot be checked, so it is a read error, not a pass. */
export async function listCheckRuns(api, repo, sha) {
  const runs = [];
  let total = null;
  for (let page = 1; page <= 50; page++) {
    const body = await api.json(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    if (!body || !Array.isArray(body.check_runs)) throw new ApiError(`check-runs for ${sha.slice(0, 9)} was not a check_runs envelope`);
    if (typeof body.total_count !== "number") throw new ApiError(`check-runs for ${sha.slice(0, 9)} carried no total_count, so the list cannot be checked for completeness`);
    total = body.total_count;
    runs.push(...body.check_runs);
    if (body.check_runs.length < 100) break;
  }
  if (runs.length < total) throw new ApiError(`check-runs for ${sha.slice(0, 9)}: read ${runs.length} of total_count ${total}`);
  // the newest run of a name is the one with the highest id: a run without a numeric id would rank as 0, and a failing run
  // would lose to a passing one that has an id
  const noId = runs.findIndex((r) => !Number.isInteger(r?.id));
  if (noId >= 0) throw new ApiError(`check-runs for ${sha.slice(0, 9)}: run ${noId + 1} of ${runs.length} carries no numeric id, so the newest run of its name cannot be told`);
  return runs;
}

/** One PR's changed files, every page. An entry without a filename string is a read error: it would classify as
 *  nothing, and a list of such entries would read as a PR that touches nothing. A renamed file keeps its old
 *  path (`previous`), because a file moved out of lib/** is still a change to it. */
export async function listPrFiles(api, repo, n) {
  const rows = await listAll(api, `/repos/${repo}/pulls/${n}/files`);
  const bad = rows.findIndex((x) => typeof x?.filename !== "string" || x.filename === "");
  if (bad >= 0) throw new ApiError(`entry ${bad + 1} of ${rows.length} in the changed-file list has no filename, so it cannot be classified`);
  return rows.map((x) => ({ filename: x.filename, status: x.status, previous: x.previous_filename ?? null }));
}

/** Concurrency-limited map; results land at their input index so completion order never leaks. */
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const k = next++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// ── reading one pull request ─────────────────────────────────────────────────────────────

const stateOfRun = (r) => (r.status === "completed" ? (r.conclusion ?? "unknown") : (r.status ?? "unknown"));

/** One run per check NAME: the newest, by id. A re-run, or a second trigger of the same workflow
 *  (a label, a reopen), adds a run under the same name and leaves the old one on the commit: the
 *  old failure is history and the newest run is the verdict. Equal ids (never seen on GitHub)
 *  keep the worse state, so a tie cannot hide a failure.
 *  Ceiling: two workflows that share a job name collapse to the newer; the gating check, the
 *  Mac-only check and CodeQL are unique names, and the live commits show duplicates only for
 *  phase-pr-evidence and "Label & summarize". */
export function latestByName(runs) {
  const rank = (r) => (FAILED.has(stateOfRun(r)) ? 2 : PENDING.has(stateOfRun(r)) ? 1 : 0);
  const latest = new Map();
  for (const r of runs) {
    const cur = latest.get(r.name);
    if (!cur) { latest.set(r.name, r); continue; }
    const a = r.id ?? 0;
    const b = cur.id ?? 0;
    if (a > b || (a === b && rank(r) > rank(cur))) latest.set(r.name, r);
  }
  return [...latest.values()];
}

/** The gating check, the Mac-only check, what failed, what is pending, the native-client suites;
 *  every verdict taken from the newest run of each check name. The Mac-only verdict is the WORST of the
 *  current runs whose name matches (a failing job must not be hidden by a newer passing job of another
 *  name); equal states keep the newest. */
export function summarizeChecks(runs) {
  const current = latestByName(runs);
  const pick = (pred) => current.filter(pred).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
  const macRank = (r) => (stateOfRun(r) === "success" ? 0 : FAILED.has(stateOfRun(r)) ? 3 : PENDING.has(stateOfRun(r)) ? 2 : 1);
  const worstMac = current.filter((r) => MAC_ONLY_CHECK_RE.test(r.name)).sort((a, b) => macRank(b) - macRank(a) || (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
  const shape = (r) => (r ? { state: stateOfRun(r), id: r.id ?? null } : { state: "absent", id: null });
  const label = (r) => `${r.name}=${stateOfRun(r)}`;
  const failingRuns = current.filter((r) => FAILED.has(stateOfRun(r)));
  const pendingRuns = current.filter((r) => PENDING.has(stateOfRun(r)));
  const noVerdictRuns = current.filter((r) => !FAILED.has(stateOfRun(r)) && !PENDING.has(stateOfRun(r)) && !VERDICT_OK.has(stateOfRun(r)));
  const isRedName = (n) => n === GATING_CHECK || MAC_ONLY_CHECK_RE.test(n) || isCodeQL(n);
  return {
    total: runs.length,
    superseded: runs.length - current.length,
    gating: shape(pick((r) => r.name === GATING_CHECK)),
    macOnly: shape(worstMac),
    failing: uniqSorted(failingRuns.map(label)),
    red: uniqSorted(failingRuns.filter((r) => isRedName(r.name)).map(label)),
    advisory: uniqSorted(failingRuns.filter((r) => !isRedName(r.name)).map(label)),
    pending: uniqSorted(pendingRuns.map(label)),
    noVerdict: uniqSorted(noVerdictRuns.map(label)),
    native: uniqSorted(current.filter((r) => NATIVE_CHECK_RE.test(r.name)).map(label)),
  };
}

/** The GraphQL-free thread heuristic: root review comments, and which of them have a reply.
 *  Resolution is NOT readable here, so `unresolved` is null unless a caller supplied exact numbers. */
export function summarizeThreads(comments) {
  const roots = comments.filter((c) => c.in_reply_to_id == null);
  const replied = new Set(comments.filter((c) => c.in_reply_to_id != null).map((c) => c.in_reply_to_id));
  return {
    method: "heuristic",
    roots: roots.length,
    unanswered: roots.filter((c) => !replied.has(c.id)).length,
    unresolved: null,
  };
}

/** Does the PR body carry a line that reads as an ask to the cloud lane to land THIS PR?
 *  Sentence-level; HTML comments and fenced code are stripped (a quoted rule is not the PR's own
 *  statement); a negation in the sentence cancels it. A sentence that merely DESCRIBES the rule
 *  does not count: the object of "merge" or "land" must be this PR ("this PR", "it", "them"), or
 *  absent with the merge conditioned on this PR's CI ("may merge under DR-037 once CI is green",
 *  the Mac's PR-template line). Anything naming other PRs (#1234, "PRs", "its own"), or a
 *  general noun ("a", "any", "every"), is a description. Even a true here is NOT the Mac's ask:
 *  a body has no provenance, so the caller reports it as "ask in body; confirm mail". */
export function bodyAsksCloudToLand(body) {
  const text = String(body ?? "").replace(/<!--[\s\S]*?-->/g, " ").replace(/```[\s\S]*?```/g, " ");
  for (const sentence of text.split(/[.!?;\n]+/)) {
    const s = sentence.trim();
    if (!s) continue;
    const m = /\b(?:the\s+)?(?:cloud(?:\s+lane)?|steward)\b[^]{0,80}?\b(?:may|can|should|please|to)\b[^]{0,30}?\b(?:merge|land)\b([^]*)$/i.exec(s);
    if (!m) continue;
    if (/\b(not|never|no|cannot|can't|won't|don't|do not|without)\b|n't\b/i.test(s)) continue;
    const after = m[1];
    if (/#\d+|\b(?:its|their|own|other|others|any|every|all|each|a|an|PRs|pull requests)\b/i.test(after)) continue;
    const thisPr = /\b(?:this|it|them)\b/i.test(after);
    const onItsCi = /^\s*(?:(?:under|per|by)\s+DR-037\s+)?(?:once|when|after|if)\b[^]{0,40}\b(?:CI|checks?|green|gating)\b/i.test(after);
    if (thisPr || onItsCi) return true;
  }
  return false;
}

/** DR-037 condition 2 is "preflight and verify:breadth passed locally, output quoted". A word
 *  check cannot verify that; it can only say the body never mentions both. */
export const bodyMentionsGates = (body) => /preflight/i.test(String(body ?? "")) && /breadth/i.test(String(body ?? ""));

/** Classify a PR's changed files with the repo's own classifier, plus the owner-named surfaces. */
export function classifyFiles(files) {
  const names = [];
  for (const f of files) {
    names.push(f.filename);
    if (f.previous) names.push(f.previous); // a rename away from a gated path touches it too
  }
  const r = classifyDiff(names);
  const order = ["DECISION_PATH", "SAFETY_MACHINERY", "OWNER_RESERVED"];
  const categories = order.filter((c) => r.matched.some((m) => m.category === c));
  const byRule = new Map();
  for (const m of r.matched) {
    const k = `${m.category}: ${m.rule}`;
    const e = byRule.get(k) ?? { category: m.category, rule: m.rule, files: new Set() };
    e.files.add(m.file);
    byRule.set(k, e);
  }
  const matched = [...byRule.values()]
    .map((e) => ({ category: e.category, rule: e.rule, count: e.files.size, sample: [...e.files].sort().slice(0, 3) }))
    .sort((a, b) => (a.category + a.rule).localeCompare(b.category + b.rule));
  const ownerNamed = [];
  for (const n of uniqSorted(names)) {
    for (const o of OWNER_NAMED) if (o.re.test(n)) ownerNamed.push({ rule: o.rule, file: n });
  }
  return {
    tier: categories.length ? categories.join("+") : "autonomous",
    categories,
    matched,
    ownerNamed,
    touchesNative: names.some((n) => NATIVE_PATH_RE.test(n)),
  };
}

/** Local mainline ancestry. "Yes" is conclusive; "no" only when the checkout is whole and its
 *  mainline ref is the live one. Anything else is null and the REST compare answers. */
export function makeLocalGit({ dir, base, exec }) {
  const run = (args) => exec(["-C", dir, ...args]);
  let info = null;
  const probe = (liveBaseSha) => {
    if (info) return info;
    try {
      const top = run(["rev-parse", "--is-inside-work-tree"]);
      if (top.status !== 0) return (info = { available: false, reason: "not a git checkout" });
      const ref = `refs/remotes/origin/${base}`;
      const sha = run(["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
      if (sha.status !== 0) return (info = { available: false, reason: `no local ${ref}` });
      const shallow = run(["rev-parse", "--is-shallow-repository"]).stdout.trim() === "true";
      const localSha = sha.stdout.trim();
      info = { available: true, ref, shallow, localSha, current: localSha === liveBaseSha, reason: "" };
    } catch (e) {
      // the code only: an exception's message can carry the checkout's path, and the reason is printed to a committed page
      info = { available: false, reason: `git unavailable (${e?.code ?? "error"})` };
    }
    return info;
  };
  return {
    probe,
    /** true / false / null (null = ask the REST compare) */
    isAncestor(sha) {
      if (!info?.available) return null;
      if (run(["cat-file", "-e", `${sha}^{commit}`]).status !== 0) return null;
      const r = run(["merge-base", "--is-ancestor", sha, info.ref]);
      if (r.status === 0) return true;
      if (r.status === 1 && !info.shallow && info.current) return false;
      return null;
    },
  };
}

export const realGitExec = (args) => {
  const r = spawnSync("git", args, { encoding: "utf8", timeout: 30_000 });
  return { status: r.status ?? 128, stdout: r.stdout ?? "" };
};

async function getPrDetail(api, repo, n, sleep) {
  for (let i = 0; i < 4; i++) {
    const pr = await api.json(`/repos/${repo}/pulls/${n}`);
    if (pr?.mergeable_state && pr.mergeable_state !== "unknown") return pr;
    if (i < 3) await sleep(1500); // GitHub computes mergeability lazily
    else return pr;
  }
  return null;
}

/** A mac/tick-* PR is a snapshot of the Mac tick's state. It is SUPERSEDED when every file it
 *  changes was rewritten on mainline after its head commit, or is a sim-request whose result
 *  is already on mainline. `superseded` is true, false, or null (could not be read). */
async function tickEvidence(ctx, f) {
  const { api, repo, baseSha, cache } = ctx;
  const memo = (key, fn) => {
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  };
  try {
    const head = await memo(`commit:${f.headSha}`, () => api.json(`/repos/${repo}/commits/${f.headSha}`));
    const headDate = head?.commit?.committer?.date ?? head?.commit?.author?.date;
    const headMs = Date.parse(headDate ?? "");
    if (!Number.isFinite(headMs)) return { applicable: true, superseded: null, evidence: [], unknownWhy: "the head commit has no readable date" };
    const evidence = [];
    let unreadable = null;
    let all = f.files.length > 0;
    if (f.files.length === 0) evidence.push("it changes no files");
    for (const file of f.files) {
      const p = file.filename;
      const req = /^artifacts\/sim-requests\/([^/]+\.json)$/.exec(p);
      if (req) {
        const resPath = `artifacts/sim-results/${req[1]}`;
        const hit = await memo(`contents:${resPath}`, () => api.get(`/repos/${repo}/contents/${resPath}?ref=${baseSha}`, { allow404: true }));
        if (hit.status === 200) { evidence.push(`${p}: request already fulfilled - ${resPath} exists on mainline`); continue; }
      }
      if (file.status === "removed") { all = false; evidence.push(`${p}: removed by the PR, not judged`); continue; }
      const list = await memo(`path:${p}`, () => api.json(`/repos/${repo}/commits?sha=${baseSha}&path=${encodeURIComponent(p)}&per_page=1`));
      const newest = Array.isArray(list) ? list[0] : null;
      if (!newest) { all = false; evidence.push(`${p}: not on mainline`); continue; }
      const when = newest.commit?.committer?.date ?? newest.commit?.author?.date;
      const whenMs = Date.parse(when ?? "");
      if (!Number.isFinite(whenMs)) {
        all = false;
        unreadable = `${p}: the mainline commit ${String(newest.sha).slice(0, 8)} has no readable date`;
        evidence.push(unreadable);
      } else if (whenMs > headMs) {
        const pr = /#(\d+)/.exec(String(newest.commit?.message ?? "").split("\n")[0]);
        evidence.push(`${p}: rewritten on mainline at ${String(newest.sha).slice(0, 8)} (${when})${pr ? ` by #${pr[1]}` : ""}`);
      } else {
        all = false;
        evidence.push(`${p}: not rewritten on mainline since the head commit (${headDate})`);
      }
    }
    return { applicable: true, superseded: unreadable ? null : all, evidence, unknownWhy: unreadable };
  } catch (e) {
    if (e instanceof ToolError) throw e;
    return { applicable: true, superseded: null, evidence: [], unknownWhy: String(e?.message ?? e) };
  }
}

/** Everything the rules need about one PR, read once. A failed read becomes an `errors` entry,
 *  never a guess; a fatal error (auth, rate limit) propagates and ends the run. */
export async function gatherPr(ctx, item) {
  const { api, repo, base, now, localGit, threadsFile, sleep } = ctx;
  const f = {
    number: item.number,
    title: item.title ?? "",
    url: item.html_url ?? `https://github.com/${repo}/pull/${item.number}`,
    headRef: item.head?.ref ?? "",
    headSha: item.head?.sha ?? "",
    base: baseRef(item.base?.ref),
    author: item.user?.login ?? "",
    draft: item.draft === true,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    ageDays: daysBetween(item.created_at, now),
    idleDays: daysBetween(item.updated_at, now),
    // a head in another repository (a fork, or one since deleted) is never a lane's own branch
    lane: item.head?.repo?.full_name === repo ? laneOf(item.head?.ref) : "other",
    mergeableState: null,
    conflicting: null,
    files: [],
    filesExpected: null,
    filesComplete: false,
    commentsExpected: null,
    tier: "unknown",
    categories: [],
    matched: [],
    ownerNamed: [],
    touchesNative: false,
    checks: null,
    threads: null,
    ask: false,
    quotesGates: false,
    ancestor: null,
    ancestorSource: null,
    tick: { applicable: false, superseded: null, evidence: [], unknownWhy: null },
    errors: {},
  };
  const guard = async (key, fn) => {
    try { return await fn(); } catch (e) {
      if (e instanceof ToolError) throw e;
      f.errors[key] = String(e?.message ?? e);
      return undefined;
    }
  };

  const detail = await guard("pr", () => getPrDetail(api, repo, item.number, sleep));
  if (detail) {
    f.headSha = detail.head?.sha ?? f.headSha;
    f.base = baseRef(detail.base?.ref) ?? f.base;
    // a draft when the detail, the list item or mergeable_state says so; a flag that is not a boolean is a read error
    f.draft = item.draft === true || detail.draft === true || detail.mergeable_state === "draft";
    const unread = [];
    if (typeof detail.draft !== "boolean") unread.push("the PR detail carries no boolean draft flag, so whether it is a draft cannot be read");
    if (typeof item.draft !== "boolean") unread.push("the list item carries no boolean draft flag, so whether it is a draft cannot be read");
    f.updatedAt = detail.updated_at ?? f.updatedAt;
    f.idleDays = daysBetween(f.updatedAt, now);
    f.mergeableState = detail.mergeable_state ?? null;
    f.conflicting = f.mergeableState === "dirty" ? true : (f.mergeableState && f.mergeableState !== "unknown") ? false : null;
    f.filesExpected = typeof detail.changed_files === "number" ? detail.changed_files : null;
    f.commentsExpected = typeof detail.review_comments === "number" ? detail.review_comments : null;
    f.ask = f.lane === "mac" ? bodyAsksCloudToLand(detail.body) : false;
    f.quotesGates = bodyMentionsGates(detail.body);
    if (!Number.isFinite(f.idleDays) || !Number.isFinite(f.ageDays)) unread.push("created_at or updated_at is not a date, so the PR's age cannot be measured");
    if (unread.length) f.errors.pr = unread.join("; ");
  } else if (!f.errors.pr) {
    f.errors.pr = "the PR detail came back empty";
  }

  const files = await guard("files", () => listPrFiles(api, repo, item.number));
  if (files) {
    f.files = files;
    f.filesComplete = f.filesExpected === null ? false : f.files.length === f.filesExpected;
    if (!f.filesComplete) f.errors.files = `read ${f.files.length} file(s) of ${f.filesExpected ?? "an unknown number"} the PR reports`;
    Object.assign(f, classifyFiles(f.files));
  }

  if (f.headSha) {
    const runs = await guard("checks", () => listCheckRuns(api, repo, f.headSha));
    if (runs) f.checks = summarizeChecks(runs);
  } else {
    f.errors.checks = "the PR has no head sha";
  }

  const exact = threadsFile.get(item.number);
  if (exact) {
    f.threads = { method: "file", roots: exact.total ?? exact.roots ?? null, unanswered: null, unresolved: exact.unresolved };
  } else {
    const comments = await guard("comments", () => listAll(api, `/repos/${repo}/pulls/${item.number}/comments`));
    // Every other list is checked against a count GitHub states; this one is checked against the
    // PR's own review_comments. A short page (or a count that moved while it was read) is a read
    // error, never "no threads": the comments are then unreadable, which blocks LAND.
    if (comments) {
      if (f.commentsExpected === null) f.errors.comments = "the PR detail carries no review_comments count, so the comment list cannot be checked for completeness";
      else if (comments.length !== f.commentsExpected) f.errors.comments = `read ${comments.length} review comment(s) but the PR reports ${f.commentsExpected}`;
      else f.threads = summarizeThreads(comments);
    }
  }

  // ancestry: only worth asking for a PR the earlier rules have not already placed
  if (f.headSha && !ctx.declared.has(item.number)) {
    const local = localGit ? localGit.isAncestor(f.headSha) : null;
    if (local !== null) {
      f.ancestor = local;
      f.ancestorSource = "local-git";
    } else {
      const cmp = await guard("compare", async () => {
        const c = await api.json(`/repos/${repo}/compare/${ctx.baseSha}...${f.headSha}?per_page=1`);
        if (c?.status === "identical" || c?.status === "behind") return true;
        if (c?.status === "ahead" || c?.status === "diverged") return false;
        throw new ApiError(`compare answered status ${JSON.stringify(c?.status)}`);
      });
      if (cmp !== undefined) { f.ancestor = cmp; f.ancestorSource = "rest-compare"; }
    }
  }

  if (/^mac\/tick-/.test(f.headRef) && f.files.length > 0 && f.filesComplete && f.ancestor !== true) {
    f.tick = await tickEvidence(ctx, f);
  }
  return f;
}

// ── the rules ────────────────────────────────────────────────────────────────────────────

/** What the PR would be if nothing else (idleness, supersession, a declared worker) applied.
 *  cls is null when the file list could not be read: the class is then unknown, not guessed. */
export function naturalClass(f, mailboxBranch = MAILBOX_BRANCH) {
  if (f.lane === "lane" && f.headRef === mailboxBranch) return { cls: null, why: "the standing mailbox branch is never landed" };
  if (f.errors.files || !f.filesComplete) return { cls: null, why: "the changed-file list could not be read in full" };
  const hard = f.categories.filter((c) => c === "DECISION_PATH" || c === "OWNER_RESERVED");
  if (hard.length) return { cls: "OWNER-MERGE", why: `classifier-${hard.map((c) => c.toLowerCase()).join("+")}` };
  if (f.ownerNamed.length) return { cls: "OWNER-MERGE", why: "owner-named-surface" };
  if (f.lane === "dependabot") return { cls: "OWNER-MERGE", why: "dependabot-not-cloud-opened" };
  if (f.lane === "other") return { cls: "OWNER-MERGE", why: "other-lane-owner-review" };
  const t = f.categories.length ? "safety_machinery" : "autonomous";
  if (f.lane === "mac") return { cls: "MAC-ASK-NEEDED", why: `mac-opened-${t}` };
  return { cls: "LAND-UNDER-DR-037", why: `cloud-opened-${t}` };
}

const nameOf = (label) => label.replace(/=[^=]*$/, "");

/** Everything that stops a merge today, as the inventory's blockersToLand did. Informational for
 *  every PR; decisive only for the two landable classes. The Mac ask is handled by the caller. */
export function landingBlockers(f, baseName) {
  const b = [];
  if (f.draft) b.push("draft");
  if (f.base === null) b.push("base branch not readable (a stacked PR cannot be ruled out)");
  else if (f.base !== baseName) b.push(`stacked on ${f.base}, not on ${baseName}`);
  if (f.conflicting === true) b.push(`conflicting with ${baseName} (mergeable_state=dirty)`);
  else if (f.conflicting === null) b.push("mergeable_state not computed by GitHub");
  if (!f.checks) {
    b.push(`checks unreadable (${f.errors.checks ?? "no reading"})`);
  } else {
    const c = f.checks;
    if (c.gating.state !== "success") b.push(`gating check ${c.gating.state}`);
    if (c.macOnly.state !== "absent" && c.macOnly.state !== "success") b.push(`Mac-only check ${c.macOnly.state}`);
    const other = c.failing.filter((x) => nameOf(x) !== GATING_CHECK && !MAC_ONLY_CHECK_RE.test(nameOf(x)));
    if (other.length) b.push(`other failing checks: ${other.join(", ")}`);
    const pend = c.pending.filter((x) => nameOf(x) !== GATING_CHECK && !MAC_ONLY_CHECK_RE.test(nameOf(x)));
    if (pend.length) b.push(`checks not finished: ${pend.join(", ")}`);
    const nov = c.noVerdict.filter((x) => nameOf(x) !== GATING_CHECK && !MAC_ONLY_CHECK_RE.test(nameOf(x)));
    if (nov.length) b.push(`checks with no verdict (cancelled, stale or no conclusion): ${nov.join(", ")}`);
    if (f.touchesNative) {
      const bad = c.native.filter((x) => !/=(success|skipped|neutral)$/.test(x));
      if (c.native.length === 0) b.push("native client suites absent (the PR touches native/**)");
      else if (bad.length) b.push(`native client suites not green: ${bad.join(", ")}`);
    }
  }
  if (!f.threads) {
    b.push(`review comments unreadable (${f.errors.comments ?? "no reading"}), counted as open`);
  } else if (f.threads.unresolved !== null) {
    if (f.threads.unresolved > 0) b.push(`${f.threads.unresolved} unresolved review thread(s)`);
  } else if (f.threads.roots > 0) {
    b.push(`${f.threads.roots} review thread(s) whose resolution REST cannot show (${f.threads.unanswered} with no reply), counted as open`);
  }
  if (!f.quotesGates) b.push("body does not quote local preflight + verify:breadth (DR-037 cond. 2 unverified)");
  return b;
}

const fmtDays = (x) => round1(x).toFixed(1);

const TICK_NOTE = "mac/tick-* PR: LANE_COORDINATION rule 2 has the cloud steward open and land these, but the API cannot show who opened this one (scripts/mac/lane-tick.sh opens the PR itself when gh is on the Mac's PATH), and DR-037 cond. 5 lets the lane land only a PR it opened or was asked to drive. The stricter reading holds here: land it only if the steward opened it or the Mac's mail names it.";

/**
 * The disposition of one PR: the FIRST rule that holds, in the order the header lists, and
 * UNKNOWN (never a guess) when the rules have no row for what was read.
 * ctx = { base, declared: Map(number -> note), standing: {pr, branch} | null }
 */
export function decide(f, ctx) {
  const mailboxBranch = ctx.standing?.branch ?? MAILBOX_BRANCH;
  const nat = naturalClass(f, mailboxBranch);
  const blockers = landingBlockers(f, ctx.base);
  const flags = [];
  const out = (disposition, reason, evidence = []) => ({
    disposition,
    reason,
    natural: nat.cls,
    naturalWhy: nat.why,
    blockers,
    flags,
    evidence,
  });
  if (f.idleDays < RECENT_HOURS / 24 && !ctx.declared.has(f.number)) {
    flags.push(`updated <${RECENT_HOURS}h ago but not on the declared in-flight list (possible undeclared live worker or bot refresh)`);
  }
  if (f.ancestor === null && f.errors.compare) flags.push(`mainline ancestry unread: ${f.errors.compare}`);
  if (f.tick.applicable && f.tick.superseded === null) flags.push(`mac/tick supersession unread: ${f.tick.unknownWhy}`);

  if (f.errors.pr) return out("UNKNOWN", `the PR could not be read: ${f.errors.pr}`);

  if (f.lane === "lane" && f.headRef === mailboxBranch) {
    if (ctx.standing && f.number === ctx.standing.pr && f.draft && f.filesComplete && f.files.length === 0) {
      return out("STANDING", "standing-wake-channel", [`Draft PR with no changed files whose number and branch match docs/agent/lane-mailbox.json (#${ctx.standing.pr}, ${ctx.standing.branch}); its comments wake the cloud lane. Never landed, never closed.`]);
    }
    const why = !ctx.standing ? "docs/agent/lane-mailbox.json was unreadable, so the mailbox PR is not known"
      : f.number !== ctx.standing.pr ? `docs/agent/lane-mailbox.json names #${ctx.standing.pr}, not #${f.number}`
      : !f.draft ? "it is not a draft"
      : !f.filesComplete ? "its file list could not be read in full"
      : `it carries ${f.files.length} changed file(s)`;
    return out("UNKNOWN", `head is the standing mailbox branch (${mailboxBranch}) but the PR is not the standing draft with no files (${why}); the mailbox channel is never landed and never closed by a sweep, so a person looks`);
  }
  if (ctx.declared.has(f.number)) {
    const note = ctx.declared.get(f.number);
    return out("IN-FLIGHT", "declared-live", [`Declared live by the caller${note ? `: ${note}` : ""}. The tool cannot see workers; it leaves a declared PR alone.`]);
  }
  if (f.ancestor === true) {
    return out("SUPERSEDED", "head-is-ancestor-of-mainline", [`Head ${f.headSha.slice(0, 12)} is an ancestor of ${ctx.base} (${f.ancestorSource}): everything it changes is already on mainline.`]);
  }
  if (f.tick.applicable && f.tick.superseded === true) {
    return out("SUPERSEDED", "mac-tick-state-snapshot-superseded", [
      "Mac tick snapshot PR (mac/tick-*): every file it changes was rewritten on mainline after its head commit, or is a sim-request whose result is already on mainline. Its head is not an ancestor, so supersession is by content, not by commit.",
      ...f.tick.evidence,
    ]);
  }

  if (f.errors.files || !f.filesComplete) return out("UNKNOWN", `the changed-file list could not be read in full (${f.errors.files ?? "no reading"}), so the PR cannot be classified`);

  // STALE: idle past the window AND (red OR conflicting). Advisory checks never make a PR red.
  if (f.idleDays > STALE_DAYS) {
    const red = f.checks ? f.checks.red.length > 0 : null;
    const conflicting = f.conflicting;
    if (red === true || conflicting === true) {
      const kind = conflicting === true && red === true ? "conflicting-and-red" : conflicting === true ? "conflicting" : "red";
      const parts = [];
      if (conflicting === true) parts.push("conflicting (mergeable_state=dirty)");
      if (red === true) parts.push(`red (${f.checks.red.join("; ")})`);
      const ev = [`No update for ${fmtDays(f.idleDays)} d (updated_at ${f.updatedAt}; window ${STALE_DAYS} d); ${parts.join(" AND ")}.`];
      if (f.checks?.advisory.length) ev.push(`Advisory failing checks, not counted as red: ${f.checks.advisory.join(", ")}.`);
      if (nat.cls) ev.push(`If revived it would be: ${nat.cls} (${nat.why}).`);
      return out("STALE", `idle-over-${STALE_DAYS}d-${kind}`, ev);
    }
    if (red === null || conflicting === null) {
      return out("UNKNOWN", `idle ${fmtDays(f.idleDays)} d (past ${STALE_DAYS}), but ${red === null ? `its checks could not be read (${f.errors.checks ?? "no reading"})` : "GitHub has not computed mergeable_state"}, so STALE can be neither ruled in nor out`);
    }
  }

  if (nat.cls === "OWNER-MERGE") {
    const ev = [];
    for (const m of f.matched.filter((x) => x.category !== "SAFETY_MACHINERY")) ev.push(`${m.category}: ${m.rule} (${m.count} file(s), e.g. ${m.sample.join(", ")})`);
    for (const o of f.ownerNamed) ev.push(`Owner-named surface: ${o.rule} (${o.file})`);
    if (f.lane === "dependabot") ev.push("Dependabot PR: bot-owned, never merged by a routine (docs/agent/scheduled-routines.json).");
    if (f.lane === "other") ev.push(`Branch prefix of ${f.headRef} is not a lane's own: DR-037 condition 5, not the cloud lane's to land.`);
    return out("OWNER-MERGE", nat.why, ev);
  }

  if (nat.cls === "MAC-ASK-NEEDED") {
    const ev = [`mac/* ${nat.why.replace("mac-opened-", "")} PR - DR-037 cond. 5: the cloud lane lands it only on the Mac's ask in MAIL, which this tool does not read (${f.ask ? "a line in the PR body reads as an ask" : "no ask in the PR body"}).`];
    if (f.ask) ev.push("A body line has no provenance (every lane pushes as one account, and a body can be rewritten), so it is never the ask: confirm the mail ask (pnpm run lane:inbox; artifacts/lane-messages) before anything lands.");
    if (f.ask && blockers.length) ev.push(`Not landable now either: ${blockers.join("; ")}.`);
    if (/^mac\/tick-/.test(f.headRef)) ev.push(TICK_NOTE);
    return out("MAC-ASK-NEEDED", f.ask ? `ask in body; confirm mail${blockers.length ? "; not landable now" : ""}` : nat.why, ev);
  }

  if (nat.cls === "LAND-UNDER-DR-037") {
    if (blockers.length === 0) {
      return out("LAND-UNDER-DR-037", nat.why, [`Cloud-lane PR (${f.headRef}), tier ${f.tier}, gating check passed on this head, not conflicting, no open review thread the tool can see, no owner-named surface. The lane still re-reads the head and quotes its own preflight and breadth before merging.`]);
    }
    return out("UNKNOWN", `would be LAND-UNDER-DR-037 (${nat.why}) but is not landable now and no rule places it elsewhere: ${blockers.join("; ")}`);
  }

  return out("UNKNOWN", "no rule placed this PR");
}

// ── issues and branches ──────────────────────────────────────────────────────────────────

export const normalizeTitle = (t) => String(t ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** Open issues (pull requests removed), and the groups that share a normalised title. */
export function assembleIssues(raw) {
  const issues = raw
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title ?? "",
      url: i.html_url ?? null,
      labels: (i.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)).sort(),
      author: i.user?.login ?? "",
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      comments: i.comments ?? 0,
    }))
    .sort((a, b) => a.number - b.number);
  const groups = new Map();
  for (const i of issues) {
    const k = normalizeTitle(i.title);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  }
  const duplicates = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({
      title: g[0].title,
      numbers: g.map((i) => i.number),
      labels: g[0].labels.filter((l) => g.every((i) => i.labels.includes(l))),
      oldest: g[0].number,
      newest: g[g.length - 1].number,
    }))
    .sort((a, b) => a.numbers[0] - b.numbers[0]);
  return { issues, duplicates };
}

export const BRANCH_ORDER = ["PRUNABLE", "TIP-MOVED", "UNMERGED"];

/**
 * Branches that carry no open PR. PRUNABLE only on a MERGED PR for that head ref whose head sha
 * is the branch tip (nothing was added after the merge); a merged PR with a different tip is
 * TIP-MOVED; no merged PR is UNMERGED. Reachability from mainline is evidence, never the rule.
 */
export function assembleBranches({ branches, openRefs, mergedByRef, baseName, isAncestor = () => null }) {
  const rows = [];
  let hasOpenPr = 0;
  let isDefault = 0;
  let protectedCount = 0;
  for (const b of branches) {
    if (b.protected) protectedCount++;
    if (b.name === baseName) { isDefault++; continue; }
    if (openRefs.has(b.name)) { hasOpenPr++; continue; }
    const merged = [...(mergedByRef.get(b.name) ?? [])].sort((x, y) => String(y.mergedAt).localeCompare(String(x.mergedAt)) || y.number - x.number);
    const tip = b.commit?.sha ?? "";
    let disposition;
    let why;
    if (merged.length === 0) {
      disposition = "UNMERGED";
      why = "no merged PR has this head ref (the PRUNABLE rule needs one); whether its commits reached mainline another way is not established here, so confirm before anyone deletes it";
    } else if (merged[0].headSha === tip) {
      disposition = "PRUNABLE";
      why = `merged by #${merged[0].number} and the tip is that PR's head: nothing was added after the merge`;
    } else {
      disposition = "TIP-MOVED";
      why = `#${merged[0].number} merged this ref at ${String(merged[0].headSha).slice(0, 9)} but the tip is ${tip.slice(0, 9)}: commits were added after the merge`;
    }
    rows.push({
      name: b.name,
      sha: tip,
      protected: b.protected === true,
      disposition,
      why,
      mergedPrs: merged.map((m) => m.number).sort(sortNum),
      ancestorOfMainline: isAncestor(tip) === true ? true : null,
    });
    if (rows[rows.length - 1].ancestorOfMainline && disposition !== "PRUNABLE") rows[rows.length - 1].why += "; its tip IS an ancestor of mainline (local git), which is evidence, not this tool's PRUNABLE rule";
  }
  rows.sort((a, b) => BRANCH_ORDER.indexOf(a.disposition) - BRANCH_ORDER.indexOf(b.disposition) || a.name.localeCompare(b.name));
  return { rows, total: branches.length, hasOpenPr, isDefault, protectedCount };
}

// ── the report ───────────────────────────────────────────────────────────────────────────

const countBy = (xs, keyFn, order) => order.map((k) => ({ key: k, count: xs.filter((x) => keyFn(x) === k).length }));

/** Sorted rows -> the report object. Pure: all I/O happened before this. */
export function buildReport(world) {
  const { repo, base, baseSha, now, auth, sources, notes, declared, prFacts, issuesRaw, branchInfo } = world;
  const ctx = { base, declared, standing: world.standing };
  const prs = prFacts.map((f) => {
    const d = decide(f, ctx);
    return {
      number: f.number,
      title: f.title,
      url: f.url,
      head: { ref: f.headRef, sha: f.headSha },
      base: f.base,
      author: f.author,
      lane: f.lane,
      draft: f.draft,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      ageDays: round1(f.ageDays),
      idleDays: round1(f.idleDays),
      mergeableState: f.mergeableState,
      gating: f.checks ? f.checks.gating : { state: "unread", id: null },
      macOnly: f.checks ? f.checks.macOnly : { state: "unread", id: null },
      redChecks: f.checks ? f.checks.red : [],
      advisoryFailing: f.checks ? f.checks.advisory : [],
      pendingChecks: f.checks ? f.checks.pending : [],
      threads: f.threads ?? { method: "unreadable", roots: null, unanswered: null, unresolved: null },
      files: { count: f.files.length, tier: f.tier, categories: f.categories, ownerNamed: f.ownerNamed, matched: f.matched },
      ancestry: { isAncestor: f.ancestor, source: f.ancestorSource },
      ask: f.lane === "mac" ? (f.ask ? "in-body" : "not-in-body") : "n/a",
      disposition: d.disposition,
      reason: d.reason,
      natural: d.natural,
      naturalWhy: d.naturalWhy,
      blockers: d.blockers,
      flags: d.flags,
      evidence: d.evidence,
      readErrors: Object.entries(f.errors).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}: ${v}`),
    };
  });
  prs.sort((a, b) => DISP_RANK.get(a.disposition) - DISP_RANK.get(b.disposition) || a.number - b.number);

  const { issues, duplicates } = assembleIssues(issuesRaw);
  const branches = branchInfo;
  const counts = {
    prs: countBy(prs, (p) => p.disposition, DISPOSITIONS),
    lanes: countBy(prs, (p) => p.lane, LANES),
    matrix: DISPOSITIONS.map((d) => ({ disposition: d, lanes: LANES.map((l) => ({ lane: l, count: prs.filter((p) => p.disposition === d && p.lane === l).length })) })),
    stalePrsByNatural: ["OWNER-MERGE", "MAC-ASK-NEEDED", "LAND-UNDER-DR-037", "UNKNOWN"].map((k) => ({ key: k, count: prs.filter((p) => p.disposition === "STALE" && (p.natural ?? "UNKNOWN") === k).length })),
    issues: { open: issues.length, duplicateGroups: duplicates.length, inDuplicateGroups: duplicates.reduce((n, g) => n + g.numbers.length, 0) },
    branches: branches
      ? {
          total: branches.total,
          withOpenPr: branches.hasOpenPr,
          withoutOpenPr: branches.rows.length,
          protectedBranches: branches.protectedCount,
          byDisposition: BRANCH_ORDER.map((k) => ({ key: k, count: branches.rows.filter((r) => r.disposition === k).length })),
        }
      : null,
  };
  return {
    tool: "backlog-triage",
    repo,
    base,
    baseSha,
    generatedAt: now.toISOString(),
    auth,
    sources,
    declaredLive: [...declared.entries()].sort(([a], [b]) => a - b).map(([pr, note]) => ({ pr, note })),
    notes,
    counts,
    prs,
    issues,
    duplicateIssues: duplicates,
    branches: branches ? branches.rows : [],
  };
}

// ── markdown ─────────────────────────────────────────────────────────────────────────────

const cell = (s) => String(s ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
const trunc = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
function table(headers, rows) {
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");
}
const TIER_LETTER = { DECISION_PATH: "D", SAFETY_MACHINERY: "S", OWNER_RESERVED: "O" };
const tierLabel = (p) => (p.files.categories.length ? p.files.categories.map((c) => TIER_LETTER[c]).join("") : p.files.tier === "autonomous" ? "auto" : "?");
const threadsLabel = (t) => (t.method === "unreadable" ? "?" : t.unresolved !== null ? String(t.unresolved) : t.roots === 0 ? "0" : `~${t.unanswered}/${t.roots}`);
const shortSha = (s) => String(s ?? "").slice(0, 9);

function totalsTable(report) {
  const total = report.prs.length;
  return table(["Disposition", "Count"], [...report.counts.prs.filter((c) => c.count > 0).map((c) => [c.key, c.count]), ["**Total**", `**${total}**`]]);
}
function matrixTable(report) {
  const lanes = LANES.filter((l) => report.prs.some((p) => p.lane === l));
  return table(["Disposition", ...lanes], report.counts.matrix.filter((m) => m.lanes.some((l) => l.count > 0)).map((m) => [m.disposition, ...lanes.map((l) => m.lanes.find((x) => x.lane === l).count)]));
}
function headerLines(report) {
  const s = report.sources;
  const lines = [
    `Read ${report.generatedAt} from the GitHub REST API (GET only) for ${report.repo}; mainline ${report.base} @ ${shortSha(report.baseSha)}.`,
    `Auth: ${report.auth.summary}`,
    `Open items: ${report.prs.length} PRs + ${report.issues.length} issues = ${s.openTotalListed}; the repository's open count says ${s.openTotalExpected} (${s.openTotalListed === s.openTotalExpected ? "agree" : "DISAGREE"}).`,
    `Mainline ancestry: ${s.ancestry}`,
    `Review threads: ${s.threads}`,
    `Declared in-flight: ${report.declaredLive.length ? report.declaredLive.map((d) => `#${d.pr}`).join(" ") : "none declared, so no PR can be IN-FLIGHT"}.`,
    `API calls: ${s.apiCalls}.`,
  ];
  for (const n of report.notes) lines.push(n);
  return lines;
}

/** The full report: header, totals, the PR table, issues, branches. */
export function renderMarkdown(report) {
  const out = [];
  out.push(`# Backlog queue - ${report.repo}`, "");
  for (const l of headerLines(report)) out.push(`- ${l}`);
  out.push("", "## Pull requests: totals per disposition", "", totalsTable(report), "", "## Disposition by lane", "", matrixTable(report), "");
  const stale = report.counts.stalePrsByNatural.filter((c) => c.count > 0);
  if (stale.length) out.push(`STALE PRs by what they would be if revived: ${stale.map((c) => `${c.count} ${c.key}`).join(", ")}.`, "");
  out.push("## Pull requests (sorted by disposition, then number)", "");
  out.push(table(
    ["#", "Disposition", "Lane", "Tier", "Draft", "Gating", "Mac-only", "mergeable", "Idle d", "Threads", "Files", "Title / why"],
    report.prs.map((p) => [p.number, p.disposition, p.lane, tierLabel(p), p.draft ? "Y" : "", p.gating.state, p.macOnly.state, p.mergeableState ?? "?", p.idleDays.toFixed(1), threadsLabel(p.threads), p.files.count, `${trunc(p.title, 50)} - ${trunc(p.reason, 90)}`]),
  ));
  out.push("", "Tier key: D=DECISION_PATH, S=SAFETY_MACHINERY, O=OWNER_RESERVED, auto=autonomous. Threads: a plain number is exact; `~a/b` is the REST heuristic (b root review comments, a with no reply); `?` is unread.", "");
  const unknown = report.prs.filter((p) => p.disposition === "UNKNOWN");
  if (unknown.length) {
    out.push("## UNKNOWN: the rules have no row, or a fact could not be read", "");
    for (const p of unknown) out.push(`- #${p.number} (${p.lane}): ${p.reason}`);
    out.push("");
  }
  const errs = report.prs.filter((p) => p.readErrors.length);
  if (errs.length) {
    out.push("## Read errors (the affected rows are UNKNOWN or carry a stated blocker)", "");
    for (const p of errs) out.push(`- #${p.number}: ${p.readErrors.join("; ")}`);
    out.push("");
  }
  out.push("## Open issues", "");
  out.push(report.issues.length
    ? table(["#", "Title", "Labels", "Opened by", "Created", "Updated", "Comments"], report.issues.map((i) => [i.number, trunc(i.title, 70), i.labels.join(", ") || "-", i.author, i.createdAt.slice(0, 10), i.updatedAt.slice(0, 10), i.comments]))
    : "No open issues.");
  out.push("");
  if (report.duplicateIssues.length) {
    out.push("### Duplicate titles", "");
    for (const g of report.duplicateIssues) out.push(`- "${g.title}" x${g.numbers.length}: ${g.numbers.map((n) => `#${n}`).join(" ")} (labels in common: ${g.labels.join(", ") || "none"}; oldest #${g.oldest}, newest #${g.newest})`);
    out.push("");
  } else {
    out.push("No two open issues share a title.", "");
  }
  out.push("## Branches with no open PR", "");
  if (report.counts.branches) {
    const b = report.counts.branches;
    out.push(`${b.total} branches: ${b.withOpenPr} carry an open PR, ${b.withoutOpenPr} do not; ${b.protectedBranches} of ${b.total} report protected: true (a protected branch cannot be deleted by the prune scripts). ${b.byDisposition.map((c) => `${c.count} ${c.key}`).join(", ")}.`, "");
    out.push("PRUNABLE means a MERGED PR has this head ref and the tip is that PR's head. Deleting is a person's act (CLAUDE.md \"Ask before\"); this tool only lists.", "");
    out.push(table(["Branch", "Disposition", "Protected", "Merged PRs", "Why"], report.branches.map((r) => [r.name, r.disposition, r.protected ? "yes" : "no", r.mergedPrs.map((n) => `#${n}`).join(" ") || "-", trunc(r.why, 110)])));
  } else {
    out.push("Branches were not read.");
  }
  out.push("");
  return out.join("\n");
}

/** The compact, dated block written between the markers of a doc page. */
export function renderSnapshot(report) {
  const out = [];
  out.push(`_Snapshot read ${report.generatedAt} from ${report.repo}; mainline ${report.base} @ ${shortSha(report.baseSha)}. It is a dated reading, not a live view: re-generate before acting on it._`, "");
  out.push(totalsTable(report), "", matrixTable(report), "");
  for (const d of DISPOSITIONS) {
    const rows = report.prs.filter((p) => p.disposition === d);
    if (rows.length) out.push(`- ${d} (${rows.length}): ${rows.map((p) => `#${p.number}`).join(" ")}`);
  }
  out.push("");
  const unknown = report.prs.filter((p) => p.disposition === "UNKNOWN");
  if (unknown.length) {
    out.push("UNKNOWN rows and why:", "");
    for (const p of unknown) out.push(`- #${p.number}: ${trunc(p.reason, 220)}`);
    out.push("");
  }
  out.push(`Issues: ${report.issues.length} open${report.duplicateIssues.length ? `; duplicate titles: ${report.duplicateIssues.map((g) => `"${g.title}" x${g.numbers.length} (${g.numbers.map((n) => `#${n}`).join(" ")})`).join("; ")}` : "; no two share a title"}.`);
  if (report.counts.branches) {
    const b = report.counts.branches;
    out.push(`Branches: ${b.total} total, ${b.withOpenPr} with an open PR, ${b.withoutOpenPr} without (${b.byDisposition.map((c) => `${c.count} ${c.key}`).join(", ")}); ${b.protectedBranches} report protected: true.`);
  }
  out.push("", "How this was read:", "");
  for (const l of headerLines(report).slice(2)) if (!l.startsWith("API calls:")) out.push(`- ${l}`);
  return out.join("\n");
}

/** Write `body` between the doc's snapshot markers. Fails closed when the markers are not
 *  exactly one begin followed by one end: it never appends a section on its own. */
export function writeSnapshot(path, body, { keepIfRealWhenNotGenerated = false } = {}) {
  if (!existsSync(path)) throw new ToolError(`--snapshot: ${path} does not exist; the page owns the markers, the tool does not create it`, 4);
  const text = readFileSync(path, "utf8");
  const begins = [...text.matchAll(new RegExp(SNAPSHOT_BEGIN_RE.source, "g"))];
  const ends = text.split(SNAPSHOT_END).length - 1;
  if (begins.length !== 1 || ends !== 1) throw new ToolError(`--snapshot: ${path} must carry exactly one begin marker and one "${SNAPSHOT_END}" (found ${begins.length} and ${ends})`, 4);
  const start = begins[0].index + begins[0][0].length;
  const stop = text.indexOf(SNAPSHOT_END);
  if (stop < start) throw new ToolError(`--snapshot: the end marker comes before the begin marker in ${path}`, 4);
  const current = text.slice(start, stop).trim();
  if (keepIfRealWhenNotGenerated && current !== "" && !/^not generated here:/m.test(current)) {
    return { written: false, kept: true };
  }
  const next = `${text.slice(0, start)}\n\n${body.trim()}\n\n${text.slice(stop)}`;
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, next);
  renameSync(tmp, path);
  return { written: true, kept: false };
}

// ── reading the whole queue ──────────────────────────────────────────────────────────────

/** `1559,1585:worker B87` -> Map(1559 -> "", 1585 -> "worker B87"); a JSON file may add richer notes. */
export function parseDeclared(list, fileText) {
  const out = new Map();
  for (const part of String(list ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^#?(\d+)(?::(.*))?$/.exec(part);
    if (!m) throw new ToolError(`--declared-live: cannot read "${part}" (want 1559 or 1559:note, comma separated)`, 2);
    out.set(Number(m[1]), (m[2] ?? "").trim());
  }
  if (fileText !== undefined && fileText !== null) {
    let j;
    try { j = JSON.parse(fileText); } catch (e) { throw new ToolError(`--declared-live-file: not JSON (${e.message})`, 2); }
    const entries = Array.isArray(j)
      ? j.map((x) => (typeof x === "number" ? [x, ""] : [x?.pr, x?.note ?? ""]))
      : Object.entries(j ?? {});
    for (const [k, v] of entries) {
      const n = Number(k);
      if (!Number.isInteger(n) || n <= 0) throw new ToolError(`--declared-live-file: "${k}" is not a PR number`, 2);
      out.set(n, String(v ?? ""));
    }
  }
  return out;
}

/** `{ "1321": { "total": 79, "unresolved": 73 } }` -> Map; exact numbers a caller read elsewhere. */
export function parseThreadsFile(text) {
  const out = new Map();
  if (text === undefined || text === null) return out;
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new ToolError(`--threads-file: not JSON (${e.message})`, 2); }
  for (const [k, v] of Object.entries(j ?? {})) {
    const n = Number(k);
    if (!Number.isInteger(n) || n <= 0 || !Number.isInteger(v?.unresolved) || v.unresolved < 0) {
      throw new ToolError(`--threads-file: entry "${k}" needs a PR number and an integer "unresolved"`, 2);
    }
    out.set(n, { total: Number.isInteger(v.total) ? v.total : null, unresolved: v.unresolved });
  }
  return out;
}

/** How many rows a list endpoint holds, by asking for one row per page and reading the Link
 *  header's last page: a number that does not depend on the pages `listAll` reads, so a short
 *  page in the middle of that read is caught by comparing the two. One row and no Link header is
 *  either exactly one row or a header something stripped, and the two read the same, so page 2 is
 *  asked for: any row there means the header is missing and the total cannot be read (exit 3). */
async function countOf(api, path) {
  const r = await api.get(withQuery(path, "per_page=1"));
  if (!Array.isArray(r.json)) throw new ToolError(`${path}: the per_page=1 count read was not a JSON array, so the list cannot be checked against a total`, 3);
  const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(r.headers?.get?.("link") ?? "");
  if (last) return Number(last[1]);
  if (r.json.length === 1) {
    const next = await api.json(withQuery(path, "per_page=1&page=2"));
    if (!Array.isArray(next)) throw new ToolError(`${path}: page 2 of the per_page=1 count read was not a JSON array, so the list cannot be checked against a total`, 3);
    if (next.length > 0) throw new ToolError(`${path}: the per_page=1 count read carried no Link header with a last page although page 2 holds rows, so the total cannot be read and the list cannot be checked against it (a proxy that strips Link headers does this). Re-run, or read through a path that passes the header.`, 3);
  }
  return r.json.length;
}

/** The open PRs and issues, accepted only when the pulls list, the issues list and the
 *  repository's own open count agree. An empty page is "no PRs" only when the count says 0. */
async function readOpenItems(api, repo, { sleep, allowDrift }) {
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const prs = await listAll(api, `/repos/${repo}/pulls?state=open&sort=created&direction=asc`);
    const all = await listAll(api, `/repos/${repo}/issues?state=open&sort=created&direction=asc`);
    const info = await api.json(`/repos/${repo}`);
    const expected = info?.open_issues_count;
    if (typeof expected !== "number") throw new ToolError(`GET /repos/${repo} carried no open_issues_count, so the lists cannot be checked against a total`, 3);
    const prEntries = all.filter((i) => i.pull_request).length;
    last = { prs, all, expected, prEntries };
    if (prs.length === prEntries && all.length === expected) return { prs, issuesRaw: all.filter((i) => !i.pull_request), expected, drift: null };
    if (attempt < 3) await sleep(2000);
  }
  const msg = `the open lists disagree after 3 reads: pulls list ${last.prs.length}, issues list ${last.all.length} (of which ${last.prEntries} are PRs), repository open_issues_count ${last.expected}. An empty or short page during a GitHub incident looks exactly like this (2026-10-22), so no queue is printed. Re-run, or pass --allow-count-drift if the queue is moving faster than the read.`;
  if (allowDrift && last.prs.length > 0) {
    return { prs: last.prs, issuesRaw: last.all.filter((i) => !i.pull_request), expected: last.expected, drift: msg };
  }
  throw new ToolError(msg, 3);
}

/** Re-classify ONE pull request's files from the API: the landing step that must not trust a queue's age. The
 *  list is accepted only when it is non-empty and its length equals the PR's own changed_files; anything else
 *  throws, and the caller prints NOT CLASSIFIED. */
export async function classifyPr(api, repo, n) {
  const detail = await api.json(`/repos/${repo}/pulls/${n}`);
  const expected = detail?.changed_files;
  const headSha = typeof detail?.head?.sha === "string" ? detail.head.sha : "";
  if (headSha === "") throw new ApiError("the PR detail carries no head sha, so the classification cannot be tied to a head");
  const files = await listPrFiles(api, repo, n);
  if (files.length === 0) throw new ApiError(`the changed-file list is empty (the PR reports ${expected ?? "no count"}): there is nothing to classify, and an empty list is never read as a PR that touches nothing`);
  if (files.length !== expected) throw new ApiError(typeof expected === "number" ? `read ${files.length} file(s) of the ${expected} the PR reports` : "the PR detail carries no changed_files count, so the file list cannot be checked for completeness");
  // the head is read again after the files: a push in between could pair one head's sha with another head's files
  const again = await api.json(`/repos/${repo}/pulls/${n}`);
  if (again?.head?.sha !== headSha) throw new ApiError(`the head moved while the files were read (${headSha.slice(0, 12)}, then ${typeof again?.head?.sha === "string" ? again.head.sha.slice(0, 12) : "unreadable"}), so the files may belong to another head`);
  return { number: n, headSha, fileCount: files.length, ...classifyFiles(files) };
}

/** The --classify body: one line on stdout, an exit code, no queue. Every failure prints NOT CLASSIFIED. */
async function runClassify(opts, io) {
  const n = opts.classify;
  let failure;
  try {
    const picked = pickToken(io.env);
    if (picked.error) throw new ToolError(picked.error, 2);
    const api = makeApi({ token: picked.token, fetchImpl: io.fetchImpl, sleep: io.sleep, shapeKind: picked.shape.kind });
    const c = await classifyPr(api, opts.repo, n);
    const hard = c.categories.filter((x) => x === "DECISION_PATH" || x === "OWNER_RESERVED");
    const gated = [...hard, ...(c.ownerNamed.length ? ["owner-named surface"] : [])];
    const named = c.ownerNamed.length ? c.ownerNamed.map((o) => `owner-named: ${o.rule} (${o.file})`).join("; ") : "no owner-named surface";
    io.stdout(`#${n} CLASSIFIED ${c.tier} | ${named} | ${c.fileCount} of ${c.fileCount} file(s) | head ${c.headSha.slice(0, 12)} | ${gated.length ? `OWNER-GATED (${gated.join(" + ")})` : "not owner-gated by its files"}\n`);
    return 0;
  } catch (err) {
    failure = err instanceof ApiError
      ? new ToolError(err.message, [401, 403, 404].includes(err.status) ? 2 : 3)
      : err instanceof ToolError ? err : new ToolError(`unexpected failure: ${err?.message ?? err}`, 3);
  }
  io.stdout(`#${n} NOT CLASSIFIED: ${failure.message.replace(/\s+/g, " ")}\n`);
  return failure.exitCode;
}

/** Do every read, then build the report. All I/O is behind `io`, so the self-test drives it with a fake GitHub. */
export async function collectReport(opts, io) {
  const picked = pickToken(io.env);
  if (picked.error) throw new ToolError(picked.error, 2);
  const api = makeApi({ token: picked.token, fetchImpl: io.fetchImpl, sleep: io.sleep, shapeKind: picked.shape.kind });
  const now = opts.now ?? io.now();
  const repo = opts.repo;

  const rl = await api.json("/rate_limit");
  const core = rl?.resources?.core;
  if (!core || typeof core.limit !== "number") throw new ToolError("GET /rate_limit carried no core limit; the credential cannot be verified, so nothing is read", 3);
  if (core.limit <= 60) {
    throw new ToolError(`GitHub answered as an anonymous client (core limit ${core.limit}/hour): the token was not honoured${picked.shape.kind === "other" ? " (it is not in GitHub's token format; if a proxy is meant to inject the credential, it did not)" : ""}. Nothing is read, so there is no queue to report.`, 2);
  }
  const authSummary = `authenticated (core limit ${core.limit}, ${core.remaining} remaining at start); token from ${picked.from}: ${picked.shape.note}`;

  const info = await api.json(`/repos/${repo}`);
  if (!info || typeof info.default_branch !== "string") throw new ToolError(`GET /repos/${repo} carried no default_branch`, 3);
  const base = opts.base ?? info.default_branch;
  const baseBranch = await api.json(`/repos/${repo}/branches/${encodeURIComponent(base)}`);
  const baseSha = baseBranch?.commit?.sha;
  if (!baseSha) throw new ToolError(`could not read the head of ${base}`, 3);

  const open = await readOpenItems(api, repo, { sleep: io.sleep, allowDrift: opts.allowCountDrift });
  const need = open.prs.length * RESERVE_PER_PR + RESERVE_FIXED;
  if (core.remaining < need) {
    throw new ToolError(`the core rate limit has ${core.remaining} calls left and this read reserves ${need} for ${open.prs.length} PRs (${RESERVE_PER_PR} each plus ${RESERVE_FIXED}; resets at epoch ${core.reset}). Re-run after the reset; a partial queue is never printed.`, 2);
  }

  let standing = null;
  try {
    const lm = JSON.parse(io.readText(resolve(REPO_ROOT, "docs/agent/lane-mailbox.json")));
    if (Number.isInteger(lm.pr) && typeof lm.branch === "string" && lm.branch !== "") standing = { pr: lm.pr, branch: lm.branch };
  } catch { /* no mailbox file: no PR can be STANDING, and the header says so */ }

  let localGit = null;
  let localNote = "not used (--no-local-git)";
  if (!opts.noLocalGit) {
    const lg = makeLocalGit({ dir: opts.repoDir, base, exec: io.gitExec });
    const p = lg.probe(baseSha);
    if (p.available) {
      localGit = lg;
      // never the absolute path: the report is committed to a public page, and on the Mac that
      // path holds the home directory
      const where = opts.repoDir === REPO_ROOT ? "this checkout" : "the --repo-dir checkout";
      localNote = `${where} ${p.shallow ? "is shallow" : "is whole"}, its origin/${base} ${p.current ? "is" : "is NOT"} the live head`;
    } else {
      localNote = `not used (${p.reason})`;
    }
  }

  const ctx = {
    api, repo, base, baseSha, now, localGit, sleep: io.sleep, cache: new Map(),
    threadsFile: opts.threadsFile, declared: opts.declared,
  };
  const prFacts = await pool(open.prs, opts.concurrency, (item) => gatherPr(ctx, item));
  // GitHub computes mergeability lazily, and recomputes it for every PR when mainline moves: a PR
  // whose state came back "unknown" is read again after a pause (the first read started the
  // computation), up to three times, before the rules are allowed to call it unknown.
  for (let round = 1; round <= 3; round++) {
    const again = prFacts.map((f, i) => (f.conflicting === null && !f.errors.pr ? i : -1)).filter((i) => i >= 0);
    if (again.length === 0) break;
    await io.sleep(5000 * round);
    const fresh = await pool(again, opts.concurrency, (i) => gatherPr(ctx, open.prs[i]));
    again.forEach((i, k) => { prFacts[i] = fresh[k]; });
  }

  const bySource = (s) => prFacts.filter((f) => f.ancestorSource === s).length;
  const unread = prFacts.filter((f) => f.ancestor === null && !ctx.declared.has(f.number)).length;
  const exactThreads = prFacts.filter((f) => f.threads?.method === "file").length;

  const branchTotal = await countOf(api, `/repos/${repo}/branches`);
  const branchList = await listAll(api, `/repos/${repo}/branches`);
  if (branchList.length < branchTotal) throw new ToolError(`read ${branchList.length} branches but the repository reports ${branchTotal}: a short page, so no branch table is printed`, 3);
  if (!branchList.some((b) => b.name === base)) throw new ToolError(`the branch listing (${branchList.length} rows) does not contain ${base}: an incomplete read, so no branch table is printed`, 3);
  const closedTotal = await countOf(api, `/repos/${repo}/pulls?state=closed`);
  const closedRaw = await listAll(api, `/repos/${repo}/pulls?state=closed&sort=created&direction=asc`);
  const closed = [...new Map(closedRaw.map((p) => [p.number, p])).values()];
  if (closed.length < closedTotal) throw new ToolError(`read ${closed.length} closed PRs but the list reports ${closedTotal}: an incomplete read, so no branch table is printed`, 3);
  const mergedByRef = new Map();
  for (const p of closed) {
    if (!p.merged_at || p.head?.repo?.full_name !== repo) continue;
    const ref = p.head.ref;
    if (!mergedByRef.has(ref)) mergedByRef.set(ref, []);
    mergedByRef.get(ref).push({ number: p.number, headSha: p.head.sha, mergedAt: p.merged_at });
  }
  const openRefs = new Set(open.prs.filter((p) => p.head?.repo?.full_name === repo).map((p) => p.head.ref));
  const branchInfo = assembleBranches({
    branches: branchList, openRefs, mergedByRef, baseName: base,
    isAncestor: (sha) => (localGit ? localGit.isAncestor(sha) : null),
  });

  const notes = [
    "Mac lane mail is not read by this tool, and a line in a mac/* PR body is never the Mac's ask: the tool prints no LAND for a mac/* PR (a body ask reads \"ask in body; confirm mail\").",
    "A PR is IN-FLIGHT only if --declared-live names it; the tool cannot see a worker.",
  ];
  if (!standing) notes.push("docs/agent/lane-mailbox.json was unreadable, so no PR can be STANDING.");
  if (open.drift) notes.push(`WARNING (--allow-count-drift): ${open.drift}`);
  const report = buildReport({
    repo, base, baseSha, now,
    auth: { ok: true, summary: authSummary, coreLimit: core.limit, tokenShape: picked.shape.kind },
    sources: {
      openTotalListed: open.prs.length + open.issuesRaw.length,
      openTotalExpected: open.expected,
      ancestry: `local git: ${localNote}; it answered ${bySource("local-git")} PR(s), the REST compare endpoint ${bySource("rest-compare")}, ${unread} left unread.`,
      threads: exactThreads === prFacts.length && prFacts.length > 0
        ? `exact counts supplied by --threads-file for all ${exactThreads} PR(s).`
        : `REST heuristic${exactThreads ? ` (exact for ${exactThreads} PR(s) from --threads-file)` : ""}: root review comments and which have a reply, each list checked against the PR's own review_comments count (a different number makes that PR's comments unreadable, which blocks LAND). GitHub shows resolution through GraphQL only, which this tool does not call, so any PR with a review thread counts as having an open one.`,
      apiCalls: 0,
    },
    notes, declared: opts.declared, standing, prFacts, issuesRaw: open.issuesRaw, branchInfo,
  });
  report.sources.apiCalls = `${api.callCount()} GET request(s)`;
  return report;
}

// ── command line ─────────────────────────────────────────────────────────────────────────

export const USAGE = `usage: node scripts/backlog-triage.mjs [options]

  --markdown                 the full report as markdown (the default)
  --json                     the same data as JSON, stable key order
  --snapshot FILE            also write the compact dated block between the markers in FILE
  --classify N               re-read ONE pull request's files and print its tier and owner-named surfaces (no queue); NOT CLASSIFIED and a
                             non-zero exit on a failed read, an empty list or a list that does not match the PR's changed_files
  --self-test                run the fixture cases (no network)
  --mutants                  run every planted defect against the self-test (no network); each must turn it red
  --repo OWNER/NAME          default: GITHUB_REPOSITORY, else the origin remote, else ${DEFAULT_REPO}
  --base BRANCH              default: the repository's default branch
  --declared-live LIST       PRs a person knows are being pushed to now: 1559,1585:worker B87
  --declared-live-file FILE  the same as JSON ({"1559":"note"}, [1559], or [{"pr":1559,"note":"..."}])
  --threads-file FILE        exact review-thread counts read elsewhere: {"1321":{"total":79,"unresolved":73}}
  --repo-dir DIR             a checkout used for mainline ancestry (default: this one)
  --no-local-git             never run git; the REST compare endpoint answers ancestry
  --now ISO                  the instant ages are measured from (default: the clock)
  --concurrency N            parallel PR reads (default 6)
  --allow-count-drift        accept a queue that kept moving while it was read, with a warning

Reads with GH_TOKEN or GITHUB_TOKEN. Exit 0 report printed, 1 self-test failed, 2 token/auth/usage/rate limit,
3 inconsistent read, 4 --snapshot could not be written. It never merges, approves, comments, closes or deletes.`;

function originRepo(io, dir) {
  try {
    const r = io.gitExec(["-C", dir, "remote", "get-url", "origin"]);
    const m = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(r.stdout.trim());
    return r.status === 0 && m ? m[1] : null;
  } catch { return null; }
}

export function parseArgs(argv, io) {
  const o = {
    json: false, markdown: false, snapshot: null, selfTest: false, mutants: false, help: false,
    repo: null, base: null, declared: new Map(), threadsFile: new Map(), repoDir: REPO_ROOT,
    noLocalGit: false, now: null, concurrency: 6, allowCountDrift: false, classify: null,
  };
  let declaredList = null;
  let declaredFile = null;
  let threadsPath = null;
  const need = (i, flag) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new ToolError(`${flag} needs a value\n${USAGE}`, 2);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--json": o.json = true; break;
      case "--markdown": o.markdown = true; break;
      case "--self-test": o.selfTest = true; break;
      case "--mutants": o.mutants = true; break;
      case "--help": case "-h": o.help = true; break;
      case "--no-local-git": o.noLocalGit = true; break;
      case "--allow-count-drift": o.allowCountDrift = true; break;
      case "--snapshot": o.snapshot = need(i++, a); break;
      case "--classify": {
        const v = need(i++, a);
        if (!/^[1-9]\d{0,8}$/.test(v)) throw new ToolError(`--classify wants a pull request number, not "${v}"`, 2);
        o.classify = Number(v);
        break;
      }
      case "--repo": o.repo = need(i++, a); break;
      case "--base": o.base = need(i++, a); break;
      case "--declared-live": declaredList = need(i++, a); break;
      case "--declared-live-file": declaredFile = need(i++, a); break;
      case "--threads-file": threadsPath = need(i++, a); break;
      case "--repo-dir": o.repoDir = resolve(need(i++, a)); break;
      case "--now": {
        const v = need(i++, a);
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) throw new ToolError(`--now: "${v}" is not a date`, 2);
        o.now = d;
        break;
      }
      case "--concurrency": {
        const n = Number(need(i++, a));
        if (!Number.isInteger(n) || n < 1 || n > 16) throw new ToolError("--concurrency wants an integer from 1 to 16", 2);
        o.concurrency = n;
        break;
      }
      default: throw new ToolError(`unknown option ${a}\n${USAGE}`, 2);
    }
  }
  if (o.json && o.markdown) throw new ToolError("--json and --markdown are exclusive", 2);
  if (o.classify !== null && (o.json || o.markdown || o.snapshot || o.selfTest || o.mutants)) throw new ToolError("--classify prints one line about one PR: it cannot be combined with --json, --markdown, --snapshot, --self-test or --mutants", 2);
  const read = (p, flag) => {
    try { return io.readText(resolve(p)); } catch (e) { throw new ToolError(`${flag}: cannot read ${p} (${e.code ?? e.message})`, 2); }
  };
  o.declared = parseDeclared(declaredList, declaredFile ? read(declaredFile, "--declared-live-file") : undefined);
  o.threadsFile = parseThreadsFile(threadsPath ? read(threadsPath, "--threads-file") : undefined);
  if (!o.repo) o.repo = io.env.GITHUB_REPOSITORY || originRepo(io, o.repoDir) || DEFAULT_REPO;
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) throw new ToolError(`--repo: "${o.repo}" is not OWNER/NAME`, 2);
  return o;
}

const defaultIo = () => ({
  env: process.env,
  fetchImpl: globalThis.fetch,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  gitExec: realGitExec,
  readText: (p) => readFileSync(p, "utf8"),
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
});

/** The CLI body. Returns the exit code; never calls process.exit, so the self-test can run it. */
export async function main(argv, io = defaultIo()) {
  let opts;
  try {
    opts = parseArgs(argv, io);
  } catch (e) {
    if (!(e instanceof ToolError)) throw e;
    io.stderr(`backlog-triage: ${e.message}\n`);
    return e.exitCode;
  }
  if (opts.help) { io.stdout(`${USAGE}\n`); return 0; }
  if (opts.selfTest) return runSelfTest(io);
  if (opts.mutants) return runMutants(io);
  if (opts.classify !== null) return runClassify(opts, io);
  try {
    const report = await collectReport(opts, io);
    io.stdout(opts.json ? `${JSON.stringify(report, null, 2)}\n` : `${renderMarkdown(report)}\n`);
    if (opts.snapshot) {
      writeSnapshot(opts.snapshot, renderSnapshot(report));
      io.stderr(`backlog-triage: snapshot written between the markers in ${opts.snapshot}\n`);
    }
    return 0;
  } catch (err) {
    // A read the whole queue depends on that GitHub refused or that failed after retries (a 403 that
    // is not a rate limit, a 404, a persistent 5xx) is a refusal with a message, not an "unexpected
    // failure": 401/403/404 are the token's access (exit 2), the rest an inconsistent read (exit 3).
    // Reads of one PR's details are guarded per PR and never reach here.
    const e = err instanceof ApiError
      ? new ToolError(`GitHub refused or failed a read the whole queue depends on, so there is no queue to report: ${err.message}`, [401, 403, 404].includes(err.status) ? 2 : 3)
      : err;
    if (!(e instanceof ToolError)) throw e;
    io.stderr(`backlog-triage: ${e.message}\n`);
    if (opts.snapshot && e.exitCode !== 4) {
      try {
        const stamp = (opts.now ?? io.now()).toISOString();
        const r = writeSnapshot(opts.snapshot, `not generated here: ${e.message.replace(/\s+/g, " ")} (attempted ${stamp})`, { keepIfRealWhenNotGenerated: true });
        io.stderr(r.kept ? `backlog-triage: ${opts.snapshot} already holds a dated snapshot; left as it was\n` : `backlog-triage: ${opts.snapshot} now says "not generated here"\n`);
      } catch (w) {
        io.stderr(`backlog-triage: ${w.message}\n`);
      }
    }
    return e.exitCode;
  }
}

/** Node's fetch ignores HTTPS_PROXY unless asked; behind the agent proxy that is a silent hang. */
function reexecForProxy() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy || process.env.NODE_USE_ENV_PROXY || process.env.SGBT_REEXEC) return;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (!(maj > 22 || (maj === 22 && min >= 21))) return;
  const r = spawnSync(process.execPath, ["--disable-warning=UNDICI-EHPA", ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1", SGBT_REEXEC: "1" },
  });
  process.exit(r.status ?? 1);
}

// ── planted defects: --mutants ───────────────────────────────────────────────────────────
//
// A self-test that passes proves nothing until a broken tool fails it. Each row of the table
// below is one defect: `find` is text that occurs exactly once in `file` (the tool's source,
// the skill, or the page) outside the table, `replace` is what it becomes. `--mutants` writes
// each mutated copy to a temporary directory, runs its --self-test, and demands RED (exit 1 and a
// "self-test FAILED" report); a copy that passes SURVIVED, one that crashes is BROKEN, a row
// whose `find` no longer occurs once DOES-NOT-APPLY, and any of those exits 1. A row with a `red`
// string (every P row has one) must turn red in a case whose name holds that string: red anywhere
// else is WRONG-RED, not a kill. The normal self-test also checks that every row still applies,
// so the table cannot rot unseen.
// Nothing here touches the checkout: the copies live in a directory this function removes.

const MUT_BEGIN = "// >>> mutants" + "-begin";
const MUT_END = "// <<< mutants" + "-end";

/** The source with the mutant table cut out: the table holds the very text it mutates, and a
 *  write verb among it, so every scan of the source reads around the table. */
function withoutMutantTable(text) {
  const a = text.indexOf(MUT_BEGIN);
  const b = text.indexOf(MUT_END);
  return a >= 0 && b > a ? text.slice(0, a) + text.slice(b + MUT_END.length) : text;
}

// What the tool may write to disk. The names are built from parts so this source never holds
// the very token the scan looks for, and so the scan reads the whole file, not around itself.
const FS_WRITE_CALLS = ["writeFile", "appendFile", "rename", "copyFile", "cp", "mkdir", "mkdtemp", "rm", "rmdir", "unlink", "truncate", "symlink", "link", "open", "write", "chmod", "chown", "utimes"].map((n) => `${n}Sync`).concat(["create" + "WriteStream"]);
const FS_WRITE_RE = new RegExp(`\\b(${FS_WRITE_CALLS.join("|")})\\b`, "g");
/** Where `text` calls a file-writing function: { top-level name -> sorted distinct calls }, imports under "<import>". */
export function fsWriteSites(text) {
  const out = {};
  let cur = "<top>";
  for (const line of String(text).split("\n")) {
    let name;
    if (/^import\s/.test(line)) name = "<import>";
    else {
      const d = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/.exec(line) ?? /^(?:export\s+)?(?:const|let|var|class)\s+(\w+)/.exec(line);
      if (d) cur = d[1];
      name = cur;
    }
    for (const m of line.matchAll(FS_WRITE_RE)) (out[name] ??= new Set()).add(m[1].replace(/Sync$/, ""));
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, [...out[k]].sort()]));
}
/** The writes this tool is reviewed to make: the snapshot page, the --mutants copies, the self-test's own temp pages. */
const EXPECTED_FS_WRITES = {
  "<import>": ["mkdtemp", "rename", "rm", "writeFile"],
  runMutants: ["mkdtemp", "rm", "writeFile"],
  runSelfTest: ["mkdtemp", "rm", "writeFile"],
  writeSnapshot: ["rename", "writeFile"],
};
const importsOf = (text) => [...String(text).matchAll(/^import\s[^;]*?\sfrom\s+"([^"]+)";/gm)]
  .map((m) => (/\/check-owner-gated-surfaces\.mjs$/.test(m[1]) ? "./check-owner-gated-surfaces.mjs" : m[1])) // the --mutants copy imports it by file URL
  .sort();
/** Model-family words and a versioned model name: the skill, the page and this file use tier words instead. */
const MODEL_WORDS_RE = new RegExp(`\\b(?:${["Hai" + "ku", "Son" + "net", "Op" + "us", "Fa" + "ble", "Myth" + "os"].join("|")})\\b|\\bClaude \\d`);

/** Every relative module specifier (./ or ../) a script names with a string literal: static imports and
 *  re-exports (one line or many, starting a line), side-effect imports, dynamic imports and require calls. A specifier built
 *  at run time is not seen. Text inside a string that starts a line like an import is read as one (a false gap, the
 *  strict direction); the same text in the middle of a line is not. */
const RELATIVE_IMPORT_RES = [
  /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom\s*["']([^"']+)["']/gm,
  /^[ \t]*import\s*["']([^"']+)["']/gm,
  /(?:^|[\s(=,:;!&|?])(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/gm,
];
export function relativeImports(text) {
  const out = new Set();
  for (const re of RELATIVE_IMPORT_RES) for (const m of String(text).matchAll(re)) if (/^\.\.?\//.test(m[1])) out.add(m[1]);
  return [...out].sort();
}
const MODULE_EXTS = [".mjs", ".js", ".cjs", ".ts", ".mts", ".cts", ".json"];
const isScript = (p) => /\.[cm]?[jt]s$/.test(p) && !/\.d\.[cm]?ts$/.test(p);
/** The relative imports of every script in `roots`, followed through the files they import: each target must
 *  be a tracked file and must itself be owner-named (`named`), because code an owner-named gate imports decides
 *  what the gate does. Returns the gaps, every file visited and every edge followed. */
export function ownerNamedImportGaps({ roots, tracked, read, named = (p) => classifyFiles([{ filename: p }]).ownerNamed.length > 0 }) {
  const gaps = [];
  const edges = [];
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const from = queue.shift();
    if (seen.has(from)) continue;
    seen.add(from);
    let source;
    try { source = read(from); } catch (e) { gaps.push({ from, spec: "", target: from, why: `cannot be read (${e?.code ?? "error"})` }); continue; }
    for (const spec of relativeImports(source)) {
      const base = posix.normalize(posix.join(posix.dirname(from), spec));
      const target = [base, ...MODULE_EXTS.map((e) => base + e), ...MODULE_EXTS.map((e) => `${base}/index${e}`)].find((c) => tracked.has(c));
      if (!target) { gaps.push({ from, spec, target: base, why: "does not resolve to a tracked file" }); continue; }
      edges.push(`${from} -> ${target}`);
      if (!named(target)) gaps.push({ from, spec, target, why: "is not owner-named" });
      if (isScript(target)) queue.push(target);
    }
  }
  return { gaps, visited: [...seen].sort(), edges: edges.sort() };
}

/** Apply one row to `texts` = { src, skill, page }. Never applies a row that is ambiguous or inert. */
function applyMutant(m, texts) {
  const target = m.file ?? "src";
  const text = texts[target];
  if (typeof text !== "string" || typeof m.find !== "string" || m.find === "") return { ok: false, why: `no ${target} text, or an empty find` };
  if (m.find === m.replace) return { ok: false, why: "replace equals find" };
  const a = target === "src" ? text.indexOf(MUT_BEGIN) : -1;
  const b = target === "src" ? text.indexOf(MUT_END) + MUT_END.length : -1;
  const spans = a >= 0 ? [[0, a], [b, text.length]] : [[0, text.length]];
  const hits = [];
  for (const [from, to] of spans) {
    for (let i = text.indexOf(m.find, from); i >= 0 && i + m.find.length <= to; i = text.indexOf(m.find, i + m.find.length)) hits.push(i);
  }
  if (hits.length !== 1) return { ok: false, why: `the find text occurs ${hits.length} times in ${target} (want exactly 1)` };
  return { ok: true, target, text: text.slice(0, hits[0]) + m.replace + text.slice(hits[0] + m.find.length) };
}

const readTexts = () => ({ src: readFileSync(SELF_FILE, "utf8"), skill: readFileSync(SKILL_FILE, "utf8"), page: readFileSync(PAGE_FILE, "utf8") });

function runMutants(io) {
  const texts = readTexts();
  const dir = mkdtempSync(join(tmpdir(), "sgbt-mut-"));
  const rows = [];
  // the copy runs from a temporary directory: point its three path anchors back at this checkout
  const swap = (code, from, to) => {
    const i = code.indexOf(from);
    if (i < 0 || code.indexOf(from, i + 1) !== -1) throw new ToolError(`--mutants: cannot prepare the runnable copy (anchor not found exactly once: ${from.slice(0, 60)})`, 1);
    return code.slice(0, i) + to + code.slice(i + from.length);
  };
  try {
    for (const m of MUTANTS) {
      const applied = applyMutant(m, texts);
      if (!applied.ok) { rows.push({ id: m.id, what: m.what, verdict: "DOES-NOT-APPLY", detail: applied.why }); continue; }
      const files = { ...texts, [applied.target]: applied.text };
      const skillCopy = join(dir, "SKILL.md");
      const pageCopy = join(dir, "PAGE.md");
      const copy = join(dir, "backlog-triage.mjs");
      writeFileSync(skillCopy, files.skill);
      writeFileSync(pageCopy, files.page);
      let code = files.src;
      code = swap(code, "import { classifyDiff } from " + '"./check-owner-gated-surfaces.mjs";', `import { classifyDiff } from ${JSON.stringify(pathToFileURL(join(dirname(SELF_FILE), "check-owner-gated-surfaces.mjs")).href)};`);
      code = swap(code, "const REPO_ROOT = " + 'resolve(dirname(SELF_FILE), "..");', `const REPO_ROOT = ${JSON.stringify(REPO_ROOT)};`);
      code = swap(code, "const SKILL_FILE = " + 'resolve(REPO_ROOT, ".claude/skills/backlog-landing/SKILL.md");', `const SKILL_FILE = ${JSON.stringify(skillCopy)};`);
      code = swap(code, "const PAGE_FILE = " + 'resolve(REPO_ROOT, "docs/agent/BACKLOG_LANDING.md");', `const PAGE_FILE = ${JSON.stringify(pageCopy)};`);
      writeFileSync(copy, code);
      const r = spawnSync(process.execPath, [copy, "--self-test"], { encoding: "utf8", timeout: 120_000, env: { ...process.env, SGBT_MUTANT: "1", GH_TOKEN: "", GITHUB_TOKEN: "" } });
      const out = `${r.stdout ?? ""}`;
      if (r.status === 0) rows.push({ id: m.id, what: m.what, verdict: "SURVIVED", detail: "the self-test still passed" });
      else if (r.status === 1 && /self-test FAILED/.test(out)) {
        const fails = out.split("\n").filter((l) => l.startsWith("  FAIL ")).map((l) => l.replace(/^ {2}FAIL /, ""));
        // a row that names the case it was written for is killed only by THAT case: any other red (a
        // broken copy, an unrelated check) would let a defect nothing tests pass as "killed"
        const hit = typeof m.red === "string" ? fails.find((f) => f.includes(m.red)) : fails[0];
        if (hit === undefined) rows.push({ id: m.id, what: m.what, verdict: "WRONG-RED", detail: `red, but not in the case it was written for (${JSON.stringify(m.red)}); first red: ${fails[0] ?? ""}`.slice(0, 220) });
        else rows.push({ id: m.id, what: m.what, verdict: "killed", detail: hit.slice(0, 110) });
      } else rows.push({ id: m.id, what: m.what, verdict: "BROKEN", detail: `exit ${r.status}: ${String(r.stderr ?? "").split("\n").find(Boolean) ?? out.split("\n")[0]}`.slice(0, 160) });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const r of rows) io.stdout(`${r.verdict === "killed" ? "  killed  " : `  ${r.verdict.padEnd(8)}`} ${r.id}  ${r.what}${r.verdict === "killed" ? ` - first red: ${r.detail}` : ` - ${r.detail}`}\n`);
  const killed = rows.filter((r) => r.verdict === "killed").length;
  if (killed !== rows.length) {
    io.stdout(`backlog-triage mutants FAILED: ${killed}/${rows.length} planted defects killed\n`);
    return 1;
  }
  io.stdout(`backlog-triage mutants: ${killed}/${killed} planted defects killed by the self-test\n`);
  return 0;
}

// >>> mutants-begin
const MUTANTS = [
  { id: "M01", file: "src", what: "a write verb reaches the API",
    find: "fetchImpl(url, { method: \"GET\", headers })",
    replace: "fetchImpl(url, { method: \"POST\", headers })" },
  { id: "M02", file: "src", what: "DECISION_PATH and OWNER_RESERVED diffs stop being OWNER-MERGE",
    find: "if (hard.length) return",
    replace: "if (false && hard.length) return" },
  { id: "M03", file: "src", what: "owner-named surfaces stop holding a PR",
    find: "if (f.ownerNamed.length) return",
    replace: "if (false && f.ownerNamed.length) return" },
  { id: "M04", file: "src", what: "a draft is landable",
    find: "if (f.draft) b.push",
    replace: "if (false) b.push" },
  { id: "M05", file: "src", what: "the gating check is not required",
    find: "if (c.gating.state !== \"success\") b.push",
    replace: "if (false) b.push" },
  { id: "M06", file: "src", what: "a conflicting PR is landable",
    find: "if (f.conflicting === true) b.push",
    replace: "if (false) b.push" },
  { id: "M07", file: "src", what: "a stacked PR is landable",
    find: "if (f.base !== baseName) b.push",
    replace: "if (false) b.push" },
  { id: "M08", file: "src", what: "IN-FLIGHT is never assigned",
    find: "if (ctx.declared.has(f.number)) {",
    replace: "if (false) {" },
  { id: "M09", file: "src", what: "an ancestor head is not SUPERSEDED",
    find: "if (f.ancestor === true) {",
    replace: "if (false) {" },
  { id: "M10", file: "src", what: "STALE starts at exactly 14 days",
    find: "if (f.idleDays > STALE_DAYS) {",
    replace: "if (f.idleDays >= STALE_DAYS) {" },
  { id: "M11", file: "src", what: "advisory checks make a PR red",
    find: "const isRedName = (n) => n === GATING_CHECK || MAC_ONLY_CHECK_RE.test(n) || isCodeQL(n);",
    replace: "const isRedName = () => true;" },
  { id: "M12", file: "src", what: "a heuristic review thread stops blocking LAND",
    find: "} else if (f.threads.roots > 0) {",
    replace: "} else if (false) {" },
  { id: "M13", file: "src", what: "the body need not quote preflight and breadth",
    find: "if (!f.quotesGates) b.push",
    replace: "if (false) b.push" },
  { id: "M14", file: "src", what: "native client suites are not required",
    find: "if (c.native.length === 0) b.push",
    replace: "if (false) b.push" },
  { id: "M15", file: "src", what: "open-list counts are not cross-checked (an empty page is an empty queue)",
    find: "if (prs.length === prEntries && all.length === expected) return",
    replace: "if (true) return" },
  { id: "M16", file: "src", what: "listAll stops at an empty page, not a short one",
    find: "if (rows.length < perPage) return out;",
    replace: "if (rows.length === 0) return out;" },
  { id: "M17", file: "src", what: "an anonymous answer is accepted",
    find: "if (core.limit <= 60) {",
    replace: "if (false) {" },
  { id: "M18", file: "src", what: "an empty token is not missing",
    find: "if (t === \"\") return",
    replace: "if (false) return" },
  { id: "M19", file: "src", what: "a 401 is not fatal",
    find: "if (res.status === 401) {",
    replace: "if (res.status === 4010) {" },
  { id: "M20", file: "src", what: "a rate limit is not fatal",
    find: "if (remaining === \"0\" || retryAfter || res.status === 429 || /rate limit|abuse/i.test(text)) {",
    replace: "if (false) {" },
  { id: "M21", file: "src", what: "the file list is never checked against changed_files",
    find: "f.filesComplete = f.filesExpected === null ? false : f.files.length === f.filesExpected;",
    replace: "f.filesComplete = true;" },
  { id: "M22", file: "src", what: "a missing changed_files count is a complete file list (O7)",
    find: "f.filesComplete = f.filesExpected === null ? false :",
    replace: "f.filesComplete = f.filesExpected === null ? true :" },
  { id: "M23", file: "src", what: "the check-runs total_count cross-check is removed (O8)",
    find: "if (runs.length < total) throw",
    replace: "if (false) throw" },
  { id: "M24", file: "src", what: "a failed or running Mac-only check does not block (O9)",
    find: "if (c.macOnly.state !== \"absent\" && c.macOnly.state !== \"success\") b.push",
    replace: "if (false) b.push" },
  { id: "M25", file: "src", what: "a removed tick file counts as rewritten (O18)",
    find: "if (file.status === \"removed\") { all = false; evidence.push(",
    replace: "if (file.status === \"removed\") { evidence.push(" },
  { id: "M26", file: "src", what: "an uncomputed mergeable_state is never read again",
    find: "round <= 3; round++",
    replace: "round <= 0; round++" },
  { id: "M27", file: "src", what: "compare status 'behind' is not read as an ancestor",
    find: "if (c?.status === \"identical\" || c?.status === \"behind\") return true;",
    replace: "if (c?.status === \"identical\") return true;" },
  { id: "M28", file: "src", what: "a shallow checkout's 'no' is conclusive",
    find: "if (r.status === 1 && !info.shallow && info.current) return false;",
    replace: "if (r.status === 1) return false;" },
  { id: "M29", file: "src", what: "--snapshot accepts a page with duplicate markers",
    find: "if (begins.length !== 1 || ends !== 1) throw",
    replace: "if (false) throw" },
  { id: "M30", file: "src", what: "a failed run erases a real snapshot",
    find: "if (keepIfRealWhenNotGenerated && current !== \"\" && !/^not generated here:/m.test(current)) {",
    replace: "if (false) {" },
  { id: "M31", file: "src", what: "PRUNABLE ignores a moved branch tip",
    find: "} else if (merged[0].headSha === tip) {",
    replace: "} else if (true) {" },
  { id: "M32", file: "src", what: "duplicate issue titles are case-sensitive",
    find: ".trim().toLowerCase();",
    replace: ".trim();" },
  { id: "M33", file: "src", what: "a fork PR takes its branch prefix's lane",
    find: "lane: item.head?.repo?.full_name === repo ? laneOf(item.head?.ref) : \"other\",",
    replace: "lane: laneOf(item.head?.ref)," },
  { id: "M34", file: "src", what: "Dependabot PRs are landable",
    find: "if (f.lane === \"dependabot\") return { cls: \"OWNER-MERGE\"",
    replace: "if (false) return { cls: \"OWNER-MERGE\"" },
  { id: "M35", file: "src", what: "PRs from branches no lane owns are landable",
    find: "if (f.lane === \"other\") return { cls: \"OWNER-MERGE\"",
    replace: "if (false) return { cls: \"OWNER-MERGE\"" },
  { id: "M36", file: "src", what: "a rename's old path is not classified",
    find: "if (f.previous) names.push(f.previous);",
    replace: "if (false) names.push(f.previous);" },
  { id: "N01", file: "src", what: "review comments are never checked against the PR's review_comments (finding 3)",
    find: "else if (comments.length !== f.commentsExpected) f.errors.comments =",
    replace: "else if (false) f.errors.comments =" },
  { id: "N02", file: "src", what: "only a SHORT comment list is an error (finding 3)",
    find: "comments.length !== f.commentsExpected",
    replace: "comments.length < f.commentsExpected" },
  { id: "N03", file: "src", what: "a missing review_comments count is not reported as such (finding 3)",
    find: "if (f.commentsExpected === null) f.errors.comments =",
    replace: "if (false) f.errors.comments =" },
  // N04 (the skill's jq drops previous_filename) is gone with the pipeline: the skill calls --classify, and the same defect in the tool is P38.
  { id: "N05", file: "src", what: "a body ask lands a mac/* PR (finding 5)",
    find: "    if (/^mac\\/tick-/.test(f.headRef)) ev.push(TICK_NOTE);\n",
    replace: "    if (/^mac\\/tick-/.test(f.headRef)) ev.push(TICK_NOTE);\n    if (f.ask && blockers.length === 0) return out(\"LAND-UNDER-DR-037\", nat.why, ev);\n" },
  { id: "N06", file: "src", what: "the ask detector reads sentences about other PRs or the rule as asks (finding 5)",
    find: "if (/#\\d+|\\b(?:its|their|own|other|others|any|every|all|each|a|an|PRs|pull requests)\\b/i.test(after)) continue;",
    replace: "" },
  { id: "N07", file: "src", what: "the ask detector needs no object (finding 5)",
    find: "if (thisPr || onItsCi) return true;",
    replace: "return true;" },
  { id: "N08", file: "src", what: "a negated sentence is an ask",
    find: "if (/\\b(not|never|no|cannot|can't|won't|don't|do not|without)\\b|n't\\b/i.test(s)) continue;",
    replace: "" },
  { id: "N09", file: "src", what: "fenced code is read as the PR's own words",
    find: ".replace(/```[\\s\\S]*?```/g, \" \")",
    replace: "" },
  { id: "N10", file: "skill", what: "the skill has no step that confirms the mail ask (finding 5)",
    find: "artifacts/lane-messages/mac-*.json",
    replace: "artifacts/lane-messages/README.md" },
  { id: "N11", file: "src", what: "the mailbox block is skipped (finding 6)",
    find: "  if (f.lane === \"lane\" && f.headRef === mailboxBranch) {\n    if (ctx.standing",
    replace: "  if (false && f.lane === \"lane\" && f.headRef === mailboxBranch) {\n    if (ctx.standing" },
  { id: "N12", file: "src", what: "any empty draft on the mailbox branch is STANDING (finding 6)",
    find: "if (ctx.standing && f.number === ctx.standing.pr && f.draft",
    replace: "if (ctx.standing && f.draft" },
  { id: "N13", file: "src", what: "no mailbox fallback when lane-mailbox.json is unreadable (finding 6)",
    find: "ctx.standing?.branch ?? MAILBOX_BRANCH;",
    replace: "ctx.standing?.branch ?? \"\";" },
  { id: "N14", file: "src", what: "the mailbox branch has a natural class (finding 6)",
    find: "if (f.lane === \"lane\" && f.headRef === mailboxBranch) return { cls: null,",
    replace: "if (false) return { cls: null," },
  { id: "N15", file: "src", what: "the OLDEST run of a check name is the verdict (finding 7)",
    find: "if (a > b || (a === b && rank(r) > rank(cur))) latest.set(r.name, r);",
    replace: "if (a < b || (a === b && rank(r) > rank(cur))) latest.set(r.name, r);" },
  { id: "N16", file: "src", what: "an id tie keeps the better state (finding 7)",
    find: "(a === b && rank(r) > rank(cur))",
    replace: "(a === b && rank(r) < rank(cur))" },
  { id: "N17", file: "src", what: "every run counts, not the newest per check name (finding 7)",
    find: "const current = latestByName(runs);",
    replace: "const current = runs;" },
  { id: "N18", file: "src", what: "a short branch page is accepted (finding 8)",
    find: "if (branchList.length < branchTotal) throw",
    replace: "if (false) throw" },
  { id: "N19", file: "src", what: "the Link header's last page is not read (finding 8)",
    find: "if (last) return Number(last[1]);",
    replace: "if (last) return 0;" },
  { id: "N20", file: "src", what: "the checkout's absolute path is printed (finding 11)",
    find: "const where = opts.repoDir === REPO_ROOT ? \"this checkout\" : \"the --repo-dir checkout\";",
    replace: "const where = `checkout ${opts.repoDir}`;" },
  { id: "N21", file: "src", what: "a refused read is an unexpected failure (finding 12)",
    find: "const e = err instanceof ApiError",
    replace: "const e = err instanceof Array" },
  { id: "N22", file: "src", what: "a 403 that is not a rate limit exits 3 (finding 12)",
    find: "to report: ${err.message}`, [401, 403, 404].includes(err.status) ? 2 : 3",
    replace: "to report: ${err.message}`, [401, 404].includes(err.status) ? 2 : 3" },
  { id: "N23", file: "src", what: "a tick PR's row does not say why the stricter reading holds (finding 10)",
    find: "if (/^mac\\/tick-/.test(f.headRef)) ev.push(TICK_NOTE);",
    replace: "" },
  { id: "N24", file: "src", what: "a tick PR is not a mac/* PR (finding 10)",
    find: "if (r.startsWith(\"mac/\")) return \"mac\";",
    replace: "if (r.startsWith(\"mac/\") && !r.startsWith(\"mac/tick-\")) return \"mac\";" },
  { id: "N25", file: "src", what: "the publication boundary is not an owner-named surface (finding 1)",
    find: "{ rule: \"publication boundary\", re: /(^|\\/)(check-)?publication[-_]boundary",
    replace: "{ rule: \"publication boundary\", re: /(^|\\/)(check-)?publication[-_]boundaryX" },
  { id: "N26", file: "skill", what: "the skill does not say this PR is the owner's (finding 1)",
    find: "this PR is the owner's, by the tool's rule",
    replace: "this PR can be landed" },
  { id: "N27", file: "page", what: "the page does not say this PR is the owner's (finding 1)",
    find: "this PR is the owner's, by the tool's rule",
    replace: "this PR can be landed" },
  { id: "P01", file: "src", what: "the launch-profile pattern forgets .mts, .cts and .d.mts (finding 1)",
    find: "launch[-_]profile[\\w.-]*\\.([cm]?[jt]s|json)$/i",
    replace: "launch[-_]profile[\\w.-]*\\.(mjs|ts|js|json)$/i", red: "every module extension" },
  { id: "P02", file: "src", what: "the launch-claims pattern forgets .mts and .cts (finding 1)",
    find: "launch[-_]claims[\\w.-]*\\.([cm]?[jt]s|json)$/i",
    replace: "launch[-_]claims[\\w.-]*\\.(mjs|ts|js|json)$/i", red: "every module extension" },
  { id: "P03", file: "src", what: "the launch-proof-bindings pattern forgets .mts and .cts (finding 1)",
    find: "launch[-_]proof[-_]bindings[\\w.-]*\\.([cm]?[jt]s|json)$/i",
    replace: "launch[-_]proof[-_]bindings[\\w.-]*\\.(mjs|ts|js|json)$/i", red: "every module extension" },
  { id: "P04", file: "src", what: "the publication-boundary pattern forgets .mts and .cts (finding 1)",
    find: "publication[-_]boundary[\\w.-]*\\.([cm]?[jt]s|json|md)$/i",
    replace: "publication[-_]boundary[\\w.-]*\\.(mjs|ts|js|json|md)$/i", red: "every module extension" },
  { id: "P05", file: "src", what: "the owner-named list is judged on a renamed file's new path only (K04)",
    find: "for (const n of uniqSorted(names)) {",
    replace: "for (const n of uniqSorted(files.map((f) => f.filename))) {", red: "renamed away from an owner-named gate" },
  { id: "P06", file: "src", what: "the native-path test looks at a renamed file's new path only (K05)",
    find: "touchesNative: names.some((n) => NATIVE_PATH_RE.test(n)),",
    replace: "touchesNative: files.some((f) => NATIVE_PATH_RE.test(f.filename)),", red: "renamed out of native" },
  { id: "P07", file: "src", what: "the mailbox branch named in lane-mailbox.json is ignored (K11)",
    find: "const mailboxBranch = ctx.standing?.branch ?? MAILBOX_BRANCH;",
    replace: "const mailboxBranch = MAILBOX_BRANCH;", red: "the mailbox branch is the one lane-mailbox.json names" },
  { id: "P08", file: "src", what: "a PR that reports 0 review comments is never listed (K02)",
    find: "const comments = await guard(\"comments\", () => listAll(",
    replace: "const comments = f.commentsExpected === 0 ? [] : await guard(\"comments\", () => listAll(", red: "reports 0 review comments but whose list holds 2" },
  { id: "P09", file: "src", what: "the checkout's path is printed when local git cannot be used (K19)",
    find: "localNote = `not used (${p.reason})`;",
    replace: "localNote = `not used (${p.reason}) in ${opts.repoDir}`;", red: "not a git checkout the ancestry line" },
  { id: "P10", file: "src", what: "the text of a git exception is printed (it can hold the checkout's path)",
    find: "reason: `git unavailable (${e?.code ?? \"error\"})`",
    replace: "reason: `git unavailable: ${e?.message ?? e}`", red: "when running git throws" },
  { id: "P11", file: "src", what: "STANDING does not need the PR to have no files (K09)",
    find: "f.filesComplete && f.files.length === 0) {",
    replace: "f.filesComplete) {", red: "draft that carries a file" },
  { id: "P12", file: "src", what: "STANDING does not need the PR to be a draft (K10)",
    find: "f.number === ctx.standing.pr && f.draft &&",
    replace: "f.number === ctx.standing.pr &&", red: "marked ready with no files" },
  { id: "P13", file: "src", what: "STANDING does not need the file list to be read in full",
    find: "&& f.draft && f.filesComplete &&",
    replace: "&& f.draft &&", red: "could not be read in full (0 listed of 2)" },
  { id: "P14", file: "src", what: "the closed-PR count guard is removed (K16)",
    find: "if (closed.length < closedTotal) throw",
    replace: "if (false) throw", red: "short closed-PR page" },
  { id: "P15", file: "src", what: "the default-branch guard on the branch listing is removed (K17)",
    find: "if (!branchList.some((b) => b.name === base)) throw",
    replace: "if (false) throw", red: "does not contain the default branch" },
  { id: "P16", file: "src", what: "an inconsistent read (exit 3) no longer stamps the snapshot page (K20)",
    find: "if (opts.snapshot && e.exitCode !== 4) {",
    replace: "if (opts.snapshot && e.exitCode === 2) {", red: "inconsistent read (exit 3)" },
  { id: "P17", file: "src", what: "a failed Mac-only check no longer counts as red (K12)",
    find: "const isRedName = (n) => n === GATING_CHECK || MAC_ONLY_CHECK_RE.test(n) || isCodeQL(n);",
    replace: "const isRedName = (n) => n === GATING_CHECK || isCodeQL(n);", red: "Mac-only check whose newest run failed" },
  { id: "P18", file: "src", what: "pending is read from every run, not the newest of each check name (K13)",
    find: "const pendingRuns = current.filter((r) => PENDING.has(stateOfRun(r)));",
    replace: "const pendingRuns = runs.filter((r) => PENDING.has(stateOfRun(r)));", red: "older run is still in progress" },
  { id: "P19", file: "src", what: "'never' no longer negates an ask (K07)",
    find: "\\b(not|never|no|",
    replace: "\\b(not|no|", red: "never later" },
  { id: "P20", file: "src", what: "'no' no longer negates an ask",
    find: "never|no|cannot",
    replace: "never|cannot", red: "no questions" },
  { id: "P21", file: "src", what: "'cannot' no longer negates an ask",
    find: "|cannot|can't",
    replace: "|can't", red: "the Mac cannot" },
  { id: "P22", file: "src", what: "'without' no longer negates an ask",
    find: "|do not|without)",
    replace: "|do not)", red: "without delay" },
  { id: "P23", file: "src", what: "'not' no longer negates an ask",
    find: "\\b(not|never",
    replace: "\\b(never", red: "not later" },
  { id: "P24", file: "src", what: "a check-runs envelope with no total_count is accepted (finding 3)",
    find: "if (typeof body.total_count !== \"number\") throw new ApiError(",
    replace: "if (false) throw new ApiError(", red: "no total_count" },
  { id: "P25", file: "src", what: "a base branch that cannot be read is assumed to be mainline (finding 3)",
    find: "base: baseRef(item.base?.ref),",
    replace: "base: item.base?.ref ?? base,", red: "base branch cannot be read" },
  { id: "P26", file: "src", what: "cancelled and stale count as verdicts of 'fine' (finding 3)",
    find: "const VERDICT_OK = new Set([\"success\", \"neutral\", \"skipped\"]);",
    replace: "const VERDICT_OK = new Set([\"success\", \"neutral\", \"skipped\", \"cancelled\", \"stale\"]);", red: "finished cancelled" },
  { id: "P27", file: "src", what: "a check with no verdict does not block (finding 3)",
    find: "if (nov.length) b.push(",
    replace: "if (false) b.push(", red: "finished cancelled" },
  { id: "P28", file: "src", what: "a missing Link header on a multi-page list is not noticed (finding 3)",
    find: "if (next.length > 0) throw new ToolError(",
    replace: "if (false) throw new ToolError(", red: "no Link header, on a list of 250" },
  { id: "P29", file: "src", what: "a count read that is not a list is counted as zero (finding 3)",
    find: "if (!Array.isArray(r.json)) throw new ToolError(`${path}: the per_page=1 count read",
    replace: "if (false) throw new ToolError(`${path}: the per_page=1 count read", red: "not a list at all" },
  { id: "P30", file: "src", what: "a run writes a file beside the tool (finding 6)",
    find: "const authSummary = ",
    replace: "writeFileSync(join(dirname(SELF_FILE), \"wrote-this-file\"), \"x\"); const authSummary = ", red: "writes to disk only in" },
  { id: "P31", file: "skill", what: "the skill quotes a backlog row title that does not exist (finding 5)",
    find: "label lookup that returns nothing opens a second",
    replace: "lookup that returns nothing during a GitHub incident opens a duplicate", red: "backlog row title the skill quotes" },
  { id: "P32", file: "skill", what: "the skill names a model family again (finding 4)",
    find: "the judgment tier refutes",
    replace: "Op" + "us refutes", red: "name no model" },
  { id: "P33", file: "page", what: "the page does not say what a squash-merge message can leave out (finding 4)",
    find: "squash-merge message",
    replace: "merge message", red: "squash-merge message" },
  { id: "P34", file: "skill", what: "the skill does not say a check with no verdict blocks LAND (finding 3)",
    find: "no verdict",
    replace: "no color", red: "say a check with no verdict" },
  // Round 4. Q05 (the skill's jq that dropped the old path) no longer exists: the skill calls --classify, and the same
  // defect in the tool is P38. Q15 (the oldest Mac-only run is picked) is P49. Nothing here is argued equivalent.
  { id: "P35", file: "src", what: "--classify accepts an empty file list (MEDIUM 1)",
    find: "if (files.length === 0) throw new ApiError(",
    replace: "if (false) throw new ApiError(", red: "on an empty file list" },
  { id: "P36", file: "src", what: "--classify accepts a list that does not match the PR's changed_files (MEDIUM 1)",
    find: "if (files.length !== expected) throw new ApiError(",
    replace: "if (false) throw new ApiError(", red: "on fewer files than the PR reports" },
  { id: "P37", file: "src", what: "--classify exits 0 after printing NOT CLASSIFIED (MEDIUM 1)",
    find: "return failure.exitCode;",
    replace: "return 0;", red: "prints NOT CLASSIFIED and exits non-zero" },
  { id: "P38", file: "src", what: "the file reader drops a renamed file's old path (Q05)",
    find: "previous: x.previous_filename ?? null }",
    replace: "previous: null }", red: "judges a file renamed out of lib/ on its old path" },
  { id: "P39", file: "skill", what: "the skill goes back to a pipeline of its own for the re-classify step (MEDIUM 1)",
    find: "node scripts/backlog-triage.mjs --classify <n>",
    replace: "gh api \"repos/{owner}/{repo}/pulls/<n>/files\" --paginate", red: "re-classifies through the tool's --classify mode" },
  { id: "P40", file: "src", what: "the ceiling reader is not owner-named (MEDIUM 2)",
    find: "ratchet-read[\\w.-]*\\.([cm]?[jt]s|json)$/i",
    replace: "ratchet-readX[\\w.-]*\\.([cm]?[jt]s|json)$/i", red: "changes only scripts/lib/ratchet-read.mjs" },
  { id: "P41", file: "src", what: "the import walk sees no imports (MEDIUM 2)",
    find: "for (const re of RELATIVE_IMPORT_RES) for (const m of String(text).matchAll(re))",
    replace: "for (const re of []) for (const m of String(text).matchAll(re))", red: "every relative import of every tracked owner-named script" },
  { id: "P42", file: "src", what: "the import walk follows ./ and not ../ (MEDIUM 2)",
    find: "if (/^\\.\\.?\\//.test(m[1])) out.add(m[1]);",
    replace: "if (/^\\.\\//.test(m[1])) out.add(m[1]);", red: "relativeImports reads static" },
  { id: "P43", file: "src", what: "a PR is a draft only when the detail says so (LOW 3)",
    find: "f.draft = item.draft === true || detail.draft === true || detail.mergeable_state === \"draft\";",
    replace: "f.draft = detail.draft === true;", red: "read as a draft: any of the three places is enough" },
  { id: "P44", file: "src", what: "mergeable_state draft does not make a PR a draft (LOW 3)",
    find: " || detail.mergeable_state === \"draft\";",
    replace: ";", red: "a PR with mergeable_state draft is a draft" },
  { id: "P45", file: "src", what: "a detail draft flag that is not a boolean is not a read error (LOW 3)",
    find: "if (typeof detail.draft !== \"boolean\") unread.push(",
    replace: "if (false) unread.push(", red: "a draft flag that is not a boolean" },
  { id: "P46", file: "src", what: "a list-item draft flag that is not a boolean is not a read error (LOW 3)",
    find: "if (typeof item.draft !== \"boolean\") unread.push(",
    replace: "if (false) unread.push(", red: "a PR whose list item leaves out the draft flag" },
  { id: "P47", file: "src", what: "a file entry with no filename is accepted (LOW 3)",
    find: "if (bad >= 0) throw new ApiError(",
    replace: "if (false) throw new ApiError(", red: "a file entry with no filename is a read error" },
  { id: "P48", file: "src", what: "the Mac-only verdict is the newest Mac-only run, whatever the others say (LOW 4)",
    find: "macOnly: shape(worstMac),",
    replace: "macOnly: shape(pick((r) => MAC_ONLY_CHECK_RE.test(r.name))),", red: "is not hidden by a newer passing Mac-only job of another name" },
  { id: "P49", file: "src", what: "among equal Mac-only states the OLDEST run is shown (Q15)",
    find: "macRank(b) - macRank(a) || (b.id ?? 0) - (a.id ?? 0)",
    replace: "macRank(b) - macRank(a) || (a.id ?? 0) - (b.id ?? 0)", red: "the newest of equal states" },
  { id: "P50", file: "src", what: "a root review comment counts only when in_reply_to_id is null, not when the key is absent (Q04)",
    find: "const roots = comments.filter((c) => c.in_reply_to_id == null);",
    replace: "const roots = comments.filter((c) => c.in_reply_to_id === null);", red: "a root review comment with no in_reply_to_id key" },
  { id: "P51", file: "src", what: "a head repository GitHub reports as null is read as the lane's own (Q27)",
    find: "lane: item.head?.repo?.full_name === repo ? laneOf(item.head?.ref) : \"other\",",
    replace: "lane: (item.head?.repo?.full_name ?? repo) === repo ? laneOf(item.head?.ref) : \"other\",", red: "whose head repository is null is not the lane's own" },
  { id: "P52", file: "src", what: "an open-PR list shorter than the issues list's PR entries is accepted (Q32)",
    find: "if (prs.length === prEntries && all.length === expected)",
    replace: "if (prs.length <= prEntries && all.length === expected)", red: "an open-PR list that leaves out a PR the issues list still shows" },
  { id: "P53", file: "src", what: "a branch page short by one row is tolerated (Q17)",
    find: "if (branchList.length < branchTotal) throw",
    replace: "if (branchList.length < branchTotal - 1) throw", red: "a branch page short by one row" },
  { id: "P54", file: "src", what: "a closed-PR page short by one row is tolerated (Q19)",
    find: "if (closed.length < closedTotal) throw",
    replace: "if (closed.length < closedTotal - 1) throw", red: "a closed-PR page short by one row" },
  { id: "P55", file: "src", what: "an end marker before the begin marker is accepted (Q21)",
    find: "if (stop < start) throw new ToolError(",
    replace: "if (false) throw new ToolError(", red: "an end marker before the begin marker" },
  { id: "P56", file: "src", what: "a lane-mailbox.json with no branch is accepted (Q10)",
    find: "typeof lm.branch === \"string\" && lm.branch !== \"\"",
    replace: "lm.branch !== \"\"", red: "a PR number and no branch is unreadable" },
  { id: "P57", file: "src", what: "a lane-mailbox.json whose branch is an empty string is accepted (Q10)",
    find: " && lm.branch !== \"\") standing",
    replace: ") standing", red: "whose branch is an empty string is unreadable too" },
  { id: "P58", file: "src", what: "unreadable checks on an idle PR are read as not red (Q16)",
    find: "const red = f.checks ? f.checks.red.length > 0 : null;",
    replace: "const red = f.checks ? f.checks.red.length > 0 : false;", red: "check list fails to load (502) is UNKNOWN" },
  { id: "P59", file: "src", what: "the snapshot block carries the Auth line (Q22)",
    find: "for (const l of headerLines(report).slice(2))",
    replace: "for (const l of headerLines(report).slice(1))", red: "give the same snapshot block" },
  { id: "P60", file: "src", what: "'it' no longer names this PR in the ask detector (Q07)",
    find: "const thisPr = /\\b(?:this|it|them)\\b/i.test(after);",
    replace: "const thisPr = /\\b(?:this|them)\\b/i.test(after);", red: "'the cloud lane may merge it now' is an ask" },
  { id: "P61", file: "src", what: "'them' no longer names this PR in the ask detector (Q07)",
    find: "|it|them)\\b/i.test(after)",
    replace: "|it)\\b/i.test(after)", red: "'the cloud lane may merge them now' is an ask" },
  { id: "P62", file: "src", what: "a semicolon no longer splits sentences in the ask detector (Q09)",
    find: "text.split(/[.!?;\\n]+/)",
    replace: "text.split(/[.!?\\n]+/)", red: "a negation in an EARLIER clause after a semicolon" },
  { id: "P63", file: "src", what: "the lane condition is dropped from the mailbox-branch test in decide (Q11)",
    find: "if (f.lane === \"lane\" && f.headRef === mailboxBranch) {",
    replace: "if (f.headRef === mailboxBranch) {", red: "a fork PR from a branch named lane/mailbox" },
  { id: "P64", file: "page", what: "the page does not say what the owner's squash merge message should carry (LOW 6)",
    find: "the PR title and body, not the per-commit trailers",
    replace: "the per-commit trailers", red: "squash merge message should carry the PR title and body" },
  { id: "P65", file: "src", what: "the rate-limit reserve goes back to 7 requests per PR (INFO 8)",
    find: "export const RESERVE_PER_PR = 13;",
    replace: "export const RESERVE_PER_PR = 7;", red: "covers the measured worst read" },
  { id: "P66", file: "page", what: "the page goes back to the estimate instead of the measured read (INFO 8)",
    find: "1011 GET requests for 80 open PRs",
    replace: "about six GET requests per open PR", red: "the page quotes the measured read" },
  { id: "P67", file: "page", what: "the page no longer names the child-process write as a ceiling of the write scan (INFO 7)",
    find: "a write made through a child process",
    replace: "a write built by hand", red: "names the ceiling that a write made through a child process" },
  { id: "P68", file: "skill", what: "the skill gives a reserve the tool does not use (INFO 8)",
    find: "13 per open PR plus 120",
    replace: "7 per open PR plus 120", red: "the skill gives the reserve the tool uses" },
  { id: "P69", file: "src", what: "--classify does not notice a head that moved while the files were read (MEDIUM 1)",
    find: "if (again?.head?.sha !== headSha) throw new ApiError(",
    replace: "if (false) throw new ApiError(", red: "whose head moves while the files are read" },
  { id: "P70", file: "src", what: "an import without an extension, or a directory import, is not resolved (MEDIUM 2)",
    find: "const MODULE_EXTS = [\".mjs\", \".js\", \".cjs\", \".ts\", \".mts\", \".cts\", \".json\"];",
    replace: "const MODULE_EXTS = [];", red: "an import without an extension resolves" },
];
// <<< mutants-end

// ── self-test: fixture cases, no network ─────────────────────────────────────────────────
//
// Every case runs the REAL main() against an in-memory GitHub. Each rule is paired with a
// control that differs in exactly the fact under test and lands on the other side, so a case
// cannot pass because the rule is unreachable (the "green PR on owner files" case would
// pass trivially if nothing were ever landable; its twin on a docs file lands).

const REPO_FX = "acme/widgets";
const BASE_FX = "SignalGrid_Alpha";
const BASE_SHA_FX = "b".repeat(40);
const NOW_FX = new Date("2026-10-22T12:00:00Z");
const agoIso = (days) => new Date(NOW_FX.getTime() - days * DAY_MS).toISOString();
const shaFx = (n) => n.toString(16).padStart(40, "0");

/** One check_run. `state` is a conclusion, or queued/in_progress for one still running. */
const runFx = (id, name, state) => (["queued", "in_progress"].includes(state)
  ? { id, name, status: state, conclusion: null }
  : { id, name, status: "completed", conclusion: state });

/** The check runs of a head: gating, Mac-only (null = absent), and any extra {name, state}. */
function checksFx({ gating = "success", mac = null, extra = [] } = {}) {
  const out = [];
  let id = 1000;
  if (gating) out.push(runFx(id++, GATING_CHECK, gating));
  if (mac) out.push(runFx(id++, "PR — Mac-only checks (full-clone provenance, preflight on macOS)", mac));
  for (const e of extra) out.push(runFx(id++, e.name, e.state));
  return out;
}

const GOOD_BODY_FX = "Local preflight passed and verify:breadth passed on this branch before the push.";

/** A PR spec with the defaults of a landable cloud-lane PR; override what a case tests. */
function prFx(n, o = {}) {
  const ref = o.ref ?? `claude/build-thing-${n}`;
  return {
    number: n,
    title: o.title ?? `fixture PR ${n}`,
    ref,
    sha: o.sha ?? shaFx(n),
    base: o.base ?? BASE_FX,
    draft: o.draft ?? false,
    created: o.created ?? agoIso(o.idle ? o.idle + 1 : 1),
    updated: o.updated ?? agoIso(o.idle ?? 1),
    body: o.body ?? GOOD_BODY_FX,
    mergeable_state: o.mergeable_state ?? "clean",
    files: o.files ?? [{ filename: "docs/notes.md", status: "modified" }],
    changedFiles: o.changedFiles,
    omitChangedFiles: o.omitChangedFiles ?? false,
    checks: o.checks ?? checksFx({ mac: "success" }),
    checksTotal: o.checksTotal,
    omitChecksTotal: o.omitChecksTotal ?? false,
    omitBase: o.omitBase ?? false,
    omitBaseInList: o.omitBaseInList ?? false,
    comments: o.comments ?? [],
    reportedComments: o.reportedComments,
    omitReviewComments: o.omitReviewComments ?? false,
    shortComments: o.shortComments ?? false,
    compare: o.compare ?? "diverged",
    fork: o.fork ?? false,
    unknownReads: o.unknownReads ?? 0,
    omitDraft: o.omitDraft ?? false,
    omitDraftInList: o.omitDraftInList ?? false,
    detailDraft: o.detailDraft,
    listDraft: o.listDraft,
    headRepoNull: o.headRepoNull ?? false,
    headAfter: o.headAfter,
  };
}

function worldFx(over = {}) {
  return {
    prs: [], issues: [], branches: [{ name: BASE_FX, commit: { sha: BASE_SHA_FX }, protected: true }], closed: [],
    rate: { limit: 5000, remaining: 4000, reset: 1792700000 },
    commitsByPath: {}, contents: new Set(), headDate: {}, fail: [], countOverride: undefined, latency: null, branchCut: null,
    closedCut: null, noLinkHeader: false, hidePulls: [],
    ...over,
  };
}

/** An in-memory GitHub answering GET only. Records every request. */
function fakeGitHub(w) {
  const log = [];
  const respond = (status, body, headers = {}) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const pageOf = (arr, q) => {
    const per = Number(q.get("per_page") ?? 30);
    const p = Number(q.get("page") ?? 1);
    return arr.slice((p - 1) * per, p * per);
  };
  const listItem = (p) => ({
    number: p.number, title: p.title, html_url: `https://github.com/${REPO_FX}/pull/${p.number}`,
    head: { ref: p.ref, sha: p.sha, repo: p.headRepoNull ? null : { full_name: p.fork ? "someone/fork" : REPO_FX } }, base: p.omitBase || p.omitBaseInList ? undefined : { ref: p.base },
    user: { login: "DanFashauer" }, draft: p.omitDraftInList ? undefined : (p.listDraft !== undefined ? p.listDraft : p.draft), created_at: p.created, updated_at: p.updated,
  });
  const nonPrIssues = () => w.issues.filter((i) => !i.pull_request);
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname);
    const q = u.searchParams;
    log.push({ method: init.method ?? "GET", path: `${path}${u.search}` });
    const ms = w.latency ? w.latency(`${path}${u.search}`) : 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    for (const f of w.fail) if (f.match.test(path)) return respond(f.status, { message: f.message ?? "fixture failure" }, f.headers ?? {});
    const R = `/repos/${REPO_FX}`;
    if (path === "/rate_limit") return respond(200, { resources: { core: w.rate } });
    if (path === R) return respond(200, { default_branch: BASE_FX, full_name: REPO_FX, open_issues_count: w.countOverride ?? w.prs.length + nonPrIssues().length });
    if (path === `${R}/branches/${BASE_FX}`) return respond(200, { commit: { sha: BASE_SHA_FX } });
    if (path === `${R}/branches`) {
      if (q.get("per_page") === "1") {
        return respond(200, pageOf(w.branches, q), w.branches.length > 1 && !w.noLinkHeader ? { link: `<https://api.github.com/x?per_page=1&page=${w.branches.length}>; rel="last"` } : {});
      }
      // branchCut = { page, keep }: that page of the list comes back short (a GitHub hiccup)
      const cut = w.branchCut && Number(q.get("page") ?? 1) === w.branchCut.page ? w.branchCut.keep : null;
      const rows = pageOf(w.branches, q);
      return respond(200, cut === null ? rows : rows.slice(0, cut));
    }
    if (path === `${R}/pulls`) {
      const state = q.get("state");
      if (state === "open") return respond(200, pageOf([...w.prs].filter((p) => !w.hidePulls.includes(p.number)).sort((a, b) => a.number - b.number).map(listItem), q));
      if (state === "closed") {
        const rows = [...w.closed].sort((a, b) => a.number - b.number);
        if (q.get("per_page") === "1") return respond(200, pageOf(rows, q), rows.length > 1 && !w.noLinkHeader ? { link: `<https://api.github.com/x?state=closed&per_page=1&page=${rows.length}>; rel="last"` } : {});
        // closedCut = { page, keep }: that page of the closed list comes back short
        const cut = w.closedCut && Number(q.get("page") ?? 1) === w.closedCut.page ? w.closedCut.keep : null;
        const rowsOfPage = pageOf(rows, q);
        return respond(200, cut === null ? rowsOfPage : rowsOfPage.slice(0, cut));
      }
    }
    if (path === `${R}/issues`) {
      const all = [...nonPrIssues(), ...w.prs.map((p) => ({ number: p.number, title: p.title, pull_request: {}, created_at: p.created, updated_at: p.updated }))];
      return respond(200, pageOf(all.sort((a, b) => a.number - b.number), q));
    }
    let m;
    if ((m = new RegExp(`^${R}/pulls/(\\d+)$`).exec(path))) {
      const p = w.prs.find((x) => x.number === Number(m[1]));
      if (!p) return respond(404, { message: "Not Found" });
      const unknown = (p.unknownReads ?? 0) > 0;
      if (unknown) p.unknownReads -= 1;
      p.detailReads = (p.detailReads ?? 0) + 1;
      const item = listItem(p);
      return respond(200, {
        ...item, head: { ...item.head, sha: p.headAfter && p.detailReads > 1 ? p.headAfter : p.sha }, base: p.omitBase ? undefined : { ref: p.base }, body: p.body, mergeable_state: unknown ? "unknown" : p.mergeable_state,
        draft: p.omitDraft ? undefined : (p.detailDraft !== undefined ? p.detailDraft : p.draft),
        changed_files: p.omitChangedFiles ? undefined : (p.changedFiles ?? p.files.length),
        review_comments: p.omitReviewComments ? undefined : (p.reportedComments ?? p.comments.length),
      });
    }
    if ((m = new RegExp(`^${R}/pulls/(\\d+)/files$`).exec(path))) {
      const p = w.prs.find((x) => x.number === Number(m[1]));
      return respond(200, pageOf(p.files.map((f) => ({ filename: f.filename, status: f.status ?? "modified", previous_filename: f.previous })), q));
    }
    if ((m = new RegExp(`^${R}/pulls/(\\d+)/comments$`).exec(path))) {
      const p = w.prs.find((x) => x.number === Number(m[1]));
      return respond(200, p.shortComments ? [] : pageOf(p.comments, q));
    }
    if ((m = new RegExp(`^${R}/commits/([0-9a-f]{40})/check-runs$`).exec(path))) {
      const p = w.prs.find((x) => x.sha === m[1]);
      const runs = p ? p.checks : [];
      return respond(200, { total_count: p?.omitChecksTotal ? undefined : (p?.checksTotal ?? runs.length), check_runs: pageOf(runs, q) });
    }
    if ((m = new RegExp(`^${R}/commits/([0-9a-f]{40})$`).exec(path))) {
      return respond(200, { sha: m[1], commit: { committer: { date: w.headDate[m[1]] ?? agoIso(10) } } });
    }
    if (path === `${R}/commits`) {
      const rows = w.commitsByPath[q.get("path")] ?? [];
      return respond(200, rows.slice(0, Number(q.get("per_page") ?? 30)));
    }
    if ((m = new RegExp(`^${R}/compare/${BASE_SHA_FX}\\.\\.\\.([0-9a-f]{40})$`).exec(path))) {
      const p = w.prs.find((x) => x.sha === m[1]);
      return respond(200, { status: p?.compare ?? "diverged" });
    }
    if ((m = new RegExp(`^${R}/contents/(.+)$`).exec(path))) {
      return w.contents.has(m[1]) ? respond(200, { path: m[1] }) : respond(404, { message: "Not Found" });
    }
    return respond(404, { message: `fixture has no route for ${path}` });
  }
  return { fetch, log };
}

async function runFx_(w, argv = [], { env = {}, textFiles = {}, gitExec, mailbox = { pr: 439, branch: "lane/mailbox" } } = {}) {
  const out = [];
  const err = [];
  const gh = fakeGitHub(w);
  const mailboxPath = resolve(REPO_ROOT, "docs/agent/lane-mailbox.json");
  const io = {
    env: { GITHUB_TOKEN: `ghp_${"a".repeat(36)}`, ...env },
    fetchImpl: gh.fetch,
    sleep: async () => {},
    now: () => NOW_FX,
    gitExec: gitExec ?? (() => ({ status: 128, stdout: "" })),
    readText: (p) => {
      if (p === mailboxPath) {
        if (mailbox === null) throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
        return JSON.stringify(mailbox);
      }
      if (p in textFiles) return textFiles[p];
      return readFileSync(p, "utf8");
    },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  const code = await main(["--repo", REPO_FX, "--json", ...argv], io);
  const stdout = out.join("");
  let report = null;
  try { report = JSON.parse(stdout); } catch { /* a refusal prints no JSON, which is the point of some cases */ }
  return { code, stdout, stderr: err.join(""), report, log: gh.log };
}

const rowOf = (res, n) => res.report?.prs.find((p) => p.number === n);

async function runSelfTest(io) {
  const results = [];
  const t = (name, ok, detail = "") => results.push({ name, ok: Boolean(ok), detail });
  const eq = (name, got, want) => t(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  try {

  // ── the planted-defect table still applies to what it was written against ──
  if (!io.env?.SGBT_MUTANT) {
    const texts = readTexts();
    const broken = MUTANTS.map((m) => ({ m, r: applyMutant(m, texts) })).filter((x) => !x.r.ok).map((x) => `${x.m.id}: ${x.r.why}`);
    t(`all ${MUTANTS.length} planted defects (--mutants) still apply to the source, skill and page they were written against`, broken.length === 0, broken.join("; "));
    t("planted-defect ids are unique", new Set(MUTANTS.map((m) => m.id)).size === MUTANTS.length);
    t("every P row names the case it must turn red", MUTANTS.filter((m) => /^P/.test(m.id)).every((m) => typeof m.red === "string" && m.red.length >= 8), MUTANTS.filter((m) => /^P/.test(m.id) && !(typeof m.red === "string" && m.red.length >= 8)).map((m) => m.id).join(", "));
  }

  // ── tokens fail closed ──
  for (const v of ["<token>", "your_token_here", "REPLACE_ME", "xxxxxxxx", "changeme", "null", "${GITHUB_TOKEN}", "placeholder"]) {
    t(`token "${v}" is a placeholder`, tokenShape(v).kind === "placeholder");
  }
  t("an empty token is missing", tokenShape("  ").kind === "missing");
  t("a real-shaped token is not a placeholder", tokenShape(`ghp_${"A1".repeat(18)}`).kind === "github");
  t("an unfamiliar marker is left to GitHub's answer", tokenShape("proxy-injected").kind === "other");
  {
    const w = worldFx();
    const res = await runFx_(w, [], { env: { GITHUB_TOKEN: "", GH_TOKEN: "" } });
    t("no token: exit 2, names both variables, prints no queue", res.code === 2 && /GH_TOKEN and GITHUB_TOKEN/.test(res.stderr) && res.stdout === "", res.stderr);
    t("no token: not one request was sent", res.log.length === 0);
  }
  {
    const res = await runFx_(worldFx(), [], { env: { GITHUB_TOKEN: "REPLACE_ME", GH_TOKEN: "" } });
    t("placeholder token: exit 2 before any request, says placeholder", res.code === 2 && /placeholder/.test(res.stderr) && res.log.length === 0 && res.stdout === "", res.stderr);
  }
  {
    const w = worldFx({ fail: [{ match: /rate_limit/, status: 401 }] });
    const res = await runFx_(w, [], { env: { GITHUB_TOKEN: "proxy-injected" } });
    t("placeholder-shaped token answered 401: exit 2, says so, prints no queue", res.code === 2 && /401/.test(res.stderr) && /placeholder/.test(res.stderr) && res.stdout === "", res.stderr);
  }
  {
    const res = await runFx_(worldFx({ rate: { limit: 60, remaining: 58, reset: 1 } }), []);
    t("an anonymous answer (core limit 60) is refused", res.code === 2 && /anonymous/.test(res.stderr) && res.stdout === "", res.stderr);
  }
  {
    const w = worldFx({ prs: [prFx(1), prFx(2)], rate: { limit: 5000, remaining: 3, reset: 1792700000 } });
    const res = await runFx_(w, []);
    t("a rate limit too low to finish the read is refused before the PRs are read", res.code === 2 && /rate limit/.test(res.stderr) && res.stdout === "" && !res.log.some((l) => /\/pulls\/1$/.test(l.path)), res.stderr);
  }
  {
    const w = worldFx({ prs: [prFx(1), prFx(2), prFx(3)], fail: [{ match: /\/pulls\/2$/, status: 403, headers: { "x-ratelimit-remaining": "0" } }] });
    const res = await runFx_(w, []);
    t("a rate limit hit mid-read is fatal and prints no partial queue", res.code === 2 && res.stdout === "" && /rate limit/.test(res.stderr), res.stderr);
  }

  // ── an empty page is not "no PRs" ──
  {
    const w = worldFx({ prs: [], issues: [], countOverride: 3 });
    const res = await runFx_(w, []);
    t("empty PR page while the repo says 3 open: exit 3, no queue", res.code === 3 && res.stdout === "" && /disagree/.test(res.stderr), res.stderr);
  }
  {
    const res = await runFx_(worldFx(), []);
    t("empty PR page while the repo says 0 open: a verified empty queue", res.code === 0 && res.report?.prs.length === 0 && res.report.sources.openTotalExpected === 0, res.stderr);
  }
  {
    const w = worldFx({ prs: [prFx(1), prFx(2)], countOverride: 5 });
    const res = await runFx_(w, []);
    t("lists that fall short of the repo's count are refused", res.code === 3 && res.stdout === "");
    const drift = await runFx_(w, ["--allow-count-drift"]);
    t("--allow-count-drift reads on and says so in the notes", drift.code === 0 && drift.report.notes.some((n) => /--allow-count-drift/.test(n)), drift.stderr);
  }
  {
    const mk = (n) => Array.from({ length: n }, (_, i) => ({ i }));
    for (const [n, calls] of [[250, 3], [200, 3], [99, 1], [100, 2], [0, 1]]) {
      const log = [];
      const api = { json: async (p) => { log.push(p); const page = Number(/[?&]page=(\d+)/.exec(p)[1]); return mk(n).slice((page - 1) * 100, page * 100); } };
      const rows = await listAll(api, "/x");
      t(`listAll over ${n} rows reads ${calls} page(s) and returns every row`, rows.length === n && log.length === calls, `${rows.length} rows, ${log.length} calls`);
    }
  }

  // ── the rules, each beside its control ──
  const landable = (res, n) => rowOf(res, n)?.disposition === "LAND-UNDER-DR-037";
  {
    const w = worldFx({
      prs: [
        prFx(10, { files: [{ filename: "docs/POSITIONING.md" }] }),
        prFx(11, { files: [{ filename: "docs/notes.md" }] }),
        prFx(12, { files: [{ filename: "lib/signalgrid-core/src/engine.ts" }] }),
        prFx(13, { files: [{ filename: "scripts/check-launch-claims.mjs" }] }),
        prFx(14, { files: [{ filename: "scripts/check-something-else.mjs" }] }),
        prFx(15, { files: [{ filename: "docs/moved.md", status: "renamed", previous: "lib/signalgrid-core/src/old.ts" }] }),
        prFx(16, { files: [{ filename: "docs/DECISION_RECORDS.md" }] }),
      ],
    });
    const res = await runFx_(w, []);
    t("a green cloud PR on OWNER_RESERVED files is OWNER-MERGE", rowOf(res, 10)?.disposition === "OWNER-MERGE" && rowOf(res, 10).reason === "classifier-owner_reserved", JSON.stringify(rowOf(res, 10)));
    t("control: the same PR on an ordinary docs file is LAND-UNDER-DR-037", landable(res, 11), JSON.stringify(rowOf(res, 11)));
    t("DECISION_PATH files are OWNER-MERGE", rowOf(res, 12)?.disposition === "OWNER-MERGE" && rowOf(res, 12).reason === "classifier-decision_path");
    t("an owner-named gate (launch-claims) is OWNER-MERGE although the classifier files it as ordinary scripts/**", rowOf(res, 13)?.disposition === "OWNER-MERGE" && rowOf(res, 13).reason === "owner-named-surface" && rowOf(res, 13).files.categories.join() === "SAFETY_MACHINERY", JSON.stringify(rowOf(res, 13)));
    t("control: a SAFETY_MACHINERY PR on an ordinary gate is LAND-UNDER-DR-037", landable(res, 14), JSON.stringify(rowOf(res, 14)));
    t("a rename away from lib/ is judged on the old path too", rowOf(res, 15)?.disposition === "OWNER-MERGE");
    t("the decision records are owner-named", rowOf(res, 16)?.disposition === "OWNER-MERGE");
    t("LAND quotes nothing it did not read: its evidence says the lane still re-reads the head", /re-reads the head/.test(rowOf(res, 11).evidence.join(" ")));
  }
  {
    const macAsk = "Owner decision needed: none - the cloud lane may merge under DR-037 once CI is green.";
    const macNo = "The cloud lane may not merge this one; the owner decides.";
    const macDescribes = "Context: the cloud lane can merge its own PRs under DR-037. This Mac PR is for the owner.";
    const macOtherPr = "Once this is in, the cloud lane is free to land #1234.";
    const sm = [{ filename: "scripts/check-something-else.mjs" }];
    const w = worldFx({
      prs: [
        prFx(20, { ref: "mac/safety-thing", files: sm }),
        prFx(21, { ref: "mac/safety-thing-asked", files: sm, body: `${GOOD_BODY_FX}\n${macAsk}` }),
        prFx(22, { ref: "mac/safety-thing-negated", files: sm, body: `${GOOD_BODY_FX}\n${macNo}` }),
        prFx(23, { ref: "mac/safety-thing-asked-red", files: sm, body: `${GOOD_BODY_FX}\n${macAsk}`, checks: checksFx({ mac: "success", extra: [{ name: "github-advanced-security", state: "failure" }] }) }),
        prFx(24, { ref: "mac/docs-only", files: [{ filename: "docs/notes.md" }] }),
        prFx(25, { ref: "mac/describes-the-rule", files: sm, body: `${GOOD_BODY_FX}\n${macDescribes}` }),
        prFx(26, { ref: "mac/names-another-pr", files: sm, body: `${GOOD_BODY_FX}\n${macOtherPr}` }),
        prFx(27, { ref: "mac/tick-20261022T010000Z", files: [{ filename: "docs/agent/not-on-mainline.json" }], sha: shaFx(27) }),
        prFx(28, { ref: "claude/safety-thing-asked", files: sm, body: `${GOOD_BODY_FX}\n${macAsk}` }),
      ],
    });
    const res = await runFx_(w, []);
    t("a mac/* SAFETY_MACHINERY PR with no ask is MAC-ASK-NEEDED", rowOf(res, 20)?.disposition === "MAC-ASK-NEEDED" && rowOf(res, 20).ask === "not-in-body" && rowOf(res, 20).reason === "mac-opened-safety_machinery", JSON.stringify(rowOf(res, 20)));
    t("an ask found only in the body is MAC-ASK-NEEDED 'ask in body; confirm mail', never LAND (a body has no provenance)", rowOf(res, 21)?.disposition === "MAC-ASK-NEEDED" && rowOf(res, 21).ask === "in-body" && rowOf(res, 21).reason === "ask in body; confirm mail" && rowOf(res, 21).blockers.length === 0 && /confirm the mail ask/.test(rowOf(res, 21).evidence.join(" ")), JSON.stringify(rowOf(res, 21)));
    t("control: the same body on a cloud-lane (claude/*) PR is LAND-UNDER-DR-037, so only the mac/ prefix holds PR 21 back", landable(res, 28), JSON.stringify(rowOf(res, 28)));
    t("a body that says the cloud lane may NOT merge is not an ask", rowOf(res, 22)?.disposition === "MAC-ASK-NEEDED" && rowOf(res, 22).ask === "not-in-body");
    t("asked in the body but a bot check is failing: MAC-ASK-NEEDED, with the blocker named", rowOf(res, 23)?.disposition === "MAC-ASK-NEEDED" && rowOf(res, 23).ask === "in-body" && /not landable now/.test(rowOf(res, 23).reason) && rowOf(res, 23).blockers.some((b) => /github-advanced-security/.test(b)), JSON.stringify(rowOf(res, 23)));
    t("a mac/* autonomous PR with no ask is MAC-ASK-NEEDED", rowOf(res, 24)?.disposition === "MAC-ASK-NEEDED");
    t("a sentence that only describes the rule (the cloud lane can merge its own PRs) is not an ask", rowOf(res, 25)?.ask === "not-in-body" && rowOf(res, 25).reason === "mac-opened-safety_machinery", JSON.stringify(rowOf(res, 25)));
    t("a sentence about landing ANOTHER PR (#1234) is not an ask for this one", rowOf(res, 26)?.ask === "not-in-body", JSON.stringify(rowOf(res, 26)));
    t("an unsuperseded mac/tick-* PR is MAC-ASK-NEEDED, and its row says why the stricter reading holds against LANE_COORDINATION rule 2", rowOf(res, 27)?.disposition === "MAC-ASK-NEEDED" && /rule 2/.test(rowOf(res, 27).evidence.join(" ")) && /opened/.test(rowOf(res, 27).evidence.join(" ")), JSON.stringify(rowOf(res, 27)));
    t("the report says Mac mail is not read and a body line is never the ask", res.report.notes.some((n) => /Mac lane mail is not read/.test(n) && /confirm mail/.test(n)));
    for (const [text, want] of [
      ["Owner decision needed: none - SAFETY_MACHINERY; the cloud lane may merge under DR-037 once CI is green.", true],
      ["Mac asks the cloud lane to land this PR.", true],
      ["Context: the cloud lane can merge its own PRs under DR-037. This Mac PR is for the owner.", false],
      ["Once this is in, the cloud lane is free to land #1234.", false],
      ["The cloud lane can merge a green PR once CI passes.", false],
      ["The cloud lane can merge on Tuesdays.", false],
      ["The cloud lane may merge all of them once CI is green.", false],
      ["The cloud lane can land #1234 and this one when green.", false],
      ["The cloud lane may land this PR when CI is green.", true],
      ["The cloud lane may not merge this one; the owner decides.", false],
      ["```\nthe cloud lane may merge this PR\n```", false],
      ["<!-- the cloud lane may merge this PR -->", false],
    ]) t(`ask detector (${want ? "ask" : "not an ask"}): ${JSON.stringify(text).slice(0, 70)}`, bodyAsksCloudToLand(text) === want);
  }
  {
    const w = worldFx({ prs: [prFx(30, { compare: "behind" }), prFx(31, { compare: "identical" }), prFx(32, { compare: "diverged" }), prFx(33, { compare: "ahead" })] });
    const res = await runFx_(w, []);
    t("a PR whose head is an ancestor of mainline (compare: behind) is SUPERSEDED", rowOf(res, 30)?.disposition === "SUPERSEDED" && rowOf(res, 30).reason === "head-is-ancestor-of-mainline", JSON.stringify(rowOf(res, 30)));
    t("a head identical to mainline is SUPERSEDED", rowOf(res, 31)?.disposition === "SUPERSEDED");
    t("control: a diverged head is not SUPERSEDED", rowOf(res, 32)?.disposition === "LAND-UNDER-DR-037");
    t("control: a head ahead of mainline is not SUPERSEDED", rowOf(res, 33)?.disposition === "LAND-UNDER-DR-037");
  }
  {
    const ancestors = new Set([shaFx(40)]);
    const gitExec = (args) => {
      const a = args.slice(2);
      if (a[0] === "rev-parse" && a[1] === "--is-inside-work-tree") return { status: 0, stdout: "true\n" };
      if (a[0] === "rev-parse" && a[1] === "--verify") return { status: 0, stdout: `${BASE_SHA_FX}\n` };
      if (a[0] === "rev-parse" && a[1] === "--is-shallow-repository") return { status: 0, stdout: "false\n" };
      if (a[0] === "cat-file") return { status: 0, stdout: "" };
      if (a[0] === "merge-base") return { status: ancestors.has(a[2]) ? 0 : 1, stdout: "" };
      return { status: 128, stdout: "" };
    };
    const w = worldFx({ prs: [prFx(40, { compare: "diverged" }), prFx(41)] });
    const res = await runFx_(w, [], { gitExec });
    t("local git answers ancestry when the checkout is whole and current (SUPERSEDED, source local-git)", rowOf(res, 40)?.disposition === "SUPERSEDED" && rowOf(res, 40).ancestry.source === "local-git", JSON.stringify(rowOf(res, 40)?.ancestry));
    t("a whole, current checkout's 'no' is conclusive: the REST compare is not asked", rowOf(res, 41)?.ancestry.source === "local-git" && !res.log.some((l) => /\/compare\//.test(l.path)));
    const shallow = (args) => (args.slice(2)[1] === "--is-shallow-repository" ? { status: 0, stdout: "true\n" } : gitExec(args));
    const res2 = await runFx_(w, [], { gitExec: shallow });
    t("a shallow checkout's 'no' is not conclusive: the REST compare answers", rowOf(res2, 41)?.ancestry.source === "rest-compare" && res2.report.sources.ancestry.includes("is shallow"), res2.report.sources.ancestry);
  }
  {
    const w = worldFx({
      prs: [
        prFx(50, { draft: true }),
        prFx(51),
        prFx(52, { checks: checksFx({ gating: "failure", mac: "success" }) }),
        prFx(53, { idle: 20, checks: checksFx({ gating: "failure", mac: "success" }) }),
        prFx(54, { idle: 20, checks: checksFx({ mac: "success", extra: [{ name: "github-advanced-security", state: "failure" }, { name: "phase-pr-evidence", state: "failure" }, { name: "CycloneDX SBOM", state: "failure" }] }) }),
        prFx(55, { checks: checksFx({ gating: "in_progress", mac: "queued" }) }),
        prFx(56, { checks: checksFx({ gating: null }) }),
      ],
    });
    const res = await runFx_(w, []);
    t("a draft is never LAND (blocker: draft)", rowOf(res, 50)?.disposition === "UNKNOWN" && rowOf(res, 50).blockers.includes("draft"), JSON.stringify(rowOf(res, 50)));
    t("control: its non-draft twin is LAND", landable(res, 51));
    t("a red gating check is never LAND", rowOf(res, 52)?.disposition === "UNKNOWN" && rowOf(res, 52).blockers.includes("gating check failure"), JSON.stringify(rowOf(res, 52)));
    t("a red gating check on a PR idle 20 days is STALE (idle-over-14d-red)", rowOf(res, 53)?.disposition === "STALE" && rowOf(res, 53).reason === "idle-over-14d-red" && rowOf(res, 53).natural === "LAND-UNDER-DR-037", JSON.stringify(rowOf(res, 53)));
    t("advisory failures (code scanning, phase evidence, SBOM) never make a PR red or STALE, and still block landing", rowOf(res, 54)?.disposition === "UNKNOWN" && rowOf(res, 54).blockers.some((b) => /other failing checks/.test(b)), JSON.stringify(rowOf(res, 54)));
    t("a gating check still running is never LAND", rowOf(res, 55)?.disposition === "UNKNOWN");
    t("an absent gating check is never LAND", rowOf(res, 56)?.disposition === "UNKNOWN" && rowOf(res, 56).blockers.includes("gating check absent"));
  }
  {
    const w = worldFx({
      prs: [
        prFx(60, { idle: 14, mergeable_state: "dirty" }),
        prFx(61, { idle: 14.5, mergeable_state: "dirty" }),
        prFx(62, { idle: 15, checks: checksFx({ mac: "success", extra: [{ name: "CodeQL", state: "failure" }] }) }),
        prFx(63, { idle: 15, checks: checksFx({ mac: "success", extra: [{ name: "Analyze (javascript-typescript)", state: "failure" }] }) }),
        prFx(64, { idle: 15, mac: null, mergeable_state: "unknown" }),
        prFx(65, { idle: 15, mergeable_state: "dirty", files: [{ filename: "lib/signalgrid-core/src/engine.ts" }] }),
        prFx(66, { idle: 15, ref: "mac/some-work", mergeable_state: "dirty", files: [{ filename: "scripts/check-something-else.mjs" }] }),
      ],
    });
    const res = await runFx_(w, []);
    t("exactly 14.0 days idle and conflicting is not yet STALE", rowOf(res, 60)?.disposition !== "STALE");
    t("14.5 days idle and conflicting is STALE (idle-over-14d-conflicting)", rowOf(res, 61)?.disposition === "STALE" && rowOf(res, 61).reason === "idle-over-14d-conflicting");
    t("CodeQL failing makes a stale PR red", rowOf(res, 62)?.disposition === "STALE" && rowOf(res, 62).reason === "idle-over-14d-red");
    t("a CodeQL 'Analyze (...)' job failing makes a stale PR red", rowOf(res, 63)?.disposition === "STALE");
    t("idle past the window with mergeable_state never computed is UNKNOWN, not guessed either way", rowOf(res, 64)?.disposition === "UNKNOWN" && /mergeable_state/.test(rowOf(res, 64).reason), JSON.stringify(rowOf(res, 64)));
    t("a STALE PR keeps what it would be if revived (OWNER-MERGE for a DECISION_PATH diff)", rowOf(res, 65)?.disposition === "STALE" && rowOf(res, 65).natural === "OWNER-MERGE");
    t("a stale mac SAFETY_MACHINERY PR would be MAC-ASK-NEEDED if revived", rowOf(res, 66)?.disposition === "STALE" && rowOf(res, 66).natural === "MAC-ASK-NEEDED");
  }
  {
    const w = worldFx({
      prs: [
        prFx(70, { ref: "dependabot/npm_and_yarn/zod-4", files: [{ filename: "package.json" }] }),
        prFx(71, { ref: "codex/mac-build-activation" }),
        prFx(72, { ref: "claude/worker-thing", files: [{ filename: "lib/signalgrid-core/src/engine.ts" }] }),
        prFx(73, { ref: "lane/mailbox", draft: true, files: [], changedFiles: 0, title: "Lane mailbox" }),
        prFx(439, { ref: "lane/mailbox", draft: true, files: [], changedFiles: 0, title: "Lane mailbox" }),
        prFx(74, { ref: "claude/empty-draft", draft: true, files: [], changedFiles: 0 }),
      ],
    });
    const res = await runFx_(w, ["--declared-live", "72:worker B87"]);
    t("a Dependabot PR is OWNER-MERGE (dependabot-not-cloud-opened)", rowOf(res, 70)?.disposition === "OWNER-MERGE" && rowOf(res, 70).reason === "dependabot-not-cloud-opened", JSON.stringify(rowOf(res, 70)));
    t("a codex/* branch is not a lane's own: OWNER-MERGE (other-lane-owner-review)", rowOf(res, 71)?.disposition === "OWNER-MERGE" && rowOf(res, 71).lane === "other");
    t("a declared-live PR is IN-FLIGHT, ahead of OWNER-MERGE, with the caller's note", rowOf(res, 72)?.disposition === "IN-FLIGHT" && rowOf(res, 72).natural === "OWNER-MERGE" && /worker B87/.test(rowOf(res, 72).evidence.join(" ")), JSON.stringify(rowOf(res, 72)));
    t("control: undeclared, the same PR is OWNER-MERGE", (await runFx_(w, [])).report.prs.find((p) => p.number === 72).disposition === "OWNER-MERGE");
    t("the mailbox PR named in lane-mailbox.json is STANDING", rowOf(res, 439)?.disposition === "STANDING");
    t("control: another empty draft on the same branch name (another number) is UNKNOWN, neither STANDING nor LAND", rowOf(res, 73)?.disposition === "UNKNOWN");
    t("control: an empty draft on another branch is not STANDING", rowOf(res, 74)?.disposition !== "STANDING");
    t("a PR touched under 3 hours ago and not declared is flagged, not classified IN-FLIGHT", (() => { const r = rowOf(res, 70); return r.disposition !== "IN-FLIGHT"; })());
  }
  {
    const w = worldFx({
      prs: [
        prFx(80, { files: [{ filename: "docs/notes.md" }, { filename: "docs/b.md" }], changedFiles: 3 }),
        prFx(81),
        prFx(82, { comments: [{ id: 1, in_reply_to_id: null }, { id: 2, in_reply_to_id: 1 }] }),
        prFx(83, { base: "feature/other" }),
        prFx(84, { files: [{ filename: "native/ios/EnterpriseShell/App.swift" }] }),
        prFx(85, { files: [{ filename: "native/ios/EnterpriseShell/App.swift" }], checks: checksFx({ mac: "success", extra: [{ name: "Android app (assembleDebug)", state: "success" }] }) }),
        prFx(86, { body: "Fixes a thing." }),
        prFx(88, { ref: "claude/from-a-fork", fork: true }),
        prFx(89, { unknownReads: 4 }),
        prFx(90, { unknownReads: 99 }),
      ],
      fail: [{ match: /\/pulls\/81\/files$/, status: 500 }],
    });
    const res = await runFx_(w, []);
    const nan = await runFx_(worldFx({ prs: [prFx(87, { updated: "garbage" })] }), []);
    t("a file list shorter than the PR reports is UNKNOWN, never classified", rowOf(res, 80)?.disposition === "UNKNOWN" && /changed-file list/.test(rowOf(res, 80).reason), JSON.stringify(rowOf(res, 80)));
    t("a file list that fails to load (HTTP 500 after retries) is UNKNOWN and the error is on the row", rowOf(res, 81)?.disposition === "UNKNOWN" && rowOf(res, 81).readErrors.some((e) => /^files:/.test(e)), JSON.stringify(rowOf(res, 81)));
    t("a review thread whose resolution REST cannot show keeps a PR from LAND", rowOf(res, 82)?.disposition === "UNKNOWN" && rowOf(res, 82).blockers.some((b) => /review thread/.test(b)) && rowOf(res, 82).threads.method === "heuristic", JSON.stringify(rowOf(res, 82)));
    t("a stacked PR (base is not mainline) is not LAND", rowOf(res, 83)?.disposition === "UNKNOWN" && rowOf(res, 83).blockers.some((b) => /stacked on/.test(b)));
    t("a native-touching PR with no client suites is not LAND", rowOf(res, 84)?.disposition === "UNKNOWN" && rowOf(res, 84).blockers.some((b) => /native client suites absent/.test(b)));
    t("control: the same PR with a green client suite is LAND", landable(res, 85), JSON.stringify(rowOf(res, 85)));
    t("a PR whose updated_at is not a date is UNKNOWN, never aged as zero", rowOf(nan, 87)?.disposition === "UNKNOWN" && /not a date/.test(rowOf(nan, 87).reason), JSON.stringify(rowOf(nan, 87)));
    t("a mergeable_state GitHub has not computed yet is read again after a pause, and then lands", landable(res, 89) && rowOf(res, 89).mergeableState === "clean" && res.log.filter((l) => /\/pulls\/89$/.test(l.path)).length === 5, JSON.stringify(rowOf(res, 89)));
    t("a mergeable_state that never computes stays a blocker, not a guess", rowOf(res, 90)?.disposition === "UNKNOWN" && rowOf(res, 90).blockers.some((b) => /not computed/.test(b)), JSON.stringify(rowOf(res, 90)));
    t("a PR from a fork is not a lane's own, whatever its branch is called", rowOf(res, 88)?.lane === "other" && rowOf(res, 88).disposition === "OWNER-MERGE", JSON.stringify(rowOf(res, 88)));
    t("a body that never mentions preflight and breadth leaves DR-037 condition 2 unverified", rowOf(res, 86)?.disposition === "UNKNOWN" && rowOf(res, 86).blockers.some((b) => /cond\. 2/.test(b)));
    const exact = await runFx_(w, ["--threads-file", "/virtual/threads.json"], { textFiles: { "/virtual/threads.json": JSON.stringify({ 82: { total: 1, unresolved: 0 } }) } });
    t("exact thread counts from --threads-file (0 unresolved) let that PR land", landable(exact, 82) && rowOf(exact, 82).threads.method === "file", JSON.stringify(rowOf(exact, 82)));
    const exactOpen = await runFx_(w, ["--threads-file", "/virtual/threads.json"], { textFiles: { "/virtual/threads.json": JSON.stringify({ 82: { total: 1, unresolved: 2 } }) } });
    t("exact thread counts with 2 unresolved block it", rowOf(exactOpen, 82)?.disposition === "UNKNOWN" && rowOf(exactOpen, 82).blockers.some((b) => /2 unresolved/.test(b)));
  }
  {
    const tickFiles = [{ filename: "docs/agent/objective-state.json" }, { filename: "artifacts/sim-requests/obj-1.json" }];
    const w = worldFx({
      prs: [
        prFx(90, { ref: "mac/tick-20260930T000000Z", files: tickFiles, sha: shaFx(90) }),
        prFx(91, { ref: "mac/tick-20260930T010000Z", files: [{ filename: "docs/agent/objective-state.json" }, { filename: "artifacts/sim-requests/obj-2.json", status: "added" }], sha: shaFx(91) }),
        prFx(92, { ref: "mac/tick-20260930T020000Z", files: [{ filename: "docs/agent/other-state.json" }], sha: shaFx(92) }),
        prFx(93, { ref: "mac/tick-20260930T030000Z", files: [{ filename: "docs/agent/garbled-date.json" }], sha: shaFx(93) }),
      ],
      headDate: { [shaFx(90)]: agoIso(20), [shaFx(91)]: agoIso(20), [shaFx(92)]: agoIso(20), [shaFx(93)]: agoIso(20) },
      commitsByPath: {
        "docs/agent/garbled-date.json": [{ sha: "e".repeat(40), commit: { committer: { date: "garbage" }, message: "a commit whose date cannot be read" } }],
        "docs/agent/objective-state.json": [{ sha: "c".repeat(40), commit: { committer: { date: agoIso(1) }, message: "Merge pull request #1583 from x/y" } }],
        "docs/agent/other-state.json": [{ sha: "d".repeat(40), commit: { committer: { date: agoIso(30) }, message: "older than the PR head" } }],
      },
      contents: new Set(["artifacts/sim-results/obj-1.json"]),
    });
    const res = await runFx_(w, []);
    t("a mac/tick PR whose files were rewritten later or whose sim-request result exists is SUPERSEDED", rowOf(res, 90)?.disposition === "SUPERSEDED" && rowOf(res, 90).reason === "mac-tick-state-snapshot-superseded", JSON.stringify(rowOf(res, 90)));
    t("its evidence names the rewriting commit's PR and the fulfilled request", /by #1583/.test(rowOf(res, 90).evidence.join(" ")) && /already fulfilled/.test(rowOf(res, 90).evidence.join(" ")));
    t("control: a tick whose sim-request has no result on mainline is not SUPERSEDED", rowOf(res, 91)?.disposition !== "SUPERSEDED");
    t("control: a tick whose file mainline did not rewrite after the head is not SUPERSEDED", rowOf(res, 92)?.disposition !== "SUPERSEDED");
    t("a tick whose mainline commit date cannot be read is not SUPERSEDED, and the row says why", rowOf(res, 93)?.disposition !== "SUPERSEDED" && rowOf(res, 93).flags.some((x) => /no readable date/.test(x)), JSON.stringify(rowOf(res, 93)));
  }

  // ── round 2: the second refute's findings, each beside a control ──
  {
    // the review-comment count the PR itself reports
    const two = [{ id: 1, in_reply_to_id: null }, { id: 2, in_reply_to_id: 1 }];
    const w = worldFx({
      prs: [
        prFx(300, { comments: two, reportedComments: 2, shortComments: true }),
        prFx(301, { comments: two, reportedComments: 2 }),
        prFx(302, { comments: [], reportedComments: 0 }),
        prFx(303, { comments: two, reportedComments: 1 }),
        prFx(304, { comments: [], omitReviewComments: true }),
      ],
    });
    const res = await runFx_(w, []);
    t("review comments listed short of the PR's own count (reports 2, page empty): not LAND, the read error is on the row", rowOf(res, 300)?.disposition === "UNKNOWN" && rowOf(res, 300).threads.method === "unreadable" && rowOf(res, 300).readErrors.some((e) => /^comments: read 0 review comment\(s\) but the PR reports 2/.test(e)) && rowOf(res, 300).blockers.some((b) => /review comments unreadable/.test(b)), JSON.stringify(rowOf(res, 300)));
    t("control: the same two comments read in full are counted (heuristic, one root), with no read error", rowOf(res, 301)?.threads.method === "heuristic" && rowOf(res, 301).threads.roots === 1 && rowOf(res, 301).readErrors.length === 0, JSON.stringify(rowOf(res, 301)));
    t("control: zero reported and zero listed is LAND", landable(res, 302), JSON.stringify(rowOf(res, 302)));
    t("more comments listed than the PR reports is also a read error", rowOf(res, 303)?.disposition === "UNKNOWN" && rowOf(res, 303).readErrors.some((e) => /^comments: read 2 review comment\(s\) but the PR reports 1/.test(e)), JSON.stringify(rowOf(res, 303)));
    t("a PR detail with no review_comments count leaves the list unchecked: a read error, not LAND", rowOf(res, 304)?.disposition === "UNKNOWN" && rowOf(res, 304).readErrors.some((e) => /no review_comments count/.test(e)), JSON.stringify(rowOf(res, 304)));
  }
  {
    // the newest run of each check name is the verdict; and the guards the first refute found unpinned
    const gate = (id, state) => runFx(id, GATING_CHECK, state);
    const mac = (id, state) => runFx(id, "PR — Mac-only checks (full-clone provenance, preflight on macOS)", state);
    const w = worldFx({
      prs: [
        prFx(310, { checks: [gate(1000, "failure"), gate(1001, "success"), mac(1002, "success")] }),
        prFx(311, { checks: [gate(1001, "failure"), gate(1000, "success"), mac(1002, "success")] }),
        prFx(312, { idle: 20, checks: [runFx(2000, "CodeQL", "failure"), runFx(2001, "CodeQL", "success"), gate(1000, "success"), mac(1002, "success")] }),
        prFx(313, { idle: 20, checks: [runFx(2001, "CodeQL", "failure"), runFx(2000, "CodeQL", "success"), gate(1000, "success"), mac(1002, "success")] }),
        prFx(314, { checks: [gate(1000, "success"), gate(1000, "failure"), mac(1002, "success")] }),
        prFx(315, { checks: [gate(1000, "failure"), gate(1000, "success"), mac(1002, "success")] }),
        prFx(316, { checksTotal: 9 }),
        prFx(317, { omitChangedFiles: true }),
        prFx(318, { checks: checksFx({ mac: "failure" }) }),
        prFx(319, { checks: checksFx({ mac: null }) }),
        prFx(320, { checks: checksFx({ mac: "in_progress" }) }),
        prFx(321, { mergeable_state: "dirty" }),
      ],
    });
    const res = await runFx_(w, []);
    t("an older failed gating run is history when a newer run of the same check passed: LAND", landable(res, 310), JSON.stringify(rowOf(res, 310)));
    t("control: the NEWEST gating run failed (older one passed): not LAND, blocker names the failure", rowOf(res, 311)?.disposition === "UNKNOWN" && rowOf(res, 311).blockers.includes("gating check failure"), JSON.stringify(rowOf(res, 311)));
    t("a PR idle 20 days whose older CodeQL run failed and newest passed is not STALE", rowOf(res, 312)?.disposition !== "STALE" && landable(res, 312), JSON.stringify(rowOf(res, 312)));
    t("control: idle 20 days with the NEWEST CodeQL run failed is STALE (idle-over-14d-red)", rowOf(res, 313)?.disposition === "STALE" && rowOf(res, 313).reason === "idle-over-14d-red", JSON.stringify(rowOf(res, 313)));
    t("two gating runs with the same id keep the worse state, whichever order they arrive in", rowOf(res, 314)?.disposition === "UNKNOWN" && rowOf(res, 315)?.disposition === "UNKNOWN" && rowOf(res, 314).blockers.includes("gating check failure") && rowOf(res, 315).blockers.includes("gating check failure"));
    t("a check-runs total_count larger than the runs listed is a read error: not LAND, checks unreadable", rowOf(res, 316)?.disposition === "UNKNOWN" && rowOf(res, 316).readErrors.some((e) => /^checks: .*read 2 of total_count 9/.test(e)) && rowOf(res, 316).blockers.some((b) => /checks unreadable/.test(b)), JSON.stringify(rowOf(res, 316)));
    t("a PR detail without changed_files is not a complete file list: UNKNOWN, never classified", rowOf(res, 317)?.disposition === "UNKNOWN" && /changed-file list could not be read in full/.test(rowOf(res, 317).reason), JSON.stringify(rowOf(res, 317)));
    t("a failed Mac-only check blocks LAND", rowOf(res, 318)?.disposition === "UNKNOWN" && rowOf(res, 318).blockers.includes("Mac-only check failure"), JSON.stringify(rowOf(res, 318)));
    t("control: a PR with no Mac-only check at all lands", landable(res, 319), JSON.stringify(rowOf(res, 319)));
    t("a conflicting (mergeable_state=dirty) fresh PR is not LAND, and the blocker says so (control: a clean one lands, PR 319)", rowOf(res, 321)?.disposition === "UNKNOWN" && rowOf(res, 321).blockers.some((b) => /conflicting with SignalGrid_Alpha/.test(b)), JSON.stringify(rowOf(res, 321)));
    t("a Mac-only check still running blocks LAND", rowOf(res, 320)?.disposition === "UNKNOWN" && rowOf(res, 320).blockers.includes("Mac-only check in_progress"), JSON.stringify(rowOf(res, 320)));
  }
  {
    // the mailbox PR is STANDING or UNKNOWN, never LAND
    const emptyDraft = (n, extra = {}) => prFx(n, { ref: "lane/mailbox", draft: true, files: [], changedFiles: 0, title: "Lane mailbox", ...extra });
    const w = worldFx({
      prs: [
        prFx(439, { ref: "lane/mailbox", draft: false, files: [{ filename: "docs/notes.md" }] }),
        prFx(441, { ref: "lane/cloud-mail-20261022-000000Z" }),
        emptyDraft(442, { idle: 20, mergeable_state: "dirty" }),
      ],
    });
    const res = await runFx_(w, []);
    t("the mailbox PR marked ready and carrying a file is UNKNOWN, never LAND", rowOf(res, 439)?.disposition === "UNKNOWN" && /standing mailbox branch/.test(rowOf(res, 439).reason) && /not a draft/.test(rowOf(res, 439).reason), JSON.stringify(rowOf(res, 439)));
    t("control: a lane/cloud-mail-* PR with the same file lands", landable(res, 441), JSON.stringify(rowOf(res, 441)));
    t("another PR on the mailbox branch is UNKNOWN even when idle and conflicting, and is never 'revived' as LAND (natural stays unset)", rowOf(res, 442)?.disposition === "UNKNOWN" && rowOf(res, 442).natural === null, JSON.stringify(rowOf(res, 442)));
    const noFile = await runFx_(worldFx({ prs: [emptyDraft(439)] }), [], { mailbox: null });
    t("with lane-mailbox.json unreadable, the mailbox-branch PR is UNKNOWN (neither STANDING nor LAND)", rowOf(noFile, 439)?.disposition === "UNKNOWN" && /unreadable/.test(rowOf(noFile, 439).reason), JSON.stringify(rowOf(noFile, 439)));
    const ok = await runFx_(worldFx({ prs: [emptyDraft(439)] }), []);
    t("control: the same draft with the file readable is STANDING", rowOf(ok, 439)?.disposition === "STANDING");
  }
  {
    // a short branch page (page 2 of 250 returns 50) is a read error, as the closed-PR read already was
    const many = (n) => [{ name: BASE_FX, commit: { sha: BASE_SHA_FX }, protected: true }, ...Array.from({ length: n - 1 }, (_, i) => ({ name: `claude/b-${String(i).padStart(3, "0")}`, commit: { sha: shaFx(5000 + i) }, protected: false }))];
    const cut = await runFx_(worldFx({ prs: [prFx(1)], branches: many(250), branchCut: { page: 2, keep: 50 } }), []);
    t("a short branch page (page 2 of 250 returns 50) is refused: exit 3, no queue, the counts named", cut.code === 3 && cut.stdout === "" && /read 150 branches but the repository reports 250/.test(cut.stderr), cut.stderr);
    const whole = await runFx_(worldFx({ prs: [prFx(1)], branches: many(250) }), []);
    t("control: the same 250 branches read in full are reported as 250", whole.code === 0 && whole.report.counts.branches.total === 250, whole.stderr);
  }
  {
    // O18 and rule 2: a tick PR that removes a file, and an unsuperseded tick PR
    const later = (sha) => [{ sha, commit: { committer: { date: agoIso(1) }, message: "Merge pull request #1600 from x/y" } }];
    const w = worldFx({
      prs: [
        prFx(120, { ref: "mac/tick-20260930T000000Z", files: [{ filename: "docs/agent/rewritten.json" }, { filename: "docs/agent/gone.json", status: "removed" }], sha: shaFx(120) }),
        prFx(121, { ref: "mac/tick-20260930T010000Z", files: [{ filename: "docs/agent/rewritten.json" }, { filename: "docs/agent/gone.json" }], sha: shaFx(121) }),
      ],
      headDate: { [shaFx(120)]: agoIso(20), [shaFx(121)]: agoIso(20) },
      commitsByPath: { "docs/agent/rewritten.json": later("a".repeat(40)), "docs/agent/gone.json": later("f".repeat(40)) },
    });
    const res = await runFx_(w, []);
    t("a mac/tick PR that REMOVES a file is not SUPERSEDED: removal is not rewriting", rowOf(res, 120)?.disposition === "MAC-ASK-NEEDED", JSON.stringify(rowOf(res, 120)));
    t("control: the same tick with that file modified (and rewritten later on mainline) is SUPERSEDED", rowOf(res, 121)?.disposition === "SUPERSEDED", JSON.stringify(rowOf(res, 121)));
  }
  {
    // the report never prints the absolute path of the checkout (it is committed to a public page)
    const gitSh = (args) => {
      const a = args.slice(2);
      if (a[0] === "rev-parse" && a[1] === "--is-inside-work-tree") return { status: 0, stdout: "true\n" };
      if (a[0] === "rev-parse" && a[1] === "--verify") return { status: 0, stdout: `${BASE_SHA_FX}\n` };
      if (a[0] === "rev-parse" && a[1] === "--is-shallow-repository") return { status: 0, stdout: "true\n" };
      return { status: 128, stdout: "" };
    };
    const w = worldFx({ prs: [prFx(1)] });
    const here = await runFx_(w, [], { gitExec: gitSh });
    const elsewhere = await runFx_(w, ["--repo-dir", "/virtual/other-checkout"], { gitExec: gitSh });
    const shown = (r) => `${r.report.sources.ancestry}\n${renderSnapshot(r.report)}\n${renderMarkdown(r.report)}`;
    t("the report says 'this checkout', never the absolute path of the checkout", /this checkout is shallow/.test(here.report.sources.ancestry) && !shown(here).includes(REPO_ROOT) && !/(^|[\s(])\/(tmp|home|Users|var|root)\//.test(shown(here)), here.report.sources.ancestry);
    t("control: a --repo-dir checkout is named by the flag, and its path is not printed either", /the --repo-dir checkout is shallow/.test(elsewhere.report.sources.ancestry) && !shown(elsewhere).includes("/virtual/other-checkout"), elsewhere.report.sources.ancestry);
  }
  {
    // a read the whole queue depends on that GitHub refuses: a message and an exit code, not "unexpected failure"
    const forbidden = { match: /\/repos\/acme\/widgets\/pulls$/, status: 403, message: "Resource not accessible by personal access token" };
    const denied = await runFx_(worldFx({ prs: [prFx(1)], fail: [forbidden] }), []);
    t("a 403 that is not a rate limit, on the open-PR list: exit 2 with a message, no queue, not 'unexpected failure'", denied.code === 2 && denied.stdout === "" && /refused or failed a read/.test(denied.stderr) && /403/.test(denied.stderr) && !/unexpected failure/.test(denied.stderr), denied.stderr);
    const flaky = await runFx_(worldFx({ prs: [prFx(1)], fail: [{ match: /\/repos\/acme\/widgets\/pulls$/, status: 502 }] }), []);
    t("a persistent 502 on the open-PR list: exit 3 with a message, no queue", flaky.code === 3 && flaky.stdout === "" && /502/.test(flaky.stderr), flaky.stderr);
    const missing = await runFx_(worldFx({ prs: [prFx(1)], fail: [{ match: /\/repos\/acme\/widgets$/, status: 404 }] }), []);
    t("a 404 on the repository read: exit 2 (the token cannot see the repository), no queue", missing.code === 2 && missing.stdout === "" && /404/.test(missing.stderr), missing.stderr);
    const oneFile = await runFx_(worldFx({ prs: [prFx(1), prFx(2)], fail: [{ match: /\/pulls\/1\/files$/, status: 403, message: "forbidden" }] }), []);
    t("control: a 403 on ONE PR's file list is that PR's UNKNOWN row, and the rest of the queue still prints", oneFile.code === 0 && rowOf(oneFile, 1)?.disposition === "UNKNOWN" && landable(oneFile, 2), oneFile.stderr);
  }
  {
    // finding 1: the PR that adds a first-party skill edits the publication boundary, so the tool itself says it is the owner's
    const thisPr = [".claude/skills/backlog-landing/SKILL.md", "docs/agent/BACKLOG_LANDING.md", "scripts/backlog-triage.mjs", "scripts/publication-boundary.mjs"].map((filename) => ({ filename }));
    const w = worldFx({ prs: [prFx(130, { files: thisPr }), prFx(131, { files: thisPr.slice(0, 3) })] });
    const res = await runFx_(w, []);
    t("a lane PR that edits scripts/publication-boundary.mjs (what a first-party skill needs) is OWNER-MERGE by the tool's rule", rowOf(res, 130)?.disposition === "OWNER-MERGE" && rowOf(res, 130).reason === "owner-named-surface" && rowOf(res, 130).files.ownerNamed.some((o) => o.rule === "publication boundary"), JSON.stringify(rowOf(res, 130)));
    t("control: the same list without the publication-boundary file is not held back by an owner-named surface", rowOf(res, 131)?.disposition !== "OWNER-MERGE" || rowOf(res, 131).files.ownerNamed.length === 0, JSON.stringify(rowOf(res, 131)));
  }
  {
    // the skill and the page say what the tool does (a doc that drifts from the tool fails here)
    const skill = readFileSync(SKILL_FILE, "utf8");
    const page = readFileSync(PAGE_FILE, "utf8");
    t("control: the classifier does judge that old path (a rename away from lib/ is DECISION_PATH)", classifyFiles([{ filename: "docs/moved.md" }, { filename: "lib/signalgrid-core/src/old.ts" }]).categories.includes("DECISION_PATH") && classifyFiles([{ filename: "docs/moved.md" }]).tier === "autonomous");
    t("the skill and the page both say this PR is the owner's, by the tool's rule", /this PR is the owner's, by the tool's rule/.test(skill) && /this PR is the owner's, by the tool's rule/.test(page));
    t("the skill has the step that confirms a Mac ask in mail before anything lands", /artifacts\/lane-messages\/mac-\*\.json/.test(skill) && /body line/.test(skill));
    t("the skill and the page say which tick-PR rule holds (the stricter one) against LANE_COORDINATION rule 2", /rule 2/.test(skill) && /stricter/.test(skill) && /rule 2/.test(page) && /stricter/.test(page));
    t("the page documents the 403 behaviour and the comment-count check", /403/.test(page) && /review_comments/.test(page));
  }

  // ── round 3: the third refute's findings, each beside a control ──
  {
    // finding 1: every launch-profile, launch-claims, launch-proof-bindings and publication-boundary file is owner-named, whatever its module extension
    const families = [
      ["launch profile (code)", "scripts/launch-profile"],
      ["launch-claims gate", "scripts/check-launch-claims"],
      ["launch proof bindings", "scripts/check-launch-proof-bindings"],
      ["publication boundary", "scripts/publication-boundary"],
      ["ratchet-file reader (the launch-claims and launch-proof-bindings gates read their ceiling files through it)", "scripts/lib/ratchet-read"],
    ];
    const missing = [];
    for (const [rule, stem] of families) {
      for (const ext of [".mjs", ".cjs", ".js", ".ts", ".mts", ".cts", ".d.ts", ".d.mts", ".d.cts", ".json"]) {
        const got = classifyFiles([{ filename: `${stem}${ext}` }]).ownerNamed.map((o) => o.rule);
        if (!got.includes(rule)) missing.push(`${stem}${ext} -> ${got.join("+") || "NONE"}`);
      }
    }
    t("every module extension (.mjs .cjs .js .ts .mts .cts .d.ts .d.mts .d.cts .json) of the five owner-named code families is owner-named", missing.length === 0, missing.join("; "));
    t("control: files of another name with those extensions are not owner-named", classifyFiles([{ filename: "scripts/launch-pad.d.mts" }, { filename: "scripts/check-something.mts" }, { filename: "scripts/profile-launch.cts" }]).ownerNamed.length === 0);
    const listed = realGitExec(["-C", REPO_ROOT, "ls-files"]);
    const tracked = listed.status === 0 ? listed.stdout.split("\n").filter(Boolean) : [];
    const named = tracked.filter((p) => /launch[-_]profile|launch[-_]claims|launch[-_]proof[-_]bindings|publication[-_]boundary|ratchet[-_]read/i.test(p.split("/").pop()));
    const uncovered = named.filter((p) => classifyFiles([{ filename: p }]).ownerNamed.length === 0);
    t(`every tracked file whose name holds launch-profile, launch-claims, launch-proof-bindings, publication-boundary or ratchet-read (${named.length} of them) is owner-named`, listed.status === 0 && ["scripts/launch-profile.d.mts", "scripts/launch-profile.mjs", "scripts/publication-boundary.mjs", "scripts/lib/ratchet-read.mjs"].every((p) => named.includes(p)) && uncovered.length === 0, listed.status !== 0 ? "git ls-files failed, so the tracked files could not be listed" : `not owner-named: ${uncovered.join(", ")}`);
    const w = worldFx({ prs: [prFx(400, { files: [{ filename: "scripts/launch-profile.d.mts" }] }), prFx(401, { files: [{ filename: "scripts/launch-profile.mjs" }] }), prFx(402, { files: [{ filename: "scripts/launch-pad.d.mts" }] })] });
    const res = await runFx_(w, []);
    t("a PR that changes only scripts/launch-profile.d.mts (the file that declares the profile's shape) is OWNER-MERGE, never LAND", rowOf(res, 400)?.disposition === "OWNER-MERGE" && rowOf(res, 400).reason === "owner-named-surface", JSON.stringify(rowOf(res, 400)));
    t("control: scripts/launch-profile.mjs is OWNER-MERGE the same way", rowOf(res, 401)?.disposition === "OWNER-MERGE" && rowOf(res, 401).reason === "owner-named-surface");
    t("control: an ordinary .d.mts of another name lands (only the name makes a file owner-named)", landable(res, 402), JSON.stringify(rowOf(res, 402)));
  }
  {
    // finding 2: the previous names of a renamed file count for the owner-named list and for the native-path test
    const w = worldFx({
      prs: [
        prFx(410, { files: [{ filename: "scripts/check-x.mjs", status: "renamed", previous: "scripts/check-launch-claims.mjs" }] }),
        prFx(411, { files: [{ filename: "scripts/check-x.mjs", status: "renamed", previous: "scripts/check-y.mjs" }] }),
        prFx(412, { files: [{ filename: "docs/app.md", status: "renamed", previous: "native/ios/EnterpriseShell/App.swift" }] }),
        prFx(413, { files: [{ filename: "docs/app.md", status: "renamed", previous: "docs/old-app.md" }] }),
        prFx(414, { files: [{ filename: "docs/app.md", status: "renamed", previous: "native/ios/EnterpriseShell/App.swift" }], checks: checksFx({ mac: "success", extra: [{ name: "Android app (assembleDebug)", state: "success" }] }) }),
      ],
    });
    const res = await runFx_(w, []);
    t("a file renamed away from an owner-named gate (launch-claims) is OWNER-MERGE: the owner-named list is judged on the old path too", rowOf(res, 410)?.disposition === "OWNER-MERGE" && rowOf(res, 410).reason === "owner-named-surface", JSON.stringify(rowOf(res, 410)));
    t("control: a rename between two ordinary gates lands", landable(res, 411), JSON.stringify(rowOf(res, 411)));
    t("a file renamed out of native/** is still a native change: no client suites, not LAND", rowOf(res, 412)?.disposition === "UNKNOWN" && rowOf(res, 412).blockers.some((b) => /native client suites absent/.test(b)), JSON.stringify(rowOf(res, 412)));
    t("control: a rename between two docs files lands", landable(res, 413), JSON.stringify(rowOf(res, 413)));
    t("control: the native rename with a green client suite lands", landable(res, 414), JSON.stringify(rowOf(res, 414)));
  }
  {
    // finding 2: the mailbox PR is the one lane-mailbox.json names (number and branch), and every part of STANDING is required
    const mailboxPr = (n, o = {}) => prFx(n, { ref: "lane/mailbox", draft: true, files: [], changedFiles: 0, title: "Lane mailbox", ...o });
    const wake = { pr: 500, branch: "lane/cloud-wake" };
    const named = await runFx_(worldFx({ prs: [prFx(500, { ref: "lane/cloud-wake" })] }), [], { mailbox: wake });
    t("the mailbox branch is the one lane-mailbox.json names: #500 from lane/cloud-wake, ready with a file, is UNKNOWN, never LAND", rowOf(named, 500)?.disposition === "UNKNOWN" && /standing mailbox branch \(lane\/cloud-wake\)/.test(rowOf(named, 500).reason) && rowOf(named, 500).natural === null, JSON.stringify(rowOf(named, 500)));
    const plain = await runFx_(worldFx({ prs: [prFx(500, { ref: "lane/cloud-wake" })] }), []);
    t("control: with the default mailbox file the same PR is an ordinary cloud-lane PR and lands", landable(plain, 500), JSON.stringify(rowOf(plain, 500)));
    const standing = await runFx_(worldFx({ prs: [prFx(500, { ref: "lane/cloud-wake", draft: true, files: [], changedFiles: 0 })] }), [], { mailbox: wake });
    t("control: the same PR as a draft with no files is STANDING", rowOf(standing, 500)?.disposition === "STANDING", JSON.stringify(rowOf(standing, 500)));
    const oneFile = await runFx_(worldFx({ prs: [mailboxPr(439, { files: [{ filename: "docs/notes.md" }], changedFiles: 1 })] }), []);
    t("the mailbox PR as a draft that carries a file is UNKNOWN, not STANDING", rowOf(oneFile, 439)?.disposition === "UNKNOWN" && /carries 1 changed file/.test(rowOf(oneFile, 439).reason), JSON.stringify(rowOf(oneFile, 439)));
    const ready = await runFx_(worldFx({ prs: [mailboxPr(439, { draft: false })] }), []);
    t("the mailbox PR marked ready with no files is UNKNOWN, not STANDING", rowOf(ready, 439)?.disposition === "UNKNOWN" && /not a draft/.test(rowOf(ready, 439).reason), JSON.stringify(rowOf(ready, 439)));
    const unread = await runFx_(worldFx({ prs: [mailboxPr(439, { changedFiles: 2 })] }), []);
    t("the mailbox PR whose file list could not be read in full (0 listed of 2) is UNKNOWN, not STANDING", rowOf(unread, 439)?.disposition === "UNKNOWN" && /could not be read in full/.test(rowOf(unread, 439).reason), JSON.stringify(rowOf(unread, 439)));
    const ok = await runFx_(worldFx({ prs: [mailboxPr(439)] }), []);
    t("control: the draft with no files and the right number and branch is STANDING", rowOf(ok, 439)?.disposition === "STANDING");
  }
  {
    // finding 2: a PR that reports 0 review comments is still read; and red and pending are taken from the newest run
    const two = [{ id: 1, in_reply_to_id: null }, { id: 2, in_reply_to_id: 1 }];
    const gate = (id, state) => runFx(id, GATING_CHECK, state);
    const lint = (id, state) => runFx(id, "lint", state);
    const macName = "PR — Mac-only checks (full-clone provenance, preflight on macOS)";
    const w = worldFx({
      prs: [
        prFx(420, { comments: two, reportedComments: 0 }),
        prFx(421, { comments: [], reportedComments: 0 }),
        prFx(430, { idle: 20, checks: checksFx({ mac: "failure" }) }),
        prFx(431, { idle: 20, checks: checksFx({ mac: "success" }) }),
        prFx(432, { checks: [gate(1000, "success"), runFx(1001, macName, "success"), lint(2000, "in_progress"), lint(2001, "success")] }),
        prFx(433, { checks: [gate(1000, "success"), runFx(1001, macName, "success"), lint(2000, "success"), lint(2001, "in_progress")] }),
      ],
    });
    const res = await runFx_(w, []);
    t("a PR that reports 0 review comments but whose list holds 2 is a read error: UNKNOWN, never LAND", rowOf(res, 420)?.disposition === "UNKNOWN" && rowOf(res, 420).readErrors.some((e) => /^comments: read 2 review comment\(s\) but the PR reports 0/.test(e)), JSON.stringify(rowOf(res, 420)));
    t("control: 0 reported and 0 listed lands", landable(res, 421), JSON.stringify(rowOf(res, 421)));
    t("a Mac-only check whose newest run failed makes an idle PR red: STALE (idle-over-14d-red)", rowOf(res, 430)?.disposition === "STALE" && rowOf(res, 430).reason === "idle-over-14d-red" && rowOf(res, 430).redChecks.some((c) => /Mac-only checks.*=failure$/.test(c)), JSON.stringify(rowOf(res, 430)));
    t("control: the same idle PR with a passing Mac-only check is not STALE", rowOf(res, 431)?.disposition !== "STALE" && landable(res, 431), JSON.stringify(rowOf(res, 431)));
    t("a check whose older run is still in progress and whose newest run passed is not 'not finished': LAND", landable(res, 432), JSON.stringify(rowOf(res, 432)));
    t("control: the NEWEST run of that check still running blocks LAND", rowOf(res, 433)?.disposition === "UNKNOWN" && rowOf(res, 433).blockers.some((b) => /checks not finished: lint=in_progress/.test(b)), JSON.stringify(rowOf(res, 433)));
  }
  {
    // finding 2: every negator the ask detector knows turns a sentence that would be an ask into a non-ask
    const base = "The cloud lane may land this PR now";
    t(`ask detector (control): ${JSON.stringify(base)} is an ask`, bodyAsksCloudToLand(base) === true);
    for (const tail of ["not later", "never later", "no questions", "the Mac cannot", "the Mac can't", "the Mac won't", "the Mac don't", "the Mac do not", "without delay", "the Mac isn't"]) {
      t(`ask detector: ${JSON.stringify(`${base}, ${tail}`)} is not an ask`, bodyAsksCloudToLand(`${base}, ${tail}`) === false);
    }
  }
  {
    // finding 2 (K19) and finding 11: the report names no path when local git cannot be used, whatever the reason
    const shown = (r) => `${r.report.sources.ancestry}\n${renderSnapshot(r.report)}\n${renderMarkdown(r.report)}`;
    const w = worldFx({ prs: [prFx(1)] });
    const none = await runFx_(w, []);
    const noneElsewhere = await runFx_(w, ["--repo-dir", "/virtual/other-checkout"]);
    t("when the directory is not a git checkout the ancestry line says so and names no path", /local git: not used \(not a git checkout\); /.test(none.report.sources.ancestry) && !shown(none).includes(REPO_ROOT) && !shown(noneElsewhere).includes("/virtual/other-checkout"), none.report.sources.ancestry);
    const noRef = await runFx_(w, [], { gitExec: (args) => (args.slice(2)[1] === "--is-inside-work-tree" ? { status: 0, stdout: "true\n" } : { status: 1, stdout: "" }) });
    t("when the checkout has no local mainline ref the reason names the ref, not the checkout", /not used \(no local refs\/remotes\/origin\/SignalGrid_Alpha\)/.test(noRef.report.sources.ancestry) && !shown(noRef).includes(REPO_ROOT), noRef.report.sources.ancestry);
    const thrown = await runFx_(w, [], { gitExec: () => { throw Object.assign(new Error(`spawn failed in ${REPO_ROOT}`), { code: "ENOENT" }); } });
    t("when running git throws, the reason is the error code and never the message (which can hold the checkout's path)", /not used \(git unavailable \(ENOENT\)\)/.test(thrown.report.sources.ancestry) && !shown(thrown).includes(REPO_ROOT), thrown.report.sources.ancestry);
  }
  {
    // finding 2: the short-page guards, each with the control that reads in full
    const closedRows = (n) => Array.from({ length: n }, (_, i) => ({ number: 1000 + i, state: "closed", merged_at: null, head: { ref: `claude/old-${i}`, sha: shaFx(9000 + i), repo: { full_name: REPO_FX } } }));
    const cut = await runFx_(worldFx({ prs: [prFx(1)], closed: closedRows(150), closedCut: { page: 2, keep: 20 } }), []);
    t("a short closed-PR page (page 2 of 150 returns 20) is refused: exit 3, no queue, the counts named", cut.code === 3 && cut.stdout === "" && /read 120 closed PRs but the list reports 150/.test(cut.stderr), cut.stderr);
    const whole = await runFx_(worldFx({ prs: [prFx(1)], closed: closedRows(150) }), []);
    t("control: the same 150 closed PRs read in full print a queue", whole.code === 0 && whole.report?.prs.length === 1, whole.stderr);
    const noBase = await runFx_(worldFx({ prs: [prFx(1)], branches: [{ name: "claude/a", commit: { sha: shaFx(1) }, protected: false }, { name: "claude/b", commit: { sha: shaFx(2) }, protected: false }] }), []);
    t("a branch listing that does not contain the default branch is refused: exit 3, no queue", noBase.code === 3 && noBase.stdout === "" && /does not contain SignalGrid_Alpha/.test(noBase.stderr), noBase.stderr);
  }
  {
    // finding 3: four facts the tool cannot read tighten the answer instead of loosening it
    const w = worldFx({
      prs: [
        prFx(440, { omitChecksTotal: true }),
        prFx(441),
        prFx(442, { omitBase: true }),
        prFx(443, { omitBaseInList: true }),
        prFx(444, { checks: checksFx({ mac: "success", extra: [{ name: "lint", state: "cancelled" }] }) }),
        prFx(445, { checks: checksFx({ mac: "success", extra: [{ name: "lint", state: "stale" }] }) }),
        prFx(446, { checks: checksFx({ mac: "success", extra: [{ name: "lint", state: null }] }) }),
        prFx(447, { checks: checksFx({ mac: "success", extra: [{ name: "lint", state: "neutral" }, { name: "docs", state: "skipped" }] }) }),
        prFx(448, { checks: checksFx({ gating: "cancelled", mac: "success" }) }),
      ],
    });
    const res = await runFx_(w, []);
    t("a check-runs envelope with no total_count cannot be checked for completeness: a read error, not LAND", rowOf(res, 440)?.disposition === "UNKNOWN" && rowOf(res, 440).readErrors.some((e) => /^checks: .*carried no total_count/.test(e)) && rowOf(res, 440).blockers.some((b) => /checks unreadable/.test(b)), JSON.stringify(rowOf(res, 440)));
    t("control: the same PR with its total_count lands", landable(res, 441), JSON.stringify(rowOf(res, 441)));
    t("a PR whose base branch cannot be read (missing from the list item and the detail) is not assumed to sit on mainline: not LAND", rowOf(res, 442)?.disposition === "UNKNOWN" && rowOf(res, 442).base === null && rowOf(res, 442).blockers.some((b) => /base branch not readable/.test(b)), JSON.stringify(rowOf(res, 442)));
    t("control: a base missing only from the list item and read from the detail lands", landable(res, 443) && rowOf(res, 443).base === BASE_FX, JSON.stringify(rowOf(res, 443)));
    for (const [n, what] of [[444, "cancelled"], [445, "stale"], [446, "unknown"]]) {
      t(`a non-gating check that finished ${what === "unknown" ? "with no conclusion" : what} gave no verdict: not LAND, and the blocker names it`, rowOf(res, n)?.disposition === "UNKNOWN" && rowOf(res, n).blockers.some((b) => b.includes(`checks with no verdict`) && b.includes(`lint=${what}`)), JSON.stringify(rowOf(res, n)));
    }
    t("control: neutral and skipped are verdicts, and the PR lands", landable(res, 447), JSON.stringify(rowOf(res, 447)));
    t("a cancelled gating check is not a pass", rowOf(res, 448)?.disposition === "UNKNOWN" && rowOf(res, 448).blockers.includes("gating check cancelled"), JSON.stringify(rowOf(res, 448)));
    // a Link header that never arrives must not read as "one page"
    const many = (n) => [{ name: BASE_FX, commit: { sha: BASE_SHA_FX }, protected: true }, ...Array.from({ length: n - 1 }, (_, i) => ({ name: `claude/b-${String(i).padStart(3, "0")}`, commit: { sha: shaFx(5000 + i) }, protected: false }))];
    const closedRows = (n) => Array.from({ length: n }, (_, i) => ({ number: 1000 + i, state: "closed", merged_at: null, head: { ref: `claude/old-${i}`, sha: shaFx(9000 + i), repo: { full_name: REPO_FX } } }));
    const noLinkBranches = await runFx_(worldFx({ prs: [prFx(1)], branches: many(250), branchCut: { page: 2, keep: 50 }, noLinkHeader: true }), []);
    t("a branch count read with no Link header, on a list of 250 whose page 2 is short, is refused (exit 3) and says the header is missing", noLinkBranches.code === 3 && noLinkBranches.stdout === "" && /no Link header/.test(noLinkBranches.stderr), noLinkBranches.stderr);
    const noLinkClosed = await runFx_(worldFx({ prs: [prFx(1)], closed: closedRows(3), noLinkHeader: true }), []);
    t("a closed-PR count read with no Link header on a multi-page list is refused (exit 3)", noLinkClosed.code === 3 && noLinkClosed.stdout === "" && /state=closed/.test(noLinkClosed.stderr) && /no Link header/.test(noLinkClosed.stderr), noLinkClosed.stderr);
    const oneBranch = await runFx_(worldFx({ prs: [prFx(1)], noLinkHeader: true }), []);
    t("control: with no Link header a list that really holds one row (only mainline) is read, since page 2 is empty", oneBranch.code === 0 && oneBranch.report.counts.branches.total === 1, oneBranch.stderr);
    const notArray = await runFx_(worldFx({ prs: [prFx(1)], fail: [{ match: /\/branches$/, status: 200 }] }), []);
    t("a count read that is not a list at all is refused (exit 3), never counted as zero", notArray.code === 3 && notArray.stdout === "" && /count read was not a JSON array/.test(notArray.stderr), notArray.stderr);
  }
  {
    // finding 6: where the tool can write to disk is part of what the self-test checks
    const source = withoutMutantTable(readFileSync(SELF_FILE, "utf8"));
    eq("the source writes to disk only in the snapshot writer, the --mutants copies and the self-test's own temp pages", fsWriteSites(source), EXPECTED_FS_WRITES);
    eq("the source imports only the modules it was reviewed with (no promises API, no other writer)", importsOf(source), ["./check-owner-gated-surfaces.mjs", "node:child_process", "node:fs", "node:os", "node:path", "node:url"]);
    t("the source has no dynamic import and no require", !/\bimport\s*\(|\brequire\s*\(/.test(source));
    t("control: the scan sees a write planted in the report path", JSON.stringify(fsWriteSites(`export async function collectReport() {\n  ${"writeFile"}${"Sync"}("x", "");\n}\n`)) === JSON.stringify({ collectReport: ["writeFile"] }));
    t("control: the scan reads a write inside a top-level arrow function too", JSON.stringify(fsWriteSites(`const quiet = () => {\n  ${"rm"}${"Sync"}("x");\n};\n`)) === JSON.stringify({ quiet: ["rm"] }));
  }
  {
    // findings 4 and 5: no model names in the skill, the page or the tool, and the backlog row the skill quotes exists
    const skill = readFileSync(SKILL_FILE, "utf8");
    const page = readFileSync(PAGE_FILE, "utf8");
    const named = [["skill", skill], ["page", page], ["tool", withoutMutantTable(readFileSync(SELF_FILE, "utf8"))]].filter(([, text]) => MODEL_WORDS_RE.test(text)).map(([name]) => name);
    t("the skill, the page and the tool name no model: the DR-047 tiers are the bulk tier, the read tier and the judgment tier", named.length === 0, `model names in: ${named.join(", ")}`);
    const backlog = readFileSync(resolve(REPO_ROOT, "docs/BUILD_BACKLOG.md"), "utf8");
    const quoted = /docs\/BUILD_BACKLOG\.md`[^\n]*\n>\s*(.+)\n/.exec(skill)?.[1] ?? "";
    t("the backlog row title the skill quotes is a row title in docs/BUILD_BACKLOG.md", quoted.length > 40 && backlog.includes(`**${quoted} (`), `quoted: ${JSON.stringify(quoted)}`);
    t("the page says what a squash-merge message can leave out and that the earlier commits cannot change", /squash-merge message/.test(page) && /Co-Authored-By/.test(page) && /force-push/.test(page));
    t("the skill and the page say a check with no verdict (cancelled, stale, no conclusion) blocks LAND", /no verdict/.test(skill) && /no verdict/.test(page) && /cancelled/.test(skill) && /cancelled/.test(page));
    t("the page says what a missing Link header, a missing total_count and an unreadable base do", /Link header/.test(page) && /total_count/.test(page) && /base branch/.test(page));
  }

  // ── round 4: the fourth refute's findings, each beside a control ──
  {
    // MEDIUM 1: the re-classify step is the tool's own --classify mode, and a failed read is never "autonomous"
    const classifyFx = async (w, n, { env = {}, argv = [] } = {}) => {
      const out = [];
      const err = [];
      const gh = fakeGitHub(w);
      const code = await main(["--repo", REPO_FX, "--classify", String(n), ...argv], {
        env: { GITHUB_TOKEN: `ghp_${"a".repeat(36)}`, ...env }, fetchImpl: gh.fetch, sleep: async () => {}, now: () => NOW_FX,
        gitExec: () => ({ status: 128, stdout: "" }), readText: (p) => readFileSync(p, "utf8"), stdout: (s) => out.push(s), stderr: (s) => err.push(s),
      });
      return { code, out: out.join(""), err: err.join(""), log: gh.log };
    };
    const many = Array.from({ length: 250 }, (_, i) => ({ filename: `docs/f-${String(i).padStart(3, "0")}.md` }));
    const w = worldFx({
      prs: [
        prFx(1556, { files: [{ filename: "lib/signalgrid-core/src/engine.ts" }, { filename: "scripts/check-something-else.mjs" }, { filename: "docs/notes.md" }, { filename: "docs/b.md" }, { filename: "docs/c.md" }] }),
        prFx(1608, { files: [{ filename: "docs/notes.md" }, { filename: "docs/b.md" }] }),
        prFx(700, { files: [{ filename: "scripts/lib/ratchet-read.mjs" }] }),
        prFx(701, { files: [{ filename: "docs/moved.md", status: "renamed", previous: "lib/signalgrid-core/src/old.ts" }] }),
        prFx(702, { files: [{ filename: "docs/moved.md", status: "renamed", previous: "docs/old.md" }] }),
        prFx(703, { files: [{ filename: "docs/notes.md" }] }),
        prFx(704, { files: [], changedFiles: 0 }),
        prFx(705, { files: [], changedFiles: 3 }),
        prFx(706, { files: [{ filename: "docs/a.md" }, { filename: "docs/b.md" }], changedFiles: 3 }),
        prFx(707, { files: [{ filename: "docs/a.md" }, { filename: "docs/b.md" }, { filename: "docs/c.md" }], changedFiles: 2 }),
        prFx(708, { omitChangedFiles: true }),
        prFx(709, { files: [{ status: "modified" }], changedFiles: 1 }),
        prFx(710, { files: many }),
        prFx(711),
        prFx(712),
        prFx(713),
        prFx(714),
        prFx(715, { headAfter: shaFx(9999) }),
      ],
      fail: [{ match: /\/pulls\/703\/files$/, status: 500 }, { match: /\/pulls\/711\/files$/, status: 403, message: "forbidden" }, { match: /\/pulls\/712$/, status: 401 }, { match: /\/pulls\/713\/files$/, status: 429 }, { match: /\/pulls\/714\/files$/, status: 200, message: "not a list" }],
    });
    const run = (n, o) => classifyFx(w, n, o);
    const r1556 = await run(1556);
    const r1608 = await run(1608);
    t("--classify on a PR that reaches lib/ prints CLASSIFIED, the tier DECISION_PATH+SAFETY_MACHINERY, the head and OWNER-GATED, exit 0", r1556.code === 0 && /^#1556 CLASSIFIED DECISION_PATH\+SAFETY_MACHINERY \| no owner-named surface \| 5 of 5 file\(s\) \| head 0{12} \| OWNER-GATED \(DECISION_PATH\)\n$/.test(r1556.out), r1556.out);
    t("control: --classify on a docs-only PR prints CLASSIFIED autonomous and not owner-gated by its files, exit 0", r1608.code === 0 && /^#1608 CLASSIFIED autonomous \| no owner-named surface \| 2 of 2 file\(s\) \| head [0-9a-f]{12} \| not owner-gated by its files\n$/.test(r1608.out), r1608.out);
    const ratchet = await run(700);
    t("--classify names an owner-named surface and calls the PR OWNER-GATED (the ceiling reader both launch gates read through)", ratchet.code === 0 && /owner-named: ratchet-file reader/.test(ratchet.out) && /OWNER-GATED \(owner-named surface\)/.test(ratchet.out), ratchet.out);
    const renamed = await run(701);
    const renamedOk = await run(702);
    t("--classify judges a file renamed out of lib/ on its old path too (DECISION_PATH)", renamed.code === 0 && /CLASSIFIED DECISION_PATH/.test(renamed.out) && /OWNER-GATED/.test(renamed.out), renamed.out);
    t("control: --classify on a rename between two docs files is autonomous", renamedOk.code === 0 && /CLASSIFIED autonomous/.test(renamedOk.out), renamedOk.out);
    const failedRead = await run(703);
    t("--classify on a PR whose file list fails to load (HTTP 500 after retries) prints NOT CLASSIFIED and exits non-zero, never 'autonomous'", failedRead.code === 3 && /^#703 NOT CLASSIFIED: /.test(failedRead.out) && !/CLASSIFIED (autonomous|DECISION|SAFETY)/.test(failedRead.out), `${failedRead.code} ${failedRead.out}`);
    const forbidden = await run(711);
    t("--classify on a read the token cannot make (403 on the file list) prints NOT CLASSIFIED and exits 2", forbidden.code === 2 && /^#711 NOT CLASSIFIED: /.test(forbidden.out), `${forbidden.code} ${forbidden.out}`);
    const unauthorized = await run(712);
    t("--classify answered 401 prints NOT CLASSIFIED and exits 2", unauthorized.code === 2 && /^#712 NOT CLASSIFIED: .*401/.test(unauthorized.out), `${unauthorized.code} ${unauthorized.out}`);
    const limited = await run(713);
    t("--classify answered 429 (the secondary rate limit) on the file list prints NOT CLASSIFIED and exits 2", limited.code === 2 && /^#713 NOT CLASSIFIED: GitHub rate limit reached/.test(limited.out), `${limited.code} ${limited.out}`);
    const notList = await run(714);
    t("--classify answered 200 with something that is not a list on the file list prints NOT CLASSIFIED and exits 3", notList.code === 3 && /^#714 NOT CLASSIFIED: .*not a JSON array/.test(notList.out), `${notList.code} ${notList.out}`);
    const moved = await run(715);
    t("--classify on a PR whose head moves while the files are read prints NOT CLASSIFIED and exits 3: the files may belong to another head", moved.code === 3 && /^#715 NOT CLASSIFIED: the head moved while the files were read/.test(moved.out), `${moved.code} ${moved.out}`);
    const gone = await run(99999999);
    t("--classify on a PR that does not exist (404) prints NOT CLASSIFIED and exits 2: the failed read the skill's old command called 'autonomous'", gone.code === 2 && /^#99999999 NOT CLASSIFIED: .*404/.test(gone.out), `${gone.code} ${gone.out}`);
    const emptyZero = await run(704);
    t("--classify on an empty file list is NOT CLASSIFIED even when the PR reports 0 changed files: an empty list is never a PR that touches nothing", emptyZero.code === 3 && /^#704 NOT CLASSIFIED: .*empty/.test(emptyZero.out), `${emptyZero.code} ${emptyZero.out}`);
    const emptyThree = await run(705);
    t("--classify on an empty file list while the PR reports 3 is NOT CLASSIFIED", emptyThree.code === 3 && /^#705 NOT CLASSIFIED: .*empty/.test(emptyThree.out), `${emptyThree.code} ${emptyThree.out}`);
    const fewer = await run(706);
    t("--classify on fewer files than the PR reports (2 of 3) is NOT CLASSIFIED", fewer.code === 3 && /^#706 NOT CLASSIFIED: read 2 file\(s\) of the 3/.test(fewer.out), `${fewer.code} ${fewer.out}`);
    const more = await run(707);
    t("--classify on more files than the PR reports (3 of 2) is NOT CLASSIFIED too", more.code === 3 && /^#707 NOT CLASSIFIED: read 3 file\(s\) of the 2/.test(more.out), `${more.code} ${more.out}`);
    const noCount = await run(708);
    t("--classify on a PR detail with no changed_files count is NOT CLASSIFIED", noCount.code === 3 && /^#708 NOT CLASSIFIED: .*no changed_files count/.test(noCount.out), `${noCount.code} ${noCount.out}`);
    const noName = await run(709);
    t("--classify on a file entry with no filename is NOT CLASSIFIED", noName.code === 3 && /^#709 NOT CLASSIFIED: .*no filename/.test(noName.out), `${noName.code} ${noName.out}`);
    const paged = await run(710);
    t("control: --classify reads every page of a 250-file list (3 pages) and says so", paged.code === 0 && /CLASSIFIED autonomous \| no owner-named surface \| 250 of 250 file\(s\)/.test(paged.out), paged.out);
    const noToken = await classifyFx(w, 1608, { env: { GITHUB_TOKEN: "", GH_TOKEN: "" } });
    t("--classify with no token prints NOT CLASSIFIED, exits 2 and sends no request", noToken.code === 2 && /^#1608 NOT CLASSIFIED: no GitHub token/.test(noToken.out) && noToken.log.length === 0, `${noToken.code} ${noToken.out}`);
    t("--classify sends only GET requests, for that PR's detail (before and after its files) and its files, and reads no queue", r1608.log.length === 3 && r1608.log.every((l) => l.method === "GET" && /\/pulls\/1608(\/files\?per_page=100&page=1)?$/.test(l.path)), JSON.stringify(r1608.log));
    for (const [argv, what] of [[["--classify", "abc"], "a name"], [["--classify", "0"], "zero"], [["--classify"], "no value"], [["--classify", "5", "--snapshot", "x.md"], "--snapshot"], [["--classify", "5", "--json"], "--json"]]) {
      const out = [];
      const err = [];
      const code = await main(argv, { env: {}, fetchImpl: async () => { throw new Error("no network in the self-test"); }, sleep: async () => {}, now: () => NOW_FX, gitExec: () => ({ status: 128, stdout: "" }), readText: (p) => readFileSync(p, "utf8"), stdout: (s) => out.push(s), stderr: (s) => err.push(s) });
      t(`--classify with ${what} is a usage error: exit 2, nothing on stdout`, code === 2 && out.join("") === "" && /classify/.test(err.join("")), `${code} ${err.join("")}`);
    }
    const skill = readFileSync(SKILL_FILE, "utf8");
    t("the skill re-classifies through the tool's --classify mode and says NOT CLASSIFIED is not landable, not through a pipeline of its own", /node scripts\/backlog-triage\.mjs --classify <n>/.test(skill) && /NOT CLASSIFIED/.test(skill) && !/pulls\/<n>\/files"? --paginate/.test(skill));
  }
  {
    // MEDIUM 2: the code the launch gates read their ceiling files through is owner-named, and so is every relative import of an owner-named script
    const w = worldFx({ prs: [prFx(900, { files: [{ filename: "scripts/lib/ratchet-read.mjs" }] }), prFx(901, { files: [{ filename: "scripts/check-launch-claims.mjs" }] }), prFx(902, { files: [{ filename: "scripts/lib/sanitize.mjs" }] }), prFx(903, { files: [{ filename: "scripts/lib/ratchet-read.d.mts" }] })] });
    const res = await runFx_(w, []);
    t("a PR that changes only scripts/lib/ratchet-read.mjs (the reader both launch gates read their ceiling files through) is OWNER-MERGE, never LAND", rowOf(res, 900)?.disposition === "OWNER-MERGE" && rowOf(res, 900).reason === "owner-named-surface" && rowOf(res, 900).files.ownerNamed.some((o) => /^ratchet-file reader/.test(o.rule)), JSON.stringify(rowOf(res, 900)));
    t("control: scripts/check-launch-claims.mjs, which imports it, is OWNER-MERGE the same way", rowOf(res, 901)?.disposition === "OWNER-MERGE" && rowOf(res, 901).reason === "owner-named-surface");
    t("control: another library file under scripts/lib lands (only the name makes a file owner-named)", landable(res, 902), JSON.stringify(rowOf(res, 902)));
    t("the reader's declaration file is owner-named too", rowOf(res, 903)?.disposition === "OWNER-MERGE");
    const imp = "imp" + "ort";
    const req = "requ" + "ire";
    const sample = [
      `${imp} a from "./a.mjs";`, `${imp} {`, "  b,", "  c,", `} from "../lib/b.mjs";`, "export * from \"./c.mjs\";", "export { d } from '../d.mjs';",
      `${imp} "./e.mjs";`, `const f = await ${imp}("./f.mjs");`, `const g = ${req}("./g.cjs");`, `${imp} fs from "node:fs";`, `${imp} yaml from "yaml";`,
      `  // ${imp} x from "./in-a-comment.mjs";`, ` * ${imp} y from "./in-a-doc-comment.mjs";`, `const s = f(\x27${imp} z from "./mid-line.mjs";\x27);`,
    ].join("\n");
    eq("relativeImports reads static, re-exported, multi-line, side-effect, dynamic and require forms (./ and ../), ignores node: and package specifiers, and a mention in a comment or in the middle of a line", relativeImports(sample), ["../d.mjs", "../lib/b.mjs", "./a.mjs", "./c.mjs", "./e.mjs", "./f.mjs", "./g.cjs"]);
    const tree = {
      "scripts/check-launch-claims.mjs": 'import { a } from "./lib/ratchet-read.mjs";\nimport { b } from "node:fs";\nimport { c } from "./launch-profile.mjs";\n',
      "scripts/lib/ratchet-read.mjs": "export const a = 1;\n",
      "scripts/launch-profile.mjs": 'import { h } from "./lib/helper.mjs";\nexport const p = 1;\n',
      "scripts/lib/helper.mjs": "export const h = 1;\n",
      "scripts/src/launch-profile-proof.ts": 'import type { P } from "../lib/typed.mjs";\n',
      "scripts/lib/typed.mjs": "export const x = 1;\n",
      "scripts/check-launch-profile.mjs": 'import { p } from "./launch-profile.mjs";\nimport { z } from "./gone.mjs";\n',
    };
    const tracked = new Set(Object.keys(tree));
    const read = (p) => tree[p];
    const withoutReader = (p) => classifyFiles([{ filename: p }]).ownerNamed.some((o) => !/^ratchet-file reader/.test(o.rule));
    const before = ownerNamedImportGaps({ roots: ["scripts/check-launch-claims.mjs"], tracked, read, named: withoutReader });
    t("the walk finds the gap the refute found: with the reader off the list, scripts/check-launch-claims.mjs imports a file that is not owner-named", before.gaps.some((g) => g.from === "scripts/check-launch-claims.mjs" && g.target === "scripts/lib/ratchet-read.mjs" && g.why === "is not owner-named"), JSON.stringify(before.gaps));
    t("the walk is transitive: a file imported by an owner-named file that is itself imported by the root is checked too (scripts/lib/helper.mjs)", before.gaps.some((g) => g.from === "scripts/launch-profile.mjs" && g.target === "scripts/lib/helper.mjs") && before.visited.includes("scripts/launch-profile.mjs"), JSON.stringify(before));
    const typed = ownerNamedImportGaps({ roots: ["scripts/src/launch-profile-proof.ts"], tracked, read, named: () => false });
    t("the walk follows a ../ import: scripts/src/launch-profile-proof.ts names ../lib/typed.mjs", typed.gaps.length === 1 && typed.gaps[0].target === "scripts/lib/typed.mjs", JSON.stringify(typed));
    const missing = ownerNamedImportGaps({ roots: ["scripts/check-launch-profile.mjs"], tracked, read });
    t("a relative import that resolves to no tracked file is a gap, not silence", missing.gaps.some((g) => g.spec === "./gone.mjs" && /does not resolve/.test(g.why)), JSON.stringify(missing.gaps));
    const control = ownerNamedImportGaps({ roots: ["scripts/check-launch-claims.mjs"], tracked: new Set(["scripts/check-launch-claims.mjs", "scripts/lib/ratchet-read.mjs", "scripts/launch-profile.mjs"]), read: (p) => (p === "scripts/launch-profile.mjs" ? "export const p = 1;\n" : tree[p]) });
    t("control: with every import owner-named the walk reports no gap and visits each file", control.gaps.length === 0 && control.visited.join() === "scripts/check-launch-claims.mjs,scripts/launch-profile.mjs,scripts/lib/ratchet-read.mjs", JSON.stringify(control));
    const bare = ownerNamedImportGaps({
      roots: ["scripts/check-launch-claims.mjs"],
      tracked: new Set(["scripts/check-launch-claims.mjs", "scripts/lib/noext.mjs", "scripts/lib/dir/index.mjs"]),
      read: (p) => (p === "scripts/check-launch-claims.mjs" ? 'import a from "./lib/noext";\nimport b from "./lib/dir";\n' : "export const x = 1;\n"),
      named: () => true,
    });
    t("an import without an extension resolves to the module (noext.mjs) and a directory import to its index file", bare.gaps.length === 0 && bare.edges.join() === "scripts/check-launch-claims.mjs -> scripts/lib/dir/index.mjs,scripts/check-launch-claims.mjs -> scripts/lib/noext.mjs", JSON.stringify(bare));
    const listed = realGitExec(["-C", REPO_ROOT, "ls-files"]);
    const trackedNow = new Set(listed.status === 0 ? listed.stdout.split("\n").filter(Boolean) : []);
    const roots = [...trackedNow].filter((p) => isScript(p) && classifyFiles([{ filename: p }]).ownerNamed.length > 0);
    const live = ownerNamedImportGaps({ roots, tracked: trackedNow, read: (p) => readFileSync(resolve(REPO_ROOT, p), "utf8") });
    t(`every relative import of every tracked owner-named script, followed through the files those pull in: ${roots.length} scripts, ${live.visited.length} files visited, is itself owner-named`, listed.status === 0 && ["scripts/check-launch-claims.mjs", "scripts/check-launch-proof-bindings.mjs", "scripts/check-launch-profile.mjs"].every((p) => roots.includes(p)) && ["scripts/check-launch-claims.mjs -> scripts/lib/ratchet-read.mjs", "scripts/check-launch-proof-bindings.mjs -> scripts/lib/ratchet-read.mjs", "scripts/check-launch-profile.mjs -> scripts/launch-profile.mjs"].every((e) => live.edges.includes(e)) && live.gaps.length === 0, listed.status !== 0 ? "git ls-files failed, so the tracked files could not be listed" : JSON.stringify(live.gaps));
  }
  {
    // LOW 3: three fields GitHub always sends, left out: each tightens the answer
    const gate = (id, state) => runFx(id, GATING_CHECK, state);
    const noId = { name: GATING_CHECK, status: "completed", conclusion: "failure" };
    const w = worldFx({
      prs: [
        prFx(610, { draft: true, omitDraft: true }),
        prFx(611, { omitDraftInList: true }),
        prFx(612, { mergeable_state: "draft" }),
        prFx(613, { detailDraft: "false" }),
        prFx(614),
        prFx(615, { listDraft: true, detailDraft: false }),
        prFx(616, { listDraft: false, detailDraft: true }),
        prFx(620, { files: [{ status: "modified" }], changedFiles: 1 }),
        prFx(621, { files: [{ filename: "docs/notes.md" }], changedFiles: 1 }),
        prFx(630, { checks: [gate(1001, "success"), noId] }),
        prFx(631, { checks: [noId, gate(1001, "success")] }),
        prFx(632, { checks: [gate(1001, "failure"), gate(1002, "success")] }),
      ],
    });
    const res = await runFx_(w, []);
    t("a draft PR whose detail leaves out the draft flag (the list says draft) is not LAND: a read error names it", rowOf(res, 610)?.disposition === "UNKNOWN" && rowOf(res, 610).draft === true && rowOf(res, 610).readErrors.some((e) => /^pr: the PR detail carries no boolean draft flag/.test(e)), JSON.stringify(rowOf(res, 610)));
    t("a PR whose list item leaves out the draft flag is not LAND either: a read error names it", rowOf(res, 611)?.disposition === "UNKNOWN" && rowOf(res, 611).readErrors.some((e) => /the list item carries no boolean draft flag/.test(e)), JSON.stringify(rowOf(res, 611)));
    t("a PR with mergeable_state draft is a draft although both draft flags say false: not LAND, blocker draft", rowOf(res, 612)?.disposition === "UNKNOWN" && rowOf(res, 612).draft === true && rowOf(res, 612).blockers.includes("draft"), JSON.stringify(rowOf(res, 612)));
    t("a draft flag that is not a boolean ('false' as a string) is a read error, not 'not a draft'", rowOf(res, 613)?.disposition === "UNKNOWN" && rowOf(res, 613).readErrors.some((e) => /no boolean draft flag/.test(e)), JSON.stringify(rowOf(res, 613)));
    t("control: a PR with a boolean draft flag in the list and the detail, false, lands", landable(res, 614), JSON.stringify(rowOf(res, 614)));
    t("a PR the list calls a draft and the detail calls ready is read as a draft: any of the three places is enough", rowOf(res, 615)?.draft === true && rowOf(res, 615).disposition === "UNKNOWN" && rowOf(res, 615).blockers.includes("draft"), JSON.stringify(rowOf(res, 615)));
    t("a PR the detail calls a draft and the list calls ready is read as a draft too", rowOf(res, 616)?.draft === true && rowOf(res, 616).disposition === "UNKNOWN" && rowOf(res, 616).blockers.includes("draft"), JSON.stringify(rowOf(res, 616)));
    t("a file entry with no filename is a read error: UNKNOWN, never classified as nothing", rowOf(res, 620)?.disposition === "UNKNOWN" && rowOf(res, 620).readErrors.some((e) => /^files: entry 1 of 1 .*no filename/.test(e)), JSON.stringify(rowOf(res, 620)));
    t("control: the same one-file PR with its filename lands", landable(res, 621), JSON.stringify(rowOf(res, 621)));
    t("a failing gating run with no id listed after a passing one with an id is a checks read error: not LAND", rowOf(res, 630)?.disposition === "UNKNOWN" && rowOf(res, 630).readErrors.some((e) => /^checks: .*carries no numeric id/.test(e)) && rowOf(res, 630).blockers.some((b) => /checks unreadable/.test(b)), JSON.stringify(rowOf(res, 630)));
    t("the same failing run with no id listed first is a checks read error too", rowOf(res, 631)?.disposition === "UNKNOWN" && rowOf(res, 631).readErrors.some((e) => /carries no numeric id/.test(e)), JSON.stringify(rowOf(res, 631)));
    t("control: a failing gating run beaten by a newer passing run, both with ids, is history and lands", landable(res, 632), JSON.stringify(rowOf(res, 632)));
  }
  {
    // LOW 4 and Q15: every current Mac-only job counts, whatever its name; the verdict shown is the worst, then the newest
    const macA = "PR — Mac-only checks (full-clone provenance, preflight on macOS)";
    const macB = "PR — Mac-only checks (second job)";
    const gate = (id, state) => runFx(id, GATING_CHECK, state);
    const w = worldFx({
      prs: [
        prFx(640, { checks: [gate(1000, "success"), runFx(1001, macA, "failure"), runFx(1002, macB, "success")] }),
        prFx(641, { checks: [gate(1000, "success"), runFx(1001, macA, "success"), runFx(1002, macB, "success")] }),
        prFx(642, { checks: [gate(1000, "success"), runFx(1001, macA, "in_progress"), runFx(1002, macB, "success")] }),
        prFx(643, { checks: [gate(1000, "success"), runFx(1001, macA, "failure"), runFx(1003, macA, "success")] }),
        prFx(644, { idle: 20, checks: [gate(1000, "success"), runFx(1001, macA, "failure"), runFx(1002, macB, "success")] }),
        prFx(645, { checks: [gate(1000, "success"), runFx(1001, macA, "cancelled"), runFx(1002, macB, "success")] }),
      ],
    });
    const res = await runFx_(w, []);
    t("a failing Mac-only job (id 1001) is not hidden by a newer passing Mac-only job of another name (id 1002): not LAND, blocker Mac-only check failure", rowOf(res, 640)?.disposition === "UNKNOWN" && rowOf(res, 640).blockers.includes("Mac-only check failure") && rowOf(res, 640).macOnly.state === "failure" && rowOf(res, 640).macOnly.id === 1001, JSON.stringify(rowOf(res, 640)));
    t("control: both Mac-only jobs passing lands, and the Mac-only column is the newest of equal states (id 1002)", landable(res, 641) && rowOf(res, 641).macOnly.id === 1002, JSON.stringify(rowOf(res, 641)));
    t("a Mac-only job still running is not hidden by a newer passing one of another name", rowOf(res, 642)?.disposition === "UNKNOWN" && rowOf(res, 642).blockers.includes("Mac-only check in_progress"), JSON.stringify(rowOf(res, 642)));
    t("control: a Mac-only job re-run under the same name (older failure, newer pass) is history and lands", landable(res, 643), JSON.stringify(rowOf(res, 643)));
    t("the STALE rule and the landing blockers agree: an idle PR with that failing Mac-only job is STALE (idle-over-14d-red)", rowOf(res, 644)?.disposition === "STALE" && rowOf(res, 644).reason === "idle-over-14d-red", JSON.stringify(rowOf(res, 644)));
    t("a cancelled Mac-only job gave no verdict and is not hidden by a newer passing one: not LAND", rowOf(res, 645)?.disposition === "UNKNOWN" && rowOf(res, 645).blockers.includes("Mac-only check cancelled"), JSON.stringify(rowOf(res, 645)));
  }
  {
    // LOW 5: the survivors of the third refute, one case each beside a control
    // Q04: a root review comment carries NO in_reply_to_id key on real GitHub; only a reply has one
    const w = worldFx({
      prs: [
        prFx(650, { comments: [{ id: 1 }] }),
        prFx(651, { comments: [{ id: 1 }, { id: 2, in_reply_to_id: 1 }] }),
        prFx(652, { comments: [{ id: 1, in_reply_to_id: null }] }),
        prFx(653, { comments: [] }),
        // Q27: a head repository GitHub reports as null (a deleted fork) is not the lane's own
        prFx(654, { headRepoNull: true }),
        prFx(655),
        // Q11: a fork PR from a branch named like the mailbox branch is an ordinary fork PR
        prFx(656, { ref: "lane/mailbox", fork: true }),
      ],
    });
    const res = await runFx_(w, []);
    t("a root review comment with no in_reply_to_id key (GitHub's real shape) is one thread: not LAND, and the row counts 1 root", rowOf(res, 650)?.disposition === "UNKNOWN" && rowOf(res, 650).threads.roots === 1 && rowOf(res, 650).threads.unanswered === 1 && rowOf(res, 650).blockers.some((b) => /1 review thread/.test(b)), JSON.stringify(rowOf(res, 650)));
    t("a root with no key and a reply that carries one is one answered thread (still not LAND: resolution is unreadable over REST)", rowOf(res, 651)?.threads.roots === 1 && rowOf(res, 651).threads.unanswered === 0 && rowOf(res, 651).disposition === "UNKNOWN", JSON.stringify(rowOf(res, 651)));
    t("the explicit-null root shape is the same one thread", rowOf(res, 652)?.threads.roots === 1, JSON.stringify(rowOf(res, 652)));
    t("control: no review comments at all lands", landable(res, 653), JSON.stringify(rowOf(res, 653)));
    t("a claude/* PR whose head repository is null is not the lane's own: lane other, OWNER-MERGE (other-lane-owner-review)", rowOf(res, 654)?.lane === "other" && rowOf(res, 654).disposition === "OWNER-MERGE" && rowOf(res, 654).reason === "other-lane-owner-review", JSON.stringify(rowOf(res, 654)));
    t("control: the same PR with its head repository present lands", landable(res, 655), JSON.stringify(rowOf(res, 655)));
    t("a fork PR from a branch named lane/mailbox is OWNER-MERGE (other-lane-owner-review), not the mailbox's UNKNOWN", rowOf(res, 656)?.disposition === "OWNER-MERGE" && rowOf(res, 656).reason === "other-lane-owner-review", JSON.stringify(rowOf(res, 656)));
  }
  {
    // Q32: an open-PR list shorter than the issues list's PR entries
    const short = await runFx_(worldFx({ prs: [prFx(1), prFx(2), prFx(3)], hidePulls: [3] }), []);
    t("an open-PR list that leaves out a PR the issues list still shows (2 of 3) is refused: exit 3, no queue, the counts named", short.code === 3 && short.stdout === "" && /pulls list 2/.test(short.stderr) && /3 are PRs/.test(short.stderr), `${short.code} ${short.stderr}`);
    const whole = await runFx_(worldFx({ prs: [prFx(1), prFx(2), prFx(3)] }), []);
    t("control: the same three PRs listed in full print a queue of 3", whole.code === 0 && whole.report.prs.length === 3, whole.stderr);
    // Q17 and Q19: a page short by ONE row
    const manyBranches = (n) => [{ name: BASE_FX, commit: { sha: BASE_SHA_FX }, protected: true }, ...Array.from({ length: n - 1 }, (_, i) => ({ name: `claude/b-${String(i).padStart(3, "0")}`, commit: { sha: shaFx(5000 + i) }, protected: false }))];
    const oneBranch = await runFx_(worldFx({ prs: [prFx(1)], branches: manyBranches(250), branchCut: { page: 3, keep: 49 } }), []);
    t("a branch page short by one row (page 3 of 250 returns 49) is refused: exit 3, no queue, the counts named", oneBranch.code === 3 && oneBranch.stdout === "" && /read 249 branches but the repository reports 250/.test(oneBranch.stderr), `${oneBranch.code} ${oneBranch.stderr}`);
    const closedRows = (n) => Array.from({ length: n }, (_, i) => ({ number: 1000 + i, state: "closed", merged_at: null, head: { ref: `claude/old-${i}`, sha: shaFx(9000 + i), repo: { full_name: REPO_FX } } }));
    const oneClosed = await runFx_(worldFx({ prs: [prFx(1)], closed: closedRows(150), closedCut: { page: 2, keep: 49 } }), []);
    t("a closed-PR page short by one row (page 2 of 150 returns 49) is refused: exit 3, no queue, the counts named", oneClosed.code === 3 && oneClosed.stdout === "" && /read 149 closed PRs but the list reports 150/.test(oneClosed.stderr), `${oneClosed.code} ${oneClosed.stderr}`);
    // Q10: a mailbox file with no usable branch is an unreadable mailbox file
    const noBranch = await runFx_(worldFx({ prs: [prFx(439, { ref: "lane/mailbox", draft: true, files: [], changedFiles: 0 }), prFx(441, { ref: "lane/mailbox" })] }), [], { mailbox: { pr: 439 } });
    t("a lane-mailbox.json with a PR number and no branch is unreadable: the mailbox PR is UNKNOWN, never STANDING", rowOf(noBranch, 439)?.disposition === "UNKNOWN" && /unreadable/.test(rowOf(noBranch, 439).reason) && noBranch.report.notes.some((n) => /lane-mailbox\.json was unreadable/.test(n)), JSON.stringify(rowOf(noBranch, 439)));
    const emptyBranch = await runFx_(worldFx({ prs: [prFx(439, { ref: "lane/mailbox", draft: true, files: [], changedFiles: 0 }), prFx(441, { ref: "lane/mailbox" })] }), [], { mailbox: { pr: 439, branch: "" } });
    t("a lane-mailbox.json whose branch is an empty string is unreadable too: a ready PR from lane/mailbox with a file is UNKNOWN, never LAND", rowOf(emptyBranch, 441)?.disposition === "UNKNOWN" && /standing mailbox branch/.test(rowOf(emptyBranch, 441).reason) && rowOf(emptyBranch, 439)?.disposition === "UNKNOWN", JSON.stringify([rowOf(emptyBranch, 439), rowOf(emptyBranch, 441)]));
    // Q16: unreadable checks on an idle PR are not "not red"
    const sha660 = shaFx(660);
    const idleUnread = await runFx_(worldFx({ prs: [prFx(660, { idle: 20, files: [{ filename: "lib/signalgrid-core/src/engine.ts" }] }), prFx(661, { idle: 20, files: [{ filename: "lib/signalgrid-core/src/engine.ts" }] })], fail: [{ match: new RegExp(`/commits/${sha660}/check-runs$`), status: 502 }] }), []);
    t("an idle PR whose check list fails to load (502) is UNKNOWN: STALE can be neither ruled in nor out", rowOf(idleUnread, 660)?.disposition === "UNKNOWN" && /its checks could not be read/.test(rowOf(idleUnread, 660).reason), JSON.stringify(rowOf(idleUnread, 660)));
    t("control: the same idle PR with its checks read (all passing, not conflicting) is OWNER-MERGE", rowOf(idleUnread, 661)?.disposition === "OWNER-MERGE", JSON.stringify(rowOf(idleUnread, 661)));
    // Q22: the snapshot carries nothing that changes between two reads of the same queue
    const readWith = (remaining) => runFx_(worldFx({ prs: [prFx(1)], rate: { limit: 5000, remaining, reset: 1792700000 } }), []);
    const ra = await readWith(4000);
    const rb = await readWith(3999);
    t("two reads that differ only in the rate limit left give the same snapshot block (no Auth line in it)", renderSnapshot(ra.report) === renderSnapshot(rb.report) && !/Auth:/.test(renderSnapshot(ra.report)), "");
    t("control: the full report does carry the Auth line, so the two reads differ there", renderMarkdown(ra.report) !== renderMarkdown(rb.report) && /Auth: /.test(renderMarkdown(ra.report)));
  }
  {
    // Q07 and Q09: the ask detector
    t("ask detector: 'the cloud lane may merge it now' is an ask ('it' names this PR)", bodyAsksCloudToLand("The cloud lane may merge it now.") === true);
    t("ask detector: 'the cloud lane may merge them now' is an ask ('them' names this PR)", bodyAsksCloudToLand("The cloud lane may merge them now.") === true);
    t("ask detector: a negation in an EARLIER clause after a semicolon does not cancel a later ask ('The Mac cannot be reached today; the cloud lane may merge this PR now')", bodyAsksCloudToLand("The Mac cannot be reached today; the cloud lane may merge this PR now") === true);
    t("ask detector (control): the same negation inside the SAME sentence cancels it", bodyAsksCloudToLand("The Mac cannot be reached today, so the cloud lane may not merge this PR now") === false);
    const body = `${GOOD_BODY_FX}\nThe cloud lane may merge it now.`;
    const w = worldFx({ prs: [prFx(670, { ref: "mac/safety-thing", files: [{ filename: "scripts/check-something-else.mjs" }], body })] });
    const res = await runFx_(w, []);
    t("a mac/* PR whose body says the cloud lane may merge 'it' prints 'ask in body; confirm mail', never LAND", rowOf(res, 670)?.disposition === "MAC-ASK-NEEDED" && rowOf(res, 670).ask === "in-body" && rowOf(res, 670).reason === "ask in body; confirm mail", JSON.stringify(rowOf(res, 670)));
  }
  {
    // INFO: the rate-limit reserve is derived from the measured worst read
    const m = MEASURED_WORST_READ;
    t(`the reserve (${RESERVE_PER_PR} per open PR plus ${RESERVE_FIXED}) covers the measured worst read: ${m.requests} GET requests for ${m.prs} PRs`, RESERVE_PER_PR * m.prs + RESERVE_FIXED >= m.requests, `${RESERVE_PER_PR * m.prs + RESERVE_FIXED} < ${m.requests}`);
    const need = 2 * RESERVE_PER_PR + RESERVE_FIXED;
    const low = await runFx_(worldFx({ prs: [prFx(1), prFx(2)], rate: { limit: 5000, remaining: need - 1, reset: 1792700000 } }), []);
    const edge = await runFx_(worldFx({ prs: [prFx(1), prFx(2)], rate: { limit: 5000, remaining: need, reset: 1792700000 } }), []);
    t("one request short of the reserve is refused before any PR is read (exit 2, no queue)", low.code === 2 && low.stdout === "" && new RegExp(`reserves ${need} for 2 PRs`).test(low.stderr) && !low.log.some((l) => /\/pulls\/1$/.test(l.path)), low.stderr);
    t("control: exactly the reserve reads the queue", edge.code === 0 && edge.report.prs.length === 2, edge.stderr);
    const skill = readFileSync(SKILL_FILE, "utf8");
    const page = readFileSync(PAGE_FILE, "utf8");
    t("the page quotes the measured read (the requests, the PRs, the replay) and the reserve the tool uses, and neither document keeps the old 'about six' estimate", page.includes(`${m.requests} GET requests for ${m.prs} open PRs`) && page.includes(`${m.replayed} when the same responses were replayed`) && page.includes(`${RESERVE_PER_PR} requests per open PR plus ${RESERVE_FIXED}`) && !/about six/.test(page) && !/about six/.test(skill), "");
    t("the skill gives the reserve the tool uses", skill.includes(`${RESERVE_PER_PR} per open PR plus ${RESERVE_FIXED}`));
    t("the page names the ceiling that a write made through a child process passes the write scan", /a write made through a child process/.test(page) && /scan of text/.test(page));
    t("the page says the owner's squash merge message should carry the PR title and body, not the per-commit trailers", /the PR title and body, not the per-commit trailers/.test(page));
    t("the page and the skill document --classify, and the page names the import walk and its ceiling", /--classify/.test(page) && /--classify <n>/.test(skill) && /relative imports/.test(page) && /scripts\/lib\/ratchet-read\.mjs/.test(page));
  }

  // ── issues and branches ──
  {
    const iss = (number, title, labels = []) => ({ number, title, labels: labels.map((name) => ({ name })), user: { login: "github-actions[bot]" }, created_at: agoIso(10 - number % 5), updated_at: agoIso(1), comments: 0 });
    const w = worldFx({
      issues: [iss(5, "Raised hands — what is stuck", ["raised-hands"]), iss(9, "Raised hands — what is stuck", ["raised-hands"]), iss(12, "  raised   hands — what is stuck ", ["raised-hands"]), iss(7, "A different issue"), iss(8, "Another one")],
      prs: [prFx(1)],
    });
    const res = await runFx_(w, []);
    eq("duplicate issue titles are grouped (case and whitespace normalised), pull requests excluded", res.report.duplicateIssues.map((g) => g.numbers), [[5, 9, 12]]);
    t("the group names the oldest and newest and the labels in common", res.report.duplicateIssues[0].oldest === 5 && res.report.duplicateIssues[0].newest === 12 && res.report.duplicateIssues[0].labels.join() === "raised-hands");
    eq("issues are listed by number and exclude PRs", res.report.issues.map((i) => i.number), [5, 7, 8, 9, 12]);
  }
  {
    const br = (name, sha) => ({ name, commit: { sha }, protected: true });
    const closed = (number, ref, sha, merged) => ({ number, state: "closed", merged_at: merged ? agoIso(5) : null, head: { ref, sha, repo: { full_name: REPO_FX } } });
    const w = worldFx({
      prs: [prFx(1, { ref: "claude/has-open-pr" })],
      branches: [
        { name: BASE_FX, commit: { sha: BASE_SHA_FX }, protected: true },
        br("claude/has-open-pr", shaFx(1)), br("claude/merged-clean", "1".repeat(40)), br("claude/merged-then-moved", "3".repeat(40)),
        br("claude/closed-unmerged", "4".repeat(40)), br("claude/never-had-pr", "5".repeat(40)),
      ],
      closed: [closed(100, "claude/merged-clean", "1".repeat(40), true), closed(101, "claude/merged-then-moved", "2".repeat(40), true), closed(102, "claude/closed-unmerged", "4".repeat(40), false)],
    });
    const res = await runFx_(w, []);
    const byName = Object.fromEntries(res.report.branches.map((b) => [b.name, b.disposition]));
    eq("branches: PRUNABLE only on a merged PR whose head is the tip; the rest are named for what is known", byName, { "claude/merged-clean": "PRUNABLE", "claude/merged-then-moved": "TIP-MOVED", "claude/closed-unmerged": "UNMERGED", "claude/never-had-pr": "UNMERGED" });
    t("a branch with an open PR and the default branch are not listed", !byName["claude/has-open-pr"] && !byName[BASE_FX] && res.report.counts.branches.withOpenPr === 1);
    t("a closed-but-unmerged PR does not make its branch PRUNABLE", byName["claude/closed-unmerged"] === "UNMERGED");
  }

  // ── the command line ──
  {
    const cli = async (argv) => { const out = []; const err = []; const code = await main(argv, { env: {}, fetchImpl: async () => { throw new Error("no network in the self-test"); }, sleep: async () => {}, now: () => NOW_FX, gitExec: () => ({ status: 128, stdout: "" }), readText: (p) => readFileSync(p, "utf8"), stdout: (s) => out.push(s), stderr: (s) => err.push(s) }); return { code, out: out.join(""), err: err.join("") }; };
    t("an unknown option is refused with exit 2, naming it", await (async () => { const r = await cli(["--frobnicate"]); return r.code === 2 && /unknown option --frobnicate/.test(r.err); })());
    t("--json with --markdown is refused with exit 2", await (async () => { const r = await cli(["--json", "--markdown"]); return r.code === 2 && /exclusive/.test(r.err); })());
    t("an option missing its value is refused with exit 2", await (async () => { const r = await cli(["--repo"]); return r.code === 2 && /needs a value/.test(r.err); })());
    t("--declared-live that is not PR numbers is refused with exit 2", await (async () => { const r = await cli(["--declared-live", "soon"]); return r.code === 2 && /cannot read "soon"/.test(r.err); })());
    t("--help prints the usage and exits 0", await (async () => { const r = await cli(["--help"]); return r.code === 0 && /usage: node scripts\/backlog-triage\.mjs/.test(r.out); })());
    eq("--declared-live reads numbers and notes", [...parseDeclared("1559, 1585:worker B92,#7").entries()], [[1559, ""], [1585, "worker B92"], [7, ""]]);
  }

  // ── determinism and read-only ──
  {
    const mkWorld = () => worldFx({
      prs: [prFx(3, { files: [{ filename: "lib/signalgrid-core/src/engine.ts" }] }), prFx(1), prFx(2, { ref: "mac/x", files: [{ filename: "docs/POSITIONING.md" }] }), prFx(9, { idle: 20, mergeable_state: "dirty" }), prFx(4, { ref: "dependabot/x", files: [{ filename: "package.json" }] }), prFx(6, { draft: true }), prFx(5, { compare: "behind" })],
      issues: [{ number: 30, title: "b", labels: [], user: { login: "u" }, created_at: agoIso(2), updated_at: agoIso(1) }, { number: 20, title: "a", labels: [], user: { login: "u" }, created_at: agoIso(3), updated_at: agoIso(1) }],
    });
    const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
    const a = await runFx_({ ...mkWorld(), latency: (u) => hash(u) % 7 }, []);
    const b = await runFx_({ ...mkWorld(), latency: (u) => (6 - (hash(u) % 7)) }, []);
    t("two runs with different response timing print byte-identical JSON", a.stdout === b.stdout && a.stdout.length > 100);
    const order = a.report.prs.map((p) => [DISP_RANK.get(p.disposition), p.number]);
    t("PRs are ordered by disposition rank, then number", order.every((cur, i) => i === 0 || order[i - 1][0] < cur[0] || (order[i - 1][0] === cur[0] && order[i - 1][1] < cur[1])), JSON.stringify(order));
    eq("issues are ordered by number", a.report.issues.map((i) => i.number), [20, 30]);
    t("the report is stamped with the injected now, not the clock", a.report.generatedAt === NOW_FX.toISOString());
    const later = await runFx_(mkWorld(), ["--now", "2026-10-23T12:00:00Z"]);
    t("ages move with the injected now, by exactly the difference", Math.abs((later.report.prs.find((p) => p.number === 1).idleDays - a.report.prs.find((p) => p.number === 1).idleDays) - 1) < 0.11);
    const md = await (async () => {
      const out = [];
      const gh = fakeGitHub(mkWorld());
      const code = await main(["--repo", REPO_FX, "--markdown"], { env: { GITHUB_TOKEN: `ghp_${"a".repeat(36)}` }, fetchImpl: gh.fetch, sleep: async () => {}, now: () => NOW_FX, gitExec: () => ({ status: 128, stdout: "" }), readText: (p) => readFileSync(p, "utf8"), stdout: (s) => out.push(s), stderr: () => {} });
      return { code, text: out.join("") };
    })();
    t("the markdown report totals add up to the PR count and name every disposition present", md.code === 0 && /\| \*\*Total\*\* \| \*\*7\*\* \|/.test(md.text) && /OWNER-MERGE/.test(md.text) && /SUPERSEDED/.test(md.text), md.text.slice(0, 400));
    t("every request the tool sent was a GET", a.log.length > 0 && a.log.every((l) => l.method === "GET"));
    t("the source holds no write verb to the API", !/method:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(withoutMutantTable(readFileSync(SELF_FILE, "utf8"))));
  }

  // ── the snapshot writer ──
  {
    const dir = mkdtempSync(join(tmpdir(), "sgbt-"));
    try {
      const page = join(dir, "page.md");
      const before = `# Page\n\nintro\n\n${SNAPSHOT_BEGIN}\n\nnot generated here: never run\n\n${SNAPSHOT_END}\n\ntrailer\n`;
      writeFileSync(page, before);
      const w = worldFx({ prs: [prFx(1)] });
      const res = await runFx_(w, ["--snapshot", page]);
      const after = readFileSync(page, "utf8");
      t("--snapshot writes the dated block between the markers and touches nothing else", res.code === 0 && after.startsWith(`# Page\n\nintro\n\n${SNAPSHOT_BEGIN}`) && after.endsWith(`${SNAPSHOT_END}\n\ntrailer\n`) && /Snapshot read 2026-10-22T12:00:00.000Z/.test(after), after.slice(0, 300));
      const again = await runFx_(w, ["--snapshot", page]);
      t("writing the same reading twice leaves the same bytes", again.code === 0 && readFileSync(page, "utf8") === after);
      const bad = join(dir, "nomarkers.md");
      writeFileSync(bad, "# no markers here\n");
      const refused = await runFx_(w, ["--snapshot", bad]);
      t("a page without the markers is refused (exit 4) and left unchanged", refused.code === 4 && readFileSync(bad, "utf8") === "# no markers here\n", refused.stderr);
      const dup = join(dir, "twice.md");
      writeFileSync(dup, `${SNAPSHOT_BEGIN}\n${SNAPSHOT_END}\n${SNAPSHOT_BEGIN}\n${SNAPSHOT_END}\n`);
      const refusedDup = await runFx_(w, ["--snapshot", dup]);
      t("a page with two marker pairs is refused", refusedDup.code === 4);
      const reversed = join(dir, "reversed.md");
      const reversedText = `${SNAPSHOT_END}\n\nbetween\n\n${SNAPSHOT_BEGIN}\n`;
      writeFileSync(reversed, reversedText);
      const refusedReversed = await runFx_(w, ["--snapshot", reversed]);
      t("a page with an end marker before the begin marker is refused (exit 4) and left byte for byte unchanged", refusedReversed.code === 4 && readFileSync(reversed, "utf8") === reversedText && /end marker comes before/.test(refusedReversed.stderr), refusedReversed.stderr);
      // failure paths: the page must say so, and must not erase a real snapshot
      const fresh = join(dir, "fresh.md");
      writeFileSync(fresh, `${SNAPSHOT_BEGIN}\n\n${SNAPSHOT_END}\n`);
      const denied = await runFx_(worldFx({ fail: [{ match: /rate_limit/, status: 401 }] }), ["--snapshot", fresh], { env: { GITHUB_TOKEN: "proxy-injected" } });
      t("on a 401 an empty snapshot section is filled with 'not generated here: <reason>'", denied.code === 2 && /not generated here: .*401/.test(readFileSync(fresh, "utf8")), readFileSync(fresh, "utf8"));
      const forbiddenList = { match: /\/repos\/acme\/widgets\/pulls$/, status: 403, message: "Resource not accessible by personal access token" };
      const forbiddenPage = join(dir, "forbidden.md");
      writeFileSync(forbiddenPage, `${SNAPSHOT_BEGIN}\n\n${SNAPSHOT_END}\n`);
      const forbiddenRun = await runFx_(worldFx({ prs: [prFx(1)], fail: [forbiddenList] }), ["--snapshot", forbiddenPage]);
      t("on a 403 that is not a rate limit an empty snapshot section is filled with 'not generated here: ...403'", forbiddenRun.code === 2 && /not generated here: .*403/.test(readFileSync(forbiddenPage, "utf8")), readFileSync(forbiddenPage, "utf8"));
      const driftPage = join(dir, "drift.md");
      writeFileSync(driftPage, `${SNAPSHOT_BEGIN}\n\n${SNAPSHOT_END}\n`);
      const driftRun = await runFx_(worldFx({ prs: [prFx(1), prFx(2)], countOverride: 5 }), ["--snapshot", driftPage]);
      t("on an inconsistent read (exit 3) an empty snapshot section is filled with 'not generated here: ...disagree'", driftRun.code === 3 && /not generated here: .*disagree/.test(readFileSync(driftPage, "utf8")), readFileSync(driftPage, "utf8"));
      const keep = join(dir, "keep.md");
      writeFileSync(keep, after);
      const kept = await runFx_(worldFx({ fail: [{ match: /rate_limit/, status: 401 }] }), ["--snapshot", keep], { env: { GITHUB_TOKEN: "proxy-injected" } });
      t("on a 401 an existing dated snapshot is kept, not erased", kept.code === 2 && readFileSync(keep, "utf8") === after && /left as it was/.test(kept.stderr), kept.stderr);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  } catch (e) {
    t("the self-test ran to its end without an exception", false, String(e?.stack ?? e));
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    io.stdout(`backlog-triage self-test FAILED (${results.length - failed.length}/${results.length})\n`);
    for (const f of failed) io.stdout(`  FAIL ${f.name}${f.detail ? `\n       ${String(f.detail).slice(0, 400)}` : ""}\n`);
    return 1;
  }
  io.stdout(`backlog-triage self-test passed (${results.length}/${results.length}): tokens fail closed, an empty page is not an empty queue, each rule beside its control, stable order, GET only, snapshot markers\n`);
  return 0;
}

// ── entry ────────────────────────────────────────────────────────────────────────────────

function isMainModule() {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(SELF_FILE);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  if (!args.includes("--self-test") && !args.includes("--help") && !args.includes("-h")) reexecForProxy();
  main(args).then((code) => { process.exitCode = code; }, (e) => {
    process.stderr.write(`backlog-triage: unexpected failure: ${e?.stack ?? e}\n`);
    process.exitCode = 3;
  });
}
