// Zone-presence transitions — the geofence entry/exit state machine
// (intake ledger row 17: hysteresis, dwell, exit grace, and the
// crossing / probably-outside / confirmed-outside ladder).
//
// The problem this solves: a session should not be started by one radio blip,
// and it must not be revoked by one missing observation. Phase 1 grades ONE
// observation against a requirement; this module grades a SEQUENCE of
// observations against a zone and answers the session-continuity question:
// has presence been EARNED, is it still current, and has exit been CONFIRMED?
//
// Doctrine, applied symmetrically:
//  - PRESENCE IS EARNED, never assumed: a subject is `present` only after
//    continuous in-zone evidence spanning the caller's entry dwell. One
//    observation spans zero seconds and never satisfies a positive dwell.
//  - EXIT IS CONFIRMED, never fabricated: `confirmed_outside` requires an
//    AFFIRMATIVE observation outside the exit boundary after the grace
//    interval. Sensor silence can EXPIRE presence (step up, attenuate) but it
//    can never manufacture the affirmative "they left" — a dead access point
//    is not a door event.
//  - HYSTERESIS VIA CONTAINMENT, not distance: entering requires the tight
//    zone; confirming outside requires leaving a caller-supplied LARGER
//    boundary (the unit around the room, the floor around the unit). Between
//    the two, the honest state is `probably_outside` — retained, watched.
//  - NO CLOCK IN THE DECISION PATH: every instant comes from the observations
//    and the caller's reference instant; every bound is caller policy.
//  - Anything unreadable — an unmapped zone, a garbled instant, a disordered
//    sequence, a future-dated observation — is `unknown` and raises. A
//    sequence containing garbage cannot be partially trusted.

import type { FacilityGraph } from "./graph";
import type { LocationCertaintyAction } from "./evaluate";

export type ZonePresenceState =
  | "present"
  | "crossing" // in-zone evidence exists but the entry dwell is not yet met
  | "probably_outside" // grace, hysteresis, or stale evidence — retained, watched
  | "confirmed_outside" // affirmative observation outside the exit boundary, past grace
  | "never_present" // observations exist, none ever in the zone (or a visit too short to earn presence, now over)
  | "unknown";

export type ZonePresenceReason =
  | "PRESENT_IN_ZONE"
  | "ENTRY_DWELL_NOT_MET"
  | "ENTRY_NOT_SUSTAINED"
  | "NEVER_OBSERVED_IN_ZONE"
  | "ZONE_EXITED_WITHIN_GRACE"
  | "WITHIN_EXIT_BOUNDARY"
  | "EVIDENCE_STALE"
  | "PRESENCE_EVIDENCE_EXPIRED"
  | "EXIT_CONFIRMED"
  | "ZONE_NOT_IN_GRAPH"
  | "EXIT_BOUNDARY_INVALID"
  | "POLICY_UNREADABLE"
  | "REFERENCE_UNREADABLE"
  | "NO_OBSERVATIONS"
  | "OBSERVATION_UNREADABLE"
  | "SEQUENCE_DISORDERED"
  | "OBSERVATION_FUTURE_DATED";

export interface ZoneObservationRaw {
  space_id?: unknown;
  observed_at?: unknown;
}

export interface ZonePresencePolicy {
  /** Continuous in-zone evidence required before presence is EARNED, seconds. */
  entryDwellSeconds: number;
  /** How long after the last in-zone evidence the subject is still treated as
   *  probably (not confirmed) outside, seconds. */
  exitGraceSeconds: number;
  /** Optional staleness bound on the newest observation. Posed → evidence
   *  older than this cannot hold `present`. Omitted = the operator's explicit
   *  visible choice, like every other omitted bound. */
  maxObservationAgeSeconds?: number;
}

export interface ZonePresenceInput {
  /** The tight zone presence is being asked about (a SignalGrid spaceId). */
  zoneId: string;
  /** Optional LARGER space for exit hysteresis: `confirmed_outside` requires
   *  an observation outside THIS boundary. Must contain (or equal) the zone. */
  exitBoundaryId?: string;
  /** Ordered oldest→newest. Order is the WIRE's claim and is verified. */
  observations: readonly ZoneObservationRaw[];
  policy: ZonePresencePolicy;
  /** The caller's "now". */
  referenceTime: string;
}

export interface ZonePresenceVerdict {
  state: ZonePresenceState;
  reasonCode: ZonePresenceReason;
  recommendedAction: LocationCertaintyAction;
  /** True ONLY for `present` — the single grant-bearing state. */
  presenceConfirmed: boolean;
  /** The newest in-zone instant, as evidence. Null when none or unreadable. */
  lastInZoneAt: string | null;
  /** Seconds of continuous in-zone evidence ending at lastInZoneAt. */
  dwellSeconds: number | null;
}

function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function unknownVerdict(reasonCode: ZonePresenceReason): ZonePresenceVerdict {
  return { state: "unknown", reasonCode, recommendedAction: "step_up", presenceConfirmed: false, lastInZoneAt: null, dwellSeconds: null };
}

function boundOk(v: number): boolean {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

/**
 * Grade a sequence of observations into one honest presence state.
 */
export function gradeZonePresence(graph: FacilityGraph, input: ZonePresenceInput): ZonePresenceVerdict {
  if (graph.get(input.zoneId) === null) return unknownVerdict("ZONE_NOT_IN_GRAPH");

  const boundaryId = input.exitBoundaryId ?? input.zoneId;
  if (input.exitBoundaryId !== undefined) {
    // The boundary must exist and CONTAIN the zone — a boundary beside the
    // zone would make "outside the boundary" meaningless for this zone.
    if (graph.get(input.exitBoundaryId) === null) return unknownVerdict("EXIT_BOUNDARY_INVALID");
    const zonePath = graph.path(input.zoneId).map((n) => n.spaceId);
    if (!zonePath.includes(input.exitBoundaryId)) return unknownVerdict("EXIT_BOUNDARY_INVALID");
  }

  const p = input.policy;
  if (p === null || typeof p !== "object" || !boundOk(p.entryDwellSeconds) || !boundOk(p.exitGraceSeconds)) {
    return unknownVerdict("POLICY_UNREADABLE");
  }
  const staleBound = p.maxObservationAgeSeconds;
  if (staleBound !== undefined && (!boundOk(staleBound) || staleBound === 0)) {
    return unknownVerdict("POLICY_UNREADABLE");
  }
  const referenceMs = instantOf(input.referenceTime);
  if (referenceMs === null) return unknownVerdict("REFERENCE_UNREADABLE");

  if (!Array.isArray(input.observations)) return unknownVerdict("OBSERVATION_UNREADABLE");
  if (input.observations.length === 0) return unknownVerdict("NO_OBSERVATIONS");

  // Normalize the whole sequence first — garbage anywhere poisons the claim.
  const seq: Array<{ ms: number; at: string; inZone: boolean; inBoundary: boolean }> = [];
  for (const raw of input.observations) {
    if (raw === null || typeof raw !== "object") return unknownVerdict("OBSERVATION_UNREADABLE");
    const ms = instantOf(raw.observed_at);
    if (ms === null) return unknownVerdict("OBSERVATION_UNREADABLE");
    if (ms > referenceMs) return unknownVerdict("OBSERVATION_FUTURE_DATED");
    const spaceId = typeof raw.space_id === "string" ? raw.space_id.trim() : "";
    if (spaceId.length === 0 || graph.get(spaceId) === null) return unknownVerdict("OBSERVATION_UNREADABLE");
    const path = graph.path(spaceId).map((n) => n.spaceId);
    seq.push({
      ms,
      at: (raw.observed_at as string).trim(),
      inZone: path.includes(input.zoneId),
      inBoundary: path.includes(boundaryId),
    });
  }
  for (let i = 1; i < seq.length; i += 1) {
    if (seq[i].ms < seq[i - 1].ms) return unknownVerdict("SEQUENCE_DISORDERED");
  }

  // Locate the newest in-zone observation and its continuous run.
  let lastIn = -1;
  for (let i = seq.length - 1; i >= 0; i -= 1) {
    if (seq[i].inZone) { lastIn = i; break; }
  }
  if (lastIn === -1) {
    return { state: "never_present", reasonCode: "NEVER_OBSERVED_IN_ZONE", recommendedAction: "step_up", presenceConfirmed: false, lastInZoneAt: null, dwellSeconds: null };
  }
  let runStart = lastIn;
  while (runStart > 0 && seq[runStart - 1].inZone) runStart -= 1;
  const dwellMs = seq[lastIn].ms - seq[runStart].ms;
  const dwellSeconds = dwellMs / 1000;
  const lastInZoneAt = seq[lastIn].at;
  const evidence = { lastInZoneAt, dwellSeconds };

  const dwellMet = dwellMs >= p.entryDwellSeconds * 1000;
  const afterExit = seq.slice(lastIn + 1); // all not in zone, by construction
  const withinGrace = referenceMs - seq[lastIn].ms <= p.exitGraceSeconds * 1000;
  const newest = seq[seq.length - 1];
  const evidenceStale = staleBound !== undefined && referenceMs - newest.ms > staleBound * 1000;

  if (!dwellMet) {
    if (afterExit.length > 0) {
      // The visit ended before presence was earned — a blip, not an entry.
      return { state: "never_present", reasonCode: "ENTRY_NOT_SUSTAINED", recommendedAction: "step_up", presenceConfirmed: false, ...evidence };
    }
    return { state: "crossing", reasonCode: "ENTRY_DWELL_NOT_MET", recommendedAction: "monitor", presenceConfirmed: false, ...evidence };
  }

  // Presence was earned. Grade its currency.
  if (afterExit.length === 0) {
    if (evidenceStale) {
      // The newest word IS the in-zone word, but it is too old to hold
      // `present` under the operator's posed bound. Within grace this is
      // probable-not-confirmed; past grace it expires below.
      if (withinGrace) {
        return { state: "probably_outside", reasonCode: "EVIDENCE_STALE", recommendedAction: "monitor", presenceConfirmed: false, ...evidence };
      }
      return { state: "probably_outside", reasonCode: "PRESENCE_EVIDENCE_EXPIRED", recommendedAction: "step_up", presenceConfirmed: false, ...evidence };
    }
    if (!withinGrace) {
      // Silence past grace: presence expires, but silence never CONFIRMS exit.
      return { state: "probably_outside", reasonCode: "PRESENCE_EVIDENCE_EXPIRED", recommendedAction: "step_up", presenceConfirmed: false, ...evidence };
    }
    return { state: "present", reasonCode: "PRESENT_IN_ZONE", recommendedAction: "none", presenceConfirmed: true, ...evidence };
  }

  // There are observations after the last in-zone one.
  const outsideBoundary = afterExit.some((o) => !o.inBoundary);
  if (withinGrace) {
    return { state: "probably_outside", reasonCode: "ZONE_EXITED_WITHIN_GRACE", recommendedAction: "monitor", presenceConfirmed: false, ...evidence };
  }
  if (outsideBoundary) {
    return { state: "confirmed_outside", reasonCode: "EXIT_CONFIRMED", recommendedAction: "step_up", presenceConfirmed: false, ...evidence };
  }
  // Past grace but every subsequent observation is still inside the exit
  // boundary — the hysteresis band holds: out of the room, not out of the unit.
  return { state: "probably_outside", reasonCode: "WITHIN_EXIT_BOUNDARY", recommendedAction: "monitor", presenceConfirmed: false, ...evidence };
}
