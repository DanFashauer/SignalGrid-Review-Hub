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
const covers = (gate, text) => {
  if (!text) return false;
  if (text.includes(gate)) return true;              // by npm name
  const s = scriptPath(scripts[gate]);
  return Boolean(s && text.includes(s));             // by file path
};

const census = gates.map((gate) => {
  const lanes = Object.entries(LANES).filter(([, t]) => covers(gate, t)).map(([n]) => n);
  if (gate.startsWith("proof:live-")) lanes.push("live");
  const ci = workflows.filter(([, t]) => covers(gate, t)).map(([f]) => f.replace(/\.ya?ml$/, ""));
  return { gate, lanes: [...new Set(lanes)], ci };
});

const orphans = census.filter((c) => !c.lanes.length && !c.ci.length && !EXEMPT.has(c.gate));

if (process.argv.includes("--self-test")) {
  // A guard nobody has watched fail is a guard nobody should trust.
  const fake = "check:__no_such_gate__";
  const wouldCatch = !Object.values(LANES).some((t) => t.includes(fake));
  console.log(wouldCatch
    ? "PASS  self-test - a gate present in no lane is detectable"
    : "FAIL  self-test - the census would not notice an unrun gate");
  process.exit(wouldCatch ? 0 : 1);
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
