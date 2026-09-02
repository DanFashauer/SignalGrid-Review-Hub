#!/usr/bin/env node
// The Bruno collection (artifacts/api-collection) names API paths verbatim.
// A collection that drifts from the routes silently becomes documentation of
// an API that no longer exists — the exact failure mode this repo's gates
// exist to kill. v1 of this check guarded one direction only: every .bru url
// must match a registered route. v2 adds the reverse, because the collection
// is now the CANONICAL API workspace: every route the api-server registers
// must carry at least one .bru request, or a declared exception below with a
// reason and a date. One-directional coverage rots in exactly the way the
// one-directional check cannot see — a new route ships, nobody writes the
// request, and the workspace quietly stops being the API's map.
//
// Matching rule: {{var}} segments in the collection and :param segments in
// the routes both normalize to "*"; query strings are ignored. EXACT
// method+path pairs, never suffix matching: with a suffix rule, deleting
// /v1/policies stayed green because monitoring.ts registers a bare
// /policies — a removed route read as covered by an unrelated shorter one.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const COLLECTION = "artifacts/api-collection";
const ROUTES_DIR = "artifacts/api-server/src/routes";
// The GA allowlist is read from the runtime's own file, not restated here —
// a second copy of that list would be a second place for it to drift.
const PROFILE_TS = "artifacts/api-server/src/lib/profile.ts";

// ── Declared exceptions ───────────────────────────────────────────────────────
// A route may skip collection coverage ONLY by standing here, with a reason a
// reviewer can weigh and the date it was declared. The bar is "cannot be
// exercised from a request/response collection at all" (an SSE/stream
// endpoint, a websocket upgrade) — not "awkward to demo": the WebAuthn
// ceremony routes, for instance, stay covered because sending the request and
// receiving the fail-closed 403 IS the exercisable contract. Two hard rules,
// both enforced below: a GA route may NEVER be excepted (the launch surface
// is precisely what must not go unmapped), and an exception whose route no
// longer exists — or has since gained a request — is FATAL, so the list can
// only shrink toward zero, never fossilize.
const DECLARED_EXCEPTIONS = [
  // none — as of 2026-08-21 every registered route has at least one request.
  // Shape when one is needed:
  // { method: "GET", path: "/v1/events/stream", reason: "SSE — no terminating response for a collection to assert on", date: "YYYY-MM-DD" },
];

const norm = (p) =>
  p
    .split("?")[0]
    .replace(/\{\{[^}]+\}\}/g, "*")
    .replace(/:[A-Za-z_]+/g, "*")
    .replace(/\/+$/, "");

// Strip comments before scanning for registrations, so a commented-out
// registration cannot keep a route "alive" here (a v1 false-pass path).
// Full-line // comments and /* */ blocks only — a "//" inside a string (URLs
// in fixture data) must survive, so trailing-comment stripping is deliberately
// not attempted.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

/**
 * Pure audit over already-read sources, so the self-test can feed fixtures.
 *
 * @param routeFiles  { basename: source } for every routes/*.ts except index.ts
 * @param indexSource routes/index.ts source (decides which files are mounted)
 * @param bruFiles    { path: source } for every request .bru in the collection
 * @param gaRoutes    [{ method, path }] — the GA_ALLOWED_ROUTES entries
 * @param exceptions  the declared-exceptions list
 * @returns { fatal: string[], summary: { routesTotal, covered, excepted, requests } }
 */
/**
 * Pure: the distinct `METHOD /normalized/path` pairs the mounted routers register.
 *
 * EXPORTED because `check-derived-doc-figures.mjs` fences the "78 distinct method+path
 * pairs" figure the collection README states, and a second parser for "a registered
 * route" would be a second place for that definition to drift. One parser, one
 * definition, two consumers — the same reason `collectionRequestFiles` is exported.
 *
 * Only MOUNTED routers count: a route file removed from routes/index.ts but left on
 * disk must not keep its registrations alive here — a v1 false-pass path. Not
 * established by this: a router mounted conditionally at runtime; the api test suite
 * exercises the configured app for that.
 *
 * Registrations are matched across LINE BREAKS. v1 matched single lines only, so the
 * multi-line registration of POST /v1/policies/:id/versions/:versionId/activate
 * (routes/v1.ts) was invisible — a request for a real route would have been flagged as
 * matching nothing, and the reverse direction would have demanded coverage this checker
 * could never see satisfied.
 */
export function parseRoutePairs({ routeFiles, indexSource }) {
  const mounted = new Set(
    [...indexSource.matchAll(/from\s+"\.\/([A-Za-z0-9-]+)"/g)].map((m) => `${m[1]}.ts`),
  );
  const routePairs = new Set();
  for (const [base, src] of Object.entries(routeFiles)) {
    if (!mounted.has(base)) continue;
    for (const m of stripComments(src).matchAll(
      /router\.(get|post|put|delete|patch)\(\s*"([^"]+)"/g,
    )) {
      routePairs.add(`${m[1].toUpperCase()} ${norm(m[2])}`);
    }
  }
  return routePairs;
}

/** Read the mounted route files under `root` and count the distinct method+path pairs. */
export function registeredRoutePairCount(root = ".") {
  return parseRoutePairs(loadRoutes(root)).size;
}

export function auditApiCollection({ routeFiles, indexSource, bruFiles, gaRoutes, exceptions }) {
  const fatal = [];

  const routePairs = parseRoutePairs({ routeFiles, indexSource });
  if (routePairs.size === 0) {
    fatal.push("zero routes parsed from mounted route files — the parser, not the API, is broken");
  }

  const requestPairs = new Set();
  let requests = 0;
  for (const [file, src] of Object.entries(bruFiles)) {
    const m = src.match(/(get|post|put|delete|patch)\s*\{[^}]*url:\s*\{\{baseUrl\}\}(\S+)/);
    if (!m) {
      // A request file this parser cannot read is a request this gate cannot
      // guard — silently excluding it would let coverage shrink under a green.
      fatal.push(`${file} → UNPARSEABLE (no method/url block this checker recognizes)`);
      continue;
    }
    requests += 1;
    const pair = `${m[1].toUpperCase()} ${norm(m[2])}`;
    requestPairs.add(pair);
    if (!routePairs.has(pair)) {
      fatal.push(`${file} → ${m[1].toUpperCase()} ${m[2]} matches no registered route`);
    }
  }
  if (requests === 0) {
    fatal.push("zero requests parsed — the parser, not the API, is broken");
  }

  // The GA list is parsed, not trusted to exist: zero entries means THIS
  // parser broke against profile.ts, and a broken parser must not silently
  // grant every exception the never-except-GA rule exists to refuse.
  if (gaRoutes.length === 0) {
    fatal.push(`zero GA routes parsed from ${PROFILE_TS} — the GA parser, not the allowlist, is broken`);
  }
  const gaPairs = new Set(gaRoutes.map((r) => `${r.method.toUpperCase()} ${norm(r.path)}`));

  // Exceptions: validated before they may excuse anything. A stale exception
  // — its route no longer registered, or now covered by a real request — is
  // FATAL, so the list can only shrink; an entry missing its reason or date
  // never counts; and a GA route may never be excepted at all.
  const exceptedPairs = new Set();
  for (const e of exceptions) {
    const label = `${e?.method ?? "?"} ${e?.path ?? "?"}`;
    if (!e?.method || !e?.path || !e?.reason || !e?.date) {
      fatal.push(`exception ${label} is missing method/path/reason/date — an unexplained exception explains nothing`);
      continue;
    }
    const pair = `${e.method.toUpperCase()} ${norm(e.path)}`;
    if (gaPairs.has(pair)) {
      fatal.push(`exception ${label} names a GA route — the launch surface may never be excepted`);
      continue;
    }
    if (!routePairs.has(pair)) {
      fatal.push(`exception ${label} names no registered route — a stale exception is a hole waiting for a route to fall into it`);
      continue;
    }
    if (requestPairs.has(pair)) {
      fatal.push(`exception ${label} is covered by a real request — remove the exception, it now hides future coverage loss`);
      continue;
    }
    exceptedPairs.add(pair);
  }

  // The reverse direction: every registered route carries a request or a
  // (validated) exception.
  const uncovered = [...routePairs].filter((p) => !requestPairs.has(p) && !exceptedPairs.has(p)).sort();
  for (const p of uncovered) {
    fatal.push(`registered route ${p} has no .bru request and no declared exception`);
  }

  return {
    fatal,
    summary: {
      routesTotal: routePairs.size,
      covered: [...routePairs].filter((p) => requestPairs.has(p)).length,
      excepted: exceptedPairs.size,
      requests,
    },
  };
}

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// The lab-service collections (Fleet, Traccar, Keycloak, Wazuh) live at
// artifacts/lab-collections/ — OUTSIDE this collection — because their URLs
// are third-party API paths, not api-server routes, and because Bruno
// itself cannot run a collection that nests other collections (their
// environments/ parse as requests from the parent). One collection, one
// target server; the reverse direction below still demands a visible
// request here for every api-server route.
//
// EXPORTED because `check-derived-doc-figures.mjs` fences the request COUNT that
// docs/INDEX.md and the collection README both state, and a second copy of this walk
// would be a second place for the definition of "a request file" to drift. One walk,
// one definition, two consumers.
export function collectionRequestFiles(root = ".") {
  return walk(join(root, COLLECTION)).filter(
    (f) => f.endsWith(".bru") && !f.includes("environments") && !f.endsWith("collection.bru"),
  );
}

/** { routeFiles, indexSource } read from a repo root — shared by the gate and the count. */
export function loadRoutes(root = ".") {
  const dir = join(root, ROUTES_DIR);
  const routeFiles = {};
  for (const f of walk(dir).filter((f) => f.endsWith(".ts") && !f.endsWith("index.ts"))) {
    routeFiles[f.split("/").pop()] = readFileSync(f, "utf8");
  }
  return { routeFiles, indexSource: readFileSync(join(dir, "index.ts"), "utf8") };
}

function load() {
  const { routeFiles, indexSource } = loadRoutes(".");
  const bruFiles = {};
  for (const f of collectionRequestFiles()) {
    bruFiles[f] = readFileSync(f, "utf8");
  }
  const gaRoutes = parseGaRoutes(readFileSync(PROFILE_TS, "utf8"));
  return { routeFiles, indexSource, bruFiles, gaRoutes, exceptions: DECLARED_EXCEPTIONS };
}

export function parseGaRoutes(profileSource) {
  const block = profileSource.match(/GA_ALLOWED_ROUTES[^=]*=\s*\[([\s\S]*?)\];/);
  if (!block) return [];
  return [...block[1].matchAll(/\{\s*method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)"\s*\}/g)].map(
    (m) => ({ method: m[1], path: m[2] }),
  );
}

function selfTest() {
  const checks = [];
  const bru = (method, path) => `meta {\n  name: t\n}\n\n${method} {\n  url: {{baseUrl}}${path}\n  body: none\n  auth: inherit\n}\n`;
  const good = {
    routeFiles: {
      "v1.ts": [
        'router.get("/v1/things", handler);',
        // Multi-line registration — the shape v1 of this checker could not see.
        'router.post(\n  "/v1/things/:id/activate",\n  handler,\n);',
        // Commented out — must not count as registered.
        '// router.get("/v1/ghost", handler);',
      ].join("\n"),
      // On disk but NOT imported by index.ts — must not count as registered.
      "orphan.ts": 'router.get("/orphaned", handler);',
    },
    indexSource: 'import v1Router from "./v1";',
    bruFiles: {
      "a/things.bru": bru("get", "/v1/things"),
      "a/activate.bru": bru("post", "/v1/things/{{id}}/activate"),
    },
    gaRoutes: [{ method: "GET", path: "/v1/things" }],
    exceptions: [],
  };

  let r = auditApiCollection(good);
  checks.push(["a two-directionally covered collection passes clean", r.fatal.length === 0 && r.summary.covered === 2]);
  checks.push(["a multi-line registration is matched, not invisible", r.fatal.every((x) => !x.includes("activate"))]);

  r = auditApiCollection({ ...good, bruFiles: { ...good.bruFiles, "a/gone.bru": bru("get", "/v1/gone") } });
  checks.push(["a request naming no registered route is FATAL (forward)", r.fatal.some((x) => x.includes("a/gone.bru"))]);

  r = auditApiCollection({ ...good, bruFiles: { "a/things.bru": good.bruFiles["a/things.bru"] } });
  checks.push(["a registered route with no request is FATAL (reverse)", r.fatal.some((x) => x.includes("POST /v1/things/*/activate") && x.includes("no .bru request"))]);

  r = auditApiCollection({
    ...good,
    bruFiles: { "a/things.bru": good.bruFiles["a/things.bru"] },
    exceptions: [{ method: "POST", path: "/v1/things/:id/activate", reason: "fixture", date: "2026-08-21" }],
  });
  checks.push(["a declared non-GA exception excuses the reverse miss", r.fatal.length === 0 && r.summary.excepted === 1]);

  r = auditApiCollection({ ...good, exceptions: [{ method: "GET", path: "/v1/never-existed", reason: "fixture", date: "2026-08-21" }] });
  checks.push(["a stale exception (route not registered) is FATAL", r.fatal.some((x) => x.includes("never-existed") && x.includes("stale"))]);

  r = auditApiCollection({
    ...good,
    bruFiles: { "a/activate.bru": good.bruFiles["a/activate.bru"] },
    exceptions: [{ method: "GET", path: "/v1/things", reason: "fixture", date: "2026-08-21" }],
  });
  checks.push(["a GA route may NEVER be excepted — FATAL even when uncovered", r.fatal.some((x) => x.includes("GA route"))]);

  r = auditApiCollection({ ...good, exceptions: [{ method: "GET", path: "/v1/things", reason: "fixture" }] });
  checks.push(["an exception missing its date is FATAL", r.fatal.some((x) => x.includes("missing method/path/reason/date"))]);

  r = auditApiCollection({
    ...good,
    exceptions: [{ method: "POST", path: "/v1/things/:id/activate", reason: "fixture", date: "2026-08-21" }],
  });
  checks.push(["an exception for a route that HAS a request is FATAL", r.fatal.some((x) => x.includes("covered by a real request"))]);

  r = auditApiCollection({ ...good, bruFiles: { ...good.bruFiles, "a/ghost.bru": bru("get", "/v1/ghost") } });
  checks.push(["a commented-out registration does not count as registered", r.fatal.some((x) => x.includes("a/ghost.bru"))]);

  r = auditApiCollection({ ...good, bruFiles: { ...good.bruFiles, "a/orphan.bru": bru("get", "/orphaned") } });
  checks.push(["an unmounted route file's registrations do not count", r.fatal.some((x) => x.includes("a/orphan.bru"))]);

  r = auditApiCollection({ ...good, bruFiles: { ...good.bruFiles, "a/broken.bru": "meta { name: x }" } });
  checks.push(["an unparseable request file is FATAL, never skipped", r.fatal.some((x) => x.includes("UNPARSEABLE"))]);

  r = auditApiCollection({ ...good, bruFiles: {} });
  checks.push(["zero parsed requests is FATAL — the parser, not the API, is broken", r.fatal.some((x) => x.includes("zero requests parsed"))]);

  r = auditApiCollection({ ...good, gaRoutes: [] });
  checks.push(["zero parsed GA routes is FATAL — a broken GA parser must not un-fence exceptions", r.fatal.some((x) => x.includes("zero GA routes parsed"))]);

  const parsed = parseGaRoutes('const GA_ALLOWED_ROUTES: readonly x[] = [\n  { method: "GET", path: "/healthz" },\n  // comment\n  { method: "POST", path: "/v1/decisions/evaluate" },\n];');
  checks.push(["the GA parser reads method+path entries out of profile.ts source", parsed.length === 2 && parsed[1].path === "/v1/decisions/evaluate"]);

  // The method+path pair COUNT is now a published figure (the collection README states
  // it, and check-derived-doc-figures.mjs fences it against this parser). It is the same
  // Set the reverse-direction check walks, so it can never disagree with the gate — but
  // it must still refuse to report a vacuous zero.
  const pairs = parseRoutePairs(good);
  checks.push([
    "the exported route-pair parser is the SAME set the gate uses — no second definition of 'a registered route'",
    pairs.size === 2 && pairs.has("GET /v1/things") && pairs.has("POST /v1/things/*/activate"),
  ]);
  checks.push([
    "…and it inherits the gate's exclusions: commented-out and unmounted registrations are not pairs",
    !pairs.has("GET /v1/ghost") && !pairs.has("GET /orphaned"),
  ]);
  const liveRoot = join(import.meta.dirname ?? ".", "..");
  checks.push([
    "the live route-pair count is non-zero against the real tree — a 0 would be a broken parser reported as a figure",
    registeredRoutePairCount(liveRoot) > 0,
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Exact-entry guard, not a basename suffix match: an unrelated entry script
// that merely IMPORTS this module must never trigger the gate (an adversarial
// review proved the suffix form fires for an entry named like this file).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const { fatal, summary } = auditApiCollection(load());
  if (fatal.length > 0) {
    console.error(`API-collection check FAILED: ${fatal.length} problem(s):`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log(
    `API-collection check passed — ${summary.requests} requests; ` +
      `${summary.covered}/${summary.routesTotal} registered routes covered, ` +
      `${summary.excepted} excepted, both directions verified.`,
  );
}
