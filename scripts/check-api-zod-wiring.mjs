#!/usr/bin/env node
// api-zod wiring — a defined-but-dead input validator must not masquerade as coverage.
//
// `lib/api-zod/src/generated/api.ts` exports a Zod schema for every request body, query
// string and path parameter in `lib/api-spec/openapi.yaml`. Reading that file, a
// reviewer concludes the `/api` boundary is schema-validated. It is not: exactly one of
// those input schemas is invoked at runtime (`GetIntegrationParams.safeParse`), the rest
// are imported as TYPES or not at all, and the live `/v1` routes hand-roll their
// validation in `artifacts/api-server/src/routes/v1.ts`. A schema nobody parses cannot
// reject anything, and a package full of them reads exactly like coverage.
//
// So every exported input schema must be one of two things, and say which:
//
//   WIRED        — referenced by a `.parse(` / `.safeParse(` under
//                  `artifacts/api-server/src/routes/**`.
//   CLIENT_ONLY  — declared below, with the reason, as a client/type-only schema.
//
// Anything else is an ORPHAN and fails. The check is deliberately WEAK about what it
// asserts: only that a call exists — never WHERE, never that the call is correct, never
// that the schema is the right one for the route. Those are properties `test:api` and
// the contract proof own. This one answers a single question a reader cannot answer by
// looking: does this validator run at all?
//
// The declaration list is held honest in both directions: an entry naming a schema that
// no longer exists fails, and so does an entry for a schema that IS wired.
//
//   node scripts/check-api-zod-wiring.mjs
//   node scripts/check-api-zod-wiring.mjs --self-test
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = "lib/api-zod/src/generated/api.ts";
const ROUTES_DIR = "artifacts/api-server/src/routes";
const SPEC = "lib/api-spec/openapi.yaml";

/** The parser is broken, not the package, if it finds fewer input schemas than this. */
const MIN_INPUT_SCHEMAS = 8;

/**
 * Input schemas that are client/type-only BY DECISION, each with the reason.
 *
 * Two shapes, and the difference matters to anyone deciding whether to wire one:
 *
 *   "served, hand-rolled" — the operation is still in openapi.yaml and still served, but
 *   its handler parses by hand. Wiring the schema here would be a real change to the
 *   boundary, not a cleanup, and belongs in a change that also proves the new refusals.
 *
 *   "operation pruned"    — the operation is GONE from openapi.yaml (the six write
 *   operations the server never served were removed), so the schema is output from an
 *   older generation. It disappears when `@workspace/api-zod` can be regenerated, which
 *   is blocked on orval 8.24 emitting zod-v4 calls against zod 3.25 — its own open
 *   BUILD_BACKLOG row. The REPORT at the bottom of this gate re-derives which entries
 *   are in this state from the spec, so the label cannot rot into a comment.
 */
export const CLIENT_ONLY = new Map([
  ["ListDecisionsQueryParams", "served, hand-rolled — monitoring.ts parses `limit`/`outcome` itself"],
  ["GetDecisionParams", "served, hand-rolled — monitoring.ts reads `req.params.id` directly"],
  ["ListLatestSignalsQueryParams", "served, hand-rolled — monitoring.ts parses `limit`/`signalType` itself"],
  ["GetDashboardMetricsQueryParams", "served, hand-rolled — monitoring.ts parses the `window` query itself"],
  ["GetDecisionSeriesQueryParams", "served, hand-rolled — monitoring.ts parses `window`/`granularity` itself"],
  ["EvaluateDecisionBody", "operation pruned — POST /decisions is not in openapi.yaml and was never served"],
  ["IngestSignalBody", "operation pruned — POST /signals/ingest is not in openapi.yaml and was never served"],
  ["CreatePolicyBody", "operation pruned — POST /policies is not in openapi.yaml and was never served"],
  ["GetPolicyParams", "operation pruned — GET /policies/{id} is not in openapi.yaml and was never served"],
  ["UpdatePolicyParams", "operation pruned — PUT /policies/{id} is not in openapi.yaml and was never served"],
  ["UpdatePolicyBody", "operation pruned — PUT /policies/{id} is not in openapi.yaml and was never served"],
  ["DeletePolicyParams", "operation pruned — DELETE /policies/{id} is not in openapi.yaml and was never served"],
]);

/** Pure. Exported INPUT schemas in the generated source: `*Body`, `*QueryParams`,
 *  `*Params`. `*Response` is an output schema (a client's concern) and the
 *  `…QueryLimitDefault` consts are plain numbers, not schemas — neither is an input
 *  validator, so neither is in scope. */
export function inputSchemasIn(source) {
  return [...source.matchAll(/^export const ([A-Za-z0-9_]+)\s*=/gm)]
    .map((m) => m[1])
    .filter((n) => /(?:Body|QueryParams|Params)$/.test(n));
}

/** Pure. Is `name` invoked as a validator in `text`? `Name.parse(` / `Name.safeParse(`,
 *  allowing whitespace and a newline between the member and the paren. */
export function invokedAsValidator(name, text) {
  return new RegExp(String.raw`\b${name}\s*\.\s*(?:safeParse|parse)\s*\(`).test(text);
}

/** Pure. `Name` → the operationId orval derived it from: `GetIntegrationParams` →
 *  `getIntegration`. Used only by the REPORT below, never by a fatal assertion. */
export function operationIdFor(name) {
  const stem = name.replace(/(?:Body|QueryParams|Params)$/, "");
  return stem.charAt(0).toLowerCase() + stem.slice(1);
}

/** Pure core, so the self-test drives every verdict without touching the tree. */
export function verdictFor({ schemas, wired }, clientOnly = CLIENT_ONLY) {
  const problems = [];
  for (const name of schemas) {
    const isWired = wired.includes(name);
    const declared = clientOnly.has(name);
    if (isWired && declared) {
      problems.push(`${name} is declared client/type-only AND parsed under ${ROUTES_DIR} — the declaration contradicts the code`);
    } else if (!isWired && !declared) {
      problems.push(
        `${name} is an ORPHAN — exported as an input validator, parsed nowhere under ${ROUTES_DIR}, ` +
          `and not declared client/type-only. Wire it, or declare it with the reason.`,
      );
    }
  }
  for (const [name, reason] of clientOnly) {
    if (!schemas.includes(name)) problems.push(`${name} is declared client/type-only but ${GENERATED} no longer exports it — a stale exemption`);
    if (!reason || !String(reason).trim()) problems.push(`${name} is declared client/type-only with no reason — a silent exemption is what this gate forbids`);
  }
  return problems;
}

function routeSources() {
  const dir = join(repo, ROUTES_DIR);
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return out;
}

function selfTest() {
  const declared = new Map([["DeadBody", "declared for the self-test"]]);
  const checks = [
    ["a wired schema passes", verdictFor({ schemas: ["AParams"], wired: ["AParams"] }, new Map()).length === 0],
    ["an undeclared, unwired schema is an ORPHAN", verdictFor({ schemas: ["AParams"], wired: [] }, new Map()).length === 1],
    ["a declared, unwired schema passes", verdictFor({ schemas: ["DeadBody"], wired: [] }, declared).length === 0],
    ["a declared schema that IS wired fails — the declaration contradicts the code", verdictFor({ schemas: ["DeadBody"], wired: ["DeadBody"] }, declared).length === 1],
    ["a declaration for a schema that no longer exists fails", verdictFor({ schemas: [], wired: [] }, declared).length === 1],
    ["a declaration with an empty reason fails", verdictFor({ schemas: ["X"], wired: [] }, new Map([["X", "  "]])).length === 1],
    [
      "only input schemas are in scope — Response schemas and the …Default consts are not",
      (() => {
        const found = inputSchemasIn(
          'export const HealthCheckResponse = zod.object({})\nexport const listDecisionsQueryLimitDefault = 50;\nexport const ListDecisionsQueryParams = zod.object({})\nexport const EvaluateDecisionBody = zod.object({})\nexport const GetDecisionParams = zod.object({})\n',
        );
        return found.length === 3 && found.includes("ListDecisionsQueryParams") && !found.includes("HealthCheckResponse");
      })(),
    ],
    ["`.safeParse(` counts as an invocation", invokedAsValidator("GetIntegrationParams", "const p = GetIntegrationParams.safeParse(req.params);")],
    ["`.parse(` counts too, across a line break", invokedAsValidator("HealthCheckResponse", "HealthCheckResponse\n  .parse({ status: 'ok' })")],
    ["an IMPORT is not an invocation — the defect this gate exists for", invokedAsValidator("EvaluateDecisionBody", 'import { EvaluateDecisionBody } from "@workspace/api-zod";') === false],
    ["a same-prefixed neighbour does not credit a schema", invokedAsValidator("GetPolicy", "GetPolicyParams.parse(x)") === false],
    ["the operationId derivation matches orval's", operationIdFor("GetIntegrationParams") === "getIntegration" && operationIdFor("EvaluateDecisionBody") === "evaluateDecision"],
    ["every live declaration carries a reason", [...CLIENT_ONLY.values()].every((r) => typeof r === "string" && r.trim().length > 0)],
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

const generated = readFileSync(join(repo, GENERATED), "utf8");
const schemas = inputSchemasIn(generated);
const routeBlob = routeSources().join("\n");
const wired = schemas.filter((n) => invokedAsValidator(n, routeBlob));

console.log(`api-zod wiring — ${schemas.length} exported input schema(s) in ${GENERATED}\n`);
if (schemas.length < MIN_INPUT_SCHEMAS) {
  console.error(`  ✗ only ${schemas.length} input schema(s) parsed — the scan is broken, not the package (floor ${MIN_INPUT_SCHEMAS}).`);
  process.exit(1);
}

for (const name of schemas) {
  const state = wired.includes(name) ? "WIRED" : CLIENT_ONLY.has(name) ? "client/type-only" : "ORPHAN";
  console.log(`  ${state === "ORPHAN" ? "✗ " : "ok"} ${name.padEnd(34)} ${state}${state === "client/type-only" ? ` — ${CLIENT_ONLY.get(name)}` : ""}`);
}
console.log(`\nwired=${wired.length} client/type-only=${schemas.length - wired.length}`);

// REPORTED, never fatal: schemas generated from an operation the spec no longer carries.
// Regeneration is blocked on its own BUILD_BACKLOG row (orval 8.24 emits zod-v4 calls
// against zod 3.25), so failing here would be a gate nobody can turn green.
const spec = readFileSync(join(repo, SPEC), "utf8");
const stale = schemas.filter((n) => !new RegExp(String.raw`operationId:\s*${operationIdFor(n)}\b`).test(spec));
if (stale.length > 0) {
  console.log(
    `\nREPORTED (never fatal) — ${stale.length} schema(s) whose operationId is no longer in ${SPEC}:\n` +
      stale.map((n) => `  · ${n} (${operationIdFor(n)})`).join("\n") +
      `\n  The committed output predates the prune of the six write operations the server never served.\n` +
      `  It clears when @workspace/api-zod can be regenerated — blocked, and tracked in docs/BUILD_BACKLOG.md.`,
  );
}

const problems = verdictFor({ schemas, wired });
if (problems.length > 0) {
  console.error(`\napi-zod wiring FAILED — ${problems.length} finding(s):\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\nEither call `.parse`/`.safeParse` on it at the boundary it belongs to, or add it to\n" +
      "CLIENT_ONLY above with the reason it is a client/type-only schema. A schema that is\n" +
      "neither is read as coverage by every reviewer who opens the package.",
  );
  process.exit(1);
}
console.log(`\napi-zod wiring holds — every exported input schema is either invoked at the boundary or declared client/type-only.`);
