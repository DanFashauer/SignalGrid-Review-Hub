// One freshness derivation for every "when did we last see it" signal.
//
// Three connectors carried their own copy (carrier, location-services,
// network-nac). Two guarded against a timestamp in the FUTURE; network-nac did
// not, so a future `lastAuthAt` read as the freshest possible auth and, with a
// compliant flag, granted the trusted-segment verdict (ECC-confirmed, 2026-09-01).
// A copy that drifts is how a fail-closed rule quietly becomes fail-open in one
// family. There is now one body, and it is the guarded one.
//
// Clocks in a distributed fleet legitimately skew by seconds; beyond this a
// "future" sighting is a contradiction, not a skew, and a contradiction resolves
// to unknown — never to the most trusting reading.
export const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;

export type Freshness = "fresh" | "stale" | "unknown";

export function deriveFreshness(seenAt: string | null, nowMs: number, staleAfterMs: number): Freshness {
  if (!seenAt) return "unknown";
  const t = Date.parse(seenAt);
  if (Number.isNaN(t)) return "unknown";
  if (t - nowMs > FUTURE_SKEW_TOLERANCE_MS) return "unknown";
  return nowMs - t <= staleAfterMs ? "fresh" : "stale";
}
