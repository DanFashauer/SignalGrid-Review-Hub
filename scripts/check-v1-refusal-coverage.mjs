#!/usr/bin/env node
// Every refusal the `/v1` server actually returns must be in the `/v1` document.
//
// `proof:api-contract` holds `lib/api-spec/v1-openapi.yaml` to the served ROUTE SET.
// Nothing held it to the served REFUSALS, and a Schemathesis run (2,632 cases over 59
// operations, 0 server errors) found the document under-documenting them everywhere:
// 401 appeared on no protected operation although every one returns it to a missing or
// unknown bearer; 429 appeared nowhere at all although every `/v1` route is behind
// `v1RateLimiter`; 404 was missing from three read operations; and ten operations
// answered 400 to bodies the document allowed, because `parseEvaluate`,
// `parseReconcile` and the `requireString`/`requireObject` helpers validate more
// strictly than the schemas state.
//
// An undocumented refusal is the worst kind of contract gap: an integrator writes the
// happy path the document describes, ships it, and meets the refusal in production.
// The SERVER is the stricter party and is right to be; the DOCUMENT is what to tighten.
//
// WHAT IS DERIVED, from `artifacts/api-server/src/routes/{v1,control-plane}.ts`:
//   · every `res.status(NNN)` and `new CoreError(…, NNN)` inside a handler;
//   · the same, one level deep, through the module-scope helpers a handler calls —
//     which is where `parseEvaluate`'s and `requireString`'s 400s live;
//   · 401 and 429 for every route registered AFTER
//     `router.use("/v1", v1RateLimiter, requireTenantContext, …)`, and for none before
//     it. `/cp/v1` carries no middleware at all, so it gets neither.
//
// DIRECTIONS, and why they differ:
//   · FATAL — a refusal this file provably returns and the document does not list.
//   · FATAL — an authenticated route whose operation declares `security: []`, or the
//     unauthenticated `/v1/keys` that does not.
//   · REPORTED — a documented status the derivation cannot confirm. The decision core
//     throws its own `CoreError`s from inside `@workspace/signalgrid-core`, so this
//     file cannot see every refusal; a document that lists MORE than this gate can
//     prove is the safe direction, and calling it an error would push the document
//     towards saying less.
//
//   node scripts/check-v1-refusal-coverage.mjs
//   node scripts/check-v1-refusal-coverage.mjs --self-test
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = "lib/api-spec/v1-openapi.yaml";
const GUARD = 'router.use("/v1", v1RateLimiter';

/** Pure. The refusal/creation statuses a block of source can answer with. */
export function codesIn(body) {
  const out = new Set();
  for (const m of body.matchAll(/new CoreError\(/g)) {
    const seg = body.slice(m.index, m.index + 400);
    const c = /,\s*(\d{3})\s*,?\s*\)/.exec(seg);
    if (c) out.add(c[1]);
  }
  for (const m of body.matchAll(/res\s*\.?\s*\n?\s*\.status\(\s*(\d{3})\s*\)/g)) out.add(m[1]);
  return out;
}

/** Pure. Module-scope helper name → the statuses it can throw. One level, which is
 *  where the shared validators live; a helper calling a helper is not followed, and
 *  that under-reports rather than over-reports — the safe direction for a floor. */
export function helperCodes(source) {
  const TOP = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class|router|if|\/\*\*)/gm;
  const out = new Map();
  for (const m of source.matchAll(/^(?:export\s+)?function (\w+)\(/gm)) {
    TOP.lastIndex = m.index + 1;
    const next = TOP.exec(source);
    const codes = codesIn(source.slice(m.index, next ? next.index : source.length));
    if (codes.size) out.set(m[1], [...codes]);
  }
  return out;
}

/** Pure. The source span of one call, from its opening paren to the matching close.
 *  Slicing "to the next route registration" was wrong and wrong in the dangerous
 *  direction: a helper defined BETWEEN two handlers was read as part of the first one,
 *  so a 400 that helper throws was attributed to a route that cannot return it. String
 *  and template literals are skipped so a paren inside a message does not unbalance it. */
export function callSpan(source, start) {
  let i = source.indexOf("(", start);
  if (i === -1) return source.slice(start);
  let depth = 0;
  for (let j = i; j < source.length; j += 1) {
    const c = source[j];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      j += 1;
      while (j < source.length && source[j] !== quote) j += source[j] === "\\" ? 2 : 1;
      continue;
    }
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  return source.slice(start);
}

/** Pure. [{ key: "POST /v1/x", codes: Set, guarded }] for one route file. */
export function derivedFor(source) {
  const helpers = helperCodes(source);
  const guard = source.indexOf(GUARD);
  const marks = [...source.matchAll(/router\.(get|post|put|delete|patch)\(\s*\n?\s*"([^"]+)"/g)];
  return marks.map((m) => {
    const body = callSpan(source, m.index);
    const codes = codesIn(body);
    for (const [name, cs] of helpers) if (new RegExp(String.raw`\b${name}\(`).test(body)) for (const c of cs) codes.add(c);
    const guarded = guard >= 0 && m.index > guard;
    if (guarded) { codes.add("401"); codes.add("429"); }
    return { key: `${m[1].toUpperCase()} ${m[2].replace(/:(\w+)/g, "{$1}")}`, codes, guarded };
  });
}

/** Pure. "METHOD /path" → { codes: Set, securityNone: boolean } from the document. */
export function documented(spec) {
  const out = new Map();
  const lines = spec.split("\n");
  let path = null, method = null, key = null;
  for (const line of lines) {
    const p = /^  (\/\S+):\s*$/.exec(line);
    if (p) { path = p[1]; method = null; continue; }
    const m = /^    (get|post|put|delete|patch):\s*$/.exec(line);
    if (m && path) {
      method = m[1].toUpperCase();
      key = `${method} ${path}`;
      out.set(key, { codes: new Set(), securityNone: false });
      continue;
    }
    if (!key) continue;
    if (/^  \S/.test(line)) { path = null; method = null; key = null; continue; }
    const c = /^\s{8}"(\d{3})":/.exec(line);
    if (c) out.get(key).codes.add(c[1]);
    if (/^\s{6}security:\s*\[\s*\]\s*$/.test(line)) out.get(key).securityNone = true;
  }
  return out;
}

/** Pure core. Returns { fatal, reported, checked }. */
export function auditAll(spec, sources) {
  const docs = documented(spec);
  const fatal = [];
  const reported = [];
  let checked = 0;
  let withAuth = 0;
  let withLimit = 0;
  for (const src of sources) {
    for (const route of derivedFor(src)) {
      const doc = docs.get(route.key);
      if (!doc) continue; // the route set is proof:api-contract's job
      checked += 1;
      if (route.codes.has("401")) withAuth += 1;
      if (route.codes.has("429")) withLimit += 1;
      for (const code of [...route.codes].sort()) {
        if (code === "201") continue; // a success, not a refusal
        if (!doc.codes.has(code)) fatal.push(`${route.key} returns ${code} and ${SPEC} does not document it`);
      }
      if (route.guarded && doc.securityNone) {
        fatal.push(`${route.key} sits behind requireTenantContext and ${SPEC} declares \`security: []\` — the document says anonymous callers are served`);
      }
      if (!route.guarded && !doc.securityNone) {
        fatal.push(`${route.key} is registered BEFORE the auth guard and ${SPEC} does not declare \`security: []\` — the document says it is protected and it is not`);
      }
      for (const code of [...doc.codes].sort()) {
        if (!/^4|^5/.test(code)) continue;
        if (!route.codes.has(code)) reported.push(`${route.key} documents ${code}, which this file does not show (the decision core throws its own refusals)`);
      }
    }
  }
  if (checked < 30) fatal.push(`FLOOR: only ${checked} operation(s) matched between source and document — the derivation is broken, not the tree`);
  if (withAuth < 20) fatal.push(`FLOOR: only ${withAuth} route(s) derived a 401 — the auth-guard marker moved, so this gate has stopped seeing the guard`);
  if (withLimit < 20) fatal.push(`FLOOR: only ${withLimit} route(s) derived a 429 — the rate-limiter marker moved`);
  return { fatal, reported, checked };
}

function selfTest() {
  const src = [
    'router.get("/v1/keys", (req, res) => { res.json({}); });',
    'router.use("/v1", v1RateLimiter, requireTenantContext, idempotencyReplay);',
    'function requireString(req, key) {',
    '  throw new CoreError("validation", `${key} is required.`, 400);',
    '}',
    'router.post("/v1/thing", (req, res) => {',
    '  requireString(req, "x");',
    '  if (!t) throw new CoreError("not_found", "nope", 404);',
    '});',
    "",
  ].join("\n");
  const spec = [
    "paths:",
    "  /v1/keys:",
    "    get:",
    "      security: []",
    "      responses:",
    '        "200": { description: ok }',
    "  /v1/thing:",
    "    post:",
    "      responses:",
    '        "200": { description: ok }',
    '        "400": { $ref: "#/components/responses/ValidationError" }',
    '        "401": { $ref: "#/components/responses/Unauthorized" }',
    '        "404": { $ref: "#/components/responses/NotFound" }',
    '        "429": { $ref: "#/components/responses/TooManyRequests" }',
    "",
  ].join("\n");
  const noFloor = (r) => r.fatal.filter((f) => !f.startsWith("FLOOR"));
  const checks = [
    ["a fully documented pair is clean", noFloor(auditAll(spec, [src])).length === 0],
    ["a missing 429 FAILS — the status that appeared nowhere", noFloor(auditAll(spec.replace(/.*TooManyRequests.*\n/, ""), [src])).length === 1],
    ["a missing 401 FAILS on a protected operation", noFloor(auditAll(spec.replace(/.*Unauthorized.*\n/, ""), [src])).length === 1],
    ["a 400 thrown only inside a shared helper is still derived", noFloor(auditAll(spec.replace(/.*ValidationError.*\n/, ""), [src])).length === 1],
    ["a 404 thrown in the handler is derived", noFloor(auditAll(spec.replace(/.*NotFound.*\n/, ""), [src])).length === 1],
    ["`security: []` on a route BEHIND the guard FAILS", noFloor(auditAll(spec.replace('    post:\n      responses:', '    post:\n      security: []\n      responses:'), [src])).length === 1],
    ["a route BEFORE the guard that does not declare `security: []` FAILS", noFloor(auditAll(spec.replace("      security: []\n", ""), [src])).length === 1],
    ["a documented status the source cannot show is REPORTED, never fatal",
      (() => { const r = auditAll(spec.replace('        "200": { description: ok }\n        "400"', '        "200": { description: ok }\n        "403": { $ref: "#/components/responses/Forbidden" }\n        "400"'), [src]); return noFloor(r).length === 0 && r.reported.length === 1; })()],
    ["201 is a success and is not demanded of the document",
      noFloor(auditAll(spec, [src.replace('  requireString(req, "x");', '  res.status(201).json({});\n  requireString(req, "x");')])).length === 0],
    ["the FLOORS fire when the guard marker moves", auditAll(spec, [src.replace(GUARD, 'router.use("/v2", v1RateLimiter')]).fatal.some((f) => f.startsWith("FLOOR"))],
    ["the document parser reads codes and `security: []` per operation",
      (() => { const d = documented(spec); return d.get("GET /v1/keys").securityNone === true && d.get("POST /v1/thing").securityNone === false && d.get("POST /v1/thing").codes.has("429"); })()],
  ];
  let bad = 0;
  for (const [name, cond] of checks) {
    console.log(`  ${cond ? "ok" : "FAIL"} — ${name}`);
    if (!cond) bad += 1;
  }
  console.log(`\nself-test: ${checks.length - bad}/${checks.length}`);
  process.exit(bad === 0 ? 0 : 1);
}

const IS_MAIN = process.argv[1] !== undefined && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;

function main() {
  if (process.argv.includes("--self-test")) selfTest();

  const spec = readFileSync(join(ROOT, SPEC), "utf8");
  const sources = ["artifacts/api-server/src/routes/v1.ts", "artifacts/api-server/src/routes/control-plane.ts"].map((p) =>
    readFileSync(join(ROOT, p), "utf8"),
  );
  const { fatal, reported, checked } = auditAll(spec, sources);

  console.log(`/v1 refusal coverage — ${checked} operation(s) matched between the served source and ${SPEC}\n`);
  if (reported.length > 0) {
    console.log(`REPORTED (never fatal) — ${reported.length} documented status(es) this derivation cannot confirm:`);
    for (const r of reported) console.log(`  · ${r}`);
  }
  if (fatal.length > 0) {
    console.error(`\n/v1 refusal coverage FAILED — ${fatal.length} finding(s):\n`);
    for (const f of fatal) console.error(`  ✗ ${f}`);
    console.error(`\nAdd the response to the operation in ${SPEC}. The server is the stricter party and is\nright to be; an integrator who meets an undocumented refusal meets it in production.`);
    process.exit(1);
  }
  console.log(`\n/v1 refusal coverage holds — every refusal the served source returns is documented.`);
}

if (IS_MAIN) main();
