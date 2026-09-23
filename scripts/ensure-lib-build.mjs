// ensure-lib-build.mjs — heal a stale TypeScript project-references build before
// `tsc --build` runs, so the typecheck (and the evidence re-mint that runs it) can
// never fail spuriously on an incremental-cache desync.
//
// THE BUG THIS FIXES (reproduced 2026-09-20). The composite libs under `lib/*` emit
// `dist/*.d.ts` and record `tsconfig.tsbuildinfo`. `tsc --build` is incremental: if a
// lib's `.tsbuildinfo` says it is up to date, it SKIPS the rebuild — even when the
// lib's `dist/` has since been deleted (a partial clean, a tool that clears dist, a
// checkout that carried the tsbuildinfo but not the emitted output). The build then
// exits 0 having emitted nothing, and the DOWNSTREAM app typecheck fails with
// `TS6305: Output file '…/dist/index.d.ts' has not been built`, which cascades into
// `{}`/implicit-any errors that read like an app bug but are pure build staleness.
// The Mac's unattended evidence re-mint (`verify:all --emit-evidence`) hit exactly
// this and failed, blocking readiness recovery.
//
// THE FIX. A `.tsbuildinfo` whose emitted output is gone is a lie about being built.
// Delete it; `tsc --build` then rebuilds the lib from source. Fast in the healthy
// case (a few stat checks), self-healing in the desynced one, and a no-op when both
// the tsbuildinfo and the output are present (or both absent — a clean checkout).
//
// Wired as the first half of `typecheck:libs` (package.json).

import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Strip // and /* *\/ comments so JSON.parse can read a tsconfig. */
function readJsonc(path) {
  const raw = readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  return JSON.parse(raw);
}

/** A composite lib's build identity: where its tsbuildinfo and emitted .d.ts live. */
function libBuildTargets(root, io = defaultIo) {
  const out = [];
  for (const name of io.listLibs(root)) {
    const dir = join(root, "lib", name);
    const tsconfigPath = join(dir, "tsconfig.json");
    if (!io.exists(tsconfigPath)) continue;
    let cfg;
    try {
      cfg = io.readJson(tsconfigPath);
    } catch {
      continue;
    }
    const co = cfg.compilerOptions || {};
    if (co.composite !== true) continue;
    const outDir = join(dir, co.outDir || "dist");
    // tsc --build's default tsbuildinfo is `<tsconfig-dir>/tsconfig.tsbuildinfo`
    // unless tsBuildInfoFile overrides it.
    const tsbuildinfo = co.tsBuildInfoFile
      ? join(dir, co.tsBuildInfoFile)
      : join(dir, "tsconfig.tsbuildinfo");
    out.push({ name, outDir, tsbuildinfo });
  }
  return out;
}

/** A target is ORPHANED when its tsbuildinfo exists but its emitted output is gone. */
function orphaned(target, io = defaultIo) {
  if (!io.exists(target.tsbuildinfo)) return false; // nothing claims it is built
  return !io.hasDeclarations(target.outDir); // built once, output now missing → stale
}

const defaultIo = {
  listLibs: (root) => {
    try {
      return readdirSync(join(root, "lib"), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  },
  exists: (p) => existsSync(p),
  readJson: (p) => readJsonc(p),
  hasDeclarations: (outDir) => {
    if (!existsSync(outDir)) return false;
    try {
      return readdirSync(outDir).some((f) => f.endsWith(".d.ts"));
    } catch {
      return false;
    }
  },
};

function run() {
  const targets = libBuildTargets(repoRoot);
  const stale = targets.filter((t) => orphaned(t));
  for (const t of stale) {
    rmSync(t.tsbuildinfo, { force: true });
    console.log(`ensure-lib-build: removed orphaned ${t.tsbuildinfo.replace(repoRoot + "/", "")} (its dist was gone) — tsc --build will rebuild ${t.name}`);
  }
  if (stale.length === 0) console.log(`ensure-lib-build: ${targets.length} composite lib(s) consistent, nothing to heal`);
}

function selfTest() {
  const checks = [];
  // Fixture IO: two composite libs. `gone` has a tsbuildinfo but no .d.ts output
  // (the bug). `ok` has both. `fresh` has neither (a clean checkout).
  const files = new Set(["lib/gone/tsconfig.json", "lib/gone/tsconfig.tsbuildinfo", "lib/ok/tsconfig.json", "lib/ok/tsconfig.tsbuildinfo", "lib/fresh/tsconfig.json"]);
  const io = {
    listLibs: () => ["gone", "ok", "fresh"],
    exists: (p) => files.has(p.replace("/root/", "")),
    readJson: () => ({ compilerOptions: { composite: true, outDir: "dist" } }),
    hasDeclarations: (outDir) => outDir.includes("lib/ok/"), // only ok has emitted output
  };
  const targets = libBuildTargets("/root", io);
  const stale = targets.filter((t) => orphaned(t, io)).map((t) => t.name);
  checks.push(["a tsbuildinfo with no emitted dist is flagged stale (the bug)", stale.includes("gone")]);
  checks.push(["a lib with both tsbuildinfo and dist is NOT flagged", !stale.includes("ok")]);
  checks.push(["a clean lib with neither is NOT flagged (no orphan to heal)", !stale.includes("fresh")]);
  checks.push(["exactly the one stale lib is flagged", stale.length === 1]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());
run();
