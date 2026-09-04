// Reliability, said plainly — so an owner reads the error-budget picture without
// knowing what an SLO is.

import { BUDGET_STATUS_RANK, type BudgetStatus, type ErrorBudgetResult, type ReliabilityReport } from "./types";

const STATUS_WORD: Readonly<Record<BudgetStatus, string>> = Object.freeze({
  healthy: "On track",
  at_risk: "Getting close",
  unknown: "Not measured",
  exhausted: "Over budget",
});

export interface ReliabilityPlainLine {
  objective: string;
  state: string;
  needsAttention: boolean;
  sentence: string;
}

export interface ReliabilityPlain {
  headline: string;
  allOnTrack: boolean;
  lines: ReliabilityPlainLine[];
}

const ATTENTION: ReadonlySet<BudgetStatus> = new Set<BudgetStatus>(["at_risk", "unknown", "exhausted"]);

function sentenceFor(b: ErrorBudgetResult): string {
  const name = b.slo.description;
  switch (b.status) {
    case "healthy":
      return b.slo.zeroTolerance
        ? `${name} — no breaches, exactly as required.`
        : `${name} We are well within the allowance for this window.`;
    case "at_risk":
      return `${name} Most of the allowance for this window is already used — worth attention before it runs out.`;
    case "unknown":
      return `${name} There is not enough recent activity to measure this yet.`;
    case "exhausted":
      return b.slo.zeroTolerance
        ? `${name} This must never happen and it did — a decision granted on a signal it could not verify. Treat as critical.`
        : `${name} The allowance for this window is used up; changes that add risk should pause until it recovers.`;
  }
}

/** Turn a reliability report into plain language. Pure and deterministic. */
export function summarizeReliability(report: ReliabilityReport): ReliabilityPlain {
  // Worst-first by the shared status rank: exhausted, then unknown, then at_risk,
  // then on-track — the most critical objective leads, since an owner reads the top
  // line first. A binary needs-attention/not sort is not enough: with two attention
  // lines it leaves them in input order, so a critical fail-closed breach could sit
  // BELOW a merely "getting close" one. Array.prototype.sort is stable, so equal-rank
  // lines keep their input order. (report.budgets is deep-frozen; sort a copy.)
  const lines: ReliabilityPlainLine[] = [...report.budgets]
    .sort((a, b) => BUDGET_STATUS_RANK[b.status] - BUDGET_STATUS_RANK[a.status])
    .map((b) => ({
      objective: b.slo.description,
      state: STATUS_WORD[b.status],
      needsAttention: ATTENTION.has(b.status),
      sentence: sentenceFor(b),
    }));

  const attention = report.budgets.filter((b) => ATTENTION.has(b.status)).length;
  const allOnTrack = attention === 0;
  const headline = allOnTrack
    ? "Reliability is on track."
    : attention === 1
      ? "1 reliability objective needs attention."
      : `${attention} reliability objectives need attention.`;

  return { headline, allOnTrack, lines };
}
