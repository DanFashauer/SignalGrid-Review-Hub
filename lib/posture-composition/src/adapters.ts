import type { ReachabilityVerdict } from "@workspace/integrations/carrier";
import type { LocationVerdict } from "@workspace/integrations/location-services";
import type { VulnVerdict } from "@workspace/integrations/vuln-scan";
import type { NetworkVerdict } from "@workspace/integrations/network-nac";
import type { ThreatVerdict } from "@workspace/integrations/edr-threat";
import type { IdentityRiskVerdict } from "@workspace/integrations/identity-risk";
import type { GraphPostureSignal } from "@workspace/integrations/graph";
import type { Detection } from "@workspace/event-contract";
import { ACTION_RANK } from "./compose";
import type { ComposableSignal, UnifiedAction } from "./types";

/**
 * Adapters that map each dimension's native verdict onto the ONE unified action
 * ladder, so `composeDeviceRisk` can fuse them. Each dimension's action set is a
 * subset of the unified ladder; these adapters keep that mapping in one place and
 * are pure.
 */

export function fromReachability(v: ReachabilityVerdict): ComposableSignal {
  // Reachability actions are already on the unified ladder.
  return { kind: "reachability", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromLocation(v: LocationVerdict): ComposableSignal {
  return { kind: "location", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromVuln(v: VulnVerdict): ComposableSignal {
  return { kind: "vulnerability", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromNetwork(v: NetworkVerdict): ComposableSignal {
  // Network/NAC actions (none|monitor|step_up|restrict) are already on the ladder.
  return { kind: "network", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromThreat(v: ThreatVerdict): ComposableSignal {
  // EDR/EPP threat actions (none|monitor|step_up|alert|restrict|escalate) are
  // already on the unified ladder.
  return { kind: "threat", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

export function fromIdentityRisk(v: IdentityRiskVerdict): ComposableSignal {
  // Identity / SSO sign-in-risk actions (none|monitor|step_up|alert|restrict|
  // escalate) are already on the unified ladder.
  return { kind: "identity", posture: v.posture, action: v.recommendedAction as UnifiedAction, reason: v.reasonCode };
}

/** Cross-domain detection severity → unified action. */
export function fromDetection(d: Detection): ComposableSignal {
  const action: UnifiedAction =
    d.severity === "critical" ? "escalate" : d.severity === "high" ? "restrict" : d.severity === "medium" ? "alert" : "monitor";
  return { kind: "detection", posture: d.code, action, reason: d.reason };
}

/**
 * Device posture (Graph/MDM) → unified action. Fail-safe and ORDER-PROOF: every
 * matching condition contributes a candidate action, and the STRONGEST (highest
 * rank on the unified ladder) wins — so a severe concern is never diluted by a
 * calmer one that happens to be checked later. A compliant managed device with no
 * risk factors contributes nothing (`none`). Ranks: escalate > restrict > alert >
 * step_up, so e.g. a high-risk user (alert) on an unmanaged device (step_up)
 * composes to `alert`, and any non-compliant/disabled state outranks both.
 */
export function fromDevicePosture(s: GraphPostureSignal): ComposableSignal {
  const candidates: Array<{ action: UnifiedAction; reason: string }> = [];
  if (s.identityStatus === "disabled") candidates.push({ action: "escalate", reason: "IDENTITY_DISABLED" });
  if (s.deviceComplianceState === "non_compliant") candidates.push({ action: "restrict", reason: "DEVICE_NON_COMPLIANT" });
  if (s.userRisk === "high") candidates.push({ action: "alert", reason: "USER_RISK_HIGH" });
  if (s.deviceManagementState === "unmanaged") candidates.push({ action: "step_up", reason: "DEVICE_UNMANAGED" });
  if (s.deviceComplianceState === "missing") candidates.push({ action: "step_up", reason: "COMPLIANCE_MISSING" });

  const winner = candidates.reduce<{ action: UnifiedAction; reason: string }>(
    (max, c) => (ACTION_RANK[c.action] > ACTION_RANK[max.action] ? c : max),
    { action: "none", reason: "COMPLIANT_MANAGED" },
  );

  const posture =
    winner.action === "none"
      ? "compliant"
      : winner.action === "escalate"
        ? "identity_blocked"
        : winner.action === "restrict"
          ? "non_compliant"
          : "degraded";
  return { kind: "device_posture", posture, action: winner.action, reason: winner.reason };
}
