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
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The published web surface is not just the marketing site. `Dockerfile.web`
// builds each app and COPYs its `dist/public` into the served nginx image
// (signalgrid-web at "/", signalgrid-app at "/app/"), so every app whose built
// output ships is buyer-reachable and must be scanned. ROOTS is DERIVED from
// those COPY lines rather than hand-listed, for the same reason the published-
// pages set is derived from pages.yml below: a hand copy of a deploy manifest is
// a fossil waiting to happen. Each `artifacts/<pkg>/dist/public/` copy maps to
// that package's SOURCE root `artifacts/<pkg>/src` — the gate scans source, not
// built output — and a mapped source that is missing is fatal, never silently
// dropped (that would scan less without saying so).
const WEB_DOCKERFILE = "Dockerfile.web";
let ROOTS = [];
try {
  const df = readFileSync(WEB_DOCKERFILE, "utf8");
  ROOTS = [
    ...new Set(
      [...df.matchAll(/artifacts\/([A-Za-z0-9._-]+)\/dist\/public\//g)].map(
        (m) => `artifacts/${m[1]}/src`,
      ),
    ),
  ];
} catch {
  console.error(
    `✗ ${WEB_DOCKERFILE} unreadable — cannot derive the served web roots, and guessing them would defeat the gate.`,
  );
  process.exit(1);
}
if (ROOTS.length === 0) {
  console.error(
    `✗ no served web roots derived from ${WEB_DOCKERFILE} — the COPY … dist/public lines changed shape; fix this derivation, do not silently scan less.`,
  );
  process.exit(1);
}
for (const r of ROOTS) {
  if (!existsSync(r)) {
    console.error(
      `✗ derived web root ${r} does not exist — the Dockerfile COPYs its dist/public but its source is gone; fix the derivation, do not silently scan less.`,
    );
    process.exit(1);
  }
}
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

// EVERY TRACKED HTML PAGE UNDER site/, deployed or not. `site/index.html` is the
// pre-SPA landing page: pages.yml uses only `site/CNAME` from that directory, so
// the page is not served — and it was outside this scan while asserting three
// deferred signals as "what the core reasons over today" (2026-09-05, sixth
// audit round). A buyer-facing HTML file that sits next to the CNAME pinning
// the public domain is one deploy-step edit away from being served; it is
// scanned whether or not it is served today. Derived from the tree, never
// hand-listed.
try {
  const sitePages = execFileSync("git", ["ls-files", "-z", "--", "site/*.html", "site/**/*.html"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  for (const p of sitePages) if (existsSync(p) && !files.includes(p)) files.push(p);
} catch {
  console.error("✗ could not enumerate site/*.html with git — the landing-page scan cannot be derived, and guessing it would defeat the gate.");
  process.exit(1);
}

// THE LANDING PAGE ITSELF, and the reason it is named rather than derived.
//
// Everything above derives the public surface from `pages.yml` — what the
// DEPLOY WORKFLOW publishes. On 2026-08-24 the live page was fetched and it is
// not that at all: https://danfashauer.github.io/SignalGrid-Review-Hub/ serves
// README.md rendered by Jekyll's default theme. Zero Vite fingerprints, the
// stock `assets/css/style.css`, and the body text is README verbatim — the
// first sentence a reviewer reads is README line 3.
//
// So this gate was scanning the pages a workflow WOULD publish while the site
// served a file it had never read. Accurate about the deployment, silent about
// the deployment that is actually happening. Running these same rules against
// README.md found a real violation on the live page: an unhedged deferred
// capability in the simulator paragraph.
//
// DR-004 is explicit about why this matters, in the owner's words: "lock the
// site to the ratified Shared-Device Trust Gateway scope; and add a gate so
// marketing cannot drift beyond implemented capability again." The gate existed
// and could not see the site.
//
// NOT DERIVED, deliberately. Which files GitHub Pages serves is a repository
// SETTING, not a fact in this tree, and the Pages API is unreachable from this
// lane (403 at the proxy) — so there is nothing here to derive it from. Naming
// README.md and failing loudly if it disappears is the honest substitute; a
// derivation invented from a source that cannot see the answer would be worse
// than an explicit name.
const LANDING_PAGE = "README.md";
if (!existsSync(LANDING_PAGE)) {
  console.error(
    `✗ ${LANDING_PAGE} is missing — it is the file GitHub Pages serves as the landing page, ` +
      "so losing it from coverage means the gate stops reading the site itself. Do not silently scan less.",
  );
  process.exit(1);
}
if (!files.includes(LANDING_PAGE)) files.push(LANDING_PAGE);

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
// `withFileTypes` rather than a separate statSync: asking readdir what each
// entry IS removes the check-then-use pair that CodeQL flagged here as a
// filesystem race (stat says file, read happens later against something that
// may have changed). No attacker is racing a build-time gate against its own
// repository, but the finding is right about the shape, and the version without
// the race is also the shorter one. The read is guarded because a file can
// still vanish between the listing and the open, and a gate that dies on a
// disappearing file would fail for a reason that has nothing to do with claims.
const walkDocs = (d) => {
  for (const entry of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, entry.name);
    if (entry.isDirectory()) {
      walkDocs(p);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(md|html)$/.test(p)) continue;
    if (files.includes(p)) continue;
    let body;
    try {
      body = readFileSync(p, "utf8");
    } catch {
      continue;
    }
    if (!CONTACT_LINE.test(body)) continue;
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
// `zone` IS WORD-ANCHORED ON BOTH SIDES, and it was anchored on the right only.
// `zone\b` matched the TAIL of every identifier ending in the word, so a document
// NAMING A STRING read as a document CLAIMING A CAPABILITY. One of those pushed the
// docs ceiling over on 2026-09-02 and failed this gate on a truthful field-set table
// — the failure mode this repository has now hit four times, whose fix is always to
// teach the gate the honest idiom and never to delete the true sentence.
//
// THREE MEASUREMENTS, because they answer three different questions and an earlier
// version of this comment gave a hand count for all of them ("Eleven lines") without
// saying which. Each is reproduced by diffing the two regexes over `git ls-files docs`:
//
//   4 mentions across 3 files — the CEILING delta, and the only exact figure that
//     matters here: this gate's unit is mentions, and it recorded 520 → 516 itself.
//   11 lines across 7 files — lines where the WHOLE deferred-noun rule stopped
//     matching (no other deferred noun on the line).
//   19 lines across 9 files — lines where any `zone` TOKEN stopped matching, most of
//     which still match the rule on a different noun (`RTLS` on the same line).
//
// The idioms, so the next reader can check rather than trust: identifier suffixes
// (`LocationZone` — a Microsoft Sentinel column in a field-set table — `expectedZone`,
// `detectedZone`, `networkZone`), snake_case state values (`in_zone`, `off_zone`,
// `rtls.wrong_zone`), Python's `timezone`, a hostname (`techzone.omnissa.com`), and
// two vendor PRODUCT names (AWS `DataZone`, Bitdefender `GravityZone`). Not one of
// them asserts that zone capability ships. No claim stopped matching.
//
// `custody` IS WORD-ANCHORED FOR THE SAME REASON, added when the served operator
// console (artifacts/signalgrid-app, now a derived ROOT) was first scanned. Bare
// `custody` matched the TAIL and HEAD of identifiers that only NAME the reason-code
// family — a TypeScript interface `CustodyGap`, its field `custodyGaps`, and the
// SCREAMING_SNAKE reason-code keys `CUSTODY_OVERDUE`/`CUSTODY_EXCEPTION`/
// `CUSTODY_MAINTENANCE` in the IT-layer owner map — none of which assert the custody
// signal ships. `\bcustody\b` leaves those (a word char sits on one side) while still
// flagging genuine prose: "device custody", "physical custody:", "Custody gaps".
const DEFERRED_NOUNS =
  /badge\s?(binding|state|tap|present)|\bcustody\b|geofence|\bzone\b|shift window|shift-scoped|BLE proximity|proximity confirm|tamper (sensor|witness|detection)|GPS|RTLS/i;
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

// Retired category labels. DR-004 reconciled the site to "Shared-Device Trust
// Gateway" and reconciled the earlier finalists OUT — "not kept as synonyms". A
// buyer-facing surface using one is drift the site's own decision record forbids,
// and unlike a deferred capability it cannot be hedged into truth: the label is
// simply wrong now. Exempt a line that names the label AS retired/superseded — a
// decision record and a "renamed to X" note must be able to say the old words,
// the same honesty carve-out the deferred-noun rule makes for negations.
// "Shared-Device Trust Gateway" joined this list 2026-08-31: DR-004 ratified
// it, DR-019/DR-020 superseded it, and the deployed site then carried it for
// five days while this gate — still enforcing DR-004's ruling — read the label
// as the CORRECT one. No replacement category label is ratified (DR-020).
const RETIRED_LABELS = /Zero[\s-]Trust orchestration|Operational Trust Orchestration|Shared-Device Trust Gateway/i;
const RETIRED_OK = /retired|superseded|deprecat|renamed|former(ly)?|no longer|DR-004|historical|earlier (category|label|name|finalist|exploration)/i;

// Scanned line-by-line over the buyer-facing MARKETING surface, the docs HTML set,
// and (with the two extra prose negators below) docs/**/*.md. Never through
// violationsIn — that feeds the deferred-noun docs ceiling, and every decision
// record and FALSE_CLAIMS entry legitimately names the old label.
function retiredLabelViolations(name, body) {
  const out = [];
  body.split("\n").forEach((line, i) => {
    if (RETIRED_LABELS.test(line) && !RETIRED_OK.test(line)) {
      const m = (line.match(RETIRED_LABELS) || [""])[0];
      out.push(
        `${name}:${i + 1}: retired category label "${m}" in buyer-facing copy — ` +
          "DR-004's label and its predecessors are all superseded (DR-019/DR-020); no category label is ratified, and docs/PURPOSE.md owns the product sentence",
      );
    }
  });
  return out;
}

// ── THE HONEST IDIOMS OF PROSE, and why they are NOT applied to markup ───────
//
// Widening the retired-label scan to `docs/**/*.md` on 2026-09-02 found 43 lines,
// and reading them said most were documents being honest rather than documents
// drifting. Three idioms recur, and a gate that flagged them would teach the next
// author to delete a true sentence:
//
//   QUOTE_CONTEXT   `docs/CLAIM_INVENTORY.md` quotes the exact offending copy it is
//                   cataloguing; `docs/DECISION_RECORDS.md` quotes the owner's own
//                   words. The label is INSIDE quotes or backticks — the document is
//                   naming the string, not asserting it.
//   AVOID_CONTEXT   `docs/research/MARKET_LANDSCAPE.md` says "Avoid leading with
//                   'Operational Trust Orchestration'". A list of phrases NOT to use
//                   is the inverse of a claim. This repository has flagged an
//                   avoid-list as a violation once already (the battlecard's trap
//                   phrases) and the fix was the same: teach the idiom.
//   PAGE_BANNER     A page that opens by declaring itself superseded history is
//                   allowed to contain its own retired thesis — that is what an
//                   archive IS. Deleting the sentences would destroy the provenance
//                   the decision records depend on.
//
// NONE of the three is applied to HTML, and the quote rule is the reason. In markup
// the label sits inside quotes BY CONSTRUCTION — `<meta content="… Shared-Device
// Trust Gateway">`, `<title>`, a `className`. Applying QUOTE_CONTEXT there would
// fail-open the exact defect this rule exists to catch: the deployed site carried
// that label in its title and social meta for five days. Prose quoting and attribute
// quoting look identical to a regex and mean opposite things, so only prose gets it.
const QUOTE_CONTEXT =
  /["“”‘’'`][^"“”‘’'`]{0,24}(Zero[\s-]Trust orchestration|Operational Trust Orchestration|Shared-Device Trust Gateway)/i;
const AVOID_CONTEXT =
  /trap phrases|phrases to avoid|words to avoid|never say|do not say|don'?t say|avoid leading with|not an established|collision assessment|invented category/i;
// A typesetting verb BEFORE the opening quote turns a quotation into copy to set.
const TYPESET_CONTEXT =
  /\b(?:caption|headline|tagline|title card|overlay|hero|blurb|place|set|print|render)\b[^"“”‘’'`]{0,40}["“”‘’'`]/i;
// Deliberately explicit: the banner has to disclaim CURRENT status in so many
// words, the same bar `PAGE_SCOPE` sets for the deferred-noun rule. "Historical
// note" further down the page does not buy the whole file an exemption.
const PAGE_BANNER =
  /superseded history|retired .{0,60}kept for provenance|nothing on (it|this page) is current positioning|archived .{0,40}not (a statement of )?current/i;
const BANNER_SCAN_LINES = 40;

// ── THE BANNER EXEMPTS WHAT FOLLOWS IT, NOT THE FILE (F2a, 2026-09-02) ───────
//
// Two defects, one shape. The first version tested PAGE_BANNER against the joined
// first forty lines and, on a hit, returned `[]` for the WHOLE document:
//
//   * a claim ABOVE the banner was exempted by a disclaimer the reader had not
//     reached yet — the same distant-hedge defect the deferred-noun rule already
//     refuses in a footer, arriving through the front door; and
//   * the phrase counted even inside a fenced code block, so a document QUOTING a
//     banner (a runbook showing the markup, this gate's own docs page showing what
//     PAGE_BANNER matches) disarmed the label rule for every line it had.
//
// Both are fail-open, and both are invisible: the count simply goes down.
//
// Now the banner is located as a LINE, fenced code is not eligible to be one, and
// only lines strictly after it are exempt. The bar is unchanged — it must still be
// in the first forty lines and still disclaim current status in so many words.
/** Line index of a genuine page banner, or -1. Fenced code is markup, not a banner. */
function bannerLineIndex(body) {
  const lines = body.split("\n");
  let fenced = false;
  for (let i = 0; i < Math.min(lines.length, BANNER_SCAN_LINES); i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fenced = !fenced; continue; }
    if (!fenced && PAGE_BANNER.test(lines[i])) return i;
  }
  return -1;
}

/**
 * Prose-only variant. Same labels, same RETIRED_OK, plus the three idioms above —
 * and it COUNTS what each idiom took out (F2b). An exemption nobody can see is
 * indistinguishable from a rule that never fired, which is how a fail-open hides.
 */
function retiredProseScan(name, body) {
  const lines = body.split("\n");
  const bannerIdx = bannerLineIndex(body);
  const out = { violations: [], byQuote: 0, byAvoid: 0, byBanner: 0, bannerIdx };
  for (const v of retiredLabelViolations(name, body)) {
    const lineNo = Number(v.slice(name.length + 1).split(":")[0]);
    const line = lines[lineNo - 1] ?? "";
    // Order is attribution, not policy — the exempt SET is unchanged, only which
    // bucket a doubly-idiomatic line lands in. Avoid-lists are checked before quotes
    // because an avoid-list almost always quotes the phrase it is banning ("Avoid
    // leading with 'Operational Trust Orchestration'"), and reporting those as
    // quote-context would leave the avoid bucket permanently at zero — an idiom that
    // always reads as never having fired is one nobody can audit.
    if (bannerIdx >= 0 && lineNo - 1 > bannerIdx) { out.byBanner += 1; continue; }
    if (AVOID_CONTEXT.test(line)) { out.byAvoid += 1; continue; }
    // The quote idiom does not reach a TYPESETTING instruction. `Add a small caption:
    // "Operational trust orchestration …"` is not a document naming a string — it is
    // a document telling a designer to print the retired label on a public visual,
    // and it sat under the quote exemption in docs/research/SOCIAL_VISUAL_CONCEPTS.md
    // twice (thirteenth audit round, 2026-09-06). Same reasoning the HTML carve-out
    // above uses: in a design brief the label sits inside quotes BY CONSTRUCTION.
    if (QUOTE_CONTEXT.test(line) && !TYPESET_CONTEXT.test(line)) { out.byQuote += 1; continue; }
    out.violations.push(v);
  }
  return out;
}

function retiredLabelViolationsInProse(name, body) {
  return retiredProseScan(name, body).violations;
}

// ── the retired label in CODE, not only in copy ──────────────────────────────
//
// THE HOLE THIS CLOSES, measured. `scripts/launch-profile.mjs` carried
// `PRODUCT_NAME = "SignalGrid Shared-Device Trust Gateway"` for five days after
// DR-019/DR-020 retired the label, and it was OUTWARD-FACING: check-launch-profile
// prints it as the gate's heading and artifacts/mcp-server serves it as `product`
// on the launch-profile resource. Four separate gates read that file and none of
// them read that string. Fixing the constant fixed the instance and left the hole:
// re-planting the label there passed check-product-framing, check-launch-claims,
// check-launch-profile and review-invariants, all four.
//
// So the label is now held in the two places it can reach a buyer FROM code:
// `scripts/*.mjs` (the gates and the profile they read) and
// `artifacts/mcp-server/src/**/*.ts` (the MCP surface that serves it).
//
// COMMENTS ARE NOT SCANNED, deliberately, and this is the honest-writing carve-out
// the rest of this file keeps making: a comment explaining that a label WAS used and
// is now retired is a true sentence, and a gate that reddened the build over it
// would be teaching the tree to delete its own history. Only live code counts —
// string literals, template literals and regex literals. A line that names the label
// AS retired stays exempt via RETIRED_OK, exactly as in buyer-facing copy.
// LINE-SHAPED ON PURPOSE, and the general version was written first and thrown away
// after it hid the very defect this section exists to catch. The usual
// `replace(/\/\*[\s\S]*?\*\//g, "")` stripper found `native/*` inside a `//` comment
// on scripts/launch-profile.mjs:92, treated it as the start of a block comment, and
// blanked everything to the next `*/` fifty lines later — including line 136, where
// the planted `PRODUCT_NAME = "SignalGrid Shared-Device Trust Gateway"` sat. The
// gate reported green over its own falsification. A regex literal such as
// /https?:\/\// carries the same hazard in the other direction, ending `\/\//` with
// two adjacent slashes that read as a line comment.
//
// So: a line counts as comment text only when it is ENTIRELY one (trimmed start of
// `//`, `/*`, `*` or `*/`) or has a trailing ` // ` segment. Anything ambiguous stays
// SCANNED, which is the safe direction — the failure mode of this stripper is a false
// positive on a comment, which RETIRED_OK already forgives and a human can read.
const stripCodeComments = (t) =>
  t
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (/^(\/\/|\/\*|\*\/|\*(?!\/))/.test(trimmed)) return " ".repeat(line.length);
      const at = line.lastIndexOf(" // ");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n");

function codeRetiredViolations(name, body) {
  return retiredLabelViolations(name, stripCodeComments(body)).map((v) =>
    v.replace("in buyer-facing copy", "in live CODE (string/template/regex literal)"),
  );
}

// Files that MUST spell the label, because their job is to match it. Each carries
// the reason, and each is VERIFIED below to actually contain it — an exemption whose
// subject no longer names the label is a fossil that silently widens the hole, so a
// stale entry is fatal rather than ignored.
const CODE_LABEL_EXEMPT = new Map([
  [
    "scripts/check-launch-claims.mjs",
    "this gate: RETIRED_LABELS is the pattern itself, and the self-test fixtures below must spell the label to prove the rule can fail",
  ],
  [
    "scripts/check-product-framing.mjs",
    "the sibling framing gate: its RETIRED table holds /\\bShared-Device Trust Gateway\\b/ as a detection pattern",
  ],
  [
    "scripts/loop-state.mjs",
    "reads README's first 40 lines for the retired label in order to REPORT framing drift; it must name what it looks for",
  ],
]);

// ── ENGINEERING DOCS ARE CARVED OUT OF THE DEFERRED-NOUN CEILING (task #67) ──
//
// The docs/**/*.md ceiling below counts an unhedged deferred-capability NOUN in
// any doc as a mention. That rule cannot tell a BUYER CLAIM ("SignalGrid
// evaluates device custody today") from ENGINEERING PROSE naming the same word
// as an ENGINE BRANCH or an integration subject. docs/REASON_CODES.md is the
// engine's own GENERATED catalogue and lists CUSTODY_EXCEPTION / DOCK_OFFLINE
// because those reason codes EXIST in the deterministic core; the RTLS
// integration notes and the live-test matrix say "zone" and "custody" because
// that is the subsystem they specify and test (several lines mark it still
// unmet). None is a buyer surface, and each legitimately names the family, so
// counting them meant an honest engineering edit could push the ceiling and fail
// a build on true prose — the "gate that punishes honest writing" this file
// warns against three times over.
//
// WHY AN EXPLICIT VERIFIED PATH-MAP — not a folder rule, not a banner. This
// mirrors CODE_LABEL_EXEMPT exactly, because both alternatives are worse here:
//   * A FOLDER exemption (docs/research/ …) is the blanket-immunity-by-name this
//     gate refuses elsewhere; a buyer doc dropped into the folder inherits it
//     silently.
//   * A DOCUMENT BANNER (the PAGE_SCOPE pattern) cannot survive on a GENERATED
//     doc — docs/REASON_CODES.md is rewritten by gen-reason-codes.mjs and a hand
//     banner would be erased on the next regen — and REASON_CODES is the single
//     clearest engine-branch case.
// So the carve-out is an explicit list, one line per file with the reason it is
// engineering-not-buyer, and it is only as safe as its fail-safes (all checked
// below, each fatal): (a) the file EXISTS; (b) it STILL carries a deferred noun,
// or the entry is a fossil widening nothing; (c) it is NEVER also in the
// buyer-facing `files` set — an overclaim on a stranger-facing surface may not
// hide behind an engineering label. It applies ONLY to the REPORTED ceiling; the
// buyer-facing hard gate and the retired-label scans are untouched, so nothing a
// stranger reads loses coverage.
const ENGINEERING_DOCS_EXEMPT = new Map([
  ["docs/REASON_CODES.md", "generated engine reason-code catalogue (gen-reason-codes.mjs); CUSTODY_*/DOCK_* are real engine outputs, and a generated file cannot carry a hand banner"],
  ["docs/KONTAKT_RTLS_INTEGRATION_NOTES.md", "RTLS integration engineering notes; zone/proximity name the subsystem being specified, not a shipped signal"],
  ["docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md", "engineering fidelity map (DR-021 intake); custody/zone/badge/RTLS name the subsystem being MAPPED against the tree's real surfaces, not shipped signals — the buyer-facing scan finds 0 violations here and the page states 'Nothing here is a claim that SignalGrid runs in this or any deployment'"],
  ["docs/ZERO_COST_LIVE_TEST_MATRIX.md", "test-planning matrix; custody/RTLS name the dimensions under test, several marked still-unmet on the same line"],
  ["docs/INTEGRATION_CATALOG.md", "connector architecture catalogue; custody/zone name connector inputs (rtls-custody, pacs-access) beside their lib/ paths"],
  ["docs/DOCKBRIDGE_PRODUCT_CONNECTOR.md", "dock-custody connector specification; custody is the connector's own subject"],
]);

// Pure: the ceiling mentions a doc contributes — zero if it is engineering-exempt,
// else its full violation count. Kept a hair's-breadth from violationsIn so the
// self-test can prove the exemption reaches the CEILING ONLY and never the
// buyer-facing hard gate (which calls violationsIn directly).
function ceilingMentions(name, body, exempt = ENGINEERING_DOCS_EXEMPT) {
  if (exempt.has(name)) return 0;
  return violationsIn(name, body).length;
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
    // The identifier-suffix idiom, both directions. A field NAMED `LocationZone` in a
    // table of what crosses to a vendor is a document naming a string; "the zone is
    // evaluated" is a claim. A rule that cannot tell them apart punishes the honest one.
    violationsIn("stZ0", "| `siem` | `LocationZone, LocationBuilding` | the declared column set |").length === 0 &&
    violationsIn("stZ1", "Python's `timezone.utc`, AWS DataZone and Bitdefender GravityZone are product names.").length === 0 &&
    violationsIn("stZ2", "The zone a worker stands in decides the verdict today.").length > 0 &&
    // The custody identifier idiom, both directions (added with the signalgrid-app root).
    // A TypeScript interface / field / reason-code key NAMING the family is a string, not a
    // claim; genuine prose custody is a claim.
    violationsIn("stCust0", "export interface CustodyGap { custodyGaps: CustodyGap[] }").length === 0 &&
    violationsIn("stCust1", '  CUSTODY_OVERDUE: "facilities_operations_owner",').length === 0 &&
    violationsIn("stCust2", "Device custody is confirmed before every session today.").length > 0 &&
    violationsIn("st6.html", farHedge).length > 0 &&
    violationsIn("st7.html", nearHedge).length === 0 &&
    violationsIn("st8.html", pageBanner).length === 0 &&
    violationsIn("st9.html", artifactFooter).length > 0 &&
    violationsIn("st10.html", honestIdiom).length === 0 &&
    violationsIn("st11.html", avoidList).length === 0 &&
    violationsIn("st12.html", avoidList.replace("Trap phrases to avoid", "Signals we fuse")).length > 0 &&
    // Retired category label — flagged in live copy, exempt when named as retired.
    retiredLabelViolations("stR0", "SignalGrid is a Zero Trust orchestration platform.").length > 0 &&
    retiredLabelViolations("stR1", "The Operational Trust Orchestration label is retired; DR-004 renamed it Shared-Device Trust Gateway.").length === 0 &&
    // The label DR-019/DR-020 retired must flag in live copy and stay exempt
    // when named as superseded — the five-day site drift this gate missed.
    retiredLabelViolations("stR2", "SignalGrid is a Shared-Device Trust Gateway for frontline work.").length > 0 &&
    retiredLabelViolations("stR3", "The Shared-Device Trust Gateway label is superseded by DR-020.").length === 0 &&
    // ── the docs widening (2026-09-02) ──────────────────────────────────────
    // A bare assertion in prose must still fail …
    retiredLabelViolationsInProse("stD0.md", "SignalGrid is a Shared-Device Trust Gateway.").length > 0 &&
    // … and each honest idiom must be legal, or the widening punishes truth.
    retiredLabelViolationsInProse("stD1.md", '| README.md:3 | "SignalGrid is an Operational Trust Orchestration platform" | rewrite |').length === 0 &&
    retiredLabelViolationsInProse("stD2.md", "Avoid leading with “Operational Trust Orchestration” until buyers use it.").length === 0 &&
    retiredLabelViolationsInProse(
      "stD3.md",
      "# Old positioning — SUPERSEDED HISTORY\n\n> Kept for provenance.\n\nSignalGrid is a Shared-Device Trust Gateway.\n",
    ).length === 0 &&
    // The banner must be AT THE TOP. A page that asserts the label for forty lines
    // and confesses afterwards is the pitch deck's distant-hedge defect again.
    retiredLabelViolationsInProse(
      "stD4.md",
      `SignalGrid is a Shared-Device Trust Gateway.\n${"filler\n".repeat(60)}\n(SUPERSEDED HISTORY)\n`,
    ).length > 0 &&
    // MARKUP KEEPS THE STRICT RULE. The same string inside an attribute is exactly
    // the five-day site drift, so the quote idiom must NOT reach it.
    retiredLabelViolations("stD5.html", '<meta name="description" content="SignalGrid — Shared-Device Trust Gateway">').length > 0 &&
    // ── F2a: the banner exempts what FOLLOWS it, and cannot hide in a code fence ──
    // An assertion ABOVE the banner line is a claim the reader meets first.
    retiredLabelViolationsInProse(
      "stD6.md",
      "SignalGrid is a Shared-Device Trust Gateway.\n\n# Old positioning — SUPERSEDED HISTORY\n\nfiller\n",
    ).length === 1 &&
    // …while the same assertion below it stays exempt, so the archive keeps its text.
    retiredLabelViolationsInProse(
      "stD7.md",
      "# Old positioning — SUPERSEDED HISTORY\n\nSignalGrid is a Shared-Device Trust Gateway.\n",
    ).length === 0 &&
    // A banner phrase inside a fenced block is a document SHOWING the markup, not
    // wearing it. It must not exempt a single line.
    retiredLabelViolationsInProse(
      "stD8.md",
      "# Gate docs\n\n```md\n# SUPERSEDED HISTORY\n```\n\nSignalGrid is a Shared-Device Trust Gateway.\n",
    ).length === 1 &&
    // ── F2b: every idiom that removes a line must be countable ──────────────────
    retiredProseScan("stD9.md", '| README.md:3 | "SignalGrid is a Shared-Device Trust Gateway" | rewrite |').byQuote === 1 &&
    retiredProseScan("stD10.md", "Avoid leading with “Shared-Device Trust Gateway” for now.").byAvoid === 1 &&
    retiredProseScan(
      "stD11.md",
      "# Old positioning — SUPERSEDED HISTORY\n\nSignalGrid is a Shared-Device Trust Gateway.\n",
    ).byBanner === 1 &&
    // The CODE surface. stC0 is the planted launch-profile defect verbatim; stC1 is
    // the honest comment that replaced it and must stay green; stC2 is a regex
    // literal (how check-product-framing and loop-state name the label); stC3 is a
    // string that names the label as retired.
    codeRetiredViolations("stC0.mjs", 'export const PRODUCT_NAME = "SignalGrid Shared-Device Trust Gateway";').length > 0 &&
    codeRetiredViolations("stC1.mjs", '// this constant once read "SignalGrid Shared-Device Trust Gateway"\nexport const PRODUCT_NAME = "SignalGrid";').length === 0 &&
    codeRetiredViolations("stC2.mjs", "const re = /Shared-Device Trust Gateway/i;").length > 0 &&
    codeRetiredViolations("stC3.mjs", 'const note = "the Shared-Device Trust Gateway label is superseded by DR-020";').length === 0 &&
    codeRetiredViolations("stC4.ts", 'const product = "SignalGrid";').length === 0 &&
    // ── engineering-docs carve-out (task #67): CEILING ONLY, never the buyer gate ──
    // A doc in the exempt map contributes ZERO ceiling mentions for engine-branch prose…
    ceilingMentions("docs/REASON_CODES.md", "Device custody is confirmed today.", new Map([["docs/REASON_CODES.md", "x"]])) === 0 &&
    // …the SAME prose in a NON-exempt doc still counts…
    ceilingMentions("docs/SOME_BUYER_DOC.md", "Device custody is confirmed today.", new Map([["docs/REASON_CODES.md", "x"]])) > 0 &&
    // …and the exemption NEVER reaches violationsIn, so the buyer-facing hard gate
    // still flags the very same file and prose (the carve-out is ceiling-only).
    violationsIn("docs/REASON_CODES.md", "Device custody is confirmed today.").length > 0;
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

// Retired-label scan over the marketing surface (web + review SPA source + the
// served index.html copies + the README landing). Separate from `files` so it
// never enters the docs-ceiling count.
const RETIRED_ROOTS = ["artifacts/signalgrid-web/src", "artifacts/signalgrid-review/src"];
const retiredFiles = [];
const walkRetired = (d) => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walkRetired(p);
    else if (/\.(tsx|ts|jsx|js|html)$/.test(p)) retiredFiles.push(p);
  }
};
RETIRED_ROOTS.forEach((d) => { if (existsSync(d)) walkRetired(d); });
for (const p of ["artifacts/signalgrid-web/index.html", "artifacts/signalgrid-web/dist/public/index.html", "README.md"]) {
  if (existsSync(p) && !retiredFiles.includes(p)) retiredFiles.push(p);
}
// COVERAGE-HOLE FIX (2026-09-01, full-evaluation finding): the retired-label
// scan ran only over the SPA source + README, so the published investor deck
// (docs/pitch-deck.html via pages.yml), POSITIONING.md (the declared single
// source of truth), the executive one-pager and the whole outreach surface —
// every buyer-facing document under docs/ — were scanned for deferred nouns but
// NEVER for a retired category label. That let "Shared-Device Trust Gateway"
// (retired by DR-019/DR-020) sit live on three buyer surfaces the gate could
// not see. `files` already resolves exactly that buyer-facing set (published
// pages + outreach + contact-address docs + web SPA); fold it in so any surface
// scanned for deferred nouns is also scanned for retired labels.
for (const p of files) {
  if (!retiredFiles.includes(p)) retiredFiles.push(p);
}
let retiredScanned = 0;
for (const f of retiredFiles) {
  retiredScanned += 1;
  for (const v of retiredLabelViolations(f, readFileSync(f, "utf8"))) {
    console.error(`  ✗ ${v}`);
    problems += 1;
  }
}

// ── docs/**/*.html — FATAL, and it is fatal because it is at zero ────────────
//
// Until 2026-09-02 NO gate in this repository read a single `docs/*.html` figure or
// label. Two of them — `docs/preview/signalgrid-teaser.html` and its OpenGraph twin
// `docs/preview/assets/signalgrid-og.html` — carried the eyebrow "Operational Trust
// Orchestration", a label DR-004 retired on 2026-08-22, above a headline a reviewer
// reads first. Both were fixed in the same pass that added this scan, which is the
// only reason this half can be fatal rather than ceilinged: the count is 0, so any
// future occurrence is a REGRESSION and deserves to fail a build.
//
// Scope is DERIVED from `git ls-files docs` rather than from the Pages deploy list.
// That is wider than "published" on purpose — a page can be linked, shared or
// screenshotted long before a workflow copies it, and both offenders here were
// exactly that: unpublished previews nobody's gate could see.
const docsHtml = execSync("git ls-files docs", { encoding: "utf8" })
  .trim().split("\n").filter((f) => /\.html?$/.test(f));
if (docsHtml.length < 5) {
  console.error(
    `✗ found only ${docsHtml.length} docs/**/*.html file(s) — this repository has had eight or more ` +
      "for months, so the derivation is broken rather than the tree empty. Do not silently scan less.",
  );
  process.exit(1);
}
for (const f of docsHtml) {
  if (retiredFiles.includes(f)) continue; // already scanned, do not double-count
  for (const v of retiredLabelViolations(f, readFileSync(f, "utf8"))) {
    console.error(`  ✗ ${v}`);
    problems += 1;
  }
}

// ── docs/**/*.md retired labels — REPORTED against a ceiling, fatal on a RISE ─
//
// WHY A CEILING HERE AND A HARD GATE FOR THE HTML ABOVE, measured before deciding.
// The widened prose scan found 43 raw lines across 22 documents on 2026-09-02;
// the three idioms take that to 29 across 17, and reading every one of the 29
// says a hard gate would be wrong TODAY: `docs/research/*` is a pre-DR-019
// messaging archive that argues about category names for a living, and
// `MARKET_LANDSCAPE.md` is the document that TALKED THIS REPOSITORY OUT of the
// label. Failing the build on those would be the "gate that punishes honest
// writing" this file already warns about three times.
//
// So the three honest idioms are exempted outright (see retiredLabelViolationsInProse)
// and what remains is recorded as debt that may only fall. A RISE is fatal: a NEW
// document asserting a retired label as SignalGrid's name is the regression, and it
// fails here rather than being averaged away.
//
// The unit is MENTIONS, not files — the same correction the deferred-noun ceiling
// above had to make, for the same reason: counting files makes a fresh violation in
// an already-listed document invisible.
const RETIRED_CEILING_FILE = "docs/agent/launch-claims-retired-labels-ceiling.json";
{
  const docMd = execSync("git ls-files docs", { encoding: "utf8" })
    .trim().split("\n").filter((f) => f.endsWith(".md"));
  if (docMd.length < 100) {
    console.error(
      `✗ found only ${docMd.length} docs/**/*.md file(s) — the derivation is broken, not the tree empty.`,
    );
    process.exit(1);
  }
  let mentions = 0;
  let bannered = 0;
  let byQuote = 0;
  let byAvoid = 0;
  let byBanner = 0;
  const worst = [];
  for (const f of docMd) {
    let body;
    try { body = readFileSync(f, "utf8"); } catch { continue; }
    if (bannerLineIndex(body) >= 0 && RETIRED_LABELS.test(body)) bannered += 1;
    const r = retiredProseScan(f, body);
    byQuote += r.byQuote;
    byAvoid += r.byAvoid;
    byBanner += r.byBanner;
    const n = r.violations.length;
    if (n > 0) { mentions += n; worst.push([f, n]); }
  }
  worst.sort((a, b) => b[1] - a[1]);

  let prior = {};
  try { prior = JSON.parse(readFileSync(RETIRED_CEILING_FILE, "utf8")); } catch { prior = {}; }
  const ceiling = prior.retiredLabelMentions;
  // SAY WHAT THE IDIOMS TOOK OUT (F2b). "29 unexempted mentions" alone cannot be
  // told apart from "29 mentions and the idioms never fired"; the raw total and the
  // three deductions have to be on the line, or a fail-open in any one of them looks
  // exactly like the tree getting cleaner.
  const raw = mentions + byQuote + byAvoid + byBanner;
  console.log(
    `  docs/**/*.md retired labels (REPORTED, not gated; a RISE is fatal): ${mentions} unexempted mention(s) ` +
      `across ${worst.length} file(s) out of ${raw} raw, ${byQuote} exempt by quote context, ${byAvoid} by avoid ` +
      `context, ${byBanner} by banner (in ${bannered} bannered page(s); a banner exempts only the lines BELOW it)` +
      (typeof ceiling === "number" ? ` (ceiling ${ceiling})` : " (no baseline yet)"),
  );
  for (const [f, n] of worst.slice(0, 5)) console.log(`      ${String(n).padStart(3)}  ${f}`);
  if (typeof ceiling === "number" && mentions > ceiling) {
    console.error(
      `\n  ✗ ${mentions - ceiling} MORE retired-label mention(s) than the recorded ceiling of ${ceiling}.\n` +
        "    A document now names a retired category label as SignalGrid's name. No category label is\n" +
        "    ratified (DR-019/DR-020) and docs/PURPOSE.md owns the product sentence. If the line is\n" +
        "    HISTORY, say so on the line, quote the label, or banner the page as superseded — do not\n" +
        "    delete a true sentence, and never raise this file by hand.",
    );
    problems += 1;
  } else if (typeof ceiling !== "number" || mentions < ceiling) {
    writeFileSync(
      RETIRED_CEILING_FILE,
      JSON.stringify({
        note: "DEBT CEILING for retired category labels in docs/**/*.md: the COUNT OF mentions that survive RETIRED_OK, the quote idiom, the avoid-list idiom and a superseded-history page banner. A RISE is fatal; a drop is recorded automatically. Never hand-edit; the gate writes it. docs/**/*.html is NOT here — it is at zero and gated hard.",
        retiredLabelMentions: mentions,
        filesCarryingThem: worst.length,
        pagesExemptByBanner: bannered,
        worst: worst.slice(0, 15).map(([f, n]) => ({ file: f, mentions: n })),
      }, null, 2) + "\n",
    );
    console.log(typeof ceiling !== "number" ? `      baseline recorded at ${mentions}` : `      ceiling lowered ${ceiling} → ${mentions}`);
  }
}

// ── the CODE surface: scripts/*.mjs + artifacts/mcp-server/src/**/*.ts ───────
// See CODE_LABEL_EXEMPT above for why these two roots and not the whole tree.
// DERIVED by walking the directories, never hand-listed: a new gate file joins the
// scan the moment it exists.
let codeScanned = 0;
{
  const codeFiles = [];
  if (existsSync("scripts")) {
    for (const e of readdirSync("scripts").sort()) {
      const q = join("scripts", e);
      if (e.endsWith(".mjs") && statSync(q).isFile()) codeFiles.push(q);
    }
  }
  const MCP_SRC = "artifacts/mcp-server/src";
  const walkMcp = (d) => {
    for (const e of readdirSync(d).sort()) {
      const q = join(d, e);
      if (statSync(q).isDirectory()) walkMcp(q);
      else if (q.endsWith(".ts")) codeFiles.push(q);
    }
  };
  if (existsSync(MCP_SRC)) walkMcp(MCP_SRC);

  // FATAL AT ZERO. A walk that finds nothing would report "0 retired labels in code"
  // — green about nothing, and the precise shape of the defect this whole section
  // exists to stop. If a root moved, fix the derivation; never scan less quietly.
  if (codeFiles.length === 0) {
    console.error(
      "  ✗ retired-label CODE scan found ZERO files under scripts/*.mjs and artifacts/mcp-server/src — " +
        "the derivation has drifted, so this scan proves nothing and refuses to pass.",
    );
    problems += 1;
  }

  for (const f of codeFiles) {
    const body = readFileSync(f, "utf8");
    const exemptWhy = CODE_LABEL_EXEMPT.get(f);
    if (exemptWhy) continue;
    codeScanned += 1;
    for (const v of codeRetiredViolations(f, body)) {
      console.error(`  ✗ ${v}`);
      problems += 1;
    }
  }

  // Every exemption must still be doing work. An entry whose file no longer names
  // the label (or no longer exists) is a hole standing open with a reason attached.
  for (const [f, why] of CODE_LABEL_EXEMPT) {
    if (!existsSync(f)) {
      console.error(`  ✗ retired-label exemption names a missing file: ${f} — delete the entry (${why}).`);
      problems += 1;
      continue;
    }
    if (!RETIRED_LABELS.test(stripCodeComments(readFileSync(f, "utf8")))) {
      console.error(
        `  ✗ retired-label exemption for ${f} is a FOSSIL — the file no longer names the label in code, ` +
          `so the exemption only widens the hole. Delete it (stated reason: ${why}).`,
      );
      problems += 1;
    }
  }
}

// ── docs/**/*.md — REPORTED against a ceiling, never fatal ───────────────────
//
// This gate reads the website, the Pages-derived HTML, the outreach surface and
// anything carrying the public contact address. It read ZERO of the 281 markdown
// files under docs/, in a repository whose own NOTICE calls it a public reference
// surface. The first docs-writer shift (2026-08-25) found the pitch-deck defect
// reproduced there: a table headed "SignalGrid surface (today)" listing 23
// deferred connector families, with the freeze disclaimer 180 lines below it.
//
// WHY A CEILING AND NOT A GATE, measured before deciding. Bringing docs/ into the
// fatal scope fails 120 of 285 files on day one, and reading what is flagged says
// why that is wrong: docs/inspiration/SPATIAL_TRUST_RESEARCH_REPORT.md at 45
// blocks, docs/research/MARKET_LANDSCAPE.md, KONTAKT_RTLS_INTEGRATION_NOTES.md.
// Those say "RTLS" and "geofence" because that is their SUBJECT. This file argues
// three times that a gate which cries wolf gets switched off, and reddening the
// build over honest research notes is exactly that.
//
// THE UNIT IS MENTIONS, NOT FILES, and the first version got it wrong. Counting
// files answers "did a document acquire its FIRST unhedged claim" — not "did a
// new unhedged claim appear". Falsifying it exposed that at once: a fresh
// deferred claim planted in a document already on the list left the count
// unchanged and the gate passed, so a new overclaim in any of the 119 worst
// documents was invisible.
const DOCS_CEILING_FILE = "docs/agent/launch-claims-docs-ceiling.json";
let docsMentions = 0;
let docsFiles = 0;
let engExemptMentions = 0;
let engExemptFiles = 0;
const docsWorst = [];
{
  const docFiles = execSync("git ls-files docs", { encoding: "utf8" })
    .trim().split("\n").filter((f) => f.endsWith(".md"));
  for (const f of docFiles) {
    // A raw count first, so an engineering-exempt file still counts toward the
    // REPORTED exemption tally (an exemption nobody can see is a fail-open, F2b).
    const raw = violationsIn(f, readFileSync(f, "utf8")).length;
    if (raw === 0) continue;
    if (ENGINEERING_DOCS_EXEMPT.has(f)) { engExemptMentions += raw; engExemptFiles += 1; continue; }
    docsFiles += 1; docsMentions += raw; docsWorst.push([f, raw]);
  }
  docsWorst.sort((a, b) => b[1] - a[1]);

  // The carve-out is only as safe as its fail-safes (task #67). Each is fatal,
  // and each mirrors CODE_LABEL_EXEMPT: an entry that no longer earns its keep is
  // a hole standing open with a reason attached.
  for (const [f, why] of ENGINEERING_DOCS_EXEMPT) {
    if (!existsSync(f)) {
      console.error(`  ✗ engineering-docs exemption names a missing file: ${f} — delete the entry (${why}).`);
      problems += 1;
      continue;
    }
    if (files.includes(f)) {
      console.error(
        `  ✗ engineering-docs exemption ${f} is ALSO a buyer-facing surface — an overclaim there reaches a stranger, ` +
          `so it may not hide behind an engineering label. Remove the entry or the file from the buyer set (${why}).`,
      );
      problems += 1;
      continue;
    }
    if (violationsIn(f, readFileSync(f, "utf8")).length === 0) {
      console.error(
        `  ✗ engineering-docs exemption for ${f} is a FOSSIL — it no longer carries a deferred-capability noun, ` +
          `so the exemption widens nothing. Delete it (${why}).`,
      );
      problems += 1;
    }
  }
}

console.log(
  `launch-claims: ${files.length} buyer-facing files scanned ` +
    `(${publishedPages.length} derived from the Pages deploy, ${outreachScanned} from the outreach surface ` +
    `and the documents it cites, ${contactScanned} from carrying the public contact address), ` +
    `${problems} violation(s); self-test green`,
);
console.log(
  `  retired category labels: ${retiredScanned} buyer-facing file(s) + ${codeScanned} code file(s) ` +
    `(scripts/*.mjs, artifacts/mcp-server/src/**/*.ts) scanned; ` +
    `${CODE_LABEL_EXEMPT.size} exempt gate file(s), each verified to still name the label`,
);
{
  // READ, DON'T CHECK-THEN-READ. `existsSync(f) ? readFileSync(f) : {}` is a
  // time-of-check/time-of-use race: the file can vanish between the two calls and
  // the read throws out of a gate that was about to report cleanly. CodeQL flagged
  // exactly this shape here as high severity, and the same pattern was fixed in
  // check-backlog-evidence.mjs earlier today — one attempt, catch the absence.
  //
  // A read that fails for ANY reason yields no baseline, which means the ceiling
  // is treated as unset and the current count is recorded. That is the safe
  // direction: an unreadable ceiling can never silently authorise a rise.
  let prior = {};
  try {
    prior = JSON.parse(readFileSync(DOCS_CEILING_FILE, "utf8"));
  } catch {
    prior = {};
  }
  const ceiling = prior.unhedgedDeferredMentions;
  console.log(
    `  docs/**/*.md (REPORTED, not gated): ${docsMentions} unhedged deferred-capability mention(s) across ${docsFiles} file(s)` +
      ` (${engExemptMentions} more mention(s) in ${engExemptFiles} engineering-doc(s) carved out per task #67, each verified)` +
      (typeof ceiling === "number" ? ` (ceiling ${ceiling})` : " (no baseline yet)"),
  );
  for (const [f, n] of docsWorst.slice(0, 5)) console.log(`      ${String(n).padStart(3)}  ${f}`);
  if (typeof ceiling === "number" && docsMentions > ceiling) {
    console.error(
      `\n  \u2717 ${docsMentions - ceiling} MORE unhedged mention(s) than the recorded ceiling of ${ceiling}.\n` +
        "    A new unhedged deferred claim reached a public document. Hedge it WHERE THE CLAIM IS —\n" +
        "    a disclaimer elsewhere in the file does not cover it.",
    );
    problems += 1;
  } else if (typeof ceiling !== "number" || docsMentions < ceiling) {
    writeFileSync(
      DOCS_CEILING_FILE,
      JSON.stringify({
        note: "DEBT CEILING for docs/**/*.md, not a high-water mark: the COUNT OF unhedged deferred-capability mentions, not the count of files carrying them — a new claim in an already-listed document must fail, and counting files hid exactly that. A RISE is fatal; a drop is recorded automatically. Never hand-edit; the gate writes it.",
        unhedgedDeferredMentions: docsMentions,
        filesCarryingThem: docsFiles,
        worst: docsWorst.slice(0, 15).map(([f, n]) => ({ file: f, blocks: n })),
      }, null, 2) + "\n",
    );
    console.log(typeof ceiling !== "number" ? `      baseline recorded at ${docsMentions}` : `      ceiling lowered ${ceiling} \u2192 ${docsMentions}`);
  }
}

if (problems > 0) {
  console.error(
    "\nLaunch-claims gate FAILED — buyer-facing copy asserts deferred capability as current.\n" +
      "Fix the copy to docs/POSITIONING.md, or hedge the mention explicitly (design target /\n" +
      "roadmap / Beyond Limited GA). Never fix the gate to fit the copy.",
  );
  process.exit(1);
}
console.log("Launch-claims gate passed — nothing deferred is presented as current.");
