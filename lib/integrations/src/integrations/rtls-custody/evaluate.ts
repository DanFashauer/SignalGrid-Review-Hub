import type {
  CustodyAction,
  CustodyPosture,
  CustodyReasonCode,
  CustodyVerdict,
  NormalizedAssetLocation,
} from "./types";
import { posedBound } from "../../utils/posed-bound";

/**
 * Pure, deterministic RTLS / badge-dwell custody evaluator. Turns a device's
 * real-time physical location + dwell + badge association into ONE custody
 * posture + the action it warrants — fail-safe, so the WORST concern drives the
 * verdict and a device we can't physically see is never mistaken for one in
 * good custody. No clock, no randomness.
 *
 * `tracked=false` means "the RTLS has no record for this device" → posture
 * unknown (a blind spot), different from a tracked device seen in an authorized
 * zone with a fresh fix → in_zone.
 */

// Local action-severity ordering, consistent with the unified ladder
// (none < monitor < locate < alert < escalate). Used to pick the STRONGEST
// concern among a device's independent custody factors, so a severe signal is
// never diluted by a calmer one checked later (order-proof).
const ACTION_SEVERITY: Record<CustodyAction, number> = {
  none: 0,
  monitor: 1,
  locate: 2,
  alert: 3,
  escalate: 4,
};

const STALE_FIX_SECONDS_DEFAULT = 900; // 15 minutes
const ABANDON_DWELL_SECONDS_DEFAULT = 3600; // 1 hour

export interface EvaluateCustodyOptions {
  /** False when the RTLS has no record for this device at all. Default true. */
  tracked?: boolean;
  /** Fix age (seconds) at/above which the location is considered stale. Default 900. */
  staleFixSeconds?: number;
  /** Dwell (seconds) without a badge at/above which the device is abandoned. Default 3600. */
  abandonDwellSeconds?: number;
}

interface Candidate {
  posture: CustodyPosture;
  action: CustodyAction;
  reason: CustodyReasonCode;
}

export function evaluateCustodyPosture(
  loc: NormalizedAssetLocation,
  options: EvaluateCustodyOptions = {},
): CustodyVerdict {
  const tracked = options.tracked ?? true;
  // A garbled bound yields null, NOT the default — see utils/posed-bound.ts. A
  // null here means the axis cannot be evaluated, and each comparison below treats
  // that exactly as it treats an unconfirmable MEASUREMENT: it raises.
  const staleFix = posedBound(options.staleFixSeconds, STALE_FIX_SECONDS_DEFAULT);
  const abandonDwell = posedBound(
    options.abandonDwellSeconds,
    ABANDON_DWELL_SECONDS_DEFAULT,
  );

  const base = {
    zoneId: loc.zoneId,
    zoneType: loc.zoneType,
    fixAgeSeconds: loc.fixAgeSeconds,
    dwellSeconds: loc.dwellSeconds,
    badgeAssociated: loc.badgeAssociated,
  };

  // No RTLS record → unknown (a blind spot), NOT in-custody. Mirrors the
  // not-reporting / unscanned fail-safe in the other dimensions.
  if (!tracked) {
    return { ...base, posture: "unknown", reasonCode: "NOT_TRACKED", recommendedAction: "monitor" };
  }

  // Explicitly reported not-present anywhere in the monitored area → the device
  // has left (or dropped off) — a custody breach that dominates everything else.
  // Only an explicit false escalates; an unknown (null) presence falls through to
  // the fix-age fail-safe rather than assuming departure.
  if (loc.present === false) {
    return { ...base, posture: "left_area", reasonCode: "LEFT_AREA", recommendedAction: "escalate" };
  }

  // Collect every applicable custody concern as a candidate, then let the
  // STRONGEST win (order-proof).
  const candidates: Candidate[] = [];
  if (loc.atEgress) {
    candidates.push({ posture: "at_egress", action: "alert", reason: "AT_EGRESS" });
  }
  if (loc.zoneAuthorized === false || loc.zoneType === "unauthorized") {
    candidates.push({ posture: "off_zone", action: "alert", reason: "OFF_ZONE" });
  } else if (loc.zoneAuthorized === null) {
    // Fail-safe: the device's authorization for this zone cannot be confirmed —
    // never stamp that "custody OK". An unconfirmable authorization is not the
    // same as an authorized one (same discipline as null fixAge → stale).
    // Wedge #9, caught by the shift-1 sweep: this branch used to also require
    // zoneType === "unknown", so a device in a CLASSIFIED zone (clinical,
    // storage…) with unreported authorization skipped it entirely and could
    // mint a full CUSTODY_OK/none grant. Knowing the zone's category never
    // proved THIS device was allowed there. Surface it for review.
    candidates.push({ posture: "zone_unverified", action: "monitor", reason: "ZONE_UNVERIFIED" });
  }
  // Fail-safe: an unconfirmable fix age (null) is treated as stale — we never
  // report good custody when the location's freshness can't be confirmed.
  //
  // An UNREADABLE age (NaN) is the same blind spot and must grade the same way.
  // Until 2026-09-06 the test was `=== null || … >= staleFix`: `NaN >= n` is
  // false, neither arm fires, and an unreadable fix age read as FRESH — the
  // shape check-nan-fail-open rule 5 now flags. Number.isFinite rejects null,
  // NaN and ±Infinity in one predicate; the wire normaliser already guards this
  // field, so the hole was live for every direct caller of the evaluator.
  const fixStale = !Number.isFinite(loc.fixAgeSeconds) || staleFix === null || (loc.fixAgeSeconds as number) >= staleFix;
  if (fixStale) {
    candidates.push({ posture: "stale_fix", action: "locate", reason: "STALE_FIX" });
  }
  // Abandonment: no associated badge AND a long dwell (or an unconfirmable dwell,
  // fail-safe) — a device sitting unattended without its checkout badge. Same
  // predicate discipline as the fix age: unreadable is unconfirmable.
  const dwellLong = !Number.isFinite(loc.dwellSeconds) || abandonDwell === null || (loc.dwellSeconds as number) >= abandonDwell;
  if (loc.badgeAssociated === false && dwellLong) {
    candidates.push({ posture: "abandoned", action: "alert", reason: "ABANDONED" });
  } else if (loc.badgeAssociated === null && dwellLong) {
    // Badge association UNREPORTED over an abandonment-length (or unconfirmable)
    // dwell (wedge #11, caught by the shift-1 sweep): `=== false` alone let null
    // fall through, so a device sitting for hours with an unverifiable badge
    // state could mint a full CUSTODY_OK/none grant. Graded `monitor` — a blind
    // spot to investigate; a REPORTED badge-less long dwell (above) stays the
    // stronger alert.
    candidates.push({ posture: "badge_unverified", action: "monitor", reason: "BADGE_UNVERIFIED" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "in_zone", action: "none", reason: "CUSTODY_OK" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
