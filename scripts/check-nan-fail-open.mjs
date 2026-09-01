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
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { sanitize } from "./lib/sanitize.mjs";

const ROOTS = ["lib", "artifacts", "scripts", "packages"];
const SKIP = /(^|\/)(node_modules|dist|build|\.git|coverage|third_party|\.next)(\/|$)/;
const SRC = /\.(ts|mts|tsx|mjs|js)$/;

const RULE1 = /!\s*Number\.isNaN\s*\([^)]*\)\s*&&/;
// A parse expression on EITHER side of a relational operator, against ANY
// operand — not just a literal `Date.now()`. The original form required
// `Date.now()` by name, and that is exactly how it missed two live sites: a
// sweep comparing against a local `cutoff` and a lazy-expiry check comparing
// against a `nowMs` parameter. The clock does not have to be spelled out for
// NaN to invert the meaning.
// A BARE `new Date(x)` counts as a parse expression too. It did not, and that
// omission let a real fail-open survive the sweep this gate was written for:
// `if (new Date(session.expiresAt) < new Date())` in webauthn/server.ts
// verifyStepUp. An Invalid Date coerces to NaN in a relational compare, the test
// is false, and the session returned as VALID — while this scan reported zero,
// because the operand matched none of the three recognised forms. Found by
// external review after the in-repo reviewer passed the same change.
//
// Only RELATIONAL uses are reachable from here (rules 2 and 3 both require a
// comparison operator), so forward construction like `new Date(now + ttl)` is
// still not flagged.
const PARSE_EXPR = String.raw`(?:Date\.parse\s*\([^;]*?\)|new\s+Date\s*\([^;]*?\)\s*\.getTime\s*\(\)|new\s+Date\s*\([^;)]*\)|\.getTime\s*\(\))`;
const RULE2 = new RegExp(`${PARSE_EXPR}\\s*[<>]=?\\s*[^=]|[^<>=!]\\s*[<>]=?\\s*${PARSE_EXPR}`);
// BOTH sides parsed is NOT exempt, and the earlier belief that it was is the
// reason a real fail-open shipped. The claim was "NaN makes the comparison false
// either way, so no permissive branch is taken". That is wrong: whether false is
// safe depends entirely on which branch REJECTS. In
// `if (new Date(session.expiresAt) < new Date()) return null;` the false branch
// is the permissive one, so a malformed expiry returns the session as valid —
// two parse expressions, and a fail-open. Exempting the shape hid it.
//
// Correctness here cannot be decided from the operands; it needs an explicit
// finiteness check, which rule 3's guard recognition already looks for.
const RULE4 =
  /Date\.now\s*\(\)\s*-\s*(?:Date\.parse\s*\(|new\s+Date\s*\()|(?:Date\.parse\s*\([^;]*?\)|\.getTime\s*\(\))\s*-\s*Date\.now\s*\(\)/;
const ASSIGN = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Date\.parse\s*\(|new\s+Date\s*\([^)]*\)\s*\.getTime\s*\()/;
const RULE3_WINDOW = 20;

function findViolations(source) {
  const lines = sanitize(source).split("\n");
  const hits = [];
  const parsedNames = [];
  for (const line of lines) {
    const m = ASSIGN.exec(line);
    if (m) parsedNames.push(m[1]);
  }
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
      // Widened with rule 2, and for the same reason: the comparison target is
      // any operand, not the literal clock.
      const cmp = new RegExp(`\\b${name}\\b\\s*[<>]=?\\s*[^=]|[^<>=!]\\s*[<>]=?\\s*\\b${name}\\b`);
      // TWO guard forms are legitimate and both must count. `Number.isFinite(x)`
      // used to reject, and the REJECTING `Number.isNaN(x)` — `if
      // (Number.isNaN(x)) return "unknown"`, which the connectors and the core's
      // own `util.ts` use. Recognising only isFinite made the first widening
      // report eight violations, every one of them correct code that guards
      // properly. The dangerous cousin, `!Number.isNaN(x) &&`, is NOT a guard —
      // it is the skip-on-unknown shape, and rule 1 flags it on its own.
      const guard = new RegExp(
        `Number\\.isFinite\\s*\\(\\s*${name}\\s*\\)|(?<!!\\s{0,4})Number\\.isNaN\\s*\\(\\s*${name}\\s*\\)`,
      );
      for (let j = i; j < Math.min(lines.length, i + RULE3_WINDOW); j += 1) {
        if (guard.test(lines[j])) break;
        // Comparing two PARSE-ASSIGNED variables fails closed for the same
        // reason the inline both-parsed case does: NaN makes the comparison
        // false whichever side it is on, and no permissive branch is taken.
        // `BOTH_PARSED` only sees the inline spelling, so the variable spelling
        // is handled here — it is how a proof comparing two timestamps got
        // flagged on the first widening.
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
    // The widening, pinned. Every one of these came from a real site or a real
    // false positive the first widening produced.
    ["non-clock operand, inline (the sweep that leaked)", "if (new Date(s.observedAt).getTime() < cutoff) { drop(); }", true],
    [
      "non-clock operand, inline, fixed",
      "const o = new Date(s.observedAt).getTime();\nif (!Number.isFinite(o) || o < cutoff) { drop(); }",
      false,
    ],
    ["non-clock operand, parameter (the lazy expiry)", 'if (s.status === "active" && Date.parse(s.expiresAt) < nowMs) { expire(); }', true],
    [
      "REJECTING Number.isNaN counts as a guard",
      'const seen = Date.parse(lastSeenAt);\nif (Number.isNaN(seen)) return "unknown";\nreturn nowMs - seen <= staleAfterMs ? "fresh" : "stale";',
      false,
    ],
    [
      "but !Number.isNaN(x) && is NOT a guard — it is rule 1",
      "const exp = Date.parse(r.expiresAt);\nif (!Number.isNaN(exp) && exp <= cutoff) return null;",
      true,
    ],
    // The site that escaped the original sweep, pinned in both directions.
    ["bare new Date() relational — the verifyStepUp form", "if (new Date(session.expiresAt) < new Date()) return null;", true],
    [
      "bare new Date() relational, fixed",
      "const ms = new Date(session.expiresAt).getTime();\nif (!Number.isFinite(ms) || ms < Date.now()) return null;",
      false,
    ],
    ["forward construction is still NOT flagged", "const expiresAt = new Date(now.getTime() + ttl * 1000);", false],
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
