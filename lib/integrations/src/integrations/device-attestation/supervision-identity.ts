// Apple supervision identity LIFECYCLE — "device trust" as a PRECONDITION.
//
// THE ROW THIS EXISTS FOR (docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md):
// "Device 'trust' = Apple supervision identity present". The runbooks' one-line
// definition is the whole doctrine: WITHOUT the supervision identity, NO management
// command runs — the UEM cannot lock, wipe, push a profile or install an app. "A lost
// supervision identity" is a named root cause of shared-device failures.
//
// WHY THIS IS A DIFFERENT SURFACE FROM evaluateAttestation. The hardware-rooted
// evaluator in this family grades what the Secure Enclave PROVES about the device's
// integrity (SIP, secure boot, kexts). It says nothing about whether the ORGANIZATION
// still holds the device's supervision identity. That is a separate question with its
// own lifecycle: a device is enrolled under an org's supervision identity (Automated
// Device Enrollment / Apple Business Manager); that identity can be LOST — the device
// un-enrolled, wiped and re-activated outside ABM, or released from the org's ABM — and
// a device can carry ANOTHER org's identity (a foreign fleet's device on this dock). Each
// state changes what the org can do to the device, so each changes whether a shared
// device may be handed out. The states are read from the UEM (the system that HOLDS the
// identity); nothing here is self-reported by the device.
//
// FAIL-CLOSED IS THE LOAD-BEARING LAW (golden rule 2). Every unknown TIGHTENS. The one
// grant requires POSITIVE confirmation of every axis; no absence of bad news is ever
// read as good news. No clock and no randomness: a pure function of the supplied state.

/** Is the device supervised, as the UEM reports it? */
export type SupervisionState = "supervised" | "unsupervised" | "unknown";

/**
 * WHOSE supervision identity the device carries.
 *  `bound_to_org`       — this org's identity: management commands can run.
 *  `bound_to_other_org` — a foreign identity: another org's device (or a device that
 *                         was re-enrolled elsewhere). This org can run nothing on it.
 *  `unbound`            — the identity is LOST (un-enrolled, wiped outside ABM,
 *                         released). The runbooks' "lost supervision identity".
 *  `unknown`            — the UEM could not say.
 */
export type SupervisionIdentityBinding = "bound_to_org" | "bound_to_other_org" | "unbound" | "unknown";

/** The device's enrollment as the UEM reports it. `enrollment_lost` = was enrolled, no longer is. */
export type SupervisionEnrollment = "enrolled" | "enrollment_lost" | "never_enrolled" | "unknown";

/**
 * Do management commands actually run? The runbooks' operational test of "trust":
 * a device can look supervised and still answer nothing (the channel is the UEM's
 * push path; `device-management-health` grades that channel in depth — here it is
 * one precondition axis, read as the UEM's last command outcome).
 */
export type ManagementChannel = "responsive" | "unresponsive" | "unknown";

/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type SupervisionReportIntegrity = "clean" | "malformed";

/** Raw UEM report about one device's supervision identity (loosely typed — any slot
 *  may hold a boolean, a number, an error string, or nothing). */
export interface SupervisionIdentityReportRaw {
  supervised?: unknown; // boolean, or "supervised" | "unsupervised"
  identity_binding?: unknown; // bound_to_org | bound_to_other_org | unbound
  enrollment?: unknown; // enrolled | enrollment_lost | never_enrolled
  command_channel?: unknown; // responsive | unresponsive
  [k: string]: unknown;
}

export const SUPERVISION_IDENTITY_REPORT_KEYS = [
  "supervised",
  "identity_binding",
  "enrollment",
  "command_channel",
] as const;

/** The NORMALIZED domain of each axis — every declared member, `unknown` included. The
 *  evaluator holds any value outside these (a JavaScript caller, a cast, a deserialized
 *  object), whatever else fired: the exhaustive sweep walks these members, so a value
 *  they do not contain is one no proof has ever graded. FROZEN at runtime: `readonly` is
 *  a compile-time promise only, and a JavaScript caller could otherwise push "garbage"
 *  onto an exported list and reopen the grant (review finding). */
export const SUPERVISION_DOMAIN: readonly SupervisionState[] = Object.freeze(["supervised", "unsupervised", "unknown"]);
export const IDENTITY_BINDING_DOMAIN: readonly SupervisionIdentityBinding[] = Object.freeze(["bound_to_org", "bound_to_other_org", "unbound", "unknown"]);
export const SUPERVISION_ENROLLMENT_DOMAIN: readonly SupervisionEnrollment[] = Object.freeze(["enrolled", "enrollment_lost", "never_enrolled", "unknown"]);
export const MANAGEMENT_CHANNEL_DOMAIN: readonly ManagementChannel[] = Object.freeze(["responsive", "unresponsive", "unknown"]);
export const SUPERVISION_INTEGRITY_DOMAIN: readonly SupervisionReportIntegrity[] = Object.freeze(["clean", "malformed"]);

export interface NormalizedSupervisionIdentity {
  readonly sourceSystem: "device-attestation";
  readonly deviceId: string;
  readonly supervision: SupervisionState;
  readonly identityBinding: SupervisionIdentityBinding;
  readonly enrollment: SupervisionEnrollment;
  readonly commandChannel: ManagementChannel;
  readonly reportIntegrity: SupervisionReportIntegrity;
}

export type SupervisionIdentityPosture =
  | "supervised_trusted" // the precondition is MET — the one grant
  | "foreign_identity" // another org's identity: this org can run nothing on it
  | "supervision_lost" // the identity or the enrollment was lost
  | "unsupervised" // affirmatively not supervised / never enrolled
  | "channel_unresponsive" // supervised on paper, answers no command
  | "identity_unverified" // some axis could not be read
  | "unverified"; // malformed report

/** All members are on the unified action ladder used by posture-composition. */
export type SupervisionIdentityAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type SupervisionIdentityReasonCode =
  | "SUPERVISION_IDENTITY_PRESENT"
  | "SUPERVISION_FOREIGN_IDENTITY"
  | "SUPERVISION_IDENTITY_LOST"
  | "SUPERVISION_ENROLLMENT_LOST"
  | "SUPERVISION_NEVER_ENROLLED"
  | "SUPERVISION_UNSUPERVISED"
  | "SUPERVISION_CHANNEL_UNRESPONSIVE"
  | "SUPERVISION_STATE_UNKNOWN"
  | "SUPERVISION_REPORT_MALFORMED";

export interface SupervisionIdentityVerdict {
  readonly deviceId: string;
  readonly posture: SupervisionIdentityPosture;
  readonly reasonCode: SupervisionIdentityReasonCode;
  readonly recommendedAction: SupervisionIdentityAction;
  /** Affirmative bad facts (a foreign or lost identity, no enrollment, unsupervised). */
  readonly criticalFindings: string[];
  /** Axes whose state could not be determined. Any of these forecloses the grant. */
  readonly unknownSignals: string[];
  /** True ONLY when every axis is positively confirmed — the trust precondition holds. */
  readonly trustPreconditionMet: boolean;
}

const ACTION_SEVERITY: Record<SupervisionIdentityAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

interface Candidate {
  posture: SupervisionIdentityPosture;
  action: SupervisionIdentityAction;
  reason: SupervisionIdentityReasonCode;
}

/**
 * Grade the supervision-identity precondition for one device. Pure and deterministic.
 *
 * Worst-concern-wins on the unified ladder; on a tie the FIRST concern pushed wins, so
 * the order below is the doctrine's precedence: identity binding (whose device is it),
 * then enrollment, then supervision, then the command channel. Each branch carries its
 * own reason so a fixture can falsify it on its own.
 *
 *  - a FOREIGN identity, a LOST identity, a LOST enrollment, NEVER enrolled, or
 *    affirmatively UNSUPERVISED → `restrict`: no management command can run, so the
 *    device cannot be secured, located or wiped — it is not a shared device this org
 *    can hand out;
 *  - a supervised, bound, enrolled device whose commands do not run → `step_up`: it
 *    may be a network fault (the runbooks' commonest root cause), it may be worse;
 *    either way it is not confirmed;
 *  - ANY axis unknown, or a malformed report → `step_up`: unknown raises, never grants.
 *
 * The grant (`none`) is the single positively-confirmed shape; the proof pins it by
 * equality over the whole state space.
 */
export function evaluateSupervisionIdentity(s: NormalizedSupervisionIdentity): SupervisionIdentityVerdict {
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const candidates: Candidate[] = [];

  // Defence in depth: a report we could not fully parse is never a grant.
  if (s.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "SUPERVISION_REPORT_MALFORMED" });
  }

  // ── identity binding: whose device is this? ─────────────────────────────────────
  if (s.identityBinding === "bound_to_other_org") {
    criticalFindings.push("foreign_supervision_identity");
    candidates.push({ posture: "foreign_identity", action: "restrict", reason: "SUPERVISION_FOREIGN_IDENTITY" });
  } else if (s.identityBinding === "unbound") {
    criticalFindings.push("supervision_identity_lost");
    candidates.push({ posture: "supervision_lost", action: "restrict", reason: "SUPERVISION_IDENTITY_LOST" });
  } else if (s.identityBinding === "unknown") {
    unknownSignals.push("identity_binding");
    candidates.push({ posture: "identity_unverified", action: "step_up", reason: "SUPERVISION_STATE_UNKNOWN" });
  }

  // ── enrollment ──────────────────────────────────────────────────────────────────
  if (s.enrollment === "enrollment_lost") {
    criticalFindings.push("enrollment_lost");
    candidates.push({ posture: "supervision_lost", action: "restrict", reason: "SUPERVISION_ENROLLMENT_LOST" });
  } else if (s.enrollment === "never_enrolled") {
    criticalFindings.push("never_enrolled");
    candidates.push({ posture: "unsupervised", action: "restrict", reason: "SUPERVISION_NEVER_ENROLLED" });
  } else if (s.enrollment === "unknown") {
    unknownSignals.push("enrollment");
    candidates.push({ posture: "identity_unverified", action: "step_up", reason: "SUPERVISION_STATE_UNKNOWN" });
  }

  // ── supervision ─────────────────────────────────────────────────────────────────
  if (s.supervision === "unsupervised") {
    criticalFindings.push("unsupervised");
    candidates.push({ posture: "unsupervised", action: "restrict", reason: "SUPERVISION_UNSUPERVISED" });
  } else if (s.supervision === "unknown") {
    unknownSignals.push("supervision");
    candidates.push({ posture: "identity_unverified", action: "step_up", reason: "SUPERVISION_STATE_UNKNOWN" });
  }

  // ── command channel: the operational test of trust ──────────────────────────────
  if (s.commandChannel === "unresponsive") {
    candidates.push({ posture: "channel_unresponsive", action: "step_up", reason: "SUPERVISION_CHANNEL_UNRESPONSIVE" });
  } else if (s.commandChannel === "unknown") {
    unknownSignals.push("command_channel");
    candidates.push({ posture: "identity_unverified", action: "step_up", reason: "SUPERVISION_STATE_UNKNOWN" });
  }

  // Every axis must be a value this evaluator KNOWS. The branches above cover every
  // declared union member, and the proof's exhaustive sweep pins the grant set by
  // equality over those — but a value OUTSIDE the union (a JavaScript caller, a cast, a
  // deserialized object) matches no branch, and the seed below would grant on it (review
  // finding). The check must not depend on whether another candidate fired (the sibling
  // evaluator's optional-update advisory beside an out-of-domain axis read as ready when
  // its guard was gated on an empty candidate list): any axis outside its domain is
  // held, whatever else fired — an earlier hold or containment keeps its own reason.
  const inDomain =
    (SUPERVISION_DOMAIN as readonly string[]).includes(s.supervision) &&
    (IDENTITY_BINDING_DOMAIN as readonly string[]).includes(s.identityBinding) &&
    (SUPERVISION_ENROLLMENT_DOMAIN as readonly string[]).includes(s.enrollment) &&
    (MANAGEMENT_CHANNEL_DOMAIN as readonly string[]).includes(s.commandChannel) &&
    (SUPERVISION_INTEGRITY_DOMAIN as readonly string[]).includes(s.reportIntegrity);
  if (!inDomain) {
    unknownSignals.push("state_out_of_domain");
    candidates.push({ posture: "identity_unverified", action: "step_up", reason: "SUPERVISION_STATE_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired: supervised, bound
  // to THIS org, enrolled, answering commands, clean parse.
  const seed: Candidate = { posture: "supervised_trusted", action: "none", reason: "SUPERVISION_IDENTITY_PRESENT" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    deviceId: s.deviceId,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    unknownSignals,
    trustPreconditionMet: winner.action === "none",
  };
}

// ── normalization ───────────────────────────────────────────────────────────────

/**
 * Read one enum-valued slot off the wire. The asymmetry is the point:
 *  - ABSENT (undefined/null)            → `unknown`, and the report stays clean (silence);
 *  - a STRING outside the vocabulary    → `unknown` (an out-of-vocabulary vendor value
 *                                          is not evidence of anything);
 *  - PRESENT but NOT A STRING           → `unknown` AND the report is `malformed` (an
 *                                          assertion was made that we could not read).
 */
function readEnum<T extends string>(value: unknown, vocab: readonly T[], integrity: { malformed: boolean }): T | "unknown" {
  if (value === undefined || value === null) {
    return "unknown";
  }
  if (typeof value !== "string") {
    integrity.malformed = true;
    return "unknown";
  }
  const v = value.trim().toLowerCase();
  const hit = vocab.find((member) => member === v);
  if (hit === undefined) {
    return "unknown";
  }
  return hit;
}

/** `supervised` naturally arrives as a boolean from a UEM; accept that shape too. */
function readSupervision(value: unknown, integrity: { malformed: boolean }): SupervisionState {
  if (value === true) {
    return "supervised";
  }
  if (value === false) {
    return "unsupervised";
  }
  return readEnum<SupervisionState>(value, ["supervised", "unsupervised"], integrity);
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, and must not read as a confirmation
 *  (review finding: a report built with `Object.create({...})` or a polluted prototype
 *  otherwise satisfied the trust precondition while asserting nothing itself). */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? An injected transport returning a string
 *  or an array must fail closed, not throw an untyped TypeError out of the normalizer.
 *  The Object.prototype exclusion is load-bearing: passing Object.prototype itself as
 *  the report would let POLLUTED prototype fields read as own assertions. */
function isPlainReport(report: unknown): report is object {
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

/** Depth bound for the prototype scan — a Proxy may return a fresh object from
 *  getPrototypeOf on every call, so the walk must be bounded rather than trusted. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this normalizer does not understand? Walks the
 *  PROTOTYPE CHAIN even though value reads are own-only: an inherited assertion, in any
 *  spelling, is still an assertion this report did not make, and this scan is the only
 *  thing that notices it. A symbol key counts; a class instance fails closed. */
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

/** Normalize a raw UEM supervision-identity report into the one shape the fabric reads.
 *  An ABSENT report is silence (every axis unknown, integrity clean); a report that is
 *  not a plain object, or that carries any key beyond the recognized five — own or
 *  inherited — is an assertion we could not read: every axis unknown AND malformed. */
export function normalizeSupervisionIdentity(
  deviceId: string,
  raw: SupervisionIdentityReportRaw | null | undefined,
): NormalizedSupervisionIdentity {
  const integrity = { malformed: false };
  let r: Record<string, unknown> = {};
  if (raw !== undefined && raw !== null) {
    if (!isPlainReport(raw) || hasUnrecognizedKey(raw, SUPERVISION_IDENTITY_REPORT_KEYS)) {
      integrity.malformed = true;
    } else {
      r = raw as Record<string, unknown>;
    }
  }
  // A recognized OWN key whose read throws (an accessor property, a Proxy `get` trap) is
  // an assertion we could not read: malformed and every axis unknown — never an
  // exception out of the normalizer (review finding: it passed the key scan and crashed).
  let fields: Record<string, unknown> = {};
  try {
    fields = {
      supervised: ownValue(r, "supervised"),
      identity_binding: ownValue(r, "identity_binding"),
      enrollment: ownValue(r, "enrollment"),
      command_channel: ownValue(r, "command_channel"),
    };
  } catch {
    integrity.malformed = true;
    fields = {};
  }
  const supervision = readSupervision(fields.supervised, integrity);
  const identityBinding = readEnum<SupervisionIdentityBinding>(
    fields.identity_binding,
    ["bound_to_org", "bound_to_other_org", "unbound"],
    integrity,
  );
  const enrollment = readEnum<SupervisionEnrollment>(
    fields.enrollment,
    ["enrolled", "enrollment_lost", "never_enrolled"],
    integrity,
  );
  const commandChannel = readEnum<ManagementChannel>(
    fields.command_channel,
    ["responsive", "unresponsive"],
    integrity,
  );
  return {
    sourceSystem: "device-attestation",
    deviceId,
    supervision,
    identityBinding,
    enrollment,
    commandChannel,
    reportIntegrity: integrity.malformed ? "malformed" : "clean",
  };
}

// ── the fixture corpus ──────────────────────────────────────────────────────────
//
// NORMALIZED states, one per lifecycle outcome, so the proof can (a) name every
// reachable verdict, (b) mutate the sole grant one axis at a time and watch it fall,
// and (c) sweep the full cross-product and pin the grant set by equality. Each fixture
// isolates ONE axis so each evaluator branch is falsified on its own.

const CLEAN: NormalizedSupervisionIdentity = {
  sourceSystem: "device-attestation",
  deviceId: "iphone-shared-01",
  supervision: "supervised",
  identityBinding: "bound_to_org",
  enrollment: "enrolled",
  commandChannel: "responsive",
  reportIntegrity: "clean",
};

export const SUPERVISION_IDENTITY_FIXTURES: Readonly<Record<string, NormalizedSupervisionIdentity>> = {
  /** The one grant: supervised, this org's identity, enrolled, answering commands. */
  "supervised-trusted": CLEAN,
  /** Another org's device on this dock — this org can run nothing on it. */
  "foreign-identity": { ...CLEAN, deviceId: "iphone-foreign-02", identityBinding: "bound_to_other_org" },
  /** The runbooks' "lost supervision identity" — un-enrolled, wiped outside ABM, or released. */
  "identity-lost": { ...CLEAN, deviceId: "iphone-shared-03", identityBinding: "unbound" },
  "identity-binding-unknown": { ...CLEAN, deviceId: "iphone-shared-04", identityBinding: "unknown" },
  "enrollment-lost": { ...CLEAN, deviceId: "iphone-shared-05", enrollment: "enrollment_lost" },
  "never-enrolled": { ...CLEAN, deviceId: "iphone-shared-06", enrollment: "never_enrolled" },
  "enrollment-unknown": { ...CLEAN, deviceId: "iphone-shared-07", enrollment: "unknown" },
  "unsupervised": { ...CLEAN, deviceId: "iphone-shared-08", supervision: "unsupervised" },
  "supervision-unknown": { ...CLEAN, deviceId: "iphone-shared-09", supervision: "unknown" },
  /** Supervised on paper, answers no command — the commonest runbook root cause is network. */
  "channel-unresponsive": { ...CLEAN, deviceId: "iphone-shared-10", commandChannel: "unresponsive" },
  "channel-unknown": { ...CLEAN, deviceId: "iphone-shared-11", commandChannel: "unknown" },
  /** Every value reads clean, but the report carried an assertion we could not parse. */
  "report-malformed": { ...CLEAN, deviceId: "iphone-shared-12", reportIntegrity: "malformed" },
  /** Several concerns at once: the foreign identity is named first, all three are recorded. */
  "worst-of-several": {
    ...CLEAN,
    deviceId: "iphone-foreign-13",
    identityBinding: "bound_to_other_org",
    enrollment: "enrollment_lost",
    supervision: "unsupervised",
  },
};

/** Evaluate a named fixture; `undefined` for an unknown name (never a fabricated verdict). */
export function evaluateSupervisionIdentityFixture(name: string): SupervisionIdentityVerdict | undefined {
  const fixture = SUPERVISION_IDENTITY_FIXTURES[name];
  if (fixture === undefined) {
    return undefined;
  }
  return evaluateSupervisionIdentity(fixture);
}
