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
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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
];
// Boundary/disclaimer framing that must NOT be flagged (mirrors the CI allow-regex).
const ALLOW = /not |does not|do not|no |avoid|guardrail|disclaimer|should not|must not|without claiming|no claim|doesn.t claim|not claim|git grep|denylist|unsafe-claim scan|validation command|pre-announcement|design target/i;
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
    out = execFileSync("git", ["grep", "-nF", "--", phrase, "--", ...SCAN_PATHS], { cwd: repo, encoding: "utf8" });
  } catch {
    out = ""; // git grep exits non-zero when there are no matches
  }
  for (const line of out.split("\n").filter(Boolean)) {
    if (ALLOW.test(line)) continue;
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
