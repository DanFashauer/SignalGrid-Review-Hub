#!/usr/bin/env node
// Mainline workflow red streaks — REPORT-ONLY (DR-060, lesson L8 in docs/agent/LESSONS.md).
//
// GitHub's own "pages build and deployment" workflow concluded failure on every push to
// SignalGrid_Alpha from 2026-08-23 to 2026-09-26 (34 days, ~1800 runs) and nothing read it:
// every gate here reads the GATING workflow, and no gate read a non-gating workflow's own
// conclusion. This reads the last N completed runs of every non-gating workflow that runs
// on the default branch with nobody watching (push or schedule) and names any whose last K
// judged runs are all red.
//
// NEVER FATAL ON A STREAK, BY DESIGN, ON DAY ONE: a red streak is printed with its length,
// when it started inside the window, and the run URL, and the exit is 0. Its own errors ARE
// fatal (exit 1): a workflow file in neither WATCHED nor NOT_WATCHED, a watched workflow the
// API does not list, an HTTP error, a payload of the wrong shape. An API it could not read
// is not "no red streak". Without a token outside CI it prints SKIPPED and exits 0
// (preflight classifies that with `selfSkipsWithout`); in CI a missing token is a broken
// step and exits 1, because a check that skips in CI is lesson L8 again.
//
//   node scripts/check-mainline-workflow-streaks.mjs                 # GITHUB_TOKEN or GH_TOKEN
//   node scripts/check-mainline-workflow-streaks.mjs --self-test
//   node scripts/check-mainline-workflow-streaks.mjs --fixture runs.json   # a saved runs payload, offline

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiWith } from "./check-ci-liveness.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BRANCH = "SignalGrid_Alpha";
const N = 10; // completed runs read per workflow
const K = 3; // consecutive red judged runs that make a streak
const RED = new Set(["failure", "timed_out", "startup_failure"]);
// A run cancelled by the next push, or skipped by a condition, says nothing about health.
// Counting it as green would let a red workflow with concurrency cancels hide its streak.
const NO_VERDICT = new Set(["cancelled", "skipped"]);

// Keyed by the Actions API `path`, which survives a display-name rename.
export const WATCHED = new Map([
  ["dynamic/pages/pages-build-deployment", "pages build and deployment"], // GitHub's, no file (deploy from branch)
  [".github/workflows/codeql.yml", "CodeQL"],
  [".github/workflows/supply-chain.yml", "Supply Chain"],
  [".github/workflows/connector-emulator-smoke.yml", "Connector Emulator Smoke"],
  [".github/workflows/raised-hands.yml", "Raised hands"],
  [".github/workflows/scheduled-verification.yml", "Scheduled Verification"],
  [".github/workflows/mac-runner-auto.yml", "Mac runner (automatic)"], // schedule, not push — still mainline
  [".github/workflows/mac-lane.yml", "Mac lane (full suite)"],
  [".github/workflows/ios-ci.yml", "Apple CI (iOS / iPadOS / macOS)"],
  [".github/workflows/android.yml", "Android"],
  [".github/workflows/desktop.yml", "Desktop (Windows / Linux)"],
  [".github/workflows/firmware.yml", "Dock firmware"],
]);
export const NOT_WATCHED = new Map([
  [".github/workflows/review-hub-ci.yml", "the gating workflow: its validation job is the required check every merge reads"],
  [".github/workflows/pages.yml", "workflow_dispatch only: whoever runs the deploy sees its result"],
  [".github/workflows/branch-prune.yml", "workflow_dispatch only"],
  [".github/workflows/mac-runner-harness.yml", "workflow_call / workflow_dispatch only"],
  [".github/workflows/phase-pr-evidence.yml", "pull_request only: no mainline runs"],
  [".github/workflows/pr-triage.yml", "pull_request_target only: no mainline runs"],
]);

/** Pure. Every workflow file is classified exactly once, and no entry names a file that is gone. */
export function classificationProblems(files, watched = WATCHED, notWatched = NOT_WATCHED) {
  const out = [];
  const known = [...watched.keys(), ...notWatched.keys()].filter((p) => p.startsWith(".github/workflows/"));
  for (const f of files) {
    if (!known.includes(f)) out.push(`${f}: in neither WATCHED nor NOT_WATCHED — classify it (a red streak there would be unread)`);
  }
  for (const p of known) {
    if (!files.includes(p)) out.push(`${p}: classified here but no such workflow file — remove the entry`);
    if (watched.has(p) && notWatched.has(p)) out.push(`${p}: both WATCHED and NOT_WATCHED`);
  }
  return out;
}

/** Pure. `conclusions` newest first. `oldest` indexes the earliest red run of the streak. */
export function streakVerdict(conclusions, k = K) {
  let judged = 0;
  let length = 0;
  let oldest = -1;
  for (let i = 0; i < conclusions.length; i += 1) {
    if (NO_VERDICT.has(conclusions[i])) continue;
    judged += 1;
    if (!RED.has(conclusions[i])) break;
    length += 1;
    oldest = i;
  }
  if (judged === 0) return { kind: "no-runs", length: 0, oldest: -1 };
  return { kind: length >= k ? "red" : "none", length, oldest };
}

/** Pure. One report line for one workflow's runs payload. */
export function rowFor(label, runs) {
  const sorted = [...runs]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)) || b.id - a.id)
    .slice(0, N);
  const v = streakVerdict(sorted.map((r) => r.conclusion));
  if (v.kind === "no-runs") return { red: false, line: `  no runs  ${label}: no judged completed run on ${BRANCH} in the last ${N}` };
  if (v.kind === "none") return { red: false, line: `  ok       ${label}${v.length ? ` (last ${v.length} red, below ${K})` : ""}` };
  const judged = sorted.filter((r) => !NO_VERDICT.has(r.conclusion)).length;
  const open = v.length === judged && sorted.length === N; // every run in a full window is red
  const first = sorted[v.oldest];
  return {
    red: true,
    line:
      `  RED      ${label}: ${open ? "≥" : ""}${v.length} consecutive red run(s)` +
      `${open ? " — began before this window" : ""}; earliest in window ${first.created_at} ${first.html_url}`,
  };
}

/** Pure. owner/repo from any remote URL form (https, ssh, a proxy path ending in owner/repo). */
export function slugFromRemote(url) {
  const m = /([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(url).trim());
  if (!m) throw new Error(`cannot derive owner/repo from origin URL`);
  return `${m[1]}/${m[2]}`;
}

/** Reads the Actions API through `fetchImpl`. Throws on any HTTP error or unresolved workflow. */
export async function scan(fetchImpl, slug, apiOpts = {}) {
  const get = (p) => apiWith(fetchImpl, p, apiOpts);
  const listed = [];
  for (let page = 1; ; page += 1) {
    const body = await get(`/repos/${slug}/actions/workflows?per_page=100&page=${page}`);
    if (!Array.isArray(body?.workflows)) throw new Error(`GET /repos/${slug}/actions/workflows: no workflows array`);
    listed.push(...body.workflows);
    if (body.workflows.length < 100) break;
  }
  const byPath = new Map(listed.map((w) => [w.path, w]));
  const missing = [...WATCHED].filter(([p]) => !byPath.has(p)).map(([p, label]) => `"${label}" (${p})`);
  if (missing.length) throw new Error(`the Actions API lists no workflow for ${missing.join(", ")} — renamed or removed`);
  const rows = [];
  for (const [path, label] of WATCHED) {
    const runsPath = `/repos/${slug}/actions/workflows/${byPath.get(path).id}/runs?branch=${BRANCH}&status=completed&per_page=${N}`;
    const body = await get(runsPath);
    if (!Array.isArray(body?.workflow_runs)) throw new Error(`GET ${runsPath}: no workflow_runs array`);
    rows.push(rowFor(label, body.workflow_runs));
  }
  return rows;
}

function print(rows) {
  for (const r of rows) console.log(r.line);
  const red = rows.filter((r) => r.red).length;
  console.log(
    red === 0
      ? "\nno red streak"
      : `\n${red} red streak(s) of ${K}+ on ${BRANCH} — REPORTED, not fatal (day one, by design). Read the run and fix the workflow or the setting behind it.`,
  );
}

function fixtureRows(path) {
  const body = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(body?.workflow_runs)) throw new Error(`${path}: not a runs payload (no workflow_runs array)`);
  return [rowFor(body.workflow_runs[0]?.name ?? path, body.workflow_runs)];
}

// SYNTHETIC — shaped after GitHub's REST reference for "List workflow runs for a workflow"
// (GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs); ids, times and URLs are
// invented. Swap for a real Pages payload captured by this check in CI once it has run there.
const SYNTHETIC_PAGES_RUNS = {
  total_count: 1800,
  workflow_runs: Array.from({ length: N }, (_, i) => ({
    id: 9000 - i,
    name: "pages build and deployment",
    path: "dynamic/pages/pages-build-deployment",
    head_branch: BRANCH,
    event: "dynamic",
    status: "completed",
    conclusion: "failure",
    created_at: `2026-09-${String(26 - i).padStart(2, "0")}T06:00:00Z`,
    html_url: `https://github.com/OWNER/REPO/actions/runs/${9000 - i}`,
  })),
};

async function selfTest() {
  let pass = 0;
  let fail = 0;
  const t = (name, ok) => {
    if (ok) pass += 1;
    else { fail += 1; console.error(`  ✗ ${name}`); }
  };
  const kind = (c, k) => streakVerdict(c, k).kind;
  t("3 failures → streak 3", kind(["failure", "failure", "failure"]) === "red" && streakVerdict(["failure", "failure", "failure"]).length === 3);
  t("latest success → none", kind(["success", "failure", "failure"]) === "none");
  t("[] → no runs, not fatal", kind([]) === "no-runs");
  t("2 failures with K=3 → none", kind(["failure", "failure"], 3) === "none");
  t("timed_out and startup_failure are red", kind(["timed_out", "startup_failure", "failure"]) === "red");
  t("a cancelled run neither breaks nor extends a streak", streakVerdict(["cancelled", "failure", "failure", "failure", "success"]).length === 3);
  t("only cancelled/skipped → no runs", kind(["cancelled", "skipped"]) === "no-runs");

  const dir = mkdtempSync(join(tmpdir(), "streaks-"));
  const fx = join(dir, "pages-runs.json");
  writeFileSync(fx, JSON.stringify(SYNTHETIC_PAGES_RUNS));
  const [row] = fixtureRows(fx);
  t("--fixture: the synthetic Pages payload reads as red, ≥10, dated", row.red && row.line.includes("≥10") && row.line.includes("2026-09-17T06:00:00Z"));
  writeFileSync(join(dir, "bad.json"), "{}");
  t("--fixture: a payload of the wrong shape throws", (() => { try { fixtureRows(join(dir, "bad.json")); return false; } catch { return true; } })());
  rmSync(dir, { recursive: true, force: true });

  t("every workflow file classified → clean", classificationProblems([...WATCHED.keys(), ...NOT_WATCHED.keys()].filter((p) => p.startsWith("."))).length === 0);
  t("an unclassified workflow file is named", classificationProblems([".github/workflows/new.yml", ...[...WATCHED.keys(), ...NOT_WATCHED.keys()].filter((p) => p.startsWith("."))]).some((p) => p.includes("new.yml")));
  t("a stale classification is named", classificationProblems([]).some((p) => p.includes("codeql.yml")));

  t("slug from https", slugFromRemote("https://github.com/o/r.git") === "o/r");
  t("slug from ssh", slugFromRemote("git@github.com:o/r.git") === "o/r");
  t("slug from a proxy path", slugFromRemote("http://proxy@127.0.0.1:1/git/o/r") === "o/r");

  // scan() over a fake API: one red workflow, a missing workflow, an HTTP error.
  const res = (status, body) => ({ ok: status < 400, status, statusText: String(status), headers: new Map(), json: async () => body, text: async () => "" });
  const listing = (paths) => ({ workflows: paths.map((path, id) => ({ id: id + 1, path })) });
  const allPaths = [...WATCHED.keys()];
  const green = { workflow_runs: [{ id: 1, conclusion: "success", created_at: "2026-09-26T00:00:00Z", html_url: "u" }] };
  const fake = (over) => async (url) => {
    const u = new URL(url);
    if (u.pathname.endsWith("/actions/workflows")) return res(200, over.list ?? listing(allPaths));
    if (over.runsStatus) return res(over.runsStatus, {});
    return res(200, u.pathname.includes("/workflows/1/") ? SYNTHETIC_PAGES_RUNS : green);
  };
  const opts = { attempts: 1, wait: async () => {} };
  const rows = await scan(fake({}), "o/r", opts);
  t("scan: exactly the Pages workflow is red", rows.filter((r) => r.red).length === 1 && rows[0].red && rows.length === WATCHED.size);
  const threw = async (f, needle) => { try { await f(); return false; } catch (e) { return String(e.message).includes(needle); } };
  t("scan: a watched workflow the API does not list fails, named", await threw(() => scan(fake({ list: listing(allPaths.filter((p) => !p.endsWith("codeql.yml"))) }), "o/r", opts), "CodeQL"));
  t("scan: an HTTP error fails, naming the path", await threw(() => scan(fake({ runsStatus: 404 }), "o/r", opts), "/runs?branch=SignalGrid_Alpha"));

  console.log(`mainline-workflow-streaks self-test: ${pass}/${pass + fail} passed`);
  return fail === 0 ? 0 : 1;
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const fx = process.argv.indexOf("--fixture");
  if (fx !== -1) {
    const path = process.argv[fx + 1];
    if (!path) throw new Error("--fixture needs a path to a saved runs payload");
    console.log(`Mainline workflow red streaks — OFFLINE over ${path} (K=${K}, N=${N})`);
    print(fixtureRows(path));
    return 0;
  }
  const files = readdirSync(join(repo, ".github/workflows")).filter((f) => /\.ya?ml$/.test(f)).map((f) => `.github/workflows/${f}`);
  const problems = classificationProblems(files);
  if (problems.length) {
    for (const p of problems) console.error(`  ✗ ${p}`);
    return 1;
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (!token) {
    if (process.env.CI || process.env.GITHUB_ACTIONS) {
      console.error("  ✗ no GITHUB_TOKEN/GH_TOKEN in CI — the workflow step lost its env block; a check that skips in CI is lesson L8 again.");
      return 1;
    }
    console.log("SKIPPED — no GITHUB_TOKEN/GH_TOKEN (this check runs in CI)");
    return 0;
  }
  const slug = slugFromRemote(execFileSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }));
  console.log("Mainline workflow red streaks — REPORT-ONLY (exit 0 on a streak by design; exit 1 on this check's own errors)");
  console.log(`window: last ${N} completed runs per workflow on ${BRANCH}, streak = ${K}+ red in a row, read ${new Date().toISOString()}\n`);
  print(await scan(fetch, slug));
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`  ✗ ${err.message}\nMainline workflow streak check FAILED on its own error — an API it could not read is not "no red streak".`);
    process.exit(1);
  },
);
