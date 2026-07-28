// simulate (step 5) — project the proposal's effect WITHOUT changing anything.
//
// `simulateProposal` runs the proposed change against the SAME history it was mined
// from and reports would-it-have-helped: of the M observed incidents for this
// proposal's target, how many the change would have auto-routed/resolved. It changes
// nothing — it counts. On success it performs the one legal `draft → simulated`
// transition and attaches the `SimulationResult`, so a simulated proposal always
// carries its simulation (which is what gates the later move to `pending_approval`).
//
// Pure and deterministic; the input proposal is never mutated and the returned one is
// deep-frozen with `version` advanced by one.

import type { AuditEvent } from "@workspace/signalgrid-core";
import { advanceWith, assertLegalTransition } from "./lifecycle";
import type { AdaptiveProposal, SimulationResult } from "./types";

/** An incident "matches" the proposal when it is a manual resolution of the proposal's
 *  target subject — i.e. exactly the toil the proposed automation is meant to absorb.
 *  Counting matches is the whole of the projection: no state is written anywhere. */
function isMatchingIncident(event: AuditEvent, target: string): boolean {
  return event.subject === target;
}

/**
 * Simulate a DRAFT proposal against a history fixture (the same synthetic audit events
 * it was mined from). Returns a new proposal in `simulated` status with the projection
 * attached. Throws `illegal_transition` if the proposal is not a draft.
 */
export function simulateProposal(
  proposal: AdaptiveProposal,
  historyFixture: readonly AuditEvent[],
): AdaptiveProposal {
  // Guard the transition up front, so simulating a non-draft is refused before any work
  // — the message names only statuses, never a caller ref.
  assertLegalTransition(proposal.status, "simulated");

  const target = proposal.recommendation.target;
  const incidents = historyFixture.filter((e) => isMatchingIncident(e, target));
  const observedIncidentCount = incidents.length;
  // The projection: an incident that carries at least one signal ref is one the
  // proposed routing has a signature to match on, so it would have been auto-resolved.
  // An incident with no referenced signal has nothing to route on and would still have
  // fallen through to a human — counted honestly as NOT helped. Pure counting; nothing
  // is written anywhere.
  const wouldHaveHelpedCount = incidents.filter((e) => e.references.length > 0).length;

  const helpedRate = observedIncidentCount === 0 ? 0 : wouldHaveHelpedCount / observedIncidentCount;

  const simulation: SimulationResult = {
    observedIncidentCount,
    wouldHaveHelpedCount,
    helpedRate,
    summary:
      `projected against ${observedIncidentCount} observed incident(s) for "${target}": the proposed ` +
      `routing would have auto-resolved ${wouldHaveHelpedCount} of them ` +
      `(${Math.round(helpedRate * 100)}%). No live change was made.`,
  };

  return advanceWith(proposal, { status: "simulated", simulation });
}
