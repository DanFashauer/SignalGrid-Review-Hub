// check-backlog-evidence.mjs — a row that says FIXED must say how you'd check.
//
//   node scripts/check-backlog-evidence.mjs              # report + ratchet
//   node scripts/check-backlog-evidence.mjs --self-test  # prove the gate can fail
//
// WHY THIS EXISTS. `check-backlog-ownership.mjs` answers "does every open job
// have a role". This answers the next one: when a row says the job is DONE,
// what would a stranger run to find out whether that is still true?
//
// On 2026-08-25 four rows (83, 89, 134, 135) read OPEN for fixes that had
// already merged in PRs #309-#312, and one earlier row (107) read CLOSED for
// work that had not. A ledger wrong in both directions is not a ledger. The
// obvious control — "a row may not read OPEN while naming a merged PR" — was
// built, measured against the actual defect, and DISCARDED: none of the four
// rows named a PR at all, so it would have fired zero times on the very
// instances that motivated it. Shipping it would have been a gate that
// measures a real property and answers a different question than the one
// asked, which is the exact defect class this repository keeps finding.
//
// WHAT IS ACTUALLY DECIDABLE. Not "is this row's status true" — that needs
// someone to read the code. But "does this row hand the reader anything to
// check" is decidable from the text, and it is the precondition for ever
// auditing the first question cheaply. So this gate requires EVIDENCE on a
// closed row: a PR reference, a commit, a runnable command, or a concrete
// file path.
//
// A RATCHET, NOT A BAR. 50 of 67 closed rows carry no evidence today. A gate
// failing 75% of an existing document on the day it lands is a gate somebody
// switches off, so this records today's count as a DEBT CEILING and fails only
// when the number goes UP. Note the polarity is the opposite of
// `role-coverage-ratchet.json`, which is a high-water mark where a DROP is
// fatal. Here a drop is the good direction and is recorded automatically.
//
// WHAT THIS DOES NOT DO, stated so nobody reads more into a green run: it
// cannot tell that a row's status is WRONG. A row reading OPEN beside a merged
// fix still passes, because nothing in the text distinguishes it from a row
// reading OPEN beside unmerged work. That direction needs a periodic re-read
// by someone who can check the tree, and this gate is not a substitute for it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CLOSED_MARKERS, PARTIAL_MARKERS, auditBacklogOwnership, marks, parseRows, rosterIds, statusText } from "./check-backlog-ownership.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = "docs/COMPANY_BUILD_PLAN.md";
const RATCHET = "docs/agent/backlog-evidence-ratchet.json";

// The SAME closed set `check-backlog-ownership.mjs` classifies on, reached
// through its own exported `marks`, `statusText` and partial list so the two
// gates cannot disagree about which rows are closed.
//
// THE FIRST VERSION OF THIS FILE MADE EXACTLY THAT CLAIM AND WAS WRONG. It ran
// `marks` over the row's RAW text and skipped two things the sibling does:
// `statusText`, which blanks quoted and code spans because "a quotation
// reproduces a word without meaning it"; and testing PARTIAL first, because a
// partial marker contains a closed one. The two gates then reported 67 and 59
// closed rows over the same document, and the row being written at the time
// classified itself closed off a marker it had QUOTED while explaining the
// classifier. Reusing the sibling's own functions is the fix; reimplementing
// its logic is what created a second source of truth in the first place.
//
// The marker LIST was the same mistake one level down. This file first carried
// its own hand-written copy, and it was wrong in both directions: it invented
// MITIGATED and CLOSED, which the sibling does not treat as closures, and it
// omitted DISPOSITION OF ROW and NOT DOING, which the sibling does. Five rows
// classified differently in the two gates as a direct result. The list is now
// imported, so it cannot be wrong here without being wrong there.
export { CLOSED_MARKERS };

/** Partial counts as OPEN here, exactly as it does in the sibling gate. */
export function isClosed(text) {
  const status = statusText(text);
  if (PARTIAL_MARKERS.some((m) => marks(status, m))) return false;
  return CLOSED_MARKERS.some((m) => marks(status, m));
}

/**
 * Anything a reader could actually go and run or open. Ordered loosest-last so
 * the reported reason names the strongest form present.
 */
const EVIDENCE = [
  ["a pull request", /(?:PR|pull request)\s*#\d{2,4}\b|#\d{2,4}\b/],
  ["a commit", /\b[0-9a-f]{7,40}\b/],
  ["a runnable command", /(?:pnpm run |npm run |node scripts\/|\.\/[a-z][\w.-]*\.sh)/],
  ["a file path", /\b(?:docs|scripts|lib|artifacts|native|fleet)\/[A-Za-z0-9_.-]+\/?[A-Za-z0-9_.\/-]*\.[a-z]{2,5}\b/],
];

export function evidenceFor(text) {
  for (const [label, re] of EVIDENCE) if (re.test(text)) return label;
  return null;
}

export function audit(planText) {
  const rows = parseRows(planText);
  // `parseRows` scopes to the "## Global backlog" section and returns [] when it
  // is absent. A caller that only asserts "nothing bad was found" would then
  // pass on an empty parse — which is how the first version of this file's own
  // self-test passed one assertion vacuously. Report the count so a zero can be
  // refused rather than mistaken for a clean result.
  const closed = rows.filter((r) => isClosed(r.text));
  const bare = closed.filter((r) => evidenceFor(r.text) === null).map((r) => r.id);
  return { total: rows.length, closed: closed.length, bare };
}

/** A RISE is fatal. Mirror-image of the role-coverage ratchet on purpose. */
export function overCeiling(ceiling, now) {
  if (typeof ceiling !== "number") return null; // no baseline yet — record, don't fail
  return now > ceiling ? { ceiling, now, added: now - ceiling } : null;
}

function selfTest() {
  const checks = [];
  // Every fixture carries the section heading `parseRows` scopes to. Without
  // it the parse returns [] and an assertion of the form "nothing bad found"
  // passes while measuring nothing.
  const row = (n, body) => `## Global backlog\n\n${n}. **A title** — ${body}\n`;

  // The positive control for every "not found" assertion below: prove the
  // fixture parses at all before trusting an empty result from it.
  checks.push(["a fixture with no section heading parses to NOTHING", audit("1. **T** — FIXED.").total === 0]);

  let a = audit(row(1, "FIXED in PR #309.") + "2. **A title** — OPEN, nobody owns it.\n");
  checks.push(["the fixture actually parses", a.total === 2]);
  checks.push(["a closed row naming a PR is not bare", a.bare.length === 0 && a.closed === 1]);

  a = audit(row(1, "FIXED. Trust me."));
  checks.push(["a closed row with NO evidence is bare", a.bare.length === 1]);

  a = audit(row(1, "OPEN. Trust me."));
  checks.push(["an OPEN row with no evidence is NOT counted — this gate is about closures", a.total === 1 && a.bare.length === 0 && a.closed === 0]);

  // Each evidence form gets its own assertion. A single "some form matched"
  // check would pass while three of the four regexes were broken.
  for (const [label, body] of [
    ["a commit", "FIXED by 9143d73."],
    ["a runnable command", "FIXED — verify with `pnpm run proof:signalgrid-simulator`."],
    ["a file path", "FIXED in `lib/signalgrid-core/src/evidence.ts`."],
  ]) {
    const r = audit(row(1, body));
    checks.push([`${label} counts as evidence`, r.total === 1 && r.closed === 1 && r.bare.length === 0]);
  }

  // Negation must survive the round trip: the ownership gate treats NOT DONE as
  // open, and if that ever stopped holding this gate would start demanding
  // evidence from rows that are openly unfinished.
  const notDone = audit(row(1, "NOT DONE, still open."));
  checks.push(["a NOT DONE row is not treated as closed", notDone.total === 1 && notDone.closed === 0]);

  // THE ASSERTION THAT WOULD HAVE CAUGHT THE DIVERGENCE. Both gates classify the
  // REAL document; every row must land in the same bucket in both. Pinning the
  // agreement is the only reason the shared imports above stay shared — a future
  // edit that re-forks either list fails here instead of being noticed by hand,
  // which is how it was noticed this time.
  {
    const planText = readFileSync(join(repo, PLAN), "utf8");
    const theirs = auditBacklogOwnership(planText, rosterIds(repo)).closed;
    const ours = parseRows(planText).filter((r) => isClosed(r.text)).map((r) => r.id);
    const only = [...theirs.filter((x) => !ours.includes(x)), ...ours.filter((x) => !theirs.includes(x))];
    checks.push([`both gates bucket every real row identically (${theirs.length} closed)`, theirs.length > 0 && only.length === 0]);
  }

  checks.push(["a RISE over the ceiling is fatal", overCeiling(50, 51)?.added === 1]);
  checks.push(["a DROP below the ceiling is fine", overCeiling(50, 49) === null]);
  checks.push(["an unchanged count is fine", overCeiling(50, 50) === null]);
  checks.push(["no baseline yet is not a failure", overCeiling(undefined, 99) === null]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const { total, closed, bare } = audit(readFileSync(join(repo, PLAN), "utf8"));

// Fail-closed on a vacuous parse. If the section heading is ever renamed, every
// count below goes to zero and this gate would otherwise report a clean ledger
// at the exact moment it stopped reading one.
if (total === 0) {
  console.error(`✗ ${PLAN} parsed to ZERO backlog rows — the "## Global backlog" section is missing or renamed.`);
  console.error("  Refusing to report a clean ledger from a parse that read nothing.");
  process.exit(1);
}
const ratchetPath = join(repo, RATCHET);
const prior = existsSync(ratchetPath) ? JSON.parse(readFileSync(ratchetPath, "utf8")) : {};
const breach = overCeiling(prior.closedRowsWithoutEvidence, bare.length);

console.log(`Backlog evidence — ${closed} closed row(s) of ${total}; ${bare.length} cite nothing checkable.`);

if (breach) {
  console.error(`\n✗ ${breach.added} new closed row(s) with no evidence (ceiling ${breach.ceiling}, now ${breach.now}).`);
  console.error("  A row that says the work is done must say how a stranger would check.");
  console.error("  Name the PR, the commit, the command that proves it, or the file it landed in.");
  console.error(`  Bare rows: ${bare.join(", ")}`);
  process.exit(1);
}

if (prior.closedRowsWithoutEvidence === undefined || bare.length < prior.closedRowsWithoutEvidence) {
  writeFileSync(
    ratchetPath,
    JSON.stringify({
      note: "DEBT CEILING, not a high-water mark: closed backlog rows citing nothing checkable. A RISE is fatal; a drop is recorded here automatically. Never hand-edit; the gate writes it.",
      closedRowsWithoutEvidence: bare.length,
      rows: bare,
    }, null, 2) + "\n",
  );
  const was = prior.closedRowsWithoutEvidence;
  console.log(was === undefined ? `  baseline recorded at ${bare.length}` : `  ceiling lowered ${was} → ${bare.length}`);
}

console.log("\nBacklog evidence gate passed.");
console.log("It does NOT check that a row's status is TRUE — only that a closed row is checkable at all.");
