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

export function isReviewable(path) {
  return !NOT_REVIEWABLE.some((re) => re.test(path));
}

/**
 * Pure audit. files: reviewable tracked paths. entries: ledger entries.
 * Returns { problems, coveredCount, total, byArea }.
 */
export function auditReviewCoverage(files, entries) {
  const problems = [];
  const covered = new Set();

  if (!Array.isArray(entries)) {
    problems.push(`${LEDGER}: no \`reviews\` array — the ledger is unreadable`);
    return { problems, coveredCount: 0, total: files.length, byArea: new Map() };
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
    if (typeof e?.path !== "string") continue;

    // A prefix claim covers everything beneath it; an exact claim covers one file.
    const matched = files.filter((f) => f === e.path || f.startsWith(e.path.endsWith("/") ? e.path : `${e.path}/`));
    if (matched.length === 0) {
      problems.push(`${LEDGER}: review claims \`${e.path}\`, which matches no reviewable file in this checkout — the ledger rotted, or the claim was always wrong`);
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

  return { problems, coveredCount: covered.size, total: files.length, byArea };
}

function selfTest() {
  const checks = [];
  const files = ["lib/a.ts", "lib/b.ts", "scripts/c.mjs"];
  const ok = { path: "lib/a.ts", reviewedBy: "qa-engineer", date: "2026-08-19", depth: "audited" };

  let a = auditReviewCoverage(files, [ok]);
  checks.push(["an exact-file review covers exactly that file", a.problems.length === 0 && a.coveredCount === 1]);

  a = auditReviewCoverage(files, [{ ...ok, path: "lib" }]);
  checks.push(["a directory review covers everything beneath it", a.problems.length === 0 && a.coveredCount === 2]);

  a = auditReviewCoverage(files, [{ ...ok, path: "lib/gone.ts" }]);
  checks.push(["a review of a path that does not exist is FATAL", a.problems.some((p) => p.includes("matches no reviewable file"))]);

  a = auditReviewCoverage(files, [{ ...ok, reviewedBy: "" }]);
  checks.push(["a review with no reviewer is FATAL — unattributable is not evidence", a.problems.some((p) => p.includes("reviewedBy"))]);

  a = auditReviewCoverage(files, [{ ...ok, depth: "glanced-at" }]);
  checks.push(["an unknown depth is FATAL", a.problems.some((p) => p.includes("unknown depth"))]);

  a = auditReviewCoverage(files, []);
  checks.push(["an empty ledger is honest, not fatal — zero coverage is a number", a.problems.length === 0 && a.coveredCount === 0]);

  checks.push(["generated output is not reviewable surface", !isReviewable("lib/dist/x.js") && !isReviewable("pnpm-lock.yaml") && isReviewable("lib/x.ts")]);

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

  const { problems, coveredCount, total, byArea } = auditReviewCoverage(files, entries);
  const pct = total === 0 ? 0 : ((coveredCount / total) * 100).toFixed(1);

  console.log(`Review coverage — ${coveredCount} of ${total} reviewable file(s) have been read by a named role: ${pct}%`);
  console.log("  (a green gate suite is not a reviewed codebase; this is the number that says so)");
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
  console.log("\nReview-coverage check passed — every review claim names a real path, a reviewer, a date and a depth.");
}
