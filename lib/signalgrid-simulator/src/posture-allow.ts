// Posture-allow resolution — the second guard that lives AROUND the engine.
//
// WHY THIS FILE EXISTS, and why it is not a two-line edit to the engine.
//
// `decisionEngine.ts`'s base-trust allow fires when an authenticated identity meets
// a posture-bearing signal (`device.posture_observed` or `apple.ddm_declared_state`)
// and no `device.non_compliant` is present. The posture ATTRIBUTES on that signal are
// read only for their known-bad members: `compliance === "non_compliant"`,
// `managementState === "unmanaged"`, `freshness === "stale"`, `declaredState ===
// "stale"`. Any other value — `"unknown"`, `"expired"`, `"pending"`, a number, an
// absent key — matches none of those literals, so the signal counts as posture and
// the decision carries `allow`. Measured on the real engine before this file was
// written (eighth verdict-core round, 2026-09-05): the clinical medication-round
// scenario with `compliance: "unknown"` allows exactly as `compliance: "compliant"`
// does. The unknown loosened the answer, which is the one direction golden rule 2
// forbids.
//
// The engine is not fixed in place for the same reason `remediation-allow.ts` was not
// folded into it: `native/ios/EnterpriseShell/Services/DecisionEngine.swift` is a
// byte-faithful port (CLAUDE.md golden rule 1, held by
// `scripts/check-decision-port-parity.mjs`). So the fix goes AROUND the engine, on
// both sides — this module, and its Swift twin when the Mac lane ports it against
// `native/shared/posture-allow-vectors.json`.
//
// ── THE RULE, stated once ────────────────────────────────────────────────────
//
//   An `allow` the engine offered stands only if EVERY posture-bearing signal in
//   the decision's input AFFIRMS every posture attribute the engine consults: a
//   `device.posture_observed` must read `compliance: "compliant"` and `freshness:
//   "fresh"`, an `apple.ddm_declared_state` must read `declaredState: "current"`
//   and `compliance: "compliant"`, and `managementState`, when either carries it,
//   must read `"managed"`. Any other member is UNAFFIRMED; an attribute that is
//   absent where required, or is not a string, is ILLEGIBLE. Either withholds the
//   allow, which drops to the NEXT-STRICTER outcome with a named reason code. An
//   unaffirmed or illegible posture raises the outcome and never lowers it, and
//   this wrapper never moves the engine's own outcome in the permissive direction.
//
// GATED here: the posture state a signal set resolves to, whether `allow` survives,
// and the reason code. NOT decided here: how far a deficient posture should escalate
// beyond withholding the grant — one step, then stop, exactly as the remediation
// wrapper does and for the same reason (inventing policy outside the ported body is
// divergence in the other direction).
//
// Deterministic and clock-free: nothing here reads a clock, and nothing may — the
// Swift twin has to reproduce every vector exactly.

import { nextStricter, projectEngineOutcome, type HostOutcome } from "./remediation-allow";
import type { SignalGridDecision, SignalGridSignal } from "./types";

/**
 * The posture states this wrapper distinguishes. Runtime array with the type
 * DERIVED from it, so the proof can sweep every member.
 */
export const POSTURE_STATES = [
  /** Every posture-bearing signal affirmed every attribute the engine consults. */
  "affirmed",
  /** A consulted attribute carries a member that is not the affirmative one. */
  "unaffirmed",
  /** A consulted attribute is absent where required, or is not a string. */
  "illegible",
  /** No posture-bearing signal at all. */
  "absent",
] as const;
export type PostureState = (typeof POSTURE_STATES)[number];

/** The reason codes this wrapper can emit, declared once. Catalogued by `scripts/gen-reason-codes.mjs`. */
export const POSTURE_ALLOW_REASONS = [
  "POSTURE_AFFIRMED",
  "POSTURE_UNAFFIRMED",
  "POSTURE_ILLEGIBLE",
  "POSTURE_ABSENT",
  "ALLOW_WITHHELD_POSTURE_UNAFFIRMED",
  "ALLOW_WITHHELD_POSTURE_ILLEGIBLE",
] as const;
export type PostureAllowReason = (typeof POSTURE_ALLOW_REASONS)[number];

/**
 * The attributes the engine consults on each posture-bearing signal type, and the
 * ONE member of each that affirms. `required` attributes must be present; `optional`
 * ones are judged only when present (the engine reads `managementState` only for its
 * bad member, and the shipping scenarios do not carry it on posture signals).
 */
export const POSTURE_BEARING: Readonly<
  Record<
    "device.posture_observed" | "apple.ddm_declared_state",
    { required: Readonly<Record<string, string>>; optional: Readonly<Record<string, string>> }
  >
> = {
  "device.posture_observed": {
    required: { compliance: "compliant", freshness: "fresh" },
    optional: { managementState: "managed" },
  },
  "apple.ddm_declared_state": {
    required: { declaredState: "current", compliance: "compliant" },
    optional: { managementState: "managed" },
  },
};

export type PostureSignal = Pick<SignalGridSignal, "type" | "attributes">;

export interface PostureAllowInput {
  /** The engine's own decision. Read, never mutated, never re-derived. */
  decision: Pick<SignalGridDecision, "outcomes">;
  /** The signals the engine decided over. Only posture-bearing types are read. */
  signals: readonly PostureSignal[];
}

/** One attribute that failed to affirm, named so the host can say why. */
export interface PostureDeficiency {
  signalType: string;
  attribute: string;
  /** "unaffirmed" — a member other than the affirmative one; "illegible" — absent or not a string. */
  kind: "unaffirmed" | "illegible";
}

export interface PostureAllowOutcome {
  /** What the engine offered, projected onto the host's four outcomes. */
  engineOutcome: HostOutcome;
  /** What the host sees. Never less strict than `engineOutcome`. */
  hostOutcome: HostOutcome;
  postureState: PostureState;
  /**
   * The verdict ON THE POSTURE AXIS. When `allowWithheld` is true it is also the
   * cause of the change; otherwise it only says what the posture evidence read.
   */
  reasonCode: PostureAllowReason;
  /** Every cause found, in the order they were evaluated. */
  reasonCodes: PostureAllowReason[];
  /** True when the engine offered `allow` and this wrapper took it away. */
  allowWithheld: boolean;
  /** Every attribute that failed to affirm, in signal order then attribute order. */
  deficiencies: PostureDeficiency[];
}

const REASON_FOR_STATE: Record<PostureState, PostureAllowReason> = {
  affirmed: "POSTURE_AFFIRMED",
  unaffirmed: "POSTURE_UNAFFIRMED",
  illegible: "POSTURE_ILLEGIBLE",
  absent: "POSTURE_ABSENT",
};

function isPostureBearing(type: string): type is keyof typeof POSTURE_BEARING {
  return Object.prototype.hasOwnProperty.call(POSTURE_BEARING, type);
}

/**
 * Classify the posture evidence in a signal set. Illegible outranks unaffirmed
 * outranks affirmed: the least-readable deficiency names the state, and every
 * deficiency is listed so the classification never hides a second cause.
 */
export function classifyPosture(signals: readonly PostureSignal[]): {
  state: PostureState;
  deficiencies: PostureDeficiency[];
} {
  const deficiencies: PostureDeficiency[] = [];
  let seen = false;
  for (const signal of signals) {
    if (!isPostureBearing(signal.type)) continue;
    seen = true;
    const spec = POSTURE_BEARING[signal.type];
    const attributes: Record<string, unknown> =
      signal.attributes !== null && typeof signal.attributes === "object" ? signal.attributes : {};
    for (const [attribute, affirmative] of Object.entries(spec.required)) {
      judge(signal.type, attribute, affirmative, attributes, true, deficiencies);
    }
    for (const [attribute, affirmative] of Object.entries(spec.optional)) {
      judge(signal.type, attribute, affirmative, attributes, false, deficiencies);
    }
  }
  if (!seen) return { state: "absent", deficiencies };
  if (deficiencies.some((d) => d.kind === "illegible")) return { state: "illegible", deficiencies };
  if (deficiencies.length > 0) return { state: "unaffirmed", deficiencies };
  return { state: "affirmed", deficiencies };
}

function judge(
  signalType: string,
  attribute: string,
  affirmative: string,
  attributes: Record<string, unknown>,
  required: boolean,
  out: PostureDeficiency[],
): void {
  const present = Object.prototype.hasOwnProperty.call(attributes, attribute);
  if (!present) {
    if (required) out.push({ signalType, attribute, kind: "illegible" });
    return;
  }
  const value = attributes[attribute];
  if (typeof value !== "string") {
    out.push({ signalType, attribute, kind: "illegible" });
    return;
  }
  if (value !== affirmative) {
    out.push({ signalType, attribute, kind: "unaffirmed" });
  }
}

/**
 * Resolve whether an `allow` the engine offered survives the posture evidence.
 * Pure over its input; the engine's outcome is projected, never re-derived, and is
 * never moved in the permissive direction.
 */
export function resolvePostureAllow(input: PostureAllowInput): PostureAllowOutcome {
  const engineOutcome = projectEngineOutcome(input.decision.outcomes);
  const { state, deficiencies } = classifyPosture(input.signals);
  const reasonCodes: PostureAllowReason[] = [REASON_FOR_STATE[state]];

  let hostOutcome: HostOutcome = engineOutcome;
  let allowWithheld = false;
  if (engineOutcome === "allow" && state !== "affirmed") {
    // `absent` cannot reach here through the real engine (base trust needs a
    // posture-bearing signal), but a caller can hand this wrapper any outcome set,
    // and an allow with NO posture evidence is withheld like an illegible one — an
    // absent reading is the least legible reading there is.
    hostOutcome = nextStricter(engineOutcome);
    allowWithheld = true;
    reasonCodes.push(
      state === "unaffirmed" ? "ALLOW_WITHHELD_POSTURE_UNAFFIRMED" : "ALLOW_WITHHELD_POSTURE_ILLEGIBLE",
    );
  }

  return {
    engineOutcome,
    hostOutcome,
    postureState: state,
    reasonCode: reasonCodes[reasonCodes.length - 1] as PostureAllowReason,
    reasonCodes,
    allowWithheld,
    deficiencies,
  };
}
