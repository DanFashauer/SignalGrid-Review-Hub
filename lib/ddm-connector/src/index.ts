// @workspace/ddm-connector — normalize Apple (macOS / iOS / visionOS) Declarative Device
// Management (DDM) device signals into the decision dimensions the core already understands.
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
 * How the device is enrolled, verbatim from Apple's `mdm.enrollment-type` status item
 * (rangelist: none | supervised | device | user), plus `unknown` for absent/unrecognized.
 *
 * Golden rule 4 rests on SUPERVISION specifically — a supervised device is the only one
 * an MDM can actually hold — so `supervised` is the single value that reads as supervised.
 * Every other value, including a wire value Apple has not published, reads as unknown.
 */
export type EnrollmentType = "none" | "supervised" | "device" | "user" | "unknown";

/**
 * The device's operating-system family, as Apple names it in every status item's
 * `supportedOS` block and reports it in `device.operating-system.family`. iPadOS sits
 * under Apple's `iOS` key. A family outside this list (including an `iPadOS` wire value,
 * if a device ever sends one) normalizes to unknown, which tightens.
 */
export const DDM_PLATFORMS = ["iOS", "macOS", "tvOS", "visionOS", "watchOS"] as const;
export type DevicePlatform = (typeof DDM_PLATFORMS)[number];

/**
 * Apple's `supportedOS` for `mdm.is-return-to-service` at the pin: the OS major the item
 * was introduced in, or null where Apple marks it `n/a` (the device never reports it).
 * `proof:ddm-connector` holds this table against the vendored YAML.
 */
export const RETURN_TO_SERVICE_INTRODUCED: Readonly<Record<DevicePlatform, number | null>> = Object.freeze({
  iOS: 27,
  macOS: null,
  tvOS: null,
  visionOS: 27,
  watchOS: null,
});

/**
 * Apple's `mdm.is-return-to-service` (27.0): "If true, the device is using the return to
 * service with app preservation mode" — a standing shared-device configuration, NOT an
 * erase in flight.
 *
 *   • in_service           — the item is reported `false`.
 *   • rts_app_preservation — the item is reported `true`: the device is configured to
 *                            erase and re-provision with its apps kept when it is returned.
 *                            A configured mode; it does not raise assurance on THIS axis.
 *                            It does on update currency: Apple, "If Return to Service with
 *                            app preservation is active, the device disables software
 *                            updates—both automatic and user-initiated"; they apply only at
 *                            a reset, whose cadence this connector cannot see.
 *   • not_applicable       — Apple never reports this item here: macOS/tvOS/watchOS. Its
 *                            absence says nothing.
 *   • unknown              — the item applies and was not reported, or the platform / OS
 *                            version is unknown or not a whole major, or a value arrived
 *                            where Apple sends none. Tightens, like every other unknown here.
 *                            An iOS/visionOS release before 27 also reads unknown: Apple-
 *                            correct would be not_applicable (the item arrived in 27.0), but
 *                            that loosening is not on the approved list (docs/BUILD_BACKLOG.md).
 *
 * Whether a device is being erased and handed on RIGHT NOW is not observable from this
 * item. That fact lives in the MDM command status of the EraseDevice-with-Return-to-Service
 * command, or in a `device_returned` event (docs/BUILD_BACKLOG.md), not here.
 */
export type ReturnToServiceState = "in_service" | "rts_app_preservation" | "not_applicable" | "unknown";

/** Apple's published rangelist for `mdm.enrollment-type`, plus nothing. A wire value
 *  outside it is not silently accepted — it normalizes to `unknown`, which tightens. */
export const DDM_ENROLLMENT_TYPES = ["none", "supervised", "device", "user"] as const;

/** Normalize the `mdm.enrollment-type` status value. Absent or unrecognized → unknown. */
export function enrollmentTypeOf(report: DdmDeviceReport): EnrollmentType {
  const raw = report.enrollmentType;
  return typeof raw === "string" && (DDM_ENROLLMENT_TYPES as readonly string[]).includes(raw)
    ? (raw as EnrollmentType)
    : "unknown";
}

/** Normalize the `device.operating-system.family` value. Absent or unrecognized → unknown. */
export function platformOf(report: DdmDeviceReport): DevicePlatform | "unknown" {
  return DDM_PLATFORMS.find((p) => p === report.platform) ?? "unknown";
}

/** Normalize `mdm.is-return-to-service` against where Apple actually reports it. Fail
 *  closed: an unknown platform or OS version is unknown, never not_applicable. */
export function returnToServiceStateOf(report: DdmDeviceReport): ReturnToServiceState {
  const platform = platformOf(report);
  if (platform === "unknown") return "unknown";
  const introduced = RETURN_TO_SERVICE_INTRODUCED[platform];
  if (introduced === null) {
    // Apple never sends the item here; a value that arrived anyway means the platform or
    // the report is wrong, so it reads unknown rather than being ignored.
    return report.returnToService === undefined ? "not_applicable" : "unknown";
  }
  // Pre-27, garbage (0, -1, 26.9) or absent → unknown. If pre-27 not_applicable is ever
  // signed off, bound it to a whole major >= Apple's device.operating-system.version floor
  // (iOS 15, visionOS 1), never just `< 27`.
  const os = report.osMajor;
  if (!(typeof os === "number" && Number.isInteger(os) && os >= introduced)) return "unknown";
  if (report.returnToService === true) return "rts_app_preservation";
  if (report.returnToService === false) return "in_service";
  return "unknown";
}

/**
 * Whether a device's update enforcement is actually in force — the OS-27 cutover
 * turned "looks managed" into "silently not enforcing" for legacy configs.
 *   • current — declarative enforcement, live.
 *   • at_risk — legacy on a pre-27 (or unverifiable-OS) device: works now, dies
 *               on the OS-27 upgrade — migrate before then.
 *   • dead    — legacy on OS 27+ (a no-op) or no enforcement at all: nothing is
 *               being enforced, so a "compliant"/"patched" claim is not trustworthy.
 *   • unknown — enforcement mechanism unreported/unverifiable — fail-safe, not trusted.
 *               Includes declarative on a device in return-to-service-with-app-preservation
 *               mode: Apple disables its software updates except at a reset, and the
 *               reset cadence is not visible here.
 */
export type EnforcementCurrency = "current" | "at_risk" | "dead" | "unknown";

/** A DDM device report — what a managed device declares back to the control plane. */
export interface DdmDeviceReport {
  deviceRef: string;
  /** Enrolled in Declarative Device Management. */
  enrolled: boolean;
  health: DdmHealth;
  /** macOS: native binary allow/deny enforcement state (Endpoint Security). iOS has no
   *  Endpoint Security; the iOS fixtures use `enforced` as a stand-in for the supervised
   *  app allow-list, and no ingest path produces it yet, so a real iOS report reads
   *  unknown here and raises (docs/BUILD_BACKLOG.md). */
  binaryControl: BinaryControl;
  /** macOS: declarative privacy declaration state (replaces PPPC/TCC prompts). No iOS
   *  meaning is defined; the iOS fixtures carry `declared` as a stand-in only, so a real
   *  iOS report reads unknown here and raises (docs/BUILD_BACKLOG.md). */
  privacy: PrivacyPosture;
  /** ISO timestamp of the last DDM check-in, or null if never. */
  lastCheckInAt: string | null;
  /** OS major version (e.g. 27). Undocumented → treated as unknown (fail-safe). */
  osMajor?: number;
  /** How software-update enforcement is delivered. Absent → unknown (fail-safe). */
  updateEnforcement?: UpdateEnforcement;
  /** `mdm.enrollment-type` (27.0). Absent → unknown, which raises assurance. */
  enrollmentType?: EnrollmentType;
  /** `device.operating-system.family`. Absent or unrecognized → unknown (fail-safe). */
  platform?: DevicePlatform;
  /** `mdm.is-return-to-service` (iOS/visionOS 27.0; n/a on macOS/tvOS/watchOS). Absent
   *  where it applies → unknown, which raises assurance. */
  returnToService?: boolean;
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
  /** Apple-reported enrollment type; `supervised` is the only supervised answer. */
  enrollmentType: EnrollmentType;
  /** True ONLY for an explicit `supervised`. An unknown enrollment is not supervision. */
  supervised: boolean;
  /** Apple's return-to-service-with-app-preservation state, platform-aware. */
  returnToService: ReturnToServiceState;
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
  // freshness: local-by-design — same rule, but this package cannot import @workspace/integrations without a new workspace dependency and a lockfile regeneration; folded copy pending that change (tolerance 0; future check-in already reads `unknown`)
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
  if (mode === "declarative") return returnToServiceStateOf(report) === "rts_app_preservation" ? "unknown" : "current";
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
  const enrollmentType = enrollmentTypeOf(report);
  const supervised = enrollmentType === "supervised";
  const returnToService = returnToServiceStateOf(report);

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
    enforcementCurrency !== "current" ||
    // 27.0 status items, both unknown-tightens. An unsupervised or unreported
    // enrollment cannot carry a supervision claim. On the return-to-service axis only
    // UNKNOWN raises: an item Apple never reports on this platform cannot be missing, and
    // app preservation is a configured mode — it raises through enforcementCurrency above,
    // because Apple disables its software updates except at a reset.
    !supervised ||
    returnToService === "unknown";
  const assurance: AssuranceHint = weak ? "raise_step_up" : "standard";

  const reasons: string[] = [];
  if (!deviceManaged) reasons.push("not DDM-enrolled");
  if (report.binaryControl !== "enforced") reasons.push(`binary control ${report.binaryControl}`);
  if (report.privacy !== "declared") reasons.push(`privacy ${report.privacy}`);
  if (report.health === "degraded") reasons.push("health degraded");
  if (postureFreshness !== "fresh") reasons.push(`check-in ${postureFreshness}`);
  if (enforcementCurrency === "dead") reasons.push("update enforcement dead (legacy on OS 27+ / none — not enforcing)");
  else if (enforcementCurrency === "at_risk") reasons.push("update enforcement at risk (legacy — dies on OS 27)");
  else if (enforcementCurrency === "unknown") {
    reasons.push(returnToService === "rts_app_preservation" && report.updateEnforcement === "declarative"
      ? "update enforcement reset-bound (RTS app preservation: updates apply only at reset)"
      : "update enforcement unverified");
  }
  if (!supervised) reasons.push(`enrollment ${enrollmentType} (not supervised)`);
  if (returnToService === "unknown") reasons.push("return-to-service state unknown");
  const rationale = reasons.length
    ? reasons.join(", ")
    : "DDM posture healthy — enforced, declared, fresh, update enforcement current, supervised";

  return {
    deviceRef: report.deviceRef,
    deviceManaged,
    deviceCompliance,
    baselineCompliance,
    postureFreshness,
    enforcementCurrency,
    enrollmentType,
    supervised,
    returnToService,
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
  /** Devices Apple reports as SUPERVISED. An unknown enrollment is not counted here. */
  supervised: number;
  /** Devices reporting `mdm.is-return-to-service` true: configured for return to service
   *  with app preservation. A standing mode, not an erase in flight. */
  returnToService: number;
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
    supervised: signals.filter((s) => s.supervised).length,
    returnToService: signals.filter((s) => s.returnToService === "rts_app_preservation").length,
    raiseStepUp: signals.filter((s) => s.assurance === "raise_step_up").length,
  };
}

import { DEMO_DDM_REPORTS, DDM_OBSERVED_AT } from "./fixture";
export { DEMO_DDM_REPORTS, DDM_OBSERVED_AT } from "./fixture";
export * from "./apple-schema";
