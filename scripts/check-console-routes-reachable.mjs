#!/usr/bin/env node
// Console route-reachability gate — every route the console registers must be
// reachable from the console, and every route that is not a launch screen must
// carry the preview banner.
//
//   node scripts/check-console-routes-reachable.mjs
//   node scripts/check-console-routes-reachable.mjs --self-test
//   node scripts/check-console-routes-reachable.mjs --scan <dir>   (diagnostic, below)
//
// This is the sibling of `check-console-routes.mjs`. That gate asks whether a path the
// console FETCHES is served by the api-server. This one asks the two questions about
// the console's OWN route table that nothing was asking:
//
//   (a) REACHABILITY — is there any way to get here? `/overview` carried the only live
//       /v1 evaluation panel in the console and no href, Link, setLocation or navigate
//       target anywhere under src/ pointed at it. A page nobody can reach is not a
//       feature; it is a claim in the route table with no route to it, and it survives
//       precisely because a deep link still works when you already know the URL — which
//       the author always does and the operator never does.
//
//   (b) THE PREVIEW LAW — App.tsx states it in its own words: "every route OUTSIDE the
//       six launch screens renders this banner above its page … a deep link bypasses
//       the sidebar — the banner cannot be bypassed". A non-launch route that is NOT
//       wrapped in preview() is a fixture surface a partner can mistake for shipped
//       product. That is a claim-discipline defect, not a styling one.
//
// SCOPE IS DERIVED, three ways, none hand-listed:
//   · ROUTES        — every `<Route path="…" component={X}>` in App.tsx.
//   · REFERENCES    — every href / to / setLocation / navigate / push target under
//                     src/, App.tsx excluded (it holds definitions, and a route table
//                     that referenced itself would make every route trivially
//                     reachable). Template literals count: `/decisions/${id}` and the
//                     served `:id` both normalise to `/decisions/:param`, the same
//                     normalisation check-console-routes.mjs uses.
//   · LAUNCH SET    — closed over LAUNCH_NAV in components/layout/AppLayout.tsx. Not
//                     "the paths literally in LAUNCH_NAV": that array holds three
//                     entries, while `/`, `/sessions/:id`, `/audit`, `/status` and
//                     `/connectors/setup` are all launch surfaces reached through them.
//                     So the set is CLOSED three ways, each one derived:
//                       1. prefix — a path under a LAUNCH_NAV href/match;
//                       2. identity — a path rendering the same component as a launch
//                          path (that is what makes `/decisions` a compat ALIAS of
//                          `/sessions` rather than a second product);
//                       3. link closure — a path linked from a launch page's own file
//                          (Settings links Audit and Assurance; DecisionDetail links
//                          Audit). Reached from launch, therefore launch.
//
// ONE-DIRECTIONAL ON PURPOSE. (b) fails a non-launch route that is UNWRAPPED. It does
// NOT fail a launch-reachable route that IS wrapped: Settings links /integrations and
// /fleet, which are correctly preview-labelled fixture surfaces, and "you may not
// label a fixture page as a fixture page" is not a property anyone wants gated.
//
// THE ALLOWLIST is for routes deliberately reached by no link, and it is held to both
// directions so it cannot fossilise: an entry that is not a real route fails, and an
// entry that HAS become reachable fails and must be deleted. Every entry carries its
// reason in the table, not in a commit message.
//
// FAIL-CLOSED: zero routes, zero references, or an empty LAUNCH_NAV is fatal.
// SELF-TEST FIRST: a planted orphan route and a planted unwrapped non-launch route must
// both be flagged, and the correct fixtures must clear, or the gate concludes nothing.
//
// --scan <dir> replaces the console src root; DIAGNOSTIC only. preflight and CI pass no
// arguments and always read the real tree.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_SRC = "artifacts/signalgrid-app/src";
const APP_REL = "App.tsx";
const LAYOUT_REL = "components/layout/AppLayout.tsx";
const LAUNCH_NAV_CONST = "LAUNCH_NAV";

// Floors, measured on the real tree 2026-09-06: 25 routes, 22 distinct navigation
// targets. Set below those; a derivation that stopped parsing must not pass green.
const FLOOR_ROUTES = 15;
const FLOOR_REFS = 12;

/**
 * Routes deliberately reachable by no in-app link. Each entry states WHY, because an
 * allowlist without reasons is just a list of things somebody once wanted to stop
 * hearing about. Both directions are gated below: an entry that is not a route, or an
 * entry that has since become reachable, fails.
 */
// NOTE on an entry that is NOT here: `/` looks like the obvious allowlist candidate
// (wouter matches it when the URL carries no path, so "nothing links to it" reads as
// true by construction). It is false — not-found.tsx links to `/` — and the staleness
// direction below is what said so, on the first run, against an entry written from
// exactly the feeling of being sure that CLAUDE.md warns about. The reverse check
// earns its keep.
const UNLINKED_BY_DESIGN = new Map([
  [
    "/sessions/:param",
    "The canonical session-detail path. The session-detail SCREEN is reachable: every " +
      "link to it in the console (DecisionList's row click, the Dashboard's recent-decisions " +
      "list) targets the /decisions/:id compat alias App.tsx documents, which renders the " +
      "same DecisionDetail component. Allowlisted because the screen is reachable, and " +
      "recorded here rather than hidden because the canonical path being the one nothing " +
      "links to is backwards from docs/PURPOSE.md's 'a session produces an envelope'.",
  ],
]);

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function walk(dir, exts) {
  const out = [];
  const rec = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (exts.some((x) => p.endsWith(x))) out.push(p);
    }
  };
  if (existsSync(dir)) rec(dir);
  return out;
}

const lineOf = (text, idx) => text.slice(0, idx).split("\n").length;

// Normalise a path the way check-console-routes.mjs does: a served `:id` and a
// template `${id}` after a slash both become `:param`; a query string ends the path;
// an interpolation NOT after a slash means the rest is dynamic and the path stops.
function normalisePath(text, start) {
  let out = "";
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "`" || c === '"' || c === "'") break;
    if (c === "?") break;
    if (c === "$" && text[i + 1] === "{") {
      if (out.endsWith("/")) {
        out += ":param";
        i += 2;
        let depth = 1;
        while (i < text.length && depth > 0) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") depth -= 1;
          i += 1;
        }
        continue;
      }
      break;
    }
    if (/[A-Za-z0-9/_:.@~-]/.test(c)) {
      out += c;
      i += 1;
      continue;
    }
    break;
  }
  out = out.replace(/:[A-Za-z0-9_]+/g, ":param").replace(/\/{2,}/g, "/");
  if (out.length > 1) out = out.replace(/\/$/, "");
  return out;
}

// ── derivations ──────────────────────────────────────────────────────────────
/** Routes: path → component identifier, with the App.tsx line. */
function parseRoutes(appText) {
  const routes = [];
  for (const m of appText.matchAll(/<Route\s+path=(["'])([^"'`]+)\1\s+component=\{([A-Za-z0-9_$]+)\}/g)) {
    routes.push({ path: normalisePath(m[2], 0), component: m[3], line: lineOf(appText, m.index) });
  }
  return routes;
}

/** `const X = preview(Y)` → X → Y. */
function parsePreviewWrappers(appText) {
  const map = new Map();
  for (const m of appText.matchAll(/\bconst\s+([A-Za-z0-9_$]+)\s*=\s*preview\(\s*([A-Za-z0-9_$]+)\s*\)/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

/** Lazy page identifiers → their source file, plus plain `const A = B;` aliases. */
function parsePageFiles(appText) {
  const files = new Map(); // identifier → module specifier
  const aliases = new Map(); // identifier → identifier
  for (const m of appText.matchAll(/\bconst\s+([A-Za-z0-9_$]+)\s*=\s*named\(\s*\(\)\s*=>\s*import\((["'])([^"']+)\2\)/g)) {
    files.set(m[1], m[3]);
  }
  for (const m of appText.matchAll(/\bimport\s+([A-Za-z0-9_$]+)\s+from\s+(["'])([^"']+)\2/g)) {
    files.set(m[1], m[3]);
  }
  for (const m of appText.matchAll(/\bconst\s+([A-Za-z0-9_$]+)\s*=\s*([A-Za-z0-9_$]+)\s*;/g)) {
    aliases.set(m[1], m[2]);
  }
  return { files, aliases };
}

/** LAUNCH_NAV's href and match prefixes. */
function parseLaunchNav(layoutText) {
  // Anchored on the `= [` of the initialiser, NOT on the first `[` after the name:
  // the declaration is `const LAUNCH_NAV: NavEntry[] = [ … ]`, and the first bracket
  // belongs to the TYPE. Reading that one parses `[]` — an empty launch nav, under
  // which every route silently becomes non-launch and the whole gate inverts.
  const decl = layoutText.match(new RegExp(`(?:export\\s+)?const\\s+${LAUNCH_NAV_CONST}\\b[^=\\n]*=\\s*\\[`));
  if (!decl) return null;
  const open = decl.index + decl[0].length - 1;
  let depth = 0;
  let i = open;
  for (; i < layoutText.length; i += 1) {
    if (layoutText[i] === "[") depth += 1;
    else if (layoutText[i] === "]") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const body = layoutText.slice(open, i + 1);
  const prefixes = new Set();
  for (const m of body.matchAll(/\b(?:href|match):\s*(["'])([^"']+)\1/g)) prefixes.add(normalisePath(m[2], 0));
  return [...prefixes];
}

/** Every navigation target under src/, keyed by normalised path → [{file, line}]. */
function parseReferences(files) {
  const refs = new Map();
  const add = (path, file, line) => {
    if (!path.startsWith("/")) return;
    if (!refs.has(path)) refs.set(path, []);
    refs.get(path).push({ file, line });
  };
  const patterns = [
    /\b(?:href|to)\s*[:=]\s*\{?\s*(["'`])/g,
    /\b(?:setLocation|navigate|push|replace)\(\s*(["'`])/g,
  ];
  for (const { file, text } of files) {
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const quoteAt = m.index + m[0].length - 1;
        add(normalisePath(text, quoteAt + 1), file, lineOf(text, m.index));
      }
    }
  }
  return refs;
}

// ── the analysis (shared by the self-test) ───────────────────────────────────
/**
 * @returns {{ orphans: object[], unwrapped: object[], stale: string[], phantom: string[],
 *             launch: Set<string>, routes: object[] }}
 */
function analyse({ appText, layoutText, refFiles, allowlist, pageTextByFile }) {
  const routes = parseRoutes(appText);
  const previewWrappers = parsePreviewWrappers(appText);
  const { files: pageModules, aliases } = parsePageFiles(appText);
  const launchPrefixes = parseLaunchNav(layoutText) ?? [];
  const refs = parseReferences(refFiles);

  // Resolve a route's component to its underlying page identifier and module.
  const baseOf = (component) => {
    let id = component;
    for (let i = 0; i < 8; i += 1) {
      if (previewWrappers.has(id)) id = previewWrappers.get(id);
      else if (aliases.has(id)) id = aliases.get(id);
      else break;
    }
    return id;
  };
  for (const r of routes) {
    r.base = baseOf(r.component);
    r.module = pageModules.get(r.base) ?? null;
    r.wrapped = previewWrappers.has(r.component);
  }

  // (a) reachability
  const orphans = routes.filter((r) => !refs.has(r.path) && !allowlist.has(r.path));
  // allowlist held to both directions
  const routePaths = new Set(routes.map((r) => r.path));
  const phantom = [...allowlist.keys()].filter((p) => !routePaths.has(p));
  const stale = [...allowlist.keys()].filter((p) => routePaths.has(p) && refs.has(p));

  // (b) the launch closure, then the preview law
  const covered = (path) => launchPrefixes.some((p) => path === p || path.startsWith(`${p}/`));
  const launch = new Set(routes.filter((r) => covered(r.path)).map((r) => r.path));
  const routesByPath = new Map(routes.map((r) => [r.path, r]));
  for (let pass = 0; pass < routes.length + 2; pass += 1) {
    const before = launch.size;
    // identity — same page component as something already launch
    const launchBases = new Set([...launch].map((p) => routesByPath.get(p).base));
    for (const r of routes) if (launchBases.has(r.base)) launch.add(r.path);
    // link closure — linked from a launch page's own file
    const launchModules = new Set([...launch].map((p) => routesByPath.get(p).module).filter(Boolean));
    for (const [path, sources] of refs) {
      if (!routePaths.has(path)) continue;
      for (const s of sources) {
        if ([...launchModules].some((mod) => moduleMatchesFile(mod, s.file, pageTextByFile))) {
          launch.add(path);
          break;
        }
      }
    }
    if (launch.size === before) break;
  }
  const unwrapped = routes.filter((r) => !launch.has(r.path) && !r.wrapped);

  return { orphans, unwrapped, stale, phantom, launch, routes, refs, launchPrefixes };
}

// A module specifier from App.tsx ("@/pages/settings/Settings") against a scanned
// file path. The alias `@/` maps to the console src root, so the tail comparison is
// what identifies the file; the extension is not in the specifier.
function moduleMatchesFile(moduleSpec, file, _pageTextByFile) {
  const tail = moduleSpec.replace(/^@\//, "").replace(/^\.\//, "");
  const norm = file.replace(/\\/g, "/");
  return norm.endsWith(`/${tail}.tsx`) || norm.endsWith(`/${tail}.ts`) || norm.endsWith(`/${tail}/index.tsx`);
}

// ── self-test ────────────────────────────────────────────────────────────────
let selfTestShapes = 0;
{
  const layout = `export const LAUNCH_NAV: NavEntry[] = [
  { href: "/sessions", label: "Sessions", match: "/sessions" },
  { href: "/settings", label: "Settings", match: "/settings" },
];`;
  const baseApp = (routeLines, extra = "") => `const Sessions = named(() => import("@/pages/Sessions"), "Sessions");
const Settings = named(() => import("@/pages/Settings"), "Settings");
const Audit = named(() => import("@/pages/Audit"), "Audit");
const Demo = named(() => import("@/pages/Demo"), "Demo");
const Alias = Sessions;
const DemoPreview = preview(Demo);
${extra}
function Router() {
  return (<Switch>
${routeLines}
  </Switch>);
}`;
  const refFiles = (extra = []) => [
    { file: "src/components/layout/AppLayout.tsx", text: layout },
    { file: "src/pages/Settings.tsx", text: `<Link href="/audit">Audit</Link>` },
    ...extra,
  ];
  const run = (app, files, allow = new Map()) =>
    analyse({ appText: app, layoutText: layout, refFiles: files, allowlist: allow, pageTextByFile: new Map() });

  const goodRoutes = [
    `    <Route path="/sessions" component={Sessions} />`,
    `    <Route path="/settings" component={Settings} />`,
    `    <Route path="/audit" component={Audit} />`,
    `    <Route path="/demo" component={DemoPreview} />`,
  ].join("\n");
  const demoRef = [{ file: "src/components/layout/Other.tsx", text: `<Link href="/demo">Demo</Link>` }];

  const cases = [
    {
      name: "the correct fixture is CLEAR (launch by prefix, by link closure, and a wrapped+linked preview route)",
      got: () => run(baseApp(goodRoutes), refFiles(demoRef)),
      want: { orphans: 0, unwrapped: 0 },
    },
    {
      name: "a planted ORPHAN route (registered, linked from nothing) is FLAGGED",
      got: () => run(baseApp(`${goodRoutes}\n    <Route path="/orphan" component={DemoPreview} />`), refFiles(demoRef)),
      want: { orphans: 1, unwrapped: 0 },
    },
    {
      name: "a planted UNWRAPPED non-launch route is FLAGGED by (b) — and by (a) too when nothing links it",
      got: () => run(baseApp(`${goodRoutes}\n    <Route path="/loose" component={Demo} />`), refFiles(demoRef)),
      want: { orphans: 1, unwrapped: 1 },
    },
    {
      name: "an unwrapped non-launch route that IS linked is flagged by (b) ALONE — the two properties are independent",
      got: () =>
        run(baseApp(`${goodRoutes}\n    <Route path="/loose" component={Demo} />`), [
          ...refFiles(demoRef),
          { file: "src/pages/Demo.tsx", text: `<Link href="/loose">x</Link>` },
        ]),
      want: { orphans: 0, unwrapped: 1 },
    },
    {
      name: "a route sharing a launch page's component is launch, so it needs no preview wrap (the /decisions alias shape)",
      got: () => run(baseApp(`${goodRoutes}\n    <Route path="/alias" component={Alias} />`, ""), [
        ...refFiles(demoRef),
        { file: "src/pages/Sessions.tsx", text: `<Link href="/alias">x</Link>` },
      ]),
      want: { orphans: 0, unwrapped: 0 },
    },
    {
      name: "an orphan cleared by the allowlist is CLEAR, and the allowlist entry is neither phantom nor stale",
      got: () =>
        run(baseApp(`${goodRoutes}\n    <Route path="/orphan" component={DemoPreview} />`), refFiles(demoRef), new Map([["/orphan", "reason"]])),
      want: { orphans: 0, unwrapped: 0, phantom: 0, stale: 0 },
    },
    {
      name: "an allowlist entry for a path that is NOT a route is FLAGGED as a fossil",
      got: () => run(baseApp(goodRoutes), refFiles(demoRef), new Map([["/gone", "reason"]])),
      want: { orphans: 0, unwrapped: 0, phantom: 1 },
    },
    {
      name: "an allowlist entry that HAS become reachable is FLAGGED as stale",
      got: () => run(baseApp(goodRoutes), refFiles(demoRef), new Map([["/demo", "reason"]])),
      want: { orphans: 0, unwrapped: 0, stale: 1 },
    },
    {
      name: "a template-literal target normalises to :param and reaches a :id route",
      got: () =>
        run(baseApp(`${goodRoutes}\n    <Route path="/sessions/:id" component={Sessions} />`), [
          ...refFiles(demoRef),
          { file: "src/pages/Sessions.tsx", text: "onClick={() => setLocation(`/sessions/${d.id}`)}" },
        ]),
      want: { orphans: 0, unwrapped: 0 },
    },
  ];
  selfTestShapes = cases.length;
  const failures = [];
  for (const c of cases) {
    const r = c.got();
    for (const [key, want] of Object.entries(c.want)) {
      const got = r[key].length;
      if (got !== want) failures.push(`${c.name} — ${key}: expected ${want}, got ${got} (${JSON.stringify(r[key])})`);
    }
  }
  // Derivation controls.
  if (normalisePath("/decisions/${d.id}", 0) !== "/decisions/:param") failures.push("normalisePath no longer folds a template interpolation to :param");
  if (normalisePath("/sessions/:id", 0) !== "/sessions/:param") failures.push("normalisePath no longer folds a route param to :param");
  if (normalisePath("/edge-nodes?tenant=x", 0) !== "/edge-nodes") failures.push("normalisePath no longer drops a query string");
  if (parseLaunchNav("const NOT_IT = [];") !== null) failures.push("parseLaunchNav returns a parse where LAUNCH_NAV is absent — a missing nav must be fatal, not empty");
  const typedNav = parseLaunchNav(`export const ${LAUNCH_NAV_CONST}: NavEntry[] = [\n  { href: "/sessions", match: "/sessions" },\n];`);
  if (!typedNav || typedNav.join(",") !== "/sessions") {
    failures.push(`parseLaunchNav reads the TYPE's brackets rather than the initialiser (got ${JSON.stringify(typedNav)}) — an empty parse inverts the whole gate`);
  }
  if (!moduleMatchesFile("@/pages/settings/Settings", "artifacts/signalgrid-app/src/pages/settings/Settings.tsx")) {
    failures.push("moduleMatchesFile no longer resolves an @/ specifier to its file");
  }
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    fail("SELF-TEST FAILED: the route-reachability detector no longer flags its synthetic violations. A gate that cannot fail proves nothing.");
  }
}

if (process.argv.includes("--self-test")) {
  console.log(`check-console-routes-reachable self-test passed (${selfTestShapes} shapes: planted orphan and planted unwrapped route flagged, correct shapes clear).`);
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
const scanIdx = process.argv.indexOf("--scan");
const SRC = scanIdx !== -1 ? process.argv[scanIdx + 1] : DEFAULT_SRC;
const diagnostic = scanIdx !== -1;

const APP = join(SRC, APP_REL);
const LAYOUT = join(SRC, LAYOUT_REL);
for (const p of [APP, LAYOUT]) if (!existsSync(p)) fail(`${p} missing — the console surface moved; fix this derivation, do not silently check nothing.`);

const appText = readFileSync(APP, "utf8");
const layoutText = readFileSync(LAYOUT, "utf8");
const refFiles = walk(SRC, [".ts", ".tsx"])
  .filter((f) => f.replace(/\\/g, "/") !== APP.replace(/\\/g, "/"))
  .map((f) => ({ file: f, text: readFileSync(f, "utf8") }));
if (refFiles.length === 0) fail(`no .ts/.tsx files under ${SRC} besides ${APP_REL} — the derivation is broken, not the console empty.`);

const launchPrefixesProbe = parseLaunchNav(layoutText);
if (launchPrefixesProbe === null) fail(`no \`const ${LAUNCH_NAV_CONST}\` in ${LAYOUT} — the launch nav moved; fix this derivation, do not treat "no launch nav" as "nothing is launch".`);
if (launchPrefixesProbe.length === 0) fail(`${LAUNCH_NAV_CONST} parsed to zero prefixes — every route would be judged non-launch on a parse failure.`);

const result = analyse({ appText, layoutText, refFiles, allowlist: UNLINKED_BY_DESIGN, pageTextByFile: new Map() });
const { orphans, unwrapped, stale, phantom, launch, routes, refs } = result;

if (!diagnostic) {
  if (routes.length < FLOOR_ROUTES) fail(`only ${routes.length} route(s) parsed from ${APP} (floor ${FLOOR_ROUTES}) — the <Route path=…> parse has drifted.`);
  if (refs.size < FLOOR_REFS) fail(`only ${refs.size} distinct navigation target(s) found under ${SRC} (floor ${FLOOR_REFS}) — the reference scan has drifted, and every route would look unreachable.`);
}

console.log(
  `check-console-routes-reachable: ${routes.length} route(s), ${refs.size} distinct navigation target(s), ` +
    `${launch.size} route(s) in the launch closure over ${LAUNCH_NAV_CONST} [${launchPrefixesProbe.join(", ")}], ` +
    `${UNLINKED_BY_DESIGN.size} allowlisted; self-test green` +
    (diagnostic ? ` [DIAGNOSTIC --scan ${SRC}; floors not applied]` : ""),
);

const failures = [];
for (const r of orphans) {
  failures.push(
    `${APP}:${r.line} — route "${r.path}" (<${r.base}>) is registered but NOTHING under ${SRC} links to it. ` +
      "Give it a home in the navigation it belongs to, or delete the route. A deep-link-only page is reachable by its author and nobody else.",
  );
}
for (const r of unwrapped) {
  failures.push(
    `${APP}:${r.line} — route "${r.path}" (<${r.base}>) is outside the launch closure but is not wrapped in preview(). ` +
      "App.tsx's own law: every non-launch route renders the banner, because a deep link bypasses the sidebar and the banner cannot be bypassed.",
  );
}
for (const p of phantom) failures.push(`UNLINKED_BY_DESIGN carries "${p}", which is not a route in ${APP} — a fossil. Delete the entry.`);
for (const p of stale) failures.push(`UNLINKED_BY_DESIGN carries "${p}", but the console now links to it — the entry is stale and is suppressing nothing. Delete it.`);

if (failures.length > 0) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error(`\nConsole route-reachability gate FAILED — ${failures.length} finding(s).`);
  process.exit(1);
}
console.log("Console route-reachability gate passed — every route is reachable, and every route outside the launch closure carries the preview banner.");
