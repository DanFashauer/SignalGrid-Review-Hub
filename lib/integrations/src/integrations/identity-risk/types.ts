// Types for the read-only identity / SSO sign-in-risk dimension.
//
// This is the "is the person/session signing in actually who they claim, or is
// this a compromised identity?" signal — complementary to, and distinct from,
// device posture (which asks "is the device compliant/managed?"). It normalizes
// an identity provider's own risk verdicts (Microsoft Entra ID Protection risky
// users / risk detections, Okta ThreatInsight, Ping, Duo, Google Workspace
// context-aware access) into one vocabulary and aggregates them into a per-
// principal sign-in-risk posture. Fail-safe by construction: a principal with no
// IdP risk coverage is a blind spot (never "trusted"), a confirmed-compromised
// identity escalates, and a risky sign-in that bypassed MFA is treated as worse
// than one that didn't.

export type RiskLevel = "high" | "medium" | "low" | "none" | "unknown";

/** The IdP's own state for a principal's aggregate risk. */
export type RiskState =
  | "at_risk"
  | "confirmed_compromised"
  | "remediated"
  | "dismissed"
  | "confirmed_safe"
  /** The IdP AFFIRMATIVELY reported no risk — Entra's `riskState: "none"`, the most
   *  common value in a healthy tenant. Distinct from `unknown` on purpose: "the
   *  source said none" is a reading, "the source said something we cannot parse (or
   *  said nothing)" is a blind spot, and the two must never grade the same. Until
   *  this member existed the normalizer collapsed both into `unknown`, and the
   *  evaluator graded `unknown` as trusted — so a vendor renaming one enum value
   *  would have silently converted parse failure into trust. */
  | "none"
  | "unknown";

/** Vendor-normalized risk-detection type. */
export type RiskDetectionType =
  | "leaked_credentials"
  | "malicious_ip"
  | "token_anomaly"
  | "admin_confirmed_compromised"
  | "impossible_travel"
  | "anonymous_ip"
  | "password_spray"
  | "unfamiliar_sign_in"
  | "new_country"
  | "mfa_failed"
  | "suspicious_activity"
  | "unknown";

/** How severe a detection type is, independent of the IdP's numeric level. */
export type DetectionGrade = "compromise" | "high" | "medium";

/** Raw per-detection record (a read-only, vendor-neutral subset). */
export interface RiskDetectionRaw {
  detectionType?: string;
  riskLevel?: string;
  detectedAt?: string;
  ipAddress?: string;
  source?: string;
}

/** Raw per-principal risk record: aggregate state + its detections. */
export interface PrincipalRiskRaw {
  principalId: string;
  riskLevel?: string;
  riskState?: string;
  /** Whether the risky sign-in satisfied MFA (multi-factor). */
  mfaSatisfied?: boolean;
  detections?: RiskDetectionRaw[];
  lastSignInAt?: string;
  source?: string;
}

export interface RiskCollection<T> {
  value: T[];
  nextPageToken?: string;
}

export interface NormalizedRiskDetection {
  detectionType: RiskDetectionType;
  grade: DetectionGrade;
  riskLevel: RiskLevel;
  detectedAt: string | null;
  source: string;
}

export interface NormalizedPrincipalRisk {
  sourceSystem: "identity-risk";
  principalId: string;
  riskLevel: RiskLevel;
  riskState: RiskState;
  /** null when the IdP did not report an MFA outcome for the risky sign-in. */
  mfaSatisfied: boolean | null;
  /**
   * `null` when the source did not report a sign-in risk-detection feed at all — distinct from `[]`,
   * which means it reported and found nothing. The same distinction this package
   * already draws for scalars (`null = not reported`), extended to the collection:
   * a feed that was never read must not be gradeable as a clean one.
   */
  detections: NormalizedRiskDetection[] | null;
  lastSignInAt: string | null;
  source: string;
}

export type IdentityPosture =
  | "trusted"
  | "low_risk"
  | "at_risk"
  | "high_risk"
  | "compromised"
  | "unknown";

export type IdentityReasonCode =
  | "NO_RISK"
  | "RISK_FEED_UNOBSERVED"
  /** riskState is `unknown` — absent from the source, or a value the normalizer
   *  could not map. Grades `monitor`: a blind spot to investigate, never `trusted`.
   *  Mirrors RISK_FEED_UNOBSERVED, one field over. */
  | "RISK_STATE_UNVERIFIED"
  /** riskLevel is `unknown` — absent, or a value the normalizer could not map.
   *  Same law, third field: a grant requires positive confirmation of EVERY
   *  input, and an unparseable level is a blind spot, not a clean bill. */
  | "RISK_LEVEL_UNVERIFIED"
  | "NOT_COVERED"
  | "RISK_REMEDIATED"
  | "RISK_STATE_AT_RISK"
  | "LOW_RISK_SIGNIN"
  | "MEDIUM_RISK_SIGNIN"
  | "HIGH_RISK_SIGNIN"
  | "RISKY_DETECTION"
  | "HIGH_RISK_NO_MFA"
  | "LEAKED_OR_MALICIOUS"
  | "CONFIRMED_COMPROMISED";

/** All members are on the unified action ladder used by posture-composition. */
export type IdentityAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface IdentityRiskVerdict {
  posture: IdentityPosture;
  riskLevel: RiskLevel;
  riskState: RiskState;
  detectionCount: number;
  /** Highest detection grade present, or null when there are no detections. */
  highestDetectionGrade: DetectionGrade | null;
  mfaSatisfied: boolean | null;
  reasonCode: IdentityReasonCode;
  recommendedAction: IdentityAction;
}

export type IdentityConnectorErrorCode = "incomplete_read" | "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class IdentityRiskConnectorError extends Error {
  readonly code: IdentityConnectorErrorCode;
  readonly status: number;
  constructor(code: IdentityConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "IdentityRiskConnectorError";
    this.code = code;
    this.status = status;
  }
}
