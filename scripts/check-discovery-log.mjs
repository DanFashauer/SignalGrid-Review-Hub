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
// tally row that exists" except a human rereading the whole log by eye.
//
// THE MARKER. The Running tally table in docs/agent/DISCOVERY_LOG.md gains
// three columns, Rh / Ch / Ph, beside R / C / P (BUILD_BACKLOG.md, "Puck 5").
// A row marks Rh/Ch/Ph with the ONE canonical marker, `X`, ONLY when the
// matching base column (R/C/P) is ALSO marked: a hardware signal is a
// hardware-specific READING of a REQUIREMENT/COMMITMENT/PROBLEM that
// conversation already carried, never a fourth kind of evidence on its own.
//
// ONE ROW VALIDATOR, NOT FOUR PATCHES (PR #690, second review round). Four
// separate findings — a duplicate conversation number counted twice, a
// markdown-escaped `\|` inside a cell silently shifting every column after
// it, an ambiguous BASE mark (R/C/P holding a "?" and reading as "marked"),
// and an ambiguous HARDWARE mark — are one root cause: nothing validated a
// row's SHAPE before trusting its cells. `validateTallyRow` below is the
// single gate every data row passes through; it rejects the whole row
// (flags a problem, excludes it from every count) unless: the cell count
// exactly matches the header (an escaped pipe is unescaped AFTER splitting on
// unescaped pipes only, never a delimiter); the "#" cell is an integer from 1
// to SAMPLE and not reused by an earlier row; and every R/C/P/Rh/Ch/Ph cell is
// either empty or exactly the canonical `X`. A row that fails any of these is
// data this gate cannot trust, so it is refused outright rather than
// half-counted.
//
// EXACTLY ONE TALLY SENTENCE (PR #690, second round). The first version
// matched the FIRST "**Hardware (DR-043) ...**" sentence in the document and
// stopped looking, so a stale second copy left behind by a bad merge or a
// half-finished edit would never be seen. This now collects every match and
// fails unless there is EXACTLY one, equal to the derived tally.
//
// THE NO-GO ROW NAMES BOTH Ch AND Ph (PR #690, second round). The no-go
// threshold is PROBLEM >= 5 WITH COMMITMENT = 0 — a conjunction of two tally
// cells, not one. Requiring only `Ph` in that row let `Ch` drop out of the
// authorization table silently; the row must now name both.
//
// SCOPE DECISION ON "any doc could carry a rogue authorization" (PR #690,
// second round, finding at old line 73). NOT built. A tree-wide scan for
// "DR-043 hardware-authorization phrasing" cannot be scoped narrowly without
// also matching this record's own doctrine sources: docs/DECISION_RECORDS.md
// DR-043 rule 4 and docs/BUILD_BACKLOG.md's Puck 5 row both legitimately say
// "Rh -> bench prototype", "design-partner MVP" and "no-go" in the SAME
// breath — that is the rule being described, not a second authorization
// surface, and this gate is not permitted to edit either file to launder the
// phrasing around a detector. A registry-of-surfaces gate that immediately
// requires exempting the two canonical doctrine documents that ARE the
// authorization is a gate fighting its own foundation, not a real defense —
// exactly the "too broad to do cleanly" case the review round flagged as a
// stop condition rather than a build one. Proposed instead, on the PR thread:
// a MARKER the authorization surface itself carries (e.g. an HTML comment
// naming itself `<!-- dr-043-authorization-surface -->`), so the registry
// check becomes "every such marker is on the registered list" — additive,
// and never requires parsing doctrine prose to tell a rule from a decision.
//
// WHAT THIS GATE DOES NOT DO. It does not judge whether a mark is honestly
// placed -- that a REQUIREMENT really maps to physical session hardware is a
// human editorial call the log's own header already governs ("log the same
// day, in their words"). It only proves that once a mark exists, the
// sentence that claims a count agrees with it, and that the page authorizing
// hardware spend still reads that count by name. Today's honest state is
// zero marks (`docs/agent/EVIDENCE.md`, this entry's date).
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
const REQUIRED_COLUMNS = ["#", "R", "C", "P", "Rh", "Ch", "Ph"];
const TALLY_MARK_COLS = ["R", "C", "P", "Rh", "Ch", "Ph"];

/** Strip markdown emphasis and whitespace so `**C**`, ` Rh `, etc. compare as bare names. */
const bare = (s) => s.replace(/\*+/g, "").trim();

/**
 * Pure: split one markdown table row into cell strings. A `\|` is markdown's
 * own escape for a literal pipe inside a cell and is never a column
 * delimiter — split on unescaped pipes only, THEN unescape each cell, so an
 * escaped pipe can never shift every column after it.
 */
function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
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
 * Pure: validate ONE data row against the running-tally contract, mutating
 * `seenNumbers` only on a number that is itself valid and unused. Rejects
 * (returns `row: null`, plus every problem found) unless ALL hold: the cell
 * count exactly matches the header; "#" is an integer 1..SAMPLE not already
 * used; and every R/C/P/Rh/Ch/Ph cell is empty or exactly `HARDWARE_MARK`. A
 * row failing any check is excluded from every count — flagged, never
 * silently half-trusted.
 */
export function validateTallyRow(header, cells, n, seenNumbers) {
  if (cells.length !== header.length) {
    return {
      row: null,
      problems: [
        `row ${n}: has ${cells.length} column(s), the header has ${header.length} -- an unescaped pipe inside a ` +
          "cell, a missing cell, or a wrapped line shifts every column after it, so the row is rejected rather than misread",
      ],
    };
  }
  const row = {};
  header.forEach((name, i) => {
    row[name] = bare(cells[i]);
  });
  const problems = [];

  const rawNum = row["#"];
  const num = Number(rawNum);
  if (!(Number.isInteger(num) && num >= 1 && num <= SAMPLE && String(num) === rawNum)) {
    problems.push(`row ${n}: "#" is "${rawNum}", not an integer from 1 to ${SAMPLE}`);
  } else if (seenNumbers.has(num)) {
    problems.push(`row ${n}: conversation number ${num} is already used by another row -- each conversation is counted once`);
  } else {
    seenNumbers.add(num);
  }

  for (const col of TALLY_MARK_COLS) {
    const cell = row[col];
    if (cell.length > 0 && cell !== HARDWARE_MARK) {
      problems.push(`row ${n}: ${col} has "${cell}", not the canonical mark "${HARDWARE_MARK}" -- an ambiguous mark is refused rather than silently counted or silently ignored`);
    }
  }

  return { row: problems.length === 0 ? row : null, problems };
}

/**
 * Pure: parse the Running tally table out of `text` — the header, the VALID
 * data rows (each already passed through `validateTallyRow`), and every
 * per-row problem found along the way. Throws a Broken-shaped Error (never a
 * quietly-empty result) if the section, the table, the separator, or a
 * required column is missing entirely — that is a broken derivation, not
 * data this function can grade row by row.
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
  for (const col of REQUIRED_COLUMNS) {
    if (!header.includes(col)) throw new Error(`${DOC}: Running tally table has no "${col}" column -- expected header shape lost`);
  }
  const seenNumbers = new Set();
  const rows = [];
  const rowProblems = [];
  tableLines.slice(2).forEach((line, i) => {
    const { row, problems } = validateTallyRow(header, splitRow(line), i + 1, seenNumbers);
    rowProblems.push(...problems);
    if (row !== null) rows.push(row);
  });
  return { header, rows, rowProblems };
}

/**
 * Pure: derive the hardware tally (Rh/Ch/Ph) from ALREADY-VALIDATED rows,
 * plus any base-mark invariant violation (a hardware mark with no base mark
 * on the same row). Rows here are guaranteed shape-valid by `validateTallyRow`
 * — every cell is `""` or exactly `HARDWARE_MARK` — so an equality check
 * suffices.
 */
export function deriveHardwareTally(rows) {
  let rh = 0;
  let ch = 0;
  let ph = 0;
  const problems = [];
  const COLS = [
    ["Rh", "R", "REQUIREMENT"],
    ["Ch", "C", "COMMITMENT"],
    ["Ph", "P", "PROBLEM"],
  ];
  for (const row of rows) {
    for (const [hwCol, baseCol, label] of COLS) {
      if (row[hwCol] !== HARDWARE_MARK) continue;
      if (hwCol === "Rh") rh += 1;
      else if (hwCol === "Ch") ch += 1;
      else ph += 1;
      if (row[baseCol] !== HARDWARE_MARK) {
        problems.push(`row #${row["#"]}: ${hwCol} is marked but ${baseCol} is not -- a hardware ${label.toLowerCase()} mark needs the base ${label} mark too`);
      }
    }
  }
  return { rh, ch, ph, problems };
}

/** The exact sentence the document must carry for a given (rh, ch, ph) -- built once, used both to check and to self-test. */
export function hardwareTallySentence(rh, ch, ph) {
  return `**Hardware (DR-043) — Rh: ${rh} of ${SAMPLE} · Ch: ${ch} of ${SAMPLE} · Ph: ${ph} of ${SAMPLE}.**`;
}

const HW_SENTENCE_RE = /\*\*Hardware \(DR-043\)[^*]*\*\*/g;

/**
 * Pure: find every "Hardware (DR-043) ..." sentence in `text` and require
 * EXACTLY ONE, equal to the tally derived from (rh, ch, ph). Two matches — a
 * stale duplicate left by a bad merge or a half-finished edit — is a FAILURE
 * even if one of them is correct: the first version only ever looked at the
 * first match and would have missed this entirely.
 */
export function checkHardwareSentence(text, rh, ch, ph) {
  const expected = hardwareTallySentence(rh, ch, ph);
  const matches = [...text.matchAll(HW_SENTENCE_RE)].map((m) => m[0]);
  if (matches.length === 0) {
    return { expected, typed: null, problems: [`${DOC}: no "Hardware (DR-043)" tally sentence found -- expected it verbatim: ${expected}`] };
  }
  if (matches.length > 1) {
    return {
      expected,
      typed: matches[0],
      problems: [`${DOC}: found ${matches.length} "Hardware (DR-043)" tally sentences, expected exactly one -- ${matches.map((m) => `"${m}"`).join(" / ")}`],
    };
  }
  if (matches[0] !== expected) {
    return { expected, typed: matches[0], problems: [`${DOC}: typed "${matches[0]}" does not match the derived tally -- expected: ${expected}`] };
  }
  return { expected, typed: matches[0], problems: [] };
}

/** Pure: full audit of DISCOVERY_LOG.md's text -- derive the tally, find the typed sentence, and report any disagreement. May throw (see parseRunningTally). */
export function audit(text) {
  const { rows, rowProblems } = parseRunningTally(text);
  const { rh, ch, ph, problems: invariantProblems } = deriveHardwareTally(rows);
  const sentence = checkHardwareSentence(text, rh, ch, ph);
  return { rh, ch, ph, expected: sentence.expected, typed: sentence.typed, problems: [...rowProblems, ...invariantProblems, ...sentence.problems] };
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
 * looking for a tally-cell reference sitting in a different row. The no-go
 * row names BOTH Ch and Ph: the threshold itself is a conjunction (PROBLEM
 * >= 5 AND COMMITMENT = 0), so the row must name both cells it reads.
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
    name: "PROBLEM/no-go row (>= 5 PROBLEM with COMMITMENT = 0, naming BOTH the Ph and Ch tally cells)",
    test: (line) => /≥\s*5\b/.test(line) && /COMMITMENT\s*=\s*0/.test(line) && /\bPh\b/.test(line) && /\bCh\b/.test(line),
  },
];

/**
 * Pure: does SESSION_PUCK_HARDWARE_HYPOTHESIS.md's go/no-go table still name
 * the Rh/Ch/Ph tally cells beside the registered thresholds? Returns problem
 * strings (empty when clean) rather than throwing.
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
        `${HYP_DOC}: go/no-go table is missing its ${check.name} -- the authorization table must name the tally cell(s) it reads and carry the registered threshold, not describe a feeling`,
      );
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Self-test fixtures.

function row(cells) {
  // cells: {#, Role, S,I,P,R,Rt,C,Rh,Ch,Ph} sparse map; Date always filler.
  const c = (k) => cells[k] ?? "";
  return `| ${c("#") || "1"} | | ${c("Role")} | ${c("S")} | ${c("I")} | ${c("P")} | ${c("R")} | ${c("Rt")} | ${c("C")} | ${c("Rh")} | ${c("Ch")} | ${c("Ph")} |`;
}

function buildDoc(rows, tallySentence, { trailingTable = false, extraSentence = null } = {}) {
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
    ...(extraSentence ? ["", extraSentence] : []),
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
  const hwRowStaleSentence = buildDoc([{ "#": "1", R: "X", Rh: "X" }], hardwareTallySentence(0, 0, 0));
  const hwRowStaleResult = audit(hwRowStaleSentence);
  checks.push(["a hardware-tagged row moves the derived Rh count from 0 to 1", hwRowStaleResult.rh === 1]);
  checks.push([
    "...and a stale typed sentence (still 0 of 15) FAILS against the moved count",
    hwRowStaleResult.problems.length === 1 && /does not match the derived tally/.test(hwRowStaleResult.problems[0]),
  ]);

  // 4. Same hardware-tagged row, sentence updated to match -> PASS.
  const hwRowFreshSentence = buildDoc([{ "#": "1", R: "X", Rh: "X" }], hardwareTallySentence(1, 0, 0));
  checks.push(["...and updating the sentence to match (Rh: 1) passes", audit(hwRowFreshSentence).problems.length === 0]);

  // 5. Invariant: Rh marked without the base R mark -> FAILS, regardless of the
  //    typed sentence, because the mark itself is malformed.
  const invariantBroken = buildDoc([{ "#": "1", Rh: "X" }], hardwareTallySentence(1, 0, 0));
  checks.push(["Rh marked without R marked FAILS the base-mark invariant", audit(invariantBroken).problems.some((p) => /Rh is marked but R is not/.test(p))]);
  const chBroken = buildDoc([{ "#": "1", Ch: "X" }], hardwareTallySentence(0, 1, 0));
  checks.push(["Ch marked without C marked FAILS the base-mark invariant", audit(chBroken).problems.some((p) => /Ch is marked but C is not/.test(p))]);
  const phBroken = buildDoc([{ "#": "1", Ph: "X" }], hardwareTallySentence(0, 0, 1));
  checks.push(["Ph marked without P marked FAILS the base-mark invariant", audit(phBroken).problems.some((p) => /Ph is marked but P is not/.test(p))]);

  // 6. Missing sentence entirely -> FAILS with a message quoting the expected text.
  const noSentence = buildDoc([{}], null);
  checks.push(["a missing tally sentence FAILS and quotes the expected text", audit(noSentence).problems.some((p) => /no "Hardware \(DR-043\)" tally sentence found/.test(p))]);

  // 7. An AMBIGUOUS nonempty HARDWARE mark (`?`, `pending`, `no`) FAILS and is
  //    NOT silently counted as confirmed.
  const ambiguousRh = buildDoc([{ "#": "1", R: "X", Rh: "?" }], hardwareTallySentence(0, 0, 0));
  const ambiguousRhResult = audit(ambiguousRh);
  checks.push(["a `?` in Rh FAILS instead of counting as a confirmed hardware mark", ambiguousRhResult.rh === 0 && ambiguousRhResult.problems.some((p) => /Rh has "\?", not the canonical mark/.test(p))]);
  const ambiguousCh = buildDoc([{ "#": "1", C: "X", Ch: "pending" }], hardwareTallySentence(0, 0, 0));
  const ambiguousChResult = audit(ambiguousCh);
  checks.push(["a `pending` in Ch FAILS the same way", ambiguousChResult.ch === 0 && ambiguousChResult.problems.some((p) => /Ch has "pending", not the canonical mark/.test(p))]);

  // 8. An AMBIGUOUS nonempty BASE mark (R/C/P) FAILS the same way — the
  //    validator does not distinguish base from hardware columns.
  const ambiguousBaseR = buildDoc([{ "#": "1", R: "?" }], hardwareTallySentence(0, 0, 0));
  checks.push(["a `?` in the BASE column R FAILS, not just in Rh", audit(ambiguousBaseR).problems.some((p) => /row 1: R has "\?", not the canonical mark/.test(p))]);

  // 9. A LATER, wider table in the same document must never be absorbed into
  //    the running-tally parse.
  const withTrailingTable = buildDoc([{}], hardwareTallySentence(0, 0, 0), { trailingTable: true });
  const trailingResult = audit(withTrailingTable);
  checks.push(["a later 12-column table elsewhere in the document is never absorbed into the running-tally table", trailingResult.problems.length === 0 && trailingResult.rh === 0]);

  // 10. A MALFORMED separator row must FAIL (throw) rather than being treated
  //     as the separator and silently dropping the first real data row.
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
  checks.push(["a malformed separator row FAILS (throws) instead of silently dropping the first real data row", badSeparatorResult.threw && /not a valid separator row/.test(badSeparatorResult.message)]);
  // With a WELL-FORMED separator, five real PROBLEM/Ph rows derive ph=5, not
  // four — the count a dropped row would produce:
  const goodSeparatorFive = buildDoc(
    Array.from({ length: 5 }, (_, i) => ({ "#": String(i + 1), P: "X", Ph: "X" })),
    hardwareTallySentence(0, 0, 5),
  );
  checks.push(["five real PROBLEM/Ph rows behind a well-formed separator correctly derive ph=5, not four", audit(goodSeparatorFive).ph === 5]);

  // 11. NEW (PR #690, second round) — DUPLICATE conversation number: two rows
  //     both claim "#" 1, one of them marks Rh. The duplicate is rejected
  //     (never counted), so the tally must NOT include it.
  const duplicateNumberDoc = buildDoc(
    [
      { "#": "1", R: "X", Rh: "X" },
      { "#": "1", C: "X", Ch: "X" }, // same conversation number, second row
    ],
    hardwareTallySentence(1, 0, 0),
  );
  const duplicateResult = audit(duplicateNumberDoc);
  checks.push([
    "a duplicate conversation number FAILS and the duplicate row's marks are never counted",
    duplicateResult.problems.some((p) => /conversation number 1 is already used/.test(p)) && duplicateResult.rh === 1 && duplicateResult.ch === 0,
  ]);

  // 12. NEW — an out-of-range / non-integer conversation number FAILS.
  const badNumberDoc = buildDoc([{ "#": "16", R: "X", Rh: "X" }], hardwareTallySentence(0, 0, 0));
  checks.push(["a conversation number outside 1..15 FAILS", audit(badNumberDoc).problems.some((p) => /"#" is "16", not an integer from 1 to 15/.test(p))]);

  // 13. NEW — a WRONG COLUMN COUNT (a raw, unescaped extra `|` inside a cell)
  //     FAILS via the shape check rather than silently shifting every column
  //     after it.
  const wrongColumnCountDoc = [
    RUNNING_TALLY_ANCHOR,
    "",
    "| # | Date | Role | S | I | P | R | Rt | **C** | Rh | Ch | Ph |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    "| 1 | | extra | pipe | | | | X | | X | | | |", // 13 cells, header has 12
    "",
    hardwareTallySentence(0, 0, 0),
    "",
    "---",
    "",
  ].join("\n");
  checks.push(["a row with an extra raw column FAILS the column-count check instead of shifting every field after it", audit(wrongColumnCountDoc).problems.some((p) => /has 13 column\(s\), the header has 12/.test(p))]);

  // 14. NEW — a markdown-ESCAPED pipe `\|` inside a cell (Role) does NOT shift
  //     any column: the row still parses to exactly 12 cells and a real
  //     hardware mark elsewhere in the row is still counted correctly.
  const escapedPipeDoc = buildDoc([{ "#": "1", Role: "night shift \\| trauma bay", R: "X", Rh: "X" }], hardwareTallySentence(1, 0, 0));
  const escapedPipeResult = audit(escapedPipeDoc);
  checks.push(["a markdown-escaped `\\|` inside a cell does not shift columns and the row's marks still count", escapedPipeResult.problems.length === 0 && escapedPipeResult.rh === 1]);

  // 15. NEW — TWO "Hardware (DR-043) ..." sentences (a stale duplicate left by
  //     a bad merge) FAILS even though the first one is correct.
  const twoSentencesDoc = buildDoc([{}], hardwareTallySentence(0, 0, 0), { extraSentence: hardwareTallySentence(2, 0, 0) });
  const twoSentencesResult = audit(twoSentencesDoc);
  checks.push(["two Hardware (DR-043) tally sentences FAILS even though the first is correct", twoSentencesResult.problems.some((p) => /found 2 "Hardware \(DR-043\)" tally sentences/.test(p))]);

  // 16. The go/no-go table in SESSION_PUCK_HARDWARE_HYPOTHESIS.md must name
  //     Rh/Ch/Ph beside the registered thresholds, in the same row — and the
  //     no-go row must name BOTH Ch and Ph (PR #690, second round).
  checks.push(["a go/no-go table naming Rh/Ch/Ph beside the registered thresholds passes", auditHypothesisTallyReferences(buildHypDoc(GOOD_HYP_ROWS)).length === 0]);

  const strippedRhRows = [...GOOD_HYP_ROWS];
  strippedRhRows[0] =
    "| ≥ 4 of 15 independently repeat a requirement that maps specifically to faster or stronger physical session authentication or custody binding | **Authorize a bench prototype** (family A). |";
  checks.push(["removing the Rh cell reference from the REQUIREMENT row FAILS", auditHypothesisTallyReferences(buildHypDoc(strippedRhRows)).some((p) => /REQUIREMENT row/.test(p))]);

  const strippedChRows = [...GOOD_HYP_ROWS];
  strippedChRows[1] = "| ≥ 3 concrete COMMITMENTS, including willingness to scope and test this workflow | **Authorize a design-partner MVP**. |";
  checks.push(["removing the Ch cell reference from the COMMITMENT row FAILS", auditHypothesisTallyReferences(buildHypDoc(strippedChRows)).some((p) => /COMMITMENT row/.test(p))]);

  const strippedPhRows = [...GOOD_HYP_ROWS];
  strippedPhRows[2] = "| ≥ 5 PROBLEM but COMMITMENT = 0 | **No-go on productization.** |";
  checks.push(["removing BOTH Ch and Ph from the PROBLEM/no-go row FAILS", auditHypothesisTallyReferences(buildHypDoc(strippedPhRows)).some((p) => /PROBLEM\/no-go row/.test(p))]);

  // 17. NEW (PR #690, second round) — the no-go row names Ph but DROPS Ch
  //     specifically (the conjunction's other half) -> FAILS.
  const droppedChOnlyRows = [...GOOD_HYP_ROWS];
  droppedChOnlyRows[2] = "| ≥ 5 PROBLEM but COMMITMENT = 0 (the **Ph** tally cell) | **No-go on productization.** |";
  checks.push(["the no-go row naming Ph but dropping Ch specifically FAILS (the no-go is Ph>=5 AND Ch=0, both must be named)", auditHypothesisTallyReferences(buildHypDoc(droppedChOnlyRows)).some((p) => /PROBLEM\/no-go row/.test(p))]);

  const changedThresholdRows = [...GOOD_HYP_ROWS];
  changedThresholdRows[0] = changedThresholdRows[0].replace("≥ 4 of 15", "≥ 5 of 15");
  checks.push(["changing the registered REQUIREMENT threshold (4 -> 5) FAILS even though Rh is still named", auditHypothesisTallyReferences(buildHypDoc(changedThresholdRows)).some((p) => /REQUIREMENT row/.test(p))]);

  checks.push(["a go/no-go section with no table at all FAILS by name", auditHypothesisTallyReferences(`${GO_NO_GO_ANCHOR}\n\nno table here at all.\n`).some((p) => /no go\/no-go table found/.test(p))]);

  // 18. ...and the REAL trees, right now, are clean, together (the full gate as it actually runs).
  const real = audit(readFileSync(join(repo, DOC), "utf8"));
  checks.push([`...and the real ${DOC} passes right now`, real.problems.length === 0]);
  checks.push([`...and the real ${HYP_DOC} currently names Rh/Ch/Ph beside the registered thresholds`, auditHypothesisTallyReferences(readFileSync(join(repo, HYP_DOC), "utf8")).length === 0]);

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

  const problems = [...logResult.problems, ...auditHypothesisTallyReferences(hypText)];
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.log(`discovery-log hardware tally: Rh ${logResult.rh} of ${SAMPLE} · Ch ${logResult.ch} of ${SAMPLE} · Ph ${logResult.ph} of ${SAMPLE}, ${problems.length} problem(s)`);
  if (problems.length > 0) {
    console.error("\nDiscovery-log gate FAILED — a row failed validation, the typed hardware tally does not match the table it derives from, or the go/no-go table no longer reads it by name.");
    process.exit(1);
  }
  console.log(`Discovery-log gate passed — ${DOC}'s hardware tally sentence matches its table, and ${HYP_DOC}'s go/no-go table reads it by name.`);
}

main();
