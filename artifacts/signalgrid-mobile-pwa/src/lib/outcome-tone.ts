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
