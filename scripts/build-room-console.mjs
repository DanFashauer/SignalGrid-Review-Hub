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

const shell = readFileSync(resolve(repo, "tools/room-console/shell.html"), "utf8");
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
