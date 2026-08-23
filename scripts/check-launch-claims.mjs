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
//      file only if that FILE also carries a hedging marker (design target /
//      design concept / roadmap / pre-announcement / "Beyond Limited GA" /
//      "not shipping"). Hedged mention is honest breadth; bare mention reads
//      as product.
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
const HEDGES =
  /design (target|concept)|roadmap|pre-announcement|pre-production|Beyond Limited GA|\bdeferred\b|not (shipping|claimed|available|Limited GA)|nothing here is available/i;

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
  if (DEFERRED_NOUNS.test(body) && !HEDGES.test(body)) {
    const line = body.split("\n").findIndex((l) => DEFERRED_NOUNS.test(l)) + 1;
    out.push(`${name}:${line}: deferred-capability noun with NO hedging marker anywhere in the file`);
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
  const st =
    violationsIn("st0", bad0).length > 0 &&
    violationsIn("st1", bad1).length > 0 &&
    violationsIn("st2", bad2).length > 0 &&
    violationsIn("st3", bad3).length > 0 &&
    violationsIn("st4", good3).length === 0 &&
    violationsIn("st5", goodNeg).length === 0;
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

console.log(`launch-claims: ${files.length} buyer-facing files scanned (${publishedPages.length} derived from the Pages deploy), ${problems} violation(s); self-test green`);
if (problems > 0) {
  console.error(
    "\nLaunch-claims gate FAILED — buyer-facing copy asserts deferred capability as current.\n" +
      "Fix the copy to docs/POSITIONING.md, or hedge the mention explicitly (design target /\n" +
      "roadmap / Beyond Limited GA). Never fix the gate to fit the copy.",
  );
  process.exit(1);
}
console.log("Launch-claims gate passed — nothing deferred is presented as current.");
