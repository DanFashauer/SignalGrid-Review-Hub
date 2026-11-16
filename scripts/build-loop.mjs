#!/usr/bin/env node
// SignalGrid build feedback loop — the development process, encoded as a runnable
// harness instead of session memory.
//
//   node scripts/build-loop.mjs            # one iteration: run gates → findings + fix list
//   node scripts/build-loop.mjs --fix      # apply allowlisted mechanical fixes and re-run until converged
//   node scripts/build-loop.mjs --full     # include the heavy proof suite (preflight) in the gate set
//
// WHY. Building this product safely follows one loop: build → verify with the
// SAME gates CI runs → identify every issue → fix → re-verify → only then ship.
// Doing that from memory is fragile; this script IS the loop. Each run:
//
//   1. Executes the fast gate suite (identical commands to CI/preflight — it
//      shells out, never re-implements, so it can never drift from them).
//   2. Turns every failure into a structured FINDING with the exact fix path:
//      either a mechanical fix this script may apply itself (allowlisted,
//      deterministic regeneration only) or a human/agent fix instruction.
//   3. With --fix, applies the allowlisted fixes and re-runs, up to MAX_ITERS,
//      until green or until no fixable finding remains (no infinite loop, no
//      "fixed" claim without a green re-run to prove it).
//   4. Appends every iteration to artifacts/build-loop/history.jsonl so the
//      loop's convergence is EVIDENCED, not asserted.
//
// Honesty rules (same law as status-summary/self-audit): a gate that was asked
// to run but couldn't spawn is a FAILURE, not "skipped"; nothing is reported
// fixed unless the re-run proves it; the allowlist can only contain fixes that
// are pure regeneration of derived state — a fix that changes behavior or
// policy is NEVER auto-applied, it is reported for review (the same governed
// principle as self-audit heals and IaC rollouts: the loop cannot approve
// itself into a behavior change).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const applyFixes = process.argv.includes("--fix");
const full = process.argv.includes("--full");
const MAX_ITERS = 5;

// ── The gate set (identical commands to CI / preflight) ──────────────────────
// Each gate may name ONE mechanical fix. `mechanicalFix` commands must be pure
// regeneration of derived artifacts (manifests, generated collections) — never
// source, policy, tests, or docs-as-claims.
const GATES = [
  {
    name: "Invariants (fail-closed / determinism / Assist / truth)",
    cmd: ["node", "scripts/review-invariants.mjs"],
    hint: "A core invariant is broken. Fix the offending source — never the checker.",
  },
  {
    name: "Docs sanity (required docs + unsafe-claim scan)",
    cmd: ["node", "scripts/docs-sanity.mjs"],
    hint: "A required doc is missing or an over-claim crept in. Correct the doc text.",
  },
  {
    name: "Guard-registry drift",
    cmd: ["node", "scripts/check-guard-registries.mjs"],
    hint: "A proof/figure exists that no registry accounts for. Add it to the registry it belongs to.",
  },
  {
    name: "Docs↔proof FIGURE guard",
    cmd: ["node", "scripts/check-proof-figures.mjs"],
    hint: "A number quoted in docs no longer matches the live proof. Update the doc to the proof's real figure.",
  },
  {
    name: "Proof-count sync",
    cmd: ["node", "scripts/check-proof-counts.mjs"],
    hint: "A documented '(N checks)' disagrees with the proof's real total. Update the doc count.",
  },
  {
    name: "Live-sync manifest",
    cmd: ["node", "scripts/check-live-sync.mjs"],
    mechanicalFix: {
      cmd: ["node", "scripts/generate-sync-manifest.mjs"],
      describe: "regenerate artifacts/sync/live-sync-manifest.json (pure derived state)",
    },
    hint: "Contracts changed without republishing the manifest.",
  },
  {
    name: "Postman collection sync",
    cmd: ["node", "scripts/build-postman.mjs", "--check"],
    mechanicalFix: {
      cmd: ["node", "scripts/build-postman.mjs"],
      describe: "regenerate the Postman collection from the OpenAPI spec (pure derived state)",
    },
    hint: "The OpenAPI spec changed without regenerating the collection.",
  },
  {
    name: "Typecheck (all packages)",
    cmd: ["pnpm", "run", "typecheck"],
    hint: "A type error. Read the first error and fix the source it points at.",
  },
  {
    name: "Preflight (typecheck, build, all proofs, browser E2E)",
    cmd: ["node", "scripts/preflight.mjs"],
    skip: !full,
    skipReason: "heavy — re-run with --full",
    hint: "A proof or build failed. Run the named proof directly for the failing check list.",
  },
];

function runGate(gate) {
  if (gate.skip) return { name: gate.name, status: "not run", detail: gate.skipReason ?? "" };
  const r = spawnSync(gate.cmd[0], gate.cmd.slice(1), { cwd: repoRoot, encoding: "utf8", timeout: 45 * 60_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error) return { name: gate.name, status: "FAIL", detail: `could not run: ${r.error.message}` };
  const lastLines = out.trim().split("\n").filter(Boolean).slice(-3).join(" | ");
  return { name: gate.name, status: r.status === 0 ? "pass" : "FAIL", detail: r.status === 0 ? "" : lastLines };
}

function runIteration(iter) {
  const results = GATES.map(runGate);
  const findings = results
    .filter((r) => r.status === "FAIL")
    .map((r) => {
      const gate = GATES.find((g) => g.name === r.name);
      return {
        gate: r.name,
        detail: r.detail,
        fixable: !!gate?.mechanicalFix,
        fix: gate?.mechanicalFix ? gate.mechanicalFix.describe : gate?.hint ?? "investigate the gate output",
      };
    });
  return { iteration: iter, at: new Date().toISOString(), results, findings };
}

function applyMechanicalFixes(findings) {
  const applied = [];
  for (const f of findings) {
    if (!f.fixable) continue;
    const gate = GATES.find((g) => g.name === f.gate);
    const fix = gate.mechanicalFix;
    const r = spawnSync(fix.cmd[0], fix.cmd.slice(1), { cwd: repoRoot, encoding: "utf8", timeout: 10 * 60_000 });
    applied.push({ gate: f.gate, fix: fix.describe, ok: r.status === 0 });
  }
  return applied;
}

// ── The loop ─────────────────────────────────────────────────────────────────
const historyDir = path.join(repoRoot, "artifacts/build-loop");
fs.mkdirSync(historyDir, { recursive: true });
const historyPath = path.join(historyDir, "history.jsonl");

const iterations = [];
let iter = 1;
for (;;) {
  const record = runIteration(iter);
  iterations.push(record);
  fs.appendFileSync(historyPath, JSON.stringify(record) + "\n");

  if (record.findings.length === 0) break; // converged green
  if (!applyFixes) break; // report-only mode: one iteration
  const fixable = record.findings.filter((f) => f.fixable);
  if (fixable.length === 0) break; // nothing this loop may touch — humans/agents fix, then re-run
  if (iter >= MAX_ITERS) break; // bounded: never loop forever

  const applied = applyMechanicalFixes(record.findings);
  fs.appendFileSync(historyPath, JSON.stringify({ iteration: iter, appliedFixes: applied }) + "\n");
  iter += 1;
}

// ── Report ───────────────────────────────────────────────────────────────────
const last = iterations[iterations.length - 1];
const green = last.findings.length === 0;
// A SKIP IS NOT A PASS, AND THE HEADLINE IS WHERE THAT GETS READ (fixed 2026-09-06).
// Without `--full` the Preflight gate carries `skip: true`, so it never runs, produces no
// finding, and the headline read a flat "GREEN" over the heaviest gate in the list. This
// file's own honesty rules say "a gate that was asked to run but couldn't spawn is a
// FAILURE, not 'skipped'" — honoured for spawn errors and not for declared skips — and
// CLAUDE.md says the same thing about the macOS harness: "compare M against 0 AND read
// S — a skip is not a pass". The verdict now carries the number, so the word GREEN can
// never stand alone over a gate nobody ran.
const notRun = last.results.filter((r) => r.status === "not run");
const verdict = green ? (notRun.length === 0 ? "GREEN" : `GREEN over ${last.results.length - notRun.length} of ${last.results.length} gates — ${notRun.length} NOT RUN`) : "RED";
const L = [];
L.push(`# Build loop — ${verdict} after ${iterations.length} iteration(s)`);
L.push("");
if (notRun.length > 0) {
  L.push(`> ${notRun.length} gate(s) did not run and are not evidence of anything: ${notRun.map((r) => `${r.name} (${r.detail})`).join("; ")}.`);
  L.push("");
}
for (const r of last.results) {
  const icon = r.status === "pass" ? "✅" : r.status === "FAIL" ? "❌" : "⚪";
  L.push(`${icon} ${r.name}${r.status === "not run" ? ` (${r.detail})` : ""}`);
}
if (!green) {
  L.push("");
  L.push(`## Findings to fix (${last.findings.length})`);
  for (const f of last.findings) {
    L.push(`- **${f.gate}**${f.fixable ? " [mechanical — rerun with --fix]" : ""}`);
    L.push(`  - fix: ${f.fix}`);
    if (f.detail) L.push(`  - output: ${f.detail.slice(0, 200)}`);
  }
  L.push("");
  L.push(`After fixing, re-run \`node scripts/build-loop.mjs\` — nothing counts as fixed until the re-run is green.`);
}
L.push("");
L.push(`History: artifacts/build-loop/history.jsonl (${iterations.length} iteration(s) appended this run)`);
console.log(L.join("\n"));
process.exitCode = green ? 0 : 1;
