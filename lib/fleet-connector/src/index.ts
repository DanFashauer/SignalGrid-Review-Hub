// @workspace/fleet-connector — normalize Fleet (open-source, osquery-based MDM)
// host posture into SignalGrid decision signals.
//
// Fleet (github.com/fleetdm/fleet, MIT) is a two-way fit for SignalGrid:
//   • Signal SOURCE — osquery gives live posture (MDM enrollment, supervision,
//     disk encryption, OS/patch level, screen lock, last check-in). This module
//     maps that raw host report to the SAME decision dimensions the DDM connector
//     produces, so the DecisionEngine consumes it identically.
//   • Enforcement ACTUATOR — Fleet config profiles / DDM apply the restrictions
//     SignalGrid decides (kiosk/allowlist/non-removable). That lives in the Fleet
//     API client + fleet/ profiles, not here.
//
// Design (mirrors @workspace/ddm-connector):
//   • Deterministic and pure — `now` is injected, never read from a clock.
//   • Fail closed — any unknown / missing / stale input normalizes to the MORE
//     restrictive posture and raises the assurance bar (auto → step-up).
//   • Supervision-aware — only a SUPERVISED host can actually be kiosked /
//     restricted / made non-removable, so that is surfaced as `enforceable`.

import type { BaselineState, ComplianceState, Freshness } from "@workspace/signalgrid-core";

export type DiskEncryption = "on" | "off" | "unknown";
export type ScreenLock = "on" | "off" | "unknown";

/** A Fleet host's posture, sourced from Fleet's REST API / osquery. */
export interface FleetHostReport {
  hostRef: string;
  /** MDM-enrolled in Fleet. */
  mdmEnrolled: boolean;
  /** Supervised (ADE/ABM). Required for ASAM / allowlist / non-removable to engage. */
  supervised: boolean;
  /** Disk encryption (FileVault on macOS / data protection on iOS). */
  diskEncryption: DiskEncryption;
  /** Passcode / screen lock set. Absent → not asserted (fail-safe, not a pass). */
  screenLock?: ScreenLock;
  /** OS major version. Absent → unknown (fail-safe). */
  osMajor?: number;
  /** Org-required minimum OS major. Absent → floor not enforced. */
  osFloor?: number;
  /** ISO timestamp of the last osquery check-in, or null if never. */
  lastSeenAt: string | null;
  sourceReference?: string;
}

/** How much the posture should move the assurance bar for a sensitive action. */
export type AssuranceHint = "standard" | "raise_step_up";

/** Fleet posture normalized to the core's decision dimensions (+ hints). */
export interface FleetSignal {
  hostRef: string;
  deviceManaged: boolean;
  deviceCompliance: ComplianceState;
  baselineCompliance: BaselineState;
  postureFreshness: Freshness;
  /** Whether OS-level enforcement (kiosk/allowlist/non-removable) can engage. */
  enforceable: boolean;
  /** Advisory: raise a sensitive action auto → step-up when the posture is weak. */
  assurance: AssuranceHint;
  rationale: string;
  sourceReference: string;
}

// A check-in older than this is stale; older still (or never) is missing.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
const MISSING_AFTER_MS = 72 * 60 * 60 * 1000; // 72h

function freshnessOf(lastSeenAt: string | null, nowMs: number): Freshness {
  if (!lastSeenAt) return "missing";
  const ts = Date.parse(lastSeenAt);
  if (Number.isNaN(ts)) return "unknown";
  const age = nowMs - ts;
  if (age < 0) return "unknown"; // report from the future → don't trust it
  if (age <= STALE_AFTER_MS) return "fresh";
  if (age <= MISSING_AFTER_MS) return "stale";
  return "expired";
}

/**
 * Normalize one Fleet host report into decision-dimension signals.
 *
 * Mapping (fail-closed):
 *   • mdmEnrolled       → deviceManaged.
 *   • diskEncryption /  → deviceCompliance: a KNOWN violation (encryption off, OS
 *     osFloor / screenLock  below floor, screen lock off) ⇒ non_compliant; fully
 *                         clean ⇒ compliant; anything unverifiable ⇒ unknown.
 *   • diskEncryption    → baselineCompliance (on ⇒ aligned; off ⇒ drifted; else unknown).
 *   • lastSeenAt + now  → postureFreshness.
 *   • supervised        → enforceable (can the device actually be locked down?).
 *   • assurance         → raise_step_up on any weak-posture condition.
 */
export function normalizeFleetReport(report: FleetHostReport, nowIso: string): FleetSignal {
  const nowMs = Date.parse(nowIso);
  const deviceManaged = report.mdmEnrolled === true;

  const belowFloor =
    typeof report.osMajor === "number" &&
    typeof report.osFloor === "number" &&
    report.osMajor < report.osFloor;

  const hasKnownViolation =
    report.diskEncryption === "off" || belowFloor || report.screenLock === "off";
  const fullyClean =
    report.diskEncryption === "on" && !belowFloor && report.screenLock !== "off";

  const deviceCompliance: ComplianceState =
    hasKnownViolation ? "non_compliant" : fullyClean ? "compliant" : "unknown";

  const baselineCompliance: BaselineState =
    report.diskEncryption === "on" ? "aligned" :
    report.diskEncryption === "off" ? "drifted" :
    "unknown";

  const postureFreshness = freshnessOf(report.lastSeenAt, nowMs);
  const enforceable = report.supervised === true;

  // Any weak-posture condition raises the assurance bar. This can only make a
  // sensitive action MORE gated (auto → step-up), never less.
  const weak =
    !deviceManaged ||
    !enforceable ||                 // unsupervised → can't be locked down, trust less
    report.diskEncryption !== "on" ||
    deviceCompliance !== "compliant" ||
    postureFreshness !== "fresh" ||
    belowFloor ||
    report.screenLock === "off";
  const assurance: AssuranceHint = weak ? "raise_step_up" : "standard";

  const reasons: string[] = [];
  if (!deviceManaged) reasons.push("not MDM-enrolled in Fleet");
  if (!enforceable) reasons.push("unsupervised (kiosk/allowlist/non-removable cannot engage)");
  if (report.diskEncryption !== "on") reasons.push(`disk encryption ${report.diskEncryption}`);
  if (belowFloor) reasons.push(`OS ${report.osMajor} below floor ${report.osFloor}`);
  if (report.screenLock === "off") reasons.push("screen lock off");
  if (postureFreshness !== "fresh") reasons.push(`check-in ${postureFreshness}`);
  const rationale = reasons.length
    ? reasons.join(", ")
    : "Fleet posture healthy — enrolled, supervised, encrypted, fresh";

  return {
    hostRef: report.hostRef,
    deviceManaged,
    deviceCompliance,
    baselineCompliance,
    postureFreshness,
    enforceable,
    assurance,
    rationale,
    sourceReference: report.sourceReference ?? `fixture:fleet:hosts#${report.hostRef}`,
  };
}

/** Normalize a batch of Fleet reports. Deterministic; input order preserved. */
export function normalizeFleetReports(reports: FleetHostReport[], nowIso: string): FleetSignal[] {
  return reports.map((r) => normalizeFleetReport(r, nowIso));
}

export interface FleetSummary {
  hosts: number;
  managed: number;
  /** Hosts on which OS-level enforcement can actually engage (supervised). */
  enforceable: number;
  diskEncrypted: number;
  nonCompliant: number;
  raiseStepUp: number;
}

export function fleetSummary(signals: FleetSignal[], reports: FleetHostReport[]): FleetSummary {
  return {
    hosts: signals.length,
    managed: signals.filter((s) => s.deviceManaged).length,
    enforceable: signals.filter((s) => s.enforceable).length,
    diskEncrypted: reports.filter((r) => r.diskEncryption === "on").length,
    nonCompliant: signals.filter((s) => s.deviceCompliance === "non_compliant").length,
    raiseStepUp: signals.filter((s) => s.assurance === "raise_step_up").length,
  };
}

export { DEMO_FLEET_REPORTS, FLEET_OBSERVED_AT } from "./fixture";
