import type { ReachabilityVerdict } from "@workspace/integrations/carrier";
import type { LocationVerdict } from "@workspace/integrations/location-services";
import type { VulnVerdict } from "@workspace/integrations/vuln-scan";
import type { GraphPostureSignal } from "@workspace/integrations/graph";
import type { Detection } from "@workspace/event-contract";
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

/** Cross-domain detection severity → unified action. */
export function fromDetection(d: Detection): ComposableSignal {
  const action: UnifiedAction =
    d.severity === "critical" ? "escalate" : d.severity === "high" ? "restrict" : d.severity === "medium" ? "alert" : "monitor";
  return { kind: "detection", posture: d.code, action, reason: d.reason };
}

/**
 * Device posture (Graph/MDM) → unified action. Fail-safe: a disabled identity is
 * the strongest concern, then non-compliant, then unmanaged/missing posture, then
 * a high-risk user; a compliant managed device contributes nothing.
 */
export function fromDevicePosture(s: GraphPostureSignal): ComposableSignal {
  let action: UnifiedAction = "none";
  let reason = "COMPLIANT_MANAGED";

  if (s.userRisk === "high") {
    action = "alert";
    reason = "USER_RISK_HIGH";
  }
  if (s.deviceManagementState === "unmanaged" || s.deviceComplianceState === "missing") {
    action = "step_up";
    reason = s.deviceManagementState === "unmanaged" ? "DEVICE_UNMANAGED" : "COMPLIANCE_MISSING";
  }
  if (s.deviceComplianceState === "non_compliant") {
    action = "restrict";
    reason = "DEVICE_NON_COMPLIANT";
  }
  if (s.identityStatus === "disabled") {
    action = "escalate";
    reason = "IDENTITY_DISABLED";
  }

  const posture =
    action === "none" ? "compliant" : action === "escalate" ? "identity_blocked" : action === "restrict" ? "non_compliant" : "degraded";
  return { kind: "device_posture", posture, action, reason };
}
