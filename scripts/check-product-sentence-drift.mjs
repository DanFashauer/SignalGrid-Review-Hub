#!/usr/bin/env node
// Product-sentence drift — REPORT ONLY. Who else is defining the product, and as what.
//
//   node scripts/check-product-sentence-drift.mjs             # report (exit 0 on findings)
//   node scripts/check-product-sentence-drift.mjs --self-test # prove the detector works
//
// WHY THIS IS A REPORT AND NOT A GATE, said first because it is the whole design.
// `docs/PURPOSE.md` §2 is canonical (DR-020) and owns the product sentence. DR-019
// ratified NO category label at all. `check-launch-claims.mjs` gates three retired
// labels by name — and on 2026-09-06 an audit found a fourth spelling, "operational
// trust control plane", living in three documents and matching none of them:
// `docs/research/INVESTOR_DESIGN_PARTNER_READINESS.md:19` carried the full product
// sentence "SignalGrid is an operational trust control plane", live and unbannered,
// and no gate could see it because the pattern is a LIST OF THREE STRINGS.
//
// The repair is NOT a fourth alternative in that regex — the next variant walks past
// a four-item list exactly as it walked past a three-item one. The property worth
// watching is shape, not vocabulary: how many DIFFERENT sentences of the form
// "SignalGrid is a/an/the …" are alive in the corpus, and how far each sits from the
// one page that owns it. That question has no mechanical right answer — many of the
// hits are honest descriptors a live positioning page ratified, several are a document
// QUOTING copy it is cataloguing, and a fatal version would gate the whole corpus on
// prose taste. So this prints, and never fails on what it finds.
//
// WHAT IS FATAL HERE, because a report that cannot fail is a report nobody can trust:
// the DERIVATION. If §2 cannot be extracted from docs/PURPOSE.md, if the corpus scan
// collapses, if the banner reader stops finding bannered documents, or if the
// self-test's synthetic sentences stop being detected, this exits 1. It refuses to
// report nothing and call that clean.
//
// SCOPE IS DERIVED, NEVER HAND-LISTED:
//   · the canonical sentence is READ from docs/PURPOSE.md's "## 2. Product" section —
//     not copied here, so an owner correction to §2 moves this report with it;
//   · the corpus is every tracked docs/**/*.md (git ls-files);
//   · the excluded set is computed, not typed: a BANNERED document (via the index
//     gate's own `readBanner`, so the two agree by construction) is an archive and is
//     allowed to contain its own retired thesis, and `docs/DECISION_RECORDS.md` records
//     the owner's words including the ones that were later retired.
//
// THREE IDIOMS THAT ARE NOT DRIFT, each measured in this tree on 2026-09-06:
//   NEGATION   `docs/EXECUTIVE_ONE_PAGER.md:87` — "SignalGrid is not an MDM: it never
//              enrolls, configures, locks or wipes a device". A sentence saying what
//              the product is NOT is the honesty this repository asks for. Excluded by
//              construction (the article test) and by an explicit guard, and self-tested
//              both ways so the guard cannot rot.
//   QUOTATION  `docs/POSITIONING.md:53` — "This section previously opened "SignalGrid is
//              a decision …"" — and the battlecard's blockquoted seller script. The
//              document is naming a string, not asserting it. Counted and printed
//              separately, never as drift. Same carve-out `check-launch-claims.mjs`
//              makes for prose, and for the same reason.
//   HEADING    `docs/ECOSYSTEM_POSITIONING.md:420` — "## Where SignalGrid is the wrong
//              answer". A section title is not a product sentence.
// Fenced blocks and HTML comments are masked first (scripts/lib/markdown-scope.mjs), so
// a `git grep -nE "SignalGrid is …"` command shown in a runbook is not read as a claim.
//
// THE VARIANT WATCH is deliberately narrow and deliberately REPORTED. Two near-misses
// of `RETIRED_LABELS` are named, each with the date and the audit that found it:
//   · "operational trust control plane" (research audit F15);
//   · the BARE "[runtime ]trust orchestration layer|platform" (docs-chunk-2 audit F1),
//     which defined the product outright at docs/OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md:9.
// Neither is promoted into the fatal pattern. Beyond the fossil argument above there is a
// measured reason for the second: `RETIRED_LABELS` feeds a ceiling that is FATAL ON A RISE,
// and the bare spelling appears in docs/research/MARKET_LANDSCAPE.md's collision assessment,
// which discusses the category by name on purpose. Gating it would redden the build over a
// document being careful. The number to watch is the number of DISTINCT product sentences,
// printed below; the variant lines are two instruments on that dial.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBanner, trackedDocs } from "./check-index-banner-parity.mjs";
import { maskNonProse } from "./lib/markdown-scope.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Documents allowed to carry a retired product sentence, and why. Printed on every run. */
export const EXCLUDED = [
  ["docs/DECISION_RECORDS.md", "the decision records quote the owner's own words, including the sentences a later DR retired"],
];

/**
 * The sentence shape. `SignalGrid is` + an ARTICLE — which is what makes this a
 * definition rather than a state ("SignalGrid is green", "SignalGrid is not an MDM").
 * The phrase runs to the end of the clause; 160 characters is a bound, not a claim.
 */
export const PRODUCT_SENTENCE = /\bSignalGrid is\s+(an?|the)\s+([^.;:\n]{1,160})/gi;

/** Explicit, though the article test already excludes it — a guard that is self-tested cannot rot. */
export const NEGATION = /\bSignalGrid is\s+(not|never|no longer)\b/i;

/** A quote or backtick close before the match means the document is NAMING the string. */
export const QUOTED_BEFORE = /["“”‘’'`*_]{1,2}\s*$/;

/**
 * Near-miss spellings of a retired category label that `RETIRED_LABELS` in
 * check-launch-claims.mjs does not match. REPORTED here, never gated — see the header.
 */
export const VARIANTS = [
  [
    /operational trust control plane/gi,
    "batch-Y research audit F15 (2026-09-06): lived in three documents, one of them a full "
      + '"SignalGrid is an operational trust control plane" product sentence, and matched none of the three gated labels',
  ],
  [
    /(?<!zero[\s-])(?<!operational[\s-])\b(?:runtime\s+)?trust orchestration (?:layer|platform)\b/gi,
    "batch-Y docs-chunk-2 audit F1 (2026-09-06): docs/OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md:9 defined the "
      + 'product as "a runtime trust orchestration layer", live and unbannered; the bare spelling is outside '
      + "RETIRED_LABELS, and putting it INSIDE would move a fatal ceiling over collision-assessment prose in "
      + "docs/research/MARKET_LANDSCAPE.md, which discusses the category by name on purpose. The two lookbehinds "
      + "keep this off the TAIL of the two spellings check-launch-claims.mjs already gates: without them it "
      + "re-reported every 'Operational Trust Orchestration platform' the ceiling already counts, which is two "
      + "instruments disagreeing about one line",
  ],
];

/**
 * A quote or backtick still OPEN before a variant means the document is
 * NAMING the phrase — docs/agent/EVIDENCE.md:1640 quotes an outreach draft that used
 * it, and counting that as drift would report the audit trail as the defect. The
 * straight apostrophe is guarded the same way check-launch-claims.mjs's QUOTE_CONTEXT
 * is: `SignalGrid's trust orchestration layer` is a possessive, not a quotation.
 *
 * The window is 200 characters rather than the sibling gate's 24 because there the label
 * usually OPENS the quotation, while here the phrase sits mid-sentence inside a quoted
 * outreach draft. What decides it is the character class: no quote character may appear
 * between the opening quote and the match, so the quotation is still open at the match.
 * The 200 is a backtracking bound, not a claim about prose.
 */
export const VARIANT_QUOTED = /(?:["\u201c\u201d\u2018\u2019`]|(?<!\w)')[^"\u201c\u201d\u2018\u2019'`]{0,200}$/;

/** Pure: variant mentions in one document, split into asserted and merely quoted. */
export function variantHitsIn(rawText) {
  const hits = [];
  const quoted = [];
  rawText.split("\n").forEach((line, i) => {
    for (const [re, why] of VARIANTS) {
      for (const m of line.matchAll(re)) {
        const rec = { line: i + 1, match: m[0], why };
        if (VARIANT_QUOTED.test(line.slice(0, m.index))) quoted.push(rec);
        else hits.push(rec);
      }
    }
  });
  return { hits, quoted };
}

/**
 * Pure: docs/PURPOSE.md's canonical product section, read from the file rather than
 * copied. Returns the section body; throws if the heading is gone, because a derivation
 * that silently falls back to a default is a report about nothing.
 */
export function canonicalSection(purposeText) {
  const lines = purposeText.split("\n");
  const at = lines.findIndex((l) => /^##\s+2\.\s+Product\s*$/.test(l.trim()));
  if (at === -1) throw new Error('docs/PURPOSE.md has no "## 2. Product" heading — the canonical section moved or was renamed.');
  const out = [];
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

/** Pure: lowercase content words, so two phrasings can be compared without a thesaurus. */
export function contentWords(text) {
  const STOP = new Set(
    ("a an the and or of for to in on at by with that which is are be as it its this these those into one "
      + "already runs person people signalgrid").split(" "),
  );
  return [...new Set(String(text).toLowerCase().match(/[a-z][a-z-]{2,}/g) || [])].filter((w) => !STOP.has(w));
}

/**
 * Pure: every product sentence in one document, classified.
 *
 * @returns {{line:number, article:string, phrase:string, quoted:boolean}[]}
 */
export function sentencesIn(rawText) {
  const masked = maskNonProse(rawText);
  const lines = masked.split("\n");
  const rawLines = rawText.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s{0,3}#{1,6}\s/.test(rawLines[i])) continue; // a section title is not a product sentence
    for (const m of lines[i].matchAll(PRODUCT_SENTENCE)) {
      if (NEGATION.test(lines[i].slice(Math.max(0, m.index - 20), m.index + 40))) continue;
      out.push({
        line: i + 1,
        article: m[1],
        phrase: m[2].trim().replace(/\s+/g, " "),
        quoted: QUOTED_BEFORE.test(lines[i].slice(0, m.index)),
      });
    }
  }
  return out;
}

/** The scan. Pure with respect to `docs`/`root` so the self-test can run it on a fixture. */
export function auditProductSentences({ root = ROOT, docs = null } = {}) {
  const tracked = docs ?? trackedDocs(root);
  const canon = canonicalSection(readFileSync(join(root, "docs/PURPOSE.md"), "utf8"));
  const canonWords = new Set(contentWords(canon));

  const findings = [];
  const quoted = [];
  const variantHits = [];
  const variantQuoted = [];
  let scanned = 0;
  let banneredSkipped = 0;
  let excludedSkipped = 0;

  for (const rel of [...tracked].sort()) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, "utf8");
    if (EXCLUDED.some(([p]) => p === rel)) {
      excludedSkipped += 1;
      continue;
    }
    const banner = readBanner(raw.split("\n"));
    if (banner && !banner.priorVersion) {
      banneredSkipped += 1;
      continue;
    }
    scanned += 1;
    for (const s of sentencesIn(raw)) {
      const words = contentWords(s.phrase);
      const shared = words.filter((w) => canonWords.has(w));
      const rec = { rel, ...s, words: words.length, shared: shared.length };
      if (s.quoted) quoted.push(rec);
      else findings.push(rec);
    }
    // The variant watch reads the RAW text, minus the quote idiom: a bannered page was
    // already skipped above, and a document QUOTING the phrase is naming a string.
    const vh = variantHitsIn(raw);
    for (const h of vh.hits) variantHits.push({ rel, ...h });
    for (const h of vh.quoted) variantQuoted.push({ rel, ...h });
  }

  const byPhrase = new Map();
  for (const f of findings) {
    const key = f.phrase.toLowerCase().replace(/[*_`]/g, "");
    if (!byPhrase.has(key)) byPhrase.set(key, []);
    byPhrase.get(key).push(f);
  }
  return { canon, findings, quoted, variantHits, variantQuoted, byPhrase, scanned, banneredSkipped, excludedSkipped, tracked: tracked.size };
}

// ── Self-test — the detector must find a planted sentence and spare the honest ones ───
function selfTest() {
  const fails = [];
  const expect = (id, cond, msg) => {
    if (!cond) fails.push(`${id}: ${msg}`);
  };
  const found = (text) => sentencesIn(text).map((s) => s.phrase);

  // 1. THE THREE LIVE SITES, in the shape the audit found them (F15, 2026-09-06).
  const site1 = found("SignalGrid is an operational trust control plane for shared, mobile, and frontline environments.\n");
  expect("site-investor", site1.length === 1 && site1[0].startsWith("operational trust control plane"), `expected the phrase, got ${JSON.stringify(site1)}`);
  const site2 = found("- one investor narrative: an operational trust control plane without production claims.\n");
  expect("site-plan", site2.length === 0, `a phrase with no "SignalGrid is" is not a product sentence, got ${JSON.stringify(site2)}`);
  const site3 = found("- [ ] One investor narrative explains the operational trust control plane without claims.\n");
  expect("site-checklist", site3.length === 0, "the checklist line carries the variant but not the sentence shape");
  // …and the VARIANT watch catches all three lines, which is the point of having both
  // instruments: the sentence shape sees only site 1, the variant watch sees all three.
  const v1 = variantHitsIn("SignalGrid is an operational trust control plane for shared, mobile, and frontline environments.\n");
  const v2 = variantHitsIn("- one investor narrative: an operational trust control plane without production claims.\n");
  const v3 = variantHitsIn("- [ ] One investor narrative explains the operational trust control plane without claims.\n");
  expect("variant", v1.hits.length === 1 && v2.hits.length === 1 && v3.hits.length === 1, "the F15 variant must be seen on all three lines");

  // 1b. THE SECOND VARIANT (docs-chunk-2 audit F1): the BARE spelling, both forms,
  //     verbatim from docs/OPERATIONAL_HEALTH_DEX_LAYER_STRATEGY.md:9 and its shorter twin.
  const bare1 = variantHitsIn("It sits above those systems as a runtime trust orchestration layer that evaluates combined context.\n");
  expect("variant-bare", bare1.hits.length === 1 && bare1.hits[0].match === "runtime trust orchestration layer", `expected the runtime spelling, got ${JSON.stringify(bare1.hits)}`);
  const bare2 = variantHitsIn("SignalGrid is a trust orchestration platform for frontline work.\n");
  expect("variant-bare", bare2.hits.length === 1 && bare2.hits[0].match === "trust orchestration platform", `expected the bare spelling, got ${JSON.stringify(bare2.hits)}`);
  // …and it must NOT re-report the two spellings check-launch-claims.mjs already gates,
  //    or the ceiling and this report would name the same line and disagree about it.
  const gatedTail = variantHitsIn("SignalGrid is an Operational Trust Orchestration platform.\nA Zero Trust orchestration platform is what the site said.\n");
  expect("variant-bare", gatedTail.hits.length === 0, `the gated spellings must not be re-reported here, got ${JSON.stringify(gatedTail.hits)}`);
  // NEGATIVE 1 — a QUOTED mention is a document naming the phrase (docs/agent/EVIDENCE.md's shape).
  const vq = variantHitsIn('an outreach draft opening "I am building SignalGrid, a trust orchestration layer" was rewritten\n');
  expect("variant-quoted", vq.hits.length === 0 && vq.quoted.length === 1, `a quoted variant must be reported as quoted, got ${JSON.stringify(vq)}`);
  // …and a POSSESSIVE does not open a quotation, the same hole F1 found in the sibling gate.
  const vp = variantHitsIn("SignalGrid's trust orchestration layer decides what happens next.\n");
  expect("variant-quoted", vp.hits.length === 1 && vp.quoted.length === 0, `a possessive is not a quotation, got ${JSON.stringify(vp)}`);
  // NEGATIVE 2 — a BANNERED document is skipped whole, so its archived thesis is not
  //    reported as live drift. Proven through the predicate the scan actually uses.
  const banneredArchive = "# Old positioning\n\n> ## ⛔ SUPERSEDED 2026-08-26 — do not use\n\nSignalGrid is a trust orchestration platform.\n";
  const bv = readBanner(banneredArchive.split("\n"));
  expect(
    "variant-bannered",
    bv !== null && !bv.priorVersion && variantHitsIn(banneredArchive).hits.length === 1,
    "the fixture must BOTH carry a banner (so the scan skips the file) and contain a variant (so the skip is doing work)",
  );

  // 2. THE NEGATION, verbatim from docs/EXECUTIVE_ONE_PAGER.md:87. A gate that flagged
  //    this would teach the next author to delete the truest sentence on the page.
  const neg = found("SignalGrid is not an MDM: it never enrolls, configures, locks or wipes a device,\n");
  expect("negation", neg.length === 0, `"is not an MDM" must not be a product sentence, got ${JSON.stringify(neg)}`);
  expect("negation", NEGATION.test("SignalGrid is not an MDM") && NEGATION.test("SignalGrid is never a network enforcer"), "the explicit negation guard must match both forms");

  // 3. A QUOTATION is a document naming a string (docs/POSITIONING.md:53's shape).
  const q = sentencesIn('**Corrected 2026-09-02.** This section previously opened "SignalGrid is a decision gate".\n');
  expect("quoted", q.length === 1 && q[0].quoted === true, `a quoted sentence must be detected AND marked quoted, got ${JSON.stringify(q)}`);
  const unq = sentencesIn("SignalGrid is a decision gate.\n");
  expect("quoted", unq.length === 1 && unq[0].quoted === false, "the same sentence unquoted must not be marked quoted");

  // 4. A HEADING is a section title (docs/ECOSYSTEM_POSITIONING.md:420).
  expect("heading", found("## Where SignalGrid is the wrong answer\n").length === 0, "a heading must not be a product sentence");
  // 5. A FENCED command shown in a runbook is not a claim (VALIDATION_COMMANDS.md's shape).
  expect("fenced", found('```\ngit grep -nE "SignalGrid is a decision fabric"\n```\n').length === 0, "a fenced example must not be a product sentence");

  // 6. THE CANONICAL SECTION IS READ, NOT COPIED — and a missing heading is fatal.
  const canon = canonicalSection(
    "# P\n\n## 1. Purpose\n\nx\n\n## 2. Product\n\n**SignalGrid connects the systems a building already runs into one grid that decides and acts on the person's behalf.**\n\n## 3. Law\n",
  );
  expect("canon", /connects the systems/.test(canon) && !/## 3/.test(canon), `§2 must be extracted and bounded, got ${JSON.stringify(canon)}`);
  let threw = false;
  try {
    canonicalSection("# P\n\n## 2. Positioning\n\nx\n");
  } catch {
    threw = true;
  }
  expect("canon", threw, "a renamed/missing §2 heading must throw, never fall back to a default");
  // …and the vocabulary comparison must actually discriminate.
  const cw = new Set(contentWords(canon));
  expect("words", cw.has("connects") && cw.has("building") && !cw.has("the") && !cw.has("signalgrid"), `content words wrong: ${JSON.stringify([...cw])}`);
  expect(
    "words",
    contentWords("grid that decides and acts").filter((w) => cw.has(w)).length >= 2 &&
      contentWords("operational trust control plane").filter((w) => cw.has(w)).length === 0,
    "shared-vocabulary scoring must separate the canonical phrasing from the retired-label phrasing",
  );

  const bad = (id) => (fails.some((f) => f.startsWith(`${id}:`)) ? "✗" : "✓");
  console.log("Product-sentence drift self-test\n");
  console.log("   1. 'SignalGrid is an operational trust control plane' → DETECTED " + bad("site-investor"));
  console.log("   2. the same phrase with no 'SignalGrid is'            → not a sentence " + bad("site-plan"));
  console.log("   3. the checklist line carrying only the phrase        → not a sentence " + bad("site-checklist"));
  console.log("   4. the variant watch sees all three F15 lines        → present " + bad("variant"));
  console.log("  4b. bare / runtime trust orchestration layer|platform → REPORTED " + bad("variant-bare"));
  console.log("  4c. a QUOTED variant, and a POSSESSIVE                → quoted / asserted " + bad("variant-quoted"));
  console.log("  4d. a bannered archive carrying a variant             → file skipped " + bad("variant-bannered"));
  console.log("   5. 'SignalGrid is not an MDM' (ONE_PAGER:87)          → NOT reported " + bad("negation"));
  console.log("   6. a quoted sentence (POSITIONING:53 shape)           → marked quoted " + bad("quoted"));
  console.log("   7. '## Where SignalGrid is the wrong answer'          → not a sentence " + bad("heading"));
  console.log("   8. a fenced `git grep` example                        → not a sentence " + bad("fenced"));
  console.log("   9. §2 read from docs/PURPOSE.md, missing → throws     → " + bad("canon"));
  console.log("  10. shared-vocabulary scoring discriminates            → " + bad("words"));
  if (fails.length) {
    console.error("\n✗ Self-test FAILED:");
    for (const f of fails) console.error(`    · ${f}`);
    process.exit(1);
  }
  console.log("\nSelf-test passed — the detector finds the planted sentences and spares the honest idioms.");
}

// ── Entry point ──────────────────────────────────────────────────────────────────────
const MIN_SCANNED = 100;
const MIN_BANNERED = 5;
const MIN_CANON_CHARS = 120;

function main() {
  let r;
  try {
    r = auditProductSentences();
  } catch (err) {
    console.error(`✗ product-sentence report could not derive its canonical sentence: ${err.message}`);
    process.exit(1);
  }
  console.log("Product-sentence drift — REPORTED, never fatal. docs/PURPOSE.md §2 owns the product sentence.\n");
  console.log(`  canonical §2 (read from docs/PURPOSE.md, ${r.canon.length} chars):`);
  console.log(`    ${r.canon.split("\n").filter(Boolean)[0].slice(0, 150)}`);
  console.log(`\n  tracked docs/**/*.md:                       ${r.tracked}`);
  console.log(`  scanned:                                    ${r.scanned}`);
  console.log(`  skipped, bannered (an archive may keep its own retired thesis): ${r.banneredSkipped}`);
  console.log(`  skipped, excluded by name:                  ${r.excludedSkipped}`);
  for (const [p, why] of EXCLUDED) console.log(`      · ${p} — ${why}`);

  console.log(`\n  DISTINCT "SignalGrid is a/an/the …" sentences: ${r.byPhrase.size} (${r.findings.length} occurrence(s))`);
  const rows = [...r.byPhrase.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  for (const [phrase, hits] of rows) {
    const h = hits[0];
    console.log(`    · "${phrase.slice(0, 96)}"  [${h.shared}/${h.words} words shared with §2]`);
    for (const s of hits) console.log(`        ${s.rel}:${s.line}`);
  }

  console.log(`\n  Quoted — the document is NAMING a sentence, not asserting it (not drift): ${r.quoted.length}`);
  for (const q of r.quoted) console.log(`    · ${q.rel}:${q.line}  "${q.phrase.slice(0, 80)}"`);

  console.log(`\n  Near-miss label variants no gate matches (REPORTED, never gated): ${r.variantHits.length} asserted, ${r.variantQuoted.length} quoted`);
  for (const [re, why] of VARIANTS) console.log(`    · ${re} — ${why}`);
  for (const v of r.variantHits) console.log(`        ASSERTED  ${v.rel}:${v.line}  "${v.match}"`);
  for (const v of r.variantQuoted) console.log(`        quoted    ${v.rel}:${v.line}  "${v.match}"`);

  // FATAL only on a broken derivation — never on what was found.
  if (r.canon.length < MIN_CANON_CHARS) {
    console.error(`\n✗ docs/PURPOSE.md §2 read as only ${r.canon.length} characters (floor ${MIN_CANON_CHARS}) — the extraction drifted.`);
    process.exit(1);
  }
  if (r.scanned < MIN_SCANNED) {
    console.error(`\n✗ Only ${r.scanned} documents scanned (floor ${MIN_SCANNED}) — the corpus derivation drifted; a report over nothing is not a clean report.`);
    process.exit(1);
  }
  if (r.banneredSkipped < MIN_BANNERED) {
    console.error(`\n✗ Only ${r.banneredSkipped} bannered documents detected (floor ${MIN_BANNERED}) — the banner reader drifted, so the exclusion cannot be trusted.`);
    process.exit(1);
  }
  console.log("\nREPORT complete — nothing above is a failure. docs/PURPOSE.md §2 is canonical (DR-020); DR-019 ratified no category label.");
}

const isEntry = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  if (process.argv.includes("--self-test")) selfTest();
  else main();
}
