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
// `re-measured YYYY-MM-DD` (case-insensitive) to the EARLIEST of: a blank line, the next
// numbered row (`17c. **`), the next `re-measured` marker, the next status marker
// (FIX PROPOSED, NOT BUILT, CORRECTED, LANDED, DONE, AWAITING, BLOCKED) or 1500
// characters. The stamp's own header — the date, an optional `( ... )` and `:`, and one
// status word right after it ("RE-MEASURED 2026-10-08 (open): DONE — ...") — is skipped
// before looking for a status marker, so a stamp that opens with its verdict is not
// truncated to nothing. A neighbouring sentence ("FIX PROPOSED ... `scripts/x.mjs`") is
// not charged to the stamp.
//
// WHAT IT CAN MISS. A path in a stamp's trailing sentence after a marker this list does
// not know, or after one of the known words used as ordinary prose ("DONE 2026-09-30"
// mid-stamp ends the region early). The region is cut at 1500 characters. The report-only
// "no backticked command" count covers none of that. A path is a root-prefixed token with
// an extension, roots derived from `git ls-files` exactly as check-cited-paths does.
//
// CONVENTION (already PR #1456's practice). A path that exists only in an OPEN PR is
// written WITHOUT a directory prefix and with the PR number in the same sentence
// ("fixture-idp.mjs (PR #1500)"), never as a backticked or root-prefixed token:
// check-cited-paths would fail the backticked form, and this gate the bare prefixed one.
// That is a convention enforced by omission, not a mechanism.
//
// REPORTED, NEVER FAILED: in-scope stamps with no backticked command (56 of 77 stamps
// had none at the time of writing); a rule demanding one would reject history.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { deriveRoots, insideBackticks } from "./check-cited-paths.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const STAMP_RULE_FROM = "2026-10-08";
export const PLAN_FILE = "docs/COMPANY_BUILD_PLAN.md";
export const STAMP_FLOOR = 40;
const MAX_REGION = 1500;
const CMD_WINDOW = 1200;

const STATUS = /\b(?:FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED)\b/;
const MARKER = /re-measured\s+(\d{4}-\d{2}-\d{2})/gi;
const HEADER = /^re-measured\s+\d{4}-\d{2}-\d{2}\s*(?:\([^)\n]{0,200}\))?\s*:?\s*(?:FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED)?/i;
const ROW = /^(\d+[a-z]?)\.\s/;

const escRe = (r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Root-prefixed, extension-bearing path token, backticks allowed to precede (parity decides). */
export function buildTokenPattern(roots) {
  return new RegExp(`(?<![A-Za-z0-9_/.-])((?:${roots.map(escRe).join("|")})\\/[A-Za-z0-9._\\/-]+\\.[A-Za-z0-9]{1,6})`, "g");
}

/**
 * Pure: every stamp in `text`: { date, row, line, text } with the region cut as the header
 * above says. `mutate` is for the self-test only (paragraphOnly drops the status/marker cuts).
 */
export function stampRegions(text, mutate = {}) {
  const marks = [...text.matchAll(MARKER)];
  const out = [];
  for (let k = 0; k < marks.length; k += 1) {
    const mk = marks[k];
    const after = text.slice(mk.index);
    const header = HEADER.exec(after);
    const hdrLen = header ? header[0].length : mk[0].length;
    const stops = [
      after.indexOf("\n\n"),
      after.search(/\n\d+[a-z]?\. \*\*/),
      mutate.paragraphOnly ? -1 : marks[k + 1] ? marks[k + 1].index - mk.index : -1,
      mutate.paragraphOnly ? -1 : (() => { const i = after.slice(hdrLen).search(STATUS); return i < 0 ? -1 : hdrLen + i; })(),
    ].filter((x) => x > 0);
    const end = Math.min(after.length, MAX_REGION, ...stops);
    const before = text.slice(0, mk.index);
    const lineNo = before.split("\n").length;
    const lineStart = before.lastIndexOf("\n") + 1;
    // The row id is the numbered row whose line (or an earlier line of it) opened this paragraph.
    let row = null;
    const lines = before.split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const m = ROW.exec(lines[i]);
      if (m) { row = m[1]; break; }
      if (lines[i].trim() === "") break;
    }
    out.push({ date: mk[1], row: row ?? `line ${lineNo}`, line: lineNo, offset: mk.index - lineStart, text: after.slice(0, end), window: after.slice(0, CMD_WINDOW) });
  }
  return out;
}

/** Pure: root-prefixed path tokens in `regionText` outside any backtick span or fence. */
export function unbackticked(regionText, roots) {
  const pattern = buildTokenPattern(roots);
  const found = [];
  let fenced = false;
  for (const ln of regionText.split("\n")) {
    if (/^\s*```/.test(ln)) { fenced = !fenced; continue; }
    if (fenced) continue;
    for (const m of ln.matchAll(pattern)) if (!insideBackticks(ln, m.index)) found.push(m[1]);
  }
  return found;
}

/** Pure: every path-shaped token, backticked or not (the "tokens checked" figure). */
export function allTokens(regionText, roots) {
  return [...regionText.matchAll(buildTokenPattern(roots))].length;
}

const CMD_SPAN = /`(?:node|pnpm|npm|npx|bash|sh|git|\.\/)[^`]*`/;

/** Pure: the whole check over `text`. */
export function check(text, roots, mutate = {}) {
  const stamps = stampRegions(text, mutate);
  const inScope = mutate.noCutoff ? stamps : stamps.filter((s) => s.date >= STAMP_RULE_FROM);
  const violations = [];
  let tokens = 0;
  let noCommand = 0;
  for (const s of inScope) {
    tokens += allTokens(s.text, roots);
    // acceptBackticked (self-test mutant): the matcher treats every path as inside a span.
    for (const t of mutate.acceptBackticked ? [] : unbackticked(s.text, roots)) violations.push({ row: s.row, line: s.line, date: s.date, token: t });
    if (!CMD_SPAN.test(s.window)) noCommand += 1;
  }
  const errors = [];
  if (stamps.length < STAMP_FLOOR) errors.push(`only ${stamps.length} stamps found, floor ${STAMP_FLOOR}: the matcher has stopped matching`);
  for (const v of violations) errors.push(`row ${v.row} (line ${v.line}, stamp ${v.date}): path outside backticks, check-cited-paths cannot see it: ${v.token}`);
  return { stamps: stamps.length, inScope: inScope.length, tokens, violations, noCommand, errors, ok: errors.length === 0 };
}

function runCli(file) {
  if (!existsSync(file)) { console.error(`stamp-citations: ${file} not readable; failing closed`); return 1; }
  const r = check(readFileSync(file, "utf8"), deriveRoots(REPO));
  console.log(`stamp-citations: ${r.stamps} stamps, ${r.inScope} dated ${STAMP_RULE_FROM} or later, ${r.tokens} path tokens checked, ${r.violations.length} violations`);
  console.log(`report only: ${r.noCommand} of ${r.inScope} in-scope stamps carry no backticked command in the ${CMD_WINDOW} characters after the marker`);
  for (const e of r.errors) console.error(`  FAIL ${e}`);
  return r.ok ? 0 : 1;
}

function selfTest() {
  const roots = ["docs", "scripts"];
  const stamp = (date, body) => `1. **Row one.** RE-MEASURED ${date} (open): ${body}\n`;
  const filler = Array.from({ length: STAMP_FLOOR }, (_, i) => `${i + 2}. **Pad ${i}.** RE-MEASURED 2026-01-01: padding.\n`).join("\n");
  const doc = (s) => `${s}\n${filler}`;
  const cases = [
    { name: "unbackticked path in a 2026-10-08 stamp -> red, names the row", text: doc(stamp("2026-10-08", "see scripts/x.mjs for it.")), ok: false, mention: "row 1" },
    { name: "the same path backticked -> green", text: doc(stamp("2026-10-08", "see `scripts/x.mjs` for it.")), ok: true },
    { name: "a 2026-09-26 stamp with an unbackticked path -> green (before the start date)", text: doc(stamp("2026-09-26", "see scripts/x.mjs for it.")), ok: true },
    { name: "a bare basename with no root prefix -> green", text: doc(stamp("2026-10-08", "see x.mjs (PR #1500) for it.")), ok: true },
    { name: "a path in the FIX PROPOSED sentence after the stamp -> not charged", text: doc(stamp("2026-10-08", "done. FIX PROPOSED 2026-10-08 (branch b): scripts/x.mjs lands.")), ok: true },
    { name: "a stamp opening with its verdict still reads its body", text: doc(stamp("2026-10-08", "DONE, see scripts/y.mjs.")), ok: false },
    { name: "inline code span with two backticks on the line -> green", text: doc(stamp("2026-10-08", "see `scripts/x.mjs` and `docs/y.md`.")), ok: true },
    { name: "a fenced block holding the path -> green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08:\n```\nscripts/x.mjs\n```\n"), ok: true },
    { name: "zero stamps -> red (floor)", text: "1. **Row one.** nothing measured.\n", ok: false, mention: "floor" },
  ];
  let pass = 0;
  let total = 0;
  const say = (ok, label) => { total += 1; if (ok) pass += 1; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); };
  for (const c of cases) {
    const r = check(c.text, roots);
    const good = r.ok === c.ok && (!c.mention || r.errors.some((e) => e.includes(c.mention)));
    say(good, c.name + (good ? ` (${r.ok ? "exit 0" : "exit 1"})` : ` (got ok=${r.ok}: ${r.errors.join(" | ")})`));
  }
  // Mutants: each must turn at least one planted case red.
  const mutants = [
    ["drop the date cut-off", { noCutoff: true }],
    ["end the region at the paragraph only", { paragraphOnly: true }],
    ["accept a path inside backticks wrongly (matcher ignores the span)", { acceptBackticked: true }],
  ];
  for (const [label, mutate] of mutants) {
    const red = cases.some((c) => {
      const r = check(c.text, roots, mutate);
      return !(r.ok === c.ok && (!c.mention || r.errors.some((e) => e.includes(c.mention))));
    });
    say(red, `mutant "${label}" turns a planted case red`);
  }
  // The shipped CLI exit codes, through a scratch file.
  const dir = mkdtempSync(join(tmpdir(), "stamp-citations-"));
  try {
    for (const [label, body, want] of [["CLI: unbackticked real path", "see scripts/check-cited-paths.mjs", 1], ["CLI: backticked real path", "see `scripts/check-cited-paths.mjs`", 0]]) {
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
