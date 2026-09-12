// check-backlog-ownership.mjs — a backlog row nobody owns is a wish.
//
//   node scripts/check-backlog-ownership.mjs              # report + gate
//   node scripts/check-backlog-ownership.mjs --self-test  # prove the gate can fail
//
// WHY THIS EXISTS. `check-org-roster.mjs` answers "does every role have a job".
// This answers the other direction: "does every open job have a role". The two
// together are what makes an org chart mean anything — without this one, a
// roster can be fully staffed while the actual work sits in prose owned by
// nobody, which is the state this file was written in.
//
// SECOND SURFACE, ADDED 2026-09-12: `docs/BUILD_BACKLOG.md` is a second place
// open work accumulates, in a different row shape — a GitHub-style checkbox
// (`- [ ] **Title.** body...`) rather than a numbered heading, and no free-prose
// completion vocabulary at all: the checkbox itself is the status. `- [x]` rows
// are done and skipped; every `- [ ] **` row is open and must name a role, full
// stop — there is no PARTIAL bucket here, because this file has no "HALF DONE"
// convention to detect. Same fail-closed shape as the PLAN scan below, same
// output shape, same roster: a bare `git grep` audit on 2026-09-12 found the org
// self-evaluation's own new rows — six DR-042 cascade joins, five DR-043 puck
// items, the api-zod design targets, the full-evaluation completion list — all
// carrying prose like "Cloud lane." or "Native lane." that names no ID this
// registry actually has, which is exactly the false-affirmative shape rule 2
// warns about: it READS as ownership and resolves to nobody.
//
// Completion is recorded in this document as free prose — DONE, FIXED,
// DECIDED, and a "HALF DONE" that contains the word DONE — so classification
// here reads a CLOSED SET of markers, tested partial-first, and matched
// CASE-SENSITIVELY in upper case. Lower-case "the gate was fixed" in a row's
// prose therefore does not close it. That direction matters more than the
// other: a false OPEN costs an unnecessary owner, a false CLOSED HIDES WORK.
//
// THE FIRST VERSION OF THIS FILE FAILED OPEN IN EXACTLY THAT DIRECTION, and an
// audit of the commit that introduced it found the hole within the hour. The
// markers were matched with plain String.includes, so a row reading
//
//     1. **A thing** — still NOT DONE, nobody owns it.
//
// contained "DONE", classified CLOSED, needed no owner, and the gate printed
// `passed` with zero problems. So did "UNDECIDED" (containing "DECIDED"). A
// guard whose own header names a dangerous direction and then fails in it is
// worse than no guard, because it is trusted. Two changes fixed it, both
// self-tested below:
//
//   1. A marker only counts when it stands alone as an upper-case TOKEN —
//      word-boundary matched, never as a substring. That alone kills UNDECIDED.
//   2. A marker under a NEGATION does not close a row. "NOT DONE", "NOT YET
//      DONE" and "NEVER FIXED" are open rows saying so out loud, and reading
//      them as closed is the worst thing this file could do.
//
// REJECTED was also REMOVED from the closed set. "approach A was REJECTED" is a
// sentence about one option, not a disposition of the row, and no row in the
// document closed on it alone — 51a, the only row containing it, also carries
// "DISPOSITION OF ROW". A marker that cannot distinguish rejecting an OPTION
// from rejecting the WORK does not belong in a vocabulary whose false direction
// hides work.
//
// A REJECTED EXPERIMENT, recorded because the next person will try it. This
// gate first also FAILED any status-shaped word outside that set — the idea
// being that an unclassifiable status makes every count unreliable. Run against
// the real document it produced sixteen findings of which the majority were
// prose, not status: row 40c's "fails CLOSED" is the product's own fail-closed
// vocabulary, and row 41's "a DEFERRED entry" describes a connector family. A
// rule that fights the domain's own words every time they are written is a rule
// that gets switched off, and this repository already says as much about flaky
// gates. It was cut. Ownership is the property worth gating; status wording is
// not.
//
// The split, same as every sibling gate:
//   FATAL     — an OPEN or PARTIAL row naming no role from the registry, or
//               zero rows parsed.
//   REPORTED  — the open / partial / closed counts. That is where the company
//               is, not a defect.
//
// PARTIAL COUNTS AS OPEN, deliberately. "HALF DONE" is a row with work left in
// it, and work left in it needs somebody to do it.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN = "docs/COMPANY_BUILD_PLAN.md";
const BACKLOG = "docs/BUILD_BACKLOG.md";
const ROSTER = "docs/agent/org-roster.json";

// Order matters: PARTIAL is tested first, because "HALF DONE" contains "DONE".
export const PARTIAL_MARKERS = ["HALF DONE", "ONE THIRD DONE", "TWO THIRDS DONE", "PARTIALLY DONE", "PARTIALLY ANSWERED", "MOSTLY DONE"];
const PARTIAL = PARTIAL_MARKERS;
export const CLOSED_MARKERS = ["DONE", "FIXED", "DECIDED", "SUPERSEDED", "WITHDRAWN", "DISPOSITION OF ROW", "NOT DOING"];
const CLOSED = CLOSED_MARKERS;

// A negation immediately before a marker cancels it. The window is deliberately
// short: this looks at the text right before the marker, not the whole sentence,
// because a negation three clauses away is describing something else.
const NEGATED = /(?:^|[\s(,;])(?:NOT|NEVER|NO)(?:\s+[A-Za-z]+)?\s*$/;
const NEGATION_WINDOW = 28;

/**
 * A marker being QUOTED is being discussed, not asserted.
 *
 * Found by running this gate against the row that documents this gate. Row 55
 * quotes `"still NOT DONE, nobody owns it"` and `"DECIDED"` as examples of the
 * substring bug being fixed — and the gate read its own examples as its own
 * status and classified the row CLOSED. The negation guard did fire on the
 * first occurrence and was then defeated by the second, unnegated one, because
 * a quotation reproduces a word without meaning it.
 *
 * So status is read from the row with quoted spans and code spans removed.
 * Straight quotes, curly quotes, and backticks all count: every one of them is
 * this document's way of saying "I am naming this string, not claiming it".
 *
 * Deliberately NOT applied to the OWNER search. A role id inside a quotation is
 * weaker evidence of ownership, but treating it as ownership fails toward
 * requiring an owner that is already named, and failing toward more ownership
 * is the safe direction. Status is the one that hides work when it is wrong.
 */
export function statusText(text) {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\u201c[^\u201d]*\u201d/g, " ");
}

/**
 * Does `marker` actually mark this row's status?
 * Whole upper-case token only, and not under a negation. Substring matching is
 * what made this gate fail open; it is not coming back.
 */
export function marks(text, marker) {
  const esc = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
  const re = new RegExp(`(?<![\\w-])${esc}(?![\\w-])`, "g");
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, m.index - NEGATION_WINDOW), m.index);
    if (NEGATED.test(before)) continue;
    return true;
  }
  return false;
}

// ROW IDS. This document numbers sub-rows by suffixing a letter AND sometimes a
// hyphenated ordinal: 40b, 40c, and `40c-2`. The first version of this regex was
// /^(\d+[a-z]*)\./, which cannot match `40c-2.` — and a heading that does not
// match is not skipped, it is APPENDED to the row above as continuation text.
//
// That is the fourth fail-open found in this file, and the worst of the four.
// The first three misclassified a row's STATUS; this one made a row INVISIBLE.
// Row 40c-2 exists in docs/COMPANY_BUILD_PLAN.md today: a generous scan finds 67
// headings in the backlog section and parseRows returned 66, with the whole of
// 40c-2 — its heading text included — living inside row 40c's 10,097-character
// body. An invisible row is never counted, never bucketed, and can never trigger
// the FATAL "names no role" check no matter what it says. Silent, not loud.
//
// Two changes, because widening the pattern alone would only postpone this:
//   1. ROW_HEAD accepts the real id grammar, digits then letters and hyphenated
//      ordinals.
//   2. ROW_HEAD_LOOSE catches anything SHAPED like a row start that ROW_HEAD
//      still rejects, and the caller FAILS on it. The next id-grammar drift
//      breaks the build instead of quietly shrinking the subject.
//
// No self-test caught this because every fixture used a bare `1.` id, so nothing
// exercised id parsing at all. Fixtures below now include a hyphenated id.
const ROW_HEAD = /^(\d+[a-z]*(?:-\d+)?)\.\s+\*\*/;
const ROW_HEAD_LOOSE = /^\d[\w-]*\.\s+\*\*/;

/** Split the global-backlog section into rows: a numbered heading plus its continuation lines. */
export function parseRows(planText) {
  const start = planText.indexOf("## Global backlog");
  if (start < 0) return [];
  const rest = planText.slice(start);
  const end = rest.search(/\n## (?!Global)/);
  const lines = (end < 0 ? rest : rest.slice(0, end)).split("\n");
  const rows = [];
  const unparsed = [];
  let cur = null;
  for (const line of lines) {
    const head = ROW_HEAD.exec(line);
    if (head) {
      if (cur) rows.push(cur);
      cur = { id: head[1], text: line };
      continue;
    }
    // A line that LOOKS like a row start but does not parse is the dangerous
    // case — see ROW_HEAD. Record it so a caller can fail loudly instead of
    // silently swallowing it into the row above.
    if (ROW_HEAD_LOOSE.test(line)) unparsed.push(line.slice(0, 60));
    if (cur) cur.text += "\n" + line;
  }
  if (cur) rows.push(cur);
  rows.unparsed = unparsed;
  return rows;
}

const names = (id) => new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);

/** Pure audit so the verdict is testable without a filesystem. */
export function auditBacklogOwnership(planText, roleIds) {
  const problems = [];
  const rows = parseRows(planText);
  const open = [], partial = [], closed = [];

  for (const line of rows.unparsed ?? []) {
    problems.push(`${PLAN}: a line begins like a backlog row but does not parse as one — \`${line}\` — so it would be swallowed into the row above and never gated`);
  }
  if (rows.length === 0) {
    // Without this the gate passes by finding nothing to check — the vacuous
    // PASS this repo has already shipped once, in a proof harness.
    problems.push(`${PLAN}: parsed ZERO backlog rows — the section moved or its shape changed, and a gate with no subject is not a gate`);
    return { problems, open, partial, closed };
  }

  for (const row of rows) {
    const status = statusText(row.text);
    const bucket = PARTIAL.some((m) => marks(status, m)) ? partial
      : CLOSED.some((m) => marks(status, m)) ? closed
      : open;
    bucket.push(row.id);
    if (bucket === closed) continue;

    const owners = roleIds.filter((id) => names(id).test(row.text));
    if (owners.length === 0) {
      problems.push(`${PLAN}: row ${row.id} has work left and names no role from ${ROSTER} — a backlog row nobody owns is a wish`);
    }
  }
  return { problems, open, partial, closed };
}

export function rosterIds(root) {
  const p = join(root, ROSTER);
  if (!existsSync(p)) return [];
  const r = JSON.parse(readFileSync(p, "utf8"));
  return Array.isArray(r?.roles) ? r.roles.map((x) => x?.id).filter((x) => typeof x === "string") : [];
}

// --- The second surface: docs/BUILD_BACKLOG.md ---------------------------
//
// This file has no free-prose status vocabulary — the checkbox IS the status.
// `- [ ] **Title.** body...` is open; `- [x] ...` is done and is SKIPPED
// entirely, exactly as the task that added this scan specifies. There is no
// PARTIAL bucket here: a document with no "HALF DONE" convention has nothing
// for that bucket to detect, and inventing one would be gating a vocabulary
// this file does not use.
//
// Row shape is a GitHub checkbox heading, not a numbered heading, so rows are
// split the same defensive way as parseRows above (a heading, plus every
// following line that is blank or INDENTED) with one addition: a non-blank
// line that starts at COLUMN ZERO and is not itself a new row or a markdown
// heading is a separate paragraph (the free-floating notes this document
// carries between bulleted items) and must not be swallowed into the row
// above — the same swallowing bug ROW_HEAD_LOOSE exists to catch for the
// PLAN, found here by hand while building this scan: the naive "anything not
// a new row" rule glued an italic footer paragraph onto the row before it.
const BACKLOG_OPEN_HEAD = /^- \[ \] \*\*/;
const BACKLOG_CLOSED_HEAD = /^- \[x\] /;

/** Split docs/BUILD_BACKLOG.md into `{ line, status, text }` rows. */
export function parseBacklogRows(mdText) {
  const lines = mdText.split("\n");
  const rows = [];
  let cur = null;
  const closeCur = () => {
    if (cur) rows.push(cur);
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BACKLOG_OPEN_HEAD.test(line)) {
      closeCur();
      cur = { line: i + 1, status: "open", text: line };
      continue;
    }
    if (BACKLOG_CLOSED_HEAD.test(line)) {
      closeCur();
      cur = { line: i + 1, status: "closed", text: line };
      continue;
    }
    if (/^#/.test(line)) {
      closeCur();
      continue;
    }
    if (!cur) continue;
    if (line.trim() === "") continue; // blank: neither extends nor closes on its own
    if (/^\s/.test(line)) {
      cur.text += "\n" + line;
      continue;
    }
    // Non-blank, column zero, not a row head, not a heading: a different
    // paragraph. The row ends here, without consuming it.
    closeCur();
  }
  closeCur();
  return rows;
}

/** Pure audit of docs/BUILD_BACKLOG.md, same shape as auditBacklogOwnership above. */
export function auditBacklogFileOwnership(mdText, roleIds) {
  const problems = [];
  const rows = parseBacklogRows(mdText);
  const open = [];
  const closed = [];

  if (rows.length === 0) {
    problems.push(`${BACKLOG}: parsed ZERO \`- [ ] **\` / \`- [x]\` rows — the file moved or its shape changed, and a gate with no subject is not a gate`);
    return { problems, open, closed };
  }

  for (const row of rows) {
    if (row.status === "closed") {
      closed.push(row.line);
      continue;
    }
    open.push(row.line);
    const owners = roleIds.filter((id) => names(id).test(row.text));
    if (owners.length === 0) {
      problems.push(`${BACKLOG}: the open row at line ${row.line} has work left and names no role from ${ROSTER} — a backlog row nobody owns is a wish`);
    }
  }
  return { problems, open, closed };
}

function selfTest() {
  const checks = [];
  const IDS = ["web-engineer", "sre", "mobile-native-engineer"];
  const plan = (...rows) => `## Global backlog\n\n${rows.join("\n")}\n\n## After\n`;

  let a = auditBacklogOwnership(plan("1. **A thing** — web-engineer, hours."), IDS);
  checks.push(["an open row naming a role is clean and counted OPEN", a.problems.length === 0 && a.open.length === 1]);

  a = auditBacklogOwnership(plan("1. **A thing** — hours, somebody."), IDS);
  checks.push(["an open row owned by NOBODY is FATAL", a.problems.some((p) => p.includes("nobody owns"))]);

  a = auditBacklogOwnership(plan("1. **A thing** — DONE 2026-01-01."), IDS);
  checks.push(["a CLOSED row needs no owner — it has a completion record instead", a.problems.length === 0 && a.closed.length === 1]);

  a = auditBacklogOwnership(plan("1. **A thing** — HALF DONE, nobody."), IDS);
  checks.push(["HALF DONE counts as work left, so it still needs an owner", a.problems.some((p) => p.includes("nobody owns")) && a.partial.length === 1]);

  a = auditBacklogOwnership(plan("1. **A thing** — HALF DONE, sre."), IDS);
  checks.push(["HALF DONE with an owner is clean — the check is not simply refusing every partial", a.problems.length === 0]);

  a = auditBacklogOwnership(plan("1. **A thing** — the connector fails CLOSED on unknown. sre."), IDS);
  checks.push(["the product's own fail-CLOSED vocabulary in an owned row is clean — the cut rule stays cut", a.problems.length === 0 && a.open.length === 1]);

  a = auditBacklogOwnership(plan("1. **A thing** — the gate was fixed last week, nobody."), IDS);
  checks.push(["lower-case \"fixed\" in prose does NOT close a row — a false close hides work", a.problems.some((p) => p.includes("nobody owns"))]);

  // The three negative controls the FIRST version of this gate failed. Each one
  // is a row announcing out loud that it is not finished, and each one used to
  // classify CLOSED and pass with zero problems.
  a = auditBacklogOwnership(plan("1. **A thing** — still NOT DONE, nobody owns it."), IDS);
  checks.push(["\"NOT DONE\" does not close a row — substring matching failed open here", a.problems.some((p) => p.includes("nobody owns")) && a.closed.length === 0]);

  a = auditBacklogOwnership(plan("1. **A thing** — NOT YET DONE, nobody owns it."), IDS);
  checks.push(["\"NOT YET DONE\" does not close a row — the negation may be one word away", a.problems.some((p) => p.includes("nobody owns"))]);

  a = auditBacklogOwnership(plan("1. **A thing** — UNDECIDED, nobody owns it."), IDS);
  checks.push(["\"UNDECIDED\" does not close a row — DECIDED is not a substring match", a.problems.some((p) => p.includes("nobody owns")) && a.closed.length === 0]);

  a = auditBacklogOwnership(plan("1. **A thing** — approach A was REJECTED; the work continues, nobody."), IDS);
  checks.push(["rejecting one OPTION does not dispose of the row", a.problems.some((p) => p.includes("nobody owns"))]);

  // ...and the positive controls, so the hardening did not simply refuse everything.
  a = auditBacklogOwnership(plan("1. **A thing** — DONE 2026-01-01."), IDS);
  checks.push(["a plain DONE still closes a row — the negation guard is not over-firing", a.problems.length === 0 && a.closed.length === 1]);

  a = auditBacklogOwnership(plan("1. **A thing** — DONE; the vendor sends NO webhook for this."), IDS);
  checks.push(["a negation LATER in the row does not reopen a closed one", a.closed.length === 1]);

  a = auditBacklogOwnership(plan("1. **A thing** — DISPOSITION OF ROW 9: NOT DOING it."), IDS);
  checks.push(["a multi-word marker still matches across whitespace", a.closed.length === 1]);

  // The residual the gate found in its OWN backlog row: a row that quotes status
  // vocabulary while discussing it was classified by the quotation.
  a = auditBacklogOwnership(plan("1. **A thing** — a row reading \"still NOT DONE\" contained \"DONE\" and closed. Fix pending, nobody."), IDS);
  checks.push(["a marker inside QUOTES is being discussed, not asserted", a.problems.some((p) => p.includes("nobody owns")) && a.closed.length === 0]);

  a = auditBacklogOwnership(plan("1. **A thing** — the `DONE` marker needs review. nobody."), IDS);
  checks.push(["a marker inside a CODE SPAN does not close a row either", a.problems.some((p) => p.includes("nobody owns"))]);

  a = auditBacklogOwnership(plan("1. **A thing** — DONE. It replaced the \"HALF DONE\" wording."), IDS);
  checks.push(["an UNQUOTED marker still closes, with a quoted one beside it", a.closed.length === 1 && a.problems.length === 0]);

  // The fourth fail-open: a hyphenated sub-row id. This document already uses
  // `40c-2`, and the original regex made the whole row invisible.
  a = auditBacklogOwnership(plan("40c. **First.** DONE.", "40c-2. **Second, open and unowned.** nobody has this."), IDS);
  checks.push(["a hyphenated sub-row id opens its OWN row, not continuation text", a.open.length === 1 && a.closed.length === 1]);
  checks.push(["and that sub-row is then owner-checked like any other", a.problems.some((p) => p.includes("nobody owns"))]);

  a = auditBacklogOwnership(plan("40c. **First.** DONE.", "40c_2. **Shape drift.** nobody."), IDS);
  checks.push(["a row-SHAPED line that still does not parse FAILS loudly rather than being swallowed", a.problems.some((p) => p.includes("does not parse as one"))]);

  // Falsification of the fix against the real document: parseRows must now see
  // every heading a generous scan finds, or the subject is still shrinking.
  const planText = readFileSync(join(repo, PLAN), "utf8");
  const start = planText.indexOf("## Global backlog");
  const rest = planText.slice(start);
  const end = rest.search(/\n## (?!Global)/);
  const section = end < 0 ? rest : rest.slice(0, end);
  const generous = section.split("\n").filter((l) => /^\d[\w-]*\.\s+\*\*/.test(l)).length;
  const parsed = parseRows(planText).length;
  checks.push([`LIVE: parseRows sees every heading in the real document (${parsed} of ${generous})`, parsed === generous && generous > 0]);

  a = auditBacklogOwnership(plan("1. **A thing** — mobile-native, days."), IDS);
  checks.push(["an ABBREVIATED role name does not count as an owner — it resolves to no registry entry", a.problems.some((p) => p.includes("nobody owns"))]);

  a = auditBacklogOwnership("# no backlog section here", IDS);
  checks.push(["a plan with no parsable rows is FATAL, not a vacuous pass", a.problems.some((p) => p.includes("ZERO backlog rows"))]);

  a = auditBacklogOwnership(plan("1. **A** — sre.", "2. **B** — DONE.", "3. **C** — HALF DONE, sre."), IDS);
  checks.push(["rows are bucketed, so the split can be reported", a.open.length === 1 && a.closed.length === 1 && a.partial.length === 1]);

  const live = rosterIds(repo);
  checks.push(["role ids are READ from the registry, not listed in this file", live.length > 0 && live.includes("sre")]);

  // --- docs/BUILD_BACKLOG.md scan: the three controls the task specifies ---
  const backlog = (...rows) => `# SignalGrid build backlog\n\n## Now\n\n${rows.join("\n")}\n\n## Next\n`;

  a = auditBacklogFileOwnership(backlog("- [ ] **A planted lane-less row.** Nobody named here."), IDS);
  checks.push(["BUILD_BACKLOG: a planted lane-less row is flagged", a.problems.some((p) => p.includes("nobody owns")) && a.open.length === 1]);

  a = auditBacklogFileOwnership(backlog("- [ ] **A stamped row.** Owned. Lane: sre."), IDS);
  checks.push(["BUILD_BACKLOG: a stamped row (a real role id present) passes", a.problems.length === 0 && a.open.length === 1]);

  a = auditBacklogFileOwnership(backlog("- [x] **A done row, unstamped.** Nobody named, and none needed."), IDS);
  checks.push(["BUILD_BACKLOG: a `- [x]` row is skipped, not flagged", a.problems.length === 0 && a.closed.length === 1 && a.open.length === 0]);

  // Positive/negative controls beyond the three named, mirroring the PLAN's own hardening.
  a = auditBacklogFileOwnership(backlog(
    "- [ ] **First row.** No role.",
    "- [x] **Second row, closed.** No role needed.",
    "- [ ] **Third row.** Owned by sre."
  ), IDS);
  checks.push(["BUILD_BACKLOG: rows are bucketed independently of the PLAN's buckets", a.open.length === 2 && a.closed.length === 1]);
  checks.push(["BUILD_BACKLOG: only the truly lane-less open row is a problem", a.problems.length === 1]);

  a = auditBacklogFileOwnership(backlog(
    "- [ ] Not bold at all — the gate's row shape requires `**`, so this line is invisible to it.",
    "- [ ] **A real row beside it.** sre."
  ), IDS);
  checks.push(["BUILD_BACKLOG: a checkbox row with no bold heading is not this gate's row shape and is simply not seen", a.open.length === 1 && a.problems.length === 0]);

  a = auditBacklogFileOwnership(backlog(
    "- [ ] **A row with a free-floating paragraph after it, not swallowed.**",
    "      Body text, indented, still part of the row. No role here.",
    "",
    "_A free paragraph at column zero, between bullets — must not absorb the",
    "role search into unrelated prose, and must not itself need an owner._",
    "",
    "- [ ] **A second real row.** sre."
  ), IDS);
  checks.push(["BUILD_BACKLOG: a column-zero paragraph between rows is not swallowed into the row above", a.open.length === 2]);
  checks.push(["BUILD_BACKLOG: the swallow bug (found while building this scan) stays fixed — the unowned first row still fails on its own, not masked by the second row's owner", a.problems.length === 1]);

  a = auditBacklogFileOwnership("# no checkbox rows in this file", IDS);
  checks.push(["BUILD_BACKLOG: a file with no parsable rows is FATAL, not a vacuous pass", a.problems.some((p) => p.includes("ZERO"))]);

  const liveBacklogText = readFileSync(join(repo, BACKLOG), "utf8");
  const liveBacklog = auditBacklogFileOwnership(liveBacklogText, live);
  checks.push([`LIVE: ${BACKLOG} parses at least one row (${liveBacklog.open.length} open, ${liveBacklog.closed.length} closed)`, liveBacklog.open.length + liveBacklog.closed.length > 0]);
  checks.push([`LIVE: every open row in ${BACKLOG} names a registered role (${liveBacklog.problems.length} unowned)`, liveBacklog.problems.length === 0]);

  const failed = checks.filter(([, k]) => !k);
  for (const [name, k] of checks) console.log(`  ${k ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

const runAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runAsCli && process.argv.includes("--self-test")) process.exit(selfTest());
if (runAsCli) runGate();

function runGate() {
  const planPath = join(repo, PLAN);
  const backlogPath = join(repo, BACKLOG);
  if (!existsSync(planPath)) {
    console.error(`Backlog ownership check FAILED: ${PLAN} does not exist.`);
    process.exit(1);
  }
  if (!existsSync(backlogPath)) {
    console.error(`Backlog ownership check FAILED: ${BACKLOG} does not exist.`);
    process.exit(1);
  }
  const ids = rosterIds(repo);
  if (ids.length === 0) {
    console.error(`Backlog ownership check FAILED: read no role ids from ${ROSTER} — refusing to check ownership against an empty roster.`);
    process.exit(1);
  }
  const plan = auditBacklogOwnership(readFileSync(planPath, "utf8"), ids);
  const backlog = auditBacklogFileOwnership(readFileSync(backlogPath, "utf8"), ids);
  const problems = [...plan.problems, ...backlog.problems];

  const planTotal = plan.open.length + plan.partial.length + plan.closed.length;
  console.log(`Backlog ownership — ${PLAN}: ${planTotal} row(s): ${plan.open.length} open, ${plan.partial.length} partially done, ${plan.closed.length} closed`);
  if (plan.open.length + plan.partial.length > 0) {
    console.log(`\n  STILL CARRYING WORK (${plan.open.length + plan.partial.length} of ${planTotal}) — every one names the role that owns it:`);
    console.log(`    ${[...plan.open, ...plan.partial].join(", ")}`);
  }

  const backlogTotal = backlog.open.length + backlog.closed.length;
  console.log(`\nBacklog ownership — ${BACKLOG}: ${backlogTotal} row(s): ${backlog.open.length} open, ${backlog.closed.length} closed`);
  if (backlog.open.length > 0) {
    console.log(`\n  STILL CARRYING WORK (${backlog.open.length} of ${backlogTotal}) — every one names the role that owns it:`);
    console.log(`    line ${backlog.open.join(", line ")}`);
  }

  if (problems.length > 0) {
    console.error(`\nBacklog ownership check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("\nBacklog ownership check passed — every row with work left in it, in both documents, names a role from the registry.");
}
