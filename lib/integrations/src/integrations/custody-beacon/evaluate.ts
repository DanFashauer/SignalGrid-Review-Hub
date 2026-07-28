import {
  type CustodyBeaconAction,
  type CustodyBeaconPosture,
  type CustodyBeaconReasonCode,
  type CustodyBeaconVerdict,
  type NormalizedCustodyBeacon,
} from "./types";

/**
 * Pure, deterministic custody-BEACON (asset-recovery) evaluator. Fuses the independent
 * recovery beacon's zone reading with the device's own reachability into ONE posture +
 * the action it warrants, fail-closed. The whole point is the fusion: the beacon is the
 * out-of-band channel that still reports when every online signal has gone dark, so it
 * can distinguish the two cases those signals collapse into one:
 *
 *  - **in zone + unreachable** → the device is powered off IN ITS BAY. Benign. `monitor`,
 *    no alarm — this is the fatigue the fabric exists to remove, not create.
 *  - **off premises + unreachable** → the device has been REMOVED and is dark:
 *    highest-confidence theft/loss → `escalate` (recommend lost-mode/wipe, open incident).
 *
 * Worst-concern-wins on the unified ladder (none < monitor < step_up < alert < restrict
 * < escalate). The grant (`none`) requires POSITIVE CONFIRMATION on every axis: the
 * device is in the custody zone, reachable, and the beacon reading is FRESH (a stale
 * reading cannot confirm CURRENT location), with a clean parse. Anything short raises.
 *
 * `covered=false` = no beacon reading was returned for this device → unknown (a gap),
 * step_up — absence of a recovery signal is never a confirmation of custody.
 */

const ACTION_SEVERITY: Record<CustodyBeaconAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateCustodyBeaconOptions {
  /** False when no beacon reading was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: CustodyBeaconPosture;
  action: CustodyBeaconAction;
  reason: CustodyBeaconReasonCode;
}

export function evaluateCustodyBeacon(
  beacon: NormalizedCustodyBeacon,
  opts: EvaluateCustodyBeaconOptions = {},
): CustodyBeaconVerdict {
  const covered = opts.covered ?? true;
  const base = { deviceRef: beacon.deviceRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["coverage"],
      custodyConfirmed: false,
      removalSuspected: false,
    };
  }

  const candidates: Candidate[] = [];
  let removalSuspected = false;

  // Track the unknown axes for evidence (they also foreclose the grant below).
  if (beacon.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (beacon.reachability === "unknown") unknownSignals.push("reachability");
  if (beacon.zone === "unknown") unknownSignals.push("zone");
  if (beacon.freshness === "unknown") unknownSignals.push("freshness");

  // Defence in depth: a reading we could not fully parse is never a grant.
  if (beacon.reportIntegrity !== "clean") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── the fusion, by zone ─────────────────────────────────────────────────────────
  if (beacon.zone === "off_premises") {
    removalSuspected = true;
    if (beacon.reachability === "unreachable") {
      criticalFindings.push("off_premises_dark");
      candidates.push({ posture: "off_premises_dark", action: "escalate", reason: "OFF_PREMISES_DARK" });
    } else {
      // Off premises but reachable/unknown — the device is out and (maybe) controllable;
      // contain it. MDM can still act while it is reachable.
      criticalFindings.push("off_premises");
      candidates.push({ posture: "off_premises", action: "restrict", reason: "OFF_PREMISES" });
    }
  } else if (beacon.zone === "departing") {
    removalSuspected = true;
    if (beacon.reachability === "unreachable") {
      criticalFindings.push("departing_dark");
      candidates.push({ posture: "departing", action: "restrict", reason: "DEPARTING_DARK" });
    } else {
      criticalFindings.push("departing");
      candidates.push({ posture: "departing", action: "alert", reason: "DEPARTING" });
    }
  } else if (beacon.zone === "in_custody_zone") {
    // The in-zone claim is only as good as its freshness (review finding): the
    // benign "powered off in its bay" reading was trusted regardless of age, so
    // an EXPIRED sighting on a DARK device — the exact shape of a theft that
    // began after the beacon's last report — graded as the benign case.
    if (beacon.freshness === "expired" && beacon.reachability === "unreachable") {
      // An expired in-zone claim confirms nothing current, and the device is
      // dark: epistemically the location-unknown-dark state.
      criticalFindings.push("location_unknown_dark");
      candidates.push({ posture: "location_unknown", action: "restrict", reason: "LOCATION_UNKNOWN_DARK" });
    } else if (beacon.reachability === "reachable") {
      // In zone AND reachable. The grant requires a FRESH reading — a stale/expired
      // in-zone claim cannot confirm current location.
      if (beacon.freshness !== "fresh") {
        candidates.push({ posture: "in_zone_stale", action: "step_up", reason: "IN_ZONE_STALE" });
      }
      // else: no candidate — the seed grant survives.
    } else if (beacon.freshness === "fresh") {
      // THE key benign case: a FRESH sighting in its bay while the device is
      // dark (or its reachability unknown). Note it, do not alarm.
      candidates.push({ posture: "in_zone_offline", action: "monitor", reason: "IN_ZONE_OFFLINE_BENIGN" });
    } else {
      // In zone but the sighting is not fresh and the device is not confirmably
      // live — cannot confirm the device is still in place.
      candidates.push({ posture: "in_zone_stale", action: "step_up", reason: "IN_ZONE_STALE" });
    }
  } else {
    // zone unknown — cannot confirm custody. Fail closed by reachability.
    if (beacon.reachability === "unreachable") {
      criticalFindings.push("location_unknown_dark");
      candidates.push({ posture: "location_unknown", action: "restrict", reason: "LOCATION_UNKNOWN_DARK" });
    } else {
      candidates.push({ posture: "location_unknown", action: "step_up", reason: "LOCATION_UNKNOWN" });
    }
  }

  // Defence in depth: the grant is affirmative on ALL FOUR axes. The branches above
  // already push a raising candidate for every non-confirmed state, so today this never
  // fires — but if any branch were later weakened so a non-confirmed state produced an
  // empty candidate list, this backstop forces a step_up rather than letting the seed
  // grant survive. A grant must rest on positive confirmation, never on "no branch
  // happened to object". (An adversarial review flagged the prior narrower guard as dead
  // code that only backstopped `unknown`; this makes it a real, complete backstop.)
  const positivelyInCustody =
    beacon.reportIntegrity === "clean" &&
    beacon.zone === "in_custody_zone" &&
    beacon.reachability === "reachable" &&
    beacon.freshness === "fresh";
  if (!positivelyInCustody && candidates.length === 0) {
    candidates.push({ posture: "in_zone_stale", action: "step_up", reason: "IN_ZONE_STALE" });
  }

  // Worst-concern-wins. ONE state grants: in zone, reachable, fresh, clean — everything
  // positively confirmed. Every unknown/departing/off-premises adds a raising candidate,
  // so the seed only survives when nothing fired.
  const seed: Candidate = { posture: "in_custody_confirmed", action: "none", reason: "CUSTODY_CONFIRMED" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    unknownSignals,
    custodyConfirmed: winner.action === "none",
    removalSuspected,
  };
}
