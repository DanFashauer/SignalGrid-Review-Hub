// Types for the read-only agent-BEHAVIOR (action-judgment) dimension.
//
// The sibling `agent-identity` dimension answers "WHO is taking this action, and if
// it is a non-human identity, is that identity governed?" — the access question the
// market (Okta AI Agent Gateway, Microsoft Entra Agent ID, and every agent-IAM
// broker) is racing to solve: registered agent, short-lived scoped token, human
// approval, recorded actions. That is necessary, and it is largely solved.
//
// It is not sufficient. An agent inherits your identity; it does not inherit your
// judgment. A perfectly-credentialed, least-privilege, fully-approved agent can still
// take an action no human would: a one-line prompt that becomes 40,000 updates, an
// identity that has never once opened this application reaching into it now, an action
// with no originating human intent or process behind it, one write that fans out
// across a whole tenant, a burst of changes faster than any person could perform.
//
// This dimension is the JUDGMENT layer that questions the ACTION, not the identity.
// It is deliberately NOT policy-/role-based access control (PBAC): PBAC is
// deterministic and models human-paced traffic well, but an AI acting on behalf of a
// human is rapid and needs contextual judgment PBAC cannot express. This is that
// judgment, expressed as runtime signals fused fail-closed like every other dimension.
//
// It normalizes an already-evaluated behavioral view from a bridge (an agent-activity
// monitor, a UEBA/behavior-analytics engine, or the agent gateway's own telemetry). It
// takes no action of its own; it reports a posture the fabric fuses.

/** How the action's VOLUME compares to the identity's established baseline for this
 *  kind of action. `burst` = orders of magnitude over baseline (the prompt→40k case);
 *  `elevated` = materially above baseline but not a burst. */
export type VolumeState = "within_expected" | "elevated" | "burst" | "unknown";

/** Whether this identity has an established history with the target app/resource.
 *  `first_seen` = the identity has never touched this target before. */
export type TargetFamiliarity = "familiar" | "first_seen" | "unknown";

/** Whether an authorizing human intent / process / ticket sits behind the action.
 *  `absent` = nothing says this should happen (no prompt-of-record, no change window,
 *  no workflow) — the action appeared with no provenance. */
export type Provenance = "authorized" | "absent" | "unknown";

/** How wide a single action reaches. `broad` = one action fanning out across many
 *  resources / tenants / records at once. */
export type BlastRadius = "scoped" | "broad" | "unknown";

/** Whether the action's timing is achievable by a human. `superhuman` = a rate no
 *  person could produce (the signal PBAC's human-paced model cannot represent). */
export type Cadence = "human_plausible" | "superhuman" | "unknown";

/** Raw behavioral report about one action by one actor on one device (loosely typed —
 *  any field may degrade to null / an error string). EVERY field is typed `unknown`,
 *  including booleans: a bridge is an external system and can emit `"true"`, `1`,
 *  `["burst"]`, or `"ERR: timeout"` in any slot. The normalizer — not the compiler —
 *  is what makes a value safe. */
export interface AgentBehaviorReportRaw {
  volumeState?: unknown; // within_expected | elevated | burst | unknown
  targetFamiliarity?: unknown; // familiar | first_seen | unknown
  provenance?: unknown; // authorized | absent | unknown
  blastRadius?: unknown; // scoped | broad | unknown
  cadence?: unknown; // human_plausible | superhuman | unknown
  /** Was the behavior-analytics bridge reachable to evaluate this action? */
  bridgeReachable?: unknown;
  [k: string]: unknown;
}

/** The exact set of keys this connector understands. A raw report carrying anything
 *  else is not fully understood — see `reportIntegrity`. */
export const AGENT_BEHAVIOR_REPORT_KEYS = [
  "volumeState",
  "targetFamiliarity",
  "provenance",
  "blastRadius",
  "cadence",
  "bridgeReachable",
] as const;

/** Did the raw report parse cleanly? `malformed` = at least one field was PRESENT but
 *  unparseable, or the report carried an unrecognized key. `unknown` on a field denies
 *  the grant, so the collapse is safe for the allow path — but an operator and a
 *  contradiction check still need to tell "said nothing" from "said something we could
 *  not read". `reportIntegrity` keeps them apart. */
export type ReportIntegrity = "clean" | "malformed";

/** The normalized, vendor-neutral behavioral posture — one shape the fabric reads. */
export interface NormalizedAgentBehavior {
  sourceSystem: "agent-behavior";
  deviceId: string;
  volumeState: VolumeState;
  targetFamiliarity: TargetFamiliarity;
  provenance: Provenance;
  blastRadius: BlastRadius;
  cadence: Cadence;
  bridgeReachable: boolean | null;
  /** Whether the raw report parsed cleanly. The evaluator refuses to grant on a
   *  `malformed` report even if every field looks in-pattern — defence in depth. */
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type AgentBehaviorPosture =
  | "in_pattern"
  | "volume_burst"
  | "volume_elevated"
  | "unfamiliar_target"
  | "no_provenance"
  | "broad_blast"
  | "superhuman_cadence"
  | "unverified"
  | "unknown";

export type AgentBehaviorReasonCode =
  | "IN_PATTERN"
  | "VOLUME_BURST"
  | "VOLUME_ELEVATED"
  | "UNFAMILIAR_TARGET"
  | "NO_PROVENANCE"
  | "BROAD_BLAST"
  | "SUPERHUMAN_CADENCE"
  | "BEHAVIOR_UNKNOWN"
  | "BRIDGE_UNREACHABLE"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type AgentBehaviorAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface AgentBehaviorVerdict {
  posture: AgentBehaviorPosture;
  reasonCode: AgentBehaviorReasonCode;
  recommendedAction: AgentBehaviorAction;
  /** Containment-level findings — every restrict/escalate condition contributes one
   *  (burst volume, absent provenance, broad blast radius). */
  criticalFindings: string[];
  /** Behavioral facts whose state could NOT be determined (raise the bar). */
  unknownSignals: string[];
  /** True ONLY when EVERY behavioral signal is positively confirmed in-pattern and the
   *  bridge was reachable — a volume within baseline, a familiar target, authorized
   *  provenance, a scoped blast radius, human-plausible cadence. Never true on an
   *  unknown or unreachable read: judgment that cannot be verified is not a grant. */
  actionJudgedSafe: boolean;
  deviceId: string;
}

export type AgentBehaviorConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class AgentBehaviorConnectorError extends Error {
  readonly code: AgentBehaviorConnectorErrorCode;
  readonly status: number;
  constructor(code: AgentBehaviorConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "AgentBehaviorConnectorError";
    this.code = code;
    this.status = status;
  }
}
