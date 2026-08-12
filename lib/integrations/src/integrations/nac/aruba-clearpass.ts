// Aruba ClearPass → normalized NAC endpoint record. READ-ONLY and PURE.
//
// WHAT WAS REMOVED. `quarantineEndpoint`, `clearQuarantine` and a `quarantineDevice`
// alias, which POSTed to ClearPass to move an endpoint into a quarantine role and
// reverse it — ungated, unproven, and against AGENTS.md:19. See cisco-ise.ts for the
// full reasoning; it applies identically here.
//
// WHAT ALSO CHANGED. The read built its filter as
// `` `mac_address='${identifier}'` `` — caller-supplied input interpolated straight
// into a ClearPass filter. Now allowlisted via ./identifier.
//
// The status mapping is PRESERVED, because unlike ISE, ClearPass genuinely reports an
// endpoint status and the old mapping was correct. It is only made total: an
// unrecognised vendor status falls to `unknown` rather than being dropped, which is
// what the original `statusMap[status] || 'unknown'` already did — kept deliberately,
// not rediscovered.

import type { NACEndpointInfo } from "../adapters/types";
import { validateNacIdentifier, type NacIdentifierType } from "./identifier";

/** The subset of a ClearPass endpoint response this reads. All optional. */
export interface ClearPassEndpointPayload {
  readonly _embedded?: {
    readonly items?: ReadonlyArray<{
      readonly id?: unknown;
      readonly mac_address?: unknown;
      readonly device_id?: unknown;
      readonly name?: unknown;
      readonly status?: unknown;
    }>;
  };
}

const asString = (v: unknown): string | undefined => {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
};

/** ClearPass endpoint status → the normalized union. Total by construction: anything
 *  unrecognised is `unknown`, never a more confident value. */
export function clearPassStatus(raw: unknown): NACEndpointInfo["status"] {
  switch (asString(raw)) {
    case "Known":
      return "registered";
    case "Authenticated":
      return "authenticated";
    case "Disconnected":
      return "disconnected";
    default:
      return "unknown";
  }
}

/** Build the ClearPass filter for a lookup, or null when the identifier is refused. */
export function clearPassFilterFor(
  identifier: unknown,
  type: NacIdentifierType,
): string | null {
  const v = validateNacIdentifier(identifier, type);
  if (!v.ok) return null;
  const field = type === "mac" ? "mac_address" : type === "serial" ? "device_id" : "cert_serial";
  return `${field}='${v.normalized}'`;
}

/** Normalize a ClearPass endpoint response. Pure. Null means "no such endpoint". */
export function normalizeClearPassEndpoint(
  raw: ClearPassEndpointPayload,
): NACEndpointInfo | null {
  const first = raw?._embedded?.items?.[0];
  const endpointId = asString(first?.id);
  if (!first || endpointId === undefined) return null;

  return {
    endpointId,
    macAddress: asString(first.mac_address),
    serialNumber: asString(first.device_id),
    name: asString(first.name),
    status: clearPassStatus(first.status),
  };
}

/** Canonical read contract. Nothing here performs a request. */
export const CLEARPASS_READ_CONTRACT = {
  endpointPath: "/api/endpoint",
  filterParam: "filter",
} as const;
