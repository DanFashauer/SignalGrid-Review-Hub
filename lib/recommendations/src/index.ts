// @workspace/recommendations — the Grid learns habits and recommends better flows.
//
// The more a business runs its flows (and the more signals/APIs it opens), the
// more the Grid can see: which approvals are always granted, which flows keep
// breaking for want of a signal, which actions show anomalies, which flows are
// near-duplicates. This module turns that observed history into ADVISORY
// recommendations — automate an action, tighten one, add a signal, merge two
// flows. It never changes anything: recommendations are proposals an admin
// reviews and applies (fail-safe by construction).
//
// Pure and deterministic — no Date.now / Math.random; public-safe fixtures.

import type { ApprovalPolicy, Flow } from "@workspace/flows";

// ── observed usage (the "habits" the Grid learns from) ──────────────────────

export interface ActionUsage {
  flowId: string;
  actionKey: string;
  /** The action's CURRENT approval policy. */
  approvalPolicy: ApprovalPolicy;
  /** How many times this action was reached. */
  samples: number;
  /** Times a human approved it. */
  approved: number;
  /** Times it was denied / rejected. */
  denied: number;
  /** Times a break-glass override was used. */
  overrides: number;
  /** Fraction of samples where posture was fully healthy (0..1). */
  postureHealthyRate: number;
}

export interface FlowUsage {
  flowId: string;
  /** Times the flow broke over the window. */
  breaks: number;
  /** The signal most responsible for those breaks, if any. */
  breakingSignal?: string;
  /** A candidate signal (e.g. from signal-radar) that would harden this flow. */
  candidateSignal?: string;
  /** step-up + restrict + deny rate for this flow (0..1). */
  frictionRate: number;
  /** Total decisions observed on this flow. */
  samples: number;
}

export interface UsageHistory {
  actions: ActionUsage[];
  flows: FlowUsage[];
}

// ── recommendations ─────────────────────────────────────────────────────────

export type RecommendationKind =
  | "automate_action"
  | "tighten_action"
  | "add_signal"
  | "merge_flows";

export interface Recommendation {
  id: string;
  kind: RecommendationKind;
  /** What the recommendation is about (a flow id, "flowId:actionKey", etc.). */
  target: string;
  title: string;
  rationale: string;
  /** 0..1 — how strongly the observed history supports this. */
  confidence: number;
  /** The concrete change proposed (advisory; never auto-applied). */
  suggestedChange: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Step an approval policy one level LESS strict (safer than jumping to automated). */
function relax(p: ApprovalPolicy): ApprovalPolicy | null {
  if (p === "dual_approval") return "admin_approval";
  if (p === "admin_approval") return "automated";
  return null; // already automated, or a downtime override — never relax those
}
/** Step an approval policy one level MORE strict. */
function tighten(p: ApprovalPolicy): ApprovalPolicy | null {
  if (p === "automated") return "admin_approval";
  if (p === "admin_approval") return "dual_approval";
  return null;
}

// Thresholds — conservative on purpose: a recommendation should need real evidence.
const MIN_SAMPLES = 20;
const AUTO_APPROVE_RATE = 0.95;
const HEALTHY_RATE = 0.98;
const BREAK_THRESHOLD = 3;
const HIGH_FRICTION = 0.25;
const MERGE_SIMILARITY = 0.8;

/**
 * Recommend flow/signal improvements from the observed usage history. Sorted by
 * confidence, most-supported first. Advisory only — nothing is changed.
 */
export function recommend(usage: UsageHistory, flows: Flow[]): Recommendation[] {
  const recs: Recommendation[] = [];
  const flowById = new Map(flows.map((f) => [f.id, f]));

  // 1 & 2. Per-action: relax a consistently-approved gate, or tighten an anomalous one.
  for (const a of usage.actions) {
    if (a.samples < MIN_SAMPLES) continue;
    const approveRate = a.approved / a.samples;
    const flowName = flowById.get(a.flowId)?.name ?? a.flowId;

    // Anomalies (a denial or an override) → recommend MORE scrutiny, first.
    if (a.denied > 0 || a.overrides > 0) {
      const stricter = tighten(a.approvalPolicy);
      if (stricter) {
        recs.push({
          id: `tighten:${a.flowId}:${a.actionKey}`,
          kind: "tighten_action",
          target: `${a.flowId}:${a.actionKey}`,
          title: `Tighten "${a.actionKey}" in ${flowName}`,
          rationale: `${a.denied} denial(s) and ${a.overrides} override(s) over ${a.samples} samples suggest this action needs more scrutiny.`,
          confidence: round2(Math.min(1, (a.denied + a.overrides) / a.samples + 0.5)),
          suggestedChange: `Change approval from ${a.approvalPolicy} → ${stricter}.`,
        });
      }
      continue; // don't also recommend relaxing an action with anomalies
    }

    // Consistently approved on healthy posture → recommend one step LESS strict.
    const relaxed = relax(a.approvalPolicy);
    if (relaxed && approveRate >= AUTO_APPROVE_RATE && a.postureHealthyRate >= HEALTHY_RATE) {
      recs.push({
        id: `automate:${a.flowId}:${a.actionKey}`,
        kind: "automate_action",
        target: `${a.flowId}:${a.actionKey}`,
        title: `Reduce friction on "${a.actionKey}" in ${flowName}`,
        rationale: `Approved ${Math.round(approveRate * 100)}% of ${a.samples} times, no denials/overrides, posture healthy ${Math.round(a.postureHealthyRate * 100)}% of the time.`,
        confidence: round2(Math.min(1, a.samples / 50) * approveRate),
        suggestedChange: `Change approval from ${a.approvalPolicy} → ${relaxed} (one step; review before applying).`,
      });
    }
  }

  // 3. Per-flow: add a signal to a flow that keeps breaking or runs hot.
  for (const f of usage.flows) {
    const flowName = flowById.get(f.flowId)?.name ?? f.flowId;
    if (f.candidateSignal && (f.breaks >= BREAK_THRESHOLD || f.frictionRate >= HIGH_FRICTION)) {
      const why = f.breaks >= BREAK_THRESHOLD
        ? `broke ${f.breaks} times${f.breakingSignal ? ` (often on "${f.breakingSignal}")` : ""}`
        : `runs at ${Math.round(f.frictionRate * 100)}% friction`;
      recs.push({
        id: `add_signal:${f.flowId}:${f.candidateSignal}`,
        kind: "add_signal",
        target: f.flowId,
        title: `Add signal "${f.candidateSignal}" to ${flowName}`,
        rationale: `${flowName} ${why}; the "${f.candidateSignal}" signal would harden it and tighten its decisions.`,
        confidence: round2(Math.min(1, (f.breaks / (f.samples || 1)) + f.frictionRate)),
        suggestedChange: `Wire "${f.candidateSignal}" into ${flowName}'s required signals.`,
      });
    }
  }

  // 4. Cross-flow: merge near-duplicate flows.
  for (let i = 0; i < flows.length; i++) {
    for (let j = i + 1; j < flows.length; j++) {
      const sim = flowSimilarity(flows[i], flows[j]);
      if (sim >= MERGE_SIMILARITY) {
        recs.push({
          id: `merge:${flows[i].id}:${flows[j].id}`,
          kind: "merge_flows",
          target: `${flows[i].id}:${flows[j].id}`,
          title: `Consider merging ${flows[i].name} and ${flows[j].name}`,
          rationale: `The two flows share ${Math.round(sim * 100)}% of their signals and actions; one flow may be simpler to run.`,
          confidence: round2(sim),
          suggestedChange: `Review whether ${flows[i].name} and ${flows[j].name} can be a single flow.`,
        });
      }
    }
  }

  return recs.sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
}

/** Jaccard similarity over a flow's required signals + action keys. */
export function flowSimilarity(a: Flow, b: Flow): number {
  const setA = new Set([...a.requiredSignals, ...a.actions.map((x) => `act:${x.key}`)]);
  const setB = new Set([...b.requiredSignals, ...b.actions.map((x) => `act:${x.key}`)]);
  const inter = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : round2(inter / union);
}

// ── fixture usage ─────────────────────────────────────────────────────────────

export { DEMO_USAGE } from "./fixture";
