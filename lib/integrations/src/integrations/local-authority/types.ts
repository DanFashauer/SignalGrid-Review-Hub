// Types for the read-only LOCAL-AUTHORITY dimension.
//
// THE QUESTION, and it is deliberately one: **may this device act on its own
// authority right now — and did it ever actually establish that authority since
// it last booted?**
//
// Origin: intake ledger row 63, the mobile operational-continuity analysis
// (power loss, network denial, device compromise).
//
// ── WHY THIS IS NOT signalgrid-core/continuity.ts ────────────────────────────
//
// `continuity.ts` is the sibling that already exists, and it solves the OTHER
// half. It reconciles two decisions that were minted on both sides of a
// partition, ordering them by provenance and refusing to let an offline node
// relax what a better-connected evaluation restricted
// (`OFFLINE_AUTHORITY_CANNOT_RELAX`). It runs AFTER the offline decision exists.
//
// Nothing ran BEFORE it. A device could mint an offline decision without anyone
// having asked whether it was in a fit state to mint one — whether its local
// vault was even readable, whether a human had authenticated since the last
// restart, whether its offline grant had lapsed. This family is that gate.
//
// ── THE BEFORE-FIRST-UNLOCK TRAP, WHICH IS THE REASON THIS EXISTS ────────────
//
// On iOS and iPadOS, data protected "after first unlock" is unreadable until the
// passcode is entered following a restart — and Wi-Fi credentials and
// configuration-profile certificates commonly sit in that class. Biometric
// unlock does not substitute: the keys for Face ID / Touch ID device unlock are
// discarded across a restart, so the passcode must be entered first.
//
// The operational shape is nasty because every surface looks healthy. The device
// is powered. The radio is enabled. The battery is fine. It simply cannot read
// the credential it needs to authenticate to the network, so it never associates
// — and because it never associates, the management plane cannot reach it to fix
// anything. A dimension that only watched power and radios would call that
// device well.
//
// It is also, precisely, an UNEARNED AFFIRMATIVE: "the device holds a valid
// offline grant" is a claim about a file the device cannot currently open.
//
// ── THE CLOCK IS THE OTHER TRAP ──────────────────────────────────────────────
//
// An offline grant expires. Expiry is arithmetic against a reference instant,
// and on a shared, badge-checked-out device the system clock is settable by
// whoever is holding it. `continuity.ts` already names the harm in its own
// header: a settable clock makes CHANGING THE DATE a grant primitive.
//
// So `GrantStanding` is NEVER derived from a clock the device asserted about
// itself. Untrusted time does not produce a lenient answer or a strict one — it
// produces `unknown`, which raises. That is the only arrangement in which
// rolling the clock back cannot buy authority.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
//
// It does not unlock anything, issue a grant, mint a credential, wipe, lock, or
// send a management command — it reads a state report and grades it. It does not
// decide custody (`custody-beacon`), reachability (`carrier`, `link-usability`),
// management-plane health (`device-management-health`), or whether the app in
// front of the worker is usable (`session-readiness`). It answers only whether
// the device's LOCAL authority is real and current.
//
// CEILING: `restrict`. Never `deny`. A device that cannot act on its own
// authority should be narrowed to recovery — unlock instructions, emergency
// contact, the wired recovery lane — not cut off, because the worker in front of
// it may be the person who can fix it. Ending the session is another dimension's
// call, and the per-action floor (some irreversible actions must never run
// disconnected at all) belongs to policy, not here.

/**
 * Whether the protected local store this workflow depends on can actually be
 * read right now. TRUSTED allowlist.
 *
 * `awaiting_first_unlock` is the headline state: the device restarted and nobody
 * has entered the passcode, so after-first-unlock class material — the local
 * vault, the network credential, the signed grant bundle — is present on disk
 * and unreadable. It is deliberately NOT merged with `unavailable`: this one is
 * recoverable by a human walking over and unlocking the device, and telling
 * those apart is the difference between "send someone" and "it is broken".
 */
export type ProtectedDataState =
  | "available" // the protected class is unlocked and readable
  | "awaiting_first_unlock" // restarted, passcode not yet entered
  | "unavailable" // present but unreadable for another reason, or absent
  | "unknown";

/**
 * Whether a human has authenticated ON THIS DEVICE since the current boot.
 *
 * Distinct from `ProtectedDataState` because they can disagree in both
 * directions, and the disagreement is informative: a device can have readable
 * data with nobody authenticated (kiosk left unlocked), and a person can be
 * standing at a device whose vault still will not open.
 */
export type LocalAuthState = "verified" | "not_verified" | "unknown";

/**
 * Where the device's offline grant stands against its own declared maximum
 * disconnected interval. DERIVED, never believed, and never derived from a clock
 * the device asserted about itself.
 *
 * `never_issued` (no grant was ever minted for this device) is deliberately
 * distinct from `no_grant_policy` (nobody ever defined an offline authority for
 * it) and from `unknown` (the instants or the clock could not be trusted).
 * Collapsing any pair would let a governance failure hide inside "we're not
 * sure" — the same asymmetry `credential-rotation` keeps.
 */
export type GrantStanding =
  | "within_grant"
  | "expired" // past the maximum disconnected interval the grant itself declares
  | "never_issued" // no offline grant has ever been minted for this device
  | "no_grant_policy" // no offline authority is defined for it at all
  | "unknown";

/**
 * How much the reference instant used for expiry arithmetic can be trusted.
 *
 * `device_asserted` is NOT a lesser grade of trusted — it is the attack. A
 * device-asserted clock is settable by whoever holds the device, so arithmetic
 * against it cannot establish that a grant is still live. Only `trusted` (a time
 * the device did not get to choose — supplied by the caller, or corroborated by
 * an authenticated external source) permits the derivation.
 */
export type ClockConfidence = "trusted" | "device_asserted" | "unknown";

export type LocalAuthorityPosture =
  | "local_authority_current" // clean: readable, authenticated, in-grant, on trusted time
  | "awaiting_unlock" // restarted and never unlocked — recoverable by a human
  | "authority_lapsed" // the offline grant has run past its own interval
  | "authority_never_established" // no grant was ever minted for this device
  | "authority_ungoverned" // no offline authority is defined at all
  | "authority_unverified"; // any axis unknown / malformed / uncovered

export type LocalAuthorityAction = "none" | "monitor" | "alert" | "step_up" | "restrict";

export type LocalAuthorityReasonCode =
  | "LOCAL_AUTHORITY_CURRENT"
  | "LOCAL_AUTHORITY_NOT_COVERED"
  | "AWAITING_FIRST_UNLOCK"
  | "PROTECTED_DATA_UNAVAILABLE"
  | "PROTECTED_DATA_STATE_UNKNOWN"
  | "LOCAL_USER_NOT_AUTHENTICATED"
  | "LOCAL_AUTH_STATE_UNKNOWN"
  | "OFFLINE_GRANT_EXPIRED"
  | "OFFLINE_GRANT_NEVER_ISSUED"
  | "NO_OFFLINE_GRANT_POLICY"
  | "GRANT_STANDING_UNKNOWN"
  | "LOCAL_CLOCK_UNTRUSTED";

/** One device's normalized local-authority state. Every field is already graded;
 *  the evaluator does arithmetic on none of them. */
export interface NormalizedLocalAuthority {
  readonly deviceRef: string;
  readonly protectedData: ProtectedDataState;
  readonly localAuth: LocalAuthState;
  readonly standing: GrantStanding;
  readonly clockConfidence: ClockConfidence;
  /** TRUE only when the source actually returned a record for this device. */
  readonly covered: boolean;
  /** Age of the offline grant in whole seconds at the caller's reference
   *  instant, when derivable on TRUSTED time. Reported for the operator, never
   *  re-derived into a verdict here. */
  readonly grantAgeSeconds: number | null;
  /** The maximum disconnected interval the GRANT declares, when one exists. */
  readonly maxDisconnectedSeconds: number | null;
  readonly source: string;
  readonly observedAt: string;
}

export interface LocalAuthorityVerdict {
  readonly posture: LocalAuthorityPosture;
  readonly action: LocalAuthorityAction;
  readonly reasonCodes: readonly LocalAuthorityReasonCode[];
  /**
   * TRUE only when this device may act on its own authority — protected data
   * readable, a human authenticated since boot, an unexpired grant, and time the
   * device did not get to choose. Never true on an unknown.
   *
   * This is the field a caller should read before honouring anything the device
   * decided for itself while disconnected.
   */
  readonly mayActLocally: boolean;
  readonly summary: string;
}

/** The raw shape a device state report returns. Everything optional and unknown
 *  — the normalizer is where trust is applied, once. */
export interface LocalAuthorityReportRaw {
  readonly deviceRef?: unknown;
  readonly protectedDataState?: unknown;
  readonly localAuthState?: unknown;
  readonly clockConfidence?: unknown;
  readonly grantIssuedAt?: unknown;
  readonly maxDisconnectedSeconds?: unknown;
  readonly grantPolicyDefined?: unknown;
  readonly source?: unknown;
  readonly observedAt?: unknown;
}

export type LocalAuthorityConnectorErrorCode =
  | "auth_failed"
  | "upstream_error"
  | "bad_response"
  | "not_configured";

export class LocalAuthorityConnectorError extends Error {
  constructor(
    readonly code: LocalAuthorityConnectorErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LocalAuthorityConnectorError";
  }
}
