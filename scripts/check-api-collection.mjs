#!/usr/bin/env node
// The Bruno collection (artifacts/api-collection) names API paths verbatim.
// A collection that drifts from the routes silently becomes documentation of
// an API that no longer exists — the exact failure mode this repo's gates
// exist to kill. This check parses every .bru url and requires a matching
// route registration in artifacts/api-server/src/routes/.
//
// Matching rule: {{var}} segments in the collection and :param segments in
// the routes both normalize to "*". Route paths are matched as suffixes of
// the collection path (routers mount under /api and sometimes a prefix).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const COLLECTION = "artifacts/api-collection";
const ROUTES_DIR = "artifacts/api-server/src/routes";

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const norm = (p) => p.replace(/\{\{[^}]+\}\}/g, "*").replace(/:[A-Za-z_]+/g, "*").replace(/\/+$/, "");

// EXACT method+path pairs, never suffix matching: with a suffix rule,
// deleting /v1/policies stayed green because monitoring.ts registers a bare
// /policies — a removed route read as covered by an unrelated shorter one.
// Only MOUNTED routers count: a route file removed from routes/index.ts but
// left on disk must not keep its registrations alive here, and a
// commented-out registration must not either — both were false-pass paths.
// Not established by this: a router mounted conditionally at runtime; the
// api test suite exercises the configured app for that.
const indexSrc = readFileSync(join(ROUTES_DIR, "index.ts"), "utf8");
const mounted = new Set(
  [...indexSrc.matchAll(/from\s+"\.\/([A-Za-z0-9-]+)"/g)].map((m) => `${m[1]}.ts`),
);
const routePairs = new Set();
for (const f of walk(ROUTES_DIR).filter((f) => f.endsWith(".ts") && f !== join(ROUTES_DIR, "index.ts"))) {
  const base = f.split("/").pop();
  if (!mounted.has(base)) continue;
  const src = readFileSync(f, "utf8");
  for (const line of src.split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    const m = line.match(/router\.(get|post|put|delete|patch)\(\s*"([^"]+)"/);
    if (m) routePairs.add(`${m[1].toUpperCase()} ${norm(m[2])}`);
  }
}

let checked = 0;
const misses = [];
for (const f of walk(COLLECTION).filter((f) => f.endsWith(".bru") && !f.includes("environments") && !f.endsWith("collection.bru"))) {
  const src = readFileSync(f, "utf8");
  const m = src.match(/(get|post|put|delete|patch)\s*\{[^}]*url:\s*\{\{baseUrl\}\}(\S+)/);
  if (!m) {
    // A request file this parser cannot read is a request this gate cannot
    // guard — silently excluding it would let coverage shrink under a green.
    misses.push(`${f} → UNPARSEABLE (no method/url block this checker recognizes)`);
    continue;
  }
  checked += 1;
  const want = `${m[1].toUpperCase()} ${norm(m[2])}`;
  if (!routePairs.has(want)) misses.push(`${f} → ${m[1].toUpperCase()} ${m[2]}`);
}

if (checked === 0) {
  console.error("API-collection check FAILED: zero requests parsed — the parser, not the API, is broken.");
  process.exit(1);
}
if (misses.length > 0) {
  console.error(`API-collection check FAILED: ${misses.length} request path(s) match no registered route:`);
  for (const miss of misses) console.error(`  ✗ ${miss}`);
  process.exit(1);
}
console.log(`API-collection check passed — all ${checked} request paths match registered routes.`);
