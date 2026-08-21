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

// Numeric OR spelled-out amounts, and every unit a policy is written in —
// "12 weeks", "24 hours", "ninety days" are all duration claims.
const AMOUNT =
  "(?:\\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?)";
const UNIT = "(?:hour|day|week|month|quarter|year)s?";
const DURATION = new RegExp(`\\b${AMOUNT}[- ]?${UNIT}\\b`, "i");
// "retention" plus the storage vocabulary a copywriter reaches for instead:
// "Audit history is available for 90 days" and "we store decision data for
// 12 months" are the same unsupported claim without the word.
const RETENTION_TOKEN = /retention|retain(?:ed|s)?|\bstored?\b|\bstoring\b|\bhistory\b|\barchived?\b|\bkept\b|\bheld\b|\bavailable\b/gi;
// The storage synonyms only count when the window is about OUR data — a
// vendor "free trial, 31 days" or "available now" marketing line is not a
// duration claim about SignalGrid's stores.
const DATA_NOUN = /\b(?:data|history|audit|log|record|decision|evidence|ledger|chain|session)s?\b/i;
const REVENUE_QUALIFIER = /(?:gross|net|customer|user|logo|employee)\s+$/i;

/** Every retention TOKEN with a duration within 80 chars either side, minus
 *  revenue-qualified tokens and third-party-marked windows. Token-wise, not
 *  one regex alternation: a match anchored on an exempt "net retention"
 *  earlier in the text must not consume — and thereby shelter — a real
 *  data-retention claim later in the same span. */
function durationClaimsIn(text, windowChars = 80) {
  const hits = [];
  const seenWindows = new Set();
  for (const t of text.matchAll(RETENTION_TOKEN)) {
    const isRetentionWord = /^retention|^retain/i.test(t[0]);
    const before = text.slice(Math.max(0, t.index - 12), t.index);
    if (isRetentionWord && REVENUE_QUALIFIER.test(before)) continue;
    const window = text.slice(Math.max(0, t.index - windowChars), t.index + t[0].length + windowChars);
    if (!DURATION.test(window)) continue;
    if (window.includes(THIRD_PARTY_MARKER)) continue;
    // Storage synonyms need a data-noun in the window; the retention word
    // stands on its own.
    if (!isRetentionWord && !DATA_NOUN.test(window)) continue;
    // One claim, several trigger words ("history … stored … available"):
    // report it once per overlapping region, not once per synonym.
    const bucket = Math.floor(t.index / windowChars);
    if (seenWindows.has(bucket)) continue;
    seenWindows.add(bucket);
    hits.push({ index: t.index, window });
  }
  return hits;
}
// "Retention" the metric, not the mechanism: a retention token immediately
// preceded by gross/net/customer/… is revenue vocabulary, exempted per
// TOKEN (never per line) inside the audit below.
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
    let lineHitInFile = false;
    content.split("\n").forEach((line, i) => {
      for (const _hit of durationClaimsIn(line)) {
        lineHitInFile = true;
        totalHits += 1;
        if (!RECORDING.has(path)) {
          problems.push(
            `${path}:${i + 1} states a retention duration — no duration is implemented in any store; the position is docs/DATA_RETENTION_AND_PERSONAL_DATA.md`,
          );
        }
      }
    });
    // Markdown wrapping can split the duration from the word "retention"
    // across lines ("defaults to\n90 days"), and a per-line scan reads the
    // wrapped claim as two innocent lines. A whitespace-collapsed pass over
    // the whole file catches it; the exclusions apply to the matched window
    // so a wrapped revenue-retention KPI or a marked vendor fact stays clean.
    if (!lineHitInFile) {
      const collapsed = content.replace(/\s+/g, " ");
      const wrapped = durationClaimsIn(collapsed);
      if (wrapped.length > 0) {
        totalHits += wrapped.length;
        if (!RECORDING.has(path)) {
          problems.push(
            `${path} states a LINE-WRAPPED retention duration ("…${wrapped[0].window.trim().slice(0, 70)}…") — no duration is implemented in any store; the position is docs/DATA_RETENTION_AND_PERSONAL_DATA.md`,
          );
        }
      }
    }
    if (isDr && durationClaimsIn(content.replace(/\s+/g, " ")).length > 0) {
      // The marker alone is a heading; the CORRECTIVE MEANING is what keeps
      // DR-003 honest. The status paragraph must still say the default is
      // intended/not implemented — a rewrite that keeps the dated marker but
      // says "shipped" restores the exact claim this check exists to prevent.
      const at = content.indexOf(DR_STATUS_MARKER);
      const statusText = at >= 0 ? content.slice(at, at + 700) : "";
      if (at < 0) {
        problems.push(
          "docs/DECISION_RECORDS.md carries the 90-day retention figure WITHOUT its dated status line — the figure alone reads as shipped",
        );
      } else if (!/\bintended\b|\bnot implemented\b|no retention mechanism is implemented/i.test(statusText)) {
        problems.push(
          "docs/DECISION_RECORDS.md's DR-003 status paragraph no longer says the default is INTENDED / not implemented — the dated marker without the corrective meaning reads as shipped",
        );
      }
    }
  }
  if (totalHits === 0) {
    problems.push("vacuity: zero retention-duration mentions found anywhere — the scanner, not the estate, is broken");
  }
  if (!drSeen) {
    problems.push("docs/DECISION_RECORDS.md was not scanned — the DR-003 status-line check cannot run");
  }
  // The canonical position document is in RECORDING (it must quote durations
  // to refute them), which would let a rewrite claiming IMPLEMENTED ride
  // green while the questionnaire cites it as authoritative. Validate its
  // corrective meaning, exactly as DR-003's.
  const position = files["docs/DATA_RETENTION_AND_PERSONAL_DATA.md"];
  if (position !== undefined && !/no retention, deletion, or purge mechanism is implemented/i.test(position)) {
    problems.push(
      "docs/DATA_RETENTION_AND_PERSONAL_DATA.md no longer states that NO retention/deletion/purge mechanism is implemented — the canonical position lost its corrective meaning while every surface cites it",
    );
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
    "docs/DATA_RETENTION_AND_PERSONAL_DATA.md":
      "No retention, deletion, or purge mechanism is implemented. The former 90-day retention claim was removed.",
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
  p = auditRetentionClaims({
    ...good,
    "docs/WRAPPED.md": "Retention is configurable and defaults to\n90 days for every paid tier.",
  });
  checks.push(["a LINE-WRAPPED duration claim FAILS (multiline negative control)", p.some((x) => x.includes("WRAPPED") && x.includes("LINE-WRAPPED"))]);
  p = auditRetentionClaims({
    ...good,
    "docs/WRAPPED_KPI.md": "We track gross and net retention and started renewals\n90 days ahead of schedule.",
  });
  checks.push(["a line-wrapped REVENUE-retention KPI stays clean", p.length === 0]);
  for (const [label, text] of [
    ["'12 weeks'", "Data retention defaults to 12 weeks for all tiers."],
    ["'24 hours'", "Retention: 24 hours of hot data."],
    ["spelled-out 'ninety days'", "Data retention defaults to ninety days."],
  ]) {
    p = auditRetentionClaims({ ...good, "docs/FORMATS.md": text });
    checks.push([`a ${label} duration claim FAILS (format coverage)`, p.some((x) => x.includes("FORMATS"))]);
  }
  p = auditRetentionClaims({
    ...good,
    "docs/MIXED.md": "Net retention is 90%; SignalGrid data retention defaults to 30 days.",
  });
  checks.push([
    "revenue vocabulary earlier on the line does NOT shelter a data-retention claim after it",
    p.some((x) => x.includes("MIXED")),
  ]);
  p = auditRetentionClaims({
    ...good,
    "docs/DECISION_RECORDS.md": `## DR-003 — retention: 90-day default retention window\n${DR_STATUS_MARKER} The 90-day default retention window is shipped and on by default.`,
  });
  checks.push([
    "a DR-003 status that keeps the marker but claims SHIPPED fails (semantic check)",
    p.some((x) => x.includes("no longer says the default is INTENDED")),
  ]);
  for (const [label, text] of [
    ["'Audit history is available for 90 days'", "Audit history is available for 90 days."],
    ["'We store decision data for 12 months'", "We store decision data for 12 months."],
  ]) {
    p = auditRetentionClaims({ ...good, "docs/SYNONYM.md": text });
    checks.push([`a retention-free duration claim ${label} FAILS (storage vocabulary)`, p.some((x) => x.includes("SYNONYM"))]);
  }
  p = auditRetentionClaims({ ...good, "docs/TRIAL.md": "Microsoft Sentinel free trial, 31 days, then billed." });
  checks.push(["a vendor free-trial duration without a data-noun stays clean", p.length === 0]);
  p = auditRetentionClaims({
    ...good,
    "docs/DATA_RETENTION_AND_PERSONAL_DATA.md": "Retention defaults to 90 days and is implemented in every store.",
  });
  checks.push([
    "the POSITION DOCUMENT itself claiming implemented fails (self-validation)",
    p.some((x) => x.includes("canonical position lost its corrective meaning")),
  ]);
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
