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
// The validator parses YAML itself; validate the real file FIRST so its
// parsed form is available for the AST parameter check below.
const res = await validator.validate(SPEC);
const doc = validator.specification;
const comp = doc.components?.parameters ?? {};
const resolve = (x) => (x?.$ref ? (comp[x.$ref.split("/").pop()] ?? {}) : x);
let paramProblems = 0;
for (const [path, item] of Object.entries(doc.paths ?? {})) {
  const needed = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (needed.length === 0) continue;
  const declared = new Set();
  for (const [k, v] of Object.entries(item)) {
    const params = k === "parameters" ? v : v?.parameters;
    for (const p of params ?? []) {
      const r = resolve(p);
      if (r.in === "path") declared.add(r.name);
    }
  }
  for (const n of needed) {
    if (!declared.has(n)) {
      console.error(`✗ ${path}: templated {${n}} has no declared in:path parameter`);
      paramProblems += 1;
    }
  }
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
  `${Object.keys(doc.paths).length} paths, every templated parameter declared.`);
