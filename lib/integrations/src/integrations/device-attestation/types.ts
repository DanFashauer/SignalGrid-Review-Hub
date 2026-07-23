// Types for the read-only hardware-rooted device-attestation dimension.
//
// Every other posture dimension reads what a device SAYS about itself
// (self-reported: SIP/FileVault via a collector, MDM SecurityInfo, DDM status).
// A sufficiently compromised device can lie. Managed Device Attestation closes
// that gap: on Apple silicon (macOS 14.2+), the Secure Enclave signs a certificate
// chain — rooted at Apple's Enterprise Attestation Root CA — whose leaf OIDs carry
// PROVEN device facts (SIP status, secure-boot level, third-party-kext policy,
// plus a freshness code echoing a server nonce). This dimension turns a VERIFIED
// attestation into the top assurance tier of the trust verdict.
//
// This connector does NOT verify the DER chain itself — that is the bridge's job
// (a server-side X.509 verify to the pinned Apple root, e.g. via swift-certificates
// or a Node X.509 lib). It ingests the bridge's already-verified result and folds
// it fail-safe. A CRYPTOGRAPHICALLY-PROVEN bad state (attested SIP off / permissive
// secure boot) is the strongest possible negative — you cannot argue with the
// Secure Enclave. An attestation that was EXPECTED but could not be verified or is
// stale RAISES the bar (a stripped/replayed attestation is a tamper signal).
//
// Attestation is an assurance UPGRADE, not a universal requirement: hardware that
// is provably NOT attestation-capable (Intel Macs) abstains rather than being
// penalized — its baseline posture is gated by the other dimensions. Nothing
// unknown is ever granted the attested-healthy tier.

/** Did the DER chain verify to Apple's Enterprise Attestation Root CA?
 *  `verified` = a real, root-anchored chain; `unverifiable` = a chain was
 *  presented but did not validate; `unknown` = no chain / not assessed. */
export type AttestationChain = "verified" | "unverifiable" | "unknown";
/** Whether the attestation is fresh for the server's challenge. `fresh` = the leaf
 *  freshness code echoes the issued nonce and is within the window; `stale` = a
 *  cached/replayed attestation (Apple rate-limits new ones ~weekly); `unknown`. */
export type AttestationFreshness = "fresh" | "stale" | "unknown";
/** An attested boolean control (e.g. SIP). `unknown` when the OID was absent. */
export type AttestedControl = "on" | "off" | "unknown";
/** Attested secure-boot posture (from OID 1.2.840.113635.100.8.13.2). */
export type AttestedSecureBoot = "full" | "reduced" | "permissive" | "unknown";

/** Raw attestation-bridge report about one device (loosely typed — any field may
 *  degrade to null / an error string). */
export interface AttestationReportRaw {
  attestable?: boolean | null; // hardware supports Managed Device Attestation
  chain?: unknown; // verified | unverifiable | unknown
  freshness?: unknown; // fresh | stale | unknown
  sip?: unknown; // on | off | unknown (attested SIP status, OID .13.1)
  secureBoot?: unknown; // full | reduced | permissive | unknown (OID .13.2)
  thirdPartyKextAllowed?: boolean | null; // OID .13.3 (true = kexts allowed)
  serial?: unknown; // attested serial (OID .9.1)
  osVersion?: unknown; // attested OS version (OID .10.1)
  [k: string]: unknown;
}

/** The normalized, vendor-neutral attestation posture — one shape the fabric reads. */
export interface NormalizedAttestation {
  sourceSystem: "device-attestation";
  deviceId: string;
  /** true = hardware supports attestation (Apple silicon / A11+ / S4+); false =
   *  provably not capable (Intel); null = capability unknown. */
  attestable: boolean | null;
  chain: AttestationChain;
  freshness: AttestationFreshness;
  attestedSip: AttestedControl;
  attestedSecureBoot: AttestedSecureBoot;
  /** true = third-party kexts allowed (a reduced-integrity posture). null = unknown. */
  attestedKextAllowed: boolean | null;
  /** Attested serial / OS version, when present (identity binding). */
  attestedSerial: string | null;
  attestedOsVersion: string | null;
  source: string;
}

export type AttestationPosture =
  | "attested_hardened"
  | "attested_reduced"
  | "attested_compromised"
  | "unattested"
  | "not_attestable"
  | "unverified"
  | "unknown";

export type AttestationReasonCode =
  | "FULLY_ATTESTED"
  | "ATTESTED_SIP_DISABLED"
  | "ATTESTED_SECUREBOOT_PERMISSIVE"
  | "ATTESTED_SECUREBOOT_REDUCED"
  | "ATTESTED_KEXT_ALLOWED"
  | "ATTESTATION_UNVERIFIABLE"
  | "ATTESTATION_STALE"
  | "ATTESTATION_STATE_UNKNOWN"
  | "ATTESTATION_CONFLICT"
  | "NOT_ATTESTABLE"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type AttestationRecommendedAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface AttestationVerdict {
  posture: AttestationPosture;
  reasonCode: AttestationReasonCode;
  recommendedAction: AttestationRecommendedAction;
  /** Cryptographically-proven bad states (restrict level or higher). */
  criticalFindings: string[];
  /** Attestation signals whose state could NOT be determined (raise assurance). */
  unknownSignals: string[];
  /** True when a fresh, root-verified attestation backs the verdict (the top
   *  assurance tier — self-reported posture cannot claim this). */
  hardwareRooted: boolean;
  deviceId: string;
}

export type AttestationConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class AttestationConnectorError extends Error {
  readonly code: AttestationConnectorErrorCode;
  readonly status: number;
  constructor(code: AttestationConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "AttestationConnectorError";
    this.code = code;
    this.status = status;
  }
}
