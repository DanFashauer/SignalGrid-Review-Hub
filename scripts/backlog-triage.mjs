#!/usr/bin/env node
// backlog-triage.mjs — the open pull-request, issue and branch queue, read once, with a
// DISPOSITION and the reason for every pull request. READ-ONLY: the only HTTP verb it
// sends is GET, it merges, approves, closes, comments on and deletes nothing, and the one
// file it may write is the one named by --snapshot, between two markers.
//
//   node scripts/backlog-triage.mjs                          markdown report on stdout
//   node scripts/backlog-triage.mjs --json                   the same data, stable key order
//   node scripts/backlog-triage.mjs --markdown --snapshot docs/agent/BACKLOG_LANDING.md
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
// failed to load, a mergeable_state GitHub has not computed) tightens the answer; where the
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
// (counts disagree after re-reads, a short branch or closed-PR page, a listing missing the
// default branch, a read that failed after retries) · 4 --snapshot could not be written.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

/**
 * Surfaces DR-037 keeps with the owner that the path classifier files only as ordinary
 * SAFETY_MACHINERY (scripts/**) or as plain docs. Fail-closed: the patterns are wider than
 * DR-037's words, because a false hit costs the owner a glance and a miss lands a boundary change.
 */
export const OWNER_NAMED = [
  { rule: "AGENTS.md (DR-037: not edited on the lane's authority)", re: /^AGENTS\.md$/ },
  { rule: "decision records (DR-037: edited only on owner authority)", re: /^docs\/DECISION_RECORDS\.md$/ },
  { rule: "launch profile (docs)", re: /^docs\/LAUNCH_PROFILE\.md$/ },
  { rule: "launch profile (code)", re: /(^|\/)(check-)?launch[-_]profile[\w.-]*\.(mjs|ts|js|json)$/i },
  { rule: "launch-claims gate", re: /(^|\/)(check-)?launch[-_]claims[\w.-]*\.(mjs|ts|js|json)$/i },
  { rule: "launch proof bindings", re: /(^|\/)(check-)?launch[-_]proof[-_]bindings[\w.-]*\.(mjs|ts|js|json)$/i },
  { rule: "publication boundary", re: /(^|\/)(check-)?publication[-_]boundary[\w.-]*\.(mjs|ts|js|json|md)$/i },
];

// ── small pure helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
export const daysBetween = (fromIso, now) => (now.getTime() - new Date(fromIso).getTime()) / DAY_MS;
export const round1 = (x) => Math.round(x * 10) / 10;
const sortNum = (a, b) => a - b;
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

/** The check runs on one commit. The envelope's total_count is the check on an empty page. */
export async function listCheckRuns(api, repo, sha) {
  const runs = [];
  let total = null;
  for (let page = 1; page <= 50; page++) {
    const body = await api.json(`/repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`);
    if (!body || !Array.isArray(body.check_runs)) throw new ApiError(`check-runs for ${sha.slice(0, 9)} was not a check_runs envelope`);
    total = body.total_count ?? total;
    runs.push(...body.check_runs);
    if (body.check_runs.length < 100) break;
  }
  if (typeof total === "number" && runs.length < total) throw new ApiError(`check-runs for ${sha.slice(0, 9)}: read ${runs.length} of total_count ${total}`);
  return runs;
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
 *  every verdict taken from the newest run of each check name. */
export function summarizeChecks(runs) {
  const current = latestByName(runs);
  const pick = (pred) => current.filter(pred).sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0] ?? null;
  const shape = (r) => (r ? { state: stateOfRun(r), id: r.id ?? null } : { state: "absent", id: null });
  const label = (r) => `${r.name}=${stateOfRun(r)}`;
  const failingRuns = current.filter((r) => FAILED.has(stateOfRun(r)));
  const pendingRuns = current.filter((r) => PENDING.has(stateOfRun(r)));
  const isRedName = (n) => n === GATING_CHECK || MAC_ONLY_CHECK_RE.test(n) || isCodeQL(n);
  return {
    total: runs.length,
    superseded: runs.length - current.length,
    gating: shape(pick((r) => r.name === GATING_CHECK)),
    macOnly: shape(pick((r) => MAC_ONLY_CHECK_RE.test(r.name))),
    failing: uniqSorted(failingRuns.map(label)),
    red: uniqSorted(failingRuns.filter((r) => isRedName(r.name)).map(label)),
    advisory: uniqSorted(failingRuns.filter((r) => !isRedName(r.name)).map(label)),
    pending: uniqSorted(pendingRuns.map(label)),
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
      info = { available: false, reason: `git unavailable: ${e?.message ?? e}` };
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
    base: item.base?.ref ?? base,
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
    f.base = detail.base?.ref ?? f.base;
    f.draft = detail.draft === true;
    f.updatedAt = detail.updated_at ?? f.updatedAt;
    f.idleDays = daysBetween(f.updatedAt, now);
    f.mergeableState = detail.mergeable_state ?? null;
    f.conflicting = f.mergeableState === "dirty" ? true : (f.mergeableState && f.mergeableState !== "unknown") ? false : null;
    f.filesExpected = typeof detail.changed_files === "number" ? detail.changed_files : null;
    f.commentsExpected = typeof detail.review_comments === "number" ? detail.review_comments : null;
    f.ask = f.lane === "mac" ? bodyAsksCloudToLand(detail.body) : false;
    f.quotesGates = bodyMentionsGates(detail.body);
    if (!Number.isFinite(f.idleDays) || !Number.isFinite(f.ageDays)) f.errors.pr = "created_at or updated_at is not a date, so the PR's age cannot be measured";
  } else if (!f.errors.pr) {
    f.errors.pr = "the PR detail came back empty";
  }

  const files = await guard("files", () => listAll(api, `/repos/${repo}/pulls/${item.number}/files`));
  if (files) {
    f.files = files.map((x) => ({ filename: x.filename, status: x.status, previous: x.previous_filename ?? null }));
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
  if (f.base !== baseName) b.push(`stacked on ${f.base}, not on ${baseName}`);
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
 *  page in the middle of that read is caught by comparing the two. */
async function countOf(api, path) {
  const r = await api.get(withQuery(path, "per_page=1"));
  const last = /[?&]page=(\d+)>;\s*rel="last"/.exec(r.headers?.get?.("link") ?? "");
  if (last) return Number(last[1]);
  return Array.isArray(r.json) ? r.json.length : 0;
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
  const need = open.prs.length * 7 + 120;
  if (core.remaining < need) {
    throw new ToolError(`the core rate limit has ${core.remaining} calls left and this read needs about ${need} for ${open.prs.length} PRs (resets at epoch ${core.reset}). Re-run after the reset; a partial queue is never printed.`, 2);
  }

  let standing = null;
  try {
    const lm = JSON.parse(io.readText(resolve(REPO_ROOT, "docs/agent/lane-mailbox.json")));
    if (Number.isInteger(lm.pr) && typeof lm.branch === "string") standing = { pr: lm.pr, branch: lm.branch };
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
    noLocalGit: false, now: null, concurrency: 6, allowCountDrift: false,
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
// whose `find` no longer occurs once DOES-NOT-APPLY, and any of those exits 1. The normal
// self-test also checks that every row still applies, so the table cannot rot unseen.
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
        const first = out.split("\n").find((l) => l.startsWith("  FAIL ")) ?? "";
        rows.push({ id: m.id, what: m.what, verdict: "killed", detail: first.replace(/^ {2}FAIL /, "").slice(0, 110) });
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
    find: "if (typeof total === \"number\" && runs.length < total) throw",
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
  { id: "N04", file: "skill", what: "the skill's re-classify command drops previous_filename (finding 4)",
    find: "-q '.[] | .filename, (.previous_filename // empty)'",
    replace: "-q '.[].filename'" },
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
    find: "err instanceof ApiError",
    replace: "err instanceof Array" },
  { id: "N22", file: "src", what: "a 403 that is not a rate limit exits 3 (finding 12)",
    find: "[401, 403, 404].includes(err.status) ? 2 : 3",
    replace: "[401, 404].includes(err.status) ? 2 : 3" },
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
    comments: o.comments ?? [],
    reportedComments: o.reportedComments,
    omitReviewComments: o.omitReviewComments ?? false,
    shortComments: o.shortComments ?? false,
    compare: o.compare ?? "diverged",
    fork: o.fork ?? false,
    unknownReads: o.unknownReads ?? 0,
  };
}

function worldFx(over = {}) {
  return {
    prs: [], issues: [], branches: [{ name: BASE_FX, commit: { sha: BASE_SHA_FX }, protected: true }], closed: [],
    rate: { limit: 5000, remaining: 4000, reset: 1792700000 },
    commitsByPath: {}, contents: new Set(), headDate: {}, fail: [], countOverride: undefined, latency: null, branchCut: null,
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
    head: { ref: p.ref, sha: p.sha, repo: { full_name: p.fork ? "someone/fork" : REPO_FX } }, base: { ref: p.base },
    user: { login: "DanFashauer" }, draft: p.draft, created_at: p.created, updated_at: p.updated,
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
        return respond(200, w.branches.slice(0, 1), w.branches.length > 1 ? { link: `<https://api.github.com/x?per_page=1&page=${w.branches.length}>; rel="last"` } : {});
      }
      // branchCut = { page, keep }: that page of the list comes back short (a GitHub hiccup)
      const cut = w.branchCut && Number(q.get("page") ?? 1) === w.branchCut.page ? w.branchCut.keep : null;
      const rows = pageOf(w.branches, q);
      return respond(200, cut === null ? rows : rows.slice(0, cut));
    }
    if (path === `${R}/pulls`) {
      const state = q.get("state");
      if (state === "open") return respond(200, pageOf([...w.prs].sort((a, b) => a.number - b.number).map(listItem), q));
      if (state === "closed") {
        const rows = [...w.closed].sort((a, b) => a.number - b.number);
        if (q.get("per_page") === "1") return respond(200, rows.slice(0, 1), rows.length > 1 ? { link: `<https://api.github.com/x?state=closed&per_page=1&page=${rows.length}>; rel="last"` } : {});
        return respond(200, pageOf(rows, q));
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
      return respond(200, {
        ...listItem(p), body: p.body, mergeable_state: unknown ? "unknown" : p.mergeable_state,
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
      return respond(200, { total_count: p?.checksTotal ?? runs.length, check_runs: pageOf(runs, q) });
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
    t("the skill's re-classify command keeps previous_filename, so a file moved out of lib/ is judged on its old path", /pulls\/<n>\/files[^\n]*previous_filename/.test(skill));
    t("control: the classifier does judge that old path (a rename away from lib/ is DECISION_PATH)", classifyFiles([{ filename: "docs/moved.md" }, { filename: "lib/signalgrid-core/src/old.ts" }]).categories.includes("DECISION_PATH") && classifyFiles([{ filename: "docs/moved.md" }]).tier === "autonomous");
    t("the skill and the page both say this PR is the owner's, by the tool's rule", /this PR is the owner's, by the tool's rule/.test(skill) && /this PR is the owner's, by the tool's rule/.test(page));
    t("the skill has the step that confirms a Mac ask in mail before anything lands", /artifacts\/lane-messages\/mac-\*\.json/.test(skill) && /body line/.test(skill));
    t("the skill and the page say which tick-PR rule holds (the stricter one) against LANE_COORDINATION rule 2", /rule 2/.test(skill) && /stricter/.test(skill) && /rule 2/.test(page) && /stricter/.test(page));
    t("the page documents the 403 behaviour and the comment-count check", /403/.test(page) && /review_comments/.test(page));
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
