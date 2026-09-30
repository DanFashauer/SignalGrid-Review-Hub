// check-web-a11y-basics — three web accessibility floors from plan row 76.
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
//   1. LIVE REGION. A POLLING VIEW must render <LiveRegion …/> (or an aria-live
//      attribute). A polling view is any hand-written .tsx that declares
//      `refetchInterval`, plus — in a tree whose App.tsx sets refetchInterval as
//      the QueryClient default, so every query polls — every src/pages file that
//      calls a query hook (useQuery / useList* / useGet*).
//   2. ICON BUTTON. A `<Button … size="icon" …>` must carry aria-label or
//      aria-labelledby. The tag is parsed brace-aware; a tag the parser cannot
//      close is a FAILURE, never a skip.
//   3. REDUCED MOTION. Every web tree's src/index.css carries
//      `@media (prefers-reduced-motion: reduce)`.
//
// Fail-closed floors: fewer than five web trees, or zero polling views found,
// fails — a detector that finds nothing is a broken detector, not a clean tree.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TREE_FLOOR = 5;

function tsxFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // components/ui is vendored shadcn/radix, not hand-written view code.
      if (e.name === "node_modules" || e.name === "dist" || (e.name === "ui" && dir.endsWith("components"))) continue;
      out.push(...tsxFiles(p));
    } else if (e.name.endsWith(".tsx")) {
      out.push(p);
    }
  }
  return out;
}

const QUERY_HOOK = /\buse(Query|List[A-Z]\w*|Get[A-Z]\w*)\s*\(/;
const LIVE = /<LiveRegion\b|aria-live=/;

/** Rule 1 over one tree's files. `files` is [{ rel, src }]; `defaultPolls` from App.tsx. */
export function checkLiveRegions(files, defaultPolls) {
  const polling = [];
  const failures = [];
  for (const { rel, src } of files) {
    const base = rel.split("/").pop();
    if (base === "App.tsx" || base === "main.tsx" || base === "LiveRegion.tsx") continue;
    const polls = /\brefetchInterval\b/.test(src) || (defaultPolls && /\/pages\//.test(rel) && QUERY_HOOK.test(src));
    if (!polls) continue;
    polling.push(rel);
    if (!LIVE.test(src)) failures.push(`${rel}: polls but renders no live region (<LiveRegion> / aria-live) — WCAG 4.1.3`);
  }
  return { polling, failures };
}

/** Rule 2 over one file. Returns failure strings. */
export function checkIconButtons(rel, src) {
  const failures = [];
  const re = /<Button\b/g;
  let m;
  while ((m = re.exec(src))) {
    // Scan to the tag's closing `>` at brace depth 0, skipping `=>`.
    let depth = 0;
    let end = -1;
    for (let i = m.index + 7; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0 && src[i - 1] !== "=") { end = i; break; }
    }
    const line = src.slice(0, m.index).split("\n").length;
    if (end < 0) { failures.push(`${rel}:${line}: <Button> tag could not be parsed — failing closed`); continue; }
    const tag = src.slice(m.index, end);
    if (/\bsize=["{]\s*["']?icon["']?/.test(tag) && !/\baria-label(ledby)?=/.test(tag)) {
      failures.push(`${rel}:${line}: icon-only <Button size="icon"> has no aria-label — its accessible name is empty (WCAG 4.1.2)`);
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
  for (const tree of trees) {
    const css = join(tree, "src", "index.css");
    failures.push(...checkReducedMotion(relative(repo, css), readFileSync(css, "utf8")));
    const files = tsxFiles(join(tree, "src")).map((p) => ({ rel: relative(repo, p), src: readFileSync(p, "utf8") }));
    const app = files.find((f) => f.rel.endsWith("/src/App.tsx"));
    const defaultPolls = !!app && /defaultOptions[\s\S]{0,200}refetchInterval/.test(app.src);
    const lr = checkLiveRegions(files, defaultPolls);
    pollingTotal += lr.polling.length;
    failures.push(...lr.failures);
    for (const f of files) {
      buttons += (f.src.match(/<Button\b/g) ?? []).length;
      failures.push(...checkIconButtons(f.rel, f.src));
    }
  }
  if (pollingTotal === 0) failures.push("zero polling views found — the detector is broken, not the tree clean");
  if (failures.length) {
    for (const f of failures) console.error(`✗ ${f}`);
    console.error(`FAIL web a11y basics — ${failures.length} finding(s)`);
    process.exit(1);
  }
  console.log(`OK web a11y basics — ${trees.length} trees reduce motion; ${pollingTotal} polling views each render a live region; ${buttons} <Button> tags, every icon-only one labelled`);
}

function selfTest() {
  const cases = [
    ["polling view without a live region fails",
      checkLiveRegions([{ rel: "t/src/pages/A.tsx", src: "useQuery({ refetchInterval: 5 }); return <div/>;" }], false).failures.length === 1],
    ["polling view with <LiveRegion> passes",
      checkLiveRegions([{ rel: "t/src/pages/A.tsx", src: "useQuery({ refetchInterval: 5 }); <LiveRegion message=\"x\" />" }], false).failures.length === 0],
    ["default-polling tree: page with a list hook and no live region fails",
      checkLiveRegions([{ rel: "t/src/pages/B.tsx", src: "const { data } = useListThings();" }], true).failures.length === 1],
    ["non-default tree: page with a list hook is not a polling view",
      checkLiveRegions([{ rel: "t/src/pages/B.tsx", src: "const { data } = useListThings();" }], false).polling.length === 0],
    ["unlabelled icon button fails",
      checkIconButtons("x.tsx", '<Button\n variant="ghost"\n size="icon"\n onClick={() => remove(i)}\n>\n<Trash2 /></Button>').length === 1],
    ["labelled icon button passes",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={() => remove(i)} aria-label={`Delete rule ${i}`}><Trash2 /></Button>').length === 0],
    ["text button without size=icon passes",
      checkIconButtons("x.tsx", '<Button onClick={() => go()}>Save</Button>').length === 0],
    ["unclosable <Button tag fails closed",
      checkIconButtons("x.tsx", '<Button size="icon" onClick={() => {').length === 1],
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
