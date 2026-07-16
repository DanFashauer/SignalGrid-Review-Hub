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

  // Any of these weak-posture conditions raises the assurance bar. This can only
  // make a sensitive action MORE gated (auto → step-up), never less.
  const weak =
    !deviceManaged ||
    report.binaryControl !== "enforced" ||
    report.privacy !== "declared" ||
    report.health === "degraded" ||
    // Anything other than a positively-fresh check-in raises assurance — an
    // unknown/unverifiable freshness must fail closed, not pass as standard.
    postureFreshness !== "fresh";
  const assurance: AssuranceHint = weak ? "raise_step_up" : "standard";

  const reasons: string[] = [];
  if (!deviceManaged) reasons.push("not DDM-enrolled");
  if (report.binaryControl !== "enforced") reasons.push(`binary control ${report.binaryControl}`);
  if (report.privacy !== "declared") reasons.push(`privacy ${report.privacy}`);
  if (report.health === "degraded") reasons.push("health degraded");
  if (postureFreshness !== "fresh") reasons.push(`check-in ${postureFreshness}`);
  const rationale = reasons.length ? reasons.join(", ") : "DDM posture healthy — enforced, declared, fresh";

  return {
    deviceRef: report.deviceRef,
    deviceManaged,
    deviceCompliance,
    baselineCompliance,
    postureFreshness,
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
  raiseStepUp: number;
}

export function ddmSummary(signals: DdmSignal[], reports: DdmDeviceReport[]): DdmSummary {
  return {
    devices: signals.length,
    managed: signals.filter((s) => s.deviceManaged).length,
    binaryEnforced: reports.filter((r) => r.binaryControl === "enforced").length,
    privacyDeclared: reports.filter((r) => r.privacy === "declared").length,
    raiseStepUp: signals.filter((s) => s.assurance === "raise_step_up").length,
  };
}

import { DEMO_DDM_REPORTS, DDM_OBSERVED_AT } from "./fixture";
export { DEMO_DDM_REPORTS, DDM_OBSERVED_AT } from "./fixture";
