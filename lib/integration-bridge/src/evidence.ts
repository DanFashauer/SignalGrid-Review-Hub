// The DEVICE-MANAGEMENT EVIDENCE CONTRACT — the owner's source-agnostic
// adapter model (2026-08-11 redirect, intake ledger row 77).
//
// THE CLAIM THIS FILE EXISTS TO MAKE TRUE: SignalGrid should not depend on
// Microsoft first. Any device-management source — Fleet, Headwind, NanoMDM,
// Intune, Jamf, Omnissa — supplies EVIDENCE in this one shape; the bridge
// normalizes it into the core's signal vocabulary; the decision engine never
// learns which vendor produced it. Swapping the open-source lab adapter for
// the Microsoft Graph adapter must change provenance strings and NOTHING
// about a decision — `proof:evidence-adapter` enforces exactly that swap.
//
// The laws every adapter inherits (they are the repo's standing laws, restated
// at the contract boundary because this is where a new source would break them):
//   • Deterministic and pure — reference instants are arguments, never clocks.
//   • Silence for the unanswered — an "unknown" state emits NO draft; the
//     core turns absence into unknown, which raises assurance and never
//     fires an affirmative-bad-state rule (day-one-quiet).
//   • Quality can only lower, never raise — a contradictory or unknown-quality
//     read may not assert any POSITIVE state (managed / compliant / passing);
//     its negative findings stand, because the worst answer a source gave is
//     still an answer.
//   • Adapters supply evidence only. The source system remains the system of
//     record; nothing here enrolls, unlocks, wipes, or remediates anything.
import type { BaselineState, LocalAuthorityGrantState, ManagementHealthState } from "@workspace/signalgrid-core";
import type { FixturePostureRecord } from "@workspace/signalgrid-core";
import { normalizeFleetReport, type FleetHostReport } from "@workspace/fleet-connector";
import type { PostureSignalDraft } from "./index";

/** A provenance string, or undefined when it is absent OR empty — so that `??` can
 *  fall back on both. Provenance is this repository's product; an empty citation
 *  that reads as a present one is the unearned affirmative in miniature. */
function nonEmpty(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The closed set of device-management sources the contract names today.
 * Closed ON PURPOSE: a new source system is a declared event (a new adapter,
 * a new entry here, new proof coverage), not a string that appears one day.
 */
export type EvidenceSourceSystem = "fleet" | "headwind" | "nanomdm" | "intune" | "jamf" | "omnissa";

export type EvidencePlatform = "ios" | "ipados" | "android" | "macos" | "windows" | "linux" | "unknown";
export type EvidenceManagedState = "managed" | "unmanaged" | "unknown";
export type EvidenceComplianceState = "compliant" | "noncompliant" | "unknown";
export type EvidencePolicyState = "passing" | "failing" | "unknown";
export type EvidenceOwnership = "corporate" | "personal" | "shared" | "unknown";
export type EvidenceQuality = "source_verified" | "source_stale" | "partial" | "contradictory" | "unknown";

/** One device's management evidence, from ANY source system. */
export interface DeviceManagementEvidence {
  tenantId: string;
  sourceSystem: EvidenceSourceSystem;
  /** The record's identity INSIDE the source system (host id, device number, managedDevice id). */
  sourceRecordId: string;
  /** SignalGrid's device reference for the same physical device. */
  deviceId: string;
  serialNumber?: string;
  platform: EvidencePlatform;
  managedState: EvidenceManagedState;
  complianceState: EvidenceComplianceState;
  policyState?: EvidencePolicyState;
  ownership?: EvidenceOwnership;
  /** When the SOURCE last saw the device (drives posture freshness). */
  lastSeenAt?: string;
  /** When the ADAPTER read the source. */
  observedAt: string;
  freshUntil?: string;
  evidenceQuality: EvidenceQuality;
  /** Provenance trail — first entry becomes the signals' sourceReference. */
  sourceReferences: string[];
}

/**
 * The quality law, applied once so every consumer inherits it: a contradictory
 * or unknown-quality read has its POSITIVE assertions withdrawn (managed →
 * unknown, compliant → unknown, passing → unknown) while negative findings
 * stand. `source_stale` deliberately does NOT downgrade states — staleness is
 * an AGE fact, and `lastSeenAt` already carries it into the core's freshness
 * grading; collapsing it into state-unknown would double-count the same doubt.
 */
export function effectiveEvidence(evidence: DeviceManagementEvidence): DeviceManagementEvidence {
  if (evidence.evidenceQuality !== "contradictory" && evidence.evidenceQuality !== "unknown") {
    return evidence;
  }
  return {
    ...evidence,
    managedState: evidence.managedState === "managed" ? "unknown" : evidence.managedState,
    complianceState: evidence.complianceState === "compliant" ? "unknown" : evidence.complianceState,
    policyState: evidence.policyState === "passing" ? "unknown" : evidence.policyState,
  };
}

/**
 * Contract → core signal drafts. Silence for every unanswered state; the
 * owner's `noncompliant` spelling translates to the core's `non_compliant`
 * here and nowhere else.
 */
export function deviceManagementEvidenceToDrafts(evidence: DeviceManagementEvidence): PostureSignalDraft[] {
  const e = effectiveEvidence(evidence);
  const observedAt = e.observedAt;
  const drafts: PostureSignalDraft[] = [];
  if (e.managedState === "managed") drafts.push({ category: "device_management", value: true, observedAt });
  else if (e.managedState === "unmanaged") drafts.push({ category: "device_management", value: false, observedAt });
  if (e.complianceState === "compliant") drafts.push({ category: "device_compliance", value: "compliant", observedAt });
  else if (e.complianceState === "noncompliant") drafts.push({ category: "device_compliance", value: "non_compliant", observedAt });
  if (e.policyState === "passing") drafts.push({ category: "security_baseline", value: "aligned", observedAt });
  else if (e.policyState === "failing") drafts.push({ category: "security_baseline", value: "drifted", observedAt });
  return drafts;
}

/** Fields the DM contract does not carry but a full posture record needs. */
export interface EvidenceRecordContext {
  identityRef: string;
  identityEnabled: boolean;
  encrypted: boolean;
  osSupported: boolean;
  managementHealth?: ManagementHealthState;
  localAuthority?: LocalAuthorityGrantState;
}

/**
 * Contract → the core's fixture posture record, for the sync seam
 * (`runFixtureSync` → `evaluateDecision` → evidence).
 *
 * REFUSES unknown management. The record's `managed` field is a boolean, and
 * mapping "unknown" onto `false` would turn an absence into the affirmative
 * bad state DEVICE_UNMANAGED fires on — the unearned NEGATIVE, exactly as
 * forbidden as the unearned affirmative. Unknown-management evidence routes
 * through `deviceManagementEvidenceToDrafts`, where silence is representable.
 */
export function deviceManagementEvidenceToFixtureRecord(
  evidence: DeviceManagementEvidence,
  ctx: EvidenceRecordContext,
): FixturePostureRecord {
  const e = effectiveEvidence(evidence);
  if (e.managedState === "unknown") {
    throw new Error(
      `evidence for ${e.deviceId} (${e.sourceSystem}) cannot become a fixture posture record: ` +
        `managedState is unknown, and the record's boolean would assert "unmanaged" from an absence. ` +
        `Route it through deviceManagementEvidenceToDrafts instead.`,
    );
  }
  const baseline: BaselineState | undefined =
    e.policyState === "passing" ? "aligned" : e.policyState === "failing" ? "drifted" : undefined;
  return {
    deviceRef: e.deviceId,
    identityRef: ctx.identityRef,
    identityEnabled: ctx.identityEnabled,
    managed: e.managedState === "managed",
    compliance: e.complianceState === "noncompliant" ? "non_compliant" : e.complianceState,
    encrypted: ctx.encrypted,
    osSupported: ctx.osSupported,
    lastSyncAt: e.lastSeenAt ?? null,
    ...(baseline ? { baseline } : {}),
    ...(ctx.managementHealth ? { managementHealth: ctx.managementHealth } : {}),
    ...(ctx.localAuthority ? { localAuthority: ctx.localAuthority } : {}),
    // `??` does not skip an EMPTY string, and an empty provenance string reaching a
    // snapshot is an absent citation that reads as a present one.
    sourceReference: nonEmpty(e.sourceReferences[0]) ?? `${e.sourceSystem}:${e.sourceRecordId}`,
  };
}

// ── Adapter: Fleet (the open-source lab source) ─────────────────────────────

/**
 * Fleet host → contract evidence, THROUGH the proven normalizer: compliance
 * and baseline come from `normalizeFleetReport`'s fail-closed grading (screen
 * lock must be observed "on", an enforced OS floor needs a positively observed
 * version), so this adapter cannot re-litigate — or accidentally soften — the
 * connector's own judgement.
 */
export function fleetHostToDeviceManagementEvidence(
  report: FleetHostReport,
  ctx: { tenantId: string; nowIso: string; platform?: EvidencePlatform },
): DeviceManagementEvidence {
  const signal = normalizeFleetReport(report, ctx.nowIso);
  return {
    tenantId: ctx.tenantId,
    sourceSystem: "fleet",
    sourceRecordId: report.hostRef,
    deviceId: report.hostRef,
    // Fleet's host list does not carry platform in FleetHostReport; a caller
    // that knows it may say so, and "unknown" is the honest default.
    platform: ctx.platform ?? "unknown",
    managedState: report.mdmEnrolled ? "managed" : "unmanaged",
    complianceState: signal.deviceCompliance === "non_compliant" ? "noncompliant" : signal.deviceCompliance,
    policyState:
      signal.baselineCompliance === "aligned" ? "passing"
      : signal.baselineCompliance === "drifted" ? "failing"
      : "unknown",
    ownership: "unknown",
    ...(report.lastSeenAt ? { lastSeenAt: report.lastSeenAt } : {}),
    observedAt: ctx.nowIso,
    evidenceQuality: "source_verified",
    sourceReferences: [signal.sourceReference],
  };
}

// ── Adapter: Headwind-shaped Android lab (fixture shape, NOT a family) ──────
//
// The owner's rugged/shared-Android lab path (warehouse scanners, kiosks,
// dedicated devices) as a FIXTURE SHAPE mirroring Headwind MDM community
// edition's device fields — deliberately not a 52nd connector family, because
// the breadth freeze stands and the contract is the point: proving a second
// open-source source flows through the SAME evidence model needs a shape and
// an adapter, not another gated transport.
//
// LIVE-VERIFIED 2026-08-18 against a real Headwind CE 5.30.3 server driven
// over the genuine launcher wire protocol — both the never-synced and the
// healthy-kiosk states reproduced; field mapping and the recorded divergences
// (model nested in `info`, `lastUpdate` epoch-ms, `configApplied` derived
// from two wire fields rather than read) live in
// docs/HEADWIND_LIVE_SHAPE_CHECK.md.

/** A Headwind-community-edition-shaped device row. */
export interface HeadwindLabDevice {
  /** Headwind's device number (its enrollment identity). */
  deviceNumber: string;
  model: string;
  /** Enrolled via Headwind's QR provisioning. */
  enrolled: boolean;
  /** Headwind launcher pinned as the kiosk (dedicated-device mode engaged). */
  kioskLocked: boolean;
  /** Result of the last configuration/profile push. */
  configApplied: "applied" | "failed" | "unknown";
  lastSeenAt: string | null;
}

export const ANDROID_LAB_OBSERVED_AT = "2026-07-16T14:00:00.000Z";

/** Four lab devices: healthy kiosk scanner, failed-config tablet, unenrolled spare, dark scanner. */
export const ANDROID_LAB_DEVICES: HeadwindLabDevice[] = [
  { deviceNumber: "hw-scanner-01", model: "Zebra TC52", enrolled: true, kioskLocked: true, configApplied: "applied", lastSeenAt: "2026-07-16T13:30:00.000Z" },
  { deviceNumber: "hw-tablet-02", model: "Samsung Tab Active4", enrolled: true, kioskLocked: true, configApplied: "failed", lastSeenAt: "2026-07-16T13:45:00.000Z" },
  { deviceNumber: "hw-spare-03", model: "Zebra TC52", enrolled: false, kioskLocked: false, configApplied: "unknown", lastSeenAt: null },
  { deviceNumber: "hw-scanner-04", model: "Honeywell CT45", enrolled: true, kioskLocked: true, configApplied: "applied", lastSeenAt: "2026-07-11T09:00:00.000Z" },
];

/**
 * Headwind-shaped device → contract evidence. A POSITIVE `compliant` demands
 * both the config push applied AND the kiosk actually engaged — the same
 * positive-assertion law the Fleet normalizer applies to screen lock. An
 * unenrolled device answers nothing about compliance (unknown, not bad).
 */
export function headwindLabToDeviceManagementEvidence(
  device: HeadwindLabDevice,
  ctx: { tenantId: string; observedAt: string },
): DeviceManagementEvidence {
  const complianceState: EvidenceComplianceState = !device.enrolled
    ? "unknown"
    : device.configApplied === "failed"
      ? "noncompliant"
      : device.configApplied === "applied" && device.kioskLocked
        ? "compliant"
        : "unknown";
  return {
    tenantId: ctx.tenantId,
    sourceSystem: "headwind",
    sourceRecordId: device.deviceNumber,
    deviceId: device.deviceNumber,
    platform: "android",
    managedState: device.enrolled ? "managed" : "unmanaged",
    complianceState,
    // Enrollment gates policy state exactly as it gates compliance three lines up: an
    // UNENROLLED device with a stale "applied" config push is not a passing policy —
    // it is a device whose policy nobody is currently applying.
    policyState: !device.enrolled
      ? "unknown"
      : device.configApplied === "applied" ? "passing" : device.configApplied === "failed" ? "failing" : "unknown",
    ownership: "shared",
    ...(device.lastSeenAt ? { lastSeenAt: device.lastSeenAt } : {}),
    observedAt: ctx.observedAt,
    evidenceQuality: "source_verified",
    sourceReferences: [`headwind:devices#${device.deviceNumber}`],
  };
}
