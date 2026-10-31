/**
 * One place where a signal type becomes a badge tone in this tree.
 *
 * `SignalBadge` used to seed a grey and overwrite it through an if/else chain
 * over four of the six `SignalType` values, so `physical-access` and
 * `network-posture` — both offered as filters on the Signals page — rendered in
 * the same grey as a type nobody recognised (build plan row 114). A signal type
 * we cannot name is not the same thing as one we can: it must render AS
 * unknown, visibly, never in a tone a reader takes for an ordinary signal.
 *
 * The map is a TOTAL `Record` over the enum, so a seventh signal type is a
 * typecheck failure here rather than a silent fallthrough.
 */
import type { SignalType } from "@workspace/api-client-react";

export const SIGNAL_BADGE_TONE: Record<SignalType, string> = {
  identity: "text-teal-400 bg-teal-400/10 border-teal-400/20",
  "device-posture": "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
  "session-context": "text-purple-400 bg-purple-400/10 border-purple-400/20",
  "operational-signals": "text-pink-400 bg-pink-400/10 border-pink-400/20",
  "physical-access": "text-sky-400 bg-sky-400/10 border-sky-400/20",
  "network-posture": "text-indigo-400 bg-indigo-400/10 border-indigo-400/20",
};

/** Tone for a type outside the enum: dashed and amber, distinct from every known type. */
export const UNKNOWN_SIGNAL_TONE = "text-amber-300 bg-amber-400/10 border-amber-400/60 border-dashed";

export function signalBadge(type: string): { tone: string; label: string; known: boolean } {
  if (Object.hasOwn(SIGNAL_BADGE_TONE, type)) {
    return { tone: SIGNAL_BADGE_TONE[type as SignalType], label: type.replaceAll("-", " "), known: true };
  }
  const raw = type.trim();
  return { tone: UNKNOWN_SIGNAL_TONE, label: raw ? `unknown: ${raw}` : "unknown", known: false };
}
