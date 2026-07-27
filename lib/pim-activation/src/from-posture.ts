import type { UnifiedPosture } from "@workspace/posture-composition";
import type { DeviceRiskTier } from "./types";

/**
 * Bridge the fused grid verdict into the PIM activation input.
 *
 * This exists because the PIM decision takes `deviceRiskTier` as a plain field, and a
 * field is only as trustworthy as whatever sets it. Without this function a caller
 * would hand-write `"ok"` and the entire claim — "SignalGrid refuses elevation on a
 * device the grid has blocked" — would rest on nothing.
 *
 * The one substantive rule is the empty case. `composeDeviceRisk([])` reports
 * `riskTier: "ok"` with `signalCount: 0`, and it is right to: nothing is known to be
 * wrong. But "nothing is known to be wrong" is not "confirmed healthy", and an
 * automatic privileged elevation must rest on the second. A grid that returned no
 * signals at all — every connector unreachable, the device not yet onboarded, a
 * misrouted device id — would otherwise look identical to a device that reported clean
 * across the board. So an empty posture maps to `unknown`, which routes the activation
 * to the approver group rather than auto-approving it.
 */
export function deviceRiskTierFromPosture(posture: UnifiedPosture): DeviceRiskTier {
  if (posture.signalCount <= 0) return "unknown";
  return posture.riskTier;
}
