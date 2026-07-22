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
import { setupRecordingValid } from "./provisioning";

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
    if (!TEARDOWN_ACTIONS.includes(t.action)) {
      errors.push({ severity: "error", code: "invalid_teardown_action", subject: id, message: `Recording "${id}" teardown step "${t.key}" has an unrecognized action "${String(t.action)}"; expected one of ${TEARDOWN_ACTIONS.join(", ")}.` });
    }
    if (t.sensitive !== undefined && typeof t.sensitive !== "boolean") {
      errors.push({ severity: "error", code: "invalid_teardown_sensitive_flag", subject: id, message: `Recording "${id}" teardown step "${t.key}" has a non-boolean sensitive value "${String(t.sensitive)}".` });
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
    if (!setup || !(setup.kind in TEARDOWN_ORDER)) continue;
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
  proven: boolean;
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
 * Plan a device decommission. Fail-safe, mirroring planZeroTouchSetup:
 *  - a recording whose teardown is NOT proven is never executed (proven:false);
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
  const base = { recordingId: typeof rec.id === "string" ? rec.id : "", deviceSerial: device.serial, mode, proven };

  if (!proven) {
    return { ...base, steps: [], requiresApproval: 0, willRemoveAnything: false, verifiesClean: false, reason: `Recording "${base.recordingId}" teardown is not proven — not executed. Rehearse and fix the reversal first.` };
  }

  const teardown = rec.teardown as TeardownPlanSpec; // proven ⇒ present & shaped
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
  return { ...base, steps, requiresApproval, willRemoveAnything, verifiesClean: teardown.verifyClean === true, reason };
}
