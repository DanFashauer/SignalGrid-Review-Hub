#!/usr/bin/env node
// Retention claims gate. The pricing page sold "90-day default retention,
// configurable" while no retention mechanism existed in any durable store —
// no lifecycle column, no purge path, and a runtime role DENIED DELETE — and
// the assessor pack said the opposite on the same day (role-lens review
// 2026-08-21, findings finance.1 / compliance.1). The position now lives in
// docs/DATA_RETENTION_AND_PERSONAL_DATA.md; this gate keeps every buyer- and
// assessor-facing surface resolved to it:
//   1. a retention DURATION on any scanned surface outside the recording
//      allowlist fails, file:line named — durations are claims, and no
//      duration is implemented;
//   2. DR-003 must carry its dated status line (the decision stands, the
//      tense was corrected) — the 90-day figure without it is the old lie;
//   3. vacuity floor: the scanner finding zero duration mentions anywhere
//      means the scanner is broken, not the estate clean.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// The same public-surface set docs-sanity scans, so the two gates cannot fork.
const SCAN_PATHS = [
  "README.md",
  "docs",
  "artifacts/signalgrid-review/src",
  "artifacts/signalgrid-web/src",
  "artifacts/signalgrid-app/src",
  "artifacts/signalgrid-desktop/src",
  "artifacts/signalgrid-mobile-pwa/src",
];

// Files that RECORD or GOVERN the retention position rather than selling it.
// A quoted defect in a review record or the inventory is evidence, not a claim.
const RECORDING = new Set([
  "docs/DATA_RETENTION_AND_PERSONAL_DATA.md",
  "docs/DECISION_RECORDS.md", // status-line REQUIRED — checked separately below
  "docs/CLAIM_INVENTORY.md",
  "docs/agent/CLAIM_INVENTORY.json",
  "docs/company/ROLE_LENS_REVIEW_2026-08-21.md",
  "docs/COMPANY_BUILD_PLAN.md",
]);

const DURATION_NEAR_RETENTION =
  /\b\d+[- ]?(?:day|month|year)s?\b[^\n]{0,80}?retention|retention[^\n]{0,80}?\b\d+[- ]?(?:day|month|year)s?\b/i;
// "Retention" the metric, not the mechanism: gross/net/customer retention is
// revenue vocabulary and no claim about stored data.
const REVENUE_RETENTION = /\b(?:gross|net|customer|user|logo|employee)\s+retention\b/i;
// A third-party product's own retention spec (a vendor free-tier row, a
// competitor fact) is not a SignalGrid claim — but the waiver must be worn
// IN PLACE so a reader of the line sees it was classified, not missed.
const THIRD_PARTY_MARKER = "retention-fact: third-party";
const DR_STATUS_MARKER = "**Status (August 21, 2026).**";

function walk(p) {
  const st = statSync(p);
  if (!st.isDirectory()) return [p];
  return readdirSync(p).flatMap((n) => walk(join(p, n)));
}

/** Pure over a {path: content} map so the self-test drives the same code. */
export function auditRetentionClaims(files) {
  const problems = [];
  let totalHits = 0;
  let drSeen = false;
  for (const [path, content] of Object.entries(files)) {
    const isDr = path === "docs/DECISION_RECORDS.md";
    if (isDr) drSeen = true;
    content.split("\n").forEach((line, i) => {
      if (!DURATION_NEAR_RETENTION.test(line)) return;
      if (REVENUE_RETENTION.test(line) || line.includes(THIRD_PARTY_MARKER)) return;
      totalHits += 1;
      if (!RECORDING.has(path)) {
        problems.push(
          `${path}:${i + 1} states a retention duration — no duration is implemented in any store; the position is docs/DATA_RETENTION_AND_PERSONAL_DATA.md`,
        );
      }
    });
    if (isDr && DURATION_NEAR_RETENTION.test(content) && !content.includes(DR_STATUS_MARKER)) {
      problems.push(
        "docs/DECISION_RECORDS.md carries the 90-day retention figure WITHOUT its dated status line — the figure alone reads as shipped",
      );
    }
  }
  if (totalHits === 0) {
    problems.push("vacuity: zero retention-duration mentions found anywhere — the scanner, not the estate, is broken");
  }
  if (!drSeen) {
    problems.push("docs/DECISION_RECORDS.md was not scanned — the DR-003 status-line check cannot run");
  }
  return problems;
}

function loadTree() {
  const files = {};
  for (const root of SCAN_PATHS) {
    for (const f of walk(root)) {
      if (!/\.(md|json|ts|tsx|js|jsx|html)$/.test(f)) continue;
      files[f] = readFileSync(f, "utf8");
    }
  }
  return files;
}

function selfTest() {
  const checks = [];
  const dr = `## DR-003 — retention: 90-day default retention window\n${DR_STATUS_MARKER} intended, not implemented.`;
  const good = {
    "docs/DECISION_RECORDS.md": dr,
    "docs/DATA_RETENTION_AND_PERSONAL_DATA.md": "No retention is implemented. The former 90-day retention claim was removed.",
    "artifacts/signalgrid-web/src/pages/Pricing.tsx": "Tamper-evident audit ledger — exportable at any time",
  };
  let p = auditRetentionClaims(good);
  checks.push(["a corrected tree passes", p.length === 0]);
  p = auditRetentionClaims({
    ...good,
    "artifacts/signalgrid-web/src/pages/Pricing.tsx": '"90-day default retention, configurable"',
  });
  checks.push(["a reintroduced pricing duration FAILS with the file named", p.some((x) => x.includes("Pricing.tsx:1"))]);
  p = auditRetentionClaims({
    ...good,
    "docs/DECISION_RECORDS.md": "## DR-003 — retention: the shipped default is 90 days retention.",
  });
  checks.push(["DR-003 without its status line FAILS", p.some((x) => x.includes("WITHOUT its dated status line"))]);
  p = auditRetentionClaims({ "docs/DECISION_RECORDS.md": "nothing here", "README.md": "also nothing" });
  checks.push(["zero duration mentions anywhere is a scanner failure, not a pass", p.some((x) => x.includes("vacuity"))]);
  p = auditRetentionClaims({
    ...good,
    "docs/company/ROLE_CATALOG.md": "KPIs: gross and net retention; renewals started 90 days ahead",
  });
  checks.push(["revenue-retention vocabulary does not trip the gate", p.length === 0]);
  p = auditRetentionClaims({
    ...good,
    "docs/SOME_MATRIX.md": "Datadog free tier (1-day retention) <!-- retention-fact: third-party -->",
  });
  checks.push(["a marked third-party retention fact does not trip the gate", p.length === 0]);
  p = auditRetentionClaims({
    ...good,
    "docs/SOME_MATRIX.md": "Datadog free tier (1-day retention), unmarked",
  });
  checks.push(["an UNMARKED third-party duration still FAILS (classification is explicit)", p.some((x) => x.includes("SOME_MATRIX"))]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const problems = auditRetentionClaims(loadTree());
console.log("Retention-claims check — buyer/assessor surfaces held against the position document");
if (problems.length > 0) {
  console.error(`Retention-claims check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("Retention-claims check passed — no surface states a duration the position document does not implement.");
