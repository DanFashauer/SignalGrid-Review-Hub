// Door-crossing correlation — phase 2 of the Facility Trust Graph.
//
// The owner's design (docs/FACILITY_TRUST_GRAPH.md): a badge event is evidence,
// not proof. It says a credential was presented at a reader; it does not prove
// the holder crossed, stayed, or that the device moved with them. This module
// correlates ONE door-crossing event with ONE subsequent device observation
// over the graph's portal adjacency, and answers three honest questions:
//
//   corroborated — inside the caller's stated window, the device was observed
//     in a space the door actually touches (or a descendant of one: Bed B
//     descends from Room 312). Carried as EVIDENCE. Deliberately not a grant
//     and never an accuracy upgrade: corroboration cannot make a room_candidate
//     into a room_confirmed — the certainty ladder belongs to the sources.
//   contradicted — inside the window, the device was observed where this door
//     does not lead. The badge crossed one threshold and the device is
//     somewhere else: passback, tailgating, a cloned badge, or a wrong map.
//     An affirmative anomaly → alert.
//   unassessed — the observation does not speak about this crossing (before
//     it, or outside the window). No claim is posed, so nothing is granted and
//     nothing raised BY THIS PAIR — the certainty dimension still grades the
//     observation on its own.
//
// Anything unreadable — a door that is not in the graph, an unparseable
// instant, a missing window — is `unknown` and raises. NO CLOCK IN THE
// DECISION PATH: both instants come from the events, and the window from the
// caller. No skew allowance exists; skew shows up honestly as `unassessed`
// (observation timestamped before the crossing), never as a silent pass.

import type { FacilityGraph } from "./graph";

export type CrossingCorroboration = "corroborated" | "contradicted" | "unassessed" | "unknown";

export interface DoorCrossingEvent {
  /** The door's SignalGrid spaceId — vendor reader ids resolve to this via
   *  graph.resolveVendorRef BEFORE this layer. */
  doorSpaceId: string;
  /** ISO-8601 UTC instant the access event happened. */
  crossedAt: string;
}

export interface SubsequentObservation {
  /** Where the device was observed (a SignalGrid spaceId). */
  spaceId: string;
  /** ISO-8601 UTC instant of the observation. */
  observedAt: string;
}

export interface CrossingWindow {
  /** How long after the crossing an observation still speaks about it, in
   *  seconds. CALLER-SUPPLIED policy — the fabric does not tune one. */
  maxCorrelationSeconds: number;
}

export type CrossingReason =
  | "CROSSING_CORROBORATED"
  | "CROSSING_CONTRADICTED"
  | "OBSERVATION_OUTSIDE_WINDOW"
  | "OBSERVATION_BEFORE_CROSSING"
  | "DOOR_NOT_IN_GRAPH"
  | "OBSERVED_SPACE_NOT_IN_GRAPH"
  | "WINDOW_UNREADABLE"
  | "INSTANT_UNREADABLE";

export type CrossingAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface CrossingVerdict {
  corroboration: CrossingCorroboration;
  reasonCode: CrossingReason;
  recommendedAction: CrossingAction;
  /** The sides the door touches (parent + connects), for evidence. Empty when
   *  the door could not be resolved. */
  doorSides: string[];
}

function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Correlate one crossing with one subsequent observation.
 *
 * The spatial test is membership of the observed space's ANCESTOR PATH in the
 * door's sides — a device observed at Bed B corroborates a crossing into Room
 * 312 because the bed descends from the room. Deliberately no distance model,
 * no floor-plan geometry, no "close enough": adjacency is what the graph says,
 * and anything beyond it is a contradiction a human should see.
 */
export function correlateCrossing(
  graph: FacilityGraph,
  crossing: DoorCrossingEvent,
  observation: SubsequentObservation,
  window: CrossingWindow,
): CrossingVerdict {
  const sides = graph.doorSides(crossing.doorSpaceId);
  if (sides === null) {
    return { corroboration: "unknown", reasonCode: "DOOR_NOT_IN_GRAPH", recommendedAction: "step_up", doorSides: [] };
  }
  if (graph.get(observation.spaceId) === null) {
    return { corroboration: "unknown", reasonCode: "OBSERVED_SPACE_NOT_IN_GRAPH", recommendedAction: "alert", doorSides: sides };
  }
  const max = window?.maxCorrelationSeconds;
  if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) {
    return { corroboration: "unknown", reasonCode: "WINDOW_UNREADABLE", recommendedAction: "step_up", doorSides: sides };
  }
  const crossedMs = instantOf(crossing.crossedAt);
  const observedMs = instantOf(observation.observedAt);
  if (crossedMs === null || observedMs === null) {
    return { corroboration: "unknown", reasonCode: "INSTANT_UNREADABLE", recommendedAction: "step_up", doorSides: sides };
  }
  if (observedMs < crossedMs) {
    // The observation predates the crossing — it is evidence about an earlier
    // moment, not this one. Clock skew lands here honestly instead of passing.
    return { corroboration: "unassessed", reasonCode: "OBSERVATION_BEFORE_CROSSING", recommendedAction: "none", doorSides: sides };
  }
  if (observedMs - crossedMs > max * 1000) {
    return { corroboration: "unassessed", reasonCode: "OBSERVATION_OUTSIDE_WINDOW", recommendedAction: "none", doorSides: sides };
  }
  const pathIds = graph.path(observation.spaceId).map((n) => n.spaceId);
  const consistent = pathIds.some((id) => sides.includes(id));
  if (consistent) {
    return { corroboration: "corroborated", reasonCode: "CROSSING_CORROBORATED", recommendedAction: "none", doorSides: sides };
  }
  return { corroboration: "contradicted", reasonCode: "CROSSING_CONTRADICTED", recommendedAction: "alert", doorSides: sides };
}
