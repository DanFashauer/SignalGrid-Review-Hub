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
  seedDemoStore,
  SignalGridCore,
  SHARED_DEVICE_RULES_V2,
  validatePolicyRules,
  type Decision,
  type DecisionOutcome,
  type Device,
  type Identity,
  type NormalizedSignal,
  type SignalCategory,
  type Workflow,
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
  { label: "baseline-drift-stepup", identityRef: "nurse.baseline_drift", deviceRef: "ipad-ward-06", workflowKey: "clinical-session", expectedOutcome: "step_up", expectedReason: "BASELINE_DRIFTED" },
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
  const dock = connectors.find((c) => c.kind === "dockbridge-custody");
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

  // A confirmed-tamper device is a hard deny that cannot self-resolve.
  const tamperCore = SignalGridCore.demo();
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
  void tamperCore;
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
