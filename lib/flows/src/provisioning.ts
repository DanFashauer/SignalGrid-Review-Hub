// Zero-touch provisioning — a device setup, recorded once, as versionable config.
//
// The vision (docs/OPEN_ORCHESTRATION_VISION.md): a device powers on for the first
// time; by serial + network join the Grid configures it when other systems won't.
// A Designer / Device Action Recorder in the mobile app captures what a setup
// should do ONCE; that recording becomes a declarative artifact the CI/CD pipeline
// validates (like grid-config) and the Grid can replay zero-touch — so the end
// user never hand-configures a device.
//
// This is the deterministic core: the recording model, its fail-safe validator,
// and a SIMULATED apply planner. Safety boundary (non-negotiable): nothing is
// actually enforced unless an owner has turned enforcement on AND the plan is
// asked for in enforced mode; by default every step is described, not executed,
// and any sensitive/regulated step requires approval even then. A device that
// doesn't match the recording is never touched.
//
// Pure and deterministic. No device is contacted here.

/** When a recording is eligible to fire for a device. */
export type SetupTrigger = "first_boot" | "network_join" | "serial_match";

/** The kind of configuration a step performs (allowlist — unknown kinds fail validation). */
export type SetupStepKind =
  | "profile" // config/MDM profile
  | "wifi" // network join
  | "cert" // certificate/identity
  | "app_install" // deploy an app
  | "policy" // apply a policy/baseline
  | "restriction" // apply a restriction/lockdown
  | "account"; // provision an account/binding

export const SETUP_STEP_KINDS: readonly SetupStepKind[] = [
  "profile", "wifi", "cert", "app_install", "policy", "restriction", "account",
];

export interface SetupStep {
  key: string;
  label: string;
  kind: SetupStepKind;
  /** Touches sensitive/regulated config — requires approval before any real apply. */
  sensitive?: boolean;
  /** The Grid performs this itself because the target system exposes no way to (grid does the lifting). */
  gridLifted?: boolean;
}

/** Which devices a recording applies to. At least one selector must be present. */
export interface DeviceMatch {
  serialPrefix?: string;
  model?: string;
}

/** A recorded device setup — authored once, versioned, replayed zero-touch. */
export interface DeviceSetupRecording {
  id: string;
  name: string;
  match: DeviceMatch;
  triggers: SetupTrigger[];
  steps: SetupStep[];
  /**
   * The recorded REVERSAL of this setup. Optional in the type for back-compat, but
   * a recording is not deploy-ready until it is present and proven — see
   * `provisioning-teardown.ts` (`deployReady`). Prove the retreat before you trust
   * the deploy.
   */
  teardown?: import("./provisioning-teardown").TeardownPlanSpec;
}

// ── validation ────────────────────────────────────────────────────────────────

export interface SetupRecordingIssue {
  severity: "error" | "warning";
  code: string;
  subject: string;
  message: string;
}

const VALID_TRIGGERS: readonly SetupTrigger[] = ["first_boot", "network_join", "serial_match"];

/**
 * Validate a setup recording. Fail-safe: a recording that couldn't run correctly
 * (no steps, an unknown step kind, no trigger, no device selector, duplicate step
 * keys, a missing id) is an ERROR; a sensitive step is surfaced as a WARNING (it
 * will require approval at apply time, not blocked at authoring). Errors block a
 * merge; warnings inform. Deterministic order (errors first, then warnings).
 */
export function lintSetupRecording(rec: DeviceSetupRecording): SetupRecordingIssue[] {
  const errors: SetupRecordingIssue[] = [];
  const warnings: SetupRecordingIssue[] = [];

  if (typeof rec.id !== "string" || rec.id.length === 0) {
    errors.push({ severity: "error", code: "missing_id", subject: "recording", message: "Recording has a missing or empty id." });
  }
  const match = rec.match ?? {};
  const hasSelector = (typeof match.serialPrefix === "string" && match.serialPrefix.length > 0) || (typeof match.model === "string" && match.model.length > 0);
  if (!hasSelector) {
    errors.push({ severity: "error", code: "no_device_selector", subject: rec.id, message: `Recording "${rec.id}" has no device selector (serialPrefix or model); it would match nothing — or, worse, be treated as matching everything. Fail closed.` });
  }
  const triggers = rec.triggers ?? [];
  if (triggers.length === 0) {
    errors.push({ severity: "error", code: "no_trigger", subject: rec.id, message: `Recording "${rec.id}" declares no triggers; it can never fire.` });
  }
  for (const t of triggers) {
    if (!VALID_TRIGGERS.includes(t)) {
      errors.push({ severity: "error", code: "invalid_trigger", subject: rec.id, message: `Recording "${rec.id}" has an unrecognized trigger "${String(t)}".` });
    }
  }
  const steps = rec.steps ?? [];
  if (steps.length === 0) {
    errors.push({ severity: "error", code: "no_steps", subject: rec.id, message: `Recording "${rec.id}" has no steps; it would provision nothing.` });
  }
  const seenKeys = new Set<string>();
  const flaggedDup = new Set<string>();
  for (const s of steps) {
    if (typeof s.key !== "string" || s.key.length === 0) {
      errors.push({ severity: "error", code: "missing_step_key", subject: rec.id, message: `Recording "${rec.id}" has a step with a missing or empty key.` });
    } else if (seenKeys.has(s.key) && !flaggedDup.has(s.key)) {
      flaggedDup.add(s.key);
      errors.push({ severity: "error", code: "duplicate_step_key", subject: rec.id, message: `Recording "${rec.id}" has a duplicate step key "${s.key}".` });
    }
    if (typeof s.key === "string") seenKeys.add(s.key);
    if (!SETUP_STEP_KINDS.includes(s.kind)) {
      errors.push({ severity: "error", code: "invalid_step_kind", subject: rec.id, message: `Recording "${rec.id}" step "${s.key}" has an unrecognized kind "${String(s.kind)}"; expected one of ${SETUP_STEP_KINDS.join(", ")}.` });
    }
    // A non-boolean `sensitive` (from untyped JSON — e.g. the string "true", 1)
    // is an ERROR: a strict `=== true` check would read it as NOT sensitive and
    // auto-apply a step meant to require approval. Reject it at authoring so it
    // never reaches apply. Only an explicit boolean is allowed.
    if (s.sensitive !== undefined && typeof s.sensitive !== "boolean") {
      errors.push({ severity: "error", code: "invalid_sensitive_flag", subject: rec.id, message: `Recording "${rec.id}" step "${s.key}" has a non-boolean sensitive value "${String(s.sensitive)}"; expected true or false.` });
    } else if (s.sensitive === true) {
      warnings.push({ severity: "warning", code: "sensitive_step", subject: rec.id, message: `Recording "${rec.id}" step "${s.key}" is sensitive — it will require approval before any real apply.` });
    }
  }
  return [...errors, ...warnings];
}

/** True when a recording has zero ERROR-severity issues (warnings allowed). */
export function setupRecordingValid(rec: DeviceSetupRecording): boolean {
  return lintSetupRecording(rec).every((i) => i.severity !== "error");
}

// ── zero-touch apply plan (simulated by default) ────────────────────────────────

export interface ProvisioningDevice {
  serial: string;
  model?: string;
  onNetwork?: boolean;
}

export type ApplyMode = "simulated" | "enforced";
export type StepDisposition = "auto_apply" | "approval_required" | "held_simulated";

export interface StepPlan {
  key: string;
  label: string;
  kind: SetupStepKind;
  disposition: StepDisposition;
  reason: string;
}

export interface ProvisioningPlan {
  recordingId: string;
  deviceSerial: string;
  matched: boolean;
  mode: ApplyMode;
  steps: StepPlan[];
  /** How many steps would need an administrator approval before running for real. */
  requiresApproval: number;
  /** True only when at least one step would actually run (enforced + enabled + non-sensitive). */
  willApplyAnything: boolean;
  reason: string;
}

export interface PlanOptions {
  /** Requested mode. Defaults to "simulated". */
  mode?: ApplyMode;
  /** Owner master switch. Real enforcement happens ONLY when this is explicitly true. */
  enforcementEnabled?: boolean;
}

function deviceMatches(rec: DeviceSetupRecording, device: ProvisioningDevice): boolean {
  const m = rec.match ?? {};
  const hasSelector = (typeof m.serialPrefix === "string" && m.serialPrefix.length > 0) || (typeof m.model === "string" && m.model.length > 0);
  if (!hasSelector) return false; // fail closed — never match everything
  if (typeof m.serialPrefix === "string" && m.serialPrefix.length > 0) {
    if (typeof device.serial !== "string" || !device.serial.startsWith(m.serialPrefix)) return false;
  }
  if (typeof m.model === "string" && m.model.length > 0) {
    if (device.model !== m.model) return false;
  }
  return true;
}

/**
 * Plan a zero-touch setup for a device. Fail-safe throughout:
 *  - A device that does not match the recording's selector is NEVER touched
 *    (matched:false, zero steps applied).
 *  - An INVALID recording is never applied.
 *  - Real enforcement happens ONLY when `enforcementEnabled === true` AND
 *    `mode === "enforced"`. In every other case (the default) each step is
 *    `held_simulated` — described, not executed.
 *  - Even under real enforcement, a `sensitive` step is `approval_required`
 *    (never auto). Only a non-sensitive step under enabled+enforced auto-applies.
 */
export function planZeroTouchSetup(
  rec: DeviceSetupRecording,
  device: ProvisioningDevice,
  opts: PlanOptions = {},
): ProvisioningPlan {
  const mode: ApplyMode = opts.mode === "enforced" ? "enforced" : "simulated";
  const reallyEnforcing = mode === "enforced" && opts.enforcementEnabled === true;
  const base = { recordingId: rec.id, deviceSerial: device.serial, mode };

  if (!setupRecordingValid(rec)) {
    return { ...base, matched: false, steps: [], requiresApproval: 0, willApplyAnything: false, reason: `Recording "${rec.id}" is invalid — not applied.` };
  }
  if (!deviceMatches(rec, device)) {
    return { ...base, matched: false, steps: [], requiresApproval: 0, willApplyAnything: false, reason: `Device ${device.serial} does not match recording "${rec.id}" — not touched.` };
  }

  const steps: StepPlan[] = (rec.steps ?? []).map((s) => {
    if (!reallyEnforcing) {
      return { key: s.key, label: s.label, kind: s.kind, disposition: "held_simulated", reason: "Simulated — enforcement is off; step described, not executed." };
    }
    // Fail closed: any sensitive value that is not explicitly `false` (and not
    // absent) is treated as sensitive. `=== true` alone would let a mistyped
    // "true"/1 auto-apply; lint already rejects a non-boolean sensitive, so this
    // is defense-in-depth behind the validity gate.
    if (s.sensitive !== false && s.sensitive !== undefined) {
      return { key: s.key, label: s.label, kind: s.kind, disposition: "approval_required", reason: "Sensitive step — requires administrator approval before it runs." };
    }
    return { key: s.key, label: s.label, kind: s.kind, disposition: "auto_apply", reason: "Applied automatically by the Grid." };
  });

  const requiresApproval = steps.filter((s) => s.disposition === "approval_required").length;
  const willApplyAnything = steps.some((s) => s.disposition === "auto_apply");
  const reason = reallyEnforcing
    ? `Enforced: ${steps.filter((s) => s.disposition === "auto_apply").length} auto, ${requiresApproval} awaiting approval.`
    : `Matched — ${steps.length} steps planned, all simulated (enforcement off).`;
  return { ...base, matched: true, steps, requiresApproval, willApplyAnything, reason };
}
