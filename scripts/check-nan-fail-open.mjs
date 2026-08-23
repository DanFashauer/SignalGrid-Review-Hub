// NaN fail-open gate — an expiry you cannot parse must read as EXPIRED.
//
// WHY THIS EXISTS. `Date.parse("not-a-date")` is NaN, and EVERY comparison with
// NaN is false. So the natural-looking
//
//     if (Date.parse(record.expiresAt) < Date.now()) reject();
//
// answers "not expired" for the one value the code could not interpret. The
// unreadable timestamp is the one that buys unlimited time. One variant went
// further and skipped the check outright:
//
//     if (!Number.isNaN(exp) && exp <= Date.now()) return null;   // <- fail-open
//
// This was found SIX times across THREE files in lib/webauthn — on the
// authentication path: both challenge-verification sites, the challenge store's
// read, the in-memory purge sweep (where it silently reintroduced the unbounded
// growth the sweep exists to prevent), the step-up session read, and a TTL
// computation that turned an unparseable expiry into a session with NO expiry at
// all. A seventh sat in lib/location's freshness check. Seven instances of one
// mistake, written at different times by different hands, is not seven accidents
// — it is a shape the language invites and nothing was watching for.
//
// It is also the fail-closed doctrine exactly inverted. An unknown signal must
// TIGHTEN the answer, never loosen it; that rule is enforced in the decision core
// and was simply never carried to the auth surface.
//
// WHAT IS GATED (unambiguous shapes only):
//   1. `!Number.isNaN(x) && …` — the guard that SKIPS the check when unparseable.
//      Every legitimate use of that idiom writes the rejecting form instead
//      (`Number.isNaN(x) || …`), so this shape is flagged wherever it appears.
//   2. An inline comparison of an unguarded `Date.parse(…)` / `.getTime()`
//      against `Date.now()`.
//   3. A variable assigned from `Date.parse(…)` / `new Date(…).getTime()` and
//      later compared against `Date.now()` with no `Number.isFinite` guard on it
//      in between.
//   4. AGE arithmetic — `Date.now() - new Date(x).getTime()` compared against a
//      threshold. NaN propagates through the subtraction and then compares false,
//      so a signal whose timestamp cannot be read is judged FRESH. Added after
//      rules 1-3 caught five of the six known webauthn sites and the NaN TTL was
//      the sixth they all missed; the survey then found exactly one other
//      instance in the tree, a location freshness check with the same inverted
//      meaning.
//
// WHAT IS DELIBERATELY NOT GATED, said out loud: FORWARD arithmetic that builds a
// future timestamp (`new Date(now.getTime() + ttl)`) is not flagged — it does not
// compare a parsed value against the clock, and flagging it would fire on every
// correct TTL computation in the repository. Rule 3's window is 20 lines, so a
// comparison further from its assignment than that is missed. A parsed date that
// flows through a helper before being compared is missed too: this is
// single-file, single-scope lexical matching, not dataflow. Those limits are
// real; they are written here rather than left to be discovered.
//
// COMMENTS ARE STRIPPED before matching. This file, and the fix commits, quote
// the defective shapes verbatim while explaining them — a gate that fires on
// prose describing the bug punishes writing the explanation down.
//
// SELF-TEST: each rule must flag a synthetic violation AND pass its fixed twin.
// A gate that cannot fail proves nothing.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["lib", "artifacts", "scripts", "packages"];
const SKIP = /(^|\/)(node_modules|dist|build|\.git|coverage|third_party|\.next)(\/|$)/;
const SRC = /\.(ts|mts|tsx|mjs|js)$/;

// ONE SCANNER, NOT TWO PASSES. Comments are blanked and string/template literal
// CONTENTS are masked in a single left-to-right walk, because doing them
// separately is broken in a way that is easy to miss: a comment stripper that
// cuts at the first `//` slices its own `l.indexOf("//")` in half, leaving an
// unterminated quote that throws every subsequent literal out of phase — the
// masker then blanks the code and preserves the strings, exactly inverted. This
// gate did that on its first run and reported two false positives on itself.
//
// Masking literals matters independently: this file quotes the defective shapes
// as self-test fixtures, and production code is never inside a string literal, so
// nothing real is lost. Blanket-exempting this file instead would have hidden a
// genuine defect in the gate — which is precisely what was sitting here.
function sanitize(text) {
  let out = "";
  let i = 0;
  const keepNewlines = (chunk) => chunk.replace(/[^\n]/g, " ");
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const nl = text.indexOf("\n", i);
      const stop = nl === -1 ? text.length : nl;
      out += keepNewlines(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const stop = close === -1 ? text.length : close + 2;
      out += keepNewlines(text.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          out += "  ";
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          out += quote;
          i += 1;
          break;
        }
        out += text[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

const RULE1 = /!\s*Number\.isNaN\s*\([^)]*\)\s*&&/;
const RULE2 =
  /(?:Date\.parse\s*\([^;]*?\)|\.getTime\s*\(\))\s*[<>]=?\s*Date\.now\s*\(\)|Date\.now\s*\(\)\s*[<>]=?\s*(?:Date\.parse\s*\(|new\s+Date\s*\()/;
const RULE4 =
  /Date\.now\s*\(\)\s*-\s*(?:Date\.parse\s*\(|new\s+Date\s*\()|(?:Date\.parse\s*\([^;]*?\)|\.getTime\s*\(\))\s*-\s*Date\.now\s*\(\)/;
const ASSIGN = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Date\.parse\s*\(|new\s+Date\s*\([^)]*\)\s*\.getTime\s*\()/;
const RULE3_WINDOW = 20;

function findViolations(source) {
  const lines = sanitize(source).split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (RULE1.test(line)) {
      hits.push({ line: i + 1, rule: 1, text: line.trim() });
    }
    if (RULE2.test(line) && !/Number\.isFinite/.test(line)) {
      hits.push({ line: i + 1, rule: 2, text: line.trim() });
    }
    if (RULE4.test(line) && !/Number\.isFinite/.test(line)) {
      hits.push({ line: i + 1, rule: 4, text: line.trim() });
    }
    const m = ASSIGN.exec(line);
    if (m) {
      const name = m[1];
      const cmp = new RegExp(`\\b${name}\\b\\s*[<>]=?\\s*Date\\.now\\s*\\(\\)|Date\\.now\\s*\\(\\)\\s*[<>]=?\\s*\\b${name}\\b`);
      const guard = new RegExp(`Number\\.isFinite\\s*\\(\\s*${name}\\s*\\)`);
      for (let j = i; j < Math.min(lines.length, i + RULE3_WINDOW); j += 1) {
        if (guard.test(lines[j])) break;
        if (j > i && cmp.test(lines[j])) {
          hits.push({ line: j + 1, rule: 3, text: lines[j].trim(), via: `${name} (assigned line ${i + 1})` });
          break;
        }
      }
    }
  });
  return hits;
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const cases = [
    ["rule 1 violation", "if (!Number.isNaN(exp) && exp <= Date.now()) return null;", true],
    ["rule 1 fixed", "if (!Number.isFinite(exp) || exp <= Date.now()) return null;", false],
    ["rule 2 violation", "if (Date.parse(r.expiresAt) < Date.now()) reject();", true],
    ["rule 2 fixed", "const e = Date.parse(r.expiresAt);\nif (!Number.isFinite(e) || e < Date.now()) reject();", false],
    ["rule 3 violation", "const exp = Date.parse(r.expiresAt);\nconsole.log('x');\nif (exp < Date.now()) return null;", true],
    ["rule 3 fixed", "const exp = Date.parse(r.expiresAt);\nif (!Number.isFinite(exp)) return null;\nif (exp < Date.now()) return null;", false],
    ["rule 4 violation", "if (Date.now() - new Date(s.observedAt).getTime() > maxAge) drop();", true],
    [
      "rule 4 fixed",
      "const o = new Date(s.observedAt).getTime();\nif (!Number.isFinite(o) || Date.now() - o > maxAge) drop();",
      false,
    ],
    ["forward TTL arithmetic is NOT flagged", "const expiresAt = new Date(now.getTime() + ttl * 1000);", false],
    ["comment describing the bug is NOT flagged", "// was: if (!Number.isNaN(exp) && exp <= Date.now())", false],
  ];
  const failures = cases.filter(([, src, shouldFlag]) => findViolations(src).length > 0 !== shouldFlag);
  if (failures.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED — these cases did not behave as required:\n" +
        failures.map(([name]) => `    · ${name}`).join("\n") +
        "\n  The detector no longer matches the defect it was written for; a gate that " +
        "cannot flag a planted violation is green about nothing.",
    );
    process.exit(1);
  }
}

const files = [];
const walk = (d) => {
  let entries;
  try {
    entries = readdirSync(d, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(d, e.name);
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (SRC.test(e.name)) files.push(p);
  }
};
for (const r of ROOTS) walk(r);

console.log("NaN fail-open — an expiry that cannot be parsed must read as EXPIRED\n");
let problems = 0;
for (const f of files.sort()) {
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const h of findViolations(src)) {
    console.error(
      `  ✗ ${f}:${h.line} (rule ${h.rule}${h.via ? `, via ${h.via}` : ""})\n` +
        `      ${h.text}\n` +
        "      NaN compares false against everything, so this reads an unparseable\n" +
        "      timestamp as VALID. Guard with Number.isFinite and reject when it is not.",
    );
    problems += 1;
  }
}

const FILE_FLOOR = 200;
if (files.length < FILE_FLOOR) {
  console.error(
    `✗ Only ${files.length} source files scanned (floor ${FILE_FLOOR}) — the walk is not reaching the tree it is supposed to cover.`,
  );
  process.exit(1);
}
console.log(`\nnan-fail-open: ${files.length} source files scanned, ${problems} violation(s); self-test green`);
if (problems > 0) {
  console.error("\nNaN fail-open gate FAILED — unknown must tighten the answer, never loosen it.");
  process.exit(1);
}
console.log("NaN fail-open gate passed — every parsed timestamp is finiteness-guarded before it is trusted.");
