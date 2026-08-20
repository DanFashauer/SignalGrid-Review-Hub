import type {
  NormalizedPeripheral,
  NormalizedPeripheralPosture,
  PeripheralAction,
  PeripheralPosture,
  PeripheralReasonCode,
  PeripheralVerdict,
} from "./types";

/**
 * Pure, deterministic removable-media / peripheral-control evaluator. Aggregates
 * a device's attached peripherals + device-control policy state into ONE posture
 * + the action it warrants — fail-safe, so the WORST attached removable drives
 * the verdict and a writable removable we can't confirm is authorized+encrypted
 * is treated as the exfil/ingress surface it might be. No clock, no randomness.
 *
 * `covered=false` means "no device-control coverage for this device" → posture
 * unknown (a blind spot), different from a covered device with no removable media
 * → no_removable.
 */

// Local action-severity ordering, consistent with the unified ladder
// (none < monitor < step_up < alert < restrict). Used to pick the STRONGEST
// concern across a device's peripherals + policy state, so a severe attached
// device is never diluted by a calmer one (order-proof).
const ACTION_SEVERITY: Record<PeripheralAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
};

export interface EvaluatePeripheralOptions {
  /** False when the device has no device-control coverage at all. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: PeripheralPosture;
  action: PeripheralAction;
  reason: PeripheralReasonCode;
}

/** Mass-storage and MTP (phones/media players) are the removable-storage exfil surface. */
function isRemovableStorage(p: NormalizedPeripheral): boolean {
  return p.class === "mass_storage" || p.class === "mtp";
}

/**
 * Writable = the host can write to the device (exfil) — read_write, or an
 * UNKNOWN access which we fail-safe to writable. blocked / read_only are contained.
 */
function isWritable(p: NormalizedPeripheral): boolean {
  return p.access === "read_write" || p.access === "unknown";
}

export function evaluatePeripheralPosture(
  posture: NormalizedPeripheralPosture,
  options: EvaluatePeripheralOptions = {},
): PeripheralVerdict {
  const covered = options.covered ?? true;
  // `null` = the source never reported a peripheral inventory; `[]` = it reported
  // none attached. Both filter to zero removable devices, which is exactly why the
  // distinction has to travel separately into the verdict — "no USB stick was
  // found" and "nobody looked for one" are not the same claim about a device.
  const peripheralsObserved = posture.peripherals !== null;
  const peripherals = posture.peripherals ?? [];
  const removable = peripherals.filter(isRemovableStorage);
  const removableCount = removable.length;
  const writableRemovable = removable.filter(isWritable);
  const writableRemovableCount = writableRemovable.length;

  const base = {
    removableCount,
    writableRemovableCount,
    policyEnforced: posture.policyEnforced,
  };

  // No device-control coverage → unknown (a blind spot), NOT clean.
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "monitor" };
  }

  // Collect every applicable concern as a candidate, then let the STRONGEST win
  // (order-proof).
  const candidates: Candidate[] = [];
  if (!peripheralsObserved) {
    // Never read the inventory, so "no removable media" is not a reading we are
    // entitled to. `monitor` — a blind spot to investigate, not an alarm; it beats
    // the `none` default and loses to any genuinely observed device below.
    candidates.push({ posture: "unknown", action: "monitor", reason: "PERIPHERAL_FEED_UNOBSERVED" });
  }

  for (const p of removable) {
    if (!isWritable(p)) {
      // Present but contained (blocked / read-only) — surfaced, not clean.
      candidates.push({ posture: "controlled", action: "monitor", reason: "CONTROLLED_MEDIA" });
      continue;
    }
    // A writable removable. Fail-safe: only an explicit true confirms authorization
    // / encryption; false OR unknown (null) is treated as not-confirmed.
    const authorizedConfirmed = p.authorized === true;
    const encryptedConfirmed = p.encrypted === true;
    if (!authorizedConfirmed && !encryptedConfirmed) {
      candidates.push({ posture: "exfil_risk", action: "restrict", reason: "UNAUTHORIZED_UNENCRYPTED_MEDIA" });
    } else if (!authorizedConfirmed) {
      candidates.push({ posture: "unauthorized_media", action: "alert", reason: "UNAUTHORIZED_MEDIA" });
    } else if (!encryptedConfirmed) {
      candidates.push({ posture: "unencrypted_media", action: "alert", reason: "UNENCRYPTED_WRITABLE_MEDIA" });
    } else {
      candidates.push({ posture: "controlled", action: "monitor", reason: "CONTROLLED_MEDIA" });
    }
  }

  // Fail-safe for a class we don't recognize: a writable peripheral whose class
  // is unmapped could be a removable-storage device the vendor named in a way we
  // don't know — never let it read as clean. Surface it (monitor) without
  // over-restricting (it might be a benign unmapped device). This closes the
  // class-side asymmetry with normalizeAccess (which already fails safe to
  // writable). Recognized removable storage is handled by the loop above.
  const hasUnclassifiedWritable = peripherals.some(
    (p) => p.class === "unknown" && isWritable(p),
  );
  if (hasUnclassifiedWritable) {
    candidates.push({ posture: "unclassified_media", action: "monitor", reason: "UNCLASSIFIED_PERIPHERAL" });
  }

  // Device-control policy explicitly not enforced → anything can attach unchecked.
  if (posture.policyEnforced === false) {
    candidates.push({ posture: "policy_unenforced", action: "step_up", reason: "POLICY_UNENFORCED" });
  } else if (posture.policyEnforced === null) {
    // Enforcement UNREPORTED (wedge #7, caught by the shift-1 sweep): "no
    // removable media" from a device-control layer whose enforcement cannot be
    // confirmed is not a clean reading. `=== false` alone let null fall through
    // to a full no_removable/none grant. Graded `monitor` — a blind spot to
    // investigate; confirmed-unenforced (above) stays the stronger step_up
    // because it is a REPORTED bad state, not an unreported one.
    candidates.push({ posture: "unknown", action: "monitor", reason: "POLICY_ENFORCEMENT_UNVERIFIED" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "no_removable", action: "none", reason: "NO_REMOVABLE" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
