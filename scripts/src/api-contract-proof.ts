/**
 * OpenAPI contract check (static, deterministic).
 *
 * Compares the routes actually registered in the API server against the paths
 * documented in the OpenAPI spec, in both directions, so the spec cannot
 * silently drift from the implementation. No server is started; this reads
 * source.
 *
 * SCOPE — this covers the WHOLE served surface, `/v1` and `/cp/v1` alike.
 *
 * It did not always. The check was written for `/v1` only, read a single route
 * file, and said so in a comment ("Only the /v1 surface is contract-checked
 * here"). The spec meanwhile documented 21 `/cp/v1` operations, which reads to
 * anyone opening it as a gated surface. It was not gated at all, and three
 * control-plane routes — `/cp/v1/self-audit`, `/cp/v1/reliability`,
 * `/cp/v1/iac` — drifted out of the document while this proof printed
 * "Contract holds" on every run. A gate whose scope is narrower than the
 * document it guards manufactures exactly the unearned affirmative this
 * repository exists to prevent.
 *
 * Run `--self-test` to prove the comparison can still fail.
 */
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Every file that registers a route on the served router, and the prefixes it
 * owns. Adding a route file without adding it here is caught by the
 * unregistered-file check below, not by a reviewer noticing.
 */
/**
 * ONE SCOPE PER DOCUMENT. The check was written for v1-openapi.yaml and read
 * only that file; lib/api-spec/openapi.yaml — the document orval generates TWO
 * shipping packages from (@workspace/api-zod via api-server, @workspace/
 * api-client-react via signalgrid-app) — was read by no gate at all, and
 * documented six write operations the server never served (POST /decisions,
 * /signals/ingest, and the whole policy create/get/update/delete set). Generated
 * hooks for them existed and reached the JSON 404 catch-all. This proof printed
 * "Contract holds" throughout, because its scope was narrower than the documents
 * it guarded — the same defect the header above describes, one document over.
 */
interface ContractDocument {
  readonly spec: string;
  readonly routeFiles: readonly string[];
  /** Served paths under these prefixes are governed by this document. */
  readonly prefixes: readonly string[];
}
const DOCUMENTS: readonly ContractDocument[] = [
  {
    spec: "lib/api-spec/v1-openapi.yaml",
    routeFiles: ["artifacts/api-server/src/routes/v1.ts", "artifacts/api-server/src/routes/control-plane.ts"],
    prefixes: ["/v1/", "/cp/v1/"],
  },
  {
    // Mounted under /api; the spec's `servers: - url: /api` carries the prefix,
    // so paths compare root-relative.
    spec: "lib/api-spec/openapi.yaml",
    routeFiles: [
      "artifacts/api-server/src/routes/health.ts",
      "artifacts/api-server/src/routes/integrations.ts",
      "artifacts/api-server/src/routes/monitoring.ts",
      "artifacts/api-server/src/routes/radar.ts",
      "artifacts/api-server/src/routes/simulator.ts",
    ],
    prefixes: ["/"],
  },
];

/**
 * Route files that are deliberately in NO document, each with the reason. The
 * registry check below fails on a route file that is neither here nor in a
 * document, so a new router cannot appear ungoverned by omission.
 */
const UNDOCUMENTED_BY_DESIGN: ReadonlyMap<string, string> = new Map([
  ["index.ts", "the mount, registers no route of its own (the 404 catch-all is not a route)"],
  [
    "sim.ts",
    "demo-only, mounted only under the review-demo profile: POST /api/sim/room-entry writes another tenant's ledger from a client-supplied scenarioId and is unauthenticated by construction (routes/index.ts) — a public contract must not advertise it",
  ],
]);

/** The v1 document's prefixes — the default for the self-test's older cases. */
const GOVERNED_PREFIXES = DOCUMENTS[0]!.prefixes;

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

/** Normalize `:id` (Express) → `{id}` (OpenAPI) so paths compare equal. */
function normalize(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function governed(path: string, prefixes: readonly string[] = GOVERNED_PREFIXES): boolean {
  return prefixes.some((p) => path.startsWith(p));
}

/**
 * Registered routes. `\s*` after the paren spans newlines on purpose: a route
 * written as `router.post(\n  "/v1/…"` is registered exactly like a one-liner,
 * and a matcher that misses it under-reports the implementation — which fails
 * SILENTLY, in the direction that looks green.
 */
export function parseRoutes(source: string, prefixes: readonly string[] = GOVERNED_PREFIXES): Set<string> {
  const routes = new Set<string>();
  const re = /router\.(get|post|put|delete|patch)\(\s*"(\/[^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const path = normalize(match[2]);
    if (governed(path, prefixes)) routes.add(`${match[1].toUpperCase()} ${path}`);
  }
  return routes;
}

export function parseSpec(source: string, prefixes: readonly string[] = GOVERNED_PREFIXES): Set<string> {
  const endpoints = new Set<string>();
  const lines = source.split("\n");
  let currentPath: string | null = null;
  for (const line of lines) {
    // Reset on ANY top-level path key, so a later path's methods are never
    // mis-attributed to the previous one.
    const pathMatch = line.match(/^ {2}(\/\S*):\s*$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    if (currentPath && governed(currentPath, prefixes)) {
      const methodMatch = line.match(/^ {4}([a-z]+):\s*$/);
      if (methodMatch && (METHODS as readonly string[]).includes(methodMatch[1])) {
        endpoints.add(`${methodMatch[1].toUpperCase()} ${currentPath}`);
      }
    }
  }
  return endpoints;
}

function selfTest(): number {
  const checks: Array<[string, boolean]> = [];

  const oneLiner = `router.get("/v1/thing", h);`;
  checks.push(["a one-line registration is seen", parseRoutes(oneLiner).has("GET /v1/thing")]);

  const multiLine = `router.post(\n  "/v1/policies/:id/versions/:versionId/activate",\n  handler,\n);`;
  checks.push([
    "a registration with the path on the NEXT line is seen (under-reporting fails green)",
    parseRoutes(multiLine).has("POST /v1/policies/{id}/versions/{versionId}/activate"),
  ]);

  checks.push([
    "the control-plane surface is in scope",
    parseRoutes(`router.get("/cp/v1/self-audit", h);`).has("GET /cp/v1/self-audit"),
  ]);

  checks.push([
    "an ungoverned path is ignored rather than reported as drift",
    parseRoutes(`router.get("/api/internal/thing", h);`).size === 0,
  ]);

  const spec = ["paths:", "  /cp/v1/iac:", "    get:", "      summary: x", "  /v1/audit:", "    get:", "      summary: y"].join("\n");
  const parsed = parseSpec(spec);
  checks.push([
    "the spec parser reads both surfaces",
    parsed.has("GET /cp/v1/iac") && parsed.has("GET /v1/audit") && parsed.size === 2,
  ]);

  const misattribution = ["paths:", "  /v1/audit:", "    get:", "  /internal/x:", "    post:"].join("\n");
  checks.push([
    "a method under an ungoverned path is not attributed to the previous one",
    !parseSpec(misattribution).has("POST /v1/audit"),
  ]);

  // The negative control: the exact drift this proof missed for real.
  const drifted = parseRoutes(`router.get("/cp/v1/iac", h);`);
  const silent = parseSpec(["paths:", "  /v1/audit:", "    get:"].join("\n"));
  checks.push([
    "an undocumented control-plane route IS drift (the miss this proof shipped with)",
    [...drifted].some((r) => !silent.has(r)),
  ]);

  // The SECOND document's scope: root-relative /api paths are governed under "/".
  const apiPrefixes = DOCUMENTS[1]!.prefixes;
  checks.push([
    "a root-relative /api route is in the second document's scope",
    parseRoutes(`router.get("/decisions", h);`, apiPrefixes).has("GET /decisions"),
  ]);
  const specOnly = parseSpec(["paths:", "  /policies:", "    get:", "    post:"].join("\n"), apiPrefixes);
  const served = parseRoutes(`router.get("/policies", h);`, apiPrefixes);
  checks.push([
    "a spec-only write operation under openapi.yaml IS drift (the six the server never served)",
    [...specOnly].some((e) => !served.has(e)),
  ]);
  checks.push([
    "every document names at least one route file, and every UNDOCUMENTED_BY_DESIGN entry carries a reason",
    DOCUMENTS.every((d) => d.routeFiles.length > 0 && d.prefixes.length > 0) &&
      [...UNDOCUMENTED_BY_DESIGN.values()].every((r) => r.length > 20),
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

async function main(): Promise<void> {
  if (process.argv.includes("--self-test")) {
    process.exitCode = selfTest();
    return;
  }

  // The route-file registry: every file under routes/ is in a document or is
  // named undocumented WITH a reason. A router added tomorrow is caught here.
  const routesDir = resolve(root, "artifacts/api-server/src/routes");
  const onDisk = (await readdir(routesDir)).filter((f) => f.endsWith(".ts")).sort();
  const registered = new Set(DOCUMENTS.flatMap((d) => d.routeFiles.map((f) => f.split("/").pop()!)));
  const unregistered = onDisk.filter((f) => !registered.has(f) && !UNDOCUMENTED_BY_DESIGN.has(f));
  const staleExemptions = [...UNDOCUMENTED_BY_DESIGN.keys()].filter((f) => !onDisk.includes(f) || registered.has(f));
  console.log("OpenAPI contract check (served routes ↔ spec)");
  console.log(`Route files on disk: ${onDisk.length}; in a document: ${registered.size}; undocumented by design: ${UNDOCUMENTED_BY_DESIGN.size}`);
  if (unregistered.length > 0 || staleExemptions.length > 0) {
    for (const f of unregistered) console.error(`- routes/${f} is in NO document and has no stated reason — a router nobody gates`);
    for (const f of staleExemptions) console.error(`- UNDOCUMENTED_BY_DESIGN names routes/${f}, which is absent or now in a document — remove the entry`);
    process.exitCode = 1;
    return;
  }

  let failed = false;
  for (const doc of DOCUMENTS) {
    const specSrc = await readFile(resolve(root, doc.spec), "utf8");
    const sources = await Promise.all(
      doc.routeFiles.map(async (f) => [f, await readFile(resolve(root, f), "utf8")] as const),
    );

    const implemented = new Set<string>();
    const perFile = new Map<string, number>();
    for (const [file, src] of sources) {
      const routes = parseRoutes(src, doc.prefixes);
      perFile.set(file, routes.size);
      for (const r of routes) implemented.add(r);
    }
    const documented = parseSpec(specSrc, doc.prefixes);

    const undocumented = [...implemented].filter((r) => !documented.has(r)).sort();
    const unimplemented = [...documented].filter((r) => !implemented.has(r)).sort();

    console.log(`\n${doc.spec} — governed prefixes: ${doc.prefixes.join(" ")}`);
    for (const [file, n] of perFile) console.log(`  ${n} routes — ${file}`);
    console.log(`Implemented routes: ${implemented.size}`);
    console.log(`Documented endpoints: ${documented.size}`);

    for (const route of [...implemented].sort()) {
      console.log(`${documented.has(route) ? "OK  " : "MISS"} ${route}`);
    }

    // A document that parses to ZERO endpoints, or a route file that registers
    // nothing under a governed prefix, is a stale matcher or a stale registry —
    // and both look green from the totals alone.
    if (documented.size === 0) {
      console.error(`\n${doc.spec} parsed to ZERO documented endpoints — the spec parser is not reading this document.`);
      failed = true;
      continue;
    }
    const empty = [...perFile].filter(([, n]) => n === 0).map(([f]) => f);
    if (empty.length > 0) {
      console.error("\nRoute file registering NO governed route — stale matcher or stale registry:");
      for (const f of empty) console.error(`- ${f}`);
      failed = true;
      continue;
    }

    if (undocumented.length > 0) {
      console.error(`\nImplemented but NOT documented in ${doc.spec}:`);
      for (const r of undocumented) console.error(`- ${r}`);
    }
    if (unimplemented.length > 0) {
      console.error(`\nDocumented in ${doc.spec} but NOT implemented:`);
      for (const r of unimplemented) console.error(`- ${r}`);
    }
    if (undocumented.length > 0 || unimplemented.length > 0) failed = true;
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log(`\nContract holds across ${DOCUMENTS.length} documents: every governed route is documented and vice versa.`);
}

await main();
