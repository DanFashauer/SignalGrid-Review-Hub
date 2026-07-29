// NAC family — public surface and the live-call gate.
//
// This family was flagged by `check-connector-discipline.mjs` as the one remaining
// WRITTEN-RULE violation: it performed a device action over the network (ISE ANC /
// ClearPass quarantine) with no gate and no proof. The actuators are gone; this file
// is the gate that was missing.
//
// Scope note, because it is easy to over-read what this family does: it resolves an
// endpoint IDENTITY for `deviceResolver`. Network posture as a decision input belongs
// to `../network-nac`.

import { normalizeIseEndpoint, iseFilterFor } from "./cisco-ise";
import { normalizeClearPassEndpoint, clearPassFilterFor } from "./aruba-clearpass";
import { validateNacIdentifier, type NacIdentifierType } from "./identifier";
import type { NACEndpointInfo } from "../adapters/types";

export * from "./store";
export * from "./identifier";
export {
  normalizeIseEndpoint,
  iseFilterFor,
  ISE_READ_CONTRACT,
  type IseEndpointSearchPayload,
} from "./cisco-ise";
export {
  normalizeClearPassEndpoint,
  clearPassFilterFor,
  clearPassStatus,
  CLEARPASS_READ_CONTRACT,
  type ClearPassEndpointPayload,
} from "./aruba-clearpass";

export type NacVendor = "ise" | "clearpass";

/** A read transport. Deliberately NOT implemented in this repository. */
export interface NacReadTransport {
  readEndpoint(vendor: NacVendor, filter: string): Promise<unknown>;
}

export type NacConnectorResolution =
  | { readonly mode: "fixture"; readonly reason: string }
  | { readonly mode: "live"; readonly transport: NacReadTransport };

/**
 * Decide whether this deployment may make a live NAC read.
 *
 * Fail-closed and unanimous: every condition must hold, and any one failing returns
 * fixture mode naming the specific cause. As with `uem/`, the transport must be
 * INJECTED and this repository ships none — so the gate's failure mode is "there is
 * no code", which is a stronger guarantee than a correctly-set flag.
 */
export function resolveNacConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: NacReadTransport,
): NacConnectorResolution {
  const tier = (env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env["SIGNALGRID_LIVE_INTEGRATIONS"] !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const vendor = (env["NAC_VENDOR"] ?? "").trim().toLowerCase();
  if (vendor !== "ise" && vendor !== "clearpass") {
    return { mode: "fixture", reason: "NAC_VENDOR is not one of ise|clearpass" };
  }
  if (!env["NAC_ACCESS_TOKEN"]?.trim()) {
    return { mode: "fixture", reason: "NAC_ACCESS_TOKEN is not set" };
  }
  if (!transportOverride) {
    return {
      mode: "fixture",
      reason: "no NAC read transport is available — this repository ships none",
    };
  }
  return { mode: "live", transport: transportOverride };
}

/** Build the vendor-specific query filter for a lookup, or null if the identifier is
 *  refused. Exported so a caller can see the refusal BEFORE attempting a read. */
export function nacFilterFor(
  vendor: NacVendor,
  identifier: unknown,
  type: NacIdentifierType,
): string | null {
  return vendor === "ise" ? iseFilterFor(identifier, type) : clearPassFilterFor(identifier, type);
}

/** Normalize a raw vendor endpoint payload. Vendor is supplied, never sniffed. */
export function normalizeNacEndpoint(
  vendor: NacVendor,
  raw: unknown,
  identifier: unknown,
  type: NacIdentifierType,
): NACEndpointInfo | null {
  return vendor === "ise"
    ? normalizeIseEndpoint((raw ?? {}) as Parameters<typeof normalizeIseEndpoint>[0], identifier, type)
    : normalizeClearPassEndpoint((raw ?? {}) as Parameters<typeof normalizeClearPassEndpoint>[0]);
}

/** Fixture endpoint records — the deterministic corpus this repository runs on. */
export const NAC_FIXTURES: Readonly<Record<string, NACEndpointInfo>> = Object.freeze({
  "ise-known": {
    endpointId: "fixture-ise-1",
    macAddress: "aa:bb:cc:dd:ee:01",
    name: "ward-cart-01",
    status: "unknown",
  },
  "clearpass-authenticated": {
    endpointId: "fixture-cp-1",
    macAddress: "aa:bb:cc:dd:ee:02",
    name: "handheld-02",
    status: "authenticated",
  },
  "clearpass-disconnected": {
    endpointId: "fixture-cp-2",
    macAddress: "aa:bb:cc:dd:ee:03",
    name: "handheld-03",
    status: "disconnected",
  },
});

/** Look up a fixture endpoint by identifier, applying the SAME validation a live read
 *  would. A refused identifier returns null here too, so fixture mode and live mode
 *  agree about what is a valid request. */
export function lookupNacFixture(identifier: unknown, type: NacIdentifierType): NACEndpointInfo | null {
  const v = validateNacIdentifier(identifier, type);
  if (!v.ok) return null;
  return (
    Object.values(NAC_FIXTURES).find(
      (f) => f.macAddress === v.normalized || f.serialNumber === v.normalized,
    ) ?? null
  );
}
