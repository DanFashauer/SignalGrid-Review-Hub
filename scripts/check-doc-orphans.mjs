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
//
// WHY IT WALKS SUBDIRECTORIES (and why it didn't). The first version called
// `readdirSync(docsDir)` with no recursion, so `docs/connectors/*.md`,
// `docs/consolidation/*.md`, `docs/env/*.md` and `docs/preview/README.md` were not
// merely reachable-or-not — they were INVISIBLE. Ten files could never be counted,
// so they could never be reported, so the gate said "no new unreachable documents"
// about a set it had never looked at. Nine of the ten were in fact orphans. That is
// the same defect this repo keeps finding in its own tooling: a green result whose
// scope quietly excluded the failure.
//
// WHY A LINK AND NOT A MENTION (fixed 2026-09-02). Reachability was a SUBSTRING test over
// INDEX.md + README.md, so any occurrence of the filename — in a sentence, in a code
// fence, inside another document's description — scored as a route. That is fail-open in
// the direction that matters: the gate reported "reachable" about documents no reader
// could click to, which is the same green-about-nothing defect recorded below. It now
// parses links (see `parseRoutes`), and `--self-test` proves a prose mention is an orphan.
//
// WHY THE KEY IS A PATH, NOT A FILENAME. Recursion breaks basename matching:
// `docs/consolidation/README.md` and `docs/preview/README.md` share a basename, and
// "README.md" is a substring of practically any index. Matching on the docs-relative
// path (`preview/README.md`) keeps two distinct files distinct, and is how INDEX.md
// already links the one subdirectory doc that was reachable
// (`inspiration/INSPIRATION.md`). For a top-level doc the relative path IS the
// filename, so nothing about the existing 180 changes.

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { maskNonProse } from "./lib/markdown-scope.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const docsDir = join(repoRoot, "docs");
const PIN_PATH = join(repoRoot, "artifacts/sync/doc-orphan-pin.json");

const INDEX_FILES = ["docs/INDEX.md", "README.md"];
const readIndex = (p) => {
  try {
    return readFileSync(join(repoRoot, p), "utf8");
  } catch {
    return "";
  }
};

/**
 * Pure: every docs-relative path an index actually LINKS to, from `from`'s point of view.
 *
 * WHY A PARSE AND NOT A SUBSTRING TEST. This was `indexes.includes(f)` — the filename
 * appearing anywhere in INDEX.md or README.md counted as a route. That is fail-open in the
 * one direction that matters: a document NAMED in a sentence, or listed inside a code
 * fence, or cited as evidence in someone else's description, was scored reachable while no
 * reader could click to it. The comment above the old line argued a mention is "still
 * findable"; it is findable only by grep, and a reader with grep did not need this gate.
 * A route is a link. Three link forms are honoured, all of them clickable:
 *   · inline      [text](PATH)
 *   · reference   [id]: PATH
 *   · autolink    <./PATH> / <docs/PATH>
 * A bare path in prose is not one of them, and is now an orphan.
 *
 * AND NOT EVERY LINK IS A ROUTE. Fenced code blocks, HTML comments and inline code spans
 * are masked before parsing (scripts/lib/markdown-scope.mjs): a link printed as an EXAMPLE
 * in a ``` block, or parked in an <!-- --> comment, is not something a reader can click.
 * Live impact on 2026-09-02 was zero — routes stayed at 298 either way — which is the
 * point: the hole was fixed from a self-test, before the tree fell into it.
 */
export function parseRoutes(rawText, from) {
  const text = maskNonProse(rawText);
  const base = from === "README.md" ? "" : posix.dirname(from);
  const out = new Set();
  const add = (href) => {
    if (!href) return;
    const clean = href.split("#")[0].trim().replace(/^<|>$/g, "");
    if (!clean || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return;
    const abs = posix.normalize(posix.join(base, clean));
    if (abs.startsWith("docs/") && abs.endsWith(".md")) out.add(abs.slice("docs/".length));
  };
  for (const m of text.matchAll(/\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) add(m[1]);
  for (const m of text.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)) add(m[1]);
  for (const m of text.matchAll(/<((?:\.{1,2}\/|docs\/)[^>\s]+\.md)>/g)) add(m[1]);
  return out;
}

const routes = new Set();
for (const f of INDEX_FILES) for (const r of parseRoutes(readIndex(f), f)) routes.add(r);

// ── Self-test ───────────────────────────────────────────────────────────────────
// The defect this file shipped with was invisible because the gate could not fail on it:
// a prose mention scored as a route, so the count was right about the wrong question.
if (process.argv.includes("--self-test")) {
  const sample = [
    "- [Linked](LINKED.md): a real entry.",
    "See PROSE_ONLY.md for the argument, and `[Coded](CODED.md)` below.",
    "",
    "```",
    "- [Fenced](FENCED_LINK.md): what an entry looks like.",
    "```",
    "",
    "<!-- - [Commented](COMMENTED.md): parked until the page lands. -->",
    "- [Nested](sub/NESTED.md): a subdirectory doc.",
    "[ref]: REFERENCED.md",
  ].join("\n");
  const got = parseRoutes(sample, "docs/INDEX.md");
  const cases = [
    ["a linked doc is a route", got.has("LINKED.md"), true],
    ["a doc mentioned only in PROSE is an orphan", got.has("PROSE_ONLY.md"), false],
    // A real LINK inside a fence, not a bare filename: the old case could not tell the
    // masking apart from the "a mention is not a route" rule it already had.
    ["a doc LINKED only inside a code fence is an orphan", got.has("FENCED_LINK.md"), false],
    ["a doc linked only inside an HTML comment is an orphan", got.has("COMMENTED.md"), false],
    ["a doc linked only inside an inline code span is an orphan", got.has("CODED.md"), false],
    ["a nested link keeps its directory", got.has("sub/NESTED.md"), true],
    ["a reference definition is a route", got.has("REFERENCED.md"), true],
    ["README paths resolve from the repo root", parseRoutes("[P](docs/P.md)", "README.md").has("P.md"), true],
  ];
  console.log("Doc-orphan self-test \u2014 a mention is not a route\n");
  let bad = 0;
  for (const [label, actual, expected] of cases) {
    const ok = actual === expected;
    if (!ok) bad += 1;
    console.log(`  ${ok ? "\u2713" : "\u2717"} ${label}`);
  }
  if (bad) {
    console.error(`\n\u2717 Self-test FAILED: ${bad} case(s) wrong \u2014 the parser does not do what this gate claims.`);
    process.exit(1);
  }
  console.log("\nSelf-test passed \u2014 only a clickable link counts as a route.");
  process.exit(0);
}


// Walk docs/ recursively, yielding each .md as a path RELATIVE TO docs/ so a
// nested file keeps its directory ("preview/README.md", not "README.md").
function walk(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.name.endsWith(".md") && rel !== "INDEX.md") out.push(rel);
  }
  return out;
}

const docs = walk(docsDir).sort();
const nested = docs.filter((f) => f.includes("/"));

// Reachable = an index LINKS to it (see parseRoutes above), not merely names it.
const orphans = docs.filter((f) => !routes.has(f));

console.log("Doc-orphan check — every document should be reachable from an index\n");
console.log(`  docs/**/*.md (excluding INDEX): ${docs.length}   (${nested.length} in subdirectories)`);
console.log(`  reachable from an index:        ${docs.length - orphans.length}`);
console.log(`  orphaned:                       ${orphans.length}`);

// SCOPE GUARD. This gate's own failure mode was a silently-shrunken scope: it read
// one directory, found nothing wrong there, and printed a pass. So assert the scope
// before trusting the verdict. If the walk ever stops descending, `nested` goes to
// zero and this fails LOUDLY instead of quietly re-narrowing to docs/*.md.
if (routes.size === 0) {
  console.error(
    "\n\u2717 parsed ZERO links out of docs/INDEX.md and README.md. That says the link PARSER\n" +
      "  broke, not that the indexes emptied \u2014 every document would be reported an orphan on the\n" +
      "  strength of a regex that matched nothing. Refusing to judge.",
  );
  process.exit(1);
}
if (docs.length === 0) {
  console.error("\n✗ walked docs/ and found no .md at all — the detector is broken, not the repo empty.");
  process.exit(1);
}
if (nested.length === 0) {
  console.error(
    "\n✗ found no .md in any docs/ SUBDIRECTORY. Either every subdirectory doc was deleted,\n" +
      "  or the recursive walk regressed to a flat readdir — which is the exact bug that hid\n" +
      "  ten files from this check. Verify by hand before assuming the first explanation.",
  );
  process.exit(1);
}

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
