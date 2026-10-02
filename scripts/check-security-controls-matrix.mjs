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
// WHAT IS GATED (hardened over eleven review rounds on PR #1349):
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
//      line that Markdown does not treat as blank (round 6).
//      A Framework refs cell holds only [A-Za-z0-9 .;,()/+-] and no claim
//      word; the Short ref table is pinned verbatim (round 7). The line
//      after a table is blank (GFM would render it as a row). No raw-HTML table
//      tags. Control names are unique as a reader sees them (case, whitespace,
//      entities, zero-width characters folded). The legend's words AND meanings
//      are pinned to EXPECTED_LEGEND / EXPECTED_MEANINGS.
//   1. The Status cell (bold markers stripped) is a legend word.
//   2. A row whose status reads "implement…" (the legend's Implemented word or
//      any other) must:
//      a. cite at least one repo path, every one a TRACKED and present file or
//         a tracked directory two or more segments deep — no `..`, no absolute
//         path, no untracked file, not the matrix itself; a path-like citation
//         the parser cannot read fails rather than being skipped (`lib/x/{a,b}.ts` braces expand; `path:NN` suffixes are
//         stripped; a bare `file.ts` resolves beside the cell's previous path,
//         else to the ONE tracked file of that basename);
//      b. be bound to a proof script that exists in package.json `scripts` and
//         resolves to a source file: the row's own `proof:*` citation(s), else
//         the closing note's matrix-wide binding ("Everything marked Implemented
//         (public core) ... is exercised by `pnpm run proof:<x>`"). If that
//         sentence is gone, every row leaning on it fails (fail-closed). A
//         span that reads as a proof or a package-manager command (any case,
//         padding or prefix: `PROOF:x`, ` proof:x `, `npm run …`) must be exactly
//         `(pnpm run )?proof:<name>` or `pnpm install --frozen-lockfile`; any
//         other shape fails.
//   3. An "Automated (CI bot)" row's cited paths must be tracked too (it need
//      not cite one: several live in GitHub settings), under the same parser,
//      and any proof it cites must exist and resolve.
//
// KNOWN FAILURES. The matrix is an owner-gated surface (compliance docs in
// scripts/check-owner-gated-surfaces.mjs); this gate does not edit it. Rows the
// real matrix failed on the day the gate landed are listed in KNOWN_FAILURES by
// Control + exact Status + exact failure list, each absorbing ONE row, quoted on
// every run. A stale entry fails; any other failure on that row is new. Empty is
// the goal state; the owner decides how each is resolved.
//
// SELF-TEST (`--self-test`, also run first on every normal invocation): copy the
// real doc to a temp file and plant one defect per class above — each must exit
// 1 with the row quoted — plus a VALID Implemented row that must not fail.
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
    else if (/^ {0,3}(`{3,}|~{3,})/.test(l)) opaque.push({ line: k + 1, raw: l, why: "opens a code fence — text inside renders as code, not as the claim it reads like" });
  });
  const legend = new Map();
  const legendTables = [];
  const trailing = [];
  const rows = [];
  const unclaimed = [];
  const malformed = [];
  const claimed = new Set();
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const head = cells(lines[i]);
    const isTable = /^\s*\|\s*:?-/.test(lines[i + 1] ?? "");
    const isLegend = sameHeader(head, LEGEND_HEADER);
    const isControls = sameHeader(head, CONTROLS_HEADER);
    const isOther = NON_CONTROL_TABLES.some((h) => sameHeader(head, h));
    const sIdx = CONTROLS_HEADER.indexOf("Status");
    const wIdx = CONTROLS_HEADER.indexOf("Where");
    if (!isTable || (!isLegend && !isControls && !isOther)) continue; // left unclaimed: fails below
    claimed.add(i).add(i + 1);
    if (isLegend) legendTables.push(i + 1);
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j += 1) {
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

/** The exact shape citedProofs reads; a `pnpm …`/`proof:…` token in any other shape fails. */
const PROOF_CITE = /^(pnpm run )?proof:[\w:.-]+$/;
/** Non-proof commands the matrix cites verbatim (no evidence weight, never resolved). */
const COMMAND_CITES = new Set(["pnpm install --frozen-lockfile"]);
/** A span that reads as a proof or a package-manager command, in any case, padding or
 *  wrapping: `PROOF:x`, ` proof:x `, `(proof:x)`, `run proof:x`, `proof :x`, `npm run …`,
 *  `yarn …`, `pnpx …`, `pnpm.cmd …` (round 15). A bare word (`pnpm`) or a path
 *  (`pnpm-workspace.yaml`) is not one. */
const COMMAND_LIKE = /proof\s*:|^\s*(pnpm|npm|yarn|npx|pnpx)(\.\w+)?\s/i;

export function citedPaths(where, { strict = false, actionRefs = false, topDirs = new Set() } = {}) {
  const out = [];
  const unparsed = [];
  for (const m of where.matchAll(/`([^`]+)`/g)) {
    // a command citation is either a proof citedProofs reads (and checks), or the
    // one install command the matrix cites; any other shape is unreadable evidence
    // and fails, never a skip (round 14: `proof:no/such` fell back to the binding;
    // round 15: case, padding and prefixes are matched too, the exact shape is not)
    if (COMMAND_LIKE.test(m[1])) {
      if (!PROOF_CITE.test(m[1]) && !COMMAND_CITES.has(m[1])) unparsed.push(m[1]);
      continue;
    }
    const tok = m[1].replace(/:\d+$/, "");
    if (API_ROUTE.test(tok)) continue;
    const looksLikePath = tok.includes("/") || FILEEXT.test(tok);
    const ref = ACTION_REF.exec(tok);
    if (actionRefs && ref && !topDirs.has(ref[1])) continue;
    if (!strict && /@v?\d/.test(tok)) continue;
    if (!PATHISH.test(tok) || /@v?\d/.test(tok)) { if (looksLikePath) unparsed.push(tok); continue; }
    if (looksLikePath || /^\.[\w-]+$/.test(tok)) out.push(tok);
  }
  // an Implemented row's citation the parser cannot read is a failure, never a skip (round 3)
  return strict ? { paths: out, unparsed } : out;
}

export function citedProofs(where) {
  return [...where.matchAll(/`(?:pnpm run )?(proof:[\w:.-]+)`/g)].map((m) => m[1]);
}

/** Evidence must be IN THE REPOSITORY: a tracked file, or a tracked directory
 *  at least two segments deep (`lib/persistence`, never `lib` or `./`). Paths
 *  with `.`/`..` segments, absolute paths, and anything untracked (node_modules,
 *  .git, build output) resolve to nothing (review round 2 of PR #1349). */
function resolver(root, tracked) {
  const files = new Set(tracked);
  const dirs = new Set();
  for (const f of tracked) {
    const parts = f.split("/");
    for (let k = 1; k < parts.length; k += 1) dirs.add(parts.slice(0, k).join("/"));
  }
  const byBase = new Map();
  for (const f of tracked) {
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
    const t = tok.replace(/\/$/, "").replace(/^\.\/(?=.)/, "");
    if (t.includes("/") || t.startsWith(".")) return inRepo(t);
    if (lastDir && inRepo(`${lastDir}/${t}`)) return `${lastDir}/${t}`;
    const hits = byBase.get(t) ?? [];
    return hits.length === 1 ? hits[0] : null;
  };
}

/** The source file a proof script runs, following the root -> workspace-package
 *  delegation (`pnpm --filter @workspace/<pkg> run <name>` -> `tsx ./src/x.ts`).
 *  null when it cannot be resolved to an existing file — fail-closed. */
export function proofSource(name, { root = ROOT, scripts, readPkg = defaultReadPkg }) {
  let cmd = scripts[name];
  let dir = "";
  for (let hop = 0; hop < 3 && typeof cmd === "string"; hop += 1) {
    const d = /pnpm --filter (@workspace\/[\w-]+) run ([\w:.-]+)/.exec(cmd);
    if (d) {
      const pkg = readPkg(root, d[1]);
      if (!pkg) return null;
      dir = pkg.dir;
      cmd = pkg.scripts[d[2]];
      continue;
    }
    for (const tok of cmd.split(/\s+/)) {
      if (!/\.(ts|mjs|cjs|js)$/.test(tok)) continue;
      const rel = join(dir, tok).replace(/^\.\//, "");
      return existsSync(join(root, rel)) ? rel : null;
    }
    return null;
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

export function checkMatrix(text, { root = ROOT, tracked, scripts }) {
  const { shortRefRows, opaque, controlCells, bareCR, legendDup, claimCells, legend, legendTables, linkDefs, trailing, htmlRows, rows, unclaimed, malformed, defaultProof } = parseMatrix(text);
  const resolve = resolver(root, tracked);
  const topDirs = new Set(tracked.filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
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
      // a file is path-like whatever its extension or case, and with a `:NN` line
      // or `#…` anchor suffix too (round 18); the matrix's Control spans carry
      // none (Where cells keep FILEEXT: they cite identifiers like `ApiKeyRecord.token`)
      const t = m[1], bare = t.replace(/#.*$/, "").replace(/:\d+$/, "");
      if (COMMAND_LIKE.test(t) || (t.includes("/") && !API_ROUTE.test(t)) || /\.[A-Za-z][A-Za-z0-9]*$/.test(bare))
        structural.push(`line ${c.line}: Control name cites \`${t}\` — a proof, command or path in the Control cell is never resolved; evidence belongs in the Where cell\n      ${c.raw}`);
    }
    // emphasis and code-span markers are dropped first: `pro**of**:x`, `_proof_:x`
    // and a `proof` span followed by `:x` all read as proof:x (round 18)
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
  for (const u of unclaimed) structural.push(`line ${u.line} is a pipe row in no recognised table (Control|…|Status|Where, Status|Meaning, or ${NON_CONTROL_TABLES.map((h) => h.join("|")).join(", ")}) — it would go ungated\n      ${u.raw}`);
  for (const m of malformed) structural.push(`line ${m.line} has ${m.got} cells, its table header has ${m.want} (escaped pipe or missing cell) — columns cannot be trusted\n      ${m.raw}`);
  for (const r of rows) {
    const why = [];
    if (!EXPECTED_LEGEND.includes(r.status)) why.push(`status "${r.status}" is not in the Status legend (${LEGEND_LIST})`);
    if (PATH_CHECKED.has(r.status)) {
      // strict, like Implemented rows: an unreadable path-like citation fails (round 11)
      const auto = citedPaths(r.where, { strict: true, actionRefs: true, topDirs });
      for (const u of auto.unparsed) why.push(`cited token \`${u}\` cannot be read as a repo path or as a \`(pnpm run )?proof:<name>\` citation — unreadable evidence is not evidence`);
      let lastDir = null;
      for (const tok of auto.paths) for (const p of expandBraces(tok)) {
        const hit = resolve(p, lastDir);
        if (!hit) why.push(`cited path \`${p}\` is not a tracked repo path (or is ambiguous)`);
        const at = (hit ?? p).includes("/") ? (hit ?? p) : null;
        if (at) lastDir = at.slice(0, at.lastIndexOf("/"));
      }
      // a proof the row cites must exist and resolve, here too (round 15)
      for (const p of citedProofs(r.where)) {
        if (!Object.hasOwn(scripts, p)) why.push(`proof \`${p}\` is not a package.json script`);
        else if (!proofSource(p, { root, scripts })) why.push(`proof \`${p}\` does not resolve to an existing source file`);
      }
    }
    if (IMPLEMENTED_LIKE.test(r.status)) {
      const { unparsed } = citedPaths(r.where, { strict: true });
      for (const u of unparsed) why.push(`cited token \`${u}\` cannot be read as a repo path or as a \`(pnpm run )?proof:<name>\` citation — unreadable evidence is not evidence`);
      const own = citedProofs(r.where);
      const proofs = own.length ? own : defaultProof ? [defaultProof] : [];
      if (proofs.length === 0) why.push("no proof bound: the row cites none and the closing note's matrix-wide `pnpm run proof:*` binding is missing");
      let ownSources = 0;
      for (const p of proofs) {
        const tag = own.length ? "" : " (matrix-wide binding)";
        if (!Object.hasOwn(scripts, p)) { why.push(`proof \`${p}\` is not a package.json script${tag}`); continue; }
        if (proofSource(p, { root, scripts })) { if (own.length) ownSources += 1; }
        else why.push(`proof \`${p}\`${tag} does not resolve to an existing source file`);
      }
      // A row's own cited proof counts as its repo-path citation: the proof's
      // source file is the thing in the tree that verifies the control.
      const { paths } = citedPaths(r.where, { strict: true });
      if (paths.length === 0 && ownSources === 0) why.push("cites no repo path (and no proof of its own whose source file exists)");
      let lastDir = null;
      for (const tok of paths) {
        for (const p of expandBraces(tok)) {
          const hit = resolve(p, lastDir);
          if (!hit) why.push(`cited path \`${p}\` is not a tracked repo path (or is ambiguous)`);
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

function realContext() {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  const scripts = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts ?? {};
  return { root: ROOT, tracked, scripts };
}

function run(docPath) {
  const text = readFileSync(docPath, "utf8");
  const res = checkMatrix(text, realContext());
  let bad = res.structural.length;
  for (const s of res.structural) console.error(`FAIL  ${s}`);
  if (res.rows.length < ROW_FLOOR) { console.error(`FAIL  parsed ${res.rows.length} control rows (< floor ${ROW_FLOOR}) — the parser broke`); bad += 1; }
  const known = [];
  const used = new Set();
  for (const f of res.fails) {
    const k = KNOWN_FAILURES.findIndex((e, idx) => !used.has(idx) && e.control === f.control && e.status === f.status
      && e.why.length === f.why.length && e.why.every((w, n) => w === f.why[n]));
    if (k !== -1) { used.add(k); known.push({ ...f, reason: KNOWN_FAILURES[k].reason }); continue; }
    bad += 1;
    console.error(`FAIL  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}`);
  }
  KNOWN_FAILURES.forEach((e, idx) => {
    if (!used.has(idx)) { bad += 1; console.error(`FAIL  KNOWN_FAILURES entry "${e.control}" no longer fails exactly as declared (row gone, status changed, or its failures changed) — update or remove it`); }
  });
  for (const f of known) {
    console.log(`KNOWN (owner decision needed)  ${docPath}:${f.line}\n      ${f.raw}\n      - ${f.why.join("\n      - ")}\n      - declared: ${f.reason}`);
  }
  const impl = res.rows.filter((r) => r.status === IMPLEMENTED).length;
  console.log(`security-controls-matrix: ${res.rows.length} rows, ${impl} "${IMPLEMENTED}", matrix-wide proof ${res.defaultProof ?? "MISSING"}; ${bad} new failure(s), ${known.length} known (owner decision needed)`);
  return bad === 0 ? 0 : 1;
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
    ...["Planted C0 (`pnpm run proof:zzz`)", "Planted C1 (`PROOF:zzz`)", "Planted C2 (`npm run proof:zzz`)", "Planted C3 in `lib/no-such-file.ts`", "Planted C4 (proof:zzz)", "Planted C5 `` ` y` ``", "Planted C6 ``x` y``", "Planted C7 in `lib/no-such-file.ts", "Planted C8 `npm run test`", "Planted D0 `foo.ts`", "Planted D1 `scripts/foo`", "Planted D2 in `no-such-file.ts:12`", "Planted D3 in `no-such-gate.mjs#L1`", "Planted D4 in `no-such-file.py`", "Planted D5 in `no-such-file.TS`", "Planted D6 pro**of**:zzz", "Planted D7 _proof_:zzz", "Planted D8 `proof`:zzz"].flatMap((ctl) => [
      [`fail: Control name ${ctl} on an Implemented row`, plant(`| ${ctl} | ASVS 5.0 | Implemented (public core) | \`lib/signalgrid-core/src/policy.ts\` |`), 1],
      [`fail: Control name ${ctl} on an Automated row`, plant(`| ${ctl} | ASVS 5.0 | Automated (CI bot) | \`.github/workflows/review-hub-ci.yml\` |`), 1]]),
    ["pass: Control-name spans like the matrix's own (`/v1`, `pnpm`, an identifier)", plant("| Planted C9 on `/v1` and `/` via `pnpm`, `unsafeStore()`, `object.id + tenant_id` and `v1.2` | ASVS 5.0 | Implemented (public core) | `lib/signalgrid-core/src/policy.ts` |"), 0],
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
  try {
    for (const [name, text, want] of cases) {
      const f = join(dir, "SECURITY_CONTROLS_MATRIX.md");
      writeFileSync(f, text);
      const r = spawnSync(process.execPath, [SELF, "--doc", f], { cwd: ROOT, encoding: "utf8" });
      // a failure must QUOTE the offending row (or name the stale entry), never just exit 1
      const quoted = want === 1 ? /FAIL {2}.*\n {6}\S/.test(r.stderr) || /KNOWN_FAILURES entry ".+" no longer fails/.test(r.stderr) || /FAIL {2}(Status legend is|expected exactly one Status legend)/.test(r.stderr) : true;
      const pass = r.status === want && quoted;
      if (!pass) ok = false;
      console.log(`${pass ? "ok  " : "BAD "} self-test ${name} (exit ${r.status}, want ${want})${pass ? "" : `\n${r.stderr}`}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  return ok;
}

const argv = process.argv.slice(2);
const docArg = argv.indexOf("--doc");
if (docArg !== -1) process.exit(run(argv[docArg + 1]));
const stOk = selfTest();
if (argv.includes("--self-test")) process.exit(stOk ? 0 : 1);
if (!stOk) { console.error("FAIL  self-test — the gate cannot fail, so its verdict proves nothing"); process.exit(1); }
process.chdir(ROOT);
process.exit(run(DOC));
