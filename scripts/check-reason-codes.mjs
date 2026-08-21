#!/usr/bin/env node
// Reason-code catalog gate, v2 — rebuilt after the assurance review proved v1
// could not fail: it compared code NAMES only, so every verdict, class,
// worker sentence, section placement and prose count was hand-editable to a
// lie under a green gate, and its fixture cross-check was satisfied by
// construction (the generator repaired the rows before the audit read them).
// The v2 contract is brutal and simple:
//   1. docs/REASON_CODES.md must be BYTE-IDENTICAL to a fresh generation from
//      the engine — every cell in every column is protected at once;
//   2. generation itself fails on parse problems (a non-literal reason-code
//      construction outside the sanctioned tenant pass-through) and on
//      genuine fixture contradictions (checked BEFORE any repair);
//   3. the OpenAPI x-signalgrid-reason-codes list must equal the emit set.
import { readFileSync } from "node:fs";
import { buildCatalog, buildMarkdown } from "./gen-reason-codes.mjs";

const CATALOG = "docs/REASON_CODES.md";
const SPEC = "lib/api-spec/v1-openapi.yaml";
const FLOOR = 30;

export function auditReasonCodes({ catalog, committedMd, specYaml }) {
  const problems = [...catalog.problems, ...catalog.contradictions];
  const { rows } = catalog;
  if (rows.length < FLOOR) {
    problems.push(`vacuity: only ${rows.length} codes parsed from source (floor ${FLOOR}) — the parser, not the engine, changed`);
  }
  const fresh = buildMarkdown(catalog);
  if (committedMd !== fresh) {
    // name the first divergent line so the remedy is obvious
    const a = committedMd.split("\n");
    const b = fresh.split("\n");
    let i = 0;
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1;
    problems.push(
      `${CATALOG} is not a faithful generation — first divergence at line ${i + 1}: committed ${JSON.stringify((a[i] ?? "<eof>").slice(0, 80))} vs generated ${JSON.stringify((b[i] ?? "<eof>").slice(0, 80))}. Regenerate: node scripts/gen-reason-codes.mjs`,
    );
  }
  const emitSet = new Set(rows.map((r) => r.code));
  const specList = specYaml.match(/x-signalgrid-reason-codes:\n((?:\s+- [A-Z][A-Z0-9_]{4,}\n)+)/);
  if (!specList) {
    problems.push(`${SPEC} carries no x-signalgrid-reason-codes list — the contract names no engine vocabulary at all`);
  } else {
    const specCodes = new Set([...specList[1].matchAll(/- ([A-Z][A-Z0-9_]{4,})/g)].map((m) => m[1]));
    for (const c of emitSet) if (!specCodes.has(c)) problems.push(`the engine emits ${c}; the OpenAPI x-signalgrid-reason-codes list omits it`);
    for (const c of specCodes) if (!emitSet.has(c)) problems.push(`the OpenAPI x-signalgrid-reason-codes list names ${c}, which no source emits`);
  }
  return problems;
}

function selfTest() {
  const checks = [];
  const catalog = buildCatalog();
  const committedMd = readFileSync(CATALOG, "utf8");
  const specYaml = readFileSync(SPEC, "utf8");
  let p = auditReasonCodes({ catalog, committedMd, specYaml });
  checks.push(["the committed tree passes", p.length === 0]);
  // Byte-diff catches EVERY mutation class the review executed against v1:
  for (const [label, mutate] of [
    ["a hand-edited VERDICT cell fails", (md) => md.replace("| deny |", "| allow |")],
    ["a hand-edited WORKER sentence fails", (md) => md.replace("Use a different device", "Tap continue to proceed")],
    ["a hand-edited resolution CLASS fails", (md) => md.replace("| manual_only |", "| auto_proposed |")],
    ["a falsified prose COUNT fails", (md) => md.replace(/\*\*\d+ codes\*\*/, "**12 codes**")],
    ["a deleted SECTION fails", (md) => md.replace(/## The descriptor gap, stated[\s\S]*?##/, "##")],
    ["a row MOVED between sections fails", (md) => {
      const line = md.split("\n").find((l) => l.startsWith("| `OFFLINE_STANDING_AGE_UNSTATED`"));
      return line ? md.replace(line + "\n", "").replace("## Draft-policy codes", line + "\n\n## Draft-policy codes") : md;
    }],
  ]) {
    const mutated = mutate(committedMd);
    if (mutated === committedMd) { checks.push([label + " (mutation applied)", false]); continue; }
    p = auditReasonCodes({ catalog, committedMd: mutated, specYaml });
    checks.push([label, p.some((x) => x.includes("not a faithful generation"))]);
  }
  p = auditReasonCodes({ catalog, committedMd, specYaml: specYaml.replace(/x-signalgrid-reason-codes:/, "x-unrelated:") });
  checks.push(["a spec without the engine-code list FAILS", p.some((x) => x.includes("no x-signalgrid-reason-codes"))]);
  p = auditReasonCodes({ catalog: { ...catalog, rows: catalog.rows.slice(0, 5) }, committedMd, specYaml });
  checks.push(["a collapsed parse trips the vacuity floor", p.some((x) => x.includes("vacuity"))]);
  p = auditReasonCodes({ catalog: { ...catalog, contradictions: ["fixture X expects allow for Y, tables produce deny"] }, committedMd, specYaml });
  checks.push(["a fixture contradiction reported by generation FAILS the gate", p.some((x) => x.includes("fixture X"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Direct invocation only — importing this module must not run the gate
// (assurance advisory: an import-time run can exit the importing process).
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const catalog = buildCatalog();
  const problems = auditReasonCodes({
    catalog,
    committedMd: readFileSync(CATALOG, "utf8"),
    specYaml: readFileSync(SPEC, "utf8"),
  });
  console.log(`Reason-code check — ${catalog.rows.length} engine codes; catalog held to byte-faithful generation`);
  if (problems.length > 0) {
    console.error(`Reason-code check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log("Reason-code check passed — the committed catalog IS a generation, and the contract names the same vocabulary.");
}
