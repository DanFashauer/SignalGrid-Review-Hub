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
import { fileURLToPath, pathToFileURL } from "node:url";

const VECTORS = "native/shared/assist-wire-conformance.json";
const SPEC = "lib/api-spec/v1-openapi.yaml";
const GAPS_FILE = "scripts/launch-profile.mjs";
const KOTLIN = "native/android/core/src/main/kotlin/com/signalgrid/assist/core/GateEndpoint.kt";
const RUST = "native/desktop/core/src/endpoint.rs";
// The two SDK READMEs that tell a reader what the gate sends. Both currently say the
// spec "declares no `obligations` field"; the contract-drift sweep (2026-09-01) flagged
// that sentence as an unwatched pairing — every client PARSES `obligations`, no server
// EMITS one, and whichever side moved first the other would go on claiming otherwise.
const READMES = ["native/android/README.md", "native/desktop/README.md"];
const NO_OBLIGATIONS_SENTENCE = /declares no `obligations` field/;
const GAP_ID = "assist-wire-unserved";
const ROUTE_SHAPE = /^\/v1\/[a-z-]+(?:\/[a-z-]+)*$/;

// The served base. The api-server mounts its whole router under this prefix, and the
// OpenAPI `servers` url is the same string, so the route a partner must POST to is
// MOUNT + boundRoute (e.g. `/api/v1/authorize`). The SDK stubs must document that full
// path: a caller who appends the bare `/v1/authorize` to the host reaches a path the
// server does not serve, gets an HTML 404, and AssistWire reads a 404 as DENY — the trap
// iOS hit at DecisionService.swift:74 (BUILD_BACKLOG contract-drift sweep, 2026-09-01).
const APP = "artifacts/api-server/src/app.ts";
const MOUNT = "/api";
const SERVER_URL_LINE = /^\s*-\s*url:\s*\/api\s*$/m;          // OpenAPI servers: - url: /api
const ROUTER_MOUNT = /app\.use\(\s*["']\/api["']\s*,\s*router\s*\)/; // app.use("/api", router)

/**
 * Does the spec's `AssistResult` declare an `obligations` property?
 *
 * Read from the SCHEMA BLOCK, not from the whole document: `obligations` appears in
 * several `x-signalgrid-reason-codes` neighbourhoods and in prose, and a file-wide
 * `includes` would answer yes for a schema that declares nothing of the kind. The block
 * runs from `AssistResult:` to the next sibling schema key at the same indentation.
 */
export function specDeclaresObligations(specYaml) {
  const m = specYaml.match(/^( {4})AssistResult:\n([\s\S]*?)(?=^\1\S)/m);
  if (!m) return null; // anchor drifted — the caller must treat this as fatal
  return /^\s{8}obligations:/m.test(m[2]);
}

export function auditAssistWire({ vectorsJson, specYaml, gapsSrc, kotlinSrc, rustSrc, appSrc = "", readmeSrcs = {} }) {
  const problems = [];
  let vectors;
  try {
    vectors = JSON.parse(vectorsJson);
  } catch {
    return { problems: [`${VECTORS} does not parse — the shared contract is unreadable`], boundRoute: null };
  }
  // FAIL CLOSED on a missing floor, like check-assist-conformance does. This used to
  // default a missing `requires.minCases` to 30 — a floor the file never stated,
  // invented by the gate that was supposed to hold the file to its own.
  const minCases = vectors?.requires?.minCases;
  if (typeof minCases !== "number") {
    problems.push(`${VECTORS} declares no requires.minCases — a file that states no floor for itself cannot be held to one, and this gate will not invent it`);
  } else if (!Array.isArray(vectors?.cases) || vectors.cases.length < minCases) {
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
  // SERVED BASE: the partner POSTs to MOUNT + boundRoute, not to boundRoute on a bare
  // host. Three sources must agree on the `/api` mount, or the SDK path guidance points
  // at a path the server does not serve (a 404 that AssistWire reads as DENY):
  //   · the OpenAPI `servers` url is the mount;
  //   · the api-server actually mounts its router there;
  //   · both SDK stubs document the FULL served path MOUNT + boundRoute.
  const fullServedPath = `${MOUNT}${boundRoute}`; // e.g. /api/v1/authorize
  if (!SERVER_URL_LINE.test(specYaml)) {
    problems.push(`${SPEC} no longer declares \`- url: ${MOUNT}\` under servers — a partner reads the served base from here, and dropping it makes the SDK "append ${boundRoute}" guidance resolve to a path the server does not serve`);
  }
  if (!ROUTER_MOUNT.test(appSrc)) {
    problems.push(`${APP} no longer mounts the router at \`${MOUNT}\` (\`app.use("${MOUNT}", router)\`) — the served base moved, so the spec servers and the SDK path guidance now name a prefix the server does not serve`);
  }
  for (const [name, src] of [["Kotlin GateEndpoint.kt", kotlinSrc], ["Rust endpoint.rs", rustSrc]]) {
    if (!src.includes(fullServedPath)) {
      problems.push(`${name} does not document the full served path \`${fullServedPath}\` — it must tell callers the \`${MOUNT}\` mount is the base, or a partner appends \`${boundRoute}\` to a bare host, gets a 404, and AssistWire denies (the trap iOS hit at DecisionService.swift:74)`);
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
  // OBLIGATIONS: the spec and the SDK docs must agree about a field every client parses
  // and no server sends. Today the spec declares none and both READMEs say so — which is
  // an honest pairing and an unwatched one. Whichever side moves, this fires:
  //   · spec adds `obligations` while a README still says it declares none → stale doc;
  //   · a README drops the sentence while the spec still declares none → an
  //     SDK-documented field no server sends, which is the drift the sweep found.
  // The CLIENTS' tolerance of the field is not touched and must not be: `absent is
  // not-stated, never nothing-required` is a safety rule, not a contract claim.
  const declaresObligations = specDeclaresObligations(specYaml);
  if (declaresObligations === null) {
    problems.push(`could not locate the AssistResult schema block in ${SPEC} — the obligations check's anchor drifted, and a check that cannot find its subject must not read as agreement`);
  } else {
    for (const [name, src] of Object.entries(readmeSrcs)) {
      const saysNone = NO_OBLIGATIONS_SENTENCE.test(src);
      if (declaresObligations && saysNone) {
        problems.push(`${name} still says the spec "declares no \`obligations\` field", but ${SPEC}'s AssistResult now declares one — the SDK doc is stale`);
      } else if (!declaresObligations && !saysNone) {
        problems.push(`${SPEC}'s AssistResult declares no \`obligations\` field and ${name} no longer says so — an SDK-documented field that no server sends is exactly the contract-name drift this row was opened for; either emit it or keep saying it is not emitted`);
      }
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
    appSrc: readFileSync(APP, "utf8"),
    readmeSrcs: Object.fromEntries(READMES.map((f) => [f, readFileSync(f, "utf8")])),
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
  r = auditAssistWire({ ...base, vectorsJson: JSON.stringify({ ...JSON.parse(base.vectorsJson), requires: {} }) });
  checks.push(["vectors that declare NO minCases FAIL (no invented floor)", r.problems.some((x) => x.includes("declares no requires.minCases"))]);
  r = auditAssistWire({ ...base, vectorsJson: JSON.stringify({ ...JSON.parse(base.vectorsJson), route: undefined }) });
  checks.push(["vectors without a route field FAIL (the wire must be data)", r.problems.some((x) => x.includes("no well-formed \"route\""))]);
  // The ENTRY GUARD itself (F12, 2026-09-06). The suffix form ran this gate from any
  // entry whose filename ended with this one's — including a script that only imports
  // it. Needles are escaped, so this assertion is not itself a match.
  {
    const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
    checks.push([
      "the entry guard is EXACT, not a basename suffix match",
      /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/.test(src) &&
        !/import\.meta\.url\.endsWith\(/.test(src),
    ]);
  }

  // OBLIGATIONS, both directions. The committed tree is "spec declares none + both
  // READMEs say so"; each half is inverted against the real files.
  checks.push(["the committed spec's AssistResult declares NO obligations (premise for the two cases below)", specDeclaresObligations(base.specYaml) === false]);
  {
    const specWithObligations = base.specYaml.replace(
      "        decisionId: { type: string }\n        reasons:",
      "        decisionId: { type: string }\n        obligations:\n          type: array\n          items: { type: string }\n        reasons:",
    );
    checks.push(["planting `obligations` into the AssistResult schema is detected by the block reader", specDeclaresObligations(specWithObligations) === true]);
    r = auditAssistWire({ ...base, specYaml: specWithObligations });
    checks.push(["a spec that ADDS obligations while a README says it declares none FAILS (stale SDK doc)", r.problems.some((x) => x.includes("the SDK doc is stale"))]);
  }
  {
    const stripped = Object.fromEntries(
      Object.entries(base.readmeSrcs).map(([k, v]) => [k, v.replace(NO_OBLIGATIONS_SENTENCE, "declares a thing")]),
    );
    r = auditAssistWire({ ...base, readmeSrcs: stripped });
    checks.push(["a README that DROPS the no-obligations sentence while the spec still declares none FAILS", r.problems.some((x) => x.includes("no longer says so"))]);
  }
  {
    r = auditAssistWire({ ...base, specYaml: base.specYaml.replace("    AssistResult:", "    AssistResultRenamed:") });
    checks.push(["an AssistResult block this check cannot FIND is fatal, never silent agreement", r.problems.some((x) => x.includes("anchor drifted"))]);
  }

  // SERVED BASE (`/api` mount), all three sources. The committed tree agrees; each source
  // is drifted against the real files so the exact partner-facing 404/DENY trap is caught.
  checks.push(["the committed spec declares `- url: /api` and app.ts mounts the router there (premise for the three cases below)", SERVER_URL_LINE.test(base.specYaml) && ROUTER_MOUNT.test(base.appSrc)]);
  r = auditAssistWire({ ...base, specYaml: base.specYaml.replace("- url: /api", "- url: /") });
  checks.push(["the OpenAPI servers dropping the `/api` base FAILS", r.problems.some((x) => x.includes("under servers"))]);
  r = auditAssistWire({ ...base, appSrc: base.appSrc.replace('app.use("/api", router)', 'app.use("/", router)') });
  checks.push(["the api-server moving the router off `/api` FAILS", r.problems.some((x) => x.includes("no longer mounts the router"))]);
  r = auditAssistWire({ ...base, kotlinSrc: base.kotlinSrc.replaceAll("/api/v1/authorize", "/v1/authorize") });
  checks.push(["an SDK stub dropping the full `/api/v1/authorize` served-path doc FAILS", r.problems.some((x) => x.includes("full served path"))]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Exact-entry guard, not a basename suffix match: an unrelated entry script that merely
// IMPORTS this module must never trigger the gate, and the suffix form fired for any entry
// whose filename ends with this one's. Reproduced 2026-09-06: a scratch file named
// `check-decision-palette.mjs` that only imported this module ran the whole gate, and the
// same file renamed did not — the gate's scope depended on the caller's filename.
// `check-lab-registry.mjs` diagnosed this exact hazard and fixed it; these two had not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
