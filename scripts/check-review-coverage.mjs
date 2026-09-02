// check-review-coverage.mjs — a green gate suite is not a reviewed codebase.
//
//   node scripts/check-review-coverage.mjs              # report + gate
//   node scripts/check-review-coverage.mjs --self-test  # prove the gate can fail
//
// THE DEFECT THIS EXISTS TO MAKE VISIBLE. On 2026-08-19 the owner asked why the
// estate is not reviewed to a golden standard. The honest answer was that it is
// not close: 1,304 source files in this repository alone, of which a day of
// agent shifts had read perhaps forty, in fragments — two or three percent of
// one repository out of seven. Nothing showed that. Every status report said
// "184 gates, 0 unwired, all green", which FEELS like everything is checked and
// is not: a gate checks an invariant, and an invariant holds perfectly well over
// code nobody has ever read. That is the unearned affirmative at estate scale.
//
// Role activations made it worse rather than better. "10 of 31 roles activated"
// reads as coverage and is not — an activation is one shift, and the QA shift
// read three files out of five hundred and twenty-four.
//
// So coverage becomes a number that cannot flatter us. Reported on every run,
// beside every green suite.
//
// REPORTED, NEVER FATAL on the percentage. A gate that fails the build at three
// percent coverage would be switched off inside a day, and this repository's
// standing position is that a gate which gets switched off is worse than one
// that tells the truth every run. Only INCOHERENCE fails: a review entry naming
// a path this checkout does not contain, or an entry that does not say who
// reviewed it, when, or at what depth — because an unattributable review claim
// is exactly the kind of comfortable fiction the ledger exists to prevent.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = "docs/agent/review-coverage.json";

/** Files nobody should be asked to "review" — generated, vendored, or data. */
const NOT_REVIEWABLE = [
  /(^|\/)dist\//,
  /(^|\/)node_modules\//,
  /\.lock$/,
  /^pnpm-lock\.yaml$/,
  /(^|\/)fixtures?\//,
  /\.(png|jpg|jpeg|gif|svg|ico|pdf|woff2?|ttf|mp4|zip|war)$/i,
];

/** Depths a review claim may assert, weakest first. */
export const DEPTHS = ["read", "audited", "verified-live"];

/**
 * RETIREMENT. A claim is retired when the file it names has been DELETED. The
 * rule lives in one place — the `$comment` at the top of the ledger — and the
 * short form is: a deleted surface retires its claims; a retired claim must
 * name a file that is gone; the ratchet accepts exactly that drop.
 *
 * Written 2026-09-02, the first time a reviewed surface was deleted
 * (`artifacts/mockup-sandbox`, Ponytail cut 3). Before this, the only way to
 * satisfy this gate after a deletion was to DELETE the review entries — which
 * silently un-read five files and tripped the role-coverage ratchet with no
 * mechanism to answer it. Deleting the evidence is not how you record that a
 * thing is gone.
 *
 * An entry carrying EITHER key must carry both, or it is half-retired and that
 * is a problem: a `retiredWhy` with no date cannot be checked against anything.
 */
export function isRetired(e) {
  return e?.retiredOn !== undefined || e?.retiredWhy !== undefined;
}

/** YYYY-MM-DD naming a real calendar day. `2026-02-30` is not one. */
export function isIsoDate(v) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function isReviewable(path) {
  return !NOT_REVIEWABLE.some((re) => re.test(path));
}

/**
 * Pure audit. files: reviewable tracked paths. entries: ledger entries.
 * Returns { problems, coveredCount, total, byArea, retiredCount }. A retired
 * entry is counted in retiredCount and in NOTHING else — never in coveredCount.
 */
export function auditReviewCoverage(files, entries) {
  const problems = [];
  const covered = new Set();
  let retiredCount = 0;

  if (!Array.isArray(entries)) {
    problems.push(`${LEDGER}: no \`reviews\` array — the ledger is unreadable`);
    return { problems, coveredCount: 0, total: files.length, byArea: new Map(), retiredCount: 0 };
  }

  for (const e of entries) {
    const label = typeof e?.path === "string" ? e.path : "(no path)";
    for (const field of ["path", "reviewedBy", "date", "depth"]) {
      if (typeof e?.[field] !== "string" || e[field].trim() === "") {
        problems.push(`${LEDGER}: review of \`${label}\` is missing \`${field}\` — an unattributable review claim is not evidence`);
      }
    }
    if (e?.depth !== undefined && !DEPTHS.includes(e.depth)) {
      problems.push(`${LEDGER}: review of \`${label}\` has unknown depth \`${e.depth}\` (expected ${DEPTHS.join(" | ")})`);
    }

    const retired = isRetired(e);
    if (retired) {
      retiredCount += 1;
      if (!isIsoDate(e.retiredOn)) {
        problems.push(`${LEDGER}: review of \`${label}\` has \`retiredOn\` \`${e.retiredOn}\` — a retirement must name the day it happened, as YYYY-MM-DD`);
      }
      if (typeof e.retiredWhy !== "string" || e.retiredWhy.trim() === "") {
        problems.push(`${LEDGER}: review of \`${label}\` is retired with no \`retiredWhy\` — an unexplained retirement is indistinguishable from deleting the evidence`);
      }
    }
    if (typeof e?.path !== "string") continue;

    // An exact claim covers one file. A PREFIX claim used to cover everything
    // beneath it, and that was the hole: two directory entries —
    // `artifacts/signalgrid-web/src` and `.github/workflows` — silently counted 93
    // files as read on the strength of two lines. `docs/agent/REVIEW_CYCLE.md`
    // already required "FILE-level ledger entries (never directory prefixes)"; the
    // gate simply did not enforce the rule it was written beside, so the number
    // this whole effort exists to make true was inflated by its own checker.
    //
    // Found by a reader auditing the web trees, in the ledger rather than in the
    // code — which is the point of having one.
    const matched = files.filter((f) => f === e.path || f.startsWith(e.path.endsWith("/") ? e.path : `${e.path}/`));

    // A RETIRED claim is the mirror image of a live one: it must match nothing.
    // It covers nothing either — retirement records that a read happened, not
    // that anything in this checkout is read. If the file is still here, this
    // is a role narrowing its own surface under the word "retired", which is
    // exactly the move the ratchet exists to catch.
    if (retired) {
      if (matched.length > 0) {
        problems.push(
          `${LEDGER}: review of \`${e.path}\` is retired while the file lives — a narrowing, not a retirement. ` +
            `Retirement is only for a path this checkout no longer contains; if the file is still here the claim still stands.`,
        );
      }
      continue;
    }

    if (matched.length === 0) {
      problems.push(`${LEDGER}: review claims \`${e.path}\`, which matches no reviewable file in this checkout — the ledger rotted, or the claim was always wrong`);
    } else if (matched.length > 1 || !files.includes(e.path)) {
      problems.push(
        `${LEDGER}: review claims \`${e.path}\`, a DIRECTORY standing in for ${matched.length} file(s) — ` +
          `a prefix is not a file-level read. Record one entry per file actually opened, ` +
          `each with a note naming what was and was NOT examined (REVIEW_CYCLE.md).`,
      );
      continue;
    }
    for (const f of matched) covered.add(f);
  }

  // Where the gap actually is, by top-level area, so the report is actionable.
  const byArea = new Map();
  for (const f of files) {
    const area = f.split("/")[0];
    const cur = byArea.get(area) ?? { total: 0, covered: 0 };
    cur.total += 1;
    if (covered.has(f)) cur.covered += 1;
    byArea.set(area, cur);
  }

  return { problems, coveredCount: covered.size, total: files.length, byArea, retiredCount };
}

function selfTest() {
  const checks = [];
  const files = ["lib/a.ts", "lib/b.ts", "scripts/c.mjs"];
  const ok = { path: "lib/a.ts", reviewedBy: "qa-engineer", date: "2026-08-19", depth: "audited" };

  let a = auditReviewCoverage(files, [ok]);
  checks.push(["an exact-file review covers exactly that file", a.problems.length === 0 && a.coveredCount === 1]);

  // A DIRECTORY claim is FATAL, and this case used to assert the opposite.
  //
  // The gate once let a prefix cover everything beneath it, and the self-test
  // pinned that as intended behaviour — so the defect had a test defending it. Two
  // directory entries in the real ledger (`artifacts/signalgrid-web/src` and
  // `.github/workflows`) were silently counting 93 files as read, inflating the one
  // number this whole effort exists to make true, and the self-test would have
  // failed anyone who fixed it.
  //
  // `REVIEW_CYCLE.md` already required "FILE-level ledger entries (never directory
  // prefixes)". The gate and its self-test now enforce the rule they were written
  // beside. BOTH directions are pinned below so the fix cannot regress into
  // rejecting legitimate exact-file claims.
  a = auditReviewCoverage(files, [{ ...ok, path: "lib" }]);
  checks.push([
    "a DIRECTORY review is FATAL — a prefix is not a file-level read",
    a.problems.some((p) => p.includes("a DIRECTORY standing in for")) && a.coveredCount === 0,
  ]);

  a = auditReviewCoverage(files, [ok, { ...ok, path: "lib/b.ts" }]);
  checks.push([
    "...but two exact-file reviews still cover exactly two files",
    a.problems.length === 0 && a.coveredCount === 2,
  ]);

  a = auditReviewCoverage(files, [{ ...ok, path: "lib/gone.ts" }]);
  checks.push(["a review of a path that does not exist is FATAL", a.problems.some((p) => p.includes("matches no reviewable file"))]);

  a = auditReviewCoverage(files, [{ ...ok, reviewedBy: "" }]);
  checks.push(["a review with no reviewer is FATAL — unattributable is not evidence", a.problems.some((p) => p.includes("reviewedBy"))]);

  a = auditReviewCoverage(files, [{ ...ok, depth: "glanced-at" }]);
  checks.push(["an unknown depth is FATAL", a.problems.some((p) => p.includes("unknown depth"))]);

  a = auditReviewCoverage(files, []);
  checks.push(["an empty ledger is honest, not fatal — zero coverage is a number", a.problems.length === 0 && a.coveredCount === 0]);

  // RETIREMENT — all three directions, because two of them are the ways this
  // mechanism could be abused rather than used.
  const retired = { ...ok, path: "lib/gone.ts", retiredOn: "2026-09-02", retiredWhy: "deleted in cut 3" };

  a = auditReviewCoverage(files, [retired]);
  checks.push([
    "a RETIRED review of a file that is GONE is accepted, and covers nothing",
    a.problems.length === 0 && a.coveredCount === 0 && a.retiredCount === 1,
  ]);

  a = auditReviewCoverage(files, [{ ...retired, path: "lib/a.ts" }]);
  checks.push([
    "a RETIRED review of a file that STILL EXISTS is FATAL — a narrowing, not a retirement",
    a.problems.some((p) => p.includes("retired while the file lives")) && a.coveredCount === 0,
  ]);

  a = auditReviewCoverage(files, [{ ...ok, path: "lib/gone.ts" }]);
  checks.push([
    "a NON-retired review of a missing file is still FATAL — retirement is the only way to say a file left",
    a.problems.some((p) => p.includes("matches no reviewable file")),
  ]);

  a = auditReviewCoverage(files, [{ ...retired, retiredOn: "2026-02-30" }]);
  checks.push(["a retirement dated to a day that does not exist is FATAL", a.problems.some((p) => p.includes("retiredOn"))]);

  a = auditReviewCoverage(files, [{ ...retired, retiredWhy: "   " }]);
  checks.push(["a retirement with no reason is FATAL", a.problems.some((p) => p.includes("retiredWhy"))]);

  a = auditReviewCoverage(files, [{ ...ok, path: "lib/gone.ts", retiredWhy: "deleted" }]);
  checks.push(["half-retired (a why with no date) is FATAL", a.problems.some((p) => p.includes("retiredOn"))]);

  checks.push([
    "a live entry is not retired; a dated one is; 2026-02-30 is not a date",
    !isRetired(ok) && isRetired(retired) && isIsoDate("2026-09-02") && !isIsoDate("2026-02-30") && !isIsoDate("2026-9-2"),
  ]);

  checks.push(["generated output is not reviewable surface", !isReviewable("lib/dist/x.js") && !isReviewable("pnpm-lock.yaml") && isReviewable("lib/x.ts")]);

  // LIVE FLOOR. The three cases above are synthetic; this asserts the real
  // ledger still parses and still carries at least one entry of each kind, so a
  // schema drift that silently stopped producing retired entries is visible.
  const liveEntries = JSON.parse(readFileSync(join(repo, LEDGER), "utf8")).reviews ?? [];
  const liveRetired = liveEntries.filter(isRetired);
  checks.push([
    `LIVE: the ledger parses and carries both live and retired claims (${liveEntries.length - liveRetired.length} live, ${liveRetired.length} retired)`,
    liveEntries.length > 100 && liveRetired.length > 0 && liveRetired.every((e) => isIsoDate(e.retiredOn) && typeof e.retiredWhy === "string" && e.retiredWhy.trim() !== ""),
  ]);

  const failed = checks.filter(([, ok2]) => !ok2);
  for (const [name, ok2] of checks) console.log(`  ${ok2 ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());
if (runAsCli) runGate();

function runGate() {
  const files = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .filter(isReviewable);

  const path = join(repo, LEDGER);
  let entries = [];
  if (existsSync(path)) {
    try {
      entries = JSON.parse(readFileSync(path, "utf8")).reviews ?? [];
    } catch (err) {
      console.error(`Review-coverage check FAILED: ${LEDGER} is not valid JSON — ${err.message}`);
      process.exit(1);
    }
  }

  const { problems, coveredCount, total, byArea, retiredCount } = auditReviewCoverage(files, entries);
  const pct = total === 0 ? 0 : ((coveredCount / total) * 100).toFixed(1);

  console.log(`Review coverage — ${coveredCount} of ${total} reviewable file(s) have been read by a named role: ${pct}%`);
  console.log("  (a green gate suite is not a reviewed codebase; this is the number that says so)");
  if (retiredCount > 0) {
    console.log(`  ${retiredCount} retired claim(s) — files that were read and have since been DELETED. They count as covering nothing.`);
  }
  const rows = [...byArea].sort((a, b) => b[1].total - a[1].total);
  console.log("\n  BY AREA:");
  for (const [area, s] of rows) {
    const p = s.total === 0 ? 0 : ((s.covered / s.total) * 100).toFixed(0);
    console.log(`    ${area.padEnd(12)} ${String(s.covered).padStart(4)} / ${String(s.total).padEnd(5)} ${String(p).padStart(3)}%`);
  }

  if (problems.length > 0) {
    console.error(`\nReview-coverage check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("\nReview-coverage check passed — every live claim names a real path, a reviewer, a date and a depth; every retired claim names a file that is gone and says why.");
}
