// Types for the read-only PASSKEY-ASSURANCE (credential worth) dimension.
//
// Origin: the community observation that "a passkey is a passkey" is a
// misconception — all modern passkeys are phishing-resistant, but they are not all
// designed for the same assurance, recovery model, or use case. That framing is
// right, and Microsoft's own Entra documentation sharpens where the line actually
// falls:
//
//   • **The boundary is ATTESTATION, not synced-vs-device-bound.** Entra:
//     *"Unattested passkeys, including synced passkeys AND unattested device-bound
//     passkeys, don't provide device provenance."* So an unattested device-bound
//     passkey sits with synced passkeys, NOT with security keys. "Device-bound =
//     high assurance" is true only when attestation is enforced — which is a
//     passkey-profile setting an admin has to turn on, not a property of the
//     credential type. Grading by type alone reproduces the misconception it is
//     trying to correct, one tier over.
//   • **Synced custody is unknowable BY CONSTRUCTION.** Entra: *"administrators
//     can't see or control exactly which devices hold a copy of a synced passkey,
//     nor can they query where a synced passkey has been synchronized."* That is
//     not a weaker signal that could be measured better. It is an axis with no
//     reading available, which under this fabric's grant discipline FORECLOSES a
//     grant rather than lowering one. On a shared, badge-checked-out device — where
//     the whole question is which human is holding it — that distinction is the
//     product.
//   • **User verification decides whether a passkey is MFA at all.** A passkey
//     combines possession with a biometric or PIN. Registered with user
//     verification discouraged, it is possession only: single-factor wearing a
//     phishing-resistant label. That is an affirmative bad fact, not an unknown.
//
// Scope honesty: this dimension grades what an IdP can actually REPORT about a
// registered credential. It does not attempt to locate a synced passkey's copies —
// that is precisely the thing no administrator can query, and pretending otherwise
// would be the fail-open this dimension exists to catch. It also does not
// re-implement WebAuthn verification; `lib/webauthn` does that, and this grades the
// standing worth of the credential rather than one assertion.

/** How the credential is held. `security_key` = external FIDO2 authenticator;
 *  `device_bound_authenticator` = a passkey pinned to one device (Windows Hello, a
 *  platform authenticator app); `synced` = replicated by a cloud passkey provider. */
export type PasskeyCredentialType =
  | "security_key"
  | "device_bound_authenticator"
  | "synced"
  | "none"
  | "unknown";

/** Did registration produce verifiable device provenance? THE axis that separates
 *  the assurance tiers — synced passkeys cannot supply it, and device-bound ones
 *  only do when the tenant enforces attestation. */
export type PasskeyAttestation = "verified" | "not_provided" | "unknown";

/** Does the tenant's passkey profile CLAIM attestation is enforced? A claim, not an
 *  observation — grading claim-vs-reality is the point. */
export type PasskeyAttestationPolicy = "enforced" | "not_enforced" | "unknown";

/** Is user verification ENFORCED AT AUTHENTICATION for this credential?
 *
 *  Deliberately NOT the registration-time preference (review finding). WebAuthn's
 *  registration `userVerification` is a preference, and the authentication ceremony
 *  independently decides whether to require UV and whether to reject an assertion
 *  without the UV flag — this repo's own relying party requires it at authentication
 *  (lib/webauthn/src/webauthn/server.ts). A credential registered with UV
 *  "discouraged" that is nonetheless always authenticated with UV required is NOT
 *  possession-only, so grading the registration preference would restrict a
 *  perfectly sound credential.
 *
 *  An integrator must therefore populate this from the ENFORCED authentication
 *  policy (or from assertion evidence), not from the registration options. If only
 *  the registration preference is available, report `unknown` — which raises to
 *  step_up rather than asserting a fact that was not established. */
export type PasskeyUserVerification = "required" | "discouraged" | "unknown";

/** Is a second credential registered against this identity? The recovery half of
 *  the guidance ("everyone should have a backup and a recovery plan").
 *
 *  This is a RECOVERY signal and nothing more. It deliberately says NOTHING about
 *  the backup's own worth, and must never be read as one: an identity holding an
 *  attested security key plus a synced backup has a synced authentication path, and
 *  an attacker uses the weakest path on offer. Grading that requires the backup's
 *  own report — see `evaluateIdentityPasskeys`, which is the only function that may
 *  answer for an IDENTITY. `evaluatePasskey` answers for ONE credential. */
export type PasskeyBackup = "registered" | "none" | "unknown";

/** Is a credential registered for this identity at all? */
export type PasskeyRegistration = "registered" | "none" | "unknown";

/** Where the private key can be exercised from. DERIVED, never read from the wire:
 *  a report cannot be trusted to tell us a synced credential is single-device. */
export type PasskeyCustody = "single_device" | "unknowable_devices" | "unknown";

/** What the credential is actually worth, independent of the "passkey" label. */
export type PasskeyAssuranceGrade =
  | "attested_phishing_resistant" // provenance verified + user-verified
  | "unattested_phishing_resistant" // phishing-resistant, but no device provenance
  | "possession_only" // registered with user verification discouraged
  | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type ReportIntegrity = "clean" | "malformed";

/** Raw wire report (loosely typed — an IdP export is EXTERNAL and may emit anything
 *  in any slot; the normalizer makes values safe). */
export interface PasskeyReportRaw {
  credential_ref?: unknown; // opaque id of the credential this report describes
  registration?: unknown; // registered | none | unknown
  credential_type?: unknown; // security_key | device_bound_authenticator | synced | none | unknown
  attestation?: unknown; // verified | not_provided | unknown
  attestation_policy?: unknown; // enforced | not_enforced | unknown
  user_verification_policy?: unknown; // required | discouraged | unknown (ENFORCED at auth)
  backup?: unknown; // registered | none | unknown
  [k: string]: unknown;
}

export const PASSKEY_REPORT_KEYS = [
  "credential_ref",
  "registration",
  "credential_type",
  "attestation",
  "attestation_policy",
  "user_verification_policy",
  "backup",
] as const;

export interface NormalizedPasskey {
  sourceSystem: "passkey-assurance";
  identityRef: string;
  /** WHICH credential this report describes. An identity may hold several, and a
   *  verdict that cannot name its subject invites being read as an identity-wide
   *  answer when it is not. Empty when the source did not say. */
  credentialRef: string;
  registration: PasskeyRegistration;
  credentialType: PasskeyCredentialType;
  attestation: PasskeyAttestation;
  attestationPolicy: PasskeyAttestationPolicy;
  userVerification: PasskeyUserVerification;
  backup: PasskeyBackup;
  reportIntegrity: ReportIntegrity;
  source: string;
}

export type PasskeyPosture =
  | "attested_device_bound" // the grant: provenance verified, user-verified, clean
  | "unattested_credential" // phishing-resistant but no device provenance
  | "synced_custody_unknowable" // synced: where the key lives cannot be queried, by construction
  | "possession_only" // user verification discouraged — not MFA
  | "attestation_claim_unenforceable" // profile claims attestation while holding a synced credential
  | "recovery_exposed" // no backup credential registered
  | "not_registered"
  | "unverified";

export type PasskeyAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type PasskeyReasonCode =
  | "ATTESTED_DEVICE_BOUND"
  | "ATTESTATION_NOT_PROVIDED"
  | "ATTESTATION_UNKNOWN"
  | "SYNCED_CUSTODY_UNKNOWABLE"
  | "USER_VERIFICATION_DISCOURAGED"
  | "USER_VERIFICATION_UNKNOWN"
  | "ATTESTATION_CLAIM_UNENFORCEABLE"
  | "ATTESTATION_POLICY_UNKNOWN"
  | "BACKUP_MISSING"
  | "BACKUP_UNKNOWN"
  | "NOT_REGISTERED"
  | "REGISTRATION_UNKNOWN"
  | "CREDENTIAL_TYPE_UNKNOWN"
  | "REPORT_MALFORMED"
  | "GRANT_BACKSTOP"
  | "NOT_COVERED";

export interface PasskeyVerdict {
  identityRef: string;
  /** The credential this verdict is about. A PER-CREDENTIAL verdict: `none` here
   *  means THIS credential is sound, NOT that the identity is. Use
   *  `evaluateIdentityPasskeys` for the identity-level question. */
  credentialRef: string;
  posture: PasskeyPosture;
  reasonCode: PasskeyReasonCode;
  recommendedAction: PasskeyAction;
  /** What the credential is actually worth — "passkey" on its own says very little. */
  assurance: PasskeyAssuranceGrade;
  /** Where the key can be exercised from. DERIVED from the credential type, never
   *  read from the report: `unknowable_devices` for a synced credential is the
   *  honest answer, and the report is not entitled to overrule it. */
  custody: PasskeyCustody;
  /** True when no second credential is registered — the holder is one lost device
   *  from a lockout. Operational, like platform-sso's lockoutRisk. */
  recoveryRisk: boolean;
  /** Affirmative concerns (no provenance, possession-only, unenforceable claim). */
  criticalFindings: string[];
  /** Inputs whose state could not be determined. Any of these forecloses the grant. */
  unknownSignals: string[];
  /** True ONLY when the grant holds: clean + registered + device-bound or security
   *  key + attestation verified + user verification required. */
  passkeyConfirmed: boolean;
}

export class PasskeyConnectorError extends Error {
  constructor(
    public readonly code: "read_only_violation" | "auth_failed" | "upstream_error" | "bad_response",
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "PasskeyConnectorError";
  }
}

/** The identity-level answer. An identity is only as strong as its WEAKEST usable
 *  authentication path, so this is worst-wins across every registered credential. */
export interface PasskeyIdentityVerdict {
  identityRef: string;
  /** Worst action across all credentials. `none` only when EVERY credential grants. */
  recommendedAction: PasskeyAction;
  /** The credential that produced the worst verdict — what to go fix. */
  weakestCredentialRef: string;
  reasonCode: PasskeyReasonCode;
  /** Per-credential verdicts, in the order supplied. */
  credentials: PasskeyVerdict[];
  /** True ONLY when at least one credential was supplied and every one of them
   *  grants. An empty set is NOT a grant — it is an absence of evidence. */
  identityConfirmed: boolean;
}
