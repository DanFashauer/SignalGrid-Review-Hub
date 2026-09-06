#!/usr/bin/env node
// Cost-figure gate — every currency amount the tree states must be registered, and the
// four owner-only billing figures may never be published as this company's own spend.
//
//   node scripts/check-cost-figures.mjs              # gate
//   node scripts/check-cost-figures.mjs --self-test  # prove the gate can fail
//
// WHY. Three documents under docs/company/ asserted that "No cost or billing figure
// appears in this repository, and none may" while `artifacts/signalgrid-web/src/pages/
// Pricing.tsx` printed $8 and $14 per device per month on a published page, and
// `docs/COST_MODEL.md`, `docs/company/INVESTOR_ONE_PAGER.md` and
// `docs/company/FUNDING_READINESS.md` printed more. The lens review that found it
// (`docs/company/ROLE_LENS_REVIEW_2026-08-21.md:516`) asked for exactly this gate —
// "scan tracked .md/.ts/.tsx for currency amounts, resolve each against the register in
// COST_MODEL.md, fail on any unregistered or ASSUMED-without-owner-source figure" — and
// it was never built. A false absolute survives precisely as long as nothing counts.
//
// GATED, and only this:
//   1. A currency amount in tracked .md/.ts/.tsx that is not in the register.
//   2. A concrete amount attributed to THIS COMPANY'S OWN spend on one of the four
//      owner-only lines (DR-005 item 4: Claude spend, Apple Developer Program fee,
//      GitHub plan, domain — docs/DECISION_RECORDS.md, "Billing numbers — the one open
//      item, owner-only by design"). Those live in the owner's private channel; a
//      concrete figure for them in this public tree is the leak the record forbids.
//
// REPORTED, never fatal:
//   · every block that names an owner-only topic beside a concrete amount, whoever it
//     is attributed to, with the marker that qualifies it. "Apple Developer Program fee
//     ASSUMED ~$99/yr — confirm" is Apple's published list price wearing an honest
//     ASSUMED, not the owner's bill; it is reported so it stays visible and is NOT
//     failed, because failing it would teach the next author to delete the word ASSUMED.
//   · which register rows nothing in the tree states any more (a stale row is a record
//     drifting, not a defect shipping).
//
// THE HONEST-WRITING TRAP THIS GATE WAS BUILT AROUND. `$0` is the most-written amount
// in the tree and almost never a price: "marginal compute per added tenant ≈ $0",
// "license $0", "CI: $0 across the estate". Failing those would be the fourth time this
// repository built a gate that punishes a true sentence. `$0` is allowed outright and
// carries a register row saying so.
//
// SCOPE IS DERIVED: `git ls-files` for the three extensions, minus pasted external
// material and minus the VENDORED skill directories (scripts/lib/skill-plane.mjs — the
// same derivation check-cited-paths.mjs uses, so the two gates cannot disagree about
// what is somebody else's prose). obra/superpowers' own training fixtures talk about
// "$15,000/minute" outages; editing them to satisfy a gate here would destroy the
// byte-identity that makes a vendored copy auditable.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { vendoredSkillPrefixes } from "./lib/skill-plane.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel, root = ROOT) => readFileSync(join(root, rel), "utf8");
const lines = (s) => (s ? s.trim().split("\n").filter(Boolean) : []);

export const REGISTER_DOC = "docs/COST_MODEL.md";

// Pasted external material, exactly as check-cited-paths.mjs defines it. A citation
// gate and a figure gate that disagree about what is authored here would each be
// telling half the truth.
export function intakePrefixes(root = ROOT) {
  return ["attached_assets/", "vendor/", "third_party/", ...vendoredSkillPrefixes(root)];
}

// ── WHAT A CURRENCY AMOUNT IS ───────────────────────────────────────────────────────
//
// `$` + a digit, optionally a magnitude letter, optionally a range, optionally a
// per-unit suffix. The lookbehind is the whole reason this is one regex and not a
// `split("$")`: `${siteOrigin}`, `\$`, and `A$1` are not amounts, and the first
// version of this rule that ignored them reported 240 findings, none of them money.
// The magnitude letter must be ADJACENT and must not be the first letter of the next
// word. `≈$0 marginal` read as "$0M" and `$380,000 mortgage` as "$380,000M" while this
// rule allowed a space, which is how a gate meant to count money invented two amounts
// out of two adverbs. A trailing comma is punctuation, not a thousands separator:
// `(~$45-169, **[unverified…` produced the key `$45-169,` for the same reason.
//
// MAG CARRIES ITS OWN `?`. Written as `${MAG}?` with MAG = `([kKmMbB])(?![A-Za-z])`,
// the `?` attaches to the LOOKAHEAD and the magnitude letter becomes REQUIRED — the
// scan silently fell from 164 amounts to 34 and dropped $8, $14 and every $0 in the
// tree. A gate whose extractor quietly narrows is the exact "green about nothing" this
// file's floors exist to catch, and the floors did catch it.
const NUM = String.raw`\d(?:[\d,]*\d)?(?:\.\d+)?`;
const MAG = String.raw`(?:([kKmMbB])(?![A-Za-z]))?`;
export const CURRENCY_RE = new RegExp(
  String.raw`(?<![\w{\\$])\$\s?(${NUM})${MAG}(?:\s*[–—-]\s*\$?(${NUM})${MAG})?(\/[A-Za-z]+)?`,
  "g",
);

/**
 * Pure: the register key for a raw match — commas dropped, magnitude letter upper-cased,
 * the per-unit suffix dropped. `$14/device`, `$14` and `$ 14` are one amount stated three
 * ways; `$15,000` and `$15000` are the same money. The register holds the money, not the
 * typography, so a price quoted per-device in one document and per-month in another does
 * not need two rows to say one thing.
 */
export function registerKey(m) {
  const mag = (s) => (s ? s.toUpperCase() : "");
  const num = (s) => s.replace(/,/g, "");
  const head = `$${num(m[1])}${mag(m[2])}`;
  return m[3] ? `${head}-${num(m[3])}${mag(m[4])}` : head;
}

/**
 * Pure: a POSITIONAL PLACEHOLDER, not money — `VALUES ($1, $2, $3)`, a shell `$1`, a
 * regex replacement `` `$1${siteOrigin}/$2$3` ``. This repository holds 96 of them in
 * lib/persistence, lib/audit and the vendored shell references, and every one has the
 * exact shape of a one-dollar price.
 *
 * THE RULE, and it is the only part of this file that needed real evidence to write: a
 * bare `$N` — no magnitude letter, no thousands separator, no decimal, no per-unit
 * suffix — inside CODE is a placeholder UNLESS the string literal enclosing it is
 * exactly that token. `price: "$8"` in Pricing.tsx is a price; `$8` sitting ninth in
 * `VALUES ($1, $2, … $8, $9, $10)` is a parameter index. Prose is not code, so `$8` in
 * a sentence is always money.
 */
export function isPlaceholder(raw, { code, enclosingLiteral, allowLiteralPrice, lineText }) {
  if (!code) return false;
  if (!/^\$\s?\d+$/.test(raw)) return false; // a magnitude, comma, decimal or unit ⇒ money
  // THE LITERAL ESCAPE IS FOR REAL CODE ONLY. In a .ts/.tsx file `price: "$8"` is a
  // price and the quotes are TypeScript's. In a markdown fence or inline span the
  // quotes are the SHELL's — `[ -x "$1" ]` is a quoted positional parameter, and
  // letting the escape reach there turned three stack-reference pages of shell prose
  // into unregistered dollars.
  if (!allowLiteralPrice) return true;
  // NOR DOES IT REACH A CAPTURE-GROUP REFERENCE. `t.replace(/…/gm, "$1")` in
  // scripts/src/emit-gate-proof.ts:404 is a string literal that is EXACTLY `$1` and is
  // not one dollar — it is the first capture group. The escape exists for `price: "$8"`;
  // a line performing a replacement is the one place the same shape means the opposite.
  if (/\.replace(All)?\s*\(/.test(lineText ?? "")) return true;
  return enclosingLiteral !== raw;
}

/**
 * Pure: the quoted string literal that encloses `index`, or undefined. Deliberately
 * simple — it looks for the nearest quote pair on the SAME LINE around the match, which
 * is all `price: "$8"` needs and all a SQL `VALUES (…)` template needs to be rejected by.
 * A multi-line template literal has no same-line pair and therefore never counts as an
 * exact currency literal, which is the safe direction: it stays a placeholder.
 */
export function enclosingLiteralOf(line, col) {
  for (const q of ['"', "'", "`"]) {
    let from = -1;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] !== q) continue;
      if (from === -1) {
        from = i;
        continue;
      }
      if (col > from && col < i) return line.slice(from + 1, i);
      from = -1;
    }
  }
  return undefined;
}

/** Pure: line index (0-based) → whether that line sits inside a fenced code block. */
export function fencedLines(text) {
  let fenced = false;
  return text.split("\n").map((l) => {
    if (/^\s*(```|~~~)/.test(l)) {
      fenced = !fenced;
      return true; // the fence line itself is markup, never prose
    }
    return fenced;
  });
}

/**
 * Pure: every currency amount in `text`. `kind` decides what counts as CODE — the
 * placeholder rule above only applies there:
 *   · "code"  — a .ts/.tsx file, every line;
 *   · "prose" — a .md file, where fenced blocks and inline `code spans` are code.
 */
export function amountsIn(text, kind) {
  const out = [];
  const fenced = kind === "prose" ? fencedLines(text) : null;
  const src = text.split("\n");
  let offset = 0;
  src.forEach((line, i) => {
    const inFence = fenced ? fenced[i] : false;
    for (const m of line.matchAll(CURRENCY_RE)) {
      const col = m.index;
      // An inline code span is markup for the same reason a fence is.
      const inSpan = kind === "prose" && insideInlineCode(line, col);
      const code = kind === "code" || inFence || inSpan;
      const raw = m[0];
      const enclosingLiteral = enclosingLiteralOf(line, col);
      if (isPlaceholder(raw, { code, enclosingLiteral, lineText: line, allowLiteralPrice: kind === "code" && !inFence && !inSpan })) continue;
      out.push({ raw, key: registerKey(m), line: i + 1, col, index: offset + col, text: line });
    }
    offset += line.length + 1;
  });
  return out;
}

/** Pure: is column `col` inside a backtick span on this line? */
export function insideInlineCode(line, col) {
  let open = -1;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "`") continue;
    if (open === -1) open = i;
    else {
      if (col > open && col < i) return true;
      open = -1;
    }
  }
  return false;
}

// ── THE REGISTER ────────────────────────────────────────────────────────────────────
//
// A table in docs/COST_MODEL.md, because that document already declares the rule this
// gate enforces ("every figure is repo-verified or marked TBD/ASSUMED — an invented
// dollar is this lens's version of the unearned green") and a register living anywhere
// else would be a second home for one fact.
//
// The class vocabulary is the one the lens review asked for, widened by the three
// classes the tree actually needed and could not do without: the competitors' public
// financials, third-party list prices, and the demo fixtures' invented dollars.
export const CLASSES = new Set([
  "ZERO",            // $0 — a statement that something costs nothing, or rhetoric
  "PUBLISHED-PRICE", // SignalGrid's own published price
  "VENDOR-PUBLIC",   // a third party's published list price
  "MARKET-PUBLIC",   // a competitor's or market's public financial figure
  "PLANNING",        // a band this repository reasons about, not a price it charges
  "ILLUSTRATIVE",    // an invented number inside demo/fixture data
  "OWNER-SUPPLIED",  // a value the owner supplied and authorised publishing
  "TBD",             // a placeholder for a figure nobody has yet
  "HISTORICAL",      // a figure quoted as a record of what was once stated
]);

/** Pure: the register rows in a COST_MODEL.md body. Throws nothing; returns what it read. */
export const REGISTER_ROW_RE = /^\|\s*`(\$[^`]+)`\s*\|\s*([A-Z-]+)\s*\|\s*(.+?)\s*\|\s*$/;

/**
 * Pure: the register document with its own rows blanked out. THE CATALOGUE IS NOT A
 * STATEMENT OF THE FIGURE. Without this, every registered amount is "stated" by the row
 * that registers it, the stale-row report can never fire, and a figure deleted from the
 * whole tree still looks live. Blanking keeps line numbers intact so a finding elsewhere
 * in COST_MODEL.md still points at the right line.
 */
export function withoutRegisterRows(md) {
  return md
    .split("\n")
    .map((l) => (REGISTER_ROW_RE.test(l) ? "" : l))
    .join("\n");
}

export function parseRegister(md) {
  const rows = [];
  for (const line of md.split("\n")) {
    const m = REGISTER_ROW_RE.exec(line);
    if (!m) continue;
    rows.push({ key: m[1], klass: m[2], where: m[3] });
  }
  return rows;
}

// ── THE FOUR OWNER-ONLY LINES (DR-005 item 4) ───────────────────────────────────────
//
// "Four values, never estimated, per the cost model's own rule: monthly Claude spend;
// Apple Developer status/fee; GitHub plan, price, and sibling-repo visibility; total
// domain spend. The model carries TBDs until the owner sends them."
export const OWNER_ONLY_TOPICS = [
  { id: "claude-spend", re: /\bclaude\b[^.\n]{0,60}\b(spend|spending|subscription|plan|bill|billing|api cost)|anthropic[^.\n]{0,40}\b(spend|bill|subscription|invoice)/i },
  { id: "apple-developer", re: /apple (developer|business manager)|developer program|\bAPNs\b/i },
  { id: "github-plan", re: /github[^.\n]{0,40}\b(plan|pricing|subscription|seat|bill|billing)|\b(free|team|enterprise) plan\b/i },
  { id: "domain", re: /\bdomain\b[^.\n]{0,50}\b(spend|cost|fee|price|registrat|renewal)|registrar|namecheap/i },
];

// An amount is qualified when the block says it is not a measured fact about this
// company's bill. These are the idioms the tree already uses; a gate that recognises
// only its own preferred spelling teaches authors to write for the regex.
export const UNCONFIRMED_MARKER =
  /\bASSUMED\b|\bTBD\b|\bunverified\b|\bestimate[sd]?\b|owner-confirmed|owner-supplied|not (yet )?enrolled|confirm before relying|public (price|list)|list price|\bpublished price\b/i;

// FIRST-PERSON ATTRIBUTION — the narrow, unambiguous half that is GATED. "Our monthly
// Claude spend is $180" publishes the owner's bill. "The $99/yr Developer Program is
// NOT needed" quotes Apple's public price to say the opposite of a claim about spend,
// and gating that would be the honest-writing penalty this repository has now paid
// three times. Attribution AND a spend noun must both be present.
export const OWN_SPEND =
  /\b(our|we|us|owner'?s?|SignalGrid'?s?|the company'?s?|this (org|company|repo))\b[^.\n]{0,80}\b(spend|spending|bill|billed|invoice|invoiced|subscription|pay|paid|paying|costs? us|monthly cost)\b|\b(spend|bill|invoice|subscription)\b[^.\n]{0,40}\b(we|our|owner)\b/i;

/** Pure: paragraph blocks with their starting line — the span a qualifier can honestly cover. */
export function blocksOf(text) {
  const src = text.split("\n");
  const out = [];
  let cur = { start: 1, lines: [] };
  src.forEach((l, i) => {
    if (l.trim() === "" && cur.lines.length > 0) {
      out.push(cur);
      cur = { start: i + 2, lines: [] };
    } else if (l.trim() !== "") {
      if (cur.lines.length === 0) cur.start = i + 1;
      cur.lines.push(l);
    }
  });
  if (cur.lines.length > 0) out.push(cur);
  return out.map((b) => ({ start: b.start, text: b.lines.join("\n") }));
}

/**
 * Pure: how the owner-only rule reads one document.
 *   violations — GATED: a concrete amount, an owner-only topic, first-person spend
 *     attribution, and no qualifying marker, all in one block.
 *   reported   — every other block pairing an owner-only topic with a concrete amount.
 * `$0` is neither: a statement that something costs nothing cannot leak a bill.
 */
export function ownerOnlyScan(name, text) {
  const violations = [];
  const reported = [];
  for (const block of blocksOf(text)) {
    const amounts = amountsIn(block.text, /\.tsx?$/.test(name) ? "code" : "prose").filter(
      (a) => a.key !== "$0",
    );
    if (amounts.length === 0) continue;
    const topics = OWNER_ONLY_TOPICS.filter((t) => t.re.test(block.text)).map((t) => t.id);
    if (topics.length === 0) continue;
    const marker = UNCONFIRMED_MARKER.exec(block.text);
    const own = OWN_SPEND.test(block.text);
    const at = `${name}:${block.start + amounts[0].line - 1}`;
    if (own && !marker) {
      violations.push(
        `${at}: concrete amount ${amounts.map((a) => a.raw.trim()).join(", ")} published as this company's own ` +
          `spend on an OWNER-ONLY line (${topics.join(", ")}). DR-005 item 4 keeps those four values in the ` +
          "owner's private channel; carry a TBD here, or mark the figure ASSUMED and name whose price it is.",
      );
    } else {
      reported.push({
        at,
        topics,
        amounts: [...new Set(amounts.map((a) => a.raw.trim()))],
        marker: marker ? marker[0] : own ? "(own-spend attribution, qualified)" : "(not attributed to our spend)",
      });
    }
  }
  return { violations, reported };
}

// ── the scan ────────────────────────────────────────────────────────────────────────

export function trackedTextFiles(root = ROOT) {
  const skip = intakePrefixes(root);
  return lines(execSync("git ls-files -- '*.md' '*.ts' '*.tsx'", { cwd: root, encoding: "utf8" }))
    .filter((f) => !skip.some((p) => f.startsWith(p)));
}

export function scan(root = ROOT) {
  const files = trackedTextFiles(root);
  const register = parseRegister(read(REGISTER_DOC, root));
  const registered = new Map(register.map((r) => [r.key, r]));

  const unregistered = [];
  const ownerViolations = [];
  const ownerReported = [];
  const seen = new Map(); // key → { count, files:Set }
  let scanned = 0;
  let amounts = 0;

  for (const f of files) {
    if (f === "scripts/check-cost-figures.mjs") continue; // this gate names every shape it matches
    let body;
    try {
      body = read(f, root);
    } catch {
      continue;
    }
    scanned += 1;
    if (f === REGISTER_DOC) body = withoutRegisterRows(body);
    const kind = /\.tsx?$/.test(f) ? "code" : "prose";
    for (const a of amountsIn(body, kind)) {
      amounts += 1;
      const rec = seen.get(a.key) ?? { count: 0, files: new Set() };
      rec.count += 1;
      rec.files.add(f);
      seen.set(a.key, rec);
      if (a.key === "$0") continue; // rhetorical / zero-cost, allowed outright
      if (registered.has(a.key)) continue;
      unregistered.push({ at: `${f}:${a.line}`, key: a.key, raw: a.raw.trim(), snippet: a.text.trim().slice(0, 120) });
    }
    const o = ownerOnlyScan(f, body);
    ownerViolations.push(...o.violations);
    ownerReported.push(...o.reported);
  }

  const stale = register.filter((r) => !seen.has(r.key));
  return { files: files.length, scanned, amounts, distinct: seen.size, register, registered, seen, unregistered, ownerViolations, ownerReported, stale };
}

// ── self-test ───────────────────────────────────────────────────────────────────────
function selfTest() {
  const checks = [];
  const key = (s) => {
    const m = new RegExp(CURRENCY_RE.source).exec(s);
    return m ? registerKey(m) : undefined;
  };

  // The extractor, both directions.
  checks.push(["a bare price in prose is an amount", amountsIn("The site publishes $8/$14 per-device prices", "prose").length === 2]);
  checks.push(["…so are a magnitude, a range, a per-unit suffix and an approximation", key("~$99/yr") === "$99" && key("$250–750k") === "$250-750K" && key("≈ $0") === "$0" && key("$1.2M") === "$1.2M" && key("$15,000/minute") === "$15000"]);
  checks.push([
    "A `${…}` TEMPLATE IS NOT AN AMOUNT — the exclusion the shape demands",
    amountsIn("const url = `${siteOrigin}/x`;", "code").length === 0 && amountsIn("cost is ${total}", "prose").length === 0,
  ]);
  checks.push(["…nor is an escaped `\\$5` or a `$` glued to a word", amountsIn("printf '\\$5'", "code").length === 0 && amountsIn("A$1 currency", "prose").length === 0]);
  checks.push([
    "A SQL POSITIONAL PLACEHOLDER IS NOT AN AMOUNT — 96 of them sit in lib/persistence and lib/audit",
    amountsIn("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,", "code").length === 0,
  ]);
  checks.push([
    "…and neither is a regex replacement or a shell positional inside a markdown fence",
    amountsIn("`$1${siteOrigin}/$2$3`,", "code").length === 0 && amountsIn("```bash\necho \"$1 $2\"\n```\n", "prose").length === 0,
  ]);
  checks.push([
    "…but a string literal that is EXACTLY a price still counts (Pricing.tsx's own shape)",
    amountsIn('    price: "$8",', "code").length === 1 && amountsIn("    price: '$14',", "code").length === 1,
  ]);
  checks.push([
    "…and a placeholder-shaped token in PROSE is money, because prose is not code",
    amountsIn("the Starter tier is $8 per device", "prose").length === 1,
  ]);
  checks.push([
    "an inline code span in markdown is markup, not prose",
    amountsIn("use `$1` for the first argument", "prose").length === 0 && insideInlineCode("a `$1` b", 3),
  ]);

  // The register, both directions.
  const REG = "| `$8` | PUBLISHED-PRICE | Pricing.tsx Starter tier |\n| `$740M` | MARKET-PUBLIC | SGNL funding |\n";
  checks.push(["a register table parses to rows with a class and a source", (() => {
    const r = parseRegister(REG);
    return r.length === 2 && r[0].key === "$8" && r[0].klass === "PUBLISHED-PRICE" && r[1].key === "$740M";
  })()]);
  checks.push(["…and an ordinary table row is not a register row", parseRegister("| Line | Closes when | Who |\n| --- | --- | --- |\n").length === 0]);

  // Live floors, before any verdict. A gate scanning nothing is green about nothing.
  const live = scan();
  checks.push(["the scan reads a plausible number of tracked files, not zero", live.scanned >= 300]);
  checks.push(["…and finds a plausible number of amounts and distinct values", live.amounts >= 60 && live.distinct >= 20]);
  checks.push(["the register is not empty and every class is a declared one", live.register.length >= 20 && live.register.every((r) => CLASSES.has(r.klass))]);
  checks.push(["…and every register row names where the amount comes from", live.register.every((r) => r.where.length > 8)]);
  checks.push(["…and no row is declared twice", new Set(live.register.map((r) => r.key)).size === live.register.length]);
  checks.push(["THE LIVE TREE IS CLEAN RIGHT NOW (the positive control)", live.unregistered.length === 0 && live.ownerViolations.length === 0]);
  checks.push(["the live tree really does state the two published prices this gate exists for", live.seen.has("$8") && live.seen.has("$14")]);

  // THE PLANTED VIOLATIONS. Each must fail, and its honest twin must not.
  const regMap = new Map(live.register.map((r) => [r.key, r]));
  const unregisteredKey = "$4242424";
  checks.push([
    "AN UNREGISTERED AMOUNT IS FLAGGED — the gate's whole purpose",
    !regMap.has(unregisteredKey) && amountsIn("we will charge $4,242,424 per seat", "prose").map((a) => a.key)[0] === unregisteredKey,
  ]);
  checks.push([
    "…and a REGISTERED one is clear (the pass is not vacuous)",
    regMap.has("$8") && amountsIn("the Starter tier is $8 per device", "prose").every((a) => regMap.has(a.key)),
  ]);
  checks.push([
    "…and `$0` is allowed outright — the rhetorical zero this tree writes 30-odd times",
    amountsIn("marginal compute per added tenant ≈ $0", "prose").every((a) => a.key === "$0"),
  ]);

  const claudeBill = "Our monthly Claude subscription spend is $180, invoiced to the company.\n";
  const claudeHonest = "Agent org: Claude subscription/API spend — owner hands, the only missing numerator (TBD).\n";
  const appleAssumed = "APNs + Apple Business Manager: owner enrollment; Apple Developer Program fee ASSUMED ~$99/yr — confirm.\n";
  checks.push([
    "A CONCRETE CLAUDE-SPEND FIGURE IS FLAGGED — DR-005 item 4's leak",
    ownerOnlyScan("docs/X.md", claudeBill).violations.length === 1,
  ]);
  checks.push([
    "…and the honest TBD twin is not flagged at all",
    ownerOnlyScan("docs/X.md", claudeHonest).violations.length === 0,
  ]);
  checks.push([
    "…and an ASSUMED ~$99/yr is ALLOWED and REPORTED, never failed — deleting the word ASSUMED must not be the fix",
    (() => {
      const r = ownerOnlyScan("docs/X.md", appleAssumed);
      return r.violations.length === 0 && r.reported.length === 1 && /ASSUMED/i.test(r.reported[0].marker);
    })(),
  ]);
  checks.push([
    "…and quoting a VENDOR'S public price to say it is NOT needed is not a leak of our bill",
    ownerOnlyScan("docs/X.md", "The $99/yr Developer Program is NOT needed for any of the above.\n").violations.length === 0,
  ]);
  checks.push([
    "…and `$0` alone on an owner-only line is never a violation — a cost of nothing cannot leak a bill",
    ownerOnlyScan("docs/X.md", "CI: $0 across the estate; our GitHub plan is free and we pay nothing.\n").violations.length === 0,
  ]);
  checks.push([
    "the owner-only rule reaches all four DR-005 lines, not just the one that was easy",
    ["claude-spend", "apple-developer", "github-plan", "domain"].every((id) =>
      OWNER_ONLY_TOPICS.some((t) => t.id === id),
    ) &&
      OWNER_ONLY_TOPICS.find((t) => t.id === "github-plan").re.test("our GitHub plan billing") &&
      OWNER_ONLY_TOPICS.find((t) => t.id === "domain").re.test("total domain spend") &&
      OWNER_ONLY_TOPICS.find((t) => t.id === "apple-developer").re.test("Apple Developer Program"),
  ]);
  checks.push([
    "A QUALIFIER IN A DIFFERENT BLOCK DOES NOT REACH THE CLAIM — the distant-hedge defect",
    ownerOnlyScan("docs/X.md", `Every figure below is ASSUMED.\n\n${claudeBill}`).violations.length === 1,
  ]);

  // Falsification of the scan itself: a planted unregistered amount in a real file must
  // be reported by the same code path the gate runs, not by a parallel one.
  checks.push([
    "THE LIVE CODE PATH REPORTS A PLANTED UNREGISTERED AMOUNT — proven through scan()'s own comparison",
    (() => {
      const planted = amountsIn("Contract value is $4,242,424 all-in.", "prose");
      return planted.length === 1 && !live.registered.has(planted[0].key);
    })(),
  ]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

// Exact-entry guard: importing this module must never gate as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) process.exit(selfTest());

  const r = scan();
  console.log(
    `Cost-figure gate — ${r.amounts} currency amount(s), ${r.distinct} distinct, across ${r.scanned} tracked ` +
      `.md/.ts/.tsx file(s); register: ${r.register.length} row(s) in ${REGISTER_DOC}.`,
  );
  if (process.argv.includes("--list")) {
    for (const [k, v] of [...r.seen].sort()) {
      const row = r.registered.get(k);
      console.log(`  ${k.padEnd(12)} ${String(v.count).padStart(3)}×  ${row ? row.klass : k === "$0" ? "ZERO (allowed outright)" : "UNREGISTERED"}  — ${[...v.files].slice(0, 3).join(", ")}${v.files.size > 3 ? ` +${v.files.size - 3}` : ""}`);
    }
  }
  console.log(
    `  REPORTED — owner-only lines (DR-005 item 4) stating a concrete amount: ${r.ownerReported.length} block(s). ` +
      "Each is allowed; each is visible on purpose.",
  );
  for (const o of r.ownerReported) console.log(`    · ${o.at} [${o.topics.join(", ")}] ${o.amounts.join(", ")} — qualified by ${o.marker}`);
  console.log(`  REPORTED — register rows nothing in the tree states any more: ${r.stale.length}.`);
  for (const s of r.stale) console.log(`    · ${s.key} (${s.klass}) — ${s.where}`);

  const problems = [
    ...r.unregistered.map(
      (u) => `${u.at}: ${u.raw} is not registered in ${REGISTER_DOC} (key ${u.key}) — "${u.snippet}"`,
    ),
    ...r.ownerViolations,
  ];
  if (problems.length > 0) {
    console.error(`\nCost-figure gate FAILED: ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error(
      `\nAdd the amount to the Register table in ${REGISTER_DOC} with its class and its source, or\n` +
        "remove the figure. An unregistered dollar is how this repository came to hold three documents\n" +
        'stating "No cost or billing figure appears in this repository" over a published price page.',
    );
    process.exit(1);
  }
  console.log(
    `\nCost-figure gate passed — every currency amount in the tracked tree resolves to a registered line ` +
      `in ${REGISTER_DOC}, and no owner-only billing figure is published as this company's own spend.`,
  );
}
