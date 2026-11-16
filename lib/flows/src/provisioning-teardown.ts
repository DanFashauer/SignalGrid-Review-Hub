// Teardown-proof — prove the retreat before you trust the deploy.
//
// Zero-touch provisioning (provisioning.ts) records a device setup once and
// replays it. But the hard, under-invested half of a rollout is taking the setup
// cleanly BACK OFF: on macOS an installed agent is several coupled parts — a
// system extension, a PPPC/TCC allow profile, launch daemons, an app bundle —
// that must come apart in the RIGHT ORDER. Delete the app and the extension can
// stay active. Remove the allow profile while the extension is live and you strand
// a "deactivated but not removed" extension that blocks its own reinstall.
//
// So this module makes a recording's REVERSAL a first-class, validated artifact:
// a setup is not "deploy-ready" until a dependency-ordered, fail-safe,
// approval-gated teardown plan is also recorded and proven — the belt-and-
// suspenders habit ("confirm the retreat path works before you need it, not while
// 560 Macs are waiting on you") expressed as code the pipeline enforces.
//
// Pure and deterministic. No device is contacted here.

import type { SetupStep, SetupStepKind, DeviceSetupRecording, ProvisioningDevice } from "./provisioning";
import { setupRecordingValid, deviceMatches } from "./provisioning";

/** What a teardown step does to reverse a setup step. */
export type TeardownAction = "deactivate" | "remove" | "unbind" | "revoke";

export const TEARDOWN_ACTIONS: readonly TeardownAction[] = ["deactivate", "remove", "unbind", "revoke"];

/** One reversal step. `key` MUST match the setup step it undoes. */
export interface TeardownStep {
  key: string;
  label: string;
  action: TeardownAction;
  /** True when the reversal only completes after a device restart (e.g. a system
   *  extension deactivation) — the plan then holds for a restart-state check. */
  requiresRestart?: boolean;
  /** Touches sensitive/regulated state — requires approval before any real removal. */
  sensitive?: boolean;
}

/** The recorded reversal of a setup, plus the mandatory clean-state check. */
export interface TeardownPlanSpec {
  steps: TeardownStep[];
  /** A final "no component still registered" verification. Required — the whole
   *  point is confirming nothing stayed behind (a leftover extension blocks
   *  reinstall). A teardown that never verifies is not proven. */
  verifyClean: boolean;
}

// Canonical teardown precedence by the KIND of the setup step being reversed
// (lower = torn down EARLIER). The authorization/allow `profile` must come LAST,
// and the agent/extension (`app_install`) must be deactivated FIRST — removing the
// allow profile while its extension is active is the classic stranding bug.
export const TEARDOWN_ORDER: Record<SetupStepKind, number> = {
  app_install: 0, // deactivate the agent + its system extension first
  restriction: 1,
  policy: 2,
  account: 3,
  cert: 4,
  wifi: 5,
  profile: 6, // the PPPC/TCC allow profile is removed last
};

/** Own-key membership with a finite order. A bare `kind in TEARDOWN_ORDER` walks the
 *  prototype chain: `"toString" in {}` is true and `TEARDOWN_ORDER.toString` is a
 *  function, so a masked kind passed the unknown-kind guard AND poisoned the ordering
 *  guard (`Math.max(prev, function)` is NaN, after which every later `order < NaN` is
 *  false) — `teardownProven` then reported true for a reversal that strands its
 *  extension. The API route guards the same class at control-plane.ts (`?serial=constructor`). */
function isKnownSetupKind(kind: unknown): kind is SetupStepKind {
  return typeof kind === "string" &&
    Object.prototype.hasOwnProperty.call(TEARDOWN_ORDER, kind) &&
    Number.isFinite(TEARDOWN_ORDER[kind as SetupStepKind]);
}

export interface TeardownIssue {
  severity: "error" | "warning";
  code: string;
  subject: string;
  message: string;
}

/**
 * Validate that a recording can be cleanly, safely reversed. Fail-safe: anything
 * that would strand a component or leave the reversal unproven is an ERROR (blocks
 * deploy-readiness); a restart requirement is surfaced as a WARNING. Errors first,
 * then warnings — deterministic order.
 *
 * Errors:
 *  - no teardown recorded at all;
 *  - a setup step with no matching reversal (it would be left behind);
 *  - a teardown step that reverses nothing (unmatched key);
 *  - the agent/extension (`app_install`) not `deactivate`d, or not marked
 *    requiresRestart — deleting an app without deactivating leaves the extension
 *    active;
 *  - steps out of dependency order (an authorization `profile` removed before a
 *    component it authorized — TEARDOWN_ORDER violated);
 *  - no clean-state verification (`verifyClean !== true`).
 */
export function lintTeardown(rec: DeviceSetupRecording): TeardownIssue[] {
  const errors: TeardownIssue[] = [];
  const warnings: TeardownIssue[] = [];
  const id = typeof rec.id === "string" && rec.id.length > 0 ? rec.id : "recording";

  const teardown = rec.teardown;
  if (!teardown || typeof teardown !== "object" || !Array.isArray(teardown.steps)) {
    errors.push({ severity: "error", code: "teardown_missing", subject: id, message: `Recording "${id}" has no recorded teardown — its setup cannot be proven reversible, so it is not deploy-ready.` });
    return errors;
  }

  const setupSteps: SetupStep[] = rec.steps ?? [];
  const setupByKey = new Map<string, SetupStep>();
  for (const s of setupSteps) if (typeof s.key === "string") setupByKey.set(s.key, s);
  const teardownKeys = new Set<string>();

  // Every setup step must be reversed.
  for (const s of setupSteps) {
    if (typeof s.key !== "string" || s.key.length === 0) continue; // setup lint owns this
    if (!teardown.steps.some((t) => t.key === s.key)) {
      errors.push({ severity: "error", code: "setup_step_unreversed", subject: id, message: `Recording "${id}" setup step "${s.key}" (${s.kind}) has no teardown — it would be left behind on decommission.` });
    }
  }

  // Each teardown step must reverse a real setup step, with a valid action; the
  // agent/extension reversal has extra fail-safe requirements.
  for (const t of teardown.steps) {
    if (typeof t.key !== "string" || t.key.length === 0) {
      errors.push({ severity: "error", code: "missing_teardown_key", subject: id, message: `Recording "${id}" has a teardown step with a missing or empty key.` });
      continue;
    }
    if (teardownKeys.has(t.key)) {
      errors.push({ severity: "error", code: "duplicate_teardown_key", subject: id, message: `Recording "${id}" has a duplicate teardown step key "${t.key}".` });
    }
    teardownKeys.add(t.key);
    const setup = setupByKey.get(t.key);
    if (!setup) {
      errors.push({ severity: "error", code: "teardown_step_unmatched", subject: id, message: `Recording "${id}" teardown step "${t.key}" reverses no setup step.` });
      continue;
    }
    // The reversed step's kind MUST be a recognized SetupStepKind — every
    // kind-specific fail-safe below (deactivate-not-delete, restart, dependency
    // order) keys off it, so an unknown/typo'd/masked kind must fail here rather
    // than silently skip those guarantees. Defense-in-depth behind setup lint,
    // which independently rejects such a recording.
    if (!isKnownSetupKind(setup.kind)) {
      errors.push({ severity: "error", code: "teardown_unknown_setup_kind", subject: id, message: `Recording "${id}" teardown step "${t.key}" reverses a setup step of unrecognized kind "${String(setup.kind)}"; its reversal cannot be proven safe.` });
    }
    if (!TEARDOWN_ACTIONS.includes(t.action)) {
      errors.push({ severity: "error", code: "invalid_teardown_action", subject: id, message: `Recording "${id}" teardown step "${t.key}" has an unrecognized action "${String(t.action)}"; expected one of ${TEARDOWN_ACTIONS.join(", ")}.` });
    }
    if (t.sensitive !== undefined && typeof t.sensitive !== "boolean") {
      errors.push({ severity: "error", code: "invalid_teardown_sensitive_flag", subject: id, message: `Recording "${id}" teardown step "${t.key}" has a non-boolean sensitive value "${String(t.sensitive)}".` });
    }
    // requiresRestart is strict-boolean too (symmetric with sensitive): a mistyped
    // "true"/1 must not silently drop the restart-state hold.
    if (t.requiresRestart !== undefined && typeof t.requiresRestart !== "boolean") {
      errors.push({ severity: "error", code: "invalid_teardown_restart_flag", subject: id, message: `Recording "${id}" teardown step "${t.key}" has a non-boolean requiresRestart value "${String(t.requiresRestart)}".` });
    }
    // The agent/extension: must be DEACTIVATED (not merely removed) and must
    // acknowledge the restart before the reversal is trusted complete.
    if (setup.kind === "app_install") {
      if (t.action !== "deactivate") {
        errors.push({ severity: "error", code: "extension_not_deactivated", subject: id, message: `Recording "${id}" teardown step "${t.key}" removes an agent/extension with action "${t.action}"; a system extension must be "deactivate"d first, or it stays active and blocks reinstall.` });
      }
      if (t.requiresRestart !== true) {
        errors.push({ severity: "error", code: "extension_restart_unacknowledged", subject: id, message: `Recording "${id}" teardown step "${t.key}" deactivates an extension but does not set requiresRestart; the deactivation only completes after a restart-state check.` });
      }
    }
    if (t.requiresRestart === true) {
      warnings.push({ severity: "warning", code: "restart_required", subject: id, message: `Recording "${id}" teardown step "${t.key}" requires a restart to complete — the plan holds for a restart-state check.` });
    }
  }

  // Dependency ordering: reversals must run in non-decreasing TEARDOWN_ORDER of
  // the KIND they reverse, so an authorization profile is never removed before a
  // component it authorized (which would strand that component).
  let prevOrder = -1;
  let prevKey = "";
  for (const t of teardown.steps) {
    const setup = setupByKey.get(t.key);
    if (!setup || !isKnownSetupKind(setup.kind)) continue;
    const order = TEARDOWN_ORDER[setup.kind];
    if (order < prevOrder) {
      errors.push({ severity: "error", code: "teardown_order_violation", subject: id, message: `Recording "${id}" teardown removes "${t.key}" (${setup.kind}) after "${prevKey}" — a ${setup.kind} must be torn down before that. Reverse-dependency order is required so nothing is stranded (e.g. deactivate the extension before removing its allow profile).` });
    }
    prevOrder = Math.max(prevOrder, order);
    prevKey = t.key;
  }

  // The reversal must prove it left nothing registered.
  if (teardown.verifyClean !== true) {
    errors.push({ severity: "error", code: "teardown_no_verify", subject: id, message: `Recording "${id}" teardown has no clean-state verification (verifyClean !== true); it cannot confirm no component stayed registered.` });
  }

  return [...errors, ...warnings];
}

/** True when a recording's reversal has zero ERROR-severity issues. */
export function teardownProven(rec: DeviceSetupRecording): boolean {
  return lintTeardown(rec).every((i) => i.severity !== "error");
}

/**
 * The thesis gate: a recording is DEPLOY-READY only when BOTH its setup is valid
 * AND its teardown is proven. Prove the retreat before you trust the deploy.
 */
export function deployReady(rec: DeviceSetupRecording): boolean {
  return setupRecordingValid(rec) && teardownProven(rec);
}

// ── simulated teardown plan (rehearse the rollback) ─────────────────────────────

export type TeardownMode = "simulated" | "enforced";
export type TeardownDisposition = "auto_remove" | "approval_required" | "held_simulated";

export interface TeardownStepPlan {
  key: string;
  label: string;
  action: TeardownAction;
  disposition: TeardownDisposition;
  requiresRestart: boolean;
  reason: string;
}

export interface TeardownPlan {
  recordingId: string;
  deviceSerial: string;
  /** The recording's teardown is proven safe (reversal validated). */
  proven: boolean;
  /** The recording is deploy-ready (setup valid AND teardown proven) AND this
   *  device matches the recording. Only a matched, deploy-ready plan can execute. */
  matched: boolean;
  mode: TeardownMode;
  steps: TeardownStepPlan[];
  requiresApproval: number;
  /** True only when at least one step would actually remove something for real. */
  willRemoveAnything: boolean;
  /** The mandatory post-teardown clean-state check will run. */
  verifiesClean: boolean;
  reason: string;
}

export interface TeardownPlanOptions {
  mode?: TeardownMode;
  /** Owner master switch. Real removal happens ONLY when this is explicitly true. */
  enforcementEnabled?: boolean;
}

/**
 * Plan a device decommission. Fail-safe, with the SAME gates as
 * planZeroTouchSetup — a real removal requires a valid, proven, matched recording:
 *  - a recording that is NOT deploy-ready (setup invalid OR teardown unproven) is
 *    never executed. This is the load-bearing gate: `teardownProven` alone is not
 *    enough, because its kind-specific guarantees (deactivate-not-delete, restart,
 *    order) key off a setup kind that a malformed recording could mask — so the
 *    executor gates on `deployReady`, never `teardownProven` in isolation;
 *  - a device that does not match the recording's selector is NEVER touched;
 *  - real removal happens ONLY when enforcementEnabled === true AND mode ===
 *    "enforced"; otherwise every step is held_simulated (a dry-run rehearsal);
 *  - even enforced, a sensitive removal is approval_required, never auto;
 *  - steps are emitted in the authored, dependency-ordered sequence.
 */
export function planTeardown(
  rec: DeviceSetupRecording,
  device: ProvisioningDevice,
  opts: TeardownPlanOptions = {},
): TeardownPlan {
  const mode: TeardownMode = opts.mode === "enforced" ? "enforced" : "simulated";
  const reallyEnforcing = mode === "enforced" && opts.enforcementEnabled === true;
  const proven = teardownProven(rec);
  const ready = deployReady(rec);
  const base = { recordingId: typeof rec.id === "string" ? rec.id : "", deviceSerial: device.serial, mode, proven };

  // Not deploy-ready (invalid setup OR unproven teardown) → never executed.
  if (!ready) {
    return { ...base, matched: false, steps: [], requiresApproval: 0, willRemoveAnything: false, verifiesClean: false, reason: `Recording "${base.recordingId}" is not deploy-ready (setup invalid or teardown unproven) — not executed. Rehearse and fix the reversal first.` };
  }
  // Device does not match the recording → never touched (same as apply).
  if (!deviceMatches(rec, device)) {
    return { ...base, matched: false, steps: [], requiresApproval: 0, willRemoveAnything: false, verifiesClean: false, reason: `Device ${device.serial} does not match recording "${base.recordingId}" — not touched.` };
  }

  const teardown = rec.teardown as TeardownPlanSpec; // deploy-ready ⇒ present & shaped
  const steps: TeardownStepPlan[] = teardown.steps.map((t) => {
    const requiresRestart = t.requiresRestart === true;
    if (!reallyEnforcing) {
      return { key: t.key, label: t.label, action: t.action, disposition: "held_simulated", requiresRestart, reason: "Simulated — enforcement is off; reversal described, not executed." };
    }
    // Fail closed: any sensitive value that is not explicitly false is treated as
    // sensitive (lint already rejects a non-boolean; defense-in-depth here).
    if (t.sensitive !== false && t.sensitive !== undefined) {
      return { key: t.key, label: t.label, action: t.action, disposition: "approval_required", requiresRestart, reason: "Sensitive removal — requires administrator approval before it runs." };
    }
    return { key: t.key, label: t.label, action: t.action, disposition: "auto_remove", requiresRestart, reason: "Removed automatically by the Grid, in dependency order." };
  });

  const requiresApproval = steps.filter((s) => s.disposition === "approval_required").length;
  const willRemoveAnything = steps.some((s) => s.disposition === "auto_remove");
  const reason = reallyEnforcing
    ? `Enforced decommission: ${steps.filter((s) => s.disposition === "auto_remove").length} auto, ${requiresApproval} awaiting approval, then a clean-state check.`
    : `Proven — ${steps.length} reversal steps rehearsed, all simulated (enforcement off), clean-state check included.`;
  return { ...base, matched: true, steps, requiresApproval, willRemoveAnything, verifiesClean: teardown.verifyClean === true, reason };
}
