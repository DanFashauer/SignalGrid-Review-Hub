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
//   5. A `number | null` FIELD compared with < > <= >= in an evaluator
//      (lib/**/src/**/evaluate.ts) with no `Number.isFinite` on that access in
//      the thirty lines above, unless it came through `posedBound`. The NaN does
//      not have to come from a Date: edr-threat's `signatureAgeHours === null ||
//      signatureAgeHours >= stale` let a NaN age fall between the null arm and
//      the comparison and graded an unreadable age PROTECTED (2026-09-06). Rules
//      1-4 key on a parse and could not see it. The first run of this rule found
//      three more evaluators with the same shape (rtls-custody's fix age and
//      dwell, macos-posture's residual extension count, app-update's crash
//      count). Field names come from the `name: number | null` declarations in
//      the evaluator's own directory — a field typed plain `number` is not in
//      scope, because the type already promises a number and the normaliser is
//      where that promise is kept.
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

// ONE HOP OF SAME-FILE INDIRECTION. `const exp = toMs(r.expiresAt)` where `toMs`
// is a same-file function whose body is `return Date.parse(x)` (or the getTime
// form, or the arrow spelling) is the rule-3 shape with the parse moved one call
// away. Rule 3 keyed on the literal parse expression in the assignment, so that
// refactor made a live guard invisible to this gate: an audit on 2026-09-05
// planted exactly it against lib/persistence/src/session-store.ts and the gate
// reported 0 violations while the runtime served an unparseable expiry as ACTIVE.
// Cross-module calls are deliberately NOT followed (unbounded; the manifest is the
// wrong instrument) — a helper must be visible in the same file to count.
const HELPER_FN =
  /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)[^{;]*\{\s*return\s+(?:Date\.parse\s*\(|new\s+Date\s*\([^)]*\)\s*\.getTime\s*\()/g;
const HELPER_ARROW =
  /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=>]*)?=>\s*(?:Date\.parse\s*\(|new\s+Date\s*\([^)]*\)\s*\.getTime\s*\()/g;
function parseHelpers(text) {
  const names = new Set();
  for (const m of text.matchAll(HELPER_FN)) names.add(m[1]);
  for (const m of text.matchAll(HELPER_ARROW)) names.add(m[1]);
  return [...names];
}

function findViolations(source) {
  const text = sanitize(source);
  const lines = text.split("\n");
  const hits = [];
  const helpers = parseHelpers(text);
  // Helper names are identifiers (word characters and `$`), but they are spliced
  // into a pattern, so every regex metacharacter is escaped — not only `$`.
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ASSIGN_VIA_HELPER =
    helpers.length > 0
      ? new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*(?:${helpers.map(escapeRe).join("|")})\\s*\\(`)
      : null;
  const assignment = (line) => ASSIGN.exec(line) ?? (ASSIGN_VIA_HELPER ? ASSIGN_VIA_HELPER.exec(line) : null);
  const parsedNames = [];
  for (const line of lines) {
    const m = assignment(line);
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
    const m = assignment(line);
    if (m) {
      const name = m[1];
      const viaHelper = !ASSIGN.test(line);
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
          hits.push({
            line: j + 1,
            rule: 3,
            text: lines[j].trim(),
            via: `${name} (assigned line ${i + 1}${viaHelper ? ", through a same-file parse helper" : ""})`,
          });
          break;
        }
      }
    }
  });
  return hits;
}

// ── rule 5: nullable-number FIELDS compared in an evaluator ──────────────────
// Thirty lines, not rule 3's twenty: an evaluator's comparison typically sits at
// the bottom of a commented `if (` block, and the guard branch that handles the
// unreadable value sits above the block. Still lexical, still single-file.
const RULE5_WINDOW = 30;
const NULLABLE_NUMBER_DECL = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*:\s*(?:number\s*\|\s*null|null\s*\|\s*number)\b/gm;

/** Field names declared `name: number | null` (either order) anywhere in `text`. */
export function nullableNumberFields(text) {
  const names = new Set();
  for (const m of sanitize(text).matchAll(NULLABLE_NUMBER_DECL)) names.add(m[1]);
  return names;
}

/**
 * Rule 5 over one evaluator source. `fields` is the set of nullable-number field
 * names in scope. Flags `<obj>.<field>` on either side of a relational operator
 * unless the same access is inside `Number.isFinite(…)` / rejecting
 * `Number.isNaN(…)` / `posedBound(…)` on that line or within RULE5_WINDOW lines
 * above, or an alias of it (`const x = obj.field`) is guarded the same way.
 */
export function findRule5Violations(source, fields) {
  if (!fields || fields.size === 0) return [];
  const text = sanitize(source);
  const lines = text.split("\n");
  const hits = [];
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fieldAlt = [...fields].map(escapeRe).join("|");
  const ACCESS = new RegExp(`\\b([A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*)\\.(${fieldAlt})\\b`, "g");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(ACCESS)) {
      const access = `${m[1]}.${m[2]}`;
      const a = escapeRe(access);
      const relational = new RegExp(`${a}\\s*[<>]=?\\s*[^=]|[^<>=!]\\s*[<>]=?\\s*${a}\\b`);
      if (!relational.test(line)) continue;
      const guard = new RegExp(`Number\\.isFinite\\s*\\(\\s*${a}\\s*\\)|(?<!!\\s{0,4})Number\\.isNaN\\s*\\(\\s*${a}\\s*\\)|posedBound\\s*\\(\\s*${a}\\b`);
      const alias = new RegExp(`(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${a}\\s*;`);
      let guarded = false;
      const aliases = [];
      for (let j = Math.max(0, i - RULE5_WINDOW); j <= i && !guarded; j += 1) {
        if (guard.test(lines[j])) guarded = true;
        const al = alias.exec(lines[j]);
        if (al) aliases.push(al[1]);
        for (const name of aliases) {
          if (new RegExp(`Number\\.isFinite\\s*\\(\\s*${escapeRe(name)}\\s*\\)|(?<!!\\s{0,4})Number\\.isNaN\\s*\\(\\s*${escapeRe(name)}\\s*\\)`).test(lines[j])) guarded = true;
        }
      }
      if (guarded) continue;
      if (!hits.some((h) => h.line === i + 1 && h.access === access)) {
        hits.push({ line: i + 1, rule: 5, text: line.trim(), access });
      }
    }
  });
  return hits;
}

// ── self-test ────────────────────────────────────────────────────────────────
{
  const r5 = new Set(["signatureAgeHours", "sysextResidual", "crashCount"]);
  const rule5Cases = [
    [
      "rule 5: the pre-fix edr-threat line (null arm, then a bare comparison) is FLAGGED",
      "const signaturesStale = endpoint.signatureAgeHours === null || staleHours === null || endpoint.signatureAgeHours >= staleHours;",
      true,
    ],
    [
      "rule 5: the fixed edr-threat line (Number.isFinite on the same access) passes",
      "const signaturesStale = !Number.isFinite(endpoint.signatureAgeHours) || staleHours === null || (endpoint.signatureAgeHours as number) >= staleHours;",
      false,
    ],
    ["rule 5: `!== null && > 0` is not a NaN guard — FLAGGED", "if (posture.sysextResidual !== null && posture.sysextResidual > 0) { weaken(); }", true],
    [
      "rule 5: a guard on an earlier line inside the window passes",
      "if (!Number.isFinite(report.crashCount)) { stability = 'unknown'; }\nelse { stability = report.crashCount <= bound ? 'stable' : 'unstable'; }",
      false,
    ],
    ["rule 5: a guarded ALIAS passes", "const age = endpoint.signatureAgeHours;\nif (!Number.isFinite(age)) return stale();\nif (endpoint.signatureAgeHours >= staleHours) return stale();", false],
    ["rule 5: a field typed plain number is out of scope", "if (endpoint.threatCount >= 3) escalate();", false],
    ["rule 5: through posedBound is not flagged", "const bound = posedBound(options.signatureAgeHours, 72);\nif (age >= bound) stale();", false],
    ["rule 5: an equality test is not a relational comparison", "if (endpoint.signatureAgeHours === null) stale();", false],
    ["rule 5: a comment quoting the defective shape is not flagged", "// was: endpoint.signatureAgeHours === null || endpoint.signatureAgeHours >= staleHours", false],
  ];
  const r5Failures = rule5Cases.filter(([, src, shouldFlag]) => findRule5Violations(src, r5).length > 0 !== shouldFlag);
  const declProbe = nullableNumberFields("export interface X {\n  a: number | null;\n  b?: null | number;\n  c: number;\n  d: string | null;\n}\n");
  if (!(declProbe.has("a") && declProbe.has("b") && !declProbe.has("c") && !declProbe.has("d"))) {
    r5Failures.push(["rule 5: nullable-number declarations are read in both spellings and nothing else"]);
  }
  if (r5Failures.length > 0) {
    console.error(
      "✗ SELF-TEST FAILED (rule 5) — these cases did not behave as required:\n" +
        r5Failures.map(([name]) => `    · ${name}`).join("\n") +
        "\n  A gate that cannot flag a planted violation is green about nothing.",
    );
    process.exit(1);
  }
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
    // One hop of same-file indirection — the shape that hid a live guard from rule 3.
    [
      "rule 3 through a same-file helper function (one hop)",
      "function toMs(x) {\n  return Date.parse(x);\n}\nconst exp = toMs(r.expiresAt);\nif (exp < nowMs) return null;",
      true,
    ],
    [
      "rule 3 through a same-file arrow helper",
      "const toMs = (x) => Date.parse(x);\nconst exp = toMs(r.expiresAt);\nif (exp < nowMs) return null;",
      true,
    ],
    [
      "rule 3 through a typed helper (annotation between the parameters and the body)",
      "function toMs(x: string): number {\n  return new Date(x).getTime();\n}\nconst exp = toMs(r.expiresAt);\nif (exp < nowMs) return null;",
      true,
    ],
    [
      "helper hop, guarded at the call site — not flagged",
      "function toMs(x) {\n  return Date.parse(x);\n}\nconst exp = toMs(r.expiresAt);\nif (!Number.isFinite(exp) || exp < nowMs) return null;",
      false,
    ],
    [
      "a helper that guards INSIDE (returns null on NaN) is not a parse helper — not flagged",
      "function toMs(x) {\n  const t = Date.parse(x);\n  return Number.isFinite(t) ? t : null;\n}\nconst exp = toMs(r.expiresAt);\nif (exp === null || exp < nowMs) return null;",
      false,
    ],
    [
      "a call to a helper defined in ANOTHER file is not followed (documented ceiling)",
      "const exp = parseExpiry(r.expiresAt);\nif (exp < nowMs) return null;",
      false,
    ],
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

// Rule 5 walks the evaluators only, with the nullable-number fields declared in
// each evaluator's own directory in scope.
const EVALUATOR_FLOOR = 20;
const evaluators = files.filter((f) => /^lib\/.*\/src\/.*evaluate\.ts$/.test(f) || /^lib\/[^/]+\/src\/evaluate\.ts$/.test(f)).sort();
let rule5Fields = 0;
for (const f of evaluators) {
  const dir = f.slice(0, f.lastIndexOf("/"));
  const fields = new Set();
  for (const sib of files.filter((x) => x.startsWith(`${dir}/`) && !x.slice(dir.length + 1).includes("/"))) {
    try {
      for (const n of nullableNumberFields(readFileSync(sib, "utf8"))) fields.add(n);
    } catch {
      /* unreadable sibling: nothing to add */
    }
  }
  rule5Fields += fields.size;
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  for (const h of findRule5Violations(src, fields)) {
    console.error(
      `  ✗ ${f}:${h.line} (rule 5, ${h.access} is number | null)\n` +
        `      ${h.text}\n` +
        "      NaN compares false against everything, so an UNREADABLE value takes the\n" +
        "      permissive branch here. Test Number.isFinite on the field before comparing it.",
    );
    problems += 1;
  }
}
if (evaluators.length < EVALUATOR_FLOOR) {
  console.error(`✗ Only ${evaluators.length} evaluator files found for rule 5 (floor ${EVALUATOR_FLOOR}) — the walk is not reaching lib/*/src.`);
  process.exit(1);
}
console.log(`nan-fail-open rule 5: ${evaluators.length} evaluator files, ${rule5Fields} nullable-number fields in scope`);

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
