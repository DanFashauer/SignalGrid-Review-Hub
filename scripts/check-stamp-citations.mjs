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
// WHAT A STAMP IS (a heuristic over prose, not a parser). A stamp runs from
// `re-?measured YYYY-MM-DD` (case-insensitive, the form objective-loop's rowMeasuredAt
// reads) to the EARLIEST of: a blank line, the next numbered row (`17c. **`), the next
// `re-measured` marker, the next DATED status marker (FIX PROPOSED, NOT BUILT, CORRECTED,
// LANDED, DONE, AWAITING, BLOCKED, followed by a YYYY-MM-DD) or 1500 characters. A status
// word NOT followed by a date is prose ("has LANDED", "a row still reading FIX PROPOSED")
// and does not end the stamp: that rule cut two real stamps short (rows 28 and 61 on
// 2026-10-08) when the word alone was the cut. The stamp's own header, the date plus an
// optional balanced `( ... )` on the same line, is skipped before the cut is searched.
//
// WHAT COUNTS AS A VIOLATION. Every root-prefixed path-shaped token in the region (roots
// from `git ls-files` top-level directories as check-cited-paths derives them, PLUS the
// dot-directories it drops, such as .github and .claude):
//   1. outside any backtick span or fence: check-cited-paths cannot see it. FAIL.
//   2. inside a backtick span that is NOT exactly the path (`node scripts/x.mjs`,
//      `scripts/x.mjs:12`): check-cited-paths cannot see it either, so this gate resolves
//      it against `git ls-files` itself. A token that is not a tracked file FAILS.
// Backtick parity is computed over the whole region (fenced lines masked), so a span
// hard-wrapped across lines does not flip parity on its continuation line.
//
// WHAT IT CAN MISS. A path in a stamp's trailing sentence after a DATED status marker, a
// path past the 1500-character cap, a path with no extension or a directory-only citation,
// and a path under a root that has no tracked file. Open-PR-only paths are written without
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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const MAX_REGION = 1500;
const CMD_WINDOW = 1200;

const STATUS = /\b(?:FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED)\b(?=\s+\d{4}-\d{2}-\d{2})/;
const MARKER = /re-?measured\s+(\d{4}-\d{2}-\d{2})/gi;
const ROW = /^(\d+[a-z]?)\.\s/;

const escRe = (r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Length of the stamp header: the marker plus, on the same line, one balanced ( ... ) and a colon. */
function headerLength(after) {
  const m = /^re-?measured\s+\d{4}-\d{2}-\d{2}/i.exec(after);
  let i = m ? m[0].length : 0;
  const rest = /^\s*\(/.exec(after.slice(i));
  if (rest) {
    let depth = 0;
    for (let j = i + rest[0].length - 1; j < after.length && after[j] !== "\n"; j += 1) {
      if (after[j] === "(") depth += 1;
      else if (after[j] === ")") { depth -= 1; if (depth === 0) { i = j + 1; break; } }
    }
  }
  return i;
}

/** Root-prefixed, extension-bearing path token; a preceding backtick is fine, parity decides. */
export function buildTokenPattern(roots) {
  return new RegExp(`(?<![A-Za-z0-9_-])(?<![A-Za-z0-9_-]\\/)((?:${roots.map(escRe).join("|")})\\/[A-Za-z0-9._\\/-]+\\.[A-Za-z0-9]{1,6})`, "g");
}

/**
 * Pure: every stamp in `text`: { date, row, line, text, window }. `mutate` is for the
 * self-test only: paragraphOnly drops the marker/status cuts, firstNewline ends at the
 * first line break, noBlankStop drops the blank-line and next-row stops, undatedStatus
 * restores the old status cut that did not need a date.
 */
export function stampRegions(text, mutate = {}) {
  const marks = [...text.matchAll(MARKER)];
  const out = [];
  const status = mutate.undatedStatus ? /\b(?:FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED)\b/ : STATUS;
  for (let k = 0; k < marks.length; k += 1) {
    const mk = marks[k];
    const after = text.slice(mk.index);
    const hdrLen = headerLength(after);
    const stops = [
      mutate.noBlankStop ? -1 : after.indexOf("\n\n"),
      mutate.noBlankStop ? -1 : after.search(/\n\d+[a-z]?\. \*\*/),
      mutate.firstNewline ? after.indexOf("\n") : -1,
      mutate.paragraphOnly ? -1 : marks[k + 1] ? marks[k + 1].index - mk.index : -1,
      mutate.paragraphOnly ? -1 : (() => { const i = after.slice(hdrLen).search(status); return i < 0 ? -1 : hdrLen + i; })(),
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

/** Fenced lines replaced by spaces of the same length, so indexes survive and fences hold no paths. */
function maskFences(regionText) {
  let fenced = false;
  return regionText.split("\n").map((ln) => {
    if (/^\s*```/.test(ln)) { fenced = !fenced; return " ".repeat(ln.length); }
    return fenced ? " ".repeat(ln.length) : ln;
  }).join("\n");
}

/**
 * Pure: path tokens in `regionText` as { path, inside, exact }: `inside` is parity over the
 * whole region (a hard-wrapped span stays one span), `exact` is a span that is nothing but
 * the path, the only form check-cited-paths sees. `inside` is replaceable for the mutant.
 */
export function pathTokens(regionText, roots, inside = insideBackticks) {
  const masked = maskFences(regionText);
  const out = [];
  for (const m of masked.matchAll(buildTokenPattern(roots))) {
    const start = m.index;
    const end = start + m[1].length;
    out.push({ path: m[1], inside: inside(masked, start), exact: masked[start - 1] === "`" && masked[end] === "`" });
  }
  return out;
}

/** Pure: root-prefixed path tokens outside any backtick span or fence. */
export function unbackticked(regionText, roots, inside = insideBackticks) {
  return pathTokens(regionText, roots, inside).filter((t) => !t.inside).map((t) => t.path);
}

const CMD_SPAN = /`(?:node|pnpm|npm|npx|bash|sh|git|gh|grep|rg|sed|awk|wc|cat|head|tail|ls|find|jq|curl|python3?|\.\/)\s[^`]*`/;

/** Roots for the gate: check-cited-paths' own, plus the tracked dot-directories it drops. */
export function stampRoots(tracked) {
  const roots = new Set(deriveRoots(REPO));
  for (const f of tracked) {
    const slash = f.indexOf("/");
    if (slash > 1 && f.startsWith(".")) roots.add(f.slice(0, slash));
  }
  return [...roots].sort();
}

/** Pure: the whole check over `text`. `exists(path)` says whether a token is a tracked file. */
export function check(text, roots, exists, mutate = {}) {
  const stamps = stampRegions(text, mutate);
  const inScope = mutate.noCutoff ? stamps : stamps.filter((s) => s.date >= STAMP_RULE_FROM);
  const violations = [];
  let tokens = 0;
  let noCommand = 0;
  for (const s of inScope) {
    const toks = pathTokens(s.text, roots, mutate.alwaysInside ? () => true : insideBackticks);
    tokens += toks.length;
    for (const t of toks) {
      if (!t.inside) violations.push({ row: s.row, line: s.line, date: s.date, token: t.path, why: "outside backticks; check-cited-paths cannot see it" });
      else if (!t.exact && !exists(t.path)) violations.push({ row: s.row, line: s.line, date: s.date, token: t.path, why: "inside a command or suffixed span and not a tracked file; check-cited-paths cannot see it" });
    }
    if (!CMD_SPAN.test(s.window)) noCommand += 1;
  }
  const errors = [];
  if (stamps.length < STAMP_FLOOR) errors.push(`only ${stamps.length} stamps found, floor ${STAMP_FLOOR}: the matcher has stopped matching`);
  for (const v of violations) errors.push(`row ${v.row} (line ${v.line}, stamp ${v.date}): ${v.token}: ${v.why}`);
  return { stamps: stamps.length, inScope: inScope.length, tokens, violations, noCommand, errors, ok: errors.length === 0 };
}

function trackedFiles() {
  const out = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 });
  return new Set(out.split("\n").filter(Boolean));
}

function runCli(file) {
  if (!existsSync(file)) { console.error(`stamp-citations: ${file} not readable; failing closed`); return 1; }
  let tracked;
  try { tracked = trackedFiles(); } catch (e) { console.error(`stamp-citations: git ls-files failed (${String(e.message).split("\n")[0]}); failing closed`); return 1; }
  if (tracked.size < 100) { console.error(`stamp-citations: only ${tracked.size} tracked files; failing closed`); return 1; }
  const roots = stampRoots(tracked);
  if (!roots.includes("scripts") || !roots.includes("docs")) { console.error(`stamp-citations: derived roots ${roots.join(",")} lack scripts/docs; failing closed`); return 1; }
  const r = check(readFileSync(file, "utf8"), roots, (p) => tracked.has(p));
  console.log(`stamp-citations: ${r.stamps} stamps, ${r.inScope} dated ${STAMP_RULE_FROM} or later, ${r.tokens} path tokens checked, ${r.violations.length} violations`);
  console.log(`report only: ${r.noCommand} of ${r.inScope} in-scope stamps carry no backticked command in the ${CMD_WINDOW} characters after the marker`);
  for (const e of r.errors) console.error(`  FAIL ${e}`);
  return r.ok ? 0 : 1;
}

function selfTest() {
  const roots = ["docs", "scripts", ".github"];
  const real = new Set(["scripts/real.mjs", "docs/real.md", ".github/real.yml"]);
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
    { name: "a status word used as prose (no date after it) does not end the stamp", text: doc(stamp("2026-10-08", "PR #1455 has LANDED, then scripts/x.mjs was read.")), ok: false },
    { name: "inline code span holding tracked paths -> green", text: doc(stamp("2026-10-08", "see `scripts/real.mjs` and `docs/real.md`.")), ok: true },
    { name: "a fenced block holding the path -> green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08:\n```\nscripts/x.mjs\n```\n"), ok: true },
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
    { name: "zero stamps -> red (floor)", text: "1. **Row one.** nothing measured.\n", ok: false, mention: "floor" },
  ];
  let pass = 0;
  let total = 0;
  const say = (ok, label) => { total += 1; if (ok) pass += 1; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); };
  const verdict = (c, mutate) => { const r = check(c.text, roots, exists, mutate); return r.ok === c.ok && (!c.mention || r.errors.some((e) => e.includes(c.mention))); };
  for (const c of cases) {
    const r = check(c.text, roots, exists);
    const good = verdict(c);
    say(good, c.name + (good ? ` (${r.ok ? "exit 0" : "exit 1"})` : ` (got ok=${r.ok}: ${r.errors.join(" | ")})`));
  }
  // Mutants: each must turn at least one planted case red.
  const mutants = [
    ["drop the date cut-off", { noCutoff: true }],
    ["end the region at the paragraph only (no marker/status cut)", { paragraphOnly: true }],
    ["treat every path as inside a backtick span", { alwaysInside: true }],
    ["end the region at the first line break", { firstNewline: true }],
    ["drop the blank-line and next-row stops", { noBlankStop: true }],
    ["cut at an undated status word", { undatedStatus: true }],
  ];
  for (const [label, mutate] of mutants) say(cases.some((c) => !verdict(c, mutate)), `mutant "${label}" turns a planted case red`);
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
      writeFileSync(f, doc(stamp("2026-10-08", body)));
      const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--file", f], { encoding: "utf8" });
      say(r.status === want, `${label} -> exit ${want}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`stamp-citations self-test: ${pass}/${total}`);
  return pass === total ? 0 : 1;
}

const isEntry = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  const argv = process.argv.slice(2);
  if (argv.includes("--self-test")) process.exit(selfTest());
  const i = argv.indexOf("--file");
  process.exit(runCli(i >= 0 ? resolve(argv[i + 1] ?? "") : join(REPO, PLAN_FILE)));
}
