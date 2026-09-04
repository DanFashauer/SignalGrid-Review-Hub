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

// An action that is not on the unified ladder is UNKNOWN — it reached here through an
// adapter's `as UnifiedAction` cast (40 of them) or a hand-built ComposableSignal, so the
// compiler never proved it valid. An unknown concern must fail CLOSED: treat it as the most
// severe, never let it become a NaN rank (which makes the sort order-dependent — a violation
// of determinism) or an `undefined` tier (which a downstream consumer reads as the permissive
// side). It ranks above every real rung and maps to the `blocked` tier.
const OFF_LADDER_RANK = UNIFIED_ACTIONS.length;
function rankOf(action: string): number {
  return Object.prototype.hasOwnProperty.call(ACTION_RANK, action)
    ? ACTION_RANK[action as UnifiedAction]
    : OFF_LADDER_RANK;
}
function tierOf(action: string): RiskTier {
  return Object.prototype.hasOwnProperty.call(TIER_BY_ACTION, action)
    ? TIER_BY_ACTION[action as UnifiedAction]
    : "blocked";
}

/**
 * Fuse the per-dimension signals into one unified posture. Deterministic: the
 * strongest action across all signals wins (fail-safe — the most severe concern
 * is never diluted by calmer ones), the tier follows from it, and the drivers are
 * returned most-severe-first with stable ordering for equal ranks. With no
 * signals the device is `ok` / `none` (nothing is known to be wrong), which a
 * caller can distinguish from an explicit clean signal by `signalCount`.
 */
export function composeDeviceRisk(signals: readonly ComposableSignal[]): UnifiedPosture {
  const drivers: RiskDriver[] = signals.map((s) => ({ ...s, rank: rankOf(s.action) }));

  // Stable sort by rank descending: preserve input order within equal ranks.
  const sorted = drivers
    .map((d, i) => ({ d, i }))
    .sort((a, b) => (b.d.rank - a.d.rank) || (a.i - b.i))
    .map((x) => x.d);

  const strongestAction: UnifiedAction = sorted.length > 0 ? sorted[0].action : "none";
  return {
    riskTier: tierOf(strongestAction),
    strongestAction,
    drivers: sorted,
    signalCount: signals.length,
  };
}

export { ACTION_RANK, TIER_BY_ACTION };
