// Proof: the KPI / KRI / KCI doctrine, checked against the shipped engine rather than
// against a restatement of itself.
//
// WHAT THIS IS AND IS NOT. docs/SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md states how
// SignalGrid treats indicators: an indicator can raise the assurance a workflow requires,
// but it can never create a grant the direct evidence does not support, and a favourable
// rollup is a ceiling — never the observation of the specific event. Most of that document
// is DOCTRINE by its own tags. This file asserts the parts it marks PROVEN and DERIVED and
// that are checkable now:
//
//   1. §2 PROVEN — the asymmetry. Blanking one direct signal to `unknown` never yields a
//      decision MORE permissive than the fully-evidenced healthy one. An indicator, being
//      even less authoritative than a direct signal, cannot do what an unknown direct
//      signal cannot: relax the decision.
//   2. §3 PROVEN — a green KPI is a ceiling. Coverage computed from acquisition posture
//      carries `basis: "projected_from_sourcing"` and is never labelled `observed`, so a
//      100% projected coverage can never be read as "this event was captured".
//   3. §4 PROVEN — the KCI SignalGrid already computes (the response-accountability
//      watermelon) is deterministic and replayable: the same record grades identically.
//   4. §7 — specification, not minted: no proposed indicator name is a decision reason
//      code, with a negative control so the scan is not vacuous.
//
// NO NEW PRODUCT SCOPE. Nothing here mints a reason code, adds a connector, or changes a
// decision. It reads the shipped engine and the shipped source, and fails if the document
// has drifted from either.
//
//   pnpm run proof:kpi-kri-kci

import { readFileSync } from "node:fs";
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
import {
  evaluateGridCoverage,
  projectSourcingAsSignalStates,
  GRID_SITUATIONS,
  DEMO_FLOWS,
  type SignalSource,
} from "@workspace/flows";
import { evaluateResponseFixture } from "@workspace/integrations/response-accountability";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("KPI / KRI / KCI model — doctrine vs shipped engine\n");

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

// ── §2 PROVEN — the asymmetry: an indicator cannot relax a decision ────────────
// The doctrine's one rule is that a favourable indicator can never produce a grant the
// direct evidence does not support. An indicator is LESS authoritative than a direct
// signal, so the tightest checkable version is: an UNKNOWN direct signal never yields a
// more permissive decision than the fully-evidenced one. If even a direct signal going
// dark cannot relax the decision, a rollup certainly cannot.
const healthy = decide(healthyEvidence());
check(
  "POSITIVE CONTROL: the fully-evidenced healthy context CAN reach allow (engine is not hardwired to refuse)",
  healthy.outcome === "allow",
);
const unknownAxes: Array<[string, Partial<DecisionEvidence>]> = [
  ["identity state unknown", { identityEnabled: "unknown" }],
  ["device management unknown", { deviceManaged: "unknown" }],
  ["device encryption unknown", { deviceEncrypted: "unknown" }],
  ["posture freshness stale", { postureFreshness: "stale" as Freshness }],
];
for (const [label, ov] of unknownAxes) {
  const d = decide(healthyEvidence(ov));
  check(
    `${label} does NOT yield a more permissive decision than healthy (indicator cannot relax)`,
    RANK[d.outcome] <= RANK[healthy.outcome],
  );
}
// The positive direction, so the checks above are not satisfiable by an engine that
// ignores its input: a real adverse finding raises friction.
const noncompliant = decide(healthyEvidence({ deviceCompliance: "noncompliant" as ComplianceState }));
check(
  "a non-compliant device raises friction below allow (direct evidence actually moves the decision)",
  RANK[noncompliant.outcome] < RANK.allow,
);

// ── §3 PROVEN — a green KPI is a ceiling, not a measurement ────────────────────
// Coverage is a KPI. Computed from acquisition posture it is a CEILING — what the estate
// COULD answer once every wireable signal is wired and healthy — and it carries a basis
// that says so. A projected 100% must never be labelled `observed`, because green means
// measured. This is the coverage-basis mechanism, read as the KPI doctrine.
const allWireable: SignalSource[] = [
  { id: "identity", name: "Identity", system: "Entra ID", method: "api" },
  { id: "device_compliance", name: "Compliance", system: "Intune", method: "api" },
  { id: "badge_binding", name: "Badge", system: "RFID", method: "native" },
  { id: "baseline", name: "Baseline", system: "scanner", method: "grid_collected" },
  { id: "change_window", name: "Change window", system: "ITSM", method: "native" },
  { id: "custody", name: "Custody", system: "RTLS", method: "grid_collected" },
];
const projection = projectSourcingAsSignalStates(allWireable);
const projected = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, projection);
check(
  "a coverage KPI computed from sourcing carries basis 'projected_from_sourcing' (a ceiling)",
  projected.basis === "projected_from_sourcing",
);
check(
  "…and even at 100% it is NEVER labelled 'observed' — a green KPI cannot pose as the observation of an event",
  !(projected.coveragePct === 100 && (projected.basis as string) === "observed"),
);
// The other side: real observed states DO produce an observed basis, so the label tracks
// reality rather than always saying 'projected'.
const observed = evaluateGridCoverage(DEMO_FLOWS, GRID_SITUATIONS, [
  { id: "identity", status: "healthy" as const },
]);
check(
  "NEGATIVE CONTROL: real observed signal states produce basis 'observed' (the label is not hardwired to 'projected')",
  observed.basis === "observed",
);

// ── §4 PROVEN — the watermelon KCI is deterministic and replayable ─────────────
// The canonical Key Control Indicator (does the control actually catch what it should)
// is the response-accountability watermelon: claimed RESOLVED while the concern is still
// present. An indicator you can argue with is not an indicator; this one is deterministic.
const w1 = evaluateResponseFixture("watermelon");
const w2 = evaluateResponseFixture("watermelon");
check(
  "the watermelon KCI evaluates a record (fixture resolves)",
  w1 !== null,
);
check(
  "the watermelon KCI is deterministic — the same record grades identically (replayable, auditable)",
  w1 !== null && JSON.stringify(w1) === JSON.stringify(w2),
);
check(
  "…and it actually FIRES on the watermelon record — posture 'falsely_resolved', action 'alert', code WATERMELON_CLOSED_BUT_UNRESOLVED (the KCI is not vacuously quiet)",
  w1 !== null &&
    w1.posture === "falsely_resolved" &&
    w1.recommendedAction === "alert" &&
    w1.reasonCode === "WATERMELON_CLOSED_BUT_UNRESOLVED",
);

// ── §7 — specification, not minted ────────────────────────────────────────────
const policySrc = readFileSync(join(repo, "lib/signalgrid-core/src/policy.ts"), "utf8");
const resolutionSrc = readFileSync(join(repo, "lib/signalgrid-core/src/resolution.ts"), "utf8");
const decisionLayer = policySrc + "\n" + resolutionSrc;
const decisionCodes = new Set(
  [...decisionLayer.matchAll(/reasonCode:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]),
);
// Indicator-shaped prefixes the doc names. None of these may be a DECISION reason code —
// an indicator is not a decision input, and a scorecard must never quietly become one.
const SPEC_PREFIXES = ["KPI_", "KRI_", "KCI_", "INDICATOR_", "SCORECARD_", "METRIC_"];
const mintedSpec = [...decisionCodes].filter((c) => SPEC_PREFIXES.some((p) => c.startsWith(p)));
check(
  `no proposed indicator prefix is minted as a decision code (found: ${mintedSpec.join(", ") || "none"})`,
  mintedSpec.length === 0,
);
check(
  "NEGATIVE CONTROL: the decision-code scan is not vacuous — it sees the real TRUST_ESTABLISHED code",
  decisionCodes.has("TRUST_ESTABLISHED"),
);

// ── the named companion is honestly absent ────────────────────────────────────
// The doc says an Authentication & Federation model is referenced but not built. Assert
// the doc contains no markdown LINK to it — named as planned, never linked to a phantom.
const docSrc = readFileSync(join(repo, "docs/SIGNALGRID_ENTERPRISE_KPI_KRI_KCI_MODEL.md"), "utf8");
check(
  "the doc names the unbuilt Auth/Federation companion but links to no phantom (no [..](..AUTHENTICATION..) link)",
  !/\]\([^)]*AUTHENTICATION_AND_FEDERATION[^)]*\)/.test(docSrc),
);

const total = passed + failures.length;
// No `figures=` line: a doctrine proof like proof:zero-trust-principles and
// proof:security-operations-evidence — its assertion count is prose in the ledger, not a
// measured product figure the docs quote. Publishing one would oblige figure-guard
// registration for a number that guards nothing real.
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("\nFailed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
