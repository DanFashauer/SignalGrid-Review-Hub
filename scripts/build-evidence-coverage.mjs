// Build the standalone Evidence Coverage page.
//
// Bundles the REAL coverage model (`buildCoverageReport` from @workspace/flows, via the
// typechecked browser entry in src/evidence-coverage-page.ts) with esbuild, then inlines
// the bundle into the UI shell to produce a single self-contained HTML file that runs
// entirely in the browser — no server, no network, works on a phone, opens from a file://
// URL. Same shape as build-room-console.mjs.
//
//   node scripts/build-evidence-coverage.mjs
//
// Output: docs/evidence-coverage.html
//
// WHY BUNDLE RATHER THAN TRANSCRIBE. This page and `GET /cp/v1/grid/evidence-coverage`
// and the review console's Evidence Coverage section all show the same numbers. A page
// holding its own copy of the axis table would be a third statement of a fact the model
// already makes — and the first one to go stale would be the one a prospect is looking
// at. `.github/workflows/pages.yml` regenerates this file before publishing for the same
// reason: a stale committed copy must not be able to reach the site.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

const result = await esbuild.build({
  entryPoints: [resolve(here, "src/evidence-coverage-page.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  write: false,
  conditions: ["workspace"],
});
const bundle = result.outputFiles[0].text;
if (bundle.includes("</script")) throw new Error("bundle contains a </script token; cannot inline safely");

// THE AXIS TABLE LINKED IN — and that is ALL these markers establish. An earlier comment
// here claimed they proved "the real model came along"; a review disproved it by replacing
// `buildCoverageReport` with a hardcoded stub and watching all three markers survive,
// because they are constants of the TABLE, retained by KNOWN_SOURCE_PLANES and
// SOURCE_PLANE_PROMPTS alone. That the FUNCTION linked in and computes is established by
// the browser E2E (scripts/src/e2e/evidence-coverage-page.spec.ts), which loads the built
// file and pins the figures — not here. Stated exactly, so the next reader does not
// inherit the overclaim.
for (const marker of ["identityEnabled", "criticalSignalsPresent", "dock_hardware"]) {
  if (!bundle.includes(marker)) {
    throw new Error(`bundle is missing ${marker}; the axis table was not linked in`);
  }
}

// AND CHECK WHAT MUST BE ABSENT. Importing the `@workspace/flows` barrel dragged 3,330
// characters of provisioning step catalogs into a file bound for a public domain — a third
// of the payload, unrelated to this page, with nothing to notice the next addition. The
// entry imports the subpath now; this makes that permanent rather than a habit.
for (const stowaway of ["Autopilot", "PreStage", "Zero-Touch"]) {
  if (bundle.includes(stowaway)) {
    throw new Error(
      `bundle contains ${stowaway} — something is pulling in the flows barrel again; ` +
        "import @workspace/flows/evidence-coverage, not @workspace/flows",
    );
  }
}

const shell = readFileSync(resolve(repo, "tools/evidence-coverage/shell.html"), "utf8");
const content = shell.replace("/*__BUNDLE__*/", () => bundle);
if (content === shell) throw new Error("shell has no /*__BUNDLE__*/ placeholder; nothing was inlined");
// EVERY SPLIT POINT IS CHECKED. `indexOf` returns -1 on a miss and `slice(-1)` happily
// returns the last character, so an unguarded version of this produced a bundle stranded
// in <head> behind an unterminated tag — and still printed a cheerful byte count. Editing
// the shell's <script> tag was enough to trigger it.
const wrapAt = content.indexOf('<div class="wrap">');
if (wrapAt === -1) throw new Error('shell has no <div class="wrap"> split marker');
const head = content.slice(0, wrapAt).trim();
const body = content.slice(wrapAt).trim();

// The bundle renders on load, so it must run AFTER the mount points exist — the shell
// keeps the <script> in the head-half, so it is moved to the end of the body here.
const scriptAt = head.indexOf("<script>");
if (scriptAt === -1) throw new Error("shell has no bare <script> tag to relocate");
const script = head.slice(scriptAt);
const headOnly = head.slice(0, scriptAt).trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="SignalGrid Evidence Coverage — which of the decision engine's evidence axes a deployment can actually answer, which are dark, and which are dark and ungraded. Runs entirely in the browser; reads no customer data.">
${headOnly}
</head>
<body>
${body}
${script}
</body>
</html>
`;

const out = resolve(repo, "docs/evidence-coverage.html");
writeFileSync(out, html);
console.log(`Built ${out} (${html.length} bytes; bundle ${bundle.length} bytes)`);
