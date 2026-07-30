// Cisco ISE → normalized NAC endpoint record. READ-ONLY and PURE.
//
// WHAT WAS REMOVED. `quarantineEndpoint` POSTed to the ISE **ANC (Adaptive Network
// Control)** API at `/api/v1/anc/apply` to put an endpoint into a quarantine policy,
// and `clearQuarantine` reversed it. Both fired at a real ISE deployment with no
// tier gate, no `SIGNALGRID_LIVE_INTEGRATIONS` check and no approval step, against
// AGENTS.md:19 ("Keep high-risk actions simulated and approval-required").
//
// Cutting a device off the network is if anything more severe than locking it: on a
// shared clinical cart mid-shift it removes the worker's access to the systems the
// patient in front of them depends on. Deleted rather than gated, for the same reason
// as the `uem/` actuators — connector discipline here is a READ-ONLY discipline, so
// there is no disciplined form of a quarantine actuator to convert this into.
//
// WHAT ALSO CHANGED. The read built its filter as
// `` `MacAddress eq '${identifier}'` `` — caller-supplied input interpolated straight
// into an ISE filter expression. See ./identifier for why that is now allowlisted
// rather than escaped.
//
// The status mapping is corrected too. The old normalizer returned a hardcoded
// `status: 'registered'` for every endpoint it found, which asserted a NAC state it
// had not read — the same class of defect as Jamf's hardcoded `compliant: true`. ISE
// endpoint search does not report authentication state, so the honest answer is
// `unknown` unless the payload actually carries it.

import type { NACEndpointInfo } from "../adapters/types";
import { validateNacIdentifier, type NacIdentifierType } from "./identifier";

/** The subset of an ISE endpoint-search response this reads. All optional. */
export interface IseEndpointSearchPayload {
  readonly SearchResult?: {
    readonly resources?: ReadonlyArray<{
      readonly id?: unknown;
      readonly name?: unknown;
      /** ISE's own MAC for the endpoint. Read when present; never inferred. */
      readonly mac?: unknown;
    }>;
  };
}

const asString = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/**
 * Build the ISE filter expression for a lookup.
 *
 * Returns null when the identifier is refused, so a caller cannot accidentally
 * proceed with an unvalidated value — the failure is a missing filter, not a
 * best-effort one.
 */
export function iseFilterFor(identifier: unknown, type: NacIdentifierType): string | null {
  const v = validateNacIdentifier(identifier, type);
  if (!v.ok) return null;
  const field =
    type === "mac" ? "MacAddress" : type === "serial" ? "DeviceId" : "CertificateSerialNumber";
  return `${field} eq '${v.normalized}'`;
}

/**
 * Normalize an ISE endpoint-search response. Pure — no clock, no I/O, no throwing.
 *
 * Returns null for "no such endpoint", which is a real answer distinct from a fault.
 */
export function normalizeIseEndpoint(
  raw: IseEndpointSearchPayload,
): NACEndpointInfo | null {
  const first = raw?.SearchResult?.resources?.[0];
  const endpointId = asString(first?.id);
  if (!first || endpointId === undefined) return null;

  // IDENTITY FIELDS COME FROM THE RESPONSE, NEVER FROM THE REQUEST.
  //
  // FOUND BY ADVERSARIAL REVIEW, and it is the same defect this file's header claims
  // to have fixed for `status` — I fixed the unearned `registered` and then left the
  // identity fields fabricating. The previous version did:
  //
  //     macAddress:   type === "mac"    ? normalized : undefined,
  //     serialNumber: type === "serial" ? normalized : undefined,
  //     certSubject:  type === "cert"   ? normalized : undefined,
  //
  // where `normalized` is the CALLER'S QUERY. So the returned record asserted "ISE
  // says this endpoint's MAC is X" when ISE had said no such thing — it was echoing
  // the question back as an answer. If the search matched a different endpoint than
  // the caller assumed, the record confidently mislabelled it.
  //
  // Worse for `cert`: it wrote a certificate SERIAL into `certSubject`, which is a
  // subject-DN field. A serial is not a subject; that is a type confusion a consumer
  // would have no way to detect.
  //
  // ISE's endpoint search returns `mac` on the resource, so that one is READ. It
  // reports neither a device serial nor a certificate subject, so those are simply
  // ABSENT — an omitted field is honest, an echoed one is not.
  //
  // THE QUERY PARAMETERS ARE GONE FROM THE SIGNATURE, not merely unused. Removing the
  // fabrication left `identifier` and `type` sitting in the parameter list, ignored by
  // the body and dutifully passed by every caller — the exact ingredients of the defect,
  // kept within reach. With `noUnusedParameters` off, nothing flagged them. A function
  // that cannot see the caller's query cannot echo it back, so the defect is now
  // unrepresentable rather than merely absent. Same reasoning as the missing cycle
  // detector in `provisioning-order`: prefer a shape that cannot express the bug.
  return {
    endpointId,
    macAddress: asString(first.mac),
    name: asString(first.name),
    // ISE endpoint search returns identity and description, NOT session
    // authentication state. `registered` would be an unearned claim.
    status: "unknown",
  };
}

/** Canonical read contract, exported so the gate and any future live transport share
 *  ONE definition. Nothing here performs a request. */
export const ISE_READ_CONTRACT = {
  endpointSearchPath: "/api/v1/endpoint",
  filterParam: "filter",
} as const;
