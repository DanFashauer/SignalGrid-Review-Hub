// Types for the read-only agentic / non-human-identity (NHI) dimension.
//
// Every other identity dimension in the fabric assumes a PERSON is acting:
// `sso-session` asks whose session is live, `pacs-access` asks who badged in,
// `access-governance` asks what that human is entitled to. None of them ask the
// question that matters once AI agents and service accounts start acting on a
// shared frontline device: **is this action being taken by a human at all — and if
// it is being taken by a non-human identity, is that identity governed?**
//
// The governance model here is the one the industry has converged on: treat an AI
// agent like a privileged access request. A non-human identity acting on a shared,
// badge-checked-out device should be registered in an inventory, hold a SHORT-LIVED
// token scoped to least privilege, carry a current human approval, and have its
// actions recorded. An unregistered agent, an expired approval, or a standing
// (never-expiring) credential is the non-human equivalent of a leaver still holding
// a key.
//
// Distinct from `oauth-consent`, which asks about the *credential hygiene* of a
// workload (is its secret managed?). This asks about an identity **taking an action
// in a live session right now**.
//
// This connector normalizes an agent-governance bridge's already-evaluated view. It
// registers no agent, mints no token, and revokes no access — those stay with the
// identity provider and the agent registry.

/** Who is taking this action. `service_account` is a non-interactive automation
 *  identity; `agent` is an autonomous/AI actor. Both are non-human. */
export type ActorType = "human" | "agent" | "service_account" | "unknown";

/** Lifetime of the credential backing the action. `standing` = a permanent,
 *  never-expiring credential — the strongest negative for a non-human identity. */
export type TokenLifetime = "short_lived" | "long_lived" | "standing" | "unknown";

/** Scope granted to the non-human identity. `unscoped` = no scope restriction at
 *  all; `over_scoped` = broader than the task requires. */
export type ScopeState = "least_privilege" | "over_scoped" | "unscoped" | "unknown";

/** State of the human-in-the-loop approval governing this identity's access.
 *  `none` = never approved; `expired` = the approval lapsed but access persists. */
export type ApprovalState = "approved" | "pending" | "none" | "expired" | "unknown";

/** Whether the identity's actions are being recorded for audit. */
export type RecordingState = "recorded" | "unrecorded" | "unknown";

/** Raw agent-governance report about one actor on one device (loosely typed — any
 *  field may degrade to null / an error string). */
export interface AgentIdentityReportRaw {
  actorType?: unknown; // human | agent | service_account | unknown
  /** Is this non-human identity present in the agent/NHI registry? Typed
   *  `unknown` like every sibling field: a non-boolean must be visibly possible so
   *  the normalizer, not the type, is what makes it safe. */
  agentRegistered?: unknown;
  tokenLifetime?: unknown; // short_lived | long_lived | standing | unknown
  scopeState?: unknown; // least_privilege | over_scoped | unscoped | unknown
  approvalState?: unknown; // approved | pending | none | expired | unknown
  recordingState?: unknown; // recorded | unrecorded | unknown
  /** Was the governance bridge reachable to evaluate this actor? */
  bridgeReachable?: boolean | null;
  [k: string]: unknown;
}

/** The normalized, vendor-neutral agent-identity posture — one shape the fabric reads. */
export interface NormalizedAgentIdentity {
  sourceSystem: "agent-identity";
  deviceId: string;
  actorType: ActorType;
  /** true = in the registry; false = unregistered; null = not reported. Only
   *  meaningful for a non-human actor. */
  agentRegistered: boolean | null;
  tokenLifetime: TokenLifetime;
  scopeState: ScopeState;
  approvalState: ApprovalState;
  recordingState: RecordingState;
  bridgeReachable: boolean | null;
  source: string;
}

export type AgentIdentityPosture =
  | "human_actor"
  | "governed_agent"
  | "unregistered_agent"
  | "ungoverned_agent"
  | "over_scoped_agent"
  | "unrecorded_agent"
  | "weak_agent_credential"
  | "unverified"
  | "unknown";

export type AgentIdentityReasonCode =
  | "HUMAN_ACTOR"
  | "GOVERNED_AGENT"
  | "UNREGISTERED_AGENT"
  | "APPROVAL_EXPIRED"
  | "STANDING_CREDENTIAL"
  | "AGENT_OVER_SCOPED"
  | "AGENT_UNSCOPED"
  | "AGENT_UNRECORDED"
  | "LONG_LIVED_CREDENTIAL"
  | "APPROVAL_PENDING"
  | "APPROVAL_ABSENT"
  | "AGENT_STATE_UNKNOWN"
  | "BRIDGE_UNREACHABLE"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type AgentIdentityAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface AgentIdentityVerdict {
  posture: AgentIdentityPosture;
  reasonCode: AgentIdentityReasonCode;
  recommendedAction: AgentIdentityAction;
  /** Containment-level findings — every escalate- and restrict-level condition
   *  contributes one (unregistered agent, expired/absent approval, standing
   *  credential, over-scoped or unscoped agent, unrecorded agent). */
  criticalFindings: string[];
  /** Governance facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True when the actor is a confirmed human, OR a non-human identity confirmed
   *  fully governed (registered + short-lived + least-privilege + approved +
   *  recorded). Never true for an unverified or ungoverned actor. */
  actorGoverned: boolean;
  /** True only when the actor is positively confirmed NON-human — lets the fabric
   *  and operators distinguish "a governed agent did this" from "a person did this". */
  nonHumanActor: boolean;
  deviceId: string;
}

export type AgentIdentityConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class AgentIdentityConnectorError extends Error {
  readonly code: AgentIdentityConnectorErrorCode;
  readonly status: number;
  constructor(code: AgentIdentityConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "AgentIdentityConnectorError";
    this.code = code;
    this.status = status;
  }
}
