#!/usr/bin/env node
// check-pwa-fixture-labels.mjs — every PWA page says its data is a fixture, outside any overlay.
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
// THE RULE, fail-closed. Every page under the PWA's `src/pages` (recursively)
// must render `<FixtureLabel` or a literal "(fixture)" in its PAGE BODY — outside
// every overlay — and every overlay (`<BottomSheet>`, `<Dialog…>`, `<Drawer…>`,
// `<Sheet…>`, `<Modal>`, `<Popover…>`) must carry `<FixtureLabel` inside it,
// because an overlay covers the page and hides the page's label. Comments are
// stripped first: a label in a comment renders nothing.
//
// EVERY page, not only those that call a control-plane hook. The first version
// judged only hook readers, so AccessSupport's fictional sessions were exempt by
// construction (brain review, PR #1243). A page is exempt only by being named in
// LIVE_PAGES with a reason — empty, because nothing in the PWA is live today.
//
// Hook reads (`use…` named imports, or a namespace/default import, from
// `@workspace/api-client-react`, across EVERY import statement) are counted and
// floored: a scan that stops seeing them has broken, and says so.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES_DIR = "artifacts/signalgrid-mobile-pwa/src/pages";
/** Pages proven to show live data, each with its reason. Empty today. */
const LIVE_PAGES = new Map();
/** Pages on the tree when this was written: 5. Fewer than 4 means the walk broke. */
const PAGE_FLOOR = 4;
/** Pages reading the control plane when this was written: 4. Fewer than 3 means the import scan broke. */
const HOOK_READER_FLOOR = 3;

const OVERLAY = /<(BottomSheet|Dialog(?:\.?Content)?|Drawer(?:\.Content)?|Sheet(?:Content)?|Modal|Popover(?:Content)?)\b[\s\S]*?<\/\1>/g;

/** Remove block, JSX and line comments, keeping line count. `://` in a URL is not a comment. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** Control-plane reads a page makes, across every import from the client package. */
export function fixtureHooks(src) {
  const code = stripComments(src);
  const out = [];
  for (const m of code.matchAll(/import\s+([^;"'`]*?)\s+from\s*["']@workspace\/api-client-react["']/g)) {
    const clause = m[1];
    if (/^type\s/.test(clause)) continue;
    const ns = clause.match(/\*\s*as\s+(\w+)/);
    if (ns) out.push(`* as ${ns[1]}`);
    const def = clause.match(/^(\w+)\s*(?:,|$)/);
    if (def) out.push(def[1]);
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(",")) {
        const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0];
        if (/^use[A-Z]/.test(name)) out.push(name);
      }
    }
  }
  return out;
}

/** Problems for one page's source. */
export function pageProblems(src) {
  const code = stripComments(src);
  const out = [];
  const body = code.replace(OVERLAY, "");
  if (!/<FixtureLabel\b/.test(body) && !/\(fixture\)/.test(body)) {
    out.push("renders no fixture label in the page body (outside every overlay)");
  }
  for (const ov of code.matchAll(OVERLAY)) {
    if (!/<FixtureLabel\b/.test(ov[0])) {
      const line = code.slice(0, ov.index).split("\n").length;
      out.push(`line ${line}: a <${ov[1]}> carries no <FixtureLabel>`);
    }
  }
  return out;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const listPages = () => walk(join(repo, PAGES_DIR));

function selfTest() {
  const checks = [];
  const imp = `import { useGetDashboardMetrics, useGetDecisionSeries } from "@workspace/api-client-react";\n`;
  // The real defect, shaped as Overview.tsx stood before the fix.
  checks.push(["an unlabelled page is caught", pageProblems(imp + "<h2>Decision Volume (24h)</h2>").length === 1]);
  checks.push(["a <FixtureLabel /> is the fix", pageProblems(imp + "<FixtureLabel />").length === 0]);
  checks.push(['a literal "(fixture)" heading is the fix too', pageProblems(imp + "<h1>Signals (fixture)</h1>").length === 0]);
  // Holes from the brain review of PR #1243, each pinned.
  checks.push(['"(fixture)" only in a // comment is not a label', pageProblems(imp + "// (fixture)\n<h1>Overview</h1>").length === 1]);
  checks.push(["<FixtureLabel> only in a JSX comment is not a label", pageProblems(imp + "{/* <FixtureLabel /> */}<h1>x</h1>").length === 1]);
  checks.push(["a label ONLY inside the sheet leaves the page body unlabelled", pageProblems(imp + "<h1>x</h1><BottomSheet><FixtureLabel /></BottomSheet>").length === 1]);
  checks.push(["an unlabelled <Dialog> detail view is caught", pageProblems(imp + "<FixtureLabel /><Dialog><OutcomeBadge /></Dialog>").length === 1]);
  checks.push(["an unlabelled <DialogContent> is caught", pageProblems(imp + "<FixtureLabel /><DialogContent>x</DialogContent>").length === 1]);
  const decisions = imp + "<h1>Decisions (fixture)</h1>\n<BottomSheet open>\n  <OutcomeBadge />\n</BottomSheet>";
  checks.push(["a labelled page whose bottom sheet is unlabelled is caught", pageProblems(decisions).length === 1]);
  checks.push(["a sheet carrying <FixtureLabel /> is the fix", pageProblems(decisions.replace("<OutcomeBadge />", "<FixtureLabel /><OutcomeBadge />")).length === 0]);
  checks.push(["a page with NO hook is judged too (fictional scenarios are fixtures)", pageProblems(`<h1>Access support</h1>`).length === 1]);
  checks.push(["a hook in a SECOND import statement is seen", fixtureHooks(`import { X } from "@workspace/api-client-react";\nimport { useListDecisions } from "@workspace/api-client-react";`).length === 1]);
  checks.push(["a namespace import is a read", fixtureHooks(`import * as api from "@workspace/api-client-react";`).length === 1]);
  checks.push(["a multi-line named import is seen", fixtureHooks(`import {\n  useListDecisions,\n  useGetDecision,\n} from "@workspace/api-client-react";`).length === 2]);
  checks.push(["a type-only import is not a read", fixtureHooks(`import type { Decision } from "@workspace/api-client-react";`).length === 0]);
  checks.push(["an aliased hook is still a hook", fixtureHooks(`import { useListDecisions as useList } from "@workspace/api-client-react";`).length === 1]);
  checks.push(["an EARLIER import (React) is not mistaken for a read", fixtureHooks(`import React, { useState } from "react";\nimport { ListDecisionsOutcome } from "@workspace/api-client-react";`).length === 0]);
  checks.push(["a hook import after other imports is still seen", fixtureHooks(`import React, { useState } from "react";\nimport { useListDecisions } from "@workspace/api-client-react";`).length === 1]);
  checks.push(["a commented-out import is not a read", fixtureHooks(`// import { useListDecisions } from "@workspace/api-client-react";`).length === 0]);
  checks.push(['a URL\'s "//" is not a comment', stripComments(`const u = "https://x/(fixture)";`).includes("(fixture)")]);
  const pages = listPages();
  checks.push([`the real pages tree holds at least ${PAGE_FLOOR} pages (${pages.length})`, pages.length >= PAGE_FLOOR]);
  const readers = pages.filter((f) => fixtureHooks(readFileSync(f, "utf8")).length > 0).length;
  checks.push([`at least ${HOOK_READER_FLOOR} real pages read the control plane (${readers})`, readers >= HOOK_READER_FLOOR]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const pages = listPages();
if (pages.length < PAGE_FLOOR) {
  console.error(`✗ only ${pages.length} page(s) found under ${PAGES_DIR} (floor ${PAGE_FLOOR}) — refusing to report a pass from a scan that read nothing.`);
  process.exit(1);
}

let readers = 0;
const problems = [];
for (const file of pages) {
  const rel = relative(repo, file).split("\\").join("/");
  const src = readFileSync(file, "utf8");
  if (fixtureHooks(src).length > 0) readers++;
  if (LIVE_PAGES.has(rel)) continue;
  for (const p of pageProblems(src)) problems.push(`${rel} — ${p}`);
}

console.log(`PWA fixture labels — ${pages.length} page(s) scanned, ${readers} read the control plane; ${LIVE_PAGES.size} page(s) proven live.`);
if (readers < HOOK_READER_FLOOR) {
  console.error(`✗ only ${readers} page(s) read the control plane (floor ${HOOK_READER_FLOOR}) — the import scan is broken, not the pages.`);
  process.exit(1);
}
if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} unlabelled fixture surface(s):`);
  for (const p of problems) console.error(`    ${p}`);
  console.error("\n  Render <FixtureLabel /> (artifacts/signalgrid-mobile-pwa/src/components/FixtureLabel.tsx)");
  console.error("  in the page body and inside every overlay over its data.");
  process.exit(1);
}
console.log("PWA fixture-label gate passed — every page body and every overlay says its data is a fixture.");
