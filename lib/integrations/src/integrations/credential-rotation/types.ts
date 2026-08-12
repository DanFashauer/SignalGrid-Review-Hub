// Types for the read-only CREDENTIAL-ROTATION dimension — is the secret this
// actor is presenting still within its own rotation policy, and does anyone
// actually know?
//
// Origin: intake ledger row 61, the "Rotate keys and secrets" practice of the
// cybersecurity domain poster. Every neighbouring dimension answers a different
// question about a credential and none answers this one:
//
//   · `credential-exposure` — has a scanner seen it LEAKED (shell history, .env,
//     CLI caches, agent configs)? A never-rotated key that has never leaked is
//     invisible to it.
//   · `token-binding` — is it replayable bearer, or proof-of-possession?
//   · `bootstrap-credential` — is it a temporary pass, used as a pass may be used?
//   · `passkey-assurance` / `platform-sso` — how strong is the SIGN-IN method?
//
// None of those can see a static service secret minted four hundred days ago,
// copied into three pipelines, and still authorising production writes. That is
// the gap this closes, and it is squarely a per-action question: the longer a
// static secret has lived, the more copies exist and the wider the window in
// which one of them escaped without anyone noticing.
//
// THE SOURCE IS A SECRETS MANAGER, NOT A SCANNER. Vault, AWS Secrets Manager,
// Azure Key Vault and their peers already hold `last_rotated_at` and a rotation
// policy. This family reads that record. It never rotates, never issues, never
// revokes and never writes — the whole point is that rotation is the owning
// system's job and SignalGrid only decides whether to trust what it is told.
//
// Axes, each fail-closed:
//
//   1. CREDENTIAL KIND (trusted allowlist). `short_lived` — a per-session token
//      minted on demand — is the clean state, because rotation is not the right
//      question for a credential that expires in minutes. `static_secret` and
//      `certificate` open the ladder. An unlisted spelling is `unknown` and is
//      NEVER coerced to short-lived: a credential we cannot classify does not
//      get the exemption that would end the evaluation.
//   2. ROTATION STANDING (derived). `lastRotatedAt` and the policy's maximum age
//      as the source reports them, aged against a CALLER-SUPPLIED reference
//      instant — no clock in the decision path. `never_rotated` is distinct from
//      `overdue` on purpose: created-and-never-touched is a different failure
//      from a missed cycle, and one a reviewer should be able to count. A secret
//      with NO rotation policy at all is `no_policy` — "rotate every N days" was
//      never practiced, visibly, rather than defaulted to fine.
//   3. CUSTODY (trusted allowlist). Where the secret actually lives.
//      `managed_vault` means the owning system holds it and can rotate it.
//      `distributed_copy` means it has been copied out to environment variables,
//      config files or pipeline settings — the state in which rotation stops
//      being a single operation and starts being a migration. Unknown custody is
//      unknown, never assumed managed.
//
// CEILING: `restrict`. This dimension never denies on its own. An overdue key is
// a hygiene fact, and a dimension that could hard-deny production traffic on a
// date arithmetic alone would be a blunt instrument wired to a clock. Narrowing
// what the session may do is the honest maximum; ending it is another
// dimension's call.

/** What is actually being presented. TRUSTED allowlist — the secrets manager
 *  knows what it is holding. */
export type CredentialKind =
  | "short_lived" // minted per session/short TTL; rotation is not the right question
  | "static_secret" // a long-lived shared secret: API key, service-account password
  | "certificate" // a client certificate or signing key with its own lifetime
  | "unknown";

/** Where the secret lives, which decides what rotating it actually costs. */
export type CredentialCustody =
  | "managed_vault" // the owning system holds it and can rotate in place
  | "distributed_copy" // copied into env vars / config / pipeline settings
  | "unknown";

/** Where the credential stands against its OWN policy, at the caller's
 *  reference instant. DERIVED, never believed. */
export type RotationStanding =
  | "within_policy"
  | "overdue" // past the maximum age the policy itself declares
  | "never_rotated" // created and never once rotated — distinct from a missed cycle
  | "no_policy" // the source holds NO rotation policy: a visible governance failure
  | "unknown"; // instants or reference unreadable / absent

export type CredentialRotationPosture =
  | "rotation_not_applicable" // clean: a short-lived credential, correctly classified
  | "rotation_current" // clean: static/cert, within policy, held in a vault
  | "rotation_overdue" // past its declared maximum age
  | "rotation_never_performed" // minted and never rotated
  | "rotation_ungoverned" // no rotation policy exists for it at all
  | "rotation_unverified"; // any axis unknown / malformed / uncovered

export type CredentialRotationAction = "none" | "monitor" | "alert" | "step_up" | "restrict";

export type CredentialRotationReasonCode =
  | "ROTATION_NOT_APPLICABLE_SHORT_LIVED"
  | "ROTATION_WITHIN_POLICY"
  | "CREDENTIAL_ROTATION_OVERDUE"
  | "CREDENTIAL_NEVER_ROTATED"
  | "CREDENTIAL_NO_ROTATION_POLICY"
  | "CREDENTIAL_COPIED_OUT_OF_VAULT"
  | "CREDENTIAL_KIND_UNKNOWN"
  | "CREDENTIAL_CUSTODY_UNKNOWN"
  | "ROTATION_STANDING_UNKNOWN"
  | "CREDENTIAL_NOT_COVERED";

/** One credential's normalized rotation context. Every field is already graded;
 *  the evaluator does arithmetic on none of them. */
export interface NormalizedCredentialRotation {
  readonly subjectRef: string;
  readonly kind: CredentialKind;
  readonly custody: CredentialCustody;
  readonly standing: RotationStanding;
  /** TRUE only when the source actually returned a record for this subject. A
   *  subject the secrets manager has never heard of is an honest hole. */
  readonly covered: boolean;
  /** Age in whole days at the caller's reference instant, when derivable.
   *  Reported for the operator, never re-derived into a verdict here. */
  readonly ageDays: number | null;
  /** The maximum age the POLICY declares, when one exists. */
  readonly maxAgeDays: number | null;
  readonly source: string;
  readonly observedAt: string;
}

export interface CredentialRotationVerdict {
  readonly posture: CredentialRotationPosture;
  readonly action: CredentialRotationAction;
  readonly reasonCodes: readonly CredentialRotationReasonCode[];
  /** TRUE only when rotation is genuinely a non-question (correctly classified
   *  short-lived) or genuinely current in a vault. Never true on an unknown. */
  readonly rotationConfirmed: boolean;
  readonly summary: string;
}

/** The raw shape a secrets manager returns. Everything optional and unknown —
 *  the normalizer is where trust is applied, once. */
export interface CredentialRotationReportRaw {
  readonly subjectRef?: unknown;
  readonly kind?: unknown;
  readonly custody?: unknown;
  readonly lastRotatedAt?: unknown;
  readonly createdAt?: unknown;
  readonly maxAgeDays?: unknown;
  readonly source?: unknown;
  readonly observedAt?: unknown;
}

export type CredentialRotationConnectorErrorCode =
  | "auth_failed"
  | "upstream_error"
  | "bad_response"
  | "not_configured";

export class CredentialRotationConnectorError extends Error {
  constructor(
    readonly code: CredentialRotationConnectorErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CredentialRotationConnectorError";
  }
}
