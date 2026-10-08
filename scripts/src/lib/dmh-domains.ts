// The device-management-health proof's enumeration domains, exhaustive BY CONSTRUCTION.
//
// They used to be plain `Record<string, readonly unknown[]>`, so a new contract FIELD or a
// new enum MEMBER could be added without updating them and the proof stayed green (the
// pinned combo count only counted the arrays that existed). Now, structurally, for EVERY
// entry (nothing is opt-in per entry):
//   - `domains` must have exactly one entry per judged field of the normalized contract;
//   - each entry's values must all be values of THAT field's own type (`satisfies` — a
//     tuple cross-wired to another field's values is rejected);
//   - `Missing` below is the union of members a field's type has that its entry lacks, and
//     the assertion fails to compile unless it is `never` for every field;
//   - `rawDomains` must have an entry for every wire key the connector registers
//     (`DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS`) plus the build-time `__alias` toggle.
// `scripts/check-dmh-domains-exhaustive.mjs` plants a member in each of the nine field
// types, a dropped member, a cross-wired tuple and a new raw key, and requires the compiler
// to reject each.
import type { NormalizedDeviceManagementHealth, DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS } from "@workspace/integrations/device-management-health";

type N = NormalizedDeviceManagementHealth;
type JudgedField = Exclude<keyof N, "sourceSystem" | "deviceId" | "source">;

export const domains = {
  mdmCheckInFreshness: ["fresh", "stale", "never", "unknown"],
  agentCheckInFreshness: ["fresh", "stale", "never", "not_applicable", "unknown"],
  remediationHealth: ["healthy", "issues_detected", "failed", "not_applicable", "unknown"],
  policyDrift: ["on_baseline", "drifted", "unknown"],
  complianceCoverage: ["covered", "uncovered", "unknown"],
  enrollmentState: ["enrolled", "failed", "retired", "unknown"],
  managementReachable: [true, false, null],
  rootCauseEvidence: ["available", "unavailable", "not_supported", "unknown"],
  reportIntegrity: ["clean", "malformed"],
} as const satisfies { readonly [K in JudgedField]: readonly N[K][] };

/** Members of a judged field's type that its `domains` entry does not list. */
type Missing = { [K in JudgedField]: Exclude<N[K], (typeof domains)[K][number]> }[JudgedField];
const domainsAreExhaustive: [Missing] extends [never] ? true : { missingMembers: Missing } = true;
void domainsAreExhaustive;

// The raw sweep's enum spellings are DERIVED from the normalized `domains` above, so a new
// enum member joins the raw sweep too (and, until the parse-fidelity allowlist in the proof
// names it, the proof fails closed rather than skipping it). Each field then adds the wire
// CLASSES the normalizer must survive: an omitted key, a JSON null, and a junk value.
export const rawDomains: Record<(typeof DEVICE_MANAGEMENT_HEALTH_REPORT_KEYS)[number] | "__alias", readonly unknown[]> = {
  // Every enum field carries the same wire classes (see above). `agentCheckInFreshness` once
  // omitted `null` and `remediationHealth` the literal "unknown" while `PARSEABLE_RAW` listed
  // both, so the parse-fidelity pass advertised coverage of cells it never produced.
  mdmCheckInFreshness: [...domains.mdmCheckInFreshness, undefined, null, "very_old"],
  agentCheckInFreshness: [...domains.agentCheckInFreshness, undefined, null, 7],
  remediationHealth: [...domains.remediationHealth, undefined, null, "green"],
  policyDrift: [...domains.policyDrift, undefined, null, ["drifted"]],
  complianceCoverage: [...domains.complianceCoverage, undefined, null, {}],
  enrollmentState: [...domains.enrollmentState, undefined, null, "pending_enrollment"],
  managementReachable: [...domains.managementReachable, undefined, "true", 1],
  rootCauseEvidence: [...domains.rootCauseEvidence, undefined, null, "likely"],
  __alias: ["absent", "present"],
};
