#!/usr/bin/env node
// Docs-HTML figure guard — a number on a rendered page must not contradict the tree.
//
//   node scripts/check-doc-html-figures.mjs
//   node scripts/check-doc-html-figures.mjs --list        what is derived, and from where
//   node scripts/check-doc-html-figures.mjs --self-test   prove the gate can fail
//
// WHY THIS EXISTS
// ---------------
// On 2026-09-02 a sweep of `docs/` found `docs/architecture.html:176` reading
// "12 dimensions composed into one posture". The union it describes,
// `SIGNAL_CATEGORIES` in `lib/signalgrid-core/src/types.ts`, held SEVENTEEN. The
// page had been wrong by five for long enough that nobody could date it, and the
// reason is exact: **no gate in this repository read a docs HTML figure at all.**
//
//   * `check-proof-figures.mjs` reads MARKDOWN, and only inside a section that
//     names the proof publishing the number.
//   * `check-launch-claims.mjs` reads the Pages-published HTML for CLAIMS, not
//     for figures.
//   * `check-proof-counts.mjs` matches documented assertion counts, in markdown.
//
// So an `.html` page — the format this repo uses for exactly the artifacts an
// outsider looks at first: the architecture explainer, the pitch deck, the
// battlecard — could contradict the source union indefinitely and stay green.
// `SIGNAL_CATEGORIES`'s own source comment predicted this failure mode in prose
// ("Every document that wanted to state how many categories exist had to restate
// the list by hand") and the fix it describes stopped at markdown.
//
// WHAT IS GATED, AND WHAT IS NOT
// ------------------------------
// GATED: a figure in a docs HTML page that matches one of the FIGURES patterns
// below and disagrees with the value derived from source. That is unambiguous —
// there is one right answer and the page has a different one.
//
// NOT GATED, deliberately: everything else on these pages. Mock UI numerals
// ("16 events" in a screenshot-shaped teaser), slide numbers, latency badges, and
// prose that is illustrative rather than a claim about the tree. Judgement calls
// do not belong in a gate; see rule 4 of the repository's gate doctrine.
//
// THE HONEST IDIOM THIS GATE MUST NOT PUNISH
// ------------------------------------------
// "17 categories" and "16 categories" are BOTH true sentences in this repository
// and they count different things: the core normalizes 17 signal categories, and
// the candidate integration CATALOG has ~16 taxonomy categories.
// `docs/WHAT_SIGNALGRID_DOES_TODAY.md` spends a whole section keeping them apart.
// A gate that flagged the catalog figure would teach the next author to delete a
// true distinction, so a line that names the catalog sense is skipped — and that
// skip is REPORTED on every run, not silent.
//
// SELF-TEST AND FLOORS
// --------------------
// A gate scanning nothing is green about nothing, so this refuses to conclude
// anything unless: the HTML set is at least FILE_FLOOR files, every derived
// figure parsed to a plausible value, and at least one real figure occurrence was
// found in the tree. Then the synthetic violation must still be caught.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILE_FLOOR = 5;

// ── derivations, each from the artefact that OWNS the number ─────────────────

/** SIGNAL_CATEGORIES.length, read from the const array rather than restated. */
function signalCategoryCount() {
  const src = readFileSync(resolve(repo, "lib/signalgrid-core/src/types.ts"), "utf8");
  const m = src.match(/export const SIGNAL_CATEGORIES = \[([\s\S]*?)\] as const;/);
  if (!m) return null;
  // Count quoted entries; comment lines inside the array carry no quotes.
  return (m[1].match(/^\s*"[a-z_]+",/gm) ?? []).length;
}

/** Launch-profile totals, imported rather than parsed. */
async function profileFigures() {
  const p = await import("./launch-profile.mjs");
  const total = p.SURFACES.reduce(
    (n, s) => n + s.launch.length + s.deferred.length + s.demo_only.length + s.internal.length,
    0,
  );
  const launch = p.SURFACES.reduce((n, s) => n + s.launch.length, 0);
  return { total, launch, gaps: p.GAPS.length, version: p.LAUNCH_PROFILE_VERSION };
}

const categories = signalCategoryCount();
const profile = await profileFigures();

// ── the figures a docs HTML page may state, and how they are recognised ──────
//
// Each entry: a pattern whose FIRST capture group is the stated number, the
// derived value it must equal, and an optional `unless` — the honest other sense
// of the same word, which is skipped and counted rather than flagged.
const FIGURES = [
  {
    id: "signal-categories",
    derivedFrom: "SIGNAL_CATEGORIES in lib/signalgrid-core/src/types.ts",
    expect: categories,
    re: /\b(\d{1,3})\s+(?:normalized\s+|signal\s+)?(?:dimensions|categories)\b/gi,
    unless: /catalog|candidate|taxonom|integration source/i,
  },
  {
    id: "profile-classified-items",
    derivedFrom: "every SURFACES entry in scripts/launch-profile.mjs",
    expect: profile.total,
    re: /\b(\d{1,4})\s+classified items\b/gi,
  },
  {
    id: "profile-launch-items",
    derivedFrom: "the `launch` class in scripts/launch-profile.mjs",
    expect: profile.launch,
    re: /\b(\d{1,4})\s+launch items\b/gi,
  },
  {
    id: "profile-declared-gaps",
    derivedFrom: "GAPS in scripts/launch-profile.mjs",
    expect: profile.gaps,
    re: /\b(\d{1,3})\s+declared gaps\b/gi,
  },
];

/** Tags and entity references carry no figures; strip them before matching. */
const textOf = (line) => line.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ");

// ── THE OTHER-SENSE SKIP IS LOCAL TO THE FIGURE, NOT TO THE LINE (F3, 2026-09-02)
//
// `unless` was tested against the WHOLE line, so one occurrence of "catalog",
// "candidate" or "taxonomy" anywhere on a line disarmed EVERY figure on it. In HTML
// that is not a corner case: these pages put a whole section on one physical line,
// and a nav link reading "Integration catalog" would have exempted a wrong dimension
// count rendered 300 characters away. The skip is meant to spare a sentence that is
// counting the OTHER thing, and a word can only tell you that if it is attached to
// the phrase doing the counting.
//
// So the word must fall inside the UNLESS_WINDOW characters FOLLOWING the matched
// figure phrase — the slot English uses to qualify a counted noun:
//
//   "16 categories of candidate source"        → the count IS about the catalog: skip
//   "Our taxonomy composes 12 dimensions …"    → "taxonomy" is the subject, not the
//                                                qualifier; the 12 is a claim about
//                                                SIGNAL_CATEGORIES: FLAG it
//
// A symmetric window was tried first and cannot separate those two: both sentences
// put the word 7–10 characters BEFORE the number, so any threshold that spares the
// second spares the first, and the pre-fix behaviour survives under a new name.
//
// A word present on the line but OUTSIDE the window is not silently ignored — it is
// named in the violation text, so an author who really did mean the other sense is
// told exactly how to say so instead of guessing at the gate.
const UNLESS_WINDOW = 40;

function scan(name, body) {
  const out = { violations: [], matched: 0, skipped: [], perFamily: {} };
  for (const fig of FIGURES) out.perFamily[fig.id] = 0;
  body.split("\n").forEach((line, i) => {
    const text = textOf(line);
    for (const fig of FIGURES) {
      fig.re.lastIndex = 0;
      let m;
      while ((m = fig.re.exec(text)) !== null) {
        const end = m.index + m[0].length;
        const qualifier = text.slice(end, end + UNLESS_WINDOW);
        const local = fig.unless ? qualifier.match(fig.unless) : null;
        if (local) {
          out.skipped.push(`${name}:${i + 1}  ${fig.id} (other sense: ${local[0]})`);
          continue;
        }
        out.matched += 1;
        out.perFamily[fig.id] += 1;
        if (Number(m[1]) !== fig.expect) {
          // The word is on the line but not attached to the count — say so.
          const distant = fig.unless && fig.unless.test(text)
            ? ` — note "${(text.match(fig.unless) || [""])[0]}" is on this line but not within ` +
              `${UNLESS_WINDOW} chars after the figure, so it does not qualify the count; ` +
              "put the sense beside the number if that is what you meant"
            : "";
          out.violations.push(
            `${name}:${i + 1}: states ${m[1]} where ${fig.id} is ${fig.expect} ` +
              `(derived from ${fig.derivedFrom}) — "${text.trim().slice(0, 90)}"${distant}`,
          );
        }
      }
    }
  });
  return out;
}

if (process.argv.includes("--list")) {
  console.log("\nDerived figures, and the artefact each is read from:\n");
  for (const f of FIGURES) console.log(`  ${f.id.padEnd(26)} = ${f.expect}   ← ${f.derivedFrom}`);
  console.log(`\nlaunch-profile version: v${profile.version}`);
  console.log("\nScope: every git-tracked docs/**/*.html — derived from `git ls-files docs`,");
  console.log("wider than the Pages deploy list on purpose (an unpublished preview page");
  console.log("carried a retired label for days precisely because nothing read it).\n");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  const bad = '<div class="m">12 dimensions composed into <b>one posture</b>.</div>';
  const good = '<div class="m">17 dimensions composed into <b>one posture</b>.</div>';
  const otherSense = "<p>the catalog taxonomy shows 16 categories of candidate source</p>";
  const badGaps = "<p>There are 3 declared gaps.</p>";
  // F3: the other-sense word as the SUBJECT of the sentence, not as the qualifier of
  // the count. The whole-line test called this exempt; it is a claim about
  // SIGNAL_CATEGORIES and 17 is the derived value, so it must fail.
  const subjectSense = "<p>Our taxonomy composes 12 dimensions into one posture.</p>";
  // F3, the other direction: a wrong figure sitting far from an unrelated occurrence
  // of the word, the shape a single-line HTML section actually makes.
  const distantWord =
    '<nav><a href="#">Integration catalog</a></nav><div class="m">12 dimensions composed into one posture</div>';
  const checks = [
    ["a wrong category count is caught", scan("st0.html", bad).violations.length > 0],
    ["the right category count is clean", scan("st1.html", good).violations.length === 0],
    ["the catalog sense of 'categories' is not punished", scan("st2.html", otherSense).violations.length === 0],
    ["the catalog sense is REPORTED, not silent", scan("st2.html", otherSense).skipped.length === 1],
    ["an other-sense word in SUBJECT position does not exempt the figure", scan("st4.html", subjectSense).violations.length > 0],
    ["an other-sense word elsewhere on the line does not exempt the figure", scan("st5.html", distantWord).violations.length > 0],
    ["that distant word is named in the violation, not ignored", /not within 40 chars after the figure/.test(scan("st5.html", distantWord).violations[0] ?? "")],
    ["a second figure family can also fail", scan("st3.html", badGaps).violations.length > 0],
    // F4: coverage is per family, so a family matching ZERO cannot hide inside a
    // single total. A figure family with no occurrence proves nothing about itself.
    ["per-family counts are reported, not a single total", (() => {
      const r = scan("st3.html", badGaps);
      return r.perFamily["profile-declared-gaps"] === 1 && r.perFamily["signal-categories"] === 0;
    })()],
    ["the derivation produced a plausible category count", typeof categories === "number" && categories >= 10],
    ["the derivation produced a plausible profile total", profile.total >= 100],
  ];
  let ok = true;
  for (const [what, pass] of checks) {
    console.log(`  ${pass ? "✓" : "✗"} ${what}`);
    if (!pass) ok = false;
  }
  console.log(ok ? "PASS  self-test — the docs-HTML figure guard can fail" : "FAIL  self-test");
  process.exit(ok ? 0 : 1);
}

// ── floors, asserted BEFORE any verdict ──────────────────────────────────────
if (typeof categories !== "number" || categories < 10) {
  console.error(
    `✗ could not derive SIGNAL_CATEGORIES (got ${categories}). The const array's shape changed;\n` +
      "  fix this derivation. A guard that cannot read its source must not report on the tree.",
  );
  process.exit(1);
}
if (profile.total < 100) {
  console.error(`✗ launch profile derived only ${profile.total} classified items — the import shape changed.`);
  process.exit(1);
}

const files = execSync("git ls-files docs", { encoding: "utf8" })
  .trim().split("\n").filter((f) => /\.html?$/.test(f));
if (files.length < FILE_FLOOR) {
  console.error(
    `✗ found only ${files.length} docs/**/*.html file(s), below the floor of ${FILE_FLOOR}.\n` +
      "  Either the pages were deleted or the derivation regressed. Do not silently scan less.",
  );
  process.exit(1);
}

let violations = [];
let matched = 0;
const skipped = [];
const perFamily = Object.fromEntries(FIGURES.map((f) => [f.id, 0]));
for (const f of files) {
  const r = scan(f, readFileSync(resolve(repo, f), "utf8"));
  violations = violations.concat(r.violations);
  matched += r.matched;
  for (const id of Object.keys(perFamily)) perFamily[id] += r.perFamily[id];
  skipped.push(...r.skipped);
}

if (matched === 0) {
  console.error(
    `✗ scanned ${files.length} docs HTML page(s) and matched ZERO figure statements.\n` +
      "  This repository has had at least one since 2026-06 (architecture.html's dimension count),\n" +
      "  so the patterns have drifted away from the copy. A gate scanning nothing is green about\n" +
      "  nothing — fix the patterns rather than accepting the pass.",
  );
  process.exit(1);
}

// COVERAGE IS PER FAMILY (F4, 2026-09-02). "N matched against 4 derived figures"
// reads as four-family coverage and is not: today all N come from ONE family, and
// three of the four have never met an occurrence on any page. Those three are
// derived and self-tested but UNEXERCISED by the tree — say so on the line rather
// than letting one healthy family vouch for its silent neighbours.
console.log(
  `docs-HTML figures: ${files.length} page(s) scanned, ${matched} figure statement(s) matched ` +
    `against ${FIGURES.length} derived figure(s), ${violations.length} contradiction(s); floors and self-test green`,
);
console.log(
  "  matched per family: " + FIGURES.map((f) => `${f.id}: ${perFamily[f.id]}`).join(", "),
);
{
  const idle = FIGURES.filter((f) => perFamily[f.id] === 0).map((f) => f.id);
  if (idle.length) {
    console.log(
      `      ${idle.length} of ${FIGURES.length} famil${idle.length === 1 ? "y" : "ies"} matched nothing in the tree ` +
        `(${idle.join(", ")}) — derived and self-tested, but proving nothing about any page today.`,
    );
  }
}
for (const f of FIGURES) console.log(`      ${f.id.padEnd(26)} = ${f.expect}`);
if (skipped.length) {
  console.log(`  REPORTED, not gated — ${skipped.length} line(s) skipped as the other sense of a word:`);
  for (const s of skipped.slice(0, 5)) console.log(`      ${s}`);
}

if (violations.length) {
  console.error(`\n✗ ${violations.length} docs HTML figure(s) contradict the tree:\n`);
  for (const v of violations) console.error(`    ${v}`);
  console.error(
    "\nFix the PAGE, never this gate: each figure above is derived from the artefact that\n" +
      "owns it. If the page means the other sense of the word, say which sense on the line.\n",
  );
  process.exit(1);
}
console.log("Docs-HTML figure guard passed — no rendered page contradicts a figure the tree derives.");
