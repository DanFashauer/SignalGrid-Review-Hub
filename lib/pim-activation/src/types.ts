// Types for the PIM activation decision surface.
//
// Every other dimension in this repo is READ-ONLY and OUTBOUND: SignalGrid consumes a
// vendor's already-evaluated state and composes a verdict that something else may act
// on. This one is different, and it is the difference that matters commercially.
//
// Microsoft Entra Privileged Identity Management supports a **custom extension** on
// role activation: when an engineer activates an eligible role, PIM calls a REST API
// you own, and ENFORCES the answer it gets back. Three outcomes are defined —
// `Denied`, `Approved` (route to the approver group), and `AutoApproved` (activate
// immediately, time-bound). That is a real, documented control point where SignalGrid
// is not observing a decision but MAKING one that Microsoft obeys.
//
// This is also the honest answer to "what does SignalGrid add over Conditional
// Access?" — see COMPETITIVE_ENTRA. CA decides whether a session may reach a resource.
// This decides whether a *privileged role* may be activated *right now*, and it can
// refuse on grounds CA cannot see: the physical custody of the shared device, its
// badge binding, its baseline drift, whether the actor is even a person. A ticket
// check alone cannot do that. A verified on-call engineer holding a valid P1 ticket on
// a device the grid has BLOCKED is exactly the case this exists to catch.
//
// SignalGrid activates no role, mints no token, and writes nothing back to Entra. It
// answers the question PIM asked and records the evidence.

/** Was the change ticket validated in the ITSM system (ServiceNow-class)? */
export type TicketState = "valid" | "invalid" | "absent" | "unknown";

/** What kind of change is being made under this elevation. */
export type ChangeClass = "routine" | "emergency" | "unknown";

/** The fused device risk tier from the grid, as `composeDeviceRisk` reports it. */
export type DeviceRiskTier = "ok" | "watch" | "at_risk" | "blocked" | "unknown";

/** Raw activation request as it arrives from the PIM custom extension. Loosely typed
 *  on purpose: this is an EXTERNAL caller, and every field must be visibly capable of
 *  arriving malformed so the normalizer — not the compiler — is what makes it safe. */
export interface PimActivationRequestRaw {
  ticketState?: unknown; // valid | invalid | absent | unknown
  changeClass?: unknown; // routine | emergency | unknown
  requesterOnCall?: unknown; // boolean — verified against the on-call roster
  deviceRiskTier?: unknown; // ok | watch | at_risk | blocked | unknown
  actorConfirmedHuman?: unknown; // boolean — a role activation by a non-human is never routine
  signalsFresh?: unknown; // boolean — is the grid's view of this device current
  [k: string]: unknown;
}

/** The exact set of keys this surface understands. */
export const PIM_ACTIVATION_REQUEST_KEYS = [
  "ticketState",
  "changeClass",
  "requesterOnCall",
  "deviceRiskTier",
  "actorConfirmedHuman",
  "signalsFresh",
] as const;

/** Did the raw request parse cleanly? `malformed` = a known field was present but
 *  unparseable, or a key we do not understand was carried. Tracked separately from the
 *  field values because the allowlist collapses "said nothing" and "said something we
 *  could not read" into the same sentinel, and only one of those is silence. */
export type RequestIntegrity = "clean" | "malformed";

export interface NormalizedPimActivation {
  sourceSystem: "pim-activation";
  requestId: string;
  ticketState: TicketState;
  changeClass: ChangeClass;
  /** true = verified on the on-call roster; false = verified NOT on call; null = not reported. */
  requesterOnCall: boolean | null;
  deviceRiskTier: DeviceRiskTier;
  actorConfirmedHuman: boolean | null;
  signalsFresh: boolean | null;
  requestIntegrity: RequestIntegrity;
  source: string;
}

/** The three outcomes PIM defines and enforces. Names match the wire contract. */
export type PimOutcome = "Denied" | "Approved" | "AutoApproved";

export type PimReasonCode =
  | "AUTO_APPROVED_VERIFIED_ONCALL"
  | "APPROVER_REVIEW_REQUIRED"
  | "NO_VALID_TICKET"
  | "DEVICE_BLOCKED"
  | "NON_HUMAN_ACTOR"
  | "SIGNALS_STALE"
  | "REQUEST_MALFORMED";

export interface PimActivationVerdict {
  outcome: PimOutcome;
  reasonCode: PimReasonCode;
  /** Why, in the operator's words — one line, safe to surface in Entra's audit trail. */
  explanation: string;
  /** Conditions that forced a Denied. */
  blockingFindings: string[];
  /** Inputs whose state could not be determined. Any of these prevents AutoApproved. */
  unknownSignals: string[];
  /** True ONLY for AutoApproved: every input was positively confirmed. */
  autoApprovalConfirmed: boolean;
  requestId: string;
}
