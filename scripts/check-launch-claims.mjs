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
import { readFileSync, readdirSync, statSync } from "node:fs";
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

const OVERCLAIM_MARKERS = [/Evaluated today/, /evaluated:\s*true/];
const LAUNCH_IDS = new Set(["device-posture", "management-health", "local-authority"]);
const DEFERRED_NOUNS =
  /badge\s?(binding|state|tap|present)|custody|geofence|zone\b|shift window|shift-scoped|BLE proximity|proximity confirm|tamper (sensor|witness|detection)|GPS|RTLS/i;
const HEDGES =
  /design (target|concept)|roadmap|pre-announcement|pre-production|Beyond Limited GA|\bdeferred\b|not (shipping|claimed|available|Limited GA)|nothing here is available/i;

function violationsIn(name, body) {
  const out = [];
  for (const re of OVERCLAIM_MARKERS) {
    if (re.test(body)) out.push(`${name}: overclaim marker ${re} — the shipped defect's exact shape`);
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
  const bad1 = 'const x = { evaluated: true };';
  const bad2 = '{ id: "badge", limitedGA: true }';
  const bad3 = "Our badge binding restricts the session live.";
  const good3 = "Badge binding is a design target on the roadmap.";
  const st =
    violationsIn("st1", bad1).length > 0 &&
    violationsIn("st2", bad2).length > 0 &&
    violationsIn("st3", bad3).length > 0 &&
    violationsIn("st4", good3).length === 0;
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

console.log(`launch-claims: ${files.length} buyer-facing files scanned, ${problems} violation(s); self-test green`);
if (problems > 0) {
  console.error(
    "\nLaunch-claims gate FAILED — buyer-facing copy asserts deferred capability as current.\n" +
      "Fix the copy to docs/POSITIONING.md, or hedge the mention explicitly (design target /\n" +
      "roadmap / Beyond Limited GA). Never fix the gate to fit the copy.",
  );
  process.exit(1);
}
console.log("Launch-claims gate passed — nothing deferred is presented as current.");
