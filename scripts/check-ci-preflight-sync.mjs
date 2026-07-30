// CI ↔ preflight drift guard — the proof list DERIVED, not trusted.
//
// WHY. `scripts/preflight.mjs` calls itself "a complete mirror of the CI jobs that need
// NOTHING BUT NODE" and asks a human to "keep this list in lockstep". Two hand-maintained
// lists that must agree is a promise, not a mechanism. Adding a proof means remembering
// two files, and forgetting one is silent in both directions:
//
//   IN CI, NOT IN PREFLIGHT   → a red build passes preflight. "Safe to push" is wrong.
//   IN PREFLIGHT, NOT IN CI   → the proof is verified only on a developer's machine,
//                               while every status surface says CI runs the full suite.
//
// BOTH DIRECTIONS HAD ALREADY DRIFTED when this was written. `proof:dual-control` and
// `proof:session-store` ran in preflight and in NO workflow at all — nothing verified
// them anywhere but a laptop. They are in CI now, and this exists so the next one is
// caught by a machine instead of by an audit that happened to look.
//
// This is the same move as `check-guard-registries.mjs` (coverage lists derived rather
// than trusted) and `check-proof-counts.mjs` (documented figures re-measured): a claim
// about coverage is worth exactly as much as the mechanism that re-derives it.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowDir = join(repoRoot, ".github", "workflows");

/**
 * Proofs that legitimately run in CI but CANNOT run in preflight, because they need a
 * service this harness does not start. EXEMPTED BY NAME, in a visible list, with the
 * reason attached — the same discipline the connector-discipline gate uses for its known
 * gaps. A pattern here (`/-pg$/`) would quietly absorb the next unrelated omission.
 *
 * preflight.mjs documents these three in its own header: "durable-persistence
 * (Postgres audit ledger)" is one of the jobs it states it does not mirror.
 */
const CI_ONLY = new Map([
  ["proof:audit-ledger-pg", "needs a live Postgres (CI service container)"],
  ["proof:decision-store-pg", "needs a live Postgres (CI service container)"],
  ["proof:session-store-pg", "needs a live Postgres (CI service container)"],
]);

/**
 * Proofs that legitimately run in preflight but not in CI. EMPTY, deliberately, and it
 * should stay that way: a proof nobody runs in CI is a proof that fails only after merge.
 * Adding an entry here is a decision to accept exactly that, and should be argued for in
 * the commit that adds it rather than discovered later.
 */
const PREFLIGHT_ONLY = new Map();

const PROOF_RE = /pnpm run (proof:[a-z0-9-]+)/g;

function proofsInWorkflows() {
  const found = new Map(); // proof -> Set(workflow files)
  for (const file of readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f))) {
    const text = readFileSync(join(workflowDir, file), "utf8");
    for (const m of text.matchAll(PROOF_RE)) {
      if (!found.has(m[1])) found.set(m[1], new Set());
      found.get(m[1]).add(file);
    }
  }
  return found;
}

function proofsInPreflight() {
  const text = readFileSync(join(repoRoot, "scripts", "preflight.mjs"), "utf8");
  // preflight expresses steps as cmd arrays: ["pnpm", "run", "proof:x"]
  return new Set([...text.matchAll(/"(proof:[a-z0-9-]+)"/g)].map((m) => m[1]));
}

const ci = proofsInWorkflows();
const pf = proofsInPreflight();

console.log("CI ↔ preflight proof-coverage drift check — both lists derived from source\n");

let failures = 0;
const fail = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// NON-VACUITY FIRST, and it is not ceremony. Both sides are read with a regex; if either
// pattern stops matching — a workflow reformats, preflight changes how it spells a step —
// the sets go empty, every comparison below passes, and this gate reports "no drift"
// while checking nothing. That is the exact failure this repository keeps finding, so the
// gate that hunts it must not have it. The floors are far below the real counts (80+ each
// at the time of writing) and exist only to catch a parser that has stopped working.
if (ci.size < 50) fail(`only ${ci.size} proofs found across workflows — the workflow scan is broken, not the repo`);
if (pf.size < 50) fail(`only ${pf.size} proofs found in preflight.mjs — the preflight scan is broken, not the repo`);

const missingFromPreflight = [...ci.keys()].filter((p) => !pf.has(p) && !CI_ONLY.has(p));
const missingFromCi = [...pf].filter((p) => !ci.has(p) && !PREFLIGHT_ONLY.has(p));

for (const p of missingFromPreflight) {
  fail(`${p} runs in CI (${[...ci.get(p)].join(", ")}) but NOT in preflight — a red build would pass "Safe to push"`);
}
for (const p of missingFromCi) {
  fail(`${p} runs in preflight but in NO workflow — it is verified only on a developer machine`);
}

// An exemption that no longer applies is itself drift: it silences a check for something
// that is now covered, and the next reader trusts the list.
for (const [p, why] of CI_ONLY) {
  if (!ci.has(p)) fail(`CI_ONLY lists ${p} ("${why}") but no workflow runs it — stale exemption`);
  else if (pf.has(p)) fail(`CI_ONLY lists ${p} as un-runnable in preflight, but preflight runs it — stale exemption`);
}
for (const [p] of PREFLIGHT_ONLY) {
  if (!pf.has(p)) fail(`PREFLIGHT_ONLY lists ${p} but preflight does not run it — stale exemption`);
}

console.log(`  proofs in workflows:  ${ci.size}`);
console.log(`  proofs in preflight:  ${pf.size}`);
console.log(`  CI-only (exempt, by name): ${CI_ONLY.size} — ${[...CI_ONLY.keys()].join(", ")}`);
console.log(`  preflight-only (exempt):   ${PREFLIGHT_ONLY.size}`);

if (failures > 0) {
  console.error(`\nCI ↔ preflight drift check FAILED (${failures} issue${failures === 1 ? "" : "s"}).`);
  process.exit(1);
}
console.log("\nDrift check passed — every proof runs in both places, or is exempt by name with a reason.");
