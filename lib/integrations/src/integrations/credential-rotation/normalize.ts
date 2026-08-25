import {
  type CredentialCustody,
  type CredentialKind,
  type CredentialRotationReportRaw,
  type NormalizedCredentialRotation,
  type RotationStanding,
} from "./types";

/** TRUSTED allowlists. Anything not listed is `unknown` — never coerced, and in
 *  particular never coerced to `short_lived`, which is the one value that would
 *  end the evaluation with a clean verdict. */
const KINDS: readonly CredentialKind[] = ["short_lived", "static_secret", "certificate"];
const CUSTODY: readonly CredentialCustody[] = ["managed_vault", "distributed_copy"];

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const asInstant = (v: unknown): number | null => {
  const s = asString(v);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

const asPositiveInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;

const DAY_MS = 86_400_000;

/**
 * Normalize a secrets-manager record into the graded shape the evaluator reads.
 *
 * THE REFERENCE INSTANT IS SUPPLIED BY THE CALLER. There is no `Date.now()` in
 * this path — a decision that reads the wall clock is not reproducible, and the
 * whole fabric's determinism rests on that. `review:invariants` enforces it.
 *
 * ASYMMETRIC BY CONSTRUCTION: a missing `lastRotatedAt` on a credential that HAS
 * a policy is `never_rotated`, not `unknown` — the source held a record and that
 * record says no rotation has happened. A missing POLICY is `no_policy`. Only an
 * unreadable instant or an unreadable reference is `unknown`. Collapsing those
 * three into one bucket would let a governance failure hide inside "we're not
 * sure", which is the failure mode this whole dimension exists to surface.
 */
export function normalizeCredentialRotation(
  raw: CredentialRotationReportRaw | null | undefined,
  referenceInstant: string,
  fallbackSubjectRef = "unknown",
): NormalizedCredentialRotation {
  const now = asInstant(referenceInstant);
  const subjectRef = asString(raw?.subjectRef) ?? fallbackSubjectRef;
  const source = asString(raw?.source) ?? "credential-rotation";
  const observedAt = asString(raw?.observedAt) ?? referenceInstant;

  if (raw === null || raw === undefined) {
    return {
      subjectRef, kind: "unknown", custody: "unknown", standing: "unknown",
      covered: false, ageDays: null, maxAgeDays: null, source, observedAt,
    };
  }

  const kindRaw = asString(raw.kind);
  const kind: CredentialKind =
    kindRaw !== null && (KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as CredentialKind) : "unknown";

  const custodyRaw = asString(raw.custody);
  const custody: CredentialCustody =
    custodyRaw !== null && (CUSTODY as readonly string[]).includes(custodyRaw)
      ? (custodyRaw as CredentialCustody)
      : "unknown";

  const maxAgeDays = asPositiveInt(raw.maxAgeDays);
  const lastRotated = asInstant(raw.lastRotatedAt);
  const created = asInstant(raw.createdAt);

  let standing: RotationStanding;
  let ageDays: number | null = null;

  if (now === null) {
    // No usable reference instant: we cannot age anything. Unknown, not fine.
    standing = "unknown";
  } else if (maxAgeDays === null) {
    standing = "no_policy";
    const basis = lastRotated ?? created;
    if (basis !== null) {
      const age = Math.floor((now - basis) / DAY_MS);
      // A future-dated basis is an unreadable clock, not a fresh credential.
      // Report no age rather than a negative one, so nothing downstream renders
      // "-3653 days" as if it were a reading.
      ageDays = age < 0 ? null : age;
    }
  } else if (lastRotated === null) {
    // A policy exists and nothing has ever been rotated against it.
    standing = created === null ? "unknown" : "never_rotated";
    if (created !== null) {
      const age = Math.floor((now - created) / DAY_MS);
      ageDays = age < 0 ? null : age;
    }
  } else {
    const age = Math.floor((now - lastRotated) / DAY_MS);
    if (age < 0) {
      // Rotated in the FUTURE relative to the reference — an unreadable clock,
      // not the most recently rotated secret possible.
      //
      // Without this the negative age was trivially <= maxAgeDays, so the record
      // graded "within_policy" and the verdict was rotation_current / none with
      // rotationConfirmed: true — a permanent clean bill for a static secret that
      // may never have been rotated at all, from clock skew, a bad timezone
      // conversion on a bridge, or anyone able to write the field.
      //
      // "unknown", NOT "overdue": a lapse nobody established must not be asserted
      // either. This is the shape local-authority/normalize.ts already uses for
      // a future-dated grant.
      standing = "unknown";
    } else {
      ageDays = age;
      standing = age > maxAgeDays ? "overdue" : "within_policy";
    }
  }

  return { subjectRef, kind, custody, standing, covered: true, ageDays, maxAgeDays, source, observedAt };
}
