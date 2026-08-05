// Unified device-posture composition: fuse the independent signal verdicts
// (device posture, reachability, location, vulnerability, network/NAC, EDR/EPP
// threat-state, identity/SSO sign-in risk, RTLS physical custody, removable-media
// / peripheral control, data-protection / DLP, cross-domain detections) into ONE
// decision-relevant
// answer — the strongest action any signal warrants and the overall risk tier —
// with the drivers that produced it. Pure and deterministic.

/**
 * The single, unified action ladder every dimension maps onto, ordered from
 * least to most severe. Composition picks the strongest across all signals.
 */
export type UnifiedAction =
  | "none"
  | "monitor"
  | "patch"
  | "locate"
  | "step_up"
  | "alert"
  | "restrict"
  | "escalate";

export const UNIFIED_ACTIONS: readonly UnifiedAction[] = [
  "none",
  "monitor",
  "patch",
  "locate",
  "step_up",
  "alert",
  "restrict",
  "escalate",
];

export type RiskTier = "ok" | "watch" | "at_risk" | "blocked";

/** Every dimension that can contribute a signal to the fabric.
 *
 *  Declared as a const ARRAY with the union derived from it, rather than as a bare union,
 *  and the reason is a defect this repo actually had. A union is invisible at runtime, so
 *  a test that wants to assert something about "every kind" has to restate the list by
 *  hand — and `scripts/src/incident-playbook-proof.ts` did exactly that, asserting that no
 *  kind falls through to the generic Service Desk. That hand-copy drifted **five kinds**
 *  behind: `token_binding`, `pacs_access`, `agent_identity`, `device_management_health`
 *  and `link_usability` were added to the union and to `categoryForKind`, and their
 *  routing was never gated. Adversarial review noticed it on the newest one.
 *
 *  Deriving the union from the array makes the list enumerable at runtime, so the proof
 *  iterates the real thing and a new kind is covered the moment it is added. The failure
 *  mode is designed out rather than watched for. */
export const SIGNAL_KINDS = [
  "device_posture",
  "reachability",
  "location",
  "vulnerability",
  "network",
  "threat",
  "identity",
  "custody",
  "peripheral",
  "data_protection",
  "credential_exposure",
  "ot_posture",
  "access_governance",
  "attestation",
  "sso_session",
  "oauth_consent",
  "token_binding",
  "pacs_access",
  "agent_identity",
  "agent_behavior",
  "custody_beacon",
  "app_update",
  "platform_sso",
  "policy_binding",
  "benchmark_selection",
  "shift_context",
  "change_window",
  "location_certainty",
  "bootstrap_credential",
  "challenge_capability",
  "sse_egress",
  "device_management_health",
  "link_usability",
  "task_exception",
  "service_lifecycle",
  "session_readiness",
  "break_glass",
  "credential_rotation",
  "observability_integrity",
  "local_authority",
  "detection",
] as const;

export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** One dimension's contribution, already mapped onto the unified action ladder. */
export interface ComposableSignal {
  kind: SignalKind;
  posture: string;
  action: UnifiedAction;
  reason: string;
}

export interface RiskDriver extends ComposableSignal {
  /** 0..7 rank of `action` on the unified ladder (higher = more severe). */
  rank: number;
}

export interface UnifiedPosture {
  riskTier: RiskTier;
  strongestAction: UnifiedAction;
  /** Contributing signals, most-severe first (stable within equal rank). */
  drivers: RiskDriver[];
  signalCount: number;
}
