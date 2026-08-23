// Launch-claims gate — buyer-facing copy may not assert deferred capability
// as current (backlog row 6's gate half; basis DR-011/DR-012).
//
// The defect this exists to prevent SHIPPED once: the public site presented
// six signal dimensions as "Evaluated today" while three were deferred, and
// no gate read the copy. Rules, each learned from that page or from the two
// pages that got it RIGHT (Federal/Hardware hedge every deferred mention):
//
//   1. The exact overclaim markers of the shipped defect may never return:
//      "Evaluated today" / `evaluated: true` in buyer-facing sources.
//   2. "Limited GA" may label ONLY the three launch signal kinds — a fourth
//      card wearing the label is scope creep in a costume.
//   3. A deferred-capability noun (badge binding, custody, zones, shift
//      windows, proximity, tamper sensing, GPS…) may appear in a buyer-facing
//      file only if a hedging marker (design target / design concept / roadmap
//      / pre-announcement / "Beyond Limited GA" / "not shipping") sits in the
//      SAME BLOCK. Hedged mention is honest breadth; bare mention reads as
//      product.
//
//      WHY "SAME BLOCK" AND NOT "SAME FILE". Rule 3 was file-scoped, and a
//      published page exploited it without anyone meaning to. `docs/pitch-deck.html`
//      — deployed to signalgrid.app by pages.yml — sells the product on slide 5
//      as "badge / who + device custody & tamper + security baseline + workflow
//      risk -> one verdict", with a whole card titled "Custody as a decision
//      input". Badge, custody and tamper are all DEFERRED. The file passed
//      green because slide 1, fifty-four lines earlier, carried the words
//      "Pre-production concept", and slide 10 said "Roadmap".
//
//      That is blanket immunity bought with a single word. A buyer reading the
//      "How it works" slide has no reason to connect it to a stage label on the
//      title slide, and the deck's own UNDERstatement was what licensed its
//      OVERstatements. A hedge on slide 1 does not make slide 5 honest, so the
//      hedge now has to be where the claim is: the same <section> in HTML, the
//      same paragraph elsewhere.
//
// SELF-TEST FIRST: each rule must flag a synthetic violation, or the gate
// refuses to conclude anything.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["artifacts/signalgrid-web/src"];
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(tsx|ts|html|md)$/.test(p)) files.push(p);
  }
};
ROOTS.forEach(walk);

// The SPA source is not the whole public surface. `.github/workflows/pages.yml`
// also copies standalone docs/*.html pages straight to signalgrid.app — seven
// of them at the time this was widened — and the first version of this gate
// never read one, so a battlecard carrying sixteen unhedged deferred-capability
// claims sat published and green. The published set is DERIVED from the deploy
// workflow rather than hand-listed here, because a hand-listed copy of a
// deploy manifest is a fossil waiting to happen: add a page to pages.yml and
// this gate reads it on the next run, with no second edit to remember.
const PAGES_WORKFLOW = ".github/workflows/pages.yml";
let publishedPages = [];
try {
  const wf = readFileSync(PAGES_WORKFLOW, "utf8");
  publishedPages = [...wf.matchAll(/cp\s+(docs\/[A-Za-z0-9._-]+\.html)/g)].map((m) => m[1]);
} catch {
  console.error(`✗ ${PAGES_WORKFLOW} unreadable — cannot derive the published page set, and guessing it would defeat the gate.`);
  process.exit(1);
}
if (publishedPages.length === 0) {
  console.error(`✗ no published pages derived from ${PAGES_WORKFLOW} — the deploy step's shape changed; fix this derivation, do not silently scan less.`);
  process.exit(1);
}
for (const p of publishedPages) if (existsSync(p) && !files.includes(p)) files.push(p);

// The website is not the only thing that reaches a stranger. `docs/outreach/`
// is sent to real prospects, as real email, under the owner's own identity and
// increasingly without a human reading each one first — which makes it the
// surface where an overclaim costs the most and gets checked the least.
// `OPERATING_RULES.md` already promises that "any deviation still traces every
// product claim to POSITIONING.md", and `TEMPLATES.md` writes a claim-trace
// line under each template. Both promises were prose. Prose does not fail a
// build, and the same rule written down in the security questionnaire pack had
// already turned out to be unenforced for two of its four frameworks.
//
// Scope is DERIVED twice over: every document in the outreach directory, plus
// every doc those documents name as a claim-trace target (today POSITIONING.md
// and PILOT_PACKAGE.md — the pilot package IS what a prospect receives, so a
// deferred family presented as current in it is an overclaim made to a buyer).
// Adding a template that cites a new document pulls that document in on the
// next run, with no second edit to remember.
const OUTREACH_DIR = "docs/outreach";
let outreachScanned = 0;
if (existsSync(OUTREACH_DIR)) {
  const outreachDocs = readdirSync(OUTREACH_DIR)
    .filter((e) => /\.(md|html)$/.test(e))
    .map((e) => join(OUTREACH_DIR, e));
  if (outreachDocs.length === 0) {
    console.error(
      `✗ ${OUTREACH_DIR} exists but yielded no documents — the outreach surface's shape changed; ` +
        "fix this derivation, do not silently scan less.",
    );
    process.exit(1);
  }
  const cited = new Set();
  for (const d of outreachDocs) {
    for (const m of readFileSync(d, "utf8").matchAll(/\b([A-Z][A-Z0-9_]{3,})\.md\b/g)) {
      const candidate = join("docs", `${m[1]}.md`);
      if (existsSync(candidate)) cited.add(candidate);
    }
  }
  for (const p of [...outreachDocs, ...cited]) if (!files.includes(p)) files.push(p);
  outreachScanned = outreachDocs.length + cited.size;
}

// A third derivation, because the first two still missed a document whose whole
// purpose is to be handed to an outsider. `docs/EXECUTIVE_ONE_PAGER.md` sat
// outside every scope while opening with a founder's name and a public address
// — and it predated DR-011, DR-012 and DR-013 in every section: a retired
// product label, four deferred families named as connected capability, buyers
// courted "regardless of company size", and the proof described as synthetic
// when live open-source proof already existed.
//
// The rule that catches it without a hand-list: a document that PUBLISHES THE
// CONTACT ADDRESS is addressed to someone outside this repository, by
// construction. Nobody prints hello@signalgrid.app for an internal reader. Write
// a new one-pager tomorrow and it is in scope the moment it carries the address,
// which is precisely when it starts being able to do harm.
//
// ONE KNOWN WRINKLE, recorded rather than papered over: this rule cannot tell a
// document that PRINTS the address from one that merely DISCUSSES it. Spelling
// the address out inside commentary pulls that document into buyer-facing scope
// — which is how the build-plan row describing this very rule first failed the
// gate. Teaching the rule that difference would be markedly more fragile than
// the rule itself, so the guidance is simply: do not spell the address out when
// writing ABOUT it.
//
// A superseded document opts out by SAYING SO — the PAGE_SCOPE disclaimer
// below already means "nothing here is a claim of current capability", which is
// exactly what a retired document is. That keeps the archival boundary a
// property of the document rather than of the folder it happens to sit in;
// `docs/research/` earns no exemption for its name.
const CONTACT_LINE = /hello@signalgrid\.app/;
let contactScanned = 0;
const walkDocs = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) {
      walkDocs(p);
      continue;
    }
    if (!/\.(md|html)$/.test(p)) continue;
    if (files.includes(p)) continue;
    if (!CONTACT_LINE.test(readFileSync(p, "utf8"))) continue;
    files.push(p);
    contactScanned += 1;
  }
};
if (existsSync("docs")) walkDocs("docs");

// Case- and separator-insensitive: the first version matched only the exact
// string "Evaluated today", and the pricing page's "6 evaluated-today signal
// dimensions" — a claim of SIX current dimensions against a three-signal
// launch scope — sailed through green. A marker that only catches one casing
// of its own defect is a marker that catches nothing.
const OVERCLAIM_MARKERS = [
  /evaluated[\s-]today/i,
  /evaluated:\s*true/i,
  /\b([4-9]|\d{2,})\s+(?:evaluated[\s-]today\s+)?signal dimensions/i,
];
const LAUNCH_IDS = new Set(["device-posture", "management-health", "local-authority"]);
const DEFERRED_NOUNS =
  /badge\s?(binding|state|tap|present)|custody|geofence|zone\b|shift window|shift-scoped|BLE proximity|proximity confirm|tamper (sensor|witness|detection)|GPS|RTLS/i;
// Hedges the copy ACTUALLY uses. Tightening rule 3 to block scope exposed that
// this vocabulary was too narrow in the other direction: Hardware.tsx hedges with
// "candidate signals, not evaluated today" and IntegrationsSection with "candidate
// categories, not live integrations" — both unambiguous disclaimers, neither
// spelled the way this list expected. A gate that only recognises its own
// preferred phrasing teaches authors to write for the regex instead of for the
// reader, so the honest idioms already in use are recognised as what they are.
// A block that lists phrases NOT to use is the inverse of a claim. The
// battlecard's "Trap phrases to avoid" chips include "badge tap" precisely to
// stop a seller saying it — flagging that would tell the next author to delete
// the warning in order to please the gate, which is the same honesty penalty
// the negation-stripping above exists to prevent. Third time this pattern has
// surfaced while tightening rule 3, and the shape is always the same: the copy
// was already honest in an idiom the gate had not been taught to read.
const AVOID_LIST = /trap phrases|phrases to avoid|words to avoid|never say|do not say|don'?t say/i;
const HEDGES =
  /design (target|concept)|roadmap|pre-announcement|pre-production|Beyond Limited GA|\bdeferred\b|not (shipping|claimed|available|Limited GA|evaluated today|live integrations)|nothing here is available|candidate (signal|categor|source)/i;

// A whole-page scope disclaimer legitimately covers every block beneath it —
// but only when it disclaims CURRENT CAPABILITY in so many words, naming the
// page. `docs/fabric-console.html` opens with exactly that: a banner saying the
// page demonstrates families that are deferred and that "Nothing here is a claim
// of current capability." A demo console is allowed to demo the deferred half of
// the fabric when it says so at the top, and block-scoping alone would have
// flagged that page for being honest in the one place honesty belongs.
//
// The bar is deliberately this high because the pitch deck fails it. Its slide-11
// footer reads "pre-production review artifacts, not a shipping product" — a claim
// about the ARTIFACT's status, not a disclaimer that the capabilities on slide 5
// are unshipped, and buried in the last section rather than announced before the
// claims. Artifact-stage language is not a capability disclaimer.
const PAGE_SCOPE =
  /nothing (here|below|on this page) is (a claim of current capability|available|claimed)|this page demonstrates[^.]{0,200}\bdeferred\b/i;

// A marker inside a NEGATION is the copy doing the right thing: Hardware.tsx
// says "UWB, PACS door events, and carrier location are candidate signals, NOT
// evaluated today", which is exactly the honesty this gate wants — and the
// first widened version flagged it, which would have taught the next author to
// delete a true sentence to appease a gate. Strip negated occurrences before
// testing; a gate that punishes honesty is worse than no gate.
const stripNegated = (body) =>
  body
    .replace(/\bnot\b[^.<\n]{0,60}?evaluated[\s-]today/gi, " ")
    .replace(/\bnever\b[^.<\n]{0,60}?evaluated[\s-]today/gi, " ")
    .replace(/what(?:'|&#39;|\u2019)?s evaluated today/gi, " ");

// The unit a hedge covers. A slide deck's <section> is a slide and a reader
// takes it in whole; prose splits at the blank line. Both are the largest span
// a reader actually holds in view at once, which is the only span a hedge can
// honestly qualify. Blocks carry their starting line so a violation can point
// at the claim rather than at the file.
function blocksOf(name, body) {
  const lines = body.split("\n");
  const isHtml = /\.html?$/.test(name) || /<section[\s>]/.test(body);
  const boundary = isHtml ? (l) => /<section[\s>]/.test(l) : (l) => l.trim() === "";
  const blocks = [];
  let cur = { start: 1, lines: [] };
  lines.forEach((l, i) => {
    if (boundary(l) && cur.lines.length > 0) {
      blocks.push(cur);
      cur = { start: i + 1, lines: [] };
    }
    cur.lines.push(l);
  });
  if (cur.lines.length > 0) blocks.push(cur);
  return blocks.map((b) => ({ start: b.start, text: b.lines.join("\n") }));
}

function violationsIn(name, body) {
  const out = [];
  const scannable = stripNegated(body);
  for (const re of OVERCLAIM_MARKERS) {
    if (re.test(scannable)) out.push(`${name}: overclaim marker ${re} — the shipped defect's exact shape`);
  }
  for (const m of body.matchAll(/limitedGA:\s*true/g)) {
    const before = body.slice(0, m.index);
    const idm = [...before.matchAll(/id:\s*"([a-z-]+)"/g)].pop();
    if (!idm || !LAUNCH_IDS.has(idm[1])) {
      out.push(`${name}: "Limited GA" label on non-launch signal id ${idm ? `"${idm[1]}"` : "(unidentifiable)"}`);
    }
  }
  const pageScoped = PAGE_SCOPE.test(body);
  for (const block of pageScoped ? [] : blocksOf(name, body)) {
    if (!DEFERRED_NOUNS.test(block.text) || HEDGES.test(block.text) || AVOID_LIST.test(block.text)) continue;
    const rel = block.text.split("\n").findIndex((l) => DEFERRED_NOUNS.test(l));
    const noun = (block.text.match(DEFERRED_NOUNS) || [""])[0];
    out.push(
      `${name}:${block.start + rel}: deferred-capability noun "${noun}" with NO hedging marker in its own block ` +
        "(a hedge elsewhere in the file does not reach this claim)",
    );
  }
  return out;
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const bad0 = "6 evaluated-today signal dimensions";
  const bad1 = 'const x = { evaluated: true };';
  const bad2 = '{ id: "badge", limitedGA: true }';
  const bad3 = "Our badge binding restricts the session live.";
  const good3 = "Badge binding is a design target on the roadmap.";
  const goodNeg = "UWB and PACS door events are candidate signals, not evaluated today.";
  // The distant-hedge defect itself: hedge on one slide, bare claim on another.
  // This is the case the file-scoped rule called green, so it is the case the
  // gate must now be able to fail — otherwise the widening is decorative.
  const farHedge =
    '<section>\n<span class="stage">Pre-production concept</span>\n</section>\n' +
    "<section>\n<p>device custody &amp; tamper detection feed the verdict.</p>\n</section>\n";
  const nearHedge =
    "<section>\n<p>Custody is a design target, not shipping at Limited GA.</p>\n</section>\n";
  // Page-scope disclaimer, both directions. The honest banner exempts the page;
  // artifact-stage language in a trailing footer must NOT, or the pitch deck's
  // exact defect walks straight back in through the exemption meant to spare
  // the console.
  const pageBanner =
    "<div>Scope: this page demonstrates the full signal fabric, including families that are " +
    "deferred. Nothing here is a claim of current capability.</div>\n" +
    "<section>\n<p>device custody &amp; tamper detection feed the verdict.</p>\n</section>\n";
  const artifactFooter =
    "<section>\n<p>device custody &amp; tamper detection feed the verdict.</p>\n</section>\n" +
    '<section>\n<p class="foot">pre-production review artifacts, not a shipping product.</p>\n</section>\n';
  const avoidList =
    "<section>\n<h3>Trap phrases to avoid</h3>\n<span>badge tap / tap-and-go</span>\n</section>\n";
  const honestIdiom =
    "<section>\n<p>UWB and carrier location are candidate signals, not evaluated today; custody is modeled on fixtures.</p>\n</section>\n";
  const st =
    violationsIn("st0", bad0).length > 0 &&
    violationsIn("st1", bad1).length > 0 &&
    violationsIn("st2", bad2).length > 0 &&
    violationsIn("st3", bad3).length > 0 &&
    violationsIn("st4", good3).length === 0 &&
    violationsIn("st5", goodNeg).length === 0 &&
    violationsIn("st6.html", farHedge).length > 0 &&
    violationsIn("st7.html", nearHedge).length === 0 &&
    violationsIn("st8.html", pageBanner).length === 0 &&
    violationsIn("st9.html", artifactFooter).length > 0 &&
    violationsIn("st10.html", honestIdiom).length === 0 &&
    violationsIn("st11.html", avoidList).length === 0 &&
    violationsIn("st12.html", avoidList.replace("Trap phrases to avoid", "Signals we fuse")).length > 0;
  if (!st) {
    console.error("✗ SELF-TEST FAILED: a rule no longer flags its synthetic violation. A gate that cannot fail proves nothing.");
    process.exit(1);
  }
}

let problems = 0;
for (const f of files) {
  if (f.endsWith("check-launch-claims.mjs")) continue;
  for (const v of violationsIn(f, readFileSync(f, "utf8"))) {
    console.error(`  ✗ ${v}`);
    problems += 1;
  }
}

console.log(
  `launch-claims: ${files.length} buyer-facing files scanned ` +
    `(${publishedPages.length} derived from the Pages deploy, ${outreachScanned} from the outreach surface ` +
    `and the documents it cites, ${contactScanned} from carrying the public contact address), ` +
    `${problems} violation(s); self-test green`,
);
if (problems > 0) {
  console.error(
    "\nLaunch-claims gate FAILED — buyer-facing copy asserts deferred capability as current.\n" +
      "Fix the copy to docs/POSITIONING.md, or hedge the mention explicitly (design target /\n" +
      "roadmap / Beyond Limited GA). Never fix the gate to fit the copy.",
  );
  process.exit(1);
}
console.log("Launch-claims gate passed — nothing deferred is presented as current.");
