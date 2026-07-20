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

export type SignalKind =
  | "device_posture"
  | "reachability"
  | "location"
  | "vulnerability"
  | "network"
  | "threat"
  | "identity"
  | "custody"
  | "peripheral"
  | "data_protection"
  | "detection";

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
