import { canonicalJson, deterministicId, digest } from "./util";
import type {
  BadgeBindingState,
  BaselineState,
  BatteryHealthState,
  ChargeState,
  ComplianceState,
  CustodyState,
  DecisionEvidence,
  Device,
  DockState,
  EvidenceSnapshot,
  Freshness,
  Identity,
  NormalizedSignal,
  PolicyVersion,
  TamperState,
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
  // Group the signals into the single latest-per-category entry in one pass,
  // instead of filtering+sorting the whole array once per category (this was 9
  // filter+sort passes per decision). Output is identical: for each category we
  // keep the entry with the greatest observedAt, and on a tie the first in the
  // original order — matching a stable descending sort's first element.
  const latestByCategory = groupLatest(signals);
  const compliance = readCompliance(latestByCategory);
  const managed = readBoolean(latestByCategory, "device_management");
  const encrypted = readBoolean(latestByCategory, "device_encryption");
  const osSupported = readBoolean(latestByCategory, "os_support");
  const postureFreshness = readFreshness(latestByCategory);

  const identityEnabled: boolean | "unknown" =
    identity.state === "enabled"
      ? true
      : identity.state === "disabled"
        ? false
        : "unknown";

  const partial = {
    identityEnabled,
    deviceManaged: managed,
    deviceCompliance: compliance,
    deviceEncrypted: encrypted,
    osSupported,
    ownerType: device.ownerType,
    postureFreshness,
    workflowRiskTier: workflow.riskTier,
    custodyState: readCustody(latestByCategory),
    dockChargeState: readCharge(latestByCategory),
    batteryHealth: readBatteryHealth(latestByCategory),
    tamperState: readTamper(latestByCategory),
    dockState: readDock(latestByCategory),
    baselineCompliance: readBaseline(latestByCategory),
    badgeBinding: readBadge(latestByCategory),
  };

  return {
    ...partial,
    criticalSignalsPresent: deriveCriticalSignalsPresent(partial),
  };
}

/**
 * Critical evidence is present only when every critical input is known and not
 * degraded. Shared by evidence derivation and resolution simulation so a
 * simulated fix recomputes the same way a real signal would.
 */
export function deriveCriticalSignalsPresent(
  evidence: Omit<DecisionEvidence, "criticalSignalsPresent">,
): boolean {
  return (
    evidence.identityEnabled !== "unknown" &&
    evidence.deviceCompliance !== "unknown" &&
    evidence.deviceManaged !== "unknown" &&
    evidence.deviceEncrypted !== "unknown" &&
    evidence.postureFreshness !== "missing" &&
    evidence.postureFreshness !== "unknown"
  );
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

type LatestByCategory = Map<NormalizedSignal["category"], NormalizedSignal>;

/**
 * One pass over the signals, keeping the latest (max observedAt) entry per
 * category. On an observedAt tie the first entry in the original order wins,
 * which matches the first element of a stable descending sort — so the derived
 * evidence is byte-for-byte identical to the prior filter+sort-per-category
 * approach, at O(n) instead of O(categories · n log n).
 */
function groupLatest(signals: NormalizedSignal[]): LatestByCategory {
  const map: LatestByCategory = new Map();
  for (const signal of signals) {
    const current = map.get(signal.category);
    if (!current || signal.observedAt.localeCompare(current.observedAt) > 0) {
      map.set(signal.category, signal);
    }
  }
  return map;
}

function readCompliance(latestByCategory: LatestByCategory): ComplianceState {
  const signal = latestByCategory.get("device_compliance");
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
  latestByCategory: LatestByCategory,
  category: NormalizedSignal["category"],
): boolean | "unknown" {
  const signal = latestByCategory.get(category);
  if (!signal) {
    return "unknown";
  }
  return typeof signal.value === "boolean" ? signal.value : "unknown";
}

const CUSTODY_STATES = [
  "checked_in",
  "checked_out",
  "overdue",
  "exception",
  "maintenance",
] as const;
const CHARGE_STATES = ["charging", "charged", "low", "critical", "not_present"] as const;
const TAMPER_STATES = ["none", "suspected", "confirmed", "sensor_unavailable"] as const;
const DOCK_STATES = ["occupied", "empty", "reserved", "faulted", "offline"] as const;
const BATTERY_HEALTH_STATES = ["healthy", "degraded", "failing"] as const;
const BASELINE_STATES = ["aligned", "partial", "drifted", "not_assessed"] as const;
const BADGE_STATES = ["present", "removed", "forced", "absent"] as const;

function readCustody(latestByCategory: LatestByCategory): CustodyState {
  return readEnum(latestByCategory, "custody_state", CUSTODY_STATES) ?? "unknown";
}

function readBaseline(latestByCategory: LatestByCategory): BaselineState {
  return readEnum(latestByCategory, "security_baseline", BASELINE_STATES) ?? "unknown";
}

function readBadge(latestByCategory: LatestByCategory): BadgeBindingState {
  return readEnum(latestByCategory, "badge_binding", BADGE_STATES) ?? "unknown";
}

function readCharge(latestByCategory: LatestByCategory): ChargeState {
  return readEnum(latestByCategory, "charge_state", CHARGE_STATES) ?? "unknown";
}

function readBatteryHealth(latestByCategory: LatestByCategory): BatteryHealthState {
  return readEnum(latestByCategory, "battery_health", BATTERY_HEALTH_STATES) ?? "unknown";
}

function readTamper(latestByCategory: LatestByCategory): TamperState {
  return readEnum(latestByCategory, "tamper_state", TAMPER_STATES) ?? "unknown";
}

function readDock(latestByCategory: LatestByCategory): DockState {
  return readEnum(latestByCategory, "dock_state", DOCK_STATES) ?? "unknown";
}

function readEnum<T extends string>(
  latestByCategory: LatestByCategory,
  category: NormalizedSignal["category"],
  allowed: readonly T[],
): T | undefined {
  const signal = latestByCategory.get(category);
  if (!signal || typeof signal.value !== "string") {
    return undefined;
  }
  return (allowed as readonly string[]).includes(signal.value)
    ? (signal.value as T)
    : undefined;
}

function readFreshness(latestByCategory: LatestByCategory): Freshness {
  const signal = latestByCategory.get("posture_freshness");
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
