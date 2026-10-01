// check-web-a11y-basics — four web accessibility floors from plan row 76.
//
//   node scripts/check-web-a11y-basics.mjs             the guard
//   node scripts/check-web-a11y-basics.mjs --self-test prove each rule can fail
//
// WHY THIS EXISTS
// ---------------
// The first accessibility execution (docs/COMPANY_BUILD_PLAN.md row 76) measured,
// across the five web trees under artifacts/signalgrid-*:
//   · zero aria-live regions while the views poll every 15-30s, so a new deny
//     landing in a list was announced to nobody (WCAG 4.1.3);
//   · an icon-only delete button (PolicyCreate.tsx) with an empty accessible
//     name — lucide icons are aria-hidden by default (WCAG 4.1.2);
//   · prefers-reduced-motion honoured in one tree of five (WCAG 2.3.3).
// Each was fixed by hand; each is the kind of fix the next edit silently undoes.
// One rule per defect:
//
//   1. LIVE REGION. A POLLING VIEW (.tsx) must render <LiveRegion …/> or an
//      aria-live="polite|assertive" attribute ("off" is not a live region). A
//      file POLLS when it declares `refetchInterval`, drives a refetch from a
//      timer (setInterval, or a setTimeout loop), calls a query hook while its
//      tree's query defaults poll, or uses a hook or value a polling file
//      exports — by name, by an `import { X as Y }` alias, or as the default
//      import of a polling module (to a fixpoint). A component export (a
//      PascalCase name in a .tsx) does not carry polling upward: it renders its
//      own region. Everything a .ts exports is followed, whatever its case, and
//      a default export the gate cannot classify is followed. A hook handed on without a visible call — a
//      re-export, `export *`, `const useY = useX`, `export default useX` —
//      fails closed.
//      Query defaults are read from every .ts/.tsx in the tree — the balanced
//      argument list of each `new QueryClient(…)`, `setDefaultOptions(…)` and
//      `setQueryDefaults(…)`, wherever the construction lives — and must be an
//      inline object: options passed by name, spread or shorthand fail closed.
//      A query hook is react-query's own, any List/Get hook, or any hook the
//      generated client (lib/api-client-react) exports whose body calls a query
//      hook; `import { X as Y }` aliases and `NS.useX()` calls resolve to it.
//      App.tsx is scanned like any file once its construction is removed.
//   2. ICON BUTTON. A `<Button … size="icon" …>`, or a raw `<button>` whose
//      children render no text, must carry aria-label or aria-labelledby (a
//      child text node such as an sr-only <span> also names it). A label or
//      child that names nothing does not: an empty or blank aria-label is no
//      label, aria-hidden subtrees are left out, every numeric character
//      reference and the whitespace named ones are decoded, every escape in a
//      string child is decoded, fragments are removed, and the result must hold
//      something other than whitespace, controls (C0, DEL, C1) or invisible
//      format characters (zero-width, bidi, soft hyphen, blank glyphs). Tags
//      are parsed brace-aware; a tag the parser cannot close is a FAILURE,
//      never a skip.
//   3. REDUCED MOTION. Every web tree's src/index.css carries a
//      `@media (prefers-reduced-motion: reduce)` block that damps motion (an
//      animation-*, transition-* or scroll-behavior declaration), read with
//      CSS comments stripped.
//   4. JS MOTION. recharts 2.x animates in JavaScript and never reads the media
//      query, so CSS cannot reach it: every recharts series element — named,
//      aliased or namespaced — must set `isAnimationActive={false}` or
//      `isAnimationActive={!x}` where `x = usePrefersReducedMotion()` in the
//      same file. `{true}` or any other value is not gated motion. Likewise a
//      JS `behavior: "smooth"` ignores the stylesheet's scroll-behavior
//      override, so a literal "smooth" fails; choose it from the preference.
//
// Every hand-written and vendored (components/ui) .ts/.tsx file is read.
//
// Limit: rule 1 checks that a live region is rendered, not that it stays
// mounted or carries a message — `{msg && <div aria-live=…>}` passes. The
// regions this gate was written for are always mounted (components/LiveRegion).
//
// Comments are stripped before any rule reads a file: a commented-out
// <LiveRegion/> is not a live region, and a comment inside defaultOptions must
// not hide that every query polls.
//
// Fail closed: fewer than five web trees; zero polling views overall; a tree
// whose query defaults poll but yields zero polling views; a tree that mounts a
// QueryClientProvider with no QueryClient construction the gate can read; a
// query-defaults call the parser cannot close; a polling .ts file that exports
// no hook the gate can follow; a recharts import it cannot parse; a tree's
// LiveRegion component that no longer declares both live politeness levels. A
// detector that finds nothing is a broken detector, not a clean tree.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Escape every RegExp metacharacter (backslash included) in a literal. */
export const escapeRegExp = (s) => s.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");
const TREE_FLOOR = 5;

function sourceFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const QUERY_HOOK_NAME = /^use(Query|Queries|InfiniteQuery|SuspenseQuery|SuspenseQueries|SuspenseInfiniteQuery|List[A-Z]\w*|Get[A-Z]\w*)$/;
const GENERATED_CLIENT = "lib/api-client-react/src/generated/api.ts";

/**
 * Query hooks the generated API client exports — every `export function use*`
 * whose body calls a react-query query hook. `useHealthCheck` polls as surely as
 * `useListPolicies`; a List/Get prefix is not the contract, the body is.
 */
export function generatedQueryHooks(src) {
  const out = new Set();
  const re = /export\s+(?:function\s+|const\s+)(use[A-Z]\w*)/g;
  const starts = [...src.matchAll(re)];
  starts.forEach((m, i) => {
    const body = src.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : src.length);
    if (/\buse(Suspense)?(Infinite)?Quer(y|ies)\s*\(/.test(body)) out.add(m[1]);
  });
  return out;
}

/** Local names that call a query hook: the name itself, an alias (`X as Y`) of one. */
function queryHookNames(code, generated) {
  const isHook = (n) => QUERY_HOOK_NAME.test(n) || generated.has(n);
  const local = new Set();
  for (const m of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from/g)) {
    for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
      const [orig, alias] = part.replace(/^type\s+/, "").split(/\s+as\s+/);
      if (alias && isHook(orig)) local.add(alias.trim());
    }
  }
  return { isHook: (n) => isHook(n) || local.has(n) };
}

/** Does `code` call a query hook — directly, by alias, or through a namespace (`NS.useX(`)? */
export function callsQueryHook(code, generated = new Set()) {
  const { isHook } = queryHookNames(code, generated);
  for (const m of code.matchAll(/(?<![\w$])(?:[A-Za-z_$][\w$]*\.)?(use[A-Z]\w*|[A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/g)) {
    if (isHook(m[1])) return true;
  }
  return false;
}
const LIVE = /<LiveRegion\b|aria-live=\{?\s*["'`](polite|assertive)["'`]/;
const DEFAULTS_CALL = /new\s+QueryClient\s*\(|\.setDefaultOptions\s*\(|\.setQueryDefaults\s*\(/g;

/** Remove JSX `{/* … *\/}`, block and line comments (a `//` after `:` is a URL). */
export function stripComments(src) {
  // Keep the newlines a comment spanned, so reported line numbers stay true.
  const blank = (c) => c.replace(/[^\n]/g, "");
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Balanced `( … )` spans of every call matching `re` in (stripped) src. */
function callSpans(src, re) {
  const spans = [];
  let unbalanced = false;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf("(", m.index + m[0].length - 1);
    let depth = 0;
    let close = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) { close = i; break; }
    }
    if (close < 0) { unbalanced = true; break; }
    spans.push([m.index, close + 1]);
  }
  return { spans, unbalanced };
}

/**
 * Query defaults for one tree, read from every file. `files` is [{ rel, src }].
 * Returns { polls, constructions, providers, unparsed: [rel…] }.
 */
export function queryDefaults(files) {
  let polls = false;
  let constructions = 0;
  let providers = 0;
  const unparsed = [];
  const opaque = [];
  for (const { rel, src: raw } of files) {
    const src = stripComments(raw);
    if (/\bQueryClientProvider\b/.test(src)) providers++;
    constructions += (src.match(/new\s+QueryClient\s*\(/g) ?? []).length;
    const { spans, unbalanced } = callSpans(src, DEFAULTS_CALL);
    if (unbalanced) unparsed.push(rel);
    for (const [a, b] of spans) {
      const call = src.slice(a, b);
      if (/\brefetchInterval\b/.test(call)) polls = true;
      if (optionsOpaque(call)) opaque.push(rel);
    }
  }
  return { polls, constructions, providers, unparsed, opaque };
}

/**
 * True when a query-defaults call takes its options from somewhere the gate
 * cannot read: `new QueryClient(OPTS)`, `setDefaultOptions(DEFAULTS)`,
 * `defaultOptions: DEFAULTS`, `queries: Q`, a shorthand `{ defaultOptions }`,
 * or a spread. Any of them could carry `refetchInterval`, so each fails closed.
 */
export function optionsOpaque(call) {
  const inner = call.slice(call.indexOf("(") + 1, -1).trim();
  if (/^new\s+QueryClient/.test(call)) {
    if (inner !== "" && !inner.startsWith("{")) return true;
  } else if (!inner.includes("{")) {
    return true;
  }
  if (/\.\.\./.test(inner)) return true;
  if (/\b(defaultOptions|queries)\s*:(?!\s*\{)/.test(inner)) return true;
  if (/[{,]\s*(defaultOptions|queries)\s*[,}]/.test(inner)) return true;
  return false;
}

/** A file's source with its query-defaults call arguments removed. */
function withoutDefaultsCalls(src) {
  const { spans } = callSpans(src, DEFAULTS_CALL);
  let out = src;
  for (const [a, b] of spans.reverse()) out = out.slice(0, a) + out.slice(b);
  return out;
}

const exportedHooks = (src) =>
  [...src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function\s+|const\s+|let\s+)(use[A-Z]\w*)/g)].map((m) => m[1]);

/** Every name a file exports by name: declarations and `export { a, b as c }` lists. */
function exportedNames(code) {
  const out = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) {
    for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) out.add(part.split(/\s+as\s+/).pop().trim());
  }
  out.delete("default");
  return out;
}

/** Does the file have a default export? */
const hasDefaultExport = (code) => /export\s+default\b/.test(code) || /export\s*\{[^}]*\bas\s+default\b/.test(code);

/**
 * Is the default export something that carries polling (a hook, a value, an
 * anonymous function)? Only a default export that is plainly a component is
 * excluded: a PascalCase name (an upper-case letter then a lower-case one, so
 * `Dashboard` but not `POLL`) declared as a function or class, or exported as a
 * bare identifier, directly or via `export { X as default }`. A call such as
 * `export default Object.freeze({...})` is a value and is followed; anything
 * the gate cannot classify is followed.
 */
const PASCAL = "[A-Z][a-z][\\w$]*";
const defaultIsHookOrValue = (code) => {
  if (!hasDefaultExport(code)) return false;
  const component =
    new RegExp(`export\\s+default\\s+(?:async\\s+)?(?:function\\s*\\*?\\s*|class\\s+)${PASCAL}`).test(code) ||
    new RegExp(`export\\s+default\\s+${PASCAL}\\s*;?\\s*$`, "m").test(code) ||
    new RegExp(`export\\s*\\{[^}]*\\b${PASCAL}\\s+as\\s+default\\b`).test(code);
  return !component;
};

/** Resolve an import specifier to a tree file (relative or `@/`), or null. */
function resolveImport(fromRel, spec, rels) {
  const srcRoot = fromRel.match(/^(.*?\/src)\//)?.[1];
  let base;
  if (spec.startsWith(".")) base = join(dirname(fromRel), spec);
  else if (spec.startsWith("@/") && srcRoot) base = join(srcRoot, spec.slice(2));
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (rels.has(c)) return c;
  return null;
}

/**
 * Names that hand a polling export on without the gate seeing a call: a hook
 * re-exported from another module (`export { useX as useY } from`), a barrel
 * (`export * from`), a hook bound to another name without being called
 * (`const useFeed = useListPolicies`), or a hook default-exported by name.
 * The wrapper follow cannot trace any of them, so each fails closed.
 */
export function opaqueHookExports(code) {
  const out = [];
  if (/export\s*\*\s*(?:as\s+\w+\s*)?from/.test(code)) out.push("re-exports a whole module (`export * from`)");
  for (const m of code.matchAll(/export\s*\{([^}]*)\}\s*from/g)) if (/\buse[A-Z]\w*/.test(m[1])) out.push("re-exports a hook from another module");
  for (const m of code.matchAll(/(?:const|let|var)\s+(use[A-Z]\w*)\s*=\s*([A-Za-z_$][\w$.]*)\s*(?:;|$)/gm)) out.push(`binds ${m[1]} to ${m[2]} without calling it`);
  if (/export\s+default\s+use[A-Z]\w*\s*;?\s*$/m.test(code)) out.push("default-exports a hook by name");
  return out;
}

/**
 * Rule 1 over one tree's files. `files` is [{ rel, src }]; `defaultPolls` from
 * queryDefaults. Returns { polling (views), failures }.
 *
 * A file POLLS when it declares refetchInterval, drives a refetch from
 * setInterval, calls a query hook in a default-polling tree, or uses anything
 * a polling file exports — by its exported name, by an `import { X as Y }`
 * alias, or as the default import of a polling module. Iterated to a fixpoint.
 */
export function checkLiveRegions(files, defaultPolls, generated = new Set()) {
  const failures = [];
  // Only the LiveRegion component itself is exempt. App.tsx is read like any
  // file: its QueryClient construction is removed below, the rest is a view.
  const skip = (rel) => /\/LiveRegion\.tsx$/.test(rel);
  const parsed = files.filter((f) => !skip(f.rel)).map((f) => ({ ...f, code: withoutDefaultsCalls(stripComments(f.src)) }));
  const rels = new Set(parsed.map((f) => f.rel));
  for (const f of parsed) for (const why of opaqueHookExports(f.code)) failures.push(`${f.rel}: ${why} — the gate cannot follow it; failing closed`);
  const polls = new Set();
  const names = new Set();   // named exports of polling files
  // A .ts file renders no JSX, so nothing it exports is a component: every
  // default export of a polling .ts is followed, whatever its name.
  const defaultCarries = (rel) => {
    const code = parsed.find((x) => x.rel === rel).code;
    return rel.endsWith(".ts") ? hasDefaultExport(code) : defaultIsHookOrValue(code);
  };
  const usesPolling = (f) => {
    const own = exportedNames(f.code);
    const local = new Set([...names].filter((n) => !own.has(n)));
    // `import * as NS from "./polling"`: NS.default carries a followable default.
    for (const m of f.code.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g)) {
      const target = resolveImport(f.rel, m[3], rels);
      if (target && polls.has(target)) {
        if (defaultCarries(target)) local.add(`${m[2]}.default`);
        if (m[1] && defaultCarries(target)) local.add(m[1]);
      }
    }
    for (const m of f.code.matchAll(/import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g)) {
      const target = resolveImport(f.rel, m[3], rels);
      if (m[1] && target && polls.has(target) && defaultCarries(target)) local.add(m[1]);
      for (const part of (m[2] ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        const [orig, alias] = part.replace(/^type\s+/, "").split(/\s+as\s+/).map((x) => x.trim());
        if (alias && (names.has(orig) || (orig === "default" && target && polls.has(target) && defaultCarries(target)))) local.add(alias);
      }
    }
    return [...local].some((n) => new RegExp(`(?<![\\w$])${escapeRegExp(n)}(?![\\w$])`).test(f.code.replace(/import[^;]*?from\s*["'][^"']+["'];?/g, "")));
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of parsed) {
      if (polls.has(f.rel)) continue;
      // A timer driving a refetch polls: setInterval, or a setTimeout loop that re-arms itself.
      const intervalRefetch = /\bset(Interval|Timeout)\s*\(/.test(f.code) && /\brefetch\w*\s*\(/.test(f.code);
      if (/\brefetchInterval\b/.test(f.code) || intervalRefetch || (defaultPolls && callsQueryHook(f.code, generated)) || usesPolling(f)) {
        polls.add(f.rel);
        // A component renders its own live region, so it does not carry polling
        // to the file rendering it. Only a PascalCase name (upper then lower
        // case) in a .tsx counts as a component; every other export — hooks,
        // values, SCREAMING_CASE options, and anything from a .ts — is followed.
        const isTs = f.rel.endsWith(".ts");
        for (const n of exportedNames(f.code)) if (isTs || !new RegExp(`^${PASCAL}$`).test(n)) names.add(n);
        changed = true;
      }
    }
  }
  const polling = [];
  for (const f of parsed) {
    if (!polls.has(f.rel)) continue;
    if (f.rel.endsWith(".ts")) {
      if (exportedNames(f.code).size === 0 && !hasDefaultExport(f.code)) failures.push(`${f.rel}: polls but exports nothing the gate can follow — failing closed`);
      continue;
    }
    polling.push(f.rel);
    if (!LIVE.test(f.code)) failures.push(`${f.rel}: polls but renders no live region (<LiveRegion> / aria-live="polite|assertive") — WCAG 4.1.3`);
  }
  return { polling, failures };
}

/** Text of the JSX opening tag starting at `index`, brace-aware; null if unclosed. */
function openingTag(src, index) {
  let depth = 0;
  for (let i = index + 1; i < src.length; i++) {
    const c = src[i];
    // A quoted attribute value may hold `>` (`title="a>b"`): skip it whole.
    if (depth === 0 && (c === '"' || c === "'") && src[i - 1] === "=") {
      const q = src.indexOf(c, i + 1);
      if (q < 0) return null;
      i = q;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(index, i);
  }
  return null;
}

/**
 * Characters that render nothing a screen reader can name a button by: every
 * JS whitespace (`\s` covers U+00A0, U+2000–U+200A, U+3000, U+FEFF …), the
 * zero-width and joiner characters `\s` misses, and C0 controls.
 */
// Beyond \s: zero-width and joiner characters, C0 and C1 controls and DEL, the
// soft hyphen, bidi and other format controls, invisible operators, variation
// selectors and the blank glyphs (Braille blank, Hangul fillers, Khmer vowels).
// Astral planes too (hence the `u` flag): shorthand and musical format
// controls, the tag characters and the variation selector supplement.
const INVISIBLE = /[\s\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFFA0\uFFF9-\uFFFC\u{1BCA0}-\u{1BCA3}\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;
export const isBlank = (text) => text.replace(INVISIBLE, "") === "";

/** Named HTML entities that are whitespace or invisible; any other name is left as text. */
const NAMED_WS = {
  nbsp: "\u00A0", NonBreakingSpace: "\u00A0", ensp: "\u2002", emsp: "\u2003", emsp13: "\u2004", emsp14: "\u2005",
  numsp: "\u2007", puncsp: "\u2008", thinsp: "\u2009", ThinSpace: "\u2009", hairsp: "\u200A", VeryThinSpace: "\u200A",
  MediumSpace: "\u205F", ThickSpace: "\u205F\u200A", ZeroWidthSpace: "\u200B", NegativeVeryThinSpace: "\u200B",
  NegativeThinSpace: "\u200B", NegativeMediumSpace: "\u200B", NegativeThickSpace: "\u200B", zwnj: "\u200C", zwj: "\u200D",
  NoBreak: "\u2060", Tab: "\t", NewLine: "\n", shy: "\u00AD", lrm: "\u200E", rlm: "\u200F",
  InvisibleTimes: "\u2062", it: "\u2062", InvisibleComma: "\u2063", ic: "\u2063", ApplyFunction: "\u2061", af: "\u2061",
};
const codePoint = (n) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\uFFFD");

/** Decode every numeric character reference and the whitespace named ones. */
export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (m, n) => NAMED_WS[n] ?? m);
}

/** Decode the escapes of a JS string literal's body. */
export function decodeEscapes(text) {
  const simple = { n: "\n", r: "\r", t: "\t", f: "\f", v: "\v", b: "\b", 0: "\0" };
  return text.replace(/\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g, (_, cp, u4, x2, ch) =>
    cp ? codePoint(parseInt(cp, 16)) : u4 ? codePoint(parseInt(u4, 16)) : x2 ? codePoint(parseInt(x2, 16)) : (simple[ch] ?? ch));
}

/**
 * Text a raw `<button>` renders: its children with every JSX tag and fragment
 * removed, string-literal children decoded and dropped when they render
 * nothing, and character references decoded. Test the result with isBlank.
 */
function buttonText(src, openEnd, tagName = "button") {
  // The closer may carry whitespace before its `>` (`</button >`).
  const closeRe = new RegExp(`</${tagName}\\s*>`, "g");
  closeRe.lastIndex = openEnd;
  const cm = closeRe.exec(src);
  if (!cm) return null;
  let body = src.slice(openEnd + 1, cm.index);
  // An aria-hidden subtree is left out of the accessible name: drop it whole.
  body = dropAriaHidden(body);
  if (body === null) return null;
  body = body.replace(/\{\s*(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1\s*\}/g, (m, _q, inner) =>
    isBlank(decodeEscapes(inner)) ? "" : m);
  // `<>` and `</>` (fragments) are tags too: openingTag on `<>` returns "<".
  for (let i = body.search(/<[A-Za-z/>]/); i >= 0; i = body.search(/<[A-Za-z/>]/)) {
    const tag = openingTag(body, i);
    if (tag === null) return null;
    body = body.slice(0, i) + body.slice(i + tag.length + 1);
  }
  return decodeEntities(body);
}

/** Is this opening tag aria-hidden (any value but false)? */
// `(?<![\w-])` so `data-aria-hidden` is not read as aria-hidden.
const ARIA_HIDDEN = (tag) => /(?<![\w-])aria-hidden(?![\w-])/.test(tag) && !/(?<![\w-])aria-hidden\s*=\s*(?:["']false["']|\{\s*false\s*\}|\{\s*["']false["']\s*\})/.test(tag);

/** Remove every aria-hidden element and its children; null if a tag cannot be closed. */
function dropAriaHidden(body) {
  for (let from = 0; ; ) {
    const i = body.slice(from).search(/<[A-Za-z]/);
    if (i < 0) return body;
    const at = from + i;
    const tag = openingTag(body, at);
    if (tag === null) return null;
    if (!ARIA_HIDDEN(tag)) { from = at + 1; continue; }
    const end = at + tag.length + 1;
    if (tag.trimEnd().endsWith("/")) { body = body.slice(0, at) + body.slice(end); from = at; continue; }
    const name = tag.match(/^<([A-Za-z][\w.:-]*)/)[1];
    const re = new RegExp(`<(/?)${escapeRegExp(name)}(?=[\\s/>])`, "g");
    re.lastIndex = end;
    let depth = 1, close = -1, mm;
    while ((mm = re.exec(body))) {
      const t = openingTag(body, mm.index);
      if (t === null) return null;
      if (mm[1]) { if (--depth === 0) { close = mm.index + t.length + 1; break; } }
      else if (!t.trimEnd().endsWith("/")) depth++;
    }
    if (close < 0) return null;
    body = body.slice(0, at) + body.slice(close);
    from = at;
  }
}

/**
 * Does the opening tag carry a label that names something? `aria-label=""`,
 * `aria-label=" "` or `aria-label={""}` names nothing; any other expression may.
 */
export function hasNonBlankLabel(tag) {
  for (const m of tag.matchAll(/\baria-label(?:ledby)?\s*=\s*(?:(["'])([\s\S]*?)\1|\{\s*(["'`])((?:\\[\s\S]|(?!\3)[^\\])*)\3\s*\}|\{)/g)) {
    if (m[1] !== undefined) { if (!isBlank(decodeEntities(m[2]))) return true; }
    else if (m[3] !== undefined) { if (!isBlank(decodeEscapes(m[4]))) return true; }
    else return true; // an expression the gate cannot evaluate
  }
  return false;
}

/** Rule 2 over one file. Returns failure strings. */
export function checkIconButtons(rel, raw) {
  const src = stripComments(raw);
  const failures = [];
  // A raw <button> whose children are only tags (an <svg>, an icon component)
  // renders no text, so without aria-label its accessible name is empty. A
  // `{expression}` child may be text, so it is not flagged.
  const raw_ = /<button\b/g;
  let r;
  while ((r = raw_.exec(src))) {
    const line = src.slice(0, r.index).split("\n").length;
    const tag = openingTag(src, r.index);
    if (tag === null) { failures.push(`${rel}:${line}: <button> tag could not be parsed — failing closed`); continue; }
    if (hasNonBlankLabel(tag) || tag.trimEnd().endsWith("/")) continue;
    const text = buttonText(src, r.index + tag.length);
    if (text === null) { failures.push(`${rel}:${line}: <button> body could not be parsed — failing closed`); continue; }
    if (isBlank(text)) failures.push(`${rel}:${line}: icon-only <button> renders no text and has no aria-label — its accessible name is empty (WCAG 4.1.2)`);
  }
  const re = /<Button\b/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    const tag = openingTag(src, m.index);
    if (tag === null) { failures.push(`${rel}:${line}: <Button> tag could not be parsed — failing closed`); continue; }
    // A child text node (an sr-only <span>) names the button as well as aria-label does.
    const named = hasNonBlankLabel(tag) || (!tag.trimEnd().endsWith("/") && !isBlank(buttonText(src, m.index + tag.length, "Button") ?? ""));
    if (/\bsize=["{]\s*["'`]?icon["'`]?/.test(tag) && !named) {
      failures.push(`${rel}:${line}: icon-only <Button size="icon"> has no aria-label — its accessible name is empty (WCAG 4.1.2)`);
    }
  }
  return failures;
}

const SERIES = ["Area", "Bar", "Line", "Pie", "Radar", "RadialBar", "Scatter", "Funnel", "Treemap", "Sankey", "SunburstChart"];
const RECHARTS_IMPORT = /import\s+([^;]*?)\s+from\s*["']recharts["']/g;

/** Local JSX names that are recharts series in this file, or null if an import is unparseable. */
export function rechartsSeriesNames(src) {
  const names = [];
  RECHARTS_IMPORT.lastIndex = 0;
  let m;
  let imports = 0;
  while ((m = RECHARTS_IMPORT.exec(src))) {
    imports++;
    const clause = m[1].trim();
    const ns = clause.match(/^(?:\*\s+as\s+(\w+)|(\w+))\s*(?:,|$)/);
    if (ns) for (const s of SERIES) names.push(`${ns[1] ?? ns[2]}.${s}`);
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(",").map((p) => p.trim()).filter(Boolean)) {
        const [orig, alias] = part.replace(/^type\s+/, "").split(/\s+as\s+/);
        if (SERIES.includes(orig)) names.push(alias ?? orig);
      }
    }
    if (!ns && !named) return null;
  }
  if (imports === 0 && /["']recharts["']/.test(src)) return null;
  return names;
}

/** Rule 4 over one file. Returns failure strings. */
export function checkChartMotion(rel, raw) {
  const src = stripComments(raw);
  if (!/["']recharts["']/.test(src)) return [];
  const names = rechartsSeriesNames(src);
  if (names === null) return [`${rel}: recharts is imported in a form the gate cannot parse — failing closed`];
  const reduced = new Set([...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*usePrefersReducedMotion\s*\(\s*\)/g)].map((m) => m[1]));
  const failures = [];
  for (const name of names) {
    const re = new RegExp(`<${escapeRegExp(name)}(?=[\\s/>])`, "g");
    let m;
    while ((m = re.exec(src))) {
      const line = src.slice(0, m.index).split("\n").length;
      const tag = openingTag(src, m.index);
      if (tag === null) { failures.push(`${rel}:${line}: <${name}> tag could not be parsed — failing closed`); continue; }
      const v = tag.match(/\bisAnimationActive=\{\s*(false|!\s*(\w+))\s*\}/);
      if (!v || (v[2] && !reduced.has(v[2]))) {
        failures.push(`${rel}:${line}: recharts <${name}> animates in JS and ignores prefers-reduced-motion — set isAnimationActive={false} or {!usePrefersReducedMotion()} (WCAG 2.3.3)`);
      }
    }
  }
  return failures;
}

/**
 * Rule 4, scrolling half. A JS `behavior: "smooth"` ignores the stylesheet's
 * `scroll-behavior` override, so a literal "smooth" is ungated motion; the value
 * must be chosen from the reduced-motion preference.
 */
export function checkScrollMotion(rel, raw) {
  const src = stripComments(raw);
  const failures = [];
  for (const m of src.matchAll(/\bbehavior\s*:\s*["'`]smooth["'`]/g)) {
    const line = src.slice(0, m.index).split("\n").length;
    failures.push(`${rel}:${line}: behavior: "smooth" in JS ignores prefers-reduced-motion — choose it from the preference (WCAG 2.3.3)`);
  }
  return failures;
}

/**
 * Rule 3 over one stylesheet. Comments are stripped first, and the block must
 * hold at least one declaration: a commented-out or empty block reduces nothing.
 */
export function checkReducedMotion(rel, raw) {
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let depth = 0;
    for (let i = m.index + m[0].length - 1; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        // It must actually damp motion: an animation-*, transition-* or
        // scroll-behavior declaration. `.x { color: red }` reduces nothing.
        if (/(?:^|[\s;{])(animation|transition)(-[\w-]+)?\s*:[^;{}]+[;}]|scroll-behavior\s*:[^;{}]+[;}]/.test(css.slice(m.index + m[0].length, i + 1))) return [];
        break;
      }
    }
  }
  return [`${rel}: no @media (prefers-reduced-motion: reduce) block that damps animation, transition or scroll-behavior — WCAG 2.3.3`];
}

function webTrees() {
  const base = join(repo, "artifacts");
  return readdirSync(base)
    .filter((d) => d.startsWith("signalgrid-") && existsSync(join(base, d, "src", "index.css")))
    .map((d) => join(base, d));
}

function run() {
  const failures = [];
  const trees = webTrees();
  if (trees.length < TREE_FLOOR) {
    failures.push(`found ${trees.length} web trees with src/index.css, floor is ${TREE_FLOOR} — the scan lost its inputs`);
  }
  const genPath = join(repo, GENERATED_CLIENT);
  const generated = existsSync(genPath) ? generatedQueryHooks(readFileSync(genPath, "utf8")) : new Set();
  if (generated.size === 0) failures.push(`${GENERATED_CLIENT}: no generated query hooks found — the hook detector lost its inputs`);
  let pollingTotal = 0;
  let buttons = 0;
  let rawButtons = 0;
  let charts = 0;
  for (const tree of trees) {
    const treeRel = relative(repo, tree);
    const css = join(tree, "src", "index.css");
    failures.push(...checkReducedMotion(relative(repo, css), readFileSync(css, "utf8")));
    const files = sourceFiles(join(tree, "src")).map((p) => ({ rel: relative(repo, p), src: readFileSync(p, "utf8") }));
    const qd = queryDefaults(files);
    for (const rel of qd.unparsed) failures.push(`${rel}: a query-defaults call the gate cannot close — failing closed`);
    for (const rel of qd.opaque) failures.push(`${rel}: query defaults are passed by name, spread or shorthand — the gate cannot see whether they poll; inline the options object (failing closed)`);
    if (qd.providers > 0 && qd.constructions === 0) {
      failures.push(`${treeRel}: mounts a QueryClientProvider but no \`new QueryClient(…)\` the gate can read — failing closed`);
    }
    const lr = checkLiveRegions(files, qd.polls, generated);
    if (qd.polls && lr.polling.length === 0) {
      failures.push(`${treeRel}: its query defaults poll but zero polling views were found — the detector is broken, not the tree clean`);
    }
    if (files.some((f) => /<LiveRegion\b/.test(stripComments(f.src)))) {
      const comp = files.find((f) => f.rel.endsWith("/components/LiveRegion.tsx"));
      const code = comp ? stripComments(comp.src) : "";
      if (!/aria-live="polite"/.test(code) || !/aria-live="assertive"/.test(code)) {
        failures.push(`${treeRel}: <LiveRegion> is used but components/LiveRegion.tsx no longer declares aria-live="polite" and "assertive"`);
      }
    }
    pollingTotal += lr.polling.length;
    failures.push(...lr.failures);
    for (const f of files.filter((x) => x.rel.endsWith(".tsx"))) {
      buttons += (f.src.match(/<Button\b/g) ?? []).length;
      rawButtons += (stripComments(f.src).match(/<button\b/g) ?? []).length;
      failures.push(...checkIconButtons(f.rel, f.src));
      if (/["']recharts["']/.test(f.src)) charts++;
      failures.push(...checkChartMotion(f.rel, f.src));
    }
    for (const f of files) failures.push(...checkScrollMotion(f.rel, f.src));
  }
  if (pollingTotal === 0) failures.push("zero polling views found — the detector is broken, not the tree clean");
  if (failures.length) {
    for (const f of failures) console.error(`✗ ${f}`);
    console.error(`FAIL web a11y basics — ${failures.length} finding(s)`);
    process.exit(1);
  }
  console.log(`OK web a11y basics — ${trees.length} trees reduce motion; ${pollingTotal} polling views each render a live region; ${buttons} <Button> and ${rawButtons} <button> tags, every icon-only one labelled; ${generated.size} generated query hooks resolved; ${charts} recharts files, every series animation gated`);
}

function selfTest() {
  const view = (rel, src) => ({ rel, src });
  const cases = [
    ["polling view without a live region fails",
      checkLiveRegions([view("t/src/pages/A.tsx", "useQuery({ refetchInterval: 5 }); return <div/>;")], false).failures.length === 1],
    ["polling view with <LiveRegion> passes",
      checkLiveRegions([view("t/src/pages/A.tsx", "useQuery({ refetchInterval: 5 }); <LiveRegion message=\"x\" />")], false).failures.length === 0],
    ["aria-live=\"off\" is not a live region",
      checkLiveRegions([view("t/src/pages/A.tsx", "useQuery({ refetchInterval: 5 }); <div aria-live=\"off\" />")], false).failures.length === 1],
    ["default-polling tree: page with a list hook and no live region fails",
      checkLiveRegions([view("t/src/pages/B.tsx", "const { data } = useListThings();")], true).failures.length === 1],
    ["non-default tree: page with a list hook is not a polling view",
      checkLiveRegions([view("t/src/pages/B.tsx", "const { data } = useListThings();")], false).polling.length === 0],
    ["default-polling tree: useInfiniteQuery / useSuspenseQuery / useQueries poll",
      ["useInfiniteQuery(o)", "useSuspenseQuery(o)", "useQueries(o)"].every((c) => checkLiveRegions([view("t/src/pages/C.tsx", c)], true).failures.length === 1)],
    ["a wrapper hook in a .ts file is followed to the view that calls it",
      checkLiveRegions([view("t/src/lib/feed.ts", "export function useFeed() { return useQuery({ refetchInterval: 5 }); }"), view("t/src/pages/D.tsx", "const f = useFeed(); return <div/>;")], false).failures.length === 1],
    ["a polling .ts file exporting nothing fails closed",
      checkLiveRegions([view("t/src/lib/opts.ts", "const opts = { refetchInterval: 5 };")], false).failures.length === 1],
    ["commented-out <LiveRegion> does not count",
      checkLiveRegions([view("t/src/pages/A.tsx", "useQuery({ refetchInterval: 5 }); {/* <LiveRegion message=\"x\" /> */}")], false).failures.length === 1],
    ["default-polling tree: a layout component outside pages is a polling view",
      checkLiveRegions([view("t/src/components/Layout.tsx", "const { data } = useGetThing();")], true).failures.length === 1],
    ["a comment padding defaultOptions does not hide default polling",
      queryDefaults([view("t/src/App.tsx", `const q = new QueryClient({ defaultOptions: { /* ${"x".repeat(400)} */ queries: { refetchInterval: 30_000 } } });`)]).polls === true],
    ["a QueryClient built outside App.tsx is still read",
      queryDefaults([view("t/src/lib/query-client.ts", "export const qc = new QueryClient({ defaultOptions: { queries: { refetchInterval: 30_000 } } });"), view("t/src/App.tsx", "<QueryClientProvider client={qc}>")]).polls === true],
    ["setDefaultOptions with refetchInterval makes defaults poll",
      queryDefaults([view("t/src/lib/q.ts", "qc.setDefaultOptions({ queries: { refetchInterval: 5 } });")]).polls === true],
    ["a QueryClient without refetchInterval does not poll",
      queryDefaults([view("t/src/App.tsx", "const q = new QueryClient({ defaultOptions: { queries: { staleTime: 5 } } });")]).polls === false],
    ["a provider with no readable construction is flagged",
      (() => { const q = queryDefaults([view("t/src/App.tsx", "<QueryClientProvider client={makeClient()}>")]); return q.providers === 1 && q.constructions === 0; })()],
    ["an unclosable QueryClient construction fails closed",
      queryDefaults([view("t/src/App.tsx", "const q = new QueryClient({ defaultOptions: {")]).unparsed.length === 1],
    ["query options passed by name fail closed",
      queryDefaults([view("t/src/App.tsx", "const OPTS = { defaultOptions: { queries: { refetchInterval: 30_000 } } };\nconst q = new QueryClient(OPTS);")]).opaque.length === 1],
    ["defaultOptions passed by name fails closed",
      queryDefaults([view("t/src/App.tsx", "const q = new QueryClient({ defaultOptions: DEFAULTS });")]).opaque.length === 1],
    ["spread or shorthand query options fail closed",
      ["new QueryClient({ ...base })", "new QueryClient({ defaultOptions })", "qc.setDefaultOptions(D)"].every((c) => queryDefaults([view("t/src/App.tsx", c)]).opaque.length === 1)],
    ["inline query options are readable",
      queryDefaults([view("t/src/App.tsx", "const q = new QueryClient({ defaultOptions: { queries: { refetchInterval: 30_000 } } });")]).opaque.length === 0],
    ["a polling component in App.tsx is a polling view",
      checkLiveRegions([view("t/src/App.tsx", "const q = new QueryClient();\nfunction DenyTicker() { useQuery({ refetchInterval: 5_000 }); return <p/>; }")], false).failures.length === 1],
    ["App.tsx's own QueryClient construction is not a polling view",
      checkLiveRegions([view("t/src/App.tsx", "const q = new QueryClient({ defaultOptions: { queries: { refetchInterval: 30_000 } } });")], true).polling.length === 0],
    ["an aliased generated hook is still a query hook",
      checkLiveRegions([view("t/src/pages/P.tsx", 'import { useListPolicies as usePolicyFeed } from "@workspace/api-client-react";\nconst { data } = usePolicyFeed();')], true).failures.length === 1],
    ["a namespaced generated hook is still a query hook",
      checkLiveRegions([view("t/src/pages/P.tsx", 'import * as api from "@workspace/api-client-react";\nconst { data } = api.useListPolicies();')], true).failures.length === 1],
    ["a generated query hook outside List/Get polls in a default-polling tree",
      checkLiveRegions([view("t/src/pages/H.tsx", "const h = useHealthCheck();")], true, new Set(["useHealthCheck"])).failures.length === 1],
    ["generated hooks are classified by body: queries in, mutations out",
      (() => { const g = generatedQueryHooks("export function useHealthCheck() { const query = useQuery(o); }\nexport const useResetSimulator = () => { return useMutation(o); };"); return g.has("useHealthCheck") && !g.has("useResetSimulator"); })()],
    ["escapeRegExp escapes every metacharacter, backslash included",
      (() => { try { return new RegExp(`^${escapeRegExp("a\\b$.*+?()[]{}|/-^")}$`).test("a\\b$.*+?()[]{}|/-^"); } catch { return false; } })()],
    ["unlabelled icon button fails",
      checkIconButtons("x.tsx", '<Button\n variant="ghost"\n size="icon"\n onClick={() => remove(i)}\n>\n<Trash2 /></Button>').length === 1],
    ["labelled icon button passes",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={() => remove(i)} aria-label={`Delete rule ${i}`}><Trash2 /></Button>').length === 0],
    ["icon button named by an sr-only child span passes",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={t}><PanelLeftIcon /><span className="sr-only">Toggle Sidebar</span></Button>').length === 0],
    ["a whitespace-only {\" \"} child does not name an icon button",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={t}><X />{" "}</Button>').length === 1],
    ["an escaped-newline {\"\\n\"} child does not name an icon button",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={t}><X />{"\\n"}</Button>').length === 1],
    ["whitespace entities and zero-width escapes do not name an icon button",
      ['&nbsp;', '&#32;', '&#xA0;', '{"\\u200b"}', '{"\\u00a0"}'].every((c) => checkIconButtons("x.tsx", `<Button size="icon" onClick={t}><X />${c}</Button>`).length === 1) &&
      checkIconButtons("x.tsx", '<button onClick={f}><X />&nbsp;</button>').length === 1],
    ["any numeric or whitespace-named entity is decoded and does not name a button",
      ["&#9;", "&#10;", "&#x2003;", "&#x00A0;", "&NonBreakingSpace;", "&ZeroWidthSpace;"].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}><svg/>${c}</button>`).length === 1 && checkIconButtons("x.tsx", `<Button size="icon" onClick={f}><X />${c}</Button>`).length === 1)],
    ["any whitespace escape in a string child is decoded and does not name a button",
      ['{"\\u0009"}', '{"\\x09"}', '{"\\u{200B}"}', '{"\\u2003"}', "{`\\t`}", '{"\u200B"}', '{"\u200C"}'].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}><svg/>${c}</button>`).length === 1)],
    ["a literal zero-width character as JSX text does not name a button",
      ["\u200B", "\u200C", "\u2060"].every((c) => checkIconButtons("x.tsx", `<button onClick={f}><X />${c}</button>`).length === 1)],
    ["an icon wrapped in a fragment is not text",
      checkIconButtons("x.tsx", "<button onClick={f}><><svg/></></button>").length === 1 &&
      checkIconButtons("x.tsx", '<Button size="icon" onClick={f}><><svg/></></Button>').length === 1],
    ["a visible entity or string child still names a button",
      checkIconButtons("x.tsx", '<button onClick={f}><svg/>&amp; more</button>').length === 0 && checkIconButtons("x.tsx", '<button onClick={f}><svg/>{"Save"}</button>').length === 0],
    ["an empty or blank aria-label does not name a button",
      ['aria-label=""', 'aria-label=" "', 'aria-label={""}', "aria-label={` `}", 'aria-label="&nbsp;"', 'aria-labelledby=""'].every((a) =>
        checkIconButtons("x.tsx", `<button onClick={f} ${a}><svg/></button>`).length === 1 && checkIconButtons("x.tsx", `<Button size="icon" ${a}><X /></Button>`).length === 1) &&
      ['aria-label="Close"', "aria-label={t('close')}", 'aria-labelledby="close-label"'].every((a) => checkIconButtons("x.tsx", `<button onClick={f} ${a}><svg/></button>`).length === 0)],
    ["text inside an aria-hidden child does not name a button",
      ['<span aria-hidden="true">×</span>', "<span aria-hidden>×</span>", "<span aria-hidden={true}>×</span>", '<span aria-hidden="true"><b>×</b></span>'].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}>${c}</button>`).length === 1 && checkIconButtons("x.tsx", `<Button size="icon">${c}</Button>`).length === 1) &&
      checkIconButtons("x.tsx", '<button onClick={f}><svg aria-hidden="true" /><span className="sr-only">Close</span></button>').length === 0 &&
      ['aria-hidden="false"', "aria-hidden={false}", 'aria-hidden={"false"}', 'data-aria-hidden="true"'].every((a) =>
        checkIconButtons("x.tsx", `<button onClick={f}><span ${a}>Close</span></button>`).length === 0)],
    ["a same-name child inside an aria-hidden element does not close it early",
      checkIconButtons("x.tsx", '<button onClick={f}><span aria-hidden="true"><span>x</span>Y</span></button>').length === 1 &&
      checkIconButtons("x.tsx", '<button onClick={f}><span aria-hidden="true"><span>x</span></span>Close</button>').length === 0],
    ["a `>` inside a quoted attribute does not end the tag",
      checkIconButtons("x.tsx", '<button onClick={f}><span title="a>b" aria-hidden="true">×</span></button>').length === 1 &&
      checkIconButtons("x.tsx", '<button onClick={f} title="a>b"><svg/></button>').length === 1 &&
      checkIconButtons("x.tsx", '<button onClick={f} title="a>b">Close</button>').length === 0],
    ["astral invisible characters do not name a button",
      ["&#xE0100;", "&#x1D173;", "&#xE0001;", "&#x1BCA0;", "\\u{E0100}"].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}><svg/>${c.startsWith("&") ? c : `{"${c}"}`}</button>`).length === 1) &&
      checkIconButtons("x.tsx", '<button onClick={f}>&#x1F600;</button>').length === 0],
    ["DEL, C1 controls and invisible format characters do not name a button",
      ["&#x7F;", "&#x85;", "&shy;", "&#173;", "&lrm;", "&#x200E;", "&#x2800;", "&#x3164;", "&#x115F;", "&#x034F;", "&#xFE0F;", "&#x061C;", "&#xFFFC;", "&#x17B4;"].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}><svg/>${c}</button>`).length === 1)],
    ["a closer written `</button >` does not borrow the next button's text",
      checkIconButtons("x.tsx", '<button onClick={a}><svg/></button >\n<button onClick={b}>Save</button>').length === 1],
    ["a template-literal icon size is still an icon button",
      checkIconButtons("x.tsx", "<Button size={`icon`}><X /></Button>").length === 1],
    ["text button without size=icon passes",
      checkIconButtons("x.tsx", '<Button onClick={() => go()}>Save</Button>').length === 0],
    ["unclosable <Button tag fails closed",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={() => {').length === 1],
    ["recharts series without isAnimationActive fails",
      checkChartMotion("c.tsx", 'import { Area } from "recharts";\n<Area type="monotone" dataKey="x" />').length === 1],
    ["recharts series gated by usePrefersReducedMotion passes",
      checkChartMotion("c.tsx", 'import { Area } from "recharts";\nconst reduceMotion = usePrefersReducedMotion();\n<Area isAnimationActive={!reduceMotion} dataKey="x" />').length === 0],
    ["recharts series with isAnimationActive={false} passes",
      checkChartMotion("c.tsx", 'import { Bar } from "recharts";\n<Bar isAnimationActive={false} />').length === 0],
    ["isAnimationActive={true} is not gated motion",
      checkChartMotion("c.tsx", 'import { Area } from "recharts";\n<Area isAnimationActive={true} />').length === 1],
    ["{!x} where x is not usePrefersReducedMotion() is not gated motion",
      checkChartMotion("c.tsx", 'import { Area } from "recharts";\nconst x = false;\n<Area isAnimationActive={!x} />').length === 1],
    ["an aliased series import is still checked",
      checkChartMotion("c.tsx", 'import { Area as Band } from "recharts";\n<Band dataKey="x" />').length === 1],
    ["a namespace import is still checked",
      checkChartMotion("c.tsx", 'import * as R from "recharts";\n<R.Bar dataKey="x" />').length === 1],
    ["an unparseable recharts import fails closed",
      checkChartMotion("c.tsx", 'const R = require("recharts");\n<R.Bar />').length === 1],
    ["a commented-out reduced-motion block does not count",
      checkReducedMotion("a.css", "/* @media (prefers-reduced-motion: reduce) { * { animation: none; } } */").length === 1],
    ["a reduced-motion block that damps no motion does not count",
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { .x { color: red; } }").length === 1],
    ["a Treemap is a recharts series",
      checkChartMotion("c.tsx", 'import { Treemap } from "recharts";\n<Treemap data={d} />').length === 1],
    ["setInterval driving a refetch is polling",
      checkLiveRegions([view("t/src/pages/T.tsx", "const q = useThing(); useEffect(() => { const id = setInterval(() => q.refetch(), 5000); return () => clearInterval(id); }, []);")], false).failures.length === 1],
    ["polling options exported by value are followed",
      checkLiveRegions([view("t/src/lib/poll.ts", "export const pollOpts = { refetchInterval: 5000 };\nexport function useUnrelated() { return 1; }"), view("t/src/pages/Q.tsx", 'import { pollOpts } from "../lib/poll";\nuseQuery({ ...pollOpts });')], false).failures.length === 1],
    ["a wrapper hook imported under an alias is followed",
      checkLiveRegions([view("t/src/lib/feed.ts", "export function useFeed() { return useQuery({ refetchInterval: 5 }); }"), view("t/src/pages/D.tsx", 'import { useFeed as useF } from "../lib/feed";\nconst f = useF(); return <div/>;')], false).failures.length === 1],
    ["a default-exported wrapper hook imported under any name is followed",
      checkLiveRegions([view("t/src/lib/feed.ts", "export default function useFeed() { return useQuery({ refetchInterval: 5 }); }"), view("t/src/pages/D.tsx", 'import useThing from "../lib/feed";\nconst f = useThing(); return <div/>;')], false).failures.length === 1],
    ["a polling component does not make the file rendering it a polling view",
      checkLiveRegions([view("t/src/pages/Dash.tsx", "export function Dash() { useQuery({ refetchInterval: 5 }); return <LiveRegion message=\"x\" />; }"), view("t/src/App.tsx", 'import { Dash } from "./pages/Dash";\n<Dash />')], false).polling.length === 1],
    ["a wrapper exported `as default` and imported under any name is followed",
      checkLiveRegions([view("t/src/lib/feed.ts", "function useFeed() { return useQuery({ refetchInterval: 5 }); }\nexport { useFeed as default };"), view("t/src/pages/D.tsx", 'import useThing from "../lib/feed";\nconst f = useThing(); return <div/>;')], false).failures.length === 1],
    ["an anonymous default-exported polling function is followed",
      checkLiveRegions([view("t/src/lib/feed.ts", "export default () => useQuery({ refetchInterval: 5 });"), view("t/src/pages/D.tsx", 'import useThing from "../lib/feed";\nconst f = useThing(); return <div/>;')], false).failures.length === 1],
    ["a self-rescheduling setTimeout refetch loop is polling",
      checkLiveRegions([view("t/src/pages/P.tsx", "useEffect(() => { setTimeout(function tick() { q.refetch(); setTimeout(tick, 5000); }, 5000); }, []);")], false).failures.length === 1],
    ["a default-exported polling component does not make its importer a polling view",
      checkLiveRegions([view("t/src/pages/Dash.tsx", "export default function Dash() { useQuery({ refetchInterval: 5 }); return <LiveRegion message=\"x\" />; }"), view("t/src/App.tsx", 'import Dash from "./pages/Dash";\n<Dash />')], false).polling.length === 1],
    ["an upper-case default-exported options value is followed",
      ["const POLL = { refetchInterval: 5000 };\nexport default POLL;", "const POLL = { refetchInterval: 5000 };\nexport { POLL as default };", "export default Object.freeze({ refetchInterval: 5000 });"].every((lib) =>
        checkLiveRegions([view("t/src/lib/feed.ts", lib), view("t/src/pages/P.tsx", 'import opts from "../lib/feed";\nuseQuery({ ...opts }); return null;')], false).failures.length === 1)],
    ["a PascalCase default-exported component bound by name is not followed",
      checkLiveRegions([view("t/src/pages/Dash.tsx", "function Dash() { useQuery({ refetchInterval: 5 }); return <LiveRegion message=\"x\" />; }\nexport default Dash;"), view("t/src/App.tsx", 'import Dash from "./pages/Dash";\n<Dash />')], false).polling.length === 1],
    ["UPPER and PascalCase named options exported from a .ts are followed",
      ["export const POLL_OPTS = { refetchInterval: 5000 };|POLL_OPTS", "export const PollOpts = { refetchInterval: 5000 };|PollOpts", "const POLL = { refetchInterval: 5000 };\nexport { POLL };|POLL as P"].every((c) => { const [lib, imp] = c.split("|"); const local = imp.split(" as ").pop();
        return checkLiveRegions([view("t/src/lib/feed.ts", lib), view("t/src/pages/P.tsx", `import { ${imp} } from "../lib/feed";\nuseQuery({ ...${local} }); return null;`)], false).failures.length === 1; })],
    ["a PascalCase default value or function from a .ts is followed",
      ["const Poll = { refetchInterval: 5000 };\nexport default Poll;", "const Poll = { refetchInterval: 5000 };\nexport { Poll as default };", "export default function Feed() { return { refetchInterval: 5000 }; }"].every((lib) =>
        checkLiveRegions([view("t/src/lib/feed.ts", lib), view("t/src/pages/P.tsx", 'import opts from "../lib/feed";\nuseQuery({ ...opts }); return null;')], false).failures.length === 1)],
    ["a namespace import of a polling .ts default is followed",
      checkLiveRegions([view("t/src/lib/feed.ts", "const Poll = { refetchInterval: 5000 };\nexport default Poll;"), view("t/src/pages/P.tsx", 'import * as F from "../lib/feed";\nuseQuery({ ...F.default }); return null;')], false).failures.length === 1],
    ["a default bound beside a namespace (`import D, * as F`) is followed",
      checkLiveRegions([view("t/src/lib/feed.ts", "const Poll = { refetchInterval: 5000 };\nexport default Poll;"), view("t/src/pages/P.tsx", 'import D, * as F from "../lib/feed";\nuseQuery({ ...D }); return null;')], false).failures.length === 1],
    ["a hook re-exported from another module fails closed",
      checkLiveRegions([view("t/src/lib/feed.ts", 'export { useListPolicies as useFeed } from "@workspace/api-client-react";')], false).failures.length === 1],
    ["a hook bound to another name without a call fails closed",
      checkLiveRegions([view("t/src/lib/feed.ts", "export const useFeed = useListPolicies;")], false).failures.length === 1],
    ["an empty reduced-motion block does not count",
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) {}").length === 1],
    ["icon-only raw <button> without aria-label fails",
      checkIconButtons("x.tsx", '<button\n onClick={() => open(true)}\n>\n<svg width="16"><rect y="2" /></svg>\n</button>').length === 1],
    ["icon-only raw <button> with aria-label passes",
      checkIconButtons("x.tsx", '<button onClick={() => open(true)} aria-label="Open navigation"><svg /></button>').length === 0],
    ["raw <button> with text passes",
      checkIconButtons("x.tsx", '<button onClick={() => go()}><Icon /> Save</button>').length === 0],
    ["a literal smooth scroll fails",
      checkScrollMotion("x.tsx", 'window.scrollTo({ top, behavior: "smooth" });').length === 1],
    ["a preference-chosen scroll behaviour passes",
      checkScrollMotion("x.tsx", 'window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });').length === 0],
    ["stylesheet without reduced-motion fails",
      checkReducedMotion("a.css", "@media (prefers-color-scheme: dark) {}").length === 1],
    ["stylesheet with reduced-motion passes",
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { *, ::before { animation-duration: 0.01ms !important; } }").length === 0],
  ];
  const bad = cases.filter(([, ok]) => !ok);
  for (const [name, ok] of cases) console.log(`${ok ? "ok" : "FAIL"}  ${name}`);
  if (bad.length) { console.error(`FAIL self-test — ${bad.length}/${cases.length} cases`); process.exit(1); }
  console.log(`OK web a11y basics self-test — ${cases.length}/${cases.length} cases`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--self-test")) selfTest();
  else run();
}
