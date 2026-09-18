#!/usr/bin/env node
// check-ios-restriction-defaults — a DLP restriction may not default to permitted.
//
//   node scripts/check-ios-restriction-defaults.mjs             the guard
//   node scripts/check-ios-restriction-defaults.mjs --self-test prove the guard can fail
//
// WHY THIS EXISTS
// ---------------
// `SessionData`'s persona carries the restrictions the shell enforces — `allowCopyPaste`,
// `allowScreenCapture`, `allowedDomains`. Three sites read them through an optional
// session and supplied the PERMISSIVE value when the session could not be read:
//
//     allowCopyPaste: session?.persona.restrictions.allowCopyPaste ?? true      // ActiveSessionView
//     ...currentSession?.persona.restrictions.allowScreenCapture ?? true        // ScreenCaptureGuard
//     init(…, allowCopyPaste: Bool = true)                                      // ManagedAppViewController
//
// A nil session is not a permissive persona. It is the state in which the shell knows
// LEAST about what this person may do — and it is the state in which all three handed
// the permission out. The third is the quietest: a default argument means every call site
// that simply forgets the parameter gets the loose answer, so the restriction was opt-in
// at the exact place it exists to be enforced.
//
// This is the same law as check-ios-policy-defaults (an absent managed-config dictionary
// may not loosen a default) applied to a different shape, which is why it is a separate
// detector rather than a rule grafted into that file's accessor derivation. CLAUDE.md
// golden rule 2: "an unknown/unreachable signal raises assurance, never lowers it."
//
// WHAT IS GATED (unambiguous only)
// --------------------------------
//   1. `<anything>.restrictions.<allowX> ?? true` — an optional-chained restriction read
//      whose nil-coalescing default is the literal `true`.
//   2. `allowX: Bool = true` in a declaration — a permissive default parameter.
// Both are flagged only for identifiers matching /^allow[A-Z]/, which is how every
// restriction in SessionData.swift is named. A restriction that is not spelled `allowX`
// is NOT covered, and this file says so rather than implying total coverage.
//
// NOT GATED, deliberately: `?? true` elsewhere. `isExpired ?? true` (unknown session is
// treated as EXPIRED) and `detectedZone?.isEmpty ?? true` (unknown zone becomes
// ZONE_UNKNOWN) both TIGHTEN on absence and are correct as written. A gate that banned
// `?? true` outright would have demanded those be made wrong.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IOS = join(repo, "native/ios");

// A floor, so an empty or misdirected walk can never pass as "no violations".
const FILE_FLOOR = 40;

const PERMISSIVE_COALESCE = /\.restrictions\.(allow[A-Za-z]*)\s*\?\?\s*true\b/;
const PERMISSIVE_PARAM = /\b(allow[A-Za-z]*)\s*:\s*Bool\s*=\s*true\b/;

function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

export function findViolations(src) {
  const out = [];
  const lines = stripComments(src).split("\n");
  lines.forEach((line, i) => {
    const c = line.match(PERMISSIVE_COALESCE);
    if (c) out.push({ line: i + 1, name: c[1], kind: "nil-coalescing default", why: "an unreadable session is not a permissive persona" });
    const p = line.match(PERMISSIVE_PARAM);
    if (p) out.push({ line: i + 1, name: p[1], kind: "default parameter", why: "a call site that omits the argument gets the permissive answer" });
  });
  return out;
}

function swiftFiles(root) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "build" || e.name === ".build") continue;
        walk(p);
      } else if (e.name.endsWith(".swift")) out.push(p);
    }
  };
  walk(root);
  return out;
}

function selfTest() {
  const fail = [];
  const t = (name, ok) => { if (!ok) fail.push(name); };

  // Both defects, in the exact shapes they were found in.
  t("a permissive nil-coalescing restriction default is flagged",
    findViolations("allowCopyPaste: session?.persona.restrictions.allowCopyPaste ?? true").length === 1);
  t("…and the screen-capture site's longer receiver is flagged too",
    findViolations("SessionStateManager.shared.currentSession?.persona.restrictions.allowScreenCapture ?? true").length === 1);
  t("a permissive default PARAMETER is flagged",
    findViolations("init(app: EnterpriseApp, url: URL, allowCopyPaste: Bool = true) {").length === 1);

  // The fixed forms must come back clean, or the gate would demand the defect.
  t("the fail-closed coalescing form is clean",
    findViolations("allowCopyPaste: session?.persona.restrictions.allowCopyPaste ?? false").length === 0);
  t("the fail-closed default parameter is clean",
    findViolations("init(app: EnterpriseApp, url: URL, allowCopyPaste: Bool = false) {").length === 0);

  // The TIGHTENING uses of `?? true` that live in this tree must NOT be flagged — a gate
  // that banned the operator outright would have required these be made wrong.
  t("`isExpired ?? true` is NOT flagged (unknown session treated as expired — tightens)",
    findViolations("let stale = (SessionStateManager.shared.currentSession?.isExpired ?? true) || simulatedStale").length === 0);
  t("`detectedZone?.isEmpty ?? true` is NOT flagged (unknown zone becomes ZONE_UNKNOWN — tightens)",
    findViolations('let reason = (ctx.detectedZone?.isEmpty ?? true) ? "ZONE_UNKNOWN" : "ZONE_MISMATCH"').length === 0);

  // A commented-out defect is documentation, not code.
  t("a commented-out violation is not flagged",
    findViolations("// allowCopyPaste: session?.persona.restrictions.allowCopyPaste ?? true").length === 0);

  // Coverage honesty: a restriction not spelled allowX is out of scope, and saying so
  // here keeps a green from being read as total coverage.
  t("a restriction not named allowX is NOT claimed as covered",
    findViolations("blockCopyPaste: session?.persona.restrictions.blockCopyPaste ?? true").length === 0);

  // The detector is exercised against the REAL file's surrounding text — its receiver
  // chain, indentation and the comment now above it — rather than a tidy literal, so it
  // cannot pass on a shape the tree does not actually contain.
  //
  // It deliberately does NOT assert the live file is clean. An earlier draft did, and
  // planting the original defect back made the gate report "self-test FAILED — the
  // detector no longer behaves as required": the detector was fine, the CODE had
  // regressed, and the message sent the reader to the wrong file. Whether the tree is
  // clean is the scan's question, and the scan answers it with a path and a line number.
  // NORMALISED to the fail-closed form FIRST, then planted. Reading the file and simply
  // swapping `false`->`true` looked right and was not: if the committed file already held
  // the defect, the swap was a no-op, the arm failed, and the gate again announced that
  // the DETECTOR was broken when the code was. Normalising makes this arm say one thing
  // only — "against this file's real surrounding text, planting the defect adds a hit" —
  // and say it the same way whatever is committed.
  const src = readFileSync(join(IOS, "EnterpriseShell/Services/ScreenCaptureGuard.swift"), "utf8");
  const clean = src.replace(/allowScreenCapture\s*\?\?\s*true/, "allowScreenCapture ?? false");
  const planted = clean.replace(/allowScreenCapture\s*\?\?\s*false/, "allowScreenCapture ?? true");
  t("against the real ScreenCaptureGuard.swift text, planting the defect adds exactly one hit",
    planted !== clean && findViolations(planted).length === findViolations(clean).length + 1);

  return fail;
}

const failures = selfTest();
if (failures.length > 0) {
  console.error("FAIL  self-test — the detector no longer behaves as required:");
  for (const f of failures) console.error(`    · ${f}`);
  console.error("\nA gate that cannot flag a planted violation is green about nothing.");
  process.exit(1);
}
if (process.argv.includes("--self-test")) {
  console.log("PASS  self-test — both defect shapes flag, both fixed forms pass, the two TIGHTENING `?? true` uses in this tree are left alone, and a defect planted into the real ScreenCaptureGuard.swift text adds exactly one hit.");
  process.exit(0);
}

const files = swiftFiles(IOS);
if (files.length < FILE_FLOOR) {
  console.error(`x Only ${files.length} .swift file(s) found under native/ios (floor ${FILE_FLOOR}) — the walk is not reaching the tree it is supposed to cover.`);
  process.exit(1);
}

let problems = 0;
for (const f of files) {
  for (const h of findViolations(readFileSync(f, "utf8"))) {
    console.error(`\n  x ${relative(repo, f)}:${h.line}  ${h.name} — permissive ${h.kind}\n      ${h.why}`);
    problems += 1;
  }
}

console.log(`ios-restriction-defaults: ${files.length} .swift file(s) scanned, ${problems} violation(s); self-test green`);
if (problems > 0) {
  console.error(
    "\niOS restriction-defaults gate FAILED. A nil session is not a permissive persona — it is the state in\n" +
      "which the shell knows least about what this person may do. Write the restrictive literal (`?? false`,\n" +
      "`= false`); if some path genuinely needs the permission without a session, give it an explicit,\n" +
      "separately-named affordance rather than letting the unreadable case inherit the grant.",
  );
  process.exit(1);
}
console.log("iOS restriction-defaults gate passed — no DLP restriction defaults to permitted on an unknown session.");
