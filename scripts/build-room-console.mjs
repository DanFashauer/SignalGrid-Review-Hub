// Build the fully client-side Trusted Room Entry console.
//
// Bundles the decision core + orchestration + scenarios (@workspace/room-sim
// browser entry) with esbuild, then inlines the bundle into the UI shell to
// produce a single self-contained HTML file that runs entirely in the browser —
// no server, no network, works on iPhone/iPad.
//
//   node scripts/build-room-console.mjs
//
// Output: docs/room-entry-console.html
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

const result = await esbuild.build({
  entryPoints: [resolve(repo, "lib/room-sim/src/browser.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  write: false,
});
const bundle = result.outputFiles[0].text;
if (bundle.includes("</script")) throw new Error("bundle contains a </script token; cannot inline safely");

// THE BUNDLE MUST CARRY THE SCENARIOS, not just compile. Three ids from the three
// domains: if the browser entry stops re-exporting the catalogue, the page would
// still build and show an empty list.
for (const marker of ["compliant-standard", "wh-noncompliant-pick", "gf-disabled-field"]) {
  if (!bundle.includes(marker)) throw new Error(`bundle is missing scenario "${marker}"; the catalogue was not linked in`);
}

const shell = readFileSync(resolve(repo, "tools/room-console/shell.html"), "utf8");
// The marker guard: `String.replace` with a missing needle is a silent no-op, and
// the page would ship with an empty <script> and no engine.
if (!shell.includes("/*__BUNDLE__*/")) throw new Error("tools/room-console/shell.html has no /*__BUNDLE__*/ marker; nothing to inline into");

// sigClass VECTORS — the shell's signal colouring, run here because the page has no
// other test. The law: a value that is not known-good is never green.
// `non_compliant` rendered green (the raw string contains "compliant") until this ran.
const sigSrc = /\/\*sigClass:start\*\/([\s\S]*?)\/\*sigClass:end\*\//.exec(shell)?.[1];
if (!sigSrc) throw new Error("tools/room-console/shell.html has no /*sigClass:start*/…/*sigClass:end*/ block to test");
const sigClass = new Function(`${sigSrc}; return sigClass;`)();
const sigVectors = [
  [true, "ok"], [false, "bad"],
  ["compliant", "ok"], ["non_compliant", "bad"], ["noncompliant", "bad"], ["non-compliant", "bad"],
  ["present", "ok"], ["not_present", "bad"], ["absent", "bad"],
  ["enabled", "ok"], ["disabled", "bad"],
  ["fresh", "ok"], ["stale", "bad"], ["expired", "bad"],
  ["aligned", "ok"], ["drifted", "bad"], ["misfit", "bad"],
  ["supported", "ok"], ["unsupported", "bad"], ["docked", "ok"], ["undocked", "bad"], ["bound", "ok"], ["unbound", "bad"],
  ["nominal", "ok"], ["forced", "bad"], ["tampered", "bad"], ["offline", "bad"], ["faulted", "bad"], ["removed", "bad"],
  // Negations the lists do NOT enumerate: only the negation rule keeps them off green.
  ["unaligned", "bad"], ["not_fresh", "bad"], ["non_nominal", "bad"],
  ["unknown", "warn"], ["missing", "warn"], ["suspected", "warn"], ["degraded", "warn"],
  ["something_new", "warn"], ["", "warn"], [null, "warn"], [undefined, "warn"], [42, "warn"],
];
const sigFailures = sigVectors.filter(([v, want]) => sigClass(v) !== want).map(([v, want]) => `${JSON.stringify(v)} → ${sigClass(v)} (want ${want})`);
if (sigFailures.length > 0) throw new Error(`sigClass renders the wrong colour:\n  ${sigFailures.join("\n  ")}`);
const wronglyGreen = sigVectors.filter(([, want]) => want !== "ok").filter(([v]) => sigClass(v) === "ok");
if (wronglyGreen.length > 0) throw new Error(`sigClass renders a non-good value green: ${wronglyGreen.map(([v]) => JSON.stringify(v)).join(", ")}`);

const content = shell.replace("/*__BUNDLE__*/", () => bundle);
const i = content.indexOf('<div class="wrap">');
const head = content.slice(0, i).trim();
const body = content.slice(i).trim();

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="SignalGrid Trusted Room Entry — a context-aware trust & orchestration simulation that runs entirely in the browser.">
${head}
</head>
<body>
${body}
</body>
</html>
`;

const out = resolve(repo, "docs/room-entry-console.html");
writeFileSync(out, html);
console.log(`Built ${out} (${html.length} bytes; bundle ${bundle.length} bytes)`);
