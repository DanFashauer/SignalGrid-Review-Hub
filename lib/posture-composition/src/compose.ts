import {
  UNIFIED_ACTIONS,
  type ComposableSignal,
  type RiskDriver,
  type RiskTier,
  type UnifiedAction,
  type UnifiedPosture,
} from "./types";

/** Rank of each action on the unified ladder (index in UNIFIED_ACTIONS). */
const ACTION_RANK: Record<UnifiedAction, number> = UNIFIED_ACTIONS.reduce(
  (acc, action, i) => {
    acc[action] = i;
    return acc;
  },
  {} as Record<UnifiedAction, number>,
);

/** The overall risk tier implied by the strongest action. */
const TIER_BY_ACTION: Record<UnifiedAction, RiskTier> = {
  none: "ok",
  monitor: "ok",
  patch: "watch",
  locate: "watch",
  step_up: "at_risk",
  alert: "at_risk",
  restrict: "blocked",
  escalate: "blocked",
};

/**
 * Fuse per-dimension signals into one unified posture. Deterministic: the
 * strongest action across all signals wins (fail-safe — the most severe concern
 * is never diluted by calmer ones), the tier follows from it, and the drivers are
 * returned most-severe-first with stable ordering for equal ranks. With no
 * signals the device is `ok` / `none` (nothing is known to be wrong), which a
 * caller can distinguish from an explicit clean signal by `signalCount`.
 */
export function composeDeviceRisk(signals: readonly ComposableSignal[]): UnifiedPosture {
  const drivers: RiskDriver[] = signals.map((s) => ({ ...s, rank: ACTION_RANK[s.action] }));

  // Stable sort by rank descending: preserve input order within equal ranks.
  const sorted = drivers
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (b.d.rank - a.d.rank) || (a.i - b.i))
    .map((x) => x.d);

  const strongestAction: UnifiedAction = sorted.length > 0 ? sorted[0].action : "none";
  return {
    riskTier: TIER_BY_ACTION[strongestAction],
    strongestAction,
    drivers: sorted,
    signalCount: signals.length,
  };
}

export { ACTION_RANK, TIER_BY_ACTION };
