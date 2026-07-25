// Docs↔proof count guard.
//
// The docs advertise how many checks each proof runs — e.g. "`pnpm run
// proof:pacs-access` (68 checks)". Those numbers are evidence, and evidence that
// silently drifts is worse than no evidence: a reader trusts a number that is no
// longer true. Every time a proof gains an assertion, its documented count must move
// with it.
//
// This scans docs/ for that pattern, runs each referenced proof, and fails if any
// documented count disagrees with the count the proof actually reports. It is the
// same discipline as the Postman/OpenAPI drift check, applied to proof evidence.

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "docs");

// Matches: `proof:<name>` (<N> checks   — tolerating an optional backtick/paren.
const PATTERN = /proof:([a-z0-9-]+)`?\s*\((\d+)\s+checks/g;

const claims = new Map(); // proofName -> { count, files:Set }
for (const file of readdirSync(docsDir).filter((f) => f.endsWith(".md"))) {
  const text = readFileSync(join(docsDir, file), "utf8");
  for (const m of text.matchAll(PATTERN)) {
    const [, name, count] = m;
    const existing = claims.get(name);
    if (existing && existing.count !== Number(count)) {
      console.error(
        `✗ docs disagree with each other: proof:${name} is documented as both ${existing.count} and ${count} checks`,
      );
      process.exitCode = 1;
    }
    if (!existing) claims.set(name, { count: Number(count), files: new Set([file]) });
    else existing.files.add(file);
  }
}

if (claims.size === 0) {
  console.log("Proof-count check: no documented counts found (nothing to verify).");
  process.exit(0);
}

let failures = 0;
for (const [name, { count, files }] of [...claims].sort()) {
  const run = spawnSync("pnpm", ["run", `proof:${name}`], {
    cwd: repoRoot,
    encoding: "utf8",
    // Proofs are offline and fast; a generous per-proof ceiling still bounds the gate.
    timeout: 120_000,
  });
  const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const summary = output.match(/summary=(pass|fail) \((\d+)\/(\d+)\)/);
  if (!summary) {
    console.error(`✗ proof:${name} — could not read a summary line (did the proof fail to run?)`);
    failures += 1;
    continue;
  }
  const [, verdict, passed, total] = summary;
  if (verdict !== "pass") {
    console.error(`✗ proof:${name} — proof itself is failing (${passed}/${total})`);
    failures += 1;
    continue;
  }
  if (Number(total) !== count) {
    console.error(
      `✗ proof:${name} — docs say ${count} checks, proof reports ${total}` +
        ` (update: ${[...files].join(", ")})`,
    );
    failures += 1;
  } else {
    console.log(`  ✓ proof:${name} — ${total} checks, matches docs`);
  }
}

if (failures > 0) {
  console.error(`\nProof-count check FAILED: ${failures} documented count(s) out of sync.`);
  process.exit(1);
}
console.log(`\nProof-count check passed — all ${claims.size} documented counts match their proofs.`);
