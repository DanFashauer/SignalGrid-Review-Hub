import type { V1Outcome } from "./v1.ts";

/**
 * The live decision panel's verdict tone. The `/v1` response is cast rather than
 * parsed at the fetch boundary (`evaluateV1` in `./v1.ts`), so an outcome outside the
 * union can arrive. `"step-up"` is not hypothetical: `lib/api-zod` spells it that way
 * while the core says `step_up`. A bare `TONE[outcome]` then reads `undefined`, and
 * the panel renders neither the verdict nor its empty state: a blank card that reads
 * as "nothing happened" (COMPANY_BUILD_PLAN row 109).
 *
 * Fail-closed: an unrecognised outcome takes the RESTRICTIVE tone, never a neutral
 * one, with the raw outcome as its label so the reader sees what arrived.
 */
export type OutcomeTone = { dot: string; text: string; ring: string; label: string };

const TONE: Record<V1Outcome, OutcomeTone> = {
  allow: { dot: "bg-[hsl(var(--decision-allow))]", text: "text-status-allow", ring: "border-[hsl(var(--decision-allow)/0.4)]", label: "ALLOW" },
  step_up: { dot: "bg-[hsl(var(--decision-review))]", text: "text-status-step-up", ring: "border-[hsl(var(--decision-review)/0.4)]", label: "STEP-UP" },
  restrict: { dot: "bg-[hsl(var(--decision-deny))]", text: "text-status-restrict", ring: "border-[hsl(var(--decision-deny)/0.4)]", label: "RESTRICT" },
  deny: { dot: "bg-[hsl(var(--decision-deny))]", text: "text-status-deny", ring: "border-[hsl(var(--decision-deny)/0.4)]", label: "DENY" },
};

export function outcomeTone(outcome: unknown): OutcomeTone {
  if (typeof outcome === "string" && Object.hasOwn(TONE, outcome)) return TONE[outcome as V1Outcome];
  const raw = typeof outcome === "string" && outcome.trim() !== "" ? outcome : "unknown";
  return { ...TONE.deny, label: `UNKNOWN: ${raw.toUpperCase()}` };
}
