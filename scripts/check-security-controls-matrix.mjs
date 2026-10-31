// Security-controls-matrix status gate — a status word is a claim, and a claim
// needs something that can fail.
//
// WHY THIS EXISTS. docs/COMPANY_BUILD_PLAN.md row 49 made the questionnaire
// pack's denylist promise true, and left one residual: "SECURITY_CONTROLS_MATRIX's
// status column still has no drift gate". docs/SECURITY_CONTROLS_MATRIX.md is the
// page an assessor reads to learn what the public core ENFORCES. A row can say
// "Implemented (public core)" while the file it cites has been renamed or the
// proof it names deleted, and nothing noticed.
//
// WHAT IS GATED (hardened over many review rounds on PR #1349):
//   0. Structure. Every line carrying an unescaped `|` sits in a recognised
//      table (controls `| Control | … | Status | Where |`, the ONE Status legend,
//      or `| Short ref | Framework |`) — GFM renders pipe-less, blockquoted and
//      split rows too, so an unplaced row fails rather than vanishing. Each row's
//      cell count matches its header, and every table header is EXACT (no extra,
//      renamed or re-cased column; round 4). No link reference definitions, no
//      bare carriage returns, no repeated legend word (round 5). A Control
//      name carries no legend word, and neither it nor a Where cell carries
//      any of [ ] ! ~ \ < & (link, image, strikethrough, escape, HTML or
//      entity syntax; round 8). Both are allowlisted to printable ASCII plus
//      the exact non-ASCII characters the matrix uses there (round 9) — the
//      legend-word fold catches plain spellings; the allowlist catches every
//      invisible or look-alike character a fold list could miss. No HTML block, code fence, or whitespace-only
//      line that Markdown does not treat as blank (round 6); no raw HTML anywhere
//      outside a code span (round 29), spans found by CommonMark's same-length
//      pairing, and a line whose spans that rule cannot settle alone (an unpaired
//      run, a backslash before a backtick) fails; no run of three backticks or
//      tildes anywhere, so no fence behind a list or blockquote prefix (round 30).
//      A Framework refs cell holds only [A-Za-z0-9 .;,()/+-] and no claim
//      word; the Short ref table is pinned verbatim (round 7). The line
//      after a table is blank (GFM would render it as a row). No raw-HTML table
//      tags. Control names are unique as a reader sees them (case, whitespace,
//      entities, zero-width characters folded). The legend's words AND meanings
//      are pinned to EXPECTED_LEGEND / EXPECTED_MEANINGS.
//   1. The Status cell (bold markers stripped) is a legend word.
//   2. A row whose status reads "implement…" (the legend's Implemented word or
//      any other) must:
//      a. cite at least one repo path, every one a TRACKED and present REGULAR
//         file (index mode 100644/100755 — never a symlink or a gitlink) or a
//         directory of tracked files two or more segments deep — no `..`, no absolute
//         path, no untracked file, not the matrix itself; a path-like citation
//         the parser cannot read fails rather than being skipped (`lib/x/{a,b}.ts` braces expand; a `path:NN` anchor
//         must name an existing line of a tracked file that names the row's cited proof or
//         identifier — round 30; a bare `file.ts` resolves beside the cell's previous path,
//         else to the ONE tracked file of that basename, which must itself pass
//         every rule here — never the matrix, tracked AND present; `./x` is
//         root-relative, never a bare name — round 23);
//      b. be bound to a proof script that exists in package.json `scripts` and
//         resolves to the tracked source file it EXECUTES — each hop parsed as a whole
//         command, `pnpm --filter <pkg> run <name>` then exactly `node|tsx <file>`, so
//         `echo <file>` or a chain resolves to nothing (round 30): the row's own `proof:*` citation(s), else
//         the closing note's matrix-wide binding ("Everything marked Implemented
//         (public core) ... is exercised by `pnpm run proof:<x>`"). If that
//         sentence is gone, every row leaning on it fails (fail-closed). Every
//         bound proof, own or matrix-wide, must also be one a gating lane RUNS:
//         a `pnpm run <proof>` step in the --list-steps of scripts/preflight.mjs
//         or scripts/verify-breadth.mjs (both run in CI; preflight's parity with
//         CI is its own gate) — a proof nobody runs proves nothing (round 28). A
//         proof that self-skips without an env var (the parity gate's
//         --list-self-skipping-proofs) counts only where a workflow step runs
//         exactly `pnpm run <proof>` with that var a non-empty literal (the step's
//         own value wins over the job's), in a workflow triggered on push or
//         pull_request, from a job and step whose keys are all allowlisted (no `if`,
//         `needs`, `strategy`, `shell`, `continue-on-error` …) — a lane that skips
//         it never ran it (rounds 31–32). CEILING: whether that workflow is a
//         required check for merging is repository settings, not files. A
//         span that reads as a proof or a package-manager command (any case,
//         padding or prefix: `PROOF:x`, ` proof:x `, `npm run …`) must be exactly
//         `(pnpm run )?proof:<name>` or `pnpm install --frozen-lockfile`; any
//         other shape fails.
//   3. An "Automated (CI bot)" row's cited paths must be tracked too (it need
//      not cite one: several live in GitHub settings), under the same parser,
//      and any proof it cites must exist, resolve and run in a gating lane.
//   2a/3 citations: a slash-free `name.ext` is a path when `ext` is an extension
//      some tracked file has (`no-such.py`, `.rs`, `.toml` must resolve). CEILING:
//      a dotted identifier whose suffix no tracked file has (`ApiKeyRecord.token`,
//      `Connector.credentialRef`) is read as prose — the shapes are the same, so
//      only the tree can tell them apart; if a `.token` file is ever tracked such
//      identifiers become paths and fail (safe side) (round 28).
//   Rows: a table row starts at three or fewer spaces (four, or a tab, renders as
//      code), and every row must name its control (an empty Control cell fails).
//   4. A Control name cites nothing (it is never resolved). On every row it
//      fails on a proof- or command-like span, a span holding `/` (bar the exact
//      route tokens `/` and `/v1`), a span holding a letter-led dot (bar the
//      pinned CONTROL_SPAN_ALLOW), a span joined to a dot, `proof:` text once
//      `*` `_` and backticks are dropped, or an unclosed backtick. CEILINGS: an
//      extension-less file name (`Dockerfile`, `Makefile`) reads as a word and
//      passes; it cites nothing the gate resolves, and the row still needs a
//      real Where path. A digit-led extension (`x.7z`, `x.1`) is likewise read
//      as a version-like word, so `v1.2` passes. A dotted identifier
//      (`object.id`) fails, safe side, and so does a sentence-final period
//      straight after a span ("via `/v1`." fails): any backtick touching a dot
//      fails. A file name continued in plain text after a span with no dot
//      touching a backtick (the span `no-such` then "-x.ts") is un-backticked
//      prose, like a plain no-such.ts, and is not read (the un-backticked-
//      citation ceiling).
//
// KNOWN FAILURES. The matrix is an owner-gated surface (compliance docs in
// scripts/check-owner-gated-surfaces.mjs); this gate does not edit it. Rows the
// real matrix failed on the day the gate landed are listed in KNOWN_FAILURES by
// Control + exact Status + exact failure list, each absorbing ONE row, quoted on
// every run. A stale entry fails; any other failure on that row is new. Empty is
// the goal state; the owner decides how each is resolved.
//
// SELF-TEST (`--self-test`, also run first on every normal invocation): plant one
// defect per class above in a copy of the real doc — each must exit 1 with the row
// quoted — plus VALID controls that must not fail. The repository context (git
// index, package scripts, both lanes' step lists) is built ONCE and every case
// runs in-process; two cases spawn the CLI end to end (round 30).
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const DOC = "docs/SECURITY_CONTROLS_MATRIX.md";
const IMPLEMENTED = "Implemented (public core)";
const ROW_FLOOR = 40; // the parser must find the real rows; fewer means it broke

/** The legend, pinned (review round 2 of PR #1349). A word added to the legend
 *  would otherwise become a valid status that nothing path-checks; changing the
 *  legend now fails until this list — and the checks each word gets — are
 *  updated in the same change. */
const EXPECTED_LEGEND = [IMPLEMENTED, "Automated (CI bot)", "Private-core (planned)", "Human-owned (planned)"];
/** …and each word's Meaning, verbatim (review round 3): one edit to a meaning
 *  would otherwise raise the claim every row of that status makes. */
const EXPECTED_MEANINGS = new Map([
  [IMPLEMENTED, "Enforced today in the deterministic, fixture-backed `lib/signalgrid-core` and verified by the core proof."],
  ["Automated (CI bot)", "Owned by CI automation and GitHub-native scanning rather than by product code at runtime."],
  ["Private-core (planned)", "Belongs to the protected private production repository (real providers, real secrets, durable persistence); intentionally absent from this public repo."],
  ["Human-owned (planned)", "A program/governance control that authorized humans must own and approve; it cannot be responsibly automated away."],
]);
const DOC_SELF = "docs/SECURITY_CONTROLS_MATRIX.md";
/** The Short ref table's rows, verbatim (round 7). It is a fixed reference
 *  list; a cell there can be split by Markdown link or image syntax that still
 *  READS as a claim, so the rows are pinned rather than pattern-checked. */
const EXPECTED_SHORT_REF = [
  "| **ASVS 5.0** | OWASP Application Security Verification Standard 5.0 (testable app-security requirements) |",
  "| **API Top 10** | OWASP API Security Top 10 (esp. **API1 Broken Object Level Authorization**) |",
  "| **800-207** | NIST SP 800-207, Zero Trust Architecture |",
  "| **CSF 2.0** | NIST Cybersecurity Framework 2.0 (org security/risk program functions) |",
  "| **CIS** | CIS Benchmarks (device hardening) + CIS Controls v8 (safeguards); see [Security-Baseline Alignment](SECURITY_BASELINE_ALIGNMENT.md) |"
];
/** A Framework refs cell names frameworks and nothing else: this charset only
 *  (round 7). No brackets, so no link or image syntax can split a word; no
 *  emphasis, entity, markup, homoglyph or invisible character. */
const CELL_MARKUP = /[[\]!~\\<&]/;
/** Control names and Where cells are an ALLOWLIST, not a denylist (round 9):
 *  printable ASCII plus the exact non-ASCII characters the real matrix uses in
 *  that column. Any invisible character, combining mark, variation selector or
 *  look-alike letter — the classes no fold list can ever enumerate — fails. */
const CONTROL_NAME_CHARSET = /^[\x20-\x7E\u2192\u2264\u2014]*$/; // → ≤ —
const WHERE_CHARSET = /^[\x20-\x7E\u2014\u00A7]*$/; // — §
const CELL_MARKUP_LIST = "[ ] ! ~ \\ < &";
const FRAMEWORK_REFS_CHARSET = /^[A-Za-z0-9 .;,()\/+-]+$/; // the matrix cannot be its own evidence
/** Statuses whose cited paths must exist. Any status reading "implement…" gets
 *  the FULL Implemented check (paths + proof), legend word or not. */
const IMPLEMENTED_LIKE = /implement/i;
const PATH_CHECKED = new Set(["Automated (CI bot)"]);

/** Failures present on the real matrix when the gate landed (2026-10-01). Each
 *  entry absorbs exactly ONE row whose Control, exact Status and exact failure
 *  list all match — any other failure on that row, a changed status, or a
 *  second row of the same name is a NEW failure. Each needs an owner decision. */
const LEGEND_LIST = EXPECTED_LEGEND.join(" | ");
const KNOWN_FAILURES = [
  {
    control: "Real authentication provider, sessions, MFA/step-up assurance",
    status: "Implemented in THIS repo",
    why: [`status "Implemented in THIS repo" is not in the Status legend (${LEGEND_LIST})`],
    reason: "not a legend status — owner decides which legend word (or a new legend row) applies",
  },
  {
    control: "Durable, retained audit storage and log retention policy",
    status: "Partially implemented in THIS repo — durable storage yes; retention/deletion policy and mechanism not yet (`docs/DATA_RETENTION_AND_PERSONAL_DATA.md`)",
    why: [`status "Partially implemented in THIS repo — durable storage yes; retention/deletion policy and mechanism not yet (\`docs/DATA_RETENTION_AND_PERSONAL_DATA.md\`)" is not in the Status legend (${LEGEND_LIST})`],
    reason: "not a legend status — owner decides which legend word (or a new legend row) applies",
  },
  // found by the line-anchor check (round 30): the proof:backup-restore step moved
  // in scripts/preflight.mjs, and the matrix's anchor still names the old line.
  // A factual line-number correction, but in an owner-gated file this gate does
  // not edit — so it is held here until the owner corrects the anchor (or drops it)
  {
    control: "Backup and restore, with a verified restore test",
    status: IMPLEMENTED,
    why: ["cited anchor `scripts/preflight.mjs:486` does not land on what the row cites: line 486 of `scripts/preflight.mjs` names none of `proof:backup-restore`"],
    reason: "stale line anchor — the proof:backup-restore step is no longer on line 486 of scripts/preflight.mjs; owner corrects the anchor to the step's current line (a factual line-number fix) or drops it",
  },
];

const SELF = fileURLToPath(import.meta.url);
const ROOT = join(dirname(SELF), "..");

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}
const unbold = (s) => s.replace(/\*\*/g, "").trim();

/** Tables the matrix may carry that hold no controls. Any OTHER pipe line —
 *  an unknown header, a row split from its table by a blank line, a renamed
 *  Status/Where column — is UNCLAIMED and fails: a row the parser cannot place
 *  is a row nobody gates (found in review round 1 of PR #1349). */
const NON_CONTROL_TABLES = [["Short ref", "Framework"]];
/** Every recognised table's header, EXACTLY (raw cells — no bold, case or
 *  whitespace folding). An extra, renamed or re-cased column ("status",
 *  "Status (legacy)", "Assurance", a homoglyph) renders and would carry a claim
 *  nobody gates, so any other header leaves the table unclaimed (round 4). */
const CONTROLS_HEADER = ["Control", "Framework refs", "Status", "Where"];
const LEGEND_HEADER = ["Status", "Meaning"];
const sameHeader = (raw, want) => raw.length === want.length && want.every((x, k) => x === raw[k]);

/** Control names compared as a reader sees them: NFKC, entities decoded,
 *  zero-width characters and bold stripped, whitespace folded, case folded. */
export function controlKey(s) {
  return unbold(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[*_`]/g, "") // emphasis and code-span markers render invisibly (round 10)
    .replace(/\s+/g, " ").trim().toLowerCase();
}

/** The closing note's matrix-wide binding, pinned as a whole paragraph
 *  (round 5). A loose regex over raw text also matched it inside a list-item
 *  link definition, a link title, a hidden HTML element, or after visible words
 *  negating it — places the reader never sees, or reads the opposite of. */
const BINDING_PARAGRAPH = /^Everything marked \*\*Implemented \(public core\)\*\* runs in the deterministic, fixture-backed core in this public repository and is exercised by `pnpm run (proof:[\w:.-]+)`\. It demonstrates the \*shape\* of the controls — tenant isolation, deny-by-default RBAC, fail-closed evaluation, tamper-evident evidence and audit — over synthetic data\.$/;

/** Blank the way CommonMark decides it: spaces and tabs only. JS trim() also
 *  eats NBSP, U+3000 and form feed — lines GitHub keeps as content (round 6). */
const isBlank = (l) => /^[ \t]*$/.test(l);

/** Fold a cell for claim matching as a reader would read it. Markup and
 *  entities are never stripped — a cell carrying "<" or "&" fails outright
 *  instead, because regex stripping is bypassable (CodeQL js/incomplete-multi-
 *  character-sanitization). NFKC, invisible characters removed, common Cyrillic/Greek
 *  look-alikes mapped to Latin, case and whitespace folded (round 6). */
const CONFUSABLES = { "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ј": "j", "ѕ": "s", "ԁ": "d", "ӏ": "l", "һ": "h", "ο": "o", "α": "a", "ε": "e", "ι": "i", "ν": "v", "ρ": "p", "τ": "t", "κ": "k", "μ": "m" };
export function claimFold(s) {
  return s.normalize("NFKC")
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .toLowerCase().replace(/./gu, (ch) => CONFUSABLES[ch] ?? ch)
    .replace(/\*\*|__|[*_`]/g, "").replace(/\s+/g, " ").trim();
}

/** A line's text OUTSIDE its code spans, by CommonMark's rule: a backtick run
 *  opens a span that only the next run of the SAME length closes; runs of other
 *  lengths in between are content (round 30 — the old `(`+)…\1` paired a single
 *  backtick with the first of a longer run, so "intro `<details>```" hid a live
 *  tag). A run with no closer on the line is literal in CommonMark, but it may
 *  instead close a span opened on an earlier line, or open one the next line
 *  closes — the line alone cannot say which, so it is AMBIGUOUS and the caller
 *  fails it. A backslash before a backtick is ambiguous too (an escape outside a
 *  span, literal inside one). The matrix has neither. */
export function codeSpans(l) {
  if (/\\`/.test(l)) return { outside: l, ambiguous: "a backslash before a backtick" };
  const runs = [...l.matchAll(/`+/g)];
  let outside = "", pos = 0;
  for (let k = 0; k < runs.length;) {
    const open = runs[k];
    const close = runs.findIndex((r, n) => n > k && r[0].length === open[0].length);
    if (close === -1) return { outside: l, ambiguous: `an unpaired run of ${open[0].length} backtick(s)` };
    outside += l.slice(pos, open.index);
    pos = runs[close].index + runs[close][0].length;
    k = close + 1;
  }
  return { outside: outside + l.slice(pos), ambiguous: null };
}

export function parseMatrix(raw) {
  // CRLF is fine; a BARE carriage return is a line break to CommonMark but not to
  // a "\n" split, so a row could render as two rows the gate reads as one (round 5).
  const text = raw.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const bareCR = [];
  lines.forEach((l, k) => { if (l.includes("\r")) bareCR.push({ line: k + 1, raw: l.replace(/\r/g, "\\r") }); });
  const legendDup = [];
  const claimCells = [];
  const shortRefRows = [];
  const controlCells = [];
  // lines GitHub reads as content (or as a hiding block) that this gate cannot see
  // into: a whitespace-only line that is not CommonMark-blank, an HTML block
  // start, a code fence. The matrix has none of these (round 6).
  const opaque = [];
  lines.forEach((l, k) => {
    if (l.trim() === "" && !isBlank(l)) opaque.push({ line: k + 1, raw: JSON.stringify(l), why: "is whitespace-only but not blank to Markdown (NBSP, U+3000, form feed…) — GitHub keeps it as content" });
    else if (/^ {0,3}</.test(l)) opaque.push({ line: k + 1, raw: l, why: "starts an HTML block — its content can be hidden or never rendered" });
    // a fence can open behind ANY container prefix — a list item (`- ```), a
    // blockquote, nesting of either — and turn the table after it into code
    // (round 30). The matrix has no run of three backticks or tildes anywhere, so
    // no prefix is trusted: any such run on any line fails
    else if (/`{3,}|~{3,}/.test(l)) opaque.push({ line: k + 1, raw: l, why: "carries a run of three or more backticks or tildes — a code fence can open there, behind any list or blockquote prefix, and what follows renders as code, not as the claim it reads like" });
    else {
      // raw HTML ANYWHERE on the line, outside a code span: `intro <details>` before
      // the tables collapses them (round 29). The matrix needs no raw HTML at all,
      // so the allowance is empty — any `<tag`, `</tag`, `<!` or `<?` fails. Code
      // spans are found by CommonMark's rule, and a line whose spans that rule
      // cannot settle on its own fails (round 30)
      const cs = codeSpans(l);
      if (cs.ambiguous) opaque.push({ line: k + 1, raw: l, why: `has ${cs.ambiguous} — where its code spans end cannot be read from the line alone, so a tag beside them could be live HTML` });
      else if (/<[A-Za-z/!?]/.test(cs.outside)) opaque.push({ line: k + 1, raw: l, why: "carries raw HTML outside a code span — a tag mid-line can still open or close a hiding block" });
    }
  });
  const legend = new Map();
  const legendTables = [];
  const trailing = [];
  const rows = [];
  const unclaimed = [];
  const malformed = [];
  const claimed = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    // a table row starts at three or fewer spaces: at four (or a tab) CommonMark
    // renders the line as indented code, not a table — such a line is never
    // claimed here, so the unclaimed-pipe check below fails it (round 28)
    if (!/^ {0,3}\|/.test(lines[i])) continue;
    const head = cells(lines[i]);
    // the delimiter row must match the header cell for cell, each `:?-+:?`: with
    // fewer cells, or a malformed one, Markdown renders no table at all (round 29);
    // an unclaimed header then fails the unclaimed-pipe check below
    const sep = /^ {0,3}\|/.test(lines[i + 1] ?? "") ? cells(lines[i + 1]) : null;
    const isTable = sep !== null && sep.length === head.length && sep.every((c) => /^\s*:?-+:?\s*$/.test(c));
    const isLegend = sameHeader(head, LEGEND_HEADER);
    const isControls = sameHeader(head, CONTROLS_HEADER);
    const isOther = NON_CONTROL_TABLES.some((h) => sameHeader(head, h));
    const sIdx = CONTROLS_HEADER.indexOf("Status");
    const wIdx = CONTROLS_HEADER.indexOf("Where");
    if (!isTable || (!isLegend && !isControls && !isOther)) continue; // left unclaimed: fails below
    claimed.add(i).add(i + 1);
    if (isLegend) legendTables.push(i + 1);
    let j = i + 2;
    for (; j < lines.length && /^ {0,3}\|/.test(lines[j]); j += 1) {
      claimed.add(j);
      const c = cells(lines[j]);
      // an escaped pipe or a dropped cell shifts every column after it — never guess
      if (c.length !== head.length) { malformed.push({ line: j + 1, raw: lines[j], want: head.length, got: c.length }); continue; }
      // a repeated legend word would let an earlier, inflated meaning render while
      // the Map kept only the last one (round 5)
      if (isLegend) { if (legend.has(unbold(c[0]))) legendDup.push({ line: j + 1, raw: lines[j] }); legend.set(unbold(c[0]), c[1]); }
      else if (isOther) shortRefRows.push({ line: j + 1, raw: lines[j] });
      else if (isControls) { claimCells.push({ line: j + 1, raw: lines[j], cell: c[1] }); controlCells.push({ line: j + 1, raw: lines[j], cell: c[0] }); }
      if (isControls) rows.push({ line: j + 1, raw: lines[j], control: c[0], status: unbold(c[sIdx] ?? ""), where: c[wIdx] ?? "" });
    }
    // GFM continues a table onto ANY non-blank line until a blank one, rendering it
    // as a (one-cell) row — so the line after a table must be blank (round 3).
    if (j < lines.length && !isBlank(lines[j])) { claimed.add(j); trailing.push({ line: j + 1, raw: lines[j] }); }
    i = j - 1;
  }
  // GFM renders a row without a leading pipe, a pipe-less table, and a table in a
  // blockquote. So EVERY line carrying an unescaped pipe must sit in a recognised
  // table, or it is a row nobody gates (review round 2 of PR #1349).
  lines.forEach((l, k) => { if (!claimed.has(k) && /(^|[^\\])\|/.test(l)) unclaimed.push({ line: k + 1, raw: l }); });
  // raw-HTML tables render as rows no parser here sees; the matrix uses none (round 3)
  const htmlRows = [];
  lines.forEach((l, k) => { if (/<\/?\s*(table|thead|tbody|tr|td|th)\b/i.test(l)) htmlRows.push({ line: k + 1, raw: l }); });
  // HTML comments hide text from the reader but not from a regex — the matrix-wide
  // binding could survive only inside one. The matrix uses none, so ANY comment
  // opener fails outright; stripping them instead is bypassable by nesting
  // (CodeQL js/incomplete-multi-character-sanitization, round 3).
  lines.forEach((l, k) => { if (l.includes("<!--")) htmlRows.push({ line: k + 1, raw: l, comment: true }); });
  // a link reference definition (`[label]: url "title"`) never renders either (round 4)
  const linkDefs = [];
  lines.forEach((l, k) => { if (/^ {0,3}(>\s*)*\[[^\]]+\]:/.test(l)) linkDefs.push({ line: k + 1, raw: l }); });
  // the binding is a paragraph of its own: starts at column 0 after a blank line,
  // runs to the next blank line, and matches BINDING_PARAGRAPH exactly — once
  const bindings = [];
  lines.forEach((l, k) => {
    if (!l.startsWith("Everything marked **Implemented (public core)**") || (k > 0 && !isBlank(lines[k - 1]))) return;
    let e = k; while (e < lines.length && !isBlank(lines[e])) e += 1;
    const m = BINDING_PARAGRAPH.exec(lines.slice(k, e).map((x) => x.trim()).join(" "));
    if (m) bindings.push(m[1]);
  });
  const closing = bindings.length === 1 ? [null, bindings[0]] : null;
  return { shortRefRows, opaque, controlCells, bareCR, legendDup, claimCells, legend, legendTables, linkDefs, trailing, htmlRows, rows, unclaimed, malformed, defaultProof: closing ? closing[1] : null };
}

function expandBraces(p) {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(",").flatMap((alt) => expandBraces(p.slice(0, m.index) + alt.trim() + p.slice(m.index + m[0].length)));
}

const PATHISH = /^[\w.@{},/-]+$/;
const FILEEXT = /\.(ts|tsx|mjs|cjs|js|json|md|ya?ml|swift|sql|sh)$/;

/** Backticked tokens in a Where cell that name repo paths (not identifiers, not `/` or `/v1`). */
/** The only leading-slash tokens exempt as API routes, not paths: exactly `/` and
 *  `/v1` (the only two the matrix cites). Every other leading-slash token — `/v1-lib/…`,
 *  `/v1/lib/…`, `/v1/../…`, `/v1.ts` included — is treated as a path, so the resolver's
 *  absolute-path rejection fails it (round 11: `/etc/passwd`; round 13: the `/v1\b…` shape). */
const API_ROUTE = /^\/(v1)?$/;
/** A GitHub Action ref (`owner/repo[/path]@vN`) — never a repo path. Accepted only
 *  on Automated rows, and only when its first segment is NOT a top-level directory
 *  of this repository (so `scripts/x.mjs@v2` is not mistaken for one; round 11). */
const ACTION_REF = /^([A-Za-z0-9][A-Za-z0-9-]*)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._/-]+)?@v\d+(\.\d+)*$/;

/** The only Control-name code span with a letter-led dot the matrix uses; any other
 *  dotted Control span is read as a file citation and fails (round 19). */
const CONTROL_SPAN_ALLOW = new Set(["object.id + tenant_id"]);
/** The exact shape citedProofs reads; a `pnpm …`/`proof:…` token in any other shape fails. */
const PROOF_CITE = /^(pnpm run )?proof:[\w:.-]+$/;
/** Non-proof commands the matrix cites verbatim (no evidence weight, never resolved). */
const COMMAND_CITES = new Set(["pnpm install --frozen-lockfile"]);
/** A span that reads as a proof or a package-manager command, in any case, padding or
 *  wrapping: `PROOF:x`, ` proof:x `, `(proof:x)`, `run proof:x`, `proof :x`, `npm run …`,
 *  `yarn …`, `pnpx …`, `pnpm.cmd …` (round 15). A bare word (`pnpm`) or a path
 *  (`pnpm-workspace.yaml`) is not one. */
const COMMAND_LIKE = /proof\s*:|^\s*(pnpm|npm|yarn|npx|pnpx)(\.\w+)?\s/i;

export function citedPaths(where, { strict = false, actionRefs = false, topDirs = new Set(), exts = new Set() } = {}) {
  const out = [];
  const unparsed = [];
  const anchors = []; // anchors[k]: the `path:NN` line number of out[k], else null (round 30)
  for (const m of where.matchAll(/`([^`]+)`/g)) {
    // a command citation is either a proof citedProofs reads (and checks), or the
    // one install command the matrix cites; any other shape is unreadable evidence
    // and fails, never a skip (round 14: `proof:no/such` fell back to the binding;
    // round 15: case, padding and prefixes are matched too, the exact shape is not)
    if (COMMAND_LIKE.test(m[1])) {
      if (!PROOF_CITE.test(m[1]) && !COMMAND_CITES.has(m[1])) unparsed.push(m[1]);
      continue;
    }
    // a `path:NN` anchor is KEPT, not stripped: the caller checks that line NN
    // exists and names the row's subject (round 30 — a stale anchor read green)
    const am = /^(.*):(\d+)$/.exec(m[1]);
    const tok = am ? am[1] : m[1];
    if (API_ROUTE.test(tok)) continue;
    // a slash-free `name.ext` is a path when `ext` is an extension some tracked file
    // has (`no-such.py`, `.rs`, `.toml` — round 28); `ApiKeyRecord.token` stays an
    // identifier only because no tracked file ends in `.token`
    const ext = /\.([A-Za-z0-9]+)$/.exec(tok);
    const looksLikePath = tok.includes("/") || FILEEXT.test(tok) || (ext !== null && exts.has(ext[1]));
    const ref = ACTION_REF.exec(tok);
    if (actionRefs && ref && !topDirs.has(ref[1])) continue;
    if (!strict && /@v?\d/.test(tok)) continue;
    if (!PATHISH.test(tok) || /@v?\d/.test(tok)) { if (looksLikePath) unparsed.push(tok); continue; }
    if (looksLikePath || /^\.[\w-]+$/.test(tok)) { out.push(tok); anchors.push(am ? Number(am[2]) : null); }
  }
  // an Implemented row's citation the parser cannot read is a failure, never a skip (round 3)
  return strict ? { paths: out, unparsed, anchors } : out;
}

export function citedProofs(where) {
  return [...where.matchAll(/`(?:pnpm run )?(proof:[\w:.-]+)`/g)].map((m) => m[1]);
}

/** Evidence must be IN THE REPOSITORY: a tracked file, or a tracked directory
 *  at least two segments deep (`lib/persistence`, never `lib` or `./`). Paths
 *  with `.`/`..` segments, absolute paths, and anything untracked (node_modules,
 *  .git, build output) resolve to nothing (review round 2 of PR #1349). */
function resolver(root, tracked, indexed = tracked) {
  const files = new Set(tracked);
  const entries = new Set(indexed); // every index path, any mode: what a reader sees as tracked
  const dirs = new Set();
  for (const f of tracked) {
    const parts = f.split("/");
    for (let k = 1; k < parts.length; k += 1) dirs.add(parts.slice(0, k).join("/"));
  }
  // the basename map counts EVERY index entry, so a name shared by a regular file
  // and a symlink or gitlink stays ambiguous, and only a regular hit is accepted.
  // That also covers a non-regular entry beside the previous path: it is a hit of
  // its own name, so the bare name can never skip past it to a match elsewhere (round 25)
  const byBase = new Map();
  for (const f of entries) {
    const b = f.split("/").pop();
    byBase.set(b, [...(byBase.get(b) ?? []), f]);
  }
  const inRepo = (p) => {
    const segs = p.split("/");
    if (p.startsWith("/") || segs.some((x) => x === "" || x === "." || x === "..")) return null;
    if (p === DOC_SELF) return null; // circular: the matrix is not evidence for itself
    if (files.has(p)) return existsSync(join(root, p)) ? p : null; // tracked AND present
    return dirs.has(p) && segs.length >= 2 && existsSync(join(root, p)) ? p : null;
  };
  return (tok, lastDir) => {
    const t0 = tok.replace(/\/$/, "");
    // `./x` is ROOT-relative, never a bare name to look up anywhere (round 23)
    if (/^\.\/./.test(t0)) return inRepo(t0.slice(2));
    const t = t0;
    if (t.includes("/") || t.startsWith(".")) return inRepo(t);
    if (lastDir && inRepo(`${lastDir}/${t}`)) return `${lastDir}/${t}`;
    // a bare name resolves to the ONE tracked file of that basename, and that file
    // still passes every inRepo rule: not the matrix itself, tracked AND present
    // (round 23: `SECURITY_CONTROLS_MATRIX.md` used to skip both)
    const hits = byBase.get(t) ?? [];
    return hits.length === 1 && files.has(hits[0]) ? inRepo(hits[0]) : null;
  };
}

/** The source file a proof script EXECUTES, following the root -> workspace-
 *  package delegation (`pnpm --filter @workspace/<pkg> run <name>` -> `tsx ./src/x.ts`).
 *  Both hops are parsed as WHOLE commands, never searched for a file-shaped token
 *  (round 30: `echo scripts/x.mjs` used to resolve, crediting a proof that runs
 *  no assertion): a delegation is exactly `pnpm --filter <pkg> run <name>`, and
 *  the last hop exactly `node <file>` or `tsx <file>` — the only forms the
 *  repository's proofs use — with no argument, chain, pipe or redirection. The
 *  file must be a tracked regular file (when `tracked` is given) with no `.`/`..`
 *  segment. Anything else is null: fail-closed. */
const PROOF_DELEGATE = /^pnpm --filter (@workspace\/[\w-]+) run ([\w:.-]+)$/;
const PROOF_ENTRY = /^(?:node|tsx) (?:\.\/)?([\w@-][\w@./-]*\.(?:ts|mjs|cjs|js))$/;
export function proofSource(name, { root = ROOT, scripts, readPkg = defaultReadPkg, tracked = null }) {
  let cmd = Object.hasOwn(scripts, name) ? scripts[name] : undefined;
  let dir = "";
  for (let hop = 0; hop < 3 && typeof cmd === "string"; hop += 1) {
    const d = PROOF_DELEGATE.exec(cmd);
    if (d) {
      const pkg = readPkg(root, d[1]);
      if (!pkg || !Object.hasOwn(pkg.scripts, d[2])) return null;
      dir = pkg.dir;
      cmd = pkg.scripts[d[2]];
      continue;
    }
    const e = PROOF_ENTRY.exec(cmd);
    if (!e) return null;
    const rel = dir ? `${dir}/${e[1]}` : e[1];
    if (rel.split("/").some((x) => x === "" || x === "." || x === "..")) return null;
    if (tracked && !tracked.has(rel)) return null;
    return existsSync(join(root, rel)) ? rel : null;
  }
  return null;
}

function defaultReadPkg(root, name) {
  const short = name.replace(/^@workspace\//, "");
  for (const dir of [short, `lib/${short}`, `artifacts/${short}`]) {
    const f = join(root, dir, "package.json");
    if (!existsSync(f)) continue;
    const pkg = JSON.parse(readFileSync(f, "utf8"));
    if (pkg.name === name) return { dir, scripts: pkg.scripts ?? {} };
  }
  return null;
}

const NO_SOURCE = "does not resolve to a source file it executes — the command (after any `pnpm --filter <pkg> run` hop) must be exactly `node <file>` or `tsx <file>`, a tracked file";
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What a `path:NN` anchor must land on: the row's cited proofs and the code-span
 *  identifiers in its Where cell (`validatePolicyRules`, `authenticate()`), never a
 *  bare package-manager word. */
function anchorSubjects(where) {
  const ids = [...where.matchAll(/`([A-Za-z_$][\w$]*)(?:\(\))?`/g)].map((m) => m[1]).filter((w) => !/^(pnpm|npm|yarn|npx|pnpx)$/i.test(w));
  return [...new Set([...citedProofs(where), ...ids])];
}

export function checkMatrix(text, { root = ROOT, tracked, indexed = tracked, scripts, gatedProofs = new Set(), selfSkipping = new Map(), envRuns = new Set() }) {
  const trackedSet = new Set(tracked);
  // a proof a gating lane lists is not yet a proof that RAN: one that self-skips
  // without an env var (preflight prints "not run, not passed") counts only where a
  // workflow step runs it WITH that var set (round 31) — see envRunsFromWorkflows
  const laneWhy = (p, tag = "") => {
    if (!gatedProofs.has(p)) return `proof \`${p}\`${tag} runs in no gating lane — it is not a \`pnpm run ${p}\` step in the --list-steps of scripts/preflight.mjs or scripts/verify-breadth.mjs`;
    if (selfSkipping.has(p) && !envRuns.has(p)) return `proof \`${p}\`${tag} self-skips without ${selfSkipping.get(p)}, and no workflow step runs exactly \`pnpm run ${p}\` with ${selfSkipping.get(p)} set, in a push/pull_request workflow, from a job and step with only allowlisted keys — a lane that skips it never ran it${envRuns.refusals?.get(p)?.length ? ` (refused: ${envRuns.refusals.get(p).join("; ")})` : ""}`;
    return null;
  };
  // a `path:NN` anchor is a claim about one line: that line must EXIST and name
  // what the row cites (round 30 — `scripts/preflight.mjs:486` pointed at another
  // gate long after the proof step moved, and stripping the suffix read it green)
  const anchorWhy = (p, hit, n, where) => {
    const subj = anchorSubjects(where);
    const line = trackedSet.has(hit) && n >= 1 ? readFileSync(join(root, hit), "utf8").split("\n")[n - 1] : undefined;
    if (line !== undefined && subj.some((x) => new RegExp(`(^|[^\\w:.-])${escRe(x)}($|[^\\w:.-])`).test(line))) return null;
    return `cited anchor \`${p}:${n}\` does not land on what the row cites: line ${n} of \`${p}\` names none of ${subj.length ? subj.map((x) => `\`${x}\``).join(", ") : "(nothing — the row cites no proof or identifier to anchor)"}`;
  };
  const { shortRefRows, opaque, controlCells, bareCR, legendDup, claimCells, legend, legendTables, linkDefs, trailing, htmlRows, rows, unclaimed, malformed, defaultProof } = parseMatrix(text);
  const resolve = resolver(root, tracked, indexed);
  const topDirs = new Set(tracked.filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
  const exts = new Set(tracked.map((f) => f.split("/").pop()).filter((b) => b.lastIndexOf(".") > 0).map((b) => b.slice(b.lastIndexOf(".") + 1)));
  const fails = [];
  const structural = [];
  if (legendTables.length !== 1) structural.push(`expected exactly one Status legend table, found ${legendTables.length}${legendTables.length ? ` (lines ${legendTables.join(", ")})` : ""}`);
  const legendWords = [...legend.keys()];
  if (legendWords.length !== EXPECTED_LEGEND.length || !EXPECTED_LEGEND.every((w) => legend.has(w)))
    structural.push(`Status legend is [${legendWords.join(" | ")}], expected exactly [${LEGEND_LIST}] — a legend change must update this gate's checks in the same change`);
  for (const [w, m] of EXPECTED_MEANINGS) if (legend.has(w) && legend.get(w) !== m)
    structural.push(`Status legend meaning for "${w}" changed — it sets the claim every "${w}" row makes; update EXPECTED_MEANINGS in the same change\n      | **${w}** | ${legend.get(w)} |`);
  for (const b of bareCR) structural.push(`line ${b.line} contains a bare carriage return — Markdown breaks the line there, so it renders as rows this gate reads as one\n      ${b.raw}`);
  for (const d of legendDup) structural.push(`line ${d.line} repeats a Status legend word — both rows render, only the last would be checked\n      ${d.raw}`);
  // a status claim belongs in the Status cell, where it is gated — not in the
  // Framework refs cell or the Short ref table, where nothing checks it (round 5)
  for (const o of opaque) structural.push(`line ${o.line} ${o.why}\n      ${o.raw}`);
  // Framework refs cells and the Short ref table are plain ASCII in the real
  // matrix; anything else there (entities, markup, homoglyphs, invisible
  // characters) fails outright, and the folded text may not carry a claim
  const shortRaw = shortRefRows.map((r) => r.raw);
  if (shortRaw.length !== EXPECTED_SHORT_REF.length || !EXPECTED_SHORT_REF.every((x, k) => x === shortRaw[k])) {
    const off = shortRefRows.find((r, k) => r.raw !== EXPECTED_SHORT_REF[k]) ?? shortRefRows.at(-1) ?? { line: 0, raw: "(no Short ref rows)" };
    structural.push(`line ${off.line}: the Short ref table differs from its pinned rows (EXPECTED_SHORT_REF) — update the pin in the same change\n      ${off.raw}`);
  }
  for (const c of claimCells) {
    if (!FRAMEWORK_REFS_CHARSET.test(c.cell)) structural.push(`line ${c.line}: a Framework refs cell may hold only [A-Za-z0-9 .;,()/+-], got "${c.cell}"\n      ${c.raw}`);
    else if (/implement|certif|attest|audit|complian|accredit/.test(claimFold(c.cell))) structural.push(`line ${c.line} carries a status-like claim ("${c.cell}") outside a Status cell, where no check reaches it\n      ${c.raw}`);
  }
  // a Control name may not wear a legend status word either
  // Control names and Where cells carry none of the characters link, image,
  // strikethrough, escape, HTML or entity syntax needs — any of them could split
  // a status word that still READS as one, or point cited evidence elsewhere.
  // The matrix uses none (round 8).
  for (const c of controlCells) if (!CONTROL_NAME_CHARSET.test(c.cell)) structural.push(`line ${c.line}: Control name carries a character outside printable ASCII + → ≤ — (U+${[...c.cell].find((ch) => !CONTROL_NAME_CHARSET.test(ch)).codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}) — an invisible character or look-alike could disguise a status word\n      ${c.raw}`);
  for (const r of rows) if (!WHERE_CHARSET.test(r.where)) structural.push(`line ${r.line}: Where cell carries a character outside printable ASCII + — § (U+${[...r.where].find((ch) => !WHERE_CHARSET.test(ch)).codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}) — an invisible character or look-alike could disguise a claim\n      ${r.raw}`);
  // a code span that touches a letter, or holds only whitespace, splits a word
  // into visual pieces the fold never sees whole (round 10); the matrix's code
  // spans all stand apart as whole tokens
  for (const c of controlCells) for (const m of c.cell.matchAll(/(`+)([^`]*?)\1/g)) {
    const pre = c.cell[m.index - 1] ?? "", post = c.cell[m.index + m[0].length] ?? "";
    if (/[A-Za-z0-9]/.test(pre) || /[A-Za-z0-9]/.test(post) || m[2].trim() === "")
      structural.push(`line ${c.line}: Control name has a code span that touches a letter or holds only whitespace (${m[0]}) — it can split a word past the fold\n      ${c.raw}`);
  }
  for (const c of controlCells) if (CELL_MARKUP.test(c.cell)) structural.push(`line ${c.line}: Control name carries markup characters (${CELL_MARKUP_LIST}) — they could disguise a status word past any fold\n      ${c.raw}`);
  for (const r of rows) if (CELL_MARKUP.test(r.where)) structural.push(`line ${r.line}: Where cell carries markup characters (${CELL_MARKUP_LIST}) — they could disguise a claim or re-point cited evidence\n      ${r.raw}`);
  // citations are read with single-backtick pairing, which equals CommonMark's
  // only when every backtick run is ONE long (backslash is already banned): a
  // \`\`x\` proof:y\`\` span renders whole but hides proof:y from both parsers, and
  // an unclosed backtick renders as plain text nothing reads (round 16). The
  // matrix uses neither.
  for (const r of rows) {
    if (/``/.test(r.where)) structural.push(`line ${r.line}: Where cell has a run of two or more backticks — citations are read single-backtick only, so a longer code span could hide a cited proof or path\n      ${r.raw}`);
    else if ((r.where.match(/`/g) ?? []).length % 2) structural.push(`line ${r.line}: Where cell has an unclosed backtick — the text after it renders as plain prose no check reads\n      ${r.raw}`);
  }
  // a Control name is never resolved as evidence, so a proof, command or path
  // cited THERE would read as evidence nothing checked (round 17): no unclosed
  // backtick (a run of two or more is already failed by the round-10 code-span
  // check above), no proof-like or command-like span, no path-like span other
  // than the exact API route, and no `proof:` text at all. The matrix's Control
  // spans are identifiers, role names, `/v1` and the bare word `pnpm`.
  for (const c of controlCells) {
    if ((c.cell.match(/`/g) ?? []).length % 2) structural.push(`line ${c.line}: Control name has an unclosed backtick\n      ${c.raw}`);
    else for (const m of c.cell.matchAll(/`([^`]+)`/g)) {
      // a letter-led dot ANYWHERE in the span reads as a file, whatever follows
      // it (`x.ts:12:5`, `x.ts@v2`, `x.py,` — round 19; suffix-stripping was a
      // denylist and leaked). The one dotted Control span the matrix uses is pinned
      // in CONTROL_SPAN_ALLOW. Where cells use FILEEXT plus the tracked-extension set: they cite identifiers
      // like `ApiKeyRecord.token`.
      const t = m[1];
      if (COMMAND_LIKE.test(t) || (t.includes("/") && !API_ROUTE.test(t)) || (/\.[A-Za-z]/.test(t) && !CONTROL_SPAN_ALLOW.has(t)))
        structural.push(`line ${c.line}: Control name cites \`${t}\` — a proof, command or path in the Control cell is never resolved; evidence belongs in the Where cell\n      ${c.raw}`);
    }
    // emphasis and code-span markers are dropped first: `pro**of**:x`, `_proof_:x`
    // and a `proof` span followed by `:x` all read as proof:x (round 18)
    // a span cannot split a file name either: `no-such`.ts reads as no-such.ts
    // (round 19). ANY backtick touching a dot fails, once * and _ are dropped, so
    // `a`.`ts`, no-such.`ts` and `no-such`*.ts* fail too (round 20); the matrix's
    // Control cells have none
    if (/`\.|\.`/.test(c.cell.replace(/[*_]/g, ""))) structural.push(`line ${c.line}: Control name has a code span joined to a dot — it can split a file name past the span check\n      ${c.raw}`);
    if (/proof\s*:/i.test(c.cell.replace(/[*_`]/g, ""))) structural.push(`line ${c.line}: Control name carries proof: text — a proof named outside the Where cell is never resolved\n      ${c.raw}`);
  }
  for (const c of controlCells) for (const w of EXPECTED_LEGEND) if (claimFold(c.cell).includes(claimFold(w)))
    structural.push(`line ${c.line}: Control name carries the status word "${w}" outside the Status cell\n      ${c.raw}`);
  for (const d of linkDefs) structural.push(`line ${d.line} is a link reference definition — it never renders, so text in it (the matrix-wide binding, say) is invisible to the reader (the matrix uses none)\n      ${d.raw}`);
  for (const t of trailing) structural.push(`line ${t.line} directly follows a table with no blank line, so it renders as a table row nobody gates\n      ${t.raw}`);
  for (const h of htmlRows) structural.push(h.comment
    ? `line ${h.line} opens an HTML comment — hidden text can carry what the reader never sees (the matrix uses none)\n      ${h.raw}`
    : `line ${h.line} carries a raw-HTML table tag — an HTML row renders as a control row this gate cannot see\n      ${h.raw}`);
  const seen = new Map();
  for (const r of rows) { const k = controlKey(r.control); seen.set(k, [...(seen.get(k) ?? []), r.line]); }
  for (const [, at] of seen) if (at.length > 1) { const first = rows.find((r) => r.line === at[0]); structural.push(`Control "${first.control}" appears ${at.length} times (lines ${at.join(", ")}, compared case-, space-, entity- and zero-width-insensitively) — every control row must be unique\n      ${rows.find((r) => r.line === at[1]).raw}`); }
  // a row must NAME its control: an empty (or markup-only) Control cell would
  // inflate the counts with a row about nothing (round 28)
  for (const r of rows) if (controlKey(r.control) === "") structural.push(`line ${r.line}: the Control cell is empty — every row must name the control it claims\n      ${r.raw}`);
  for (const u of unclaimed) structural.push(`line ${u.line} is a pipe row in no recognised table (Control|…|Status|Where, Status|Meaning, or ${NON_CONTROL_TABLES.map((h) => h.join("|")).join(", ")}) — it would go ungated\n      ${u.raw}`);
  for (const m of malformed) structural.push(`line ${m.line} has ${m.got} cells, its table header has ${m.want} (escaped pipe or missing cell) — columns cannot be trusted\n      ${m.raw}`);
  for (const r of rows) {
    const why = [];
    if (!EXPECTED_LEGEND.includes(r.status)) why.push(`status "${r.status}" is not in the Status legend (${LEGEND_LIST})`);
    if (PATH_CHECKED.has(r.status)) {
      // strict, like Implemented rows: an unreadable path-like citation fails (round 11)
      const auto = citedPaths(r.where, { strict: true, actionRefs: true, topDirs, exts });
      for (const u of auto.unparsed) why.push(`cited token \`${u}\` cannot be read as a repo path or as a \`(pnpm run )?proof:<name>\` citation — unreadable evidence is not evidence`);
      let lastDir = null;
      for (const [idx, tok] of auto.paths.entries()) for (const p of expandBraces(tok)) {
        const hit = resolve(p, lastDir);
        if (!hit) why.push(`cited path \`${p}\` is not a tracked repo path (or is ambiguous)`);
        else if (auto.anchors[idx] !== null) { const a = anchorWhy(p, hit, auto.anchors[idx], r.where); if (a) why.push(a); }
        const at = (hit ?? p).includes("/") ? (hit ?? p) : null;
        if (at) lastDir = at.slice(0, at.lastIndexOf("/"));
      }
      // a proof the row cites must exist and resolve, here too (round 15)
      for (const p of citedProofs(r.where)) {
        if (!Object.hasOwn(scripts, p)) why.push(`proof \`${p}\` is not a package.json script`);
        else if (!proofSource(p, { root, scripts, tracked: trackedSet })) why.push(`proof \`${p}\` ${NO_SOURCE}`);
        else { const g = laneWhy(p); if (g) why.push(g); }
      }
    }
    if (IMPLEMENTED_LIKE.test(r.status)) {
      const { unparsed } = citedPaths(r.where, { strict: true, exts });
      for (const u of unparsed) why.push(`cited token \`${u}\` cannot be read as a repo path or as a \`(pnpm run )?proof:<name>\` citation — unreadable evidence is not evidence`);
      const own = citedProofs(r.where);
      const proofs = own.length ? own : defaultProof ? [defaultProof] : [];
      if (proofs.length === 0) why.push("no proof bound: the row cites none and the closing note's matrix-wide `pnpm run proof:*` binding is missing");
      let ownSources = 0;
      for (const p of proofs) {
        const tag = own.length ? "" : " (matrix-wide binding)";
        if (!Object.hasOwn(scripts, p)) { why.push(`proof \`${p}\` is not a package.json script${tag}`); continue; }
        // a proof no gating lane runs proves nothing: it must be a `pnpm run <proof>`
        // step of scripts/preflight.mjs or scripts/verify-breadth.mjs (round 28)
        { const g = laneWhy(p, tag); if (g) why.push(g); }
        if (proofSource(p, { root, scripts, tracked: trackedSet })) { if (own.length) ownSources += 1; }
        else why.push(`proof \`${p}\`${tag} ${NO_SOURCE}`);
      }
      // A row's own cited proof counts as its repo-path citation: the proof's
      // source file is the thing in the tree that verifies the control.
      const { paths, anchors } = citedPaths(r.where, { strict: true, exts });
      if (paths.length === 0 && ownSources === 0) why.push("cites no repo path (and no proof of its own whose source file exists)");
      let lastDir = null;
      for (const [idx, tok] of paths.entries()) {
        for (const p of expandBraces(tok)) {
          const hit = resolve(p, lastDir);
          if (!hit) why.push(`cited path \`${p}\` is not a tracked repo path (or is ambiguous)`);
          else if (anchors[idx] !== null) { const a = anchorWhy(p, hit, anchors[idx], r.where); if (a) why.push(a); }
          // a bare sibling resolves beside the CITED directory, even when the cited file is missing
          const at = (hit ?? p).includes("/") ? (hit ?? p) : null;
          if (at) lastDir = at.slice(0, at.lastIndexOf("/"));
        }
      }
    }
    if (why.length) fails.push({ ...r, why });
  }
  return { rows, legend, defaultProof, fails, structural };
}

/** Index entries from `git ls-files -s -z`, one per path (an unmerged path has a
 *  row per stage and still counts once — round 25), with each entry's mode. */
export function parseLsFilesIndex(out) {
  const byPath = new Map();
  for (const rec of out.split("\0").filter(Boolean)) {
    const tab = rec.indexOf("\t");
    const [mode] = rec.slice(0, tab).split(" ");
    const path = rec.slice(tab + 1);
    if (!byPath.has(path)) byPath.set(path, new Set());
    byPath.get(path).add(mode);
  }
  return byPath;
}

/** REGULAR tracked files only: every index row for the path is mode 100644 or
 *  100755. An ALLOWLIST (round 25): a symlink (120000) is not a file, a gitlink
 *  (160000) is another repository's commit, and either would otherwise pass as
 *  evidence — a tracked link to the matrix, an empty submodule directory. Read
 *  from the index, so no filesystem call. */
export function parseLsFilesStage(out) {
  return [...parseLsFilesIndex(out)].filter(([, modes]) => [...modes].every((m) => m === "100644" || m === "100755")).map(([path]) => path);
}

/** The proofs a gating lane actually RUNS: `pnpm run proof:<name>` steps in a
 *  runner's `--list-steps` output (its last non-empty line, one JSON array). The
 *  list the runner's loop iterates is the authority, not its source text, which
 *  can be written to look like a step without being one. A heavy or native-build
 *  step may be skipped, so it registers nothing. Unreadable output throws. */
export function gatedProofsFromListing(stdout, lane = "runner") {
  const line = String(stdout ?? "").split("\n").filter((l) => l.trim() !== "").pop() ?? "";
  let list;
  try { list = JSON.parse(line); } catch { throw new Error(`${lane} --list-steps output is not one JSON line`); }
  if (!Array.isArray(list) || list.length === 0 || !list.every((st) => st && typeof st === "object" && Array.isArray(st.cmd))) throw new Error(`${lane} --list-steps output is not a non-empty array of { cmd } steps`);
  const out = new Set();
  for (const st of list) {
    if (st.heavy === true || st.needsNativeBuild === true) continue;
    const [bin, sub, name] = st.cmd;
    if (bin === "pnpm" && sub === "run" && /^proof:[\w:.-]+$/.test(name ?? "")) out.add(name);
  }
  return out;
}

/** The proofs that self-skip without an env var, from the parity gate's own
 *  derivation over scripts/src (`check-preflight-ci-parity.mjs
 *  --list-self-skipping-proofs`: one `proof:<name> <ENV>` per line), never a
 *  hand-typed list. A malformed line throws (round 31). */
export function selfSkippingFromListing(stdout) {
  const out = new Map();
  for (const line of String(stdout ?? "").split("\n").filter((l) => l.trim() !== "")) {
    const m = /^(proof:[\w:.-]+) ([A-Z][A-Z0-9_]*)$/.exec(line);
    if (!m) throw new Error(`--list-self-skipping-proofs printed an unreadable line: ${JSON.stringify(line)}`);
    out.set(m[1], m[2]);
  }
  return out;
}

/** Self-skipping proofs a workflow really runs (rounds 31–32). A step credits
 *  `<proof>` only when ALL of these hold, each an allowlist measured from the
 *  real crediting job (review-hub-ci.yml `durable-persistence`):
 *   - the workflow's `on:` includes `push` or `pull_request` (a schedule- or
 *     dispatch-only workflow never runs on a change);
 *   - every key of the job is in JOB_KEYS — so no `if`, `needs` (a job that
 *     never runs takes its dependents with it), `strategy` (a matrix can exclude
 *     every combination), `continue-on-error`, `container`, `environment`;
 *   - every key of the step is in STEP_KEYS — so no `if`, `shell`,
 *     `continue-on-error`, `working-directory`, `uses`;
 *   - its `run` is EXACTLY `pnpm run <proof>`;
 *   - the proof's env var is a non-empty literal: the STEP's value when the
 *     step's env has the key (GitHub's precedence — an empty step value
 *     overrides the job's), else the job's; a `${{ … }}` expression is not a
 *     literal and may be empty at run time.
 *  Workflow-level `env` is not credited (safe side). `files` is [{ path, text }];
 *  a workflow that does not parse throws. The returned Set carries `refusals`:
 *  proof -> why each candidate step (one whose `run` names `pnpm run <proof>`)
 *  was refused, so a failure names its cause. */
const JOB_KEYS = new Set(["name", "runs-on", "timeout-minutes", "services", "steps", "env", "permissions"]);
const STEP_KEYS = new Set(["name", "id", "env", "run", "timeout-minutes"]);
const CREDIT_TRIGGERS = new Set(["push", "pull_request"]);
export function envRunsFromWorkflows(files, selfSkipping) {
  const out = new Set();
  const refusals = new Map();
  const refuse = (proof, why) => refusals.set(proof, [...(refusals.get(proof) ?? []), why]);
  for (const { path, text } of files) {
    const doc = parseDocument(text);
    if (doc.errors.length) throw new Error(`${path} does not parse as YAML: ${doc.errors[0].message}`);
    const wf = doc.toJS();
    const on = wf?.on;
    const triggers = typeof on === "string" ? [on] : Array.isArray(on) ? on : on && typeof on === "object" ? Object.keys(on) : [];
    const triggered = triggers.some((t) => CREDIT_TRIGGERS.has(t));
    for (const [jobId, job] of Object.entries(wf?.jobs ?? {})) {
      if (!job || typeof job !== "object") continue;
      const badJobKey = Object.keys(job).find((k) => !JOB_KEYS.has(k));
      for (const [n, step] of (Array.isArray(job.steps) ? job.steps : []).entries()) {
        if (!step || typeof step.run !== "string") continue;
        const named = [...step.run.matchAll(/pnpm run (proof:[\w:.-]+)/g)].map((m) => m[1]).filter((x) => selfSkipping.has(x));
        for (const proof of new Set(named)) {
          const where = `${path} job \`${jobId}\` step ${n + 1}`;
          const env = selfSkipping.get(proof);
          const badStepKey = Object.keys(step).find((k) => !STEP_KEYS.has(k));
          const stepHas = step.env && typeof step.env === "object" && Object.hasOwn(step.env, env);
          const v = stepHas ? step.env[env] : job.env && typeof job.env === "object" ? job.env[env] : undefined;
          if (!triggered) refuse(proof, `${path}: its \`on:\` has neither push nor pull_request`);
          else if (badJobKey) refuse(proof, `${where}: job key \`${badJobKey}\` is outside the allowlist (${[...JOB_KEYS].join(", ")})`);
          else if (badStepKey) refuse(proof, `${where}: step key \`${badStepKey}\` is outside the allowlist (${[...STEP_KEYS].join(", ")})`);
          else if (step.run.trim() !== `pnpm run ${proof}`) refuse(proof, `${where}: its \`run\` is not exactly \`pnpm run ${proof}\``);
          else if (typeof v !== "string" || v.trim() === "" || v.includes("${{")) refuse(proof, `${where}: ${env} is unset, empty or not a literal${stepHas ? " in the step's own env, which wins over the job's" : ""}`);
          else out.add(proof);
        }
      }
    }
  }
  out.refusals = refusals;
  return out;
}

function realContext() {
  const stage = execFileSync("git", ["ls-files", "-s", "-z"], { cwd: ROOT, encoding: "utf8" });
  const tracked = parseLsFilesStage(stage);
  const indexed = [...parseLsFilesIndex(stage).keys()];
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {};
  const gatedProofs = new Set();
  const lanes = {};
  const spawn = (args, what) => {
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) throw new Error(`${what} failed (${r.error ? (r.error.code ?? r.error.message) : `exit ${r.status}`}) — the gating proofs cannot be read`);
    return r.stdout;
  };
  for (const lane of ["scripts/preflight.mjs", "scripts/verify-breadth.mjs"]) {
    lanes[lane] = gatedProofsFromListing(spawn([join(ROOT, lane), "--list-steps"], `${lane} --list-steps`), lane);
    for (const p of lanes[lane]) gatedProofs.add(p);
  }
  const selfSkipping = selfSkippingFromListing(spawn([join(ROOT, "scripts/check-preflight-ci-parity.mjs"), "--list-self-skipping-proofs"], "scripts/check-preflight-ci-parity.mjs --list-self-skipping-proofs"));
  const workflows = tracked.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f)).map((f) => ({ path: f, text: readFileSync(join(ROOT, f), "utf8") }));
  const envRuns = envRunsFromWorkflows(workflows, selfSkipping);
  return { root: ROOT, tracked, indexed, scripts, gatedProofs, lanes, selfSkipping, envRuns, workflows };
}

/** One verdict on one document, as text: the CLI prints it, and the self-test
 *  reads it in-process against a context built ONCE (round 30: every spawned case
 *  rebuilt the context — git plus both lane runners — and the self-test took
 *  minutes). */
function evaluate(text, ctx, docPath) {
  const out = [], err = [];
  const res = checkMatrix(text, ctx);
  let bad = res.structural.length;
  for (const s of res.structural) err.push(`FAIL  ${s}`);
  if (res.rows.length < ROW_FLOOR) { err.push(`FAIL  parsed ${res.rows.length} control rows (< floor ${ROW_FLOOR}) — the parser broke`); bad += 1; }
  const known = [];
  const used = new Set();
  for (const f of res.fails) {
    const k = KNOWN_FAILURES.findIndex((e, idx) => !used.has(idx) && e.control === f.control && e.status === f.status
      && e.why.length === f.why.length && e.why.every((w, n) => w === f.why[n]));
    if (k !== -1) { used.add(k); known.push({ ...f, reason: KNOWN_FAILURES[k].reason }); continue; }
    bad += 1;
    err.push(`FAIL  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}`);
  }
  KNOWN_FAILURES.forEach((e, idx) => {
    if (!used.has(idx)) { bad += 1; err.push(`FAIL  KNOWN_FAILURES entry "${e.control}" no longer fails exactly as declared (row gone, status changed, or its failures changed) — update or remove it`); }
  });
  for (const f of known) {
    out.push(`KNOWN (owner decision needed)  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}\n      - declared: ${f.reason}`);
  }
  const impl = res.rows.filter((r) => r.status === IMPLEMENTED).length;
  out.push(`security-controls-matrix: ${res.rows.length} rows, ${impl} "${IMPLEMENTED}", matrix-wide proof ${res.defaultProof ?? "MISSING"}; ${bad} new failure(s), ${known.length} known (owner decision needed)`);
  return { status: bad === 0 ? 0 : 1, stdout: out.join("\n"), stderr: err.join("\n") };
}

function run(docPath, ctx = realContext()) {
  const r = evaluate(readFileSync(docPath, "utf8"), ctx, docPath);
  if (r.stderr) console.error(r.stderr);
  if (r.stdout) console.log(r.stdout);
  return r.status;
}

/** Add a column to the FIRST controls table: header, separator and every row. */
function addColumn(text, name) {
  const lines = text.split("\n");
  const h = lines.findIndex((l) => l.startsWith("| Control | Framework refs | Status | Where |"));
  lines[h] = `${lines[h]} ${name} |`;
  lines[h + 1] = `${lines[h + 1]} --- |`;
  for (let j = h + 2; lines[j]?.startsWith("|"); j += 1) lines[j] = `${lines[j]} Implemented (public core) |`;
  return lines.join("\n");
}

function selfTest() {
  const real = readFileSync(join(ROOT, DOC), "utf8");
  const dir = mkdtempSync(join(tmpdir(), "sg-matrix-"));
  const anchor = "| Typed request/response contracts |";
  if (!real.includes(anchor)) throw new Error(`self-test anchor row missing: ${anchor}`);
  const plant = (row) => real.replace(anchor, `${row}\n${anchor}`);
  // live line numbers for the round-30 anchor cases, read from the tree
  const lineOf = (f, needle) => readFileSync(join(ROOT, f), "utf8").split("\n").findIndex((l) => l.includes(needle)) + 1;
  const anchorAt = { n: lineOf("lib/signalgrid-core/src/policy.ts", "export function validatePolicyRules("), m: lineOf("scripts/preflight.mjs", '"proof:backup-restore"') };
  if (anchorAt.n < 2 || anchorAt.m < 2) throw new Error("self-test anchor targets missing (validatePolicyRules / proof:backup-restore)");
  const cases = [
    ["pass: the real doc", real, 0],
    ["pass: a valid planted Implemented row", plant("| Planted valid control | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:signalgrid-core` |"), 0],
    ["fail: status word outside the legend", plant("| Planted bad status | ASVS 5.0 | **Mostly done** | `lib/signalgrid-core/src/policy.ts` |"), 1],
    ["fail: Implemented row citing a missing path", plant("| Planted missing path | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/no-such-file.ts` |"), 1],
    ["fail: Implemented row citing a missing proof", plant("| Planted missing proof | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:no-such-proof` |"), 1],
    ["fail: Implemented row citing no path", plant("| Planted no path | ASVS 5.0 | Implemented (public core) | the core, somewhere |"), 1],
    ["fail: a KNOWN_FAILURES entry outlives its reason", real.replace("| **Implemented in THIS repo** |", "| Private-core (planned) |"), 1],
    // review round 1 of PR #1349: rows the parser cannot place must fail, never vanish
    ["fail: a blank line splits rows from their table", real.replace("\n| Deny-by-default RBAC", "\n\n| Deny-by-default RBAC"), 1],
    ["fail: a controls table's Status column renamed", real.replace("| Control | Framework refs | Status | Where |", "| Control | Framework refs | State | Where |"), 1],
    ["fail: an unrecognised table appended", `${real}\n| Control | Refs | Status | Evidence |\n| --- | --- | --- | --- |\n| Planted bogus | x | Bogus | \`nope.ts\` |\n`, 1],
    ["fail: an escaped pipe shifts a row's columns", plant("| Planted a \\| b control | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` |"), 1],
    // review round 2 of PR #1349: KNOWN_FAILURES match exactly; the legend is pinned;
    // evidence must be tracked; a rendered row without a leading pipe is still a row
    ["fail: a known row's status changed", real.replace("| **Implemented in THIS repo** |", "| **Shipped and SOC2 certified** |"), 1],
    ["fail: a known row gains a second failure", real.replace("`lib/webauthn`", "`lib/no-such-dir`"), 1],
    ["fail: a duplicate Control row", plant("| Real authentication provider, sessions, MFA/step-up assurance | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: a word added to the legend", real.replace("| **Human-owned (planned)** | A program", "| **Implemented** | done |\n| **Human-owned (planned)** | A program"), 1],
    ["fail: a second legend table", `${real}\n| Status | Meaning |\n| --- | --- |\n| Enforced (production) | done |\n`, 1],
    ["fail: evidence outside the repo (`..`)", plant("| Planted escape | ASVS 5.0 | Implemented (public core) | `lib/../../../../etc/passwd` |"), 1],
    ["fail: evidence that is a top-level dir", plant("| Planted top dir | ASVS 5.0 | Implemented (public core) | `lib/` |"), 1],
    ["fail: evidence that is untracked (node_modules)", plant("| Planted untracked | ASVS 5.0 | Implemented (public core) | `node_modules/typescript/package.json` |"), 1],
    ["fail: a table row without its leading pipe", real.replace("\n| PostgreSQL row-level security", "\nPostgreSQL row-level security").replace("| Private-core (planned) | Private production repo (durable persistence layer) |", "| Bogus | Private production repo (durable persistence layer) |"), 1],
    ["fail: a controls table inside a blockquote", `${real}\n> | Control | Framework refs | Status | Where |\n> | --- | --- | --- | --- |\n> | Planted quoted | x | Bogus | \`nope.ts\` |\n`, 1],
    ["fail: an Automated row citing a missing workflow", real.replace("`.github/workflows/codeql.yml`", "`.github/workflows/no-such.yml`"), 1],
    // review round 3 of PR #1349: every shape that RENDERS as a row is gated
    ["fail: a raw-HTML table row", `${real}\n<table><tr><th>Control</th><th>Status</th><th>Where</th></tr><tr><td>Planted html</td><td>Implemented (public core)</td><td><code>lib/no/such.ts</code></td></tr></table>\n`, 1],
    // round 4: the column is added to EVERY row, so the header check — not the cell
    // count — is what must catch it
    ["fail: a duplicated Status column (cells on every row)", addColumn(real, "Status"), 1],
    ["fail: an extra re-cased status column", addColumn(real, "status"), 1],
    ["fail: an extra column with a new name", addColumn(real, "Assurance"), 1],
    ["fail: the binding only in a link reference definition", real.replace(/is exercised by\n`pnpm run (proof:[\w:.-]+)`/, "is covered by\nthe core proof") + '\n[sg]: https://example.invalid "Everything marked **Implemented (public core)** is exercised by `pnpm run proof:signalgrid-core`"\n', 1],
    ["fail: a non-blank line straight after a table", real.replace("\n\n---\n\n## 2. Authentication", "\nPlanted trailing row\n\n---\n\n## 2. Authentication"), 1],
    ["fail: a duplicate Control hidden by an NBSP", plant("| Real authentication provider,\u00A0sessions, MFA/step-up assurance | x | Private-core (planned) | private repo |"), 1],
    ["fail: a legend meaning inflated", real.replace("verified by the core proof. |", "independently audited (SOC 2 Type II). |"), 1],
    ["fail: an unparseable path citation beside a valid one", plant("| Planted unparsed | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `lib/no such dir/x.ts` |"), 1],
    ["fail: the matrix cited as its own evidence", plant("| Planted circular | ASVS 5.0 | Implemented (public core) | `docs/SECURITY_CONTROLS_MATRIX.md` |"), 1],
    ["fail: the binding survives only in an HTML comment", real.replace(/is exercised by\s+`pnpm run (proof:[\w:.-]+)`/, "is exercised by the core proof <!-- is exercised by `pnpm run $1` -->"), 1],
    // round 5: bare CR, duplicate legend word, the binding paragraph pinned, claims outside Status
    ["pass: a CRLF copy of the real doc", real.replace(/\n/g, "\r\n"), 0],
    ["fail: a bare carriage return splits a row", plant("| Planted A\r| Bogus control | Private-core (planned) | Implemented (public core) |"), 1],
    ["fail: a duplicated legend word with an inflated meaning", real.replace("| **Implemented (public core)** | Enforced", "| **Implemented (public core)** | Independently audited (SOC 2 Type II). |\n| **Implemented (public core)** | Enforced"), 1],
    ["fail: the binding negated in visible text", real.replace("runs in the deterministic,", "is NOT yet verified; it runs in the deterministic,"), 1],
    ["fail: the binding only in a list-item link definition", real.replace(/is exercised by\n`pnpm run (proof:[\w:.-]+)`/, "is covered by\nthe core proof") + '\n- [sg]: https://example.invalid "Everything marked **Implemented (public core)** is exercised by `pnpm run proof:signalgrid-core`"\n', 1],
    ["fail: the binding only in a link title", real.replace(/is exercised by\n`pnpm run (proof:[\w:.-]+)`/, "is covered by\nthe core proof") + '\nSee [the proof](https://example.invalid "Everything marked **Implemented (public core)** is exercised by `pnpm run proof:signalgrid-core`").\n', 1],
    ["fail: a status claim in the Framework refs cell", plant("| Planted fw claim | **Implemented (public core)** | Private-core (planned) | private repo |"), 1],
    ["fail: a status claim in the Short ref table", real.replace("| **ASVS 5.0** |", "| **MFA** | **Implemented (public core)** — enforced in production |\n| **ASVS 5.0** |"), 1],
    // round 6: CommonMark blank lines, opaque blocks, harder claim folding
    ["fail: an NBSP line after a table, then a claim line", real.replace("\n\n---\n\n## 2. Authentication", "\n\u00A0\nMFA for every operator — Implemented (public core), SOC 2 certified\n\n---\n\n## 2. Authentication"), 1],
    ["fail: a form-feed line after the legend", real.replace("cannot be responsibly automated away. |\n", "cannot be responsibly automated away. |\n\f\nImplemented (public core) also means SOC 2 audited\n"), 1],
    ["fail: a retraction joined to the binding by an NBSP line", real.replace("over synthetic data.\n", "over synthetic data.\n\u00A0\nRetracted: none of the above is exercised by any proof.\n"), 1],
    ["fail: the binding inside a details block", real.replace(/\nEverything marked \*\*Implemented/, "\n<details>\n\nEverything marked **Implemented").replace("over synthetic data.\n", "over synthetic data.\n\n</details>\n"), 1],
    ["fail: the binding inside a code fence", real.replace(/\nEverything marked \*\*Implemented/, "\n```\n\nEverything marked **Implemented").replace("over synthetic data.\n", "over synthetic data.\n\n```\n"), 1],
    ["fail: a soft-hyphenated claim in the Short ref table", real.replace("| **ASVS 5.0** |", "| **MFA** | Imple&shy;mented (public core) |\n| **ASVS 5.0** |"), 1],
    ["fail: a homoglyph claim in a Framework refs cell", plant("| Planted fw2 | Impl\u0435mented (public core) | Private-core (planned) | private repo |"), 1],
    // a look-alike the confusables map does not know (U+026A) — only the ASCII rule catches it
    ["fail: an unmapped look-alike in a Short ref cell", real.replace("| **ASVS 5.0** |", "| **MFA** | \u026Amplemented (public core) |\n| **ASVS 5.0** |"), 1],
    ["fail: a legend word split by markup in a Control name", plant("| Imple<b></b>mented (public core) MFA | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: a legend word hidden by an entity in a Control name", plant("| Imple&shy;mented (public core) MFA | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    // round 8: link/image/strikethrough syntax in Control names and Where cells
    ["fail: an empty link splitting a legend word in a Control name", plant("| Imple[](/x)mented (public core) ZZ1 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: an empty image splitting a legend word in a Control name", plant("| Auto![](#)mated (CI bot) ZZ2 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: link text completing a legend word in a Control name", plant("| Implemented[ (public core)](/x) ZZ3 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: cited evidence re-linked to an external host", real.replace("| `lib/signalgrid-core/src/policy.ts` (`validatePolicyRules`)", "| [`lib/signalgrid-core/src/policy.ts`](https://evil.invalid) (`validatePolicyRules`)"), 1],
    ["fail: strikethrough in a Where cell", real.replace("| `lib/signalgrid-core/src/policy.ts` (`validatePolicyRules`)", "| `lib/signalgrid-core/src/policy.ts` ~~not actually~~ (`validatePolicyRules`)"), 1],
    // round 9: invisible characters and look-alikes outside any fold list
    ["fail: a combining grapheme joiner (U+034F) inside a legend word in a Control name", plant("| Imple\u034Fmented (public core) ZZ9 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: an Armenian look-alike (U+0578) in a legend word in a Control name", plant("| Impleme\u0578ted (public core) ZZ9 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: a halfwidth filler (U+FFA0) inside a legend word in a Control name", plant("| Imple\uFFA0mented (public core) ZZ9 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: an invisible character in a Private-core Where cell", plant("| Planted W9 | ASVS 5.0 | Private-core (planned) | Imple\u034Fmented (public core) |"), 1],
    // round 10: emphasis/code duplicates, code-span word splits
    ["fail: a duplicate Control differing only by italics", real.replace("| PostgreSQL row-level security supplementing app-layer checks |", "| _PostgreSQL_ row-level security supplementing app-layer checks | ASVS 5.0 | Human-owned (planned) | private repo |\n| PostgreSQL row-level security supplementing app-layer checks |"), 1],
    ["fail: a duplicate Control with its code-span backticks dropped", plant("| Cross-tenant access denied, not silently ignored (cross_tenant_denied, HTTP 403) | ASVS 5.0 | Human-owned (planned) | private repo |"), 1],
    ["fail: a whitespace code span splitting a word in a Control name", plant("| Imple`` ``mented (public core) ZZ9 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: a code span abutting letters in a Control name", plant("| `Imple`mented (public core) ZZ9 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    // round 11: leading-slash paths and Automated-row citations the parser skipped
    ["fail: an absolute path beside a valid one on an Implemented row", plant("| Planted P13 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `/lib/signalgrid-core/src/no-such-file.ts` |"), 1],
    ["fail: /etc/passwd beside a valid path on an Implemented row", plant("| Planted P14 | ASVS 5.0 | Implemented (public core) | `/etc/passwd`; `lib/signalgrid-core/src/policy.ts` |"), 1],
    // round 13: only the exact tokens `/` and `/v1` are exempt — no `/v1`-prefixed path
    ...["/v1-lib/signalgrid-core/src/no-such-file.ts", "/v1/lib/signalgrid-core/src/no-such-file.ts", "/v1/../../etc/passwd", "/v1.ts", "/v1:/etc/passwd"].map((t, i) =>
      [`fail: ${t} beside a valid path on an Implemented row`, plant(`| Planted V${i} | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts\`; \`${t}\` |`), 1]),
    ["fail: a /v1-prefixed path on an Automated row", plant("| Planted A4 | ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml`; `/v1-scripts/no-such-gate.mjs` |"), 1],
    ["pass: the exact route tokens `/` and `/v1` beside a valid path", plant("| Planted V9 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `/`; `/v1` |"), 0],
    // round 14: a proof/command citation in any shape citedProofs cannot read fails
    ...["pnpm run proof:no-such-proof -- --x", "pnpm run proof:no/such", "pnpm  run proof:no-such", "proof:lib/no-such.ts", "proof:/etc/passwd", "pnpm run lib/no-such.ts", "pnpm run no-such-script"].map((t, i) =>
      [`fail: malformed proof citation ${t} beside a valid path on an Implemented row`, plant(`| Planted Q${i} | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts\`; \`${t}\` |`), 1]),
    ["fail: a malformed proof beside a valid own proof on an Implemented row", plant("| Planted Q8 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:signalgrid-core`; `proof:no/such` |"), 1],
    ["fail: a malformed proof citation on an Automated row", plant("| Planted A5 | ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml`; `proof:lib/no-such.ts` |"), 1],
    ["pass: a well-formed own proof beside a valid path", plant("| Planted Q9 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:signalgrid-core` |"), 0],
    // round 15: a proof/command span in any case, padding or prefix fails too
    ...["PROOF:zzz", " proof:zzz ", "(proof:zzz)", "run proof:zzz", "proof :zzz", "npm run proof:zzz", "Pnpm run proof:x", "yarn proof:no-such-proof"].map((t, i) =>
      [`fail: proof-like span \`${t}\` beside a valid path on an Implemented row`, plant(`| Planted K${i} | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts\`; \`${t}\` |`), 1]),
    ["fail: a case-variant proof span on an Automated row", plant("| Planted A6 | ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml`; `PROOF:zzz` |"), 1],
    ["fail: a well-formed missing proof on an Automated row", plant("| Planted A7 | ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml`; `pnpm run proof:zzz-no-such` |"), 1],
    ["pass: a bare `pnpm` word and `pnpm-workspace.yaml` beside a valid path", plant("| Planted K9 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm`; `pnpm-workspace.yaml` |"), 0],
    // round 16: multi-backtick runs and unclosed backticks in a Where cell
    ["fail: a double-backtick span hiding proof: on an Implemented row", plant("| Planted M0 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; ``x` proof:zzz`` |"), 1],
    ["fail: a padded double-backtick span with an inner backtick on an Implemented row", plant("| Planted M1 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `` ` pnpm run proof:zzz` `` |"), 1],
    ["fail: a triple-backtick span hiding proof: on an Implemented row", plant("| Planted M2 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; ```x` proof:zzz``` |"), 1],
    ["fail: a double-backtick span hiding proof: on an Automated row", plant("| Planted M3 | ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml`; ``x` pnpm run proof:nosuch`` |"), 1],
    ["fail: an unclosed backtick on an Implemented row", plant("| Planted M4 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `proof:zzz |"), 1],
    // round 17: citations in a Control name
    ...["Planted C0 (`pnpm run proof:zzz`)", "Planted C1 (`PROOF:zzz`)", "Planted C2 (`npm run proof:zzz`)", "Planted C3 in `lib/no-such-file.ts`", "Planted C4 (proof:zzz)", "Planted C5 `` ` y` ``", "Planted C6 ``x` y``", "Planted C7 in `lib/no-such-file.ts", "Planted C8 `npm run test`", "Planted D0 `foo.ts`", "Planted D1 `scripts/foo`", "Planted D2 in `no-such-file.ts:12`", "Planted D3 in `no-such-gate.mjs#L1`", "Planted D4 in `no-such-file.py`", "Planted D5 in `no-such-file.TS`", "Planted D6 pro**of**:zzz", "Planted D7 _proof_:zzz", "Planted D8 `proof`:zzz", "Planted E0 in `no-such.ts:12:5`", "Planted E1 in `no-such.ts@v2`", "Planted E2 in `no-such.ts,`", "Planted E3 in `no-such.ts `", "Planted E4 in `no-such.ts:L12`", "Planted E5 in `.env`", "Planted E6 `object.id`", "Planted E7 `no-such`.ts", "Planted F0 in `a`.`ts`", "Planted F1 no-such.`ts`", "Planted F2 `no-such`.TS", "Planted F3 `no-such`*.ts*", "Planted F4 `no-such`.**ts**", "Planted F5 *no-such*.`ts`", "Planted F6 `x`*.*`ts`", "Planted F7 `no-such`_.ts_", "Planted F8 `no-such`.__ts__", "Planted G0 `no-such`**.ts**", "Planted G1 `no-such`__.ts__"].flatMap((ctl) => [
      [`fail: Control name ${ctl} on an Implemented row`, plant(`| ${ctl} | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts\` |`), 1],
      [`fail: Control name ${ctl} on an Automated row`, plant(`| ${ctl} | ASVS 5.0 | Automated (CI bot) | \`.github/workflows/review-hub-ci.yml\` |`), 1]]),
    ["pass (documented ceiling): a digit-led extension in a Control span reads as a version-like word", plant("| Planted F9 `no-such.7z` | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` |"), 0],
    ["pass (documented ceiling): an extension-less file name in a Control span reads as a word", plant("| Planted E9 `Dockerfile` | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` |"), 0],
    ["pass: Control-name spans like the matrix's own (`/v1`, `pnpm`, an identifier)", plant("| Planted C9 on `/v1` and `/` via `pnpm`, `unsafeStore()`, `object.id + tenant_id` and `v1.2` | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` |"), 0],
    // round 23: a bare basename or `./` citation goes through every inRepo rule
    ...["`SECURITY_CONTROLS_MATRIX.md`", "`SECURITY_CONTROLS_MATRIX.md:12`", "`./SECURITY_CONTROLS_MATRIX.md`", "`SECURITY_CONTROLS_MATRIX.md/`", "`./PURPOSE.md`", "`index.ts`"].flatMap((w, i) => [
      [`fail: Implemented row whose only evidence is ${w}`, plant(`| Planted H${i} | ASVS 5.0 | Implemented (public core) | ${w} |`), 1],
      [`fail: Automated row citing ${w} beside a valid workflow`, plant(`| Planted H${i} | ASVS 5.0 | Automated (CI bot) | \`.github/workflows/review-hub-ci.yml\`; ${w} |`), 1]]),
    // round 24: the lastDir branch also runs every inRepo rule
    ["fail: the matrix's basename beside a path in its own directory", plant("| Planted H10 | ASVS 5.0 | Implemented (public core) | `docs/PURPOSE.md`; `SECURITY_CONTROLS_MATRIX.md` |"), 1],
    ["fail: the matrix's basename beside a directory under docs/", plant("| Planted H11 | ASVS 5.0 | Implemented (public core) | `docs/agent`; `SECURITY_CONTROLS_MATRIX.md` |"), 1],
    // round 28 (Codex): an empty Control cell; a slash-free name.ext with a repo extension; indented tables
    ["fail: an Implemented row with an empty Control cell", plant("| | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` |"), 1],
    ...["no-such.py", "no-such.rs", "no-such.toml"].flatMap((t, i) => [
      [`fail: a missing \`${t}\` beside a valid path on an Implemented row`, plant(`| Planted J${i} | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts\`; \`${t}\` |`), 1],
      [`fail: a missing \`${t}\` beside a valid workflow on an Automated row`, plant(`| Planted J${i} | ASVS 5.0 | Automated (CI bot) | \`.github/workflows/review-hub-ci.yml\`; \`${t}\` |`), 1]]),
    ["pass: an identifier whose suffix no tracked file has (`ApiKeyRecord.token`) stays prose", plant("| Planted J9 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `ApiKeyRecord.token` |"), 0],
    ["fail: every control table indented four spaces (renders as code)", (() => { let inCtl = false; return real.split("\n").map((l) => { if (l.startsWith("| Control | Framework refs | Status | Where |")) inCtl = true; else if (!l.startsWith("|")) inCtl = false; return inCtl ? `    ${l}` : l; }).join("\n"); })(), 1],
    ["fail: one control row indented four spaces", real.replace("\n| Deny-by-default RBAC", "\n    | Deny-by-default RBAC"), 1],
    ["fail: one control row indented by a tab", real.replace("\n| Deny-by-default RBAC", "\n\t| Deny-by-default RBAC"), 1],
    ["pass: a control row indented three spaces is still a row", real.replace("\n| Deny-by-default RBAC", "\n   | Deny-by-default RBAC"), 0],
    // round 29 (Codex): raw HTML mid-line; a delimiter row that does not match its header
    ["fail: a mid-line HTML opener before the control tables (`intro <details>`)", real.replace("| Control | Framework refs | Status | Where |\n| ------- |", "intro <details>\n\n| Control | Framework refs | Status | Where |\n| ------- |"), 1],
    ["fail: a mid-line HTML closer after the control tables (`outro </details>`)", `${real}\noutro </details>\n`, 1],
    ["fail: a mid-line HTML comment-like `<!` opener", `${real}\nsee <!DOCTYPE x> here\n`, 1],
    ["pass: a tag inside a code span and a bare `a < b` are not raw HTML", `${real}\nThe matrix uses no \`<details>\` block, and a < b is prose.\n`, 0],
    ["fail: a one-cell delimiter row under a four-cell header", real.replace("| Control | Framework refs | Status | Where |\n| ------- | -------------- | ------ | ----- |", "| Control | Framework refs | Status | Where |\n| --- |"), 1],
    ["fail: a malformed delimiter cell", real.replace("| Control | Framework refs | Status | Where |\n| ------- | -------------- | ------ | ----- |", "| Control | Framework refs | Status | Where |\n| ------- | -------------- | x | ----- |"), 1],
    ["fail: a five-cell delimiter row under a four-cell header", real.replace("| Control | Framework refs | Status | Where |\n| ------- | -------------- | ------ | ----- |", "| Control | Framework refs | Status | Where |\n| --- | --- | --- | --- | --- |"), 1],
    ["pass: an aligned delimiter row (`:---`, `:---:`, `---:`)", real.replace("| Control | Framework refs | Status | Where |\n| ------- | -------------- | ------ | ----- |", "| Control | Framework refs | Status | Where |\n| :--- | :---: | ---: | --- |"), 0],
    // round 30 (Codex): a fence opened behind a list or blockquote prefix
    ["fail: a fence opened inside a list item before a control table, rows indented two spaces", (() => { let inCtl = false, done = false; return real.split("\n").flatMap((l) => { if (!done && l.startsWith("| Control | Framework refs | Status | Where |")) { inCtl = true; done = true; return ["- ```", `  ${l}`]; } if (inCtl && l.startsWith("|")) return [`  ${l}`]; inCtl = false; return [l]; }).join("\n"); })(), 1],
    ["fail: a tilde fence behind a blockquote and a list marker", real.replace("| Control | Framework refs | Status | Where |\n| ------- |", "> 1. ~~~\n\n| Control | Framework refs | Status | Where |\n| ------- |"), 1],
    ["fail: a fence in a nested list item", real.replace("| Control | Framework refs | Status | Where |\n| ------- |", "- a\n  - ```\n\n| Control | Framework refs | Status | Where |\n| ------- |"), 1],
    ["fail: a three-backtick run mid-line", `${real}\nsee \`\`\` here\n`, 1],
    ["pass: a two-backtick code span in prose is not a fence", `${real}\nThe \`\`a \` b\`\` span is prose.\n`, 0],
    // round 30 (refute): code spans by CommonMark's pairing; a line it cannot settle fails
    ["fail: a single backtick does not close on a longer run (\"intro `<details>``\")", real.replace("| Control | Framework refs | Status | Where |\n| ------- |", "intro `<details>``\n\n| Control | Framework refs | Status | Where |\n| ------- |"), 1],
    ["fail: a code span opened on the previous line hides no tag (\"b` <details> `c\")", `${real}\nopen \`a\nb\` <details> \`c\nd\` done\n`, 1],
    ["fail: a backslash before a backtick (\"\\` <details> `\")", `${real}\nx \\\` <details> \` y\n`, 1],
    ["pass: a tag inside a properly paired span, including a nested shorter run", `${real}\nNo \`<details>\` and no \`\`<b> \` x\`\` here.\n`, 0],
    // round 30 (Codex): a `path:NN` anchor must exist and land on the row's subject
    ["fail: correcting the real row's anchor leaves its KNOWN_FAILURES entry stale", real.replace("`scripts/preflight.mjs:486`", `\`scripts/preflight.mjs:${anchorAt.m}\``), 1],
    ["pass: an anchor on the line that defines the cited identifier", plant(`| Planted N7 | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts:${anchorAt.n}\` (\`validatePolicyRules\`) |`), 0],
    ["pass: an anchor on the line of the cited proof's step, on an Automated row", plant(`| Planted N8 | ASVS 5.0 | Automated (CI bot) | \`scripts/preflight.mjs:${anchorAt.m}\`; \`pnpm run proof:backup-restore\` |`), 0],
    ["pass: a unique, present bare basename resolves (`PURPOSE.md` -> docs/PURPOSE.md)",plant("| Planted H9 | ASVS 5.0 | Implemented (public core) | `PURPOSE.md` |"), 0],
    // round 23: claimFold's emphasis strip — a legend word split by ** or __ in a Control name
    ["fail: a legend word split by ** in a Control name", plant("| Im**ple**men**ted (public core) ZZ7 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: a legend word split by __ in a Control name", plant("| Imple__men__ted (public core) ZZ8 | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    ["fail: a leading-slash missing workflow on an Automated row", plant("| Planted A1 | ASVS 5.0 | Automated (CI bot) | `/.github/workflows/no-such.yml` |"), 1],
    ["fail: an unparseable path on an Automated row", plant("| Planted A2 | ASVS 5.0 | Automated (CI bot) | `scripts/no such gate.mjs` |"), 1],
    ["fail: a repo path disguised as an action ref on an Automated row", plant("| Planted A3 | ASVS 5.0 | Automated (CI bot) | `scripts/no-such-gate.mjs@v2` |"), 1],
    ["fail: a legend word in a Control name", plant("| **Implemented (public core)** MFA everywhere | ASVS 5.0 | Private-core (planned) | private repo |"), 1],
    // round 7: link/image syntax splitting a claim; every claim word exercised
    ["fail: an empty link splitting a claim in Framework refs", plant("| Planted L | Imple[](/x)mented | Private-core (planned) | private repo |"), 1],
    ["fail: an empty image splitting a claim in Framework refs", plant("| Planted I | cert![](/x)ified | Private-core (planned) | private repo |"), 1],
    ["fail: an empty link splitting a claim in the Short ref table", real.replace("| **ASVS 5.0** |", "| **MFA** | Imple[](/x)mented (public core) |\n| **ASVS 5.0** |"), 1],
    ["fail: 'compliant' in Framework refs", plant("| Planted C | SOC 2 compliant | Private-core (planned) | private repo |"), 1],
    ["fail: 'accredited' in Framework refs", plant("| Planted A | ISO accredited | Private-core (planned) | private repo |"), 1],
    ["fail: 'audited' in Framework refs", plant("| Planted U | audited yearly | Private-core (planned) | private repo |"), 1],
    ["fail: 'attested' in Framework refs", plant("| Planted T | SOC 2 attested | Private-core (planned) | private repo |"), 1],
    ["fail: matrix-wide proof binding deleted", real.replace(/is exercised by\s+`pnpm run proof:[\w:.-]+`/, "is exercised by the core proof"), 1],
  ];
  let ok = true;
  const ctx = realContext(); // built ONCE for every case (round 30)
  try {
    // the CLI end to end, twice — a spawned `--doc` run reads the file and builds
    // its own context; every other case runs in-process on the same verdict code
    for (const [name, text, want] of [["CLI: the real doc", real, 0], ["CLI: status word outside the legend", plant("| Planted CLI | ASVS 5.0 | **Mostly done** | `lib/signalgrid-core/src/policy.ts` |"), 1]]) {
      const f = join(dir, "SECURITY_CONTROLS_MATRIX.md");
      writeFileSync(f, text);
      const r = spawnSync(process.execPath, [SELF, "--doc", f], { cwd: ROOT, encoding: "utf8" });
      const pass = r.status === want && (want === 0 || /FAIL {2}.*\n {6}.*\S/.test(r.stderr));
      if (!pass) ok = false;
      console.log(`${pass ? "ok  " : "BAD "} self-test ${name} (spawned, exit ${r.status}, want ${want})${pass ? "" : `\n${r.stderr}`}`);
    }
    for (const [name, text, want] of cases) {
      const r = evaluate(text, ctx, "SECURITY_CONTROLS_MATRIX.md");
      // a failure must QUOTE the offending row (or name the stale entry), never just exit 1
      const quoted = want === 1 ? /FAIL {2}.*\n {6}.*\S/.test(r.stderr) || /KNOWN_FAILURES entry ".+" no longer fails/.test(r.stderr) || /FAIL {2}(Status legend is|expected exactly one Status legend)/.test(r.stderr) : true;
      const pass = r.status === want && quoted;
      if (!pass) ok = false;
      console.log(`${pass ? "ok  " : "BAD "} self-test ${name} (exit ${r.status}, want ${want})${pass ? "" : `\n${r.stderr}`}`);
    }
    // round 24: in-process cases for what a planted doc cannot reach
    const phantom = "docs/zz-phantom-tracked-not-on-disk.md";
    const inproc = [
      // tracked AND present: a path the index lists but the disk lacks is not evidence
      ["fail: a tracked path absent from disk (in-process, phantom in the tracked list)", () => {
        const res = checkMatrix(plant(`| Planted H12 | ASVS 5.0 | Implemented (public core) | \`${phantom}\` |`), { ...ctx, tracked: [...ctx.tracked, phantom], indexed: [...ctx.indexed, phantom] });
        return res.fails.some((f) => f.control === "Planted H12" && f.why.some((w) => w.includes(`\`${phantom}\` is not a tracked repo path`)));
      }],
      ["fail: the same phantom by bare basename (in-process)", () => {
        const res = checkMatrix(plant(`| Planted H13 | ASVS 5.0 | Implemented (public core) | \`zz-phantom-tracked-not-on-disk.md\` |`), { ...ctx, tracked: [...ctx.tracked, phantom], indexed: [...ctx.indexed, phantom] });
        return res.fails.some((f) => f.control === "Planted H13");
      }],
      // symlinks: a mode-120000 index entry never enters the tracked set
      ["fail: a tracked symlink is not a tracked file (parseLsFilesStage)", () => {
        const got = parseLsFilesStage("120000 0123abcd 0\tdocs/zz-matrix-alias.md\u0000100644 4567ef01 0\tdocs/PURPOSE.md\u0000100755 89ab2345 0\tscripts/x y.sh\u0000");
        return JSON.stringify(got) === JSON.stringify(["docs/PURPOSE.md", "scripts/x y.sh"]);
      }],
      // round 25: an ALLOWLIST of regular modes, one entry per path
      ["fail: a gitlink (160000) is not a tracked file (parseLsFilesStage)", () => {
        const got = parseLsFilesStage("160000 0123abcd 0\tlib/zz-sub\u0000160000 0123abcd 0\tzz-sub\u0000100644 4567ef01 0\tdocs/PURPOSE.md\u0000");
        return JSON.stringify(got) === JSON.stringify(["docs/PURPOSE.md"]);
      }],
      ["fail: an unmerged path counts once, not once per stage (parseLsFilesStage)", () => {
        const got = parseLsFilesStage("100644 aaaa 1\tdocs/f.md\u0000100644 bbbb 2\tdocs/f.md\u0000100644 cccc 3\tdocs/f.md\u0000100644 dddd 1\tdocs/g.md\u0000100644 eeee 2\tdocs/g.md\u0000");
        return JSON.stringify(got) === JSON.stringify(["docs/f.md", "docs/g.md"]);
      }],
      ["fail: a basename shared by a regular file and a tracked symlink is ambiguous (in-process)", () => {
        const res = checkMatrix(plant("| Planted H14 | ASVS 5.0 | Implemented (public core) | `PURPOSE.md` |"), { ...ctx, indexed: [...ctx.indexed, "docs/agent/PURPOSE.md"] });
        return res.fails.some((f) => f.control === "Planted H14");
      }],
      ["fail: a non-regular entry beside the previous path is rejected, not skipped (in-process)", () => {
        const res = checkMatrix(plant("| Planted H15 | ASVS 5.0 | Implemented (public core) | `docs/agent/LOOP.md`; `PURPOSE.md` |"), { ...ctx, indexed: [...ctx.indexed, "docs/agent/PURPOSE.md"] });
        return res.fails.some((f) => f.control === "Planted H15");
      }],
      // round 28 (Codex): a bound proof must be one a gating lane runs
      ["fail: an Implemented row's own proof that no gating lane runs (in-process)", () => {
        const scripts2 = { ...ctx.scripts, "proof:zz-ungated": ctx.scripts["proof:signalgrid-core"] };
        const res = checkMatrix(plant("| Planted K10 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:zz-ungated` |"), { ...ctx, scripts: scripts2 });
        return res.fails.some((f) => f.control === "Planted K10" && f.why.some((w) => w.includes("`proof:zz-ungated` runs in no gating lane")));
      }],
      ["fail: an Automated row's proof that no gating lane runs (in-process)", () => {
        const scripts2 = { ...ctx.scripts, "proof:zz-ungated": ctx.scripts["proof:signalgrid-core"] };
        const res = checkMatrix(plant("| Planted K11 | ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml`; `pnpm run proof:zz-ungated` |"), { ...ctx, scripts: scripts2 });
        return res.fails.some((f) => f.control === "Planted K11" && f.why.some((w) => w.includes("runs in no gating lane")));
      }],
      ["fail: the matrix-wide binding when no gating lane runs it (in-process)", () => {
        const g2 = new Set([...ctx.gatedProofs].filter((p) => p !== "proof:signalgrid-core"));
        return checkMatrix(real, { ...ctx, gatedProofs: g2 }).fails.some((f) => f.why.some((w) => w.includes("(matrix-wide binding) runs in no gating lane")));
      }],
      ["fail: a heavy or native-build step registers no proof; bad output throws (gatedProofsFromListing)", () => {
        const got = gatedProofsFromListing('noise line\n[{"cmd":["pnpm","run","proof:a"]},{"cmd":["pnpm","run","proof:b"],"heavy":true},{"cmd":["pnpm","run","proof:c"],"needsNativeBuild":true},{"cmd":["node","scripts/x.mjs","proof:d"]}]\n');
        let threw = false; try { gatedProofsFromListing("not json"); } catch { threw = true; }
        return JSON.stringify([...got]) === JSON.stringify(["proof:a"]) && threw;
      }],
      // round 30 (Codex): a `path:NN` anchor must exist and land on the row's subject —
      // in-process, so each case must fail for THIS reason (the message), not
      // merely exit 1 through the stale KNOWN entry a disabled check would leave
      ...[
        ["an anchor past the end of the file", "N0", "`lib/signalgrid-core/src/policy.ts:999999` (`validatePolicyRules`)"],
        ["an anchor on a line that does not name the subject", "N1", "`lib/signalgrid-core/src/policy.ts:1` (`validatePolicyRules`)"],
        ["an anchor on line 0", "N2", "`lib/signalgrid-core/src/policy.ts:0` (`validatePolicyRules`)"],
        ["an anchor with no subject to land on", "N3", `\`lib/signalgrid-core/src/policy.ts:${anchorAt.n}\``],
        ["an anchor on a directory", "N4", "`lib/signalgrid-core/src:1` (`validatePolicyRules`)"],
        ["an anchor matching only a prefix of the subject's name", "N5", `\`lib/signalgrid-core/src/policy.ts:${anchorAt.n}\` (\`validatePolicy\`)`],
      ].map(([what, id, where]) => [`fail: ${what} (in-process)`, () => checkMatrix(plant(`| Planted ${id} | ASVS 5.0 | Implemented (public core) | ${where} |`), ctx).fails.some((f) => f.control === `Planted ${id}` && f.why.some((w) => w.startsWith("cited anchor")))]),
      ["fail: a stale anchor on an Automated row (in-process)", () =>
        checkMatrix(plant("| Planted N6 | ASVS 5.0 | Automated (CI bot) | `.github/workflows/review-hub-ci.yml:1`; `pnpm run proof:backup-restore` |"), ctx).fails.some((f) => f.control === "Planted N6" && f.why.some((w) => w.startsWith("cited anchor")))],
      // round 30 (Codex): a proof's source is the file its command EXECUTES
      ["fail: a hollow root proof (`echo <file>`) resolves to nothing (proofSource)", () =>
        proofSource("proof:zz", { scripts: { "proof:zz": "echo ./scripts/check-security-controls-matrix.mjs" }, tracked: new Set(ctx.tracked) }) === null],
      ["fail: a delegation behind a chain (`true && pnpm --filter …`) resolves to nothing (proofSource)", () =>
        proofSource("proof:zz", { scripts: { "proof:zz": "true && pnpm --filter @workspace/scripts run proof:signalgrid-core" }, tracked: new Set(ctx.tracked) }) === null],
      ["fail: hollow, chained, piped or argument-carrying package commands resolve to nothing (proofSource)", () => {
        const pkg = (cmd) => () => ({ dir: "scripts", scripts: { "proof:zz": cmd } });
        return ["echo ./src/signalgrid-core-proof.ts", "tsx ./src/signalgrid-core-proof.ts && true", "tsx ./src/signalgrid-core-proof.ts | cat", "tsx ./src/signalgrid-core-proof.ts --x", "true; tsx ./src/signalgrid-core-proof.ts"]
          .every((cmd) => proofSource("proof:zz", { scripts: { "proof:zz": "pnpm --filter @workspace/zz run proof:zz" }, readPkg: pkg(cmd), tracked: new Set(ctx.tracked) }) === null);
      }],
      ["fail: an untracked entrypoint resolves to nothing, though it exists on disk (proofSource)", () =>
        existsSync(SELF) && proofSource("proof:zz", { scripts: { "proof:zz": "node scripts/check-security-controls-matrix.mjs" }, tracked: new Set(ctx.tracked.filter((f) => f !== "scripts/check-security-controls-matrix.mjs")) }) === null],
      ["fail: a `..` segment resolves to nothing even with no tracked set (proofSource)", () =>
        proofSource("proof:zz", { scripts: { "proof:zz": "node scripts/../package.json.js" }, tracked: null }) === null
        && proofSource("proof:zz", { scripts: { "proof:zz": "node scripts/../scripts/check-security-controls-matrix.mjs" }, tracked: null }) === null],
      ["fail: an Implemented row's own hollow proof (in-process)", () => {
        const scripts2 = { ...ctx.scripts, "proof:zz-hollow": "echo ./scripts/check-security-controls-matrix.mjs" };
        const res = checkMatrix(plant("| Planted K12 | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts`; `pnpm run proof:zz-hollow` |"), { ...ctx, scripts: scripts2, gatedProofs: new Set([...ctx.gatedProofs, "proof:zz-hollow"]) });
        return res.fails.some((f) => f.control === "Planted K12" && f.why.some((w) => w.includes("`proof:zz-hollow` does not resolve to a source file it executes")));
      }],
      ["pass: the matrix's proofs resolve to the files they execute (proofSource)", () => {
        const t = new Set(ctx.tracked);
        return proofSource("proof:signalgrid-core", { scripts: ctx.scripts, tracked: t }) === "scripts/src/signalgrid-core-proof.ts"
          && proofSource("proof:backup-restore", { scripts: ctx.scripts, tracked: t }) === "scripts/src/backup-restore-proof.ts"
          && proofSource("proof:decision-palette", { scripts: ctx.scripts, tracked: t }) === "scripts/check-decision-palette.mjs";
      }],
      // round 31 (Codex :743): a self-skipping proof counts only where a workflow runs it with its env
      ...(() => {
        const ci = ctx.workflows.find((w) => w.path === ".github/workflows/review-hub-ci.yml");
        const dbLine = "          DATABASE_URL: postgres://sg:sg@localhost:5432/signalgrid\n          # The proofs DROP the tables they test (and the role-split proof alters the\n          # cluster-wide runtime role). They refuse to run without this declaration —\n          # the service container above is exactly the throwaway cluster it names.\n          SIGNALGRID_DB_DISPOSABLE: \"1\"\n        run: pnpm run proof:backup-restore";
        const wf = (step, jobEnv = "") => [{ path: "zz.yml", text: `on: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n${jobEnv}    steps:\n${step}` }];
        const ss = new Map([["proof:zz", "DATABASE_URL"]]);
        const row178 = (c) => checkMatrix(real, c).fails.find((f) => f.control === "Backup and restore, with a verified restore test");
        return [
          ["fail: the CI Postgres step's DATABASE_URL deleted — proof:backup-restore self-skips, so it is not credited (in-process, the real workflow)", () => {
            if (!ci || ci.text.split(dbLine).length !== 2) return false; // the pin moved: fail rather than pass vacuously
            const cut = ctx.workflows.map((w) => (w === ci ? { ...w, text: w.text.replace(dbLine, dbLine.split("\n").slice(1).join("\n")) } : w));
            const f = row178({ ...ctx, envRuns: envRunsFromWorkflows(cut, ctx.selfSkipping) });
            return Boolean(f?.why.some((w) => w.includes("`proof:backup-restore` self-skips without DATABASE_URL")));
          }],
          ["fail: an own self-skipping proof with no env-carrying workflow step (in-process)", () => {
            const res = checkMatrix(plant("| Planted S0 | ASVS 5.0 | Implemented (public core) | `docs/BACKUP_AND_RESTORE.md`; `pnpm run proof:backup-restore` |"), { ...ctx, envRuns: new Set() });
            return res.fails.some((f) => f.control === "Planted S0" && f.why.some((w) => w.includes("`proof:backup-restore` self-skips without DATABASE_URL")));
          }],
          ["fail: a step without the env var, an empty value, a chained run, continue-on-error, a job-level continue-on-error (envRunsFromWorkflows)", () =>
            [wf("      - run: pnpm run proof:zz\n"),
              wf("      - env:\n          DATABASE_URL: \"\"\n        run: pnpm run proof:zz\n"),
              wf("      - env:\n          DATABASE_URL: x\n        run: pnpm run proof:zz || true\n"),
              wf("      - env:\n          DATABASE_URL: x\n        continue-on-error: true\n        run: pnpm run proof:zz\n"),
              wf("      - run: pnpm run proof:zz\n", "    continue-on-error: true\n    env:\n      DATABASE_URL: x\n"),
              wf("      - env:\n          OTHER: x\n        run: pnpm run proof:zz\n")].every((w) => !envRunsFromWorkflows(w, ss).has("proof:zz"))],
          ["pass: a step-level or job-level env credits the proof (envRunsFromWorkflows)", () =>
            envRunsFromWorkflows(wf("      - env:\n          DATABASE_URL: x\n        run: pnpm run proof:zz\n"), ss).has("proof:zz")
            && envRunsFromWorkflows(wf("      - run: pnpm run proof:zz\n", "    env:\n      DATABASE_URL: x\n"), ss).has("proof:zz")],
          ["fail: an unreadable self-skipping listing or workflow throws (selfSkippingFromListing / envRunsFromWorkflows)", () => {
            let a = false, b = false;
            try { selfSkippingFromListing("proof:x DATABASE_URL\nnot a line\n"); } catch (e) { a = /printed an unreadable line: "not a line"/.test(e.message); }
            try { envRunsFromWorkflows([{ path: "bad.yml", text: "jobs: [\n" }], ss); } catch (e) { b = /^bad\.yml does not parse as YAML/.test(e.message); }
            return a && b;
          }],
          ["pass: the real backup-restore row (matrix line 178) is credited — its proof runs with DATABASE_URL in CI (in-process)", () =>
            ctx.selfSkipping.get("proof:backup-restore") === "DATABASE_URL" && ctx.envRuns.has("proof:backup-restore")
            && !(row178(ctx)?.why ?? []).some((w) => w.includes("self-skips"))],
          // round 32 (Codex :793 and its siblings): each edit of the REAL workflow
          // leaves the step in place but never running it with its env — every one
          // must leave proof:backup-restore uncredited, for the reason named
          ...(() => {
            const STEP = "      - name: Backup/restore proof on Postgres\n";
            const DB = "          DATABASE_URL: postgres://sg:sg@localhost:5432/signalgrid\n";
            const RUN = "        run: pnpm run proof:backup-restore\n";
            const JOB = "  durable-persistence:\n";
            const edit = (fn, extra = []) => {
              if (!ci || [STEP, DB, RUN, JOB].some((x) => ci.text.split(x).length < 2) || ci.text.split(JOB).length !== 2) return null; // a pin moved
              const at = ci.text.indexOf(STEP); // edits apply to the backup-restore step and its job only
              const text = fn(ci.text, at);
              return [...ctx.workflows.map((w) => (w === ci ? { ...w, text } : w)), ...extra];
            };
            const inStep = (t, at, a, b) => t.slice(0, at) + t.slice(at).replace(a, b);
            const refusedFor = (files, re) => {
              if (!files) return false;
              const runs = envRunsFromWorkflows(files, ctx.selfSkipping);
              const f = row178({ ...ctx, envRuns: runs });
              return !runs.has("proof:backup-restore") && Boolean(f?.why.some((w) => w.includes("`proof:backup-restore` self-skips without DATABASE_URL") && re.test(w)));
            };
            const credited = (files) => Boolean(files) && envRunsFromWorkflows(files, ctx.selfSkipping).has("proof:backup-restore") && !(row178({ ...ctx, envRuns: envRunsFromWorkflows(files, ctx.selfSkipping) })?.why ?? []).some((w) => w.includes("self-skips"));
            return [
              ["fail W2: step `if: ${{ false }}`", () => refusedFor(edit((t, at) => inStep(t, at, STEP, `${STEP}        if: \${{ false }}\n`)), /step key `if` is outside the allowlist/)],
              ["fail W13: step `if: github.event_name == 'schedule'`", () => refusedFor(edit((t, at) => inStep(t, at, STEP, `${STEP}        if: github.event_name == 'schedule'\n`)), /step key `if` is outside the allowlist/)],
              ["fail: step `shell: bash -e {0}`", () => refusedFor(edit((t, at) => inStep(t, at, STEP, `${STEP}        shell: bash -e {0}\n`)), /step key `shell` is outside the allowlist/)],
              ["fail W3: job `if: ${{ false }}`", () => refusedFor(edit((t) => t.replace(JOB, `${JOB}    if: \${{ false }}\n`)), /job key `if` is outside the allowlist/)],
              ["fail W10: job `needs:` on a job that never runs", () => refusedFor(edit((t) => t.replace("\njobs:\n", "\njobs:\n  zz-never:\n    if: ${{ false }}\n    runs-on: ubuntu-latest\n    steps:\n      - run: \"true\"\n").replace(JOB, `${JOB}    needs: [zz-never]\n`)), /job key `needs` is outside the allowlist/)],
              ["fail W12: a strategy matrix that excludes every combination", () => refusedFor(edit((t) => t.replace(JOB, `${JOB}    strategy:\n      matrix:\n        x: [a]\n        exclude:\n          - x: a\n`)), /job key `strategy` is outside the allowlist/)],
              ["fail W6: the CI step's env removed, the proof run only by a schedule-only workflow", () => refusedFor(edit((t, at) => inStep(t, at, DB, ""), [{ path: ".github/workflows/zz-schedule.yml", text: "on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - env:\n          DATABASE_URL: x\n        run: pnpm run proof:backup-restore\n" }]), /zz-schedule\.yml: its `on:` has neither push nor pull_request/)],
              ["fail W11: DATABASE_URL on the job, an empty DATABASE_URL on the step (the step's value wins)", () => refusedFor(edit((t, at) => inStep(t, at, DB, '          DATABASE_URL: ""\n').replace(JOB, `${JOB}    env:\n      DATABASE_URL: postgres://sg:sg@localhost:5432/signalgrid\n`)), /DATABASE_URL is unset, empty or not a literal in the step's own env, which wins over the job's/)],
              ["fail: a `${{ }}` expression is not a literal value", () => refusedFor(edit((t, at) => inStep(t, at, DB, "          DATABASE_URL: ${{ secrets.ZZ_NONE }}\n")), /DATABASE_URL is unset, empty or not a literal/)],
              ["fail W1 (control): the step's DATABASE_URL deleted", () => refusedFor(edit((t, at) => inStep(t, at, DB, "")), /DATABASE_URL is unset, empty or not a literal/)],
              ["fail W7 (control): a multi-line `run:` is not credited", () => refusedFor(edit((t, at) => inStep(t, at, RUN, "        run: |\n          pnpm run proof:backup-restore\n          true\n")), /its `run` is not exactly `pnpm run proof:backup-restore`/)],
              ["fail W9 (control): a workflow-level env is not credited", () => refusedFor(edit((t, at) => inStep(t, at, DB, "").replace("\njobs:\n", "\nenv:\n  DATABASE_URL: postgres://sg:sg@localhost:5432/signalgrid\njobs:\n")), /DATABASE_URL is unset, empty or not a literal/)],
              ["fail W5 (control): step `continue-on-error: ${{ true }}`", () => refusedFor(edit((t, at) => inStep(t, at, STEP, `${STEP}        continue-on-error: \${{ true }}\n`)), /step key `continue-on-error` is outside the allowlist/)],
              ["pass W8 (control): DATABASE_URL on the job, none on the step, is credited", () => credited(edit((t, at) => inStep(t, at, DB, "").replace(JOB, `${JOB}    env:\n      DATABASE_URL: postgres://sg:sg@localhost:5432/signalgrid\n`)))],
            ].map(([n, f]) => [`${n} (in-process, the real workflow)`, f]);
          })(),
          ["pass: a proof only verify-breadth runs is gated (in-process, the breadth half of the registry)", () => {
            const breadth = ctx.lanes?.["scripts/verify-breadth.mjs"], pre = ctx.lanes?.["scripts/preflight.mjs"];
            if (!(breadth instanceof Set) || !(pre instanceof Set) || breadth.size === 0) return false; // the breadth lane was never read
            const only = [...breadth].filter((p) => !pre.has(p) && !ctx.selfSkipping.has(p));
            const p = only.find((x) => proofSource(x, { scripts: ctx.scripts, tracked: new Set(ctx.tracked) }));
            if (!p) return false;
            const res = checkMatrix(plant(`| Planted S1 | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts\`; \`pnpm run ${p}\` |`), ctx);
            return ctx.gatedProofs.has(p) && !res.fails.some((f) => f.control === "Planted S1");
          }],
        ];
      })(),
      ["pass: the real gating lanes run the matrix's proofs (in-process)", () =>
        ctx.gatedProofs.has("proof:signalgrid-core") && ctx.gatedProofs.has("proof:backup-restore")],
      // realContext must wire BOTH lists: regular files in `tracked`, every index entry in `indexed` (round 27)
      ["pass: the real tracked set holds the matrix and no symlink; the index view holds the symlink (in-process)", () =>
        ctx.tracked.includes(DOC_SELF) && !ctx.tracked.includes("scripts/mobile-app-catalog/fixtures/evil/app-escape-link.json")
        && ctx.indexed.includes("scripts/mobile-app-catalog/fixtures/evil/app-escape-link.json")],
    ];
    for (const [name, check] of inproc) {
      let pass = false, threw = "";
      try { pass = check() === true; } catch (e) { threw = ` — threw ${e?.message ?? e}`; } // a crash is a BAD, never an abort
      if (!pass) ok = false;
      console.log(`${pass ? "ok  " : "BAD "} self-test ${name}${threw}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return { ok, ctx };
}

const argv = process.argv.slice(2);
const docArg = argv.indexOf("--doc");
if (docArg !== -1) process.exit(run(argv[docArg + 1]));
const { ok: stOk, ctx } = selfTest();
if (argv.includes("--self-test")) process.exit(stOk ? 0 : 1);
if (!stOk) { console.error("FAIL  self-test — the gate cannot fail, so its verdict proves nothing"); process.exit(1); }
process.chdir(ROOT);
process.exit(run(DOC, ctx));
