// check-memory-freshness.mjs — a dated claim is a claim with a shelf life.
//
//   node scripts/check-memory-freshness.mjs              # report + gate
//   node scripts/check-memory-freshness.mjs --self-test  # prove the gate can fail
//
// Sibling of `check-lane-messages.mjs` and `check-sim-requests.mjs`, and
// deliberately the same shape, because it enforces the same law one layer over:
// those two refuse to let unrun work and unread mail read as done, and this
// refuses to let an AGING "as of <date>" claim read as current. Intake row 91
// names the durable handoff — the ledger, the owner board, the lane inbox —
// as the memory a fresh session trusts; OWNER_ACTIONS.md has twice recorded a
// claim that "was true when written and quietly stopped being true", and until
// this file existed, nothing watched the memory files for the third time.
//
// STALE IS REPORTED, NEVER FATAL. An "as of" claim past its freshness budget
// is not known to be wrong — it is known to be UNVERIFIED-LATELY, and failing
// the build because time passed would be a gate that goes red with no change,
// which is the flaky-gate shape this repo switches off. Only CLOCK-FREE
// incoherence fails: a watched file that does not exist (the registry rotted),
// or a watched file carrying no dated claims at all (the registry watches a
// surface that no longer has the thing it watches — silence wearing green).
// Everything the clock touches — staleness, even a future-dated claim — is
// reported loudly and never silently.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The freshness budget: how long an "as of" claim may stand before this report
// names it due for re-verification. Chosen, not derived — long enough that a
// normal week of owner cadence stays quiet, short enough that a forgotten
// claim is named within the month it starts lying.
export const FRESHNESS_BUDGET_DAYS = 14;

// The watched memory files. Every entry is a file that a fresh session is told
// to trust (intake row 91's "durable handoff") AND that carries dated status
// claims no other gate re-verifies: docs-sanity checks existence and
// over-reach, check-proof-figures only proof-linked figures, check-status-figures
// only STATUS.md's inventory line. The ledger itself is NOT here on purpose —
// its rows are historical records gated by proof:operating-method, and "was
// true when written" is the ledger's nature, not its failure mode.
export const WATCHED_MEMORY_FILES = [
  { path: "docs/OWNER_ACTIONS.md", why: "the owner board — dated 'waiting on you' state" },
  { path: "docs/COMPANY_VS_PRODUCT.md", why: "the watch-fabric table's 'verified green as of' column" },
];

const AS_OF = /\bas of (\d{4}-\d{2}-\d{2})\b/gi;

function daysBetween(fromIso, toIso) {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);
}

/**
 * Pure audit: takes the file contents and "today" as ARGUMENTS so the fatal
 * path is testable and the clock never decides a verdict — only the report
 * uses it. files: [{ path, text|null }]; todayIso: "YYYY-MM-DD".
 */
export function auditMemoryFreshness(files, todayIso) {
  const problems = [];
  const due = [];
  const fresh = [];
  for (const f of files) {
    if (f.text === null) {
      problems.push(`watched memory file ${f.path} does not exist — the registry in check-memory-freshness.mjs rotted`);
      continue;
    }
    const dates = [...f.text.matchAll(AS_OF)].map((m) => m[1]);
    if (dates.length === 0) {
      problems.push(`watched memory file ${f.path} carries no "as of <date>" claim — it is watched for dated claims it no longer has; update the registry or the file`);
      continue;
    }
    for (const d of dates) {
      const age = daysBetween(d, todayIso);
      if (age > FRESHNESS_BUDGET_DAYS) due.push(`${f.path}: "as of ${d}" is ${age} days old (budget ${FRESHNESS_BUDGET_DAYS}) — re-verify or re-date`);
      else if (age < 0) due.push(`${f.path}: "as of ${d}" is ${-age} day(s) in the FUTURE — a record of a verification that has not happened`);
      else fresh.push(`${f.path}: as of ${d} (${age}d)`);
    }
  }
  return { problems, due, fresh };
}

function selfTest() {
  const checks = [];
  const t = "2026-08-18";

  let a = auditMemoryFreshness([{ path: "m.md", text: "Verified green as of 2026-08-17." }], t);
  checks.push(["a claim inside the budget is fresh and quiet", a.due.length === 0 && a.problems.length === 0 && a.fresh.length === 1]);

  a = auditMemoryFreshness([{ path: "m.md", text: "as of 2026-07-01 everything was fine" }], t);
  checks.push(["a claim past the budget is DUE, and due is not a failure", a.due.length === 1 && a.problems.length === 0]);

  a = auditMemoryFreshness([{ path: "m.md", text: "as of 2026-09-01 this will be true" }], t);
  checks.push(["a FUTURE-dated claim is named — a verification that has not happened", a.due.some((d) => d.includes("FUTURE"))]);

  a = auditMemoryFreshness([{ path: "gone.md", text: null }], t);
  checks.push(["a watched file that does not exist is FATAL — the registry rotted", a.problems.some((p) => p.includes("does not exist"))]);

  a = auditMemoryFreshness([{ path: "m.md", text: "no dated claims here" }], t);
  checks.push(["a watched file with no dated claim is FATAL — watching nothing reads as green", a.problems.some((p) => p.includes("no \"as of"))]);

  a = auditMemoryFreshness([{ path: "m.md", text: "done 2026-07-01, merged 2026-07-02" }], t);
  checks.push(["historical dates WITHOUT 'as of' are not claims and stay exempt", a.problems.length === 1 && a.due.length === 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const files = WATCHED_MEMORY_FILES.map(({ path }) => {
  const abs = join(repo, path);
  return { path, text: existsSync(abs) ? readFileSync(abs, "utf8") : null };
});
const today = new Date().toISOString().slice(0, 10);
const { problems, due, fresh } = auditMemoryFreshness(files, today);

console.log(`Memory freshness — ${files.length} watched file(s), ${fresh.length} dated claim(s) inside the ${FRESHNESS_BUDGET_DAYS}-day budget`);
if (due.length > 0) {
  console.log("\n  DUE — dated claims past their freshness budget (reported, never fatal):");
  for (const d of due) console.log(`    · ${d}`);
  console.log("  Re-verify the claim and refresh its date, or replace it with a live measurement.");
}
if (problems.length > 0) {
  console.error(`\nMemory freshness check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nMemory freshness check passed — every watched memory file exists and carries the dated claims it is watched for.");
