// Validated endpoint identifiers for NAC reads.
//
// WHY THIS EXISTS. Both vendor adapters built their query filter by interpolating a
// caller-supplied string directly:
//
//     filter = `MacAddress eq '${identifier}'`        // Cisco ISE
//     filter = `mac_address='${identifier}'`          // Aruba ClearPass
//
// The identifier reaches `lookupEndpoint` from device resolution, i.e. from outside.
// A value containing a quote closes the literal and the rest is appended to the
// vendor's filter expression — a filter-injection surface on a read that runs with
// NAC API credentials. Neither adapter validated or escaped anything.
//
// Escaping quotes would be the narrow fix and the wrong one: these identifiers have
// tight, well-known shapes, so an ALLOWLIST is both simpler and strictly safer than
// trying to neutralise a hostile string. Anything that is not recognisably a MAC, a
// serial, or a certificate serial is refused before it can reach a query.

/** Identifier kinds a NAC lookup accepts. */
export type NacIdentifierType = "mac" | "serial" | "cert";

export type NacIdentifierValidation =
  | { readonly ok: true; readonly normalized: string }
  | { readonly ok: false; readonly reason: string };

/** MAC in colon, hyphen or bare form — normalized to lowercase colon-separated. */
const MAC_RE = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$|^[0-9a-f]{12}$/i;
/** Device/hardware serials: alphanumeric with hyphen and underscore, bounded. */
const SERIAL_RE = /^[0-9a-z_-]{1,64}$/i;
/** Certificate serial numbers as reported by ISE/ClearPass: hex, optionally
 *  colon-separated, bounded. */
const CERT_SERIAL_RE = /^[0-9a-f]{1,2}(?::[0-9a-f]{1,2}){0,63}$|^[0-9a-f]{1,128}$/i;

/**
 * Validate and normalize an identifier for a NAC query.
 *
 * Returns a refusal rather than throwing, and never echoes the offending value back
 * — an error message that quotes hostile input just moves the problem into the log.
 */
export function validateNacIdentifier(
  identifier: unknown,
  type: NacIdentifierType,
): NacIdentifierValidation {
  if (typeof identifier !== "string") {
    return { ok: false, reason: "identifier is not a string" };
  }
  const trimmed = identifier.trim();
  if (trimmed === "") return { ok: false, reason: "identifier is empty" };
  if (trimmed.length > 256) return { ok: false, reason: "identifier exceeds 256 characters" };

  switch (type) {
    case "mac": {
      if (!MAC_RE.test(trimmed)) return { ok: false, reason: "not a well-formed MAC address" };
      const hex = trimmed.replace(/[:-]/g, "").toLowerCase();
      return { ok: true, normalized: hex.match(/.{2}/g)!.join(":") };
    }
    case "serial":
      if (!SERIAL_RE.test(trimmed)) return { ok: false, reason: "not a well-formed serial" };
      return { ok: true, normalized: trimmed };
    case "cert":
      if (!CERT_SERIAL_RE.test(trimmed)) {
        return { ok: false, reason: "not a well-formed certificate serial" };
      }
      return { ok: true, normalized: trimmed.toLowerCase() };
    default:
      // Unreachable via the type, reachable via untrusted input at a boundary.
      return { ok: false, reason: "unrecognised identifier type" };
  }
}
