import {
  type DeviceManagementHealthAction,
  type DeviceManagementHealthPosture,
  type DeviceManagementHealthReasonCode,
  type DeviceManagementHealthVerdict,
  type NormalizedDeviceManagementHealth,
} from "./types";

/**
 * Pure, deterministic management-health / config-drift evaluator. Folds "is this
 * shared device still under EFFECTIVE management, and is it on the baseline it was
 * assigned?" into ONE posture + the action it warrants, fail-safe.
 *
 * The distinction that matters is between a device that is COMPLIANT and one that is
 * merely LAST KNOWN to be compliant. A ward iPad that stopped checking in three weeks
 * ago reports its final posture forever; a device whose enrollment failed, or that was
 * retired in the MDM but never physically collected, looks fine in a posture snapshot
 * and is in fact ungoverned. This dimension is what makes the other device signals
 * mean something — without it, `macos-posture` and `intune-entra-posture` are reading
 * a cached answer with no expiry.
 *
 *  - a RETIRED or FAILED enrollment, or a device no compliance policy even covers,
 *    means the management plane is not actually governing it → RESTRICT (contain);
 *  - a DETECTED, UNREMEDIATED defect is a confirmed fact about the device rather
 *    than a gap in what we know → ALERT (but only from a report whose two channel
 *    fields agree — see the consistency guard below);
 *  - CONFIG DRIFT (applied config no longer matches the assigned baseline), a
 *    device that has NEVER checked in on either channel, one whose check-in has
 *    gone STALE on either channel, a remediation script that could not run, or a
 *    self-contradictory channel report → STEP_UP;
 *  - anything unreadable, the management plane unreachable, or a report we could not
 *    parse → STEP_UP (never trust silence);
 *  - the grant requires ALL SEVEN positively confirmed: fresh on the MDM channel,
 *    fresh (or confirmed absent) on the agent channel, remediation-healthy (or
 *    confirmed unassigned), on baseline, covered by a policy, enrolled, and the
 *    plane confirmed reachable. Worst-concern-wins.
 *
 * The two check-in channels are judged separately because they FAIL separately. One
 * sync in an Intune console drives the MDM channel (profiles, compliance, settings
 * catalog) and the agent channel (Win32 apps, scripts, Remediations) independently,
 * and the console's `lastSyncDateTime` only covers the first. A device fresh on MDM
 * whose agent last ran three weeks ago is reported healthy by the console while every
 * app install, script and remediation queued in that window has silently not
 * happened. Reading one number and calling it "checked in" is exactly the cached-answer
 * failure this dimension exists to stop, one layer further in.
 *
 * `covered=false` = no management result was returned for this device → unknown (a
 * gap), step_up.
 */

const ACTION_SEVERITY: Record<DeviceManagementHealthAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateDeviceManagementHealthOptions {
  /** False when no management result was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: DeviceManagementHealthPosture;
  action: DeviceManagementHealthAction;
  reason: DeviceManagementHealthReasonCode;
}

export function evaluateDeviceManagementHealth(
  health: NormalizedDeviceManagementHealth,
  options: EvaluateDeviceManagementHealthOptions = {},
): DeviceManagementHealthVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: health.deviceId };

  if (!covered) {
    return {
      ...base,
      posture: "unknown",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      managementEffective: false,
    };
  }

  const candidates: Candidate[] = [];

  // A report we could not fully parse is never a grant, independently of what its
  // fields normalized to. Defence in depth: the allow path must not rest on a value we
  // only think we understood.
  if (health.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // A report that contradicts itself is judged before anything derived from it, and
  // — decisively — nothing derived from the disbelieved half is judged AT ALL.
  //
  // The bridge cannot assert that the agent channel does not exist (or has never once
  // run) while also reporting a state only a run of that channel can produce. One of the
  // two is wrong and we do not know which, so neither is usable.
  //
  // The first draft of this guard raised its candidate and then went on to judge the
  // remediation fields anyway. That was wrong twice over. `issues_detected` alerts, and
  // `alert` outranks this `step_up`, so on a contradictory report the contradiction was
  // never the headline — the shipped comment claiming "the operator's next action is to
  // fix the bridge mapping, not the device" was false on every one of those reports.
  // Worse, the verdict then carried `remediation_issues_detected` in `criticalFindings`,
  // a field documented as CONFIRMED KNOWN-BAD FACTS, sourced from exactly the half of the
  // report it had just declared unbelievable. Measured over the raw wire space, 21,168
  // reports asserted a critical finding while flagging `channel_consistency`. A
  // dimension does not get to disbelieve a claim and cite it in the same breath.
  const channelReportInconsistent =
    (health.agentCheckInFreshness === "not_applicable" || health.agentCheckInFreshness === "never") &&
    (health.remediationHealth === "healthy" ||
      health.remediationHealth === "issues_detected" ||
      health.remediationHealth === "failed");
  if (channelReportInconsistent) {
    unknownSignals.push("channel_consistency");
    candidates.push({ posture: "unverified", action: "step_up", reason: "CHANNEL_REPORT_INCONSISTENT" });
  }

  // An explicit `false` is the management plane telling us it did NOT answer for this
  // device — a known-bad fact, not a gap, and it makes every other field in the report a
  // value the bridge is repeating rather than one the plane just confirmed. It is judged
  // here, near the top, for the same reason `issues_detected` outranks the unknowns.
  //
  // It was originally raised last, alongside the `null` case, and the cost was measured
  // rather than guessed: `MANAGEMENT_UNREACHABLE` was the headline on 9 of 1,037,232 raw
  // reports while 172,872 of them — one in six — carried an explicit
  // `managementReachable: false`. An asserted negative was losing the step_up tie to any
  // generic `MANAGEMENT_STATE_UNKNOWN` from a single unreadable field, which is the
  // opposite of what worst-concern-wins is for. The `null` case stays where it was: a
  // field the bridge never mentioned is a gap like any other.
  //
  // It does NOT contribute a `criticalFindings` entry. That field is documented as
  // confirmed known-bad facts about THIS DEVICE, and "the plane did not answer" is a
  // fact about the read, not about the iPad.
  if (health.managementReachable === false) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_UNREACHABLE" });
  }

  // MDM check-in freshness is judged next. Severity ordering is unaffected — the reduce
  // below picks by action rank, so the restricts still outrank everything here. What
  // this buys is the TIE: several conditions emit step_up, worst-concern-wins keeps the
  // first candidate on a tie, and a device that has gone silent is the root cause of
  // every softer reading downstream of it. "This device stopped reporting" is the more
  // useful headline than "its config drifted" — the drift reading is stale anyway.
  if (health.mdmCheckInFreshness === "never") {
    candidates.push({ posture: "stale_management", action: "step_up", reason: "MDM_CHECKIN_NEVER" });
  } else if (health.mdmCheckInFreshness === "stale") {
    candidates.push({ posture: "stale_management", action: "step_up", reason: "MDM_CHECKIN_STALE" });
  } else if (health.mdmCheckInFreshness === "unknown") {
    unknownSignals.push("mdm_check_in_freshness");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  // The agent channel, immediately after — same severity, lower in the tie order. When
  // BOTH channels are stale the MDM reading is the better headline (nothing at all is
  // reaching the device); when only the agent channel is stale, this is the only place
  // that says so, and the console will be showing a fresh device.
  //
  // `not_applicable` raises nothing: the bridge has positively asserted this platform
  // has no agent channel, so its workloads ride the MDM channel judged above. Silence is
  // NOT `not_applicable` — an unreported field normalizes to `unknown` and denies here.
  if (health.agentCheckInFreshness === "never") {
    candidates.push({ posture: "stale_agent_channel", action: "step_up", reason: "AGENT_CHECKIN_NEVER" });
  } else if (health.agentCheckInFreshness === "stale") {
    candidates.push({ posture: "stale_agent_channel", action: "step_up", reason: "AGENT_CHECKIN_STALE" });
  } else if (health.agentCheckInFreshness === "unknown") {
    unknownSignals.push("agent_check_in_freshness");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  // ── alert: a defect this device is CONFIRMED to have ──────────────────────────
  //
  // `issues_detected` outranks every step_up above, and that is deliberate. Those are
  // gaps in what we know; this is a detection script reporting that it looked and found
  // something, which was then not fixed. A stale check-in does not weaken that reading —
  // it makes the defect MORE likely to still be present, not less. `alert` composes to
  // the same `at_risk` tier as step_up, so the practical effect is on the reason the
  // operator is shown, not on whether the device is impeded.
  //
  // It is not a `restrict`: a Remediations pair is arbitrary customer script, so the
  // severity of what it detected is unknown to us. Containing every device with any
  // open detection would make the strongest action mean nothing.
  // Guarded by `!channelReportInconsistent`: when the report contradicts itself about the
  // agent channel, its remediation claim is not evidence of anything and is not judged.
  // `unknown` is outside the guard because it is not an agent-produced state — a bridge
  // that says "no agent channel" and "remediation state unreported" is silent, not
  // self-contradictory, and silence still denies on its own.
  if (health.remediationHealth === "unknown") {
    unknownSignals.push("remediation_health");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  } else if (!channelReportInconsistent) {
    if (health.remediationHealth === "issues_detected") {
      criticalFindings.push("remediation_issues_detected");
      candidates.push({ posture: "unremediated_defect", action: "alert", reason: "REMEDIATION_ISSUES_DETECTED" });
    } else if (health.remediationHealth === "failed") {
      // The script could not run — a broken delivery channel, not a known defect.
      candidates.push({ posture: "stale_agent_channel", action: "step_up", reason: "REMEDIATION_FAILED" });
    }
  }

  // ── restrict: the management plane is not actually governing this device ───────
  if (health.enrollmentState === "retired") {
    criticalFindings.push("enrollment_retired");
    candidates.push({ posture: "unenrolled_device", action: "restrict", reason: "ENROLLMENT_RETIRED" });
  } else if (health.enrollmentState === "failed") {
    // A STATUS IS NOT A DIAGNOSIS.
    //
    // The management portal reports the RESULT; the reason lives on the device. Both of
    // these used to emit `ENROLLMENT_FAILED`:
    //
    //   · the portal says failed and nobody has looked at anything
    //   · the log was collected and a certificate request rejection is the confirmed cause
    //
    // The ACTION is `restrict` either way and always was — so this changes no outcome and
    // fixes no fail-open hole. What it fixes is the CLAIM. Asserting a named failure
    // cause the connector cannot support is the same defect class as a gate reporting
    // success it did not earn, and it misroutes: which owner picks this up (PKI, app
    // packaging, network, identity) is precisely what the absent evidence would say.
    //
    // Only an explicit `available` earns the diagnosis. `unavailable`, `unknown` and
    // `not_supported` all fall to the honest form. `not_supported` is deliberately NOT
    // promoted: a source that structurally cannot explain itself still has not explained
    // itself, and letting "I can never tell you" read as "nothing more to find" is how
    // an absent check becomes a passed one.
    criticalFindings.push("enrollment_failed");
    if (health.rootCauseEvidence === "available") {
      candidates.push({ posture: "unenrolled_device", action: "restrict", reason: "ENROLLMENT_FAILED" });
    } else {
      unknownSignals.push("enrollment_root_cause");
      candidates.push({
        posture: "unenrolled_device",
        action: "restrict",
        reason: "ENROLLMENT_ROOT_CAUSE_UNVERIFIED",
      });
    }
  } else if (health.enrollmentState === "unknown") {
    unknownSignals.push("enrollment_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  if (health.complianceCoverage === "uncovered") {
    criticalFindings.push("compliance_uncovered");
    candidates.push({ posture: "unmanaged_device", action: "restrict", reason: "COMPLIANCE_UNCOVERED" });
  } else if (health.complianceCoverage === "unknown") {
    unknownSignals.push("compliance_coverage");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  // ── step_up: governed, but the configuration is drifting ──────────────────────
  if (health.policyDrift === "drifted") {
    candidates.push({ posture: "drifted_config", action: "step_up", reason: "POLICY_DRIFTED" });
  } else if (health.policyDrift === "unknown") {
    unknownSignals.push("policy_drift");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE confirmation that the management plane answered for this
  // device. Without an explicit true the read may be stale or cached. The explicit
  // `false` was already judged above as a known-bad fact; this is the UNREPORTED case —
  // a gap, so it is raised late among the step_ups, after every named diagnosis.
  if (health.managementReachable === null) {
    unknownSignals.push("management_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "MANAGEMENT_UNREACHABLE" });
  }

  // Worst-concern-wins. The seed survives only if NO candidate was raised — which is
  // exactly the seven-way positive confirmation.
  const seed: Candidate = { posture: "managed_healthy", action: "none", reason: "MANAGEMENT_HEALTHY" };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    managementEffective: winner.action === "none",
  };
}
