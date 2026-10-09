// Stamp citations — a re-measured stamp must backtick the repo paths it cites.
//
//   node scripts/check-stamp-citations.mjs                  # gate docs/COMPANY_BUILD_PLAN.md
//   node scripts/check-stamp-citations.mjs --file <path>    # gate another copy (falsification)
//   node scripts/check-stamp-citations.mjs --self-test      # prove the gate can fail
//
// WHY. `check-cited-paths.mjs` proves a cited path exists, but only when the path is
// wrapped in backticks (its pattern requires them). A stamp that writes
// `scripts/fixture-idp-NOPE.mjs` in plain text therefore passes with exit 0, while the
// backticked twin exits 1 (PR #1456 round-1 review, mutant M5a). A `re-measured DATE`
// stamp is the evidence that resets a plan row's 14-day clock, so its citations are the
// ones that must be checkable. The existing "unbackticked citations" report in
// check-cited-paths deliberately fails on nothing ("a style gate wearing a correctness
// gate's clothes"); this gate is narrower on purpose: ONLY stamps, ONLY dated
// STAMP_RULE_FROM or later. Older stamps are a dated record; rewriting them would
// falsify it.
//
// WHAT A STAMP IS (a heuristic over prose, not a parser). A stamp starts at
// `re-?measured YYYY-MM-DD` (case-insensitive) found in EITHER of two texts: the file as
// written, and the file as objective-loop's rowMeasuredAt reads it (statusText's rule:
// backtick, straight-quote and curly-quote spans removed inside each numbered row, here
// blanked in place so offsets survive). The second catches a marker split by a span
// ("RE-MEASURED `(head x)` 2026-10-09"), which resets a row's clock there; the first keeps
// a stamp written inside a span, which rowMeasuredAt ignores, checked here anyway (and
// rowMeasuredAt reads only the Global backlog's rows, this gate the whole file). It runs to
// the EARLIEST of: a blank line or the next numbered row (`17c. **`) OUTSIDE a fenced block,
// where a blank line followed by a fence opener does not count (the CommonMark list-item
// shape), the next `re-measured` marker, the next DATED status marker (FIX PROPOSED, NOT BUILT, CORRECTED,
// LANDED, DONE, AWAITING, BLOCKED, followed by a YYYY-MM-DD) or 1500 characters. A status
// word NOT followed by a date is prose ("has LANDED", "a row still reading FIX PROPOSED")
// and does not end the stamp: that rule cut two real stamps short (rows 28 and 61 on
// 2026-10-08) when the word alone was the cut. The stamp's own header, the date plus an
// optional balanced `( ... )` on the same line (nested parens counted), is skipped before
// the cut is searched. A FENCE line is three or more backticks with an info string holding
// no backtick (or, when open, backticks only); a line that opens and closes an inline ```
// span on itself is an ordinary line, its contents tokenised and backtick parity applied.
//
// WHAT COUNTS AS A VIOLATION. Every root-prefixed path-shaped token in the region (roots
// from `git ls-files` top-level directories as check-cited-paths derives them, PLUS the
// dot-directories it drops, such as .github and .claude; the token class is
// check-cited-paths' [A-Za-z0-9._/-] PLUS @ and +, which tracked files use, such as
// `native/ios/EnterpriseShell/Services/DesignSystem+SwiftUI.swift`, and which
// check-cited-paths never tokenises, so this gate resolves them itself):
//   1. outside any backtick span: check-cited-paths cannot see it. FAIL.
//   2. anywhere else (an exact span, a command span such as `node scripts/x.mjs`, a
//      `scripts/x.mjs:12` span, a fenced block): the token is resolved against
//      `git ls-files` by this gate itself, and a token that is not a tracked file FAILS.
//      The exact-span shortcut ("check-cited-paths sees it") was dropped: it does not see
//      dot-directory roots (.github, .claude), its ALLOW list (/dist/, /build/, ...), or a
//      fenced block, so trusting the backtick let a nonexistent path through there.
// Backtick parity is computed over the whole region (the fence lines themselves blanked),
// so a span hard-wrapped across lines does not flip parity on its continuation line.
//
// WHAT IT CAN MISS. A path in a stamp's trailing sentence after a DATED status marker, a
// path past the 1500-character cap, a path with no extension or a directory-only citation,
// a path under a root that has no tracked file, and a path written as a file that EXISTS
// but is not the one meant (existence is all this checks). Open-PR-only paths are written without
// a directory prefix (below) and are therefore not seen. The report-only "no backticked
// command" count covers none of that.
//
// CONVENTION (already PR #1456's practice). A path that exists only in an OPEN PR is
// written WITHOUT a directory prefix and with the PR number in the same sentence
// ("fixture-idp.mjs (PR #1500)"), never as a backticked or root-prefixed token:
// check-cited-paths would fail the backticked form, and this gate the bare prefixed one.
// That is a convention enforced by omission, not a mechanism.
//
// REPORTED, NEVER FAILED: in-scope stamps with no backticked command (node, pnpm, git,
// grep, sed, ... ; the count is printed by the gate, 3 of 51 on 2026-10-09). A rule
// demanding one would reject history.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

// check-cited-paths shells out to git at import time; a broken checkout must read as a
// stated failure, not a stack trace that happens to exit 1.
let deriveRoots;
let insideBackticks;
try {
  ({ deriveRoots, insideBackticks } = await import("./check-cited-paths.mjs"));
} catch (e) {
  console.error(`stamp-citations: cannot load check-cited-paths (${String(e.message).split("\n")[0]}); failing closed`);
  process.exit(1);
}

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STAMP_RULE_FROM = "2026-10-08";
export const PLAN_FILE = "docs/COMPANY_BUILD_PLAN.md";
export const STAMP_FLOOR = 40;
const IN_SCOPE_FLOOR = 10;
const MAX_REGION = 1500;
const CMD_WINDOW = 1200;

const STATUS = /\b(?:FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED)\b(?=\s+\d{4}-\d{2}-\d{2})/;
// An UNDATED status phrase is a marker only at the start of a sentence or clause ("measured. NOT BUILT:",
// "; AWAITING OWNER ("), never inside prose ("has LANDED"); a DATED one (STATUS) is a marker anywhere.
const PHRASE = /\b(?:FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED)\b/g;
const CLAUSE_START = /(?:[.;:!?]|\s[\u2014\u2013-])\s*$/;
function clauseMarker(after, hdrLen) {
  for (const m of after.slice(hdrLen).matchAll(PHRASE)) if (!/^[\s:\u2014\u2013-]*$/.test(after.slice(hdrLen, hdrLen + m.index)) && CLAUSE_START.test(after.slice(0, hdrLen + m.index))) return hdrLen + m.index;
  return -1;
}
const MARKER = /re-?measured\s+(\d{4}-\d{2}-\d{2})/gi;
const ROW = /^(\d+[a-z]?)\.\s/;

const escRe = (r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Length of the stamp header: the marker plus, on the same line, one balanced ( ... ) and a colon. */
function headerLength(after, mutate = {}) {
  const m = /^re-?measured\s+\d{4}-\d{2}-\d{2}/i.exec(after);
  let i = m ? m[0].length : 0;
  const rest = /^\s*\(/.exec(after.slice(i));
  if (rest) {
    let depth = 0;
    for (let j = i + rest[0].length - 1; j < after.length && after[j] !== "\n"; j += 1) {
      if (after[j] === "(") depth += 1;
      else if (after[j] === ")") { depth -= 1; if (depth === 0 || mutate.headerFirstParen) { i = j + 1; break; } }
    }
  }
  return i;
}

/**
 * Per line: "fence" (an opening or closing fence line), "in" (inside a fenced block) or "out".
 * An opener is three or more backticks and an info string with no backtick in it, so a line
 * that opens AND closes an inline ``` span is an ordinary line; a closer is backticks only.
 * `anyTripleToggles` (self-test mutant) restores the old rule: any line starting with ``` flips.
 */
function fenceKinds(lines, mutate = {}) {
  let open = false;
  return lines.map((ln) => {
    if (mutate.anyTripleToggles ? /^\s*```/.test(ln) : open ? /^\s*`{3,}\s*$/.test(ln) : /^\s*`{3,}[^`]*$/.test(ln)) { open = !open; return "fence"; }
    return open ? "in" : "out";
  });
}

/**
 * statusText's rule (check-backlog-ownership.mjs), offset-preserving: inside each numbered row,
 * backtick spans, then straight-quoted, then curly-quoted spans have every character but a line
 * break replaced by a space. objective-loop's rowMeasuredAt finds its stamps in that text, so a
 * marker split by a span ("RE-MEASURED `(head x)` 2026-10-09") resets a row's clock there and
 * must be a stamp here.
 */
export function maskSpans(text) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return text.split(/(?=^\d+[a-z]*(?:-\d+)?\.\s+\*\*)/m)
    .map((row) => row.replace(/`[^`]*`/g, blank).replace(/"[^"]*"/g, blank).replace(/\u201c[^\u201d]*\u201d/g, blank))
    .join("");
}

/** Root-prefixed, extension-bearing path token; a preceding backtick is fine, parity decides. */
export function buildTokenPattern(roots, mutate = {}) {
  const cls = mutate.narrowClass ? "A-Za-z0-9._\\/-" : "A-Za-z0-9._\\/@+-";
  return new RegExp(`(?<![A-Za-z0-9_-])(?<![A-Za-z0-9_-]\\/)((?:${roots.map(escRe).join("|")})\\/[${cls}]+\\.[A-Za-z0-9]{1,6})`, "g");
}

/**
 * Pure: every stamp in `text`: { date, row, line, text, window }. `mutate` is for the
 * self-test only: paragraphOnly drops the marker/status cuts, firstNewline ends at the
 * first line break, noBlankStop drops the blank-line and next-row stops, undatedStatus
 * restores the old status cut that did not need a date.
 */
export function stampRegions(text, mutate = {}) {
  // Markers as written AND as rowMeasuredAt reads them (spans masked): the union, so a stamp
  // either reader sees is checked. Same offsets in both texts, so one index identifies both.
  const masked = mutate.rawMarkersOnly ? text : maskSpans(text);
  const byIndex = new Map();
  for (const m of [...text.matchAll(MARKER), ...masked.matchAll(MARKER)]) if (!byIndex.has(m.index)) byIndex.set(m.index, m);
  const marks = [...byIndex.values()].sort((a, b) => a.index - b.index);
  const docLines = text.split("\n");
  const kinds = fenceKinds(docLines, mutate);
  const lineStart = [];
  for (let i = 0, off = 0; i < docLines.length; off += docLines[i].length + 1, i += 1) lineStart.push(off);
  /** Offset (relative to `from`) of the newline before the first blank line or next row outside a fence, or -1. */
  const paragraphEnd = (from) => {
    let i = lineStart.findLastIndex((o) => o <= from);
    for (i += 1; i < docLines.length; i += 1) {
      if (!mutate.fenceBlankStop && kinds[i] !== "out") continue;
      const blank = docLines[i] === "";
      if (blank && !mutate.noFenceLookahead) {
        let k = i;
        while (k < docLines.length && docLines[k] === "") k += 1;
        if (k < docLines.length && kinds[k] === "fence") { i = k - 1; continue; }
      }
      if (blank || /^\d+[a-z]?\. \*\*/.test(docLines[i])) return lineStart[i] - 1 - from;
    }
    return -1;
  };
  const out = [];
  const status = mutate.undatedStatus ? /\b(?:FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED)\b/ : STATUS;
  for (let k = 0; k < marks.length; k += 1) {
    const mk = marks[k];
    const after = text.slice(mk.index);
    const hdrSrc = /^re-?measured\s+\d{4}-\d{2}-\d{2}/i.test(after) ? after : masked.slice(mk.index);
    const hdrLen = mutate.noHeaderSkip ? 0 : headerLength(hdrSrc, mutate);
    const stops = [
      mutate.noBlankStop ? -1 : paragraphEnd(mk.index),
      mutate.firstNewline ? after.indexOf("\n") : -1,
      mutate.paragraphOnly ? -1 : marks[k + 1] ? marks[k + 1].index - mk.index : -1,
      mutate.paragraphOnly ? -1 : (() => { const i = after.slice(hdrLen).search(status); return i < 0 ? -1 : hdrLen + i; })(),
      mutate.paragraphOnly || mutate.undatedStatus || mutate.noClauseStart ? -1 : clauseMarker(after, hdrLen),
    ].filter((x) => x > 0);
    const end = Math.min(after.length, MAX_REGION, ...stops);
    const before = text.slice(0, mk.index);
    const lineNo = before.split("\n").length;
    let row = null;
    const lines = before.split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const m = ROW.exec(lines[i]);
      if (m) { row = m[1]; break; }
      if (lines[i].trim() === "") break;
    }
    out.push({ date: mk[1], row: row ?? `line ${lineNo}`, line: lineNo, text: after.slice(0, end), window: after.slice(0, CMD_WINDOW) });
  }
  return out;
}

/** Fence marker lines blanked (so their backticks do not flip parity); returns the text and which offsets sit in a fence. */
function fenceInfo(regionText, mutate = {}) {
  let offset = 0;
  const ranges = [];
  const raw = regionText.split("\n");
  const kinds = fenceKinds(raw, mutate);
  const lines = raw.map((ln, i) => {
    const start = offset;
    offset += ln.length + 1;
    if (kinds[i] === "fence") return " ".repeat(ln.length);
    if (kinds[i] === "in") ranges.push([start, start + ln.length]);
    return ln;
  });
  return { text: lines.join("\n"), inFence: (i) => ranges.some(([lo, hi]) => i >= lo && i < hi) };
}

/**
 * Pure: path tokens in `regionText` as { path, inside }: `inside` is backtick parity over
 * the whole region (a hard-wrapped span stays one span), and is true for a token in a
 * fenced block (which check-cited-paths cannot see either, so it is resolved, not trusted).
 * `inside` is replaceable for the mutant.
 */
export function pathTokens(regionText, roots, inside = insideBackticks, mutate = {}) {
  const { text, inFence } = fenceInfo(regionText, mutate);
  const out = [];
  for (const m of text.matchAll(buildTokenPattern(roots, mutate))) {
    out.push({ path: m[1], inside: inFence(m.index) || inside(text, m.index), exact: text[m.index - 1] === "`" && text[m.index + m[1].length] === "`" });
  }
  return out;
}

/** Pure: root-prefixed path tokens outside any backtick span or fence. */
export function unbackticked(regionText, roots, inside = insideBackticks) {
  return pathTokens(regionText, roots, inside).filter((t) => !t.inside).map((t) => t.path);
}

const CMD_SPAN = /`(?:node|pnpm|npm|npx|bash|sh|git|gh|grep|rg|sed|awk|wc|cat|head|tail|ls|find|jq|curl|python3?|\.\/)\s[^`]*`/;

/** Roots for the gate: check-cited-paths' own, plus the tracked dot-directories it drops. */
export function stampRoots(tracked, mutate = {}) {
  const roots = new Set(deriveRoots(REPO));
  for (const f of mutate.noDotRoots ? [] : tracked) {
    const slash = f.indexOf("/");
    if (slash > 1 && f.startsWith(".")) roots.add(f.slice(0, slash));
  }
  return [...roots].sort();
}

/** Pure: the whole check over `text`. `exists(path)` says whether a token is a tracked file. */
export function check(text, roots, exists, mutate = {}, inScopeFloor = 0) {
  const stamps = stampRegions(text, mutate);
  const inScope = mutate.noCutoff ? stamps : stamps.filter((s) => s.date >= STAMP_RULE_FROM);
  const violations = [];
  let tokens = 0;
  let noCommand = 0;
  for (const s of inScope) {
    const toks = pathTokens(s.text, roots, mutate.alwaysInside ? () => true : insideBackticks, mutate);
    tokens += toks.length;
    for (const t of toks) {
      if (!t.inside) violations.push({ row: s.row, line: s.line, date: s.date, token: t.path, why: "outside backticks; check-cited-paths cannot see it" });
      else if (!(mutate.trustExact && t.exact) && !exists(t.path)) violations.push({ row: s.row, line: s.line, date: s.date, token: t.path, why: "not a tracked file (inside a span or fence, where check-cited-paths does not resolve it)" });
    }
    if (!CMD_SPAN.test(s.window)) noCommand += 1;
  }
  const errors = [];
  if (stamps.length < STAMP_FLOOR) errors.push(`only ${stamps.length} stamps found, floor ${STAMP_FLOOR}: the matcher has stopped matching`);
  if (inScope.length < inScopeFloor) errors.push(`only ${inScope.length} stamps dated ${STAMP_RULE_FROM} or later, floor ${inScopeFloor}: the date cut-off or the matcher has excluded everything`);
  for (const v of violations) errors.push(`row ${v.row} (line ${v.line}, stamp ${v.date}): ${v.token}: ${v.why}`);
  return { stamps: stamps.length, inScope: inScope.length, tokens, violations, noCommand, errors, ok: errors.length === 0 };
}

/** Pure: why the derived inputs cannot be trusted, or null. */
export function preconditionError(tracked, roots) {
  if (tracked.size < 100) return `only ${tracked.size} tracked files`;
  if (!roots.includes("scripts") || !roots.includes("docs")) return `derived roots ${roots.join(",")} lack scripts/docs`;
  return null;
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
  return new Set(out.split("\n").filter(Boolean));
}

function runCli(file) {
  // One read, no existence check first: a check-then-read pair is a race (CodeQL
  // js/file-system-race), and the read itself reports a missing file or a directory.
  let text;
  try {
    if (!file) throw new Error("no file given");
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`stamp-citations: ${file || "(no file given)"} not readable; failing closed`);
    return 1;
  }
  let tracked;
  try { tracked = trackedFiles(); } catch (e) { console.error(`stamp-citations: git ls-files failed (${String(e.message).split("\n")[0]}); failing closed`); return 1; }
  const roots = stampRoots(tracked);
  const bad = preconditionError(tracked, roots);
  if (bad) { console.error(`stamp-citations: ${bad}; failing closed`); return 1; }
  const r = check(text, roots, (p) => tracked.has(p), {}, IN_SCOPE_FLOOR);
  console.log(`stamp-citations: ${r.stamps} stamps, ${r.inScope} dated ${STAMP_RULE_FROM} or later, ${r.tokens} path tokens checked, ${r.violations.length} violations`);
  console.log(`report only: ${r.noCommand} of ${r.inScope} in-scope stamps carry no backticked command in the ${CMD_WINDOW} characters after the marker`);
  for (const e of r.errors) console.error(`  FAIL ${e}`);
  return r.ok ? 0 : 1;
}

async function selfTest() {
  const { rowMeasuredAt } = await import("./objective-loop.mjs");
  const real = new Set(["scripts/real.mjs", "docs/real.md", ".github/real.yml", ".claude/real.md", "scripts/a@2x+b.png"]);
  const roots = stampRoots(real);
  const exists = (p) => real.has(p);
  const stamp = (date, body) => `1. **Row one.** RE-MEASURED ${date} (open): ${body}\n`;
  const filler = Array.from({ length: STAMP_FLOOR }, (_, i) => `${i + 2}. **Pad ${i}.** RE-MEASURED 2026-01-01: padding.\n`).join("\n");
  const doc = (s) => `${s}\n${filler}`;
  const longHdr = `(${"DONE, a long verdict, ".repeat(12)}and more)`;
  const cases = [
    { name: "unbackticked path in a 2026-10-08 stamp -> red, names the row", text: doc(stamp("2026-10-08", "see scripts/x.mjs for it.")), ok: false, mention: "row 1" },
    { name: "the same path backticked, tracked -> green", text: doc(stamp("2026-10-08", "see `scripts/real.mjs` for it.")), ok: true },
    { name: "an unbackticked path that IS tracked -> still red (visibility, not existence)", text: doc(stamp("2026-10-08", "see scripts/real.mjs for it.")), ok: false },
    { name: "a 2026-09-26 stamp with an unbackticked path -> green (before the start date)", text: doc(stamp("2026-09-26", "see scripts/x.mjs for it.")), ok: true },
    { name: "a bare basename with no root prefix -> green", text: doc(stamp("2026-10-08", "see x.mjs (PR #1500) for it.")), ok: true },
    { name: "a path in the dated FIX PROPOSED sentence after the stamp -> not charged", text: doc(stamp("2026-10-08", "done. FIX PROPOSED 2026-10-08 (branch b): scripts/x.mjs lands.")), ok: true },
    { name: "a stamp opening with its verdict still reads its body", text: doc(stamp("2026-10-08", "DONE, see scripts/y.mjs.")), ok: false },
    { name: "a LONG parenthesised verdict header does not truncate the stamp", text: doc(`1. **Row one.** RE-MEASURED 2026-10-08 ${longHdr}: see scripts/x.mjs.\n`), ok: false },
    { name: "an unclosed parenthesis in the header does not truncate the stamp", text: doc("1. **Row one.** RE-MEASURED 2026-10-08 (DONE, scripts/x.mjs here\n"), ok: false },
    { name: "a sentence-start 'NOT BUILT:' with no date still ends the stamp -> not charged", text: doc(stamp("2026-10-08", "measured. NOT BUILT: scripts/NOPE.mjs is proposed.")), ok: true, mutant: "clauseStart" },
    { name: "a sentence-start 'AWAITING OWNER (' ends the stamp -> not charged", text: doc(stamp("2026-10-08", "measured; AWAITING OWNER (scripts/NOPE.mjs).")), ok: true, mutant: "clauseStart" },
    { name: "a sentence-start 'BLOCKED ON LAB (' ends the stamp -> not charged", text: doc(stamp("2026-10-08", "measured. BLOCKED ON LAB (scripts/NOPE.mjs).")), ok: true, mutant: "clauseStart" },
    { name: "a status word used as prose (no date after it) does not end the stamp", text: doc(stamp("2026-10-08", "PR #1455 has LANDED, then scripts/x.mjs was read.")), ok: false },
    { name: "inline code span holding tracked paths -> green", text: doc(stamp("2026-10-08", "see `scripts/real.mjs` and `docs/real.md`.")), ok: true },
    { name: "a fenced block holding a tracked path -> green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08:\n```\nnode scripts/real.mjs --smoke\n```\n"), ok: true },
    { name: "a fenced block holding a nonexistent path -> red", text: doc("1. **Row one.** RE-MEASURED 2026-10-08:\n```\nnode scripts/x.mjs --smoke\n```\n"), ok: false },
    { name: "an EXACT span on a nonexistent dot-directory path -> red", text: doc(stamp("2026-10-08", "see `.github/NOPE.yml` here.")), ok: false },
    { name: "an EXACT span on a nonexistent .claude path -> red", text: doc(stamp("2026-10-08", "see `.claude/NOPE.md` here.")), ok: false },
    { name: "an EXACT span on a nonexistent path under a dist directory -> red", text: doc(stamp("2026-10-08", "see `scripts/dist/NOPE.mjs` here.")), ok: false },
    { name: "an exact span on a tracked .claude path -> green", text: doc(stamp("2026-10-08", "see `.claude/real.md` here.")), ok: true },
    { name: "a header that holds a dated status word does not end the stamp early", text: doc("1. **Row one.** RE-MEASURED 2026-10-08 (DONE 2026-10-08, scripts/x.mjs): body.\n"), ok: false },
    { name: "a nonexistent path inside a command span -> red", text: doc(stamp("2026-10-08", "ran `node scripts/NOPE.mjs`.")), ok: false },
    { name: "a tracked path inside a command span -> green", text: doc(stamp("2026-10-08", "ran `node scripts/real.mjs --json`.")), ok: true },
    { name: "a nonexistent path with a :N suffix in a span -> red", text: doc(stamp("2026-10-08", "see `scripts/NOPE.mjs:12`.")), ok: false },
    { name: "a nonexistent dot-directory path -> red", text: doc(stamp("2026-10-08", "see .github/NOPE.yml here.")), ok: false },
    { name: "a dot-directory path that is tracked, backticked -> green", text: doc(stamp("2026-10-08", "see `.github/real.yml` here.")), ok: true },
    { name: "a ./-prefixed bare path -> red", text: doc(stamp("2026-10-08", "read ./scripts/x.mjs here.")), ok: false },
    { name: "a hard-wrapped span holding a tracked path is not a false positive", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ran `node scripts/real.mjs\n    --json` fine.\n"), ok: true },
    { name: "a bare path after a hard-wrapped span is still caught", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ran `node scripts/real.mjs\n    --json` then scripts/x.mjs here.\n"), ok: false },
    { name: "the un-hyphenated Remeasured form is a stamp too", text: doc("1. **Row one.** Remeasured 2026-10-09: read scripts/x.mjs.\n"), ok: false },
    { name: "a path on the stamp's second line (same paragraph) is read", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: first line,\n    then scripts/x.mjs on the second.\n"), ok: false },
    { name: "a path after a blank line is not charged to the stamp", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: fine.\n\nunrelated scripts/x.mjs paragraph.\n"), ok: true },
    { name: "a path past the 1500-character cap is not read", text: doc(stamp("2026-10-08", `${"x ".repeat(800)}scripts/x.mjs`)), ok: true },
    { name: "a list-item fence (blank line, then the fence) holding a nonexistent path -> red", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ran\n\n    ```bash\n    node scripts/x.mjs --smoke\n    ```\n"), ok: false },
    { name: "a fence with an internal blank line: a nonexistent path after the blank -> red", text: doc("1. **Row one.** RE-MEASURED 2026-10-08:\n```\nnode scripts/real.mjs\n\nnode scripts/x.mjs\n```\n"), ok: false },
    { name: "a line STARTING with an inline ``` span holding a nonexistent path -> red", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ran\n```node scripts/x.mjs```\n"), ok: false },
    { name: "a line starting with an inline ``` span does not open a fence: a later bare path -> red", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ran\n    ```node scripts/real.mjs```\n    then scripts/real.mjs bare.\n"), ok: false },
    { name: "a backticked nonexistent path holding @ -> red", text: doc(stamp("2026-10-08", "see `scripts/NOPE@2x.png` here.")), ok: false },
    { name: "a backticked nonexistent path holding + -> red", text: doc(stamp("2026-10-08", "see `scripts/NOPE+ui.mjs` here.")), ok: false },
    { name: "a backticked tracked path holding @ and + -> green", text: doc(stamp("2026-10-08", "see `scripts/a@2x+b.png` here.")), ok: true },
    { name: "a nested paren in the header: a dated status word inside it does not end the stamp", text: doc("1. **Row one.** RE-MEASURED 2026-10-08 (still open (see #12) DONE 2026-10-08 elsewhere): see scripts/x.mjs here.\n"), ok: false },
    { name: "a marker split by a code span is a stamp (rowMeasuredAt reads it)", text: doc("1. **Row one.** RE-MEASURED `(head ddf91d60)` 2026-10-09: see scripts/x.mjs.\n"), ok: false, measured: "2026-10-09" },
    { name: "a marker split by a quoted span is a stamp (rowMeasuredAt reads it)", text: doc('1. **Row one.** re-measured "after #1480" 2026-10-09: see scripts/x.mjs.\n'), ok: false, measured: "2026-10-09" },
    { name: "in-scope floor: one in-scope stamp under a floor of 5 -> red", text: doc(stamp("2026-10-08", "fine.")), ok: false, mention: "floor 5", floor: 5 },
    { name: "zero stamps -> red (floor)", text: "1. **Row one.** nothing measured.\n", ok: false, mention: "floor" },
  ];
  let pass = 0;
  let total = 0;
  const say = (ok, label) => { total += 1; if (ok) pass += 1; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); };
  const verdict = (c, mutate, rts = roots) => { const r = check(c.text, rts, exists, mutate, c.floor ?? 0); return r.ok === c.ok && (!c.mention || r.errors.some((e) => e.includes(c.mention))); };
  for (const c of cases) {
    const r = check(c.text, roots, exists, {}, c.floor ?? 0);
    const good = verdict(c);
    say(good, c.name + (good ? ` (${r.ok ? "exit 0" : "exit 1"})` : ` (got ok=${r.ok}: ${r.errors.join(" | ")})`));
  }
  // The split-marker cases are stamps BECAUSE objective-loop's rowMeasuredAt reads them: pin that it still does.
  for (const c of cases.filter((x) => x.measured)) say(rowMeasuredAt(c.text) === c.measured, `rowMeasuredAt reads "${c.name}" as ${c.measured} too`);
  // Mutants: each must turn at least one planted case red.
  const mutants = [
    ["drop the date cut-off", { noCutoff: true }],
    ["end the region at the paragraph only (no marker/status cut)", { paragraphOnly: true }],
    ["treat every path as inside a backtick span", { alwaysInside: true }],
    ["end the region at the first line break", { firstNewline: true }],
    ["drop the blank-line and next-row stops", { noBlankStop: true }],
    ["cut at an undated status word", { undatedStatus: true }],
    ["ignore the sentence-start status marker", { noClauseStart: true }],
    ["skip no header", { noHeaderSkip: true }],
    ["trust an exact backtick span without resolving it", { trustExact: true }],
    ["a blank line ends the region even inside a fence", { fenceBlankStop: true }],
    ["a blank line before a fence ends the region", { noFenceLookahead: true }],
    ["any line starting with ``` flips the fence state", { anyTripleToggles: true }],
    ["end the header at the first ')'", { headerFirstParen: true }],
    ["find markers in the raw text only (no span masking)", { rawMarkersOnly: true }],
    ["the path-token class without @ and +", { narrowClass: true }],
  ];
  for (const [label, mutate] of mutants) say(cases.some((c) => !verdict(c, mutate)), `mutant "${label}" turns a planted case red`);
  const noDot = stampRoots(real, { noDotRoots: true });
  say(cases.some((c) => !verdict(c, {}, noDot)), `mutant "stampRoots drops the dot-directory roots" turns a planted case red`);
  say(preconditionError(new Set(["scripts/a.mjs"]), roots) !== null, "precondition: a handful of tracked files is refused");
  say(preconditionError(new Set(Array.from({ length: 200 }, (_, i) => `x/${i}.md`)), ["x"]) !== null, "precondition: roots without scripts and docs are refused");
  say(preconditionError(new Set(Array.from({ length: 200 }, (_, i) => `x/${i}.md`)), roots) === null, "precondition: a plausible tree is accepted");
  // The shipped CLI exit codes, through a scratch file, against this repository's tracked files.
  const dir = mkdtempSync(join(tmpdir(), "stamp-citations-"));
  try {
    for (const [label, body, want] of [
      ["CLI: unbackticked real path", "see scripts/check-cited-paths.mjs", 1],
      ["CLI: backticked real path", "see `scripts/check-cited-paths.mjs`", 0],
      ["CLI: command span with a nonexistent path", "ran `node scripts/check-stamp-NOPE.mjs`", 1],
      ["CLI: command span with a real path", "ran `node scripts/check-cited-paths.mjs --json`", 0],
    ]) {
      const f = join(dir, "plan.md");
      const inScopePad = Array.from({ length: IN_SCOPE_FLOOR }, (_, i) => `${i + 100}. **Pad ${i}.** RE-MEASURED 2026-10-08: nothing cited.\n`).join("\n");
      writeFileSync(f, `${doc(stamp("2026-10-08", body))}\n${inScopePad}`);
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--file", f], { encoding: "utf8" });
      say(r.status === want, `${label} -> exit ${want}`);
    }
    const noArg = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--file"], { encoding: "utf8" });
    say(noArg.status === 1 && noArg.stderr.includes("failing closed"), "CLI: --file with no argument -> exit 1 with a stated failure");
    for (const [label, target] of [["a missing file", join(dir, "absent.md")], ["a directory", dir]]) {
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--file", target], { encoding: "utf8" });
      say(r.status === 1 && r.stderr.includes("failing closed"), `CLI: --file naming ${label} -> exit 1 with a stated failure`);
    }
    const noGit = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: "utf8", env: { ...process.env, GIT_DIR: "/nonexistent" } });
    say(noGit.status === 1 && noGit.stderr.includes("failing closed"), "CLI: unreadable git state -> exit 1 with a stated failure");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`stamp-citations self-test: ${pass}/${total}`);
  return pass === total ? 0 : 1;
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(await selfTest());
  const i = argv.indexOf("--file");
  const given = i >= 0 ? argv[i + 1] : undefined;
  process.exit(runCli(i >= 0 ? (given && !given.startsWith("--") ? resolve(given) : "") : join(REPO, PLAN_FILE)));
}
