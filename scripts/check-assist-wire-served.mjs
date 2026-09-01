#!/usr/bin/env node
// Assist-wire served-ness gate (DR-007), v2 — rebuilt after the assurance
// review executed v1's blind spots: it derived "the SDK-bound route" from
// two DOC COMMENTS through two different regexes (so retargeting the prose
// passed green while the success line hardcoded a route it never checked,
// and any two-segment route produced a fabricated divergence), and the gap's
// closedWhen watched a directory whose evaluator could never read the YAML.
//
// v2 reads DATA:
//   · the bound route is the `route` field of the shared vectors file — the
//     artifact both SDK suites actually consume;
//   · the SDK endpoint files must MENTION that same route (one regex, both
//     files) so their documentation cannot drift from the contract;
//   · the route must be served by the spec OR claimed by the declared gap,
//     and the gap entry must name THIS route — a retargeted wire cannot
//     shelter under a gap that does not cover it;
//   · served-with-stale-gap fails; an emptied vector suite fails (vacuity).
import { readFileSync } from "node:fs";

const VECTORS = "native/shared/assist-wire-conformance.json";
const SPEC = "lib/api-spec/v1-openapi.yaml";
const GAPS_FILE = "scripts/launch-profile.mjs";
const KOTLIN = "native/android/core/src/main/kotlin/com/signalgrid/assist/core/GateEndpoint.kt";
const RUST = "native/desktop/core/src/endpoint.rs";
const GAP_ID = "assist-wire-unserved";
const ROUTE_SHAPE = /^\/v1\/[a-z-]+(?:\/[a-z-]+)*$/;

export function auditAssistWire({ vectorsJson, specYaml, gapsSrc, kotlinSrc, rustSrc }) {
  const problems = [];
  let vectors;
  try {
    vectors = JSON.parse(vectorsJson);
  } catch {
    return { problems: [`${VECTORS} does not parse — the shared contract is unreadable`], boundRoute: null };
  }
  const minCases = vectors?.requires?.minCases ?? 30;
  if (!Array.isArray(vectors?.cases) || vectors.cases.length < minCases) {
    problems.push(`${VECTORS} carries ${vectors?.cases?.length ?? 0} cases, below its own floor of ${minCases} — an emptied suite cannot count as agreement`);
  }
  const boundRoute = vectors?.route ?? null;
  if (!boundRoute || !ROUTE_SHAPE.test(boundRoute)) {
    problems.push(`${VECTORS} carries no well-formed "route" field — the wire the vectors bind must be DATA in the shared artifact, not prose in SDK comments`);
    return { problems, boundRoute: null };
  }
  // SDK docs must agree with the data — one check, one shape, both files.
  for (const [name, src] of [["Kotlin GateEndpoint.kt", kotlinSrc], ["Rust endpoint.rs", rustSrc]]) {
    if (!src.includes(boundRoute)) {
      problems.push(`${name} never mentions ${boundRoute} — its documentation drifted from the shared vectors' bound route`);
    }
  }
  const served = specYaml.includes(`${boundRoute}:`);
  const gapDeclared = gapsSrc.includes(`id: "${GAP_ID}"`);
  // Full metacharacter escape (CodeQL js/incomplete-sanitization): the route
  // shape is validated above, but an escape must not depend on that.
  const escaped = boundRoute.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const gapNamesRoute = gapDeclared && new RegExp(`id: "${GAP_ID}"[\\s\\S]{0,2000}?${escaped}`).test(gapsSrc);
  if (!served) {
    if (!gapDeclared) {
      problems.push(`the vectors bind ${boundRoute}, which the OpenAPI spec does not serve, and no "${GAP_ID}" entry claims it in ${GAPS_FILE} — a green suite over an unserved wire with no declared gap is the phantom contract DR-007 exists to prevent`);
    } else if (!gapNamesRoute) {
      problems.push(`the vectors bind ${boundRoute}, but the "${GAP_ID}" gap entry names a different route — a retargeted wire cannot shelter under a gap that does not cover it`);
    }
  }
  if (served && gapDeclared) {
    problems.push(`${boundRoute} is now SERVED but the "${GAP_ID}" gap entry still stands — remove the entry (its closedWhen should have fired; if it did not, the closedWhen predicate broke)`);
  }
  return { problems, boundRoute };
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
  // The committed tree is now SERVED with NO gap entry (DR-023 closed DR-007's gap).
  // Both failure modes are synthesised from it so the gate is still proven able to
  // fail: an unserved wire with no gap, and a served wire with a stale gap.
  const unservedSpec = base.specYaml.replace("/v1/authorize:", "/v1/authorize-unserved:");
  // Build the synthetic gap with its route as a parameter: a String.replace over the
  // whole source would swap the FIRST /v1/authorize in the file (the launch entry),
  // not the gap, and the retarget case would silently pass — the exact blind spot v1
  // had, reintroduced by the test meant to catch it.
  const gapNaming = (route) =>
    base.gapsSrc +
    `\n// synthetic (self-test only)\nconst __gap = { id: "${GAP_ID}", whatIsMissing: "POST ${route} is not served" };\n`;
  const staleGap = gapNaming("/v1/authorize");
  let r = auditAssistWire(base);
  checks.push(["the committed tree passes (route served, no gap entry)", r.problems.length === 0]);
  r = auditAssistWire({ ...base, specYaml: unservedSpec });
  checks.push(["an unserved route with NO gap entry FAILS (the phantom contract)", r.problems.some((x) => x.includes(`no "${GAP_ID}" entry`))]);
  r = auditAssistWire({ ...base, gapsSrc: staleGap });
  checks.push(["serving the route while a gap entry still stands FAILS (stale gap)", r.problems.some((x) => x.includes("still stands"))]);
  r = auditAssistWire({ ...base, specYaml: unservedSpec, gapsSrc: gapNaming("/v1/elsewhere") });
  checks.push(["an unserved route whose gap names a DIFFERENT route FAILS (retarget)", r.problems.some((x) => x.includes("different route"))]);
  // Retargeting the vectors to a second unserved route must fail on the SDK-mention
  // check even when the spec serves the original.
  const retargeted = JSON.stringify({ ...JSON.parse(base.vectorsJson), route: "/v1/assist" });
  r = auditAssistWire({ ...base, vectorsJson: retargeted });
  checks.push(["retargeting the vectors to a second unserved route FAILS", r.problems.some((x) => x.includes("different route") || x.includes("never mentions"))]);
  // Multi-segment identical routes must NOT fabricate divergence (the v1 defect).
  const deep = JSON.stringify({ ...JSON.parse(base.vectorsJson), route: "/v1/decisions/evaluate" });
  r = auditAssistWire({
    ...base,
    vectorsJson: deep,
    kotlinSrc: base.kotlinSrc + "\n// appends /v1/decisions/evaluate\n",
    rustSrc: base.rustSrc + "\n// appends /v1/decisions/evaluate\n",
  });
  checks.push(["identical multi-segment routes do NOT report divergence", !r.problems.some((x) => x.includes("DIFFERENT"))]);
  r = auditAssistWire({ ...base, vectorsJson: JSON.stringify({ requires: { minCases: 30 }, cases: [], route: "/v1/authorize" }) });
  checks.push(["an emptied vector suite trips the vacuity floor", r.problems.some((x) => x.includes("below its own floor"))]);
  r = auditAssistWire({ ...base, vectorsJson: JSON.stringify({ ...JSON.parse(base.vectorsJson), route: undefined }) });
  checks.push(["vectors without a route field FAIL (the wire must be data)", r.problems.some((x) => x.includes("no well-formed \"route\""))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());
  const { problems, boundRoute } = auditAssistWire(load());
  console.log("Assist-wire served-ness — the vector-bound wire is served, or a declared gap (DR-007 / DR-023)");
  if (problems.length > 0) {
    console.error(`Assist-wire check FAILED: ${problems.length} problem(s).`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }
  console.log(`Assist-wire check passed — ${boundRoute} is served by the spec (DR-023), and no stale gap entry remains.`);
}
