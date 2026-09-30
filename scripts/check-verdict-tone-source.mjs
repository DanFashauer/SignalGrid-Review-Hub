// check-verdict-tone-source.mjs — a verdict may not pick its own colour inline.
//
//   node scripts/check-verdict-tone-source.mjs              # gate
//   node scripts/check-verdict-tone-source.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS. `check-decision-palette.mjs` asserts that a verdict is painted
// from a RATIFIED TOKEN. Backlog row 151 was three real defects — fail-closed
// shown in the danger tone, `restrict` wearing the step-up tone, and two verdicts
// sharing one legend swatch — and that gate exited 0 before the fix and exits 0
// after it. Every one of those defects used a ratified token. It has no concept
// of WHICH verdict maps to which token, so a mis-mapping is structurally
// invisible to it (backlog row 168).
//
// This gate answers the other half, and answers it STRUCTURALLY rather than
// semantically: it does not know which colour a verdict deserves either. It
// requires that the decision be made in ONE place, a total `Record` over the
// closed verdict union, so the compiler catches a missing arm and a reviewer has
// one file to read. Three independent ternaries is how the mappings drifted
// apart in the first place; a fourth had survived in `Dashboard.tsx` until this
// gate was written.
//
// WHAT IT CANNOT DO, said plainly: a total Record with the wrong colours in it
// passes. Centralising the decision does not make it correct — it makes it
// reviewable, and it makes the next drift a typecheck failure instead of a
// silent fourth opinion.

import { readFileSync, readdirSync, statSync } from "node:fs";
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
const TONE_MODULES = new Set([
  "artifacts/signalgrid-desktop/src/lib/outcome-tone.ts",
  "artifacts/signalgrid-mobile-pwa/src/lib/outcome-tone.ts",
  "artifacts/signalgrid-review/src/lib/outcome-tone.ts",
]);

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

/** Two verdict keys, each paired with a colour class, inside one object literal. */
const VERDICT_KEY = String.raw`(?:allow|deny|restrict|"step-up"|'step-up')\s*:\s*["'][^"']*(?:text-|bg-|border-)`;
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
const RATIFIED_TOKEN = /^--decision-(?:allow|review|deny)$/;

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
    if (!RATIFIED_TOKEN.test(mk.token)) out.push(`${v} fills from ${mk.token}, not a ratified --decision-* token`);
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

/** Every opening tag `<Name …>` / `<Name … />` with its attribute text, scanned brace- and quote-aware. */
function tags(code, localName) {
  const out = [];
  const esc = localName.replace(/[.$]/g, "\\$&");
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

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a tree that does not exist in this checkout is not a pass or a fail
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
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

  // The direction rule must hold on the REAL tone modules, each of which must exist.
  for (const rel of TONE_MODULES) {
    let src = null;
    try { src = readFileSync(join(repo, rel), "utf8"); } catch { /* reported below */ }
    checks.push([`tone module exists: ${rel}`, src !== null]);
    checks.push([`tone module carries a verdict map: ${rel}`, src !== null && localMapLines(src).length > 0]);
    checks.push([`tone module fallback is restrictive: ${rel}`, src !== null && fallbackProblems(src).length === 0]);
  }

  // Non-vacuity for the run below: the gate must actually be reading files.
  const scanned = TREES.flatMap((t) => walk(join(repo, t)));
  checks.push([`the real trees contain files to scan (${scanned.length})`, scanned.length > 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(await selfTest());

const files = TREES.flatMap((t) => walk(join(repo, t)));
if (files.length === 0) {
  console.error("✗ no source files found in any decision-bearing tree — refusing to report a pass from a scan that read nothing.");
  process.exit(1);
}

const problems = [];
const directionProblems = [];
const chartProblems = [];
let exempted = 0;

/** Trees whose tone module declares a chart map; their chart sites are judged. */
const chartTrees = [];
for (const rel of TONE_MODULES) {
  let mod = null;
  try {
    mod = await import(pathToFileURL(join(repo, rel)).href);
  } catch (e) {
    // Fail closed: a tone module that cannot be imported cannot be judged, and
    // a required chart map that cannot be judged is not a pass.
    if (CHART_MAP_REQUIRED.has(rel)) chartProblems.push(`${rel} — could not be imported to judge its chart map: ${e.message}`);
    continue;
  }
  const p = chartModuleProblems(mod);
  if (p === null) {
    if (CHART_MAP_REQUIRED.has(rel)) chartProblems.push(`${rel} — required OUTCOME_CHART_MARK is missing`);
    continue;
  }
  for (const msg of p) chartProblems.push(`${rel} — ${msg}`);
  chartTrees.push(rel.replace(/\/lib\/outcome-tone\.ts$/, "/"));
}
for (const file of files) {
  const rel = relative(repo, file).split("\\").join("/");
  const src = readFileSync(file, "utf8");
  const hits = [...offendingLines(src), ...localMapLines(src)];
  if (TONE_MODULES.has(rel)) {
    exempted += hits.length;
    // Inside the one place a map may live, the fallback's DIRECTION is gated.
    for (const p of fallbackProblems(src)) directionProblems.push(`${rel}:${p.line} — \`?? "${p.fallback}"\` is not a restrictive token`);
    continue;
  }
  for (const line of hits) problems.push(`${rel}:${line}`);
  if (chartTrees.some((t) => rel.startsWith(t))) {
    for (const msg of chartSiteProblems(src)) chartProblems.push(`${rel} — ${msg}`);
  }
}

console.log(`Verdict tone source — ${files.length} file(s) scanned across ${TREES.length} tree(s).`);
console.log(
  exempted > 0
    ? `  ${exempted} occurrence(s) inside the ${TONE_MODULES.size} named tone module(s), which is where they belong.`
    : `  ${TONE_MODULES.size} tone module(s) are exempt; none needed the exemption on this run.`,
);

console.log(`  chart marks judged in ${chartTrees.length} tree(s) with a chart map: ${chartTrees.join(", ") || "none"}; trees without one are not judged for charts.`);

if (chartProblems.length > 0) {
  console.error(`\n✗ ${chartProblems.length} verdict chart problem(s):`);
  for (const p of chartProblems) console.error(`    ${p}`);
  console.error("\n  A verdict chart reads its fills and patterns from OUTCOME_CHART_MARK, renders a Legend");
  console.error("  and a Tooltip, and never lets two verdicts be the same pixel. Restrict and deny share");
  console.error("  the deny tone by design, so they MUST differ in pattern (backlog row 107).");
}

if (problems.length > 0 || directionProblems.length > 0 || chartProblems.length > 0) {
  if (problems.length > 0) {
    console.error(`\n✗ ${problems.length} verdict→colour decision(s) outside a tone module (inline ternary or local map):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error("\n  A verdict may not pick its own colour at the point of render. Route it through");
    console.error("  the tree's tone module — a total Record over the verdict union, see");
    console.error("  artifacts/signalgrid-desktop/src/lib/outcome-tone.ts — so a missing arm is a");
    console.error("  typecheck failure instead of a fourth independent opinion about what deny looks like.");
  }
  if (directionProblems.length > 0) {
    console.error(`\n✗ ${directionProblems.length} tone-module fallback(s) in the WRONG DIRECTION:`);
    for (const p of directionProblems) console.error(`    ${p}`);
    console.error("\n  An unrecognised verdict must resolve to the RESTRICTIVE tone (status-restrict or");
    console.error("  status-deny), never to a neutral one. Unknown must tighten the answer.");
  }
  process.exit(1);
}

console.log("\nVerdict tone source gate passed — every verdict→colour decision is centralised,");
console.log("and every tone-module fallback is restrictive.");
console.log("It does NOT check that the centralised colours are RIGHT; check-decision-palette.mjs holds the tokens.");
