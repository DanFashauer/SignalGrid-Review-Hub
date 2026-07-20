import {
  VulnScanConnector,
  type VulnConnectorConfig,
  type VulnHttpResponse,
  type VulnRequest,
  type VulnTransport,
} from "./vuln-connector";

export * from "./types";
export * from "./evaluate";
export * from "./vuln-connector";
export { createMockVulnTransport, type MockVulnOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND VULN_SCAN_ACCESS_TOKEN. Otherwise fixture mode. Integration targets in
 * this shape: Tenable, Qualys, CrowdStrike Falcon Spotlight, Rapid7 InsightVM,
 * Microsoft Defender Vulnerability Management, Tanium.
 */
export type VulnConnectorResolution =
  | { mode: "live"; connector: VulnScanConnector }
  | { mode: "fixture"; reason: string };

export function resolveVulnScanConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: VulnTransport,
): VulnConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.VULN_SCAN_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "VULN_SCAN_ACCESS_TOKEN is not set" };
  }
  const config: VulnConnectorConfig = { accessToken, baseUrl: env.VULN_SCAN_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new VulnScanConnector(config, transportOverride ?? defaultVulnTransport) };
}

const defaultVulnTransport: VulnTransport = async (req: VulnRequest): Promise<VulnHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
