/**
 * Reading a caller-supplied numeric bound, so a garbled one cannot be answered
 * optimistically.
 *
 * WHY THIS EXISTS. An evaluator that compares a measurement against a bound the
 * caller posed — `fixAgeSeconds >= staleFixSeconds`, `elapsed > thresholdSeconds`
 * — inherits JavaScript's comparison semantics for non-finite numbers, and those
 * semantics point the wrong way: `x >= NaN` and `x > NaN` are BOTH false, and any
 * finite `x < Infinity`. So an unreadable bound does not raise an error and does
 * not fall back to a default. It silently switches the whole check OFF, and the
 * evaluator proceeds to its clean verdict having skipped the test that would have
 * objected.
 *
 * That was measured, not theorised. Three families in this package carried the
 * unguarded shape:
 *
 *  - `rtls-custody`: a badge-less device with a fix age and dwell of ~28 hours
 *    graded `abandoned / alert` on the defaults, and `in_zone / none / CUSTODY_OK`
 *    with a NaN or Infinity threshold. A device nobody can see became a device in
 *    good custody.
 *  - `session-readiness`: a garbled budget graded STRICTLY BETTER than no budget —
 *    `ready / none` against the `degraded / monitor` an honestly-absent budget
 *    produces. A malformed question outscored an unasked one.
 *  - `edr-threat`: signatures more than a decade stale reported as `protected`.
 *
 * A fourth, `pacs-access`, guarded it correctly and its comment states the rule
 * this helper generalises: *a garbled pose is a question we cannot read — never
 * answered optimistically.* Two more families (`network-nac`, `passkey-assurance`)
 * are safe only by arithmetic accident — their comparisons happen to fall the
 * right way — so they would drift the moment a comparison changed shape.
 *
 * THE CONTRACT, and the null is the point:
 *
 *  - `undefined` — the bound was NOT posed. Returns `fallback`. Not posing a
 *    question is legitimate and must behave exactly as before.
 *  - a finite, positive number — the bound was posed and is readable. Returned.
 *  - anything else (NaN, Infinity, <= 0, a non-number that slipped past the type
 *    at a package boundary) — a GARBLED pose. Returns `null`.
 *
 * `null` is not a value to compare against. It means the axis this bound governs
 * cannot be evaluated, and the caller must resolve that axis to its unknown or
 * raising member — the same branch it uses when the MEASUREMENT is unconfirmable.
 * Substituting the default here would be the quiet failure this helper exists to
 * remove: it would accept an unreadable question and answer a different one.
 */
export function posedBound(
  value: number | undefined,
  fallback: number,
): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return value;
}
