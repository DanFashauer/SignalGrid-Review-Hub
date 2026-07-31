// Types for the read-only credential-exposure posture dimension.
//
// The other exfil dimensions cover data LEAVING (DLP) and hardware channels
// (peripheral-control). This one covers CREDENTIALS PILING UP on the endpoint —
// the developer/AI-agent laptop threat surface: secrets in shell history, .env
// files, CLI caches, and AI-agent configs & logs (Cursor/Copilot/Claude Code),
// which no repo scanner ever checks. It normalizes a secrets-detection platform
// (GitGuardian, Wiz, Truffle Security, Microsoft) into one vocabulary and turns a
// device's exposed-secret findings into a credential-exposure posture. Fail-safe
// by construction: a finding we can't confirm was remediated or revoked is treated
// as still exposed, a device with no scanner enrolled is a gap (never "clean"),
// and no coverage at all is a blind spot — never assumed clean.
//
// SignalGrid does NOT scan for or remediate secrets (that is the detection
// tool's job). It CONSUMES the verdict and turns exposure into a runtime
// allow/step-up/restrict/deny decision — contain the blast radius of a device
// that is assumed compromised.

/** Where on the endpoint the secret was found. */
export type SecretLocation =
  | "shell_history"
  | "dotenv"
  | "cli_cache"
  | "agent_config"
  | "agent_log"
  | "source_tree"
  | "keychain"
  | "unknown";

/** What kind of credential it is (some are inherently high-value). */
export type SecretKind =
  | "cloud_key"
  | "private_key"
  | "db_credential"
  | "oauth_token"
  | "api_token"
  | "password"
  | "generic_secret"
  | "unknown";

/** Whether the credential is still live. */
export type ExposureValidity = "active" | "revoked" | "unknown";

/** Whether the finding has been dealt with. */
export type RemediationState = "remediated" | "open" | "unknown";

export type SecretSeverity = "critical" | "high" | "medium" | "low" | "unknown";

/** Raw per-finding record (a read-only, vendor-neutral subset). */
export interface SecretFindingRaw {
  findingId?: string;
  location?: string;
  kind?: string;
  severity?: string;
  validity?: string;
  remediation?: string;
  detectedAt?: string;
}

/** Raw per-device record: scanner enrolment + recent findings. */
export interface CredentialExposureRaw {
  deviceId: string;
  /** Whether a secrets scanner is enrolled/active on the endpoint. */
  scannerEnrolled?: boolean;
  findings?: SecretFindingRaw[];
  source?: string;
}

export interface CredentialCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedSecretFinding {
  findingId: string | null;
  location: SecretLocation;
  kind: SecretKind;
  severity: SecretSeverity;
  validity: ExposureValidity;
  remediation: RemediationState;
  detectedAt: string | null;
  /** True when the secret is NOT provably contained (not remediated AND not revoked, or an unproven state). */
  exposed: boolean;
  /** True when the credential is inherently high-value (cloud/private-key/db/oauth) or critical/high severity. */
  highValue: boolean;
}

export interface NormalizedCredentialExposure {
  sourceSystem: "credential-exposure";
  deviceId: string;
  scannerEnrolled: boolean | null;
  /**
   * `null` when the source did not report a secret-scan result set at all — distinct from `[]`,
   * which means it reported and found nothing. The same distinction this package
   * already draws for scalars (`null = not reported`), extended to the collection:
   * a feed that was never read must not be gradeable as a clean one.
   */
  findings: NormalizedSecretFinding[] | null;
  source: string;
}

export type CredentialPosture =
  | "clean"
  | "remediated"
  | "scanner_unenrolled"
  | "secrets_exposed"
  | "active_credential_exposed"
  | "unknown";

export type CredentialReasonCode =
  | "NO_FINDINGS"
  | "SECRET_SCAN_UNOBSERVED"
  | "NOT_COVERED"
  | "FINDINGS_REMEDIATED"
  | "SCANNER_UNENROLLED"
  | "SECRETS_EXPOSED"
  | "HIGH_VALUE_SECRET_EXPOSED";

/** All members are on the unified action ladder used by posture-composition. */
export type CredentialRecommendedAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface CredentialExposureVerdict {
  posture: CredentialPosture;
  findingCount: number;
  exposedCount: number;
  highestSeverity: SecretSeverity;
  scannerEnrolled: boolean | null;
  reasonCode: CredentialReasonCode;
  recommendedAction: CredentialRecommendedAction;
}

export type CredentialConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class CredentialConnectorError extends Error {
  readonly code: CredentialConnectorErrorCode;
  readonly status: number;
  constructor(code: CredentialConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "CredentialConnectorError";
    this.code = code;
    this.status = status;
  }
}
