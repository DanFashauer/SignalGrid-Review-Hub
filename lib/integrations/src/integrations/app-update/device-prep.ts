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

export const DEVICE_PREP_REPORT_KEYS = ["enrollment", "profiles", "required_apps", "os_update", "prep_stage"] as const;

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
  /** True ONLY when every stage is positively confirmed — the device may be handed out. */
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

  // Worst-concern-wins. The grant survives only when nothing fired: complete, enrolled,
  // profiles applied, apps installed, OS current, clean parse. Deliberately no backstop
  // predicate — every non-confirmed state above pushes a raising candidate, and the
  // proof's exhaustive sweep pins the single grant by equality.
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
    readyForCheckout: winner.action === "none",
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

/** Normalize a raw prep/update report into the one shape the fabric reads. */
export function normalizeDevicePrep(deviceRef: string, raw: DevicePrepReportRaw | null | undefined): NormalizedDevicePrep {
  const integrity = { malformed: false };
  const r: DevicePrepReportRaw = raw ?? {};
  return {
    sourceSystem: "app-update",
    deviceRef,
    enrollment: readEnum<PrepEnrollment>(r.enrollment, ["enrolled", "pending", "not_enrolled"], integrity),
    profiles: readEnum<PrepProfiles>(r.profiles, ["applied", "partial", "missing"], integrity),
    requiredApps: readEnum<PrepRequiredApps>(r.required_apps, ["installed", "partial", "missing"], integrity),
    osUpdate: readEnum<OsUpdateState>(
      r.os_update,
      ["current", "update_available", "update_required", "update_in_progress", "update_failed"],
      integrity,
    ),
    prepStage: readEnum<PrepStage>(r.prep_stage, ["complete", "in_progress", "failed"], integrity),
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
