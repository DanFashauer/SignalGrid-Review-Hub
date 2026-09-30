#!/usr/bin/env node
// check-pwa-fixture-labels.mjs — a PWA page that shows control-plane data says it is a fixture.
//
//   node scripts/check-pwa-fixture-labels.mjs              # gate
//   node scripts/check-pwa-fixture-labels.mjs --self-test  # prove it can fail
//
// WHY THIS EXISTS (backlog row 115). The control plane's monitoring routes
// (`artifacts/api-server/src/routes/monitoring.ts`) serve synthetic fixtures.
// The PWA's Overview rendered "Allow Rate 94.2%", a decision chart and
// integration health, and its Decisions page a list and a detail sheet, with no
// qualifier anywhere; only Signals carried a label. The PWA is the surface most
// likely to be held up in a room, and an unqualified figure there reads as a
// claim about a deployment. Integrations (list and sheet) was unlabelled too,
// over a catalog `artifacts/api-server/src/routes/integrations.ts` itself calls
// synthetic; this gate found it on its first run.
//
// THE RULE, fail-closed: every page under the PWA's `src/pages` that calls a
// control-plane hook (`use…` from `@workspace/api-client-react`) must render
// `<FixtureLabel` or a literal "(fixture)" — and if it opens a `<BottomSheet>`,
// the sheet's own body must carry `<FixtureLabel` too, because a sheet covers the
// page and hides the page's label. A hook is presumed fixture-backed unless it
// is named in LIVE_HOOKS, which is empty: no PWA hook reads a live source today,
// and an unknown source must tighten the label, never drop it.
//
// WHAT IT CANNOT DO: it does not know whether a hook's data is actually a
// fixture. When a live source lands, the hook goes into LIVE_HOOKS with a reason,
// in the same change that makes it live.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES_DIR = "artifacts/signalgrid-mobile-pwa/src/pages";
/** Hooks proven to read a live source, each with its reason. Empty today. */
const LIVE_HOOKS = new Map();
/** Pages on the tree the day this was written: 5. Fewer than 4 means the walk broke. */
const PAGE_FLOOR = 4;

const HOOK_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']@workspace\/api-client-react["']/;

/** Control-plane hooks a page imports, minus the ones proven live. */
export function fixtureHooks(src) {
  const m = src.match(HOOK_IMPORT);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
    .filter((name) => /^use[A-Z]/.test(name) && !LIVE_HOOKS.has(name));
}

/** Problems for one page's source. */
export function pageProblems(src) {
  const hooks = fixtureHooks(src);
  if (hooks.length === 0) return [];
  const out = [];
  if (!/<FixtureLabel\b/.test(src) && !/\(fixture\)/.test(src)) {
    out.push(`reads ${hooks.join(", ")} and renders no fixture label`);
  }
  for (const sheet of src.matchAll(/<BottomSheet\b[\s\S]*?<\/BottomSheet>/g)) {
    if (!/<FixtureLabel\b/.test(sheet[0])) {
      const line = src.slice(0, sheet.index).split("\n").length;
      out.push(`line ${line}: a <BottomSheet> over fixture data carries no <FixtureLabel>`);
    }
  }
  return out;
}

function selfTest() {
  const checks = [];
  // The real defect, shaped as Overview.tsx stood before the fix.
  const overview = `import { useGetDashboardMetrics, useGetDecisionSeries } from "@workspace/api-client-react";\n<h2>Decision Volume (24h)</h2>`;
  checks.push(["an unlabelled page reading control-plane hooks is caught", pageProblems(overview).length === 1]);
  checks.push(["a <FixtureLabel /> is the fix", pageProblems(overview + "\n<FixtureLabel />").length === 0]);
  checks.push(['a literal "(fixture)" heading is the fix too', pageProblems(overview + "\n<h1>Signals (fixture)</h1>").length === 0]);
  // Decisions.tsx: labelled page, unlabelled sheet.
  const decisions = `import { useListDecisions, useGetDecision, ListDecisionsOutcome } from "@workspace/api-client-react";\n<h1>Decisions (fixture)</h1>\n<BottomSheet open>\n  <OutcomeBadge />\n</BottomSheet>`;
  checks.push(["a labelled page whose bottom sheet is unlabelled is caught", pageProblems(decisions).length === 1]);
  checks.push(["a sheet carrying <FixtureLabel /> is the fix", pageProblems(decisions.replace("<OutcomeBadge />", "<FixtureLabel /><OutcomeBadge />")).length === 0]);
  checks.push(["a page with no control-plane hook is not judged", pageProblems(`import { OutcomeBadge } from "@/components/OutcomeBadge";\n<h1>Access support</h1>`).length === 0]);
  checks.push(["a type-only import (no use* hook) is not a data read", fixtureHooks(`import { ListDecisionsOutcome } from "@workspace/api-client-react";`).length === 0]);
  checks.push(["an aliased hook is still a hook", fixtureHooks(`import { useListDecisions as useList } from "@workspace/api-client-react";`).length === 1]);
  const pages = listPages();
  checks.push([`the real pages directory holds at least ${PAGE_FLOOR} pages (${pages.length})`, pages.length >= PAGE_FLOOR]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

function listPages() {
  try {
    return readdirSync(join(repo, PAGES_DIR)).filter((f) => f.endsWith(".tsx"));
  } catch {
    return [];
  }
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const pages = listPages();
if (pages.length < PAGE_FLOOR) {
  console.error(`✗ only ${pages.length} page(s) found in ${PAGES_DIR} (floor ${PAGE_FLOOR}) — refusing to report a pass from a scan that read nothing.`);
  process.exit(1);
}

let judged = 0;
const problems = [];
for (const f of pages) {
  const src = readFileSync(join(repo, PAGES_DIR, f), "utf8");
  if (fixtureHooks(src).length > 0) judged++;
  for (const p of pageProblems(src)) problems.push(`${PAGES_DIR}/${f} — ${p}`);
}

console.log(`PWA fixture labels — ${pages.length} page(s) scanned, ${judged} read the control plane; ${LIVE_HOOKS.size} hook(s) proven live.`);
if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} unlabelled fixture surface(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error("\n  Render <FixtureLabel /> (artifacts/signalgrid-mobile-pwa/src/components/FixtureLabel.tsx)");
  console.error("  on the page and inside any bottom sheet over its data.");
  process.exit(1);
}
console.log("PWA fixture-label gate passed — every page and sheet over control-plane data says it is a fixture.");
