/**
 * One place where a verdict — or a fail mode — becomes a colour in this tree.
 *
 * WHY THIS EXISTS. Three separate ternaries used to make this decision
 * independently (Policies, Handoff, Dashboard's legend), and they disagreed:
 *
 *  - `Policies.tsx` painted `fail-closed` RED and `fail-open` GREEN. Red reads as
 *    "problem" and green as "fine" to every viewer without instruction, so the page
 *    told an operator that the two correctly-configured policies were the problem
 *    and the one dangerous policy was fine. It was reachable with the shipped
 *    fixture, which carries one `fail-open` policy. The repo's own position is
 *    that "fail-closed integrity is zero-tolerance — one fail-open exhausts it and
 *    can never be bought back."
 *  - `Handoff.tsx` sent `restrict` to the STEP-UP tone via a two-branch else,
 *    colouring a MORE restrictive verdict with a LESS restrictive tone — while
 *    `Policies.tsx` got the same case right four lines below the one it got wrong.
 *  - `Dashboard.tsx`'s legend gave RESTRICT and DENY the same swatch. Both are
 *    painted from `--decision-deny` by design (only three tones are ratified, and
 *    the chart separates them with a dash pattern), but the legend reproduced the
 *    colour without the pattern, so the key said the two verdicts were identical.
 *
 * `check-decision-palette.mjs` passes on all three: it asserts a verdict is painted
 * from a RATIFIED TOKEN, and has no concept of WHICH verdict maps to which token,
 * nor of a legend. A mis-mapping is structurally invisible to it.
 *
 * The maps below are TOTAL `Record`s over closed unions, so a new verdict or fail
 * mode is a typecheck failure rather than a silent fallthrough to whatever the
 * final `else` happened to be.
 */

/** The four-verdict vocabulary, spelled as the control-plane API spells it. */
export type Outcome = "allow" | "step-up" | "restrict" | "deny";

/** Text tone for a verdict. Total: every member is named, none inferred. */
export const OUTCOME_TONE: Record<Outcome, string> = {
  allow: "text-status-allow",
  "step-up": "text-status-step-up",
  restrict: "text-status-restrict",
  deny: "text-status-deny",
};

/**
 * Tone for a verdict that may not be one we recognise.
 *
 * An unrecognised verdict resolves to the RESTRICTIVE tone, never to a neutral
 * one and never to absence. The doctrine is that an unknown must tighten the
 * answer; on a rendered surface that means it must be visible and it must not
 * look benign.
 */
export function outcomeTone(outcome: string): string {
  return OUTCOME_TONE[outcome as Outcome] ?? "text-status-restrict";
}

/**
 * Fail-mode tone, and the direction is the whole point.
 *
 * `fail-open` is the hazardous configuration and carries the warning tone.
 * `fail-closed` is the correct one and carries the allow tone. Anything
 * unrecognised is treated as hazardous, because a fail mode we cannot read is not
 * one we can vouch for.
 */
export function failModeTone(failMode: string): string {
  return failMode === "fail-closed"
    ? "border-status-allow/20 bg-status-allow/5 text-status-allow"
    : "border-status-deny/20 bg-status-deny/5 text-status-deny";
}
