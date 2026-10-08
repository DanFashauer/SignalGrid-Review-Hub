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
// `(?<![\w-])` so `data-aria-live="polite"` is not read as a live region.
const LIVE = /<LiveRegion\b|(?<![\w-])aria-live=\{?\s*["'`](polite|assertive)["'`]/;
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
  const names = new Set();   // named exports of polling files, any module
  const exportsOf = new Map(); // polling file -> the names it carries
  // A .ts file renders no JSX, so nothing it exports is a component: every
  // default export of a polling .ts is followed, whatever its name.
  const defaultCarries = (rel) => {
    const code = parsed.find((x) => x.rel === rel).code;
    return rel.endsWith(".ts") ? hasDefaultExport(code) : defaultIsHookOrValue(code);
  };
  // A name carries polling only where it is imported: from a polling file that
  // exports it, or from a specifier the gate cannot resolve (another package, a
  // path outside the tree) — there it is followed by name and fails closed. A
  // local identifier that merely shares a polling export's name (`state`) is not.
  const carried = (target, orig) => (target ? polls.has(target) && (exportsOf.get(target)?.has(orig) ?? false) : names.has(orig));
  const usesPolling = (f) => {
    const local = new Set();
    // `import * as NS from "./polling"`: NS.default carries a followable default.
    for (const m of f.code.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g)) {
      const target = resolveImport(f.rel, m[3], rels);
      if (target && polls.has(target)) {
        if (defaultCarries(target)) local.add(`${m[2]}.default`);
        if (m[1] && defaultCarries(target)) local.add(m[1]);
      }
      for (const n of target ? (polls.has(target) ? exportsOf.get(target) ?? [] : []) : names) local.add(`${m[2]}.${n}`);
    }
    for (const m of f.code.matchAll(/import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g)) {
      const target = resolveImport(f.rel, m[3], rels);
      if (m[1] && target && polls.has(target) && defaultCarries(target)) local.add(m[1]);
      for (const part of (m[2] ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
        const [orig, alias] = part.replace(/^type\s+/, "").split(/\s+as\s+/).map((x) => x.trim());
        if (orig === "default" ? target && polls.has(target) && defaultCarries(target) : carried(target, orig)) local.add(alias ?? orig);
      }
    }
    // A polling name used with no import binding it (an ambient or auto-imported
    // hook) still carries polling unless this file declares that name itself.
    const body = f.code.replace(/import[^;]*?from\s*["'][^"']+["'];?/g, "");
    const bound = new Set();
    for (const m of f.code.matchAll(/import\s+(?:type\s+)?([^;]*?)\s+from\s*["'][^"']+["']/g)) for (const id of m[1].match(/[A-Za-z_$][\w$]*/g) ?? []) bound.add(id);
    const declares = (n) => new RegExp(`(?:\\b(?:const|let|var|function\\*?|class)\\s+${escapeRegExp(n)}(?![\\w$])|\\b(?:const|let|var)\\s*[\\[{][^=]*(?<![\\w$.])${escapeRegExp(n)}(?![\\w$])[^=]*[\\]}]\\s*=)`).test(body);
    for (const n of names) if (!bound.has(n) && !declares(n)) local.add(n);
    return [...local].some((n) => new RegExp(`(?<![\\w$])${escapeRegExp(n)}(?![\\w$])`).test(body));
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of parsed) {
      if (polls.has(f.rel)) continue;
      // A timer driving a refetch polls: setInterval, or a setTimeout loop that re-arms itself.
      // So does a timer invalidating or resetting queries: TanStack refetches the active ones.
      // `setInterval(refetch, 5000)` passes the function itself, so no `(` follows it.
      const intervalRefetch = /\bset(Interval|Timeout)\s*\(/.test(f.code) && /\b(?:refetch\w*|invalidateQueries|resetQueries)\b/.test(f.code);
      if (/\brefetchInterval\b/.test(f.code) || intervalRefetch || (defaultPolls && callsQueryHook(f.code, generated)) || usesPolling(f)) {
        polls.add(f.rel);
        // A component renders its own live region, so it does not carry polling
        // to the file rendering it. Only a PascalCase name (upper then lower
        // case) in a .tsx counts as a component; every other export — hooks,
        // values, SCREAMING_CASE options, and anything from a .ts — is followed.
        const isTs = f.rel.endsWith(".ts");
        const carries = new Set([...exportedNames(f.code)].filter((n) => isTs || !new RegExp(`^${PASCAL}$`).test(n)));
        exportsOf.set(f.rel, carries);
        for (const n of carries) names.add(n);
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

/** The `{…}` expression of attribute `name` in an opening tag, "" if absent, null if unbalanced. */
function attrExpression(tag, name) {
  const m = new RegExp(`(?<![\\w-])${name}\\s*=\\s*\\{`).exec(tag);
  if (!m) return "";
  for (let i = m.index + m[0].length, depth = 1; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(m.index + m[0].length, i);
  }
  return null;
}

/**
 * What a <LiveRegion> says, over one file. A query keeps its last `data` when a
 * refetch fails, so an `alert` gated on that data being absent (`error && !data`)
 * goes silent for every outage after the first load. And a `message` naming the
 * latest record (`…[0]`) must carry that record's identity: two records with the
 * same outcome otherwise produce the same text, and unchanged text is not announced.
 */
export function checkLiveRegionText(rel, raw) {
  const src = stripComments(raw);
  const failures = [];
  for (const m of src.matchAll(/<LiveRegion\b/g)) {
    const line = src.slice(0, m.index).split("\n").length;
    const tag = openingTag(src, m.index);
    const alert = tag === null ? null : attrExpression(tag, "alert");
    const message = tag === null ? null : attrExpression(tag, "message");
    if (alert === null || message === null) { failures.push(`${rel}:${line}: <LiveRegion> could not be parsed — failing closed`); continue; }
    // `!data`, `!v1Decisions`, `!metrics.data` — a missing VALUE, not a flag (`!isLoading`)
    // or a member test (`!data.chain.valid`).
    if (/&&\s*!\s*(?:(?!(?:is|has)[A-Z])[\w$]+|[\w$.?]+\??\.data)(?![\w$?.(])/.test(alert)) failures.push(`${rel}:${line}: <LiveRegion> alert is suppressed while cached data remains (\`&& !…\`) — a failed refetch after the first load is silent (WCAG 4.1.3)`);
    const identity = /\[(?:0|[^\]]*\.length\s*-\s*1)\]\??\.(?:id|createdAt|evaluatedAt|recordedAt)\b/.test(message);
    if (/\[0\]/.test(message) && !identity) {
      failures.push(`${rel}:${line}: <LiveRegion> message names the latest record without its identity (id or time) — a new record with the same outcome is not announced (WCAG 4.1.3)`);
    }
    // A capped decision list can take a new record and drop an old one with the
    // same outcome: its counts do not change, so counts alone announce nothing.
    if (/\.length\b/.test(message) && /\b(?:decisions?|(?:audit )?events?)\b/i.test(message) && !identity) {
      failures.push(`${rel}:${line}: <LiveRegion> message counts decisions or audit events without naming the newest record (id or time) — a new decision that leaves the counts unchanged is not announced (WCAG 4.1.3)`);
    }
  }
  return failures;
}

/** What an alert says it lost: "Signal feed" in "Signal feed unreachable …". */
const alertSubject = (text) => text.match(/^(.*?)\s+(?:unreachable|could not)\b/i)?.[1].trim().toLowerCase() ?? null;

/**
 * One assertive alert per outage. A layout shell (components/*Layout*) is on
 * screen on every page, so when its <LiveRegion> alerts that a source is down,
 * a page alerting the same source interrupts the user twice for one outage.
 * Over one tree's files; returns failure strings.
 */
export function checkSharedAlerts(files) {
  const alertsOf = (src) => {
    const out = [];
    const code = stripComments(src);
    for (const m of code.matchAll(/<LiveRegion\b/g)) {
      const tag = openingTag(code, m.index);
      const alert = tag === null ? null : attrExpression(tag, "alert");
      if (!alert) continue;
      for (const q of alert.matchAll(/(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g)) {
        const subject = alertSubject(q[2]);
        if (subject) out.push({ subject, line: code.slice(0, m.index).split("\n").length });
      }
    }
    return out;
  };
  const shells = files.filter((f) => /\/components\/[^/]*Layout[^/]*\.tsx$/.test(f.rel));
  const owned = new Map();
  for (const f of shells) for (const a of alertsOf(f.src)) owned.set(a.subject, f.rel);
  const failures = [];
  for (const f of files) {
    if (shells.includes(f)) continue;
    for (const a of alertsOf(f.src)) {
      if (owned.has(a.subject)) failures.push(`${f.rel}:${a.line}: <LiveRegion> alerts "${a.subject}" down, which ${owned.get(a.subject)} already announces on every page — one outage, two assertive interruptions`);
    }
  }
  return failures;
}

/**
 * The LiveRegion component itself: a polite channel (`aria-live="polite"`) and an
 * assertive one carried by `role="alert"` ALONE — role="alert" already implies
 * assertive, atomic live semantics, and adding aria-live="assertive" to it makes
 * VoiceOver on iOS speak every alert twice (MDN, live-region compatibility).
 */
export function checkLiveRegionComponent(raw) {
  const code = stripComments(raw);
  const out = [];
  if (!/(?<![\w-])aria-live="polite"/.test(code)) out.push('no longer declares a polite channel (aria-live="polite")');
  if (!/\brole="alert"/.test(code)) out.push('no longer declares an assertive channel (role="alert")');
  for (const m of code.matchAll(/<[A-Za-z][^>]*\brole="alert"[^>]*>/g)) {
    if (/(?<![\w-])aria-live=/.test(m[0])) out.push('puts aria-live on its role="alert" region — VoiceOver on iOS speaks such an alert twice');
  }
  return out;
}

/** Text of the JSX opening tag starting at `index`, brace-aware; null if unclosed. */
function openingTag(src, index) {
  let depth = 0;
  for (let i = index + 1; i < src.length; i++) {
    const c = src[i];
    // A quoted attribute value may hold `>` (`title="a>b"`, `title = "a>b"`): skip it whole.
    if (depth === 0 && (c === '"' || c === "'") && /=\s*$/.test(src.slice(index, i))) {
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
// Text made only of symbols and punctuation (`×`, `✕`, `→`, `…`) is read out as
// the glyph's name, not the action: it does not name a button.
export const isGlyphOnly = (text) => !isBlank(text) && /^[\p{S}\p{P}]+$/u.test(text.replace(INVISIBLE, ""));

/** Named HTML entities that are whitespace or invisible; any other name is left as text. */
const NAMED_WS = {
  nbsp: "\u00A0", NonBreakingSpace: "\u00A0", ensp: "\u2002", emsp: "\u2003", emsp13: "\u2004", emsp14: "\u2005",
  numsp: "\u2007", puncsp: "\u2008", thinsp: "\u2009", ThinSpace: "\u2009", hairsp: "\u200A", VeryThinSpace: "\u200A",
  MediumSpace: "\u205F", ThickSpace: "\u205F\u200A", ZeroWidthSpace: "\u200B", NegativeVeryThinSpace: "\u200B",
  NegativeThinSpace: "\u200B", NegativeMediumSpace: "\u200B", NegativeThickSpace: "\u200B", zwnj: "\u200C", zwj: "\u200D",
  NoBreak: "\u2060", Tab: "\t", NewLine: "\n", shy: "\u00AD", lrm: "\u200E", rlm: "\u200F",
  InvisibleTimes: "\u2062", it: "\u2062", InvisibleComma: "\u2063", ic: "\u2063", ApplyFunction: "\u2061", af: "\u2061",
};
// Glyph entities a close, next or more control is commonly written with: decoded so
// that `&times;` is judged as the `×` it renders (a glyph, not a name).
const NAMED_GLYPH = {
  times: "\u00D7", rarr: "\u2192", larr: "\u2190", uarr: "\u2191", darr: "\u2193", raquo: "\u00BB", laquo: "\u00AB",
  rsaquo: "\u203A", lsaquo: "\u2039", hellip: "\u2026", middot: "\u00B7", bull: "\u2022", check: "\u2713", cross: "\u2717",
  minus: "\u2212", plus: "+", ndash: "\u2013", mdash: "\u2014", amp: "&", lt: "<", gt: ">",
};
const codePoint = (n) => (Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "\uFFFD");

/** Decode every numeric character reference and the whitespace named ones. */
export function decodeEntities(text) {
  return text
    .replace(/&#(\d+);/g, (_, d) => codePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&([A-Za-z][A-Za-z0-9]*);/g, (m, n) => NAMED_WS[n] ?? NAMED_GLYPH[n] ?? m);
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
  // With its tags gone, an expression child whose only renderable operand was a
  // tag — `{show && <Trash2 />}`, `{a ? <X /> : null}`, `{null}` — renders no text.
  body = body.replace(/\{([^{}]*)\}/g, (m, inner) => (emptyExpression(inner) ? "" : m));
  return decodeEntities(body);
}

const NOTHING = String.raw`(?:null|undefined|false|true|""|''|\(\s*\))?`;
/** Does this expression (its JSX tags already removed) render nothing at all? */
export function emptyExpression(inner) {
  const t = inner.replace(/\(\s*\)/g, "").trim();
  return new RegExp(`^${NOTHING}$`).test(t) || /&&$/.test(t) ||
    new RegExp(`^[^?:]*\\?\\s*${NOTHING}\\s*:\\s*${NOTHING}$`).test(t);
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
export function hasNonBlankLabel(tag, src = "") {
  // aria-labelledby names the button only through elements that exist: every
  // literal id it lists must be declared in the same file (`id="x"`). An id the
  // gate cannot see, or a computed one, names nothing it can verify — fail closed.
  // …and each target must itself contribute a name: its own non-blank label, or
  // text that is not blank and not a lone glyph. An empty <span id="x" /> names nothing.
  const resolves = (ids) => ids.trim().split(/\s+/).every((id) => {
    const at = new RegExp(`<([A-Za-z][\\w.]*)\\b[^>]*?(?<![\\w-])id\\s*=\\s*(?:["']${escapeRegExp(id)}["']|\\{\\s*["'\`]${escapeRegExp(id)}["'\`]\\s*\\})`).exec(src);
    if (!at) return false;
    const tag = openingTag(src, at.index);
    if (tag === null) return false;
    if (/(?<![\w-])aria-label\s*=\s*["'][^"']*\S[^"']*["']/.test(tag)) return true;
    if (tag.trimEnd().endsWith("/")) return false;
    const text = buttonText(src, at.index + tag.length, at[1]);
    return text !== null && !isBlank(text) && !isGlyphOnly(text);
  });
  // `(?<![\w-])` so `data-aria-label` is not read as a label.
  for (const m of tag.matchAll(/(?<![\w-])aria-label(ledby)?\s*=\s*(?:(["'])([\s\S]*?)\2|\{\s*(["'`])((?:\\[\s\S]|(?!\4)[^\\])*)\4\s*\}|\{)/g)) {
    const byRef = m[1] !== undefined;
    if (m[2] !== undefined) { const v = decodeEntities(m[3]); if (!isBlank(v) && (!byRef || resolves(v))) return true; }
    else if (m[4] !== undefined) { const v = decodeEscapes(m[5]); if (!isBlank(v) && (!byRef || resolves(v))) return true; }
    else if (byRef) continue; // a computed id: cannot be verified
    else {
      // An expression names the button only if it cannot come out empty. React drops
      // an attribute whose value is undefined, null or false, so `{undefined}`, a
      // ternary arm that is one of those (or blank), and `a && "x"` (false when a is)
      // all leave the button unnamed. Anything else the gate cannot evaluate counts.
      const open = m.index + m[0].length - 1;
      let depth = 0, end = -1;
      for (let i = open; i < tag.length; i++) {
        if (tag[i] === "{") depth++;
        else if (tag[i] === "}" && --depth === 0) { end = i; break; }
      }
      if (end < 0) return false; // unclosed: fail closed
      if (!mayBeEmpty(tag.slice(open + 1, end))) return true;
    }
  }
  return false;
}

const EMPTY_VALUE = String.raw`(?:undefined|null|false|""|''|\`\`)`;
/** Can this attribute expression evaluate to nothing (no attribute, or blank)? */
export function mayBeEmpty(expr) {
  const t = expr.trim();
  return new RegExp(`^${EMPTY_VALUE}$`).test(t) || /&&/.test(t) ||
    new RegExp(`[?:]\\s*${EMPTY_VALUE}\\s*(?=:|$)`).test(t) || /\?\?\s*(?:undefined|null)\s*$/.test(t);
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
    if (hasNonBlankLabel(tag, src)) continue;
    // A self-closing <button /> renders an empty control: nothing names it.
    if (tag.trimEnd().endsWith("/")) { failures.push(`${rel}:${line}: self-closing <button /> renders no text and has no aria-label — its accessible name is empty (WCAG 4.1.2)`); continue; }
    const text = buttonText(src, r.index + tag.length);
    if (text === null) { failures.push(`${rel}:${line}: <button> body could not be parsed — failing closed`); continue; }
    if (isBlank(text)) failures.push(`${rel}:${line}: icon-only <button> renders no text and has no aria-label — its accessible name is empty (WCAG 4.1.2)`);
    else if (isGlyphOnly(text)) failures.push(`${rel}:${line}: <button> is named only by a glyph (${text.trim()}) and has no aria-label — it reads as the symbol, not the action (WCAG 4.1.2)`);
  }
  const re = /<Button\b/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    const tag = openingTag(src, m.index);
    if (tag === null) { failures.push(`${rel}:${line}: <Button> tag could not be parsed — failing closed`); continue; }
    // A child text node (an sr-only <span>) names the button as well as aria-label does.
    const childText = tag.trimEnd().endsWith("/") ? "" : buttonText(src, m.index + tag.length, "Button") ?? "";
    const named = hasNonBlankLabel(tag, src) || (!isBlank(childText) && !isGlyphOnly(childText));
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

// Longhands that change how motion runs, not how much of it there is.
const MOTION_NEUTRAL = new Set(["animation-timing-function", "animation-fill-mode", "animation-direction", "animation-play-state", "transition-timing-function", "transition-behavior"]);
const NEAR_ZERO = (v) => v.split(",").every((t) => {
  const m = t.trim().match(/^(\d*\.?\d+)(ms|s)$/);
  return m !== null && Number(m[1]) / (m[2] === "ms" ? 1000 : 1) <= 0.01;
});
/** Does this reduced-motion declaration damp motion? Anything unrecognised does not. */
export function damps(prop, value) {
  const v = value.toLowerCase();
  if (prop === "scroll-behavior") return v === "auto";
  if (prop === "animation" || prop === "transition" || prop === "animation-name" || prop === "transition-property") return v === "none";
  if (prop === "animation-iteration-count") return v === "1" || v === "0";
  if (/-(duration|delay)$/.test(prop)) return NEAR_ZERO(v);
  return false;
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
        // It must actually damp motion: at least one animation-*, transition-*
        // or scroll-behavior declaration, and every one of them damping —
        // `.x { color: red }` reduces nothing, `animation-duration: 99s` or
        // `scroll-behavior: smooth` reverses the block.
        const decls = [...css.slice(m.index + m[0].length, i + 1).matchAll(/(?:^|[\s;{])((?:animation|transition)(?:-[\w-]+)?|scroll-behavior)\s*:\s*([^;{}]+)/g)]
          .map(([, prop, value]) => [prop, value.replace(/!\s*important/, "").trim()])
          .filter(([prop]) => !MOTION_NEUTRAL.has(prop));
        // …and it must damp every family, not just one: a block left with only
        // `scroll-behavior: auto` lets every animation and transition run.
        // …and reach every element: the rule whose selector list holds the bare
        // universal `*` must ITSELF damp all three families. `* { color: red }`
        // beside `.unused { animation: none … }` damps nothing on screen.
        const universal = [...css.slice(m.index + m[0].length, i + 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
          .filter((r) => r[1].split(",").some((sel) => sel.trim() === "*"))
          .some((r) => {
            const own = new Set([...r[2].matchAll(/(?:^|[\s;])((?:animation|transition)(?:-[\w-]+)?|scroll-behavior)\s*:/g)].map((d) => d[1]).filter((p) => !MOTION_NEUTRAL.has(p)).map((p) => p.split("-")[0]));
            return ["animation", "transition", "scroll"].every((f) => own.has(f));
          });
        if (universal && decls.every(([prop, value]) => damps(prop, value))) return [];
        break;
      }
    }
  }
  return [`${rel}: no @media (prefers-reduced-motion: reduce) block whose universal (*) rule damps animation, transition and scroll-behavior — WCAG 2.3.3`];
}

/**
 * Every artifacts/signalgrid-* web package (a vite config, or .tsx under src/),
 * found WITHOUT looking at its stylesheet: a new package whose stylesheet is
 * missing or named differently must fail here, not drop out of the scan.
 */
export function webTreeCandidates(base, dirs, has) {
  const trees = [];
  const missing = [];
  for (const d of dirs.filter((x) => x.startsWith("signalgrid-"))) {
    const isWeb = has(join(base, d, "vite.config.ts")) || has(join(base, d, "vite.config.js")) || has(join(base, d, "vite.config.mts")) || has(join(base, d, "src"), ".tsx");
    if (!isWeb) continue;
    if (has(join(base, d, "src", "index.css"))) trees.push(join(base, d));
    else missing.push(d);
  }
  return { trees, missing };
}

function webTrees() {
  const base = join(repo, "artifacts");
  const has = (p, ext) => (ext ? existsSync(p) && sourceFiles(p).some((f) => f.endsWith(ext)) : existsSync(p));
  return webTreeCandidates(base, readdirSync(base), has);
}

function run() {
  const failures = [];
  const { trees, missing } = webTrees();
  for (const d of missing) failures.push(`artifacts/${d}: a web package with no src/index.css — its reduced-motion rule, live regions and buttons are unchecked (failing closed)`);
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
      for (const why of checkLiveRegionComponent(comp ? comp.src : "")) failures.push(`${treeRel}: components/LiveRegion.tsx ${why}`);
    }
    failures.push(...checkSharedAlerts(files.filter((x) => x.rel.endsWith(".tsx"))));
    pollingTotal += lr.polling.length;
    failures.push(...lr.failures);
    for (const f of files.filter((x) => x.rel.endsWith(".tsx"))) {
      buttons += (f.src.match(/<Button\b/g) ?? []).length;
      rawButtons += (stripComments(f.src).match(/<button\b/g) ?? []).length;
      failures.push(...checkIconButtons(f.rel, f.src));
      failures.push(...checkLiveRegionText(f.rel, f.src));
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
    ["a data-aria-live attribute is not a live region",
      checkLiveRegions([view("t/src/pages/A.tsx", "useQuery({ refetchInterval: 5 }); <div data-aria-live=\"polite\" />")], false).failures.length === 1 &&
      checkLiveRegions([view("t/src/pages/A.tsx", "useQuery({ refetchInterval: 5 }); <div aria-live=\"polite\" />")], false).failures.length === 0],
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
      ['aria-label="Close"', "aria-label={t('close')}", 'aria-labelledby="close-label"'].every((a) => checkIconButtons("x.tsx", `<span id="close-label">Close</span><button onClick={f} ${a}><svg/></button>`).length === 0)],
    ["text inside an aria-hidden child does not name a button",
      ['<span aria-hidden="true">×</span>', "<span aria-hidden>×</span>", "<span aria-hidden={true}>×</span>", '<span aria-hidden="true"><b>×</b></span>'].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}>${c}</button>`).length === 1 && checkIconButtons("x.tsx", `<Button size="icon">${c}</Button>`).length === 1) &&
      checkIconButtons("x.tsx", '<button onClick={f}><svg aria-hidden="true" /><span className="sr-only">Close</span></button>').length === 0 &&
      ['aria-hidden="false"', "aria-hidden={false}", 'aria-hidden={"false"}', 'data-aria-hidden="true"'].every((a) =>
        checkIconButtons("x.tsx", `<button onClick={f}><span ${a}>Close</span></button>`).length === 0) &&
      checkIconButtons("x.tsx", '<button onClick={f}><span aria-hidden="true" data-aria-hidden="false">×</span></button>').length === 1],
    ["a data-aria-label or data-aria-labelledby is not a label",
      ['data-aria-label="Close"', 'data-aria-labelledby="x"'].every((a) =>
        checkIconButtons("x.tsx", `<button onClick={f} ${a}><svg/></button>`).length === 1 && checkIconButtons("x.tsx", `<Button size="icon" ${a}><X /></Button>`).length === 1)],
    ["a same-name child inside an aria-hidden element does not close it early",
      checkIconButtons("x.tsx", '<button onClick={f}><span aria-hidden="true"><span>x</span>Y</span></button>').length === 1 &&
      checkIconButtons("x.tsx", '<button onClick={f}><span aria-hidden="true"><span>x</span></span>Close</button>').length === 0],
    ["a `>` inside a quoted attribute does not end the tag",
      ['title="a>b"', "title='a>b'", 'title = "a>b"'].every((t) =>
        checkIconButtons("x.tsx", `<button onClick={f}><span ${t} aria-hidden="true">×</span></button>`).length === 1) &&
      checkIconButtons("x.tsx", '<button onClick={f} title="a>b"><svg/></button>').length === 1 &&
      checkIconButtons("x.tsx", '<button onClick={f} title="a>b">Close</button>').length === 0],
    ["astral invisible characters do not name a button",
      ["&#xE0100;", "&#x1D173;", "&#xE0001;", "&#x1BCA0;", "\\u{E0100}"].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}><svg/>${c.startsWith("&") ? c : `{"${c}"}`}</button>`).length === 1) &&
      checkIconButtons("x.tsx", '<button onClick={f}>&#x1D400;</button>').length === 0],
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
    ["an expression child that renders only a tag (or nothing) does not name a button",
      ['{show && <Trash2 />}', '{show && (<Trash2 />)}', '{a ? <X /> : null}', '{null}'].every((c) =>
        checkIconButtons("x.tsx", `<Button size="icon">${c}</Button>`).length === 1 && checkIconButtons("x.tsx", `<button onClick={f}>${c}</button>`).length === 1) &&
      ['{label}', '{a && "Save"}', '{show && <span>Save</span>}'].every((c) => checkIconButtons("x.tsx", `<button onClick={f}>${c}</button>`).length === 0)],
    ["a reduced-motion block must damp all three motion families",
      ["scroll-behavior: auto", "animation-duration: 0.01ms; scroll-behavior: auto", "animation: none; transition: none"].every((d) =>
        checkReducedMotion("a.css", `@media (prefers-reduced-motion: reduce) { * { ${d}; } }`).length === 1) &&
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; scroll-behavior: auto; } }").length === 0],
    ["a timer that invalidates or resets queries polls",
      ["setInterval(() => qc.invalidateQueries({ queryKey: k }), 5000)", "setTimeout(function t() { qc.resetQueries(); setTimeout(t, 5000); }, 5000)"].every((c) =>
        checkLiveRegions([view("t/src/pages/T.tsx", `${c}; return <div/>;`)], false).failures.length === 1)],
    ["a reduced-motion block whose declarations do not damp motion does not count",
      ["animation-duration: 99s", "scroll-behavior: smooth", "transition-duration: 0.01ms; animation-duration: 2s", "animation-iteration-count: infinite", "transition: opacity 1s"].every((d) =>
        checkReducedMotion("a.css", `@media (prefers-reduced-motion: reduce) { * { ${d}; } }`).length === 1) &&
      ["animation: none", "transition-duration: 0s !important", "scroll-behavior: auto", "animation-duration: 10ms; animation-timing-function: linear"].every((d) =>
        checkReducedMotion("a.css", `@media (prefers-reduced-motion: reduce) { * { animation: none; transition: none; scroll-behavior: auto; ${d}; } }`).length === 0)],
    ["a live-region alert gated on cached data being absent is flagged",
      checkLiveRegionText("x.tsx", '<LiveRegion message="" alert={isError && !data ? "Feed down." : ""} />').length === 1 &&
      checkLiveRegionText("x.tsx", '<LiveRegion message="" alert={m.error && !m.data ? "Down." : ""} />').length === 1 &&
      ['alert={isError ? "Feed down." : ""}', 'alert={error ? "x" : data && !data.chain.valid ? "Broken." : ""}', 'alert={isError && !isLoading ? "x" : ""}'].every((a) =>
        checkLiveRegionText("x.tsx", `<LiveRegion message="" ${a} />`).length === 0)],
    ["a live-region message naming the latest record must carry its identity",
      checkLiveRegionText("x.tsx", '<LiveRegion message={d?.[0] ? `Latest: ${d[0].outcome}.` : ""} />').length === 1 &&
      checkLiveRegionText("x.tsx", '<LiveRegion message={d?.[0] ? `Latest: ${d[0].outcome}, record ${d[0].id}.` : ""} />').length === 0],
    ["a local name that matches a polling export is not polling; an import of it is",
      (() => {
        const poll = view("t/src/lib/poll.ts", "export const state = useQuery({ refetchInterval: 5 });");
        const other = view("t/src/lib/other.ts", "export const state = 1;");
        const run = (page) => checkLiveRegions([poll, other, view("t/src/pages/P.tsx", page)], false).polling.includes("t/src/pages/P.tsx");
        return !run("const state = 1; return <div>{state}</div>;") &&
          !run('import { state } from "../lib/other"; return <div>{state}</div>;') &&
          run('import { state } from "../lib/poll"; return <div>{state}</div>;') &&
          run('import * as P from "../lib/poll"; return <div>{P.state}</div>;');
      })()],
    ["a decision-list announcement names its newest record",
      checkLiveRegionText("x.tsx", '<LiveRegion message={d ? `${d.length} decisions shown.` : ""} />').length === 1 &&
      checkLiveRegionText("x.tsx", '<LiveRegion message={d ? `${d.length} decisions shown, newest ${d[0].id}.` : ""} />').length === 0 &&
      checkLiveRegionText("x.tsx", '<LiveRegion message={s ? `${s.length} signals.` : ""} />').length === 0],
    ["a page does not re-alert an outage its layout shell already announces",
      checkSharedAlerts([view("t/src/components/AppLayout.tsx", '<LiveRegion message="" alert={e ? "Signal feed unreachable — state unknown." : ""} />'),
        view("t/src/pages/S.tsx", '<LiveRegion message="" alert={e ? "Signal feed unreachable; count unknown." : ""} />')]).length === 1 &&
      checkSharedAlerts([view("t/src/components/AppLayout.tsx", '<LiveRegion message="" alert={e ? "Signal feed unreachable." : ""} />'),
        view("t/src/pages/D.tsx", '<LiveRegion message="" alert={e ? "Decisions could not be loaded." : ""} />')]).length === 0],
    ["a button named only by a glyph is not named",
      ["×", "✕", "&times;", "→", "…"].every((c) =>
        checkIconButtons("x.tsx", `<button onClick={f}>${c}</button>`).length === 1 && checkIconButtons("x.tsx", `<Button size="icon">${c}</Button>`).length === 1) &&
      checkIconButtons("x.tsx", '<button onClick={f} aria-label="Close">×</button>').length === 0 &&
      checkIconButtons("x.tsx", '<button onClick={f}>× Close</button>').length === 0],
    ["a label expression that can come out empty does not name a button",
      ['aria-label={undefined}', 'aria-label={null}', 'aria-label={open ? "Close" : undefined}', 'aria-label={open && "Close"}', 'aria-labelledby={id ?? undefined}', 'aria-label={x ? "" : "Close"}'].every((a) =>
        checkIconButtons("x.tsx", `<button onClick={f} ${a}><svg/></button>`).length === 1 && checkIconButtons("x.tsx", `<Button size="icon" ${a}><X /></Button>`).length === 1) &&
      ['aria-label={t("close")}', 'aria-label={open ? "Close" : "Open"}', 'aria-label={`Delete rule ${i + 1}`}', 'aria-label={!known ? "Alerts, state unknown" : `Alerts, ${n} active`}'].every((a) =>
        checkIconButtons("x.tsx", `<button onClick={f} ${a}><svg/></button>`).length === 0)],
    ["the LiveRegion component keeps a polite channel and a role=alert channel without a redundant aria-live",
      checkLiveRegionComponent('<div role="status" aria-live="polite" aria-atomic="true">{m}</div><div role="alert" aria-atomic="true">{a}</div>').length === 0 &&
      checkLiveRegionComponent('<div role="status" aria-live="polite">{m}</div><div role="alert" aria-live="assertive" aria-atomic="true">{a}</div>').length === 1 &&
      checkLiveRegionComponent('<div role="status" aria-live="polite">{m}</div>').length === 1],
    ["aria-labelledby names a button only through an id the file declares",
      checkIconButtons("x.tsx", '<button onClick={f} aria-labelledby="missing"><svg/></button>').length === 1 &&
      checkIconButtons("x.tsx", '<button onClick={f} aria-labelledby={labelId}><svg/></button>').length === 1 &&
      checkIconButtons("x.tsx", '<span id="close-label">Close</span><button onClick={f} aria-labelledby="close-label"><svg/></button>').length === 0 &&
      checkIconButtons("x.tsx", '<span id="a">x</span><button onClick={f} aria-labelledby="a b"><svg/></button>').length === 1],
    ["a self-closing button with no label is unnamed",
      checkIconButtons("x.tsx", '<button onClick={close} />').length === 1 &&
      checkIconButtons("x.tsx", '<button onClick={close} aria-label="Close" />').length === 0 &&
      checkIconButtons("x.tsx", '<Button size="icon" onClick={close} />').length === 1],
    ["the universal rule itself must damp all three motion families",
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { * { color: red; } .unused { animation: none; transition: none; scroll-behavior: auto; } }").length === 1 &&
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { * { animation: none; } .x { transition: none; scroll-behavior: auto; } }").length === 1 &&
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { *, *::before { animation: none; transition: none; scroll-behavior: auto; } }").length === 0],
    ["a refetch passed to a timer as its callback polls",
      ["setInterval(refetch, 5000)", "setTimeout(function tick() { refetchAll(); setTimeout(tick, 5000); }, 5000)", "const id = setInterval(refetchFeed, 3000)"].every((c) =>
        checkLiveRegions([view("t/src/pages/T.tsx", `${c}; return <div/>;`)], false).failures.length === 1)],
    ["an aria-labelledby target must itself carry a name",
      checkIconButtons("x.tsx", '<span id="close"></span><button onClick={f} aria-labelledby="close"><svg/></button>').length === 1 &&
      checkIconButtons("x.tsx", '<span id="close" /><button onClick={f} aria-labelledby="close"><svg/></button>').length === 1 &&
      checkIconButtons("x.tsx", '<span id="close">×</span><button onClick={f} aria-labelledby="close"><svg/></button>').length === 1 &&
      checkIconButtons("x.tsx", '<span id="close" aria-label="Close dialog" /><button onClick={f} aria-labelledby="close"><svg/></button>').length === 0 &&
      checkIconButtons("x.tsx", '<span id="close">Close</span><button onClick={f} aria-labelledby="close"><svg/></button>').length === 0],
    ["a web package without src/index.css fails instead of dropping out of the scan",
      (() => {
        const files = new Set(["b/signalgrid-a/vite.config.ts", "b/signalgrid-a/src/index.css", "b/signalgrid-new/vite.config.ts", "b/signalgrid-new/src/styles.css", "b/signalgrid-lib/README.md"]);
        const has = (p, ext) => (ext ? p === "b/signalgrid-x/src" : files.has(p));
        const r = webTreeCandidates("b", ["signalgrid-a", "signalgrid-new", "signalgrid-lib", "other"], has);
        return r.trees.length === 1 && r.missing.length === 1 && r.missing[0] === "signalgrid-new";
      })()],
    ["an audit-event count names the newest event",
      checkLiveRegionText("x.tsx", '<LiveRegion message={d ? `${d.events.length} audit events. Hash chain intact.` : ""} />').length === 1 &&
      checkLiveRegionText("x.tsx", '<LiveRegion message={d ? `${d.events.length} audit events, newest ${d.events[d.events.length - 1]?.id}.` : ""} />').length === 0],
    ["a reduced-motion block must reach every element through a universal rule",
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { .unused { animation: none; transition: none; scroll-behavior: auto; } }").length === 1 &&
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { *, *::before { animation: none; transition: none; scroll-behavior: auto; } }").length === 0],
    ["stylesheet without reduced-motion fails",
      checkReducedMotion("a.css", "@media (prefers-color-scheme: dark) {}").length === 1],
    ["stylesheet with reduced-motion passes",
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { *, ::before { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }").length === 0],
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
