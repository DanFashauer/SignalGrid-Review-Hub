// The PLAIN-LANGUAGE layer: turn a SelfAuditReport into sentences a non-expert
// administrator can act on without knowing what a "probe" or a "connector" is.
//
// The product thesis is that SignalGrid is invisible and "just works". The
// administrative side must feel the same: an owner should open one screen and read,
// in ordinary words, either "Everything is working" or "N things need your
// attention", each with a one-line human explanation and — when we can offer one —
// a described fix they approve with a tap. No status codes, no jargon, no dashboards
// that require a manual. This module is that translation, and it is a PURE function
// of the report so it stays deterministic and testable.

import type {
  AuditLayer,
  CheckStatus,
  HealProposal,
  SelfAuditReport,
} from "./types";

// Codepoint comparison for sorts that must be DETERMINISTIC on any machine.
// `localeCompare` follows the process locale (sv_SE sorts "ä" after "z", de_DE
// before it), so two hosts ordered the same input differently; ISO timestamps
// and ids compare exactly as intended by codepoint. Gated by review:invariants.
const cmpCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);


/** How a layer is named to a human. The internal keys are engineering terms; these
 *  are what an administrator reads. */
const LAYER_LABEL: Readonly<Record<AuditLayer, string>> = Object.freeze({
  backend: "The decision service",
  frontend: "The screens people use",
  api_integration: "The connected systems",
  meta: "Our own monitoring",
});

/** A status, in a word an administrator understands — never the internal enum. */
const STATUS_WORD: Readonly<Record<CheckStatus, string>> = Object.freeze({
  healthy: "Working",
  drifted: "Needs a look",
  unknown: "Not checked",
  broken: "Needs attention",
});

/** One plain-language line about one part of the system. */
export interface PlainLine {
  /** The human area name. */
  area: string;
  /** The one-word human status. */
  state: string;
  /** Whether this line is something the administrator should act on. */
  needsAttention: boolean;
  /** A single ordinary sentence explaining the state. */
  sentence: string;
}

/** The whole system, said plainly. */
export interface PlainSummary {
  /** The one-line headline: the first thing the administrator reads. */
  headline: string;
  /** True when nothing needs attention — the "it just works" state. */
  allClear: boolean;
  /** How many items need attention (broken/drifted/unknown), for the badge. */
  attentionCount: number;
  /** Per-area plain lines, worst-first so what matters is at the top. */
  lines: PlainLine[];
  /** Plain-language descriptions of the fixes on offer, if any. Each maps to a
   *  governed HealProposal the administrator approves — the approval itself stays
   *  human-gated; this is only how the choice is WORDED. */
  suggestedFixes: PlainFix[];
}

/** A fix, worded for a human. `proposalId` ties it back to the governed proposal. */
export interface PlainFix {
  proposalId: string;
  area: string;
  /** "Here's what we'd do", in ordinary words. */
  whatWeWouldDo: string;
  /** Always true here — a fix is only ever offered, never done, without a person. */
  needsYourApproval: true;
}

const ATTENTION: ReadonlySet<CheckStatus> = new Set<CheckStatus>(["broken", "drifted", "unknown"]);

/** Order lines worst-first: broken, then not-checked, then needs-a-look, then working. */
const LINE_ORDER: Readonly<Record<CheckStatus, number>> = Object.freeze({
  broken: 0,
  unknown: 1,
  drifted: 2,
  healthy: 3,
});

function sentenceFor(area: string, status: CheckStatus): string {
  switch (status) {
    case "healthy":
      return `${area} is working as expected.`;
    case "drifted":
      return `${area} is working but something has slipped and should be looked at.`;
    case "unknown":
      return `${area} could not be checked, so we are treating it as unverified to stay safe.`;
    case "broken":
      return `${area} is not working correctly and needs attention.`;
  }
}

/**
 * Turn a self-audit report (and the governed heal proposals derived from it) into a
 * plain-language summary. Pure and deterministic.
 *
 * The headline is deliberately calm and absolute: either everything is working, or a
 * specific count needs attention. "Not checked" counts as needing attention — the
 * administrator should know when the system could not verify itself, never be shown
 * a false all-clear (the same fail-closed discipline the engine uses internally).
 */
export function summarizePlain(
  report: SelfAuditReport,
  heals: readonly HealProposal[] = [],
): PlainSummary {
  // Per-layer lines, from the report's per-layer worst status.
  const layers = Object.keys(report.byLayer) as AuditLayer[];
  const lines: PlainLine[] = layers
    .map((layer) => {
      const status = report.byLayer[layer];
      const area = LAYER_LABEL[layer];
      return {
        area,
        state: STATUS_WORD[status],
        needsAttention: ATTENTION.has(status),
        sentence: sentenceFor(area, status),
      };
    })
    .sort((a, b) => {
      // worst-first by the underlying status; ties keep a stable area order
      const sa = report.byLayer[layers.find((l) => LAYER_LABEL[l] === a.area)!];
      const sb = report.byLayer[layers.find((l) => LAYER_LABEL[l] === b.area)!];
      const d = LINE_ORDER[sa] - LINE_ORDER[sb];
      return d !== 0 ? d : cmpCodepoint(a.area, b.area);
    });

  const attentionCount = report.counts.broken + report.counts.drifted + report.counts.unknown;
  // allClear reflects the WHOLE report, not just per-item counts. An audit that checked
  // nothing (or left a functional layer unverified) has zero attention ITEMS but is not
  // "all clear" — its overall is `unknown`. Requiring overall === "healthy" makes a
  // false all-clear impossible, honoring "never be shown a false all-clear" above.
  const allClear = report.overall === "healthy" && attentionCount === 0;
  const headline = allClear
    ? "Everything is working."
    : attentionCount === 0
      ? // No item flagged, yet the report is not healthy — a layer went unchecked.
        "The system could not fully check itself."
      : attentionCount === 1
        ? "1 thing needs your attention."
        : `${attentionCount} things need your attention.`;

  const suggestedFixes: PlainFix[] = heals
    .filter((h) => h.status === "proposed")
    .map((h) => ({
      proposalId: h.proposalId,
      area: LAYER_LABEL[h.layer],
      whatWeWouldDo: h.remediation,
      needsYourApproval: true as const,
    }))
    .sort((a, b) => cmpCodepoint(a.proposalId, b.proposalId));

  return {
    headline,
    allClear,
    attentionCount,
    lines,
    suggestedFixes,
  };
}
