// iOS update / device-prep WORKFLOW readiness — is this shared device provisioned and
// current enough to hand out?
//
// THE ROW THIS EXISTS FOR (docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md):
// "iOS update / device-prep workflows". The runbooks describe two support workflows
// this family did not model. DEVICE PREP: after a wipe, or at first dock, the device is
// enrolled (Automated Device Enrollment), receives its configuration profiles and its
// required app set, and is declared ready — a device returned to a dock "checks itself
// back in, re-provisions, and recharges". iOS UPDATE: the OS update the UEM schedules,
// requires before use, or that fails mid-way.
//
// WHY THIS IS A DIFFERENT SURFACE FROM evaluateAppUpdate. That evaluator grades the HOST
// APP's version currency against the release manifest; the OS-version FLOOR lives with
// the UEM/telemetry posture (the fleet-connector osFloor pattern). Neither says whether
// the PREP WORKFLOW COMPLETED or whether an OS update is pending, required or failed —
// the states a support tech reads off the console before handing a device out. A seated,
// lit device that never finished provisioning is the runbooks' "phantom device".
//
// FAIL-CLOSED (golden rule 2). A device whose prep or update FAILED, or whose update is
// REQUIRED and not done, or that is NOT provisioned, is contained (`restrict`): it is not
// a working clinical device. A prep or update still IN PROGRESS, or ANY unknown stage,
// steps up — it is not ready and nobody may assume it is. An OPTIONAL available update
// is advisory (`monitor`). Ready (`none`) requires POSITIVE confirmation of every stage.
// No clock, no randomness: a pure function of the supplied state.

/** Enrollment as the prep workflow reports it. */
export type PrepEnrollment = "enrolled" | "pending" | "not_enrolled" | "unknown";
/** The required configuration profiles. */
export type PrepProfiles = "applied" | "partial" | "missing" | "unknown";
/** The required app set (the MDM's install list for this device role). */
export type PrepRequiredApps = "installed" | "partial" | "missing" | "unknown";
/** The OS update WORKFLOW state (the version floor itself is graded elsewhere). */
export type OsUpdateState =
  | "current"
  | "update_available" // optional update offered — advisory
  | "update_required" // the UEM requires it before use
  | "update_in_progress"
  | "update_failed"
  | "unknown";
/** The prep workflow's own declared outcome. */
export type PrepStage = "complete" | "in_progress" | "failed" | "unknown";
/** Present but unparseable = an assertion we could not read, distinct from silence. */
export type PrepReportIntegrity = "clean" | "malformed";

/** Raw prep/update report about one device (loosely typed — any slot may hold a
 *  number, a boolean, an error string, or nothing). */
export interface DevicePrepReportRaw {
  enrollment?: unknown; // enrolled | pending | not_enrolled
  profiles?: unknown; // applied | partial | missing
  required_apps?: unknown; // installed | partial | missing
  os_update?: unknown; // current | update_available | update_required | update_in_progress | update_failed
  prep_stage?: unknown; // complete | in_progress | failed
  [k: string]: unknown;
}

/** FROZEN like the domain lists: this is the allowlist `hasUnrecognizedKey` reads, and a
 *  JavaScript caller that pushed a key onto it would turn an unrecognized assertion into a
 *  clean one (in-house review finding, the round-five hole one list over). */
export const DEVICE_PREP_REPORT_KEYS = Object.freeze(["enrollment", "profiles", "required_apps", "os_update", "prep_stage"] as const);

/** The NORMALIZED domain of each stage — every declared member, `unknown` included. The
 *  evaluator holds any value outside these (a JavaScript caller, a cast, a deserialized
 *  object), whatever else fired: the exhaustive sweep walks these members, so a value
 *  they do not contain is one no proof has ever graded. FROZEN at runtime: `readonly` is
 *  a compile-time promise only, and a JavaScript caller could otherwise push "garbage"
 *  onto an exported list and reopen the grant (review finding). */
export const PREP_ENROLLMENT_DOMAIN: readonly PrepEnrollment[] = Object.freeze(["enrolled", "pending", "not_enrolled", "unknown"]);
export const PREP_PROFILES_DOMAIN: readonly PrepProfiles[] = Object.freeze(["applied", "partial", "missing", "unknown"]);
export const PREP_REQUIRED_APPS_DOMAIN: readonly PrepRequiredApps[] = Object.freeze(["installed", "partial", "missing", "unknown"]);
export const OS_UPDATE_DOMAIN: readonly OsUpdateState[] = Object.freeze([
  "current",
  "update_available",
  "update_required",
  "update_in_progress",
  "update_failed",
  "unknown",
]);
export const PREP_STAGE_DOMAIN: readonly PrepStage[] = Object.freeze(["complete", "in_progress", "failed", "unknown"]);
export const PREP_INTEGRITY_DOMAIN: readonly PrepReportIntegrity[] = Object.freeze(["clean", "malformed"]);

export interface NormalizedDevicePrep {
  readonly sourceSystem: "app-update";
  readonly deviceRef: string;
  readonly enrollment: PrepEnrollment;
  readonly profiles: PrepProfiles;
  readonly requiredApps: PrepRequiredApps;
  readonly osUpdate: OsUpdateState;
  readonly prepStage: PrepStage;
  readonly reportIntegrity: PrepReportIntegrity;
}

export type DevicePrepPosture =
  | "prep_complete" // ready — the one grant
  | "prep_failed"
  | "prep_in_progress"
  | "not_provisioned" // not enrolled / profiles or apps missing
  | "update_required"
  | "update_failed"
  | "update_in_progress"
  | "update_available" // advisory
  | "prep_unverified" // some stage could not be read
  | "unverified"; // malformed report

/** All members are on the unified action ladder used by posture-composition. */
export type DevicePrepAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type DevicePrepReasonCode =
  | "DEVICE_PREP_READY"
  | "DEVICE_PREP_FAILED"
  | "DEVICE_PREP_IN_PROGRESS"
  | "DEVICE_NOT_ENROLLED"
  | "DEVICE_ENROLLMENT_PENDING"
  | "DEVICE_PROFILES_MISSING"
  | "DEVICE_PROFILES_PARTIAL"
  | "DEVICE_REQUIRED_APPS_MISSING"
  | "DEVICE_REQUIRED_APPS_PARTIAL"
  | "OS_UPDATE_REQUIRED"
  | "OS_UPDATE_FAILED"
  | "OS_UPDATE_IN_PROGRESS"
  | "OS_UPDATE_AVAILABLE"
  | "DEVICE_PREP_STATE_UNKNOWN"
  | "DEVICE_PREP_REPORT_MALFORMED";

export interface DevicePrepVerdict {
  readonly deviceRef: string;
  readonly posture: DevicePrepPosture;
  readonly reasonCode: DevicePrepReasonCode;
  readonly recommendedAction: DevicePrepAction;
  /** Affirmative bad facts (a failed prep/update, a required update not done, not provisioned). */
  readonly criticalFindings: string[];
  /** Stages whose state could not be determined. Any of these forecloses the grant. */
  readonly unknownSignals: string[];
  /** True when the device may be handed out: nothing holds or contains it. That is the
   *  grant (`none`) and ALSO the one advisory (`monitor` — an OPTIONAL update offered on
   *  an otherwise fully-confirmed device). An advisory is not a hold (review finding: the
   *  first cut set this false on `monitor`, so a checkout consumer reading the boolean
   *  would have withheld a ready device over an update nobody requires). */
  readonly readyForCheckout: boolean;
}

const ACTION_SEVERITY: Record<DevicePrepAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

interface Candidate {
  posture: DevicePrepPosture;
  action: DevicePrepAction;
  reason: DevicePrepReasonCode;
}

/**
 * Grade the prep/update readiness of one device. Pure and deterministic.
 *
 * Worst-concern-wins on the unified ladder; on a tie the FIRST concern pushed wins, so
 * the order below is the precedence: the prep workflow's own outcome, then enrollment,
 * then profiles, then the required apps, then the OS update. Each branch carries its own
 * reason so a fixture can falsify it on its own.
 */
export function evaluateDevicePrep(s: NormalizedDevicePrep): DevicePrepVerdict {
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const candidates: Candidate[] = [];

  // Defence in depth: a report we could not fully parse is never a grant.
  if (s.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "DEVICE_PREP_REPORT_MALFORMED" });
  }

  // ── the prep workflow's own outcome ──────────────────────────────────────────────
  if (s.prepStage === "failed") {
    criticalFindings.push("prep_failed");
    candidates.push({ posture: "prep_failed", action: "restrict", reason: "DEVICE_PREP_FAILED" });
  } else if (s.prepStage === "in_progress") {
    candidates.push({ posture: "prep_in_progress", action: "step_up", reason: "DEVICE_PREP_IN_PROGRESS" });
  } else if (s.prepStage === "unknown") {
    unknownSignals.push("prep_stage");
    candidates.push({ posture: "prep_unverified", action: "step_up", reason: "DEVICE_PREP_STATE_UNKNOWN" });
  }

  // ── enrollment ──────────────────────────────────────────────────────────────────
  if (s.enrollment === "not_enrolled") {
    criticalFindings.push("not_enrolled");
    candidates.push({ posture: "not_provisioned", action: "restrict", reason: "DEVICE_NOT_ENROLLED" });
  } else if (s.enrollment === "pending") {
    candidates.push({ posture: "prep_in_progress", action: "step_up", reason: "DEVICE_ENROLLMENT_PENDING" });
  } else if (s.enrollment === "unknown") {
    unknownSignals.push("enrollment");
    candidates.push({ posture: "prep_unverified", action: "step_up", reason: "DEVICE_PREP_STATE_UNKNOWN" });
  }

  // ── configuration profiles ──────────────────────────────────────────────────────
  if (s.profiles === "missing") {
    criticalFindings.push("profiles_missing");
    candidates.push({ posture: "not_provisioned", action: "restrict", reason: "DEVICE_PROFILES_MISSING" });
  } else if (s.profiles === "partial") {
    candidates.push({ posture: "prep_in_progress", action: "step_up", reason: "DEVICE_PROFILES_PARTIAL" });
  } else if (s.profiles === "unknown") {
    unknownSignals.push("profiles");
    candidates.push({ posture: "prep_unverified", action: "step_up", reason: "DEVICE_PREP_STATE_UNKNOWN" });
  }

  // ── required apps ───────────────────────────────────────────────────────────────
  if (s.requiredApps === "missing") {
    criticalFindings.push("required_apps_missing");
    candidates.push({ posture: "not_provisioned", action: "restrict", reason: "DEVICE_REQUIRED_APPS_MISSING" });
  } else if (s.requiredApps === "partial") {
    candidates.push({ posture: "prep_in_progress", action: "step_up", reason: "DEVICE_REQUIRED_APPS_PARTIAL" });
  } else if (s.requiredApps === "unknown") {
    unknownSignals.push("required_apps");
    candidates.push({ posture: "prep_unverified", action: "step_up", reason: "DEVICE_PREP_STATE_UNKNOWN" });
  }

  // ── the OS update workflow ──────────────────────────────────────────────────────
  if (s.osUpdate === "update_failed") {
    criticalFindings.push("os_update_failed");
    candidates.push({ posture: "update_failed", action: "restrict", reason: "OS_UPDATE_FAILED" });
  } else if (s.osUpdate === "update_required") {
    criticalFindings.push("os_update_required");
    candidates.push({ posture: "update_required", action: "restrict", reason: "OS_UPDATE_REQUIRED" });
  } else if (s.osUpdate === "update_in_progress") {
    candidates.push({ posture: "update_in_progress", action: "step_up", reason: "OS_UPDATE_IN_PROGRESS" });
  } else if (s.osUpdate === "update_available") {
    // Optional and offered, not required: an advisory nudge, never a block.
    candidates.push({ posture: "update_available", action: "monitor", reason: "OS_UPDATE_AVAILABLE" });
  } else if (s.osUpdate === "unknown") {
    unknownSignals.push("os_update");
    candidates.push({ posture: "prep_unverified", action: "step_up", reason: "DEVICE_PREP_STATE_UNKNOWN" });
  }

  // Every stage must be a value this evaluator KNOWS. The branches above cover every
  // declared union member and the proof's exhaustive sweep pins the grant over those —
  // but a value OUTSIDE the union (a JavaScript caller, a cast, a deserialized object)
  // matches no branch, and the seed below would grant on it (review finding). The check
  // must not depend on whether another candidate fired: an optional-update advisory
  // (`monitor`, still ready) beside an out-of-domain stage read as ready when the guard
  // was gated on an empty candidate list (second review finding). So: any stage outside
  // its domain is held, whatever else fired — after a monitor the hold outranks it; after
  // another hold or containment the earlier concern keeps its own reason on the tie.
  const inDomain =
    (PREP_STAGE_DOMAIN as readonly string[]).includes(s.prepStage) &&
    (PREP_ENROLLMENT_DOMAIN as readonly string[]).includes(s.enrollment) &&
    (PREP_PROFILES_DOMAIN as readonly string[]).includes(s.profiles) &&
    (PREP_REQUIRED_APPS_DOMAIN as readonly string[]).includes(s.requiredApps) &&
    (OS_UPDATE_DOMAIN as readonly string[]).includes(s.osUpdate) &&
    (PREP_INTEGRITY_DOMAIN as readonly string[]).includes(s.reportIntegrity);
  if (!inDomain) {
    unknownSignals.push("state_out_of_domain");
    candidates.push({ posture: "prep_unverified", action: "step_up", reason: "DEVICE_PREP_STATE_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired: complete, enrolled,
  // profiles applied, apps installed, OS current, clean parse.
  const seed: Candidate = { posture: "prep_complete", action: "none", reason: "DEVICE_PREP_READY" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    deviceRef: s.deviceRef,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    unknownSignals,
    // Ready = not held and not contained. `monitor` is the ladder's advisory tier (still
    // the ok risk band in posture-composition); every step_up/restrict above it forecloses.
    readyForCheckout: winner.action === "none" || winner.action === "monitor",
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

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, and must not read as a confirmation
 *  (review finding: a report built with `Object.create({...})` or a polluted prototype
 *  otherwise normalized an EMPTY report to the one grant, `readyForCheckout: true`). */
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
      // Braced so the mutation guard can reach each guard (its mutators match `) {`;
      // a one-line `if (...) return true;` was invisible to the sweep — review finding).
      // A symbol key needs no separate test: `known` holds strings, so `includes` is
      // false for any symbol and the last guard catches it.
      if (depth >= MAX_PROTOTYPE_DEPTH) {
        return true;
      }
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) {
          return true;
        }
        if (!(known as readonly (string | symbol)[]).includes(k)) {
          return true;
        }
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

/** Normalize a raw prep/update report into the one shape the fabric reads.
 *  An ABSENT report is silence (every stage unknown, integrity clean); a report that is
 *  not a plain object, or that carries any key beyond the recognized five — own or
 *  inherited — is an assertion we could not read: every stage unknown AND malformed. */
export function normalizeDevicePrep(deviceRef: string, raw: DevicePrepReportRaw | null | undefined): NormalizedDevicePrep {
  const integrity = { malformed: false };
  let r: Record<string, unknown> = {};
  if (raw !== undefined && raw !== null) {
    if (!isPlainReport(raw) || hasUnrecognizedKey(raw, DEVICE_PREP_REPORT_KEYS)) {
      integrity.malformed = true;
    } else {
      r = raw as Record<string, unknown>;
    }
  }
  // A recognized OWN key whose read throws (an accessor property, a Proxy `get` trap) is
  // an assertion we could not read: malformed and every stage unknown — never an
  // exception out of the normalizer (review finding: it passed the key scan and crashed).
  let fields: Record<string, unknown> = {};
  try {
    fields = {
      enrollment: ownValue(r, "enrollment"),
      profiles: ownValue(r, "profiles"),
      required_apps: ownValue(r, "required_apps"),
      os_update: ownValue(r, "os_update"),
      prep_stage: ownValue(r, "prep_stage"),
    };
  } catch {
    integrity.malformed = true;
    fields = {};
  }
  return {
    sourceSystem: "app-update",
    deviceRef,
    enrollment: readEnum<PrepEnrollment>(fields.enrollment, ["enrolled", "pending", "not_enrolled"], integrity),
    profiles: readEnum<PrepProfiles>(fields.profiles, ["applied", "partial", "missing"], integrity),
    requiredApps: readEnum<PrepRequiredApps>(fields.required_apps, ["installed", "partial", "missing"], integrity),
    osUpdate: readEnum<OsUpdateState>(
      fields.os_update,
      ["current", "update_available", "update_required", "update_in_progress", "update_failed"],
      integrity,
    ),
    prepStage: readEnum<PrepStage>(fields.prep_stage, ["complete", "in_progress", "failed"], integrity),
    reportIntegrity: integrity.malformed ? "malformed" : "clean",
  };
}

// ── the fixture corpus ──────────────────────────────────────────────────────────
//
// NORMALIZED states, one per workflow outcome, so the proof can (a) name every
// reachable verdict, (b) mutate the sole grant one stage at a time and watch it fall,
// and (c) sweep the full cross-product and pin the grant set by equality. Each fixture
// isolates ONE stage so each evaluator branch is falsified on its own.

const READY: NormalizedDevicePrep = {
  sourceSystem: "app-update",
  deviceRef: "iphone-shared-01",
  enrollment: "enrolled",
  profiles: "applied",
  requiredApps: "installed",
  osUpdate: "current",
  prepStage: "complete",
  reportIntegrity: "clean",
};

export const DEVICE_PREP_FIXTURES: Readonly<Record<string, NormalizedDevicePrep>> = {
  /** The one grant: prep complete, enrolled, profiles applied, apps installed, OS current. */
  "ready": READY,
  /** The runbooks' "phantom device": seated and lit, provisioning failed. */
  "prep-failed": { ...READY, deviceRef: "iphone-shared-02", prepStage: "failed" },
  "prep-in-progress": { ...READY, deviceRef: "iphone-shared-03", prepStage: "in_progress" },
  "prep-stage-unknown": { ...READY, deviceRef: "iphone-shared-04", prepStage: "unknown" },
  "not-enrolled": { ...READY, deviceRef: "iphone-shared-05", enrollment: "not_enrolled" },
  "enrollment-pending": { ...READY, deviceRef: "iphone-shared-06", enrollment: "pending" },
  "enrollment-unknown": { ...READY, deviceRef: "iphone-shared-07", enrollment: "unknown" },
  "profiles-missing": { ...READY, deviceRef: "iphone-shared-08", profiles: "missing" },
  "profiles-partial": { ...READY, deviceRef: "iphone-shared-09", profiles: "partial" },
  "profiles-unknown": { ...READY, deviceRef: "iphone-shared-10", profiles: "unknown" },
  "apps-missing": { ...READY, deviceRef: "iphone-shared-11", requiredApps: "missing" },
  "apps-partial": { ...READY, deviceRef: "iphone-shared-12", requiredApps: "partial" },
  "apps-unknown": { ...READY, deviceRef: "iphone-shared-13", requiredApps: "unknown" },
  /** The UEM requires the update before use — a block, not a nudge. */
  "update-required": { ...READY, deviceRef: "iphone-shared-14", osUpdate: "update_required" },
  "update-failed": { ...READY, deviceRef: "iphone-shared-15", osUpdate: "update_failed" },
  "update-in-progress": { ...READY, deviceRef: "iphone-shared-16", osUpdate: "update_in_progress" },
  /** Optional update offered: advisory only — the one non-grant that is not a hold. */
  "update-available": { ...READY, deviceRef: "iphone-shared-17", osUpdate: "update_available" },
  "os-update-unknown": { ...READY, deviceRef: "iphone-shared-18", osUpdate: "unknown" },
  /** Every value reads ready, but the report carried an assertion we could not parse. */
  "report-malformed": { ...READY, deviceRef: "iphone-shared-19", reportIntegrity: "malformed" },
  /** Several concerns at once: the failed prep is named first, all three are recorded. */
  "worst-of-several": {
    ...READY,
    deviceRef: "iphone-shared-20",
    prepStage: "failed",
    requiredApps: "missing",
    osUpdate: "update_required",
  },
};

/** Evaluate a named fixture; `undefined` for an unknown name (never a fabricated verdict). */
export function evaluateDevicePrepFixture(name: string): DevicePrepVerdict | undefined {
  const fixture = DEVICE_PREP_FIXTURES[name];
  if (fixture === undefined) {
    return undefined;
  }
  return evaluateDevicePrep(fixture);
}
