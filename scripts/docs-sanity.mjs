// Docs sanity gate: (1) every required doc exists, and (2) no affirmative
// unsafe/over-reach claim appears in the docs or product-app source. Single
// source of truth for BOTH the CI docs-sanity job and `pnpm run preflight`, so a
// doc that trips this fails locally before the push (not just in CI).
//
//   node scripts/docs-sanity.mjs
//
// Ported verbatim from the inline CI logic: same required-doc list, same
// denylist, same disclaimer/boundary allow-list so non-claim framing (a
// guardrail, a "does not…", a pre-announcement note) is not flagged.
//
// CONTROLS. Every exemption here is a hole by construction, so each is exercised
// in BOTH directions by appending to a scanned doc and re-running. Reproduce with
// docs/WHAT_SIGNALGRID_DOES_TODAY.md:
//
//   A  "The grid runs itself."                         → FAILS  (case-insensitivity)
//   B  "…does not claim:" + "- Autonomous production
//      remediation."                                   → PASSES (lead-in negation)
//   C  "…ships today:" + the same bullet               → FAILS  (not a list waiver)
//   D  "…does not act." + blank + the same bullet      → FAILS  (no colon, no scope)
//   E  restored tree                                   → PASSES
//
// C and D are the ones that matter: they show the lead-in rule exempts a DENIED
// claim, not any claim that happens to be in a list.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

// 1 — required docs exist ─────────────────────────────────────────────────────
const REQUIRED_DOCS = [
  "README.md",
  "docs/INDEX.md",
  "docs/INTEGRATION_CATALOG.md",
  "docs/PRODUCTION_PATH.md",
  "docs/INTUNE_ENTRA_POSTURE_PROOF.md",
  "docs/ECOSYSTEM_POSITIONING.md",
  "docs/MOBILE_AND_PLATFORM_STRATEGY.md",
  "docs/DOCKBRIDGE_STRATEGY.md",
  "docs/SIGNALGRID_REAL_LIFE_SIMULATOR.md",
  "docs/SIGNALGRID_APP_SUITE_PLAN.md",
  "docs/SIMULATOR_EVENT_MODEL.md",
  "docs/SIMULATOR_DECISION_ENGINE.md",
  "docs/SIMULATOR_VALIDATION_RUNBOOK.md",
  "docs/CLOUD_CONNECTOR_EMULATOR_HARNESS.md",
  "docs/CONNECTOR_EMULATOR_SCENARIOS.md",
  "docs/PRODUCT_CORE_FOUNDATION.md",
  "docs/PRODUCT_CORE_THREAT_MODEL.md",
  "docs/SECURITY_CONTROLS_MATRIX.md",
  "docs/PRODUCT_DATA_MODEL.md",
  "docs/PRIVATE_CORE_HANDOFF.md",
  "docs/RUN_AND_GO_LIVE.md",
  "docs/ECOSYSTEM_FLOW_AND_RESOLUTION.md",
  "docs/DOCKBRIDGE_PRODUCT_CONNECTOR.md",
  "docs/SECURITY_BASELINE_ALIGNMENT.md",
  "docs/APP_SUITE_MATRIX.md",
  "docs/WHAT_SIGNALGRID_DOES_TODAY.md",
  // CLAUDE.md names this as the doc to "start at"; a required-docs list that omits
  // the entry point is a list that lets the entry point be deleted. Added directly
  // rather than derived: CLAUDE.md names it in prose, not a machine-readable list,
  // so deriving REQUIRED_DOCS from it is not cheap and would itself need a parser.
  "docs/CI_AND_VALIDATION.md",
  "SECURITY.md",
];
for (const doc of REQUIRED_DOCS) {
  if (!existsSync(resolve(repo, doc))) problems.push(`Missing required doc: ${doc}`);
}
if (REQUIRED_DOCS.every((d) => existsSync(resolve(repo, d)))) {
  console.log(`  ✓ Required docs: all ${REQUIRED_DOCS.length} present`);
}

// 2 — no affirmative unsafe/over-reach claim ──────────────────────────────────
const DENYLIST = [
  "SignalGrid is production-ready",
  "SignalGrid replaces",
  "SignalGrid is an Imprivata partner",
  "SignalGrid is MFi certified",
  "autonomous production remediation",
  "replaces ServiceNow",
  "replaces PagerDuty",
  "replaces CrowdStrike",
  "replaces Defender",
  "replaces ControlUp",
  "Imprivata partner",
  "MFi certified",
  "replaces Jamf",
  "replaces Intune",
  "replaces Apple Configurator",
  "replaces GroundControl",
  "available now",
  "SOC 2 Type II certified",
  // A THIRD ROUND, from the org sweep (2026-08-23), and this one was found by
  // reading a PROMISE rather than a page. docs/SECURITY_QUESTIONNAIRE_PACK.md
  // tells assessors, for the row "SOC 2 / ISO 27001 / HIPAA / FedRAMP?", that
  // "the docs-sanity gate fails the build if any document claims otherwise".
  // It did not: of the four frameworks that sentence names, only SOC 2 (in its
  // "Type II certified" phrasing) and FedRAMP (hyphenated only) had entries —
  // ISO 27001 and HIPAA had none at all, in any form. The strongest fix is to
  // make the promise true rather than soften it, because the promise is a good
  // one to have made.
  "SOC 2 certified",
  "SOC 2 compliant",
  "SOC2 certified",
  "ISO 27001 certified",
  "ISO 27001 compliant",
  "ISO27001 certified",
  "HIPAA compliant",
  "HIPAA-compliant",
  "HIPAA certified",
  "FedRAMP authorized",
  "FedRAMP certified",
  "PCI DSS compliant",
  "99.99% uptime SLA",
  "FedRAMP-authorized",
  "CMMC-certified",
  "STIG hardened",
  "EAL5+ certified",
  "FIPS 140-2 validated",
  // AUTONOMY OVER-CLAIMS. Added after `docs/fabric-console.html` — a PUBLISHED page —
  // was found saying "The grid runs itself", "the grid carries out the response by
  // itself, no human in the loop", and "grow to 100% with no human in the loop",
  // while this scan reported green. The denylist covered "autonomous production
  // remediation" and nothing else in the class, so the claim only had to be phrased
  // in ordinary English to walk past. docs/PUBLIC_MESSAGING_GUARDRAILS.md already
  // mapped this exact claim to its safe form; nothing enforced the mapping.
  "no human in the loop",
  "the grid runs itself",
  "the grid does the rest",
  "carries out the response by itself",
  "acts on its own",
  // A SECOND ROUND, found only once the scan was made case-insensitive (see -niF
  // below). The most prominent claim on the published console — its one-line thesis,
  // `The grid does the rest — automatically` — was invisible to the case-sensitive
  // scan because the denylist entry was lowercase and the sentence started a line.
  // Re-reading the two published surfaces with that fixed turned up four more
  // phrasings of the same claim that no entry covered at all:
  "handles the rest by itself",
  "handles by itself",
  "handles every situation by itself",
  "the grid controls on its own",
];
// This list can never be complete, and saying so is part of the gate. It denies
// PHRASINGS, not the claim; the claim is "SignalGrid acts", and English has an
// unbounded number of ways to say it. Two rounds of extension have each found live
// instances the previous round did not cover. Treat a green here as "none of the
// phrasings we have thought of", never as "no autonomy over-claim".
// Docs whose PURPOSE is to enumerate the forbidden phrases (a "do not say" list),
// so every denylist phrase legitimately appears there as a negative example — the
// same file-level exemption review-invariants.mjs uses for its own guard docs.
const META_FILES = new Set(["docs/PUBLIC_MESSAGING_GUARDRAILS.md"]);
// The claim inventory RECORDS every buyer-facing claim verbatim — including
// forbidden ones — each row carrying its classification and contradicting
// citation. Quoting a defect to order its removal is evidence, not a claim —
// but only the QUOTED ROWS earn that: the files' framing prose stays scanned,
// so an affirmative over-reach sentence added to the introduction still fails.
const QUOTED_ROW_FILES = new Map([
  // Markdown: only table rows (the quoted claims + their evidence) are exempt.
  ["docs/CLAIM_INVENTORY.md", (line) => line.trimStart().startsWith("|")],
  // JSON twin: only the structured claim/evidence/resolution string fields.
  ["docs/agent/CLAIM_INVENTORY.json", (line) => /^\s*"(?:claim|evidence|resolution)":/.test(line)],
]);
// Meta framing that legitimately references a denylist phrase as the guard's own
// machinery or a negative example — never a real claim.
const META = /denylist|unsafe-claim scan|validation command|git grep|guardrail|disclaimer|pre-announcement|design target/i;
const NEGATOR = /\b(?:not|no|never|cannot|can'?t|isn'?t|does\s?not|doesn'?t|won'?t|without|avoid|should\s?not|must\s?not)\b/i;
// A denylist phrase is disclaimer context ONLY when it is negated — i.e. a negator
// appears BEFORE that occurrence on the line (negation scopes forward). The old
// check exempted any line containing "no"/"not" ANYWHERE, so a real over-claim
// slipped through if the line also said e.g. "no setup" after the claim. A line is
// a bare claim if any occurrence of the phrase has no negator preceding it.
function hasBareClaim(content, phrase) {
  const lower = content.toLowerCase();
  const p = phrase.toLowerCase();
  let idx = lower.indexOf(p);
  while (idx !== -1) {
    if (!NEGATOR.test(content.slice(0, idx))) return true; // un-negated claim
    idx = lower.indexOf(p, idx + p.length);
  }
  return false;
}
// NEGATION SCOPES OVER A LIST IT INTRODUCES. `hasBareClaim` sees one line, so a
// bullet inherits nothing from the sentence above it — and every "Non-goals" list in
// this repo is written exactly that way:
//
//     This pack explicitly does not claim:
//
//     - Autonomous production remediation.        <- a denied claim, read as a claim
//
// The case-sensitive scan never reached these lines, so making it case-insensitive
// turned four correct disclaimers into four failures. The fix is not to exempt the
// phrase (that would blind the gate to a real use of it elsewhere in the same file)
// and not to exempt the files (they carry real claims too). It is to give the bullet
// the context a reader gives it.
//
// Deliberately narrow: the lead-in must END IN A COLON — the mark that it introduces
// what follows. A negated sentence that merely happens to sit above an unrelated list
// does not launder it.
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
function listLeadIn(path, lineNo) {
  let text;
  try {
    text = readFileSync(resolve(repo, path), "utf8");
  } catch {
    return null; // unreadable → no exemption, which is the fail-closed direction
  }
  const lines = text.split("\n");
  const self = lines[lineNo - 1];
  if (self === undefined || !LIST_ITEM.test(self)) return null;
  for (let i = lineNo - 2; i >= 0; i -= 1) {
    const l = lines[i];
    if (l.trim() === "" || LIST_ITEM.test(l)) continue; // still inside the list
    return l.trimEnd().endsWith(":") ? l : null;
  }
  return null;
}

// SCAN ROOTS ARE DERIVED FROM THE TREE, not hand-listed. The old five-entry list
// was a fossil: it named only the five signalgrid-* web trees, so api-server/src
// and mcp-server/src (added later) were never scanned, and a new web artifact
// would silently sit outside the gate. The rule now, stated exactly:
//
//   README.md  +  docs/ (recursively)  +  every artifacts/<pkg>/src that exists.
//
// git grep scans every file under those roots (tracked + untracked-not-ignored),
// so a new doc or a new artifact source joins the scan the moment it lands.
function deriveScanRoots() {
  const roots = ["README.md", "docs"];
  let pkgs = [];
  try {
    pkgs = readdirSync(resolve(repo, "artifacts"), { withFileTypes: true });
  } catch {
    pkgs = [];
  }
  for (const e of pkgs) {
    if (e.isDirectory() && existsSync(resolve(repo, "artifacts", e.name, "src"))) {
      roots.push(`artifacts/${e.name}/src`);
    }
  }
  return roots;
}
const SCAN_PATHS = deriveScanRoots();

// How many files the roots actually resolve to (tracked + untracked-not-ignored).
// A scan that reaches almost nothing is the failure this repo keeps finding — a
// gate green about a docset it stopped reading. The floor is far below the real
// count (500+ today) and only catches roots that rotted to nothing.
const SCANNED_FLOOR = 200;
function scannedFileCount(roots) {
  let out = "";
  try {
    out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...roots], {
      cwd: repo,
      encoding: "utf8",
    });
  } catch {
    return 0;
  }
  return out.split("\n").filter(Boolean).length;
}

// The per-line decision, extracted pure so --self-test can drive it directly: is
// this occurrence of a denylist phrase a BARE over-claim (fail) rather than a
// disclaimer, a quoted-row inventory entry, a meta reference, or a claim launder-
// ed by a negated/meta list lead-in?
function isBareOverclaim(phrase, path, content, leadIn) {
  if (META_FILES.has(path)) return false;
  const rowExempt = QUOTED_ROW_FILES.get(path);
  if (rowExempt && rowExempt(content)) return false;
  if (META.test(content)) return false;
  if (!hasBareClaim(content, phrase)) return false;
  if (leadIn !== null && (NEGATOR.test(leadIn) || META.test(leadIn))) return false;
  return true;
}

// ── self-test: the exemptions and the floor must each be able to fail ────────
function selfTest() {
  const checks = [];

  // A bare over-claim is FLAGGED.
  checks.push([
    "a bare denylist claim is flagged",
    isBareOverclaim("SignalGrid is production-ready", "docs/x.md", "SignalGrid is production-ready in every deployment", null) === true,
  ]);
  // The honest idiom is NOT punished: a negated claim on the same line.
  checks.push([
    "a negated claim on the same line is not flagged",
    isBareOverclaim("SignalGrid is production-ready", "docs/x.md", "SignalGrid is not production-ready today", null) === false,
  ]);
  // A denied claim under a colon lead-in that negates it is not flagged.
  checks.push([
    "a bullet under a negating lead-in is not flagged",
    isBareOverclaim("autonomous production remediation", "docs/x.md", "- Autonomous production remediation.", "This pack explicitly does not claim:") === false,
  ]);
  // The meta guardrails doc is exempt (it enumerates forbidden phrases).
  checks.push([
    "the guardrails doc is exempt from its own denylist",
    isBareOverclaim("the grid runs itself", "docs/PUBLIC_MESSAGING_GUARDRAILS.md", "the grid runs itself", null) === false,
  ]);

  // THE FLOOR CAN FAIL: roots that resolve to nothing fall below it.
  const empty = scannedFileCount(["no-such-root-xyzzy-9000"]);
  checks.push([`roots resolving to nothing scan 0 files, below the floor (${SCANNED_FLOOR})`, empty === 0 && empty < SCANNED_FLOOR]);

  // LIVE: the derived roots clear the floor, or the derivation is broken.
  const live = scannedFileCount(SCAN_PATHS);
  checks.push([`LIVE: the derived roots reach ${live} file(s) (floor ${SCANNED_FLOOR})`, live >= SCANNED_FLOOR]);
  checks.push([`LIVE: ${SCAN_PATHS.length} scan root(s) derived, incl. every artifacts/*/src`, SCAN_PATHS.length >= 7]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

let claimHits = 0;
for (const phrase of DENYLIST) {
  let out = "";
  try {
    // --untracked also scans new, not-yet-staged files (excluding gitignored),
    // so a brand-new doc with an unsafe claim is caught by preflight BEFORE it
    // is committed — a tracked-only scan would miss it (matches review-invariants).
    // -i is load-bearing. Without it this scan was CASE-SENSITIVE, so a denylist
    // entry written lowercase ("the grid runs itself") did not match a sentence that
    // began with it ("The grid runs itself."). Capitalising one letter walked past
    // the gate. Found by a control that refused to fail: a bare claim appended to a
    // scanned doc produced no finding at all.
    out = execFileSync("git", ["grep", "--untracked", "-niF", "--", phrase, "--", ...SCAN_PATHS], { cwd: repo, encoding: "utf8" });
  } catch {
    out = ""; // git grep exits non-zero when there are no matches
  }
  for (const line of out.split("\n").filter(Boolean)) {
    // git grep line = "path:lineno:content" — split off the path + content.
    const m = /^(.*?):(\d+):(.*)$/.exec(line);
    const path = m ? m[1] : "";
    const lineNo = m ? Number(m[2]) : 0;
    const content = m ? m[3] : line;
    const leadIn = lineNo > 0 ? listLeadIn(path, lineNo) : null;
    if (!isBareOverclaim(phrase, path, content, leadIn)) continue;
    problems.push(`Unsafe direct claim found for '${phrase}': ${line}`);
    claimHits += 1;
  }
}

// NON-VACUITY: the scan must actually have reached the tree.
const scannedCount = scannedFileCount(SCAN_PATHS);
if (scannedCount < SCANNED_FLOOR) {
  problems.push(
    `Unsafe-claim scan reached only ${scannedCount} file(s) across ${SCAN_PATHS.length} root(s) ` +
      `(floor ${SCANNED_FLOOR}) — the derived scan roots resolved to nearly nothing, so a green here is green about nothing`,
  );
}
if (claimHits === 0) {
  console.log(
    `  ✓ Unsafe-claim scan: no affirmative over-reach claims (${scannedCount} file(s) across ${SCAN_PATHS.length} derived root(s))`,
  );
}

console.log("");
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\nDocs sanity FAILED (${problems.length} issue${problems.length > 1 ? "s" : ""}).`);
  process.exit(1);
}
console.log("Docs sanity passed — required docs present, no unsafe claims.");
