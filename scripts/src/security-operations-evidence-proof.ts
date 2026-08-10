// Proof: the Security Operations Evidence Fabric doctrine, checked against the shipped
// code rather than against a restatement of itself.
//
// WHAT THIS IS AND IS NOT. docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md states
// how SignalGrid turns security-operations findings into workflow decisions. Most of
// that document is DOCTRINE and SPECIFICATION by its own tags. This file asserts the
// three things the document marks PROVEN/STRUCTURAL and that are checkable now:
//
//   1. Fail-closed: a missing or unknown security-relevant signal never yields a MORE
//      permissive decision than the fully-evidenced healthy one. (§5, PROVEN)
//   2. Specification, not minted: none of the ~90 proposed SecOps reason-code prefixes
//      appears as a DECISION reason code (policy.ts / resolution.ts). (§8)
//   3. The real-vs-fixture crypto boundary the doc draws (§6) matches the code: verdict
//      attestation uses real HMAC + constant-time compare; the control-plane bundle uses
//      a non-cryptographic hash and hard-coded fixture keys.
//
// NO NEW PRODUCT SCOPE. Nothing here mints a reason code, adds a connector, or changes a
// decision. It reads the shipped engine and the shipped source, and fails if the
// document has drifted away from either.
//
//   pnpm run proof:security-operations-evidence

import { readFileSync, existsSync } from "node:fs";
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

console.log("Security Operations Evidence Fabric — doctrine vs shipped code\n");

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

// Outcomes ranked by permissiveness; a security signal must never move the decision UP.
const RANK: Record<string, number> = { deny: 0, restrict: 1, step_up: 2, allow: 3 };

// ── §5 PROVEN — fail-closed against a security-shaped evidence gap ─────────────
const healthy = decide(healthyEvidence());
check(
  "POSITIVE CONTROL: the fully-evidenced healthy context CAN reach allow (engine is not hardwired to refuse)",
  healthy.outcome === "allow",
);

// Each of these degrades exactly one security-relevant axis to UNKNOWN — the state a
// missing security signal produces — and asserts the decision is never MORE permissive
// than healthy. This is the security-operations reading of the whole product's
// fail-closed law: absent evidence can add friction, never remove it.
const unknownAxes: Array<[string, Partial<DecisionEvidence>]> = [
  ["identity state unknown", { identityEnabled: "unknown" }],
  ["device management unknown", { deviceManaged: "unknown" }],
  ["device encryption unknown", { deviceEncrypted: "unknown" }],
  ["OS support unknown", { osSupported: "unknown" }],
];
for (const [label, ov] of unknownAxes) {
  const d = decide(healthyEvidence(ov));
  check(
    `${label} does NOT yield a more permissive decision than healthy (fail-closed)`,
    RANK[d.outcome] <= RANK[healthy.outcome],
  );
}

// A non-compliant device (a real security finding) must strictly RAISE friction — the
// positive direction of the same law, so the check above is not satisfiable by an engine
// that ignores its input.
const nonCompliant = decide(healthyEvidence({ deviceCompliance: "noncompliant" as ComplianceState }));
check(
  "a non-compliant device raises friction below allow (evidence actually moves the decision)",
  RANK[nonCompliant.outcome] < RANK.allow,
);

// ── §8 — specification, not minted ────────────────────────────────────────────
const policySrc = readFileSync(join(repo, "lib/signalgrid-core/src/policy.ts"), "utf8");
const resolutionSrc = readFileSync(join(repo, "lib/signalgrid-core/src/resolution.ts"), "utf8");
const decisionLayer = policySrc + "\n" + resolutionSrc;

const SPEC_PREFIXES = [
  "SIEM_", "SOC_", "PENTEST_", "MALWARE_", "CRYPTO_", "NETWORK_",
  "WEB_", "LINUX_", "INCIDENT_", "FORENSIC_", "SECURITY_", "MITRE_", "ADVERSARIAL_",
];
// A decision reason code is a quoted SCREAMING_SNAKE literal in the reasonCode position.
const decisionCodes = new Set(
  [...decisionLayer.matchAll(/reasonCode:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]),
);
const mintedSpec = [...decisionCodes].filter((c) => SPEC_PREFIXES.some((p) => c.startsWith(p)));
check(
  `none of the ${SPEC_PREFIXES.length} proposed SecOps reason-code families is minted as a decision code (found: ${mintedSpec.join(", ") || "none"})`,
  mintedSpec.length === 0,
);
// NEGATIVE CONTROL for the scan: a real decision code IS found, so "found none" above is
// a fact about the SecOps prefixes, not a broken matcher that finds nothing at all.
check(
  "NEGATIVE CONTROL: the decision-code scan is not vacuous — it sees the real IDENTITY_DISABLED code",
  decisionCodes.has("IDENTITY_DISABLED"),
);

// ── §6 — the real-vs-fixture crypto boundary matches the code ─────────────────
const attestSrc = readFileSync(join(repo, "lib/verdict-attestation/src/attest.ts"), "utf8");
check(
  "REAL crypto: verdict attestation uses node HMAC and a constant-time comparison (§6)",
  /createHmac\(\s*["']sha256["']/.test(attestSrc) && /timingSafeEqual/.test(attestSrc),
);
check(
  "STRUCTURAL: an unverified verdict is degraded to step_up, one-directionally (never lowers a stricter action) (§6)",
  /degrade is one-directional/i.test(attestSrc) || /already says `restrict` is not lowered/i.test(attestSrc),
);
const cpSrc = readFileSync(join(repo, "lib/control-plane/src/index.ts"), "utf8");
check(
  "FIXTURE crypto, disclosed: control-plane bundle uses a non-cryptographic FNV hash and hard-coded fixture signing keys (§6)",
  /function fnv1a/.test(cpSrc) && /FIXTURE_SIGNING_KEYS/.test(cpSrc),
);
check(
  "…and the source says so, rather than hiding it (the doc's honesty rests on this comment existing)",
  /PUBLIC-SAFE FIXTURES/.test(cpSrc) && /asymmetric signing/.test(cpSrc),
);

// ── the doc links the built companion and still links no phantom ──────────────
// This assertion tracks the world, not a frozen snapshot: the KPI/KRI/KCI model was the
// "planned, not linked" companion when this doc shipped; it is now built, so the doc
// SHOULD link it. The Authentication & Federation model is still absent, so the doc must
// still NOT link it. Both halves matter — the second is the no-phantom guarantee.
const docSrc = readFileSync(join(repo, "docs/SIGNALGRID_SECURITY_OPERATIONS_EVIDENCE_MODEL.md"), "utf8");
const kpiDocExists = existsSync(join(repo, "docs/SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md"));
const kpiLinked = /\]\([^)]*SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL\.md\)/.test(docSrc);
check(
  "the now-built KPI/KRI/KCI companion is BOTH present on disk AND linked from this doc (no dangling reference)",
  kpiDocExists && kpiLinked,
);
check(
  "the still-absent Auth/Federation model is named but NOT linked — no link to a phantom",
  !existsSync(join(repo, "docs/SIGNALGRID_AUTHENTICATION_AND_FEDERATION_MODEL.md")) &&
    !/\]\([^)]*SIGNALGRID_AUTHENTICATION_AND_FEDERATION_MODEL\.md\)/.test(docSrc),
);

const total = passed + failures.length;
// No `figures=` line on purpose: this is a doctrine proof, like proof:zero-trust-principles,
// and its assertion count is prose in the ledger, not a measured product figure the docs
// quote. Publishing a `figures=` line would oblige registration with the figure guard
// (check-guard-registries.mjs) for a number that guards nothing real.
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length) {
  console.error("\nFailed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
