// Publication-boundary gate — the split declared in NOTICE and docs/REPO_LINEAGE.md,
// enforced instead of remembered.
//
//   node scripts/check-publication-boundary.mjs
//
// FOUR DIRECTIONS. The first is the mechanism; the rest keep it honest.
//
//   A. COVERAGE (the boundary itself). Every tracked path must fall under a declared
//      area. An unclassified path is RED. This is the only property that makes the
//      boundary a gate: new surface cannot arrive without a human classifying it.
//
//   B. PHANTOM AREAS. Every declared area must cover at least one tracked path.
//      A rule matching nothing is a rule that has stopped doing anything, and a
//      coverage count computed over dead rules reads as reassurance it hasn't earned.
//
//   C. REPUBLICATION. Every reproduced-whole document (PDF/DOCX/…) must carry a
//      stated licence basis. `basis: null` fails and is NAMED — an unanswered
//      licensing question about a public artifact is not a pass.
//
//   D. CONTENT. A short, self-controlled set of shapes that are breaches regardless
//      of which area they appear in.
//
// DERIVATION IS FROM `git ls-files`, NOT FROM DISK — deliberately, and the reason is
// on the record: the launch-profile gate first read the filesystem, counted two
// gitignored build directories, passed locally with 20 app surfaces and failed CI
// with 19. A gate whose input differs between environments is not a gate.
//
// DETECTOR SELF-CONTROLS run on every invocation, before any scanning. A content
// rule whose regex has quietly stopped matching would otherwise report "clean"
// forever — the exact failure `scripts/check-guard-registries.mjs` was built for,
// here applied to a scanner rather than to a registry. If a control disagrees with
// its rule, this gate fails LOUDLY and scans nothing, because at that point it does
// not know what it is measuring.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AREAS,
  BOUNDARY_VERSION,
  CLASSES,
  CONTENT_EXEMPT,
  CONTENT_RULES,
  REPUBLICATION_FORMATS,
  THIRD_PARTY_DISPOSITIONS,
} from "./publication-boundary.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg) {
  console.error(`\npublication-boundary: ${msg}`);
  process.exit(1);
}

/** Tracked paths, from git. Refuses to guess if git cannot answer. */
function trackedFiles() {
  const run = spawnSync("git", ["ls-files", "-z"], { cwd: repoRoot, encoding: "buffer" });
  if (run.status !== 0) die("`git ls-files` failed; refusing to derive the surface from disk.");
  return run.stdout.toString("utf8").split("\0").filter(Boolean);
}

/** A path is under an area if it IS the area or sits beneath it. */
const under = (file, area) => file === area || file.startsWith(`${area}/`);

console.log(`Publication-boundary gate — v${BOUNDARY_VERSION}, the split enforced rather than remembered\n`);

let failures = 0;

// ── DETECTOR SELF-CONTROLS (before anything is scanned) ──────────────────────
const controlFailures = [];
for (const rule of CONTENT_RULES) {
  for (const s of rule.controls.mustMatch) {
    if (!rule.pattern.test(s)) controlFailures.push(`${rule.id}: FAILED to match a string it must catch — ${JSON.stringify(s)}`);
  }
  for (const s of rule.controls.mustNotMatch) {
    if (rule.pattern.test(s)) controlFailures.push(`${rule.id}: matched a string it must ignore — ${JSON.stringify(s)}`);
  }
}
if (controlFailures.length > 0) {
  console.error("✗ DETECTOR SELF-CONTROLS FAILED. Not scanning: this gate does not know what it measures.\n");
  for (const f of controlFailures) console.error(`    ${f}`);
  die(`${controlFailures.length} control failure(s).`);
}
const controlCount = CONTENT_RULES.reduce((n, r) => n + r.controls.mustMatch.length + r.controls.mustNotMatch.length, 0);
console.log(`  ✓ detector self-controls: ${controlCount} assertions across ${CONTENT_RULES.length} content rules`);

const files = trackedFiles();
console.log(`  tracked paths: ${files.length}`);
console.log(`  declared areas: ${AREAS.length} across ${Object.keys(CLASSES).length} classes\n`);

// ── A. COVERAGE ──────────────────────────────────────────────────────────────
const unclassified = [];
const hits = new Map(AREAS.map((a) => [a.path, 0]));
for (const f of files) {
  const matches = AREAS.filter((a) => under(f, a.path));
  if (matches.length === 0) {
    unclassified.push(f);
    continue;
  }
  // Most specific wins; ambiguity between equally specific rules is a declaration bug.
  matches.sort((x, y) => y.path.length - x.path.length);
  if (matches.length > 1 && matches[0].path.length === matches[1].path.length) {
    console.error(`\n✗ "${f}" matches two equally specific areas (${matches[0].path}, ${matches[1].path}).`);
    failures += 1;
  }
  hits.set(matches[0].path, hits.get(matches[0].path) + 1);
}
if (unclassified.length > 0) {
  console.error(`✗ ${unclassified.length} tracked path(s) fall under NO declared area:\n`);
  for (const f of unclassified.slice(0, 25)) console.error(`    ${f}`);
  if (unclassified.length > 25) console.error(`    … and ${unclassified.length - 25} more`);
  console.error(
    "\n  This is the boundary doing its job, not a bug in it. Something arrived in a\n" +
      "  PUBLIC repository that nobody classified. Add an area to scripts/publication-boundary.mjs\n" +
      "  with a class and a reason — or, if it does not belong in public, remove it.",
  );
  failures += 1;
} else {
  console.log("  ✓ coverage: every tracked path falls under a declared area");
}

// ── B. PHANTOM AREAS ─────────────────────────────────────────────────────────
const phantom = AREAS.filter((a) => hits.get(a.path) === 0);
if (phantom.length > 0) {
  console.error(`\n✗ ${phantom.length} declared area(s) cover no tracked path — stale rules inflating the count:`);
  for (const a of phantom) console.error(`    ${a.path}`);
  failures += 1;
} else {
  console.log("  ✓ no phantom areas: every declared area covers real tracked content");
}

// ── C. REPUBLICATION ─────────────────────────────────────────────────────────
const disposed = new Map(THIRD_PARTY_DISPOSITIONS.map((d) => [d.path, d]));
const republished = files.filter((f) => REPUBLICATION_FORMATS.some((ext) => f.toLowerCase().endsWith(ext)));
const undisposed = republished.filter((f) => !disposed.has(f));
const pending = republished.filter((f) => disposed.get(f)?.basis === "OWNER_PENDING");
const resolved = republished.filter((f) => {
  const b = disposed.get(f)?.basis;
  return typeof b === "string" && b !== "OWNER_PENDING";
});

// A NEW reproduced document nobody has looked at is a hard failure. This is the
// forward-looking half and it is not softened.
if (undisposed.length > 0) {
  console.error(`\n✗ ${undisposed.length} reproduced-whole document(s) with NO entry in THIRD_PARTY_DISPOSITIONS:`);
  for (const f of undisposed) console.error(`    ${f}`);
  console.error(
    "\n  Committing someone else's document whole to a PUBLIC repository is a licensing\n" +
      "  question. Answer it in scripts/publication-boundary.mjs — a stated basis, or\n" +
      "  OWNER_PENDING with the decision spelled out — or remove the file.",
  );
  failures += 1;
}

// An OWNER_PENDING entry with nothing for the owner to act on is a placeholder
// pretending to be a decision. That fails.
const mute = THIRD_PARTY_DISPOSITIONS.filter(
  (d) => d.basis === "OWNER_PENDING" && (typeof d.ownerDecision !== "string" || d.ownerDecision.trim() === ""),
);
if (mute.length > 0) {
  console.error(`\n✗ ${mute.length} OWNER_PENDING entr(y/ies) state no decision for the owner to take:`);
  for (const d of mute) console.error(`    ${d.path}`);
  failures += 1;
}

if (resolved.length > 0) console.log(`  ✓ republication: ${resolved.length} reproduced document(s) carry a stated licence basis`);
if (republished.length === 0) console.log("  ✓ republication: no reproduced-whole documents in the tree");

// ── D. CONTENT ───────────────────────────────────────────────────────────────
const exempt = new Set(CONTENT_EXEMPT.map((e) => e.path));
// Text only: a binary's bytes are not prose, and decoding them produces noise.
const BINARY = /\.(png|jpe?g|gif|svg|ico|pdf|zip|woff2?|ttf|mp4|docx|pptx|xlsx)$/i;
let contentHits = 0;
let scanned = 0;
for (const f of files) {
  if (exempt.has(f) || BINARY.test(f)) continue;
  let text;
  try {
    text = readFileSync(resolve(repoRoot, f), "utf8");
  } catch {
    continue;
  }
  scanned += 1;
  for (const rule of CONTENT_RULES) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (!rule.pattern.test(lines[i])) continue;
      console.error(`\n✗ [${rule.id}] ${f}:${i + 1}`);
      console.error(`    ${lines[i].trim().slice(0, 140)}`);
      console.error(`    ${rule.why}`);
      contentHits += 1;
    }
  }
}
if (contentHits > 0) failures += 1;
else console.log(`  ✓ content rules: ${CONTENT_RULES.length} rules over ${scanned} text files, no breaches`);

// ── E. VENDORED-SET ARITHMETIC ───────────────────────────────────────────────
// The `.claude/skills` area claims "N skills vendored unmodified" under someone
// else's licence. Every directory under it that has NO more-specific area is
// therefore being published as that author's work. Three first-party skills sat
// there for a week (2026-08-26 → 09-02) because coverage (A) only proves a path is
// classified, never that it is classified CORRECTLY. This section counts, on both
// halves: the CODE half (uncovered tracked directories must equal the figure the
// area's reason states) and the DOC half (.claude/skills/VENDORED.md is what a
// re-vendor operator reads; its first-party table and its stated exception count
// must equal the carve-outs). A new first-party skill without a carve-out makes
// the code half N+1 and fails; a carve-out added without a table row, or a table
// row without a carve-out, fails the doc half. The review of this section found
// the doc half ungated on the first cut — the same shape one file over.
{
  const vendoredArea = AREAS.find((a) => a.path === ".claude/skills" && a.class === "third_party_intake");
  const stated = vendoredArea && /(\d+) skills vendored/.exec(vendoredArea.reason);
  if (!vendoredArea || !stated) {
    console.error("\n✗ vendored-set arithmetic: no `.claude/skills` third_party_intake area stating \"N skills vendored\"");
    failures += 1;
  } else {
    const claimed = Number(stated[1]);
    const dirs = new Set(
      files.filter((f) => f.startsWith(".claude/skills/") && f.split("/").length > 3).map((f) => f.split("/")[2]),
    );
    const carvedAreas = AREAS.filter((a) => a.path.startsWith(".claude/skills/") && a.class !== "third_party_intake");
    // Only carve-outs that cover a tracked directory count — a phantom area is B's
    // failure, and its figure must not inflate a green line here.
    const carved = new Set(carvedAreas.map((a) => a.path.split("/")[2]).filter((d) => dirs.has(d)));
    const uncovered = [...dirs].filter((d) => !carved.has(d)).sort();
    let sectionFailed = false;
    if (uncovered.length !== claimed) {
      console.error(`\n✗ vendored-set arithmetic: the .claude/skills area claims ${claimed} vendored skills but ${uncovered.length} director(y/ies) fall under it with no carve-out:`);
      for (const d of uncovered) console.error(`    .claude/skills/${d}`);
      console.error(
        "\n  Every directory listed is being published as obra/superpowers' work under its\n" +
          "  author's MIT grant. A first-party skill needs its own `tooling` area in\n" +
          "  scripts/publication-boundary.mjs; a vendored skill that was removed needs the\n" +
          "  figure in the area's reason moved with it — and the same figure is quoted in\n" +
          "  .claude/skills/VENDORED.md and docs/COMPANY_BUILD_PLAN.md (the reason string\n" +
          "  is reproduced there verbatim; reword both or neither).",
      );
      sectionFailed = true;
    }
    // DOC HALF. The table rows are `> | \`name/\` | date | what |`; the count word is
    // the bold opener "**<WORD> exceptions in this directory". A reformatted table
    // or a rewritten opener fails loudly here rather than matching zero.
    const WORDS = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15 };
    let vendoredDoc = "";
    try {
      vendoredDoc = readFileSync(resolve(repoRoot, ".claude/skills/VENDORED.md"), "utf8");
    } catch {
      console.error("\n✗ vendored-set arithmetic: .claude/skills/VENDORED.md is unreadable — the operator-facing half of the claim has no source");
      sectionFailed = true;
    }
    if (vendoredDoc) {
      const opener = /\*\*([A-Z]+|\d+) exceptions? in this directory/.exec(vendoredDoc);
      const docStated = opener ? (WORDS[opener[1]] ?? Number(opener[1])) : NaN;
      const rows = [...vendoredDoc.matchAll(/^> \| `([^`/]+)\/` \| \d{4}-\d{2}-\d{2} \| /gm)].map((m) => m[1]);
      if (!opener || !Number.isFinite(docStated)) {
        console.error("\n✗ vendored-set arithmetic: .claude/skills/VENDORED.md no longer opens with \"**<N> exceptions in this directory\" — the stated count cannot be read");
        sectionFailed = true;
      }
      if (rows.length === 0) {
        console.error("\n✗ vendored-set arithmetic: no first-party table rows (`> | \\`name/\\` | YYYY-MM-DD | …`) found in .claude/skills/VENDORED.md");
        sectionFailed = true;
      }
      const rowSet = new Set(rows);
      const rowsNotCarved = rows.filter((r) => !carved.has(r));
      const carvedNotRows = [...carved].filter((c) => !rowSet.has(c)).sort();
      if (rowsNotCarved.length > 0 || carvedNotRows.length > 0) {
        console.error("\n✗ vendored-set arithmetic: the first-party table in .claude/skills/VENDORED.md and the carve-outs in scripts/publication-boundary.mjs disagree:");
        for (const r of rowsNotCarved) console.error(`    table row without a carve-out (still published as vendored): .claude/skills/${r}`);
        for (const c of carvedNotRows) console.error(`    carve-out without a table row (the operator's list is short): .claude/skills/${c}`);
        sectionFailed = true;
      }
      if (Number.isFinite(docStated) && docStated !== carved.size) {
        console.error(`\n✗ vendored-set arithmetic: .claude/skills/VENDORED.md says ${docStated} exceptions; ${carved.size} carve-out(s) cover tracked directories. The sentence a re-vendor operator obeys is the one that drifted.`);
        sectionFailed = true;
      }
    }
    if (sectionFailed) failures += 1;
    else console.log(`  ✓ vendored-set arithmetic: ${uncovered.length} skill director(y/ies) under the vendored claim, ${carved.size} first-party carve-out(s) matching ${carved.size} table rows and the stated word, code figure ${claimed}`);
  }
}

// ── UNRESOLVED EXPOSURES, printed in full on every run ───────────────────────
// Not an appendix and not a summary line. A finding this gate has chosen not to
// fail on is the one most at risk of being forgotten, so it gets the most space.
if (pending.length > 0) {
  console.log(
    `\n  ⚠ ${pending.length} THIRD-PARTY DOCUMENT(S) PUBLISHED HERE WITH AN UNRESOLVED LICENCE BASIS.\n` +
      "    Already public. Awaiting an owner decision — this gate does not fail on it\n" +
      "    because it is a legal call about the owner's own material, not an engineering\n" +
      "    one, and reddening every branch would get the check deleted rather than the\n" +
      "    question answered. It is printed in full, every run, until it is resolved.",
  );
  for (const f of pending) {
    const d = disposed.get(f);
    console.log(`\n      ${f}`);
    console.log(`        what it is  — ${d.note}`);
    console.log(`        decision    — ${d.ownerDecision}`);
  }
  console.log("");
}

// ── what this gate does NOT establish, printed every run ─────────────────────
console.log(
  "\n  NOT established by a green here — stated so the pass is not read as more than it is:\n" +
    "    · whether a classified file SHOULD be public. Classification records a human's\n" +
    "      judgment; it does not audit it. This gate proves nothing arrived unexamined.\n" +
    "    · secrets — `gitleaks` owns that, and this deliberately does not duplicate it.\n" +
    "    · anything already in git history. Removal from HEAD is not removal.",
);

if (failures > 0) {
  console.error(`\nPublication-boundary gate FAILED: ${failures} problem area(s) above.`);
  process.exit(1);
}
console.log("\nPublication-boundary gate passed — every tracked path is classified, and no declared breach is present.");
