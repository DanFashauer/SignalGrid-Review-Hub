// @workspace/ddm-connector — normalize macOS Declarative Device Management (DDM)
// device signals into the decision dimensions the core already understands.
//
// macOS 27 (WWDC 2026) makes DDM the standard: native binary allow/deny via the
// Endpoint Security framework, a declarative privacy posture that replaces PPPC,
// and DDM health reporting. Those are authoritative device signals — exactly what
// the Grid ingests ("the more signals you add, the smarter the Grid becomes").
// This connector is COMPLEMENTARY to OS binary control: the OS decides what may
// launch; SignalGrid decides, in context, whether a sensitive ACTION proceeds —
// and a weak DDM posture should RAISE the assurance it demands, never lower it.
//
// See docs/MACOS_27_DDM_SIGNAL_OPPORTUNITY.md.
//
// Guarantees (same as every other planner in this repo):
//   • Fail closed — any unknown / missing / stale input normalizes to the MORE
//     restrictive value, and can only raise assurance (auto → step-up), never
//     relax it.
//   • Deterministic and pure — timestamps are injected, never read from a clock.
//   • Public-safe fixtures only — no live MDM/vendor calls.

import type { BaselineState, ComplianceState, Freshness } from "@workspace/signalgrid-core";

/** Binary-control posture reported over DDM / Endpoint Security. */
export type BinaryControl = "enforced" | "permissive" | "disabled" | "unknown";
/** Declarative privacy (PPPC replacement) posture. */
export type PrivacyPosture = "declared" | "partial" | "missing" | "unknown";
/** DDM device-health status. */
export type DdmHealth = "healthy" | "degraded" | "unreporting" | "unknown";

/**
 * How a device's SOFTWARE-UPDATE enforcement is delivered.
 *   • declarative — the surviving DDM model (device holds policy, self-reports).
 *   • legacy      — the old MDM command/restriction model. On OS 27+ Apple made
 *                   this silently non-functional: the command doesn't fail, it's
 *                   gone. On pre-27 it still works but dies on the upgrade.
 *   • none        — no update enforcement configured at all.
 *   • unknown     — not reported / unverifiable.
 */
export type UpdateEnforcement = "declarative" | "legacy" | "none" | "unknown";

/**
 * Whether a device's update enforcement is actually in force — the OS-27 cutover
 * turned "looks managed" into "silently not enforcing" for legacy configs.
 *   • current — declarative enforcement, live.
 *   • at_risk — legacy on a pre-27 (or unverifiable-OS) device: works now, dies
 *               on the OS-27 upgrade — migrate before then.
 *   • dead    — legacy on OS 27+ (a no-op) or no enforcement at all: nothing is
 *               being enforced, so a "compliant"/"patched" claim is not trustworthy.
 *   • unknown — enforcement mechanism unreported/unverifiable — fail-safe, not trusted.
 */
export type EnforcementCurrency = "current" | "at_risk" | "dead" | "unknown";

/** A DDM device report — what a managed Mac declares back to the control plane. */
export interface DdmDeviceReport {
  deviceRef: string;
  /** Enrolled in Declarative Device Management. */
  enrolled: boolean;
  health: DdmHealth;
  /** Native binary allow/deny enforcement state (Endpoint Security). */
  binaryControl: BinaryControl;
  /** Declarative privacy declaration state (replaces PPPC/TCC prompts). */
  privacy: PrivacyPosture;
  /** ISO timestamp of the last DDM check-in, or null if never. */
  lastCheckInAt: string | null;
  /** OS major version (e.g. 27). Undocumented → treated as unknown (fail-safe). */
  osMajor?: number;
  /** How software-update enforcement is delivered. Absent → unknown (fail-safe). */
  updateEnforcement?: UpdateEnforcement;
  sourceReference?: string;
}

/** How much the DDM posture should move the assurance bar for a sensitive action. */
export type AssuranceHint = "standard" | "raise_step_up";

/** DDM signals normalized to the core's decision dimensions (+ an assurance hint). */
export interface DdmSignal {
  deviceRef: string;
  deviceManaged: boolean;
  deviceCompliance: ComplianceState;
  baselineCompliance: BaselineState;
  postureFreshness: Freshness;
  /** Whether software-update enforcement is actually in force (OS-27 cutover aware). */
  enforcementCurrency: EnforcementCurrency;
  /** Advisory: raise a sensitive action auto → step-up when the posture is weak. */
  assurance: AssuranceHint;
  rationale: string;
  sourceReference: string;
}

// A DDM check-in older than this is stale; older still (or never) is missing.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
const MISSING_AFTER_MS = 72 * 60 * 60 * 1000; // 72h

function freshnessOf(lastCheckInAt: string | null, nowMs: number): Freshness {
  if (!lastCheckInAt) return "missing";
  const ts = Date.parse(lastCheckInAt);
  if (Number.isNaN(ts)) return "unknown";
  const age = nowMs - ts;
  if (age < 0) return "unknown"; // report from the future → don't trust it
  if (age <= STALE_AFTER_MS) return "fresh";
  if (age <= MISSING_AFTER_MS) return "stale";
  return "expired";
}

/** OS major at/after which legacy MDM software-update enforcement is a no-op. */
const DDM_UPDATE_CUTOVER_OS = 27;

/**
 * Resolve whether a device's software-update enforcement is actually in force —
 * fail-safe around the OS-27 cutover. `declarative` is current; `legacy` is DEAD
 * on OS 27+ (silently non-functional) and AT RISK on a known pre-27 device;
 * `none` is dead; anything unverifiable (unknown OS under legacy, or an
 * unreported/unmapped mechanism) never passes as current. Only an EXACTLY
 * recognized `declarative` value is trusted — an untyped/unknown value fails safe.
 */
export function enforcementCurrencyOf(report: DdmDeviceReport): EnforcementCurrency {
  const mode = report.updateEnforcement;
  const os = report.osMajor;
  if (mode === "declarative") return "current";
  if (mode === "none") return "dead";
  if (mode === "legacy") {
    if (typeof os === "number" && os >= DDM_UPDATE_CUTOVER_OS) return "dead";
    if (typeof os === "number" && os < DDM_UPDATE_CUTOVER_OS) return "at_risk";
    // Legacy but the OS can't be confirmed pre-cutover → we cannot trust it still
    // enforces; flag it (never "current").
    return "at_risk";
  }
  // Not reported / unmapped → cannot confirm any enforcement at all.
  return "unknown";
}

/**
 * Normalize one DDM device report into decision-dimension signals.
 *
 * Mapping (fail-closed):
 *   • enrolled          → deviceManaged (unenrolled ⇒ not managed).
 *   • health            → deviceCompliance (healthy ⇒ compliant; degraded ⇒
 *                         non_compliant; unreporting/unknown ⇒ unknown).
 *   • binaryControl     → baselineCompliance (enforced ⇒ aligned; permissive ⇒
 *                         drifted; disabled ⇒ drifted; unknown ⇒ unknown).
 *   • lastCheckInAt+now → postureFreshness.
 *   • assurance         → raise_step_up when binary control is not enforced, the
 *                         privacy declaration is incomplete, health is degraded,
 *                         the device is unenrolled, or the posture is stale/older.
 */
export function normalizeDdmReport(report: DdmDeviceReport, nowIso: string): DdmSignal {
  const nowMs = Date.parse(nowIso);
  const deviceManaged = report.enrolled === true;

  const deviceCompliance: ComplianceState =
    report.health === "healthy" ? "compliant" :
    report.health === "degraded" ? "non_compliant" :
    "unknown";

  const baselineCompliance: BaselineState =
    report.binaryControl === "enforced" ? "aligned" :
    report.binaryControl === "permissive" || report.binaryControl === "disabled" ? "drifted" :
    "unknown";

  const postureFreshness = freshnessOf(report.lastCheckInAt, nowMs);
  const enforcementCurrency = enforcementCurrencyOf(report);

  // Any of these weak-posture conditions raises the assurance bar. This can only
  // make a sensitive action MORE gated (auto → step-up), never less.
  const weak =
    !deviceManaged ||
    report.binaryControl !== "enforced" ||
    report.privacy !== "declared" ||
    // Any non-healthy health (degraded, but also unreporting/unknown, which leave
    // deviceCompliance unknown) raises assurance — an ambiguous health signal
    // must fail closed, not pass as standard.
    report.health !== "healthy" ||
    // Anything other than a positively-fresh check-in raises assurance — an
    // unknown/unverifiable freshness must fail closed, not pass as standard.
    postureFreshness !== "fresh" ||
    // Update enforcement that isn't provably current raises assurance. This is the
    // OS-27 cutover fail-safe: a device can report healthy/compliant while its
    // legacy update enforcement is silently a no-op — the "compliant" is not
    // trustworthy, so gate the sensitive action rather than assume it's patched.
    enforcementCurrency !== "current";
  const assurance: AssuranceHint = weak ? "raise_step_up" : "standard";

  const reasons: string[] = [];
  if (!deviceManaged) reasons.push("not DDM-enrolled");
  if (report.binaryControl !== "enforced") reasons.push(`binary control ${report.binaryControl}`);
  if (report.privacy !== "declared") reasons.push(`privacy ${report.privacy}`);
  if (report.health === "degraded") reasons.push("health degraded");
  if (postureFreshness !== "fresh") reasons.push(`check-in ${postureFreshness}`);
  if (enforcementCurrency === "dead") reasons.push("update enforcement dead (legacy on OS 27+ / none — not enforcing)");
  else if (enforcementCurrency === "at_risk") reasons.push("update enforcement at risk (legacy — dies on OS 27)");
  else if (enforcementCurrency === "unknown") reasons.push("update enforcement unverified");
  const rationale = reasons.length ? reasons.join(", ") : "DDM posture healthy — enforced, declared, fresh, update enforcement current";

  return {
    deviceRef: report.deviceRef,
    deviceManaged,
    deviceCompliance,
    baselineCompliance,
    postureFreshness,
    enforcementCurrency,
    assurance,
    rationale,
    sourceReference: report.sourceReference ?? `fixture:ddm:reports#${report.deviceRef}`,
  };
}

/** Normalize a batch of DDM reports. Deterministic; input order preserved. */
export function normalizeDdmReports(reports: DdmDeviceReport[], nowIso: string): DdmSignal[] {
  return reports.map((r) => normalizeDdmReport(r, nowIso));
}

export interface DdmSummary {
  devices: number;
  managed: number;
  binaryEnforced: number;
  privacyDeclared: number;
  /** Devices whose update enforcement is a silent no-op (legacy on OS 27+ / none). */
  enforcementDead: number;
  /** Devices whose legacy enforcement still works but dies on the OS-27 upgrade. */
  enforcementAtRisk: number;
  raiseStepUp: number;
}

export function ddmSummary(signals: DdmSignal[], reports: DdmDeviceReport[]): DdmSummary {
  return {
    devices: signals.length,
    managed: signals.filter((s) => s.deviceManaged).length,
    binaryEnforced: reports.filter((r) => r.binaryControl === "enforced").length,
    privacyDeclared: reports.filter((r) => r.privacy === "declared").length,
    enforcementDead: signals.filter((s) => s.enforcementCurrency === "dead").length,
    enforcementAtRisk: signals.filter((s) => s.enforcementCurrency === "at_risk").length,
    raiseStepUp: signals.filter((s) => s.assurance === "raise_step_up").length,
  };
}

import { DEMO_DDM_REPORTS, DDM_OBSERVED_AT } from "./fixture";
export { DEMO_DDM_REPORTS, DDM_OBSERVED_AT } from "./fixture";
