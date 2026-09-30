// Screen-inventory gate — docs/SCREEN_INVENTORY.md must list every page file of
// every web surface, and every launch status it states must be the one
// scripts/launch-profile.mjs holds (backlog row "Screen inventory and investor
// demo-path brief for the operator surfaces").
//
// WHY. The inventory is what a designer starts from and what an investor demo is
// planned against. A screen inventory that silently omits a page, still lists a
// deleted one, or calls a demo-only surface "launch" is worse than none: it is a
// scope claim nobody re-derived. So the doc's table is checked, both directions,
// against the tree and the launch profile — the status column is never retyped
// truth, only a copy the gate compares to the source.
//
// WHAT IS CHECKED, per row inside the <!-- screen-inventory:begin/end --> block:
//   · every git-tracked artifacts/*/src/pages/**/*.tsx appears exactly once
//     (a new page with no row FAILS)
//   · every listed file is tracked (a deleted or renamed page still listed FAILS)
//   · the surface column is the file's artifacts/<dir>
//   · the status column equals that surface's status in launch-profile.mjs
//     (an unclassified surface FAILS — the launch-profile gate owns classifying it)
//   · the placement column, for the admin console (signalgrid-app), equals what
//     its route table (src/App.tsx) actually does with the page: `launch route`,
//     `preview route (not launch UI)` (rendered under the PREVIEW banner),
//     `404 fallback`, or `not routed`; for every other surface it is `—`
//   · an admin page that is NOT on a launch route says so in the status column
//     too (`launch surface · not a launch screen`), because the profile classifies
//     the whole surface and a skimmer reads the Status column alone
//   · every <Route> in App.tsx has a shape this parser understands and names a
//     known page or preview wrapper. An unrecognised shape (an inline arrow
//     component, a spread, an unknown identifier) FAILS, whatever the doc says —
//     otherwise a page it could not see would read as `not routed` and pass.
//   · the "shows" column is not empty and not a placeholder (TBD, TODO, …); its
//     accuracy is still a human's job — nothing here can read a screen
//   · the doc names the launch-profile version it was checked against, and that
//     version is the current LAUNCH_PROFILE_VERSION
//
// `--self-test` proves each of those can fail on a synthetic case before the real
// check is trusted.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { LAUNCH_PROFILE_VERSION, SURFACES } from "./launch-profile.mjs";

const DOC = "docs/SCREEN_INVENTORY.md";
const ADMIN = "signalgrid-app";
const ADMIN_ROUTES = `artifacts/${ADMIN}/src/App.tsx`;
const BEGIN = "<!-- screen-inventory:begin -->";
const END = "<!-- screen-inventory:end -->";
const PAGE_RE = /^artifacts\/([^/]+)\/src\/pages\/.+\.tsx$/;
const STEP4_NEEDLES = ["-DemoBackendURL", "-DemoBackendToken", "sgk_demo_northwind_operator", "-DemoBackendIdentity nurse.compliant", "-DemoBackendDevice ipad-ward-01"];
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** surface id → status, from the app-surfaces entry of the launch profile. */
export function appSurfaceStatuses(surfaces = SURFACES) {
  const entry = surfaces.find((s) => s.key === "app-surfaces");
  if (!entry) throw new Error("launch-profile.mjs has no app-surfaces entry");
  const out = new Map();
  for (const status of ["launch", "deferred", "demo_only", "internal"]) {
    for (const item of entry[status] ?? []) out.set(typeof item === "string" ? item : item.id, status);
  }
  return out;
}

export const PREVIEW = "preview route (not launch UI)";

/**
 * Page path → placement, read from the admin console's route table by PARSING it with
 * the TypeScript compiler, not by scanning text.
 *
 * Why a parser: two review rounds found text-scanning fail-opens in both directions.
 * A `//` inside a string or inside JSX text looked like a comment and hid a real
 * <Route> (the page then read `not routed`); `<Route …>` text sitting inside a string
 * or template literal looked like a route and made a page no route renders read
 * `launch route`. Only the AST knows which `<Route` is a JSX element, so only JSX
 * elements named Route count, and anything about one this checker does not
 * understand — a child, a spread, an extra prop, a non-literal path, a component that
 * is not a bare identifier or names no page — is reported, never skipped. A file the
 * compiler cannot parse is reported too.
 *
 * Bindings read from the same AST: `import X from "@/pages/P"`,
 * `const X = named(() => import("@/pages/P"), …)`, `const Y = X` aliases and
 * `const Z = preview(X)` wrappers.
 */
export function adminPlacements(appSource) {
  const sf = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const unparsed = sf.parseDiagnostics.map((d) => `does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  const pageOf = new Map(); // binding name → page path under src/pages
  const aliasOf = new Map();
  const previewOf = new Map();
  const routes = [];
  const pagePath = (n) => (n && ts.isStringLiteralLike(n) && n.text.startsWith("@/pages/") ? n.text.slice("@/pages/".length) : null);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.name) {
      const page = pagePath(node.moduleSpecifier);
      if (page) pageOf.set(node.importClause.name.text, page);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      const init = node.initializer;
      if (ts.isIdentifier(init)) aliasOf.set(name, init.text);
      else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
        const [first] = init.arguments;
        if (init.expression.text === "preview" && first && ts.isIdentifier(first)) previewOf.set(name, first.text);
        if (init.expression.text === "named" && first && ts.isArrowFunction(first) && ts.isCallExpression(first.body)
          && first.body.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const page = pagePath(first.body.arguments[0]);
          if (page) pageOf.set(name, page);
        }
      }
    } else if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === "Route") {
      routes.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, target] of aliasOf) if (!pageOf.has(name) && pageOf.has(target)) { pageOf.set(name, pageOf.get(target)); changed = true; }
  }
  const placement = new Map();
  const rank = { "launch route": 3, [PREVIEW]: 2, "404 fallback": 1 };
  const set = (page, p) => {
    if (!placement.has(page) || rank[p] > rank[placement.get(page)]) placement.set(page, p);
  };
  for (const el of routes) {
    const snippet = el.getText(sf).split("\n")[0].trim();
    if (ts.isJsxOpeningElement(el)) {
      unparsed.push(`unrecognised <Route> shape (has children): ${snippet}`);
      continue;
    }
    let path;
    let comp;
    let odd = false;
    for (const attr of el.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) { odd = true; continue; }
      const key = attr.name.getText(sf);
      if (key === "path" && attr.initializer && ts.isStringLiteral(attr.initializer)) path = attr.initializer.text;
      else if (key === "component" && attr.initializer && ts.isJsxExpression(attr.initializer)
        && attr.initializer.expression && ts.isIdentifier(attr.initializer.expression)) comp = attr.initializer.expression.text;
      else odd = true;
    }
    if (odd || !comp) {
      unparsed.push(`unrecognised <Route> shape: ${snippet}`);
      continue;
    }
    if (previewOf.has(comp) && pageOf.has(previewOf.get(comp))) set(pageOf.get(previewOf.get(comp)), PREVIEW);
    else if (pageOf.has(comp)) set(pageOf.get(comp), path !== undefined ? "launch route" : "404 fallback");
    else unparsed.push(`<Route> component ${comp} resolves to no page under src/pages: ${snippet}`);
  }
  return { placement, unparsed }; // placement keys like "decisions/DecisionList"
}

function adminPageKey(file) {
  return file.replace(`artifacts/${ADMIN}/src/pages/`, "").replace(/\.tsx$/, "");
}

/** Rows of the inventory table: [{ surface, file, status, placement, shows, line }]. */
export function parseRows(doc) {
  const b = doc.indexOf(BEGIN);
  const e = doc.indexOf(END);
  if (b < 0 || e < 0 || e < b) return null;
  const rows = [];
  const lines = doc.slice(b, e).split("\n");
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const file = /^`([^`]+)`$/.exec(cells[1] ?? "")?.[1];
    if (!file) continue; // header / separator
    rows.push({ surface: cells[0], file, status: cells[2], placement: cells[3], shows: cells[4] ?? "", line: i });
  }
  return rows;
}

/** Pure check. Returns a list of failure strings; empty means green. */
export function check({ doc, pageFiles, statuses, placements, unparsedRoutes = [], profileVersion }) {
  const errors = unparsedRoutes.map((u) => `${ADMIN_ROUTES}: ${u} — teach scripts/check-screen-inventory.mjs the shape or rewrite the route`);
  const rows = parseRows(doc);
  if (!rows) return [`${DOC} has no ${BEGIN} … ${END} block`];
  const vm = /launch profile v(\d+)/i.exec(doc);
  if (!vm) errors.push(`${DOC} does not name the launch-profile version it was checked against ("launch profile vN")`);
  else if (Number(vm[1]) !== profileVersion)
    errors.push(`${DOC} says launch profile v${vm[1]}; scripts/launch-profile.mjs is v${profileVersion} — re-read every status`);
  // The demo path's step 4 is prose, but a defect in it already shipped (it named no
  // credential, so the shell decided on-device). The shell reaches the api-server only
  // with ALL of these (DecisionServiceProvider.resolve needs a URL and a token;
  // DemoMode.backendURL returns nil for any host that is not loopback; the refs must be
  // the seeded ones or the decision is fail-closed), so every one is gated, and every
  // URL step 4 gives must be loopback.
  const demo = doc.slice(Math.max(0, doc.search(/^## The demo path/m)));
  const step4 = /^4\. [\s\S]*?(?=^5\. )/m.exec(demo)?.[0] ?? "";
  if (!step4) errors.push(`${DOC}: demo path step 4 not found`);
  else {
    for (const needle of STEP4_NEEDLES)
      if (!step4.includes(needle))
        errors.push(`${DOC}: demo step 4 no longer names ${needle} — without it the host app decides on-device or in another tenant`);
    const urls = [...step4.matchAll(/\bhttps?:\/\/(\[[^\]]+\]|[^\s/:`)]+)/g)].map((m) => m[1].toLowerCase());
    if (urls.length === 0) errors.push(`${DOC}: demo step 4 gives no -DemoBackendURL value — say the loopback URL (e.g. http://127.0.0.1:8080)`);
    for (const host of urls)
      if (!LOOPBACK.has(host))
        errors.push(`${DOC}: demo step 4 points -DemoBackendURL at ${host} — DemoMode.backendURL accepts loopback only, so the shell would decide on-device`);
  }
  const tracked = new Set(pageFiles);
  const seen = new Map();
  for (const r of rows) {
    seen.set(r.file, (seen.get(r.file) ?? 0) + 1);
    if (!tracked.has(r.file)) {
      errors.push(`listed page is not a tracked page file (deleted or renamed?): ${r.file}`);
      continue;
    }
    const dir = PAGE_RE.exec(r.file)[1];
    if (r.surface !== dir) errors.push(`${r.file}: surface column says "${r.surface}", the file is under artifacts/${dir}`);
    const want = statuses.get(dir);
    if (!want) errors.push(`${r.file}: surface ${dir} is not classified in scripts/launch-profile.mjs app-surfaces`);
    const wantPlacement = dir === ADMIN ? (placements.get(adminPageKey(r.file)) ?? "not routed") : "—";
    const wantStatus = want && dir === ADMIN && wantPlacement !== "launch route" ? `${want} surface · not a launch screen` : want;
    if (want && r.status !== wantStatus)
      errors.push(`${r.file}: status column says "${r.status}", expected "${wantStatus}" (launch-profile.mjs says "${want}" for ${dir})`);
    if (r.placement !== wantPlacement)
      errors.push(`${r.file}: placement column says "${r.placement}", ${dir === ADMIN ? ADMIN_ROUTES : "non-admin surface"} gives "${wantPlacement}"`);
    if (!r.shows || r.shows === "—") errors.push(`${r.file}: "shows" column is empty — say what the screen shows`);
    else if (/^(tbd|todo|tk|xxx|fixme|n\/?a|\?+|\.\.\.|…)$/i.test(r.shows))
      errors.push(`${r.file}: "shows" column is a placeholder ("${r.shows}") — say what the screen shows`);
  }
  for (const [f, n] of seen) if (n > 1) errors.push(`${f} is listed ${n} times`);
  for (const f of pageFiles) if (!seen.has(f)) errors.push(`page file missing from ${DOC}: ${f}`);
  return errors;
}

function trackedPages() {
  const out = execFileSync("git", ["ls-files", "-z", "--", "artifacts/*/src/pages/*.tsx", "artifacts/*/src/pages/**/*.tsx"], { encoding: "utf8" });
  return [...new Set(out.split("\0").filter((f) => PAGE_RE.test(f)))].sort();
}

function selfTest() {
  const statuses = new Map([["signalgrid-app", "launch"], ["signalgrid-web", "demo_only"]]);
  // A real TSX module, shaped like App.tsx: routes are JSX elements inside a component.
  const ROUTES = [
    '        {/* <Route path="/x" component={Orphan} /> */}',
    '        <Route path="/sessions" component={SessionList} />',
    '        <Route path="/fleet" component={FleetPreview} />',
    "        <Route component={NotFound} />",
  ];
  const appSrc = [
    'import NotFound from "@/pages/not-found";',
    'const DecisionList = named(() => import("@/pages/decisions/DecisionList"), "DecisionList");',
    "const SessionList = DecisionList;",
    'const Fleet = named(() => import("@/pages/Fleet"), "Fleet");',
    'const Orphan = named(() => import("@/pages/Orphan"), "Orphan");',
    "const FleetPreview = preview(Fleet);",
    "export function Router() {",
    "  return (",
    "    <Layout>",
    "      <Switch>",
    ...ROUTES,
    "      </Switch>",
    "    </Layout>",
    "  );",
    "}",
    "",
  ].join("\n");
  const { placement: placements, unparsed } = adminPlacements(appSrc);
  const pageFiles = [
    "artifacts/signalgrid-app/src/pages/Fleet.tsx",
    "artifacts/signalgrid-app/src/pages/Orphan.tsx",
    "artifacts/signalgrid-app/src/pages/decisions/DecisionList.tsx",
    "artifacts/signalgrid-app/src/pages/not-found.tsx",
    "artifacts/signalgrid-web/src/pages/Home.tsx",
  ];
  const row = (s, f, st, p, sh = "a screen") => `| ${s} | \`${f}\` | ${st} | ${p} | ${sh} |`;
  const STEP4 = "4. host app: -DemoBackendIdentity nurse.compliant -DemoBackendDevice ipad-ward-01 -DemoBackendURL http://127.0.0.1:8080 -DemoBackendToken sgk_demo_northwind_operator";
  const good = [
    "Checked against launch profile v7.",
    BEGIN,
    "| Surface | File | Status | Placement | Shows |",
    "| --- | --- | --- | --- | --- |",
    row("signalgrid-app", pageFiles[0], "launch surface · not a launch screen", PREVIEW),
    row("signalgrid-app", pageFiles[1], "launch surface · not a launch screen", "not routed"),
    row("signalgrid-app", pageFiles[2], "launch", "launch route"),
    row("signalgrid-app", pageFiles[3], "launch surface · not a launch screen", "404 fallback"),
    row("signalgrid-web", pageFiles[4], "demo_only", "—"),
    END,
    "## The demo path",
    STEP4,
    "5. audit",
  ].join("\n");
  const base = { doc: good, pageFiles, statuses, placements, unparsedRoutes: unparsed, profileVersion: 7 };
  // Swap one route line of the fixture; optionally edit the doc too. Returns check() input.
  const SESSIONS = ROUTES[1].trim();
  const FLEET = ROUTES[2].trim();
  const routeCase = (from, to, docEdit = (d) => d, extra = "") => {
    const r = adminPlacements(appSrc.replace(from, to) + extra);
    return { ...base, doc: docEdit(good), placements: r.placement, unparsedRoutes: r.unparsed };
  };
  const asNotRouted = (d) => d.replace("| launch | launch route |", "| launch surface · not a launch screen | not routed |");
  const cases = [
    ["clean fixture passes", base, null],
    ["a page file missing from the doc fails", { ...base, pageFiles: [...pageFiles, "artifacts/signalgrid-web/src/pages/New.tsx"] }, "missing from"],
    ["a listed file that is gone fails", { ...base, pageFiles: pageFiles.slice(0, 4) }, "not a tracked page file"],
    ["a status disagreeing with launch-profile fails", { ...base, doc: good.replace("| demo_only |", "| launch |") }, "status column"],
    ["a status of an unclassified surface fails", { ...base, statuses: new Map([["signalgrid-app", "launch"]]) }, "not classified"],
    ["a wrong admin placement fails", { ...base, doc: good.replace(`| ${PREVIEW} |`, "| launch route |") }, "placement column"],
    ["a preview page whose status reads plain 'launch' fails", { ...base, doc: good.replace("| launch surface · not a launch screen | preview", "| launch | preview") }, "status column"],
    // Each route case changes the doc to what a fooled parser would conclude, so only a
    // correct parse can make it fail.
    ["an inline-arrow <Route> fails even when the row says 'not routed'", routeCase(FLEET, '<Route path="/fleet" component={() => <Fleet />} />', (d) => d.replace(`| ${PREVIEW} |`, "| not routed |")), "unrecognised <Route> shape"],
    ["a <Route> naming no known page fails", routeCase(FLEET, '<Route path="/fleet" component={SomethingElse} />'), "resolves to no page"],
    ["a <Route> with children fails", routeCase(FLEET, '<Route path="/fleet"><FleetPreview /></Route>'), "has children"],
    ["a <Route> with a spread fails", routeCase(FLEET, '<Route path="/fleet" component={FleetPreview} {...rest} />'), "unrecognised <Route> shape"],
    ["a commented-out route does not count as routed", { ...base, doc: good.replace("| not routed |", "| launch route |") }, "placement column"],
    ['a {"//"} expression before a <Route> does not hide it', routeCase(SESSIONS, `{"//"}${SESSIONS}`, asNotRouted), "placement column"],
    ["JSX text with // before a <Route> does not hide it (round 3)", routeCase(SESSIONS, `see https://x ${SESSIONS}`, asNotRouted), "placement column"],
    ["an apostrophe in JSX text does not hide the routes after it", routeCase(SESSIONS, `<p>don't</p>\n${SESSIONS}`), null],
    ["<Route> text only in a template literal is not a route (round 3)", routeCase(SESSIONS, "", (d) => d, `\nexport const EXAMPLE = \`${SESSIONS}\`;\n`), "placement column"],
    ["<Route> text only in a quoted string is not a route (round 3)", routeCase(SESSIONS, "", (d) => d, `\nexport const EXAMPLE = '${SESSIONS}';\n`), "placement column"],
    ["an App.tsx that does not parse fails", routeCase("export function Router() {", "export function Router( {"), "does not parse"],
    ["an empty shows column fails", { ...base, doc: good.replace("| — | a screen |", "| — |  |") }, "empty"],
    ["a placeholder shows column (TBD) fails", { ...base, doc: good.replace("| — | a screen |", "| — | TBD |") }, "placeholder"],
    ...["-DemoBackendURL", "-DemoBackendToken", "sgk_demo_northwind_operator", "-DemoBackendIdentity nurse.compliant", "-DemoBackendDevice ipad-ward-01"].map((needle) =>
      [`demo step 4 without ${needle} fails (round 3)`, { ...base, doc: good.replace(STEP4, STEP4.replace(needle, "")) }, `no longer names ${needle}`]),
    ["demo step 4 with a non-loopback URL fails (round 3)", { ...base, doc: good.replace("http://127.0.0.1:8080", "https://api.example.com") }, "loopback only"],
    ["demo step 4 with no URL value fails", { ...base, doc: good.replace(" http://127.0.0.1:8080", "") }, "gives no -DemoBackendURL value"],
    ["demo step 4 with localhost passes", { ...base, doc: good.replace("127.0.0.1", "localhost") }, null],
    ["a stale launch-profile version fails", { ...base, profileVersion: 8 }, "launch profile v7"],
    ["a missing inventory block fails", { ...base, doc: good.replace(BEGIN, "") }, "no <!--"],
    ["a duplicated row fails", { ...base, doc: good.replace(END, `${row("signalgrid-web", pageFiles[4], "demo_only", "—")}\n${END}`) }, "listed 2 times"],
  ];
  let ok = true;
  // A failing case must fail FOR ITS REASON (the expected fragment appears in an error);
  // a passing case (null) must produce no error at all.
  for (const [name, input, expect] of cases) {
    const errs = check(input);
    const pass = expect === null ? errs.length === 0 : errs.some((e) => e.includes(expect));
    console.log(`  ${pass ? "✓" : "✗"} ${name}${pass ? "" : ` — got ${JSON.stringify(errs)}`}`);
    ok &&= pass;
  }
  // The real launch profile must be readable into statuses, or every real run is meaningless.
  const real = appSurfaceStatuses();
  const realOk = real.get("signalgrid-app") !== undefined && real.size > 0;
  console.log(`  ${realOk ? "✓" : "✗"} launch-profile.mjs app-surfaces reads into ${real.size} surface statuses`);
  ok &&= realOk;
  console.log(ok ? "✓ screen-inventory self-test: every check can fail" : "✗ screen-inventory self-test FAILED");
  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) {
  // imported for its pure functions
} else if (process.argv.includes("--self-test")) selfTest();
else {
  if (!existsSync(DOC)) {
    console.error(`✗ ${DOC} does not exist`);
    process.exit(1);
  }
  const pageFiles = trackedPages();
  const errors = check({
    doc: readFileSync(DOC, "utf8"),
    pageFiles,
    statuses: appSurfaceStatuses(),
    ...(({ placement, unparsed }) => ({ placements: placement, unparsedRoutes: unparsed }))(adminPlacements(readFileSync(ADMIN_ROUTES, "utf8"))),
    profileVersion: LAUNCH_PROFILE_VERSION,
  });
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(`✗ screen inventory: ${errors.length} problem(s) in ${DOC}`);
    process.exit(1);
  }
  console.log(`✓ screen inventory: ${pageFiles.length} page files listed in ${DOC}, statuses match launch profile v${LAUNCH_PROFILE_VERSION}`);
}
