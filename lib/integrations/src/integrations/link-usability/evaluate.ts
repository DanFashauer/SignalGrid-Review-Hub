import {
  type LinkUsabilityAction,
  type LinkUsabilityPosture,
  type LinkUsabilityReasonCode,
  type LinkUsabilityVerdict,
  type NormalizedLinkUsability,
} from "./types";

/**
 * Pure, deterministic link-usability evaluator. Folds "is the link this device is
 * sitting on actually carrying traffic?" into ONE posture + the action it warrants,
 * fail-safe.
 *
 * `network-nac` answers the question at the point of connection — was this device
 * admitted, on which segment, under which NAC policy. This dimension starts after
 * admission and asks the only question that makes that answer worth anything a second
 * later. The two do not overlap on purpose: authentication and segmentation stay with
 * `network-nac`, so one fact never produces two verdicts.
 *
 *  - a link that is ASSOCIATED while the bridge affirmatively reports nothing got
 *    through, or that is failing at DHCP or DNS → ALERT. These are confirmed facts
 *    about the link, not gaps in what we know;
 *  - NOT ASSOCIATED, a STICKY or FLAPPING client, DEGRADED latency, a controller that
 *    did not answer, a self-contradictory report, or anything unreadable → STEP_UP;
 *  - the grant requires all six positively confirmed: associated, carrying traffic,
 *    roam behaviour stable (or confirmed absent), roam capability reported, latency
 *    nominal, and the controller confirmed reachable. Worst-concern-wins.
 *
 * The severity inversion is the point, and it is deliberate: `associated_only` outranks
 * `not_associated`. A device that is plainly offline is HONEST — the fabric can see it
 * and every other dimension's freshness claim is obviously suspect. A device that
 * reports connected while nothing gets through is the dangerous one, because it keeps
 * manufacturing fresh-looking confirmations for everything downstream. Grading the
 * quiet failure above the loud one is what this dimension is for.
 *
 * `covered=false` = no link result was returned for this device → unknown (a gap),
 * step_up.
 */

const ACTION_SEVERITY: Record<LinkUsabilityAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateLinkUsabilityOptions {
  /** False when no link result was returned for this device. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: LinkUsabilityPosture;
  action: LinkUsabilityAction;
  reason: LinkUsabilityReasonCode;
}

export function evaluateLinkUsability(
  link: NormalizedLinkUsability,
  options: EvaluateLinkUsabilityOptions = {},
): LinkUsabilityVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, deviceId: link.deviceId };

  if (!covered) {
    return {
      ...base,
      posture: "unknown",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      linkUsable: false,
    };
  }

  const candidates: Candidate[] = [];

  // A report we could not fully parse is never a grant, independently of what its fields
  // normalized to. Defence in depth: the allow path must not rest on a value we only
  // think we understood.
  if (link.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // A report that contradicts itself is judged before anything derived from it, and —
  // as in `device-management-health`, where this lesson was paid for — the disbelieved
  // half is then NOT JUDGED AT ALL. A dimension does not get to disbelieve a claim and
  // cite it in the same breath.
  //
  // Two ways the two fields can disagree, and both are the bridge's error rather than
  // the device's: a device reported NOT associated cannot simultaneously have reached a
  // rung above association, and a device reported associated cannot be at the
  // `not_associated` rung.
  const linkReportInconsistent =
    (link.associationState === "not_associated" &&
      (link.linkProgress === "carrying_traffic" ||
        link.linkProgress === "dns_failing" ||
        link.linkProgress === "dhcp_failing" ||
        link.linkProgress === "associated_only")) ||
    (link.associationState === "associated" && link.linkProgress === "not_associated");
  if (linkReportInconsistent) {
    unknownSignals.push("link_report_consistency");
    candidates.push({ posture: "unverified", action: "step_up", reason: "LINK_REPORT_INCONSISTENT" });
  }

  // An explicit `false` is the controller saying it did NOT answer for this device — a
  // known-bad fact, not a gap, and it makes every other field a value the bridge is
  // repeating rather than one the controller just confirmed. Judged high for the same
  // reason the affirmative failures below are: an asserted negative must not lose a
  // step_up tie to a generic unknown from one unreadable field.
  if (link.controllerReachable === false) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "CONTROLLER_UNREACHABLE" });
  }

  // ── alert: the link is CONFIRMED not carrying traffic ─────────────────────────
  //
  // Guarded on consistency: when association and progress disagree, the progress claim
  // is not evidence of anything.
  if (!linkReportInconsistent) {
    if (link.linkProgress === "associated_only") {
      // The headline. The client shows connected, the console shows connected, and the
      // bridge is affirmatively reporting that no rung above association completed.
      criticalFindings.push("associated_but_not_carrying_traffic");
      candidates.push({
        posture: "associated_not_usable",
        action: "alert",
        reason: "ASSOCIATED_BUT_NOT_CARRYING_TRAFFIC",
      });
    } else if (link.linkProgress === "dns_failing") {
      criticalFindings.push("dns_failing");
      candidates.push({ posture: "associated_not_usable", action: "alert", reason: "DNS_FAILING" });
    } else if (link.linkProgress === "dhcp_failing") {
      criticalFindings.push("dhcp_failing");
      candidates.push({ posture: "associated_not_usable", action: "alert", reason: "DHCP_FAILING" });
    } else if (link.linkProgress === "not_associated") {
      // Honest, and therefore graded BELOW the quiet failures above.
      candidates.push({ posture: "link_absent", action: "step_up", reason: "NOT_ASSOCIATED" });
    }
  }
  if (link.linkProgress === "unknown") {
    unknownSignals.push("link_progress");
    candidates.push({ posture: "unverified", action: "step_up", reason: "LINK_STATE_UNKNOWN" });
  }

  // Association state itself, for the case where the progress ladder is silent while
  // association is affirmatively reported absent. Also guarded on consistency — this
  // field is one HALF of the disagreement, so citing it on a contradictory report would
  // be picking a side we have no basis to pick. The `!== "not_associated"` clause stops
  // a device reported absent on both fields from raising the same finding twice.
  if (
    !linkReportInconsistent &&
    link.associationState === "not_associated" &&
    link.linkProgress !== "not_associated"
  ) {
    candidates.push({ posture: "link_absent", action: "step_up", reason: "NOT_ASSOCIATED" });
  } else if (link.associationState === "unknown") {
    unknownSignals.push("association_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "LINK_STATE_UNKNOWN" });
  }

  // ── step_up: the link works now but is behaving in a way that predicts it will not ──
  if (link.roamHealth === "sticky") {
    candidates.push({ posture: "roaming_unstable", action: "step_up", reason: "ROAM_STICKY" });
  } else if (link.roamHealth === "excessive") {
    candidates.push({ posture: "roaming_unstable", action: "step_up", reason: "ROAM_EXCESSIVE" });
  } else if (link.roamHealth === "unknown") {
    unknownSignals.push("roam_health");
    candidates.push({ posture: "unverified", action: "step_up", reason: "LINK_STATE_UNKNOWN" });
  }

  if (link.linkLatencyClass === "degraded") {
    candidates.push({ posture: "degraded_link", action: "step_up", reason: "LINK_LATENCY_DEGRADED" });
  } else if (link.linkLatencyClass === "unknown") {
    unknownSignals.push("link_latency_class");
    candidates.push({ posture: "unverified", action: "step_up", reason: "LINK_STATE_UNKNOWN" });
  }

  // Roam CAPABILITY is not graded as a defect — `basic` roaming is not broken, and a
  // dimension that penalised every fleet without 802.11r would be reporting an
  // architecture preference as a risk. But it must be REPORTED: a field we could not
  // read means we did not fully understand the report, and unknown denies here as
  // everywhere else.
  if (link.roamCapability === "unknown") {
    unknownSignals.push("roam_capability");
    candidates.push({ posture: "unverified", action: "step_up", reason: "LINK_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE confirmation the controller answered for THIS device.
  // The explicit `false` was already judged above as a known-bad fact; this is the
  // UNREPORTED case — a gap, so it is raised late, after every named diagnosis.
  if (link.controllerReachable === null) {
    unknownSignals.push("controller_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "CONTROLLER_UNREACHABLE" });
  }

  // Worst-concern-wins. The seed survives only if NO candidate was raised — which is
  // exactly the six-way positive confirmation.
  const seed: Candidate = {
    posture: "link_carrying_traffic",
    action: "none",
    reason: "LINK_CARRYING_TRAFFIC",
  };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    linkUsable: winner.action === "none",
  };
}
