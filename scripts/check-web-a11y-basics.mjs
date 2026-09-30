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
//      file POLLS when it declares `refetchInterval`, when its tree's query
//      defaults poll and it calls a query hook, or when it calls a hook exported
//      by a file that polls (a wrapper in a .ts file is followed, to a fixpoint).
//      Query defaults are read from every .ts/.tsx in the tree — the balanced
//      argument list of each `new QueryClient(…)`, `setDefaultOptions(…)` and
//      `setQueryDefaults(…)`, wherever the construction lives.
//   2. ICON BUTTON. A `<Button … size="icon" …>` must carry aria-label or
//      aria-labelledby. The tag is parsed brace-aware; a tag the parser cannot
//      close is a FAILURE, never a skip.
//   3. REDUCED MOTION. Every web tree's src/index.css carries
//      `@media (prefers-reduced-motion: reduce)`.
//   4. JS MOTION. recharts 2.x animates in JavaScript and never reads the media
//      query, so CSS cannot reach it: every recharts series element — named,
//      aliased or namespaced — must set `isAnimationActive={false}` or
//      `isAnimationActive={!x}` where `x = usePrefersReducedMotion()` in the
//      same file. `{true}` or any other value is not gated motion.
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
const TREE_FLOOR = 5;

function sourceFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // components/ui is vendored shadcn/radix, not hand-written view code.
      if (e.name === "node_modules" || e.name === "dist" || (e.name === "ui" && dir.endsWith("components"))) continue;
      out.push(...sourceFiles(p));
    } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

const QUERY_HOOK = /\buse(Query|Queries|InfiniteQuery|SuspenseQuery|SuspenseQueries|SuspenseInfiniteQuery|List[A-Z]\w*|Get[A-Z]\w*)\s*\(/;
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
  for (const { rel, src: raw } of files) {
    const src = stripComments(raw);
    if (/\bQueryClientProvider\b/.test(src)) providers++;
    constructions += (src.match(/new\s+QueryClient\s*\(/g) ?? []).length;
    const { spans, unbalanced } = callSpans(src, DEFAULTS_CALL);
    if (unbalanced) unparsed.push(rel);
    for (const [a, b] of spans) if (/\brefetchInterval\b/.test(src.slice(a, b))) polls = true;
  }
  return { polls, constructions, providers, unparsed };
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

/**
 * Rule 1 over one tree's files. `files` is [{ rel, src }]; `defaultPolls` from
 * queryDefaults. Returns { polling (views), failures }.
 */
export function checkLiveRegions(files, defaultPolls) {
  const failures = [];
  const skip = (rel) => /\/(App|main|LiveRegion)\.tsx$/.test(rel);
  const parsed = files.filter((f) => !skip(f.rel)).map((f) => ({ ...f, code: withoutDefaultsCalls(stripComments(f.src)) }));
  const polls = new Set();
  const hooks = new Set();
  // Fixpoint: a file calling a hook exported by a polling file polls too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of parsed) {
      if (polls.has(f.rel)) continue;
      const callsWrapper = [...hooks].some((h) => new RegExp(`\\b${h}\\s*\\(`).test(f.code) && !exportedHooks(f.code).includes(h));
      if (/\brefetchInterval\b/.test(f.code) || (defaultPolls && QUERY_HOOK.test(f.code)) || callsWrapper) {
        polls.add(f.rel);
        for (const h of exportedHooks(f.code)) hooks.add(h);
        changed = true;
      }
    }
  }
  const polling = [];
  for (const f of parsed) {
    if (!polls.has(f.rel)) continue;
    if (f.rel.endsWith(".ts")) {
      if (exportedHooks(f.code).length === 0) failures.push(`${f.rel}: polls but exports no use* hook the gate can follow — failing closed`);
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
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && src[i - 1] !== "=") return src.slice(index, i);
  }
  return null;
}

/** Rule 2 over one file. Returns failure strings. */
export function checkIconButtons(rel, raw) {
  const src = stripComments(raw);
  const failures = [];
  const re = /<Button\b/g;
  let m;
  while ((m = re.exec(src))) {
    const line = src.slice(0, m.index).split("\n").length;
    const tag = openingTag(src, m.index);
    if (tag === null) { failures.push(`${rel}:${line}: <Button> tag could not be parsed — failing closed`); continue; }
    if (/\bsize=["{]\s*["']?icon["']?/.test(tag) && !/\baria-label(ledby)?=/.test(tag)) {
      failures.push(`${rel}:${line}: icon-only <Button size="icon"> has no aria-label — its accessible name is empty (WCAG 4.1.2)`);
    }
  }
  return failures;
}

const SERIES = ["Area", "Bar", "Line", "Pie", "Radar", "RadialBar", "Scatter", "Funnel"];
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
    const re = new RegExp(`<${name.replace(".", "\\.")}(?=[\\s/>])`, "g");
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

/** Rule 3 over one stylesheet. */
export function checkReducedMotion(rel, css) {
  return /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(css)
    ? []
    : [`${rel}: no @media (prefers-reduced-motion: reduce) block — WCAG 2.3.3`];
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
  let pollingTotal = 0;
  let buttons = 0;
  let charts = 0;
  for (const tree of trees) {
    const treeRel = relative(repo, tree);
    const css = join(tree, "src", "index.css");
    failures.push(...checkReducedMotion(relative(repo, css), readFileSync(css, "utf8")));
    const files = sourceFiles(join(tree, "src")).map((p) => ({ rel: relative(repo, p), src: readFileSync(p, "utf8") }));
    const qd = queryDefaults(files);
    for (const rel of qd.unparsed) failures.push(`${rel}: a query-defaults call the gate cannot close — failing closed`);
    if (qd.providers > 0 && qd.constructions === 0) {
      failures.push(`${treeRel}: mounts a QueryClientProvider but no \`new QueryClient(…)\` the gate can read — failing closed`);
    }
    const lr = checkLiveRegions(files, qd.polls);
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
      failures.push(...checkIconButtons(f.rel, f.src));
      if (/["']recharts["']/.test(f.src)) charts++;
      failures.push(...checkChartMotion(f.rel, f.src));
    }
  }
  if (pollingTotal === 0) failures.push("zero polling views found — the detector is broken, not the tree clean");
  if (failures.length) {
    for (const f of failures) console.error(`✗ ${f}`);
    console.error(`FAIL web a11y basics — ${failures.length} finding(s)`);
    process.exit(1);
  }
  console.log(`OK web a11y basics — ${trees.length} trees reduce motion; ${pollingTotal} polling views each render a live region; ${buttons} <Button> tags, every icon-only one labelled; ${charts} recharts files, every series animation gated`);
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
    ["a polling .ts file exporting no hook fails closed",
      checkLiveRegions([view("t/src/lib/opts.ts", "export const opts = { refetchInterval: 5 };")], false).failures.length === 1],
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
    ["unlabelled icon button fails",
      checkIconButtons("x.tsx", '<Button\n variant="ghost"\n size="icon"\n onClick={() => remove(i)}\n>\n<Trash2 /></Button>').length === 1],
    ["labelled icon button passes",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={() => remove(i)} aria-label={`Delete rule ${i}`}><Trash2 /></Button>').length === 0],
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
    ["stylesheet without reduced-motion fails",
      checkReducedMotion("a.css", "@media (prefers-color-scheme: dark) {}").length === 1],
    ["stylesheet with reduced-motion passes",
      checkReducedMotion("a.css", "@media (prefers-reduced-motion: reduce) { * {} }").length === 0],
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
