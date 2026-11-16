// Real OpenAPI validation of the published /v1 contract (backlog row 15).
//
// Before this existed, NOTHING in the repo parsed lib/api-spec/v1-openapi.yaml
// as OpenAPI: two regex readers walked it line-wise, and codegen reads the zod
// file — so the spec could be structurally invalid (it WAS: three sessions
// paths used {id} without declaring the parameter, which any partner
// validator rejects) while every gate stayed green. This gate validates the
// document against the OpenAPI 3.x schema itself via
// @seriousme/openapi-schema-validator (zero transitive dependencies — the
// gate that guards the contract should not drag a dependency tree in behind
// it).
//
// SELF-TEST FIRST, per the gate-estate rule that a guard nobody has watched
// fail proves nothing: before validating the real spec, we validate a
// deliberately broken document (a templated path with an undeclared
// parameter — the exact defect class that was live) and REFUSE to continue
// if the validator passes it. A validator that cannot fail is not a gate.
import { Validator } from "@seriousme/openapi-schema-validator";

const SPEC = "lib/api-spec/v1-openapi.yaml";

console.log("OpenAPI validity — the published contract must parse as OpenAPI\n");

const validator = new Validator({ strict: false });

// ── self-test: the gate must be able to fail ────────────────────────────────
const broken = {
  openapi: "3.0.3",
  info: { title: "self-test", version: "0" },
  paths: {
    "/things/{id}": {
      get: { responses: { 200: { description: "ok" } } },
    },
  },
};
// The undeclared-{id} defect is a semantic rule some schema validators skip;
// what the schema DOES always catch is a malformed document. Use both probes
// and require at least the structural one to fail.
const brokenStructural = { openapi: "3.0.3", info: { title: "x" }, paths: { "/a": { get: {} } } };
const st1 = await new Validator({ strict: false }).validate(broken);
const st2 = await new Validator({ strict: false }).validate(brokenStructural);
if (st2.valid) {
  console.error("✗ SELF-TEST FAILED: the validator passed a document missing info.version");
  console.error("  and an empty operation. A gate that cannot fail proves nothing.");
  process.exit(1);
}
console.log(
  `  self-test: structural defect refused (${st2.valid ? "?!" : "ok"}); ` +
    `undeclared-path-param ${st1.valid ? "not caught by schema (covered by the AST check below)" : "refused too"}`,
);

// ── the undeclared-parameter check the sessions defect proved we need ──────
// Schema validation alone does not enforce path-template/parameter agreement,
// so pin it here directly: every {name} in a path must be declared as an
// in:path parameter at path or operation level ($refs resolved).

/** Every `{name}` in a path with no matching `in: path` parameter. Pure, so the rule
 *  can be watched failing — see the arms below. */
export function undeclaredPathParams(doc) {
  const comp = doc?.components?.parameters ?? {};
  const deref = (x) => (x?.$ref ? (comp[x.$ref.split("/").pop()] ?? {}) : x);
  const problems = [];
  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    const needed = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    if (needed.length === 0) continue;
    const declared = new Set();
    for (const [k, v] of Object.entries(item ?? {})) {
      const params = k === "parameters" ? v : v?.parameters;
      for (const p of params ?? []) {
        const r = deref(p);
        if (r?.in === "path") declared.add(r.name);
      }
    }
    for (const n of needed) if (!declared.has(n)) problems.push({ path, name: n });
  }
  return problems;
}

// THE ARM THE HEADER ALREADY PROMISED. It says the gate first validates "a templated
// path with an undeclared parameter — the exact defect class that was live" and
// refuses to continue if that passes. The schema validator does not enforce that rule
// (`st1` above is printed, never asserted), and the AST check that DOES enforce it had
// no control of any kind: it could have been deleted, inverted, or silently matched
// nothing, and this gate would have printed "every templated parameter declared".
{
  const op = { responses: { 200: { description: "ok" } } };
  const arms = [
    ["a templated {id} with NO parameter is caught — the planted defect",
      undeclaredPathParams({ paths: { "/things/{id}": { get: op } } }).length === 1],
    ["…and it names the path and the parameter",
      undeclaredPathParams({ paths: { "/things/{id}": { get: op } } })[0]?.name === "id"],
    ["a PATH-level in:path parameter clears it (the rule is not always-red)",
      undeclaredPathParams({ paths: { "/things/{id}": { parameters: [{ name: "id", in: "path" }], get: op } } }).length === 0],
    ["an OPERATION-level in:path parameter clears it",
      undeclaredPathParams({ paths: { "/things/{id}": { get: { ...op, parameters: [{ name: "id", in: "path" }] } } } }).length === 0],
    ["a $ref to components.parameters is resolved, not counted undeclared",
      undeclaredPathParams({
        components: { parameters: { Id: { name: "id", in: "path" } } },
        paths: { "/things/{id}": { get: { ...op, parameters: [{ $ref: "#/components/parameters/Id" }] } } },
      }).length === 0],
    ["a parameter of the same name declared in:QUERY does NOT clear a path template",
      undeclaredPathParams({ paths: { "/things/{id}": { get: { ...op, parameters: [{ name: "id", in: "query" }] } } } }).length === 1],
    ["a path with no template is not a finding",
      undeclaredPathParams({ paths: { "/things": { get: op } } }).length === 0],
    ["TWO templates, one declared, still reports the other",
      undeclaredPathParams({ paths: { "/a/{x}/b/{y}": { parameters: [{ name: "x", in: "path" }], get: op } } }).length === 1],
  ];
  const bad = arms.filter(([, ok]) => !ok);
  for (const [n, ok] of arms) console.log(`  ${ok ? "ok  " : "FAIL"} self-test: ${n}`);
  if (bad.length > 0) {
    console.error(`\n✗ SELF-TEST FAILED: ${bad.length} of ${arms.length} undeclared-parameter control(s).`);
    console.error("  The rule this gate exists for cannot be shown to work, so its silence means nothing.");
    process.exit(1);
  }
}

// The validator parses YAML itself; validate the real file FIRST so its
// parsed form is available for the AST parameter check below.
const res = await validator.validate(SPEC);
const doc = validator.specification;
const problems = undeclaredPathParams(doc);
for (const { path, name } of problems) console.error(`✗ ${path}: templated {${name}} has no declared in:path parameter`);
const paramProblems = problems.length;

// NON-VACUITY: the real spec must actually contain templated paths, or this rule is
// being run over nothing and its silence is not evidence.
const templatedPaths = Object.keys(doc?.paths ?? {}).filter((p) => /\{\w+\}/.test(p));
if (templatedPaths.length === 0) {
  console.error(`\n✗ ${SPEC} declares no templated path at all — the parameter rule scanned nothing.`);
  process.exit(1);
}

// ── the real document's schema verdict ─────────────────────────────────────
if (!res.valid) {
  console.error(`✗ ${SPEC} is not valid OpenAPI:`);
  console.error(JSON.stringify(res.errors, null, 2).slice(0, 4000));
}
if (!res.valid || paramProblems > 0) {
  console.error(
    `\nOpenAPI-validity gate FAILED — ${paramProblems} undeclared path parameter(s), schema valid=${res.valid}. ` +
      "A partner's validator rejects what this gate rejects; fix the spec, never the gate.",
  );
  process.exit(1);
}
console.log(`\nOpenAPI-validity gate passed — ${SPEC} parses as OpenAPI ${doc.openapi}, ` +
  `${Object.keys(doc.paths).length} paths (${templatedPaths.length} templated), every templated parameter declared.`);
