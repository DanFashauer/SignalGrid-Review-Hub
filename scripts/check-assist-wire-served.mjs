#!/usr/bin/env node
// Assist-wire served-ness gate (DR-007). The shared conformance vectors bind
// the Kotlin and Rust SDKs to POST /v1/authorize returning {assist, reasons,
// decisionId} — a route this repository does not serve. A green conformance
// suite over an unserved wire proves two SDKs agree with each other about a
// contract nothing answers; that is tolerable ONLY while the gap is declared
// where declared gaps live (scripts/launch-profile.mjs GAPS, entry
// assist-wire-unserved). This gate fails when:
//   1. the SDKs bind a route the OpenAPI spec does not register, AND no
//      declared-gap entry claims the assist wire — deleting the gap entry
//      without serving the route fails here;
//   2. the SDKs' bound routes diverge from each other (a second phantom
//      contract would be worse than one);
//   3. the vectors stop parsing, or bind fewer cases than their own floor —
//      a vacuity guard so an emptied suite cannot read as agreement.
import { readFileSync } from "node:fs";

const VECTORS = "native/shared/assist-wire-conformance.json";
const SPEC = "lib/api-spec/v1-openapi.yaml";
const GAPS_FILE = "scripts/launch-profile.mjs";
const KOTLIN = "native/android/core/src/main/kotlin/com/signalgrid/assist/core/GateEndpoint.kt";
const RUST = "native/desktop/core/src/endpoint.rs";
const GAP_ID = "assist-wire-unserved";

export function auditAssistWire({ vectorsJson, specYaml, gapsSrc, kotlinSrc, rustSrc }) {
  const problems = [];
  let vectors;
  try {
    vectors = JSON.parse(vectorsJson);
  } catch {
    return [`${VECTORS} does not parse — the shared contract is unreadable`];
  }
  const minCases = vectors?.requires?.minCases ?? 30;
  if (!Array.isArray(vectors?.cases) || vectors.cases.length < minCases) {
    problems.push(`${VECTORS} carries ${vectors?.cases?.length ?? 0} cases, below its own floor of ${minCases} — an emptied suite cannot count as agreement`);
  }
  const routeOf = (src, name) => {
    const m = /\/v1\/[a-z-]+(?:\/[a-z-]+)?/i.exec(src.match(/appending `([^`]+)`/)?.[1] ?? "");
    if (m) return m[0];
    const any = src.match(/\/v1\/[a-z][a-z-]*/i);
    return any ? (name, any[0]) : null;
  };
  const kotlinRoute = routeOf(kotlinSrc, "kotlin");
  const rustRoute = routeOf(rustSrc, "rust");
  if (!kotlinRoute || !rustRoute) {
    problems.push("could not extract the bound route from one of the SDK endpoint files — the extractor, not the SDK, changed");
  } else if (kotlinRoute !== rustRoute) {
    problems.push(`the SDKs bind DIFFERENT routes (kotlin ${kotlinRoute}, rust ${rustRoute}) — two phantom contracts`);
  }
  const boundRoute = kotlinRoute ?? rustRoute;
  if (boundRoute) {
    const served = specYaml.includes(`${boundRoute}:`);
    const gapDeclared = gapsSrc.includes(`id: "${GAP_ID}"`);
    if (!served && !gapDeclared) {
      problems.push(
        `the SDK conformance suite binds ${boundRoute}, which the OpenAPI spec does not serve, and no "${GAP_ID}" entry claims it in ${GAPS_FILE} — a green suite over an unserved wire with no declared gap is the phantom contract DR-007 exists to prevent`,
      );
    }
    if (served && gapDeclared) {
      problems.push(`${boundRoute} is now SERVED but the "${GAP_ID}" gap entry still stands — remove the entry (its closedWhen should have fired; if it did not, the closedWhen predicate broke)`);
    }
  }
  return problems;
}

function load() {
  return {
    vectorsJson: readFileSync(VECTORS, "utf8"),
    specYaml: readFileSync(SPEC, "utf8"),
    gapsSrc: readFileSync(GAPS_FILE, "utf8"),
    kotlinSrc: readFileSync(KOTLIN, "utf8"),
    rustSrc: readFileSync(RUST, "utf8"),
  };
}

function selfTest() {
  const checks = [];
  const base = load();
  let p = auditAssistWire(base);
  checks.push(["the committed tree passes (gap declared, route unserved)", p.length === 0]);
  p = auditAssistWire({ ...base, gapsSrc: base.gapsSrc.replace(`id: "${GAP_ID}"`, 'id: "renamed-away"') });
  checks.push(["deleting the gap entry while the route stays unserved FAILS", p.some((x) => x.includes("no \"assist-wire-unserved\" entry"))]);
  p = auditAssistWire({ ...base, specYaml: base.specYaml + "\n  /v1/authorize:\n    post: {}\n" });
  checks.push(["serving the route while the gap entry still stands FAILS (stale gap)", p.some((x) => x.includes("still stands"))]);
  p = auditAssistWire({ ...base, vectorsJson: JSON.stringify({ requires: { minCases: 30 }, cases: [] }) });
  checks.push(["an emptied vector suite trips the vacuity floor", p.some((x) => x.includes("below its own floor"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const problems = auditAssistWire(load());
console.log("Assist-wire served-ness — the SDK-bound wire is either served or a declared gap (DR-007)");
if (problems.length > 0) {
  console.error(`Assist-wire check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("Assist-wire check passed — /v1/authorize is a declared gap, not a phantom contract.");
