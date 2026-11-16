// The recommended-action ladder the posture families share, least to most severe.
//
// Declared as a const ARRAY with the union derived from it, because a bare union has
// no runtime value: every proof that published `ladderRungs=` had to restate the
// count by hand, thirteen proofs did, and they disagreed (agent-behavior printed 5
// against a six-member union). The families' `XAction` types now derive from this
// array, so the count a proof prints is the length of the thing the type is made of.
// See docs/COMPANY_BUILD_PLAN.md rows 124 and 150.
export const FAMILY_ACTIONS = ["none", "monitor", "step_up", "alert", "restrict", "escalate"] as const;

export type FamilyAction = (typeof FAMILY_ACTIONS)[number];
