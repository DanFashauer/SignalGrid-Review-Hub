// @workspace/iac — public-safe demo fixtures.
//
// A small declared desired-state and an observed fleet-state chosen so the
// plan and drift surfaces exercise every case: in_sync, drifted (a changed
// field), missing (declared but absent), and unmanaged (present but undeclared).
// Deterministic and generic — no real tenant, endpoint, or vendor data.

import type { DesiredState, ObservedState } from "./types";

/** The version-controlled desired state (what a Fleet-GitOps / Terraform repo
 *  would declare, compiled to flat specs). */
export const DEMO_DESIRED_STATE: DesiredState = {
  resources: [
    {
      kind: "enrollment_profile",
      id: "shared-ipad-kiosk",
      spec: { supervised: "true", removable: "false", asamPermitted: "true" },
    },
    {
      kind: "compliance_policy",
      id: "baseline-frontline",
      spec: { diskEncryption: "required", screenLock: "required", osFloor: "17.0" },
      sensitive: true,
    },
    {
      kind: "config_profile",
      id: "wifi-corp",
      spec: { ssid: "corp-secure", security: "wpa2-enterprise" },
    },
    {
      kind: "software_package",
      id: "host-emr",
      spec: { version: "4.2.0", autoUpdate: "true" },
    },
    {
      kind: "decision_policy",
      id: "gate-frontline",
      spec: { unknownSignal: "raise_step_up", stalePosture: "restrict" },
      sensitive: true,
    },
  ],
};

/** The observed fleet state, deliberately divergent:
 *  - shared-ipad-kiosk: matches (in_sync)
 *  - baseline-frontline: osFloor drifted 17.0 → 16.0 (drifted)
 *  - wifi-corp: matches (in_sync)
 *  - host-emr: declared but not present (missing)
 *  - legacy-mdm-restriction: present but not declared (unmanaged) */
export const DEMO_OBSERVED_STATE: ObservedState = {
  resources: [
    {
      kind: "enrollment_profile",
      id: "shared-ipad-kiosk",
      spec: { supervised: "true", removable: "false", asamPermitted: "true" },
    },
    {
      kind: "compliance_policy",
      id: "baseline-frontline",
      spec: { diskEncryption: "required", screenLock: "required", osFloor: "16.0" },
    },
    {
      kind: "config_profile",
      id: "wifi-corp",
      spec: { ssid: "corp-secure", security: "wpa2-enterprise" },
    },
    {
      kind: "config_profile",
      id: "legacy-mdm-restriction",
      spec: { disableAppStore: "true" },
    },
  ],
};
