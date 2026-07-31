#!/usr/bin/env node
// Preflight↔CI parity — a gate that runs only locally is not a gate.
//
// scripts/preflight.mjs is described as "a complete mirror of the CI jobs that
// need NOTHING BUT NODE", and its header asks that the two lists be kept "in
// lockstep". But it only ever worried about ONE direction:
//
//     "a proof that runs in CI but not here would let a red build pass preflight"
//
// The reverse gap is worse, and it is the one that had actually opened. SEVEN
// preflight gates ran in no workflow at all — including `review-invariants.mjs`,
// the repo's automated "second reviewer" that encodes the defect classes Codex
// repeatedly caught (fail-closed control flow, determinism, Assist-safety,
// truthfulness), and the FIRST entry in preflight.
//
// A guard that runs in preflight but not in CI does not fail a pull request. So
// the drift it exists to catch lands on the branch unchallenged, while the guard
// keeps reporting green to whoever runs it locally afterwards — it does not even
// leave a red mark to find later. It is the same shape as every other defect this
// repo keeps finding: something that reports success while not doing its job.
//
// This closes it in the direction that was missing: every command preflight runs
// must be referenced by SOME workflow. Being referenced is a weaker claim than
// being run on every PR (a workflow may be scheduled, or gated by paths), but it
// is the strongest claim checkable without executing GitHub's workflow semantics,
// and it catches the real failure — a gate nobody wired up at all.
//
//   node scripts/check-preflight-ci-parity.mjs

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_DIR = join(repo, ".github/workflows");

// Gates that intentionally run ONLY locally. Empty on purpose: every entry here
// is a gate that cannot fail a pull request, so each needs a stated reason rather
// than a silent omission. Add the reason with the entry, or wire the gate up.
const LOCAL_ONLY = new Map([
  // ["some:gate", "why it cannot run in CI"],
]);

const preflight = readFileSync(join(repo, "scripts/preflight.mjs"), "utf8");

// Each STEPS entry is `cmd: ["node", "scripts/x.mjs"]` or `["pnpm", "run", "x"]`.
// Reduce both to the identifying token a workflow would have to mention.
const gates = [];
for (const m of preflight.matchAll(/cmd:\s*\[([^\]]+)\]/g)) {
  const parts = m[1].replace(/["']/g, "").split(",").map((s) => s.trim());
  if (parts[0] === "node" && parts[1]) gates.push(parts[1]);
  else if (parts[0] === "pnpm" && parts[1] === "run" && parts[2]) gates.push(parts[2]);
  // `bash -c "..."` steps embed their own commands; the tokens inside them are
  // matched by the workflow scan below via the script names they invoke, so they
  // are deliberately not reduced to a single key here.
}

const workflows = readdirSync(WORKFLOW_DIR).filter((f) => /\.ya?ml$/.test(f));
const blob = workflows.map((f) => readFileSync(join(WORKFLOW_DIR, f), "utf8")).join("\n");

if (gates.length === 0) {
  console.error(
    "✗ parsed no gates out of scripts/preflight.mjs — the STEPS shape changed, so this\n" +
      "  check is no longer reading it and therefore no longer checking anything.",
  );
  process.exit(1);
}

let problems = 0;
const localOnlyHit = [];

for (const gate of gates) {
  if (blob.includes(gate)) continue;
  if (LOCAL_ONLY.has(gate)) {
    localOnlyHit.push(gate);
    continue;
  }
  console.error(
    `  ✗ ${gate}: runs in preflight but is referenced by NO workflow — it cannot fail a pull request.\n` +
      `      Wire it into .github/workflows/, or add it to LOCAL_ONLY in this file WITH A REASON.`,
  );
  problems += 1;
}

// A stale exemption is its own failure: it quietly re-permits the gap it was
// granted for, and reads as intentional forever after.
for (const [gate, reason] of LOCAL_ONLY) {
  if (blob.includes(gate)) {
    console.error(`  ✗ ${gate}: listed as local-only ("${reason}") but IS now in a workflow — remove the exemption`);
    problems += 1;
  } else if (!gates.includes(gate)) {
    console.error(`  ✗ ${gate}: listed as local-only but is no longer a preflight gate — remove the exemption`);
    problems += 1;
  }
}

console.log(
  `preflight↔CI parity: ${gates.length} preflight gates, ${workflows.length} workflow files, ` +
    `${localOnlyHit.length} declared local-only, ${problems} unwired`,
);

if (problems > 0) {
  console.error(
    "\nPreflight↔CI parity FAILED.\n" +
      "A gate that runs only on a developer's machine does not block anything. It reports\n" +
      "green locally while the drift it guards against sits on the branch.",
  );
  process.exit(1);
}
console.log("Preflight↔CI parity passed — every preflight gate is wired into a workflow.");
