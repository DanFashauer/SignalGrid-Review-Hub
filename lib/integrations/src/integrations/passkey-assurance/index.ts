import {
  PasskeyAssuranceConnector,
  type PasskeyConnectorConfig,
  type PasskeyTransport,
} from "./passkey-assurance-connector";
import { PasskeyConnectorError, type PasskeyReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./passkey-assurance-connector";
export { createMockPasskeyTransport, type MockPasskeyOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * PASSKEY_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only IdP authentication-methods export describing one
 * identity's registered credential. SignalGrid consumes that reading; it never
 * registers, revokes, or reconfigures a passkey profile — those stay with the IdP
 * (docs/PASSKEY_ASSURANCE.md).
 */
export type PasskeyConnectorResolution =
  | { mode: "live"; connector: PasskeyAssuranceConnector }
  | { mode: "fixture"; reason: string };

export function resolvePasskeyConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: PasskeyTransport,
): PasskeyConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.PASSKEY_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "PASSKEY_ACCESS_TOKEN is not set" };
  }
  const config: PasskeyConnectorConfig = {
    accessToken,
    baseUrl: env.PASSKEY_BASE_URL?.trim() || "https://idp.local/authentication-methods",
    source: "passkey-idp-export",
  };
  return {
    mode: "live",
    connector: new PasskeyAssuranceConnector(config, transportOverride ?? makeDefaultPasskeyTransport(config.baseUrl)),
  };
}

/** How long the reference transport waits on the IdP before failing closed. Named
 *  rather than left inline so the bound is one value with one name; the connector's
 *  config object carries no timeout field today and none is invented here, nor is a
 *  new environment variable. */
export const PASSKEY_TRANSPORT_TIMEOUT_MS = 10_000;

/** identityRef values that are PATH OPERATORS rather than identifiers.
 *
 *  Dots are unreserved, so `encodeURIComponent("..")` returns `..` unchanged and the
 *  segment survives into the path — `new Request(`${root}/..`).url` resolves to the
 *  root's PARENT before a socket is opened. Two exact values, rejected by name: a
 *  general identity-value regex would be this connector guessing at what an IdP may
 *  legitimately use as a subject id, and guessing wrong there rejects real identities. */
const PATH_OPERATOR_REFS: ReadonlySet<string> = new Set([".", ".."]);

/** `AbortSignal.timeout` rejects with a `TimeoutError`, which is a DOMException in
 *  Node and not an instance of anything this module owns — matched by name, since the
 *  class identity is the runtime's, not ours. */
function isTimeoutError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "TimeoutError";
}

/** Build a live IdP transport bound to a specific base URL (honors config). */
export function makeDefaultPasskeyTransport(baseUrl: string): PasskeyTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ identityRef, credentialRef, token }) => {
    // REFUSE BEFORE THE REQUEST LEAVES (2026-09-02 review finding). An absent
    // identityRef built `${root}/` and issued an AUTHENTICATED GET to the COLLECTION
    // endpoint: an absent input WIDENED the outbound request. The verdict downstream
    // did fail closed — IDENTITY_REF_MISSING — but only after the wider request had
    // already been made, and a refusal that arrives after the socket is not a
    // refusal of the call.
    const subject = typeof identityRef === "string" ? identityRef.trim() : "";
    if (subject.length === 0) {
      throw new PasskeyConnectorError(
        "identity_ref_missing",
        "passkey transport refused: an empty identityRef addresses the collection, not one identity",
      );
    }
    if (PATH_OPERATOR_REFS.has(subject)) {
      throw new PasskeyConnectorError(
        "identity_ref_invalid",
        `passkey transport refused: identityRef "${subject}" is a path operator, not an identity`,
      );
    }
    // ASYMMETRY ON PURPOSE: the refusal DECIDES on the trimmed value, and the request
    // SENDS the value untrimmed. So `" .. "` and `"   "` are over-refused — refused for
    // what they would mean once trimmed — while a legitimate ref with surrounding
    // whitespace is asked for exactly as the caller gave it, percent-encoded. Do not
    // "fix" the asymmetry by sending the trimmed value: that silently asks a different
    // question than the caller asked, and over-refusing is the safe half of the trade.
    //
    // A REQUESTED credentialRef gets the same absent-input rule as the identity ref.
    // Measured before this landed: `fetchNormalizedSet("carol", ["", "x"])` put
    // `…/carol?credential_ref=` on the wire and only the substitution guard — after the
    // socket — rescued the verdict. A non-string (null, a number) would have gone out
    // as `?credential_ref=null`. `undefined` still means "no ref requested", which is a
    // different statement and still produces no query string at all.
    if (credentialRef !== undefined) {
      const requested: unknown = credentialRef;
      if (typeof requested !== "string" || requested.trim().length === 0) {
        throw new PasskeyConnectorError(
          "credential_ref_missing",
          "passkey transport refused: a REQUESTED credentialRef must be a non-blank string",
        );
      }
    }
    //
    // THE CREDENTIAL REF TRAVELS WITH THE REQUEST (2026-09-02 review finding). This
    // transport used to destructure `{ identityRef, token }` and drop `credentialRef`
    // on the floor, so `fetchNormalizedSet(id, ["c1", "c2"])` issued two IDENTICAL
    // requests — N refs asking one question N times — and only the substitution guard,
    // written for a HOSTILE source, rescued the verdict by accident. A `credential_ref`
    // query parameter is the documented shape for this REFERENCE transport
    // (docs/PASSKEY_ASSURANCE.md); a real IdP adapter may carry it in a header or a
    // body instead. What is not optional is that it is carried at all.
    const path = `${root}/${encodeURIComponent(identityRef)}`;
    const url =
      credentialRef === undefined ? path : `${path}?credential_ref=${encodeURIComponent(credentialRef)}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(PASSKEY_TRANSPORT_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout propagated UNTYPED while every other failure here carries a code, so
      // the failure a slow IdP actually produces was the one a caller could not switch
      // on. Other network errors are rethrown untouched rather than relabelled as
      // something this transport did not establish.
      if (isTimeoutError(err)) {
        throw new PasskeyConnectorError(
          "timeout",
          `passkey source did not respond within ${PASSKEY_TRANSPORT_TIMEOUT_MS}ms`,
        );
      }
      throw err;
    }
    if (!res.ok) {
      throw new PasskeyConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `passkey source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PasskeyConnectorError("bad_response", "passkey source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new PasskeyConnectorError("bad_response", "passkey source returned a non-object body", res.status);
    }
    return body as PasskeyReportRaw;
  };
}
