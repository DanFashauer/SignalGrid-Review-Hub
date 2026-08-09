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
  buildEvidence,
  canonicalJson,
  constantTimeEquals,
  CoreError,
  evaluatePolicy,
  fixedClock,
  MemoryStore,
  RESOLUTION_DESCRIPTOR_SHAPES,
  seedDemoStore,
  verifySnapshot,
  CORE_NORMALIZATION_VERSION,
  SignalGridCore,
  SHARED_DEVICE_RULES_V1,
  SHARED_DEVICE_RULES_V2,
  validatePolicyRules,
  type Decision,
  type DecisionOutcome,
  type Device,
  type Identity,
  type NormalizedSignal,
  type SignalCategory,
  type Workflow,
  SIGNAL_CATEGORIES,
  EVIDENCE_FIELDS,
} from "@workspace/signalgrid-core";

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
const LEGACY_SNAPSHOT_DIGEST = "28d821302756a247";
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

  const ncDec = decisions.find((d) => d.reasonCodes.includes("DEVICE_NONCOMPLIANT"));
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
  if (tamper) {
    const plan = core.getResolution(T.operator, tamper.id);
    check(
      "dockbridge: suspected tamper needs operator approval",
      plan.path === "assisted",
    );
  }

  const battery = decisions.find((d) => d.reasonCodes.includes("BATTERY_CRITICAL"));
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

  // Tie-break: on EQUAL observedAt, the first-inserted signal wins — matching a
  // stable descending sort's first element. Insert in both orders on separate
  // stores and assert the derived compliance is stable (first-inserted's value).
  const sameTs = "2026-07-13T12:00:00.000Z";
  const tie = (first: string, second: string): string => {
    const s = new MemoryStore();
    s.putDevice(dev);
    s.putSignal(mk("tie_a", first, sameTs));
    s.putSignal(mk("tie_b", second, sameTs));
    return buildEvidence(identity, dev, workflow, s.listSignalsForSubject("tenant_a", "device", "dv_x")).deviceCompliance;
  };
  check(
    "index: equal-observedAt tie resolves to the first-inserted signal",
    tie("compliant", "non_compliant") === "compliant" &&
      tie("non_compliant", "compliant") === "non_compliant",
  );
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
