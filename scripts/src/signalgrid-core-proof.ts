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
  CoreError,
  SignalGridCore,
  type Decision,
  type DecisionOutcome,
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

check(
  "isolation: atlas device invisible under northwind tenant",
  core.probeDeviceVisibility("tenant_northwind", "handheld-01") === false,
);
check(
  "isolation: northwind device invisible under atlas tenant",
  core.probeDeviceVisibility("tenant_atlas", "ipad-ward-01") === false,
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
