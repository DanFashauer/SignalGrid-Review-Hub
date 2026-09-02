import { ageMs } from "../../utils/freshness";
import {
  type ClockConfidence,
  type GrantStanding,
  type LocalAuthState,
  type LocalAuthorityReportRaw,
  type NormalizedLocalAuthority,
  type ProtectedDataState,
} from "./types";

/** TRUSTED allowlists. Anything not listed is `unknown` — never coerced, and in
 *  particular never coerced toward the readable/authenticated end. */
const PROTECTED: readonly ProtectedDataState[] = [
  "available",
  "awaiting_first_unlock",
  "unavailable",
];
const LOCAL_AUTH: readonly LocalAuthState[] = ["verified", "not_verified"];

/** `trusted` must be stated explicitly. An unrecognised spelling becomes
 *  `unknown`, and `unknown` is treated exactly as `device_asserted` is by the
 *  evaluator — neither can establish that a grant is still live. */
const CLOCK: readonly ClockConfidence[] = ["trusted", "device_asserted"];

const asString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const asInstant = (v: unknown): number | null => {
  const s = asString(v);
  if (s === null) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

const asPositiveNumber = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/**
 * Normalize a device state report into the graded shape the evaluator reads.
 *
 * THE REFERENCE INSTANT IS SUPPLIED BY THE CALLER. There is no `Date.now()` in
 * this path — a decision that reads the wall clock is not reproducible, and the
 * whole fabric's determinism rests on that. `review:invariants` enforces it.
 *
 * THE CLOCK GATE IS THE LOAD-BEARING PART. Grant standing is derived ONLY when
 * `clockConfidence` is the trusted enumerated value. On a device-asserted or
 * unrecognised clock the standing is `unknown` — not `expired` (which would be a
 * finding nobody established) and emphatically not `within_grant`. A shared,
 * badge-checked-out device has a settable clock, so deriving expiry from it
 * would make rolling the date back a way to renew authority indefinitely. That
 * is the harm `signalgrid-core/continuity.ts` names when it rejects
 * last-write-wins, and the same reasoning applies to a grant's own lifetime.
 *
 * ASYMMETRIC BY CONSTRUCTION, in three places a lazier normalizer would collapse:
 *
 *   · No grant instant, but a policy DOES define one → `never_issued`. The
 *     source held a record and that record says no grant was ever minted.
 *   · No policy at all → `no_grant_policy`. How long this device may act alone
 *     was never bounded — a governance gap, visible rather than defaulted to fine.
 *   · Unreadable instants, or a clock we cannot trust → `unknown`.
 *
 * A grant instant dated AFTER the reference is `unknown`, not maximally fresh.
 * A future issuance is an unreadable clock by another name, and a naive age
 * comparison would read it as the newest grant possible.
 */
export function normalizeLocalAuthority(
  raw: LocalAuthorityReportRaw | null | undefined,
  referenceInstant: string,
  fallbackDeviceRef = "unknown",
): NormalizedLocalAuthority {
  const now = asInstant(referenceInstant);
  const deviceRef = asString(raw?.deviceRef) ?? fallbackDeviceRef;
  const source = asString(raw?.source) ?? "local-authority";
  const observedAt = asString(raw?.observedAt) ?? referenceInstant;

  if (raw === null || raw === undefined) {
    return {
      deviceRef,
      protectedData: "unknown",
      localAuth: "unknown",
      standing: "unknown",
      clockConfidence: "unknown",
      covered: false,
      grantAgeSeconds: null,
      maxDisconnectedSeconds: null,
      source,
      observedAt,
    };
  }

  const protectedRaw = asString(raw.protectedDataState);
  const protectedData: ProtectedDataState =
    protectedRaw !== null && (PROTECTED as readonly string[]).includes(protectedRaw)
      ? (protectedRaw as ProtectedDataState)
      : "unknown";

  const authRaw = asString(raw.localAuthState);
  const localAuth: LocalAuthState =
    authRaw !== null && (LOCAL_AUTH as readonly string[]).includes(authRaw)
      ? (authRaw as LocalAuthState)
      : "unknown";

  const clockRaw = asString(raw.clockConfidence);
  const clockConfidence: ClockConfidence =
    clockRaw !== null && (CLOCK as readonly string[]).includes(clockRaw)
      ? (clockRaw as ClockConfidence)
      : "unknown";

  const maxDisconnectedSeconds = asPositiveNumber(raw.maxDisconnectedSeconds);
  const grantPolicyDefined = raw.grantPolicyDefined === true || maxDisconnectedSeconds !== null;
  const issued = asInstant(raw.grantIssuedAt);

  let standing: GrantStanding;
  let grantAgeSeconds: number | null = null;

  if (clockConfidence !== "trusted" || now === null) {
    // No time we are entitled to do arithmetic against. Unknown, not fine — and
    // deliberately not "expired" either, which would assert a lapse nobody
    // established.
    standing = "unknown";
  } else if (!grantPolicyDefined) {
    standing = "no_grant_policy";
    // THE FIX (2026-09-02 fold): this branch used `Math.floor((now - issued) / 1000)`
    // with no future guard, so a grant dated 30s ahead of the reference published
    // `grantAgeSeconds: -30` — a reading nobody observed, and the one shape the
    // sibling normalizer (credential-rotation) explicitly refuses to emit. `ageMs`
    // returns null instead. The STANDING was never wrong here (`no_grant_policy`
    // either way); the published age was.
    if (issued !== null) {
      const ms = ageMs(issued, now, 0); // tolerance 0: caller-posed reference instant
      grantAgeSeconds = ms === null ? null : Math.floor(ms / 1000);
    }
  } else if (issued === null) {
    standing = "never_issued";
  } else {
    const issuedAgeMs = ageMs(issued, now, 0); // tolerance 0: caller-posed reference instant
    if (issuedAgeMs === null) {
      // Issued in the future relative to the reference — an unreadable clock,
      // not the freshest grant ever minted.
      standing = "unknown";
    } else {
      const age = Math.floor(issuedAgeMs / 1000);
      grantAgeSeconds = age;
      standing =
        maxDisconnectedSeconds === null
          ? "no_grant_policy"
          : age > maxDisconnectedSeconds
            ? "expired"
            : "within_grant";
    }
  }

  return {
    deviceRef,
    protectedData,
    localAuth,
    standing,
    clockConfidence,
    covered: true,
    grantAgeSeconds,
    maxDisconnectedSeconds,
    source,
    observedAt,
  };
}
