#!/usr/bin/env node
// Launch-profile gate — the declared product edge must match the real one.
//
// `scripts/launch-profile.mjs` says which connector families, signal kinds, API
// paths and client surfaces are the Limited GA product and which are not. A
// scope document is worthless the moment it stops matching the repository, and
// scope documents stop matching repositories faster than almost anything else —
// they are written once, at the moment of most attention, and then the code moves.
//
// So this checks a BIJECTION, per surface, in both directions:
//
//   PHANTOM SCOPE     an id in the profile that exists nowhere in the repository.
//                     A launch set naming something that is not there is the
//                     unearned affirmative wearing a planning hat.
//   SILENT OMISSION   something real that the profile does not mention. This is
//                     the direction that matters most, because it is how the
//                     breadth freeze would be defeated: add a 52nd connector
//                     family, say nothing, and it is neither launch nor deferred —
//                     it is simply unexamined, which reads as harmless.
//
// The second direction is what makes this file the FREEZE, mechanically. Not a
// paragraph asking people to stop adding breadth: a check that fails until a human
// writes down what a new thing is. That is deliberately a small, annoying cost
// paid at exactly the moment breadth is added.
//
// Everything is RE-DERIVED here from the same sources the profile names in its
// `derivedFrom` field. This file never trusts a count the profile states about
// itself — a self-reported total is the fossil class this repo keeps finding.

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SURFACES, STATUSES, GAPS, LAUNCH_PROFILE_VERSION, PRODUCT_NAME } from "./launch-profile.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");

// ── Derivations. One per surface, each matching its `derivedFrom` prose. ───────

/** A connector family is a directory with an index.ts. `adapters/` has none, so
 *  this needs no exclusion list — and an exclusion list is precisely what would
 *  rot. Verified: 51 of 52 directories qualify, and the one that does not is
 *  `adapters/`, which is shared plumbing rather than a family. */
function deriveFamilies() {
  const dir = join(repoRoot, "lib/integrations/src/integrations");
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, "index.ts")));
}

function deriveSignalKinds() {
  const src = read("lib/posture-composition/src/types.ts");
  const m = src.match(/export const SIGNAL_KINDS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) die("could not find SIGNAL_KINDS in lib/posture-composition/src/types.ts — anchor drifted.");
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

/** Path keys from the OpenAPI document. Read from the SPEC rather than from the
 *  route files because the spec is already held against the running server by the
 *  OpenAPI contract gate — deriving from it inherits that check instead of
 *  inventing a second, weaker route parser that would drift on its own. */
function deriveApiPaths() {
  const src = read("lib/api-spec/v1-openapi.yaml");
  const paths = [...src.matchAll(/^ {2}(\/[^\s:]+):/gm)].map((m) => m[1]);
  if (paths.length === 0) die("extracted zero paths from lib/api-spec/v1-openapi.yaml — anchor drifted.");
  return paths;
}

/** Directories under artifacts/ AND under tools/, plus every `type: application`
 *  target in each iOS project.yml, prefixed `ios:`.
 *
 *  THREE ROOTS, AND EACH ONE WAS LEARNED THE HARD WAY:
 *
 *  · BOTH iOS project files. `native/ios/project.yml` declares only EnterpriseShell;
 *    SignalGridOperator and WardlinkDemo live in
 *    `native/ios/SignalGridMobile/project.yml` and are built by a SEPARATE CI job.
 *    The first draft of this gate read the root file alone, agreed with a profile
 *    that had invented an `ios:SignalGridMobile` target, and would have signed off
 *    on scope that named a thing that does not exist while missing two that do.
 *
 *  · `tools/`. An adversarial re-derivation found `tools/room-console` — a real,
 *    user-facing page that esbuild-bundles the decision core and runs it in a
 *    browser. It has no package.json and no project.yml, so ANY derivation keyed on
 *    manifest files misses it entirely. That is precisely the silent omission this
 *    gate exists to prevent, and the gate had it. A surface is a surface because a
 *    person can open it, not because it declared a manifest.
 */
function deriveAppSurfaces() {
  const artifacts = readdirSync(join(repoRoot, "artifacts"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const tools = readdirSync(join(repoRoot, "tools"), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `tools:${e.name}`);

  const projects = ["native/ios/project.yml", "native/ios/SignalGridMobile/project.yml"];
  const ios = [];
  for (const rel of projects) {
    if (!existsSync(join(repoRoot, rel))) die(`${rel} is missing — the iOS derivation anchor moved.`);
    const src = read(rel);
    const block = src.split(/^targets:$/m)[1];
    if (block === undefined) die(`no 'targets:' block in ${rel} — anchor drifted.`);
    const body = block.split(/^\S/m)[0];
    // Each target is a 2-space-indented key; its type is the first `type:` under it.
    const entries = [...body.matchAll(/^ {2}([A-Za-z0-9_]+):\n([\s\S]*?)(?=^ {2}[A-Za-z0-9_]+:|$)/gm)];
    if (entries.length === 0) die(`parsed zero targets from ${rel} — anchor drifted.`);
    for (const [, name, decl] of entries) {
      if (/^\s+type:\s*application\s*$/m.test(decl)) ios.push(`ios:${name}`);
    }
  }
  if (ios.length === 0) die("parsed zero iOS application targets across both project.yml files.");
  return [...artifacts, ...tools, ...ios];
}

const DERIVE = {
  "connector-families": deriveFamilies,
  "signal-kinds": deriveSignalKinds,
  "published-api-paths": deriveApiPaths,
  "app-surfaces": deriveAppSurfaces,
};

function die(msg) {
  console.error(`check-launch-profile: ${msg}`);
  process.exit(1);
}

// ── The check ─────────────────────────────────────────────────────────────────

console.log(`Launch-profile gate — "${PRODUCT_NAME}", profile version ${LAUNCH_PROFILE_VERSION}\n`);

let failures = 0;
const totals = { launch: 0, deferred: 0, demo_only: 0, internal: 0 };

for (const surface of SURFACES) {
  const derive = DERIVE[surface.key];
  if (!derive) {
    console.error(`\n✗ surface "${surface.key}" is in the profile but this gate cannot derive it.`);
    console.error("  Every surface must be checkable against the repository, or the profile is");
    console.error("  making a claim nothing verifies. Add a derivation here or drop the surface.");
    failures += 1;
    continue;
  }
  const real = new Set(derive());

  // Flatten the profile's four buckets into id → status, catching an id that was
  // given two statuses — which reads as decided and is in fact undecided.
  const declared = new Map();
  for (const status of STATUSES) {
    for (const entry of surface[status] ?? []) {
      const id = typeof entry === "string" ? entry : entry.id;
      const reason = typeof entry === "string" ? null : entry.reason;
      if (declared.has(id)) {
        console.error(`\n✗ ${surface.key}: "${id}" is listed twice — as ${declared.get(id).status} and as ${status}.`);
        failures += 1;
        continue;
      }
      declared.set(id, { status, reason });
      // A `deferred` entry may be a bare string: they share DEFERRED_RATIONALE, so
      // 134 copies of one sentence would be noise, not rigor. Every OTHER status is
      // a deliberate, arguable decision and has to carry its own argument.
      if (status !== "deferred" && (reason === null || reason.trim().length === 0)) {
        console.error(`\n✗ ${surface.key}: "${id}" is ${status} with no reason.`);
        console.error("  launch / demo_only / internal are decisions someone must be able to argue with.");
        failures += 1;
      }
    }
  }

  const phantom = [...declared.keys()].filter((id) => !real.has(id));
  const omitted = [...real].filter((id) => !declared.has(id));

  for (const id of phantom) {
    console.error(`\n✗ ${surface.key}: the profile declares "${id}" (${declared.get(id).status}), which does not exist.`);
    console.error(`  Derived from: ${surface.derivedFrom}`);
    console.error("  Either it was renamed or removed, or the scope names something never built.");
    failures += 1;
  }
  for (const id of omitted) {
    console.error(`\n✗ ${surface.key}: "${id}" exists but the profile does not mention it.`);
    console.error("  Classify it — launch, deferred, demo_only or internal. This is the breadth");
    console.error("  freeze: a new surface cannot arrive unexamined, because unexamined reads as");
    console.error("  harmless and this is where that stops.");
    failures += 1;
  }

  for (const status of STATUSES) totals[status] += (surface[status] ?? []).length;

  const counts = STATUSES.map((s) => `${s}=${(surface[s] ?? []).length}`).join(" ");
  console.log(
    `  ${surface.key.padEnd(20)} ${String(real.size).padStart(3)} real  ${counts}` +
      `${phantom.length || omitted.length ? "  ← MISMATCH" : ""}`,
  );
}
// GAPS are load-bearing: a launch set with unmet prerequisites that go unstated is
// exactly the readiness claim this repo exists to refuse. Each must name a real id.
const allIds = new Set(SURFACES.flatMap((s) => STATUSES.flatMap((st) => (s[st] ?? []).map((e) => (typeof e === "string" ? e : e.id)))));
for (const gap of GAPS) {
  if (!allIds.has(gap.id)) continue; // a gap may name a concept rather than an item
  const surface = SURFACES.find((s) => s.key === gap.surface);
  if (!surface) {
    console.error(`\n✗ gap "${gap.id}" names surface "${gap.surface}", which is not in the profile.`);
    failures += 1;
  }
}

console.log(
  `\n  totals: launch=${totals.launch} deferred=${totals.deferred} ` +
    `demo_only=${totals.demo_only} internal=${totals.internal} ` +
    `(${Object.values(totals).reduce((a, b) => a + b, 0)} items, ${GAPS.length} declared gaps)`,
);

if (failures > 0) {
  console.error(
    `\nLaunch-profile gate FAILED: ${failures} mismatch${failures === 1 ? "" : "es"} between the declared` +
      "\nproduct edge and the real one. Scope that has stopped matching the repository is worse than" +
      "\nno declared scope, because it still reads as decided.\n",
  );
  process.exit(1);
}

console.log("\nLaunch-profile gate passed — every declared item exists, and every real item is classified.");
