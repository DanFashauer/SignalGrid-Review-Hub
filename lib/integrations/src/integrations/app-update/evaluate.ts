import {
  type AppUpdateAction,
  type AppUpdatePosture,
  type AppUpdateReasonCode,
  type AppUpdateVerdict,
  type NormalizedAppUpdate,
} from "./types";

/**
 * Pure, deterministic APP-UPDATE CURRENCY evaluator. Grades one device's installed
 * host app against the tenant's release manifest, fail-closed, on the fabric's
 * unified ladder (none < monitor < step_up < alert < restrict < escalate).
 *
 * Doctrine, matching the fleet-connector osFloor pattern:
 *  - **below the enforced floor** is the affirmative bad fact → `restrict`. The
 *    floor exists because builds below it are unsafe to run.
 *  - **behind latest with `force_update`** → `restrict` — that flag's one meaning
 *    is "older versions must not be used". Behind WITHOUT force is `monitor`:
 *    an advisory nudge, not fatigue. Behind with the flag UNREADABLE is `step_up` —
 *    we cannot confirm the lag is permitted.
 *  - **unmanaged install** (MDM affirmatively reports the app arrived outside the
 *    managed channel) → `restrict` — untrusted provenance on a frontline device.
 *    Channel UNKNOWN → `step_up`.
 *  - **currency unknown** (installed or latest missing/unparseable, or a manifest
 *    that contradicts itself) → `step_up`. Unknown raises, never lowers.
 *
 * The grant (`none`) requires POSITIVE CONFIRMATION: currency `current`, channel
 * `managed`, clean parse. The force flag does NOT gate the grant — a forced update
 * to a version the device already runs is satisfied by construction, so `current`
 * grants under any force-flag state. That is a reasoned exception to
 * "every-axis-positive", not an oversight; the proof pins it (exactly the three
 * current+managed+clean states grant).
 *
 * `covered=false` = no inventory row came back for this app → step_up — absence of
 * an inventory is never a confirmation of currency.
 */

const ACTION_SEVERITY: Record<AppUpdateAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateAppUpdateOptions {
  /** False when no inventory row was returned for this app. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: AppUpdatePosture;
  action: AppUpdateAction;
  reason: AppUpdateReasonCode;
}

export function evaluateAppUpdate(
  report: NormalizedAppUpdate,
  opts: EvaluateAppUpdateOptions = {},
): AppUpdateVerdict {
  const covered = opts.covered ?? true;
  const base = { deviceRef: report.deviceRef, appRef: report.appRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "version_unknown",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["coverage"],
      currencyConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];

  // Track the unknown axes for evidence (they also foreclose the grant below).
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.currency === "unknown") unknownSignals.push("currency");
  if (report.channel === "unknown") unknownSignals.push("channel");
  if (report.forcePolicy === "unknown" && report.currency === "behind") unknownSignals.push("force_policy");

  // Defence in depth: a report we could not fully parse is never a grant.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── currency ────────────────────────────────────────────────────────────────────
  if (report.currency === "below_floor") {
    criticalFindings.push("below_min_version");
    candidates.push({ posture: "below_floor", action: "restrict", reason: "BELOW_MIN_VERSION" });
  } else if (report.currency === "behind") {
    if (report.forcePolicy === "forced") {
      criticalFindings.push("forced_update_pending");
      candidates.push({ posture: "forced_update_pending", action: "restrict", reason: "FORCED_UPDATE_PENDING" });
    } else if (report.forcePolicy === "not_forced") {
      candidates.push({ posture: "update_available", action: "monitor", reason: "UPDATE_AVAILABLE" });
    } else {
      // Behind, and whether that lag is even permitted could not be read.
      candidates.push({ posture: "update_available", action: "step_up", reason: "FORCE_POLICY_UNKNOWN" });
    }
  } else if (report.currency === "unknown") { // inert: backstop is identical
    // Inert under mutation (allowlisted): the grant backstop below pushes the
    // IDENTICAL candidate; this stays as the primary, readable statement.
    candidates.push({ posture: "version_unknown", action: "step_up", reason: "VERSION_UNKNOWN" });
  }
  // currency === "current": no candidate — the seed grant may survive.

  // ── provenance ──────────────────────────────────────────────────────────────────
  if (report.channel === "unmanaged") {
    criticalFindings.push("unmanaged_install");
    candidates.push({ posture: "unmanaged_install", action: "restrict", reason: "UNMANAGED_INSTALL" });
  } else if (report.channel === "unknown") {
    candidates.push({ posture: "unmanaged_install", action: "step_up", reason: "CHANNEL_UNKNOWN" });
  }

  // Defence in depth: the grant is affirmative on currency, channel, and parse. The
  // branches above already push a raising candidate for every non-confirmed state, so
  // today this never fires — but if any branch were later weakened so a non-confirmed
  // state produced an empty candidate list, this backstop forces a step_up rather than
  // letting the seed grant survive. A grant must rest on positive confirmation, never
  // on "no branch happened to object".
  const positivelyCurrent =
    report.reportIntegrity === "clean" &&
    report.currency === "current" &&
    report.channel === "managed";
  if (!positivelyCurrent && candidates.length === 0) {
    candidates.push({ posture: "version_unknown", action: "step_up", reason: "VERSION_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired: current, managed,
  // clean. (The force flag is deliberately moot when current — see the doctrine above.)
  const seed: Candidate = { posture: "current_managed", action: "none", reason: "CURRENT_MANAGED" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    unknownSignals,
    currencyConfirmed: winner.action === "none",
  };
}
