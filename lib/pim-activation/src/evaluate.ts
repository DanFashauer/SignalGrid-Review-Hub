import type { NormalizedPimActivation, PimActivationVerdict, PimOutcome, PimReasonCode } from "./types";

/**
 * Pure, deterministic PIM activation decision. Answers the question Entra PIM asks a
 * custom extension at role-activation time, in the three outcomes PIM enforces.
 *
 * The ladder here is NOT the usual severity ladder, and the difference is the whole
 * design. `Approved` is not a middle severity — it is *a human being asked*. So:
 *
 *  - **Denied** is reserved for affirmative, known-bad facts: no valid change ticket,
 *    a device the grid has BLOCKED, or an actor that is not confirmed to be a person.
 *    Denying costs an on-call engineer their elevation during an incident, so it is
 *    never done on a guess.
 *  - **Approved** — route to the approver group — is the DEFAULT, and it is where every
 *    unknown lands. A signal we could not read must not silently block a responder, and
 *    must not silently wave them through either. It puts a person in the loop, which is
 *    the correct answer to "we do not know".
 *  - **AutoApproved** is the grant, and carries the full discipline the rest of this
 *    repo applies to `none`: it requires POSITIVE CONFIRMATION OF EVERY INPUT. A valid
 *    ticket, an emergency change, a requester verified on the on-call roster, a device
 *    the grid rates `ok`, an actor confirmed human, signals confirmed fresh, and a
 *    request that parsed cleanly. Anything short of all seven is `Approved`.
 *
 * What SignalGrid adds over a ticket check: the middle three inputs. A verified on-call
 * engineer holding a genuine P1 ticket, on a shared device the grid has BLOCKED for
 * badge-custody or baseline reasons, is exactly the case a ServiceNow lookup cannot
 * catch and this can. That is the claim, and it is the only claim — SignalGrid
 * activates no role and writes nothing back to Entra.
 */
export function evaluatePimActivation(req: NormalizedPimActivation): PimActivationVerdict {
  const blockingFindings: string[] = [];
  const unknownSignals: string[] = [];

  // ── Denied: affirmative known-bad. Never on a guess. ──────────────────────────
  if (req.ticketState === "invalid" || req.ticketState === "absent") {
    blockingFindings.push(`ticket_${req.ticketState}`);
  }
  if (req.deviceRiskTier === "blocked") {
    blockingFindings.push("device_blocked");
  }
  if (req.actorConfirmedHuman === false) {
    blockingFindings.push("non_human_actor");
  }

  // ── unknowns: each one forecloses AutoApproved, none of them denies ───────────
  if (req.requestIntegrity !== "clean") unknownSignals.push("request_integrity");
  if (req.ticketState === "unknown") unknownSignals.push("ticket_state");
  if (req.changeClass === "unknown") unknownSignals.push("change_class");
  if (req.requesterOnCall === null) unknownSignals.push("requester_on_call");
  if (req.deviceRiskTier === "unknown") unknownSignals.push("device_risk_tier");
  if (req.actorConfirmedHuman === null) unknownSignals.push("actor_confirmed_human");
  if (req.signalsFresh === null) unknownSignals.push("signals_fresh");

  if (blockingFindings.length > 0) {
    const reason: PimReasonCode = blockingFindings.includes("device_blocked")
      ? "DEVICE_BLOCKED"
      : blockingFindings.includes("non_human_actor")
        ? "NON_HUMAN_ACTOR"
        : "NO_VALID_TICKET";
    return {
      outcome: "Denied" satisfies PimOutcome,
      reasonCode: reason,
      explanation: explain(reason, req),
      blockingFindings,
      unknownSignals,
      autoApprovalConfirmed: false,
      requestId: req.requestId,
    };
  }

  // ── AutoApproved: every input positively confirmed, and nothing else ──────────
  const autoApproved =
    req.requestIntegrity === "clean" &&
    req.ticketState === "valid" &&
    req.changeClass === "emergency" &&
    req.requesterOnCall === true &&
    req.deviceRiskTier === "ok" &&
    req.actorConfirmedHuman === true &&
    req.signalsFresh === true;

  if (autoApproved) {
    return {
      outcome: "AutoApproved",
      reasonCode: "AUTO_APPROVED_VERIFIED_ONCALL",
      explanation: explain("AUTO_APPROVED_VERIFIED_ONCALL", req),
      blockingFindings,
      unknownSignals,
      autoApprovalConfirmed: true,
      requestId: req.requestId,
    };
  }

  const reason: PimReasonCode =
    req.requestIntegrity !== "clean"
      ? "REQUEST_MALFORMED"
      : req.signalsFresh !== true
        ? "SIGNALS_STALE"
        : "APPROVER_REVIEW_REQUIRED";
  return {
    outcome: "Approved",
    reasonCode: reason,
    explanation: explain(reason, req),
    blockingFindings,
    unknownSignals,
    autoApprovalConfirmed: false,
    requestId: req.requestId,
  };
}

/** One line an operator — or an Entra audit reader — can act on without context. */
function explain(reason: PimReasonCode, req: NormalizedPimActivation): string {
  switch (reason) {
    case "AUTO_APPROVED_VERIFIED_ONCALL":
      return "Emergency change, valid ticket, requester verified on the on-call roster, and the device is healthy on a current read. Activated time-bound.";
    case "NO_VALID_TICKET":
      return `No valid change ticket for this activation (ticket ${req.ticketState}). Elevation refused.`;
    case "DEVICE_BLOCKED":
      return "The grid has this device at the BLOCKED tier. Privileged elevation is refused regardless of ticket state — resolve the device concern first.";
    case "NON_HUMAN_ACTOR":
      return "This activation was not confirmed to be requested by a person. A privileged role is not activated for a non-human identity through this path.";
    case "SIGNALS_STALE":
      return "The grid's view of this device is not confirmed current, so it cannot back an automatic approval. Routed to the approver group.";
    case "REQUEST_MALFORMED":
      return "The activation request could not be fully parsed, so no input can be treated as confirmed. Routed to the approver group.";
    case "APPROVER_REVIEW_REQUIRED":
      return "Nothing blocks this activation, but not every condition for automatic approval was positively confirmed. Routed to the approver group.";
  }
}
