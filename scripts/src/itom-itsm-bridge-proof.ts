// Proof: the ITOM / ITSM Bridge doctrine, checked against the shipped engine and the
// shipped classification model rather than against a restatement of itself.
//
// WHAT THIS IS AND IS NOT. docs/SIGNALGRID_ITOM_ITSM_BRIDGE_MODEL.md states how
// SignalGrid sits between the operations plane (what is broken) and the service plane
// (who owns it). Most of it is DOCTRINE and SPECIFICATION by its own tags. This file
// asserts the parts marked PROVEN/STRUCTURAL that are checkable now:
//
//   1. §5 PROVEN — the structural unreachability of ITSM_SERVICE_OWNER_UNRESOLVED.
//      EVERY emitted reason code carries an owner from a closed role set with no
//      catch-all, so a code meaning "nobody owns this" can never fire. This is the
//      claim row 70 of the intake ledger made in prose; here it is mechanical.
//   2. §6/§9 — fail-closed across the bridge: an unknown operational signal never
//      yields a MORE permissive decision than the fully-evidenced one.
//   3. §12 — specification, not minted: no ITOM_* code and none of the proposed
//      bridge-only ITSM_* codes is a decision reason code, with negative controls.
//   4. §3/§8 — the ITOM-side families the taxonomy names still exist on disk.
//
// NO NEW PRODUCT SCOPE. Nothing here mints a reason code, adds a connector, or changes
// a decision.
//
//   pnpm run proof:itom-itsm-bridge

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
// @ts-expect-error — plain-JS classification model, no type declarations by design.
import { REASON_CODE_LAYERS, OWNER_ROLES } from "../it-layer-model.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("ITOM / ITSM Bridge — doctrine vs shipped engine and classification model\n");

// ── §5 PROVEN — ITSM_SERVICE_OWNER_UNRESOLVED is structurally unreachable ──────
// The document declines to mint this proposed code. The reason must be mechanical,
// not editorial: every emitted reason code already has an owner, enforced at build
// time, so the condition the code names cannot exist in a shipped engine.
// Both exports are arrays of OBJECTS, not strings — verified rather than assumed:
// OWNER_ROLES rows are { id, covers }; REASON_CODE_LAYERS rows are { code, owner, … }.
const rows = REASON_CODE_LAYERS as Array<{ code: string; owner: string }>;
const roleIds = new Set((OWNER_ROLES as Array<{ id: string }>).map((r) => r.id));

check(
  `the classification model is non-empty (${rows.length} classified reason codes, ${roleIds.size} owner roles)`,
  rows.length > 0 && roleIds.size > 0,
);
const ownerless = rows.filter((r) => !r.owner || String(r.owner).trim() === "");
check(
  `EVERY classified reason code carries a non-empty owner (ownerless: ${ownerless.map((r) => r.code).join(", ") || "none"})`,
  ownerless.length === 0,
);
const badRole = rows.filter((r) => !roleIds.has(r.owner));
check(
  `every owner is drawn from the closed OWNER_ROLES set — no catch-all (offenders: ${badRole.map((r) => `${r.code}:${r.owner}`).join(", ") || "none"})`,
  badRole.length === 0,
);
// NEGATIVE CONTROL: the owner scan is falsifiable — a synthetic ownerless row and a
// synthetic off-roster owner are both detected, so "none found" is a fact about the
// model rather than a matcher that can never fire.
check(
  "NEGATIVE CONTROL: the owner checks are falsifiable — synthetic ownerless and off-roster rows ARE detected",
  [{ code: "X", owner: "" }].filter((r) => !r.owner).length === 1 &&
    [{ code: "Y", owner: "not_a_real_role" }].filter((r) => !roleIds.has(r.owner)).length === 1,
);

// ── §6/§9 — fail-closed across the bridge ─────────────────────────────────────
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
    // STATED, not omitted (review finding F2, 2026-09-02). This fixture claims
    // "everything is known and healthy" while leaving a required field of
    // `DecisionEvidence` off the object behind an `as` cast — and an omitted
    // freshness used to read as GOOD, because `undefined` equals none of the
    // values the backstop rejects. It now reads as "unknown" and disqualifies,
    // which is the doctrine (silence never affirms). Every dock channel above is
    // populated and healthy, so the honest stamp for this context is "fresh".
    dockEvidenceFreshness: "fresh" as Freshness,
    ...overrides,
  } as Omit<DecisionEvidence, "criticalSignalsPresent">;
  return { ...partial, criticalSignalsPresent: deriveCriticalSignalsPresent(partial) };
}

const demo = seedDemoStore(fixedClock);
const policy = demo.store.findPolicyForWorkflow(demo.tenants.northwind, "med-admin");
const version = policy
  ? (demo.store.getPolicyVersion(demo.tenants.northwind, policy.activeVersionId) as PolicyVersion | undefined)
  : undefined;
if (!version || version.status !== "active") {
  console.error("FAIL: no ACTIVE policy version resolved — cannot evaluate the doctrine against live rules.");
  process.exit(1);
}
const decide = (e: DecisionEvidence) => evaluatePolicy(version, e);
const RANK: Record<string, number> = { deny: 0, restrict: 1, step_up: 2, allow: 3 };

const healthy = decide(healthyEvidence());
check(
  "POSITIVE CONTROL: the fully-evidenced healthy context CAN reach allow (engine is not hardwired to refuse)",
  healthy.outcome === "allow",
);
// A silent management plane is the ITOM-side evidence gap; stale posture is the
// telemetry-freshness gap. Neither may relax the decision.
for (const [label, ov] of [
  ["management plane silent (ITOM telemetry missing)", { deviceManaged: "unknown" as const }],
  ["posture stale (ITOM telemetry stale)", { postureFreshness: "stale" as Freshness }],
] as Array<[string, Partial<DecisionEvidence>]>) {
  const d = decide(healthyEvidence(ov));
  check(
    `${label} does NOT yield a more permissive decision than healthy (fail-closed across the bridge)`,
    RANK[d.outcome] <= RANK[healthy.outcome],
  );
}
const noncompliant = decide(healthyEvidence({ deviceCompliance: "noncompliant" as ComplianceState }));
check(
  "a real adverse finding raises friction below allow (evidence actually moves the decision)",
  RANK[noncompliant.outcome] < RANK.allow,
);

// ── §12 — specification, not minted ───────────────────────────────────────────
const decisionLayer =
  readFileSync(join(repo, "lib/signalgrid-core/src/policy.ts"), "utf8") + "\n" +
  readFileSync(join(repo, "lib/signalgrid-core/src/resolution.ts"), "utf8");
const decisionCodes = new Set(
  [...decisionLayer.matchAll(/reasonCode:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1]),
);
const mintedItom = [...decisionCodes].filter((c) => c.startsWith("ITOM_"));
check(
  `no ITOM_* code is minted as a decision code (found: ${mintedItom.join(", ") || "none"})`,
  mintedItom.length === 0,
);
// The specific code this document declines to mint, asserted absent.
check(
  "ITSM_SERVICE_OWNER_UNRESOLVED is NOT minted — the doc declines it because it is unreachable, and the code agrees",
  !decisionCodes.has("ITSM_SERVICE_OWNER_UNRESOLVED"),
);
check(
  "NEGATIVE CONTROL: the decision-code scan is not vacuous — it sees the real IDENTITY_DISABLED code",
  decisionCodes.has("IDENTITY_DISABLED"),
);

// ── §5, the completeness half — the actual unreachability argument ────────────
// Owners exist and are real (above). This closes the loop: every code the DECISION
// LAYER can emit is classified, so there is no reachable state in which a refusal
// arrives without an owner — which is exactly what ITSM_SERVICE_OWNER_UNRESOLVED
// would have to name. Read from source rather than from a hand-maintained list, so
// a newly minted code cannot slip past by not being added to a registry.
const classified = new Set(rows.map((r) => r.code));
const unclassified = [...decisionCodes].filter((c) => !classified.has(c));
check(
  `every reason code the decision layer emits is classified with an owner (${decisionCodes.size} emitted, unclassified: ${unclassified.join(", ") || "none"}) — so "owner unresolved" names no reachable state`,
  decisionCodes.size > 0 && unclassified.length === 0,
);

// ── §3/§8 — the ITOM-side families the taxonomy names still exist ─────────────
const NAMED = [
  "observability-integrity", "telemetry", "siem", "syslog", "itsm", "change-window",
  "service-lifecycle", "response-accountability", "break-glass", "agent-identity",
  "agent-behavior", "nac", "network-nac", "ot-posture",
];
const familyExists = (f: string) =>
  existsSync(join(repo, "lib/integrations/src/integrations", f)) ||
  existsSync(join(repo, "lib/integrations/src/integrations", `${f}.ts`));
const missing = NAMED.filter((f) => !familyExists(f));
check(
  `all ${NAMED.length} ITOM/ITSM-side families the taxonomy names exist (missing: ${missing.join(", ") || "none"})`,
  missing.length === 0,
);

// ── the doc links only companions that exist ──────────────────────────────────
// The source specification referenced a KPI doc by a filename that was never built
// (SIGNALGRID_KPI_KRI_CONTROL_EFFECTIVENESS_MODEL.md). Assert the doc links the real
// one and no phantom.
const docSrc = readFileSync(join(repo, "docs/SIGNALGRID_ITOM_ITSM_BRIDGE_MODEL.md"), "utf8");
const relLinks = [...docSrc.matchAll(/\]\(((?!https?:)[^)#]+\.md)\)/g)].map((m) => m[1]);
const broken = relLinks.filter((l) => !existsSync(join(repo, "docs", l)));
check(
  `every relative link resolves on disk (${relLinks.length} links, broken: ${broken.join(", ") || "none"})`,
  relLinks.length >= 5 && broken.length === 0,
);
check(
  "the never-built CONTROL_EFFECTIVENESS filename from the source spec is NOT linked (no phantom)",
  !/CONTROL_EFFECTIVENESS/.test(docSrc),
);

const total = passed + failures.length;
// No `figures=` line: a doctrine proof like proof:zero-trust-principles,
// proof:security-operations-evidence, proof:kpi-kri-kci and proof:municipal-resilience.
console.log(`\nsummary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) {
  console.error("\nFailed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
}
