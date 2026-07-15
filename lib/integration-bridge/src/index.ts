// @workspace/integration-bridge — maps real-world integration signals (from
// @workspace/integrations) into the deterministic core's normalized signal
// vocabulary (@workspace/signalgrid-core), so a live MDM/EDR posture read can
// feed an ALLOW/STEP-UP/RESTRICT/DENY decision. Pure and deterministic: it does
// no I/O — the caller fetches the posture and wraps these drafts into full
// NormalizedSignals (adding tenant/connector/subject/id).
import type { NormalizedSignal, SignalCategory, Freshness } from "@workspace/signalgrid-core";
import type { telemetryTypes } from "@workspace/integrations";

export interface PostureSignalDraft {
  category: SignalCategory;
  value: NormalizedSignal["value"];
  observedAt: string;
}

const FRESH_HOURS = 24;
const STALE_HOURS = 72;

/** Map a FleetDM (osquery) posture read into core posture signals. */
export function fleetDMToPostureDrafts(
  posture: telemetryTypes.FleetDMPostureSignal,
): PostureSignalDraft[] {
  const observedAt = posture.lastCheckAt;
  const drafts: PostureSignalDraft[] = [
    {
      category: "device_compliance",
      value: posture.compliant ? "compliant" : "non_compliant",
      observedAt,
    },
    { category: "device_management", value: true, observedAt },
  ];
  // All FleetDM policies passing → aligned security baseline; any failing → drifted.
  if (posture.policies.length > 0) {
    const allPass = posture.policies.every((p) => p.response === "pass");
    drafts.push({
      category: "security_baseline",
      value: allPass ? "aligned" : "drifted",
      observedAt,
    });
  }
  return drafts;
}

/** Classify the freshness of a FleetDM posture read against a reference time. */
export function fleetDMFreshness(
  posture: telemetryTypes.FleetDMPostureSignal,
  nowIso: string,
): Freshness {
  const ageMs = Date.parse(nowIso) - Date.parse(posture.lastCheckAt);
  if (Number.isNaN(ageMs)) return "unknown";
  const ageHours = ageMs / 3_600_000;
  if (ageHours <= FRESH_HOURS) return "fresh";
  if (ageHours <= STALE_HOURS) return "stale";
  return "expired";
}
