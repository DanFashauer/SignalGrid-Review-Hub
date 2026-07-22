import {
  CORE_CONTROLS,
  type MacosPosture,
  type MacosPostureVerdict,
  type MacosReasonCode,
  type MacosRecommendedAction,
  type NormalizedMacosPosture,
} from "./types";

/**
 * Pure, deterministic macOS endpoint-posture evaluator. Folds a device's
 * normalized controls into ONE posture + the action it warrants — fail-safe, so
 * the STRONGEST concern wins and any control whose state could not be determined
 * RAISES the assurance bar rather than passing.
 *
 * The fail-safe ordering matters most here: a Mac whose report is entirely
 * unreadable (every control `unknown`) must resolve to `unverified` / step_up —
 * NEVER `hardened`. Unknown ≠ off, and unknown ≠ on.
 *
 * `covered=false` means no posture report reached the fabric for this device at
 * all → `unknown` (a blind spot), distinct from a covered device that reports all
 * controls on → `hardened`.
 */

// Unified-ladder ordering (none < monitor < step_up < alert < restrict <
// escalate). Used to pick the STRONGEST concern, so a disabled FileVault
// (restrict) is never diluted by a calmer patch-lag (monitor) — order-proof.
const ACTION_SEVERITY: Record<MacosRecommendedAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateMacosOptions {
  /** False when no posture report reached the fabric for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: MacosPosture;
  action: MacosRecommendedAction;
  reason: MacosReasonCode;
}

export function evaluateMacosPosture(
  posture: NormalizedMacosPosture,
  options: EvaluateMacosOptions = {},
): MacosPostureVerdict {
  const covered = options.covered ?? true;

  // Which core controls are explicitly OFF vs. merely undetermined.
  const controlsOff: string[] = [];
  const controlsUnknown: string[] = [];
  for (const c of CORE_CONTROLS) {
    const state = posture[c];
    if (state === "off") controlsOff.push(c);
    else if (state === "unknown") controlsUnknown.push(c);
  }
  // Enrollment and defs that could not be read are also fail-safe unknowns.
  if (posture.mdmEnrolled === null) controlsUnknown.push("mdm");
  if (posture.malwareDefs === "unknown") controlsUnknown.push("xprotect");
  if (posture.autoUpdate === "unknown") controlsUnknown.push("auto_update");

  const base = { controlsOff, controlsUnknown, mdmEnrolled: posture.mdmEnrolled, osVersion: posture.osVersion };

  // No report at all → unknown (blind spot). Fail-safe: this RAISES the bar to
  // step_up, the same as an unreadable report — never `monitor`, because
  // `monitor` composes to the "ok" tier (the hardened tier), which would make a
  // Mac we have ZERO data on read as fine. Less information must never yield less
  // concern.
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up" };
  }

  const candidates: Candidate[] = [];

  // A disabled endpoint-hardening control on a shared device — the strongest
  // concern. FileVault off = data-at-rest exposed; SIP/Gatekeeper off = integrity
  // and app-gating disabled; firewall off = network exposure.
  if (controlsOff.length > 0) {
    candidates.push({ posture: "weakened", action: "restrict", reason: "HARDENING_CONTROL_OFF" });
  }

  // Not under managed control — a shared clinical device must be managed.
  if (posture.mdmEnrolled === false) {
    candidates.push({ posture: "unmanaged", action: "step_up", reason: "DEVICE_UNMANAGED" });
  }

  // Any control state we could not verify raises the bar (fail-safe). This is the
  // silent-failure guard: a probe that could not run must not read as compliant.
  if (controlsUnknown.length > 0) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "HARDENING_STATE_UNKNOWN" });
  }

  // Auto-update explicitly disabled — the endpoint will drift out of patch currency.
  if (posture.autoUpdate === "off") {
    candidates.push({ posture: "patch_lagging", action: "monitor", reason: "AUTO_UPDATE_OFF" });
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "hardened", action: "none", reason: "FULLY_HARDENED" },
  );

  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action };
}
