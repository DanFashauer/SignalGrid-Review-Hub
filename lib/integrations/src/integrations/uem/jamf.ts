// Jamf Pro → normalized UEM device state. READ-ONLY and PURE.
//
// WHAT WAS REMOVED AND WHY. This file previously exposed `setTag`,
// `quarantineDevice` (POST .../computercommands/command/LockDevice/id/{id}),
// `clearQuarantine` and `sendCommand` — real device-lock and inventory commands
// fired at a real Jamf instance, with no tier gate, no `SIGNALGRID_LIVE_INTEGRATIONS`
// gate, and no approval step. AGENTS.md: "Keep high-risk actions simulated and
// approval-required." A remote lock on a shared clinical cart is about as high-risk
// as this product gets.
//
// Those paths are deleted rather than gated. Connector discipline in this repo is a
// READ-ONLY discipline — every disciplined connector reads and returns a verdict,
// none of them act — so there is no "disciplined" form of a device-lock actuator to
// convert them into. SignalGrid already models remediation the correct way, as an
// approval-gated request that a human executes in the system of record.
//
// THE FAIL-OPEN THAT LIVED HERE. The old normalizer returned:
//
//     compliant: true, // Jamf uses compliance items, would need separate check
//
// — a hardcoded pass, with a comment admitting the check was never implemented.
// Every Jamf-managed device reported compliant regardless of its actual state.
// Jamf genuinely does not expose a single compliance boolean, so the honest answer
// is `not_evaluated`, which the evaluator grades as `step_up`. The absence of a
// check is now visible in the verdict instead of hidden behind a `true`.

import type {
  NormalizedUemDeviceState,
  UemCompliance,
  UemEnrollment,
  UemSupervision,
} from "./types";

/** The subset of Jamf's `/JSSResource/computers/id/{id}` response this reads.
 *  Everything is optional: the normalizer must cope with a partial payload rather
 *  than assume the vendor's documented shape. */
export interface JamfComputerPayload {
  readonly computer?: {
    readonly general?: {
      readonly id?: unknown;
      readonly last_contact_time_utc?: unknown;
      readonly remote_management?: { readonly managed?: unknown };
      readonly supervised?: unknown;
      readonly mdm_capable?: unknown;
    };
    readonly hardware?: { readonly os_version?: unknown };
  };
}

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Own-property boolean read. Deliberately strict: a string "true", a 1, or an
 *  inherited property are all NOT a confirmed boolean, and treating them as one is
 *  how a junk payload becomes a confident answer. */
const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * Normalize a Jamf computer record. Pure — no clock, no I/O, no throwing.
 *
 * A payload that does not carry an identifiable computer object is reported
 * `malformed` rather than normalized into a pile of `unknown`s, because those two
 * situations warrant different operator responses and the verdict should say which
 * one happened.
 */
export function normalizeJamfDevice(raw: JamfComputerPayload): NormalizedUemDeviceState {
  const general = raw?.computer?.general;
  const deviceId = asString(general?.id) ?? (typeof general?.id === "number" ? String(general.id) : null);

  if (!general || deviceId === null) {
    return {
      deviceId: "",
      vendor: "jamf",
      enrollment: "unknown",
      compliance: "unknown",
      supervision: "unknown",
      ownership: "unknown",
      osVersion: null,
      lastCheckInAgeSeconds: null,
      reportIntegrity: "malformed",
    };
  }

  const managed = asBool(general.remote_management?.managed);
  const enrollment: UemEnrollment =
    managed === true ? "enrolled" : managed === false ? "not_enrolled" : "unknown";

  // Jamf has no single compliance verdict — compliance is expressed as policy and
  // smart-group membership, which this read does not fetch. `not_evaluated` is the
  // truthful answer and the evaluator steps up on it. Do NOT "improve" this to
  // `compliant`; that is exactly the defect this file was rewritten to remove.
  const compliance: UemCompliance = "not_evaluated";

  const supervisedRaw = asBool(general.supervised);
  const supervision: UemSupervision =
    supervisedRaw === true ? "supervised" : supervisedRaw === false ? "unsupervised" : "unknown";

  // Jamf Pro's computer record carries no ownership field — there is no
  // `managedDeviceOwnerType` equivalent in `/JSSResource/computers`, and ownership in
  // Jamf is expressed (when at all) through site or department assignment, which this
  // read does not fetch and which sites are not obliged to use for that purpose.
  //
  // So this is `unknown`, and it is deliberate. The consequence is visible and
  // correct: an unsupervised Jamf device grades UNSUPERVISED_OWNERSHIP_UNKNOWN rather
  // than being either excused as BYOD or accused of being an unsupervised corporate
  // device. Same discipline as `compliance` above — do NOT "improve" this by
  // defaulting to `corporate` on the grounds that Jamf is usually corporate. Usually
  // is not a reading.
  const ownership = "unknown" as const;

  return {
    deviceId,
    vendor: "jamf",
    enrollment,
    compliance,
    supervision,
    ownership,
    osVersion: asString(raw.computer?.hardware?.os_version),
    // Jamf reports a timestamp; converting it to an age needs a clock, and a clock
    // read here would make this dimension non-replayable. The caller that owns the
    // clock supplies the age. See the note on `lastCheckInAgeSeconds` in types.ts.
    lastCheckInAgeSeconds: null,
    reportIntegrity: "intact",
  };
}
