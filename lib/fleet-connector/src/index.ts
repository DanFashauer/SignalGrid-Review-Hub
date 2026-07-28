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
import type { AccessOutcome } from "./client";

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

  // A configured OS floor with NO observed OS version is an UNKNOWN high-risk input,
  // not a pass. `belowFloor` is false here only because we cannot SEE the version —
  // which must never read as compliant. When a floor is enforced the observed OS must
  // be positively confirmed, exactly as screen lock must be observed "on" below.
  const osUnknownUnderFloor =
    typeof report.osFloor === "number" && typeof report.osMajor !== "number";

  const hasKnownViolation =
    report.diskEncryption === "off" || belowFloor || report.screenLock === "off";
  // "Fully clean" demands a POSITIVE assertion for every check it covers: screen
  // lock must be observed "on", not merely "not observed off"; the OS must be observed
  // at-or-above the floor, not merely "not observed below". An absent field is how a
  // transport that cannot see it (Fleet's host list, for one) reports it — that host is
  // `unknown`, never `compliant`.
  const fullyClean =
    report.diskEncryption === "on" && !belowFloor && !osUnknownUnderFloor && report.screenLock === "on";

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
    osUnknownUnderFloor ||
    report.screenLock === "off";
  const assurance: AssuranceHint = weak ? "raise_step_up" : "standard";

  const reasons: string[] = [];
  if (!deviceManaged) reasons.push("not MDM-enrolled in Fleet");
  if (!enforceable) reasons.push("unsupervised (kiosk/allowlist/non-removable cannot engage)");
  if (report.diskEncryption !== "on") reasons.push(`disk encryption ${report.diskEncryption}`);
  if (belowFloor) reasons.push(`OS ${report.osMajor} below floor ${report.osFloor}`);
  if (osUnknownUnderFloor) reasons.push(`OS version unknown while floor ${report.osFloor} is enforced`);
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
export {
  FleetClient, toHostReport, fetchTransport,
  type AccessOutcome, type FleetRequest, type FleetResponse,
  type FleetTransport, type FleetClientConfig, type FleetActuation,
} from "./client";

/**
 * Derive the access decision a normalized Fleet posture warrants — the missing link
 * between `normalizeFleetReport` (posture in) and `FleetClient.applyDecision` (enforcement
 * out). Without this, a caller could actuate a hand-picked outcome that the posture never
 * justified, and an unmanaged or non-compliant host would have no effect on enforcement.
 *
 * Fail closed, and never relaxes on an absence: `allow` requires POSITIVE CONFIRMATION
 * OF EVERY decision field, not merely the absence of the `raise_step_up` hint.
 *   • an unmanaged/unenrolled host, or one AFFIRMATIVELY non-compliant (encryption off,
 *     screen lock off, OS below floor) → `restrict`;
 *   • every other combination — an UNKNOWN required check, a non-fresh check-in, an
 *     unenforceable (unsupervised) host, or any raised assurance — → `step_up`;
 *   • ONLY a host that is positively managed, compliant, baseline-aligned, fresh,
 *     enforceable, and standard-assurance → `allow`.
 *
 * The derived `assurance` hint is NEVER trusted on its own: a persisted, deserialized,
 * or independently-constructed `FleetSignal` could carry `standard` while another field
 * is ambiguous (e.g. `deviceCompliance: "unknown"`), and a grant must rest on positive
 * evidence, not on a hint that happened not to be raised. This is an advisory
 * single-dimension mapping — the fabric's final verdict still fuses every dimension via
 * posture-composition (worst-concern-wins); this never lowers that.
 */
export function fleetOutcome(signal: FleetSignal): AccessOutcome {
  if (!signal.deviceManaged) return "restrict";
  if (signal.deviceCompliance === "non_compliant") return "restrict";
  const positivelyHealthy =
    signal.deviceManaged === true &&
    signal.deviceCompliance === "compliant" &&
    signal.baselineCompliance === "aligned" &&
    signal.postureFreshness === "fresh" &&
    signal.enforceable === true &&
    signal.assurance === "standard";
  return positivelyHealthy ? "allow" : "step_up";
}
