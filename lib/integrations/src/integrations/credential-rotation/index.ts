// Credential-rotation family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A ROTATION RECORD IS NOT ROTATING ANYTHING. This family consumes the
// record a secrets manager already keeps (Vault, AWS Secrets Manager, Azure Key
// Vault are the reference shapes) and grades its coherence. SignalGrid rotates no
// secret, issues no secret, revokes no secret and writes nothing. Rotation is the
// owning system's job; deciding whether to trust what it reports is ours.

import { CredentialRotationConnectorError, type CredentialRotationReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./normalize";

/** Injected so every test and the proof drive the SAME code path the live call
 *  uses. A transport the tests replace wholesale would leave the real one never
 *  executed — the defect the shared live-gate harness exists to catch. */
export type CredentialRotationTransport = (args: {
  subjectRef: string;
  token: string;
}) => Promise<CredentialRotationReportRaw>;

export type CredentialRotationResolution =
  | { mode: "live"; fetchRecord: (subjectRef: string) => Promise<CredentialRotationReportRaw> }
  | { mode: "fixture"; reason: string };

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with
 * SIGNALGRID_LIVE_INTEGRATIONS=true AND CREDENTIAL_ROTATION_TOKEN. Otherwise
 * fixture mode. Every gate is checked INDEPENDENTLY so removing any one of them
 * falls back to fixtures — proven by the shared live-gate harness rather than
 * asserted here.
 */
export function resolveCredentialRotationConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: CredentialRotationTransport,
): CredentialRotationResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const token = env.CREDENTIAL_ROTATION_TOKEN?.trim();
  if (!token) {
    return { mode: "fixture", reason: "CREDENTIAL_ROTATION_TOKEN is not set" };
  }
  const baseUrl = env.CREDENTIAL_ROTATION_BASE_URL?.trim() || "https://secrets.local/v1/secrets";
  const transport = transportOverride ?? makeDefaultCredentialRotationTransport(baseUrl);
  return { mode: "live", fetchRecord: (subjectRef) => transport({ subjectRef, token }) };
}

/** Build a live secrets-manager transport bound to a specific base URL. */
export function makeDefaultCredentialRotationTransport(baseUrl: string): CredentialRotationTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ subjectRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(subjectRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new CredentialRotationConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `credential-rotation source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new CredentialRotationConnectorError(
        "bad_response",
        "credential-rotation source returned a non-JSON body",
        res.status,
      );
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new CredentialRotationConnectorError(
        "bad_response",
        "credential-rotation source returned a non-object body",
        res.status,
      );
    }
    return body as CredentialRotationReportRaw;
  };
}
