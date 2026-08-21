#!/usr/bin/env node
// Reason-code catalog gate. The verdict vocabulary IS the product surface
// (the host app renders the worker's message from it), and the one prior
// mapping named four codes the engine has never emitted. This holds
// docs/REASON_CODES.md and the OpenAPI contract against source, BOTH ways:
//   1. a code the engine emits with no catalog row fails;
//   2. a catalog row naming a code no source emits fails;
//   3. the OpenAPI x-signalgrid-reason-codes list must equal the emit set;
//   4. fixtures' expected outcomes must appear among the catalog verdicts;
//   5. vacuity floor: fewer than 30 parsed codes means the parser broke,
//      not that the vocabulary shrank.
import { readFileSync } from "node:fs";
import { buildCatalog } from "./gen-reason-codes.mjs";

const CATALOG = "docs/REASON_CODES.md";
const SPEC = "lib/api-spec/v1-openapi.yaml";
const FLOOR = 30;

export function auditReasonCodes({ rows, catalogMd, specYaml }) {
  const problems = [];
  if (rows.length < FLOOR) {
    problems.push(`vacuity: only ${rows.length} codes parsed from source (floor ${FLOOR}) — the parser, not the engine, changed`);
  }
  const docCodes = new Set([...catalogMd.matchAll(/^\| `([A-Z][A-Z0-9_]{4,})` \|/gm)].map((m) => m[1]));
  for (const r of rows) {
    if (!docCodes.has(r.code)) {
      problems.push(`the engine emits ${r.code}; docs/REASON_CODES.md has no row for it — regenerate: node scripts/gen-reason-codes.mjs`);
    }
  }
  const emitSet = new Set(rows.map((r) => r.code));
  for (const c of docCodes) {
    if (!emitSet.has(c)) {
      problems.push(`docs/REASON_CODES.md catalogs ${c}, which no source file emits — a host app would wait for a message that never fires`);
    }
  }
  // The spec's machine-readable engine-code list (deliberately NOT an enum:
  // tenant-authored rule codes extend the set at runtime).
  const specList = specYaml.match(/x-signalgrid-reason-codes:\n((?:\s+- [A-Z][A-Z0-9_]{4,}\n)+)/);
  if (!specList) {
    problems.push(`${SPEC} carries no x-signalgrid-reason-codes list — the contract names no engine vocabulary at all`);
  } else {
    const specCodes = new Set([...specList[1].matchAll(/- ([A-Z][A-Z0-9_]{4,})/g)].map((m) => m[1]));
    for (const r of rows) if (!specCodes.has(r.code)) problems.push(`the engine emits ${r.code}; the OpenAPI x-signalgrid-reason-codes list omits it`);
    for (const c of specCodes) if (!emitSet.has(c)) problems.push(`the OpenAPI x-signalgrid-reason-codes list names ${c}, which no source emits`);
  }
  for (const r of rows) {
    for (const o of r.fixtureOutcomes) {
      if (r.verdicts !== "—" && !r.verdicts.includes(o)) {
        problems.push(`fixture for ${r.code} expects outcome ${o}, absent from its catalog verdicts (${r.verdicts}) — the verdict parse drifted`);
      }
    }
  }
  return problems;
}

function selfTest() {
  const checks = [];
  const rows = buildCatalog();
  const catalogMd = readFileSync(CATALOG, "utf8");
  const specYaml = readFileSync(SPEC, "utf8");
  let p = auditReasonCodes({ rows, catalogMd, specYaml });
  checks.push(["the committed tree passes", p.length === 0]);
  p = auditReasonCodes({ rows, catalogMd: catalogMd.replace(/^\| `POSTURE_STALE` \|.*\n/m, ""), specYaml });
  checks.push(["deleting a catalog row FAILS (engine → doc direction)", p.some((x) => x.includes("POSTURE_STALE") && x.includes("no row"))]);
  p = auditReasonCodes({
    rows,
    catalogMd: catalogMd + "\n| `DEVICE_POSTURE_STALE` | deny | manual_only | x | y | — |\n",
    specYaml,
  });
  checks.push(["adding a phantom code to the catalog FAILS (doc → engine direction)", p.some((x) => x.includes("DEVICE_POSTURE_STALE") && x.includes("no source file emits"))]);
  p = auditReasonCodes({ rows, catalogMd, specYaml: specYaml.replace(/x-signalgrid-reason-codes:/, "x-unrelated:") });
  checks.push(["a spec without the engine-code list FAILS", p.some((x) => x.includes("no x-signalgrid-reason-codes"))]);
  p = auditReasonCodes({ rows: rows.slice(0, 5), catalogMd, specYaml });
  checks.push(["a collapsed parse trips the vacuity floor", p.some((x) => x.includes("vacuity"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const rows = buildCatalog();
const problems = auditReasonCodes({
  rows,
  catalogMd: readFileSync(CATALOG, "utf8"),
  specYaml: readFileSync(SPEC, "utf8"),
});
console.log(`Reason-code check — ${rows.length} engine codes held against the catalog and the contract`);
if (problems.length > 0) {
  console.error(`Reason-code check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("Reason-code check passed — the vocabulary the engine emits is the vocabulary the contract and catalog name.");
