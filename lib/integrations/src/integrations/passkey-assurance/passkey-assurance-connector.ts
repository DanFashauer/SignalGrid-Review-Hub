// Read-only normalization + transport for the PASSKEY-ASSURANCE connector.
//
// The source is an IdP's authentication-methods export for one identity — the
// credential type it registered, whether attestation was verified, what the
// tenant's passkey profile claims, the user-verification posture, and whether a
// backup credential exists. Already-resolved observations, never the user's or the
// client's claim about themselves. Every operation is a read; there is no write
// path — registration, profile configuration, and revocation stay with the IdP.
//
// Defensive normalization is ported from the platform-sso connector: an IdP export
// is an external system and may emit anything in any slot, so the normalizer — not
// the compiler — is what makes a value safe; own-property reads only; malformed
// reports fail closed.

import {
  PASSKEY_REPORT_KEYS,
  PasskeyConnectorError,
  type NormalizedPasskey,
  type PasskeyAttestation,
  type PasskeyAttestationPolicy,
  type PasskeyBackup,
  type PasskeyCredentialType,
  type PasskeyRegistration,
  type PasskeyReportRaw,
  type PasskeyUserVerification,
  type ReportIntegrity,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new PasskeyConnectorError("read_only_violation", `passkey-assurance is read-only; refused ${method}`),
);

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Did the report ASSERT something here that we could not parse? `null` counts as absent. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, and must not read as a confirmation. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? An injected transport returning a string
 *  must fail closed, not throw an untyped TypeError out of the normalizer. */
function isPlainReport(report: unknown): report is object {
  // The Object.prototype exclusion is load-bearing: passing Object.prototype itself
  // as the report would let POLLUTED prototype fields read as own assertions on a
  // "plain" object.
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

/** Depth bound for the prototype scan — a Proxy may return a fresh object from
 *  getPrototypeOf on every call, so the walk must be bounded rather than trusted. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand? Walks the PROTOTYPE
 *  CHAIN even though value reads are own-only: an inherited assertion in a spelling we
 *  ignore is still an assertion, and this scan is the only thing that notices it. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

const REGISTRATIONS = ["registered", "none", "unknown"] as const;
const CREDENTIAL_TYPES = ["security_key", "device_bound_authenticator", "synced", "none", "unknown"] as const;
const ATTESTATIONS = ["verified", "not_provided", "unknown"] as const;
const ATTESTATION_POLICIES = ["enforced", "not_enforced", "unknown"] as const;
const USER_VERIFICATIONS = ["required", "discouraged", "unknown"] as const;
const BACKUPS = ["registered", "none", "unknown"] as const;

/** Normalize one passkey report. Defensive throughout: a missing/errored field yields
 *  the fail-safe unknown, never a fabricated credential type or attestation. */
export function normalizeReport(
  identityRef: string,
  report: PasskeyReportRaw,
  source = "passkey-idp-export",
): NormalizedPasskey {
  const plain = isPlainReport(report);
  let rawCredentialRef: unknown;
  let rawRegistration: unknown;
  let rawType: unknown;
  let rawAttestation: unknown;
  let rawPolicy: unknown;
  let rawUv: unknown;
  let rawBackup: unknown;
  let readThrew = false;
  try {
    rawCredentialRef = plain ? ownValue(report, "credential_ref") : undefined;
    rawRegistration = plain ? ownValue(report, "registration") : undefined;
    rawType = plain ? ownValue(report, "credential_type") : undefined;
    rawAttestation = plain ? ownValue(report, "attestation") : undefined;
    rawPolicy = plain ? ownValue(report, "attestation_policy") : undefined;
    rawUv = plain ? ownValue(report, "user_verification_policy") : undefined;
    rawBackup = plain ? ownValue(report, "backup") : undefined;
  } catch {
    readThrew = true;
    rawCredentialRef = rawRegistration = rawType = rawAttestation = rawPolicy = rawUv = rawBackup = undefined;
  }

  // Free-form, so it is not allowlisted — but it must be a STRING to be usable as
  // an identifier. Anything else is dropped to "" rather than coerced.
  const credentialRef = typeof rawCredentialRef === "string" ? rawCredentialRef.trim() : "";
  const registration = oneOf<PasskeyRegistration>(rawRegistration, REGISTRATIONS, "unknown");
  const credentialType = oneOf<PasskeyCredentialType>(rawType, CREDENTIAL_TYPES, "unknown");
  const attestation = oneOf<PasskeyAttestation>(rawAttestation, ATTESTATIONS, "unknown");
  const attestationPolicy = oneOf<PasskeyAttestationPolicy>(rawPolicy, ATTESTATION_POLICIES, "unknown");
  const userVerification = oneOf<PasskeyUserVerification>(rawUv, USER_VERIFICATIONS, "unknown");
  const backup = oneOf<PasskeyBackup>(rawBackup, BACKUPS, "unknown");

  // WIRE-LEVEL SELF-CONTRADICTION: a synced credential cannot carry verified device
  // provenance — that is the platform behaviour this dimension is built on, not a
  // policy choice. A report asserting both is describing something that cannot
  // exist, so it is malformed rather than merely surprising. Without this, a
  // hostile or buggy export could claim `synced` + `verified` and collect the
  // attestation half of the grant.
  const contradictoryAttestation = credentialType === "synced" && attestation === "verified";

  const malformed =
    readThrew ||
    !plain ||
    contradictoryAttestation ||
    hasUnrecognizedKey(report, PASSKEY_REPORT_KEYS) ||
    enumMalformed(rawRegistration, REGISTRATIONS) ||
    enumMalformed(rawType, CREDENTIAL_TYPES) ||
    enumMalformed(rawAttestation, ATTESTATIONS) ||
    enumMalformed(rawPolicy, ATTESTATION_POLICIES) ||
    enumMalformed(rawUv, USER_VERIFICATIONS) ||
    (rawCredentialRef !== undefined && rawCredentialRef !== null && typeof rawCredentialRef !== "string") ||
    enumMalformed(rawBackup, BACKUPS);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "passkey-assurance",
    identityRef,
    credentialRef,
    registration,
    credentialType,
    attestation,
    attestationPolicy,
    userVerification,
    backup,
    reportIntegrity,
    source,
  };
}

export interface PasskeyRequest {
  identityRef: string;
  /** WHICH credential to read. Absent = "this identity's primary/only credential",
   *  which is all a single-credential source can answer. A real IdP adapter uses
   *  this to fetch a specific registered credential. */
  credentialRef?: string;
  token: string;
}

export type PasskeyTransport = (req: PasskeyRequest) => Promise<PasskeyReportRaw>;

export interface PasskeyConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches ONE CREDENTIAL's posture and normalizes it.
 *
 *  Scope, stated because it is easy to over-read: a single call cannot establish the
 *  COMPLETE credential set for an identity, so its result must never be handed to
 *  `evaluateIdentityPasskeys` as if it were the whole set. `fetchNormalizedSet`
 *  below takes the credential refs explicitly, which makes the completeness
 *  requirement the caller's visible responsibility rather than a silent assumption —
 *  and the aggregator independently fails closed when the set contradicts itself. */
export class PasskeyAssuranceConnector {
  constructor(
    private readonly config: PasskeyConnectorConfig,
    private readonly transport: PasskeyTransport,
  ) {}

  async fetchNormalized(identityRef: string, credentialRef?: string): Promise<NormalizedPasskey> {
    guardReadOnly("GET");
    const raw = await this.transport({ identityRef, credentialRef, token: this.config.accessToken });
    const report = normalizeReport(identityRef, raw, this.config.source ?? "passkey-idp-export");

    // SUBSTITUTION GUARD, and it belongs HERE rather than around the caller.
    //
    // A source that answers a request for a weak credential with a healthy
    // DIFFERENT one would otherwise be accepted. The verdict is not a lie — it
    // carries the returned `credentialRef` — but it truthfully answers a question
    // nobody asked, and a caller who asked "grade cred-A" is told `none` and
    // `passkeyConfirmed: true` about cred-B.
    //
    // This check lived on `fetchNormalizedSet` only, which called straight through
    // to this method with the same `credentialRef` argument and then guarded the
    // result. So the set path was protected and the primitive it is built on was
    // not — a guard one layer above the thing it guards. Found by the first
    // qa-engineer shift, 2026-08-25.
    //
    // Only fires when a ref was actually REQUESTED: `fetchNormalized(id)` with no
    // ref is asking "whatever this identity has", and there is nothing to
    // contradict. An empty returned ref is a separate defect the evaluator raises
    // as `CREDENTIAL_REF_MISSING`, so it is not swallowed here.
    if (credentialRef !== undefined && report.credentialRef.length > 0 && report.credentialRef !== credentialRef) {
      return { ...report, reportIntegrity: "malformed" as const };
    }
    return report;
  }

  /** Fetch a NAMED SET of credentials for one identity. The caller supplies the refs
   *  because only the IdP's own enumeration knows them — inventing them here would
   *  manufacture exactly the completeness this dimension refuses to assume. */
  async fetchNormalizedSet(
    identityRef: string,
    credentialRefs: readonly string[],
  ): Promise<NormalizedPasskey[]> {
    guardReadOnly("GET");
    return Promise.all(
      credentialRefs.map(async (ref) => {
        // The substitution guard now lives in `fetchNormalized` itself, which this
        // calls with the same ref — so the set path inherits it. Two copies of one
        // rule is how the copies drift, and this repository spent 2026-08-25
        // repairing two instances of exactly that.
        return this.fetchNormalized(identityRef, ref);
      }),
    );
  }
}
