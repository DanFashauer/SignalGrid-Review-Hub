import {
  DataProtectionConnector,
  type DlpConnectorConfig,
  type DlpHttpResponse,
  type DlpRequest,
  type DlpTransport,
} from "./dlp-connector";

export * from "./types";
export * from "./evaluate";
export * from "./dlp-connector";
export { createMockDlpTransport, type MockDlpOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND DLP_ACCESS_TOKEN. Otherwise fixture mode. Integration targets in this
 * shape: Microsoft Purview DLP, Forcepoint DLP, Symantec/Broadcom DLP, Zscaler,
 * Netskope.
 */
export type DlpConnectorResolution =
  | { mode: "live"; connector: DataProtectionConnector }
  | { mode: "fixture"; reason: string };

export function resolveDataProtectionConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: DlpTransport,
): DlpConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.DLP_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "DLP_ACCESS_TOKEN is not set" };
  }
  const config: DlpConnectorConfig = { accessToken, baseUrl: env.DLP_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new DataProtectionConnector(config, transportOverride ?? defaultDlpTransport) };
}

const defaultDlpTransport: DlpTransport = async (req: DlpRequest): Promise<DlpHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
