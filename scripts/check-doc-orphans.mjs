// Doc-orphan check — a document nobody can navigate to is a document nobody reads.
//
//   node scripts/check-doc-orphans.mjs            # report; fail only if orphans GREW
//   node scripts/check-doc-orphans.mjs --update   # accept the current count as the new pin
//
// WHY. `docs/` holds well over a hundred files. An audit found 46 of them
// unreachable from `docs/INDEX.md` or `README.md` — including the branch policy
// that governs this repo's own branch hygiene. Nothing was broken; the docs were
// simply invisible, which is the failure mode that never announces itself. A
// reader who cannot find the policy behaves exactly like a reader for whom the
// policy does not exist.
//
// WHY A RATCHET AND NOT A HARD GATE. Failing on any orphan would mean either
// breaking CI today or hand-linking 46 files in one pass — and a one-pass link
// dump produces exactly the uncurated filler this index exists to avoid. So the
// pin below is a CEILING that may only fall. New docs must be reachable; the
// existing backlog gets drained deliberately rather than in a single sweep.
//
// The pin is a number, not a list of filenames, on purpose: a list would need
// updating for every rename, and would go stale the way the hand-maintained
// coverage registries elsewhere in this repo did before they were derived.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "docs");
const PIN_PATH = join(repoRoot, "artifacts/sync/doc-orphan-pin.json");

const indexes = ["docs/INDEX.md", "README.md"]
  .map((p) => {
    try {
      return readFileSync(join(repoRoot, p), "utf8");
    } catch {
      return "";
    }
  })
  .join("\n");

const docs = readdirSync(docsDir)
  .filter((f) => f.endsWith(".md") && f !== "INDEX.md")
  .sort();

// Reachable = the filename appears in an index. Deliberately a substring test
// rather than a Markdown-link parse: a doc referenced from a code fence or a
// table cell is still findable, and a stricter parse would report false orphans.
const orphans = docs.filter((f) => !indexes.includes(f));

console.log("Doc-orphan check — every document should be reachable from an index\n");
console.log(`  docs/*.md (excluding INDEX):  ${docs.length}`);
console.log(`  reachable from an index:      ${docs.length - orphans.length}`);
console.log(`  orphaned:                     ${orphans.length}`);

let pin = null;
try {
  pin = JSON.parse(readFileSync(PIN_PATH, "utf8"));
} catch {
  /* first run — established below */
}

if (process.argv.includes("--update") || pin === null) {
  writeFileSync(PIN_PATH, `${JSON.stringify({ maxOrphans: orphans.length }, null, 2)}\n`);
  console.log(`\n  pin set: maxOrphans=${orphans.length}`);
  if (orphans.length > 0) {
    console.log("  Orphans (link these into docs/INDEX.md to lower the pin):");
    for (const o of orphans) console.log(`    · ${o}`);
  }
  process.exit(0);
}

if (orphans.length > pin.maxOrphans) {
  console.error(`\n✗ Orphaned docs GREW: ${orphans.length} > pinned ceiling ${pin.maxOrphans}.`);
  console.error("  A new document was added without a route to it. Link it from docs/INDEX.md");
  console.error("  (or README.md). Current orphans:");
  for (const o of orphans) console.error(`    · ${o}`);
  process.exit(1);
}

if (orphans.length < pin.maxOrphans) {
  console.log(
    `\n  Orphans fell from ${pin.maxOrphans} to ${orphans.length}. Re-run with --update to ` +
      "lower the ceiling so the improvement cannot be undone.",
  );
} else {
  console.log(`\n  At the pinned ceiling (${pin.maxOrphans}). Not growing.`);
}

if (orphans.length > 0) {
  console.log("\n  Still unreachable:");
  for (const o of orphans) console.log(`    · ${o}`);
}

console.log("\nDoc-orphan check passed — no new unreachable documents.");
