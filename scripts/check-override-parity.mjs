#!/usr/bin/env node
// Gate: a bare-name pnpm-workspace.yaml `overrides` pin must match every package's
// own declaration of that dependency. An override like `esbuild: "0.27.3"` forces
// the whole workspace to 0.27.3, so a package.json that declares a DIFFERENT concrete
// version is dead text — it resolves to the override, not to what it claims. Three
// package.json files said "0.28.2" while resolving 0.27.3 and nothing noticed
// (2026-09-19; see the comment above the `esbuild` line in pnpm-workspace.yaml).
//
// Scope, deliberately narrow to avoid false positives:
//   - only BARE override keys (no `>`; a `a>b` key excludes/pins a transitive, not a
//     direct declaration) whose VALUE is a concrete semver (not `-`, not `npm:`/alias).
//   - a package's declaration fails ONLY when it is itself a concrete pin that differs.
//     A range (`^`, `~`, `>=`, `*`, `x`, `||`) or a protocol (`workspace:`, `catalog:`,
//     `npm:`) is honest — the override satisfies it — and is skipped.
// Offline, no dependencies, runs in preflight and CI. `--self-test` proves it can fail.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONCRETE = /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/; // exact semver, no range chars

// Parse the flat `overrides:` block of pnpm-workspace.yaml into { name: version } for
// bare-name keys pinned to a concrete version. The block is flat two-space YAML, so a
// line scanner is enough and needs no parser dependency.
export function parseBarePins(yamlText) {
  const pins = {};
  let inBlock = false;
  for (const raw of yamlText.split("\n")) {
    if (/^overrides:\s*$/.test(raw)) { inBlock = true; continue; }
    if (inBlock && /^\S/.test(raw)) break; // dedent to column 0 ends the block
    if (!inBlock) continue;
    const line = raw.replace(/#.*$/, "");
    const m = line.match(/^\s{2}(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:\s*(?:"([^"]*)"|'([^']*)'|(\S+))\s*$/);
    if (!m) continue;
    const key = m[1] ?? m[2] ?? m[3];
    const val = m[4] ?? m[5] ?? m[6];
    if (!key || key.includes(">")) continue;      // transitive pin, not a direct decl
    if (!val || !CONCRETE.test(val)) continue;    // "-", alias, or a range: not parity
    pins[key] = val;
  }
  return pins;
}

// Fail-closed: the whole gate is vacuous if there is no bare concrete pin to check
// against. Backlog row 2056 proposes lifting the one pin (esbuild), which would make
// `parseBarePins` return {} and — without this — the gate would print "ok, 0 pins"
// and pass forever with nothing behind it. A subject that vanishes must fail loud.
export function noPins(pins) { return Object.keys(pins).length === 0; }

const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

// A declaration only conflicts when it is itself a concrete pin differing from the
// override. Anything a range or protocol satisfies is honest.
export function conflicts(pins, pkgJson, pkgPath) {
  const out = [];
  for (const block of DEP_BLOCKS) {
    const deps = pkgJson[block];
    if (!deps) continue;
    for (const [name, decl] of Object.entries(deps)) {
      const pinned = pins[name];
      if (!pinned) continue;
      if (typeof decl !== "string" || !CONCRETE.test(decl)) continue; // range/protocol → honest
      if (decl !== pinned) out.push({ pkgPath, block, name, declared: decl, override: pinned });
    }
  }
  return out;
}

function selfTest() {
  const pins = parseBarePins(
    'overrides:\n  "esbuild>@esbuild/darwin-arm64": "-"\n  "@esbuild-kit/esm-loader": "npm:tsx@^4.21.0"\n  esbuild: "0.27.3"\n  qs: "6.15.2"\nnext:\n  esbuild: "9.9.9"\n'
  );
  const fail = (m) => { console.error(`self-test FAIL: ${m}`); process.exit(1); };
  if (pins.esbuild !== "0.27.3") fail(`bare concrete pin not parsed (got ${JSON.stringify(pins)})`);
  if (pins.qs !== "6.15.2") fail("second bare pin missed");
  if ("esbuild>@esbuild/darwin-arm64" in pins) fail("transitive '-' key leaked in");
  if ("@esbuild-kit/esm-loader" in pins) fail("npm: alias leaked in as a version pin");
  if (Object.keys(pins).length !== 2) fail(`dedent boundary broken — parsed ${JSON.stringify(pins)}`);

  const bad = conflicts(pins, { dependencies: { esbuild: "0.28.2" } }, "fixture/a");
  if (bad.length !== 1) fail("a concrete mismatch (0.28.2 vs 0.27.3) must be caught");

  const honest = conflicts(pins, {
    dependencies: { esbuild: "0.27.3" },              // matches → ok
    devDependencies: { esbuild: "^0.27.0" },          // range the override satisfies → ok
    peerDependencies: { qs: "workspace:*" },          // protocol → ok
    optionalDependencies: { unrelated: "1.0.0" },     // not overridden → ok
  }, "fixture/b");
  if (honest.length !== 0) fail(`honest declarations flagged: ${JSON.stringify(honest)}`);

  // fail-closed: an overrides block with no bare concrete pin must be caught, not passed.
  if (!noPins(parseBarePins('overrides:\n  "esbuild>@esbuild/darwin-arm64": "-"\n  "@esbuild-kit/esm-loader": "npm:tsx@^4.21.0"\n'))) fail("a pin-less overrides block must read as noPins (gate would fail-open)");
  if (noPins(pins)) fail("a block with concrete pins must NOT read as noPins");

  console.log("check-override-parity self-test: ok");
  return 0;
}

function main() {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const pins = parseBarePins(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8"));
  if (noPins(pins)) {
    console.error("Override parity FAIL — pnpm-workspace.yaml `overrides` carries no bare concrete pin.");
    console.error("This gate then checks nothing. If the last pin was lifted on purpose (see BUILD_BACKLOG row on lifting the esbuild override), record why here and remove this gate, or restore the pin. Silence is not an option.");
    process.exit(1);
  }
  const files = execSync("git ls-files '**/package.json' package.json", { cwd: ROOT, encoding: "utf8" })
    .split("\n").filter((f) => f && !f.includes("node_modules"));
  const all = [];
  const unreadable = [];
  let checked = 0;
  for (const rel of files) {
    let json;
    // Fail-closed: an unparseable package.json is a defect, not a file to skip in silence.
    // `catch { continue }` skipped it AND the count below then called it "checked" — a
    // fail-open plus a dishonest total. Collect and fail instead.
    try { json = JSON.parse(readFileSync(join(ROOT, rel), "utf8")); }
    catch (e) { unreadable.push(`${rel}: ${e.message}`); continue; }
    checked += 1;
    all.push(...conflicts(pins, json, rel));
  }
  if (unreadable.length) {
    console.error("Override parity FAIL — unparseable package.json (fail-closed, not skipped):\n");
    for (const u of unreadable) console.error(`  ${u}`);
    process.exit(1);
  }
  if (all.length) {
    console.error("Override parity FAIL — a declared version is dead text (the override wins):\n");
    for (const c of all) {
      console.error(`  ${c.pkgPath}  ${c.block}.${c.name}: "${c.declared}" but overrides pin "${c.override}" — set it to "${c.override}" or drop the redundant declaration`);
    }
    process.exit(1);
  }
  const pinNames = Object.keys(pins);
  console.log(`check-override-parity: ok — ${checked} package.json checked against ${pinNames.length} bare override pin(s) [${pinNames.join(", ")}]`);
}

main();
