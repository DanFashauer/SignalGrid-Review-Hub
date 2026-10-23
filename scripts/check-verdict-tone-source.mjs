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
// WHAT IT STILL CANNOT DO, said plainly (the run prints the same eight items; the self-test checks the
// agreement of this list, the printed footer and plan row 168 in both directions):
//   1. restrict vs deny TOKENS: they share --decision-deny by design (DR-005/006), so a swap of the two is
//      invisible; they differ by class suffix and chart pattern only.
//   2. badge Records outside the three tone modules, and any Record not named in TONE_EXPECTED or typed
//      Record<…Outcome…, string>; an unnamed Record is held to canonical class tokens but may carry extras.
//   3. the default arm of a verdict branch and the complement arm of a negative test; every status class
//      under a branch whose test names no verdict on the verdict parameter and that is not inside a verdict
//      arm; a switch clause that falls into the next with statements; and any verdict choice not made by an
//      object property, a comparison, `.includes()` / `.has()` or a `switch` case (a class written before its
//      comparison, `clsx({ … })` keys, an aliased mutation or a copy of a judged Record).
//   4. the desktop tree's chart: it exports no OUTCOME_CHART_MARK and its Dashboard carries literal fills.
//   5. signalgrid-app's TSX (its stylesheet is judged), and a new app tree with neither a tone module nor
//      verdict CSS.
//   6. Tailwind theme/config colours, the opacity forms (`bg-status-allow/5`) that no rule generates,
//      font-package stylesheets (`@fontsource/…`), the Tailwind packages themselves, and a stylesheet imported
//      from inside a workspace package a tree depends on.
//   7. the tokens' own values: check-decision-palette.mjs holds contrast and canon.
//   8. an arbitrary-value, important or opacity override written beside a status class in a page.
// Option (b) of row 168, distinct rendered values, is still open.

import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

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
// EXERCISED OR NOT, IT IS PRINTED. The run reports how many comparison/local-map
// occurrences sat inside these modules (today the shared `Record`s' own `deny:`
// style entries match the local-map pattern), so nobody mistakes an unused
// allowlist for a used one. What happens INSIDE a tone module is no longer left
// to this exemption: its Records and branches are judged against the registry.
/**
 * ...and the verdict Records each MUST declare, with the kind of class each holds (the registry's floor): a module
 * that loses one fails, rather than being judged over a smaller set.
 */
const TONE_EXPECTED = {
  "artifacts/signalgrid-desktop/src/lib/outcome-tone.ts": { OUTCOME_TONE: "text" },
  "artifacts/signalgrid-mobile-pwa/src/lib/outcome-tone.ts": { OUTCOME_BADGE_TONE: "bg" },
  "artifacts/signalgrid-review/src/lib/outcome-tone.ts": { VERDICT_BADGE_TONE: "bg", VERDICT_TEXT_TONE: "text" },
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
export function toneRecordProblems(src, expectedIn = []) {
  // `expected` is { NAME: kind } with kind "text" | "bg" | "border" (or null: any one canonical kind); an array means all-null.
  const expected = Array.isArray(expectedIn) ? Object.fromEntries(expectedIn.map((n) => [n, null])) : expectedIn;
  const code = stripComments(src);
  const problems = [];
  const lineAt = (i) => code.slice(0, i).split("\n").length;
  const literals = recordLiterals(code, Object.keys(expected));
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
      // Each value is tokenised on whitespace. A token that mentions a status class must BE a complete
      // canonical class: no variant prefix, `/N` suffix, `!` modifier or `[…]` value (Tailwind generates no
      // rule for those, or generates a different one). In a Record the gate was told to expect, the value is
      // exactly one token, the canonical class of the Record's kind: no extra utility is allowed beside it.
      const tokens = lit[2].trim().split(/\s+/).filter(Boolean);
      const suffixes = [];
      for (const tok of tokens) {
        const canon = /^(text|bg|border)-status-([a-z-]+)$/.exec(tok);
        if (canon) {
          suffixes.push(canon[2]);
          if (canon[2] !== verdict) problems.push(`${at}.${key} wears status-${canon[2]}, its own class is status-${verdict}`);
        } else if (/status-/.test(tok)) {
          problems.push(`${at}.${key} holds \`${tok}\`, which is not a complete canonical status class (a variant, opacity, important or arbitrary-value form generates a different rule or none)`);
        }
      }
      if (name in expected) {
        const kind = expected[name];
        const want = kind ? `${kind}-status-${verdict}` : null;
        if (tokens.length !== 1 || (want ? tokens[0] !== want : !new RegExp(`^(?:text|bg|border)-status-${verdict}$`).test(tokens[0]))) {
          problems.push(`${at}.${key} is "${lit[2].trim()}", expected exactly \`${want ?? `<kind>-status-${verdict}`}\``);
        }
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
      if (Object.keys(expected).length > 0 && !(name in expected)) problems.push(`line ${lineAt(open)}: ${name} is a four-verdict Record that is not listed in TONE_EXPECTED — list it with its class kind so it is held to exactly one canonical class per verdict`);
    }
  }
  for (const name of Object.keys(expected)) {
    if (!totals.has(name)) problems.push(`expected ${name} is not declared as a judged four-verdict literal (missing, renamed, partial or unreadable)`);
  }
  return { records: literals.size, entries, problems };
}

/**
 * Judge a stylesheet: each `.text-status-X` / `.bg-status-X` rule must resolve to
 * the registry token for X. Each colour is read as the declaration CSS would apply
 * (the last one, unless an earlier `!important` wins) and must be, in full, an
 * `hsl(var(--decision-…))` expression: the tokens are HSL channel triples, so a bare
 * `var(--decision-…)`, a fallback chain or `color-mix()` is a colour the browser
 * would drop, and is a problem rather than a match on a substring. A
 * `.bg-status-X` also judges its text colour and its `border-color`. Not judgeable,
 * hence problems: a selector naming a verdict status class in any shape other than
 * the single canonical class (a list, a pseudo or `:where()` override, a Tailwind
 * `@utility`); a `--decision-*` custom property re-declared inside the rule; a
 * `background` / `border` / `all` shorthand that could override what was read.
 * `found` is the set of canonical `kind:verdict` rules, for the caller's floor.
 */
/** A verdict fill/border below this alpha renders as nothing; the live fills are 0.08 and 0.2. */
const MIN_FILL_ALPHA = 0.05;
const COLOUR_EXPR = /^hsl\(\s*var\(\s*(--decision-(?:allow|review|deny))(-on-tint)?\s*\)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i;
/** The properties a verdict rule may declare; anything else can change how the verdict renders and cannot be judged. */
const ALLOWED_PROPS = { text: new Set(["color"]), bg: new Set(["background-color", "color", "border-color"]) };

/**
 * Strip comments and neutralise string contents in ONE pass, so a `/*` inside `content: "/*"` is a string and
 * not a comment opener (and a quote inside a comment is not a string). `bad` is set for an unterminated
 * comment or string: the stylesheet cannot be tokenised and is a problem, not a pass.
 */
function cssClean(src) {
  let out = "", i = 0, bad = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") {
      const j = src.indexOf("*/", i + 2);
      if (j < 0) bad = true;
      const end = j < 0 ? src.length : j + 2;
      out += src.slice(i, end).replace(/[^\n]/g, "");
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== "\n") { if (src[j] === "\\") j++; j++; }
      if (src[j] !== c) bad = true;
      const end = Math.min(j + 1, src.length);
      out += '""' + src.slice(i, end).replace(/[^\n]/g, "");
      i = end;
    } else { out += c; i++; }
  }
  return { code: out, bad };
}
/** CSS escapes (`\64 `, `\000064`, `\d`) decoded, so an escaped selector is matched as the browser reads it. */
const decodeCssEscapes = (t) => t.replace(/\\([0-9a-fA-F]{1,6})[ \t\n]?|\\([\s\S])/g, (m, hex, ch) => (hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : ch));

/**
 * A small block parser: `{ prelude, body, children, line }` per block. A `;` ends a statement at the top
 * level and inside an at-rule container (`@import …;`) and ends a declaration inside a style rule, so
 * nested rules (`&.x {}`) are children of their parent rather than silently dropped from view.
 */
function parseCssBlocks(code) {
  const root = { prelude: "", body: "", children: [], line: 1 };
  const stack = [root];
  let buf = "", bufLine = 1, line = 1;
  const isStyle = (n) => n !== root && !n.prelude.startsWith("@");
  for (const c of code) {
    if (c === "{") {
      const lead = (buf.match(/^\s*/)[0].match(/\n/g) ?? []).length;
      const node = { prelude: buf.trim(), body: "", children: [], line: bufLine + lead };
      stack.at(-1).children.push(node);
      stack.push(node);
      buf = ""; bufLine = line;
    } else if (c === "}") {
      if (stack.length === 1) return { root, balanced: false };
      stack.pop().body += buf;
      buf = ""; bufLine = line;
    } else if (c === ";") {
      const top = stack.at(-1);
      if (isStyle(top)) top.body += `${buf};`;
      buf = ""; bufLine = line;
    } else {
      if (buf === "") bufLine = line;
      buf += c;
    }
    if (c === "\n") line++;
  }
  return { root, balanced: stack.length === 1 };
}

/** Declarations of a style rule body: `{ prop (lower-cased), value, imp }`. Splits only at top-level `;`. */
function parseDecls(body) {
  const out = [];
  let depth = 0, from = 0;
  const push = (end) => {
    const raw = body.slice(from, end);
    const i = raw.indexOf(":");
    if (i < 0) { if (raw.trim()) out.push({ prop: raw.trim().toLowerCase(), value: "", imp: false, bare: true }); return; }
    const value = raw.slice(i + 1).trim();
    out.push({ prop: raw.slice(0, i).trim().toLowerCase(), imp: /!\s*important\s*$/i.test(value), value: value.replace(/\s*!\s*important\s*$/i, "").trim() });
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth === 0) { push(i); from = i + 1; }
  }
  push(body.length);
  return out;
}
const effectiveDecl = (decls, prop) => {
  const mine = decls.filter((d) => d.prop === prop);
  if (mine.length === 0) return undefined;
  const important = mine.filter((d) => d.imp);
  return (important.length > 0 ? important : mine).at(-1).value;
};
/**
 * The token a colour expression paints, or undefined. `role` bounds the alpha: a text colour is opaque (no alpha, or
 * 1 / 100%), a fill or border has an alpha of at least MIN_FILL_ALPHA. A verdict painted at (near) alpha 0 renders invisible.
 */
const tokenOf = (decl, allowOnTint, role) => {
  const m = COLOUR_EXPR.exec(decl ?? "");
  if (!m || (m[2] && !allowOnTint)) return undefined;
  if (m[3] !== undefined) {
    const a = m[3].endsWith("%") ? parseFloat(m[3]) / 100 : parseFloat(m[3]);
    if (!(role === "text" ? a === 1 : a >= MIN_FILL_ALPHA)) return undefined;
  }
  return m[1];
};
const VERDICT_CLASS_MENTION = /(?:text|bg|border)-status-(?:allow|step-up|restrict|deny)\b/i;
export function cssToneProblems(src) {
  const { code, bad } = cssClean(src);
  const problems = [];
  if (bad) problems.push("the stylesheet has an unterminated string or comment — it cannot be judged");
  const found = new Set();
  let rules = 0;
  const { root, balanced } = parseCssBlocks(code);
  if (!balanced) problems.push("the stylesheet's braces do not balance — it cannot be judged");
  const visit = (node, parentIsStyle) => {
    const prelude = node.prelude.replace(/\s+/g, " ");
    const style = !prelude.startsWith("@");
    const decoded = decodeCssEscapes(prelude);
    const mentions = VERDICT_CLASS_MENTION.test(decoded)
      || (/\\/.test(prelude) && /status|text-|bg-|border-/i.test(decoded))
      || (/\[\s*(?:[\w*-]*\|)?\s*class\s*[~|^$*]?=/i.test(decoded) && node.body.length > 0);
    if (mentions) {
      const canon = style && /^\.(text|bg)-status-(allow|step-up|restrict|deny)$/.exec(prelude);
      if (!canon) {
        problems.push(`line ${node.line}: selector "${prelude.slice(0, 60)}" names a verdict status class outside the canonical single-class shape (a list, pseudo or :where() override, escape, attribute selector or @utility) — it cannot be judged`);
      } else if (parentIsStyle) {
        problems.push(`line ${node.line}: ${prelude} is nested inside another style rule — it cannot be judged`);
      } else {
        const [, kind, verdict] = canon;
        rules++;
        found.add(`${kind}:${verdict}`);
        const want = VERDICT_REGISTRY[verdict].token;
        const at = `line ${node.line}: .${kind}-status-${verdict}`;
        if (node.children.length > 0) problems.push(`${at} contains nested rules — it cannot be judged`);
        const decls = parseDecls(node.body);
        for (const d of decls) {
          if (d.prop.startsWith("--")) problems.push(`${at} re-declares the custom property ${d.prop} inside the rule — it cannot be judged`);
          else if (!ALLOWED_PROPS[kind].has(d.prop)) problems.push(`${at} declares \`${d.prop}\`, which is not one of the colour properties judged here (shorthands and paint-altering properties cannot be judged)`);
        }
        const checks = kind === "text"
          ? [["color", false, true, "text"]]
          : [["background-color", false, true, "fill"], ["color", true, true, "text"], ["border-color", false, false, "fill"]];
        for (const [prop, onTint, required, role] of checks) {
          const decl = effectiveDecl(decls, prop);
          if (decl === undefined && !required) continue;
          const got = tokenOf(decl, onTint, role);
          if (!got) problems.push(`${at} ${prop} resolves to no --decision-* token (expected \`hsl(var(${want}))\`)`);
          else if (got !== want) problems.push(`${at} ${prop} paints ${got}, its registry token is ${want}`);
        }
      }
    }
    for (const child of node.children) visit(child, style && node !== root);
  };
  for (const child of root.children) visit(child, false);
  return { rules, found, problems };
}

/**
 * Judge the status classes in a tone module on its syntax tree (TypeScript compiler API), not on text.
 *
 * A branch's test is evaluated into two sets of verdicts, `T` and `F`: the verdicts the test POSITIVELY names for
 * the arm it selects when true and when false. Only a comparison whose other side is the toned SUBJECT — a function
 * parameter, an alias of one (`const o = outcome`), or a member chain of one (`d.outcome`) — contributes; any other
 * comparison (`previous === "allow"`, `other !== "fail-closed"`) is unknown and narrows nothing.
 *   `S === v`  T={v}      `S !== v`  F={v}      `[a, b].includes(S)` / `new Set([a, b]).has(S)`  T={a,b}
 *   `!X` swaps T and F;   `X === false` swaps, `X === true` keeps;
 *   `A && B`   T = A.T ∩ B.T when both name something, else their union; F = every verdict either side names (a
 *              verdict that makes B false still reaches the false arm, so the false arm must tolerate it);
 *   `A || B`   T = A.T ∪ B.T; F = A.F ∩ B.F when both name something, else their union;
 *   any other shape holding a comparison on the subject (a conditional used as the test, a call) is MIXED: both arms
 *   are bound to every verdict it names.
 * An arm bound to a set of verdicts passes a status class only if its class is that verdict's own (one verdict) or
 * every verdict in the set owns that class's registry token. Inside a bound arm a nested test NARROWS (T ∩ the
 * enclosing set, never replaces it); a nested test that names nothing inherits the enclosing binding. Outside a
 * verdict arm an arm no test names is not a verdict choice and is not judged: the default arm, the complement arm of a
 * negative test, and a branch whose test names no verdict on the subject (stated ceilings).
 * A bare default `return "…"` after a chain may be restrictive only. A status class anywhere else (an intermediate
 * constant, a module-level string) or built at runtime cannot be paired to a verdict and is a problem. A restrictive
 * `?? "…"` fallback is judged by its own direction rule. In a `switch (true)` a negated case binds the complement,
 * which no single class can satisfy: write the case positively.
 */
export function toneBranchProblems(src) {
  const sf = ts.createSourceFile("tone.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const K = ts.SyntaxKind;
  const out = [];
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const unwrap = (n) => {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n)) return unwrap(n.expression);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.CommaToken) return unwrap(n.right);
    return n;
  };
  const strOf = (n0) => {
    const n = unwrap(n0);
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.PlusToken) {
      const a = strOf(n.left), b = strOf(n.right);
      return a !== null && b !== null ? a + b : null;
    }
    return null;
  };
  const verdictOf = (n) => { const s = strOf(n); return s !== null && Object.hasOwn(KEY_VERDICT, s) ? KEY_VERDICT[s] : null; };
  const U = new Set(VERDICTS);
  const set = (...xs) => new Set(xs);
  const union = (a, b) => new Set([...a, ...b]);
  const inter = (a, b) => new Set([...a].filter((x) => b.has(x)));
  // tS / fS: the true / false arm is EXCLUSIVELY the named verdict(s) (so a single verdict must wear its own class);
  // otherwise the arm is merely REACHED by them among others (a class sharing the verdict's token is enough).
  const none = () => ({ T: new Set(), F: new Set(), tS: false, fS: false });
  const flip = (r) => ({ T: r.F, F: r.T, tS: r.fS, fS: r.tS });

  // The toned subject: parameters of the enclosing functions, and aliases of them.
  const scopes = [new Set()];
  const subjectNames = () => new Set(scopes.flatMap((s) => [...s]));
  const isSubject = (n0) => {
    const n = unwrap(n0);
    if (ts.isIdentifier(n)) return subjectNames().has(n.text);
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) return isSubject(n.expression);
    return false;
  };
  const bindingNames = (b, into) => {
    if (ts.isIdentifier(b)) into.add(b.text);
    else if (ts.isObjectBindingPattern(b) || ts.isArrayBindingPattern(b)) for (const e of b.elements) if (ts.isBindingElement(e)) bindingNames(e.name, into);
  };

  // Everything a test names on the subject, for shapes the evaluator does not model (MIXED).
  const namedAnywhere = (n) => {
    const found = new Set();
    const visit = (m) => {
      if (ts.isBinaryExpression(m)) {
        const k = m.operatorToken.kind;
        if (k === K.EqualsEqualsEqualsToken || k === K.EqualsEqualsToken || k === K.ExclamationEqualsEqualsToken || k === K.ExclamationEqualsToken) {
          const lv = verdictOf(m.left), rv = verdictOf(m.right);
          if ((lv && isSubject(m.right)) || (rv && isSubject(m.left))) found.add(lv ?? rv);
        }
      }
      if (ts.isCallExpression(m)) {
        const c = unwrap(m.expression);
        if (ts.isPropertyAccessExpression(c) && (c.name.text === "includes" || c.name.text === "has") && m.arguments[0] && isSubject(m.arguments[0])) {
          const collect = (x) => { const v = verdictOf(x); if (v) found.add(v); ts.forEachChild(x, collect); };
          collect(c.expression);
        }
      }
      ts.forEachChild(m, visit);
    };
    visit(n);
    return found;
  };
  const mixed = (n) => { const s = namedAnywhere(n); return { T: s, F: new Set(s), tS: false, fS: false }; };

  const ev = (n0) => {
    const n = unwrap(n0);
    if (ts.isPrefixUnaryExpression(n) && n.operator === K.ExclamationToken) return flip(ev(n.operand));
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      const eq = k === K.EqualsEqualsEqualsToken || k === K.EqualsEqualsToken;
      const ne = k === K.ExclamationEqualsEqualsToken || k === K.ExclamationEqualsToken;
      if (eq || ne) {
        const bl = (x) => { const u = unwrap(x); return u.kind === K.TrueKeyword ? true : u.kind === K.FalseKeyword ? false : null; };
        const lb = bl(n.left), rb = bl(n.right);
        if (lb !== null || rb !== null) {
          const inner = ev(rb !== null ? n.left : n.right);
          return eq === (rb !== null ? rb : lb) ? inner : flip(inner);
        }
        const lv = verdictOf(n.left), rv = verdictOf(n.right);
        const v = lv ?? rv;
        if (v) {
          if (!isSubject(lv ? n.right : n.left)) return none();
          return eq ? { T: set(v), F: new Set(), tS: true, fS: false } : { T: new Set(), F: set(v), tS: false, fS: true };
        }
        return mixed(n);
      }
      if (k === K.AmpersandAmpersandToken) {
        const a = ev(n.left), b = ev(n.right);
        const both = a.T.size > 0 && b.T.size > 0;
        return { T: both ? inter(a.T, b.T) : union(a.T, b.T), tS: both ? a.tS && b.tS : a.T.size > 0 ? a.tS : b.tS, F: union(union(a.F, b.F), union(a.T, b.T)), fS: false };
      }
      if (k === K.BarBarToken) {
        const a = ev(n.left), b = ev(n.right);
        const both = a.F.size > 0 && b.F.size > 0;
        return { T: union(a.T, b.T), tS: false, F: both ? inter(a.F, b.F) : union(a.F, b.F), fS: both ? a.fS && b.fS : a.F.size > 0 ? a.fS : b.fS };
      }
      return mixed(n);
    }
    if (ts.isCallExpression(n)) {
      const c = unwrap(n.expression);
      if (ts.isPropertyAccessExpression(c) && (c.name.text === "includes" || c.name.text === "has") && n.arguments[0]) {
        const lits = new Set();
        const collect = (x) => { const v = verdictOf(x); if (v) lits.add(v); ts.forEachChild(x, collect); };
        collect(c.expression);
        return isSubject(n.arguments[0]) && lits.size > 0 ? { T: lits, F: new Set(), tS: lits.size === 1, fS: false } : none();
      }
    }
    return mixed(n);
  };

  const IGNORE = { kind: "ignore" };
  const bound = (V, strict = false) => ({ kind: "bound", V, strict });
  // Inside a verdict arm a test narrows (∩) and never replaces; a test naming nothing inherits. Outside, only a named set binds.
  const narrow = (ctx, X, strict = false) => {
    if (ctx.kind === "bound") { if (X.size === 0) return ctx; const I = inter(ctx.V, X); return I.size > 0 ? bound(I, strict && I.size === 1) : ctx; }
    return X.size > 0 ? bound(X, strict && X.size === 1) : IGNORE;
  };
  const scan = (text, node, ctx) => {
    if (ctx.kind === "ignore") return;
    if (/(?:text|bg|border)-status-?$/.test(text)) out.push(`line ${lineOf(node)}: a status class built at runtime ("${text.slice(-24)}…") cannot be paired to a verdict`);
    for (const m of text.matchAll(/(?<![\w/-])(?:text|bg|border)-status-([a-z-]+)/g)) {
      if (!Object.hasOwn(VERDICT_REGISTRY, m[1])) continue;
      if (ctx.kind === "free") { out.push(`line ${lineOf(node)}: status-${m[1]} appears outside a verdict-keyed property or a branch on a verdict literal — it cannot be paired to a verdict`); continue; }
      // One verdict: its own class. A SET of verdicts: the class must paint every one of them, i.e. every verdict in
      // the set owns that class's registry token.
      const ok = ctx.strict && ctx.V.size === 1 ? ctx.V.has(m[1]) : [...ctx.V].every((v) => VERDICT_REGISTRY[v].token === VERDICT_REGISTRY[m[1]].token);
      if (!ok) out.push(`line ${lineOf(node)}: a branch on ${[...ctx.V].map((v) => `"${v}"`).join("/")} returns status-${m[1]}, which paints ${VERDICT_REGISTRY[m[1]].token} — not every verdict in the branch owns that token (own classes: ${[...ctx.V].map((v) => `status-${v}`).join("/")})`);
    }
  };
  const propName = (nm) => (ts.isIdentifier(nm) || ts.isStringLiteral(nm) || ts.isNumericLiteral(nm) ? nm.text : ts.isComputedPropertyName(nm) ? strOf(nm.expression) : null);
  const isFn = (n) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) || ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);

  function walk(n, ctx) {
    if (isFn(n)) {
      const names = new Set();
      for (const p of n.parameters) bindingNames(p.name, names);
      scopes.push(names);
      ts.forEachChild(n, (c) => walk(c, ctx));
      scopes.pop();
      return;
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && isSubject(n.initializer)) scopes.at(-1).add(n.name.text);
    const s = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || (ts.isBinaryExpression(n) && n.operatorToken.kind === K.PlusToken) || ts.isParenthesizedExpression(n) ? strOf(n) : null;
    if (s !== null) { scan(s, n, ctx); return; }
    if (ts.isTemplateExpression(n)) {
      scan(n.head.text, n, ctx);
      for (const span of n.templateSpans) { walk(span.expression, ctx); scan(span.literal.text, span, ctx); }
      return;
    }
    if (ts.isConditionalExpression(n)) {
      walk(n.condition, ctx);
      const r = ev(n.condition);
      walk(n.whenTrue, narrow(ctx, r.T, r.tS));
      walk(n.whenFalse, narrow(ctx, r.F, r.fS));
      return;
    }
    if (ts.isIfStatement(n)) {
      walk(n.expression, ctx);
      const r = ev(n.expression);
      walk(n.thenStatement, narrow(ctx, r.T, r.tS));
      if (n.elseStatement) walk(n.elseStatement, narrow(ctx, r.F, r.fS));
      return;
    }
    if (ts.isSwitchStatement(n)) {
      walk(n.expression, ctx);
      const onTrue = unwrap(n.expression).kind === K.TrueKeyword;
      const onSubject = !onTrue && isSubject(n.expression);
      let pending = new Set();
      for (const clause of n.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          if (onTrue) {
            const r = ev(clause.expression);
            const comp = r.T.size === 0 && r.F.size > 0 ? new Set([...U].filter((v) => !r.F.has(v))) : r.T;
            comp.forEach((v) => pending.add(v));
          } else if (onSubject) { const v = verdictOf(clause.expression); if (v) pending.add(v); }
        }
        if (clause.statements.length === 0 && ts.isCaseClause(clause)) continue;
        const c = ts.isDefaultClause(clause) ? narrow(ctx, new Set()) : narrow(ctx, pending, onSubject && pending.size === 1);
        for (const st of clause.statements) walk(st, c);
        pending = new Set();
      }
      return;
    }
    if (ts.isReturnStatement(n) && n.expression && strOf(n.expression) !== null && ctx.kind === "free") {
      scan(strOf(n.expression), n, bound(set("restrict", "deny"), false));
      return;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.QuestionQuestionToken && strOf(n.right) !== null) { walk(n.left, ctx); return; }
    if (ts.isPropertyAssignment(n)) {
      const key = propName(n.name);
      const v = key !== null && Object.hasOwn(KEY_VERDICT, key) ? KEY_VERDICT[key] : null;
      walk(n.initializer, v ? bound(set(KEY_VERDICT[key]), true) : ctx);
      return;
    }
    ts.forEachChild(n, (c) => walk(c, ctx));
  }
  for (const d of sf.parseDiagnostics ?? []) out.push(`line ${sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}: parse error — ${ts.flattenDiagnosticMessageText(d.messageText, " ")}; the module cannot be judged`);
  walk(sf, { kind: "free" });
  return out;
}

const ASSIGN_TOKENS = new Set([
  ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken, ts.SyntaxKind.MinusEqualsToken, ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken, ts.SyntaxKind.PercentEqualsToken, ts.SyntaxKind.AmpersandEqualsToken, ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken, ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken, ts.SyntaxKind.LessThanLessThanEqualsToken, ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
]);
const scriptKindOf = (file) => (/\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : /\.jsx$/.test(file) ? ts.ScriptKind.JSX : /\.tsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/**
 * Where a judged Record is written to after its literal, or looked up through a remapped key.
 * Writes: an assignment (plain, compound, logical, destructuring), `++`/`--`, `delete`, and
 * `Object.assign|defineProperty|defineProperties|setPrototypeOf` / `Reflect.set|defineProperty|deleteProperty|setPrototypeOf`
 * — dotted, bracketed, through `globalThis.`, with `.call` / `.apply`, comma-wrapped (`(0, Object.assign)(…)`), or through
 * a name destructured from `Object` / `Reflect` — against the bare name, a member chain, a namespace import
 * (`T.OUTCOME_TONE.deny = …`), an element access, or any of those under `as` / `satisfies` / `!` / a comma.
 * Lookups: a judged Record may be indexed only by an identifier or member chain (the verdict parameter, optionally cast)
 * or a string literal; a conditional, call, binary or template key is a verdict remap (`OUTCOME_TONE[o === "deny" ? "allow" : o]`).
 * An alias of the Record (`const t = OUTCOME_TONE`) and a copy of it are named ceilings.
 */
export function mutationProblems(src, names, file = "x.tsx") {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKindOf(file));
  const K = ts.SyntaxKind;
  const out = [];
  const unwrap = (n) => {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) || ts.isSatisfiesExpression(n) || ts.isTypeAssertionExpression(n)) return unwrap(n.expression);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.CommaToken) return unwrap(n.right);
    return n;
  };
  const lit = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
  const refers = (n0, name) => {
    const n = unwrap(n0);
    if (ts.isIdentifier(n)) return n.text === name;
    if (ts.isPropertyAccessExpression(n)) return n.name.text === name || refers(n.expression, name);
    if (ts.isElementAccessExpression(n)) return lit(n.argumentExpression) === name || refers(n.expression, name);
    return false;
  };
  const isRecordRef = (n0, name) => {
    const n = unwrap(n0);
    return (ts.isIdentifier(n) && n.text === name) || (ts.isPropertyAccessExpression(n) && n.name.text === name) || (ts.isElementAccessExpression(n) && lit(n.argumentExpression) === name);
  };
  const targets = (n0) => {
    const n = unwrap(n0);
    if (ts.isArrayLiteralExpression(n)) return n.elements.flatMap(targets);
    if (ts.isObjectLiteralExpression(n)) return n.properties.flatMap((p) => (ts.isPropertyAssignment(p) ? targets(p.initializer) : ts.isShorthandPropertyAssignment(p) ? [p.name] : ts.isSpreadAssignment(p) ? targets(p.expression) : []));
    if (ts.isSpreadElement(n)) return targets(n.expression);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === K.EqualsToken) return targets(n.left);
    return [n];
  };
  const MUT = { Object: new Set(["assign", "defineProperty", "defineProperties", "setPrototypeOf"]), Reflect: new Set(["set", "defineProperty", "deleteProperty", "setPrototypeOf"]) };
  const GLOBALS = new Set(["globalThis", "window", "self", "global"]);
  /** `Object` / `Reflect` as written: bare, or `globalThis.Object`. */
  const builtinOf = (n0) => {
    const n = unwrap(n0);
    if (ts.isIdentifier(n) && MUT[n.text]) return n.text;
    if (ts.isPropertyAccessExpression(n) && MUT[n.name.text] && ts.isIdentifier(unwrap(n.expression)) && GLOBALS.has(unwrap(n.expression).text)) return n.name.text;
    return null;
  };
  // Names destructured from Object / Reflect: `const { assign, defineProperty: dp } = Object;`
  const localMethods = new Map();
  const collectAliases = (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name)) {
      const b = builtinOf(n.initializer);
      if (b) for (const el of n.name.elements) if (ts.isIdentifier(el.name)) localMethods.set(el.name.text, { obj: b, meth: (el.propertyName ?? el.name).text });
    }
    ts.forEachChild(n, collectAliases);
  };
  collectAliases(sf);
  const hit = (n, name, what) => out.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${name} is mutated at runtime (${what}) — its literal is no longer what renders`);
  /** The mutating call a callee names, and which argument is its target; null when it is not a mutator. */
  const mutator = (callee0) => {
    let c = unwrap(callee0);
    let viaCall = null;
    if (ts.isPropertyAccessExpression(c) && (c.name.text === "call" || c.name.text === "apply")) { viaCall = c.name.text; c = unwrap(c.expression); }
    let obj = null, meth = null;
    if (ts.isPropertyAccessExpression(c)) { obj = builtinOf(c.expression); meth = c.name.text; }
    else if (ts.isElementAccessExpression(c)) { obj = builtinOf(c.expression); meth = lit(c.argumentExpression); }
    else if (ts.isIdentifier(c) && localMethods.has(c.text)) ({ obj, meth } = localMethods.get(c.text));
    return obj && MUT[obj].has(meth) ? { label: `${obj}.${meth}`, viaCall } : null;
  };
  const visit = (n) => {
    if (ts.isBinaryExpression(n) && ASSIGN_TOKENS.has(n.operatorToken.kind)) {
      for (const t of targets(n.left)) for (const nm of names) if (refers(t, nm)) hit(n, nm, "assignment");
    } else if ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) && (n.operator === K.PlusPlusToken || n.operator === K.MinusMinusToken)) {
      for (const nm of names) if (refers(n.operand, nm)) hit(n, nm, "increment");
    } else if (ts.isDeleteExpression(n)) {
      for (const nm of names) if (refers(n.expression, nm)) hit(n, nm, "delete");
    } else if (ts.isCallExpression(n)) {
      const m = mutator(n.expression);
      if (m) {
        let target = m.viaCall === "apply" ? (n.arguments[1] && ts.isArrayLiteralExpression(unwrap(n.arguments[1])) ? unwrap(n.arguments[1]).elements[0] : null) : m.viaCall === "call" ? n.arguments[1] : n.arguments[0];
        if (target) for (const nm of names) if (refers(target, nm)) hit(n, nm, m.label + (m.viaCall ? `.${m.viaCall}` : ""));
      }
    } else if (ts.isElementAccessExpression(n)) {
      for (const nm of names) {
        if (!isRecordRef(n.expression, nm)) continue;
        const k = unwrap(n.argumentExpression);
        const plain = lit(k) !== null || ts.isIdentifier(k) || ((ts.isPropertyAccessExpression(k) || ts.isElementAccessExpression(k)) && !ts.isCallExpression(k));
        if (!plain) out.push(`line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}: ${nm} is indexed by a computed expression (a verdict remap) — only the verdict parameter, optionally cast, may index a judged Record`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** A judged Record, or a helper the tone module exports beside it, exported under another name (`export { A as B, B as A }`, `export { failModeTone as outcomeTone }`) is judged by its local name; refuse the alias. */
export function toneExportProblems(src, names0) {
  const sf = ts.createSourceFile("tone.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = [];
  // The judged Records and the helpers the module exports around them: an alias of any of them changes what call sites render.
  const names = [...names0, ...sf.statements.filter((st) => ts.isFunctionDeclaration(st) && st.name && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((st) => st.name.text)];
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const el of st.exportClause.elements) {
      const local = (el.propertyName ?? el.name).text, exported = el.name.text;
      if (local !== exported && (names.includes(local) || names.includes(exported))) out.push(`line ${sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1}: ${local} is exported as ${exported} — a judged Record is judged by its local name, so an export alias would swap which one renders`);
    }
  }
  return out;
}

/**
 * The stylesheets a tree actually loads: those a source file imports (`import
 * "./index.css"`, `"@/index.css"`), plus anything those `@import`. A stylesheet that
 * nothing loads cannot supply the floor, however many rules it holds.
 */
/** Every `<link>` that loads a stylesheet (the `rel` value is a token list: `rel=\" stylesheet\"`, `rel='alternate stylesheet'`, React 19's `precedence`). */
export function stylesheetLinks(text) {
  const out = [];
  for (const tag of text.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\}|([^\s>]+))/i.exec(tag);
    const tokens = (rel?.[1] ?? rel?.[2] ?? rel?.[3] ?? rel?.[4] ?? "").toLowerCase().split(/\s+/);
    if (!tokens.includes("stylesheet")) continue;
    out.push(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["']([^"']*)["']\s*\}|([^\s>]+))/i.exec(tag)?.slice(1).find((x) => x !== undefined) ?? "");
  }
  return out;
}

/** Font-package stylesheets declare `@font-face` only; the one package-specifier family the gate lets through (a named ceiling). */
const FONT_PACKAGE_CSS = /^@fontsource\//;
/** The only other `@import`s the gate lets through: Tailwind itself and its animation plugin, and the font host. */
const CSS_PACKAGE_IMPORTS = new Set(["tailwindcss", "tw-animate-css"]);
const FONT_HOST = /^https:\/\/fonts\.googleapis\.com\//;
export function loadedStylesheets(rootDir, sources, readFile = readFileSync) {
  const loaded = new Set();
  const errs = [];
  const unresolved = [];
  const add = (p) => { if (!loaded.has(p)) { loaded.add(p); return true; } return false; };
  const queue = [];
  const IMPORT_CSS = /\bimport\s*(?:[^;"'`]*?\bfrom\s*)?["']([^"']+\.css(?:[?#][^"']*)?)["']|\bimport\s*\(\s*["']([^"']+\.css(?:[?#][^"']*)?)["']\s*\)|\brequire\s*\(\s*["']([^"']+\.css(?:[?#][^"']*)?)["']\s*\)/g;
  for (const f of sources) {
    let text;
    try { text = stripComments(readFile(f, "utf8")); } catch (e) { errs.push(`${f}: ${e.code ?? e.message}`); continue; }
    for (const m of text.matchAll(IMPORT_CSS)) {
      const spec = (m[1] ?? m[2] ?? m[3]).replace(/[?#].*$/, "");
      if (spec.startsWith("@/")) { const p = join(rootDir, spec.slice(2)); if (add(p)) queue.push(p); }
      else if (/^\.{1,2}\//.test(spec)) { const p = join(dirname(f), spec); if (add(p)) queue.push(p); }
      else if (!FONT_PACKAGE_CSS.test(spec)) unresolved.push(`${f}: import of "${spec}"`);
    }
  }
  while (queue.length > 0) {
    const css = queue.shift();
    let text;
    try { text = readFile(css, "utf8"); } catch (e) { if (e.code !== "ENOENT") errs.push(`${css}: ${e.code ?? e.message}`); continue; }
    for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?/g)) {
      const spec = m[1];
      if (CSS_PACKAGE_IMPORTS.has(spec) || FONT_PACKAGE_CSS.test(spec) || FONT_HOST.test(spec)) continue;
      if (!/^\.{1,2}\//.test(spec)) { unresolved.push(`${css}: @import of "${spec}"`); continue; }
      // Tailwind resolves an extensionless relative import to the .css file beside it.
      const p = join(dirname(css), /\.[a-z]+$/i.test(spec) ? spec : `${spec}.css`);
      if (add(p)) queue.push(p);
    }
  }
  return { loaded, errs, unresolved };
}

/**
 * The files under `dir` matching `re`, plus every directory read that failed for a
 * reason other than ENOENT. A tree absent from this checkout is not a pass or a
 * fail; a tree that exists but cannot be read is neither, and is reported.
 */
function walk(dir, re = /\.tsx?$/, out = [], errs = [], fsx = { readdir: readdirSync, stat: statSync }) {
  let entries;
  try {
    entries = fsx.readdir(dir);
  } catch (e) {
    if (e.code !== "ENOENT") errs.push(`${dir}: ${e.code ?? e.message}`);
    return { files: out, errs };
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = fsx.stat(full); } catch (e) { errs.push(`${full}: ${e.code ?? e.message}`); continue; }
    if (st.isDirectory()) walk(full, re, out, errs, fsx);
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
    checks.push([`real tone module declares its expected Records and they pass the registry (${r.records} Record(s), ${r.entries} entr(ies)): ${rel}`, src !== null && r.entries >= 4 * Object.keys(TONE_EXPECTED[rel]).length && r.problems.length === 0]);
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
      const { cssRoots, discover, readFile, readdir, trees, toneModules: tm, ...planted } = plant;
      const files = { "a/src/lib/outcome-tone.ts": e2eTone, "a/src/index.css": e2eCss, "a/src/main.tsx": 'import "./index.css";\n', ...planted };
      for (const [f, text] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, f)), { recursive: true });
        if (text !== null && typeof text === "object" && "symlink" in text) symlinkSync(text.symlink, join(dir, f));
        else writeFileSync(join(dir, f), text);
      }
      const r = await runGate({
        root: dir, trees: trees ?? ["a/src"], toneModules: tm ?? { "a/src/lib/outcome-tone.ts": { OUTCOME_TONE: "text" } },
        cssRoots: cssRoots ?? ["a/src"], chartMapRequired: new Set(), discover: discover ?? null,
        readFile: readFile ? (f, enc) => readFile(f, enc, dir) : readFileSync,
        readdir: readdir ? (d, o) => readdir(d, o, dir) : readdirSync,
      });
      checks.push([`end to end: ${label}`, r.code === expectCode && [].concat(expectInErr).every((x) => r.err.join("\n").includes(x))]);
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

  // ── Round 3 (F1–F13) ────────────────────────────────────────────────────────
  const TREE_B_CHIP = 'export const C = () => <i className="bg-status-deny" />;\n';
  await e2e("F1: the Tailwind opacity form `bg-status-allow/5` is a different class and does not demand a bare rule", 0, "", { "a/src/Chip.tsx": 'export const C = () => <i className="border-status-allow/20 bg-status-allow/5 text-status-allow" />;\n' });
  await e2e("F1: a template form `bg-status-${v}` does demand the bare rules", 1, "no canonical .bg-status-", { "a/src/Chip.tsx": "export const C = ({ v }) => <i className={`bg-status-${v}`} />;\n" });
  await e2e("F1: a bare use beside the opacity form still demands the rules", 1, "no canonical .bg-status-", { "a/src/Chip.tsx": 'export const C = () => <i className="bg-status-step-up bg-status-allow/5" />;\n' });
  await e2e("F3: a mis-paired verdict ternary INSIDE a tone module exits 1", 1, "a branch on \"deny\" returns status-allow", { "a/src/lib/outcome-tone.ts": e2eTone + 'export function t2(outcome: string): string { return outcome === "deny" ? "text-status-allow" : outcome === "allow" ? "text-status-deny" : "text-status-restrict"; }\n' });
  await e2e("F3: a correctly paired helper inside a tone module still exits 0", 0, "", { "a/src/lib/outcome-tone.ts": e2eTone + 'export function t2(outcome: string): string { return outcome === "deny" ? "text-status-deny" : "text-status-restrict"; }\n' });
  const swappedMarks = 'const OUTCOME_CHART_MARK = { allow: { dataKey: "allow", token: "--decision-deny", pattern: "solid" }, "step-up": { dataKey: "stepUp", token: "--decision-review", pattern: "solid" }, restrict: { dataKey: "restrict", token: "--decision-deny", pattern: "hatch" }, deny: { dataKey: "deny", token: "--decision-allow", pattern: "solid" } };\nconst hatchPatternId = (o: string) => `h-${o}`;\nfunction chartFill(o: string) { const m = (OUTCOME_CHART_MARK as any)[o]; return m.pattern === "hatch" ? `url(#${hatchPatternId(o)})` : `hsl(var(${m.token}))`; }\nconst HATCH_PATTERN = { size: 4, stripeWidth: 2 };\nexport { OUTCOME_CHART_MARK, chartFill, hatchPatternId, HATCH_PATTERN };\n';
  await e2e("F4: a chart map exported through `export { … }` with swapped tokens exits 1", 1, "not its ratified", { "a/src/lib/outcome-tone.ts": e2eTone + swappedMarks });
  await e2e("F4: ...and the same module with sound tokens exits 0", 0, "", { "a/src/lib/outcome-tone.ts": e2eTone + swappedMarks.replace('token: "--decision-deny", pattern: "solid" }, "step-up"', 'token: "--decision-allow", pattern: "solid" }, "step-up"').replace('deny: { dataKey: "deny", token: "--decision-allow"', 'deny: { dataKey: "deny", token: "--decision-deny"') });
  await e2e("F5: a second app tree with a tone module the lists omit exits 1", 1, "missing from the gate's tone-module or tree list", { discover: "d", "d/other/src/lib/outcome-tone.ts": e2eTone, "a/x.txt": "x" });
  await e2e("F5: a second app tree with verdict CSS the stylesheet roots omit exits 1", 1, "missing from the gate's stylesheet roots", { discover: "d", "d/other/src/index.css": e2eCss });
  await e2e("F9: rules moved to a stylesheet NOTHING imports do not satisfy the floor", 1, "no canonical .text-status-allow rule in a stylesheet this tree loads", { "a/src/index.css": "/* nothing */", "a/src/index.backup.css": e2eCss });
  await e2e("F9: rules reached through an @import of the loaded stylesheet do satisfy it", 0, "", { "a/src/index.css": '@import "./tokens.css";\n', "a/src/tokens.css": e2eCss });
  await e2e("F12: a stylesheet root with sources but no stylesheet at all exits 1", 1, "no canonical .text-status-allow rule", { cssRoots: ["a/src", "b/src"], "b/src/x.tsx": "export const x = 1;\n" });
  await e2e("F11: a dangling symlink SOURCE file in a stylesheet root outside the trees is reported", 1, "b/src/dangling.tsx", { cssRoots: ["a/src", "b/src"], "b/src/main.tsx": 'import "./index.css";\n', "b/src/index.css": e2eCss, "b/src/dangling.tsx": { symlink: "/nonexistent-target.tsx" } });
  await e2e("F11: a dangling symlink stylesheet is reported, not skipped", 1, "dangling.css", { "a/src/dangling.css": { symlink: "/nonexistent-target.css" } });
  const denyRead = (suffix) => (f, enc, dir) => { if (f.endsWith(suffix)) throw Object.assign(new Error("EACCES: denied"), { code: "EACCES" }); return readFileSync(f, enc); };
  await e2e("F11/F12: an unreadable stylesheet exits 1, naming it", 1, "a/src/index.css — unreadable (EACCES)", { readFile: denyRead("index.css") });
  await e2e("F11/F12: an unreadable tone module exits 1, naming it", 1, "a/src/lib/outcome-tone.ts — unreadable (EACCES); a tone module that cannot be read", { readFile: denyRead("outcome-tone.ts") });
  await e2e("F11: an unreadable source file exits 1, reported by the inline scan AND the bg-status-* search", 1, ["a/src/Chip.tsx — unreadable (EACCES); not inline-scanned", "a/src/Chip.tsx — unreadable (EACCES); not searched for bg-status-* use"], { "a/src/Chip.tsx": TREE_B_CHIP, readFile: denyRead("Chip.tsx") });

  // F5 against the REAL lists: shortening them must fail, and the real run is a control.
  const real0 = await runGate(REAL_CONFIG);
  checks.push(["F5: the REAL config exits 0 inside the self-test (control)", real0.code === 0]);
  const real1 = await runGate({ ...REAL_CONFIG, cssRoots: TREES });
  checks.push(["F5: dropping signalgrid-app from the stylesheet roots exits 1", real1.code === 1 && real1.err.join("\n").includes("artifacts/signalgrid-app/src")]);
  const real2 = await runGate({ ...REAL_CONFIG, trees: TREES.filter((t) => !t.includes("mobile-pwa")) });
  checks.push(["F5: dropping the PWA from the trees exits 1", real2.code === 1 && real2.err.join("\n").includes("artifacts/signalgrid-mobile-pwa/src")]);
  const { [Object.keys(TONE_EXPECTED)[2]]: _dropped, ...fewer } = TONE_EXPECTED;
  const real3 = await runGate({ ...REAL_CONFIG, toneModules: fewer });
  checks.push(["F5: dropping the review tone module from the list exits 1", real3.code === 1 && real3.err.join("\n").includes("artifacts/signalgrid-review/src")]);
  // F3 / C2 units: branches inside a tone module, judged on the syntax tree.
  const bp = (body) => toneBranchProblems(`export type Outcome = "allow" | "step-up" | "restrict" | "deny";\nexport function t(outcome: string): string {\n${body}\n}\n`);
  checks.push(["C2: correctly paired arms pass (===, ==, !== with the verdict arm in the else, switch, reversed operands)", [
    'return outcome === "deny" ? "text-status-deny" : outcome === "allow" ? "text-status-allow" : "text-status-restrict";',
    'return outcome == "deny" ? "text-status-deny" : "text-status-restrict";',
    'return "deny" === outcome ? "text-status-deny" : "text-status-restrict";',
    'return outcome !== "deny" ? "text-status-allow" : "text-status-deny";',
    'switch (outcome) { case "deny": return "text-status-deny"; case "allow": return "text-status-allow"; default: return "text-status-restrict"; }',
    'if (outcome === "deny") { return "text-status-deny"; } return "text-status-restrict";',
    'return ["deny", "restrict"].includes(outcome) ? "text-status-restrict" : "text-status-allow";',
  ].every((b) => bp(b).length === 0)]);
  for (const [label, body] of [
    ["a mis-paired ternary", 'return outcome === "deny" ? "text-status-allow" : "text-status-restrict";'],
    ["reversed operands", 'return "deny" === outcome ? "text-status-allow" : "text-status-restrict";'],
    ["a compound condition", 'if (outcome === "deny" && outcome.length > 0) return "text-status-allow"; return "text-status-restrict";'],
    ["an intermediate constant", 'const DENY_TONE = "text-status-allow"; return outcome === "deny" ? DENY_TONE : "text-status-restrict";'],
    ["`!==` with swapped arms", 'return outcome !== "deny" ? "text-status-deny" : "text-status-allow";'],
    ["`!==` with the verdict class in the wrong arm", 'return outcome !== "deny" ? OUT[outcome] : "text-status-allow";'],
    ["a parenthesised value", 'return outcome === "deny" ? ("text-status-allow") : "text-status-restrict";'],
    ["a concatenated value", 'return outcome === "deny" ? "text-status-" + "allow" : "text-status-restrict";'],
    ["a backtick key", 'return outcome === `deny` ? "text-status-allow" : "text-status-restrict";'],
    ["`.includes()`", 'return ["deny"].includes(outcome) ? "text-status-allow" : "text-status-restrict";'],
    ["a statement before the return", 'if (outcome === "deny") { const c = "text-status-allow"; return c; } return "text-status-restrict";'],
    ["an `if … return` without braces", 'if (outcome === "deny") return "text-status-allow"; return "text-status-restrict";'],
    ["a `case … return`", 'switch (outcome) { case "deny": return "text-status-allow"; default: return "text-status-restrict"; }'],
    ["a fallthrough case", 'switch (outcome) { case "deny": case "allow": return "text-status-step-up"; default: return "text-status-restrict"; }'],
    ["a `==` test", 'return outcome == "deny" ? "text-status-allow" : "text-status-restrict";'],
    ["a negation", 'return !(outcome === "deny") ? "text-status-restrict" : "text-status-allow";'],
    ["a verdict literal built by concatenation", 'return outcome === "de" + "ny" ? "text-status-allow" : "text-status-restrict";'],
    ["a class built at runtime (concatenation)", 'return "text-status-" + outcome;'],
    ["a class built at runtime (template)", 'return `text-status-${outcome}`;'],
    ["a status class assigned outside any branch", 'const x = "bg-status-deny"; return x;'],
  ]) {
    checks.push([`C2 MUTANT ${label} is RED`, bp(body).length >= 1]);
  }
  checks.push(["C2: a branch on a non-verdict literal is not judged (failMode)", bp('return outcome === "fail-closed" ? "text-status-allow" : "text-status-deny";').length === 0]);
  checks.push(["C2: a restrictive `??` fallback is left to its own direction rule", bp('return MAP[outcome] ?? "text-status-restrict";').length === 0]);
  checks.push(["C2: an object property is judged by its verdict key (stepUp spelling too)", toneBranchProblems('const X = { stepUp: "text-status-restrict", deny: "text-status-deny" };').length === 1]);
  checks.push(["C2: a status class in a COMMENT is not code", toneBranchProblems('// outcome === "deny" ? "text-status-allow"\nexport const y = 1;').length === 0]);
  // C3: tone Record entries must be complete canonical class tokens of the right kind.
  const exp = { OUTCOME_TONE: "text" };
  const r3 = (entry) => toneRecordProblems(goodRecord.replace('deny: "text-status-deny"', entry), exp).problems;
  for (const [label, entry] of [
    ["an opacity suffix", 'deny: "text-status-deny/0"'],
    ["a variant prefix", 'deny: "hover:text-status-deny"'],
    ["an arbitrary important colour beside the class", 'deny: "text-status-deny !text-[hsl(var(--decision-allow))]"'],
    ["an extra utility beside the class", 'deny: "text-status-deny opacity-0"'],
    ["the wrong kind (bg in a text Record)", 'deny: "bg-status-deny"'],
    ["a longer class name", 'deny: "text-status-deny-x"'],
  ]) checks.push([`C3 MUTANT ${label} is RED`, r3(entry).length >= 1]);
  checks.push(["C3: the canonical class alone passes", r3('deny: "text-status-deny"').length === 0]);
  checks.push(["C3: every `bg-` value turned into `text-` in a bg Record is RED", toneRecordProblems(goodRecord.replace(/OUTCOME_TONE/, "BADGE"), { BADGE: "bg" }).problems.length >= 4]);
  checks.push(["C3: an unnamed Record still refuses a variant token", rp(`${goodRecord}\nconst U: Record<SimulatorOutcome, string> = { deny: "hover:text-status-deny" };`).some((m) => /not a complete canonical/.test(m))]);
  // F7/F8/F10 units.
  const cssRule = (decl) => `.text-status-deny { ${decl} }`;
  checks.push(["F7 MUTANT a bare var(--decision-*) (not a colour) is RED", cp(cssRule("color: var(--decision-deny);")).length === 1]);
  checks.push(["F7 MUTANT a var() fallback chain is RED", cp(cssRule("color: hsl(var(--evil, var(--decision-deny)));")).length === 1]);
  checks.push(["F7 MUTANT color-mix() is RED", cp(cssRule("color: color-mix(in srgb, hsl(var(--decision-deny)), red);")).length === 1]);
  checks.push(["F7 MUTANT a longer token name (--decision-deny-x) is RED", cp(cssRule("color: hsl(var(--decision-deny-x));")).length === 1]);
  checks.push(["F7 MUTANT a --decision-* re-declared inside the rule is RED", cp(cssRule("--decision-deny: var(--decision-allow); color: hsl(var(--decision-deny));")).some((m) => /re-declares/.test(m))]);
  checks.push(["F4: a text colour at full alpha (`/ 1`, `/ 100%`) is accepted", cp(cssRule("color: hsl(var(--decision-deny) / 1);")).length === 0 && cp(cssRule("color: hsl(var(--decision-deny) / 100%);")).length === 0]);
  checks.push(["F4 MUTANT a text colour at alpha 0 or 0.5 is RED (invisible or faded)", cp(cssRule("color: hsl(var(--decision-deny) / 0);")).length === 1 && cp(cssRule("color: hsl(var(--decision-deny) / 0.5);")).length === 1]);
  checks.push(["F4 MUTANT a fill at alpha 0 / 0% is RED, a border at alpha 0 is RED", cp(goodCss.replace("background-color: hsl(var(--decision-deny) / 0.08)", "background-color: hsl(var(--decision-deny) / 0%)")).length === 1 && cp(goodCss.replace(".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08);", ".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08); border-color: hsl(var(--decision-deny) / 0);")).length === 1]);
  checks.push(["F4: a fill with a small positive alpha is accepted", cp(goodCss).length === 0]);
  checks.push(["F8 MUTANT an earlier !important wins over a later plain declaration (RED)", cp(cssRule("color: hsl(var(--decision-allow)) !important; color: hsl(var(--decision-deny));")).some((m) => /paints --decision-allow/.test(m))]);
  checks.push(["F8: an earlier !important DENY wins over a later wrong plain one (passes)", cp(cssRule("color: hsl(var(--decision-deny)) !important; color: hsl(var(--decision-allow));")).length === 0]);
  checks.push(["F10 MUTANT a `background` shorthand in a .bg-status-* rule is RED", cp(goodCss.replace(".bg-status-deny { background-color:", ".bg-status-deny { background: red; background-color:")).some((m) => /not one of the colour properties/.test(m))]);
  checks.push(["F10 MUTANT a `border` shorthand in a .bg-status-* rule is RED", cp(goodCss.replace(".bg-status-deny { background-color:", ".bg-status-deny { border: 1px solid hsl(var(--decision-allow)); background-color:")).some((m) => /not one of the colour properties/.test(m))]);
  checks.push(["F10 MUTANT an `all` shorthand in a .text-status-* rule is RED", cp(cssRule("all: unset; color: hsl(var(--decision-deny));")).some((m) => /not one of the colour properties/.test(m))]);
  // F9 unit.
  const fakeFs = { "/r/main.tsx": 'import "./index.css";', "/r/index.css": '@import "./tok.css";', "/r/tok.css": "", "/r/x.tsx": 'import "@/other.css";', "/r/other.css": "" };
  const ls = loadedStylesheets("/r", ["/r/main.tsx", "/r/x.tsx"], (f) => { if (f in fakeFs) return fakeFs[f]; throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
  checks.push(["F9: loaded stylesheets follow imports, `@/` aliases and @import", [...ls.loaded].sort().join() === "/r/index.css,/r/other.css,/r/tok.css" && ls.errs.length === 0]);

  // ── Round 4 (C1–C3, L1–L6) ──────────────────────────────────────────────────
  // C1: CSS property names are case-insensitive.
  for (const decl of ["COLOR: hsl(var(--decision-allow));", "Color: hsl(var(--decision-allow));"]) {
    checks.push([`C1 MUTANT a later \`${decl.split(":")[0]}\` declaration overriding the first is RED`, cp(cssRule("color: hsl(var(--decision-deny)); " + decl)).some((m) => /paints --decision-allow/.test(m))]);
  }
  checks.push(["C1 MUTANT BACKGROUND-COLOR upper-case wrong token in a .bg-status-* rule is RED", cp(goodCss.replace(".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08);", ".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08); BACKGROUND-COLOR: hsl(var(--decision-allow) / 0.08);")).some((m) => /paints --decision-allow/.test(m))]);
  checks.push(["C1 MUTANT BORDER-COLOR upper-case wrong token is RED", cp(goodCss.replace(".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08);", ".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08); BORDER-COLOR: hsl(var(--decision-allow) / 0.2);")).some((m) => /border-color paints/.test(m))]);
  for (const sh of ["BACKGROUND: red;", "BORDER: 1px solid hsl(var(--decision-allow));", "Background: red;"]) {
    checks.push([`C1 MUTANT \`${sh.split(":")[0]}\` shorthand in a .bg-status-* rule is RED`, cp(goodCss.replace(".bg-status-deny { background-color:", `.bg-status-deny { ${sh} background-color:`)).some((m) => /not one of the colour properties/.test(m))]);
  }
  checks.push(["C1 MUTANT `ALL: unset` in a text rule is RED", cp(cssRule("ALL: unset; color: hsl(var(--decision-deny));")).some((m) => /not one of the colour properties/.test(m))]);
  checks.push(["C1 MUTANT `!IMPORTANT` upper-case still wins the cascade (RED)", cp(cssRule("color: hsl(var(--decision-allow)) !IMPORTANT; color: hsl(var(--decision-deny));")).some((m) => /paints --decision-allow/.test(m))]);
  checks.push(["C1: an upper-case function name is the same colour (HSL(VAR(...)) passes)", cp(cssRule("color: HSL(VAR(--decision-deny));")).length === 0]);
  checks.push(["C1 MUTANT an upper-case token name is a different custom property (RED)", cp(cssRule("color: hsl(var(--Decision-Deny));")).length === 1]);
  // L1: shapes the parser could not see.
  checks.push(["L1 MUTANT an escaped selector (.text-status-\\64 eny) is RED", cp(goodCss + "\n.text-status-\\64 eny { color: hsl(var(--decision-allow)); }").some((m) => /canonical/.test(m))]);
  checks.push(["L1 MUTANT a [class*=…] attribute selector with a body is RED", cp(goodCss + '\n[class*="xt-status-den"] { color: hsl(var(--decision-allow)); }').some((m) => /canonical/.test(m))]);
  checks.push(["L1: a `{` inside a string does not hide the next rule", cp(`.x { content: "{"; }\n${goodCss.replace("hsl(var(--decision-deny));", "hsl(var(--decision-allow));")}`).length >= 1 && cssToneProblems(`.x { content: "{"; }\n${goodCss}`).rules === 6]);
  checks.push(["L1 MUTANT a nested style rule inside a verdict rule is RED", cp(goodCss.replace(".text-status-deny { color: hsl(var(--decision-deny)); }", ".text-status-deny { color: hsl(var(--decision-deny)); &.never { color: hsl(var(--decision-allow)); } }")).some((m) => /nested/.test(m))]);
  checks.push(["L1 MUTANT a verdict rule nested inside another style rule is RED", cp(".wrap { .text-status-deny { color: hsl(var(--decision-allow)); } }").some((m) => /nested inside another style rule/.test(m))]);
  checks.push(["L1: a verdict rule inside @media or @layer is a flat rule and is judged", cp("@media (min-width: 1px) { .text-status-deny { color: hsl(var(--decision-allow)); } }").some((m) => /paints --decision-allow/.test(m)) && cp("@layer base { .text-status-deny { color: hsl(var(--decision-deny)); } }").length === 0]);
  for (const decl of ["-webkit-text-fill-color: hsl(var(--decision-allow))", "text-shadow: 0 0 1px red", "filter: hue-rotate(90deg)", "opacity: 0", "mask: none"]) {
    checks.push([`L1 MUTANT \`${decl.split(":")[0]}\` in a .text-status-* rule is RED`, cp(cssRule(`color: hsl(var(--decision-deny)); ${decl};`)).some((m) => /not one of the colour properties/.test(m))]);
  }
  for (const decl of ["border-left: 1px solid red", "background-image: none"]) {
    checks.push([`L1 MUTANT \`${decl.split(":")[0]}\` in a .bg-status-* rule is RED`, cp(goodCss.replace(".bg-status-deny { background-color:", `.bg-status-deny { ${decl}; background-color:`)).some((m) => /not one of the colour properties/.test(m))]);
  }
  checks.push(["L1: unbalanced braces make the stylesheet unjudgeable (RED)", cp(goodCss + "\n}").some((m) => /braces do not balance/.test(m))]);
  checks.push(["O4: a text rule using the on-tint token is RED", cp(cssRule("color: hsl(var(--decision-deny-on-tint));")).length === 1]);
  checks.push(["O4: a bg border-color using the on-tint token is RED", cp(goodCss.replace(".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08);", ".bg-status-deny { background-color: hsl(var(--decision-deny) / 0.08); border-color: hsl(var(--decision-deny-on-tint));")).length === 1]);
  // L2/L3/L4 and the wiring (L5), end to end.
  const soundMarks = swappedMarks.replace('token: "--decision-deny", pattern: "solid" }, "step-up"', 'token: "--decision-allow", pattern: "solid" }, "step-up"').replace('deny: { dataKey: "deny", token: "--decision-allow"', 'deny: { dataKey: "deny", token: "--decision-deny"');
  await e2e("L2: a stylesheet a tree imports from OUTSIDE its root is judged (wrong token exits 1)", 1, "a/shared.css", { "a/src/main.tsx": 'import "./index.css";\nimport "../shared.css";\n', "a/shared.css": ".text-status-deny { color: hsl(var(--decision-allow)); }\n" });
  await e2e("L2/O9: an unreadable outside-root stylesheet is reported", 1, "a/shared.css: EACCES", { "a/src/main.tsx": 'import "./index.css";\nimport "../shared.css";\n', "a/shared.css": e2eCss, readFile: denyRead("shared.css") });
  await e2e("L2: an imported stylesheet that does not exist is reported", 1, "does not exist", { "a/src/main.tsx": 'import "./index.css";\nimport "../missing.css";\n' });
  await e2e("L3: `\"bg-status-\" + outcome` in a tree with no .bg-status-* rules exits 1", 1, "no canonical .bg-status-", { "a/src/Chip.tsx": 'export const C = ({ outcome }) => <i className={"bg-status-" + outcome} />;\n' });
  await e2e("L3: `` `bg-status-` + v `` exits 1 too", 1, "no canonical .bg-status-", { "a/src/Chip.tsx": "export const C = ({ v }) => <i className={`bg-status-` + v} />;\n" });
  await e2e("L4: `OUTCOME_TONE.deny = …` in a page exits 1", 1, "OUTCOME_TONE is mutated at runtime", { "a/src/Page.tsx": 'import { OUTCOME_TONE } from "./lib/outcome-tone";\nOUTCOME_TONE.deny = "text-status-allow";\n' });
  await e2e("L4: `Object.assign(OUTCOME_TONE, …)` in the tone module exits 1", 1, "OUTCOME_TONE is mutated at runtime", { "a/src/lib/outcome-tone.ts": e2eTone + 'Object.assign(OUTCOME_TONE, { deny: "text-status-allow" });\n' });
  await e2e("L4: reading OUTCOME_TONE (an `==` comparison, an index) is not a mutation", 0, "", { "a/src/Page.tsx": 'import { OUTCOME_TONE } from "./lib/outcome-tone";\nexport const same = OUTCOME_TONE.deny == OUTCOME_TONE.allow;\nexport const g = OUTCOME_TONE["deny"];\n' });
  await e2e("C2: a mis-paired reversed-operand ternary inside the tone module exits 1", 1, "a branch on \"deny\" returns status-allow", { "a/src/lib/outcome-tone.ts": e2eTone + 'export function t3(outcome: string): string { return "deny" === outcome ? "text-status-allow" : "text-status-restrict"; }\n' });
  await e2e("C2: the correct `!==` form exits 0", 0, "", { "a/src/lib/outcome-tone.ts": e2eTone + 'export function t4(outcome: string): string { return outcome !== "deny" ? "text-status-allow" : "text-status-deny"; }\n' });
  await e2e("C3: `deny: \"text-status-deny/0\"` in the expected Record exits 1", 1, "text-status-deny/0", { "a/src/lib/outcome-tone.ts": e2eTone.replace('deny: "text-status-deny"', 'deny: "text-status-deny/0"') });
  await e2e("C3: a bg class in a text Record exits 1", 1, "expected exactly `text-status-deny`", { "a/src/lib/outcome-tone.ts": e2eTone.replace('deny: "text-status-deny"', 'deny: "bg-status-deny"') });
  await e2e("O12: the chart-site lane — a verdict-keyed <Bar> in a tree with a chart map exits 1", 1, "keyed on a verdict literal", { "a/src/lib/outcome-tone.ts": e2eTone + soundMarks, "a/src/Chart.tsx": 'import { Bar, Legend, Tooltip } from "recharts";\nimport { OUTCOME_CHART_MARK } from "./lib/outcome-tone";\nexport const C = () => <><Tooltip /><Legend /><Bar dataKey="deny" /></>;\n' });
  await e2e("O12: ...and the same tree with a sound chart map and no bad site exits 0", 0, "", { "a/src/lib/outcome-tone.ts": e2eTone + soundMarks });
  await e2e("O16: the `??` direction lane — a neutral fallback in a tone module exits 1", 1, "is not a restrictive token", { "a/src/lib/outcome-tone.ts": e2eTone.replace('?? "text-status-restrict"', '?? "text-muted-foreground"') });
  await e2e("O13: a scan that reads no source file at all is refused", 1, "refusing to report a pass from a scan that read nothing", { trees: ["a/empty"] });
  await e2e("O8: an unreadable stylesheet in a tree the lists omit still demands the root (discover fails closed)", 1, "missing from the gate's stylesheet roots", { discover: "d", "d/other/src/index.css": e2eCss, readFile: denyRead("d/other/src/index.css") });
  await e2e("O19: an unreadable discover directory is reported", 1, "d — unreadable (EACCES)", { discover: "d", "d/x/readme.txt": "x", readdir: (dir, o, root) => { if (dir === join(root, "d")) throw Object.assign(new Error("denied"), { code: "EACCES" }); return readdirSync(dir, o); } });
  await e2e("O11: a tree directory failing with EACCES is reported, not skipped as absent", 1, "a/src/lib: EACCES", { readdir: (dir, o, root) => { if (dir === join(root, "a/src/lib")) throw Object.assign(new Error("denied"), { code: "EACCES" }); return readdirSync(dir, o); } });
  // F7: the ceilings agree, item by item and in both directions, between this file's header, the printed footer,
  // plan row 168 (bounded at the next numbered row) and the backlog row for the inline scan.
  {
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    const header = self.slice(0, self.indexOf('import { readFileSync'));
    const items = [...header.matchAll(/^\/\/\s+(\d+)\.\s([\s\S]*?)(?=^\/\/\s+\d+\.\s|^\/\/ Option \(b\))/gm)].map((m) => m[2].replace(/\n\/\/\s*/g, " "));
    const read = (f) => { try { return readFileSync(join(repo, f), "utf8"); } catch { return ""; } };
    const plan = read("docs/COMPANY_BUILD_PLAN.md");
    const start = plan.indexOf("\n168. **The palette gate");
    const next = plan.slice(start + 1).search(/\n\d+\. \*\*/);
    const row = start < 0 ? "" : plan.slice(start, next < 0 ? undefined : start + 1 + next);
    const list = (row.match(/printed by the gate \((\w+) items\):([\s\S]*?)(?:\. RE-MEASURED|$)/) ?? [])[2] ?? "";
    const marks = [...list.matchAll(/\((\d+)\)\s/g)].map((m) => Number(m[1]));
    const rowItems = list.split(/\(\d+\)\s/).slice(1);
    const backlog = read("docs/BUILD_BACKLOG.md");
    const bi = backlog.indexOf("- [ ] **The verdict-tone gate's inline scan");
    const bn = backlog.indexOf("\n- [", bi + 1);
    const backlogRow = bi < 0 ? "" : backlog.slice(bi, bn < 0 ? undefined : bn);
    checks.push([`ceilings: the header lists exactly ${CEILINGS.length} numbered items`, items.length === CEILINGS.length]);
    checks.push([`ceilings: plan row 168 lists exactly ${CEILINGS.length} items, numbered 1..${CEILINGS.length} in order`, marks.length === CEILINGS.length && marks.every((m, i) => m === i + 1)]);
    checks.push(["ceilings: the row's one-line count word matches", new RegExp(`\\(${["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][CEILINGS.length]} items\\)`).test(row)]);
    CEILINGS.forEach((c, i) => {
      checks.push([`ceiling ${i + 1}: every phrase is in its OWN header item, footer text and row item (${c.phrases[0]})`, c.phrases.every((ph) => (items[i] ?? "").includes(ph) && c.text.includes(ph) && (rowItems[i] ?? "").includes(ph))]);
      if (c.backlog) checks.push([`ceiling ${i + 1}: the backlog inline-scan row names it (${c.phrases[0]})`, c.phrases.some((ph) => backlogRow.includes(ph))]);
    });
    checks.push(["ceilings: the backlog inline-scan row exists and is bounded", backlogRow.length > 200]);
  }


  // ── Round 5 (F1–F13) ────────────────────────────────────────────────────────
  // F1: a test that names no verdict inherits the enclosing verdict arm.
  for (const [label, body] of [
    ["a nested non-verdict ternary", 'return outcome === "deny" ? (outcome.length > 0 ? "text-status-allow" : "text-status-deny") : "text-status-restrict";'],
    ["a nested non-verdict if", 'if (outcome === "deny") { if (outcome.length > 0) return "text-status-allow"; } return "text-status-restrict";'],
    ["a nested non-verdict switch", 'if (outcome === "deny") { switch (outcome.length) { case 4: return "text-status-allow"; } } return "text-status-restrict";'],
    ["a nested switch default", 'if (outcome === "deny") { switch (outcome.length) { default: return "text-status-allow"; } } return "text-status-restrict";'],
  ]) checks.push([`F1 MUTANT ${label} inside the deny arm is RED`, bp(body).length >= 1]);
  checks.push(["F1: a nested non-verdict branch that returns the verdict's own class passes", bp('return outcome === "deny" ? (outcome.length > 0 ? "text-status-deny" : "text-status-deny") : "text-status-restrict";').length === 0]);
  checks.push(["F1 (named ceiling): a non-verdict wrapper at the top level, outside any verdict arm, is not judged", bp('if (typeof outcome === "string") { const DENY_TONE = "text-status-allow"; return outcome === "deny" ? DENY_TONE : "text-status-restrict"; } return "text-status-restrict";').length === 0]);
  // F2: a set of verdicts passes a class only if every verdict in it owns that class's token.
  checks.push(["F2 MUTANT `[\"allow\",\"deny\"].includes()` with the allow class is RED", bp('return ["allow", "deny"].includes(outcome) ? "text-status-allow" : "text-status-restrict";').length >= 1]);
  checks.push(["F2 MUTANT `outcome === \"allow\" || outcome === \"deny\"` with the allow class is RED", bp('return outcome === "allow" || outcome === "deny" ? "text-status-allow" : "text-status-restrict";').length >= 1]);
  checks.push(["F2: {deny, restrict} with either of their classes passes (shared token)", bp('return ["deny", "restrict"].includes(outcome) ? "text-status-restrict" : "text-status-allow";').length === 0 && bp('return ["deny", "restrict"].includes(outcome) ? "text-status-deny" : "text-status-allow";').length === 0]);
  checks.push(["F2 MUTANT {deny, restrict} with the step-up class is RED", bp('return ["deny", "restrict"].includes(outcome) ? "text-status-step-up" : "text-status-allow";').length >= 1]);
  // F9: negation flips polarity; switch(true).
  checks.push(["F9: the correct `!(outcome === \"deny\")` and `![…].includes()` forms pass", bp('return !(outcome === "deny") ? "text-status-allow" : "text-status-deny";').length === 0 && bp('return !["deny"].includes(outcome) ? "text-status-allow" : "text-status-deny";').length === 0]);
  checks.push(["F9 MUTANT `!(outcome === \"deny\")` with the deny arm wrong is RED", bp('return !(outcome === "deny") ? "text-status-deny" : "text-status-allow";').length >= 1]);
  checks.push(["F9 MUTANT `switch (true) { case outcome === \"deny\": return … }` mis-paired is RED, paired passes", bp('switch (true) { case outcome === "deny": return "text-status-allow"; default: return "text-status-restrict"; }').length >= 1 && bp('switch (true) { case outcome === "deny": return "text-status-deny"; default: return "text-status-restrict"; }').length === 0]);
  // F10 plants.
  checks.push(["X1: the loose `!=` correct form passes, its swapped form is RED", bp('return outcome != "deny" ? "text-status-allow" : "text-status-deny";').length === 0 && bp('return outcome != "deny" ? "text-status-deny" : "text-status-allow";').length >= 1]);
  checks.push(["X26 MUTANT a MIXED test (a conditional used as the test) binds BOTH arms: the allow arm is RED", bp('return (outcome === "deny" ? false : true) ? "text-status-allow" : "text-status-deny";').length >= 1]);
  checks.push(["`A || flag`: the false arm needs neither verdict to be named, so it is not bound (correct code passes)", bp('return outcome === "deny" || flag ? "text-status-deny" : "text-status-allow";').length === 0]);
  checks.push(["X3 MUTANT the LAST important declaration wins, not the first (RED)", cp(cssRule("color: hsl(var(--decision-deny)) !important; color: hsl(var(--decision-allow)) !important;")).some((m) => /paints --decision-allow/.test(m)) && cp(cssRule("color: hsl(var(--decision-allow)) !important; color: hsl(var(--decision-deny)) !important;")).length === 0]);
  checks.push(["X4 MUTANT a text rule setting background-color is RED", cp(cssRule("color: hsl(var(--decision-deny)); background-color: red;")).some((m) => /not one of the colour properties/.test(m))]);
  checks.push(["X13 MUTANT an unnamed Record's `text-status-deny/0` is RED (complete token)", rp(`${goodRecord}\nconst U: Record<SimulatorOutcome, string> = { deny: "text-status-deny/0" };`).some((m) => /not a complete canonical/.test(m))]);
  checks.push(["F8: a four-verdict Record not listed in TONE_EXPECTED is RED (kind null is rejected by the lane)", toneRecordProblems(`${goodRecord}\nexport const OTHER: Record<Outcome, string> = { allow: "text-status-allow", "step-up": "text-status-step-up", restrict: "text-status-restrict", deny: "text-status-deny" };`, { OUTCOME_TONE: "text" }).problems.some((m) => /OTHER is a four-verdict Record that is not listed/.test(m))]);
  checks.push(["F8 MUTANT an export alias swapping two judged Records is RED", toneExportProblems("export { A as B, B as A };", ["A", "B"]).length === 2 && toneExportProblems("export { A as Z };", ["A"]).length === 1 && toneExportProblems("export { A };", ["A"]).length === 0]);
  checks.push(["INFO: a parse error in a tone module is reported by the syntax-tree judge itself", toneBranchProblems("export const z = ;").some((m) => /parse error/.test(m))]);
  // F3: CSS shapes.
  const hexName = [..."text-status-deny"].map((ch) => `\\${ch.codePointAt(0).toString(16)} `).join("").trim();
  checks.push(["F3 MUTANT a per-letter escaped selector is RED", cp(`${goodCss}\n.t\\65xt-st\\61tus-d\\65ny { color: hsl(var(--decision-allow)); }`).some((m) => /canonical/.test(m))]);
  checks.push(["F3 MUTANT a fully hex-escaped selector is RED", cp(`${goodCss}\n.${hexName} { color: hsl(var(--decision-allow)); }`).some((m) => /canonical/.test(m))]);
  checks.push(["F3 MUTANT a `/*` inside a string does not swallow the next rule (RED, and the rule is still judged)", cp('.x::before { content: "/*"; }\n.text-status-deny { color: hsl(var(--decision-allow)); }\n.y::before { content: "*/"; }').some((m) => /paints --decision-allow/.test(m))]);
  checks.push(["F3 MUTANT namespaced attribute selectors `[*|class*=…]` and `[|class*=…]` are RED", cp(`${goodCss}\n[*|class*="xt-status-den"] { color: hsl(var(--decision-allow)); }`).some((m) => /canonical/.test(m)) && cp(`${goodCss}\n[|class*="xt-status-den"] { color: hsl(var(--decision-allow)); }`).some((m) => /canonical/.test(m))]);
  checks.push(["F3: an unterminated comment or string makes the stylesheet unjudgeable (RED)", cp(`${goodCss}\n/* never closed`).some((m) => /unterminated/.test(m)) && cp(`${goodCss}\n.x { content: "never closed;\n}`).some((m) => /unterminated/.test(m))]);
  checks.push(["F3: an unrelated escaped selector (`.sm\\:flex`) is not a verdict mention", cp(`${goodCss}\n.sm\\:flex { display: flex; }`).length === 0]);
  // F5: stylesheets the gate cannot reach.
  const ls5 = (files, srcs) => loadedStylesheets("/r", srcs, (f) => { if (f in files) return files[f]; throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
  checks.push(["F5 MUTANT a package-specifier stylesheet import is reported as unresolved", ls5({ "/r/main.tsx": 'import "@workspace/api/verdict.css";' }, ["/r/main.tsx"]).unresolved.length === 1]);
  checks.push(["F5 MUTANT a dynamic `import(\"x.css\")` and a `require` are seen", ls5({ "/r/m.tsx": 'import("@w/a.css"); require("@w/b.css");' }, ["/r/m.tsx"]).unresolved.length === 2]);
  checks.push(["F5: the font-package family is the one specifier let through", ls5({ "/r/m.tsx": 'import "@fontsource/inter/400.css";' }, ["/r/m.tsx"]).unresolved.length === 0]);
  checks.push(["F5 MUTANT an unquoted `@import url(../x.css)` is followed, a package one is reported", [...ls5({ "/r/m.tsx": 'import "./i.css";', "/r/i.css": "@import url(./x.css); @import url(pkg/y.css);" }, ["/r/m.tsx"]).loaded].includes("/r/x.css") && ls5({ "/r/m.tsx": 'import "./i.css";', "/r/i.css": "@import url(pkg/y.css);" }, ["/r/m.tsx"]).unresolved.length === 1]);
  await e2e("F5: a package-specifier stylesheet in main.tsx exits 1", 1, "cannot resolve", { "a/src/main.tsx": 'import "./index.css";\nimport "@workspace/api/verdict.css";\n' });
  await e2e("F5: a font-package stylesheet import still exits 0", 0, "", { "a/src/main.tsx": 'import "./index.css";\nimport "@fontsource/inter/400.css";\n' });
  await e2e("F5: a <link rel=stylesheet> in index.html (not the font host) exits 1", 1, "which this gate cannot judge", { "a/index.html": '<html><head><link rel="stylesheet" href="/overrides.css"></head></html>' });
  await e2e("F5: the font host <link> in index.html is allowed", 0, "", { "a/index.html": '<html><head><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></head></html>' });
  await e2e("F5: an inline <style> block in a page exits 1", 1, "inline <style> block", { "a/src/Page.tsx": "export const P = () => <style>{`.text-status-deny{color:red}`}</style>;\n" });
  await e2e("F5: an inline <style> in index.html exits 1", 1, "inline <style> block", { "a/index.html": "<html><style>.text-status-deny{color:red}</style></html>" });
  // F6: every spelling of a runtime write to a judged Record.
  const mp = (code, file) => mutationProblems(code, ["OUTCOME_TONE"], file);
  for (const [label, code, file] of [
    ["Reflect.set", 'Reflect.set(OUTCOME_TONE, "deny", "x");'],
    ["a namespace import member", 'import * as T from "./tone"; T.OUTCOME_TONE.deny = "x";'],
    ["destructuring assignment (array)", '[OUTCOME_TONE.deny] = ["x"];'],
    ["destructuring assignment (object)", '({ a: OUTCOME_TONE.deny } = { a: "x" });'],
    ["Object[\"assign\"]", 'Object["assign"](OUTCOME_TONE, { deny: "x" });'],
    ["a bracketed write", 'OUTCOME_TONE["deny"] = "x";'],
    ["a compound write", 'OUTCOME_TONE.deny += "x";'],
    ["Object.defineProperty", 'Object.defineProperty(OUTCOME_TONE, "deny", { value: "x" });'],
    ["delete", 'delete OUTCOME_TONE.deny;'],
    ["a bracketed namespace member", 'import * as T from "./tone"; T["OUTCOME_TONE"].deny = "x";'],
    ["a write in a .js file", 'OUTCOME_TONE.deny = "x";', "x.js"],
    ["a write in a .mjs file", 'OUTCOME_TONE.deny = "x";', "x.mjs"],
  ]) checks.push([`F6 MUTANT ${label} is RED`, mp(code, file).length >= 1]);
  checks.push(["F6: reads of a judged Record are not mutations", mp('const a = OUTCOME_TONE.deny; if (OUTCOME_TONE.deny == OUTCOME_TONE.allow) {} const b = OUTCOME_TONE["deny"]; const { deny } = OUTCOME_TONE; foo(OUTCOME_TONE);').length === 0]);
  await e2e("F6: `Reflect.set(OUTCOME_TONE, …)` in a page exits 1", 1, "OUTCOME_TONE is mutated at runtime", { "a/src/Page.jsx": 'import { OUTCOME_TONE } from "./lib/outcome-tone";\nReflect.set(OUTCOME_TONE, "deny", "text-status-allow");\n' });
  // L3 spellings of a concatenated bg-status class.
  await e2e("L3: `'bg-status-'.concat(v)` exits 1", 1, "no canonical .bg-status-", { "a/src/Chip.tsx": "export const C = ({ v }) => <i className={'bg-status-'.concat(v)} />;\n" });
  await e2e("L3: `['bg-status', v].join('-')` exits 1", 1, "no canonical .bg-status-", { "a/src/Chip.tsx": "export const C = ({ v }) => <i className={['bg-status', v].join('-')} />;\n" });
  // X24: the bg floor demands every verdict's rule, not only deny's.
  await e2e("X24: a bare `bg-status-step-up` use with only that bg rule missing exits 1", 1, "no canonical .bg-status-step-up", { "a/src/Chip.tsx": 'export const C = () => <i className="bg-status-step-up" />;\n', "a/src/index.css": `${e2eCss}\n${e2eBg.split("\n").filter((l) => !l.startsWith(".bg-status-step-up")).join("\n")}` });
  // F8 through the lane.
  await e2e("F8: an expected Record listed without a kind exits 1", 1, "listed without a class kind", { toneModules: { "a/src/lib/outcome-tone.ts": { OUTCOME_TONE: null } } });
  await e2e("F8: an export alias swapping the expected Record's name exits 1", 1, "is exported as", { "a/src/lib/outcome-tone.ts": e2eTone.replace("export const OUTCOME_TONE", "const OUTCOME_TONE") + 'export { OUTCOME_TONE as OTHER_NAME };\n' });
  const real4 = await runGate({ ...REAL_CONFIG, toneModules: Object.fromEntries(Object.entries(TONE_EXPECTED).map(([m, e]) => [m, Object.fromEntries(Object.entries(e).filter(([n]) => n !== "VERDICT_TEXT_TONE"))])) });
  checks.push(["F8: dropping VERDICT_TEXT_TONE from the expected list makes the real run exit 1 (the Record is then unlisted)", real4.code === 1 && real4.err.join("\n").includes("VERDICT_TEXT_TONE is a four-verdict Record that is not listed")]);
  const real5 = await runGate({ ...REAL_CONFIG, toneModules: Object.fromEntries(Object.entries(TONE_EXPECTED).map(([m, e]) => [m, Object.fromEntries(Object.entries(e).map(([n]) => [n, null]))])) });
  checks.push(["F8: loosening every expected kind to null makes the real run exit 1", real5.code === 1 && real5.err.join("\n").includes("listed without a class kind")]);

  // ── Round 6 (F1–F9) ─────────────────────────────────────────────────────────
  // F1: a nested verdict test narrows the enclosing verdict arm; it never replaces it.
  for (const [label, body] of [
    ["a non-subject nested test (`previous === \"allow\"`)", 'return outcome === "deny" ? (previous === "allow" ? "text-status-allow" : "text-status-deny") : "text-status-restrict";'],
    ["a contradictory nested test", 'return outcome === "deny" ? (outcome === "allow" ? "text-status-allow" : "text-status-allow") : "text-status-restrict";'],
    ["a nested if/else on another verdict", 'if (outcome === "deny") { if (outcome === "restrict") { return "text-status-restrict"; } else { return "text-status-allow"; } } return "text-status-restrict";'],
    ["a nested negative test", 'return outcome === "deny" ? (outcome !== "allow" ? "text-status-allow" : "text-status-allow") : "text-status-restrict";'],
  ]) checks.push([`F1 MUTANT ${label} inside the deny arm is RED`, bp(body).length >= 1]);
  checks.push(["F1: a nested test that narrows a verdict SET to one of its members passes with that member's class", bp('return ["deny", "restrict"].includes(outcome) ? (outcome === "deny" ? "text-status-deny" : "text-status-restrict") : "text-status-allow";').length === 0]);
  // F2: polarity and subject.
  checks.push(["F2 (Codex): the correct `A && other !== \"allow\"` conjunction passes", bp('return outcome === "deny" && other !== "allow" ? "text-status-deny" : "text-status-restrict";').length === 0]);
  for (const [label, body] of [
    ["`&&` with an unknown conjunct: the else arm is reached by deny", 'return outcome === "deny" && flag ? "text-status-deny" : "text-status-allow";'],
    ["`&&` with a length test", 'return outcome === "deny" && outcome.length > 99 ? "text-status-deny" : "text-status-allow";'],
    ["`(outcome === \"deny\") === false`", 'return (outcome === "deny") === false ? "text-status-deny" : "text-status-allow";'],
    ["a conditional used as the test", 'return (outcome === "deny" ? false : true) ? "text-status-deny" : "text-status-allow";'],
    ["`includes() === false`", 'return ["deny"].includes(outcome) === false ? "text-status-deny" : "text-status-allow";'],
    ["a negated `switch (true)` case", 'switch (true) { case outcome !== "allow": return "text-status-allow"; default: return "text-status-restrict"; }'],
    ["a negated `switch (true)` case written with `!`", 'switch (true) { case !(outcome === "allow"): return "text-status-allow"; default: return "text-status-restrict"; }'],
    ["`||` with an allow literal", 'return outcome === "deny" || other === "allow" ? "text-status-allow" : "text-status-restrict";'],
  ]) checks.push([`F2 MUTANT ${label} is RED`, bp(body).length >= 1]);
  checks.push(["F2: a non-verdict literal mixed into `&&` does not bind (correct deny class passes)", bp('return outcome === "deny" && other === "fail-closed" ? "text-status-deny" : "text-status-restrict";').length === 0]);
  checks.push(["F2: an alias of the verdict parameter is the subject", bp('const o = outcome; return o === "deny" ? "text-status-allow" : "text-status-restrict";').length >= 1]);
  checks.push(["F2: a member chain of the parameter (`d.outcome`) is the subject", toneBranchProblems('export const f = (d: { outcome: string }) => d.outcome === "deny" ? "text-status-allow" : "text-status-restrict";').length >= 1]);
  // F3: a key remap before the lookup.
  const lp = (code) => mutationProblems(code, ["OUTCOME_TONE"], "x.ts");
  checks.push(["F3 MUTANT a conditional key remap (`OUTCOME_TONE[o === \"deny\" ? \"allow\" : o]`) is RED", lp('const x = OUTCOME_TONE[outcome === "deny" ? "allow" : outcome];').some((m) => /verdict remap/.test(m))]);
  checks.push(["F3 MUTANT an object-literal key remap is RED", lp('const x = OUTCOME_TONE[({ deny: "allow" } as Record<string, string>)[outcome] ?? outcome];').some((m) => /verdict remap/.test(m))]);
  checks.push(["F3 MUTANT a call or template key is RED", lp("const x = OUTCOME_TONE[remap(outcome)]; const y = OUTCOME_TONE[`${outcome}`];").length === 2]);
  checks.push(["F3: indexing by the parameter, a cast parameter, a member chain or a literal passes", lp('const a = OUTCOME_TONE[outcome]; const b = OUTCOME_TONE[outcome as Outcome]; const c = OUTCOME_TONE[d.outcome]; const e = OUTCOME_TONE["deny"];').length === 0]);
  await e2e("F3: a remapped lookup inside the tone module exits 1", 1, "verdict remap", { "a/src/lib/outcome-tone.ts": e2eTone + 'export function t5(outcome: string): string { return OUTCOME_TONE[outcome === "deny" ? "allow" : (outcome as Outcome)] ?? "text-status-restrict"; }\n' });
  await e2e("F1: a nested non-subject test inside the deny arm exits 1 (tone module)", 1, "returns status-allow", { "a/src/lib/outcome-tone.ts": e2eTone + 'export function t6(outcome: string, previous: string): string { return outcome === "deny" ? (previous === "allow" ? "text-status-allow" : "text-status-deny") : "text-status-restrict"; }\n' });
  await e2e("F2: the else arm of `deny && flag` exits 1 (tone module)", 1, "returns status-allow", { "a/src/lib/outcome-tone.ts": e2eTone + 'export function t7(outcome: string, flag: boolean): string { return outcome === "deny" && flag ? "text-status-deny" : "text-status-allow"; }\n' });
  // F5: stylesheets the gate follows or reports.
  checks.push(["F5 MUTANT an extensionless relative @import is followed to its .css", [...ls5({ "/r/m.tsx": 'import "./i.css";', "/r/i.css": '@import "./x";' }, ["/r/m.tsx"]).loaded].includes("/r/x.css")]);
  checks.push(["F5 MUTANT an extensionless PACKAGE @import is reported, tailwindcss / tw-animate-css / font hosts are not", ls5({ "/r/m.tsx": 'import "./i.css";', "/r/i.css": '@import "@workspace/verdict-overrides";' }, ["/r/m.tsx"]).unresolved.length === 1 && ls5({ "/r/m.tsx": 'import "./i.css";', "/r/i.css": '@import "tailwindcss"; @import "tw-animate-css"; @import url("https://fonts.googleapis.com/css2?family=Inter");' }, ["/r/m.tsx"]).unresolved.length === 0]);
  checks.push(["O13 MUTANT an absolute `@import \"/abs.css\"` is reported, not followed as a relative path", ls5({ "/r/m.tsx": 'import "./i.css";', "/r/i.css": '@import "/abs.css";' }, ["/r/m.tsx"]).unresolved.length === 1]);
  checks.push(["F5/O26 MUTANT `rel=\" stylesheet\"`, `rel='alternate stylesheet'`, an unquoted rel and React's `precedence` are all stylesheet links", stylesheetLinks('<link rel=" stylesheet" href="/a.css"><link rel=\'alternate stylesheet\' href=\'/b.css\'><link rel=stylesheet href=/c.css><link rel="stylesheet" href="/d.css" precedence="high" />').length === 4]);
  checks.push(["F5: a non-stylesheet link (icon, preconnect) is not a stylesheet link", stylesheetLinks('<link rel="icon" href="/f.ico"><link rel="preconnect" href="https://fonts.gstatic.com">').length === 0]);
  await e2e("F5: an extensionless relative @import of a wrong-token stylesheet exits 1", 1, "a/overrides.css", { "a/src/index.css": `@import "../overrides";\n${e2eCss}`, "a/overrides.css": ".text-status-deny { color: hsl(var(--decision-allow)) !important; }\n" });
  await e2e("F5: an extensionless package @import exits 1", 1, "cannot resolve", { "a/src/index.css": `@import "@workspace/verdict-overrides";\n${e2eCss}` });
  await e2e("F5: tailwindcss and tw-animate-css @imports still exit 0", 0, "", { "a/src/index.css": `@import "tailwindcss";\n@import "tw-animate-css";\n${e2eCss}` });
  await e2e("F5: a React 19 <link rel=stylesheet precedence> in a page exits 1", 1, "renders a <link rel=stylesheet>", { "a/src/Page.tsx": 'export const P = () => <link rel="stylesheet" href="/overrides.css" precedence="high" />;\n' });
  await e2e("O25: an index.html stylesheet link whose URL merely CONTAINS the font host exits 1", 1, "which this gate cannot judge", { "a/index.html": '<link rel="stylesheet" href="https://evil.example/fonts.googleapis.com/x.css">' });
  await e2e("O26: `rel=\" stylesheet\"` in index.html exits 1", 1, "which this gate cannot judge", { "a/index.html": '<link rel=" stylesheet" href="/overrides.css">' });
  // F6: spellings of a runtime write.
  for (const [label, code] of [
    ["Object.assign.call", 'Object.assign.call(null, OUTCOME_TONE, { deny: "x" });'],
    ["Object.assign.apply", 'Object.assign.apply(null, [OUTCOME_TONE, { deny: "x" }]);'],
    ["a comma-wrapped callee `(0, Object.assign)(…)`", '(0, Object.assign)(OUTCOME_TONE, { deny: "x" });'],
    ["`globalThis.Object.assign`", 'globalThis.Object.assign(OUTCOME_TONE, { deny: "x" });'],
    ["a destructured `assign`", 'const { assign } = Object; assign(OUTCOME_TONE, { deny: "x" });'],
    ["a destructured and renamed `defineProperty`", 'const { defineProperty: dp } = Reflect; dp(OUTCOME_TONE, "deny", { value: "x" });'],
    ["`satisfies`", '(OUTCOME_TONE satisfies Record<string, string>).deny = "x";'],
    ["a comma-wrapped target `(0, OUTCOME_TONE).deny = …`", '(0, OUTCOME_TONE).deny = "x";'],
    ["`Object.defineProperties` (O14)", 'Object.defineProperties(OUTCOME_TONE, { deny: { value: "x" } });'],
    ["`Reflect.defineProperty` (O15)", 'Reflect.defineProperty(OUTCOME_TONE, "deny", { value: "x" });'],
    ["`++` (O16)", 'OUTCOME_TONE.deny++;'],
    ["`&&=` (O17)", 'OUTCOME_TONE.deny &&= "x";'],
    ["a non-null target `OUTCOME_TONE!.deny = …` (O18)", 'OUTCOME_TONE!.deny = "x";'],
    ["`??=`", 'OUTCOME_TONE.deny ??= "x";'],
  ]) checks.push([`F6 MUTANT ${label} is RED`, mp(code).length >= 1]);
  // F8: the remaining self-test gaps, each with a flipping plant.
  checks.push(["O05 MUTANT one verdict does not accept a class that merely shares its token (`deny` with status-restrict) — RED", bp('return outcome === "deny" ? "text-status-restrict" : "text-status-allow";').length >= 1]);
  checks.push(["O07 MUTANT a CSS string that spans a newline is unterminated (RED)", cp('.x { content: "a\nb"; }').some((m) => /unterminated/.test(m))]);
  checks.push(["O22 MUTANT `!(outcome !== \"deny\")` flips a NEGATIVE test to positive: deny arm judged, wrong arm RED, right arm passes", bp('return !(outcome !== "deny") ? "text-status-deny" : "text-status-allow";').length === 0 && bp('return !(outcome !== "deny") ? "text-status-allow" : "text-status-deny";').length >= 1]);
  checks.push(["O23 MUTANT a `!` nested in a compound is counted: `deny && !flag` else arm needs deny's class (RED)", bp('return outcome === "deny" && !flag ? "text-status-deny" : "text-status-allow";').length >= 1]);
  checks.push(["O30 MUTANT the default bare `return` after a chain may be restrictive only (RED for allow, passes for restrict)", bp('if (outcome === "deny") return "text-status-deny"; return "text-status-allow";').length >= 1 && bp('if (outcome === "deny") return "text-status-deny"; return "text-status-restrict";').length === 0]);
  checks.push(["F4 (INFO): a fill below the minimum alpha (`/ 0.0001`) is RED, 0.08 passes", cp(goodCss.replace("/ 0.08)", "/ 0.0001)")).length >= 1 && cp(goodCss).length === 0]);
  checks.push(["INFO: an alias of an exported helper (`export { failModeTone as outcomeTone }`) is refused", toneExportProblems("export function outcomeTone() {}\nexport function failModeTone() {}\nexport { failModeTone as outcomeTone };", []).length === 1]);

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
 * What this gate does NOT judge. One list: it is printed on every passing run, and the self-test checks, in both
 * directions, that the header comment, this footer and plan row 168 carry the same items — the header has exactly
 * this many numbered items, and each item's `phrases` all appear in its header item, in its footer text and in the row.
 */
export const CEILINGS = [
  { phrases: ["restrict vs deny TOKENS"], text: "restrict vs deny TOKENS: they share --decision-deny by design (DR-005/006); they differ by class suffix and chart pattern only;" },
  { phrases: ["badge Records outside the three tone modules", "TONE_EXPECTED"], text: "badge Records outside the three tone modules, and any Record not named in TONE_EXPECTED or typed Record<…Outcome…, string> (e.g. CONNECTOR_DECISION_TONE); an unnamed Record is held to canonical class tokens but may carry extra utilities beside them;" },
  { backlog: true, phrases: ["default arm", "names no verdict on the verdict parameter", "falls into the next", "clsx", "aliased mutation"], text: "the default arm of a verdict branch and the complement arm of a negative test; every status class under a branch whose test names no verdict on the verdict parameter and that is not inside a verdict arm (`if (typeof x === 'string') { const DENY = … }`, `failMode === 'fail-closed'`); a switch clause that falls into the next with statements; and any verdict choice not made by an object property, a comparison, `.includes()` / `.has()` or a `switch` case — a class written before its comparison, `clsx({ … })` keys, an aliased mutation or a copy of a judged Record (`const t = OUTCOME_TONE; t.deny = …`, a spread, `structuredClone`);" },
  { phrases: ["desktop tree's chart"], text: "the desktop tree's chart (it exports no OUTCOME_CHART_MARK; its Dashboard carries literal fills) — chart sites are judged only where a tone module exports OUTCOME_CHART_MARK;" },
  { phrases: ["signalgrid-app's TSX", "new app tree"], text: "signalgrid-app's TSX (its stylesheet is judged, its sources are not inline-scanned: its LiveDecisionPanel map would trip the scan) and a new app tree with neither a tone module nor verdict CSS;" },
  { phrases: ["Tailwind theme", "opacity forms", "@fontsource", "workspace package"], text: "Tailwind theme/config colours, the Tailwind opacity forms (`bg-status-allow/5`) that no stylesheet rule generates (plan row 153), font-package stylesheets (`@fontsource/…`, @font-face only) and the Tailwind packages themselves (`tailwindcss`, `tw-animate-css`), the only package specifiers the gate lets through, and a stylesheet imported from inside a workspace package a tree depends on, which is not followed;" },
  { phrases: ["tokens' own values"], text: "the tokens' own values (check-decision-palette.mjs holds contrast and canon);" },
  { backlog: true, phrases: ["arbitrary-value, important or opacity override"], text: "an arbitrary-value, important or opacity override written beside a status class in a page (`className=\"text-status-deny !text-[hsl(var(--decision-allow))]\"`, `opacity-0`), which neither this gate nor check-decision-palette sees." },
];

/**
 * The gate itself, over injectable roots so the self-test can run the WHOLE lane
 * against a temp tree holding a planted defect (a gate whose wiring is untested
 * can have its exit condition deleted and still pass its own fixtures).
 *   root              repo root; every other path is relative to it
 *   trees             trees whose sources get the inline-decision scan and chart sites
 *   toneModules       { rel: [expected Record names] }
 *   cssRoots          trees whose stylesheets are judged against the registry
 *   chartMapRequired  tone modules that must carry a chart map
 *   discover          a directory of app trees to cross-check the lists above against
 *                     DISK: any app tree under it (its `src` folder) that holds a tone
 *                     module or verdict status CSS the lists omit fails the run, so the
 *                     lists cannot be shortened to make a tree stop being judged
 *   readFile          injectable reader, so a self-test can make a read fail
 */
export async function runGate(cfg) {
  const out = [], err = [];
  const log = (m = "") => out.push(m);
  const fail = (m = "") => err.push(m);
  const { root, trees, toneModules, cssRoots, chartMapRequired, discover = null, readFile = readFileSync, readdir = readdirSync } = cfg;
  const fsx = { readdir, stat: statSync };
  const rel = (f) => relative(root, f).split("\\").join("/");

  const walkErrs = [];
  const files = trees.flatMap((t) => {
    const r = walk(join(root, t), /\.(?:[cm]?js|jsx|tsx?)$/, [], [], fsx);
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
  const registryProblems = walkErrs.map((e) => `${e.replace(`${root}/`, "")} — unreadable; its sources were not judged`);
  let exempted = 0;

  /** Trees whose tone module declares a chart map; their chart sites are judged. */
  const chartTrees = [];
  let recordsJudged = 0, entriesJudged = 0;
  for (const mod of Object.keys(toneModules)) {
    let src;
    try {
      src = readFile(join(root, mod), "utf8");
    } catch (e) {
      registryProblems.push(`${mod} — unreadable (${e.code ?? e.message}); a tone module that cannot be read cannot be judged`);
      continue;
    }
    const r = toneRecordProblems(src, toneModules[mod]);
    recordsJudged += r.records;
    entriesJudged += r.entries;
    for (const msg of r.problems) registryProblems.push(`${mod}:${msg}`);
    for (const msg of toneBranchProblems(src)) registryProblems.push(`${mod}:${msg}`);
    const expectedMap = Array.isArray(toneModules[mod]) ? Object.fromEntries(toneModules[mod].map((n) => [n, null])) : toneModules[mod];
    for (const [n, kind] of Object.entries(expectedMap)) {
      if (kind !== "text" && kind !== "bg") registryProblems.push(`${mod}: ${n} is listed without a class kind (\`text\` or \`bg\`) — an unkinded Record is not held to one canonical class`);
    }
    for (const msg of toneExportProblems(src, Object.keys(expectedMap))) registryProblems.push(`${mod}:${msg}`);
    // Every tone module is imported and its namespace inspected, whatever the spelling of
    // its export; an import that fails matters only to a module that is required to carry
    // a chart map or that mentions one.
    let ns = null;
    try {
      ns = await import(pathToFileURL(join(root, mod)).href);
    } catch (e) {
      // Fail closed: a tone module that cannot be imported cannot be shown to carry no chart map.
      chartProblems.push(`${mod} — could not be imported to judge its chart map: ${e.message}`);
      continue;
    }
    const p = chartModuleProblems(ns);
    if (p === null) {
      if (chartMapRequired.has(mod)) chartProblems.push(`${mod} — required OUTCOME_CHART_MARK is missing`);
      continue;
    }
    for (const msg of p) chartProblems.push(`${mod} — ${msg}`);
    chartTrees.push(mod.replace(/\/lib\/outcome-tone\.ts$/, "/"));
  }

  let cssRules = 0;
  // The bare class is the one a stylesheet rule can satisfy; the Tailwind opacity form (`bg-status-allow/5`) is a
  // different class that no `.bg-status-*` rule generates (plan row 153). Concatenated forms are uses of the bare class.
  const BARE_BG = /(?<![\w/-])bg-status-(?:allow|step-up|restrict|deny)(?![\w/-])|(?<![\w/-])bg-status-(?:\$\{|["'`]\s*(?:\+|\)?\s*\.\s*concat\b))|["'`]bg-status["'`]\s*,[^\]]*\]\s*\.\s*join\b/;
  for (const cssRoot of cssRoots) {
    const everything = walk(join(root, cssRoot), /\.(?:[cm]?js|jsx|tsx?|css)$/, [], [], fsx);
    const css = { files: everything.files.filter((f) => f.endsWith(".css")) };
    const srcs = { files: everything.files.filter((f) => !f.endsWith(".css")) };
    for (const e of everything.errs) registryProblems.push(`${e.replace(`${root}/`, "")} — unreadable; ${cssRoot} was not fully judged`);
    // The floor is supplied only by stylesheets the tree LOADS, not by any .css file lying under it; and a
    // stylesheet the tree loads from OUTSIDE its root is judged too (it styles the same classes).
    const { loaded, errs: loadErrs, unresolved } = loadedStylesheets(join(root, cssRoot), srcs.files, readFile);
    for (const e of loadErrs) registryProblems.push(`${e.replace(`${root}/`, "")} — unreadable; ${cssRoot}'s loaded stylesheets were not fully judged`);
    for (const u of unresolved) registryProblems.push(`${u.replace(root + "/", "")} — a stylesheet this gate cannot resolve (a package specifier, not a path); it is NOT judged`);
    const judgedCss = new Map();
    for (const f of new Set([...css.files, ...loaded])) {
      let text;
      try { text = readFile(f, "utf8"); } catch (e) { if (!loaded.has(f) || e.code !== "ENOENT") registryProblems.push(`${rel(f)} — unreadable (${e.code ?? e.message})`); else registryProblems.push(`${rel(f)} — imported by ${cssRoot} but does not exist`); continue; }
      const r = cssToneProblems(text);
      cssRules += r.rules;
      judgedCss.set(f, r.found);
      for (const msg of r.problems) registryProblems.push(`${rel(f)}:${msg}`);
    }
    const found = new Set();
    for (const [f, set] of judgedCss) if (loaded.has(f)) for (const k of set) found.add(k);
    // Stylesheets the gate cannot reach at all: an HTML `<link rel=stylesheet>` (the font host aside) and any inline `<style>`.
    let usesBg = false;
    for (const f of srcs.files) {
      let text;
      try { text = stripComments(readFile(f, "utf8")); }
      catch (e) { registryProblems.push(`${rel(f)} — unreadable (${e.code ?? e.message}); not searched for bg-status-* use or inline <style>`); continue; }
      if (BARE_BG.test(text)) usesBg = true;
      if (/<style[\s>]/.test(text)) registryProblems.push(`${rel(f)} — contains an inline <style> block, which this gate cannot judge`);
      for (const href of stylesheetLinks(text)) if (!FONT_HOST.test(href)) registryProblems.push(`${rel(f)} — renders a <link rel=stylesheet> to "${href}", which this gate cannot judge (only the font host is allowed)`);
    }
    const htmlFile = join(root, dirname(cssRoot), "index.html");
    let html = null;
    try { html = readFile(htmlFile, "utf8"); } catch (e) { if (e.code !== "ENOENT") registryProblems.push(`${rel(htmlFile)} — unreadable (${e.code ?? e.message})`); }
    if (html !== null) {
      for (const href of stylesheetLinks(html)) {
        if (!FONT_HOST.test(href)) registryProblems.push(`${rel(htmlFile)} — links the stylesheet "${href}", which this gate cannot judge (only the font host is allowed)`);
      }
      if (/<style[\s>]/i.test(html)) registryProblems.push(`${rel(htmlFile)} — contains an inline <style> block, which this gate cannot judge`);
    }
    const need = VERDICTS.map((v) => `text:${v}`);
    if (usesBg) need.push(...VERDICTS.map((v) => `bg:${v}`));
    for (const k of need) {
      if (!found.has(k)) registryProblems.push(`${cssRoot} — no canonical .${k.replace(":", "-status-")} rule in a stylesheet this tree loads; a verdict class with no rule renders no colour`);
    }
  }

  if (discover) {
    let dirs = [];
    try {
      dirs = readdir(join(root, discover), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `${discover}/${d.name}/src`);
    } catch (e) {
      if (e.code !== "ENOENT") registryProblems.push(`${discover} — unreadable (${e.code ?? e.message}); the root lists could not be cross-checked against disk`);
    }
    for (const src of dirs) {
      let hasTone = false;
      try { hasTone = statSync(join(root, src, "lib", "outcome-tone.ts")).isFile(); } catch (e) { if (e.code !== "ENOENT") registryProblems.push(`${src}/lib/outcome-tone.ts — ${e.code ?? e.message}; could not be checked for a tone module`); }
      if (hasTone && !(`${src}/lib/outcome-tone.ts` in toneModules && trees.includes(src))) {
        registryProblems.push(`${src} — holds a tone module but is missing from the gate's tone-module or tree list; it is not judged`);
      }
      const w = walk(join(root, src), /\.css$/, [], [], fsx);
      for (const e of w.errs) registryProblems.push(`${e.replace(`${root}/`, "")} — unreadable; ${src} could not be cross-checked`);
      const hasVerdictCss = w.files.some((f) => { try { return /\.(?:text|bg)-status-(?:allow|step-up|restrict|deny)\b/.test(readFile(f, "utf8")); } catch { return true; } });
      if (hasVerdictCss && !cssRoots.includes(src)) registryProblems.push(`${src} — holds verdict status-class CSS but is missing from the gate's stylesheet roots; it is not judged`);
    }
  }

  const toneSet = new Set(Object.keys(toneModules));
  const expectedNames = Object.values(toneModules).flatMap((m) => (Array.isArray(m) ? m : Object.keys(m)));
  for (const file of files) {
    const r = rel(file);
    let src;
    try { src = readFile(file, "utf8"); } catch (e) { registryProblems.push(`${r} — unreadable (${e.code ?? e.message}); not inline-scanned`); continue; }
    const hits = [...offendingLines(src), ...localMapLines(src)];
    // A judged Record written to after its literal is judged by what its literal says, not by what it holds when
    // rendered: refuse the mutation where it is written (assignment, destructuring, delete, Object.* / Reflect.*).
    for (const msg of mutationProblems(src, expectedNames, file)) registryProblems.push(`${r}:${msg}`);
    if (toneSet.has(r)) {
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
      ? `  ${exempted} occurrence(s) inside the ${toneSet.size} named tone module(s), which is where they belong.`
      : `  ${toneSet.size} tone module(s) are exempt; none needed the exemption on this run.`,
  );
  log(`  chart marks judged in ${chartTrees.length} tree(s) with a chart map: ${chartTrees.join(", ") || "none"}; trees without one are not judged for charts.`);
  log(`  registry: ${recordsJudged} tone Record(s) / ${entriesJudged} verdict entr(ies) and ${cssRules} CSS verdict rule(s) across ${cssRoots.length} stylesheet root(s) judged against VERDICT_REGISTRY.`);

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
  log("It judges each verdict against VERDICT_REGISTRY: chart-mark tokens, tone Records and the branches in tone modules, and .text-/.bg-status-* CSS. It still does NOT judge:");
  for (const c of CEILINGS) log(`  - ${c.text}`);
  return { code: 0, out, err };
}

const APP_CSS_ROOT = "artifacts/signalgrid-app/src";
const REAL_CONFIG = {
  root: repo,
  trees: TREES,
  toneModules: TONE_EXPECTED,
  cssRoots: [...TREES, APP_CSS_ROOT],
  chartMapRequired: CHART_MAP_REQUIRED,
  discover: "artifacts",
};

if (process.argv.includes("--self-test")) process.exit(await selfTest());

const result = await runGate(REAL_CONFIG);
for (const l of result.out) console.log(l);
for (const l of result.err) console.error(l);
process.exit(result.code);
