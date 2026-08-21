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
const routePairs = new Set();
for (const f of walk(ROUTES_DIR).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/router\.(get|post|put|delete|patch)\(\s*\n?\s*"([^"]+)"/g)) {
    routePairs.add(`${m[1].toUpperCase()} ${norm(m[2])}`);
  }
}

let checked = 0;
const misses = [];
for (const f of walk(COLLECTION).filter((f) => f.endsWith(".bru") && !f.includes("environments") && !f.endsWith("collection.bru"))) {
  const src = readFileSync(f, "utf8");
  const m = src.match(/(get|post|put|delete|patch)\s*\{[^}]*url:\s*\{\{baseUrl\}\}(\S+)/);
  if (!m) continue;
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
