/**
 * OpenAPI contract check (static, deterministic).
 *
 * Compares the `/v1` routes actually registered in the API server against the
 * paths documented in the OpenAPI spec, in both directions, so the spec cannot
 * silently drift from the implementation (the class of mismatch a reviewer
 * caught on the response envelope). No server is started; this reads source.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const routesFile = resolve(root, "artifacts/api-server/src/routes/v1.ts");
const specFile = resolve(root, "lib/api-spec/v1-openapi.yaml");

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

/** Normalize `:id` (Express) → `{id}` (OpenAPI) so paths compare equal. */
function normalize(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function parseRoutes(source: string): Set<string> {
  const routes = new Set<string>();
  const re = /router\.(get|post|put|delete|patch)\(\s*"(\/v1\/[^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    routes.add(`${match[1].toUpperCase()} ${normalize(match[2])}`);
  }
  return routes;
}

function parseSpec(source: string): Set<string> {
  const endpoints = new Set<string>();
  const lines = source.split("\n");
  let currentPath: string | null = null;
  for (const line of lines) {
    // Reset on ANY top-level path key (e.g. /cp/v1/*), not just /v1/*, so a
    // later path's methods are never mis-attributed to the previous /v1 path.
    const pathMatch = line.match(/^ {2}(\/\S*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    // Only the /v1 surface is contract-checked here.
    if (currentPath && currentPath.startsWith("/v1/")) {
      const methodMatch = line.match(/^ {4}([a-z]+):\s*$/);
      if (methodMatch && (METHODS as readonly string[]).includes(methodMatch[1])) {
        endpoints.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
      }
    }
  }
  return endpoints;
}

async function main(): Promise<void> {
  const [routesSrc, specSrc] = await Promise.all([
    readFile(routesFile, "utf8"),
    readFile(specFile, "utf8"),
  ]);

  const implemented = parseRoutes(routesSrc);
  const documented = parseSpec(specSrc);

  const undocumented = [...implemented].filter((r) => !documented.has(r)).sort();
  const unimplemented = [...documented].filter((r) => !implemented.has(r)).sort();

  console.log("OpenAPI contract check (v1 routes ↔ spec)");
  console.log(`Implemented routes: ${implemented.size}`);
  console.log(`Documented endpoints: ${documented.size}`);

  for (const route of [...implemented].sort()) {
    const ok = documented.has(route);
    console.log(`${ok ? "OK  " : "MISS"} ${route}`);
  }

  if (undocumented.length > 0) {
    console.error("\nImplemented but NOT documented in the OpenAPI spec:");
    for (const r of undocumented) console.error(`- ${r}`);
  }
  if (unimplemented.length > 0) {
    console.error("\nDocumented but NOT implemented:");
    for (const r of unimplemented) console.error(`- ${r}`);
  }

  if (implemented.size === 0) {
    console.error("\nNo routes parsed — the route-matching heuristic may be stale.");
    process.exitCode = 1;
    return;
  }

  if (undocumented.length > 0 || unimplemented.length > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("\nContract holds: every /v1 route is documented and vice versa.");
}

await main();
