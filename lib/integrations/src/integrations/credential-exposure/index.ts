import {
  CredentialExposureConnector,
  type CredentialConnectorConfig,
  type CredentialHttpResponse,
  type CredentialRequest,
  type CredentialTransport,
} from "./credential-connector";

export * from "./types";
export * from "./evaluate";
export * from "./credential-connector";
export { createMockCredentialTransport, type MockCredentialOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND CREDENTIAL_EXPOSURE_ACCESS_TOKEN. Otherwise fixture mode. Integration
 * targets in this shape: GitGuardian, Wiz, Truffle Security, Microsoft.
 */
export type CredentialConnectorResolution =
  | { mode: "live"; connector: CredentialExposureConnector }
  | { mode: "fixture"; reason: string };

export function resolveCredentialExposureConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: CredentialTransport,
): CredentialConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.CREDENTIAL_EXPOSURE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "CREDENTIAL_EXPOSURE_ACCESS_TOKEN is not set" };
  }
  const config: CredentialConnectorConfig = { accessToken, baseUrl: env.CREDENTIAL_EXPOSURE_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new CredentialExposureConnector(config, transportOverride ?? defaultCredentialTransport) };
}

const defaultCredentialTransport: CredentialTransport = async (req: CredentialRequest): Promise<CredentialHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
