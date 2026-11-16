/**
 * One place where a verdict becomes a badge tone in this tree.
 *
 * The PWA's `OutcomeBadge` used to seed its colour with a NEUTRAL grey
 * (`text-zinc-500 …`) and then overwrite it through an if/else chain over the
 * four verdicts it knew. Any verdict it did not know — `step_up` spelled with an
 * underscore, `escalate`, an empty string — kept the grey, so an unrecognised
 * decision rendered as the quietest thing on the screen. The desktop's
 * `lib/outcome-tone.ts` had already written the rule the other way ("an
 * unrecognised verdict resolves to the RESTRICTIVE tone, never to a neutral
 * one") and applied it to three of its own five sites; it never reached this
 * tree. This module is the same shape: a TOTAL `Record` over the closed verdict
 * union, so a new verdict is a typecheck failure rather than a silent
 * fallthrough, and one helper whose fallback direction is restrictive.
 *
 * `scripts/check-verdict-tone-source.mjs` names this file as a tone module and
 * asserts, across both trees, that the `??` fallback here is a restrictive token
 * and that no other file carries a verdict→class map of its own.
 */

/** The four-verdict vocabulary, spelled as the control-plane API spells it. */
export type Outcome = "allow" | "step-up" | "restrict" | "deny";

/** Badge tone for a verdict. Total: every member is named, none inferred. */
export const OUTCOME_BADGE_TONE: Record<Outcome, string> = {
  allow: "bg-status-allow",
  "step-up": "bg-status-step-up",
  restrict: "bg-status-restrict",
  deny: "bg-status-deny",
};

/**
 * Tone for a verdict that may not be one we recognise. An unknown must tighten
 * the answer; on a rendered surface that means it must be visible and it must
 * not look benign.
 */
export function outcomeBadgeTone(outcome: string): string {
  return OUTCOME_BADGE_TONE[outcome as Outcome] ?? "bg-status-restrict";
}

/**
 * How a verdict is drawn as a chart series. Backlog row 107: the Overview chart
 * painted `restrict` from `--chart-4` and `deny` from `--destructive`, which
 * resolve to the same #C67070, so the two stacked segments had a computed
 * 1.0000:1 boundary and no legend, tooltip or axis to tell them apart. Only
 * three decision tones are ratified, so restrict and deny SHARE `--decision-deny`
 * on purpose (the desktop Dashboard makes the same choice) and are separated by
 * a second, non-colour channel: restrict is hatched, deny is solid.
 *
 * `scripts/check-verdict-tone-source.mjs` IMPORTS this module and judges what it
 * paints, not what it declares: `chartFill(restrict)` must differ from
 * `chartFill(deny)`, every solid fill must be the verdict's ratified
 * `--decision-*` token, the hatch must leave gaps, and each verdict must read
 * its own series key. The keys are also bound per verdict at the type level, so
 * swapping restrict's and deny's `dataKey` is a typecheck failure.
 */
export type ChartPattern = "solid" | "hatch";

/** Each verdict's count key in the decision-series API rows. */
export interface OutcomeSeriesKey {
  allow: "allow";
  "step-up": "stepUp";
  restrict: "restrict";
  deny: "deny";
}

export interface OutcomeChartMark<O extends Outcome = Outcome> {
  dataKey: OutcomeSeriesKey[O];
  label: string;
  token: string;
  pattern: ChartPattern;
}

export const OUTCOME_CHART_MARK: { readonly [O in Outcome]: OutcomeChartMark<O> } = {
  allow: { dataKey: "allow", label: "Allow", token: "--decision-allow", pattern: "solid" },
  "step-up": { dataKey: "stepUp", label: "Step-up", token: "--decision-review", pattern: "solid" },
  restrict: { dataKey: "restrict", label: "Restrict", token: "--decision-deny", pattern: "hatch" },
  deny: { dataKey: "deny", label: "Deny", token: "--decision-deny", pattern: "solid" },
};

/**
 * Hatch geometry, in user-space units. The stripe must be narrower than the
 * tile, or the "hatch" is a solid block and restrict is deny's pixel again.
 */
export const HATCH_PATTERN = { size: 4, stripeWidth: 2, angle: 45 } as const;

/** Stack order, least to most restrictive. */
export const OUTCOME_ORDER: readonly Outcome[] = ["allow", "step-up", "restrict", "deny"];

/**
 * The SVG pattern id a hatched series fills from. `scope` keeps the chart's and
 * the legend swatch's definitions distinct, since ids are document-global.
 */
export const hatchPatternId = (outcome: Outcome, scope = "chart"): string => `sg-hatch-${scope}-${outcome}`;

/** The `fill` a series (or its legend swatch) paints with. */
export function chartFill(outcome: Outcome, scope = "chart"): string {
  const mark = OUTCOME_CHART_MARK[outcome];
  return mark.pattern === "hatch" ? `url(#${hatchPatternId(outcome, scope)})` : `hsl(var(${mark.token}))`;
}
