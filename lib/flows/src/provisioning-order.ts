// Provisioning STEP ORDER — the part of a zero-touch setup that the diagrams
// encode and the model threw away.
//
// Every vendor's zero-touch poster is NUMBERED, and the numbering is load-bearing.
// Windows Autopilot: join the directory (3) before enrolling in Intune (4), before
// policy lands (5), before apps install (6). Apple ADE, Android Zero-Touch and Jamf
// PreStage all have the same shape with different nouns. Get the order wrong and
// nothing errors loudly — the app install simply no-ops against a device that is
// not managed yet, and the device reports "provisioned" while missing half its
// configuration.
//
// `lintSetupRecording` validated ids, selectors, triggers, duplicate keys, step
// kinds and the sensitive flag. It did NOT validate that the steps could run in the
// order written. A recording that installs an app before establishing management
// linted CLEAN, and the failure surfaced at first boot on a real device — in this
// product's case, a clinical cart at the start of a shift.
//
// This closes that: a recording whose order cannot work is INVALID, so
// `planZeroTouchSetup` (which refuses invalid recordings) will never carry it to a
// device. Caught at authoring and at merge, not in a ward.
//
// WHAT THIS IS NOT. SignalGrid cannot perform zero-touch provisioning itself and
// this file does not pretend otherwise — see the platform-honesty rule in
// CLAUDE.md. Unboxing a device and configuring it before anyone signs in requires
// the vendor's own enrollment program (Autopilot, ABM/ADE, Android Zero-Touch) on
// hardware registered to the organisation. No application can grant itself that.
// What is vendor-neutral here is the PLAN and its verification: one model that says
// whether a setup is expressible, correctly ordered and reversible, whichever
// pipeline actually executes it.
//
// Pure and deterministic. No device is contacted here.

import type { DeviceSetupRecording, SetupRecordingIssue, SetupStep, SetupStepKind } from "./provisioning";

/**
 * Kinds that ESTABLISH a management relationship with the device.
 *
 * Both are listed because which one comes first is VENDOR-SPECIFIC and this file
 * refuses to guess: Autopilot joins Entra (`account`) and then enrols in Intune
 * (`profile`); Apple ADE installs the enrollment profile first and the user account
 * arrives after. Pinning an order between them would encode one vendor's pipeline
 * as a universal law and reject the other. The rule below only needs to know that
 * management exists, not which noun created it.
 */
export const MANAGEMENT_ESTABLISHING_KINDS: readonly SetupStepKind[] = ["profile", "account"];

/**
 * Kinds that CANNOT take effect until management exists.
 *
 * This is the one intrinsic ordering fact that holds across every vendor: you
 * cannot push an app, a policy or a restriction to a device the management plane
 * does not yet own. Deliberately short — `wifi` and `cert` are NOT here, because
 * they frequently must come FIRST (the device needs the network and an identity to
 * reach the management plane at all), and a rule that forced them later would be
 * wrong in exactly the deployments that need them most.
 */
export const MANAGEMENT_DEPENDENT_KINDS: readonly SetupStepKind[] = [
  "app_install",
  "policy",
  "restriction",
];

/**
 * Does this step establish management?
 *
 * PRECISE WHEN THE AUTHOR IS PRECISE, heuristic otherwise. If any step in the
 * recording carries `establishesManagement`, only those count — the author has told
 * us exactly which step enrolls the device and the kind heuristic is switched off.
 *
 * THE HEURISTIC IS KNOWN-COARSE and adversarial review is why this note exists.
 * `kind: "profile"` covers an MDM enrollment profile and a VPN profile alike, so a
 * recording whose first profile is a VPN payload will satisfy the rule without
 * having enrolled anything — a FALSE NEGATIVE. It is kept as the default because
 * every existing recording relies on it and because rejecting them all would be a
 * worse failure than the one it misses, but a recording that cares should set the
 * flag. `lintSetupOrder` emits a warning naming this limit when it has to guess.
 */
const establishesManagement = (s: SetupStep, explicitMode: boolean): boolean =>
  explicitMode ? s.establishesManagement === true : MANAGEMENT_ESTABLISHING_KINDS.includes(s.kind);

const isManagementEstablishing = (k: SetupStepKind): boolean =>
  MANAGEMENT_ESTABLISHING_KINDS.includes(k);
const isManagementDependent = (k: SetupStepKind): boolean =>
  MANAGEMENT_DEPENDENT_KINDS.includes(k);

/**
 * Validate that a recording's steps can run in the order they are written.
 *
 * THE ARRAY IS THE EXECUTION ORDER — `planZeroTouchSetup` maps over `rec.steps` in
 * sequence — so "later in the array" means "runs later", and that is what makes
 * these checks decidable without a scheduler.
 *
 * Returns errors and warnings in the same shape `lintSetupRecording` uses, so the
 * two compose into one issue list rather than two competing reports.
 */
export function lintSetupOrder(rec: DeviceSetupRecording): SetupRecordingIssue[] {
  const errors: SetupRecordingIssue[] = [];
  const warnings: SetupRecordingIssue[] = [];
  const steps: SetupStep[] = rec.steps ?? [];

  // Position of each step key. Built from the FIRST occurrence: a duplicate key is
  // already an error in the base lint, and using the first keeps this check
  // deterministic instead of order-of-iteration dependent on top of a broken input.
  const positionOf = new Map<string, number>();
  steps.forEach((s, i) => {
    if (typeof s.key === "string" && s.key.length > 0 && !positionOf.has(s.key)) {
      positionOf.set(s.key, i);
    }
  });

  // ── Explicit, author-declared prerequisites ────────────────────────────────
  steps.forEach((s, i) => {
    const requires = s.requires;
    if (requires === undefined) return;
    if (!Array.isArray(requires)) {
      // A non-array `requires` from untyped JSON must not be silently ignored —
      // ignoring it would drop a declared dependency and let the step run early.
      errors.push({
        severity: "error",
        code: "invalid_requires",
        subject: rec.id,
        message: `Recording "${rec.id}" step "${s.key}" has a non-array requires value; expected a list of step keys.`,
      });
      return;
    }
    for (const dep of requires) {
      if (typeof dep !== "string" || dep.length === 0) {
        errors.push({
          severity: "error",
          code: "invalid_requires",
          subject: rec.id,
          message: `Recording "${rec.id}" step "${s.key}" requires a step key that is not a non-empty string.`,
        });
        continue;
      }
      if (dep === s.key) {
        errors.push({
          severity: "error",
          code: "self_requires",
          subject: rec.id,
          message: `Recording "${rec.id}" step "${s.key}" requires itself; it could never run.`,
        });
        continue;
      }
      const depAt = positionOf.get(dep);
      if (depAt === undefined) {
        errors.push({
          severity: "error",
          code: "unknown_requires",
          subject: rec.id,
          message: `Recording "${rec.id}" step "${s.key}" requires "${dep}", which is not a step in this recording. A prerequisite that does not exist can never be satisfied.`,
        });
        continue;
      }
      if (depAt >= i) {
        errors.push({
          severity: "error",
          code: "requires_later_step",
          subject: rec.id,
          message: `Recording "${rec.id}" step "${s.key}" requires "${dep}", which runs later (position ${depAt + 1} vs ${i + 1}). Reorder so a prerequisite precedes the step that needs it.`,
        });
      }
    }
  });

  // NOTE: THERE IS NO CYCLE DETECTOR, and its absence is deliberate rather than an
  // oversight. Because every prerequisite must point STRICTLY EARLIER in the array,
  // a cycle is unrepresentable — any cycle necessarily contains at least one edge
  // pointing forward, which `requires_later_step` already rejects with a message
  // naming both ends. A separate topological pass would be unreachable code that
  // looks like a safety net, and unreachable safety nets are how a reader comes to
  // believe a guarantee is checked twice when it is checked once.

  // ── The intrinsic rule: management before anything that needs management ────
  const explicitMode = steps.some((s) => s.establishesManagement === true);
  const firstManagementAt = steps.findIndex((s) => establishesManagement(s, explicitMode));
  if (!explicitMode && firstManagementAt !== -1 && steps[firstManagementAt]!.kind === "profile") {
    // Say out loud that this was a guess. A rule that silently guesses is how a
    // false negative reads as a clean bill of health.
    warnings.push({
      severity: "warning",
      code: "management_step_inferred",
      subject: rec.id,
      message: `Recording "${rec.id}" infers that "${steps[firstManagementAt]!.key}" establishes management because its kind is "profile". A VPN or configuration profile has the same kind and would satisfy the ordering rule without enrolling anything. Set establishesManagement: true on the real enrollment step to make this exact.`,
    });
  }
  const dependents = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => isManagementDependent(s.kind));

  if (firstManagementAt === -1) {
    // No management step at all. This is LEGITIMATE — a recording may target
    // devices that are already enrolled and simply add software. But it is an
    // assumption about the fleet that the author should be making knowingly, so it
    // is surfaced rather than either blocked or ignored.
    if (dependents.length > 0) {
      warnings.push({
        severity: "warning",
        code: "assumes_existing_management",
        subject: rec.id,
        message: `Recording "${rec.id}" applies ${dependents.length} management-dependent step(s) but establishes no management itself; it assumes matching devices are already enrolled. Valid for an add-on recording — confirm it is intended.`,
      });
    }
  } else {
    for (const { s, i } of dependents) {
      if (i < firstManagementAt) {
        errors.push({
          severity: "error",
          code: "step_before_management",
          subject: rec.id,
          message: `Recording "${rec.id}" step "${s.key}" (${s.kind}) runs at position ${i + 1}, before management is established at position ${firstManagementAt + 1} ("${steps[firstManagementAt]!.key}"). It would be sent to a device the management plane does not own yet, and would silently do nothing.`,
        });
      }
    }
  }

  return [...errors, ...warnings];
}

// ── Reference pipelines ───────────────────────────────────────────────────────
//
// WHAT THESE ARE, precisely: a demonstration that four different vendors' zero-touch
// pipelines are expressible in ONE neutral model and satisfy the same ordering
// rules. That is the claim worth testing — "no matter which solution you use" is an
// aspiration until something shows the model actually spans them.
//
// WHAT THESE ARE NOT: authoritative reproductions of each vendor's internal
// sequence. They capture the DEPENDENCY STRUCTURE each vendor's own documentation
// and setup UI make explicit — network and identity first, management next, then
// configuration, then software. Steps a given tenant adds or omits are not
// modelled, and the exact interleaving inside a phase is vendor- and
// version-specific. Treating these as a specification would be exactly the kind of
// over-claim the rest of this repository exists to avoid.
export const VENDOR_REFERENCE_PIPELINES: readonly DeviceSetupRecording[] = Object.freeze([
  {
    id: "ref_windows_autopilot_intune",
    name: "Windows Autopilot + Microsoft Intune",
    match: { serialPrefix: "WIN-" },
    triggers: ["first_boot", "serial_match"],
    steps: [
      { key: "network", label: "Network connection", kind: "wifi" },
      { key: "autopilot_profile", label: "Autopilot deployment profile (by hardware hash)", kind: "profile" },
      { key: "entra_join", label: "Microsoft Entra join", kind: "account", requires: ["autopilot_profile"] },
      { key: "intune_enroll", label: "Intune enrollment", kind: "profile", requires: ["entra_join"] },
      { key: "compliance", label: "Compliance + configuration policies", kind: "policy", requires: ["intune_enroll"] },
      { key: "bitlocker", label: "BitLocker / Defender / security baseline", kind: "restriction", requires: ["compliance"], sensitive: true },
      { key: "m365_apps", label: "Microsoft 365 apps + browser", kind: "app_install", requires: ["intune_enroll"] },
      { key: "onedrive_kfm", label: "OneDrive Known Folder Move", kind: "profile", requires: ["m365_apps"] },
    ],
  },
  {
    id: "ref_apple_ade_mdm",
    name: "Apple Business Manager (ADE) + MDM",
    match: { serialPrefix: "APL-" },
    triggers: ["first_boot", "serial_match"],
    steps: [
      { key: "network", label: "Network connection", kind: "wifi" },
      { key: "ade_profile", label: "ADE enrollment profile (supervised)", kind: "profile" },
      { key: "mdm_enroll", label: "MDM enrollment + supervision", kind: "profile", requires: ["ade_profile"] },
      { key: "scep", label: "SCEP / identity certificate", kind: "cert", requires: ["mdm_enroll"] },
      { key: "user_account", label: "Managed Apple Account binding", kind: "account", requires: ["mdm_enroll"] },
      { key: "declarations", label: "Declarative configuration + baseline", kind: "policy", requires: ["mdm_enroll"] },
      { key: "restrictions", label: "Restrictions payload", kind: "restriction", requires: ["declarations"], sensitive: true },
      { key: "vpp_apps", label: "Apps + Books (VPP) deployment", kind: "app_install", requires: ["mdm_enroll"] },
    ],
  },
  {
    id: "ref_android_zero_touch",
    name: "Android Zero-Touch + EMM",
    match: { serialPrefix: "AND-" },
    triggers: ["first_boot", "serial_match"],
    steps: [
      { key: "network", label: "Network connection", kind: "wifi" },
      { key: "zt_config", label: "Zero-touch configuration (by IMEI/serial)", kind: "profile" },
      { key: "device_owner", label: "Device Owner / work profile provisioning", kind: "profile", requires: ["zt_config"] },
      { key: "managed_account", label: "Managed Google Account", kind: "account", requires: ["device_owner"] },
      { key: "policies", label: "EMM policies", kind: "policy", requires: ["device_owner"] },
      { key: "kiosk", label: "Dedicated-device / kiosk lockdown", kind: "restriction", requires: ["policies"], sensitive: true },
      { key: "managed_play", label: "Managed Google Play apps", kind: "app_install", requires: ["managed_account"] },
    ],
  },
  {
    id: "ref_jamf_prestage",
    name: "Jamf Pro PreStage enrollment",
    match: { serialPrefix: "JMF-" },
    triggers: ["first_boot", "serial_match"],
    steps: [
      { key: "network", label: "Network connection", kind: "wifi" },
      { key: "prestage", label: "PreStage enrollment scope", kind: "profile" },
      { key: "jamf_enroll", label: "Jamf MDM enrollment", kind: "profile", requires: ["prestage"] },
      { key: "local_account", label: "Local / directory account creation", kind: "account", requires: ["jamf_enroll"] },
      { key: "config_profiles", label: "Configuration profiles", kind: "policy", requires: ["jamf_enroll"] },
      { key: "filevault", label: "FileVault + security settings", kind: "restriction", requires: ["config_profiles"], sensitive: true },
      { key: "policies_apps", label: "Policies / packages deployment", kind: "app_install", requires: ["jamf_enroll"] },
    ],
  },
]);
