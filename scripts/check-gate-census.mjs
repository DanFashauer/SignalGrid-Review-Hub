// Gate census - every gate, every prefix, must run somewhere.
//
//   node scripts/check-gate-census.mjs              the guard
//   node scripts/check-gate-census.mjs --report     full coverage table
//   node scripts/check-gate-census.mjs --self-test  prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// check-ci-preflight-sync.mjs guards `proof:` gates and holds preflight and the
// breadth lane disjoint and jointly complete. It is good, and it is scoped:
//
//     const PROOF_RE = /pnpm run (proof:[a-z0-9-]+)/g;
//
// Nothing guarded `check:`, `guard:`, `verify:`, `review:` or `test:` - 35 gates
// whose registration no machine verified. Three were invoked by no lane and no
// workflow: check:postman, verify:ledger-export, test:stress. Nobody deleted
// them; they simply stopped being invoked and nothing noticed. Of the three,
// only check:postman turned out to be a gate - the guard forced that judgement
// instead of letting all three rot equally.
//
// THE MATCHING RULE THAT MATTERS
// ------------------------------
// A gate is invoked TWO ways in this repo, and an audit that knows only one is
// worse than none:
//
//     pnpm run check:doc-orphans          <- by npm script name
//     node scripts/check-doc-orphans.mjs  <- by file path (how preflight does it)
//
// Matching names only reported 67 false orphans on 2026-08-27; a second pass
// reported 28. Both were wrong, and both looked authoritative. This guard
// resolves each gate to its underlying script and matches EITHER form.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => (existsSync(resolve(repo, p)) ? readFileSync(resolve(repo, p), "utf8") : "");

// Gates deliberately not wired to a lane. Every entry needs a reason - an
// exemption list without reasons is how a guard becomes a rubber stamp.
const EXEMPT = new Map([
  [
    "verify:ledger-export",
    "OPERATOR CLI, not a gate. It verifies an export FILE supplied by an " +
      "assessor (`-- ledger.ndjson`) and exits 2 - refused - when run with no " +
      "argument. Its whole point is running where the data is, on a laptop or " +
      "in cold storage, not in this repo's CI. Wiring it to a lane would run it " +
      "against nothing and assert nothing.",
  ],
  [
    "test:stress",
    "DIAGNOSTIC, not a gate. It ramps until degradation and reports where that " +
      "begins; by its own header it 'does not claim a threshold', so there is " +
      "nothing for CI to pass or fail. The gate for this surface is `test:load`, " +
      "which asserts correctness under concurrency and already runs in preflight " +
      "(heavy) and in CI. Run this by hand when investigating capacity.",
  ],
]);

const GATE_RE = /^(proof|check|guard|review|verify|test):/;

const scripts = JSON.parse(read("package.json") || "{}").scripts ?? {};
const gates = Object.keys(scripts).filter((k) => GATE_RE.test(k));

// The lanes a gate may legitimately run in.
const LANES = {
  preflight: read("scripts/preflight.mjs"),
  breadth: read("scripts/verify-breadth.mjs"),
  live: read("scripts/run-live-lanes.sh"),
  mac: read("validate-sim-macos.sh") + read("scripts/mac/run-everything.sh"),
};
const wfDir = resolve(repo, ".github/workflows");
const workflows = existsSync(wfDir)
  ? readdirSync(wfDir).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, read(`.github/workflows/${f}`)])
  : [];

const scriptPath = (cmd) => cmd.match(/scripts\/[\w/-]+\.(mjs|cjs|js|ts|sh)/)?.[0] ?? null;

// By-name matching requires the gate in a RUN POSITION — the argument of
// `pnpm run` / `$PNPM run` / `npm run` — not anywhere in the text. Fixed
// 2026-08-31 (ECC first-pass finding #2): bare `text.includes(gate)` counted
// `skip "proof:live-fleet" "..."` as coverage, so a gate named only in its
// own skip branch reported as running somewhere. By-path matching stays
// plain inclusion ON PURPOSE: preflight and the workflows register scripts
// by listing their paths, and the listing IS the invocation there.
const invokesByName = (gate, text) => {
  const g = gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Shell form: `pnpm run <gate>` / `$PNPM run <gate>`, flags allowed.
  const shell = new RegExp(
    String.raw`(?:\$PNPM|pnpm|npm)(?:\s+--?[\w-]+(?:=\S+)?)*\s+run\s+(?:--?[\w-]+\s+)*${g}(?![\w:-])`,
  );
  // Argv-array form: `["pnpm", "run", "proof:x"]` — how verify-breadth.mjs
  // registers its gates. The three tokens must be adjacent; a gate name
  // quoted alone (a skip message, a comment) still does not count.
  const argv = new RegExp(
    String.raw`["']pnpm["']\s*,\s*["']run["']\s*,\s*["']${g}["']`,
  );
  return shell.test(text) || argv.test(text);
};
const covers = (gate, text) => {
  if (!text) return false;
  if (invokesByName(gate, text)) return true;        // by npm name, run position
  const s = scriptPath(scripts[gate] ?? "");
  return Boolean(s && text.includes(s));             // by file path (registration)
};

// No lane is credited unconditionally. The previous version pushed "live"
// for every proof:live-* gate without reading run-live-lanes.sh (ECC
// first-pass finding #3): a proof:live-foo registered in package.json and
// invoked nowhere — or the live runner deleted outright — still reported
// covered. LANES.live is consulted like every other lane now.
// The mac harness runs every proof:* gate through a DYNAMIC enumeration of
// package.json (validate-sim-macos.sh, the `startsWith('proof:')` loop), so
// individual proof names never appear there in run position. Credit the mac
// lane for proof:* gates ONLY while that mechanism is verifiably present in
// the file — a mechanism check, not a blanket assumption; delete the loop
// and the credit disappears with it.
const MAC_ENUMERATES_PROOFS = /startsWith\((['"])proof:\1\)/.test(LANES.mac);

const census = gates.map((gate) => {
  const lanes = Object.entries(LANES).filter(([, t]) => covers(gate, t)).map(([n]) => n);
  if (gate.startsWith("proof:") && MAC_ENUMERATES_PROOFS) lanes.push("mac");
  const ci = workflows.filter(([, t]) => covers(gate, t)).map(([f]) => f.replace(/\.ya?ml$/, ""));
  return { gate, lanes: [...new Set(lanes)], ci };
});

const orphans = census.filter((c) => !c.lanes.length && !c.ci.length && !EXEMPT.has(c.gate));

if (process.argv.includes("--self-test")) {
  // A guard nobody has watched fail is a guard nobody should trust — and the
  // previous self-test could not fail (ECC first-pass finding #4): it asked
  // whether a made-up name appears in any lane file, which is true even with
  // every lane file deleted, and never called covers() at all. This one runs
  // the real code path and asserts it can say UNCOVERED.
  const failures = [];

  // 1. A gate the census reports covered must read UNCOVERED when every lane
  //    and workflow text is blanked — coverage must come from the text.
  const covered = census.find((c) => c.lanes.length || c.ci.length);
  if (!covered) {
    failures.push("no covered gate exists to test with (census is empty?)");
  } else if (covers(covered.gate, "")) {
    failures.push(`covers("${covered.gate}", "") returned true on empty text`);
  }

  // 2. A skip-line mention must NOT count as an invocation.
  if (covers("proof:live-fleet", 'skip "proof:live-fleet" "could not stand up Fleet"')) {
    failures.push("a skip-line mention counted as coverage");
  }

  // 3. A real run-position invocation MUST count — the guard can also pass.
  if (!invokesByName("proof:live-fleet", "$PNPM run proof:live-fleet >/tmp/x.log 2>&1")) {
    failures.push("a real '$PNPM run' invocation was not recognised");
  }

  // 4. A gate name that PREFIXES another must not borrow its coverage.
  if (invokesByName("proof:live", "$PNPM run proof:live-fleet")) {
    failures.push("prefix gate name matched a longer gate's invocation");
  }

  if (failures.length) {
    console.log("FAIL  self-test:");
    for (const f of failures) console.log(`      - ${f}`);
    process.exit(1);
  }
  console.log("PASS  self-test - covers() distinguishes invocation from mention, and coverage disappears when the lane text does");
  process.exit(0);
}

if (process.argv.includes("--report")) {
  const byPrefix = {};
  for (const c of census) {
    const p = c.gate.split(":")[0];
    byPrefix[p] ??= { total: 0, covered: 0 };
    byPrefix[p].total++;
    if (c.lanes.length || c.ci.length || EXEMPT.has(c.gate)) byPrefix[p].covered++;
  }
  console.log(`\nGate census - ${gates.length} gates\n`);
  for (const [p, v] of Object.entries(byPrefix).sort((a, b) => b[1].total - a[1].total)) {
    const gap = v.total - v.covered;
    console.log(`  ${String(v.covered).padStart(4)}/${String(v.total).padEnd(4)} ${p}:${gap ? `   ${gap} unrun` : ""}`);
  }
  console.log("");
  process.exit(0);
}

if (orphans.length) {
  console.error(`x ${orphans.length} gate(s) run in no lane and no workflow:\n`);
  for (const o of orphans) console.error(`    ${o.gate}\n      ${scripts[o.gate]}`);
  console.error(`
A gate that runs nowhere is not a gate - it is a script that used to be one.
Register it in preflight, the breadth lane, a workflow, or the Mac/live lane;
delete it; or add it to EXEMPT in this file with the reason it must not run.

Checked ${gates.length} gates across every prefix (proof, check, guard, review,
verify, test), matching BOTH invocation styles: 'pnpm run <name>' and the
underlying 'scripts/<file>'. Matching only one style is how an audit reports
67 orphans that do not exist.
`);
  process.exit(1);
}

console.log(
  `OK Gate census - all ${gates.length} gates run somewhere ` +
    `(${EXEMPT.size} exempt by name with a reason).`,
);
