#!/usr/bin/env node
// Cited symbols — a document that cites a repository file AND names a symbol in it
// must name a symbol the file still contains.
//
//   node scripts/check-cited-symbols.mjs              check (writes nothing)
//   node scripts/check-cited-symbols.mjs --write      record a FALL in the ratchet (the only writer)
//   node scripts/check-cited-symbols.mjs --self-test  prove the check can fail
//
// WHY THIS EXISTS. check-cited-paths.mjs proves that every cited path exists and
// stops there. On 2026-09-06 the docs/inspiration read found three documents
// that had passed it while naming symbols the cited file no longer held: a
// configuration-key registry listing 19 environment reads that PR #436 had
// deleted from ProviderConfigurationService.swift (12 of them nowhere in the
// tracked tree outside that catalog; a 13th, SEC_RATE_LIMITING, survives only as
// a fixture inside this gate's own self-test), a plan line placing DEFAULT_MAX_SKEW_MS in a file that does not define
// it, a lane doc naming a Swift target in the wrong Package.swift. The cited PATH
// was right every time; only the named symbol was gone.
//
// WHAT IS GATED (unambiguous only). A SYMBOL is a SCREAMING_SNAKE token with an
// underscore (an env key or constant) or a backticked camelCase / snake_case
// identifier. It is PAIRED with a code-file citation only when the pairing is
// unambiguous:
//   - in prose, an EXPLICIT attribution after it wins ("`sym` in/at/from/of/
//     exported by/defined in path", "`sym` is defined in path", or a
//     parenthetical citation within two words: "before `sym` runs (path:56)");
//     otherwise the nearest citation BEFORE it within 60 characters, with no
//     sentence break, semicolon, table-cell bar, other file name, or possessive
//     of some other noun ("the sibling's `sym`") between them;
//   - in a table row that cites exactly ONE code file BY URL (a registry row),
//     every symbol in the row.
// The first live pass mis-paired three sentences a reader gets right; each is a
// self-test case written before the rule moved.
// Anything else is REPORTED as unpaired and never judged. A symbol counts as
// present when it occurs on a NON-COMMENT line of the cited file — a file that
// names BACKEND_TIMEOUT in the comment recording its deletion does not contain
// BACKEND_TIMEOUT. (Stripping comments with a regex was tried first and ate
// everything between a glob's `/*` and the next `*/`; a line-based rule cannot.)
// A missing symbol is RATCHETED: the count may not rise; a fall is recorded with
// `--write` and committed, the same regenerate-and-diff shape as the anchor gate.
//
// WHAT IS NOT GATED, said out loud:
//   - documents carrying the dated-record marker check-cited-paths already
//     recognises (`<!-- line-citations: as measured YYYY-MM-DD, not maintained -->`)
//     — an audit dated 2026-09-01 that names a helper the cut it asked for
//     since removed is a record, not a claim about today;
//   - a VERBATIM IMPORT that declares itself with
//     `<!-- cited-symbols: verbatim import, drift recorded in the preamble -->`
//     — the body may not be edited, so the drift is written in the preamble and
//     the marker is the visible, per-file opt-out the reviewer asked for;
//   - docs/CLAIM_INVENTORY.md (DERIVED from its JSON; the anchor gate holds the
//     evidence strings) and docs/agent/EVIDENCE.md (a record of commands run, the
//     symbols quoted as they were on the day) — an explicit list, printed on
//     every run, never a silent skip;
//   - whether the cited file MEANS what the sentence says — no gate reads English.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const WRITE = process.argv.includes("--write");
const SELF_TEST = process.argv.includes("--self-test");
const RATCHET = "docs/agent/cited-symbols-ratchet.json";
const BEFORE = 60;
export const RECORD_MARKER = /<!--\s*line-citations:\s*as measured \d{4}-\d{2}-\d{2},\s*not maintained\s*-->/;
export const VERBATIM_MARKER = /<!--\s*cited-symbols:\s*verbatim import, drift recorded in the preamble[^>]*\bmeasured (\d{4}-\d{2}-\d{2})[^>]*-->/;
export const DERIVED_OR_RECORD = new Map([
  ["docs/CLAIM_INVENTORY.md", "DERIVED from docs/agent/CLAIM_INVENTORY.json; check-claim-inventory-anchors holds the evidence strings to their files"],
  ["docs/agent/EVIDENCE.md", "a record of commands run and their output on the day; symbols are quoted as they were, not as claims about today's tree"],
]);

const CODE_RE = /(github\.com\/[\w.-]+\/[\w.-]+\/blob\/[\w./-]+?\/)?((?:lib|scripts|artifacts|native|fixtures|fleet|tests|tools|config|firmware|site)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mjs|js|swift|kt|py|sh))\b/g;
const ANY_PATH_RE = /[\w.-]+(?:\/[\w.-]+)+/g;
const BARE_FILE_RE = /\b[\w-]+\.(?:ts|tsx|mjs|js|swift|kt|py|sh|md|json|yml|yaml)\b/;
const SYM_RE = /\b([A-Z][A-Z0-9]*_[A-Z0-9_]{2,})\b|`([A-Za-z_$][\w$]*(?:[A-Z][a-z0-9]|_[a-z])[\w$]*)`/g;
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#(?!!))/;
// Text between a symbol and the NEXT citation that attributes the symbol to that file.
const AFTER_RE = /^[\s`]*(?:(?:\w+\s+){0,2}\(|,?\s*(?:(?:is|are|was|were|now|still)\s+)*(?:in|at|from|of|inside|lives in|defined in|declared in|exported (?:by|from))\s+)[\s`\[]*$/;

/** Lines of a source file that are not comment lines — presence is tested here only. */
export function codeLines(text, file) {
  const lines = text.split("\n");
  if (/\.(ts|tsx|mjs|js|swift|kt|py|sh)$/.test(file)) return lines.filter((l) => !COMMENT_LINE.test(l)).join("\n");
  return text;
}

/** Pure: the (symbol, files) pairs one document line asserts, given the doc-name set. */
export function pairsIn(line, docNames) {
  const cites = [...line.matchAll(CODE_RE)].map((m) => ({ file: m[2], at: m.index, end: m.index + m[0].length, url: m[1] !== undefined }));
  if (cites.length === 0) return { pairs: [], unpaired: 0 };
  const pathy = [...line.matchAll(ANY_PATH_RE)].map((m) => m[0].toUpperCase());
  const syms = [...line.matchAll(SYM_RE)]
    .map((m) => ({ sym: m[1] ?? m[2], at: m.index, end: m.index + m[0].length }))
    .filter((s) => !pathy.some((p) => p.includes(s.sym.toUpperCase())) && !docNames.has(s.sym));
  // A REGISTRY row cites its source file by URL in a cell of its own, with the
  // symbol in another cell (the iOS configuration-key registry is the shape).
  // A prose table that mentions a relative path mid-sentence is not one — its
  // symbols pair by proximity like any sentence, or not at all.
  const isRow = /^\s*\|/.test(line);
  const distinct = new Set(cites.map((c) => c.file));
  const registryRow = isRow && distinct.size === 1 && cites.every((c) => c.url);
  const pairs = [];
  let unpaired = 0;
  for (const s of syms) {
    let files = [];
    if (registryRow) files = [...distinct];
    else {
      // An EXPLICIT attribution after the symbol wins: "`sym` in/at/from/of/exported by `path`",
      // "`sym` is defined in `path`", or a parenthetical citation within two words
      // ("before `sym` runs (`path:56`)"). Only then the nearest citation before it.
      const after = cites.filter((c) => c.at >= s.end).sort((x, y) => x.at - y.at)[0];
      if (after && AFTER_RE.test(line.slice(s.end, after.at))) files = [after.file];
      if (files.length === 0) {
        const before = cites.filter((c) => c.end <= s.at && s.at - c.end <= BEFORE).sort((x, y) => y.end - x.end)[0];
        if (before) {
          const between = line.slice(before.end, s.at);
          // Breaks: a `;`, a sentence end, a table-cell boundary, a bare file name
          // ("`store.ts` (`sym`)"), or a possessive of some OTHER noun right before
          // the symbol ("the sibling's `sym`") — the symbol belongs to that noun.
          if (!/[;|]|\.\s|\n/.test(between) && !BARE_FILE_RE.test(between) && !/[A-Za-z]'s\s*$/.test(between)) files = [before.file];
        }
      }
    }
    if (files.length === 0) unpaired += 1;
    else pairs.push({ sym: s.sym, files });
  }
  return { pairs, unpaired };
}

/** Pure over documents: { checked, ok, missing:[{doc,line,sym,files}], unpaired, nofile, exempt:[{doc,why}] } */
export function auditDocs(docs, readDoc, readCode, docNames) {
  const out = { checked: 0, ok: 0, missing: [], unpaired: 0, nofile: 0, exempt: [] };
  const cache = new Map();
  const code = (f) => {
    if (!cache.has(f)) {
      const t = readCode(f);
      cache.set(f, t === null ? null : codeLines(t, f));
    }
    return cache.get(f);
  };
  for (const doc of docs) {
    const text = readDoc(doc);
    if (text === null) continue;
    if (DERIVED_OR_RECORD.has(doc)) { out.exempt.push({ doc, why: DERIVED_OR_RECORD.get(doc) }); continue; }
    if (RECORD_MARKER.test(text)) { out.exempt.push({ doc, why: "dated record (line-citations marker)" }); continue; }
    const vm = VERBATIM_MARKER.exec(text);
    if (vm) { out.exempt.push({ doc, why: `verbatim import (cited-symbols marker, drift measured ${vm[1]})` }); continue; }
    text.split("\n").forEach((line, i) => {
      const { pairs, unpaired } = pairsIn(line, docNames);
      out.unpaired += unpaired;
      for (const p of pairs) {
        const files = p.files.filter((f) => f !== doc);
        if (files.length === 0) continue;
        out.checked += 1;
        const texts = files.map(code);
        if (texts.every((t) => t === null)) { out.nofile += 1; continue; }
        if (texts.some((t) => t !== null && t.includes(p.sym))) out.ok += 1;
        else out.missing.push({ doc, line: i + 1, sym: p.sym, files });
      }
    });
  }
  return out;
}

export function ratchetObject(a) {
  const byDoc = {};
  for (const m of a.missing) byDoc[m.doc] = (byDoc[m.doc] ?? 0) + 1;
  return {
    note: "Cited-symbol ratchet: symbols named beside a code-file citation that the cited file no longer contains on a non-comment line. DERIVED by scripts/check-cited-symbols.mjs; never hand-edit. The count may not rise; a fall is recorded with `--write` and committed.",
    missing: a.missing.length,
    byDoc: Object.fromEntries(Object.entries(byDoc).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))),
  };
}
const serialize = (o) => `${JSON.stringify(o, null, 2)}\n`;

function selfTest() {
  const checks = [];
  const docNames = new Set(["BUILD_LOOP"]);
  const files = {
    "lib/x/src/a.ts": 'export const REAL_CONST = 1;\nexport function realFn() {}\n// DELETED_KEY was removed on 2026-09-05; this comment records it\nconst glob = "lib/*/src/*.ts"; /* a block */ export const AFTER_GLOB = 2;\n',
    "scripts/b.mjs": "export const OTHER_THING = 3;\n",
  };
  const readCode = (f) => files[f] ?? null;
  const run = (doc, text) => auditDocs([doc], () => text, readCode, docNames);
  let a = run("d.md", "`REAL_CONST` is exported by `lib/x/src/a.ts`.");
  checks.push(["a symbol the cited file defines is ok (the '`sym` … exported by path' form)", a.checked === 1 && a.ok === 1 && a.missing.length === 0]);
  a = run("d.md", "`lib/x/src/a.ts` exports `REAL_CONST` and `realFn`.");
  checks.push(["two symbols after one citation are both checked and both ok", a.checked === 2 && a.ok === 2]);
  a = run("d.md", "`lib/x/src/a.ts` reads `MISSING_KEY` from the environment.");
  checks.push(["a symbol the cited file does not contain is MISSING, naming doc, line, symbol and file", a.missing.length === 1 && a.missing[0].sym === "MISSING_KEY" && a.missing[0].files[0] === "lib/x/src/a.ts" && a.missing[0].line === 1]);
  a = run("d.md", "`lib/x/src/a.ts` reads `DELETED_KEY` from the environment.");
  checks.push(["a symbol present ONLY in a comment of the cited file is MISSING — a deletion note is not a definition", a.missing.length === 1 && a.missing[0].sym === "DELETED_KEY"]);
  a = run("d.md", "`lib/x/src/a.ts` defines `AFTER_GLOB`.");
  checks.push(["a glob's /* inside a string does not swallow the code after it (line-based comment rule)", a.ok === 1 && a.missing.length === 0]);
  a = run("d.md", "`lib/x/src/a.ts` (`REAL_CONST`); `store.ts` (`findApiKeyByToken`)");
  checks.push(["a bare file name between the citation and the symbol breaks the pairing — the symbol belongs to that file", a.checked === 1 && a.ok === 1 && a.unpaired === 1]);
  a = run("d.md", "`RegExp`, not PCRE. `lib/x/src/a.ts` check 1 requires a tightening `default:`");
  checks.push(["a sentence break between symbol and citation breaks the pairing", a.checked === 0 && a.unpaired >= 1]);
  a = run("d.md", "[`scripts/b.mjs`](../scripts/b.mjs) ([`BUILD_LOOP.md`](BUILD_LOOP.md)) and `DISCOVERY_LOG` in docs/agent/DISCOVERY_LOG.md");
  checks.push(["a document's own name is never a symbol (path stem or tracked doc name)", a.checked === 0 && a.missing.length === 0]);
  a = run("d.md", "| SignalGrid iOS | SEC_RATE_LIMITING | Boolean | https://github.com/o/r/blob/main/lib/x/src/a.ts | note |");
  checks.push(["a registry row citing one code file (blob URL) pairs every symbol in the row; a deleted key is MISSING", a.missing.length === 1 && a.missing[0].sym === "SEC_RATE_LIMITING"]);
  a = run("d.md", "| row | `REAL_CONST` in lib/x/src/a.ts and `OTHER_THING` in scripts/b.mjs |");
  checks.push(["a row citing two files falls back to prose pairing — each symbol to its own file", a.checked === 2 && a.ok === 2]);
  a = run("d.md", "| 1 | `family` — `lib/x/src/a.ts` carries `REAL_CONST` | enabled by `MISSING_KEY` in the environment | note |");
  checks.push(["a prose table row with one RELATIVE citation is not a registry row — a far cell's symbol stays unpaired, the near one is checked", a.checked === 1 && a.ok === 1 && a.unpaired === 1]);
  a = run("d.md", "<!-- line-citations: as measured 2026-09-01, not maintained -->\n`lib/x/src/a.ts` had `MISSING_KEY` then.");
  checks.push(["a dated record is exempt and NAMED as exempt", a.exempt.length === 1 && a.missing.length === 0]);
  a = run("d.md", "<!-- cited-symbols: verbatim import, drift recorded in the preamble (KEY-REMOVAL DRIFT, measured 2026-09-06) -->\n| x | MISSING_KEY | lib/x/src/a.ts |");
  checks.push(["a verbatim import with a DATED marker is exempt and the date is NAMED", a.exempt.length === 1 && a.exempt[0].why === "verbatim import (cited-symbols marker, drift measured 2026-09-06)" && a.missing.length === 0]);
  a = run("d.md", "<!-- cited-symbols: verbatim import, drift recorded in the preamble -->\n`lib/x/src/a.ts` reads `MISSING_KEY` from the environment.");
  checks.push(["an UNDATED verbatim marker buys nothing — the exemption is conditional on a recorded measurement date", a.exempt.length === 0 && a.missing.length === 1]);
  a = run("docs/CLAIM_INVENTORY.md", "`lib/x/src/a.ts` reads `MISSING_KEY`");
  checks.push(["the derived inventory page is exempt with its reason printed", a.exempt.length === 1 && a.missing.length === 0]);
  a = run("d.md", "`lib/x/src/nope.ts` defines `REAL_CONST`.");
  checks.push(["a cited file that does not exist is counted nofile, not ok (check-cited-paths owns the path)", a.nofile === 1 && a.ok === 0]);
  const r0 = ratchetObject(run("d.md", "`lib/x/src/a.ts` reads `MISSING_KEY`."));
  const r1 = ratchetObject(run("d.md", "`lib/x/src/a.ts` reads `MISSING_KEY` and `MISSING_TOO`."));
  checks.push(["the ratchet counts missing symbols per document and a rise is detectable", r0.missing === 1 && r1.missing === 2 && r1.byDoc["d.md"] === 2]);

  let bad = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
    if (!ok) bad += 1;
  }
  if (bad) {
    console.error(`\nSELF-TEST FAILED — ${bad} check(s). A gate that cannot flag a planted violation is green about nothing.`);
    return 1;
  }
  console.log(`\nSelf-test green — ${checks.length}/${checks.length}: presence, comment lines, glob safety, pairing boundaries, registry rows, exemptions and the ratchet behave.`);
  return 0;
}

const IS_MAIN = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (IS_MAIN) main();

function main() {
  if (SELF_TEST) process.exit(selfTest());
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
  const docs = tracked.filter((f) => f.endsWith(".md"));
  const docNames = new Set(tracked.filter((f) => /\.(md|json|yml|yaml)$/.test(f)).map((f) => f.split("/").pop().replace(/\.[^.]+$/, "")));
  const readDoc = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
  const readCode = (f) => (existsSync(f) ? readFileSync(f, "utf8") : null);
  const a = auditDocs(docs, readDoc, readCode, docNames);

  console.log("Cited symbols — a document that names a symbol in a file it cites must name one the file still has\n");
  console.log(`  ${docs.length} tracked document(s): ${a.checked} symbol↔file pair(s) checked — ok ${a.ok}, MISSING ${a.missing.length}, cited file absent ${a.nofile}; ${a.unpaired} symbol(s) near a citation left unpaired (REPORTED, never judged)`);
  console.log(`  exempt (named, never silent): ${a.exempt.length}`);
  for (const e of a.exempt) console.log(`    · ${e.doc} — ${e.why}`);
  if (a.missing.length > 0) {
    console.log(`\n  MISSING — the cited file has no non-comment line naming the symbol:`);
    for (const m of a.missing) console.log(`    · ${m.doc}:${m.line} "${m.sym}" ∉ ${m.files.join(", ")}`);
  }

  const now = ratchetObject(a);
  const expected = serialize(now);
  if (WRITE) {
    writeFileSync(RATCHET, expected);
    console.log(`\nWrote ${RATCHET} (missing ${now.missing}).`);
    process.exit(0);
  }
  let committedRaw = null;
  let committed = null;
  try {
    committedRaw = readFileSync(RATCHET, "utf8");
    committed = JSON.parse(committedRaw);
  } catch {
    committedRaw = null;
  }
  let tracked2 = false;
  try {
    tracked2 = execFileSync("git", ["ls-files", "--error-unmatch", RATCHET], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
  } catch {
    tracked2 = false;
  }
  if (!tracked2) {
    console.error(`\n✗ ${RATCHET} is not committed — an uncommitted ratchet controls nothing. Run --write and commit it.`);
    process.exit(1);
  }
  if (committedRaw !== expected) {
    if (committed && now.missing > committed.missing) {
      console.error(`\n✗ Cited-symbol ratchet ROSE: missing ${committed.missing} → ${now.missing}. A symbol named beside a citation must be one the file still holds — fix the sentence, re-cite the file that has it, or mark a dated record.`);
      for (const [d, n] of Object.entries(now.byDoc)) if (n > (committed.byDoc?.[d] ?? 0)) console.error(`    ${d}: ${committed.byDoc?.[d] ?? 0} → ${n}`);
    } else {
      console.error(`\n✗ ${RATCHET} is stale — the measured figure fell or the file was edited by hand. Run --write to record the current measurement and commit it.`);
    }
    process.exit(1);
  }
  console.log(`\nCited-symbol check passed — ${a.ok} pair(s) hold; missing held at ${now.missing} (may only fall).`);
  process.exit(0);
}
