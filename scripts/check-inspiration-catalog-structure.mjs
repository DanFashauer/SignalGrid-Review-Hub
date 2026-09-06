#!/usr/bin/env node
// Inspiration catalog structure — a stated total, a row-wise-URL claim, a constant
// column and a duplicated product name, judged against the ROWS THEMSELVES.
//
//   node scripts/check-inspiration-catalog-structure.mjs             check (writes nothing, fetches nothing)
//   node scripts/check-inspiration-catalog-structure.mjs --self-test prove the check can fail
//
// WHY THIS EXISTS. Two full reads of docs/inspiration on 2026-09-06 found the same
// four shapes of defect, in catalogs no gate had ever parsed:
//   · a section header saying "61 entries · source URLs included row-wise" over 61
//     rows that carry no URL in either URL column, and no vendor, product or note;
//   · "79 entries · source URLs included row-wise" where 10 of the 79 carry a
//     repository URL and 69 carry a bare slug;
//   · 13 of 20 columns holding ONE value for every vendor in an ecosystem, under a
//     provenance line calling the distinction "preserved and load-bearing";
//   · one product filed twice with opposite values in the field the document itself
//     calls binding (AVEVA PI System: `public documented` on one row,
//     `registration required` on the other).
// Every one of them is checkable from the table beneath the sentence. None of them
// needs an opinion about a vendor, and none of them needs the network.
//
// WHAT IS GATED (unambiguous only; a ✗ here exits 1):
//   (a) A stated total — "N entries", "N rows", "products and platforms: N",
//       "candidate …: N" — that is BOUND to exactly one table (it is a caption row
//       inside the table's own block, or it sits within 3 lines above / 2 lines
//       below that table inside the same heading section) must equal that table's
//       data-row count. Only the figure in the line's FIRST sentence is read as a
//       whole-table total; a figure after a clause break (". " "; " "· " ", ") or
//       after "of" is a subset claim ("Cisco is split into 5 rows", "79 entries ·
//       10 rows carry a repository URL") and is REPORTED, never gated — flagging
//       either of those sentences would be flagging the truth.
//   (b) A bound line claiming source URLs are carried ROW-WISE over a table where
//       some row carries a URL in none of its URL-headed columns. Exempt when the
//       claim STATES THE MEASURED COUNT next to the URL noun ("0 source URLs",
//       "10 carry a repository URL") and that figure is the measured one — the
//       honest idiom is the fix, so the gate must recognise it.
//   (c) A column constant across every row of a group of ≥ 20 rows, WHEN prose in
//       that heading section calls that column a per-vendor/per-product
//       distinction and no disclosure line ("ecosystem template", "ecosystem
//       default", "not a per-vendor fact") precedes the table. Otherwise REPORTED.
//   (d) Exact duplicate product names inside one catalog whose rows disagree in a
//       column the section prose marks "decisive" or "load-bearing". A duplicate
//       with no such column, or one whose decisive values agree, is REPORTED.
//
// WHAT IS REPORTED, never gated, and said out loud on every run:
//   · every stated total that binds to no single table (a "Catalog totals" bullet
//     block has no table beneath it; "products and platforms: 151" is a claim about
//     the whole document, and which tables it sums is not derivable from the page);
//   · every constant column and every duplicate product name that misses the fatal
//     condition above — they are variance and judgement, not defects on their face;
//   · a subset figure, a "~" figure, and a figure the sentence dates as a
//     measurement ("measured 2026-09-06", "unverified 2026-09-06") — a dated
//     measurement is a record of a day, not a claim about today.
//
// WHAT THIS MUST NEVER DO:
//   · judge a vendor fact. Whether `github.com/MotorolaMobilityLLC` is Motorola
//     Solutions' org is not decidable from the page and is not this gate's business.
//   · fetch anything. The self-test asserts this file contains no network call —
//     a gate whose verdict depends on a proxy is a flaky gate.
//   · overrule a VERBATIM IMPORT. A document carrying an
//     `<!-- … verbatim import … -->` marker may not be edited row by row, so every
//     finding in it is REPORTED with the marker's own line printed as the reason.
//
// FLOORS (a gate scanning nothing is green about nothing): ≥ 8 catalogs parsed,
// ≥ 2000 data rows parsed, ≥ 20 stated totals found, and a synthetic catalog
// carrying one planted violation of each rule must be flagged on every live run.
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SELF_TEST = process.argv.includes("--self-test");
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = "docs/inspiration";
export const FLOOR_CATALOGS = 8;
export const FLOOR_ROWS = 2000;
export const FLOOR_TOTALS = 20;
export const GROUP_MIN = 20;

export const VERBATIM_MARKER = /<!--[^>]*\bverbatim import\b[^>]*-->/i;
// A cell value that names nothing — never a duplicate, never a constant worth reporting.
const PLACEHOLDER = /^(|—|–|-|n\/a|na|none|tbd|unknown.*|not applicable)$/i;
const PER_VENDOR = /per[-\s]vendor|per[-\s]product|per[-\s]row|each vendor|each product|varies by (vendor|product|row)|row by row/i;
// The HONEST IDIOM. A page that says out loud "this column is one template string
// on every row, not a per-vendor finding" has done the right thing and must never
// be flagged for saying so. These are the words the docs actually use — the live
// pass flagged docs/inspiration/ASSET_MANAGEMENT_IT_GOVERNANCE_API_CATALOG.md:109
// and :436, which are model disclosures, and the gate was what was wrong.
const DISCLOSURE = /column disclosure|ecosystem template|ecosystem default|section[-\s]level (value|default)|constant across (the |every )?rows?|not a per[-\s]vendor (fact|finding|claim|measurement|statement)|\bis a template\b|template[^.]{0,60}\bevery row\b|holds? (one|a single) (constant )?(string|value)|one constant (string|value)|(one|a single) (constant )?(string|value) on every|empty in \d+ of \d+ rows?/i;
// A sentence that DENIES per-vendor variance is a disclosure, never the claim.
const NOT_PER_VENDOR = /\bnot a per[-\s]vendor\b|\bdoes not vary\b|\bnothing (else )?that varies\b|\bno per[-\s]vendor\b/i;
const DECISIVE = /\bdecisive\b|\bload[-\s]bearing\b/i;
const MEASURED = /\b(measured|as measured|as of|re-derived|counted|verified|unverified)\b/i;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/;
const APPROX = /~|≈|approximately|roughly|about \d|circa|±/i;

/* ---------------------------------------------------------------- parsing */

/** Fenced code blocks are not tables. Blanked, not removed, so line numbers hold. */
export function stripFences(text) {
  let fenced = false;
  return text.split("\n").map((l) => {
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; return ""; }
    return fenced ? "" : l;
  });
}

export const splitCells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
export const isSeparator = (line) => /^\s*\|[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
const nonEmpty = (cells) => cells.filter((c) => c !== "").length;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Tables of a document. A workbook export puts a TITLE row where markdown expects
 * the header ("|Physical Access||||"), then a caption row ("|61 entries · …|"),
 * then the real column header. So: when the row above the separator has fewer than
 * two populated cells it is a spanner, and the first row after the separator with
 * three or more populated cells is the effective header. Everything after that is
 * data, minus further separators, spanner rows and repeated header rows.
 * Returns { blockStart, dataStart, end, headerLine, headers, rows:[{line,cells}] }.
 */
export function parseTables(lines) {
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (!/^\s*\|/.test(lines[i])) { i += 1; continue; }
    let j = i;
    while (j < lines.length && /^\s*\|/.test(lines[j])) j += 1;
    const block = [];
    for (let k = i; k < j; k += 1) block.push({ line: k + 1, cells: splitCells(lines[k]), raw: lines[k] });
    const sepIdx = block.findIndex((b) => isSeparator(b.raw));
    if (sepIdx > 0) {
      let hdr = block[sepIdx - 1];
      let dataIdx = sepIdx + 1;
      if (nonEmpty(hdr.cells) < 2) {
        const h = block.slice(sepIdx + 1).findIndex((b) => nonEmpty(b.cells) >= 3);
        if (h >= 0) { hdr = block[sepIdx + 1 + h]; dataIdx = sepIdx + 2 + h; }
      }
      const key = hdr.cells.join("|");
      const rows = block.slice(dataIdx).filter(
        (b) => !isSeparator(b.raw) && nonEmpty(b.cells) > 0 && !(nonEmpty(b.cells) === 1 && b.cells.length >= 3) && b.cells.join("|") !== key,
      );
      tables.push({
        blockStart: block[0].line,
        dataStart: dataIdx < block.length ? block[dataIdx].line : block[block.length - 1].line + 1,
        end: block[block.length - 1].line,
        headerLine: hdr.line,
        headers: hdr.cells,
        rows,
      });
    }
    i = j;
  }
  return tables;
}

/** Heading sections, 1-based inclusive line ranges; index 0 is the preamble. */
export function headingSections(lines) {
  const out = [{ heading: "(preamble)", start: 1, end: lines.length }];
  lines.forEach((l, idx) => {
    if (!/^#{1,6}\s+\S/.test(l)) return;
    out[out.length - 1].end = idx;
    out.push({ heading: l.replace(/^#+\s*/, "").trim(), start: idx + 1, end: lines.length });
  });
  return out;
}
const sectionOf = (sections, line) => sections.find((s) => line >= s.start && line <= s.end) ?? sections[0];

/**
 * The one table a line speaks about, or null. A caption row inside a table's own
 * block binds to that table; otherwise the line must sit within 3 lines above the
 * block or 2 lines below it, in the same heading section. Anything else is a claim
 * whose scope is not derivable from the page, and is REPORTED rather than judged.
 */
export function bindTable(line, tables, sections) {
  const cap = tables.find((t) => line >= t.blockStart && line < t.dataStart);
  if (cap) return cap;
  if (tables.some((t) => line >= t.dataStart && line <= t.end)) return null; // a data row is not a claim about its own table
  const sec = sectionOf(sections, line);
  const near = tables.filter(
    (t) => sectionOf(sections, t.blockStart) === sec && ((line >= t.blockStart - 3 && line < t.blockStart) || (line > t.end && line <= t.end + 2)),
  );
  return near.length === 1 ? near[0] : null;
}

/* ------------------------------------------------------------ stated totals */

const TOTAL_PATTERNS = [
  { kind: "entries", re: /\b(\d{1,5})\s+entries\b/gi },
  { kind: "rows", re: /\b(\d{1,5})\s+rows?\b/gi },
  { kind: "products and platforms", re: /products and platforms\s*:\s*\*{0,2}(\d{1,5})\*{0,2}/gi },
  { kind: "candidate", re: /candidate[^:|.]{0,60}:\s*\*{0,2}(\d{1,5})\*{0,2}/gi },
];

/**
 * Every stated total on one line, each flagged `whole` — in the line's FIRST clause
 * (no ". " "; " "· " or ", " before it) and not introduced by "of"/"than"/"up to".
 * A figure that is not `whole` is a subset claim ("79 entries · 10 rows carry a
 * repository URL"); the gate reports it and never judges it.
 */
export function totalsOnLine(text, line) {
  const out = [];
  for (const { kind, re } of TOTAL_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const before = text.slice(0, m.index);
      const firstSentence = !/[.;·,]\s/.test(before) && !/[.;·,]$/.test(before.trim());
      const restrictive = /\b(of|than|up to|over|under|only|excluding|including)\s*$/i.test(before.replace(/[`*"'\s]+$/, " ").trimEnd() + " ");
      out.push({ kind, value: Number(m[1]), line, at: m.index, text, whole: firstSentence && !restrictive });
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind));
}

/**
 * A dated measurement or an explicit approximation is a record, not a claim about
 * today — but only when the hedge is NEAR the figure. A 900-word verification note
 * that happens to contain a date somewhere must not buy an exemption for a count
 * written at its other end.
 */
export const HEDGE_WINDOW = 60;
export function isHedged(text, at = 0) {
  const w = text.slice(Math.max(0, at - HEDGE_WINDOW), at + HEDGE_WINDOW);
  return APPROX.test(w) || (MEASURED.test(w) && ISO_DATE.test(w));
}

/* --------------------------------------------------------- row-wise URL claim */

// The CLAIM, not the phrase. "I state per row whether I additionally read the body"
// is a methods sentence about per-row honesty and must never be read as a promise
// that every row carries a URL — flagging it would be flagging the truth (OT lines
// 111 and 242 were exactly that false positive on the first live pass).
export const ROWWISE = (text) =>
  /\burls?\b[^.;|]{0,24}\b(included|carried|provided|listed|given|present)\b[^.;|]{0,24}\b(row-wise|per[-\s]row|row by row)\b/i.test(text) ||
  /\b(row-wise|per-row)\s+(source |docs? |official )?urls?\b/i.test(text); // the adjectival form, directly attached
const urlColumns = (headers) => headers.map((h, i) => (/\burl\b|\blink\b/i.test(h) ? i : -1)).filter((i) => i >= 0);
const hasUrl = (cell) => /https?:\/\//i.test(cell ?? "");

/** Rows carrying no URL in any URL-headed column (or in any cell, when no column is URL-headed). */
export function rowsWithoutUrl(table) {
  const cols = urlColumns(table.headers);
  return table.rows.filter((r) => (cols.length > 0 ? !cols.some((c) => hasUrl(r.cells[c])) : !r.cells.some(hasUrl)));
}

/**
 * Does the claim state the measured figure? The number must sit beside the URL noun
 * — "0 source URLs", "10 carry a repository URL" — not merely somewhere on the line,
 * or "61 entries · source URLs included row-wise" would exempt itself.
 */
export function statesMeasuredUrlCount(text, withUrl, without) {
  const found = [];
  // Digits are allowed inside the gap so the "N of M rows carry a source URL" idiom
  // reaches its own N; the separator characters (· , ; .) still are not, or
  // "61 entries · source URLs included row-wise" would exempt itself.
  for (const m of text.matchAll(/\b(\d{1,5})([A-Za-z0-9 ()%/-]{0,32}?)\burls?\b/gi)) found.push(Number(m[1]));
  for (const m of text.matchAll(/\burls?\b([A-Za-z0-9 ()%/-]{0,32}?)\b(\d{1,5})\b/gi)) found.push(Number(m[2]));
  return found.some((n) => n === withUrl || n === without);
}

/* ------------------------------------------------------- columns and duplicates */

/** Groups of ≥ GROUP_MIN rows: the whole table, and per-value groups of an "Ecosystem" column. */
export function rowGroups(table) {
  const groups = [];
  if (table.rows.length >= GROUP_MIN) groups.push({ name: "table", rows: table.rows });
  const eco = table.headers.findIndex((h) => norm(h) === "ecosystem");
  if (eco >= 0) {
    const by = new Map();
    for (const r of table.rows) {
      const k = r.cells[eco] ?? "";
      if (PLACEHOLDER.test(k)) continue;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
    if (by.size > 1) for (const [k, rows] of by) if (rows.length >= GROUP_MIN) groups.push({ name: `ecosystem "${k}"`, rows, cutBy: eco });
  }
  return groups;
}

/** Column indexes holding one identical non-placeholder value across every row of the group. */
export function constantColumns(headers, rows, skip = -1) {
  const out = [];
  if (rows.length === 0) return out;
  for (let c = 0; c < headers.length; c += 1) {
    if (c === skip) continue; // the column a group was CUT BY is constant by construction, never a finding
    if (PLACEHOLDER.test(headers[c] ?? "")) continue;
    const first = rows[0].cells[c] ?? "";
    if (PLACEHOLDER.test(first)) continue;
    if (rows.every((r) => (r.cells[c] ?? "") === first)) out.push({ col: c, header: headers[c], value: first });
  }
  return out;
}

/** The column holding the product NAME. A "Official Product / Catalog URL" column is not one. */
export const productColumn = (headers) => {
  const named = (re) => headers.findIndex((h) => re.test(h) && !/\burl\b|\blink\b/i.test(h));
  const i = named(/\bproducts?\b/i);
  return i >= 0 ? i : named(/^(app|application|mobile app)\b/i);
};

/** Prose lines (not table rows) of a heading section. */
function sectionProse(lines, sec, tables) {
  const inTable = (n) => tables.some((t) => n >= t.blockStart && n <= t.end);
  const out = [];
  for (let n = sec.start; n <= sec.end && n <= lines.length; n += 1) if (!inTable(n)) out.push({ line: n, text: lines[n - 1] });
  return out;
}

/* ------------------------------------------------------------------- audit */

const F = (rule, doc, line, fatal, message) => ({ rule, doc, line, fatal, message });

/** Pure over one document. Returns { doc, verbatim, rows, tables, totals, findings }. */
export function auditCatalog(doc, text) {
  const lines = stripFences(text);
  const tables = parseTables(lines);
  const sections = headingSections(lines);
  const verbatimLine = lines.findIndex((l) => VERBATIM_MARKER.test(l));
  const verbatim = verbatimLine >= 0 ? { line: verbatimLine + 1, text: lines[verbatimLine].trim() } : null;
  const findings = [];
  const rows = tables.reduce((a, t) => a + t.rows.length, 0);
  let totals = 0;

  // (a) stated totals, and (b) row-wise URL claims — both read a line, both bind to one table.
  for (let n = 1; n <= lines.length; n += 1) {
    const raw = lines[n - 1];
    if (raw.trim() === "") continue;
    const isDataRow = tables.some((t) => n >= t.dataStart && n <= t.end);
    const found = isDataRow ? [] : totalsOnLine(raw, n);
    totals += found.length;
    const bound = found.length > 0 || (!isDataRow && ROWWISE(raw)) ? bindTable(n, tables, sections) : null;
    for (const t of found) {
      const where = `"${t.value} ${t.kind}"`;
      if (!bound) { findings.push(F("total", doc, n, false, `${where} binds to no single table (no table within 3 lines above / 2 below it in its section) — REPORTED, not derivable from the page`)); continue; }
      if (!t.whole) { findings.push(F("total", doc, n, false, `${where} is a subset figure (after a sentence break or "of") over the table at line ${bound.headerLine} (${bound.rows.length} rows) — REPORTED, never judged`)); continue; }
      if (isHedged(t.text, t.at)) { findings.push(F("total", doc, n, false, `${where} is dated as a measurement or approximate; table at line ${bound.headerLine} has ${bound.rows.length} rows — REPORTED`)); continue; }
      if (t.value !== bound.rows.length) findings.push(F("total", doc, n, true, `${where} but the table it heads (header line ${bound.headerLine}) has ${bound.rows.length} data rows`));
    }
    if (!isDataRow && ROWWISE(raw)) {
      if (!bound) { findings.push(F("rowwise-url", doc, n, false, "a row-wise source-URL claim that binds to no single table — REPORTED")); continue; }
      const missing = rowsWithoutUrl(bound);
      const withUrl = bound.rows.length - missing.length;
      if (missing.length === 0) continue;
      const stated = statesMeasuredUrlCount(raw, withUrl, missing.length);
      const detail = `${missing.length} of ${bound.rows.length} row(s) under it carry a URL in none of their URL columns (first at line ${missing[0].line}); ${withUrl} carry one`;
      if (stated) findings.push(F("rowwise-url", doc, n, false, `row-wise URL claim states its measured count — ${detail} — REPORTED`));
      else findings.push(F("rowwise-url", doc, n, true, `claims source URLs row-wise, but ${detail}. State the measured count in the header ("${withUrl} source URLs") or carry the URLs`));
    }
  }

  // (c) constant columns
  for (const t of tables) {
    const sec = sectionOf(sections, t.blockStart);
    const prose = sectionProse(lines, sec, tables);
    const disclosed = prose.some((p) => p.line < t.blockStart && DISCLOSURE.test(p.text));
    for (const g of rowGroups(t)) {
      for (const c of constantColumns(t.headers, g.rows, g.cutBy ?? -1)) {
        const claim = prose.find((p) => norm(p.text).includes(norm(c.header)) && PER_VENDOR.test(p.text) && !DISCLOSURE.test(p.text) && !NOT_PER_VENDOR.test(p.text));
        const head = `column "${c.header}" is one value for all ${g.rows.length} rows of ${g.name} (table at line ${t.headerLine}): "${c.value.slice(0, 60)}"`;
        if (claim && !disclosed) findings.push(F("constant-column", doc, t.headerLine, true, `${head} — yet line ${claim.line} of this section calls it a per-vendor distinction and no "ecosystem template" disclosure precedes the table`));
        else findings.push(F("constant-column", doc, t.headerLine, false, `${head}${disclosed ? " (disclosed as a template above the table)" : ""} — REPORTED, not judged`));
      }
    }
  }

  // (d) duplicate product names
  const byName = new Map();
  for (const t of tables) {
    const pc = productColumn(t.headers);
    if (pc < 0) continue;
    for (const r of t.rows) {
      const name = (r.cells[pc] ?? "").replace(/[*`]/g, "").trim();
      if (PLACEHOLDER.test(name) || name.length < 2) continue;
      const k = name.toLowerCase();
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push({ name, row: r, table: t });
    }
  }
  for (const [, hits] of byName) {
    if (hits.length < 2) continue;
    const at = hits.map((h) => h.row.line).join(", ");
    const spread = new Set(hits.map((h) => h.table.headerLine)).size > 1 ? "across different tables (often two views of one catalog)" : "in one table";
    let fatal = null;
    for (const h of hits) {
      const sec = sectionOf(sections, h.table.blockStart);
      const prose = sectionProse(lines, sec, tables);
      for (let c = 0; c < h.table.headers.length; c += 1) {
        const hdr = h.table.headers[c];
        if (PLACEHOLDER.test(hdr ?? "")) continue;
        const marks = prose.find((p) => DECISIVE.test(p.text) && norm(p.text).includes(norm(hdr)));
        if (!marks) continue;
        const values = new Set(hits.map((x) => {
          const ci = x.table.headers.findIndex((y) => norm(y) === norm(hdr));
          return ci >= 0 ? (x.row.cells[ci] ?? "") : "";
        }));
        if (values.size > 1) fatal = { hdr, marks, values: [...values] };
      }
    }
    if (fatal) findings.push(F("duplicate-product", doc, hits[0].row.line, true, `"${hits[0].name}" is filed on lines ${at} with different values in "${fatal.hdr}" (${fatal.values.map((v) => `"${v.slice(0, 40)}"`).join(" vs ")}), a column line ${fatal.marks.line} marks decisive/load-bearing`));
    else findings.push(F("duplicate-product", doc, hits[0].row.line, false, `"${hits[0].name}" appears on lines ${at} ${spread} — REPORTED (no column this section marks decisive disagrees)`));
  }

  if (verbatim) for (const f of findings) if (f.fatal) { f.fatal = false; f.downgraded = verbatim; }
  return { doc, verbatim, rows, tables: tables.length, totals, findings };
}

/** Pure over the corpus. `read` returns text or null; null is FATAL, never a pass. */
export function auditAll(docs, read) {
  const results = [];
  const unreadable = [];
  for (const doc of docs) {
    const text = read(doc);
    if (text === null || text === undefined) { unreadable.push(doc); continue; }
    const r = auditCatalog(doc, text);
    if (r.tables > 0) results.push(r);
  }
  const rows = results.reduce((a, r) => a + r.rows, 0);
  const totals = results.reduce((a, r) => a + r.totals, 0);
  const findings = results.flatMap((r) => r.findings);
  const floors = [];
  if (unreadable.length > 0) floors.push(`${unreadable.length} listed document(s) could not be read: ${unreadable.join(", ")} — fail-closed, never a pass`);
  if (results.length < FLOOR_CATALOGS) floors.push(`only ${results.length} catalog(s) with tables parsed, floor is ${FLOOR_CATALOGS} — the derivation has drifted`);
  if (rows < FLOOR_ROWS) floors.push(`only ${rows} data row(s) parsed, floor is ${FLOOR_ROWS} — the table parser is finding nothing`);
  if (totals < FLOOR_TOTALS) floors.push(`only ${totals} stated total(s) found, floor is ${FLOOR_TOTALS} — the total parser is finding nothing`);
  return { results, rows, totals, findings, floors, catalogs: results.length };
}

/* ---------------------------------------------------------------- self-test */

const T = (...rows) => rows.join("\n");
const SYNTH_TABLE = T(
  "| Vendor | Product / Platform | Access class | Official Docs URL |",
  "| --- | --- | --- | --- |",
  "| A Corp | Alpha | public | https://a.example/docs |",
  "| B Corp | Beta | gated | https://b.example/docs |",
  "| C Corp | Gamma | public | https://c.example/docs |",
);

/** A synthetic catalog carrying one planted violation of each rule; re-run live. */
export const SYNTHETIC = T(
  "# Synthetic",
  "",
  "## Sheet",
  "",
  "9 entries · source URLs included row-wise.",
  SYNTH_TABLE.replace("| C Corp | Gamma | public | https://c.example/docs |", "| C Corp | Gamma | public |  |"),
);
export const SYNTHETIC_EXPECT = ["total", "rowwise-url"];

function bigTable(n, constantCell = "one value") {
  const rows = ["| Vendor | Product / Platform | API Style | Official Docs URL |", "| --- | --- | --- | --- |"];
  for (let i = 0; i < n; i += 1) rows.push(`| V${i} | P${i} | ${constantCell} | https://v${i}.example/docs |`);
  return rows.join("\n");
}

function selfTest() {
  const checks = [];
  const one = (text) => auditCatalog("f.md", text);
  const fatals = (r) => r.findings.filter((f) => f.fatal);
  const reported = (r) => r.findings.filter((f) => !f.fatal);
  const of = (r, rule) => r.findings.filter((f) => f.rule === rule);
  // Null-safe: a GUTTED gate must produce clean FAIL lines, not a TypeError.
  const msg = (list, i = 0) => list[i]?.message ?? "(no finding)";

  // parser
  let r = one(T("# D", "", "## S", "", SYNTH_TABLE));
  checks.push(["a plain markdown table parses: 3 data rows, header row excluded", r.rows === 3 && r.tables === 1]);
  r = one(T("# D", "", "## S", "", "|Sheet Title|||", "|---|---|---|", "|2 entries · note.|||", "|Vendor|Product / Platform|Official Docs URL|", "|A|Alpha|https://a.example/|", "|B|Beta|https://b.example/|"));
  checks.push(["a workbook export (title spanner + caption + real header) parses 2 data rows, not 4", r.rows === 2 && fatals(r).length === 0]);
  r = one(T("# D", "", "## S", "", "```", "| not | a | table |", "| --- | --- | --- |", "| x | y | z |", "```", SYNTH_TABLE));
  checks.push(["a table inside a fenced block is not parsed", r.tables === 1 && r.rows === 3]);

  // (a) totals
  r = one(T("# D", "", "## S", "", "3 entries · listed below.", SYNTH_TABLE));
  checks.push(["a caption whose count matches the rows beneath it passes", fatals(r).length === 0]);
  r = one(T("# D", "", "## S", "", "5 entries · listed below.", SYNTH_TABLE));
  checks.push(["PLANT: a caption claiming 5 entries over 3 rows is FATAL and names both figures", fatals(r).length === 1 && (fatals(r)[0]?.rule ?? "") === "total" && /5 entries/.test(msg(fatals(r))) && /3 data rows/.test(msg(fatals(r)))]);
  r = one(T("# D", "", "## S", "", "|Sheet|||||", "|---|---|---|---|---|", "|5 entries · note.|||||", "|Vendor|Product / Platform|Access class|Official Docs URL|", "|A|Alpha|public|https://a.example/|", "|B|Beta|gated|https://b.example/|"));
  checks.push(["PLANT: the caption ROW inside a workbook block is bound to its own table and fails", fatals(r).length === 1 && (fatals(r)[0]?.line ?? -1) === 7 && /2 data rows/.test(msg(fatals(r)))]);
  r = one(T("# D", "", "## S", "", "~5 entries · listed below.", SYNTH_TABLE));
  checks.push(["a \"~\" figure is REPORTED, never fatal — an approximation is not a claim", fatals(r).length === 0 && of(r, "total").length === 1]);
  r = one(T("# D", "", "## S", "", "5 entries, measured 2026-09-06.", SYNTH_TABLE));
  checks.push(["a figure dated as a measurement is REPORTED, never fatal", fatals(r).length === 0 && /dated as a measurement/.test(msg(of(r, "total")))]);
  r = one(T("# D", "", "## S", "", SYNTH_TABLE, "*Notes — 3 rows filed. Cisco is split into 5 rows because it ships three products.*"));
  checks.push(["a footer note binds to the table above: the headline 3 holds and the subset \"5 rows\" is REPORTED, not judged", fatals(r).length === 0 && of(r, "total").some((f) => /subset figure/.test(f.message))]);
  r = one(T("# D", "", "## S", "", "|Sheet|||||", "|---|---|---|---|---|", "|2 entries · 1 row carries a repository URL, 1 carries a slug only.|||||", "|Vendor|Product / Platform|Access class|Official Docs URL|", "|A|Alpha|public|https://a.example/|", "|B|Beta|public||"));
  checks.push(["the audit's own recommended fix (\"2 entries · 1 row carries a repository URL\") passes: the headline figure is gated, the subset after \"·\" is REPORTED", fatals(r).length === 0 && of(r, "total").some((f) => /subset figure/.test(f.message))]);
  r = one(T("# D", "", "## S", "", SYNTH_TABLE, "*Notes — 4 rows filed.*"));
  checks.push(["PLANT: a footer note miscounting the table above it is FATAL", fatals(r).length === 1 && /4 rows/.test(msg(fatals(r)))]);
  r = one(T("# D", "", "## Catalog totals", "", "- products and platforms: **151**", "", "## Sheet", "", SYNTH_TABLE));
  checks.push(["a totals bullet with no table beneath it is REPORTED as underivable, never guessed at", fatals(r).length === 0 && /binds to no single table/.test(msg(of(r, "total")))]);
  r = one(T("# D", "", "## S", "", "> and 134 rows — the MDM block — carry a docs URL", "", "", "", SYNTH_TABLE));
  checks.push(["a preamble sentence four lines above a table does not bind to it", fatals(r).length === 0]);
  r = one(T("# D", "", "## S", "", SYNTH_TABLE.replace("| A Corp | Alpha | public | https://a.example/docs |", "| A Corp | Alpha 3 rows | public | https://a.example/docs |")));
  checks.push(["a figure inside a DATA row is never read as a total about its own table", of(r, "total").length === 0]);

  // (b) row-wise URL claims
  r = one(T("# D", "", "## S", "", "3 entries · source URLs included row-wise.", SYNTH_TABLE));
  checks.push(["a row-wise URL claim over a table where every row carries one passes", fatals(r).length === 0 && of(r, "rowwise-url").length === 0]);
  const holed = SYNTH_TABLE.replace("| C Corp | Gamma | public | https://c.example/docs |", "| C Corp | Gamma | public |  |");
  r = one(T("# D", "", "## S", "", "3 entries · source URLs included row-wise.", holed));
  checks.push(["PLANT: one row with no URL under a row-wise claim is FATAL and names the row", fatals(r).length === 1 && (fatals(r)[0]?.rule ?? "") === "rowwise-url" && /first at line 10/.test(msg(fatals(r)))]);
  r = one(T("# D", "", "## S", "", "3 entries · 2 source URLs, carried row-wise.", holed));
  checks.push(["stating the measured count (\"2 source URLs\") next to the URL noun downgrades it to REPORTED", fatals(r).length === 0 && /states its measured count/.test(msg(of(r, "rowwise-url")))]);
  r = one(T("# D", "", "## S", "", "3 entries · source URLs included row-wise.", holed.replace("| C Corp | Gamma | public |  |", "| C Corp | Gamma | public |  |").replace("Official Docs URL", "Official Docs URL")));
  checks.push(["the count in \"3 entries\" does NOT exempt the URL claim — the figure must sit beside the URL noun", fatals(r).length === 1]);
  r = one(T("# D", "", "## S", "", "|Sheet|||||", "|---|---|---|---|---|", "|3 entries · 2 of 3 rows carry a source URL (measured 2026-09-06; the sheet's own header said \"source URLs included row-wise\") — 1 row carries none.|||||", "|Vendor|Product / Platform|Access class|Official Docs URL|", "|A|Alpha|public|https://a.example/|", "|B|Beta|public|https://b.example/|", "|C|Gamma|public||"));
  checks.push(["the \"N of M rows carry a source URL\" fix, QUOTING the old claim it replaces, is REPORTED — a header that measures itself is the fix, not the defect", fatals(r).length === 0 && /states its measured count/.test(msg(of(r, "rowwise-url")))]);
  checks.push(["the measured-count reader reaches N across the live idiom \"6 of 37 rows carry a source URL\"", statesMeasuredUrlCount("|37 entries · 6 of 37 rows carry a source URL (measured 2026-09-06) — 31 rows are placeholders|", 6, 31) === true]);
  checks.push(["and it does NOT reach across a \"·\" separator, so \"61 entries · source URLs included row-wise\" cannot exempt itself", statesMeasuredUrlCount("|61 entries · source URLs included row-wise|", 0, 61) === false]);
  r = one(T("# D", "", "## S", "", "61 rows, 0 source URLs — the identities live in the sibling catalog.", holed));
  checks.push(["the honest fix (\"0 source URLs\") is recognised even when the row count is wrong for another reason", of(r, "rowwise-url").every((f) => !f.fatal)]);

  r = one(T("# D", "", "## S", "", "I state per row whether I additionally READ the body of each docs URL.", holed));
  checks.push(["a methods sentence (\"per row … each docs URL\") is NOT a row-wise-URL claim — the live pass flagged two of these and they were honest writing", of(r, "rowwise-url").length === 0]);
  r = one(T("# D", "", "## S", "", "Provenance: per-row source URLs.", holed));
  checks.push(["PLANT: the same table under a real per-row URL claim IS flagged — the tightening did not disarm the rule", fatals(r).length === 1 && (fatals(r)[0]?.rule ?? "") === "rowwise-url"]);

  // hedge proximity
  r = one(T("# D", "", "## S", "", `*Notes — 4 rows filed. ${"Method text that says nothing about the count. ".repeat(4)}Fetched and verified 2026-09-06.*`, SYNTH_TABLE));
  checks.push(["PLANT: a date at the far end of a long note does not hedge a miscount at the other end", fatals(r).length === 1 && (fatals(r)[0]?.rule ?? "") === "total"]);
  r = one(T("# D", "", "## S", "", "*Notes — 4 rows filed, measured 2026-09-06.*", SYNTH_TABLE));
  checks.push(["the same miscount with the date BESIDE it is REPORTED as a dated measurement", fatals(r).length === 0]);

  // the product column is a name column, never a URL column
  r = one(T("# D", "", "## S", "", "| Vendor | Official Product URL |", "| --- | --- |", "| A | https://x.example/ |", "| B | https://x.example/ |"));
  checks.push(["a \"Official Product URL\" column is not the product-NAME column — two rows sharing a URL are not duplicate products", of(r, "duplicate-product").length === 0]);

  // (c) constant columns
  r = one(T("# D", "", "## S", "", bigTable(20)));
  checks.push(["a column constant over 20 rows with no per-vendor prose is REPORTED, never fatal", fatals(r).length === 0 && of(r, "constant-column").length === 1]);
  r = one(T("# D", "", "## S", "", bigTable(19)));
  checks.push(["the same constancy under the 20-row group floor is not reported at all", of(r, "constant-column").length === 0]);
  r = one(T("# D", "", "## S", "", "The API Style column is a per-vendor distinction and is preserved.", "", bigTable(20)));
  checks.push(["PLANT: prose calling that column a per-vendor distinction makes the constancy FATAL", fatals(r).length === 1 && (fatals(r)[0]?.rule ?? "") === "constant-column" && /per-vendor distinction/.test(msg(fatals(r)))]);
  r = one(T("# D", "", "## S", "", "> Column disclosure (measured 2026-09-06): the 'API Style' column holds ONE string on every one of the 20 rows. It is a template the generator stamped on every row, not a per-vendor finding; do not plan a connector's auth from it.", "", bigTable(20, "one value")));
  checks.push(["the live disclosure idiom (\"holds ONE string on every one of the … rows … not a per-vendor finding\") is REPORTED, never flagged — the first live pass flagged two of these and the GATE was what was wrong", fatals(r).length === 0 && /disclosed as a template/.test(msg(of(r, "constant-column")))]);
  r = one(T("# D", "", "## S", "", "> The matrix adds 'API Style' and nothing else that varies per vendor.", "", bigTable(20)));
  checks.push(["a sentence DENYING per-vendor variance is a disclosure, not a per-vendor claim", fatals(r).length === 0]);
  r = one(T("# D", "", "## S", "", "The API Style column is a per-vendor distinction and is preserved.", "Six columns below are an ecosystem template, not per-vendor facts.", "", bigTable(20)));
  checks.push(["an \"ecosystem template\" disclosure before the table returns it to REPORTED", fatals(r).length === 0 && /disclosed as a template/.test(msg(of(r, "constant-column")))]);
  r = one(T("# D", "", "## S", "", "|Sheet||||", "|---|---|---|---|", "|Ecosystem|Vendor|Product / Platform|API Style|", ...Array.from({ length: 20 }, (_, i) => `|Eco A|V${i}|P${i}|one value|`), ...Array.from({ length: 20 }, (_, i) => `|Eco B|W${i}|Q${i}|other value|`)));
  checks.push(["per-ecosystem groups are derived from the Ecosystem column: two 20-row groups, each constant in API Style, and the grouping column itself is not reported", of(r, "constant-column").filter((f) => /ecosystem "/.test(f.message)).length === 2 && of(r, "constant-column").every((f) => !/column "Ecosystem"/.test(f.message))]);

  // (d) duplicate product names
  const dup = T("| Vendor | Product / Platform | API access class |", "| --- | --- | --- |", "| Cisco | SEA | public documented |", "| Cisco | SEA | registration required |");
  r = one(T("# D", "", "## S", "", dup));
  checks.push(["a duplicate product name with no decisive column is REPORTED with both line numbers", fatals(r).length === 0 && /lines 7, 8/.test(msg(of(r, "duplicate-product")))]);
  r = one(T("# D", "", "## S", "", "The API access class is decisive and binding.", "", dup));
  checks.push(["PLANT: the same duplicate disagreeing in a column the section marks decisive is FATAL", fatals(r).length === 1 && (fatals(r)[0]?.rule ?? "") === "duplicate-product" && /public documented/.test(msg(fatals(r)))]);
  r = one(T("# D", "", "## S", "", "The API access class is decisive and binding.", "", dup.replace("| Cisco | SEA | registration required |", "| Cisco | SEA | public documented |")));
  checks.push(["a duplicate that AGREES in the decisive column is REPORTED only — agreement is not a defect", fatals(r).length === 0 && of(r, "duplicate-product").length === 1]);
  r = one(T("# D", "", "## S", "", "| Vendor | Product / Platform |", "| --- | --- |", "| A | Unknown / Open ecosystem |", "| B | Unknown / Open ecosystem |", "| C | — |", "| D | — |"));
  checks.push(["placeholder product cells (\"Unknown / Open ecosystem\", \"—\") are never duplicates", of(r, "duplicate-product").length === 0]);

  // verbatim import
  r = one(T("<!-- cited-symbols: verbatim import, drift recorded in the preamble (measured 2026-09-06) -->", "# D", "", "## S", "", "5 entries · listed below.", SYNTH_TABLE));
  checks.push(["PLANT under a verbatim-import marker: still FOUND, downgraded to REPORTED, marker line named", fatals(r).length === 0 && r.findings.some((f) => f.downgraded?.line === 1 && /verbatim import/.test(f.downgraded.text)) && r.verbatim?.line === 1]);

  // floors and fail-closed
  let a = auditAll(["a.md", "b.md"], () => T("# D", "", "## S", "", SYNTH_TABLE));
  checks.push(["the catalog floor fires when the corpus shrinks", a.floors.some((f) => /catalog\(s\) with tables/.test(f))]);
  checks.push(["the row floor fires when the parser finds almost nothing", a.floors.some((f) => /data row\(s\) parsed/.test(f))]);
  checks.push(["the stated-total floor fires when no totals are found", a.floors.some((f) => /stated total\(s\) found/.test(f))]);
  a = auditAll(["a.md"], () => null);
  checks.push(["an unreadable document is FATAL, never skipped silently", a.floors.some((f) => /could not be read/.test(f))]);

  // the live self-check, and the no-network property
  const synth = auditCatalog("synthetic", SYNTHETIC).findings.filter((f) => f.fatal).map((f) => f.rule);
  checks.push(["the synthetic catalog re-run on every live pass is flagged on every planted rule", SYNTHETIC_EXPECT.every((k) => synth.includes(k))]);
  // The LIVE path only — this self-test names the forbidden calls, so scanning it would match itself.
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const live = src.slice(0, src.indexOf("function selfTest("));
  checks.push(["this gate makes no network call in its live path — no fetch, no https client, no shelling out to a downloader", live.length > 1000 && !/\bfetch\s*\(|from ["']node:https?["']|require\(["']https?["']\)|\b(curl|wget)\b/.test(live)]);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.error(`\nSELF-TEST FAILED — ${bad} of ${checks.length} check(s). A gate that cannot flag a planted violation is green about nothing.`);
    return 1;
  }
  console.log(`\nSelf-test green — ${checks.length}/${checks.length}: parsing, totals, row-wise URL claims, constant columns, duplicates, the verbatim exemption, the floors and the no-network property all behave, in both directions.`);
  return 0;
}

/* --------------------------------------------------------------------- main */

const IS_MAIN = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (IS_MAIN) main();

function main() {
  if (SELF_TEST) process.exit(selfTest());

  // The scope is DERIVED from the tree, never hand-listed.
  let listed;
  try {
    listed = execFileSync("git", ["ls-files", DIR], { cwd: REPO, encoding: "utf8" }).split("\n").map((s) => s.trim()).filter((f) => f.endsWith(".md"));
  } catch (e) {
    console.error(`✗ could not list ${DIR} from git (${e.message}) — fail-closed: an unlistable scope is never a pass.`);
    process.exit(1);
  }
  if (listed.length === 0) {
    console.error(`✗ git lists no markdown under ${DIR} — fail-closed.`);
    process.exit(1);
  }
  const read = (f) => {
    const p = resolve(REPO, f);
    if (!existsSync(p)) return null;
    try { return readFileSync(p, "utf8"); } catch { return null; }
  };
  const a = auditAll(listed, read);

  // Live self-check: the derivation must still flag a synthetic violation of each rule.
  const synth = auditCatalog("(synthetic)", SYNTHETIC).findings.filter((f) => f.fatal).map((f) => f.rule);
  const missed = SYNTHETIC_EXPECT.filter((k) => !synth.includes(k));

  console.log("Inspiration catalog structure — stated totals, row-wise URL claims, constant columns and duplicate products, re-derived from the rows\n");
  console.log(`  ${a.catalogs} catalog(s) with tables of ${listed.length} tracked ${DIR} document(s); ${a.rows} data row(s) parsed; ${a.totals} stated total(s) read`);
  for (const r of a.results) {
    const fat = r.findings.filter((f) => f.fatal).length;
    const rep = r.findings.length - fat;
    console.log(`    · ${r.doc} — ${r.tables} table(s), ${r.rows} row(s), ${r.totals} total(s): GATED ${fat}, REPORTED ${rep}${r.verbatim ? "  [verbatim import — every finding REPORTED]" : ""}`);
    if (r.verbatim) console.log(`        marker, line ${r.verbatim.line}: ${r.verbatim.text}`);
  }
  console.log(`  synthetic self-check: planted ${SYNTHETIC_EXPECT.join(", ")} violation(s) flagged ${missed.length === 0 ? "— derivation moves" : `— MISSED ${missed.join(", ")}`}`);
  console.log("  this gate reads rows only: it judges no vendor fact and fetches nothing.");

  const fatal = a.findings.filter((f) => f.fatal);
  const rep = a.findings.filter((f) => !f.fatal);
  const byRule = (list) => {
    const m = new Map();
    for (const f of list) m.set(f.rule, (m.get(f.rule) ?? 0) + 1);
    return [...m].map(([k, v]) => `${k} ${v}`).join(", ") || "none";
  };
  console.log(`\n  REPORTED (never fatal) — ${rep.length}: ${byRule(rep)}`);
  const shown = new Map();
  for (const f of rep) {
    const k = `${f.doc}|${f.rule}`;
    const n = (shown.get(k) ?? 0) + 1;
    shown.set(k, n);
    if (n <= 6) console.log(`    · ${f.doc}:${f.line} [${f.rule}] ${f.message}${f.downgraded ? ` (downgraded: verbatim import, line ${f.downgraded.line})` : ""}`);
  }
  for (const [k, n] of shown) if (n > 6) console.log(`    · … ${n - 6} more ${k.split("|")[1]} in ${k.split("|")[0]}`);

  if (a.floors.length > 0) {
    console.error(`\n✗ Floors — the derivation cannot be trusted, so nothing here is a verdict:`);
    for (const f of a.floors) console.error(`    · ${f}`);
    process.exit(1);
  }
  if (missed.length > 0) {
    console.error(`\n✗ The synthetic self-check went quiet on ${missed.join(", ")} — the parse or the rules have drifted; a gate that cannot flag a planted violation proves nothing.`);
    process.exit(1);
  }
  if (fatal.length > 0) {
    console.error(`\n✗ GATED — ${fatal.length} violation(s): ${byRule(fatal)}`);
    for (const f of fatal) console.error(`    · ${f.doc}:${f.line} [${f.rule}] ${f.message}`);
    process.exit(1);
  }
  console.log(`\nInspiration catalog structure passed — ${a.rows} row(s) across ${a.catalogs} catalog(s); every bound total re-derives, every row-wise URL claim holds; ${rep.length} finding(s) REPORTED.`);
  process.exit(0);
}
