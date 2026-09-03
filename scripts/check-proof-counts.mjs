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
//
//   node scripts/check-proof-counts.mjs              # the gate
//   node scripts/check-proof-counts.mjs --self-test  # prove the gate can fail
//
// NON-VACUITY FLOOR, added 2026-09-02. The old code exited 0 with "nothing to
// verify" the moment the claim regex matched zero — so a docs reformat from
// "(N checks" to "(N assertions" would silence this gate entirely and it would
// report success over a docset it had stopped reading. That is the exact shape
// this repository keeps finding: a scan that scans nothing and calls it green.
// The floor is far below the real count (58 unique proofs at the time of
// writing) and exists only to catch a parser that has stopped matching.

import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "docs");

// Matches: `proof:<name>` (<N> checks   — tolerating an optional backtick/paren.
const PATTERN = /proof:([a-z0-9-]+)`?\s*\((\d+)\s+checks/g;

// Far below the ~58 unique documented proofs today; a count under this means the
// scan is broken, not that the docs stopped documenting proof counts.
const CLAIM_FLOOR = 20;

/** Parse "(N checks)" claims from a corpus of `[relPath, text]` docs. Pure so
 *  the self-test can feed it synthetic input without touching the filesystem. */
export function parseClaims(docs) {
  const claims = new Map(); // proofName -> { count, files:Set }
  const disagreements = [];
  for (const [file, text] of docs) {
    for (const m of text.matchAll(PATTERN)) {
      const [, name, count] = m;
      const existing = claims.get(name);
      if (existing && existing.count !== Number(count)) {
        disagreements.push(`proof:${name} is documented as both ${existing.count} and ${count} checks`);
      }
      if (!existing) claims.set(name, { count: Number(count), files: new Set([file]) });
      else existing.files.add(file);
    }
  }
  return { claims, disagreements };
}

function readDocs() {
  // RECURSIVE on purpose (D3): moved docs stay inside guard scope.
  return readdirSync(docsDir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"))
    .map((f) => [f, readFileSync(join(docsDir, f), "utf8")]);
}

function selfTest() {
  const checks = [];

  // The pattern must extract a documented count.
  const good = parseClaims([["a.md", "`pnpm run proof:pacs-access` (68 checks)"]]);
  checks.push(["the pattern extracts a documented count", good.claims.get("pacs-access")?.count === 68]);

  // A reformat away from the word "checks" must match NOTHING — which is exactly
  // why the floor exists: silence must read as broken, not as green.
  const reworded = parseClaims([["a.md", "`pnpm run proof:pacs-access` (68 assertions)"]]);
  checks.push(["a '(N assertions)' reformat matches nothing", reworded.claims.size === 0]);

  // Two docs disagreeing is caught.
  const clash = parseClaims([
    ["a.md", "proof:x (10 checks)"],
    ["b.md", "proof:x (11 checks)"],
  ]);
  checks.push(["docs disagreeing on a count is flagged", clash.disagreements.length === 1]);

  // THE FLOOR CAN FAIL: a below-floor claim count is fatal. Zero claims — the
  // silenced-gate case — is below the floor and therefore RED.
  checks.push(["zero documented claims is below the floor (RED)", 0 < CLAIM_FLOOR]);
  checks.push([`the floor is a real bar (${CLAIM_FLOOR} > 0)`, CLAIM_FLOOR > 0]);

  // LIVE: the real docset must clear the floor, or the parser has drifted.
  const live = parseClaims(readDocs());
  checks.push([`LIVE: the real docset has ${live.claims.size} documented proof counts (floor ${CLAIM_FLOOR})`, live.claims.size >= CLAIM_FLOOR]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const { claims, disagreements } = parseClaims(readDocs());
for (const d of disagreements) {
  console.error(`✗ docs disagree with each other: ${d}`);
  process.exitCode = 1;
}

if (claims.size < CLAIM_FLOOR) {
  console.error(
    `✗ Proof-count check: only ${claims.size} documented "(N checks)" claim(s) found (floor ${CLAIM_FLOOR}).\n` +
      "  The scan is broken, not the repo — a docs reformat away from the word \"checks\" would\n" +
      "  otherwise silence this gate. Fix the pattern or restore the documented counts.",
  );
  process.exit(1);
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
