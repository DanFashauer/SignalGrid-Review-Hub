import { CORE_NORMALIZATION_VERSION } from "./core-normalization-version";
import { canonicalJson, deterministicId, digest } from "./util";
import type {
  BadgeBindingState,
  BaselineState,
  BenchmarkSelectionState,
  ShiftContextState,
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
  LocalAuthorityGrantState,
  ManagementHealthState,
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

  // Two sources can speak to whether the account is enabled: the resolved
  // identity row, and an `identity_state` signal from the identity connector.
  // Before this fold the signal was normalized, counted into `signalsUsed`, and
  // never read — so a connector reporting a DISABLED account still produced
  // `identityEnabled: true` and an allow, while the evidence snapshot recorded
  // the signal as an input to a decision it had not influenced.
  const identityEnabledFromRow: boolean | "unknown" =
    identity.state === "enabled"
      ? true
      : identity.state === "disabled"
        ? false
        : "unknown";
  const identityEnabled = foldIdentityEnabled(
    identityEnabledFromRow,
    readBoolean(latestByCategory, "identity_state"),
  );

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
    dockEvidenceFreshness: readDockEvidenceFreshness(latestByCategory),
    dockState: readDock(latestByCategory),
    baselineCompliance: readBaseline(latestByCategory),
    benchmarkSelection: readBenchmarkSelection(latestByCategory),
    shiftContext: readShiftContext(latestByCategory),
    badgeBinding: readBadge(latestByCategory),
    managementHealthState: readManagementHealth(latestByCategory),
    localAuthorityState: readLocalAuthority(latestByCategory),
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
    // osSupported belongs here and was missing. The shipped v1 rules MASK the
    // gap — `healthy-allow` gates on osSupported: true, so an unknown one simply
    // fails to match and the step_up default applies — but createPolicyDraft
    // lets an owner activate any rule set validatePolicyRules accepts, and
    // nothing requires an allow rule to gate on this field. A version whose only
    // allow rule is {deviceManaged: true} would have allowed on unverifiable OS
    // support with the backstop none the wiser. The backstop is the layer that
    // is supposed to hold when the rules do not.
    evidence.osSupported !== "unknown" &&
    evidence.postureFreshness !== "missing" &&
    evidence.postureFreshness !== "unknown" &&
    // "expired" counted as PRESENT, which is the same unearned affirmative in a
    // different coat: a posture answer whose own freshness says it has lapsed is
    // not a posture answer. `posture-stale` catches it in v1; this makes it hold
    // when a custom rule set does not.
    evidence.postureFreshness !== "expired" &&
    // "stale" was MISSING from this ladder while the dock ladder eleven lines
    // below rejected it — the two disagreed about the same word, and posture is
    // the more load-bearing of the two. A stale posture answer passed the
    // backstop, so a custom rule set that does not itself gate on freshness
    // could allow on a compliance answer of unknown age. The shipped v1
    // `posture-stale` rule masks it, which is exactly why it survived: the
    // backstop is the layer that holds when the rules do NOT, and it was not
    // holding. Verified before and after against the real function.
    evidence.postureFreshness !== "stale" &&
    // Dock evidence that EXISTS but is stale, expired, or unreadable is not
    // evidence. "missing" is deliberately absent from this list: no dock at all
    // is a deployment shape, not a degraded signal, and treating the two alike
    // would step up every tenant without dock hardware.
    evidence.dockEvidenceFreshness !== "stale" &&
    evidence.dockEvidenceFreshness !== "expired" &&
    evidence.dockEvidenceFreshness !== "unknown"
  );
}

/**
 * The EXACT set of fields the snapshot digest covers, in one place.
 *
 * WHY THIS EXISTS. `buildSnapshot` and `verifySnapshot` each hand-wrote the same
 * eight-key literal. Two hand-maintained copies of a definition that must agree is
 * the shape this repository keeps finding defects in — and here the failure would
 * have been maximally quiet: add a field to the minting body and forget the
 * verifying one, and every freshly-minted snapshot verifies FALSE, which the
 * operator console renders as "tampered". Drop a field from the verifying body only,
 * and tampering in that field stops being detected at all. One function, two callers,
 * no way to disagree.
 *
 * The parameter is typed as the snapshot's own field set so a future field added to
 * `EvidenceSnapshot` cannot silently miss the digest: it must be added here, or it is
 * deliberately outside the tamper-evidence and that is a visible decision.
 */
type SnapshotDigestFields = Pick<
  EvidenceSnapshot,
  | "tenantId"
  | "decisionId"
  | "capturedAt"
  | "evidence"
  | "signalsUsed"
  | "policyVersionId"
  | "policyVersion"
  | "sourceReferences"
> & Pick<EvidenceSnapshot, "coreNormalizationVersion">;

function snapshotDigestBody(fields: SnapshotDigestFields): string {
  return canonicalJson({
    tenantId: fields.tenantId,
    decisionId: fields.decisionId,
    capturedAt: fields.capturedAt,
    evidence: fields.evidence,
    signalsUsed: fields.signalsUsed,
    policyVersionId: fields.policyVersionId,
    policyVersion: fields.policyVersion,
    sourceReferences: fields.sourceReferences,
    // CONDITIONAL, and this single spread is the entire migration story: an unstamped
    // snapshot's canonical body is byte-identical to the pre-stamp one, so durable rows
    // written before this field existed keep verifying `true` with no version-conditional
    // branch and no precondition anywhere. Both tamper directions still fail — delete the
    // key from a stamped row and it recomputes to the legacy body; add it to a legacy row
    // and it recomputes to a stamped body. Proven by the pinned legacy digest above.
    ...(fields.coreNormalizationVersion === undefined
      ? {}
      : { coreNormalizationVersion: fields.coreNormalizationVersion }),
  });
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
  const fields: SnapshotDigestFields = {
    tenantId,
    decisionId,
    capturedAt,
    evidence,
    signalsUsed,
    policyVersionId: version.id,
    policyVersion: version.version,
    sourceReferences,
    coreNormalizationVersion: CORE_NORMALIZATION_VERSION,
  };
  return {
    id,
    ...fields,
    digest: digest(snapshotDigestBody(fields)),
  };
}

/** Recompute a snapshot digest to confirm it has not been altered. */
export function verifySnapshot(snapshot: EvidenceSnapshot): boolean {
  return digest(snapshotDigestBody(snapshot)) === snapshot.digest;
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

/**
 * Fold the identity row's state together with the connector's `identity_state`
 * signal, worst-wins.
 *
 * The direction is the whole point, and it is deliberately asymmetric:
 *
 * - An affirmative `false` from EITHER source wins. A revoked account must not
 *   be allowed because the other source had not caught up yet.
 * - SILENCE NEVER LOOSENS AND NEVER TIGHTENS. An absent signal leaves the row's
 *   verdict alone, so a fixture with no identity connector behaves exactly as it
 *   did before this fold existed. Equally, an absent signal can never promote an
 *   `"unknown"` row to `true` — an unknown stays unknown, which `policy.ts`
 *   already steps up on.
 *
 * The remaining case — row `true`, signal `true` or `"unknown"` — is `true`.
 */
export function foldIdentityEnabled(
  fromRow: boolean | "unknown",
  fromSignal: boolean | "unknown",
): boolean | "unknown" {
  if (fromRow === false || fromSignal === false) {
    return false;
  }
  if (fromRow === "unknown") {
    return "unknown";
  }
  return true;
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
// Only the two AFFIRMATIVE values are readable from a signal. Absent or
// unrecognized falls back to "unverified" — the same silence-is-not-an-answer
// rule as every other read here, and the value the active v1 rule deliberately
// does not match.
const BENCHMARK_SELECTION_STATES = ["confirmed", "misfit"] as const;
// Same rule for the labor plane: only the two AFFIRMATIVE values are readable;
// absent or unrecognized falls back to "unverified", which the active v1 rule
// deliberately does not match.
const SHIFT_CONTEXT_STATES = ["confirmed", "misfit"] as const;
const BADGE_STATES = ["present", "removed", "forced", "absent"] as const;

/** The dock-family categories whose age the dock connector stamps. */
const DOCK_CATEGORIES = [
  "custody_state",
  "charge_state",
  "battery_health",
  "tamper_state",
  "dock_state",
  "badge_binding",
] as const;

/** Worst-wins, because one stale channel is enough to make the reading unreliable. */
// Exported so proofs can sweep EVERY freshness value instead of hand-listing a
// few. The asymmetry fixed above survived because the core proof enumerated all
// five values for the dock ladder and hand-wrote a single "expired" case for
// posture — 221 green assertions, and the one value that mattered was the one
// nobody wrote down. A `Record<Freshness, …>` is exhaustive by construction: add
// a member to the union and this object fails to compile until it is handled, so
// a list derived from its keys cannot fossilise the way a literal array does.
const FRESHNESS_SEVERITY: Record<Freshness, number> = {
  fresh: 0,
  missing: 1,
  unknown: 2,
  stale: 3,
  expired: 4,
};

/** Every member of the `Freshness` union, derived from the exhaustive severity
 *  map above rather than written out again. Use this in any sweep that must
 *  cover the whole union. */
export const FRESHNESS_VALUES = Object.keys(FRESHNESS_SEVERITY) as readonly Freshness[];

/**
 * The worst freshness across dock signals THAT EXIST. Absent dock evidence
 * stays "missing" — a deployment with no dock is not a degraded deployment, and
 * making it one would step up every such tenant on day one.
 */
function readDockEvidenceFreshness(latestByCategory: LatestByCategory): Freshness {
  let worst: Freshness | undefined;
  for (const category of DOCK_CATEGORIES) {
    const signal = latestByCategory.get(category);
    if (!signal) continue;
    const freshness = signal.freshness ?? "unknown";
    if (worst === undefined || FRESHNESS_SEVERITY[freshness] > FRESHNESS_SEVERITY[worst]) {
      worst = freshness;
    }
  }
  return worst ?? "missing";
}

function readCustody(latestByCategory: LatestByCategory): CustodyState {
  return readEnum(latestByCategory, "custody_state", CUSTODY_STATES) ?? "unknown";
}

function readBaseline(latestByCategory: LatestByCategory): BaselineState {
  return readEnum(latestByCategory, "security_baseline", BASELINE_STATES) ?? "unknown";
}

function readBenchmarkSelection(latestByCategory: LatestByCategory): BenchmarkSelectionState {
  return readEnum(latestByCategory, "benchmark_selection", BENCHMARK_SELECTION_STATES) ?? "unverified";
}

function readShiftContext(latestByCategory: LatestByCategory): ShiftContextState {
  return readEnum(latestByCategory, "shift_context", SHIFT_CONTEXT_STATES) ?? "unverified";
}

function readBadge(latestByCategory: LatestByCategory): BadgeBindingState {
  return readEnum(latestByCategory, "badge_binding", BADGE_STATES) ?? "unknown";
}

// Rollup of the device-management-health family. All three values are readable —
// the family computes them from enrollment, check-in freshness and policy drift —
// but SILENCE reads as "unknown", never as a healthy management plane.
const MANAGEMENT_HEALTH_STATES = ["healthy", "degraded", "broken"] as const;
// Only the two AFFIRMATIVE values are readable for local authority; absent or
// unrecognized falls back to "unverified" — the same day-one-quiet rule as
// benchmark_selection and shift_context, so nothing fires until a connector
// actually emits the signal.
const LOCAL_AUTHORITY_STATES = ["verified", "withheld"] as const;

function readManagementHealth(latestByCategory: LatestByCategory): ManagementHealthState {
  return readEnum(latestByCategory, "device_management_health", MANAGEMENT_HEALTH_STATES) ?? "unknown";
}

function readLocalAuthority(latestByCategory: LatestByCategory): LocalAuthorityGrantState {
  return readEnum(latestByCategory, "local_authority", LOCAL_AUTHORITY_STATES) ?? "unverified";
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
