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
// SELF-TEST: each gated rule must flag a synthetic violation and must NOT flag
// its honest counterpart. A gate that cannot fail proves nothing; a gate that
// punishes honesty is worse than no gate.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["docs"];
const SKIP = /(^|\/)(node_modules|dist|build|\.git)(\/|$)|^docs\/research\/|^docs\/inspiration\//;
const VENDORED = /^(vendor|\.claude\/skills)\//;

// An external, verifiable work is being asserted.
const CITATION_SHAPE = /\barXiv:\s*\d{4}\.\d{4,5}\b|\bdoi:\s*10\.\d{4,}|\bISBN[- ]?(?:13|10)?:?\s*[\d-]{10,}|\b[A-Z][a-z]+ et al\.(?:,|\s)\s*\(?\d{4}\)?/;
// A URL, or an honest admission, discharges it.
const SOURCE_OR_ADMISSION = /https?:\/\/|\bI do not have a verified source\b|\bno verified source\b|\bunverified\b|\bcould not verify\b/i;

// A figure about the world outside this repository.
const EXTERNAL_STAT =
  /\b\d{1,3}(?:\.\d+)?%\s+of\s+(?:all\s+)?(?:organi[sz]ations|companies|hospitals|enterprises|teams|firms|businesses|IT departments|respondents|buyers)\b|\bthe average\s+(?:breach|incident|organi[sz]ation|company|hospital|deployment)\s+(?:costs?|spends?|loses?)\s+\$?\d|\b\$\d+(?:\.\d+)?\s*(?:B|M|billion|million)\s+(?:market|TAM|opportunity|industry)\b/i;
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
  const goodStat = "Approximately 73% of hospitals run shared devices this way; verify against a primary source.";
  const ok =
    violationsIn("a", badCite).length > 0 &&
    violationsIn("b", goodCite).length === 0 &&
    violationsIn("c", honestCite).length === 0 &&
    violationsIn("d", badStat).length > 0 &&
    violationsIn("e", goodStat).length === 0;
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
