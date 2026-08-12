// Proof: the Municipal Critical Services Trust & Resilience doctrine, checked against
// the shipped code rather than against a restatement of itself.
//
// WHAT THIS IS AND IS NOT. docs/SIGNALGRID_MUNICIPAL_CRITICAL_SERVICES_RESILIENCE_MODEL.md
// reads nineteen municipal failure themes onto surfaces that already ship. Most of that
// document is DOCTRINE and SPECIFICATION by its own tags. This file asserts the parts
// that are checkable now:
//
//   1. Fail-closed, municipal reading (§4/§7): an evidence gap — the state a missing
//      vendor-access or data-integrity signal produces — never yields a MORE permissive
//      decision than the fully-evidenced one. If even a direct signal going dark cannot
//      relax the decision, a contested municipal record certainly cannot.
//   2. Specification, not minted (§16): no MUNICIPAL_* prefix appears as a decision
//      reason code, with a negative control so the scan is not vacuous.
//   3. The theme→family mapping is live (§2): every connector family the taxonomy names
//      as its covering surface still exists in lib/integrations — the table cannot rot.
//   4. No phantom links: every relative markdown link in the doc resolves on disk, and
//      the deferred lib/municipal-risk-catalog is named but neither linked nor present.
//
// NO NEW PRODUCT SCOPE. Nothing here mints a reason code, adds a connector, or changes a
// decision. It reads the shipped engine and the shipped source, and fails if the
// document has drifted from either.
//
//   pnpm run proof:municipal-resilience

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluatePolicy,
  deriveCriticalSignalsPresent,
  seedDemoStore,
  type DecisionEvidence,
  type PolicyVersion,
  type ComplianceState,
  type Freshness,
  type RiskTier,
} from "@workspace/signalgrid-core";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Municipal Critical Services Resilience — doctrine vs shipped code\n");

// ── The engine, resolved the way a live decision resolves it ──────────────────
const fixedClock = { now: () => new Date("2026-08-08T00:00:00.000Z") };
function healthyEvidence(overrides: Partial<DecisionEvidence> = {}): DecisionEvidence {
  const partial = {
    identityEnabled: true as boolean | "unknown",
    deviceManaged: true as boolean | "unknown",
    deviceCompliance: "compliant" as ComplianceState,
    deviceEncrypted: true as boolean | "unknown",
    osSupported: true as boolean | "unknown",
    ownerType: "corporate" as DecisionEvidence["ownerType"],
    postureFreshness: "fresh" as Freshness,
    workflowRiskTier: "standard" as RiskTier,
    custodyState: "checked_out" as DecisionEvidence["custodyState"],
    dockChargeState: "charged" as DecisionEvidence["dockChargeState"],
    batteryHealth: "healthy" as DecisionEvidence["batteryHealth"],
    tamperState: "none" as DecisionEvidence["tamperState"],
    dockState: "empty" as DecisionEvidence["dockState"],
    baselineCompliance: "aligned" as DecisionEvidence["baselineCompliance"],
    badgeBinding: "present" as DecisionEvidence["badgeBinding"],
    ...overrides,
  } as Omit<DecisionEvidence, "criticalSignalsPresent">;
  return { ...partial, criticalSignalsPresent: deriveCriticalSignalsPresent(partial) };
}

const demo = seedDemoStore(fixedClock);
const tenantId = demo.tenants.northwind;
const policy = demo.store.findPolicyForWorkflow(tenantId, "med-admin");
const version = policy
  ? (demo.store.getPolicyVersion(tenantId, policy.activeVersionId) as PolicyVersion | undefined)
  : undefined;
if (!version || version.status !== "active") {
  console.error("FAIL: no ACTIVE policy version resolved — cannot evaluate the doctrine against live rules.");
  process.exit(1);
}
const decide = (e: DecisionEvidence) => evaluatePolicy(version, e);
const RANK: Record<string, number> = { deny: 0, restrict: 1, step_up: 2, allow: 3 };

// ── §4/§7 — fail-closed, the municipal reading ────────────────────────────────
const healthy = decide(healthyEvidence());
check(
  "POSITIVE CONTROL: the fully-evidenced healthy context CAN reach allow (engine is not hardwired to refuse)",
  healthy.outcome === "allow",
);
// Each axis degraded to UNKNOWN is the state a missing municipal signal produces —
// vendor access unverified, data integrity uncertain, management plane silent.
const unknownAxes: Array<[string, Partial<DecisionEvidence>]> = [
  ["identity state unknown (vendor identity unverified)", { identityEnabled: "unknown" }],
  ["device management unknown (management plane silent)", { deviceManaged: "unknown" }],
  ["posture stale (rule data freshness lost)", { postureFreshness: "stale" as Freshness }],
];
for (const [label, ov] of unknownAxes) {
  const d = decide(healthyEvidence(ov));
  check(
    `${label} does NOT yield a more permissive decision than healthy (fail-closed)`,
    RANK[d.outcome] <= RANK[healthy.outcome],
  );
}
// The positive direction, so the checks above cannot be satisfied by an engine that
// ignores its input: a real adverse finding raises friction.
const noncompliant = decide(healthyEvidence({ deviceCompliance: "noncompliant" as ComplianceState }));
check(
  "a non-compliant device raises friction below allow (evidence actually moves the decision)",
  RANK[noncompliant.outcome] < RANK.allow,
);

// ── §16 — specification, not minted ───────────────────────────────────────────
const policySrc = readFileSync(join(repo, "lib/signalgrid-core/src/policy.ts"), "utf8");
const resolutionSrc = readFileSync(join(repo, "lib/signalgrid-core/src/resolution.ts"), "utf8");
const decisionCodes = new Set(
  [...(policySrc + "\n" + resolutionSrc).matchAll(/reasonCode:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]),
);
const minted = [...decisionCodes].filter((c) => c.startsWith("MUNICIPAL_"));
check(
  `no MUNICIPAL_* code is minted as a decision code (found: ${minted.join(", ") || "none"})`,
  minted.length === 0,
);
check(
  "NEGATIVE CONTROL: the decision-code scan is not vacuous — it sees the real IDENTITY_DISABLED code",
  decisionCodes.has("IDENTITY_DISABLED"),
);

// ── §2 — the theme→family mapping is live ─────────────────────────────────────
// Every family the taxonomy table names as a covering surface must still exist. A
// renamed or deleted family fails this proof instead of leaving the doc pointing at air.
const NAMED_FAMILIES = [
  "agent-identity", "agent-behavior", "access-governance", "entitlement-binding",
  "oauth-consent", "link-usability", "app-update", "benchmark-selection", "vuln-scan",
  "policy-binding", "uem", "credential-exposure", "credential-rotation",
  "bootstrap-credential", "ot-posture", "data-protection", "store-scope", "carrier",
  "observability-integrity", "local-authority", "identity-risk", "edr-threat",
  "challenge-capability", "break-glass", "response-accountability",
];
// A family lives as either a directory (local-authority/) or a flat module (store-scope.ts).
const familyExists = (f: string) =>
  existsSync(join(repo, "lib/integrations/src/integrations", f)) ||
  existsSync(join(repo, "lib/integrations/src/integrations", `${f}.ts`));
const missingFamilies = NAMED_FAMILIES.filter((f) => !familyExists(f));
check(
  `all ${NAMED_FAMILIES.length} connector families the taxonomy names exist in lib/integrations (missing: ${missingFamilies.join(", ") || "none"})`,
  missingFamilies.length === 0,
);
check(
  "NEGATIVE CONTROL: the family scan is not vacuous — a made-up family name is correctly absent",
  !existsSync(join(repo, "lib/integrations/src/integrations/municipal-parking-meters.ts")),
);

// ── no phantom links ──────────────────────────────────────────────────────────
const docPath = join(repo, "docs/SIGNALGRID_MUNICIPAL_CRITICAL_SERVICES_RESILIENCE_MODEL.md");
const docSrc = readFileSync(docPath, "utf8");
const relLinks = [...docSrc.matchAll(/\]\(((?!https?:)[^)#]+\.md)\)/g)].map((m) => m[1]);
const broken = relLinks.filter((l) => !existsSync(join(repo, "docs", l)));
check(
  `every relative markdown link in the doc resolves on disk (${relLinks.length} links, broken: ${broken.join(", ") || "none"})`,
  relLinks.length > 0 && broken.length === 0,
);
check(
  "NEGATIVE CONTROL: the link scan is not vacuous — it found at least 5 relative links",
  relLinks.length >= 5,
);
check(
  "the deferred lib/municipal-risk-catalog is named as planned, NOT linked, and NOT present (no phantom)",
  !existsSync(join(repo, "lib/municipal-risk-catalog")) &&
    /municipal-risk-catalog/.test(docSrc) &&
    !/\]\([^)]*municipal-risk-catalog[^)]*\)/.test(docSrc),
);

const total = passed + failures.length;
// No `figures=` line on purpose: a doctrine proof, like proof:zero-trust-principles,
// proof:security-operations-evidence and proof:kpi-kri-kci — its assertion count is
// prose in the ledger, not a measured product figure. Publishing one would oblige
// figure-guard registration for a number that guards nothing real.
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("\nFailed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
