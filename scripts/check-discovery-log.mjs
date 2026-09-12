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
// A row marks Rh/Ch/Ph with the ONE canonical marker, `X`, ONLY when the
// matching base column (R/C/P) is ALSO marked on that row: a hardware signal
// is a hardware-specific READING of a REQUIREMENT/COMMITMENT/PROBLEM that
// conversation already carried, never a fourth kind of evidence with no base
// classification to hang off. Both invariants are enforced below, never
// assumed: an Rh/Ch/Ph cell holding anything nonempty OTHER than `X` (a `?`,
// "pending", "no") is a FAILURE, not a silent count and not a silent skip —
// an ambiguous mark left uncounted reads as "nobody said this" when someone
// plainly wrote SOMETHING, and an ambiguous mark counted as confirmed reads
// as evidence nobody gave. (PR #690 review, finding 1: the first version
// counted any nonempty cell as a confirmed mark.)
//
// DERIVED, NEVER TYPED. This gate recomputes Rh/Ch/Ph from the table on every
// run and compares the result against the one sentence in the document that
// states them ("**Hardware (DR-043) -- Rh: N of 15 ...**"). A mismatch fails
// closed: either somebody hand-edited the sentence, or added/removed a mark
// without updating it, and in both cases the sentence is a number from memory,
// which is exactly what this gate exists to catch.
//
// THE CROSS-CHECK. Deriving the tally in DISCOVERY_LOG.md proves nothing about
// whether the AUTHORIZATION table in docs/SESSION_PUCK_HARDWARE_HYPOTHESIS.md
// still reads it: nothing stopped that page's go/no-go rows from dropping the
// Rh/Ch/Ph cell references or drifting from the registered thresholds while
// this gate stayed green, because this gate never opened that file. It now
// does (PR #690 review, finding 3): the go/no-go table must, in the SAME row,
// name each tally cell (Rh, Ch, Ph) beside the registered threshold it reads
// (>= 4 of 15, >= 3, >= 5 with COMMITMENT = 0).
//
// TABLE BOUNDARIES ARE EXACT, NOT "REST OF FILE". Parsing stops at the first
// line that is not `| ... |` after the anchor, so a markdown table added
// anywhere later in either document — however many columns it carries — is
// never absorbed into this one (PR #690 review, finding 2). The SEPARATOR row
// (`| --- | --- | ... |`) is validated by shape rather than assumed to be
// "whatever line 2 is": an unconditional `slice(2)` would otherwise silently
// drop the first real data row the moment that row got malformed or deleted —
// five PROBLEM rows with zero COMMITMENT misread as four is a missed no-go,
// not a cosmetic parsing quirk (PR #690 review, finding 4).
//
// WHAT THIS GATE DOES NOT DO. It does not judge whether a mark is honestly
// placed -- that a REQUIREMENT really maps to physical session hardware is a
// human editorial call the log's own header already governs ("log the same
// day, in their words"). It only proves that once a mark exists, the sentence
// that claims a count agrees with it, and that the page authorizing hardware
// spend still reads that count by name. Today's honest state is zero marks
// (`docs/agent/EVIDENCE.md`, this entry's date) -- nobody has retroactively
// tagged a row, and this gate would refuse a typed number that claimed
// otherwise without a mark to back it.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DOC = "docs/agent/DISCOVERY_LOG.md";
export const HYP_DOC = "docs/SESSION_PUCK_HARDWARE_HYPOTHESIS.md";
export const SAMPLE = 15;
export const HARDWARE_MARK = "X";
const GO_NO_GO_ANCHOR = "## Go / no-go — the discovery gates, applied to hardware";
const RUNNING_TALLY_ANCHOR = "## Running tally";

/** Strip markdown emphasis and whitespace so `**C**`, ` Rh `, etc. compare as bare names. */
const bare = (s) => s.replace(/\*+/g, "").trim();

/** Pure: split one markdown table row into trimmed cell strings. */
function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

/** Pure: does `line` look like a markdown table separator (`---`, `:--`, `--:`, `:-:` per cell)? */
function isSeparatorRow(line) {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/**
 * Pure: extract the contiguous run of `| ... |` lines starting at the first
 * such line found after `anchor`, ending at the first line that is NOT one.
 * That single break is the whole boundary rule: once the run ends it is never
 * resumed, so a second table anywhere further down the document — however
 * many columns wide — cannot be absorbed into this one. Returns null if
 * `anchor` is missing or no table line follows it.
 */
export function extractTableBlock(text, anchor) {
  const start = text.indexOf(anchor);
  if (start < 0) return null;
  const lines = text.slice(start).split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim().startsWith("|")) i += 1;
  if (i >= lines.length) return null;
  const block = [];
  while (i < lines.length && lines[i].trim().startsWith("|")) {
    block.push(lines[i]);
    i += 1;
  }
  return block;
}

/**
 * Pure: parse the Running tally table out of `text` — the header row, and the
 * data rows keyed by bare header name. Throws a Broken-shaped Error (never a
 * quietly-empty result) if the section, the table, or a well-shaped separator
 * row is missing: a malformed separator would otherwise let `slice(2)` drop
 * the true first data row as if it were the separator, silently.
 */
export function parseRunningTally(text) {
  const tableLines = extractTableBlock(text, RUNNING_TALLY_ANCHOR);
  if (tableLines === null) throw new Error(`${DOC}: no "${RUNNING_TALLY_ANCHOR}" section, or no table under it -- the anchor this gate parses from is gone`);
  if (tableLines.length < 2) throw new Error(`${DOC}: "${RUNNING_TALLY_ANCHOR}" table has no separator row under its header`);
  if (!isSeparatorRow(tableLines[1])) {
    throw new Error(
      `${DOC}: "${RUNNING_TALLY_ANCHOR}" table's second line is not a valid separator row ` +
        `(each cell must be dashes, e.g. "| --- | --- |") -- got "${tableLines[1].trim()}". ` +
        "Treating it as the separator anyway would silently drop the first real data row.",
    );
  }
  const header = splitRow(tableLines[0]).map(bare);
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

/** Pure: classify one Rh/Ch/Ph cell — "empty", "marked" (exactly the canonical `X`), or "invalid" (any other nonempty value, which must FAIL rather than silently count or silently pass). */
function classifyHardwareCell(cell) {
  if (typeof cell !== "string" || cell.length === 0) return "empty";
  if (cell === HARDWARE_MARK) return "marked";
  return "invalid";
}

/**
 * Pure: derive the hardware tally (Rh/Ch/Ph) from parsed table rows, plus any
 * invariant violation — a hardware mark with no base mark on the same row, or
 * a hardware cell holding an ambiguous nonempty value instead of the one
 * canonical marker.
 */
export function deriveHardwareTally({ header, rows }) {
  for (const col of ["R", "C", "P", "Rh", "Ch", "Ph"]) {
    if (!header.includes(col)) throw new Error(`${DOC}: Running tally table has no "${col}" column -- expected header shape lost`);
  }
  const problems = [];
  let rh = 0;
  let ch = 0;
  let ph = 0;
  const COLS = [
    ["Rh", "R", "REQUIREMENT"],
    ["Ch", "C", "COMMITMENT"],
    ["Ph", "P", "PROBLEM"],
  ];
  rows.forEach((row, i) => {
    const n = i + 1; // row 1 is the template row, kept 1-indexed to match the doc's own "#" column
    for (const [hwCol, baseCol, label] of COLS) {
      const kind = classifyHardwareCell(row[hwCol]);
      if (kind === "empty") continue;
      if (kind === "invalid") {
        problems.push(
          `row ${n}: ${hwCol} has "${row[hwCol]}", not the canonical mark "${HARDWARE_MARK}" -- an ambiguous ` +
            `mark is refused rather than silently counted as confirmed or silently treated as absent`,
        );
        continue;
      }
      if (hwCol === "Rh") rh += 1;
      else if (hwCol === "Ch") ch += 1;
      else ph += 1;
      if (!marked(row[baseCol])) {
        problems.push(`row ${n}: ${hwCol} is marked but ${baseCol} is not -- a hardware ${label.toLowerCase()} mark needs the base ${label} mark too`);
      }
    }
  });
  return { rh, ch, ph, problems };
}

/** The exact sentence the document must carry for a given (rh, ch, ph) -- built once, used both to check and to self-test. */
export function hardwareTallySentence(rh, ch, ph) {
  return `**Hardware (DR-043) — Rh: ${rh} of ${SAMPLE} · Ch: ${ch} of ${SAMPLE} · Ph: ${ph} of ${SAMPLE}.**`;
}

/** Pure: full audit of DISCOVERY_LOG.md's text -- derive the tally, find the typed sentence, and report any disagreement. May throw (see parseRunningTally). */
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

/** Pure: run `audit`, converting a thrown parse error into the same {problems} shape instead of propagating. */
function safeAudit(text) {
  try {
    return { threw: false, ...audit(text) };
  } catch (e) {
    return { threw: true, message: e.message, problems: [e.message] };
  }
}

// ── the cross-check into SESSION_PUCK_HARDWARE_HYPOTHESIS.md's go/no-go table ──

/**
 * Each check fires against ONE table row's raw line text (never the whole
 * table joined), so a threshold number in one row can never satisfy a check
 * looking for a tally-cell reference sitting in a different row.
 */
const GO_NO_GO_ROW_CHECKS = [
  {
    name: "REQUIREMENT row (>= 4 of 15, naming the Rh tally cell)",
    test: (line) => /≥\s*4\s*of\s*15\b/.test(line) && /\bRh\b/.test(line),
  },
  {
    name: "COMMITMENT row (>= 3, naming the Ch tally cell)",
    test: (line) => /≥\s*3\b/.test(line) && /COMMITMENT/i.test(line) && /\bCh\b/.test(line),
  },
  {
    name: "PROBLEM/no-go row (>= 5 PROBLEM with COMMITMENT = 0, naming the Ph tally cell)",
    test: (line) => /≥\s*5\b/.test(line) && /COMMITMENT\s*=\s*0/.test(line) && /\bPh\b/.test(line),
  },
];

/**
 * Pure: does SESSION_PUCK_HARDWARE_HYPOTHESIS.md's go/no-go table still name
 * the Rh/Ch/Ph tally cells beside the registered thresholds? Returns problem
 * strings (empty when clean) rather than throwing — a missing table is a
 * reportable problem here, not a broken derivation, because this function's
 * caller already has a working DISCOVERY_LOG.md derivation to report either way.
 */
export function auditHypothesisTallyReferences(text) {
  const tableLines = extractTableBlock(text, GO_NO_GO_ANCHOR);
  if (tableLines === null) {
    return [`${HYP_DOC}: no go/no-go table found under "${GO_NO_GO_ANCHOR}" -- the authorization table this gate cross-checks is gone`];
  }
  const problems = [];
  for (const check of GO_NO_GO_ROW_CHECKS) {
    if (!tableLines.some((line) => check.test(line))) {
      problems.push(
        `${HYP_DOC}: go/no-go table is missing its ${check.name} -- the authorization table must name the tally cell it reads and carry the registered threshold, not describe a feeling`,
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Self-test fixtures.

function row(cells) {
  // cells: {S,I,P,R,Rt,C,Rh,Ch,Ph} sparse map of marks; "#"/Date/Role are filler.
  const c = (k) => cells[k] ?? "";
  return `| ${cells["#"] ?? "1"} | | | ${c("S")} | ${c("I")} | ${c("P")} | ${c("R")} | ${c("Rt")} | ${c("C")} | ${c("Rh")} | ${c("Ch")} | ${c("Ph")} |`;
}

function buildDoc(rows, tallySentence, { trailingTable = false } = {}) {
  const header = "| # | Date | Role | S | I | P | R | Rt | **C** | Rh | Ch | Ph |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const table = [header, sep, ...rows.map(row)].join("\n");
  const parts = [
    RUNNING_TALLY_ANCHOR,
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
  ];
  if (trailingTable) {
    // A later, unrelated, WIDER table — proves the parser stops at the first
    // blank line after the running tally and never absorbs a table below it.
    parts.push(
      "## Some later section, added long after this gate existed",
      "",
      "| a | b | c | d | e | f | g | h | i | j | k | l |",
      "| - | - | - | - | - | - | - | - | - | - | - | - |",
      "| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |",
      "",
    );
  }
  return parts.join("\n");
}

const GOOD_HYP_ROWS = [
  "| ≥ 4 of 15 independently repeat a requirement that maps specifically to faster or stronger physical session authentication or custody binding (the **Rh** tally cell) | **Authorize a bench prototype** (family A). |",
  "| ≥ 3 concrete COMMITMENTS, including willingness to scope and test this workflow (the **Ch** tally cell) | **Authorize a design-partner MVP** using off-the-shelf FIDO/NFC hardware. |",
  "| ≥ 5 PROBLEM but COMMITMENT = 0 (the **Ph** tally cell, read against **Ch**) | **No-go on productization.** |",
];

function buildHypDoc(rows) {
  return [
    GO_NO_GO_ANCHOR,
    "",
    "The table reapplies the pre-registered discovery thresholds to hardware.",
    "",
    "| External evidence | Hardware decision |",
    "| --- | --- |",
    ...rows,
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

  // 3. A hardware-tagged row is added (R and Rh both marked `X`) but the typed
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

  // 8. Finding 1 (PR #690): an AMBIGUOUS nonempty mark (`?`) in Rh must FAIL,
  //    and must NOT be silently counted as a confirmed mark.
  const ambiguousRh = buildDoc([{ R: "X", Rh: "?" }], hardwareTallySentence(0, 0, 0));
  const ambiguousRhResult = audit(ambiguousRh);
  checks.push([
    "a `?` in Rh FAILS (not the canonical `X`) instead of counting as a confirmed hardware mark",
    ambiguousRhResult.rh === 0 && ambiguousRhResult.problems.length === 1 && /not the canonical mark/.test(ambiguousRhResult.problems[0]),
  ]);
  const ambiguousCh = buildDoc([{ C: "X", Ch: "pending" }], hardwareTallySentence(0, 0, 0));
  checks.push([
    "a `pending` in Ch FAILS the same way",
    audit(ambiguousCh).ch === 0 && audit(ambiguousCh).problems.some((p) => /Ch has "pending", not the canonical mark/.test(p)),
  ]);
  const ambiguousPh = buildDoc([{ P: "X", Ph: "no" }], hardwareTallySentence(0, 0, 0));
  checks.push([
    "a `no` in Ph FAILS the same way",
    audit(ambiguousPh).ph === 0 && audit(ambiguousPh).problems.some((p) => /Ph has "no", not the canonical mark/.test(p)),
  ]);

  // 9. Finding 2 (PR #690): a LATER, wider table in the same document must
  //    never be absorbed into the running-tally parse.
  const withTrailingTable = buildDoc([{}], hardwareTallySentence(0, 0, 0), { trailingTable: true });
  const trailingResult = audit(withTrailingTable);
  checks.push([
    "a later 12-column table elsewhere in the document is never absorbed into the running-tally table",
    trailingResult.problems.length === 0 && trailingResult.rh === 0 && trailingResult.ch === 0 && trailingResult.ph === 0,
  ]);
  const withTrailingTableAndHwRow = buildDoc([{ R: "X", Rh: "X" }], hardwareTallySentence(1, 0, 0), { trailingTable: true });
  checks.push(["...and a real hardware-tagged row still derives correctly with a trailing table present", audit(withTrailingTableAndHwRow).rh === 1]);

  // 10. Finding 4 (PR #690): a MALFORMED separator row must FAIL (throw) rather
  //     than being treated as the separator and silently dropping row 1.
  const badSeparatorDoc = [
    RUNNING_TALLY_ANCHOR,
    "",
    "| # | Date | Role | S | I | P | R | Rt | **C** | Rh | Ch | Ph |",
    "| 1 | 2026-08-27 | nurse | | | X | X | | | X | | X |", // a REAL data row masquerading as line 2
    "",
    "---",
    "",
  ].join("\n");
  const badSeparatorResult = safeAudit(badSeparatorDoc);
  checks.push([
    "a malformed separator row FAILS (throws) instead of being treated as the separator and silently dropping the first real data row",
    badSeparatorResult.threw && /not a valid separator row/.test(badSeparatorResult.message),
  ]);
  // ...and the shape that a dropped row would have hidden: five real PROBLEM/Ph
  // rows should derive ph=5, not four — the count `slice(2)` would produce if
  // it silently treated row 1 as "the separator" instead of validating it.
  // With a WELL-FORMED separator, all five are counted:
  const fiveProblemRows = Array.from({ length: 5 }, () => row({ P: "X", Ph: "X" }));
  const goodSeparatorFive = buildDoc(
    fiveProblemRows.map(() => ({ P: "X", Ph: "X" })),
    hardwareTallySentence(0, 0, 5),
  );
  checks.push(["five real PROBLEM/Ph rows behind a WELL-FORMED separator correctly derive ph=5, not four", audit(goodSeparatorFive).ph === 5]);
  // With that separator row DELETED (row 1 now sits where the separator must
  // be), the same five rows must throw rather than silently deriving ph=4:
  const badSeparatorFive = [
    RUNNING_TALLY_ANCHOR,
    "",
    ["| # | Date | Role | S | I | P | R | Rt | **C** | Rh | Ch | Ph |", ...fiveProblemRows].join("\n"),
    "",
    "---",
    "",
  ].join("\n");
  const badSeparatorFiveResult = safeAudit(badSeparatorFive);
  checks.push([
    "...and the SAME five rows with the separator deleted throws rather than silently deriving ph=4 (one row misread as the separator)",
    badSeparatorFiveResult.threw,
  ]);

  // 11. Finding 3 (PR #690): the go/no-go table in SESSION_PUCK_HARDWARE_HYPOTHESIS.md
  //     must name Rh/Ch/Ph beside the registered thresholds, in the same row.
  const goodHyp = buildHypDoc(GOOD_HYP_ROWS);
  checks.push(["a go/no-go table naming Rh/Ch/Ph beside the registered thresholds passes", auditHypothesisTallyReferences(goodHyp).length === 0]);

  const strippedRhRows = [...GOOD_HYP_ROWS];
  strippedRhRows[0] =
    "| ≥ 4 of 15 independently repeat a requirement that maps specifically to faster or stronger physical session authentication or custody binding | **Authorize a bench prototype** (family A). |";
  const strippedRhProblems = auditHypothesisTallyReferences(buildHypDoc(strippedRhRows));
  checks.push(["removing the Rh cell reference from the REQUIREMENT row FAILS", strippedRhProblems.some((p) => /REQUIREMENT row/.test(p))]);

  const strippedChRows = [...GOOD_HYP_ROWS];
  strippedChRows[1] = "| ≥ 3 concrete COMMITMENTS, including willingness to scope and test this workflow | **Authorize a design-partner MVP**. |";
  const strippedChProblems = auditHypothesisTallyReferences(buildHypDoc(strippedChRows));
  checks.push(["removing the Ch cell reference from the COMMITMENT row FAILS", strippedChProblems.some((p) => /COMMITMENT row/.test(p))]);

  const strippedPhRows = [...GOOD_HYP_ROWS];
  strippedPhRows[2] = "| ≥ 5 PROBLEM but COMMITMENT = 0 | **No-go on productization.** |";
  const strippedPhProblems = auditHypothesisTallyReferences(buildHypDoc(strippedPhRows));
  checks.push(["removing the Ph cell reference from the PROBLEM/no-go row FAILS", strippedPhProblems.some((p) => /PROBLEM\/no-go row/.test(p))]);

  const changedThresholdRows = [...GOOD_HYP_ROWS];
  changedThresholdRows[0] = changedThresholdRows[0].replace("≥ 4 of 15", "≥ 5 of 15");
  const changedThresholdProblems = auditHypothesisTallyReferences(buildHypDoc(changedThresholdRows));
  checks.push(["changing the registered REQUIREMENT threshold (4 -> 5) FAILS even though Rh is still named", changedThresholdProblems.some((p) => /REQUIREMENT row/.test(p))]);

  const missingTableProblems = auditHypothesisTallyReferences(`${GO_NO_GO_ANCHOR}\n\nno table here at all.\n`);
  checks.push(["a go/no-go section with no table at all FAILS by name", missingTableProblems.some((p) => /no go\/no-go table found/.test(p))]);

  // 12. ...and the REAL trees, right now, are clean, together (the full gate as it actually runs).
  const real = audit(readFileSync(join(repo, DOC), "utf8"));
  checks.push([`...and the real ${DOC} passes right now`, real.problems.length === 0]);
  const realHypProblems = auditHypothesisTallyReferences(readFileSync(join(repo, HYP_DOC), "utf8"));
  checks.push([`...and the real ${HYP_DOC} currently names Rh/Ch/Ph beside the registered thresholds`, realHypProblems.length === 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) {
  process.exit(selfTest());
}

function main() {
  let logText;
  let hypText;
  try {
    logText = readFileSync(join(repo, DOC), "utf8");
    hypText = readFileSync(join(repo, HYP_DOC), "utf8");
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    console.error("\nDiscovery-log gate FAILED — could not read a required document.");
    process.exit(1);
  }

  let logResult;
  try {
    logResult = audit(logText);
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    console.error("\nDiscovery-log gate FAILED — the Running tally table could not be parsed.");
    process.exit(1);
  }

  const hypProblems = auditHypothesisTallyReferences(hypText);
  const problems = [...logResult.problems, ...hypProblems];
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.log(
    `discovery-log hardware tally: Rh ${logResult.rh} of ${SAMPLE} · Ch ${logResult.ch} of ${SAMPLE} · Ph ${logResult.ph} of ${SAMPLE}, ${problems.length} problem(s)`,
  );
  if (problems.length > 0) {
    console.error("\nDiscovery-log gate FAILED — the typed hardware tally does not match the table it derives from, or the go/no-go table no longer reads it by name.");
    process.exit(1);
  }
  console.log(`Discovery-log gate passed — ${DOC}'s hardware tally sentence matches its table, and ${HYP_DOC}'s go/no-go table reads it by name.`);
}

main();
