// CAEP / Shared Signals event formatting — the pure half of the sixth
// outbound family (positioned in docs/FACILITY_TRUST_GRAPH.md from intake
// row 17, built on the owner's keep-going).
//
// OpenID CAEP (Continuous Access Evaluation Profile, on the Shared Signals
// Framework) is the standard way to tell COOPERATING applications that a
// session's context changed: presence expired, posture dropped, a credential
// changed, assurance moved. SignalGrid's verdicts are exactly such changes,
// and this module maps one change to one SET (Security Event Token) CLAIMS
// SET — the JSON payload of RFC 8417.
//
// TWO HONESTY RULES, stated up front:
//
//  1. THIS MODULE PRODUCES AN UNSIGNED CLAIMS SET, NEVER A SET. A SET is a
//     signed JWT; signing requires keys this public repository does not and
//     must not hold. The claims set is complete and correct; turning it into
//     a transmissible SET (sign, serialize, deliver) is the INJECTED
//     transport's job in a private deployment. Nothing here emits a
//     three-dot string that could be mistaken for a signed token.
//  2. THE SUBJECT IS A PSEUDONYM. The subject identifier format is `opaque`,
//     and the same raw-identifier tripwire as the gateway projector applies:
//     an email-shaped subject refuses. Cross-system session signals are the
//     easiest place to leak a workforce identity; this surface makes the
//     common leak unrepresentable.
//
// NO CLOCK, NO RANDOMNESS: `iat` and `event_timestamp` come from
// caller-supplied instants, and `jti` is caller-supplied — a decision id the
// fabric already minted deterministically upstream.

/** The CAEP event types this fabric can honestly emit, by their OpenID URIs.
 *  An allowlist — an event type this table does not know is refused, never
 *  passed through. */
export const CAEP_EVENT_TYPES = {
  session_revoked: "https://schemas.openid.net/secevent/caep/event-type/session-revoked",
  token_claims_change: "https://schemas.openid.net/secevent/caep/event-type/token-claims-change",
  credential_change: "https://schemas.openid.net/secevent/caep/event-type/credential-change",
  assurance_level_change: "https://schemas.openid.net/secevent/caep/event-type/assurance-level-change",
  device_compliance_change: "https://schemas.openid.net/secevent/caep/event-type/device-compliance-change",
} as const;

export type CaepEventKind = keyof typeof CAEP_EVENT_TYPES;

export interface CaepClaimsInput {
  /** The transmitter (this deployment's issuer URL). Caller-supplied config. */
  issuer?: unknown;
  /** The receiving application's audience string. */
  audience?: unknown;
  /** Unique token id — a decision/attestation id already minted upstream.
   *  Caller-supplied, so no randomness runs here. */
  jti?: unknown;
  /** When the token is issued — a caller-supplied strict Zulu instant. */
  issuedAt?: unknown;
  /** The subject PSEUDONYM. Opaque format only; '@' refuses (tripwire). */
  subjectPseudonym?: unknown;
  /** Which CAEP event this is (a key of CAEP_EVENT_TYPES). */
  eventKind?: unknown;
  /** When the change actually occurred — caller-supplied strict Zulu instant. */
  occurredAt?: unknown;
  /** The fabric's reason codes for the change — the auditable why. */
  reasonCodes?: unknown;
}

export type CaepFormatRefusal =
  | "ISSUER_MISSING"
  | "AUDIENCE_MISSING"
  | "JTI_MISSING"
  | "ISSUED_AT_UNREADABLE"
  | "SUBJECT_MISSING"
  | "SUBJECT_SUSPECT"
  | "EVENT_KIND_UNRECOGNIZED"
  | "OCCURRED_AT_UNREADABLE"
  | "REASON_CODES_UNREADABLE";

/** The UNSIGNED SET claims set (RFC 8417 shape with CAEP event payload). */
export interface CaepClaimsSet {
  iss: string;
  aud: string;
  jti: string;
  iat: number; // epoch seconds, from the SUPPLIED issuedAt
  sub_id: { format: "opaque"; id: string };
  events: Record<string, { event_timestamp: number; reason_admin: { en: string } }>;
}

export type CaepFormatResult =
  | { claims: CaepClaimsSet; refusal: null }
  | { claims: null; refusal: CaepFormatRefusal };

const MAX_REASON_CODES = 32;

function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function refuse(refusal: CaepFormatRefusal): CaepFormatResult {
  return { claims: null, refusal };
}

/** Build one UNSIGNED CAEP claims set, or refuse. Deterministic. */
export function buildCaepClaims(input: CaepClaimsInput): CaepFormatResult {
  const iss = textOf(input.issuer);
  if (iss === null) return refuse("ISSUER_MISSING");
  const aud = textOf(input.audience);
  if (aud === null) return refuse("AUDIENCE_MISSING");
  const jti = textOf(input.jti);
  if (jti === null) return refuse("JTI_MISSING");
  const iatMs = instantOf(input.issuedAt);
  if (iatMs === null) return refuse("ISSUED_AT_UNREADABLE");
  const sub = textOf(input.subjectPseudonym);
  if (sub === null) return refuse("SUBJECT_MISSING");
  if (sub.includes("@")) return refuse("SUBJECT_SUSPECT");
  const kind = textOf(input.eventKind);
  if (kind === null || !Object.prototype.hasOwnProperty.call(CAEP_EVENT_TYPES, kind)) {
    return refuse("EVENT_KIND_UNRECOGNIZED");
  }
  const occurredMs = instantOf(input.occurredAt);
  if (occurredMs === null) return refuse("OCCURRED_AT_UNREADABLE");
  const reasons = input.reasonCodes;
  if (!Array.isArray(reasons) || reasons.length === 0 || reasons.length > MAX_REASON_CODES ||
      reasons.some((r) => textOf(r) === null)) {
    return refuse("REASON_CODES_UNREADABLE");
  }

  const uri = CAEP_EVENT_TYPES[kind as CaepEventKind];
  return {
    claims: {
      iss,
      aud,
      jti,
      iat: Math.floor(iatMs / 1000),
      sub_id: { format: "opaque", id: sub },
      events: {
        [uri]: {
          event_timestamp: Math.floor(occurredMs / 1000),
          reason_admin: { en: (reasons as unknown[]).map((r) => (r as string).trim()).join(", ") },
        },
      },
    },
    refusal: null,
  };
}
