import { canonicalJson, deterministicId, digest } from "./util";
import type {
  ComplianceState,
  DecisionEvidence,
  Device,
  EvidenceSnapshot,
  Freshness,
  Identity,
  NormalizedSignal,
  PolicyVersion,
  Workflow,
} from "./types";

/**
 * Derive the normalized decision-evidence context from cached signals plus the
 * resolved subjects. Missing signals are represented as "unknown"/"missing"
 * (never assumed healthy), and `criticalSignalsPresent` is true only when all
 * critical inputs are present and not degraded.
 */
export function buildEvidence(
  identity: Identity,
  device: Device,
  workflow: Workflow,
  signals: NormalizedSignal[],
): DecisionEvidence {
  const compliance = readCompliance(signals);
  const managed = readBoolean(signals, "device_management");
  const encrypted = readBoolean(signals, "device_encryption");
  const osSupported = readBoolean(signals, "os_support");
  const postureFreshness = readFreshness(signals);

  const identityEnabled: boolean | "unknown" =
    identity.state === "enabled"
      ? true
      : identity.state === "disabled"
        ? false
        : "unknown";

  const criticalSignalsPresent =
    identityEnabled !== "unknown" &&
    compliance !== "unknown" &&
    managed !== "unknown" &&
    postureFreshness !== "missing" &&
    postureFreshness !== "unknown";

  return {
    identityEnabled,
    deviceManaged: managed,
    deviceCompliance: compliance,
    deviceEncrypted: encrypted,
    osSupported,
    ownerType: device.ownerType,
    postureFreshness,
    workflowRiskTier: workflow.riskTier,
    criticalSignalsPresent,
  };
}

export function buildSnapshot(
  tenantId: string,
  decisionId: string,
  capturedAt: string,
  evidence: DecisionEvidence,
  signalsUsed: NormalizedSignal[],
  version: PolicyVersion,
): EvidenceSnapshot {
  const sourceReferences = [
    ...new Set(signalsUsed.map((signal) => signal.sourceReference)),
  ].sort();
  const id = deterministicId("evid", tenantId, decisionId);
  const body = canonicalJson({
    tenantId,
    decisionId,
    capturedAt,
    evidence,
    signalsUsed,
    policyVersionId: version.id,
    policyVersion: version.version,
    sourceReferences,
  });
  return {
    id,
    tenantId,
    decisionId,
    capturedAt,
    evidence,
    signalsUsed,
    policyVersionId: version.id,
    policyVersion: version.version,
    sourceReferences,
    digest: digest(body),
  };
}

/** Recompute a snapshot digest to confirm it has not been altered. */
export function verifySnapshot(snapshot: EvidenceSnapshot): boolean {
  const body = canonicalJson({
    tenantId: snapshot.tenantId,
    decisionId: snapshot.decisionId,
    capturedAt: snapshot.capturedAt,
    evidence: snapshot.evidence,
    signalsUsed: snapshot.signalsUsed,
    policyVersionId: snapshot.policyVersionId,
    policyVersion: snapshot.policyVersion,
    sourceReferences: snapshot.sourceReferences,
  });
  return digest(body) === snapshot.digest;
}

function readCompliance(signals: NormalizedSignal[]): ComplianceState {
  const signal = latest(signals, "device_compliance");
  if (!signal) {
    return "unknown";
  }
  if (signal.value === "compliant") {
    return "compliant";
  }
  if (signal.value === "non_compliant") {
    return "non_compliant";
  }
  return "unknown";
}

function readBoolean(
  signals: NormalizedSignal[],
  category: NormalizedSignal["category"],
): boolean | "unknown" {
  const signal = latest(signals, category);
  if (!signal) {
    return "unknown";
  }
  return typeof signal.value === "boolean" ? signal.value : "unknown";
}

function readFreshness(signals: NormalizedSignal[]): Freshness {
  const signal = latest(signals, "posture_freshness");
  if (!signal) {
    return "missing";
  }
  const value = signal.value;
  if (
    value === "fresh" ||
    value === "stale" ||
    value === "expired" ||
    value === "missing" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function latest(
  signals: NormalizedSignal[],
  category: NormalizedSignal["category"],
): NormalizedSignal | undefined {
  return signals
    .filter((signal) => signal.category === category)
    .sort((a, b) => b.observedAt.localeCompare(a.observedAt))[0];
}
