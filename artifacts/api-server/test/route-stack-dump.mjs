/**
 * Route-stack dumper — spawned by `test/api.test.mjs`, never run on its own.
 *
 * Boots the REAL built server (`dist/index.mjs`, the same entry every other
 * server in that suite spawns) and walks the Express router stack it actually
 * mounted, printing one JSON line of `{ method, path }` for every method-bearing
 * layer, with its mount prefix applied.
 *
 * WHY A SEPARATE PROCESS. The app object only exists inside a booted server, and
 * `index.mjs` listens on import. Importing it into the test process would leave a
 * listening socket open and the suite (which sets `process.exitCode` rather than
 * calling `process.exit`) would never exit. So the boot happens here, the stack is
 * serialised, and this process exits.
 *
 * FAIL-CLOSED. Anything this cannot resolve — a missing stack, a mount prefix that
 * no candidate matches (e.g. a RegExp mount) — is reported in `unresolved` and the
 * caller fails the assertion. Unknown is never "nothing to see".
 */
import { pathToFileURL } from "node:url";

const entry = process.argv[2];
if (!entry) {
  process.stdout.write(JSON.stringify({ error: "no server entry argument" }));
  process.exit(0);
}

// Candidate mount prefixes, longest first. Supplied by the caller from the SAME
// BASE constant it sends every one of its HTTP requests to, so a mount that moved
// would have broken every request in the suite long before it reached here. A
// prefix outside this set is reported, never guessed.
const candidates = JSON.parse(process.env["ROUTE_DUMP_PREFIXES"] ?? '[""]')
  .slice()
  .sort((a, b) => b.length - a.length);

const unresolved = [];

const joinPath = (prefix, path) => {
  const joined = `${prefix}${path}`.replace(/\/{2,}/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
};

// A concrete URL under a pattern: `/v1/sessions/:id/refresh` → `/v1/sessions/x/refresh`.
// Express matches on concrete paths, so prefix discovery needs one.
const concrete = (pattern) =>
  pattern
    .split("/")
    .map((s) => (s.startsWith(":") ? "x" : s))
    .join("/");

// The mount prefix of a `use` layer. router@2 (Express 5) keeps no copy of the
// path string it was registered with — it keeps a MATCHER. So the prefix is
// obtained the way Express itself obtains it: match a concrete path through the
// layer and read back the portion the layer consumed (`layer.path`).
function resolvePrefix(layer, sample) {
  if (layer.slash) return ""; // registered pathless / at "/" — consumes nothing
  if (sample === undefined) return null;
  for (const candidate of candidates) {
    if (layer.match(`${candidate}${concrete(sample)}`)) return layer.path ?? "";
  }
  return null;
}

function collect(stack, describe) {
  const routes = [];
  for (const layer of stack) {
    if (layer.route) {
      // A method-bearing layer. `route.path` is the declared pattern, already in
      // `:param` form — the same shape the source-text scan produces.
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        for (const method of Object.keys(layer.route.methods ?? {})) {
          routes.push({ method: method.toUpperCase(), path: joinPath("", p) });
        }
      }
      continue;
    }
    const handle = layer.handle;
    if (handle && Array.isArray(handle.stack)) {
      // A mounted sub-router. Collect its routes RELATIVE first: the prefix of
      // this layer is discovered by matching, which needs a concrete inner path.
      const inner = collect(handle.stack, `${describe}>${layer.name}`);
      if (inner.length === 0) continue; // no routes below: contributes nothing
      const prefix = resolvePrefix(layer, inner[0].path);
      if (prefix === null) {
        // NAME WHAT GOT HIDDEN. A mount this cannot place hides every route
        // beneath it, and "app>router10>router10" tells an operator nothing about
        // which surface just went dark — so a sample of the hidden routes travels
        // with the report.
        const sample = inner.slice(0, 3).map((r) => `${r.method} ${r.path}`).join(", ");
        unresolved.push(
          `${describe}>${layer.name}: ${inner.length} route(s) hidden below an unmatched mount` +
          ` (e.g. ${sample}${inner.length > 3 ? ", …" : ""})`,
        );
        continue;
      }
      for (const r of inner) routes.push({ method: r.method, path: joinPath(prefix, r.path) });
      continue;
    }
    // Plain middleware: no route, no sub-stack. Not a mounted path.
  }
  return routes;
}

try {
  const mod = await import(pathToFileURL(entry).href);
  const app = mod.app;
  const stack = app?.router?.stack ?? app?._router?.stack;
  if (!Array.isArray(stack)) {
    process.stdout.write(JSON.stringify({ error: "no router stack on the booted app" }));
    process.exit(0);
  }
  const routes = collect(stack, "app");
  process.stdout.write(JSON.stringify({ routes, unresolved }));
} catch (err) {
  process.stdout.write(JSON.stringify({ error: String(err?.message ?? err) }));
}
process.exit(0);
