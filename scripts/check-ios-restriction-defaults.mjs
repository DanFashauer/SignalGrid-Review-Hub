// check-ios-restriction-defaults — a persona DLP restriction may not default PERMISSIVE
// when the session/persona is unknown.
//
//   node scripts/check-ios-restriction-defaults.mjs             the guard
//   node scripts/check-ios-restriction-defaults.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// The EnterpriseShell reads per-session DLP controls off `persona.restrictions`
// (allowCopyPaste, allowScreenCapture, …). The session is an OPTIONAL — it can be nil
// when a session ends or expires between one render and the next tap — so a read is
// written `session?.persona.restrictions.allowCopyPaste ?? <default>`. An in-tree batch
// wrote the default as `?? true`:
//
//     allowCopyPaste: session?.persona.restrictions.allowCopyPaste ?? true   // <- LOOSENS
//
// which opens the copy/paste exfiltration path the persona may forbid, precisely when the
// session is UNKNOWN. That is the fail-open inversion CLAUDE.md golden rule 2 forbids: an
// unknown/unreadable input must tighten the answer (here, block), never loosen it. This is
// the Swift twin of check-nan-fail-open (TS) and check-ios-policy-defaults (managed config).
//
// WHAT IS GATED
// -------------
// A `.restrictions.<field> ?? true` (with or without optional-chaining on `restrictions`)
// anywhere under native/ios. The permissive literal on a restriction read is the whole
// defect; the fix is `?? false` (deny on unknown) or the persona's real value.
//
// LIMITS, said out loud: this catches the `?? true` COALESCE form, the one the review
// found. A restriction bool given a permissive DEFAULT PARAMETER (`allowCopyPaste: Bool =
// true`) is a sibling shape this pattern does not see — it is a different, lower-signal
// construct (many bools default true legitimately) and is left to review rather than
// gated here. COMMENTS AND STRING LITERALS ARE MASKED via scripts/lib/sanitize.mjs, so the
// header above and prose explaining the defect do not trip the gate.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitize } from "./lib/sanitize.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = resolve(repo, "native/ios");
const SKIP_DIRS = new Set(["build", ".build", "DerivedData", "Pods", ".git"]);
const FILE_FLOOR = 40;

// A restriction read that defaults permissive on unknown. `restrictions` may be
// optional-chained (`restrictions?.field`); whitespace/newlines may sit around `??`.
const RESTRICTION_READ = /\.restrictions\??\.[A-Za-z_]\w*/;
const FAIL_OPEN = /\.restrictions\??\.[A-Za-z_]\w*\s*\?\?\s*true\b/;

function findViolations(rawSource) {
  const lines = sanitize(rawSource).split("\n");
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    // Anchor on the line that holds the restriction read (so a two-line window is
    // counted once), and test that line plus the next for the full `?? true` form —
    // the coalesce often wraps onto the following line.
    if (!RESTRICTION_READ.test(lines[i])) continue;
    if (FAIL_OPEN.test(lines.slice(i, i + 2).join("\n"))) {
      hits.push({ line: i + 1, text: (lines[i].trim() || lines.slice(i, i + 2).join(" ").trim()) });
    }
  }
  return hits;
}

function swiftFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...swiftFiles(p));
    else if (e.name.endsWith(".swift")) out.push(p);
  }
  return out.sort();
}

// ── self-test ────────────────────────────────────────────────────────────────
const CASES = [
  ["fail-open copy/paste default is caught", `let x = session?.persona.restrictions.allowCopyPaste ?? true`, true],
  ["fail-open screen-capture default is caught", `let x = s?.persona.restrictions.allowScreenCapture ?? true`, true],
  ["optional-chained restrictions is caught", `let x = s?.persona.restrictions?.allowCopyPaste ?? true`, true],
  ["multi-line `?? true` is caught", `let x = session?.persona.restrictions.allowCopyPaste\n    ?? true`, true],
  ["fail-CLOSED default is allowed", `let x = session?.persona.restrictions.allowCopyPaste ?? false`, false],
  ["a non-restriction `?? true` is not a restriction default", `let stale = session?.isExpired ?? true`, false],
  ["the same text in a comment is masked", `// restrictions.allowCopyPaste ?? true`, false],
  ["the same text in a string literal is masked", `let doc = "restrictions.allowCopyPaste ?? true"`, false],
];

function selfTest() {
  const failures = [];
  for (const [name, body, shouldFlag] of CASES) {
    const flagged = findViolations(body).length > 0;
    if (flagged !== shouldFlag) failures.push(`${shouldFlag ? "MISSED" : "FALSE POSITIVE"}: ${name}`);
  }
  return failures;
}

const failures = selfTest();
if (failures.length > 0) {
  console.error("FAIL  self-test — the detector no longer behaves as required:");
  for (const f of failures) console.error(`    · ${f}`);
  console.error("\nA gate that cannot flag a planted violation is green about nothing.");
  process.exit(1);
}
if (process.argv.includes("--self-test")) {
  console.log(
    `PASS  self-test — ${CASES.length} planted fixtures behave in both directions: a permissive ` +
      "`.restrictions.<field> ?? true` (including optional-chained and multi-line) is caught, `?? false` and a " +
      "non-restriction `?? true` are allowed, and comments/string literals are masked.",
  );
  process.exit(0);
}

// ── the guard ────────────────────────────────────────────────────────────────
const files = swiftFiles(IOS);
if (files.length < FILE_FLOOR) {
  console.error(
    `x Only ${files.length} .swift file(s) found under native/ios (floor ${FILE_FLOOR}) — the walk is not reaching the tree it must cover.`,
  );
  process.exit(1);
}

console.log("iOS restriction defaults — a persona DLP restriction may not default permissive on an unknown session\n");
let problems = 0;
for (const f of files) {
  for (const h of findViolations(readFileSync(f, "utf8"))) {
    console.error(`  x ${relative(repo, f)}:${h.line}  ${h.text}`);
    problems += 1;
  }
}

console.log(`\nios-restriction-defaults: ${files.length} .swift file(s) scanned, ${problems} violation(s); self-test green`);
if (problems > 0) {
  console.error(
    "\niOS restriction-defaults gate FAILED. A `.restrictions.<field> ?? true` opens a DLP control when the\n" +
      "session/persona is UNKNOWN — the fail-open inversion golden rule 2 forbids. Default to `?? false` (deny on\n" +
      "unknown) or read the persona's real value.",
  );
  process.exit(1);
}
console.log("iOS restriction-defaults gate passed — no persona restriction defaults permissive on an unknown session.");
