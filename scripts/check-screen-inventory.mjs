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
import { LAUNCH_PROFILE_VERSION, SURFACES } from "./launch-profile.mjs";

const DOC = "docs/SCREEN_INVENTORY.md";
const ADMIN = "signalgrid-app";
const ADMIN_ROUTES = `artifacts/${ADMIN}/src/App.tsx`;
const BEGIN = "<!-- screen-inventory:begin -->";
const END = "<!-- screen-inventory:end -->";
const PAGE_RE = /^artifacts\/([^/]+)\/src\/pages\/.+\.tsx$/;

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

/**
 * Page path → placement, read from the admin console's route table.
 * Handles the three shapes App.tsx uses: `const X = named(() => import("@/pages/P"), …)`
 * or a default import, `const Y = X` aliases, `const Z = preview(X)` wrappers, and
 * `<Route … component={N} />`.
 */
export const PREVIEW = "preview route (not launch UI)";
const ROUTE_SHAPE = /^<Route(?:\s+path="[^"]*")?\s+component=\{(\w+)\}\s*\/>/;

export function adminPlacements(appSource) {
  const src = appSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const pageOf = new Map(); // component name → page path under src/pages
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*named\(\s*\(\)\s*=>\s*import\(\s*"@\/pages\/([^"]+)"\s*\)/g)) pageOf.set(m[1], m[2]);
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+"@\/pages\/([^"]+)"/g)) pageOf.set(m[1], m[2]);
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(\w+)\s*;/g)) if (pageOf.has(m[2])) pageOf.set(m[1], pageOf.get(m[2]));
  const previewOf = new Map();
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*preview\(\s*(\w+)\s*\)/g)) previewOf.set(m[1], m[2]);
  const placement = new Map();
  const rank = { "launch route": 3, [PREVIEW]: 2, "404 fallback": 1 };
  const unparsed = [];
  const set = (page, p) => {
    if (!placement.has(page) || rank[p] > rank[placement.get(page)]) placement.set(page, p);
  };
  // Every <Route occurrence is inspected, not just the ones a lenient regex matches:
  // a shape this parser does not understand is a failure, never a silent skip.
  for (const m of src.matchAll(/<Route\b/g)) {
    const text = src.slice(m.index, m.index + 400);
    const shape = ROUTE_SHAPE.exec(text);
    const snippet = text.split("\n")[0].trim();
    if (!shape) {
      unparsed.push(`unrecognised <Route> shape: ${snippet}`);
      continue;
    }
    const comp = shape[1];
    const hasPath = /^<Route\s+path=/.test(text);
    if (previewOf.has(comp) && pageOf.has(previewOf.get(comp))) {
      set(pageOf.get(previewOf.get(comp)), PREVIEW);
    } else if (pageOf.has(comp)) {
      set(pageOf.get(comp), hasPath ? "launch route" : "404 fallback");
    } else {
      unparsed.push(`<Route> component ${comp} resolves to no page under src/pages: ${snippet}`);
    }
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
  const appSrc = [
    'import NotFound from "@/pages/not-found";',
    'const DecisionList = named(() => import("@/pages/decisions/DecisionList"), "DecisionList");',
    "const SessionList = DecisionList;",
    'const Fleet = named(() => import("@/pages/Fleet"), "Fleet");',
    'const Orphan = named(() => import("@/pages/Orphan"), "Orphan");',
    "const FleetPreview = preview(Fleet);",
    '// <Route path="/x" component={Orphan} />',
    '<Route path="/sessions" component={SessionList} />',
    '<Route path="/fleet" component={FleetPreview} />',
    "<Route component={NotFound} />",
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
  ].join("\n");
  const base = { doc: good, pageFiles, statuses, placements, unparsedRoutes: unparsed, profileVersion: 7 };
  const arrowSrc = appSrc.replace('<Route path="/fleet" component={FleetPreview} />', '<Route path="/fleet" component={() => <Fleet />} />');
  const unknownSrc = appSrc.replace('<Route path="/fleet" component={FleetPreview} />', '<Route path="/fleet" component={SomethingElse} />');
  const cases = [
    ["clean fixture passes", base, 0],
    ["a page file missing from the doc fails", { ...base, pageFiles: [...pageFiles, "artifacts/signalgrid-web/src/pages/New.tsx"] }, 1],
    ["a listed file that is gone fails", { ...base, pageFiles: pageFiles.slice(0, 4) }, 1],
    ["a status disagreeing with launch-profile fails", { ...base, doc: good.replace("| demo_only |", "| launch |") }, 1],
    ["a status of an unclassified surface fails", { ...base, statuses: new Map([["signalgrid-app", "launch"]]) }, 1],
    ["a wrong admin placement fails", { ...base, doc: good.replace(`| ${PREVIEW} |`, "| launch route |") }, 1],
    ["a preview page whose status reads plain 'launch' fails", { ...base, doc: good.replace("| launch surface · not a launch screen | preview", "| launch | preview") }, 1],
    // The doc row is changed to match what a lenient parser would conclude (`not routed`),
    // so ONLY the unparsed route can fail this case — the refuter's exact scenario.
    ["an inline-arrow <Route> fails even when the row says 'not routed'", { ...base, doc: good.replace(`| ${PREVIEW} |`, "| not routed |"), unparsedRoutes: adminPlacements(arrowSrc).unparsed, placements: adminPlacements(arrowSrc).placement }, 1],
    ["a <Route> naming no known page fails", { ...base, unparsedRoutes: adminPlacements(unknownSrc).unparsed, placements: adminPlacements(unknownSrc).placement }, 1],
    ["a commented-out route does not count as routed", { ...base, doc: good.replace("| not routed |", "| launch route |") }, 1],
    ["an empty shows column fails", { ...base, doc: good.replace("| — | a screen |", "| — |  |") }, 1],
    ["a placeholder shows column (TBD) fails", { ...base, doc: good.replace("| — | a screen |", "| — | TBD |") }, 1],
    ["a stale launch-profile version fails", { ...base, profileVersion: 8 }, 1],
    ["a missing inventory block fails", { ...base, doc: good.replace(BEGIN, "") }, 1],
    ["a duplicated row fails", { ...base, doc: good.replace(END, `${row("signalgrid-web", pageFiles[4], "demo_only", "—")}\n${END}`) }, 1],
  ];
  let ok = true;
  for (const [name, input, wantErrors] of cases) {
    const errs = check(input);
    const pass = wantErrors === 0 ? errs.length === 0 : errs.length >= wantErrors;
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
