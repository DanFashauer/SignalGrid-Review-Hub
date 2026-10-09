// Stamp citations — a re-measured stamp must backtick the repo paths it cites.
//
//   node scripts/check-stamp-citations.mjs                  # gate docs/COMPANY_BUILD_PLAN.md
//   node scripts/check-stamp-citations.mjs --file <path>    # gate another copy (falsification)
//   node scripts/check-stamp-citations.mjs --self-test      # prove the gate can fail
//
// WHY. `check-cited-paths.mjs` proves a cited path exists, but ONLY when the path is the
// entire content of a backtick span (its pattern is backtick + path + backtick). A stamp
// that writes `scripts/fixture-idp-NOPE.mjs` in plain text passes with exit 0 (PR #1456
// round-1 mutant M5a). Round 1 of this PR showed the same hole one step further: a path
// inside a COMMAND span (`node scripts/NOPE.mjs`, `grep -n x lib/NOPE.ts`) or carrying a
// `:N` suffix is also invisible to check-cited-paths (51 of the 118 in-scope tokens at
// the time), so "backtick it" does not make it checkable.
//
// THE RULE (the fail-closed choice, round 1 finding b). This gate does not lean on
// check-cited-paths for stamps. For every root-prefixed path token in an in-scope stamp it
// (1) fails a token outside backticks (the style rule: the path must be findable by the
// reader and by the other gates), and (2) checks the token's existence ITSELF against
// `git ls-files`, wherever the token sits: bare, in an exact span, in a command span, with
// a `:N` suffix. Requiring exact path-only spans instead would have rewritten 51 dated
// evidence commands; checking existence here closes the hole without touching the record.
// Roots are check-cited-paths' roots PLUS the tracked dot-directories (.github, .claude,
// ...) which deriveRoots drops, so a nonexistent `.github/workflows/NOPE.yml` is caught.
// A tracked-file set that is empty, or roots missing `scripts`/`docs`, fail the run: an
// unreadable git state tightens the answer, it does not skip the check.
//
// A stamp is dated STAMP_RULE_FROM or later. Older stamps are a dated record; rewriting
// them would falsify it.
//
// WHAT A STAMP IS (a heuristic over prose, not a parser). A stamp runs from
// `re-measured YYYY-MM-DD` (case-insensitive, hyphen optional: the clock reader
// objective-loop.mjs accepts `remeasured`) to the EARLIEST of: a blank line, the next
// numbered row (`17c. **`), the next `re-measured` marker, the next status MARKER, or 1500
// characters. A status marker is a status phrase at the START of a sentence or clause
// (start of text, or after `.` `;` `:` `!` `?` or a dash): `FIX PROPOSED <date>`,
// `NOT BUILT`, `CORRECTED`, `LANDED`, `DONE`, `AWAITING OWNER (`, `BLOCKED ON LAB (`.
// The same word inside prose ("PR #1455 has LANDED", "still reading FIX PROPOSED for a
// merged PR") is NOT a marker and no longer cuts the stamp (round 1 finding a: it cut
// rows 61 and 170 short). The stamp's own header, the date plus one BALANCED parenthetical
// of any length and nesting and an optional `:` and one status word, is skipped before
// looking for a marker, so a long "(DONE, ...)" header never truncates the region (row 28
// was cut to 24 characters). A header parenthesis that never closes is not skipped: its
// contents stay in the region. A neighbouring sentence ("FIX PROPOSED 2026-10-08 ... x")
// is not charged to the stamp.
//
// WHAT IT CAN MISS. A path after a marker phrase this list does not know, or written as a
// placeholder with a glob. The region is cut at 1500 characters. A path that exists only
// in an OPEN PR is written WITHOUT a directory prefix and with the PR number in the same
// sentence ("fixture-idp.mjs (PR #1500)"); that convention is enforced by omission, not by
// a mechanism.
//
// REPORTED, NEVER FAILED: in-scope stamps with no backticked evidence command (any of
// node/pnpm/grep/sed/ls/... counts); a rule demanding one would reject history.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

// check-cited-paths shells out to git at import time; a broken checkout must read as a
// stated failure, not a stack trace that happens to exit 1.
let deriveRoots;
try {
  ({ deriveRoots } = await import("./check-cited-paths.mjs"));
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

const PHRASES = "FIX PROPOSED|NOT BUILT|CORRECTED|LANDED|DONE|AWAITING|BLOCKED";
const STATUS = new RegExp(`\\b(?:${PHRASES})\\b`, "g");
const MARKER = /re-?measured\s+(\d{4}-\d{2}-\d{2})/gi;
const HEAD_DATE = /^re-?measured\s+\d{4}-\d{2}-\d{2}/i;
const HEAD_TAIL = new RegExp(`^\\s*(?:[:\\u2014\\u2013-]\\s*)?(?:${PHRASES})?`);
// A status phrase is a MARKER only at the start of a sentence or clause.
const CLAUSE_START = /(?:[.;:!?]|\s[—–-])\s*$/;
const ROW = /^(\d+[a-z]?)\.\s/;

const escRe = (r) => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Root-prefixed, extension-bearing path token; a leading `./` is allowed, a longer prefix is not. */
export function buildTokenPattern(roots) {
  return new RegExp(`(?:(?<![A-Za-z0-9_/.-])|(?<=(?<![A-Za-z0-9_/.-])\\.\\/))((?:${roots.map(escRe).join("|")})\\/[A-Za-z0-9._\\/-]+\\.[A-Za-z0-9]{1,6})`, "g");
}

/** Index of the `)` matching the `(` at `open`, or -1 when it never closes inside the paragraph. */
function balancedClose(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "\n" && text[i + 1] === "\n") return -1;
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** Length of the stamp's own header: date, one balanced parenthetical of any length, `:`/dash, one status word. */
export function headerLength(after) {
  let i = HEAD_DATE.exec(after)?.[0].length ?? 0;
  const ws = /^\s*/.exec(after.slice(i))[0].length;
  if (after[i + ws] === "(") {
    const close = balancedClose(after, i + ws);
    if (close > 0) i = close + 1; // an unclosed "(" is NOT skipped: its contents stay in the region
  }
  return i + HEAD_TAIL.exec(after.slice(i))[0].length;
}

/** Index in `after` of the first status marker past the header, or -1. */
function markerIndex(after, hdrLen) {
  for (const m of after.slice(hdrLen).matchAll(STATUS)) {
    const at = hdrLen + m.index;
    if (CLAUSE_START.test(after.slice(0, at))) return at;
  }
  return -1;
}

/**
 * Pure: every stamp in `text`: { date, row, line, text } with the region cut as the header
 * above says. `mutate` is for the self-test only.
 */
export function stampRegions(text, mutate = {}) {
  const marks = [...text.matchAll(MARKER)];
  const out = [];
  for (let k = 0; k < marks.length; k += 1) {
    const mk = marks[k];
    const after = text.slice(mk.index);
    const hdrLen = headerLength(after);
    const para = after.indexOf(mutate.firstNewline ? "\n" : "\n\n");
    const stops = mutate.noStops ? [] : [
      para,
      after.search(/\n\d+[a-z]?\. \*\*/),
      mutate.paragraphOnly ? -1 : marks[k + 1] ? marks[k + 1].index - mk.index : -1,
      mutate.paragraphOnly ? -1 : markerIndex(after, hdrLen),
    ].filter((x) => x > 0);
    const end = Math.min(after.length, mutate.maxRegion ?? MAX_REGION, ...stops);
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

/**
 * Pure: every root-prefixed path token in `region` with { path, spanned }. `spanned` is true
 * when the token sits inside a backtick span (parity over the WHOLE region, so a span that
 * is hard-wrapped across lines stays one span) or inside a fenced block.
 */
export function tokensIn(region, roots) {
  const fenced = new Array(region.length).fill(false);
  let pos = 0;
  let inFence = false;
  for (const ln of region.split("\n")) {
    const isFence = /^\s*```/.test(ln);
    if (isFence) inFence = !inFence;
    if (isFence || inFence) fenced.fill(true, pos, pos + ln.length);
    pos += ln.length + 1;
  }
  const inSpan = new Array(region.length).fill(false);
  let open = -1;
  for (let i = 0; i < region.length; i += 1) {
    if (region[i] !== "`" || fenced[i]) continue;
    if (open === -1) open = i;
    else { inSpan.fill(true, open, i + 1); open = -1; }
  }
  return [...region.matchAll(buildTokenPattern(roots))].map((m) => ({
    path: m[1],
    spanned: inSpan[m.index] || fenced[m.index],
  }));
}

const CMD_SPAN = /`(?:node|pnpm|npm|npx|bash|sh|git|grep|rg|sed|awk|wc|cat|head|tail|ls|jq|find|curl|diff|python3?|\.\/)\b[^`]*`/;

/**
 * Pure: the whole check over `text`. `ctx` = { roots, tracked: Set<string> }. A token is a
 * violation when it is outside backticks, or when it does not exist in `tracked`.
 */
export function check(text, ctx, mutate = {}) {
  const { roots, tracked } = ctx;
  const stamps = stampRegions(text, mutate);
  const inScope = mutate.noCutoff ? stamps : stamps.filter((s) => s.date >= STAMP_RULE_FROM);
  const violations = [];
  let tokens = 0;
  let noCommand = 0;
  for (const s of inScope) {
    for (const t of tokensIn(s.text, roots)) {
      tokens += 1;
      if (!t.spanned && !mutate.acceptBare) violations.push({ row: s.row, line: s.line, date: s.date, token: t.path, why: "outside backticks, the reader and check-cited-paths cannot rely on it" });
      if (!mutate.assumeExists && !tracked.has(t.path)) violations.push({ row: s.row, line: s.line, date: s.date, token: t.path, why: "no such tracked file (this gate checks existence itself: check-cited-paths only sees a path-only span)" });
    }
    if (!CMD_SPAN.test(s.window)) noCommand += 1;
  }
  const errors = [];
  if (stamps.length < STAMP_FLOOR) errors.push(`only ${stamps.length} stamps found, floor ${STAMP_FLOOR}: the matcher has stopped matching`);
  if (!roots.includes("scripts") || !roots.includes("docs")) errors.push(`roots lack scripts/docs (${roots.join(",")}): git state unreadable, failing closed`);
  if (tracked.size === 0) errors.push("git ls-files returned nothing: failing closed");
  for (const v of violations) errors.push(`row ${v.row} (line ${v.line}, stamp ${v.date}): ${v.token}: ${v.why}`);
  return { stamps: stamps.length, inScope: inScope.length, tokens, violations, noCommand, errors, ok: errors.length === 0 };
}

/** Tracked files and the roots to cite them from (deriveRoots' plus tracked dot-directories). */
function repoContext() {
  const tracked = new Set(execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean));
  const roots = new Set(deriveRoots(REPO));
  for (const f of tracked) { const top = f.split("/")[0]; if (top.startsWith(".") && f.includes("/")) roots.add(top); }
  return { roots: [...roots].sort(), tracked };
}

function runCli(file) {
  if (!existsSync(file)) { console.error(`stamp-citations: ${file} not readable; failing closed`); return 1; }
  const r = check(readFileSync(file, "utf8"), repoContext());
  console.log(`stamp-citations: ${r.stamps} stamps, ${r.inScope} dated ${STAMP_RULE_FROM} or later, ${r.tokens} path tokens checked, ${r.violations.length} violations`);
  console.log(`report only: ${r.noCommand} of ${r.inScope} in-scope stamps carry no backticked command in the ${CMD_WINDOW} characters after the marker`);
  for (const e of r.errors) console.error(`  FAIL ${e}`);
  return r.ok ? 0 : 1;
}

function selfTest() {
  const roots = ["docs", "scripts", ".github"];
  const tracked = new Set(["scripts/x.mjs", "scripts/y.mjs", "docs/y.md", ".github/ci.yml"]);
  const ctx = { roots, tracked };
  const stamp = (date, body, head = "(open):") => `1. **Row one.** RE-MEASURED ${date} ${head} ${body}\n`;
  const filler = Array.from({ length: STAMP_FLOOR }, (_, i) => `${i + 2}. **Pad ${i}.** RE-MEASURED 2026-01-01: padding.\n`).join("\n");
  const doc = (s) => `${s}\n${filler}`;
  const long = "x".repeat(250);
  const cases = [
    { name: "bare real path in a 2026-10-08 stamp -> red, names the row", text: doc(stamp("2026-10-08", "see scripts/x.mjs for it.")), ok: false, mention: "row 1" },
    { name: "the same path backticked -> green", text: doc(stamp("2026-10-08", "see `scripts/x.mjs` for it.")), ok: true },
    { name: "a 2026-09-26 stamp with a bare path -> green (before the start date)", text: doc(stamp("2026-09-26", "see scripts/x.mjs for it.")), ok: true },
    { name: "a bare basename with no root prefix -> green", text: doc(stamp("2026-10-08", "see x.mjs (PR #1500) for it.")), ok: true },
    { name: "a path in the FIX PROPOSED sentence after the stamp -> not charged", text: doc(stamp("2026-10-08", "done. FIX PROPOSED 2026-10-08 (branch b): scripts/x.mjs lands.")), ok: true },
    { name: "a stamp opening with its verdict still reads its body", text: doc(stamp("2026-10-08", "DONE, see scripts/y.mjs.")), ok: false },
    { name: "inline code span with two backticks on the line -> green", text: doc(stamp("2026-10-08", "see `scripts/x.mjs` and `docs/y.md`.")), ok: true },
    { name: "a fenced block holding a real path -> green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08:\n```\nscripts/x.mjs\n```\n"), ok: true },
    { name: "zero stamps -> red (floor)", text: "1. **Row one.** nothing measured.\n", ok: false, mention: "floor" },
    // round 1 finding (b): existence checked by this gate, wherever the token sits
    { name: "NOPE path in an exact span -> red", text: doc(stamp("2026-10-08", "see `scripts/NOPE.mjs`.")), ok: false, mention: "no such tracked file" },
    { name: "NOPE path inside a command span -> red (check-cited-paths exit 0 on this)", text: doc(stamp("2026-10-08", "ran `node scripts/NOPE.mjs`.")), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "NOPE path with a :N suffix in a span -> red", text: doc(stamp("2026-10-08", "see `scripts/NOPE.mjs:12`.")), ok: false, mention: "no such tracked file" },
    { name: "real path in a command span -> green", text: doc(stamp("2026-10-08", "ran `node scripts/x.mjs --json`.")), ok: true },
    { name: "real path with ./ prefix in a span -> green", text: doc(stamp("2026-10-08", "ran `./scripts/x.mjs`.")), ok: true },
    { name: "bare ./scripts/NOPE.mjs -> red", text: doc(stamp("2026-10-08", "read ./scripts/NOPE.mjs here.")), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "NOPE under a dot-root (.github) -> red", text: doc(stamp("2026-10-08", "see `.github/NOPE.yml`.")), ok: false, mention: ".github/NOPE.yml" },
    { name: "real path under a dot-root -> green", text: doc(stamp("2026-10-08", "see `.github/ci.yml`.")), ok: true },
    // round 1 finding (a): the region is not cut short
    { name: "row 28 shape: a long (DONE, ...) header, then a bare NOPE path -> red", text: doc(stamp("2026-10-08", `then scripts/NOPE.mjs`, `(DONE, ${long} \`scripts/x.mjs\`, ${long})`)), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "row 28 shape: a header with a nested (...) and a bare NOPE path inside it -> red", text: doc(stamp("2026-10-08", "tail.", `(DONE, a (nested) scripts/NOPE.mjs, ${long})`)), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "an unclosed header paren keeps its contents in the region -> red", text: doc(stamp("2026-10-08", "scripts/NOPE.mjs is here.", "(DONE, unclosed")), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "row 61 shape: 'has LANDED' in prose does not cut the stamp -> red on the NOPE after it", text: doc(stamp("2026-10-08", "the open draft PR #1455 has LANDED (merge abc); node scripts/NOPE.mjs scanned 316.")), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "row 170 shape: 'FIX PROPOSED' in prose does not cut the stamp -> red", text: doc(stamp("2026-10-08", "an open row still reading FIX PROPOSED for a merged PR; see scripts/NOPE.mjs.")), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "a marker at a sentence start ('. NOT BUILT: ...') still ends the stamp -> green", text: doc(stamp("2026-10-08", "measured. NOT BUILT: scripts/NOPE.mjs is proposed.")), ok: true },
    { name: "'; AWAITING OWNER (' ends the stamp -> green", text: doc(stamp("2026-10-08", "measured; AWAITING OWNER (scripts/NOPE.mjs).")), ok: true },
    { name: "'. BLOCKED ON LAB (' ends the stamp -> green", text: doc(stamp("2026-10-08", "measured. BLOCKED ON LAB (scripts/NOPE.mjs).")), ok: true },
    { name: "'Remeasured' without the hyphen is a stamp -> red", text: doc("1. **Row one.** Remeasured 2026-10-09: read scripts/NOPE.mjs here.\n"), ok: false, mention: "scripts/NOPE.mjs" },
    // multi-line stamps and the region stops
    { name: "second line of the same paragraph is read -> red", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: first line,\n   then bare scripts/NOPE.mjs here.\n"), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "a code span hard-wrapped over a line break keeps parity: real path green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ran `node scripts/x.mjs\n   --json` ok, and `docs/y.md`.\n"), ok: true },
    { name: "a code span hard-wrapped over a line break, then a bare NOPE -> red", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ran `node scripts/x.mjs\n   --json` ok, read scripts/NOPE.mjs here.\n"), ok: false, mention: "scripts/NOPE.mjs" },
    { name: "text after a blank line is not the stamp -> green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ok.\n\nAnother paragraph with scripts/NOPE.mjs bare.\n"), ok: true },
    { name: "a path past the 1500-character cap is not read", text: doc(`1. **Row one.** RE-MEASURED 2026-10-08: ${"y".repeat(1600)} scripts/NOPE.mjs bare.\n`), ok: true },
    { name: "the next numbered row is not the stamp -> green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ok.\n2. **Row two.** see scripts/NOPE.mjs bare.\n"), ok: true },
    { name: "the next re-measured marker (older date) ends the stamp -> green", text: doc("1. **Row one.** RE-MEASURED 2026-10-08: ok. RE-MEASURED 2026-09-01: see scripts/NOPE.mjs bare."), ok: true },
  ];
  let pass = 0;
  let total = 0;
  const say = (ok, label) => { total += 1; if (ok) pass += 1; console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`); };
  const good = (c, r) => r.ok === c.ok && (!c.mention || r.errors.some((e) => e.includes(c.mention)));
  for (const c of cases) {
    const r = check(c.text, ctx);
    const g = good(c, r);
    say(g, c.name + (g ? ` (${r.ok ? "exit 0" : "exit 1"})` : ` (got ok=${r.ok}: ${r.errors.join(" | ")})`));
  }
  // Mutants: each must turn at least one planted case red.
  const mutants = [
    ["drop the date cut-off", { noCutoff: true }],
    ["end the region at the paragraph only (no marker cuts)", { paragraphOnly: true }],
    ["never report a bare path", { acceptBare: true }],
    ["assume every path exists", { assumeExists: true }],
    ["cut each region at its first newline", { firstNewline: true }],
    ["remove every region stop", { noStops: true }],
    ["cap the region at 15 characters", { maxRegion: 15 }],
  ];
  for (const [label, mutate] of mutants) {
    const red = cases.some((c) => !good(c, check(c.text, ctx, mutate)));
    say(red, `mutant "${label}" turns a planted case red`);
  }
  // Fail-closed context: no tracked files, or missing roots, is red.
  say(!check(doc(stamp("2026-10-08", "ok.")), { roots, tracked: new Set() }).ok, "empty tracked set -> red");
  say(!check(doc(stamp("2026-10-08", "ok.")), { roots: ["src"], tracked }).ok, "roots without scripts/docs -> red");
  // The shipped CLI exit codes, through a scratch file.
  const dir = mkdtempSync(join(tmpdir(), "stamp-citations-"));
  try {
    for (const [label, body, want] of [
      ["CLI: bare real path", "see scripts/check-cited-paths.mjs", 1],
      ["CLI: backticked real path", "see `scripts/check-cited-paths.mjs`", 0],
      ["CLI: command-span NOPE path", "ran `node scripts/check-launch-claims-NOPE.mjs`", 1],
      ["CLI: NOPE path with :N suffix", "see `scripts/check-launch-claims-NOPE.mjs:12`", 1],
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
