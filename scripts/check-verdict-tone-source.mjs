// check-verdict-tone-source.mjs — a verdict may not pick its own colour inline,
// and may not wear another verdict's.
//
//   node scripts/check-verdict-tone-source.mjs              # gate
//   node scripts/check-verdict-tone-source.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS. `check-decision-palette.mjs` asserts that a verdict is painted
// from a RATIFIED TOKEN. Backlog row 151 was three real defects — fail-closed
// shown in the danger tone, `restrict` wearing the step-up tone, and two verdicts
// sharing one legend swatch — and that gate exited 0 before the fix and exits 0
// after it. Every one of those defects used a ratified token. It has no concept
// of WHICH verdict maps to which token (backlog row 168).
//
// This gate answers in two steps. First STRUCTURALLY: the decision is made in ONE
// place, a total `Record` over the closed verdict union, so the compiler catches a
// missing arm and a reviewer has one file to read. Second, since 2026-10-22, by
// VALUE: `VERDICT_REGISTRY` says which token each verdict owns (allow →
// --decision-allow, step-up → --decision-review, restrict and deny →
// --decision-deny, shared by design, DR-005/006) and the gate checks chart-mark
// tokens, the tone Records' status classes and every stylesheet's
// `.text-/.bg-status-*` rule against it. A total Record with the wrong colours in
// it no longer passes.
//
// WHAT IT STILL CANNOT DO, said plainly (the run prints the same list): it cannot
// tell restrict from deny by token (they share one), it does not judge a badge
// Record outside the tone modules, and it does not decide what a verdict
// "deserves" beyond the registry — whoever edits the registry decides that, and
// the edit is one reviewable line. Option (b) of row 168, distinct rendered
// values, is still open.

import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Web trees that render a decision. */
const TREES = [
  "artifacts/signalgrid-desktop/src",
  "artifacts/signalgrid-mobile-pwa/src",
  "artifacts/signalgrid-review/src",
  "artifacts/signalgrid-web/src",
];

/**
 * The tone modules themselves. These are the total `Record`s this gate exists to
 * push everything toward, so they are the one place a verdict name may sit
 * beside a status class. Named individually — never a directory — so a new file
 * cannot join the exemption by being dropped next to one.
 */
//
// EXERCISED OR NOT, IT IS PRINTED. Today the tone module's total `Record` does
// not match the pattern at all — a `Record` literal has no `===` in it — so this
// exemption grants nothing on the current tree. It stays because the shape it
// anticipates is legitimate (a helper that branches on a verdict to pick a tone),
// and it is REPORTED on every run rather than sitting silent, so nobody mistakes
// an unused allowlist for a used one.
/**
 * ...and the verdict Records each MUST declare (the registry's floor): a module
 * that loses one fails, rather than being judged over a smaller set.
 */
const TONE_EXPECTED = {
  "artifacts/signalgrid-desktop/src/lib/outcome-tone.ts": ["OUTCOME_TONE"],
  "artifacts/signalgrid-mobile-pwa/src/lib/outcome-tone.ts": ["OUTCOME_BADGE_TONE"],
  "artifacts/signalgrid-review/src/lib/outcome-tone.ts": ["VERDICT_BADGE_TONE", "VERDICT_TEXT_TONE"],
};
const TONE_MODULES = new Set(Object.keys(TONE_EXPECTED));

// ── The second half, added 2026-09-05 (sixth audit round) ───────────────────
//
// The comparison rule above catches a verdict choosing its colour INLINE. It
// did not catch the two shapes the audit found on the edge of the estate:
//
//   * a LOCAL MAP — `const OUTCOME_COLOR: Record<string,string> = { allow: …,
//     deny: … }` in a page, looked up with `?? "text-muted-foreground"`. A
//     total Record is the target shape, but a second one in a page is a second
//     opinion, and this one's fallback was NEUTRAL: `step_up`, `escalate` or
//     an empty verdict rendered in the same grey as a timestamp.
//   * a NEUTRAL SEED — `let colors = "text-zinc-500 …"` before an if/else
//     chain over the four verdicts (the PWA badge). Same defect, different
//     spelling; `check-decision-palette.mjs` cannot see either, because its
//     ramp regex names red/amber/green and not zinc, and `text-muted-
//     foreground` is a ratified token.
//
// The doctrine was already written in outcome-tone.ts: "an unrecognised
// verdict resolves to the RESTRICTIVE tone, never to a neutral one". It had
// reached three of five sites. So: (1) a verdict→class map may live only in a
// tone module; (2) inside a tone module every `??` fallback must be a
// restrictive token. The direction of the fallback is the whole point — a gate
// that only asked "is it centralised" would have passed a centralised grey.

/**
 * Two verdict keys, each paired with a colour, inside one object literal. A
 * colour is a status class OR a raw colour value (`hsl(`, `var(--`, `#hex`,
 * `rgb(`): brain re-review of PR #1243 showed `const SERIES_FILL = { restrict:
 * "hsl(var(--chart-4))", deny: "hsl(var(--destructive))" }` feeding `fill=`
 * passing, which is row 107 again under a new name.
 */
// `stepUp` (the series-API spelling) is a verdict key only beside a RAW colour:
// as a class key it would reach the review tree's CredentialReaderDashboardSection
// map (`stepUp`/`restrict` over its own decision vocabulary), a pre-existing
// finding named in PR #1243 for its own change rather than widened into this one.
const VERDICT_KEY = String.raw`(?:(?:allow|deny|restrict|"step-up"|'step-up')\s*:\s*["'\`][^"'\`]*(?:text-|bg-|border-|hsl\(|var\(--|rgba?\(|#[0-9a-fA-F]{3,8}\b)|stepUp\s*:\s*["'\`][^"'\`]*(?:hsl\(|var\(--|rgba?\(|#[0-9a-fA-F]{3,8}\b))`;
const LOCAL_MAP = new RegExp(VERDICT_KEY + String.raw`[^;]{0,240}?` + VERDICT_KEY);
const VERDICT_KEY_LINE = new RegExp(VERDICT_KEY);
const MAP_LOOKAHEAD = 6;

/** Lines that begin a local verdict→class map (coalesced: one map, one finding). */
export function localMapLines(src) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!VERDICT_KEY_LINE.test(lines[i])) continue;
    const window = lines.slice(i, i + MAP_LOOKAHEAD).join(" ").replace(/\s+/g, " ");
    if (!LOCAL_MAP.test(window)) continue;
    if (hits.length > 0 && i + 1 - hits[hits.length - 1] <= MAP_LOOKAHEAD) continue;
    hits.push(i + 1);
  }
  return hits;
}

/** The direction rule: every `??` fallback in a tone module must be restrictive. */
const FALLBACK = /\?\?\s*["']([^"']*)["']/g;
const RESTRICTIVE = /status-(?:restrict|deny)/;
export function fallbackProblems(src) {
  const out = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    // A fallback QUOTED in a comment (the module explaining the defect it
    // replaced) is prose, not a decision. Only code lines are judged.
    if (/^\s*(?:\/\/|\/\*|\*)/.test(lines[i])) continue;
    for (const m of lines[i].matchAll(FALLBACK)) {
      if (!RESTRICTIVE.test(m[1])) out.push({ line: i + 1, fallback: m[1] });
    }
  }
  return out;
}

/**
 * A verdict comparison followed, inside the same expression, by a status class.
 *
 * Whitespace is collapsed before matching because the shape being caught is a
 * multi-line JSX ternary — the real one in `Dashboard.tsx` spanned three lines,
 * and a per-line scan would have seen a comparison and a class and never
 * connected them.
 *
 * `[^;{}]` bounds the reach: the two halves must live in one expression, not
 * merely in one file. Without the bound, any component that compares a verdict
 * anywhere and uses a status class anywhere would trip.
 */

/**
 * How far past a verdict comparison a status class may sit and still count as
 * the same expression. Four lines covers the widest real instance — a chained
 * ternary over the four-verdict union — without bridging two components.
 */
const LOOKAHEAD = 4;

/** A verdict being compared to a literal. This is what anchors a finding to a LINE. */
const COMPARISON = /\b(?:outcome|verdict|decision)\s*===\s*["'][a-z_-]+["']/i;

/**
 * ...and the colour that must not be chosen right there. `[^;{}]` bounds the
 * reach so the two halves live in ONE expression rather than merely in one file;
 * without it, any component that compares a verdict anywhere and uses a status
 * class anywhere would trip.
 */
const TONE_AFTER = /\b(?:outcome|verdict|decision)\s*===\s*["'][a-z_-]+["'][^;{}]{0,240}?(?:text|bg|border)-status-/i;

/**
 * Report the line the COMPARISON is on.
 *
 * An earlier version scanned sliding windows and reported the window's first
 * line, which pointed a reviewer at whatever innocent markup happened to sit
 * four lines above the defect — in the real Dashboard case, a `<div>`. A finding
 * that names the wrong line is worse than a vague one, because it gets checked,
 * found blameless, and disbelieved. Anchor on the comparison instead, then
 * coalesce: a chained ternary has one comparison per arm, and those are one
 * defect, not three.
 */
export function offendingLines(src) {
  const lines = src.split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (!COMPARISON.test(lines[i])) continue;
    const window = lines.slice(i, i + LOOKAHEAD).join(" ").replace(/\s+/g, " ");
    if (!TONE_AFTER.test(window)) continue;
    if (hits.length > 0 && i + 1 - hits[hits.length - 1] <= LOOKAHEAD) continue;
    hits.push(i + 1);
  }
  return hits;
}

// ── The third half, added 2026-09-30 (backlog row 107) ──────────────────────
//
// A CHART is a verdict→colour decision too, and the first two halves could not
// see one: the PWA's Overview painted `<Bar dataKey="restrict" fill=
// "hsl(var(--chart-4))">` and `<Bar dataKey="deny" fill="hsl(var(--destructive))">`
// — no `===`, no status class, so no finding — and both tokens resolve to
// #C67070. Restrict and deny rendered as one band with a 1.0000:1 boundary and no
// legend or tooltip. So, in any tree whose tone module declares a chart map:
//   (1) the MODULE is imported and what it PAINTS is judged, not what it
//       declares (brain review, PR #1243: a regex over `pattern:` strings passed
//       a `chartFill` that ignored them). `chartFill(restrict)` must differ from
//       `chartFill(deny)`; a solid fill must be its verdict's ratified
//       `--decision-*` token; a hatched fill must reference the hatch pattern;
//       the hatch stripe must be narrower than its tile; each verdict must read
//       its own series key; restrict and deny must differ in pattern.
//   (2) every CHART SITE (any file importing from recharts, aliases resolved,
//       comments stripped): no series or Cell element may key on a verdict
//       literal in any spelling or carry a literal colour; a `<pattern>` may not
//       hardcode its geometry; the chart must render a Legend and a Tooltip and
//       read its marks from OUTCOME_CHART_MARK.
// The desktop tree has no chart map yet (its Dashboard carries literal fills
// with a dash pattern of its own), so (2) does not reach it; that is printed on
// every run rather than implied.

/** Tone modules that MUST carry a chart map — removing it is a failure, not an opt-out. */
const CHART_MAP_REQUIRED = new Set(["artifacts/signalgrid-mobile-pwa/src/lib/outcome-tone.ts"]);
const CHART_VERDICTS = ["allow", "step-up", "restrict", "deny"];
/** The decision-series API's count key for each verdict. */
const SERIES_KEY = { allow: "allow", "step-up": "stepUp", restrict: "restrict", deny: "deny" };

// ── The fourth half, added 2026-10-22 (backlog row 168, option (c)) ─────────
//
// The three halves above ask WHERE a verdict's colour is decided. None asked
// whether the answer is RIGHT: a chart token only had to be a member of the
// ratified set, and a tone Record was exempt from every rule but the `??`
// direction. Swapping allow and deny in `OUTCOME_TONE`, or the two `token:`
// values in `OUTCOME_CHART_MARK`, exited 0. ONE registry now says which token
// and which status-class suffix each verdict owns, and it is applied three ways:
//   (1) chart marks: a verdict's `token` EQUALS its registry token;
//   (2) tone Records: every `Record<…Outcome…, string>` literal in a tone module —
//       a verdict key's status-X class is its OWN suffix, and a four-verdict
//       total carries all four, pairwise distinct;
//   (3) CSS: each tree's .text-status-X / .bg-status-X rule resolves to the
//       registry token for X.
// Restrict and deny share --decision-deny by design (DR-005/006); they are told
// apart by class suffix and, in a chart, by pattern, never by token.
// A verdict's status-class suffix IS its key here (`status-step-up` for "step-up"),
// so the registry carries only the token each verdict must resolve to.
export const VERDICT_REGISTRY = {
  allow: { token: "--decision-allow" },
  "step-up": { token: "--decision-review" },
  restrict: { token: "--decision-deny" },
  deny: { token: "--decision-deny" },
};
const VERDICTS = Object.keys(VERDICT_REGISTRY);
/** Every spelling of a verdict key in a Record literal → the registry's verdict. */
const KEY_VERDICT = { allow: "allow", "step-up": "step-up", step_up: "step-up", stepUp: "step-up", restrict: "restrict", deny: "deny" };

/**
 * Problems in an imported tone module's chart exports; null when it has none.
 * `mod` is the module namespace (or a stand-in object in the self-test).
 */
export function chartModuleProblems(mod) {
  if (!mod || !mod.OUTCOME_CHART_MARK) return null;
  const out = [];
  const { OUTCOME_CHART_MARK: marks, chartFill, hatchPatternId, HATCH_PATTERN } = mod;
  if (typeof chartFill !== "function") return ["no chartFill export — the paint is decided somewhere unjudged"];
  const fills = {};
  for (const v of CHART_VERDICTS) {
    const mk = marks[v];
    if (!mk) { out.push(`${v} has no chart mark`); continue; }
    if (mk.dataKey !== SERIES_KEY[v]) out.push(`${v} reads series key "${mk.dataKey}", not "${SERIES_KEY[v]}"`);
    if (mk.token !== VERDICT_REGISTRY[v].token) out.push(`${v} fills from ${mk.token}, not its ratified ${VERDICT_REGISTRY[v].token}`);
    let fill;
    try { fill = chartFill(v); } catch (e) { out.push(`chartFill(${v}) threw: ${e.message}`); continue; }
    fills[v] = fill;
    if (mk.pattern === "solid" && fill !== `hsl(var(${mk.token}))`) out.push(`${v} is declared solid ${mk.token} but paints ${fill}`);
    if (mk.pattern === "hatch") {
      const id = typeof hatchPatternId === "function" ? hatchPatternId(v) : null;
      if (!id || fill !== `url(#${id})`) out.push(`${v} is declared hatched but paints ${fill}`);
    }
    if (mk.pattern !== "solid" && mk.pattern !== "hatch") out.push(`${v} has unknown pattern "${mk.pattern}"`);
  }
  const r = marks.restrict, d = marks.deny;
  if (r && d && r.pattern === d.pattern) out.push("restrict and deny share a pattern — they must differ by more than colour");
  if (fills.restrict !== undefined && fills.restrict === fills.deny) out.push(`chartFill(restrict) === chartFill(deny) (${fills.restrict}) — the same pixel`);
  for (let i = 0; i < CHART_VERDICTS.length; i++) {
    for (let j = i + 1; j < CHART_VERDICTS.length; j++) {
      const a = fills[CHART_VERDICTS[i]], b = fills[CHART_VERDICTS[j]];
      if (a !== undefined && a === b && !(CHART_VERDICTS[i] === "restrict" && CHART_VERDICTS[j] === "deny")) {
        out.push(`${CHART_VERDICTS[i]} and ${CHART_VERDICTS[j]} paint the same fill (${a})`);
      }
    }
  }
  if (Object.values(marks).some((m) => m && m.pattern === "hatch")) {
    const h = HATCH_PATTERN;
    if (!h || !(h.stripeWidth > 0 && h.stripeWidth < h.size)) {
      out.push(`hatch stripe ${h?.stripeWidth} is not narrower than its tile ${h?.size} — a solid block, not a hatch`);
    }
  }
  return out;
}

/** Remove block, JSX and line comments, keeping line count. `://` in a URL is not a comment. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

const SERIES = new Set(["Bar", "Area", "Line", "Pie", "Cell", "RadialBar", "Scatter", "Radar", "Funnel"]);

/** recharts import aliases: local name → recharts name ("R.*" for a namespace). */
export function rechartsAliases(code) {
  const map = new Map();
  for (const m of code.matchAll(/import\s+([^;"'`]*?)\s+from\s*["']recharts["']/g)) {
    const ns = m[1].match(/\*\s*as\s+(\w+)/);
    if (ns) map.set(`${ns[1]}.`, "*");
    const named = m[1].match(/\{([^}]*)\}/);
    if (!named) continue;
    for (const part of named[1].split(",")) {
      const [orig, local] = part.trim().split(/\s+as\s+/);
      if (orig) map.set(local || orig, orig);
    }
  }
  return map;
}

/**
 * Escape EVERY regex metacharacter, backslash included. Tag names come from the
 * scanned file's own import clause, so they are input, not trusted literals
 * (CodeQL js/incomplete-sanitization on PR #1243: the first version escaped
 * only `.` and `$`).
 */
export function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
}

/** Every opening tag `<Name …>` / `<Name … />` with its attribute text, scanned brace- and quote-aware. */
function tags(code, localName) {
  const out = [];
  const esc = escapeRegExp(localName);
  const re = new RegExp(`<${esc}(?=[\\s/>])`, "g");
  for (const m of code.matchAll(re)) {
    let i = m.index + m[0].length, depth = 0, q = null;
    for (; i < code.length; i++) {
      const c = code[i];
      if (q) { if (c === q && code[i - 1] !== "\\") q = null; continue; }
      if (c === '"' || c === "'" || c === "`") q = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ attrs: code.slice(m.index + m[0].length, i), line: code.slice(0, m.index).split("\n").length });
  }
  return out;
}

const VERDICT_SERIES_KEY = /\bdataKey\s*=\s*\{?\s*["'`](?:allow|stepUp|step-up|restrict|deny)["'`]\s*\}?/;
/** An accessor dataKey that reads a verdict field: `dataKey={(r) => r.deny}` or `r["deny"]`. */
const VERDICT_ACCESSOR = /\bdataKey\s*=\s*\{[^}]*=>[^}]*(?:\.\s*(?:allow|stepUp|restrict|deny)\b|\[\s*["'`](?:allow|stepUp|step-up|restrict|deny)["'`]\s*\])/;
/** A paint helper called with a verdict LITERAL decides one series' colour by hand. */
const LITERAL_VERDICT_PAINT = /\b(?:chartFill|hatchPatternId)\s*\(\s*["'`](?:allow|step-up|restrict|deny)["'`]/;
const LITERAL_COLOUR = /\b(?:fill|stroke|color)\s*=\s*\{?\s*["'`][^"'`]*(?:--decision-|--destructive|--chart-|#[0-9a-fA-F]{3,8}\b|rgb|\b(?:red|green|amber|orange|yellow)\b)/;

/** Problems at a chart site in a tree whose tone module declares a chart map. */
export function chartSiteProblems(src) {
  const code = stripComments(src);
  const aliases = rechartsAliases(code);
  if (aliases.size === 0) return [];
  const out = [];
  const localsOf = (name) => {
    const l = [];
    for (const [local, orig] of aliases) {
      if (orig === name) l.push(local);
      if (orig === "*") l.push(`${local}${name}`);
    }
    return l;
  };
  for (const name of SERIES) {
    for (const local of localsOf(name)) {
      for (const t of tags(code, local)) {
        if (VERDICT_SERIES_KEY.test(t.attrs)) out.push(`line ${t.line}: a <${name}> keyed on a verdict literal`);
        if (VERDICT_ACCESSOR.test(t.attrs)) out.push(`line ${t.line}: a <${name}> keyed on a verdict through an accessor`);
        if (LITERAL_VERDICT_PAINT.test(t.attrs)) out.push(`line ${t.line}: a <${name}> painted for a verdict named by hand`);
        if (LITERAL_COLOUR.test(t.attrs)) out.push(`line ${t.line}: a <${name}> carries a literal colour`);
      }
    }
  }
  for (const t of tags(code, "pattern")) {
    if (/\b(?:width|height)\s*=\s*\{?\s*["'`]?\d/.test(t.attrs)) out.push(`line ${t.line}: a <pattern> hardcodes its geometry — read HATCH_PATTERN`);
  }
  for (const t of tags(code, "rect").filter(() => /<pattern\b/.test(code))) {
    if (/\bwidth\s*=\s*\{?\s*["'`]?\d/.test(t.attrs) && /<pattern\b[\s\S]*?<\/pattern>/.test(code)) {
      const inside = [...code.matchAll(/<pattern\b[\s\S]*?<\/pattern>/g)].some((p) => {
        const start = code.slice(0, p.index).split("\n").length;
        const end = start + p[0].split("\n").length - 1;
        return t.line >= start && t.line <= end;
      });
      if (inside) out.push(`line ${t.line}: a hatch <rect> hardcodes its width — read HATCH_PATTERN`);
    }
  }
  const used = (name) => localsOf(name).some((l) => tags(code, l).length > 0);
  if (!used("Legend")) out.push("chart renders no <Legend>");
  if (!used("Tooltip")) out.push("chart renders no <Tooltip>");
  if (!/\bOUTCOME_CHART_MARK\b/.test(code)) out.push("chart does not read its marks from OUTCOME_CHART_MARK");
  return out;
}

/** Source text of the `{…}` opening at `open`, quote-aware; null when it never closes. */
function braceBody(code, open) {
  let depth = 0, q = null;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { text: code.slice(open + 1, i), start: open + 1 };
  }
  return null;
}

/** Split an object literal's body at its top-level commas: `{ text, start }` per entry, comments already stripped. */
function splitTopLevel(body) {
  const out = [];
  let depth = 0, q = null, from = 0;
  const push = (end) => {
    const raw = body.slice(from, end);
    const text = raw.trim();
    if (text) out.push({ text, start: from + raw.indexOf(text) });
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === "," && depth === 0) { push(i); from = i + 1; }
  }
  push(body.length);
  return out;
}

const STRING_LITERAL = /^(["'`])((?:\\.|(?!\1)[^\\])*)\1$/;
const ENTRY = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*)|\[[^\]]*\])\s*(?::\s*([\s\S]*))?$/;

/** The object literals a tone module declares as verdict Records: expected names, plus any `Record<…Outcome…, string>`. */
function recordLiterals(code, expected) {
  const found = new Map();
  const add = (open, name) => { if (!found.has(open)) found.set(open, name); };
  for (const m of code.matchAll(/\bRecord<\s*([^,<>]*Outcome[^,<>]*),\s*string\s*>+\s*=\s*(?:Object\.freeze\(\s*)?\{/g)) {
    add(m.index + m[0].length - 1, (code.slice(0, m.index).match(/(\w+)\s*:\s*(?:Readonly<\s*)?$/) ?? [])[1] ?? "Record");
  }
  for (const name of expected) {
    for (const m of code.matchAll(new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\b[^=;]*=\\s*(?:Object\\.freeze\\(\\s*)?\\{`, "g"))) add(m.index + m[0].length - 1, name);
  }
  return found;
}

/**
 * Judge the verdict Records in a tone module against the registry.
 *   `expected` — Record names the module MUST declare as judged four-verdict
 *   literals (a floor: deleting, renaming or re-typing one is a failure, never a
 *   smaller count);
 * returns `{ records, entries, problems }` — `entries` counts verdict-keyed
 * entries actually judged, so a spread-only Record contributes nothing.
 * An entry under a verdict key whose value is not a plain string literal cannot be
 * judged and is a problem (golden rule 2: unreadable input never loosens), as is a
 * spread whose target is not another judged Record of the same module.
 */
export function toneRecordProblems(src, expected = []) {
  const code = stripComments(src);
  const problems = [];
  const lineAt = (i) => code.slice(0, i).split("\n").length;
  const literals = recordLiterals(code, expected);
  const judgedNames = new Set(literals.values());
  const totals = new Set();
  let entries = 0;
  for (const [open, name] of literals) {
    const body = braceBody(code, open);
    if (body === null) { problems.push(`line ${lineAt(open)}: ${name} is not closed — cannot be judged`); continue; }
    const classes = {};
    for (const seg of splitTopLevel(body.text)) {
      const at = `line ${lineAt(body.start + seg.start)}: ${name}`;
      if (seg.text.startsWith("...")) {
        const target = seg.text.slice(3).trim();
        if (!judgedNames.has(target)) problems.push(`${at} spreads ${target}, which is not a judged Record of this module — its verdict entries cannot be judged`);
        continue;
      }
      const m = ENTRY.exec(seg.text);
      if (!m) { problems.push(`${at} has an entry that cannot be parsed: ${seg.text.slice(0, 40)}`); continue; }
      const key = m[1] ?? m[2] ?? m[3];
      if (key === undefined) { problems.push(`${at} has a computed key — it cannot be judged`); continue; }
      const verdict = KEY_VERDICT[key];
      if (!verdict) continue;
      const lit = m[4] === undefined ? null : STRING_LITERAL.exec(m[4].trim());
      if (!lit || (lit[1] === "`" && lit[2].includes("${"))) {
        problems.push(`${at}.${key} is not a string literal and cannot be judged`);
        continue;
      }
      entries++;
      const suffixes = [...lit[2].matchAll(/\b(?:text|bg|border)-status-([a-z-]+)/g)].map((x) => x[1]);
      for (const sfx of suffixes) {
        if (sfx !== verdict) problems.push(`${at}.${key} wears status-${sfx}, its own class is status-${verdict}`);
      }
      classes[verdict] = suffixes.length > 0 ? suffixes.join("+") : null;
    }
    if (VERDICTS.every((v) => v in classes)) {
      for (const v of VERDICTS) {
        if (classes[v] === null) problems.push(`line ${lineAt(open)}: ${name} is a four-verdict total but ${v} carries no status class`);
      }
      const seen = new Map();
      for (const v of VERDICTS) {
        if (classes[v] === null) continue;
        if (seen.has(classes[v])) problems.push(`line ${lineAt(open)}: ${name} gives ${seen.get(classes[v])} and ${v} the same class (${classes[v]})`);
        else seen.set(classes[v], v);
      }
      if (VERDICTS.every((v) => classes[v] !== null)) totals.add(name);
    }
  }
  for (const name of expected) {
    if (!totals.has(name)) problems.push(`expected ${name} is not declared as a judged four-verdict literal (missing, renamed, partial or unreadable)`);
  }
  return { records: literals.size, entries, problems };
}

/**
 * Judge a stylesheet: each `.text-status-X` / `.bg-status-X` rule must resolve to
 * the registry token for X, reading the LAST declaration of each colour property
 * (CSS applies the last); a `.bg-status-X` also judges its text colour and its
 * `border-color`. A selector that names a verdict status class in any shape other
 * than the single canonical class (a selector list, a pseudo or `:where()`
 * override, a Tailwind `@utility`) cannot be judged and is a problem, not a skip.
 * `found` is the set of canonical `kind:verdict` rules, for the caller's floor.
 */
export function cssToneProblems(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
  const problems = [];
  const found = new Set();
  let rules = 0;
  const lineOf = (i) => code.slice(0, i).split("\n").length;
  const last = (body, prop) => [...body.matchAll(new RegExp(`(?<![\\w-])${prop}\\s*:\\s*([^;]*)`, "g"))].at(-1)?.[1];
  const tokenOf = (decl) => decl?.match(/var\(\s*(--decision-(?:allow|review|deny))(?:-on-tint)?\s*[,)]/)?.[1];
  for (const m of code.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!/\b(?:text|bg|border)-status-(?:allow|step-up|restrict|deny)\b/.test(selector)) continue;
    const line = lineOf(m.index + m[0].indexOf(selector));
    const canon = /^\.(text|bg)-status-(allow|step-up|restrict|deny)$/.exec(selector);
    if (!canon) { problems.push(`line ${line}: selector "${selector.replace(/\s+/g, " ").slice(0, 60)}" names a verdict status class outside the canonical single-class shape — it cannot be judged`); continue; }
    const [, kind, verdict] = canon;
    rules++;
    found.add(`${kind}:${verdict}`);
    const want = VERDICT_REGISTRY[verdict].token;
    const at = `line ${line}: .${kind}-status-${verdict}`;
    const checks = kind === "text"
      ? [["color", last(m[2], "color"), true]]
      : [["background-color", last(m[2], "background-color"), true], ["color", last(m[2], "color"), true], ["border-color", last(m[2], "border-color"), false]];
    for (const [prop, decl, required] of checks) {
      const got = tokenOf(decl);
      if (decl === undefined && !required) continue;
      if (!got) problems.push(`${at} ${prop} resolves to no --decision-* token`);
      else if (got !== want) problems.push(`${at} ${prop} paints ${got}, its registry token is ${want}`);
    }
  }
  return { rules, found, problems };
}

/**
 * The files under `dir` matching `re`, plus every directory read that failed for a
 * reason other than ENOENT. A tree absent from this checkout is not a pass or a
 * fail; a tree that exists but cannot be read is neither, and is reported.
 */
function walk(dir, re = /\.tsx?$/, out = [], errs = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch (e) {
    if (e.code !== "ENOENT") errs.push(`${dir}: ${e.code ?? e.message}`);
    return { files: out, errs };
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, re, out, errs);
    else if (re.test(full)) out.push(full);
  }
  return { files: out, errs };
}

async function selfTest() {
  const checks = [];

  // The real defect, byte-for-byte as it stood in Dashboard.tsx.
  const real = `<span className={\`text-xs font-mono \${
                  d.outcome === "allow" ? "text-status-allow" :
                  d.outcome === "deny" ? "text-status-deny" :
                  d.outcome === "step-up" ? "text-status-step-up" : "text-status-restrict"
                }\`}>`;
  // ONE finding, not one per comparison inside it. This assertion is the reason
  // the coalescing exists: the raw scan reported this single defect twice.
  checks.push(["the real multi-line ternary is caught, ONCE", offendingLines(real).length === 1]);

  // ...and the positive control for the coalescing: two genuinely separate
  // offences, far enough apart to be distinct, must still both be reported.
  const twoOffences = real + "\n" + "// filler\n".repeat(10) + `const c = verdict === "deny" ? "bg-status-deny" : "bg-status-allow";`;
  checks.push(["two SEPARATE offences are still two findings", offendingLines(twoOffences).length === 2]);

  // LINE ACCURACY, pinned. The earlier window-scanning version reported the line
  // four above the defect. Here the offence sits on line 3 of the fixture and
  // must be reported as 3, not as the line the surrounding markup starts on.
  const anchored = `<div className="wrapper">\n  <span className={\`base \${\n    outcome === "deny" ? "text-status-deny" : "text-status-allow"\n  }\`}>x</span>\n</div>`;
  checks.push(["a finding names the COMPARISON's line, not the enclosing markup's", JSON.stringify(offendingLines(anchored)) === "[3]"]);
  checks.push(["a single-line version is caught too", offendingLines(`const c = outcome === "deny" ? "text-status-deny" : "text-status-allow";`).length === 1]);

  // Positive controls. Each of these is a shape the gate must NOT flag, and each
  // exists because flagging it would make the gate unusable rather than strict.
  checks.push(["a total Record is the target shape, not a finding", offendingLines(`const OUTCOME_TONE: Record<Outcome, string> = { allow: "text-status-allow", deny: "text-status-deny" };`).length === 0]);
  checks.push(["a verdict comparison with no colour in it is fine", offendingLines(`if (outcome === "deny") { audit.record(outcome); }`).length === 0]);
  checks.push(["a status class with no verdict comparison is fine", offendingLines(`<span className="text-status-allow">ok</span>`).length === 0]);
  checks.push(["the call through the helper is the fix, not a finding", offendingLines("<span className={outcomeTone(d.outcome)}>x</span>").length === 0]);

  // The expression bound: a comparison and a class far apart in one file are not
  // one expression, and treating them as one would flag every real component.
  const farApart = `if (outcome === "deny") { record(); }\n` + "// filler\n".repeat(8) + `<span className="text-status-allow" />`;
  checks.push(["a comparison and a class in DIFFERENT statements are not a finding", offendingLines(farApart).length === 0]);

  // The second half (2026-09-05): a LOCAL map and a NEUTRAL fallback, byte-for-byte
  // as they stood in desktop/pages/Decisions.tsx and pwa/components/OutcomeBadge.tsx.
  const localMap = `const OUTCOME_COLOR: Record<string, string> = {\n  allow: "text-status-allow", deny: "text-status-deny",\n  "step-up": "text-status-step-up", restrict: "text-status-restrict",\n};`;
  checks.push(["a local verdict→class map is caught, ONCE, on its first key's line", JSON.stringify(localMapLines(localMap)) === "[2]"]);
  checks.push(["a local map of raw hsl() fills is caught (the row-107 shape renamed)", localMapLines(`const SERIES_FILL = { restrict: "hsl(var(--chart-4))", deny: "hsl(var(--destructive))" };`).length === 1]);
  checks.push(["a local map of var(--) tokens is caught", localMapLines(`const F = {\n  allow: "var(--decision-allow)",\n  deny: "var(--decision-deny)",\n};`).length === 1]);
  checks.push(["a local map of hex fills is caught", localMapLines(`const F = { stepUp: "#B08B57", deny: "#C67070" };`).length === 1]);
  checks.push(["a verdict map of non-colour strings is not a colour map", localMapLines(`const L = { allow: "Allow", deny: "Deny" };`).length === 0]);
  checks.push(["a map with ONE verdict key is not a verdict map", localMapLines(`const M = { allow: "text-status-allow", other: 1 };`).length === 0]);
  checks.push(["a verdict key with no colour beside it is not a map", localMapLines(`const N = { allow: 3, deny: 4 };`).length === 0]);
  checks.push(["the neutral fallback is caught", fallbackProblems(`return OUTCOME_TONE[o as Outcome] ?? "text-muted-foreground";`).length === 1]);
  checks.push(["a restrictive fallback is the fix, not a finding", fallbackProblems(`return OUTCOME_TONE[o as Outcome] ?? "text-status-restrict";`).length === 0]);
  checks.push(["a deny fallback is restrictive too", fallbackProblems(`x ?? "bg-status-deny"`).length === 0]);
  checks.push(["a `??` with no string (a variable) is not judged here", fallbackProblems(`x ?? fallbackTone`).length === 0]);
  checks.push(["a neutral fallback QUOTED in a comment is prose, not a finding", fallbackProblems(` * looked up with \`?? "text-stone-300"\` before the fix\n// and \`?? "text-muted-foreground"\` too`).length === 0]);
  // The third half (2026-09-30): the chart, byte-for-byte as Overview.tsx stood.
  const rc = `import { ResponsiveContainer, BarChart, Bar, Legend, Tooltip } from "recharts";\n`;
  const oldChart = `import { ResponsiveContainer, BarChart, Bar } from "recharts";\n<BarChart data={series.series}>\n  <Bar dataKey="allow" stackId="a" fill="hsl(var(--chart-2))" />\n  <Bar dataKey="restrict" stackId="a" fill="hsl(var(--chart-4))" />\n  <Bar dataKey="deny" stackId="a" fill="hsl(var(--destructive))" />\n</BarChart>`;
  checks.push(["the real inline-filled verdict chart is caught (3 keys, 3 colours, no legend/tooltip/map)", chartSiteProblems(oldChart).length === 9]);
  const fixedChart = rc + `import { OUTCOME_CHART_MARK } from "x";\n<BarChart><Tooltip /><Legend />{OUTCOME_ORDER.map(o => <Bar dataKey={OUTCOME_CHART_MARK[o].dataKey} fill={chartFill(o)} stroke="hsl(var(--card))" />)}</BarChart>`;
  checks.push(["a chart reading OUTCOME_CHART_MARK with Legend + Tooltip is the fix", chartSiteProblems(fixedChart).length === 0]);
  checks.push(["a chart with no Legend is caught even when routed", chartSiteProblems(fixedChart.replace("<Legend />", "")).length === 1]);
  checks.push(["a <Legend> only inside a JSX comment is not a legend", chartSiteProblems(fixedChart.replace("<Legend />", "{/* <Legend /> */}")).length === 1]);
  checks.push(["recharts names are resolved when OTHER imports come first", chartSiteProblems(`import React, { useState } from "react";\n` + fixedChart).length === 0]);
  checks.push(["a file importing nothing from recharts is not judged", chartSiteProblems(`<Bar dataKey="deny" />`).length === 0]);
  // Holes from the brain review of PR #1243, each pinned.
  checks.push(["dataKey on the line AFTER <Bar is caught", chartSiteProblems(fixedChart + `\n<Bar\n  dataKey="deny"\n/>`).length === 1]);
  checks.push(['dataKey={"deny"} is caught', chartSiteProblems(fixedChart + `\n<Bar dataKey={"deny"} />`).length === 1]);
  checks.push(["a template-string verdict key is caught", chartSiteProblems(fixedChart + "\n<Bar dataKey={`restrict`} />").length === 1]);
  checks.push(["an aliased `Bar as B` is caught", chartSiteProblems(fixedChart.replace("Bar, Legend", "Bar as B, Legend") + `\n<B dataKey="deny" fill="hsl(var(--destructive))" />`).length === 2]);
  checks.push(["a namespace `* as R` recharts import is caught", chartSiteProblems(`import * as R from "recharts";\nimport { OUTCOME_CHART_MARK } from "x";\n<R.BarChart><R.Tooltip /><R.Legend /><R.Bar dataKey="deny" /></R.BarChart>`).length === 1]);
  checks.push(["a verdict PieChart with literal-coloured Cells is caught", chartSiteProblems(rc.replace("Bar,", "Pie, Cell, Bar,") + `import { OUTCOME_CHART_MARK } from "x";\n<Tooltip /><Legend /><Pie dataKey="value"><Cell fill="hsl(var(--decision-deny))" /><Cell fill="#C67070" /></Pie>`).length === 2]);
  checks.push(["an accessor dataKey reading a verdict field is caught", chartSiteProblems(fixedChart + `\n<Bar dataKey={(r) => r.deny} />`).length === 1]);
  checks.push(["an accessor with bracket access is caught", chartSiteProblems(fixedChart + `\n<Bar dataKey={(r) => r["restrict"]} />`).length === 1]);
  checks.push(['chartFill("restrict") named by hand is caught', chartSiteProblems(fixedChart + `\n<Bar dataKey={(r) => r.deny} fill={chartFill("restrict")} />`).length === 2]);
  checks.push(["chartFill(o) over the verdict loop is the fix", chartSiteProblems(fixedChart).length === 0]);
  const literalEscapes = [..."\\^$.*+?()[]{}|/-"].every((c) => {
    try {
      const re = new RegExp(`^x${escapeRegExp(c)}y$`);
      return re.test(`x${c}y`) && !re.test("xZy") && !re.test("xy");
    } catch {
      return false; // an escape that leaves an invalid pattern is not an escape
    }
  });
  checks.push(["escapeRegExp makes EVERY metacharacter literal, backslash included", literalEscapes]);
  checks.push(["an arrow function in an attribute does not end the tag early", chartSiteProblems(fixedChart + `\n<Bar label={(p) => p > 1} dataKey="deny" />`).length === 1]);
  checks.push(["a hardcoded 4-wide hatch stripe is caught", chartSiteProblems(fixedChart + `\n<pattern id={x} width={HATCH_PATTERN.size}>\n<rect width="4" height="4" />\n</pattern>`).length === 1]);
  checks.push(["a hatch reading HATCH_PATTERN is the fix", chartSiteProblems(fixedChart + `\n<pattern id={x} width={HATCH_PATTERN.size}>\n<rect width={HATCH_PATTERN.stripeWidth} />\n</pattern>`).length === 0]);
  // The module half: judged by what it PAINTS.
  const mkMod = (over = {}) => {
    const marks = {
      allow: { dataKey: "allow", token: "--decision-allow", pattern: "solid" },
      "step-up": { dataKey: "stepUp", token: "--decision-review", pattern: "solid" },
      restrict: { dataKey: "restrict", token: "--decision-deny", pattern: "hatch" },
      deny: { dataKey: "deny", token: "--decision-deny", pattern: "solid" },
      ...(over.marks ?? {}),
    };
    const hatchPatternId = (o) => `h-${o}`;
    const chartFill = over.chartFill ?? ((o) => (marks[o].pattern === "hatch" ? `url(#${hatchPatternId(o)})` : `hsl(var(${marks[o].token}))`));
    return { OUTCOME_CHART_MARK: marks, chartFill, hatchPatternId, HATCH_PATTERN: over.hatch ?? { size: 4, stripeWidth: 2 } };
  };
  checks.push(["a sound chart module passes", chartModuleProblems(mkMod()).length === 0]);
  checks.push(["chartFill IGNORING the pattern (restrict === deny pixel) is caught", chartModuleProblems(mkMod({ chartFill: (o) => `hsl(var(${o === "allow" ? "--decision-allow" : o === "step-up" ? "--decision-review" : "--decision-deny"}))` })).some((p) => /the same pixel/.test(p))]);
  checks.push(["a hatch stripe as wide as its tile is caught", chartModuleProblems(mkMod({ hatch: { size: 4, stripeWidth: 4 } })).length === 1]);
  checks.push(["restrict/deny dataKeys SWAPPED are caught", chartModuleProblems(mkMod({ marks: { restrict: { dataKey: "deny", token: "--decision-deny", pattern: "hatch" }, deny: { dataKey: "restrict", token: "--decision-deny", pattern: "solid" } } })).length === 2]);
  checks.push(["restrict and deny sharing a pattern is caught", chartModuleProblems(mkMod({ marks: { restrict: { dataKey: "restrict", token: "--decision-deny", pattern: "solid" } } })).some((p) => /share a pattern/.test(p))]);
  checks.push(["an unratified fill token (--chart-4) is caught", chartModuleProblems(mkMod({ marks: { restrict: { dataKey: "restrict", token: "--chart-4", pattern: "hatch" } } })).length === 1]);
  checks.push(["a module with no chart map declares none (null), not a pass", chartModuleProblems({ X: 1 }) === null]);
  for (const rel of CHART_MAP_REQUIRED) {
    let p = null;
    try { p = chartModuleProblems(await import(pathToFileURL(join(repo, rel)).href)); } catch { /* reported below */ }
    checks.push([`required chart module imports and is sound: ${rel}`, p !== null && p.length === 0]);
  }

  // The fourth half (2026-10-22, row 168): the registry, each mutant planted.
  const goodRecord = `export const OUTCOME_TONE: Record<Outcome, string> = {\n  allow: "text-status-allow",\n  "step-up": "text-status-step-up",\n  restrict: "text-status-restrict",\n  deny: "text-status-deny",\n};`;
  const rp = (t) => toneRecordProblems(t).problems;
  checks.push(["a sound four-verdict Record passes (control)", rp(goodRecord).length === 0 && toneRecordProblems(goodRecord).records === 1]);
  checks.push(["MUTANT allow/deny swapped in a Record is caught", rp(goodRecord.replace('allow: "text-status-allow"', 'allow: "text-status-deny"').replace('deny: "text-status-deny"', 'deny: "text-status-allow"')).length >= 2]);
  checks.push(["MUTANT deny wearing the allow class (the reproduce) is caught", rp(goodRecord.replace('deny: "text-status-deny"', 'deny: "text-status-allow"')).some((m) => /deny wears status-allow/.test(m))]);
  checks.push(["MUTANT step-up wearing the restrict class is caught", rp(goodRecord.replace('"step-up": "text-status-step-up"', '"step-up": "text-status-restrict"')).some((m) => /step-up.*wears status-restrict/.test(m))]);
  checks.push(["MUTANT restrict wearing the deny class is caught (shared token, distinct class)", rp(goodRecord.replace('restrict: "text-status-restrict"', 'restrict: "text-status-deny"')).some((m) => /restrict wears status-deny/.test(m))]);
  checks.push(["MUTANT a duplicate class in a four-verdict total is caught", rp(goodRecord.replace('"step-up": "text-status-step-up"', '"step-up": "text-status-allow"')).some((m) => /same class/.test(m))]);
  checks.push(["MUTANT a total whose verdict lost its status class is caught", rp(goodRecord.replace('deny: "text-status-deny"', 'deny: "text-red-300"')).some((m) => /deny carries no status class/.test(m))]);
  checks.push(["the review tree's step_up spelling is judged too", rp(goodRecord.replace('"step-up"', "step_up").replace("text-status-step-up", "text-status-deny")).some((m) => /step_up wears status-deny/.test(m))]);
  checks.push(["a Record with a class beside other classes is judged by its status suffix", rp(goodRecord.replace('deny: "text-status-deny"', 'deny: "border-x bg-status-allow/5 text-status-allow"')).length >= 1]);
  checks.push(["a spread of an UNKNOWN base is a problem, not a skip (M1)", rp(`const T: Record<SimulatorOutcome, string> = {\n  ...BASE,\n  alert_operator: "text-sky-300",\n};`).some((m) => /spreads BASE/.test(m))]);
  checks.push(["a spread of a judged Record in the same module is fine (SIMULATOR_OUTCOME_TONE shape)", rp(`${goodRecord}\nconst T: Record<SimulatorOutcome, string> = {\n  ...OUTCOME_TONE,\n  alert_operator: "text-sky-300",\n};`).length === 0]);
  checks.push(["a Record in a COMMENT is not code", toneRecordProblems(`// const X: Record<Outcome, string> = { deny: "text-status-allow" };`).records === 0]);
  checks.push(["an unclosed Record is a problem, not a pass", rp(`const X: Record<Outcome, string> = { deny: "text-status-deny",`).length === 1]);
  const goodCss = `.text-status-allow { color: hsl(var(--decision-allow)); }\n.bg-status-allow { background-color: hsl(var(--decision-allow) / 0.08); color: hsl(var(--decision-allow-on-tint)); }\n.text-status-step-up { color: hsl(var(--decision-review)); }\n.text-status-restrict { color: hsl(var(--decision-deny)); }\n.text-status-deny { color: hsl(var(--decision-deny)); }\n.bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08); color: hsl(var(--decision-deny-on-tint)); }`;
  const cp = (t) => cssToneProblems(t).problems;
  checks.push(["sound CSS passes, and counts its rules (control)", cp(goodCss).length === 0 && cssToneProblems(goodCss).rules === 6]);
  checks.push(["MUTANT .text-status-deny pointing at --decision-allow is caught", cp(goodCss.replace(".text-status-deny { color: hsl(var(--decision-deny))", ".text-status-deny { color: hsl(var(--decision-allow))")).length === 1]);
  checks.push(["MUTANT .text-status-step-up painted with the deny token is caught", cp(goodCss.replace("hsl(var(--decision-review))", "hsl(var(--decision-deny))")).length === 1]);
  checks.push(["MUTANT .bg-status-allow tinted with the review token is caught", cp(goodCss.replace("background-color: hsl(var(--decision-allow) / 0.08)", "background-color: hsl(var(--decision-review) / 0.08)")).length === 1]);
  checks.push(["MUTANT .bg-status-deny text colour from the allow family is caught", cp(goodCss.replace("--decision-deny-on-tint", "--decision-allow-on-tint")).length === 1]);
  checks.push(["a verdict rule with no --decision-* token is a problem, not a skip", cp(goodCss.replace(".text-status-deny { color: hsl(var(--decision-deny))", ".text-status-deny { color: red")).length === 1]);
  checks.push(["restrict and deny sharing --decision-deny passes (by design)", cp(goodCss).length === 0]);
  checks.push(["CSS with no verdict rule judges zero rules (reported, never read as clean)", cssToneProblems(`.foo { color: red; }`).rules === 0]);
  const chartMutant = chartModuleProblems(mkMod({ marks: { allow: { dataKey: "allow", token: "--decision-deny", pattern: "solid" }, deny: { dataKey: "deny", token: "--decision-allow", pattern: "solid" } } }));
  checks.push(["MUTANT swapped allow/deny chart tokens are caught", chartMutant.length === 2 && chartMutant.every((m) => /not its ratified/.test(m))]);
  checks.push(["MUTANT step-up chart token borrowed from allow is caught", chartModuleProblems(mkMod({ marks: { "step-up": { dataKey: "stepUp", token: "--decision-allow", pattern: "solid" } } })).some((m) => /step-up fills from --decision-allow/.test(m))]);
  checks.push(["restrict on the shared deny token passes (by design)", chartModuleProblems(mkMod()).length === 0]);

  // Non-vacuity on the REAL files: they are read, they pass, and the same mutants
  // planted in their text turn the gate red. A control that only ran on fixtures
  // would pass a gate that never opened the files.
  const realTone = {};
  for (const rel of TONE_MODULES) {
    let src = null;
    try { src = readFileSync(join(repo, rel), "utf8"); } catch { /* reported by the loop below */ }
    realTone[rel] = src;
    const r = src === null ? { records: 0, entries: 0, problems: ["unreadable"] } : toneRecordProblems(src, TONE_EXPECTED[rel]);
    checks.push([`real tone module declares its expected Records and they pass the registry (${r.records} Record(s), ${r.entries} entr(ies)): ${rel}`, src !== null && r.entries >= 4 * TONE_EXPECTED[rel].length && r.problems.length === 0]);
  }
  const desk = realTone["artifacts/signalgrid-desktop/src/lib/outcome-tone.ts"] ?? "";
  checks.push(["the row-168 reproduce, planted in the real desktop module's text, is RED", toneRecordProblems(desk, TONE_EXPECTED["artifacts/signalgrid-desktop/src/lib/outcome-tone.ts"]).problems.length === 0 && rp(desk.replace('deny: "text-status-deny"', 'deny: "text-status-allow"')).some((m) => /deny wears status-allow/.test(m))]);
  const rev = realTone["artifacts/signalgrid-review/src/lib/outcome-tone.ts"] ?? "";
  checks.push(["allow/deny swapped in the real review module's VERDICT_TEXT_TONE is RED", rp(rev.replace('allow: "text-status-allow"', 'allow: "text-status-deny"')).some((m) => /allow wears status-deny/.test(m))]);
  for (const tree of [...TREES, APP_CSS_ROOT]) {
    const css = walk(join(repo, tree), /\.css$/).files.map((f) => readFileSync(f, "utf8"));
    const judged = css.map(cssToneProblems);
    const rules = judged.reduce((n, r) => n + r.rules, 0);
    checks.push([`real CSS of ${tree} has verdict rules and they resolve to the registry (${rules})`, rules > 0 && judged.every((r) => r.problems.length === 0)]);
    const first = css.find((c) => cssToneProblems(c).rules > 0) ?? "";
    checks.push([`...and a wrong token planted in that CSS is RED: ${tree}`, cp(first.replace(/(\.text-status-deny\s*\{\s*color:\s*hsl\(var\()--decision-deny/, "$1--decision-allow")).length === 1]);
  }
  for (const rel of CHART_MAP_REQUIRED) {
    let real = null;
    try { real = await import(pathToFileURL(join(repo, rel)).href); } catch { /* reported above */ }
    const m = real?.OUTCOME_CHART_MARK;
    const swapped = m && { ...real, OUTCOME_CHART_MARK: { ...m, allow: { ...m.allow, token: m.deny.token }, deny: { ...m.deny, token: m.allow.token } } };
    checks.push([`swapping allow/deny tokens in the REAL chart marks is RED: ${rel}`, !!swapped && chartModuleProblems(swapped).some((x) => /not its ratified/.test(x))]);
  }

  // M1 — a verdict entry that is not a plain string literal cannot be judged.
  for (const [label, entry] of [
    ["an identifier", 'deny: ALLOW_CLASS'],
    ["a ternary", 'deny: flag ? "text-status-allow" : "text-status-deny"'],
    ["a cn() call", 'deny: cn("text-status-allow")'],
    ["a shorthand", 'deny'],
    ["an interpolated template", 'deny: `text-status-${x}`'],
    ["a computed key", '["deny"]: "text-status-deny"'],
  ]) {
    checks.push([`MUTANT a verdict entry that is ${label} is a problem, never a skip`, rp(goodRecord.replace('deny: "text-status-deny"', entry)).some((m) => /deny|computed key/.test(m))]);
  }
  checks.push(["a non-literal entry also fires the expected-Record floor", toneRecordProblems(goodRecord.replace('deny: "text-status-deny"', "deny: ALLOW_CLASS"), ["OUTCOME_TONE"]).problems.some((m) => /expected OUTCOME_TONE/.test(m))]);
  checks.push(["entries are counted, not Records: a spread-only Record judges 0 entries", toneRecordProblems(`const T: Record<SimulatorOutcome, string> = { ...OUTCOME_TONE };`).entries === 0 && toneRecordProblems(goodRecord).entries === 4]);
  checks.push(["a finding names the ENTRY's line, not the Record's (L6)", toneRecordProblems(goodRecord.replace('deny: "text-status-deny"', 'deny: "text-status-allow"')).problems.some((m) => /^line 5: OUTCOME_TONE\.deny wears/.test(m))]);
  // M2 — the expected Records are a floor, in every declaration shape.
  checks.push(["MUTANT an expected Record renamed away is RED", toneRecordProblems(goodRecord.replace("OUTCOME_TONE", "OTHER_TONE"), ["OUTCOME_TONE"]).problems.some((m) => /expected OUTCOME_TONE/.test(m))]);
  checks.push(["MUTANT an expected Record that lost an arm is RED", toneRecordProblems(goodRecord.replace('  deny: "text-status-deny",\n', ""), ["OUTCOME_TONE"]).problems.some((m) => /expected OUTCOME_TONE/.test(m))]);
  for (const [label, text] of [
    ["`as const satisfies`", goodRecord.replace(": Record<Outcome, string> = {", " = {").replace("};", "} as const satisfies Record<Outcome, string>;")],
    ["`Readonly<Record<>>`", goodRecord.replace("Record<Outcome, string>", "Readonly<Record<Outcome, string>>")],
    ["`Object.freeze`", goodRecord.replace("= {", "= Object.freeze({").replace("};", "});")],
  ]) {
    const r = toneRecordProblems(text, ["OUTCOME_TONE"]);
    checks.push([`a Record declared with ${label} is still found and judged`, r.entries === 4 && r.problems.length === 0]);
    checks.push([`...and a wrong class in it with ${label} is RED`, toneRecordProblems(text.replace('deny: "text-status-deny"', 'deny: "text-status-allow"'), ["OUTCOME_TONE"]).problems.some((m) => /deny wears status-allow/.test(m))]);
  }
  // L1 — CSS shapes that used to be neither judged nor counted.
  checks.push(["MUTANT a selector LIST naming a verdict class is RED", cp(goodCss.replace(".text-status-deny {", ".text-status-deny, .foo {")).some((m) => /canonical single-class shape/.test(m))]);
  checks.push(["MUTANT a pseudo-class override is RED", cp(goodCss + "\n.text-status-deny:hover { color: hsl(var(--decision-allow)); }").some((m) => /canonical/.test(m))]);
  checks.push(["MUTANT a :where() override is RED", cp(goodCss + "\n:where(.text-status-deny) { color: hsl(var(--decision-allow)); }").some((m) => /canonical/.test(m))]);
  checks.push(["MUTANT a Tailwind @utility is RED", cp(goodCss + "\n@utility text-status-deny { color: hsl(var(--decision-allow)); }").some((m) => /canonical/.test(m))]);
  checks.push(["MUTANT a later colour declaration overriding the first is RED (CSS applies the last)", cp(goodCss.replace(".text-status-deny { color: hsl(var(--decision-deny));", ".text-status-deny { color: hsl(var(--decision-deny)); color: hsl(var(--decision-allow));")).some((m) => /paints --decision-allow/.test(m))]);
  checks.push(["MUTANT a wrong border-color inside .bg-status-* is RED", cp(goodCss.replace(".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08);", ".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08); border-color: hsl(var(--decision-allow) / 0.2);")).some((m) => /border-color paints/.test(m))]);
  checks.push(["a correct border-color inside .bg-status-* passes", cp(goodCss.replace(".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08);", ".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08); border-color: hsl(var(--decision-deny) / 0.2);")).length === 0]);
  checks.push(["a verdict class mentioned only in a CSS comment is not a rule", cp(`/* .text-status-deny, .x { color: red } */\n${goodCss}`).length === 0]);
  // The floors, and the lane wired end to end (M2, L2): the WHOLE gate against a temp tree with a planted defect.
  const e2eCss = VERDICTS.map((v) => `.text-status-${v} { color: hsl(var(${VERDICT_REGISTRY[v].token})); }`).join("\n");
  const e2eBg = VERDICTS.map((v) => `.bg-status-${v} { background-color: hsl(var(${VERDICT_REGISTRY[v].token}) / 0.08); color: hsl(var(${VERDICT_REGISTRY[v].token}-on-tint)); }`).join("\n");
  const e2eTone = `export type Outcome = "allow" | "step-up" | "restrict" | "deny";\n${goodRecord}\nexport function outcomeTone(o: string): string { return OUTCOME_TONE[o as Outcome] ?? "text-status-restrict"; }\n`;
  const e2e = async (label, expectCode, expectInErr, plant = {}) => {
    const dir = mkdtempSync(join(tmpdir(), "tone-gate-"));
    try {
      const { cssRoots, ...planted } = plant;
      const files = { "a/src/lib/outcome-tone.ts": e2eTone, "a/src/index.css": e2eCss, ...planted };
      for (const [f, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        writeFileSync(join(dir, f), text);
      }
      const r = await runGate({
        root: dir, trees: ["a/src"], toneModules: { "a/src/lib/outcome-tone.ts": ["OUTCOME_TONE"] },
        cssRoots: cssRoots ?? ["a/src"], chartMapRequired: new Set(), bgFloorExempt: {},
      });
      checks.push([`end to end: ${label}`, r.code === expectCode && r.err.join("\n").includes(expectInErr)]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  await e2e("a clean temp tree exits 0 (control — the lane is not red by default)", 0, "");
  await e2e("allow/deny swapped in the Record exits 1, naming the file", 1, "a/src/lib/outcome-tone.ts", { "a/src/lib/outcome-tone.ts": e2eTone.replace('deny: "text-status-deny"', 'deny: "text-status-allow"') });
  await e2e("an identifier entry exits 1", 1, "is not a string literal", { "a/src/lib/outcome-tone.ts": e2eTone.replace('deny: "text-status-deny"', "deny: X") });
  await e2e("an expected Record renamed away exits 1", 1, "expected OUTCOME_TONE", { "a/src/lib/outcome-tone.ts": e2eTone.replace(/OUTCOME_TONE/g, "RENAMED_TONE") });
  await e2e("a CSS rule pointing at the wrong token exits 1, naming the stylesheet", 1, "a/src/index.css", { "a/src/index.css": e2eCss.replace(".text-status-deny { color: hsl(var(--decision-deny))", ".text-status-deny { color: hsl(var(--decision-allow))") });
  await e2e("a deleted .text-status-* rule (floor) exits 1", 1, "no canonical .text-status-restrict rule", { "a/src/index.css": e2eCss.split("\n").filter((l) => !l.startsWith(".text-status-restrict")).join("\n") });
  await e2e("a stylesheet tree with no rules at all exits 1", 1, "no canonical .text-status-allow rule", { "a/src/index.css": "/* nothing */" });
  await e2e("a tree that uses bg-status-* with no .bg-status-* rules exits 1", 1, "no canonical .bg-status-deny rule", { "a/src/Chip.tsx": 'export const C = () => <i className="bg-status-deny" />;\n' });
  await e2e("...and with the four .bg-status-* rules present it exits 0", 0, "", { "a/src/Chip.tsx": 'export const C = () => <i className="bg-status-deny" />;\n', "a/src/index.css": `${e2eCss}\n${e2eBg}` });
  await e2e("a selector list exits 1", 1, "canonical single-class shape", { "a/src/index.css": e2eCss.replace(".text-status-deny {", ".text-status-deny, .x {") });
  await e2e("an inline verdict ternary in a page exits 1, naming the page", 1, "a/src/Page.tsx", { "a/src/Page.tsx": 'export const P = ({ d }) => <i className={d.outcome === "deny" ? "text-status-deny" : "text-status-allow"} />;\n' });
  await e2e("a CSS root that is a FILE (readdir ENOTDIR) exits 1, not a quiet skip", 1, "ENOTDIR", { cssRoots: ["a/src", "a/src/index.css"] });

  // The direction rule must hold on the REAL tone modules, each of which must exist.
  for (const rel of TONE_MODULES) {
    let src = null;
    try { src = readFileSync(join(repo, rel), "utf8"); } catch { /* reported below */ }
    checks.push([`tone module exists: ${rel}`, src !== null]);
    checks.push([`tone module carries a verdict map: ${rel}`, src !== null && localMapLines(src).length > 0]);
    checks.push([`tone module fallback is restrictive: ${rel}`, src !== null && fallbackProblems(src).length === 0]);
  }

  // Non-vacuity for the run below: the gate must actually be reading files.
  const scanned = TREES.flatMap((t) => walk(join(repo, t)).files);
  checks.push([`the real trees contain files to scan (${scanned.length})`, scanned.length > 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

/**
 * The gate itself, over injectable roots so the self-test can run the WHOLE lane
 * against a temp tree holding a planted defect (a gate whose wiring is untested
 * can have its exit condition deleted and still pass its own fixtures).
 *   root            repo root; every other path is relative to it
 *   trees           trees whose sources get the inline-decision scan and chart sites
 *   toneModules     { rel: [expected Record names] }
 *   cssRoots        trees whose stylesheets are judged against the registry
 *   chartMapRequired  tone modules that must carry a chart map
 *   bgFloorExempt   { cssRoot: { since, reason } } — a dated exemption from the .bg-status-* floor
 */
export async function runGate(cfg) {
  const out = [], err = [];
  const log = (m = "") => out.push(m);
  const fail = (m = "") => err.push(m);
  const { root, trees, toneModules, cssRoots, chartMapRequired, bgFloorExempt } = cfg;
  const rel = (f) => relative(root, f).split("\\").join("/");

  const walkErrs = [];
  const files = trees.flatMap((t) => {
    const r = walk(join(root, t));
    walkErrs.push(...r.errs);
    return r.files;
  });
  if (files.length === 0 && walkErrs.length === 0) {
    fail("✗ no source files found in any decision-bearing tree — refusing to report a pass from a scan that read nothing.");
    return { code: 1, out, err };
  }

  const problems = [];
  const directionProblems = [];
  const chartProblems = [];
  const registryProblems = walkErrs.map((e) => `${e} — unreadable directory; its sources were not judged`);
  let exempted = 0;

  /** Trees whose tone module declares a chart map; their chart sites are judged. */
  const chartTrees = [];
  let recordsJudged = 0, entriesJudged = 0;
  for (const mod of Object.keys(toneModules)) {
    let src;
    try {
      src = readFileSync(join(root, mod), "utf8");
    } catch (e) {
      registryProblems.push(`${mod} — unreadable (${e.code ?? e.message}); a tone module that cannot be read cannot be judged`);
      continue;
    }
    const r = toneRecordProblems(src, toneModules[mod]);
    recordsJudged += r.records;
    entriesJudged += r.entries;
    for (const msg of r.problems) registryProblems.push(`${mod}:${msg}`);
    const declaresChart = /\bexport\s+const\s+OUTCOME_CHART_MARK\b/.test(src);
    if (!declaresChart && !chartMapRequired.has(mod)) continue;
    let ns;
    try {
      ns = await import(pathToFileURL(join(root, mod)).href);
    } catch (e) {
      // Fail closed: a chart map (or a required one) that cannot be imported cannot be judged.
      chartProblems.push(`${mod} — could not be imported to judge its chart map: ${e.message}`);
      continue;
    }
    const p = chartModuleProblems(ns);
    if (p === null) {
      chartProblems.push(`${mod} — required OUTCOME_CHART_MARK is missing`);
      continue;
    }
    for (const msg of p) chartProblems.push(`${mod} — ${msg}`);
    chartTrees.push(mod.replace(/\/lib\/outcome-tone\.ts$/, "/"));
  }

  let cssRules = 0;
  const exemptions = [];
  for (const cssRoot of cssRoots) {
    const css = walk(join(root, cssRoot), /\.css$/);
    for (const e of css.errs) registryProblems.push(`${e} — unreadable directory; its stylesheets were not judged`);
    const found = new Set();
    for (const f of css.files) {
      let text;
      try { text = readFileSync(f, "utf8"); } catch (e) { registryProblems.push(`${rel(f)} — unreadable (${e.code ?? e.message})`); continue; }
      const r = cssToneProblems(text);
      cssRules += r.rules;
      for (const k of r.found) found.add(k);
      for (const msg of r.problems) registryProblems.push(`${rel(f)}:${msg}`);
    }
    // The floor: every verdict's text class in every root; the bg classes wherever the tree's sources use them.
    const need = VERDICTS.map((v) => `text:${v}`);
    const srcs = walk(join(root, cssRoot)).files;
    const usesBg = srcs.some((f) => { try { return /\bbg-status-/.test(stripComments(readFileSync(f, "utf8"))); } catch { return false; } });
    if (usesBg && bgFloorExempt[cssRoot]) exemptions.push(`${cssRoot} — .bg-status-* floor waived since ${bgFloorExempt[cssRoot].since}: ${bgFloorExempt[cssRoot].reason}`);
    else if (usesBg) need.push(...VERDICTS.map((v) => `bg:${v}`));
    for (const k of need) {
      if (!found.has(k)) registryProblems.push(`${cssRoot} — no canonical .${k.replace(":", "-status-")} rule found; a verdict class with no rule renders no colour`);
    }
  }

  for (const file of files) {
    const r = rel(file);
    const src = readFileSync(file, "utf8");
    const hits = [...offendingLines(src), ...localMapLines(src)];
    if (TONE_MODULES_OF(toneModules).has(r)) {
      exempted += hits.length;
      // Inside the one place a map may live, the fallback's DIRECTION is gated.
      for (const p of fallbackProblems(src)) directionProblems.push(`${r}:${p.line} — \`?? "${p.fallback}"\` is not a restrictive token`);
      continue;
    }
    for (const line of hits) problems.push(`${r}:${line}`);
    if (chartTrees.some((t) => r.startsWith(t))) {
      for (const msg of chartSiteProblems(src)) chartProblems.push(`${r} — ${msg}`);
    }
  }

  log(`Verdict tone source — ${files.length} file(s) scanned across ${trees.length} tree(s).`);
  log(
    exempted > 0
      ? `  ${exempted} occurrence(s) inside the ${Object.keys(toneModules).length} named tone module(s), which is where they belong.`
      : `  ${Object.keys(toneModules).length} tone module(s) are exempt; none needed the exemption on this run.`,
  );
  log(`  chart marks judged in ${chartTrees.length} tree(s) with a chart map: ${chartTrees.join(", ") || "none"}; trees without one are not judged for charts.`);
  log(`  registry: ${recordsJudged} tone Record(s) / ${entriesJudged} verdict entr(ies) and ${cssRules} CSS verdict rule(s) across ${cssRoots.length} stylesheet root(s) judged against VERDICT_REGISTRY.`);
  for (const e of exemptions) log(`  EXEMPTION (dated): ${e}`);

  if (chartProblems.length > 0) {
    fail(`\n✗ ${chartProblems.length} verdict chart problem(s):`);
    for (const p of chartProblems) fail(`    ${p}`);
    fail("\n  A verdict chart reads its fills and patterns from OUTCOME_CHART_MARK, renders a Legend");
    fail("  and a Tooltip, and never lets two verdicts be the same pixel. Restrict and deny share");
    fail("  the deny tone by design, so they MUST differ in pattern (backlog row 107).");
  }
  if (registryProblems.length > 0) {
    fail(`\n✗ ${registryProblems.length} verdict painted with the WRONG ratified token, or not judgeable (backlog row 168):`);
    for (const p of registryProblems) fail(`    ${p}`);
    fail("\n  allow → --decision-allow, step-up → --decision-review, restrict and deny →");
    fail("  --decision-deny (shared by design, told apart by class suffix and chart pattern).");
  }
  if (problems.length > 0) {
    fail(`\n✗ ${problems.length} verdict→colour decision(s) outside a tone module (inline ternary or local map):`);
    for (const p of problems) fail(`    ${p}`);
    fail("\n  A verdict may not pick its own colour at the point of render. Route it through");
    fail("  the tree's tone module — a total Record over the verdict union, see");
    fail("  artifacts/signalgrid-desktop/src/lib/outcome-tone.ts — so a missing arm is a");
    fail("  typecheck failure instead of a fourth independent opinion about what deny looks like.");
  }
  if (directionProblems.length > 0) {
    fail(`\n✗ ${directionProblems.length} tone-module fallback(s) in the WRONG DIRECTION:`);
    for (const p of directionProblems) fail(`    ${p}`);
    fail("\n  An unrecognised verdict must resolve to the RESTRICTIVE tone (status-restrict or");
    fail("  status-deny), never to a neutral one. Unknown must tighten the answer.");
  }
  if (problems.length + directionProblems.length + chartProblems.length + registryProblems.length > 0) return { code: 1, out, err };

  log("\nVerdict tone source gate passed — every verdict→colour decision is centralised,");
  log("and every tone-module fallback is restrictive.");
  log("It judges each verdict against VERDICT_REGISTRY: chart-mark tokens, tone Records, and .text-/.bg-status-* CSS. It still does NOT judge:");
  log("  - restrict vs deny TOKENS: they share --decision-deny by design (DR-005/006); they differ by class suffix and chart pattern only;");
  log("  - badge Records outside the three tone modules, or Records not named in TONE_EXPECTED or typed Record<…Outcome…, string> (e.g. CONNECTOR_DECISION_TONE);");
  log("  - the desktop tree's chart (it has no chart map) or its tinted chips (it declares no .bg-status-* rules; see the dated EXEMPTION above);");
  log("  - signalgrid-app's TSX: its stylesheet is judged (a CSS root), but its sources are not inline-scanned (its LiveDecisionPanel map would trip the scan);");
  log("  - CSS inside a nested at-rule other than as a flat rule, and Tailwind theme/config colours;");
  log("  - the tokens' own values (check-decision-palette.mjs holds contrast and canon).");
  return { code: 0, out, err };
}
const TONE_MODULES_OF = (m) => new Set(Object.keys(m));

const APP_CSS_ROOT = "artifacts/signalgrid-app/src";
/** Dated exemptions from the `.bg-status-*` floor. Each one is printed on every run. */
const BG_FLOOR_EXEMPT = {
  "artifacts/signalgrid-desktop/src": {
    since: "2026-10-22",
    reason: "src/lib/outcome-tone.ts failModeTone() returns `bg-status-allow/5` / `bg-status-deny/5` (rendered by pages/Policies.tsx) but index.css declares no .bg-status-* rules (plan row 153) — the chip's tint resolves to nothing, and fail-closed wears the allow class. artifacts/** is out of scope for the gate's author; a hand is raised on the PR.",
  },
};
const REAL_CONFIG = {
  root: repo,
  trees: TREES,
  toneModules: TONE_EXPECTED,
  cssRoots: [...TREES, APP_CSS_ROOT],
  chartMapRequired: CHART_MAP_REQUIRED,
  bgFloorExempt: BG_FLOOR_EXEMPT,
};

if (process.argv.includes("--self-test")) process.exit(await selfTest());

const result = await runGate(REAL_CONFIG);
for (const l of result.out) console.log(l);
for (const l of result.err) console.error(l);
process.exit(result.code);
