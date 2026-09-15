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
// ALSO GATED (added 2026-09-12, Codex finding): a restriction-named Bool INITIALIZER or
// FUNCTION default that resolves permissive — `allowCopyPaste: Bool = true`. This is the
// sibling shape the coalesce pattern above cannot see: `ManagedAppViewController`'s fix for
// exactly this defect class was `allowCopyPaste: Bool = false` in its initializer signature
// (fail-closed for every caller that omits the argument) — but nothing gated that DEFAULT
// itself, so flipping it back to `= true` would reopen the same exfiltration path for every
// omitting caller while this gate and its self-test both stayed green. Anchored on the SAME
// `allow<Feature>` naming SessionRestrictions declares (allowCopyPaste, allowScreenCapture,
// allowPrint, allowAirDrop) — a bare `Bool = true` is NOT flagged (many bools legitimately
// default true; this gate knows the restriction vocabulary, not every truthy default in the
// tree — the false-positive risk the original comment named for gating this shape at all).
//
// LIMITS, said out loud: only the PERMISSIVE polarity on this vocabulary is gated — an
// inverse-named restriction default (`blockCopyPaste: Bool = false`, hypothetically) is a
// shape this repo does not currently use anywhere under native/ios and is left to review.
// COMMENTS AND STRING LITERALS ARE MASKED via scripts/lib/sanitize.mjs, so the header above
// and prose explaining the defect do not trip the gate.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { sanitize } from "./lib/sanitize.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = resolve(repo, "native/ios");
const SKIP_DIRS = new Set(["build", ".build", "DerivedData", "Pods", ".git"]);
const FILE_FLOOR = 40;

// A restriction read that defaults permissive on unknown. `restrictions` may be
// optional-chained (`restrictions?.field`), and Swift may wrap the member chain OR
// the coalesce across lines — `session?.persona.restrictions` on one line and
// `.allowCopyPaste ?? true` on the next. `\s` matches newlines, so the whole
// sanitized source is scanned as ONE string with whitespace tolerated between every
// part: a split between `.restrictions` and its field, or between the field and
// `?? true`, is caught the same way. (Anchoring line-by-line on the field missed the
// first split; scanning the joined source closes it.)
const FAIL_OPEN = /\.restrictions\s*\??\s*\.\s*[A-Za-z_]\w*\s*\?\?\s*true\b/g;

// A restriction-named Bool (or Bool?) parameter DEFAULT that resolves permissive, e.g.
// `allowCopyPaste: Bool = true` in an initializer or function signature — the shape a
// caller who omits the argument silently inherits. `allow[A-Z]` (not a bare `allow`)
// anchors on the SessionRestrictions naming convention (allowCopyPaste,
// allowScreenCapture, allowPrint, allowAirDrop) without also matching an unrelated
// `allowedDomains`-style name (lowercase after `allow`, and not `Bool` typed anyway).
const FAIL_OPEN_DEFAULT_PARAM = /\ballow[A-Z]\w*\s*:\s*Bool\??\s*=\s*true\b/g;

function findViolations(rawSource) {
  const src = sanitize(rawSource);
  const rows = src.split("\n");
  const hits = [];
  for (const pattern of [FAIL_OPEN, FAIL_OPEN_DEFAULT_PARAM]) {
    const re = new RegExp(pattern.source, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      hits.push({ line, text: (rows[line - 1] || "").trim() || m[0].replace(/\s+/g, " ").trim() });
      if (m.index === re.lastIndex) re.lastIndex += 1; // never loop on a zero-width match
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
  ["multi-line MEMBER CHAIN (restrictions, then .field ?? true on the next line) is caught", `let x = session?.persona.restrictions\n    .allowCopyPaste ?? true`, true],
  ["fail-CLOSED default is allowed", `let x = session?.persona.restrictions.allowCopyPaste ?? false`, false],
  ["a non-restriction `?? true` is not a restriction default", `let stale = session?.isExpired ?? true`, false],
  ["the same text in a comment is masked", `// restrictions.allowCopyPaste ?? true`, false],
  ["the same text in a string literal is masked", `let doc = "restrictions.allowCopyPaste ?? true"`, false],
  // Restriction-named INITIALIZER-DEFAULT shape (Codex finding, 2026-09-12):
  ["a permissive restriction-named Bool default in an initializer is caught",
    `init(app: EnterpriseApp, url: URL, allowCopyPaste: Bool = true) {}`, true],
  ["…the exact planted regression: ManagedAppViewController's own fail-closed default flipped back permissive",
    `init(app: EnterpriseApp, url: URL, allowedDomains: [String]? = nil, allowCopyPaste: Bool = true) {`, true],
  ["a permissive restriction-named OPTIONAL Bool default is also caught", `init(allowScreenCapture: Bool? = true) {}`, true],
  ["a fail-closed restriction-named Bool default is allowed", `init(allowCopyPaste: Bool = false) {}`, false],
  ["a non-restriction Bool default is not flagged (the vocabulary is restriction-specific)", `init(isEnabled: Bool = true) {}`, false],
  ["`allowedDomains` (lowercase after `allow`, non-Bool) is not mistaken for a restriction Bool", `init(allowedDomains: [String]? = nil) {}`, false],
  ["the restriction-named default in a comment is masked", `// allowCopyPaste: Bool = true`, false],
  ["the restriction-named default in a string literal is masked", `let doc = "allowCopyPaste: Bool = true"`, false],
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
      "`.restrictions.<field> ?? true` (including optional-chained and multi-line) AND a permissive " +
      "`allow<Feature>: Bool = true` initializer/function default are both caught; `?? false`, `Bool = false`, " +
      "and a non-restriction default are allowed; and comments/string literals are masked.",
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
