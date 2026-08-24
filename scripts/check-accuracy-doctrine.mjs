// Accuracy-doctrine gate — DR-015's gated half, and only its gated half.
//
// DR-015 makes seven rules binding on every agent: uncertainty declared,
// sources never invented, statistics flagged, recency acknowledged, quotes never
// fabricated, code symbols never invented, logic gaps asked about rather than
// filled. The owner directed that this be "the main starting point for the
// company".
//
// A doctrine that lives only in prose is the failure this repository keeps
// finding in itself. The security questionnaire pack promised assessors that a
// gate enforced four certification claims and it enforced two. The outreach
// rules promised every claim traced to POSITIONING.md and nothing checked it.
// Both were true sentences that no build could fail. So the doctrine gets a
// gate — for the part a gate can honestly hold.
//
// WHAT IS GATED, and why only this much:
//
//   RULE 2 (sources). Citation SHAPES that assert a verifiable external work —
//   an arXiv id, a DOI, an ISBN, an "et al." attribution — with no URL and no
//   admission that the source is unverified. This is the cheapest fabrication
//   to commit and the most expensive to have published: it reads authoritative
//   and it is checkable by anyone but the author.
//
//   RULE 3 (statistics). A figure about the OUTSIDE WORLD — a percentage of
//   organisations, an industry average, a market size — presented bare, with no
//   citation and no hedge. Figures about THIS repository are excluded: they are
//   already governed by the docs-to-proof figure guard, and double-gating them
//   would mean two gates disagreeing about one number.
//
// WHAT IS REPORTED, NOT GATED, said plainly because claiming otherwise would
// break Rule 1 on the doctrine's first day:
//
//   Rules 1, 4 and 7 are behavioural. No regex separates warranted confidence
//   from unwarranted confidence, or notices a question that should have been
//   asked. Rule 5 (quotes) is deliberately NOT gated: this repository's own
//   idiom is quoting the owner in his own words, sourced to a decision session
//   rather than to a URL, and a gate over attributed quotes would flag the
//   decision records wholesale — teaching the next author to stop quoting the
//   person whose direction the record exists to preserve. Rule 6 is already
//   carried by typecheck and the cited-path check.
//
// SCOPE: first-party documents only. Vendored third-party text is governed by
// its provenance file, not by our doctrine — we did not write it and we may not
// edit it.
//
// WHAT IS EXCLUDED, AND WHY — stated because it was not, and an undeclared
// exclusion is how a checker comes to report confidence about what it can see
// instead of uncertainty about what it cannot.
//
//   docs/inspiration/  EXCLUDED. Imported reference catalogues, not our prose.
//                      Those files say so themselves ("NOTHING in this
//                      repository consumes these contracts. They are a
//                      reference"). Doctrine governs what we assert, and we do
//                      not assert these.
//   docs/research/     NO LONGER EXCLUDED, as of 2026-08-24. It had been, with
//                      no reason given anywhere, and it holds 43 FIRST-PARTY
//                      documents — the competitive briefs, the buyer/partner
//                      readiness pack, the outreach material. Precisely the
//                      prose an accuracy gate exists for, and precisely the
//                      prose most likely to carry an external claim.
//
// The removal was MEASURED before it was made, not asserted: including the tree
// took the scan from 236 documents to 279 and produced ZERO new violations. The
// exclusion was costing forty-three documents of coverage and buying nothing.
// That is the opposite outcome from the sibling case the same day — an
// absence-claim gate whose candidate patterns matched 54 lines of correct
// safety prose and was therefore not built. Measure, then decide; the answer
// went different ways on the same afternoon.
//
// SELF-TEST: each gated rule must flag a synthetic violation and must NOT flag
// its honest counterpart. A gate that cannot fail proves nothing; a gate that
// punishes honesty is worse than no gate.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["docs"];
const SKIP = /(^|\/)(node_modules|dist|build|\.git)(\/|$)|^docs\/inspiration\//;
const VENDORED = /^(vendor|\.claude\/skills)\//;

// An external, verifiable work is being asserted.
const CITATION_SHAPE = /\barXiv:\s*\d{4}\.\d{4,5}\b|\bdoi:\s*10\.\d{4,}|\bISBN[- ]?(?:13|10)?:?\s*[\d-]{10,}|\b[A-Z][a-z]+ et al\.(?:,|\s)\s*\(?\d{4}\)?/;
// A URL, or an honest admission, discharges it.
const SOURCE_OR_ADMISSION = /https?:\/\/|\bI do not have a verified source\b|\bno verified source\b|\bunverified\b|\bcould not verify\b/i;

// A figure about the world outside this repository.
const EXTERNAL_STAT =
  /\b\d{1,3}(?:\.\d+)?%\s+of\s+(?:all\s+)?(?:organi[sz]ations|companies|hospitals|enterprises|teams|firms|businesses|IT departments|respondents|buyers)\b|\bthe average\s+(?:breach|incident|organi[sz]ation|company|hospital|deployment)\s+(?:costs?|spends?|loses?)\s+\$?\d|(?<![\w$])\$\d+(?:\.\d+)?\s*(?:B|M|billion|million)\s+(?:market|TAM|opportunity|industry)\b/i;
// A citation, or a hedge, discharges it.
const STAT_DISCHARGE = /https?:\/\/|\bapproximately\b|\broughly\b|\bwe have not verified\b|\bunverified\b|\bverify (?:this )?(?:against|with) a primary source\b|\bno verified source\b/i;

function blocksOf(body) {
  const lines = body.split("\n");
  const blocks = [];
  let cur = { start: 1, lines: [] };
  lines.forEach((l, i) => {
    if (l.trim() === "" && cur.lines.length > 0) {
      blocks.push(cur);
      cur = { start: i + 2, lines: [] };
    } else cur.lines.push(l);
  });
  if (cur.lines.length > 0) blocks.push(cur);
  return blocks.map((b) => ({ start: b.start, text: b.lines.join("\n") }));
}

function violationsIn(name, body) {
  const out = [];
  for (const b of blocksOf(body)) {
    if (CITATION_SHAPE.test(b.text) && !SOURCE_OR_ADMISSION.test(b.text)) {
      out.push(`${name}:${b.start}: RULE 2 — cites an external work (${(b.text.match(CITATION_SHAPE) || [""])[0].trim()}) with no URL and no admission that it is unverified`);
    }
    if (EXTERNAL_STAT.test(b.text) && !STAT_DISCHARGE.test(b.text)) {
      out.push(`${name}:${b.start}: RULE 3 — states a figure about the outside world with no citation and no hedge: "${(b.text.match(EXTERNAL_STAT) || [""])[0].trim()}"`);
    }
  }
  return out;
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const badCite = "As shown in Smith et al. (2024), shared devices are the weak point.";
  const goodCite = "As shown in Smith et al. (2024) — https://example.org/paper — shared devices are the weak point.";
  const honestCite = "Smith et al. (2024) is cited in a sales deck; I do not have a verified source for it.";
  const badStat = "73% of hospitals run shared devices without per-action authorization.";
  // ARM 3 WAS DEAD AND NO TEST NOTICED, because every fixture exercised arm 1 or 2.
  // The pattern opened `\b\$`, and a word boundary cannot exist between a space
  // and `$` — both are non-word characters. So the market-size arm could only fire
  // on `x$12B market`, which nobody writes, and "a $12B market opportunity" — one
  // of the three shapes this gate explicitly targets — sailed through from the day
  // it was written. Found by disbelieving a CONTROL rather than the code: it was
  // used as a positive fixture in an unrelated check and did not match.
  const badMarket = "SignalGrid addresses a $12B market opportunity.";
  const goodMarket = "SignalGrid addresses a $12B market opportunity — https://example.org/tam.";
  const goodStat = "Approximately 73% of hospitals run shared devices this way; verify against a primary source.";
  const ok =
    violationsIn("a", badCite).length > 0 &&
    violationsIn("b", goodCite).length === 0 &&
    violationsIn("c", honestCite).length === 0 &&
    violationsIn("d", badStat).length > 0 &&
    violationsIn("e", goodStat).length === 0 &&
    violationsIn("f", badMarket).length > 0 &&
    violationsIn("g", goodMarket).length === 0;
  if (!ok) {
    console.error("✗ SELF-TEST FAILED: a gated rule no longer flags its synthetic violation, or now flags its honest counterpart. A gate that cannot fail proves nothing; a gate that punishes honesty is worse than no gate.");
    process.exit(1);
  }
}

const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (SKIP.test(p) || VENDORED.test(p)) continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(md|html)$/.test(p)) files.push(p);
  }
};
ROOTS.forEach(walk);

// ── coverage self-test: the subject cannot silently shrink ───────────────────
// docs/research/ sat outside this gate for a long time with no reason recorded
// anywhere, costing 43 first-party documents — the competitive briefs and the
// outreach material among them. It was invisible because a gate that scans less
// still prints that it passed. Both exclusions are now asserted in BOTH
// directions, so removing a tree from coverage, or quietly re-adding one, fails
// the build instead of shrinking the number in the summary line.
{
  const covers = (prefix) => files.some((f) => f.startsWith(prefix));
  if (!covers("docs/research/")) {
    console.error("✗ SELF-TEST FAILED: docs/research/ is not being scanned. It holds first-party prose — competitive briefs, the buyer/partner pack, outreach copy — and an accuracy gate that cannot see it reports confidence about the rest.");
    process.exit(1);
  }
  if (covers("docs/inspiration/")) {
    console.error("✗ SELF-TEST FAILED: docs/inspiration/ is being scanned. It is imported reference material this repository does not assert, and gating it would punish text we did not write. If that changed, change the SCOPE note above first.");
    process.exit(1);
  }
}

console.log("Accuracy doctrine — DR-015, the half a gate can honestly hold\n");
let problems = 0;
for (const f of files) {
  for (const v of violationsIn(f, readFileSync(f, "utf8"))) {
    console.error(`  ✗ ${v}`);
    problems += 1;
  }
}

console.log(
  `\naccuracy-doctrine: ${files.length} first-party documents scanned; GATED rules 2 and 3, ` +
    `${problems} violation(s). REPORTED, not gated: rules 1, 4, 5 and 7 — behavioural, or already ` +
    "carried by another gate. Saying which is which IS rule 1. Self-test green",
);
if (problems > 0) {
  console.error(
    "\nAccuracy-doctrine gate FAILED — DR-015: a wrong answer delivered confidently is worse than\n" +
      "no answer. Add the source, hedge the figure, or say plainly that it is unverified.",
  );
  process.exit(1);
}
console.log("Accuracy-doctrine gate passed — no unsourced citation and no bare external statistic.");
