// Types for the read-only CHALLENGE-CAPABILITY (answerable step-up) dimension.
//
// The fabric's remedy doctrine leans hard on step_up: an unstable host app, an
// under-floor credential read, a below-requirement location fix, an off-shift
// operator — each resolves to "challenge the worker", deliberately instead of a
// lockout. Every one of those verdicts silently assumes the challenge CAN BE
// ANSWERED on this device, by this worker, right now.
//
// Nothing reported that fact. A step_up posed to a device with no enrolled
// authenticator, no reader, or a dead local agent is not a challenge — it is a
// deny wearing a step_up label, and nobody chose it. That is this repository's
// defect class (the unearned affirmative) surfacing in the REMEDY rather than
// the verdict: the fabric claims to offer a path that does not exist.
//
// The reference shape is an MFA platform's own inventory (HID DigitalPersona's
// AD/LDS server and Web Client stack — which knows, per user and workstation,
// which credentials are enrolled and whether the local device-access client is
// present — or Entra's per-user authentication-methods registry, or a UEM app
// inventory for the agent half). A bridge reports, per METHOD: is a credential
// ENROLLED for this worker, is the AUTHENTICATOR hardware present on this
// device, and is the local CLIENT that brokers it healthy. This connector
// normalizes that already-evaluated view. It enrolls nothing, challenges
// nobody, and never executes a ceremony — execution stays with the HOST app
// and its authenticator stack (the embedded-UX law).
//
// GRADED ONLY WHEN POSED. The caller states which methods its workflow's
// step-up would accept. Unposed, this dimension is `unassessed` and forecloses
// nothing. Posed, three honest outcomes exist: READY (at least one accepted
// method is positively enrolled + present + healthy), UNANSWERABLE (every
// accepted method is positively broken — an operator-scale provisioning
// defect: fix enrollment or swap the device BEFORE the doomed challenge), and
// STANDING-UNKNOWN (at least one accepted method could not be graded — a blind
// spot, never silently promoted to either answer). Absence of a method from
// the report is never capability.

/** The challenge methods a workflow's step-up may accept — an allowlist. A
 *  method string this table does not know refuses, never passes through. */
export const CHALLENGE_METHODS = ["fingerprint", "face", "card_tap", "pin", "otp", "security_key"] as const;
export type ChallengeMethod = (typeof CHALLENGE_METHODS)[number];

/** One method's reported standing on this device+worker pair. Each axis is
 *  independently three-valued: `null` = the bridge did not say. */
export interface MethodStanding {
  method: ChallengeMethod;
  /** Is a credential of this method enrolled for the worker? */
  enrolled: boolean | null;
  /** Is the authenticator hardware/surface for this method present on the device? */
  authenticatorPresent: boolean | null;
  /** Is the local client/agent that brokers this method running and healthy? */
  clientHealthy: boolean | null;
}

/** Raw bridge report (loosely typed — any slot may carry anything). */
export interface ChallengeCapabilityReportRaw {
  /** Array of per-method entries: { method, enrolled, authenticator_present, client_healthy }. */
  methods?: unknown;
  /** Was the capability bridge reachable to evaluate this pair? */
  bridge_reachable?: unknown;
  subject_ref?: unknown;
  source_system?: unknown;
  [k: string]: unknown;
}

/** The exact top-level keys this connector understands. */
export const CHALLENGE_CAPABILITY_REPORT_KEYS = ["methods", "bridge_reachable", "subject_ref", "source_system"] as const;

/** The exact per-entry keys this connector understands. */
export const CHALLENGE_METHOD_ENTRY_KEYS = ["method", "enrolled", "authenticator_present", "client_healthy"] as const;

/** Hard bound on reported method entries — a report is a summary, not a dump. */
export const MAX_METHOD_ENTRIES = 16;

/** `malformed` = the report asserted something unreadable: a non-array methods
 *  slot, an entry that is not a plain object, an unrecognized method name or
 *  entry key, a non-boolean assertion in a boolean slot, a DUPLICATE method
 *  (two claims about one fact), an unrecognized top-level key, or a read that
 *  threw. The evaluator never reports READY on a malformed report. */
export type ChallengeReportIntegrity = "clean" | "malformed";

/** The normalized, vendor-neutral capability report — one shape the fabric reads. */
export interface NormalizedChallengeCapability {
  sourceSystem: "challenge-capability";
  /** The device+worker pair this standing was fetched for. */
  deviceRef: string;
  methods: MethodStanding[];
  bridgeReachable: boolean | null;
  idpSubjectRef: string | null;
  bridgeSource: string | null;
  reportIntegrity: ChallengeReportIntegrity;
  source: string;
}

export type ChallengeCapabilityPosture =
  | "challenge_ready"
  | "challenge_unanswerable"
  | "unassessed"
  | "unverified"
  | "unknown";

export type ChallengeCapabilityReasonCode =
  | "CHALLENGE_READY"
  | "CHALLENGE_UNANSWERABLE"
  | "CHALLENGE_STANDING_UNKNOWN"
  | "CHALLENGE_UNPOSED"
  | "ACCEPTED_METHOD_UNRECOGNIZED"
  | "BRIDGE_UNREACHABLE"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

/** All members are on the unified action ladder used by posture-composition. */
export type ChallengeCapabilityAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export interface ChallengeCapabilityVerdict {
  posture: ChallengeCapabilityPosture;
  reasonCode: ChallengeCapabilityReasonCode;
  recommendedAction: ChallengeCapabilityAction;
  /** Positively-broken facts, per accepted method ("fingerprint: enrolled=false"). */
  criticalFindings: string[];
  /** Accepted methods whose standing could NOT be determined. */
  unknownSignals: string[];
  /** True ONLY when the pose is valid, the report is clean, the bridge answered
   *  affirmatively, and at least one ACCEPTED method is positively enrolled +
   *  present + healthy. A step_up issued under `false` here is a decision made
   *  with open eyes, not an accident. */
  challengeAnswerable: boolean;
  /** The accepted methods that are positively answerable (empty unless ready). */
  answerableMethods: ChallengeMethod[];
  deviceRef: string;
}

export type ChallengeCapabilityConnectorErrorCode = "auth_failed" | "read_only_violation" | "upstream_error" | "bad_response";

export class ChallengeCapabilityConnectorError extends Error {
  readonly code: ChallengeCapabilityConnectorErrorCode;
  readonly status: number;
  constructor(code: ChallengeCapabilityConnectorErrorCode, message: string, status = 0) {
    super(message);
    this.name = "ChallengeCapabilityConnectorError";
    this.code = code;
    this.status = status;
  }
}
