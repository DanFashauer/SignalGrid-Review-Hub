// Discovery-log hardware-tally gate — Puck 5 (DR-043 rule 4).
//
//   node scripts/check-discovery-log.mjs              # gate
//   node scripts/check-discovery-log.mjs --self-test  # prove the gate can fail
//
// WHY THIS EXISTS. DR-043 rule 4 re-applies the pre-registered discovery
// thresholds (docs/agent/DISCOVERY_LOG.md:121-124) to hardware: >= 4 of 15
// REQUIREMENT mentions that map specifically to faster or stronger physical
// session authentication or custody binding authorizes a bench prototype;
// >= 3 concrete COMMITMENTs to that workflow authorizes a design-partner MVP;
// >= 5 PROBLEM with that COMMITMENT count still at 0 is a no-go. Before this
// gate, nothing in the tree could answer "does a hardware authorization cite a
// tally row that exists" except a human rereading the whole log by eye — the
// same failure mode `check-derived-doc-figures.mjs` exists to close for every
// other counted claim in this repository (CLAUDE.md: numbers come from output,
// never memory).
//
// THE MARKER. The Running tally table in docs/agent/DISCOVERY_LOG.md gains
// three columns, Rh / Ch / Ph, beside R / C / P (BUILD_BACKLOG.md, "Puck 5").
// A row marks Rh/Ch/Ph with a non-empty cell (conventionally `X`) ONLY when
// the matching base column (R/C/P) is ALSO marked on that row: a hardware
// signal is a hardware-specific READING of a REQUIREMENT/COMMITMENT/PROBLEM
// that conversation already carried, never a fourth kind of evidence with no
// base classification to hang off. That invariant is enforced below, not
// assumed.
//
// DERIVED, NEVER TYPED. This gate recomputes Rh/Ch/Ph from the table on every
// run and compares the result against the one sentence in the document that
// states them ("**Hardware (DR-043) -- Rh: N of 15 ...**"). A mismatch fails
// closed: either somebody hand-edited the sentence, or added/removed a mark
// without updating it, and in both cases the sentence is a number from memory,
// which is exactly what this gate exists to catch.
//
// WHAT THIS GATE DOES NOT DO. It does not judge whether a mark is honestly
// placed -- that a REQUIREMENT really maps to physical session hardware is a
// human editorial call the log's own header already governs ("log the same
// day, in their words"). It only proves that once a mark exists, the sentence
// that claims a count agrees with it. Today's honest state is zero marks
// (`docs/agent/EVIDENCE.md`, this entry's date) -- nobody has retroactively
// tagged a row, and this gate would refuse a typed number that claimed
// otherwise without a mark to back it.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DOC = "docs/agent/DISCOVERY_LOG.md";
export const SAMPLE = 15;

/** Strip markdown emphasis and whitespace so `**C**`, ` Rh `, etc. compare as bare names. */
const bare = (s) => s.replace(/\*+/g, "").trim();

/**
 * Pure: parse ONE markdown table (the "Running tally" table) out of `text`,
 * starting at the first header row under `## Running tally` and ending at the
 * first blank line that follows the last `| ... |` row. Returns the header
 * cell names and the data rows (each a bare-name -> cell-text map).
 *
 * Throws a Broken-shaped Error (never returns a shape that reads as zero rows
 * by accident) if the section or a table cannot be found -- a missing table is
 * a broken derivation, not an empty log.
 */
export function parseRunningTally(text) {
  const marker = "## Running tally";
  const start = text.indexOf(marker);
  if (start < 0) throw new Error(`${DOC}: no "## Running tally" section -- the anchor this gate parses from is gone`);
  const rest = text.slice(start);
  const tableLines = rest.split("\n").filter((l) => l.trim().startsWith("|"));
  if (tableLines.length < 2) throw new Error(`${DOC}: "## Running tally" has no markdown table under it`);
  const splitRow = (line) =>
    line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const header = splitRow(tableLines[0]).map(bare);
  // tableLines[1] is the `| --- | --- |` separator.
  const dataLines = tableLines.slice(2);
  const rows = dataLines.map((line) => {
    const cells = splitRow(line);
    const row = {};
    header.forEach((name, i) => {
      row[name] = bare(cells[i] ?? "");
    });
    return row;
  });
  return { header, rows };
}

const marked = (cell) => typeof cell === "string" && cell.length > 0;

/**
 * Pure: derive the hardware tally (Rh/Ch/Ph) from parsed table rows, plus any
 * invariant violation (a hardware mark with no base mark on the same row).
 */
export function deriveHardwareTally({ header, rows }) {
  for (const col of ["R", "C", "P", "Rh", "Ch", "Ph"]) {
    if (!header.includes(col)) throw new Error(`${DOC}: Running tally table has no "${col}" column -- expected header shape lost`);
  }
  const problems = [];
  let rh = 0;
  let ch = 0;
  let ph = 0;
  rows.forEach((row, i) => {
    const n = i + 1; // row 1 is the template row, kept 1-indexed to match the doc's own "#" column
    if (marked(row.Rh)) {
      rh += 1;
      if (!marked(row.R)) problems.push(`row ${n}: Rh is marked but R is not -- a hardware requirement mark needs the base REQUIREMENT mark too`);
    }
    if (marked(row.Ch)) {
      ch += 1;
      if (!marked(row.C)) problems.push(`row ${n}: Ch is marked but C is not -- a hardware commitment mark needs the base COMMITMENT mark too`);
    }
    if (marked(row.Ph)) {
      ph += 1;
      if (!marked(row.P)) problems.push(`row ${n}: Ph is marked but P is not -- a hardware problem mark needs the base PROBLEM mark too`);
    }
  });
  return { rh, ch, ph, problems };
}

/** The exact sentence the document must carry for a given (rh, ch, ph) -- built once, used both to check and to self-test. */
export function hardwareTallySentence(rh, ch, ph) {
  return `**Hardware (DR-043) — Rh: ${rh} of ${SAMPLE} · Ch: ${ch} of ${SAMPLE} · Ph: ${ph} of ${SAMPLE}.**`;
}

/** Pure: full audit of `text` -- derive the tally, find the typed sentence, and report any disagreement. */
export function audit(text) {
  const { header, rows } = parseRunningTally(text);
  const { rh, ch, ph, problems } = deriveHardwareTally({ header, rows });
  const expected = hardwareTallySentence(rh, ch, ph);
  const typedMatch = /\*\*Hardware \(DR-043\)[^*]*\*\*/.exec(text);
  const allProblems = [...problems];
  if (typedMatch === null) {
    allProblems.push(`${DOC}: no "Hardware (DR-043)" tally sentence found -- expected it verbatim: ${expected}`);
  } else if (typedMatch[0] !== expected) {
    allProblems.push(`${DOC}: typed "${typedMatch[0]}" does not match the derived tally -- expected: ${expected}`);
  }
  return { rh, ch, ph, expected, typed: typedMatch ? typedMatch[0] : null, problems: allProblems };
}

// ---------------------------------------------------------------------------

function row(cells) {
  // cells: {S,I,P,R,Rt,C,Rh,Ch,Ph} sparse map of marks; "#"/Date/Role are filler.
  const c = (k) => cells[k] ?? "";
  return `| ${cells["#"] ?? "1"} | | | ${c("S")} | ${c("I")} | ${c("P")} | ${c("R")} | ${c("Rt")} | ${c("C")} | ${c("Rh")} | ${c("Ch")} | ${c("Ph")} |`;
}

function buildDoc(rows, tallySentence) {
  const header = "| # | Date | Role | S | I | P | R | Rt | **C** | Rh | Ch | Ph |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const table = [header, sep, ...rows.map(row)].join("\n");
  return [
    "## Running tally",
    "",
    table,
    "",
    "*S ubstitute · I ndifference · P roblem · R equirement · R(ou)t(ing) ·",
    "**C ommitment*** · hardware marks tallied as Rh / Ch / Ph (DR-043).",
    "",
    "**Experiment started: 2026-08-27**",
    "**Conversations logged: 0 of 15 · Commitments: 0**",
    "",
    tallySentence ?? "",
    "",
    "---",
    "",
    "## The honest boundary",
    "",
  ].join("\n");
}

function selfTest() {
  const checks = [];

  // 1. Baseline: no hardware marks, typed sentence matches (0/0/0) -> PASS.
  const baseline = buildDoc([{}], hardwareTallySentence(0, 0, 0));
  const baselineResult = audit(baseline);
  checks.push(["a clean tree with zero hardware marks and a matching typed sentence passes", baselineResult.problems.length === 0]);
  checks.push(["...and derives rh=ch=ph=0", baselineResult.rh === 0 && baselineResult.ch === 0 && baselineResult.ph === 0]);

  // 2. Wrong typed tally: still zero marks, but the sentence claims Rh: 2 -> FAIL.
  const wrongTally = buildDoc([{}], hardwareTallySentence(2, 0, 0));
  const wrongResult = audit(wrongTally);
  checks.push([
    "a planted wrong hardware tally (typed Rh: 2, actually 0) FAILS",
    wrongResult.problems.length === 1 && /does not match the derived tally/.test(wrongResult.problems[0]),
  ]);

  // 3. A hardware-tagged row is added (R and Rh both marked) but the typed
  //    sentence is stale (still says 0 of 15) -> the derived count MOVES to 1,
  //    and the stale sentence FAILS.
  const hwRowStaleSentence = buildDoc([{ R: "X", Rh: "X" }], hardwareTallySentence(0, 0, 0));
  const hwRowStaleResult = audit(hwRowStaleSentence);
  checks.push(["a hardware-tagged row moves the derived Rh count from 0 to 1", hwRowStaleResult.rh === 1]);
  checks.push([
    "...and a stale typed sentence (still 0 of 15) FAILS against the moved count",
    hwRowStaleResult.problems.length === 1 && /does not match the derived tally/.test(hwRowStaleResult.problems[0]),
  ]);

  // 4. Same hardware-tagged row, sentence updated to match -> PASS.
  const hwRowFreshSentence = buildDoc([{ R: "X", Rh: "X" }], hardwareTallySentence(1, 0, 0));
  const hwRowFreshResult = audit(hwRowFreshSentence);
  checks.push(["...and updating the sentence to match (Rh: 1) passes", hwRowFreshResult.problems.length === 0]);

  // 5. Invariant: Rh marked without the base R mark -> FAILS, regardless of the
  //    typed sentence, because the mark itself is malformed.
  const invariantBroken = buildDoc([{ Rh: "X" }], hardwareTallySentence(1, 0, 0));
  const invariantResult = audit(invariantBroken);
  checks.push([
    "Rh marked without R marked FAILS the base-mark invariant",
    invariantResult.problems.some((p) => /Rh is marked but R is not/.test(p)),
  ]);

  // 6. Same invariant on Ch/Ph.
  const chBroken = buildDoc([{ Ch: "X" }], hardwareTallySentence(0, 1, 0));
  checks.push(["Ch marked without C marked FAILS the base-mark invariant", audit(chBroken).problems.some((p) => /Ch is marked but C is not/.test(p))]);
  const phBroken = buildDoc([{ Ph: "X" }], hardwareTallySentence(0, 0, 1));
  checks.push(["Ph marked without P marked FAILS the base-mark invariant", audit(phBroken).problems.some((p) => /Ph is marked but P is not/.test(p))]);

  // 7. Missing sentence entirely -> FAILS with a message quoting the expected text.
  const noSentence = buildDoc([{}], null);
  const noSentenceResult = audit(noSentence);
  checks.push(["a missing tally sentence FAILS and quotes the expected text", noSentenceResult.problems.some((p) => /no "Hardware \(DR-043\)" tally sentence found/.test(p))]);

  // 8. ...and the REAL tree, right now, is clean.
  const real = audit(readFileSync(join(repo, DOC), "utf8"));
  checks.push([`...and the real ${DOC} passes right now`, real.problems.length === 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

const result = audit(readFileSync(join(repo, DOC), "utf8"));
for (const p of result.problems) console.error(`  ✗ ${p}`);
console.log(`discovery-log hardware tally: Rh ${result.rh} of ${SAMPLE} · Ch ${result.ch} of ${SAMPLE} · Ph ${result.ph} of ${SAMPLE}, ${result.problems.length} problem(s)`);
if (result.problems.length > 0) {
  console.error("\nDiscovery-log gate FAILED — the typed hardware tally does not match what the Running tally table's marks derive.");
  process.exit(1);
}
console.log(`Discovery-log gate passed — ${DOC}'s hardware tally sentence matches the table it is derived from.`);
