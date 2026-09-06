/**
 * SignalGrid core proof.
 *
 * Exercises the product-shaped, public-safe decision core end to end and
 * asserts the security-critical invariants the launch plan calls out:
 *   - the shared-device decision loop returns the expected outcome + reason
 *     codes for a spread of posture cases;
 *   - fail-closed: no decision allows on degraded/missing critical evidence;
 *   - tenant isolation: one tenant's objects are invisible under another
 *     tenant's key, and cross-tenant reads/evaluations fail closed;
 *   - RBAC: roles are limited to their permitted actions;
 *   - authentication fails closed on unknown tokens;
 *   - evidence snapshots and the audit ledger are tamper-evident;
 *   - the whole pipeline is deterministic.
 *
 * Everything here is synthetic and fixture-backed: no credentials, no tenant
 * data, no live vendor calls.
 */
import {
  authenticate,
  authorize,
  buildEvidence,
  buildResolutionPlan,
  computeMetrics,
  runDockSync,
  runFixtureSync,
  foldIdentityEnabled,
  deriveCriticalSignalsPresent,
  FRESHNESS_VALUES,
  EVIDENCE_VALUE_MEMBERS,
  EVIDENCE_VALUE_DOMAINS,
  canonicalJson,
  constantTimeEquals,
  CoreError,
  evaluatePolicy,
  fixedClock,
  MAX_POLICY_RULES,
  MAX_RULE_CONDITIONS,
  MemoryStore,
  mostRestrictiveOutcome,
  RESOLUTION_DESCRIPTOR_SHAPES,
  seedDemoStore,
  verifySnapshot,
  CORE_NORMALIZATION_VERSION,
  SignalGridCore,
  SHARED_DEVICE_RULES_V1,
  SHARED_DEVICE_RULES_V2,
  validatePolicyRules,
  type Decision,
  type DecisionEvidence,
  type DecisionOutcome,
  type Device,
  type Identity,
  type NormalizedSignal,
  type SignalCategory,
  type Workflow,
  SIGNAL_CATEGORIES,
  EVIDENCE_FIELDS,
} from "@workspace/signalgrid-core";
import type { Freshness, Role } from "@workspace/signalgrid-core";

interface Assertion {
  name: string;
  passed: boolean;
  detail?: string;
}

const assertions: Assertion[] = [];

function check(name: string, passed: boolean, detail?: string): void {
  assertions.push({ name, passed, detail });
}

function expectError(
  name: string,
  code: string,
  fn: () => unknown,
): void {
  try {
    fn();
    check(name, false, "expected an error but none was thrown");
  } catch (err) {
    if (err instanceof CoreError) {
      check(name, err.code === code, `got code "${err.code}", expected "${code}"`);
    } else {
      check(name, false, `threw non-CoreError: ${String(err)}`);
    }
  }
}

const core = SignalGridCore.demo();
const T = {
  owner: "sgk_demo_northwind_owner",
  operator: "sgk_demo_northwind_operator",
  auditor: "sgk_demo_northwind_auditor",
  atlasOwner: "sgk_demo_atlas_owner",
};

// ── 1. Decision loop: expected outcomes for a spread of posture cases ─────────

interface Scenario {
  label: string;
  identityRef: string;
  deviceRef: string;
  workflowKey: string;
  expectedOutcome: DecisionOutcome;
  expectedReason: string;
}

const scenarios: Scenario[] = [
  { label: "compliant-fresh-allow", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session", expectedOutcome: "allow", expectedReason: "TRUST_ESTABLISHED" },
  { label: "noncompliant-restrict", identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "DEVICE_NONCOMPLIANT" },
  { label: "stale-step-up", identityRef: "nurse.stale", deviceRef: "ipad-ward-03", workflowKey: "clinical-session", expectedOutcome: "step_up", expectedReason: "POSTURE_STALE" },
  { label: "unmanaged-restrict", identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "general-lookup", expectedOutcome: "restrict", expectedReason: "DEVICE_UNMANAGED" },
  { label: "disabled-identity-deny", identityRef: "nurse.disabled", deviceRef: "ipad-ward-04", workflowKey: "clinical-session", expectedOutcome: "deny", expectedReason: "IDENTITY_DISABLED" },
  { label: "missing-posture-restrict", identityRef: "nurse.nosync", deviceRef: "ipad-ward-05", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "POSTURE_MISSING" },
  { label: "critical-workflow-personal-deny", identityRef: "tech.unmanaged", deviceRef: "ipad-byod-01", workflowKey: "med-admin", expectedOutcome: "deny", expectedReason: "CRITICAL_WORKFLOW_UNTRUSTED_DEVICE" },
  { label: "custody-overdue-restrict", identityRef: "nurse.overdue", deviceRef: "ipad-loan-01", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "CUSTODY_OVERDUE" },
  { label: "tamper-suspected-restrict", identityRef: "nurse.tamper", deviceRef: "ipad-loan-02", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "TAMPER_SUSPECTED" },
  { label: "battery-critical-stepup", identityRef: "nurse.lowbatt", deviceRef: "ipad-loan-03", workflowKey: "clinical-session", expectedOutcome: "step_up", expectedReason: "BATTERY_CRITICAL" },
  { label: "battery-failing-restrict", identityRef: "nurse.failbatt", deviceRef: "ipad-loan-04", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "BATTERY_FAILING" },
  { label: "battery-flat-and-worn-restrict", identityRef: "nurse.flatandworn", deviceRef: "ipad-loan-05", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "BATTERY_FAILING" },
  { label: "baseline-drift-stepup", identityRef: "nurse.baseline_drift", deviceRef: "ipad-ward-06", workflowKey: "clinical-session", expectedOutcome: "step_up", expectedReason: "BASELINE_DRIFTED" },
  { label: "badge-removed-restrict", identityRef: "nurse.badge_removed", deviceRef: "ipad-badge-01", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "BADGE_REMOVED" },
  { label: "badge-forced-deny", identityRef: "nurse.badge_forced", deviceRef: "ipad-badge-02", workflowKey: "clinical-session", expectedOutcome: "deny", expectedReason: "BADGE_FORCED_REMOVAL" },
  { label: "smartdock-faulted-restrict", identityRef: "nurse.dock_faulted", deviceRef: "ipad-dock-01", workflowKey: "clinical-session", expectedOutcome: "restrict", expectedReason: "DOCK_FAULTED" },
  { label: "smartdock-offline-stepup", identityRef: "nurse.dock_offline", deviceRef: "ipad-dock-02", workflowKey: "clinical-session", expectedOutcome: "step_up", expectedReason: "DOCK_OFFLINE" },
  { label: "tamper-sensor-unavailable-stepup", identityRef: "nurse.tamper_blind", deviceRef: "ipad-dock-03", workflowKey: "clinical-session", expectedOutcome: "step_up", expectedReason: "TAMPER_SENSOR_UNAVAILABLE" },
];

const decisions: Decision[] = [];
for (const scenario of scenarios) {
  const result = core.evaluate(T.operator, {
    identityRef: scenario.identityRef,
    deviceRef: scenario.deviceRef,
    workflowKey: scenario.workflowKey,
  });
  check(
    `decision ${scenario.label}: outcome ${scenario.expectedOutcome}`,
    result.outcome === scenario.expectedOutcome,
    `got "${result.outcome}"`,
  );
  check(
    `decision ${scenario.label}: reason ${scenario.expectedReason}`,
    result.reasonCodes.includes(scenario.expectedReason),
    `got [${result.reasonCodes.join(", ")}]`,
  );
  decisions.push(core.getDecision(T.operator, result.decisionId));
}

// ── 1b. Provenance stamping: the migration, proven rather than promised ───────
//
// `coreNormalizationVersion` records WHICH BUILD of the core decision path derived a
// snapshot's facts (intake ledger row 27). Adding a field to a tamper-evident record
// is the dangerous part: durable Postgres rows written before the field existed must
// keep verifying, or the operator console renders them as "tampered" — and it has no
// third state to render instead.
//
// The mechanism is a CONDITIONAL spread in the shared digest body: an unstamped
// snapshot's canonical JSON is byte-identical to the pre-stamp one, so no
// version-conditional branch and no precondition exists anywhere. These four checks
// are what make that a fact rather than a claim.
// Re-pinned 2026-08-23 (was b8d6988973734339): the evidence body gained
// `dockEvidenceFreshness`, so the canonical body of a FRESH unstamped snapshot
// moved again. Same reasoning as the 2026-08-10 re-pin below, and the same
// evidence for it: the digest FUNCTION is unchanged and every durable row is
// verified against its OWN stored body, so real pre-change rows in Postgres
// still verify. This constant is the canary, and it fired exactly as designed —
// it caught the shape change on the first run rather than letting it ship
// quietly. CORE_NORMALIZATION_VERSION goes 5 -> 6 to record the same change as
// provenance.
// Re-pinned 2026-08-10 (was 28d821302756a247): the evidence body gained the two
// launch-family fields (managementHealthState, localAuthorityState), so the canonical
// body of a FRESH unstamped snapshot moved. TRUE pre-change rows still verify — the
// digest FUNCTION is unchanged and each row is verified against its own stored body —
// this constant is the canary that makes an evidence-shape change loud instead of
// silent, and the normalization-version bump records the same change as provenance.
// Re-pinned 2026-08-25 (was 6ab07be9ec3cdddc): signal ids now carry the minting
// CONNECTOR's id, so `signalsUsed` — which is inside the digest body — moved, and
// with it the canonical body of a FRESH unstamped snapshot. The reason for the id
// change is a reproduced fail-open: without the connector in the key, two connectors
// reporting the same category for one device minted the SAME id, `putSignal`
// overwrote in place with no freshness comparison, and a reading observed 55 minutes
// EARLIER erased a confirmed tamper — flipping the outcome from deny to allow.
// SAME REASONING AS THE TWO RE-PINS BELOW, and it is the reason this is a re-pin
// rather than a defect: the digest FUNCTION is untouched, and every durable row is
// verified against ITS OWN stored body, so real pre-change rows in Postgres still
// verify true. This constant is the canary for a body-shape change, and it fired
// exactly as designed — it caught this on the first run instead of letting it ship
// quietly. CORE_NORMALIZATION_VERSION goes 8 -> 9 to record the same change as
// provenance.
// 2026-09-01 (F1): seed.ts gave the demo's first decision two launch signals, so the pinned
// sample body moved; the digest function is unchanged. (seed.ts is outside the normalization
// closure; the same change set bumped the version 9 -> 10 for store.ts, which is inside it.)
// Was 9347fb8f9ad49d31.
const LEGACY_SNAPSHOT_DIGEST = "621410dc07677bb2";
const freshSnapshot = core.getSnapshot(T.operator, decisions[0].evidenceSnapshotId);

// The exact shape a pre-stamp row deserializes into: every field the same, no stamp.
const { coreNormalizationVersion: _omitted, ...legacyFields } = freshSnapshot;
const legacySnapshot = { ...legacyFields, digest: LEGACY_SNAPSHOT_DIGEST };

check(
  `MIGRATION: an UNSTAMPED snapshot still digests to the pinned legacy value (${LEGACY_SNAPSHOT_DIGEST}) and verifies — durable rows written before provenance existed are not accused of tampering`,
  verifySnapshot(legacySnapshot) === true,
  "the legacy body moved: every pre-stamp snapshot in Postgres would now read as tampered",
);
check(
  "the stamp is INSIDE the tamper-evidence: deleting it from a stamped snapshot fails verification",
  verifySnapshot({ ...legacyFields, digest: freshSnapshot.digest }) === false,
);
check(
  "a stamp cannot be FORGED onto a legacy row: adding it fails verification",
  verifySnapshot({
    ...legacyFields,
    coreNormalizationVersion: CORE_NORMALIZATION_VERSION,
    digest: LEGACY_SNAPSHOT_DIGEST,
  }) === false,
);
check(
  `all three carriers report the version that was actually digested (v${CORE_NORMALIZATION_VERSION})`,
  freshSnapshot.coreNormalizationVersion === CORE_NORMALIZATION_VERSION &&
    decisions[0].coreNormalizationVersion === CORE_NORMALIZATION_VERSION,
  `snapshot=${freshSnapshot.coreNormalizationVersion} decision=${decisions[0].coreNormalizationVersion} constant=${CORE_NORMALIZATION_VERSION}`,
);

// ── 2. Fail-closed invariant across every decision ────────────────────────────

for (const decision of decisions) {
  const snapshot = core.getSnapshot(T.operator, decision.evidenceSnapshotId);
  if (decision.outcome === "allow") {
    check(
      `fail-closed: allow "${decision.id.slice(0, 12)}" only on intact critical evidence`,
      snapshot.evidence.criticalSignalsPresent === true,
      "allowed despite degraded critical evidence",
    );
  }
}
check(
  "fail-closed: no allow on any degraded-evidence decision",
  decisions.every(
    (d) =>
      d.outcome !== "allow" ||
      core.getSnapshot(T.operator, d.evidenceSnapshotId).evidence
        .criticalSignalsPresent,
  ),
  undefined,
);

// ── 3. Tenant isolation ───────────────────────────────────────────────────────

// White-box store-level isolation check. Built on a freshly-seeded store (not a
// caller-supplied-tenant probe on the shipped facade, which no longer exists):
// `findDeviceByRef` is tenant-scoped, so an atlas device ref is invisible under
// the northwind tenant and vice-versa.
const isoStore = seedDemoStore(fixedClock("2026-07-13T15:00:00.000Z")).store;
check(
  "isolation: atlas device invisible under northwind tenant",
  isoStore.findDeviceByRef("tenant_northwind", "handheld-01") === undefined,
);
check(
  "isolation: northwind device invisible under atlas tenant",
  isoStore.findDeviceByRef("tenant_atlas", "ipad-ward-01") === undefined,
);

const northwindDecisionId = decisions[0].id;
expectError(
  "isolation: atlas key cannot read a northwind decision",
  "not_found",
  () => core.getDecision(T.atlasOwner, northwindDecisionId),
);
expectError(
  "isolation: northwind key cannot evaluate an atlas identity",
  "not_found",
  () =>
    core.evaluate(T.operator, {
      identityRef: "picker.compliant",
      deviceRef: "handheld-01",
      workflowKey: "clinical-session",
    }),
);

// Atlas owner evaluating its own subject succeeds — isolation is not a total block.
const atlasResult = core.evaluate(T.atlasOwner, {
  identityRef: "picker.compliant",
  deviceRef: "handheld-01",
  workflowKey: "pick-pack",
});
check(
  "isolation: atlas key CAN evaluate its own subject",
  atlasResult.outcome === "allow",
  `got "${atlasResult.outcome}"`,
);
check(
  "isolation: atlas audit chain does not contain northwind decisions",
  core.listAudit(T.atlasOwner).every((e) => !e.references.includes(northwindDecisionId)),
);

// ── 4. RBAC ───────────────────────────────────────────────────────────────────

expectError("rbac: auditor cannot evaluate decisions", "forbidden", () =>
  core.evaluate(T.auditor, {
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    workflowKey: "clinical-session",
  }),
);
expectError("rbac: operator cannot read the audit ledger", "forbidden", () =>
  core.listAudit(T.operator),
);

// ── authorizedContext: the durable-path bypass this exists to prevent ──────────
// Three GA read routes take `context(token).tenant.id`, query Postgres directly and
// RETURN — never reaching listDecisions/getDecision/getSnapshot, which are what
// actually authorize "decision:read". So the permission held in memory and vanished
// the moment DATABASE_URL was set: dev stricter than prod.
//
// It was invisible to the API suite for a specific reason worth pinning: seedApiKeys
// types its role as "owner" | "operator" | "auditor" (seed.ts:969), and all three
// HAVE decision:read — so no token the demo build can mint could reach it. A real
// deployment mints principals through registerVerifiedPrincipal, which accepts the
// full Role union including `connector`. These assertions therefore mint that
// principal explicitly rather than relying on the demo seed.
{
  const connectorToken = "sgk_proof_connector_rbac";
  core.registerVerifiedPrincipal(connectorToken, {
    tenantId: core.context(T.owner).tenant.id,
    role: "connector",
    subjectId: "svc_proof_connector",
    principalType: "service",
    keyReference: "proof:connector",
  });
  check(
    "authorizedContext: a connector principal is authenticated (the token is valid)",
    core.context(connectorToken).principal.role === "connector",
  );
  expectError(
    "authorizedContext: ...but connector CANNOT obtain a read context — the durable path is gated",
    "forbidden",
    () => core.authorizedContext(connectorToken, "decision:read"),
  );
  check(
    "authorizedContext: a role that HAS the permission still gets its context",
    core.authorizedContext(T.owner, "decision:read").principal.role === "owner",
  );
  expectError(
    "authorizedContext: connector is refused decision:read via the core method too (not a route-only guard)",
    "forbidden",
    () => core.listDecisions(connectorToken),
  );
}
check(
  "rbac: auditor CAN read the audit ledger",
  core.listAudit(T.auditor).length > 0,
);
check(
  "rbac: owner can read policies",
  core.listPolicies(T.owner).length > 0,
);

// ── 5. Authentication fails closed ────────────────────────────────────────────

expectError("auth: unknown token is rejected", "unauthorized", () =>
  core.evaluate("sgk_not_a_real_key", {
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    workflowKey: "clinical-session",
  }),
);
expectError("auth: empty token is rejected", "unauthorized", () =>
  core.context(""),
);

// ── 6. Tamper-evidence (fresh core so earlier assertions stay clean) ──────────

const tamperCore = SignalGridCore.demo();
const tamperResult = tamperCore.evaluate(T.operator, {
  identityRef: "nurse.compliant",
  deviceRef: "ipad-ward-01",
  workflowKey: "clinical-session",
});
check(
  "evidence: snapshot verifies before tampering",
  tamperCore.verifyEvidence(T.operator, tamperResult.evidenceSnapshotId) === true,
);
const tamperedSnapshot = tamperCore.getSnapshot(
  T.operator,
  tamperResult.evidenceSnapshotId,
);
tamperedSnapshot.evidence.deviceCompliance = "non_compliant"; // mutate in place
check(
  "evidence: snapshot fails verification after tampering",
  tamperCore.verifyEvidence(T.operator, tamperResult.evidenceSnapshotId) === false,
);

const auditCore = SignalGridCore.demo();
auditCore.evaluate(T.operator, {
  identityRef: "nurse.compliant",
  deviceRef: "ipad-ward-01",
  workflowKey: "clinical-session",
});
check(
  "audit: chain is valid before tampering",
  auditCore.verifyAudit(T.owner).valid === true,
);
const auditEvents = auditCore.listAudit(T.owner);
auditEvents[1].summary = "TAMPERED SUMMARY"; // mutate a stored event in place
const tamperedChain = auditCore.verifyAudit(T.owner);
check(
  "audit: chain detects tampering",
  tamperedChain.valid === false && tamperedChain.brokenAtSeq !== null,
  `brokenAtSeq=${tamperedChain.brokenAtSeq}`,
);

// ── 7. Determinism ────────────────────────────────────────────────────────────

const coreA = SignalGridCore.demo();
const coreB = SignalGridCore.demo();
const req = {
  identityRef: "nurse.compliant",
  deviceRef: "ipad-ward-01",
  workflowKey: "clinical-session",
};
const a = coreA.evaluate(T.operator, req);
const b = coreB.evaluate(T.operator, req);
check(
  "determinism: identical decision id across fresh cores",
  a.decisionId === b.decisionId,
  `${a.decisionId} vs ${b.decisionId}`,
);
check(
  "determinism: identical evidence snapshot id across fresh cores",
  a.evidenceSnapshotId === b.evidenceSnapshotId,
);

// ── 8. Policy tests, simulation, lifecycle, metrics ───────────────────────────

const policyId = decisions[0].policyId;

// Policy test fixtures pass against the active version.
const testResults = core.runPolicyTests(T.owner, policyId);
check(
  "policy tests: all fixtures pass on the active version",
  testResults.length > 0 && testResults.every((r) => r.passed),
  `${testResults.filter((r) => r.passed).length}/${testResults.length}`,
);

// Simulate the stale-posture decision against the stricter v2 draft.
const v2 = core
  .listPolicyVersions(T.owner, policyId)
  .find((v) => v.version === 2);
check("simulate: v2 draft exists", Boolean(v2));
if (v2) {
  const staleDecision = decisions.find((d) => d.reasonCodes.includes("POSTURE_STALE"));
  check("simulate: stale decision found", Boolean(staleDecision));
  if (staleDecision) {
    const sim = core.simulateDecision(T.operator, staleDecision.id, v2.id);
    check(
      "simulate: stale decision escalates step_up → restrict under v2",
      sim.simulatedOutcome === "restrict" && sim.changed,
      `${sim.storedOutcome} → ${sim.simulatedOutcome}`,
    );
    // Simulation must not mutate the stored decision.
    check(
      "simulate: stored decision is unchanged after simulation",
      core.getDecision(T.operator, staleDecision.id).outcome === "step_up",
    );

    // ── THE IDENTITY ROUND TRIP — replay against a decision's OWN version ──
    //
    // Everything this product says about being "explainable and replayable" rests on
    // one property: the same immutable evidence, run against the same policy version,
    // reproduces the same outcome. Until now NOTHING asserted it. The proofs covered
    // cross-core determinism and CROSS-VERSION change (v1 → v2 above), which is a
    // different claim entirely — a simulator that always returned `changed: true`
    // would satisfy every one of them.
    //
    // Found by an adversarial review of a proposed customer-facing replay artifact:
    // a repo-wide grep for `changed === false` and `storedOutcome ===` returned
    // nothing. That made the central sales claim the one thing with no test behind it.
    const identity = core.simulateDecision(T.operator, staleDecision.id, staleDecision.policyVersionId);
    check(
      "simulate: replaying a decision against its OWN policy version reproduces it exactly",
      identity.simulatedOutcome === identity.storedOutcome && identity.changed === false,
      `${identity.storedOutcome} → ${identity.simulatedOutcome}, changed=${identity.changed}`,
    );
    check(
      "…and reproduces its reason codes, not merely its outcome — the explanation replays too",
      JSON.stringify([...identity.simulatedReasonCodes].sort()) ===
        JSON.stringify([...staleDecision.reasonCodes].sort()),
      `${identity.simulatedReasonCodes.join(",")} vs ${staleDecision.reasonCodes.join(",")}`,
    );
    // NON-VACUITY: the v2 case above already shows `changed: true` is reachable, so
    // this pair cannot be satisfied by a simulator hardwired to report no change.
    check(
      "NON-VACUITY: `changed` is genuinely bidirectional across the two replays",
      identity.changed === false && sim.changed === true,
    );
  }
}

// Policy lifecycle on a fresh core: draft → activate, with RBAC enforced.
const lifecycleCore = SignalGridCore.demo();
expectError("lifecycle: operator cannot author a draft", "forbidden", () =>
  lifecycleCore.createPolicyDraft(T.operator, policyId, SHARED_DEVICE_RULES_V2),
);
const draft = lifecycleCore.createPolicyDraft(
  T.owner,
  policyId,
  SHARED_DEVICE_RULES_V2,
);
check("lifecycle: owner creates a draft version", draft.status === "draft");
const activated = lifecycleCore.activatePolicyVersion(T.owner, policyId, draft.id);
check(
  "lifecycle: activation switches the active version",
  activated.activeVersionId === draft.id,
);
// After activating the stricter policy, a stale-posture evaluation now restricts.
const afterActivation = lifecycleCore.evaluate(T.operator, {
  identityRef: "nurse.stale",
  deviceRef: "ipad-ward-03",
  workflowKey: "clinical-session",
});
check(
  "lifecycle: stale posture restricts under the newly-activated v2",
  afterActivation.outcome === "restrict",
  `got "${afterActivation.outcome}"`,
);

// Metrics + pilot gates over the main core's decisions.
const metrics = core.metrics(T.operator);
check(
  "metrics: total equals decisions evaluated",
  metrics.totalDecisions === decisions.length,
  `${metrics.totalDecisions} vs ${decisions.length}`,
);
check(
  "metrics: outcome buckets sum to total",
  metrics.byOutcome.allow +
    metrics.byOutcome.step_up +
    metrics.byOutcome.restrict +
    metrics.byOutcome.deny ===
    metrics.totalDecisions,
);
check(
  "pilot gate: 100% of decisions carry a policy version",
  metrics.decisionsWithPolicyVersion === metrics.totalDecisions,
);
check(
  "pilot gate: 100% of decisions carry an evidence snapshot",
  metrics.decisionsWithEvidence === metrics.totalDecisions,
);
check(
  "pilot gate: p95 decision latency is well under 750ms",
  metrics.p95LatencyMs < 750,
  `p95=${metrics.p95LatencyMs}ms`,
);

// ── 9. Webhook delivery (simulated, with retry/backoff) ───────────────────────

const deliveries = core.listWebhookDeliveries(T.owner);
check(
  "webhooks: every evaluated decision fanned out to both endpoints",
  deliveries.length === decisions.length * 2,
  `${deliveries.length} deliveries for ${decisions.length} decisions`,
);
check(
  "webhooks: reliable endpoint delivered on the first attempt",
  deliveries
    .filter((d) => d.endpointId.endsWith("_siem"))
    .every((d) => d.status === "delivered" && d.attempts.length === 1),
);
const flaky = deliveries.filter((d) => d.endpointId.endsWith("_itsm"));
check(
  "webhooks: flaky endpoint delivered after retries with backoff",
  flaky.length > 0 &&
    flaky.every(
      (d) =>
        d.status === "delivered" &&
        d.attempts.length === 3 &&
        d.attempts[0].status === "error" &&
        d.attempts[0].backoffSeconds === 1 &&
        d.attempts[2].status === "ok",
    ),
);
check(
  "webhooks: deliveries are tenant-scoped",
  core
    .listWebhookDeliveries(T.atlasOwner)
    .every((d) => d.tenantId === "tenant_atlas"),
);
expectError(
  "webhooks: unknown token cannot read deliveries",
  "unauthorized",
  () => core.listWebhookDeliveries("sgk_not_real"),
);

// ── 10. Remediation (approval-gated, simulated-only) ──────────────────────────

const remediations = core.listRemediations(T.operator);
check(
  "remediation: non-allow decisions generated remediation requests",
  remediations.length > 0,
  `${remediations.length} requests`,
);
check(
  "remediation: allow decisions generate none",
  remediations.every((r) => {
    const d = decisions.find((dec) => dec.id === r.decisionId);
    return d ? d.outcome !== "allow" : true;
  }),
);
check(
  "remediation: every request is approval-required and simulated-only",
  remediations.every((r) => r.approvalRequired === true && r.simulatedOnly === true),
);
check(
  "remediation: no request is auto-approved or executed",
  remediations.every((r) => r.status === "requires_approval"),
);
// Physical/custody/baseline reason codes now generate remediation too (the
// mapping keeps pace with the newer decision dimensions — no silent gap).
check(
  "remediation: a faulted-dock decision proposes a custody check",
  remediations.some((r) => r.reasonCode === "DOCK_FAULTED" && r.kind === "request_custody_check"),
);
check(
  "remediation: a forced-badge decision routes to security",
  remediations.some((r) => r.reasonCode === "BADGE_FORCED_REMOVAL" && r.kind === "notify_security"),
);
check(
  "remediation: a baseline-drift decision proposes a baseline re-apply",
  remediations.some((r) => r.reasonCode === "BASELINE_DRIFTED" && r.kind === "request_baseline_reapply"),
);
// Operators cannot approve; owners can, and approval is simulated (no execution).
const pending = remediations[0];
check("remediation: a pending request exists", Boolean(pending));
if (pending) {
  expectError("remediation: operator cannot approve", "forbidden", () =>
    core.approveRemediation(T.operator, pending.id),
  );
  const approved = core.approveRemediation(T.owner, pending.id);
  check(
    "remediation: owner approval marks it approved_simulated (never executed)",
    approved.status === "approved_simulated" && approved.approvedAt !== null,
  );
  // Isolation: atlas owner cannot see or approve a northwind remediation.
  expectError("remediation: cross-tenant approval denied", "not_found", () =>
    core.approveRemediation(T.atlasOwner, pending.id),
  );
}

// ── 11. Fail-closed on missing encryption evidence (regression) ───────────────

{
  const identity: Identity = {
    id: "id_enc",
    tenantId: "tenant_northwind",
    externalRef: "nurse.enc",
    displayName: "Nurse",
    state: "enabled",
    assignedRole: "nurse",
  };
  const device: Device = {
    id: "dev_enc",
    tenantId: "tenant_northwind",
    externalRef: "ipad-enc",
    name: "Ward iPad",
    osPlatform: "iPadOS",
    osVersion: "18.5",
    ownerType: "shared",
    managementAgent: "intune",
  };
  const workflow: Workflow = {
    id: "wf_enc",
    tenantId: "tenant_northwind",
    key: "clinical-session",
    name: "Clinical session",
    riskTier: "elevated",
  };
  const sig = (
    category: SignalCategory,
    value: NormalizedSignal["value"],
  ): NormalizedSignal => ({
    id: `sig_${category}`,
    tenantId: "tenant_northwind",
    connectorId: "conn",
    subjectType: "device",
    subjectId: device.id,
    category,
    value,
    observedAt: "2026-07-13T13:00:00.000Z",
    freshness: "fresh",
    sourceReference: "fixture:test",
  });
  // Healthy in every dimension EXCEPT there is no device_encryption signal.
  const signals = [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
  ];
  const ev = buildEvidence(identity, device, workflow, signals);
  check(
    "encryption: missing encryption evidence marks critical evidence degraded",
    ev.deviceEncrypted === "unknown" && ev.criticalSignalsPresent === false,
  );
  const activeV1 = core
    .listPolicyVersions(T.owner, policyId)
    .find((v) => v.version === 1);
  check("encryption: v1 policy version resolved", Boolean(activeV1));
  if (activeV1) {
    check(
      "encryption: elevated workflow with unknown encryption does not allow",
      evaluatePolicy(activeV1, ev).outcome !== "allow",
    );
  }
}

// ── 11b. Benchmark-selection arm: honest default, misfit rule, strict widening ──
//
// The /v1 arm of the benchmark-selection dimension. Three properties, each of
// which a negative control showed is NOT implied by the others:
//  - an ABSENT benchmark_selection signal derives "unverified", never "confirmed"
//    (the default was unfalsifiable until this block existed — flipping it to
//    "confirmed" changed no seeded outcome, because every seeded evidence record
//    was a LITERAL that never went through buildEvidence);
//  - the ACTIVE v1 rule matches ONLY the affirmative bad state, so the absent
//    default stays allow — a fleet that does not yet emit the signal is not
//    stepped up on day one;
//  - the v2 STRICT draft widens to "unverified", which makes the default itself
//    policy-observable: with the default flipped, this replay stops stepping up.
{
  const identity: Identity = {
    id: "id_bs",
    tenantId: "tenant_northwind",
    externalRef: "nurse.bs",
    displayName: "Nurse",
    state: "enabled",
    assignedRole: "nurse",
  };
  const device: Device = {
    id: "dev_bs",
    tenantId: "tenant_northwind",
    externalRef: "ipad-bs",
    name: "Ward iPad",
    osPlatform: "iPadOS",
    osVersion: "18.5",
    ownerType: "shared",
    managementAgent: "intune",
  };
  const workflow: Workflow = {
    id: "wf_bs",
    tenantId: "tenant_northwind",
    key: "clinical-session",
    name: "Clinical session",
    riskTier: "elevated",
  };
  const sig = (
    category: SignalCategory,
    value: NormalizedSignal["value"],
  ): NormalizedSignal => ({
    id: `sig_bs_${category}`,
    tenantId: "tenant_northwind",
    connectorId: "conn",
    subjectType: "device",
    subjectId: device.id,
    category,
    value,
    observedAt: "2026-07-13T13:00:00.000Z",
    freshness: "fresh",
    sourceReference: "fixture:test",
  });
  const healthy = [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("device_encryption", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
  ];
  const version = (n: number, rules: typeof SHARED_DEVICE_RULES_V2) => ({
    id: `pv_bs_${n}`,
    tenantId: "tenant_northwind",
    policyId: "pol_bs",
    version: n,
    status: "active" as const,
    rules,
    createdAt: "2026-07-13T13:00:00.000Z",
    digest: "test",
  });
  const v1 = version(1, SHARED_DEVICE_RULES_V1);
  const v2 = version(2, SHARED_DEVICE_RULES_V2);

  const absent = buildEvidence(identity, device, workflow, healthy);
  check(
    "benchmark-selection: an ABSENT signal derives 'unverified' — silence is not a confirmation",
    absent.benchmarkSelection === "unverified",
  );
  const junk = buildEvidence(identity, device, workflow, [...healthy, sig("benchmark_selection", "totally-fine")]);
  check(
    "benchmark-selection: an unrecognized signal value also derives 'unverified', never a guess",
    junk.benchmarkSelection === "unverified",
  );
  const misfit = buildEvidence(identity, device, workflow, [...healthy, sig("benchmark_selection", "misfit")]);
  check("benchmark-selection: a 'misfit' signal is read through", misfit.benchmarkSelection === "misfit");
  check(
    "benchmark-selection: v1 steps up on MISFIT with its own reason code — an 'aligned' answer from the wrong test is not assurance",
    evaluatePolicy(v1, misfit).outcome === "step_up" &&
      evaluatePolicy(v1, misfit).matchedRules.some((r) => r.reasonCode === "BENCHMARK_SELECTION_MISFIT"),
  );
  check(
    "benchmark-selection: v1 does NOT step up on the absent default — the active rule matches only the affirmative bad state, so day one is quiet",
    evaluatePolicy(v1, absent).outcome === "allow",
  );
  check(
    "benchmark-selection: the v2 STRICT draft widens to 'unverified' — the same absent evidence diverges to step_up only for a tenant that opted in",
    evaluatePolicy(v2, absent).outcome === "step_up" &&
      evaluatePolicy(v2, absent).matchedRules.some((r) => r.reasonCode === "BENCHMARK_SELECTION_UNESTABLISHED_STRICT"),
  );
  check(
    "benchmark-selection: the arm never lowers — 'confirmed' grants nothing a healthy device lacked, and a non-compliant device restricts alongside it",
    evaluatePolicy(v1, { ...misfit, benchmarkSelection: "confirmed" }).outcome === "allow" &&
      evaluatePolicy(v1, { ...misfit, benchmarkSelection: "confirmed", deviceCompliance: "non_compliant" }).outcome === "restrict",
  );

  // The /v1 arm of the shift-context dimension — same three properties, same
  // buildEvidence-not-literals discipline (the derivation is what the negative
  // control on the benchmark arm proved literals cannot falsify).
  const shiftAbsent = buildEvidence(identity, device, workflow, healthy);
  check(
    "shift-context: an ABSENT signal derives 'unverified' — silence is not a confirmation of labor context",
    shiftAbsent.shiftContext === "unverified",
  );
  const shiftJunk = buildEvidence(identity, device, workflow, [...healthy, sig("shift_context", "probably-working")]);
  check(
    "shift-context: an unrecognized signal value also derives 'unverified', never a guess",
    shiftJunk.shiftContext === "unverified",
  );
  const shiftMisfit = buildEvidence(identity, device, workflow, [...healthy, sig("shift_context", "misfit")]);
  check("shift-context: a 'misfit' signal is read through", shiftMisfit.shiftContext === "misfit");
  check(
    "shift-context: v1 steps up on MISFIT with its own reason code — off the clock, off duty, or the wrong site is not the right decision context",
    evaluatePolicy(v1, shiftMisfit).outcome === "step_up" &&
      evaluatePolicy(v1, shiftMisfit).matchedRules.some((r) => r.reasonCode === "SHIFT_CONTEXT_MISFIT"),
  );
  check(
    "shift-context: v1 does NOT step up on the absent default — day one is quiet until a WFM connector emits the signal",
    evaluatePolicy(v1, shiftAbsent).outcome === "allow",
  );
  check(
    "shift-context: the v2 STRICT draft widens to 'unverified' — the same absent evidence diverges to step_up only for a tenant that opted in",
    evaluatePolicy(v2, shiftAbsent).outcome === "step_up" &&
      evaluatePolicy(v2, shiftAbsent).matchedRules.some((r) => r.reasonCode === "SHIFT_CONTEXT_UNESTABLISHED_STRICT"),
  );
  check(
    "shift-context: the arm never lowers — 'confirmed' grants nothing a healthy device lacked, and a non-compliant device restricts alongside it",
    evaluatePolicy(v1, { ...shiftMisfit, shiftContext: "confirmed" }).outcome === "allow" &&
      evaluatePolicy(v1, { ...shiftMisfit, shiftContext: "confirmed", deviceCompliance: "non_compliant" }).outcome === "restrict",
  );
}

// ── 12. Repeated evaluation does not overwrite (unique ids) ────────────────────

{
  const dupCore = SignalGridCore.demo();
  const dupReq = {
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    workflowKey: "clinical-session",
  };
  const first = dupCore.evaluate(T.operator, dupReq);
  const second = dupCore.evaluate(T.operator, dupReq);
  check(
    "repeat: evaluating the same scenario twice yields distinct decision ids",
    first.decisionId !== second.decisionId,
  );
  check(
    "repeat: both decisions are retained (no overwrite)",
    dupCore.listDecisions(T.operator).length === 2,
  );
  // Cross-core determinism still holds: each fresh core's FIRST decision agrees.
  const freshA = SignalGridCore.demo().evaluate(T.operator, dupReq);
  const freshB = SignalGridCore.demo().evaluate(T.operator, dupReq);
  check(
    "repeat: first decision id is still deterministic across fresh cores",
    freshA.decisionId === freshB.decisionId,
  );
}

// ── 13. Resolution Assistant (deterministic, approval-gated, simulated) ───────

{
  const staleDec = decisions.find((d) => d.reasonCodes.includes("POSTURE_STALE"));
  check("resolution: stale decision found", Boolean(staleDec));
  if (staleDec) {
    const plan = core.getResolution(T.operator, staleDec.id);
    check(
      "resolution: stale posture is self-service",
      plan.path === "self_service" && plan.autoResolvable === true,
    );
    check(
      "resolution: stale has an auto-proposed device step",
      plan.steps.some(
        (s) => s.resolutionClass === "auto_proposed" && s.channel === "device_prompt",
      ),
    );
    const sim = core.simulateResolution(T.operator, staleDec.id);
    check(
      "resolution: simulated posture refresh resolves stale to allow",
      sim.resolved === true && sim.projectedOutcome === "allow",
    );
  }

  // PREMISE FIRST — the house style in this file, applied consistently 2026-09-06.
  // Six `const x = decisions.find(...); if (x) { …assertions… }` blocks had no premise
  // check (this one, IDENTITY_DISABLED, TAMPER_SUSPECTED, BATTERY_CRITICAL, and
  // TRUST_ESTABLISHED twice), so roughly ten assertions would have vanished WITHOUT A
  // TRACE the day the subject decision stopped being produced — surfacing, if at all,
  // as a docs↔proof figure mismatch in a different gate. Every neighbouring block
  // already guarded its premise; this was an inconsistency inside one file, not a style.
  const ncDec = decisions.find((d) => d.reasonCodes.includes("DEVICE_NONCOMPLIANT"));
  check("resolution: non-compliant decision found", Boolean(ncDec));
  if (ncDec) {
    const plan = core.getResolution(T.operator, ncDec.id);
    check(
      "resolution: non-compliant is assisted (approval-gated)",
      plan.path === "assisted" && plan.autoResolvable === true,
    );
    check(
      "resolution: non-compliant routes device remediation to ITSM",
      plan.steps.some(
        (s) => s.resolutionClass === "requires_approval" && s.channel === "itsm_ticket",
      ),
    );
    const sim = core.simulateResolution(T.operator, ncDec.id);
    check("resolution: approved compliance fix resolves non-compliant", sim.resolved === true);
  }

  const disDec = decisions.find((d) => d.reasonCodes.includes("IDENTITY_DISABLED"));
  check("resolution: disabled-identity decision found", Boolean(disDec));
  if (disDec) {
    const plan = core.getResolution(T.operator, disDec.id);
    check(
      "resolution: disabled identity escalates (manual only)",
      plan.path === "escalation" && plan.autoResolvable === false,
    );
    const sim = core.simulateResolution(T.operator, disDec.id);
    check(
      "resolution: disabled identity cannot self-resolve",
      sim.resolved === false && sim.projectedOutcome !== "allow",
    );

    expectError("resolution: cross-tenant plan is denied", "not_found", () =>
      core.getResolution(T.atlasOwner, disDec.id),
    );
  }

  expectError("resolution: unknown token is rejected", "unauthorized", () =>
    core.getResolution("sgk_not_real", decisions[0].id),
  );
}

// ── 14. DockBridge custody (hardware signals in the decision) ─────────────────

{
  // The DockBridge connector is present and ingests via an embedded dock app.
  const connectors = core.listConnectors(T.owner);
  const dock = connectors.find(
    (c) => c.kind === "dockbridge-custody" && c.ingestionMode === "app_in_dock",
  );
  check("dockbridge: custody connector is registered", Boolean(dock));
  check(
    "dockbridge: connector documents its (fixture) ingestion mode",
    dock?.ingestionMode === "app_in_dock",
  );

  const overdue = decisions.find((d) => d.reasonCodes.includes("CUSTODY_OVERDUE"));
  check("dockbridge: overdue-custody decision exists", Boolean(overdue));
  if (overdue) {
    const snapshot = core.getSnapshot(T.operator, overdue.evidenceSnapshotId);
    check(
      "dockbridge: custody state is captured in the evidence snapshot",
      snapshot.evidence.custodyState === "overdue",
    );
    const plan = core.getResolution(T.operator, overdue.id);
    check(
      "dockbridge: overdue return is self-service to the org hardware channel",
      plan.path === "self_service" &&
        plan.steps.some(
          (s) => s.reasonCode === "CUSTODY_OVERDUE" && s.channel === "credential_reader",
        ),
    );
    const sim = core.simulateResolution(T.operator, overdue.id);
    check(
      "dockbridge: returning/checking in the device resolves to allow",
      sim.resolved === true && sim.projectedOutcome === "allow",
    );
  }

  const tamper = decisions.find((d) => d.reasonCodes.includes("TAMPER_SUSPECTED"));
  check("dockbridge: suspected-tamper decision found", Boolean(tamper));
  if (tamper) {
    const plan = core.getResolution(T.operator, tamper.id);
    check(
      "dockbridge: suspected tamper needs operator approval",
      plan.path === "assisted",
    );
  }

  const battery = decisions.find((d) => d.reasonCodes.includes("BATTERY_CRITICAL"));
  check("dockbridge: battery-critical decision found", Boolean(battery));
  if (battery) {
    const sim = core.simulateResolution(T.operator, battery.id);
    check(
      "dockbridge: swapping to a charged device resolves the battery block",
      sim.resolved === true,
    );
  }

  // ── Battery HEALTH is not battery CHARGE ───────────────────────────────────
  //
  // The whole reason `batteryHealth` exists is that charging clears a low
  // battery and does NOT clear a failing one. If these two ever collapsed into
  // the same treatment, a worker would be routed to a charging bay forever for
  // a device that needs a new battery. Four checks, each of which fails if the
  // distinction is lost in a different way.
  // The ANTI-FABRICATION property, asserted rather than merely commented.
  //
  // `dock.ts` only emits `battery_health` when the record carries one, so a dock
  // that cannot measure health leaves evidence at "unknown". An adversarial
  // review proved this was unfalsifiable: replacing that conditional with an
  // unconditional `record.batteryHealth ?? "healthy"` flipped every dock-synced
  // device to a fabricated "healthy" and the proof stayed green. A signal source
  // inventing a healthy reading on behalf of hardware that never reported one is
  // the whole failure mode this repo exists to prevent, so it is now checked on
  // both sides: no signal emitted, AND evidence left unknown.
  const benign = decisions.find(
    (d) => d.outcome === "allow" && d.reasonCodes.includes("TRUST_ESTABLISHED"),
  );
  check("battery-health: an allow decision exists to check for fabrication", Boolean(benign));
  if (benign) {
    const snap = core.getSnapshot(T.operator, benign.evidenceSnapshotId);
    check(
      "battery-health: a dock that reports no health read leaves evidence unknown, not healthy",
      snap.evidence.batteryHealth === "unknown",
    );
  }
  // Across EVERY decision in the tenant, exactly one device may carry a non-unknown
  // battery health — the single fixture whose dock actually reports it. If the
  // connector ever fabricates a default, this count jumps to the whole fleet.
  const healthValues = decisions.map(
    (d) => core.getSnapshot(T.operator, d.evidenceSnapshotId).evidence.batteryHealth,
  );
  const reported = healthValues.filter((v) => v !== "unknown");
  // Two fixtures supply a health read, and both supply "failing". Every other
  // device must stay "unknown". Fabricating a default would show up here twice
  // over: the count would jump to the fleet, and "healthy" would appear as a
  // value no fixture ever provided.
  check(
    "battery-health: only the two devices whose dock reports health have one, and it is theirs",
    reported.length === 2 && reported.every((v) => v === "failing"),
    `found ${reported.length} reported of ${healthValues.length} decisions: ${reported.join(", ")}`,
  );

  const failing = decisions.find((d) => d.reasonCodes.includes("BATTERY_FAILING"));
  check("battery-health: a failing-battery decision exists", Boolean(failing));
  if (failing) {
    const snapshot = core.getSnapshot(T.operator, failing.evidenceSnapshotId);
    // NEGATIVE CONTROL. The fixture is fully CHARGED. If `batteryHealth` were a
    // proxy for charge, this decision could not exist at all.
    check(
      "battery-health: the failing device reads fully charged, so charge did not cause this",
      snapshot.evidence.dockChargeState === "charged",
    );
    check(
      "battery-health: the failing state is captured in the evidence snapshot",
      snapshot.evidence.batteryHealth === "failing",
    );
    const sim = core.simulateResolution(T.operator, failing.id);
    // The contrast with BATTERY_CRITICAL directly above: that one resolves,
    // this one must not, because no step in the plan can change the battery.
    check(
      "battery-health: a failing battery does NOT simulate away (charging cannot fix it)",
      sim.resolved === false && !sim.appliedReasonCodes.includes("BATTERY_FAILING"),
    );
    const plan = core.getResolution(T.operator, failing.id);
    check(
      "battery-health: the plan escalates rather than claiming self-service",
      plan.path === "escalation" && plan.autoResolvable === false,
    );
    // A restrict that asks nobody to do anything leaves the device broken.
    const rem = core
      .listRemediations(T.operator)
      .filter((r) => r.reasonCode === "BATTERY_FAILING");
    check(
      "battery-health: a failing battery routes an approval-gated custody check",
      rem.length > 0 && rem.every((r) => r.kind === "request_custody_check"),
      `got ${rem.length}: ${rem.map((r) => r.kind).join(", ")}`,
    );
  }

  // ── Flat AND worn: the verdict and the guidance must not disagree ───────────
  //
  // Both battery reason codes fire. The outcome was already right, but the
  // worker-facing step still said "swap to a charged device, or dock this one",
  // which is the charge-and-retry loop BATTERY_FAILING exists to end — honest
  // verdict, contradicting advice. `BATTERY_CRITICAL` is now suppressed when
  // `BATTERY_FAILING` is present, in the plan AND in the simulation.
  const flatAndWorn = decisions.find(
    (d) =>
      d.reasonCodes.includes("BATTERY_FAILING") && d.reasonCodes.includes("BATTERY_CRITICAL"),
  );
  check("battery-health: a flat-and-worn device exists (both codes fire)", Boolean(flatAndWorn));
  if (flatAndWorn) {
    const plan = core.getResolution(T.operator, flatAndWorn.id);
    check(
      "battery-health: flat-and-worn drops the charge-and-retry step entirely",
      !plan.steps.some((st) => st.reasonCode === "BATTERY_CRITICAL"),
      `steps: ${plan.steps.map((st) => st.reasonCode).join(", ")}`,
    );
    check(
      "battery-health: flat-and-worn still escalates and still cannot self-resolve",
      plan.path === "escalation" && plan.autoResolvable === false,
    );
    const sim = core.simulateResolution(T.operator, flatAndWorn.id);
    check(
      "battery-health: the simulation applies no step the plan did not propose",
      !sim.appliedReasonCodes.includes("BATTERY_CRITICAL") && sim.resolved === false,
      `applied: ${sim.appliedReasonCodes.join(", ")}`,
    );
  }

  // ── The transform/class invariant, asserted rather than assumed ────────────
  //
  // `simulateResolution` skips any descriptor with a null transform, while
  // `autoResolvable` is computed as "no manual_only step present". So a
  // descriptor that is `requires_approval` or `auto_proposed` AND has no
  // transform would report a plan as auto-resolvable while resolving nothing —
  // a plan that contradicts its own simulation. Every descriptor today honours
  // `transform === null` iff `manual_only`; nothing enforced it until now.
  const violations = RESOLUTION_DESCRIPTOR_SHAPES.filter(
    (d) => d.hasTransform === (d.baseClass === "manual_only"),
  ).map((d) => d.reasonCode);
  check(
    `resolution: transform===null iff manual_only holds for all ${RESOLUTION_DESCRIPTOR_SHAPES.length} descriptors`,
    violations.length === 0,
    violations.join(", "),
  );

  // A confirmed-tamper device is a hard deny that cannot self-resolve.
  const confirmedEvidence = buildEvidence(
    { id: "i", tenantId: "tenant_northwind", externalRef: "r", displayName: "d", state: "enabled", assignedRole: "nurse" },
    { id: "dv", tenantId: "tenant_northwind", externalRef: "d", name: "n", osPlatform: "iPadOS", osVersion: "18", ownerType: "shared", managementAgent: "intune" },
    { id: "w", tenantId: "tenant_northwind", key: "clinical-session", name: "n", riskTier: "elevated" },
    [
      { id: "s1", tenantId: "tenant_northwind", connectorId: "c", subjectType: "device", subjectId: "dv", category: "device_compliance", value: "compliant", observedAt: "2026-07-13T14:30:00.000Z", freshness: "fresh", sourceReference: "fixture" },
      { id: "s2", tenantId: "tenant_northwind", connectorId: "c", subjectType: "device", subjectId: "dv", category: "device_management", value: true, observedAt: "2026-07-13T14:30:00.000Z", freshness: "fresh", sourceReference: "fixture" },
      { id: "s3", tenantId: "tenant_northwind", connectorId: "c", subjectType: "device", subjectId: "dv", category: "os_support", value: true, observedAt: "2026-07-13T14:30:00.000Z", freshness: "fresh", sourceReference: "fixture" },
      { id: "s4", tenantId: "tenant_northwind", connectorId: "c", subjectType: "device", subjectId: "dv", category: "posture_freshness", value: "fresh", observedAt: "2026-07-13T14:30:00.000Z", freshness: "fresh", sourceReference: "fixture" },
      { id: "s5", tenantId: "tenant_northwind", connectorId: "c", subjectType: "device", subjectId: "dv", category: "tamper_state", value: "confirmed", observedAt: "2026-07-13T14:30:00.000Z", freshness: "fresh", sourceReference: "fixture" },
    ],
  );
  const v1 = core.listPolicyVersions(T.owner, policyId).find((v) => v.version === 1);
  check("dockbridge: confirmed tamper denies (v1 present)", Boolean(v1));
  if (v1) {
    check(
      "dockbridge: confirmed tamper is denied",
      evaluatePolicy(v1, confirmedEvidence).outcome === "deny",
    );
  }
}

// ── 15. Security hardening (untrusted input, DoS, invariants) ─────────────────

{
  const validRule = {
    id: "sec-test-rule",
    description: "A well-formed rule for the hardening proof.",
    match: [{ field: "deviceManaged", equals: false }],
    outcome: "restrict",
    reasonCode: "SEC_TEST",
    severity: "high",
  };

  // validatePolicyRules accepts a well-formed rule and re-materialises it.
  const accepted = validatePolicyRules([validRule]);
  check(
    "hardening: valid rule set is accepted and normalized",
    accepted.length === 1 && accepted[0].id === "sec-test-rule",
  );

  // …and drops unexpected/prototype-y keys during re-materialisation.
  const cleaned = validatePolicyRules([
    { ...validRule, id: "clean", extra: "dropme", __proto__: { polluted: true } },
  ]);
  check(
    "hardening: rule re-materialisation strips unknown keys",
    !Object.prototype.hasOwnProperty.call(cleaned[0], "extra"),
  );

  // Each malformed shape is rejected with a validation CoreError (HTTP 400),
  // BEFORE it can ever be stored and crash a later evaluation.
  const malformed: Array<[string, unknown]> = [
    ["missing match array", [{ id: "x", description: "d", outcome: "allow", reasonCode: "R", severity: "low" }]],
    ["empty match array (no vacuous fire)", [{ ...validRule, match: [] }]],
    ["unknown condition field", [{ ...validRule, match: [{ field: "notAField", equals: true }]}]],
    ["bad `in` value for enum field", [{ ...validRule, match: [{ field: "deviceCompliance", in: ["banana"] }]}]],
    ["missing `in` on enum field", [{ ...validRule, match: [{ field: "deviceCompliance" }]}]],
    ["invalid outcome (precedence-safety)", [{ ...validRule, outcome: "banana" }]],
    ["invalid severity", [{ ...validRule, severity: "apocalyptic" }]],
    ["non-array rules", { rules: "nope" }],
    ["empty rules", []],
    ["over the rule cap", Array.from({ length: 65 }, (_v, i) => ({ ...validRule, id: `r${i}` }))],
    ["duplicate rule ids", [validRule, { ...validRule }]],
  ];
  for (const [label, input] of malformed) {
    expectError(`hardening: rejects ${label}`, "validation", () =>
      validatePolicyRules(input),
    );
  }

  // End-to-end: a malformed rule can never be persisted, so activating+
  // evaluating cannot be bricked by it. A valid authored draft, by contrast,
  // activates and evaluates cleanly.
  const secCore = SignalGridCore.demo();
  expectError(
    "hardening: createPolicyDraft rejects a malformed rule (no deferred DoS)",
    "validation",
    () =>
      secCore.createPolicyDraft(T.owner, policyId, [
        { id: "x", description: "d", outcome: "allow", reasonCode: "R", severity: "low" },
      ]),
  );
  const goodDraft = secCore.createPolicyDraft(T.owner, policyId, [validRule]);
  secCore.activatePolicyVersion(T.owner, policyId, goodDraft.id);
  let evaluatedCleanly = true;
  try {
    secCore.evaluate(T.operator, {
      identityRef: "nurse.compliant",
      deviceRef: "ipad-ward-01",
      workflowKey: "clinical-session",
    });
  } catch {
    evaluatedCleanly = false;
  }
  check(
    "hardening: evaluation after activating a validated draft does not throw",
    evaluatedCleanly,
  );

  // Deeply-nested input is rejected by the canonical-JSON depth cap rather than
  // exhausting the call stack (stack-overflow DoS vector).
  let deep: unknown = 0;
  for (let i = 0; i < 500; i++) {
    deep = [deep];
  }
  let depthGuarded = false;
  try {
    canonicalJson(deep);
  } catch (err) {
    depthGuarded = err instanceof RangeError;
  }
  check("hardening: canonicalJson rejects pathologically nested input", depthGuarded);

  // Constant-time token comparison behaves as an equality.
  check(
    "hardening: constantTimeEquals matches identical strings",
    constantTimeEquals("sgk_demo_token_abc", "sgk_demo_token_abc"),
  );
  check(
    "hardening: constantTimeEquals rejects different strings",
    !constantTimeEquals("sgk_demo_token_abc", "sgk_demo_token_abd") &&
      !constantTimeEquals("short", "longer-value"),
  );

  // The dangerous cross-tenant affordances are gone from the shipped facade.
  const facade = core as unknown as Record<string, unknown>;
  check(
    "hardening: no unsafeStore()/probe affordance on the core class",
    typeof facade["unsafeStore"] === "undefined" &&
      typeof facade["probeDeviceVisibility"] === "undefined",
  );
}

// ── 16. Security-baseline (CIS/hardening) posture as a decision dimension ─────

{
  // The compliant device reports an aligned baseline in its evidence and still
  // allows — an aligned baseline never blocks.
  const compliant = decisions.find((d) => d.reasonCodes.includes("TRUST_ESTABLISHED"));
  check("baseline: an aligned device is captured and allowed", Boolean(compliant));
  if (compliant) {
    const snapshot = core.getSnapshot(T.operator, compliant.evidenceSnapshotId);
    check(
      "baseline: aligned baseline is recorded in the evidence snapshot",
      snapshot.evidence.baselineCompliance === "aligned",
    );
  }

  // The drifted device steps up, carries the baseline state in evidence, and is
  // self-service resolvable (re-apply the hardening profile) back to allow.
  const drift = decisions.find((d) => d.reasonCodes.includes("BASELINE_DRIFTED"));
  check("baseline: a drifted device exists", Boolean(drift));
  if (drift) {
    const snapshot = core.getSnapshot(T.operator, drift.evidenceSnapshotId);
    check(
      "baseline: drift state is captured in the evidence snapshot",
      snapshot.evidence.baselineCompliance === "drifted",
    );
    // Under the stricter v2 policy, baseline drift escalates to restrict.
    const sim = core.simulateDecision(T.owner, drift.id, `${policyId}_v2`);
    check(
      "baseline: drift escalates step_up → restrict under v2",
      sim.simulatedOutcome === "restrict" && sim.changed === true,
    );
    const plan = core.getResolution(T.operator, drift.id);
    check(
      "baseline: drift is self-service (re-apply hardening profile)",
      plan.path === "self_service" &&
        plan.steps.some((s) => s.reasonCode === "BASELINE_DRIFTED"),
    );
    const resolved = core.simulateResolution(T.operator, drift.id);
    check(
      "baseline: re-applying the baseline resolves to allow",
      resolved.resolved === true && resolved.projectedOutcome === "allow",
    );
  }

  // An unknown baseline never fabricates a healthy state and never blocks on its
  // own — a device with no baseline scan is not penalised by this rule.
  const unknownBaseline = validatePolicyRules([
    {
      id: "baseline-guard",
      description: "baseline rule accepts the baselineState condition",
      match: [{ field: "baselineState", in: ["drifted", "not_assessed"] }],
      outcome: "step_up",
      reasonCode: "BASELINE_CHECK",
      severity: "medium",
    },
  ]);
  check(
    "baseline: validator accepts a baselineState rule condition",
    unknownBaseline[0]?.match[0]?.field === "baselineState",
  );
  expectError(
    "baseline: validator rejects an out-of-domain baseline value",
    "validation",
    () =>
      validatePolicyRules([
        {
          id: "bad-baseline",
          description: "d",
          match: [{ field: "baselineState", in: ["super-aligned"] }],
          outcome: "step_up",
          reasonCode: "R",
          severity: "low",
        },
      ]),
  );
}

// ── 17. Store indexes: tenant-scoped, order-preserving, latest-wins ───────────

{
  const store = new MemoryStore();
  const dev = { id: "dv_x", tenantId: "tenant_a", externalRef: "dev-1", name: "n", osPlatform: "iPadOS", osVersion: "18", ownerType: "shared" as const, managementAgent: "intune" as const };
  store.putDevice(dev);
  check("index: findDeviceByRef resolves within tenant", store.findDeviceByRef("tenant_a", "dev-1")?.id === "dv_x");
  check("index: findDeviceByRef is tenant-scoped (foreign tenant → undefined)", store.findDeviceByRef("tenant_b", "dev-1") === undefined);
  check("index: findDeviceByRef unknown ref → undefined", store.findDeviceByRef("tenant_a", "nope") === undefined);

  // Two compliance signals for the same subject, inserted OUT of observedAt
  // order: the index bucket must return both, and the latest observedAt must win
  // in derived evidence regardless of insertion order.
  const mk = (id: string, value: string, observedAt: string): NormalizedSignal => ({
    id, tenantId: "tenant_a", connectorId: "c", subjectType: "device", subjectId: "dv_x",
    category: "device_compliance", value, observedAt, freshness: "fresh", sourceReference: "fixture",
  });
  store.putSignal(mk("s_new", "compliant", "2026-07-13T14:00:00.000Z"));
  store.putSignal(mk("s_old", "non_compliant", "2026-07-13T10:00:00.000Z")); // older, inserted last
  const gathered = store.listSignalsForSubject("tenant_a", "device", "dv_x");
  check("index: listSignalsForSubject returns all subject signals", gathered.length === 2);
  check("index: listSignalsForSubject is tenant-scoped", store.listSignalsForSubject("tenant_b", "device", "dv_x").length === 0);

  const identity: Identity = { id: "i", tenantId: "tenant_a", externalRef: "r", displayName: "d", state: "enabled", assignedRole: "nurse" };
  const workflow: Workflow = { id: "w", tenantId: "tenant_a", key: "clinical-session", name: "n", riskTier: "standard" };
  const ev = buildEvidence(identity, dev, workflow, gathered);
  check(
    "index: latest-observedAt signal wins regardless of insertion order",
    ev.deviceCompliance === "compliant",
  );

  // listSignalsForSubject must preserve insertion order (it feeds the snapshot
  // signalsUsed array, whose order is part of the tamper-evident digest).
  check(
    "index: listSignalsForSubject preserves insertion order",
    gathered[0].id === "s_new" && gathered[1].id === "s_old",
  );

  // Tie: on EQUAL observedAt, WORST WINS, in either insertion order (2026-09-05,
  // eighth verdict-core round). The previous rule — "the first-inserted signal
  // wins" — was asserted here as a feature, and it was array order deciding the
  // answer: `compliant` then `non_compliant` derived compliant, the reverse derived
  // non_compliant. Two readings of one category at one instant have an equal claim
  // to be current, so neither may be dropped for the other.
  const sameTs = "2026-07-13T12:00:00.000Z";
  const tie = (first: string, second: string): string => {
    const s = new MemoryStore();
    s.putDevice(dev);
    s.putSignal(mk("tie_a", first, sameTs));
    s.putSignal(mk("tie_b", second, sameTs));
    return buildEvidence(identity, dev, workflow, s.listSignalsForSubject("tenant_a", "device", "dv_x")).deviceCompliance;
  };
  check(
    "index: an equal-observedAt tie resolves WORST-WINS regardless of insertion order",
    tie("compliant", "non_compliant") === "non_compliant" &&
      tie("non_compliant", "compliant") === "non_compliant",
  );
  check("index: a tie between two good readings stays good (a twin changes nothing)", tie("compliant", "compliant") === "compliant");
  // A strictly NEWER reading still replaces both halves of an older tie: the tie
  // was at the old instant, and a current good reading is the answer.
  {
    const s = new MemoryStore();
    s.putDevice(dev);
    s.putSignal(mk("t_old_bad", "non_compliant", sameTs));
    s.putSignal(mk("t_old_good", "compliant", sameTs));
    s.putSignal(mk("t_new", "compliant", "2026-07-13T13:00:00.000Z"));
    check(
      "index: a strictly newer reading replaces an older tie (the tie does not outlive its instant)",
      buildEvidence(identity, dev, workflow, s.listSignalsForSubject("tenant_a", "device", "dv_x")).deviceCompliance === "compliant",
    );
  }
  // The same rule on the freshness axis: two posture_freshness readings at one
  // instant, one fresh and one stale, read stale in either order.
  {
    const mkF = (id: string, value: string, order: number): NormalizedSignal => ({
      id, tenantId: "tenant_a", connectorId: "c", subjectType: "device", subjectId: "dv_x",
      category: "posture_freshness", value, observedAt: sameTs, freshness: "fresh", sourceReference: `fixture-${order}`,
    });
    const fr = (first: string, second: string): string => {
      const s = new MemoryStore();
      s.putDevice(dev);
      s.putSignal(mkF("f_a", first, 1));
      s.putSignal(mkF("f_b", second, 2));
      return buildEvidence(identity, dev, workflow, s.listSignalsForSubject("tenant_a", "device", "dv_x")).postureFreshness;
    };
    check("index: an equal-observedAt freshness tie resolves worst-wins in either order", fr("fresh", "stale") === "stale" && fr("stale", "fresh") === "stale");
  }
}

// ── 18. Badge-reader case: identity↔device binding as a decision dimension ────

{
  // Badge withdrawn → restrict; the state is captured in evidence; the worker
  // self-service step is to re-insert the badge into the reader case → allow.
  const removed = decisions.find((d) => d.reasonCodes.includes("BADGE_REMOVED"));
  check("badge: a withdrawn-badge decision exists", Boolean(removed));
  if (removed) {
    const snap = core.getSnapshot(T.operator, removed.evidenceSnapshotId);
    check("badge: binding state is captured in the evidence snapshot", snap.evidence.badgeBinding === "removed");
    const plan = core.getResolution(T.operator, removed.id);
    check(
      "badge: withdrawn badge is self-service (re-insert into the case)",
      plan.path === "self_service" && plan.steps.some((s) => s.reasonCode === "BADGE_REMOVED"),
    );
    const sim = core.simulateResolution(T.operator, removed.id);
    check("badge: re-binding the badge resolves to allow", sim.resolved === true && sim.projectedOutcome === "allow");
  }

  // Forced removal / reader tamper → deny, manual-only (cannot self-resolve).
  const forced = decisions.find((d) => d.reasonCodes.includes("BADGE_FORCED_REMOVAL"));
  check("badge: a forced-removal decision exists and denies", Boolean(forced) && forced?.outcome === "deny");
  if (forced) {
    const plan = core.getResolution(T.operator, forced.id);
    check("badge: forced removal is manual-only (routed to security)", plan.path === "escalation");
  }

  // A bound badge is a positive signal that never blocks on its own; an unknown
  // badge (no reader) never fabricates a healthy state.
  const bound = decisions.find((d) => d.reasonCodes.includes("TRUST_ESTABLISHED"));
  check("badge: a TRUST_ESTABLISHED decision exists to check the badge on", Boolean(bound));
  if (bound) {
    const snap = core.getSnapshot(T.operator, bound.evidenceSnapshotId);
    check("badge: a healthy allow carries a present (bound) badge", snap.evidence.badgeBinding === "present");
  }

  // Validator accepts a badgeState rule and rejects an out-of-domain value.
  const okRule = validatePolicyRules([
    { id: "badge-guard", description: "d", match: [{ field: "badgeState", in: ["removed", "forced"] }], outcome: "restrict", reasonCode: "BADGE_CHECK", severity: "high" },
  ]);
  check("badge: validator accepts a badgeState rule condition", okRule[0]?.match[0]?.field === "badgeState");
  expectError("badge: validator rejects an out-of-domain badge value", "validation", () =>
    validatePolicyRules([
      { id: "bad", description: "d", match: [{ field: "badgeState", in: ["super-bound"] }], outcome: "deny", reasonCode: "R", severity: "low" },
    ]),
  );
}

// ── 19. SmartDock: the embedded dock is a first-class ingestion path + signal ──

{
  // The dedicated SmartDock is registered as its own DockBridge connector and
  // documents the embedded_smartdock ingestion mode.
  const connectors = core.listConnectors(T.owner);
  const smartdock = connectors.find((c) => c.ingestionMode === "embedded_smartdock");
  check("smartdock: embedded connector is registered", Boolean(smartdock));
  check(
    "smartdock: connector is a dockbridge-custody kind via embedded_smartdock",
    smartdock?.kind === "dockbridge-custody" && smartdock?.ingestionMode === "embedded_smartdock",
  );
  if (smartdock) {
    // It re-syncs deterministically and normalizes custody signals (read-only).
    const run = core.syncConnector(T.owner, smartdock.id);
    check("smartdock: re-sync normalizes custody signals (read-only)", run.signalsNormalized > 0);
  }

  // A faulted dock cannot vouch for custody → restrict; the dock's own hardware
  // state is now captured in the evidence snapshot (previously discarded).
  const faulted = decisions.find((d) => d.reasonCodes.includes("DOCK_FAULTED"));
  check("smartdock: a faulted-dock decision exists and restricts", Boolean(faulted) && faulted?.outcome === "restrict");
  if (faulted) {
    const snap = core.getSnapshot(T.operator, faulted.evidenceSnapshotId);
    check("smartdock: dock hardware state is captured in evidence", snap.evidence.dockState === "faulted");
    const plan = core.getResolution(T.operator, faulted.id);
    check("smartdock: faulted dock is approval-gated (move to a healthy dock)", plan.path === "assisted");
  }

  // An offline dock has lost its live custody channel → step-up, self-service.
  const offline = decisions.find((d) => d.reasonCodes.includes("DOCK_OFFLINE"));
  check("smartdock: an offline-dock decision exists and steps up", Boolean(offline) && offline?.outcome === "step_up");
  if (offline) {
    const sim = core.simulateResolution(T.operator, offline.id);
    check("smartdock: returning to an online dock resolves to allow", sim.resolved === true && sim.projectedOutcome === "allow");
  }

  // A blinded tamper sensor no longer fails open: step-up instead of allow.
  const blind = decisions.find((d) => d.reasonCodes.includes("TAMPER_SENSOR_UNAVAILABLE"));
  check("smartdock: a blinded tamper sensor steps up (no fail-open)", Boolean(blind) && blind?.outcome === "step_up");

  // A healthy allow carries an occupied dock; an unknown dock never fabricates one.
  const bound = decisions.find((d) => d.reasonCodes.includes("TRUST_ESTABLISHED"));
  check("smartdock: a TRUST_ESTABLISHED decision exists to check the dock state on", Boolean(bound));
  if (bound) {
    const snap = core.getSnapshot(T.operator, bound.evidenceSnapshotId);
    check("smartdock: a healthy allow carries an occupied dock state", snap.evidence.dockState === "occupied");
  }

  // Validator accepts a dockState rule and rejects an out-of-domain value.
  const okRule = validatePolicyRules([
    { id: "dock-guard", description: "d", match: [{ field: "dockState", in: ["faulted", "offline"] }], outcome: "restrict", reasonCode: "DOCK_CHECK", severity: "high" },
  ]);
  check("smartdock: validator accepts a dockState rule condition", okRule[0]?.match[0]?.field === "dockState");
  expectError("smartdock: validator rejects an out-of-domain dock value", "validation", () =>
    validatePolicyRules([
      { id: "bad", description: "d", match: [{ field: "dockState", in: ["melted"] }], outcome: "deny", reasonCode: "R", severity: "low" },
    ]),
  );
}

// ── 20. Fail-closed guardrail: an un-gated allow is suppressed on degraded ────
//        critical evidence (ALLOW_SUPPRESSED_DEGRADED_EVIDENCE).
//
// The shipped policy gates its allow rule on `criticalSignalsPresent`. This
// exercises the engine's independent, defense-in-depth backstop: even a rule set
// whose allow rule is NOT gated on critical evidence cannot allow when critical
// signals are degraded — the outcome is forced to step_up with the guardrail
// reason code. Without the backstop this would (wrongly) allow.
{
  // A degraded evidence bundle: healthy in every gated dimension EXCEPT there is
  // no device_encryption signal, so criticalSignalsPresent === false.
  const identity: Identity = {
    id: "id_ungated",
    tenantId: "tenant_northwind",
    externalRef: "nurse.ungated",
    displayName: "Nurse",
    state: "enabled",
    assignedRole: "nurse",
  };
  const device: Device = {
    id: "dev_ungated",
    tenantId: "tenant_northwind",
    externalRef: "ipad-ungated",
    name: "Ward iPad",
    osPlatform: "iPadOS",
    osVersion: "18.5",
    ownerType: "shared",
    managementAgent: "intune",
  };
  const workflow: Workflow = {
    id: "wf_ungated",
    tenantId: "tenant_northwind",
    key: "clinical-session",
    name: "Clinical session",
    riskTier: "elevated",
  };
  const sig = (
    category: SignalCategory,
    value: NormalizedSignal["value"],
  ): NormalizedSignal => ({
    id: `sig_ungated_${category}`,
    tenantId: "tenant_northwind",
    connectorId: "conn",
    subjectType: "device",
    subjectId: device.id,
    category,
    value,
    observedAt: "2026-07-13T13:00:00.000Z",
    freshness: "fresh",
    sourceReference: "fixture:test",
  });
  const degradedEvidence = buildEvidence(identity, device, workflow, [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
    // deliberately no device_encryption signal → deviceEncrypted "unknown"
  ]);
  check(
    "guardrail: degraded evidence has criticalSignalsPresent === false",
    degradedEvidence.criticalSignalsPresent === false,
    `criticalSignalsPresent=${degradedEvidence.criticalSignalsPresent}`,
  );

  // A rule set whose allow rule is NOT gated on criticalSignalsPresent: it fires
  // purely on a managed device and would, on its own, resolve to allow.
  const ungatedRules = validatePolicyRules([
    {
      id: "ungated-allow",
      description: "Allow a managed device, with no critical-evidence gate.",
      match: [{ field: "deviceManaged", equals: true }],
      outcome: "allow",
      reasonCode: "TRUST_ESTABLISHED",
      severity: "low",
    },
  ]);
  const ungatedVersion = {
    id: "pv_ungated_guardrail",
    tenantId: "tenant_northwind",
    policyId: "pol_ungated",
    version: 99,
    status: "draft" as const,
    rules: ungatedRules,
    createdAt: "2026-07-13T15:00:00.000Z",
    digest: "unused-in-evaluation",
  };
  const ungated = evaluatePolicy(ungatedVersion, degradedEvidence);
  check(
    "guardrail: un-gated allow is suppressed to step_up on degraded evidence",
    ungated.outcome === "step_up",
    `got "${ungated.outcome}"`,
  );
  check(
    "guardrail: suppression carries ALLOW_SUPPRESSED_DEGRADED_EVIDENCE",
    ungated.reasonCodes.includes("ALLOW_SUPPRESSED_DEGRADED_EVIDENCE"),
    `got [${ungated.reasonCodes.join(", ")}]`,
  );
  // ── stale dock evidence is not evidence ────────────────────────────────────
  //
  // runDockSync classified every record's age and stamped `freshness` onto all
  // six signals it emitted, and buildEvidence never read it. A dock silent for a
  // year produced a tamperState:"none" indistinguishable from one measured a
  // minute ago. The asymmetry was the tell: a dock that HONESTLY reports
  // sensor_unavailable steps up, while a dock silent for a year did not.
  //
  // Note what is NOT done. Degrading a stale VALUE to "unknown" — the obvious
  // fix — would RELAX the gateway: an expired custody_state:"checked_out" stops
  // matching custody-overdue and a restriction disappears. Staleness therefore
  // travels as its own input into the fail-closed backstop, which can only ever
  // move allow to step_up.
  //
  // "missing" must stay permissive, and that arm matters as much as the others:
  // a tenant with no dock hardware is a deployment shape, not a degraded signal,
  // and treating the two alike would step up every such tenant on day one.
  const allCriticalKnown = buildEvidence(identity, device, workflow, [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("device_encryption", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
  ]);
  check(
    "stale-dock guardrail: the control case is genuinely intact (else the sweep below is vacuous)",
    allCriticalKnown.criticalSignalsPresent === true,
  );
  // The two fields the critical set used to omit. Both are masked by the shipped
  // v1 rules and both were reachable by a custom rule set, which is exactly the
  // case the backstop exists for — it is the layer that holds when the rules do
  // not.
  check(
    "critical set: an UNKNOWN osSupported degrades critical evidence",
    deriveCriticalSignalsPresent({ ...allCriticalKnown, osSupported: "unknown" }) === false,
  );
  // BOTH freshness ladders are swept across the WHOLE union, from a list derived
  // from the exhaustive severity map — not hand-listed here.
  //
  // This shape exists because the previous one hid a live defect. The dock ladder
  // was swept across all five values; posture got a single hand-written
  // "expired" case. `postureFreshness: "stale"` was therefore never asserted, and
  // it passed the backstop — while the dock ladder eleven lines away rejected the
  // same word. 221 assertions were green and the one value that mattered was the
  // one nobody wrote down. A partial sweep is not coverage; it is a sample that
  // looks like coverage.
  //
  // The expectations are `Record<Freshness, boolean>`, so adding a member to the
  // union fails to COMPILE until someone states what it means for each ladder.
  // The two ladders legitimately DIFFER on "missing": no dock hardware at all is
  // a deployment shape, not a degraded signal, whereas a missing posture answer
  // is the absence of the thing being asked about. That difference is declared
  // here rather than left implicit in two chains of `!==`.
  const CRITICAL_BY_POSTURE_FRESHNESS: Record<Freshness, boolean> = {
    fresh: true,
    stale: false,
    expired: false,
    missing: false,
    unknown: false,
  };
  const CRITICAL_BY_DOCK_FRESHNESS: Record<Freshness, boolean> = {
    fresh: true,
    missing: true,
    stale: false,
    expired: false,
    unknown: false,
  };
  for (const freshness of FRESHNESS_VALUES) {
    const expectPosture = CRITICAL_BY_POSTURE_FRESHNESS[freshness];
    check(
      `critical set: postureFreshness "${freshness}" -> criticalSignalsPresent ${expectPosture}`,
      deriveCriticalSignalsPresent({ ...allCriticalKnown, postureFreshness: freshness }) === expectPosture,
    );
    const expectDock = CRITICAL_BY_DOCK_FRESHNESS[freshness];
    check(
      `stale-dock guardrail: dockEvidenceFreshness "${freshness}" -> criticalSignalsPresent ${expectDock}`,
      deriveCriticalSignalsPresent({ ...allCriticalKnown, dockEvidenceFreshness: freshness }) === expectDock,
    );
  }
  // Mutation sanity: the same rule set on INTACT critical evidence allows — proving
  // the suppression above is driven by criticalSignalsPresent, not a dead rule.
  const intactEvidence = buildEvidence(identity, device, workflow, [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
    sig("device_encryption", true),
  ]);
  check(
    "guardrail: same un-gated allow DOES allow on intact critical evidence",
    intactEvidence.criticalSignalsPresent === true &&
      evaluatePolicy(ungatedVersion, intactEvidence).outcome === "allow",
  );
}

// ── Report ────────────────────────────────────────────────────────────────────

// ── identity_state: two sources, folded worst-wins ────────────────────────────
//
// WHY THIS EXISTS. The identity connector emits an `identity_state` signal.
// `buildEvidence` normalized it, `decision.ts` counted it into `signalsUsed`,
// and NOTHING EVER READ IT — the enabled/disabled verdict came from the static
// identity row alone. A connector reporting a DISABLED account therefore
// produced `identityEnabled: true` and an ALLOW, while the evidence snapshot
// recorded the signal as an input to a decision it had not influenced.
//
// The fold's asymmetry is the invariant, so both halves are asserted: an
// affirmative `false` from either source must win, and SILENCE must change
// nothing in either direction — it may not loosen a disabled row, and it may
// not promote an `"unknown"` row to `true`. The silence cases are what make
// this safe to land: with no identity connector present the behaviour is
// byte-identical to before the fold existed.
for (const [fromRow, fromSignal, want, why] of [
  [true, "unknown", true, "row enabled + no signal -> unchanged"],
  [true, true, true, "both sources agree enabled"],
  [true, false, false, "connector reports DISABLED -> wins over an enabled row"],
  [false, "unknown", false, "row disabled + no signal -> stays disabled"],
  [false, true, false, "row disabled + signal enabled -> disabled still wins"],
  ["unknown", "unknown", "unknown", "both silent -> unknown, never true"],
  ["unknown", true, "unknown", "a signal alone may NEVER promote unknown to true"],
  ["unknown", false, false, "affirmative disabled from the signal alone wins"],
] as [boolean | "unknown", boolean | "unknown", boolean | "unknown", string][]) {
  const got = foldIdentityEnabled(fromRow, fromSignal);
  check(
    `identity fold: ${why}`,
    got === want,
    `row=${String(fromRow)} signal=${String(fromSignal)} -> ${String(got)}, expected ${String(want)}`,
  );
}


// ── Row 83: two connectors, one device, one category ──────────────────────────
//
// WHY THIS EXISTS, and it was reproduced before it was fixed. Signal ids were
// minted as (tenant, subjectType, subjectId, category) with NO connector, so two
// connectors reporting the same category for the same device minted the SAME id.
// `store.putSignal` keys its bucket by that id and overwrites in place with no
// freshness comparison, so the second sync ERASED the first. A dock feed carrying
// a reading observed 55 minutes EARLIER wiped a confirmed tamper and the outcome
// went deny -> allow, with the signal count unchanged because nothing was added.
//
// `groupLatest` in evidence.ts exists to arbitrate exactly this by greatest
// observedAt, and it never got the chance: only one row survived the store.
//
// The shipped seed cannot catch this — Northwind's two dock connectors cover
// DISJOINT device sets, so no fixture has a two-connectors-one-device case. This
// block constructs one.
{
  const seeded = seedDemoStore(fixedClock("2026-07-13T15:00:00.000Z"));
  const dockStore = seeded.store;
  const dockConnector = dockStore
    .listConnectors(seeded.tenants.northwind)
    .find((c) => c.kind === "dockbridge-custody");
  const baseRecords = dockConnector
    ? seeded.dockRecords[dockConnector.id]
    : undefined;
  const baseRecord = baseRecords?.[0];

  check(
    "row 83 setup: a dockbridge connector and a custody record exist to build the case from",
    Boolean(dockConnector) && Boolean(baseRecord),
  );

  if (dockConnector && baseRecord) {
    const device = dockStore.findDeviceByRef(
      dockConnector.tenantId,
      baseRecord.deviceRef,
    );
    check("row 83 setup: the record resolves to a real device", Boolean(device));

    // Two connectors differing ONLY in id — the same tenant, the same device.
    const connectorA = { ...dockConnector, id: "conn_dock_alpha" };
    const connectorB = { ...dockConnector, id: "conn_dock_beta" };

    // A observes a CONFIRMED tamper at 14:55. B reports "none" — observed at
    // 14:00, fifty-five minutes EARLIER. B must not be able to erase A.
    const fresherWorse = {
      ...baseRecord,
      tamperState: "confirmed" as const,
      observedAt: "2026-07-13T14:55:00.000Z",
    };
    const stalerBetter = {
      ...baseRecord,
      tamperState: "none" as const,
      observedAt: "2026-07-13T14:00:00.000Z",
    };

    const clk = fixedClock("2026-07-13T15:00:00.000Z");
    runDockSync(dockStore, clk, connectorA, [fresherWorse]);
    runDockSync(dockStore, clk, connectorB, [stalerBetter]);

    const tamperRows = device
      ? dockStore
          .listSignalsForSubject(dockConnector.tenantId, "device", device.id)
          .filter((s) => s.category === "tamper_state")
      : [];

    // NOT pinned to a literal count: the seed already carries a tamper row from
    // the tenant's own dockbridge connector, so the total is seed-dependent and a
    // fixed number would fossilise. What must hold is that BOTH new connectors'
    // rows survive alongside it — before the fix they collapsed onto one id.
    const survivingIds = new Set(tamperRows.map((s2) => s2.connectorId));
    check(
      "row 83: both connectors' tamper rows SURVIVE — the second no longer overwrites the first",
      survivingIds.has("conn_dock_alpha") && survivingIds.has("conn_dock_beta"),
      `connectorIds present: ${[...survivingIds].join(", ")}`,
    );
    check(
      "row 83: the two rows carry DIFFERENT ids, and the id is what differs",
      new Set(tamperRows.map((s) => s.id)).size === tamperRows.length,
      `ids: ${tamperRows.map((s) => s.id).join(", ")}`,
    );
    check(
      "row 83: every surviving row is attributable to a DISTINCT connector",
      survivingIds.size === tamperRows.length,
      `${tamperRows.length} rows, ${survivingIds.size} distinct connectors`,
    );

    // The point of keeping both: the FRESHER observation must win the fold. This
    // asserts the input `groupLatest` now receives — the greatest-observedAt row
    // among the survivors is the CONFIRMED tamper, not the older "none". Before
    // the fix there was exactly one row, so there was nothing to arbitrate at all.
    const winner = tamperRows.reduce(
      (best, s2) => (best && best.observedAt >= s2.observedAt ? best : s2),
      tamperRows[0],
    );
    check(
      'row 83: the greatest-observedAt survivor is the CONFIRMED tamper, so the fold cannot pick the older "none"',
      winner?.value === "confirmed",
      `winner observedAt=${String(winner?.observedAt)} value=${String(winner?.value)}`,
    );
  }
}



// ── MEMORY BOUND (F6): the in-process store must not grow without limit ─────────
// A bound of 3 makes the eviction observable in a handful of evaluates. FIFO by
// insertion: after five evaluates only the newest three remain, the oldest two are
// gone together with their evidence snapshots, and a fresh evaluate still works.
{
  const bounded = SignalGridCore.demo(undefined, { maxDecisionsPerTenant: 3 });
  const ids: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    ids.push(bounded.evaluate(T.operator, { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" }).decisionId);
  }
  const kept = bounded.listDecisions(T.operator).map((d) => d.id);
  check("memory bound: after 5 evaluates with a bound of 3, exactly 3 decisions remain", kept.length === 3);
  check("memory bound: the three that remain are the three newest (FIFO eviction)", ids.slice(2).every((id) => kept.includes(id)));
  const throws = (f: () => unknown) => { try { f(); return false; } catch { return true; } };
  check("memory bound: the oldest decision is gone (not_found), not silently kept", throws(() => bounded.getDecision(T.operator, ids[0])));
  const newest = bounded.getDecision(T.operator, ids[4]);
  check("memory bound: the newest decision and its evidence snapshot are still readable", !throws(() => bounded.getSnapshot(T.operator, newest.evidenceSnapshotId)));

  // ── F6b: the bound covers EVERY collection an evaluate grows (audit 2x, deliveries 2x, remediations 1x) ──
  // Five more evaluates of a RESTRICT case, so remediation proposals are minted.
  for (let i = 0; i < 5; i += 1) {
    bounded.evaluate(T.operator, { identityRef: "nurse.noncompliant", deviceRef: "ipad-ward-02", workflowKey: "clinical-session" });
  }

  const boundedAudit = bounded.listAudit(T.owner);
  // FLOOR FIRST: "at most 6" over an empty list is green about nothing.
  check("memory bound: the audit log is non-empty, so the cap below is measured against real rows", boundedAudit.length > 0);
  check(
    `memory bound: audit events are capped at 2x the decision bound (<= 6, got ${boundedAudit.length})`,
    boundedAudit.length <= 6,
  );
  const boundedChain = bounded.verifyAudit(T.owner);
  check("memory bound: the RETAINED audit chain still verifies after eviction (re-anchored, not broken)", boundedChain.valid === true);
  check("memory bound: and it SAYS it is a window — truncated is true with a non-zero evicted count",
    boundedChain.truncated === true && boundedChain.evictedCount > 0);

  const boundedDeliveries = bounded.listWebhookDeliveries(T.owner);
  check(
    `memory bound: webhook deliveries were actually minted AND are capped at 2x the decision bound (0 < n <= 6, got ${boundedDeliveries.length})`,
    boundedDeliveries.length > 0 && boundedDeliveries.length <= 6,
  );
  const boundedRemediations = bounded.listRemediations(T.owner);
  check("memory bound: remediations were actually minted, so the cap below is measured against real rows", boundedRemediations.length > 0);
  check(
    `memory bound: remediations are capped at the decision bound (<= 3, got ${boundedRemediations.length})`,
    boundedRemediations.length <= 3,
  );

  // ── F6c: /v1/metrics can SAY that its numbers cover a window ─────────────────
  //
  // Past the cap `pendingReview` counts DOWN and `restrictDenyRate` drifts, and the
  // response used to carry nothing a reader could use to tell that from a full
  // picture. The window is reported, not inferred.
  const boundedMetrics = bounded.metrics(T.operator);
  check("metrics window: a capped tenant reports capped=true", boundedMetrics.window.capped === true);
  check("metrics window: decisionsConsidered equals the retained decisions, not the tenant's history",
    boundedMetrics.window.decisionsConsidered === boundedMetrics.totalDecisions && boundedMetrics.window.decisionsConsidered === 3);
  check("metrics window: maxPerTenant reports the cap actually in force", boundedMetrics.window.maxPerTenant === 3);

  // The NEGATIVE control: an unbounded core must NOT report capped, or the flag is
  // stuck true and says nothing.
  const unbounded = SignalGridCore.demo();
  unbounded.evaluate(T.operator, { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" });
  const unboundedMetrics = unbounded.metrics(T.operator);
  check("metrics window: an UNCAPPED tenant reports capped=false (the flag is not stuck on)", unboundedMetrics.window.capped === false);
  check("metrics window: an uncapped tenant reports the default cap of 5000", unboundedMetrics.window.maxPerTenant === 5000);
  check("audit chain: an unevicted chain reports truncated=false with evictedCount 0",
    unbounded.verifyAudit(T.owner).truncated === false && unbounded.verifyAudit(T.owner).evictedCount === 0);

  // ── F6d: an out-of-union outcome must not poison byOutcome (`undefined + 1` = NaN, and the write MINTS the key) ──
  const healthy = unbounded.listDecisions(T.operator);
  const poisoned = [
    ...healthy,
    { ...healthy[0], id: "dec_poisoned", outcome: "not_an_outcome" as unknown as DecisionOutcome },
  ];
  const poisonedMetrics = computeMetrics(poisoned, { capped: false, maxPerTenant: 5000 });
  check("NaN guard: byOutcome holds exactly the four known outcomes — no phantom bucket minted by an out-of-union row",
    JSON.stringify(Object.keys(poisonedMetrics.byOutcome).sort()) === JSON.stringify(["allow", "deny", "restrict", "step_up"]));
  check("NaN guard: every byOutcome count is a finite number (no undefined + 1 = NaN)",
    Object.values(poisonedMetrics.byOutcome).every((v) => Number.isFinite(v)));
  check("NaN guard: the unclassifiable row is COUNTED, not silently dropped", poisonedMetrics.window.unrecognizedOutcomes === 1);
  check("NaN guard: it counts on the restrictive side, never toward the allow rate",
    poisonedMetrics.restrictDenyRate > computeMetrics(healthy, { capped: false, maxPerTenant: 5000 }).restrictDenyRate);
  check("NaN guard: a clean decision set reports zero unrecognized outcomes",
    computeMetrics(healthy, { capped: false, maxPerTenant: 5000 }).window.unrecognizedOutcomes === 0);
}

// ── 20. Rule arms nothing had ever executed (verdict-core finding V6, 2026-09-02) ──
//
// A source read at 19e53e0 found eight branches of the shipped decision path with
// NEITHER a fixture NOR a proof assertion behind them: four v1 rules
// (identity-unknown, elevated-workflow-needs-encryption, custody-exception,
// tamper-confirmed — the last reached only through a hand-built Decision in the
// zero-trust proof, never through a real evaluation), the no-rule-matched default,
// both authoring size ceilings, and the condition-shape rejections. Each one is
// exercised here through the REAL evaluator or the REAL validator; each assertion
// was confirmed to go red when its rule/guard is removed.
{
  const identityFor = (state: Identity["state"]): Identity => ({
    id: `id_v6_${state}`,
    tenantId: "tenant_northwind",
    externalRef: `nurse.v6.${state}`,
    displayName: "Nurse",
    state,
    assignedRole: "nurse",
  });
  const device: Device = {
    id: "dev_v6",
    tenantId: "tenant_northwind",
    externalRef: "ipad-v6",
    name: "Ward iPad",
    osPlatform: "iPadOS",
    osVersion: "18.5",
    ownerType: "shared",
    managementAgent: "intune",
  };
  const workflowFor = (riskTier: Workflow["riskTier"]): Workflow => ({
    id: `wf_v6_${riskTier}`,
    tenantId: "tenant_northwind",
    key: "clinical-session",
    name: "Clinical session",
    riskTier,
  });
  const sig = (
    category: SignalCategory,
    value: NormalizedSignal["value"],
  ): NormalizedSignal => ({
    id: `sig_v6_${category}`,
    tenantId: "tenant_northwind",
    connectorId: "conn",
    subjectType: "device",
    subjectId: device.id,
    category,
    value,
    observedAt: "2026-07-13T13:00:00.000Z",
    freshness: "fresh",
    sourceReference: "fixture:v6",
  });
  const healthy: NormalizedSignal[] = [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("device_encryption", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
  ];
  const v1 = {
    id: "pv_v6_1",
    tenantId: "tenant_northwind",
    policyId: "pol_v6",
    version: 1,
    status: "active" as const,
    rules: SHARED_DEVICE_RULES_V1,
    createdAt: "2026-07-13T13:00:00.000Z",
    digest: "test",
  };

  // identity-unknown → step_up / IDENTITY_STATE_UNKNOWN
  const unknownIdentity = buildEvidence(identityFor("unknown"), device, workflowFor("standard"), healthy);
  const unknownIdentityEval = evaluatePolicy(v1, unknownIdentity);
  check(
    "v6 identity-unknown: an unknown identity state derives 'unknown', never true",
    unknownIdentity.identityEnabled === "unknown",
    `got ${String(unknownIdentity.identityEnabled)}`,
  );
  check(
    "v6 identity-unknown: evaluates to step_up with IDENTITY_STATE_UNKNOWN",
    unknownIdentityEval.outcome === "step_up" &&
      unknownIdentityEval.reasonCodes.includes("IDENTITY_STATE_UNKNOWN"),
    `${unknownIdentityEval.outcome} [${unknownIdentityEval.reasonCodes.join(", ")}]`,
  );
  check(
    "v6 identity-unknown: the rule FIRED — it is not the no-rule default wearing the same verdict",
    unknownIdentityEval.matchedRules.some((r) => r.ruleId === "identity-unknown") &&
      !unknownIdentityEval.reasonCodes.includes("NO_RULE_MATCHED_DEFAULT_STEP_UP"),
  );

  // elevated-workflow-needs-encryption → step_up / ENCRYPTION_REQUIRED_FOR_WORKFLOW
  const unencrypted = buildEvidence(
    identityFor("enabled"),
    device,
    workflowFor("elevated"),
    [...healthy.filter((s) => s.category !== "device_encryption"), sig("device_encryption", false)],
  );
  const unencryptedEval = evaluatePolicy(v1, unencrypted);
  check(
    "v6 elevated-needs-encryption: an unencrypted elevated workflow steps up with ENCRYPTION_REQUIRED_FOR_WORKFLOW",
    unencryptedEval.outcome === "step_up" &&
      unencryptedEval.reasonCodes.includes("ENCRYPTION_REQUIRED_FOR_WORKFLOW") &&
      unencryptedEval.matchedRules.some((r) => r.ruleId === "elevated-workflow-needs-encryption"),
    `${unencryptedEval.outcome} [${unencryptedEval.reasonCodes.join(", ")}]`,
  );
  check(
    "v6 elevated-needs-encryption: the SAME device on a standard workflow does not raise it (the risk-tier condition is load-bearing)",
    !evaluatePolicy(
      v1,
      buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [
        ...healthy.filter((s) => s.category !== "device_encryption"),
        sig("device_encryption", false),
      ]),
    ).reasonCodes.includes("ENCRYPTION_REQUIRED_FOR_WORKFLOW"),
  );

  // custody-exception → restrict / CUSTODY_EXCEPTION
  const custodyException = buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [
    ...healthy,
    sig("custody_state", "exception"),
  ]);
  const custodyEval = evaluatePolicy(v1, custodyException);
  check(
    "v6 custody-exception: a custody exception restricts with CUSTODY_EXCEPTION",
    custodyEval.outcome === "restrict" &&
      custodyEval.reasonCodes.includes("CUSTODY_EXCEPTION") &&
      custodyEval.matchedRules.some((r) => r.ruleId === "custody-exception"),
    `${custodyEval.outcome} [${custodyEval.reasonCodes.join(", ")}]`,
  );

  // tamper-confirmed → deny / TAMPER_CONFIRMED, through a real evaluation
  const tamperConfirmed = buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [
    ...healthy,
    sig("tamper_state", "confirmed"),
  ]);
  const tamperEval = evaluatePolicy(v1, tamperConfirmed);
  check(
    "v6 tamper-confirmed: a confirmed tamper DENIES with TAMPER_CONFIRMED (evaluated, not hand-built)",
    tamperEval.outcome === "deny" &&
      tamperEval.reasonCodes.includes("TAMPER_CONFIRMED") &&
      tamperEval.matchedRules.some((r) => r.ruleId === "tamper-confirmed"),
    `${tamperEval.outcome} [${tamperEval.reasonCodes.join(", ")}]`,
  );
  check(
    "v6 tamper-confirmed: deny beats the allow the same evidence would otherwise earn",
    evaluatePolicy(v1, buildEvidence(identityFor("enabled"), device, workflowFor("standard"), healthy))
      .outcome === "allow",
  );

  // NO_RULE_MATCHED_DEFAULT_STEP_UP — a policy whose only rule cannot match.
  const inertVersion = {
    ...v1,
    id: "pv_v6_inert",
    rules: validatePolicyRules([
      {
        id: "never-matches",
        description: "A rule pinned to an owner type this fixture never has.",
        match: [{ field: "ownerType", in: ["personal"] }],
        outcome: "deny",
        reasonCode: "INERT_RULE_NEVER_FIRES",
        severity: "critical",
      },
    ]),
  };
  const inertEval = evaluatePolicy(
    inertVersion,
    buildEvidence(identityFor("enabled"), device, workflowFor("standard"), healthy),
  );
  check(
    "v6 no-rule-matched: a policy with no matching rule steps up with NO_RULE_MATCHED_DEFAULT_STEP_UP — never a silent allow",
    inertEval.outcome === "step_up" &&
      inertEval.matchedRules.length === 0 &&
      inertEval.reasonCodes.includes("NO_RULE_MATCHED_DEFAULT_STEP_UP"),
    `${inertEval.outcome} [${inertEval.reasonCodes.join(", ")}]`,
  );

  // Authoring ceilings — MAX_POLICY_RULES and MAX_RULE_CONDITIONS.
  const okRule = (id: string) => ({
    id,
    description: "filler",
    match: [{ field: "ownerType", in: ["personal"] }],
    outcome: "deny",
    reasonCode: "FILLER_CODE",
    severity: "critical",
  });
  check(
    `v6 ceiling: exactly MAX_POLICY_RULES (${MAX_POLICY_RULES}) rules is ACCEPTED — the gate is a ceiling, not an off-by-one`,
    validatePolicyRules(Array.from({ length: MAX_POLICY_RULES }, (_, i) => okRule(`r${i}`))).length ===
      MAX_POLICY_RULES,
  );
  expectError(
    `v6 ceiling: MAX_POLICY_RULES + 1 (${MAX_POLICY_RULES + 1}) rules is REJECTED`,
    "validation",
    () => validatePolicyRules(Array.from({ length: MAX_POLICY_RULES + 1 }, (_, i) => okRule(`r${i}`))),
  );
  const conditions = (n: number) =>
    Array.from({ length: n }, () => ({ field: "ownerType", in: ["personal"] }));
  check(
    `v6 ceiling: exactly MAX_RULE_CONDITIONS (${MAX_RULE_CONDITIONS}) conditions is ACCEPTED`,
    validatePolicyRules([{ ...okRule("r_cond"), match: conditions(MAX_RULE_CONDITIONS) }])[0].match
      .length === MAX_RULE_CONDITIONS,
  );
  expectError(
    `v6 ceiling: MAX_RULE_CONDITIONS + 1 (${MAX_RULE_CONDITIONS + 1}) conditions is REJECTED`,
    "validation",
    () => validatePolicyRules([{ ...okRule("r_cond"), match: conditions(MAX_RULE_CONDITIONS + 1) }]),
  );

  // validateCondition reject paths — an unknown field, and a tristate field given
  // a value that is neither a boolean nor the sanctioned "unknown".
  expectError(
    "v6 validateCondition: an unknown condition field is REJECTED (a typo cannot author a rule that silently never fires)",
    "validation",
    () => validatePolicyRules([{ ...okRule("r_field"), match: [{ field: "notAField", in: ["personal"] }] }]),
  );
  expectError(
    "v6 validateCondition: a tristate field given a non-boolean, non-'unknown' value is REJECTED",
    "validation",
    () => validatePolicyRules([{ ...okRule("r_tri"), match: [{ field: "identityEnabled", equals: "yes" }] }]),
  );

  // ── V8: evidence derivation hardening (2026-09-02) ────────────────────────
  //
  // (a) A freshness string outside the union must resolve to "unknown" — the
  // RAISING answer. Before the guard, `FRESHNESS_SEVERITY[bogus]` was undefined,
  // the bogus string stuck as `worst`, it equalled none of the values
  // `deriveCriticalSignalsPresent` rejects, and the decision reached ALLOW.
  const bogusFreshness = buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [
    ...healthy,
    { ...sig("dock_state", "docked"), freshness: "totally-bogus" as unknown as Freshness },
  ]);
  check(
    "v8a: an out-of-union dock freshness resolves to 'unknown', never to itself",
    bogusFreshness.dockEvidenceFreshness === "unknown",
    `got ${JSON.stringify(bogusFreshness.dockEvidenceFreshness)}`,
  );
  check(
    "v8a: …and it therefore degrades critical evidence and cannot reach allow",
    bogusFreshness.criticalSignalsPresent === false &&
      evaluatePolicy(v1, bogusFreshness).outcome !== "allow",
  );
  // (b) "Latest" is by parsed instant. Two shapes broke the old string compare.
  const olderUtc = { ...sig("device_compliance", "compliant"), id: "sig_v8_a", observedAt: "2026-07-13T08:00:00.000Z" };
  const newerUtc = { ...sig("device_compliance", "non_compliant"), id: "sig_v8_b", observedAt: "2026-07-13T10:00:00.000Z" };
  const earlierOffset = { ...sig("device_compliance", "non_compliant"), id: "sig_v8_c", observedAt: "2026-07-13T09:00:00+02:00" };
  const unparseable = { ...sig("device_compliance", "non_compliant"), id: "sig_v8_d", observedAt: "not-a-date" };
  const rest = healthy.filter((s) => s.category !== "device_compliance");
  check(
    "v8b: a +02:00 timestamp that is EARLIER in real time does not become 'latest' (it sorts later as text)",
    buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [...rest, olderUtc, earlierOffset])
      .deviceCompliance === "compliant",
  );
  // An illegible reading never wins ON TIME. The only way to observe that now is
  // to make its value the BETTER one: if it could win as latest it would
  // overwrite the parseable answer with `compliant`, and it does not.
  const unparseableGood = { ...sig("device_compliance", "compliant"), id: "sig_v8_e", observedAt: "not-a-date" };
  const olderUtcBad = { ...sig("device_compliance", "non_compliant"), id: "sig_v8_f", observedAt: "2026-07-13T08:00:00.000Z" };
  check(
    "v8b: an UNPARSEABLE observedAt never wins over a real timestamp — its BETTER value does not overwrite the parseable answer, in either array order",
    buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [...rest, olderUtcBad, unparseableGood])
      .deviceCompliance === "non_compliant" &&
      buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [...rest, unparseableGood, olderUtcBad])
        .deviceCompliance === "non_compliant",
  );
  // …but it can still ACCUSE. Second-review finding F-A (2026-09-02): the first
  // cut answered "unknown" for every illegible reading, which discards a bad
  // value, and a discarded bad value is leniency bought with corruption. Worst
  // wins in both directions — the freshness rule, applied to values.
  check(
    "v8b/F-A: an illegible reading whose value is WORSE than the latest parseable one still wins on VALUE (it cannot win on time, but a bad value is never traded down)",
    buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [...rest, olderUtc, unparseable])
      .deviceCompliance === "non_compliant",
  );
  check(
    "v8b/F-A: a SOLE illegible reading may not VOUCH — an affirmative-good value with an unorderable stamp reads 'unknown'",
    buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [...rest, unparseableGood])
      .deviceCompliance === "unknown",
  );
  check(
    "v8b/F-A: a SOLE illegible reading may still ACCUSE — a bad value with an unorderable stamp is kept, and the decision it drives is the same one the legible reading drives",
    buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [...rest, unparseable])
      .deviceCompliance === "non_compliant",
  );
  check(
    "v8b: ordering is otherwise unchanged — the genuinely newer UTC reading still wins",
    buildEvidence(identityFor("enabled"), device, workflowFor("standard"), [...rest, olderUtc, newerUtc])
      .deviceCompliance === "non_compliant",
  );

  // ── V9: a plan cannot report itself resolvable on silence ─────────────────
  //
  // `buildResolutionPlan` skips a reason code with no descriptor, so a block it
  // has no answer for left no trace: the DENY below reported `path:
  // "self_service"` before this change. The unanswered codes are now carried.
  const silentDeny = {
    id: "dec_v9",
    tenantId: "tenant_northwind",
    outcome: "deny" as const,
    reasonCodes: ["A_CODE_WITH_NO_DESCRIPTOR", "ANOTHER_CODE_WITH_NO_DESCRIPTOR"],
    matchedRules: [],
  } as unknown as Decision;
  const silentPlan = buildResolutionPlan(silentDeny, {
    tenantId: "tenant_northwind",
    primaryHardwareChannel: "device_prompt",
    autoProposeEnabled: true,
  });
  check(
    "v9: a deny of ONLY descriptor-less codes is NOT auto-resolvable and is NOT self-service",
    silentPlan.autoResolvable === false && silentPlan.path === "escalation",
    `auto=${silentPlan.autoResolvable} path=${silentPlan.path}`,
  );
  check(
    "v9: …and it NAMES the codes it could not answer rather than dropping them",
    silentPlan.unresolvedCodes.length === 2 &&
      silentPlan.unresolvedCodes.includes("A_CODE_WITH_NO_DESCRIPTOR") &&
      silentPlan.summaryForOperator.includes("A_CODE_WITH_NO_DESCRIPTOR"),
    `unresolved=[${silentPlan.unresolvedCodes.join(", ")}]`,
  );
  // The converse, so the rule above is not simply "every plan escalates": a real
  // decision whose codes all have descriptors is unaffected, and an affirmative
  // code contributed by an ALLOW rule (TRUST_ESTABLISHED rides along on most
  // restrict/step_up decisions) is not an unanswered block.
  const staleDecision = decisions[scenarios.findIndex((s) => s.label === "stale-step-up")];
  const stalePlan = buildResolutionPlan(staleDecision, {
    tenantId: "tenant_northwind",
    primaryHardwareChannel: "device_prompt",
    autoProposeEnabled: true,
  });
  check(
    "v9: a described block still reports self-service and carries no unresolved codes",
    stalePlan.path === "self_service" &&
      stalePlan.autoResolvable === true &&
      stalePlan.unresolvedCodes.length === 0,
    `path=${stalePlan.path} unresolved=[${stalePlan.unresolvedCodes.join(", ")}]`,
  );
  const custodyDecision = decisions[scenarios.findIndex((s) => s.label === "custody-overdue-restrict")];
  check(
    "v9: TRUST_ESTABLISHED (contributed by an ALLOW rule, no descriptor) is NOT counted as an unanswered block",
    custodyDecision.reasonCodes.includes("TRUST_ESTABLISHED") &&
      buildResolutionPlan(custodyDecision, {
        tenantId: "tenant_northwind",
        primaryHardwareChannel: "device_prompt",
        autoProposeEnabled: true,
      }).unresolvedCodes.length === 0,
  );
}

// ── 21. Review findings F1–F3 (2026-09-02): an ILLEGIBLE reading, a bogus
//        freshness arriving at the exported boundary, and one reason code two
//        rules share ────────────────────────────────────────────────────────
//
// F1 is the one that blocked the batch, and it is worth stating as a rule rather
// than as a case: AN UNORDERABLE TIMESTAMP MUST NEVER ERASE A READING. The first
// cut of `groupLatest` dropped a signal whose `observedAt` would not parse, which
// for the dock family meant `readDockEvidenceFreshness` fell through to "missing"
// — the one freshness `deriveCriticalSignalsPresent` deliberately does not
// disqualify — so a dock that ANSWERED "stale" with a broken clock stamp was
// treated better than one that answered "stale" with a good one. Measured, both
// directions, on the real functions: the four dock vectors below.
{
  const identity: Identity = {
    id: "id_f1",
    tenantId: "tenant_northwind",
    externalRef: "nurse.f1",
    displayName: "Nurse",
    state: "enabled",
    assignedRole: "nurse",
  };
  const device: Device = {
    id: "dev_f1",
    tenantId: "tenant_northwind",
    externalRef: "ipad-f1",
    name: "Ward iPad",
    osPlatform: "iPadOS",
    osVersion: "18.5",
    ownerType: "shared",
    managementAgent: "intune",
  };
  const workflow: Workflow = {
    id: "wf_f1",
    tenantId: "tenant_northwind",
    key: "clinical-session",
    name: "Clinical session",
    riskTier: "standard",
  };
  const VALID_AT = "2026-07-13T13:00:00.000Z";
  const ILLEGIBLE_AT = "not-a-date";
  const sig = (
    category: SignalCategory,
    value: NormalizedSignal["value"],
    extra: Partial<NormalizedSignal> = {},
  ): NormalizedSignal => ({
    id: `sig_f1_${category}`,
    tenantId: "tenant_northwind",
    connectorId: "conn",
    subjectType: "device",
    subjectId: device.id,
    category,
    value,
    observedAt: VALID_AT,
    freshness: "fresh",
    sourceReference: "fixture:f1",
    ...extra,
  });
  const healthy: NormalizedSignal[] = [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("device_encryption", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
  ];
  const v1 = {
    id: "pv_f1",
    tenantId: "tenant_northwind",
    policyId: "pol_f1",
    version: 1,
    status: "active" as const,
    rules: SHARED_DEVICE_RULES_V1,
    createdAt: VALID_AT,
    digest: "test",
  };
  const outcomeFor = (signals: NormalizedSignal[]) => {
    const evidence = buildEvidence(identity, device, workflow, signals);
    const evaluation = evaluatePolicy(v1, evidence);
    return { evidence, outcome: evaluation.outcome, codes: evaluation.reasonCodes };
  };

  // The four dock vectors, as a table. The FIRST is the deliberate exemption —
  // no dock at all is a deployment shape — and it is asserted here so the other
  // three cannot be read as "everything dock-shaped steps up".
  const dockVectors: [string, NormalizedSignal[], Freshness, DecisionOutcome][] = [
    ["dock signal VANISHED (no dock reading at all)", healthy, "missing", "allow"],
    [
      "dock STALE with a valid observedAt",
      [...healthy, sig("custody_state", "checked_in", { freshness: "stale" })],
      "stale",
      "step_up",
    ],
    [
      "dock STALE with observedAt='not-a-date' (F1)",
      [...healthy, sig("custody_state", "checked_in", { freshness: "stale", observedAt: ILLEGIBLE_AT })],
      "stale",
      "step_up",
    ],
    [
      "dock EXPIRED with observedAt='not-a-date' (F1)",
      [...healthy, sig("custody_state", "checked_in", { freshness: "expired", observedAt: ILLEGIBLE_AT })],
      "expired",
      "step_up",
    ],
  ];
  for (const [label, signals, wantFreshness, wantOutcome] of dockVectors) {
    const { evidence, outcome } = outcomeFor(signals);
    check(
      `f1 dock vector — ${label}: dockEvidenceFreshness=${wantFreshness}, ${wantOutcome.toUpperCase()}`,
      evidence.dockEvidenceFreshness === wantFreshness && outcome === wantOutcome,
      `got dockEvidenceFreshness=${evidence.dockEvidenceFreshness} outcome=${outcome}`,
    );
  }
  check(
    "f1: a dock reading that EXISTS is never reported as 'missing' merely because nothing can order its timestamp — absence and illegibility are different answers",
    outcomeFor([
      ...healthy,
      sig("custody_state", "checked_in", { freshness: "stale", observedAt: ILLEGIBLE_AT }),
    ]).evidence.dockEvidenceFreshness !== "missing",
  );
  // The same rule on the posture channel: the reading is retained, but nothing
  // about it is trusted as current.
  const posture = outcomeFor([
    ...healthy.filter((s) => s.category !== "posture_freshness"),
    sig("posture_freshness", "fresh", { observedAt: ILLEGIBLE_AT }),
  ]);
  check(
    "f1: a SOLE posture reading with an unorderable observedAt is not 'fresh' — it reads 'unknown' (illegible), critical evidence is absent, and the outcome is not allow",
    posture.evidence.postureFreshness === "unknown" &&
      posture.evidence.criticalSignalsPresent === false &&
      posture.outcome !== "allow",
    `postureFreshness=${posture.evidence.postureFreshness} crit=${posture.evidence.criticalSignalsPresent} outcome=${posture.outcome}`,
  );
  // An illegible sibling cannot win on TIME — shown with the illegible reading
  // carrying the better value, which is the only direction in which winning on
  // time is distinguishable from winning on badness (see the F-A pair below).
  check(
    "f1: an illegible reading never OUTRANKS a parseable sibling — the orderable one is still latest, in either array order",
    buildEvidence(identity, device, workflow, [
      ...healthy.filter((s) => s.category !== "device_compliance"),
      sig("device_compliance", "non_compliant", { id: "sig_f1_bad", observedAt: VALID_AT }),
      sig("device_compliance", "compliant", { id: "sig_f1_ok", observedAt: ILLEGIBLE_AT }),
    ]).deviceCompliance === "non_compliant" &&
      buildEvidence(identity, device, workflow, [
        ...healthy.filter((s) => s.category !== "device_compliance"),
        sig("device_compliance", "compliant", { id: "sig_f1_ok", observedAt: ILLEGIBLE_AT }),
        sig("device_compliance", "non_compliant", { id: "sig_f1_bad", observedAt: VALID_AT }),
      ]).deviceCompliance === "non_compliant",
  );
  check(
    "f1/F-A: …and an illegible sibling whose value is WORSE than the parseable latest wins on VALUE, in either array order — worst-wins, the freshness rule applied to values",
    buildEvidence(identity, device, workflow, [
      ...healthy.filter((s) => s.category !== "device_compliance"),
      sig("device_compliance", "compliant", { id: "sig_f1_ok", observedAt: VALID_AT }),
      sig("device_compliance", "non_compliant", { id: "sig_f1_bad", observedAt: ILLEGIBLE_AT }),
    ]).deviceCompliance === "non_compliant" &&
      buildEvidence(identity, device, workflow, [
        ...healthy.filter((s) => s.category !== "device_compliance"),
        sig("device_compliance", "non_compliant", { id: "sig_f1_bad", observedAt: ILLEGIBLE_AT }),
        sig("device_compliance", "compliant", { id: "sig_f1_ok", observedAt: VALID_AT }),
      ]).deviceCompliance === "non_compliant",
  );

  // ── F-A (second review, 2026-09-02): AN ILLEGIBLE READING MAY ACCUSE ──────
  //
  // The first repair answered "unknown" for every present-but-illegible reading.
  // For a GOOD value that is correct — a reading nothing can place in time may
  // not vouch. For a BAD value it was a fail-OPEN regression against HEAD: the
  // corruption BOUGHT leniency. Each row below was measured on HEAD before the
  // fix, and HEAD's verdict is the expectation: an unorderable timestamp must not
  // change the answer a bad value gives. Every row is paired with its LEGIBLE
  // control, so a row that passed because the vector never fired is visible.
  const faVectors: [string, NormalizedSignal[], DecisionOutcome, string][] = [
    [
      "tamper_state=confirmed, sole illegible reading",
      [...healthy, sig("tamper_state", "confirmed", { observedAt: ILLEGIBLE_AT })],
      "deny",
      "TAMPER_CONFIRMED",
    ],
    [
      "badge_binding=forced, sole illegible reading",
      [...healthy, sig("badge_binding", "forced", { observedAt: ILLEGIBLE_AT })],
      "deny",
      "BADGE_FORCED_REMOVAL",
    ],
    [
      "device_compliance=non_compliant, sole illegible reading",
      [
        ...healthy.filter((s) => s.category !== "device_compliance"),
        sig("device_compliance", "non_compliant", { observedAt: ILLEGIBLE_AT }),
      ],
      "restrict",
      "DEVICE_NONCOMPLIANT",
    ],
    [
      "device_management=false, sole illegible reading",
      [
        ...healthy.filter((s) => s.category !== "device_management"),
        sig("device_management", false, { observedAt: ILLEGIBLE_AT }),
      ],
      "restrict",
      "DEVICE_UNMANAGED",
    ],
    [
      "tamper_state=confirmed illegible WITH a parseable, fresh dock_state sibling",
      [
        ...healthy,
        sig("tamper_state", "confirmed", { observedAt: ILLEGIBLE_AT }),
        sig("dock_state", "occupied", { id: "sig_f1_dock_sibling" }),
      ],
      "deny",
      "TAMPER_CONFIRMED",
    ],
  ];
  for (const [label, signals, wantOutcome, wantCode] of faVectors) {
    const corrupted = outcomeFor(signals);
    const legible = outcomeFor(
      signals.map((sg) => (sg.observedAt === ILLEGIBLE_AT ? { ...sg, observedAt: VALID_AT } : sg)),
    );
    check(
      `f-a: ${label} — still ${wantOutcome.toUpperCase()} [${wantCode}], exactly as HEAD decided it`,
      corrupted.outcome === wantOutcome &&
        evaluatePolicy(v1, corrupted.evidence).reasonCodes.includes(wantCode),
      `got ${corrupted.outcome} [${evaluatePolicy(v1, corrupted.evidence).reasonCodes.join(", ")}]`,
    );
    check(
      `f-a control: ${label} with a LEGIBLE timestamp decides the same way — the vector fires for its VALUE, not for its stamp`,
      legible.outcome === wantOutcome &&
        evaluatePolicy(v1, legible.evidence).reasonCodes.includes(wantCode),
      `got ${legible.outcome} [${evaluatePolicy(v1, legible.evidence).reasonCodes.join(", ")}]`,
    );
  }
  // The other half of the rule, and the half the first repair got right: a GOOD
  // value with an unorderable stamp may not vouch for itself.
  const goodIllegible = outcomeFor([
    ...healthy,
    sig("tamper_state", "none", { observedAt: ILLEGIBLE_AT }),
  ]);
  check(
    "f-a: an affirmative-GOOD value with an unorderable stamp is downgraded — tamper_state 'none' reads 'unknown', not 'none', and the decision does not reach allow",
    goodIllegible.evidence.tamperState === "unknown" && goodIllegible.outcome !== "allow",
    `tamperState=${goodIllegible.evidence.tamperState} outcome=${goodIllegible.outcome}`,
  );
  check(
    "f-a control: the same reading with a LEGIBLE stamp really does read 'none' and really does allow — so the downgrade above is attributable to the stamp",
    outcomeFor([...healthy, sig("tamper_state", "none")]).evidence.tamperState === "none" &&
      outcomeFor([...healthy, sig("tamper_state", "none")]).outcome === "allow",
  );

  // ── F-1 (third review, 2026-09-02): WORST-WINS AMONG ILLEGIBLE PEERS ───────
  //
  // PRE-EXISTING, not introduced by this batch, and it defeated the invariant the
  // batch states. `groupLatest` kept the FIRST illegible reading per category and
  // dropped every other one, so among readings that nothing can order by time,
  // ARRAY ORDER decided the answer — and it decided it in the fail-open direction.
  //
  // Every row was measured through buildEvidence → evaluatePolicy(SHARED_DEVICE_RULES_V1)
  // with everything else healthy, on the code BEFORE the fold; the arrow is what
  // that code returned versus what it must return:
  //
  //   D  legible "none" latest + illegible "confirmed"            deny            (unchanged)
  //   E  D plus one extra illegible "none" placed FIRST           allow   → deny
  //   B  illegible "none" first, illegible "confirmed" second     step_up → deny
  //   G  illegible identity `true` first, illegible `false`       allow   → deny
  //
  // E IS THE WHOLE FINDING IN ONE ROW: adding a signal moved DENY to ALLOW. B is
  // the same defect with no parseable sibling at all, and G shows it is not a
  // tamper quirk — the identity family loses a revocation the same way.
  //
  // Each row is paired with a CONTROL that reverses the order of the illegible
  // peers and demands the identical answer. Worst-wins is order-independent by
  // construction; first-wins is not, so the control fails on the old code even
  // where the row itself might not.
  const peerVectors: [string, NormalizedSignal[], keyof DecisionEvidence, string, DecisionOutcome, string][] = [
    [
      "D: legible tamper 'none' is latest, an illegible 'confirmed' accuses",
      [
        ...healthy,
        sig("tamper_state", "none", { id: "sig_f1_peer_d_ok" }),
        sig("tamper_state", "confirmed", { id: "sig_f1_peer_d_bad", observedAt: ILLEGIBLE_AT }),
      ],
      "tamperState",
      "confirmed",
      "deny",
      "TAMPER_CONFIRMED",
    ],
    [
      "E: D plus a SECOND illegible 'none' ahead of the accusation — one added signal, nothing removed",
      [
        ...healthy,
        sig("tamper_state", "none", { id: "sig_f1_peer_e_extra", observedAt: ILLEGIBLE_AT }),
        sig("tamper_state", "confirmed", { id: "sig_f1_peer_e_bad", observedAt: ILLEGIBLE_AT }),
        sig("tamper_state", "none", { id: "sig_f1_peer_e_ok" }),
      ],
      "tamperState",
      "confirmed",
      "deny",
      "TAMPER_CONFIRMED",
    ],
    [
      "B: two illegible tamper readings and no parseable one — 'none' first, 'confirmed' second",
      [
        ...healthy,
        sig("tamper_state", "none", { id: "sig_f1_peer_b_ok", observedAt: ILLEGIBLE_AT }),
        sig("tamper_state", "confirmed", { id: "sig_f1_peer_b_bad", observedAt: ILLEGIBLE_AT }),
      ],
      "tamperState",
      "confirmed",
      "deny",
      "TAMPER_CONFIRMED",
    ],
    [
      "G: two illegible identity readings — `true` first, `false` second; a revocation is not outvoted by arriving second",
      [
        ...healthy,
        sig("identity_state", true, { id: "sig_f1_peer_g_ok", observedAt: ILLEGIBLE_AT }),
        sig("identity_state", false, { id: "sig_f1_peer_g_bad", observedAt: ILLEGIBLE_AT }),
      ],
      "identityEnabled",
      "false",
      "deny",
      "IDENTITY_DISABLED",
    ],
  ];
  for (const [label, signals, field, wantValue, wantOutcome, wantCode] of peerVectors) {
    const result = outcomeFor(signals);
    check(
      `f-1: ${label} — ${field}=${wantValue}, ${wantOutcome.toUpperCase()} [${wantCode}]`,
      String(result.evidence[field]) === wantValue &&
        result.outcome === wantOutcome &&
        result.codes.includes(wantCode),
      `${field}=${String(result.evidence[field])} outcome=${result.outcome} [${result.codes.join(", ")}]`,
    );
    // The control: reverse the illegible peers. Nothing can order them by time, so
    // the answer must not depend on which one arrived first — in EITHER direction.
    const illegible = signals.filter((sg) => sg.observedAt === ILLEGIBLE_AT);
    const reversed = [
      ...signals.filter((sg) => sg.observedAt !== ILLEGIBLE_AT),
      ...[...illegible].reverse(),
    ];
    const control = outcomeFor(reversed);
    check(
      `f-1 control: ${label} — reversing the illegible peers changes nothing (${field}=${wantValue}, ${wantOutcome.toUpperCase()}); worst-wins is order-independent, first-wins is not`,
      String(control.evidence[field]) === wantValue &&
        control.outcome === wantOutcome &&
        control.codes.includes(wantCode),
      `${field}=${String(control.evidence[field])} outcome=${control.outcome} [${control.codes.join(", ")}]`,
    );
  }
  // And the other half of the rule survives the fold: several illegible peers that
  // ALL vouch still may not vouch. Worst-wins never invents an accusation either.
  const allGoodPeers = outcomeFor([
    ...healthy,
    sig("tamper_state", "none", { id: "sig_f1_peer_h1", observedAt: ILLEGIBLE_AT }),
    sig("tamper_state", "none", { id: "sig_f1_peer_h2", observedAt: ILLEGIBLE_AT }),
  ]);
  check(
    "f-1: two illegible readings that both say 'none' still cannot vouch — tamperState reads 'unknown' and the decision does not reach allow",
    allGoodPeers.evidence.tamperState === "unknown" && allGoodPeers.outcome !== "allow",
    `tamperState=${allGoodPeers.evidence.tamperState} outcome=${allGoodPeers.outcome}`,
  );

  // ── The lexical-ordering pair: what this batch fixes versus HEAD ───────────
  //
  // Both rows below ALLOWED at HEAD, because "latest" was a string compare: an
  // offset stamp and an unparseable one each sort above a UTC "2026-…" string and
  // each carried `fresh`, so the true latest reading — which said `stale` — was
  // overwritten. These are the two rows the docs table cites.
  const lexicalPair: [string, NormalizedSignal][] = [
    [
      "an offset stamp (09:00+02:00 = 07:00Z, EARLIER than the 08:00Z reading)",
      sig("posture_freshness", "fresh", { id: "sig_lex_off", observedAt: "2026-07-13T09:00:00+02:00" }),
    ],
    [
      "an unparseable stamp",
      sig("posture_freshness", "fresh", { id: "sig_lex_bad", observedAt: ILLEGIBLE_AT }),
    ],
  ];
  for (const [label, sibling] of lexicalPair) {
    const result = outcomeFor([
      ...healthy.filter((s) => s.category !== "posture_freshness"),
      sig("posture_freshness", "stale", { id: "sig_lex_true", observedAt: "2026-07-13T08:00:00.000Z" }),
      sibling,
    ]);
    check(
      `f-a/V8b: a 'fresh' sibling carrying ${label} no longer beats the true latest 'stale' reading — postureFreshness=stale, STEP_UP [POSTURE_STALE] (HEAD: allow)`,
      result.evidence.postureFreshness === "stale" &&
        result.outcome === "step_up" &&
        result.codes.includes("POSTURE_STALE"),
      `postureFreshness=${result.evidence.postureFreshness} outcome=${result.outcome} [${result.codes.join(", ")}]`,
    );
  }

  // ── F2: junk arriving at the EXPORTED boundary ────────────────────────────
  //
  // `deriveCriticalSignalsPresent` is exported and `resolution.ts` calls it on a
  // DecisionEvidence its caller supplied. The fields are typed; a durable row cast
  // with an unchecked `as` is not.
  const healthyEvidence = buildEvidence(identity, device, workflow, healthy);
  check(
    "f2 control: the unaltered healthy evidence DOES have critical signals present (so a flip below is attributable to the injection)",
    deriveCriticalSignalsPresent(healthyEvidence) === true,
  );
  const junk: unknown[] = ["totally-bogus", "", null, undefined, 7, "FRESH"];
  for (const field of ["postureFreshness", "dockEvidenceFreshness"] as const) {
    const survivors = junk.filter((value) =>
      deriveCriticalSignalsPresent({
        ...healthyEvidence,
        [field]: value,
      } as unknown as Omit<DecisionEvidence, "criticalSignalsPresent">),
    );
    check(
      `f2: an out-of-union ${field} at the DecisionEvidence boundary reads as "unknown", never as good — all ${junk.length} injected values yield criticalSignalsPresent=false`,
      survivors.length === 0,
      `values that still passed the backstop: ${survivors.map((v) => (v === undefined ? "undefined" : JSON.stringify(v))).join(", ")}`,
    );
  }

  // ── F3: one reason code, two rules, two outcomes ──────────────────────────
  //
  // Reason codes are not unique to a rule — `policy.ts` pushes `rule.reasonCode`
  // verbatim and `validatePolicyRules` only requires unique rule IDs — so
  // excluding a code from `unresolvedCodes` by its NAME let one allow rule
  // anywhere in the version disappear a deny's own unanswerable block. The
  // exclusion is now keyed on the contributing rule's outcome. Built through the
  // REAL validator and the REAL evaluator, not hand-assembled.
  const SHARED = "SHARED_UNDESCRIBED_CODE";
  const sharedCodeVersion = {
    ...v1,
    id: "pv_f3",
    rules: validatePolicyRules([
      {
        id: "allow-side-shared-code",
        description: "An allow rule carrying the shared code.",
        match: [{ field: "ownerType", in: ["shared"] }],
        outcome: "allow",
        reasonCode: SHARED,
        severity: "low",
      },
      {
        id: "deny-side-shared-code",
        description: "A deny rule carrying the SAME code.",
        match: [{ field: "workflowRiskTier", in: ["standard"] }],
        outcome: "deny",
        reasonCode: SHARED,
        severity: "critical",
      },
    ]),
  };
  const sharedEval = evaluatePolicy(sharedCodeVersion, healthyEvidence);
  check(
    "f3 setup: both rules really fired, on one code, with two different outcomes",
    sharedEval.outcome === "deny" &&
      sharedEval.reasonCodes.filter((c) => c === SHARED).length === 1 &&
      sharedEval.matchedRules.filter((r) => r.reasonCode === SHARED).length === 2 &&
      sharedEval.matchedRules.some((r) => r.outcome === "allow") &&
      sharedEval.matchedRules.some((r) => r.outcome === "deny"),
    `${sharedEval.outcome} matched=${sharedEval.matchedRules.map((r) => `${r.ruleId}:${r.outcome}`).join(", ")}`,
  );
  const sharedPlan = buildResolutionPlan(
    {
      id: "dec_f3",
      tenantId: "tenant_northwind",
      outcome: sharedEval.outcome,
      reasonCodes: sharedEval.reasonCodes,
      matchedRules: sharedEval.matchedRules,
    } as unknown as Decision,
    {
      tenantId: "tenant_northwind",
      primaryHardwareChannel: "device_prompt",
      autoProposeEnabled: true,
    },
  );
  check(
    "f3: a descriptor-less code carried by BOTH an allow rule and a deny rule stays in unresolvedCodes — one allow contributor does not clear a deny's block",
    sharedPlan.unresolvedCodes.includes(SHARED) &&
      sharedPlan.path === "escalation" &&
      sharedPlan.autoResolvable === false &&
      sharedPlan.summaryForOperator.includes(SHARED),
    `unresolved=[${sharedPlan.unresolvedCodes.join(", ")}] path=${sharedPlan.path} auto=${sharedPlan.autoResolvable}`,
  );
}

// ── 22. MONOTONICITY of criticalSignalsPresent — the general form of F1 ──────
//
// F1 was one cell of a table nobody had drawn: a dock reading whose timestamp
// would not parse RAISED assurance (step_up → allow) because the corruption
// routed the field to the single freshness value the backstop does not
// disqualify. The specific vectors are asserted above; this is the sweep that
// would have caught it without knowing to look.
//
// THE INVARIANT: corrupting an input never raises `criticalSignalsPresent`. For
// every field that feeds the backstop, for every member of that field's union,
// degrading the reading — an `observedAt` nothing can order, or the signal gone
// entirely — must leave the verdict where it was or lower it. Never higher.
//
// SCOPE IS DERIVED, not listed: the set of fields that can change the backstop's
// answer is probed out of the real function below, and the sweep must cover
// exactly that set — add a field to the ladder without adding a row here and this
// proof fails rather than quietly testing six of seven fields.
//
// ONE EXEMPTION, declared by name with its reason and STALE-CHECKED: an absent
// dock raises, deliberately. It is asserted to still be a real raise, so the day
// that stops being true the exemption fails instead of hiding the next one.
const monotonicityTable: string[] = [];
{
  const identity: Identity = {
    id: "id_mono",
    tenantId: "tenant_northwind",
    externalRef: "nurse.mono",
    displayName: "Nurse",
    state: "enabled",
    assignedRole: "nurse",
  };
  const device: Device = {
    id: "dev_mono",
    tenantId: "tenant_northwind",
    externalRef: "ipad-mono",
    name: "Ward iPad",
    osPlatform: "iPadOS",
    osVersion: "18.5",
    ownerType: "shared",
    managementAgent: "intune",
  };
  const workflow: Workflow = {
    id: "wf_mono",
    tenantId: "tenant_northwind",
    key: "clinical-session",
    name: "Clinical session",
    riskTier: "standard",
  };
  const VALID_AT = "2026-07-13T13:00:00.000Z";
  const ILLEGIBLE_AT = "not-a-date";
  const sig = (
    category: SignalCategory,
    value: NormalizedSignal["value"],
    extra: Partial<NormalizedSignal> = {},
  ): NormalizedSignal => ({
    id: `sig_mono_${category}`,
    tenantId: "tenant_northwind",
    connectorId: "conn",
    subjectType: "device",
    subjectId: device.id,
    category,
    value,
    observedAt: VALID_AT,
    freshness: "fresh",
    sourceReference: "fixture:mono",
    ...extra,
  });
  const healthy: NormalizedSignal[] = [
    sig("device_compliance", "compliant"),
    sig("device_management", true),
    sig("device_encryption", true),
    sig("os_support", true),
    sig("posture_freshness", "fresh"),
  ];
  const healthyEvidence = buildEvidence(identity, device, workflow, healthy);
  // The live v1 rule set, so the verdict dimension below is measured through the
  // REAL evaluator on the REAL shipped rules, not on a rule set written to pass.
  const monoV1 = {
    id: "pv_mono",
    tenantId: "tenant_northwind",
    policyId: "pol_mono",
    version: 1,
    status: "active" as const,
    rules: SHARED_DEVICE_RULES_V1,
    createdAt: VALID_AT,
    digest: "test",
  };

  // (a) WHICH FIELDS FEED THE BACKSTOP — probed, not declared. Any field whose
  // substitution can flip the real function's answer is in scope.
  //
  // THE PROBE SET IS DERIVED (second-review finding F-C, 2026-09-02). It used to
  // be `[true, false, "unknown", ...FRESHNESS_VALUES]` — a hand-list that contains
  // no ownership member, no tamper member and no badge member, so a disqualifying
  // clause planted on any of those fields was invisible to it. Three were planted
  // into `deriveCriticalSignalsPresent` and all three passed 322/322:
  // `ownerType !== "personal"`, `tamperState !== "confirmed"`,
  // `badgeBinding !== "forced"`. `EVIDENCE_VALUE_MEMBERS` is the union of every
  // domain the evidence readers themselves consume plus the two subject-derived
  // unions, so a family added to the core is probed here without anyone editing
  // this file.
  const PROBES: unknown[] = [...EVIDENCE_VALUE_MEMBERS];
  const PROBE_FLOOR = 30;
  check(
    `22 probe set is DERIVED and covers the disqualifying members a hand-list missed — ${PROBES.length} probes (floor ${PROBE_FLOOR}), including "personal", "confirmed", "forced"`,
    PROBES.length >= PROBE_FLOOR &&
      ["personal", "confirmed", "forced", "non_compliant", "withheld", "broken", false].every((m) =>
        PROBES.includes(m),
      ),
    `probes=[${PROBES.map((v) => String(v)).join(", ")}]`,
  );
  const feedingFields = (Object.keys(healthyEvidence) as (keyof DecisionEvidence)[])
    .filter(
      (key) =>
        key !== "criticalSignalsPresent" &&
        PROBES.some(
          (probe) =>
            !deriveCriticalSignalsPresent({
              ...healthyEvidence,
              [key]: probe,
            } as unknown as Omit<DecisionEvidence, "criticalSignalsPresent">),
        ),
    )
    .sort();

  type Member = string | boolean;
  interface MonoField {
    field: keyof DecisionEvidence;
    /** The signal category whose reading this field is derived from. */
    category: SignalCategory;
    /**
     * The value domain this field is read through — THE SAME OBJECT the evidence
     * readers consume (`EVIDENCE_VALUE_DOMAINS`). Both the swept members and the
     * family's affirmative-good member are read from it, so a member added to the
     * core, or a change to what the core counts as good, is swept here without
     * anyone editing this file. It used to be a hand-copied `members:` array on
     * four of these rows; a hand-maintained copy of something the core already
     * knows is the fossil this repo keeps finding.
     */
    domain: { readonly members: readonly Member[]; readonly good: readonly Member[] };
    reading: (member: Member, observedAt: string) => NormalizedSignal;
  }
  /** The family's affirmative-good member, derived — never named here. */
  const goodOf = (f: MonoField): Member => f.domain.good[0];
  // Every row's members come from `EVIDENCE_VALUE_DOMAINS`, and the freshness
  // domain's members are FRESHNESS_VALUES — derived in turn from the exhaustive
  // `Record<Freshness, number>` severity map in evidence.ts. Add a member to any
  // union and it is swept here without anyone editing this file.
  const MONO_FIELDS: MonoField[] = [
    {
      field: "identityEnabled",
      category: "identity_state",
      domain: EVIDENCE_VALUE_DOMAINS.boolean,
      reading: (m, at) => sig("identity_state", m as boolean, { observedAt: at }),
    },
    {
      field: "deviceCompliance",
      category: "device_compliance",
      domain: EVIDENCE_VALUE_DOMAINS.compliance,
      reading: (m, at) => sig("device_compliance", m as string, { observedAt: at }),
    },
    {
      field: "deviceManaged",
      category: "device_management",
      domain: EVIDENCE_VALUE_DOMAINS.boolean,
      reading: (m, at) => sig("device_management", m as boolean, { observedAt: at }),
    },
    {
      field: "deviceEncrypted",
      category: "device_encryption",
      domain: EVIDENCE_VALUE_DOMAINS.boolean,
      reading: (m, at) => sig("device_encryption", m as boolean, { observedAt: at }),
    },
    {
      field: "osSupported",
      category: "os_support",
      domain: EVIDENCE_VALUE_DOMAINS.boolean,
      reading: (m, at) => sig("os_support", m as boolean, { observedAt: at }),
    },
    {
      field: "postureFreshness",
      category: "posture_freshness",
      domain: EVIDENCE_VALUE_DOMAINS.freshness,
      reading: (m, at) => sig("posture_freshness", m as string, { observedAt: at }),
    },
    {
      field: "dockEvidenceFreshness",
      category: "custody_state",
      domain: EVIDENCE_VALUE_DOMAINS.freshness,
      reading: (m, at) =>
        sig("custody_state", "checked_in", { observedAt: at, freshness: m as Freshness }),
    },
    // ── The families the VERDICT dimension pulled into scope ──────────────────
    //
    // None of these feed `criticalSignalsPresent`, so a sweep of the backstop
    // alone never touched them — and each one carries a rule that can deny or
    // restrict, which is precisely where a corruption-bought loosening hurts.
    // Their members come from `EVIDENCE_VALUE_DOMAINS`, the same object the
    // evidence readers consume, so a member added to the core is swept here
    // without anyone editing this file.
    {
      field: "custodyState",
      category: "custody_state",
      domain: EVIDENCE_VALUE_DOMAINS.custody,
      reading: (m, at) => sig("custody_state", m as string, { observedAt: at }),
    },
    {
      field: "dockChargeState",
      category: "charge_state",
      domain: EVIDENCE_VALUE_DOMAINS.charge,
      reading: (m, at) => sig("charge_state", m as string, { observedAt: at }),
    },
    {
      field: "batteryHealth",
      category: "battery_health",
      domain: EVIDENCE_VALUE_DOMAINS.batteryHealth,
      reading: (m, at) => sig("battery_health", m as string, { observedAt: at }),
    },
    {
      field: "tamperState",
      category: "tamper_state",
      domain: EVIDENCE_VALUE_DOMAINS.tamper,
      reading: (m, at) => sig("tamper_state", m as string, { observedAt: at }),
    },
    {
      field: "dockState",
      category: "dock_state",
      domain: EVIDENCE_VALUE_DOMAINS.dock,
      reading: (m, at) => sig("dock_state", m as string, { observedAt: at }),
    },
    {
      field: "baselineCompliance",
      category: "security_baseline",
      domain: EVIDENCE_VALUE_DOMAINS.baseline,
      reading: (m, at) => sig("security_baseline", m as string, { observedAt: at }),
    },
    {
      field: "benchmarkSelection",
      category: "benchmark_selection",
      domain: EVIDENCE_VALUE_DOMAINS.benchmarkSelection,
      reading: (m, at) => sig("benchmark_selection", m as string, { observedAt: at }),
    },
    {
      field: "shiftContext",
      category: "shift_context",
      domain: EVIDENCE_VALUE_DOMAINS.shiftContext,
      reading: (m, at) => sig("shift_context", m as string, { observedAt: at }),
    },
    {
      field: "badgeBinding",
      category: "badge_binding",
      domain: EVIDENCE_VALUE_DOMAINS.badge,
      reading: (m, at) => sig("badge_binding", m as string, { observedAt: at }),
    },
    {
      field: "managementHealthState",
      category: "device_management_health",
      domain: EVIDENCE_VALUE_DOMAINS.managementHealth,
      reading: (m, at) => sig("device_management_health", m as string, { observedAt: at }),
    },
    {
      field: "localAuthorityState",
      category: "local_authority",
      domain: EVIDENCE_VALUE_DOMAINS.localAuthority,
      reading: (m, at) => sig("local_authority", m as string, { observedAt: at }),
    },
  ];

  // Scope for the VERDICT dimension is derived the same way, through the REAL
  // evaluator: any field whose substitution can change the outcome is in scope.
  // This is what pulled eleven rule-carrying families in that a backstop-only
  // sweep never saw.
  const baselineOutcome = evaluatePolicy(monoV1, healthyEvidence).outcome;
  const verdictFields = (Object.keys(healthyEvidence) as (keyof DecisionEvidence)[]).filter((key) =>
    PROBES.some(
      (probe) =>
        evaluatePolicy(monoV1, {
          ...healthyEvidence,
          [key]: probe,
        } as unknown as DecisionEvidence).outcome !== baselineOutcome,
    ),
  );
  // Two fields are in that derived set but cannot be swept by these mutations,
  // and they are named rather than silently dropped: they are NOT read from a
  // signal at all — they come from the resolved device and workflow rows — so
  // "the signal is absent" and "the signal's stamp is unorderable" are not states
  // they can be in. `criticalSignalsPresent` is the sweep's own output, not an
  // input. Rule coverage for all three lives in section 20's rule-arm table.
  const NOT_SIGNAL_DERIVED: (keyof DecisionEvidence)[] = [
    "ownerType",
    "workflowRiskTier",
    "criticalSignalsPresent",
  ];
  const inScope = [...new Set([...feedingFields, ...verdictFields])]
    .filter((f) => !NOT_SIGNAL_DERIVED.includes(f))
    .sort();
  check(
    "22 scope is DERIVED: the swept fields are exactly the signal-derived fields that can change deriveCriticalSignalsPresent OR the verdict under the live v1 rules",
    JSON.stringify(MONO_FIELDS.map((f) => f.field).sort()) === JSON.stringify(inScope),
    `swept=[${MONO_FIELDS.map((f) => f.field).sort().join(", ")}] derived=[${inScope.join(", ")}]`,
  );
  // THE BACKSTOP'S OWN SCOPE IS PINNED, not merely covered. The sweep can only
  // mutate signal-derived fields, so a field the ladder starts gating on that no
  // signal produces — `ownerType` was the planted example, and it passed 429/429
  // undetected until this check existed — would otherwise change the backstop's
  // meaning invisibly. The derived side of this comparison is the fact; the
  // declared side is the expectation, and changing the ladder means changing it
  // here, deliberately, in the same commit.
  const BACKSTOP_FIELDS: (keyof DecisionEvidence)[] = [
    "deviceCompliance",
    "deviceEncrypted",
    "deviceManaged",
    "dockEvidenceFreshness",
    "identityEnabled",
    "osSupported",
    "postureFreshness",
  ].sort() as (keyof DecisionEvidence)[];
  check(
    `22 backstop scope is PINNED: exactly ${BACKSTOP_FIELDS.length} fields can change deriveCriticalSignalsPresent, and they are the seven the ladder names`,
    JSON.stringify(feedingFields) === JSON.stringify(BACKSTOP_FIELDS),
    `derived=[${feedingFields.join(", ")}] declared=[${BACKSTOP_FIELDS.join(", ")}]`,
  );
  check(
    "22 scope floor: the verdict set is strictly wider than the backstop set — sweeping the backstop alone leaves rule-carrying families unmeasured, which is how finding F-A survived",
    verdictFields.length > feedingFields.length,
    `feeding=[${feedingFields.join(", ")}] verdict=[${verdictFields.join(", ")}]`,
  );

  // THREE DEGRADATIONS, and the third is a pure ADDITION (third-review finding
  // F-1, 2026-09-02). The first two damage the one reading a category has. The
  // third leaves it alone and adds a SECOND illegible reading — the family's
  // affirmative-good member — ahead of an accusing illegible one. That is a
  // corruption of the input stream in the only shape `groupLatest` was sensitive
  // to: it kept the FIRST illegible reading per category and dropped the rest, so
  // array order decided the answer among readings nothing can order by time, and
  // adding a good peer erased the accusation. Measured before the fold: tamper
  // deny → allow. Adding a signal must never buy leniency.
  const MUTATIONS = [
    "unparseable observedAt",
    "absent signal",
    "duplicate illegible good peer",
  ] as const;
  type Mutation = (typeof MUTATIONS)[number];

  // TWO DIMENSIONS, because one of them was blind. This sweep measured only
  // `criticalSignalsPresent`, and every vector of second-review finding F-A
  // passed it: an illegible `tamper_state: "confirmed"` turns csp true→false —
  // a LOWERING, which the backstop invariant permits — while simultaneously
  // turning the VERDICT from deny into step_up, which is the fail-open the whole
  // exercise exists to prevent. The backstop is not the decision. Both are swept.
  const DIMENSIONS = ["criticalSignalsPresent", "verdict"] as const;
  type Dimension = (typeof DIMENSIONS)[number];

  // Outcome membership is exhaustive BY CONSTRUCTION (a Record over the union:
  // add a member and this stops compiling), and the ORDER is derived from the
  // core's own fail-closed join rather than hand-numbered here — a second copy of
  // an ordering that already exists is exactly the fossil this repo keeps finding.
  const OUTCOME_MEMBERSHIP: Record<DecisionOutcome, true> = {
    allow: true,
    step_up: true,
    restrict: true,
    deny: true,
  };
  const OUTCOME_MEMBERS = Object.keys(OUTCOME_MEMBERSHIP) as DecisionOutcome[];
  const OUTCOME_RANK = Object.fromEntries(
    OUTCOME_MEMBERS.map((outcome) => [
      outcome,
      OUTCOME_MEMBERS.filter((other) => mostRestrictiveOutcome([outcome, other]) === outcome).length,
    ]),
  ) as Record<DecisionOutcome, number>;
  check(
    `22 outcome rank is DERIVED from mostRestrictiveOutcome and strictly orders all ${OUTCOME_MEMBERS.length} outcomes: allow<step_up<restrict<deny (${OUTCOME_MEMBERS.map((o) => `${o}=${OUTCOME_RANK[o]}`).join(" ")})`,
    OUTCOME_MEMBERS.length === 4 &&
      OUTCOME_RANK.allow < OUTCOME_RANK.step_up &&
      OUTCOME_RANK.step_up < OUTCOME_RANK.restrict &&
      OUTCOME_RANK.restrict < OUTCOME_RANK.deny,
  );

  // A violation is a LOOSENING under corruption, in either dimension: critical
  // evidence that goes absent→present, or a verdict that goes less restrictive.
  interface Cell {
    field: keyof DecisionEvidence;
    member: Member;
    mutation: Mutation;
    base: boolean;
    mutated: boolean;
    baseOutcome: DecisionOutcome;
    mutatedOutcome: DecisionOutcome;
  }
  const violations = (row: Cell[], dimension: Dimension): Cell[] =>
    dimension === "criticalSignalsPresent"
      ? row.filter((c) => c.mutated && !c.base)
      : row.filter((c) => OUTCOME_RANK[c.mutatedOutcome] < OUTCOME_RANK[c.baseOutcome]);

  // NAMED EXEMPTIONS. One entry, and it is the reason `readDockEvidenceFreshness`
  // needed fixing rather than the ladder: absence is a real answer here, so it is
  // written down instead of being allowed to swallow illegibility with it.
  const EXEMPTIONS: {
    name: string;
    field: keyof DecisionEvidence;
    mutation: Mutation;
    dimension: Dimension;
    /** The exact cells this exemption covers. A loosening on any OTHER member of
     *  the same row still fails — an exemption is a named cell, not a waiver on a
     *  whole field. */
    members: readonly Member[];
    reason: string;
  }[] = [
    {
      name: "dock-absence-is-a-deployment-shape",
      field: "dockEvidenceFreshness",
      mutation: "absent signal",
      dimension: "criticalSignalsPresent",
      members: FRESHNESS_VALUES,
      reason:
        "A tenant with no dock hardware emits no dock signal, so the field derives 'missing', and 'missing' is deliberately not in the disqualifying ladder — treating it as degraded would step up every dockless tenant on day one. The tenant's dock EXPECTATION is not modelled anywhere, so nothing in the core can tell 'we have no docks' from 'our docks stopped talking'. This exemption covers ABSENCE only: a dock reading that exists is never routed to 'missing', which is exactly what review finding F1 corrected.",
    },
    // ── The VERDICT dimension's exemptions, enumerated from this sweep's own
    // output rather than from memory. Every one of them is the same shape and it
    // is worth naming the shape once: A SIGNAL THAT WAS NEVER SENT IS SILENCE,
    // AND SILENCE HAS NO ACCUSATION IN IT. When the only reading that carried the
    // bad news disappears, the field falls back to its unknown/default value and
    // the verdict falls back to the fail-closed default (step_up) or, where the
    // field is not in the allow rule's match list, to allow. The core cannot tell
    // "this tenant has no such connector" from "this tenant's connector went
    // quiet", because no tenant-level EXPECTATION of a category is modelled
    // anywhere — that is a real deferred capability, not a bug in this sweep, and
    // it is REPORTED here rather than gated.
    {
      name: "identity-signal-absence-is-not-an-identity-answer",
      field: "identityEnabled",
      mutation: "absent signal",
      dimension: "verdict",
      members: [false],
      reason:
        "deny→allow. An `identity_state: false` signal is what makes the disabled account deny; with the signal gone the resolved identity ROW (state: enabled) is the only source left, and it says enabled. Nothing in the core knows the tenant HAS an identity connector, so a connector that stops emitting is indistinguishable from a tenant that never had one. The fold in `foldIdentityEnabled` is already worst-wins over the two sources that spoke; it cannot weigh a source that did not.",
    },
    {
      name: "compliance-signal-absence-falls-to-unknown-not-to-the-accusation",
      field: "deviceCompliance",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["non_compliant"],
      reason:
        "restrict→step_up. With no compliance reading the field is 'unknown', `device-noncompliant` no longer matches, and the decision lands on the fail-closed default step-up. The backstop DOES hold here — criticalSignalsPresent goes true→false in the same cell — so the loosening is bounded: allow is unreachable either way. Closing the remaining gap needs a per-tenant expectation of the compliance category, which is not modelled.",
    },
    {
      name: "management-signal-absence-falls-to-unknown-not-to-the-accusation",
      field: "deviceManaged",
      mutation: "absent signal",
      dimension: "verdict",
      members: [false],
      reason:
        "restrict→step_up, and identical in shape to the compliance row above: `device-unmanaged` cannot match a field that has no reading, the default step-up applies, and the backstop simultaneously drops criticalSignalsPresent to false so allow stays unreachable.",
    },
    {
      name: "dock-absence-is-a-deployment-shape",
      field: "dockEvidenceFreshness",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["unknown", "stale", "expired"],
      reason:
        "step_up→allow, and it is the verdict twin of the criticalSignalsPresent exemption above, for exactly the same reason: a tenant with no dock hardware emits no dock signal, the field derives 'missing', and 'missing' is deliberately outside the disqualifying ladder. It is stated twice and stale-checked twice, once per dimension. Allow being reachable after the mutation is NOT peculiar to this row — the sentence that stood here said it was the only such row, and measurement says otherwise, so the number is now DERIVED from the table below and printed with it rather than asserted from memory in a comment. It covers ABSENCE only — a dock reading that exists, however badly stamped, is never routed to 'missing' (finding F1) and never trades its value down (finding F-A).",
    },
    // ── The eleven rule-carrying families, all one shape ──────────────────────
    //
    // Every row below is `absent signal` × `verdict`, and every one is the same
    // sentence: THE ONLY READING THAT CARRIED THE ACCUSATION IS GONE, SO THE
    // ACCUSATION IS GONE. The field falls back to its no-reading default
    // ('unknown'/'unverified'), no rule matches that default by design, and
    // against an otherwise-healthy fixture the decision returns to allow — the
    // maximally-loose form of the shape, which is why it is stated per family
    // rather than waived once. Closing it needs a per-tenant EXPECTATION of a
    // signal category ("this tenant has dock hardware and it has gone quiet"),
    // which nothing in the core models today. REPORTED, deliberately, not gated.
    //
    // What is NOT exempt, and is the point of the whole section: the
    // `unparseable observedAt` row for every one of these families is clean. A
    // reading that EXISTS still accuses, however badly stamped (finding F-A).
    {
      name: "custody-absence-is-not-a-custody-answer",
      field: "custodyState",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["overdue", "exception", "maintenance"],
      reason:
        "restrict→allow on all three accusing members. `custody-overdue`, `custody-exception` and `custody-maintenance` match named states; the field's default with no reading is 'unknown', which none of them match.",
    },
    {
      name: "charge-absence-is-not-a-charge-answer",
      field: "dockChargeState",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["critical"],
      reason:
        "step_up→allow. `battery-critical` matches 'critical' only; with no charge reading the field defaults to 'unknown' and the rule cannot fire.",
    },
    {
      name: "battery-health-absence-is-not-a-battery-answer",
      field: "batteryHealth",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["failing"],
      reason:
        "restrict→allow. `battery-failing` matches 'failing' only; 'unknown' is the no-reading default and is deliberately unmatched (as is 'degraded' — see the rule's own note).",
    },
    {
      name: "tamper-absence-is-not-a-tamper-answer",
      field: "tamperState",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["suspected", "confirmed", "sensor_unavailable"],
      reason:
        "deny→allow for 'confirmed', and this is the sharpest cell in the table: a tamper sensor that stops reporting altogether is not distinguishable from a device that has no tamper sensor. Note the contrast that finding F-A turned on — a tamper reading that EXISTS with an unorderable stamp still denies (the 'unparseable observedAt' row above is clean); only true silence lands here.",
    },
    {
      name: "dock-state-absence-is-not-a-dock-answer",
      field: "dockState",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["faulted", "offline"],
      reason:
        "restrict→allow and step_up→allow. `dock-faulted`/`dock-offline` match named states; no dock reading means 'unknown', which neither matches — the deployment-shape argument for dock freshness applies unchanged to dock state.",
    },
    {
      name: "baseline-absence-is-not-a-baseline-answer",
      field: "baselineCompliance",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["drifted"],
      reason:
        "step_up→allow. `baseline-drifted` matches 'drifted'; a fleet with no hardening connector emits nothing and must not be stepped up on day one.",
    },
    {
      name: "benchmark-selection-absence-is-day-one-quiet",
      field: "benchmarkSelection",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["misfit"],
      reason:
        "step_up→allow, and DELIBERATE at the rule layer: the active v1 rule matches only the affirmative 'misfit', because the no-reading default 'unverified' would otherwise step up the entire fleet before a connector exists. The strict arm that does match 'unverified' ships in SHARED_DEVICE_RULES_V2 and is asserted in section 11b.",
    },
    {
      name: "shift-context-absence-is-day-one-quiet",
      field: "shiftContext",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["misfit"],
      reason:
        "step_up→allow, same day-one-quiet shape as benchmark selection: v1 matches only the affirmative mismatch, and the labor-plane default 'unverified' stays quiet until a WFM connector emits.",
    },
    {
      name: "badge-absence-is-not-a-badge-answer",
      field: "badgeBinding",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["removed", "forced"],
      reason:
        "deny→allow for 'forced'. The badge family has an 'absent' MEMBER — a reader that reports no badge — and that member is a real answer the rules could act on; what cannot be acted on is the connector never speaking at all, which is what this cell measures.",
    },
    {
      name: "management-health-absence-is-day-one-quiet",
      field: "managementHealthState",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["broken"],
      reason:
        "restrict→allow. `management-health-broken` matches only the affirmative failure; 'unknown' is the no-reading default and stays quiet so adding the category could not change an existing decision.",
    },
    {
      name: "local-authority-absence-is-day-one-quiet",
      field: "localAuthorityState",
      mutation: "absent signal",
      dimension: "verdict",
      members: ["withheld"],
      reason:
        "restrict→allow. `local-authority-withheld` matches only the affirmative withholding; 'unverified' is the default and stays quiet until the control plane speaks.",
    },
  ];

  // EACH MUTATION NAMES ITS OWN BASE, because they do not all start from the same
  // place. The first two DEGRADE the single reading a healthy category has, so the
  // base is that reading. The third ADDS a peer to a pair that already contains an
  // illegible reading, so the base is that pair — ranking an addition against the
  // single-reading base would measure the illegible stamp as well as the addition,
  // and it is the ADDITION that must never buy leniency.
  const vectorFor = (
    f: MonoField,
    member: Member,
    rest: NormalizedSignal[],
    mutation: Mutation,
  ): { base: NormalizedSignal[]; mutated: NormalizedSignal[] } => {
    const single = [...rest, f.reading(member, VALID_AT)];
    switch (mutation) {
      case "absent signal":
        return { base: single, mutated: rest };
      case "unparseable observedAt":
        return { base: single, mutated: [...rest, f.reading(member, ILLEGIBLE_AT)] };
      case "duplicate illegible good peer":
        // The reading under test is the ILLEGIBLE one and its parseable sibling is
        // the family's affirmative-good member, so the accusation lives ONLY in the
        // illegible reading — the one shape where dropping an illegible peer can
        // change the answer at all. The mutation adds the good member a SECOND
        // time, illegible, AHEAD of it: same category, one more reading, nothing
        // removed.
        return {
          base: [...rest, f.reading(member, ILLEGIBLE_AT), f.reading(goodOf(f), VALID_AT)],
          mutated: [
            ...rest,
            f.reading(goodOf(f), ILLEGIBLE_AT),
            f.reading(member, ILLEGIBLE_AT),
            f.reading(goodOf(f), VALID_AT),
          ],
        };
    }
  };

  const cells: Cell[] = [];
  const accusingPeerBases: Cell[] = [];
  for (const f of MONO_FIELDS) {
    const rest = healthy.filter((s) => s.category !== f.category);
    const ineffective: string[] = [];
    for (const member of f.domain.members) {
      const baseEvidence = buildEvidence(identity, device, workflow, [
        ...rest,
        f.reading(member, VALID_AT),
      ]);
      // A vector that does not actually produce the member it claims proves
      // nothing about that member. This is the floor: it fails if the derivation
      // stops routing this category to this field.
      if (String(baseEvidence[f.field]) !== String(member)) {
        ineffective.push(`${String(member)}→${String(baseEvidence[f.field])}`);
      }
      for (const mutation of MUTATIONS) {
        const vector = vectorFor(f, member, rest, mutation);
        const beforeEvidence = buildEvidence(identity, device, workflow, vector.base);
        const mutatedEvidence = buildEvidence(identity, device, workflow, vector.mutated);
        const cell: Cell = {
          field: f.field,
          member,
          mutation,
          base: beforeEvidence.criticalSignalsPresent,
          mutated: mutatedEvidence.criticalSignalsPresent,
          baseOutcome: evaluatePolicy(monoV1, beforeEvidence).outcome,
          mutatedOutcome: evaluatePolicy(monoV1, mutatedEvidence).outcome,
        };
        cells.push(cell);
        // The third mutation is only meaningful where its base actually carries an
        // accusation an added peer could erase. Counted, not assumed.
        if (
          mutation === "duplicate illegible good peer" &&
          (cell.baseOutcome !== baselineOutcome || !cell.base)
        ) {
          accusingPeerBases.push(cell);
        }
      }
    }
    check(
      `22 vector effectiveness: every swept member of ${f.field} is really derived from a ${f.category} reading`,
      ineffective.length === 0,
      `member→derived mismatches: ${ineffective.join(", ")}`,
    );
  }
  // FLOOR ON THE THIRD MUTATION, because a peer added to a base that says nothing
  // cannot loosen anything and a row of those would be green about nothing. This
  // counts the cells whose two-signal base is genuinely worse than the healthy
  // baseline — the cells where the added good peer HAD something to erase.
  const ACCUSING_PEER_FLOOR = 25;
  check(
    `22 floor: the 'duplicate illegible good peer' mutation is not vacuous — ${accusingPeerBases.length} of its bases (floor ${ACCUSING_PEER_FLOOR}) are genuinely worse than the healthy baseline, so the added peer had an accusation to erase`,
    accusingPeerBases.length >= ACCUSING_PEER_FLOOR,
    `accusing bases=${accusingPeerBases.length}`,
  );

  for (const f of MONO_FIELDS) {
    for (const mutation of MUTATIONS) {
      const row = cells.filter((c) => c.field === f.field && c.mutation === mutation);
      for (const dimension of DIMENSIONS) {
        const loosened = violations(row, dimension);
        const exemption = EXEMPTIONS.find(
          (e) => e.field === f.field && e.mutation === mutation && e.dimension === dimension,
        );
        const shown = loosened.map((c) =>
          dimension === "verdict"
            ? `${String(c.member)}:${c.baseOutcome}→${c.mutatedOutcome}`
            : String(c.member),
        );
        monotonicityTable.push(
          `  ${f.field.padEnd(22)} ${mutation.padEnd(22)} ${dimension.padEnd(22)} ${String(
            row.length,
          ).padStart(2)} cells, ${loosened.length} looser${
            shown.length > 0 ? ` [${shown.join(", ")}]` : ""
          }${exemption ? ` — EXEMPT: ${exemption.name}` : ""}`,
        );
        if (exemption) {
          check(
            `22 exemption "${exemption.name}" is NOT stale — ${f.field} × ${mutation} × ${dimension} still describes a real loosening`,
            loosened.length > 0,
            "the exemption no longer covers any cell: delete it, or the next real loosening hides behind it",
          );
          const unnamed = loosened.filter((c) => !exemption.members.includes(c.member));
          check(
            `22 exemption "${exemption.name}" covers ONLY the members it names [${exemption.members
              .map((m) => String(m))
              .join(", ")}] — a loosening on any other member of the row still fails`,
            unnamed.length === 0,
            `unnamed loosening(s): ${unnamed
              .map((c) => `${String(c.member)}:${c.baseOutcome}→${c.mutatedOutcome}`)
              .join(", ")}`,
          );
        } else {
          check(
            `22 monotone (${dimension}): corrupting ${f.field} (${mutation}) never LOOSENS the answer`,
            loosened.length === 0,
            `loosened on: ${shown.join(", ")}`,
          );
        }
      }
    }
  }

  // HOW MANY EXEMPTION ROWS REACH ALLOW — DERIVED, and it is here because a
  // comment in this file got it wrong. The dock row's reason string claimed to be
  // the only exemption where allow is reachable after the mutation; it is not, and
  // it could not have been, because "the only reading that carried the accusation
  // is gone" lands on allow by construction for every family whose v1 rule matches
  // only an affirmative member. The count is computed from the same cells the
  // table above is built from and printed beside it, so it cannot go stale.
  const exemptionsReachingAllow = EXEMPTIONS.filter((e) =>
    cells.some(
      (c) =>
        c.field === e.field &&
        c.mutation === e.mutation &&
        e.members.includes(c.member) &&
        c.mutatedOutcome === "allow",
    ),
  );
  monotonicityTable.push(
    `  — ${exemptionsReachingAllow.length} of ${EXEMPTIONS.length} named exemptions reach ALLOW after their mutation (DERIVED from the cells above): ${exemptionsReachingAllow
      .map((e) => e.name)
      .join(", ")}`,
  );
  check(
    `22 exemption reach is DERIVED, not remembered: ${exemptionsReachingAllow.length} of ${EXEMPTIONS.length} exemption rows reach allow after their mutation — allow-after-mutation is the common case among them, not the single dock row a comment here once claimed`,
    exemptionsReachingAllow.length > 1 &&
      exemptionsReachingAllow.length <= EXEMPTIONS.length &&
      EXEMPTIONS.length >= 16,
    `reachAllow=[${exemptionsReachingAllow.map((e) => e.name).join(", ")}] of ${EXEMPTIONS.length}`,
  );

  // Floors and a SYNTHETIC violation, so a sweep that silently stopped sweeping
  // cannot report itself clean. The cell floor is bumped deliberately when a
  // field or a union member is added — never trailed to whatever ran today.
  check(
    `22 floor: the sweep is not vacuous — ${cells.length} cells over ${MONO_FIELDS.length} fields × ${MUTATIONS.length} mutations × ${DIMENSIONS.length} dimensions = ${
      cells.length * DIMENSIONS.length
    } measurements (floor 150 cells over 18 fields and 3 mutations; bumped deliberately when the verdict dimension widened the field set from 7, and again when the illegible-peer mutation was added)`,
    cells.length >= 150 &&
      MONO_FIELDS.length >= 18 &&
      MUTATIONS.length >= 3 &&
      DIMENSIONS.length >= 2,
    `cells=${cells.length} fields=${MONO_FIELDS.length} mutations=${MUTATIONS.length} dimensions=${DIMENSIONS.length}`,
  );
  const synth = (
    base: boolean,
    mutated: boolean,
    baseOutcome: DecisionOutcome = "step_up",
    mutatedOutcome: DecisionOutcome = "step_up",
  ): Cell[] => [
    {
      field: "postureFreshness",
      member: "synthetic",
      mutation: "absent signal",
      base,
      mutated,
      baseOutcome,
      mutatedOutcome,
    },
  ];
  check(
    "22 self-test: the classifier FLAGS a synthetic raise (base=false → mutated=true) and passes the three non-raising shapes — a table that can only say 'clean' is green about nothing",
    violations(synth(false, true), "criticalSignalsPresent").length === 1 &&
      violations(synth(true, true), "criticalSignalsPresent").length === 0 &&
      violations(synth(true, false), "criticalSignalsPresent").length === 0 &&
      violations(synth(false, false), "criticalSignalsPresent").length === 0,
  );
  check(
    "22 self-test (verdict): the classifier FLAGS a synthetic loosening (deny → step_up, the exact shape of finding F-A) and passes equal and tightening shapes",
    violations(synth(true, true, "deny", "step_up"), "verdict").length === 1 &&
      violations(synth(true, true, "deny", "deny"), "verdict").length === 0 &&
      violations(synth(true, true, "step_up", "deny"), "verdict").length === 0 &&
      violations(synth(true, true, "allow", "step_up"), "verdict").length === 0,
  );
  check(
    "22 self-test: the verdict classifier is blind to csp and the csp classifier is blind to the verdict — the two dimensions really are independent, which is why sweeping one alone passed every F-A vector",
    violations(synth(true, false, "deny", "step_up"), "criticalSignalsPresent").length === 0 &&
      violations(synth(false, true, "deny", "deny"), "verdict").length === 0,
  );
}

// ── 30. Eighth verdict-core round (2026-09-05): four fail-open shapes ──────────

{
  // (a) A tenant with NO resolution configuration must not get auto-proposed
  // resolution: the engine's fallback config used to say `autoProposeEnabled:
  // true`, so an ABSENT configuration switched the most permissive class on.
  // Exercised on the real engine by hiding the seeded config for one call.
  const staleDec = decisions.find((d) => d.reasonCodes.includes("POSTURE_STALE"));
  const hidden = core as unknown as { store: MemoryStore };
  const original = hidden.store.getResolutionConfig;
  let planWithout: ReturnType<typeof core.getResolution> | undefined;
  try {
    hidden.store.getResolutionConfig = () => undefined;
    if (staleDec) planWithout = core.getResolution(T.operator, staleDec.id);
  } finally {
    hidden.store.getResolutionConfig = original;
  }
  check(
    "resolution: with NO tenant configuration, nothing is auto-proposed (absence of a decision is not a decision to propose)",
    planWithout !== undefined &&
      planWithout.steps.length > 0 &&
      planWithout.steps.every((s) => s.resolutionClass !== "auto_proposed"),
  );
  check(
    "resolution: ...and the SAME decision with the seeded config still auto-proposes (the assertion above can fail)",
    staleDec !== undefined && core.getResolution(T.operator, staleDec.id).steps.some((s) => s.resolutionClass === "auto_proposed"),
  );

  // (b) A fixture sync whose EVERY record names an unknown subject used to report
  // status "success" and mark the connector "healthy" — a sync that applied nothing
  // reading as a clean sync.
  const syncStore = seedDemoStore(fixedClock("2026-07-13T15:00:00.000Z")).store;
  const fixtureConnector = syncStore.listConnectors("tenant_northwind").find((c) => c.mode === "fixture" && c.kind !== "dockbridge-custody");
  check("sync: a fixture posture connector is seeded", fixtureConnector !== undefined);
  if (fixtureConnector) {
    const orphan = {
      deviceRef: "no-such-device", identityRef: "no-such-identity", identityEnabled: true, managed: true,
      compliance: "compliant" as const, encrypted: true, osSupported: true, lastSyncAt: "2026-07-13T14:00:00.000Z", sourceReference: "fixture:orphan",
    };
    const run = runFixtureSync(syncStore, fixedClock("2026-07-13T15:00:00.000Z"), fixtureConnector, [orphan, orphan]);
    check("sync: a run that skipped EVERY record reports partial, not success", run.status === "partial" && run.recordsProcessed === 0 && run.signalsNormalized === 0);
    check("sync: ...names the skip count in its note", /2 of 2 record/.test(run.note));
    check("sync: ...and leaves the connector degraded, not healthy", syncStore.listConnectors("tenant_northwind").find((c) => c.id === fixtureConnector.id)?.status === "degraded");
    const known = seedDemoStore(fixedClock("2026-07-13T15:00:00.000Z"));
    const knownConnector = known.store.listConnectors("tenant_northwind").find((c) => c.id === fixtureConnector.id);
    const knownRecords = known.fixtureRecords[fixtureConnector.id] ?? [];
    check("sync: the seeded records are all known subjects (control)", knownConnector !== undefined && knownRecords.length > 0);
    if (knownConnector) {
      const clean = runFixtureSync(known.store, fixedClock("2026-07-13T15:00:00.000Z"), knownConnector, knownRecords);
      check("sync: a run that skipped nothing still reports success and healthy (the assertions above can fail)", clean.status === "success" && clean.recordsProcessed === knownRecords.length);
    }
  }

  // (c) A principal whose role is not in the permission table must resolve to NO
  // permission — never to a prototype member or a thrown TypeError. Reached by
  // binding a key whose role arrived across a boundary the type cannot see.
  const roleStore = seedDemoStore(fixedClock("2026-07-13T15:00:00.000Z")).store;
  roleStore.putApiKey({
    id: "key_bogus_role", tenantId: "tenant_northwind", principalType: "user", subjectId: "user_bogus",
    role: "constructor" as unknown as Role, token: "sgk_bogus_role", keyReference: "bogus",
  });
  const rolePrincipal = authenticate(roleStore, "sgk_bogus_role");
  expectError("rbac: a role outside the table (\"constructor\") is forbidden, not resolved through the prototype", "forbidden", () =>
    authorize(rolePrincipal, "decision:read"),
  );
}

const failed = assertions.filter((a) => !a.passed);

console.log("SignalGrid core proof (public-safe, deterministic, fixture-backed)");
console.log(`Clock: 2026-07-13T15:00:00.000Z`);
console.log(
  `Assertions: ${assertions.length - failed.length}/${assertions.length} passed\n`,
);

console.log("Decision outcomes:");
for (let i = 0; i < scenarios.length; i++) {
  const s = scenarios[i];
  const d = decisions[i];
  console.log(
    `- ${d.outcome.toUpperCase().padEnd(8)} ${s.label} :: [${d.reasonCodes.join(", ")}] policy v${d.policyVersion}`,
  );
}

console.log(
  "\nMonotonicity under corruption — corrupting an input never loosens criticalSignalsPresent OR the verdict",
);
console.log(
  "  (field × union member × corruption × dimension; a LOOSENING is a violation unless named EXEMPT)",
);
for (const line of monotonicityTable) {
  console.log(line);
}

console.log("\nEvidence bundle (first decision):");
const sample = decisions[0];
const sampleSnapshot = core.getSnapshot(T.operator, sample.evidenceSnapshotId);
console.log(
  JSON.stringify(
    {
      decisionId: sample.id,
      tenantId: sample.tenantId,
      outcome: sample.outcome,
      reasonCodes: sample.reasonCodes,
      policyVersionId: sample.policyVersionId,
      evidenceSnapshotId: sample.evidenceSnapshotId,
      evidence: sampleSnapshot.evidence,
      sourceReferences: sampleSnapshot.sourceReferences,
      snapshotDigest: sampleSnapshot.digest,
      auditChain: core.verifyAudit(T.owner),
    },
    null,
    2,
  ),
);

if (failed.length > 0) {
  console.error("\nFailed assertions:");
  for (const item of failed) {
    console.error(`- ${item.name}${item.detail ? ` (${item.detail})` : ""}`);
  }
  process.exit(1);
}

console.log("\nAll core invariants hold.");

// ── figures= — the line `scripts/check-proof-figures.mjs` reads ────────────────
//
// WHY THIS EXISTS, and it is a defect that recurred rather than a nicety.
//
// This proof — the largest in the repo, and the one every product document cites —
// was NOT in the figure guard's PROOFS registry and emitted no `figures=` line, so
// nothing checked any number a document stated about it. `docs/WHAT_SIGNALGRID_DOES_TODAY.md`
// drifted to "188 assertions", was hand-corrected to 206, and had drifted again to
// 209 by the time an audit re-derived it. The same figure going stale twice is the
// evidence that correcting the number is not the fix; making it checkable is.
//
// The counts are DERIVED here, never restated: `assertions.length` is the real total,
// and the two enum sizes are read from the same `types.ts` the docs call ground truth.
// A document that states a different value now fails the guard instead of aging quietly.
console.log(
  `\nfigures=assertions=${assertions.length},categories=${SIGNAL_CATEGORIES.length},evidenceFields=${EVIDENCE_FIELDS.length}`,
);
