// measure & verify (step 8) — "did it actually help?"
//
// `measureActivated` compares outcomes AFTER activation to the simulation's prediction.
// It is the step that makes the loop falsifiable: a proposal that was approved and
// activated but did NOT help is surfaced as a FINDING (`measurement.helped === false`),
// not a silent legacy. Only an ACTIVATED proposal can be measured — an un-activated
// change has no post-activation outcomes to compare against.
//
// Pure and deterministic; input never mutated, output deep-frozen, version advanced.

import type { AuditEvent } from "@workspace/signalgrid-core";
import { advanceWith } from "./lifecycle";
import { AdaptiveProposalError, type AdaptiveProposal, type MeasurementResult } from "./types";

/** How much of the simulation's predicted benefit must actually be realized for the
 *  activation to count as "helped". Half is deliberately lenient: the point is to catch
 *  changes that did essentially nothing, not to punish ordinary variance. A realized
 *  rate below half the prediction (including zero) is a finding to surface. */
const MIN_REALIZATION = 0.5;

/** A post-activation incident "helped" when the activated routing actually resolved it —
 *  modelled here as an incident for this target that carried a signal ref to route on,
 *  and whose resolution was NOT a manual remediation (i.e. it did not fall back to a
 *  human). Determined purely from the fixture; nothing is written. */
/** The event types that MEAN "the grid resolved it" — an ALLOWLIST, mirroring the
 *  allowlist `observe.ts` uses for manual resolutions. The previous denylist counted
 *  every type that was not a remediation as a success, so `connector.synced` on the
 *  target subject scored as the automation resolving an incident, and any type added
 *  to core later would have joined the success column silently. */
const AUTO_RESOLVED_TYPES: readonly AuditEvent["type"][] = ["decision.evaluated"];

function wasAutoResolved(event: AuditEvent, target: string): boolean {
  if (event.subject !== target) return false;
  if (!Array.isArray(event.references) || event.references.length === 0) return false;
  return AUTO_RESOLVED_TYPES.includes(event.type);
}

/**
 * Measure an ACTIVATED proposal against a post-activation history fixture. Throws
 * `not_activated` for any other status. Returns a new proposal (still `activated`) with
 * the measurement attached and `version` advanced.
 */
export function measureActivated(
  proposal: AdaptiveProposal,
  postActivationFixture: readonly AuditEvent[],
): AdaptiveProposal {
  if (proposal.status !== "activated") {
    throw new AdaptiveProposalError(
      "not_activated",
      "cannot measure: only an activated proposal has post-activation outcomes to measure.",
      proposal.status,
      proposal.status,
    );
  }

  const target = proposal.recommendation.target;
  const incidents = postActivationFixture.filter((e) => e.subject === target);
  const activatedIncidentCount = incidents.length;
  const helpedCount = incidents.filter((e) => wasAutoResolved(e, target)).length;
  const helpedRate = activatedIncidentCount === 0 ? 0 : helpedCount / activatedIncidentCount;

  // The prediction the simulation made, if any. A proposal that reached activation went
  // through simulation, so this is normally present; a missing one reads as prediction 0.
  const predictedRate = proposal.simulation?.helpedRate ?? 0;

  // Helped only when there were real post-activation incidents, at least one of them
  // was actually auto-resolved, the simulation had predicted SOME benefit, and the
  // realized rate reached at least half the prediction. A prediction of zero used to
  // make the threshold `helpedRate >= 0`, which every realization satisfies — twenty
  // incidents that all fell back to a human reported `helped: true` "realizing the
  // simulation's 0% prediction". Absent or zero projected benefit does not lower the
  // bar; it removes the grounds for having approved the change at all.
  const priorFinding = proposal.measurement !== null && proposal.measurement.helped === false;
  const helped =
    !priorFinding &&
    activatedIncidentCount > 0 &&
    helpedCount > 0 &&
    predictedRate > 0 &&
    helpedRate >= predictedRate * MIN_REALIZATION;

  const measurement: MeasurementResult = {
    activatedIncidentCount,
    helpedCount,
    helpedRate,
    predictedRate,
    helped,
    summary: helped
      ? `after activation, ${helpedCount} of ${activatedIncidentCount} incident(s) for "${target}" were ` +
        `auto-resolved (${Math.round(helpedRate * 100)}%), realizing the simulation's ` +
        `${Math.round(predictedRate * 100)}% prediction.`
      : priorFinding
        ? `FINDING (standing): an earlier measurement already found this change did not help; ` +
          `a later, kinder fixture does not overwrite a finding — supersede the proposal instead. ` +
          `This run: ${helpedCount} of ${activatedIncidentCount} auto-resolved.`
        : predictedRate > 0
          ? `FINDING: after activation, ${helpedCount} of ${activatedIncidentCount} incident(s) for "${target}" were ` +
            `auto-resolved (${Math.round(helpedRate * 100)}%), short of the simulation's ` +
            `${Math.round(predictedRate * 100)}% prediction — the approved change did not help.`
          : `FINDING: the simulation predicted no benefit (0%), so there was nothing for activation to realize; ` +
            `${helpedCount} of ${activatedIncidentCount} incident(s) for "${target}" were auto-resolved — ` +
            `the change should not have been approved on this evidence.`,
  };

  return advanceWith(proposal, { measurement });
}
