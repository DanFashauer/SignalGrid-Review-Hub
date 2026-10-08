// The device-management-health proof's enumeration domains, exhaustive BY CONSTRUCTION.
//
// They used to be plain `Record<string, readonly unknown[]>`, so a new contract FIELD or a
// new enum MEMBER could be added without updating them and the proof stayed green (the
// pinned combo count only counted the arrays that existed). Now:
//   - `domains` must have an entry for every judged field of the normalized contract, and
//     each entry is a tuple the compiler checks contains EVERY member of that field's own
//     union (`allOf`);
//   - `rawDomains` must have an entry for every wire key the connector registers
//     (`DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS`) plus the build-time `__alias` toggle.
// `scripts/check-dmh-domains-exhaustive.mjs` plants mutants and requires the compiler to
// reject each.
import type { NormalizedDeviceManagementHealth, DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS } from "@workspace/integrations/device-management-health";
import { allOf } from "./exhaustive-domain.js";

type N = NormalizedDeviceManagementHealth;
type JudgedField = Exclude<keyof N, "sourceSystem" | "deviceId" | "source">;

export const domains: Record<JudgedField, readonly unknown[]> = {
  mdmCheckInFreshness: allOf<N["mdmCheckInFreshness"]>()(["fresh", "stale", "never", "unknown"]),
  agentCheckInFreshness: allOf<N["agentCheckInFreshness"]>()(["fresh", "stale", "never", "not_applicable", "unknown"]),
  remediationHealth: allOf<N["remediationHealth"]>()(["healthy", "issues_detected", "failed", "not_applicable", "unknown"]),
  policyDrift: allOf<N["policyDrift"]>()(["on_baseline", "drifted", "unknown"]),
  complianceCoverage: allOf<N["complianceCoverage"]>()(["covered", "uncovered", "unknown"]),
  enrollmentState: allOf<N["enrollmentState"]>()(["enrolled", "failed", "retired", "unknown"]),
  managementReachable: allOf<N["managementReachable"]>()([true, false, null]),
  rootCauseEvidence: allOf<N["rootCauseEvidence"]>()(["available", "unavailable", "not_supported", "unknown"]),
  reportIntegrity: allOf<N["reportIntegrity"]>()(["clean", "malformed"]),
};

export const rawDomains: Record<(typeof DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS)[number] | "__alias", readonly unknown[]> = {
  // Every enum field carries the same six wire CLASSES: the allowed spellings, an
  // omitted key, a JSON null, and a junk value. The two new fields were originally
  // asymmetric — `agentCheckInFreshness` omitted `null` and `remediationHealth` omitted
  // the literal `"unknown"` — while `PARSEABLE_RAW` below listed both, so the
  // parse-fidelity pass advertised coverage of two cells it never produced.
  mdmCheckInFreshness: ["fresh", "stale", "never", "unknown", undefined, null, "very_old"],
  agentCheckInFreshness: ["fresh", "stale", "never", "not_applicable", "unknown", undefined, null, 7],
  remediationHealth: ["healthy", "issues_detected", "failed", "not_applicable", "unknown", undefined, null, "green"],
  policyDrift: ["on_baseline", "drifted", "unknown", undefined, null, ["drifted"]],
  complianceCoverage: ["covered", "uncovered", "unknown", undefined, null, {}],
  enrollmentState: ["enrolled", "failed", "retired", "unknown", undefined, null, "pending_enrollment"],
  managementReachable: [true, false, null, undefined, "true", 1],
  rootCauseEvidence: ["available", "unavailable", "not_supported", "unknown", undefined, null, "likely"],
  __alias: ["absent", "present"],
};
