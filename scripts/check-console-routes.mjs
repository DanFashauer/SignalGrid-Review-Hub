// Console-route gate — every path the operator console (artifacts/signalgrid-app)
// fetches must be a route the api-server actually registers, matched on METHOD
// AND path. This exists because a generated client and a hand-written server drift
// silently: the console's PolicyCreate form POSTed to /api/policies (the generated
// getCreatePolicyUrl) while the server serves only GET there — the sole policies
// POST is /api/v1/policies/:id/versions — so the form 404'd only when a human hit
// submit. A gate reads the wire the console cannot, before a person does.
//
// TARGETS are derived two ways (never hand-listed):
//   A. `/api/…` string literals under artifacts/signalgrid-app/src/** — the method
//      is read from the nearest `method:` in the same call, defaulting to GET (a
//      bare fetch() and the control-plane get() helper are both GET).
//   B. every generated get<Op>Url() in lib/api-client-react/src/generated/api.ts
//      whose hook/helper the console imports — its path from the URL function, its
//      method from the customFetch that calls it.
//
// SERVED is derived from every router.<method>("<path>") across
// artifacts/api-server/src/routes/*.ts, with the mount prefix read from app.ts
// (app.use("<prefix>", router)). route-stack-dump would be more precise but it
// boots the built server; this lane is service-free, so the source text is parsed.
//
// FAIL-CLOSED: an empty served set, an underivable mount prefix, or a missing
// generated client is fatal — a gate that can find nothing must not pass green.
// SELF-TEST FIRST: the matcher must flag a planted unserved target and a
// method-mismatched target, or the gate refuses to conclude anything.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const CONSOLE_SRC = "artifacts/signalgrid-app/src";
const ROUTES_DIR = "artifacts/api-server/src/routes";
const APP_TS = "artifacts/api-server/src/app.ts";
const GENERATED_API = "lib/api-client-react/src/generated/api.ts";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

function walk(dir, exts) {
  const out = [];
  const rec = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) rec(p);
      else if (exts.some((x) => p.endsWith(x))) out.push(p);
    }
  };
  if (existsSync(dir)) rec(dir);
  return out;
}

// Normalize a route pattern (both a served `:id` and a console `${id}` become
// `:param`), strip the query string, and drop a trailing slash. Path params are
// scanned char-by-char so a template interpolation that is a QUERY (e.g.
// `/edge-nodes${tenant ? "?tenant=…" : ""}`) ends the path rather than becoming a
// bogus segment, while one after a slash (`/sync/${id}`) becomes `:param`.
function scanFrom(text, start) {
  let out = "";
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === "`" || c === '"' || c === "'") break; // end of the literal
    if (c === "?") break; // query string
    if (c === "$" && text[i + 1] === "{") {
      if (out.endsWith("/")) {
        out += ":param";
        i += 2;
        let depth = 1;
        while (i < text.length && depth > 0) {
          if (text[i] === "{") depth += 1;
          else if (text[i] === "}") depth -= 1;
          i += 1;
        }
        continue;
      }
      break; // interpolation not after a slash: the rest is dynamic/query
    }
    if (/[A-Za-z0-9/_:.@~-]/.test(c)) {
      out += c;
      i += 1;
      continue;
    }
    break;
  }
  out = out.replace(/:[A-Za-z0-9_]+/g, ":param").replace(/\/{2,}/g, "/");
  if (out.length > 1) out = out.replace(/\/$/, "");
  return out;
}

// ── served set ───────────────────────────────────────────────────────────────
function servedRoutes() {
  const appText = readFileSync(APP_TS, "utf8");
  const m = appText.match(/app\.use\(\s*["']([^"']+)["']\s*,\s*router\s*\)/);
  if (!m) fail(`could not derive the routes mount prefix from ${APP_TS} (app.use("<prefix>", router)); fix the derivation, do not guess.`);
  const prefix = m[1].replace(/\/$/, "");
  const keys = new Set();
  const allPaths = new Set();
  const files = existsSync(ROUTES_DIR) ? readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts")) : [];
  if (files.length === 0) fail(`no route files under ${ROUTES_DIR} — the derivation is broken, not the tree empty.`);
  for (const f of files) {
    const text = readFileSync(join(ROUTES_DIR, f), "utf8");
    for (const rm of text.matchAll(/router\.(get|post|put|patch|delete|all)\(\s*["']([^"']+)["']/g)) {
      const method = rm[1].toUpperCase();
      const path = scanFrom(`${prefix}${rm[2]}`, 0);
      if (method === "ALL") allPaths.add(path);
      else keys.add(`${method} ${path}`);
    }
  }
  if (keys.size === 0 && allPaths.size === 0) fail(`parsed zero routes from ${ROUTES_DIR} — the router.<method>() shape changed.`);
  return { keys, allPaths, prefix };
}

// ── console targets ──────────────────────────────────────────────────────────
function opFromSymbol(sym) {
  let m = sym.match(/^use([A-Z][A-Za-z0-9]*)$/);
  if (m) return m[1];
  m = sym.match(/^get([A-Z][A-Za-z0-9]*?)(Url|QueryKey|MutationOptions|QueryOptions|SuspenseQueryOptions|InfiniteQueryOptions)$/);
  if (m) return m[1];
  return null;
}

function consoleTargets() {
  const targets = [];
  const files = walk(CONSOLE_SRC, [".ts", ".tsx"]);

  // Source A — /api/ string literals, method from the nearest method: in-call.
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    let idx = 0;
    while ((idx = text.indexOf("/api", idx)) !== -1) {
      const prev = text[idx - 1];
      if (prev === "`" || prev === '"' || prev === "'") {
        const path = scanFrom(text, idx);
        if (path.startsWith("/api/") && path.length > "/api/".length) {
          const next = text.indexOf("/api", idx + 4);
          const winEnd = Math.min(idx + 300, next === -1 ? text.length : next);
          const mm = text.slice(idx, winEnd).match(/method:\s*['"]([A-Za-z]+)['"]/);
          targets.push({ method: mm ? mm[1].toUpperCase() : "GET", path, source: `${f} (literal)` });
        }
      }
      idx += 4;
    }
  }

  // Source B — generated get<Op>Url() whose hook/helper the console imports.
  if (!existsSync(GENERATED_API)) fail(`${GENERATED_API} missing — cannot resolve the generated client the console imports.`);
  const gen = readFileSync(GENERATED_API, "utf8");
  const urlDefs = new Map(); // Op → { path, method }
  for (const gm of gen.matchAll(/export const get([A-Za-z0-9]+)Url = \([^)]*\)\s*=>\s*\{[\s\S]*?return\s+`([^`]+)`/g)) {
    const op = gm[1];
    const path = scanFrom(gm[2], gm[2].indexOf("/api") === -1 ? 0 : gm[2].indexOf("/api"));
    const inv = gen.indexOf(`get${op}Url(`, gm.index);
    let method = "GET";
    if (inv !== -1) {
      const mm = gen.slice(inv, inv + 300).match(/method:\s*['"]([A-Za-z]+)['"]/);
      if (mm) method = mm[1].toUpperCase();
    }
    urlDefs.set(op, { path, method });
  }
  if (urlDefs.size === 0) fail(`parsed zero get<Op>Url definitions from ${GENERATED_API} — the generated shape changed.`);

  const importedOps = new Set();
  for (const f of files) {
    const text = readFileSync(f, "utf8");
    for (const im of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']@workspace\/api-client-react["']/g)) {
      for (let sym of im[1].split(",")) {
        sym = sym.trim().split(/\s+as\s+/)[0].trim();
        const op = sym && opFromSymbol(sym);
        if (op) importedOps.add(op);
      }
    }
  }
  for (const op of importedOps) {
    const def = urlDefs.get(op);
    // A symbol with no URL definition is a type or utility (setBaseUrl, a *Params
    // type) — not a fetch target, so it is skipped, never failed.
    if (def && def.path.startsWith("/api/")) {
      targets.push({ method: def.method, path: def.path, source: `generated get${op}Url (imported)` });
    }
  }
  return targets;
}

// ── the matcher (shared by the self-test) ────────────────────────────────────
function unservedTargets(targets, keys, allPaths) {
  const out = [];
  for (const t of targets) {
    if (keys.has(`${t.method} ${t.path}`) || allPaths.has(t.path)) continue;
    out.push(t);
  }
  return out;
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const keys = new Set(["GET /api/policies", "GET /api/v1/decisions/:param"]);
  const allPaths = new Set();
  const okServed = unservedTargets([{ method: "GET", path: "/api/policies", source: "st" }], keys, allPaths);
  const planted = unservedTargets([{ method: "GET", path: "/api/nonexistent", source: "st" }], keys, allPaths);
  const methodMismatch = unservedTargets([{ method: "POST", path: "/api/policies", source: "st" }], keys, allPaths);
  const paramOk = unservedTargets([{ method: "GET", path: "/api/v1/decisions/:param", source: "st" }], keys, allPaths);
  const st =
    okServed.length === 0 &&
    planted.length === 1 &&
    methodMismatch.length === 1 && // the exact PolicyCreate defect class: path served, method not
    paramOk.length === 0 &&
    scanFrom("/api/v1/decisions/${encodeURIComponent(id)}/evidence", 0) === "/api/v1/decisions/:param/evidence" &&
    scanFrom('/api/cp/v1/edge-nodes${tenant ? "?x" : ""}', 0) === "/api/cp/v1/edge-nodes" &&
    scanFrom("/api/cp/v1/policy-bundle?tenant=x", 0) === "/api/cp/v1/policy-bundle" &&
    opFromSymbol("useCreatePolicy") === "CreatePolicy" &&
    opFromSymbol("getListPoliciesQueryKey") === "ListPolicies" &&
    opFromSymbol("setBaseUrl") === null;
  if (!st) fail("SELF-TEST FAILED: the console-route matcher no longer flags its synthetic violation. A gate that cannot fail proves nothing.");
}

if (process.argv.includes("--self-test")) {
  console.log("check-console-routes self-test passed.");
  process.exit(0);
}

// ── run ──────────────────────────────────────────────────────────────────────
const { keys, allPaths } = servedRoutes();
const targets = consoleTargets();
if (targets.length === 0) fail("resolved zero console fetch targets — the console-scan derivation is broken, not the console empty.");

const unserved = unservedTargets(targets, keys, allPaths);
// De-duplicate for the report (many components fetch the same path).
const seen = new Set();
const uniqueUnserved = unserved.filter((t) => {
  const k = `${t.method} ${t.path}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

console.log(
  `check-console-routes: ${targets.length} console fetch target(s) checked against ` +
    `${keys.size} served route(s); self-test green`,
);
if (uniqueUnserved.length > 0) {
  for (const t of uniqueUnserved) {
    console.error(`  ✗ ${t.method} ${t.path} — no matching Express registration (${t.source})`);
  }
  console.error(
    `\nConsole-route gate FAILED — the console fetches ${uniqueUnserved.length} path(s) the api-server does not serve.\n` +
      "Retarget the console to a served route, or serve the route. Never a 404 discovered by a human.",
  );
  process.exit(1);
}
console.log("Console-route gate passed — every console fetch target maps to a served route (method + path).");
