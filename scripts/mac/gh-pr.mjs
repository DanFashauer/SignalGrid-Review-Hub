#!/usr/bin/env node
// gh-pr.mjs — open or update a pull request WITHOUT GraphQL, idempotently.
//
//   node scripts/mac/gh-pr.mjs open --head <branch> --title <t> --body-file <f> [--base <b>]
//   node scripts/mac/gh-pr.mjs limits          # every bucket, primary and secondary
//   node scripts/mac/gh-pr.mjs --self-test
//
// WHY THIS EXISTS — a real incident, 2026-09-14. `gh pr create` reported
// "GraphQL: API rate limit already exceeded" three times in a row while
// `gh api rate_limit` showed graphql at 5000/5000 and core at 4964/5000. Both
// primary buckets were EMPTY of usage. What had actually been hit was GitHub's
// SECONDARY rate limit on rapid content creation (two PRs, a review comment and
// several branches in a few minutes), which `rate_limit` does not report at all —
// so the one diagnostic everybody reaches for says "you have 5000 left" while every
// call fails. That mismatch is the trap this script exists to remove.
//
// AND THE EXPENSIVE HALF: one of those "rate limited" calls had ACTUALLY SUCCEEDED.
// The PR existed (#753); only the response came back as an error. Retrying created
// nothing, and the branch sat with an invisible PR nobody was reviewing. So the rule
// here is not "retry harder" — it is LOOK BEFORE YOU CREATE, every time.
//
// WHAT IT DOES DIFFERENTLY
//   1. REST only. `gh pr create` is GraphQL; `POST /repos/{o}/{r}/pulls` is REST, a
//      separate primary bucket. When one is throttled the other frequently is not.
//   2. Idempotent by construction: it LISTS open PRs for the head ref first. Found =>
//      PATCH it. Not found => POST. A create that already happened is never repeated,
//      and an error-that-was-really-a-success cannot orphan a branch.
//   3. Secondary limits are honoured with backoff rather than hammered — retrying a
//      secondary limit fast is what deepens it.
//
// NOT a gate. It changes nothing in the tree; it talks to the forge on the lane's
// behalf. Requires an authenticated `gh` and network (run sandbox-off).

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REPO = process.env.SIGNALGRID_REPO ?? "DanFashauer/SignalGrid-Review-Hub";
const DEFAULT_BASE = "SignalGrid_Alpha";
/** Secondary limits recover on their own; these waits are deliberately unhurried. */
export const BACKOFF_MS = [20_000, 60_000, 180_000];

function gh(args, input) {
  const run = spawnSync("gh", args, { encoding: "utf8", input });
  return { code: run.status ?? 1, out: `${run.stdout ?? ""}`, err: `${run.stderr ?? ""}` };
}

/**
 * Classify a failed `gh` call. The distinction that matters: a SECONDARY limit is
 * invisible to `rate_limit`, so "you have quota" and "every call fails" are both true
 * at once, and only backoff clears it.
 */
export function classifyFailure(text) {
  const t = String(text ?? "").toLowerCase();
  if (t.includes("secondary rate limit") || t.includes("abuse detection")) return "secondary";
  if (t.includes("rate limit")) return "rate-limited";
  if (t.includes("already exists")) return "already-exists";
  if (t.includes("http 401") || t.includes("bad credentials")) return "auth";
  if (t.includes("http 404")) return "not-found";
  return "other";
}

/** The open PR for this head ref, or null. REST, so it does not spend GraphQL. */
export function findOpenPr(head, repo = REPO) {
  const owner = repo.split("/")[0];
  const r = gh(["api", `repos/${repo}/pulls?head=${owner}:${head}&state=open`, "--jq", ".[0].number // empty"]);
  if (r.code !== 0) return { error: r.err || r.out, number: null };
  const n = r.out.trim();
  return { error: null, number: n ? Number(n) : null };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function openOrUpdate({ head, base, title, body, repo = REPO }) {
  // 1. LOOK FIRST — the rule this script exists for.
  const existing = findOpenPr(head, repo);
  if (existing.error) {
    console.error(`could not list PRs for ${head}: ${existing.error.trim()}`);
    return 1;
  }

  const payload = JSON.stringify(existing.number ? { title, body } : { title, body, head, base });
  const args = existing.number
    ? ["api", "-X", "PATCH", `repos/${repo}/pulls/${existing.number}`, "--input", "-", "--jq", ".html_url"]
    : ["api", "-X", "POST", `repos/${repo}/pulls`, "--input", "-", "--jq", ".html_url"];
  const verb = existing.number ? `updated #${existing.number}` : "opened";

  for (let attempt = 0; ; attempt += 1) {
    const r = gh(args, payload);
    if (r.code === 0) {
      console.log(`${verb}: ${r.out.trim()}`);
      return 0;
    }
    const kind = classifyFailure(`${r.err}${r.out}`);
    // A create that raced with an earlier success: re-resolve and PATCH instead of
    // failing. This is the exact shape that orphaned #753.
    if (kind === "already-exists") {
      const again = findOpenPr(head, repo);
      if (again.number) {
        const patch = gh(["api", "-X", "PATCH", `repos/${repo}/pulls/${again.number}`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ title, body }));
        if (patch.code === 0) { console.log(`updated #${again.number} (create raced a prior success): ${patch.out.trim()}`); return 0; }
      }
      console.error("a PR already exists for this head but could not be resolved — look on the forge before retrying.");
      return 1;
    }
    if ((kind === "secondary" || kind === "rate-limited") && attempt < BACKOFF_MS.length) {
      const wait = BACKOFF_MS[attempt];
      console.error(`${kind} limit; waiting ${Math.round(wait / 1000)}s before retry ${attempt + 1}/${BACKOFF_MS.length}. (A secondary limit is INVISIBLE to \`gh api rate_limit\` — quota shown is not quota available.)`);
      await sleep(wait);
      continue;
    }
    console.error(`gh failed (${kind}): ${(r.err || r.out).trim()}`);
    return 1;
  }
}

function limits() {
  const r = gh(["api", "rate_limit", "--jq", '.resources | to_entries[] | "\\(.key): \\(.value.remaining)/\\(.value.limit)"']);
  console.log(r.code === 0 ? r.out.trim() : (r.err || r.out).trim());
  console.log(
    "\nNOTE: this reports PRIMARY buckets only. GitHub's SECONDARY limit on rapid\n" +
    "content creation (PRs, comments, branches) is NOT listed here and is the usual\n" +
    "cause of 'rate limit exceeded' while these numbers look full. Backoff clears it;\n" +
    "retrying immediately deepens it.",
  );
  return 0;
}

function selfTest() {
  const checks = [];
  const t = (n, ok) => checks.push([n, ok]);
  t("a secondary-limit message classifies as secondary", classifyFailure("You have exceeded a secondary rate limit") === "secondary");
  t("an abuse-detection message classifies as secondary", classifyFailure("triggered an abuse detection mechanism") === "secondary");
  t("a plain rate-limit message classifies as rate-limited", classifyFailure("API rate limit already exceeded for user ID 1") === "rate-limited");
  t("an existing-PR message is recognised, not treated as a limit", classifyFailure("A pull request already exists for X.") === "already-exists");
  t("a 401 classifies as auth", classifyFailure("gh: HTTP 401 Bad credentials") === "auth");
  t("an unknown failure is not silently a limit", classifyFailure("something else entirely") === "other");
  t("backoff is unhurried and ascending", BACKOFF_MS.length >= 3 && BACKOFF_MS.every((v, i, a) => i === 0 || v > a[i - 1]) && BACKOFF_MS[0] >= 10_000);
  t("empty/undefined input does not crash and is not a limit", classifyFailure(undefined) === "other");
  const failed = checks.filter(([, ok]) => !ok);
  for (const [n, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — ${n}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (argv.includes("--self-test")) process.exit(selfTest());
  const cmd = argv[0];
  if (cmd === "limits") process.exit(limits());
  if (cmd === "open") {
    const head = val("--head");
    const title = val("--title");
    const bodyFile = val("--body-file");
    if (!head || !title || !bodyFile) {
      console.error('usage: gh-pr.mjs open --head <branch> --title "<t>" --body-file <path> [--base <branch>]');
      process.exit(2);
    }
    process.exit(await openOrUpdate({ head, base: val("--base") ?? DEFAULT_BASE, title, body: readFileSync(bodyFile, "utf8") }));
  }
  console.error("usage: gh-pr.mjs open|limits|--self-test");
  process.exit(2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
