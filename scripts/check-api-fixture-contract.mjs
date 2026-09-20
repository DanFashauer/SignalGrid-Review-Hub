#!/usr/bin/env node
// The `/api` monitoring document, held to the fixtures it actually serves.
//
// `lib/api-spec/openapi.yaml` is the legacy `/api` document and the input orval
// generates TWO shipping packages from. `proof:api-contract` already holds it to the
// served ROUTE SET in both directions — that half is covered, and this gate does not
// repeat it. What nothing read was the SHAPE: Schemathesis (613 cases over 15
// operations) found `GET /api/integrations` answering `lastSync: null` against a
// `string, date-time`, `GET /api/metrics/dashboard` answering `avgLatencyMs: 11.4`
// against an `integer`, both `limit` defaults documented as the opposite of what the
// handler uses (50/20 documented, 20/50 served), and three query parameters documented
// with enums and defaults that no handler ever reads.
//
// Each of those is the same defect: the document is a promise the fixtures do not keep,
// and no gate could tell. So four properties of the SERVED SOURCE are derived here and
// compared to the document. Nothing is booted and no port is bound; this reads text.
//
//   R1 NULLABLE  — a fixture property assigned `null` must be documented as accepting
//                  null. `lastSync: null` against `type: string` is a client crash
//                  waiting for a generated parser that believes the document.
//   R2 NUMERIC   — a fixture property assigned a DECIMAL must not be documented
//                  `type: integer`.
//   R3 LIMITS    — the `limit` query parameter's documented `default` and `maximum`
//                  must equal the handler's own `clampLimit(req.query.limit, N)` and
//                  its ceiling. A default a client is told and a default it gets are
//                  two different numbers, and the document had them crossed.
//   R4 UNREAD    — an operation whose handler ignores its request object (`_req`) must
//                  document no query parameters. A documented `window` the handler
//                  never reads is a control that does not exist.
//
// WHAT THIS IS NOT. It is a rule set over the served source, not a full JSON-Schema
// response validator. A validator would need the server running or a TypeScript
// toolchain, and the preflight lane assumes neither; scoping that honestly is better
// than a gate that cannot run on half the machines that must run it. Each rule declares
// a FLOOR — a rule that finds no subject at all fails, so a refactor that moves the
// fixtures cannot turn this green by making it blind.
//
//   node scripts/check-api-fixture-contract.mjs
//   node scripts/check-api-fixture-contract.mjs --self-test
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SPEC = "lib/api-spec/openapi.yaml";
/** The five route files `proof:api-contract` registers under this document. */
const ROUTE_FILES = ["health", "integrations", "monitoring", "radar", "simulator"].map(
  (f) => `artifacts/api-server/src/routes/${f}.ts`,
);

// ── derivations from the served source ───────────────────────────────────────

/** Pure. Property names a fixture assigns literal `null`. */
export function nullProps(source) {
  return [...new Set([...source.matchAll(/^\s*([A-Za-z_]\w*):\s*null\s*,?\s*$/gm)].map((m) => m[1]))];
}

/** Pure. Property name → the DECIMAL literal a fixture assigns it. */
export function decimalProps(source) {
  const out = new Map();
  for (const m of source.matchAll(/^\s*([A-Za-z_]\w*):\s*(-?\d+\.\d+)\s*,?\s*$/gm)) out.set(m[1], m[2]);
  return out;
}

/**
 * Pure. One entry per registered handler: { method, path, ignoresRequest, limitDefault,
 * limitMax }. The handler body is taken up to the next `router.` registration, which is
 * how these files are written and is checked by the floors below.
 */
export function handlersIn(source) {
  const re = /router\.(get|post|put|delete|patch)\(\s*"([^"]+)",\s*(?:async\s*)?\(\s*(_?\w+)/g;
  const marks = [...source.matchAll(re)];
  return marks.map((m, i) => {
    const body = source.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : source.length);
    const def = /clampLimit\(\s*req\.query\.limit\s*,\s*(\d+)\s*\)/.exec(body);
    const max = /Math\.min\(\s*n\s*,\s*(\d+)\s*\)/.exec(source); // the shared clamp helper's ceiling
    return {
      method: m[1].toUpperCase(),
      path: m[2].replace(/:(\w+)/g, "{$1}"),
      ignoresRequest: m[3].startsWith("_"),
      limitDefault: def ? def[1] : null,
      limitMax: def && max ? max[1] : null,
    };
  });
}

// ── reading the document ─────────────────────────────────────────────────────

/** Pure. The indented block that follows the first line matching `header`, plus the
 *  header line itself. Returns "" when the header is absent. */
export function blockAfter(text, header) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => header.test(l));
  if (i === -1) return "";
  const indent = /^\s*/.exec(lines[i])[0].length;
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length; j += 1) {
    if (lines[j].trim() === "" || /^\s*#/.test(lines[j])) { out.push(lines[j]); continue; }
    if (/^\s*/.exec(lines[j])[0].length <= indent) break;
    out.push(lines[j]);
  }
  return out.join("\n");
}

/** Pure. Every declaration of schema property `prop` in the document's components —
 *  there may be more than one component declaring the same name. */
export function propertyBlocks(spec, prop) {
  const out = [];
  const re = new RegExp(String.raw`^\s{8}${prop}:\s*$`, "gm");
  for (const m of spec.matchAll(re)) out.push(blockAfter(spec.slice(m.index), new RegExp(String.raw`^\s{8}${prop}:\s*$`)));
  return out;
}

/** Pure. The operation block for an `operationId`, back to its `paths:` entry level. */
export function operationBlock(spec, operationId) {
  const i = spec.indexOf(`operationId: ${operationId}`);
  if (i === -1) return "";
  const start = spec.lastIndexOf("\n", spec.lastIndexOf("\n", i - 1) - 1);
  return blockAfter(spec.slice(start + 1), /^\s{4}(?:get|post|put|delete|patch):\s*$/);
}

/** Pure. operationId for a served method+path, read out of the document. */
export function operationIdOf(spec, method, path) {
  const block = blockAfter(spec.slice(Math.max(0, spec.indexOf(`\n  ${path}:`))), new RegExp(String.raw`^\s{2}${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\s*$`));
  const m = new RegExp(String.raw`^\s{4}${method.toLowerCase()}:\s*$[\s\S]*?operationId:\s*(\w+)`, "m").exec(block);
  return m ? m[1] : null;
}

// ── the audit ────────────────────────────────────────────────────────────────

/** Pure core. `spec` is the document text, `routes` is [{ path, text }]. */
export function auditAll(spec, routes) {
  const fatal = [];
  const checked = { nullable: 0, numeric: 0, limits: 0, unread: 0 };

  for (const { path, text } of routes) {
    for (const prop of nullProps(text)) {
      for (const block of propertyBlocks(spec, prop)) {
        checked.nullable += 1;
        if (!/type:\s*\[[^\]]*"null"[^\]]*\]/.test(block) && !/nullable:\s*true/.test(block)) {
          fatal.push(`R1 ${prop}: ${path} serves it as \`null\`, and ${SPEC} documents it as \`${(/type:\s*(.+)/.exec(block) ?? [, "?"])[1].trim()}\` with no null`);
        }
      }
    }
    for (const [prop, value] of decimalProps(text)) {
      for (const block of propertyBlocks(spec, prop)) {
        checked.numeric += 1;
        if (/type:\s*integer\b/.test(block)) fatal.push(`R2 ${prop}: ${path} serves the decimal ${value}, and ${SPEC} documents \`type: integer\``);
      }
    }
    for (const h of handlersIn(text)) {
      const opId = operationIdOf(spec, h.method, h.path);
      if (!opId) continue; // the route set is proof:api-contract's job, not this gate's
      const block = operationBlock(spec, opId);
      if (h.limitDefault !== null) {
        checked.limits += 1;
        const limitBlock = blockAfter(block.slice(Math.max(0, block.indexOf("name: limit"))), /name: limit/);
        const docDefault = (/default:\s*(\d+)/.exec(limitBlock) ?? [])[1] ?? null;
        const docMax = (/maximum:\s*(\d+)/.exec(limitBlock) ?? [])[1] ?? null;
        if (docDefault !== h.limitDefault) fatal.push(`R3 ${opId}: the handler defaults \`limit\` to ${h.limitDefault}, and ${SPEC} documents ${docDefault ?? "no default"}`);
        if (docMax !== h.limitMax) fatal.push(`R3 ${opId}: the handler caps \`limit\` at ${h.limitMax}, and ${SPEC} documents ${docMax ?? "no maximum"}`);
      }
      if (h.ignoresRequest) {
        checked.unread += 1;
        const params = [...block.matchAll(/^\s*-\s*in:\s*query\s*$/gm)].length;
        if (params > 0) fatal.push(`R4 ${opId}: the handler ignores its request (\`_req\`), and ${SPEC} documents ${params} query parameter(s) it therefore cannot read`);
      }
    }
  }

  // FLOORS. A rule that finds nothing to check has stopped working; it has not passed.
  const floors = { nullable: 1, numeric: 1, limits: 2, unread: 4 };
  for (const [rule, floor] of Object.entries(floors)) {
    if (checked[rule] < floor) fatal.push(`FLOOR ${rule}: ${checked[rule]} subject(s) found, expected at least ${floor} — the derivation is broken, not the tree`);
  }
  return { fatal, checked };
}

function selfTest() {
  const spec = [
    "paths:",
    "  /decisions:",
    "    get:",
    "      operationId: listDecisions",
    "      parameters:",
    "        - in: query",
    "          name: limit",
    "          schema:",
    "            type: integer",
    "            default: 20",
    "            minimum: 1",
    "            maximum: 200",
    "  /metrics/dashboard:",
    "    get:",
    "      operationId: getDashboardMetrics",
    "components:",
    "  schemas:",
    "    IntegrationHealth:",
    "      type: object",
    "      properties:",
    "        lastSync:",
    '          type: [string, "null"]',
    "          format: date-time",
    "    DashboardMetrics:",
    "      type: object",
    "      properties:",
    "        avgLatencyMs:",
    "          type: number",
    "",
  ].join("\n");
  const route = [
    "const X = [{",
    "  lastSync: null,",
    "}];",
    "const M = {",
    "  avgLatencyMs: 11.4,",
    "};",
    'const clampLimit = (raw, fallback) => Math.min(n, 200);',
    'router.get("/decisions", (req, res) => { const limit = clampLimit(req.query.limit, 20); });',
    'router.get("/metrics/dashboard", (_req, res) => { res.json(M); });',
    "",
  ].join("\n");
  const routes = [{ path: "r.ts", text: route }];
  const noFloors = (r) => r.fatal.filter((f) => !f.startsWith("FLOOR"));
  const withWindow = spec.replace(
    "      operationId: getDashboardMetrics",
    "      operationId: getDashboardMetrics\n      parameters:\n        - in: query\n          name: window\n          schema:\n            type: string",
  );
  const checks = [
    ["a document that matches the fixtures is clean", noFloors(auditAll(spec, routes)).length === 0],
    ["R1 — a `null` fixture against a non-null type FAILS", noFloors(auditAll(spec.replace('type: [string, "null"]', "type: string"), routes)).length === 1],
    ["R1 — OpenAPI 3.0's `nullable: true` is accepted too", noFloors(auditAll(spec.replace('type: [string, "null"]', "type: string\n          nullable: true"), routes)).length === 0],
    ["R2 — a decimal fixture against `type: integer` FAILS", noFloors(auditAll(spec.replace("        avgLatencyMs:\n          type: number", "        avgLatencyMs:\n          type: integer"), routes)).length === 1],
    ["R3 — a documented default the handler does not use FAILS", noFloors(auditAll(spec.replace("default: 20", "default: 50"), routes)).length === 1],
    ["R3 — a documented maximum the handler does not use FAILS", noFloors(auditAll(spec.replace("maximum: 200", "maximum: 500"), routes)).length === 1],
    ["R3 — no documented default at all FAILS", noFloors(auditAll(spec.replace("            default: 20\n", ""), routes)).length === 1],
    ["R4 — a query parameter on a handler that ignores its request FAILS", noFloors(auditAll(withWindow, routes)).length === 1],
    ["R4 — a handler that DOES read its request may document parameters", noFloors(auditAll(spec, routes)).length === 0],
    ["the FLOORS fire when a rule finds no subject at all", auditAll(spec, [{ path: "r.ts", text: "" }]).fatal.filter((f) => f.startsWith("FLOOR")).length === 4],
    ["nullProps / decimalProps / handlersIn read the shapes they claim to",
      nullProps(route).join() === "lastSync" && decimalProps(route).get("avgLatencyMs") === "11.4" && handlersIn(route).filter((h) => h.ignoresRequest).length === 1],
  ];
  let bad = 0;
  for (const [name, cond] of checks) {
    console.log(`  ${cond ? "ok" : "FAIL"} — ${name}`);
    if (!cond) bad += 1;
  }
  console.log(`\nself-test: ${checks.length - bad}/${checks.length}`);
  process.exit(bad === 0 ? 0 : 1);
}

if (process.argv.includes("--self-test")) selfTest();

const spec = readFileSync(join(ROOT, SPEC), "utf8");
const routes = ROUTE_FILES.map((p) => ({ path: p, text: readFileSync(join(ROOT, p), "utf8") }));
const { fatal, checked } = auditAll(spec, routes);

console.log(`/api fixture contract — ${SPEC} against ${routes.length} served route file(s)\n`);
console.log(`  R1 nullable  ${checked.nullable} subject(s)`);
console.log(`  R2 numeric   ${checked.numeric} subject(s)`);
console.log(`  R3 limits    ${checked.limits} subject(s)`);
console.log(`  R4 unread    ${checked.unread} subject(s)`);

if (fatal.length > 0) {
  console.error(`\n/api fixture contract FAILED — ${fatal.length} finding(s):\n`);
  for (const f of fatal) console.error(`  ✗ ${f}`);
  console.error(`\nThe SERVER is the truth here: change ${SPEC} to describe what the fixtures answer, not the\nother way round. ${SPEC} is orval's input, so a wrong document ships as two wrong clients.`);
  process.exit(1);
}
console.log(`\n/api fixture contract holds — the document describes what the fixtures answer.`);
