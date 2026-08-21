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
import { existsSync, readFileSync } from "node:fs";
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
const META_FILES = new Set([
  "docs/PUBLIC_MESSAGING_GUARDRAILS.md",
  // The claim inventory RECORDS every buyer-facing claim verbatim — including
  // the forbidden ones — each with its classification and contradicting
  // citation. Quoting a defect to order its removal is evidence, not a claim;
  // failing the record of the defect would forbid writing the record.
  "docs/CLAIM_INVENTORY.md",
  "docs/agent/CLAIM_INVENTORY.json",
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

const SCAN_PATHS = [
  "README.md",
  "docs",
  "artifacts/signalgrid-review/src",
  "artifacts/signalgrid-web/src",
  "artifacts/signalgrid-app/src",
  "artifacts/signalgrid-desktop/src",
  "artifacts/signalgrid-mobile-pwa/src",
];
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
    if (META_FILES.has(path)) continue;
    if (META.test(content)) continue;
    if (!hasBareClaim(content, phrase)) continue;
    const leadIn = lineNo > 0 ? listLeadIn(path, lineNo) : null;
    if (leadIn !== null && (NEGATOR.test(leadIn) || META.test(leadIn))) continue;
    problems.push(`Unsafe direct claim found for '${phrase}': ${line}`);
    claimHits += 1;
  }
}
if (claimHits === 0) console.log("  ✓ Unsafe-claim scan: no affirmative over-reach claims in docs/app source");

console.log("");
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\nDocs sanity FAILED (${problems.length} issue${problems.length > 1 ? "s" : ""}).`);
  process.exit(1);
}
console.log("Docs sanity passed — required docs present, no unsafe claims.");
