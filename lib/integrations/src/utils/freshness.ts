// The shared freshness derivation. ONE body for one rule: a sighting timestamped in
// the FUTURE, beyond an allowed skew, is not evidence of freshness.
//
// Three connectors carried their own copy (carrier, location-services,
// network-nac). Two guarded against a timestamp in the FUTURE; network-nac did
// not, so a future `lastAuthAt` read as the freshest possible auth and, with a
// compliant flag, granted the trusted-segment verdict (ECC-confirmed, 2026-09-01).
// A copy that drifts is how a fail-closed rule quietly becomes fail-open in one
// family. There is now one body, and it is the guarded one.
//
// SURVEYED 2026-09-02, by reading every now-comparison in lib/*/src rather than by
// memory. NINETEEN further hand-rolled copies existed: ELEVEN inside
// lib/integrations/src (pacs-access, access-governance, change-window,
// observability-integrity, credential-rotation x3, local-authority x2,
// benchmark-selection, device-management-health) and EIGHT outside it
// (integration-bridge, signalgrid-core/util, ddm-connector, fleet-connector,
// facility-trust-graph x3, verdict-attestation).
// TOLERANCES: THREE. This header said "exactly TWO ... not the three an earlier audit
// reported" for one day, and the earlier audit was right. The two-count came from the
// divergence gate's own blind spot: its `now` pattern excluded a literal `Date.now()`,
// so `lib/location/src/validate.ts` — `Date.now() - input.observedAt` rejected at
// `< -30_000` — was never matched and never counted. The measured set is 60s here,
// 60s in verdict-attestation (`DEFAULT_MAX_SKEW_MS`), 30s in lib/location's input
// validation, and zero everywhere else (a caller-posed reference instant has no second
// clock to skew against). The 30s site stays local and marked: @workspace/location
// declares no dependency on @workspace/integrations, and it REJECTS rather than
// resolving to `unknown`.
// Measured, not remembered. This grep, run against this tree on 2026-09-02, printed
// SIX lines across exactly THREE files — the three tolerance sites plus three further
// uses of the same two constants, and no fourth file:
//
//     $ grep -rnE 'SKEW_MS|SKEW_TOLERANCE_MS|< *-[0-9_]+' lib/*/src --include=*.ts | grep -vE '//'
//     lib/integrations/src/utils/freshness.ts:...:export const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;
//     lib/integrations/src/utils/freshness.ts:...: * `skewToleranceMs` defaults to `FUTURE_SKEW_TOLERANCE_MS`. Pass `0` only with a
//     lib/integrations/src/utils/freshness.ts:...:  skewToleranceMs: number = FUTURE_SKEW_TOLERANCE_MS,
//     lib/location/src/validate.ts:10:  if (ageMs < -30_000) return { ok: false, error: "observedAt is in the future" };
//     lib/verdict-attestation/src/attest.ts:18:const DEFAULT_MAX_SKEW_MS = 60_000;
//     lib/verdict-attestation/src/attest.ts:186:  const maxSkew = options.maxSkewMs ?? DEFAULT_MAX_SKEW_MS;
//
// (freshness.ts's own line numbers are elided: they move whenever this header is
// edited, and a number that rots is worse than no number. Re-run the grep.)
//
// Every one of the nineteen already resolved a future
// sighting to its raising member; the survey found NO verdict-level fail-open left
// in the tree. It did find one DATA fail-open: local-authority's `no_grant_policy`
// branch emitted a NEGATIVE `grantAgeSeconds` (-30s for a grant 30s in the future),
// the reading credential-rotation explicitly refuses to publish. Fixed with the fold.
//
// Clocks in a distributed fleet legitimately skew by seconds; beyond this a
// "future" sighting is a contradiction, not a skew, and a contradiction resolves
// to unknown — never to the most trusting reading.
//
// TOLERANCE. `FUTURE_SKEW_TOLERANCE_MS` is the default and the only value any
// caller should need. A family that passes something else passes it EXPLICITLY and
// states why beside the call; there is exactly one such reason in the tree today
// (see `ageMs`), and `scripts/check-freshness-divergence.mjs` reports every
// exemption so none of them is silent.
export const FUTURE_SKEW_TOLERANCE_MS = 60 * 1000;

export type Freshness = "fresh" | "stale" | "unknown";

/**
 * Age of a sighting in milliseconds, or `null` when no age can be established.
 *
 * `null` — never a number, never zero, never a negative — for ALL FOUR ways an age
 * is unestablishable, because a caller that must handle one must handle all of them:
 *   · no sighting at all (`null` / `undefined` / empty);
 *   · a timestamp that does not parse (`Date.parse` → NaN);
 *   · a reference instant that is not a finite number;
 *   · a sighting AFTER the reference by more than `skewToleranceMs` — the
 *     contradiction this whole file exists for.
 *
 * A sighting inside the tolerance yields `0`, never a negative number. Negative ages
 * are the second half of this defect: they compare as smaller than every bound (so
 * they read as maximally fresh) and they render as readings nobody observed
 * ("-3653 days"). The caller gets zero or nothing.
 *
 * `skewToleranceMs` defaults to `FUTURE_SKEW_TOLERANCE_MS`. Pass `0` only with a
 * reason written beside the call. The reason that exists today: a family whose
 * reference instant is POSED BY THE CALLER rather than read from a clock has no
 * second clock to skew against, and widening it to 60s would turn a future-dated
 * read from `unknown` (which RAISES in those families) into `fresh` — folding a
 * copy must never lower a verdict.
 */
export function ageMs(
  seenAt: string | number | null | undefined,
  nowMs: number | null | undefined,
  skewToleranceMs: number = FUTURE_SKEW_TOLERANCE_MS,
): number | null {
  if (typeof nowMs !== "number" || !Number.isFinite(nowMs)) return null;
  if (seenAt === null || seenAt === undefined || seenAt === "") return null;
  const t = typeof seenAt === "number" ? seenAt : Date.parse(seenAt);
  if (!Number.isFinite(t)) return null;
  const tolerance = Number.isFinite(skewToleranceMs) && skewToleranceMs > 0 ? skewToleranceMs : 0;
  if (t - nowMs > tolerance) return null;
  const age = nowMs - t;
  return age < 0 ? 0 : age;
}

export function deriveFreshness(seenAt: string | null, nowMs: number, staleAfterMs: number | null): Freshness {
  if (!seenAt) return "unknown";
  const t = Date.parse(seenAt);
  if (Number.isNaN(t)) return "unknown";
  // A garbled REFERENCE resolves to STALE, not unknown — same reasoning as a garbled
  // bound below, and it is why this cannot simply be `ageMs(...) === null`.
  if (!Number.isFinite(nowMs)) return "stale";
  if (ageMs(seenAt, nowMs) === null) return "unknown";
  // A garbled bound (null from posedBound, NaN, Infinity, <= 0) resolves to STALE — the raising
  // member in every family that consumes this (stale → locate/step_up; unknown → monitor).
  // Infinity used to read "fresh" at any age; 0/NaN already read stale, and must keep doing so.
  if (staleAfterMs === null || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0) return "stale";
  return (ageMs(seenAt, nowMs) as number) <= staleAfterMs ? "fresh" : "stale";
}
