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

/**
 * Normalize a raw vendor endpoint payload. Vendor is supplied, never sniffed.
 *
 * TAKES NO IDENTIFIER. It used to accept the caller's `identifier` and `type` and hand
 * them to the ISE normalizer, which wrote them into the returned record's identity
 * fields — echoing the question back as the vendor's answer. ClearPass never used them
 * and ISE no longer does, so the parameters are removed rather than left dead: a
 * normalizer that cannot see the query cannot fabricate from it.
 */
export function normalizeNacEndpoint(vendor: NacVendor, raw: unknown): NACEndpointInfo | null {
  return vendor === "ise"
    ? normalizeIseEndpoint((raw ?? {}) as Parameters<typeof normalizeIseEndpoint>[0])
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
  /** Serial-keyed, so the per-kind lookup has a non-vacuous `serial` branch. Without
   *  this the "cert must not match a MAC" fix could be satisfied by a lookup that
   *  simply never matches anything. */
  "ise-by-serial": {
    endpointId: "fixture-ise-2",
    serialNumber: "SN-CART-0042",
    name: "ward-cart-02",
    status: "unknown",
  },
});

/**
 * Look up a fixture endpoint by identifier, applying the SAME validation a live read
 * would. A refused identifier returns null here too, so fixture mode and live mode
 * agree about what is a valid request.
 *
 * THE LOOKUP IS SCOPED TO THE IDENTIFIER KIND, and it was not. Found by adversarial
 * review: the previous body validated with `type` and then matched with
 *
 *     f.macAddress === v.normalized || f.serialNumber === v.normalized
 *
 * — ignoring `type` entirely. The namespaces provably overlap, because
 * `CERT_SERIAL_RE` accepts colon-separated hex and every MAC address is
 * colon-separated hex. So `lookupNacFixture("aa:bb:cc:dd:ee:01", "cert")` returned
 * the MAC-keyed endpoint: a certificate-scoped question answered with a MAC match.
 *
 * This feeds `deviceResolver`, so the consequence is binding a decision to the wrong
 * device — the single worst thing an identity resolver can do. Matching per kind
 * costs nothing and makes the overlap unreachable.
 *
 * A `cert` lookup currently always returns null: no fixture carries a certificate
 * identity, and inventing one to make the path look populated would be fabricating
 * a corpus. The proof asserts the null explicitly so the absence is recorded rather
 * than mistaken for a miss.
 */
export function lookupNacFixture(identifier: unknown, type: NacIdentifierType): NACEndpointInfo | null {
  const v = validateNacIdentifier(identifier, type);
  if (!v.ok) return null;
  const matches = (f: NACEndpointInfo): boolean => {
    switch (type) {
      case "mac":
        return f.macAddress === v.normalized;
      case "serial":
        return f.serialNumber === v.normalized;
      case "cert":
        // NACEndpointInfo carries `certSubject` (a subject DN), NOT a certificate
        // serial. Comparing a serial against a subject would be the same category
        // error the ISE normalizer was just fixed for, so this matches nothing.
        return false;
      default:
        return false;
    }
  };
  return Object.values(NAC_FIXTURES).find(matches) ?? null;
}
