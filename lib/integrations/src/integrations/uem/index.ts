// UEM dimension — public surface and the live-call gate.
//
// This family was the ONLY connector family in the repo outside connector
// discipline: no fixture mode, no tier gate, no `SIGNALGRID_LIVE_INTEGRATIONS`
// check, no proof. `getUEMAdapter()` read credentials straight from the
// environment and constructed a live vendor client, in any tier, on any machine
// that happened to have the variables set. This file is the gate that was missing.

import { evaluateUem } from "./evaluate";
import { normalizeIntuneDevice } from "./intune";
import { normalizeJamfDevice } from "./jamf";
import { normalizeWorkspaceOneDevice } from "./workspace-one";
import type { NormalizedUemDeviceState, UemVendor, UemVerdict } from "./types";

export * from "./types";
export { evaluateUem } from "./evaluate";
export { normalizeIntuneDevice } from "./intune";
export { normalizeJamfDevice } from "./jamf";
export { normalizeWorkspaceOneDevice, WORKSPACE_ONE_READ_CONTRACT } from "./workspace-one";

/** A read transport. Deliberately NOT implemented in this repository — see
 *  `resolveUemConnector`. Callers in a real deployment inject their own. */
export interface UemReadTransport {
  readDevice(vendor: UemVendor, deviceId: string): Promise<unknown>;
}

export type UemConnectorResolution =
  | { readonly mode: "fixture"; readonly reason: string }
  | { readonly mode: "live"; readonly transport: UemReadTransport };

/**
 * Decide whether this deployment may make a live UEM read.
 *
 * FAIL-CLOSED AND UNANIMOUS: every condition must hold, and any one of them
 * failing returns fixture mode with the specific reason — an operator can tell
 * "wrong tier" from "missing credential" without reading this source.
 *
 * Note the transport must be INJECTED. This repository ships no live UEM
 * transport at all, so with no `transportOverride` the answer is fixture mode even
 * when every gate passes. That is deliberate: the repo is public and
 * fixture-backed, and a gate whose failure mode is "makes a real vendor call" is a
 * weaker guarantee than simply not having the code. The gate exists so a real
 * deployment has one place to satisfy, and so the boundary is testable here.
 */
export function resolveUemConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: UemReadTransport,
): UemConnectorResolution {
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const vendor = (env["UEM_VENDOR"] ?? "").trim().toLowerCase();
  if (vendor !== "intune" && vendor !== "jamf" && vendor !== "workspace-one") {
    return { mode: "fixture", reason: "UEM_VENDOR is not one of intune|jamf|workspace-one" };
  }
  if (!env["UEM_ACCESS_TOKEN"]?.trim()) {
    return { mode: "fixture", reason: "UEM_ACCESS_TOKEN is not set" };
  }
  if (!transportOverride) {
    return {
      mode: "fixture",
      reason: "no UEM read transport is available — this repository ships none",
    };
  }
  return { mode: "live", transport: transportOverride };
}

/** Normalize a raw vendor payload. The vendor is supplied by the caller rather
 *  than sniffed from the payload: guessing a vendor from field shapes would make
 *  provenance a heuristic, and provenance is exactly what `VENDOR_UNKNOWN` exists
 *  to protect. An unrecognised vendor yields a malformed report, never a guess. */
export function normalizeUemDevice(vendor: UemVendor, raw: unknown): NormalizedUemDeviceState {
  switch (vendor) {
    case "intune":
      return normalizeIntuneDevice((raw ?? {}) as Parameters<typeof normalizeIntuneDevice>[0]);
    case "jamf":
      return normalizeJamfDevice((raw ?? {}) as Parameters<typeof normalizeJamfDevice>[0]);
    case "workspace-one":
      return normalizeWorkspaceOneDevice(
        (raw ?? {}) as Parameters<typeof normalizeWorkspaceOneDevice>[0],
      );
    default:
      return {
        deviceId: "",
        vendor: "unknown",
        enrollment: "unknown",
        compliance: "unknown",
        supervision: "unknown",
        ownership: "unknown",
        osVersion: null,
        lastCheckInAgeSeconds: null,
        reportIntegrity: "malformed",
      };
  }
}

/** Fixture device states — the deterministic corpus the dimension runs on in this
 *  repository. One per vendor plus the states that used to be reported as healthy:
 *  a Jamf device with no compliance evaluation, a retiring Intune device, and an
 *  unattributable report. */
export const UEM_FIXTURES: Readonly<Record<string, NormalizedUemDeviceState>> = Object.freeze({
  "intune-healthy": {
    deviceId: "fixture-intune-1",
    vendor: "intune",
    enrollment: "enrolled",
    compliance: "compliant",
    supervision: "supervised",
    ownership: "corporate",
    osVersion: "17.5.1",
    lastCheckInAgeSeconds: 300,
    reportIntegrity: "intact",
  },
  "intune-retiring": {
    deviceId: "fixture-intune-2",
    vendor: "intune",
    enrollment: "retired",
    compliance: "compliant",
    supervision: "supervised",
    ownership: "corporate",
    osVersion: "17.5.1",
    lastCheckInAgeSeconds: 900,
    reportIntegrity: "intact",
  },
  "jamf-uneval": {
    deviceId: "fixture-jamf-1",
    vendor: "jamf",
    enrollment: "enrolled",
    compliance: "not_evaluated",
    supervision: "supervised",
    // Jamf reports no ownership field; see the note in jamf.ts.
    ownership: "unknown",
    osVersion: "14.6",
    lastCheckInAgeSeconds: 120,
    reportIntegrity: "intact",
  },
  "ws1-noncompliant": {
    deviceId: "fixture-ws1-1",
    vendor: "workspace-one",
    enrollment: "enrolled",
    compliance: "non_compliant",
    supervision: "unsupervised",
    // Workspace ONE `Ownership: "S"` — corporate-SHARED, this product's core case.
    ownership: "corporate",
    osVersion: "17.4",
    lastCheckInAgeSeconds: 60,
    reportIntegrity: "intact",
  },
  // THE BYOD CASE, and the reason the ownership axis exists. Enrolled, compliant,
  // and unsupervised — because an employee-owned device CANNOT be supervised. This
  // fixture GRANTS. Before the ownership axis it stepped up, on every decision,
  // forever, for a state with no remediation. If a future change makes this fixture
  // step up again, that change is a regression and this is where it shows.
  "intune-byod-personal": {
    deviceId: "fixture-intune-3",
    vendor: "intune",
    enrollment: "enrolled",
    compliance: "compliant",
    supervision: "unsupervised",
    ownership: "personal",
    osVersion: "18.1",
    lastCheckInAgeSeconds: 240,
    reportIntegrity: "intact",
  },
  // The same device with ownership unreadable — steps up, because we cannot tell
  // whether the missing supervision is expected. The pair is the whole point.
  "intune-unsupervised-owner-unknown": {
    deviceId: "fixture-intune-4",
    vendor: "intune",
    enrollment: "enrolled",
    compliance: "compliant",
    supervision: "unsupervised",
    ownership: "unknown",
    osVersion: "18.1",
    lastCheckInAgeSeconds: 240,
    reportIntegrity: "intact",
  },
  unattributable: {
    deviceId: "",
    vendor: "unknown",
    enrollment: "unknown",
    compliance: "unknown",
    supervision: "unknown",
    ownership: "unknown",
    osVersion: null,
    lastCheckInAgeSeconds: null,
    reportIntegrity: "malformed",
  },
});

/** Grade a fixture by name. Returns null for an unknown fixture rather than
 *  inventing one. */
export function evaluateUemFixture(name: string): UemVerdict | null {
  const fixture = UEM_FIXTURES[name];
  return fixture ? evaluateUem(fixture) : null;
}
