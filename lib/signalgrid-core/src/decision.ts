import { appendAudit } from "./audit";
import { buildEvidence, buildSnapshot } from "./evidence";
import { evaluatePolicy } from "./policy";
import type { MemoryStore } from "./store";
import { deterministicId } from "./util";
import type { Clock } from "./util";
import {
  CoreError,
  type Decision,
  type EvaluateRequest,
  type EvaluateResult,
  type NormalizedSignal,
  type ReviewStatus,
} from "./types";

/**
 * The decision loop:
 *   resolve tenant + identity + device + workflow (tenant-scoped)
 *     → gather cached normalized signals
 *     → derive decision evidence
 *     → select the active policy version
 *     → evaluate (deterministic, fail-closed)
 *     → capture an immutable evidence snapshot
 *     → persist the decision
 *     → append a tamper-evident audit event
 *
 * Every step is tenant-scoped and deterministic. No live vendor call happens.
 */
export function evaluateDecision(
  store: MemoryStore,
  clock: Clock,
  tenantId: string,
  actor: string,
  request: EvaluateRequest,
): { decision: Decision; result: EvaluateResult } {
  validateRequest(request);
  const startedMs = clock.now().getTime();
  const createdAt = clock.now().toISOString();

  const identity = store.findIdentityByRef(tenantId, request.identityRef);
  if (!identity) {
    throw new CoreError(
      "not_found",
      `Identity "${request.identityRef}" not found in tenant.`,
      404,
    );
  }
  const device = store.findDeviceByRef(tenantId, request.deviceRef);
  if (!device) {
    throw new CoreError(
      "not_found",
      `Device "${request.deviceRef}" not found in tenant.`,
      404,
    );
  }
  const workflow = store.findWorkflowByKey(tenantId, request.workflowKey);
  if (!workflow) {
    throw new CoreError(
      "not_found",
      `Workflow "${request.workflowKey}" not found in tenant.`,
      404,
    );
  }

  const policy = store.findPolicyForWorkflow(tenantId, workflow.key);
  if (!policy) {
    throw new CoreError(
      "not_found",
      `No policy is configured for workflow "${workflow.key}".`,
      404,
    );
  }
  const version = store.getPolicyVersion(tenantId, policy.activeVersionId);
  if (!version) {
    throw new CoreError(
      "not_found",
      `Active policy version for "${policy.key}" is missing.`,
      404,
    );
  }

  const deviceSignals = store.listSignalsForSubject(
    tenantId,
    "device",
    device.id,
  );
  const identitySignals = store.listSignalsForSubject(
    tenantId,
    "identity",
    identity.id,
  );
  const signalsUsed: NormalizedSignal[] = [...identitySignals, ...deviceSignals];

  const evidence = buildEvidence(identity, device, workflow, signalsUsed);
  const evaluation = evaluatePolicy(version, evidence);

  const decisionId = deterministicId(
    "dec",
    tenantId,
    identity.id,
    device.id,
    workflow.id,
    version.id,
    createdAt,
  );

  const snapshot = buildSnapshot(
    tenantId,
    decisionId,
    createdAt,
    evidence,
    signalsUsed,
    version,
  );
  store.putSnapshot(snapshot);

  const reviewStatus: ReviewStatus =
    evaluation.outcome === "allow" ? "not_required" : "pending_review";
  const reviewable = evaluation.outcome !== "allow";
  const latencyMs = Math.max(1, clock.now().getTime() - startedMs);

  const decision: Decision = {
    id: decisionId,
    tenantId,
    identityId: identity.id,
    deviceId: device.id,
    workflowId: workflow.id,
    outcome: evaluation.outcome,
    policyId: policy.id,
    policyVersionId: version.id,
    policyVersion: version.version,
    matchedRules: evaluation.matchedRules,
    reasonCodes: evaluation.reasonCodes,
    signalIds: signalsUsed.map((signal) => signal.id),
    evidenceSnapshotId: snapshot.id,
    requestContext: request.requestContext ?? {},
    latencyMs,
    createdAt,
    reviewStatus,
    reviewable,
    explanation: evaluation.explanation,
  };
  store.putDecision(decision);

  appendAudit(store, {
    tenantId,
    type: "evidence.captured",
    actor,
    subject: snapshot.id,
    summary: `Evidence snapshot captured for decision ${decisionId}.`,
    references: [decisionId, snapshot.id, version.id],
    recordedAt: createdAt,
  });
  appendAudit(store, {
    tenantId,
    type: "decision.evaluated",
    actor,
    subject: decisionId,
    summary: `Decision ${evaluation.outcome} for identity ${identity.externalRef} on device ${device.externalRef} (${workflow.key}).`,
    references: [decisionId, snapshot.id, policy.id, version.id],
    recordedAt: createdAt,
  });

  const result: EvaluateResult = {
    decisionId,
    outcome: evaluation.outcome,
    reasonCodes: evaluation.reasonCodes,
    policyId: policy.id,
    policyVersion: version.version,
    policyVersionId: version.id,
    evidenceSnapshotId: snapshot.id,
    matchedRules: evaluation.matchedRules,
    reviewable,
    latencyMs,
    explanation: evaluation.explanation,
  };

  return { decision, result };
}

function validateRequest(request: EvaluateRequest): void {
  const fields: Array<keyof EvaluateRequest> = [
    "identityRef",
    "deviceRef",
    "workflowKey",
  ];
  for (const field of fields) {
    const value = request[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new CoreError(
        "validation",
        `Field "${field}" is required and must be a non-empty string.`,
        400,
      );
    }
  }
}
